// office/keynote-io.js —— 讲演的数据模型、主题、版式，和 .pptx 之间的转换
// 幻灯片坐标：宽 1920（16:9）或 1440（4:3），高 1080；字号用磅（PowerPoint 的宽屏幻灯片 = 960 × 540 磅，所以 1 磅 = 2 个单位）
// 写：PptxGenJS 画出文本框、形状、图片、背景、演讲者注释，再用 JSZip 补上标题 / 正文占位符（python-pptx 的 slide.shapes.title 能找到标题）、切换效果、隐藏的幻灯片
// 读（尽量还原）：JSZip 读 presentation.xml、每张幻灯片的形状树（文本、形状、图片、组合、表格转成文字）、占位符的位置（从版式 / 母版继承）、主题色、背景、备注、切换效果
(function () {
  "use strict";
  var O = window.TSU_OFFICE;
  var KN = O.kn = O.kn || {};
  var PT = 2; // 1 磅 = 2 个幻灯片单位
  var uid = 0;
  var newId = function () { return "i" + Date.now().toString(36) + (++uid).toString(36); };

  // ======== 主题 ========
  var THEMES = [
    { id: "white", name: "白色", bg: "#ffffff", title: "#1d1d1f", body: "#3a3a3c", accent: "#0a7aff", accent2: "#ff9500", shape: "#0a7aff", font: "PingFang SC", headFont: "PingFang SC" },
    { id: "black", name: "黑色", bg: "#000000", title: "#ffffff", body: "#d1d1d6", accent: "#ff9f0a", accent2: "#30d158", shape: "#ff9f0a", font: "PingFang SC", headFont: "PingFang SC" },
    { id: "gradient", name: "渐变", bg: "#1e3c72", bg2: "#2a5298", title: "#ffffff", body: "#dbe7ff", accent: "#ffd60a", accent2: "#64d2ff", shape: "#64d2ff", font: "PingFang SC", headFont: "PingFang SC" },
    { id: "warm", name: "暖阳", bg: "#fff6ea", title: "#c2410c", body: "#44403c", accent: "#ea580c", accent2: "#0d9488", shape: "#fb923c", font: "PingFang SC", headFont: "Songti SC" },
    { id: "mint", name: "薄荷", bg: "#effaf5", title: "#065f46", body: "#1f2937", accent: "#10b981", accent2: "#6366f1", shape: "#34d399", font: "PingFang SC", headFont: "PingFang SC" },
    { id: "midnight", name: "深夜", bg: "#0f172a", bg2: "#1e293b", title: "#e2e8f0", body: "#cbd5e1", accent: "#38bdf8", accent2: "#f472b6", shape: "#38bdf8", font: "PingFang SC", headFont: "PingFang SC" },
  ];
  function theme(id) { return THEMES.find(function (t) { return t.id === id; }) || THEMES[0]; }

  // ======== 版式：新幻灯片里预先放好的占位符 ========
  var LAYOUTS = [
    { id: "title", name: "标题", make: function (W, H, t) { return [
      { type: "text", ph: "title", x: W * 0.08, y: H * 0.30, w: W * 0.84, h: 200, html: "", font: { size: 60, bold: true, align: "center", valign: "bottom", color: null } },
      { type: "text", ph: "subtitle", x: W * 0.12, y: H * 0.30 + 220, w: W * 0.76, h: 120, html: "", font: { size: 28, align: "center", valign: "top", color: null } },
    ]; } },
    { id: "titleBody", name: "标题与正文", make: function (W, H) { return [
      { type: "text", ph: "title", x: 110, y: 70, w: W - 220, h: 160, html: "", font: { size: 44, bold: true, align: "left", valign: "bottom" } },
      { type: "text", ph: "body", x: 110, y: 270, w: W - 220, h: H - 360, html: "", list: "bullet", font: { size: 28, align: "left", valign: "top" } },
    ]; } },
    { id: "titleOnly", name: "仅标题", make: function (W) { return [
      { type: "text", ph: "title", x: 110, y: 70, w: W - 220, h: 160, html: "", font: { size: 44, bold: true, align: "left", valign: "bottom" } },
    ]; } },
    { id: "section", name: "章节", make: function (W, H) { return [
      { type: "text", ph: "title", x: W * 0.1, y: H * 0.36, w: W * 0.8, h: 220, html: "", font: { size: 72, bold: true, align: "center", valign: "middle" } },
    ]; } },
    { id: "twoCol", name: "标题与两栏", make: function (W, H) { return [
      { type: "text", ph: "title", x: 110, y: 70, w: W - 220, h: 160, html: "", font: { size: 44, bold: true, align: "left", valign: "bottom" } },
      { type: "text", ph: "body", x: 110, y: 270, w: (W - 260) / 2, h: H - 360, html: "", list: "bullet", font: { size: 26, align: "left", valign: "top" } },
      { type: "text", ph: "body2", x: 150 + (W - 260) / 2, y: 270, w: (W - 260) / 2, h: H - 360, html: "", list: "bullet", font: { size: 26, align: "left", valign: "top" } },
    ]; } },
    { id: "quote", name: "引言", make: function (W, H) { return [
      { type: "text", ph: "body", x: W * 0.12, y: H * 0.28, w: W * 0.76, h: 300, html: "", font: { size: 48, italic: true, align: "center", valign: "middle" } },
      { type: "text", ph: "subtitle", x: W * 0.2, y: H * 0.28 + 330, w: W * 0.6, h: 80, html: "", font: { size: 24, align: "center", valign: "top" } },
    ]; } },
    { id: "blank", name: "空白", make: function () { return []; } },
  ];
  var PROMPT = { title: "双击以编辑标题", subtitle: "双击以编辑副标题", body: "双击以编辑正文", body2: "双击以编辑正文" };
  function newSlide(deck, layoutId) {
    var L = LAYOUTS.find(function (l) { return l.id === layoutId; }) || LAYOUTS[1];
    return { id: newId(), layout: L.id, bg: null, items: L.make(deck.w, deck.h, theme(deck.theme)).map(function (x) { return Object.assign({ id: newId(), rot: 0 }, x); }), notes: "", hidden: false, trans: { type: "none", dur: 0.6 } };
  }
  function newDeck(themeId, ratio) {
    var deck = { w: ratio === "4:3" ? 1440 : 1920, h: 1080, theme: themeId || "white", slides: [], images: null };
    return deck;
  }

  // ======== 图片（同文稿：blob 地址 + 字节）========
  function Images() { this.map = new Map(); }
  Images.prototype.add = function (bytes, mime) { var url = URL.createObjectURL(new Blob([bytes], { type: mime || "image/png" })); this.map.set(url, { bytes: bytes, mime: mime || "image/png" }); return url; };
  Images.prototype.get = function (u) { return this.map.get(u) || null; };
  Images.prototype.dispose = function () { this.map.forEach(function (v, k) { URL.revokeObjectURL(k); }); this.map.clear(); };
  function mimeOf(name) { var e = (name.match(/\.([a-z0-9]+)$/i) || [])[1]; e = e ? e.toLowerCase() : ""; return { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml", emf: "image/emf", wmf: "image/wmf", tif: "image/tiff", tiff: "image/tiff" }[e] || "application/octet-stream"; }
  function b64(u8) { var s = "", CH = 0x8000; for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }

  // ======== 形状：SVG 路径（宽 w 高 h 的框里）========
  var SHAPES = [
    { id: "rect", name: "矩形", ppt: "rect" }, { id: "roundRect", name: "圆角矩形", ppt: "roundRect" }, { id: "ellipse", name: "椭圆", ppt: "ellipse" },
    { id: "triangle", name: "三角形", ppt: "triangle" }, { id: "rtTriangle", name: "直角三角形", ppt: "rtTriangle" }, { id: "diamond", name: "菱形", ppt: "diamond" },
    { id: "pentagon", name: "五边形", ppt: "pentagon" }, { id: "hexagon", name: "六边形", ppt: "hexagon" }, { id: "star5", name: "五角星", ppt: "star5" },
    { id: "rightArrow", name: "箭头", ppt: "rightArrow" }, { id: "chevron", name: "V 形箭头", ppt: "chevron" }, { id: "speech", name: "对话气泡", ppt: "wedgeRoundRectCallout" },
    { id: "heart", name: "心形", ppt: "heart" }, { id: "line", name: "直线", ppt: "line" }, { id: "arrowLine", name: "带箭头的线", ppt: "line" },
  ];
  function shapePath(kind, w, h, r) {
    var pts = function (arr) { return "M" + arr.map(function (p) { return (p[0] * w).toFixed(1) + "," + (p[1] * h).toFixed(1); }).join("L") + "Z"; };
    switch (kind) {
      case "ellipse": return "M" + w / 2 + ",0A" + w / 2 + "," + h / 2 + " 0 1,1 " + (w / 2 - 0.01) + ",0Z";
      case "roundRect": { var rr = Math.min(r || Math.min(w, h) * 0.18, w / 2, h / 2); return "M" + rr + ",0H" + (w - rr) + "A" + rr + "," + rr + " 0 0 1 " + w + "," + rr + "V" + (h - rr) + "A" + rr + "," + rr + " 0 0 1 " + (w - rr) + "," + h + "H" + rr + "A" + rr + "," + rr + " 0 0 1 0," + (h - rr) + "V" + rr + "A" + rr + "," + rr + " 0 0 1 " + rr + ",0Z"; }
      case "triangle": return pts([[0.5, 0], [1, 1], [0, 1]]);
      case "rtTriangle": return pts([[0, 0], [1, 1], [0, 1]]);
      case "diamond": return pts([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
      case "pentagon": return pts([[0.5, 0], [1, 0.38], [0.81, 1], [0.19, 1], [0, 0.38]]);
      case "hexagon": return pts([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]);
      case "star5": { var a = [], i; for (i = 0; i < 10; i++) { var ang = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? 0.2 : 0.5; a.push([0.5 + rad * Math.cos(ang), 0.54 + rad * Math.sin(ang) * 1.04]); } return pts(a); }
      case "rightArrow": return pts([[0, 0.25], [0.62, 0.25], [0.62, 0], [1, 0.5], [0.62, 1], [0.62, 0.75], [0, 0.75]]);
      case "chevron": return pts([[0, 0], [0.7, 0], [1, 0.5], [0.7, 1], [0, 1], [0.3, 0.5]]);
      case "speech": { var rr2 = Math.min(w, h) * 0.15, bh = h * 0.78; return "M" + rr2 + ",0H" + (w - rr2) + "A" + rr2 + "," + rr2 + " 0 0 1 " + w + "," + rr2 + "V" + (bh - rr2) + "A" + rr2 + "," + rr2 + " 0 0 1 " + (w - rr2) + "," + bh + "H" + w * 0.38 + "L" + w * 0.2 + "," + h + "L" + w * 0.24 + "," + bh + "H" + rr2 + "A" + rr2 + "," + rr2 + " 0 0 1 0," + (bh - rr2) + "V" + rr2 + "A" + rr2 + "," + rr2 + " 0 0 1 " + rr2 + ",0Z"; }
      case "heart": return "M" + w / 2 + "," + h * 0.95 + "C" + w * 0.1 + "," + h * 0.62 + " 0," + h * 0.4 + " 0," + h * 0.27 + "C0," + h * 0.08 + " " + w * 0.14 + ",0 " + w * 0.28 + ",0C" + w * 0.4 + ",0 " + w * 0.48 + "," + h * 0.08 + " " + w / 2 + "," + h * 0.18 + "C" + w * 0.52 + "," + h * 0.08 + " " + w * 0.6 + ",0 " + w * 0.72 + ",0C" + w * 0.86 + ",0 " + w + "," + h * 0.08 + " " + w + "," + h * 0.27 + "C" + w + "," + h * 0.4 + " " + w * 0.9 + "," + h * 0.62 + " " + w / 2 + "," + h * 0.95 + "Z";
      case "line": case "arrowLine": return "M0," + h / 2 + "L" + w + "," + h / 2;
      default: return "M0,0H" + w + "V" + h + "H0Z";
    }
  }

  // ======== .pptx 写 ========
  var IN = function (deck, u) { return u / deck.w * (deck.w === 1440 ? 10 : 13.333); }; // 单位 → 英寸
  var hex = function (c) { if (!c) return null; var m = /^#?([0-9a-f]{6})$/i.exec(c); return m ? m[1].toUpperCase() : null; };
  var ALIGN = { left: "left", center: "center", right: "right", justify: "justify" };
  // 富文本（p / ul>li / 行内的 b i u s span）→ PptxGenJS 的文字段
  function runsOf(html, font, t) {
    var box = document.createElement("div");
    box.innerHTML = html || "";
    var out = [];
    // 收集段落：<p> 一段一段；列表里每个 <li> 一段（子列表的层级 +1）；零散的文字当一段
    function collect(root, level, into) {
      var loose = null;
      Array.prototype.forEach.call(root.childNodes, function (n) {
        if (n.nodeType === 1 && (n.tagName === "UL" || n.tagName === "OL")) {
          loose = null;
          Array.prototype.forEach.call(n.children, function (li) { if (li.tagName === "LI") para(li, level, n.tagName === "OL" ? "number" : "bullet", into); });
          return;
        }
        if (n.nodeType === 1 && (n.tagName === "P" || n.tagName === "DIV")) { loose = null; para(n, level, null, into); return; }
        if (n.nodeType === 3 && !n.nodeValue.trim() && !loose) return;
        if (!loose) { loose = document.createElement("p"); into.push(loose); }
        loose.appendChild(n.cloneNode(true));
      });
      // 零散文字攒成的临时段落换成真正的文字段
      for (var i = 0; i < into.length; i++) if (into[i] && into[i].nodeType === 1) { var tmp = []; para(into[i], level, null, tmp); Array.prototype.splice.apply(into, [i, 1].concat(tmp)); i += tmp.length - 1; }
    }
    function para(el, level, list, into) {
      var runs = [];
      (function walk(n, f) {
        Array.prototype.forEach.call(n.childNodes, function (c) {
          if (c.nodeType === 3) { if (c.nodeValue) runs.push({ text: c.nodeValue.replace(/​/g, ""), options: Object.assign({}, f) }); return; }
          if (c.nodeType !== 1) return;
          if (c.tagName === "UL" || c.tagName === "OL") return; // 子列表另算
          if (c.tagName === "BR") { runs.push({ text: "", options: Object.assign({}, f, { softBreakBefore: true }) }); return; }
          var g = Object.assign({}, f);
          if (c.tagName === "B" || c.tagName === "STRONG") g.bold = true;
          if (c.tagName === "I" || c.tagName === "EM") g.italic = true;
          if (c.tagName === "U") g.underline = { style: "sng" };
          if (c.tagName === "S" || c.tagName === "STRIKE") g.strike = "sngStrike";
          var st = c.style || {};
          if (st.color) { var cc = cssHex(st.color); if (cc) g.color = cc; }
          if (st.fontSize) { var pt = parseFloat(st.fontSize); if (/px/.test(st.fontSize)) pt = pt / PT; if (pt) g.fontSize = Math.round(pt); }
          if (st.fontFamily) g.fontFace = st.fontFamily.split(",")[0].replace(/["']/g, "").trim();
          if (st.fontWeight === "bold" || +st.fontWeight >= 600) g.bold = true;
          if (st.fontStyle === "italic") g.italic = true;
          if (/underline/.test(st.textDecorationLine || st.textDecoration || "")) g.underline = { style: "sng" };
          if (/line-through/.test(st.textDecorationLine || st.textDecoration || "")) g.strike = "sngStrike";
          walk(c, g);
        });
      })(el, {});
      if (!runs.length) runs.push({ text: "", options: {} });
      var first = runs[0].options;
      if (list) { first.bullet = list === "number" ? { type: "number" } : true; if (level) first.indentLevel = level; }
      var align = el.style && el.style.textAlign;
      if (align && ALIGN[align]) first.align = align;
      into.push(runs);
      Array.prototype.forEach.call(el.children || [], function (c) { if (c.tagName === "UL" || c.tagName === "OL") { var wrap = document.createElement("div"); wrap.appendChild(c.cloneNode(true)); collect(wrap, level + 1, into); } });
    }
    var list = [];
    collect(box, 0, list);
    // 段与段之间 breakLine
    list.forEach(function (runs, i) {
      runs.forEach(function (r) { if (r.options.softBreakBefore) { delete r.options.softBreakBefore; r.options.softBreakBefore = true; } });
      if (i < list.length - 1) runs[runs.length - 1].options.breakLine = true;
      runs.forEach(function (r) { out.push(r); });
    });
    return out;
  }
  function cssHex(c) {
    if (!c) return null;
    var m = /^#([0-9a-f]{6})$/i.exec(c);
    if (m) return m[1].toUpperCase();
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
    if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
    m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    if (m) return [m[1], m[2], m[3]].map(function (x) { var h = (+x).toString(16); return h.length < 2 ? "0" + h : h; }).join("").toUpperCase();
    return null;
  }
  function textColor(item, deck) { var t = theme(deck.theme); return (item.font && item.font.color) || (item.ph === "title" ? t.title : t.body); }
  // 渐变背景：PowerPoint 的文件格式里能写渐变，但 PptxGenJS 不支持——画成一张图当背景
  function gradPng(c1, c2, w, h) {
    return new Promise(function (res) {
      var c = document.createElement("canvas");
      c.width = Math.round(w / 2);
      c.height = Math.round(h / 2);
      var g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, c.width, c.height);
      gr.addColorStop(0, c1);
      gr.addColorStop(1, c2);
      g.fillStyle = gr;
      g.fillRect(0, 0, c.width, c.height);
      res(c.toDataURL("image/png").replace(/^data:/, ""));
    });
  }
  function writePptx(deck) {
    return Promise.all([O.lib("pptxgenjs"), O.lib("jszip")]).then(function (libs) {
      var PptxGenJS = libs[0], JSZip = libs[1], pptx = new PptxGenJS(), t = theme(deck.theme), notesMap = [];
      if (deck.w === 1440) pptx.layout = "LAYOUT_4x3"; else pptx.layout = "LAYOUT_WIDE";
      pptx.author = deck.author || "讲演";
      pptx.title = deck.title || "";
      var grads = {};
      var need = [];
      deck.slides.forEach(function (s) { var bg = s.bg || (t.bg2 ? { grad: [t.bg, t.bg2] } : null); if (bg && bg.grad) { var k = bg.grad.join(","); if (!grads[k]) { grads[k] = true; need.push(gradPng(bg.grad[0], bg.grad[1], deck.w, deck.h).then(function (d) { grads[k] = d; })); } } });
      return Promise.all(need).then(function () {
      deck.slides.forEach(function (s, si) {
        var slide = pptx.addSlide();
        var bg = s.bg || (t.bg2 ? { grad: [t.bg, t.bg2] } : { color: t.bg });
        if (bg.color) slide.background = { color: hex(bg.color) || "FFFFFF" };
        else if (bg.grad) slide.background = { data: grads[bg.grad.join(",")] };
        else if (bg.image) { var im0 = deck.images.get(bg.image); if (im0) slide.background = { data: im0.mime + ";base64," + b64(im0.bytes) }; }
        s.items.forEach(function (it, ii) {
          var o = { x: IN(deck, it.x), y: IN(deck, it.y), w: IN(deck, Math.max(1, it.w)), h: IN(deck, Math.max(1, it.h)) };
          if (it.rot) o.rotate = Math.round(it.rot);
          var f = it.font || {}, name = (it.ph ? "PH_" + it.ph + "_" : "IT_") + si + "_" + ii;
          o.objectName = name;
          if (it.type === "image") {
            var im = deck.images.get(it.src);
            if (!im) return;
            o.data = im.mime.replace("image/jpg", "image/jpeg") + ";base64," + b64(im.bytes);
            if (it.opacity != null && it.opacity < 1) o.transparency = Math.round((1 - it.opacity) * 100);
            slide.addImage(o);
            return;
          }
          var textOpts = Object.assign({}, o, {
            fontFace: f.family || (it.ph === "title" ? t.headFont : t.font), fontSize: f.size || 24, color: hex(f.color) || hex(textColor(it, deck)) || "000000",
            bold: !!f.bold, italic: !!f.italic, align: f.align || "left", valign: f.valign === "middle" ? "middle" : f.valign === "bottom" ? "bottom" : "top",
            margin: 6, lineSpacingMultiple: f.line || 1.0, fit: "none", wrap: true,
          });
          if (it.type === "shape") {
            var sh = SHAPES.find(function (x) { return x.id === it.shape; }) || SHAPES[0];
            textOpts.shape = pptx.ShapeType[sh.ppt] || pptx.ShapeType.rect;
            if (it.fill) textOpts.fill = { color: hex(it.fill), transparency: it.opacity != null && it.opacity < 1 ? Math.round((1 - it.opacity) * 100) : 0 };
            else textOpts.fill = { type: "none" };
            if (it.stroke && it.strokeW) textOpts.line = { color: hex(it.stroke), width: Math.max(0.25, it.strokeW / PT) };
            if (it.shape === "arrowLine") textOpts.line = Object.assign({ color: hex(it.stroke || it.fill || t.shape), width: Math.max(0.5, (it.strokeW || 4) / PT) }, { endArrowType: "triangle" });
            if (it.shape === "line") textOpts.line = { color: hex(it.stroke || it.fill || t.shape), width: Math.max(0.5, (it.strokeW || 4) / PT) };
            if (it.shape === "roundRect") textOpts.rectRadius = IN(deck, Math.min(it.radius || Math.min(it.w, it.h) * 0.18, it.w / 2, it.h / 2));
            if (it.shape === "line" || it.shape === "arrowLine") { delete textOpts.fill; slide.addShape(pptx.ShapeType.line, Object.assign({}, o, { line: textOpts.line })); return; }
          }
          var runs = runsOf(it.html, f, t), empty = !runs.length || runs.every(function (r) { return !r.text; });
          if (empty && it.type === "shape") {
            // 没字的形状：只画形状
            var so = { x: o.x, y: o.y, w: o.w, h: o.h, objectName: o.objectName, fill: textOpts.fill };
            if (o.rotate) so.rotate = o.rotate;
            if (textOpts.line) so.line = textOpts.line;
            if (textOpts.rectRadius) so.rectRadius = textOpts.rectRadius;
            slide.addShape(textOpts.shape, so);
            return;
          }
          if (empty) { if (!it.ph) return; runs = [{ text: "", options: {} }]; }
          slide.addText(runs, textOpts);
        });
        if (s.notes) slide.addNotes(s.notes);
      });
      return pptx.write({ outputType: "arraybuffer" });
      }).then(function (buf) {
        // 补：占位符（标题 / 副标题 / 正文）、切换效果、隐藏的幻灯片
        return JSZip.loadAsync(buf).then(function (zip) {
          var files = Object.keys(zip.files).filter(function (p) { return /^ppt\/slides\/slide\d+\.xml$/.test(p); });
          return Promise.all(files.map(function (p) {
            var n = +/slide(\d+)\.xml$/.exec(p)[1], s = deck.slides[n - 1];
            return zip.file(p).async("string").then(function (x) {
              x = x.replace(/(<p:cNvPr [^>]*name="PH_(title|subtitle|body2?)_[^"]*"[^>]*>(?:<\/p:cNvPr>)?)(<p:cNvSpPr[^>]*\/?>(?:<\/p:cNvSpPr>)?)<p:nvPr>(\s*)<\/p:nvPr>/g, function (m, a, kind, b) {
                var ph = kind === "title" ? '<p:ph type="title"/>' : kind === "subtitle" ? '<p:ph type="subTitle" idx="1"/>' : kind === "body" ? '<p:ph type="body" idx="1"/>' : '<p:ph type="body" idx="2"/>';
                return a + b + "<p:nvPr>" + ph + "</p:nvPr>";
              });
              if (s && s.hidden) x = x.replace(/<p:sld /, '<p:sld show="0" ');
              x = linesToConnectors(x);
              var tr = s && s.trans && s.trans.type !== "none" ? transXML(s.trans) : "";
              if (tr && x.indexOf("<p:transition") < 0) x = x.replace(/<\/p:clrMapOvr>/, "</p:clrMapOvr>" + tr).replace(/(<\/p:cSld>)(?![\s\S]*<\/p:clrMapOvr>)/, "$1" + tr);
              zip.file(p, x);
            });
          })).then(function () { return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }); });
        });
      });
    });
  }
  // 直线在 PowerPoint 里是连接线（p:cxnSp）；PptxGenJS 写成了普通形状，python-pptx 读 auto_shape_type 时会出错——换过来
  function linesToConnectors(x) {
    if (x.indexOf('prst="line"') < 0) return x;
    var P = "http://schemas.openxmlformats.org/presentationml/2006/main", d = new DOMParser().parseFromString(x, "application/xml");
    Array.prototype.slice.call(d.getElementsByTagNameNS(P, "sp")).forEach(function (sp) {
      var geom = sp.getElementsByTagNameNS("*", "prstGeom")[0];
      if (!geom || geom.getAttribute("prst") !== "line") return;
      var nv = sp.getElementsByTagNameNS(P, "nvSpPr")[0], spPr = sp.getElementsByTagNameNS(P, "spPr")[0];
      if (!nv || !spPr) return;
      var cx = d.createElementNS(P, "p:cxnSp"), nvc = d.createElementNS(P, "p:nvCxnSpPr"), cNvPr = nv.getElementsByTagNameNS(P, "cNvPr")[0];
      if (cNvPr) nvc.appendChild(cNvPr.cloneNode(true));
      nvc.appendChild(d.createElementNS(P, "p:cNvCxnSpPr"));
      nvc.appendChild(d.createElementNS(P, "p:nvPr"));
      cx.appendChild(nvc);
      cx.appendChild(spPr.cloneNode(true));
      sp.parentNode.replaceChild(cx, sp);
    });
    return new XMLSerializer().serializeToString(d);
  }
  function transXML(tr) {
    var spd = tr.dur <= 0.4 ? "fast" : tr.dur >= 1 ? "slow" : "med";
    var inner = { fade: "<p:fade/>", dissolve: "<p:dissolve/>", push: '<p:push dir="l"/>', move: '<p:cover dir="l"/>', wipe: '<p:wipe dir="l"/>', zoom: "<p:zoom/>" }[tr.type] || "<p:fade/>";
    return '<p:transition spd="' + spd + '">' + inner + "</p:transition>";
  }

  // ======== .pptx 读（尽量还原）========
  function kids(el, name) { var out = []; if (!el) return out; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (!name || c.localName === name) out.push(c); return out; }
  function kid(el, name) { if (!el) return null; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c; return null; }
  function path(el, names) { var e = el; for (var i = 0; i < names.length && e; i++) e = kid(e, names[i]); return e; }
  function xml(s) { return s ? new DOMParser().parseFromString(s, "application/xml") : null; }
  function relsOf(zip, p) {
    var dir = p.replace(/[^/]+$/, ""), rp = dir + "_rels/" + p.slice(dir.length) + ".rels", f = zip.file(rp);
    if (!f) return Promise.resolve({});
    return f.async("string").then(function (s) {
      var out = {}, d = xml(s);
      kids(d.documentElement, "Relationship").forEach(function (r) {
        var t = r.getAttribute("Target"), abs = r.getAttribute("TargetMode") === "External" ? t : resolve(dir, t);
        out[r.getAttribute("Id")] = { target: abs, type: r.getAttribute("Type") || "", external: r.getAttribute("TargetMode") === "External" };
      });
      return out;
    });
  }
  function resolve(dir, t) {
    if (t.charAt(0) === "/") return t.slice(1);
    var parts = (dir + t).split("/"), out = [];
    parts.forEach(function (p) { if (p === "..") out.pop(); else if (p !== "." && p !== "") out.push(p); });
    return out.join("/");
  }
  function readPptx(u8) {
    return O.lib("jszip").then(function (JSZip) { return JSZip.loadAsync(u8); }).then(function (zip) {
      var str = function (p) { var f = zip.file(p); return f ? f.async("string") : Promise.resolve(null); };
      return Promise.all([str("ppt/presentation.xml"), relsOf(zip, "ppt/presentation.xml")]).then(function (r) {
        var pres = xml(r[0]);
        if (!pres) throw new Error("这不是有效的 .pptx 文件（里面没有 ppt/presentation.xml）");
        var prels = r[1], root = pres.documentElement, sz = kid(root, "sldSz");
        var cx = sz ? +sz.getAttribute("cx") : 12192000, cy = sz ? +sz.getAttribute("cy") : 6858000;
        var deck = newDeck("white", cx / cy < 1.5 ? "4:3" : "16:9");
        deck.h = 1080;
        deck.w = Math.round(1080 * cx / cy);
        var E = function (emu) { return emu / cy * 1080; }; // EMU → 单位
        deck.images = new Images();
        var ids = kids(kid(root, "sldIdLst"), "sldId").map(function (s) { return s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"); });
        var slidePaths = ids.map(function (id) { return prels[id] && prels[id].target; }).filter(Boolean);
        var themeRel = Object.keys(prels).map(function (k) { return prels[k]; }).find(function (x) { return /\/theme$/.test(x.type); });
        return str(themeRel ? themeRel.target : "ppt/theme/theme1.xml").then(function (th) {
          var colors = themeColors(xml(th)), cache = {};
          var ctx = { zip: zip, deck: deck, E: E, colors: colors, cache: cache };
          return slidePaths.reduce(function (chain, p) { return chain.then(function () { return readSlide(ctx, p).then(function (s) { if (s) deck.slides.push(s); }); }); }, Promise.resolve()).then(function () {
            if (!deck.slides.length) deck.slides.push(newSlide(deck, "title"));
            // 主题：用第一张幻灯片的背景猜一个最接近的（只影响新加的幻灯片的默认样子）
            var bg0 = deck.slides[0].bg && deck.slides[0].bg.color;
            if (bg0 && lum(bg0) < 0.3) deck.theme = "black";
            return deck;
          });
        });
      });
    });
  }
  function lum(hx) { var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hx || ""); if (!m) return 1; return (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255; }
  function themeColors(d) {
    var out = { dk1: "000000", lt1: "FFFFFF", dk2: "44546A", lt2: "E7E6E6", accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5", accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47", hlink: "0563C1", folHlink: "954F72" };
    if (!d) return out;
    var cs = d.getElementsByTagNameNS("*", "clrScheme")[0];
    if (!cs) return out;
    kids(cs).forEach(function (c) { var v = kid(c, "srgbClr"), s = kid(c, "sysClr"); if (v) out[c.localName] = v.getAttribute("val"); else if (s) out[c.localName] = s.getAttribute("lastClr") || out[c.localName]; });
    out.tx1 = out.dk1; out.bg1 = out.lt1; out.tx2 = out.dk2; out.bg2 = out.lt2;
    return out;
  }
  // a:solidFill / a:srgbClr / a:schemeClr（带 lumMod / lumOff / tint / shade 的粗略处理）→ #rrggbb
  function colorOf(el, colors) {
    if (!el) return null;
    var c = kid(el, "srgbClr") || kid(el, "schemeClr") || kid(el, "sysClr") || kid(el, "prstClr");
    if (!c) return null;
    var v = c.localName === "srgbClr" ? c.getAttribute("val") : c.localName === "schemeClr" ? colors[c.getAttribute("val")] : c.localName === "sysClr" ? c.getAttribute("lastClr") : { black: "000000", white: "FFFFFF", red: "FF0000", blue: "0000FF", green: "008000", yellow: "FFFF00" }[c.getAttribute("val")];
    if (!v) return null;
    var r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
    var mod = kid(c, "lumMod"), off = kid(c, "lumOff"), tint = kid(c, "tint"), shade = kid(c, "shade");
    var f = function (x) { return Math.max(0, Math.min(255, Math.round(x))); };
    if (mod || off) { var m = mod ? +mod.getAttribute("val") / 100000 : 1, o = off ? +off.getAttribute("val") / 100000 : 0; r = f(r * m + 255 * o); g = f(g * m + 255 * o); b = f(b * m + 255 * o); }
    if (tint) { var t = +tint.getAttribute("val") / 100000; r = f(r + (255 - r) * (1 - t)); g = f(g + (255 - g) * (1 - t)); b = f(b + (255 - b) * (1 - t)); }
    if (shade) { var s = +shade.getAttribute("val") / 100000; r = f(r * s); g = f(g * s); b = f(b * s); }
    var h = function (x) { return (x < 16 ? "0" : "") + x.toString(16); };
    return "#" + h(r) + h(g) + h(b);
  }
  // 版式 / 母版里占位符的位置（幻灯片上的占位符没写位置时继承）
  function placeholderMap(ctx, p) {
    if (ctx.cache[p]) return ctx.cache[p];
    var f = ctx.zip.file(p);
    ctx.cache[p] = !f ? Promise.resolve({ map: {}, rels: {}, bg: null, parent: null }) : Promise.all([f.async("string"), relsOf(ctx.zip, p)]).then(function (r) {
      var d = xml(r[0]), map = {}, rels = r[1];
      Array.prototype.forEach.call(d.getElementsByTagNameNS("*", "sp"), function (sp) {
        var ph = path(sp, ["nvSpPr", "nvPr", "ph"]), xf = path(sp, ["spPr", "xfrm"]);
        if (!ph || !xf) return;
        var key = (ph.getAttribute("type") || "body") + ":" + (ph.getAttribute("idx") || "0"), val = xfrm(xf, ctx.E);
        map[key] = val;
        if (!map["type:" + (ph.getAttribute("type") || "body")]) map["type:" + (ph.getAttribute("type") || "body")] = val;
        if (ph.getAttribute("idx")) map["idx:" + ph.getAttribute("idx")] = val;
      });
      var bg = bgOf(path(d.documentElement, ["cSld", "bg"]), ctx, rels);
      var parentRel = Object.keys(rels).map(function (k) { return rels[k]; }).find(function (x) { return /\/slideMaster$/.test(x.type) || /\/slideLayout$/.test(x.type); });
      return { map: map, rels: rels, bg: bg, parent: parentRel ? parentRel.target : null };
    });
    return ctx.cache[p];
  }
  function xfrm(xf, E) {
    var off = kid(xf, "off"), ext = kid(xf, "ext");
    return { x: off ? E(+off.getAttribute("x")) : 0, y: off ? E(+off.getAttribute("y")) : 0, w: ext ? E(+ext.getAttribute("cx")) : 0, h: ext ? E(+ext.getAttribute("cy")) : 0, rot: xf.getAttribute("rot") ? +xf.getAttribute("rot") / 60000 : 0, flipH: xf.getAttribute("flipH") === "1" };
  }
  function bgOf(bg, ctx, rels) {
    if (!bg) return null;
    var pr = kid(bg, "bgPr");
    if (pr) {
      var solid = kid(pr, "solidFill");
      if (solid) return { color: colorOf(solid, ctx.colors) };
      var grad = kid(pr, "gradFill");
      if (grad) { var stops = kids(kid(grad, "gsLst"), "gs").map(function (g) { return colorOf(g, ctx.colors); }).filter(Boolean); if (stops.length) return stops.length > 1 ? { grad: [stops[0], stops[stops.length - 1]] } : { color: stops[0] }; }
      var blip = pr.getElementsByTagNameNS("*", "blip")[0];
      if (blip) { var rid = blip.getAttribute("r:embed") || blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed"); if (rid && rels[rid]) return { imagePath: rels[rid].target }; }
    }
    var ref = kid(bg, "bgRef");
    if (ref) { var c = colorOf(ref, ctx.colors); if (c) return { color: c }; }
    return null;
  }
  function readSlide(ctx, p) {
    var zip = ctx.zip, f = zip.file(p);
    if (!f) return Promise.resolve(null);
    return Promise.all([f.async("string"), relsOf(zip, p)]).then(function (r) {
      var d = xml(r[0]), rels = r[1], root = d.documentElement;
      var layoutRel = Object.keys(rels).map(function (k) { return rels[k]; }).find(function (x) { return /\/slideLayout$/.test(x.type); });
      var notesRel = Object.keys(rels).map(function (k) { return rels[k]; }).find(function (x) { return /\/notesSlide$/.test(x.type); });
      return Promise.all([layoutRel ? placeholderMap(ctx, layoutRel.target) : Promise.resolve(null), notesRel ? zip.file(notesRel.target) && zip.file(notesRel.target).async("string") : Promise.resolve(null)]).then(function (lr) {
        var layout = lr[0];
        return (layout && layout.parent ? placeholderMap(ctx, layout.parent) : Promise.resolve(null)).then(function (master) {
          var slide = { id: newId(), layout: "blank", bg: null, items: [], notes: "", hidden: root.getAttribute("show") === "0", trans: { type: "none", dur: 0.6 } };
          slide.bg = bgOf(path(root, ["cSld", "bg"]), ctx, rels) || (layout && layout.bg) || (master && master.bg) || null;
          var jobs = [];
          if (slide.bg && slide.bg.imagePath) { var ip = slide.bg.imagePath; slide.bg = null; jobs.push(zip.file(ip) ? zip.file(ip).async("uint8array").then(function (b) { slide.bg = { image: ctx.deck.images.add(b, mimeOf(ip)) }; }) : null); }
          var dark = slide.bg && slide.bg.color && lum(slide.bg.color) < 0.4;
          var tr = kid(root, "transition");
          if (!tr) { var ac = kid(root, "AlternateContent"); if (ac) { var ch = kid(ac, "Choice") || kid(ac, "Fallback"); tr = ch && kid(ch, "transition"); } }
          if (tr) { var eff = tr.firstElementChild, nm = eff ? eff.localName : "fade"; slide.trans = { type: { fade: "fade", dissolve: "dissolve", push: "push", cover: "move", pull: "move", wipe: "wipe", zoom: "zoom", split: "wipe", randomBar: "dissolve" }[nm] || "fade", dur: tr.getAttribute("spd") === "fast" ? 0.4 : tr.getAttribute("spd") === "slow" ? 1 : 0.6 }; }
          var spTree = path(root, ["cSld", "spTree"]);
          walkTree(spTree, { ox: 0, oy: 0, sx: 1, sy: 1 }, slide, ctx, rels, layout, master, dark, jobs);
          if (lr[1]) {
            var nd = xml(lr[1]), texts = [];
            Array.prototype.forEach.call(nd.getElementsByTagNameNS("*", "sp"), function (sp) {
              var ph = path(sp, ["nvSpPr", "nvPr", "ph"]);
              if (!ph || ph.getAttribute("type") !== "body") return;
              Array.prototype.forEach.call(sp.getElementsByTagNameNS("*", "p"), function (pp) { if (pp.namespaceURI && /drawingml/.test(pp.namespaceURI)) texts.push(Array.prototype.map.call(pp.getElementsByTagNameNS("*", "t"), function (t) { return t.textContent; }).join("")); });
            });
            slide.notes = texts.join("\n").trim();
          }
          return Promise.all(jobs).then(function () { return slide; });
        });
      });
    });
  }
  function walkTree(tree, tf, slide, ctx, rels, layout, master, dark, jobs) {
    kids(tree).forEach(function (el) {
      var n = el.localName;
      if (n === "sp" || n === "cxnSp") shape(el);
      else if (n === "pic") pic(el);
      else if (n === "grpSp") {
        var gx = path(el, ["grpSpPr", "xfrm"]);
        if (!gx) return walkTree(el, tf, slide, ctx, rels, layout, master, dark, jobs);
        var off = kid(gx, "off"), ext = kid(gx, "ext"), coff = kid(gx, "chOff"), cext = kid(gx, "chExt");
        var sx = cext && +cext.getAttribute("cx") ? +ext.getAttribute("cx") / +cext.getAttribute("cx") : 1, sy = cext && +cext.getAttribute("cy") ? +ext.getAttribute("cy") / +cext.getAttribute("cy") : 1;
        var ntf = { ox: tf.ox + (ctx.E(+off.getAttribute("x")) - ctx.E(+(coff ? coff.getAttribute("x") : 0)) * sx) * tf.sx, oy: tf.oy + (ctx.E(+off.getAttribute("y")) - ctx.E(+(coff ? coff.getAttribute("y") : 0)) * sy) * tf.sy, sx: tf.sx * sx, sy: tf.sy * sy };
        walkTree(el, ntf, slide, ctx, rels, layout, master, dark, jobs);
      }
      else if (n === "graphicFrame") table(el);
      else if (n === "AlternateContent") { var ch = kid(el, "Choice") || kid(el, "Fallback"); if (ch) walkTree(ch, tf, slide, ctx, rels, layout, master, dark, jobs); }
    });
    function pos(el, ph) {
      var xf = path(el, ["spPr", "xfrm"]) || path(el, ["xfrm"]), g = xf ? xfrm(xf, ctx.E) : null;
      if (!g && ph) {
        var type = ph.getAttribute("type") || "body", idx = ph.getAttribute("idx") || "0", L = layout ? layout.map : {}, M = master ? master.map : {};
        g = L[type + ":" + idx] || L["idx:" + idx] || L["type:" + type] || M["type:" + type] || M["type:" + (type === "ctrTitle" ? "title" : type === "subTitle" ? "body" : type)] || null;
      }
      if (!g) return null;
      return { x: tf.ox + g.x * tf.sx, y: tf.oy + g.y * tf.sy, w: g.w * tf.sx, h: g.h * tf.sy, rot: g.rot || 0 };
    }
    function shape(el) {
      var ph = path(el, ["nvSpPr", "nvPr", "ph"]), g = pos(el, ph);
      if (!g) return;
      var spPr = kid(el, "spPr"), geom = spPr && kid(spPr, "prstGeom"), prst = geom ? geom.getAttribute("prst") : "rect";
      var fillEl = spPr && kid(spPr, "solidFill"), noFill = spPr && kid(spPr, "noFill"), ln = spPr && kid(spPr, "ln");
      var fill = fillEl ? colorOf(fillEl, ctx.colors) : null;
      if (!fill && spPr && kid(spPr, "gradFill")) { var gs = kid(kid(spPr, "gradFill"), "gsLst"); var st = gs && kid(gs, "gs"); fill = st ? colorOf(st, ctx.colors) : null; }
      if (!fill && !noFill && !ph && el.localName === "sp") { var style = kid(el, "style"), fr = style && kid(style, "fillRef"); if (fr && +fr.getAttribute("idx") > 0) fill = colorOf(fr, ctx.colors); }
      var stroke = ln && !kid(ln, "noFill") ? colorOf(kid(ln, "solidFill"), ctx.colors) : null, strokeW = ln && ln.getAttribute("w") ? ctx.E(+ln.getAttribute("w")) : stroke ? 2 : 0;
      if (!stroke && el.localName === "cxnSp") { var st2 = kid(el, "style"), lr = st2 && kid(st2, "lnRef"); stroke = lr ? colorOf(lr, ctx.colors) : "#000000"; strokeW = strokeW || 3; }
      var phType = ph ? ph.getAttribute("type") || "body" : null, role = phType === "title" || phType === "ctrTitle" ? "title" : phType === "subTitle" ? "subtitle" : phType === "body" || phType === "obj" ? "body" : null;
      var txBody = kid(el, "txBody"), text = txBody ? textOf(txBody, role === "body") : null;
      if (phType === "dt" || phType === "ftr" || phType === "sldNum") return; // 日期、页脚、页码占位符不要
      var shapeKind = { rect: "rect", roundRect: "roundRect", ellipse: "ellipse", triangle: "triangle", rtTriangle: "rtTriangle", diamond: "diamond", pentagon: "pentagon", hexagon: "hexagon", star5: "star5", rightArrow: "rightArrow", chevron: "chevron", wedgeRoundRectCallout: "speech", wedgeRectCallout: "speech", heart: "heart", line: "line", straightConnector1: "arrowLine" }[prst];
      var isText = !fill && !stroke && text && (prst === "rect" || !prst);
      if (el.localName === "cxnSp") shapeKind = ln && kid(ln, "tailEnd") && kid(ln, "tailEnd").getAttribute("type") !== "none" ? "arrowLine" : "line";
      var item = { id: newId(), rot: g.rot, x: g.x, y: g.y, w: g.w, h: g.h };
      if (isText || !shapeKind && text) { item.type = "text"; }
      else { item.type = "shape"; item.shape = shapeKind || "rect"; item.fill = fill; item.stroke = stroke; item.strokeW = strokeW; if (item.shape === "line" || item.shape === "arrowLine") { item.stroke = stroke || fill || "#000000"; item.strokeW = strokeW || 3; item.h = Math.max(item.h, 1); } }
      if (role) item.ph = role;
      if (text) {
        item.html = text.html;
        var isShape = item.type === "shape";
        item.font = { size: text.size || (role === "title" ? (phType === "ctrTitle" ? 54 : 40) : role === "subtitle" ? 24 : role === "body" ? 24 : 18), bold: text.bold, color: text.color || (dark && !isShape ? "#ffffff" : null), align: text.align || (phType === "ctrTitle" || phType === "subTitle" || isShape ? "center" : "left"), valign: text.valign || (role === "title" || isShape ? "middle" : "top"), family: text.family || null };
        if (text.list) item.list = text.list;
      } else if (item.type === "text") return;
      else item.html = "";
      if (!item.font) item.font = { size: 18, align: "center", valign: "middle" };
      slide.items.push(item);
    }
    function pic(el) {
      var g = pos(el, path(el, ["nvPicPr", "nvPr", "ph"]));
      var blip = el.getElementsByTagNameNS("*", "blip")[0];
      if (!g || !blip) return;
      var rid = blip.getAttribute("r:embed") || blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed"), rel = rels[rid];
      if (!rel || rel.external) return;
      var mime = mimeOf(rel.target);
      if (/emf|wmf|tiff/.test(mime)) return;
      var item = { id: newId(), type: "image", x: g.x, y: g.y, w: g.w, h: g.h, rot: g.rot };
      slide.items.push(item);
      var f = ctx.zip.file(rel.target);
      if (f) jobs.push(f.async("uint8array").then(function (b) { item.src = ctx.deck.images.add(b, mime); }));
    }
    function table(el) {
      var g = pos(el, null), tbl = el.getElementsByTagNameNS("*", "tbl")[0];
      if (!g) return;
      if (!tbl) { slide.items.push({ id: newId(), type: "text", x: g.x, y: g.y, w: g.w, h: g.h, rot: 0, html: "<p>［图表 / 对象：讲演里暂时不能显示］</p>", font: { size: 16, color: "#8e8e93", align: "center", valign: "middle" } }); return; }
      var rows = kids(tbl, "tr").map(function (tr) { return kids(tr, "tc").map(function (tc) { return Array.prototype.map.call(tc.getElementsByTagNameNS("*", "t"), function (t) { return t.textContent; }).join(""); }); });
      var html = rows.map(function (r, i) { return "<p>" + (i === 0 ? "<b>" : "") + O.esc(r.join("　｜　")) + (i === 0 ? "</b>" : "") + "</p>"; }).join("");
      slide.items.push({ id: newId(), type: "text", x: g.x, y: g.y, w: g.w, h: g.h, rot: 0, html: html, font: { size: 16, align: "left", valign: "top", color: dark ? "#ffffff" : null } });
    }
  }
  // txBody → { html, size, bold, color, align, valign, list, family }（第一段第一个字的属性当整体属性）
  // defaultBullets：正文占位符（母版里默认带项目符号，段落自己不写）
  function textOf(txBody, defaultBullets) {
    var body = kid(txBody, "bodyPr"), anchor = body ? body.getAttribute("anchor") : null;
    var paras = kids(txBody, "p"), first = null, rows = [];
    paras.forEach(function (p) {
      var pPr = kid(p, "pPr"), algn = pPr ? pPr.getAttribute("algn") : null, lvl = pPr ? +(pPr.getAttribute("lvl") || 0) : 0;
      var bu = pPr && kid(pPr, "buChar") ? "bullet" : pPr && kid(pPr, "buAutoNum") ? "number" : pPr && kid(pPr, "buNone") ? "none" : null;
      var inner = "";
      kids(p).forEach(function (r) {
        if (r.localName === "br") { inner += "<br>"; return; }
        if (r.localName !== "r" && r.localName !== "fld") return;
        var t = kid(r, "t"), rPr = kid(r, "rPr"), text = t ? t.textContent : "";
        if (!text) return;
        var css = [], sx = O.esc(text);
        if (rPr) {
          var sz = rPr.getAttribute("sz"), col = colorOf(kid(rPr, "solidFill"), {}), latin = kid(rPr, "latin"), ea = kid(rPr, "ea");
          if (!first) first = { size: sz ? +sz / 100 : null, bold: rPr.getAttribute("b") === "1", color: col, family: (ea && ea.getAttribute("typeface")) || (latin && latin.getAttribute("typeface")) || null };
          else {
            if (sz && first.size && Math.abs(+sz / 100 - first.size) > 0.5) css.push("font-size:" + +sz / 100 + "pt");
            if (col && col !== first.color) css.push("color:" + col);
          }
          if (rPr.getAttribute("b") === "1" && !(first && first.bold)) sx = "<b>" + sx + "</b>";
          if (rPr.getAttribute("i") === "1") sx = "<i>" + sx + "</i>";
          if (rPr.getAttribute("u") && rPr.getAttribute("u") !== "none") sx = "<u>" + sx + "</u>";
          if (rPr.getAttribute("strike") && rPr.getAttribute("strike") !== "noStrike") sx = "<s>" + sx + "</s>";
        } else if (!first) first = { size: null, bold: false, color: null };
        if (css.length) sx = '<span style="' + css.join(";") + '">' + sx + "</span>";
        inner += sx;
      });
      if (!first) { var epr = kid(p, "endParaRPr"); if (epr && epr.getAttribute("sz")) first = { size: +epr.getAttribute("sz") / 100 }; }
      var align = algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" ? "justify" : null;
      if (first && first.align === undefined) first.align = align;
      rows.push({ lvl: lvl, bu: bu, html: inner, align: align });
    });
    if (!paras.some(function (p) { return kids(p, "r").some(function (r) { var t = kid(r, "t"); return t && t.textContent; }); })) return null;
    var explicit = rows.some(function (r) { return r.bu; });
    rows.forEach(function (r) { if (!r.bu) r.bu = defaultBullets && !explicit ? "bullet" : "none"; if (r.bu === "none") r.bu = null; });
    // 按层级生成嵌套列表
    var html = "", stack = [];
    var close = function (toDepth) { while (stack.length > toDepth) html += "</li></" + stack.pop() + ">"; };
    rows.forEach(function (r) {
      if (!r.bu) { close(0); html += "<p" + (r.align && first && r.align !== first.align ? ' style="text-align:' + r.align + '"' : "") + ">" + (r.html || "<br>") + "</p>"; return; }
      var tag = r.bu === "number" ? "ol" : "ul", depth = r.lvl + 1;
      if (stack.length > depth) close(depth);
      if (stack.length === depth) html += "</li>";
      while (stack.length < depth) { html += "<" + tag + ">"; stack.push(tag); if (stack.length < depth) html += "<li>"; }
      html += "<li>" + (r.html || "<br>");
    });
    close(0);
    var out = { html: html, valign: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : anchor === "t" ? "top" : null };
    if (first) { out.size = first.size; out.bold = first.bold; out.color = first.color; out.align = first.align; out.family = first.family; }
    if (rows.every(function (r) { return r.bu; })) out.list = rows[0].bu === "number" ? "number" : "bullet";
    return out;
  }

  // ======== 读入口 ========
  function read(u8, ext) {
    if (ext !== "pptx") return Promise.reject(new Error("讲演只能打开 .pptx"));
    return readPptx(u8);
  }

  Object.assign(KN, {
    PT: PT, THEMES: THEMES, LAYOUTS: LAYOUTS, SHAPES: SHAPES, PROMPT: PROMPT, theme: theme, newSlide: newSlide, newDeck: newDeck, newId: newId,
    Images: Images, mimeOf: mimeOf, b64: b64, shapePath: shapePath, writePptx: writePptx, read: read, lum: lum,
  });
})();
