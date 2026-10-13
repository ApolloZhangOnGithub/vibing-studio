// rlink.js —— 这台 App 的页面经中转（服务端 src/relay.js）连自己账号里的另一台设备，开一条旁路：不换掉整页的 nadosNative（那是 remote.js 的事），
//   只拿来调那台设备上的几个命令（exec / proc）、收它们的输出。远程桌面用：问那台电脑要它远程桌面的账号、经它转发画面（rdp.js）。
//   认设备同 remote.js：这台设备在中转里的编号（localStorage vs-remote-client）、这台设备的密钥（IndexedDB vs-remote，私钥拿不出来）——
//   用连着那台设备的窗口开过、那台允许过的，这条不用再问；那台要问「允许」时，得有人在那台前面点（state 写着 asking / code / denied）。
//   一台设备一条，开了就一直连着（断了自己重连）：那台的老版本页面在这台的任何一页断开时，会把这台开的程序的输出都停掉
(function () {
  "use strict";
  if (window.TSU_RLINK || !window.WebSocket) return;
  var rnd = function (n) { var a = new Uint8Array(n), s = ""; crypto.getRandomValues(a); for (var i = 0; i < n; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[a[i] % 36]; return s; };
  var b64 = function (u) { var s = ""; for (var i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
  function cidOf() {
    var c = localStorage.getItem("vs-remote-client");
    if (!c) { c = "dev-" + rnd(8) + Date.now().toString(36).slice(-4); localStorage.setItem("vs-remote-client", c); }
    return c;
  }
  // 这台设备的密钥（同 remote.js 的 devKey：同一个库、同一把；第一次用时生成）
  var keyP = null;
  function devKey() {
    if (keyP) return keyP;
    keyP = new Promise(function (res, rej) {
      if (!window.indexedDB || !window.crypto || !crypto.subtle) return rej(new Error("no device key"));
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
              t.oncomplete = function () { get(function (k1) { res(k1 && k1.priv ? k1 : o); }); };
              t.onerror = function () { res(o); };
            });
          }).catch(rej);
        });
      };
    });
    keyP.catch(function () { keyP = null; });
    return keyP;
  }

  var links = {};
  function open(dev) {
    if (!dev) return null;
    if (links[dev]) return links[dev];
    var cid = cidOf(), sess = rnd(12), pid = "rl" + rnd(5), seq = 0, ws = null, up = false, outQ = [], pend = {}, parts = {}, subs = {}, retry = 0, lastNonce = "";
    var cname = localStorage.getItem("tsu-device-auto") || (/Linux/.test(navigator.userAgent) ? "Linux" : "Mac");
    var L = { dev: dev, state: "connecting", auth: "" };
    var emit = function (type, d) { (subs[type] || []).slice().forEach(function (f) { try { f(d); } catch (e) { console.error(e); } }); };
    var setState = function (s) { if (L.state === s) return; L.state = s; emit("state", s); };
    L.on = function (type, fn) { (subs[type] = subs[type] || []).push(fn); return function () { subs[type] = (subs[type] || []).filter(function (f) { return f !== fn; }); }; };
    L.call = function (cmd, args, ms) {
      return new Promise(function (resolve, reject) {
        var id = pid + "." + (++seq);
        pend[id] = { resolve: resolve, reject: reject, cmd: cmd, t: setTimeout(function () { if (pend[id]) { delete pend[id]; var e = new Error("no reply: " + cmd); e.code = "E_TIMEOUT"; reject(e); } }, ms || 60000) };
        var m = JSON.stringify({ id: id, cmd: cmd, args: args || {}, k: 1, s: sess });
        if (up) ws.send(m); else outQ.push(m);
      });
    };
    // 那台设备出的随机数：签「vs-remote-v1 / 那台的设备号 / 这台的设备号 / 随机数」交回去（同 remote.js 的 prove）
    function prove(nonce) {
      if (!nonce || nonce === lastNonce) return;
      lastNonce = nonce;
      devKey().then(function (k) {
        var data = new TextEncoder().encode("vs-remote-v1\n" + dev + "\n" + cid + "\n" + nonce);
        return crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k.priv, data).then(function (sig) {
          return L.call("auth.prove", { nonce: nonce, pub: k.pub, sig: b64(new Uint8Array(sig)) });
        });
      }).catch(function () { /* 随机数过期（同设备的另一页先签了）：等下一个 */ });
    }
    function done(m) {
      var p = pend[m.id];
      if (!p) return; // 同一台设备另一页的回复（中转发给这台设备的每一页）
      delete pend[m.id];
      clearTimeout(p.t);
      if (m.ok) { if (p.cmd !== "auth.prove") { L.auth = "ok"; setState("open"); } return p.resolve(m.value); }
      var e = new Error((m.error && m.error.message) || "failed"); e.code = (m.error && m.error.code) || "E_FAILED";
      if (e.code === "E_DENIED") { L.auth = "denied"; emit("auth", "denied"); }
      p.reject(e);
    }
    function connect() {
      var u = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/relay/client?device=" + encodeURIComponent(dev) + "&client=" + encodeURIComponent(cid) + "&cname=" + encodeURIComponent(cname);
      try { ws = new WebSocket(u); } catch (e) { return later(); }
      ws.onopen = function () { up = true; retry = 0; setState("open"); var q = outQ; outQ = []; q.forEach(function (m) { ws.send(m); }); };
      ws.onmessage = function (ev) {
        var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.sys === "host-offline") return setState("offline");
        if (m.sys === "host-online") { lastNonce = ""; return setState("open"); }
        if (m.sys === "auth") {
          if (m.state === "challenge") return prove(m.nonce);
          L.auth = m.state || ""; emit("auth", L.auth);
          return;
        }
        if (m.sys) return;
        if (m.ev) return emit(m.ev, m.detail);
        if (m.parts != null) { // 大的回复分块来的：拼齐了再当一条
          var b = parts[m.id] || (parts[m.id] = []);
          b[m.part] = m.s;
          if (b.filter(function (x) { return x != null; }).length < m.parts) return;
          delete parts[m.id];
          try { m = JSON.parse(b.join("")); } catch (e) { return; }
        }
        if (m.id != null) done(m);
      };
      ws.onclose = function () { up = false; ws = null; lastNonce = ""; setState("connecting"); later(); };
      ws.onerror = function () { /* onclose 接着来 */ };
    }
    function later() { retry = Math.min(retry + 1, 6); setTimeout(connect, 800 * Math.pow(2, retry - 1)); }
    setInterval(function () { if (up) { try { ws.send('{"sys":"ping"}'); } catch (e) { /* 断了 */ } } }, 25000);
    links[dev] = L;
    connect();
    return L;
  }
  // 在那台设备上跑一条命令，等它跑完：{ code, out }（标准输出、错误输出合在一起）
  function exec(L, cmd, ms) {
    return new Promise(function (res, rej) {
      var id = "rx" + rnd(8), out = "", tm = 0;
      var fin = function () { clearTimeout(tm); off1(); off2(); };
      var off1 = L.on("exec.data", function (d) { if (d && d.id === id) out += (d.o || "") + (d.e || ""); });
      var off2 = L.on("exec.exit", function (d) { if (d && d.id === id) { fin(); res({ code: d.code, out: out }); } });
      tm = setTimeout(function () { fin(); L.call("exec.kill", { id: id }, 5000).catch(function () {}); var e = new Error("timeout"); e.code = "E_TIMEOUT"; rej(e); }, ms || 15000);
      L.call("exec.start", { id: id, cmd: cmd }, ms || 15000).catch(function (e) { fin(); rej(e); });
    });
  }
  // 那台设备上的终端（「设备」里一台电脑的「打开终端」）：同 TSU_LOCAL 的那一份（live.js 的终端标签页照用），只是经这条旁路——
  //   shell 在那台上跑，输入、输出、改大小、退出都经中转；页面刷新后按记着的编号接回去（那台上的 shell 还在的话）
  var fromB64 = function (s) { var t = atob(s || ""), u = new Uint8Array(t.length); for (var i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
  function ptyApi(dev, name) {
    var L = open(dev);
    return {
      remote: true, dev: dev, name: name || "",
      info: function () { return { home: "" }; }, want: function () {}, drop: function () {},
      pty: function (o) {
        var ws = { id: o.attach || "rp" + rnd(10), attached: false, readyState: 0, binaryType: "arraybuffer", onopen: null, onmessage: null, onclose: null }, hold = !!o.attach;
        var offD = L.on("pty.data", function (d) { if (d && d.id === ws.id && !hold && ws.onmessage) ws.onmessage({ data: fromB64(d.b64).buffer }); });
        var offX = L.on("pty.exit", function (d) { if (!d || d.id !== ws.id) return; ws.readyState = 3; offD(); offX(); if (ws.onclose) ws.onclose({ code: 1000, reason: "" }); });
        var fail = function (e) { ws.readyState = 3; offD(); offX(); if (ws.onclose) ws.onclose({ code: 1011, reason: String((e && e.message) || e) }); };
        var open1 = function () { L.call("pty.open", { id: ws.id, cols: o.cols || 80, rows: o.rows || 24, cwd: o.cwd || "" }, 30000).then(function () { ws.readyState = 1; if (ws.onopen) ws.onopen({}); }, fail); };
        if (o.attach) L.call("pty.attach", { id: ws.id, cols: o.cols || 80, rows: o.rows || 24 }, 30000).then(function (r) {
          hold = false; ws.attached = true; ws.readyState = 1;
          if (ws.onopen) ws.onopen({});
          if (r && r.b64 && ws.onmessage) ws.onmessage({ data: fromB64(r.b64).buffer });
        }, function () { hold = false; ws.id = "rp" + rnd(10); open1(); }); // 那台上的 shell 没了：开个新的
        else open1();
        ws.send = function (data) { if (ws.readyState === 1) L.call("pty.write", { id: ws.id, data: String(data) }, 30000).catch(function () {}); };
        ws.resize = function (c, r) { if (ws.readyState === 1) L.call("pty.resize", { id: ws.id, cols: c, rows: r }, 30000).catch(function () {}); };
        ws.pause = function () {}; ws.resume = function () {}; // 流控：中转这条路上不做（输出照来）
        ws.close = function () { if (ws.readyState <= 1) L.call("pty.close", { id: ws.id }, 10000).catch(function () {}); ws.readyState = 3; offD(); offX(); };
        ws.cwd = function () { return ws.readyState === 1 ? L.call("pty.cwd", { id: ws.id }, 10000).then(function (r) { return r && r.cwd; }, function () { return null; }) : Promise.resolve(null); };
        return ws;
      },
    };
  }
  window.TSU_RLINK = { open: open, exec: exec, ptyApi: ptyApi };
})();
