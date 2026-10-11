<?php
declare(strict_types=1);

/*
 * Однофайловый бэкенд: авторизация по логину/паролю, прокси VK API
 * и серверное кэширование. Лежит рядом с index.html, поэтому работает
 * в любой поддиректории веб-сервера.
 *
 * Секреты (токен VK, пароль) считываются из:
 *   1) переменных окружения VK_PHOTO_TOKEN / VK_PHOTO_USER / VK_PHOTO_PASSWORD
 *   2) файла private/secrets.php (см. private/secrets.example.php)
 */

const ALBUM_ID = 'saved';
const DEFAULT_API_VERSION = '5.199';
const CACHE_TTL_SECONDS = 300;
const MAX_COUNT = 1000;

/* ---------------------------------------------------------------- helpers */

function json_out(array $data, int $status = 200): never
{
    // Свой gzip с явным Content-Length: в Яндекс.Браузере большие ответы без
    // него приходят с пустым телом («долгая загрузка», затем ошибка разбора).
    // Заодно JSON сжимается в разы сильнее статики.
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) {
        ob_end_clean();
    }

    $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE;
    $json = json_encode($data, $flags);
    if ($json === false) {
        $json = '{"error":{"code":"ENCODE_FAILED","message":"Не удалось сериализовать ответ","details":null}}';
        $status = 500;
    }

    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-transform');
    header('X-Content-Type-Options: nosniff');
    header('Vary: Accept-Encoding');

    $acceptsGzip = stripos((string) ($_SERVER['HTTP_ACCEPT_ENCODING'] ?? ''), 'gzip') !== false;
    if ($acceptsGzip && function_exists('gzencode')) {
        $body = (string) gzencode($json, 6);
        header('Content-Encoding: gzip');
    } else {
        $body = $json;
    }
    header('Content-Length: ' . strlen($body));
    echo $body;
    exit;
}

function fail(int $status, string $code, string $message, array $details = []): never
{
    json_out(['error' => ['code' => $code, 'message' => $message, 'details' => $details ?: null]], $status);
}

function request_body(): array
{
    $raw = (string) file_get_contents('php://input');
    if ($raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/* ---------------------------------------------------------------- secrets */

function load_secrets(): array
{
    $env = function (string $name): ?string {
        $value = getenv($name);
        return ($value === false || $value === '') ? null : $value;
    };

    $file = __DIR__ . '/private/secrets.php';
    $fromFile = [];
    if (is_file($file)) {
        $loaded = include $file;
        if (is_array($loaded)) {
            $fromFile = $loaded;
        }
    }

    // Окружение имеет приоритет над файлом.
    if (($token = $env('VK_PHOTO_TOKEN')) !== null) {
        $fromFile['vk_token'] = $token;
    }
    if (($user = $env('VK_PHOTO_USER')) !== null) {
        $fromFile['username'] = $user;
    }
    if (($pass = $env('VK_PHOTO_PASSWORD')) !== null) {
        $fromFile['password'] = $pass;
    }
    if (($key = $env('VK_PHOTO_AI_KEY')) !== null) {
        $fromFile['ai_api_key'] = $key;
    }
    if (($base = $env('VK_PHOTO_AI_BASE_URL')) !== null) {
        $fromFile['ai_base_url'] = $base;
    }
    if (($model = $env('VK_PHOTO_AI_MODEL')) !== null) {
        $fromFile['ai_model'] = $model;
    }

    return $fromFile;
}

function secrets_ready(array $s): bool
{
    $hasAuth = isset($s['username']) && $s['username'] !== '' &&
        (isset($s['password_hash']) && $s['password_hash'] !== '' || isset($s['password']) && $s['password'] !== '');
    $hasToken = isset($s['vk_token']) && is_string($s['vk_token']) && $s['vk_token'] !== '';
    return $hasAuth && $hasToken;
}

/* ---------------------------------------------------------------- session */

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    if (session_name('VKPSESS')) {
        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => '/',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure'   => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
        ]);
    }
    session_start();
}

function require_auth(): void
{
    start_session();
    if (empty($_SESSION['vkphotos_authorized'])) {
        fail(401, 'UNAUTHORIZED', 'Требуется вход');
    }
    // Освобождаем блокировку сессии до долгого запроса к VK.
    // Иначе параллельные запросы того же пользователя (проверка сессии,
    // вход, следующие страницы) ждут освобождения файла сессии и падают
    // по таймауту с «Сервер не ответил вовремя».
    session_write_close();
}

function verify_credentials(array $s, string $username, string $password): bool
{
    $expectedUser = (string) ($s['username'] ?? '');
    if ($username === '' || $expectedUser === '' || $username !== $expectedUser) {
        return false;
    }
    if (isset($s['password_hash']) && $s['password_hash'] !== '') {
        return password_verify($password, (string) $s['password_hash']);
    }
    if (isset($s['password']) && is_string($s['password'])) {
        return hash_equals($s['password'], $password);
    }
    return false;
}

/* ---------------------------------------------------------------- VK gateway */

/*
 * Понятные сообщения для кодов ошибок VK API
 * (см. https://dev.vk.com/reference/errors).
 */
function vk_error_message(int $code): string
{
    return match ($code) {
        5       => 'VK отклонил токен: нужен user-токен со scope photos,offline',
        6       => 'VK: слишком много запросов в секунду, попробуйте ещё раз',
        7       => 'VK: нет прав на это действие',
        9       => 'VK: сработал flood-контроль, попробуйте позже',
        14      => 'VK требует капчу — войдите в аккаунт на vk.com и повторите',
        15      => 'VK: доступ запрещён (проверьте настройки приватности альбома)',
        27      => 'На сервере используется токен сообщества вместо user-токена',
        29      => 'VK: достигнут лимит запросов, попробуйте позже',
        100     => 'VK: неверные параметры запроса',
        200     => 'VK: доступ к альбому «Сохранённые фото» запрещён',
        1117    => 'VK-токен истёк — получите новый и впишите в private/secrets.php',
        3610    => 'VK: пользователь деактивирован',
        default => 'VK вернул ошибку',
    };
}

/*
 * VK ограничивает частоту обращений: для user-токена — не чаще 3 запросов в
 * секунду (иначе ошибка 6), плюс есть суточные лимиты на однотипные методы
 * (ошибки 14/29). Держим глобальный интервал ≈340 мс между вызовами VK, чтобы
 * даже параллельные запросы (несколько вкладок, быстрая пагинация) не упирались
 * в лимит. Синхронизируем через файл-замок — работает без APC/opcache.
 */
function vk_throttle(): void
{
    $minIntervalUs = 340_000; // ≈2.9 запроса в секунду
    $dir = __DIR__ . '/private/cache';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return; // кэш недоступен — не блокируем работу
    }
    $fh = @fopen($dir . '/vk-throttle.lock', 'c+');
    if ($fh === false) {
        return;
    }
    if (flock($fh, LOCK_EX)) {
        $raw = stream_get_contents($fh);
        $last = (int) trim($raw === false ? '' : $raw);
        $waitUs = $last + $minIntervalUs - (int) round(microtime(true) * 1_000_000);
        if ($waitUs > 0) {
            usleep($waitUs);
        }
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, (string) (int) round(microtime(true) * 1_000_000));
        fflush($fh);
        flock($fh, LOCK_UN);
    }
    fclose($fh);
}

function vk_call(array $s, string $method, array $params, int $attempt = 0): array
{
    $params['access_token'] = (string) $s['vk_token'];
    $params['v'] = (string) ($s['api_version'] ?? DEFAULT_API_VERSION);

    $base = rtrim((string) ($s['vk_base'] ?? 'https://api.vk.com/method'), '/');
    $url = $base . '/' . $method . '?' . http_build_query($params);

    $ctx = stream_context_create([
        'http' => [
            'timeout'        => (int) ($s['timeout'] ?? 15),
            'ignore_errors'  => true,
            'header'         => "User-Agent: vk-photo-gallery/1.0\r\n",
        ],
    ]);

    vk_throttle();
    $body = @file_get_contents($url, false, $ctx);
    if ($body === false) {
        // Иногда VK/сеть просто моргают — даём пару попыток.
        if ($attempt < 2) {
            usleep(300_000 * ($attempt + 1));
            return vk_call($s, $method, $params, $attempt + 1);
        }
        fail(502, 'VK_UNAVAILABLE', 'Не удалось связаться с VK API');
    }
    $json = json_decode($body, true);
    if (!is_array($json)) {
        fail(502, 'VK_BAD_RESPONSE', 'VK вернул некорректный ответ');
    }
    if (isset($json['error'])) {
        $err = $json['error'];
        $code = (int) ($err['error_code'] ?? 0);
        // 6/9/29 — превышен лимит запросов; повторяем с нарастающей паузой.
        if (in_array($code, [6, 9, 29], true) && $attempt < 2) {
            usleep(400_000 * ($attempt + 1));
            return vk_call($s, $method, $params, $attempt + 1);
        }
        $msg = (string) ($err['error_msg'] ?? '');
        fail(502, 'VK_' . $code, vk_error_message($code) . ($msg !== '' ? ' (' . $msg . ')' : ''), ['vk_code' => $code]);
    }
    return is_array($json['response'] ?? null) ? $json['response'] : [];
}

/* ---------------------------------------------------------------- mapping */

function pick_size(array $sizes, bool $display): ?array
{
    if ($sizes === []) {
        return null;
    }
    $preference = $display ? ['x', 'y', 'z', 'r', 'q', 'p'] : ['m', 's', 'x'];
    foreach ($preference as $type) {
        foreach ($sizes as $size) {
            if (($size['type'] ?? '') === $type && !empty($size['url'])) {
                return $size;
            }
        }
    }
    $area = function (array $size): int {
        return (int) ($size['width'] ?? 0) * (int) ($size['height'] ?? 0);
    };
    usort($sizes, fn (array $a, array $b): int => $display
        ? $area($b) <=> $area($a)
        : $area($a) <=> $area($b));
    return !empty($sizes[0]['url']) ? $sizes[0] : null;
}

function map_photo(array $raw): array
{
    $sizes = isset($raw['sizes']) && is_array($raw['sizes']) ? $raw['sizes'] : [];
    $display = pick_size($sizes, true);
    $thumb = pick_size($sizes, false);

    // Подпись может содержать не-UTF-8 байты — приводим к валидному UTF-8,
    // иначе ответ рискует «сломаться» на кодировании.
    $text = (string) ($raw['text'] ?? '');
    if ($text !== '' && function_exists('mb_check_encoding') && !mb_check_encoding($text, 'UTF-8')) {
        $text = mb_convert_encoding($text, 'UTF-8', 'UTF-8');
    }

    return [
        'id'           => (int) ($raw['id'] ?? 0),
        'ownerId'      => (int) ($raw['owner_id'] ?? 0),
        'albumId'      => (int) ($raw['album_id'] ?? 0),
        'width'        => (int) ($display['width'] ?? $raw['width'] ?? 0),
        'height'       => (int) ($display['height'] ?? $raw['height'] ?? 0),
        'text'         => $text,
        'date'         => (int) ($raw['date'] ?? 0),
        'thumbnailUrl' => $thumb['url'] ?? null,
        'displayUrl'   => $display['url'] ?? null,
    ];
}

/* ---------------------------------------------------------------- cache */

function cache_path(string $key): string
{
    return __DIR__ . '/private/cache/' . $key . '.json';
}

function cache_get(string $key): ?array
{
    $path = cache_path($key);
    if (!is_file($path)) {
        return null;
    }
    if (time() - (int) filemtime($path) > CACHE_TTL_SECONDS) {
        return null;
    }
    $data = json_decode((string) file_get_contents($path), true);
    return is_array($data) ? $data : null;
}

function cache_put(string $key, array $data): void
{
    $dir = dirname(cache_path($key));
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return; // кэш не критичен — продолжим без него
    }
    @file_put_contents(cache_path($key), json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
}

/* ---------------------------------------------------------------- actions */

function action_session(array $s): void
{
    start_session();
    $authorized = !empty($_SESSION['vkphotos_authorized']);
    json_out([
        'authorized' => $authorized,
        'setupRequired' => !secrets_ready($s),
    ]);
}

function action_login(array $s): void
{
    start_session();

    if (!secrets_ready($s)) {
        fail(503, 'NOT_CONFIGURED', 'Сервер не настроен: заполните private/secrets.php и впишите токен VK');
    }

    $body = request_body();
    $username = is_string($body['username'] ?? null) ? trim($body['username']) : '';
    $password = is_string($body['password'] ?? null) ? $body['password'] : '';

    // Простой троттлинг подбора пароля.
    $fails = (int) ($_SESSION['vkphotos_login_fails'] ?? 0);
    if ($fails >= 5) {
        fail(429, 'TOO_MANY_ATTEMPTS', 'Слишком много попыток входа. Подождите минуту.');
    }

    if (!verify_credentials($s, $username, $password)) {
        $_SESSION['vkphotos_login_fails'] = $fails + 1;
        usleep(250_000); // 250 мс — сглаживаем разницу по времени
        fail(401, 'BAD_CREDENTIALS', 'Неверный логин или пароль');
    }

    unset($_SESSION['vkphotos_login_fails']);
    $_SESSION['vkphotos_authorized'] = true;
    session_regenerate_id(true);
    json_out(['authorized' => true]);
}

function action_logout(): void
{
    start_session();
    $_SESSION = [];
    session_destroy();
    json_out(['authorized' => false]);
}

function action_photos(array $s): void
{
    require_auth();

    if (!isset($s['vk_token']) || (string) $s['vk_token'] === '') {
        fail(503, 'VK_NOT_CONFIGURED', 'VK-токен не задан на сервере');
    }

    $offset = filter_var($_GET['offset'] ?? 0, FILTER_VALIDATE_INT, ['options' => ['default' => 0, 'min_range' => 0]]);
    $count = filter_var($_GET['count'] ?? 30, FILTER_VALIDATE_INT, ['options' => ['default' => 30, 'min_range' => 1, 'max_range' => MAX_COUNT]]);
    if (!is_int($offset) || !is_int($count)) {
        fail(400, 'VALIDATION_FAILED', 'offset/count должны быть целыми числами');
    }

    // Ключ кэша зависит от всего, что влияет на результат.
    $key = hash('sha256', json_encode(['album' => ALBUM_ID, 'o' => $offset, 'c' => $count]));

    if (($cached = cache_get($key)) !== null) {
        header('Cache-Control: private, max-age=' . CACHE_TTL_SECONDS);
        json_out($cached);
    }

    $ownerId = isset($s['owner_id']) && $s['owner_id'] !== '' ? $s['owner_id'] : null;
    $response = vk_call($s, 'photos.get', [
        'album_id'     => ALBUM_ID,
        'owner_id'     => $ownerId,
        'offset'       => $offset,
        'count'        => $count,
        'photo_sizes'  => 1,
        'rev'          => 1,
    ]);

    $items = array_map(map_photo(...), $response['items'] ?? []);
    $result = [
        'total'   => (int) ($response['count'] ?? 0),
        'offset'  => $offset,
        'count'   => count($items),
        'hasMore' => $offset + count($items) < (int) ($response['count'] ?? 0),
        'items'   => $items,
    ];

    cache_put($key, $result);
    header('Cache-Control: private, max-age=' . CACHE_TTL_SECONDS);
    json_out($result);
}

/* ---------------------------------------------------------------- AI stacks */

/*
 * «Стопки» — группировка похожих фото глазами ИИ. Пайплайн:
 *  1) скачиваем ВСЕ фото альбома (pages через photos.get);
 *  2) миниатюры пакетами (размер пакета — ai_batch, по умолчанию 64) отправляем
 *     в любую OpenAI-совместимую vision-модель (базовый адрес и ключ в секретах),
 *     просим короткую тему;
 *  3) локально склеиваем похожие темы в стопки (overlap токенов) и кэшируем.
 * Модель выбирается на freellm.net; по умолчанию — бесплатная Gemini (AI Studio),
 * но подходит любой провайдер: NVIDIA NIM, Groq, OpenRouter и т.п.
 * Размер пакета подбирается под лимиты модели: бесплатная Gemini даёт 20 запросов
 * в день на модель, поэтому пакет 64 → сборка 1000 фото = 16 запросов.
 */
const AI_MAX_IMAGES = 2000;
const AI_CACHE_TTL_SECONDS = 43200; // 12 часов — сборка идёт долго, без нужды не повторяем

/* Квота исчерпана (429/RESOURCE_EXHAUSTED) — ретраить бессмысленно (обычно
 * «попробуйте через несколько часов»): короткозамким сразу с понятным текстом. */
class AiQuotaExhausted extends RuntimeException
{
}

function ai_dir(): ?string
{
    $dir = __DIR__ . '/private/ai-cache';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return null;
    }
    return $dir;
}

function ai_config(array $s): array
{
    $model = (string) ($s['ai_model'] ?? 'gemini-3.8-flash');
    return [
        'base'  => rtrim((string) ($s['ai_base_url'] ?? 'https://generativelanguage.googleapis.com/v1beta/openai'), '/'),
        'model' => $model,
        'key'   => (string) ($s['ai_api_key'] ?? ''),
        'ready' => isset($s['ai_api_key']) && (string) $s['ai_api_key'] !== '',
        'batch' => ai_batch($s, $model),
    ];
}

/* Размер пакета картинок в одном запросе: от него зависит число запросов.
 * Лимит бесплатной Gemini — 20 запросов/день на модель, пакет 64 → 16 запросов
 * на 1000 фото. Модели Gemma имеют короткий контекст (33K) — им пакет меньше.
 * Переопределяется в secrets.php ключом ai_batch или env VK_PHOTO_AI_BATCH. */
function ai_batch(array $s, string $model): int
{
    $v = $s['ai_batch'] ?? '';
    if ($v === '' || $v === null) {
        $env = getenv('VK_PHOTO_AI_BATCH');
        $v = $env === false || $env === '' ? '' : (string) $env;
    }
    if ($v === '') {
        $v = str_contains($model, 'gemma') ? 8 : 64;
    }
    return max(8, min(200, (int) $v));
}

function ai_user_key(array $s): string
{
    $user = (string) ($s['username'] ?? 'user');
    return hash('sha256', $user . ':' . (string) ($s['vk_token'] ?? ''));
}

function ai_cache_path(string $userKey): string
{
    return __DIR__ . '/private/ai-cache/stacks-' . $userKey . '.json';
}

function ai_snapshot_path(string $userKey): string
{
    return __DIR__ . '/private/ai-cache/snapshot-' . $userKey . '.json';
}

function ai_read_cache(string $userKey): ?array
{
    $path = ai_cache_path($userKey);
    if (!is_file($path)) {
        return null;
    }
    $data = json_decode((string) file_get_contents($path), true);
    return is_array($data) ? $data : null;
}

function ai_write_json(string $path, array $data): void
{
    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return;
    }
    @file_put_contents($path, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
}

/* Все фото альбома одной лентой (постранично, как в интерфейсе). */
function fetch_all_photos(array $s): array
{
    $ownerId = isset($s['owner_id']) && $s['owner_id'] !== '' ? $s['owner_id'] : null;
    $items = [];
    $offset = 0;
    $loops = 0;
    while (count($items) < AI_MAX_IMAGES) {
        $response = vk_call($s, 'photos.get', [
            'album_id'    => ALBUM_ID,
            'owner_id'    => $ownerId,
            'offset'      => $offset,
            'count'       => MAX_COUNT,
            'photo_sizes' => 1,
            'rev'         => 1,
        ]);
        $part = $response['items'] ?? [];
        foreach ($part as $raw) {
            $items[] = map_photo($raw);
        }
        $total = (int) ($response['count'] ?? 0);
        if ($part === [] || $offset + count($part) >= $total) {
            break;
        }
        $offset += count($part);
        if (++$loops > 12) { // 12 + 1 страница = максимум ~13000 фото, хватит
            break;
        }
    }
    return $items;
}

/* Скачивает картинку и возвращает data-URI (data:<mime>;base64,...).
 * Проверяем первые байты, чтобы не отправить модели HTML-страницу
 * вместо фото, и подставляем настоящий MIME (не только image/jpeg). */
function image_data_uri(string $url): ?string
{
    if (preg_match('#^https?://#i', $url) !== 1) {
        return null;
    }
    $ctx = stream_context_create([
        'http' => [
            'timeout'         => 20,
            'ignore_errors'   => true,
            'follow_location' => 1,
            'max_redirects'   => 4,
            'header'          => "User-Agent: vk-photo-gallery/1.0\r\n",
        ],
    ]);
    $body = @file_get_contents($url, false, $ctx);
    if ($body === false || $body === '') {
        return null;
    }
    $first = substr($body, 0, 12);
    $mime = 'image/jpeg';
    if (str_starts_with($first, "\xFF\xD8\xFF")) {
        $mime = 'image/jpeg';
    } elseif (str_starts_with($first, "\x89PNG")) {
        $mime = 'image/png';
    } elseif (str_starts_with($first, 'GIF8')) {
        $mime = 'image/gif';
    } elseif (str_starts_with($first, 'RIFF') && substr($first, 8, 4) === 'WEBP') {
        $mime = 'image/webp';
    } elseif (str_starts_with($first, 'BM')) { // BMP тоже картинка (напр. у хостингов-моков)
        $mime = 'image/bmp';
    } else {
        return null; // не картинка — не тащим мусор в модель
    }
    return 'data:' . $mime . ';base64,' . base64_encode($body);
}

/* Вызов OpenAI-совместимого chat/completions; возвращает текст ответа.
 * Умеет ходить через cURL (на большинстве хостингов уже есть свои CA-сертификаты)
 * или через stream-контекст; при транспортной ошибке повторяет с «ослабленным»
 * SSL (проблемные CA у старых хостов) и без служебных параметров max_tokens/
 * temperature — некоторые бесплатные модели их не принимают.
 */
function http_post(string $url, string $payload, array $headers, bool $relaxSsl): string
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => 180,
            CURLOPT_CONNECTTIMEOUT => 20,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 4,
        ];
        if ($relaxSsl) {
            $opts[CURLOPT_SSL_VERIFYPEER] = false;
            $opts[CURLOPT_SSL_VERIFYHOST] = 0;
        }
        curl_setopt_array($ch, $opts);
        $body = curl_exec($ch);
        $err = curl_error($ch);
        curl_close($ch);
        if ($body === false) {
            throw new RuntimeException('ИИ-провайдер недоступен' . ($err !== '' ? ': ' . $err : ''));
        }
        return (string) $body;
    }

    $http = [
        'method'        => 'POST',
        'timeout'       => 180,
        'ignore_errors' => true,
        'follow_location' => 1,
        'header'        => implode("\r\n", $headers) . "\r\n",
        'content'       => $payload,
    ];
    $ctx = stream_context_create([
        'http' => $http,
        'ssl'  => $relaxSsl ? ['verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true] : [],
    ]);
    $body = @file_get_contents($url, false, $ctx);
    if ($body === false) {
        throw new RuntimeException('ИИ-провайдер недоступен (нет cURL и/или закрыт allow_url_fopen)');
    }
    return (string) $body;
}

function ai_chat_once(array $cfg, array $messages, array $extra, bool $relaxSsl): string
{
    $payload = json_encode(
        array_merge(['model' => $cfg['model'], 'messages' => $messages], $extra),
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
    );
    $url = $cfg['base'] . '/chat/completions';
    $headers = ['Authorization: Bearer ' . $cfg['key'], 'Content-Type: application/json'];

    $body = http_post($url, $payload, $headers, $relaxSsl);
    $json = json_decode($body, true);
    if (!is_array($json)) {
        throw new RuntimeException('ИИ-провайдер вернул некорректный ответ');
    }
    if (isset($json['error']) && is_array($json['error'])) {
        $msg = (string) ($json['error']['message'] ?? json_encode($json['error'], JSON_UNESCAPED_UNICODE));
        $status = (string) ($json['error']['status'] ?? '');
        $lower = u_lower($msg);
        $isQuota = $status === 'RESOURCE_EXHAUSTED'
            || (int) ($json['error']['code'] ?? 0) === 429
            || str_contains($lower, 'quota')
            || str_contains($lower, 'rate limit')
            || str_contains($lower, 'too many requests');
        if ($isQuota) {
            $delay = ai_quota_delay($json);
            $hint = $delay !== null
                ? ('. Сброс ориентировочно через ' . ai_human_seconds($delay))
                : '';
            throw new AiQuotaExhausted('ИИ-провайдер: квота исчерпана' . $hint . ' – ' . $msg);
        }
        throw new RuntimeException('ИИ-провайдер: ' . $msg);
    }
    $content = ai_extract_text($json);
    if ($content === '') {
        ai_dump_empty($body);
        $finish = (string) ($json['choices'][0]['finish_reason'] ?? $json['finish_reason'] ?? '?');
        throw new RuntimeException(
            'ИИ-провайдер вернул пустой ответ (finish_reason=' . $finish . '). '
            . 'Детали сохранены в private/diag/ai-empty.json — пришлите их.',
        );
    }
    return $content;
}

/* Достаём текст ответа из любого распространённого формата: OpenAI chat
 * (choices[].message.content строка или список частей), completions-стиль
 * (choices[].text), а также обёртки Gemini/прочих (choices[].candidates[].output_text). */
function ai_extract_text(array $json): string
{
    $choices = $json['choices'] ?? null;
    if (is_array($choices)) {
        foreach ($choices as $ch) {
            if (!is_array($ch)) {
                continue;
            }
            $msg = $ch['message'] ?? null;
            if (is_array($msg)) {
                $c = $msg['content'] ?? '';
                if (is_array($c)) {
                    $parts = '';
                    foreach ($c as $part) {
                        if (is_array($part) && isset($part['text']) && is_string($part['text'])) {
                            $parts .= $part['text'];
                        } elseif (is_string($part)) {
                            $parts .= $part;
                        }
                    }
                    $c = $parts;
                }
                if (is_string($c) && trim($c) !== '') {
                    return trim($c);
                }
                if (is_string($msg['text'] ?? null) && trim($msg['text']) !== '') {
                    return trim($msg['text']);
                }
            }
            if (is_string($ch['text'] ?? null) && trim($ch['text']) !== '') {
                return trim($ch['text']);
            }
            if (is_array($ch['candidates'] ?? null)) {
                foreach ($ch['candidates'] as $cd) {
                    if (!is_array($cd)) {
                        continue;
                    }
                    if (is_string($cd['output_text'] ?? null) && trim($cd['output_text']) !== '') {
                        return trim($cd['output_text']);
                    }
                    if (is_array($cd['content'] ?? null)) {
                        foreach ($cd['content'] as $part) {
                            if (is_array($part) && is_string($part['text'] ?? null) && trim($part['text']) !== '') {
                                return trim($part['text']);
                            }
                        }
                    }
                }
            }
        }
    }
    if (is_string($json['output_text'] ?? null) && trim($json['output_text']) !== '') {
        return trim($json['output_text']);
    }
    return '';
}

/* Сохраняем сырое тело пустого ответа для разбора причины (finish_reason,
 * safety-фильтр, перекос формата). Ротируем: держим один новый и один старый файл. */
function ai_dump_empty(string $body): void
{
    $dir = __DIR__ . '/private/diag';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return;
    }
    if (is_file($dir . '/ai-empty.json')) {
        @rename($dir . '/ai-empty.json', $dir . '/ai-empty.old.json');
    }
    @file_put_contents($dir . '/ai-empty.json', $body);
}

/* Из RetryInfo.details вытаскиваем retryDelay: "41609s" или ISO-8601 "PT11H33M29.9S". */
function ai_quota_delay(array $json): ?int
{
    $details = $json['error']['details'] ?? null;
    if (!is_array($details)) {
        return null;
    }
    foreach ($details as $d) {
        if (!is_array($d)) {
            continue;
        }
        $v = $d['retryDelay'] ?? '';
        if (!is_string($v)) {
            continue;
        }
        if (preg_match('/^(\d+)(?:\.[\d]+)?s$/', $v, $m)) {
            return (int) $m[1];
        }
        if (preg_match('/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/', $v, $m)) {
            return (int) (((float) ($m[1] ?? 0) * 3600) + ((float) ($m[2] ?? 0) * 60) + (float) ($m[3] ?? 0));
        }
    }
    return null;
}

function ai_human_seconds(int $seconds): string
{
    if ($seconds < 60) {
        return $seconds . ' с';
    }
    $h = intdiv($seconds, 3600);
    $m = intdiv($seconds % 3600, 60);
    if ($h > 0) {
        return $h . ' ч ' . ($m > 0 ? $m . ' мин' : '');
    }
    return $m . ' мин';
}

function ai_chat(array $cfg, array $messages, int $maxTokens = 4096): string
{
    $attempts = [
        ['max_tokens' => $maxTokens, 'temperature' => 0.2],
        [],
    ];
    $last = null;
    foreach ($attempts as $extra) {
        for ($pass = 0; $pass < 2; $pass++) { // попытка с обычным и «мягким» SSL
            try {
                return ai_chat_once($cfg, $messages, $extra, $pass === 1);
            } catch (AiQuotaExhausted $e) {
                throw $e; // квота кончилась — не поможет ни формат, ни SSL
            } catch (RuntimeException $e) {
                $last = $e;
            }
        }
    }
    throw $last ?? new RuntimeException('ИИ-провайдер не ответил');
}

function parse_ai_labels(string $content, array $expectedIds): array
{
    $t = trim($content);
    if (preg_match('/```(?:json)?\s*(.+?)\s*```/s', $t, $m)) {
        $t = $m[1];
    }
    $data = json_decode($t, true);
    if (!is_array($data) && preg_match('/\{.*\}/s', $t, $m2)) {
        $data = json_decode($m2[0], true);
    }
    $out = [];
    if (is_array($data) && isset($data['labels']) && is_array($data['labels'])) {
        foreach ($data['labels'] as $id => $label) {
            if (is_string($label) && in_array((string) $id, $expectedIds, true)) {
                $out[(string) $id] = $label;
            }
        }
    }
    return $out;
}

function u_len(string $s): int
{
    return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : strlen($s);
}

/* Нижний регистр без mbstring: штатная функция есть не на всех хостингах.
 * Фолбэк строит регистр вручную для кириллицы (strtolower её не трогает). */
function u_lower(string $s): string
{
    if (function_exists('mb_strtolower')) {
        return mb_strtolower($s, 'UTF-8');
    }
    $s = strtolower($s);
    return strtr($s, [
        'А' => 'а', 'Б' => 'б', 'В' => 'в', 'Г' => 'г', 'Д' => 'д', 'Е' => 'е',
        'Ё' => 'ё', 'Ж' => 'ж', 'З' => 'з', 'И' => 'и', 'Й' => 'й', 'К' => 'к',
        'Л' => 'л', 'М' => 'м', 'Н' => 'н', 'О' => 'о', 'П' => 'п', 'Р' => 'р',
        'С' => 'с', 'Т' => 'т', 'У' => 'у', 'Ф' => 'ф', 'Х' => 'х', 'Ц' => 'ц',
        'Ч' => 'ч', 'Ш' => 'ш', 'Щ' => 'щ', 'Ъ' => 'ъ', 'Ы' => 'ы', 'Ь' => 'ь',
        'Э' => 'э', 'Ю' => 'ю', 'Я' => 'я',
    ]);
}

/* Короткая тема -> набор значимых слов. */
function label_tokens(string $label): array
{
    $t = u_lower($label);
    $t = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $t) ?? $t;
    $words = preg_split('/\s+/u', trim($t)) ?: [];
    $words = array_filter($words, function (string $w): bool {
        return u_len($w) >= 3 && preg_match('/^[0-9]+$/', $w) !== 1;
    });
    return array_values(array_unique($words));
}

function token_overlap(array $a, array $b): float
{
    if ($a === [] || $b === []) {
        return 0.0;
    }
    $inter = count(array_intersect($a, $b));
    $union = count($a) + count($b) - $inter;
    return $union > 0 ? $inter / $union : 0.0;
}

/* Самая частая тема в стопке. */
function pick_label(array $counts): string
{
    $best = '';
    $bestN = -1;
    foreach ($counts as $label => $n) {
        if ($n > $bestN || ($n === $bestN && ($best === '' || strcmp($label, $best) < 0))) {
            $best = $label;
            $bestN = $n;
        }
    }
    return $best === '' ? 'без названия' : $best;
}

/* Строит стопки: возвращает [groups, photos]. Годится для любых OpenAI-моделей. */
function build_stacks(array $s, array $cfg): array
{
    $photos = fetch_all_photos($s);
    $total = count($photos);
    if ($total === 0) {
        return [[], $photos];
    }

    // Составляем пакеты изображений. Для качества берём чуть более крупные
    // размеры на небольших альбомах, на больших — быстрые миниатюры.
    $batch = [];
    $idToKey = [];
    $photoByKey = [];
    $keysWithUrl = [];
    foreach ($photos as $index => $photo) {
        $key = $photo['ownerId'] . '_' . $photo['id'];
        $url = $total <= 500
            ? ($photo['displayUrl'] ?? $photo['thumbnailUrl'])
            : ($photo['thumbnailUrl'] ?? $photo['displayUrl']);
        if (!$url) {
            continue;
        }
        $idToKey[(string) $photo['id']] = $key;
        $photoByKey[$key] = $index;
        $keysWithUrl[] = $key;
        $batch[] = ['key' => $key, 'id' => (int) $photo['id'], 'url' => $url];
    }

    $system = 'Ты помогаешь разложить фотографии по стопкам похожих. '
        . 'Тебе дадут изображения и их идентификаторы по порядку. Для КАЖДОГО идентификатора придумай '
        . 'короткую тему из 1–4 слов (например: «пляж закат», «рыжий кот», «скриншот чата», «мем с котом»). '
        . 'Одинаковые по содержанию фото получают одинаковую или почти одинаковую тему. '
        . 'Ответь ТОЛЬКО валидным JSON без оформления: {"labels":{"<id>":"тема",...}} Никаких пояснений.';

    $labelByKey = [];
    for ($i = 0, $n = count($batch); $i < $n; $i += $cfg['batch']) {
        $part = array_slice($batch, $i, $cfg['batch']);
        $ids = array_map(fn (array $p): int => $p['id'], $part);
        $idsText = implode(', ', $ids);
        $content = [[
            'type' => 'text',
            'text' => 'Идентификаторы изображений по порядку: ' . $idsText
                . '. Определи тему каждого, верни JSON {"labels":{...}}.',
        ]];
        foreach ($part as $p) {
            $dataUri = image_data_uri($p['url']);
            if ($dataUri === null) {
                continue;
            }
            $content[] = ['type' => 'image_url', 'image_url' => ['url' => $dataUri]];
        }
        if (count($content) === 1) {
            throw new RuntimeException('Не удалось скачать ни одной миниатюры VK для пакета #' . $i);
        }
        $messages = [
            ['role' => 'system', 'content' => $system],
            ['role' => 'user', 'content' => $content],
        ];

        $maxTokens = max(4096, min(8192, count($ids) * 24 + 512));
        $labels = [];
        $lastError = null;
        for ($attempt = 0; $attempt < 3 && $labels === []; $attempt++) {
            try {
                $labels = parse_ai_labels(ai_chat($cfg, $messages, $maxTokens), array_map('strval', $ids));
            } catch (Throwable $e) {
                if ($e instanceof AiQuotaExhausted) {
                    throw $e; // квота не освободится через полсекунды — не дёргаем провайдера
                }
                $lastError = $e;
                usleep(500_000 * ($attempt + 1));
            }
        }
        if ($labels === []) {
            throw $lastError ?? new RuntimeException('ИИ не вернул темы для пакета');
        }
        foreach ($labels as $id => $label) {
            $key = $idToKey[$id] ?? null;
            if ($key !== null) {
                $labelByKey[$key] = $label;
            }
        }
    }

    // Склейка в стопки: похожие темы (>34% общих слов) накапливаем в одну кучу.
    $clusters = [];
    foreach ($labelByKey as $key => $label) {
        $tokens = label_tokens($label);
        $best = -1;
        $bestScore = 0.0;
        foreach ($clusters as $ci => $cluster) {
            $score = token_overlap($tokens, $cluster['tokens']);
            if ($score > 0.34 && $score > $bestScore) {
                $best = $ci;
                $bestScore = $score;
            }
        }
        if ($best >= 0) {
            $clusters[$best]['tokens'] = array_values(array_unique(array_merge($clusters[$best]['tokens'], $tokens)));
            $clusters[$best]['labels'][$label] = ($clusters[$best]['labels'][$label] ?? 0) + 1;
            $clusters[$best]['photos'][] = $key;
        } else {
            $clusters[] = ['tokens' => $tokens, 'labels' => [$label => 1], 'photos' => [$key]];
        }
    }

    $groups = [];
    $gid = 0;
    foreach ($clusters as $cluster) {
        $gid++;
        $keys = $cluster['photos'];
        $cover = [];
        foreach (array_slice($keys, 0, 3) as $key) {
            $thumb = $photos[$photoByKey[$key]]['thumbnailUrl'] ?? null;
            if ($thumb) {
                $cover[] = $thumb;
            }
        }
        $groups[] = [
            'gid'    => 's' . $gid,
            'label'  => pick_label($cluster['labels']),
            'count'  => count($keys),
            'cover'  => $cover,
            'photos' => array_map(function (string $key): array {
                [$own, $id] = explode('_', $key, 2);
                return ['ownerId' => (int) $own, 'id' => (int) $id];
            }, $keys),
        ];
    }
    usort($groups, fn (array $a, array $b): int => $b['count'] <=> $a['count'] ?: strcmp($a['label'], $b['label']));
    unset($keysWithUrl, $idToKey);

    return [$groups, $photos];
}

function ai_public(array $cache): array
{
    if (isset($cache['public']) && is_array($cache['public'])) {
        return $cache['public'];
    }
    return [
        'configured' => true,
        'built'      => (int) ($cache['built'] ?? 0),
        'total'      => (int) ($cache['total'] ?? 0),
        'groups'     => array_map(fn (array $g): array => [
            'gid'   => (string) $g['gid'],
            'label' => (string) $g['label'],
            'count' => (int) $g['count'],
            'cover' => $g['cover'] ?? [],
        ], $cache['groups'] ?? []),
    ];
}

function action_stacks(array $s): void
{
    require_auth();
    $cfg = ai_config($s);
    if (!$cfg['ready']) {
        fail(503, 'AI_NOT_CONFIGURED',
            'ИИ не настроен: впишите ключ (ai_api_key), базовый URL (ai_base_url) и модель (ai_model) в private/secrets.php. '
            . 'Бесплатные модели — на freellm.net (например, Gemini AI Studio).');
    }
    if (ai_dir() === null) {
        fail(503, 'AI_CACHE_UNAVAILABLE', 'Недоступна папка для кэша ИИ');
    }

    $userKey = ai_user_key($s);
    $refresh = ($_GET['refresh'] ?? '') === '1';
    $cache = ai_read_cache($userKey);
    $fresh = $cache !== null && (time() - (int) $cache['built']) < AI_CACHE_TTL_SECONDS;
    if (!$refresh && $fresh) {
        json_out(ai_public($cache));
    }

    // Пока один запрос собирает стопки, второй ждёт — не множим тяжёлые сборки.
    $lockPath = ai_dir() . '/build-' . $userKey . '.lock';
    $lock = @fopen($lockPath, 'c+');
    if ($lock !== false && !flock($lock, LOCK_EX | LOCK_NB)) {
        fclose($lock);
        if ($cache !== null) {
            json_out(ai_public($cache)); // сборка уже идёт, отдаём прошлый результат
        }
        fail(503, 'AI_BUILDING', 'Стопки уже собираются, попробуйте через минуту');
    }
    try {
        if (function_exists('set_time_limit')) {
            @set_time_limit(900);
        }
        [$groups, $photos] = build_stacks($s, $cfg);
    } catch (Throwable $e) {
        log_error('stacks', $e);
        fail(502, 'AI_FAILED', 'ИИ не смог собрать стопки: ' . $e->getMessage());
    } finally {
        if ($lock !== false) {
            fclose($lock);
        }
    }

    $now = time();
    $public = [
        'configured' => true,
        'built'      => $now,
        'total'      => count($photos),
        'groups'     => array_map(fn (array $g): array => [
            'gid'   => $g['gid'],
            'label' => $g['label'],
            'count' => $g['count'],
            'cover' => $g['cover'],
        ], $groups),
    ];
    $cacheData = [
        'built'  => $now,
        'total'  => count($photos),
        'groups' => $groups,
        'public' => $public,
    ];
    ai_write_json(ai_cache_path($userKey), $cacheData);
    ai_write_json(ai_snapshot_path($userKey), ['built' => $now, 'total' => count($photos), 'photos' => $photos]);
    json_out($public);
}

function action_stack_photos(array $s): void
{
    require_auth();
    $gid = (string) ($_GET['gid'] ?? '');
    if ($gid === '') {
        fail(400, 'VALIDATION_FAILED', 'Не указана стопка (gid)');
    }
    $userKey = ai_user_key($s);
    $cache = ai_read_cache($userKey);
    if ($cache === null) {
        fail(404, 'AI_NO_STACKS', 'Стопки ещё не собраны — нажмите кнопку «Стопки»');
    }
    $group = null;
    foreach ($cache['groups'] as $g) {
        if ($g['gid'] === $gid) {
            $group = $g;
            break;
        }
    }
    if ($group === null) {
        fail(404, 'AI_NO_GROUP', 'Стопка не найдена');
    }

    $snapshotPath = ai_snapshot_path($userKey);
    $snapshot = is_file($snapshotPath) ? json_decode((string) file_get_contents($snapshotPath), true) : null;
    $photos = is_array($snapshot) && isset($snapshot['photos']) && is_array($snapshot['photos'])
        ? $snapshot['photos']
        : [];

    $items = [];
    foreach ($group['photos'] as $ref) {
        foreach ($photos as $photo) {
            if ((int) $photo['id'] === (int) $ref['id'] && (int) $photo['ownerId'] === (int) $ref['ownerId']) {
                $items[] = $photo;
                break;
            }
        }
    }
    json_out(['label' => $group['label'], 'count' => $group['count'], 'items' => $items]);
}

/* ---------------------------------------------------------------- static assets */

/*
 * Отдаём собранные assets/app-*.js|css через PHP, а не статикой.
 * Причина: в Яндекс.Браузере прямой запрос к статическому ./assets/app-*.js
 * может «зависать» (ни ответа, ни ошибки), тогда как ответ PHP с корректными
 * заголовками и gzip отдаётся нормально. Явно задаём Content-Length,
 * Content-Type, gzip и запрещаем любую «трансформацию» ответа.
 */
function action_asset(): never
{
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) {
        ob_end_clean();
    }

    $name = (string) ($_GET['f'] ?? '');
    if (preg_match('/^app-[A-Za-z0-9._-]+\.(js|css)$/', $name) !== 1) {
        fail(400, 'BAD_ASSET', 'Недопустимое имя файла');
    }

    $assetsDir = realpath(__DIR__ . '/assets');
    $real = realpath(__DIR__ . '/assets/' . $name);
    if ($assetsDir === false || $real === false || strpos($real, $assetsDir . DIRECTORY_SEPARATOR) !== 0 || !is_file($real)) {
        fail(404, 'ASSET_NOT_FOUND', 'Файл не найден');
    }

    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    $contentType = $ext === 'css'
        ? 'text/css; charset=utf-8'
        : 'application/javascript; charset=utf-8';

    $body = (string) file_get_contents($real);
    $etag = '"' . sha1_file($real) . '"';

    header('Content-Type: ' . $contentType);
    header('Cache-Control: public, max-age=31536000, immutable, no-transform');
    header('X-Content-Type-Options: nosniff');
    header('Vary: Accept-Encoding');
    header('ETag: ' . $etag);
    header('Accept-Ranges: bytes');

    if (trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
        http_response_code(304);
        exit;
    }

    /* Range-запросы: отдаём маленькие куски raw-байтов БЕЗ gzip.
     * В Яндекс.Браузере большие ответы «зависают» после заголовков
     * (0 байт тела даже при верном Content-Length), а вот куски ~8 КБ
     * доезжают нормально — загрузчик собирает бандл диапазонами. */
    $range = trim((string) ($_SERVER['HTTP_RANGE'] ?? ''));
    if ($range !== '' && preg_match('/^bytes=(\d*)-(\d*)$/', $range, $m)) {
        $len = strlen($body);
        $startTxt = $m[1];
        $endTxt = $m[2];
        if ($startTxt === '' && $endTxt === '') {
            fail(416, 'RANGE_INVALID', 'Недопустимый диапазон');
        }
        if ($startTxt === '') {
            $suffix = (int) $endTxt;
            if ($suffix <= 0) {
                fail(416, 'RANGE_INVALID', 'Недопустимый диапазон');
            }
            $start = max(0, $len - $suffix);
            $end = $len - 1;
        } else {
            $start = (int) $startTxt;
            $end = $endTxt === '' ? $len - 1 : (int) $endTxt;
            $end = min($end, $len - 1);
        }
        if ($start > $len - 1) {
            header('Content-Range: bytes */' . $len);
            http_response_code(416);
            exit;
        }
        if ($start > $end) {
            $end = $start;
        }
        $partLen = $end - $start + 1;

        http_response_code(206);
        header('Content-Range: bytes ' . $start . '-' . $end . '/' . $len);
        header('Content-Length: ' . $partLen);
        echo substr($body, $start, $partLen);
        exit;
    }

    $acceptsGzip = stripos((string) ($_SERVER['HTTP_ACCEPT_ENCODING'] ?? ''), 'gzip') !== false;
    if ($acceptsGzip && function_exists('gzencode')) {
        $cacheDir = __DIR__ . '/private/asset-cache';
        $gzPath = $cacheDir . '/' . $name . '.gz';
        if (!is_file($gzPath)) {
            if (!is_dir($cacheDir) && !@mkdir($cacheDir, 0775, true) && !is_dir($cacheDir)) {
                // не смогли подготовить кэш — отдадим как есть
            } else {
                @file_put_contents($gzPath, gzencode($body, 9), LOCK_EX);
            }
        }
        if (is_file($gzPath)) {
            $body = (string) file_get_contents($gzPath);
            header('Content-Encoding: gzip');
        }
    }

    header('Content-Length: ' . strlen($body));
    echo $body;
    exit;
}

/* ---------------------------------------------------------------- diagnostics */

/*
 * Приём диагностики от загрузчика (User-Agent, лог, Resource Timing).
 * Файлы пишутся в private/diag/ (закрыт .htaccess). Нужен, чтобы понять,
 * что именно происходит в Яндекс.Браузере, без DevTools на стороне клиента.
 */
function action_diag(): never
{
    $raw = (string) file_get_contents('php://input');
    if (strlen($raw) > 262144) {
        $raw = substr($raw, 0, 262144);
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        $data = ['raw' => $raw];
    }
    $data['_server'] = [
        'time'            => date('c'),
        'ip'              => $_SERVER['REMOTE_ADDR'] ?? null,
        'user_agent'      => $_SERVER['HTTP_USER_AGENT'] ?? null,
        'accept_encoding' => $_SERVER['HTTP_ACCEPT_ENCODING'] ?? null,
        'http_version'    => $_SERVER['SERVER_PROTOCOL'] ?? null,
    ];

    $dir = __DIR__ . '/private/diag';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        json_out(['ok' => false, 'error' => 'no_dir']);
    }
    $file = date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.json';
    @file_put_contents(
        $dir . '/' . $file,
        json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT),
        LOCK_EX,
    );
    json_out(['ok' => true, 'file' => $file]);
}

/* ---------------------------------------------------------------- router */

$secrets = load_secrets();
$action = $_GET['action'] ?? 'session';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    json_out([]);
}

try {
    switch ($action) {
        case 'asset':
            action_asset();
        case 'diag':
            action_diag();
        case 'session':
            action_session($secrets);
        case 'login':
            action_login($secrets);
        case 'logout':
            action_logout();
        case 'photos':
            action_photos($secrets);
        case 'stacks':
            action_stacks($secrets);
        case 'stack_photos':
            action_stack_photos($secrets);
        default:
            fail(404, 'UNKNOWN_ACTION', 'Неизвестное действие');
    }
} catch (Throwable $e) {
    log_error($action, $e);
    fail(500, 'INTERNAL', 'Внутренняя ошибка сервера');
}

/* Диагностика: падение кладём в private/diag/errors.log, чтобы не выводить
 * технические детали пользователю, но иметь их у себя. Файл ротируется. */
function log_error(string $logAction, Throwable $e): void
{
    $dir = __DIR__ . '/private/diag';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return;
    }
    $entry = json_encode([
        'time'    => date('c'),
        'action'  => $logAction,
        'class'   => get_class($e),
        'message' => $e->getMessage(),
        'file'    => $e->getFile(),
        'line'    => $e->getLine(),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    $path = $dir . '/errors.log';
    if (is_file($path) && filesize($path) > 1048576) {
        @rename($path, $dir . '/errors.old.log');
    }
    @file_put_contents($path, $entry, LOCK_EX | FILE_APPEND);
}
