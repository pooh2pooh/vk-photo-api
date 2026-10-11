/* Тест «стопок»: кнопка в шапке, панель с группами, открытие стопки
   (показ только её фото), выход ко всем фото. Мок ИИ даёт темы по id%4. */
const CDP_HTTP = "http://127.0.0.1:9222";
const APP = "http://127.0.0.1:8090/index.html";
const LABELS = ["альфа", "бета", "гамма", "дельта"];

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
    await sleep(150);
  }
  return false;
}

const results = [];
function check(name, ok) {
  results.push({ name, ok });
  console.log((ok ? "PASS" : "FAIL") + " — " + name);
}

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

  await cdp.send("Page.navigate", { url: APP });
  await waitFor(cdp, "window.__APP_READY__ === true");
  await cdp.evaluate(`try { localStorage.removeItem('vkphotos_page_size'); } catch {}`);
  await cdp.evaluate(
    `fetch('./api.php?action=login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'demo',password:'demo123'})}).then(r=>r.text())`,
    true,
  );
  await cdp.send("Page.reload");
  await waitFor(cdp, "document.querySelectorAll('.photo-card:not(.photo-card--skeleton)').length > 0", 12000);

  const hasStackButton = await cdp.evaluate(`(() => {
    const b = document.querySelector('.gallery__stacks');
    return !!b && !!b.querySelector('svg') && b.getAttribute('aria-label') === 'Стопки';
  })()`);
  check("в шапке есть кнопка «Стопки» (иконка + aria-label)", hasStackButton);

  await cdp.evaluate(`document.querySelector('.gallery__stacks').click()`);
  const panelOpened = await waitFor(cdp, "!!document.querySelector('.stacks')", 5000);
  check("панель стопок открылась", panelOpened);

  const cardsReady = await waitFor(
    cdp,
    "document.querySelectorAll('.stack-card').length > 0",
    120000,
  );
  check("стопки собраны — появились карточки групп", cardsReady);

  const groups = await cdp.evaluate(`[...document.querySelectorAll('.stack-card')].map(c => ({
    label: c.querySelector('.stack-card__label').textContent,
    count: Number(c.querySelector('.stack-card__count').textContent),
    covers: c.querySelectorAll('.stack-card__covers img').length,
  }))`);
  const labels = groups.map((g) => g.label).sort();
  const expected = [...LABELS].sort();
  check(
    `мок ИИ дал 4 группы (${labels.join(" / ")})`,
    groups.length === 4 && JSON.stringify(labels) === JSON.stringify(expected),
  );
  check("сумма фото по стопкам ≈ 1000", labels.length === 4 && Math.abs(groups.reduce((s, g) => s + g.count, 0) - 1000) <= 4);
  check("у групп есть обложки", groups.every((g) => g.covers >= 1));

  const beta = groups.find((g) => g.label === "бета");
  if (!beta) throw new Error("нет группы «бета»");

  await cdp.evaluate(`[...document.querySelectorAll('.stack-card')].find(c => c.querySelector('.stack-card__label').textContent === 'бета').click()`);
  const stackOpened = await waitFor(cdp, "!!document.querySelector('.stack-active')", 15000);
  const stackBar = await cdp.evaluate(`document.querySelector('.stack-active').textContent`);
  check("открылась стопка «бета»", stackOpened && /бета/.test(stackBar));

  const stackCards = await waitFor(
    cdp,
    "document.querySelectorAll('.photo-card:not(.photo-card--skeleton)').length === 250",
    20000,
  );
  const photoIds = await cdp.evaluate(`[...document.querySelectorAll('.photo-card:not(.photo-card--skeleton) img')]
    .map(i => Number(i.src.match(/\\/m-(\\d+)\\.bmp/)?.[1]))`);
  check("показаны только фото стопки (250 шт)", stackCards && photoIds.length === 250);
  const allMatch = photoIds.every((id) => id % 4 === 1);
  check("все показанные фото — из стопки «бета» (id%4==1)", allMatch);
  check("пагинация скрыта в стопке", !(await cdp.evaluate(`!!document.querySelector('.pagination')`)));

  await cdp.evaluate(`document.querySelector('.stack-active__exit').click()`);
  await sleep(400);
  const backToAll = await cdp.evaluate(`(() => ({
    noActive: !document.querySelector('.stack-active'),
    cards: document.querySelectorAll('.photo-card:not(.photo-card--skeleton)').length,
    pagination: !!document.querySelector('.pagination'),
  }))()`);
  check("кнопка «Ко всем фото» вернула общий список", backToAll.noActive && backToAll.cards > 0 && backToAll.pagination);

  check("нет ошибок в консоли", cdp.consoleErrors.length === 0);
  if (cdp.consoleErrors.length) console.log("  console errors:", cdp.consoleErrors);
  if (cdp.exceptions.length) console.log("  exceptions:", cdp.exceptions);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nИТОГ: ${results.length - failed.length}/${results.length} пройдено`);
  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});