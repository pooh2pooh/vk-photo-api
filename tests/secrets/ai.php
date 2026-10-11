<?php
// Фикстура секретов для e2e-тестов: ИИ через mock-ai на :1310.
return [
    'username' => 'demo',
    'password_hash' => '$2y$12$2iNxqKfCkqAE0UglxeAmf.N/dpoZREJtyTx9XyO4Y6jpqgmM17YnO',
    'vk_token' => 'mock_dummy_token',
    'vk_base' => 'http://127.0.0.1:9310/method',
    'ai_api_key' => 'mock_ai_key',
    'ai_base_url' => 'http://127.0.0.1:1310/v1',
    'ai_model' => 'mock-model',
];
