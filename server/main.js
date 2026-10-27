// main.js —— Vibing Studio 的 Linux 服务器版（没有桌面也能用）：一个后台服务，让你别的设备（Mac、iPad、网页）用这台服务器——
//   在新窗口中打开、终端、文件、Claude Code / Codex 的会话、agent，都在这台上跑。同 Linux 桌面版、Mac App 当主机的那一套（host.js、local.js），只是没有窗口。
//   装：「设备」›「添加服务器」给的一条命令（install.sh）：下载 Node 运行时和这个程序包、配对（pair）、装成开机自己起来的服务、跑起来
//   登录：配对时生成一把自己的钥匙（P-256，私钥只在这台的 ~/.config/vibing-studio-server/key.pem），公钥登记到账号；以后自己签名登录（同 Mac App 的「用 Touch ID 登录」）
//   更新：每 6 小时看一次网站上的新版本，有就下载、校验、换上、重启（服务管理器把它拉起来）
// 用法：vibing-studio-server run | status | logs | update | pair <口令> | version
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");
const { Local } = require("./local");
const { Host } = require("./host");

const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
const VERSION = PKG.vsVersion || PKG.version, BUILD = +PKG.build || 0;
const CFG = process.env.VS_SERVER_CONFIG || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "vibing-studio-server");
const DATA = process.env.VS_SERVER_DATA || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "vibing-studio-server");
const STATE = path.join(CFG, "state.json"), KEY = path.join(CFG, "key.pem"), STATUS = path.join(DATA, "status.json"), LOG = path.join(DATA, "server.log");
const ZH = /^zh/i.test(process.env.VS_LANG || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "");
const T = (zh, en) => (ZH ? zh : en);
const ARCH = process.arch === "arm64" ? "arm64" : "x64";

// ---- 小工具 ----
const b64u = (b) => Buffer.from(b).toString("base64url");
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };
const writeJSON = (f, o, mode) => { fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); const t = f + ".tmp-" + process.pid; fs.writeFileSync(t, JSON.stringify(o, null, 1), { mode: mode || 0o600 }); fs.renameSync(t, f); };
function log(s) {
  const line = new Date().toISOString() + " " + s + "\n";
  try {
    fs.mkdirSync(DATA, { recursive: true });
    try { if (fs.statSync(LOG).size > 5 << 20) fs.renameSync(LOG, LOG + ".1"); } catch (e) { /* 还没有 */ }
    fs.appendFileSync(LOG, line);
  } catch (e) { /* 写不了日志：照常跑 */ }
  if (process.stdout.isTTY) process.stdout.write(line);
}
function osName() { try { const m = /^PRETTY_NAME="?([^"\n]*)"?/m.exec(fs.readFileSync("/etc/os-release", "utf8")); if (m) return m[1]; } catch (e) { /* 没有 */ } return os.type() + " " + os.release(); }
const store = {
  get() { return readJSON(STATE, {}); },
  set(o) { writeJSON(STATE, Object.assign(readJSON(STATE, {}), o)); },
};

// ---- 钥匙：P-256，私钥只在这台（0600）----
function key() {
  if (fs.existsSync(KEY)) return crypto.createPrivateKey(fs.readFileSync(KEY));
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  fs.mkdirSync(CFG, { recursive: true, mode: 0o700 });
  fs.writeFileSync(KEY, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  return privateKey;
}
function pubRaw(k) { const j = crypto.createPublicKey(k).export({ format: "jwk" }); return Buffer.concat([Buffer.from([4]), Buffer.from(j.x, "base64url"), Buffer.from(j.y, "base64url")]); }

async function post(url, body, cookie) {
  const r = await fetch(url, { method: "POST", headers: Object.assign({ "content-type": "application/json" }, cookie ? { cookie } : {}), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

// ---- 配对：安装命令里的一次性口令 + 这台的公钥 → 一把登记在账号上的设备钥匙 ----
async function pair(origin, token) {
  const k = key(), st = store.get();
  const { status, j } = await post(origin + "/auth/server/pair", { token, pub: b64u(pubRaw(k)), name: os.hostname(), os: osName(), arch: ARCH });
  if (status !== 200 || !j.ok) throw new Error(j.message || j.error || "pairing failed (" + status + ")");
  store.set({ origin, keyId: j.id, login: j.login || "", device: st.device || "srv-" + crypto.randomBytes(6).toString("hex"), pairedAt: Date.now(), revoked: false });
  return j;
}

// ---- 登录：要随机数 → 签「vs-devicekey-v1\n随机数」→ 换一次性的 code → 拿 code + verifier 换会话 Cookie（同 Mac App）----
let session = { cookie: "", at: 0 }, loggingIn = null;
async function login() {
  const st = store.get();
  if (!st.keyId || !st.origin) throw new Error("not paired");
  const verifier = b64u(crypto.randomBytes(32)), challenge = b64u(crypto.createHash("sha256").update(verifier).digest());
  let r = await post(st.origin + "/auth/devicekey/options", { id: st.keyId, app: challenge });
  if (!r.j.ok) throw new Error(r.j.error || "sign-in failed (" + r.status + ")");
  const sig = crypto.sign("sha256", Buffer.from("vs-devicekey-v1\n" + r.j.challenge), key());
  r = await post(st.origin + "/auth/devicekey/login", { id: st.keyId, challenge: r.j.challenge, sig: b64u(sig) });
  if (!r.j.ok) {
    const msg = String(r.j.error || "");
    if (/isn't set up|anymore/i.test(msg)) { store.set({ revoked: true }); throw new Error("removed"); } // 在「设备」里被移除了：钥匙不在账号上了
    throw new Error(msg || "sign-in failed (" + r.status + ")");
  }
  const res = await fetch(st.origin + "/auth/app?code=" + encodeURIComponent(r.j.code) + "&verifier=" + verifier, { redirect: "manual" });
  const c = (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""]).map((s) => s.split(";")[0]).filter((s) => /^tsu_s=./.test(s))[0];
  if (!c) throw new Error("sign-in failed (no session)");
  session = { cookie: c, at: Date.now() };
  if (st.revoked) store.set({ revoked: false });
  log("signed in as " + (st.login || "account"));
  return c;
}
function relogin() { if (!loggingIn) loggingIn = login().finally(() => { loggingIn = null; }); return loggingIn; }
async function cookie() { if (session.cookie && Date.now() - session.at < 20 * 864e5) return session.cookie; return relogin(); }

// ---- 状态（vibing-studio-server status 读它）----
let host = null, lastReport = "", reportT = null, updating = false, lastUpdateErr = "";
function writeStatus() {
  const st = store.get(), hs = host ? host.state() : null;
  writeJSON(STATUS, { pid: process.pid, version: VERSION, build: BUILD, at: Date.now(), origin: st.origin || "", login: st.login || "", device: st.device || "", name: os.hostname(),
    paired: !!st.keyId, revoked: !!st.revoked, up: !!(hs && hs.up), since: hs ? hs.since : 0, error: hs ? hs.error : "", clients: hs ? hs.clients : [], update: lastUpdateErr }, 0o644);
}
// 报到「设备」：名字、系统、版本、谁能用它（同各设备页面里 sync.js 报的那一份）
function report() {
  clearTimeout(reportT);
  reportT = setTimeout(async () => {
    const st = store.get(), hs = host ? host.state() : null;
    if (!st.origin || !st.device || !hs) return;
    const access = JSON.stringify({ on: true, policy: "auto", dev: st.device,
      ok: hs.approved.slice(0, 40).map((a) => [a.id, Math.round(a.at / 1000), Math.round(a.last / 1000), String(a.name).slice(0, 40), a.loc || ""]), now: hs.clients.slice(0, 20).map((c) => c.id) });
    const body = { id: st.device, name: os.hostname(), kind: "server", os: osName(), app: "Vibing Studio Server " + VERSION,
      hw: ARCH + " · " + os.cpus().length + " CPU · " + Math.round(os.totalmem() / 1073741824) + " GB", relay: st.device, access };
    const sig = JSON.stringify(body);
    if (sig === lastReport && Date.now() - (report.at || 0) < 10 * 60e3) return;
    try { const c = await cookie(), r = await post(st.origin + "/api/devices", body, c); if (r.status === 200) { lastReport = sig; report.at = Date.now(); } else if (r.status === 401) relogin().catch(() => {}); } catch (e) { /* 下次再报 */ }
  }, 1500);
}

// ---- 更新：网站上的 server.json 比这一版新就下载、校验、换上，然后退出（服务管理器把新的拉起来）----
function download(url, c, file) {
  return fetch(url, { headers: c ? { cookie: c } : {} }).then(async (r) => {
    if (!r.ok || !r.body) throw new Error("download " + r.status);
    const h = crypto.createHash("sha256"), out = fs.createWriteStream(file);
    for await (const chunk of r.body) { h.update(chunk); if (!out.write(chunk)) await new Promise((res) => out.once("drain", res)); }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    return h.digest("hex");
  });
}
const tarX = (file, dir, strip) => new Promise((res, rej) => { const p = cp.spawn("tar", ["-xzf", file, "-C", dir].concat(strip ? ["--strip-components=" + strip] : []), { stdio: "ignore" }); p.on("exit", (c) => (c === 0 ? res() : rej(new Error("tar " + c)))); p.on("error", rej); });
function swap(link, target) { const t = link + ".new-" + process.pid; fs.symlinkSync(target, t); fs.renameSync(t, link); } // 换「current」这个链接：先建新的、再一下子换过去
async function update(manual) {
  if (updating) return false;
  updating = true;
  try {
    const st = store.get();
    if (!st.origin) throw new Error("not paired");
    const c = await cookie();
    const r = await fetch(st.origin + "/downloads/server/server.json", { headers: { cookie: c }, cache: "no-store" });
    if (r.status === 401) { relogin().catch(() => {}); throw new Error("signed out"); }
    if (!r.ok) throw new Error("server.json " + r.status);
    const m = await r.json();
    let changed = false;
    // Node 运行时
    const nv = m.node && m.node.version, ne = m.node && m.node[ARCH];
    if (nv && ne && nv !== process.version && fs.existsSync(path.join(DATA, "node"))) {
      const dir = path.join(DATA, "node", nv), tmp = path.join(DATA, "node", ".dl-" + process.pid);
      if (!fs.existsSync(path.join(dir, "bin", "node"))) {
        const f = tmp + ".tar.gz";
        const sum = await download(st.origin + "/api/server/node/" + ARCH, c, f);
        if (ne.sha256 && sum !== ne.sha256) throw new Error("node checksum mismatch");
        fs.mkdirSync(tmp, { recursive: true });
        await tarX(f, tmp, 1);
        fs.renameSync(tmp, dir);
      }
      swap(path.join(DATA, "node", "current"), dir);
      changed = true;
      log("node runtime → " + nv);
    }
    // 程序包
    if (m.pkg && m.build > BUILD && fs.existsSync(path.join(DATA, "app"))) {
      const dir = path.join(DATA, "app", String(m.build)), tmp = path.join(DATA, "app", ".dl-" + process.pid);
      if (!fs.existsSync(path.join(dir, "main.js"))) {
        const f = tmp + ".tar.gz";
        const sum = await download(st.origin + "/downloads/server/" + m.pkg.file, c, f);
        if (m.pkg.sha256 && sum !== m.pkg.sha256) throw new Error("package checksum mismatch");
        fs.mkdirSync(tmp, { recursive: true });
        await tarX(f, tmp, 1);
        fs.renameSync(tmp, dir);
      }
      swap(path.join(DATA, "app", "current"), dir);
      changed = true;
      log("updated → " + m.version);
    }
    lastUpdateErr = "";
    if (changed && !manual) { log("restarting for the update"); writeStatus(); process.exit(75); }
    return changed;
  } catch (e) {
    lastUpdateErr = String(e.message || e);
    log("update: " + lastUpdateErr);
    return false;
  } finally { updating = false; }
}

// ---- 服务本身 ----
async function run() {
  log("Vibing Studio Server " + VERSION + " (node " + process.version + ", " + os.hostname() + ")");
  const st = store.get();
  if (!st.keyId) {
    log("not paired yet: run the install command from Devices › Add Server");
    writeStatus();
    // 等配对（pair 写进 state.json）：看着配置目录，配好了接着往下走
    fs.mkdirSync(CFG, { recursive: true, mode: 0o700 });
    await new Promise((res) => { const w = fs.watch(CFG, () => { if (store.get().keyId) { w.close(); res(); } }); });
  }
  const s2 = store.get();
  const local = new Local(() => {}, { binDir: path.join(__dirname, "bin"), version: VERSION });
  host = new Host({ origin: s2.origin, device: s2.device, name: os.hostname(), version: VERSION, local, cookie, relogin, store, log, changed: () => { writeStatus(); report(); } });
  host.connect();
  writeStatus();
  setInterval(writeStatus, 30000);
  setInterval(report, 5 * 60e3);
  setTimeout(() => update(false), 60e3);
  setInterval(() => update(false), 6 * 3600e3);
  // 设置变了（在别处配对了一次、被移除后重新配对）：重新登录、重连
  let lastKey = s2.keyId;
  fs.watch(CFG, () => { const k = store.get().keyId; if (k && k !== lastKey) { lastKey = k; session = { cookie: "", at: 0 }; host.stop(); log("re-paired: restarting"); process.exit(75); } });
  const bye = () => { log("stopping"); host.stop(); writeStatus(); process.exit(0); };
  process.on("SIGTERM", bye); process.on("SIGINT", bye);
}

// 没有 systemd 的机器（容器、一些 VPS）：这个当看门狗，服务退出了（更新完、出错）就再拉起来
function supervise() {
  const launcher = process.env.VS_SERVER_LAUNCHER || path.join(DATA, "bin", "vibing-studio-server");
  let fast = 0;
  const start = () => {
    const t0 = Date.now(), p = cp.spawn(launcher, ["run"], { stdio: "ignore" });
    p.on("exit", (code) => {
      if (code === 0) return process.exit(0); // 自己停的（stop）：看门狗也退
      fast = Date.now() - t0 < 10000 ? Math.min(fast + 1, 6) : 0;
      setTimeout(start, code === 75 ? 200 : 1000 * (1 << fast));
    });
  };
  start();
}

function status(wait) {
  const show = () => {
    const s = readJSON(STATUS, null), st = store.get();
    if (!st.keyId) return { done: false, text: T("还没有配对：在 Vibing Studio 的「设备」里点「添加服务器」，在这台服务器上运行那条命令。", "Not paired yet: in Vibing Studio, open Devices › Add Server and run that command on this server.") };
    if (st.revoked) return { done: true, text: T("这台服务器已从你的账号中移除。要再用，在「设备」里点「添加服务器」重新安装。", "This server was removed from your account. To use it again, run a new command from Devices › Add Server.") };
    if (!s) return { done: false, text: T("服务还没有运行。", "The service isn't running.") };
    const alive = (() => { try { process.kill(s.pid, 0); return true; } catch (e) { return false; } })();
    if (!alive) return { done: false, text: T("服务没有在运行。", "The service isn't running.") };
    if (s.up) return { done: true, text: T("已连接：" + (s.login ? s.login + " 的设备里能看到「" + s.name + "」" : "「" + s.name + "」已在你的设备里"), "Connected: “" + s.name + "” is in " + (s.login ? s.login + "’s" : "your") + " Devices") + " · v" + s.version + (s.clients.length ? T(" · 正在使用：", " · In use by: ") + s.clients.map((c) => c.name).join(", ") : "") };
    return { done: false, text: T("正在连接…", "Connecting…") + (s.error ? " (" + s.error + ")" : "") };
  };
  let r = show();
  if (!wait || r.done) { console.log(r.text); return process.exit(r.done || !wait ? 0 : 1); }
  // --wait N：等到连上（或 N 秒后）再说——安装脚本最后用它
  let last = "";
  const tick = () => { r = show(); if (r.text !== last) { last = r.text; if (!r.done) process.stdout.write(r.text + "\n"); } if (r.done) { console.log(r.text); process.exit(0); } };
  fs.mkdirSync(DATA, { recursive: true });
  fs.watch(DATA, tick);
  setInterval(tick, 1000);
  setTimeout(() => { console.log(show().text); process.exit(1); }, wait * 1000);
  tick();
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "run") return run();
  if (cmd === "supervise") return supervise();
  if (cmd === "version" || cmd === "--version") return console.log(VERSION);
  if (cmd === "status") { const i = args.indexOf("--wait"); return status(i >= 0 ? Math.max(1, +args[i + 1] || 60) : 0); }
  if (cmd === "logs") { const p = cp.spawn("tail", ["-n", "200"].concat(args.includes("-f") ? ["-f"] : []).concat([LOG]), { stdio: "inherit" }); return p.on("exit", (c) => process.exit(c || 0)); }
  if (cmd === "update") { const ok = await update(true); console.log(ok ? T("已更新，重启服务后生效（服务会自动重启）。", "Updated; it takes effect when the service restarts.") : lastUpdateErr ? T("没有更新：", "Not updated: ") + lastUpdateErr : T("已是最新版本。", "Already up to date.")); return process.exit(0); }
  if (cmd === "pair") {
    const token = args.filter((a) => !a.startsWith("--"))[0], oi = args.indexOf("--origin"), origin = String(oi >= 0 ? args[oi + 1] : store.get().origin || "https://code.paimon.beer").replace(/\/+$/, "");
    if (!token) { console.error(T("用法：vibing-studio-server pair <口令>", "Usage: vibing-studio-server pair <token>")); return process.exit(2); }
    try { const j = await pair(origin, token); console.log(T("已配对到 " + (j.login || "你的账号") + "。", "Paired with " + (j.login || "your account") + ".")); return process.exit(0); }
    catch (e) { console.error(T("配对失败：", "Pairing failed: ") + (e.message || e)); return process.exit(1); }
  }
  console.log(T("用法：vibing-studio-server status | logs [-f] | update | version", "Usage: vibing-studio-server status | logs [-f] | update | version"));
  process.exit(cmd ? 2 : 0);
}
main().catch((e) => { log("fatal: " + (e && e.stack || e)); process.exit(1); });
