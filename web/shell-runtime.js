/* Отказоустойчивый загрузчик интерфейса + встроенный терминальный лог.
 *
 * Основной бандл — классический IIFE, подключается обычным
 * <script src="./assets/app-<hash>.js"> прямо в index.html (самый совместимый
 * способ, работает во всех браузерах, включая Яндекс.Браузер). Этот скрипт:
 *   1) держит единственный постоянный оверлей со спиннером (без перерисовки);
 *   2) ведёт цветной терминальный лог с таймингами (жизненный цикл, запросы,
 *      ответы, ошибки) и отдаёт его наружу через window.__VK_LOADER__;
 *   3) ждёт готовности приложения по флагу window.__APP_READY__ и плавно
 *      скрывает оверлей (CSS opacity/visibility);
 *   4) если основной бандл не запустился — перебирает резервные источники:
 *      копию из localStorage → CDN-зеркала → те же зеркала через прокси;
 *   5) при полном отказе показывает понятную заглушку (без «вечной загрузки»).
 */
(function () {
  "use strict";

  var CONFIG = window.__VK_SHELL_CONFIG__ || {};
  var JS = CONFIG.js || "./assets/app.js";
  var CSS = CONFIG.css || "./assets/app.css";
  var TIMEOUT = CONFIG.timeoutMs || 8000;
  var PRIMARY_TIMEOUT = CONFIG.primaryTimeoutMs || 6000;
  var FALLBACK_GRACE = CONFIG.fallbackGraceMs || 4000;
  var READY_WATCHDOG = CONFIG.readyWatchdogMs || 20000;
  var POST_INJECT_TIMEOUT = CONFIG.postInjectTimeoutMs || 4000;
  var EARLY_FALLBACK = CONFIG.earlyFallbackMs || 1500;
  var MIRRORS = window.__VK_SHELL_MIRRORS__ || {};
  var JS_MIRRORS = MIRRORS.js || [];
  var CSS_MIRRORS = MIRRORS.css || [];
  var PROXIES = MIRRORS.proxies || [];

  var JS_BASE = baseName(JS);
  var CSS_BASE = baseName(CSS);

  var MAX_LOG_LINES = 300;
  var LOG_AUTOHIDE_MS = 1600;

  var doomed = false;
  var ready = false;
  var jsFallbackStarted = false;
  var cssFallbackStarted = false;
  var cachedPrimary = false;
  var pollTimer = null;
  var primaryTimer = null;
  var earlyTimer = null;
  var finalTimer = null;
  var fallbackTimer = null;
  var logHideTimer = null;

  /* ---- время ---- */

  function now() {
    try {
      return window.performance && window.performance.now
        ? window.performance.now()
        : Date.now();
    } catch (e) {
      return Date.now();
    }
  }
  var START = now();

  function stamp() {
    var ms = Math.round(now() - START);
    return "[" + (ms < 10 ? "  " + ms : ms < 100 ? " " + ms : ms) + "ms]";
  }

  /* ---- DOM ---- */

  function $(id) {
    try {
      return document.getElementById(id);
    } catch (e) {
      return null;
    }
  }
  function el(name) {
    try {
      return document.createElement(name);
    } catch (e) {
      return null;
    }
  }
  function mountPoint() {
    return document.body || document.head || document.documentElement;
  }
  function setHidden(node, hidden) {
    if (!node || !node.classList) return;
    if (hidden) node.classList.add("is-hidden");
    else node.classList.remove("is-hidden");
  }
  function bootBusy(on) {
    try {
      if (document.body && document.body.classList) {
        document.body.classList.toggle("shell-busy", on);
      }
    } catch (e) {}
  }

  /* ---- терминальный лог ---- */

  var logEl = null;

  function ensureLog() {
    if (logEl) return logEl;
    logEl = $("shell-log");
    if (!logEl) {
      logEl = el("div");
      if (logEl) {
        logEl.id = "shell-log";
        logEl.className = "shell-log";
        var mp = mountPoint();
        if (mp) mp.appendChild(logEl);
      }
    }
    return logEl;
  }

  function write(level, message) {
    var line = String(message == null ? "" : message);
    try {
      var box = ensureLog();
      if (box) {
        var node = el("div");
        if (node) {
          node.className = "shell-log__line shell-log__line--" + level;
          node.textContent = stamp() + " " + line;
          box.appendChild(node);
          while (box.childNodes && box.childNodes.length > MAX_LOG_LINES) {
            box.removeChild(box.firstChild);
          }
          if (typeof box.scrollTop === "number") box.scrollTop = box.scrollHeight;
        }
      }
    } catch (e) {}
    try {
      var fn = level === "error" ? "error" : level === "warn" ? "warn" : "log";
      if (console && console[fn]) console[fn]("[shell]", stamp(), line);
    } catch (e) {}
  }

  function setLogVisible(visible) {
    var box = ensureLog();
    if (!box) return;
    setHidden(box, !visible);
    var toggle = $("shell-log-toggle");
    if (toggle) {
      if (toggle.setAttribute) toggle.setAttribute("aria-pressed", visible ? "true" : "false");
    }
  }

  /* ---- публичный API ---- */

  var loader = {
    version: "2",
    ready: false,
    show: function (label) {
      if (ready) return;
      setHidden($("shell-overlay"), false);
      bootBusy(true);
      if (label) write("info", label);
    },
    hide: function () {
      setHidden($("shell-overlay"), true);
      bootBusy(false);
    },
    begin: function (label) {
      loader.show(label);
    },
    end: function (label) {
      markReady(label);
    },
    log: function (level, message) {
      if (message === undefined) {
        message = level;
        level = "info";
      }
      write(level, message);
    },
    info: function (m) { write("info", m); },
    ok: function (m) { write("ok", m); },
    warn: function (m) { write("warn", m); },
    error: function (m) { write("error", m); },
    net: function (m) { write("net", m); },
    clear: function () {
      var box = ensureLog();
      if (box) while (box.firstChild) box.removeChild(box.firstChild);
    },
    isReady: function () { return ready; },
  };
  try {
    window.__VK_LOADER__ = loader;
  } catch (e) {}

  /* ---- готовность приложения (главный признак успеха) ---- */

  function clearTimers() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (primaryTimer) { clearTimeout(primaryTimer); primaryTimer = null; }
    if (earlyTimer) { clearTimeout(earlyTimer); earlyTimer = null; }
    if (finalTimer) { clearTimeout(finalTimer); finalTimer = null; }
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  }

  function markReady(label) {
    if (ready) return;
    ready = true;
    loader.ready = true;
    clearTimers();
    doomed = false;
    bootBusy(false);
    setHidden($("shell-overlay"), true);
    setHidden($("shell-fallback"), true);
    write("ok", label || "Интерфейс готов");
    var toggle = $("shell-log-toggle");
    if (toggle) setHidden(toggle, false);
    if (logHideTimer) clearTimeout(logHideTimer);
    logHideTimer = setTimeout(function () {
      if (!logOpenedByUser) setLogVisible(false);
    }, LOG_AUTOHIDE_MS);
    cachePrimary();
  }

  function startReadyPoll() {
    if (pollTimer) return;
    function tick() {
      pollTimer = null;
      if (window.__APP_READY__) { markReady(); return; }
      pollTimer = setTimeout(tick, 150);
    }
    pollTimer = setTimeout(tick, 100);
  }

  function showFallback(code) {
    if (window.__APP_READY__) { markReady(); return; }
    if (doomed) return;
    doomed = true;
    bootBusy(false);
    setHidden($("shell-overlay"), true);
    write("error", "Резервные источники исчерпаны: " + (code || ""));
    var detail = $("shell-fallback-detail");
    if (detail) detail.textContent = code || "";
    setHidden($("shell-fallback"), false);
  }

  function scheduleFallback(code) {
    if (window.__APP_READY__) { markReady(); return; }
    if (fallbackTimer) return;
    fallbackTimer = setTimeout(function () {
      fallbackTimer = null;
      if (!window.__APP_READY__) showFallback(code);
    }, FALLBACK_GRACE);
  }

  /* ---- кэширование основного бандла для офлайна ---- */

  function hash(s) {
    var h = 9;
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 387420489);
    return (h ^ (h >>> 13)) >>> 0;
  }

  var JS_KEY = "vk_shell_js_" + hash(JS);
  var CSS_KEY = "vk_shell_css_" + hash(CSS);

  function lsGet(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { window.localStorage.setItem(k, v); } catch (e) {}
  }
  function lsKeys(prefix) {
    try {
      var out = [];
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) out.push(k);
      }
      return out;
    } catch (e) { return []; }
  }
  function lsRemove(k) {
    try { window.localStorage.removeItem(k); } catch (e) {}
  }
  function evictOld(prefix, keepKey) {
    var keys = lsKeys(prefix);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] !== keepKey) lsRemove(keys[i]);
    }
  }

  function cacheText(kind, url) {
    try {
      if (typeof fetch !== "function") return;
      fetch(url, { credentials: "omit" }).then(function (r) {
        if (!r.ok) return null;
        return r.text();
      }).then(function (t) {
        if (!t || t.length < 600) return;
        if (/^\s*</.test(t)) return;
        var key = kind === "js" ? JS_KEY : CSS_KEY;
        lsSet(key, t);
        evictOld(kind === "js" ? "vk_shell_js_" : "vk_shell_css_", key);
      }).catch(function () {});
    } catch (e) {}
  }

  function cachePrimary() {
    if (cachedPrimary) return;
    cachedPrimary = true;
    write("info", "Кэширование бандла для офлайна");
    cacheText("js", JS);
    cacheText("css", CSS);
  }

  /* ---- резервные источники ---- */

  function baseName(url) {
    try {
      var clean = String(url).split("?")[0].split("#")[0];
      var slash = clean.lastIndexOf("/");
      return slash >= 0 ? clean.slice(slash + 1) : clean;
    } catch (e) {
      return "";
    }
  }

  function wrapWithProxies(url) {
    var list = [url];
    for (var i = 0; i < PROXIES.length; i++) {
      try {
        var p = String(PROXIES[i]);
        var mapped = p.indexOf("{{URL}}") !== -1
          ? p.replace("{{URL}}", encodeURIComponent(url))
          : p + encodeURIComponent(url);
        list.push(mapped);
      } catch (e) {}
    }
    return list;
  }

  function mirrorChain(kind) {
    var mirrors = kind === "js" ? JS_MIRRORS : CSS_MIRRORS;
    var out = [];
    for (var m = 0; m < mirrors.length; m++) {
      var wrapped = wrapWithProxies(mirrors[m]);
      for (var w = 0; w < wrapped.length; w++) out.push(wrapped[w]);
    }
    return out;
  }

  // Инлайновая инъекция кода: скрипт без src, содержимое — textContent.
  // Самый совместимый способ (инлайн-скрипты на этой странице разрешены —
  // загрузчик тоже инлайновый), не зависит от blob:/MIME/type=module.
  function injectJsFromText(text, label) {
    try {
      var s = el("script");
      if (!s) return false;
      s.textContent = text;
      s.setAttribute("data-shell-source", label || "inline");
      mountPoint().appendChild(s);
      return true;
    } catch (e) {
      return false;
    }
  }

  function injectCssFromText(text) {
    var st = el("style");
    if (!st) return;
    st.textContent = text;
    document.head.appendChild(st);
  }

  function injectJsUrl(url) {
    var s = el("script");
    if (!s) return null;
    s.src = url;
    mountPoint().appendChild(s);
    write("net", "Резервный JS: " + url);
    return s;
  }

  function injectCssUrl(url, onError) {
    var l = el("link");
    if (!l) { if (onError) onError(); return null; }
    l.rel = "stylesheet";
    l.href = url;
    l.onerror = function () {
      try { l.remove(); } catch (e) {}
      if (onError) onError();
    };
    document.head.appendChild(l);
    return l;
  }

  // Последний резерв: забрать бандл через fetch и выполнить инлайн.
  // Работает, когда статический <script> блокируется молча (без load/error).
  function runLocalFetchThenStub() {
    if (typeof fetch !== "function") { scheduleFallback("RESOURCES_UNAVAILABLE"); return; }
    write("net", "Резервный fetch " + JS);
    var started = now();
    fetch(JS, { credentials: "same-origin" })
      .then(function (r) {
        var ms = Math.round(now() - started);
        var ct = "";
        try { ct = r.headers && r.headers.get ? r.headers.get("content-type") || "" : ""; } catch (e) {}
        write(r.ok ? "ok" : "error", "fetch " + JS + " → " + r.status + " " + ct + " " + ms + "мс");
        if (!r.ok) return null;
        return r.text();
      })
      .then(function (t) {
        if (!t) { scheduleFallback("RESOURCES_UNAVAILABLE"); return; }
        write("info", "fetch: получено " + t.length + " байт");
        if (/^\s*</.test(t)) {
          write("error", "fetch: ответ похож на HTML, а не на JS");
          scheduleFallback("RESOURCES_UNAVAILABLE");
          return;
        }
        write("warn", "Выполняю инлайн-инъекцию бандла");
        injectJsFromText(t, "fetch");
        var deadline = now() + POST_INJECT_TIMEOUT;
        (function check() {
          if (window.__APP_READY__) { markReady(); return; }
          if (now() >= deadline) { scheduleFallback("RESOURCES_UNAVAILABLE"); return; }
          setTimeout(check, 100);
        })();
      })
      .catch(function (e) {
        write("error", "fetch не удался: " + (e && (e.message || e)));
        scheduleFallback("RESOURCES_UNAVAILABLE");
      });
  }

  function runJsFallback() {
    var steps = [];
    var cached = lsGet(JS_KEY);
    if (cached) steps.push({ cache: cached });
    var urls = mirrorChain("js");
    for (var i = 0; i < urls.length; i++) steps.push({ url: urls[i] });

    write("warn", "Резервный запуск JS (вариантов: " + steps.length + ")");

    var index = 0;
    function attempt() {
      if (window.__APP_READY__) { markReady(); return; }
      if (index >= steps.length) { runLocalFetchThenStub(); return; }
      var step = steps[index++];
      if (step.cache) {
        write("warn", "Резервный JS из localStorage");
        injectJsFromText(step.cache, "localStorage");
      } else {
        injectJsUrl(step.url);
      }
      setTimeout(function () {
        if (window.__APP_READY__) { markReady(); return; }
        attempt();
      }, TIMEOUT);
    }
    attempt();
  }

  function runCssFallback() {
    var cached = lsGet(CSS_KEY);
    if (cached) { write("warn", "Резервный CSS из localStorage"); injectCssFromText(cached); }
    var urls = mirrorChain("css");
    var index = 0;
    function attempt() {
      if (index >= urls.length) return;
      var url = urls[index++];
      injectCssUrl(url, attempt);
    }
    attempt();
  }

  function startFallback(kind) {
    if (window.__APP_READY__) { markReady(); return; }
    if (kind === "js") {
      if (jsFallbackStarted) return;
      jsFallbackStarted = true;
      runJsFallback();
    } else {
      if (cssFallbackStarted) return;
      cssFallbackStarted = true;
      runCssFallback();
    }
  }

  /* ---- диагностика ---- */

  function onResourceError(event) {
    var target = event && event.target;
    if (target && (target.tagName === "SCRIPT" || target.tagName === "LINK")) {
      var url = target.src || target.href || "";
      if (typeof url !== "string") return;
      var base = baseName(url);
      if (base === JS_BASE || /(^|\/)app-[^/]+\.js$/i.test(base)) {
        write("error", "Не загрузился основной JS: " + url);
        startFallback("js");
      } else if (base === CSS_BASE || /(^|\/)app-[^/]+\.css$/i.test(base)) {
        write("error", "Не загрузился основной CSS: " + url);
        startFallback("css");
      }
      return;
    }
    var msg = event && (event.message || (event.error && event.error.message));
    if (msg) {
      var where = event.filename ? " (" + baseName(event.filename) + ":" + event.lineno + ")" : "";
      write("error", "JS-ошибка: " + msg + where);
    }
  }

  function onRejection(event) {
    var reason = event && event.reason;
    var msg = reason && (reason.message || reason);
    write("error", "Необработанный отказ: " + msg);
  }

  // Resource Timing: показывает, был ли запрос ресурса вообще и чем закончился,
  // даже если браузер не прислал load/error у тега <script>.
  function dumpResourceTiming() {
    try {
      if (!window.performance || !window.performance.getEntriesByType) return;
      var list = window.performance.getEntriesByType("resource") || [];
      var found = false;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (!e || !e.name || (e.name.indexOf("app-") === -1 && e.name.indexOf("shell-config") === -1)) continue;
        found = true;
        var dur = Math.round(e.duration || 0);
        var size = e.transferSize != null ? e.transferSize : "?";
        var status = e.responseStatus != null ? e.responseStatus : "?";
        write("info", "Ресурс " + baseName(e.name) + ": статус " + status + ", " + size + " байт, " + dur + "мс");
      }
      if (!found) write("warn", "Бандл не найден в Resource Timing (запрос не сделан или не завершился)");
    } catch (e) {}
  }

  /* ---- переключатель лога ---- */

  var logOpenedByUser = false;

  function wireToggle() {
    var toggle = $("shell-log-toggle");
    if (!toggle || !toggle.addEventListener) return;
    toggle.addEventListener("click", function () {
      logOpenedByUser = true;
      var box = ensureLog();
      var hidden = box && box.classList && box.classList.contains("is-hidden");
      setLogVisible(!!hidden);
    });
  }

  /* ---- старт ---- */

  function init() {
    bootBusy(true);
    setHidden($("shell-overlay"), false);
    write("info", "Загрузчик v" + loader.version + " запущен");
    write("info", "Основной бандл: " + JS);

    try {
      window.addEventListener("error", onResourceError, true);
      window.addEventListener("unhandledrejection", onRejection);
    } catch (e) {}

    // Ресурсы из <head> (CSS) могли не загрузиться до старта загрузчика —
    // забираем ошибки, накопленные ранним перехватчиком.
    try {
      var early = window.__VK_SHELL_EARLY_ERRORS__;
      window.__VK_SHELL_EARLY_ERRORS__ = null;
      if (early && early.length) {
        for (var i = 0; i < early.length; i++) onResourceError(early[i]);
      }
    } catch (e) {}

    wireToggle();

    if (window.__APP_READY__) { markReady(); return; }

    startReadyPoll();

    // Ранний детектор «тихой» блокировки: если у тега бандла не было ни load,
    // ни error за EARLY_FALLBACK мс — считаем ресурс заблокированным и сразу
    // запускаем резерв (fetch+инлайн), не дожидаясь основного таймаута.
    earlyTimer = setTimeout(function () {
      earlyTimer = null;
      if (window.__APP_READY__) return;
      if (!window.__VK_SHELL_SCRIPT_LOADED__ && !window.__VK_SHELL_SCRIPT_ERRORED__) {
        write("warn", "Бандл не подал ни load, ни error за " + EARLY_FALLBACK + "мс — похоже на блокировку загрузки скрипта");
        startFallback("js");
      }
    }, EARLY_FALLBACK);

    primaryTimer = setTimeout(function () {
      if (!window.__APP_READY__) {
        write("warn", "Основной JS не запустился за " + PRIMARY_TIMEOUT + "мс");
        dumpResourceTiming();
        startFallback("js");
      }
    }, PRIMARY_TIMEOUT);

    finalTimer = setTimeout(function () {
      if (!window.__APP_READY__) showFallback("APP_TIMEOUT");
    }, READY_WATCHDOG);
  }

  init();
})();
