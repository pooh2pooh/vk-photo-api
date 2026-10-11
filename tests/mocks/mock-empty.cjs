const http = require("http");
http.createServer((req,res)=>{ let b=""; req.on("data",c=>b+=c); req.on("end",()=>{
  res.writeHead(200,{"content-type":"application/json"});
  res.end(JSON.stringify({choices:[{message:{content:""},"finish_reason":"content_filter"}]}));
});}).listen(1312, ()=>console.log("mock-empty on 1312"));
