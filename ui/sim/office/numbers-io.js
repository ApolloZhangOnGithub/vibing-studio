// office/numbers-io.js —— 表格的数据模型与文件格式：工作簿、工作表（稀疏的格子表、行高列宽、合并、冻结、过滤）、样式表；
// 读写 .xlsx（ExcelJS：值、公式与算好的结果、数字格式、字体、填充、边框、对齐、列宽行高、合并、冻结、自动过滤；
// 原文件里的条件格式、数据验证、图片、页面设置原样带回去）、.csv / .tsv、老格式（.xls / .ods / .numbers，SheetJS 只读）
(function () {
  "use strict";
  var O = window.TSU_OFFICE, FX = window.TSU_FX;
  var NB = O.nb = O.nb || {};
  var MAXC = 16384, MAXR = 1048576;
  var K = function (r, c) { return r * MAXC + c; }, KR = function (k) { return Math.floor(k / MAXC); }, KC = function (k) { return k % MAXC; };
  var DEF_W = 84, DEF_H = 22;

  // ======== 行 / 列的尺寸：默认大小 + 少数自定义的；隐藏的算 0。pos(i) = 第 i 个的起点，at(x) = x 落在哪一个 ========
  function Axis(def, size, hidden) {
    this.def = def;
    this.size = size || new Map();     // i → 像素（100% 时）
    this.hidden = hidden || new Set(); // 手动隐藏的
    this.fhidden = new Set();          // 过滤掉的（行）
    this._idx = null;
  }
  Axis.prototype.dirty = function () { this._idx = null; };
  Axis.prototype.isHidden = function (i) { return this.hidden.has(i) || this.fhidden.has(i); };
  Axis.prototype.sz = function (i) { if (this.isHidden(i)) return 0; var s = this.size.get(i); return s == null ? this.def : s; };
  Axis.prototype._build = function () {
    var keys = new Set();
    this.size.forEach(function (v, k) { keys.add(k); });
    this.hidden.forEach(function (k) { keys.add(k); });
    this.fhidden.forEach(function (k) { keys.add(k); });
    var idx = Array.from(keys).sort(function (a, b) { return a - b; }), pre = [0], self = this;
    idx.forEach(function (i, n) { pre.push(pre[n] + self.sz(i) - self.def); });
    this._idx = idx;
    this._pre = pre;
  };
  Axis.prototype.pos = function (i) {
    if (!this._idx) this._build();
    var a = this._idx, lo = 0, hi = a.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (a[m] < i) lo = m + 1; else hi = m; }
    return i * this.def + this._pre[lo];
  };
  Axis.prototype.at = function (x, max) {
    max = max || MAXR;
    if (x <= 0) { var i0 = 0; while (i0 < max - 1 && this.sz(i0) === 0) i0++; return i0; }
    var lo = 0, hi = max - 1;
    while (lo < hi) { var m = (lo + hi + 1) >> 1; if (this.pos(m) <= x) lo = m; else hi = m - 1; }
    while (lo < max - 1 && this.sz(lo) === 0) lo++;
    return lo;
  };
  Axis.prototype.clone = function () { var a = new Axis(this.def, new Map(this.size), new Set(this.hidden)); a.fhidden = new Set(this.fhidden); return a; };

  // ======== 样式表：样式对象去重后按编号存，格子里只记编号 ========
  // 样式的键：nf 数字格式、font 字体、sz 字号（磅）、b i u st 粗 / 斜 / 下划线 / 删除线、color 文字颜色、fill 填充、
  // ha 水平对齐（left center right justify）、va 垂直（top middle bottom）、wrap 自动换行、ind 缩进、bt bb bl br 四边（{ s: 线型, c: 颜色 }）
  function Styles(list) {
    this.list = [];
    this.map = new Map();
    var self = this;
    (list && list.length ? list : [{}]).forEach(function (s) { self.id(s, true); });
  }
  function cleanStyle(s) {
    var out = {};
    Object.keys(s).sort().forEach(function (k) {
      var v = s[k];
      if (v == null || v === false || v === "" || v === 0 && k !== "ind") return;
      if (k === "nf" && /^general$/i.test(v)) return;
      if (k === "ind" && !v) return;
      if (/^b[tblr]$/.test(k)) { if (!v.s) return; v = { s: v.s, c: v.c || null }; }
      out[k] = v;
    });
    return out;
  }
  Styles.prototype.id = function (s, force) {
    var clean = cleanStyle(s || {}), key = JSON.stringify(clean), id = this.map.get(key);
    if (id == null || force && this.list.length === 0) { id = this.list.length; this.list.push(clean); this.map.set(key, id); }
    return id;
  };
  Styles.prototype.get = function (id) { return this.list[id || 0] || this.list[0]; };
  Styles.prototype.with = function (id, patch) { return this.id(Object.assign({}, this.get(id), patch)); };

  // ======== 工作簿 / 工作表 ========
  var uid = 0;
  function newSheet(name) {
    return {
      uid: ++uid, name: name, cells: new Map(), cols: new Axis(DEF_W), rows: new Axis(DEF_H),
      colStyle: new Map(), rowStyle: new Map(), // 整列 / 整行的样式（空格子也按它显示；新填的格子继承）
      freeze: { r: 0, c: 0 }, merges: [], filter: null, grid: true, tab: null, hidden: false,
      maxR: -1, maxC: -1, usedDirty: false,
      sel: { r: 0, c: 0, ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }] }, scroll: { x: 0, y: 0 }, extra: null,
    };
  }
  function newBook() { return { sheets: [newSheet("工作表 1")], active: 0, styles: new Styles(), props: {}, extra: {} }; }
  function used(sh) {
    if (sh.usedDirty) {
      var r = -1, c = -1;
      sh.cells.forEach(function (v, k) { var rr = KR(k), cc = KC(k); if (rr > r) r = rr; if (cc > c) c = cc; });
      sh.maxR = r;
      sh.maxC = c;
      sh.usedDirty = false;
    }
    return { r: sh.maxR, c: sh.maxC };
  }
  function touch(sh, r, c, removed) { if (removed) sh.usedDirty = true; else { if (r > sh.maxR) sh.maxR = r; if (c > sh.maxC) sh.maxC = c; } }
  function putCell(sh, r, c, cell) {
    var k = K(r, c);
    if (cell) { sh.cells.set(k, cell); touch(sh, r, c); } else if (sh.cells.has(k)) { sh.cells.delete(k); touch(sh, r, c, true); }
  }
  function sheetByName(book, name) {
    var low = String(name).toLowerCase();
    for (var i = 0; i < book.sheets.length; i++) if (book.sheets[i].name.toLowerCase() === low) return book.sheets[i];
    return null;
  }
  // 给公式引擎的工作簿接口
  function calcFor(book) {
    return new FX.Calc({
      sheetExists: function (n) { return !!sheetByName(book, n); },
      used: function (n) { var sh = sheetByName(book, n); if (!sh) return { r: -1, c: -1 }; var u = used(sh); return u; },
      raw: function (n, r, c) { var sh = sheetByName(book, n); return sh ? sh.cells.get(K(r, c)) : null; },
    });
  }

  // ======== 颜色：Excel 的 argb / 主题色（带 tint）/ 索引色 → #rrggbb ========
  var INDEXED = "000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 800000 008000 000080 808000 800080 008080 C0C0C0 808080 9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF 000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF 00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 003366 339966 003300 333300 993300 993366 333399 333333".split(" ");
  // 主题色按 Excel 的编号：0 lt1、1 dk1、2 lt2、3 dk2、4–9 accent1–6、10 超链接、11 访问过的超链接
  var DEF_THEME = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"];
  function parseTheme(xml) {
    if (!xml) return DEF_THEME.slice();
    var get = function (tag) {
      var m = new RegExp("<a:" + tag + ">([\\s\\S]*?)</a:" + tag + ">").exec(xml);
      if (!m) return null;
      var c = /srgbClr val="([0-9A-Fa-f]{6})"/.exec(m[1]) || /lastClr="([0-9A-Fa-f]{6})"/.exec(m[1]);
      return c ? c[1].toUpperCase() : null;
    };
    var order = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
    return order.map(function (t, i) { return get(t) || DEF_THEME[i]; });
  }
  function tint(hex, t) {
    if (!t) return hex;
    var r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, h = 0, s = 0, d = max - min;
    if (d) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    l = t < 0 ? l * (1 + t) : l * (1 - t) + t;
    var hue = function (p, q, x) { if (x < 0) x += 1; if (x > 1) x -= 1; if (x < 1 / 6) return p + (q - p) * 6 * x; if (x < 1 / 2) return q; if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6; return p; };
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    var to = function (x) { var v = Math.round(x * 255).toString(16); return v.length < 2 ? "0" + v : v; };
    return s === 0 ? to(l) + to(l) + to(l) : to(hue(p, q, h + 1 / 3)) + to(hue(p, q, h)) + to(hue(p, q, h - 1 / 3));
  }
  function xcolor(c, theme) {
    if (!c) return null;
    var hex = null;
    if (c.argb && /^[0-9A-Fa-f]{8}$/.test(c.argb)) hex = c.argb.slice(2);
    else if (c.argb && /^[0-9A-Fa-f]{6}$/.test(c.argb)) hex = c.argb;
    else if (c.theme != null) hex = (theme || DEF_THEME)[c.theme] || null;
    else if (c.indexed != null) hex = c.indexed === 64 ? null : INDEXED[c.indexed] || null;
    if (!hex) return null;
    if (c.tint) hex = tint(hex.toUpperCase(), c.tint);
    return "#" + hex.toLowerCase();
  }
  var argb = function (hex) { return "FF" + hex.replace("#", "").toUpperCase(); };

  // ======== ExcelJS 的样式 ↔ 我们的 ========
  var DEFAULT_FONTS = /^(Calibri|Calibri Light|等线|等线 Light|DengXian|Aptos|Aptos Narrow|宋体|SimSun|Microsoft YaHei UI)$/i;
  var BORDER_STYLES = { thin: 1, medium: 1, thick: 1, dashed: 1, dotted: 1, double: 1, hair: 1, mediumDashed: 1, dashDot: 1, mediumDashDot: 1, dashDotDot: 1, mediumDashDotDot: 1, slantDashDot: 1 };
  function fromXStyle(st, theme) {
    var s = {};
    if (!st) return s;
    if (st.numFmt && !/^general$/i.test(st.numFmt)) s.nf = st.numFmt;
    var f = st.font;
    if (f) {
      if (f.name && !DEFAULT_FONTS.test(f.name)) s.font = f.name;
      if (f.size && f.size !== 11) s.sz = f.size;
      if (f.bold) s.b = 1;
      if (f.italic) s.i = 1;
      if (f.underline && f.underline !== "none") s.u = 1;
      if (f.strike) s.st = 1;
      if (f.vertAlign === "superscript" || f.vertAlign === "subscript") s.va2 = f.vertAlign;
      var fc = xcolor(f.color, theme);
      if (fc && !(f.color && (f.color.theme === 1 || f.color.indexed === 64 || f.color.argb === "FF000000")) ) s.color = fc;
    }
    var fl = st.fill;
    if (fl) {
      if (fl.type === "pattern" && fl.pattern && fl.pattern !== "none") { var fg = xcolor(fl.fgColor, theme) || (fl.pattern !== "solid" ? xcolor(fl.bgColor, theme) : null); if (fg) s.fill = fg; }
      else if (fl.type === "gradient" && fl.stops && fl.stops.length) { var g = xcolor(fl.stops[0].color, theme); if (g) s.fill = g; }
    }
    var a = st.alignment;
    if (a) {
      var h = a.horizontal;
      if (h === "left" || h === "right" || h === "center" || h === "justify") s.ha = h;
      else if (h === "centerContinuous" || h === "distributed") s.ha = "center";
      if (a.vertical === "top" || a.vertical === "middle" || a.vertical === "bottom") s.va = a.vertical === "bottom" ? null : a.vertical;
      else if (a.vertical === "center" || a.vertical === "distributed" || a.vertical === "justify") s.va = "middle";
      if (a.wrapText) s.wrap = 1;
      if (a.indent) s.ind = a.indent;
    }
    var b = st.border;
    if (b) {
      [["top", "bt"], ["bottom", "bb"], ["left", "bl"], ["right", "br"]].forEach(function (x) {
        var e = b[x[0]];
        if (e && e.style && BORDER_STYLES[e.style]) s[x[1]] = { s: e.style, c: xcolor(e.color, theme) || null };
      });
    }
    return s;
  }
  function toXStyle(s) {
    var o = {};
    if (s.nf) o.numFmt = s.nf;
    if (s.font || s.sz || s.b || s.i || s.u || s.st || s.color || s.va2) {
      o.font = { name: s.font || "Calibri", size: s.sz || 11 };
      if (s.b) o.font.bold = true;
      if (s.i) o.font.italic = true;
      if (s.u) o.font.underline = true;
      if (s.st) o.font.strike = true;
      if (s.va2) o.font.vertAlign = s.va2;
      if (s.color) o.font.color = { argb: argb(s.color) };
    }
    if (s.fill) o.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(s.fill) }, bgColor: { indexed: 64 } };
    if (s.ha || s.va || s.wrap || s.ind) {
      o.alignment = {};
      if (s.ha) o.alignment.horizontal = s.ha;
      if (s.va) o.alignment.vertical = s.va;
      if (s.wrap) o.alignment.wrapText = true;
      if (s.ind) o.alignment.indent = s.ind;
    }
    if (s.bt || s.bb || s.bl || s.br) {
      o.border = {};
      [["bt", "top"], ["bb", "bottom"], ["bl", "left"], ["br", "right"]].forEach(function (x) {
        var e = s[x[0]];
        if (e) o.border[x[1]] = { style: e.s, color: { argb: e.c ? argb(e.c) : "FF000000" } };
      });
    }
    return o;
  }

  // ======== .xlsx 读 ========
  var W2PX = function (w) { return Math.round(w * 7 + 5); };          // Excel 的列宽（字符数）→ 像素
  var PX2W = function (px) { return Math.max(0, Math.round((px - 5) / 7 * 100) / 100); };
  var H2PX = function (pt) { return Math.round(pt * 4 / 3); };        // 行高（磅）→ 像素
  var PX2H = function (px) { return Math.round(px * 0.75 * 100) / 100; };
  function toU8Buffer(u8) { return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength); }
  // 文件里有表格 App 显示不了、也存不回去的部件（图表、数据透视表）：打开照常，但不往原文件上存（存了就把它们丢了）
  function unsupportedParts(u8) {
    var names = new TextDecoder("latin1").decode(u8), out = [];
    if (names.indexOf("xl/charts/") >= 0) out.push("图表");
    if (names.indexOf("xl/pivotTables/") >= 0) out.push("数据透视表");
    return out;
  }
  function readXlsx(u8, noFallback) {
    var unsupported = unsupportedParts(u8);
    var mark = function (book) { if (book && unsupported.length) book.unsupported = unsupported; return book; };
    return O.lib("exceljs").then(function (ExcelJS) {
      var wb = new ExcelJS.Workbook();
      return wb.xlsx.load(toU8Buffer(u8)).then(function () { return mark(fromExcelJS(wb, ExcelJS)); });
    }).catch(function (e) {
      // ExcelJS 读不了的（别的软件写的文件里有它不认的部件）：退回 SheetJS——值、公式、数字格式、合并、列宽照样有，样式少一些
      if (noFallback) throw e;
      console.warn("ExcelJS 读不了，改用 SheetJS：", e);
      return readLegacy(u8, "xlsx");
    });
  }
  function fromExcelJS(wb, ExcelJS) {
    var VT = ExcelJS.ValueType, book = newBook(), theme = parseTheme(wb._themes && wb._themes.theme1), styleCache = new Map();
    book.sheets = [];
    book.props = { creator: wb.creator, lastModifiedBy: wb.lastModifiedBy, created: wb.created, title: wb.title, company: wb.company };
    var sid = function (st) {
      if (!st || !Object.keys(st).length) return 0;
      var key = JSON.stringify(st), id = styleCache.get(key);
      if (id == null) { id = book.styles.id(fromXStyle(st, theme)); styleCache.set(key, id); }
      return id;
    };
    var date1904 = wb.properties && wb.properties.date1904;
    var toSerial = function (d) { var s = FX.dateOfJS(d); return date1904 ? s - 1462 : s; };
    var result = function (r) {
      if (r == null) return null;
      if (r instanceof Date) return toSerial(r);
      if (typeof r === "object") { if (r.error) return FX.ERR[r.error] || new FX.FxError(r.error); if (r.richText) return r.richText.map(function (t) { return t.text; }).join(""); if (r.text != null) return String(r.text); return null; }
      return r;
    };
    wb.eachSheet(function (ws) {
      var sh = newSheet(ws.name);
      sh.hidden = ws.state === "hidden" || ws.state === "veryHidden";
      var props = ws.properties || {};
      if (props.tabColor) sh.tab = xcolor(props.tabColor, theme);
      if (props.defaultRowHeight && Math.abs(props.defaultRowHeight - 15) > 0.01) sh.rows.def = H2PX(props.defaultRowHeight);
      else sh.rows.def = DEF_H;
      if (props.defaultColWidth) sh.cols.def = W2PX(props.defaultColWidth);
      // 列：宽度、隐藏、整列的样式
      (ws.columns || []).forEach(function (col, i) {
        if (!col) return;
        if (col.width != null && col.isCustomWidth !== false && Math.abs(col.width - 9.140625) > 0.01 && Math.abs(col.width - 8.43) > 0.01) sh.cols.size.set(i, W2PX(col.width));
        if (col.hidden) sh.cols.hidden.add(i);
        if (col.style && Object.keys(col.style).length) { var cs = sid(col.style); if (cs) sh.colStyle.set(i, cs); }
      });
      (ws._rows || []).forEach(function (row, ri) {
        if (!row) return;
        var r = ri;
        if (row.height != null && row.customHeight !== false && Math.abs(row.height - 15) > 0.01) sh.rows.size.set(r, H2PX(row.height));
        if (row.hidden) sh.rows.hidden.add(r);
        if (row.style && Object.keys(row.style).length) { var rs = sid(row.style); if (rs) sh.rowStyle.set(r, rs); }
        row.eachCell({ includeEmpty: true }, function (cell, cn) {
          var c = cn - 1, t = cell.type, v = null, f = null, link = null;
          if (t === VT.Merge) return;
          if (t === VT.Number || t === VT.String || t === VT.SharedString || t === VT.Boolean) v = cell.value;
          else if (t === VT.Date) v = toSerial(cell.value);
          else if (t === VT.Hyperlink) { v = cell.value.text != null ? (typeof cell.value.text === "object" && cell.value.text.richText ? cell.value.text.richText.map(function (x) { return x.text; }).join("") : String(cell.value.text)) : ""; link = cell.value.hyperlink || null; }
          else if (t === VT.Formula) { f = cell.formula; v = result(cell.result); if (!f) { f = null; } }
          else if (t === VT.RichText) v = cell.value.richText.map(function (x) { return x.text; }).join("");
          else if (t === VT.Error) v = FX.ERR[cell.value.error] || new FX.FxError(cell.value.error);
          var s = sid(cell.style);
          if (v == null && f == null && !s) return;
          if (typeof v === "string" && v === "" && f == null && !s) return;
          var o = { v: v === undefined ? null : v };
          if (f) o.f = String(f).replace(/^=/, "");
          if (s) o.s = s;
          if (link) o.link = link;
          putCell(sh, r, c, o);
        });
      });
      // 合并
      Object.keys(ws._merges || {}).forEach(function (k) {
        var m = ws._merges[k];
        if (m && m.model) sh.merges.push({ r1: m.model.top - 1, c1: m.model.left - 1, r2: m.model.bottom - 1, c2: m.model.right - 1 });
      });
      // 冻结、网格线
      var v0 = (ws.views || [])[0];
      if (v0) {
        if (v0.state === "frozen") sh.freeze = { r: v0.ySplit || 0, c: v0.xSplit || 0 };
        if (v0.showGridLines === false) sh.grid = false;
        if (v0.zoomScale && v0.zoomScale !== 100) sh.zoom = v0.zoomScale / 100;
      }
      // 自动过滤（只记范围；条件存不进 ExcelJS，由 Excel 自己保留的隐藏行照原样隐藏）
      if (ws.autoFilter) {
        var af = ws.autoFilter, rg = null;
        if (typeof af === "string") rg = parseRange(af);
        else if (af.from && af.to) {
          var a1 = typeof af.from === "string" ? FX.parseAddr(af.from) : { r: af.from.row - 1, c: af.from.column - 1 };
          var a2 = typeof af.to === "string" ? FX.parseAddr(af.to) : { r: af.to.row - 1, c: af.to.column - 1 };
          if (a1 && a2) rg = { r1: a1.r, c1: a1.c, r2: a2.r, c2: a2.c };
        }
        if (rg) sh.filter = { r1: rg.r1, c1: rg.c1, r2: rg.r2, c2: rg.c2, cols: {} };
      }
      // 带回去的：条件格式、数据验证、图片、页面设置
      var extra = {};
      if (ws.conditionalFormattings && ws.conditionalFormattings.length) extra.cf = ws.conditionalFormattings;
      if (ws.dataValidations && ws.dataValidations.model && Object.keys(ws.dataValidations.model).length) extra.dv = ws.dataValidations.model;
      if (ws.pageSetup) extra.pageSetup = ws.pageSetup;
      if (ws.headerFooter) extra.headerFooter = ws.headerFooter;
      try {
        var imgs = ws.getImages();
        if (imgs.length) extra.images = imgs.map(function (im) {
          var media = wb.getImage(im.imageId), rg2 = im.range || {};
          var an = function (a) { return a ? { nativeCol: a.nativeCol, nativeColOff: a.nativeColOff, nativeRow: a.nativeRow, nativeRowOff: a.nativeRowOff } : undefined; };
          return media && media.buffer ? { buffer: media.buffer, extension: media.extension || "png", range: { tl: an(rg2.tl), br: an(rg2.br), ext: rg2.ext, editAs: rg2.editAs } } : null;
        }).filter(Boolean);
      } catch (e) { /* 读不了的图片就不带了 */ }
      sh.extra = extra;
      book.sheets.push(sh);
    });
    if (!book.sheets.length) book.sheets.push(newSheet("工作表 1"));
    var act = wb.views && wb.views[0] && wb.views[0].activeTab;
    book.active = Math.max(0, Math.min(book.sheets.length - 1, act || 0));
    if (book.sheets[book.active].hidden) book.active = Math.max(0, book.sheets.findIndex(function (s) { return !s.hidden; }));
    // 过滤：Excel 存的隐藏行已经在 rows.hidden 里了；把过滤区域里隐藏的行记成「过滤掉的」
    book.sheets.forEach(function (sh) {
      if (!sh.filter) return;
      sh.rows.hidden.forEach(function (r) { if (r > sh.filter.r1 && r <= sh.filter.r2) { sh.rows.hidden.delete(r); sh.rows.fhidden.add(r); } });
      sh.rows.dirty();
    });
    return book;
  }
  function parseRange(s) {
    var p = String(s).replace(/\$/g, "").split(":"), a = FX.parseAddr(p[0]), b = FX.parseAddr(p[1] || p[0]);
    return a && b ? { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) } : null;
  }

  // ======== .xlsx 写 ========
  // 新一些的函数在文件里要带 _xlfn. 前缀，Excel 才认
  var XLFN = {};
  "XLOOKUP XMATCH IFS SWITCH TEXTJOIN CONCAT MAXIFS MINIFS IFNA DAYS STDEV.S STDEV.P VAR.S VAR.P MODE.SNGL PERCENTILE.INC QUARTILE.INC RANK.EQ CEILING.MATH FLOOR.MATH UNICHAR UNICODE NUMBERVALUE XOR SEQUENCE FILTER SORT UNIQUE LET".split(" ").forEach(function (n) { XLFN[n] = 1; });
  function xlfn(f) {
    var out = "", i = 0, s = String(f);
    while (i < s.length) {
      if (s[i] === '"') { var j = i + 1; while (j < s.length) { if (s[j] === '"') { if (s[j + 1] === '"') { j += 2; continue; } break; } j++; } out += s.slice(i, j + 1); i = j + 1; continue; }
      var m = /^([A-Za-z_][A-Za-z0-9_.]*)(\s*\()/.exec(s.slice(i));
      if (m && !/[A-Za-z0-9_.]$/.test(out)) { var name = m[1].toUpperCase(); out += (XLFN[name] ? "_xlfn." + name : m[1]) + m[2]; i += m[0].length; continue; }
      out += s[i++];
    }
    return out;
  }
  function writeXlsx(book, calc) {
    return O.lib("exceljs").then(function (ExcelJS) {
      var wb = new ExcelJS.Workbook(), cache = new Map();
      wb.creator = book.props.creator || "表格";
      wb.lastModifiedBy = "表格";
      wb.created = book.props.created instanceof Date ? book.props.created : new Date();
      wb.modified = new Date();
      wb.calcProperties = { fullCalcOnLoad: true };
      var xs = function (id) { if (!id) return null; var x = cache.get(id); if (!x) { x = toXStyle(book.styles.get(id)); cache.set(id, x); } return x; };
      var vis = book.sheets.filter(function (s) { return !s.hidden; });
      wb.views = [{ x: 0, y: 0, width: 28800, height: 17600, firstSheet: 0, activeTab: Math.max(0, vis.indexOf(book.sheets[book.active])), visibility: "visible" }];
      book.sheets.forEach(function (sh) {
        var fr = sh.freeze || { r: 0, c: 0 }, view = { showGridLines: sh.grid !== false };
        if (fr.r || fr.c) Object.assign(view, { state: "frozen", xSplit: fr.c, ySplit: fr.r, topLeftCell: FX.addr(fr.r, fr.c) });
        if (sh.zoom && sh.zoom !== 1) view.zoomScale = Math.round(sh.zoom * 100);
        var ws = wb.addWorksheet(sh.name, { properties: Object.assign({ defaultRowHeight: PX2H(sh.rows.def) }, sh.tab ? { tabColor: { argb: argb(sh.tab) } } : {}), views: [view], state: sh.hidden ? "hidden" : "visible" });
        if (sh.cols.def !== DEF_W) ws.properties.defaultColWidth = PX2W(sh.cols.def);
        else ws.properties.defaultColWidth = PX2W(DEF_W);
        // 列
        var colIdx = new Set();
        sh.cols.size.forEach(function (v, c) { colIdx.add(c); });
        sh.cols.hidden.forEach(function (c) { colIdx.add(c); });
        sh.colStyle.forEach(function (v, c) { colIdx.add(c); });
        colIdx.forEach(function (c) {
          var col = ws.getColumn(c + 1);
          col.width = PX2W(sh.cols.size.has(c) ? sh.cols.size.get(c) : sh.cols.def);
          if (sh.cols.hidden.has(c)) col.hidden = true;
          var st = xs(sh.colStyle.get(c));
          if (st) col.style = st;
        });
        // 行的高度、隐藏、整行样式
        var rowIdx = new Set();
        sh.rows.size.forEach(function (v, r) { rowIdx.add(r); });
        sh.rows.hidden.forEach(function (r) { rowIdx.add(r); });
        sh.rows.fhidden.forEach(function (r) { rowIdx.add(r); });
        sh.rowStyle.forEach(function (v, r) { rowIdx.add(r); });
        // 格子（按行排好，ExcelJS 写得快一些）
        var keys = Array.from(sh.cells.keys()).sort(function (a, b) { return a - b; });
        keys.forEach(function (k) {
          var cell = sh.cells.get(k), r = KR(k), c = KC(k), xc = ws.getCell(r + 1, c + 1);
          if (cell.f != null) {
            var res = calc ? calc.get(sh.name, r, c) : cell.v;
            xc.value = { formula: xlfn(cell.f), result: xresult(res) };
          } else if (cell.link) xc.value = { text: cell.v == null ? "" : FX.str(cell.v), hyperlink: cell.link };
          else if (FX.isErr(cell.v)) xc.value = { error: cell.v.code };
          else if (cell.v != null) xc.value = cell.v;
          var st = xs(cell.s);
          if (st) xc.style = st;
        });
        rowIdx.forEach(function (r) {
          var row = ws.getRow(r + 1);
          if (sh.rows.size.has(r)) row.height = PX2H(sh.rows.size.get(r));
          if (sh.rows.hidden.has(r) || sh.rows.fhidden.has(r)) row.hidden = true;
          var st = xs(sh.rowStyle.get(r));
          if (st) row.style = st;
        });
        sh.merges.forEach(function (m) { try { ws.mergeCells(m.r1 + 1, m.c1 + 1, m.r2 + 1, m.c2 + 1); } catch (e) { /* 重叠的合并跳过 */ } });
        if (sh.filter) ws.autoFilter = { from: { row: sh.filter.r1 + 1, column: sh.filter.c1 + 1 }, to: { row: sh.filter.r2 + 1, column: sh.filter.c2 + 1 } };
        var ex = sh.extra || {};
        if (ex.cf) ws.conditionalFormattings = ex.cf;
        if (ex.dv) ws.dataValidations.model = ex.dv;
        if (ex.pageSetup) Object.assign(ws.pageSetup, ex.pageSetup);
        if (ex.headerFooter) ws.headerFooter = ex.headerFooter;
        (ex.images || []).forEach(function (im) {
          try { var id = wb.addImage({ buffer: im.buffer, extension: im.extension }); ws.addImage(id, im.range); } catch (e) { console.warn("图片没能写回：", e); }
        });
      });
      return wb.xlsx.writeBuffer().then(function (buf) { return new Uint8Array(buf); });
    });
  }
  function xresult(v) {
    if (v == null) return undefined;
    if (FX.isErr(v)) return { error: v.code };
    return v;
  }

  // ======== CSV / TSV ========
  function sniff(text) {
    var lines = text.split(/\r?\n/).slice(0, 20).filter(function (l) { return l.length; }), best = ",", bestScore = -1;
    [",", "\t", ";", "|"].forEach(function (d) {
      var counts = lines.map(function (l) { var n = 0, q = false; for (var i = 0; i < l.length; i++) { if (l[i] === '"') q = !q; else if (!q && l[i] === d) n++; } return n; });
      var min = Math.min.apply(null, counts.concat([Infinity])), score = counts.length && min > 0 ? min * 10 + (counts.every(function (x) { return x === counts[0]; }) ? 5 : 0) : 0;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }
  function parseCSV(text, delim) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    delim = delim || sniff(text);
    var rows = [], row = [], field = "", i = 0, n = text.length, q = false, quoted = false;
    while (i < n) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
        field += ch; i++; continue;
      }
      if (ch === '"' && field === "" && !quoted) { q = true; quoted = true; i++; continue; }
      if (ch === delim) { row.push(quoted ? { q: field } : field); field = ""; quoted = false; i++; continue; }
      if (ch === "\r" || ch === "\n") {
        row.push(quoted ? { q: field } : field); rows.push(row); row = []; field = ""; quoted = false;
        i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
        continue;
      }
      field += ch; i++;
    }
    if (field !== "" || quoted || row.length) { row.push(quoted ? { q: field } : field); rows.push(row); }
    return { rows: rows, delim: delim };
  }
  // CSV 里的一格 → 值：数字、百分比、日期照常识别；前导 0（编号、邮编）和超过 15 位的数字（身份证号）留作文字，免得丢位
  function csvValue(s, book) {
    if (typeof s === "object") s = s.q;
    if (s === "") return null;
    var t = s.trim();
    if (/^[-+]?0\d+$/.test(t) || /^\d{16,}$/.test(t)) return { v: s };
    var p = FX.parseInput(s);
    if (p.kind === "text" && s[0] === "'") return { v: s };
    var out = { v: p.v };
    if (p.nf) out.s = book.styles.id({ nf: p.nf });
    return out;
  }
  function readCsv(text, name, delim, bom) {
    var book = newBook(), sh = book.sheets[0], parsed = parseCSV(text, delim);
    sh.name = String(name || "工作表 1").slice(0, 31).replace(/[\[\]:*?\/\\]/g, "_") || "工作表 1";
    parsed.rows.forEach(function (row, r) {
      row.forEach(function (s, c) { var x = csvValue(s, book); if (x && (x.v != null)) putCell(sh, r, c, x); });
    });
    book.csv = { delim: parsed.delim, bom: bom != null ? bom : text.charCodeAt(0) === 0xfeff };
    // 第一行像表头（都是文字、下面有数字）→ 冻结首行、加粗
    return book;
  }
  function csvText(book, calc, sh, delim) {
    sh = sh || book.sheets[book.active];
    var u = used(sh), lines = [];
    for (var r = 0; r <= u.r; r++) {
      var cells = [];
      for (var c = 0; c <= u.c; c++) {
        var cell = sh.cells.get(K(r, c)), v = cell ? (cell.f != null && calc ? calc.get(sh.name, r, c) : cell.v) : null, s = "";
        if (v == null) s = "";
        else if (typeof v === "number") {
          var st = cell.s ? book.styles.get(cell.s) : null;
          if (st && st.nf && FX.isDateFormat(st.nf)) s = FX.format(v, st.nf).text;
          else s = Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(15)));
        } else s = FX.str(v);
        if (s.indexOf(delim) >= 0 || /["\r\n]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
        cells.push(s);
      }
      lines.push(cells.join(delim));
    }
    var bom = book.csv ? book.csv.bom : true;
    return (bom ? "﻿" : "") + lines.join("\n") + (lines.length ? "\n" : "");
  }

  // ======== 老格式（只读）：.xls / .ods / .numbers / .xlsm 里的宏不要——SheetJS 读值、公式、数字格式、合并、列宽 ========
  function readLegacy(u8, ext, name) {
    if (ext === "xlsm") return readXlsx(u8, true);
    return O.lib("sheetjs").then(function (XLSX) {
      var wb = XLSX.read(u8, { type: "array", cellFormula: true, cellNF: true, cellDates: false, cellStyles: true });
      var book = newBook();
      book.sheets = [];
      wb.SheetNames.forEach(function (n) {
        var ws = wb.Sheets[n], sh = newSheet(n);
        if (ws["!ref"]) {
          var rg = XLSX.utils.decode_range(ws["!ref"]);
          for (var r = rg.s.r; r <= rg.e.r; r++) for (var c = rg.s.c; c <= rg.e.c; c++) {
            var x = ws[XLSX.utils.encode_cell({ r: r, c: c })];
            if (!x) continue;
            var o = {};
            if (x.t === "n" || x.t === "s" || x.t === "b") o.v = x.v;
            else if (x.t === "e") o.v = FX.ERR[x.w] || FX.ERR["#VALUE!"];
            else if (x.t === "d") o.v = FX.dateOfJS(x.v);
            else if (x.t === "z") o.v = null;
            if (x.f) o.f = String(x.f).replace(/^=/, "");
            if (x.z && !/^general$/i.test(x.z)) o.s = book.styles.id({ nf: x.z });
            if (o.v == null && o.f == null && !o.s) continue;
            putCell(sh, r, c, o);
          }
        }
        (ws["!merges"] || []).forEach(function (m) { sh.merges.push({ r1: m.s.r, c1: m.s.c, r2: m.e.r, c2: m.e.c }); });
        (ws["!cols"] || []).forEach(function (col, i) { if (!col) return; if (col.wpx) sh.cols.size.set(i, Math.round(col.wpx)); else if (col.wch) sh.cols.size.set(i, W2PX(col.wch)); if (col.hidden) sh.cols.hidden.add(i); });
        (ws["!rows"] || []).forEach(function (row, i) { if (!row) return; if (row.hpx) sh.rows.size.set(i, Math.round(row.hpx)); else if (row.hpt) sh.rows.size.set(i, H2PX(row.hpt)); if (row.hidden) sh.rows.hidden.add(i); });
        book.sheets.push(sh);
      });
      if (!book.sheets.length) book.sheets.push(newSheet("工作表 1"));
      return book;
    });
  }

  // ======== 读入口 ========
  function read(u8, ext, path) {
    var name = path ? O.stemOf(path) : "工作表 1";
    if (ext === "xlsx") return readXlsx(u8);
    if (ext === "csv" || ext === "tsv" || ext === "txt") {
      var text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(u8); } catch (e) { try { text = new TextDecoder("gb18030").decode(u8); } catch (e2) { text = new TextDecoder().decode(u8); } }
      var bom = u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf;
      return Promise.resolve(readCsv(text, name, ext === "tsv" ? "\t" : null, bom));
    }
    return readLegacy(u8, ext, name);
  }

  // ======== 模板 ========
  function tplBook(build) {
    var book = newBook(), sh = book.sheets[0], S = book.styles;
    var set = function (a, v, st) {
      var p = FX.parseAddr(a), o = {};
      if (typeof v === "string" && v[0] === "=") { o.f = v.slice(1); o.v = null; } else o.v = v;
      if (st) o.s = S.id(st);
      putCell(sh, p.r, p.c, o);
    };
    build(book, sh, set, S);
    return book;
  }
  var HEAD = { b: 1, fill: "#e8eef9", bb: { s: "thin", c: "#9fb3d9" } };
  var TEMPLATES = [
    { id: "blank", name: "空白", build: function (book, sh) { sh.name = "工作表 1"; } },
    { id: "table", name: "基本表格", build: function (book, sh, set) {
      sh.name = "工作表 1";
      ["项目", "类别", "数量", "单价", "金额", "备注"].forEach(function (h, i) { set(FX.colName(i) + "1", h, HEAD); });
      for (var r = 2; r <= 11; r++) set("E" + r, "=IF(C" + r + "*D" + r + "=0,\"\",C" + r + "*D" + r + ")", { nf: "#,##0.00" });
      set("A12", "合计", { b: 1, bt: { s: "thin", c: "#9fb3d9" } });
      set("E12", "=SUM(E2:E11)", { b: 1, nf: "#,##0.00", bt: { s: "thin", c: "#9fb3d9" } });
      sh.freeze = { r: 1, c: 0 };
      sh.cols.size.set(0, 140); sh.cols.size.set(5, 180);
    } },
    { id: "budget", name: "个人预算", build: function (book, sh, set) {
      sh.name = "预算";
      set("A1", "个人月度预算", { b: 1, sz: 20, color: "#1f3a68" });
      set("A2", "=TEXT(TODAY(),\"yyyy年m月\")", { color: "#6e6e73" });
      var money = '"¥"#,##0.00';
      set("A4", "收入", Object.assign({}, HEAD)); set("B4", "预计", HEAD); set("C4", "实际", HEAD); set("D4", "差额", HEAD);
      [["工资", 15000, 15000], ["副业", 2000, 2600], ["其他", 500, 0]].forEach(function (x, i) {
        var r = 5 + i; set("A" + r, x[0]); set("B" + r, x[1], { nf: money }); set("C" + r, x[2], { nf: money }); set("D" + r, "=C" + r + "-B" + r, { nf: money + ';[Red]-"¥"#,##0.00' });
      });
      set("A8", "收入合计", { b: 1 }); set("B8", "=SUM(B5:B7)", { b: 1, nf: money }); set("C8", "=SUM(C5:C7)", { b: 1, nf: money }); set("D8", "=C8-B8", { b: 1, nf: money + ';[Red]-"¥"#,##0.00' });
      set("A10", "支出", HEAD); set("B10", "预计", HEAD); set("C10", "实际", HEAD); set("D10", "差额", HEAD);
      [["房租", 4500, 4500], ["餐饮", 2500, 2860], ["交通", 600, 420], ["水电网", 400, 386], ["购物", 1200, 1650], ["娱乐", 800, 560], ["储蓄", 3000, 3000]].forEach(function (x, i) {
        var r = 11 + i; set("A" + r, x[0]); set("B" + r, x[1], { nf: money }); set("C" + r, x[2], { nf: money }); set("D" + r, "=B" + r + "-C" + r, { nf: money + ';[Red]-"¥"#,##0.00' });
      });
      set("A18", "支出合计", { b: 1 }); set("B18", "=SUM(B11:B17)", { b: 1, nf: money }); set("C18", "=SUM(C11:C17)", { b: 1, nf: money }); set("D18", "=B18-C18", { b: 1, nf: money + ';[Red]-"¥"#,##0.00' });
      set("A20", "结余", { b: 1, sz: 14, color: "#1f3a68" }); set("C20", "=C8-C18", { b: 1, sz: 14, nf: money, color: "#1f7a3d" });
      set("A21", "储蓄率", { color: "#6e6e73" }); set("C21", "=IFERROR((C8-C18+C17)/C8,0)", { nf: "0.0%", color: "#6e6e73" });
      sh.cols.size.set(0, 120); sh.cols.size.set(1, 110); sh.cols.size.set(2, 110); sh.cols.size.set(3, 110);
      sh.rows.size.set(0, 36);
      sh.grid = false;
    } },
    { id: "todo", name: "清单", build: function (book, sh, set) {
      sh.name = "清单";
      set("A1", "待办清单", { b: 1, sz: 18 });
      ["完成", "事项", "优先级", "截止日期", "备注"].forEach(function (h, i) { set(FX.colName(i) + "3", h, HEAD); });
      var today = FX.todaySerial();
      [[false, "整理本周的会议记录", "高", 1], [false, "回复客户邮件", "中", 2], [true, "更新项目进度表", "中", 0], [false, "准备季度汇报", "高", 6]].forEach(function (x, i) {
        var r = 4 + i; set("A" + r, x[0], { ha: "center" }); set("B" + r, x[1]); set("C" + r, x[2], { ha: "center" }); set("D" + r, today + x[3], { nf: "yyyy-mm-dd" });
      });
      set("A10", '=COUNTIF(A4:A9,TRUE)&" / "&COUNTA(B4:B9)&" 项已完成"', { color: "#6e6e73" });
      sh.cols.size.set(0, 60); sh.cols.size.set(1, 220); sh.cols.size.set(3, 110); sh.cols.size.set(4, 200);
      sh.freeze = { r: 3, c: 0 };
    } },
    { id: "invoice", name: "发票", build: function (book, sh, set) {
      sh.name = "发票";
      set("A1", "发  票", { b: 1, sz: 24, color: "#1f3a68" });
      set("A3", "开票日期"); set("B3", FX.todaySerial(), { nf: 'yyyy"年"m"月"d"日"', ha: "left" });
      set("A4", "发票编号"); set("B4", "INV-0001");
      set("A5", "客户"); set("B5", "（客户名称）");
      ["品名", "数量", "单价", "金额"].forEach(function (h, i) { set(FX.colName(i) + "7", h, HEAD); });
      [["设计服务", 1, 8000], ["开发服务", 40, 350], ["差旅", 1, 1200]].forEach(function (x, i) {
        var r = 8 + i; set("A" + r, x[0]); set("B" + r, x[1]); set("C" + r, x[2], { nf: '"¥"#,##0.00' }); set("D" + r, "=B" + r + "*C" + r, { nf: '"¥"#,##0.00' });
      });
      set("C13", "小计", { ha: "right" }); set("D13", "=SUM(D8:D12)", { nf: '"¥"#,##0.00' });
      set("C14", "税（6%）", { ha: "right" }); set("D14", "=ROUND(D13*0.06,2)", { nf: '"¥"#,##0.00' });
      set("C15", "合计", { ha: "right", b: 1 }); set("D15", "=D13+D14", { nf: '"¥"#,##0.00', b: 1, bt: { s: "thin", c: "#1f3a68" } });
      sh.cols.size.set(0, 200); sh.cols.size.set(2, 110); sh.cols.size.set(3, 130);
      sh.grid = false;
    } },
  ];
  function templateBook(id) {
    var t = TEMPLATES.find(function (x) { return x.id === id; }) || TEMPLATES[0];
    return tplBook(t.build);
  }

  Object.assign(NB, {
    MAXR: MAXR, MAXC: MAXC, K: K, KR: KR, KC: KC, DEF_W: DEF_W, DEF_H: DEF_H,
    Axis: Axis, Styles: Styles, newSheet: newSheet, newBook: newBook, used: used, putCell: putCell, touch: touch, sheetByName: sheetByName, calcFor: calcFor,
    read: read, writeXlsx: writeXlsx, csvText: csvText, readCsv: readCsv, parseCSV: parseCSV, parseRange: parseRange,
    xcolor: xcolor, fromXStyle: fromXStyle, toXStyle: toXStyle, xlfn: xlfn,
    TEMPLATES: TEMPLATES, templateBook: templateBook,
  });
})();
