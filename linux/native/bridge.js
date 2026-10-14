// bridge.js —— Linux 版的桥（同 app/Sources/Bridge.swift）：页面 window.nadosNative.call(命令, 参数) 到这里，回信封 { ok, value } / { ok: false, error: { code, message } }
//   · local（local.js）：终端、命令、文件、Claude Code 会话
//   · 这里：App 本身——信息、剪贴板、通知、打开链接、窗口（标题、全屏、深浅色）、菜单栏、PDF、页面截图、角标、提醒
//   右键菜单不走原生（Linux 上系统菜单画不了页面给的图标、右边的值）：页面自己画（不在 commands 里，页面就用它自己的）
"use strict";
const { app, BrowserWindow, Menu, Notification, clipboard, shell, nativeTheme, nativeImage } = require("electron");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { Local, BridgeError, COMMANDS: LOCAL_COMMANDS } = require("./local");

const PROTOCOL = 1;
const COMMANDS = ["info", "permissions", "request", "settings", "notify", "clipboard.read", "clipboard.write", "openExternal", "badge", "attention", "window.fullscreen",
  "window.title", "window.new", "window.appearance", "window.titlebar", "menu.set", "page.snapshot", "pdf.render", "app.activate", "app.quit", "open.pending", "ui.stamp", "remote.open", "window.close",
  "app.update", "app.restartToUpdate", "app.autostart"]; // app.update：有没有新版本、下好了没有（main.js 的 updater）；app.restartToUpdate：换好的那一版马上重开

// 菜单：页面给的 [{ title, place, items: [{ id, title, key?, mods?, enabled?, checked?, sep?, items? }] }] → Electron 的菜单栏；点了 → menu.action { id }
//   mods 里的 cmd 在 Linux 上是 Ctrl（同 VS Code 的 Linux 版）
function accel(it) {
  if (!it.key) return undefined;
  const k = String(it.key).slice(0, 1).toUpperCase(), parts = [];
  for (const m of String(it.mods || "cmd").split(",")) {
    if (m === "cmd" || m === "ctrl") { if (!parts.includes("Ctrl")) parts.push("Ctrl"); }
    else if (m === "shift") parts.push("Shift");
    else if (m === "alt") parts.push("Alt");
  }
  return parts.concat([k === " " ? "Space" : k]).join("+");
}
function buildMenu(list, emit) {
  return (list || []).slice(0, 200).map((it) => {
    if (it.sep) return { type: "separator" };
    const o = { label: String(it.title || ""), enabled: it.enabled !== false };
    if (Array.isArray(it.items)) { o.submenu = buildMenu(it.items, emit); return o; }
    if (it.checked === true || it.checked === false) { o.type = "checkbox"; o.checked = !!it.checked; }
    const a = accel(it);
    if (a) { o.accelerator = a; o.registerAccelerator = false; } // 快捷键页面自己接（只写在菜单上给人看），不然按一下会触发两次
    o.click = () => { if (it.id) emit("menu.action", { id: it.id }); };
    return o;
  });
}

class Bridge {
  // win：这个窗口；opts：{ version, build, binDir, openPending: () => [...], newWindow(open) }
  constructor(win, opts) {
    this.win = win;
    this.opts = opts || {};
    this.local = new Local((type, detail) => this.emit(type, detail), { binDir: this.opts.binDir, version: this.opts.version });
    this.menus = null;
  }
  emit(type, detail) { const w = this.win; if (w && !w.isDestroyed()) w.webContents.send("nados:event", type, detail); }
  commands() { return COMMANDS.concat(LOCAL_COMMANDS); }
  info() {
    const w = this.win;
    return { platform: "linux", app: "Vibing Studio", version: this.opts.version || app.getVersion(), build: this.opts.build || "", protocol: PROTOCOL, local: true,
      os: os.release(), arch: process.arch, commands: this.commands(), active: !!(w && !w.isDestroyed() && w.isFocused()), fullscreen: !!(w && !w.isDestroyed() && w.isFullScreen()), inset: 0 };
  }
  async call(cmd, a) {
    try { const v = await this.run(String(cmd), a && typeof a === "object" ? a : {}); return { ok: true, value: v === undefined ? null : v }; }
    catch (e) { return { ok: false, error: { code: e.code || "E_FAILED", message: String(e.message || e) } }; }
  }
  async run(cmd, a) {
    const w = this.win;
    switch (cmd) {
      case "info": return this.info();
      case "permissions": return { notifications: Notification.isSupported() ? "granted" : "unsupported", screen: "unsupported", accessibility: "unsupported", files: "granted" };
      case "request": return { status: a.kind === "notifications" && Notification.isSupported() ? "granted" : "unsupported" };
      case "settings": return { opened: false };
      case "notify": {
        if (!Notification.isSupported()) throw BridgeError.permission("notifications are not supported on this desktop");
        const title = String(a.title || ""), body = String(a.body || "");
        if (!title && !body) throw BridgeError.args("notify { title, body } — at least one of them");
        const id = typeof a.id === "string" && a.id ? a.id : String(Date.now()) + Math.random().toString(36).slice(2);
        const n = new Notification({ title: title, subtitle: a.subtitle ? String(a.subtitle) : undefined, body: body, silent: a.sound === false });
        n.on("click", () => { if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } this.emit("notification-click", { id: id, data: a.data }); });
        n.show();
        return { id: id };
      }
      case "clipboard.read": return { text: clipboard.readText() };
      case "clipboard.write": if (typeof a.text !== "string") throw BridgeError.args("clipboard.write { text }"); clipboard.writeText(a.text); return { chars: a.text.length };
      case "openExternal": {
        let u;
        try { u = new URL(String(a.url || "")); } catch (e) { u = null; }
        if (!u || !/^(https?|mailto):$/.test(u.protocol)) throw BridgeError.args("openExternal { url } — http, https or mailto only");
        await shell.openExternal(u.toString());
        return { opened: true };
      }
      case "badge": { const t = String(a.text == null ? "" : a.text); try { app.setBadgeCount(/^\d+$/.test(t) ? +t : t ? 1 : 0); } catch (e) { /* 桌面不支持 */ } return { badge: t }; }
      case "attention": if (w && !w.isDestroyed() && !w.isFocused()) w.flashFrame(true); return { request: 1 };
      case "app.activate": if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } return { ok: true };
      case "app.quit": setTimeout(() => app.quit(), 200); return { ok: true };
      case "app.update": return this.opts.update ? this.opts.update.state(a.check === true) : { state: "none" };
      case "app.restartToUpdate": if (!this.opts.update) throw BridgeError.failed("no updater"); this.opts.update.relaunch(); return { ok: true };
      case "app.autostart": { const A = this.opts.autostart; if (!A) return { on: false, supported: false }; return { on: typeof a.on === "boolean" ? A.set(a.on) : A.on(), supported: true }; } // 登录时打开（main.js）
      case "window.fullscreen": { if (!w || w.isDestroyed()) throw BridgeError.failed("no window"); const on = w.isFullScreen(), want = typeof a.on === "boolean" ? a.on : !on; if (want !== on) w.setFullScreen(want); return { on: want }; }
      case "window.title": if (w && !w.isDestroyed()) w.setTitle(String(a.title || "Vibing Studio").slice(0, 200)); return null;
      case "window.new": return { id: this.opts.newWindow ? this.opts.newWindow(a.open) : null };
      // 用另一台 Mac：开一个窗口连它（已经开着就叫到前面；同 macOS 版的 AppDelegate.openRemote）
      case "remote.open": {
        if (!/^[\w-]{4,64}$/.test(String(a.mac || ""))) throw BridgeError.args("remote.open { mac, name? }");
        return { id: this.opts.openRemote ? this.opts.openRemote(String(a.mac), String(a.name || "")) : null };
      }
      // 连着另一台 Mac 的窗口「断开连接」：直接关（页面的 beforeunload 会把 close 拦下；这台的终端、程序都不在这个窗口里）
      case "window.close": if (w && !w.isDestroyed()) { if (w.__mac) w.destroy(); else w.close(); } return null;
      case "window.appearance": {
        // 窗口跟着页面的深浅色：标题栏、滚动条、系统对话框一起变；bg：页面的底色（拉大窗口、页面还没画到的地方）
        const mode = a.mode === "dark" || a.mode === "light" ? a.mode : "system";
        nativeTheme.themeSource = mode;
        if (w && !w.isDestroyed() && typeof a.bg === "string" && /^#[0-9a-f]{6}$/i.test(a.bg)) w.setBackgroundColor(a.bg);
        if (a.boot && this.opts.saveBoot) this.opts.saveBoot(a.boot);
        return null;
      }
      case "window.titlebar": { // Linux：右上角窗口按钮那一块的底色、图标色、高度跟着页面最上面那一条
        if (process.platform !== "linux" || !w || w.isDestroyed() || !w.setTitleBarOverlay) return null;
        const o = {};
        if (typeof a.color === "string" && a.color.length < 40) o.color = a.color;
        if (typeof a.symbol === "string" && a.symbol.length < 40) o.symbolColor = a.symbol;
        if (+a.height >= 24 && +a.height <= 64) o.height = Math.round(+a.height);
        try { w.setTitleBarOverlay(o); } catch (e) { /* 老的 Electron、不支持的桌面 */ }
        return null;
      }
      case "menu.set": {
        this.menus = Array.isArray(a.menus) ? a.menus : [];
        this.applyMenus();
        return null;
      }
      case "page.snapshot": {
        if (!w || w.isDestroyed()) return null;
        const n = (k) => Number(a[k]) || 0;
        let img = await w.webContents.capturePage(n("w") > 0 && n("h") > 0 ? { x: Math.round(n("x")), y: Math.round(n("y")), width: Math.round(n("w")), height: Math.round(n("h")) } : undefined);
        if (n("width") > 0) img = img.resize({ width: Math.round(n("width")) });
        return "data:image/jpeg;base64," + img.toJPEG(80).toString("base64");
      }
      case "pdf.render": {
        // 页面给的 HTML 排成 PDF（存成文件）：一个看不见的窗口里排版，Chromium 自己打印
        const html = String(a.html || ""), out = typeof a.path === "string" && a.path.startsWith("/") ? a.path : path.join(os.tmpdir(), "vibing-" + Date.now() + ".pdf");
        const pw = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
        try {
          await pw.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
          const pdf = await pw.webContents.printToPDF({ printBackground: true, pageSize: a.pageSize || "A4" });
          fs.writeFileSync(out, pdf);
          return { path: out, bytes: pdf.length };
        } finally { pw.destroy(); }
      }
      case "open.pending": return this.opts.openPending ? this.opts.openPending() : [];
      case "ui.stamp": return this.opts.uiStamp ? this.opts.uiStamp() : { stamp: 0, dir: "", local: false };
      default:
        if (LOCAL_COMMANDS.includes(cmd)) return this.local.run(cmd, a);
        throw new BridgeError("E_UNKNOWN_CMD", "unknown command \"" + cmd + "\"");
    }
  }
  // 这个窗口到前面了：菜单栏换成它的
  applyMenus() {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    const emit = (t, d) => this.emit(t, d);
    const tpl = [];
    const page = this.menus || [];
    const appItems = page.filter((m) => m.place === "app").flatMap((m) => buildMenu(m.items, emit));
    tpl.push({ label: "Vibing Studio", submenu: appItems.concat(appItems.length ? [{ type: "separator" }] : [], [{ role: "quit", label: "退出 Vibing Studio", accelerator: "Ctrl+Q" }]) });
    const files = page.filter((m) => m.place === "file"), help = page.filter((m) => m.place === "help"), rest = page.filter((m) => m.place !== "app" && m.place !== "file" && m.place !== "help");
    files.forEach((m) => tpl.push({ label: String(m.title || ""), submenu: buildMenu(m.items, emit) }));
    tpl.push({ role: "editMenu", label: "编辑" });
    rest.forEach((m) => tpl.push({ label: String(m.title || ""), submenu: buildMenu(m.items, emit) }));
    tpl.push({ role: "windowMenu", label: "窗口" });
    help.forEach((m) => tpl.push({ label: String(m.title || ""), submenu: buildMenu(m.items, emit) }));
    try { w.setMenu(Menu.buildFromTemplate(tpl)); } catch (e) { /* 菜单坏了不影响别的 */ }
  }
  dispose() { this.local.dispose(); }
}

module.exports = { Bridge: Bridge, nativeImage: nativeImage };
