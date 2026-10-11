<?php
/*
 * СЕКРЕТЫ. НЕ ДЕЛИСЬ ЭТИМ ФАЙЛОМ И НЕ КОММИТЬ ЕГО.
 * Заполни своими значениями и сохрани как private/secrets.php
 * (сам файл secrets.php добавлен в .gitignore, private/ закрыт .htaccess).
 *
 * Быстрые варианты настройки:
 *   1) скопируй этот файл в secrets.php и заполни ниже;
 *   2) или задай переменные окружения VK_PHOTO_TOKEN / VK_PHOTO_USER / VK_PHOTO_PASSWORD
 *      (например через Apache SetEnv) — они имеют приоритет.
 */

return [
    // Имя пользователя для входа в галерею.
    'username' => 'admin',

    // ХЭШ пароля. НЕ храни пароль открытым текстом — сгенерируй хэш:
    //   php scripts/make-hash.php <пароль>
    // и вставь результат ниже.
    'password_hash' => '',

    // Персональный user-токен ВКонтакте (scope photos). Токен сообщества не подойдёт.
    'vk_token' => '',

    // ИИ для «стопок» похожих фото (опционально). Бесплатные модели —
    // каталог https://freellm.net/. По умолчанию — Gemini (AI Studio).
    // Отправка картинок: OpenAI-совместимый /chat/completions.
    //   'ai_api_key'    => '',
    //   'ai_base_url'   => 'https://generativelanguage.googleapis.com/v1beta/openai',
    //   'ai_model'      => 'gemini-2.5-flash',

    // Настройки (опционально):
    'api_version' => '5.199',
    // 'owner_id'  => '',           // пусто = владелец токена
    // 'timeout'   => 15,           // таймаут запроса к VK, сек
    // 'vk_base'   => 'https://api.vk.com/method', // только для тестов/локального мока
];