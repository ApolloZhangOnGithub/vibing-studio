// local.js —— 在 Paimon Terminal（Mac 上的原生终端 App：apps/macos 用 MODE=terminal 编出来的）里：shell 和 agent 的工具都在这台 Mac 上跑，
// 不经过服务器的沙盒。经原生的桥（nadosNative 的 pty.* / exec.* / fs.*，见 apps/macos/Sources/Local.swift），接口和服务器沙盒那一套一样：
//   pty(opts) → 像 WebSocket 的对象（live.js 的真终端直接用）；exec(o, signal, onChunk) → { out, err, code, cwd }；read / write / stat / glob
// 浏览器里、Paimon（网页桌面）App 里：TSU_LOCAL = null
(function () {
  "use strict";
  var N = window.nadosNative;
  if (!N || !N.local) { window.TSU_LOCAL = null; return; }
  var seq = 0, clientPrefix = crypto.randomUUID().slice(0, 8);
  var nid = function (p) { return p + clientPrefix + "-" + (++seq).toString(36); };
  // base64 → 字节：终端输出每一批都走这里。系统自带的 Uint8Array.fromBase64（WebKit 18.2+）比 atob 再一个个字节抄快 8 倍左右（实测 909 vs 114 MB/s）——
  //   终端刷屏时省下主线程四分之一的时间给 xterm 解析；没有它的老系统照旧
  var FROM64 = typeof Uint8Array.fromBase64 === "function";
  function bytes(b64) { if (FROM64) { try { return Uint8Array.fromBase64(b64 || ""); } catch (e) { /* 不规范的（带换行等）：照旧的办法 */ } } var s = atob(b64 || ""), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function b64(buf) { var u = buf instanceof Uint8Array ? buf : new Uint8Array(buf), s = ""; for (var i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); }
  var info = null;
  var ready = N.call("local.info").then(function (i) { info = i; return i; });

  // ---- 真终端：像 WebSocket（readyState、send、close、onopen / onmessage / onclose）；另有 resize(cols, rows)、cwd()（现在在哪个目录）。
  // o.attach：接回页面刷新前的那个（原生那边的 shell 一直在跑；接上先收到留着的输出）——没了就开个新的，ws.attached 说是哪种 ----
  var mine = {}; // 这个页面的伪终端（开着的、等着接回来的）：别的都是上一个页面留下的
  function want(id) { if (id) mine[id] = 1; }
  function drop(id) { if (id && mine[id]) { delete mine[id]; N.call("pty.close", { id: id }).catch(function () {}); } }
  // 页面起来一会儿以后：上一个页面留下、这一个没要回去的 shell 关掉（不留看不见的进程）
  ready.then(function () { setTimeout(function () { N.call("pty.gc", { keep: Object.keys(mine) }).catch(function () {}); }, 15000); });
  function pty(o) {
    var ws = { id: o.attach || nid("p"), attached: false, readyState: 0, binaryType: "arraybuffer", onopen: null, onmessage: null, onclose: null }, hold = !!o.attach;
    mine[ws.id] = 1;
    // 接回来的时候：回复之前到的输出都已经在留着的那段里了（原生那边先并进去再回），不要重复写
    var offD = N.on("pty.data", function (d) { if (d && d.id === ws.id && !hold && ws.onmessage) ws.onmessage({ data: bytes(d.b64).buffer }); });
    var offX = N.on("pty.exit", function (d) {
      if (!d || d.id !== ws.id) return;
      ws.readyState = 3;
      delete mine[ws.id];
      offD(); offX();
      if (ws.onclose) ws.onclose({ code: 1000, reason: "" });
    });
    var fail = function (e) {
      ws.readyState = 3;
      delete mine[ws.id];
      offD(); offX();
      if (ws.onclose) ws.onclose({ code: 1011, reason: e.message });
    };
    var open = function () {
      N.call("pty.open", Object.assign({ id: ws.id, cols: o.cols || 80, rows: o.rows || 24, cwd: o.cwd || "" }, o.argv ? { argv: o.argv } : {})).then(function () { // argv：不跑登录 shell，直接跑这个程序（tmux 的终端）
        ws.readyState = 1;
        if (ws.onopen) ws.onopen({});
      }, fail);
    };
    if (o.attach) N.call("pty.attach", { id: ws.id, cols: o.cols || 80, rows: o.rows || 24 }).then(function (r) {
      hold = false;
      ws.attached = true;
      ws.readyState = 1;
      if (ws.onopen) ws.onopen({});
      if (r && r.b64 && ws.onmessage) ws.onmessage({ data: bytes(r.b64).buffer });
    }, function () { // 那个 shell 已经没了（App 重开过）：开个新的
      delete mine[ws.id];
      hold = false;
      ws.id = nid("p");
      mine[ws.id] = 1;
      open();
    });
    else open();
    ws.send = function (data) { if (ws.readyState === 1) N.call("pty.write", { id: ws.id, data: String(data) }).catch(function () {}); };
    ws.resize = function (cols, rows) { if (ws.readyState === 1) N.call("pty.resize", { id: ws.id, cols: cols, rows: rows }).catch(function () {}); };
    // 流控：xterm 还没解析完的超过 1 MB 就叫原生先别读（伪终端的缓冲满了，shell 自然停在 write 上），降到 256 KB 以下再接着读——
    // 大量输出（cat 大文件、编译刷屏）时界面不卡、Ctrl+C 马上见效，也不会攒过 xterm 的 50 MB 上限（超了它直接扔）。
    // 旧版 App 没有 pty.pause：报错就算了，照旧不流控。localStorage["tsu-flow"] = "off"：不叫停（对比、回滚用）
    var backlog = 0, held = false;
    ws.pause = function () { if (ws.readyState === 1) N.call("pty.pause", { id: ws.id }).catch(function () {}); };
    ws.resume = function () { if (ws.readyState === 1) N.call("pty.resume", { id: ws.id }).catch(function () {}); };
    ws.feed = function (term, data) { // onmessage 里用它代替 term.write
      var n = data.length;
      backlog += n;
      term.write(data, function () { backlog -= n; if (held && backlog < 262144) { held = false; ws.resume(); } });
      if (!held && backlog > 1048576 && localStorage.getItem("tsu-flow") !== "off") { held = true; ws.pause(); }
    };
    ws.close = function () { if (ws.readyState <= 1) { delete mine[ws.id]; N.call("pty.close", { id: ws.id }).catch(function () {}); } };
    // 不看了、但 shell 照跑（有名字的终端：关掉标签页 ≠ 结束，同 tmux 的 detach）：这个页面不再收它的输出，留在「要的」里（不被 gc 关掉），下次 attach 接回来
    ws.detach = function () { if (ws.readyState > 1) return; ws.readyState = 3; offD(); offX(); };
    var last = null;
    ws.cwd = function () { return ws.readyState === 1 ? N.call("pty.cwd", { id: ws.id }).then(function (r) { last = r; return r && r.cwd; }, function () { return null; }) : Promise.resolve(null); };
    ws.fg = function () { return Promise.resolve(last && last.fg || null); }; // 上一次 cwd() 顺带问到的前台进程 { pid, name, cwd }
    ws.lastFg = function () { return last && last.fg || null; };
    return ws;
  }

  // ---- 一条命令：o = { cmd, cwd, access（user / none / read / rw）, workdir }；signal 中断（整组进程停）----
  // 命令常装在登录 shell 的 PATH 之外：Claude Code 的原生版在 ~/.local/bin，安装时把它写进 ~/.zshrc——原生那边读 PATH 用的是非交互的登录 shell，读不到 .zshrc，
  //   于是新装的 Mac 上「检测不到 claude」、起不了会话（Codex 装在 Homebrew 里，所以找得到）。跑命令、起程序时把这几个常见的位置补在后面
  var EXTRA_PATH = "$HOME/.local/bin:$HOME/.claude/local:$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.volta/bin:/opt/homebrew/bin:/usr/local/bin";
  var PATH_PFX = 'PATH="$PATH:' + EXTRA_PATH + '"; ';
  function exec(o, signal, onChunk) {
    return new Promise(function (resolve, reject) {
      var id = nid("x"), out = "", err = "";
      var offD = N.on("exec.data", function (d) {
        if (!d || d.id !== id) return;
        if (d.o) { out += d.o; if (onChunk) onChunk(d.o, 1); }
        if (d.e) { err += d.e; if (onChunk) onChunk(d.e, 2); }
      });
      var offX = N.on("exec.exit", function (d) {
        if (!d || d.id !== id) return;
        cleanup();
        resolve({ out: out, err: err, code: d.code, cwd: d.cwd || null });
      });
      function cleanup() { offD(); offX(); signal?.removeEventListener("abort", kill); }
      function kill() {
        cleanup();
        N.call("exec.kill", {id}).catch(() => {});
        reject(new DOMException("命令已超时或中止", "AbortError"));
      }
      if (signal) { if (signal.aborted) { cleanup(); return reject(new DOMException("命令已中止", "AbortError")); } signal.addEventListener("abort", kill); }
      N.call("exec.start", { id: id, cmd: PATH_PFX + o.cmd, cwd: o.cwd || "", access: o.access || "user", workdir: o.workdir || "", extra: o.extra || [] }).catch(function (e) { cleanup(); reject(e); });
    });
  }

  // ---- 文件：o = { access, workdir }（agent 的档位；人不限）----
  // 借 Mac 用（网页端、iPhone、iPad）：读文件时让 Mac 压一下再送（z），这边解压——会话记录经中转送过来快得多；老版本的 Mac 不认 z，照旧送原文
  var ZOK = (function () { try { return typeof DecompressionStream !== "undefined" && !!new DecompressionStream("deflate-raw"); } catch (e) { return false; } })();
  var inflate = function (b64) { return new Response(new Blob([bytes(b64)]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer(); };
  function read(path, o) {
    o = o || {};
    var a = { path: path, access: o.access || "user", workdir: o.workdir || "", extra: o.extra || [], offset: o.offset || 0, max: o.max || 20000000 };
    if (N.remote && ZOK) a.z = true;
    return N.call("fs.read", a).then(function (r) { return r && r.z64 ? inflate(r.z64) : bytes(r.b64).buffer; });
  }
  // 长着跑的程序：stdin 能写（一行一行的 JSON 进出，Claude Code 的 stream-json）。o = { argv, cwd, env }；onOut(文字, 是不是 stderr)、onExit(code)
  function proc(o, onOut, onExit) {
    var id = nid("r"), dead = false;
    var offD = N.on("proc.data", function (d) { if (d && d.id === id) { if (d.o) onOut(d.o, false); if (d.e) onOut(d.e, true); } });
    var offX = N.on("proc.exit", function (d) { if (!d || d.id !== id) return; dead = true; offD(); offX(); if (onExit) onExit(d.code); });
    // 程序名不带路径的（claude、codex）：经 sh 补上那几个位置再 exec（进程号不变，停它照旧整组停）
    var argv0 = Array.isArray(o.argv) && o.argv.length && !/\//.test(String(o.argv[0])) ? ["/bin/sh", "-c", PATH_PFX + 'exec "$0" "$@"'].concat(o.argv) : o.argv;
    var started = N.call("proc.start", { id: id, argv: argv0, cwd: o.cwd || "", env: o.env || {} }).catch(function (e) { dead = true; offD(); offX(); if (onExit) onExit(-1, e.message); throw e; });
    return {
      id: id, started: started, alive: function () { return !dead; },
      write: function (s) { return started.then(function () { return N.call("proc.write", { id: id, data: String(s) }); }); },
      close: function () { return N.call("proc.close", { id: id }).catch(function () {}); },
      kill: function () { return N.call("proc.kill", { id: id }).catch(function () {}); },
    };
  }
  function write(path, data, o) {
    o = o || {};
    var a = { path: path, access: o.access || "user", workdir: o.workdir || "", extra: o.extra || [] };
    if (typeof data === "string") a.text = data; else a.b64 = b64(data);
    return N.call("fs.write", a);
  }
  function stat(path) { return N.call("fs.stat", { path: path }); }
  function glob(pattern, cwd, o) { o = o || {}; return N.call("fs.glob", { pattern: pattern, cwd: cwd || "", access: o.access || "user", workdir: o.workdir || "", extra: o.extra || [] }); }

  // Each session owns one metadata record and individually replaceable history pages.
  var historyDatabase;
  function historyDB() {
    if (!historyDatabase) historyDatabase = new Promise((resolve, reject) => {
      var req = indexedDB.open("vibing-session-history", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("pages");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return historyDatabase;
  }
  async function cachedHistory(scope, fileRevision) {
    var db = await historyDB();
    return new Promise((resolve, reject) => {
      const store = db.transaction("pages").objectStore("pages");
      const head = store.get([scope,-1]);
      head.onerror = () => reject(head.error);
      head.onsuccess = () => {
        if (!head.result || (fileRevision !== undefined && fileRevision !== head.result.fileRevision)) return resolve([]);
        const pages = [head.result];
        function readBatch(start) {
          const req = store.getAll(IDBKeyRange.bound([scope,start], [scope,Infinity]), 8);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            pages.push(...req.result);
            if (req.result.length < 8) resolve(pages);
            else readBatch(start + 8);
          };
        }
        readBatch(0);
      };
    });
  }
  async function cacheHistory(scope, metadata, pages, start, previousPrefix) {
    var db = await historyDB();
    return new Promise((resolve, reject) => {
      var tx = db.transaction("pages", "readwrite"), store = tx.objectStore("pages");
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
      var head = store.get([scope,-1]);
      head.onsuccess = () => {
        if (start && (head.result?.prefix !== previousPrefix || !metadata.turnHashes.slice(0,start).every((hash,i) => head.result.turnHashes[i] === hash))) return;
        store.delete(IDBKeyRange.bound([scope,start], [scope,Infinity]));
        store.put(metadata, [scope,-1]);
        function writeBatch(i) {
          const end = Math.min(i + 4, pages.length);
          while (i < end) {
            const request = store.put(pages[i], [scope,start+i]);
            if (++i === end && i < pages.length) request.onsuccess = () => writeBatch(end);
          }
        }
        writeBatch(0);
      };
    });
  }
  window.TSU_LOCAL = {
    cachedHistory, cacheHistory,
    hostKey: function (key) { return N.remote ? key + ":" + N.mac : key; },
    studioHelper: async function (name) {
      if (!["agy_sessions.py", "dsh_sessions.py", "dsh_send.py"].includes(name)) throw new Error("未知连接器组件");
      if (!N.remote && window.TSU_UI_LOCAL?.dir) return TSU_UI_LOCAL.dir + "/studio/" + name;
      var host = await ready;
      var dirs = [host.home + "/Library/Application Support/Vibing Studio/ui",
        "/Applications/Vibing Studio.app/Contents/Resources/web", host.home + "/Applications/Vibing Studio.app/Contents/Resources/web"];
      for (var dir of dirs) {
        var path = dir + "/studio/" + name;
        if ((await stat(path))?.type === "file") return path;
      }
      throw new Error("连接的设备缺少组件 " + name);
    },
    ready: ready, info: function () { return info; },
    pty: pty, want: want, drop: drop, exec: exec, proc: proc, read: read, write: write, stat: stat, glob: glob,
    list: function (path) { return N.call("fs.list", { path: path }); },
    ccFind: function (id) { return N.call("cc.find", { id: id }); },
    ccSearch: function (q, o) { o = o || {}; return N.call("cc.search", { q: q, limit: o.limit || 60, per: o.per || 30, cs: !!o.cs, word: !!o.word, re: !!o.re }); },
    // 这台 Mac 上最近的 Claude Code 会话（~/.claude）：[{ id, cwd, missing, title, custom, last, mtime, job（后台会话的短 id）, live?: { pid, kind, status, name, since } }]
    ccSessions: function (limit) { return N.call("cc.sessions", { limit: limit || 30 }); },
    // 盯着一个文件往后长的部分（iPad 经中转用 Mac 时才有：Mac 那边看着文件，长了把新写的整行直接推过来，不用 iPad 隔一会儿来回问两趟）。
    //   onData(从哪起, 字节)；文件变短了（被改写）：onData(-1)。本机直接读就够快：返回 null，照旧自己读
    tail: function (path, offFn, onData) { if (!N.tail) return null; return N.tail(path, offFn, function (d) { if (d.offset < 0) return onData(-1, null, d); onData(d.offset, bytes(d.b64).buffer, d); }); }, // 返回 { live(), rewatch(), stop() }：live() 为假（Mac 那边不认、断着）时照旧自己读
  };
})();
