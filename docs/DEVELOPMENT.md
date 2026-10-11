# Стандарт разработки проектов

Практический стандарт для новых веб-проектов, обобщающий решения и грабли
реального проекта [`vk-photo-api`](../README.md) — SPA (React + Vite) с
однофайловым PHP-бэкендом, работающего из любой поддиректории Apache и
защищённого от «вечной загрузки» в Яндекс.Браузере.

Документ — это **не теория**, а набор воспроизводимых рецептов: что делать,
какие таймауты ставить, как именовать, где какие подводные камни. Примеры кода
взяты из живого проекта и служат эталоном стиля.

Стек, под который заточены примеры:

- **Фронтенд:** React 18 + TypeScript (strict) + Vite 5 + `@tanstack/react-query`;
- **Бэкенд:** PHP ≥ 8.0 (`declare(strict_types=1)`), один `api.php`, Apache;
- **Доставка:** статика из корня репозитория + кастомный «shell»-загрузчик;
- **CDN-зеркала:** jsDelivr (через `git push`), CORS-прокси как резерв.

Принципы переносимы на другие стеки, но привязка к PHP/React/Vite сохранена
сознательно — так документ остаётся конкретным.

## Содержание

- [0. Чек-листы (TL;DR)](#0-чек-листы-tldr)
- [1. Архитектура и структура проекта](#1-архитектура-и-структура-проекта)
- [2. Внешний вид, дизайн, UX](#2-внешний-вид-дизайн-ux)
- [3. Отказоустойчивая загрузка ресурсов](#3-отказоустойчивая-загрузка-ресурсов)
- [4. Терминальный лог для отладки](#4-терминальный-лог-для-отладки)
- [5. Диагностика `/diag`](#5-диагностика-diag)
- [6. Безопасность](#6-безопасность)
- [7. Кэширование, блокировки, внешние API](#7-кэширование-блокировки-внешние-api)
- [8. Контракт API и коды ошибок](#8-контракт-api-и-коды-ошибок)
- [9. Конфигурация и окружение](#9-конфигурация-и-окружение)
- [10. Сборка и релиз](#10-сборка-и-релиз)
- [11. Тестирование](#11-тестирование)
- [12. Наблюдаемость](#12-наблюдаемость)
- [13. Производительность](#13-производительность)
- [14. Совместимость браузеров](#14-совместимость-браузеров)
- [15. Приложения: рабочие чек-листы](#15-приложения-рабочие-чек-листы)

---

## 0. Чек-листы (TL;DR)

**Пятнадцать непреложных правил.** Если сомневаешься — делай так.

1. **Ни одна загрузка не остаётся без дедлайна.** У каждого сетевого ресурса —
   таймаут (на заголовки и отдельно на тело). «Вечная загрузка» — это баг.
2. **Основной бандл не прописан тегом `<script src>`** в HTML — его грузит
   shell-загрузчик сам (см. §3).
3. **Любой JSON-ответ — через единый конверт** `{error:{code,message,details}}`
   и единую функцию вывода (`json_out`/`fail`).
4. **Внутренние детали логируем — наружу отдаём обобщённо.** Никогда не
   интерполируй `$e->getMessage()` в ответ клиенту.
5. **Секреты — вне webroot, права `0600`/`0700`, в `.gitignore`.** Проверяй
   `git ls-files`, что они не закоммичены.
6. **Сессия: `HttpOnly` + `SameSite=Lax` + `Secure` (при HTTPS)**, регенерация id
   при входе, `session_write_close()` перед долгими вызовами.
7. **Любой вызов внешнего API — через троттл** (файл-замок), соблюдая лимиты.
8. **Тяжёлую работу защищаем `flock(LOCK_EX|LOCK_NB)`** и отдаём прошлый
   результат вместо дублирования.
9. **Не перезаписывай валидный кэш битым результатом.** `json_encode` с
   `JSON_INVALID_UTF8_SUBSTITUTE`; пустая запись = промах кэша.
10. **Внешние расширения — только через `function_exists`** (mbstring, curl,
    gzencode) с полифиллами; никаких жёстких зависимостей.
11. **Деградация вместо падения:** нет ключа / квота / провайдер недоступен →
    полезный фоллбэк + человекочитаемое пояснение.
12. **Дизайн-токены — единственный источник** цвета/тени; иконки — единый
    outline-набор; у каждого элемента все состояния (hover/active/focus/
    disabled/loading/empty/error).
13. **Доступность обязательна:** `aria-label` у иконок, `prefers-reduced-motion`,
    видимый фокус, focus-trap в модалках.
14. **Сборка — единая точка.** После `build` обязательно push ассетов, иначе
    CDN-зеркала отдадут 404.
15. **После задачи — typecheck + прогон e2e-сценариев.** Не коммить «на глазок».

### Перед релизом (краткий чек-лист)

- [ ] `npm run typecheck` — чисто.
- [ ] `npm run build` (web + shell + icons) — без ошибок, старые ассеты удалены.
- [ ] Прогнаны e2e-сценарии (успех, ошибка, пусто, медленно, мобильный viewport).
- [ ] Новые `assets/app-<hash>.js|css` **запушены**; CDN отдаёт `200`.
- [ ] `git status` чистый; секреты и кэши не в индексе.
- [ ] Проверены заголовки безопасности и отсутствие утечек в ответах.
- [ ] Обновлены `README` и `docs/`, если менялось поведение/контракт.

---

## 1. Архитектура и структура проекта

### 1.1 Слои

Проект делится на четыре независимых слоя. Разделение снижает связанность и
позволяет каждому слою падать отдельно:

| Слой | Где | Ответственность |
| ---- | --- | --------------- |
| **Shell** (загрузчик) | `web/shell-runtime.js` → встраивается в `index.html` | доставка SPA, оверлей загрузки, терминальный лог, диагностика |
| **SPA** | `web/src/**` | UI, состояние, кэш на клиенте |
| **API** | `api.php` | авторизация, прокси к внешнему API, кэш, отдача ассетов |
| **Сборка** | `scripts/**` | пост-обработка Vite, иконки, зеркала |

Ключевая идея: **Shell не зависит от SPA**, а SPA не знает, как он загружен —
общение только через глобальные флаги (`window.__APP_READY__`) и API
(`window.__VK_LOADER__`).

### 1.2 Структура репозитория (эталон)

```
api.php                 # весь бэкенд: роутер, auth, прокси VK, кэш, asset, diag
index.html              # СГЕНЕРИРОВАННЫЙ shell-загрузчик (после build:shell)
shell-config.js         # СГЕНЕРИРОВАННЫЕ зеркала/прокси (после build:shell)
assets/                 # СГЕНЕРИРОВАННЫЕ js/css с хэшем в имени
.htaccess               # отключение сжатия/трансформации .js/.css
docs/
  DEVELOPMENT.md        # этот документ
private/                # секреты и кэш (закрыт .htaccess)
  secrets.example.php   #   ДОКУМЕНТАЦИЯ конфигурации (коммитится)
  secrets.php           #   реальные секреты (НЕ коммитить)
  .htaccess             #   Require all denied
  .gitignore            #   cache/ asset-cache/ diag/ ai-cache/ secrets.php
  cache/ asset-cache/ diag/ ai-cache/
scripts/
  build-shell.mjs       # пост-процесс Vite → index.html + shell-config.js
  make-icons.sh         # SVG → favicon/PNG/manifest
  make-hash.php         # генератор хэша пароля
web/                    # исходники SPA
  src/api/ components/ hooks/ icons/
  shell-runtime.js      # исходник загрузчика (встраивается при сборке)
  shell-config.js       # шаблон зеркал с плейсхолдерами %%JS_MIRRORS%%
  vite.config.ts tsconfig.json package.json
package.json            # workspace-корень + скрипты сборки
README.md
```

### 1.3 Принципы

- **Работает из любой поддиректории.** Все пути в клиенте относительные
  (`./api.php`, `./assets/...`), `vite.config.ts` → `base: "./"`. Никаких
  абсолютных `/api`.
- **Один файл-бэкенд для малых проектов.** `api.php` с роутером по
  `?action=` — просто деплоится, не требует фреймворка и composer. Когда
  появляется команда/сложная доменная логика — переходим на Node-бэкенд
  (`server/`, Fastify + zod), но контракт ошибок сохраняется тем же.
- **Сгенерированные артефакты не редактируются руками** (`index.html`,
  `shell-config.js`, `assets/*`). Их источник — шаблоны и скрипты. В шапке
  файла-генератора — комментарий об этом.
- **`declare(strict_types=1);`** первой строкой каждого PHP-файла.

---

## 2. Внешний вид, дизайн, UX

### 2.1 Дизайн-токены — единственный источник

Все цвета, поверхности, границы и тени объявляются в `:root` один раз. В
компонентах — только `var(--...)`, никаких «магических» хексов.

```css
/* web/src/styles.css */
:root {
  color-scheme: dark;
  --bg: #0f1115;
  --backdrop: #1a2030;
  --surface: #181b22;
  --surface-2: #21252e;
  --surface-3: #2c3240;
  --tile-face: #242933;
  --border: #2a2f3a;
  --edge: #0e1116;
  --text: #e7e9ee;
  --muted: #9aa3b2;
  --accent: #4c8bf5;
  --accent-strong: #2f6ae0;
  --danger: #f2555a;
  --danger-text: #ffb4b7;
  --on-accent: #fff;
  --accent-glow: rgba(76, 139, 245, 0.25);
  --accent-ring: rgba(76, 139, 245, 0.35);
  --accent-shadow: rgba(47, 106, 224, 0.4);
  --danger-bg: rgba(242, 85, 90, 0.18);
  --danger-border: rgba(242, 85, 90, 0.45);
  --highlight: rgba(255, 255, 255, 0.05);
  --highlight-strong: rgba(255, 255, 255, 0.07);
  --scrim: rgba(0, 0, 0, 0.85);
  --scrim-soft: rgba(24, 27, 34, 0.6);
  --panel-veil: rgba(33, 37, 46, 0.82);
  --menu-veil: rgba(43, 49, 60, 0.95);
  --thumb-mask: #000;
  /* Умеренный скевоморфизм: глубина панелей и «фаска» кнопок. */
  --shadow-inset: inset 0 1px 0 rgba(255, 255, 255, 0.07);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 10px rgba(0, 0, 0, 0.4), 0 12px 28px rgba(0, 0, 0, 0.35);
  --shadow-btn: 0 1px 2px rgba(0, 0, 0, 0.45);
  --shadow-btn-active: inset 0 2px 5px rgba(0, 0, 0, 0.55);
  --shadow-card: 0 8px 24px rgba(0, 0, 0, 0.4);
  --shadow-stack: 0 6px 16px rgba(0, 0, 0, 0.45);
  --shadow-pop: 0 20px 80px rgba(0, 0, 0, 0.6);
  --shadow-dialog: 0 20px 60px rgba(0, 0, 0, 0.45);
  --shadow-accent: 0 8px 24px rgba(76, 139, 245, 0.28);
  /* Скевоморфные градиенты и границы кнопок/панелей. */
  --btn-face: linear-gradient(180deg, #2b313c, #222731);
  --btn-face-hover: linear-gradient(180deg, #343b48, #272d38);
  --btn-face-active: linear-gradient(180deg, #1f242c, #262c36);
  --btn-face-flat: #2b313c;
  --btn-accent: linear-gradient(180deg, #3a6fd8, #2f5fbf);
  --btn-edge-hover: #3a4150;
  --panel-face: linear-gradient(180deg, #222731, #1c2028);
  --panel-face-menu: linear-gradient(180deg, #232833, #1a1f27);
  --panel-face-soft: linear-gradient(180deg, #1e222a, #191d24);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
```

Вне `:root` магических хексов/rgba быть не должно — только `var(--...)`. Это
проверяется грепом в ревью: ни один hex/rgba не встречается ниже блока `:root`.

**Тёмная тема — по умолчанию и единственная:** `color-scheme: dark`; синхронно
задаём `<meta name="theme-color" content="#0f1115">` и цвета в `site.webmanifest`.
Фон-подложка — мягкий радиальный градиент, не плоская заливка:

```css
body {
  background: radial-gradient(1200px 600px at 50% -10%, #1a2030 0%, var(--bg) 60%);
}
```

### 2.2 Иконки — единый outline-набор

Каждая иконка — React-компонент, который разворачивает общий `base`-объект.
Это гарантирует одинаковый стиль (обводка, `currentColor`, толщина) и
доступность по умолчанию.

```tsx
// web/src/components/icons.tsx
const base: IconProps = {
  width: 20, height: 20, viewBox: "0 0 24 24",
  fill: "none", stroke: "currentColor", strokeWidth: 1.9,
  strokeLinecap: "round", strokeLinejoin: "round",
  "aria-hidden": true, focusable: false,
};

/** Дополнительные действия (меню «три точки»). */
export function IconMore(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="5" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="19" r="1.4" />
    </svg>
  );
}
```

Правила:

- props разворачиваются **последними**, чтобы вызывающий мог переопределить
  размер/цвет: `<IconLayers width={16} height={16} />`.
- у каждой иконки — короткий JSDoc по-русски.
- иконка **всегда** сопровождается текстом: `aria-label` + `title` на кнопке
  либо `<span>`-подпись в пункте меню.

### 2.3 Умеренный скевоморфизм — воспроизводимый рецепт

Не «мыльные» градиенты и не плоский Material. Рецепт из четырёх шагов:

1. тёмный внешний бордер (темнее фона): `border: 1px solid #0e1116`;
2. вертикальный градиент «светлее сверху → темнее снизу»;
3. внутренний хайлайт сверху: `inset 0 1px 0 rgba(255,255,255,.07)`;
4. на `:active` — «вдавленность»: внутренняя тёмная тень + `translateY(1px)`.

```css
button.icon-button {
  width: 40px; height: 40px; padding: 0; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 10px;
  border: 1px solid #0e1116;
  background: linear-gradient(180deg, #2b313c, #222731);
  color: var(--text);
  box-shadow: var(--shadow-inset), 0 1px 2px rgba(0, 0, 0, 0.45);
  transition: background .15s ease, border-color .15s ease, box-shadow .15s ease, transform .1s ease;
}
button.icon-button:hover:not(:disabled) {
  background: linear-gradient(180deg, #343b48, #272d38);
  border-color: #3a4150;
}
button.icon-button:active:not(:disabled) {
  background: linear-gradient(180deg, #1f242c, #262c36);
  box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.55);
  transform: translateY(1px);
}
button.icon-button:disabled { opacity: 0.5; cursor: not-allowed; }
```

Тот же рецепт переиспользуется без копипасты стилей: `button.icon-button`
задаёт базу, а пагинация/меню лишь добавляют специфику. Панели и карточки —
родственная семья:

```css
.stacks {                                   /* панель */
  border: 1px solid #0e1116;
  border-radius: 12px;
  background: linear-gradient(180deg, #222731, #1c2028);
  box-shadow: var(--shadow-inset), var(--shadow-md);
}
.stack-card:hover {                         /* карточка приподнимается */
  border-color: var(--accent);
  box-shadow: var(--shadow-inset), 0 6px 16px rgba(0, 0, 0, 0.45);
  transform: translateY(-2px);
}
```

> **Грабля.** Если карточка «приподнимается» внутри прокручиваемой области,
> её верхняя рамка срезается краем `overflow`. Дай контейнеру запас
> `padding-top` и следи за отступом от соседнего блока.

### 2.4 Обязательные состояния

У **любого** интерактивного элемента должны быть определены:

| Состояние | Как |
| --------- | --- |
| hover | смена фона/границы |
| active | «вдавленность» (см. 2.3) |
| focus-visible | акцентное кольцо |
| disabled | `opacity: .5; cursor: not-allowed` |
| loading | спиннер/скелетон, `aria-busy` |
| empty | dashed-блок с пояснением |
| error | приглушённый красный + повтор |

Пример focus-кольца (сначала убираем дефолт, потом свой):

```css
.field input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(76, 139, 245, 0.25);
}
```

### 2.5 UX-паттерны проекта

**Скелетоны с ограничением.** Пока данные грузятся, показываем шиммер-карточки,
но не больше разумного, иначе «мигает» экран:

```tsx
// Gallery.tsx
const MAX_SKELETONS = 60;
// рендер: Array.from({ length: Math.min(pageSize, MAX_SKELETONS) })
```

```css
.photo-card--skeleton {
  background: linear-gradient(100deg, var(--surface) 30%, var(--surface-2) 50%, var(--surface) 70%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
}
```

**Верхний прогресс-бар** (`role="progressbar"`) на время `busy`; `body.cursor-progress`
меняет курсор на всю страницу — пользователь видит, что идёт работа.

**Задержка спиннера.** Не показывай спиннер сразу — на быстром/кэшированном
переходе он только мигает. Небольшая задержка (≈140 мс) + проверка
`img.complete && img.naturalWidth > 0` для уже готовых изображений:

```tsx
// Lightbox.tsx
const SPINNER_DELAY_MS = 140;
```

**Единственный постоянный оверлей** загрузки (не перерисовывается), скрывается
плавно через `opacity/visibility` (`is-hidden`), а не удалением из DOM.

**Пустые и ошибочные состояния** — отдельные компоненты с пояснением и, где
уместно, кнопкой «Повторить». Для специальных ошибок (например, неверный тип
токена) — пошаговая инструкция, а не сухой код.

**Автовыход по 401.** Любой запрос, вернувший 401, переводит приложение в
экран входа (не оставляет «полуживое» состояние).

### 2.6 Модалки, лайтбокс, жесты

- `role="dialog"` + `aria-modal="true"`, клик по фону закрывает, клик внутри —
  `stopPropagation`.
- Блокировка скролла тела с **восстановлением** прежнего значения при закрытии.
- Предзагрузка соседних кадров.
- **Cooldown навигации** (≈220 мс), чтобы колесо/свайп не пролистывали слишком
  быстро.
- Клавиатура: `Escape`, `←`/`→`.
- Свайпы: `touchstart/move/end`, при горизонтальном движении
  `preventDefault()` (слушатель `{ passive: false }`), порог ≈45px; учитывай
  доминирование по оси.
- Тач-ленты: временный CSS-offset (`--drag`) с отключённым transition на время
  перетаскивания, затем «прилипание» к ближайшему элементу; подавление клика
  сразу после drag.
- **Focus-trap:** фокус входит в модалку (первым — на кнопку «Закрыть»),
  циклится по `Tab`/`Shift+Tab` внутри и **возвращается** на элемент-инициатор
  при закрытии.

### 2.7 Адаптив и мобильные паттерны

Один явный брейкпоинт (`@media (max-width: 640px)`), а не россыпь мелких.
На мобильных основные действия прячем в **меню «три точки»**, а «Выйти»
оставляем рядом видимым:

```css
@media (max-width: 640px) {
  .gallery__header { flex-wrap: wrap; align-items: center; }
  .gallery__heading { flex: 1 1 100%; }
  .gallery__actions--desktop { display: none; }
  .gallery__actions--mobile  { display: inline-flex; margin-left: auto; }
}
```

Меню (`role="menu"`, пункты `role="menuitem"`, иконка+текст) закрывается по
клику вне и по `Escape`. Десктопные действия и мобильные рендерятся разными
контейнерами, при этом один и тот же элемент не дублируется как интерактивный.

### 2.8 Доступность

- `aria-label` (обязательно у иконок), `title`, `aria-pressed`, `aria-expanded`,
  `aria-current`, `aria-busy`, `role="status"`, `role="progressbar"`,
  `aria-live="polite"`.
- Видимый фокус. Клик не должен «залипать» — используй `focus-visible` там, где
  это уместно.
- Уважай системные настройки:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- Модалки/меню: закрытие по `Escape`, ловушка фокуса, возврат фокуса на
  инициатора.

### 2.9 Drag & drop «наружу»

Чтобы фото можно было перетащить в файловый менеджер/мессенджер и получить
нормальное имя, кладём в `dataTransfer` полный URL и метаданные:

```ts
// web/src/dragPhoto.ts
event.dataTransfer.effectAllowed = "copy";
event.dataTransfer.setData("text/uri-list", url);
event.dataTransfer.setData("text/plain", url);
try {
  // Chromium-only: сохранит файл как vk-<ownerId>-<id>.jpg
  event.dataTransfer.setData("DownloadURL", `image/jpeg:${name}:${url}`);
} catch {}
```

Курсоры — `grab`/`grabbing`, у `<img>` внутри перетаскиваемой карточки
`draggable={false}` (иначе браузер тянет саму картинку, а не ссылку).

---

## 3. Отказоустойчивая загрузка ресурсов

Это самый ценный раздел проекта. Здесь собран опыт борьбы с «вечной загрузкой».

### 3.1 Проблема

В **Яндекс.Браузере** (и его прокси-режиме «Турбо») запрос крупного JS-бандла
может вернуть `HTTP 200` с корректным `Content-Length`, но **тело не придёт
никогда** (наблюдалось 0 байт за ~24 с). Тег `<script src>` в этом случае не
шлёт ни `load`, ни `error` — страница навсегда остаётся на спиннере.

Дополнительно: в **Range-режиме** примерно каждый второй запрос куска «зависает».

**Лечение — на двух уровнях:**

- на сервере — не сжимать/не трансформировать статику и отдавать
  `Content-Length` явно;
- на клиенте — **не прописывать бандл тегом** и грузить его самим с дедлайнами,
  кусками и хеджированием.

### 3.2 Главное правило: в HTML нет `<script src>` бандла

Сборщик (`scripts/build-shell.mjs`) **не** выводит тег бандла. В `index.html`
есть только CSS-`<link>`, инлайн-конфиг и инлайн-загрузчик. Путь к бандлу
живёт строкой в конфиге:

```js
window.__VK_SHELL_CONFIG__ = {
  js: "./assets/app-<hash>.js",
  css: "./assets/app-<hash>.css",
  asset: "./api.php?action=asset",
  diag: "./api.php?action=diag",
  rangeChunkBytes: 8192, rangePool: 4, rangeTimeoutMs: 1500,
  rangeRetries: 6, rangeRetryDelayMs: 120, rangeHedgeMs: 500,
  mirrorTimeoutMs: 5000
};
```

Загрузчик сам инжектит бандл классическим `<script>`, поэтому подвисший ресурс
не держит `window.load` и вкладку. Vite собирает IIFE (`format: "iife"`,
`inlineDynamicImports: true`) именно для возможности инлайн-инъекции.

### 3.3 Цепочка источников

**Обычные браузеры:** `PHP-asset → static → localStorage → CDN-зеркала (в т.ч.
через CORS-прокси) → fetch + инлайн`. Резерв начинается с `localStorage`
(мгновенно), затем зеркала, и лишь **в последнюю очередь** — статика: на
«медленном» хостинге подвисает как раз она.

**Яндекс.Браузер** (детект по UA `/YaBrowser|yabrowser/i`): особый путь
`localStorage → CDN-зеркало (один запрос по HTTP/2) → Range-куски по 8 КБ`.
Это превращает первый заход из ~24 с зависания в ~130 мс.

```js
// web/shell-runtime.js
if (isYandex()) {
  startYandexPrimary();   // localStorage → mirror → ranges
  return;
}
```

### 3.4 Таймауты — обязательны везде

У каждого шага — свой дедлайн. Причём **отдельно на заголовки и отдельно на
тело**: заголовки приходят, а тело может не прийти.

```js
var TIMEOUT = CONFIG.timeoutMs || 8000;             // общий шаг / чтение тела
var PRIMARY_TIMEOUT = CONFIG.primaryTimeoutMs || 6000;
var READY_WATCHDOG = CONFIG.readyWatchdogMs || 20000; // нет прогресса вообще
var POST_INJECT_TIMEOUT = CONFIG.postInjectTimeoutMs || 4000;
var RANGE_TIMEOUT = CONFIG.rangeTimeoutMs || 1500;
var RANGE_RETRIES = CONFIG.rangeRetries || 6;
var RANGE_HEDGE_MS = CONFIG.rangeHedgeMs || 500;
```

Оборачивание `fetch` с `AbortController` и таймаутом на тело:

```js
function readBody(r, ms) {
  ms = ms || TIMEOUT;
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      try { if (r && r.body && r.body.cancel) r.body.cancel(); } catch (e) {}
      reject(new Error("таймаут чтения тела " + ms + "мс"));
    }, ms);
    r.text().then(
      function (t) { if (!done) { done = true; clearTimeout(timer); resolve(t); } },
      function (e) { if (!done) { done = true; clearTimeout(timer); reject(e); } },
    );
  });
}
```

### 3.5 Range-загрузка + hedging (ядро обхода Яндекс.Браузера)

Файл качается кусками по 8 КБ, пулом по 4 соединения. Каждый кусок:

- имеет **жёсткий таймаут** (`rangeTimeoutMs`), по которому `abort()`;
- при отсутствии ответа за `rangeHedgeMs` — **дубль на другом соединении**
  (hedged request): побеждает первый пришедший, остальные отменяются;
- при неудаче **не блокирует** пул: повтор ставится в конец очереди;
- повторный запрос идёт с cache-buster (`shellcb=<ts>`), чтобы прокси не отдал
  заново тот же «зависший» ответ.

```js
function fetchChunkHedged(ret, codeHolder) {
  return new Promise(function (resolve, reject) {
    var settled = false, pending = 0, ctrls = [];
    function abortAll() { for (var i = 0; i < ctrls.length; i++) { try { ctrls[i].abort(); } catch (e) {} } ctrls = []; }
    function succeed(res) { if (settled) return; settled = true; abortAll(); armRangeWatchdog(); resolve(res); }
    function fail(e) { pending--; if (settled) return; if (pending <= 0) { settled = true; reject(e); } }
    function one() {
      if (settled) return;
      var ctrl = new AbortController(); ctrls.push(ctrl); pending++;
      ret.attempt = (ret.attempt || 0) + 1;
      var chunkUrl = ret.attempt > 1 ? withCacheBuster(url) : url;
      var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} fail(new Error("таймаут")); }, RANGE_TIMEOUT);
      fetch(chunkUrl, { signal: ctrl.signal, cache: "no-store",
        headers: { Range: "bytes=" + ret.start + "-" + ret.end } })
        .then(function (r) {
          if (settled) { clearTimeout(timer); return; }
          if (!r || r.status !== 206) { /* RANGE_UNSUPPORTED */ fail(...); return; }
          readBody(r, RANGE_TIMEOUT).then(function (t) { clearTimeout(timer); succeed({ text: t }); },
                                          function (e) { clearTimeout(timer); fail(e); });
        }, function (e) { clearTimeout(timer); fail(e); });
    }
    one();
    setTimeout(function () { if (!settled && pending > 0) one(); }, RANGE_HEDGE_MS); // hedge
  });
}
```

Пул с requeue (зависший кусок уходит в конец, остальные продолжают):

```js
function run(p) {
  fetchChunkHedged(p, {}).then(function (res) {
    inflight--;
    slots[p.idx] = res.text; doneCount++;
    if (doneCount === remaining.length) { finish(); return; }
    pump();
  }).catch(function (e) {
    inflight--;
    p.retries = (p.retries || 0) + 1;
    if (p.retries <= RANGE_RETRIES) {
      delay(RANGE_RETRY_DELAY).then(function () { queue.push(p); pump(); });
    } else { failed = true; rejectPool(e); }
  });
}
```

**Сторож прогресса** взводится заново на каждом докачанном куске и срабатывает,
только если прогресса нет вовсе (`readyWatchdogMs`):

```js
function armRangeWatchdog() {
  if (!rangeActive || ready) return;
  if (rangeWatchdog) clearTimeout(rangeWatchdog);
  rangeWatchdog = setTimeout(function () {
    if (ready) return;
    rangeActive = false;
    scheduleFallback("APP_TIMEOUT");
  }, READY_WATCHDOG);
}
```

### 3.6 Проверка целостности

`Content-Range` считает **байты**, а длина JS-строки — UTF-16 code units.
Поэтому собранный текст пере-измеряем в UTF-8 и сверяем с ожидаемым размером:

```js
function finish() {
  var full = info.first;
  for (var i = 0; i < slots.length; i++) full += slots[i];
  if (utf8Bytes(full) !== responseTotal) { failed = true; rejectPool(new Error("длина не сходится")); return; }
  resolvePool(full);
}
function utf8Bytes(s) {
  try { if (typeof TextEncoder === "function") return new TextEncoder().encode(s).length; } catch (e) {}
  try { return new Blob([s]).size; } catch (e) {}
  return s.length;
}
```

Плюс отсев «HTML вместо JS»: любой принятый текст короче 600 байт или
начинающийся с `<` отвергается (это страница ошибки, а не бандл).

### 3.7 Кэш бандла в `localStorage`

Ключ — **content-addressed**: хэш URL (в котором уже есть Vite-hash). Новая
сборка → новый URL → новый ключ → старый автоматически вытесняется. TTL не
нужен, актуальность гарантируется именем файла.

```js
function hash(s) {
  var h = 9;
  for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 387420489);
  return (h ^ (h >>> 13)) >>> 0;
}
var JS_KEY = "vk_shell_js_" + hash(JS);

function storeBundle(text) {           // сохраняем собранное (в т.ч. из Range)
  if (!text || text.length < 600 || /^\s*</.test(text)) return;
  lsSet(JS_KEY, text);
  evictOld("vk_shell_js_", JS_KEY);    // держим только одну копию
}
```

Stale-while-revalidate на уровне shell означает: **сначала всегда отдаём
копию из `localStorage`** (инлайн), и только если она не «ожила» за
`postInjectTimeoutMs` — идём в сеть.

### 3.8 Серверная отдача ассетов (`action=asset`)

Пара «клиент-загрузчик + серверный ассет» — одно целое. Сервер обязан:

- валидировать имя по allowlist и проверять containment через `realpath`;
- отдавать `ETag` и `304` по `If-None-Match`;
- объявлять `Accept-Ranges: bytes`;
- на Range-запрос возвращать `206` + `Content-Range` **raw-байтами без gzip**;
- на обычный запрос — gzip с явным `Content-Length`;
- ставить `nosniff`, `Vary: Accept-Encoding`, `Cache-Control: ..., immutable`.

```php
$name = (string) ($_GET['f'] ?? '');
if (preg_match('/^app-[A-Za-z0-9._-]+\.(js|css)$/', $name) !== 1) {
    fail(400, 'BAD_ASSET', 'Недопустимое имя файла');
}
$assetsDir = realpath(__DIR__ . '/assets');
$real = realpath(__DIR__ . '/assets/' . $name);
if ($assetsDir === false || $real === false
    || strpos($real, $assetsDir . DIRECTORY_SEPARATOR) !== 0 || !is_file($real)) {
    fail(404, 'ASSET_NOT_FOUND', 'Файл не найден');
}
$etag = '"' . sha1_file($real) . '"';
header('ETag: ' . $etag);
header('Accept-Ranges: bytes');
if (trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
    http_response_code(304);
    exit;
}
// ... Range → 206 raw; иначе gzip + Content-Length
```

### 3.9 `.htaccess`: не сжимать статику

Дублирующая серверная страховка для тех, у кого `api.php` не используется или
прокси ломает трансформацию:

```apache
<IfModule mod_headers.c>
  <FilesMatch "\.(?:js|mjs|css)$">
    Header set Cache-Control "no-transform"
  </FilesMatch>
</IfModule>
<IfModule mod_deflate.c>
  <FilesMatch "\.(?:js|mjs|css)$">
    SetEnv no-gzip 1
  </FilesMatch>
</IfModule>
<IfModule mod_brotli.c>
  SetEnvIfNoCase Request_URI \.(?:js|mjs|css)(\?.*)?$ no-brotli
</IfModule>
```

### 3.10 CDN-зеркала и дисциплина артефактов

Сборщик извлекает `owner/repo` из `git remote get-url origin` и сам прописывает
два jsDelivr-хоста в `shell-config.js`. Хэш в имени делает кэш CDN безопасным.

> **Критично:** после сборки новые `assets/app-<hash>.js|css` **нужно
> запушить**, иначе зеркало вернёт 404 и загрузчик молча уйдёт на Range-куски.
> Всегда проверяй: `curl -s -o /dev/null -w "%{http_code}" https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/assets/<file>`
> → `200`.

### 3.11 Итог: «вечной загрузки» не бывает

Загрузчик **всегда** приходит к одному из двух состояний: либо приложение
готово (`window.__APP_READY__`), либо показана заглушка с кнопкой «Повторить».
Промежуточного «висит спиннер навсегда» нет по построению.

---

## 4. Терминальный лог для отладки

### 4.1 Идея

Встроенный **всплывающий оверлей-терминал**, работающий с самого старта (до
того, как поднимется фреймворк). Он же ловит ошибки загрузки ресурсов, которые
обычный `console` может не показать. В проде доступен пользователю по кнопке
«лог», в разработке — практически бесплатен.

### 4.2 Где живёт

Не React-компонент, а vanilla-JS в shell-загрузчике: он должен работать раньше
и независимо от SPA. Исходник — `web/shell-runtime.js`, встраивается в
`index.html` на сборке. Приложение общается с ним через глобаль‑API.

Статичная разметка и CSS — в шаблоне shell:

```html
<div id="shell-log" role="log" aria-live="polite"></div>
<button id="shell-log-toggle" class="is-hidden" type="button">лог</button>
```

```css
#shell-log {
  position: fixed; left: 50%; bottom: 20px; z-index: 10002;
  width: min(680px, calc(100vw - 32px)); max-height: 42vh; overflow: auto;
  transform: translateX(-50%);
  background: rgba(8, 10, 14, 0.94); border: 1px solid #2a2f3a; border-radius: 12px;
  padding: 12px 14px; text-align: left; color: #c7cdd8;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  transition: opacity .3s ease, visibility .3s ease, transform .3s ease;
}
#shell-log.is-hidden { transform: translateX(-50%) translateY(8px); }
.shell-log__line--info  { color: #9aa3b2; }
.shell-log__line--ok    { color: #4ade80; }
.shell-log__line--warn  { color: #fbbf24; }
.shell-log__line--error { color: #f87171; }
.shell-log__line--net   { color: #60a5fa; }
```

### 4.3 Уровни и запись

```js
var MAX_LOG_LINES = 300;       // ограничение DOM
var LOG_AUTOHIDE_MS = 1600;    // авто-скрытие, если пользователь не открыл лог

function write(level, message) {
  var stamped = stamp() + " " + message;   // [ 42ms] текст
  record(stamped);                          // в буфер (до 500 строк — для /diag)
  var node = el("div");
  node.className = "shell-log__line shell-log__line--" + level;
  node.textContent = stamped;               // textContent, НЕ innerHTML
  box.appendChild(node);
  while (box.childNodes.length > MAX_LOG_LINES) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
  console[level === "error" ? "error" : level === "warn" ? "warn" : "log"]("[shell]", stamped);
}
```

**Правила:**

- **`textContent`, не `innerHTML`** — защита от XSS через серверные сообщения.
- ограничение числа строк в DOM (память), но буфер для `/diag` чуть больше.
- уровни: `info / ok / warn / error / net`; цвет — только через CSS-класс.
- параллельно дублируем в настоящий `console` с префиксом `[shell]` — удобно в
  DevTools.

### 4.4 Публичный API

```js
window.__VK_LOADER__ = {
  info, ok, warn, error, net,          // записать строку
  show, hide, begin, end,              // оверлей/готовность
  clear, restart, report,              // очистить / перезапустить / выслать diag
  isReady,
};
```

Приложение пишет туда из **своего API-клиента** (никакого monkey-patching
`fetch`):

```ts
// web/src/api/client.ts
function loader(): ShellLoader | undefined { return window.__VK_LOADER__; }

loader()?.net(`→ ${method} ${action}`);
loader()?.ok(`← ${action} ${response.status} ${ms}мс`);
loader()?.error(`✖ ${action} TIMEOUT ${ms}мс`);
loader()?.error(`← ${action} ${status} — ${code}`);
```

Типизация — в `web/src/global.d.ts`:

```ts
interface ShellLoader {
  info(m: string): void; ok(m: string): void; warn(m: string): void;
  error(m: string): void; net(m: string): void; report(): void;
  // ...
}
interface Window {
  __APP_READY__?: boolean;
  __VK_APP_MOUNTED__?: boolean;
  __VK_LOADER__?: ShellLoader;
}
```

### 4.5 Перехват ошибок

```js
window.addEventListener("error", onResourceError, true);   // capture: ресурсы
window.addEventListener("unhandledrejection", onRejection);
```

Плюс **ранний буфер**: крошечный инлайн-скрипт в `<head>` (до загрузчика)
складывает до 50 ошибок в `window.__VK_SHELL_EARLY_ERRORS__`, которые загрузчик
«вычитывает» при старте. Так не теряются ошибки, случившиеся до инициализации.

### 4.6 Поведение и UX

- лог скрыт по умолчанию; кнопка «лог» появляется после готовности;
- авто-скрытие через `LOG_AUTOHIDE_MS`, **если пользователь не открывал лог
  вручную** (флаг `logOpenedByUser`); открытый вручную — не закрывается сам;
- тумблер проставляет `aria-pressed` и переключает `.is-hidden`;
- кнопка **«Повторить»** в заглушке очищает лог, показывает оверлей и
  перезапускает загрузку (`location.reload()`).

---

## 5. Диагностика `/diag`

### 5.1 Зачем

Понять, что происходит в чужом браузере (особенно Яндекс.Браузере), когда нет
доступа к DevTools пользователя. Клиент шлёт «маячок» с логом и таймингами —
сервер складывает их в файлы.

### 5.2 Клиентский маячок

Отправляется **один раз за страницу** (guard `reported`) в трёх случаях: успех
(`ready`), полный сбой (`fallback:<code>`), ручной вызов (`report()`). Доставка —
`navigator.sendBeacon`, резерв — `fetch(..., { keepalive: true })`.

```js
var payload = JSON.stringify({
  reason, version, href, userAgent,
  ready, mounted,
  config: { js: JS, css: CSS, asset: ASSET },
  log: logLines.slice(),           // последние строки терминала
  resourceTiming: collectResourceTiming(),
  navigation: collectNavigation(),
});
```

Resource Timing особенно ценен: зависший тег **не шлёт событий**, поэтому
запись «запрос не завершился» + `responseStatus`/`transferSize` — часто
единственный след.

### 5.3 Серверный приём

```php
function action_diag(): never
{
    $raw = (string) file_get_contents('php://input');
    if (strlen($raw) > 262144) { $raw = substr($raw, 0, 262144); }   // кап 256 КБ
    $data = json_decode($raw, true) ?: ['raw' => $raw];
    $data['_server'] = [
        'time' => date('c'), 'ip' => $_SERVER['REMOTE_ADDR'] ?? null,
        'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
        'accept_encoding' => $_SERVER['HTTP_ACCEPT_ENCODING'] ?? null,
        'http_version' => $_SERVER['SERVER_PROTOCOL'] ?? null,
    ];
    $file = date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.json';
    // запись в private/diag/ с LOCK_EX и JSON_PRETTY_PRINT
}
```

Каталог `private/diag/` закрыт `.htaccess` (`Require all denied`).

### 5.4 Правила безопасности для `/diag` (обязательно)

Маячок — это **точка входа данных от неаутентифицированного клиента**, поэтому:

- **кап размера** тела (256 КБ);
- **уникальные имена** файлов (защита от перезаписи) — `random_bytes`;
- **rate-limit** по IP (маячок не должен забивать диск);
- **ротация/retention** — периодическая чистка старых файлов (по возрасту/количеству);
- **никаких секретов в payload** (токены, пароли, подписанные URL). URL страницы —
  допустим, если не содержит чувствительных параметров;
- при необходимости — общий токен в запросе/заголовке;
- `errors.log` — отдельный файл, ротируется по размеру (например, `> 1 MiB`).

> **Долг проекта закрыт:** `action_diag` получил json-кап (256 КБ), rate-limit по
> IP (скользящее окно, `DIAG_RATE_LIMIT`/`DIAG_RATE_WINDOW`), уникальные имена
> и ротацию (`diag_prune`: возраст `DIAG_MAX_AGE_DAYS`, количество
> `DIAG_MAX_FILES`). Авторизация маячку намеренно не нужна — он должен работать
> ещё до входа, поэтому защита строится на капе и лимитах.

---

## 6. Безопасность

### 6.1 Аутентификация и сессии

```php
function start_session(): void
{
    if (session_name('VKPSESS')) {
        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => '/',
            'httponly' => true,                                   // JS не видит cookie
            'samesite' => 'Lax',                                 // защита от CSRF на POST
            'secure'   => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
        ]);
    }
    session_start();
}
```

Правила:

- cookie: **`HttpOnly` + `SameSite=Lax` + `Secure` (при HTTPS)**;
- **регенерация id** при смене привилегий (вход): `session_regenerate_id(true)`;
- **`session_write_close()`** перед долгими внешними вызовами — иначе
  параллельные запросы того же пользователя ждут файл сессии и падают по
  таймауту;
- logout — очистка `$_SESSION` + `session_destroy()`.

### 6.2 Пароли и сравнение

- хэш — `password_hash($pass, PASSWORD_DEFAULT)` (bcrypt), cost ≥ 12;
  проверка — `password_verify`;
- сравнение чувствительных строк — **`hash_equals`** (constant-time);
- username — строгое сравнение до проверки пароля.

### 6.3 Брутфорс и лимиты

```php
$fails = (int) ($_SESSION['vkphotos_login_fails'] ?? 0);
if ($fails >= 5) fail(429, 'TOO_MANY_ATTEMPTS', 'Слишком много попыток входа…');
// при неудаче: ++счётчик, usleep(250_000) перед ответом
```

> **Долг проекта:** счётчик в `$_SESSION` обходится сбросом cookie. В новом
> проекте — **лимит по IP + глобальный**, экспоненциальная задержка, а не
> только сессионный счётчик.

### 6.4 CSRF

- `SameSite=Lax` закрывает классический CSRF для `POST` извне;
- для state-changing действий — **проверка `Origin`/`Referer`** или CSRF-токен;
- `logout` делай **`POST`**, а не `GET` (GET уходит по ссылке/навигации);
- никаких state-changing `GET`.
- реализация: `require_method('POST')` (405 с `Allow`) + `assert_same_origin()`
  (403 при чужом `Origin`/`Referer`; если заголовков нет — прямой вызов, не
  блокируем); применяется к `login`, `logout` и `stacks` при `refresh`.

### 6.5 Секреты

- файл `private/secrets.php` — **вне webroot в идеале**, закрыт `.htaccess`
  (`Require all denied`), обязательно в `.gitignore`;
- права: файл `0600`, каталог `0700`;
- если права шире, сервер **мягко** предупреждает: однократно пишет в
  `private/diag/secrets-perms.log` и продолжает работу (не блокируем — на
  shared-хостингах схему закрывает `.htaccess`);
- форма — `secrets.example.php` (коммитится, без реальных значений);
- приоритет env-переменных над файлом (удобно в контейнерах/CI);
- **никогда** не логировать и не отдавать секреты клиенту;
- проверяй `git ls-files`/`git check-ignore`, что секреты и кэши не в индексе.
  Отдельно следи, чтобы случайный артефакт (например, `private/asset-cache/*.gz`)
  не оказался закоммичен вопреки `.gitignore`.

### 6.6 Контракт ошибок и гигиена сообщений

Единый конверт:

```php
function fail(int $status, string $code, string $message, array $details = []): never
{
    json_out(['error' => ['code' => $code, 'message' => $message, 'details' => $details ?: null]], $status);
}
```

Правила:

- наружу — **код + понятное сообщение**, без стека/путей/внутренних деталей;
- внутренние детали — в `log_error()`;
- **никогда** не интерполируй `$e->getMessage()` в ответ клиенту;
- исключение — осознанно публичные тексты (сообщения внешнего API), и то
  осторожно.

### 6.7 Валидация ввода

- числа — `filter_var(..., FILTER_VALIDATE_INT, ['options' => ['min_range' => …, 'max_range' => …]])`;
- строки/идентификаторы — проверка непустоты и формата;
- имена файлов — строгий allowlist-regex + `realpath`-containment (§3.8).

### 6.8 SSRF и работа с путями

- не делай «generic URL-прокси» по пользовательскому вводу;
- внешние адреса — только из доверенной конфигурации (секрет `vk_base`/`ai_base_url`);
- если всё же проксируешь файлы — allowlist + `realpath` containment;
- ограничивай редиректы (`max_redirects = 4`);
- MIME входящих изображений проверяй по магическим байтам, а не по расширению.

### 6.9 Заголовки безопасности

`json_out` и `asset` уже ставят `nosniff` и запрет кэша/трансформации. Полный
набор выставляется в `.htaccess` (`mod_headers`), а критичные дублируются в
`json_out` (`nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`,
`X-Request-Id`):

```
Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline' <cdn>; style-src 'self' 'unsafe-inline' <cdn>; connect-src 'self' https:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
X-Content-Type-Options: nosniff
```

> **Долг проекта закрыт:** заголовки выставляются в `.htaccess`. Инлайн-загрузчик
> и фоллбэк-инъекция требуют `'unsafe-inline'`, а CDN-зеркала и CORS-прокси
> попадают в `script-src`/`style-src`. Для API те же заголовки (кроме CSP/HSTS)
> дублируются в `json_out` — на случай, если `.htaccess` не обрабатывается.

### 6.10 Приватность / PII

- не клади секреты и чувствительные параметры **в URL** (они утекут в логи,
  `Referer`, `diag`);
- в `/diag` попадает IP и User-Agent — это персональные данные; определи срок
  хранения и не храни лишнего;
- редактируй/маскируй потенциально чувствительные поля перед записью.

---

## 7. Кэширование, блокировки, внешние API

### 7.1 Серверный кэш

- ключ — content-addressed: `hash('sha256', json_encode([...параметры...]))`;
- TTL (например, 5 минут для данных, 12 часов для тяжёлых ИИ-результатов);
- запись — только после успешного `json_encode`; **не перезаписывай валидный
  кэш битым**:

```php
function cache_put(string $key, array $data): void
{
    $json = json_encode($data, JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
    if (!is_string($json)) return;                 // encode провалился — не пишем
    @file_put_contents(cache_path($key), $json, LOCK_EX);
}
```

- чтение — **self-heal**: пустой/битый файл считаем промахом, а не валидными
  данными. (Именно пустой файл кэша однажды приводил к `404 AI_NO_STACKS`.)

### 7.2 Клиентский кэш и SWR

- страницы — в `localStorage` с TTL, ключ по параметрам, с runtime-валидацией
  формы ответа (`isValidPage` перед доверием);
- `react-query`: `staleTime`, `placeholderData: keepPreviousData`, `retry: 1`,
  `refetchOnWindowFocus: false`;
- `initialData` — мгновенный показ только если закэширована **вся** страница;
- частичная загрузка: при падении не первой порции показываем уже загруженное,
  не роняя весь экран.

```ts
// usePhotos.ts
return useQuery({
  queryKey,
  queryFn: (ctx) => loadChunks(specs, (partial) => ctx.client.setQueryData(queryKey, partial)),
  initialData: () => readFullCache(specs),
  staleTime: PAGE_TTL_MS,
  placeholderData: keepPreviousData,
  retry: 1,
});
```

### 7.3 Блокировки против дублирования

Тяжёлую работу (сборка групп ИИ, дорогой отчёт) защищаем неблокирующим
замком — параллельный запрос получает прошлый результат, а не запускает ту же
работу второй раз:

```php
$lock = @fopen($lockPath, 'c+');
if ($lock !== false && !flock($lock, LOCK_EX | LOCK_NB)) {
    fclose($lock);
    if ($cache !== null) json_out(ai_public($cache));   // отдаём предыдущее
    fail(503, 'AI_BUILDING', 'Уже собирается, попробуйте через минуту');
}
// ... finally: flock($lock, LOCK_UN); fclose($lock);
```

### 7.4 Троттлинг внешних API

Соблюдай лимиты внешнего API (например, VK: 3 запроса/сек с user-токеном).
Глобальный интервал через файл-замок работает без APC/opcache и
синхронизирует даже параллельные вкладки:

```php
function vk_throttle(): void
{
    $minIntervalUs = 340_000;                 // ≈2.9 запроса/сек
    $fh = @fopen(__DIR__ . '/private/cache/vk-throttle.lock', 'c+');
    if ($fh === false) return;               // кэш недоступен — не блокируем работу
    if (flock($fh, LOCK_EX)) {
        $last = (int) trim((string) stream_get_contents($fh));
        $waitUs = $last + $minIntervalUs - (int) round(microtime(true) * 1_000_000);
        if ($waitUs > 0) usleep($waitUs);
        ftruncate($fh, 0); rewind($fh);
        fwrite($fh, (string) (int) round(microtime(true) * 1_000_000));
        fflush($fh); flock($fh, LOCK_UN);
    }
    fclose($fh);
}
```

Кэшируй ответы, чтобы пагинация не била по лимиту (страница в 100 элементов =
ровно один запрос).

### 7.5 Деградация вместо падения

Внешние зависимости (ИИ, платёжка, геокодер) **должны** иметь полезный фоллбэк:

- нет ключа → работаем без ИИ (локальная эвристика), но функция остаётся полезной;
- квота `429` → не ретраим бессмысленно, классифицируем и переходим на фоллбэк;
- провайдер недоступен → фоллбэк + человекочитаемое пояснение в UI («ИИ: квота
  исчерпана — стопки собраны без ИИ»);
- каталог кэша недоступен → **фоллбэк в `sys_get_temp_dir()`** с хэшем от пути
  установки; если и он недоступен — явная ошибка `503 AI_CACHE_UNAVAILABLE`.

### 7.6 UTF-8 и отсутствующие расширения

- любые данные из внешних источников могут содержать «грязный» UTF-8 →
  `JSON_INVALID_UTF8_SUBSTITUTE` при кодировании;
- **не полагайся на mbstring безусловно** — оборачивай через `function_exists`
  и держи полифилл (например, `u_lower` со ручной таблицей для кириллицы, т.к.
  `strtolower` не трогает кириллицу);
- так же — `curl`, `gzencode`, `set_time_limit`.

### 7.7 Квота ИИ: классификация `429`

Определяй квоту по нескольким признакам (провайдеры врут по-разному):
`status === 'RESOURCE_EXHAUSTED'`, `code === 429`, подстроки `quota`,
`rate limit`, `too many requests`. По возможности извлекай время сброса
(`retryDelay`, ISO-8601 `PT…S`) и показывай человеку.

---

## 8. Контракт API и коды ошибок

### 8.1 Единый конверт

Успех — «плоский» объект данных. Ошибка — всегда:

```json
{ "error": { "code": "VK_27", "message": "…", "details": null } }
```

- единая функция вывода (`json_out`) и единая функция ошибки (`fail`);
- `Content-Type: application/json; charset=utf-8`, `nosniff`,
  `Cache-Control: no-store, no-transform`;
- gzip с явным `Content-Length` (см. §3, §10);
- `JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE`.

### 8.2 Таксономия кодов

Коды — машинночитаемые, `ГРУППА_ПРИЧИНА` в верхнем регистре: `UNAUTHORIZED`,
`TOO_MANY_ATTEMPTS`, `BAD_CREDENTIALS`, `VALIDATION_FAILED`, `VK_UNAVAILABLE`,
`AI_BUILDING`, `ASSET_NOT_FOUND`, `TIMEOUT`, `NETWORK`, `BAD_RESPONSE`,
`INTERNAL`. Внешние коды маппятся в понятные (`VK_27` → «нужен user-токен»).

### 8.3 Клиентская обработка

```ts
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}
```

- таймаут и сеть → `ApiError(0, "TIMEOUT"|"NETWORK")`;
- не-2xx или тело с `error` → код из конверта (или `HTTP_<status>`);
- 200, но тело не JSON → `BAD_RESPONSE` с превью первых 300 символов (для
  отладки, не для показа пользователю);
- разный таймаут по операциям: обычный 10 с, фото 20 с, ИИ 300 с, стек-фото 60 с.

---

## 9. Конфигурация и окружение

- **`secrets.example.php` — это документация конфигурации.** Все ключи с
  комментариями; реальный `secrets.php` создаётся из него.
- **env переопределяет файл** (приоритет окружения):

```php
$env = function (string $name): ?string {
    $value = getenv($name);
    return ($value === false || $value === '') ? null : $value;
};
if (($token = $env('VK_PHOTO_TOKEN')) !== null) $fromFile['vk_token'] = $token;
```

- **`setupRequired`:** если обязательных ключей нет — приложение не падает, а
  сообщает клиенту, что нужна настройка (`action=session` → `setupRequired: true`).
- **Fail fast vs graceful:** на старте Node-бэкенда (Fastify + zod) валидируем
  весь env и падаем с понятным списком проблем; на PHP-хостинге — деградируем
  мягко, потому что нет гарантий окружения.
- Значения по умолчанию держим рядом с константами (`MAX_COUNT = 1000`,
  `CACHE_TTL_SECONDS = 300`).

---

## 10. Сборка и релиз

### 10.1 Конвейер

```
npm run build
  = build(server) + build:web(vite) + build:icons + build:shell
```

- Vite кладёт результат **в корень** (`outDir: "../"`), IIFE, единый CSS,
  sourcemaps;
- `build:shell` (пост-обработка):
  1. сканирует `assets/` и берёт новейшие `app-*.js|css` (по mtime);
  2. определяет `owner/repo` из `git remote` и подставляет jsDelivr-зеркала в
     `shell-config.js`;
  3. встраивает загрузчик + конфиг + CSS/разметку лога в `index.html`;
  4. **удаляет устаревшие ассеты** из `assets/`;
- `build:icons` — SVG → favicon/PNG/manifest.

### 10.2 Важные тонкости

- **Vite «затирает» корневой `index.html`.** Поэтому полный билд — только через
  корневой `npm run build:web && npm run build:shell` (или `npm run build`).
  Прямой `vite build` без `build:shell` оставит минимальный шаблон без
  shell-загрузчика.
- **Хэш в имени** даёт бесплатную инвалидацию кэша CDN.
- **`script-src`/CSP:** если добавишь строгий CSP (§6.9), учти инлайн-загрузчик
  и CDN в директивах, иначе загрузка сломается.

### 10.3 Релиз-чек-лист

- [ ] `npm run typecheck` — чисто.
- [ ] `npm run build` — без ошибок, старые ассеты удалены.
- [ ] `git add -A` и **push** (иначе CDN 404).
- [ ] `curl` проверка нового `assets/app-<hash>.js|css` через jsDelivr → `200`.
- [ ] Прогнаны e2e-сценарии (§11).
- [ ] `git status` чистый; секреты/кэши не закоммичены.

---

## 11. Тестирование

### 11.1 E2E через CDP

Минимально достаточный способ проверять реальный браузер без фреймворка —
Chrome DevTools Protocol (`--headless=new --remote-debugging-port=9222`) и
маленький клиент:

```js
// подключение, отправка команд, ожидание условия
const page = list.find((t) => t.type === "page");
const cdp = new CDP(new WebSocket(page.webSocketDebuggerUrl));
await cdp.send("Runtime.enable");
await waitFor(cdp, "window.__APP_READY__ === true");
```

Проверяй **пользовательское поведение**, а не внутренности: наличие элементов,
их геометрию, отсутствие ошибок в консоли, отклик на клики/свайпы.

### 11.2 Моки внешних сервисов

Обязательно поднимай локальные моки для внешних API и эмулируй **не только
успех**: пустые ответы, частично пустые, `429` (квота), битые данные. В проекте —
отдельные моки VK/ИИ/квоты/пустой/альтернативный и матрица прогонов.

### 11.3 Матрица сценариев (эталон)

| Сценарий | Что проверяем |
| -------- | ------------- |
| happy path | обычная работа |
| no-key | фоллбэк без ИИ/ключа |
| quota | `429` → фоллбэк, провайдер вызван один раз (short-circuit) |
| empty-later | часть порций пустая → показываем загруженное, без падения |
| mobile | viewport 390px, kebab-меню, скрытые десктоп-действия |
| loader | 24 проверки shell-загрузчика (без браузера) |

### 11.4 Порты и окружение

Фиксируй порты (php: 8090, моки: 9310/1310/…), гаси их перед прогоном
(`fuser -k <port>/tcp`), не оставляй фоновых процессов.

### 11.5 Типизация как тест

`tsc --noEmit` в конвейере сборки (`build: "tsc --noEmit && vite build"`),
`strict: true`, `noUncheckedIndexedAccess: true`, `noUnusedLocals/Parameters`.
Runtime-валидация формы ответов (`isValidPage`) — обязательна там, где ответ
внешнего источника.

---

## 12. Наблюдаемость

- **Терминальный лог** (клиент, §4) — пользовательский и отладочный.
- **Маячок `/diag`** (клиент→сервер, §5) — состояние загрузки и тайминги.
- **`errors.log`** — серверные исключения в JSON-строках, с ротацией по размеру:

```php
$path = $dir . '/errors.log';
if (is_file($path) && filesize($path) > 1048576) {
    @rename($path, $dir . '/errors.old.log');
}
@file_put_contents($path, $entry, LOCK_EX | FILE_APPEND);
```

- запись содержит `time, request_id, action, class, message, file, line` —
  достаточно для разбора, без секретов;
- **request-id** генерируется на каждый запрос, уходит в ответ заголовком
  `X-Request-Id`, попадает в `errors.log` и в `_server` записи `/diag` — это
  связывает жалобу клиента и серверный лог;
- **retention:** `errors.log` ротируется по размеру (`> 1 MiB` → `errors.old.log`),
  дампы `/diag` чистятся по возрасту (`DIAG_MAX_AGE_DAYS`) и количеству
  (`DIAG_MAX_FILES`), а окна rate-limit — по времени;
- уровни и причины: `ready` / `fallback:<code>` / `manual` для diag; `warn`/`error`
  в терминале.

---

## 13. Производительность

- **Бюджеты бандла.** Следи за размером `app-<hash>.js` (в проекте ~210 КБ
  raw / ~66 КБ gzip). Не тащи зависимости ради пары функций.
- **Пагинация порциями.** Размер страницы подбирается под один запрос внешнего
  API (`PAGE_CHUNK_SIZE = 100` = один вызов VK). Ограничивай число запросов,
  а не только объём данных.
- **Ленивые изображения**: `loading="lazy"`, `decoding="async"`, width/height
  (или aspect-ratio) против сдвигов макета.
- **SWR-кэш** (§7.2) и предзагрузка соседей в лайтбоксе.
- **Ограничение DOM**: не рендерь тысячи узлов — скелетоны `MAX_SKELETONS`,
  лог `MAX_LOG_LINES`.
- **Троттлинг внешних API** (§7.4) — это тоже производительность (не упереться
  в лимит = не получить каскад ошибок).

---

## 14. Совместимость браузеров

- Держи **явную матрицу** поддерживаемых браузеров и фиксируй target сборки
  (`target: "es2017"`).
- **Feature detection**, не UA-sniffing — кроме документированных «странностей»
  (единственное исключение в проекте — Яндекс.Браузер).
- **Полифиллы и фоллбэки** для API: `TextEncoder`→`Blob`→`length`, `AbortController`,
  `sendBeacon`→`fetch keepalive`, `function_exists` на сервере.
- Веди **список известных «зависонов»** и обходов (Яндекс: не грузит большие
  тела; hence Range + hedge + `no-transform`).
- Проверяй `prefers-reduced-motion`, тёмную тему, мобильный viewport в e2e.

---

## 15. Приложения: рабочие чек-листы

### 15.1 Старт нового проекта

- [ ] Стек и структура по §1; `strict` TS, `declare(strict_types=1)`.
- [ ] Дизайн-токены в `:root`; тёмная тема; иконки-набор.
- [ ] `secrets.example.php` + `private/.htaccess` + `private/.gitignore`.
- [ ] Единый контракт ошибок (`json_out`/`fail`, клиентский `ApiError`).
- [ ] Терминальный лог + `window.__APP_READY__` + `/diag`.
- [ ] Shell-загрузчик: нет тега бандла, цепочка источников, таймауты.
- [ ] `.htaccess` no-transform/no-gzip для `.js/.css`.
- [ ] Скрипты сборки + `build:shell` + авто-зеркала.
- [ ] E2E-каркас (CDP) + моки внешних сервисов.

### 15.2 Перед каждым релизом

См. §10.3.

### 15.3 Безопасность

- [ ] Cookie `HttpOnly/SameSite/Secure`; регенерация id; `session_write_close`.
- [ ] `password_hash`/`password_verify`/`hash_equals`.
- [ ] Rate-limit (IP + глобальный) для auth; POST для logout; CSRF/Origin.
- [ ] Секреты вне webroot, `0600/0700`, не в git.
- [ ] Ошибки наружу — обобщённо; детали — в лог.
- [ ] Валидация ввода; allowlist + `realpath` для файлов; нет generic-прокси.
- [ ] CSP/HSTS/Referrer-Policy/Permissions-Policy/nosniff.
- [ ] `/diag`: cap + rate-limit + ротация; без PII сверх необходимого.

### 15.4 Доступность

- [ ] `aria-label`/`title` у иконок; `aria-expanded/pressed/current/busy`.
- [ ] Видимый фокус; focus-trap в модалках; возврат фокуса.
- [ ] Закрытие по `Escape`; клик вне.
- [ ] `prefers-reduced-motion`.
- [ ] Скринридер-проверка ключевых потоков (вход, список, модалка).

### 15.5 Производительность

- [ ] Бюджет бандла; без лишних зависимостей.
- [ ] Ленивые изображения + размеры.
- [ ] Кэш/SWR; один запрос на страницу под лимит API.
- [ ] Ограничение DOM (скелетоны, лог).
- [ ] Троттлинг и серверный кэш.

### 15.6 Отказоустойчивость

- [ ] У каждой загрузки — таймаут на заголовки и на тело.
- [ ] Нет тега основного бандла; цепочка источников + последняя заглушка.
- [ ] Range + hedging + сторож прогресса (если хостинг/браузер капризны).
- [ ] Кэш content-addressed с вытеснением; self-heal пустых файлов.
- [ ] Блокировки тяжёлых задач; деградация вместо падения.
- [ ] `function_exists` вокруг внешних расширений; UTF-8-safe запись.

---

*Документ живой: при появлении новых грабель — добавляй рецепт и, при
необходимости, пункт в чек-лист. Ориентир — реальный код
[`vk-photo-api`](../README.md).*
