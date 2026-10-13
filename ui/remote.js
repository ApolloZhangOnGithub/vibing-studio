// remote.js —— 用另一台 Mac：window.nadosNative 换成经中转（服务端 src/relay.js）连到那台 Mac 的一份——接口和 App 注入的那份一样（call / on / off），
//   所以终端、文件、Claude Code / Codex 的会话这些（local.js 的 TSU_LOCAL）照样能用，只是都在那台 Mac 上跑。
//   两种用法：
//   · iPad、iPhone、浏览器里的网页端：整页都连那台 Mac（剪贴板、打开外部链接用这台设备自己的）。?mac=<设备 id>（记在 localStorage vs-remote-mac）；?mac=off 不再连
//   · Mac / Linux 的 App 里，连着另一台 Mac 的窗口（AppDelegate.newWindow 开的，?mac=）：App 的桥被 bridge.js 改名成 __nadosLocal 交过来——
//     终端、文件、会话转到那台 Mac；窗口、菜单、剪贴板、通知、内置浏览器、设置文件用这台的（hybrid）
//   那台 Mac 要在 设置 › 通用 里打开「其他设备使用这台 Mac」。认设备：这台设备有一把自己的密钥（P-256，私钥存在这台设备上、拿不出来），
//   连上时那台 Mac 出一个随机数，这边签名，验对了按它选的连入方式放行（直接允许 / 第一次确认 / 每次确认 / 验证码，见 app/Sources/RemoteHost.swift）。
//   必须在别的脚本之前载入（它们一载入就看 window.nadosNative 在不在）。
(function () {
  "use strict";
  if (window.nadosNative) return; // App 的普通窗口：原生的那份
  var LN = window.__nadosLocal || null; // App 里连着另一台 Mac 的窗口：这台 App 自己的桥
  var q = new URLSearchParams(location.search), KEY = "vs-remote-mac";
  var hybrid = !!(LN && q.get("mac") && q.get("mac") !== "off");
  if (!hybrid) {
    if (q.get("mac") === "off") localStorage.removeItem(KEY);
    else if (q.get("mac")) localStorage.setItem(KEY, q.get("mac"));
  }
  var mac = hybrid ? q.get("mac") : localStorage.getItem(KEY) || "";
  var en = function () { var I = window.TSU_I18N; return !!(I && I.lang && I.lang() === "en"); };
  var tr = function (zh, e) { return en() ? e : zh; };
  // iPad App：打开到能用之前的每一步告诉 App（它盖着的那一层照着写：找 Mac、连哪台、等了几秒、出了什么错）；能用了以后不再报
  var bootDone = false, boot = function (step, extra) {
    if (bootDone || !window.vsApp) return;
    if (step === "ready" || step === "veil") bootDone = step === "ready";
    try { webkit.messageHandlers.vsApp.postMessage(Object.assign({ type: "boot", step: step }, extra || {})); } catch (e) { /* 不在 App 里 */ }
  };
  // iPhone 先认（App 的 UA 里带着「VibingStudioiPad」，以前 iPhone 也被当成 iPad、在 Mac 上授权列表里写成 iPad）；触屏的那些适配 iPhone 也要
  var ua = navigator.userAgent, isPhone = /iPhone/.test(ua), isPad = !isPhone && (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)), root = document.documentElement;
  var NAME_KEY = hybrid ? "vs-remote-name:" + mac : "vs-remote-mac-name";
  var macName = (hybrid && q.get("mname")) || localStorage.getItem(NAME_KEY) || (hybrid ? tr("远程设备", "Remote Device") : tr("你的 Mac", "your Mac")); // App 里开的窗口：名字跟着网址来（「设备」里的那个名字）
  var setName = function (n) { if (!n || n === macName) return; macName = n; localStorage.setItem(NAME_KEY, n); retitle(); badge(); };
  if (hybrid && !q.get("mname") && !localStorage.getItem(NAME_KEY)) fetch("/api/relay/hosts", { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.ok ? r.json() : []; }).then(function (hs) { (hs || []).forEach(function (h) { if (h && h.device === mac && h.name) setName(h.name); }); }).catch(function () {}); // 老版本开的窗口没带名字：按设备号去在线的设备里找
  // 选 Mac 的入口（⚙ 菜单里「连接到我的 Mac…」、「设备」里一台 Mac 的「打开」）
  window.TSU_REMOTE = {
    mac: function () { return mac; },
    name: function () { return macName; },
    hybrid: hybrid,
    pick: function () {
      return fetch("/api/relay/hosts", { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
    },
    use: function (dev, name) {
      // App 里：那台 Mac 开一个窗口（已经开着就叫到前面）；空的 = 断开 = 关掉这个窗口
      if (hybrid) return dev ? LN.call("remote.open", { mac: dev, name: name || "" }) : LN.call("window.close");
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
    ist.textContent = "html.ipad .tpane, html.ipad .tpane *:not(textarea):not(input) { -webkit-user-select: none !important; user-select: none !important; -webkit-touch-callout: none !important; } html.ipad .tpane textarea { -webkit-user-select: text !important; user-select: text !important; } " + // 对话、输入框那一块都不让系统自己选字（一碰整屏选中、整格泛蓝）：长按菜单里「复制这一段」
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
      veil.innerHTML = '<div class="rm-card"><b></b><p></p><div class="rm-acts"><button type="button" data-rm="retry"></button><button type="button" data-rm="off"></button></div></div>';
      veil.addEventListener("click", function (e) { var b = e.target.closest("[data-rm]"); if (!b) return; if (b.dataset.rm === "retry") location.reload(); else window.TSU_REMOTE.use(""); });
      document.body.appendChild(veil);
    }
    boot("veil");
    veil.querySelector('[data-rm="retry"]').textContent = tr("重试", "Try Again");
    veil.querySelector('[data-rm="off"]').textContent = tr("只用网页版", "Use Web Only");
    veil.querySelector("b").textContent = title;
    veil.querySelector("p").textContent = text;
    veil.querySelector('[data-rm="retry"]').hidden = !retryBtn;
    veil.hidden = false;
  }
  function unsay() { if (veil) veil.hidden = true; if (authCard) authCard.hidden = true; authNow = ""; clearTimeout(connT); }
  var authCard = null, authNow = "", policy = "", connT = 0;
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
        else if (b.dataset.ra === "reload") location.reload();
      });
    }
    boot("veil");
    var M = esc(macName), html = "", Q = function (s) { return tr("「" + s + "」", "“" + s + "”"); };
    // 断开：App 里关掉这个窗口；网页、iPad 换回网页版
    var off = '<button type="button" data-ra="off">' + esc(hybrid ? tr("关闭窗口", "Close Window") : tr("只用网页版", "Use Web Only")) + "</button>";
    if (st === "connecting") html = '<div class="rm-spin"></div><b>' + tr("正在连接", "Connecting to ") + Q(M) + "</b>";
    else if (st === "asking") html = '<div class="rm-spin"></div><b>' + tr("等待" + Q(M) + "允许", "Waiting for " + Q(M)) + "</b><p>" +
      (policy === "code" ? tr("请在" + Q(M) + "上点按「允许」。之后它会显示一个 6 位验证码，在这里输入。", "Click Allow on " + Q(M) + ". It will then show a 6-digit code to enter here.") : tr("请在" + Q(M) + "上点按「允许」。", "Click Allow on " + Q(M) + ".")) +
      '</p><div class="rm-acts">' + off + "</div>";
    else if (st === "code") html = "<b>" + tr("输入验证码", "Enter the Code") + "</b><p>" + tr("输入" + Q(M) + "上显示的 6 位验证码。", "Enter the 6-digit code shown on " + Q(M) + ".") + '</p><input class="rm-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="······" aria-label="' + esc(tr("验证码", "Code")) + '"><p class="rm-err">' + esc(msg || "") + "</p>";
    else if (st === "expired") html = "<b>" + tr("验证码已过期", "The Code Expired") + "</b><p>" + tr("重新请求，" + Q(M) + "上会再显示一个新的验证码。", "Request again and " + Q(M) + " will show a new code.") + '</p><div class="rm-acts">' + off + '<button type="button" data-ra="retry" class="rm-pri">' + tr("重新请求", "Request Again") + "</button></div>";
    else if (st === "denied") html = "<b>" + tr(Q(M) + "没有允许这台设备", Q(M) + " didn’t allow this device") + "</b><p>" + esc(msg || tr("可以重新请求，在那台电脑上点「允许」。", "You can request again and click Allow on that computer.")) + '</p><div class="rm-acts">' + off + '<button type="button" data-ra="retry" class="rm-pri">' + tr("重新请求", "Request Again") + "</button></div>";
    else if (st === "nokey") html = "<b>" + tr("无法验证这台设备", "Couldn’t Verify This Device") + "</b><p>" + esc(msg || "") + '</p><div class="rm-acts">' + off + '<button type="button" data-ra="reload" class="rm-pri">' + tr("重新载入", "Reload") + "</button></div>";
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
          authShow("code", e && e.code === "E_CODE" ? tr("验证码不正确，请再输入一次。", "That code isn’t right. Try again.") : (e && e.message) || tr("没有验证成功，请再试一次。", "Verification failed. Try again."));
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
        if (!hosts.length) return say(tr("没有在线的电脑", "No Computer Is Online"), tr("在那台电脑的 Vibing Studio 里打开「设置 › 通用 › 其他设备使用这台电脑」，然后重试。", "On that computer, open Vibing Studio and turn on Settings › General › Allow Other Devices to Use This Computer, then try again."), true);
        say(tr("选择要连接的电脑", "Choose a Computer"), "", false);
        var acts = veil.querySelector(".rm-acts");
        acts.querySelectorAll("[data-mac]").forEach(function (b) { b.remove(); });
        hosts.forEach(function (h) { var b = document.createElement("button"); b.type = "button"; b.dataset.mac = h.device; b.textContent = h.name || h.device; b.onclick = function () { window.TSU_REMOTE.use(h.device, h.name); }; acts.insertBefore(b, acts.firstChild); });
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", findMac); else findMac();
  }
  if (!mac) return;
  // 这台设备在中转里的编号（各页、各窗口共用）；这一页的会话号（每次连接都确认时按它认，刷新还是同一个）；这一页发出去的请求编号的前缀（同一台设备开着几页，回复各认各的）
  var rnd = function (n) { var a = new Uint8Array(n), s = ""; crypto.getRandomValues(a); for (var i = 0; i < n; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[a[i] % 36]; return s; };
  var cid = localStorage.getItem("vs-remote-client");
  if (!cid) { cid = "dev-" + rnd(8) + Date.now().toString(36).slice(-4); localStorage.setItem("vs-remote-client", cid); }
  var sess = "";
  try { sess = sessionStorage.getItem("vs-remote-sess") || ""; if (!sess) { sess = rnd(12); sessionStorage.setItem("vs-remote-sess", sess); } } catch (e) { sess = rnd(12); }
  var pid = rnd(6);
  var brName = function () {
    var b = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : tr("浏览器", "Browser");
    var os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
    return os ? b + "（" + os + "）" : b;
  };
  // 在那台 Mac 上问「允许」时写的名字：App 里是这台电脑自己的名字（sync.js 认出来记着的「Kezhen 的 MacBook Pro」）
  var cname = hybrid ? (localStorage.getItem("tsu-device-auto") || (/Linux/.test(ua) ? "Linux" : "Mac")) : isPhone ? "iPhone" : isPad ? "iPad" : brName();
  var ws = null, up = false, outQ = [], offQ = [], pend = {}, parts = {}, subs = {}, seq = 0, retry = 0, state = "connecting", hostInfo = null;
  root.classList.add("remote-mac");
  if (hybrid) root.classList.add("remote-win");

  // ---- 这台设备的密钥：第一次用时生成（私钥不可导出），存在这个网站的 IndexedDB（同一台设备上的各页、各窗口共用）----
  var keyP = null;
  var b64 = function (u) { var s = ""; for (var i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
  function devKey() {
    if (keyP) return keyP;
    keyP = new Promise(function (res, rej) {
      if (!window.indexedDB || !window.crypto || !crypto.subtle) return rej(new Error(tr("这个浏览器不支持设备密钥（需要 HTTPS 和 IndexedDB）。", "This browser can’t create a device key (HTTPS and IndexedDB are required).")));
      var r = indexedDB.open("vs-remote", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("k"); };
      r.onerror = function () { rej(r.error || new Error("IndexedDB")); };
      r.onsuccess = function () {
        var db = r.result, get = function (then) { var g = db.transaction("k").objectStore("k").get("device"); g.onsuccess = function () { then(g.result); }; g.onerror = function () { then(null); }; };
        get(function (k0) {
          if (k0 && k0.priv && k0.pub) return res(k0);
          crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]).then(function (kp) {
            return crypto.subtle.exportKey("raw", kp.publicKey).then(function (raw) {
              var o = { priv: kp.privateKey, pub: b64(new Uint8Array(raw)), at: Date.now() };
              var t = db.transaction("k", "readwrite");
              t.objectStore("k").put(o, "device");
              t.oncomplete = function () { get(function (k1) { res(k1 && k1.priv ? k1 : o); }); }; // 别的窗口同时也生成了一把：用存下来的那把（各窗口一致）
              t.onerror = function () { res(o); };
            });
          }).catch(rej);
        });
      };
    });
    keyP.catch(function () { keyP = null; });
    return keyP;
  }
  // 那台 Mac 出的随机数：签「vs-remote-v1 / 那台 Mac 的设备号 / 这台的设备号 / 随机数」交回去
  var lastNonce = "";
  function prove(nonce) {
    if (!nonce || nonce === lastNonce) return;
    lastNonce = nonce;
    devKey().then(function (k) {
      var data = new TextEncoder().encode("vs-remote-v1\n" + mac + "\n" + cid + "\n" + nonce);
      return crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k.priv, data).then(function (sig) {
        return api.call("auth.prove", { nonce: nonce, pub: k.pub, sig: b64(new Uint8Array(sig)) });
      });
    }).catch(function (e) {
      if (e && e.code === "E_AUTH") return; // 随机数过期（同设备的另一页先签了）：等下一个
      authShow("nokey", String((e && e.message) || e));
    });
  }

  // ---- App 里（hybrid）：哪些交给那台 Mac，哪些留在这台 ----
  //   那台 Mac：终端、命令、文件、Claude Code 的会话、盯着的记录、认设备；这台：窗口、菜单、剪贴板、通知、内置浏览器、截屏、界面版本……
  var HOST = /^(local\.info|pty\.(open|attach|list|write|resize|pause|resume|close|cwd)|exec\.|proc\.|fs\.(read|write|stat|glob|list|thumb|trash|tags)|cc\.|tail\.|agents\.cfg|auth\.)/;
  var HOST_CMDS = ["local.info", "pty.open", "pty.attach", "pty.list", "pty.write", "pty.resize", "pty.pause", "pty.resume", "pty.close", "pty.cwd", "exec.start", "exec.kill", "proc.start", "proc.write", "proc.close", "proc.kill",
    "fs.read", "fs.write", "fs.stat", "fs.glob", "fs.list", "fs.thumb", "fs.trash", "fs.tags", "cc.sessions", "cc.find", "cc.search", "tail.watch", "tail.unwatch"];
  var LOCAL_ONLY = /^(pty\.gc|statusItem\.set|remote\.(set|revoke|import|cfg|policy|state))$/; // 这台自己的事，连着别的 Mac 的窗口不碰（收拾终端、菜单栏图标、这台当主机的设置）
  var NOT_THERE = /^fs\.(apps|openWith|share|chooseApp)$/; // 用那台 Mac 上的 App 打开、共享：人不在那台 Mac 前，不做
  var lastTitle = "";
  function retitle() { if (hybrid && lastTitle !== null) LN.call("window.title", { title: macName + (lastTitle ? " — " + lastTitle : "") }).catch(function () {}); }

  var api = {
    platform: hybrid ? LN.platform : "remote", app: "Vibing Studio", version: hybrid ? LN.version : "remote", protocol: 1, local: true, remote: true, hybrid: hybrid, mac: mac,
    call: function (cmd, args) {
      cmd = String(cmd); args = args == null ? {} : args;
      if (hybrid) {
        if (cmd === "info") return LN.call("info").then(function (i) { var o = Object.assign({}, i); o.commands = (i.commands || []).filter(function (c) { return !HOST.test(c) && !LOCAL_ONLY.test(c) && !NOT_THERE.test(c) && !/^(pty|exec|proc|cc)\./.test(c); }).concat(HOST_CMDS); o.remote = true; o.host = macName; return o; });
        if (cmd === "open.pending") return Promise.resolve([]); // 在访达里用 App 打开的文件归这台的主窗口
        if (LOCAL_ONLY.test(cmd)) return Promise.resolve(null);
        if (NOT_THERE.test(cmd)) { var ne = new Error(tr("连着另一台电脑时不可用", "Not available while connected to another computer")); ne.code = "E_REMOTE"; return Promise.reject(ne); }
        if (cmd === "window.title") { lastTitle = String(args.title || ""); return LN.call("window.title", { title: macName + (lastTitle ? " — " + lastTitle : "") }); }
        if (!HOST.test(cmd)) return LN.call(cmd, args);
      } else {
        // iPad、网页自己的：剪贴板、打开链接、通知（不送去 Mac）
        if (cmd === "clipboard.write") return navigator.clipboard ? navigator.clipboard.writeText(String(args.text || "")).then(function () { return null; }) : Promise.resolve(null);
        if (cmd === "clipboard.read") return navigator.clipboard && navigator.clipboard.readText ? navigator.clipboard.readText().then(function (t) { return { text: t }; }) : Promise.resolve({ text: "" });
        if (cmd === "openExternal") { try { window.open(String(args.url || ""), "_blank", "noopener"); } catch (e) { /* 拦了就算了 */ } return Promise.resolve(null); }
        if (cmd === "notify" || cmd === "badge" || cmd === "attention" || /^window\.|^menu\./.test(cmd)) return Promise.resolve(null);
      }
      return new Promise(function (resolve, reject) {
        var id = pid + "." + (++seq);
        pend[id] = { resolve: resolve, reject: reject, cmd: cmd, t: setTimeout(function () { if (pend[id]) { delete pend[id]; var e = new Error(tr("「" + macName + "」没有回应（", "“" + macName + "” didn’t respond (") + cmd + tr("）", ")")); e.code = "E_TIMEOUT"; reject(e); } }, cmd === "cc.sessions" || cmd === "cc.search" ? 120000 : 60000) };
        var m = JSON.stringify({ id: id, cmd: cmd, args: args, k: 1, s: sess });
        pend[id].msg = m;
        // 那台暂时断开了（网络抖一下、它在重连）：先排着，它回来了再发——不直接报错
        if (up && state !== "offline") ws.send(m); else if (up) offQ.push(m); else outQ.push(m);
      });
    },
    on: function (type, fn) { (subs[type] = subs[type] || []).push(fn); return function () { api.off(type, fn); }; },
    off: function (type, fn) { subs[type] = (subs[type] || []).filter(function (f) { return f !== fn; }); },
    // 那台 Mac 来的事件（终端输出……）、这台 App 自己的事件（窗口到前台、全屏、菜单、通知被点；原生那边调的就是这里）都从这里发
    _emit: function (type, detail) {
      (subs[type] || []).slice().forEach(function (f) { try { f(detail); } catch (e) { console.error(e); } });
      window.dispatchEvent(new CustomEvent("nados-native", { detail: { type: type, detail: detail } }));
    },
    state: function () { return state; },
    host: function () { return hostInfo; },
    // 盯着 Mac 上一个文件往后长的部分（会话记录）：Mac 那边每 0.2 秒看一眼、长了把新写的整行推过来（tail.data）；
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
    if (!p) return; // 同一台设备另一页的回复（中转发给这台设备的每一页）
    if (!m.ok && m.error && m.error.code === "E_OFFLINE" && p.msg) { offQ.push(p.msg); return; } // 中转说那台不在：排着，等它回来（host-online）再发；超时照旧
    delete pend[m.id];
    clearTimeout(p.t);
    if (m.ok) { if (p.cmd === "info") hostInfo = m.value; if (p.cmd !== "auth.prove" && !firstOk) { firstOk = true; clearTimeout(waitT); clearTimeout(connT); if (authNow && authNow !== "code") { authNow = ""; if (authCard) authCard.hidden = true; } badge(); } boot("ready"); return p.resolve(m.value); } // Mac 回话了：能用了
    var e = new Error((m.error && m.error.message) || tr("那台电脑上没做成", "That computer couldn’t do it")); e.code = (m.error && m.error.code) || "E_FAILED";
    if (e.code === "E_DENIED" && /没有允许|未授权/.test(e.message) && p.cmd !== "auth.code") { state = "denied"; boot("denied"); badge(); authShow("denied", /重新载入/.test(e.message) ? e.message : ""); return p.reject(e); }
    p.reject(e);
  }
  var firstOk = false, waitT = 0;
  function connect() {
    boot("connecting");
    // 正在连：半秒还没连上才盖一层（很快就连上的不闪一下）；App 里（iPad）有自己的载入层（BootView）
    clearTimeout(connT);
    if (!firstOk && !window.vsApp) connT = setTimeout(function () { if (!firstOk && !authNow) authShow("connecting"); }, 500);
    // 老版本的 Mac（不会说在等什么）：过 3 秒还没回话，多半是在等那边点「允许」
    clearTimeout(waitT); waitT = setTimeout(function () { if (!firstOk && (authNow === "connecting" || authNow === "")) authShow("asking"); }, 3000);
    var u = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/relay/client?device=" + encodeURIComponent(mac) + "&client=" + encodeURIComponent(cid) + "&cname=" + encodeURIComponent(cname);
    try { ws = new WebSocket(u); } catch (e) { return later(); }
    ws.onopen = function () { boot("waiting"); var again = retry > 0 || seq > 0; up = true; retry = 0; state = "open"; badge(); var l = outQ.concat(offQ); outQ = []; offQ = []; l.forEach(function (m) { ws.send(m); }); if (again) rewatchAll(); };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      // Mac 那边断了（它的 App 更新、重新载入，一会儿就回来）：不盖整屏、不重新载入（以前一断就整屏盖住，回来时整页重载——iPad 上黑一下）；
      //   断了 4 秒还没回来才在底下一行小字，回来了就收起，页面接着用
      if (m.sys === "host-offline") { boot("offline"); state = "offline"; badge(); clearTimeout(offT); offT = setTimeout(function () { if (state === "offline") toast(tr("连不上「" + macName + "」，正在重新连接", "Can’t reach “" + macName + "”. Reconnecting…")); }, 4000); return; }
      if (m.sys === "host-online") { clearTimeout(offT); if (state === "offline") state = "open"; badge(); toast(""); lastNonce = ""; var q0 = offQ; offQ = []; q0.forEach(function (x) { ws.send(x); }); rewatchAll(); return; }
      if (m.sys === "auth") {
        if (m.host) setName(m.host);
        if (m.policy) policy = m.policy;
        if (m.state === "challenge") { clearTimeout(waitT); return prove(m.nonce); } // 新版的 Mac：要等什么它自己会说（asking / code），不用猜
        if (m.state === "ok") { authNow = ""; if (authCard) authCard.hidden = true; state = "open"; badge(); } else authShow(m.state);
        return;
      }
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
      if (m.id != null && pend[m.id]) { if (pend[m.id].cmd !== "auth.prove") unsay(); done(m); }
    };
    ws.onclose = function () { up = false; ws = null; lastNonce = ""; if (state === "denied") return; state = "connecting"; badge(); later(); };
    ws.onerror = function () { /* onclose 接着来 */ };
  }
  function later() { retry = Math.min(retry + 1, 6); setTimeout(connect, 800 * Math.pow(2, retry - 1)); }
  setInterval(function () { if (up) { try { ws.send('{"sys":"ping"}'); } catch (e) { /* 断了 */ } } }, 25000);

  // ---- App 里连着另一台 Mac 的窗口：标题栏左边一枚「那台 Mac」的标记（同 VS Code 的远程指示），点开：断开、换一台、在「设备」里看 ----
  var DESK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.8" y="2.6" width="12.4" height="8.4" rx="1.2"/><path d="M6 13.6h4M8 11v2.6"/></svg>';
  var badgeEl = null;
  function badge() {
    if (!hybrid) return;
    var bar = document.querySelector("#win .bar");
    if (!bar) return;
    if (!badgeEl || !badgeEl.isConnected) {
      badgeEl = document.createElement("button");
      badgeEl.type = "button";
      badgeEl.className = "rm-badge";
      badgeEl.setAttribute("data-nodrag", "");
      badgeEl.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      badgeEl.addEventListener("dblclick", function (e) { e.stopPropagation(); });
      badgeEl.addEventListener("click", function () { remoteMenu(badgeEl); });
      bar.appendChild(badgeEl);
    }
    var st = state === "open" && firstOk ? "on" : state === "denied" ? "off" : "wait";
    var tip = st === "on" ? tr("已连接到「" + macName + "」", "Connected to “" + macName + "”") : st === "off" ? tr("「" + macName + "」没有允许这台设备", "“" + macName + "” didn’t allow this device") : tr("正在连接「" + macName + "」", "Connecting to “" + macName + "”");
    var h = DESK + "<span>" + esc(macName) + '</span><i class="rm-dot ' + st + '"></i>';
    if (badgeEl.dataset.h !== h) { badgeEl.dataset.h = h; badgeEl.innerHTML = h; }
    badgeEl.title = tip;
    badgeEl.setAttribute("aria-label", tip);
  }
  function remoteMenu(el) {
    var S = window.STUDIO, items = [
      { header: true, label: state === "open" && firstOk ? tr("已连接到「" + macName + "」", "Connected to “" + macName + "”") : tr("正在连接「" + macName + "」", "Connecting to “" + macName + "”") },
      { label: tr("在「设备」中显示", "Show in Devices"), run: function () { var tw = window.TSU_TERM && TSU_TERM.front && TSU_TERM.front(); if (tw && S && S.openPage) S.openPage(tw, "devices", ""); } },
      { label: tr("连接到另一台设备…", "Connect to Another Device…"), run: function () { if (S && S.pickMac) S.pickMac(); } },
      { sep: true },
      { label: tr("断开连接", "Disconnect"), run: function () { window.TSU_REMOTE.use(""); } },
    ];
    if (S && S.menu) return S.menu(items, { el: el, side: "below-start" });
    if (window.confirm(tr("断开与「" + macName + "」的连接？", "Disconnect from “" + macName + "”?"))) window.TSU_REMOTE.use("");
  }
  if (hybrid) {
    var bst = document.createElement("style");
    bst.textContent = "#win .bar > .rm-badge { position: absolute; top: 50%; left: var(--nados-pad, 84px); transform: translateY(-50%); z-index: 3; display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px 0 6px; border: 0; border-radius: 5px; background: color-mix(in srgb, var(--st-focus, #0a84ff) 16%, transparent); color: var(--st-fg, #ddd); font: 11.5px -apple-system, \"PingFang SC\", system-ui, sans-serif; cursor: default; white-space: nowrap; }" +
      "#win .bar > .rm-badge:hover { background: color-mix(in srgb, var(--st-focus, #0a84ff) 26%, transparent); } #win .bar > .rm-badge svg { width: 13px; height: 13px; flex: none; } #win .bar > .rm-badge span { max-width: 180px; overflow: hidden; text-overflow: ellipsis; }" +
      ".rm-badge .rm-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: var(--st-dim, #888); } .rm-badge .rm-dot.on { background: #30d158; } .rm-badge .rm-dot.off { background: #ff453a; } .rm-badge .rm-dot.wait { background: #ffd60a; }" +
      "html.native-full #win .bar > .rm-badge, html.linux-app #win .bar > .rm-badge { left: 10px; }";
    (document.head || document.documentElement).appendChild(bst);
    var hook = function () { badge(); if (window.MutationObserver) { var b = document.querySelector("#win .bar"); if (b) new MutationObserver(function () { if (!badgeEl || !badgeEl.isConnected) badge(); }).observe(b, { childList: true }); } };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hook); else hook();
    retitle();
    // 设置文件（字号、配色、布局风格）用这台的：~/.paimon/studio.json 经这台 App 的桥读写（同主窗口）——不读那台 Mac 的
    var b2u = function (s) { var t = atob(s || ""), u = new Uint8Array(t.length); for (var i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
    var hinfo = null;
    window.TSU_HOSTLOCAL = {
      ready: LN.call("local.info").then(function (i) { hinfo = i; return i; }, function () { return null; }),
      info: function () { return hinfo; },
      read: function (path) { return LN.call("fs.read", { path: path, access: "user", offset: 0, max: 20000000 }).then(function (r) { return b2u(r && r.b64).buffer; }); },
      write: function (path, data) { return LN.call("fs.write", typeof data === "string" ? { path: path, access: "user", text: data } : { path: path, access: "user", b64: b64(new Uint8Array(data)) }); },
      stat: function (path) { return LN.call("fs.stat", { path: path }); },
    };
  }
  connect();
  // 对话的翻译设置照 Mac 上的（任务翻译、回复翻译、译文出现方式）：iPad 自己的默认是关着的——Mac 上早翻好的，这边一直是原文。App 的窗口用这台自己的设置
  if (!hybrid) window.addEventListener("load", function () {
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
