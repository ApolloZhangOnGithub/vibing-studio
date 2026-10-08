// status.js —— 「服务状态」App，照 status.claude.com 的样子：
//   最上面一条总的状态（全绿 / 部分性能下降 / 部分异常）；下面一张卡片，每个服务一行——名字、现在的状态，90 根细条（24 小时每根 16 分钟、30 天每根 8 小时；
//   绿 = 正常，黄 = 慢、限流、要登录、断过、偶尔失败，橙 = 失败不少，红 = 四分之一以上失败；这个服务开始有记录之前的是浅灰，有记录以后没有调用的算正常），
//   条下面「24 小时前 —— 可用率 —— 现在」；指一根看那一段的数，点一根下面只列那一段的调用。
//   再下面「过往事件」（按天，同一个服务连着出问题的一段算一件，点标题看是哪几次调用）、调用记录（点一条看详情）。
//   数据：这台设备的服务记录（svclog.js）；翻译另外合上服务器那边的（GET /api/svclog：这个账号所有设备的，带等模型的时间、哪台设备）
(function () {
  "use strict";
  var S = window.STUDIO, L = window.TSU_SVCLOG;
  if (!S || !S.pages || !S.openPage || !L) return;
  var I18N = window.TSU_I18N;
  var en = function () { return !!(I18N && I18N.lang && I18N.lang() === "en"); };
  var t = function (zh, e) { return en() ? e : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var HOUR = 3600e3, DAY = 864e5, MIN = 60e3, KEEP = 30 * DAY, GAP = 5 * MIN, NOW_WIN = 15 * MIN;
  var BY = {};
  L.services.forEach(function (s) { BY[s.id] = s; });
  var svcName = function (id) { var s = BY[id]; return s ? t(s.zh, s.en) : id; };
  var CORE = ["translate", "sync", "relay", "account", "update"]; // 没有调用也列出来的；别的有记录才列

  var CLOSE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
  var TAB_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8.5h2.6l1.6-4.3 2.6 7.6 1.9-5.2 1.2 1.9h3.1"/></svg>';
  var LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="16" rx="3"/><path d="M6 12.5h2.6l1.6-3.8 2.6 6.6 1.8-4.4 1 1.6H18"/></svg>';

  // ---- 格式 ----
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var hm = function (at, sec) { var d = new Date(at); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + (sec ? ":" + pad(d.getSeconds()) : ""); };
  var md = function (at) { var d = new Date(at); return en() ? MON[d.getMonth()] + " " + d.getDate() : d.getMonth() + 1 + "月" + d.getDate() + "日"; };
  var sameDay = function (a, b) { return new Date(a).toDateString() === new Date(b).toDateString(); };
  var when = function (at) { return sameDay(at, Date.now()) ? hm(at, true) : md(at) + " " + hm(at, true); };
  var full = function (at) { var d = new Date(at); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + hm(at, true) + "." + String(d.getMilliseconds() + 1000).slice(1); };
  function dur(ms) {
    ms = Math.max(0, ms || 0);
    if (ms < 1000) return Math.round(ms) + " ms";
    if (ms < 60e3) return (ms / 1000).toFixed(ms < 10e3 ? 1 : 0) + (en() ? " s" : " 秒");
    var m = Math.floor(ms / 60e3), s = Math.round((ms % 60e3) / 1000);
    if (m >= 60) { var h = Math.floor(m / 60); m %= 60; return en() ? h + " h " + m + " min" : h + " 小时 " + m + " 分"; }
    return en() ? m + " min " + s + " s" : m + " 分 " + s + " 秒";
  }
  var times = function (n) { return n + (n === 1 ? " time" : " times"); };
  var dayStart = function (at) { var d = new Date(at); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  var dayBack = function (at, k) { var d = new Date(at); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - k).getTime(); };
  var devName = function (id) { var SY = window.TSU_SYNC; if (!id) return ""; if (SY && SY.dev === id) return t("这台设备", "This device"); return SY && SY.deviceName ? SY.deviceName(id) : id; };

  // ---- 一次调用：操作、结果的说法 ----
  var OPS = {
    "GET /api/sync": ["拉取", "Pull"], "POST /api/store": ["上传", "Push"], "POST /api/devices": ["设备报到", "Device check-in"], "GET /api/devices": ["设备列表", "Device list"],
    "POST /api/lease": ["占用 / 释放", "Lease"], "POST /api/notices": ["通知", "Notices"], "GET /api/notices": ["通知", "Notices"],
    "GET /api/me": ["账户信息", "Account info"], "GET /api/usage": ["用量", "Usage"], "GET /api/stats": ["统计", "Statistics"],
    "GET /api/relay/hosts": ["在线的 Mac", "Online Macs"], "WS /api/relay/host": ["主机连接", "Host connection"], "WS /api/relay/client": ["客户端连接", "Client connection"],
    "POST /api/chat": ["对话", "Chat"], "POST /api/tools/brave": ["搜索", "Search"], "POST /api/tools/fetch": ["读取网页", "Web fetch"],
    "GET /version.json": ["界面版本", "UI version"], "GET /builds.json": ["构建列表", "Build list"], "GET /downloads/macos.json": ["App 更新", "App update"], "GET /api/version": ["网站版本", "Site version"],
    tasks: ["任务标题", "Task titles"], reply: ["回复", "Replies"],
  };
  function opName(r) { var o = OPS[r.op]; if (o) return t(o[0], o[1]); if (/^\w+ \/api\/sbx\//.test(r.op)) return r.op.replace(/^\w+ \/api\/sbx\//, ""); return r.op.replace(/^\w+ /, ""); }
  function result(r) {
    var ws = /^WS /.test(r.op);
    if (ws && r.info && r.info.ev === "open") return t("已连接", "Connected");
    if (r.cls === "drop") return t("断开", "Closed") + " " + r.st;
    if (ws && r.cls === "ok") return t("已关闭", "Closed") + " " + r.st;
    if (r.cls === "limit") return "429 " + t("受限", "Limited");
    if (r.cls === "auth") return r.st + " " + (r.st === 402 ? t("余额不足", "No credit") : t("需要登录", "Sign-in"));
    if (r.cls === "fail") return r.st ? r.st + (r.st === 200 ? " " + t("无效响应", "Bad response") : "") : r.err === "timeout" ? t("超时", "Timed out") : t("未连上", "No connection");
    return String(r.st || "");
  }
  var CLS_NAME = function (c) { return { ok: t("正常", "OK"), slow: t("较慢", "Slow"), limit: t("限流", "Rate limited"), auth: t("需要登录", "Sign-in required"), drop: t("连接中断", "Connection dropped"), fail: t("失败", "Failed") }[c] || c; };
  var sevOfCls = function (c) { return c === "ok" ? "ok" : c === "fail" ? "bad" : "warn"; };

  // ---- 数据：本机的 + 服务器的（翻译）----
  var srv = { at: 0, data: null, p: null };
  function loadServer(force) {
    if (srv.p) return srv.p;
    if (!force && Date.now() - srv.at < 60e3) return Promise.resolve(srv.data);
    srv.at = Date.now();
    srv.p = fetch("/api/svclog", { credentials: "same-origin", cache: "no-store", svclog: false })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && Array.isArray(j.rows)) srv.data = j; return srv.data; }, function () { return srv.data; })
      .then(function (d) { srv.p = null; return d; });
    return srv.p;
  }
  function fromServer(x, slow) {
    var op = x.op === "reply" ? "reply" : "tasks", st = x.status | 0;
    var r = { at: x.at, svc: "translate", op: op, ms: x.ms || 0, st: st, err: x.error || "", n: x.items || 0, src: "server",
      info: { cached: x.cached, translated: x.translated, upMs: x.up_ms, upSt: x.up_status, model: x.model, dev: x.dev, note: x.note } };
    r.cls = st === 429 ? "limit" : st === 401 || st === 402 || st === 403 ? "auth" : st !== 200 ? "fail" : r.ms > ((slow && slow[op]) || 20000) ? "slow" : "ok";
    return r;
  }
  // 本机的：头一回读 30 天的，以后只读最近的（往前多读一分钟：别的窗口晚写进来的）
  var mine = { list: [], hi: 0 };
  function loadLocal() {
    var keep = Date.now() - KEEP, since = mine.hi ? Math.max(keep, mine.hi - 60e3) : keep;
    return L.calls({ since: since, limit: 20000 }).then(function (l) {
      mine.list = l.concat(mine.list.filter(function (r) { return r.at < since && r.at >= keep; }));
      l.forEach(function (r) { if (r.at > mine.hi) mine.hi = r.at; });
      return mine.list;
    });
  }
  function load() {
    var since = Date.now() - KEEP;
    return Promise.all([loadLocal(), L.hours(since - DAY), loadServer()]).then(function (res) {
      var calls = res[0].slice(), hours = res[1], sv = res[2];
      if (sv) {
        // 翻译：用服务器的（所有设备）；本机的只留没到服务器的（没连上、超时）
        var seen = {}, srows = [];
        sv.rows.concat(sv.fails || []).forEach(function (x) { var k = x.at + "|" + x.op + "|" + (x.dev || ""); if (!seen[k]) { seen[k] = 1; srows.push(fromServer(x, sv.slow)); } });
        calls = calls.filter(function (r) { return r.svc !== "translate" || r.st === 0; }).concat(srows);
        hours = hours.filter(function (a) { return a.svc !== "translate"; }).concat((sv.hours || []).map(function (a) {
          var lim = a.limited || 0, bad = Math.max(0, (a.bad || 0) - lim);
          return { svc: "translate", h: a.h, n: a.n, fail: bad, limit: lim, slow: a.slow || 0, auth: 0, drop: 0, ok: Math.max(0, a.n - (a.bad || 0) - (a.slow || 0)), ms: a.ms || 0, mx: a.mx || 0 };
        }));
      }
      calls.sort(function (a, b) { return b.at - a.at; });
      return { calls: calls, hours: hours, server: !!sv, at: Date.now() };
    });
  }

  // ---- 汇总 ----
  var ZERO = function () { return { n: 0, ok: 0, slow: 0, limit: 0, auth: 0, drop: 0, fail: 0, ms: 0, mx: 0 }; };
  function plus(a, b) { ["n", "ok", "slow", "limit", "auth", "drop", "fail", "ms"].forEach(function (f) { a[f] += b[f] || 0; }); a.mx = Math.max(a.mx, b.mx || 0); return a; }
  function addCall(a, r) { a.n++; a[r.cls] = (a[r.cls] || 0) + 1; a.ms += r.ms || 0; a.mx = Math.max(a.mx, r.ms || 0); return a; }
  // 每个服务最早的一条记录（它之前的那些格子是「还没开始记」，不是「没出问题」）
  function firstSeen(d) {
    var f = {};
    d.calls.forEach(function (r) { if (!f[r.svc] || r.at < f[r.svc]) f[r.svc] = r.at; });
    d.hours.forEach(function (h) { if (h.n && (!f[h.svc] || h.h < f[h.svc])) f[h.svc] = h.h; });
    return f;
  }
  // 90 根：24 小时每根 16 分钟（按每一次调用算）；30 天每根 8 小时（按每小时的汇总算，从本地 0 点起 0–8、8–16、16–24 点）
  var STEP = { "24h": 16 * MIN, "30d": 8 * HOUR }, NB = 90;
  function grid(range) {
    var step = STEP[range], now = Date.now(), end;
    if (range === "24h") end = (Math.floor(now / step) + 1) * step;
    else { var m = dayStart(now); end = m + (Math.floor((now - m) / step) + 1) * step; }
    var start = end - NB * step, list = [];
    for (var i = 0; i < NB; i++) list.push({ from: start + i * step, to: start + (i + 1) * step });
    return { range: range, step: step, start: start, end: end, list: list };
  }
  // 一根的颜色（同 status page）：up 绿；minor 黄（慢、限流、要登录、断过、偶尔一次失败）；partial 橙（失败不少）；major 红（失败两次以上、占四分之一以上）；
  //   none 浅灰：这个服务开始有记录之前。有记录以后没有调用的算正常（同 status page：没出事就是好的）
  function sevOf(a, before) {
    if (!a.n) return before ? "none" : "up";
    var f = a.fail / a.n;
    if (a.fail >= 2 && f >= 0.25) return "major";
    if (a.fail && (f >= 0.05 || a.fail >= 3)) return "partial";
    if (a.fail || a.limit || a.auth || a.drop || a.slow / a.n >= 0.2) return "minor";
    return "up";
  }
  function fill(g, d, svc, first) {
    var cells = g.list.map(function (b) { return { from: b.from, to: b.to, a: ZERO() }; });
    if (g.range === "24h") d.calls.forEach(function (r) { if (r.svc === svc && r.at >= g.start && r.at < g.end) addCall(cells[Math.floor((r.at - g.start) / g.step)].a, r); });
    else d.hours.forEach(function (h) { if (h.svc === svc && h.h >= g.start && h.h < g.end) plus(cells[Math.floor((h.h - g.start) / g.step)].a, h); });
    cells.forEach(function (c) { c.s = sevOf(c.a, !first || c.to <= first); });
    return cells;
  }
  // 现在（最近 15 分钟）：正常 · 性能下降 · 故障；从来没有记录的：无记录
  function current(list, has) {
    if (!has) return { k: "none", text: t("无记录", "No data") };
    var since = Date.now() - NOW_WIN, rc = list.filter(function (r) { return r.at >= since; });
    if (!rc.length) return { k: "up", text: t("正常", "Operational") };
    var c = ZERO(); rc.forEach(function (r) { addCall(c, r); });
    if (rc[0].cls === "fail" || c.fail / c.n >= 0.25) return { k: "major", text: t("故障", "Outage") };
    if (c.fail || c.limit || c.auth || c.drop || c.slow / c.n >= 0.3) return { k: "partial", text: t("性能下降", "Degraded Performance") };
    return { k: "up", text: t("正常", "Operational") };
  }
  // 事件：同一个服务里不正常的调用，前后隔不到 5 分钟的连成一段；有失败、或者不正常的有两次以上才算。
  //   严重：失败三次以上、占四分之一以上（红）；别的（橙）
  function incidents(calls) {
    var by = {}, out = [];
    calls.forEach(function (r) { if (r.cls !== "ok") (by[r.svc] = by[r.svc] || []).push(r); });
    Object.keys(by).forEach(function (svc) {
      var l = by[svc].slice().sort(function (a, b) { return a.at - b.at; }), cur = null;
      var close = function () { if (cur && (cur.c.fail || cur.list.length >= 2)) out.push(cur); cur = null; };
      l.forEach(function (r) {
        var end = r.at + (/^WS /.test(r.op) ? 0 : r.ms);
        if (cur && r.at - cur.end > GAP) close();
        if (!cur) cur = { svc: svc, start: r.at, end: end, list: [], c: ZERO(), wait: 0, mx: 0 };
        cur.list.push(r); addCall(cur.c, r); cur.end = Math.max(cur.end, end);
        if (r.cls === "limit" && r.info && r.info.wait > cur.wait) cur.wait = r.info.wait;
        if (r.cls === "slow" && r.ms > cur.mx) cur.mx = r.ms;
      });
      close();
    });
    out.forEach(function (x) {
      x.kind = ["fail", "limit", "auth", "drop", "slow"].filter(function (k) { return x.c[k]; })[0];
      x.sev = x.c.fail >= 3 && x.c.fail / x.c.n >= 0.25 ? "major" : "minor";
      var errs = {}; x.list.forEach(function (r) { if (r.err && r.cls === "fail") errs[r.err] = (errs[r.err] || 0) + 1; }); // 失败的错误（最常见的那句）
      x.err = Object.keys(errs).sort(function (a, b) { return errs[b] - errs[a]; })[0] || "";
      var last = calls.filter(function (r) { return r.svc === x.svc; })[0];
      x.live = Date.now() - x.end < GAP && last && last.cls !== "ok";
    });
    return out.sort(function (a, b) { return b.end - a.end; });
  }
  function incTitle(x) {
    var n = svcName(x.svc);
    return { fail: t(n + "出错", "Errors in " + n), limit: t(n + "被限流", n + " rate limited"), auth: t(n + "要求重新登录", n + " required sign-in"),
      drop: t(n + "连接中断", n + " connection dropped"), slow: t(n + "响应变慢", "Slow responses from " + n) }[x.kind] || n;
  }
  // 一句话说清这一段出了什么事（同 status page 事件下面那句）
  function incText(x) {
    var c = x.c, n = svcName(x.svc), p = [];
    if (c.fail) p.push(t([n + "的 ", ""], [n + ": ", ""]), c.fail === c.n ? t(c.n === 1 ? "1 次调用失败" : c.n + " 次调用全部失败", c.n === 1 ? "the call failed" : "all " + c.n + " calls failed")
      : t(c.n + " 次调用中有 " + c.fail + " 次失败", c.fail + " of " + c.n + " calls failed"));
    if (c.limit) p.push(t([n, ""], [n + ": ", ""]), t("被限流 " + c.limit + " 次", "rate limited " + times(c.limit)) + (x.wait ? t("，最长等待 " + dur(x.wait), ", waited up to " + dur(x.wait)) : ""));
    if (c.auth) p.push(t([n, ""], [n + ": ", ""]), t("要求重新登录 " + c.auth + " 次", "asked to sign in " + times(c.auth)));
    if (c.drop) p.push(t([n + "的", ""], [n + ": ", ""]), t("连接中断 " + c.drop + " 次", "connection dropped " + times(c.drop)));
    if (c.slow) p.push(t([n + "有 ", ""], [n + ": ", ""]), t(c.slow + " 次响应较慢，最长 " + dur(x.mx), c.slow + (c.slow === 1 ? " slow response" : " slow responses") + ", longest " + dur(x.mx)));
    // p 是成对的：[第一段前面接的（带服务名）, 后面几段前面接的], 那一段的话
    var s = "";
    for (var i = 0; i < p.length; i += 2) s += (i ? t("；", "; ") + p[i][1] : p[i][0]) + p[i + 1];
    var err = c.fail ? String(x.err || "").replace(/[\s.。]+$/, "") : "";
    if (err) s += t("，错误：", ". Error: ") + err;
    return s + t("。", ".");
  }

  // ======== 画 ========
  function render(host, P, arg, V) {
    if (!V.ss) {
      V.ss = { range: "24h", svc: "", bad: false, win: null, open: {}, more: 200, data: null, busy: false, again: false };
      host.innerHTML = '<div class="svs"></div><div class="svs-tip" hidden></div>';
      wire(host, V);
    }
    live(host, V, true);
    refresh(host, V);
  }
  // 看着的时候：有新的记录就重画（最多 3 秒一次），每分钟再拉一次服务器的；藏起来、关掉就停
  function live(host, V, on) {
    var ss = V.ss;
    if (!on) { if (ss.off) ss.off(); ss.off = null; clearInterval(ss.tick); ss.tick = 0; clearTimeout(ss.pend); ss.pend = 0; return; }
    if (ss.off) return;
    var soon = function () {
      if (ss.pend || !V.shown()) return;
      ss.pend = setTimeout(function () { ss.pend = 0; ss.last = Date.now(); if (V.shown()) refresh(host, V); }, Math.max(0, 3000 - (Date.now() - (ss.last || 0))));
    };
    ss.off = L.onRec(soon);
    ss.tick = setInterval(function () { if (V.shown()) loadServer().then(soon); }, 60e3);
  }
  function refresh(host, V) {
    var ss = V.ss;
    if (ss.busy) { ss.again = true; return; }
    ss.busy = true;
    load().then(function (d) { ss.data = d; paint(host, V); }, function (e) { console.error(e); }).then(function () { ss.busy = false; if (ss.again) { ss.again = false; if (V.shown()) refresh(host, V); } });
  }
  // 90 根细条：同 status page 的比例（条宽 3、空 2，按卡片的宽拉伸）；一根一个 rect（指着看数、点了只列那一段）
  var VW = NB * 5 - 2, VH = 34;
  function barsSvg(cells, svc, ss) {
    return '<svg class="svs-bars" viewBox="0 0 ' + VW + " " + VH + '" preserveAspectRatio="none">' + cells.map(function (c, i) {
      var sel = ss.win && ss.win.svc === svc && ss.win.from === c.from;
      return '<rect class="svs-b svs-' + c.s + (sel ? " sel" : "") + '" data-svc="' + svc + '" data-i="' + i + '" x="' + i * 5 + '" y="0" width="3" height="' + VH + '" rx="0.5"/>';
    }).join("") + "</svg>";
  }
  var fmtUp = function (u) { return u >= 99.995 ? "100%" : u.toFixed(2) + "%"; };
  function paint(host, V) {
    var ss = V.ss, d = ss.data, root = host.querySelector(".svs");
    if (!d || !root) return;
    var g = grid(ss.range), first = firstSeen(d);
    var svcs = L.services.filter(function (s) { return CORE.indexOf(s.id) >= 0 || first[s.id]; });
    var cur = {}, worst = "up";
    svcs.forEach(function (s) { var c = current(d.calls.filter(function (r) { return r.svc === s.id; }), !!first[s.id]); cur[s.id] = c; if (c.k === "major") worst = "major"; else if (c.k === "partial" && worst !== "major") worst = "partial"; });
    var banner = { up: t("所有服务运行正常", "All Systems Operational"), partial: t("部分服务性能下降", "Degraded Performance"), major: t("部分服务异常", "Partial System Outage") }[worst];
    var h = '<div class="svs-head"><h1>' + esc(t("服务状态", "Service Status")) + "</h1></div>" +
      '<div class="svs-banner svs-' + worst + '"><b>' + esc(banner) + "</b><span>" + esc(t("更新于 ", "Updated ") + hm(d.at)) + "</span></div>" +
      '<div class="svs-range">' + esc(ss.range === "24h" ? t("过去 24 小时的可用率。", "Uptime over the past 24 hours. ") : t("过去 30 天的可用率。", "Uptime over the past 30 days. ")) +
      '<button type="button" data-range="' + (ss.range === "24h" ? "30d" : "24h") + '">' + esc(ss.range === "24h" ? t("查看过去 30 天", "View the past 30 days") : t("查看过去 24 小时", "View the past 24 hours")) + "</button></div>";
    // 每个服务一行
    V.ssBars = {};
    h += '<div class="svs-card">' + svcs.map(function (s) {
      var cells = V.ssBars[s.id] = fill(g, d, s.id, first[s.id]), tot = ZERO(), c = cur[s.id], has = !!first[s.id];
      cells.forEach(function (x) { plus(tot, x.a); });
      var up = has ? (tot.n ? fmtUp(100 * (1 - tot.fail / tot.n)) : "100%") + t(" 可用", " uptime") : t("无记录", "No data");
      return '<div class="svs-svc' + (ss.svc === s.id ? " on" : "") + (ss.win && ss.win.svc === s.id ? " svs-picked" : "") + '" data-svc="' + s.id + '">' +
        '<div class="svs-r1"><button type="button" class="svs-name" data-pick="' + s.id + '">' + esc(svcName(s.id)) + '</button><span class="svs-st svs-' + c.k + '">' + esc(c.text) + "</span></div>" +
        barsSvg(cells, s.id, ss) +
        '<div class="svs-axis"><span>' + esc(ss.range === "24h" ? t("24 小时前", "24 hours ago") : t("30 天前", "30 days ago")) + "</span><i></i><span>" + esc(up) + "</span><i></i><span>" + esc(ss.range === "24h" ? t("现在", "Now") : t("今天", "Today")) + "</span></div></div>";
    }).join("") + "</div>";
    // 过往事件：最近 7 天每天一段（没有就写没有），更早的有事件的那几天（30 天里）也列出来
    var incs = incidents(d.calls.filter(function (r) { return r.at >= (ss.range === "24h" ? dayBack(Date.now(), 6) : g.start); }));
    var today = dayStart(Date.now()), days = {}, order = [];
    incs.forEach(function (x) { var k = dayStart(x.end); (days[k] = days[k] || []).push(x); });
    for (var i = 0; i < 7; i++) order.push(dayBack(today, i));
    Object.keys(days).map(Number).forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
    order.sort(function (a, b) { return b - a; });
    h += '<h2 class="svs-h2">' + esc(t("过往事件", "Past Incidents")) + "</h2>" + order.map(function (k) {
      var l = days[k] || [];
      return '<div class="svs-day"><h3>' + esc(md(k)) + "</h3>" + (l.length ? l.map(function (x) { return incHtml(x, V); }).join("") :
        '<p class="svs-noinc">' + esc(k === today ? t("今天没有事件。", "No incidents reported today.") : t("没有事件。", "No incidents reported.")) + "</p>") + "</div>";
    }).join("");
    // 调用记录
    var list = d.calls.filter(function (r) { return r.at >= g.start && (!ss.svc || r.svc === ss.svc) && (!ss.bad || r.cls !== "ok") && (!ss.win || (r.svc === ss.win.svc && r.at >= ss.win.from && r.at < ss.win.to)); });
    h += '<h2 class="svs-h2">' + esc(t("调用记录", "Calls")) + '</h2><div class="svs-filter">' +
      [""].concat(svcs.map(function (s) { return s.id; })).map(function (id) { return '<button type="button" class="svs-chip' + (ss.svc === id && !ss.win ? " on" : "") + '" data-pick="' + id + '">' + esc(id ? svcName(id) : t("全部", "All")) + "</button>"; }).join("") +
      (ss.win ? '<button type="button" class="svs-chip on svs-winchip" data-clearwin>' + esc(svcName(ss.win.svc) + " · " + (ss.range === "24h" ? hm(ss.win.from) + " – " + hm(ss.win.to) : md(ss.win.from) + " " + hm(ss.win.from) + " – " + hm(ss.win.to))) + CLOSE + "</button>" : "") +
      '<label class="svs-tg"><input type="checkbox" data-bad' + (ss.bad ? " checked" : "") + ">" + esc(t("只看异常", "Problems only")) + "</label></div>";
    h += list.length ? '<div class="svs-calls"><div class="svs-row svs-th"><span>' + esc(t("时间", "Time")) + "</span><span>" + esc(t("服务", "Service")) + "</span><span>" + esc(t("操作", "Operation")) + "</span><span>" + esc(t("用时", "Duration")) + "</span><span>" + esc(t("结果", "Result")) + "</span></div>" +
      rowsHtml(list.slice(0, ss.more), V, "c") + "</div>" + (list.length > ss.more ? '<button type="button" class="svs-more" data-more>' + esc(t("再显示 200 条（共 " + list.length + " 条）", "Show 200 more (" + list.length + " total)")) + "</button>" : "")
      : '<p class="svs-noinc">' + esc(t("没有记录。", "No records.")) + "</p>";
    var sc = host.scrollTop;
    root.innerHTML = h;
    host.scrollTop = sc;
  }
  // 一件事件：标题（按严重程度着色，点了看那几次调用）、一句话（已恢复 / 进行中 - …）、时间
  function incHtml(x, V) {
    var ss = V.ss, k = "inc:" + x.svc + ":" + x.start, open = !!ss.open[k];
    var span = x.end - x.start, tm = span >= 60e3 ? hm(x.start) + " – " + hm(x.end) + " · " + dur(span) : hm(x.start, true);
    if (!sameDay(x.start, x.end)) tm = md(x.start) + " " + tm;
    return '<div class="svs-inc' + (open ? " open" : "") + '"><button type="button" class="svs-incT svs-' + x.sev + '" data-open="' + esc(k) + '">' + esc(incTitle(x)) + "</button>" +
      '<p class="svs-incB"><b>' + esc(x.live ? t("进行中", "Ongoing") : t("已恢复", "Resolved")) + "</b> - " + esc(incText(x)) + "</p>" +
      '<p class="svs-incD">' + esc(tm + " · " + t(x.list.length + " 次调用", x.list.length + (x.list.length === 1 ? " call" : " calls"))) + "</p>" +
      (open ? '<div class="svs-incL">' + rowsHtml(x.list.slice().reverse().slice(0, 100), V, k) + "</div>" : "") + "</div>";
  }
  function rowsHtml(list, V, pre) {
    var ss = V.ss;
    return list.map(function (r) {
      var k = pre + ":" + r.svc + ":" + r.at + ":" + r.op, open = !!ss.open[k];
      return '<div class="svs-call' + (open ? " open" : "") + '"><button type="button" class="svs-row svs-' + sevOfCls(r.cls) + '" data-open="' + esc(k) + '"><span>' + esc(when(r.at)) + "</span><span>" + esc(svcName(r.svc)) + "</span><span>" + esc(opName(r)) + (r.n ? '<span class="svs-dim"> · ' + esc(t(r.n + " 条", r.n + (r.n === 1 ? " item" : " items"))) + "</span>" : "") + "</span><span>" + esc(dur(r.ms)) + '</span><span class="svs-res">' + esc(result(r)) + "</span></button>" +
        (open ? detail(r) : "") + "</div>";
    }).join("");
  }
  function detail(r) {
    var f = [], i = r.info || {};
    var add = function (k, v) { if (v !== undefined && v !== null && v !== "") f.push([k, v]); };
    add(t("时间", "Time"), full(r.at));
    add(t("服务", "Service"), svcName(r.svc));
    add(t("请求", "Request"), r.svc === "translate" ? "POST /api/translate" + (r.op === "reply" ? " (reply)" : "") : r.op);
    add(t("结果", "Result"), CLS_NAME(r.cls) + (r.st ? " · " + r.st : ""));
    add(/^WS /.test(r.op) && i.ev === "close" ? t("连接时长", "Connected for") : t("用时", "Duration"), dur(r.ms));
    if (i.upMs != null) add(t("其中等模型", "Waiting for model"), dur(i.upMs));
    if (i.upSt != null) add(t("模型返回", "Model status"), i.upSt);
    if (r.n) add(t("条数", "Items"), r.n);
    if (i.cached != null) add(t("缓存命中", "Cache hits"), i.cached);
    if (i.translated != null) add(t("新翻译", "Translated"), i.translated);
    if (i.wait) add(t("服务器要求等待", "Retry after"), dur(i.wait));
    add(t("模型", "Model"), i.model);
    add(t("语言", "Language"), i.lang);
    if (i.dev) add(t("设备", "Device"), devName(i.dev));
    // 往 Claude Code 的会话里送的那一句（claude.js）：哪个会话、送的什么、第几次送、之前没送成几次
    if (r.svc === "cc") { add(t("会话", "Session"), i.session); add(t("内容", "Message"), i.text); if (i.tries > 1) add(t("第几次送", "Attempt"), i.tries); if (i.fails) add(t("之前没送成", "Earlier failures"), i.fails); }
    add(t("记录来源", "Recorded by"), r.src === "server" ? t("服务器", "Server") : t("这台设备", "This device"));
    add(t("错误", "Error"), r.err);
    if (i.note) add(t("备注", "Note"), i.note);
    return '<dl class="svs-det">' + f.map(function (x) { return "<dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1]) + "</dd>"; }).join("") + "</dl>";
  }

  // ---- 交互 ----
  function wire(host, V) {
    var ss = V.ss, tip = host.querySelector(".svs-tip");
    host.addEventListener("click", function (e) {
      var b = e.target.closest("button, input");
      if (!b || !host.contains(b)) return;
      if (b.dataset.range) { ss.range = b.dataset.range; ss.win = null; return paint(host, V); }
      if (b.hasAttribute("data-bad")) { ss.bad = b.checked; return paint(host, V); }
      if (b.dataset.pick != null) { ss.svc = ss.svc === b.dataset.pick && b.classList.contains("svs-name") ? "" : b.dataset.pick; ss.win = null; ss.more = 200; return paint(host, V); }
      if (b.hasAttribute("data-clearwin")) { ss.win = null; return paint(host, V); }
      if (b.hasAttribute("data-more")) { ss.more += 200; return paint(host, V); }
      if (b.dataset.open) { var k = b.dataset.open; if (ss.open[k]) delete ss.open[k]; else ss.open[k] = 1; return paint(host, V); }
    });
    // 点一根：下面只列那一段时间、那个服务的调用（再点一次取消）
    host.addEventListener("click", function (e) {
      var g = e.target.closest(".svs-b");
      if (!g) return;
      var b = (V.ssBars[g.dataset.svc] || [])[+g.dataset.i];
      if (!b) return;
      ss.win = ss.win && ss.win.svc === g.dataset.svc && ss.win.from === b.from ? null : { svc: g.dataset.svc, from: b.from, to: b.to };
      ss.svc = ""; ss.more = 200; tip.hidden = true;
      paint(host, V);
      var c = host.querySelector(".svs-filter");
      if (ss.win && c) c.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    // 指着一根：那一段的数
    host.addEventListener("mouseover", function (e) {
      var g = e.target.closest(".svs-b");
      if (!g) { tip.hidden = true; return; }
      var b = (V.ssBars[g.dataset.svc] || [])[+g.dataset.i];
      if (!b) return;
      var a = b.a, head = (ss.range === "24h" && sameDay(b.from, Date.now()) ? "" : md(b.from) + " ") + hm(b.from) + " – " + hm(b.to);
      var scope = g.dataset.svc === "translate" && ss.data && ss.data.server ? t("所有设备", "All devices") : t("这台设备", "This device");
      var parts = a.n ? [t(a.n + " 次调用", a.n + (a.n === 1 ? " call" : " calls"))].concat(a.fail ? [t("失败 ", "Failed ") + a.fail] : [], a.limit ? [t("受限 ", "Limited ") + a.limit] : [], a.auth ? [t("需要登录 ", "Sign-in ") + a.auth] : [], a.drop ? [t("断开 ", "Dropped ") + a.drop] : [], a.slow ? [t("较慢 ", "Slow ") + a.slow] : [])
        : [b.s === "none" ? t("开始记录之前", "Before recording began") : t("没有调用", "No calls")];
      tip.innerHTML = "<b>" + esc(svcName(g.dataset.svc)) + "</b><span>" + esc(head) + "</span><span>" + esc(parts.join(" · ")) + "</span>" +
        (a.n ? "<span>" + esc(t("平均 ", "Avg ") + dur(a.ms / a.n) + " · " + t("最长 ", "Max ") + dur(a.mx)) + "</span>" : "") + '<span class="svs-tipd">' + esc(scope) + "</span>";
      tip.hidden = false;
      var r = g.getBoundingClientRect(), hr = host.getBoundingClientRect(), w = tip.offsetWidth;
      tip.style.left = Math.max(8, Math.min(hr.width - w - 8, r.left - hr.left + r.width / 2 - w / 2)) + "px";
      tip.style.top = r.bottom - hr.top + host.scrollTop + 10 + "px";
    });
    host.addEventListener("mouseleave", function () { tip.hidden = true; });
  }

  S.pages.status = {
    title: function () { return t("服务状态", "Service Status"); },
    address: function () { return "status.local.paimon"; },
    icon: function () { return TAB_ICON; },
    render: render,
    detach: function (host, P, arg, V) { var tip = host.querySelector(".svs-tip"); if (tip) tip.hidden = true; if (V.ss) live(host, V, false); },
  };
  // 「App」里一格
  if (S.apps && S.apps.add) S.apps.add({
    id: "status", builtin: true, name: function () { return t("服务状态", "Service Status"); },
    logo: function () { return LOGO; },
    find: function (tw) { var hit = null; (tw && tw.ws && tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (!hit && p.program && p.program.page === "status") hit = p; }); return hit; },
    open: function (tw) { return S.openPage(tw, "status", ""); },
  });
})();
