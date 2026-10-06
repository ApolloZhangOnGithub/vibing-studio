// ide.js —— 编辑器：终端风格的代码编辑器。整个窗口是一张等宽字符网格（同终端的字体与格宽）：左边是用 ├── └── 画的资源管理器树，
// 上面是标签页（▸ main.py ● │ README.md），中间是编辑区（透明 <textarea> 叠在高亮好的 <pre> 上，灰色行号），下面是状态栏与集成终端
// （SANDBOX.Shell；开了真沙盒就在真沙盒里跑）。
// 查找替换、跨文件搜索、⌘P 快速打开（字符画的框）、Markdown 预览（TTU 渲染）、⌘R 运行当前文件。
// 文件都在 SANDBOX 里：别人（agent、终端、访达）改了文件，没改过的标签页跟着重新载入，改过的标记冲突。对外：window.TSU_IDE.open(path)
(function () {
  "use strict";
  if (!window.TSU_DESK || !window.SANDBOX) return;
  var FS = window.SANDBOX, HOME = FS.HOME, root = document.documentElement, D = window.TSU_DESK;

  // ---- 小工具 ----
  var parentOf = function (p) { return p.slice(0, p.lastIndexOf("/")) || "/"; };
  var baseOf = function (p) { return p === "/" ? "/" : p.slice(p.lastIndexOf("/") + 1); };
  var extOf = function (n) { var i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; };
  var join = function (dir, name) { return (dir === "/" ? "" : dir) + "/" + name; };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var tilde = function (p) { return p === HOME ? "~" : p.indexOf(HOME + "/") === 0 ? "~" + p.slice(HOME.length) : p; };
  var isLight = function () { return root.classList.contains("light"); };
  var norm = function (p, cwd) { return FS.norm ? FS.norm(p, cwd) : p; };
  var dash = function (n) { return new Array(Math.max(0, n) + 1).join("─"); };
  var errMsg = function (e) { return (e && e.message) || String(e); };
  // 宽字符（中日韩、全角、emoji）占两格
  var KEYSYM = "⌘⇧⌃⌥⎋⌫"; // 键盘符号在回退字体里比一格宽，也按两格放
  function isWide(ch) {
    var c = ch.codePointAt(0);
    if (KEYSYM.indexOf(ch) >= 0) return true;
    return c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd));
  }
  // 制表符画成 CSS 线（同 TTU）：竖线上下相接、不断开
  var BOX = { "│": "v", "─": "h", "├": "t", "└": "l", "╰": "l", "┌": "f", "╭": "f", "┐": "r", "╮": "r", "┘": "j", "╯": "j", "┤": "u" };
  var box = function (s) { return String(s).replace(/[│─├└╰┌╭┐╮┘╯┤]/g, function (c) { return '<span class="ide-bx ide-bx-' + BOX[c] + '">' + c + "</span>"; }); };
  function vw(s) { var n = 0; Array.from(String(s)).forEach(function (ch) { n += isWide(ch) ? 2 : 1; }); return n; }
  // 画框用：非 ASCII 字符（中文、箭头、…）放进固定宽度的格子（一格或两格），回退字体的字宽不一样，框线也对得齐
  var cellChar = function (ch) { return ch.charCodeAt(0) < 0x7f ? esc(ch) : '<span class="ide-w' + (isWide(ch) ? "" : "1") + '">' + esc(ch) + "</span>"; };
  function cells(s) { return Array.from(String(s)).map(cellChar).join(""); }
  // 富文本截断 / 补齐到 w 格：segs = [{ t: 文本, c: 类名, hi: [要高亮的下标] }]
  function fitRich(segs, w) {
    var total = 0, out = "", n = 0, done = false;
    segs.forEach(function (g) { total += vw(g.t); });
    var limit = total > w ? w - 1 : w;
    for (var s = 0; s < segs.length && !done; s++) {
      var g = segs[s], arr = Array.from(g.t), hi = g.hi || [], buf = "";
      for (var i = 0; i < arr.length; i++) {
        var cw = isWide(arr[i]) ? 2 : 1;
        if (n + cw > limit) { done = true; break; }
        var ch = cellChar(arr[i]);
        buf += hi.indexOf(i) >= 0 ? '<span class="ide-mt">' + ch + "</span>" : ch;
        n += cw;
      }
      out += g.c ? '<span class="' + g.c + '">' + buf + "</span>" : buf;
    }
    if (total > w) { out += '<span class="ide-g">' + cellChar("…") + "</span>"; n++; }
    return out + new Array(Math.max(0, w - n) + 1).join(" ");
  }

  // ======== 语法高亮：在 hl.js（文件面板也用）；按「状态 + 行文本」缓存 ========
  var HL = window.TSU_HL, LANG = HL.LANG, langOf = HL.langOf, langName = HL.langName, hlLine = HL.line;
  var hlCache = new Map();
  // 把 t 的前 upto 行高亮好（从上次算到的地方接着算；改动过的行之后的缓存在 setText 里截掉）
  function hlUpTo(t, upto) {
    var L = LANG[t.lang], st = t.hlHtml.length ? t.hlSt[t.hlHtml.length - 1] : "";
    for (var i = t.hlHtml.length; i < upto; i++) {
      var line = t.lines[i], key = t.lang + "\u0001" + st + "\u0001" + line, r = hlCache.get(key);
      if (!r) { r = hlLine(line, st, L); if (hlCache.size > 60000) hlCache.clear(); hlCache.set(key, r); }
      t.hlHtml[i] = r[0];
      t.hlSt[i] = r[1];
      st = r[1];
    }
  }

  // ======== 界面 ========
  // 横线（.ide-rule）用 CSS 画，一整行
  var ide = document.createElement("div");
  ide.className = "ide-root";
  ide.innerHTML =
    '<div class="ide-main">' +
    '  <aside class="ide-side">' +
    '    <div class="ide-sh"><span class="ide-sv" data-v="files">资源管理器</span><span class="ide-g"> ' + box("│") + ' </span><span class="ide-sv" data-v="search">搜索</span><span class="ide-flex"></span>' +
    '<span class="ide-btn" data-a="newfile" title="新建文件">+</span><span class="ide-btn" data-a="newdir" title="新建文件夹">⊞</span><span class="ide-btn" data-a="collapse" title="全部折叠">⊟</span></div>' +
    '    <div class="ide-rule"></div>' +
    '    <div class="ide-tree" tabindex="-1"></div>' +
    '    <div class="ide-search" hidden>' +
    '      <div class="ide-sq"><span class="ide-ac">❯ </span><input class="ide-sin" spellcheck="false" autocomplete="off" placeholder="在文件中查找">' +
    '<span class="ide-sopt"><span> </span><span class="ide-btn" data-o="cs" title="区分大小写">Aa</span><span> </span><span class="ide-btn" data-o="re" title="正则表达式">.*</span></span></div>' +
    '      <div class="ide-g ide-sinfo"></div>' +
    '      <div class="ide-rule"></div>' +
    '      <div class="ide-sres"></div>' +
    "    </div>" +
    "  </aside>" +
    '  <div class="ide-sash" title="拖动调整宽度"></div>' +
    '  <div class="ide-center">' +
    '    <div class="ide-tabrow"><div class="ide-tabs"></div><div class="ide-tctl"></div></div>' +
    '    <div class="ide-rule"></div>' +
    '    <div class="ide-find" hidden>' +
    '<span class="ide-g">查找</span> <span class="ide-ac">❯</span> <input class="ide-fq" spellcheck="false" autocomplete="off">' +
    ' <span class="ide-btn" data-f="cs" title="区分大小写">Aa</span><span class="ide-btn" data-f="re" title="正则表达式">.*</span> <span class="ide-fc ide-g"></span>' +
    ' <span class="ide-btn" data-f="prev" title="上一个（⇧↩）">↑</span><span class="ide-btn" data-f="next" title="下一个（↩）">↓</span>' +
    '<span class="ide-frep"><span class="ide-g">  替换</span> <span class="ide-ac">❯</span> <input class="ide-fr" spellcheck="false" autocomplete="off">' +
    ' <span class="ide-btn" data-f="one">替换</span> <span class="ide-btn" data-f="all">全部替换</span></span>' +
    '<span class="ide-btn" data-f="close" title="关闭（esc）">✕</span></div>' +
    '    <div class="ide-work">' +
    '      <div class="ide-ed">' +
    '        <pre class="ide-gut"></pre>' +
    '        <div class="ide-code"><div class="ide-curl"></div><pre class="ide-marks"></pre><pre class="ide-hl"></pre></div>' +
    "      </div>" +
    '      <pre class="terminal-style-ui ide-md" hidden></pre>' +
    '      <pre class="ide-welcome"></pre>' +
    "    </div>" +
    '    <div class="ide-term" hidden>' +
    '      <div class="ide-thd"><span class="ide-g">' + box("──") + ' </span><span class="ide-tt">终端 </span><span class="ide-g ide-tcwd"></span><span class="ide-g"> </span><span class="ide-g ide-flex ide-fill"></span>' +
    '<span class="ide-g"> </span><span class="ide-btn" data-t="clear" title="清除（⌘K）">清除</span><span class="ide-g">  </span><span class="ide-btn" data-t="close" title="隐藏（⌃`）">✕</span><span class="ide-g"> ' + box("──") + "</span></div>" +
    '      <div class="ide-tout"><div class="ide-tlog"></div><div class="ide-tin"><span class="ide-tps"></span><input class="ide-tinp" spellcheck="false" autocomplete="off" autocapitalize="off"></div></div>' +
    "    </div>" +
    "  </div>" +
    "</div>" +
    '<div class="ide-status"><span class="ide-sl"></span><span class="ide-smsg"></span><span class="ide-flex"></span><span class="ide-sr"></span></div>' +
    '<div class="ide-pal" hidden><div class="ide-pbox"><div class="ide-ptop"></div><div class="ide-pin"><span class="ide-pl"></span><input class="ide-pq" spellcheck="false" autocomplete="off"><span class="ide-pr"></span></div>' +
    '<div class="ide-psep"></div><div class="ide-plist"></div><div class="ide-pbot"></div></div></div>' +
    '<span class="ide-measure" aria-hidden="true">' + "0".repeat(1000) + "</span>";
  var $ = function (s) { return ide.querySelector(s); };
  var sideEl = $(".ide-side"), treeEl = $(".ide-tree"), searchEl = $(".ide-search"), sin = $(".ide-sin"), sres = $(".ide-sres"), sinfo = $(".ide-sinfo");
  var tabsEl = $(".ide-tabs"), tctl = $(".ide-tctl"), findEl = $(".ide-find"), fq = $(".ide-fq"), fr = $(".ide-fr"), fc = $(".ide-fc");
  var workEl = $(".ide-work"), edEl = $(".ide-ed"), gut = $(".ide-gut"), code = $(".ide-code"), curl = $(".ide-curl"), marksEl = $(".ide-marks"), hlEl = $(".ide-hl");
  var mdEl = $(".ide-md"), welcome = $(".ide-welcome"), termEl = $(".ide-term"), tlog = $(".ide-tlog"), tout = $(".ide-tout"), tinp = $(".ide-tinp"), tps = $(".ide-tps"), tcwd = $(".ide-tcwd");
  var statusL = $(".ide-sl"), statusM = $(".ide-smsg"), statusR = $(".ide-sr"), pal = $(".ide-pal"), pq = $(".ide-pq"), plist = $(".ide-plist");

  // ---- 状态（工作目录、展开的文件夹、侧边栏 / 终端开关与尺寸存在 localStorage，刷新后恢复）----
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem("tsu-ide") || "{}") || {}; } catch (e) { saved = {}; }
  var tabs = [], active = -1, mru = [];
  var ws = saved.ws || HOME;
  var expanded = new Set(saved.expanded || ["/", "/home", HOME]);
  var view = { side: saved.side !== false, pane: "files", term: !!saved.term, sideW: saved.sideW || 0, termH: saved.termH || 0 };
  var FS_PX = 13, LH = 17, PADY = 6, PADX = 12, cellW = 7.8;
  function persist() {
    try {
      localStorage.setItem("tsu-ide", JSON.stringify({ ws: ws, expanded: Array.from(expanded).slice(0, 200), side: view.side, term: view.term, sideW: view.sideW, termH: view.termH,
        tabs: tabs.map(function (t) { return t.path; }), active: cur() ? cur().path : "" }));
    } catch (e) { /* 存不下就算了 */ }
  }
  var cur = function () { return tabs[active] || null; };

  // ---- 窗口 ----
  var win = D.createWindow({
    id: "ide", name: "编辑器", className: "ide", content: ide,
    initial: function () { // 居中、不压着 Dock
      var a = D.area(), w = Math.min(1180, a.width - 60), h = Math.min(780, a.height - 36);
      return { left: Math.round((a.width - w) / 2), top: a.top + Math.max(10, Math.round((a.height - h) / 2)), width: w, height: h };
    },
    title: function () { var t = cur(); return t ? (t.dirty ? "● " : "") + t.name + " — " + tilde(parentOf(t.path)) : "编辑器 — " + tilde(ws); },
    menus: menus,
    appMenu: function () { return [{ label: "关于编辑器", keys: "", run: function () { flash("编辑器：终端风格 · 文件在 SANDBOX 里 · ⌘P 打开 · ⌘R 运行"); } }]; },
    onClose: function () { persist(); closePalette(); },
  });
  function refreshTitle() { win.setTitle(win.title()); if (D.front() === win) D.refreshMenus(); }

  // 字号跟终端的设置走（tsu-font），行高取整到像素；格宽量 1000 个 0（offsetWidth：不受台前调度、调度中心的缩放影响）
  function measure() {
    FS_PX = +(localStorage.getItem("tsu-font") || 13) || 13;
    LH = Math.round(FS_PX * 1.3);
    ide.style.setProperty("--ide-fs", FS_PX + "px");
    ide.style.setProperty("--ide-lh", LH + "px");
    var w = $(".ide-measure").offsetWidth / 1000;
    if (w) cellW = w;
  }

  // ======== 标签页 ========
  function normText(s) { return String(s == null ? "" : s).replace(/\r\n?/g, "\n"); }
  function setText(t, text) {
    var lines = text.split("\n"), old = t.lines || [], d = 0, m = Math.min(old.length, lines.length);
    while (d < m && old[d] === lines[d]) d++;
    if (t.hlHtml.length > d) { t.hlHtml.length = d; t.hlSt.length = d; }
    t.text = text;
    t.lines = lines;
    // 每行起点（查找高亮、跳转要用）
    var starts = [0], pos = 0;
    for (var i = 0; i < lines.length - 1; i++) { pos += lines[i].length + 1; starts.push(pos); }
    t.starts = starts;
  }
  function makeTab(path, raw) {
    var text = normText(raw), ta = document.createElement("textarea");
    ta.className = "ide-src";
    ta.spellcheck = false;
    ta.setAttribute("wrap", "off");
    ta.setAttribute("autocomplete", "off");
    ta.setAttribute("autocorrect", "off");
    ta.setAttribute("autocapitalize", "off");
    ta.value = text;
    ta.hidden = true;
    code.appendChild(ta);
    var t = { path: path, name: baseOf(path), lang: langOf(path), ta: ta, base: text, text: "", lines: null, hlHtml: [], hlSt: [], starts: [0],
      dirty: false, conflict: false, deleted: false, preview: false, crlf: /\r\n/.test(String(raw)), caret: { line: 0, col: 1 } };
    setText(t, text);
    ta.addEventListener("input", function () { onEdit(t); });
    ta.addEventListener("scroll", schedulePaint);
    ta.addEventListener("keydown", function (e) { onEditorKey(t, e); });
    ["keyup", "mouseup", "select", "focus"].forEach(function (ev) { ta.addEventListener(ev, function () { caretMoved(t); }); });
    return t;
  }
  function openFile(path, o) {
    o = o || {};
    var i = tabs.findIndex(function (t) { return t.path === path; });
    var st0 = i < 0 && FS.stat(path);
    if (st0 && st0.lazy && FS.ensureLoaded) { // 真沙盒里的大文件：先取回来再打开
      flash("正在从真沙盒取“" + baseOf(path) + "”…");
      FS.ensureLoaded([path]).then(function () { var s1 = FS.stat(path); if (s1 && !s1.lazy) openFile(path, o); else flash("取不回“" + baseOf(path) + "”", "err"); });
      return null;
    }
    if (i < 0) {
      var raw;
      try { raw = FS.read(path); } catch (e) { flash(errMsg(e), "err"); return null; }
      if (typeof raw !== "string") raw = String(raw == null ? "" : raw);
      if (raw.indexOf("\u0000") >= 0) { flash("“" + baseOf(path) + "”看起来是二进制文件，不能编辑", "err"); return null; }
      var t = makeTab(path, raw);
      i = active < 0 ? tabs.length : active + 1;
      tabs.splice(i, 0, t);
    }
    activate(i, o);
    expandTo(parentOf(path));
    mru = [path].concat(mru.filter(function (p) { return p !== path; })).slice(0, 30);
    renderTree();
    revealRow(path);
    persist();
    return tabs[i];
  }
  function activate(i, o) {
    o = o || {};
    var prev = cur();
    if (prev && prev !== tabs[i]) prev.ta.hidden = true;
    active = i;
    var t = cur();
    if (t) t.ta.hidden = false;
    layout(); // 先让编辑区显示出来，下面滚动定位才量得到尺寸
    if (t && o.line != null) gotoPos(t, o.line, o.col || 0, o.len || 0);
    if (t && !o.noFocus) setTimeout(function () { if (cur() === t && pal.hidden) t.ta.focus({ preventScroll: true }); }, 0);
    renderTabs();
    if (F.open) { computeMatches(); renderFindCount(); }
    caretMoved(t);
    refreshTitle();
    markTreeActive();
  }
  // 关标签页：改过的先问「要存储对“x”的更改吗？」（不存储 / 取消 / 存储）→ Promise<是否关掉了>
  function closeTab(i) {
    var t = tabs[i];
    if (!t) return Promise.resolve(false);
    if (!t.dirty) { dropTab(t); return Promise.resolve(true); }
    if (i !== active) activate(i);
    return askSave([t]).then(function (a) {
      if (a === "cancel" || (a === "save" && !save(t))) return false;
      dropTab(t);
      return true;
    });
  }
  function dropTab(t) {
    var i = tabs.indexOf(t);
    if (i < 0) return;
    t.ta.remove();
    tabs.splice(i, 1);
    if (active >= tabs.length) active = tabs.length - 1;
    else if (i < active) active--;
    activate(active);
    renderTree();
    persist();
    dirtyChanged();
  }
  function closeAll() {
    return tabs.slice().reverse().reduce(function (p, t) { return p.then(function (go) { return go === false ? false : closeTab(tabs.indexOf(t)); }); }, Promise.resolve(true));
  }
  function closeCur() { if (!pal.hidden) return closePalette(); if (active >= 0) closeTab(active); }
  // 问要不要存：有 TSU_DESK.alert 用它（窗口里的表单），没有就用两次 confirm → "save" | "discard" | "cancel"
  function askSave(list) {
    var one = list.length === 1, title = one ? "要存储对“" + list[0].name + "”的更改吗？" : "要存储对 " + list.length + " 个文件的更改吗？";
    var msg = (one ? "" : list.map(function (t) { return "· " + tilde(t.path); }).join("\n") + "\n\n") + "如果不存储，你的更改会丢失。";
    var SAVE = one ? "存储" : "全部存储";
    if (D.alert) {
      try {
        return Promise.resolve(D.alert({ window: "ide", title: title, message: msg, buttons: [{ label: "不存储", role: "destructive" }, { label: "取消", role: "cancel" }, { label: SAVE, role: "default" }] }))
          .then(function (label) { return label === SAVE ? "save" : label === "不存储" ? "discard" : "cancel"; }, function () { return "cancel"; });
      } catch (e) { /* 退回 confirm */ }
    }
    if (confirm(title + "\n\n" + msg + "\n\n确定 = " + SAVE + "，取消 = 不存储或取消")) return Promise.resolve("save");
    return Promise.resolve(confirm((one ? "不存储就关闭“" + list[0].name + "”吗？" : "不存储就关闭吗？") + "\n更改会丢失。") ? "discard" : "cancel");
  }
  function cycleTab(d) { if (tabs.length > 1) activate((active + d + tabs.length) % tabs.length); }
  function renderTabs() {
    var dupe = {};
    tabs.forEach(function (t) { dupe[t.name] = (dupe[t.name] || 0) + 1; });
    tabsEl.innerHTML = tabs.map(function (t, i) {
      var on = i === active, x = t.conflict ? "!" : t.dirty ? "●" : "×";
      return (i ? '<span class="ide-g">' + box("│") + "</span>" : "") +
        '<span class="ide-tab' + (on ? " ide-on" : "") + (t.deleted ? " ide-del" : "") + (t.conflict ? " ide-cf" : "") + (t.dirty ? " ide-dirty" : "") + '" data-i="' + i + '" title="' + esc(tilde(t.path)) + '">' +
        " " + (on ? '<span class="ide-ac">' + cellChar("▸") + "</span> " : "  ") + '<span class="ide-tn">' + esc(t.name) + "</span>" +
        (dupe[t.name] > 1 ? '<span class="ide-g"> ' + esc(tilde(parentOf(t.path))) + "</span>" : "") +
        ' <span class="ide-x" data-x="' + i + '" title="' + (t.dirty ? "未保存 · 点按关闭" : "关闭（⌘W）") + '">' +
        (x === "●" ? '<span class="ide-xd">' + cellChar("●") + '</span><span class="ide-xc">' + cellChar("×") + "</span>" : cellChar(x)) + "</span> </span>";
    }).join("") || '<span class="ide-g"> 没有打开的文件 · ⌘P 打开</span>';
    var t = cur(), btn = [];
    if (t && t.lang === "markdown") btn.push('<span class="ide-btn' + (t.preview ? " ide-on" : "") + '" data-c="preview" title="Markdown 预览（⇧⌘V）">◧ 预览</span>');
    if (t && runnerOf(t)) btn.push('<span class="ide-btn ide-run" data-c="run" title="运行当前文件（⌘R）">▶ 运行</span>');
    btn.push('<span class="ide-btn' + (view.term ? " ide-on" : "") + '" data-c="term" title="终端（⌃`）">❯_</span>');
    tctl.innerHTML = btn.join('<span class="ide-g"> </span>') + " ";
    var on = tabsEl.querySelector(".ide-on");
    if (on) { var r = on.getBoundingClientRect(), pr = tabsEl.getBoundingClientRect(); if (r.left < pr.left || r.right > pr.right) tabsEl.scrollLeft += r.left - pr.left - 20; }
  }
  tabsEl.addEventListener("mousedown", function (e) {
    var x = e.target.closest("[data-x]"), tb = e.target.closest(".ide-tab");
    if (!tb) return;
    e.preventDefault();
    if (x || e.button === 1) return closeTab(+tb.dataset.i);
    if (e.button === 0) activate(+tb.dataset.i);
  });
  tabsEl.addEventListener("wheel", function (e) { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tabsEl.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  tctl.addEventListener("mousedown", function (e) {
    var b = e.target.closest("[data-c]");
    if (!b) return;
    e.preventDefault();
    ({ preview: togglePreview, run: runCurrent, term: toggleTerm })[b.dataset.c]();
  });

  // ======== 编辑区：透明 textarea 叠在高亮层上；只画看得见的那些行 ========
  function onEdit(t) {
    setText(t, t.ta.value);
    var was = t.dirty;
    t.dirty = t.text !== t.base;
    if (was !== t.dirty) { renderTabs(); refreshTitle(); markTreeActive(); dirtyChanged(); }
    if (F.open) { computeMatches(); renderFindCount(); }
    caretMoved(t);
    if (t.preview) schedulePreview();
    scheduleStash();
  }
  var paintQ = 0;
  function schedulePaint() {
    if (paintQ) return;
    paintQ = 1;
    var run = function () { if (!paintQ) return; paintQ = 0; paint(); };
    requestAnimationFrame(run);
    setTimeout(run, 40); // 窗口在后台时 rAF 可能不跑
  }
  function paint() {
    var t = cur();
    if (!t) return;
    var ta = t.ta, st = ta.scrollTop, sl = ta.scrollLeft, h = ta.clientHeight || code.clientHeight || 600;
    var N = t.lines.length, first = Math.max(0, Math.floor((st - PADY) / LH) - 1), last = Math.min(N, Math.ceil((st + h) / LH) + 1);
    hlUpTo(t, last);
    var y = PADY + first * LH - st;
    hlEl.innerHTML = t.hlHtml.slice(first, last).join("\n");
    hlEl.style.transform = "translate(" + -sl + "px," + y + "px)";
    var cl = t.caret.line, nums = [];
    for (var i = first; i < last; i++) nums.push(i === cl ? '<span class="ide-gn">' + (i + 1) + "</span>" : String(i + 1));
    gut.innerHTML = nums.join("\n");
    gut.style.transform = "translateY(" + y + "px)";
    var gw = Math.max(3, String(N).length) + 3 + "ch";
    if (gw !== edEl._gw) { edEl._gw = gw; edEl.style.setProperty("--ide-gw", gw); }
    curl.style.transform = "translateY(" + (PADY + cl * LH - st) + "px)";
    curl.hidden = ta.selectionStart !== ta.selectionEnd;
    paintMarks(t, first, last, y, sl);
  }
  // 查找结果：同样的字（透明）+ <mark> 底色，垫在高亮层下面
  function paintMarks(t, first, last, y, sl) {
    if (!F.open || !F.matches.length) { if (marksEl.innerHTML) marksEl.innerHTML = ""; return; }
    var ms = F.matches, a = t.starts[first], lo = 0, hi = ms.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (ms[mid][1] <= a) lo = mid + 1; else hi = mid; }
    var out = [];
    for (var i = first; i < last; i++) {
      var s0 = t.starts[i], line = t.lines[i], e0 = s0 + line.length, h = "", pos = s0;
      while (lo < ms.length && ms[lo][0] <= e0) {
        var m = ms[lo], ms0 = Math.max(m[0], s0), me0 = Math.min(m[1], e0);
        if (me0 >= ms0 && ms0 >= pos) {
          h += esc(t.text.slice(pos, ms0)) + '<mark class="ide-mk' + (lo === F.idx ? " ide-mk-on" : "") + '">' + esc(t.text.slice(ms0, me0) || " ") + "</mark>";
          pos = me0;
        }
        if (m[1] > e0) break;
        lo++;
      }
      out.push(h + esc(t.text.slice(pos, e0)));
    }
    marksEl.innerHTML = out.join("\n");
    marksEl.style.transform = "translate(" + -sl + "px," + y + "px)";
  }
  function lineOfPos(t, pos) {
    var s = t.starts, lo = 0, hi = s.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (s[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function caretMoved(t) {
    if (!t || t !== cur()) return;
    var s = t.ta.selectionStart, line = lineOfPos(t, s);
    t.caret = { line: line, col: s - t.starts[line] + 1, sel: Math.abs(t.ta.selectionEnd - s) };
    renderStatus();
    schedulePaint();
  }
  // 点行号：选中那一行（同 VS Code）
  edEl.addEventListener("mousedown", function (e) {
    var t = cur();
    if (!t || e.button !== 0 || e.target === t.ta || e.target.closest("textarea")) return;
    e.preventDefault();
    var r = code.getBoundingClientRect(), line = Math.floor((e.clientY - r.top - PADY + t.ta.scrollTop) / LH);
    line = Math.max(0, Math.min(t.lines.length - 1, line));
    t.ta.focus({ preventScroll: true });
    t.ta.setSelectionRange(t.starts[line], line + 1 < t.lines.length ? t.starts[line + 1] : t.text.length);
    caretMoved(t);
  });
  document.addEventListener("selectionchange", function () { var t = cur(); if (t && document.activeElement === t.ta) caretMoved(t); });
  // 把第 pos 个字符滚进视野（上下留三分之一）
  function reveal(t, pos) {
    var ta = t.ta, line = lineOfPos(t, pos), top = PADY + line * LH, h = ta.clientHeight || 400, w = ta.clientWidth || 600;
    if (top < ta.scrollTop || top + LH > ta.scrollTop + h) ta.scrollTop = Math.max(0, top - h / 3);
    var x = PADX + vw(t.lines[line].slice(0, pos - t.starts[line])) * cellW;
    if (x < ta.scrollLeft + 20 || x > ta.scrollLeft + w - 40) ta.scrollLeft = Math.max(0, x - w / 2);
    schedulePaint();
  }
  function gotoPos(t, line, col, len) {
    line = Math.max(0, Math.min(t.lines.length - 1, line));
    var p = t.starts[line] + Math.min(col, t.lines[line].length);
    t.ta.setSelectionRange(p, p + (len || 0));
    reveal(t, p);
    caretMoved(t);
  }
  // 往 textarea 里插字：走 execCommand，撤销（⌘Z）才记得住
  function insert(ta, text) {
    ta.focus();
    var ok = false;
    try { ok = text ? document.execCommand("insertText", false, text) : document.execCommand("delete"); } catch (e) { ok = false; }
    if (!ok) { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end"); ta.dispatchEvent(new Event("input")); }
  }
  // 编辑键：Tab 缩进（选了多行就整块缩进 / ⇧ 取消缩进）、回车自动缩进、退格删一整级缩进、⌘/ 注释
  function onEditorKey(t, e) {
    if (e.isComposing || e.keyCode === 229) return;
    var ta = t.ta, v = ta.value, s = ta.selectionStart, en = ta.selectionEnd, L = LANG[t.lang], unit = L.unit || 4, pad = new Array(unit + 1).join(" ");
    var ls = v.lastIndexOf("\n", s - 1) + 1;
    if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (s === en && !e.shiftKey) { var col = s - ls, n = unit - (col % unit); return insert(ta, new Array(n + 1).join(" ")); }
      var le = en > s && v[en - 1] === "\n" ? en - 1 : en, bEnd = v.indexOf("\n", le);
      if (bEnd < 0) bEnd = v.length;
      var block = v.slice(ls, bEnd).split("\n").map(function (l) {
        if (!e.shiftKey) return l.length ? pad + l : l;
        return l.replace(new RegExp("^( {1," + unit + "}|\\t)"), "");
      }).join("\n");
      ta.setSelectionRange(ls, bEnd);
      insert(ta, block);
      ta.setSelectionRange(ls, ls + block.length);
      return;
    }
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      var line = v.slice(ls, s), ind = /^[ \t]*/.exec(line)[0], before = line.replace(/\s+$/, ""), after = v.slice(en, en + 1);
      var open = /[{[(]$/.test(before) || (t.lang === "python" && /:$/.test(before) && !/^\s*#/.test(before));
      if (t.lang === "python" && /^\s*(return|pass|break|continue|raise)\b/.test(line) && ind.length >= unit) ind = ind.slice(unit);
      if (open && /^[}\])]/.test(after) && t.lang !== "python") {
        insert(ta, "\n" + ind + pad + "\n" + ind);
        var p = ta.selectionStart - ind.length - 1;
        ta.setSelectionRange(p, p);
        return caretMoved(t);
      }
      return insert(ta, "\n" + ind + (open ? pad : ""));
    }
    if (e.key === "Backspace" && s === en && s > ls && !e.metaKey && !e.altKey) {
      var pre = v.slice(ls, s);
      if (/^ +$/.test(pre)) { e.preventDefault(); var k = ((pre.length - 1) % unit) + 1; ta.setSelectionRange(s - k, s); return insert(ta, ""); }
    }
    if (e.key === "/" && e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); toggleComment(); return; }
    if (e.key === "Escape" && F.open) { e.preventDefault(); closeFind(); }
  }
  function toggleComment() {
    var t = cur();
    if (!t || !LANG[t.lang].cmt) return;
    var ta = t.ta, v = ta.value, s = ta.selectionStart, en = ta.selectionEnd, c = LANG[t.lang].cmt, ct = c.trim();
    var ls = v.lastIndexOf("\n", s - 1) + 1, le = en > s && v[en - 1] === "\n" ? en - 1 : en, bEnd = v.indexOf("\n", le);
    if (bEnd < 0) bEnd = v.length;
    var lines = v.slice(ls, bEnd).split("\n"), body = lines.filter(function (l) { return l.trim(); });
    var all = body.length && body.every(function (l) { return l.trim().indexOf(ct) === 0; });
    var minInd = Math.min.apply(null, body.map(function (l) { return /^\s*/.exec(l)[0].length; }).concat([1e9]));
    var out = lines.map(function (l) {
      if (!l.trim()) return l;
      if (all) return l.replace(new RegExp("^(\\s*)" + ct.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&") + " ?"), "$1");
      return l.slice(0, minInd) + c + l.slice(minInd);
    }).join("\n");
    ta.setSelectionRange(ls, bEnd);
    insert(ta, out);
    ta.setSelectionRange(ls, ls + out.length);
  }
  // 布局：有没有标签页、预览开没开
  function layout() {
    var t = cur();
    edEl.hidden = !t;
    welcome.hidden = !!t;
    mdEl.hidden = !(t && t.preview);
    workEl.classList.toggle("ide-split", !!(t && t.preview));
    if (!t) renderWelcome();
    renderStatus();
    if (t) { paint(); if (t.preview) renderPreview(); }
  }
  function renderWelcome() {
    var k = function (key, label) { return '   <span class="ide-ac">' + cells(key) + "</span>" + new Array(Math.max(1, 8 - vw(key)) + 1).join(" ") + esc(label); };
    welcome.innerHTML = [
      "",
      ' <span class="ide-org">✻</span> <span class="ide-hi">编辑器</span>  <span class="ide-g">终端风格 · 文件都在沙盒里</span>',
      "",
      k("⌘P", "快速打开文件"),
      k("⇧⌘F", "在文件中查找"),
      k("⌃`", "显示 / 隐藏终端"),
      k("⌘R", "运行当前文件（python / node / sh）"),
      k("⇧⌘V", "Markdown 预览"),
      k("⌘S", "保存"),
      "",
      ' <span class="ide-g">⎿ 工作目录 ' + esc(tilde(ws)) + "　·　终端里输入 code 文件名 也能打开</span>",
    ].join("\n");
  }

  // ---- Markdown 预览：TTU 按终端的样子渲染，改了就跟着重画 ----
  var prevT = 0;
  function schedulePreview() { clearTimeout(prevT); prevT = setTimeout(renderPreview, 140); }
  function renderPreview() {
    var t = cur();
    if (!t || !t.preview) return;
    var light = isLight(), cs = getComputedStyle(mdEl);
    mdEl.classList.toggle("ttu-light", light);
    var inner = mdEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var cols = Math.max(20, Math.floor(inner / cellW) - 1), top = mdEl.scrollTop;
    try {
      mdEl.innerHTML = window.TTU ? TTU.renderFile(t.name, t.text, { width: cols, theme: light ? "light" : "dark" }).html || '<span class="ide-g">（空文件）</span>' : esc(t.text);
    } catch (e) { mdEl.textContent = t.text; }
    mdEl.scrollTop = top;
  }
  function togglePreview() {
    var t = cur();
    if (!t || t.lang !== "markdown") return flash("只有 Markdown 文件能预览");
    t.preview = !t.preview;
    layout();
    renderTabs();
  }

  // ======== 未保存的修改：窗口红灯里的点（TSU_DESK.setBusy）、暂存到 localStorage（刷新不丢）========
  var busy = false, STASH = "tsu-ide-unsaved", stashT = 0;
  function dirtyChanged() {
    var any = tabs.some(function (t) { return t.dirty; });
    if (any !== busy && D.setBusy) { try { D.setBusy("ide", any, "有未保存的修改"); } catch (e) { /* 桌面还没这个接口 */ } }
    busy = any;
    stash();
  }
  function scheduleStash() { clearTimeout(stashT); stashT = setTimeout(stash, 400); }
  function stash() {
    clearTimeout(stashT);
    stashT = 0;
    var o = {}, n = 0;
    tabs.forEach(function (t) { if (t.dirty) { o[t.path] = { text: t.text, base: t.base }; n++; } });
    try { if (n) localStorage.setItem(STASH, JSON.stringify(o)); else localStorage.removeItem(STASH); }
    catch (e) { flash("未保存的内容太大，没能暂存到本地（记得 ⌘S）", "warn"); }
  }
  window.addEventListener("pagehide", function () { if (stashT) stash(); });
  window.addEventListener("beforeunload", function () { if (stashT) stash(); });

  // ======== 保存、重新载入、磁盘上的变化 ========
  function save(t) {
    t = t || cur();
    if (!t) return false;
    var disk = null;
    try { disk = FS.exists(t.path) ? normText(FS.read(t.path)) : null; } catch (e) { disk = null; }
    if (disk !== null && disk !== t.base && disk !== t.text && !confirm("“" + t.name + "”在磁盘上已被修改（可能是 agent 或终端改的）。\n用你的版本覆盖吗？")) return false;
    try { FS.write(t.path, t.crlf ? t.text.replace(/\n/g, "\r\n") : t.text); } catch (e) { flash("保存失败：" + errMsg(e), "err"); return false; }
    t.base = t.text;
    t.dirty = t.conflict = t.deleted = false;
    renderTabs();
    refreshTitle();
    markTreeActive();
    dirtyChanged();
    flash("✓ 已保存 " + tilde(t.path), "ok");
    return true;
  }
  function saveAll() { tabs.forEach(function (t) { if (t.dirty) save(t); }); }
  function revert(t) {
    t = t || cur();
    if (!t) return;
    var raw;
    try { raw = FS.read(t.path); } catch (e) { return flash(errMsg(e), "err"); }
    if (t.dirty && !confirm("丢掉“" + t.name + "”里未保存的更改，换成磁盘上的版本？")) return;
    reload(t, normText(raw), /\r\n/.test(String(raw)));
  }
  // 换成磁盘上的内容，尽量保住光标与滚动位置；crlf：磁盘上那份的行尾（换成 LF 了，存的时候就别再改回 CRLF）
  function reload(t, text, crlf) {
    var ta = t.ta, s = ta.selectionStart, e = ta.selectionEnd, st = ta.scrollTop, sl = ta.scrollLeft;
    ta.value = text;
    ta.setSelectionRange(Math.min(s, text.length), Math.min(e, text.length));
    ta.scrollTop = st;
    ta.scrollLeft = sl;
    t.base = text;
    if (crlf !== undefined) t.crlf = crlf;
    setText(t, text);
    t.dirty = t.conflict = t.deleted = false;
    if (t === cur()) { if (F.open) computeMatches(); caretMoved(t); if (t.preview) schedulePreview(); }
    renderTabs();
    refreshTitle();
    dirtyChanged();
  }
  var changedPaths = new Set(), changeT = 0, fileCache = null;
  FS.onChange(function (p) {
    changedPaths.add(p);
    fileCache = null;
    if (!changeT) changeT = setTimeout(syncFromDisk, 60);
  });
  function syncFromDisk() {
    changeT = 0;
    var paths = changedPaths;
    changedPaths = new Set();
    var notes = [];
    tabs.forEach(function (t) {
      var hit = paths.has(t.path) || Array.from(paths).some(function (p) { return t.path.indexOf(p + "/") === 0; });
      if (!hit) return;
      if (!FS.exists(t.path)) { if (!t.deleted) { t.deleted = true; notes.push("“" + t.name + "”已在磁盘上删除"); } return; }
      var disk, raw0;
      try { raw0 = FS.read(t.path); disk = normText(raw0); } catch (e) { return; }
      t.deleted = false;
      if (disk === t.text) { t.base = disk; t.conflict = false; t.dirty = false; t.crlf = /\r\n/.test(String(raw0)); dirtyChanged(); return; }
      if (disk === t.base) { if (t.conflict) { t.conflict = false; t.diskText = null; } return; } // 磁盘上又改回来了：不再冲突
      if (!t.dirty) { reload(t, disk, /\r\n/.test(String(raw0))); notes.push("⟳ 已重新载入 " + t.name + "（磁盘上有更改）"); }
      else { t.conflict = true; t.diskText = disk; notes.push("⚠ " + t.name + " 在磁盘上被改了，而你也有未保存的更改（文件 › 从磁盘重新载入，或 ⌘S 覆盖）"); }
    });
    renderTabs();
    if (notes.length) flash(notes[notes.length - 1], /⚠/.test(notes[notes.length - 1]) ? "warn" : "");
    if (win.state !== "closed") { renderTree(); if (view.pane === "search" && S2.q) runSearch(); }
  }

  // ======== 资源管理器：从「/」开始的一棵树，用 ├── └── │ 画 ========
  function expandTo(dir) {
    var p = dir;
    while (p && p !== "/") { expanded.add(p); p = parentOf(p); }
    expanded.add("/");
  }
  function sortKids(list) {
    return list.sort(function (a, b) {
      var da = FS.isDir(a), db = FS.isDir(b);
      if (da !== db) return da ? -1 : 1;
      return baseOf(a).localeCompare(baseOf(b), "zh-CN", { numeric: true, sensitivity: "base" });
    });
  }
  function renderTree() {
    if (!view.side || view.pane !== "files" || win.state === "closed") return;
    var rows = [], open = {};
    tabs.forEach(function (t) { open[t.path] = t; });
    var t0 = cur();
    function row(p, prefix, isD) {
      var name = p === "/" ? "/" : baseOf(p), o = open[p];
      var cls = "ide-row" + (t0 && t0.path === p ? " ide-on" : "") + (name[0] === "." ? " ide-hid" : "");
      var body = isD ? '<span class="ide-ar">' + cellChar(expanded.has(p) ? "▾" : "▸") + '</span> <span class="ide-dn">' + esc(name === "/" ? "/" : name + "/") + "</span>" : '<span class="ide-fn">' + esc(name) + "</span>";
      var tail = (o && o.dirty ? ' <span class="ide-org">●</span>' : "") + (o && o.conflict ? ' <span class="ide-red">!</span>' : "") + (p === ws ? ' <span class="ide-ac" title="工作目录：终端在这里">⌂</span>' : "");
      rows.push('<div class="' + cls + '" data-p="' + esc(p) + '" data-d="' + (isD ? 1 : 0) + '" title="' + esc(tilde(p)) + '"><span class="ide-g">' + box(prefix) + "</span>" + body + tail + "</div>");
    }
    row("/", "", true);
    if (expanded.has("/")) (function walk(dir, prefix) {
      var kids;
      try { kids = sortKids(FS.list(dir)); } catch (e) { rows.push('<div class="ide-row ide-err"><span class="ide-g">' + box(prefix + "└── ") + "</span>⚠ " + esc(errMsg(e)) + "</div>"); return; }
      kids.forEach(function (k, i) {
        var last = i === kids.length - 1, isD = FS.isDir(k);
        row(k, prefix + (last ? "└── " : "├── "), isD);
        if (isD && expanded.has(k)) walk(k, prefix + (last ? "    " : "│   "));
      });
    })("/", "");
    treeEl.innerHTML = rows.join("");
  }
  function markTreeActive() {
    var t = cur();
    treeEl.querySelectorAll(".ide-row.ide-on").forEach(function (r) { r.classList.remove("ide-on"); });
    if (t) { var r = rowOf(t.path); if (r) r.classList.add("ide-on"); }
  }
  var rowOf = function (p) { return Array.prototype.find.call(treeEl.children, function (r) { return r.dataset.p === p; }); };
  function revealRow(p) { var r = rowOf(p); if (r) r.scrollIntoView({ block: "nearest" }); }
  treeEl.addEventListener("click", function (e) {
    var r = e.target.closest(".ide-row[data-p]");
    if (!r) return;
    var p = r.dataset.p;
    if (r.dataset.d === "1") { if (expanded.has(p)) expanded.delete(p); else expanded.add(p); renderTree(); persist(); }
    else openFile(p);
  });
  treeEl.addEventListener("dblclick", function (e) { var r = e.target.closest(".ide-row[data-p]"); if (r && r.dataset.d === "1") setWs(r.dataset.p); });
  sideEl.addEventListener("contextmenu", function (e) {
    if (e.target.closest("input")) return;
    e.preventDefault();
    var r = e.target.closest(".ide-row[data-p]");
    showCtx(e.clientX, e.clientY, ctxItems(r ? r.dataset.p : null));
  });
  $(".ide-sh").addEventListener("click", function (e) {
    var v = e.target.closest("[data-v]"), a = e.target.closest("[data-a]");
    if (v) { if (v.dataset.v === "search") openSearch(); else showPane("files"); }
    if (a && a.dataset.a === "newfile") askNewFile();
    if (a && a.dataset.a === "newdir") askNewDir();
    if (a && a.dataset.a === "collapse") { expanded = new Set(["/"]); if (cur()) expandTo(parentOf(cur().path)); renderTree(); persist(); }
  });
  function showPane(p) {
    view.pane = p;
    view.side = true;
    treeEl.hidden = p !== "files";
    searchEl.hidden = p !== "search";
    ide.querySelectorAll(".ide-sv").forEach(function (s) { s.classList.toggle("ide-on", s.dataset.v === p); });
    applyView();
    if (p === "files") { renderTree(); markTreeActive(); }
  }
  function toggleSide() { view.side = !view.side; applyView(); if (view.side) renderTree(); persist(); }
  function applyView() {
    sideEl.hidden = !view.side;
    $(".ide-sash").hidden = !view.side;
    if (view.sideW) sideEl.style.width = view.sideW + "px";
    termEl.hidden = !view.term;
    if (view.termH) termEl.style.height = view.termH + "px";
    renderTabs();
    schedulePaint();
    if (cur() && cur().preview) schedulePreview();
    if (D.front() === win) D.refreshMenus();
  }
  // 工作目录：终端的 cwd 跟着它
  function setWs(dir) {
    if (!FS.isDir(dir)) return;
    ws = dir;
    expandTo(dir);
    if (sh.cwd !== dir) { sh.cwd = dir; tsys("⎿ 工作目录 → " + tilde(dir)); renderPrompt(); }
    renderTree();
    renderWelcome();
    renderStatus();
    refreshTitle();
    persist();
  }

  // ---- 右键菜单（用桌面的 .menu 样式）----
  var ctx = document.createElement("div");
  ctx.className = "menu ide-ctx";
  ctx.hidden = true;
  document.body.appendChild(ctx);
  function showCtx(x, y, items) {
    ctx.textContent = "";
    items.forEach(function (a) {
      var it = document.createElement("div");
      if (a.sep) { it.className = "sep"; ctx.appendChild(it); return; }
      it.className = "item" + (a.disabled ? " disabled" : "");
      it.innerHTML = "<span></span><kbd></kbd>";
      it.firstChild.textContent = a.label;
      it.lastChild.textContent = a.keys || "";
      it.addEventListener("mouseup", function (e) { e.preventDefault(); if (a.disabled) return; ctx.hidden = true; a.run(); });
      ctx.appendChild(it);
    });
    ctx.hidden = false;
    var w = ctx.offsetWidth, h = ctx.offsetHeight;
    ctx.style.left = Math.min(x, window.innerWidth - w - 6) + "px";
    ctx.style.top = (y + h > window.innerHeight - 6 ? Math.max(6, y - h) : y) + "px";
  }
  document.addEventListener("mousedown", function (e) { if (!ctx.hidden && !ctx.contains(e.target)) ctx.hidden = true; }, true);
  window.addEventListener("blur", function () { ctx.hidden = true; });
  var it = function (label, keys, run, opts) { return Object.assign({ label: label, keys: keys || "", run: run }, opts || {}); };
  var SEP = { sep: true };
  function ctxItems(p) {
    var isD = p && FS.isDir(p), dir = !p ? ws : isD ? p : parentOf(p), fixed = !p || p === "/" || p === HOME;
    return [
      it("新建文件…", "", function () { askNewFile(dir); }),
      it("新建文件夹…", "", function () { askNewDir(dir); }),
      SEP,
      it("打开", "", function () { openFile(p); }, { disabled: !p || isD }),
      it("重命名…", "", function () { askRename(p); }, { disabled: fixed }),
      it("删除…", "", function () { removePath(p); }, { disabled: fixed }),
      SEP,
      it("设为工作目录（终端 cd 到这里）", "", function () { setWs(dir); }),
      it("在访达中显示", "", function () { window.TSU_FINDER.open(p || dir); }, { disabled: !window.TSU_FINDER }),
      it("复制路径", "", function () { if (navigator.clipboard) navigator.clipboard.writeText(p || dir).catch(function () {}); }),
    ];
  }
  function removePath(p) {
    if (!confirm("确定要删除“" + tilde(p) + "”吗？\n沙盒里没有废纸篓，删除后不能恢复。")) return;
    try { FS.remove(p, true); } catch (e) { flash(errMsg(e), "err"); }
  }

  // ======== 查找 / 替换（当前文件）========
  var F = { open: false, cs: false, re: false, matches: [], idx: -1, err: "" };
  function openFind(replace) {
    var t = cur();
    if (!t) return;
    F.open = true;
    findEl.hidden = false;
    findEl.classList.toggle("ide-frep-on", !!replace);
    var sel = t.ta.value.slice(t.ta.selectionStart, t.ta.selectionEnd);
    if (sel && sel.indexOf("\n") < 0) fq.value = sel;
    computeMatches();
    pickNearest();
    renderFindCount();
    schedulePaint();
    (replace && fq.value ? fr : fq).focus();
    (replace && fq.value ? fr : fq).select();
  }
  function closeFind() {
    F.open = false;
    findEl.hidden = true;
    marksEl.innerHTML = "";
    var t = cur();
    if (t) t.ta.focus({ preventScroll: true });
    schedulePaint();
  }
  function findRe(q, cs, re, g) {
    return new RegExp(re ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), (g ? "g" : "") + (cs ? "" : "i") + "m");
  }
  function computeMatches() {
    var t = cur();
    F.matches = [];
    F.err = "";
    if (!t || !fq.value) { F.idx = -1; return; }
    var re;
    try { re = findRe(fq.value, F.cs, F.re, true); } catch (e) { F.err = "正则有误"; return; }
    var m;
    while ((m = re.exec(t.text)) && F.matches.length < 20000) {
      if (!m[0].length) { re.lastIndex++; continue; }
      F.matches.push([m.index, m.index + m[0].length]);
    }
    if (F.idx >= F.matches.length) F.idx = F.matches.length - 1;
  }
  function pickNearest() {
    var t = cur();
    if (!t || !F.matches.length) { F.idx = -1; return; }
    var s = t.ta.selectionStart, i = F.matches.findIndex(function (m) { return m[0] >= s; });
    F.idx = i < 0 ? 0 : i;
    selectMatch();
  }
  function selectMatch() {
    var t = cur(), m = F.matches[F.idx];
    if (!t || !m) return;
    t.ta.setSelectionRange(m[0], m[1]);
    reveal(t, m[0]);
    caretMoved(t);
  }
  function findStep(d) {
    if (!F.matches.length) return;
    F.idx = (F.idx + d + F.matches.length) % F.matches.length;
    selectMatch();
    renderFindCount();
  }
  function renderFindCount() {
    fc.textContent = F.err || (!fq.value ? "" : F.matches.length ? (F.idx + 1) + "/" + F.matches.length : "无结果");
    fc.classList.toggle("ide-red", !!F.err || (!!fq.value && !F.matches.length));
    findEl.querySelectorAll("[data-f=cs],[data-f=re]").forEach(function (b) { b.classList.toggle("ide-on", F[b.dataset.f]); });
  }
  function replaceOne() {
    var t = cur(), m = F.matches[F.idx];
    if (!t || !m) return;
    var src = t.text.slice(m[0], m[1]), rep = fr.value;
    if (F.re) { try { rep = src.replace(findRe(fq.value, F.cs, true, false), fr.value); } catch (e) { return; } }
    t.ta.setSelectionRange(m[0], m[1]);
    insert(t.ta, rep);
    computeMatches();
    F.idx = F.matches.findIndex(function (x) { return x[0] >= m[0] + rep.length; });
    if (F.idx < 0) F.idx = F.matches.length ? 0 : -1;
    selectMatch();
    renderFindCount();
    fr.focus();
  }
  function replaceAll() {
    var t = cur();
    if (!t || !F.matches.length) return;
    var n = F.matches.length, re;
    try { re = findRe(fq.value, F.cs, F.re, true); } catch (e) { return; }
    var next = t.text.replace(re, F.re ? fr.value : function () { return fr.value; }), st = t.ta.scrollTop;
    t.ta.setSelectionRange(0, t.text.length);
    insert(t.ta, next);
    t.ta.setSelectionRange(0, 0);
    t.ta.scrollTop = st;
    computeMatches();
    renderFindCount();
    flash("已替换 " + n + " 处", "ok");
    fr.focus();
  }
  fq.addEventListener("input", function () { computeMatches(); pickNearest(); renderFindCount(); schedulePaint(); });
  [fq, fr].forEach(function (inp) {
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); if (inp === fr) { if (e.metaKey || e.altKey) replaceAll(); else replaceOne(); } else findStep(e.shiftKey ? -1 : 1); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFind(); }
    });
  });
  findEl.addEventListener("mousedown", function (e) {
    var b = e.target.closest("[data-f]");
    if (!b) return;
    e.preventDefault();
    var f = b.dataset.f;
    if (f === "cs" || f === "re") { F[f] = !F[f]; computeMatches(); pickNearest(); renderFindCount(); schedulePaint(); }
    else if (f === "next") findStep(1);
    else if (f === "prev") findStep(-1);
    else if (f === "one") replaceOne();
    else if (f === "all") replaceAll();
    else if (f === "close") closeFind();
  });

  // ======== 在文件中查找（侧边栏）：结果一行一条 `路径:行: 文本`，点一下跳过去 ========
  var S2 = { q: "", cs: false, re: false, hits: [] }, searchT = 0;
  function openSearch() {
    showPane("search");
    var t = cur(), sel = t ? t.ta.value.slice(t.ta.selectionStart, t.ta.selectionEnd) : "";
    if (sel && sel.indexOf("\n") < 0) sin.value = sel;
    runSearch();
    sin.focus();
    sin.select();
  }
  function runSearch() {
    S2.q = sin.value;
    S2.hits = [];
    var files = 0, re;
    if (!S2.q) { sres.innerHTML = ""; sinfo.textContent = "在 " + tilde(ws) + " 中"; return; }
    try { re = findRe(S2.q, S2.cs, S2.re, false); } catch (e) { sinfo.textContent = "正则有误"; sres.innerHTML = ""; return; }
    var open = {};
    tabs.forEach(function (t) { open[t.path] = t; });
    var list = [];
    try { list = FS.walk(ws).filter(function (p) { return !FS.isDir(p); }); } catch (e) { sinfo.textContent = errMsg(e); return; }
    for (var f = 0; f < list.length && S2.hits.length < 1000; f++) {
      var p = list[f], text;
      if (open[p]) text = open[p].text; // 打开着的用编辑器里的（可能还没保存）
      else { try { text = FS.read(p); } catch (e) { continue; } }
      if (typeof text !== "string" || text.length > 2e6 || text.indexOf("\u0000") >= 0) continue;
      var lines = text.split("\n"), got = false;
      for (var i = 0; i < lines.length && S2.hits.length < 1000; i++) {
        var m = re.exec(lines[i]);
        if (m && m[0].length) { S2.hits.push({ path: p, line: i, col: m.index, len: m[0].length, text: lines[i] }); got = true; }
      }
      if (got) files++;
    }
    sinfo.textContent = S2.hits.length ? S2.hits.length + (S2.hits.length >= 1000 ? "+" : "") + " 个结果 · " + files + " 个文件 · 在 " + tilde(ws) + " 中" : "没有结果 · 在 " + tilde(ws) + " 中";
    var rel = function (p) { return p.indexOf(ws === "/" ? "/" : ws + "/") === 0 ? p.slice(ws === "/" ? 1 : ws.length + 1) : tilde(p); };
    var avail = Math.floor((sres.clientWidth || 240) / cellW) - 3;
    sres.innerHTML = S2.hits.map(function (h, k) {
      // 侧边栏窄：匹配处前面只留一小段上下文，保证匹配看得见
      var room = avail - vw(rel(h.path) + ":" + (h.line + 1) + ": ") - h.len, lead = /^\s*/.exec(h.text)[0].length;
      var from = Math.max(lead, h.col - Math.max(3, Math.floor(room / 3))), pre = (from > lead ? "…" : "") + h.text.slice(from, h.col);
      return '<div class="ide-row ide-hit" data-k="' + k + '" title="' + esc(tilde(h.path) + ":" + (h.line + 1)) + '"><span class="ide-hp">' + esc(rel(h.path)) + '</span><span class="ide-g">:</span><span class="ide-hn">' + (h.line + 1) +
        '</span><span class="ide-g">: </span>' + esc(pre) + '<mark class="ide-mk ide-mk-on">' + esc(h.text.substr(h.col, h.len)) + "</mark>" + esc(h.text.slice(h.col + h.len, h.col + h.len + 200)) + "</div>";
    }).join("");
  }
  sin.addEventListener("input", function () { clearTimeout(searchT); searchT = setTimeout(runSearch, 160); });
  sin.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); clearTimeout(searchT); runSearch(); var h = S2.hits[0]; if (h) openFile(h.path, { line: h.line, col: h.col, len: h.len }); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); showPane("files"); if (cur()) cur().ta.focus(); }
  });
  $(".ide-sopt").addEventListener("mousedown", function (e) {
    var b = e.target.closest("[data-o]");
    if (!b) return;
    e.preventDefault();
    S2[b.dataset.o] = !S2[b.dataset.o];
    b.classList.toggle("ide-on", S2[b.dataset.o]);
    runSearch();
  });
  sres.addEventListener("click", function (e) {
    var r = e.target.closest("[data-k]"), h = r && S2.hits[+r.dataset.k];
    if (!h) return;
    sres.querySelectorAll(".ide-on").forEach(function (x) { x.classList.remove("ide-on"); });
    r.classList.add("ide-on");
    openFile(h.path, { line: h.line, col: h.col, len: h.len });
  });

  // ======== 命令面板：⌘P 快速打开、⌃G 跳到行、新建 / 重命名 / 打开文件夹（输入路径）——用 ╭─╮ 画的框 ========
  var P = null;
  function palette(o) {
    P = Object.assign({ idx: 0, items: [], hint: "↑↓ 选择 · ↩ 确定 · esc 取消", prompt: "❯" }, o);
    measure();
    var avail = Math.floor(ide.clientWidth / cellW);
    P.W = Math.max(36, Math.min(84, avail - 6));
    var W = P.W;
    $(".ide-ptop").innerHTML = '<span class="ide-g">' + box("╭─") + ' </span><span class="ide-hi">' + cells(P.title) + '</span> <span class="ide-g">' + box(dash(W - 5 - vw(P.title)) + "╮") + "</span>";
    $(".ide-pl").innerHTML = '<span class="ide-g">' + box("│") + '</span> <span class="ide-ac">' + cells(P.prompt) + "</span> ";
    $(".ide-pr").innerHTML = ' <span class="ide-g">' + box("│") + "</span>";
    pq.style.width = "calc(var(--ide-cell) * " + (W - 6) + ")";
    pq.placeholder = P.placeholder || "";
    $(".ide-psep").innerHTML = '<span class="ide-g">' + box("├" + dash(W - 2) + "┤") + "</span>";
    var hint = P.hint;
    $(".ide-pbot").innerHTML = '<span class="ide-g">' + box("╰─") + " " + cells(hint) + " " + box(dash(W - 5 - vw(hint)) + "╯") + "</span>";
    $(".ide-pbox").style.width = "calc(var(--ide-cell) * " + W + ")";
    pal.hidden = false;
    pq.value = P.value || "";
    palRefresh();
    pq.focus();
    if (P.selectStem) { var v = pq.value, dot = v.lastIndexOf("."), sl = v.lastIndexOf("/"); pq.setSelectionRange(sl + 1, dot > sl + 1 ? dot : v.length); }
    else pq.setSelectionRange(pq.value.length, pq.value.length);
  }
  function closePalette() {
    if (pal.hidden) return;
    pal.hidden = true;
    P = null;
    var t = cur();
    if (t && D.front() === win) t.ta.focus({ preventScroll: true });
  }
  function palRefresh() {
    if (!P) return;
    P.items = P.list ? P.list(pq.value) : [];
    P.idx = Math.min(P.idx, Math.max(0, P.items.length - 1));
    palRender();
  }
  function palRender() {
    var W = P.W, ROWS = 12, n = P.items.length, top = Math.max(0, Math.min(P.idx - ROWS + 1, n - ROWS));
    top = Math.max(0, Math.min(top, P.idx));
    var rows = [], V = '<span class="ide-g">' + box("│") + "</span>";
    if (!n) rows.push('<div class="ide-prow">' + V + " " + fitRich([{ t: "  " + (P.empty ? P.empty(pq.value) : "没有匹配的文件"), c: "ide-g" }], W - 4) + " " + V + "</div>");
    for (var i = top; i < Math.min(n, top + ROWS); i++) {
      var x = P.items[i], on = i === P.idx;
      var segs = [{ t: on ? "▸ " : "  ", c: on ? "ide-ac" : "" }, { t: x.name, c: on ? "ide-hi" : "", hi: x.hi }];
      if (x.detail) segs.push({ t: "  " + x.detail, c: "ide-g", hi: (x.hiD || []).map(function (k) { return k + 2; }) });
      rows.push('<div class="ide-prow' + (on ? " ide-on" : "") + '" data-i="' + i + '">' + V + " " + fitRich(segs, W - 4) + " " + V + "</div>");
    }
    if (n > ROWS) rows.push('<div class="ide-prow">' + V + " " + fitRich([{ t: "  … 共 " + n + " 项", c: "ide-g" }], W - 4) + " " + V + "</div>");
    plist.innerHTML = rows.join("");
  }
  function palPick() {
    if (!P) return;
    var o = P, x = P.items[P.idx], q = pq.value;
    if (o.list && !x && !o.allowFree) return;
    closePalette();
    o.pick(x, q);
  }
  pq.addEventListener("input", function () { if (P) { P.idx = 0; palRefresh(); } });
  pq.addEventListener("keydown", function (e) {
    if (!P) return;
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) { e.preventDefault(); P.idx = Math.min(P.items.length - 1, P.idx + 1); palRender(); }
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) { e.preventDefault(); P.idx = Math.max(0, P.idx - 1); palRender(); }
    else if (e.key === "Enter") { e.preventDefault(); palPick(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePalette(); }
    else return;
    e.stopPropagation();
  });
  plist.addEventListener("mousedown", function (e) { e.preventDefault(); var r = e.target.closest("[data-i]"); if (r && P) { P.idx = +r.dataset.i; palPick(); } });
  plist.addEventListener("mousemove", function (e) { var r = e.target.closest("[data-i]"); if (r && P && P.idx !== +r.dataset.i) { P.idx = +r.dataset.i; palRender(); } });
  pal.addEventListener("mousedown", function (e) { if (e.target === pal) { e.preventDefault(); closePalette(); } });

  // 模糊匹配：按顺序出现即可；连续、词首（/ . _ - 之后）加分
  function fuzzy(q, s) {
    var ql = q.toLowerCase(), sl = s.toLowerCase(), idx = [], j = 0, score = 0, last = -2;
    for (var i = 0; i < sl.length && j < ql.length; i++) {
      if (sl[i] !== ql[j]) continue;
      idx.push(i);
      score += (i === last + 1 ? 5 : 1) + (i === 0 || /[\/._\-\s]/.test(s[i - 1]) ? 4 : 0);
      last = i;
      j++;
    }
    return j < ql.length ? null : { score: score, idx: idx };
  }
  function allFiles() {
    if (!fileCache) { try { fileCache = FS.walk("/").filter(function (p) { return !FS.isDir(p); }); } catch (e) { fileCache = []; } }
    return fileCache;
  }
  function quickOpen() {
    if (P && P.kind === "open") return closePalette();
    palette({
      kind: "open", title: "打开文件", placeholder: "文件名（:行号 跳到行）",
      list: function (q) {
        var m = /^(.*?)(?::(\d+))?$/.exec(q.trim()), name = m[1], line = m[2] ? +m[2] : null;
        if (!name && line != null && cur()) return [{ name: "跳到第 " + line + " 行", detail: cur().name, line: line, path: cur().path }];
        var files = allFiles(), out;
        if (!name) {
          var seen = {};
          out = mru.concat(files.filter(function (p) { return p.indexOf(ws === "/" ? "/" : ws + "/") === 0; })).filter(function (p) { if (seen[p] || !FS.exists(p)) return false; seen[p] = 1; return true; })
            .slice(0, 200).map(function (p) { return { path: p, name: baseOf(p), detail: tilde(parentOf(p)) }; });
        } else {
          out = [];
          files.forEach(function (p) {
            var nm = baseOf(p), dir = tilde(parentOf(p)), a = fuzzy(name, nm), b;
            if (a) return out.push({ path: p, name: nm, detail: dir, hi: a.idx, score: a.score + 20 + (p.indexOf(ws + "/") === 0 ? 3 : 0) - nm.length * 0.05 });
            if ((b = fuzzy(name, dir + "/" + nm))) {
              var cut = dir.length + 1;
              out.push({ path: p, name: nm, detail: dir, hi: b.idx.filter(function (k) { return k >= cut; }).map(function (k) { return k - cut; }), hiD: b.idx.filter(function (k) { return k < cut; }), score: b.score - (dir + nm).length * 0.05 });
            }
          });
          out.sort(function (x, y) { return y.score - x.score; });
          out = out.slice(0, 100);
        }
        if (line != null) out.forEach(function (x) { x.line = line; });
        return out;
      },
      pick: function (x) { if (x) openFile(x.path, x.line != null ? { line: x.line - 1, col: 0 } : {}); },
    });
  }
  function gotoLinePal() {
    var t = cur();
    if (!t) return;
    palette({
      title: "跳到行", value: ":", placeholder: ":行号", hint: "↩ 跳转 · esc 取消",
      list: function (q) { var n = parseInt(q.replace(/^:/, ""), 10); return n > 0 ? [{ name: "跳到第 " + n + " 行", detail: "共 " + t.lines.length + " 行", line: n }] : []; },
      empty: function () { return "输入行号（1–" + t.lines.length + "）"; },
      pick: function (x) { if (x) { gotoPos(t, x.line - 1, 0, 0); t.ta.focus(); } },
    });
  }
  // 要一个路径：新建文件 / 文件夹、重命名、打开文件夹
  function askPath(o) {
    palette({
      title: o.title, value: o.value, hint: "↩ 确定 · esc 取消", allowFree: true, selectStem: o.selectStem,
      list: function () { return []; }, empty: function (q) { return o.explain(norm(q.trim() || "/", ws)); },
      pick: function (x, q) { if (q.trim()) o.done(norm(q.trim(), ws), q.trim()); },
    });
  }
  function baseDir() { return cur() ? parentOf(cur().path) : ws; }
  function askNewFile(dir) {
    dir = dir || baseDir();
    askPath({ title: "新建文件", value: tilde(join(dir, "")), explain: function (p) { return FS.isDir(p) ? "在 " + tilde(p) + " 里新建：接着输入文件名（可带子目录）" : FS.exists(p) ? "已存在：" + tilde(p) + "（↩ 打开）" : "↩ 创建 " + tilde(p); },
      done: function (p, raw) {
        try {
          if (/\/$/.test(raw)) { FS.mkdirp(p); return askNewFile(p); } // 以 / 结尾：是个文件夹，建好后再问文件名
          if (!FS.exists(p)) { FS.mkdirp(parentOf(p)); FS.write(p, ""); }
        } catch (e) { return flash(errMsg(e), "err"); }
        if (FS.isDir(p)) return askNewFile(p); // 只给了文件夹：再问一次文件名
        openFile(p);
      } });
  }
  function askNewDir(dir) {
    dir = dir || baseDir();
    askPath({ title: "新建文件夹", value: tilde(join(dir, "")), explain: function (p) { return FS.exists(p) ? "已存在：" + tilde(p) + "（接着输入新文件夹的名字）" : "↩ 创建文件夹 " + tilde(p); },
      done: function (p) { try { FS.mkdirp(p); } catch (e) { return flash(errMsg(e), "err"); } expandTo(p); renderTree(); } });
  }
  function askRename(p) {
    askPath({ title: "重命名 / 移动", value: tilde(p), selectStem: true, explain: function (to) { return to === p ? "输入新的路径" : FS.exists(to) ? "已存在：" + tilde(to) : "↩ " + tilde(p) + " → " + tilde(to); },
      done: function (to) {
        if (to === p) return;
        if (FS.exists(to)) return flash("已存在：" + tilde(to), "err");
        try { if (FS.move) FS.move(p, to); else throw new Error("SANDBOX 没有 move"); } catch (e) { return flash(errMsg(e), "err"); }
        // 打开着的标签页跟着换路径
        tabs.forEach(function (t) {
          if (t.path === p || t.path.indexOf(p + "/") === 0) { t.path = to + t.path.slice(p.length); t.name = baseOf(t.path); t.lang = langOf(t.path); t.hlHtml = []; t.hlSt = []; t.deleted = false; }
        });
        if (ws === p || ws.indexOf(p + "/") === 0) ws = to + ws.slice(p.length);
        expandTo(parentOf(to));
        renderTabs(); renderTree(); refreshTitle(); schedulePaint(); persist();
      } });
  }
  function askFolder() {
    palette({
      title: "打开文件夹（设为工作目录）", placeholder: "文件夹", value: "",
      list: function (q) {
        var dirs = [];
        try { dirs = FS.walk("/").filter(function (p) { return FS.isDir(p); }); } catch (e) { dirs = []; }
        return dirs.map(function (p) { var m = q ? fuzzy(q, tilde(p)) : { score: -p.length, idx: [] }; return m && { path: p, name: tilde(p), hi: m.idx, score: m.score - p.length * 0.05 }; })
          .filter(Boolean).sort(function (a, b) { return b.score - a.score; }).slice(0, 100);
      },
      pick: function (x) { if (x) { setWs(x.path); showPane("files"); } },
    });
  }

  // ======== 集成终端：new SANDBOX.Shell()，输出按终端的样子（❯ 提示符、stderr 红色）========
  var sh = new FS.Shell(), tq = Promise.resolve(), pyWarm = false, hist = [], hIdx = -1;
  try { hist = JSON.parse(localStorage.getItem("tsu-ide-hist") || "[]"); } catch (e) { hist = []; }
  sh.cwd = ws;
  function tline(html, cls) {
    var d = document.createElement("div");
    d.className = "ide-tl" + (cls ? " " + cls : "");
    d.innerHTML = html;
    tlog.appendChild(d);
    while (tlog.childNodes.length > 3000) tlog.removeChild(tlog.firstChild);
    tout.scrollTop = tout.scrollHeight;
    return d;
  }
  var tsys = function (text) { tline(esc(text), "ide-g"); };
  function tout2(text, cls) {
    if (!text) return;
    text = String(text).replace(/\n$/, "");
    var html = /\x1b\[/.test(text) && window.TTU ? TTU.ansiToHtml(text, isLight() ? "light" : "dark", { widthOf: TTU.visibleWidth }) : esc(text);
    tline(html, cls);
  }
  function renderPrompt() {
    tps.innerHTML = '<span class="ide-g">' + esc(tilde(sh.cwd)) + '</span> <span class="ide-ac">❯</span> ';
    tcwd.textContent = tilde(sh.cwd);
  }
  function qarg(s) { return /^[\w@%+=:,.\/~-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'"; }
  // ---- 开了真沙盒：命令在真沙盒里跑（以人的身份），输出边跑边显示；cd 在这边记（访达、编辑器用的那套路径），跑的时候换成真路径 ----
  var remoteOn = function () { return !!(window.TSU_AGENTS && TSU_AGENTS.remote && TSU_AGENTS.remote() && FS.mirrorActive && FS.mirrorActive()); };
  function remoteRun(line, live) {
    var m = /^\s*cd(?:\s+(.*?))?\s*$/.exec(line);
    if (m) { // 单独的 cd：只改这边记的目录（真沙盒里没有「当前目录」这回事，每条命令都带着目录去）
      var arg = (m[1] || "~").replace(/'([^']*)'|"([^"]*)"/g, "$1$2"); // 去掉引号（~'/有 空格' 这种也行）
      var to = arg === "-" ? sh.prev || sh.cwd : norm(arg.replace(/^~(?=\/|$)/, HOME), sh.cwd);
      if (!FS.isDir(to)) return Promise.resolve({ out: "", err: "cd: 没有这个目录：" + arg + "\n", code: 1 });
      sh.prev = sh.cwd;
      sh.cwd = to;
      return Promise.resolve({ out: "", err: "", code: 0 });
    }
    // 先等刚存的文件推到真沙盒（存了马上运行，不能跑到旧版本）
    return (FS.mirrorFlush ? FS.mirrorFlush() : Promise.resolve()).then(function () {
      return fetch("/api/sbx/exec", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ as: "user", cmd: line, cwd: FS.toReal(sh.cwd), cols: 100, timeout_ms: 3600000 }) });
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { var e; try { e = JSON.parse(t).error; } catch (x) { e = t; } return { out: "", err: (e || "HTTP " + r.status) + "\n", code: 1 }; });
      var out = "", err = "", code = -1, cwd = null, reader = r.body.getReader(), dec = new TextDecoder(), buf = "";
      var take = function (l) {
        if (!l) return;
        var j; try { j = JSON.parse(l); } catch (e) { return; }
        if (j.o) { out += j.o; live(out, err); }
        if (j.e) { err += j.e; live(out, err); }
        if (j.x !== undefined) { code = j.x; cwd = j.cwd; }
      };
      return (function pump() {
        return reader.read().then(function (x) {
          if (!x.done) { buf += dec.decode(x.value, { stream: true }); var i; while ((i = buf.indexOf("\n")) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 1); } return pump(); }
          take(buf);
          var v = cwd && FS.toVirtual(cwd); // 命令里 cd 过：跟着换
          if (v && FS.isDir(v)) { sh.prev = sh.cwd; sh.cwd = v; }
          document.dispatchEvent(new Event("tsu-sandbox-touch")); // 访达、编辑器的镜像马上再拉一次
          return { out: out, err: err, code: code };
        });
      })();
    });
  }
  // 排队执行（前一条没跑完，后一条等着）；run 可以替换真正执行的东西（比如运行 .sh 文件的内容）
  function execLine(line, o) {
    o = o || {};
    if (!view.term) { view.term = true; applyView(); persist(); }
    tq = tq.then(function () {
      tline('<span class="ide-g">' + esc(tilde(sh.cwd)) + '</span> <span class="ide-ac">❯</span> ' + esc(o.display || line));
      var m = /^\s*(code|edit)\s+(.+)$/.exec(line);
      if (m && !o.run) { // 终端里 code 文件名：在编辑器里打开
        m[2].trim().split(/\s+/).forEach(function (a) { var p = norm(a, sh.cwd); if (FS.isDir(p)) setWs(p); else if (FS.exists(p)) openFile(p); else tout2("code: 没有这个文件：" + a, "ide-red"); });
        return;
      }
      if (/^\s*clear\s*$/.test(line) && !o.run) { tlog.textContent = ""; return; }
      var remote = remoteOn() && !o.run;
      if (/\bpython3?\b/.test(line) && !pyWarm && !remote) tsys("⎿ 第一次运行 Python：正在下载 Pyodide（约 10 MB），请稍候…");
      var t0 = Date.now(), spin = tline('<span class="ide-org">✻</span> <span class="ide-g">运行中… 0s</span>', "ide-spin");
      var iv = setInterval(function () { spin.lastChild.textContent = "运行中… " + Math.round((Date.now() - t0) / 1000) + "s"; }, 1000);
      tinp.disabled = true;
      var p, liveEl = null;
      // 真沙盒的输出边到边显示（放在「运行中」上面），跑完换成正式的
      var live = function (out, err) {
        if (!liveEl) { liveEl = document.createElement("div"); liveEl.className = "ide-tl"; tlog.insertBefore(liveEl, spin); }
        var o2 = out.slice(-20000), html = /\x1b\[/.test(o2) && window.TTU ? TTU.ansiToHtml(o2, isLight() ? "light" : "dark", { widthOf: TTU.visibleWidth }) : esc(o2);
        liveEl.innerHTML = html + (err ? '<span class="ide-red">' + esc(err.slice(-8000)) + "</span>" : "");
        tout.scrollTop = tout.scrollHeight;
      };
      try { p = o.run ? o.run() : remote ? remoteRun(line, live) : sh.run(line); } catch (e) { p = Promise.resolve({ out: "", err: errMsg(e) + "\n", code: 1 }); }
      return Promise.resolve(p).then(function (r) {
        r = r || {};
        if (/\bpython3?\b/.test(line)) pyWarm = true;
        var out = String(r.out || "");
        if (out.indexOf("\x1b[clear]") >= 0) { tlog.textContent = ""; out = out.split("\x1b[clear]").pop(); }
        if (liveEl) liveEl.remove();
        spin.remove();
        tout2(out);
        tout2(r.err, "ide-red");
        if (r.code) tsys("⎿ 退出码 " + r.code);
      }, function (e) { spin.remove(); tout2(errMsg(e), "ide-red"); }).then(done, function (e) { console.error(e); if (liveEl) liveEl.remove(); spin.remove(); done(); });
      // 不管上面出了什么错都要收尾（停计时、放开输入框），不然后面的命令全都静默不跑
      function done() {
        clearInterval(iv);
        tinp.disabled = false;
        renderPrompt();
        tout.scrollTop = tout.scrollHeight;
        if (termEl.contains(document.activeElement) || o.focus) tinp.focus({ preventScroll: true });
      }
    }).catch(function (e) { console.error(e); tinp.disabled = false; }); // 队列本身永远不停在「失败」上
    return tq;
  }
  tinp.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      var v = tinp.value;
      tinp.value = "";
      hIdx = -1;
      if (!v.trim()) { tline('<span class="ide-g">' + esc(tilde(sh.cwd)) + '</span> <span class="ide-ac">❯</span>'); return; }
      if (hist[hist.length - 1] !== v) { hist.push(v); hist = hist.slice(-200); try { localStorage.setItem("tsu-ide-hist", JSON.stringify(hist)); } catch (x) { /* 忽略 */ } }
      execLine(v, { focus: true });
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (!hist.length) return;
      hIdx = e.key === "ArrowUp" ? (hIdx < 0 ? hist.length - 1 : Math.max(0, hIdx - 1)) : hIdx < 0 ? -1 : hIdx + 1;
      if (hIdx >= hist.length) hIdx = -1;
      tinp.value = hIdx < 0 ? "" : hist[hIdx];
    } else if (e.key === "Tab") {
      // 补全最后一个词（文件名）
      e.preventDefault();
      var parts = tinp.value.split(" "), w = parts.pop(), d = w.lastIndexOf("/"), dirPart = d >= 0 ? w.slice(0, d + 1) : "", stem = w.slice(d + 1);
      var dir = norm(dirPart || ".", sh.cwd), names = [];
      try { names = FS.list(dir).map(function (p) { return baseOf(p) + (FS.isDir(p) ? "/" : ""); }).filter(function (n) { return n.indexOf(stem) === 0; }); } catch (x) { names = []; }
      if (names.length === 1) tinp.value = parts.concat([dirPart + names[0]]).join(" ");
      else if (names.length > 1) {
        var common = names.reduce(function (a, b) { var i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); });
        if (common.length > stem.length) tinp.value = parts.concat([dirPart + common]).join(" ");
        else tsys(names.join("  "));
      }
    } else if (e.ctrlKey && e.key === "c") {
      e.preventDefault();
      tline('<span class="ide-g">' + esc(tilde(sh.cwd)) + '</span> <span class="ide-ac">❯</span> ' + esc(tinp.value) + '<span class="ide-g">^C</span>');
      tinp.value = "";
    } else if (e.ctrlKey && e.key === "l") { e.preventDefault(); clearTerm(); }
  });
  tout.addEventListener("mouseup", function () { if (!String(window.getSelection() || "")) tinp.focus({ preventScroll: true }); });
  function clearTerm() { tlog.textContent = ""; }
  function toggleTerm(on) {
    view.term = typeof on === "boolean" ? on : !view.term;
    applyView();
    persist();
    if (view.term) { renderPrompt(); setTimeout(function () { tinp.focus({ preventScroll: true }); tout.scrollTop = tout.scrollHeight; }, 0); }
    else if (cur()) cur().ta.focus({ preventScroll: true });
  }
  $(".ide-thd").addEventListener("mousedown", function (e) {
    var b = e.target.closest("[data-t]");
    if (!b) return;
    e.preventDefault();
    if (b.dataset.t === "clear") clearTerm(); else toggleTerm(false);
  });

  // ---- 运行当前文件：按扩展名（python / node / sh），在集成终端里跑；先存盘 ----
  function runnerOf(t) { return t && LANG[t.lang] && LANG[t.lang].run; }
  function runCurrent() {
    var t = cur();
    if (!t) return flash("没有打开的文件");
    var r = runnerOf(t);
    if (!r) return flash("不知道怎么运行 " + langName(t.path) + " 文件（支持 .py .js .sh）", "warn");
    if (t.dirty && !save(t)) return;
    var dir = parentOf(t.path), name = qarg(t.name);
    if (sh.cwd !== dir) execLine("cd " + qarg(tilde(dir)).replace(/^'~/, "~'"));
    if (r === "python" && remoteOn()) r = "python3"; // 真沙盒（macOS、Debian）只有 python3，没有 python
    if (r === "sh" && remoteOn()) execLine("sh " + name);
    else if (r === "sh") execLine("sh " + name, { run: function () { var src; try { src = FS.read(t.path); } catch (e) { return { out: "", err: errMsg(e) + "\n", code: 1 }; } return sh.run(src); } });
    else execLine(r + " " + name);
  }

  // ======== 状态栏 ========
  var flashT = 0, flashMsg = null;
  function flash(msg, kind) {
    flashMsg = { msg: msg, kind: kind || "" };
    clearTimeout(flashT);
    flashT = setTimeout(function () { flashMsg = null; renderStatus(); }, kind === "err" || kind === "warn" ? 6000 : 2800);
    renderStatus();
  }
  function renderStatus() {
    var t = cur(), sep = '<span class="ide-g"> · </span>';
    if (t) {
      var dot = t.conflict ? "ide-red" : t.dirty ? "ide-org" : t.deleted ? "ide-red" : "ide-grn";
      statusL.innerHTML = '<span class="' + dot + '">⏺</span> ' + esc(tilde(t.path)) + (t.deleted ? ' <span class="ide-red">（已删除）</span>' : "");
      var c = t.caret || { line: 0, col: 1 };
      statusR.innerHTML = ["Ln " + (c.line + 1) + ", Col " + c.col + (c.sel ? '<span class="ide-g">（已选 ' + c.sel + "）</span>" : ""), esc(langName(t.path)), t.crlf ? "CRLF" : "LF", "UTF-8", "空格:" + (LANG[t.lang].unit || 4)].join(sep);
    } else {
      statusL.innerHTML = '<span class="ide-ac">⏺</span> 编辑器' + sep + "工作目录 " + esc(tilde(ws));
      statusR.innerHTML = "⌘P 打开" + sep + "⌃` 终端";
    }
    statusM.className = "ide-smsg" + (flashMsg && flashMsg.kind ? " ide-" + { ok: "grn", err: "red", warn: "org" }[flashMsg.kind] : "");
    statusM.textContent = flashMsg ? "  ⎿ " + flashMsg.msg : "";
  }

  // ======== 拖动调尺寸：侧边栏宽、终端高 ========
  function dragger(handle, onMove) {
    handle.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || e.target.closest("[data-t]")) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      var x0 = e.clientX, y0 = e.clientY, start = onMove(null);
      function mv(ev) { onMove(start, ev.clientX - x0, ev.clientY - y0); }
      function up() { handle.removeEventListener("pointermove", mv); handle.removeEventListener("pointerup", up); persist(); schedulePaint(); if (cur() && cur().preview) schedulePreview(); }
      handle.addEventListener("pointermove", mv);
      handle.addEventListener("pointerup", up);
    });
  }
  dragger($(".ide-sash"), function (start, dx) {
    if (!start) return sideEl.offsetWidth;
    view.sideW = Math.max(140, Math.min(ide.clientWidth - 260, start + dx));
    sideEl.style.width = view.sideW + "px";
  });
  dragger($(".ide-thd"), function (start, dx, dy) {
    if (!start) return termEl.offsetHeight;
    view.termH = Math.max(LH * 4, Math.min(ide.clientHeight - LH * 8, start - dy));
    termEl.style.height = view.termH + "px";
    schedulePaint();
  });
  if (window.ResizeObserver) new ResizeObserver(function () { schedulePaint(); if (cur() && cur().preview) schedulePreview(); }).observe(code);
  // 按整行滚（同终端）：滚轮的量攒够一行才走一行，scrollTop 落在整行上
  function rowWheel(el) {
    var acc = 0;
    el.addEventListener("wheel", function (e) {
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      var px = e.deltaMode === 1 ? e.deltaY * LH : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
      if (Math.sign(px) !== Math.sign(acc)) acc = 0;
      acc += px;
      var rows = Math.trunc(acc / LH);
      if (!rows) return;
      acc -= rows * LH;
      el.scrollTop = Math.max(0, (Math.round(el.scrollTop / LH) + rows) * LH);
    }, { passive: false });
  }
  rowWheel(mdEl);
  rowWheel(tout);
  document.addEventListener("tsu-theme", function () { if (cur() && cur().preview) renderPreview(); });

  // ======== 菜单栏 ========
  function menus() {
    var t = cur(), md = t && t.lang === "markdown";
    return [
      { title: "文件", items: [
        it("新建文件…", "", function () { askNewFile(); }),
        it("新建文件夹…", "", function () { askNewDir(); }),
        it("打开…", "⌘P", quickOpen),
        it("打开文件夹…", "", askFolder),
        SEP,
        it("保存", "⌘S", function () { save(); }, { disabled: !t }),
        it("全部保存", "⌥⌘S", saveAll, { disabled: !tabs.some(function (x) { return x.dirty; }) }),
        it("从磁盘重新载入", "", function () { revert(); }, { disabled: !t || t.deleted }),
        SEP,
        it("关闭标签页", "⌘W", closeCur, { disabled: !t }),
        it("关闭全部标签页", "", closeAll, { disabled: !tabs.length }),
        SEP,
        it("在访达中显示", "", function () { window.TSU_FINDER.open(t.path); }, { disabled: !t || !window.TSU_FINDER }),
      ] },
      { title: "编辑", items: [
        it("撤销", "⌘Z", function () { if (t) { t.ta.focus(); document.execCommand("undo"); } }, { disabled: !t }),
        it("重做", "⇧⌘Z", function () { if (t) { t.ta.focus(); document.execCommand("redo"); } }, { disabled: !t }),
        SEP,
        it("查找", "⌘F", function () { openFind(false); }, { disabled: !t }),
        it("替换", "⌥⌘F", function () { openFind(true); }, { disabled: !t }),
        it("在文件中查找", "⇧⌘F", openSearch),
        SEP,
        it("跳到行…", "⌃G", gotoLinePal, { disabled: !t }),
        it("切换行注释", "⌘/", toggleComment, { disabled: !t || !LANG[t.lang].cmt }),
      ] },
      { title: "显示", items: [
        it("资源管理器", "⇧⌘E", function () { if (view.side && view.pane === "files") toggleSide(); else showPane("files"); }, { checked: view.side && view.pane === "files" }),
        it("搜索", "⇧⌘F", openSearch, { checked: view.side && view.pane === "search" }),
        it(view.side ? "隐藏侧边栏" : "显示侧边栏", "⌘B", toggleSide),
        SEP,
        it("终端", "⌃`", toggleTerm, { checked: view.term }),
        it("Markdown 预览", "⇧⌘V", togglePreview, { checked: !!(t && t.preview), disabled: !md }),
      ] },
      { title: "运行", items: [
        it("运行当前文件", "⌘R", runCurrent, { disabled: !runnerOf(t) }),
        SEP,
        it("终端：到工作目录", "", function () { execLine("cd " + qarg(ws)); }),
        it("清除终端", "⌘K", clearTerm),
      ] },
    ];
  }

  // ======== 快捷键：只在编辑器是最前面的窗口时接管 ========
  window.addEventListener("keydown", function (e) {
    if (D.front() !== win || win.state === "closed" || win.state === "min") return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key, c = e.code, hit = null;
    if (e.ctrlKey && !e.metaKey) {
      if (c === "Backquote") hit = toggleTerm;
      else if (k === "g" && !e.shiftKey) hit = gotoLinePal;
      else if (k === "w" && !e.shiftKey) hit = closeCur;
      else if (k === "Tab") hit = function () { cycleTab(e.shiftKey ? -1 : 1); };
    } else if (e.metaKey && !e.ctrlKey) {
      if (e.shiftKey && !e.altKey) {
        if (c === "KeyF") hit = openSearch;
        else if (c === "KeyV") hit = togglePreview;
        else if (c === "KeyE") hit = function () { showPane("files"); };
        else if (c === "BracketLeft") hit = function () { cycleTab(-1); };
        else if (c === "BracketRight") hit = function () { cycleTab(1); };
      } else if (e.altKey && !e.shiftKey) {
        if (c === "KeyF") hit = function () { openFind(true); };
        else if (c === "KeyS") hit = saveAll;
        else if (c === "ArrowLeft") hit = function () { cycleTab(-1); };
        else if (c === "ArrowRight") hit = function () { cycleTab(1); };
      } else if (!e.altKey) {
        if (k === "s") hit = function () { save(); };
        else if (k === "w") hit = closeCur;
        else if (k === "p") hit = quickOpen;
        else if (k === "f") hit = function () { openFind(false); };
        else if (k === "r") hit = runCurrent;
        else if (k === "b") hit = toggleSide;
        else if (k === "k" && termEl.contains(document.activeElement)) hit = clearTerm;
      }
    }
    if (hit) { e.preventDefault(); e.stopPropagation(); hit(); }
  }, true);

  // ---- Dock：深色方块里一对淡紫的 { } ----
  try {
    var dockA = D.addDockApp({ app: "ide", title: "编辑器", className: "ico-ide", icon: "<span>{ }</span>" });
    var fdA = document.querySelector('#dock [data-app="finder"]');
    if (fdA && dockA) fdA.after(dockA);
  } catch (e) { console.warn("编辑器：Dock 图标没加上", e); }
  // 关窗口前：有没存的就问（TSU_DESK.onBeforeClose 有才用；没有时关窗口也不丢——标签页留在内存和 localStorage 里）
  if (D.onBeforeClose) {
    try {
      D.onBeforeClose("ide", function () {
        var list = tabs.filter(function (t) { return t.dirty; });
        if (!list.length) return Promise.resolve(true);
        return askSave(list).then(function (a) {
          if (a === "cancel") return false;
          if (a === "save") return list.every(function (t) { return save(t); });
          list.forEach(function (t) { var d = null; try { d = FS.exists(t.path) ? normText(FS.read(t.path)) : null; } catch (e) { d = null; } reload(t, d == null ? t.base : d); });
          return true;
        });
      });
    } catch (e) { /* 忽略 */ }
  }

  // 第一次打开：恢复上次的标签页（文件系统要先载入好），画一遍；之后每次打开把焦点给编辑区
  var booted = false, fsReady = false;
  FS.ready().then(function () { fsReady = true; });
  function restore() {
    if (booted) return;
    booted = true;
    var un = {}, back = 0;
    try { un = JSON.parse(localStorage.getItem(STASH) || "{}") || {}; } catch (e) { un = {}; }
    var paths = (saved.tabs || []).slice();
    Object.keys(un).forEach(function (p) { if (paths.indexOf(p) < 0) paths.push(p); });
    paths.forEach(function (p) {
      var u = un[p], t = null;
      try {
        if (FS.exists(p) && !FS.isDir(p)) t = openFile(p, { noFocus: true });
        else if (u) { t = makeTab(p, u.base || ""); t.deleted = true; tabs.push(t); } // 磁盘上没了，但还有没存的内容
      } catch (e) { /* 没权限就跳过 */ }
      if (!t || !u || typeof u.text !== "string") return;
      // 上次没存的内容放回来（算作未保存）；这期间磁盘上又被改过 → 标冲突
      t.ta.value = u.text;
      setText(t, u.text);
      t.dirty = u.text !== t.base;
      t.conflict = t.dirty && !t.deleted && u.base !== t.base;
      if (t.dirty) back++;
    });
    if (back) flash("已恢复 " + back + " 个未保存的文件（⌘S 保存）", "warn");
    dirtyChanged();
    var ai = tabs.findIndex(function (t) { return t.path === saved.active; });
    if (ai < 0 && tabs.length) ai = 0; // 上次的当前标签页没了（文件删了）：落到第一个，不能停在 -1（⌘S、⌘F 都会没反应）
    if (ai >= 0) activate(ai, { noFocus: true });
    if (FS.isDir(ws)) sh.cwd = ws; else { ws = HOME; sh.cwd = HOME; }
    renderPrompt();
    renderTree();
    layout();
  }
  var show0 = win.show;
  win.show = function () {
    var wasClosed = win.state === "closed";
    show0.apply(win, arguments);
    measure();
    if (!booted) { if (fsReady) restore(); else FS.ready().then(restore); }
    showPane(view.pane);
    renderPrompt();
    layout();
    renderTabs();
    if (wasClosed) setTimeout(function () { var t = cur(); if (t && pal.hidden) t.ta.focus({ preventScroll: true }); }, 30);
  };

  // ---- 对外 ----
  function openPath(path, o) {
    return FS.ready().then(function () {
      var p = norm(String(path || ""), ws);
      if (win.state === "closed" || win.state === "min") win.show(); else win.front();
      if (!path) return;
      if (!FS.exists(p)) return flash("没有这个文件：" + tilde(p), "err");
      if (FS.isDir(p)) { setWs(p); showPane("files"); return; }
      return openFile(p, o);
    });
  }
  // ---- 从访达拖进来（同 VS Code）：拖到终端 = 插入路径（空格等加反斜杠；真沙盒用真路径）；拖到别处 = 文件打开、文件夹设为工作目录 ----
  var DRAG_MIME = "application/x-tsu-paths";
  var hasPaths = function (e) { return Array.prototype.indexOf.call((e.dataTransfer && e.dataTransfer.types) || [], DRAG_MIME) >= 0; };
  var onTerm = function (e) { return !termEl.hidden && termEl.contains(e.target); };
  var shEsc = function (p) { return String(p).replace(/([\s'"\\$`!&*()[\]{};<>?|#])/g, "\\$1"); };
  ide.addEventListener("dragover", function (e) {
    if (!hasPaths(e)) return;
    e.preventDefault();
    ide.classList.toggle("ide-drop-term", onTerm(e));
    ide.classList.toggle("ide-drop-ed", !onTerm(e));
  });
  ide.addEventListener("dragleave", function (e) { if (!ide.contains(e.relatedTarget)) ide.classList.remove("ide-drop-term", "ide-drop-ed"); });
  ide.addEventListener("drop", function (e) {
    ide.classList.remove("ide-drop-term", "ide-drop-ed");
    if (!hasPaths(e)) return;
    e.preventDefault();
    var paths = null;
    try { paths = JSON.parse(e.dataTransfer.getData(DRAG_MIME)); } catch (x) { return; }
    if (!Array.isArray(paths) || !paths.length) return;
    if (onTerm(e)) {
      var text = paths.map(function (p) { return shEsc(remoteOn() && FS.toReal ? FS.toReal(p) : p); }).join(" ") + " ";
      var a = tinp.selectionStart == null ? tinp.value.length : tinp.selectionStart, b = tinp.selectionEnd == null ? a : tinp.selectionEnd;
      tinp.value = tinp.value.slice(0, a) + text + tinp.value.slice(b);
      tinp.selectionStart = tinp.selectionEnd = a + text.length;
      return tinp.focus();
    }
    var files = paths.filter(function (p) { return !FS.isDir(p); }), dirs = paths.filter(function (p) { return FS.isDir(p); });
    if (!files.length && dirs.length) return openPath(dirs[0]);
    files.reduce(function (pr, p) { return pr.then(function () { return openPath(p); }); }, Promise.resolve());
  });

  window.TSU_IDE = {
    win: win,
    open: openPath,
    openFolder: function (dir) { return openPath(dir); },
    run: function (path) { return (path ? openPath(path) : Promise.resolve()).then(runCurrent); },
    exec: function (line) { if (win.state === "closed") win.show(); return execLine(line); },
    preview: function (on) { var t = cur(); if (t && t.lang === "markdown" && !!t.preview !== (on !== false)) togglePreview(); },
    find: function (q) { openFind(false); if (q != null) { fq.value = q; computeMatches(); pickNearest(); renderFindCount(); schedulePaint(); } },
    search: function (q) { openSearch(); if (q != null) { sin.value = q; runSearch(); } },
    quickOpen: function (q) { quickOpen(); if (q != null && P) { pq.value = q; palRefresh(); } },
    terminal: function (on) { toggleTerm(on !== false); },
  };
  FS.ready();
})();
