// 本地开发的静态文件服务器：直接从 public/ 读，每次都是最新的（Cache-Control: no-cache + 按大小和修改时间的 ETag，没改就 304）。
// 只听 127.0.0.1；Worker（DEV_STATIC）把 /api、/auth 以外的请求转过来。见 dev/run.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../ui"); // Vibing Studio 的界面
const TYPES = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8", map: "application/json; charset=utf-8", txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8",
  xml: "application/xml; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  wasm: "application/wasm", pdf: "application/pdf", mp3: "audio/mpeg", mp4: "video/mp4", webm: "video/webm", wav: "audio/wav", zip: "application/zip",
};

// 同 Cloudflare 的 assets：/ → index.html，/a → a 或 a.html，/dir/ → dir/index.html
function resolve(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split("?")[0]); } catch { return null; }
  const abs = path.resolve(ROOT, "." + path.posix.normalize("/" + p));
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  for (const c of [abs, abs + ".html", path.join(abs, "index.html")]) {
    try { const st = fs.statSync(c); if (st.isFile()) return { file: c, st }; } catch { /* 下一个 */ }
  }
  return null;
}

export function startStatic(port = 8786, host = "127.0.0.1") {
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); return res.end(); }
    const hit = resolve(req.url || "/");
    if (!hit) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" }); return res.end("Not found"); }
    const etag = 'W/"' + hit.st.size.toString(36) + "-" + Math.floor(hit.st.mtimeMs).toString(36) + '"';
    const head = { "content-type": TYPES[path.extname(hit.file).slice(1).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache", etag };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, head); return res.end(); }
    res.writeHead(200, { ...head, "content-length": hit.st.size });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(hit.file).on("error", () => res.destroy()).pipe(res);
  });
  return new Promise((ok, fail) => { server.once("error", fail); server.listen(port, host, () => ok(server.address().port)); });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = await startStatic(+process.env.DEV_STATIC_PORT || 8786);
  console.log("ui/ → http://127.0.0.1:" + port);
}
