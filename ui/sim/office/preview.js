// office/preview.js —— Office 文稿的只读预览（同 macOS 的快速查看）：访达的快速查看（整份，能翻）、预览面板（第一页）、图标 / 画廊的缩略图。
// 第一次预览时才载入（和各 App 一样按需）；读文件用各 App 自己的读取代码：文稿 pages-io（按页排）、表格 numbers-io（工作表标签、网格、公式算好的值、格式）、
// 讲演 keynote-io + keynote.js 画幻灯片。iWork 的 .pages / .key（以及读不了表格内容时的 .numbers）用文件里自带的预览图（preview.jpg）。
// 大文件有上限：文稿最多排 40 页、表格 400 行 × 60 列（超过 2 MB 的表格只读前 400 行，不带样式）、讲演 120 张；缩略图只画第一页。
// TSU_OFFICE.preview：kind(路径) → "doc" | "sheet" | "deck" | "iwork" | null；view(路径, { width }) → Promise<元素（带 onKey）>；
// thumb(路径, 宽, 高) → Promise<HTML 字符串 | null>，cachedThumb(路径, 宽, 高) → 缓存里有就给（按路径 + 修改时间）
(function () {
  "use strict";
  var O = window.TSU_OFFICE, FS = window.SANDBOX;
  if (!O || O.preview) return;
  var BASE = O.BASE;
  var KIND = { docx: "doc", docm: "doc", xlsx: "sheet", xlsm: "sheet", xls: "sheet", ods: "sheet", numbers: "sheet", pptx: "deck", pptm: "deck", pages: "iwork", key: "iwork" };
  var LIMIT = { pages: 40, rows: 400, cols: 60, slides: 120, bigSheet: 2e6, maxBytes: 60e6, thumbBytes: 25e6 };
  var extOf = function (p) { var m = /\.([^./]+)$/.exec(p); return m ? m[1].toLowerCase() : ""; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function kind(p) { return KIND[extOf(p)] || null; }

  // ---- 按需载入：core.js（各 App 共用的底子）+ 这一类的读取代码 ----
  var NEED = { doc: ["core.js", "pages-io.js"], sheet: ["core.js", "fx.js", "numbers-io.js"], deck: ["core.js", "keynote-io.js", "keynote.js"], iwork: ["core.js"] };
  var ready = {};
  function need(k) {
    if (!ready[k]) ready[k] = NEED[k].reduce(function (ch, s) { return ch.then(function () { return O.loadScript(BASE + s); }); }, Promise.resolve());
    ready[k].catch(function () { delete ready[k]; });
    return ready[k];
  }
  // 文件的字节：真沙盒里还没取回来的大文件先取（O.readBytes 管 ensureLoaded）；太大的不预览
  function bytesOf(p, max) {
    var st = FS.stat(p) || {};
    if (st.size > max) return Promise.reject(new Error("文件太大（" + Math.round(st.size / 1e6) + " MB），不预览"));
    return need("iwork").then(function () { return O.readBytes(p); });
  }

  // ---- 读过的文稿：按路径 + 修改时间记着（快速查看、预览面板、缩略图共用一份），最多 8 份；换掉的释放图片 ----
  var docs = new Map();
  function stamp(p) { var st = FS.stat(p) || {}; return p + "|" + (st.mtime || 0) + "|" + (st.size || 0); }
  function load(p, opts) {
    var k = kind(p), key = stamp(p) + (k === "sheet" && opts && opts.light ? "|l" : ""); // 表格的缩略图（大文件只读前几十行）和整份分开记
    if (!k) return Promise.resolve(null);
    var hit = docs.get(key);
    if (hit) { docs.delete(key); docs.set(key, hit); return hit; }
    var job = need(k).then(function () { return bytesOf(p, opts && opts.light ? LIMIT.thumbBytes : LIMIT.maxBytes); }).then(function (u8) { return parse(k, p, u8, opts); });
    docs.set(key, job);
    job.catch(function () { docs.delete(key); });
    while (docs.size > 8) {
      var old = docs.keys().next().value, gone = docs.get(old);
      docs.delete(old);
      Promise.resolve(gone).then(function (d) { if (d && d.images && d.images.dispose) d.images.dispose(); dropThumbs(old.split("|")[0]); }, function () {});
    }
    return job;
  }
  function parse(k, p, u8, opts) {
    var ext = extOf(p);
    if (k === "doc") return O.pg.read(u8, "docx", p).then(function (r) { return { kind: "doc", r: r, images: r.images }; });
    if (k === "deck") return O.kn.read(u8, "pptx").then(function (deck) { return { kind: "deck", deck: deck, images: deck.images }; });
    if (k === "iwork") return iworkImage(u8).then(function (url) { return url ? { kind: "iwork", url: url, images: { dispose: function () { URL.revokeObjectURL(url); } } } : null; });
    // 表格：小的用 App 自己的读法（样式、合并、公式都在）；大的（或只要缩略图时）只读前面几百行
    var small = u8.length <= LIMIT.bigSheet && !(opts && opts.light && u8.length > 4e5);
    var viaApp = small ? O.nb.read(u8, ext, p).then(function (book) { return { kind: "sheet", grid: gridOfBook(book) }; }) : Promise.reject(new Error("big"));
    return viaApp.catch(function () {
      return O.lib("sheetjs").then(function (XLSX) { return { kind: "sheet", grid: gridOfSheetJS(XLSX, u8, opts && opts.light ? 60 : LIMIT.rows) }; });
    }).catch(function (e) {
      if (ext === "numbers") return iworkImage(u8).then(function (url) { if (!url) throw e; return { kind: "iwork", url: url, images: { dispose: function () { URL.revokeObjectURL(url); } } }; });
      throw e;
    });
  }
  // iWork 包（.pages / .key / .numbers 其实是 zip）里的预览图
  function iworkImage(u8) {
    return O.lib("jszip").then(function (JSZip) { return JSZip.loadAsync(u8); }).then(function (zip) {
      var f = ["preview.jpg", "preview-web.jpg", "QuickLook/Preview.jpg", "QuickLook/Thumbnail.jpg", "QuickLook/Thumbnail.png", "preview-micro.jpg"].map(function (n) { return zip.file(n); }).filter(Boolean)[0];
      if (!f) return null;
      return f.async("uint8array").then(function (b) { return URL.createObjectURL(new Blob([b], { type: /\.png$/.test(f.name) ? "image/png" : "image/jpeg" })); });
    }, function () { return null; });
  }

  // ======== 文稿：按页排（纸张大小、页边距、段落样式照文件；块不跨页，比一页还高的截掉）========
  function styleVars(flow, docStyles) {
    var st = O.pg.mergedStyles(docStyles || {});
    Object.keys(st).forEach(function (k) {
      var s = st[k], set = function (n, v) { if (v != null && v !== "") flow.style.setProperty("--" + k + "-" + n, v); };
      set("size", s.size + "pt");
      set("line", s.line);
      set("before", (s.before || 0) + "pt");
      set("after", (s.after || 0) + "pt");
      set("color", s.color || null);
      set("font", s.font ? '"' + s.font + '"' : null);
      set("weight", s.bold === false ? "400" : s.bold ? "700" : null);
      set("style", s.italic ? "italic" : null);
      set("align", s.align || null);
      set("indent", s.firstChars ? s.firstChars + "em" : null);
    });
  }
  function docPages(r, max) {
    var pg = r.page || O.pg.defaultPage(), cw = pg.w - pg.ml - pg.mr, ch = pg.h - pg.mt - pg.mb;
    var host = el("div", "ofc-pv-measure"), flow = el("div", "pg-flow");
    flow.style.width = cw + "px";
    styleVars(flow, r.styles);
    flow.innerHTML = r.html || "";
    host.appendChild(flow);
    document.body.appendChild(host);
    var imgs = Array.prototype.slice.call(flow.querySelectorAll("img"));
    var loaded = Promise.all(imgs.map(function (im) { return im.decode ? im.decode().catch(function () {}) : null; }));
    return Promise.race([loaded, new Promise(function (res) { setTimeout(res, 2500); })]).then(function () {
      var pages = [], cur = null, top = 0, more = 0;
      var start = function (y) { if (pages.length >= max) return false; cur = []; pages.push(cur); top = y; return true; };
      var blocks = Array.prototype.slice.call(flow.children);
      start(0);
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i], y0 = b.offsetTop, y1 = y0 + b.offsetHeight;
        if (b.localName === "hr" && b.classList.contains("pg-break")) { if (i < blocks.length - 1 && !start(blocks[i + 1].offsetTop)) { more = 1; break; } continue; }
        if (y1 - top > ch && cur.length) { if (!start(y0)) { more = 1; break; } }
        cur.push(b);
      }
      host.remove();
      var out = pages.map(function (list, n) {
        var page = el("div", "ofc-pv-page"), f = el("div", "pg-flow ofc-pv-flow");
        page.style.width = pg.w + "px";
        page.style.height = pg.h + "px";
        f.style.left = pg.ml + "px";
        f.style.top = pg.mt + "px";
        f.style.width = cw + "px";
        f.style.height = ch + "px";
        styleVars(f, r.styles);
        list.forEach(function (b) { f.appendChild(b); });
        page.appendChild(f);
        if (r.pageNumbers) page.appendChild(el("span", "ofc-pv-pnum", String(n + 1))).style.bottom = Math.round(pg.mb / 2 - 8) + "px";
        return page;
      });
      return { pages: out, w: pg.w, h: pg.h, more: more };
    });
  }
  function docView(d, width) {
    return docPages(d.r, LIMIT.pages).then(function (P) {
      var box = el("div", "ofc-pv ofc-pv-doc"), s = Math.min(1.25, Math.max(0.2, (width - 48) / P.w));
      P.pages.forEach(function (page) {
        var fr = el("div", "ofc-pv-frame");
        fr.style.width = Math.round(P.w * s) + "px";
        fr.style.height = Math.round(P.h * s) + "px";
        page.style.transform = "scale(" + s + ")";
        fr.appendChild(page);
        box.appendChild(fr);
      });
      if (P.more) box.appendChild(el("div", "ofc-pv-more", "只显示前 " + LIMIT.pages + " 页 · 在文稿里打开看全部"));
      box.onKey = pager(box, ".ofc-pv-frame");
      return box;
    });
  }

  // ======== 表格：网格（列宽行高、合并、字体、填充、边框、数字格式、公式算好的值）+ 底下的工作表标签 ========
  var BORDER = { thin: "1px solid", hair: "1px solid", medium: "2px solid", thick: "3px solid", dashed: "1px dashed", dotted: "1px dotted", double: "3px double", mediumDashed: "2px dashed", dashDot: "1px dashed", mediumDashDot: "2px dashed", dashDotDot: "1px dotted", mediumDashDotDot: "2px dotted", slantDashDot: "2px dashed" };
  function cssOfStyle(st) {
    var c = [];
    if (st.b) c.push("font-weight:600");
    if (st.i) c.push("font-style:italic");
    if (st.u || st.st) c.push("text-decoration:" + [st.u ? "underline" : "", st.st ? "line-through" : ""].join(" ").trim());
    if (st.sz) c.push("font-size:" + (st.sz * 4 / 3).toFixed(1) + "px");
    if (st.font) c.push('font-family:"' + String(st.font).replace(/["<>]/g, "") + '",-apple-system,"PingFang SC",sans-serif');
    if (st.color) c.push("color:" + st.color);
    if (st.fill) c.push("background:" + st.fill);
    if (st.wrap) c.push("white-space:pre-wrap;word-break:break-word");
    if (st.va) c.push("vertical-align:" + (st.va === "middle" ? "middle" : "top"));
    if (st.ind) c.push("padding-left:" + (3 + st.ind * 9) + "px");
    [["bt", "top"], ["bb", "bottom"], ["bl", "left"], ["br", "right"]].forEach(function (x) { var b = st[x[0]]; if (b && BORDER[b.s]) c.push("border-" + x[1] + ":" + BORDER[b.s] + " " + (b.c || "#000")); });
    return c.join(";");
  }
  // App 的工作簿 → 预览用的网格：{ sheets: [{ name, rows, cols, colW[], rowH[], grid, cells: Map(r * 1e5 + c → { text, css, align, rs, cs, cover }), cut }], active }
  function gridOfBook(book) {
    var NB = O.nb, FX = window.TSU_FX, calc = NB.calcFor(book), sheets = [];
    book.sheets.forEach(function (sh, si) {
      if (sh.hidden) return;
      var u = NB.used(sh), rows = Math.min(LIMIT.rows, u.r + 1), cols = Math.min(LIMIT.cols, u.c + 1), cells = new Map();
      sh.merges.forEach(function (m) { if (m.r1 < rows && m.c1 < cols) { var r2 = Math.min(m.r2, rows - 1), c2 = Math.min(m.c2, cols - 1); for (var r = m.r1; r <= r2; r++) for (var c = m.c1; c <= c2; c++) cells.set(r * 1e5 + c, r === m.r1 && c === m.c1 ? { rs: r2 - m.r1 + 1, cs: c2 - m.c1 + 1 } : { cover: 1 }); } });
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var cell = sh.cells.get(NB.K(r, c)), sid = cell && cell.s != null ? cell.s : sh.rowStyle.get(r) != null ? sh.rowStyle.get(r) : sh.colStyle.get(c);
        if (!cell && sid == null) continue;
        var st = book.styles.get(sid) || {}, v = cell ? (cell.f != null ? safeGet(calc, sh.name, r, c) : cell.v) : null, o = cells.get(r * 1e5 + c) || {};
        if (o.cover) continue;
        var shown = displayOf(FX, v, st);
        o.text = shown.text;
        o.align = st.ha || shown.align;
        o.css = cssOfStyle(st) + (shown.color ? ";color:" + shown.color : "");
        cells.set(r * 1e5 + c, o);
      }
      var colW = [], rowH = [];
      for (var c2 = 0; c2 < cols; c2++) colW.push(sh.cols.sz(c2));
      for (var r2 = 0; r2 < rows; r2++) rowH.push(sh.rows.sz(r2));
      sheets.push({ name: sh.name, rows: rows, cols: cols, colW: colW, rowH: rowH, grid: sh.grid !== false, cells: cells, cut: u.r + 1 > rows || u.c + 1 > cols, active: si === book.active });
    });
    if (!sheets.length) sheets.push({ name: "工作表 1", rows: 0, cols: 0, colW: [], rowH: [], grid: true, cells: new Map() });
    var act = sheets.findIndex(function (s) { return s.active; });
    return { sheets: sheets, active: act < 0 ? 0 : act };
  }
  function safeGet(calc, name, r, c) { try { return calc.get(name, r, c); } catch (e) { return null; } }
  function displayOf(FX, v, st) {
    if (v == null || v === "") return { text: "" };
    if (FX.isErr(v)) return { text: v.code, align: "center" };
    if (typeof v === "boolean") return { text: v ? "TRUE" : "FALSE", align: "center" };
    if (typeof v === "number") { var f = st.nf ? FX.format(v, st.nf) : { text: FX.formatGeneral(v) }; return { text: f.text, color: f.color, align: "right" }; }
    if (st.nf && st.nf !== "@" && st.nf.indexOf("@") >= 0) { var t = FX.format(v, st.nf); return { text: t.text, color: t.color, align: "left" }; }
    return { text: String(v), align: "left" };
  }
  // 大表格：SheetJS 只读前 n 行（值、数字格式、合并、列宽）
  function gridOfSheetJS(XLSX, u8, n) {
    var wb = XLSX.read(u8, { type: "array", sheetRows: n, cellNF: true, cellDates: false });
    var sheets = wb.SheetNames.map(function (name) {
      var ws = wb.Sheets[name], cells = new Map(), rows = 0, cols = 0;
      if (ws["!ref"]) {
        var rg = XLSX.utils.decode_range(ws["!ref"]);
        rows = Math.min(LIMIT.rows, rg.e.r + 1);
        cols = Math.min(LIMIT.cols, rg.e.c + 1);
        (ws["!merges"] || []).forEach(function (m) { if (m.s.r < rows && m.s.c < cols) for (var r = m.s.r; r <= Math.min(m.e.r, rows - 1); r++) for (var c = m.s.c; c <= Math.min(m.e.c, cols - 1); c++) cells.set(r * 1e5 + c, r === m.s.r && c === m.s.c ? { rs: Math.min(m.e.r, rows - 1) - m.s.r + 1, cs: Math.min(m.e.c, cols - 1) - m.s.c + 1 } : { cover: 1 }); });
        for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
          var x = ws[XLSX.utils.encode_cell({ r: r, c: c })], o = cells.get(r * 1e5 + c) || {};
          if (!x || o.cover) continue;
          o.text = x.w != null ? x.w : x.v != null ? String(x.v) : "";
          o.align = x.t === "n" ? "right" : x.t === "b" || x.t === "e" ? "center" : "left";
          cells.set(r * 1e5 + c, o);
        }
      }
      var colW = [], rowH = [];
      for (var c2 = 0; c2 < cols; c2++) { var col = (ws["!cols"] || [])[c2]; colW.push(col && col.hidden ? 0 : col && col.wpx ? Math.round(col.wpx) : col && col.wch ? Math.round(col.wch * 7 + 5) : 84); }
      for (var r2 = 0; r2 < rows; r2++) { var row = (ws["!rows"] || [])[r2]; rowH.push(row && row.hidden ? 0 : row && row.hpx ? Math.round(row.hpx) : 22); }
      return { name: name, rows: rows, cols: cols, colW: colW, rowH: rowH, grid: true, cells: cells, cut: true };
    });
    if (!sheets.length) sheets.push({ name: "工作表 1", rows: 0, cols: 0, colW: [], rowH: [], grid: true, cells: new Map() });
    return { sheets: sheets, active: 0 };
  }
  var colName = function (c) { var s = ""; c++; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
  // 一张表的 HTML：heads = 带行号、列号（快速查看）；maxR / maxC：缩略图只要左上角
  function tableHtml(sh, heads, maxR, maxC) {
    var rows = Math.min(sh.rows, maxR || sh.rows), cols = Math.min(sh.cols, maxC || sh.cols);
    rows = Math.max(rows, heads ? Math.min(30, maxR || 30) : 0);
    cols = Math.max(cols, heads ? Math.min(12, maxC || 12) : 0);
    var h = ['<table class="ofc-pv-grid' + (sh.grid ? "" : " ofc-pv-nogrid") + '"><colgroup>' + (heads ? '<col style="width:40px">' : "")];
    for (var c = 0; c < cols; c++) h.push('<col style="width:' + (c < sh.colW.length ? sh.colW[c] : 84) + 'px">');
    h.push("</colgroup>");
    if (heads) { h.push('<tr class="ofc-pv-ch"><th></th>'); for (var c1 = 0; c1 < cols; c1++) h.push("<th>" + colName(c1) + "</th>"); h.push("</tr>"); }
    for (var r = 0; r < rows; r++) {
      var rh = r < sh.rowH.length ? sh.rowH[r] : 22;
      if (!rh) continue;
      h.push('<tr style="height:' + rh + 'px">' + (heads ? "<th>" + (r + 1) + "</th>" : ""));
      for (var c2 = 0; c2 < cols; c2++) {
        var o = sh.cells.get(r * 1e5 + c2);
        if (o && o.cover) continue;
        if (c2 < sh.colW.length && !sh.colW[c2]) continue;
        var attrs = (o && o.rs > 1 ? ' rowspan="' + o.rs + '"' : "") + (o && o.cs > 1 ? ' colspan="' + Math.min(o.cs, cols - c2) + '"' : "");
        var css = (o && o.css ? o.css + ";" : "") + (o && o.align ? "text-align:" + (o.align === "justify" ? "left" : o.align) : "");
        h.push("<td" + attrs + (css ? ' style="' + esc(css) + '"' : "") + ">" + (o && o.text ? esc(o.text) : "") + "</td>");
      }
      h.push("</tr>");
    }
    h.push("</table>");
    return h.join("");
  }
  function sheetView(d) {
    var g = d.grid, box = el("div", "ofc-pv ofc-pv-sheet"), scroller = el("div", "ofc-pv-scroll"), tabs = el("div", "ofc-pv-tabs"), note = el("div", "ofc-pv-cut");
    box.appendChild(scroller);
    box.appendChild(note);
    box.appendChild(tabs);
    var show = function (i) {
      g.active = i;
      var sh = g.sheets[i];
      scroller.innerHTML = tableHtml(sh, true);
      scroller.scrollTop = scroller.scrollLeft = 0;
      note.textContent = sh.cut ? "只显示前 " + sh.rows + " 行 × " + sh.cols + " 列 · 在表格里打开看全部" : "";
      note.hidden = !sh.cut;
      Array.prototype.forEach.call(tabs.children, function (t, k) { t.classList.toggle("on", k === i); });
    };
    g.sheets.forEach(function (sh, i) {
      var t = el("button", "ofc-pv-tab");
      t.type = "button";
      t.tabIndex = -1;
      t.textContent = sh.name;
      t.addEventListener("click", function () { show(i); });
      tabs.appendChild(t);
    });
    tabs.hidden = g.sheets.length < 2;
    show(Math.min(g.active, g.sheets.length - 1));
    box.onKey = function (e) { // ⌥← / ⌥→（同 Numbers 的 ⌥⌘← →）切工作表；翻页键滚动
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && g.sheets.length > 1) { show((g.active + (e.key === "ArrowRight" ? 1 : g.sheets.length - 1)) % g.sheets.length); return true; }
      if (e.key === "PageDown" || e.key === "PageUp") { scroller.scrollTop += (e.key === "PageDown" ? 1 : -1) * (scroller.clientHeight - 40); return true; }
      return false;
    };
    return Promise.resolve(box);
  }

  // ======== 讲演：一张张幻灯片，竖着排、按张停（翻页键 / ← → 一次一张），右下角是第几张 ========
  function deckView(d, width) {
    var deck = d.deck, box = el("div", "ofc-pv ofc-pv-deck"), s = Math.max(0.1, (width - 48) / deck.w), list = deck.slides.slice(0, LIMIT.slides);
    list.forEach(function (sl, i) {
      var fr = el("div", "ofc-pv-frame ofc-pv-slide" + (sl.hidden ? " ofc-pv-skip" : ""));
      fr.style.width = Math.round(deck.w * s) + "px";
      fr.style.height = Math.round(deck.h * s) + "px";
      var r = O.kn.renderSlide(deck, sl, {});
      r.style.transform = "scale(" + s + ")";
      r.style.transformOrigin = "0 0";
      fr.appendChild(r);
      fr.appendChild(el("span", "ofc-pv-no", String(i + 1)));
      box.appendChild(fr);
    });
    if (deck.slides.length > list.length) box.appendChild(el("div", "ofc-pv-more", "只显示前 " + LIMIT.slides + " 张 · 在讲演里打开看全部"));
    box.onKey = pager(box, ".ofc-pv-slide", true);
    return Promise.resolve(box);
  }
  // 一页一页地翻：翻页键、空格（arrows = ← → 也算，讲演用）；找到现在最靠上的那一页，滚到下一页的顶上
  function pager(box, sel, arrows) {
    return function (e) {
      var next = e.key === "PageDown" || (e.key === " " && !e.shiftKey) || (arrows && e.key === "ArrowRight");
      var prev = e.key === "PageUp" || (e.key === " " && e.shiftKey) || (arrows && e.key === "ArrowLeft");
      if (!next && !prev) return false;
      var sc = box.closest(".fd-qlp-view") || box.parentElement, items = box.querySelectorAll(sel), top = sc.scrollTop, cur = 0;
      for (var i = 0; i < items.length; i++) if (items[i].offsetTop - 24 <= top + 2) cur = i;
      var to = items[Math.max(0, Math.min(items.length - 1, cur + (next ? 1 : -1)))];
      if (to) sc.scrollTo({ top: Math.max(0, to.offsetTop - 24), behavior: "smooth" });
      return true;
    };
  }
  function iworkView(d) {
    var box = el("div", "ofc-pv ofc-pv-iwork"), im = document.createElement("img");
    im.src = d.url;
    im.alt = "";
    im.draggable = false;
    box.appendChild(im);
    return Promise.resolve(box);
  }

  // ======== 快速查看：整份 ========
  function view(p, o) {
    o = o || {};
    return load(p).then(function (d) {
      if (!d) return null;
      var w = Math.max(240, o.width || 800);
      if (d.kind === "doc") return docView(d, w);
      if (d.kind === "sheet") return sheetView(d);
      if (d.kind === "deck") return deckView(d, w);
      if (d.kind === "iwork") return iworkView(d);
      return null;
    });
  }

  // ======== 缩略图：第一页 / 第一张表的左上角 / 第一张幻灯片，缩成 w × h 以内；HTML 字符串（按路径 + 修改时间 + 大小记着）========
  var thumbs = new Map(), waiting = new Map(), queue = [], busy = false;
  var tkey = function (p, w, h) { return stamp(p) + "|" + w + "x" + h; };
  function dropThumbs(p) { thumbs.forEach(function (v, k) { if (k.indexOf(p + "|") === 0) thumbs.delete(k); }); }
  function cachedThumb(p, w, h) { var v = thumbs.get(tkey(p, w, h)); return v === undefined ? undefined : v; }
  function thumb(p, w, h) {
    var k = tkey(p, w, h);
    if (thumbs.has(k)) return Promise.resolve(thumbs.get(k));
    if (waiting.has(k)) return waiting.get(k);
    var job = new Promise(function (res) { queue.push({ p: p, w: w, h: h, k: k, res: res }); pump(); });
    waiting.set(k, job);
    return job;
  }
  // 一个一个做（读文件、排版都在主线程上）：做完一个让出一帧，列表照样能滚
  function pump() {
    if (busy || !queue.length) return;
    busy = true;
    var t = queue.shift();
    makeThumb(t.p, t.w, t.h).then(function (html) { return html; }, function () { return null; }).then(function (html) {
      if (thumbs.size > 300) thumbs.clear();
      thumbs.set(t.k, html);
      waiting.delete(t.k);
      t.res(html);
      busy = false;
      if (window.requestIdleCallback) window.requestIdleCallback(pump, { timeout: 200 }); else setTimeout(pump, 16);
    });
  }
  function scaled(inner, iw, ih, w, h, cls) {
    var s = Math.min(w / iw, h / ih), bw = Math.max(1, Math.round(iw * s)), bh = Math.max(1, Math.round(ih * s));
    return '<span class="fd-page ofc-pv-thumb ' + cls + '" style="width:' + bw + "px;height:" + bh + 'px"><span class="ofc-pv-in" style="width:' + iw + "px;height:" + ih + "px;transform:scale(" + s.toFixed(5) + ')">' + inner + "</span></span>";
  }
  function makeThumb(p, w, h) {
    return load(p, { light: true }).then(function (d) {
      if (!d) return null;
      if (d.kind === "doc") return docPages(d.r, 1).then(function (P) { return P.pages[0] ? scaled(P.pages[0].outerHTML, P.w, P.h, w, h, "ofc-pv-tdoc") : null; });
      if (d.kind === "deck") {
        var deck = d.deck, sl = deck.slides[0];
        if (!sl) return null;
        var r = O.kn.renderSlide(deck, sl, {});
        return scaled(r.outerHTML, deck.w, deck.h, w, h, "ofc-pv-tdeck");
      }
      if (d.kind === "sheet") {
        var sh = d.grid.sheets[d.grid.active] || d.grid.sheets[0], cols = 0, rows = 0, tw = 0, th = 0;
        while (cols < sh.cols && tw < 640) tw += sh.colW[cols++] || 0;
        while (rows < sh.rows && th < 480) th += sh.rowH[rows++] || 0;
        tw = Math.max(tw, 320);
        th = Math.max(th, 240);
        return scaled('<span class="ofc-pv-tsheet-in">' + tableHtml(sh, false, rows || 20, cols || 8) + "</span>", tw, th, w, h, "ofc-pv-tsheet");
      }
      if (d.kind === "iwork") return '<img class="fd-img ofc-pv-timg" src="' + esc(d.url) + '" alt="" draggable="false" style="max-width:' + w + "px;max-height:" + h + 'px">';
      return null;
    });
  }

  O.preview = { kind: kind, view: view, thumb: thumb, cachedThumb: cachedThumb, LIMIT: LIMIT };
})();
