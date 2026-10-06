// sys-ax.js —— agent「看」和「摸」这台桌面：ax（辅助功能树：角色、名字、值、状态、位置，元素编号一直不变；按、填、打字、按键、滚动）
// 与 screencapture（窗口 / 整个屏幕 / 一块区域 → PNG；agent 调的时候图附在结果里给模型看）。画图的代码在 sys-capture.js，第一次截屏时才载入
(function () {
  "use strict";
  var S = window.TSU_SYS;
  if (!S) return;
  var U = S._, err = U.err, usage = U.usage, DK = U.DK, IOS = U.IOS, two = U.two, json = U.json;
  var getopt = S.getopt, clip = S.clip;
  var me = document.currentScript && document.currentScript.src, BASE = me ? me.replace(/[^/]*$/, "") : "";

  // ======== 元素编号：同一个元素一直是同一个 eN ========
  var ids = new WeakMap(), byId = new Map(), seq = 0;
  function idOf(el) {
    var id = ids.get(el);
    if (!id) {
      id = "e" + (++seq);
      ids.set(el, id);
      byId.set(id, new WeakRef(el));
      if (byId.size > 30000) byId.forEach(function (r, k) { var x = r.deref(); if (!x || !x.isConnected) byId.delete(k); });
    }
    return id;
  }
  function elOf(id) { var r = byId.get(String(id || "").replace(/^@/, "")); var el = r && r.deref(); return el && el.isConnected ? el : null; }

  // ======== 角色、名字、值、状态 ========
  var SKIPTAG = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1, HEAD: 1, TITLE: 1, BR: 1, WBR: 1, SOURCE: 1, TRACK: 1, defs: 1, clipPath: 1, mask: 1, filter: 1, symbol: 1 };
  var LEAF = { textbox: 1, searchfield: 1, checkbox: 1, radio: 1, "switch": 1, slider: 1, combobox: 1, image: 1, progressbar: 1, meter: 1, spinbutton: 1, colorwell: 1, separator: 1, canvas: 1, video: 1, audio: 1 };
  var FROM_CONTENT = { button: 1, link: 1, menuitem: 1, tab: 1, option: 1, heading: 1, cell: 1, columnheader: 1, listitem: 1, treeitem: 1, tooltip: 1, titlebar: 1, label: 1 };
  var INPUT_ROLE = { checkbox: "checkbox", radio: "radio", range: "slider", button: "button", submit: "button", reset: "button", image: "button", file: "button", number: "spinbutton", color: "colorwell", search: "searchfield", hidden: "" };
  var TAG_ROLE = { BUTTON: "button", SUMMARY: "button", TEXTAREA: "textbox", OPTION: "option", UL: "list", OL: "list", LI: "listitem", TABLE: "table", TR: "row", TD: "cell", TH: "columnheader",
    NAV: "navigation", DIALOG: "dialog", PROGRESS: "progressbar", METER: "meter", IFRAME: "webarea", VIDEO: "video", AUDIO: "audio", CANVAS: "canvas", HR: "separator", FORM: "form", MAIN: "main" };
  var cls = function (el) { return el.getAttribute("class") || ""; };
  function roleOf(el, cs, pcs) {
    var r = el.getAttribute("role");
    if (r) return r.split(/\s+/)[0];
    var t = el.tagName;
    if (el.classList.contains("win")) return "window";
    if (t === "A") return el.hasAttribute("href") ? "link" : cs.cursor === "pointer" ? "button" : "";
    if (t === "INPUT") { var ty = (el.type || "text").toLowerCase(); return ty in INPUT_ROLE ? INPUT_ROLE[ty] : "textbox"; }
    if (t === "SELECT") return el.multiple ? "listbox" : "combobox";
    if (t === "IMG") return el.alt === "" && !el.title ? "" : "image";
    if (/^H[1-6]$/.test(t)) return "heading";
    if (TAG_ROLE[t]) return TAG_ROLE[t];
    if (el.isContentEditable && el.getAttribute("contenteditable") !== null && el.getAttribute("contenteditable") !== "false") return "textbox";
    if (t === "svg") return el.getAttribute("aria-label") || el.querySelector("title") ? "image" : "";
    // 这台桌面自己的控件
    if (/(^|[\s-])sw(\s|$)/.test(cls(el))) return "switch";
    if (el.classList.contains("bar") && el.parentElement && el.parentElement.parentElement && el.parentElement.parentElement.classList.contains("win")) return "titlebar";
    if (el.classList.contains("menu") && el.parentElement === document.body) return "menu";
    if (el.classList.contains("item") && el.parentElement && el.parentElement.classList.contains("menu")) return "menuitem";
    if (el.dataset && el.dataset.path) return "listitem"; // 访达里的文件、侧栏的位置（带着路径）
    if (el.classList.contains("io-tap")) return "button"; // 手机上能点的一行（设置、文件…）
    if (cs.cursor === "pointer" && !(pcs && pcs.cursor === "pointer")) return "button"; // 能点的（最外面那一层）
    if (el.hasAttribute("tabindex") && el.tabIndex >= 0) return "group";
    return "";
  }
  var squash = function (s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); };
  function textOf(el) { try { return squash(el.innerText !== undefined ? el.innerText : el.textContent); } catch (e) { return squash(el.textContent); } }
  function nameOf(el, role) {
    var a = el.getAttribute("aria-label");
    if (a) return squash(a);
    var lb = el.getAttribute("aria-labelledby");
    if (lb) { var t = lb.split(/\s+/).map(function (i) { var x = document.getElementById(i); return x ? textOf(x) : ""; }).join(" ").trim(); if (t) return t; }
    var tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      if (el.id) { var l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return textOf(l); }
      var wrap = el.closest("label");
      if (wrap) { var w2 = squash(wrap.textContent); if (/[\p{L}\p{N}]/u.test(w2)) return w2; } // 只有「✕」这种符号的不算
      if (el.placeholder) return squash(el.placeholder);
      if (el.title) return squash(el.title);
      var row = el.closest(".st-row, .io-row, .row, .cc-tile");
      if (row) { var lab = row.querySelector(".st-label, .io-rl, .cc-h, label, b"); if (lab && !lab.contains(el)) return textOf(lab); }
      if (/^(button|submit|reset)$/.test(el.type)) return squash(el.value);
      return "";
    }
    if (tag === "IMG") return squash(el.alt || el.title);
    if (FROM_CONTENT[role] || role === "window") { var tx = role === "window" ? "" : textOf(el); if (tx) return tx; }
    if (el.title) return squash(el.title);
    if (role === "switch") { var rw = el.closest(".st-row, .io-row, .row, .cc-tile"); if (rw) { var lb2 = rw.querySelector(".st-label, .io-rl, b, label"); if (lb2) return textOf(lb2); } }
    return "";
  }
  function valueOf(el, role) {
    var tag = el.tagName;
    if (tag === "INPUT") { if (el.type === "password") return el.value ? "•".repeat(Math.min(8, el.value.length)) : ""; if (/^(checkbox|radio|button|submit|reset|image|file)$/.test(el.type)) return undefined; return el.value; }
    if (tag === "TEXTAREA") return el.value;
    if (tag === "SELECT") { var o = el.options[el.selectedIndex]; return o ? squash(o.text) : ""; }
    if (role === "textbox" && el.isContentEditable) return el.innerText.replace(/\n+$/, "");
    if (el.hasAttribute("aria-valuetext")) return el.getAttribute("aria-valuetext");
    if (el.hasAttribute("aria-valuenow")) return el.getAttribute("aria-valuenow");
    if (tag === "PROGRESS" || tag === "METER") return String(el.value);
    return undefined;
  }
  function statesOf(el, role, off) {
    var s = [], c = " " + cls(el) + " ";
    if (document.activeElement === el) s.push("focused");
    if (el.disabled || el.getAttribute("aria-disabled") === "true" || / disabled /.test(c)) s.push("disabled");
    if (el.checked || el.getAttribute("aria-checked") === "true" || (role === "switch" && / on /.test(c))) s.push("checked");
    else if (role === "switch" || role === "checkbox") s.push("unchecked");
    if (el.getAttribute("aria-selected") === "true" || el.selected || (role !== "switch" && / (sel|selected|active|current|on|\S+-on) /.test(c))) s.push("selected");
    if (el.getAttribute("aria-expanded") === "true" || el.open === true) s.push("expanded");
    else if (el.getAttribute("aria-expanded") === "false") s.push("collapsed");
    if (el.readOnly) s.push("readonly");
    if (role === "window") { if (/ front /.test(c)) s.push("front"); if (/ min /.test(c)) s.push("minimized"); }
    if (/ running /.test(c)) s.push("running");
    if (off) s.push("offscreen");
    return s;
  }

  // ======== 树 ========
  function intersects(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }
  function inter(a, b) { return { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) }; }
  function scrollerOf(el) {
    for (var e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
      var cs = getComputedStyle(e);
      if ((/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1) || (/(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1)) return e;
    }
    return null;
  }
  // st：{ clip, max, depth, all, n, cut, ox, oy }
  function walk(el, st, depth, pcs) {
    if (st.n >= st.max) { st.cut = true; return []; }
    if (el.nodeType !== 1 || SKIPTAG[el.tagName] || el.id === "ios-acc") return [];
    if (el.hidden || el.getAttribute("aria-hidden") === "true" || el.inert || el.classList.contains("rs")) return [];
    var cs = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return [];
    if (+cs.opacity === 0 && cs.pointerEvents === "none") return [];
    var b = el.getBoundingClientRect(), R = { left: b.left + st.ox, top: b.top + st.oy, right: b.right + st.ox, bottom: b.bottom + st.oy };
    var contents = cs.display === "contents", zero = !b.width && !b.height && !contents;
    if (zero && cs.overflow !== "visible") return [];
    var role = roleOf(el, cs, pcs), off = !zero && !contents && !intersects(R, st.clip);
    var node = null;
    if (role) { node = { id: idOf(el), role: role, name: nameOf(el, role), value: valueOf(el, role), states: statesOf(el, role, off), frame: contents ? null : R, off: off, kids: [] }; st.n++; }
    var kids = [], text = "", hasEl = false;
    if (!(role && LEAF[role]) && depth < st.depth) {
      var clip0 = st.clip;
      if (!contents && /(hidden|clip|auto|scroll)/.test(cs.overflowX + " " + cs.overflowY)) st.clip = inter(st.clip, R);
      var offN = 0;
      var flushOff = function () { if (!offN) return; var sc = scrollerOf(el); kids.push({ role: "more", name: offN + " more out of view" + (sc ? " — ax scroll " + idOf(sc) + " down/up" : ""), kids: [], states: [], off: true, id: "" }); offN = 0; };
      for (var c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { if (c.nodeValue.trim()) text += c.nodeValue; continue; }
        if (c.nodeType !== 1) continue;
        hasEl = true;
        var sub;
        if (c.tagName === "IFRAME") sub = frameKids(c, st, depth + 1);
        else sub = walk(c, st, depth + (node ? 1 : 0), cs);
        if (!sub.length) continue;
        if (!st.all && sub.every(function (x) { return x.off; })) { offN += sub.length; continue; }
        flushOff();
        kids.push.apply(kids, sub);
      }
      flushOff();
      st.clip = clip0;
    }
    text = squash(text);
    if (node && FROM_CONTENT[node.role]) {
      if (kids.every(function (k) { return k.role === "text"; })) kids = []; // 按钮、链接里只有字：字就是它的名字
    } else if (text) {
      var tnode = { id: idOf(el), role: "text", name: clip(hasEl && kids.every(function (k) { return k.role === "text"; }) ? textOf(el) : text, 400), states: off ? ["offscreen"] : [], frame: null, off: off, kids: [] };
      if (hasEl && kids.every(function (k) { return k.role === "text"; })) kids = [tnode]; else kids.unshift(tnode);
      st.n++;
    }
    if (node) { node.kids = kids; return [node]; }
    return kids;
  }
  function frameKids(fr, st, depth) {
    var d = null;
    try { d = fr.contentDocument; } catch (e) { d = null; }
    var b = fr.getBoundingClientRect();
    var node = { id: idOf(fr), role: "webarea", name: d ? squash(d.title) : "", value: undefined, states: [], frame: { left: b.left + st.ox, top: b.top + st.oy, right: b.right + st.ox, bottom: b.bottom + st.oy }, off: false, kids: [] };
    if (!d || !d.body) { node.name = (node.name || "") + " (another site — its contents can't be read; use WebFetch on its URL)"; return [node]; }
    var ox = st.ox, oy = st.oy, clip0 = st.clip;
    st.ox += b.left + fr.clientLeft; st.oy += b.top + fr.clientTop;
    st.clip = inter(st.clip, node.frame);
    node.kids = walk(d.body, st, depth, null);
    st.ox = ox; st.oy = oy; st.clip = clip0;
    return [node];
  }
  var fr = function (f) { return f ? "@" + Math.round(f.left) + "," + Math.round(f.top) + " " + Math.round(f.right - f.left) + "×" + Math.round(f.bottom - f.top) : ""; };
  function line(n) {
    if (n.role === "more") return "… " + n.name;
    return n.id + " " + n.role + (n.name ? " " + JSON.stringify(clip(n.name, n.role === "text" ? 400 : 100)) : "") + (n.value !== undefined ? " value=" + JSON.stringify(clip(n.value, 300)) : "") +
      (n.states.length ? " [" + n.states.join(",") + "]" : "") + (n.frame && n.role !== "text" ? " " + fr(n.frame) : "");
  }
  function print(nodes, ind, out) { nodes.forEach(function (n) { out.push(ind + line(n)); print(n.kids, ind + "  ", out); }); return out; }
  function plain(nodes) {
    return nodes.map(function (n) {
      var o = { id: n.id || undefined, role: n.role, name: n.name || undefined, value: n.value, states: n.states.length ? n.states : undefined };
      if (n.frame) o.frame = { x: Math.round(n.frame.left), y: Math.round(n.frame.top), w: Math.round(n.frame.right - n.frame.left), h: Math.round(n.frame.bottom - n.frame.top) };
      if (n.kids.length) o.children = plain(n.kids);
      return o;
    });
  }
  var VIEW = function () { return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }; };
  function tree(el, o) {
    var st = { clip: VIEW(), max: o.max || 250, depth: o.depth || 64, all: !!o.all, n: 0, cut: false, ox: 0, oy: 0 };
    var nodes = walk(el, st, 0, el.parentElement ? getComputedStyle(el.parentElement) : null);
    return { nodes: nodes, cut: st.cut, n: st.n };
  }

  // ======== 看哪一块：窗口 id / App（它最前面的窗口）/ dock、menubar、desktop、screen；不给就是最前面的窗口 + 开着的菜单、提醒、面板 ========
  function winOf(key) {
    var d = DK();
    if (!d) throw err("the desktop isn't ready yet");
    if (d.apps[key]) return d.apps[key];
    var k = String(key).toLowerCase(), list = Object.keys(d.apps).map(function (x) { return d.apps[x]; }).filter(function (w) { return w.state !== "closed" && (w.app === key || String(w.name).toLowerCase() === k); });
    list.sort(function (a, b) { return (+b.el.style.zIndex || 0) - (+a.el.style.zIndex || 0); });
    return list[0] || null;
  }
  function overlays() {
    return Array.prototype.slice.call(document.querySelectorAll("body > .menu, body > .alert-ov, body > .glass-pane:not([hidden]), #banners > *, #ios-menu, .ios-sheet:not([hidden])")).filter(function (e) { return e.offsetWidth || e.offsetHeight; });
  }
  function roots(key) {
    var d = DK(), ios = IOS();
    var SPECIAL = { dock: "#dock", menubar: "#menubar", screen: "body", desktop: "#desktop" };
    if (key && SPECIAL[key]) { var e = document.querySelector(SPECIAL[key]); if (!e) throw err("there's no " + key + " here"); return [{ el: e, label: key }]; }
    if (key) {
      var w = winOf(key);
      if (!w) throw err("no window \"" + key + "\" (windows lists them; also dock, menubar, desktop, screen)");
      return [{ el: w.el, win: w, label: "window " + w.el.id }];
    }
    var f = ios ? ios.fg() : d && d.front(), out = [];
    if (f && f.state !== "min" && f.state !== "closed") out.push({ el: f.el, win: f, label: "window " + f.el.id });
    else out.push({ el: ios ? document.body : document.getElementById("desktop") || document.body, label: ios ? "home screen" : "desktop (no window in front)" });
    overlays().forEach(function (e) { out.push({ el: e, label: e.classList.contains("menu") ? "open menu" : e.classList.contains("alert-ov") ? "alert" : e.classList.contains("glass-pane") ? "panel" : "notification banner" }); });
    return out;
  }
  function header(r) {
    if (!r.win) return r.label;
    var w = r.win, t = "";
    try { t = typeof w.title === "function" ? w.title() : ""; } catch (e) { /* 取不到 */ }
    t = t || (w.el.querySelector(".bar span") || {}).textContent || w.name;
    return "window " + w.el.id + " " + JSON.stringify(clip(t, 80)) + " app=" + w.app + " " + fr(w.el.getBoundingClientRect()) + " [" + [w.state].concat(w === (IOS() ? IOS().fg() : DK().front()) ? ["front"] : []).join(",") + "]";
  }
  var NOTTEXT = /^(more|text)$/;
  function flatten(nodes, out, path) { nodes.forEach(function (n) { out.push({ n: n, path: path }); flatten(n.kids, out, n.role === "text" || !n.name ? path : path.concat([n.name])); }); return out; }

  // ======== 动作 ========
  function guard(el, ctx) {
    if (!ctx.agent) return;
    var w = el.closest && el.closest(".win"), d = DK();
    if (w && w.id === "settings") throw err("System Settings can't be operated by agents (it controls what agents may do); change desktop settings with `defaults write` instead");
    if (w && (w.classList.contains("termwin") || w.id === "win" || (d && d.apps[w.id] && d.apps[w.id].app === "win"))) throw err("terminal windows can't be operated by agents (typing there runs commands as the human); use your own Bash");
    if (el.closest && el.closest("#menubar .apple, .lock-ov, .power-ov, .about-ov")) throw err("that's off limits for agents");
  }
  function target(id, ctx) {
    if (!id) throw usage("which element? (an id like e12 from ax)");
    var el = elOf(id);
    if (!el) throw err("no element " + id + " — it's gone or was never listed; run ax again for fresh ids");
    guard(el, ctx);
    return el;
  }
  var focusable = function (el) { return el.matches && el.matches("input, textarea, select, button, a[href], [tabindex], [contenteditable]:not([contenteditable=false])"); };
  function press(el, o) {
    o = o || {};
    if (el.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    var base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y };
    var btn = o.right ? 2 : 0, bs = o.right ? 2 : 1;
    var P = function (type, ex) { var e; try { e = new PointerEvent(type, Object.assign({ pointerId: 1, pointerType: "mouse", isPrimary: true, width: 1, height: 1, pressure: type === "pointerdown" ? 0.5 : 0 }, base, ex || {})); } catch (x0) { e = new MouseEvent(type, Object.assign({}, base, ex || {})); } return el.dispatchEvent(e); };
    var M = function (type, ex) { return el.dispatchEvent(new MouseEvent(type, Object.assign({}, base, ex || {}))); };
    var nav = null, guardLink = function (e) { var a = e.target && e.target.closest && e.target.closest("a[href]"); if (a && !e.defaultPrevented && (!a.target || /^_(self|top|parent)$/.test(a.target)) && !/^(javascript:|#)/.test(a.getAttribute("href") || "")) { e.preventDefault(); nav = a.href; } };
    window.addEventListener("click", guardLink);
    try {
      P("pointerover"); M("mouseover"); M("mousemove");
      var clicks = o.double ? 2 : 1;
      for (var i = 1; i <= clicks; i++) {
        P("pointerdown", { button: btn, buttons: bs });
        var md = M("mousedown", { button: btn, buttons: bs, detail: i });
        if (md && focusable(el) && document.activeElement !== el) el.focus({ preventScroll: true });
        P("pointerup", { button: btn, buttons: 0 });
        M("mouseup", { button: btn, buttons: 0, detail: i });
        if (o.right) { M("contextmenu", { button: 2, buttons: 0 }); break; }
        M("click", { button: 0, buttons: 0, detail: i });
      }
      if (o.double && !o.right) M("dblclick", { button: 0, buttons: 0, detail: 2 });
    } finally { window.removeEventListener("click", guardLink); }
    if (nav && window.TSU_SAFARI) TSU_SAFARI.open(nav); // 页面里的链接不把整个桌面带走：在 Safari 里开
  }
  function nativeSet(el, v) {
    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: String(v) }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function setValue(el, v) {
    var tag = el.tagName, cs = getComputedStyle(el), role = roleOf(el, cs, el.parentElement ? getComputedStyle(el.parentElement) : null), yes = /^(1|true|yes|on|checked)$/i.test(v);
    if (tag === "INPUT" && /^(checkbox|radio)$/.test(el.type)) { if (el.checked !== yes) press(el); return el.checked ? "checked" : "unchecked"; }
    if (tag === "SELECT") {
      var opts = Array.prototype.slice.call(el.options), lv = String(v).toLowerCase();
      var o = opts.filter(function (x) { return x.value === v; })[0] || opts.filter(function (x) { return squash(x.text) === v; })[0] || opts.filter(function (x) { return squash(x.text).toLowerCase().indexOf(lv) === 0; })[0];
      if (!o) throw err("no option \"" + v + "\" (" + opts.map(function (x) { return squash(x.text); }).join(", ") + ")");
      el.focus({ preventScroll: true });
      nativeSet(el, o.value);
      return "selected " + JSON.stringify(squash(o.text));
    }
    if (tag === "INPUT" || tag === "TEXTAREA") { el.focus({ preventScroll: true }); nativeSet(el, v); return "value " + JSON.stringify(clip(el.value, 200)); }
    if (el.isContentEditable) {
      el.focus({ preventScroll: true });
      document.getSelection().selectAllChildren(el);
      if (!document.execCommand("insertText", false, v)) { el.textContent = v; el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: v })); }
      return "text " + JSON.stringify(clip(el.innerText, 200));
    }
    if (role === "switch" || el.getAttribute("aria-checked") !== null) {
      var cur = el.classList.contains("on") || el.getAttribute("aria-checked") === "true";
      if (cur !== yes) press(el);
      var now = el.classList.contains("on") || el.getAttribute("aria-checked") === "true";
      return now ? "on" : "off";
    }
    throw err("that's a " + (role || "plain element") + " — set works on text fields, checkboxes, switches, sliders and pop-up menus; press it instead");
  }
  function typeInto(el, text) {
    if (!(el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) throw err("type works on text fields; that's a " + el.tagName.toLowerCase());
    el.focus({ preventScroll: true });
    try { if (typeof el.selectionStart === "number" && document.activeElement === el && el.selectionStart === el.selectionEnd) el.setSelectionRange(el.value.length, el.value.length); } catch (e) { /* 有的 input 不能选 */ }
    if (!document.execCommand("insertText", false, text)) {
      if (el.isContentEditable) { el.textContent += text; el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })); }
      else nativeSet(el, el.value + text);
    }
  }
  var KEYNAME = { enter: "Enter", "return": "Enter", esc: "Escape", escape: "Escape", tab: "Tab", space: " ", spacebar: " ", backspace: "Backspace", "delete": "Delete", del: "Delete",
    up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight", home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown" };
  var KEYCODE = { Enter: 13, Escape: 27, Tab: 9, " ": 32, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34 };
  function sendKey(el, spec) {
    var parts = String(spec).split("+"), k = parts.pop(), mods = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
    if (k === "" && parts.length) { parts.pop(); k = "+"; }
    parts.forEach(function (m) {
      m = m.toLowerCase();
      if (/^(cmd|command|meta|super|⌘)$/.test(m)) mods.metaKey = true; else if (/^(ctrl|control|⌃)$/.test(m)) mods.ctrlKey = true;
      else if (/^(alt|option|opt|⌥)$/.test(m)) mods.altKey = true; else if (/^(shift|⇧)$/.test(m)) mods.shiftKey = true;
      else throw usage("unknown modifier \"" + m + "\" (cmd, ctrl, alt/option, shift)");
    });
    var key = KEYNAME[k.toLowerCase()] || (/^f([1-9]|1[0-2])$/i.test(k) ? k.toUpperCase() : k.length === 1 ? k : null);
    if (!key) throw usage("unknown key \"" + k + "\" (Enter, Escape, Tab, Space, Backspace, Delete, arrows, Home, End, PageUp, PageDown, F1–F12, or one character)");
    var code = key === " " ? "Space" : /^[a-z]$/i.test(key) ? "Key" + key.toUpperCase() : /^\d$/.test(key) ? "Digit" + key : key.length > 1 ? key : "";
    var kc = KEYCODE[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : /^F\d+$/.test(key) ? 111 + parseInt(key.slice(1), 10) : 0);
    if (focusable(el) && document.activeElement !== el) el.focus({ preventScroll: true });
    var mk = function (type) { var e = new KeyboardEvent(type, Object.assign({ key: key, code: code, bubbles: true, cancelable: true, composed: true }, mods)); try { Object.defineProperty(e, "keyCode", { get: function () { return kc; } }); Object.defineProperty(e, "which", { get: function () { return kc; } }); } catch (x) { /* 只读 */ } return e; };
    var t = document.activeElement && el.contains(document.activeElement) ? document.activeElement : el;
    var ok = t.dispatchEvent(mk("keydown"));
    t.dispatchEvent(mk("keyup"));
    return { key: (parts.length ? parts.join("+") + "+" : "") + (key === " " ? "Space" : key), handled: !ok };
  }
  function describe(el) {
    var cs = getComputedStyle(el), role = roleOf(el, cs, el.parentElement ? getComputedStyle(el.parentElement) : null) || el.tagName.toLowerCase(), name = nameOf(el, role) || clip(textOf(el), 60);
    return idOf(el) + " " + role + (name ? " " + JSON.stringify(clip(name, 80)) : "");
  }

  S.register("ax", {
    summary: "the accessibility tree of a window (roles, names, values, states, frames, stable ids) — and press, set, type, key, scroll, focus",
    usage: ["ax [<window>] [--depth <n>] [--max <n>] [--all] [--json]", "ax find <text> [--in <window>]", "ax at <x> <y>",
      "ax press <id> [--double|--right]", "ax set <id> <value>", "ax type <id> <text>", "ax key <id> <key>", "ax focus <id>", "ax scroll <id> [down|up|left|right|top|bottom|<pixels>]"],
    help: "The tree is what a screen reader sees: one element per line, `<id> <role> \"name\" value=… [states] @x,y w×h` (screen points; 0,0 is the top-left of the screen). Ids (e12) stay the same for the same element, so you can act on them later. " +
      "<window> is an id from `windows`, an app, or dock / menubar / desktop / screen; without it you get the front window plus any open menu, alert or panel. Things scrolled out of view are summarized (--all lists them). The default limit is 250 elements (--max).\n" +
      "find: elements whose name or value contains the text. at: the element at a point (e.g. one you saw in a screenshot).\n" +
      "press clicks it (--double, --right for the context menu). set: a text field's value, a checkbox / switch (on/off), a slider, or a pop-up menu (by option text). type: add text at the end of a field, like typing. key: Enter, Escape, Tab, arrows, cmd+s, shift+tab …\n" +
      "Links open in Safari rather than taking over the page. Agents can't operate terminal windows or System Settings (use your own Bash and `defaults`). After acting, run ax again to see the result.",
    levelNote: "Reading needs read access; press, set, type, key, focus and scroll need read & write.",
    run: function (argv, ctx) {
      var ACT = { press: 1, click: 1, set: 1, type: 1, key: 1, focus: 1, scroll: 1 };
      var sub = argv[0];
      if (ACT[sub]) {
        ctx.need("rw", "ax " + sub);
        argv.shift();
        // press 才有选项；set / type / key 后面的都是原样的文字（ax type e5 -rf 也行）
        var g = sub === "press" || sub === "click" ? getopt(argv, { double: "bool", right: "bool" }) : { o: {}, a: argv[1] === "--" ? [argv[0]].concat(argv.slice(2)) : argv };
        var el = target(g.a[0], ctx), what = describe(el), arg = g.a.slice(1).join(" ");
        var after = function (msg) { return U.sleep(160).then(function () { return { out: msg, summary: msg.split("\n")[0] }; }); };
        if (sub === "press" || sub === "click") { press(el, g.o); return after("Pressed " + what + (g.o.double ? " (double)" : g.o.right ? " (right-click)" : "") + "."); }
        if (sub === "set") { if (g.a.length < 2) throw usage("ax set <id> <value>"); return after("Set " + what + ": " + setValue(el, arg) + "."); }
        if (sub === "type") { if (g.a.length < 2) throw usage("ax type <id> <text>"); typeInto(el, arg); return after("Typed " + arg.length + " characters into " + what + "."); }
        if (sub === "key") { if (!arg) throw usage("ax key <id> <key>"); var kr = sendKey(el, arg); return after("Sent " + kr.key + " to " + what + (kr.handled ? " (handled)" : "") + "."); }
        if (sub === "focus") { el.focus({ preventScroll: false }); return after(document.activeElement === el ? "Focused " + what + "." : what + " can't take the keyboard focus."); }
        var sc = scrollerOf(el);
        if (!sc) throw err("nothing scrolls there");
        var h = sc.clientHeight * 0.85, wv = sc.clientWidth * 0.85, dir = (arg || "down").toLowerCase();
        if (dir === "down") sc.scrollBy(0, h); else if (dir === "up") sc.scrollBy(0, -h); else if (dir === "right") sc.scrollBy(wv, 0); else if (dir === "left") sc.scrollBy(-wv, 0);
        else if (dir === "top") sc.scrollTo(sc.scrollLeft, 0); else if (dir === "bottom") sc.scrollTo(sc.scrollLeft, sc.scrollHeight);
        else if (!isNaN(+dir)) sc.scrollBy(0, +dir); else throw usage("ax scroll <id> [down|up|left|right|top|bottom|<pixels>]");
        return after("Scrolled " + describe(sc) + " to " + Math.round(sc.scrollTop) + " of " + Math.max(0, sc.scrollHeight - sc.clientHeight) + ".");
      }
      if (sub === "at") {
        var x = +argv[1], y = +argv[2];
        if (isNaN(x) || isNaN(y)) throw usage("ax at <x> <y>");
        var hit = document.elementFromPoint(x, y);
        if (!hit) return "Nothing at " + x + "," + y + ".";
        var chain = [];
        for (var e = hit; e && e !== document.body && chain.length < 6; e = e.parentElement) { var cs0 = getComputedStyle(e); if (roleOf(e, cs0, e.parentElement ? getComputedStyle(e.parentElement) : null) || e === hit) chain.push(e); }
        var w0 = hit.closest(".win");
        return "At " + x + "," + y + (w0 ? " in window " + w0.id : "") + ":\n" + chain.map(function (c, i) { return "  ".repeat(i) + describe(c) + " " + fr(c.getBoundingClientRect()); }).join("\n");
      }
      if (sub === "find") {
        argv.shift();
        var fg = getopt(argv, { "in": "str", json: "bool" }), q = fg.a.join(" ").toLowerCase();
        if (!q) throw usage("ax find <text> [--in <window>]");
        var hits = [];
        roots(fg.o["in"]).forEach(function (r) {
          flatten(tree(r.el, { all: true, max: 4000 }).nodes, [], []).forEach(function (x) {
            if (x.n.role === "more") return;
            if (String(x.n.name || "").toLowerCase().indexOf(q) >= 0 || String(x.n.value || "").toLowerCase().indexOf(q) >= 0) hits.push(x);
          });
        });
        if (fg.o.json) return json(hits.map(function (x) { return Object.assign(plain([x.n])[0], { children: undefined, path: x.path }); }));
        if (!hits.length) return "Nothing matches \"" + q + "\".";
        return hits.slice(0, 60).map(function (x) { return line(Object.assign({}, x.n, { kids: [] })) + (x.path.length ? "   (in " + x.path.slice(-2).map(function (p) { return clip(p, 30); }).join(" › ") + ")" : ""); }).join("\n") + (hits.length > 60 ? "\n… " + (hits.length - 60) + " more" : "");
      }
      var o = getopt(argv, { depth: "num", max: "num", all: "bool", json: "bool" }, { "-d": "depth", "-n": "max" }), rs = roots(o.a[0]);
      var out = [], data = [], cut = false;
      rs.forEach(function (r) {
        var t = tree(r.el, { depth: o.o.depth, max: o.o.max || (o.o.all ? 2000 : 250), all: o.o.all });
        cut = cut || t.cut;
        if (o.o.json) { data.push({ root: r.label, window: r.win ? r.win.el.id : undefined, nodes: plain(t.nodes) }); return; }
        if (out.length) out.push("");
        out.push(header(r));
        var top = t.nodes.length === 1 && t.nodes[0].role === "window" && r.win ? t.nodes[0].kids : t.nodes; // 窗口自己那一行就是上面的标题行
        print(top, "  ", out);
      });
      if (o.o.json) return json(data.length === 1 ? data[0] : data);
      if (cut) out.push("… (stopped at " + (o.o.max || 250) + " elements: narrow it with --depth, raise --max, or use ax find)");
      return out.join("\n");
    },
  });

  // ======== screencapture ========
  var capLoad = null;
  function capture() {
    if (window.TSU_SYS_CAPTURE) return Promise.resolve(window.TSU_SYS_CAPTURE);
    if (!capLoad) capLoad = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = BASE + "sys-capture.js";
      s.onload = function () { res(window.TSU_SYS_CAPTURE); };
      s.onerror = function () { capLoad = null; rej(err("couldn't load the screenshot code")); };
      document.head.appendChild(s);
    });
    return capLoad;
  }
  function blobOf(c, type, q) { return new Promise(function (res, rej) { c.toBlob(function (b) { if (b) res(b); else rej(err("the browser couldn't encode the picture")); }, type, q); }); }
  function b64(blob) { return new Promise(function (res) { var fr0 = new FileReader(); fr0.onload = function () { res(String(fr0.result).replace(/^data:[^,]*,/, "")); }; fr0.readAsDataURL(blob); }); }
  // 给模型看的：长边 ≤ 1568、总共 ≤ 115 万像素（同 Claude 的建议），JPEG
  function forModel(c) {
    var k = Math.min(1, 1568 / Math.max(c.width, c.height), Math.sqrt(1150000 / (c.width * c.height)));
    var d = document.createElement("canvas");
    d.width = Math.max(1, Math.round(c.width * k)); d.height = Math.max(1, Math.round(c.height * k));
    var g = d.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, d.width, d.height);
    g.drawImage(c, 0, 0, d.width, d.height);
    return blobOf(d, "image/jpeg", 0.85).then(b64).then(function (data) { return { media_type: "image/jpeg", data: data, width: d.width, height: d.height }; });
  }
  function thumbOf(c) {
    var k = Math.min(1, 320 / c.width, 200 / c.height), d = document.createElement("canvas");
    d.width = Math.max(1, Math.round(c.width * k)); d.height = Math.max(1, Math.round(c.height * k));
    var g = d.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, d.width, d.height);
    g.drawImage(c, 0, 0, d.width, d.height);
    return d.toDataURL("image/jpeg", 0.72);
  }
  var shotName = function () { var d = new Date(); return "截屏" + d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + " " + two(d.getHours()) + "." + two(d.getMinutes()) + "." + two(d.getSeconds()); };
  S.register("screencapture", {
    title: "Screenshot",
    summary: "take a screenshot — the whole screen, one window (-l) or a region (-R) — as a PNG",
    usage: ["screencapture [-l <window>] [-R <x,y,w,h>] [-t png|jpg] [-T <seconds>] [-c] [-P] [-x] [<file>]"],
    help: "Without a file it is saved like on a Mac: ~/Desktop/截屏YYYY-MM-DD HH.MM.SS.png (local time). -l <window>: just that window (an id from `windows`, or an app). -R x,y,w,h: a region of the screen, in screen points. " +
      "-t: png (default) or jpg. -T: wait that many seconds first. -c: put it on the clipboard instead of a file. -P: open it afterwards. -x and -o are accepted (no sound, no shadow anyway).\n" +
      "When an agent runs it, the picture is attached to the result so the model sees it (models that can't see images get a note instead; `ax` gives the same window as text). " +
      "Pages from other sites inside Safari can't be captured (they show as a gray box). To act on something you see, find it with `ax at <x> <y>` or `ax find <text>`.",
    run: function (argv, ctx) {
      var g = getopt(argv, { window: "str", rect: "str", type: "str", delay: "num", c: "bool", P: "bool", x: "bool", o: "bool", C: "bool", i: "bool", w: "bool", W: "bool", s: "bool", D: "str", scale: "num" },
        { "-l": "window", "-R": "rect", "-t": "type", "-T": "delay", "-c": "c", "-P": "P", "-x": "x", "-o": "o", "-C": "C", "-i": "i", "-w": "w", "-W": "W", "-s": "s", "-D": "D" });
      var o = g.o;
      if (o.i || o.w || o.W || o.s) throw usage("interactive selection isn't available here — use -l <window> or -R x,y,w,h");
      if (g.a.length > 1) throw usage("one file at a time");
      if (o.c) ctx.need("rw", "screencapture -c");
      var fmt = String(o.type || (g.a[0] && /\.jpe?g$/i.test(g.a[0]) ? "jpg" : "png")).toLowerCase();
      if (!/^(png|jpe?g)$/.test(fmt)) throw usage("-t png or jpg");
      var root = document.body, rect = null, what = "the screen";
      if (o.window) {
        var w = winOf(o.window);
        if (!w) throw err("no window \"" + o.window + "\" (windows lists them)");
        if (w.state === "min" || w.state === "closed" || w.el.classList.contains("elsewhere") || !w.el.offsetWidth) throw err("window " + w.el.id + " isn't on screen (" + (w.state === "min" ? "minimized" : w.state === "closed" ? "closed" : "on another desktop") + ") — `windows front " + w.el.id + "` first");
        root = w.el; what = "window " + w.el.id;
      }
      if (o.rect) {
        var n = String(o.rect).split(/[,\s]+/).map(Number);
        if (n.length !== 4 || n.some(isNaN) || n[2] <= 0 || n[3] <= 0) throw usage("-R x,y,width,height");
        rect = { left: n[0], top: n[1], width: n[2], height: n[3] };
        what = "the region " + n.join(",");
      }
      var file = null;
      if (!o.c) file = ctx.path(g.a[0] || "~/Desktop/" + shotName() + "." + (fmt === "png" ? "png" : "jpg"));
      var wait = Math.max(0, Math.min(30, o.delay || 0)) * 1000;
      return U.sleep(wait).then(capture).then(function (C) {
        // 区域：先画整个屏幕再裁（固定定位的菜单栏、Dock 才在对的地方）
        return C.render(root, { scale: o.scale || undefined }).then(function (canvas) {
          if (!rect) return canvas;
          var k = canvas.width / (root === document.body ? window.innerWidth : root.getBoundingClientRect().width), c2 = document.createElement("canvas");
          var off = root === document.body ? { left: 0, top: 0 } : root.getBoundingClientRect();
          c2.width = Math.max(1, Math.round(rect.width * k)); c2.height = Math.max(1, Math.round(rect.height * k));
          c2.getContext("2d").drawImage(canvas, Math.round((rect.left - off.left) * k), Math.round((rect.top - off.top) * k), c2.width, c2.height, 0, 0, c2.width, c2.height);
          return c2;
        });
      }).then(function (canvas) {
        var sc = o.scale || Math.min(2, window.devicePixelRatio || 1), W = canvas.width, H = canvas.height, ptsW = Math.round(W / sc), pts = ptsW + "×" + Math.round(H / sc);
        var rb = root.getBoundingClientRect(), origin = rect ? [rect.left, rect.top] : root === document.body ? [0, 0] : [Math.round(rb.left), Math.round(rb.top)];
        var type = fmt === "png" ? "image/png" : "image/jpeg";
        var save = o.c
          ? blobOf(canvas, "image/png").then(function (b) { if (!navigator.clipboard || !window.ClipboardItem) throw err("this browser can't put pictures on the clipboard"); return navigator.clipboard.write([new ClipboardItem({ "image/png": b })]); })
          : blobOf(canvas, type, 0.92).then(function (b) { return b.arrayBuffer(); }).then(function (buf) { return ctx.writeFile(file, new Uint8Array(buf)); });
        return save.then(function () {
          if (o.P && file && window.TSU_FINDER) TSU_FINDER.preview(file);
          var thumb = thumbOf(canvas);
          var msg = (o.c ? "Copied a screenshot of " + what + " to the clipboard" : "Saved a screenshot of " + what + " to " + ctx.shown(file)) + " (" + W + "×" + H + " pixels, " + pts + " points).";
          if (!ctx.agent) return { out: msg, summary: msg, thumb: thumb };
          if (!ctx.vision) return { out: msg + "\nYour model can't see images, so it isn't attached — `ax" + (o.window ? " " + o.window : "") + "` gives the same view as text.", summary: "Captured " + what, thumb: thumb };
          return forModel(canvas).then(function (img) {
            ctx.images.push(img);
            var k = ptsW / img.width;
            return { out: msg + "\nThe screenshot is attached (" + img.width + "×" + img.height + "). To find something you see in it: screen point = (" + origin.join(", ") + ") + image pixel" + (Math.abs(k - 1) > 0.01 ? " × " + k.toFixed(3) : "") + " → `ax at <x> <y>`.", summary: "Captured " + what + " · " + pts, thumb: thumb };
          });
        });
      });
    },
  });
  S._.winOf = winOf;
  S.ax = { idOf: idOf, elOf: elOf, tree: tree };
})();
