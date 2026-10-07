// status.js —— 「服务状态」App（同 status.claude.com）：每个服务一行——现在怎样、可用率、一排格子（24 小时每小时一格 / 30 天每天一格；
//   绿 = 正常，黄 = 慢、限流、要登录、连接断过，红 = 失败多，灰 = 没有调用；指上去看那一格的数，点一下下面只列那一段的调用）；
//   下面是事件（同一个服务一段时间里连着出问题的那些，点开看是哪几次）、调用记录（点一条看详情）。
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

  // ---- 图标（SVG）----
  var SV = function (b) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + b + "</svg>"; };
  var IC = {
    ok: SV('<circle cx="8" cy="8" r="6.2"/><path d="M5.3 8.2l1.9 1.9 3.6-3.8"/>'),
    warn: SV('<path d="M8 2.3l6.2 10.8H1.8z"/><path d="M8 6.6v3.1M8 11.5v.01"/>'),
    bad: SV('<circle cx="8" cy="8" r="6.2"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/>'),
    chev: SV('<path d="M6 4l4 4-4 4"/>'),
    close: SV('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'),
  };
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
    if (ms < 60e3) return (ms / 1000).toFixed(ms < 10e3 ? 1 : 0) + " s";
    var m = Math.floor(ms / 60e3), s = Math.round((ms % 60e3) / 1000);
    if (m >= 60) { var h = Math.floor(m / 60); m %= 60; return en() ? h + " h " + m + " min" : h + " 小时 " + m + " 分"; }
    return en() ? m + " min " + s + " s" : m + " 分 " + s + " 秒";
  }
  var dayStart = function (at) { var d = new Date(at); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
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
  function sev(a) {
    if (!a || !a.n) return "none";
    if (a.fail && a.fail / a.n >= 0.25) return "bad";
    if (a.fail || a.limit || a.auth || a.drop || a.slow / a.n >= 0.2) return "warn";
    return "ok";
  }
  // 格子：24 小时（每小时）或 30 天（每天，按本地日期）
  function buckets(range) {
    var now = Date.now(), out = [];
    if (range === "24h") { var h0 = Math.floor(now / HOUR) * HOUR; for (var i = 23; i >= 0; i--) out.push({ from: h0 - i * HOUR, to: h0 - i * HOUR + HOUR }); }
    else { var d = new Date(dayStart(now)); for (var j = 29; j >= 0; j--) { var a = new Date(d.getFullYear(), d.getMonth(), d.getDate() - j).getTime(), b = new Date(d.getFullYear(), d.getMonth(), d.getDate() - j + 1).getTime(); out.push({ from: a, to: b }); } }
    return out;
  }
  function fill(bs, hours, svc) {
    return bs.map(function (b) { var a = ZERO(); hours.forEach(function (h) { if (h.svc === svc && h.h >= b.from && h.h < b.to) plus(a, h); }); return { from: b.from, to: b.to, a: a, s: sev(a) }; });
  }
  // 现在：最近 15 分钟
  function current(list) {
    var since = Date.now() - NOW_WIN, rc = list.filter(function (r) { return r.at >= since; });
    if (!rc.length) return { k: "idle", text: list.length ? t("空闲", "Idle") : t("无记录", "No data"), last: list[0] ? list[0].at : 0 };
    var c = ZERO(); rc.forEach(function (r) { c.n++; c[r.cls]++; });
    if (rc[0].cls === "fail") return { k: "bad", text: t("异常", "Failing") };
    if (c.fail) return { k: "warn", text: t("部分失败", "Partial failures") };
    if (c.limit) return { k: "warn", text: t("受限", "Rate limited") };
    if (rc[0].cls === "auth") return { k: "warn", text: t("需要登录", "Sign-in required") };
    if (c.drop) return { k: "warn", text: t("连接中断过", "Connection dropped") };
    if (c.slow / c.n >= 0.3) return { k: "warn", text: t("较慢", "Slow") };
    return { k: "ok", text: t("正常", "Operational") };
  }
  // 事件：同一个服务里不正常的调用，前后隔不到 5 分钟的连成一段；有失败、或者不正常的有两次以上才算
  function incidents(calls) {
    var by = {}, out = [];
    calls.forEach(function (r) { if (r.cls !== "ok") (by[r.svc] = by[r.svc] || []).push(r); });
    Object.keys(by).forEach(function (svc) {
      var l = by[svc].slice().sort(function (a, b) { return a.at - b.at; }), cur = null;
      var close = function () { if (cur && (cur.c.fail || cur.list.length >= 2)) out.push(cur); cur = null; };
      l.forEach(function (r) {
        var end = r.at + (/^WS /.test(r.op) ? 0 : r.ms);
        if (cur && r.at - cur.end > GAP) close();
        if (!cur) cur = { svc: svc, start: r.at, end: end, list: [], c: ZERO() };
        cur.list.push(r); cur.c.n++; cur.c[r.cls]++; cur.end = Math.max(cur.end, end);
      });
      close();
    });
    out.forEach(function (x) {
      var top = ["fail", "limit", "auth", "drop", "slow"].filter(function (k) { return x.c[k]; })[0];
      x.kind = top; x.s = x.c.fail ? "bad" : "warn";
      var errs = {}; x.list.forEach(function (r) { if (r.err) errs[r.err] = (errs[r.err] || 0) + 1; });
      x.err = Object.keys(errs).sort(function (a, b) { return errs[b] - errs[a]; })[0] || "";
      var last = calls.filter(function (r) { return r.svc === x.svc; })[0];
      x.live = Date.now() - x.end < GAP && last && last.cls !== "ok";
    });
    return out.sort(function (a, b) { return b.end - a.end; });
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
  function paint(host, V) {
    var ss = V.ss, d = ss.data, root = host.querySelector(".svs");
    if (!d || !root) return;
    var bs = buckets(ss.range), from = bs[0].from;
    var used = {}; d.calls.forEach(function (r) { used[r.svc] = 1; }); d.hours.forEach(function (a) { if (a.n) used[a.svc] = 1; });
    var svcs = L.services.filter(function (s) { return CORE.indexOf(s.id) >= 0 || used[s.id]; });
    var cur = {}, worst = "ok";
    svcs.forEach(function (s) { var c = current(d.calls.filter(function (r) { return r.svc === s.id; })); cur[s.id] = c; if (c.k === "bad") worst = "bad"; else if (c.k === "warn" && worst !== "bad") worst = "warn"; });
    var banner = worst === "bad" ? t("部分服务异常", "Some services are failing") : worst === "warn" ? t("部分服务性能下降", "Degraded performance") : t("所有服务运行正常", "All services operational");
    var h = '<div class="svs-head"><h1>' + esc(t("服务状态", "Service Status")) + '</h1><div class="svs-seg" role="tablist">' +
      [["24h", t("24 小时", "24 hours")], ["30d", t("30 天", "30 days")]].map(function (x) { return '<button type="button" role="tab" data-range="' + x[0] + '"' + (ss.range === x[0] ? ' class="on" aria-selected="true"' : "") + ">" + esc(x[1]) + "</button>"; }).join("") + "</div></div>" +
      '<div class="svs-banner svs-' + worst + '">' + IC[worst] + "<b>" + esc(banner) + '</b><span class="svs-dim">' + esc(t("更新于 ", "Updated ") + hm(d.at, true)) + "</span></div>";
    // 每个服务一行
    V.ssBars = {};
    svcs.forEach(function (s) { V.ssBars[s.id] = fill(bs, d.hours, s.id); });
    h += '<div class="svs-list">' + svcs.map(function (s) {
      var bars = V.ssBars[s.id], tot = ZERO();
      bars.forEach(function (b) { plus(tot, b.a); });
      var up = tot.n ? (100 * (1 - tot.fail / tot.n)) : null, c = cur[s.id];
      var scope = s.id === "translate" && d.server ? t("所有设备", "All devices") : t("这台设备", "This device");
      return '<div class="svs-svc' + (ss.svc === s.id ? " on" : "") + '" data-svc="' + s.id + '"><div class="svs-r1"><button type="button" class="svs-name" data-pick="' + s.id + '">' + esc(svcName(s.id)) + "</button>" +
        '<span class="svs-scope">' + esc(scope) + "</span>" +
        '<span class="svs-up">' + (up == null ? "" : esc(t("可用率 ", "Uptime ") + (up >= 99.95 ? "100" : up.toFixed(up >= 99 ? 2 : 1)) + "%")) + "</span>" +
        '<span class="svs-now svs-' + c.k + '"><i class="svs-dot"></i>' + esc(c.text) + (c.k === "idle" && c.last ? '<span class="svs-dim"> · ' + esc(t("上次 ", "Last ") + when(c.last)) + "</span>" : "") + "</span></div>" +
        '<div class="svs-bars">' + bars.map(function (b, i) { return '<i class="svs-b svs-' + b.s + (ss.win && ss.win.svc === s.id && ss.win.from === b.from ? " sel" : "") + '" data-svc="' + s.id + '" data-i="' + i + '"></i>'; }).join("") + "</div>" +
        '<div class="svs-axis"><span>' + esc(ss.range === "24h" ? t("24 小时前", "24 hours ago") : t("30 天前", "30 days ago")) + "</span><span>" + esc(t("现在", "Now")) + "</span></div></div>";
    }).join("") + "</div>";
    // 事件
    var incs = incidents(d.calls.filter(function (r) { return r.at >= from; }));
    V.ssIncs = incs;
    h += '<h2 class="svs-h2">' + esc(t("事件", "Incidents")) + "</h2>";
    h += incs.length ? '<div class="svs-incs">' + incs.slice(0, 60).map(function (x, i) {
      var k = "inc:" + x.svc + ":" + x.start, open = !!ss.open[k];
      return '<div class="svs-inc svs-' + x.s + (open ? " open" : "") + '"><button type="button" class="svs-incH" data-open="' + esc(k) + '">' + IC.chev + IC[x.s] +
        '<span class="svs-incT"><span class="svs-l1"><b>' + esc(svcName(x.svc) + " · " + CLS_NAME(x.kind)) + "</b>" + (x.live ? '<span class="svs-live">' + esc(t("进行中", "Ongoing")) + "</span>" : "") + "</span>" +
        '<span class="svs-dim">' + esc(when(x.start) + " – " + hm(x.end, true) + " · " + dur(x.end - x.start) + " · " + t(x.list.length + " 次", x.list.length + (x.list.length === 1 ? " call" : " calls"))) + "</span>" +
        (x.err ? '<span class="svs-err">' + esc(x.err) + "</span>" : "") + "</span></button>" +
        (open ? '<div class="svs-incL">' + rowsHtml(x.list.slice().reverse().slice(0, 100), V, "i" + i) + "</div>" : "") + "</div>";
    }).join("") + "</div>" : '<div class="svs-empty">' + esc(ss.range === "24h" ? t("过去 24 小时没有事件", "No incidents in the past 24 hours") : t("过去 30 天没有事件", "No incidents in the past 30 days")) + "</div>";
    // 调用记录
    var list = d.calls.filter(function (r) { return r.at >= from && (!ss.svc || r.svc === ss.svc) && (!ss.bad || r.cls !== "ok") && (!ss.win || (r.svc === ss.win.svc && r.at >= ss.win.from && r.at < ss.win.to)); });
    h += '<h2 class="svs-h2">' + esc(t("调用记录", "Calls")) + '</h2><div class="svs-filter">' +
      [""].concat(svcs.map(function (s) { return s.id; })).map(function (id) { return '<button type="button" class="svs-chip' + (ss.svc === id ? " on" : "") + '" data-pick="' + id + '">' + esc(id ? svcName(id) : t("全部", "All")) + "</button>"; }).join("") +
      '<label class="svs-tg"><input type="checkbox" data-bad' + (ss.bad ? " checked" : "") + ">" + esc(t("只看异常", "Problems only")) + "</label>" +
      (ss.win ? '<button type="button" class="svs-chip on svs-winchip" data-clearwin>' + esc(svcName(ss.win.svc) + " · " + (ss.range === "24h" ? hm(ss.win.from) + "–" + hm(ss.win.to) : md(ss.win.from))) + IC.close + "</button>" : "") + "</div>";
    h += list.length ? '<div class="svs-calls"><div class="svs-row svs-th"><span>' + esc(t("时间", "Time")) + "</span><span>" + esc(t("服务", "Service")) + "</span><span>" + esc(t("操作", "Operation")) + "</span><span>" + esc(t("用时", "Duration")) + "</span><span>" + esc(t("结果", "Result")) + "</span></div>" +
      rowsHtml(list.slice(0, ss.more), V, "c") + "</div>" + (list.length > ss.more ? '<button type="button" class="svs-more" data-more>' + esc(t("再显示 200 条（共 " + list.length + " 条）", "Show 200 more (" + list.length + " total)")) + "</button>" : "")
      : '<div class="svs-empty">' + esc(t("没有记录", "No records")) + "</div>";
    var sc = host.scrollTop;
    root.innerHTML = h;
    host.scrollTop = sc;
  }
  function rowsHtml(list, V, pre) {
    var ss = V.ss;
    return list.map(function (r, i) {
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
    // 点一格：下面只列那一段时间、那个服务的调用
    host.addEventListener("click", function (e) {
      var g = e.target.closest(".svs-b");
      if (!g) return;
      var b = (V.ssBars[g.dataset.svc] || [])[+g.dataset.i];
      if (!b) return;
      ss.win = ss.win && ss.win.svc === g.dataset.svc && ss.win.from === b.from ? null : { svc: g.dataset.svc, from: b.from, to: b.to };
      ss.svc = ""; ss.more = 200;
      paint(host, V);
      var c = host.querySelector(".svs-filter");
      if (ss.win && c) c.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    // 指着一格：那一段的数
    host.addEventListener("mouseover", function (e) {
      var g = e.target.closest(".svs-b");
      if (!g) { tip.hidden = true; return; }
      var b = (V.ssBars[g.dataset.svc] || [])[+g.dataset.i];
      if (!b) return;
      var a = b.a, head = ss.range === "24h" ? (sameDay(b.from, Date.now()) ? "" : md(b.from) + " ") + hm(b.from) + "–" + hm(b.to) : md(b.from);
      var parts = a.n ? [t(a.n + " 次调用", a.n + (a.n === 1 ? " call" : " calls"))].concat(a.fail ? [t("失败 ", "Failed ") + a.fail] : [], a.limit ? [t("受限 ", "Limited ") + a.limit] : [], a.auth ? [t("需要登录 ", "Sign-in ") + a.auth] : [], a.drop ? [t("断开 ", "Dropped ") + a.drop] : [], a.slow ? [t("较慢 ", "Slow ") + a.slow] : []) : [t("没有调用", "No calls")];
      tip.innerHTML = "<b>" + esc(svcName(g.dataset.svc) + " · " + head) + "</b><span>" + esc(parts.join(" · ")) + "</span>" + (a.n ? "<span>" + esc(t("平均 ", "Avg ") + dur(a.ms / a.n) + " · " + t("最长 ", "Max ") + dur(a.mx)) + "</span>" : "");
      tip.hidden = false;
      var r = g.getBoundingClientRect(), hr = host.getBoundingClientRect(), w = tip.offsetWidth;
      tip.style.left = Math.max(8, Math.min(hr.width - w - 8, r.left - hr.left + r.width / 2 - w / 2)) + "px";
      tip.style.top = r.bottom - hr.top + host.scrollTop + 8 + "px";
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
