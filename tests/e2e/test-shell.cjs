/* Функциональные тесты отказоустойчивого загрузчика (без браузера).
 * Модель: HTML не содержит <script src> бандла — загрузчик сам подключает
 * основной источник (PHP-ассет или статику), затем перебирает резервы. */
const fs = require("node:fs");
const assert = require("node:assert");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const runtime = fs.readFileSync(path.join(root, "web", "shell-runtime.js"), "utf8");

function hash(s) {
  let h = 9;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 387420489);
  return (h ^ (h >>> 13)) >>> 0;
}

const JS = "./assets/app-X.js";
const CSS = "./assets/app-Y.css";
const JS_KEY = "vk_shell_js_" + hash(JS);
const CSS_KEY = "vk_shell_css_" + hash(CSS);

function makeEl(tag) {
  const classes = new Set();
  const children = [];
  const node = {
    tagName: tag.toUpperCase(),
    type: "", src: "", href: "", rel: "", textContent: "", className: "", crossOrigin: "",
    onload: null, onerror: null, hidden: false,
    scrollTop: 0, scrollHeight: 0,
    childNodes: children,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => {
        if (on === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); }
        else if (on) classes.add(c); else classes.delete(c);
      },
    },
    appendChild(child) { children.push(child); return child; },
    removeChild(child) { const i = children.indexOf(child); if (i >= 0) children.splice(i, 1); return child; },
    get firstChild() { return children[0] || null; },
    setAttribute(k, v) { this._attrs = this._attrs || {}; this._attrs[k] = v; },
    getAttribute(k) { return (this._attrs && this._attrs[k]) || null; },
    remove() {},
  };
  Object.defineProperty(node, "_classes", { value: classes, enumerable: false });
  return node;
}

function makeEnv({ localStorage: ls = {}, mirrors = {}, fetchText = null, hangBody = false, asset = "", diag = "", ready = false, navigatorUA = "", rangeFlakeFirst = 0, hangRangesFirst = 0, slowFirstRangeMs = 0, evalInline = false } = {}) {
  const storage = new Map(Object.entries(ls));
  const yielded = { scripts: [], links: [], styles: [] };
  const fetchCalls = [];
  let rangeFails = 0;
  let rangeHangs = 0;
  let rangeSeen = 0;
  const listeners = {};
  const els = {
    "shell-overlay": makeEl("div"),
    "shell-log": makeEl("div"),
    "shell-log-toggle": makeEl("button"),
    "shell-fallback": makeEl("div"),
    "shell-fallback-detail": makeEl("code"),
  };
  els["shell-fallback"].classList.add("is-hidden");
  els["shell-log-toggle"].classList.add("is-hidden");

  function capture(node) {
    if (node.tagName === "STYLE") yielded.styles.push(node);
    else if (node.tagName === "SCRIPT") yielded.scripts.push(node);
    else if (node.tagName === "LINK") yielded.links.push(node);
    if (evalInline && node.tagName === "SCRIPT" && !node.src && node.textContent) {
      try { Function("window", node.textContent)(windowObj); } catch (e) {}
    }
    return node;
  }

  const body = makeEl("body");
  body.appendChild = capture;

  const windowObj = {
    __VK_SHELL_CONFIG__: {
      js: JS,
      css: CSS,
      asset: asset,
      diag: diag,
      timeoutMs: 100,
      primaryTimeoutMs: 120,
      fallbackGraceMs: 80,
      postInjectTimeoutMs: 100,
      readyWatchdogMs: 20000,
      rangeChunkBytes: 64,
      rangePool: 2,
      rangeTimeoutMs: 120,
      rangeRetries: 5,
      rangeRetryDelayMs: 20,
      rangeHedgeMs: 40,
      mirrorTimeoutMs: 120,
    },
    __VK_SHELL_MIRRORS__: mirrors,
    __APP_READY__: !!ready,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
      key: (i) => Array.from(storage.keys())[i] ?? null,
      get length() { return storage.size; },
    },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
  };

  const documentObj = {
    head: { appendChild: capture },
    body,
    createElement: makeEl,
    getElementById: (id) => els[id] || (els[id] = makeEl("div")),
  };

  const navigatorObj = { userAgent: navigatorUA };

  const fetchMock = async (url, opts) => {
    opts = opts || {};
    fetchCalls.push({ url, opts });
    const full = fetchText || `/* bundle ${url} */ ${"x".repeat(1000)}`;
    const hdrs = new Map();
    hdrs.set("content-type", "text/javascript");
    const range = opts.headers && opts.headers.Range;
    if (range && /^bytes=(\d+)-(\d+)$/.test(range)) {
      rangeSeen++;
      if (hangRangesFirst > 0 && rangeHangs < hangRangesFirst) {
        rangeHangs++;
        return new Promise(() => {});
      }
      if (rangeFlakeFirst > 0 && rangeFails < rangeFlakeFirst) {
        rangeFails++;
        return {
          ok: false,
          status: 500,
          headers: { get: () => null },
          text: async () => "",
        };
      }
      const m = range.match(/^bytes=(\d+)-(\d+)$/);
      const a = +m[1];
      const b = Math.min(+m[2], full.length - 1);
      const body = full.slice(a, b + 1);
      hdrs.set("content-range", `bytes ${a}-${b}/${full.length}`);
      const slow = slowFirstRangeMs > 0 && rangeSeen === 1;
      return {
        ok: true,
        status: 206,
        headers: { get: (k) => hdrs.get(String(k).toLowerCase()) || null },
        text: async () => { if (slow) await wait(slowFirstRangeMs); return body; },
      };
    }
    if (hangBody) {
      return {
        ok: true,
        status: 200,
        headers: { get: (k) => hdrs.get(String(k).toLowerCase()) || null },
        text: () => new Promise(() => {}),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (k) => hdrs.get(String(k).toLowerCase()) || null },
      text: async () => full,
    };
  };

  Function(
    "window,document,Blob,URL,fetch,setTimeout,clearTimeout,console,navigator",
    runtime,
  )(
    windowObj,
    documentObj,
    class Blob { constructor(parts) { this.len = parts.join("").length; } },
    { createObjectURL: () => "blob:mock:" + (yielded.scripts.length + 1), revokeObjectURL() {} },
    fetchMock,
    setTimeout,
    clearTimeout,
    { log() {}, warn() {}, error() {} },
    navigatorObj,
  );

  return {
    yielded,
    storage,
    fetchCalls,
    els,
    windowObj,
    dispatch(type, event) { (listeners[type] || []).forEach((fn) => fn(event)); },
    get fallbackVisible() { return !els["shell-fallback"].classList.contains("is-hidden"); },
    get fallbackCode() { return els["shell-fallback-detail"].textContent; },
    get overlayVisible() { return !els["shell-overlay"].classList.contains("is-hidden"); },
    get logVisible() { return !els["shell-log"].classList.contains("is-hidden"); },
    inlineScripts() { return yielded.scripts.filter((s) => !s.src); },
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const primaryJs = { target: { tagName: "SCRIPT", src: "http://host/assets/app-X.js" } };
const primaryCss = { target: { tagName: "LINK", href: "http://host/assets/app-Y.css" } };
const encode = (s) => encodeURIComponent(s);

(async () => {
  // 1. Загрузчик сам подключает основной JS; оверлей виден сразу, лог пишется.
  {
    const e = makeEnv({});
    assert.equal(e.yielded.scripts.length, 1, "загрузчик должен подключить основной js");
    assert.equal(e.yielded.scripts[0].src, JS);
    assert.equal(e.yielded.links.length, 0, "css основной — статическим <link>, не через загрузчик");
    assert.ok(e.overlayVisible, "оверлей виден сразу");
    assert.ok(e.els["shell-log"].childNodes.length > 0, "лог пишется");
    console.log("1. самоподключение основного бандла + оверлей + лог: OK");
  }

  // 2. Ошибка основного js -> нет зеркал/кэша -> fetch+инлайн -> заглушка.
  {
    const e = makeEnv({});
    e.dispatch("error", primaryJs);
    await wait(450);
    assert.ok(e.inlineScripts().length >= 1, "должен сработать резервный fetch+инлайн");
    assert.ok(e.inlineScripts()[0].textContent.length > 600);
    assert.ok(e.fallbackVisible, "должна появиться заглушка");
    assert.equal(e.fallbackCode, "RESOURCES_UNAVAILABLE");
    console.log("2. заглушка при недоступном основном js: OK");
  }

  // 3. Основной js не отвечает (таймаут) -> копия из localStorage (инлайн).
  {
    const e = makeEnv({ localStorage: { [JS_KEY]: "/*b*/" + "x".repeat(900) } });
    await wait(160);
    assert.ok(e.inlineScripts().length >= 1, "должна подключиться копия из хранилища");
    assert.ok(e.inlineScripts()[0].textContent.length > 600);
    console.log("3. таймаут основного -> копия из localStorage: OK");
  }

  // 4. Успешный запуск сразу: __APP_READY__ -> оверлей скрыт, заглушки нет,
  //    основной js не подключается (приложение уже готово).
  {
    const e = makeEnv({ ready: true });
    await wait(400);
    assert.ok(!e.fallbackVisible, "не должно быть заглушки");
    assert.ok(!e.overlayVisible, "оверлей должен скрыться");
    assert.equal(e.yielded.scripts.length, 0, "не должно быть загрузок, если приложение уже готово");
    console.log("4. мгновенный успешный запуск: OK");
  }

  // 5. Восстановление: заглушку показали, затем приложение поднялось -> прячем.
  {
    const e = makeEnv({});
    e.dispatch("error", primaryJs);
    await wait(400);
    assert.ok(e.fallbackVisible, "сначала заглушка");
    e.windowObj.__APP_READY__ = true;
    await wait(400);
    assert.ok(!e.fallbackVisible, "заглушка должна скрыться");
    console.log("5. восстановление после заглушки: OK");
  }

  // 6. Резерв: CDN-зеркало.
  {
    const e = makeEnv({ mirrors: { js: ["https://cdn.a/b.js"] } });
    e.dispatch("error", primaryJs);
    await wait(20);
    assert.equal(e.yielded.scripts.length, 2);
    assert.equal(e.yielded.scripts[1].src, "https://cdn.a/b.js");
    console.log("6. перебор CDN-зеркала: OK");
  }

  // 7. Резерв: зеркало через прокси (после сбоя прямого зеркала).
  {
    const e = makeEnv({ mirrors: { js: ["https://cdn.a/b.js"], proxies: ["https://p/?u={{URL}}"] } });
    e.dispatch("error", primaryJs);
    await wait(180);
    assert.equal(e.yielded.scripts.length, 3);
    assert.equal(e.yielded.scripts[2].src, "https://p/?u=https%3A%2F%2Fcdn.a%2Fb.js");
    console.log("7. перебор прокси для зеркала: OK");
  }

  // 8. Сбой css -> резервная копия из localStorage.
  {
    const e = makeEnv({ localStorage: { [CSS_KEY]: "/* c */" + "y".repeat(700) } });
    e.dispatch("error", primaryCss);
    await wait(20);
    assert.ok(e.yielded.styles.length >= 1);
    assert.ok(e.yielded.styles[0].textContent.length > 600);
    console.log("8. резервный css из localStorage: OK");
  }

  // 9. После готовности основной бандл кэшируется в localStorage.
  {
    const e = makeEnv({ ready: true });
    await wait(400);
    assert.ok(e.storage.has(JS_KEY), "js должен закэшироваться");
    assert.ok(e.storage.has(CSS_KEY), "css должен закэшироваться");
    console.log("9. кэширование бандла для офлайна: OK");
  }

  // 10. Публичный API __VK_LOADER__ доступен приложению.
  {
    const e = makeEnv({});
    assert.equal(typeof e.windowObj.__VK_LOADER__.log, "function");
    assert.equal(typeof e.windowObj.__VK_LOADER__.end, "function");
    assert.equal(typeof e.windowObj.__VK_LOADER__.restart, "function");
    e.windowObj.__VK_LOADER__.ok("тест");
    assert.ok(e.els["shell-log"].childNodes.length >= 2);
    console.log("10. API window.__VK_LOADER__: OK");
  }

  // 11. shell-config.js не считается основным ресурсом (не запускает резерв).
  {
    const e = makeEnv({});
    e.dispatch("error", { target: { tagName: "SCRIPT", src: "http://host/shell-config.js" } });
    await wait(30);
    assert.equal(e.yielded.scripts.length, 1, "ошибка shell-config.js не должна запускать резерв");
    assert.ok(!e.fallbackVisible, "ошибка shell-config.js не должна приводить к заглушке");
    console.log("11. ошибка shell-config.js игнорируется: OK");
  }

  // 12. «Тихая» блокировка: ни load, ни error у бандла -> таймаут основного
  //     -> fetch+инлайн -> заглушка (без событий).
  {
    const e = makeEnv({});
    await wait(650);
    assert.ok(e.inlineScripts().length >= 1, "таймаут должен запустить резерв");
    assert.ok(e.fallbackVisible, "должна появиться заглушка");
    console.log("12. таймаут основного без событий: OK");
  }

  // 13. PHP-ассет как основной источник (gzip), статика — первый резерв.
  {
    const e = makeEnv({ asset: "./api.php?action=asset" });
    assert.ok(e.yielded.scripts[0].src.indexOf("./api.php?action=asset") === 0, "основной должен идти через PHP");
    assert.ok(e.yielded.scripts[0].src.indexOf("f=" + encode("app-X.js")) !== -1, "в параметре f должно быть имя файла бандла");
    e.dispatch("error", primaryJs);
    await wait(20);
    assert.equal(e.yielded.scripts[1].src, JS, "первый резерв — статический файл");
    console.log("13. PHP-ассет основным источником + резерв статикой: OK");
  }

  // 14. restart(): очищает лог, показывает оверлей, прячет заглушку.
  {
    const e = makeEnv({});
    e.dispatch("error", primaryJs);
    await wait(400);
    assert.ok(e.fallbackVisible, "подготовка: заглушка видна");
    e.windowObj.__VK_LOADER__.restart();
    assert.ok(!e.fallbackVisible, "restart должен спрятать заглушку");
    assert.ok(e.overlayVisible, "restart должен показать оверлей");
    assert.ok(e.els["shell-log"].childNodes.length <= 2, "restart должен очистить лог");
    console.log("14. restart() для кнопки «Повторить»: OK");
  }

  // 15. Маячок диагностики уходит на action=diag при сбое.
  {
    const e = makeEnv({ diag: "./api.php?action=diag" });
    e.dispatch("error", primaryJs);
    await wait(700);
    assert.ok(
      e.fetchCalls.some((c) => String(c.url).indexOf("action=diag") !== -1),
      "диагностика должна отправляться на action=diag",
    );
    console.log("15. маячок диагностики: OK");
  }

  // 16. Яндекс.Браузер: основной путь — Range-куски (без <script src>),
  //     бандл собирается из маленьких ответов и выполняется инлайн.
  {
    const marker = "YANDEX_RANGE_MARKER==";
    const src = marker + "x".repeat(500);
    const e = makeEnv({
      asset: "./api.php?action=asset",
      fetchText: src,
      navigatorUA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) YaBrowser/24.7 Safari/537.36",
    });
    await wait(400);
    assert.equal(e.yielded.scripts.filter((s) => s.src).length, 0, "в Яндексе не должно быть внешних <script src>");
    assert.ok(e.inlineScripts().length >= 1, "должен выполниться инлайн-бандл");
    assert.equal(e.inlineScripts()[0].textContent, src, "бандл должен быть собран из диапазонов целиком");
    assert.ok(
      e.fetchCalls.some((c) => c.opts.headers && c.opts.headers.Range),
      "должны идти Range-запросы",
    );
    console.log("16. Яндекс: Range-загрузка бандла: OK");
  }

  // 17. Обычный браузер (не Яндекс): классический путь — скрипт-тег PHP-ассета.
  {
    const e = makeEnv({ asset: "./api.php?action=asset", navigatorUA: "Chrome/131.0 Mozilla/5.0" });
    assert.equal(e.yielded.scripts.length, 1);
    assert.ok(e.yielded.scripts[0].src.indexOf("./api.php?action=asset") === 0);
    console.log("17. обычный браузер: скрипт-тег PHP-ассета: OK");
  }

  // 18. Тело ответа «зависло» (200 пришёл, байты нет) -> таймаут чтения
  //     -> Range-сборка бандла выполняется инлайн.
  {
    const e = makeEnv({ hangBody: true });
    await wait(900);
    assert.ok(e.inlineScripts().length >= 1, "после зависшего тела должен сработать Range-режим");
    assert.ok(e.inlineScripts()[0].textContent.length > 600, "Range-бандл должен собраться целиком");
    assert.ok(e.inlineScripts()[0].textContent.indexOf("/* bundle ") === 0, "содержимое должно быть исходным бандлом");
    assert.ok(
      e.fetchCalls.some((c) => c.opts.headers && c.opts.headers.Range),
      "должны идти Range-запросы",
    );
    console.log("18. зависшее тело -> Range-сборка: OK");
  }

  // 19. В Яндексе первый Range-кусок отдаётся с ошибкой -> ретрай -> сборка.
  {
    const marker = "YANDEX_RECOVER==";
    const src = marker + "y".repeat(500);
    const e = makeEnv({
      asset: "./api.php?action=asset",
      fetchText: src,
      navigatorUA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) YaBrowser/24.7 Safari/537.36",
      rangeFlakeFirst: 1,
    });
    await wait(600);
    assert.ok(e.inlineScripts().length >= 1, "упавший кусок должен быть докачан ретраем");
    assert.equal(e.inlineScripts()[0].textContent, src, "собранный бандл должен содержать все куски");
    assert.ok(
      e.fetchCalls.filter((c) => c.opts.headers && c.opts.headers.Range).length >= 3,
      "должно быть несколько Range-запросов (проба + куски + ретрай)",
    );
    console.log("19. Яндекс: ретрай упавшего куска: OK");
  }

  // 20. Яндекс: первые Range-запросы «висят» (таймаут) -> ретраи -> сборка.
  {
    const marker = "YANDEX_STALL==";
    const src = marker + "z".repeat(500);
    const e = makeEnv({
      asset: "./api.php?action=asset",
      fetchText: src,
      navigatorUA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) YaBrowser/24.7 Safari/537.36",
      hangRangesFirst: 2,
    });
    await wait(1200);
    assert.ok(e.inlineScripts().length >= 1, "после зависших Range-запросов бандл должен собраться");
    assert.equal(e.inlineScripts()[0].textContent, src, "бандл должен собраться целиком, без дыр");
    console.log("20. Яндекс: зависшие Range-куски -> ретраи: OK");
  }

  // 21. Яндекс: бандл уже в localStorage -> инлайн сразу, без Range-запросов.
  {
    const cached = "YANDEX_CACHED==" + "c".repeat(700);
    const e = makeEnv({
      asset: "./api.php?action=asset",
      localStorage: { [JS_KEY]: cached },
      navigatorUA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) YaBrowser/24.7 Safari/537.36",
    });
    await wait(40);
    assert.ok(e.inlineScripts().length >= 1, "кэш должен выполниться инлайном");
    assert.equal(e.inlineScripts()[0].textContent, cached, "содержимое из localStorage");
    assert.ok(
      !e.fetchCalls.some((c) => c.opts.headers && c.opts.headers.Range),
      "при наличии кэша Range-запросы не нужны",
    );
    console.log("21. Яндекс: мгновенный запуск из localStorage: OK");
  }

  // 22. Яндекс: первый запрос куска «медленный» -> дубль (hedge) отвечает
  //     раньше и выигрывает; сборка завершается, не дожидаясь слоу-запроса.
  {
    const marker = "YANDEX_HEDGE==";
    const src = marker + "h".repeat(500);
    const e = makeEnv({
      asset: "./api.php?action=asset",
      fetchText: src,
      navigatorUA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) YaBrowser/24.7 Safari/537.36",
      slowFirstRangeMs: 400,
    });
    const t0 = Date.now();
    await wait(250);
    const elapsed = Date.now() - t0;
    assert.ok(e.inlineScripts().length >= 1, "дубль должен позволить собрать бандл");
    assert.equal(e.inlineScripts()[0].textContent, src, "бандл должен собраться целиком");
    assert.ok(elapsed < 300, "не должны ждать медленный запрос (ждали " + elapsed + "мс)");
    console.log("22. Яндекс: hedge-дубль обгоняет зависший кусок: OK");
  }

  // 23. Яндекс + настроенные зеркала: бандл берётся с CDN одним запросом,
  //     Range-куски не нужны, результат кладётся в localStorage.
  {
    const src = "window.__APP_READY__ = true;\n/*" + "m".repeat(900) + "*/";
    const mirror = "https://cdn.jsdelivr.net/gh/u/r@main/assets/app-X.js";
    const e = makeEnv({
      asset: "./api.php?action=asset",
      mirrors: { js: [mirror], css: [] },
      fetchText: src,
      evalInline: true,
      navigatorUA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) YaBrowser/24.7 Safari/537.36",
    });
    await wait(80);
    assert.ok(e.fetchCalls.some((c) => c.url === mirror), "должен быть запрос к зеркалу");
    const m = e.inlineScripts().find((s) => s.getAttribute("data-shell-source") === "mirror");
    assert.ok(m, "бандл должен выполниться из зеркала");
    assert.equal(m.textContent, src);
    assert.ok(!e.fallbackVisible, "заглушки быть не должно");
    assert.ok(e.storage.has(JS_KEY), "бандл с зеркала должен закэшироваться");
    assert.ok(
      !e.fetchCalls.some((c) => c.opts.headers && c.opts.headers.Range),
      "при рабочем зеркале Range-куски не нужны",
    );
    console.log("23. Яндекс: бандл с CDN-зеркала без Range: OK");
  }

  // 24. Резерв перебирает зеркала раньше статики (статика на медленном
  //     хостинге как раз и подвисает).
  {
    const mirror = "https://fastly.jsdelivr.net/gh/u/r@main/assets/app-X.js";
    const e = makeEnv({
      asset: "./api.php?action=asset",
      mirrors: { js: [mirror], css: [] },
    });
    e.dispatch("error", primaryJs);
    await wait(30);
    assert.equal(e.yielded.scripts[1].src, mirror, "после основного должен идти CDN-зеркало");
    assert.notEqual(e.yielded.scripts[1].src, JS, "статика не должна опережать зеркало");
    console.log("24. Резерв: зеркало раньше статики: OK");
  }

  console.log("\nВсе тесты загрузчика прошли.");
  process.exit(0);
})().catch((err) => { console.error("ТЕСТ ПРОВАЛЕН:", err.message); process.exit(1); });
