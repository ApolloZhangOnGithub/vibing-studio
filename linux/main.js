// main.js —— Vibing Studio 的 Linux 桌面版（Electron）：同 macOS 版（app/）——
//   · 页面是网站那个源（https://code.paimon.beer/terminal.html）：登录、Cookie、同步、翻译都走网站；界面文件从本地读（App 里带的 ui/，同 LocalUI.swift），打开快、断网也能开
//   · 原生的桥（preload.js + native/）：终端、命令、文件、Claude Code 会话、剪贴板、通知、菜单栏……命令、参数、事件同 macOS 版，页面不分平台
//   · GPU：Chromium 自己用显卡画（终端是 xterm 的 WebGL），这里只打开 GPU 光栅化
// 启动参数：--url <地址>（开发：http://localhost:8787/terminal.html）；环境变量 VS_SERVICE（自己部署的服务端）、VS_UI_DIR（界面文件在哪）、VS_LOCAL_UI=0（从网站载入界面）
"use strict";
const { app, BrowserWindow, ipcMain, protocol, net, session, shell, dialog, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { Bridge } = require("./native/bridge");

const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
const VS_VER = PKG.vsVersion || PKG.version; // 四段的版本号（x.y.z.构建号，同 macOS 版、界面）
const SERVICE = String(process.env.VS_SERVICE || "https://code.paimon.beer").replace(/\/+$/, "");
const SERVICE_HOST = new URL(SERVICE).host;
const DEV_ORIGIN = "http://localhost:8787";
const ALLOWED = [new URL(SERVICE).origin, DEV_ORIGIN]; // 桥只给这两个源（同 Config.swift 的 bridgeOrigins）
const argUrl = (() => { const i = process.argv.indexOf("--url"); const u = i > 0 ? process.argv[i + 1] : ""; return /^https?:\/\//.test(u || "") ? u : ""; })();
const START = argUrl || SERVICE + "/terminal.html";
const HEADLESS = process.env.VS_HEADLESS === "1";
const LINUX = process.platform === "linux";
// 窗口的标题栏用系统自己的（GNOME、KDE 的按钮、拖动、双击最大化），不再自己画（以前用 Window Controls Overlay 自己画三个圆按钮，和系统风格对不上）

// GPU：光栅化交给显卡、少一次拷贝（Linux 上 Chromium 默认没开）；显卡在黑名单里的老驱动照旧退回 CPU
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.setName("Vibing Studio");
if (process.platform === "linux") app.setDesktopName("vibing-studio.desktop");

// ======== 界面文件：App 里带的一份（打包后在 resources/ui；开发时是仓库里的 ../ui）========
const UI_DIR = (() => {
  const c = [process.env.VS_UI_DIR, path.join(process.resourcesPath || "", "ui"), path.join(__dirname, "..", "ui"), path.join(__dirname, "ui")];
  for (const d of c) if (d && fs.existsSync(path.join(d, "terminal.html"))) return d;
  return null;
})();
const LOCAL_UI = !!UI_DIR && process.env.VS_LOCAL_UI !== "0" && new URL(START).origin === new URL(SERVICE).origin;
const MIME = { ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".otf": "font/otf", ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json", ".mp3": "audio/mpeg", ".mp4": "video/mp4" };
function uiStamp() {
  if (!UI_DIR) return 0;
  let t = 0;
  for (const f of ["terminal.html", "live.js", "studio/studio.js", "version.json"]) { try { t = Math.max(t, fs.statSync(path.join(UI_DIR, f)).mtimeMs); } catch (e) { /* 没有 */ } }
  return t;
}
// 网站给的页面里那一段（账号 id、有没有真沙盒）：<script>window.TSU_UID = 1; window.TSU_SBX = false;</script>——本地页面插上它
let lastInjection = "";
// 装好的 App（界面只有 App 里带的那一份）：联网时整页用网站上的（总是最新的，部署了就生效、出「重新载入以更新」），断网才用带的这份——同 macOS 版（LocalUI.swift 的 bundledOnly）。
//   开发时（仓库里的 ../ui、VS_UI_DIR）照旧读本地文件，改了就生效
const BUNDLED_ONLY = !!UI_DIR && !process.env.VS_UI_DIR && app.isPackaged && path.resolve(UI_DIR) === path.resolve(path.join(process.resourcesPath || "", "ui"));
let siteMode = false;
function buildLocal(inj) {
  let page = fs.readFileSync(path.join(UI_DIR, "terminal.html"), "utf8");
  const info = JSON.stringify({ dir: UI_DIR, stamp: uiStamp() });
  page = page.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + inj + "\n<script>window.TSU_UI_LOCAL = " + info + ";</script>");
  return new Response(page, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
async function localPage(req) {
  let r;
  try { r = await net.fetch(req, { bypassCustomProtocolHandlers: true }); }
  catch (e) { siteMode = false; if (lastInjection) return buildLocal(lastInjection); return new Response("Vibing Studio: can't reach " + SERVICE, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }); } // 断网：用上次那一段照样打开本地界面
  const html = await r.text();
  const m = /<script>window\.TSU_UID = [^<]*<\/script>/.exec(html);
  if (!m) return new Response(html, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "text/html; charset=utf-8", "cache-control": "no-store" } }); // 没登录（给的是登录页）、网站出错：照旧给网站的
  lastInjection = m[0];
  siteMode = BUNDLED_ONLY && r.ok;
  if (siteMode) return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }); // 联网：网站上最新的那一份
  return buildLocal(lastInjection);
}
function setupLocalUI() {
  if (!LOCAL_UI) return;
  protocol.handle("https", async (req) => {
    let u;
    try { u = new URL(req.url); } catch (e) { return net.fetch(req, { bypassCustomProtocolHandlers: true }); }
    if (u.host !== SERVICE_HOST || req.method !== "GET" || /^\/(api|auth)\//.test(u.pathname)) return net.fetch(req, { bypassCustomProtocolHandlers: true });
    if (u.pathname === "/terminal.html" || u.pathname === "/terminal") return localPage(req);
    if (siteMode) return net.fetch(req, { bypassCustomProtocolHandlers: true });
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
    const file = path.join(UI_DIR, rel);
    if (rel && !rel.includes("..") && file.startsWith(UI_DIR + path.sep)) {
      try {
        const st = fs.statSync(file);
        if (st.isFile()) return new Response(fs.readFileSync(file), { status: 200, headers: { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" } });
      } catch (e) { /* 本地没有：问网站 */ }
    }
    return net.fetch(req, { bypassCustomProtocolHandlers: true });
  });
}

// ======== 自己更新：网站上的 downloads/linux.json 写着最新的是哪一版（tools/release.sh 发的）；比现在跑的新——
//   AppImage 装的：下载这台芯片的那一份，换掉自己那个文件（Linux 上换掉正在跑的文件没事：跑着的照旧用原来那份），下次打开就是新的；
//     页面上「重启以更新」点一下就用新的那份重开。
//   deb 装的（在 /opt 里，要 root 才能换）：只告诉页面有新版本、下载地址（自己装）。一小时看一次；页面也能叫它马上看
const UPD = { state: "none", version: "", url: "", kind: process.env.APPIMAGE ? "appimage" : "deb", err: "", busy: false, at: 0 };
const buildOf = (v) => +(String(v || "").split(".")[3] || 0);
function updEmit() { for (const w of wins.values()) { try { w.bridge.emit("app.update", Object.assign({}, UPD)); } catch (e) { /* 窗口关了 */ } } }
async function checkUpdate() {
  if (UPD.busy || HEADLESS) return;
  UPD.busy = true; UPD.at = Date.now();
  try {
    const r = await net.fetch(SERVICE + "/downloads/linux.json", { cache: "no-store" });
    if (!r.ok) throw new Error("linux.json: HTTP " + r.status); // 没登录（下载要登录）、还没发过
    const m = await r.json(), arch = process.arch === "arm64" ? "arm64" : "x64";
    if (!(buildOf(m.version) > buildOf(VS_VER))) { UPD.state = "none"; UPD.err = ""; return; }
    if (UPD.kind === "appimage") {
      if (UPD.state === "ready" && UPD.version === m.version) return;
      // 网站上一个文件最多 25 MB：AppImage 切成几段放（tools/release-linux.sh），这里一段段下、接起来、核对 sha256 再换
      const rel = m[arch], parts = rel && Array.isArray(rel.parts) ? rel.parts : rel ? [String(rel)] : [];
      if (!parts.length) throw new Error("no " + arch + " AppImage");
      const dst = process.env.APPIMAGE, tmp = dst + ".download";
      UPD.state = "downloading"; UPD.version = m.version; updEmit();
      const fd = fs.openSync(tmp, "w", 0o755), hash = crypto.createHash("sha256");
      try {
        for (const p of parts) {
          const d = await net.fetch(SERVICE + "/" + String(p).replace(/^\/+/, ""));
          if (!d.ok) throw new Error("download: HTTP " + d.status);
          const b = Buffer.from(await d.arrayBuffer());
          hash.update(b); fs.writeSync(fd, b);
        }
      } finally { fs.closeSync(fd); }
      if (rel.sha256 && hash.digest("hex") !== rel.sha256) throw new Error("download corrupted (sha256)");
      fs.chmodSync(tmp, 0o755);
      fs.renameSync(tmp, dst); // 原子地换掉：正在跑的这个照旧
      UPD.state = "ready";
    } else {
      UPD.state = "available"; UPD.version = m.version; UPD.url = /^https?:/.test(String(m.deb || "")) ? String(m.deb) : SERVICE; // deb：发行版页面（GitHub，下载 .deb 自己装）
    }
    UPD.err = "";
  } catch (e) { UPD.err = String((e && e.message) || e); if (UPD.state === "downloading") UPD.state = "none"; }
  finally { UPD.busy = false; updEmit(); }
}
const updater = {
  state: (check) => { if (check || Date.now() - UPD.at > 3600e3) checkUpdate(); return Object.assign({}, UPD); },
  // 换好的那一份重开：AppImage 用它自己那个文件（正在跑的是挂载出来的旧的那份）
  relaunch: () => { if (UPD.state !== "ready") return; app.relaunch(process.env.APPIMAGE ? { execPath: process.env.APPIMAGE, args: process.argv.slice(1) } : undefined); app.quit(); },
};
app.whenReady().then(() => { setTimeout(checkUpdate, 15000); setInterval(checkUpdate, 3600e3); });

// ======== 登录时打开（默认开）：这台常常是给别的设备用的（远程桌面、在新窗口中打开、打开终端都要它开着）——
//   重启、注销再登录后没人去点它，别的设备就连不上（用户 2026-10-14：Linux 那台没开着，什么都连不上）。
//   ~/.config/autostart/vibing-studio.desktop（XDG 自动启动，GNOME、KDE 都认）；设置里关掉就挪开它、另记一个「关了」（不再自己加回来）
const AUTOSTART = path.join(app.getPath("home"), ".config", "autostart", "vibing-studio.desktop");
const AUTOSTART_OFF = path.join(app.getPath("userData"), "autostart-off");
const autostartExec = () => process.env.APPIMAGE || process.execPath;
function autostartOn() { return fs.existsSync(AUTOSTART); }
function setAutostart(on) {
  try {
    if (on) {
      fs.mkdirSync(path.dirname(AUTOSTART), { recursive: true });
      const q = (x) => '"' + String(x).replace(/(["\\`$])/g, "\\$1") + '"';
      fs.writeFileSync(AUTOSTART, ["[Desktop Entry]", "Type=Application", "Name=Vibing Studio", "Exec=" + q(autostartExec()), "Icon=vibing-studio",
        "X-GNOME-Autostart-enabled=true", "X-GNOME-Autostart-Delay=5", "Terminal=false", ""].join("\n"));
      if (fs.existsSync(AUTOSTART_OFF)) fs.renameSync(AUTOSTART_OFF, AUTOSTART_OFF + ".was");
    } else {
      if (fs.existsSync(AUTOSTART)) fs.renameSync(AUTOSTART, AUTOSTART + ".off"); // 不删：挪开（XDG 只认 .desktop）
      fs.writeFileSync(AUTOSTART_OFF, "1");
    }
  } catch (e) { console.error("autostart:", e.message); }
  return autostartOn();
}
const autostart = process.platform === "linux" ? { on: autostartOn, set: setAutostart } : null; // 只在 Linux 上（在 Mac 上开发、测试时不碰）
app.whenReady().then(() => {
  if (process.platform !== "linux" || process.env.VS_HEADLESS === "1" || process.env.VS_TESTJS) return; // 自动测试：不动这台的自动启动
  // 第一次（没关过）：加上；AppImage 换了地方（更新、挪了文件夹）：写成现在这一份
  if (!fs.existsSync(AUTOSTART_OFF)) {
    let cur = ""; try { cur = fs.readFileSync(AUTOSTART, "utf8"); } catch (e) { cur = ""; }
    if (!cur || cur.indexOf(autostartExec()) < 0) setAutostart(true);
  }
});

// ======== 窗口 ========
const wins = new Map(); // webContents.id → { win, bridge }
const statePath = () => path.join(app.getPath("userData"), "window.json");
function loadState() { try { return JSON.parse(fs.readFileSync(statePath(), "utf8")); } catch (e) { return {}; } }
function saveState(o) { try { fs.mkdirSync(path.dirname(statePath()), { recursive: true }); fs.writeFileSync(statePath(), JSON.stringify(Object.assign(loadState(), o))); } catch (e) { /* 写不了就算了 */ } }
let pendingOpen = []; // 命令行、文件管理器里用这个 App 打开的文件、文件夹：页面来要（open.pending）
const inApp = (u) => {
  try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) return false; return x.host === SERVICE_HOST || x.origin === new URL(START).origin || x.hostname === "localhost" || x.hostname === "127.0.0.1"; }
  catch (e) { return false; }
};
let creating = false;
// mac：连另一台 Mac 的窗口（页面上 ?mac=：preload 把这台的桥交给 remote.js，它把终端、文件、会话那些转到那台 Mac 去）
function createWindow(open, mac, mname) {
  const st = loadState(), b = st.bounds || {};
  const boot = st.boot || {}, dark = boot.mode !== "light";
  creating = true;
  const win = new BrowserWindow({
    width: b.width || 1440, height: b.height || 900, x: b.x, y: b.y, minWidth: 480, minHeight: 320,
    title: "Vibing Studio", backgroundColor: (dark ? boot.dark : boot.light) || (dark ? "#1e1e1e" : "#ffffff"),
    icon: path.join(__dirname, "icons", "512x512.png"), autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, offscreen: HEADLESS },
  });
  creating = false;
  if (st.maximized) win.maximize();
  attach(win);
  if (!HEADLESS) win.once("ready-to-show", () => win.show());
  let url = START;
  if (open || mac) { try { const u = new URL(START); if (open) u.searchParams.set("open", String(open)); if (mac) { u.searchParams.set("mac", String(mac)); u.searchParams.set("win", String(win.webContents.id)); if (mname) u.searchParams.set("mname", String(mname)); } url = u.toString(); } catch (e) { /* 照旧 */ } }
  if (mac) win.__mac = String(mac);
  // 自动测试（同 macOS 版的 NADOS_TESTJS）：VS_TESTJS=<文件>——主窗口的页面载完，把它当成 async 函数体在页面里跑一遍，返回值写到 VS_TESTJS_OUT
  if (process.env.VS_TESTJS && !mac) win.webContents.once("did-finish-load", () => {
    const src = fs.readFileSync(process.env.VS_TESTJS, "utf8"), out = process.env.VS_TESTJS_OUT || process.env.VS_TESTJS.replace(/\.js$/, "") + ".json";
    win.webContents.executeJavaScript("(async () => {\n" + src + "\n})()", true).then((v) => fs.writeFileSync(out, JSON.stringify({ page: v }, null, 1)), (e) => fs.writeFileSync(out, JSON.stringify({ error: String((e && e.stack) || e) })));
  });
  win.loadURL(url);
  return win;
}
// 用另一台 Mac：它已经开着窗口就叫到前面（一台 Mac 一个窗口）；没有就开一个
function openRemote(mac, mname) {
  const hit = Array.from(wins.values()).find((x) => x.win && !x.win.isDestroyed() && x.win.__mac === mac);
  if (hit) { if (hit.win.isMinimized()) hit.win.restore(); hit.win.show(); hit.win.focus(); return hit.win.webContents.id; }
  return createWindow(null, mac, mname).webContents.id;
}
// ======== 登录：交给系统浏览器（同 macOS 版的 BrowserAuth.swift）——用浏览器里已经登录着的 GitHub（通行密钥、两步验证都在浏览器里），做完回到 App ========
//   同 PKCE：App 生成随机的 verifier，只把它的 sha256（challenge）交给网站；网站做完把一次性的 code 交回这台电脑上 App 临时开的一个本机端口（127.0.0.1，RFC 8252），
//   App 再带着 code + verifier 去换会话（Cookie 存在 App 自己的会话里）——别的程序截到 code 也换不了。?dev=：本地开发的测试登录，照旧在 App 里
const isLogin = (u) => { try { const x = new URL(u); return x.origin === new URL(SERVICE).origin && x.pathname === "/auth/login" && !x.searchParams.has("dev"); } catch (e) { return false; } };
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let loginSrv = null;
const DONE_PAGE = '<!doctype html><meta charset="utf-8"><title>Vibing Studio</title><style>body{font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#1e1e1e;color:#ddd}div{text-align:center}b{display:block;font-size:20px;margin-bottom:8px;color:#fff}</style><div><b>已登录</b>回到 Vibing Studio 就能用了，这个页面可以关掉。</div>';
function browserLogin(win, url) {
  let next = "/terminal.html";
  try { const n = new URL(url).searchParams.get("next"); if (n && n[0] === "/" && n[1] !== "/") next = n; } catch (e) { /* 照旧 */ }
  if (loginSrv) { try { loginSrv.close(); } catch (e) { /* 已经关了 */ } loginSrv = null; }
  const verifier = b64url(crypto.randomBytes(32)), challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const srv = http.createServer((req, res) => {
    let u; try { u = new URL(req.url, "http://127.0.0.1"); } catch (e) { res.writeHead(400); res.end(); return; }
    if (u.pathname !== "/auth") { res.writeHead(404); res.end(); return; }
    const code = u.searchParams.get("code") || "";
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(DONE_PAGE);
    if (loginSrv === srv) loginSrv = null;
    setTimeout(() => { try { srv.close(); } catch (e) { /* 已经关了 */ } }, 500);
    if (!/^[A-Za-z0-9_-]{43}$/.test(code) || win.isDestroyed()) return;
    // 换会话：网站回的 Cookie 存进这个 App 的会话（net.fetch 用的就是它），然后打开 App 的页面
    net.fetch(SERVICE + "/auth/app?code=" + code + "&verifier=" + verifier + "&next=" + encodeURIComponent(next), { bypassCustomProtocolHandlers: true })
      .catch(() => null)
      .then(() => { if (win.isDestroyed()) return; win.loadURL(SERVICE + next); if (win.isMinimized()) win.restore(); win.show(); win.focus(); });
  });
  srv.on("error", () => { if (loginSrv === srv) loginSrv = null; });
  srv.listen(0, "127.0.0.1", () => {
    const port = srv.address().port;
    const to = SERVICE + "/auth/login?app=" + challenge + "&port=" + port + "&next=" + encodeURIComponent(next);
    if (HEADLESS) net.fetch(to, { bypassCustomProtocolHandlers: true }).catch(() => {}); // 自动测试：不开真的浏览器，在后台把这一串跳转走完
    else shell.openExternal(to);
  });
  loginSrv = srv;
  setTimeout(() => { if (loginSrv === srv) { try { srv.close(); } catch (e) { /* 已经关了 */ } loginSrv = null; } }, 15 * 60 * 1000); // 15 分钟没登完：不等了
}
// 一个窗口接上桥：createWindow 开的、页面 window.open 开的（同站的新窗口）都一样
function attach(win) {
  const st = loadState();
  const bridge = new Bridge(win, {
    version: VS_VER, build: process.env.VS_BUILD || "", binDir: app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked", "bin") : path.join(__dirname, "bin"),
    openPending: () => { const l = pendingOpen; pendingOpen = []; return l; },
    newWindow: (o) => createWindow(o).webContents.id,
    openRemote: (mac, mname) => openRemote(mac, mname),
    saveBoot: (b0) => saveState({ boot: Object.assign({}, loadState().boot || {}, b0) }),
    uiStamp: () => ({ stamp: uiStamp(), dir: UI_DIR || "", local: LOCAL_UI }),
    update: updater, autostart: autostart,
  });
  const id = win.webContents.id;
  wins.set(id, { win: win, bridge: bridge });
  win.on("focus", () => { bridge.emit("active", { active: true }); bridge.applyMenus(); });
  win.on("blur", () => bridge.emit("active", { active: false }));
  win.on("enter-full-screen", () => bridge.emit("fullscreen", { on: true, inset: 0 }));
  win.on("leave-full-screen", () => bridge.emit("fullscreen", { on: false, inset: 0 }));
  const keep = () => { if (win.isDestroyed()) return; saveState({ bounds: win.isMaximized() || win.isFullScreen() ? loadState().bounds : win.getBounds(), maximized: win.isMaximized() }); };
  win.on("resize", keep); win.on("move", keep);
  // 关窗口前：终端里还有程序在跑（claude、npm run dev……）就问一声（同「终端」）
  win.on("close", (e) => {
    const run = bridge.local.running();
    if (!run.length || win.__sure) return;
    const r = dialog.showMessageBoxSync(win, { type: "warning", buttons: ["关闭", "取消"], defaultId: 1, cancelId: 1, message: "要关闭这个窗口吗？", detail: "以下程序还在运行，关闭后会被终止：" + Array.from(new Set(run)).join("、") });
    if (r !== 0) e.preventDefault(); else win.__sure = true;
  });
  win.on("closed", () => { bridge.dispose(); wins.delete(id); });
  // 站外的链接交给默认浏览器；站内的新窗口（window.open 同站）开成 App 的窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isLogin(url)) { browserLogin(win, url); return { action: "deny" }; }
    if (inApp(url)) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true } } };
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isLogin(url)) { e.preventDefault(); browserLogin(win, url); return; }
    if (!inApp(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  void st;
}
app.on("browser-window-created", (_e, w) => {
  if (creating || wins.has(w.webContents.id)) return;
  const pre = w.webContents.getLastWebPreferences ? (w.webContents.getLastWebPreferences() || {}).preload : null;
  if (pre) attach(w); // 看不见的（排 PDF 的）没有 preload：不接
});
const bridgeOf = (wc) => { const w = wins.get(wc.id); return w ? w.bridge : null; };

// ======== 桥 ========
ipcMain.on("nados:boot", (e) => {
  const b = bridgeOf(e.sender);
  e.returnValue = { allowed: ALLOWED, info: { platform: "linux", app: "Vibing Studio", version: VS_VER, protocol: 1, local: !!b } };
});
ipcMain.handle("nados:call", async (e, cmd, args) => {
  const f = e.senderFrame;
  if (!f || f !== e.sender.mainFrame || ALLOWED.indexOf(f.origin) < 0) return { ok: false, error: { code: "E_ORIGIN", message: (f && f.origin) + " may not use the native bridge" } };
  const b = bridgeOf(e.sender);
  if (!b) return { ok: false, error: { code: "E_FAILED", message: "no bridge for this window" } };
  return b.call(cmd, args);
});

// ======== App ========
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
const pathsIn = (argv) => argv.slice(1).filter((a) => a && !a.startsWith("-") && a !== "." && path.isAbsolute(a) && fs.existsSync(a));
app.on("second-instance", (_e, argv) => {
  const ps = pathsIn(argv);
  const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (ps.length) { pendingOpen = pendingOpen.concat(ps); if (w) { const b = bridgeOf(w.webContents); if (b) b.emit("open-files", { paths: ps }); } }
  if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } else createWindow();
});
app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // 菜单栏等页面给（menu.set）
  setupLocalUI();
  pendingOpen = pathsIn(process.argv);
  createWindow();
});
app.on("window-all-closed", () => app.quit()); // Linux：窗口都关了就退出（同别的 Linux App）
