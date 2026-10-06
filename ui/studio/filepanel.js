// filepanel.js —— 小的文件面板（学 Claude App 右边的「Files」卡片）：一块地方里又能找、又能看。
//   上面一排：显示 / 收起文件树 · 打开着的文件（标签，× 关，中键也关）· 搜索 · ⋮（在编辑器标签页中打开、在访达中显示、拷贝路径、显示隐藏文件）· 放大 ⤢ / 还原 ⤡ · 关闭 ×
//   左边：筛选框（打字按名字模糊筛，匹配的字标出来；「?」开头搜文件内容——本机 rg / grep，结果带那一行，点了跳到那一行）+ 文件树（点开才读，点文件夹开 / 合，. 开头的淡一点）
//   右边：文件名、路径；正文带行号、语法高亮（hl.js）、当前行淡淡的底；图片、PDF 直接看；很大的文件只读前面一段（说一句），只画看得见的那些行；⌘F 在文件里找
//   Claude 的样子：它的深 / 浅两套颜色、紧凑的行、细线；树和正文中间能拖，记着。打开的文件、当前那个、宽度、展开了哪些，按 key 记在本机（localStorage）
//   对外：TSU_FILEPANEL.mount(el, { root, key, onClose, onExpand, expanded }) → { open(path, line), setRoot(path), setExpanded(on), refresh(), destroy() }
//   文件都经 TSU_LOCAL（App 里这台 Mac 上的文件，同「文件」视图 files.js）；网页里没有 TSU_LOCAL 时只说一句
(function () {
  "use strict";
  if (window.TSU_FILEPANEL) return;
  var LOC = function () { return window.TSU_LOCAL; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var shq = function (p) { return "'" + String(p).replace(/'/g, "'\\''") + "'"; };
  var home = function () { var i = LOC() && LOC().info ? LOC().info() : null; return (i && i.home) || ""; };
  var tilde = function (p) { var h = home(); return h && (p === h || String(p).indexOf(h + "/") === 0) ? "~" + p.slice(h.length) : p; };
  var join = function (d, n) { return d === "/" ? "/" + n : d + "/" + n; };
  var baseOf = function (p) { return p === "/" ? "/" : p.slice(p.lastIndexOf("/") + 1); };
  var dirOf = function (p) { var i = p.lastIndexOf("/"); return i <= 0 ? "/" : p.slice(0, i); };
  var extOf = function (n) { var i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; };
  var relOf = function (root, p) { return p === root ? "" : p.indexOf(root === "/" ? "/" : root + "/") === 0 ? p.slice(root === "/" ? 1 : root.length + 1) : p; };
  var store = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v && typeof v === "object" ? v : d; } catch (e) { return d; } };
  var keep = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 满了就不记 */ } };
  var kb = function (n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B"; };
  var copy = function (t) { var N = window.nadosNative; if (N) N.call("clipboard.write", { text: t }).catch(function () {}); else if (navigator.clipboard) navigator.clipboard.writeText(t).catch(function () {}); };

  // ---- 小图标：细线的，按文件类型分几种（同 Claude 的文件卡片）----
  var SV = function (b) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' + b + "</svg>"; };
  var FILE = '<path d="M4 1.8h5.2L12.2 4.8v9.4H4z"/><path d="M9 1.8v3.2h3.2"/>';
  var IC = {
    chev: SV('<path d="M6 4l4 4-4 4"/>'),
    folder: SV('<path d="M1.8 4.2c0-.6.4-1 1-1h3.1l1.4 1.4h5.9c.6 0 1 .4 1 1v6.7c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z"/>'),
    file: SV(FILE),
    code: SV(FILE + '<path d="M7 8.6L5.9 9.9 7 11.2M9 8.6l1.1 1.3L9 11.2"/>'),
    text: SV(FILE + '<path d="M6 8.4h4M6 10.2h4M6 12h2.4"/>'),
    json: SV('<path d="M6 2.5c-1.2 0-1.6.6-1.6 1.6v1.6c0 .7-.4 1.2-1.2 1.4.8.2 1.2.7 1.2 1.4v1.6c0 1 .4 1.6 1.6 1.6M10 2.5c1.2 0 1.6.6 1.6 1.6v1.6c0 .7.4 1.2 1.2 1.4-.8.2-1.2.7-1.2 1.4v1.6c0 1-.4 1.6-1.6 1.6"/>'),
    md: SV('<rect x="1.8" y="3.8" width="12.4" height="8.4" rx="1.4"/><path d="M4.3 10V6.1l1.6 2 1.6-2V10M10.7 6v3.9M9.4 8.7l1.3 1.3 1.3-1.3"/>'),
    image: SV('<rect x="2" y="2.8" width="12" height="10.4" rx="1.4"/><circle cx="5.8" cy="6.3" r="1.1"/><path d="M2.6 12l3.6-3.5 2.6 2.4 1.7-1.5 3 2.6"/>'),
    pdf: SV(FILE + '<path d="M6 9.2h4.2M6 11.2h4.2"/>'),
    cfg: SV('<circle cx="8" cy="8" r="1.9"/><path d="M8 2.2v1.6M8 12.2v1.6M2.2 8h1.6M12.2 8h1.6M3.9 3.9L5 5M11 11l1.1 1.1M3.9 12.1L5 11M11 5l1.1-1.1"/>'),
    tree: SV('<rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.6"/><path d="M6 2.6v10.8M3.6 5.2h.9M3.6 7.2h.9"/>'),
    search: SV('<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2l3.6 3.6"/>'),
    more: '<svg viewBox="0 0 16 16"><circle cx="8" cy="3.6" r="1.15" fill="currentColor"/><circle cx="8" cy="8" r="1.15" fill="currentColor"/><circle cx="8" cy="12.4" r="1.15" fill="currentColor"/></svg>',
    expand: SV('<path d="M9.6 2.4h4v4M13.6 2.4L9.2 6.8M6.4 13.6h-4v-4M2.4 13.6L6.8 9.2"/>'),
    shrink: SV('<path d="M13.4 2.6L9.4 6.6M9.4 3v3.6H13M2.6 13.4l4-4M6.6 13V9.4H3"/>'),
    close: SV('<path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"/>'),
    up: SV('<path d="M4 10l4-4 4 4"/>'),
    down: SV('<path d="M4 6l4 4 4-4"/>'),
  };
  var IMG = /^(png|jpe?g|gif|webp|bmp|ico|svg|heic|heif|avif|tiff?)$/;
  var CODE = /^(js|mjs|cjs|jsx|ts|tsx|py|pyw|rb|go|rs|c|h|cc|cpp|cxx|hpp|m|mm|swift|kt|kts|java|cs|php|sh|zsh|bash|fish|lua|pl|r|scala|sql|css|scss|sass|less|html?|xml|vue|svelte|dart|zig|ex|exs|erl|hs|clj|el|vim|gradle|cmake|make)$/;
  function iconOf(name, dir) {
    if (window.TSU_FICON) return TSU_FICON.svg(name, dir); // 同「文件」视图的那一套图形（这里单色，Claude 的样子）
    if (dir) return IC.folder;
    var x = extOf(name);
    return IMG.test(x) ? IC.image : x === "pdf" ? IC.pdf : /^(json|jsonc|json5|lock)$/.test(x) ? IC.json : /^(md|markdown|mdx)$/.test(x) ? IC.md : CODE.test(x) || /^(Makefile|Dockerfile)$/.test(name) ? IC.code
      : /^(ya?ml|toml|ini|conf|cfg|env|plist|properties)$/.test(x) || name[0] === "." ? IC.cfg : /^(txt|log|csv|tsv|rtf)$/.test(x) ? IC.text : IC.file;
  }
  var MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml", heic: "image/heic", heif: "image/heif", avif: "image/avif", tif: "image/tiff", tiff: "image/tiff", pdf: "application/pdf" };
  var EXCLUDE = { ".git": 1, ".svn": 1, ".hg": 1, ".DS_Store": 1 }; // 同 VS Code 的 files.exclude：显示隐藏文件也不列
  var CAP = 2 * 1048576, LINE_CAP = 200000, LH = 18; // 读多少、画多少行；一行多高（同 filepanel.css 的 --fp-lh）
  var RG = 'RG=$(command -v rg || ls /opt/homebrew/bin/rg /usr/local/bin/rg 2>/dev/null | head -n 1); ';
  var nat = function (a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }); };

  // 模糊匹配：q 的每个字按顺序出现在 s 里（不分大小写）；连着的、在文件名里的、在词头的分高。给出分数和匹配到的位置（好标出来）
  function fuzzy(q, s) {
    var ql = q.toLowerCase(), sl = s.toLowerCase(), base = s.lastIndexOf("/") + 1;
    var try1 = function (from) {
      var idx = [], j = 0, score = 0, last = -2;
      for (var i = from; i < sl.length && j < ql.length; i++) {
        if (sl[i] !== ql[j]) continue;
        idx.push(i);
        score += (i === last + 1 ? 6 : 1) + (i >= base ? 3 : 0) + (i === 0 || "/._- ".indexOf(s[i - 1]) >= 0 ? 4 : 0);
        last = i; j++;
      }
      return j < ql.length ? null : { score: score - s.length * 0.02, idx: idx };
    };
    var a = try1(0), b = base > 0 ? try1(base) : null; // 先试只在文件名里，再试整个路径，取分高的
    return b && (!a || b.score >= a.score) ? b : a;
  }
  var marked = function (s, idx) { var set = {}, out = ""; idx.forEach(function (i) { set[i] = 1; }); for (var i = 0; i < s.length; i++) out += set[i] ? "<b>" + esc(s[i]) + "</b>" : esc(s[i]); return out; };

  function mount(el, opts) {
    opts = opts || {};
    var KEY = "tsu-fp:" + (opts.key || "default"), st = store(KEY, {});
    var root = String(opts.root || st.root || home() || "/").replace(/\/+$/, "") || "/";
    st.tabs = Array.isArray(st.tabs) ? st.tabs.filter(function (p) { return typeof p === "string"; }) : [];
    st.open = st.open && typeof st.open === "object" ? st.open : {};
    if (st.hidden === undefined) st.hidden = true;
    if (st.tree === undefined) st.tree = true;
    st.treeW = +st.treeW || 240;
    var expanded = !!opts.expanded, dead = false;
    var save = function () { keep(KEY, { root: root, tabs: st.tabs.slice(-30), active: st.active || "", open: st.open, hidden: st.hidden, tree: st.tree, treeW: st.treeW }); };

    el.classList.add("fp");
    el.innerHTML =
      '<div class="fp-top"><button type="button" class="fp-ib" data-a="tree" title="显示 / 收起文件树">' + IC.tree + '</button><div class="fp-tabs"></div>' +
      '<button type="button" class="fp-ib" data-a="search" title="搜索文件">' + IC.search + '</button><button type="button" class="fp-ib" data-a="more" title="更多">' + IC.more + "</button>" +
      '<button type="button" class="fp-ib" data-a="expand" title="放大"></button><button type="button" class="fp-ib" data-a="close" title="关闭">' + IC.close + "</button></div>" +
      '<div class="fp-main"><div class="fp-tree"><div class="fp-filter"><input type="text" spellcheck="false" autocomplete="off" placeholder="筛选文件…（输入 ? 搜索内容）"></div><div class="fp-list" tabindex="0"></div></div>' +
      '<div class="fp-sash" title="拖动调整宽度；双击还原"></div>' +
      '<div class="fp-view"><div class="fp-vhead"></div><div class="fp-find" hidden><input type="text" spellcheck="false" placeholder="在文件中查找"><span class="fp-fcount"></span>' +
      '<button type="button" class="fp-ib" data-a="fprev" title="上一个 (⇧↵)">' + IC.up + '</button><button type="button" class="fp-ib" data-a="fnext" title="下一个 (↵)">' + IC.down + '</button><button type="button" class="fp-ib" data-a="fclose" title="关闭 (Esc)">' + IC.close + "</button></div>" +
      '<div class="fp-body"></div></div></div>';
    var q = function (s) { return el.querySelector(s); };
    var tabsEl = q(".fp-tabs"), listEl = q(".fp-list"), input = q(".fp-filter input"), headEl = q(".fp-vhead"), bodyEl = q(".fp-body"), findEl = q(".fp-find"), findIn = findEl.querySelector("input"), findCount = q(".fp-fcount");
    q('[data-a="close"]').hidden = !opts.onClose;
    q('[data-a="expand"]').hidden = !opts.onExpand;
    var paintTop = function () {
      var b = q('[data-a="expand"]'), h = expanded ? IC.shrink : IC.expand;
      if (b.dataset.h !== h) { b.dataset.h = h; b.innerHTML = h; }
      b.title = expanded ? "还原" : "放大";
      el.classList.toggle("fp-notree", !st.tree);
      el.style.setProperty("--fp-tw", st.treeW + "px");
    };
    paintTop();

    // ======== 文件树：点开才读（同「文件」视图），读过的记着；再点开一次重读（外面改过也跟得上）========
    var dirs = {}, selPath = "";
    function load(d, force) {
      var c = dirs[d] || (dirs[d] = {});
      if (c.p) return c.p;
      if (c.items && !force) return Promise.resolve(c);
      if (!LOC()) { c.items = []; c.err = "没有本机文件（只在 App 里有）"; return Promise.resolve(c); }
      c.p = LOC().list(d).then(function (items) { c.items = items || []; c.err = ""; }, function (e) { c.items = c.items || []; c.err = String((e && e.message) || e); }).then(function () { c.p = null; return c; });
      return c.p;
    }
    var shown = function (it) { return !EXCLUDE[it.name] && (st.hidden || it.name[0] !== "."); };
    var sorted = function (items) { return items.filter(shown).sort(function (a, b) { return (b.dir ? 1 : 0) - (a.dir ? 1 : 0) || nat(a.name, b.name); }); };
    function treeHtml() {
      var out = [], n = 0;
      var walk = function (d, dep) {
        var c = dirs[d];
        if (!c || !c.items) { out.push('<div class="fp-row fp-dim" style="--dep:' + dep + '"><i class="fp-chev"></i><span class="fp-nm">加载中…</span></div>'); return; }
        if (c.err && !c.items.length) { out.push('<div class="fp-row fp-dim" style="--dep:' + dep + '"><i class="fp-chev"></i><span class="fp-nm">' + esc(c.err) + "</span></div>"); return; }
        sorted(c.items).forEach(function (it) {
          if (++n > 5000) return; // 太多了：一棵展开的树不会看这么多行
          var p = join(d, it.name), open = it.dir && st.open[p];
          out.push('<div class="fp-row' + (it.name[0] === "." ? " fp-dot" : "") + (p === selPath || p === st.active ? " on" : "") + '" data-p="' + esc(p) + '" data-d="' + (it.dir ? 1 : 0) + '" style="--dep:' + dep + '">' +
            '<i class="fp-chev' + (open ? " open" : "") + '">' + (it.dir ? IC.chev : "") + '</i><i class="fp-ico">' + iconOf(it.name, it.dir) + '</i><span class="fp-nm">' + esc(it.name) + "</span></div>");
          if (open) walk(p, dep + 1);
        });
      };
      walk(root, 0);
      return out.join("") || '<div class="fp-empty">空文件夹</div>';
    }
    function paintTree() {
      if (mode !== "tree") return;
      var h = treeHtml();
      if (listEl.dataset.h !== h) { var top = listEl.scrollTop; listEl.dataset.h = h; listEl.innerHTML = h; listEl.scrollTop = top; }
    }
    // 展开了的文件夹：一开始都读进来（按记下的）
    function loadOpen() {
      var ps = [load(root)];
      Object.keys(st.open).forEach(function (p) { if (st.open[p] && (p === root || p.indexOf(root === "/" ? "/" : root + "/") === 0)) ps.push(load(p)); else delete st.open[p]; });
      Promise.all(ps).then(paintTree);
    }
    function toggleDir(p) {
      if (st.open[p]) { delete st.open[p]; save(); paintTree(); return; }
      st.open[p] = 1; save(); paintTree();
      load(p, true).then(paintTree);
    }
    // 打开的文件在树里：它的上层都展开，滚到它
    function revealInTree(p) {
      if (!p || relOf(root, p) === p) return;
      var d = dirOf(p), ps = [];
      while (d.length > root.length && d !== root) { if (!st.open[d]) { st.open[d] = 1; ps.push(load(d)); } d = dirOf(d); }
      save();
      Promise.all(ps).then(function () { paintTree(); var r = listEl.querySelector('.fp-row[data-p="' + CSS.escape(p) + '"]'); if (r) r.scrollIntoView({ block: "nearest" }); });
    }

    // ======== 筛选：打字按名字模糊筛（整个根下的文件名，rg --files / find 列一次，缓存）；「?」开头搜内容（rg / grep）========
    var mode = "tree", index = null, indexKey = "", fTimer = 0, ctl = null, hits = [];
    function fileIndex() {
      var k = root + "|" + st.hidden;
      if (index && indexKey === k) return index;
      indexKey = k;
      var cmd = "cd " + shq(root) + " && { " + RG + 'if [ -n "$RG" ]; then "$RG" --files --no-messages ' + (st.hidden ? "--hidden " : "") + "-g '!.git' 2>/dev/null; else find . -type f -not -path '*/.git/*' " +
        (st.hidden ? "" : "-not -name '.*' -not -path '*/.*' ") + "2>/dev/null | sed 's|^\\./||'; fi; } | head -n 30000";
      index = LOC() ? LOC().exec({ cmd: cmd }).then(function (r) { return String(r.out || "").split("\n").filter(Boolean); }, function () { return []; }) : Promise.resolve([]);
      return index;
    }
    function runFilter() {
      var v = input.value;
      clearTimeout(fTimer);
      if (ctl) { try { ctl.abort(); } catch (e) { /* 已经完了 */ } ctl = null; }
      if (!v.trim()) { mode = "tree"; listEl.dataset.h = ""; paintTree(); return; }
      if (v[0] === "?") { mode = "grep"; fTimer = setTimeout(function () { grep(v.slice(1).trim()); }, 320); if (!listEl.querySelector(".fp-hit")) listEl.innerHTML = '<div class="fp-empty">搜索内容中…</div>'; return; }
      mode = "name";
      var my = v;
      fileIndex().then(function (files) {
        if (dead || input.value !== my) return;
        var qq = my.trim(), res = [];
        for (var i = 0; i < files.length; i++) { var m = fuzzy(qq, files[i]); if (m) res.push({ f: files[i], m: m }); }
        res.sort(function (a, b) { return b.m.score - a.m.score || a.f.length - b.f.length; });
        listEl.dataset.h = "";
        listEl.innerHTML = res.slice(0, 300).map(function (x) {
          var f = x.f, b = f.lastIndexOf("/") + 1, name = f.slice(b), dir = f.slice(0, Math.max(0, b - 1));
          var nIdx = x.m.idx.filter(function (i) { return i >= b; }).map(function (i) { return i - b; }), dIdx = x.m.idx.filter(function (i) { return i < b - 1; });
          return '<div class="fp-row fp-res' + (name[0] === "." ? " fp-dot" : "") + '" data-p="' + esc(join(root, f)) + '" data-d="0"><i class="fp-ico">' + iconOf(name) + '</i><span class="fp-nm">' + marked(name, nIdx) + "</span>" + (dir ? '<span class="fp-dir">' + marked(dir, dIdx) + "</span>" : "") + "</div>";
        }).join("") || '<div class="fp-empty">没有匹配的文件</div>';
      });
    }
    function grep(qs) {
      if (qs.length < 2) { listEl.innerHTML = '<div class="fp-empty">输入要搜的内容（至少两个字）</div>'; return; }
      if (!LOC()) return;
      var my = input.value;
      ctl = window.AbortController ? new AbortController() : null;
      var cmd = "cd " + shq(root) + " && { " + RG + 'if [ -n "$RG" ]; then "$RG" --line-number --no-heading --color never --max-count 5 --max-columns 240 --max-columns-preview --max-filesize 2M -S -F ' + (st.hidden ? "--hidden " : "") + "-g '!.git' -- " + shq(qs) + " . 2>/dev/null; " +
        "else grep -rnIF --exclude-dir=.git -m 5 -- " + shq(qs) + " . 2>/dev/null; fi; } | head -n 400";
      LOC().exec({ cmd: cmd }, ctl && ctl.signal).then(function (r) {
        if (dead || input.value !== my) return;
        hits = [];
        String(r.out || "").split("\n").forEach(function (l) { var m = /^(.*?):(\d+):(.*)$/.exec(l); if (m) hits.push({ f: m[1].replace(/^\.\//, ""), line: +m[2], text: m[3] }); });
        var groups = [], by = {};
        hits.forEach(function (h) { if (!by[h.f]) { by[h.f] = []; groups.push(h.f); } by[h.f].push(h); });
        var ql = qs.toLowerCase(), hl = function (t) { var i = t.toLowerCase().indexOf(ql); t = t.replace(/\t/g, "  "); if (i < 0) return esc(t.trim()); var s0 = Math.max(0, i - 40); return (s0 ? "…" : "") + esc(t.slice(s0, i)) + "<b>" + esc(t.slice(i, i + qs.length)) + "</b>" + esc(t.slice(i + qs.length)); };
        listEl.dataset.h = "";
        listEl.innerHTML = groups.map(function (f) {
          var name = baseOf(f), dir = f.indexOf("/") >= 0 ? dirOf(f) : "";
          return '<div class="fp-row fp-res fp-hfile" data-p="' + esc(join(root, f)) + '" data-d="0"><i class="fp-ico">' + iconOf(name) + '</i><span class="fp-nm">' + esc(name) + "</span>" + (dir ? '<span class="fp-dir">' + esc(dir) + "</span>" : "") + '<span class="fp-cnt">' + by[f].length + "</span></div>" +
            by[f].map(function (h) { return '<div class="fp-row fp-hit" data-p="' + esc(join(root, f)) + '" data-l="' + h.line + '"><span class="fp-hl">' + h.line + '</span><span class="fp-ht">' + hl(h.text) + "</span></div>"; }).join("");
        }).join("") || '<div class="fp-empty">没有找到</div>';
      }, function () { /* 换了新的搜：这个不要了 */ });
    }
    input.addEventListener("input", runFilter);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { if (input.value) { input.value = ""; runFilter(); } else input.blur(); e.preventDefault(); e.stopPropagation(); }
      if (e.key === "Enter") { var r = listEl.querySelector(".fp-res, .fp-hit"); if (r) { e.preventDefault(); r.click(); } }
      if (e.key === "ArrowDown") { e.preventDefault(); listEl.focus(); moveSel(1); }
    });

    listEl.addEventListener("click", function (e) {
      var r = e.target.closest(".fp-row[data-p]");
      if (!r) return;
      var p = r.dataset.p;
      selPath = p;
      if (r.dataset.d === "1") { toggleDir(p); return; }
      open(p, +r.dataset.l || 0);
    });
    // 树里上下键：选中哪一行；→ / ↵ 打开，← 合上
    function moveSel(d) {
      var rows = Array.prototype.slice.call(listEl.querySelectorAll(".fp-row[data-p]")), i = rows.findIndex(function (r) { return r.classList.contains("sel"); });
      rows.forEach(function (r) { r.classList.remove("sel"); });
      var n = rows[Math.max(0, Math.min(rows.length - 1, i < 0 ? 0 : i + d))];
      if (n) { n.classList.add("sel"); n.scrollIntoView({ block: "nearest" }); }
    }
    listEl.addEventListener("keydown", function (e) {
      var s = listEl.querySelector(".fp-row.sel");
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); moveSel(e.key === "ArrowDown" ? 1 : -1); return; }
      if (!s) return;
      if (e.key === "Enter" || (e.key === "ArrowRight" && s.dataset.d === "1" && !st.open[s.dataset.p])) { e.preventDefault(); s.click(); }
      else if (e.key === "ArrowLeft" && s.dataset.d === "1" && st.open[s.dataset.p]) { e.preventDefault(); toggleDir(s.dataset.p); }
    });

    // ======== 标签：打开的文件；点一下换过去，× 或中键关 ========
    function paintTabs() {
      var h = st.tabs.map(function (p) {
        return '<div class="fp-tab' + (p === st.active ? " on" : "") + '" data-p="' + esc(p) + '" title="' + esc(tilde(p)) + '"><i class="fp-ico">' + iconOf(baseOf(p)) + '</i><span class="fp-tn">' + esc(baseOf(p)) + '</span><button type="button" class="fp-tc" data-a="tclose" title="关闭">' + IC.close + "</button></div>";
      }).join("");
      if (tabsEl.dataset.h !== h) { tabsEl.dataset.h = h; tabsEl.innerHTML = h; }
      var on = tabsEl.querySelector(".fp-tab.on");
      if (on) on.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    function closeTab(p) {
      var i = st.tabs.indexOf(p);
      if (i < 0) return;
      st.tabs.splice(i, 1);
      if (st.active === p) { st.active = st.tabs[Math.min(i, st.tabs.length - 1)] || ""; show(st.active); }
      save(); paintTabs(); paintTree();
    }
    tabsEl.addEventListener("click", function (e) {
      var t = e.target.closest(".fp-tab");
      if (!t) return;
      if (e.target.closest('[data-a="tclose"]')) { e.stopPropagation(); closeTab(t.dataset.p); return; }
      if (t.dataset.p !== st.active) open(t.dataset.p);
    });
    tabsEl.addEventListener("auxclick", function (e) { var t = e.target.closest(".fp-tab"); if (t && e.button === 1) { e.preventDefault(); closeTab(t.dataset.p); } });
    tabsEl.addEventListener("mousedown", function (e) { if (e.button === 1) e.preventDefault(); }); // 中键：不要自动滚动的那个圈

    // ======== 看文件 ========
    var doc = null, seq = 0, HL = function () { return window.TSU_HL; };
    function open(p, line) {
      if (!p) return;
      if (st.tabs.indexOf(p) < 0) st.tabs.push(p);
      st.active = p; selPath = p;
      save(); paintTabs();
      if (mode === "tree") paintTree();
      if (doc && doc.path === p && doc.kind === "text") { if (line) goLine(line - 1, true); return; }
      show(p, line);
    }
    function head(p, note) {
      var rel = relOf(root, p), d = rel.indexOf("/") >= 0 ? dirOf(rel) : rel === p ? dirOf(tilde(p)) : "";
      headEl.innerHTML = p ? '<i class="fp-ico">' + iconOf(baseOf(p)) + '</i><span class="fp-hn">' + esc(baseOf(p)) + "</span>" + (d ? '<span class="fp-hp">' + esc(d) + "</span>" : "") + (note ? '<span class="fp-hnote">' + esc(note) + "</span>" : "") : "";
      headEl.title = p ? tilde(p) : "";
    }
    function free() { if (doc && doc.url) URL.revokeObjectURL(doc.url); }
    function show(p, line) {
      var my = ++seq;
      closeFind();
      free();
      doc = null;
      if (!p) { head(""); bodyEl.innerHTML = '<div class="fp-empty fp-big">在左边选一个文件</div>'; return; }
      head(p);
      bodyEl.innerHTML = '<div class="fp-empty">打开中…</div>';
      if (!LOC()) { bodyEl.innerHTML = '<div class="fp-empty">没有本机文件（只在 App 里有）</div>'; return; }
      var x = extOf(baseOf(p)), mime = MIME[x];
      LOC().stat(p).then(function (s) {
        if (my !== seq) return;
        if (!s) throw new Error("文件不存在");
        if (s.dir) { head(p); bodyEl.innerHTML = '<div class="fp-empty">这是一个文件夹</div>'; return; }
        var size = s.size || 0;
        if (mime) { // 图片、PDF：整个读进来，交给浏览器画
          if (size > 60 * 1048576) { bodyEl.innerHTML = '<div class="fp-empty">文件太大（' + esc(kb(size)) + "），不在这里预览</div>"; return; }
          return LOC().read(p, { max: size + 16 }).then(function (b) {
            if (my !== seq) return;
            var url = URL.createObjectURL(new Blob([b], { type: mime }));
            doc = { path: p, kind: x === "pdf" ? "pdf" : "image", url: url, size: size };
            head(p, kb(size));
            bodyEl.innerHTML = x === "pdf" ? '<iframe class="fp-pdf" src="' + url + '" title="PDF"></iframe>' : '<div class="fp-img"><img src="' + url + '" alt=""><span class="fp-imgsz"></span></div>';
            var im = bodyEl.querySelector("img");
            if (im) im.onload = function () { var z = bodyEl.querySelector(".fp-imgsz"); if (z) z.textContent = im.naturalWidth + " × " + im.naturalHeight; };
          });
        }
        return LOC().read(p, { max: CAP }).then(function (b) {
          if (my !== seq) return;
          for (var i = 0, n = Math.min(b.length, 8000); i < n; i++) if (b[i] === 0) { doc = { path: p, kind: "bin", size: size }; head(p, kb(size)); bodyEl.innerHTML = '<div class="fp-empty">二进制文件（' + esc(kb(size)) + "），不显示内容</div>"; return; }
          var text = new TextDecoder("utf-8").decode(b), lines = text.split(/\r?\n/), capped = size > CAP;
          if (capped && lines.length > 1) lines.pop(); // 截断处那一行不完整
          if (lines.length > LINE_CAP) { lines.length = LINE_CAP; capped = true; }
          if (lines.length > 1 && lines[lines.length - 1] === "" && !capped) lines.pop();
          doc = { path: p, kind: "text", lines: lines, html: [], st: [""], upto: 0, cur: -1, size: size, capped: capped, Lg: HL() ? HL().LANG[HL().langOf(p)] : null };
          head(p, capped ? "只显示前 " + kb(Math.min(size, CAP)) + "（共 " + kb(size) + "）" : "");
          textView(line ? line - 1 : -1);
        });
      }).catch(function (e) { if (my !== seq) return; bodyEl.innerHTML = '<div class="fp-empty">打不开：' + esc((e && e.message) || e) + "</div>"; });
    }
    // 正文：只画看得见的那些行（上下多画一些），一行一个 div（行号 + 高亮过的字）；高亮是一行一行往下算的（行与行之间传一个状态），算过的记着
    var codeEl = null, linesEl = null, raf = 0;
    function textView(goto) {
      bodyEl.innerHTML = '<div class="fp-code" tabindex="0"><div class="fp-spacer"></div><div class="fp-lines"></div></div>';
      codeEl = bodyEl.querySelector(".fp-code"); linesEl = bodyEl.querySelector(".fp-lines");
      var n = doc.lines.length;
      codeEl.style.setProperty("--fp-gw", (String(n).length + 1.6) + "ch");
      bodyEl.querySelector(".fp-spacer").style.height = n * LH + "px";
      codeEl.addEventListener("scroll", function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(paintLines); }, { passive: true });
      codeEl.addEventListener("click", function (e) { var l = e.target.closest(".fp-l"); if (!l || String(getSelection() || "")) return; doc.cur = +l.dataset.i; paintLines(true); });
      codeEl.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); goLine(Math.max(0, Math.min(n - 1, (doc.cur < 0 ? Math.floor(codeEl.scrollTop / LH) : doc.cur) + (e.key === "ArrowDown" ? 1 : -1))), false); }
      });
      if (goto >= 0) goLine(goto, true); else paintLines(true);
    }
    function hlUpTo(k) {
      var d = doc, H = HL();
      if (!H || !d.Lg) return;
      for (var i = d.upto; i <= k && i < d.lines.length; i++) { var r = H.line(d.lines[i], d.st[i], d.Lg); d.html[i] = r[0]; d.st[i + 1] = r[1]; }
      d.upto = Math.max(d.upto, Math.min(k + 1, d.lines.length));
    }
    function paintLines(force) {
      if (!doc || doc.kind !== "text" || !codeEl) return;
      var d = doc, top = codeEl.scrollTop, h = codeEl.clientHeight || 400, a = Math.max(0, Math.floor(top / LH) - 40), b = Math.min(d.lines.length - 1, Math.ceil((top + h) / LH) + 40);
      if (!force && linesEl.dataset.a == a && linesEl.dataset.b == b && linesEl.dataset.c == d.cur) return;
      hlUpTo(b);
      var out = [];
      for (var i = a; i <= b; i++) out.push('<div class="fp-l' + (i === d.cur ? " cur" : "") + '" data-i="' + i + '"><span class="fp-no">' + (i + 1) + '</span><span class="fp-tx">' + (d.html[i] != null ? d.html[i] : esc(d.lines[i])) + "\n</span></div>");
      linesEl.dataset.a = a; linesEl.dataset.b = b; linesEl.dataset.c = d.cur;
      linesEl.style.transform = "translateY(" + a * LH + "px)";
      linesEl.innerHTML = out.join("");
      if (find.on) markFind();
    }
    function goLine(i, center) {
      if (!doc || doc.kind !== "text" || !codeEl) return;
      doc.cur = i;
      var h = codeEl.clientHeight || 400, y = i * LH;
      if (center) codeEl.scrollTop = Math.max(0, y - h / 2 + LH);
      else if (y < codeEl.scrollTop) codeEl.scrollTop = y;
      else if (y + LH > codeEl.scrollTop + h) codeEl.scrollTop = y + LH - h;
      paintLines(true);
    }

    // ======== ⌘F：在这个文件里找（不分大小写）；找到的标出来（CSS 高亮，不动语法高亮），↵ 下一个、⇧↵ 上一个、Esc 关 ========
    var find = { on: false, q: "", all: [], i: -1 };
    function openFind() {
      if (!doc || doc.kind !== "text") return;
      find.on = true; findEl.hidden = false;
      findIn.value = find.q || String(getSelection() || "").split("\n")[0].slice(0, 200) || findIn.value;
      findIn.focus(); findIn.select();
      runFind();
    }
    function closeFind() { find.on = false; findEl.hidden = true; if (window.CSS && CSS.highlights) { CSS.highlights.delete("fp-find"); CSS.highlights.delete("fp-find-on"); } }
    function runFind() {
      find.q = findIn.value; find.all = []; find.i = -1;
      var ql = find.q.toLowerCase();
      if (ql && doc && doc.kind === "text") {
        for (var i = 0; i < doc.lines.length && find.all.length < 10000; i++) { var s = doc.lines[i].toLowerCase(), k = s.indexOf(ql); while (k >= 0 && find.all.length < 10000) { find.all.push([i, k]); k = s.indexOf(ql, k + ql.length); } }
        var from = doc.cur >= 0 ? doc.cur : Math.floor((codeEl ? codeEl.scrollTop : 0) / LH);
        find.i = find.all.findIndex(function (m) { return m[0] >= from; });
        if (find.i < 0 && find.all.length) find.i = 0;
      }
      stepFind(0);
    }
    function stepFind(d) {
      var n = find.all.length;
      if (n && d) find.i = (find.i + d + n) % n;
      findCount.textContent = find.q ? (n ? (find.i + 1) + "/" + n : "无结果") : "";
      findEl.classList.toggle("none", !!find.q && !n);
      if (n) goLine(find.all[find.i][0], true); else markFind();
    }
    // 看得见的那些行里：找到的字用 CSS 自定义高亮标出来（当前那个另一种颜色）
    function markFind() {
      if (!(window.CSS && CSS.highlights && window.Highlight) || !linesEl) return;
      var all = [], on = [], ql = find.q.toLowerCase(), cur = find.all[find.i];
      if (find.on && ql) linesEl.querySelectorAll(".fp-l").forEach(function (l) {
        var i = +l.dataset.i, tx = l.querySelector(".fp-tx"), s = doc.lines[i].toLowerCase(), k = s.indexOf(ql);
        if (k < 0) return;
        var nodes = [], w = document.createTreeWalker(tx, NodeFilter.SHOW_TEXT), t, pos = 0;
        while ((t = w.nextNode())) { nodes.push([t, pos]); pos += t.nodeValue.length; }
        var at = function (off) { for (var j = nodes.length - 1; j >= 0; j--) if (nodes[j][1] <= off) return [nodes[j][0], off - nodes[j][1]]; return null; };
        while (k >= 0) {
          var s0 = at(k), s1 = at(k + ql.length);
          if (s0 && s1) { var r = new Range(); try { r.setStart(s0[0], s0[1]); r.setEnd(s1[0], s1[1]); (cur && cur[0] === i && cur[1] === k ? on : all).push(r); } catch (e) { /* 跨不过去就算了 */ } }
          k = s.indexOf(ql, k + ql.length);
        }
      });
      CSS.highlights.set("fp-find", new Highlight(...all));
      CSS.highlights.set("fp-find-on", new Highlight(...on));
    }
    findIn.addEventListener("input", runFind);
    findIn.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFind(); if (codeEl) codeEl.focus(); }
    });

    // ======== 上面那一排的按钮、⋮ ========
    function menuItems() {
      var S = window.STUDIO, MI = S && S.menuIcons ? S.menuIcons() : {}, p = st.active, has = !!p;
      return [
        { label: "在编辑器标签页中打开", icon: MI.open, off: !has, run: function () { var tw = window.TSU_TERM && TSU_TERM.front ? TSU_TERM.front() : null; if (S && S.openFile && tw) S.openFile(tw, p, doc && doc.path === p && doc.cur >= 0 ? { line: doc.cur + 1 } : undefined); } },
        { label: "在访达中显示", icon: MI.reveal || MI.open, run: function () { if (LOC()) LOC().exec({ cmd: "open -R " + shq(p || root) }).catch(function () {}); } },
        { label: "拷贝路径", icon: MI.copy, run: function () { copy(p || root); } },
        { sep: true },
        { label: "显示隐藏文件", icon: MI.hidden || MI.eye, checked: !!st.hidden, run: function () { st.hidden = !st.hidden; save(); index = null; if (mode === "tree") { listEl.dataset.h = ""; paintTree(); } else runFilter(); } },
      ];
    }
    el.addEventListener("click", function (e) {
      var b = e.target.closest(".fp-top [data-a], .fp-find [data-a]");
      if (!b) return;
      var a = b.dataset.a;
      if (a === "tree") { st.tree = !st.tree; save(); paintTop(); if (st.tree) input.focus(); }
      else if (a === "search") { if (!st.tree) { st.tree = true; save(); paintTop(); } input.focus(); input.select(); }
      else if (a === "more") { var S = window.STUDIO; if (S && S.menu) S.menu(menuItems, { el: b, side: "below-end" }); }
      else if (a === "expand") { expanded = !expanded; paintTop(); if (opts.onExpand) opts.onExpand(expanded); }
      else if (a === "close") { if (opts.onClose) opts.onClose(); }
      else if (a === "fnext") stepFind(1);
      else if (a === "fprev") stepFind(-1);
      else if (a === "fclose") closeFind();
    });
    el.addEventListener("keydown", function (e) {
      if (e.metaKey && !e.shiftKey && !e.altKey && (e.key === "f" || e.key === "F") && doc && doc.kind === "text") { e.preventDefault(); e.stopPropagation(); openFind(); }
      else if (e.metaKey && !e.shiftKey && (e.key === "p" || e.key === "P")) { e.preventDefault(); e.stopPropagation(); q('[data-a="search"]').click(); }
    });

    // ======== 树和正文中间：拖动调宽度（记着），双击还原 ========
    var sash = q(".fp-sash");
    sash.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      sash.setPointerCapture(e.pointerId);
      var x0 = e.clientX, w0 = st.treeW, W = el.clientWidth || 800;
      el.classList.add("fp-drag");
      var mv = function (ev) { st.treeW = Math.round(Math.max(140, Math.min(W * 0.6, w0 + ev.clientX - x0))); paintTop(); };
      var up = function () { sash.removeEventListener("pointermove", mv); sash.removeEventListener("pointerup", up); sash.removeEventListener("pointercancel", up); el.classList.remove("fp-drag"); save(); };
      sash.addEventListener("pointermove", mv); sash.addEventListener("pointerup", up); sash.addEventListener("pointercancel", up);
    });
    sash.addEventListener("dblclick", function () { st.treeW = 240; paintTop(); save(); });
    var ro = window.ResizeObserver ? new ResizeObserver(function () { if (doc && doc.kind === "text") paintLines(false); }) : null;
    if (ro) ro.observe(bodyEl);

    // 开始：树（记着展开了哪些）、标签、上次看的那个文件
    loadOpen();
    paintTabs();
    show(st.active && st.tabs.indexOf(st.active) >= 0 ? st.active : "");
    if (st.active) revealInTree(st.active);

    return {
      el: el,
      open: function (p, line) { open(p, line); revealInTree(p); },
      setRoot: function (p) { p = String(p || "").replace(/\/+$/, "") || "/"; if (p === root) return; root = p; dirs = {}; index = null; input.value = ""; mode = "tree"; save(); listEl.dataset.h = ""; loadOpen(); },
      root: function () { return root; },
      setExpanded: function (on) { expanded = !!on; paintTop(); },
      refresh: function () { Object.keys(dirs).forEach(function (d) { dirs[d].items = null; }); index = null; loadOpen(); if (st.active) show(st.active); },
      destroy: function () { dead = true; seq++; free(); closeFind(); if (ro) ro.disconnect(); if (ctl) try { ctl.abort(); } catch (e) { /* 已经完了 */ } el.innerHTML = ""; el.classList.remove("fp", "fp-notree"); },
    };
  }
  window.TSU_FILEPANEL = { mount: mount };
})();
