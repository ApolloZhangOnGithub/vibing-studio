// remote-host.js —— 让 iPad 借这台 Mac 用（Vibing Studio 的 iPad 端；另一头是 remote.js，中间是服务端的 src/relay.js）。
//   设置 › 通用 › 「其他设备使用这台 Mac」（默认关）：开着时这个页面连一条 WebSocket 到 /api/relay/host。iPad 发来的调用在这台 Mac 上照原样执行
//   （nadosNative.call），回复、终端和命令的输出（事件）再送回那台 iPad。
//   安全：只有你自己的账号能连上中转；每台新设备第一次来，这边问一次「允许」（记住；设置里能撤销）；只放行下面 ALLOW 这些命令——
//   终端、命令、文件、Claude Code 的会话。窗口、菜单、通知、剪贴板、截屏、内嵌浏览器这些是这台 Mac 自己的界面，不给。
(function () {
  "use strict";
  var N = window.nadosNative;
  if (!N || !N.local || N.remote || window.TSU_REMOTE_HOST) return;
  var KEY_ON = "vs-remote-on", KEY_DEV = "vs-remote-device", KEY_OK = "vs-remote-ok";
  var ALLOW = ["local.info", "pty.open", "pty.attach", "pty.list", "pty.write", "pty.resize", "pty.pause", "pty.resume", "pty.close", "pty.cwd",
    "exec.start", "exec.kill", "proc.start", "proc.write", "proc.close", "proc.kill", "fs.read", "fs.write", "fs.stat", "fs.glob", "fs.list", "fs.trash", "fs.tags",
    "cc.sessions", "cc.find", "cc.search"];
  var EVENTS = { "exec.data": 1, "exec.exit": 1, "proc.data": 1, "proc.exit": 1, "pty.data": 1, "pty.exit": 1 };
  var OWNS = { "exec.start": 1, "pty.open": 1, "pty.attach": 1, "proc.start": 1 };
  var SHARED_CFG = ["translateTasks", "translateReplies", "translateShow"]; // iPad 照这台 Mac 用的对话设置 // 这几条开出来的（终端、命令）：它的输出只送回开它的那台
  var dev = localStorage.getItem(KEY_DEV);
  if (!dev) { dev = "mac-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); localStorage.setItem(KEY_DEV, dev); }
  var okMap = function () { try { return JSON.parse(localStorage.getItem(KEY_OK) || "{}") || {}; } catch (e) { return {}; } };
  var setOk = function (m) { localStorage.setItem(KEY_OK, JSON.stringify(m)); fire(); };
  var ws = null, up = false, retry = 0, retryT = 0, owner = {}, clients = {}, denied = {}, asking = {}, waiting = {}, macName = "Mac", listeners = [], tails = {};
  var fire = function () { listeners.forEach(function (f) { try { f(); } catch (e) { /* 设置页没开 */ } }); };
  N.call("local.info").then(function (i) { if (i && (i.host || i.name)) macName = String(i.host || i.name).replace(/\.local$/, ""); }, function () {});
  var send = function (m) { if (ws && up) { try { ws.send(JSON.stringify(m)); } catch (e) { /* 断了：等重连 */ } } };
  // 回复太大（读一个大文件）：分成 512 KB 一块送，iPad 那边拼回去
  function reply(to, id, ok, val) {
    var body = JSON.stringify(ok ? { id: id, ok: true, value: val } : { id: id, ok: false, error: val });
    if (body.length <= 900000) return send(Object.assign({ to: to }, JSON.parse(body)));
    var n = Math.ceil(body.length / 524288);
    for (var k = 0; k < n; k++) send({ to: to, id: id, part: k, parts: n, s: body.slice(k * 524288, (k + 1) * 524288) });
  }
  function info() { // 告诉 iPad 能用哪些命令（菜单、内嵌浏览器这些它自己画网页版的）
    return N.call("info").then(function (i) { return { platform: "remote", app: (i && i.app) || "Vibing Studio", version: (i && i.version) || "", host: macName, active: true, fullscreen: false, inset: 0, commands: ALLOW.filter(function (c) { return !i || !i.commands || i.commands.indexOf(c) >= 0 || /^(local|pty|exec|proc|cc)\./.test(c) || /^fs\.(read|write|stat|glob|list)$/.test(c); }) }; });
  }
  // iPad 看着的会话记录（tail.watch）：这边本机读很快——每 0.2 秒看一眼长了没有，长了就把新写的整行直接推给那台 iPad（tail.data）。
  //   以前 iPad 自己隔 0.7 秒经中转问一次多大、再来回读一趟：慢，中转一忙（别的大回复排在前面）就更慢
  var bytes = function (s) { if (typeof Uint8Array.fromBase64 === "function") { try { return Uint8Array.fromBase64(s || ""); } catch (e) { /* 照旧 */ } } var t = atob(s || ""), u = new Uint8Array(t.length); for (var i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
  var b64 = function (u) { var s = ""; for (var i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
  var TAIL_MAX = 600 << 10; // 一次最多推这么多（中转一条消息不能过 1MB；剩下的下一趟接着推）
  function tailTick() {
    if (!up) return;
    Object.keys(tails).forEach(function (k) {
      var t = tails[k];
      if (t.busy) return;
      t.busy = true;
      N.call("fs.stat", { path: t.path }).then(function (st) {
        if (!st || st.size === t.off) return;
        if (st.size < t.off) { t.off = st.size; send({ to: t.from, ev: "tail.data", detail: { path: t.path, offset: -1 } }); return; } // 变短了（被改写）：那边从头读
        var at = t.off;
        return N.call("fs.read", { path: t.path, offset: at, max: Math.min(st.size - at, TAIL_MAX) }).then(function (r) {
          if (tails[k] !== t || t.off !== at) return;
          var u = bytes(r && r.b64), end = u.lastIndexOf(10) + 1; // 只推整行：最后一行还没写完的，下一趟连着推
          if (!end) { if (u.length >= TAIL_MAX) t.off = at + u.length; return; } // 一行比一次能推的还长：这边跳过，那边自己去读（它会发现接不上）
          t.off = at + end;
          send({ to: t.from, ev: "tail.data", detail: { path: t.path, offset: at, b64: end === u.length ? r.b64 : b64(u.subarray(0, end)), mtime: st.mtime } });
        });
      }).catch(function () {}).then(function () { t.busy = false; });
    });
  }
  // 计时放在一个 Worker 里：你在用 iPad 时这台 Mac 的窗口常是被挡住、最小化、屏幕关着的——这时页面自己的计时器被 WebKit 放慢到一秒一次
  //   （隐藏页节流），iPad 上就要多等一两秒才看到新内容（时快时慢）；Worker 里的计时器不受这个限制。建不了 Worker 的照旧用页面的
  function ticker(ms, fn) {
    try { var w = new Worker(URL.createObjectURL(new Blob(["setInterval(function(){postMessage(0)}," + ms + ")"], { type: "text/javascript" }))); w.onmessage = function () { fn(); }; return w; }
    catch (e) { return setInterval(fn, ms); }
  }
  var ticking = false;
  function startTickers() { if (ticking) return; ticking = true; ticker(200, tailTick); ticker(25000, function () { send({ sys: "ping" }); }); } // 每 25 秒一下：中转那边不把空闲的连接断掉（同上：窗口挡住时也按时发）
  function run(m) {
    var from = m.from;
    if (m.cmd === "tail.watch" || m.cmd === "tail.unwatch") {
      var tk = from + "\n" + String((m.args && m.args.path) || "");
      if (m.cmd === "tail.unwatch") delete tails[tk];
      else if (m.args && m.args.path) tails[tk] = { from: from, path: String(m.args.path), off: Math.max(0, +m.args.offset || 0), busy: false };
      return reply(from, m.id, true, null);
    }
    if (m.cmd === "info") return info().then(function (v) { reply(from, m.id, true, v); }, function (e) { reply(from, m.id, false, { code: "E_FAILED", message: String(e && e.message || e) }); });
    // 这台 Mac 上对话的翻译设置：iPad 连上时照着用（不然 iPad 那边默认关着，Mac 上早翻好的那边一直是原文）
    if (m.cmd === "agents.cfg") { var c0 = (window.TSU_AGENTS && TSU_AGENTS.cfg) || {}, o0 = { _full: 1 }; Object.keys(c0).forEach(function (k) { if (c0[k] !== undefined && typeof c0[k] !== "function") o0[k] = c0[k]; }); return reply(from, m.id, true, o0); }
    if (ALLOW.indexOf(m.cmd) < 0) return reply(from, m.id, false, { code: "E_DENIED", message: "这台 Mac 不让 iPad 用「" + m.cmd + "」" });
    if (OWNS[m.cmd] && m.args && m.args.id) owner[m.args.id] = from;
    N.call(m.cmd, m.args || {}).then(function (v) { reply(from, m.id, true, v); }, function (e) { reply(from, m.id, false, { code: (e && e.code) || "E_FAILED", message: String(e && e.message || e) }); });
  }
  // 新设备：问一次（排着它这期间发来的调用，答了再一起处理）
  function gate(m) {
    var cid = m.from, ok = okMap();
    if (ok[cid]) { if (ok[cid].name !== m.cname && m.cname) { ok[cid].name = m.cname; setOk(ok); } return run(m); }
    if (denied[cid]) return reply(cid, m.id, false, { code: "E_DENIED", message: "这台 Mac 未授权此设备" });
    (waiting[cid] = waiting[cid] || []).push(m);
    if (asking[cid]) return;
    asking[cid] = true;
    var S = window.STUDIO, nm = m.cname || "iPad";
    var q = S && S.ask ? S.ask({ title: "「" + nm + "」请求使用这台 Mac", text: "允许该设备在这台 Mac 上打开终端、读写文件，并查看和继续 Claude Code / Codex 的会话？可随时在「设置 › 通用」中撤销。", ok: "允许" }) : Promise.resolve(window.confirm("「" + nm + "」请求使用这台 Mac，是否允许？"));
    q.then(function (yes) {
      asking[cid] = false;
      var l = waiting[cid] || []; delete waiting[cid];
      if (yes) { var o2 = okMap(); o2[cid] = { name: nm, at: Date.now() }; setOk(o2); l.forEach(run); }
      else { denied[cid] = true; l.forEach(function (x) { reply(cid, x.id, false, { code: "E_DENIED", message: "这台 Mac 未授权此设备" }); }); }
    });
  }
  // 这台 Mac 上的终端、命令的输出：是哪台 iPad 开的就送给哪台（这台 Mac 自己开的不往外送）
  window.addEventListener("nados-native", function (e) {
    var d = e.detail || {}, t = d.type, x = d.detail || {};
    if (!up || !EVENTS[t] || !x || x.id == null) return;
    var to = owner[x.id];
    if (!to) return;
    send({ to: to, ev: t, detail: x });
    if (/\.exit$/.test(t)) delete owner[x.id];
  });
  function connect() {
    if (native !== false) return; // 原生那边接管了（或者还没问清楚）：这个页面不连
    startTickers();
    clearTimeout(retryT);
    if (localStorage.getItem(KEY_ON) !== "1" || ws) return;
    var u = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/relay/host?device=" + encodeURIComponent(dev) + "&name=" + encodeURIComponent(macName);
    try { ws = new WebSocket(u); } catch (e) { ws = null; return later(); }
    ws.onopen = function () { up = true; retry = 0; fire(); };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.sys === "client-join") { clients[m.from] = m.cname || "iPad"; fire(); return; }
      if (m.sys === "client-leave") { delete clients[m.from]; Object.keys(owner).forEach(function (k) { if (owner[k] === m.from) delete owner[k]; }); Object.keys(tails).forEach(function (k) { if (tails[k].from === m.from) delete tails[k]; }); fire(); return; }
      if (m.sys) return;
      if (m.cmd && m.from) { clients[m.from] = m.cname || clients[m.from] || "iPad"; gate(m); }
    };
    ws.onclose = function (ev) { ws = null; up = false; clients = {}; tails = {}; fire(); if (ev && ev.code === 4000) return; later(); }; // 盯着的记录：那边重连后会重新要
    ws.onerror = function () { /* onclose 接着来 */ };
  }
  function later() { if (localStorage.getItem(KEY_ON) !== "1") return; retry = Math.min(retry + 1, 6); retryT = setTimeout(connect, 1000 * Math.pow(2, retry - 1)); }
  function set(on) {
    localStorage.setItem(KEY_ON, on ? "1" : "0");
    if (on) connect(); else { try { if (ws) ws.close(1000, "off"); } catch (e) { /* 已经断了 */ } ws = null; up = false; clients = {}; }
    fire();
  }
  // ---- 新版 App：这一段在原生那边（app/Sources/RemoteHost.swift）——窗口挡住、最小化、锁屏、关了窗口都照样按时工作；这里只剩设置页用的开关、列表 ----
  //   老版本的 App（原生那边没有 remote.*）：照旧由这个页面当主机（上面那一套）
  var native = null, nst = { on: false, up: false, device: dev, clients: [], approved: [] }, lastCfg = "";
  var apply = function (st) { if (st && typeof st === "object") { nst = st; fire(); } };
  var pushCfg = function () { // 这台 Mac 上对话的翻译设置：交给原生那边，iPad 连上时照着用
    var c0 = (window.TSU_AGENTS && TSU_AGENTS.cfg) || {}, o0 = {};
    Object.keys(c0).forEach(function (k) { if (c0[k] !== undefined && typeof c0[k] !== "function") o0[k] = c0[k]; }); // 整份（新设备第一次照它抄）；SHARED_CFG 那几项之后也一直跟着
    o0._full = 1;
    var sig = JSON.stringify(o0);
    if (sig !== lastCfg) { lastCfg = sig; N.call("remote.cfg", { cfg: o0 }).catch(function () {}); }
  };
  window.TSU_REMOTE_HOST = {
    on: function () { return native ? !!nst.on : localStorage.getItem(KEY_ON) === "1"; },
    set: function (on) { if (native) return N.call("remote.set", { on: !!on }).then(apply, function () {}); set(on); },
    connected: function () { return native ? !!nst.up : up; },
    device: function () { return native ? nst.device || dev : dev; },
    clients: function () { return native ? nst.clients || [] : Object.keys(clients).map(function (k) { return { id: k, name: clients[k] }; }); },
    approved: function () { if (native) return nst.approved || []; var o = okMap(); return Object.keys(o).map(function (k) { return { id: k, name: o[k].name, at: o[k].at }; }); },
    revoke: function (id) { if (native) return N.call("remote.revoke", { id: id }).then(apply, function () {}); var o = okMap(); delete o[id]; setOk(o); denied[id] = true; },
    watch: function (f) { listeners.push(f); },
  };
  N.call("info").then(function (i) {
    native = !!(i && Array.isArray(i.commands) && i.commands.indexOf("remote.state") >= 0);
    if (!native) return connect();
    if (N.on) N.on("remote.changed", apply);
    // 第一次：这个页面当主机时用过的设备号、允许过的设备、开没开，交给原生那边（iPad 记着的是这个设备号；允许过的不用再问）
    N.call("remote.import", { on: localStorage.getItem(KEY_ON) === "1", device: dev, ok: okMap() }).then(apply, function () {});
    pushCfg();
    setInterval(pushCfg, 5000);
  }, function () { native = false; connect(); });
})();
