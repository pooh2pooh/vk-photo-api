/* OpenAI-совместимый мок ИИ для тестов «стопок».
   Определяет тему по id фото (детерминированно: id % 4). */
const http = require("node:http");
const PORT = 1310;
const WORDS = ["альфа", "бета", "гамма", "дельта"];

const server = http.createServer((req, res) => {
  if (!req.url.includes("/chat/completions")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found " + req.url } }));
    return;
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    let ids = [];
    const messages = body.messages || [];
    for (const message of messages) {
      if (message.role !== "user" || !Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (part.type === "text") {
          const nums = String(part.text).match(/\d+/g) || [];
          ids = nums.map(Number).filter((n) => n > 0 && n <= 100000);
          break;
        }
      }
      if (ids.length) break;
    }
    const labels = {};
    for (const id of ids) labels[id] = WORDS[id % 4];
    const content = JSON.stringify({ labels });
    const imgCount = Array.isArray(body.messages?.[1]?.content)
      ? body.messages[1].content.filter((p) => p.type === "image_url").length
      : -1;
    console.error("batch:" + imgCount + " ids:" + ids.length);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  });
});

server.listen(PORT, "127.0.0.1", () => console.log("mock-ai on " + PORT));