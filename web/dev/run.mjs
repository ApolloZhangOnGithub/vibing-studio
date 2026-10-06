// 本地开发：node dev/run.mjs [wrangler dev 的参数，如 --port 8787 --ip 127.0.0.1]
// wrangler dev 一见 assets 目录（public/）里有文件改动就重启本地服务器（⎔ Reloading local server…），进行中的请求全断：
// agent 的回答说到一半没了、真终端的 shell 被杀、后台命令失败。所以本地开发时：
//   · 静态文件由 dev/static.mjs 直接从 public/ 读（改了刷新页面就是新的，服务器不重启）
//   · wrangler 的 assets 指向 dev/stub（空的、不会变），Worker 看到 DEV_STATIC 就把 /api、/auth 以外的请求转给上面那个服务器
// 改 src/ 里的 Worker 代码仍会重启（那是要的）。线上不受影响（没有 DEV_STATIC，照常用 [assets]）
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStatic } from "./static.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = await startStatic(+process.env.DEV_STATIC_PORT || 8786);
console.log("[dev] public/ → http://127.0.0.1:" + port + "（改前端文件不再重启 wrangler）");
const args = ["dev", "--assets", path.join(here, "stub"), "--var", "DEV_STATIC:http://127.0.0.1:" + port, ...process.argv.slice(2)];
// wrangler dev（4.114）在代理着的 WebSocket（真终端）被硬断时（浏览器标签页直接关掉、App 退出）会报 Network connection lost 然后整个退出：
// 退出了就自动再起一个（1 秒后；一分钟里退了 5 次就不再起，免得真有错时刷屏）
let w = null, stopping = false, exits = [];
function start() {
  w = spawn(process.env.WRANGLER || "wrangler", args, { stdio: "inherit", cwd: path.resolve(here, "..") });
  w.on("exit", (code, sig) => {
    if (stopping) return process.exit(code ?? (sig ? 1 : 0));
    exits = exits.filter((t) => Date.now() - t < 60000).concat(Date.now());
    if (exits.length >= 5) { console.error("[dev] wrangler 一分钟里退出了 5 次，不再自动重启"); return process.exit(code || 1); }
    console.error("[dev] wrangler 退出了（" + (code ?? sig) + "），1 秒后重启");
    setTimeout(start, 1000);
  });
}
start();
for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => { stopping = true; w.kill(s); });
