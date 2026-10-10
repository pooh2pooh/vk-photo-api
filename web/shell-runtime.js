/* Отказоустойчивый монитор загрузки интерфейса.
 *
 * Основной бандл грузится обычными статическими тегами
 * <script type="module"> и <link rel="stylesheet"> прямо в index.html —
 * это самый совместимый способ (работает во всех браузерах, включая
 * Яндекс.Браузер). Этот скрипт:
 *   1) показывает единый спиннер;
 *   2) ждёт готовности приложения по флагу window.__APP_READY__;
 *   3) если основной бандл не запустился — перебирает резервные источники:
 *      копию из localStorage → CDN-зеркала → те же зеркала через прокси;
 *   4) при полном отказе показывает понятную заглушку (без «вечной загрузки»).
 */
(function () {
  "use strict";

  var CONFIG = window.__VK_SHELL_CONFIG__ || {};
  var JS = CONFIG.js || "./assets/index.js";
  var CSS = CONFIG.css || "./assets/index.css";
  var TIMEOUT = CONFIG.timeoutMs || 8000;
  var PRIMARY_TIMEOUT = CONFIG.primaryTimeoutMs || 6000;
  var FALLBACK_GRACE = CONFIG.fallbackGraceMs || 4000;
  var READY_WATCHDOG = CONFIG.readyWatchdogMs || 15000;
  var MIRRORS = window.__VK_SHELL_MIRRORS__ || {};
  var JS_MIRRORS = MIRRORS.js || [];
  var CSS_MIRRORS = MIRRORS.css || [];
  var PROXIES = MIRRORS.proxies || [];

  var doomed = false;
  var jsFallbackStarted = false;
  var cssFallbackStarted = false;
  var cachedPrimary = false;
  var pollTimer = null;
  var primaryTimer = null;
  var finalTimer = null;
  var fallbackTimer = null;

  function $(id) {
    return document.getElementById(id);
  }
  function show(id) {
    var n = $(id);
    if (n) n.hidden = false;
  }
  function hide(id) {
    var n = $(id);
    if (n) n.hidden = true;
  }
  function mountPoint() {
    return document.body || document.head || document.documentElement;
  }

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

  function bootBusy(on) {
    try { document.body.classList.toggle("shell-busy", on); } catch (e) {}
  }

  function hash(s) {
    var h = 9;
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 387420489);
    return (h ^ (h >>> 13)) >>> 0;
  }

  var JS_KEY = "vk_shell_js_" + hash(JS);
  var CSS_KEY = "vk_shell_css_" + hash(CSS);

  function evictOld(prefix, keepKey) {
    var keys = lsKeys(prefix);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] !== keepKey) lsRemove(keys[i]);
    }
  }

  /* ---- готовность приложения (главный признак успеха) ---- */

  function markReady() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (primaryTimer) { clearTimeout(primaryTimer); primaryTimer = null; }
    if (finalTimer) { clearTimeout(finalTimer); finalTimer = null; }
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    doomed = false;
    bootBusy(false);
    hide("shell-boot");
    hide("shell-fallback");
    cachePrimary();
  }

  function startReadyPoll() {
    if (pollTimer) return;
    function tick() {
      pollTimer = null;
      if (window.__APP_READY__) { markReady(); return; }
      pollTimer = setTimeout(tick, 250);
    }
    pollTimer = setTimeout(tick, 250);
  }

  function showFallback(code) {
    if (window.__APP_READY__) { markReady(); return; }
    if (doomed) return;
    doomed = true;
    bootBusy(false);
    hide("shell-boot");
    var detail = $("shell-fallback-detail");
    if (detail) detail.textContent = code || "";
    show("shell-fallback");
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

  function cacheText(kind, url) {
    try {
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
    cacheText("js", JS);
    cacheText("css", CSS);
  }

  /* ---- инъекция резервных ресурсов ---- */

  function wrapWithProxies(url) {
    var list = [url];
    for (var i = 0; i < PROXIES.length; i++) {
      var p = PROXIES[i];
      try {
        var mapped = String(p).indexOf("{{URL}}") !== -1
          ? String(p).replace("{{URL}}", encodeURIComponent(url))
          : String(p) + encodeURIComponent(url);
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

  function injectJsFromText(text) {
    try {
      var blob = new Blob([text], { type: "text/javascript" });
      var url = URL.createObjectURL(blob);
      var s = document.createElement("script");
      s.type = "module";
      s.src = url;
      s.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) {} };
      mountPoint().appendChild(s);
      return true;
    } catch (e) {
      return false;
    }
  }

  function injectCssFromText(text) {
    var st = document.createElement("style");
    st.textContent = text;
    document.head.appendChild(st);
  }

  function injectJsUrl(url) {
    var s = document.createElement("script");
    s.type = "module";
    s.src = url;
    mountPoint().appendChild(s);
    return s;
  }

  function injectCssUrl(url, onError) {
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = url;
    l.onerror = function () {
      try { l.remove(); } catch (e) {}
      if (onError) onError();
    };
    document.head.appendChild(l);
    return l;
  }

  /* ---- перебор резервных источников ---- */

  function runJsFallback() {
    var steps = [];
    var cached = lsGet(JS_KEY);
    if (cached) steps.push({ cache: cached });
    var urls = mirrorChain("js");
    for (var i = 0; i < urls.length; i++) steps.push({ url: urls[i] });

    var index = 0;
    function attempt() {
      if (window.__APP_READY__) { markReady(); return; }
      if (index >= steps.length) { scheduleFallback("RESOURCES_UNAVAILABLE"); return; }
      var step = steps[index++];
      if (step.cache) injectJsFromText(step.cache);
      else injectJsUrl(step.url);
      setTimeout(function () {
        if (window.__APP_READY__) { markReady(); return; }
        attempt();
      }, TIMEOUT);
    }
    attempt();
  }

  function runCssFallback() {
    var cached = lsGet(CSS_KEY);
    if (cached) injectCssFromText(cached);
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

  function onResourceError(event) {
    var target = event.target;
    if (!target) return;
    var tag = target.tagName;
    if (tag !== "SCRIPT" && tag !== "LINK") return;
    var url = target.src || target.href || "";
    if (typeof url !== "string") return;
    if (/\.js(\?|#|$)/i.test(url)) startFallback("js");
    else if (/\.css(\?|#|$)/i.test(url)) startFallback("css");
  }

  /* ---- старт ---- */

  bootBusy(true);
  startReadyPoll();

  window.addEventListener("error", onResourceError, true);

  primaryTimer = setTimeout(function () {
    if (!window.__APP_READY__) startFallback("js");
  }, PRIMARY_TIMEOUT);

  finalTimer = setTimeout(function () {
    if (!window.__APP_READY__) showFallback("APP_TIMEOUT");
  }, READY_WATCHDOG);
})();