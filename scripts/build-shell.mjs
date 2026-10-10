/* Пост-обработка результата сборки Vite:
 * превращает индексный index.html в отказоустойчивый загрузчик.
 * Источники ресурсов перечисляются в web/shell-config.js,
 * его копия ложится рядом с index.html уже на сервере.
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const webDir = path.join(root, "web");

const builtHtml = readFileSync(path.join(root, "index.html"), "utf8");

const cssMatch = [...builtHtml.matchAll(/<link[^>]*href="\.\.?\/?assets\/([^"]+\.css)"/g)].map((m) => m[1]);
const jsMatch = [...builtHtml.matchAll(/<script[^>]*src="\.\.?\/?assets\/([^"]+\.js)"/g)].map((m) => m[1]);

const cssName = cssMatch[cssMatch.length - 1];
const jsName = jsMatch[jsMatch.length - 1];
if (!cssName || !jsName) {
  console.error("build-shell: не найдены ассеты в корневом index.html (сначала запустите vite build)");
  process.exit(1);
}

const runtime = readFileSync(path.join(webDir, "shell-runtime.js"), "utf8");
const titleMatch = builtHtml.match(/<title>([^<]*)<\/title>/);
const title = titleMatch ? titleMatch[1] : "Фото ВК";

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
      #shell-boot {
        position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center;
        background: #0f1115;
      }
      #shell-boot .ring {
        width: 44px; height: 44px; border-radius: 50%;
        border: 4px solid rgba(76, 139, 245, 0.25); border-top-color: #4c8bf5;
        animation: shellspin 0.7s linear infinite;
      }
      @keyframes shellspin { to { transform: rotate(360deg); } }
      #shell-fallback {
        position: fixed; inset: 0; z-index: 9998; display: grid; place-items: center;
        padding: 24px; background: #0f1115; color: #e7e9ee;
        font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: center;
      }
      #shell-fallback .card { max-width: 480px; }
      #shell-fallback code { color: #9aa3b2; word-break: break-word; }
      #shell-fallback .shell-btn {
        font: inherit; color: #fff; background: #2f6ae0; border: none; border-radius: 10px;
        padding: 10px 18px; cursor: pointer;
      }
      [hidden] { display: none !important; }
    </style>
    <script>${configInline}</script>
    <script src="./shell-config.js"></script>
    <script>${runtime}</script>
    <link rel="stylesheet" href="./assets/${cssName}" />
  </head>
  <body class="shell-busy">
    <div id="shell-boot" aria-hidden="true"><div class="ring"></div></div>
    <div id="root"></div>
    <div id="shell-fallback" hidden>
      <div class="card">
        <p>Интерфейс не удалось загрузить ни из локальных копий, ни из CDN-зеркал.</p>
        <p><code id="shell-fallback-detail"></code></p>
        <p><button class="shell-btn" onclick="location.reload()">Повторить</button></p>
      </div>
    </div>
    <noscript>Для работы интерфейса нужен включённый JavaScript.</noscript>
    <script type="module" src="./assets/${jsName}"></script>
  </body>
</html>
`;

writeFileSync(path.join(root, "index.html"), shellHtml);
copyFileSync(path.join(webDir, "shell-config.js"), path.join(root, "shell-config.js"));

const assetsDir = path.join(root, "assets");
let removed = 0;
try {
  const keep = new Set([jsName, cssName]);
  for (const name of readdirSync(assetsDir)) {
    const base = name.replace(/\.map$/, "");
    if (!keep.has(base)) {
      unlinkSync(path.join(assetsDir, name));
      removed++;
    }
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

console.log(`build-shell: собран отказоустойчивый index.html (${jsName}, ${cssName}, перебор зеркал${removed ? `, удалено ассетов: ${removed}` : ""})`);