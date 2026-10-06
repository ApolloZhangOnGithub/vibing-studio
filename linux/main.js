// main.js —— Vibing Studio 的 Linux 桌面版（Electron）：同 macOS 版（app/）——
//   · 页面是网站那个源（https://code.paimon.beer/terminal.html）：登录、Cookie、同步、翻译都走网站；界面文件从本地读（App 里带的 ui/，同 LocalUI.swift），打开快、断网也能开
//   · 原生的桥（preload.js + native/）：终端、命令、文件、Claude Code 会话、剪贴板、通知、菜单栏……命令、参数、事件同 macOS 版，页面不分平台
//   · GPU：Chromium 自己用显卡画（终端是 xterm 的 WebGL），这里只打开 GPU 光栅化
// 启动参数：--url <地址>（开发：http://localhost:8787/terminal.html）；环境变量 VS_SERVICE（自己部署的服务端）、VS_UI_DIR（界面文件在哪）、VS_LOCAL_UI=0（从网站载入界面）
"use strict";
const { app, BrowserWindow, ipcMain, protocol, net, session, shell, dialog, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const { Bridge } = require("./native/bridge");

const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
const SERVICE = String(process.env.VS_SERVICE || "https://code.paimon.beer").replace(/\/+$/, "");
const SERVICE_HOST = new URL(SERVICE).host;
const DEV_ORIGIN = "http://localhost:8787";
const ALLOWED = [new URL(SERVICE).origin, DEV_ORIGIN]; // 桥只给这两个源（同 Config.swift 的 bridgeOrigins）
const argUrl = (() => { const i = process.argv.indexOf("--url"); const u = i > 0 ? process.argv[i + 1] : ""; return /^https?:\/\//.test(u || "") ? u : ""; })();
const START = argUrl || SERVICE + "/terminal.html";
const HEADLESS = process.env.VS_HEADLESS === "1"; // 自动测试：窗口不露出来（离屏画），不打扰正在用电脑的人

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
function buildLocal(inj) {
  let page = fs.readFileSync(path.join(UI_DIR, "terminal.html"), "utf8");
  const info = JSON.stringify({ dir: UI_DIR, stamp: uiStamp() });
  page = page.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + inj + "\n<script>window.TSU_UI_LOCAL = " + info + ";</script>");
  return new Response(page, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
async function localPage(req) {
  let r;
  try { r = await net.fetch(req, { bypassCustomProtocolHandlers: true }); }
  catch (e) { if (lastInjection) return buildLocal(lastInjection); return new Response("Vibing Studio: can't reach " + SERVICE, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }); } // 断网：用上次那一段照样打开本地界面
  const html = await r.text();
  const m = /<script>window\.TSU_UID = [^<]*<\/script>/.exec(html);
  if (!m) return new Response(html, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "text/html; charset=utf-8", "cache-control": "no-store" } }); // 没登录（给的是登录页）、网站出错：照旧给网站的
  lastInjection = m[0];
  return buildLocal(lastInjection);
}
function setupLocalUI() {
  if (!LOCAL_UI) return;
  protocol.handle("https", async (req) => {
    let u;
    try { u = new URL(req.url); } catch (e) { return net.fetch(req, { bypassCustomProtocolHandlers: true }); }
    if (u.host !== SERVICE_HOST || req.method !== "GET" || /^\/(api|auth)\//.test(u.pathname)) return net.fetch(req, { bypassCustomProtocolHandlers: true });
    if (u.pathname === "/terminal.html" || u.pathname === "/terminal") return localPage(req);
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

// ======== 窗口 ========
const wins = new Map(); // webContents.id → { win, bridge }
const statePath = () => path.join(app.getPath("userData"), "window.json");
function loadState() { try { return JSON.parse(fs.readFileSync(statePath(), "utf8")); } catch (e) { return {}; } }
function saveState(o) { try { fs.mkdirSync(path.dirname(statePath()), { recursive: true }); fs.writeFileSync(statePath(), JSON.stringify(Object.assign(loadState(), o))); } catch (e) { /* 写不了就算了 */ } }
let pendingOpen = []; // 命令行、文件管理器里用这个 App 打开的文件、文件夹：页面来要（open.pending）
const inApp = (u) => {
  try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) return false; return x.host === SERVICE_HOST || x.origin === new URL(START).origin || x.hostname === "localhost" || x.hostname === "127.0.0.1" || x.hostname === "github.com"; }
  catch (e) { return false; }
};
let creating = false;
function createWindow(open) {
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
  if (open) { try { const u = new URL(START); u.searchParams.set("open", String(open)); url = u.toString(); } catch (e) { /* 照旧 */ } }
  win.loadURL(url);
  return win;
}
// 一个窗口接上桥：createWindow 开的、页面 window.open 开的（同站的新窗口）都一样
function attach(win) {
  const st = loadState();
  const bridge = new Bridge(win, {
    version: PKG.version, build: process.env.VS_BUILD || "", binDir: app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked", "bin") : path.join(__dirname, "bin"),
    openPending: () => { const l = pendingOpen; pendingOpen = []; return l; },
    newWindow: (o) => createWindow(o).webContents.id,
    saveBoot: (b0) => saveState({ boot: Object.assign({}, loadState().boot || {}, b0) }),
    uiStamp: () => ({ stamp: uiStamp(), dir: UI_DIR || "", local: LOCAL_UI }),
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
    if (inApp(url)) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true } } };
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => { if (!inApp(url)) { e.preventDefault(); shell.openExternal(url); } });
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
  e.returnValue = { allowed: ALLOWED, info: { platform: "linux", app: "Vibing Studio", version: PKG.version, protocol: 1, local: !!b } };
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
