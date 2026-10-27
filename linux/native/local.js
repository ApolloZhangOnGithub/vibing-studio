// local.js —— Linux 版的「这台电脑本身」（同 app/Sources/Local.swift，命令、参数、事件一模一样，页面不用分平台）：
//   · 真终端：伪终端（node-pty）里跑你的登录 shell，在你的家目录；输出攒 8ms 一批推给页面（pty.data），页面叫停 / 放开（流控）、刷新后接回（pty.attach）
//   · 命令（agent 的 Bash、人的 ! 命令）：bash / zsh -c 跑，自己一个进程组；档位 none / read 有 bubblewrap 就套上（没有就照常跑，同「user」）
//   · 长着跑的程序（Studio 驱动 Claude Code：claude -p --input-format stream-json …）：stdin 留着写
//   · 文件（资源管理器、agent 的 Read / Write / Edit / Glob）：同样按档位查路径
// 事件：pty.data { id, b64 } · pty.exit { id, code } · exec.data { id, o | e } · exec.exit { id, code, cwd } · proc.data { id, o | e } · proc.exit { id, code }
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const { StringDecoder } = require("string_decoder");
const CC = require("./cc");

let ptyLib = null;
try { ptyLib = require("@lydell/node-pty"); } catch (e) { ptyLib = null; } // 没装上：终端用不了，别的照常

class BridgeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
  static args(m) { return new BridgeError("E_ARGS", m); }
  static permission(m) { return new BridgeError("E_PERMISSION", m); }
  static failed(m) { return new BridgeError("E_FAILED", m); }
}

const COMMANDS = ["local.info", "pty.open", "pty.attach", "pty.list", "pty.gc", "pty.write", "pty.resize", "pty.pause", "pty.resume", "pty.close", "pty.cwd",
  "exec.start", "exec.kill", "proc.start", "proc.write", "proc.close", "proc.kill", "fs.read", "fs.write", "fs.stat", "fs.glob", "fs.list", "fs.trash", "cc.sessions", "cc.find", "cc.search"];

const LINUX = process.platform === "linux";
const real = (p) => { const s = path.resolve(p); try { return fs.realpathSync(s); } catch (e) { const d = path.dirname(s); return d === s ? s : path.join(real(d), path.basename(s)); } };
const inside = (p, d) => p === d || p.startsWith(d.endsWith("/") ? d : d + "/");
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const int = (v, d) => (typeof v === "number" && isFinite(v) ? Math.trunc(v) : d);
const which = (exe, PATH) => { for (const d of String(PATH || "").split(":")) { if (!d) continue; const f = path.join(d, exe); try { fs.accessSync(f, fs.constants.X_OK); if (!fs.statSync(f).isDirectory()) return f; } catch (e) { /* 没有 */ } } return null; };

// 发行版的名字（local.info 的 os）：/etc/os-release 的 PRETTY_NAME
function osName() {
  if (!LINUX) return os.type() + " " + os.release();
  try { const m = /^PRETTY_NAME="?([^"\n]*)"?/m.exec(fs.readFileSync("/etc/os-release", "utf8")); if (m) return m[1]; } catch (e) { /* 没有这个文件 */ }
  return "Linux " + os.release();
}
// 常装在登录 shell 的 PATH 之外的几个位置（Claude Code 的原生版在 ~/.local/bin，写在 ~/.bashrc / ~/.zshrc 里）：有就补在后面
function withCommonDirs(p) {
  const h = os.homedir(), have = new Set(String(p).split(":"));
  const extra = [h + "/.local/bin", h + "/.claude/local", h + "/.npm-global/bin", h + "/.bun/bin", h + "/.cargo/bin", h + "/.volta/bin", "/usr/local/bin", "/snap/bin"].filter((d) => !have.has(d) && fs.existsSync(d));
  return extra.length ? p + ":" + extra.join(":") : p;
}
function lang() { const l = process.env.LANG; if (l) return l; const id = (Intl.DateTimeFormat().resolvedOptions().locale || "en-US").replace("-", "_"); return (id.includes("_") ? id : "en_US") + ".UTF-8"; }

// ======== 伪终端最近的输出：页面刷新后接回来先写回去（同 Local.swift 的 Screen）========
//   只留最后 2 MB（从一行开头起）；另外一直记着程序打开了哪些终端模式（括号粘贴、应用光标键、备用屏幕、鼠标……），接回来时补上
const RESTORE = [1, 25, 47, 1047, 1049, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 2004], DEFAULTS = { 25: true }, CAP = 2 << 20;
function track(d, st) { // d：Buffer；st：{ modes, keypad, carry }
  st.carry = Buffer.alloc(0);
  let i = 0;
  while (i < d.length) {
    const e = d.indexOf(0x1b, i);
    if (e < 0) break;
    if (e + 2 >= d.length) { st.carry = d.subarray(e); return; }
    const n = d[e + 1];
    if (n === 0x3d || n === 0x3e) { st.keypad = n === 0x3d; i = e + 2; continue; }
    if (n !== 0x5b || d[e + 2] !== 0x3f) { i = e + 1; continue; }
    let j = e + 3, cur = 0;
    const params = [];
    while (j < d.length && j - e < 64) { const b = d[j]; if (b >= 0x30 && b <= 0x39) cur = Math.min(cur * 10 + (b - 0x30), 99999); else if (b === 0x3b) { params.push(cur); cur = 0; } else break; j++; }
    if (j >= d.length) { st.carry = d.subarray(e); return; }
    params.push(cur);
    if (d[j] === 0x68 || d[j] === 0x6c) params.forEach((p) => { st.modes[p] = d[j] === 0x68; });
    i = j + 1;
  }
}
class Screen {
  constructor() { this.buf = []; this.len = 0; this.trimmed = false; this.st = { modes: {}, keypad: false, carry: Buffer.alloc(0) }; }
  add(d) {
    this.buf.push(d); this.len += d.length;
    if (this.len > CAP + CAP / 4) { const all = Buffer.concat(this.buf); const keep = all.subarray(all.length - CAP); this.buf = [keep]; this.len = keep.length; this.trimmed = true; }
    track(Buffer.concat([this.st.carry, d]), this.st);
  }
  replay() {
    let out = Buffer.concat(this.buf);
    if (this.trimmed) { const nl = out.indexOf(0x0a); if (nl >= 0) out = out.subarray(nl + 1); }
    const m = { modes: {}, keypad: false, carry: Buffer.alloc(0) };
    track(out, m);
    let fix = "";
    for (const k of RESTORE) {
      const want = k in this.st.modes ? this.st.modes[k] : !!DEFAULTS[k], got = k in m.modes ? m.modes[k] : !!DEFAULTS[k];
      if (want !== got) fix += "\x1b[?" + k + (want ? "h" : "l");
    }
    if (this.st.keypad !== m.keypad) fix += this.st.keypad ? "\x1b=" : "\x1b>";
    return Buffer.concat([out, Buffer.from(fix)]);
  }
}

// ======== 进程在哪个目录、前台是什么程序（/proc；macOS 上开发时退回 lsof / ps）========
function cwdOf(pid) {
  if (LINUX) { try { return fs.readlinkSync("/proc/" + pid + "/cwd"); } catch (e) { return null; } }
  try { const out = cp.execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8", timeout: 1500 }); const m = /^n(.*)$/m.exec(out); return m ? m[1] : null; } catch (e) { return null; }
}
function fgOf(pid) { // 终端里前台进程组的组长
  if (LINUX) {
    try { const st = fs.readFileSync("/proc/" + pid + "/stat", "utf8"), rest = st.slice(st.lastIndexOf(")") + 2).split(" "); const tpgid = +rest[5]; return tpgid > 0 ? tpgid : 0; } catch (e) { return 0; }
  }
  try { return +cp.execFileSync("ps", ["-o", "tpgid=", "-p", String(pid)], { encoding: "utf8", timeout: 1500 }).trim() || 0; } catch (e) { return 0; }
}
// 进程叫什么：Claude Code 的原生版可执行文件名是版本号（~/.local/share/claude/versions/2.1.x），按路径认成 claude
function procLabel(pid) {
  let exe = "";
  if (LINUX) { try { exe = fs.readlinkSync("/proc/" + pid + "/exe"); } catch (e) { exe = ""; } }
  else { try { exe = cp.execFileSync("ps", ["-o", "comm=", "-p", String(pid)], { encoding: "utf8", timeout: 1500 }).trim(); } catch (e) { exe = ""; } }
  if (exe.includes("/claude/versions/") || /\/claude$/.test(exe)) return "claude";
  if (LINUX) { try { return fs.readFileSync("/proc/" + pid + "/comm", "utf8").trim(); } catch (e) { /* 没了 */ } }
  return path.basename(exe);
}

// ======== glob：* ? [..] 在一段里，** 跨目录；.git、node_modules 不进（除非模式里写了）；最近改过的在前（同 Claude Code 的 Glob）========
function glob(pattern, cwd, limit) {
  const abs = pattern.startsWith("/") ? pattern : path.join(cwd, pattern);
  const parts = abs.split("/").filter(Boolean);
  let base = "/";
  while (parts.length && !/[*?[]/.test(parts[0])) base = path.join(base, parts.shift());
  if (!parts.length) return fs.existsSync(base) ? [base] : [];
  base = real(base);
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  let re = "^" + escRe(base === "/" ? "" : base);
  parts.forEach((seg, i) => {
    if (seg === "**") { re += i === parts.length - 1 ? "(?:/.*)?" : "(?:/[^/]+)*"; return; }
    re += "/";
    let cls = false;
    for (const ch of seg) {
      if (cls) { re += ch; if (ch === "]") cls = false; continue; }
      if (ch === "*") re += "[^/]*"; else if (ch === "?") re += "[^/]"; else if (ch === "[") { re += "["; cls = true; } else re += escRe(ch);
    }
  });
  const rx = new RegExp(re + "$"), skipGit = !pattern.includes(".git"), skipNM = !pattern.includes("node_modules");
  const out = [];
  let seen = 0;
  const stack = [base];
  while (stack.length && seen < 200000 && out.length < limit * 4) {
    const dir = stack.pop();
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      seen++;
      if ((skipGit && e.name === ".git") || (skipNM && e.name === "node_modules")) continue;
      const p = dir === "/" ? "/" + e.name : dir + "/" + e.name;
      if (rx.test(p)) { let t = 0; try { t = fs.statSync(p).mtimeMs; } catch (x) { /* 没了 */ } out.push([p, t]); }
      if (e.isDirectory()) stack.push(p);
    }
  }
  return out.sort((a, b) => b[1] - a[1]).slice(0, limit).map((x) => x[0]);
}

class Local {
  // sink(type, detail)：事件送到哪（这个窗口的页面）
  constructor(sink, opts) {
    this.sink = sink;
    const ui = os.userInfo();
    this.home = os.homedir();
    this.user = ui.username;
    this.shell = process.env.SHELL || ui.shell || "/bin/bash";
    if (!fs.existsSync(this.shell)) this.shell = fs.existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
    this.binDir = (opts && opts.binDir) || path.join(__dirname, "..", "bin");
    this.tmp = real(os.tmpdir());
    this.version = (opts && opts.version) || "0";
    this.loginPath = withCommonDirs(process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin");
    this.ptys = new Map(); this.screens = new Map(); this.pending = new Map();
    this.jobs = new Map(); this.procs = new Map(); this.execPend = new Map();
    this.cc = new CC.Index();
    // 你的登录 shell 里的 PATH（nvm、~/.local/bin……）：agent 的命令、长着跑的程序用它
    const p = cp.spawn(this.shell, ["-l", "-c", "printf '\\036%s' \"$PATH\""], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const killer = setTimeout(() => { try { p.kill("SIGKILL"); } catch (e) { /* 已经退了 */ } }, 6000);
    p.stdout.on("data", (d) => { out += d; });
    p.on("close", () => { clearTimeout(killer); const i = out.lastIndexOf("\x1e"); const v = i >= 0 ? out.slice(i + 1).trim() : ""; if (v.includes("/")) this.loginPath = withCommonDirs(v); });
    p.on("error", () => clearTimeout(killer));
  }
  out(type, detail) { try { this.sink(type, detail); } catch (e) { /* 窗口没了 */ } }

  async run(cmd, a) {
    a = a || {};
    switch (cmd) {
      case "local.info":
        return { home: this.home, user: this.user, shell: this.shell, tmp: this.tmp, host: os.hostname(), os: osName(), platform: process.platform, caps: ["pty.argv"], path: this.loginPath };
      case "pty.open": return this.ptyOpen(a);
      case "pty.attach": {
        const id = this.idArg(a), p = this.ptys.get(id);
        if (!p) throw BridgeError.failed("no such terminal");
        this.flush(id);
        if (p.paused) { try { p.term.resume(); } catch (e) { /* 已经在读 */ } p.paused = false; }
        if (a.cols != null) try { p.term.resize(Math.max(2, int(a.cols, 80)), Math.max(1, int(a.rows, 24))); } catch (e) { /* 退了 */ }
        const scr = this.screens.get(id);
        return { id: id, pid: p.term.pid, b64: (scr ? scr.replay() : Buffer.alloc(0)).toString("base64") };
      }
      case "pty.list": return Array.from(this.ptys.entries()).map(([id, p]) => ({ id: id, pid: p.term.pid }));
      case "pty.gc": {
        const keep = new Set(Array.isArray(a.keep) ? a.keep : []), closed = [];
        for (const [id, p] of this.ptys) if (!keep.has(id)) { this.ptyKill(p); this.ptys.delete(id); this.screens.delete(id); closed.push(id); }
        return { closed: closed };
      }
      case "pty.write": { const p = this.ptys.get(this.idArg(a)); if (!p) throw BridgeError.failed("no such terminal"); if (typeof a.data === "string") p.term.write(a.data); return null; }
      case "pty.resize": { const p = this.ptys.get(this.idArg(a)); if (!p) throw BridgeError.failed("no such terminal"); try { p.term.resize(Math.max(2, int(a.cols, 80)), Math.max(1, int(a.rows, 24))); } catch (e) { /* 退了 */ } return null; }
      case "pty.pause": { const p = this.ptys.get(this.idArg(a)); if (!p) throw BridgeError.failed("no such terminal"); if (!p.paused) { try { p.term.pause(); } catch (e) { /* 退了 */ } p.paused = true; } return null; }
      case "pty.resume": { const p = this.ptys.get(this.idArg(a)); if (!p) throw BridgeError.failed("no such terminal"); if (p.paused) { try { p.term.resume(); } catch (e) { /* 退了 */ } p.paused = false; } return null; }
      case "pty.close": { const id = this.idArg(a), p = this.ptys.get(id); if (p) this.ptyKill(p); this.ptys.delete(id); return null; }
      case "pty.cwd": {
        const p = this.ptys.get(this.idArg(a));
        if (!p) return null;
        const out = { cwd: cwdOf(p.term.pid) }, fg = fgOf(p.term.pid);
        if (fg > 0 && fg !== p.term.pid) out.fg = { pid: fg, name: procLabel(fg), cwd: cwdOf(fg) };
        return out;
      }
      case "exec.start": return this.execStart(a);
      case "exec.kill": { const j = this.jobs.get(this.idArg(a)); if (j) j.kill(); return null; }
      case "proc.start": return this.procStart(a);
      case "proc.write": { const pr = this.procs.get(this.idArg(a)); if (!pr) throw BridgeError.failed("no such process"); if (typeof a.data === "string" && pr.child.stdin.writable) pr.child.stdin.write(a.data); return null; }
      case "proc.close": { const pr = this.procs.get(this.idArg(a)); if (pr) try { pr.child.stdin.end(); } catch (e) { /* 已经关了 */ } return null; }
      case "proc.kill": { const pr = this.procs.get(this.idArg(a)); if (pr) pr.kill(); return null; }
      case "fs.list": {
        const p = this.pathArg(a);
        let names;
        try { names = fs.readdirSync(p); } catch (e) { throw BridgeError.failed("Can't list " + p); }
        const out = [];
        for (const n of names.slice(0, 5000)) {
          const full = path.join(p, n);
          let st, link = false;
          try { st = fs.statSync(full); } catch (e) { continue; } // 断了的链接
          try { link = fs.lstatSync(full).isSymbolicLink(); } catch (e) { link = false; }
          out.push({ name: n, dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs, hidden: n.startsWith("."), package: false, link });
        }
        const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
        out.sort((x, y) => (x.dir !== y.dir ? (x.dir ? -1 : 1) : coll.compare(x.name, y.name)));
        return out;
      }
      case "fs.read": {
        const p = this.pathArg(a), acc = this.accessArgs(a);
        if (!this.allowed(p, false, acc.access, acc.workdir, this.extraArg(a))) throw BridgeError.permission("Permission denied: " + p + " (access: " + acc.access + ")");
        const max = int(a.max, 20000000), off = int(a.offset, 0);
        let fd;
        try { fd = fs.openSync(p, "r"); } catch (e) { throw BridgeError.failed(fs.existsSync(p) ? "Can't read " + p : "No such file: " + p); }
        try {
          const size = fs.fstatSync(fd).size, n = Math.max(0, Math.min(max, size - off)), buf = Buffer.alloc(n);
          let got = 0;
          while (got < n) { const r = fs.readSync(fd, buf, got, n - got, off + got); if (r <= 0) break; got += r; }
          return { b64: buf.subarray(0, got).toString("base64"), size: got };
        } finally { fs.closeSync(fd); }
      }
      case "fs.write": {
        const p = this.pathArg(a), acc = this.accessArgs(a);
        if (!this.allowed(p, true, acc.access, acc.workdir, this.extraArg(a))) throw BridgeError.permission("Permission denied: " + p + " (access: " + acc.access + ")");
        const d = typeof a.b64 === "string" ? Buffer.from(a.b64, "base64") : Buffer.from(String(a.text || ""), "utf8");
        fs.mkdirSync(path.dirname(p), { recursive: true });
        const tmp = path.join(path.dirname(p), "." + path.basename(p) + ".vs-" + process.pid + "-" + Date.now()); // 先写到旁边再换过去（写一半断电不会剩半个文件）
        fs.writeFileSync(tmp, d);
        fs.renameSync(tmp, p);
        return { bytes: d.length };
      }
      case "fs.stat": {
        const p = this.pathArg(a);
        let st;
        try { st = fs.statSync(p); } catch (e) { return null; }
        return { type: st.isDirectory() ? "dir" : "file", size: st.size, mtime: st.mtimeMs, mode: st.mode & 0o7777 };
      }
      case "fs.glob": {
        if (typeof a.pattern !== "string" || !a.pattern) throw BridgeError.args("fs.glob { pattern, cwd }");
        const acc = this.accessArgs(a), cwd = this.dirOr(a.cwd, acc.workdir), ex = this.extraArg(a);
        return glob(a.pattern, cwd, int(a.limit, 500)).filter((p) => this.allowed(p, false, acc.access, acc.workdir, ex));
      }
      case "fs.trash": { // 移到废纸篓（同访达的「移到废纸篓」）：Linux 是 freedesktop 的回收站（~/.local/share/Trash）
        const p = this.pathArg(a);
        const { shell } = require("electron");
        await shell.trashItem(p);
        return { ok: true };
      }
      case "cc.sessions": return this.cc.sessions(int(a.limit, 40));
      case "cc.find": return this.cc.find(String(a.id || ""));
      case "cc.search": return this.cc.search(String(a.q || ""), int(a.limit, 60), int(a.per, 30), !!a.cs, !!a.word, !!a.re);
      default: throw new BridgeError("E_UNKNOWN_CMD", "unknown command \"" + cmd + "\"");
    }
  }

  // ---- 真终端 ----
  ptyOpen(a) {
    if (!ptyLib) throw BridgeError.failed("terminal support (node-pty) is not available");
    const id = this.idArg(a), cwd = this.dirOr(a.cwd, this.home);
    const env = Object.assign({}, process.env);
    for (const k of Object.keys(env)) if (/^(ELECTRON_|CHROME_|GOOGLE_API_KEY|ORIGINAL_XDG_)/.test(k)) delete env[k];
    Object.assign(env, { TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "PaimonTerminal", TERM_PROGRAM_VERSION: this.version, TCB: "1",
      PATH: this.binDir + ":" + (env.PATH || "/usr/local/bin:/usr/bin:/bin"), HOME: this.home, USER: this.user, SHELL: this.shell });
    if (!env.LANG) env.LANG = lang();
    // 登录 shell（同 Terminal、iTerm、GNOME 终端的「以登录 shell 运行」）；argv：直接跑这个程序（tmux 的终端）
    let file = this.shell, args = ["-l"];
    if (Array.isArray(a.argv) && a.argv.length && a.argv[0]) {
      file = String(a.argv[0]);
      if (!file.includes("/")) file = which(file, this.loginPath + ":" + (env.PATH || "")) || "";
      if (!file) throw BridgeError.failed("找不到程序：" + a.argv[0]);
      args = a.argv.slice(1).map(String);
    }
    const term = ptyLib.spawn(file, args, { name: "xterm-256color", cols: Math.max(2, int(a.cols, 80)), rows: Math.max(1, int(a.rows, 24)), cwd: cwd, env: env });
    const P = { term: term, paused: false };
    this.ptys.set(id, P);
    this.screens.set(id, new Screen());
    term.onData((d) => this.queue(id, Buffer.from(d, "utf8")));
    term.onExit(({ exitCode, signal }) => {
      this.flush(id);
      if (this.ptys.get(id) === P) { this.ptys.delete(id); this.screens.delete(id); }
      this.out("pty.exit", { id: id, code: signal ? 128 + signal : exitCode });
    });
    return { id: id, pid: term.pid };
  }
  ptyKill(p) { try { process.kill(-p.term.pid, "SIGHUP"); } catch (e) { /* 组没了 */ } try { p.term.kill("SIGHUP"); } catch (e) { /* 已经退了 */ } }
  queue(id, d) { // 攒 8ms 一起推
    const q = this.pending.get(id);
    if (q) { q.push(d); return; }
    this.pending.set(id, [d]);
    setTimeout(() => this.flush(id), 8);
  }
  flush(id) {
    const q = this.pending.get(id);
    if (!q) return;
    this.pending.delete(id);
    const d = q.length === 1 ? q[0] : Buffer.concat(q);
    if (!d.length) return;
    const scr = this.screens.get(id);
    if (scr) scr.add(d);
    this.out("pty.data", { id: id, b64: d.toString("base64") });
  }
  // 前台在跑的程序（关窗口前问一声）：shell 自己不算
  running() { const out = []; for (const p of this.ptys.values()) { const fg = fgOf(p.term.pid); if (fg > 0 && fg !== p.term.pid) out.push(procLabel(fg)); } return out; }

  // ---- 命令 ----
  execEnv() {
    // Linux：App 带的几个命令（open 替 macOS 的 open，界面「在文件管理器中显示」靠它）排在最前面——Debian 系的 /bin/open 是 openvt
    const env = { HOME: this.home, USER: this.user, LOGNAME: this.user, SHELL: this.shell, PATH: (LINUX ? this.binDir + ":" : "") + this.loginPath, TMPDIR: this.tmp + "/", LANG: process.env.LANG || lang(), TERM: "dumb", NO_COLOR: "1", PAGER: "cat", GIT_PAGER: "cat" };
    for (const k of ["SSH_AUTH_SOCK", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) if (process.env[k]) env[k] = process.env[k];
    return env;
  }
  execStart(a) {
    const id = this.idArg(a);
    if (typeof a.cmd !== "string") throw BridgeError.args("exec.start { id, cmd, cwd?, access?, workdir? }");
    const access = a.access || "user", workdir = this.dirOr(a.workdir, this.home), cwd = this.dirOr(a.cwd, workdir);
    // 退出时从第 3 号描述符报最后在哪个目录（命令里 cd 过，下一条接着在那里）
    const zsh = which("zsh", this.loginPath);
    let argv = zsh ? [zsh, "-f", "-c", "trap 'builtin print -rn -- \"$PWD\" >&3 2>/dev/null' EXIT\n" + a.cmd]
      : ["/bin/bash", "--noprofile", "--norc", "-c", "trap 'builtin printf %s \"$PWD\" >&3 2>/dev/null' EXIT\n" + a.cmd];
    if (access === "none" || access === "read") { const bw = which("bwrap", this.loginPath); if (bw) argv = [bw].concat(this.bwrapArgs(access, workdir, this.extraArg(a)), argv); }
    const child = cp.spawn(argv[0], argv.slice(1), { cwd: cwd, env: this.execEnv(), stdio: ["ignore", "pipe", "pipe", "pipe"], detached: true });
    let code = null, open = 3, dir = "";
    const done = () => { if (open > 0 || code === null) return; this.flushExec(id); this.jobs.delete(id); this.out("exec.exit", { id: id, code: code, cwd: dir.startsWith("/") ? dir : null }); };
    const dec = { o: new StringDecoder("utf8"), e: new StringDecoder("utf8") };
    child.stdout.on("data", (d) => this.queueExec(id, dec.o.write(d), false));
    child.stderr.on("data", (d) => this.queueExec(id, dec.e.write(d), true));
    child.stdio[3].on("data", (d) => { dir += d.toString("utf8"); });
    [child.stdout, child.stderr, child.stdio[3]].forEach((s, i) => s.on("close", () => { if (i < 2) { const r = (i ? dec.e : dec.o).end(); if (r) this.queueExec(id, r, i === 1); } open--; done(); }));
    child.on("error", (e) => { this.queueExec(id, String(e.message) + "\n", true); if (code === null) { code = 127; } open = 0; done(); });
    child.on("exit", (c, sig) => { code = sig ? 128 + (require("os").constants.signals[sig] || 0) : c; done(); });
    this.jobs.set(id, { kill: () => { try { process.kill(-child.pid, "SIGTERM"); } catch (e) { /* 没了 */ } setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch (e) { /* 没了 */ } }, 2000); } });
    return { id: id };
  }
  // bubblewrap（Linux 上的沙盒，同 macOS 的 Seatbelt 那套档位）：read——哪都能读、只能写工作目录和临时目录；none——家目录只能读写工作目录
  bwrapArgs(access, workdir, extra) {
    const w = real(workdir), writable = [w, this.tmp, "/tmp", this.home + "/.cache", this.home + "/.npm"].concat(extra).filter((p) => fs.existsSync(p));
    const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--die-with-parent", "--new-session"];
    if (access === "none") args.push("--tmpfs", this.home); // 家目录先整个换成空的，再把工作目录这些放回来
    for (const p of writable) args.push("--bind", p, p);
    return args;
  }
  queueExec(id, s, isErr) {
    if (!s) return;
    let p = this.execPend.get(id);
    if (!p) { p = { o: "", e: "" }; this.execPend.set(id, p); setTimeout(() => this.flushExec(id), 16); }
    if (isErr) p.e += s; else p.o += s;
  }
  flushExec(id) {
    const p = this.execPend.get(id);
    if (!p) return;
    this.execPend.delete(id);
    if (p.o) this.out("exec.data", { id: id, o: p.o });
    if (p.e) this.out("exec.data", { id: id, e: p.e });
  }

  // ---- 长着跑的程序 ----
  procStart(a) {
    const id = this.idArg(a);
    if (!Array.isArray(a.argv) || !a.argv.length || !a.argv[0]) throw BridgeError.args("proc.start { id, argv: [程序, 参数…], cwd?, env? }");
    const env = this.execEnv();
    env.TERM = "xterm-256color"; delete env.NO_COLOR; delete env.PAGER; delete env.GIT_PAGER;
    Object.assign(env, a.env && typeof a.env === "object" ? a.env : {});
    let exe = String(a.argv[0]);
    if (!exe.includes("/")) exe = which(exe, env.PATH) || exe;
    const child = cp.spawn(exe, a.argv.slice(1).map(String), { cwd: this.dirOr(a.cwd, this.home), env: env, stdio: ["pipe", "pipe", "pipe"], detached: true });
    let code = null, open = 2;
    const done = () => { if (open > 0 || code === null) return; this.procs.delete(id); this.out("proc.exit", { id: id, code: code }); };
    const dec = { o: new StringDecoder("utf8"), e: new StringDecoder("utf8") };
    child.stdout.on("data", (d) => { const s = dec.o.write(d); if (s) this.out("proc.data", { id: id, o: s }); });
    child.stderr.on("data", (d) => { const s = dec.e.write(d); if (s) this.out("proc.data", { id: id, e: s }); });
    [child.stdout, child.stderr].forEach((s, i) => s.on("close", () => { const r = (i ? dec.e : dec.o).end(); if (r) this.out("proc.data", i ? { id: id, e: r } : { id: id, o: r }); open--; done(); }));
    child.stdin.on("error", () => { /* 程序先退了：写不进去就算了 */ });
    child.on("error", (e) => { this.out("proc.data", { id: id, e: "spawn " + a.argv[0] + ": " + e.message + "\n" }); if (code === null) code = 127; open = 0; done(); });
    child.on("exit", (c, sig) => { code = sig ? 128 + (os.constants.signals[sig] || 0) : c; done(); });
    this.procs.set(id, { child: child, kill: () => { try { process.kill(-child.pid, "SIGTERM"); } catch (e) { /* 没了 */ } setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch (e) { /* 没了 */ } }, 3000); } });
    return { id: id, pid: child.pid || 0 };
  }

  // ---- 档位 ----
  extraArg(a) { return (Array.isArray(a.extra) ? a.extra : []).map((p) => path.resolve(String(p))).filter((p) => inside(p, this.home + "/.paimon") && !p.includes("/../")); }
  accessArgs(a) { return { access: a.access || "user", workdir: this.dirOr(a.workdir, this.home) }; }
  allowed(p, write, access, workdir, extra) {
    if (access === "user" || access === "rw") return true;
    const r = real(p), w = real(workdir), scratch = [w, this.tmp, "/tmp", this.home + "/.cache", this.home + "/.npm"].concat(extra || []);
    if (write) return scratch.some((d) => inside(r, d)) || r === "/dev/null";
    if (access === "read") return true;
    return scratch.some((d) => inside(r, d)) || !(inside(r, "/home") || inside(r, "/media") || inside(r, "/mnt") || inside(r, "/Users") || inside(r, "/Volumes")); // none：你的文件只有工作目录能读
  }

  // ---- 小工具 ----
  idArg(a) { const s = a.id; if (typeof s !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(s)) throw BridgeError.args("missing id"); return s; }
  pathArg(a) { const s = a.path; if (typeof s !== "string" || !s.startsWith("/")) throw BridgeError.args("path must be absolute"); return path.normalize(s); }
  dirOr(s, d) { return typeof s === "string" && s.startsWith("/") && isDir(s) ? s : d; }

  dispose() {
    for (const p of this.ptys.values()) this.ptyKill(p);
    this.ptys.clear();
    for (const j of this.jobs.values()) j.kill();
    for (const pr of this.procs.values()) pr.kill();
  }
}

module.exports = { Local: Local, BridgeError: BridgeError, COMMANDS: COMMANDS };
