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
        default:
            fail(404, 'UNKNOWN_ACTION', 'Неизвестное действие');
    }
} catch (Throwable $e) {
    fail(500, 'INTERNAL', 'Внутренняя ошибка сервера');
}