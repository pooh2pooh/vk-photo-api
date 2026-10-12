/* Конфигурация зеркал ресурсов интерфейса.
 * Файл ложится рядом с index.html. Массивы js/css подставляются на сборке
 * (scripts/build-shell.mjs) из git-remotes. На сервере файл можно править
 * руками: добавьте свои зеркала (GitHub Pages, Cloudflare Pages, Netlify
 * и т.п.) — загрузчик переберёт их по очереди.
 *
 * Загрузчик открывает приложение из цепочки (быстрое → медленное):
 *   localStorage → CDN-зеркало (один запрос) → php api.php?action=asset (gzip)
 *   → ./assets/ → Range-куски → зеркала через прокси → fetch+инлайн.
 */
window.__VK_SHELL_MIRRORS__ = {
  /* Режим раздачи бандла. Значения:
   *   "mirror" — основной источник CDN-зеркало (для хостинга вне РФ);
   *   "origin" — основной источник сам хостинг (для сервера в РФ);
   *   "auto"   — "mirror", если зеркала заданы, иначе "origin".
   * На сервере это поле можно менять вручную без пересборки —
   * см. docs/DEPLOYMENT.md (скрипт serving-mode). */
  mode: %%SERVE_MODE%%,

  /* Зеркала JS-бандла (полные URL или относительные пути). */
  js: %%JS_MIRRORS%%,

  /* Зеркала CSS-бандла. */
  css: %%CSS_MIRRORS%%,

  /* Прокси: если прямой доступ к CDN блокируется, те же зеркала
   * перебираются через эти бесплатные CORS/прокси. Плейсхолдер {{URL}}
   * заменяется на полный URL ресурса. */
  proxies: [
    "https://api.allorigins.win/raw?url={{URL}}",
    "https://corsproxy.io/?url={{URL}}",
    "https://api.codetabs.com/v1/proxy?quest={{URL}}",
  ],
};
