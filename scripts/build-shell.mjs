/* Пост-обработка результата сборки Vite:
 * превращает индексный index.html в отказоустойчивый загрузчик.
 *
 * Ассеты ищем сканированием каталога assets/ (не полагаемся на разметку
 * index.html), основной бандл подключаем классическим <script> — сборка идёт
 * в формате IIFE, это самый совместимый способ для старых движков.
 * Источники зеркал перечисляются в web/shell-config.js, его копия ложится
 * рядом с index.html уже на сервере.
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync, copyFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const webDir = path.join(root, "web");
const assetsDir = path.join(root, "assets");

function findAsset(re) {
  let best = null;
  let bestMtime = -1;
  for (const name of readdirSync(assetsDir)) {
    if (!re.test(name) || name.endsWith(".map")) continue;
    const mtime = statSync(path.join(assetsDir, name)).mtimeMs;
    if (mtime > bestMtime) {
      best = name;
      bestMtime = mtime;
    }
  }
  return best;
}

const jsName = findAsset(/^app-.*\.js$/i);
const cssName = findAsset(/^app-.*\.css$/i);
if (!jsName || !cssName) {
  console.error("build-shell: не найдены assets/app-*.js и app-*.css (сначала запустите vite build)");
  process.exit(1);
}

const builtHtml = readFileSync(path.join(root, "index.html"), "utf8");
const titleMatch = builtHtml.match(/<title>([^<]*)<\/title>/);
const title = titleMatch ? titleMatch[1] : "Фото ВК";

const runtime = readFileSync(path.join(webDir, "shell-runtime.js"), "utf8");

const configInline = `window.__VK_SHELL_CONFIG__ = {
  js: "./assets/${jsName}",
  css: "./assets/${cssName}",
  timeoutMs: 8000,
  primaryTimeoutMs: 6000,
  fallbackGraceMs: 4000,
  readyWatchdogMs: 20000
};`;

const shellHtml = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      html, body { margin: 0; height: 100%; background: #0f1115; }
      body.shell-busy, body.shell-busy * { cursor: progress !important; }
      .is-hidden { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }

      #shell-overlay {
        position: fixed; inset: 0; z-index: 9990; display: grid; place-items: center;
        background: #0f1115; transition: opacity .35s ease, visibility .35s ease;
      }
      #shell-overlay .shell-spin {
        width: 44px; height: 44px; border-radius: 50%;
        border: 4px solid rgba(76, 139, 245, 0.25); border-top-color: #4c8bf5;
        animation: shellspin .7s linear infinite;
      }
      @keyframes shellspin { to { transform: rotate(360deg); } }

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
      .shell-log__line { white-space: pre-wrap; word-break: break-word; }
      .shell-log__line--info { color: #9aa3b2; }
      .shell-log__line--ok { color: #4ade80; }
      .shell-log__line--warn { color: #fbbf24; }
      .shell-log__line--error { color: #f87171; }
      .shell-log__line--net { color: #60a5fa; }

      #shell-log-toggle {
        position: fixed; right: 14px; bottom: 14px; z-index: 10003;
        padding: 6px 12px; border-radius: 999px; border: 1px solid #2a2f3a;
        background: #181b22; color: #9aa3b2; font: 12px system-ui, sans-serif;
        cursor: pointer; opacity: .55; transition: opacity .2s ease;
      }
      #shell-log-toggle:hover { opacity: 1; }

      #shell-fallback {
        position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center;
        padding: 24px; background: #0f1115; color: #e7e9ee;
        font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: center;
        transition: opacity .3s ease, visibility .3s ease;
      }
      #shell-fallback .card { max-width: 480px; }
      #shell-fallback code { color: #9aa3b2; word-break: break-word; }
      #shell-fallback .shell-btn {
        font: inherit; color: #fff; background: #2f6ae0; border: none; border-radius: 10px;
        padding: 10px 18px; cursor: pointer;
      }
      [hidden] { display: none !important; }
    </style>
    <link rel="stylesheet" href="./assets/${cssName}" />
    <script>${configInline}</script>
    <script>window.__VK_SHELL_EARLY_ERRORS__=[];window.addEventListener("error",function(e){var a=window.__VK_SHELL_EARLY_ERRORS__;if(a&&a.length<50)a.push(e);},true);</script>
  </head>
  <body class="shell-busy">
    <div id="root"></div>
    <div id="shell-overlay" aria-hidden="true"><div class="shell-spin"></div></div>
    <div id="shell-log" role="log" aria-live="polite"></div>
    <button id="shell-log-toggle" class="is-hidden" type="button">лог</button>
    <div id="shell-fallback" class="is-hidden">
      <div class="card">
        <p>Интерфейс не удалось загрузить ни из локальных копий, ни из CDN-зеркал.</p>
        <p><code id="shell-fallback-detail"></code></p>
        <p><button class="shell-btn" onclick="location.reload()">Повторить</button></p>
      </div>
    </div>
    <noscript>Для работы интерфейса нужен включённый JavaScript.</noscript>
    <script src="./shell-config.js"></script>
    <script>${runtime}</script>
    <script src="./assets/${jsName}"></script>
  </body>
</html>
`;

writeFileSync(path.join(root, "index.html"), shellHtml);
copyFileSync(path.join(webDir, "shell-config.js"), path.join(root, "shell-config.js"));

let removed = 0;
try {
  const keep = new Set([jsName, cssName, `${jsName}.map`, `${cssName}.map`]);
  for (const name of readdirSync(assetsDir)) {
    if (!keep.has(name)) {
      unlinkSync(path.join(assetsDir, name));
      removed++;
    }
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

console.log(`build-shell: собран отказоустойчивый index.html (${jsName}, ${cssName}${removed ? `, удалено ассетов: ${removed}` : ""})`);
