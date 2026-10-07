// svclog.js —— 服务记录：这台设备上每一次叫服务（翻译、同步、中转、账户、Paimon 的模型、搜索、更新检查……）是什么时候、用了多久、结果怎样。「服务状态」页（status.js）照它画。
//   怎么记：包一层 fetch（只记站内的 /api/、/auth/ 和版本、更新那几个文件，别的原样放过）、WebSocket（中转：连上、断开）；
//     翻译自己记（translate.js：带上条数、缓存命中、限流等多久），它的 fetch 带 svclog: false，这里不重复记。自己取消的请求（AbortError）不记。
//   存哪：IndexedDB（库 tsu-svclog）。calls：每一次一条（最多 20000 条、30 天，满了删最早的）；
//     hours：每个服务每小时一行汇总（30 天，画 30 天那条用；calls 删掉以后它还在）。攒着写（2 秒一次，页面藏起、关掉时马上写）；
//     几个窗口同一个库，各记各的。打不开 IndexedDB：只在内存里留最近 2000 条。
//   一条：{ at 开始的时间, svc 服务, op 方法 + 路径, ms 多久（到响应头；WebSocket 断开那条是连了多久）, st HTTP 状态（0 = 没连上、超时；WebSocket 断开是关闭码）,
//     cls 结果（ok | slow 慢 | limit 限流 | auth 要登录 | drop 连接断了 | fail 失败）, err 错误, n 几条, info 其他 }
//   TSU_SVCLOG：rec(条)、services、calls({ since, limit }) → Promise（新的在前）、hours(since) → Promise、onRec(fn) → 取消、flush()
(function () {
  "use strict";
  if (window.TSU_SVCLOG) return;
  var CAP = 20000, MEMCAP = 2000, KEEP = 30 * 864e5, HOUR = 3600e3, FIELDS = ["n", "ok", "slow", "limit", "auth", "drop", "fail", "ms"];
  // 服务：id、名字、多久算慢（毫秒）
  var SVCS = [
    { id: "translate", zh: "翻译", en: "Translation", slow: 20000 },
    { id: "sync", zh: "同步", en: "Sync", slow: 5000 },
    { id: "relay", zh: "远程 Mac 中转", en: "Remote Mac Relay", slow: 5000 },
    { id: "account", zh: "登录与账户", en: "Sign-in and Account", slow: 5000 },
    { id: "model", zh: "Paimon 模型", en: "Paimon Model", slow: 20000 },
    { id: "tools", zh: "搜索与网页读取", en: "Search and Web Fetch", slow: 15000 },
    { id: "sandbox", zh: "云端环境", en: "Cloud Sandbox", slow: 10000 },
    { id: "update", zh: "版本与更新", en: "Version and Updates", slow: 8000 },
  ];
  var BY = {};
  SVCS.forEach(function (s) { BY[s.id] = s; });

  // ---- 哪个服务：同一个站（或 code.paimon.beer）上的这些路径 ----
  function where(u) {
    try { var x = new URL(u, location.href); return x.host === location.host || /(^|\.)paimon\.beer$/.test(x.hostname) ? x.pathname : null; } catch (e) { return null; }
  }
  function svcOf(p) {
    if (!p) return null;
    if (p === "/api/translate") return "translate";
    if (/^\/api\/(sync|store|lease|devices|notices)$/.test(p)) return "sync";
    if (/^\/api\/relay\//.test(p)) return "relay";
    if (/^\/api\/(me|usage|stats|passkeys)$/.test(p) || /^\/api\/passkey\//.test(p) || /^\/auth\//.test(p)) return "account";
    if (p === "/api/chat") return "model";
    if (/^\/api\/tools\//.test(p)) return "tools";
    if (/^\/api\/sbx\//.test(p)) return "sandbox";
    if (p === "/api/version" || /\/(version|builds)\.json$/.test(p) || /^\/downloads\/[\w.-]+\.json$/.test(p)) return "update";
    return null;
  }
  function clsOf(r) {
    var s = BY[r.svc];
    if (r.st === 429) return "limit";
    if (r.st === 401 || r.st === 402 || r.st === 403) return "auth";
    if (r.st === 0 || r.st >= 400 || r.err) return "fail";
    return s && r.ms > s.slow ? "slow" : "ok";
  }
  // 出错的响应里那句话：JSON 的 error / message；网页（Cloudflare 的错误页）取标题
  function errOf(tx, r) {
    tx = String(tx || "");
    try { var j = JSON.parse(tx); if (j && (j.error || j.message)) return String(j.error || j.message); } catch (e) { /* 不是 JSON */ }
    var m = /<title>([^<]*)<\/title>/i.exec(tx);
    if (m) return m[1].trim();
    return (tx.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || (r && r.statusText) || "").slice(0, 200);
  }

  // ======== 存 ========
  var dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (ok) {
      if (!window.indexedDB) return ok(null);
      var q;
      try { q = indexedDB.open("tsu-svclog", 1); } catch (e) { return ok(null); }
      q.onupgradeneeded = function () { var d = q.result; d.createObjectStore("calls", { keyPath: "id", autoIncrement: true }).createIndex("at", "at"); d.createObjectStore("hours", { keyPath: "k" }); };
      q.onsuccess = function () { ok(q.result); };
      q.onerror = q.onblocked = function () { ok(null); };
    });
    return dbP;
  }
  var BUF = [], RING = [], subs = [], ft = 0, writes = 0;
  function rec(e) {
    if (!e || !BY[e.svc]) return null;
    var r = { at: e.at || Date.now(), svc: e.svc, op: String(e.op || ""), ms: Math.max(0, Math.round(e.ms || 0)), st: e.st | 0, err: e.err ? String(e.err).slice(0, 300) : "", n: e.n | 0 };
    if (e.info) r.info = e.info;
    r.cls = e.cls || clsOf(r);
    BUF.push(r);
    RING.push(r);
    if (RING.length > MEMCAP) RING.splice(0, RING.length - MEMCAP);
    if (!ft) ft = setTimeout(flush, 2000);
    subs.slice().forEach(function (fn) { try { fn(r); } catch (x) { console.error(x); } });
    return r;
  }
  function blank(svc, h) { return { k: svc + "|" + h, svc: svc, h: h, n: 0, ok: 0, slow: 0, limit: 0, auth: 0, drop: 0, fail: 0, ms: 0, mx: 0 }; }
  function addTo(a, r) { a.n++; a[r.cls] = (a[r.cls] || 0) + 1; a.ms += r.ms; a.mx = Math.max(a.mx, r.ms); }
  function flush() {
    clearTimeout(ft); ft = 0;
    if (!BUF.length) return Promise.resolve();
    var list = BUF;
    BUF = [];
    return db().then(function (d) {
      if (!d) return;
      return new Promise(function (ok) {
        var tx;
        try { tx = d.transaction(["calls", "hours"], "readwrite"); } catch (e) { return ok(); }
        var cs = tx.objectStore("calls"), hs = tx.objectStore("hours"), agg = {};
        list.forEach(function (r) { cs.add(r); var h = Math.floor(r.at / HOUR) * HOUR, k = r.svc + "|" + h; addTo(agg[k] || (agg[k] = blank(r.svc, h)), r); });
        // 同一小时那一行：读出来加上再写回（同一个事务里，几个窗口一起写也不会丢）
        Object.keys(agg).forEach(function (k) {
          var g = hs.get(k);
          g.onsuccess = function () { var o = g.result, a = agg[k]; if (!o) return hs.put(a); FIELDS.forEach(function (f) { o[f] = (o[f] || 0) + a[f]; }); o.mx = Math.max(o.mx || 0, a.mx); hs.put(o); };
        });
        tx.oncomplete = function () { writes += list.length; if (writes >= 500) { writes = 0; prune(d); } ok(); };
        tx.onerror = tx.onabort = function () { ok(); };
      });
    }, function () {});
  }
  // 删掉 30 天以前的；calls 还超过 20000 条就从最早的删到 18000
  function prune(d) {
    var old = Date.now() - KEEP, tx;
    try { tx = d.transaction(["calls", "hours"], "readwrite"); } catch (e) { return; }
    var c1 = tx.objectStore("calls").index("at").openCursor(IDBKeyRange.upperBound(old));
    c1.onsuccess = function () { var c = c1.result; if (c) { c.delete(); c.continue(); } };
    var c2 = tx.objectStore("hours").openCursor();
    c2.onsuccess = function () { var c = c2.result; if (!c) return; if (c.value.h < old - HOUR) c.delete(); c.continue(); };
    tx.oncomplete = function () {
      var t2 = d.transaction("calls", "readwrite"), cs = t2.objectStore("calls"), n = cs.count();
      n.onsuccess = function () {
        var extra = n.result - Math.floor(CAP * 0.9);
        if (n.result <= CAP || extra <= 0) return;
        var c3 = cs.openCursor();
        c3.onsuccess = function () { var c = c3.result; if (!c || extra-- <= 0) return; c.delete(); c.continue(); };
      };
    };
  }
  window.addEventListener("pagehide", function () { flush(); });
  document.addEventListener("visibilitychange", function () { if (document.hidden) flush(); });
  db().then(function (d) { if (d) prune(d); });

  // ======== 读（服务状态页）========
  // since 起（毫秒），新的在前，最多 limit 条；还没写进库的那些也在里面
  function calls(o) {
    o = o || {};
    var since = o.since || 0, limit = o.limit || 5000, fresh = BUF.filter(function (r) { return r.at >= since; }).reverse();
    return db().then(function (d) {
      if (!d) return RING.filter(function (r) { return r.at >= since; }).reverse().slice(0, limit);
      return new Promise(function (ok) {
        var out = fresh.slice(0, limit), tx;
        try { tx = d.transaction("calls", "readonly"); } catch (e) { return ok(out); }
        var c = tx.objectStore("calls").index("at").openCursor(IDBKeyRange.lowerBound(since), "prev");
        c.onsuccess = function () { var x = c.result; if (!x || out.length >= limit) return; out.push(x.value); x.continue(); };
        tx.oncomplete = tx.onerror = tx.onabort = function () { ok(out); };
      });
    }, function () { return []; });
  }
  // 每个服务每小时的汇总（since 起）；还没写进库的加进去
  function hours(since) {
    since = since || 0;
    var add = function (list) {
      var m = {};
      list.forEach(function (a) { if (a.h >= since) m[a.k] = Object.assign({}, a); });
      BUF.forEach(function (r) { var h = Math.floor(r.at / HOUR) * HOUR, k = r.svc + "|" + h; if (h >= since) addTo(m[k] || (m[k] = blank(r.svc, h)), r); });
      return Object.keys(m).map(function (k) { return m[k]; });
    };
    return db().then(function (d) {
      if (!d) { var m0 = {}; RING.forEach(function (r) { var h = Math.floor(r.at / HOUR) * HOUR, k = r.svc + "|" + h; if (h >= since && BUF.indexOf(r) < 0) addTo(m0[k] || (m0[k] = blank(r.svc, h)), r); }); return add(Object.keys(m0).map(function (k) { return m0[k]; })); }
      return new Promise(function (ok) {
        var tx;
        try { tx = d.transaction("hours", "readonly"); } catch (e) { return ok(add([])); }
        var q = tx.objectStore("hours").getAll();
        q.onsuccess = function () { ok(add(q.result || [])); };
        q.onerror = function () { ok(add([])); };
      });
    }, function () { return add([]); });
  }

  // ======== 包上 fetch、WebSocket ========
  var F0 = window.fetch;
  if (typeof F0 === "function") {
    window.fetch = function (input, init) {
      var p = F0.apply(window, arguments);
      try {
        if (init && init.svclog === false) return p;
        var url = typeof input === "string" ? input : input && input.url ? input.url : String(input), path = where(url), svc = svcOf(path);
        if (!svc) return p;
        var t0 = Date.now(), p0 = performance.now(), op = String((init && init.method) || (input && input.method) || "GET").toUpperCase() + " " + path;
        p.then(function (r) {
          var ms = performance.now() - p0;
          if (r.ok || r.status === 304) return rec({ svc: svc, op: op, at: t0, ms: ms, st: r.status });
          r.clone().text().then(function (tx) { rec({ svc: svc, op: op, at: t0, ms: ms, st: r.status, err: errOf(tx, r) || "HTTP " + r.status }); },
            function () { rec({ svc: svc, op: op, at: t0, ms: ms, st: r.status, err: r.statusText || "HTTP " + r.status }); });
        }, function (e) {
          if (e && e.name === "AbortError") return; // 自己取消的（停下、关掉）：不算
          rec({ svc: svc, op: op, at: t0, ms: performance.now() - p0, st: 0, err: String((e && e.message) || e || "Network error") });
        });
      } catch (e) { /* 记不了也不影响请求 */ }
      return p;
    };
  }
  var WS0 = window.WebSocket;
  if (typeof WS0 === "function") {
    var WSW = function (url, protocols) {
      var ws = arguments.length > 1 ? new WS0(url, protocols) : new WS0(url);
      try { watch(ws, String(url)); } catch (e) { /* 同上 */ }
      return ws;
    };
    WSW.prototype = WS0.prototype;
    ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function (k) { WSW[k] = WS0[k]; });
    window.WebSocket = WSW;
  }
  // 连上一条（用了多久连上）；断开一条（连了多久、关闭码）：正常关（1000、1001、4000 = 被新的连接顶掉）是 ok，别的是 drop；没连上就断了是 fail
  function watch(ws, url) {
    var path = where(url), svc = svcOf(path);
    if (!svc) return;
    var t0 = Date.now(), p0 = performance.now(), opened = 0, op = "WS " + path;
    ws.addEventListener("open", function () { opened = Date.now(); rec({ svc: svc, op: op, at: t0, ms: performance.now() - p0, st: 101, info: { ev: "open" } }); });
    ws.addEventListener("close", function (e) {
      if (!opened) return rec({ svc: svc, op: op, at: t0, ms: performance.now() - p0, st: 0, err: "Connection failed (" + e.code + ")", info: { ev: "close", code: e.code } });
      var normal = e.code === 1000 || e.code === 1001 || e.code === 4000;
      rec({ svc: svc, op: op, at: Date.now(), ms: Date.now() - opened, st: e.code, cls: normal ? "ok" : "drop", err: normal ? "" : e.reason || "Connection closed (" + e.code + ")", info: { ev: "close", code: e.code } });
    });
  }

  window.TSU_SVCLOG = {
    rec: rec, services: SVCS, calls: calls, hours: hours, flush: flush, svcOf: function (u) { return svcOf(where(u)); },
    onRec: function (fn) { subs.push(fn); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; },
  };
})();
