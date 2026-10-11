const http = require("node:http");
const zlib = require("node:zlib");

const TOTAL = 1000;
const PORT = 9310;
const MODE = process.env.MOCK_MODE || "normal";
const PHOTOS_DELAY_MS = Number(process.env.PHOTOS_DELAY_MS || 400); // имитируем сетевую задержку VK
const DISPLAY_DELAY_MS = 450; // имитируем загрузку крупного фото

/* Генерируем простой BMP заданного размера (браузеры его понимают,
   размеры совпадают с реальными — важно для проверки «прыжков» ленты). */
function bmp(width, height, b, g, r) {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelSize = rowSize * height;
  const fileSize = 54 + pixelSize;
  const buf = Buffer.alloc(fileSize);
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixelSize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const rowStart = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const p = rowStart + x * 3;
      buf[p] = b;
      buf[p + 1] = g;
      buf[p + 2] = r;
    }
  }
  return buf;
}

function dims(id) {
  const portrait = id % 2 === 1;
  // Эвристические классы для фоллбэк-стопок: скриншоты и «мелочь».
  if (id % 7 === 3) return { display: { width: 540, height: 1200 }, thumb: { width: 108, height: 240 } };
  if (id % 7 === 5) return { display: { width: 1600, height: 400 }, thumb: { width: 320, height: 80 } };
  if (id % 7 === 6) return { display: { width: 120, height: 150 }, thumb: { width: 24, height: 30 } };
  const display = portrait ? { width: 400, height: 600 } : { width: 600, height: 400 };
  const thumb = portrait ? { width: 80, height: 120 } : { width: 120, height: 80 };
  return { display, thumb };
}

function photo(id) {
  const { display, thumb } = dims(id);
  return {
    id,
    owner_id: -1,
    album_id: 0,
    width: display.width,
    height: display.height,
    text: id % 7 === 4 ? "#кот и фото" : "Фото #" + id,
    date: photoDate(id),
    sizes: [
      { type: "m", url: `http://127.0.0.1:${PORT}/img/m-${id}.bmp`, ...thumb },
      { type: "x", url: `http://127.0.0.1:${PORT}/img/x-${id}.bmp`, ...display },
    ],
  };
}

/* Даты: большинство — 2023–2025 (стеки по годам), последние 100 — в течение
   последних ~99 дней (словесные бакеты: сегодня/вчера/недели/месяцы). */
function photoDate(id) {
  const mk = (y, m, d) => Math.floor(Date.UTC(y, m, d) / 1000);
  if (id <= 900) {
    const y = 2023 + Math.floor((id - 1) / 300);
    return mk(y, (id + 1) % 12, (id % 27) + 1);
  }
  return Math.floor((Date.now() - (1000 - id) * 86400000) / 1000);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const imgMatch = url.pathname.match(/^\/img\/([mx])-(\d+)\.bmp$/);
  if (imgMatch) {
    const kind = imgMatch[1];
    const id = parseInt(imgMatch[2], 10);
    const { display, thumb } = dims(id);
    const size = kind === "x" ? display : thumb;
    const body = bmp(size.width, size.height, (id * 7) % 256, (id * 13) % 256, (id * 29) % 256);
    const send = () => {
      res.writeHead(200, { "content-type": "image/bmp", "cache-control": "no-store" });
      res.end(body);
    };
    if (kind === "x") setTimeout(send, DISPLAY_DELAY_MS);
    else send();
    return;
  }
  if (url.pathname.endsWith("/photos.get")) {
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);
    const count = Math.max(1, Math.min(1000, parseInt(url.searchParams.get("count") || "30", 10) || 30));
    if (MODE === "emptylater" && offset >= 100) {
      // 200 с пустым телом — имитация обрыва/обрезки ответа хостингом.
      res.writeHead(200, { "content-type": "application/json" });
      res.end("");
      return;
    }
    const items = [];
    for (let i = offset; i < Math.min(offset + count, TOTAL); i++) items.push(photo(i + 1));
    const payload = JSON.stringify({ response: { count: TOTAL, items } });
    console.log("photos.get offset=" + offset + " count=" + count + " t=" + Date.now());
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(payload);
    }, PHOTOS_DELAY_MS);
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { error_code: 1, error_msg: "not found " + url.pathname } }));
});

server.listen(PORT, "127.0.0.1", () => console.log("mock-vk v2 on " + PORT));
