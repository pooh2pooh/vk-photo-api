/* Резилентный загрузчик интерфейса.
 * Источники для каждого ресурса перебираются по цепочке:
 *   1) текст из localStorage (копия с прошлого успешного открытия);
 *   2) локальный файл ./assets/...;
 *   3) CDN-зеркала из shell-config.js (по одному, с таймаутом);
 *   4) те же зеркала через перебор прокси из shell-config.js.
 * Если собрать приложение не удалось — показываем понятную заглушку,
 * «вечной загрузки» не бывает.
 */
(function () {
  "use strict";

  var CONFIG = window.__VK_SHELL_CONFIG__ || {};
  var JS = CONFIG.js || "./assets/index.js";
  var CSS = CONFIG.css || "./assets/index.css";
  var TIMEOUT = CONFIG.timeoutMs || 8000;
  var READY_WATCHDOG = CONFIG.readyWatchdogMs || 12000;
  var MIRRORS = window.__VK_SHELL_MIRRORS__ || {};
  var JS_MIRRORS = MIRRORS.js || [];
  var CSS_MIRRORS = MIRRORS.css || [];
  var PROXIES = MIRRORS.proxies || [];

  var done = { css: false, js: false };
  var doomed = false;

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
  bootBusy(true);

  function showFallback(code) {
    if (doomed) return;
    doomed = true;
    bootBusy(false);
    hide("shell-boot");
    var detail = $("shell-fallback-detail");
    if (detail) detail.textContent = code || "";
    show("shell-fallback");
  }

  function waitReady() {
    if (window.__APP_READY__ || doomed) return;
    setTimeout(function () {
      if (!window.__APP_READY__ && !doomed) showFallback("APP_TIMEOUT");
    }, READY_WATCHDOG);
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

  /* ---- инъекция текста (из localStorage) ---- */

  function injectJsFromText(text) {
    try {
      var blob = new Blob([text], { type: "text/javascript" });
      var url = URL.createObjectURL(blob);
      var s = document.createElement("script");
      s.type = "module";
      s.src = url;
      s.onerror = function () {
        try { URL.revokeObjectURL(url); } catch (e) {}
        showFallback("CACHE_JS_INVALID");
      };
      document.head.appendChild(s);
      done.js = true;
      hide("shell-boot");
      waitReady();
      return true;
    } catch (e) {
      return false;
    }
  }

  function injectCssFromText(text) {
    var st = document.createElement("style");
    st.textContent = text;
    document.head.appendChild(st);
    done.css = true;
    waitReady();
  }

  /* ---- сеть: цепочка локальный → зеркала → зеркала через прокси ---- */

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

  function chain(kind) {
    var mirrors = kind === "js" ? JS_MIRRORS : CSS_MIRRORS;
    var out = [kind === "js" ? JS : CSS];
    for (var m = 0; m < mirrors.length; m++) {
      var wrapped = wrapWithProxies(mirrors[m]);
      for (var w = 0; w < wrapped.length; w++) out.push(wrapped[w]);
    }
    return out;
  }

  function cacheText(kind, url) {
    try {
      fetch(url, { credentials: "omit" }).then(function (r) {
        if (!r.ok) return null;
        return r.text();
      }).then(function (t) {
        if (!t || t.length < 600) return;
        if (/^\s*</.test(t)) return; // не кэшируем HTML/ошибку
        var key = kind === "js" ? JS_KEY : CSS_KEY;
        lsSet(key, t);
        evictOld(kind === "js" ? "vk_shell_js_" : "vk_shell_css_", key);
      }).catch(function () {});
    } catch (e) {}
  }

  function runChain(kind) {
    var list = chain(kind);
    var index = 0;
    var timer = null;
    var settled = false;
    var currentUrl = null;

    function stopTimer() {
      if (timer) { clearTimeout(timer); timer = null; }
    }

    function complete() {
      if (settled) return;
      settled = true;
      stopTimer();
      if (currentUrl) cacheText(kind, currentUrl);
      if (kind === "js") { done.js = true; waitReady(); }
      else { done.css = true; waitReady(); }
    }

    function giveUp() {
      if (settled) return;
      settled = true;
      stopTimer();
      if (kind === "js") {
        showFallback("RESOURCES_UNAVAILABLE");
      } else {
        // без стилей интерфейс всё равно поднимется
        done.css = true;
        waitReady();
      }
    }

    function next() {
      if (settled) return;
      stopTimer();
      if (index >= list.length) { giveUp(); return; }
      var url = list[index++];
      currentUrl = url;
      timer = setTimeout(next, TIMEOUT);
      loadOne(kind, url, complete, next);
    }

    next();
  }

  function makeScript(url) {
    var s = document.createElement("script");
    s.type = "module";
    s.src = url;
    s.crossOrigin = "anonymous";
    return s;
  }

  function makeStylesheet(url) {
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = url;
    l.onerror = function () { try { l.remove(); } catch (e) {} };
    return l;
  }

  function loadOne(kind, url, ok, no) {
    var node = kind === "js" ? makeScript(url) : makeStylesheet(url);
    node.onload = ok;
    node.onerror = no;
    document.head.appendChild(node);
  }

  /* ---- старт ---- */

  var cachedJs = lsGet(JS_KEY);
  var cachedCss = lsGet(CSS_KEY);

  if (cachedCss) {
    injectCssFromText(cachedCss);
  } else {
    runChain("css");
  }

  if (cachedJs) {
    injectJsFromText(cachedJs);
    // фоном обновляем копию в localStorage и проверяем доступность сети
    cacheText("js", JS);
    cacheText("css", CSS);
  } else {
    runChain("js");
  }
})();