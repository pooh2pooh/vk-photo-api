<?php
declare(strict_types=1);

// Генерирует хэш пароля для private/secrets.php
// Использование: php scripts/make-hash.php <пароль>

$pass = $argv[1] ?? '';
if ($pass === '') {
    fwrite(STDERR, "Usage: php scripts/make-hash.php <password>\n");
    exit(1);
}
echo password_hash($pass, PASSWORD_DEFAULT, ['cost' => 12]), "\n";