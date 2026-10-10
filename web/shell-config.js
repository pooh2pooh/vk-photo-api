/* Конфигурация зеркал ресурсов интерфейса.
 * Редактируется уже на сервере (этот файл лежит рядом с index.html).
 *
 * Загрузчик открывает приложение из цепочки:
 *   php api.php?action=asset (gzip) → ./assets/ → localStorage → зеркала → зеркала через прокси → fetch+инлайн.
 *
 * Как разложить копии бандла по бесплатным CDN:
 *   1. Заведите публичный GitHub-репозиторий и положите в него папку assets/
 *      с app-<hash>.js и app-<hash>.css.
 *   2. jsDelivr раздаёт содержимое любого GitHub-репозитория бесплатно:
 *      https://cdn.jsdelivr.net/gh/ВАШ_ЛОГИН/ВАШ_РЕПО@main/assets/app-<hash>.js
 *   3. Таких зеркал можно сделать несколько (GitHub Pages, Cloudflare Pages,
 *      Netlify и т.п.) — загрузчик переберёт их по очереди.
 */
window.__VK_SHELL_MIRRORS__ = {
  /* Зеркала JS-бандла (полные URL или относительные пути). */
  js: [
    // "https://cdn.jsdelivr.net/gh/USER/REPO@main/assets/app-<hash>.js",
  ],

  /* Зеркала CSS-бандла. */
  css: [
    // "https://cdn.jsdelivr.net/gh/USER/REPO@main/assets/app-<hash>.css",
  ],

  /* Прокси: если прямой доступ к CDN блокируется, те же зеркала
   * перебираются через эти бесплатные CORS/прокси. Плейсхолдер {{URL}}
   * заменяется на полный URL ресурса. */
  proxies: [
    "https://api.allorigins.win/raw?url={{URL}}",
    "https://corsproxy.io/?url={{URL}}",
    "https://api.codetabs.com/v1/proxy?quest={{URL}}",
  ],
};