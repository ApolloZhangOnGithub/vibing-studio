// office/pages-io.js —— 文稿的文件格式：文稿在编辑器里就是一段规整的 HTML（段落样式、行内格式、列表、表格、图片、分页符），
// 这里负责它和 .docx（自己用 JSZip 读 OOXML；写用 docx 库）、.md、.txt、.html 之间的转换，还有粘贴 / 导入时的清洗（只留白名单里的标签和样式）
(function () {
  "use strict";
  var O = window.TSU_OFFICE;
  var PG = O.pg = O.pg || {};
  var esc = O.esc;

  // ======== 纸张、单位 ========
  var PX_PER_CM = 96 / 2.54, TW_PER_PX = 15, EMU_PER_PX = 9525;
  var SIZES = { A4: [794, 1123, "A4"], A5: [559, 794, "A5"], B5: [665, 944, "B5（JIS）"], Letter: [816, 1056, "US Letter"], Legal: [816, 1344, "US Legal"] };
  var LH = 1.25; // Word 的行距倍数 × 1.25 ≈ 浏览器的 line-height（Word 的「单倍」本身就比字号高一截）
  function defaultPage() { return { size: "A4", w: 794, h: 1123, orient: "portrait", mt: 96, mb: 96, ml: 96, mr: 96 }; }
  // 段落样式：id → 标签（+ 类名）、中文名、导出到 docx 的样式
  var PSTYLES = [
    { id: "title", name: "标题", tag: "H1", cls: "title", docx: "Title" },
    { id: "subtitle", name: "副标题", tag: "P", cls: "subtitle", docx: "Subtitle" },
    { id: "h1", name: "标题 1", tag: "H1", docx: "Heading1" },
    { id: "h2", name: "标题 2", tag: "H2", docx: "Heading2" },
    { id: "h3", name: "标题 3", tag: "H3", docx: "Heading3" },
    { id: "body", name: "正文", tag: "P", docx: "Normal" },
    { id: "quote", name: "引文", tag: "BLOCKQUOTE", docx: "Quote" },
    { id: "caption", name: "说明", tag: "P", cls: "caption", docx: "Caption" },
    { id: "code", name: "代码", tag: "PRE", docx: "Code" },
  ];
  function styleOfBlock(el) {
    var t = el.tagName, c = el.classList;
    if (t === "H1") return c.contains("title") ? "title" : "h1";
    if (t === "H2") return "h2";
    if (t === "H3" || t === "H4" || t === "H5" || t === "H6") return "h3";
    if (t === "BLOCKQUOTE") return "quote";
    if (t === "PRE") return "code";
    if (t === "P" && c.contains("subtitle")) return "subtitle";
    if (t === "P" && c.contains("caption")) return "caption";
    return "body";
  }
  // 文稿里各段落样式的外观（可以被导入的 docx 覆盖，存储时写回 docx 的样式表）
  var DEF_STYLES = {
    body: { size: 11, font: "", color: "", line: 1.5, before: 0, after: 6 },
    title: { size: 26, bold: true, color: "", line: 1.2, before: 0, after: 6 },
    subtitle: { size: 15, color: "#6e6e73", line: 1.3, before: 0, after: 12 },
    h1: { size: 18, bold: true, line: 1.3, before: 18, after: 6 },
    h2: { size: 14, bold: true, line: 1.3, before: 14, after: 4 },
    h3: { size: 12, bold: true, line: 1.3, before: 10, after: 4 },
    quote: { size: 11, italic: true, color: "#555555", line: 1.5, before: 6, after: 6 },
    caption: { size: 9, color: "#6e6e73", line: 1.3, before: 2, after: 8 },
    code: { size: 10, font: "Menlo", line: 1.35, before: 6, after: 6 },
  };
  function mergedStyles(over) {
    var out = {};
    Object.keys(DEF_STYLES).forEach(function (k) { out[k] = Object.assign({}, DEF_STYLES[k], over && over[k] || {}); });
    return out;
  }

  // ======== 图片：编辑器里用 blob: 地址，字节另外存着（撤销快照里不会一遍遍复制大图）========
  function Images() { this.map = new Map(); }
  Images.prototype.add = function (bytes, mime) {
    var url = URL.createObjectURL(new Blob([bytes], { type: mime || "image/png" }));
    this.map.set(url, { bytes: bytes, mime: mime || "image/png" });
    return url;
  };
  Images.prototype.get = function (url) { return this.map.get(url) || null; };
  Images.prototype.dispose = function () { this.map.forEach(function (v, k) { URL.revokeObjectURL(k); }); this.map.clear(); };
  // 任何 src（blob、data:、同源地址）→ { bytes, mime }
  Images.prototype.bytesOf = function (src) {
    var hit = this.map.get(src);
    if (hit) return Promise.resolve(hit);
    var m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(src || "");
    if (m) {
      var bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]), u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i) & 255;
      return Promise.resolve({ bytes: u8, mime: m[1] || "image/png" });
    }
    return fetch(src).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer().then(function (b) { return { bytes: new Uint8Array(b), mime: r.headers.get("content-type") || "image/png" }; }); });
  };
  function mimeOf(name) { var e = (name.match(/\.([a-z0-9]+)$/i) || [])[1]; e = e ? e.toLowerCase() : ""; return { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff", emf: "image/emf", wmf: "image/wmf" }[e] || "application/octet-stream"; }
  function b64(u8) { var s = "", CH = 0x8000; for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }

  // ======== 清洗：粘贴、导入的 HTML → 只含白名单的规整结构 ========
  var BLOCKS = { P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, UL: 1, OL: 1, LI: 1, TABLE: 1, BLOCKQUOTE: 1, PRE: 1, HR: 1, DIV: 1, SECTION: 1, ARTICLE: 1, HEADER: 1, FOOTER: 1, MAIN: 1, FIGURE: 1, FIGCAPTION: 1, ASIDE: 1, NAV: 1, DL: 1, DT: 1, DD: 1, ADDRESS: 1, CENTER: 1, TBODY: 1, THEAD: 1, TFOOT: 1, TR: 1, TD: 1, TH: 1, CAPTION: 1 };
  var INLINE_KEEP = { B: "B", STRONG: "B", I: "I", EM: "I", U: "U", INS: "U", S: "S", STRIKE: "S", DEL: "S", SUP: "SUP", SUB: "SUB", CODE: "CODE", A: "A", SPAN: "SPAN", FONT: "SPAN", MARK: "SPAN", SMALL: "SPAN", BIG: "SPAN", KBD: "CODE", TT: "CODE", VAR: "I", CITE: "I", Q: "SPAN", ABBR: "SPAN", LABEL: "SPAN", TIME: "SPAN" };
  var DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, CANVAS: 1, VIDEO: 1, AUDIO: 1, FORM: 1, INPUT: 1, BUTTON: 1, SELECT: 1, TEXTAREA: 1, META: 1, LINK: 1, TITLE: 1, HEAD: 1, BASE: 1, MATH: 1 };
  function cssColor(v) {
    if (!v) return null;
    v = String(v).trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(v)) return v;
    var m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
    if (m) return "#" + m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
    if (m) { if (m[4] != null && parseFloat(m[4]) === 0) return null; return "#" + [m[1], m[2], m[3]].map(function (x) { var h = Math.min(255, +x).toString(16); return h.length < 2 ? "0" + h : h; }).join(""); }
    var named = { black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", gray: "#808080", grey: "#808080", orange: "#ffa500", purple: "#800080", navy: "#000080", teal: "#008080", maroon: "#800000", silver: "#c0c0c0" };
    return named[v] || null;
  }
  // 字号 → 磅
  function cssPt(v) {
    if (!v) return null;
    var m = /^([\d.]+)(px|pt|em|rem|%)?$/.exec(String(v).trim());
    if (!m) { var k = { "xx-small": 7, "x-small": 7.5, small: 10, medium: 12, large: 13.5, "x-large": 18, "xx-large": 24 }[v]; return k || null; }
    var n = parseFloat(m[1]), u = m[2] || "px";
    if (u === "pt") return n;
    if (u === "px") return Math.round(n * 0.75 * 2) / 2;
    if (u === "em" || u === "rem") return Math.round(n * 11 * 2) / 2;
    if (u === "%") return Math.round(n / 100 * 11 * 2) / 2;
    return null;
  }
  // 行内样式里留下来的
  function keepInline(src, dst) {
    var st = src.style, out = [];
    if (!st) return;
    var col = cssColor(st.color), bg = cssColor(st.backgroundColor), fw = st.fontWeight, fs = st.fontStyle, td = st.textDecorationLine || st.textDecoration || "", ff = st.fontFamily, sz = cssPt(st.fontSize), va = st.verticalAlign;
    if (col && col !== "#000000") out.push("color:" + col);
    if (bg && bg !== "#ffffff") out.push("background-color:" + bg);
    if (fw === "bold" || +fw >= 600) out.push("font-weight:bold");
    if (fs === "italic") out.push("font-style:italic");
    if (/underline/.test(td) && /line-through/.test(td)) out.push("text-decoration:underline line-through");
    else if (/underline/.test(td)) out.push("text-decoration:underline");
    else if (/line-through/.test(td)) out.push("text-decoration:line-through");
    if (ff && !/^(inherit|initial|-apple-system|system-ui)$/i.test(ff.trim())) out.push("font-family:" + ff.split(",")[0].replace(/["']/g, "").trim());
    if (sz && sz !== 11 && sz >= 5 && sz <= 144) out.push("font-size:" + sz + "pt");
    if (va === "super" || va === "sub") out.push("vertical-align:" + va);
    if (out.length) dst.setAttribute("style", out.join(";"));
  }
  function keepBlock(src, dst) {
    var st = src.style, out = [];
    if (!st) return;
    var ta = st.textAlign || src.getAttribute && src.getAttribute("align");
    if (ta === "center" || ta === "right" || ta === "justify") out.push("text-align:" + ta);
    var ml = parseFloat(st.marginLeft), ti = parseFloat(st.textIndent), lh = st.lineHeight, mt = st.marginTop, mb = st.marginBottom;
    if (ml > 0 && /px|pt|em/.test(st.marginLeft)) out.push("margin-left:" + Math.round(pxOf(st.marginLeft)) + "px");
    if (ti && /px|pt|em/.test(st.textIndent)) out.push("text-indent:" + Math.round(pxOf(st.textIndent)) + "px");
    if (lh && /^[\d.]+$/.test(lh) && +lh >= 0.8 && +lh <= 4) out.push("line-height:" + lh);
    if (mt && /pt|px/.test(mt) && src.dataset && src.dataset.keepSpace) out.push("margin-top:" + mt);
    if (mb && /pt|px/.test(mb) && src.dataset && src.dataset.keepSpace) out.push("margin-bottom:" + mb);
    if (src.classList && src.classList.contains("pb-before")) dst.classList.add("pb-before");
    if (out.length) dst.setAttribute("style", out.join(";"));
  }
  function pxOf(v) { var m = /^(-?[\d.]+)(px|pt|em|rem)?$/.exec(String(v).trim()); if (!m) return 0; var n = parseFloat(m[1]); return m[2] === "pt" ? n * 4 / 3 : m[2] === "em" || m[2] === "rem" ? n * 14.67 : n; }
  function safeHref(h) { h = String(h || "").trim(); return /^(https?:|mailto:|#)/i.test(h) ? h : null; }
  function safeSrc(s) { s = String(s || "").trim(); return /^(blob:|data:image\/(png|jpe?g|gif|webp|bmp);|https?:)/i.test(s) ? s : null; }
  // 清洗入口：返回 DocumentFragment（顶层只有块）
  function sanitize(html, doc) {
    doc = doc || document;
    var src = typeof html === "string" ? new DOMParser().parseFromString(html, "text/html").body : html;
    var frag = doc.createDocumentFragment(), cur = null;
    var flush = function () { cur = null; };
    var inlineParent = function () { if (!cur) { cur = doc.createElement("p"); frag.appendChild(cur); } return cur; };
    function inl(node, into) {
      // node 的内容以行内的形式放进 into
      Array.prototype.forEach.call(node.childNodes, function (ch) { inlineNode(ch, into); });
    }
    function inlineNode(ch, into) {
      if (ch.nodeType === 3) { var t = ch.nodeValue.replace(/[\r\n\t ]+/g, " "); if (t) into.appendChild(doc.createTextNode(t)); return; }
      if (ch.nodeType !== 1) return;
      var tag = ch.tagName;
      if (DROP[tag]) return;
      if (tag === "BR") { into.appendChild(doc.createElement("br")); return; }
      if (tag === "IMG") { var s = safeSrc(ch.getAttribute("src")); if (!s) return; var im = doc.createElement("img"); im.src = s; var w = parseInt(ch.getAttribute("width") || ch.style.width, 10), h = parseInt(ch.getAttribute("height") || ch.style.height, 10); if (w) im.setAttribute("width", w); if (h) im.setAttribute("height", h); if (ch.alt) im.alt = ch.alt; into.appendChild(im); return; }
      var map = INLINE_KEEP[tag];
      if (!map) { inl(ch, into); return; } // 不认识的行内标签：只留内容
      var el = doc.createElement(map);
      if (map === "A") { var hr = safeHref(ch.getAttribute("href")); if (!hr) { inl(ch, into); return; } el.setAttribute("href", hr); }
      if (map === "SPAN" || map === "B" || map === "I" || map === "U" || map === "S") keepInline(ch, el);
      if (tag === "MARK" && !el.style.backgroundColor) el.style.backgroundColor = "#ffeb3b";
      if (tag === "FONT") { var fc = cssColor(ch.getAttribute("color")); if (fc) el.style.color = fc; var face = ch.getAttribute("face"); if (face) el.style.fontFamily = face.split(",")[0]; }
      inl(ch, el);
      if (map === "SPAN" && !el.getAttribute("style")) { while (el.firstChild) into.appendChild(el.firstChild); return; }
      if (el.childNodes.length) into.appendChild(el);
    }
    function block(node) {
      var tag = node.tagName;
      if (DROP[tag]) return;
      if (/^H[1-6]$/.test(tag)) {
        flush();
        var hn = doc.createElement(tag === "H1" ? "H1" : tag === "H2" ? "H2" : "H3");
        if (node.classList.contains("title")) hn.className = "title";
        keepBlock(node, hn); inl(node, hn); frag.appendChild(hn); return;
      }
      if (tag === "P" || tag === "DT" || tag === "DD" || tag === "FIGCAPTION" || tag === "ADDRESS" || tag === "CAPTION") {
        flush();
        if (hasBlockKids(node)) { walk(node); return; }
        var p = doc.createElement("p");
        if (node.classList.contains("subtitle")) p.className = "subtitle";
        if (node.classList.contains("caption") || tag === "FIGCAPTION" || tag === "CAPTION") p.className = "caption";
        keepBlock(node, p); inl(node, p); frag.appendChild(p); return;
      }
      if (tag === "BLOCKQUOTE") {
        flush();
        // 引文：里面每段一个 blockquote
        var parts = splitParas(node);
        parts.forEach(function (part) { var q = doc.createElement("blockquote"); keepBlock(node, q); part.forEach(function (x) { inlineNode(x, q); }); if (q.childNodes.length) frag.appendChild(q); });
        return;
      }
      if (tag === "PRE") { flush(); var pre = doc.createElement("pre"); pre.textContent = node.textContent.replace(/\n$/, ""); frag.appendChild(pre); return; }
      if (tag === "HR") { flush(); var hr = doc.createElement("hr"); if (node.classList.contains("pg-break")) hr.className = "pg-break"; frag.appendChild(hr); return; }
      if (tag === "UL" || tag === "OL") { flush(); frag.appendChild(list(node)); return; }
      if (tag === "TABLE") { flush(); var t = table(node); if (t) frag.appendChild(t); return; }
      if (tag === "LI") { flush(); var ul = doc.createElement("ul"); ul.appendChild(listItem(node)); frag.appendChild(ul); return; }
      if (tag === "DIV" && node.classList.contains("pg-break")) { flush(); var br2 = doc.createElement("hr"); br2.className = "pg-break"; frag.appendChild(br2); return; }
      // 容器（div、section……）：有块就往里走，全是行内的就当一段
      if (hasBlockKids(node)) { walk(node); return; }
      flush();
      var p2 = doc.createElement("p");
      keepBlock(node, p2);
      inl(node, p2);
      if (p2.childNodes.length) frag.appendChild(p2);
    }
    function splitParas(node) {
      var out = [[]];
      Array.prototype.forEach.call(node.childNodes, function (ch) {
        if (ch.nodeType === 1 && BLOCKS[ch.tagName]) { if (out[out.length - 1].length) out.push([]); Array.prototype.forEach.call(ch.childNodes, function (x) { out[out.length - 1].push(x); }); out.push([]); }
        else out[out.length - 1].push(ch);
      });
      return out.filter(function (x) { return x.some(function (n) { return n.nodeType === 1 || n.nodeValue.trim(); }); });
    }
    function hasBlockKids(node) { return Array.prototype.some.call(node.children || [], function (c) { return BLOCKS[c.tagName] || c.tagName === "IMG" && false; }); }
    function list(node) {
      var l = doc.createElement(node.tagName === "OL" ? "ol" : "ul");
      if (node.tagName === "OL" && node.getAttribute("start") && +node.getAttribute("start") > 1) l.setAttribute("start", +node.getAttribute("start"));
      Array.prototype.forEach.call(node.children, function (li) {
        if (li.tagName === "LI") l.appendChild(listItem(li));
        else if (li.tagName === "UL" || li.tagName === "OL") { var last = l.lastElementChild || l.appendChild(doc.createElement("li")); last.appendChild(list(li)); }
      });
      if (!l.children.length) l.appendChild(doc.createElement("li"));
      return l;
    }
    function listItem(li) {
      var out = doc.createElement("li");
      keepBlock(li, out);
      Array.prototype.forEach.call(li.childNodes, function (ch) {
        if (ch.nodeType === 1 && (ch.tagName === "UL" || ch.tagName === "OL")) out.appendChild(list(ch));
        else if (ch.nodeType === 1 && (ch.tagName === "P" || ch.tagName === "DIV")) { if (out.childNodes.length && out.lastChild.nodeName !== "BR" && out.lastChild.nodeName !== "UL" && out.lastChild.nodeName !== "OL") out.appendChild(doc.createElement("br")); inl(ch, out); }
        else inlineNode(ch, out);
      });
      if (out.lastChild && out.lastChild.nodeName === "BR") out.removeChild(out.lastChild);
      return out;
    }
    function table(node) {
      var t = doc.createElement("table"), tb = doc.createElement("tbody");
      t.appendChild(tb);
      var cols = node.querySelectorAll("col"), widths = [];
      cols.forEach(function (c) { var w = parseInt(c.getAttribute("width") || c.style.width, 10); widths.push(w || 0); });
      if (widths.some(Boolean)) { var cg = doc.createElement("colgroup"); widths.forEach(function (w) { var c = doc.createElement("col"); if (w) c.style.width = w + "px"; cg.appendChild(c); }); t.insertBefore(cg, tb); }
      node.querySelectorAll("tr").forEach(function (tr) {
        if (tr.closest("table") !== node) return;
        var row = doc.createElement("tr");
        Array.prototype.forEach.call(tr.children, function (td) {
          if (td.tagName !== "TD" && td.tagName !== "TH") return;
          var cell = doc.createElement("td");
          var cs = +(td.getAttribute("colspan") || 1), rs = +(td.getAttribute("rowspan") || 1);
          if (cs > 1) cell.setAttribute("colspan", cs);
          if (rs > 1) cell.setAttribute("rowspan", rs);
          var bg = cssColor(td.style && td.style.backgroundColor) || cssColor(td.getAttribute("bgcolor"));
          if (bg && bg !== "#ffffff") cell.style.backgroundColor = bg;
          var ta = td.style && td.style.textAlign; if (ta === "center" || ta === "right") cell.style.textAlign = ta;
          var inner = sanitize(td, doc);
          if (td.tagName === "TH") { var b = doc.createElement("b"); var p = inner.firstChild; if (p && p.nodeName === "P" && inner.childNodes.length === 1) { while (p.firstChild) b.appendChild(p.firstChild); p.appendChild(b); } }
          cell.appendChild(inner.childNodes.length ? inner : doc.createElement("p"));
          if (!cell.firstChild.firstChild && cell.firstChild.nodeName === "P") cell.firstChild.appendChild(doc.createElement("br"));
          row.appendChild(cell);
        });
        if (row.children.length) tb.appendChild(row);
      });
      return tb.children.length ? t : null;
    }
    function walk(node) {
      Array.prototype.forEach.call(node.childNodes, function (ch) {
        if (ch.nodeType === 3) { if (ch.nodeValue.trim()) inlineNode(ch, inlineParent()); else if (cur) inlineNode(ch, cur); return; }
        if (ch.nodeType !== 1) return;
        if (BLOCKS[ch.tagName]) block(ch);
        else if (ch.tagName === "IMG") inlineNode(ch, inlineParent());
        else inlineNode(ch, inlineParent());
      });
    }
    walk(src);
    // 空段落补上 <br>（不然点不进去）；首尾空白收一收
    Array.prototype.forEach.call(frag.childNodes, function (b) {
      if ((b.nodeName === "P" || /^H\d$/.test(b.nodeName) || b.nodeName === "BLOCKQUOTE") && !b.textContent.trim() && !b.querySelector("img, br")) b.appendChild(doc.createElement("br"));
      trimEdges(b);
    });
    return frag;
  }
  function trimEdges(b) {
    var f = b.firstChild, l = b.lastChild;
    if (f && f.nodeType === 3) f.nodeValue = f.nodeValue.replace(/^ +/, "");
    if (l && l.nodeType === 3) l.nodeValue = l.nodeValue.replace(/ +$/, "");
  }

  // ======== .docx 读（OOXML → 编辑器的 HTML）========
  function kids(el, name) { var out = []; if (!el) return out; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (!name || c.localName === name) out.push(c); return out; }
  function kid(el, name) { if (!el) return null; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c; return null; }
  function attr(el, name) {
    if (!el) return null;
    var v = el.getAttribute("w:" + name);
    if (v != null) return v;
    for (var i = 0; i < el.attributes.length; i++) if (el.attributes[i].localName === name) return el.attributes[i].value;
    return null;
  }
  function onOff(el) { if (!el) return false; var v = attr(el, "val"); return v == null || !/^(0|false|off|none)$/i.test(v); }
  function xml(s) { return s ? new DOMParser().parseFromString(s, "application/xml") : null; }
  function desc(el, name) { var out = []; (function rec(e) { for (var c = e.firstElementChild; c; c = c.nextElementSibling) { if (c.localName === name) out.push(c); rec(c); } })(el); return out; }
  var HL = { yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000", darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", darkGray: "#808080", lightGray: "#c0c0c0", black: "#000000" };
  // 一个 w:rPr → { b, i, u, s, color, bg, size(pt), font, va }
  function runProps(rPr, base) {
    var o = Object.assign({}, base || {});
    if (!rPr) return o;
    var x;
    if ((x = kid(rPr, "b"))) o.b = onOff(x);
    if ((x = kid(rPr, "i"))) o.i = onOff(x);
    if ((x = kid(rPr, "u"))) { var uv = attr(x, "val"); o.u = uv !== "none"; }
    if ((x = kid(rPr, "strike")) || (x = kid(rPr, "dstrike"))) o.s = onOff(x);
    if ((x = kid(rPr, "color"))) { var cv = attr(x, "val"); o.color = cv && cv !== "auto" && /^[0-9a-f]{6}$/i.test(cv) ? "#" + cv.toLowerCase() : null; }
    if ((x = kid(rPr, "sz"))) { var sv = parseFloat(attr(x, "val")); if (sv) o.size = sv / 2; }
    if ((x = kid(rPr, "highlight"))) { var hv = attr(x, "val"); o.bg = HL[hv] || null; }
    if ((x = kid(rPr, "shd"))) { var fill = attr(x, "fill"); if (fill && fill !== "auto" && /^[0-9a-f]{6}$/i.test(fill) && fill.toLowerCase() !== "ffffff") o.bg = "#" + fill.toLowerCase(); }
    if ((x = kid(rPr, "rFonts"))) { var f = attr(x, "eastAsia") || attr(x, "ascii") || attr(x, "hAnsi"); if (f) o.font = f; }
    if ((x = kid(rPr, "vertAlign"))) { var va = attr(x, "val"); o.va = va === "superscript" ? "super" : va === "subscript" ? "sub" : null; }
    if ((x = kid(rPr, "caps")) && onOff(x)) o.caps = true;
    if ((x = kid(rPr, "vanish")) && onOff(x)) o.hidden = true;
    return o;
  }
  function parseStyles(doc) {
    var out = { byId: {}, defRun: {}, defPara: {} };
    if (!doc) return out;
    var root = doc.documentElement, dd = kid(root, "docDefaults");
    if (dd) {
      var rpd = kid(kid(dd, "rPrDefault"), "rPr");
      out.defRun = runProps(rpd, {});
      var ppd = kid(kid(dd, "pPrDefault"), "pPr");
      if (ppd) out.defPara = paraProps(ppd);
    }
    kids(root, "style").forEach(function (s) {
      var id = attr(s, "styleId"), name = (attr(kid(s, "name"), "val") || "").toLowerCase(), type = attr(s, "type"), based = attr(kid(s, "basedOn"), "val");
      var pPr = kid(s, "pPr"), outline = pPr ? kid(pPr, "outlineLvl") : null;
      out.byId[id] = { id: id, name: name, type: type, basedOn: based, run: runProps(kid(s, "rPr"), {}), para: pPr ? paraProps(pPr) : {}, outline: outline ? +attr(outline, "val") : null, isDefault: attr(s, "default") === "1" || attr(s, "default") === "true" };
    });
    return out;
  }
  // 样式链（basedOn）合起来
  function resolveStyle(styles, id) {
    var chain = [], s = styles.byId[id], guard = 0;
    while (s && guard++ < 20) { chain.unshift(s); s = s.basedOn ? styles.byId[s.basedOn] : null; }
    var run = {}, para = {}, name = "", outline = null;
    chain.forEach(function (x) { Object.assign(run, x.run); Object.assign(para, x.para); if (x.outline != null) outline = x.outline; });
    if (chain.length) name = chain[chain.length - 1].name;
    // 哪种段落样式：名字（Word 里一律是英文名）或大纲级别
    var kind = "body", m;
    if (/^title$/.test(name)) kind = "title";
    else if (/^subtitle$/.test(name)) kind = "subtitle";
    else if ((m = /^heading (\d)$/.exec(name))) kind = +m[1] <= 1 ? "h1" : +m[1] === 2 ? "h2" : "h3";
    else if (/quote/.test(name)) kind = "quote";
    else if (/^caption$/.test(name)) kind = "caption";
    else if (/^(html preformatted|code|source code|plain text)$/.test(name)) kind = "code";
    else if (outline != null && outline <= 2) kind = outline === 0 ? "h1" : outline === 1 ? "h2" : "h3";
    return { kind: kind, run: run, para: para, name: name };
  }
  function paraProps(pPr) {
    var o = {}, x;
    if ((x = kid(pPr, "jc"))) { var j = attr(x, "val"); o.align = j === "center" ? "center" : j === "right" || j === "end" ? "right" : j === "both" || j === "distribute" ? "justify" : "left"; }
    if ((x = kid(pPr, "ind"))) {
      var l = attr(x, "left") || attr(x, "start"), fl = attr(x, "firstLine"), hg = attr(x, "hanging"), flc = attr(x, "firstLineChars");
      if (l != null) o.left = +l / TW_PER_PX;
      if (fl != null) o.first = +fl / TW_PER_PX;
      if (hg != null) o.first = -(+hg) / TW_PER_PX;
      if (flc != null && +flc > 0) o.firstChars = +flc / 100;
    }
    if ((x = kid(pPr, "spacing"))) {
      var b = attr(x, "before"), a = attr(x, "after"), ln = attr(x, "line"), rule = attr(x, "lineRule");
      if (b != null) o.before = +b / 20;
      if (a != null) o.after = +a / 20;
      if (ln != null) { if (!rule || rule === "auto") o.line = Math.round(+ln / 240 * 100) / 100; else o.lineExact = +ln / 20; }
    }
    if ((x = kid(pPr, "pageBreakBefore")) && onOff(x)) o.pb = true;
    if ((x = kid(pPr, "numPr"))) { var nid = attr(kid(x, "numId"), "val"); if (nid != null) { o.numId = nid; o.ilvl = +(attr(kid(x, "ilvl"), "val") || 0); } }
    return o;
  }
  function parseNumbering(doc) {
    var out = { abs: {}, num: {} };
    if (!doc) return out;
    var root = doc.documentElement;
    kids(root, "abstractNum").forEach(function (a) {
      var lv = {};
      kids(a, "lvl").forEach(function (l) { lv[+attr(l, "ilvl")] = { fmt: attr(kid(l, "numFmt"), "val") || "decimal", text: attr(kid(l, "lvlText"), "val") || "", start: +(attr(kid(l, "start"), "val") || 1) }; });
      out.abs[attr(a, "abstractNumId")] = lv;
    });
    kids(root, "num").forEach(function (n) { out.num[attr(n, "numId")] = attr(kid(n, "abstractNumId"), "val"); });
    return out;
  }
  function parseRels(doc) {
    var out = {};
    if (!doc) return out;
    kids(doc.documentElement, "Relationship").forEach(function (r) { out[r.getAttribute("Id")] = { target: r.getAttribute("Target"), type: r.getAttribute("Type") || "", external: r.getAttribute("TargetMode") === "External" }; });
    return out;
  }
  function readDocx(u8, images) {
    return O.lib("jszip").then(function (JSZip) { return JSZip.loadAsync(u8); }).then(function (zip) {
      var get = function (p) { var f = zip.file(p); return f ? f.async("string") : Promise.resolve(null); };
      return Promise.all([get("word/document.xml"), get("word/styles.xml"), get("word/numbering.xml"), get("word/_rels/document.xml.rels"), get("docProps/core.xml")]).then(function (xs) {
        if (!xs[0]) throw new Error("这不是有效的 .docx 文件（里面没有 word/document.xml）");
        var docXml = xml(xs[0]), styles = parseStyles(xml(xs[1])), numbering = parseNumbering(xml(xs[2])), rels = parseRels(xml(xs[3]));
        // 先把要用的图片都取出来
        var media = {}, need = [];
        Object.keys(rels).forEach(function (id) { var r = rels[id]; if (/\/image$/.test(r.type) && !r.external) need.push(id); });
        return Promise.all(need.map(function (id) {
          var t = rels[id].target.replace(/^\//, ""), p = /^word\//.test(t) ? t : "word/" + t.replace(/^\.\//, "");
          p = p.replace(/[^/]+\/\.\.\//g, "");
          var f = zip.file(p);
          if (!f) return null;
          return f.async("uint8array").then(function (bytes) { media[id] = { bytes: bytes, mime: mimeOf(p) }; });
        })).then(function () {
          // 页脚里有没有页码（PAGE 域）
          var footerIds = [], sect = desc(docXml.documentElement, "sectPr").pop();
          if (sect) kids(sect, "footerReference").forEach(function (f) { footerIds.push(attr(f, "id")); });
          return Promise.all(footerIds.map(function (id) { var r = rels[id]; return r ? get("word/" + r.target.replace(/^\//, "").replace(/^word\//, "")) : null; })).then(function (footers) {
            var pageNumbers = footers.some(function (f) { return f && /\bPAGE\b/.test(f); });
            var res = convertDocx(docXml, styles, numbering, rels, media, images);
            res.pageNumbers = pageNumbers;
            var core = xml(xs[4]);
            if (core) { var tt = core.getElementsByTagName("dc:title")[0], cr = core.getElementsByTagName("dc:creator")[0]; res.props = { title: tt ? tt.textContent : "", author: cr ? cr.textContent : "" }; }
            return res;
          });
        });
      });
    });
  }
  function convertDocx(docXml, styles, numbering, rels, media, images) {
    var d = document, body = kid(docXml.documentElement, "body"), root = d.createElement("div"), page = defaultPage();
    var docStyles = {};
    // 文稿默认字号、字体 → 正文样式
    var def = resolveStyle(styles, (Object.keys(styles.byId).map(function (k) { return styles.byId[k]; }).find(function (s) { return s.type === "paragraph" && s.isDefault; }) || {}).id || "Normal");
    var baseRun = Object.assign({}, styles.defRun, def.run), basePara = Object.assign({}, styles.defPara, def.para);
    docStyles.body = { size: baseRun.size || 10.5, font: baseRun.font || "", line: Math.round((basePara.line || 1) * LH * 100) / 100, before: basePara.before || 0, after: basePara.after != null ? basePara.after : 0 };
    if (basePara.firstChars) docStyles.body.firstChars = basePara.firstChars;
    ["Title", "Subtitle", "Heading1", "Heading2", "Heading3", "Quote", "Caption"].forEach(function (sid) {
      var st = styles.byId[sid] || Object.keys(styles.byId).map(function (k) { return styles.byId[k]; }).find(function (s) { return s.name === { Title: "title", Subtitle: "subtitle", Heading1: "heading 1", Heading2: "heading 2", Heading3: "heading 3", Quote: "quote", Caption: "caption" }[sid]; });
      if (!st) return;
      var rs = resolveStyle(styles, st.id), key = rs.kind;
      if (key === "body") return;
      var o = {};
      if (rs.run.size) o.size = rs.run.size;
      if (rs.run.b != null) o.bold = !!rs.run.b;
      if (rs.run.i != null) o.italic = !!rs.run.i;
      if (rs.run.color) o.color = rs.run.color;
      if (rs.run.font) o.font = rs.run.font;
      if (rs.para.before != null) o.before = rs.para.before;
      if (rs.para.after != null) o.after = rs.para.after;
      if (rs.para.line) o.line = Math.round(rs.para.line * LH * 100) / 100;
      if (rs.para.align) o.align = rs.para.align;
      docStyles[key] = o;
    });
    // 页面设置（最后一个 sectPr）
    var sp = kid(body, "sectPr");
    if (sp) {
      var sz = kid(sp, "pgSz"), mg = kid(sp, "pgMar");
      if (sz) { var w = +attr(sz, "w") / TW_PER_PX, h = +attr(sz, "h") / TW_PER_PX; if (w && h) { page.w = Math.round(w); page.h = Math.round(h); page.orient = attr(sz, "orient") === "landscape" || w > h ? "landscape" : "portrait"; page.size = matchSize(page.w, page.h); } }
      if (mg) ["top", "bottom", "left", "right"].forEach(function (k) { var v = attr(mg, k); if (v != null) page[{ top: "mt", bottom: "mb", left: "ml", right: "mr" }[k]] = Math.max(0, Math.round(Math.abs(+v) / TW_PER_PX)); });
    }
    var listStack = []; // [{ el, numId, ilvl }]
    var endList = function () { listStack = []; };
    function listFor(numId, ilvl) {
      var absId = numbering.num[numId], lv = absId != null && numbering.abs[absId] ? numbering.abs[absId][ilvl] || numbering.abs[absId][0] : null;
      var ordered = lv ? lv.fmt !== "bullet" && lv.fmt !== "none" : false;
      while (listStack.length && listStack[listStack.length - 1].ilvl > ilvl) listStack.pop();
      var top = listStack[listStack.length - 1];
      if (top && top.ilvl === ilvl && (top.numId !== numId || top.ordered !== ordered)) { listStack.pop(); top = listStack[listStack.length - 1]; }
      if (!top || top.ilvl < ilvl) {
        var l = d.createElement(ordered ? "ol" : "ul");
        if (ordered && lv && lv.fmt && lv.fmt !== "decimal") l.setAttribute("data-fmt", lv.fmt);
        if (!top) root.appendChild(l);
        else { var li = top.el.lastElementChild || top.el.appendChild(d.createElement("li")); li.appendChild(l); }
        listStack.push({ el: l, numId: numId, ilvl: ilvl, ordered: ordered });
        top = listStack[listStack.length - 1];
      }
      return top.el;
    }
    function paragraph(p, into, inCell) {
      var pPr = kid(p, "pPr"), sid = pPr ? attr(kid(pPr, "pStyle"), "val") : null, rs = resolveStyle(styles, sid || def.id || "Normal");
      var own = pPr ? paraProps(pPr) : {}, numPr = pPr ? kid(pPr, "numPr") : null;
      var numId = numPr ? attr(kid(numPr, "numId"), "val") : null, ilvl = numPr ? +(attr(kid(numPr, "ilvl"), "val") || 0) : 0;
      // 编号也可能来自段落样式（python-docx 的 List Bullet / List Number、Word 的「列表项目符号」样式）
      if (numId == null && rs.para.numId != null) { numId = rs.para.numId; ilvl = rs.para.ilvl || 0; if (numPr && kid(numPr, "ilvl")) ilvl = +attr(kid(numPr, "ilvl"), "val"); }
      var el, pieces = [];
      if (numId && numId !== "0" && !inCell) {
        var l = listFor(numId, ilvl);
        el = d.createElement("li");
        l.appendChild(el);
      } else {
        if (!inCell) endList();
        var ps = PSTYLES.find(function (x) { return x.id === rs.kind; });
        el = d.createElement(ps.tag.toLowerCase());
        if (ps.cls) el.className = ps.cls;
        (into || root).appendChild(el);
      }
      var css = [];
      if (own.align && own.align !== "left") css.push("text-align:" + own.align);
      else if (own.align === "left" && rs.para.align && rs.para.align !== "left") css.push("text-align:left");
      if (own.left && !numId) css.push("margin-left:" + Math.round(own.left) + "px");
      if (own.firstChars) css.push("text-indent:" + own.firstChars + "em");
      else if (own.first) css.push("text-indent:" + Math.round(own.first) + "px");
      if (own.line && Math.abs(own.line * LH - (docStyles.body.line || LH)) > 0.02) css.push("line-height:" + Math.round(own.line * LH * 100) / 100);
      if (own.before != null && rs.kind === "body" && Math.abs(own.before - (docStyles.body.before || 0)) > 0.5) css.push("margin-top:" + own.before + "pt");
      if (own.after != null && rs.kind === "body" && Math.abs(own.after - (docStyles.body.after || 0)) > 0.5) css.push("margin-bottom:" + own.after + "pt");
      if (css.length) el.setAttribute("style", css.join(";"));
      if (own.pb) el.classList.add("pb-before");
      runsInto(p, el, rs.run, pieces);
      if (!el.childNodes.length) el.appendChild(d.createElement("br"));
      // 段落里的分页符：在那里拆成两段，中间放分页标记；拆出来是空的就不要了（「只有一个分页符的段落」很常见）
      var curEl = el, empty = function (x) { return !x.textContent.replace(/\s/g, "") && !x.querySelector("img"); };
      pieces.forEach(function (mark) {
        if (curEl.tagName === "LI" || mark.parentNode !== curEl) { mark.remove(); return; }
        var nxt = curEl.cloneNode(false), move = [];
        for (var n = mark.nextSibling; n; n = n.nextSibling) move.push(n);
        move.forEach(function (n) { nxt.appendChild(n); });
        mark.remove();
        var parent = curEl.parentNode, hr = d.createElement("hr");
        hr.className = "pg-break";
        parent.insertBefore(hr, curEl.nextSibling);
        parent.insertBefore(nxt, hr.nextSibling);
        if (empty(curEl)) curEl.remove();
        curEl = nxt;
      });
      if (pieces.length && empty(curEl) && curEl.parentNode) curEl.remove();
      if (el.parentNode && !el.childNodes.length) el.appendChild(d.createElement("br"));
      return el;
    }
    // 段落里的 run、超链接、域……→ 行内节点；分页符记在 pieces 里
    function runsInto(p, el, styleRun, pieces) {
      var field = 0, inResult = false, fieldStack = [];
      function run(r, target, link) {
        var props = runProps(kid(r, "rPr"), {}), rStyle = kid(kid(r, "rPr"), "rStyle");
        if (rStyle) { var cs = styles.byId[attr(rStyle, "val")]; if (cs) props = Object.assign({}, cs.run, props); }
        if (props.hidden) return;
        kids(r).forEach(function (c) {
          var n = c.localName;
          if (n === "fldChar") {
            var t = attr(c, "fldCharType");
            if (t === "begin") { fieldStack.push({ result: false }); }
            else if (t === "separate") { if (fieldStack.length) fieldStack[fieldStack.length - 1].result = true; }
            else if (t === "end") fieldStack.pop();
            return;
          }
          if (fieldStack.length && !fieldStack[fieldStack.length - 1].result) return; // 域代码本身不显示
          if (n === "t" || n === "delText" && false) addText(target, c.textContent, props, styleRun);
          else if (n === "tab" || n === "ptab") addText(target, "\t", props, styleRun);
          else if (n === "br" || n === "cr") {
            if (attr(c, "type") === "page") { var mark = d.createElement("span"); mark.className = "__pb"; target.appendChild(mark); pieces.push(mark); }
            else target.appendChild(d.createElement("br"));
          }
          else if (n === "noBreakHyphen") addText(target, "‑", props, styleRun);
          else if (n === "sym") { var ch = attr(c, "char"); if (ch) addText(target, String.fromCharCode(parseInt(ch, 16) >= 0xf000 ? parseInt(ch, 16) - 0xf000 : parseInt(ch, 16)), props, styleRun); }
          else if (n === "drawing" || n === "pict" || n === "object") image(c, target);
          else if (n === "lastRenderedPageBreak") { /* Word 上次排版时的分页位置，不用 */ }
        });
      }
      function image(c, target) {
        var blip = desc(c, "blip")[0], idata = desc(c, "imagedata")[0], rid = blip ? (blip.getAttribute("r:embed") || attr(blip, "embed")) : idata ? (idata.getAttribute("r:id") || attr(idata, "id")) : null;
        if (!rid || !media[rid]) return;
        var m = media[rid];
        if (/emf|wmf|tiff/.test(m.mime)) return; // 浏览器显示不了的矢量图元文件
        var url = images.add(m.bytes, m.mime), im = d.createElement("img");
        im.src = url;
        var ext = desc(c, "extent")[0];
        if (ext) { var cx = +ext.getAttribute("cx"), cy = +ext.getAttribute("cy"); if (cx && cy) { im.setAttribute("width", Math.round(cx / EMU_PER_PX)); im.setAttribute("height", Math.round(cy / EMU_PER_PX)); } }
        else { var shape = c.querySelector ? desc(c, "shape")[0] : null, stl = shape && shape.getAttribute("style"); var mw = /width:\s*([\d.]+)pt/.exec(stl || ""), mh = /height:\s*([\d.]+)pt/.exec(stl || ""); if (mw && mh) { im.setAttribute("width", Math.round(+mw[1] * 4 / 3)); im.setAttribute("height", Math.round(+mh[1] * 4 / 3)); } }
        var docPr = desc(c, "docPr")[0];
        if (docPr && docPr.getAttribute("descr")) im.alt = docPr.getAttribute("descr");
        target.appendChild(im);
      }
      function walkInline(node, target) {
        kids(node).forEach(function (c) {
          var n = c.localName;
          if (n === "r") run(c, target);
          else if (n === "hyperlink") {
            var rid = c.getAttribute("r:id") || attr(c, "id"), rel = rid && rels[rid], href = rel ? rel.target : null;
            if (href && safeHref(href)) { var a = d.createElement("a"); a.href = href; walkInline(c, a); if (a.childNodes.length) target.appendChild(a); }
            else walkInline(c, target);
          }
          else if (n === "ins" || n === "smartTag" || n === "customXml" || n === "fldSimple" || n === "dir" || n === "bdo") walkInline(c, target);
          else if (n === "sdt") walkInline(kid(c, "sdtContent") || c, target);
          else if (n === "oMath" || n === "oMathPara") { var t = desc(c, "t").map(function (x) { return x.textContent; }).join(""); if (t) addText(target, t, {}, styleRun); }
        });
      }
      walkInline(p, el);
      // 相邻、格式一样的 span 合起来
      mergeSiblings(el);
    }
    function addText(target, text, props, styleRun) {
      if (!text) return;
      var node = d.createTextNode(props.caps ? text.toUpperCase() : text), wrap = node;
      var css = [];
      if (props.color && !/^#0{6}$/.test(props.color)) css.push("color:" + props.color);
      if (props.bg) css.push("background-color:" + props.bg);
      if (props.size && Math.abs(props.size - (styleRun.size || docStyles.body.size || 10.5)) > 0.01) css.push("font-size:" + props.size + "pt");
      if (props.font && props.font !== (styleRun.font || docStyles.body.font)) css.push("font-family:" + props.font);
      if (props.va) css.push("vertical-align:" + props.va);
      if (css.length) { var sp = d.createElement("span"); sp.setAttribute("style", css.join(";")); sp.appendChild(wrap); wrap = sp; }
      if (props.s) { var s = d.createElement("s"); s.appendChild(wrap); wrap = s; }
      if (props.u) { var u = d.createElement("u"); u.appendChild(wrap); wrap = u; }
      if (props.i && !styleRun.i) { var i = d.createElement("i"); i.appendChild(wrap); wrap = i; }
      if (props.b && !styleRun.b) { var b = d.createElement("b"); b.appendChild(wrap); wrap = b; }
      if (props.b === false && styleRun.b) { var nb = d.createElement("span"); nb.style.fontWeight = "normal"; nb.appendChild(wrap); wrap = nb; }
      target.appendChild(wrap);
    }
    function table(tbl, into) {
      endList();
      var t = d.createElement("table"), tb = d.createElement("tbody"), grid = kids(kid(tbl, "tblGrid"), "gridCol").map(function (g) { return Math.round(+attr(g, "w") / TW_PER_PX); });
      if (grid.length && grid.some(Boolean)) { var cg = d.createElement("colgroup"); grid.forEach(function (w) { var c = d.createElement("col"); if (w) c.style.width = w + "px"; cg.appendChild(c); }); t.appendChild(cg); }
      t.appendChild(tb);
      var tblPr = kid(tbl, "tblPr"), borders = tblPr && kid(tblPr, "tblBorders"), styleId = tblPr && attr(kid(tblPr, "tblStyle"), "val");
      var noBorder = borders && kids(borders).every(function (b) { var v = attr(b, "val"); return v === "none" || v === "nil"; }) && !/grid/i.test(styleId || "");
      if (noBorder) t.className = "plain";
      var vm = {}; // 网格列 → 正在往下合并的格子
      kids(tbl, "tr").forEach(function (tr) {
        var row = d.createElement("tr"), col = 0;
        kids(tr, "tc").forEach(function (tc) {
          var tcPr = kid(tc, "tcPr"), span = +(attr(kid(tcPr, "gridSpan"), "val") || 1), vmEl = kid(tcPr, "vMerge"), vmv = vmEl ? attr(vmEl, "val") || "continue" : null;
          if (vmv === "continue" && vm[col]) { vm[col].setAttribute("rowspan", (+(vm[col].getAttribute("rowspan") || 1)) + 1); col += span; return; }
          var cell = d.createElement("td");
          if (span > 1) cell.setAttribute("colspan", span);
          var shd = kid(tcPr, "shd"), fill = shd && attr(shd, "fill");
          if (fill && fill !== "auto" && /^[0-9a-f]{6}$/i.test(fill) && fill.toLowerCase() !== "ffffff") cell.style.backgroundColor = "#" + fill.toLowerCase();
          kids(tc).forEach(function (c) { if (c.localName === "p") paragraph(c, cell, true); else if (c.localName === "tbl") table(c, cell); });
          if (!cell.childNodes.length) { var p = d.createElement("p"); p.appendChild(d.createElement("br")); cell.appendChild(p); }
          if (vmv === "restart") vm[col] = cell; else if (!vmv) delete vm[col];
          row.appendChild(cell);
          col += span;
        });
        if (row.children.length) tb.appendChild(row);
      });
      (into || root).appendChild(t);
    }
    function bodyChild(c) {
      var n = c.localName;
      if (n === "p") paragraph(c);
      else if (n === "tbl") table(c);
      else if (n === "sdt") kids(kid(c, "sdtContent") || c).forEach(bodyChild);
      else if (n === "customXml") kids(c).forEach(bodyChild);
    }
    kids(body).forEach(bodyChild);
    // 段首的「段前分页」→ 分页标记
    root.querySelectorAll(".pb-before").forEach(function (el) { el.classList.remove("pb-before"); if (!el.className) el.removeAttribute("class"); if (el.previousSibling) { var hr = d.createElement("hr"); hr.className = "pg-break"; el.parentNode.insertBefore(hr, el); } });
    // 文稿末尾多余的空段落只留一个
    while (root.lastElementChild && root.lastElementChild.tagName === "P" && !root.lastElementChild.textContent.trim() && !root.lastElementChild.querySelector("img") && root.children.length > 1 && root.lastElementChild.previousElementSibling && root.lastElementChild.previousElementSibling.tagName === "P" && !root.lastElementChild.previousElementSibling.textContent.trim()) root.lastElementChild.remove();
    if (!root.children.length) { var p0 = d.createElement("p"); p0.appendChild(d.createElement("br")); root.appendChild(p0); }
    return { html: root.innerHTML, page: page, styles: docStyles };
  }
  function matchSize(w, h) {
    var a = Math.min(w, h), b = Math.max(w, h);
    for (var k in SIZES) if (Math.abs(SIZES[k][0] - a) <= 3 && Math.abs(SIZES[k][1] - b) <= 3) return k;
    return "custom";
  }
  // 相邻的、属性完全一样的行内元素合并（docx 里一个字一个 run 的情况很常见）
  function sameShell(a, b) {
    if (a.nodeType !== 1 || b.nodeType !== 1 || a.tagName !== b.tagName || /^(IMG|BR|HR)$/.test(a.tagName)) return false;
    if (a.attributes.length !== b.attributes.length) return false;
    for (var i = 0; i < a.attributes.length; i++) { var at = a.attributes[i]; if (b.getAttribute(at.name) !== at.value) return false; }
    return true;
  }
  function mergeSiblings(el) {
    var n = el.firstChild;
    while (n) {
      var next = n.nextSibling;
      if (next && n.nodeType === 3 && next.nodeType === 3) { n.nodeValue += next.nodeValue; next.remove(); continue; }
      if (next && sameShell(n, next)) { while (next.firstChild) n.appendChild(next.firstChild); next.remove(); continue; }
      if (n.nodeType === 1 && n.tagName !== "IMG") mergeSiblings(n);
      n = n.nextSibling;
    }
  }

  // ======== .docx 写（编辑器的 DOM → docx 库的对象）========
  var ALIGN = { left: "LEFT", center: "CENTER", right: "RIGHT", justify: "JUSTIFIED", start: "LEFT", end: "RIGHT" };
  function hex6(c) { var h = cssColor(c); return h ? h.slice(1).toUpperCase() : null; }
  function writeDocx(model) {
    // model：{ flow（编辑器的根元素）, page, styles, pageNumbers, props, images }
    return Promise.all([O.lib("docx"), O.lib("jszip")]).then(function (libs) {
      var docx = libs[0], JSZip = libs[1], S = mergedStyles(model.styles), olCount = 0, pending = [];
      var font = function (f) { return f ? { ascii: f, eastAsia: f, hAnsi: f, cs: f } : undefined; };
      var baseFont = S.body.font || null;
      // 图片先都变成 docx 能收的格式（png / jpg / gif / bmp；别的用画布转成 png）
      var imgs = Array.prototype.slice.call(model.flow.querySelectorAll("img")), imgData = new Map();
      return Promise.all(imgs.map(function (im) {
        return model.images.bytesOf(im.getAttribute("src")).then(function (b) {
          var type = /png/.test(b.mime) ? "png" : /jpe?g/.test(b.mime) ? "jpg" : /gif/.test(b.mime) ? "gif" : /bmp/.test(b.mime) ? "bmp" : null;
          if (type) return imgData.set(im.getAttribute("src"), { type: type, data: b.bytes });
          return toPng(im.getAttribute("src")).then(function (png) { imgData.set(im.getAttribute("src"), { type: "png", data: png }); });
        }).catch(function (e) { console.warn("图片没能导出：", e); });
      })).then(function () {
        function runsOf(node, fmt, out) {
          out = out || [];
          Array.prototype.forEach.call(node.childNodes, function (ch) {
            if (ch.nodeType === 3) { textRuns(ch.nodeValue, fmt, out); return; }
            if (ch.nodeType !== 1 || ch.classList.contains("pg-sp")) return;
            var t = ch.tagName, f = Object.assign({}, fmt);
            if (t === "BR") { if (!ch.nextSibling && /^(P|H[1-6]|LI|BLOCKQUOTE|DIV|TD)$/.test(node.tagName)) return; out.push(new docx.TextRun({ break: 1 })); return; } // 段尾的 <br> 只是占位
            if (t === "IMG") { var d = imgData.get(ch.getAttribute("src")); if (d) { var w = +ch.getAttribute("width") || ch.naturalWidth || 200, h = +ch.getAttribute("height") || ch.naturalHeight || 150; var maxW = model.page.w - model.page.ml - model.page.mr; if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; } out.push(new docx.ImageRun({ type: d.type, data: d.data, transformation: { width: Math.round(w), height: Math.round(h) } })); } return; }
            if (t === "B" || t === "STRONG") f.bold = true;
            if (t === "I" || t === "EM") f.italics = true;
            if (t === "U") f.underline = {};
            if (t === "S" || t === "STRIKE" || t === "DEL") f.strike = true;
            if (t === "SUP") f.superScript = true;
            if (t === "SUB") f.subScript = true;
            if (t === "CODE") f.font = font("Menlo");
            styleFmt(ch, f);
            if (t === "A") {
              var href = ch.getAttribute("href"), inner = runsOf(ch, Object.assign({}, f, { style: "Hyperlink" }), []);
              if (href && /^(https?:|mailto:)/i.test(href)) out.push(new docx.ExternalHyperlink({ link: href, children: inner }));
              else inner.forEach(function (x) { out.push(x); });
              return;
            }
            runsOf(ch, f, out);
          });
          return out;
        }
        function styleFmt(el, f) {
          var st = el.style;
          if (!st) return;
          var c = hex6(st.color); if (c) f.color = c;
          var bg = hex6(st.backgroundColor); if (bg) f.shading = { type: docx.ShadingType.CLEAR, color: "auto", fill: bg };
          if (st.fontWeight === "bold" || +st.fontWeight >= 600) f.bold = true;
          if (st.fontWeight === "normal" || st.fontWeight === "400") f.bold = false;
          if (st.fontStyle === "italic") f.italics = true;
          var td = st.textDecorationLine || st.textDecoration || "";
          if (/underline/.test(td)) f.underline = {};
          if (/line-through/.test(td)) f.strike = true;
          var pt = cssPt(st.fontSize); if (pt) f.size = Math.round(pt * 2);
          if (st.fontFamily) f.font = font(st.fontFamily.split(",")[0].replace(/["']/g, "").trim());
          if (st.verticalAlign === "super") f.superScript = true;
          if (st.verticalAlign === "sub") f.subScript = true;
        }
        function textRuns(text, fmt, out) {
          if (!text) return;
          text = text.replace(/​/g, "");
          var parts = text.split(/(\t|\n)/);
          parts.forEach(function (p) {
            if (p === "\t") out.push(new docx.TextRun(Object.assign({}, fmt, { children: [new docx.Tab()] })));
            else if (p === "\n") out.push(new docx.TextRun({ break: 1 }));
            else if (p) out.push(new docx.TextRun(Object.assign({}, fmt, { text: p })));
          });
        }
        function paraOpts(el) {
          var o = {}, st = el.style;
          var ta = st.textAlign; if (ta && ALIGN[ta]) o.alignment = docx.AlignmentType[ALIGN[ta]];
          var sp = {};
          if (st.lineHeight && /^[\d.]+$/.test(st.lineHeight)) { sp.line = Math.round(+st.lineHeight / LH * 240); sp.lineRule = docx.LineRuleType.AUTO; }
          if (st.marginTop) sp.before = Math.round(pxOf(st.marginTop) * TW_PER_PX);
          if (st.marginBottom) sp.after = Math.round(pxOf(st.marginBottom) * TW_PER_PX);
          if (Object.keys(sp).length) o.spacing = sp;
          var ind = {};
          if (st.marginLeft) ind.left = Math.round(pxOf(st.marginLeft) * TW_PER_PX);
          if (st.textIndent) { var ti = /em$/.test(st.textIndent) ? parseFloat(st.textIndent) * (S.body.size || 11) * 20 : pxOf(st.textIndent) * TW_PER_PX; if (ti > 0) ind.firstLine = Math.round(ti); else if (ti < 0) ind.hanging = Math.round(-ti); }
          if (Object.keys(ind).length) o.indent = ind;
          return o;
        }
        var out = [], pbNext = false;
        function para(el, extra) {
          var id = styleOfBlock(el), ps = PSTYLES.find(function (x) { return x.id === id; }), o = Object.assign(paraOpts(el), extra || {});
          if (id === "title") o.heading = docx.HeadingLevel.TITLE;
          else if (id === "h1") o.heading = docx.HeadingLevel.HEADING_1;
          else if (id === "h2") o.heading = docx.HeadingLevel.HEADING_2;
          else if (id === "h3") o.heading = docx.HeadingLevel.HEADING_3;
          else if (id !== "body") o.style = ps.docx;
          if (pbNext) { o.pageBreakBefore = true; pbNext = false; }
          if (id === "code") { var lines = el.textContent.split("\n"), runs = []; lines.forEach(function (ln, i) { if (i) runs.push(new docx.TextRun({ break: 1 })); runs.push(new docx.TextRun({ text: ln.replace(/​/g, "") })); }); o.children = runs; }
          else o.children = runsOf(el, {});
          return new docx.Paragraph(o);
        }
        function list(el, level, into) {
          var ordered = el.tagName === "OL", inst = ordered ? ++olCount : 0;
          Array.prototype.forEach.call(el.children, function (li) {
            if (li.tagName === "UL" || li.tagName === "OL") { list(li, level + 1, into); return; } // 浏览器生成的 <ul><ul>：当作上一项的子列表
            if (li.tagName !== "LI") return;
            var own = document.createElement("div"), nested = [];
            Array.prototype.forEach.call(li.childNodes, function (ch) { if (ch.nodeType === 1 && (ch.tagName === "UL" || ch.tagName === "OL")) nested.push(ch); else own.appendChild(ch.cloneNode(true)); });
            var o = Object.assign(paraOpts(li), { children: runsOf(own, {}) });
            if (ordered) o.numbering = { reference: "ol", level: Math.min(level, 8), instance: inst };
            else o.bullet = { level: Math.min(level, 8) };
            into.push(new docx.Paragraph(o));
            nested.forEach(function (n) { list(n, level + 1, into); });
          });
        }
        function tableOf(el) {
          var rows = [], maxW = model.page.w - model.page.ml - model.page.mr, colW = Array.prototype.map.call(el.querySelectorAll(":scope > colgroup > col"), function (c) { return parseFloat(c.style.width) || 0; });
          Array.prototype.forEach.call(el.querySelectorAll(":scope > tbody > tr, :scope > tr"), function (tr) {
            if (tr.classList.contains("pg-sp")) return;
            var cells = [];
            Array.prototype.forEach.call(tr.children, function (td) {
              var kidsOut = [];
              blocks(td, kidsOut);
              if (!kidsOut.length) kidsOut.push(new docx.Paragraph({}));
              var o = { children: kidsOut };
              var cs = +(td.getAttribute("colspan") || 1), rs = +(td.getAttribute("rowspan") || 1);
              if (cs > 1) o.columnSpan = cs;
              if (rs > 1) o.rowSpan = rs;
              var bg = hex6(td.style.backgroundColor); if (bg) o.shading = { type: docx.ShadingType.CLEAR, color: "auto", fill: bg };
              o.margins = { top: 60, bottom: 60, left: 100, right: 100 };
              cells.push(new docx.TableCell(o));
            });
            if (cells.length) rows.push(new docx.TableRow({ children: cells }));
          });
          if (!rows.length) return null;
          var plain = el.classList.contains("plain"), b = plain ? { style: docx.BorderStyle.NONE, size: 0, color: "FFFFFF" } : { style: docx.BorderStyle.SINGLE, size: 4, color: "A0A0A0" };
          var opts = { rows: rows, width: { size: 100, type: docx.WidthType.PERCENTAGE }, borders: { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b } };
          if (colW.length && colW.every(Boolean)) { var sum = colW.reduce(function (a, x) { return a + x; }, 0); opts.columnWidths = colW.map(function (w) { return Math.round(w / sum * maxW * TW_PER_PX); }); }
          return new docx.Table(opts);
        }
        // 块级里夹着的零散文字（编辑时浏览器偶尔会留下）先包成段落
        function blockKids(root) {
          var out = [], tmp = null;
          Array.prototype.forEach.call(root.childNodes, function (n) {
            var isBlock = n.nodeType === 1 && /^(P|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|PRE|HR|DIV)$/.test(n.tagName);
            if (isBlock) { tmp = null; out.push(n); return; }
            if (n.nodeType === 3 && !n.nodeValue.trim() && !tmp) return;
            if (n.nodeType === 1 && n.classList.contains("pg-sp")) return;
            if (!tmp) { tmp = document.createElement("p"); out.push(tmp); }
            tmp.appendChild(n.cloneNode(true));
          });
          return out;
        }
        function blocks(root, into) {
          blockKids(root).forEach(function (el) {
            if (el.classList.contains("pg-sp")) return;
            var t = el.tagName;
            if (t === "HR" && el.classList.contains("pg-break")) { pbNext = true; return; }
            if (t === "HR") { into.push(new docx.Paragraph({ border: { bottom: { color: "A0A0A0", space: 1, style: docx.BorderStyle.SINGLE, size: 6 } }, children: [] })); return; }
            if (t === "UL" || t === "OL") { list(el, 0, into); return; }
            if (t === "TABLE") { var tb = tableOf(el); if (tb) { into.push(tb); } return; }
            if (t === "DIV") { blocks(el, into); return; }
            into.push(para(el));
          });
          if (pbNext && root === model.flow) { into.push(new docx.Paragraph({ children: [new docx.PageBreak()] })); pbNext = false; }
        }
        blocks(model.flow, out);
        if (!out.length) out.push(new docx.Paragraph({}));
        var runStyle = function (s) { var r = { size: Math.round((s.size || 11) * 2) }; if (s.bold) r.bold = true; if (s.italic) r.italics = true; if (s.color) r.color = hex6(s.color); if (s.font) r.font = font(s.font); return r; };
        var paraStyle = function (s) { var p = { spacing: { before: Math.round((s.before || 0) * 20), after: Math.round((s.after || 0) * 20) } }; if (s.line) { p.spacing.line = Math.round(s.line / LH * 240); p.spacing.lineRule = docx.LineRuleType.AUTO; } if (s.align && ALIGN[s.align]) p.alignment = docx.AlignmentType[ALIGN[s.align]]; return p; };
        var bodyRun = runStyle(S.body);
        if (!bodyRun.font) bodyRun.font = { ascii: "Helvetica Neue", hAnsi: "Helvetica Neue", eastAsia: "PingFang SC", cs: "Helvetica Neue" };
        var P = model.page, tw = function (px) { return Math.round(px * TW_PER_PX); };
        var numLevels = [];
        for (var lv = 0; lv < 9; lv++) numLevels.push({ level: lv, format: [docx.LevelFormat.DECIMAL, docx.LevelFormat.LOWER_LETTER, docx.LevelFormat.LOWER_ROMAN][lv % 3], text: "%" + (lv + 1) + ".", alignment: docx.AlignmentType.START, style: { paragraph: { indent: { left: 420 * (lv + 1), hanging: 420 } } } });
        var sectionFooter = model.pageNumbers ? { default: new docx.Footer({ children: [new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ children: [docx.PageNumber.CURRENT], size: 18, color: "808080" })] })] }) } : undefined;
        var document2 = new docx.Document({
          creator: (model.props && model.props.author) || "文稿",
          title: (model.props && model.props.title) || "",
          lastModifiedBy: "文稿",
          styles: {
            default: {
              document: { run: bodyRun, paragraph: paraStyle(S.body) },
              title: { run: runStyle(S.title), paragraph: paraStyle(S.title) },
              heading1: { run: runStyle(S.h1), paragraph: Object.assign(paraStyle(S.h1), { keepNext: true }) },
              heading2: { run: runStyle(S.h2), paragraph: Object.assign(paraStyle(S.h2), { keepNext: true }) },
              heading3: { run: runStyle(S.h3), paragraph: Object.assign(paraStyle(S.h3), { keepNext: true }) },
              hyperlink: { run: { color: "0B62D6", underline: { type: docx.UnderlineType.SINGLE } } },
            },
            paragraphStyles: [
              { id: "Normal", name: "Normal", run: bodyRun, paragraph: paraStyle(S.body), quickFormat: true },
              { id: "Subtitle", name: "Subtitle", basedOn: "Normal", next: "Normal", run: runStyle(S.subtitle), paragraph: paraStyle(S.subtitle), quickFormat: true },
              { id: "Quote", name: "Quote", basedOn: "Normal", next: "Normal", run: runStyle(S.quote), paragraph: Object.assign(paraStyle(S.quote), { indent: { left: 567 } }), quickFormat: true },
              { id: "Caption", name: "caption", basedOn: "Normal", next: "Normal", run: runStyle(S.caption), paragraph: paraStyle(S.caption), quickFormat: true },
              { id: "Code", name: "Code", basedOn: "Normal", next: "Normal", run: runStyle(S.code), paragraph: paraStyle(S.code), quickFormat: true },
            ],
          },
          numbering: { config: [{ reference: "ol", levels: numLevels }] },
          sections: [{
            properties: { page: { size: { width: tw(P.w), height: tw(P.h), orientation: P.orient === "landscape" ? docx.PageOrientation.LANDSCAPE : docx.PageOrientation.PORTRAIT }, margin: { top: tw(P.mt), bottom: tw(P.mb), left: tw(P.ml), right: tw(P.mr), header: 567, footer: 567 } } },
            footers: sectionFooter,
            children: out,
          }],
        });
        return docx.Packer.toBlob(document2).then(function (blob) { return blob.arrayBuffer(); }).then(function (buf) {
          // 补一个默认段落样式（Normal，w:default="1"）：Word 自己能对付，python-docx 读 paragraph.style 时要用
          return JSZip.loadAsync(buf).then(function (zip) {
            return zip.file("word/styles.xml").async("string").then(function (s) {
              s = s.replace(/<w:style w:type="paragraph" w:styleId="Normal">/, '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">');
              zip.file("word/styles.xml", s);
              return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
            });
          });
        });
      });
    });
  }
  function toPng(src) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () {
        var c = document.createElement("canvas");
        c.width = im.naturalWidth || 1;
        c.height = im.naturalHeight || 1;
        c.getContext("2d").drawImage(im, 0, 0);
        c.toBlob(function (b) { if (!b) return rej(new Error("转不了 PNG")); b.arrayBuffer().then(function (a) { res(new Uint8Array(a)); }); }, "image/png");
      };
      im.onerror = function () { rej(new Error("图片打不开")); };
      im.src = src;
    });
  }

  // ======== Markdown ========
  function mdInline(s) {
    // 先把代码段抠出来，其余的转义后再认格式
    var codes = [];
    s = s.replace(/`([^`]+)`/g, function (m, c) { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, function (m, alt, url) { return '<img alt="' + alt + '" src="' + url + '">'; });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, function (m, t, url) { return safeHref(url.replace(/&amp;/g, "&")) ? '<a href="' + url + '">' + t + "</a>" : t; });
    s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>');
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "<b><i>$1</i></b>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/__([^_]+)__/g, "<b>$1</b>");
    s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<i>$2</i>").replace(/(^|[^\w_])_([^_\s][^_]*?)_(?![\w_])/g, "$1<i>$2</i>");
    s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");
    s = s.replace(/\u0000(\d+)\u0000/g, function (m, i) { return "<code>" + esc(codes[+i]) + "</code>"; });
    return s;
  }
  function mdToHtml(md) {
    var lines = String(md).replace(/\r\n?/g, "\n").split("\n"), out = [], i = 0;
    var isBlank = function (l) { return !l || !l.trim(); };
    while (i < lines.length) {
      var l = lines[i], m;
      if (isBlank(l)) { i++; continue; }
      if ((m = /^\s*(```|~~~)\s*([\w-]*)\s*$/.exec(l))) {
        var fence = m[1], code = [];
        i++;
        while (i < lines.length && !new RegExp("^\\s*" + fence).test(lines[i])) code.push(lines[i++]);
        i++;
        out.push("<pre>" + esc(code.join("\n")) + "</pre>");
        continue;
      }
      if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l))) { var n = Math.min(3, m[1].length); out.push("<h" + n + ">" + mdInline(m[2]) + "</h" + n + ">"); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
      if (/^\s*<!--\s*pagebreak\s*-->\s*$/i.test(l) || /^\\newpage\s*$/.test(l)) { out.push('<hr class="pg-break">'); i++; continue; }
      if (/^\s*>/.test(l)) {
        var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
        q.join("\n").split(/\n\s*\n/).forEach(function (para) { out.push("<blockquote>" + mdInline(para.replace(/\n/g, " ")) + "</blockquote>"); });
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        var rows = [], cells = function (s) { return s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) { return c.trim(); }); };
        var head = cells(l);
        var aligns = cells(lines[i + 1]).map(function (c) { return /^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : ""; });
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        var td = function (c, k, bold) { return "<td" + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : "") + "><p>" + (bold ? "<b>" + mdInline(c) + "</b>" : mdInline(c)) + "</p></td>"; };
        out.push("<table><tbody><tr>" + head.map(function (c, k) { return td(c, k, true); }).join("") + "</tr>" + rows.map(function (r) { return "<tr>" + head.map(function (x, k) { return td(r[k] || "", k); }).join("") + "</tr>"; }).join("") + "</tbody></table>");
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
        // 列表：按缩进分层
        var items = [];
        while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (!isBlank(lines[i]) && /^\s{2,}\S/.test(lines[i]) && items.length))) {
          var lm = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
          if (lm) items.push({ ind: lm[1].replace(/\t/g, "    ").length, ord: /\d/.test(lm[2]), text: lm[3], start: parseInt(lm[2], 10) });
          else items[items.length - 1].text += " " + lines[i].trim();
          i++;
        }
        var html = "", stack = [];
        items.forEach(function (it) {
          var task = /^\[( |x|X)\]\s+/.exec(it.text), text = task ? (task[1] === " " ? "☐ " : "☑ ") + it.text.slice(task[0].length) : it.text;
          while (stack.length && stack[stack.length - 1].ind > it.ind) { html += "</li></" + stack.pop().tag + ">"; }
          var top = stack[stack.length - 1];
          if (!top || top.ind < it.ind) { var tag = it.ord ? "ol" : "ul"; html += "<" + tag + (it.ord && it.start > 1 ? ' start="' + it.start + '"' : "") + ">"; stack.push({ ind: it.ind, tag: tag }); }
          else html += "</li>";
          html += "<li>" + mdInline(text);
        });
        while (stack.length) html += "</li></" + stack.pop().tag + ">";
        out.push(html);
        continue;
      }
      // 段落
      var para = [];
      while (i < lines.length && !isBlank(lines[i]) && !/^(#{1,6}\s|\s*>|\s*```|\s*~~~|\s*([-*+]|\d+[.)])\s+)/.test(lines[i]) && !(/^\s*\|.*\|\s*$/.test(lines[i]) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]))) {
        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i]) && para.length) break;
        para.push(lines[i++]);
      }
      if (!para.length) { para.push(lines[i++]); }
      out.push("<p>" + para.map(function (x, k) { var hard = / {2,}$|\\$/.test(x) && k < para.length - 1; return mdInline(x.replace(/\\$/, "").trim()) + (hard ? "<br>" : ""); }).join(" ").replace(/<br> /g, "<br>") + "</p>");
    }
    return out.join("\n");
  }
  function htmlToMd(root, imgOut) {
    var lines = [];
    function inline(node) {
      var s = "";
      Array.prototype.forEach.call(node.childNodes, function (ch) {
        if (ch.nodeType === 3) { s += ch.nodeValue.replace(/​/g, "").replace(/([*_`~\\[\]])/g, "\\$1"); return; }
        if (ch.nodeType !== 1 || ch.classList.contains("pg-sp")) return;
        var t = ch.tagName, inner = inline(ch), st = ch.style || {};
        if (t === "BR") { s += "  \n"; return; }
        if (t === "IMG") { s += "![" + (ch.alt || "") + "](" + (imgOut ? imgOut(ch) : ch.getAttribute("src")) + ")"; return; }
        if (!inner.trim()) { s += inner; return; }
        var lead = /^\s*/.exec(inner)[0], trail = /\s*$/.exec(inner)[0], core = inner.trim();
        if (t === "B" || t === "STRONG" || st.fontWeight === "bold") core = "**" + core + "**";
        if (t === "I" || t === "EM" || st.fontStyle === "italic") core = "*" + core + "*";
        if (t === "S" || t === "DEL" || /line-through/.test(st.textDecorationLine || st.textDecoration || "")) core = "~~" + core + "~~";
        if (t === "CODE") core = "`" + ch.textContent + "`";
        if (t === "A" && ch.getAttribute("href")) core = "[" + core + "](" + ch.getAttribute("href") + ")";
        s += lead + core + trail;
      });
      return s;
    }
    var hasTitle = !!root.querySelector("h1.title");
    function block(el, depth) {
      var t = el.tagName;
      if (el.classList.contains("pg-sp")) return;
      if (t === "H1" && el.classList.contains("title")) lines.push("# " + inline(el).trim(), "");
      else if (t === "H1") lines.push((hasTitle ? "## " : "# ") + inline(el).trim(), "");
      else if (t === "H2") lines.push((hasTitle ? "### " : "## ") + inline(el).trim(), "");
      else if (t === "H3") lines.push((hasTitle ? "#### " : "### ") + inline(el).trim(), "");
      else if (t === "BLOCKQUOTE") lines.push("> " + inline(el).trim().replace(/\n/g, "\n> "), "");
      else if (t === "PRE") lines.push("```", el.textContent.replace(/​/g, ""), "```", "");
      else if (t === "HR") lines.push(el.classList.contains("pg-break") ? "<!-- pagebreak -->" : "---", "");
      else if (t === "UL" || t === "OL") { listMd(el, 0); lines.push(""); }
      else if (t === "TABLE") {
        var rows = Array.prototype.filter.call(el.querySelectorAll("tr"), function (tr) { return !tr.classList.contains("pg-sp") && tr.closest("table") === el; });
        rows.forEach(function (tr, i) {
          var cells = Array.prototype.map.call(tr.children, function (td) { var t = inline(td).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim(); return i === 0 ? t.replace(/^\*\*(.*)\*\*$/, "$1") : t; });
          lines.push("| " + cells.join(" | ") + " |");
          if (i === 0) lines.push("|" + Array.prototype.map.call(tr.children, function (td) { var a = td.style.textAlign; return a === "center" ? " :---: " : a === "right" ? " ---: " : " --- "; }).join("|") + "|");
        });
        lines.push("");
      }
      else if (el.classList.contains("subtitle")) lines.push("*" + inline(el).trim() + "*", "");
      else { var s = inline(el).trim(); if (s) lines.push(s, ""); else lines.push(""); }
    }
    function listMd(el, depth) {
      var n = +(el.getAttribute("start") || 1);
      Array.prototype.forEach.call(el.children, function (li) {
        var own = document.createElement("div"), nested = [];
        Array.prototype.forEach.call(li.childNodes, function (ch) { if (ch.nodeType === 1 && (ch.tagName === "UL" || ch.tagName === "OL")) nested.push(ch); else own.appendChild(ch.cloneNode(true)); });
        lines.push("  ".repeat(depth) + (el.tagName === "OL" ? n++ + ". " : "- ") + inline(own).trim());
        nested.forEach(function (x) { listMd(x, depth + 1); });
      });
    }
    Array.prototype.forEach.call(root.children, function (el) { block(el, 0); });
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }
  function htmlToText(root) {
    var out = [];
    function walk(el, prefix) {
      Array.prototype.forEach.call(el.children, function (b) {
        if (b.classList.contains("pg-sp")) return;
        var t = b.tagName;
        if (t === "UL" || t === "OL") { var n = +(b.getAttribute("start") || 1); Array.prototype.forEach.call(b.children, function (li) { var own = li.cloneNode(true); own.querySelectorAll("ul, ol").forEach(function (x) { x.remove(); }); out.push(prefix + (t === "OL" ? n++ + ". " : "• ") + textOf(own)); li.querySelectorAll(":scope > ul, :scope > ol").forEach(function (x) { walk({ children: [x] }, prefix + "    "); }); }); return; }
        if (t === "TABLE") { b.querySelectorAll("tr").forEach(function (tr) { if (!tr.classList.contains("pg-sp")) out.push(Array.prototype.map.call(tr.children, function (td) { return textOf(td).replace(/\n/g, " "); }).join("\t")); }); out.push(""); return; }
        if (t === "HR") { out.push(b.classList.contains("pg-break") ? "\f" : "————————"); return; }
        out.push(prefix + textOf(b));
      });
    }
    function textOf(el) { var c = el.cloneNode(true); c.querySelectorAll(".pg-sp").forEach(function (x) { x.remove(); }); c.querySelectorAll("br").forEach(function (x) { x.replaceWith("\n"); }); c.querySelectorAll("p").forEach(function (x, i) { if (i) x.insertAdjacentText("beforebegin", "\n"); }); return c.textContent.replace(/​/g, ""); }
    walk(root, "");
    return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
  }
  function textToHtml(text) {
    return String(text).replace(/\r\n?/g, "\n").split("\n").map(function (l) { return l === "\f" ? '<hr class="pg-break">' : "<p>" + (l ? esc(l).replace(/\t/g, "\t") : "<br>") + "</p>"; }).join("");
  }

  // ======== 读入口 ========
  function read(u8, ext, path) {
    var images = new Images();
    var name = path ? O.stemOf(path) : "";
    var dec = function () { try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); } catch (e) { return new TextDecoder("gb18030").decode(u8); } };
    if (ext === "docx") return readDocx(u8, images).then(function (r) { return Object.assign({ page: r.page || defaultPage(), images: images, props: r.props || {} }, r, { images: images }); });
    if (ext === "md" || ext === "markdown") {
      var md = dec();
      var html = mdToHtml(md);
      // Markdown 里用相对路径引用的图片：从沙盒里读进来
      var box = document.createElement("div");
      box.appendChild(sanitize(html));
      var dir = path ? O.dirOf(path) : O.DOCS, jobs = [];
      box.querySelectorAll("img").forEach(function (im) {
        var src = im.getAttribute("src") || "";
        if (/^(https?:|data:|blob:)/.test(src)) return;
        var p = src.charAt(0) === "/" ? src : dir + "/" + decodeURIComponent(src);
        p = p.replace(/\/\.\//g, "/");
        while (/\/[^/]+\/\.\.\//.test(p)) p = p.replace(/\/[^/]+\/\.\.\//, "/");
        jobs.push(O.readBytes(p).then(function (b) { im.src = images.add(b, mimeOf(p)); im.setAttribute("data-path", src); }, function () { im.remove(); }));
      });
      return Promise.all(jobs).then(function () { return { html: box.innerHTML, page: defaultPage(), images: images, props: { title: name } }; });
    }
    if (ext === "html" || ext === "htm") {
      var text = dec(), dom = new DOMParser().parseFromString(text, "text/html"), b = document.createElement("div");
      b.appendChild(sanitize(dom.body));
      return Promise.resolve({ html: b.innerHTML, page: defaultPage(), images: images, props: { title: dom.title || name } });
    }
    return Promise.resolve({ html: textToHtml(dec()), page: defaultPage(), images: images, props: { title: name }, plain: true });
  }

  Object.assign(PG, {
    SIZES: SIZES, PSTYLES: PSTYLES, DEF_STYLES: DEF_STYLES, PX_PER_CM: PX_PER_CM,
    defaultPage: defaultPage, mergedStyles: mergedStyles, styleOfBlock: styleOfBlock, Images: Images, mimeOf: mimeOf, b64: b64,
    sanitize: sanitize, cssColor: cssColor, cssPt: cssPt, read: read, writeDocx: writeDocx, mdToHtml: mdToHtml, htmlToMd: htmlToMd, htmlToText: htmlToText, textToHtml: textToHtml, matchSize: matchSize,
  });
})();
