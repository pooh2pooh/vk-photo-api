/* Тест фоллбэк-стопок (без ИИ / с исчерпанной квотой): дата-группы,
   спец-стеки, note, открытие группы и выход, «квота — один вызов провайдера». */
const CDP_HTTP = "http://127.0.0.1:9222";
const APP = "http://127.0.0.1:8090/index.html";
const MODE = process.env.FB_MODE || "noai"; // noai | quota
const QUOTA_LOG = process.env.QUOTA_LOG || require("node:path").join(__dirname, "..", ".tmp", "quota-calls.txt");

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

  await cdp.evaluate(`document.querySelector('.gallery__stacks').click()`);
  const opened = await waitFor(cdp, "!!document.querySelector('.stacks')", 5000);
  check("панель стопок открылась", opened);

  const cardsReady = await waitFor(cdp, "document.querySelectorAll('.stack-card').length > 0", 120000);
  check("фоллбэк-стопки собраны — появились карточки групп", cardsReady);

  const { note, mode, groups, built, total } = await cdp.evaluate(`(() => {
    const panel = document.querySelector('.stacks');
    const groups = [...document.querySelectorAll('.stack-card')].map(c => ({
      label: c.querySelector('.stack-card__label').textContent,
      count: Number(c.querySelector('.stack-card__count').textContent),
      covers: c.querySelectorAll('.stack-card__covers img').length,
    }));
    return {
      note: panel.querySelector('.stacks__note')?.textContent || null,
      mode: panel.dataset.mode || null,
      groups, built: panel.dataset.built || null, total: panel.dataset.total || null,
    };
  })()`);

  check("режим «date» (не ИИ)", mode === "date");
  const labels = groups.map((g) => g.label);
  const hasYear = ["2023", "2024", "2025"].some((y) => labels.includes(y));
  const hasWordy = ["Сегодня", "Вчера", "На этой неделе", "На прошлой неделе", "В этом месяце", "В прошлом месяце", "В этом году", "Без даты"].some((l) => labels.includes(l));
  const hasSpecial = ["Скриншоты", "Мелочь и мемы", "кот"].some((l) => labels.includes(l));
  check("есть годовые группы (2023/2024/2025)", hasYear);
  check("есть словесные даты (сегодня/вчера/неделя/месяц/год)", hasWordy);
  check("есть спец-стеки (скриншоты/мелочь/хэштеги)", hasSpecial);
  check("сумма фото по стопкам = 1000", groups.reduce((s, g) => s + g.count, 0) === 1000);
  check("у групп есть обложки", groups.every((g) => g.covers >= 1 && g.count >= 1));

  if (MODE === "quota") {
    check("note сообщает о квоте", !!note && /квота|исчерпан/i.test(note));
  } else {
    check("note сообщает, что ИИ не настроен", !!note && /не настроен|без ИИ/i.test(note));
  }

  const year = groups.find((g) => g.label === "2025");
  if (!year) throw new Error("нет группы «2025»");
  await cdp.evaluate(`[...document.querySelectorAll('.stack-card')].find(c => c.querySelector('.stack-card__label').textContent === '2025').click()`);
  const stackOpened = await waitFor(cdp, "!!document.querySelector('.stack-active')", 15000);
  const stackBar = await cdp.evaluate(`document.querySelector('.stack-active').textContent`);
  check("открылась стопка «2025»", stackOpened && /2025/.test(stackBar));

  const stackCards = await waitFor(
    cdp,
    `document.querySelectorAll('.photo-card:not(.photo-card--skeleton)').length === ${year.count}`,
    20000,
  );
  check(`показаны только фото «2025» (${year.count} шт)`, stackCards);
  const photoIds = await cdp.evaluate(`[...document.querySelectorAll('.photo-card:not(.photo-card--skeleton) img')]
    .map(i => Number(i.src.match(/\\/m-(\\d+)\\.bmp/)?.[1]))`);
  const all2025 = photoIds.length === year.count && photoIds.every((id) => id >= 601 && id <= 900);
  check("все фото стопки — из 2025 года (id 601..900)", all2025);
  check("пагинация скрыта в стопке", !(await cdp.evaluate(`!!document.querySelector('.pagination')`)));

  await cdp.evaluate(`document.querySelector('.stack-active__exit').click()`);
  await sleep(400);
  const backToAll = await cdp.evaluate(`(() => ({
    noActive: !document.querySelector('.stack-active'),
    cards: document.querySelectorAll('.photo-card:not(.photo-card--skeleton)').length,
    pagination: !!document.querySelector('.pagination'),
  }))()`);
  check("кнопка «Ко всем фото» вернула общий список", backToAll.noActive && backToAll.cards > 0 && backToAll.pagination);

  if (MODE === "quota") {
    const { execSync } = require("node:child_process");
    let calls = 0;
    try {
      calls = execSync(`wc -l < "${QUOTA_LOG}"`).toString().trim();
      calls = Number(calls);
    } catch {}
    check("ИИ-провайдер вызван ровно один раз (short-circuit)", calls === 1);
  }

  check("нет ошибок в консоли", cdp.consoleErrors.length === 0);
  if (cdp.consoleErrors.length) console.log("  console errors:", cdp.consoleErrors);
  if (cdp.exceptions.length) console.log("  exceptions:", cdp.exceptions);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nИТОГ [${MODE}]: ${results.length - failed.length}/${results.length} пройдено`);
  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});