const http = require("http");
const fs = require("fs");
const PORT = 1313;
const path = require("node:path");
const LOG = process.env.QUOTA_LOG || path.join(__dirname, "..", ".tmp", "quota-calls.txt");
let calls = 0;
fs.writeFileSync(LOG, "", { flag: "w" });

http
  .createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      calls++;
      fs.appendFileSync(LOG, "call:" + calls + "\n");
      res.writeHead(429, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            code: 429,
            message:
              "You exceeded your current quota... limit: 20, model: gemini-3.8-flash (mock quota)",
            status: "RESOURCE_EXHAUSTED",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.RetryInfo",
                retryDelay: "41609.909452433s",
              },
            ],
          },
        }),
      );
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log("mock-quota on " + PORT));