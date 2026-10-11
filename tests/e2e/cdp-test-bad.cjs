/* Проверка устойчивости: если сервер отдаёт пустое тело на часть порций,
   плотный режим показывает загруженное и НЕ падает с ошибкой. */
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
    this.ws = ws; this.id = 0; this.pending = new Map(); this.exceptions = []; this.consoleErrors = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); return; }
      if (m.method === "Runtime.exceptionThrown") this.exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") this.consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
    });
  }
  send(method, params = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(expr, awaitPromise = false) { const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; }
}

async function waitFor(cdp, expr, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { try { if (await cdp.evaluate(expr)) return true; } catch {} await sleep(120); }
  return false;
}

const results = [];
const check = (name, ok) => { results.push(ok); console.log((ok ? "PASS" : "FAIL") + " — " + name); };

(async () => {
  const ws = new WebSocket(await wsUrl());
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new CDP(ws);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Log.enable");

  await cdp.send("Page.navigate", { url: APP });
  await waitFor(cdp, "window.__APP_READY__ === true");
  await cdp.evaluate(`try { localStorage.removeItem('vkphotos_page_size'); } catch {}`);
  await cdp.evaluate(`fetch('./api.php?action=login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'demo',password:'demo123'})}).then(r=>r.text())`, true);
  await cdp.send("Page.reload");
  await waitFor(cdp, "document.querySelectorAll('.photo-card:not(.photo-card--skeleton)').length > 0", 12000);

  await cdp.evaluate(`document.querySelector('.gallery__density').click()`);
  // Даём время прогрузить первую порцию (offset 0) и упереться в пустые ответы.
  await waitFor(cdp, "document.querySelectorAll('.photo-card:not(.photo-card--skeleton)').length >= 100", 15000);
  await sleep(1500);

  const state = await cdp.evaluate(
    `({ cards: document.querySelectorAll('.photo-card:not(.photo-card--skeleton)').length, error: !!document.querySelector('.state--error') })`,
  );
  check(`показаны загруженные фото (${state.cards})`, state.cards >= 100);
  check("нет экрана ошибки", state.error === false);
  check("нет исключений (TypeError 'total')", !cdp.exceptions.some((e) => /total/.test(e)) && cdp.exceptions.length === 0);
  if (cdp.exceptions.length) console.log("  exceptions:", cdp.exceptions);

  const failed = results.filter((r) => !r).length;
  console.log(`\nИТОГ: ${results.length - failed}/${results.length}`);
  ws.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
