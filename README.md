# VK Saved Photos

Веб-интерфейс для просмотра и управления фотографиями из альбома «Сохранённые фото» ВКонтакте.
TypeScript, чистая архитектура, задел под поэтапное масштабирование до ИИ-поиска.

## Этап 1 (текущий): галерея с пагинацией

- Бэкенд: Fastify + чистая архитектура (domain / application / infrastructure / presentation).
- Клиент VK API: таймауты, ретраи с экспоненциальным backoff и jitter, маппинг ошибок VK.
- Фронтенд: React + Vite + TanStack Query, адаптивная сетка, ленивая загрузка изображений,
  skeleton-загрузка, lightbox, пагинация с сохранением предыдущих данных.

## Требования

- Node.js >= 20
- Access token ВКонтакте со scope `photos`
  (токен личного профиля для альбома «Сохранённые фото»)

## Настройка

```bash
npm install
cp .env.example .env
# открой .env и вставь свой VK_TOKEN
```

`.env`:

```dotenv
VK_TOKEN=ваш_токен
VK_API_VERSION=5.199
VK_ALBUM_ID=saved      # "saved" = Сохранённые фото
VK_OWNER_ID=           # пусто = владелец токена
PORT=3001
VK_TIMEOUT_MS=10000
VK_RETRY_ATTEMPTS=3
```

> Токен используется только на сервере и никогда не передаётся в браузер.

## Запуск

```bash
npm run dev        # server (http://localhost:3001) + web (http://localhost:5173)
```

Открой http://localhost:5173 — Vite проксирует `/api` на бэкенд.

Продакшн:

```bash
npm run build
npm start          # отдаёт API на PORT; статику web/ собирай отдельно (web/dist)
```

## API

| Метод | Путь | Описание |
| ----- | ---- | -------- |
| `GET` | `/api/health` | Состояние сервиса |
| `GET` | `/api/photos?offset=0&count=30` | Страница фото альбома |

Ответ `/api/photos`:

```json
{
  "total": 1234,
  "offset": 0,
  "count": 30,
  "hasMore": true,
  "items": [
    {
      "id": 457239024,
      "ownerId": 743784474,
      "albumId": -15,
      "width": 1080,
      "height": 720,
      "text": "",
      "date": 1673516629,
      "thumbnailUrl": "https://.../photo.jpg",
      "displayUrl": "https://.../photo.jpg"
    }
  ]
}
```

Ошибки имеют единый формат:

```json
{ "error": { "code": "VK_RATE_LIMITED", "message": "..." } }
```

## Архитектура

```
server/src/
├─ domain/          # сущности и ошибки, без внешних зависимостей
│  ├─ photo.ts
│  ├─ pagination.ts
│  └─ errors.ts
├─ application/     # сценарии + порты (интерфейсы)
│  ├─ ports/VkGateway.ts
│  └─ usecases/GetAlbumPhotos.ts
├─ infrastructure/  # адаптеры: VK HTTP, retry
│  ├─ retry.ts
│  └─ vk/{VkHttpClient,VkPhotoGateway}.ts
└─ presentation/    # HTTP-слой (Fastify)
   └─ http/{server,dto,routes/*}.ts

web/src/
├─ api/             # типизированный клиент
├─ hooks/           # usePhotos (TanStack Query)
└─ components/      # Gallery, PhotoCard, Pagination, Lightbox
```

Зависимости направлены внутрь: `presentation → application → domain`,
а инфраструктура подключается через порты на этапе композиции (`server/src/index.ts`).
Замена источника данных или добавление кэша не затрагивает домен и сценарии.

## План масштабирования

- **Этап 2 — кэш и устойчивость.** SQLite для метаданных, кэш миниатюр (`sharp`),
  инкрементальная синхронизация альбома, SSE/фоновые задачи.
- **Этап 3 — ИИ-поиск.** CLIP-эмбеддинги (`@huggingface/transformers`, ONNX, CPU),
  векторный индекс (`sqlite-vec` / pgvector), семантический поиск текстом.
- **Этап 4 — управление.** Удаление/копирование фото в ВК, фильтры, теги, авторизация.

## Скрипты

| Команда | Действие |
| ------- | -------- |
| `npm run dev` | Запуск сервера и фронтенда |
| `npm run build` | Сборка обоих пакетов |
| `npm run typecheck` | Проверка типов |
| `npm start` | Запуск собранного сервера |
