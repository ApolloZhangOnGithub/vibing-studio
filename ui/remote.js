// remote.js —— Vibing Studio 的 iPad 端（浏览器里打开，不是 App）：选了「用我的 Mac」以后，window.nadosNative 换成经中转（服务端 src/relay.js）
//   连到那台 Mac 的一份——接口和 App 注入的那份一样（call / on / off），所以终端、文件、Claude Code / Codex 的会话这些（local.js 的 TSU_LOCAL）
//   照样能用，只是都在 Mac 上跑。Mac 那边要在 设置 › 通用 里打开「其他设备使用这台 Mac」，第一次连上来时在 Mac 上点一次「允许」（studio/remote-host.js）。
//   必须在别的脚本之前载入（它们一载入就看 window.nadosNative 在不在）。
//   选哪台 Mac：?mac=<设备 id>（记在 localStorage vs-remote-mac）；?mac=off 不再连。剪贴板、打开外部链接用 iPad 自己的
(function () {
  "use strict";
  if (window.nadosNative) return; // App 里：原生的那份
  var q = new URLSearchParams(location.search), KEY = "vs-remote-mac";
  if (q.get("mac") === "off") localStorage.removeItem(KEY);
  else if (q.get("mac")) localStorage.setItem(KEY, q.get("mac"));
  var mac = localStorage.getItem(KEY) || "";
  // iPad App：打开到能用之前的每一步告诉 App（它盖着的那一层照着写：找 Mac、连哪台、等了几秒、出了什么错）；能用了以后不再报
  var bootDone = false, boot = function (step, extra) {
    if (bootDone || !window.vsApp) return;
    if (step === "ready" || step === "veil") bootDone = step === "ready";
    try { webkit.messageHandlers.vsApp.postMessage(Object.assign({ type: "boot", step: step }, extra || {})); } catch (e) { /* 不在 App 里 */ }
  };
  // iPhone 先认（App 的 UA 里带着「VibingStudioiPad」，以前 iPhone 也被当成 iPad、在 Mac 上授权列表里写成 iPad）；触屏的那些适配 iPhone 也要
  var ua = navigator.userAgent, isPhone = /iPhone/.test(ua), isPad = !isPhone && (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)), root = document.documentElement;
  // 选 Mac 的入口（⚙ 菜单里「连接到我的 Mac…」）：网页版都有，连没连上都能换
  window.TSU_REMOTE = {
    mac: function () { return mac; },
    pick: function () {
      return fetch("/api/relay/hosts", { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
    },
    use: function (dev, name) {
      if (dev) localStorage.setItem(KEY, dev); else localStorage.removeItem(KEY);
      if (name) localStorage.setItem("vs-remote-mac-name", name);
      var u = new URLSearchParams(location.search); u.set("mac", dev || "off"); // 别的参数（?open= 要开的会话）留着
      location.replace(location.pathname + "?" + u.toString());
    },
    isPad: isPad,
  };
  // iPad（连不连 Mac 都一样）：长按 = 右键菜单（iPad 的 Safari 不给网页 contextmenu 事件——标签页、侧栏的菜单都打不开）；
  //   点按时不闪灰底、字号不被 Safari 自动放大、整页不跟着手指回弹
  if (isPad || isPhone) {
    root.classList.add("ipad");
    if (isPhone) root.classList.add("iphone", "st-phone"); // st-phone：手机的版面（贴边、标签栏在最上面……；窄的浏览器窗口 studio.js 也会加）
    // 手指点一下：iOS 先补发一串鼠标事件（mouseover、mouseenter、mousemove……），页面上悬停才出现的东西（提示、预览、按钮）一冒出来，
    //   这一下就只算悬停、不算点按——要点两次。刚摸过屏幕的这一阵，这些鼠标事件不交给页面（真的点按 click 照常）
    var touchAt = 0, touchEl = null;
    document.addEventListener("touchstart", function (e) { touchAt = Date.now(); touchEl = e.target; }, { capture: true, passive: true });
    // 键盘只在点了输入的地方才出来：点对话、标签页、侧栏、按钮时，页面顺手把焦点给输入框（电脑上方便直接打字）——手机上那样每点一下都弹键盘。
    //   刚点过、点的又不是输入的地方：页面要给输入框的焦点不给（直接点在输入框、搜索框、编辑器上的照常）
    var typingAt = function (el) { return !!(el && el.closest && el.closest(".foot, textarea, input, select, [contenteditable], .cm-editor, .st-cm, .gv-bottom, .gv-input, .ss-search, .st-sbox")); };
    var focus0 = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (o) {
      var t = this.tagName;
      if ((t === "TEXTAREA" || t === "INPUT" || this.isContentEditable) && Date.now() - touchAt < 1500 && !typingAt(touchEl)) return;
      return focus0.call(this, o);
    };
    ["mouseover", "mouseout", "mouseenter", "mouseleave", "mousemove"].forEach(function (t) {
      window.addEventListener(t, function (e) { if (Date.now() - touchAt < 1000) e.stopImmediatePropagation(); }, true);
    });
    var ist = document.createElement("style");
    ist.textContent = "html.ipad .tpane, html.ipad .tpane *:not(textarea):not(input) { -webkit-user-select: none !important; user-select: none !important; -webkit-touch-callout: none !important; } html.ipad .tpane textarea { -webkit-user-select: text !important; user-select: text !important; } " + // 对话、输入框那一块都不让系统自己选字（一碰整屏选中、整格泛蓝）：长按菜单里「复制这一段」 // 对话里不让系统选字（一碰整屏选中）：长按菜单里「复制这一段」
      "html.ipad, html.ipad * { -webkit-tap-highlight-color: transparent; } html.ipad { -webkit-text-size-adjust: 100%; } html.ipad body { overscroll-behavior: none; } html.ipad body * { overscroll-behavior: none !important; } html.ipad .tabs, html.ipad .tside, html.ipad .st-act { -webkit-touch-callout: none; -webkit-user-select: none; } html.ipad .bar > i { display: none !important; } html.ipad, html.ipad body { touch-action: pan-x pan-y; overscroll-behavior: none; } html.ipad body { position: fixed; inset: 0; overflow: hidden; } html.ipad *:focus, html.ipad *:focus-visible { outline: none !important; }"; // 接着实体键盘时 iPad 的 WebKit 给点到的输入框画一圈蓝框（输入框盖着整块对话）、一直挂着 // 红黄绿三个灯是 Mac 窗口的，iPad 上没有
    (document.head || document.documentElement).appendChild(ist);
    var lp = null, lpOff = function () { if (lp) { clearTimeout(lp.t); lp = null; } };
    document.addEventListener("touchstart", function (e) {
      lpOff();
      if (e.touches.length !== 1) return;
      var t = e.touches[0], x = t.clientX, y = t.clientY, el = e.target;
      lp = { x: x, y: y, t: setTimeout(function () { lp = null; el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2, buttons: 2 })); }, 550) };
    }, { passive: true });
    document.addEventListener("touchmove", function (e) { if (!lp) return; var t = e.touches[0]; if (Math.abs(t.clientX - lp.x) > 8 || Math.abs(t.clientY - lp.y) > 8) lpOff(); }, { passive: true });
    document.addEventListener("touchend", lpOff, { passive: true });
    document.addEventListener("touchcancel", lpOff, { passive: true });
  }
  // ---- 连不上、没被允许：盖在页面上的一句话（连上了自己消失）----
  var veil = null;
  function say(title, text, retryBtn) {
    if (!document.body) return document.addEventListener("DOMContentLoaded", function () { say(title, text, retryBtn); });
    if (!veil) {
      veil = document.createElement("div");
      veil.className = "rm-veil";
      veil.innerHTML = '<div class="rm-card"><b></b><p></p><div class="rm-acts"><button type="button" data-rm="retry">重试</button><button type="button" data-rm="off">只用网页版</button></div></div>';
      veil.addEventListener("click", function (e) { var b = e.target.closest("[data-rm]"); if (!b) return; if (b.dataset.rm === "retry") location.reload(); else window.TSU_REMOTE.use(""); });
      document.body.appendChild(veil);
    }
    boot("veil");
    veil.querySelector("b").textContent = title;
    veil.querySelector("p").textContent = text;
    veil.querySelector('[data-rm="retry"]').hidden = !retryBtn;
    veil.hidden = false;
  }
  function unsay() { if (veil) veil.hidden = true; if (authCard) authCard.hidden = true; authNow = ""; }
  var authCard = null, authNow = "";
  function authShow(st, msg) {
    if (!document.body) return document.addEventListener("DOMContentLoaded", function () { authShow(st, msg); });
    if (st === authNow && !msg) return;
    authNow = st;
    if (veil) veil.hidden = true;
    if (!authCard) {
      authCard = document.createElement("div");
      authCard.className = "rm-veil rm-auth";
      document.body.appendChild(authCard);
      authCard.addEventListener("click", function (e) {
        var b = e.target.closest("[data-ra]"); if (!b) return;
        if (b.dataset.ra === "retry") { authNow = ""; api.call("auth.retry").catch(function () {}); authShow("asking"); }
        else if (b.dataset.ra === "off") window.TSU_REMOTE.use("");
      });
    }
    boot("veil");
    var M = esc(macName), html = "";
    if (st === "connecting") html = '<div class="rm-spin"></div><b>正在连接「' + M + '」</b>';
    else if (st === "asking") html = '<div class="rm-spin"></div><b>等待「' + M + '」允许</b><p>请在这台 Mac 上点按「允许」。之后 Mac 上会显示一个 6 位验证码，在这里输入。</p>';
    else if (st === "code") html = '<b>输入验证码</b><p>输入「' + M + '」上显示的 6 位验证码。</p><input class="rm-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="······" aria-label="验证码"><p class="rm-err">' + esc(msg || "") + '</p>';
    else if (st === "expired") html = '<b>验证码已过期</b><p>重新请求，「' + M + '」上会再显示一个新的验证码。</p><div class="rm-acts"><button type="button" data-ra="off">只用网页版</button><button type="button" data-ra="retry" class="rm-pri">重新请求</button></div>';
    else if (st === "denied") html = '<b>「' + M + '」没有允许这台设备</b><p>' + esc(msg || "可以重新请求，在 Mac 上点按「允许」。") + '</p><div class="rm-acts"><button type="button" data-ra="off">只用网页版</button><button type="button" data-ra="retry" class="rm-pri">重新请求</button></div>';
    authCard.innerHTML = '<div class="rm-card">' + html + "</div>";
    authCard.hidden = false;
    var inp = authCard.querySelector(".rm-code");
    if (inp) {
      setTimeout(function () { inp.focus(); }, 30);
      inp.addEventListener("input", function () {
        inp.value = inp.value.replace(/\D/g, "").slice(0, 6);
        if (inp.value.length < 6) return;
        var code = inp.value; inp.disabled = true;
        api.call("auth.code", { code: code }).then(function () { authNow = ""; if (authCard) authCard.hidden = true; }, function (e) {
          if (e && e.code === "E_EXPIRED") return authShow("expired");
          if (e && e.code === "E_DENIED") return authShow("denied", e.message);
          authShow("code", e && e.code === "E_CODE" ? "验证码不正确，请再输入一次。" : (e && e.message) || "没有验证成功，请再试一次。");
        });
      });
    }
  }
  var esc = function (t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  // 底下一行小字（不挡东西、点不到）；空字 = 收起。iPad Native 里不用（App 自己在输入框上面写）
  var tst = null, offT = 0;
  function toast(text) {
    if (window.vsApp && window.vsApp.shell === "native") return;
    if (!document.body) return;
    if (!tst) { tst = document.createElement("div"); tst.className = "rm-toast"; tst.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483600;padding:5px 12px;border-radius:12px;background:rgba(40,40,40,.88);color:#ddd;font:12px -apple-system,sans-serif;pointer-events:none"; document.body.appendChild(tst); }
    tst.textContent = text; tst.hidden = !text;
  }

  // 还没选 Mac 的客户端（iPhone、iPad 的 App，浏览器里的网页端都一样——网页端就是一个连到 Mac 的客户端）：自己找——只有一台在线就直接连上；
  //   几台的列出来点一台；一台都没有就说怎么打开
  if (!mac && q.get("mac") !== "off") { // 点过「只用网页版」（?mac=off）的不再自己连
    var findMac = function () {
      boot("finding");
      window.TSU_REMOTE.pick().then(function (hosts) {
        hosts = (hosts || []).filter(function (h) { return h && h.device; });
        if (hosts.length === 1) { boot("connecting", { mac: hosts[0].name || "" }); return window.TSU_REMOTE.use(hosts[0].device, hosts[0].name); }
        if (!hosts.length) return say("Mac 不在线", "请在 Mac 上的 Vibing Studio 中打开「设置 › 通用 › 其他设备使用这台 Mac」，然后重试。", true);
        say("选择要连接的 Mac", "", false);
        var acts = veil.querySelector(".rm-acts");
        acts.querySelectorAll("[data-mac]").forEach(function (b) { b.remove(); });
        hosts.forEach(function (h) { var b = document.createElement("button"); b.type = "button"; b.dataset.mac = h.device; b.textContent = h.name || h.device; b.onclick = function () { window.TSU_REMOTE.use(h.device, h.name); }; acts.insertBefore(b, acts.firstChild); });
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", findMac); else findMac();
  }
  if (!mac) return;
  var cid = localStorage.getItem("vs-remote-client");
  if (!cid) { cid = "dev-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); localStorage.setItem("vs-remote-client", cid); }
  var brName = function () {
    var b = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "浏览器";
    var os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
    return os ? b + "（" + os + "）" : b;
  };
  var cname = isPhone ? "iPhone" : isPad ? "iPad" : brName();
  var macName = localStorage.getItem("vs-remote-mac-name") || "你的 Mac";
  var ws = null, up = false, outQ = [], pend = {}, parts = {}, subs = {}, seq = 0, retry = 0, state = "connecting", hostInfo = null;
  root.classList.add("remote-mac");

  var api = {
    platform: "remote", app: "Vibing Studio", version: "remote", protocol: 1, local: true, remote: true, mac: mac,
    call: function (cmd, args) {
      cmd = String(cmd); args = args == null ? {} : args;
      // iPad 自己的：剪贴板、打开链接、通知（不送去 Mac）
      if (cmd === "clipboard.write") return navigator.clipboard ? navigator.clipboard.writeText(String(args.text || "")).then(function () { return null; }) : Promise.resolve(null);
      if (cmd === "clipboard.read") return navigator.clipboard && navigator.clipboard.readText ? navigator.clipboard.readText().then(function (t) { return { text: t }; }) : Promise.resolve({ text: "" });
      if (cmd === "openExternal") { try { window.open(String(args.url || ""), "_blank", "noopener"); } catch (e) { /* 拦了就算了 */ } return Promise.resolve(null); }
      if (cmd === "notify" || cmd === "badge" || cmd === "attention" || /^window\.|^menu\./.test(cmd)) return Promise.resolve(null);
      return new Promise(function (resolve, reject) {
        var id = ++seq;
        pend[id] = { resolve: resolve, reject: reject, cmd: cmd, t: setTimeout(function () { if (pend[id]) { delete pend[id]; var e = new Error("Mac 未响应（" + cmd + "）"); e.code = "E_TIMEOUT"; reject(e); } }, cmd === "cc.sessions" || cmd === "cc.search" ? 120000 : 60000) };
        var m = JSON.stringify({ id: id, cmd: cmd, args: args });
        if (up) ws.send(m); else outQ.push(m);
      });
    },
    on: function (type, fn) { (subs[type] = subs[type] || []).push(fn); return function () { api.off(type, fn); }; },
    off: function (type, fn) { subs[type] = (subs[type] || []).filter(function (f) { return f !== fn; }); },
    _emit: function (type, detail) {
      (subs[type] || []).slice().forEach(function (f) { try { f(detail); } catch (e) { console.error(e); } });
      window.dispatchEvent(new CustomEvent("nados-native", { detail: { type: type, detail: detail } }));
    },
    state: function () { return state; },
    host: function () { return hostInfo; },
    // 盯着 Mac 上一个文件往后长的部分（会话记录）：Mac 那边（remote-host.js）每 0.2 秒看一眼、长了把新写的整行推过来（tail.data）；
    //   断线重连、Mac 那边重新载入以后，从现在读到的位置接着盯
    tail: function (path, offFn, cb) {
      var key = String(path), me = { off: offFn, cb: cb };
      tailing[key] = me;
      var watch = function () { if (tailing[key] === me) api.call("tail.watch", { path: key, offset: offFn() }).then(function () { me.ok = true; }, function () { me.ok = false; /* 老版本的 Mac 不认：照旧自己读 */ }); };
      watch();
      return { rewatch: watch, live: function () { return me.ok === true && state === "open"; }, stop: function () { if (tailing[key] !== me) return; delete tailing[key]; api.call("tail.unwatch", { path: key }).catch(function () {}); } };
    },
  };
  var tailing = {};
  var rewatchAll = function () { Object.keys(tailing).forEach(function (k) { api.call("tail.watch", { path: k, offset: tailing[k].off() }).catch(function () {}); }); };
  Object.defineProperty(window, "nadosNative", { value: api, enumerable: false, configurable: false, writable: false });

  function done(m) {
    var p = pend[m.id];
    if (!p) return;
    delete pend[m.id];
    clearTimeout(p.t);
    if (m.ok) { if (p.cmd === "info") hostInfo = m.value; if (!firstOk) { firstOk = true; clearTimeout(waitT); if (authNow && authNow !== "code") { authNow = ""; if (authCard) authCard.hidden = true; } } boot("ready"); return p.resolve(m.value); } // Mac 回话了：能用了
    var e = new Error((m.error && m.error.message) || "Mac 上没做成"); e.code = (m.error && m.error.code) || "E_FAILED";
    if (e.code === "E_DENIED" && /没有允许|未授权/.test(e.message) && p.cmd !== "auth.code") { state = "denied"; boot("denied"); return (authShow("denied"), p.reject(e)); say("这台 Mac 未授权此设备", "请在 Mac 上的 Vibing Studio 中打开「设置 › 通用 › 其他设备使用这台 Mac」，然后重试，Mac 上会请求授权。", true); }
    p.reject(e);
  }
  var firstOk = false, waitT = 0;
  function connect() {
    boot("connecting");
    if (!firstOk && !window.vsApp) authShow("connecting"); // App 里有自己的载入层（BootView）
    // 老版本的 Mac（不会说在等什么）：过 3 秒还没回话，多半是在等那边点「允许」
    clearTimeout(waitT); waitT = setTimeout(function () { if (!firstOk && (authNow === "connecting" || authNow === "")) authShow("asking"); }, 3000);
    var u = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/relay/client?device=" + encodeURIComponent(mac) + "&client=" + encodeURIComponent(cid) + "&cname=" + encodeURIComponent(cname);
    try { ws = new WebSocket(u); } catch (e) { return later(); }
    ws.onopen = function () { boot("waiting"); var again = retry > 0 || seq > 0; up = true; retry = 0; state = "open"; var l = outQ; outQ = []; l.forEach(function (m) { ws.send(m); }); if (again) rewatchAll(); };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      // Mac 那边断了（它的 App 更新、重新载入，一会儿就回来）：不盖整屏、不重新载入（以前一断就整屏盖住，回来时整页重载——iPad 上黑一下）；
      //   断了 4 秒还没回来才在底下一行小字，回来了就收起，页面接着用
      if (m.sys === "host-offline") { boot("offline"); state = "offline"; clearTimeout(offT); offT = setTimeout(function () { if (state === "offline") toast("无法连接到 Mac，正在重新连接"); }, 4000); return; }
      if (m.sys === "host-online") { clearTimeout(offT); if (state === "offline") state = "open"; toast(""); rewatchAll(); return; }
      if (m.sys === "auth") { if (m.host) { macName = m.host; localStorage.setItem("vs-remote-mac-name", m.host); } if (m.state === "ok") { authNow = ""; if (authCard) authCard.hidden = true; } else authShow(m.state); return; }
      if (m.sys) return;
      if (m.ev === "tail.data") { var tw0 = m.detail && tailing[m.detail.path]; if (tw0) tw0.cb(m.detail); return; }
      if (m.ev) return api._emit(m.ev, m.detail);
      if (m.parts != null) { // 大的回复分块来的：拼齐了再当一条
        var b = parts[m.id] || (parts[m.id] = []);
        b[m.part] = m.s;
        if (b.filter(function (x) { return x != null; }).length < m.parts) return;
        delete parts[m.id];
        try { m = JSON.parse(b.join("")); } catch (e) { return; }
      }
      if (m.id != null) { unsay(); done(m); }
    };
    ws.onclose = function () { up = false; ws = null; if (state === "denied") return; state = "connecting"; later(); };
    ws.onerror = function () { /* onclose 接着来 */ };
  }
  function later() { retry = Math.min(retry + 1, 6); setTimeout(connect, 800 * Math.pow(2, retry - 1)); }
  setInterval(function () { if (up) { try { ws.send('{"sys":"ping"}'); } catch (e) { /* 断了 */ } } }, 25000);
  connect();
  // 对话的翻译设置照 Mac 上的（任务翻译、回复翻译、译文出现方式）：iPad 自己的默认是关着的——Mac 上早翻好的，这边一直是原文
  window.addEventListener("load", function () {
    api.call("agents.cfg").then(function (c) {
      var A = window.TSU_AGENTS; if (!c || !A || !A.setCfgMany) return;
      var first = c._full && localStorage.getItem("vs-cloned-cfg") !== mac, SHARED = ["translateTasks", "translateReplies", "translateShow"], ch = {};
      Object.keys(c).forEach(function (k) { if (k === "_full") return; if ((first || SHARED.indexOf(k) >= 0) && JSON.stringify(A.cfg[k]) !== JSON.stringify(c[k])) ch[k] = c[k]; });
      if (Object.keys(ch).length) A.setCfgMany(ch);
      if (first) localStorage.setItem("vs-cloned-cfg", mac); // 第一次照 Mac 的整份抄（运行状态行、状态信息……），之后各管各的
    }, function () { /* 老版本的 Mac 不认：照这台设备自己的 */ });
  });
  // ?open=<agent id>：打开就进这段会话（链接、通知点进来的）
  var openId = q.get("open");
  // 会话列表要先从 Mac 那边读回来：开不出来就隔一会儿再试，直到有一格是它（最多 30 秒）
  if (openId) window.addEventListener("load", function () {
    var n = 0, has = function () { var tw = window.TSU_TERM && TSU_TERM.front && TSU_TERM.front(); return !!(tw && tw.ws.all().some(function (p) { return p.program && p.program.agentId === openId; })); };
    (function go() { if (has()) return; if (window.TSU_TERM && TSU_TERM.agent && TSU_TERM.front && TSU_TERM.front()) { try { TSU_TERM.agent(openId); } catch (e) { /* 还没好 */ } } if (++n < 30) setTimeout(go, 1000); })();
  });
})();
