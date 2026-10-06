// files.js —— 文件（同 VS Code 的资源管理器）：活动栏里一个图标，主侧栏里这台 Mac 上一个文件夹的文件树。
//   根：打开的文件夹（默认主目录；「打开文件夹…」换——同 VS Code 的简易对话框：打路径、Tab 补全）；展开了哪些、选中哪个、最近打开的文件夹记在 localStorage 的 st-files
//   单击在编辑区打开（预览：再单击别的文件就换掉它；双击、回车固定下来）；编辑区换到哪个文件，树里跟着选中它（同 VS Code 的 autoReveal）
//   拖到终端里是路径（同从访达拖进终端）；右键：打开、在侧边打开、在访达中显示、在集成终端中打开、复制路径、复制相对路径、新建文件 / 文件夹、重命名、移到废纸篓（不会直接删掉）
//   只在 App 里（TSU_LOCAL：这台 Mac 上的文件）；视图经 STUDIO.addView 挂到活动栏
(function () {
  "use strict";
  var L = window.TSU_LOCAL;
  if (!L) return;
  var tries = 0;
  (function reg() { if (window.STUDIO && STUDIO.addView) return init(); if (++tries < 150) setTimeout(reg, 100); })();

  function init() {
    var S = window.STUDIO, N = window.nadosNative, I18N = function () { return window.TSU_I18N; };
    var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    var shq = function (p) { return window.TSU_TERM && TSU_TERM.shellEscape ? TSU_TERM.shellEscape(p) : "'" + String(p).replace(/'/g, "'\\''") + "'"; };
    var home = function () { var i = L.info(); return (i && i.home) || ""; };
    var tilde = function (p) { var h = home(); return h && (p === h || String(p).indexOf(h + "/") === 0) ? "~" + p.slice(h.length) : p; };
    var untilde = function (p) { var h = home(); p = String(p || "").trim(); if (p === "~") return h; if (p.indexOf("~/") === 0) return h + p.slice(1); return p; };
    var join = function (d, n) { return d === "/" ? "/" + n : d + "/" + n; };
    var dirOf = function (p) { var i = p.lastIndexOf("/"); return i <= 0 ? "/" : p.slice(0, i); };
    var baseOf = function (p) { return p === "/" ? "/" : p.slice(p.lastIndexOf("/") + 1); };
    var under = function (p, d) { return p === d || p.indexOf(d === "/" ? "/" : d + "/") === 0; };
    var sh = function (cmd) { return L.exec({ cmd: cmd }).then(function (r) { if (r.code) throw new Error(String(r.err || r.out || "").trim() || "exit " + r.code); return r; }); };
    var exists = function (p) { return L.stat(p).then(function (s) { return !!s; }, function () { return false; }); };
    var copy = function (t) { if (N) N.call("clipboard.write", { text: t }).catch(function () {}); else if (navigator.clipboard) navigator.clipboard.writeText(t).catch(function () {}); };

    // ---- 英文：页面的字照旧写中文，词典里没有的这里补上 ----
    if (I18N() && I18N().add) I18N().add({
      "打开文件夹…": "Open Folder…", "新建文件…": "New File…", "新建文件夹…": "New Folder…", "在侧边打开": "Open to the Side", "在集成终端中打开": "Open in Integrated Terminal",
      "复制路径": "Copy Path", "复制相对路径": "Copy Relative Path", "移到废纸篓": "Move to Trash", "显示隐藏文件": "Show Hidden Files", "最近打开的文件夹": "Open Recent",
      "在资源管理器中显示活动文件": "Reveal Active File in Explorer", "无法读取此文件夹": "Can't read this folder", "选择文件夹": "Select Folder", "打开此文件夹": "Open This Folder",
      "名称无效": "Invalid name", "名称不能包含「/」": "A name can't contain \"/\"", "在访达中显示": "Reveal in Finder", "新建文件": "New File", "新建文件夹": "New Folder",
    });

    // ---- 记着的：根、展开了哪些、选中哪个、最近打开的文件夹、显示隐藏文件 ----
    var KEY = "st-files";
    var st = (function () { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } })();
    st.open = st.open || {}; st.recent = st.recent || [];
    if (st.hidden === undefined) st.hidden = true;
    if (st.rootOpen === undefined) st.rootOpen = true;
    var save = function () { try { localStorage.setItem(KEY, JSON.stringify({ root: st.root, open: st.open, sel: st.sel, recent: st.recent.slice(0, 10), hidden: st.hidden, rootOpen: st.rootOpen })); } catch (e) { /* 满了就不记 */ } };
    var EXCLUDE = { ".git": 1, ".svn": 1, ".hg": 1, "CVS": 1, ".DS_Store": 1, "Thumbs.db": 1 }; // 同 VS Code 的 files.exclude 默认
    var JUNK = /^(~\$.*|Thumbs\.db|ehthumbs(_vista)?\.db|[Dd]esktop\.ini|Icon\r|\$RECYCLE\.BIN|System Volume Information)$/; // 显示隐藏文件关着时也不列：Office 的「~$」锁文件、Windows 留的这些

    // ---- 目录里的东西：按需读（展开才读），缓存着；再展开、刷新时重读 ----
    var dirs = {};
    function load(d, force) {
      var c = dirs[d] || (dirs[d] = {});
      if (c.p) return c.p;
      if (c.items && !force) return Promise.resolve(c);
      c.p = L.list(d).then(function (items) { c.items = items || []; c.err = ""; }, function (e) { c.items = []; c.err = String((e && e.message) || e); }).then(function () { c.p = null; return c; });
      return c.p;
    }

    // ---- 文件的图标：同标签页上的（browser.js 的 EXT_ICON），一两个字、按类型上色 ----
    var EXT = { md: ["md", "↓"], markdown: ["md", "↓"], js: ["js", "JS"], mjs: ["js", "JS"], cjs: ["js", "JS"], ts: ["ts", "TS"], tsx: ["ts", "TS"], jsx: ["js", "JS"], json: ["js", "{}"], jsonc: ["js", "{}"], py: ["py", "PY"],
      sh: ["sh", "$"], zsh: ["sh", "$"], bash: ["sh", "$"], swift: ["cc", "SW"], css: ["ts", "#"], scss: ["ts", "#"], html: ["cc", "<>"], htm: ["cc", "<>"], xml: ["cc", "<>"], vue: ["py", "V"], svelte: ["cc", "S"],
      yml: ["cfg", "⚙"], yaml: ["cfg", "⚙"], toml: ["cfg", "⚙"], ini: ["cfg", "⚙"], env: ["cfg", "⚙"], lock: ["cfg", "⚙"], txt: ["cfg", "≡"], log: ["cfg", "≡"], csv: ["py", "≡"],
      png: ["py", "▣"], jpg: ["py", "▣"], jpeg: ["py", "▣"], gif: ["py", "▣"], svg: ["py", "▣"], webp: ["py", "▣"], ico: ["py", "▣"], heic: ["py", "▣"], pdf: ["cc", "▤"],
      go: ["ts", "GO"], rs: ["cc", "RS"], c: ["ts", "C"], h: ["ts", "H"], cpp: ["ts", "C+"], hpp: ["ts", "H+"], m: ["ts", "M"], java: ["cc", "J"], kt: ["cc", "K"], rb: ["cc", "RB"], php: ["ts", "P"], sql: ["md", "DB"],
      zip: ["cfg", "▦"], gz: ["cfg", "▦"], tar: ["cfg", "▦"], dmg: ["cfg", "▦"], mp4: ["py", "▶"], mov: ["py", "▶"], mp3: ["py", "♪"], wav: ["py", "♪"] };
    var NAMES = { dockerfile: ["ts", "◆"], makefile: ["cfg", "⚙"], license: ["cfg", "≡"], ".gitignore": ["cfg", "⚙"], ".gitattributes": ["cfg", "⚙"], ".editorconfig": ["cfg", "⚙"], ".npmrc": ["cfg", "⚙"] };
    function fileIco(name) {
      if (window.TSU_FICON) return TSU_FICON(name); // 一套好看、一样大的细线图标（ficons.js）；没有它才用下面的字
      var n = String(name || "").toLowerCase(), e = n.lastIndexOf(".") > 0 ? n.slice(n.lastIndexOf(".") + 1) : "", x = NAMES[n] || EXT[e] || ["cfg", "≡"];
      return '<i class="st-ico st-i-' + x[0] + '">' + x[1] + "</i>";
    }

    // ---- 图标：活动栏（24 格线条，同 VS Code 资源管理器的两张纸）、标题栏按钮与菜单（16 格）----
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3.5h5.2l4.3 4.3v8.7a1.5 1.5 0 0 1-1.5 1.5h-8a1.5 1.5 0 0 1-1.5-1.5V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M14.5 3.7v3.1a1 1 0 0 0 1 1h3.3"/><path d="M5 7.5v11.2a1.8 1.8 0 0 0 1.8 1.8H15"/></svg>';
    var IC = function (b) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' + b + "</svg>"; };
    var FI = {
      newFile: IC('<path d="M8.6 2.5H4.5A1.2 1.2 0 0 0 3.3 3.7v8.6a1.2 1.2 0 0 0 1.2 1.2h3"/><path d="M8.6 2.5l3.4 3.4v1.6M8.6 2.5v2.8a.6.6 0 0 0 .6.6H12"/><path d="M11.5 9.5v4.2M9.4 11.6h4.2"/>'),
      newFolder: IC('<path d="M8 12.5H2.8a.8.8 0 0 1-.8-.8V4.1a.8.8 0 0 1 .8-.8h3.1l1.4 1.5h5.9a.8.8 0 0 1 .8.8v2.2"/><path d="M11.8 9.2v4.2M9.7 11.3h4.2"/>'),
      refresh: IC('<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M11.8 1.9v2.7H9.1"/>'),
      folder: IC('<path d="M2 4.2a.8.8 0 0 1 .8-.8h3.1l1.4 1.5h5.9a.8.8 0 0 1 .8.8v6.4a.8.8 0 0 1-.8.8H2.8a.8.8 0 0 1-.8-.8z"/>'),
      copy: IC('<rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.3"/><path d="M10.8 5.2V3.8a1.3 1.3 0 0 0-1.3-1.3H3.8a1.3 1.3 0 0 0-1.3 1.3v5.7a1.3 1.3 0 0 0 1.3 1.3h1.4"/>'),
      trash: IC('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4"/>'),
      hidden: IC('<rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1.8" stroke-dasharray="2 1.6"/>'), // 显示隐藏文件（不用眼睛图标）
    };
    var MI = function () { return S.menuIcons ? S.menuIcons() : {}; };

    // ---- 各窗口里的这个视图 ----
    var views = [];
    var edit = null; // 正在打字的那一行：{ kind: newFile | newFolder | rename, dir, path, value, err, tw }
    var en = function () { return !!(I18N() && I18N().lang && I18N().lang() !== "zh"); };
    var titleText = function () { return en() ? "Files" : "文件"; };

    function rowsOf() {
      var out = [], root = st.root;
      if (!root) return out;
      out.push({ path: root, name: baseOf(root) || root, dir: true, depth: -1, root: true });
      if (!st.rootOpen) return out;
      (function walk(d, depth) {
        var c = dirs[d];
        if (edit && edit.kind !== "rename" && edit.dir === d) out.push({ edit: true, depth: depth });
        if (!c || !c.items) { if (!c || !c.p) load(d).then(repaintAll); return; }
        if (c.err) { out.push({ info: "无法读取此文件夹", depth: depth }); return; }
        c.items.forEach(function (it) {
          if (EXCLUDE[it.name] || (!st.hidden && (it.name[0] === "." || JUNK.test(it.name)))) return;
          var p = join(d, it.name), r = { path: p, name: it.name, dir: !!it.dir, depth: depth, dot: it.name[0] === "." || JUNK.test(it.name) };
          out.push(r);
          if (r.dir && st.open[p]) walk(p, depth + 1);
        });
      })(root, 0);
      return out;
    }
    // 一行（同访达的列表看法里展开的文件夹）：每一层一样的缩进（一个展开箭头的宽）；前面固定一格放展开箭头（文件夹 › / ⌄，文件空着），
    //   再一格图标（文件夹、文件类型），名字都从同一列开始；选中、悬停是整行一样的圆角。名字放不下时才有提示（停一会儿，在这一行下面）
    var FOLDER = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M1.8 4.2c0-.6.4-1 1-1h3.1l1.4 1.5h5.9c.6 0 1 .4 1 1v6.6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z" fill="currentColor" fill-opacity=".18"/></svg>';
    var disHtml = function (open) { return '<span class="st-ft-dis">' + (open === undefined ? "" : '<span class="ts-chev ' + (open ? "d" : "r") + '"></span>') + "</span>"; };
    function rowHtml(r, i) {
      var d = ' style="--d:' + Math.max(0, r.depth) + '"';
      if (r.info) return '<div class="st-ft-row st-finfo"' + d + ">" + disHtml() + '<span class="st-ft-ic"></span><span class="st-fname">' + esc(r.info) + "</span></div>";
      if (r.edit) return '<div class="st-ft-row st-fedit dir-' + (edit.kind === "newFolder" ? "y" : "n") + '"' + d + ">" + disHtml(edit.kind === "newFolder" ? false : undefined) + '<span class="st-ft-ic">' + (edit.kind === "newFolder" ? FOLDER : fileIco(edit.value)) + '</span><input class="st-finput" spellcheck="false" autocomplete="off" value="' + esc(edit.value || "") + '"></div>' + errHtml(r.depth);
      var open = r.root ? st.rootOpen : !!st.open[r.path], renaming = edit && edit.kind === "rename" && edit.path === r.path;
      var cls = "st-ft-row" + (r.dir ? " dir" : "") + (r.root ? " root" : "") + (r.dot ? " dot" : "") + (r.path === st.sel && !r.root ? " sel" : "");
      var ic = r.root ? "" : '<span class="st-ft-ic">' + (r.dir ? FOLDER : fileIco(renaming ? edit.value : r.name)) + "</span>";
      return '<div class="' + cls + '" data-i="' + i + '"' + d + (r.root ? "" : ' draggable="true"') + (!r.dir && !r.root && r.path ? ' data-fpath="' + esc(r.path) + '"' : "") + ">" + disHtml(r.dir || r.root ? open : undefined) + ic + // data-fpath：指针停在文件上先读进来（studio.js 的 prefetch）
        (renaming ? '<input class="st-finput" spellcheck="false" autocomplete="off" value="' + esc(edit.value) + '">' : '<span class="st-fname">' + esc(r.name) + "</span>") + "</div>" + (renaming ? errHtml(r.depth) : "");
    }
    var errHtml = function (depth) { return edit && edit.err ? '<div class="st-ferr" style="--d:' + Math.max(0, depth) + '">' + esc(edit.err) + "</div>" : ""; };
    var preQ = [], preN = 0;
    function prePump() {
      while (preN < 2 && preQ.length) {
        var d = preQ.shift(), c = dirs[d];
        if (c && (c.items || c.p)) continue;
        preN++;
        load(d).then(function () { preN--; prePump(); });
      }
    }
    function prefetch(rows) {
      preQ = rows.filter(function (r) { var c = dirs[r.path]; return r.dir && !r.root && !st.open[r.path] && !(c && (c.items || c.p)); }).slice(0, 40).map(function (r) { return r.path; });
      prePump();
    }
    function paint(v) {
      if (!v.el.isConnected && v.el.hidden) return;
      var list = v.list, top = list.scrollTop, had = document.activeElement && list.contains(document.activeElement) && document.activeElement.classList.contains("st-finput");
      v.rows = rowsOf();
      setTimeout(function () { prefetch(v.rows); }, 120); // 看得见的文件夹先读好
      list.innerHTML = v.rows.map(rowHtml).join("");
      list.scrollTop = top;
      var ft = v.el.querySelector(".st-ftitle"); if (ft) ft.textContent = titleText(); // Claude 风格的文件卡片把标题行搬走了：没有就不管
      var inp = list.querySelector(".st-finput");
      if (inp && edit && edit.tw === v.tw) {
        inp.focus({ preventScroll: true });
        if (!had) { var dot = edit.kind === "newFolder" ? -1 : inp.value.lastIndexOf("."); inp.setSelectionRange(0, dot > 0 ? dot : inp.value.length); } else inp.setSelectionRange(inp.value.length, inp.value.length);
        inp.scrollIntoView({ block: "nearest" });
      }
    }
    function repaintAll() { views.forEach(paint); }
    var scrollSel = function (v) { var r = v.list.querySelector(".st-ft-row.sel"); if (r) r.scrollIntoView({ block: "nearest" }); };
    var rowAt = function (v, el) { var r = el && el.closest(".st-ft-row[data-i]"); return r ? v.rows[+r.dataset.i] : null; };
    var selRow = function (v) { for (var i = 0; i < v.rows.length; i++) if (v.rows[i].path === st.sel && !v.rows[i].root) return v.rows[i]; return null; };

    // ---- 打开：单击是预览（再单击别的换掉它；动过的——改了没存——不换），双击、回车固定 ----
    var paneOf = function (tw, path) { var hit = null; tw.ws.all().forEach(function (p) { var pr = p.program; if (!hit && pr && pr.page === "file" && pr.arg === path) hit = p; }); return hit; };
    var pristine = function (p, path) { var pr = p && !p.closed && p.program; return !!(pr && pr.page === "file" && pr.arg === path && !/^● /.test(p.title ? p.title() : "")); };
    function openFile(tw, path, pin) {
      var have = paneOf(tw, path), prev = tw.stFilePrev;
      S.openFile(tw, path);
      if (have) { if (pin && prev && prev.path === path) tw.stFilePrev = null; return; }
      var p = paneOf(tw, path);
      if (prev && prev.pane !== p && pristine(prev.pane, prev.path)) tw.ws.closePane(prev.pane);
      tw.stFilePrev = pin || !p ? null : { pane: p, path: path };
    }
    // 在侧边打开：右边拆出一组放它（同 VS Code 的「在侧边打开」）；已经开着就切过去
    function openSide(tw, path) {
      if (paneOf(tw, path) || !tw.ws.active) return openFile(tw, path, true);
      tw.ws.split("row");
      var dup = tw.ws.active;
      S.openFile(tw, path);
      if (dup && dup !== tw.ws.active && !(dup.program && dup.program.pty)) tw.ws.closePane(dup);
    }
    function revealFinder(path) { sh("open -R " + shq(path)).catch(function () {}); }
    function inTerminal(tw, dir) { if (S.panelOpen && !S.panelOpen() && S.togglePanel) S.togglePanel(tw, true); if (S.newTerm) S.newTerm(tw, null, dir); }

    // ---- 新建、重命名：树里就地出一个输入框（同 VS Code）；回车定、Esc 算了、点别处也定 ----
    function targetDir(v) { var r = selRow(v); return r ? (r.dir ? r.path : dirOf(r.path)) : st.root; }
    function startNew(v, kind, dir) {
      dir = dir || targetDir(v);
      if (!dir) return;
      if (dir !== st.root) st.open[dir] = true; else st.rootOpen = true;
      save();
      edit = { kind: kind, dir: dir, value: "", err: "", tw: v.tw };
      load(dir).then(repaintAll);
      repaintAll();
    }
    function startRename(v, r) { if (!r || r.root) return; edit = { kind: "rename", path: r.path, dir: dirOf(r.path), value: r.name, err: "", tw: v.tw }; repaintAll(); }
    function commitEdit(ok) {
      var e = edit;
      if (!e || e.busy) return;
      var v0 = String(e.value || "").trim();
      if (!ok || !v0) { edit = null; return repaintAll(); }
      if (/^\.\.?$/.test(v0) || /\0/.test(v0) || /^\/|\/$/.test(v0)) { e.err = "名称无效"; return repaintAll(); }
      if (e.kind === "rename" && v0.indexOf("/") >= 0) { e.err = "名称不能包含「/」"; return repaintAll(); }
      var target = e.kind === "rename" ? join(e.dir, v0) : join(e.dir, v0);
      if (e.kind === "rename" && target === e.path) { edit = null; return repaintAll(); }
      e.busy = true;
      exists(target).then(function (yes) {
        e.busy = false;
        if (edit !== e) return;
        if (yes) { e.err = en() ? "A file or folder \u201c" + v0 + "\u201d already exists at this location. Please choose a different name." : "此位置已存在文件或文件夹「" + v0 + "」。请选择其他名称。"; return repaintAll(); }
        edit = null;
        var job = e.kind === "newFolder" ? sh("mkdir -p " + shq(target))
          : e.kind === "newFile" ? (v0.indexOf("/") >= 0 ? sh("mkdir -p " + shq(dirOf(target))) : Promise.resolve()).then(function () { return L.write(target, ""); })
          : sh("mv -n " + shq(e.path) + " " + shq(target));
        job.then(function () {
          if (e.kind === "rename") {
            Object.keys(st.open).forEach(function (k) { if (under(k, e.path)) { st.open[target + k.slice(e.path.length)] = st.open[k]; delete st.open[k]; } });
            views.forEach(function (v) { v.tw.ws.all().forEach(function (p) { var pr = p.program; if (pr && pr.page === "file" && pr.go && under(pr.arg, e.path) && pristine(p, pr.arg)) pr.go(target + pr.arg.slice(e.path.length)); }); });
          }
          for (var d = dirOf(target); d !== e.dir && under(d, e.dir) && d !== "/"; d = dirOf(d)) st.open[d] = true; // 打了 a/b/c：一路展开
          st.sel = target;
          save();
          return Promise.all([load(e.dir, true), load(dirOf(target), true)]).then(function () {
            repaintAll();
            views.forEach(scrollSel);
            if (e.kind === "newFile") openFile(e.tw, target, true);
          });
        }, function (err) { alert((e.kind === "rename" ? (en() ? "Couldn't rename: " : "无法重命名：") : (en() ? "Couldn't create: " : "无法新建：")) + err.message); repaintAll(); });
      });
    }
    // 移到废纸篓（同访达、VS Code 的「删除」）：先问一句；不会直接删掉
    function trashIt(r) {
      if (!r || r.root) return;
      if (!confirm(en() ? "Are you sure you want to move \u201c" + r.name + "\u201d to the Trash?\nYou can restore this " + (r.dir ? "folder" : "file") + " from the Trash." : "确定要将「" + r.name + "」移到废纸篓吗？\n可以从废纸篓中恢复此" + (r.dir ? "文件夹" : "文件") + "。")) return;
      sh("/usr/bin/trash " + shq(r.path)).then(function () {
        if (st.sel === r.path) st.sel = dirOf(r.path);
        delete st.open[r.path];
        save();
        return load(dirOf(r.path), true).then(repaintAll);
      }, function (err) { alert((en() ? "Couldn't move to the Trash: " : "无法移到废纸篓：") + err.message); });
    }
    function refresh() { Object.keys(dirs).forEach(function (d) { if (d === st.root || st.open[d]) load(d, true).then(repaintAll); else delete dirs[d]; }); }
    function collapseAll() { st.open = {}; save(); repaintAll(); }
    function setRoot(p) {
      if (!p) return;
      st.root = p;
      st.rootOpen = true;
      st.recent = [p].concat(st.recent.filter(function (x) { return x !== p; })).slice(0, 10);
      if (!under(st.sel || "", p)) st.sel = "";
      save();
      load(p, true).then(repaintAll);
    }

    // ---- 打开文件夹…：同 VS Code 的简易对话框——一个框打路径（~ 是主目录），下面是这一层的文件夹；Tab / → 补全进去，回车打开，Esc 算了 ----
    function openFolder(tw) {
      var old = document.querySelector(".st-palette");
      if (old) old.remove();
      var box = document.createElement("div"), sel = 0, items = [], seq = 0;
      box.className = "st-palette terminal-style-ui";
      box.innerHTML = '<div class="st-pin"><span class="st-lav">❯</span><input spellcheck="false" autocomplete="off" placeholder="选择文件夹"></div><div class="st-plist"></div>';
      tw.el.appendChild(box);
      var input = box.querySelector("input"), listEl = box.querySelector(".st-plist"), done = false;
      input.value = tilde(st.root || home()).replace(/\/?$/, "/");
      var split = function () { var v = untilde(input.value), i = v.lastIndexOf("/"); return { dir: i <= 0 ? "/" : v.slice(0, i), frag: v.slice(i + 1) }; };
      function compute() {
        var my = ++seq, sp = split();
        load(sp.dir).then(function (c) {
          if (my !== seq || done) return;
          var f = sp.frag.toLowerCase();
          items = [];
          if (!f) items.push({ open: sp.dir, title: "打开此文件夹", desc: tilde(sp.dir) });
          (c.items || []).forEach(function (it) { if (it.dir && (!f || it.name.toLowerCase().indexOf(f) === 0) && (f[0] === "." || it.name[0] !== ".")) items.push({ into: join(sp.dir, it.name), title: it.name + "/" }); });
          if (c.err) items.push({ title: "无法读取此文件夹", off: true });
          sel = Math.min(sel, Math.max(0, items.length - 1));
          paintL();
        });
      }
      function paintL() {
        listEl.innerHTML = items.slice(0, 200).map(function (it, i) { return '<div class="st-prow' + (i === sel ? " on" : "") + (it.off ? " st-dim" : "") + '" data-i="' + i + '"><span class="st-ptr">' + (i === sel ? "❯" : " ") + '</span><span class="st-cut st-pt">' + esc(it.title) + (it.desc ? '<span class="st-pdesc">' + esc(it.desc) + "</span>" : "") + "</span></div>"; }).join("");
        var on = listEl.querySelector(".on"); if (on) on.scrollIntoView({ block: "nearest" });
      }
      var close = function () { if (done) return; done = true; box.remove(); var P = tw.ws.active; if (P) P.focus(); };
      var into = function (p) { input.value = tilde(p).replace(/\/?$/, "/"); sel = 0; compute(); };
      var pick = function (it) {
        if (!it || it.off) return;
        if (it.open) { close(); setRoot(it.open); S.showView(tw, "files"); return; }
        close(); setRoot(it.into); S.showView(tw, "files");
      };
      input.addEventListener("input", function () { sel = 0; compute(); });
      input.addEventListener("keydown", function (e) {
        if (e.isComposing || e.keyCode === 229) return;
        var it = items[sel];
        if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paintL(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); paintL(); }
        else if (e.key === "Tab" || (e.key === "ArrowRight" && input.selectionStart === input.value.length)) { if (it && it.into) { e.preventDefault(); into(it.into); } else if (e.key === "Tab") e.preventDefault(); }
        else if (e.key === "Enter") { e.preventDefault(); var sp = split(); if (!sp.frag) pick({ open: sp.dir }); else if (it && it.into) pick(it); else exists(untilde(input.value)).then(function (y) { if (y) pick({ open: untilde(input.value).replace(/\/$/, "") }); }); }
        else if (e.key === "Escape") { e.preventDefault(); close(); }
        e.stopPropagation();
      });
      listEl.addEventListener("mousedown", function (e) { var r = e.target.closest("[data-i]"); if (!r) return; e.preventDefault(); var it = items[+r.dataset.i]; if (it && it.into && e.detail < 2) { sel = +r.dataset.i; into(it.into); } else pick(it); });
      input.addEventListener("blur", function () { setTimeout(function () { if (!done && document.activeElement !== input) close(); }, 150); });
      compute();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }

    // ---- 右键菜单（在 App 里是系统的菜单）----
    function rowMenu(v, r, at) {
      var mi = MI(), tw = v.tw, root = st.root, it = [];
      if (!r.dir) it.push({ label: "打开", icon: mi.open, sym: "arrow.up.forward.square", run: function () { openFile(tw, r.path, true); } }, { label: "在侧边打开", keys: "⌃↩", icon: mi.splitR, sym: "rectangle.split.2x1", run: function () { openSide(tw, r.path); } }, { sep: true });
      if (r.dir) it.push({ label: "新建文件…", icon: FI.newFile, sym: "doc.badge.plus", run: function () { startNew(v, "newFile", r.path); } }, { label: "新建文件夹…", icon: FI.newFolder, sym: "folder.badge.plus", run: function () { startNew(v, "newFolder", r.path); } }, { sep: true });
      it.push({ label: "在访达中显示", keys: "⌥⌘R", icon: FI.folder, sym: "folder", run: function () { revealFinder(r.path); } });
      it.push({ label: "在集成终端中打开", icon: mi.term, sym: "terminal", run: function () { inTerminal(tw, r.dir ? r.path : dirOf(r.path)); } });
      it.push({ sep: true }, { label: "复制路径", keys: "⌥⌘C", icon: FI.copy, sym: "doc.on.doc", run: function () { copy(r.path); } }, { label: "复制相对路径", keys: "⌥⇧⌘C", icon: FI.copy, sym: "doc.on.doc", run: function () { copy(r.path === root ? "." : r.path.slice(root.length + 1)); } });
      if (!r.root) it.push({ sep: true }, { label: "重命名…", keys: "F2", icon: mi.rename, sym: "pencil", run: function () { startRename(v, r); } }, { label: "移到废纸篓", keys: "⌘⌫", icon: FI.trash, sym: "trash", run: function () { trashIt(r); } });
      S.menu(it, at);
    }
    function moreMenu(v, anchor) {
      var mi = MI(), tw = v.tw, rec = st.recent.filter(function (p) { return p !== st.root; });
      S.menu(function () {
        return [
          { label: "打开文件夹…", icon: FI.folder, sym: "folder", run: function () { openFolder(tw); } },
          { label: "最近打开的文件夹", icon: mi.history, sym: "clock.arrow.circlepath", disabled: !rec.length, items: rec.map(function (p) { return { label: tilde(p), run: function () { setRoot(p); } }; }) },
          { sep: true },
          { label: "新建文件…", icon: FI.newFile, sym: "doc.badge.plus", run: function () { startNew(v, "newFile"); } },
          { label: "新建文件夹…", icon: FI.newFolder, sym: "folder.badge.plus", run: function () { startNew(v, "newFolder"); } },
          { sep: true },
          { label: "在访达中显示", icon: FI.folder, sym: "folder", run: function () { revealFinder(st.root); } },
          { label: "在集成终端中打开", icon: mi.term, sym: "terminal", run: function () { inTerminal(tw, st.root); } },
          { sep: true },
          { label: "显示隐藏文件", icon: FI.hidden, sym: "square.dashed", checked: !!st.hidden, run: function () { st.hidden = !st.hidden; save(); repaintAll(); } },
          { label: "刷新", icon: FI.refresh, sym: "arrow.clockwise", run: refresh },
          { label: "全部折叠", icon: mi.collapse, sym: "minus.square", run: collapseAll },
        ];
      }, { el: anchor, side: "below-end" });
    }

    // ---- 视图 ----
    function create(tw) {
      var el = document.createElement("div"), ico = S.icons || {};
      el.className = "st-fview terminal-style-ui";
      el.innerHTML = '<div class="st-shdr"><code class="st-vtitle st-ftitle">' + titleText() + '</code><span class="st-fill"></span>' +
        '<button class="st-hbtn" data-f="newFile" title="新建文件…">' + FI.newFile + '</button><button class="st-hbtn" data-f="newFolder" title="新建文件夹…">' + FI.newFolder + "</button>" +
        '<button class="st-hbtn" data-f="refresh" title="刷新">' + FI.refresh + '</button><button class="st-hbtn" data-f="collapse" title="全部折叠">' + (ico.collapse || "") + "</button>" +
        '<button class="st-hbtn" data-f="more" title="更多操作">' + (ico.more || "···") + '</button></div><div class="st-flist" tabindex="-1"></div>';
      var v = { tw: tw, el: el, list: el.querySelector(".st-flist"), rows: [] };
      views.push(v);
      var list = v.list;
      // 名字放不下时才有提示（全名）：停 0.6 秒再出来，贴在这一行下面（不盖住这一行）；滚动、按下就收
      var tip = null, tipT = 0, hideTip = function () { clearTimeout(tipT); if (tip) { tip.remove(); tip = null; } };
      list.addEventListener("mouseover", function (e) {
        var nm = e.target.closest && e.target.closest(".st-fname");
        if (!nm || !list.contains(nm)) return;
        hideTip();
        if (nm.scrollWidth <= nm.clientWidth + 1) return;
        tipT = setTimeout(function () {
          var row = nm.isConnected && nm.closest(".st-ft-row");
          if (!row) return;
          var rr = row.getBoundingClientRect(), nr = nm.getBoundingClientRect();
          tip = document.createElement("div"); tip.className = "st-ft-tip"; tip.textContent = nm.textContent;
          document.body.appendChild(tip);
          tip.style.left = Math.max(4, Math.min(nr.left - 4, innerWidth - tip.offsetWidth - 4)) + "px";
          tip.style.top = (rr.bottom + 3 + tip.offsetHeight > innerHeight ? rr.top - tip.offsetHeight - 3 : rr.bottom + 3) + "px";
        }, 600);
      });
      list.addEventListener("mouseout", function (e) { var nm = e.target.closest && e.target.closest(".st-fname"); if (nm && !(e.relatedTarget && nm.contains(e.relatedTarget))) hideTip(); });
      list.addEventListener("scroll", hideTip, { passive: true });
      list.addEventListener("mousedown", hideTip, true);
      el.querySelector(".st-shdr").addEventListener("click", function (e) {
        var b = e.target.closest("[data-f]");
        if (!b) return;
        var f = b.dataset.f;
        if (f === "newFile" || f === "newFolder") startNew(v, f);
        else if (f === "refresh") refresh();
        else if (f === "collapse") collapseAll();
        else if (f === "more") moreMenu(v, b);
      });
      list.addEventListener("click", function (e) {
        if (e.target.closest(".st-finput")) return;
        var r = rowAt(v, e.target);
        if (!r) return;
        if (edit) commitEdit(true);
        if (r.root) { st.rootOpen = !st.rootOpen; save(); return repaintAll(); }
        st.sel = r.path;
        save();
        if (r.dir) { st.open[r.path] = !st.open[r.path]; save(); if (st.open[r.path]) load(r.path, true).then(repaintAll); repaintAll(); return; }
        repaintAll();
        if (e.detail === 1) openFile(tw, r.path, false);
      });
      list.addEventListener("dblclick", function (e) { var r = rowAt(v, e.target); if (r && !r.dir) openFile(tw, r.path, true); });
      list.addEventListener("contextmenu", function (e) {
        var r = rowAt(v, e.target);
        e.preventDefault();
        e.stopPropagation();
        if (!r) r = v.rows[0];
        if (!r) return;
        if (!r.root) { st.sel = r.path; save(); repaintAll(); }
        rowMenu(v, r, { x: e.clientX, y: e.clientY });
      });
      // 拖出去：终端里是路径（同从访达拖进终端）
      list.addEventListener("dragstart", function (e) {
        var r = rowAt(v, e.target);
        if (!r || r.root) return e.preventDefault();
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("application/x-tsu-paths", JSON.stringify([r.path]));
        e.dataTransfer.setData("text/plain", r.path);
      });
      // 输入框（新建、重命名）
      list.addEventListener("input", function (e) { if (e.target.classList.contains("st-finput") && edit) { edit.value = e.target.value; if (edit.err) { edit.err = ""; repaintAll(); } } });
      list.addEventListener("keydown", function (e) {
        if (e.target.classList.contains("st-finput")) {
          if (e.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter") { e.preventDefault(); commitEdit(true); list.focus({ preventScroll: true }); }
          else if (e.key === "Escape") { e.preventDefault(); commitEdit(false); list.focus({ preventScroll: true }); }
          e.stopPropagation();
          return;
        }
        keys(v, e);
      });
      list.addEventListener("focusout", function (e) { if (e.target.classList && e.target.classList.contains("st-finput") && edit && !edit.busy) setTimeout(function () { if (edit && !list.contains(document.activeElement)) commitEdit(true); }, 0); });
      list.addEventListener("focus", function () { if (!selRow(v) && v.rows[1]) { st.sel = v.rows[1].path; repaintAll(); } });
      return el;
    }
    // 键盘（同 VS Code 的资源管理器）：↑↓ 移、← 收起 / 回上一层、→ 展开 / 进去、回车打开（文件夹展开收起）、空格预览、F2 重命名、⌘⌫ 移到废纸篓、⌥⌘C 复制路径、打字跳到那个名字
    var typed = "", typedT = 0;
    function keys(v, e) {
      var rows = v.rows.filter(function (r) { return r.path && !r.edit && !r.info; }), i = rows.findIndex(function (r) { return r.path === st.sel && !r.root; }), r = rows[i];
      var go = function (k) { var t = rows[Math.max(0, Math.min(rows.length - 1, k))]; if (t && !t.root) { st.sel = t.path; save(); repaintAll(); views.forEach(scrollSel); } };
      if (e.metaKey && e.key === "Backspace") { e.preventDefault(); return trashIt(r); }
      if (e.metaKey && e.altKey && e.code === "KeyC") { e.preventDefault(); if (r) copy(e.shiftKey ? r.path.slice(st.root.length + 1) : r.path); return; }
      if (e.metaKey && e.key === "ArrowDown") { e.preventDefault(); if (r && !r.dir) openFile(v.tw, r.path, true); return; }
      if (e.metaKey && e.altKey && e.code === "KeyR") { e.preventDefault(); if (r) revealFinder(r.path); return; }
      if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); if (r && !r.dir) openSide(v.tw, r.path); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown") { e.preventDefault(); go(i < 0 ? 1 : i + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); go(i <= 1 ? 1 : i - 1); }
      else if (e.key === "ArrowRight" && r) { e.preventDefault(); if (r.dir && !st.open[r.path]) { st.open[r.path] = true; save(); load(r.path, true).then(repaintAll); repaintAll(); } else if (r.dir) go(i + 1); }
      else if (e.key === "ArrowLeft" && r) { e.preventDefault(); if (r.dir && st.open[r.path]) { st.open[r.path] = false; save(); repaintAll(); } else { var up = dirOf(r.path); if (up !== st.root && under(up, st.root)) { st.sel = up; save(); repaintAll(); views.forEach(scrollSel); } } }
      else if (e.key === "Enter" && r) { e.preventDefault(); if (r.dir) { st.open[r.path] = !st.open[r.path]; save(); if (st.open[r.path]) load(r.path, true).then(repaintAll); repaintAll(); } else openFile(v.tw, r.path, true); }
      else if (e.key === " " && r) { e.preventDefault(); if (!r.dir) { openFile(v.tw, r.path, false); v.list.focus({ preventScroll: true }); } }
      else if (e.key === "F2" && r) { e.preventDefault(); startRename(v, r); }
      else if (e.key === "Home") { e.preventDefault(); go(1); }
      else if (e.key === "End") { e.preventDefault(); go(rows.length - 1); }
      else if (e.key.length === 1 && e.key !== " ") {
        clearTimeout(typedT);
        typed += e.key.toLowerCase();
        typedT = setTimeout(function () { typed = ""; }, 800);
        for (var k = 1; k <= rows.length; k++) { var t = rows[(Math.max(i, 0) + (typed.length === 1 ? k : k - 1)) % rows.length]; if (t && !t.root && t.name.toLowerCase().indexOf(typed) === 0) { st.sel = t.path; save(); repaintAll(); views.forEach(scrollSel); break; } }
      }
    }

    // ---- 编辑区换到哪个文件：树里跟着选中它，一路展开（同 VS Code 的 explorer.autoReveal）----
    setInterval(function () {
      views.forEach(function (v) {
        var P = v.tw.ws && v.tw.ws.active, pr = P && P.program, p = pr && pr.page === "file" ? pr.arg : "";
        if (!p || p === v.lastActive) return;
        v.lastActive = p;
        if (!st.root || !under(p, st.root) || p === st.root) return;
        var chain = [];
        for (var d = dirOf(p); d !== st.root && under(d, st.root); d = dirOf(d)) chain.unshift(d);
        chain.forEach(function (d) { st.open[d] = true; });
        st.sel = p;
        save();
        Promise.all(chain.map(function (d) { return load(d); })).then(function () { repaintAll(); if (!v.el.hidden) scrollSel(v); });
      });
    }, 700);

    // ---- 挂到活动栏；命令面板里的几条 ----
    S.addView("files", {
      title: "文件", icon: ICON, sym: "doc.on.doc", order: 1,
      create: function (tw) { var el = create(tw); L.ready.then(function () { if (!st.root) { st.root = home(); save(); } load(st.root).then(repaintAll); }); return el; },
      show: function (el, tw, fromBar) {
        var v = views.filter(function (x) { return x.el === el; })[0];
        if (!v) return;
        if (st.root) load(st.root, true).then(repaintAll);
        paint(v);
        if (!fromBar) v.list.focus({ preventScroll: true });
      },
    });
    if (S.command) {
      S.command("files.openFolder", { title: "打开文件夹…", run: function (tw) { openFolder(tw); } });
      S.command("files.newFile", { title: "新建文件…", run: function (tw) { S.showView(tw, "files"); var v = views.filter(function (x) { return x.tw === tw; })[0]; if (v) startNew(v, "newFile"); } });
      S.command("files.newFolder", { title: "新建文件夹…", run: function (tw) { S.showView(tw, "files"); var v = views.filter(function (x) { return x.tw === tw; })[0]; if (v) startNew(v, "newFolder"); } });
      S.command("files.collapse", { title: "在资源管理器中折叠文件夹", run: collapseAll });
      S.command("files.refresh", { title: "刷新资源管理器", run: refresh });
      S.command("files.reveal", { title: "在资源管理器中显示活动文件", run: function (tw) { var P = tw.ws.active, pr = P && P.program; if (pr && pr.page === "file") { views.forEach(function (v) { v.lastActive = ""; }); S.showView(tw, "files"); } } });
    }
    if (I18N() && I18N().onChange) I18N().onChange(function () { views.forEach(function (v) { var t = v.el.querySelector(".st-ftitle"); if (t) t.textContent = titleText(); }); });
  }
})();
