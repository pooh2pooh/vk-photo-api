/* Регресс-тест: режим «Обзор» (100 фото, один запрос), спиннер,
   стабильность сцены и плавный слайдер миниатюр с центрированием. */
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

async function waitFor(cdp, expr, timeoutMs = 8000) {
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

/* Активная миниатюра должна быть в центре ленты, а число элементов — неизменным. */
const activeThumbInfo = `(() => {
  const box = document.querySelector('.lightbox__thumbs').getBoundingClientRect();
  const active = document.querySelector('.lightbox__thumb.is-active');
  const r = active.getBoundingClientRect();
  return {
    delta: Math.abs((r.left + r.width / 2) - (box.left + box.width / 2)),
    count: document.querySelectorAll('.lightbox__thumb').length,
    activeIndex: Array.prototype.indexOf.call(document.querySelectorAll('.lightbox__thumb'), active),
  };
})()`;

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

  // Чистим возможный старый размер страницы (например, 666 из прошлой версии).
  await cdp.evaluate(`try { localStorage.removeItem('vkphotos_page_size'); } catch {}`);
  await cdp.evaluate(
    `fetch('./api.php?action=login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'demo',password:'demo123'})}).then(r=>r.text())`,
    true,
  );
  await cdp.send("Page.reload");
  await waitFor(cdp, "document.querySelectorAll('.photo-card:not(.photo-card--skeleton)').length > 0", 12000);

  const density = await cdp.evaluate(`(() => {
    const b = document.querySelector('.gallery__density');
    return { aria: b.getAttribute('aria-label'), icon: !!b.querySelector('svg'), title: b.getAttribute('title') };
  })()`);
  check("кнопка плотного режима — иконка, доступна как «Обзор»", density.icon && density.aria === "Обзор" && /Обзор/.test(density.title));

  // Режим «Обзор»: ровно 100 фото.
  await cdp.evaluate(`document.querySelector('.gallery__density').click()`);
  await waitFor(cdp, "document.querySelectorAll('.photo-card:not(.photo-card--skeleton)').length >= 100", 15000);
  await sleep(400);
  const reached = await cdp.evaluate(`document.querySelectorAll('.photo-card:not(.photo-card--skeleton)').length`);
  check(`режим «Обзор» показывает 100 фото (получено ${reached})`, reached === 100);
  check("нет состояния ошибки в режиме «Обзор»", !(await cdp.evaluate(`!!document.querySelector('.state--error')`)));

  // Фото с задержкой: спиннер появляется и исчезает.
  await cdp.evaluate(`document.querySelectorAll('.photo-card')[5].click()`);
  await waitFor(cdp, "!!document.querySelector('.lightbox')", 5000);
  await sleep(220);
  const spinnerMid = await cdp.evaluate(`!!document.querySelector('.lightbox__spinner')`);
  await sleep(900);
  const afterLoad = await cdp.evaluate(
    `({spinner: !!document.querySelector('.lightbox__spinner'), loaded: !!document.querySelector('.lightbox__stage img.is-loaded')})`,
  );
  check("спиннер виден, пока фото грузится", spinnerMid === true);
  check("спиннер исчез после загрузки", afterLoad.spinner === false && afterLoad.loaded === true);

  // Слайдер: все миниатюры в DOM (число не меняется), активная — по центру.
  const t0 = await cdp.evaluate(activeThumbInfo);
  check(`слайдер рендерит все ${reached} миниатюр (число неизменно: ${t0.count})`, t0.count === reached);
  check(`активная миниатюра по центру ленты (Δ=${t0.delta.toFixed(1)}px)`, t0.delta < 3);

  // Стабильность сцены при смене формата (landscape -> portrait).
  const before = await cdp.evaluate(
    `(() => { const s=document.querySelector('.lightbox__stage').getBoundingClientRect(); const t=document.querySelector('.lightbox__thumbs').getBoundingClientRect(); return {stageTop:s.top, stageH:s.height, thumbsTop:t.top, thumbsH:t.height}; })()`,
  );
  await cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))`);
  await sleep(900);
  const portraitLoaded = await cdp.evaluate(`!!document.querySelector('.lightbox__stage img.is-loaded')`);
  const after = await cdp.evaluate(
    `(() => { const s=document.querySelector('.lightbox__stage').getBoundingClientRect(); const t=document.querySelector('.lightbox__thumbs').getBoundingClientRect(); return {stageTop:s.top, stageH:s.height, thumbsTop:t.top, thumbsH:t.height}; })()`,
  );
  const t1 = await cdp.evaluate(activeThumbInfo);
  const stable =
    Math.abs(before.thumbsTop - after.thumbsTop) < 1.5 &&
    Math.abs(before.thumbsH - after.thumbsH) < 1.5 &&
    Math.abs(before.stageTop - after.stageTop) < 1.5 &&
    Math.abs(before.stageH - after.stageH) < 1.5;
  check(
    `лента не «прыгает» при смене формата (thumbsTop ${before.thumbsTop.toFixed(1)}→${after.thumbsTop.toFixed(1)}, h ${before.thumbsH.toFixed(1)}→${after.thumbsH.toFixed(1)})`,
    stable && portraitLoaded,
  );
  check(`после листания активная всё ещё по центру (Δ=${t1.delta.toFixed(1)}px)`, t1.delta < 3);

  // Прыжок в конец ленты: последняя миниатюра активна и по центру, число не изменилось.
  await cdp.evaluate(`document.querySelectorAll('.lightbox__thumb')[${reached - 1}].click()`);
  await sleep(600);
  const tEnd = await cdp.evaluate(activeThumbInfo);
  check(
    `в конце ленты активна последняя и по центру (idx ${tEnd.activeIndex}, Δ=${tEnd.delta.toFixed(1)}px)`,
    tEnd.activeIndex === reached - 1 && tEnd.delta < 3 && tEnd.count === reached,
  );

  // Фото видно целиком и оно вписано в сцену (не обрезано).
  const fit = await cdp.evaluate(
    `(() => { const s=document.querySelector('.lightbox__stage').getBoundingClientRect(); const img=document.querySelector('.lightbox__stage img'); const r=img.getBoundingClientRect(); return { within: r.left>=s.left-1 && r.right<=s.right+1 && r.top>=s.top-1 && r.bottom<=s.bottom+1, fits: r.width<=s.width+1 && r.height<=s.height+1, iw: Math.round(r.width), ih: Math.round(r.height), sw: Math.round(s.width), sh: Math.round(s.height), nw: img.naturalWidth, nh: img.naturalHeight }; })()`,
  );
  check(
    `фото вписано в сцену без обрезки (img ${fit.iw}×${fit.ih} в ${fit.sw}×${fit.sh}, natural ${fit.nw}×${fit.nh})`,
    fit.within && fit.fits && fit.iw > 0 && fit.ih > 0,
  );

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
