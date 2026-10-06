// vsnative.js —— iPad App 的「iPad Native」界面（ipad/ 里 SwiftUI 画的那一层）用的这一半：
//   页面只画当前这段对话（整屏，没有标题栏、活动栏、侧栏、标签条、状态栏、右侧栏，也没有这边的输入框）；
//   会话列表、输入框、顶栏是 App 自己画的（原生）。这边把会话列表、当前这段的状态、Mac 连没连上报给 App（webkit.messageHandlers.vsApp），
//   App 叫这边打开 / 发话 / 停（window.VSN）。Classic（完整的这个界面）不载这一套。
(function () {
  "use strict";
  var app = window.vsApp, H = window.webkit && webkit.messageHandlers && webkit.messageHandlers.vsApp;
  if (!app || app.shell !== "native" || !H) return;
  var root = document.documentElement;
  root.classList.add("vs-native");
  var css = document.createElement("style");
  css.textContent = [
    // 只拿掉 App 自己画了的、iPad 上用不着的：标题栏、活动栏、左边的 Agents 列表（App 的会话列表顶替）、编辑区的标签条、状态栏；
    //   辅助侧栏（正在运行、任务、后台任务）、底部面板照你的布局留着
    "html.vs-native #win .bar, html.vs-native .st-act, html.vs-native .tlab > .tside, html.vs-native .tlab > .ts-grip, html.vs-native .tmain > .tabs, html.vs-native .tgroup > .gtabs, html.vs-native .tgroup > .st-crumbs, html.vs-native .st-status { display: none !important; }",
    // 这一格自己的输入框、底部那几行（状态 App 画）、拖动条、「Jump to bottom」都不要
    "html.vs-native .tpane > .foot, html.vs-native .tpane > .ta, html.vs-native .tpane > .grip, html.vs-native .tpane > .jump { display: none !important; }",
    // 最下面给 App 那一排（会话、输入框、发送、更多）让出地方：整个工作台停在它上面，不被盖住
    "html.vs-native #win .body { padding-bottom: 76px !important; box-sizing: border-box !important; }",
    "html.vs-native .rm-veil { z-index: 2147483600 !important; }",
  ].join("\n");
  (document.head || root).appendChild(css);

  var post = function (m) { try { H.postMessage(m); } catch (e) { /* App 不在了 */ } };
  var T = function () { return window.TSU_TERM; };
  var front = function () { return T() && T().front ? T().front() : null; };
  var active = function () { var tw = front(); return tw && tw.ws ? tw.ws.active : null; };
  var aidOf = function (P) { return (P && P.program && P.program.agentId) || ""; };
  var rtOf = function (aid) { try { return aid && window.TSU_AGENTS ? TSU_AGENTS.runtime(aid) : null; } catch (e) { return null; } };

  // ---- 会话列表：Claude Code 的（经中转读的你那台 Mac 上的）----
  function sessions() {
    var tw = front(), cc = tw && tw.side && tw.side.cc ? tw.side.cc() : null, out = [];
    ((cc && cc.list) || []).forEach(function (x) {
      out.push({ id: "cc:" + x.id, kind: "claude", title: String(x.title || ""), last: String(x.last || "").replace(/\s+/g, " ").slice(0, 200), at: +x.mtime || 0, busy: !!(x.live && x.live.status === "busy"), live: !!x.live, cwd: String(x.cwd || "") });
    });
    return out;
  }
  var lastSig = "";
  function pushSessions(force) { var l = sessions(), sig = JSON.stringify(l); if (!force && sig === lastSig) return; lastSig = sig; post({ type: "sessions", items: l }); }

  // ---- 当前这段：哪个、标题、在不在忙、底部那一行（转圈那行 / 做完那行，照这一格自己画出来的字）----
  function state() {
    var P = active(), aid = aidOf(P), rt = rtOf(aid), st = "";
    if (aid && P && P.foot) String(P.foot.innerText || "").split("\n").forEach(function (l) { if (/^\s*[·✢✳✶✻✽*]︎?\s+\S/.test(l)) st = l.trim(); });
    var q = rt && rt.question ? rt.question() : null;
    return { id: aid, title: aid && P && P.title ? String(P.title() || "") : "", busy: !!(rt && rt.stream), status: st, asking: !!(q && q.questions && q.questions.length) };
  }
  var lastState = "";
  function pushState(force) { var s = state(), sig = JSON.stringify(s); if (!force && sig === lastState) return; lastState = sig; post(Object.assign({ type: "state" }, s)); }

  // ---- Mac 连没连上 ----
  var lastMac = "";
  function pushMac() { var N = window.nadosNative, s = N && N.state ? N.state() : "none", h = N && N.host ? N.host() : null, sig = s + "|" + ((h && h.host) || ""); if (sig === lastMac) return; lastMac = sig; post({ type: "mac", state: s, name: (h && h.host) || "" }); }

  window.VSN = {
    open: function (id) { if (id && T() && T().agent) T().agent(String(id)); setTimeout(function () { pushState(true); }, 60); },
    // 说一句：同在这一格的输入框里敲完按回车（/ 命令、排队、图片这些都照原来的走）
    send: function (text) {
      var P = active();
      if (!P || !P.program || !P.program.key || !P.ta || !aidOf(P)) return false;
      P.ta.value = String(text || "");
      if (P.program.inputChanged) try { P.program.inputChanged(); } catch (e) { /* 没有也行 */ }
      P.program.key({ type: "keydown", key: "Enter", code: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, repeat: false, target: P.ta, preventDefault: function () {}, stopPropagation: function () {} });
      setTimeout(function () { pushState(true); }, 80);
      return true;
    },
    stop: function () { var rt = rtOf(aidOf(active())); if (rt && rt.interrupt) rt.interrupt(); },
    newSession: function () { if (window.TSU_CLAUDE && TSU_CLAUDE.newSession) { var i = window.TSU_LOCAL && TSU_LOCAL.info ? TSU_LOCAL.info() : null; TSU_CLAUDE.newSession((i && i.home) || ""); } },
    refresh: function () { var tw = front(); if (tw && tw.side && tw.side.refreshCC) tw.side.refreshCC(true); pushSessions(true); pushState(true); pushMac(); },
  };
  document.addEventListener("tsu-cc", function () { pushSessions(false); });
  setInterval(function () { pushSessions(false); pushState(false); pushMac(); }, 800);
  window.addEventListener("load", function () { post({ type: "ready" }); window.VSN.refresh(); });
})();
