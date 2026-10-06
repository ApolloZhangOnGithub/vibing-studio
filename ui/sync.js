// sync.js —— 跟着账号走的数据（同 iCloud）在设备这一头：设备身份、拉 / 推、租约、通知。
// 服务器上只有一份（src/account.js），设备上的都是缓存；窗口、Dock、壁纸、主题这些界面状态跟着设备走，不经过这里。
//   · 设备：每个浏览器 / App 一个 id（存在这台设备上）和一个给人看的名字（「Mac · Chrome」「iPhone · App」），打开时报到
//   · 记录：agent、会话、每一轮（agents.js 接上来：它管缓存和拉到了哪儿，这里管收发、拆段拼段、定时拉）
//   · 租约：同一件事同一时间只在一台设备上做（agent:<id> = 谁在跑这个 agent）
//   · 通知：同一件事只有一条，谁先处理算谁的
// 没登录（本地开发没有账号 id）时 TSU_SYNC 为 null，别的脚本照旧只用本地
(function () {
  "use strict";
  var UID = window.TSU_UID || 0;
  if (!UID) { window.TSU_SYNC = null; return; }
  var ABC = "abcdefghijklmnopqrstuvwxyz0123456789";
  function rnd(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, function (b) { return ABC[b % 36]; }).join(""); }
  var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  var dev = ls("tsu-device");
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(dev || "")) { dev = "d" + rnd(15); ls("tsu-device", dev); }
  // 设备名：什么设备 + 浏览器（原生 App 里就是 App）；人可以在设置里改（tsu-device-name）
  function guessName() {
    var ua = navigator.userAgent, pf = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    var kind = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(pf + ua) ? "Mac" : /Win/.test(pf) ? "Windows" : /Linux/.test(pf) ? "Linux" : "设备";
    if (window.nadosNative) return kind + " · App";
    return kind + " · " + (/Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "浏览器");
  }
  var name = ls("tsu-device-name") || guessName(), kind = /iPhone|iPad|Android/.test(name) ? "ios" : "mac";
  // Mac 上的 App：用这台 Mac 自己的名字（系统设置里起的，「Kezhen 的 MacBook Pro」），不用「Mac · App」——自己没改过名字时
  if (!ls("tsu-device-name") && window.nadosNative && !nadosNative.remote && nadosNative.call) {
    nadosNative.call("local.info").then(function (i) { var h = i && String(i.host || "").trim(); if (h && h !== name) { name = h; hello(); } }, function () {});
  }

  var fns = [];
  function emit(type, data) { fns.slice().forEach(function (f) { try { f(type, data); } catch (e) { console.error(e); } }); }
  function post(path, body) {
    return fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-tsu-device": dev }, body: typeof body === "string" ? body : JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "HTTP " + r.status); return j; }); });
  }

  // ---- 设备报到：打开时一次，之后每 10 分钟（「上次在线」）----
  var devices = {}; // id → { name, kind, last_seen }
  function hello() { return post("/api/devices", { id: dev, name: name, kind: kind }).catch(function () {}); }
  hello();
  setInterval(hello, 600000);

  // ---- 拉：since 之后的所有记录（一页放不下自动翻页），同一条的几段拼好；还没推全的那条这次先不给（推全以后会整条再来）----
  var skew = 0; // 服务器时间 - 本机时间（租约、稍后提醒按服务器的钟算）
  function pull(since) {
    var rows = [], first = null, after = "";
    function page() {
      var q = "/api/sync?since=" + since + (after ? "&after=" + encodeURIComponent(after) : "");
      return fetch(q, { headers: { "x-tsu-device": dev } }).then(function (r) {
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || "HTTP " + r.status); });
        return r.json();
      }).then(function (j) {
        if (!first) first = j;
        rows = rows.concat(j.rows || []);
        if (j.rest > 0 && j.after && j.after !== after) { after = j.after; return page(); }
        skew = (first.now || Date.now()) - Date.now();
        note(first);
        return { recs: assemble(rows), head: first.head || 0, notices: first.notices || [], leases: first.leases || [] };
      });
    }
    return page();
  }
  function assemble(rows) {
    var groups = {}, out = [];
    rows.forEach(function (r) {
      var k = r.ns + "|" + r.id, g = groups[k] || (groups[k] = {}), vk = r.v || "", x = g[vk] || (g[vk] = { parts: r.parts || 1, rev: 0, got: {}, n: 0, dev: r.dev, at: r.at });
      if (!(r.part in x.got)) x.n++;
      x.got[r.part] = r.data;
      if (r.rev >= x.rev) { x.rev = r.rev; x.dev = r.dev; x.at = r.at; }
    });
    Object.keys(groups).forEach(function (k) {
      var best = null;
      Object.keys(groups[k]).forEach(function (vk) { var x = groups[k][vk]; if (!best || x.rev > best.rev) best = x; });
      if (best.n < best.parts) return;
      var data = best.got[0];
      if (best.parts > 1) { data = ""; for (var i = 0; i < best.parts; i++) data += best.got[i]; }
      var i0 = k.indexOf("|");
      out.push({ ns: k.slice(0, i0), id: k.slice(i0 + 1), data: data == null ? null : data, dev: best.dev, at: best.at, rev: best.rev });
    });
    return out.sort(function (a, b) { return a.rev - b.rev; });
  }

  // ---- 推：[{ ns, id, data（字符串；null = 删了）}]。大的拆成几段（每段 20 万个字符以内，UTF-8 最多 600 KB），按 1.5 MB 一批依次推 ----
  var PART = 200000, BATCH = 1500000, enc = new TextEncoder();
  function push(recs) {
    var rows = [], t = Date.now();
    recs.forEach(function (r) {
      if (r.data == null) { rows.push({ ns: r.ns, id: r.id, part: 0, parts: 1, v: null, data: null, at: t }); return; }
      var s = String(r.data), chunks = [], pos = 0;
      while (pos < s.length) {
        var end = Math.min(s.length, pos + PART), c = s.charCodeAt(end - 1);
        if (end < s.length && c >= 0xd800 && c <= 0xdbff) end--; // 不把一个 emoji 的两半拆开
        chunks.push(s.slice(pos, end));
        pos = end;
      }
      if (!chunks.length) chunks.push("");
      var v = chunks.length > 1 ? rnd(10) : null;
      chunks.forEach(function (ch, i) { rows.push({ ns: r.ns, id: r.id, part: i, parts: chunks.length, v: v, data: ch, at: t }); });
    });
    var batches = [], cur = [], size = 2;
    rows.forEach(function (row) {
      var j = JSON.stringify(row), n = enc.encode(j).length + 1;
      if (cur.length && size + n > BATCH) { batches.push(cur); cur = []; size = 2; }
      cur.push(j);
      size += n;
    });
    if (cur.length) batches.push(cur);
    var rev = 0;
    return batches.reduce(function (p, b) {
      return p.then(function () { return post("/api/store", "[" + b.join(",") + "]").then(function (j) { rev = j.rev; }); });
    }, Promise.resolve()).then(function () { return rev; });
  }

  // ---- 租约 ----
  var leases = {}; // name → { dev, until, device }
  var serverNow = function () { return Date.now() + skew; };
  function note(j) {
    if (j.devices) j.devices.forEach(function (d) { devices[d.id] = d; });
    if (j.leases) {
      var mine = {};
      Object.keys(leases).forEach(function (k) { if (leases[k].dev === dev && leases[k].until > serverNow()) mine[k] = leases[k]; }); // 自己刚拿到的先留着（拉的那一刻它可能还没写进去）
      leases = mine;
      j.leases.forEach(function (l) { if (!leases[l.name] || l.dev !== dev) leases[l.name] = { dev: l.dev, until: l.until, device: (devices[l.dev] || {}).name || null }; });
      emit("leases");
    }
    if (j.notices && j.notices.length) noticesIn(j.notices);
  }
  function lease(nm, op, o) {
    o = o || {};
    return post("/api/lease", { name: nm, dev: dev, op: op, force: !!o.force, ttl: o.ttl }).then(function (j) {
      if (op === "free") { if (leases[nm] && leases[nm].dev === dev) delete leases[nm]; }
      else if (j.dev) leases[nm] = { dev: j.dev, until: j.until, device: j.device };
      emit("leases");
      return j;
    });
  }
  // 别的设备拿着、还没过期：返回 { dev, until, device（名字）}
  function elsewhere(nm) { var l = leases[nm]; return l && l.dev !== dev && l.until > serverNow() ? l : null; }

  // ---- 通知：同一件事一条（key）；处理经服务器，只生效一次 ----
  var notices = {}; // key → 服务器上的那条
  function noticesIn(list) {
    var changed = [];
    list.forEach(function (n) { var old = notices[n.key]; if (!old || n.rev > old.rev) { notices[n.key] = n; changed.push(n); } });
    if (changed.length) emit("notices", changed);
  }
  function noticeAdd(key, n) {
    return post("/api/notices", { op: "add", key: key, app: n.app, title: n.title, body: n.body, data: n.data, dev: dev }).then(function (j) {
      if (j.notice) noticesIn([j.notice]);
      return j;
    });
  }
  function noticeAct(key, action, until) {
    return post("/api/notices", { op: "act", key: key, action: action || "dismiss", until: until, dev: dev }).then(function (j) {
      if (j.notice) noticesIn([j.notice]);
      return j;
    });
  }

  // ---- 定时拉：agents.js 接上来以后开始（它给出拉到了哪儿、拿到以后怎么合进去）。
  // 有 agent 在别的设备上跑时 3 秒一次（看得到它在答什么），平时 20 秒；页面藏着不拉，回到前台马上拉一次 ----
  var consumer = null, timer = 0, busy = false;
  function interval() { return Object.keys(leases).some(function (k) { return elsewhere(k); }) ? 3000 : 20000; }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(poll, ms == null ? interval() : ms); }
  function poll() {
    if (!consumer || busy) return schedule();
    if (document.hidden) return schedule();
    busy = true;
    pull(consumer.since()).then(function (res) { return consumer.apply(res); })
      .catch(function (e) { console.warn("同步：拉取失败，稍后再试 ·", e.message || e); })
      .then(function () { busy = false; schedule(); });
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) schedule(0); });
  window.addEventListener("focus", function () { schedule(0); });

  window.TSU_SYNC = {
    uid: UID, dev: dev,
    name: function () { return name; },
    rename: function (n) { name = String(n || "").trim().slice(0, 60) || guessName(); ls("tsu-device-name", name); return hello(); },
    devices: function () { return devices; },
    deviceName: function (id) { return id === dev ? name : (devices[id] || {}).name || "另一台设备"; },
    pull: pull, push: push,
    attach: function (c) { consumer = c; schedule(interval()); }, // c: { since() → 拉到了哪个 rev, apply({ recs, head, notices, leases }) → Promise }
    poke: function (ms) { schedule(ms == null ? 300 : ms); },
    lease: lease, elsewhere: elsewhere, leases: function () { return leases; },
    notices: function () { return notices; }, noticeAdd: noticeAdd, noticeAct: noticeAct,
    now: serverNow,
    on: function (f) { fns.push(f); return function () { var i = fns.indexOf(f); if (i >= 0) fns.splice(i, 1); }; },
  };
})();
