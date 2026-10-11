/* Мобильное меню «три точки»: на узком экране основные действия скрыты,
   kebab + «Выйти» в одном ряду; popover открывается, пункт «Стопки» работает,
   закрытие по Escape. */
const CDP_HTTP = "http://127.0.0.1:9222";
const APP = "http://127.0.0.1:8090/index.html";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(CDP_HTTP + "/json")).json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("no CDP target");
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.exceptions = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        this.exceptions.push(d.exception?.description || d.text);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expr, awaitPromise = false) {
    const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

async function waitFor(cdp, expr, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await cdp.evaluate(expr)) return true;
    } catch {}
    await sleep(100);
  }
  return false;
}

const results = [];
function check(name, ok) {
  results.push({ name, ok });
  console.log((ok ? "PASS" : "FAIL") + " — " + name);
}

const vis = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'; })()`;

(async () => {
  const ws = new WebSocket(await wsUrl());
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  const cdp = new CDP(ws);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Log.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 780,
    deviceScaleFactor: 2,
    mobile: true,
  });

  await cdp.send("Page.navigate", { url: APP });
  await waitFor(cdp, "window.__APP_READY__ === true");
  await cdp.evaluate(
    `fetch('./api.php?action=login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'demo',password:'demo123'})}).then(r=>r.text())`,
    true,
  );
  await cdp.send("Page.reload");
  await waitFor(cdp, "document.querySelectorAll('.photo-card:not(.photo-card--skeleton)').length > 0", 12000);

  check("kebab виден на мобильном", await cdp.evaluate(vis(".gallery__menu-trigger")));
  check("«Выйти» виден на мобильном", await cdp.evaluate(vis(".gallery__logout")));
  check("desktop-действия скрыты", !(await cdp.evaluate(vis(".gallery__actions--desktop"))));

  const align = await cdp.evaluate(`(() => {
    const m = document.querySelector('.gallery__menu-trigger').getBoundingClientRect();
    const o = document.querySelector('.gallery__logout').getBoundingClientRect();
    return { sameRow: Math.abs(m.top - o.top) < 6 && Math.abs(m.height - o.height) < 6, gap: Math.abs(o.left - m.right) };
  })()`);
  check("kebab и «Выйти» в одном ряду", align.sameRow && align.gap < 20);

  check("popover закрыт до клика", !(await cdp.evaluate("!!document.querySelector('.gallery__menu')")));
  await cdp.evaluate("document.querySelector('.gallery__menu-trigger').click()");
  await waitFor(cdp, "!!document.querySelector('.gallery__menu')");
  const menu = await cdp.evaluate(`(() => {
    const el = document.querySelector('.gallery__menu');
    const btns = [...el.querySelectorAll('button')];
    return { open: !!el, n: btns.length, texts: btns.map(b => b.textContent.trim()), svgs: btns.map(b => !!b.querySelector('svg')) };
  })()`);
  check("popover открылся, 3 пункта с иконками и текстом", menu.n === 3 && menu.svgs.every(Boolean) && menu.texts.join(" ").length > 0);

  // Пункт «Стопки» открывает панель и закрывает меню.
  await cdp.evaluate(`[...document.querySelectorAll('.gallery__menu button')].find(b => /Стопки/.test(b.textContent)).click()`);
  check("пункт «Стопки» открыл панель", await waitFor(cdp, "!!document.querySelector('.stacks')"));
  check("меню закрылось после выбора", !(await cdp.evaluate("!!document.querySelector('.gallery__menu')")));

  // Escape закрывает меню.
  await cdp.evaluate("document.querySelector('.gallery__menu-trigger').click()");
  await waitFor(cdp, "!!document.querySelector('.gallery__menu')");
  await cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  check("Escape закрывает popover", await waitFor(cdp, "!document.querySelector('.gallery__menu')", 2000));

  check("нет ошибок в консоли", cdp.consoleErrors.length === 0 && cdp.exceptions.length === 0);

  await cdp.send("Emulation.clearDeviceMetricsOverride");

  const passed = results.filter((r) => r.ok).length;
  console.log(`\nИТОГ [mobile-menu]: ${passed}/${results.length} пройдено`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
