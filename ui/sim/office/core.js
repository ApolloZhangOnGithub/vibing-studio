// office/core.js —— 表格 / 文稿 / 讲演共用的底子（第一次打开其中一个 App 时才载入）
// · 文稿：打开（沙盒里的文件 → 各 App 的 read）、自动存储（同 macOS：改了就写回原文件；写之前先看磁盘上的是不是还是我们上次读 / 写的那份，
//   不是就停下来问——绝不悄悄盖掉 agent 或别的程序的修改）、第一次覆盖前把原来那份留在 ~/Library/Autosave Information、未命名的文稿也自动存在那里（页面重开后能找回）
// · 窗口：一个文稿一个窗口（同一个 App 的窗口共用 Dock 图标，关掉的窗口留着给下一个文稿用）；iWork 式的两行标题栏（标题 + 带字的工具栏）、右边的检查器
// · 面板：存储面板（名称、位置、格式）、文稿浏览器（模板、最近使用、文件夹）、从电脑导入 / 下载到电脑、打印、导出 PDF（pdf.js：App 里存成真的 PDF 文件，浏览器里走打印对话框）
// · 检查器里的控件：弹出菜单、步进器、颜色池、分段控件、勾选框
(function () {
  "use strict";
  var O = window.TSU_OFFICE, D = window.TSU_DESK, FS = window.SANDBOX;
  if (!O || O.core) return;
  var HOME = FS.HOME || "/home/user", DOCS = HOME + "/Documents", AUTOSAVE = HOME + "/Library/Autosave Information";

  // ======== 小工具 ========
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var baseOf = function (p) { return p.slice(p.lastIndexOf("/") + 1); };
  var dirOf = function (p) { var i = p.lastIndexOf("/"); return i <= 0 ? "/" : p.slice(0, i); };
  var extOf = function (p) { var m = /\.([^./]+)$/.exec(p); return m ? m[1].toLowerCase() : ""; };
  var stemOf = function (p) { var b = baseOf(p), i = b.lastIndexOf("."); return i > 0 ? b.slice(0, i) : b; };
  var tilde = function (p) { return p === HOME ? "~" : p.indexOf(HOME + "/") === 0 ? "~" + p.slice(HOME.length) : p; };
  function uniquePath(dir, stem, ext) { var p = dir + "/" + stem + "." + ext, n = 2; while (FS.exists(p)) p = dir + "/" + stem + " " + n++ + "." + ext; return p; }
  function toBytes(x) { return typeof x === "string" ? new TextEncoder().encode(x) : x instanceof Uint8Array ? x : new Uint8Array(x); }
  function hash(u8) { var h = 0x811c9dc5 | 0; for (var i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16) + ":" + u8.length; }
  function it(label, keys, run, opts) { return Object.assign({ label: label, keys: keys || "", run: run }, opts || {}); }
  var SEP = { sep: true };
  function fmtDate(t) {
    if (!t) return "";
    var d = new Date(t), now = new Date(), two = function (x) { return (x < 10 ? "0" : "") + x; }, hm = two(d.getHours()) + ":" + two(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return "今天 " + hm;
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "昨天 " + hm;
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }
  var MIME = {
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", csv: "text/csv", tsv: "text/tab-separated-values",
    md: "text/markdown", txt: "text/plain", html: "text/html", pdf: "application/pdf",
  };

  // ======== 深浅外观 ========
  var themeFns = [];
  new MutationObserver(function () { themeFns.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  function onTheme(f) { themeFns.push(f); return function () { themeFns = themeFns.filter(function (x) { return x !== f; }); }; }
  var dark = function () { return !document.documentElement.classList.contains("light"); };

  // ======== 读写沙盒里的文件 ========
  // 真沙盒的镜像里，大文件、二进制文件只有元数据，要用时才取（ensureLoaded）
  function readBytes(p) {
    if (!FS.exists(p)) return Promise.reject(new Error("没有这个文件：" + tilde(p)));
    if (FS.isDir(p)) return Promise.reject(new Error("是文件夹：" + tilde(p)));
    var st = FS.stat(p) || {};
    var get = function () { return FS.readBinary(p); };
    if (!st.lazy) return Promise.resolve().then(get);
    return Promise.resolve(FS.ensureLoaded([p])).then(function () {
      var s2 = FS.stat(p);
      if (s2 && s2.lazy) throw new Error("没能从沙盒取回「" + baseOf(p) + "」，稍后再试");
      return get();
    });
  }
  // 文本（CSV、Markdown……）存成文本，别的 App、agent 的文本工具能直接读；其余存成二进制
  function writeFile(p, data) {
    FS.mkdirp(dirOf(p));
    if (typeof data === "string") FS.write(p, data); else FS.writeBinary(p, data);
    return FS.mirrorFlush ? Promise.resolve(FS.mirrorFlush()).catch(function () {}) : Promise.resolve();
  }

  // ======== 最近使用 ========
  var RECENT = "tsu-office-recent";
  function recent(app) {
    var r; try { r = JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch (e) { r = []; }
    return r.filter(function (x) { return (!app || x.app === app) && FS.exists(x.path); });
  }
  function addRecent(app, p) {
    var r; try { r = JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch (e) { r = []; }
    r = [{ app: app, path: p, t: Date.now() }].concat(r.filter(function (x) { return x.path !== p; })).slice(0, 40);
    localStorage.setItem(RECENT, JSON.stringify(r));
  }
  function clearRecent(app) {
    var r; try { r = JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch (e) { r = []; }
    localStorage.setItem(RECENT, JSON.stringify(r.filter(function (x) { return x.app !== app; })));
  }

  // ======== 图标（工具栏、检查器）========
  var P = function (d) { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>"; };
  var ICON = {
    sidebar: P('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M9.5 5v14"/>'),
    plus: P('<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/>'),
    table: P('<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9.7h17M3.5 14.3h17M9.2 5v14M14.8 5v14"/>'),
    chart: P('<path d="M4.5 19.5h15"/><rect x="6" y="11" width="3" height="6" rx=".8"/><rect x="10.5" y="7" width="3" height="10" rx=".8"/><rect x="15" y="9.5" width="3" height="7.5" rx=".8"/>'),
    text: P('<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8.5 8.5h7M12 8.5v8"/>'),
    shape: P('<rect x="3.5" y="9.5" width="10" height="10" rx="1.5"/><circle cx="15" cy="9" r="5.2"/>'),
    media: P('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4"/>'),
    comment: P('<path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-7l-4.5 3.2V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z"/>'),
    brush: P('<path d="M14.8 4.2l5 5-7.3 7.3-5-5z"/><path d="M7.4 11.6l-1.7 1.7c-1.2 1.2-.5 2.3-1.9 3.9 2.5.9 4.8.4 5.8-.8l1.3-1.2"/>'),
    doc: P('<path d="M7 3.5h6.5l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M13.5 3.5V8H18M8.5 12h7M8.5 15.5h7"/>'),
    sort: P('<path d="M4.5 7h9M4.5 12h7M4.5 17h5"/><path d="M17.5 5v14M15 16.5l2.5 2.5 2.5-2.5"/>'),
    sigma: P('<path d="M17 5.5H7l5.5 6.5L7 18.5h10"/>'),
    addPage: P('<path d="M7 3.5h6.5l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M11.7 10.5v6M8.7 13.5h6"/>'),
    addSlide: P('<rect x="3.5" y="5.5" width="17" height="12" rx="2"/><path d="M12 8.5v6M9 11.5h6"/>'),
    addSheet: P('<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9.5h17M9 9.5V19"/><path d="M15 12.5v4M13 14.5h4"/>'),
    play: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5.2v13.6c0 .6.6.9 1.1.6l10.2-6.8c.5-.3.5-.9 0-1.2L9.1 4.6c-.5-.3-1.1 0-1.1.6z" fill="currentColor"/></svg>',
    animate: P('<path d="M12 3.8l2.3 5.4 5.4 2.3-5.4 2.3L12 19.2l-2.3-5.4-5.4-2.3 5.4-2.3z"/>'),
    filter: P('<path d="M4.5 5.5h15l-5.8 7v5.3l-3.4 1.7v-7z"/>'),
    merge: P('<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7 12h10M9.5 9.5L7 12l2.5 2.5M14.5 9.5L17 12l-2.5 2.5"/>'),
    freeze: P('<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9.5h17M9 5v14" stroke-width="2.2"/>'),
    share: P('<path d="M12 4v11M8 7.5L12 4l4 3.5"/><path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H16"/>'),
    zoom: P('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>'),
    list: P('<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.8" cy="7" r=".9" fill="currentColor"/><circle cx="4.8" cy="12" r=".9" fill="currentColor"/><circle cx="4.8" cy="17" r=".9" fill="currentColor"/>'),
    presenter: P('<rect x="3.5" y="4.5" width="17" height="11" rx="2"/><path d="M12 15.5v4M8 19.5h8"/>'),
  };
  var CHEV = '<svg class="ofc-chev" viewBox="0 0 10 10" width="8" height="8"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ======== 控件（检查器、面板里用）：都返回元素，元素上有 set(值) ========
  var ui = {};
  ui.el = el;
  ui.esc = esc;
  ui.icon = ICON;
  ui.section = function (title, cls) { var s = el("div", "ofc-sec" + (cls ? " " + cls : "")); if (title) s.appendChild(el("div", "ofc-sec-h", esc(title))); return s; };
  ui.row = function (label) {
    var r = el("div", "ofc-row"), c = el("div", "ofc-row-c");
    if (label != null) r.appendChild(el("span", "ofc-row-l", esc(label)));
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) c.appendChild(arguments[i]);
    r.appendChild(c);
    return r;
  };
  // 弹出菜单：opts 是 [{ v, label }]，"-" 是分隔线（用不可选的一项代替）
  ui.select = function (opts, value, onChange, cls) {
    var s = el("select", "ofc-select" + (cls ? " " + cls : ""));
    s.setOptions = function (list) {
      s.textContent = "";
      list.forEach(function (o) {
        if (o === "-") { var sep = el("option", null, "──────────"); sep.disabled = true; s.appendChild(sep); return; }
        var op = el("option"); op.value = o.v; op.textContent = o.label; if (o.disabled) op.disabled = true; s.appendChild(op);
      });
    };
    s.setOptions(opts);
    s.set = function (v) {
      if (v == null) v = "";
      if (!Array.prototype.some.call(s.options, function (o) { return o.value === String(v); })) { s.selectedIndex = -1; s.dataset.mixed = "1"; return; }
      delete s.dataset.mixed;
      s.value = String(v);
    };
    s.set(value);
    s.addEventListener("change", function () { onChange(s.value); });
    return s;
  };
  // 步进器：数字输入框 + 上下两个小箭头；o：{ min, max, step, unit, digits, width }
  ui.stepper = function (value, o, onChange) {
    o = o || {};
    var w = el("div", "ofc-step"), inp = el("input"), up = el("button", "up"), dn = el("button", "dn"), cur = value;
    inp.type = "text";
    inp.spellcheck = false;
    if (o.width) w.style.width = o.width + "px";
    up.type = dn.type = "button";
    up.tabIndex = dn.tabIndex = -1;
    var fmt = function (v) { if (v == null || v === "" || isNaN(v)) return ""; var d = o.digits != null ? o.digits : 2, s = String(Math.round(v * Math.pow(10, d)) / Math.pow(10, d)); return s + (o.unit || ""); };
    var clamp = function (v) { if (o.min != null) v = Math.max(o.min, v); if (o.max != null) v = Math.min(o.max, v); return v; };
    var commit = function (v) { v = clamp(v); cur = v; inp.value = fmt(v); onChange(v); };
    var parse = function () { var v = parseFloat(String(inp.value).replace(/[^\d.\-]/g, "")); return isNaN(v) ? cur : v; };
    inp.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); commit(parse()); inp.select(); }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); commit((parse() || 0) + (e.key === "ArrowUp" ? 1 : -1) * (o.step || 1)); }
      if (e.key === "Escape") { inp.value = fmt(cur); inp.blur(); }
    });
    inp.addEventListener("change", function () { commit(parse()); });
    [up, dn].forEach(function (b) {
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      b.addEventListener("click", function () { commit((parse() || 0) + (b === up ? 1 : -1) * (o.step || 1)); });
    });
    w.appendChild(inp);
    var arrows = el("div", "ofc-step-a");
    arrows.appendChild(up);
    arrows.appendChild(dn);
    w.appendChild(arrows);
    w.set = function (v) { cur = v; if (document.activeElement !== inp) inp.value = fmt(v); };
    w.set(value);
    return w;
  };
  ui.check = function (label, checked, onChange) {
    var l = el("label", "ofc-check"), c = el("input");
    c.type = "checkbox";
    c.checked = !!checked;
    c.addEventListener("change", function () { onChange(c.checked); });
    l.appendChild(c);
    l.appendChild(el("span", null, esc(label)));
    l.set = function (v) { c.checked = !!v; c.indeterminate = v === null; };
    return l;
  };
  // 分段控件：items [{ v, label | icon, tip }]；o.multi：每段各自开关（加粗 / 倾斜……），onChange(v, on)
  ui.seg = function (items, value, onChange, o) {
    o = o || {};
    var g = el("div", "ofc-seg" + (o.cls ? " " + o.cls : ""));
    items.forEach(function (x) {
      var b = el("button", null, x.icon ? x.icon : esc(x.label));
      b.type = "button";
      b.dataset.v = x.v;
      if (x.tip || x.label) b.title = x.tip || x.label;
      if (x.style) b.setAttribute("style", x.style);
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      b.addEventListener("click", function () {
        if (o.multi) { var on = !b.classList.contains("on"); b.classList.toggle("on", on); onChange(x.v, on); }
        else { g.set(x.v); onChange(x.v); }
      });
      g.appendChild(b);
    });
    g.set = function (v) { Array.prototype.forEach.call(g.children, function (b) { b.classList.toggle("on", o.multi ? !!(v && v[b.dataset.v]) : b.dataset.v === String(v)); }); };
    g.set(value);
    return g;
  };
  ui.button = function (label, onClick, cls) {
    var b = el("button", "ofc-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  };
  // 颜色池：iWork 式的色板（灰阶 + 十个色系的深浅）+「自定颜色…」；o：{ none: "无填充"（可以不选颜色）, auto: "自动" }
  var PALETTE = [
    ["#ffffff", "#ebebeb", "#d6d6d6", "#c0c0c0", "#aaaaaa", "#929292", "#7a7a7a", "#5e5e5e", "#424242", "#000000"],
    ["#ffd8d6", "#ffe4c9", "#fff2c2", "#e4f5cf", "#d3f1e3", "#cdeef3", "#d6e7ff", "#dcdcfb", "#ecd9f6", "#fad7e6"],
    ["#ff8a80", "#ffb56b", "#ffe066", "#b5e27f", "#7fd8b0", "#6fd0e0", "#82b6ff", "#9e9cf2", "#cc98ea", "#f390bb"],
    ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#30b0c7", "#007aff", "#5856d6", "#af52de", "#ff2d55"],
    ["#c4221a", "#c46a00", "#b38f00", "#248a3d", "#008a84", "#1f7a8c", "#0055b3", "#3634a3", "#7a36a0", "#c4163f"],
    ["#801510", "#7a4200", "#6b5600", "#155724", "#00524e", "#10495a", "#003270", "#211f68", "#4b1f63", "#7c0e28"],
  ];
  ui.color = function (value, onChange, o) {
    o = o || {};
    var b = el("button", "ofc-cw"), sw = el("span", "ofc-cw-s"), cur = value;
    b.type = "button";
    b.appendChild(sw);
    b.insertAdjacentHTML("beforeend", CHEV);
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    b.addEventListener("click", function () {
      var box = el("div", "ofc-pal");
      if (o.none || o.auto) {
        var top = el("div", "ofc-pal-top");
        [o.auto && ["auto", o.auto], o.none && ["none", o.none]].filter(Boolean).forEach(function (x) {
          var t = el("button", "ofc-pal-none", esc(x[1]));
          t.type = "button";
          t.addEventListener("click", function () { pick(null); });
          top.appendChild(t);
        });
        box.appendChild(top);
      }
      PALETTE.forEach(function (row) {
        var r = el("div", "ofc-pal-row");
        row.forEach(function (c) {
          var s = el("button", "ofc-pal-c");
          s.type = "button";
          s.style.background = c;
          s.title = c;
          if (cur && cur.toLowerCase() === c) s.classList.add("on");
          s.addEventListener("click", function () { pick(c); });
          r.appendChild(s);
        });
        box.appendChild(r);
      });
      var more = el("label", "ofc-pal-more", "<span>自定颜色…</span>"), inp = el("input");
      inp.type = "color";
      inp.value = /^#[0-9a-f]{6}$/i.test(cur || "") ? cur : "#000000";
      inp.addEventListener("input", function () { cur = inp.value; paint(); onChange(inp.value); });
      more.appendChild(inp);
      box.appendChild(more);
      var pop = ui.popover(b, box);
      function pick(c) { cur = c; paint(); pop.close(); onChange(c); }
    });
    function paint() { sw.style.background = cur || ""; sw.classList.toggle("none", !cur); }
    b.set = function (v) { cur = v; paint(); };
    paint();
    return b;
  };
  // 气泡：挂在某个元素下面（放不下就放上面），点外面 / Esc 关
  var openPop = null;
  ui.popover = function (anchor, content, o) {
    o = o || {};
    if (openPop) openPop.close();
    var p = el("div", "ofc-pop" + (o.cls ? " " + o.cls : "")), r = anchor.getBoundingClientRect();
    p.appendChild(content);
    document.body.appendChild(p);
    var w = p.offsetWidth, h = p.offsetHeight, x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)), y = r.bottom + 8;
    if (y + h > window.innerHeight - 8) { y = Math.max(8, r.top - h - 8); p.classList.add("up"); }
    p.style.left = x + "px";
    p.style.top = y + "px";
    p.style.setProperty("--ax", Math.max(14, Math.min(w - 14, r.left + r.width / 2 - x)) + "px");
    var closed = false;
    var api = {
      el: p,
      close: function () {
        if (closed) return;
        closed = true;
        document.removeEventListener("mousedown", out, true);
        document.removeEventListener("keydown", key, true);
        p.remove();
        if (openPop === api) openPop = null;
        if (o.onClose) o.onClose();
      },
    };
    function out(e) { if (!p.contains(e.target) && !anchor.contains(e.target)) api.close(); }
    function key(e) { if (e.key === "Escape") { e.stopPropagation(); api.close(); } }
    setTimeout(function () { document.addEventListener("mousedown", out, true); document.addEventListener("keydown", key, true); });
    openPop = api;
    return api;
  };
  // 右键菜单 / 工具栏按钮的下拉菜单：用桌面的菜单（同菜单栏的样式、键盘操作）
  ui.menuAt = function (items, x, y) { return D.popup(items, { x: x, y: y }); };
  ui.menuBelow = function (anchor, items) { var r = anchor.getBoundingClientRect(); return D.popup(items, { x: r.left, y: r.bottom + 3 }); };

  // ======== 文稿 ========
  var docs = [];
  function Doc(impl, o) {
    this.impl = impl;
    this.path = o.path || null;          // 没有 = 未命名
    this.fmt = o.fmt || impl.native;       // 存到 path 时用的格式
    this.name = o.name || null;          // 未命名文稿的名字
    this.diskHash = o.hash || null;      // 磁盘上那份（我们上次读 / 写的）的指纹
    this.opened = o.bytes || null;       // 打开时的内容（「复原到」用）
    this.openedFmt = o.fmt || impl.native;
    this.seq = 0;
    this.savedSeq = 0;
    this.conflict = null;
    this.missing = false;
    this.slot = o.slot || null;          // 未命名文稿自动存在哪
    this.importedFrom = o.importedFrom || null;
    this.lossyOK = false;
  }
  Doc.prototype.label = function () {
    if (!this.path) return this.name || "未命名";
    return extOf(this.path) === this.impl.native ? stemOf(this.path) : baseOf(this.path);
  };
  Doc.prototype.dirty = function () { return this.seq !== this.savedSeq; };
  Doc.prototype.title = function () { return this.label() + (this.path && this.dirty() ? " — 已编辑" : ""); };
  Doc.prototype.changed = function () { this.seq++; updateTitle(this); scheduleAutosave(this); };
  Doc.prototype.refresh = function () { refreshToolbar(this); if (D.front() === this.win) D.refreshMenus(); };
  Doc.prototype.alert = function (o) { return D.alert(Object.assign({ window: this.win && this.win.el.id }, o)); };
  Doc.prototype.sheet = function (content, o) { return sheet(this, content, o); };
  Doc.prototype.showInspector = function (on) {
    if (on == null) on = !this.root.classList.contains("insp-on");
    this.root.classList.toggle("insp-on", !!on);
    if (this.view && this.view.resize) this.view.resize();
    this.refresh();
    return on;
  };
  Doc.prototype.inspectorOn = function () { return this.root.classList.contains("insp-on"); };
  Doc.prototype.front = function () { if (this.win) { if (this.win.state === "closed" || this.win.state === "min") this.win.show(); else this.win.front(); } };

  // ---- 窗口：一个 App 的窗口 id 是 numbers、numbers-2……；关掉的留着，下一个文稿接着用 ----
  var wins = {};
  function takeWindow(impl) {
    var list = wins[impl.id] || (wins[impl.id] = []);
    var w = list.find(function (x) { return x.state === "closed" && !x._ofc.doc; });
    if (w) return w;
    var id = list.length ? impl.id + "-" + (list.length + 1) : impl.id, root = el("div", "ofc ofc-" + impl.id);
    w = D.createWindow({
      id: id, app: impl.id, name: impl.name, className: "ofc-win ofc-win-" + impl.id, content: root,
      width: impl.width || 1000, height: impl.height || 680,
      title: function () { return w && w._ofc && w._ofc.doc ? w._ofc.doc.title() : impl.name; },
      menus: function () { return w && w._ofc && w._ofc.doc ? docMenus(w._ofc.doc) : []; },
      appMenu: function () { return appMenu(impl); },
      onClose: function () { released(w); },
      initial: function () { return cascade(impl, w); },
    });
    w._ofc = { root: root, doc: null };
    // 刷新后建回来用（桌面记下它）：开着哪份文稿；未命名的记它自动存的那一格
    w.sessionState = function () { var d = w._ofc.doc; return d ? (d.path ? { path: d.path } : d.slot ? { slot: d.slot } : null) : null; };
    D.onBeforeClose(id, function () { return w._ofc.doc ? closeDoc(w._ofc.doc) : true; });
    // 标题：点一下弹出「名称 / 位置」（同 macOS 文稿窗口的标题）；双击仍是缩放
    var bar = w.el.querySelector(".bar"), clickT = 0;
    bar.addEventListener("click", function (e) {
      var t = bar.querySelector(".ofc-title b"), doc = w._ofc.doc;
      if (!t || !doc) return;
      var r = t.getBoundingClientRect();
      if (e.clientX < r.left - 4 || e.clientX > r.right + 4 || e.clientY < r.top - 3 || e.clientY > r.bottom + 3) return;
      clearTimeout(clickT);
      clickT = setTimeout(function () { titlePopover(doc, t); }, 260);
    });
    bar.addEventListener("dblclick", function () { clearTimeout(clickT); });
    list.push(w);
    return w;
  }
  function cascade(impl, w) {
    var a = D.area(), W = Math.min(impl.width || 1000, a.width - 40), H = Math.min(impl.height || 680, a.height - 20);
    var others = (wins[impl.id] || []).filter(function (x) { return x !== w && x.state !== "closed" && x.state !== "min"; });
    var f = others[others.length - 1];
    if (f) { var r = f.rect(); return { left: Math.max(a.left, Math.min(r.left + 26, a.left + a.width - W)), top: Math.max(a.top, Math.min(r.top + 26, a.top + a.height - H)), width: W, height: H }; }
    return { left: a.left + Math.round((a.width - W) / 2), top: a.top + Math.max(10, Math.round((a.height - H) / 3)), width: W, height: H };
  }
  function appMenu(impl) {
    return [it("关于" + impl.name, "", function () {
      D.alert({ icon: "app", title: impl.name, message: impl.about || "", buttons: [{ label: "好", role: "default" }] });
    })];
  }

  // 把文稿装进一个窗口
  function mount(doc, state) {
    var impl = doc.impl, w = takeWindow(impl), root = w._ofc.root, bar = w.el.querySelector(".bar");
    root.textContent = "";
    root.className = "ofc ofc-" + impl.id;
    bar.querySelectorAll(".ofc-title, .ofc-tb").forEach(function (x) { x.remove(); });
    doc.win = w;
    doc.root = root;
    w._ofc.doc = doc;
    doc.titleEl = el("div", "ofc-title", "<b></b>");
    doc.tbEl = el("div", "ofc-tb");
    bar.appendChild(doc.titleEl);
    bar.appendChild(doc.tbEl);
    doc.bannerEl = el("div", "ofc-banner");
    doc.bannerEl.hidden = true;
    var main = el("div", "ofc-main");
    doc.viewEl = el("div", "ofc-view");
    doc.inspEl = el("div", "ofc-insp");
    main.appendChild(doc.viewEl);
    main.appendChild(doc.inspEl);
    root.appendChild(doc.bannerEl);
    root.appendChild(main);
    docs.push(doc);
    doc.view = impl.createView(doc, state);
    doc.viewEl.appendChild(doc.view.el);
    if (doc.view.inspector) doc.inspEl.appendChild(doc.view.inspector);
    // 检查器：记着上次开没开；手机上（html.ios）检查器是盖住半屏的面板，打开文稿时不自己弹出来
    if (doc.view.inspectorOpen !== false && doc.view.inspector && localStorage.getItem("tsu-office-insp-" + impl.id) !== "off" && !document.documentElement.classList.contains("ios")) root.classList.add("insp-on");
    renderToolbar(doc);
    updateTitle(doc);
    w.show();
    if (doc.view.mounted) doc.view.mounted();
    if (doc.view.focus) setTimeout(function () { doc.view.focus(); }, 30);
    return doc;
  }
  // 窗口关了：文稿收尾，窗口留给下一个
  function released(w) {
    var doc = w._ofc.doc;
    if (!doc) return;
    clearTimeout(doc.autoT);
    clearTimeout(doc.chkT);
    docs.splice(docs.indexOf(doc), 1);
    try { if (doc.view && doc.view.destroy) doc.view.destroy(); } catch (e) { console.error(e); }
    if (!document.documentElement.classList.contains("ios")) localStorage.setItem("tsu-office-insp-" + doc.impl.id, doc.inspectorOn() ? "on" : "off");
    doc.view = null;
    doc.closed = true;
    w._ofc.doc = null;
    setTimeout(function () { if (!w._ofc.doc) { w._ofc.root.textContent = ""; w.el.querySelectorAll(".bar .ofc-title, .bar .ofc-tb").forEach(function (x) { x.remove(); }); } }, 400);
  }
  function updateTitle(doc) {
    if (!doc.win || doc.closed) return;
    var t = doc.title();
    doc.win.setTitle(t);
    var b = doc.titleEl.querySelector("b");
    b.textContent = doc.label();
    doc.titleEl.classList.toggle("edited", !!(doc.path && doc.dirty()));
    doc.titleEl.dataset.state = doc.conflict || doc.missing ? "conflict" : "";
    var sub = doc.titleEl.querySelector("span");
    if (!sub) { sub = el("span"); doc.titleEl.appendChild(sub); }
    sub.textContent = doc.path && doc.dirty() ? " — 已编辑" : "";
  }

  // ---- 工具栏：[{ id, label, icon | text(), menu() | run(), on(), disabled(), tip }]、"sep"、"flex" ----
  function renderToolbar(doc) {
    var tb = doc.tbEl;
    tb.textContent = "";
    (doc.view.toolbar || []).forEach(function (x) {
      if (x === "sep") return tb.appendChild(el("span", "ofc-tb-sep"));
      if (x === "flex") return tb.appendChild(el("span", "ofc-tb-flex"));
      var b = el("button", "ofc-tbtn" + (x.cls ? " " + x.cls : ""));
      b.type = "button";
      b.dataset.id = x.id;
      b.title = x.tip || x.label;
      b.innerHTML = '<span class="ofc-tbi">' + (x.text ? '<b class="ofc-tbt"></b>' : ICON[x.icon] || x.icon || "") + (x.menu ? CHEV : "") + '</span><span class="ofc-tbl">' + esc(x.label) + "</span>";
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      b.addEventListener("click", function () {
        if (x.menu) { var items = x.menu(); if (items && items.length) ui.menuBelow(b, items); }
        else if (x.pop) x.pop(b);
        else if (x.run) x.run();
        refreshToolbar(doc);
      });
      x._el = b;
      tb.appendChild(b);
    });
    refreshToolbar(doc);
  }
  function refreshToolbar(doc) {
    if (!doc.view) return;
    (doc.view.toolbar || []).forEach(function (x) {
      if (!x || !x._el) return;
      x._el.classList.toggle("on", !!(x.on && x.on()));
      x._el.disabled = !!(x.disabled && x.disabled());
      if (x.text) x._el.querySelector(".ofc-tbt").textContent = x.text();
    });
  }

  // ---- 窗口里的表单（从工具栏下缘落下来）：存储面板、排序……；Esc = 取消 ----
  function sheet(doc, content, o) {
    o = o || {};
    var ov = el("div", "ofc-sheet-ov"), sh = el("div", "ofc-sheet" + (o.cls ? " " + o.cls : ""));
    sh.appendChild(content);
    ov.appendChild(sh);
    doc.root.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add("on"); });
    var done = false;
    var api = {
      el: sh,
      close: function () {
        if (done) return;
        done = true;
        ov.classList.remove("on");
        setTimeout(function () { ov.remove(); }, 200);
        if (o.onClose) o.onClose();
        if (doc.view && doc.view.focus) doc.view.focus();
      },
    };
    ov.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); if (o.onCancel) o.onCancel(); api.close(); }
    });
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) e.preventDefault(); });
    return api;
  }

  // ---- 提示条（窗口顶部）：外部修改、没能存储 ----
  function banner(doc, text, buttons, kind) {
    var b = doc.bannerEl;
    b.textContent = "";
    b.className = "ofc-banner" + (kind ? " " + kind : "");
    b.appendChild(el("span", "ofc-banner-t", esc(text)));
    buttons.forEach(function (x) {
      if (x.link) { var a = el("button", "ofc-banner-link", esc(x.label)); a.type = "button"; a.addEventListener("click", x.run); b.appendChild(a); return; }
      b.appendChild(ui.button(esc(x.label), x.run, x.primary ? "ofc-default" : ""));
    });
    var close = el("button", "ofc-banner-x", "✕");
    close.type = "button";
    close.title = "先不管";
    close.addEventListener("click", function () { b.hidden = true; if (doc.view && doc.view.resize) doc.view.resize(); });
    b.appendChild(close);
    b.hidden = false;
    if (doc.view && doc.view.resize) doc.view.resize();
  }
  function hideBanner(doc) { if (doc.bannerEl && !doc.bannerEl.hidden) { doc.bannerEl.hidden = true; if (doc.view && doc.view.resize) doc.view.resize(); } }

  // ======== 自动存储 ========
  // 改了以后停 1.5 秒写一次；一直在改的话最多 20 秒写一次。未命名的写到 ~/Library/Autosave Information 里自己的一格
  var canWrite = function (impl, ext) { return !!(impl.writes && impl.writes[ext]); };
  var lossy = function (impl, ext) { return impl.writes && impl.writes[ext] === "lossy"; };
  function scheduleAutosave(doc) {
    clearTimeout(doc.autoT);
    if (!doc.firstDirtyT) doc.firstDirtyT = Date.now();
    // 大文件转一次要好久（几万行的表格要一两秒），就等久一点再存，免得边打字边卡
    var idle = doc.lastSaveMs > 300 ? Math.min(30000, Math.max(4000, doc.lastSaveMs * 6)) : 1500, most = doc.lastSaveMs > 300 ? 60000 : 20000;
    var wait = doc.path ? Math.max(0, Math.min(idle, most - (Date.now() - doc.firstDirtyT))) : Math.max(3000, idle);
    doc.autoT = setTimeout(function () { autosave(doc); }, wait);
  }
  function autosave(doc) {
    if (doc.closed || !doc.view || !doc.dirty()) return;
    if (!doc.path) return saveSlot(doc);
    if (doc.conflict || doc.missing || !canWrite(doc.impl, doc.fmt) || lossy(doc.impl, doc.fmt)) return;
    save(doc).catch(function (e) {
      if (e && e.conflict) return;
      banner(doc, "没能自动存储「" + doc.label() + "」：" + e.message, [{ label: "再试一次", run: function () { hideBanner(doc); autosave(doc); } }, { label: "另存为…", run: function () { saveAs(doc); } }], "warn");
    });
  }
  // 存到 doc.path：先完整地转成文件内容（出错就什么都不写，磁盘上那份原样留着）；再看磁盘上的是不是还是上次那份；
  // 这次打开后第一次覆盖前，把原来那份拷一份到 Autosave Information（「复原到 → 打开时的版本」也能从那里拿）
  function save(doc, o) {
    o = o || {};
    if (doc.saving) return doc.saving.then(function () { return save(doc, o); }, function () { return save(doc, o); });
    var p = doc.path, fmt = doc.fmt, seq = doc.seq, t0 = Date.now();
    doc.saving = Promise.resolve().then(function () { return doc.view.serialize(fmt); }).then(function (data) {
      doc.lastSaveMs = Date.now() - t0;
      var bytes = toBytes(data), h = hash(bytes);
      return diskState(doc, p).then(function (cur) {
        if (cur.changed && !o.force) { var err = new Error("文件在别处被修改了"); err.conflict = true; doc.conflict = { hash: cur.hash }; showConflict(doc); throw err; }
        var pre = cur.bytes && !doc.backedUp ? backup(doc, cur.bytes, p) : Promise.resolve();
        return pre.then(function () {
          doc.pendingHash = h;
          return writeFile(p, typeof data === "string" ? data : bytes);
        }).then(function () {
          doc.diskHash = h;
          doc.pendingHash = null;
          doc.savedSeq = seq;
          doc.firstDirtyT = doc.dirty() ? Date.now() : 0;
          doc.conflict = null;
          doc.missing = false;
          hideBanner(doc);
          addRecent(doc.impl.id, p);
          updateTitle(doc);
          if (doc.dirty()) scheduleAutosave(doc);
        });
      });
    });
    doc.saving.then(null, function () {}).then(function () { doc.saving = null; });
    return doc.saving;
  }
  // 磁盘上那份现在的样子：{ changed（不是我们上次读 / 写的那份）, bytes, hash }
  function diskState(doc, p) {
    if (!FS.exists(p)) return Promise.resolve({ changed: !!doc.diskHash && p === doc.path, gone: true });
    return readBytes(p).then(function (u8) { var h = hash(u8); return { changed: h !== doc.diskHash, bytes: u8, hash: h }; });
  }
  function backupPath(p) { return AUTOSAVE + "/" + stemOf(p) + "（打开时的版本 " + hash(toBytes(p)).slice(0, 4) + "）." + extOf(p); }
  function backup(doc, bytes, p) {
    doc.backedUp = true;
    try { return writeFile(backupPath(p), bytes); } catch (e) { console.warn("没能留一份打开时的版本：", e); return Promise.resolve(); }
  }
  // 未命名的文稿：自动存在自己的一格里（不算「存储」，关窗口时照样问要不要存）
  var SLOTS = "tsu-office-untitled";
  function slotList() { try { return JSON.parse(localStorage.getItem(SLOTS) || "[]"); } catch (e) { return []; } }
  function setSlots(l) { localStorage.setItem(SLOTS, JSON.stringify(l)); }
  function saveSlot(doc) {
    if (!doc.slot) {
      var used = slotList().filter(function (x) { return x.app === doc.impl.id; }).map(function (x) { return x.path; }), n = 1, p;
      do { p = AUTOSAVE + "/未命名（" + doc.impl.name + " " + n++ + "）." + doc.impl.native; } while (used.indexOf(p) >= 0 || docs.some(function (d) { return d.slot === p; }));
      doc.slot = p;
    }
    var seq = doc.seq;
    return Promise.resolve().then(function () { return doc.view.serialize(doc.impl.native); }).then(function (data) {
      return writeFile(doc.slot, typeof data === "string" ? data : toBytes(data));
    }).then(function () {
      doc.slotSeq = seq;
      setSlots(slotList().filter(function (x) { return x.path !== doc.slot; }).concat([{ app: doc.impl.id, path: doc.slot, name: doc.label(), t: Date.now() }]));
    }).catch(function (e) { console.warn("未命名文稿没能自动存储：", e); });
  }
  function releaseSlot(doc) {
    if (!doc.slot) return;
    setSlots(slotList().filter(function (x) { return x.path !== doc.slot; }));
    doc.slot = null;
  }

  // ======== 外部修改：别的程序（agent、终端、访达）改了开着的文件 ========
  FS.onChange(function (path) {
    for (var i = 0; i < docs.length; i++) if (docs[i].path === path) queueCheck(docs[i]);
  });
  function queueCheck(doc) { clearTimeout(doc.chkT); doc.chkT = setTimeout(function () { checkDisk(doc); }, 250); }
  function checkDisk(doc) {
    if (doc.closed || !doc.path) return;
    if (doc.saving) { doc.saving.then(null, function () {}).then(function () { queueCheck(doc); }); return; }
    var p = doc.path;
    if (!FS.exists(p)) {
      if (!doc.missing) { doc.missing = true; updateTitle(doc); showMissing(doc); }
      return;
    }
    var st = FS.stat(p) || {};
    if (st.lazy) { FS.ensureLoaded([p]); return; } // 取回来后会再来一次
    readBytes(p).then(function (u8) {
      if (doc.closed || doc.path !== p) return;
      var h = hash(u8);
      if (doc.missing) { doc.missing = false; hideBanner(doc); }
      if (h === doc.diskHash || h === doc.pendingHash) { if (doc.conflict) { doc.conflict = null; hideBanner(doc); } updateTitle(doc); return; }
      doc.conflict = { hash: h };
      updateTitle(doc);
      if (!doc.dirty() && localStorage.getItem("tsu-office-autoreload") === "on") return reload(doc, u8, true);
      showConflict(doc);
    }, function () {});
  }
  function showConflict(doc) {
    var mine = doc.dirty();
    banner(doc, "「" + doc.label() + "」在别处被修改了（可能是 agent 或终端）" + (mine ? "，你这边也有还没存储的修改。" : "。"), [
      { label: "重新载入", primary: !mine, run: function () { reload(doc); } },
      { label: "保留我的版本", run: function () { keepMine(doc); } },
      { label: "另存为…", run: function () { saveAs(doc); } },
    ].concat(mine ? [] : [{ link: true, label: "以后自动载入", run: function () { localStorage.setItem("tsu-office-autoreload", "on"); reload(doc); } }]), "conflict");
  }
  function showMissing(doc) {
    banner(doc, "「" + doc.label() + "」已不在原来的位置（被移走、改名或删除了）。", [
      { label: "存回原处", run: function () { doc.missing = false; save(doc, { force: true }).catch(function (e) { doc.alert({ title: "没能存储", message: e.message, icon: "caution" }); }); } },
      { label: "另存为…", primary: true, run: function () { saveAs(doc); } },
    ], "conflict");
  }
  function keepMine(doc) {
    doc.alert({ title: "用你的版本覆盖「" + doc.label() + "」？", message: "别处做的修改会被替换掉（替换前的那份会留在 ~/Library/Autosave Information 里）。", icon: "caution",
      buttons: [{ label: "取消", role: "cancel" }, { label: "覆盖", role: "destructive" }] }).then(function (b) {
      if (b !== "覆盖") return;
      var p = doc.path;
      readBytes(p).then(function (u8) { return writeFile(AUTOSAVE + "/" + stemOf(p) + "（被覆盖的版本 " + (function (d) { var z = function (n) { return (n < 10 ? "0" : "") + n; }; return d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + "-" + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds()); })(new Date()) + "）." + extOf(p), u8); }, function () {})
        .then(function () { return save(doc, { force: true }); })
        .catch(function (e) { doc.alert({ title: "没能存储", message: e.message, icon: "caution" }); });
    });
  }
  // 重新载入：丢掉这边没存的修改，换成磁盘上的
  function reload(doc, bytes, quiet) {
    var go = function () {
      return (bytes ? Promise.resolve(bytes) : readBytes(doc.path)).then(function (u8) {
        return Promise.resolve(doc.impl.read(u8, extOf(doc.path), doc.path)).then(function (state) {
          if (doc.closed) return;
          doc.view.replace(state);
          doc.diskHash = hash(u8);
          doc.seq = doc.savedSeq = doc.seq + 1;
          doc.conflict = null;
          doc.firstDirtyT = 0;
          hideBanner(doc);
          updateTitle(doc);
          doc.refresh();
          if (quiet) toast(doc, "已载入别处做的修改");
        });
      }).catch(function (e) { doc.alert({ title: "没能重新载入「" + doc.label() + "」", message: e.message, icon: "caution" }); });
    };
    if (!doc.dirty()) return go();
    return doc.alert({ title: "重新载入会丢掉你还没存储的修改。", message: "要改用磁盘上的版本吗？", icon: "caution", buttons: [{ label: "取消", role: "cancel" }, { label: "重新载入", role: "destructive" }] })
      .then(function (b) { if (b === "重新载入") return go(); });
  }
  function toast(doc, text) {
    var t = el("div", "ofc-toast", esc(text));
    doc.root.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("on"); });
    setTimeout(function () { t.classList.remove("on"); setTimeout(function () { t.remove(); }, 300); }, 2400);
  }

  // ======== 存储 / 存储为 / 导出 ========
  function cmdSave(doc) {
    if (!doc.path) return saveAs(doc);
    if (!canWrite(doc.impl, doc.fmt)) return saveAs(doc);
    if (doc.conflict) return showConflict(doc);
    if (lossy(doc.impl, doc.fmt) && !doc.lossyOK) {
      var F = doc.fmt.toUpperCase();
      return doc.alert({ title: "要以 " + F + " 格式存储「" + doc.label() + "」吗？", message: (doc.impl.lossyNote && doc.impl.lossyNote(doc.fmt)) || "有些格式存不进这种文件。", icon: "caution",
        buttons: [{ label: "取消", role: "cancel" }, { label: "存储为 ." + doc.impl.native + "…" }, { label: "使用 " + F, role: "default" }] }).then(function (b) {
        if (b === "使用 " + F) { doc.lossyOK = true; return cmdSave(doc); }
        if (b && b.indexOf("存储为") === 0) return saveAs(doc, { fmt: doc.impl.native });
      });
    }
    return save(doc).catch(function (e) { if (!e.conflict) doc.alert({ title: "没能存储「" + doc.label() + "」", message: e.message, icon: "caution" }); });
  }
  // 存储为（o.export：导出一份，文稿仍对应原来的文件）
  function saveAs(doc, o) {
    o = o || {};
    var impl = doc.impl, formats = o.export ? impl.exportFormats : impl.saveFormats;
    var stem = doc.path ? stemOf(doc.path) : doc.importedFrom ? stemOf(doc.importedFrom) : doc.label();
    var dir = doc.path ? dirOf(doc.path) : doc.importedFrom ? dirOf(doc.importedFrom) : DOCS;
    return savePanel(doc, { title: o.export ? "导出" : doc.path ? "存储为" : "存储", button: o.export ? "导出" : "存储", name: stem, dir: dir, formats: formats, fmt: o.fmt || (o.export ? formats[0].ext : impl.native) }).then(function (r) {
      if (!r) return false;
      if (r.fmt === "pdf") return exportPDF(doc, r.path);
      if (o.export) {
        return Promise.resolve(doc.view.serialize(r.fmt)).then(function (data) { return writeFile(r.path, typeof data === "string" ? data : toBytes(data)); })
          .then(function () { toast(doc, "已导出到 " + tilde(r.path)); return true; })
          .catch(function (e) { doc.alert({ title: "没能导出", message: e.message, icon: "caution" }); return false; });
      }
      var prev = { path: doc.path, fmt: doc.fmt, diskHash: doc.diskHash, backedUp: doc.backedUp };
      doc.path = r.path;
      doc.fmt = r.fmt;
      doc.diskHash = FS.exists(r.path) ? "replace" : null; // 替换已有的文件：面板里已经问过了
      doc.backedUp = !FS.exists(r.path);
      doc.conflict = null;
      doc.missing = false;
      doc.lossyOK = true;
      doc.seq++;
      return save(doc, { force: true }).then(function () {
        releaseSlot(doc);
        doc.importedFrom = null;
        updateTitle(doc);
        doc.refresh();
        return true;
      }, function (e) {
        Object.assign(doc, prev);
        updateTitle(doc);
        doc.alert({ title: "没能存储", message: e.message, icon: "caution" });
        return false;
      });
    });
  }
  // 存储面板：名称、位置（常用文件夹 + 展开后逐级挑）、格式；目标已存在 → 问要不要替换
  function savePanel(doc, o) {
    return new Promise(function (resolve) {
      var box = el("div", "ofc-save");
      box.innerHTML =
        '<div class="ofc-save-f"><label>存储为：</label><input class="ofc-in" data-k="name" spellcheck="false" autocomplete="off"></div>' +
        '<div class="ofc-save-f"><label>位置：</label><select class="ofc-select" data-k="dir"></select><button type="button" class="ofc-btn ofc-save-exp" title="展开">' + CHEV + "</button></div>" +
        '<div class="ofc-save-br" hidden><div class="ofc-save-nav"><button type="button" class="ofc-btn" data-k="up">‹ 上一级</button><span class="ofc-save-here"></span><button type="button" class="ofc-btn" data-k="mkdir">新建文件夹</button></div><div class="ofc-save-dirs"></div></div>' +
        '<div class="ofc-save-f"><label>文件格式：</label><select class="ofc-select" data-k="fmt"></select></div>' +
        '<div class="ofc-save-b"><button type="button" class="ofc-btn" data-k="cancel">取消</button><button type="button" class="ofc-btn ofc-default" data-k="ok"></button></div>';
      var q = function (k) { return box.querySelector('[data-k="' + k + '"]'); };
      var name = q("name"), dirSel = q("dir"), fmtSel = q("fmt"), br = box.querySelector(".ofc-save-br"), cur = o.dir && FS.isDir(o.dir) ? o.dir : DOCS;
      q("ok").textContent = o.button || "存储";
      name.value = o.name || "未命名";
      (o.formats || []).forEach(function (f) { var op = el("option"); op.value = f.ext; op.textContent = f.label + "（." + f.ext + "）"; fmtSel.appendChild(op); });
      fmtSel.value = o.fmt || (o.formats[0] && o.formats[0].ext);
      function places() {
        var std = [["文稿", DOCS], ["桌面", HOME + "/Desktop"], ["下载", HOME + "/Downloads"], ["个人", HOME]], seen = {}, out = [];
        std.forEach(function (x) { seen[x[1]] = 1; out.push(x); });
        [cur].concat(recent().map(function (r) { return dirOf(r.path); })).forEach(function (d) { if (!seen[d] && FS.isDir(d)) { seen[d] = 1; out.push([tilde(d), d]); } });
        return out;
      }
      function renderDirs() {
        dirSel.textContent = "";
        places().forEach(function (x) { var op = el("option"); op.value = x[1]; op.textContent = x[0]; dirSel.appendChild(op); });
        dirSel.value = cur;
        box.querySelector(".ofc-save-here").textContent = tilde(cur);
        var list = box.querySelector(".ofc-save-dirs");
        list.textContent = "";
        var subs = [];
        try { subs = FS.list(cur).filter(function (p) { return FS.isDir(p) && baseOf(p)[0] !== "."; }); } catch (e) { subs = []; }
        if (!subs.length) list.appendChild(el("div", "ofc-save-empty", "（没有子文件夹）"));
        subs.forEach(function (p) {
          var r = el("div", "ofc-save-dir", '<span class="ofc-fold"></span>' + esc(baseOf(p)));
          r.addEventListener("click", function () { cur = p; renderDirs(); });
          list.appendChild(r);
        });
      }
      renderDirs();
      dirSel.addEventListener("change", function () { cur = dirSel.value; renderDirs(); });
      box.querySelector(".ofc-save-exp").addEventListener("click", function () { br.hidden = !br.hidden; box.classList.toggle("wide", !br.hidden); });
      q("up").addEventListener("click", function () { if (cur !== "/") { cur = dirOf(cur); renderDirs(); } });
      q("mkdir").addEventListener("click", function () {
        var n = window.prompt("新文件夹的名称：", "未命名文件夹");
        if (!n || /\//.test(n)) return;
        try { FS.mkdirp(cur + "/" + n); cur = cur + "/" + n; renderDirs(); } catch (e) { doc.alert({ title: "没能新建文件夹", message: e.message, icon: "caution" }); }
      });
      var sh = sheet(doc, box, { cls: "ofc-sheet-save", onCancel: function () { resolve(null); } });
      function finish() {
        var n = name.value.trim().replace(/\.(xlsx|xlsm|csv|tsv|docx|md|txt|html|pptx|pdf)$/i, "");
        if (!n || /[\/\u0000]/.test(n)) { name.classList.add("bad"); name.focus(); return; }
        var ext = fmtSel.value, p = cur + "/" + n + "." + ext;
        if (ext === "pdf" && !pdfFiles()) { sh.close(); return resolve({ path: p, fmt: ext }); } // 浏览器里 PDF 走打印对话框，不在这里存文件
        var go = function () { sh.close(); resolve({ path: p, fmt: ext }); };
        if (FS.exists(p) && p !== doc.path) {
          D.alert({ window: doc.win.el.id, title: "“" + baseOf(p) + "”已存在。要替换它吗？", message: "替换前的那份会留在 ~/Library/Autosave Information 里。", icon: "caution",
            buttons: [{ label: "取消", role: "cancel" }, { label: "替换", role: "destructive" }] }).then(function (b) { if (b === "替换") go(); });
        } else go();
      }
      q("ok").addEventListener("click", finish);
      q("cancel").addEventListener("click", function () { sh.close(); resolve(null); });
      name.addEventListener("keydown", function (e) { name.classList.remove("bad"); if (e.key === "Enter") { e.preventDefault(); finish(); } });
      setTimeout(function () { name.focus(); name.select(); }, 60);
    });
  }
  function rename(doc) {
    if (!doc.path) return saveAs(doc);
    var n = window.prompt("新名称：", stemOf(doc.path));
    if (!n || n === stemOf(doc.path) || /[\/\u0000]/.test(n)) return;
    var to = dirOf(doc.path) + "/" + n + "." + extOf(doc.path);
    if (FS.exists(to)) return doc.alert({ title: "“" + baseOf(to) + "”已存在。", message: "换个名称再试。", icon: "caution" });
    try { FS.move(doc.path, to); } catch (e) { return doc.alert({ title: "没能重新命名", message: e.message, icon: "caution" }); }
    doc.path = to;
    addRecent(doc.impl.id, to);
    updateTitle(doc);
    doc.refresh();
  }
  function revert(doc) {
    if (!doc.opened) return;
    doc.alert({ title: "复原到打开时的版本？", message: "现在的内容会被换掉（可以用「撤销」找回来的只有编辑，复原本身也能再撤回：打开时的那份一直留着）。", icon: "caution",
      buttons: [{ label: "取消", role: "cancel" }, { label: "复原", role: "default" }] }).then(function (b) {
      if (b !== "复原") return;
      Promise.resolve(doc.impl.read(doc.opened, doc.openedFmt, doc.path)).then(function (state) { doc.view.replace(state); doc.changed(); doc.refresh(); })
        .catch(function (e) { doc.alert({ title: "没能复原", message: e.message, icon: "caution" }); });
    });
  }
  function download(doc, fmt) {
    return Promise.resolve(doc.view.serialize(fmt)).then(function (data) {
      var name = (doc.path ? stemOf(doc.path) : doc.label()) + "." + fmt;
      var blob = new Blob([typeof data === "string" ? data : toBytes(data)], { type: MIME[fmt] || "application/octet-stream" }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
    }).catch(function (e) { doc.alert({ title: "没能下载", message: e.message, icon: "caution" }); });
  }
  function upload(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = accept || "";
      inp.style.display = "none";
      document.body.appendChild(inp);
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0];
        inp.remove();
        if (!f) return resolve(null);
        f.arrayBuffer().then(function (b) { resolve({ name: f.name, bytes: new Uint8Array(b) }); });
      });
      inp.click();
    });
  }
  // 从电脑导入：放进 ~/Documents（同名就加个号），然后打开
  function importLocal(impl, dir) {
    return upload((impl.opens || []).map(function (e) { return "." + e; }).join(",")).then(function (f) {
      if (!f) return;
      var ext = extOf(f.name), p = uniquePath(dir || DOCS, stemOf(f.name), ext);
      if ((impl.opens || []).indexOf(ext) < 0) return D.alert({ title: impl.name + "打不开 ." + ext + " 文件", icon: "caution" });
      return writeFile(p, f.bytes).then(function () { return openPath(impl, p); });
    });
  }
  // 打印 / 导出 PDF：各 App 的 view.printable() 给出要印的 { html, css（带 @page）, page?, landscape?, margin? }，交给 pdf.js（TSU_PDF）
  // 打印：App 里是 macOS 的打印对话框，浏览器里是浏览器的（只印这份文稿）
  function print(doc) {
    return Promise.resolve(doc.view.printable()).then(function (pr) {
      if (window.TSU_PDF) return TSU_PDF.print(pdfOpts(doc, pr));
      printHTML(doc.label(), pr.html, pr.css || "");
    }).catch(function (e) { doc.alert({ title: "没能打印", message: e.message, icon: "caution" }); });
  }
  var pdfFiles = function () { return !!(window.TSU_PDF && TSU_PDF.native); }; // 能直接出 PDF 文件（在 Paimon App 里）
  function pdfOpts(doc, pr, more) { return Object.assign({ title: doc.label(), html: pr.html, css: pr.css || "", page: pr.page, landscape: pr.landscape, margin: pr.margin }, more || {}); }
  // 导出 PDF：存成真的 PDF 文件（存储面板里选的名称、位置；替换已有的面板里问过了），发通知，点一下在访达里显示。浏览器里出不了文件：打开打印对话框
  function exportPDF(doc, path) {
    if (!pdfFiles()) return print(doc).then(function () { return false; });
    toast(doc, "正在导出 PDF…");
    return Promise.resolve(doc.view.printable()).then(function (pr) {
      return TSU_PDF.save(pdfOpts(doc, pr, { path: path, replace: true, app: doc.impl.id }));
    }).then(function (p) { if (p) toast(doc, "已导出到 " + tilde(p)); return !!p; })
      .catch(function (e) { doc.alert({ title: "没能导出 PDF", message: e.message, icon: "caution" }); return false; });
  }
  function printHTML(title, html, css) {
    if (window.TSU_PDF) return TSU_PDF.print({ title: title, html: html, css: css });
    var fr = document.createElement("iframe");
    fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(fr);
    var d = fr.contentDocument;
    d.open();
    d.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + "</title><style>" + css + "</style></head><body>" + html + "</body></html>");
    d.close();
    var go = function () { try { fr.contentWindow.focus(); fr.contentWindow.print(); } finally { setTimeout(function () { fr.remove(); }, 1500); } };
    var imgs = Array.prototype.slice.call(d.images), left = imgs.length;
    if (!left) return setTimeout(go, 80);
    var one = function () { if (--left === 0) setTimeout(go, 80); };
    imgs.forEach(function (im) { if (im.complete) one(); else { im.onload = im.onerror = one; } });
  }
  function reveal(p) { if (p && window.TSU_FINDER && TSU_FINDER.open) TSU_FINDER.open(p); }

  // 标题上的气泡：名称（改名）、位置、格式
  function titlePopover(doc, anchor) {
    var box = el("div", "ofc-tpop");
    box.innerHTML = '<div class="ofc-tpop-r"><label>名称</label><input class="ofc-in" spellcheck="false"></div>' +
      '<div class="ofc-tpop-r"><label>位置</label><span class="ofc-tpop-v"></span></div><div class="ofc-tpop-r"><label>格式</label><span class="ofc-tpop-f"></span></div>' +
      '<div class="ofc-tpop-b"></div>';
    var inp = box.querySelector("input");
    inp.value = doc.path ? stemOf(doc.path) : doc.label();
    box.querySelector(".ofc-tpop-v").textContent = doc.path ? tilde(dirOf(doc.path)) : "还没有存储";
    box.querySelector(".ofc-tpop-f").textContent = "." + (doc.path ? doc.fmt : doc.impl.native) + (doc.path && lossy(doc.impl, doc.fmt) ? "（只存数据）" : "");
    var btns = box.querySelector(".ofc-tpop-b");
    if (doc.path) btns.appendChild(ui.button("在访达中显示", function () { pop.close(); reveal(doc.path); }));
    else btns.appendChild(ui.button("存储…", function () { pop.close(); saveAs(doc); }, "ofc-default"));
    var pop = ui.popover(anchor, box);
    inp.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key !== "Enter") return;
      e.preventDefault();
      var n = inp.value.trim();
      pop.close();
      if (!n) return;
      if (!doc.path) { doc.name = n; updateTitle(doc); return; }
      if (n === stemOf(doc.path) || /[\/\u0000]/.test(n)) return;
      var to = dirOf(doc.path) + "/" + n + "." + extOf(doc.path);
      if (FS.exists(to)) return doc.alert({ title: "“" + baseOf(to) + "”已存在。", icon: "caution" });
      try { FS.move(doc.path, to); doc.path = to; addRecent(doc.impl.id, to); updateTitle(doc); doc.refresh(); } catch (err) { doc.alert({ title: "没能重新命名", message: err.message, icon: "caution" }); }
    });
    setTimeout(function () { inp.focus(); inp.select(); }, 30);
  }

  // ======== 菜单 ========
  function docMenus(doc) {
    var own = doc.view && doc.view.menus ? doc.view.menus() : [];
    return [fileMenu(doc)].concat(own);
  }
  function fileMenu(doc) {
    var impl = doc.impl, rec = recent(impl.id).slice(0, 10);
    var exp = impl.exportFormats || [];
    return { title: "文件", items: [
      it("新建…", "⌥⌘N", function () { browser(impl, "new"); }),
      it("打开…", "⌘O", function () { browser(impl, "open"); }),
      it("打开最近使用", "", null, { items: rec.length ? rec.map(function (r) { return it(baseOf(r.path), "", function () { openPath(impl, r.path); }); }).concat([SEP, it("清除菜单", "", function () { clearRecent(impl.id); })]) : [it("无", "", null, { disabled: true })] }),
      SEP,
      it("关闭", "", function () { D.close(doc.win.el.id); }),
      it("存储", "⌘S", function () { cmdSave(doc); }),
      it("存储为…", "⇧⌘S", function () { saveAs(doc); }),
      it("重新命名…", "", function () { rename(doc); }, { disabled: !doc.path }),
      it("复原到打开时的版本", "", function () { revert(doc); }, { disabled: !doc.opened }),
      SEP,
      it("导出为", "", null, { items: exp.map(function (f) { return it(f.label + "…", "", function () { if (f.ext === "pdf" && !pdfFiles()) print(doc); else saveAs(doc, { export: true, fmt: f.ext }); }); }) }),
      it("下载到电脑", "", null, { items: exp.filter(function (f) { return f.ext !== "pdf"; }).map(function (f) { return it(f.label + "（." + f.ext + "）", "", function () { download(doc, f.ext); }); }) }),
      it("从电脑导入…", "", function () { importLocal(impl); }),
      SEP,
      it("在访达中显示", "", function () { reveal(doc.path); }, { disabled: !doc.path || !window.TSU_FINDER }),
      it("打印…", "⌘P", function () { print(doc); }),
    ] };
  }
  // 点菜单栏之前先让桌面按现在的状态重算一遍菜单（勾选、可用与否）
  document.addEventListener("mousedown", function (e) {
    var f = D.front && D.front();
    if (f && f._ofc && e.target.closest && e.target.closest("#menubar")) D.refreshMenus();
  }, true);

  // ======== 关窗口：未命名的问要不要存；有路径的先把没写下去的写完；有冲突的问 ========
  function closeDoc(doc) {
    clearTimeout(doc.autoT);
    var impl = doc.impl;
    if (!doc.path) {
      if (!doc.dirty() && !doc.touched) { releaseSlot(doc); return true; }
      return doc.alert({ title: "要存储对文稿“" + doc.label() + "”所做的更改吗？", message: "如果不存储，你的更改将会丢失。", icon: "caution",
        buttons: [{ label: "删除", role: "destructive" }, { label: "取消", role: "cancel" }, { label: "存储…", role: "default" }] }).then(function (b) {
        if (b === "删除") { releaseSlot(doc); return true; }
        if (b === "存储…") return saveAs(doc).then(function (ok) { return !!ok; });
        return false;
      });
    }
    if (!doc.dirty()) return true;
    if (doc.conflict || doc.missing) {
      return doc.alert({ title: "“" + doc.label() + "”在别处被修改或移走了，你的更改还没有存储。", icon: "caution",
        buttons: [{ label: "不存储", role: "destructive" }, { label: "取消", role: "cancel" }, { label: "另存为…", role: "default" }] }).then(function (b) {
        if (b === "不存储") return true;
        if (b === "另存为…") return saveAs(doc).then(function (ok) { return !!ok; });
        return false;
      });
    }
    if (!canWrite(impl, doc.fmt) || lossy(impl, doc.fmt)) {
      return doc.alert({ title: "要存储对“" + doc.label() + "”所做的更改吗？", message: canWrite(impl, doc.fmt) ? "这是 ." + doc.fmt + " 文件：" + ((impl.lossyNote && impl.lossyNote(doc.fmt)) || "有些格式存不进去。") : "", icon: "caution",
        buttons: [{ label: "不存储", role: "destructive" }, { label: "取消", role: "cancel" }, { label: "存储", role: "default" }] }).then(function (b) {
        if (b === "不存储") return true;
        if (b !== "存储") return false;
        doc.lossyOK = true;
        if (!canWrite(impl, doc.fmt)) return saveAs(doc).then(function (ok) { return !!ok; });
        return save(doc).then(function () { return true; }, function (e) { doc.alert({ title: "没能存储", message: e.message, icon: "caution" }); return false; });
      });
    }
    return save(doc).then(function () { return true; }, function (e) {
      if (e && e.conflict) return false;
      return doc.alert({ title: "没能存储“" + doc.label() + "”", message: e.message, icon: "caution", buttons: [{ label: "不存储", role: "destructive" }, { label: "取消", role: "cancel" }] })
        .then(function (b) { return b === "不存储"; });
    });
  }

  // ======== 打开 / 新建 ========
  function openPath(impl, p) {
    var d = docs.find(function (x) { return x.path === p; });
    if (d) { d.front(); return Promise.resolve(d); }
    var ext = extOf(p);
    if ((impl.opens || []).indexOf(ext) < 0) {
      return D.alert({ title: impl.name + "打不开“" + baseOf(p) + "”", message: "支持的格式：" + impl.opens.map(function (e) { return "." + e; }).join(" "), icon: "caution" });
    }
    return readBytes(p).then(function (u8) {
      return Promise.resolve(impl.read(u8, ext, p)).then(function (state) {
        // 文件里有存不回去的部件（图表……）：当成导入的——改了另存一份，原文件不动
        var lost = state && state.unsupported && state.unsupported.length ? state.unsupported : null;
        var writable = canWrite(impl, ext) && !lost;
        var doc = new Doc(impl, writable ? { path: p, fmt: ext, hash: hash(u8), bytes: u8 } : { name: stemOf(p), bytes: u8, importedFrom: p, fmt: impl.native });
        doc.openedFmt = ext;
        mount(doc, state);
        if (lost) banner(doc, "这个文件里有" + lost.join("、") + "，" + impl.name + "显示不了、也存不回去；改了会另存成一份新的，原文件不动。", [], "warn");
        addRecent(impl.id, p);
        if (browsers[impl.id]) browsers[impl.id].win.hide("closed");
        return doc;
      });
    }).catch(function (e) {
      console.error(e);
      D.alert({ title: "无法打开“" + baseOf(p) + "”", message: e.message || String(e), icon: "caution" });
      throw e;
    });
  }
  function nextUntitled() {
    var used = {};
    docs.forEach(function (d) { if (!d.path) used[d.label()] = 1; });
    if (!used["未命名"]) return "未命名";
    for (var n = 2; ; n++) if (!used["未命名 " + n]) return "未命名 " + n;
  }
  function newDoc(impl, tpl) {
    return Promise.resolve(impl.newState(tpl)).then(function (state) {
      var doc = new Doc(impl, { name: nextUntitled() });
      mount(doc, state);
      if (browsers[impl.id]) browsers[impl.id].win.hide("closed");
      return doc;
    }).catch(function (e) { console.error(e); D.alert({ title: "没能新建文稿", message: e.message, icon: "caution" }); });
  }
  // 页面重开后第一次打开这个 App：把上次没存的未命名文稿找回来
  var restored = {};
  function restoreUntitled(impl) {
    if (restored[impl.id]) return Promise.resolve(0);
    restored[impl.id] = true;
    var list = slotList().filter(function (x) { return x.app === impl.id && FS.exists(x.path) && !docs.some(function (d) { return d.slot === x.path; }); });
    return Promise.all(list.map(function (x) {
      return readBytes(x.path).then(function (u8) { return impl.read(u8, extOf(x.path), x.path); }).then(function (state) {
        var doc = new Doc(impl, { name: x.name || nextUntitled(), slot: x.path });
        doc.touched = true;
        mount(doc, state);
        return 1;
      }).catch(function (e) { console.warn("找不回未命名文稿 " + x.path + "：", e); return 0; });
    })).then(function (r) { return r.reduce(function (a, b) { return a + b; }, 0); });
  }
  // 刷新后把上次开着的窗口建回来（桌面给 [{ id, state }]，state 是窗口的 sessionState()）：按窗口号的先后开（桌面按 id 摆回原来的位置）
  function restoreWins(impl, wins) {
    var num = function (id) { var m = /-(\d+)$/.exec(id); return m ? +m[1] : 1; };
    var list = (wins || []).filter(function (w) { return w && w.state; }).sort(function (a, b) { return num(a.id) - num(b.id); });
    if (!list.length) return launch(impl);
    var chain = Promise.resolve();
    list.forEach(function (w) {
      chain = chain.then(function () {
        if (w.state.path) return FS.exists(w.state.path) ? openPath(impl, w.state.path).catch(function () {}) : null;
        if (w.state.browser) return browser(impl, w.state.browser);
      });
    });
    if (list.some(function (w) { return w.state.slot; })) chain = chain.then(function () { return restoreUntitled(impl); });
    return chain;
  }
  function launch(impl) {
    var open = docs.filter(function (d) { return d.impl === impl; });
    if (open.length) { open.forEach(function (d) { d.front(); }); return Promise.resolve(); }
    return restoreUntitled(impl).then(function (n) { if (!n) browser(impl, recent(impl.id).length ? "open" : "new"); });
  }

  // ======== 文稿浏览器：新建（模板）/ 最近使用 / 文件夹；同 iWork 启动时的那个窗口 ========
  var browsers = {};
  function browser(impl, mode) {
    var B = browsers[impl.id] || (browsers[impl.id] = makeBrowser(impl));
    B.go(mode === "open" ? (recent(impl.id).length ? "recent" : DOCS) : "new");
    if (B.win.state === "closed" || B.win.state === "min") B.win.show(); else B.win.front();
    setTimeout(function () { B.grid.focus(); }, 50);
    return B;
  }
  function docIcon(ext, big) {
    return '<span class="ofc-dico ofc-dico-' + esc(ext) + (big ? " big" : "") + '"><b>' + esc(ext.toUpperCase()) + "</b></span>";
  }
  function makeBrowser(impl) {
    var root = el("div", "ofc-br ofc-br-" + impl.id), where = "new", sel = null, q = "";
    root.innerHTML =
      '<div class="ofc-br-side"><div class="ofc-br-sh">新建</div><div class="ofc-br-it" data-go="new"><span class="ofc-br-ic">＋</span>选取模板</div>' +
      '<div class="ofc-br-sh">打开</div><div class="ofc-br-it" data-go="recent"><span class="ofc-br-ic">◷</span>最近使用</div>' +
      '<div class="ofc-br-sh">位置</div>' +
      [["文稿", DOCS], ["桌面", HOME + "/Desktop"], ["下载", HOME + "/Downloads"], ["个人", HOME]].map(function (x) { return '<div class="ofc-br-it" data-go="' + esc(x[1]) + '"><span class="ofc-br-ic ofc-fold"></span>' + x[0] + "</div>"; }).join("") +
      '</div><div class="ofc-br-main"><div class="ofc-br-head"><button type="button" class="ofc-btn ofc-br-back" title="上一级">‹</button><div class="ofc-br-title"></div><input class="ofc-in ofc-br-q" placeholder="搜索" spellcheck="false"></div>' +
      '<div class="ofc-br-grid" tabindex="0"></div>' +
      '<div class="ofc-br-foot"><button type="button" class="ofc-btn" data-k="import">从电脑导入…</button><span class="ofc-br-sp"></span><button type="button" class="ofc-btn" data-k="cancel">取消</button><button type="button" class="ofc-btn ofc-default" data-k="ok">创建</button></div></div>';
    var grid = root.querySelector(".ofc-br-grid"), title = root.querySelector(".ofc-br-title"), back = root.querySelector(".ofc-br-back"), qin = root.querySelector(".ofc-br-q"), ok = root.querySelector('[data-k="ok"]');
    var win = D.createWindow({ id: impl.id + "-browser", app: impl.id, name: impl.name, className: "ofc-win ofc-brwin", content: root, width: 900, height: 600,
      title: function () { return impl.name; },
      menus: function () { return [{ title: "文件", items: [it("新建…", "⌥⌘N", function () { B.go("new"); }), it("打开…", "⌘O", function () { B.go(DOCS); }), it("从电脑导入…", "", function () { importLocal(impl, where.charAt(0) === "/" ? where : DOCS); })] }]; },
      appMenu: function () { return appMenu(impl); },
      initial: function () { var a = D.area(), W = Math.min(900, a.width - 40), H = Math.min(600, a.height - 30); return { left: a.left + Math.round((a.width - W) / 2), top: a.top + Math.max(10, Math.round((a.height - H) / 3)), width: W, height: H }; },
    });
    var bar = win.el.querySelector(".bar");
    bar.appendChild(el("div", "ofc-title", "<b>" + esc(impl.name) + "</b>"));
    win.sessionState = function () { return { browser: where === "new" ? "new" : "open" }; };
    var items = [];
    function list() {
      if (where === "new") return (impl.templates || []).map(function (t) { return { kind: "tpl", id: t.id, name: t.name, thumb: t.thumb }; });
      var files;
      if (where === "recent") files = recent(impl.id).map(function (r) { return r.path; });
      else {
        try { files = FS.list(where); } catch (e) { files = []; }
        files = files.filter(function (p) { return baseOf(p)[0] !== "." && (FS.isDir(p) || (impl.opens || []).indexOf(extOf(p)) >= 0); });
        files.sort(function (a, b) { var da = FS.isDir(a), db = FS.isDir(b); if (da !== db) return da ? -1 : 1; return baseOf(a).localeCompare(baseOf(b), "zh"); });
      }
      return files.map(function (p) { var st = FS.stat(p) || {}; return { kind: FS.isDir(p) ? "dir" : "file", path: p, name: FS.isDir(p) ? baseOf(p) : baseOf(p), t: st.mtime }; });
    }
    function render() {
      var qq = q.trim().toLowerCase();
      items = list().filter(function (x) { return !qq || x.name.toLowerCase().indexOf(qq) >= 0; });
      grid.textContent = "";
      grid.className = "ofc-br-grid" + (where === "new" ? " tpl" : "");
      if (!items.length) grid.appendChild(el("div", "ofc-br-empty", where === "recent" ? "还没有最近使用的文稿" : qq ? "没有找到" : "这里没有" + impl.name + "能打开的文稿"));
      items.forEach(function (x, i) {
        var c = el("div", "ofc-br-card" + (sel === i ? " on" : ""));
        if (x.kind === "tpl") c.innerHTML = '<div class="ofc-br-thumb">' + (x.thumb || "") + '</div><div class="ofc-br-name">' + esc(x.name) + "</div>";
        else if (x.kind === "dir") c.innerHTML = '<div class="ofc-br-thumb icon"><span class="ofc-bigfold"></span></div><div class="ofc-br-name">' + esc(x.name) + "</div>";
        else c.innerHTML = '<div class="ofc-br-thumb icon">' + docIcon(extOf(x.path), true) + '</div><div class="ofc-br-name">' + esc(where === "recent" ? stemOf(x.path) : x.name) + '</div><div class="ofc-br-sub">' + esc(where === "recent" ? tilde(dirOf(x.path)) : fmtDate(x.t)) + "</div>";
        c.addEventListener("mousedown", function () { select(i); });
        c.addEventListener("dblclick", function () { activate(i); });
        grid.appendChild(c);
      });
      var sideKey = where === "new" || where === "recent" ? where : where;
      root.querySelectorAll(".ofc-br-it").forEach(function (x) { x.classList.toggle("on", x.dataset.go === sideKey); });
      title.textContent = where === "new" ? "选取模板" : where === "recent" ? "最近使用" : tilde(where);
      back.hidden = where === "new" || where === "recent" || where === HOME || where === "/";
      ok.textContent = where === "new" ? "创建" : "打开";
      ok.disabled = sel == null || !items[sel];
    }
    function select(i) { sel = i; grid.querySelectorAll(".ofc-br-card").forEach(function (c, k) { c.classList.toggle("on", k === i); }); ok.disabled = sel == null || !items[sel]; }
    function activate(i) {
      var x = items[i];
      if (!x) return;
      if (x.kind === "tpl") return newDoc(impl, x.id);
      if (x.kind === "dir") return B.go(x.path);
      openPath(impl, x.path);
    }
    root.querySelectorAll(".ofc-br-it").forEach(function (x) { x.addEventListener("click", function () { B.go(x.dataset.go); }); });
    back.addEventListener("click", function () { B.go(dirOf(where)); });
    qin.addEventListener("input", function () { q = qin.value; sel = null; render(); });
    qin.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Escape") { qin.value = q = ""; render(); } });
    ok.addEventListener("click", function () { activate(sel); });
    root.querySelector('[data-k="cancel"]').addEventListener("click", function () { win.hide("closed"); });
    root.querySelector('[data-k="import"]').addEventListener("click", function () { importLocal(impl, where.charAt(0) === "/" ? where : DOCS); });
    grid.addEventListener("keydown", function (e) {
      var cols = Math.max(1, Math.floor(grid.clientWidth / 164)), n = items.length;
      if (!n) return;
      var i = sel == null ? -1 : sel;
      if (e.key === "ArrowRight") i = Math.min(n - 1, i + 1);
      else if (e.key === "ArrowLeft") i = Math.max(0, i - 1);
      else if (e.key === "ArrowDown") i = Math.min(n - 1, i < 0 ? 0 : i + cols);
      else if (e.key === "ArrowUp") i = Math.max(0, i - cols);
      else if (e.key === "Enter") { e.preventDefault(); return activate(sel); }
      else return;
      e.preventDefault();
      select(i);
      var c = grid.children[i];
      if (c && c.scrollIntoView) c.scrollIntoView({ block: "nearest" });
    });
    // 文件夹里的东西变了（agent 刚写了个文件）→ 重画
    var reT = 0;
    FS.onChange(function (p) { if (win.state === "closed" || where === "new") return; if (where === "recent" || dirOf(p) === where) { clearTimeout(reT); reT = setTimeout(render, 200); } });
    var B = { win: win, grid: grid, go: function (w) { where = w; sel = null; q = ""; qin.value = ""; render(); if (where === "new" && items.length) select(0); } };
    return B;
  }

  // ======== 系统命令 numbers / pages / keynote 的动作（登记在 office.js，第一次用时才载入 App）：开 / 新建 / 导出通用，别的交给各 App 视图的 view.api ========
  // args 里的路径 sys.js 已经换成绝对路径、按调用者的权限查过（path: "read" / "write"）；没给路径时用开着的文稿，先查它能不能读；改文稿前再查能不能写
  function actionDoc(impl, args, ctx) {
    if (args.path) {
      var d0 = docs.find(function (d) { return d.path === args.path && d.impl === impl; });
      return d0 ? Promise.resolve(d0) : openPath(impl, args.path);
    }
    var f = D.front && D.front(), fd = f && f._ofc && f._ofc.doc, mine = docs.filter(function (d) { return d.impl === impl; });
    var doc = fd && fd.impl === impl ? fd : mine[mine.length - 1];
    if (!doc) return Promise.reject(new Error("no " + impl.name + " document is open — pass --path, or open / create one first (" + impl.id + " --help)"));
    ctx.check(doc.path || DOCS + "/untitled", "read");
    return Promise.resolve(doc);
  }
  function canEdit(doc, ctx) { ctx.check(doc.path || DOCS + "/untitled", "write"); } // 没存过的文稿算在人的「文稿」文件夹里
  // 改完：有路径的马上存下去（agent 接着用 python 读文件就是新的）
  function settle(doc) {
    if (!doc.path || !canWrite(doc.impl, doc.fmt) || lossy(doc.impl, doc.fmt)) return Promise.resolve(doc.path ? " (not saved: " + doc.fmt + " keeps data only — the human decides how to save)" : " (untitled — not saved to a file yet)");
    clearTimeout(doc.autoT);
    return save(doc).then(function () { return " (saved to " + tilde(doc.path) + ")"; }, function (e) { return " (not saved yet: " + (e && e.message || e) + ")"; });
  }
  var ACTIONS_COMMON = {
    open: function (impl, args) {
      return openPath(impl, args.path).then(function (doc) { doc.front(); return { text: "Opened " + tilde(args.path) + " in " + impl.name + ".", summary: "Opened " + baseOf(args.path) }; });
    },
    create: function (impl, args, ctx) {
      if (args.path && FS.exists(args.path)) throw new Error(tilde(args.path) + " already exists — use open");
      if (args.path && extOf(args.path) !== impl.native) throw new Error("path should end with ." + impl.native);
      if (!args.path) ctx.check(DOCS + "/untitled", "write");
      return newDoc(impl, args.template).then(function (doc) {
        if (!doc) throw new Error("couldn't create the document");
        if (!args.path) return { text: "Created an untitled " + impl.name + " document (not saved to a file; pass path to save it).", summary: "New " + impl.name + " document" };
        doc.path = args.path; doc.fmt = impl.native; doc.diskHash = null; doc.backedUp = true; doc.seq++;
        return save(doc, { force: true }).then(function () { releaseSlot(doc); updateTitle(doc); doc.refresh(); return { text: "Created " + tilde(args.path) + " and opened it in " + impl.name + ".", summary: "Created " + baseOf(args.path) }; });
      });
    },
    export: function (impl, args, ctx) {
      var fmt = String(args.format || extOf(args.to || "")).toLowerCase();
      if (fmt === "pdf" && !pdfFiles()) throw new Error("PDF files can only be made in the Paimon app (in a browser the human prints to PDF: File › Print); export " + impl.native + " instead");
      if (!(impl.exportFormats || []).some(function (f) { return f.ext === fmt; })) throw new Error("format should be one of " + (impl.exportFormats || []).map(function (f) { return f.ext; }).filter(function (x) { return x !== "pdf" || pdfFiles(); }).join(", "));
      if (extOf(args.to) !== fmt) throw new Error("the file should end with ." + fmt);
      return actionDoc(impl, args, ctx).then(function (doc) {
        // PDF：同人在「导出为 › PDF」里存的那份（分页、矢量、文字能选）；不发通知（agent 自己会说）
        if (fmt === "pdf") return Promise.resolve(doc.view.printable()).then(function (pr) {
          return TSU_PDF.save(pdfOpts(doc, pr, { path: args.to, replace: true, notify: false }));
        }).then(function (p) { return { text: "Exported " + doc.label() + " to " + tilde(p) + " (PDF).", summary: "Exported " + baseOf(p) }; });
        return Promise.resolve(doc.view.serialize(fmt)).then(function (data) { return writeFile(args.to, typeof data === "string" ? data : toBytes(data)); })
          .then(function () { return { text: "Exported " + doc.label() + " to " + tilde(args.to) + ".", summary: "Exported " + baseOf(args.to) }; });
      });
    },
  };
  function runAction(impl, name, args, ctx) {
    args = args || {};
    if (ACTIONS_COMMON[name]) return Promise.resolve().then(function () { return ACTIONS_COMMON[name](impl, args, ctx); });
    var fn = impl.actions && impl.actions[name];
    if (!fn) return Promise.reject(new Error(impl.name + " has no action " + name));
    return actionDoc(impl, args, ctx).then(function (doc) {
      if (!doc.view || !doc.view.api) throw new Error(impl.name + " can't do that yet");
      return fn(doc, args, { check: function () { canEdit(doc, ctx); }, settle: function () { return settle(doc); }, tilde: tilde, label: doc.label() });
    });
  }

  // ======== 快捷键（桌面不分发快捷键：前台是 Office 的窗口时这里接）========
  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || e.isComposing) return;
    var f = D.front && D.front();
    if (!f || !f._ofc || !f._ofc.doc || f.state === "closed") return;
    if (!f.el.contains(e.target) && e.target !== document.body && e.target !== document.documentElement) return;
    var doc = f._ofc.doc, mod = e.metaKey || e.ctrlKey, k = e.code;
    if (!mod) return;
    if (k === "KeyS" && !e.altKey) { e.preventDefault(); if (e.shiftKey) saveAs(doc); else cmdSave(doc); }
    else if (k === "KeyO" && !e.shiftKey && !e.altKey) { e.preventDefault(); browser(doc.impl, "open"); }
    else if (k === "KeyN" && e.altKey) { e.preventDefault(); browser(doc.impl, "new"); }
    else if (k === "KeyP" && !e.shiftKey && !e.altKey) { e.preventDefault(); print(doc); }
  });
  // 离开页面前：还有没写下去的就先写（写不完浏览器也会问一句）
  window.addEventListener("beforeunload", function (e) {
    var pending = docs.filter(function (d) { return d.dirty() && (d.path ? !lossy(d.impl, d.fmt) && canWrite(d.impl, d.fmt) && !d.conflict : true); });
    pending.forEach(function (d) { clearTimeout(d.autoT); autosave(d); });
    if (docs.some(function (d) { return d.dirty() && d.path && (lossy(d.impl, d.fmt) || d.conflict); })) { e.preventDefault(); e.returnValue = ""; }
  });

  // ======== 给各 App 用 ========
  function defineApp(impl) {
    impl.launch = function () { return launch(impl); };
    impl.openPath = function (p) { return openPath(impl, p); };
    impl.newDoc = function (tpl) { return newDoc(impl, tpl); };
    impl.browser = function (mode) { return browser(impl, mode); };
    impl.docs = function () { return docs.filter(function (d) { return d.impl === impl; }); };
    impl.restore = function (wins) { return restoreWins(impl, wins); };
    impl.action = function (name, args, ctx) { return runAction(impl, name, args, ctx); };
    O.apps[impl.id] = impl;
    return impl;
  }
  Object.assign(O, {
    core: true, HOME: HOME, DOCS: DOCS, AUTOSAVE: AUTOSAVE,
    defineApp: defineApp, ui: ui, icon: ICON, CHEV: CHEV, item: it, SEP: SEP,
    readBytes: readBytes, writeFile: writeFile, hash: hash, toBytes: toBytes,
    baseOf: baseOf, dirOf: dirOf, extOf: extOf, stemOf: stemOf, tilde: tilde, uniquePath: uniquePath, esc: esc, el: el, fmtDate: fmtDate,
    onTheme: onTheme, dark: dark, printHTML: printHTML, upload: upload, docIcon: docIcon, toast: toast,
    docs: function () { return docs.slice(); },
    _save: save, _saveAs: saveAs, _checkDisk: checkDisk,
  });
})();
