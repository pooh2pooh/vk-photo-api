# Тесты

E2E-тесты и локальные моки внешних сервисов (см. `docs/DEVELOPMENT.md` §11).
Браузерные сценарии поднимают headless Chrome через CDP, PHP-сервер и моки,
поэтому проверяют реальное поведение приложения, а не внутренности.

## Требования

- `php` в `PATH`;
- `google-chrome-stable` / `google-chrome` / `chromium` (или переменная `CHROME_BIN`);
- Node.js ≥ 20.

## Запуск

```bash
npm test              # все сценарии
npm run test:shell    # только тесты загрузчика (без браузера, быстро)
npm run test:e2e      # только браузерные сценарии
node tests/run.mjs stacks-ai fallback-noai   # выборочно по имени
node tests/run.mjs --list                    # список сценариев
```

## Сценарии

| Имя | Файл | Что проверяет |
| --- | ---- | ------------- |
| `shell` | `e2e/test-shell.cjs` | 24 проверки shell-загрузчика (без браузера) |
| `base` | `e2e/cdp-test.cjs` | вход, галерея, пагинация |
| `features` | `e2e/cdp-test-features.cjs` | фичи UI + выход |
| `menu` | `e2e/cdp-test-menu.cjs` | мобильное меню «три точки» |
| `bad` | `e2e/cdp-test-bad.cjs` | обработка ошибок VK (мок: пустые ответы после offset 100) |
| `fallback-noai` | `e2e/cdp-test-fallback.cjs` | стопки без ИИ (фоллбэк по дате) |
| `quota` | `e2e/cdp-test-fallback.cjs` | `429`/квота → фоллбэк, провайдер вызван один раз |
| `stacks-ai` | `e2e/cdp-test-stacks.cjs` | стопки с ИИ (mock-ai) |

## Как это устроено

- `mocks/` — локальные моки внешних сервисов:
  - `mock-vk.cjs` (`:9310`) — VK `photos.get`, режим `MOCK_MODE=normal|emptylater`;
  - `mock-ai.cjs` (`:1310`) — OpenAI-совместимый `/chat/completions`;
  - `mock-quota.cjs` (`:1313`) — всегда `429 RESOURCE_EXHAUSTED`;
  - `mock-alt.cjs`, `mock-empty.cjs` — альтернативные/пустые ответы ИИ.
- `secrets/` — фикстуры `private/secrets.php` для каждого сценария. Раннер
  временно копирует нужную в `private/secrets.php`, а исходный файл
  восстанавливает после прогона.
- `run.mjs` — оркестратор: гасит порты, поднимает моки, PHP и Chrome,
  прогоняет сценарии, собирает результат и всё останавливает.

Изоляция сценариев:
- каждый браузерный сценарий получает **свежий Chrome со своим профилем**
  (иначе между сценариями протекают `localStorage` и эмуляция mobile-вьюпорта);
- перед каждым сценарием чистится серверный кэш: `private/ai-cache/` и
  `private/cache/*.json` (иначе сборка стопок из одного сценария
  переиспользуется в другом и моки ИИ не вызываются);
- VK-мок перезапускается при смене `MOCK_MODE` (сценарий `bad` — `emptylater`).

Порты: php `8090`, CDP `9222`, VK `9310`, ai `1310`, quota `1313`.
Временные файлы — в `tests/.tmp/` (в `.gitignore`).
