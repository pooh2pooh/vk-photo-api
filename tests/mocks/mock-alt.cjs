const http = require("http");
const PORT = process.env.PORT || 1311;

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let ids = [];
      try {
        const m = JSON.parse(body);
        const t = String(m.messages[1].content[0].text || "");
        const mm = t.match(/\d+/g);
        ids = mm ? mm.map(Number) : [];
      } catch (e) {}
      const labels = {};
      ids.forEach((id, i) => (labels[id] = "тема" + (i % 2)));
      const text = 'Ответ с "пояснением". {"labels":' + JSON.stringify(labels) + "}";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ text }] }));
    });
  })
  .listen(PORT, () => console.log("mock-alt (completions-style) on " + PORT));