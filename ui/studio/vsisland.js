// vsisland.js —— iPhone App：灵动岛和锁屏上的实时活动（ActivityKit）用的这一半：几个会话在跑、几个在等你，
//   最要紧的那一个（等你的优先，其次最近开始跑的）叫什么、在干什么、跑了多久。页面算好交给 App（webkit.messageHandlers.vsApp，type: "island"），
//   App 起 / 改 / 收实时活动（ios/Sources/LiveActivity.swift）。只在 iPhone 的 App 里有；网页版、Mac 上都不载这一套的事
(function () {
  "use strict";
  var app = window.vsApp, H = window.webkit && webkit.messageHandlers && webkit.messageHandlers.vsApp;
  if (!app || !H || !/iPhone/.test(navigator.userAgent)) return;
  var post = function (m) { try { H.postMessage(m); } catch (e) { /* App 不在了 */ } };
  var front = function () { var T = window.TSU_TERM; return T && T.front ? T.front() : null; };
  var since = {}; // 在跑的会话：这边第一次看到它在跑的时间（用时从这里算）
  function snap() {
    var tw = front(), cc = tw && tw.side && tw.side.cc ? tw.side.cc() : null, list = (cc && cc.list) || [];
    var S = window.STUDIO, needs = (S && S.needsList ? S.needsList() : null) || [];
    // 在跑的：会话列表里标着在忙的，加上开着的标签页里正在答的（借 Mac 用时列表里不一定带着忙不忙，开着的那几个一定知道）
    var work = list.filter(function (x) { return x && x.live && x.live.status === "busy"; }).map(function (x) { return { id: "cc:" + x.id, title: x.title, last: x.last }; }), now = Date.now(), seen = {};
    var T = window.TSU_TERM, panes = T && T.panes ? T.panes() : [];
    panes.forEach(function (P) {
      var aid = P && P.program && P.program.agentId, rt = null;
      if (!aid || work.some(function (w) { return w.id === aid; })) return;
      try { rt = window.TSU_AGENTS ? TSU_AGENTS.runtime(aid) : null; } catch (e) { rt = null; }
      if (rt && rt.stream) work.push({ id: aid, title: P.title ? P.title() : (rt.agent && rt.agent.name) || "", last: "" });
    });
    work.forEach(function (x) { seen[x.id] = 1; if (!since[x.id]) since[x.id] = now; });
    Object.keys(since).forEach(function (k) { if (!seen[k]) delete since[k]; });
    var st = "idle", name = "", detail = "", at = now, fid = "";
    if (needs.length) { var n = needs[0]; st = "waiting"; name = String(n.name || ""); detail = String(n.text || ""); at = since[n.aid] || now; fid = n.aid; }
    else if (work.length) {
      var w = work.slice().sort(function (a, b) { return since[b.id] - since[a.id]; })[0];
      st = "working"; name = String(w.title || ""); detail = String(w.last || ""); at = since[w.id] || now; fid = w.id;
    }
    // 要看的是内容（它刚说了什么、在跑什么命令），不是「在跑」两个字：那个会话最后几行——回答的最后一段话、在跑的工具和它的说明
    var lines = content(fid);
    if (lines.length) detail = lines[0];
    return { type: "island", state: st, name: name.slice(0, 60), detail: detail.replace(/\s+/g, " ").trim().slice(0, 140), lines: lines, since: at, working: work.length, waiting: needs.length };
  }
  // 那个会话最近的内容：最后一问里最后几样（说的话取最后一段、工具写「名字 说明」），最多 3 行
  function content(aid) {
    var rt = null; try { rt = aid && window.TSU_AGENTS ? TSU_AGENTS.runtime(aid) : null; } catch (e) { rt = null; }
    var ts = rt && rt.session ? rt.session().turns || [] : [], t = ts[ts.length - 1], out = [];
    if (!t) return out;
    var parts = (t.parts || []).slice(-6);
    parts.forEach(function (p) {
      if (!p) return;
      if (p.kind === "text" && p.text) { var paras = String(p.text).split(/\n+/).map(function (x) { return x.replace(/[*_`#>]/g, "").trim(); }).filter(Boolean); if (paras.length) out.push(paras[paras.length - 1]); }
      else if (p.kind === "tool") { var a = p.input || {}, d = String(a.description || a.command || a.file_path || a.pattern || a.url || a.prompt || "").replace(/\s+/g, " ").trim(); out.push((p.name || "Tool") + (d ? " · " + d : "")); }
    });
    if (!out.length && t.ask) out.push(String(t.ask).replace(/\s+/g, " ").trim());
    return out.slice(-3).reverse().map(function (x) { return x.slice(0, 140); }); // 最新的在最前面（要看的是它现在在说什么、在跑什么）
  }
  var last = "";
  function tick() { if (document.hidden) return; var s = snap(), sig = JSON.stringify([s.state, s.name, s.lines, s.working, s.waiting, Math.floor(s.since / 1000)]); if (sig === last) return; last = sig; post(s); } // 切到后台时不报（那时和 Mac 的连接常断着，算出来的不准）
  setInterval(tick, 2000);
  document.addEventListener("vs-needs", tick);
})();
