/* Тест новых фич: SVG-иконки, пагинация-стрелки, drag'n'drop из миниатюры,
   сохранение страницы при смене вида, свайпы фото и ленты миниатюр. */
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

/* Синтетический горизонтальный свайп по элементу. */
const swipeExpr = (selector, fromX, toX) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const touch = (clientX, clientY) => new Touch({ identifier: 1, target: el, clientX, clientY });
  const make = (type, clientX, clientY, active) => new TouchEvent(type, {
    bubbles: true, cancelable: true,
    touches: active ? [touch(clientX, clientY)] : [],
    targetTouches: active ? [touch(clientX, clientY)] : [],
    changedTouches: [touch(clientX, clientY)],
  });
  el.dispatchEvent(make('touchstart', cx + ${fromX}, cy));
  el.dispatchEvent(make('touchmove', cx + ${toX}, cy, true));
  el.dispatchEvent(make('touchend', cx + ${toX}, cy));
  return true;
})()`;

const activeIdx = `Array.prototype.indexOf.call(document.querySelectorAll('.lightbox__thumb'), document.querySelector('.lightbox__thumb.is-active'))`;

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
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  await cdp.send("Page.navigate", { url: APP });
  await waitFor(cdp, "window.__APP_READY__ === true");
  await cdp.evaluate(`try { localStorage.removeItem('vkphotos_page_size'); } catch {}`);
  await cdp.evaluate(
    `fetch('./api.php?action=login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'demo',password:'demo123'})}).then(r=>r.text())`,
    true,
  );
  await cdp.send("Page.reload");
  await waitFor(cdp, "document.querySelectorAll('.photo-card:not(.photo-card--skeleton)').length > 0", 12000);

  // 1. Иконки в шапке вместо текста.
  const headerInfo = await cdp.evaluate(`(() => {
    const q = s => document.querySelector(s);
    const svg = s => !!q(s).querySelector('svg');
    return {
      densitySvg: svg('.gallery__density'),
      refreshSvg: svg('.gallery__refresh'),
      logoutSvg: svg('.gallery__logout'),
      densityAria: q('.gallery__density').getAttribute('aria-label'),
      refreshAria: q('.gallery__refresh').getAttribute('aria-label'),
      logoutAria: q('.gallery__logout').getAttribute('aria-label'),
      headerText: q('.gallery__header').textContent,
    };
  })()`);
  check(
    "кнопки шапки — иконки (3 svg, aria-label)",
    headerInfo.densitySvg && headerInfo.refreshSvg && headerInfo.logoutSvg &&
      headerInfo.densityAria && headerInfo.refreshAria && headerInfo.logoutAria,
  );
  check(
    "в шапке нет текстовых кнопок «Обзор/Обновить/Выйти»",
    !/Обзор|Обновить|Выйти/.test(headerInfo.headerText.replace(/Сохранённые фото|Всего|на странице|Загрузка|обновление/g, "")),
  );

  // 2. Пагинация — только стрелки.
  const pagInfo = await cdp.evaluate(`(() => {
    const nav = document.querySelector('.pagination');
    const arrowBtns = nav.querySelectorAll('.icon-button');
    const pages = nav.querySelectorAll('.pagination__page');
    return {
      arrows: arrowBtns.length,
      arrowSvg: arrowBtns.length === 2 && !!arrowBtns[0].querySelector('svg') && !!arrowBtns[1].querySelector('svg'),
      pageNumbers: pages.length >= 2,
      text: nav.textContent,
    };
  })()`);
  check(
    `пагинация — кнопки-стрелки и номера страниц (стрелки ${pagInfo.arrows})`,
    pagInfo.arrows === 2 && pagInfo.arrowSvg && pagInfo.pageNumbers && !/←|→|Назад|Вперёд/.test(pagInfo.text.replace(/\d+/g, "")),
  );

  // 3. Drag'n'drop из карточки сетки — полный URL в dataTransfer.
  const dragFromCard = await cdp.evaluate(`(() => {
    const card = document.querySelector('.photo-card:not(.photo-card--skeleton)');
    const img = card.querySelector('img');
    const dt = new DataTransfer();
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt });
    card.dispatchEvent(ev);
    return {
      draggable: card.draggable,
      thumbDraggable: img.draggable === false,
      uri: dt.getData('text/uri-list'),
      plain: dt.getData('text/plain'),
      dl: dt.getData('DownloadURL'),
      effect: dt.effectAllowed,
    };
  })()`);
  check(
    "карточки сетки перетаскиваются, img отдан браузеру (не тянется превью)",
    dragFromCard.draggable && dragFromCard.thumbDraggable,
  );
  check(
    "в dataTransfer кладётся полноразмерная ссылка (text/uri-list)",
    /^https?:/.test(dragFromCard.uri) && dragFromCard.uri === dragFromCard.plain && dragFromCard.uri.includes('/img/x-'),
  );
  check(
    "DownloadURL = image/jpeg:vk-<owner>-<id>.jpg:<url>",
    /^image\/jpeg:vk--1-\d+\.jpg:/ .test(dragFromCard.dl) && dragFromCard.dl.includes(dragFromCard.uri),
  );

  // 4. Сохранение страницы при смене 30 <=> 100.
  await cdp.evaluate(`(() => { const b=document.querySelectorAll('.pagination__page'); [...b].find(x=>x.textContent==='2').click(); })()`);
  await waitFor(cdp, `document.querySelector('.pagination__page--active')?.textContent === '2'`, 10000);
  await sleep(500);
  check("обычный вид, страница 2 активна", await cdp.evaluate(`document.querySelector('.pagination__page--active').textContent === '2'`));
  await cdp.evaluate(`document.querySelector('.gallery__density').click()`);
  await waitFor(cdp, "document.querySelectorAll('.photo-card:not(.photo-card--skeleton)').length >= 100", 15000);
  await sleep(400);
  const preserved = await cdp.evaluate(`(() => {
    const active = document.querySelector('.pagination__page--active');
    const first = document.querySelector('.photo-card:not(.photo-card--skeleton) img');
    return { page: active ? active.textContent : null, src: first ? first.src : null };
  })()`);
  check(
    "после переключения на 100 страница сохранена (осталась 2, а не 1)",
    preserved.page === "2",
  );
  check(
    `показаны фото страницы 2 нового вида (первое — id 101, src ${preserved.src})`,
    preserved.src && preserved.src.includes("/img/m-101.bmp"),
  );

  // 5. Drag из ленты миниатюр (внутри лайтбокса).
  await cdp.evaluate(`document.querySelectorAll('.photo-card:not(.photo-card--skeleton)')[5].click()`);
  await waitFor(cdp, "!!document.querySelector('.lightbox')", 5000);
  await sleep(500);
  const dragFromThumb = await cdp.evaluate(`(() => {
    const thumb = document.querySelector('.lightbox__thumb');
    const img = thumb.querySelector('img');
    const dt = new DataTransfer();
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt });
    thumb.dispatchEvent(ev);
    return {
      draggable: thumb.draggable,
      imgDraggable: img.draggable === false,
      uri: dt.getData('text/uri-list'),
      dl: dt.getData('DownloadURL'),
    };
  })()`);
  check(
    "миниатюра в лайтбоксе перетаскивается с полным URL",
    dragFromThumb.draggable && dragFromThumb.imgDraggable && /\/img\/x-/.test(dragFromThumb.uri) && /^image\/jpeg:vk--1-\d+\.jpg:/.test(dragFromThumb.dl),
  );

  // 6. Свайп по фото — через CDP Input.dispatchTouchEvent (реальные события).
  const stageRect = await cdp.evaluate(`(() => { const r=document.querySelector('.lightbox__stage').getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; })()`);
  const swipe = async (dx) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: stageRect.x, y: stageRect.y, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: stageRect.x + dx, y: stageRect.y, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(550);
  };
  const activeStart = await cdp.evaluate(activeIdx);
  await swipe(-80);
  const afterSwipeLeft = await cdp.evaluate(activeIdx);
  check(`свайп влево листает вперёд (${activeStart} → ${afterSwipeLeft})`, afterSwipeLeft === activeStart + 1);
  await swipe(80);
  const afterSwipeRight = await cdp.evaluate(activeIdx);
  check(`свайп вправо листает назад (${afterSwipeLeft} → ${afterSwipeRight})`, afterSwipeRight === afterSwipeLeft - 1);

  // 7. Перетаскивание ленты миниатюр пальцем.
  const stripsRect = await cdp.evaluate(`(() => { const r=document.querySelector('.lightbox__thumbs').getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; })()`);
  const idxBefore = await cdp.evaluate(activeIdx);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: stripsRect.x, y: stripsRect.y, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: stripsRect.x - 40, y: stripsRect.y, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(600);
  const strip = await cdp.evaluate(`(() => ({
    idx: ${activeIdx},
    dragging: !!document.querySelector('.lightbox__track.is-dragging'),
    dragVar: (document.querySelector('.lightbox__track').style.getPropertyValue('--drag') || '').trim(),
  }))()`);
  check(
    `перетаскивание ленты листает на шаг (${idxBefore} → ${strip.idx})`,
    strip.idx === idxBefore + 1,
  );
  check("после отпускания трек без --drag и без is-dragging", !strip.dragging && strip.dragVar === "");

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