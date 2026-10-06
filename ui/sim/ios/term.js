// ios/term.js —— 手机上的终端（在手机上 vibe coding 的那一块）。live.js 不动，这里从外面接：
// · 终端铺满一屏；导航栏左边是 agent 列表（同空输入按 ←），右边 ＋ 新标签页、⋯ 菜单（去掉分屏那几项）
// · 标签页栏是一条能左右划的分段控件；分屏在手机上不用（只显示当前面板）
// · 键盘上面一条附加键：esc、tab、ctrl（粘住：点一下管下一个键，连点两下锁住）、↑ ↓ ← →、/、!、粘贴、收起键盘——
//   agent 的输入框（透明 textarea）和真终端（xterm）都能用
// · 斜杠命令菜单、agent 列表（← 面板）都能点：菜单点一项就是选它（带参数的先填进输入框），列表点一下选中、再点打开
(function () {
  "use strict";
  var root = document.documentElement;
  if (!root.classList.contains("ios") || !window.TSU_IOS || !window.TSU_DESK) return;
  var I = window.TSU_IOS, D = window.TSU_DESK, IC = I.icons;
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  var now = function () { return performance.now(); };
  var isTerm = function (w) { return !!(w && w.el) && (w.app === "win" || w.el.classList.contains("termwin")); };
  var SIDEBAR = '<svg viewBox="0 0 26 22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="2" width="22" height="18" rx="4.5"/><path d="M10 2.5v17"/><path d="M5 6.5h2.2M5 9.8h2.2M5 13.1h2.2" stroke-linecap="round"/></svg>';
  var PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M12 4.5v15M4.5 12h15"/></svg>';

  // ---- 当前面板、它的输入（agent / 浏览器里的 shell：.ta；真终端：xterm 的隐藏输入框）----
  function activePane(w) {
    w = w || I.fg();
    if (!isTerm(w)) return null;
    return w.el.querySelector(".tpane.active") || w.el.querySelector(".tpane");
  }
  function inputOf(pane) {
    if (!pane) return null;
    if (pane.classList.contains("ptymode")) { var x = pane.querySelector(".xterm-helper-textarea"); return x ? { kind: "pty", el: x } : null; }
    var ta = pane.querySelector(".ta");
    return ta ? { kind: "ta", el: ta } : null;
  }
  var termInput = function (el) { return !!(el && el.classList && (el.classList.contains("ta") || el.classList.contains("xterm-helper-textarea")) && el.closest(".tpane")); };
  var agentPane = function (p) { return !!p && !p.classList.contains("shellmode") && !p.classList.contains("ptymode"); };

  // ======== 往输入里送键 ========
  var CODE = { Escape: "Escape", Tab: "Tab", Enter: "Enter", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", "/": "Slash", "!": "Digit1" };
  var KC = { Escape: 27, Tab: 9, Enter: 13, Backspace: 8, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
  function keyEvent(type, key, ctrl) {
    var ev = new KeyboardEvent(type, { key: key, code: CODE[key] || (key.length === 1 && /[a-z]/i.test(key) ? "Key" + key.toUpperCase() : ""), bubbles: true, cancelable: true, ctrlKey: !!ctrl });
    var kc = KC[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    // xterm 按 keyCode 认键（合成的事件 keyCode 是 0）
    try { Object.defineProperty(ev, "keyCode", { get: function () { return kc; } }); Object.defineProperty(ev, "which", { get: function () { return kc; } }); } catch (e) { /* 只读就算了 */ }
    return ev;
  }
  function insertText(ta, text) {
    if (document.activeElement !== ta) ta.focus({ preventScroll: true });
    if (document.execCommand && document.execCommand("insertText", false, text)) return;
    var a = ta.selectionStart, b = ta.selectionEnd;
    ta.setRangeText(text, a, b, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  // 合成的按键浏览器不做默认动作：程序没接住的方向键，自己挪光标
  function caretMove(ta, key) {
    var v = ta.value, a = ta.selectionStart, b = ta.selectionEnd, pos;
    if (key === "ArrowLeft") pos = a === b ? Math.max(0, a - 1) : a;
    else if (key === "ArrowRight") pos = a === b ? Math.min(v.length, b + 1) : b;
    else if (key === "ArrowUp" || key === "ArrowDown") {
      var ls = v.lastIndexOf("\n", a - 1) + 1, col = a - ls;
      if (key === "ArrowUp") { if (!ls) pos = 0; else { var ps = v.lastIndexOf("\n", ls - 2) + 1; pos = Math.min(ls - 1, ps + col); } }
      else { var nl = v.indexOf("\n", a); if (nl < 0) pos = v.length; else { var ne = v.indexOf("\n", nl + 1); pos = Math.min(ne < 0 ? v.length : ne, nl + 1 + col); } }
    } else return;
    ta.setSelectionRange(pos, pos);
    ta.dispatchEvent(new Event("select"));
  }
  function taKey(ta, key, ctrl) {
    if (key.length === 1 && !ctrl) return insertText(ta, key);
    if (ta.dispatchEvent(keyEvent("keydown", key, ctrl))) caretMove(ta, key);
    ta.dispatchEvent(keyEvent("keyup", key, ctrl));
  }
  // 真终端：特殊键走 xterm 自己的按键处理（光标键模式、修饰键它自己算）；字符直接当输入给它
  function ptyText(x, s) {
    x.dispatchEvent(keyEvent("keyup", "Unidentified")); // 让 xterm 忘掉上一个按键（不然它当这次输入已经处理过）
    x.dispatchEvent(new InputEvent("input", { data: s, inputType: "insertText", bubbles: true }));
  }
  function ctrlChar(k) { var c = k.toUpperCase().charCodeAt(0); return c >= 64 && c <= 95 ? String.fromCharCode(c - 64) : k === "?" ? "\x7f" : k === "/" ? "\x1f" : k === " " ? "\x00" : k; }
  function ptyKey(x, key, ctrl) {
    if (key.length === 1) return ptyText(x, ctrl ? ctrlChar(key) : key);
    x.dispatchEvent(keyEvent("keydown", key, ctrl));
    x.dispatchEvent(keyEvent("keyup", key, ctrl));
  }
  function sendKey(key, ctrl) {
    var inp = inputOf(activePane());
    if (!inp) return false;
    if (inp.kind === "pty") ptyKey(inp.el, key, ctrl); else taKey(inp.el, key, ctrl);
    return true;
  }
  function sendText(text) {
    var inp = inputOf(activePane());
    if (!inp) return;
    if (inp.kind === "pty") ptyText(inp.el, text); else insertText(inp.el, text);
  }

  // ======== 键盘上面的附加键 ========
  var ACC_H = 46;
  var KEYS = [["esc", "Escape"], ["tab", "Tab"], ["ctrl", "ctrl"], ["↑", "ArrowUp"], ["↓", "ArrowDown"], ["←", "ArrowLeft"], ["→", "ArrowRight"], ["/", "/"], ["!", "!"],
    ['<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="12" height="15" rx="2.5"/><path d="M8.5 4V2.8h5V4" stroke-linecap="round"/><path d="M8.5 9.5h5M8.5 13h5" stroke-linecap="round"/></svg>', "paste", "粘贴"],
    ['<svg viewBox="0 0 26 22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="22" height="12" rx="2.5"/><path d="M6 6h.01M10 6h.01M14 6h.01M18 6h.01M8 10h10"/><path d="m9.5 17.5 3.5 3 3.5-3"/></svg>', "hide", "收起键盘"]];
  var acc = h("div", null, '<div class="acc-keys"></div><div class="acc-toast" hidden></div>');
  acc.id = "ios-acc";
  var keysEl = acc.firstChild, toastEl = acc.lastChild;
  KEYS.forEach(function (k) {
    var b = h("button", "acc-k" + (k[0].length > 1 && k[0][0] !== "<" ? " acc-w" : ""), k[0]);
    b.type = "button";
    b.dataset.k = k[1];
    b.setAttribute("aria-label", k[2] || k[0]);
    b.tabIndex = -1;
    keysEl.appendChild(b);
  });
  document.body.appendChild(acc);
  root.style.setProperty("--ios-acc-full", ACC_H + "px");
  var ctrl = 0, ctrlTap = 0, eatInput = 0, repeatT = 0, repeatI = 0, toastT = 0;
  var ctrlBtn = keysEl.querySelector('[data-k="ctrl"]');
  function setCtrl(v) { ctrl = v; ctrlBtn.classList.toggle("on", v > 0); ctrlBtn.classList.toggle("lock", v === 2); }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }
  function press(k) {
    if (k === "ctrl") { var t = now(); if (ctrl && t - ctrlTap < 350) setCtrl(2); else setCtrl(ctrl ? 0 : 1); ctrlTap = t; return; }
    if (k === "hide") { var a = document.activeElement; if (a && a.blur) a.blur(); return; }
    if (k === "paste") return;
    sendKey(k, ctrl > 0);
    if (ctrl === 1) setCtrl(0);
  }
  function stopRepeat() { clearTimeout(repeatT); clearInterval(repeatI); repeatT = repeatI = 0; keysEl.querySelectorAll(".down").forEach(function (b) { b.classList.remove("down"); }); }
  // 按住不放：焦点留在输入框里（不让按钮抢走，键盘不收）；方向键按住会连发
  acc.addEventListener("touchstart", function (e) { e.preventDefault(); }, { passive: false });
  acc.addEventListener("mousedown", function (e) { e.preventDefault(); });
  acc.addEventListener("pointerdown", function (e) {
    var b = e.target.closest("button[data-k]");
    if (!b) return;
    e.preventDefault();
    stopRepeat();
    b.classList.add("down");
    var k = b.dataset.k;
    press(k);
    if (/^Arrow/.test(k)) repeatT = setTimeout(function () { repeatI = setInterval(function () { press(k); }, 70); }, 380);
  });
  var pasteAt = 0;
  function pasteUp(e) {
    var b = e.target.closest && e.target.closest('button[data-k="paste"]');
    stopRepeat();
    if (!b || now() - pasteAt < 400) return;
    pasteAt = now();
    doPaste();
  }
  acc.addEventListener("touchend", pasteUp); // 读剪贴板要在「用户手势」里：touchend 算
  acc.addEventListener("pointerup", function (e) { if (e.pointerType === "mouse") pasteUp(e); else stopRepeat(); });
  acc.addEventListener("pointercancel", stopRepeat);
  acc.addEventListener("pointerleave", stopRepeat);
  // 粘贴：先按一次真的「粘贴」事件发给输入框（agent 的输入框会把很长的一段收成 [Pasted text #1]，真终端走它的括号粘贴）
  function synthPaste(el, text) {
    try {
      var dt = new DataTransfer();
      dt.setData("text/plain", text);
      var ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      if (!ev.clipboardData || ev.clipboardData.getData("text/plain") !== text) return null;
      return el.dispatchEvent(ev);
    } catch (e) { return null; }
  }
  function doPaste() {
    var inp = inputOf(activePane());
    if (!inp) return;
    if (!navigator.clipboard || !navigator.clipboard.readText) return toast("Paste isn't available in this browser");
    navigator.clipboard.readText().then(function (t) {
      if (!t) return toast("The clipboard is empty");
      var r = synthPaste(inp.el, t);
      if (inp.kind === "pty") { if (r === null) ptyText(inp.el, t); return; }
      if (r !== false) insertText(inp.el, t);
    }, function () { toast("Clipboard access was denied"); });
  }
  // ctrl 粘住时，屏幕键盘上敲的下一个字符变成 ctrl+它
  function ctrlFromKeyboard(target, k) {
    if (ctrl === 1) setCtrl(0);
    if (target.classList.contains("xterm-helper-textarea")) return ptyText(target, ctrlChar(k));
    target.dispatchEvent(keyEvent("keydown", k.toLowerCase(), true));
  }
  document.addEventListener("keydown", function (e) {
    if (!ctrl || !e.isTrusted || e.ctrlKey || e.metaKey || !termInput(e.target) || !e.key) return;
    // 换行键也算：ctrl + 换行 = ctrl+enter（agent 答着的时候不排队，打断它马上发；真终端里就是回车）
    var enter = e.key === "Enter" && !e.shiftKey && !e.altKey && !e.isComposing && e.keyCode !== 229;
    if (!enter && e.key.length !== 1) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    eatInput = now();
    if (!enter) return ctrlFromKeyboard(e.target, e.key);
    if (ctrl === 1) setCtrl(0);
    if (e.target.classList.contains("xterm-helper-textarea")) ptyKey(e.target, "Enter", true);
    else taKey(e.target, "Enter", true);
  }, true);
  document.addEventListener("beforeinput", function (e) {
    if (!termInput(e.target)) return;
    if (eatInput && now() - eatInput < 400) { eatInput = 0; e.preventDefault(); return; }
    if (ctrl && e.inputType === "insertText" && e.data) { e.preventDefault(); ctrlFromKeyboard(e.target, e.data.slice(-1)); }
  }, true);

  // 什么时候出来：前台是终端、焦点在它的输入上。真手机上跟着屏幕键盘一起出来（贴在键盘上面）；电脑上看时没有屏幕键盘，放在指示条上面
  function syncAcc() {
    var a = document.activeElement, w = I.fg(), show = !!(w && isTerm(w) && termInput(a) && w.el.contains(a) && (I.sim || I.keyboard().up));
    if (show === root.classList.contains("ios-acc-on")) return;
    root.classList.toggle("ios-acc-on", show);
    root.style.setProperty("--ios-acc-h", show ? ACC_H + "px" : "0px");
    if (!show) { stopRepeat(); if (ctrl !== 2) setCtrl(0); }
  }
  document.addEventListener("focusin", syncAcc);
  window.addEventListener("focus", syncAcc);
  setTimeout(syncAcc, 1500);
  document.addEventListener("focusout", function () { setTimeout(syncAcc, 80); });
  I.on("fg", function () { setTimeout(syncAcc, 0); });
  I.on("kb", syncAcc);

  // ======== 斜杠命令菜单：点一项 = 选它（没参数的直接执行；带参数的填进输入框，接着打参数）========
  document.addEventListener("click", function (e) {
    var foot = e.target.closest && e.target.closest(".tpane .foot");
    if (!foot) return;
    var pane = foot.closest(".tpane"), ta = pane.querySelector(".ta");
    if (!agentPane(pane) || !ta || !/^\/\S*$/.test(ta.value)) return;
    var inputEl = foot.querySelector(".input"), lh = parseFloat(getComputedStyle(foot).lineHeight) || 17, r = inputEl.getBoundingClientRect();
    var line = (inputEl.textContent.split("\n")[Math.floor((e.clientY - r.top) / lh)] || "");
    var m = /^\s*(\/[^\s❯]+)( \S)?/.exec(line); // 菜单的一行：「  /名字 参数   说明」；参数和名字之间只隔一个空格
    if (!m || /^\s*[❯!]/.test(line)) return;
    e.preventDefault();
    e.stopPropagation();
    ta.focus({ preventScroll: true });
    ta.value = m[1] + (m[2] ? " " : "");
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    if (!m[2]) taKey(ta, "Enter", false);
  });

  // ======== 终端窗口：导航栏按钮、标签页栏 ========
  function menuItem(w, re) {
    var hit = null;
    try { (w.menus ? w.menus() || [] : []).some(function (m) { return (m.items || []).some(function (x) { if (x && x.label && re.test(x.label) && x.run && !x.disabled) { hit = x; return true; } return false; }); }); } catch (e) { hit = null; }
    return hit;
  }
  // agent 列表：在 agent 里 = 空输入按 ←（有字就先借用一下输入框：/agents，再把字放回去）；在 shell 里先敲 paimon 进 agent 再打开
  function agents(w) {
    var p = activePane(w), inp = inputOf(p);
    if (!p || !inp) return;
    if (agentPane(p)) return openAgentsPanel(p);
    if (inp.kind === "pty") ptyText(inp.el, "paimon\r");
    else { inp.el.value = "paimon"; inp.el.dispatchEvent(new Event("input", { bubbles: true })); taKey(inp.el, "Enter", false); }
    var t0 = now();
    (function wait() { var q = activePane(w); if (q && agentPane(q)) return openAgentsPanel(q); if (now() - t0 < 3000) setTimeout(wait, 120); })();
  }
  function openAgentsPanel(p) {
    var ta = p.querySelector(".ta"), draft = ta.value;
    if (document.activeElement !== ta) ta.focus({ preventScroll: true });
    if (!draft) return taKey(ta, "ArrowLeft", false);
    ta.value = "/agents";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    taKey(ta, "Enter", false);
    ta.value = draft;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  // 左边栏（live.js 的 lab：这个窗口里所有 agent）：手机上当抽屉用；没有边栏的老版本退回 ← 面板
  function side(w, on) {
    var lab = w.el.querySelector(".tlab"), btn = w.el.querySelector(".ts-btn");
    if (!lab || !btn) return false;
    var shown = !lab.classList.contains("off");
    if (on === undefined) on = !shown;
    if (on !== shown) btn.click();
    if (on) { var a = document.activeElement; if (a && termInput(a)) a.blur(); }
    return true;
  }
  function setupWin(w) {
    if (!isTerm(w) || w.__iosTerm) return;
    w.__iosTerm = true;
    I.navButton(w, { id: "agents", side: "l", icon: SIDEBAR, label: "Agent", run: function () { if (!side(w)) agents(w); } });
    // 抽屉开着：点了一个 agent（或新建）就收起；点暗处也收起（不把焦点给终端）
    w.el.addEventListener("click", function (e) {
      var lab = w.el.querySelector(".tlab");
      if (!lab || lab.classList.contains("off")) return;
      if (e.target.closest(".ts-it") || e.target.closest('.ts-act[data-act="new"]')) setTimeout(function () { side(w, false); }, 0);
      else if (e.target.classList && e.target.classList.contains("tmain")) { e.stopPropagation(); side(w, false); }
    }, true);
    w.el.addEventListener("mouseup", function (e) { if (e.target.classList && e.target.classList.contains("tmain")) e.stopPropagation(); }, true);
    I.navButton(w, { id: "tab", icon: PLUS, label: "新建标签页", before: "more", run: function () { var it = menuItem(w, /^新建标签页/); if (it) it.run(); } });
    var tabs = w.el.querySelector(".tabs");
    if (!tabs) return;
    // 手指在标签页栏上：只是点和左右划（live.js 的拖标签页分屏是给鼠标的）
    tabs.addEventListener("pointerdown", function (e) { if (e.pointerType !== "mouse") e.stopPropagation(); }, true);
    var centerOn = function () {
      var on = tabs.querySelector(".tab.on");
      if (on && tabs.scrollWidth > tabs.clientWidth) tabs.scrollLeft = on.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2;
    };
    new MutationObserver(function () { setTimeout(centerOn, 0); }).observe(tabs, { childList: true });
  }
  Object.keys(D.apps).forEach(function (k) { setupWin(D.apps[k]); });
  I.on("win", setupWin);
  // 手机上不分屏：菜单里去掉分屏、在窗格之间移动那几项
  I.menuFilter(function (w, a) { return !(isTerm(w) && a && a.label && /窗格/.test(a.label)); });
})();
