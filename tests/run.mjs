/*
 * Раннер e2e-тестов (см. docs/DEVELOPMENT.md §11).
 *
 * Поднимает PHP-сервер и локальные моки внешних сервисов, запускает headless
 * Chrome с CDP и последовательно прогоняет сценарии из tests/e2e. Секреты
 * для каждого сценария берутся из tests/secrets/*.php и временно копируются
 * в private/secrets.php (исходный файл восстанавливается в конце).
 *
 * Использование:
 *   node tests/run.mjs               # все сценарии
 *   node tests/run.mjs stacks-ai     # только указанные (по имени)
 *   node tests/run.mjs --list        # список сценариев
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tmpDir = path.join(__dirname, ".tmp");
const secretsPath = path.join(root, "private", "secrets.php");
const chromeProfile = path.join(tmpDir, "chrome-profile");

const PHP_PORT = 8090;
const CDP_PORT = 9222;
const MOCKS = [
  { name: "mock-vk", file: "mocks/mock-vk.cjs", port: 9310 },
  { name: "mock-ai", file: "mocks/mock-ai.cjs", port: 1310 },
  { name: "mock-quota", file: "mocks/mock-quota.cjs", port: 1313 },
];

const SUITES = [
  { name: "shell", file: "test-shell.cjs", browser: false },
  { name: "base", file: "cdp-test.cjs", secrets: "base", browser: true },
  { name: "features", file: "cdp-test-features.cjs", secrets: "base", browser: true },
  { name: "menu", file: "cdp-test-menu.cjs", secrets: "base", browser: true },
  { name: "bad", file: "cdp-test-bad.cjs", secrets: "base", browser: true, vkMode: "emptylater" },
  { name: "fallback-noai", file: "cdp-test-fallback.cjs", secrets: "base", browser: true, env: { FB_MODE: "noai" } },
  { name: "quota", file: "cdp-test-fallback.cjs", secrets: "quota", browser: true, env: { FB_MODE: "quota" } },
  { name: "stacks-ai", file: "cdp-test-stacks.cjs", secrets: "ai", browser: true },
];

const args = process.argv.slice(2);
if (args.includes("--list")) {
  console.log(SUITES.map((s) => s.name).join("\n"));
  process.exit(0);
}
const selected = args.length ? SUITES.filter((s) => args.includes(s.name)) : SUITES;
if (selected.length === 0) {
  console.error("Нет сценариев по фильтру:", args.join(", "));
  process.exit(1);
}

const children = [];
const mockProcs = {};
let chromeChild = null;
let vkMode = "normal";
let secretsBackup = null;
let hadSecrets = false;

function log(msg) {
  console.log(`\n[tests] ${msg}`);
}

function killPort(port) {
  spawnSync("fuser", ["-k", `${port}/tcp`], { stdio: "ignore" });
}

function startMock(mock, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(__dirname, mock.file)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv },
  });
  child.stdout.on("data", (d) => process.stdout.write(`  ${mock.name}: ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`  ${mock.name}: ${d}`));
  children.push(child);
  mockProcs[mock.name] = child;
  return child;
}

/* Сценарии могут требовать другой режим VK-мока (например, bad — пустые
   ответы после offset 100). Перезапускаем mock-vk только при смене режима. */
function ensureVkMode(mode) {
  const wanted = mode || "normal";
  if (wanted === vkMode) return;
  const mock = MOCKS.find((m) => m.name === "mock-vk");
  const child = mockProcs[mock.name];
  if (child) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
  killPort(mock.port);
  startMock(mock, { MOCK_MODE: wanted });
  vkMode = wanted;
  log(`VK-мок перезапущен (MOCK_MODE=${wanted})`);
}

function startPhp() {
  const child = spawn("php", ["-S", `127.0.0.1:${PHP_PORT}`, "-t", root], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  children.push(child);
  return child;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "google-chrome-stable",
    "google-chrome",
    "chromium",
    "chromium-browser",
  ].filter(Boolean);
  for (const bin of candidates) {
    const res = spawnSync(bin, ["--version"], { stdio: "ignore" });
    if (!res.error) return bin;
  }
  return null;
}

function startChrome() {
  const bin = findChrome();
  if (!bin) {
    throw new Error("Chrome/Chromium не найден. Установите google-chrome-stable или задайте CHROME_BIN.");
  }
  const child = spawn(
    bin,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${chromeProfile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  children.push(child);
  chromeChild = child;
  return child;
}

/* Каждый браузерный сценарий получает свежий Chrome со своим профилем:
   иначе между сценариями протекает состояние (localStorage, эмуляция
   mobile-вьюпорта из menu, зависший после краша рендерер). */
function stopChrome() {
  if (chromeChild) {
    try {
      chromeChild.kill("SIGTERM");
    } catch {}
    chromeChild = null;
  }
  killPort(CDP_PORT);
  rmSync(chromeProfile, { recursive: true, force: true });
}

async function restartChrome(suiteName) {
  stopChrome();
  log(`Chrome: свежий профиль для сценария «${suiteName}»`);
  startChrome();
  await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`, 20000, "CDP");
}

async function waitFor(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      // ещё не поднялось
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Не дождались ${label} (${url})`);
}

function setSecrets(name) {
  if (name === null) return;
  copyFileSync(path.join(__dirname, "secrets", `${name}.php`), secretsPath);
}

const aiCacheDir = path.join(root, "private", "ai-cache");
const pageCacheDir = path.join(root, "private", "cache");

function clearDirContents(dir, filter) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (filter && !filter(entry)) continue;
    try {
      rmSync(path.join(dir, entry), { recursive: true, force: true });
    } catch {}
  }
}

/* Кэш стопок (ai-cache, TTL 12ч) и страниц (cache) живут между сценариями и
   протекают: сборка фоллбэка в одном сценарии переиспользуется в другом, из-за
   чего моки ИИ больше не вызываются. Чистим перед каждым сценарием. */
function resetCaches() {
  clearDirContents(aiCacheDir);
  clearDirContents(pageCacheDir, (name) => name.endsWith(".json"));
}

function runSuite(suite) {
  log(`Сценарий: ${suite.name}${suite.env ? ` (${JSON.stringify(suite.env)})` : ""}`);
  if (suite.secrets) setSecrets(suite.secrets);
  const res = spawnSync(process.execPath, [path.join(__dirname, "e2e", suite.file)], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, QUOTA_LOG: path.join(tmpDir, "quota-calls.txt"), ...(suite.env ?? {}) },
  });
  return res.status === 0;
}

function cleanup() {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
  for (const m of MOCKS) killPort(m.port);
  killPort(PHP_PORT);
  killPort(CDP_PORT);
  if (hadSecrets && secretsBackup !== null) {
    writeFileSync(secretsPath, secretsBackup);
  } else if (!hadSecrets) {
    try {
      rmSync(secretsPath, { force: true });
    } catch {}
  }
}

async function main() {
  mkdirSync(tmpDir, { recursive: true });
  if (existsSync(secretsPath)) {
    secretsBackup = readFileSync(secretsPath);
    hadSecrets = true;
  }

  const needsPhp = selected.some((s) => s.browser);

  log("Гашу порты");
  for (const m of MOCKS) killPort(m.port);
  killPort(PHP_PORT);
  killPort(CDP_PORT);

  log("Поднимаю моки");
  for (const m of MOCKS) startMock(m);
  if (needsPhp) {
    log("Поднимаю PHP");
    startPhp();
    await waitFor(`http://127.0.0.1:${PHP_PORT}/api.php?action=session`, 15000, "PHP");
  }

  const results = [];
  for (const suite of selected) {
    ensureVkMode(suite.vkMode);
    resetCaches();
    if (suite.browser) {
      await restartChrome(suite.name);
    }
    results.push({ name: suite.name, ok: runSuite(suite) });
  }

  log("Итог");
  for (const r of results) console.log(`  ${r.ok ? "OK  " : "FAIL"}  ${r.name}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n[tests] ${results.length - failed.length}/${results.length} сценариев пройдено`);
  return failed.length === 0 ? 0 : 1;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  console.error("[tests] Ошибка раннера:", error.message);
  exitCode = 1;
} finally {
  cleanup();
}
process.exit(exitCode);
