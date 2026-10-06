// cc.js —— 侧栏、Agent Finder 里的 Claude Code 会话（同 app/Sources/ClaudeCode.swift，返回的字段一模一样）：
//   · 会话：~/.claude/projects/<项目>/<会话 id>.jsonl —— 标题（/rename 起的 > Claude Code 起的 > 第一句话）、最后一句、在哪个目录开的
//   · 在跑的：~/.claude/sessions/<pid>.json —— Claude Code 自己登记的（交互 / 后台、忙 / 闲、名字）；进程还在才算
//   · 后台会话（claude --bg）：~/.claude/jobs/<短 id>
// 会话文件只往后追加、可能很大（几百 MB）：只读两头（开头 256 KB、结尾 1 MB），之后只读新追加的
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const HEAD = 256 << 10, TAIL = 1 << 20;
const MARKERS = [['"type":"custom-title"', "custom"], ['"type":"ai-title"', "ai"], ['"type":"user"', "user"], ['"role":"assistant"', "assistant"]].map((x) => [Buffer.from(x[0]), x[1]]);

// 目录 ↔ 项目名：Claude Code 把目录里字母数字以外的字（按 UTF-16）都换成 -
function norm(s) { let o = ""; for (let i = 0; i < s.length; i++) { const u = s.charCodeAt(i); o += (u >= 0x30 && u <= 0x39) || (u >= 0x41 && u <= 0x5a) || (u >= 0x61 && u <= 0x7a) ? s[i] : "-"; } return o; }
function sameProject(dir, project) { const a = norm(dir), b = norm(project); return b.length > 180 ? a.startsWith(b.slice(0, 180)) : a === b; }
// 人说的话（不是 Claude Code 自己塞进来的：命令的包装、本地命令的输出、打断的提示……）
function spoken(t) { const x = String(t).trim(); return !!x && !x.startsWith("<") && !x.startsWith("Caveat:") && !x.startsWith("[Request interrupted"); }
function textOf(j) {
  const m = j && j.message;
  if (!m) return null;
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) { const t = m.content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join(" "); return t || null; }
  return null;
}
function oneLine(s, n) { const t = String(s).replace(/\s+/g, " ").trim(); return Array.from(t).length > n ? Array.from(t).slice(0, n).join("") + "…" : t; }
// 这一段里的 "key":"值"（last：最后一个），解开 JSON 转义
function field(buf, key, from, to, last) {
  const k = Buffer.from('"' + key + '":"');
  let at = last ? buf.lastIndexOf(k, to - k.length) : buf.indexOf(k, from);
  if (at < from || at < 0 || at >= to) return null;
  let i = at + k.length, esc = false;
  while (i < to) { const b = buf[i]; if (esc) esc = false; else if (b === 0x5c) esc = true; else if (b === 0x22) break; i++; }
  if (i >= to) return null;
  try { return JSON.parse(buf.toString("utf8", at + k.length - 1, i + 1)); } catch (e) { return null; }
}
function parse(buf, a, b) { try { return JSON.parse(buf.toString("utf8", a, b)); } catch (e) { return null; } }
// 进程还在，而且在登记之前就起来了（登记之后才起来的是重用了这个 pid 的别的进程）
let BOOT = 0, HZ = 100;
function alive(pid, before) {
  try { process.kill(pid, 0); } catch (e) { if (e.code !== "EPERM") return false; }
  if (process.platform !== "linux" || before <= 0) return true;
  try {
    if (!BOOT) { const m = /^btime (\d+)/m.exec(fs.readFileSync("/proc/stat", "utf8")); BOOT = m ? +m[1] : 0; }
    const st = fs.readFileSync("/proc/" + pid + "/stat", "utf8"), rest = st.slice(st.lastIndexOf(")") + 2).split(" ");
    const start = BOOT + (+rest[19]) / HZ; // 第 22 个字段：开机后多少个时钟周期起来的
    return !BOOT || start <= before + 5;
  } catch (e) { return true; }
}

class Index {
  constructor(base) { this.base = base || path.join(os.homedir(), ".claude"); this.cache = new Map(); this.dirs = new Map(); }
  files() {
    const root = path.join(this.base, "projects"), out = [];
    let dirs = [];
    try { dirs = fs.readdirSync(root); } catch (e) { return out; }
    for (const dir of dirs) {
      const d = path.join(root, dir);
      let names = [];
      try { names = fs.readdirSync(d); } catch (e) { continue; }
      for (const f of names) {
        if (!f.endsWith(".jsonl") || f.startsWith("agent-")) continue;
        const p = path.join(d, f);
        try { const st = fs.statSync(p); out.push({ p: p, project: dir, file: f, mtime: st.mtimeMs, size: st.size }); } catch (e) { /* 没了 */ }
      }
    }
    return out;
  }
  sessionOf(p, project, size) {
    let s = this.cache.get(p) || { id: path.basename(p, ".jsonl"), path: p, project: project, cwd: "", cwdOK: false, custom: "", ai: "", prompt: "", last: "", model: "", turnAt: 0, ctx: 0, mtime: 0, size: 0, offset: 0 };
    if (s.size !== size || s.offset === 0) s = this.scan(s, size);
    s.size = size;
    this.cache.set(p, s);
    return s;
  }
  // 最近动过的会话（新的在前），最多 limit 个：没说过话的、只敲了个 / 命令的不要；同一个项目里标题一样的只留最新的
  sessions(limit) {
    const files = this.files().sort((a, b) => b.mtime - a.mtime), live = this.liveSessions();
    let jobs = new Set();
    try { jobs = new Set(fs.readdirSync(path.join(this.base, "jobs"))); } catch (e) { /* 没有 */ }
    const out = [], seen = new Set();
    for (const f of files) {
      if (out.length >= limit) break;
      const s = this.sessionOf(f.p, f.project, f.size);
      s.mtime = f.mtime;
      const lv = live[s.id];
      const title = s.custom ? s.custom : lv && lv.named ? lv.name : s.ai ? s.ai : s.prompt;
      if (!title) continue;
      if (!s.custom && !(lv && lv.named) && title.startsWith("/")) continue;
      const key = s.project + "\u0000" + title;
      if (seen.has(key)) continue;
      seen.add(key);
      let dir = s.cwdOK ? s.cwd : "";
      if (!dir && lv && lv.cwd && sameProject(lv.cwd, s.project)) dir = lv.cwd;
      if (!dir) dir = this.resolve(s.project) || "";
      if (!dir) dir = s.cwd || (lv && lv.cwd) || "";
      let there = false;
      try { there = !!dir && fs.statSync(dir).isDirectory(); } catch (e) { there = false; }
      const short = s.id.slice(0, 8), job = lv ? (lv.kind === "bg" ? lv.job || short : "") : jobs.has(short) ? short : "";
      const o = { id: s.id, path: s.path, cwd: dir, missing: !there, title: title, custom: !!s.custom, last: s.last, mtime: f.mtime, size: f.size, job: job, turnAt: s.turnAt, ctx: s.ctx, model: s.model };
      if (lv) o.live = { pid: lv.pid, kind: lv.kind, status: lv.status, name: lv.name, since: lv.started, statusAt: lv.statusAt };
      out.push(o);
    }
    return out;
  }
  // 一个会话（按 id 找，不管多久以前的）
  find(id) {
    if (!/^[0-9a-fA-F-]{8,40}$/.test(id)) return null;
    for (const f of this.files()) {
      if (!f.file.startsWith(id)) continue;
      const s = this.sessionOf(f.p, f.project, f.size);
      s.mtime = f.mtime;
      const lv = this.liveSessions()[s.id];
      let cwd = s.cwdOK ? s.cwd : "";
      if (!cwd) cwd = this.resolve(s.project) || "";
      if (!cwd) cwd = s.cwd;
      const title = s.custom ? s.custom : lv && lv.named ? lv.name : s.ai ? s.ai : s.prompt;
      const o = { id: s.id, path: f.p, cwd: cwd, title: title || s.id.slice(0, 8), last: s.last, mtime: f.mtime, size: f.size, turnAt: s.turnAt, ctx: s.ctx, model: s.model, job: this.jobOf(s.id, lv) };
      if (lv) o.live = { pid: lv.pid, kind: lv.kind, status: lv.status, name: lv.name, since: lv.started, statusAt: lv.statusAt };
      return o;
    }
    return null;
  }
  jobOf(id, lv) { const short = id.slice(0, 8); if (lv && lv.kind === "bg") return lv.job || short; return fs.existsSync(path.join(this.base, "jobs", short)) ? short : ""; }
  // 在跑的：Claude Code 登记的（~/.claude/sessions/<pid>.json）。备用进程（spare）不算；进程没了、pid 被别的进程重用了的旧登记不算
  liveSessions() {
    const out = {}, dir = path.join(this.base, "sessions");
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return out; }
    for (const f of names) {
      if (!f.endsWith(".json")) continue;
      let j;
      try { j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { continue; }
      const pid = +j.pid, sid = j.sessionId;
      if (!(pid > 0) || typeof sid !== "string" || j.spare === true) continue;
      const started = +j.startedAt || 0;
      if (!alive(pid, started / 1000)) continue;
      const l = { pid: pid, kind: j.kind || "", status: j.status || "", name: j.name || "", named: j.nameSource === "user", job: j.jobId || "", cwd: j.cwd || "", started: started, statusAt: +j.statusUpdatedAt || 0 };
      const old = out[sid];
      if (old && ((old.kind === "bg" && l.kind !== "bg") || ((old.kind === l.kind || l.kind !== "bg") && old.started > started))) continue;
      out[sid] = l;
    }
    return out;
  }
  // 会话里记的目录都对不上（老的会话、目录挪过）：照项目名在磁盘上一级一级找
  resolve(project) {
    if (this.dirs.has(project)) return this.dirs.get(project) || null;
    const target = norm(project);
    let found = null;
    const walk = (dir, rest, depth) => {
      if (!rest) { found = dir; return true; }
      if (depth >= 32) return false;
      let items;
      try { items = fs.readdirSync(dir); } catch (e) { return false; }
      items.sort((a, b) => b.length - a.length); // 长的先试
      for (const it of items) {
        const enc = "-" + norm(it);
        if (!rest.startsWith(enc)) continue;
        const next = rest.slice(enc.length);
        if (next && !next.startsWith("-")) continue;
        const p = (dir === "/" ? "" : dir) + "/" + it;
        try { if (!fs.statSync(p).isDirectory()) continue; } catch (e) { continue; }
        if (walk(p, next, depth + 1)) return true;
      }
      return false;
    };
    if (target.length <= 180) walk("/", target, 0);
    this.dirs.set(project, found || "");
    return found;
  }
  // 读会话文件：开头 256 KB + 结尾 1 MB；之后文件长了只读新追加的（最多最后 1 MB）
  scan(s, size) {
    let fd;
    try { fd = fs.openSync(s.path, "r"); } catch (e) { return s; }
    try {
      if (s.offset === 0 || size < s.offset) {
        s = { id: s.id, path: s.path, project: s.project, cwd: "", cwdOK: false, custom: "", ai: "", prompt: "", last: "", model: "", turnAt: 0, ctx: 0, mtime: 0, size: 0, offset: 0 };
        this.lines(fd, 0, Math.min(size, HEAD), false, s);
        if (size > HEAD) this.lines(fd, Math.max(HEAD, size - TAIL), size, true, s);
      } else if (size > s.offset) {
        const from = Math.max(s.offset, size - TAIL);
        this.lines(fd, from, size, from !== s.offset, s);
      }
      s.offset = size;
    } finally { fs.closeSync(fd); }
    return s;
  }
  lines(fd, from, to, skipFirst, s) {
    if (to <= from) return;
    const buf = Buffer.alloc(to - from);
    let got = 0;
    while (got < buf.length) { const n = fs.readSync(fd, buf, got, buf.length - got, from + got); if (n <= 0) break; got += n; }
    const chunk = buf.subarray(0, got);
    let start = 0;
    if (skipFirst) { const nl = chunk.indexOf(0x0a); if (nl < 0) return; start = nl + 1; }
    const users = [], assistants = [], lastUsers = [];
    while (start < chunk.length) {
      const nl = chunk.indexOf(0x0a, start);
      if (nl < 0) break; // 最后半行（还在写）不要
      const a = start, b = nl;
      start = nl + 1;
      if (b - a <= 20) continue;
      const headEnd = Math.min(b, a + 400);
      let kind = null;
      for (const [m, k] of MARKERS) { const at = chunk.indexOf(m, a); if (at >= 0 && at + m.length <= headEnd) { kind = k; break; } }
      if (!kind) continue;
      if (kind === "custom") { const t = field(chunk, "customTitle", a, b); if (t) s.custom = t; }
      else if (kind === "ai") { const t = field(chunk, "aiTitle", a, b); if (t) s.ai = t; }
      else {
        if (!s.cwdOK) { const c = field(chunk, "cwd", a, b, true); if (c) { if (sameProject(c, s.project)) { s.cwd = c; s.cwdOK = true; } else if (!s.cwd) s.cwd = c; } }
        if (kind === "user") { if (!s.prompt && users.length < 12) users.push([a, b]); lastUsers.push([a, b]); if (lastUsers.length > 60) lastUsers.splice(0, 20); }
        else assistants.push([a, b]);
      }
    }
    for (const [a, b] of users) {
      if (s.prompt) break;
      if (b - a >= 400000) continue;
      const j = parse(chunk, a, b), t = j && j.isMeta !== true ? textOf(j) : null;
      if (t && spoken(t)) s.prompt = oneLine(t, 120);
    }
    for (let i = lastUsers.length - 1; i >= 0; i--) {
      const [a, b] = lastUsers[i];
      if (b - a >= 400000) continue;
      const j = parse(chunk, a, b);
      if (!j || j.isMeta === true) continue;
      const t = textOf(j), at = j.timestamp ? Date.parse(j.timestamp) : NaN;
      if (!t || !spoken(t) || isNaN(at)) continue;
      s.turnAt = Math.max(s.turnAt, at);
      break;
    }
    let gotText = false, gotUsage = false;
    for (let i = assistants.length - 1, k = 0; i >= 0 && k < 30 && !(gotText && gotUsage); i--, k++) {
      const [a, b] = assistants[i];
      if (b - a >= 400000) continue;
      const j = parse(chunk, a, b);
      if (!j) continue;
      const m = j.message, u = m && m.usage;
      if (!gotUsage && u) {
        const n = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"].reduce((x, key) => x + (+u[key] || 0), 0);
        if (n > 0) { s.ctx = n; gotUsage = true; }
        if (m.model && m.model !== "<synthetic>") s.model = m.model;
      }
      if (!gotText) { const t = textOf(j); if (t) { s.last = oneLine(t, 160); gotText = true; } }
    }
  }
  // 搜：最近动过的 files 个会话里找 q；每个会话最多 per 处；给出那一句的前后一段、是谁说的、在文件里的位置
  search(q, files, per, cs, word, re) {
    const needle = re ? q : q.trim();
    if (!needle) return [];
    let pattern = re ? needle : needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (word) pattern = "(?<![\\p{L}\\p{N}_])(?:" + pattern + ")(?![\\p{L}\\p{N}_])";
    let rx;
    try { rx = new RegExp(pattern, "gu" + (cs ? "" : "i")); } catch (e) { return [{ error: "正则表达式无效" }]; }
    const anchor = re ? literalAnchor(needle) : needle;
    const variants = !anchor ? [] : Array.from(new Set(cs ? [anchor] : [anchor, anchor.toLowerCase(), anchor.toUpperCase(), anchor.charAt(0).toUpperCase() + anchor.slice(1)])).map((v) => Buffer.from(v));
    const list = this.files().sort((a, b) => b.mtime - a.mtime).slice(0, files), out = [], t0 = Date.now();
    for (const f of list) {
      if (Date.now() - t0 > 4000) break; // 太多了：先给这些
      let data;
      try { data = fs.readFileSync(f.p); } catch (e) { continue; }
      const lines = [], seen = new Set();
      if (!variants.length) { // 正则里没有一定会出现的字：一行一行看
        let ls = 0;
        while (ls < data.length && lines.length <= 200000 && Date.now() - t0 <= 4000) { let le = data.indexOf(0x0a, ls); if (le < 0) le = data.length; if (le > ls) lines.push([ls, le]); ls = le + 1; }
      }
      for (const v of variants) {
        let from = 0;
        while (from < data.length && lines.length <= 4000) {
          const r = data.indexOf(v, from);
          if (r < 0) break;
          let ls = data.lastIndexOf(0x0a, r); ls = ls < 0 ? 0 : ls + 1;
          let le = data.indexOf(0x0a, r + v.length); if (le < 0) le = data.length;
          if (!seen.has(ls)) { seen.add(ls); lines.push([ls, le]); }
          from = le;
        }
      }
      lines.sort((a, b) => a[0] - b[0]);
      const hits = [];
      let total = 0;
      for (const [a, b] of lines) {
        if (b - a <= 20 || b - a >= 2000000) continue;
        const j = parse(data, a, b);
        if (!j || (j.type !== "user" && j.type !== "assistant") || j.isMeta === true) continue;
        const texts = [], m = j.message;
        if (m && typeof m.content === "string") texts.push(m.content);
        if (m && Array.isArray(m.content)) m.content.forEach((x) => { if (x && x.type === "text" && typeof x.text === "string") texts.push(x.text); });
        for (const t of texts) {
          rx.lastIndex = 0;
          let mm;
          while ((mm = rx.exec(t))) {
            if (!mm[0].length) { rx.lastIndex++; continue; }
            total++;
            if (hits.length < per) {
              const s0 = Math.max(0, mm.index - 40), e0 = Math.min(t.length, mm.index + mm[0].length + 60);
              hits.push({ role: j.type, text: (s0 > 0 ? "…" : "") + t.slice(s0, e0).replace(/\s+/g, " ") + (e0 < t.length ? "…" : ""), match: mm[0].replace(/\s+/g, " "), uuid: j.uuid || "", offset: a, at: j.timestamp || "" });
            }
          }
        }
      }
      if (total > 0) {
        const id = path.basename(f.p, ".jsonl"), s = this.cache.get(f.p), title = s ? s.custom || s.ai || s.prompt : "";
        out.push({ id: id, path: f.p, title: title || id.slice(0, 8), count: total, hits: hits, size: data.length });
      }
    }
    return out;
  }
}
// 正则里一定会出现的一段纯字（找得到就先按字节在整个文件里找它）；有顶层的 | 就没有，返回空
function literalAnchor(re) {
  let best = "", cur = "", cls = false, esc = false, alt = false;
  const chars = Array.from(re);
  chars.forEach((c, i) => {
    if (esc) { esc = false; cur = ""; return; }
    if (c === "\\") { esc = true; if (cur.length > best.length) best = cur; cur = ""; return; }
    if (cls) { if (c === "]") cls = false; return; }
    if (c === "[") { cls = true; if (cur.length > best.length) best = cur; cur = ""; return; }
    if (c === "|") alt = true;
    if (/[\p{L}\p{N}_\- ]/u.test(c)) {
      const next = i + 1 < chars.length ? chars[i + 1] : " ";
      if (next === "?" || next === "*" || next === "{") { if (cur.length > best.length) best = cur; cur = ""; return; }
      cur += c;
    } else { if (cur.length > best.length) best = cur; cur = ""; }
  });
  if (cur.length > best.length) best = cur;
  return alt ? "" : best.trim();
}

module.exports = { Index: Index, norm: norm, sameProject: sameProject };
