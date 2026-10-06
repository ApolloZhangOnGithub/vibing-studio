// extview.js —— 连接器视图（活动栏上原来「扩展」那一格，同 VS Code 的扩展视图的样子）+ 详情页
//   列表里是连接器（Paimon、这台 Mac 上的 Claude Code、Codex——会话在哪里跑），开关、状态（版本 · 命令在哪）、设置、新建会话都在这里；
//   真正额外装的扩展（现在没有）有的话跟在后面。「设置 › 连接器」是同一份开关
//   主侧栏「扩展」：上面搜索框（也认 @installed / @recommended），下面「已安装」「推荐」两组（能折叠，右边是个数）；
//     每行：图标、名字、一句说明、发布者（已验证的带个章）、右下角 ⚙（没装的是「安装」）；点一行在编辑区打开它的详情页，右键同 ⚙
//   详情页（标签页「扩展: 名字」）：大图标、名字、发布者 · 版本、说明、安装 / 卸载（带 ⌄）、自动更新、⚙；
//     「细节」是说明文档，「功能」是它加进来的命令、设置、视图、地址；右边「安装」（标识符、版本、上次更新、大小）、「市场」（发布者、类型、类别、资源）
//   字按当前语言直接写（中文 / English），换语言时重画；扩展的数据见 ext.js
(function () {
  "use strict";
  var S = window.STUDIO, X = window.TSU_EXT, C = window.TSU_CONNECTORS;
  if (!S || !S.addView || !S.pages || !X) return;
  var I18N = window.TSU_I18N;
  var lang = function () { return I18N && I18N.lang ? I18N.lang() : "zh"; };
  var t = function (zh, en) { return lang() === "en" ? en : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var T = function () { return window.TSU_TERM; };
  var front = function () { return T() && T().front ? T().front() : null; };
  var MI = S.menuIcons ? S.menuIcons() : {};
  // 扩展、连接器的详情页都能开（连接器不在扩展列表里：Claude Code、Codex 在「设置 › 连接器」）
  var find = function (id) { return (X.get ? X.get(id) : X.list().filter(function (x) { return x.id === id; })[0]) || null; };
  var fullId = function (x) { return (x.publisherId ? x.publisherId + "." : "") + x.id; };
  var descOf = function (x) { return t(x.desc || "", x.descEn || x.desc || ""); };

  // ---- 图标（16 格线条，同菜单里的）----
  var IC = function (b) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' + b + "</svg>"; };
  var ICON = {
    refresh: IC('<path d="M13 7.6A5 5 0 1 1 11.5 4"/><path d="M11.9 1.8v2.6H9.3"/>'),
    filter: IC('<path d="M2.2 3.2h11.6L9.3 8.6v4.2l-2.6 1.4V8.6z"/>'),
    clear: IC('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'),
    chevD: IC('<path d="M4 6l4 4 4-4"/>'),
    chevR: IC('<path d="M6 4l4 4-4 4"/>'),
    // 齿轮：同活动栏上「管理」那个（24 格画的，缩到 16）
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    trash: IC('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4"/>'),
    download: IC('<path d="M8 2.5v8M4.8 7.4L8 10.6l3.2-3.2M3 13.5h10"/>'),
    copy: IC('<rect x="5.5" y="5.5" width="8" height="8" rx="1.4"/><path d="M10.5 5.5V3.9a1.4 1.4 0 0 0-1.4-1.4H3.9a1.4 1.4 0 0 0-1.4 1.4v5.2a1.4 1.4 0 0 0 1.4 1.4h1.6"/>'),
    hash: IC('<path d="M6.3 2.5l-1.4 11M11.1 2.5l-1.4 11M3 6h11M2.3 10h11"/>'),
    info: IC('<circle cx="8" cy="8" r="6"/><path d="M8 7.2v4M8 4.9v.1"/>'),
    reload: IC('<path d="M13 7.6A5 5 0 1 1 11.5 4"/><path d="M11.9 1.8v2.6H9.3"/>'),
    link: IC('<path d="M9.5 2.5h4v4M13.5 2.5L8 8M12 9.5v3.5H3V4h3.5"/>'),
    file: IC('<path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5h3.5"/>'),
    all: IC('<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>'),
    installed: IC('<path d="M3.2 8.4l3 3 6.6-6.6"/>'),
    star: IC('<path d="M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4L2.2 6.5l4-.6z"/>'),
    collapse: IC('<rect x="2.5" y="2.5" width="11" height="11" rx="1.6"/><path d="M5.4 8h5.2"/>'),
    off: IC('<circle cx="8" cy="8" r="5.5"/><path d="M4.2 11.8l7.6-7.6"/>'),
    plus: IC('<path d="M8 3v10M3 8h10"/>'),
  };
  // 连接器：插头（活动栏 24 格、标签页 16 格）
  var PLUG24 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v4.5M15 3v4.5"/><path d="M6.5 7.5h11v3.2a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.2V21"/></svg>';
  var PLUG16 = IC('<path d="M6 2v3M10 2v3"/><path d="M4.3 5h7.4v2.2a3.7 3.7 0 0 1-7.4 0z"/><path d="M8 10.9V14"/>');
  var isConn = function (x) { return !!(x && C && C.get && C.get(x.id)); };
  var local = function () { return !!(window.nadosNative && nadosNative.local); };
  // 列表里的：连接器在前，真正额外装的扩展（现在没有）在后
  var items = function () { return (C && C.list ? C.list() : []).concat(X.list()); };
  // 活动栏上的（24 格，同 studio.js 原来那个）；标签页上的小图标（16 格）
  var ICON24 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="9.5" width="6" height="6" rx=".6"/><rect x="3.5" y="15.5" width="6" height="6" rx=".6"/><rect x="9.5" y="15.5" width="6" height="6" rx=".6"/><rect x="13.5" y="3.5" width="7" height="7" rx=".6"/></svg>';
  var EXT16 = IC('<rect x="2.3" y="6.3" width="4" height="4" rx=".5"/><rect x="2.3" y="10.3" width="4" height="4" rx=".5"/><rect x="6.3" y="10.3" width="4" height="4" rx=".5"/><rect x="9" y="2.3" width="4.7" height="4.7" rx=".5"/>');
  // 已验证的发布者：一枚带勾的章（颜色同强调色）
  var VERIFIED = '<svg class="xv-seal" viewBox="0 0 16 16"><path d="M8 1.1l1.6 1.2 2-.1.6 1.9 1.6 1.2-.7 1.9.7 1.9-1.6 1.2-.6 1.9-2-.1L8 14.9l-1.6-1.2-2 .1-.6-1.9-1.6-1.2.7-1.9-.7-1.9 1.6-1.2.6-1.9 2 .1z" fill="currentColor"/><path d="M5.3 8.2l1.8 1.8 3.6-3.8" fill="none" style="stroke: var(--xv-on, #fff)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // 扩展的图标：它自己的 SVG（渐变的 id 每次换一个，同一页上放几份不打架）；没有的：一块颜色里一个字
  var LSEQ = 0;
  function logo(x, px) {
    var box = ' style="width:' + px + "px;height:" + px + 'px"';
    if (x.logo) return '<span class="xv-logo"' + box + ">" + x.logo.replace(/__ID__/g, "xvg" + (++LSEQ)) + "</span>";
    return '<span class="xv-logo xv-logo-gen" style="width:' + px + "px;height:" + px + "px;font-size:" + Math.round(px * 0.46) + "px;--c:" + esc(x.color || "#6b7280") + '">' + esc(x.icon || String(x.name || "?").charAt(0)) + "</span>";
  }
  // 强调色上的字：按强调色的亮度挑黑或白（VS Code 的蓝上是白字，Paimon 的浅蓝上是黑字）
  function onColor() {
    var c = getComputedStyle(document.documentElement).getPropertyValue("--st-focus").trim() || getComputedStyle(document.documentElement).getPropertyValue("--st-blue").trim() || "#0078d4", rgb = null, m;
    if ((m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c))) { var h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]; rgb = [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
    else if ((m = /rgba?\(([^)]+)\)/i.exec(c))) rgb = m[1].split(",").slice(0, 3).map(function (v) { return parseFloat(v); });
    if (!rgb) return "#fff";
    var L = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2] > 0.3 ? "#000" : "#fff";
  }
  function copy(s) {
    var fallback = function () { var ta = document.createElement("textarea"); ta.value = s; ta.style.cssText = "position:fixed;left:-9999px;top:0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) { /* 复制不了就算了 */ } ta.remove(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).catch(fallback); else fallback();
  }
  var infoText = function (x) { return [t("名称", "Name") + ": " + x.name, "Id: " + fullId(x), t("说明", "Description") + ": " + descOf(x), t("版本", "Version") + ": " + (x.version || ""), t("发布者", "Publisher") + ": " + (x.publisher || "")].join("\n"); };
  var home = function () { var L = window.TSU_LOCAL, i = L && L.info && L.info(); return i ? i.home : ""; };
  function openRes(tw, l) {
    if (l.url) { if (window.TSU_WEB && TSU_WEB.open) TSU_WEB.open(tw, l.url); else if (T() && T().openLink) T().openLink(l.url); return; }
    if (l.file && home() && S.openFile) S.openFile(tw, l.file.replace(/^~(?=\/|$)/, home()));
  }
  // 大小：它的代码（ext.js 里的 files）加起来——就用页面已经载入的那几份（浏览器缓存里拿）
  var sizes = {};
  function sizeOf(x) {
    if (sizes[x.id] || !x.files || !x.files.length) return Promise.resolve(sizes[x.id] || "");
    return Promise.all(x.files.map(function (f) { return fetch(f, { cache: "force-cache", credentials: "same-origin" }).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) { return b ? b.size : 0; }, function () { return 0; }); }))
      .then(function (ns) { var n = ns.reduce(function (a, b) { return a + b; }, 0); if (n) sizes[x.id] = n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(2) + " MB"; return sizes[x.id] || ""; });
  }
  // 连接器的状态：内置 / 版本 · 命令在哪（家目录写成 ~）/ 没找到命令 / 正在检测（同「设置 › 连接器」第一级那一行）
  function connStatus(x) {
    if (x.core) return t("内置", "Built-in");
    if (!local()) return t("只能在 Vibing Studio App 中使用", "Only in the Vibing Studio app");
    var f = C.found && C.found(x.id);
    if (!f) return t("正在检测…", "Detecting…");
    if (!f.found) return t("这台 Mac 上没有找到 " + x.cmd + " 命令", "No " + x.cmd + " command on this Mac");
    var ver = f.version ? (String(f.version).match(/\d+(?:\.\d+)+/) || [""])[0] : "", h = home();
    return ver || t("已找到", "Found"); // 只写版本（路径在指上去的提示里）
  }
  // 连着的那个工具：「Claude Code 2.1.281」（找不到就说找不到；内置的写内置）
  function toolLine(x) {
    if (x.core) return t("内置", "Built-in");
    if (!local()) return connStatus(x);
    var f = C.found && C.found(x.id);
    if (!f) return t("正在检测…", "Detecting…");
    if (!f.found) return connStatus(x);
    var ver = f.version ? (String(f.version).match(/\d+(?:\.\d+)+/) || [""])[0] : "";
    return (x.name || x.id) + (ver ? " " + ver : "") + t(" · 已连接", " · connected");
  }
  var connBad = function (x) { var f = !x.core && local() && C.found && C.found(x.id); return !!(f && !f.found); };
  var dateOf = function (s) { if (!s) return ""; var d = new Date(s + "T00:00:00"); return isNaN(d) ? s : d.toLocaleDateString(lang() === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "long", day: "numeric" }); };

  // ---- 一个扩展的菜单（行上的 ⚙、右键、详情页的 ⚙）----
  function extMenu(tw, x) {
    var on = X.on(x.id);
    // 连接器：只有停用 / 暂时停用（这次打开 App 期间；重新打开 App 就回来）；关着的是启用。菜单不带图标（带了显得廉价）
    if (isConn(x)) return on ? [
      { label: t("停用", "Disable"), sym: "", run: function () { C.set(x.id, false); } },
      { label: t("暂时停用（重新打开 App 后恢复）", "Disable Until Restart"), sym: "", run: function () { if (C.tmpOff) C.tmpOff(x.id, true); } },
    ] : [
      { label: t("启用", "Enable"), sym: "", disabled: !x.core && !local(), run: function () { if (C.tmpOff) C.tmpOff(x.id, false); C.set(x.id, true); } },
      { label: t("只这次启用（重新打开 App 后停用）", "Enable Until Restart"), sym: "", disabled: !x.core && !local(), run: function () { if (C.tmpOff) C.tmpOff(x.id, "on"); } },
    ];
    return [
      on ? { label: t("卸载", "Uninstall"), icon: ICON.trash, sym: "trash", run: function () { X.set(x.id, false); } }
        : { label: t("安装", "Install"), icon: ICON.download, sym: "arrow.down.circle", run: function () { X.set(x.id, true); } },
      { sep: true },
      on && x.settings ? { label: t("扩展设置", "Extension Settings"), icon: ICON.gear, sym: "gearshape", run: function () { S.settings(tw, x.settings); } } : null,
      { label: t("复制", "Copy"), icon: ICON.copy, sym: "doc.on.doc", run: function () { copy(infoText(x)); } },
      { label: t("复制扩展 ID", "Copy Extension ID"), icon: ICON.hash, sym: "number", run: function () { copy(fullId(x)); } },
      { sep: true },
      { label: t("查看详情", "Show Details"), icon: ICON.info, sym: "info.circle", run: function () { openDetail(tw, x.id, true); } },
    ].filter(Boolean);
  }
  // 详情页：已经开着扩展详情的标签页就在那一页里换（同 VS Code 只占一个），不然开一页
  function openDetail(tw, id, focus) {
    tw = tw || front();
    if (!tw) return;
    var hit = null;
    tw.ws.tabs.forEach(function (tb, i) { tw.ws.leaves(tb.root).forEach(function (l) { var pr = l.pane.program; if (!hit && pr && pr.page === "extension") hit = { i: i, p: l.pane }; }); });
    if (hit) {
      tw.ws.select(hit.i); tw.ws.activate(hit.p);
      if (hit.p.program.arg !== id) { hit.p.program.tab = "details"; hit.p.program.go(id); }
      if (focus) hit.p.focus();
      return hit.p;
    }
    return S.openPage(tw, "extension", id);
  }

  // ======== 主侧栏的「扩展」视图 ========
  var ST = (function () { try { return JSON.parse(localStorage.getItem("st-xv") || "{}") || {}; } catch (e) { return {}; } })();
  ST.fold = ST.fold || {};
  var keepST = function () { try { localStorage.setItem("st-xv", JSON.stringify(ST)); } catch (e) { /* 满了 */ } };
  var views = [];
  // 搜：名字、说明（两种语言）、发布者、id；@installed / @recommended 只看装了的 / 没装的
  function query(q) {
    var inst = null, words = [];
    String(q || "").trim().toLowerCase().split(/\s+/).forEach(function (w) {
      if (!w) return;
      if (w === "@installed" || w === "@enabled") inst = true;
      else if (w === "@recommended" || w === "@available" || w === "@disabled") inst = false;
      else words.push(w);
    });
    var hits = items().filter(function (x) {
      if (inst !== null && X.on(x.id) !== inst) return false;
      var hay = [x.name, x.desc, x.descEn, x.publisher, fullId(x)].join(" ").toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    return { inst: inst, words: words, hits: hits };
  }
  function makeView(tw) {
    var el = document.createElement("div"), q = "", sel = ST.sel || "", order = [];
    el.className = "xv";
    el.innerHTML = '<div class="st-shdr"><span class="st-vtitle"></span><span class="st-fill"></span><button class="st-hbtn" data-a="refresh"></button><button class="st-hbtn" data-a="more"></button></div>' +
      '<div class="xv-top"><div class="xv-search"><input class="xv-q" type="text" spellcheck="false" autocomplete="off"><button class="xv-sbtn" data-a="clear" hidden></button><button class="xv-sbtn" data-a="filter"></button></div></div>' +
      '<div class="xv-list" tabindex="0"></div>';
    var input = el.querySelector(".xv-q"), box = el.querySelector(".xv-list");
    var rowHtml = function (x) {
      var on = X.on(x.id), conn = isConn(x);
      // 列表里第三行：连接器自己的版本（v0.2.0）；连着的那个工具的版本、在哪，指上去看（详情页的状态行里也有）
      var l3 = conn ? '<span class="xv-pub xv-cst' + (connBad(x) ? " neg" : "") + '" title="' + esc(toolLine(x)) + '"><i class="xv-cdot' + (on ? " on" : "") + '"></i><span>' + esc(x.version ? "v" + x.version : x.core ? t("内置", "Built-in") : connStatus(x)) + "</span></span>"
        : '<span class="xv-pub">' + (x.verified ? '<span class="xv-sealw" title="' + esc(t("已验证的发布者", "Verified publisher")) + '">' + VERIFIED + "</span>" : "") + "<span>" + esc(x.publisher || "") + "</span></span>";
      return '<div class="xv-row' + (x.id === sel ? " on" : "") + (on ? "" : " off") + '" data-x="' + esc(x.id) + '"><span class="xv-ic">' + logo(x, 42) + '</span><span class="xv-main">' +
        '<span class="xv-name">' + esc(x.name) + '</span><span class="xv-desc">' + esc(descOf(x)) + "</span>" +
        '<span class="xv-l3">' + l3 + '<span class="xv-fill"></span>' +
        (on ? (conn && !x.settings ? "" : '<button class="xv-gear" data-a="gear" title="' + esc(t("设置", "Settings")) + '">' + ICON.gear + "</button>") : '<button class="xv-install" data-a="install"' + (conn && !x.core && !local() ? " disabled" : "") + ">" + esc(conn ? t("启用", "Enable") : t("安装", "Install")) + "</button>") +
        "</span></span></div>";
    };
    var mark = function () { box.querySelectorAll(".xv-row").forEach(function (r) { r.classList.toggle("on", r.dataset.x === sel); }); };
    el.paint = function () {
      // 跟着语言换的字
      el.querySelector(".st-vtitle").textContent = t("连接器", "Connectors");
      var rb = el.querySelector('[data-a="refresh"]'), mb = el.querySelector('[data-a="more"]'), cb = el.querySelector('[data-a="clear"]'), fb = el.querySelector('[data-a="filter"]');
      rb.title = t("重新检测", "Detect Again"); rb.innerHTML = ICON.refresh;
      mb.title = t("更多操作", "More Actions"); mb.innerHTML = (S.icons && S.icons.more) || "···";
      cb.title = t("清除", "Clear"); cb.innerHTML = ICON.clear; cb.hidden = !q;
      fb.title = t("筛选…", "Filter…"); fb.innerHTML = ICON.filter;
      input.placeholder = t("搜索连接器", "Search Connectors");
      el.style.setProperty("--xv-on", onColor());
      var f = query(q), secs;
      if (q.trim()) {
        var ti = !f.words.length && f.inst === true ? t("已启用", "Enabled") : !f.words.length && f.inst === false ? t("未启用", "Disabled") : t("搜索结果", "Search Results");
        fb.classList.toggle("on", f.inst !== null);
        secs = [{ id: "results", title: ti, items: f.hits, empty: t("没有找到", "Nothing found") }];
      } else {
        fb.classList.remove("on");
        var all = items(), core = function (x) { var c = window.TSU_CONNECTORS && TSU_CONNECTORS.get(x.id); return !!(c && c.core); };
        var conns = all.filter(function (x) { return !core(x); }), builtin = all.filter(core);
        // 不分「已启用 / 未启用」两栏（同 VS Code 装好的扩展）：一组，开着的在上面照常，关着的灰的排在下面。
        //   「默认」：Claude Code、Codex（不折叠）；「扩展（内置）」：Paimon（Studio 内置的助手）；「扩展（第三方）」：别人做的（third 为真的，比如 pi）
        var third = conns.filter(function (x) { var c = window.TSU_CONNECTORS && TSU_CONNECTORS.get(x.id); return !!(c && c.third); }), dflt = conns.filter(function (x) { return third.indexOf(x) < 0; });
        var onFirst = function (l) { return l.filter(function (x) { return X.on(x.id); }).concat(l.filter(function (x) { return !X.on(x.id); })); };
        secs = [{ id: "all", title: t("默认", "Default"), fixed: true, items: onFirst(dflt), empty: t("没有连接器", "No connectors") }];
        if (builtin.length) secs.push({ id: "builtin", title: t("扩展（内置）", "Extensions (Built-in)"), items: builtin, empty: "" });
        if (third.length) secs.push({ id: "third", title: t("扩展（第三方）", "Extensions (Third-party)"), items: onFirst(third), empty: "" });
      }
      order = [];
      var top = box.scrollTop;
      box.innerHTML = secs.map(function (s) {
        var folded = !s.fixed && !!ST.fold[s.id];
        if (!folded) s.items.forEach(function (x) { order.push(x.id); });
        if (!s.title || s.fixed) return '<div class="xv-sec" data-sec="' + s.id + '">' + (s.title ? '<div class="xv-sech xv-fixed"><span class="xv-sect">' + esc(s.title) + "</span></div>" : "") + '<div class="xv-rows">' + (s.items.map(rowHtml).join("") || '<div class="xv-empty">' + esc(s.empty) + "</div>") + "</div></div>"; // 不折叠的一组：只有标题（没有箭头、数字）
        return '<div class="xv-sec' + (folded ? " fold" : "") + '" data-sec="' + s.id + '"><div class="xv-sech" data-a="fold">' + (folded ? ICON.chevR : ICON.chevD) + '<span class="xv-sect">' + esc(s.title) + '</span><span class="xv-fill"></span><span class="xv-count">' + s.items.length + "</span></div>" +
          (folded ? "" : '<div class="xv-rows">' + (s.items.map(rowHtml).join("") || '<div class="xv-empty">' + esc(s.empty) + "</div>") + "</div>") + "</div>";
      }).join("");
      box.scrollTop = top;
    };
    var select = function (id, reveal) { sel = id; ST.sel = id; keepST(); mark(); if (reveal) { var r = box.querySelector('.xv-row[data-x="' + CSS.escape(id) + '"]'); if (r) r.scrollIntoView({ block: "nearest" }); } };
    var setQ = function (v) { q = v; input.value = v; el.paint(); };
    var moreMenu = function () {
      return [
        { label: t("显示已启用的", "Show Enabled"), icon: ICON.installed, sym: "checkmark.circle", run: function () { setQ("@enabled"); input.focus(); } },
        { label: t("显示未启用的", "Show Disabled"), icon: ICON.off, sym: "nosign", run: function () { setQ("@disabled"); input.focus(); } },
        { label: t("显示全部", "Show All"), icon: ICON.all, sym: "list.bullet", run: function () { setQ(""); input.focus(); } },
        { sep: true },
        local() ? { label: t("重新检测 claude、codex 命令", "Detect claude and codex Again"), icon: ICON.refresh, sym: "arrow.clockwise", run: function () { if (C && C.detect) C.detect().then(repaintSoon); } } : null,
        { label: t("连接器设置…", "Connector Settings…"), icon: ICON.gear, sym: "gearshape", run: function () { S.settings(tw, "connectors"); } },
        { sep: true },
        { label: t("全部折叠", "Collapse All"), icon: ICON.collapse, sym: "rectangle.compress.vertical", run: function () { ["installed", "recommended", "results"].forEach(function (k) { ST.fold[k] = true; }); keepST(); el.paint(); } },
      ].filter(Boolean);
    };
    var filterMenu = function () {
      var f = query(q);
      var pick = function (tok) { var rest = q.split(/\s+/).filter(function (w) { return w && !/^@/.test(w); }); setQ((tok ? [tok] : []).concat(rest).join(" ")); input.focus(); };
      return [
        { label: t("已启用", "Enabled"), icon: ICON.installed, sym: "checkmark.circle", radio: true, checked: f.inst === true, run: function () { pick("@enabled"); } },
        { label: t("未启用", "Disabled"), icon: ICON.off, sym: "nosign", radio: true, checked: f.inst === false, run: function () { pick("@disabled"); } },
        { label: t("全部", "All"), icon: ICON.all, sym: "list.bullet", radio: true, checked: f.inst === null, run: function () { pick(""); } },
      ];
    };
    el.querySelector(".st-shdr").addEventListener("click", function (e) {
      var b = e.target.closest("[data-a]");
      if (!b) return;
      if (b.dataset.a === "refresh") { if (X.refresh) X.refresh(); if (C && C.detect && local()) C.detect().then(repaintSoon); el.paint(); }
      if (b.dataset.a === "more") S.menu(moreMenu, { el: b, side: "below-end" });
    });
    el.querySelector(".xv-search").addEventListener("click", function (e) {
      var b = e.target.closest("[data-a]");
      if (!b) return;
      if (b.dataset.a === "clear") { setQ(""); input.focus(); }
      if (b.dataset.a === "filter") S.menu(filterMenu, { el: b, side: "below-end" });
    });
    el.querySelector(".xv-search").addEventListener("mousedown", function (e) { if (e.target.closest("button")) e.preventDefault(); }); // 点按钮不让搜索框失焦
    input.addEventListener("input", function () { q = input.value; el.paint(); });
    input.addEventListener("keydown", function (e) {
      if (e.isComposing) return;
      if (e.key === "ArrowDown") { e.preventDefault(); if (order.length) { box.focus({ preventScroll: true }); select(order.indexOf(sel) >= 0 ? sel : order[0], true); } }
      else if (e.key === "Escape" && q) { e.preventDefault(); setQ(""); }
      else if (e.key === "Enter" && order.length) { e.preventDefault(); box.focus({ preventScroll: true }); select(order[0], true); openDetail(tw, order[0]); }
    });
    box.addEventListener("click", function (e) {
      var h = e.target.closest('[data-a="fold"]');
      if (h) { var k = h.parentNode.dataset.sec; ST.fold[k] = !ST.fold[k]; keepST(); el.paint(); return; }
      var r = e.target.closest(".xv-row");
      if (!r) return;
      var x = find(r.dataset.x), b = e.target.closest("[data-a]");
      if (!x) return;
      select(x.id);
      if (b && b.dataset.a === "gear") return S.menu(extMenu(tw, x), { el: b, side: "below-end" });
      if (b && b.dataset.a === "install") { if (!b.disabled) X.set(x.id, true); return; }
      openDetail(tw, x.id);
      setTimeout(function () { if (document.contains(box)) box.focus({ preventScroll: true }); }, 0); // 同 VS Code：单击是预览，焦点留在列表里
    });
    box.addEventListener("contextmenu", function (e) {
      var r = e.target.closest(".xv-row"), x = r && find(r.dataset.x);
      if (!x) return;
      e.preventDefault();
      select(x.id);
      S.menu(extMenu(tw, x), { x: e.clientX, y: e.clientY });
    });
    box.addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var i = order.indexOf(sel);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!order.length) return; if (e.key === "ArrowUp" && i <= 0) return input.focus(); select(order[Math.max(0, Math.min(order.length - 1, i < 0 ? 0 : i + (e.key === "ArrowDown" ? 1 : -1)))], true); }
      else if (e.key === "Home" || e.key === "End") { e.preventDefault(); if (order.length) select(order[e.key === "Home" ? 0 : order.length - 1], true); }
      else if (e.key === "Enter" && sel) { e.preventDefault(); openDetail(tw, sel, true); }
      else if ((e.key === "ContextMenu" || e.key === "F10" && e.shiftKey) && sel) { e.preventDefault(); var r = box.querySelector('.xv-row[data-x="' + CSS.escape(sel) + '"] [data-a]'); var x = find(sel); if (x) S.menu(extMenu(tw, x), r ? { el: r, side: "below-end" } : { x: 40, y: 120 }); }
      else if (e.key.length === 1 && !/\s/.test(e.key)) { input.focus(); }
    });
    el.paint();
    views.push(el);
    return el;
  }
  // 活动栏上原来「扩展」那一格（id 不变：以前记下的显示 / 隐藏、顺序照旧）：现在是连接器
  S.addView("extensions", {
    title: "连接器", icon: PLUG24, keys: "⇧⌘X", sym: "powerplug", order: 2,
    create: function (tw) { return makeView(tw); },
    show: function (el) { el.paint(); var i = el.querySelector(".xv-q"); if (i) { i.focus({ preventScroll: true }); i.select(); } },
  });

  // ======== 编辑区的详情页（扩展: 名字）========
  var pages = [];
  var md = function (src) { return window.TSU_GUI && TSU_GUI.md ? TSU_GUI.md(src) : "<p>" + esc(src).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>") + "</p>"; };
  function featuresHtml(x) {
    var F = x.features || {}, n = 0;
    var sec = function (title, head, rows) {
      if (!rows || !rows.length) return "";
      n++;
      return '<section class="xd-fsec"><h3>' + esc(title) + '<span class="xd-fn">' + rows.length + '</span></h3><table class="xd-tbl"><thead><tr>' + head.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr></thead><tbody>" +
        rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></section>";
    };
    var html = sec(t("命令", "Commands"), [t("命令", "Command"), t("位置", "Where")], (F.commands || []).map(function (c) { return [esc(t(c.zh, c.en)), esc(t(c.where || "", c.whereEn || c.where || ""))]; })) +
      sec(t("设置", "Settings"), [t("名称", "Name"), t("键", "Key")], (F.settings || []).map(function (c) { return [esc(t(c.zh, c.en)), "<code>" + esc(c.key) + "</code>"]; })) +
      sec(t("视图", "Views"), [t("名称", "Name"), t("位置", "Where")], (F.views || []).map(function (c) { return [esc(t(c.zh, c.en)), esc(t(c.where || "", c.whereEn || c.where || ""))]; })) +
      sec(t("地址", "Addresses"), [t("地址", "Address"), t("说明", "Description")], (F.addresses || []).map(function (c) { return ["<code>" + esc(t(c.pat, c.patEn || c.pat)) + "</code>", esc(t(c.zh, c.en))]; }));
    return n ? html : '<div class="xd-empty">' + esc(t("这个扩展没有加进来任何功能", "This extension contributes nothing")) + "</div>";
  }
  function asideHtml(x) {
    var kv = function (rs) { return '<table class="xd-kv">' + rs.map(function (r) { return "<tr><th>" + esc(r[0]) + "</th><td>" + r[1] + "</td></tr>"; }).join("") + "</table>"; };
    var cats = x.categories || [], links = x.links || [];
    return '<section><h3>' + esc(t("安装", "Installation")) + "</h3>" + kv([
      [t("标识符", "Identifier"), "<code>" + esc(fullId(x)) + "</code>"],
      [t("版本", "Version"), esc(x.version || "—")],
      [t("上次更新", "Last Updated"), esc(dateOf(x.updated) || "—")],
      [t("大小", "Size"), '<span class="xd-size">' + esc(sizes[x.id] || "—") + "</span>"],
    ]) + "</section>" +
      '<section><h3>' + esc(t("市场", "Marketplace")) + "</h3>" + kv([
        [t("发布者", "Publisher"), esc(x.publisher || "—")],
        [t("类型", "Type"), esc(isConn(x) ? t("连接器", "Connector") : x.builtin ? t("内置", "Built-in") : t("扩展", "Extension"))],
      ]) + "</section>" +
      (cats.length ? '<section><h3>' + esc(t("类别", "Categories")) + '</h3><div class="xd-chips">' + cats.map(function (c) { return '<span class="xd-chip">' + esc(t(c.zh, c.en)) + "</span>"; }).join("") + "</div></section>" : "") +
      (links.length ? '<section><h3>' + esc(t("资源", "Resources")) + '</h3><div class="xd-links">' + links.map(function (l, i) { return '<button class="xd-link" data-l="' + i + '"' + (l.file && !home() ? " disabled" : "") + ">" + (l.url ? ICON.link : ICON.file) + "<span>" + esc(t(l.zh, l.en)) + "</span></button>"; }).join("") + "</div></section>" : "");
  }
  S.pages.extension = {
    title: function (arg) { var x = find(arg); return (isConn(x) ? t("连接器: ", "Connector: ") : t("扩展: ", "Extension: ")) + (x ? x.name : arg || ""); },
    address: function (arg) { return "extensions.local.paimon/" + (arg || ""); },
    icon: function (arg) { return '<i class="st-ico st-i-ext">' + (isConn(find(arg)) ? PLUG16 : EXT16) + "</i>"; }, // 标签页上的小图标（studio / browser 那边认 page.icon 时用）
    render: function (host, P, arg, V) {
      if (pages.indexOf(V) < 0) { pages.push(V); V.gone = function () { return P.closed; }; }
      var x = find(arg), top = host.scrollTop;
      if (!x) { host.innerHTML = '<div class="xd" tabindex="-1"><div class="xd-empty">' + esc(t("找不到这个扩展：", "Extension not found: ") + (arg || "")) + "</div></div>"; return; }
      V.tab = V.tab === "features" ? "features" : "details";
      var on = X.on(x.id), conn = isConn(x), readme = x.readme ? t(x.readme.zh || "", x.readme.en || x.readme.zh || "") : "";
      var autoOn = x.builtin ? true : !!(ST.auto && ST.auto[x.id]);
      host.innerHTML = '<div class="xd" tabindex="-1" style="--xv-on:' + onColor() + '">' +
        '<div class="xd-head"><div class="xd-logo">' + logo(x, 128) + '</div><div class="xd-info">' +
          '<div class="xd-name"><span>' + esc(x.name) + "</span>" + (x.builtin ? '<span class="xd-tag">' + esc(t("内置", "Built-in")) + "</span>" : "") + "</div>" +
          '<div class="xd-sub"><span class="xd-pub">' + esc(x.publisher || "") + "</span>" +
            (x.verified ? '<span class="xd-verified" title="' + esc(t("已验证的发布者", "Verified publisher")) + '">' + VERIFIED + (x.domain ? '<button class="xd-domain" data-a="domain">' + esc(x.domain) + "</button>" : "") + "</span>" : "") +
            (x.version ? '<span class="xd-dot">·</span><span class="xd-ver">v' + esc(x.version) + "</span>" : "") + "</div>" +
          '<div class="xd-desc">' + esc(descOf(x)) + "</div>" +
          (conn ? '<div class="xd-cst' + (connBad(x) ? " neg" : "") + '"><i class="xv-cdot' + (on ? " on" : "") + '"></i>' + esc(toolLine(x)) + "</div>" : "") +
          '<div class="xd-acts"><span class="xd-split' + (on ? "" : " primary") + '"><button class="xd-btn" data-a="toggle"' + (conn && !x.core && !local() ? " disabled" : "") + ">" + esc(conn ? (on ? t("停用", "Disable") : t("启用", "Enable")) : on ? t("卸载", "Uninstall") : t("安装", "Install")) + "</button></span>" + // 一个按钮：点了马上生效（不用重新载入窗口，没有下拉）
            (conn ? "" : '<label class="xd-auto" title="' + esc(x.builtin ? t("内置扩展随 Vibing Studio 一起更新", "Built-in extensions update together with Vibing Studio") : t("自动更新这个扩展", "Update this extension automatically")) + '"><input type="checkbox" class="ss-check xd-check" data-a="auto"' + (autoOn ? " checked" : "") + (x.builtin ? " disabled" : "") + "><span>" + esc(t("自动更新", "Auto Update")) + "</span></label>") + // 连接器：用的是这台 Mac 上装的命令，没有「自动更新」
            // 连接器的详情页不放「新建会话」（这是插件的页面，不是会话的入口；新会话在侧栏、⌘N、Agent Finder）

            (conn && !x.settings ? "" : '<button class="xd-gear" data-a="gear" title="' + esc(t("设置", "Settings")) + '">' + ICON.gear + "</button>") + "</div>" + // 没有自己设置的连接器（Codex、派蒙）不放 ⚙
        "</div></div>" +
        '<div class="xd-tabs"><button data-t="details"' + (V.tab === "details" ? ' class="on"' : "") + ">" + esc(t("细节", "Details")) + '</button><button data-t="features"' + (V.tab === "features" ? ' class="on"' : "") + ">" + esc(t("功能", "Features")) + "</button></div>" +
        '<div class="xd-body"><div class="xd-main">' + (V.tab === "features" ? featuresHtml(x) : readme ? '<div class="xd-md gv-md">' + md(readme) + "</div>" : '<div class="xd-empty">' + esc(t("没有说明文档", "No README")) + "</div>") + "</div>" +
        '<aside class="xd-aside">' + asideHtml(x) + "</aside></div></div>";
      host.scrollTop = top;
      // 图标和右边那一块一样高：图标的顶对着标题字的顶、底对着按钮的底（量右边那块的高度；说明折成两行时跟着变）
      var lg0 = host.querySelector(".xd-logo"), inf0 = host.querySelector(".xd-info");
      if (lg0 && inf0) {
        var fit = function () { var nm0 = inf0.querySelector(".xd-name"), ac0 = inf0.querySelector(".xd-acts"); if (!nm0 || !ac0) return; var capTop = nm0.getBoundingClientRect().top + 6, bot = ac0.getBoundingClientRect().bottom, sz = Math.round(Math.max(88, Math.min(176, bot - capTop))); lg0.style.width = lg0.style.height = sz + "px"; lg0.style.marginTop = Math.round(capTop - inf0.getBoundingClientRect().top) + "px"; };
        fit();
        if (!host._xdRO && window.ResizeObserver) { host._xdRO = new ResizeObserver(function () { var i1 = host.querySelector(".xd-info"); if (i1) fit(); }); }
        if (host._xdRO) { host._xdRO.disconnect(); host._xdRO.observe(inf0); }
      }
      if (!sizes[x.id]) sizeOf(x).then(function (s) { var z = host.querySelector(".xd-size"); if (s && z) z.textContent = s; });
      if (!host.bound) {
        host.bound = true;
        host.addEventListener("click", function (e) {
          var x2 = find(V.arg), tw = P.win, tb = e.target.closest("[data-t]"), b = e.target.closest("[data-a]"), lk = e.target.closest("[data-l]");
          if (!x2) return;
          if (tb) { V.tab = tb.dataset.t; V.redraw(); return; }
          if (lk) { var l = (x2.links || [])[+lk.dataset.l]; if (l) openRes(tw, l); return; }
          if (!b) return;
          if (b.dataset.a === "toggle") { if (!b.disabled) X.set(x2.id, !X.on(x2.id)); }
          else if (b.dataset.a === "new") { if (C && C.newSession) C.newSession(x2.id, ""); }
          else if (b.dataset.a === "gear") { if (x2.settings || isConn(x2)) S.settings(tw, x2.settings || "connectors"); else S.menu(extMenu(tw, x2), { el: b, side: "below" }); } // ⚙：直接打开它的设置（菜单里那几项用不上）
          else if (b.dataset.a === "domain") openRes(tw, { url: x2.homepage || "https://" + x2.domain });
          else if (b.dataset.a === "dd") {
            var on2 = X.on(x2.id), c2 = isConn(x2);
            S.menu([
              { label: c2 ? (on2 ? t("停用", "Disable") : t("启用", "Enable")) : on2 ? t("卸载", "Uninstall") : t("安装", "Install"), icon: on2 ? (c2 ? ICON.off : ICON.trash) : c2 ? ICON.installed : ICON.download, sym: on2 ? (c2 ? "nosign" : "trash") : c2 ? "checkmark.circle" : "arrow.down.circle", run: function () { X.set(x2.id, !on2); } },
              { label: c2 ? (on2 ? t("停用并重新载入窗口", "Disable and Reload Window") : t("启用并重新载入窗口", "Enable and Reload Window")) : on2 ? t("卸载并重新载入窗口", "Uninstall and Reload Window") : t("安装并重新载入窗口", "Install and Reload Window"), icon: ICON.reload, sym: "arrow.clockwise", run: function () { X.set(x2.id, !on2); setTimeout(function () { location.reload(); }, 300); } },
            ], { el: b.parentNode, side: "below" });
          }
        });
        host.addEventListener("change", function (e) {
          var x2 = find(V.arg);
          if (!x2 || !e.target.matches('[data-a="auto"]')) return;
          ST.auto = ST.auto || {}; ST.auto[x2.id] = !!e.target.checked; keepST();
        });
      }
    },
    focus: function (host) { var d = host.querySelector(".xd"); if (d) d.focus({ preventScroll: true }); else host.focus(); },
    tabActions: function () { return []; },
  };

  function repaintSoon() { setTimeout(function () { repaint(); }, 0); } // 连接器重新检测完（版本、命令在哪变了）
  // 装上 / 卸掉、换语言、换配色：视图和详情页跟着重画（标签页的名字也跟着语言）
  var repaint = function () {
    views = views.filter(function (el) { return document.contains(el); });
    views.forEach(function (el) { if (!el.hidden) el.paint(); });
    pages = pages.filter(function (V) { return !V.gone || !V.gone(); });
    pages.forEach(function (V) { if (V.shown && V.shown()) V.redraw(); });
  };
  X.watch(function () { setTimeout(repaint, 0); });
  if (I18N && I18N.onChange) I18N.onChange(function () {
    repaint();
    if (pages.length && T() && T().wins) T().wins().forEach(function (w) { if (w.open && w.ws && w.ws.active && w.ws.syncTitles) w.ws.syncTitles(); }); // 标签页上的「扩展: 名字」
  });
  document.addEventListener("st-settings-changed", function () { setTimeout(repaint, 0); });
  // 换配色（根上的颜色变量变了）：强调色上的字重新挑黑白
  var onT = 0;
  new MutationObserver(function () {
    clearTimeout(onT);
    onT = setTimeout(function () { var c = onColor(); views.forEach(function (el) { el.style.setProperty("--xv-on", c); }); document.querySelectorAll(".xd").forEach(function (d) { d.style.setProperty("--xv-on", c); }); }, 60);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
})();
