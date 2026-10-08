// tabtime.js —— 标签页的时间（beta）：每个标签页什么时候开的、开了多久，其中
//   在前台（App 在最前、这个窗口有焦点、看着的就是它）、可见（显示着，但 App 不在最前或焦点在别的分栏）、
//   后台工作（看不见，Agent 在干活）、休眠（看不见，也没在干活）各多久；另记 Agent 在工作的时间。
//   怎么算：每 2 秒看一次各个标签页（窗口焦点变了、页面藏起来时马上看），这段时间算给上一次看到的状态；
//     电脑睡着、页面被停住的那段不算（两次之间超过一分钟的只算一分钟）。
//   记在哪：这一个标签页（开着时在内存里）；同一个会话 / 页面的累计（这台设备上，localStorage）；
//     会话的累计每 5 分钟推到账户（TSU_SYNC 的 tabtime：设备 | 会话 → 这台设备上的累计），别的设备的拉下来，详情里写所有设备加起来的
(function () {
  "use strict";
  if (window.TSU_TABTIME) return;
  var KEY = "tsu-tabtime", STEP = 2000, CAP = 60000, PUSH = 300000;
  var BUCKETS = ["focus", "visible", "work", "sleep"];
  var agg = (function () { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } })();
  var RKEY = "tsu-tabtime-remote", remote = (function () { try { return JSON.parse(localStorage.getItem(RKEY) || "{}") || {}; } catch (e) { return {}; } })(); // 别的设备的（拉到就记着，重开 App 也在）
  var inst = typeof WeakMap === "function" ? new WeakMap() : null, last = Date.now(), dirty = false, pushed = {};
  var blank = function (now) { return { first: now, opens: 0, focus: 0, visible: 0, work: 0, sleep: 0, busy: 0, lastFocus: 0, last: now }; };
  // 一个标签页记在哪一项下面：Agent / 会话（agent:<id>，Claude Code 的是 agent:cc:<会话 id>）、页面（page:<种类>:<参数>）、有名字的终端（term:<id>）
  function keyOf(P) {
    var pr = P && P.program;
    if (!pr || P.footOnly) return ""; // 面板里那一层（跟着 agent 的输入框、状态）不是标签页
    if (pr.agentId) return "agent:" + pr.agentId;
    if (pr.page) return "page:" + pr.page + (pr.arg ? ":" + pr.arg : "");
    if (P.shell && P.shell.termId) return "term:" + P.shell.termId;
    return "";
  }
  function busyOf(P) {
    var pr = P && P.program, rt = null;
    if (!pr || !pr.agentId || !window.TSU_AGENTS) return false;
    try { rt = TSU_AGENTS.runtime(pr.agentId); } catch (e) { return false; }
    return !!(rt && rt.stream);
  }
  function stateOf(P, front, hasFocus, docVis) {
    var shown = docVis && !P.closed && !P.off && P.el && P.el.isConnected && P.el.getClientRects().length > 0;
    if (!shown) return "hidden";
    return hasFocus && front && P.win === front && front.ws && front.ws.active === P ? "focus" : "visible";
  }
  function tick() {
    var TT = window.TSU_TERM;
    if (!inst || !TT || !TT.panes) return;
    var now = Date.now(), dt = Math.max(0, Math.min(now - last, CAP));
    last = now;
    var front = TT.front ? TT.front() : null, hf = document.hasFocus(), dv = document.visibilityState === "visible";
    TT.panes().forEach(function (P) {
      var k = keyOf(P);
      if (!k) return;
      var me = inst.get(P);
      if (!me || me.key !== k) { // 新开的标签页（或者这个标签页换了内容）：从现在算
        me = { key: k, opened: now, focus: 0, visible: 0, work: 0, sleep: 0, busy: 0, st: stateOf(P, front, hf, dv), b: busyOf(P) };
        inst.set(P, me);
        var a0 = agg[k] || (agg[k] = blank(now));
        a0.opens++; a0.last = now; dirty = true;
        return;
      }
      var a = agg[k] || (agg[k] = blank(now));
      var bucket = me.st === "focus" ? "focus" : me.st === "visible" ? "visible" : me.b ? "work" : "sleep";
      me[bucket] += dt; a[bucket] += dt;
      if (me.b) { me.busy += dt; a.busy += dt; }
      if (me.st === "focus") { a.lastFocus = now; me.lastFocus = now; }
      a.last = now;
      me.st = stateOf(P, front, hf, dv); me.b = busyOf(P);
      dirty = true;
    });
  }
  function save() { if (!dirty) return; dirty = false; try { localStorage.setItem(KEY, JSON.stringify(agg)); } catch (e) { /* 满了 */ } }
  // 推到账户：会话的累计（变了的），id = 设备 | 会话
  function push() {
    var SY = window.TSU_SYNC;
    if (!SY || !SY.push || !SY.dev) return;
    var recs = [];
    Object.keys(agg).forEach(function (k) {
      if (!/^agent:/.test(k)) return;
      var s = JSON.stringify(agg[k]);
      if (pushed[k] === s) return;
      recs.push({ ns: "tabtime", id: SY.dev + "|" + k, data: s, k: k, s: s });
    });
    if (!recs.length) return;
    SY.push(recs.map(function (r) { return { ns: r.ns, id: r.id, data: r.data }; })).then(function () { recs.forEach(function (r) { pushed[r.k] = r.s; }); }, function () { /* 下次再推 */ });
  }
  setInterval(function () { tick(); }, STEP);
  setInterval(save, 30000);
  setInterval(push, PUSH);
  ["focus", "blur"].forEach(function (ev) { window.addEventListener(ev, tick); });
  document.addEventListener("visibilitychange", function () { tick(); if (document.hidden) save(); });
  window.addEventListener("pagehide", function () { tick(); dirty = true; save(); push(); });

  // ---- 读 ----
  var sum = function (xs) { var o = { focus: 0, visible: 0, work: 0, sleep: 0, busy: 0, opens: 0, first: 0, lastFocus: 0 }; xs.forEach(function (x) { if (!x) return; BUCKETS.concat(["busy", "opens"]).forEach(function (b) { o[b] += x[b] || 0; }); if (x.first && (!o.first || x.first < o.first)) o.first = x.first; if (x.lastFocus > o.lastFocus) o.lastFocus = x.lastFocus; }); return o; };
  window.TSU_TABTIME = {
    // 这一个标签页：{ opened, focus, visible, work, sleep, busy }（毫秒；算到现在）
    forPane: function (P) { tick(); var me = inst && inst.get(P); return me ? { opened: me.opened, focus: me.focus, visible: me.visible, work: me.work, sleep: me.sleep, busy: me.busy } : null; },
    // 一个会话 / 页面的累计：这台设备的、所有设备加起来的（别的设备推上来的 + 这台）、有几台设备
    forKey: function (k) {
      tick();
      var here = agg[k] || null, dev = window.TSU_SYNC && TSU_SYNC.dev, others = Object.keys(remote).filter(function (d) { return d !== dev && remote[d][k]; }).map(function (d) { return remote[d][k]; });
      return { here: here, all: sum([here].concat(others)), devices: others.length + (here ? 1 : 0) };
    },
    // 开着这个 Agent / 会话的标签页（最近在前台的那一个）
    //   （同一个会话开着几个：先挑现在显示着的，再挑最近在前台过的）
    paneFor: function (agentId) {
      var TT = window.TSU_TERM, best = null, bs = -1;
      if (!TT || !TT.panes) return null;
      tick();
      TT.panes().forEach(function (P) {
        if (!P.program || P.program.agentId !== agentId || P.closed) return;
        var me = inst && inst.get(P), sc = me ? (me.st !== "hidden" ? 1e15 : 0) + (me.lastFocus || me.opened || 0) : 0;
        if (sc > bs) { bs = sc; best = P; }
      });
      return best;
    },
    // 账户里别的设备的（agents.js 拉到 tabtime 的记录时交过来）
    remote: function (id, data) {
      var i = String(id).indexOf("|");
      if (i < 0) return;
      var d = id.slice(0, i), k = id.slice(i + 1);
      try { (remote[d] || (remote[d] = {}))[k] = data == null ? null : JSON.parse(data); localStorage.setItem(RKEY, JSON.stringify(remote)); } catch (e) { /* 坏的、存不下的不要 */ }
    },
  };
})();
