// apps.js —— 活动栏上的「App」（连接器下面那一格，图标是一格格的点，同启动台）：Vibing Studio 里的 App 从这里打开
//   一份登记表，同连接器、扩展：id、名字、说明、图标、find(tw)（开着的那一页，没有是 null）、open(tw, fresh)（开着就切过去；fresh 是新开一页）、
//   ok()（这台设备上能不能用）；内置的现在四个：Agent Finder、File Finder（共用 dash.js 的 explorer 页）、终端（新开一个 shell 标签页，不进任何 agent）、浏览器（webview.js）。
//   以后加的走 STUDIO.apps.add({ … })，列表、命令面板跟着有
//   主侧栏「App」：一组「内置」（不折叠），一行一个——图标、名字、一句说明，开着的右边一个点；单击打开，右键「打开」「在新标签页中打开」
(function () {
  "use strict";
  var S = window.STUDIO;
  if (!S || !S.addView || !S.openPage) return;
  var I18N = window.TSU_I18N;
  var t = function (zh, en) { return I18N && I18N.lang && I18N.lang() === "en" ? en : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var T = function () { return window.TSU_TERM; };
  var front = function () { return T() && T().front ? T().front() : null; };
  var iosApp = function () { return !!(window.vsApp && window.webkit && webkit.messageHandlers && webkit.messageHandlers.vsApp); };

  // ---- 活动栏上的图标（24 格）：三行三列的点 ----
  var ICON24 = (function () {
    var d = "";
    [5.5, 12, 18.5].forEach(function (y) { [5.5, 12, 18.5].forEach(function (x) { d += '<circle cx="' + x + '" cy="' + y + '" r="1.8"/>'; }); });
    return '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">' + d + "</svg>";
  })();

  // ---- App 的图标：同标签页上的那个（16 格的细线，跟着主题的字色）——不另画一套彩色的方块 ----
  var LI = function (b) { return function () { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' + b + "</svg>"; }; };
  var LOGO = {
    // Agent Finder：一格格的包、一颗 ✦（同 dash.js 的 AGENTS_ICON）
    agents: LI('<rect x="2" y="2" width="5" height="5" rx="1.4"/><rect x="9" y="2" width="5" height="5" rx="1.4"/><rect x="2" y="9" width="5" height="5" rx="1.4"/><path d="M11.5 9.2c.2 1.2.8 1.8 2 2-1.2.2-1.8.8-2 2-.2-1.2-.8-1.8-2-2 1.2-.2 1.8-.8 2-2z"/>'),
    // File Finder：文件夹（同 FINDER_ICON）
    files: LI('<path d="M1.8 4.2c0-.6.4-1 1-1h3.1l1.4 1.5h5.9c.6 0 1 .4 1 1v6.6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z"/><path d="M1.8 6.6h12.4"/>'),
    // 终端：一个窗口里一个提示符（同终端标签页上的）
    term: LI('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.8"/><path d="M4.6 6.2l2 1.8-2 1.8M8.4 10.1h3"/>'),
    // 浏览器：地球（同浏览器标签页上的）
    web: LI('<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c1.8 1.8 2.6 3.8 2.6 6s-.8 4.2-2.6 6M8 2C6.2 3.8 5.4 5.8 5.4 8s.8 4.2 2.6 6"/>'),
  };

  // ---- 登记表 ----
  var APPS = [], views = []; // views：开着的「App」视图（每个窗口一个），登记表变了跟着重画
  function paintAll() { views.forEach(function (el) { if (el.paint) el.paint(); }); }
  // 这个窗口里开着的、test(program) 为真的那一页（几组编辑器都找）
  function findTab(tw, test) {
    var hit = null;
    if (!tw || !tw.ws) return null;
    (tw.ws.all ? tw.ws.all() : []).forEach(function (p) { if (!hit && p.program && test(p.program)) hit = p; });
    return hit;
  }
  function reveal(tw, p) { if (tw.ws.show) tw.ws.show(p); else tw.ws.activate(p); p.focus(); return p; }
  function newTab(tw, page, arg) { var P = tw.ws.active; return tw.ws.newTab({ sh: { cwd: P && P.shell && P.shell.cwd ? P.shell.cwd() : "" }, page: page, arg: arg }); }
  // explorer 这一页是哪个 App：地址是 finder.local.paimon… 的是 File Finder，别的是 Agent Finder
  var finderKind = function (arg) { var ex = S.pages && S.pages.explorer; return ex && ex.address && /^finder\./.test(ex.address(arg || "")) ? "files" : "agents"; };
  function add(a) {
    if (!a || !a.id) return;
    APPS = APPS.filter(function (x) { return x.id !== a.id; }).concat([a]);
    if (S.command) S.command("app." + a.id, { title: function () { return t("打开 ", "Open ") + nameOf(a); }, run: function (tw) { openApp(a, tw || front()); } });
    paintAll();
  }
  var nameOf = function (a) { return typeof a.name === "function" ? a.name() : a.name; };
  var descOf = function (a) { return typeof a.desc === "function" ? a.desc() : a.desc || ""; };
  var okOf = function (a) { return !a.ok || a.ok(); };
  function openApp(a, tw, fresh) {
    tw = tw || front();
    if (!tw || !okOf(a)) return null;
    var p = !fresh && !a.always && a.find ? a.find(tw) : null; // always：每次都新开一个（终端）
    return p ? reveal(tw, p) : a.open(tw, !!fresh);
  }

  add({
    id: "agent-finder", builtin: true, name: "Agent Finder", logo: LOGO.agents,
    desc: function () { return t("按文件夹浏览会话", "Sessions by folder"); },
    find: function (tw) { return findTab(tw, function (pr) { return pr.page === "explorer" && finderKind(pr.arg) === "agents"; }); },
    open: function (tw, fresh) { return fresh ? newTab(tw, "explorer", "agents") : S.openPage(tw, "explorer", "agents"); },
  });
  add({
    id: "file-finder", builtin: true, name: "File Finder", logo: LOGO.files,
    desc: function () { return okOf(this) ? t("这台 Mac 上的文件", "Files on this Mac") : t("连接 Mac 后可用", "Available after connecting a Mac"); },
    ok: function () { return !!window.TSU_LOCAL; }, // 没有 Mac 的文件（网页端还没连上 Mac）：灰着
    find: function (tw) { return findTab(tw, function (pr) { return pr.page === "explorer" && finderKind(pr.arg) === "files"; }); },
    open: function (tw, fresh) { return fresh ? newTab(tw, "explorer", "") : S.openPage(tw, "explorer", ""); },
  });
  add({
    id: "terminal", builtin: true, always: true, name: function () { return t("终端", "Terminal"); }, logo: LOGO.term,
    desc: function () { return okOf(this) ? t("新的 shell 标签页", "A new shell tab") : t("连接 Mac 后可用", "Available after connecting a Mac"); },
    ok: function () { return !!window.TSU_LOCAL; },
    find: function (tw) { return findTab(tw, function (pr) { return !!pr.pty; }); },
    // 从当前这个终端的目录开（同 iTerm 的新标签页）；不是终端就从家目录
    open: function (tw) {
      var P = tw.ws.active, L = window.TSU_LOCAL, i = L && L.info && L.info();
      var cwd = P && P.program && P.program.pty && P.shell && P.shell.cwd ? P.shell.cwd() : (i && i.home) || "";
      return tw.ws.newTab({ sh: { cwd: cwd, pty: true } });
    },
  });
  add({
    id: "browser", builtin: true, name: function () { return t("浏览器", "Browser"); }, logo: LOGO.web,
    desc: function () { return t("在标签页中打开网页", "Web pages in a tab"); },
    find: function (tw) { return findTab(tw, function (pr) { return pr.page === "web"; }); },
    // iPhone / iPad App：先开一页带地址栏的空白页，输了网址交给 App 自己的 Safari 视图（webview.js）
    open: function (tw, fresh) { return fresh || iosApp() ? newTab(tw, "web", "") : S.openBrowser ? S.openBrowser(tw) : S.openPage(tw, "web", ""); },
  });

  // ======== 主侧栏的「App」视图 ========
  function makeView(tw) {
    var el = document.createElement("div"), sel = "";
    el.className = "apv";
    el.innerHTML = '<div class="st-shdr"><span class="st-vtitle"></span><span class="st-fill"></span></div><div class="apv-list" tabindex="0"></div>';
    var box = el.querySelector(".apv-list");
    var rowHtml = function (a) {
      var ok = okOf(a), open = ok && a.find && a.find(tw);
      return '<div class="apv-row' + (a.id === sel ? " on" : "") + (ok ? "" : " off") + '" data-app="' + esc(a.id) + '">' +
        '<span class="apv-ic">' + (typeof a.logo === "function" ? a.logo() : a.logo || "") + "</span>" +
        '<span class="apv-main"><span class="apv-name">' + esc(nameOf(a)) + "</span></span>" + // 只写名字（不再跟一句说明）
        (open ? '<i class="apv-dot" title="' + esc(t("已打开", "Open")) + '"></i>' : "") + "</div>";
    };
    el.paint = function () {
      el.querySelector(".st-vtitle").textContent = t("App", "Apps");
      var top = box.scrollTop, groups = [{ title: t("内置", "Built-in"), items: APPS.filter(function (a) { return a.builtin; }) }, { title: t("已添加", "Added"), items: APPS.filter(function (a) { return !a.builtin; }) }];
      // 组标题不折叠（App 不多）；没有东西的组不画
      box.innerHTML = groups.filter(function (g) { return g.items.length; }).map(function (g) {
        return '<div class="apv-sec"><div class="apv-sech">' + esc(g.title) + '</div><div class="apv-rows">' + g.items.map(rowHtml).join("") + "</div></div>";
      }).join("");
      box.scrollTop = top;
    };
    var byId = function (id) { return APPS.filter(function (a) { return a.id === id; })[0] || null; };
    var order = function () { return Array.prototype.map.call(box.querySelectorAll(".apv-row:not(.off)"), function (r) { return r.dataset.app; }); };
    var select = function (id) { sel = id; box.querySelectorAll(".apv-row").forEach(function (r) { r.classList.toggle("on", r.dataset.app === id); }); var r = box.querySelector('.apv-row[data-app="' + CSS.escape(id) + '"]'); if (r) r.scrollIntoView({ block: "nearest" }); };
    var menuFor = function (a) {
      return [
        { label: t("打开", "Open"), disabled: !okOf(a), run: function () { openApp(a, tw); } },
        { label: t("在新标签页中打开", "Open in New Tab"), disabled: !okOf(a), run: function () { openApp(a, tw, true); } },
      ];
    };
    box.addEventListener("click", function (e) {
      var r = e.target.closest(".apv-row"), a = r && byId(r.dataset.app);
      if (!a) return;
      select(a.id);
      if (!okOf(a)) return;
      openApp(a, tw, e.metaKey || e.ctrlKey); // ⌘ 点：新开一页（同浏览器里 ⌘ 点链接）
      el.paint();
    });
    box.addEventListener("contextmenu", function (e) {
      var r = e.target.closest(".apv-row"), a = r && byId(r.dataset.app);
      if (!a) return;
      e.preventDefault();
      select(a.id);
      S.menu(menuFor(a), { x: e.clientX, y: e.clientY });
    });
    box.addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var ids = order(), i = ids.indexOf(sel);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (ids.length) select(ids[Math.max(0, Math.min(ids.length - 1, i < 0 ? 0 : i + (e.key === "ArrowDown" ? 1 : -1)))]); }
      else if (e.key === "Home" || e.key === "End") { e.preventDefault(); if (ids.length) select(ids[e.key === "Home" ? 0 : ids.length - 1]); }
      else if (e.key === "Enter" && sel) { e.preventDefault(); var a = byId(sel); if (a) { openApp(a, tw); el.paint(); } }
    });
    el.paint();
    views.push(el);
    return el;
  }
  // 活动栏：连接器下面（Agents、文件、搜索、连接器、App）
  S.addView("apps", {
    title: "App", icon: ICON24, sym: "square.grid.3x3", order: 4,
    create: function (tw) { return makeView(tw); },
    show: function (el, tw, fromBar) { el.paint(); if (!fromBar) el.querySelector(".apv-list").focus({ preventScroll: true }); },
  });
  // 开着的点：标签页开了、关了跟着变（看得见时才画）
  setInterval(function () { views.forEach(function (el) { if (el.isConnected && el.offsetParent) el.paint(); }); }, 1500);
  if (I18N && I18N.onChange) I18N.onChange(paintAll);

  S.apps = { add: add, list: function () { return APPS.slice(); }, open: function (id, tw, fresh) { var a = APPS.filter(function (x) { return x.id === id; })[0]; return a ? openApp(a, tw, fresh) : null; } };
})();
