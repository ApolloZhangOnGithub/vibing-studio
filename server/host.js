// host.js —— 服务器版当主机：连中转（/api/relay/host），别的设备（Mac、iPad、网页）发来的调用在这台服务器上照原样执行（local.js，同 Linux 版的那一份），
//   回复、终端和命令的输出、盯着的会话记录（tail）推回那台设备。同 app/Sources/RemoteHost.swift（命令、消息、认设备的做法一模一样），只是没有界面：
//   谁能用——只有这个账号连得上中转；再认设备：每台设备一把自己的密钥（remote.js 生成），这边出一个随机数让它签，验对了才算是那台设备；
//   同一账号、验过的设备直接允许（服务器前面没有人点「允许」）。允许过的设备记在 state.json 里（「设备」里看得到、能移除）
"use strict";
const fs = require("fs");
const crypto = require("crypto");

const ALLOW = new Set(["local.info", "pty.open", "pty.attach", "pty.list", "pty.write", "pty.resize", "pty.pause", "pty.resume", "pty.close", "pty.cwd",
  "exec.start", "exec.kill", "proc.start", "proc.write", "proc.close", "proc.kill", "fs.read", "fs.write", "fs.stat", "fs.glob", "fs.list", "fs.trash",
  "cc.sessions", "cc.find", "cc.search"]);
const OWNS = new Set(["exec.start", "pty.open", "pty.attach", "proc.start"]); // 这几条开出来的（终端、命令）：输出只送回开它的那台
const EVENTS = new Set(["exec.data", "exec.exit", "proc.data", "proc.exit", "pty.data", "pty.exit"]);
const TAIL_MAX = 600 << 10; // 一次最多推这么多（中转一条消息不能过 1 MB；剩下的下一趟接着推）

// 设备的公钥（x963，base64）→ Node 的公钥
function pubKey(b64) {
  const raw = Buffer.from(String(b64 || ""), "base64");
  if (raw.length !== 65 || raw[0] !== 4) return null;
  const u = (b) => b.toString("base64url");
  try { return crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: u(raw.subarray(1, 33)), y: u(raw.subarray(33)) }, format: "jwk" }); } catch (e) { return null; }
}

class Host {
  // o: { origin, device, name, version, local, cookie(): Promise<string>, relogin(): Promise, store: { get(), set(o) }, log(s), changed() }
  constructor(o) {
    this.o = o;
    this.ws = null; this.up = false; this.retry = 0; this.gen = 0; this.stopped = false;
    this.owner = new Map(); this.clients = new Map(); this.locs = new Map(); this.proven = new Map(); this.nonces = new Map(); this.challenged = new Map();
    this.waiting = new Map(); this.denied = new Set(); this.tails = new Map(); this.seenAt = new Map(); this.cfg = {};
    this.ping = null; this.since = 0; this.lastErr = "";
    o.local.sink = (t, x) => this.event(t, x);
  }
  approved() { return (this.o.store.get().approved) || {}; }
  setApproved(a) { this.o.store.set({ approved: a }); this.o.changed(); }
  state() {
    return { up: this.up, since: this.since, error: this.lastErr, clients: Array.from(this.clients, ([id, name]) => ({ id, name })),
      approved: Object.entries(this.approved()).map(([id, e]) => ({ id, name: e.name || "", at: e.at || 0, last: e.last || 0, loc: e.loc || "" })) };
  }

  // ---- 连中转 ----
  async connect() {
    if (this.stopped || this.ws) return;
    const g = this.gen;
    let cookie = "";
    try { cookie = await this.o.cookie(); } catch (e) { this.lastErr = String(e.message || e); this.o.changed(); return this.later(30); }
    if (g !== this.gen || this.stopped || this.ws) return;
    const u = new URL(this.o.origin);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/api/relay/host";
    u.search = "?device=" + encodeURIComponent(this.o.device) + "&name=" + encodeURIComponent(this.o.name);
    let ws;
    try { ws = new WebSocket(u.toString(), { headers: { Cookie: cookie, Origin: this.o.origin } }); } catch (e) { this.lastErr = String(e.message || e); return this.later(); }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true; this.up = true; this.retry = 0; this.since = Date.now(); this.lastErr = "";
      clearInterval(this.ping);
      this.ping = setInterval(() => this.send({ sys: "ping" }), 25000); // 中转不把空闲的连接断掉
      this.o.log("connected to " + this.o.origin);
      this.o.changed();
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8")); } catch (e) { return; }
      try { this.message(m); } catch (e) { this.o.log("message error: " + (e && e.stack || e)); }
    };
    ws.onerror = () => { /* onclose 接着来 */ };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null; this.cleanup();
      const code = ev && ev.code;
      this.o.log("relay closed" + (code ? " (" + code + ")" : "") + (opened ? "" : " before opening"));
      this.o.changed();
      if (this.stopped) return;
      if (code === 4000) { this.lastErr = "another copy of this server connected with the same device id"; return this.later(60); } // 同一个设备号有了新的连接：不抢
      // 没连上就断了：多半是会话过期（中转先验会话，401）——重新登录一次再连
      if (!opened) { this.o.relogin().catch(() => {}); }
      this.later();
    };
  }
  later(sec) { this.retry = Math.min(this.retry + 1, 6); const g = this.gen; setTimeout(() => { if (g === this.gen) this.connect(); }, (sec || (1 << (this.retry - 1))) * 1000); }
  stop() { this.stopped = true; this.gen++; const w = this.ws; this.ws = null; this.cleanup(); if (w) try { w.close(1000, "stop"); } catch (e) { /* 已经断了 */ } }
  cleanup() {
    this.up = false; this.clients.clear(); this.proven.clear(); this.nonces.clear(); this.challenged.clear();
    for (const t of this.tails.values()) clearInterval(t.timer);
    this.tails.clear();
    clearInterval(this.ping); this.ping = null;
  }
  send(o) { const w = this.ws; if (!w || !this.up) return; try { w.send(JSON.stringify(o)); } catch (e) { /* 断了：等重连 */ } }

  // ---- 中转送来的 ----
  message(m) {
    if (m.sys) {
      const from = m.from || "";
      if (m.sys === "client-join") { this.clients.set(from, m.cname || "iPad"); if (m.loc) this.locs.set(from, m.loc); this.o.changed(); }
      else if (m.sys === "client-leave") {
        if ((+m.left || 0) > 0) return; // 这台设备还有别的页连着
        this.clients.delete(from);
        for (const [k, v] of this.owner) if (v === from) this.owner.delete(k);
        for (const [k, t] of this.tails) if (t.from === from) { clearInterval(t.timer); this.tails.delete(k); }
        this.proven.delete(from); this.nonces.delete(from); this.challenged.delete(from);
        this.o.changed();
      }
      return;
    }
    if (!m.cmd || !m.from) return;
    const from = m.from;
    if (m.cname) this.clients.set(from, m.cname); else if (!this.clients.has(from)) this.clients.set(from, "iPad");
    if (m.loc) this.locs.set(from, m.loc);
    if (m.cmd === "auth.prove") return this.prove(from, m);
    if (m.cmd === "auth.code") return this.reply(from, m.id, false, { code: "E_NOCODE", message: "This server doesn't use verification codes" });
    if (m.cmd === "auth.retry") { this.denied.delete(from); this.reply(from, m.id, true, null); return this.release(from); }
    this.gate(m);
  }
  // 认设备：没验过的先排着，发一个随机数给它签（签的是「vs-remote-v1 / 这台的设备号 / 它的设备号 / 随机数」）；验过、同一账号——直接允许
  gate(m) {
    const cid = m.from, nm = m.cname || "iPad";
    if (this.denied.has(cid)) { this.authState(cid, "denied"); return this.reply(cid, m.id, false, { code: "E_DENIED", message: "This server has not authorized this device" }); }
    if (m.k == null) { this.authState(cid, "denied"); return this.reply(cid, m.id, false, { code: "E_DENIED", message: "Vibing Studio was updated. Reload the page." }); }
    const key = this.proven.get(cid);
    if (!key) { (this.waiting.get(cid) || this.waiting.set(cid, []).get(cid)).push(m); return this.challenge(cid); }
    const e = this.approved()[cid];
    if (!e || e.key !== key) {
      const a = this.approved(), now = Date.now();
      a[cid] = { name: nm, at: e && e.key === key ? e.at : now, last: now, loc: this.locs.get(cid) || "", key, verified: true, auto: true };
      this.setApproved(a);
      this.seenAt.set(cid, now);
      this.authState(cid, "ok");
    } else this.seen(cid, nm);
    this.run(m);
  }
  seen(cid, nm) {
    const t = this.seenAt.get(cid) || 0;
    if (Date.now() - t < 60000) return;
    this.seenAt.set(cid, Date.now());
    const a = this.approved();
    if (!a[cid]) return;
    a[cid].last = Date.now();
    if (nm && a[cid].name !== nm) a[cid].name = nm;
    this.setApproved(a);
  }
  challenge(cid) {
    const t = this.challenged.get(cid) || 0;
    if (Date.now() - t < 3000 && this.nonces.has(cid)) return; // 刚发过：排着的一串调用只发一次
    const n = this.nonces.get(cid) || crypto.randomBytes(16).toString("hex");
    this.nonces.set(cid, n); this.challenged.set(cid, Date.now());
    this.send({ to: cid, sys: "auth", state: "challenge", nonce: n, host: this.o.name, device: this.o.device, policy: "auto" });
  }
  prove(from, m) {
    const a = m.args || {}, n = this.nonces.get(from);
    if (!n || a.nonce !== n) return this.reply(from, m.id, false, { code: "E_AUTH", message: "The signing nonce expired" });
    const pk = pubKey(a.pub), sig = Buffer.from(String(a.sig || ""), "base64");
    let ok = false;
    try { ok = !!pk && crypto.verify("sha256", Buffer.from("vs-remote-v1\n" + this.o.device + "\n" + from + "\n" + n), { key: pk, dsaEncoding: "ieee-p1363" }, sig); } catch (e) { ok = false; }
    if (!ok) return this.reply(from, m.id, false, { code: "E_AUTH", message: "Bad device signature" });
    this.nonces.delete(from); this.challenged.delete(from);
    this.proven.set(from, String(a.pub));
    this.reply(from, m.id, true, { policy: "auto" });
    this.release(from);
  }
  release(cid) { const l = this.waiting.get(cid) || []; this.waiting.delete(cid); l.forEach((x) => this.gate(x)); }
  authState(cid, st) { this.send({ to: cid, sys: "auth", state: st, host: this.o.name, policy: "auto" }); }
  revoke(id) {
    const a = this.approved(); delete a[id]; this.setApproved(a);
    this.denied.add(id); this.proven.delete(id);
    if (this.clients.has(id)) this.authState(id, "denied");
  }

  run(m) {
    const from = m.from, id = m.id, cmd = m.cmd, a = m.args || {};
    if (cmd === "info") return this.reply(from, id, true, { platform: "remote", app: "Vibing Studio", version: this.o.version, host: this.o.name, server: true, active: true, fullscreen: false, inset: 0,
      commands: Array.from(ALLOW).sort().concat(["tail.watch", "tail.unwatch"]) });
    if (cmd === "agents.cfg") return this.reply(from, id, true, this.cfg);
    if (cmd === "tail.watch" || cmd === "tail.unwatch") {
      const k = from + "\n" + String(a.path || ""), old = this.tails.get(k);
      if (old) { clearInterval(old.timer); this.tails.delete(k); }
      if (cmd === "tail.watch" && a.path) this.tail(from, String(a.path), Math.max(0, +a.offset || 0));
      return this.reply(from, id, true, null);
    }
    if (!ALLOW.has(cmd)) return this.reply(from, id, false, { code: "E_DENIED", message: "This server doesn't let other devices use “" + cmd + "”" });
    if (OWNS.has(cmd) && a.id) this.owner.set(String(a.id), from);
    Promise.resolve().then(() => this.o.local.run(cmd, a)).then((v) => this.reply(from, id, true, v === undefined ? null : v),
      (e) => this.reply(from, id, false, { code: (e && e.code) || "E_FAILED", message: String((e && e.message) || e) }));
  }
  reply(to, id, ok, v) {
    const body = ok ? { id: id == null ? null : id, ok: true, value: v } : { id: id == null ? null : id, ok: false, error: v };
    const s = JSON.stringify(body);
    if (s.length <= 900000) return this.send(Object.assign({ to }, body));
    const n = Math.ceil(s.length / 524288); // 太大（读一个大文件）：分成 512 KB 一块送，那边拼回去
    for (let k = 0; k < n; k++) this.send({ to, id, part: k, parts: n, s: s.slice(k * 524288, (k + 1) * 524288) });
  }
  // 终端、命令的输出：是哪台设备开的就送给哪台
  event(t, x) {
    if (!EVENTS.has(t) || !x || x.id == null) return;
    const to = this.owner.get(String(x.id));
    if (!to) return;
    this.send({ to, ev: t, detail: x });
    if (/\.exit$/.test(t)) this.owner.delete(String(x.id));
  }
  // 盯着的会话记录：每 0.2 秒看一眼长了没有，长了就把新写的整行推过去
  tail(from, p, off) {
    const t = { from, path: p, off, busy: false, timer: null };
    t.timer = setInterval(() => {
      if (t.busy || !this.up) return;
      t.busy = true;
      fs.stat(p, (err, st) => {
        if (err || !st || st.size === t.off) { t.busy = false; return; }
        if (st.size < t.off) { t.off = st.size; t.busy = false; return this.send({ to: from, ev: "tail.data", detail: { path: p, offset: -1 } }); } // 变短了（被改写）：那边从头读
        const at = t.off, n = Math.min(st.size - at, TAIL_MAX);
        fs.open(p, "r", (e2, fd) => {
          if (e2) { t.busy = false; return; }
          const buf = Buffer.alloc(n);
          fs.read(fd, buf, 0, n, at, (e3, got) => {
            fs.close(fd, () => {});
            t.busy = false;
            if (e3 || t.off !== at) return;
            const u = buf.subarray(0, got), end = u.lastIndexOf(10) + 1; // 只推整行
            if (!end) { if (u.length >= TAIL_MAX) t.off = at + u.length; return; }
            t.off = at + end;
            this.send({ to: from, ev: "tail.data", detail: { path: p, offset: at, b64: u.subarray(0, end).toString("base64"), mtime: st.mtimeMs } });
          });
        });
      });
    }, 200);
    this.tails.set(from + "\n" + p, t);
  }
}

module.exports = { Host };
