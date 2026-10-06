// welcome.js —— 欢迎页（同 VS Code 的「欢迎」）：这是什么、马上能做的几件事、Claude Code / Codex 连上没有、最常用的快捷键。
//   入口：菜单栏「帮助 › 欢迎」、命令面板；第一次打开选完外观后自动开一次。TSU_WELCOME.open()
(function () {
  "use strict";
  if (window.TSU_WELCOME) return;
  var S = window.STUDIO;
  if (!S || !S.pages) return;
  var en = function () { return !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"); };
  var tr = function (zh, e) { return en() ? e : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var home = function () { var L = window.TSU_LOCAL, i = L && L.info && L.info(); return (i && i.home) || ""; };
  var ccOn = function () { return !!(window.TSU_EXT && TSU_EXT.on && TSU_EXT.on("claude-code")); };
  var cxOn = function () { return !!(window.TSU_CONNECTORS && TSU_CONNECTORS.on && TSU_CONNECTORS.on("codex")); };
  var ICON = '<i class="st-ico st-i-svg"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8.5l3 3 8-8"/></svg></i>';
  // 快捷键：[键, 做什么]
  var KEYS = function () {
    return [["⌘T", tr("新建会话", "New session")], ["⇧⌘P", tr("命令面板", "Command palette")], ["⌘B", tr("主侧栏", "Primary side bar")], ["⌥⌘I", tr("辅助侧栏", "Secondary side bar")],
      ["⌘J", tr("底部面板", "Panel")], ["⌘,", tr("设置", "Settings")], ["⌃⌘1", tr("Visual Studio Code 风格", "Visual Studio Code style")], ["⌃⌘2", tr("Claude Desktop 风格", "Claude Desktop style")], ["⌘K Z", tr("禅模式", "Zen mode")]];
  };
  function body() {
    var kc = S.keycaps || function (k) { return "<kbd>" + esc(k) + "</kbd>"; };
    var conn = function (name, on, how) { return '<div class="wl-conn"><span class="wl-dot' + (on ? " on" : "") + '"></span><b>' + esc(name) + "</b><span>" + esc(on ? tr("已连接", "Connected") : how) + "</span></div>"; };
    return '<div class="wl-hero"><h1>Vibing Studio</h1><p>' + esc(tr("把 Claude Code、Codex 的会话放在一个窗口里：看它们在做什么、接着说、管理文件和后台任务。", "Claude Code and Codex sessions in one window — watch what they are doing, keep talking, and manage files and background work.")) + "</p></div>" +
      '<div class="wl-sec">' + esc(tr("开始", "Start")) + '</div><div class="wl-acts">' +
      [["new", tr("新建 Claude Code 会话", "New Claude Code session")], ["finder", tr("打开 Agent Finder", "Open Agent Finder")], ["files", tr("浏览这台 Mac 的文件", "Browse files on this Mac")], ["settings", tr("设置", "Settings")], ["notes", tr("更新内容", "Release notes")]]
        .map(function (a) { return '<button type="button" class="wl-act" data-wl="' + a[0] + '">' + esc(a[1]) + "</button>"; }).join("") + "</div>" +
      '<div class="wl-sec">' + esc(tr("连接", "Connections")) + "</div>" +
      conn("Claude Code", ccOn(), tr("没找到——装好 Claude Code（claude）后自动连上", "Not found — install Claude Code (claude) and it connects automatically")) +
      conn("Codex", cxOn(), tr("没开——在 设置 › 连接器 里打开", "Off — turn it on in Settings › Connectors")) +
      '<div class="wl-sec">' + esc(tr("常用快捷键", "Shortcuts")) + '</div><div class="wl-keys">' +
      KEYS().map(function (k) { return '<div class="wl-key"><span>' + esc(k[1]) + "</span>" + k[0].split(" / ").map(function (x) { return kc(x); }).join(" ") + "</div>"; }).join("") + "</div>";
  }
  S.pages.welcome = {
    title: function () { return tr("欢迎", "Welcome"); },
    address: function () { return "welcome.local.paimon"; },
    icon: function () { return ICON; },
    render: function (host, P) {
      host.innerHTML = '<div class="wl cl-page">' + body() + "</div>";
      if (host.dataset.wlb) return;
      host.dataset.wlb = "1";
      host.addEventListener("click", function (e) {
        var b = e.target.closest("[data-wl]");
        if (!b) return;
        var tw = P && P.win, k = b.dataset.wl;
        if (k === "new" && window.TSU_CLAUDE && TSU_CLAUDE.newSession) TSU_CLAUDE.newSession(home());
        else if (k === "finder" && tw) S.openPage(tw, "explorer", "agents");
        else if (k === "files" && tw) S.openPage(tw, "explorer", "~");
        else if (k === "settings" && tw && S.settings) S.settings(tw, "general");
        else if (k === "notes" && window.TSU_CHANGELOG) TSU_CHANGELOG.open(tw);
      });
    },
    focus: function () {},
  };
  function open(tw) {
    var T = window.TSU_TERM;
    tw = tw || (T && T.front ? T.front() : null);
    if (!tw || !S.openPage) return;
    var hit = null;
    tw.ws.all().forEach(function (p) { if (!hit && p.program && p.program.page === "welcome") hit = p; });
    if (hit) tw.ws.show(hit); else S.openPage(tw, "welcome", null);
  }
  if (S.command) S.command("help.welcome", { title: "欢迎", run: function (tw) { open(tw); } });
  if (window.TSU_I18N && TSU_I18N.add) TSU_I18N.add({ "欢迎": "Welcome" });
  window.TSU_WELCOME = { open: open };
})();
