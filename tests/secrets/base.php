<?php
// Фикстура секретов для e2e-тестов: без ИИ (режим фоллбэка).
// Копируется в private/secrets.php раннером tests/run.mjs.
return [
    'username' => 'demo',
    'password_hash' => '$2y$12$2iNxqKfCkqAE0UglxeAmf.N/dpoZREJtyTx9XyO4Y6jpqgmM17YnO',
    'vk_token' => 'mock_dummy_token',
    'vk_base' => 'http://127.0.0.1:9310/method',
];
