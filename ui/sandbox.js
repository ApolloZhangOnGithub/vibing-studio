// sandbox.js —— 浏览器里的一台小电脑：文件系统（IndexedDB，刷新不丢）+ 一个简单的 shell + 代码执行（node：Web Worker；python：Pyodide，用到才下载）。
// 碰不到真实系统。给终端（! 命令）和模型的工具（Bash / Read / Write / Edit / Glob / Grep）共用。全局 SANDBOX
// 权限（同 Unix）：每个文件有属主（user = 人，或某个 agent 的名字）和权限位（rwx × 属主 / 其他人）。每次操作都以「谁」的身份检查——
// 人（root）不受限；agent 在自己的目录（/agents/<名字>）里随意，出了自己目录还要看它的外部权限档位（none / read / rw）与文件的「其他人」位。
// 不去猜命令在干什么：权限只在文件系统这一层判定，任何命令、任何工具都一样
(function () {
  "use strict";
  // node 的 Worker 文件（和本文件同目录）：地址只能在脚本加载时取
  var NODE_URL = (function () { try { return new URL("sandbox-node.js", (document.currentScript && document.currentScript.src) || location.href).href; } catch (e) { return "sandbox-node.js"; } })();
  var HOME = "/home/user";
  var files = new Map(); // 绝对路径 → { data: 字符串, mtime, owner, mode }；二进制文件是 { bin: Uint8Array, binary: true, size, … }；目录是 { dir: true, mtime, owner, mode }
  var db = null, ready = null, listeners = [];
  // 当前身份：null = 人（root）；否则 { name, home, outside: "none" | "read" | "rw" }。每个 Shell / 工具调用执行前设置
  var who = null;
  // /.paimon：系统自己的文件都放这（同 teyvat 的 ~/.teyvat）——config/（设置）、IdentityData/（每个 agent 的身份卡）、MemoryData/<id>/（agent 的笔记与计划）
  var PAIMON = "/.paimon";
  var ROOT_DIRS = { "/": 0o755, "/home": 0o755, "/home/user": 0o755, "/tmp": 0o777, "/shared": 0o777, "/agents": 0o755,
    "/.paimon": 0o755, "/.paimon/config": 0o755, "/.paimon/IdentityData": 0o755, "/.paimon/MemoryData": 0o755 };
  function inside(p, dir) { return p === dir || p.indexOf(dir + "/") === 0; }
  // ls -l 的时间（同 macOS 的 ls，本地时区）：半年内「Sep 26 10:28」，更早的「Sep 26  2025」
  function lsTime(t) {
    var d = new Date(t || 0), M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()], day = String(d.getDate()).padStart(2, " ");
    var z = function (n) { return (n < 10 ? "0" : "") + n; };
    return M + " " + day + " " + (Math.abs(Date.now() - d) < 182 * 864e5 ? z(d.getHours()) + ":" + z(d.getMinutes()) : " " + d.getFullYear());
  }
  function denied(p) { var e = new Error("Permission denied: " + p); e.code = "EACCES"; return e; }
  // 能不能对 p 做 need（"r" 读 | "w" 写）：p 不存在时看上一级目录（新建文件要上一级可写）
  function can(p, need) {
    if (!who) return true;
    if (inside(p, who.home) || (who.mem && inside(p, who.mem))) return true; // 自己的家、自己的笔记（/.paimon/MemoryData/<id>）
    // 不管档位都能读的：/.paimon 的说明、设置、自己的身份卡（别人的身份卡、别人的笔记读不到）
    if (need === "r" && (p === PAIMON || p === PAIMON + "/README.md" || inside(p, PAIMON + "/config") || p === PAIMON + "/IdentityData/" + who.name + ".json")) return true;
    if (need === "w" ? who.outside !== "rw" : who.outside === "none") return false;
    var q = p;
    while (!files.has(q) && q !== "/") q = parent(q);
    var f = files.get(q) || { owner: "user", mode: 0o755 };
    // 人的目录与 /shared：档位说了算（同 Docker 版的组权限：read 能读、rw 能读写，不看「其他人」那几位），
    // 除非人自己把它设成了私密（其他人一位都没有，比如 chmod 600 / 700）
    if ((inside(p, HOME) || inside(p, "/shared")) && f.owner !== who.name && (f.mode & 7)) return true;
    var bits = f.owner === who.name ? (f.mode >> 6) & 7 : f.mode & 7;
    return need === "r" ? !!(bits & 4) : !!(bits & 2);
  }
  function check(p, need) { if (!can(p, need)) throw denied(p); }
  // 新建时的属主与权限：属主是当前身份；「其他人」位跟上一级目录（/shared、/tmp 里建的别人也能改）
  function fresh(p, dir) {
    var par = files.get(parent(p)), others = par && (par.mode & 2) ? 6 : 4;
    return { owner: who ? who.name : "user", mode: dir ? 0o750 | (others === 6 ? 7 : 5) : 0o640 | others };
  }

  // ---- 持久化：IndexedDB 一张表，路径为键 ----
  function open() {
    return new Promise(function (resolve) {
      var req = indexedDB.open("tsu-sandbox", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("files"); };
      req.onsuccess = function () { db = req.result; resolve(); };
      req.onerror = function () { resolve(); }; // 隐私模式等打不开：只放内存
    });
  }
  function load() {
    return open().then(function () {
      if (!db) return;
      return new Promise(function (resolve) {
        var tx = db.transaction("files"), st = tx.objectStore("files"), req = st.openCursor();
        req.onsuccess = function () { var c = req.result; if (c) { files.set(c.key, c.value); c.continue(); } else resolve(); };
        req.onerror = function () { resolve(); };
      });
    }).then(function () {
      if (!files.size) seed();
      // 老数据没有属主 / 权限：补上；缺的系统目录（/shared、/agents、/etc）建出来
      files.forEach(function (v, k) { if (!v.owner) { v.owner = "user"; v.mode = ROOT_DIRS[k] || (v.dir ? 0o755 : 0o644); persist(k); } });
      Object.keys(ROOT_DIRS).forEach(function (d) { if (!files.has(d)) { files.set(d, { dir: true, mtime: Date.now(), owner: "user", mode: ROOT_DIRS[d] }); persist(d); } });
    });
  }
  function persist(path) {
    if (!db || mirrored(path)) return; // 真沙盒的镜像不进 IndexedDB（东西在服务器上；浏览器里原来的那份留着不动）
    var tx = db.transaction("files", "readwrite"), st = tx.objectStore("files");
    if (files.has(path)) st.put(files.get(path), path); else st.delete(path);
  }
  // 改动通知：(路径, { who: 谁改的, kind: write | mkdir | remove | chmod | move })；镜像里的改动顺带排队推给真沙盒
  function changed(path, kind) {
    persist(path);
    var info = { who: who ? who.name : "user", kind: kind || "write" };
    listeners.forEach(function (f) { try { f(path, info); } catch (e) { console.error(e); } });
    if (mirrored(path) && !mirror.applying && !mirror.quiet) queuePush({ v: path, kind: kind || "write" });
  }

  // ======== 真沙盒的镜像：服务器开了真沙盒（agents.js 拿到布局后调 mirrorStart）时，/home/user、/agents、/shared 三棵树换成真沙盒里的 ========
  // 访达、编辑器、传输照旧用同步的 SANDBOX 接口；这里负责两头对齐：
  //   · 拉：先拉一次全的（元数据 + 256 KB 以内的文本），之后只拉元数据（每 5 秒、页面回到前台、终端每次出提示符、agent 每次用完工具），
  //     变了的文件再单独取内容；大文件、二进制只记元数据，用到时再取（ensureLoaded）
  //   · 推：本地对这三棵树的写 / 建目录 / 删 / 移动 / 复制 / 改权限，按顺序排队发给 sandboxd（以「人」的身份）；推不上去就重新拉一次，以真沙盒为准
  // 真路径 ↔ 虚拟路径按布局换算（Docker 是一样的；macOS 的 seatbelt 驱动在 /Users/Shared/tsu/… 下）
  var MIRROR_ROOTS = ["/home/user", "/agents", "/shared"], MIRROR_TEXT = 262144; // sandboxd 给了 .paimon 的位置时再加上 /.paimon
  var mirror = null;
  function mirrored(p) { return !!mirror && MIRROR_ROOTS.some(function (r) { return p === r || p.indexOf(r + "/") === 0; }); }
  function toReal(v) { var r = mirror && MIRROR_ROOTS.find(function (x) { return v === x || v.indexOf(x + "/") === 0; }); return r ? mirror.map[r] + v.slice(r.length) : v; } // 不在镜像里的（或本来就是真路径）原样返回
  function toVirt(p) {
    for (var i = 0; i < MIRROR_ROOTS.length; i++) { var real = mirror.map[MIRROR_ROOTS[i]]; if (p === real || p.indexOf(real + "/") === 0) return MIRROR_ROOTS[i] + p.slice(real.length); }
    return null;
  }
  function sbxApi(path, opts) {
    return fetch("/api/sbx/" + path, opts).then(function (r) {
      if (r.ok) return r;
      return r.text().then(function (t) { var msg; try { msg = JSON.parse(t).error; } catch (e) { msg = t; } throw new Error(msg || "HTTP " + r.status); });
    });
  }
  function recOf(m) {
    if (m.t === "d") return { dir: true, mtime: m.m, ctime: m.c, owner: m.o, mode: m.mode, remote: true };
    var r = { mtime: m.m, ctime: m.c, owner: m.o, mode: m.mode, size: m.s, remote: true };
    if (typeof m.text === "string") r.data = m.text; else { r.data = ""; r.lazy = true; if (m.bin) r.binary = true; }
    return r;
  }
  function pullSnapshot(text, m) {
    var roots = MIRROR_ROOTS.map(function (v) { return (m || mirror).map[v]; }).join(",");
    return sbxApi("fs/snapshot?as=user&text=" + text + "&roots=" + encodeURIComponent(roots)).then(function (r) { return r.json(); });
  }
  // 合进真沙盒的状态：新的加上、变了的换掉、没了的去掉；正在往上推的路径先不动。返回要补取内容的（变了的小文本）
  function applySnapshot(snap, full) {
    var seen = new Set(), want = [];
    mirror.applying = true;
    try {
      MIRROR_ROOTS.forEach(function (r) { seen.add(r); if (!files.has(r)) { files.set(r, { dir: true, mtime: Date.now(), owner: "user", mode: 0o755, remote: true }); changed(r, "mkdir"); } });
      Object.keys(snap).sort().forEach(function (real) {
        var v = toVirt(real);
        if (!v) return;
        seen.add(v);
        if (mirror.pending.has(v)) return;
        var cur = files.get(v), next = recOf(snap[real]);
        if (!full && cur && !!cur.dir === !!next.dir && cur.mtime === next.mtime && (next.dir || cur.size === next.size)) return; // 没变
        if (!next.dir && next.lazy && !next.binary && next.size <= MIRROR_TEXT) want.push(v);
        delete mirror.failed[v];
        files.set(v, next);
        changed(v, cur ? "write" : next.dir ? "mkdir" : "write");
      });
      Array.from(files.keys()).forEach(function (k) {
        if (mirrored(k) && !seen.has(k) && !mirror.pending.has(k) && !Array.from(mirror.pending).some(function (p) { return k.indexOf(p + "/") === 0; })) { files.delete(k); changed(k, "remove"); }
      });
    } finally { mirror.applying = false; }
    return want;
  }
  // 用到时再取内容（大文件、二进制、刚变过的）：取回来后发一次 onChange，界面重画
  function ensureLoaded(paths) {
    if (!mirror) return Promise.resolve();
    return Promise.all((paths || []).map(function (v) {
      var f = files.get(v);
      if (!f || f.dir || !f.lazy || (mirror.failed[v] && Date.now() - mirror.failed[v] < 5000)) return null; // 刚失败过：5 秒后再试（一次网络抖动不该让这个文件永远读不了）
      if (mirror.loading[v]) return mirror.loading[v];
      var p = sbxApi("fs/read?as=user&path=" + encodeURIComponent(toReal(v))).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
        var u8 = new Uint8Array(buf), cur = files.get(v), text = null;
        if (!cur || !cur.lazy || cur.mtime !== f.mtime) return;
        if (!cur.binary) { try { text = new TextDecoder("utf-8", { fatal: true }).decode(u8); } catch (e) { text = null; } }
        var next = Object.assign({}, cur, { size: u8.length });
        delete next.lazy;
        if (text !== null && text.indexOf("\u0000") < 0) { next.data = text; delete next.bin; next.binary = false; } else { next.bin = u8; next.binary = true; delete next.data; }
        mirror.applying = true;
        try { files.set(v, next); changed(v, "write"); } finally { mirror.applying = false; }
      }).catch(function (e) { mirror.failed[v] = Date.now(); console.warn("真沙盒里的 " + v + " 取不回来：" + e.message); }).then(function () { delete mirror.loading[v]; });
      mirror.loading[v] = p;
      return p;
    })).then(function () {});
  }
  function queuePush(op) {
    if (op.v) mirror.pending.add(op.v);
    if (op.to) mirror.pending.add(op.to);
    mirror.queue.push(op);
    clearTimeout(mirror.flushT);
    mirror.flushT = setTimeout(flush, 120);
  }
  function flush() {
    if (!mirror || mirror.flushing || !mirror.queue.length) return;
    var q = mirror.queue;
    mirror.queue = [];
    // 合并：同一个文件连着几次写只发最后一次（内容在发的时候才取）；一个目录整个删了，它底下的删除不用再发
    var gone = q.filter(function (o) { return o.kind === "remove"; }).map(function (o) { return o.v; });
    q = q.filter(function (o, i) {
      if (o.kind === "remove") return !gone.some(function (g) { return g !== o.v && o.v.indexOf(g + "/") === 0; });
      if (o.kind === "write") return !q.slice(i + 1).some(function (x) { return x.kind === "write" && x.v === o.v; });
      return true;
    });
    var failed = false;
    mirror.flushing = q.reduce(function (chain, o) { return chain.then(function () { return push(o).catch(function (e) { failed = true; console.warn("推不上真沙盒（" + (o.v || o.from) + "）：" + e.message); }); }); }, Promise.resolve())
      .then(function () {
        mirror.flushing = null;
        mirror.pending.clear();
        if (!mirror.queue.length) mirror.renamed = null;
        mirror.queue.forEach(function (o) { if (o.v) mirror.pending.add(o.v); if (o.to) mirror.pending.add(o.to); });
        if (mirror.queue.length) flush();
        else if (failed) refreshMirror(); // 以真沙盒为准
      });
  }
  // 等排队的推完（存了马上运行、agent 马上读：不能用到真沙盒里的旧版本）
  function flushNow() {
    if (!mirror) return Promise.resolve();
    clearTimeout(mirror.flushT);
    if (mirror.queue.length && !mirror.flushing) flush();
    return Promise.resolve(mirror.flushing).then(function () { return mirror && (mirror.queue.length || mirror.flushing) ? flushNow() : null; });
  }
  function fsOp(body) { return sbxApi("fs/op", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.assign({ as: "user" }, body)) }); }
  function push(o) {
    if (o.kind === "mv" || o.kind === "cp") return fsOp({ op: o.kind, path: toReal(o.from), to: toReal(o.to) });
    if (o.kind === "remove") return files.has(o.v) ? Promise.resolve() : fsOp({ op: "rm", path: toReal(o.v) });
    var f = files.get(o.v);
    // 写完马上挪走了（先写后改名）：本地这个路径已经没了——把新位置上的内容写到服务器上的旧位置，后面排着的 mv 再把它带过去（不然 mv 带走的是旧内容）
    if (!f && mirror.renamed) Object.keys(mirror.renamed).some(function (from) { if (o.v === from || o.v.indexOf(from + "/") === 0) { f = files.get(mirror.renamed[from] + o.v.slice(from.length)); return true; } });
    if (!f) return Promise.resolve(); // 已经又没了
    if (f.dir) return o.kind === "chmod" ? fsOp({ op: "chmod", path: toReal(o.v), mode: (f.mode & 511).toString(8) }) : fsOp({ op: "mkdir", path: toReal(o.v) });
    if (o.kind === "chmod") return fsOp({ op: "chmod", path: toReal(o.v), mode: (f.mode & 511).toString(8) });
    if (f.lazy) return Promise.resolve(); // 内容还在服务器上、本地没改过
    return sbxApi("fs/write?as=user&path=" + encodeURIComponent(toReal(o.v)), { method: "PUT", body: f.bin ? f.bin : f.data || "" }).then(function () {
      if (typeof f.mode === "number" && (f.mode & 511) !== 0o644 && (f.mode & 511) !== 0o640) return fsOp({ op: "chmod", path: toReal(o.v), mode: (f.mode & 511).toString(8) });
    });
  }
  // 再拉一次（只要元数据），变了的小文本补取内容；正在推的时候先等推完
  function refreshMirror() {
    if (!mirror) return Promise.resolve();
    if (mirror.refreshing) return mirror.refreshing;
    if (mirror.queue.length || mirror.flushing) { clearTimeout(mirror.againT); mirror.againT = setTimeout(refreshMirror, 400); return Promise.resolve(); }
    mirror.refreshing = pullSnapshot(0).then(function (snap) { if (mirror.queue.length || mirror.flushing) return; return ensureLoaded(applySnapshot(snap, false)); })
      .catch(function (e) { console.warn("真沙盒拉不下来：" + e.message); })
      .then(function () { mirror.refreshing = null; });
    return mirror.refreshing;
  }
  // 浏览器沙盒里有、真沙盒里没有的文件：数一数（开镜像时问要不要导入、访达的菜单用）
  function importable() {
    var out = { files: 0, bytes: 0 };
    if (!mirror || !mirror.local) return out;
    mirror.local.forEach(function (rec, v) { if (!rec.dir && !files.has(v) && !isSeed(v, rec)) { out.files++; out.bytes += rec.size != null ? rec.size : (rec.data || "").length; } });
    return out;
  }
  // 导进真沙盒：复制到同样的位置（真沙盒里已有的跳过），浏览器里那份照旧留在 IndexedDB。4 个一起传；空目录单独建
  function importLocal(onProgress) {
    if (!mirror || !mirror.local) return Promise.resolve({ files: 0, failed: [] });
    var todo = [], dirs = [], done = 0, failed = [];
    mirror.local.forEach(function (rec, v) { if (files.has(v) || isSeed(v, rec)) return; if (rec.dir) dirs.push(v); else todo.push([v, rec]); });
    var queue = todo.slice(), workers = [];
    var one = function (item) {
      return sbxApi("fs/write?as=user&path=" + encodeURIComponent(toReal(item[0])), { method: "PUT", body: item[1].bin ? item[1].bin : item[1].data || "" })
        .then(function () { done++; if (onProgress) onProgress(done, todo.length); }, function (e) { failed.push(item[0] + "：" + e.message); });
    };
    for (var i = 0; i < 4; i++) workers.push((function next() { var it = queue.shift(); return it ? one(it).then(next) : Promise.resolve(); })());
    return Promise.all(workers).then(function () {
      var empty = dirs.filter(function (d) { return !todo.some(function (t) { return t[0].indexOf(d + "/") === 0; }); });
      return empty.reduce(function (p, d) { return p.then(function () { return fsOp({ op: "mkdir", path: toReal(d) }).catch(function (e) { failed.push(d + "：" + e.message); }); }); }, Promise.resolve());
    }).then(refreshMirror).then(function () { return { files: done, failed: failed }; });
  }
  // 开始镜像：layout = sandboxd 的 /v1/info（home、agents、shared 的真路径）。拉不下来就还用浏览器里的
  function mirrorStart(layout) {
    if (mirror || !layout || !layout.home || !layout.agents || !layout.shared) return Promise.resolve(false);
    var m = { map: { "/home/user": layout.home, "/agents": layout.agents, "/shared": layout.shared }, pending: new Set(), queue: [], loading: {}, failed: {}, quiet: 0, applying: false, driver: layout.driver };
    if (layout.paimon) { m.map[PAIMON] = layout.paimon; MIRROR_ROOTS = ["/home/user", "/agents", "/shared", PAIMON]; }
    return (ready || (ready = load())).then(function () {
      return pullSnapshot(MIRROR_TEXT, m);
    }).then(function (snap) {
      if (mirror) return true;
      if (!snap || typeof snap !== "object" || Array.isArray(snap) || !snap[layout.home]) throw new Error("快照不对");
      mirror = m; // 拉到了才切过去：之前浏览器里的改动照常存进 IndexedDB
      // 浏览器里原来的这三棵树先从内存里拿掉（IndexedDB 里的不动），换成真沙盒的；拿掉的记在 mirror.local（可以一次导进真沙盒）
      mirror.applying = true;
      mirror.local = new Map();
      try { Array.from(files.keys()).forEach(function (k) { if (mirrored(k) && !snap[toReal(k)]) { mirror.local.set(k, files.get(k)); files.delete(k); changed(k, "remove"); } }); } finally { mirror.applying = false; }
      applySnapshot(snap, true);
      var tick = function () { if (document.visibilityState === "visible") refreshMirror(); };
      mirror.timer = setInterval(tick, 5000);
      document.addEventListener("visibilitychange", tick);
      var touchT = 0;
      document.addEventListener("tsu-sandbox-touch", function () { clearTimeout(touchT); touchT = setTimeout(refreshMirror, 250); });
      return true;
    }).catch(function (e) {
      console.warn("真沙盒的文件拉不下来，访达、编辑器先用浏览器里的：" + e.message);
      mirror = null;
      return false;
    });
  }
  // 浏览器沙盒的示例文件（新设备上第一次打开时放进去）；账号开了真沙盒时不放——文件都在服务器上，这台设备上不另存一份
  var SEED = {
    "/README.md": "# 沙盒\n\n这是浏览器里的一台小电脑：文件存在本地（IndexedDB），碰不到你的真实系统。\n\n- shell：`ls` `cd` `cat` `echo` `mkdir` `rm` `mv` `cp` `touch` `head` `tail` `wc` `grep` `find` `tree`，支持 `|` `>` `>>` `&&`\n- 执行：`node hello.js`、`python hello.py`（第一次会下载 Python，约 10 MB）\n- 在终端里用 `!命令` 直接执行；模型也能用这些文件与命令\n",
    "/hello.js": "const fs = require('fs');\nconsole.log('hello from node in the sandbox');\nconsole.log(fs.readdirSync('.').join('\\n'));\n",
    "/hello.py": "import os\nprint('hello from python in the sandbox')\nprint(os.listdir('.'))\n",
  };
  function seed() {
    Object.keys(ROOT_DIRS).forEach(function (d) { files.set(d, { dir: true, mtime: Date.now(), owner: "user", mode: ROOT_DIRS[d] }); persist(d); });
    if (window.TSU_SBX) return;
    Object.keys(SEED).forEach(function (p) { write(HOME + p, SEED[p]); });
  }
  // 没改过的示例文件：不算「要不要导进真沙盒」的文件
  var isSeed = function (v, rec) { return v.indexOf(HOME + "/") === 0 && SEED[v.slice(HOME.length)] === rec.data; };

  // ---- 路径与文件操作 ----
  function norm(path, cwd) {
    if (!path) return cwd || HOME;
    if (path === "~" || path.indexOf("~/") === 0) path = (who ? who.home : HOME) + path.slice(1); // ~ 是当前身份的家（agent 是自己的家，不是人的）
    if (path[0] !== "/") path = (cwd || HOME) + "/" + path;
    var out = [];
    path.split("/").forEach(function (seg) {
      if (!seg || seg === ".") return;
      if (seg === "..") out.pop(); else out.push(seg);
    });
    return "/" + out.join("/");
  }
  var parent = function (p) { return p.slice(0, p.lastIndexOf("/")) || "/"; };
  var base = function (p) { return p.slice(p.lastIndexOf("/") + 1); };
  var isDir = function (p) { var f = files.get(p); return !!(f && f.dir); };
  var exists = function (p) { return files.has(p); };
  function mkdirp(p) {
    if (p === "/" || isDir(p)) return;
    if (exists(p)) throw new Error("不是目录：" + p);
    mkdirp(parent(p));
    check(p, "w");
    files.set(p, Object.assign({ dir: true, mtime: Date.now() }, fresh(p, true)));
    changed(p, "mkdir");
  }
  // 文本文件读出来是字符串；二进制文件（图片、压缩包…）用 read 读会报错（免得被当成文本改坏），用 readBinary
  function lazy(p, f) { ensureLoaded([p]); return new Error("正在从真沙盒取这个文件（" + (f.size || 0) + " 字节），稍等再试：" + p); }
  function read(p) {
    var f = files.get(p);
    if (!f) throw new Error("没有这个文件：" + p);
    if (f.dir) throw new Error("是目录：" + p);
    check(p, "r");
    if (f.lazy) throw lazy(p, f);
    if (f.bin) throw new Error("是二进制文件：" + p + "（" + f.bin.length + " 字节；文本工具读不了）");
    return f.data;
  }
  function readBin(p) {
    var f = files.get(p);
    if (!f) throw new Error("没有这个文件：" + p);
    if (f.dir) throw new Error("是目录：" + p);
    check(p, "r");
    if (f.lazy) throw lazy(p, f);
    return f.bin ? f.bin : new TextEncoder().encode(f.data || "");
  }
  var utf8Len = function (s) { var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? (i++, 4) : 3; } return n; };
  function put(p, rec) {
    if (isDir(p)) throw new Error("是目录：" + p);
    check(p, "w");
    mkdirp(parent(p));
    var old = files.get(p);
    files.set(p, Object.assign(rec, { mtime: Date.now() }, old ? { owner: old.owner, mode: old.mode, ctime: old.ctime || old.mtime } : Object.assign({ ctime: Date.now() }, fresh(p, false))));
    changed(p, "write");
  }
  function write(p, data) { data = String(data); put(p, { data: data, size: utf8Len(data) }); }
  function writeBin(p, u8) { u8 = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8); put(p, { bin: u8, binary: true, size: u8.length }); }
  function list(p) {
    if (!isDir(p)) throw new Error("不是目录：" + p);
    check(p, "r");
    var pre = p === "/" ? "/" : p + "/", out = [];
    files.forEach(function (v, k) { if (k !== p && k.indexOf(pre) === 0 && k.slice(pre.length).indexOf("/") < 0) out.push(k); });
    return out.sort();
  }
  function remove(p, recursive) {
    if (!exists(p)) throw new Error("没有这个文件：" + p);
    if (p === "/" || ROOT_DIRS[p] || (who && p === who.home)) throw new Error("不能删除 " + p);
    check(p, "w");
    check(parent(p), "w");
    if (isDir(p) && list(p).length && !recursive) throw new Error("目录不空（用 -r）：" + p);
    Array.from(files.keys()).forEach(function (k) { if (k === p || k.indexOf(p + "/") === 0) { files.delete(k); changed(k, "remove"); } });
  }
  function copy(a, b, move) {
    if (!exists(a)) throw new Error("没有这个文件：" + a);
    check(a, "r");
    if (isDir(b)) b = b + "/" + base(a);
    check(b, "w");
    // 两头都在真沙盒的镜像里：本地照做（不逐个推），真沙盒只发一个 mv / cp（大文件、二进制的内容本来就在那边）
    if (mirrored(a) && mirrored(b) && !mirror.applying && !mirror.quiet) {
      mirror.quiet++;
      try { copy(a, b, move); } finally { mirror.quiet--; }
      if (move) { mirror.renamed = mirror.renamed || {}; mirror.renamed[a] = b; } // 排着队、还没推上去的写：推的时候去新位置取内容（见 push）
      queuePush({ kind: move ? "mv" : "cp", from: a, to: b });
      return;
    }
    // 拷贝要逐个能读（同 cp -r：读不了的跳过、最后报 Permission denied）；挪只看两头目录能不能写（同 mv）
    var skipped = [];
    Array.from(files.keys()).forEach(function (k) {
      if (k === a || k.indexOf(a + "/") === 0) {
        if (!move && k !== a && skipped.some(function (s0) { return k.indexOf(s0 + "/") === 0; })) return;
        if (!move && !can(k, "r")) { skipped.push(k); return; }
        var to = b + k.slice(a.length), f = files.get(k);
        mkdirp(parent(to));
        files.set(to, Object.assign({}, f, { mtime: Date.now() }, move ? {} : fresh(to, !!f.dir)));
        changed(to);
      }
    });
    if (move) remove(a, true);
    if (skipped.length) throw denied(skipped[0] + (skipped.length > 1 ? "（还有 " + (skipped.length - 1) + " 个）" : ""));
  }
  // 遍历只给看得见的（读不了的目录整棵跳过）
  function walk(p) { var out = []; files.forEach(function (v, k) { if ((k === p || k.indexOf(p === "/" ? "/" : p + "/") === 0) && can(k, "r")) out.push(k); }); return out.sort(); }
  // glob：* 不跨目录，** 跨目录，? 单个字符
  function globRe(pattern) {
    var re = "", i = 0;
    while (i < pattern.length) {
      var c = pattern[i];
      if (c === "*" && pattern[i + 1] === "*") { re += ".*"; i += 2; if (pattern[i] === "/") i++; continue; }
      if (c === "*") re += "[^/]*"; else if (c === "?") re += "[^/]"; else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i++;
    }
    return new RegExp("^" + re + "$");
  }
  function glob(pattern, cwd) {
    var abs = norm(pattern, cwd), re = globRe(abs);
    return Array.from(files.keys()).filter(function (k) { return re.test(k) && !isDir(k) && can(k, "r"); }).sort();
  }

  // ---- shell：解析（引号、| > >> && ; $变量），逐条执行 ----
  // 变量在解析时只做记号（\u0001名字\u0002），执行到那一条命令时才换成当时的值——`cmd; echo $?` 才对
  var VAR_RE = /\u0001([^\u0002]*)\u0002/g;
  function varMark(line, i) {
    var m = /^\$([?@#*]|\{(\w+(?::?[-=+?][^}]*)?)\}|(\w+))/.exec(line.slice(i));
    return m ? { len: m[0].length, name: /^[?@#*]$/.test(m[1]) ? m[1] : m[2] || m[3] } : null;
  }
  // $( … ) 与反引号：执行到那条命令时才跑（子 shell，同一个身份、目录、变量）；记号是 \u0005 + q|u（在不在双引号里）+ 命令 + \u0006
  // $(( … ))：整数运算，记号类型 a
  function subMark(line, i, q) {
    if (line[i] === "`") { var k = line.indexOf("`", i + 1); if (k < 0) throw new Error("` 没有闭合"); return { len: k - i + 1, mark: "\u0005" + (q ? "q" : "u") + line.slice(i + 1, k) + "\u0006" }; }
    if (line[i] !== "$" || line[i + 1] !== "(") return null;
    var arith = line[i + 2] === "(", depth = 0, j = i + 1, qq = "";
    for (; j < line.length; j++) {
      var c = line[j];
      if (qq) { if (c === qq) qq = ""; else if (c === "\\" && qq === '"') j++; continue; }
      if (c === "'" || c === '"') { qq = c; continue; }
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (!depth) break; }
    }
    if (j >= line.length) throw new Error("$( 没有闭合");
    var inner = line.slice(i + 2, j);
    if (arith) return { len: j - i + 1, mark: "\u0005a" + inner.slice(1, -1) + "\u0006" };
    return { len: j - i + 1, mark: "\u0005" + (q ? "q" : "u") + inner + "\u0006" };
  }
  function tokenize(line) {
    var toks = [], cur = "", q = "", i = 0, has = false;
    for (; i < line.length; i++) {
      var c = line[i];
      if ((c === "$" || c === "`") && q !== "'") { var sm = subMark(line, i, q); if (sm) { cur += sm.mark; has = true; i += sm.len - 1; continue; } }
      if (c === "$" && q !== "'") { var vm = varMark(line, i); if (vm) { cur += "\u0001" + vm.name + "\u0002"; has = true; i += vm.len - 1; continue; } }
      // 双引号里的反斜杠只转义 $ ` " \ 和换行，别的原样留着（同 sh："1\.5"、printf "%s\n"）
      if (q) { if (c === q) q = ""; else if (c === "\\" && q === '"' && i + 1 < line.length && /[$`"\\\n]/.test(line[i + 1])) cur += line[++i]; else cur += c; continue; }
      if (c === "'" || c === '"') { q = c; has = true; continue; }
      if (c === "\\" && i + 1 < line.length) { cur += line[++i]; has = true; continue; }
      if (/\s/.test(c)) { if (cur || has) toks.push(cur); cur = ""; has = false; continue; }
      if (c === "|" || c === ";" || c === ">" || c === "&" || c === "<") {
        // 重定向带文件描述符：2> 2>> 1> 2>&1 >&2 &>（紧挨着的 1 / 2 是描述符，不是参数）
        var fd = "";
        if (c === ">" && (cur === "1" || cur === "2") && !has) { fd = cur; cur = ""; }
        if (cur || has) toks.push(cur);
        cur = ""; has = false;
        var rest = line.slice(i);
        var m = /^(&>>?|>>?&[12]|>>?|<|&&|\|\||[|;&])/.exec(rest);
        var op = m[1];
        i += op.length - 1;
        if (op[0] === ">" || op.indexOf("&>") === 0) toks.push({ op: "redir", fd: op.indexOf("&>") === 0 ? "both" : fd || "1", append: /^>>|&>>/.test(op), dup: /&([12])$/.test(op) ? op.slice(-1) : "" });
        else if (op === "<") toks.push({ op: "in" });
        else toks.push({ op: op });
        continue;
      }
      cur += c;
    }
    if (q) throw new Error("引号没有闭合");
    if (cur || has) toks.push(cur);
    return toks;
  }
  function Shell(principal) { this.who = principal || null; this.cwd = principal ? principal.home : HOME; this.code = 0; this.vars = {}; }
  // 变量的值：$? 上一条命令的退出码；$HOME $USER $PWD；其余是 export / VAR=值 设过的
  Shell.prototype.env = function (name) {
    var d = /^(\w+)(:?)([-=+?])(.*)$/.exec(name); // ${X:-默认}、${X-默认}、${X:=值}、${X:+替换}
    if (d) {
      var v = this.env(d[1]), unset = d[2] ? !v : this.vars[d[1]] == null && !/^(HOME|USER|PWD|SHELL|PATH)$/.test(d[1]);
      if (d[3] === "-") return unset ? this.subst(d[4]) : v;
      if (d[3] === "=") { if (unset) this.vars[d[1]] = this.subst(d[4]); return this.env(d[1]); }
      if (d[3] === "+") return unset ? "" : this.subst(d[4]);
      return v;
    }
    if (name === "?") return String(this.code);
    if (name === "#") return String(this.args ? this.args.length : 0);
    if (name === "@" || name === "*") return (this.args || []).join(" ");
    if (name === "HOME") return this.who ? this.who.home : HOME;
    if (name === "USER") return this.who ? this.who.label || this.who.name : "user";
    if (name === "PWD") return this.cwd;
    if (name === "SHELL") return "/bin/sh";
    if (name === "PATH") return this.vars.PATH || "/usr/local/bin:/usr/bin:/bin";
    if (/^\d+$/.test(name)) return name === "0" ? this.arg0 || "sh" : (this.args || [])[+name - 1] || "";
    return this.vars[name] != null ? this.vars[name] : "";
  };
  // 环境变量（给 node / python / env 命令）：固定的几个 + export / VAR=值 设过的
  Shell.prototype.environ = function () {
    var self = this, e = { HOME: self.env("HOME"), USER: self.env("USER"), PWD: self.cwd, SHELL: "/bin/sh", PATH: self.env("PATH"), LANG: "zh_CN.UTF-8", TERM: "xterm-256color" };
    Object.keys(self.vars).forEach(function (k) { if (!/^\d+$/.test(k)) e[k] = String(self.vars[k]); });
    return e;
  };
  Shell.prototype.subst = function (s) { var self = this; return String(s).replace(VAR_RE, function (m, n) { return self.env(n); }); };
  // 引号外的换行才算分行（引号里的换行是参数的一部分，比如 node -e "…多行…"）
  function splitLines(text) {
    var out = [], cur = "", q = "";
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === q) q = ""; else if (c === "\\" && q === '"' && i + 1 < text.length) { cur += c + text[++i]; continue; } cur += c; continue; }
      if (c === "'" || c === '"') q = c;
      if (c === "\\" && text[i + 1] === "\n") { i++; continue; } // 行尾反斜杠：接下一行
      if (c === "\n") { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }
  // run(命令行, { signal, onOut(片段, 1 | 2) })：signal 中断（杀掉 node / python / sleep，后面的命令不再执行，退出码 130）；
  // onOut：该到终端的输出（没被重定向的 stdout / stderr）按顺序、每段只给一次——node / python 边跑边给，其余命令跑完一条给一条。结果里的 out / err 仍是全部
  Shell.prototype.run = function (line, opts) {
    opts = opts || {};
    var self = this, toks, sig = opts.signal;
    who = self.who;
    if (sig && sig.aborted) return Promise.resolve({ out: "", err: "", code: 130 });
    // heredoc：cmd <<'EOF' … EOF → 正文当 stdin；多行命令逐行执行（同 sh）
    // cat <<EOF | wc -l：分隔符后面同一行还可以接命令；分隔符不加引号时正文里的 $变量 要换成值（同 sh）
    var hd = /^([^\n]*?)<<-?\s*(['"]?)(\w+)\2([^\n]*)\n([\s\S]*?)\n\3[ \t]*(?:\n([\s\S]*))?$/.exec(line);
    if (hd && splitLines(hd[1]).length === 1) {
      var body = hd[5] + "\n", rest = hd[6];
      if (!hd[2]) body = body.replace(/\$(\w+|\{\w+\})/g, function (m, n) { return self.env(n.replace(/[{}]/g, "")); });
      return self.runWithInput(hd[1] + " " + hd[4], body, opts).then(function (r) {
        if (!rest || !rest.trim() || r.exit || (sig && sig.aborted)) return r;
        return self.run(rest, opts).then(function (r2) { return { out: r.out + r2.out, err: r.err + r2.err, code: r2.code, exit: r2.exit }; });
      });
    }
    var lines = splitLines(line);
    if (lines.length > 1) {
      var idx = line.search(/<<-?\s*['"]?\w+['"]?[ \t]*\n/), acc = { out: "", err: "", code: 0 };
      // 中间有 heredoc：heredoc 之前的逐行跑，从它那行起整段交给上面的 heredoc 处理
      if (idx >= 0) {
        var headLines = splitLines(line.slice(0, line.lastIndexOf("\n", idx) + 1)).filter(function (l) { return l.trim(); }), from = line.lastIndexOf("\n", idx) + 1;
        return headLines.concat([line.slice(from)]).reduce(function (p, l) { return p.then(function () { if (acc.exit || (sig && sig.aborted)) return; return self.run(l, opts).then(function (r) { acc.out += r.out; acc.err += r.err; acc.code = r.code; acc.exit = r.exit; }); }); }, Promise.resolve()).then(function () { if (sig && sig.aborted) acc.code = 130; return acc; });
      }
      var ls = lines.filter(function (l) { return l.trim() && !/^\s*#/.test(l); });
      return ls.reduce(function (p, l) { return p.then(function () { if (acc.exit || (sig && sig.aborted)) return; return self.run(l, opts).then(function (r) { acc.out += r.out; acc.err += r.err; acc.code = r.code; acc.exit = r.exit; }); }); }, Promise.resolve()).then(function () { if (sig && sig.aborted) acc.code = 130; return acc; });
    }
    try { toks = tokenize(line); } catch (e) { if (opts.onOut) opts.onOut(e.message + "\n", 2); return Promise.resolve({ out: "", err: e.message + "\n", code: 2 }); }
    // 切成 [{ pipeline: [[argv]], redirects: [{ fd, file | dup, append }], input }, 连接符]
    var chains = [], cur = { pipeline: [[]], redirects: [] }, pending = null;
    toks.forEach(function (t) {
      if (typeof t === "string") {
        if (pending && pending.op === "in") { cur.input = t; pending = null; }
        else if (pending) { pending.file = t; cur.redirects.push(pending); pending = null; }
        else cur.pipeline[cur.pipeline.length - 1].push(t);
      } else if (t.op === "|") cur.pipeline.push([]);
      else if (t.op === "redir") { if (t.dup) cur.redirects.push(t); else pending = t; }
      else if (t.op === "in") pending = t;
      else { chains.push(cur, t.op); cur = { pipeline: [[]], redirects: [] }; }
    });
    chains.push(cur);
    var out = "", err = "", code = 0, i = 0;
    function next() {
      if (sig && sig.aborted) return Promise.resolve({ out: out, err: err, code: 130 });
      if (i >= chains.length) return Promise.resolve({ out: out, err: err, code: code });
      var ch = chains[i], op = chains[i - 1];
      i += 2;
      if ((op === "&&" && code !== 0) || (op === "||" && code === 0)) return next();
      if (!ch.pipeline[0].length) return next();
      var stdin = null;
      if (ch.input) { try { who = self.who; stdin = read(norm(self.subst(ch.input), self.cwd)); } catch (e) { err += e.message + "\n"; if (opts.onOut) opts.onOut(e.message + "\n", 2); code = 1; self.code = 1; return next(); } }
      // VAR=值 / export VAR=值：记进这个 shell
      var first = ch.pipeline[0], asg = ch.pipeline.length === 1 && (first[0] === "export" ? first.slice(1) : first).every(function (a) { return /^\w+=/.test(a); });
      if (asg && first.length) {
        // 值里可以有 $( … ) / $(( … ))：先跑出来再存
        var pairs = (first[0] === "export" ? first.slice(1) : first).map(function (a) { var k = a.indexOf("="); return [a.slice(0, k), a.slice(k + 1)]; });
        return pairs.reduce(function (p, kv) { return p.then(function () { return self.words([kv[1]], sig).then(function (w) { self.vars[kv[0]] = w.join(" "); }); }); }, Promise.resolve())
          .then(function () { code = 0; self.code = 0; return next(); });
      }
      // 没有重定向的一条：最后一段可以边跑边把输出给 onOut
      var live = opts.onOut && !ch.redirects.length ? opts.onOut : null;
      return self.pipeline(ch.pipeline, stdin, { signal: sig, onOut: live }).then(function (r) {
        code = r.code;
        self.code = code;
        var o = r.out, e2 = r.err;
        // 按顺序处理重定向：2>&1 把错误并进输出；> 文件；/dev/null 丢掉
        ch.redirects.forEach(function (rd) {
          if (rd.dup === "1" && rd.fd === "2") { o += e2; e2 = ""; return; }
          if (rd.dup === "2") { e2 += o; o = ""; return; }
          var text = rd.fd === "2" ? e2 : rd.fd === "both" ? o + e2 : o;
          if (rd.fd === "2") e2 = ""; else if (rd.fd === "both") { o = ""; e2 = ""; } else o = "";
          if (self.subst(rd.file) === "/dev/null") return;
          try { who = self.who; var p = norm(self.subst(rd.file), self.cwd); write(p, (rd.append && exists(p) ? read(p) : "") + text); } catch (x) { e2 += x.message + "\n"; code = 1; }
        });
        out += o;
        err += e2;
        if (opts.onOut) {
          if (live) { if (!r.streamedOut && o) opts.onOut(o, 1); if (r.errPending) opts.onOut(r.errPending, 2); }
          else { if (o) opts.onOut(o, 1); if (e2) opts.onOut(e2, 2); }
        }
        if (r.exit) return { out: out, err: err, code: code, exit: true };
        return next();
      });
    }
    return next();
  };
  Shell.prototype.runWithInput = function (line, input, opts) { this._stdin = input; var self = this; return this.run(line, opts).then(function (r) { self._stdin = null; return r; }); };
  Shell.prototype.pipeline = function (stages, stdin, popts) {
    popts = popts || {};
    if (this._stdin != null && stdin == null) { stdin = this._stdin; this._stdin = null; }
    var self = this, input = stdin || null, err = "", errPending = "", k = 0, streamedOut = false, exitF = false;
    function step() {
      if (k >= stages.length) return Promise.resolve({ out: input || "", err: err, code: last, streamedOut: streamedOut, errPending: errPending, exit: exitF });
      var isLast = k === stages.length - 1, raw = stages[k++];
      return self.words(raw, popts.signal).then(function (words) {
        var argv = expand(words, self.cwd);
        who = self.who; // 每条命令执行前重设身份：几个 shell 可能同时在跑（后台任务、别的 agent）
        return self.exec(argv, input, { signal: popts.signal, onOut: isLast ? popts.onOut : null });
      }, function (e) { // 展开参数就出错（$(( )) 写错了等）：同 sh，这一条报错、退出码 1，后面照常
        return { out: "", err: "sh: " + ((e && e.message) || e) + "\n", code: 1 };
      }).then(function (r) {
        input = r.out; err += r.err; last = r.code;
        if (!(r.streamed && r.streamed.err)) errPending += r.err;
        if (isLast) streamedOut = !!(r.streamed && r.streamed.out);
        if (r.exit) exitF = true;
        if (popts.signal && popts.signal.aborted) { last = 130; k = stages.length; }
        return step();
      });
    }
    var last = 0;
    return step();
  };
  // 参数：先跑 $( … ) / 反引号 / $(( … ))，再换变量；整个参数就是一个没加引号的 $( … ) 时按空白拆开（同 sh 的分词）
  var SUB_RE = /\u0005([qua])([^\u0006]*)\u0006/g;
  function arith(expr, sh) {
    var e = expr.replace(/\$?\b([A-Za-z_]\w*)\b/g, function (m, n) { var v = parseInt(sh.env(n), 10); return isNaN(v) ? 0 : v; }).replace(VAR_RE, function (m, n) { return parseInt(sh.env(n), 10) || 0; });
    if (!/^[\d\s+\-*/%()<>=!&|^~?:]*$/.test(e)) throw new Error("$(( )) 只支持整数运算：" + expr);
    var v;
    try { v = Function("return (" + (e.trim() || "0") + ")")(); } catch (x) { throw new Error("arithmetic syntax error: " + expr.trim()); }
    return String(typeof v === "boolean" ? +v : Math.trunc(v));
  }
  Shell.prototype.words = function (raw, signal) {
    var self = this, outArgs = [];
    return raw.reduce(function (p, a) {
      return p.then(function () {
        SUB_RE.lastIndex = 0;
        if (!SUB_RE.test(a)) { outArgs.push(self.subst(a)); return; }
        SUB_RE.lastIndex = 0;
        var pieces = [], mm, last = 0;
        while ((mm = SUB_RE.exec(a))) { pieces.push({ text: a.slice(last, mm.index) }); pieces.push({ type: mm[1], cmd: mm[2] }); last = SUB_RE.lastIndex; }
        pieces.push({ text: a.slice(last) });
        return pieces.reduce(function (pp, pc) {
          return pp.then(function () {
            if (pc.text !== undefined) { pc.val = self.subst(pc.text); return; }
            if (pc.type === "a") { pc.val = arith(pc.cmd, self); return; }
            var sub = new Shell(self.who);
            sub.cwd = self.cwd; sub.vars = Object.assign({}, self.vars); sub.args = self.args; sub.arg0 = self.arg0;
            return sub.run(pc.cmd, { signal: signal }).then(function (r) { pc.val = r.out.replace(/\n+$/, ""); who = self.who; });
          });
        }, Promise.resolve()).then(function () {
          var joined = pieces.map(function (x) { return x.val; }).join("");
          if (pieces.length === 3 && !pieces[0].val && !pieces[2].val && pieces[1].type === "u") joined.split(/\s+/).filter(Boolean).forEach(function (w) { outArgs.push(w); });
          else outArgs.push(joined);
        });
      });
    }, Promise.resolve()).then(function () { return outArgs; });
  };
  // 通配符展开（参数里有 * ? 才展开，匹配不到保留原样）
  function expand(argv, cwd) {
    var out = [];
    argv.forEach(function (a, i) {
      if (i > 0 && /[*?]/.test(a)) {
        var pre = cwd === "/" ? "/" : cwd + "/"; // 在 / 下面：去掉的是「/」一个字符，不是两个（以前 ls * 会列出 ome、mp）
        var m = glob(a, cwd).map(function (p) { return a[0] === "/" ? p : p.indexOf(pre) === 0 ? p.slice(pre.length) || p : p; });
        if (m.length) return out.push.apply(out, m);
      }
      out.push(a);
    });
    return out;
  }
  function flags(args) {
    var f = {}, rest = [];
    args.forEach(function (a) { if (/^-[a-zA-Z]+$/.test(a)) a.slice(1).split("").forEach(function (c) { f[c] = true; }); else rest.push(a); });
    return { f: f, rest: rest };
  }
  var modeStr = function (f) { var m = f.mode || 0, t = ""; [6, 3, 0].forEach(function (sft) { var b = (m >> sft) & 7; t += (b & 4 ? "r" : "-") + (b & 2 ? "w" : "-") + (b & 1 ? "x" : "-"); }); return (f.dir ? "d" : "-") + t; };
  var ok = function (out) { return Promise.resolve({ out: out || "", err: "", code: 0 }); };
  var fail = function (msg, code) { return Promise.resolve({ out: "", err: msg + "\n", code: code || 1 }); };
  var BUILTINS = ["basename", "cat", "cd", "chmod", "chown", "clear", "cp", "date", "dirname", "echo", "env", "exit", "export", "false", "find", "grep", "head", "help", "ls", "mkdir", "mv", "node", "printenv", "printf",
    "pwd", "python", "python3", "rm", "rmdir", "seq", "sh", "bash", "sleep", "sort", "source", "tail", "test", "touch", "tree", "true", "type", "uniq", "wc", "which", "whoami", "["];
  var positional = function (sh, arg0, args) { sh.arg0 = arg0; sh.args = args; };
  var stripShebang = function (t) { return String(t).replace(/^#!.*\n?/, ""); };
  // test / [：常用的判断
  function testExpr(a, P) {
    if (!a.length) return false;
    if (a[0] === "!") return !testExpr(a.slice(1), P);
    var ai = a.indexOf("-a"), oi = a.indexOf("-o");
    if (oi > 0) return testExpr(a.slice(0, oi), P) || testExpr(a.slice(oi + 1), P);
    if (ai > 0) return testExpr(a.slice(0, ai), P) && testExpr(a.slice(ai + 1), P);
    if (a.length === 1) return a[0] !== "";
    if (a.length === 2) {
      var f = files.get(P(a[1]));
      switch (a[0]) {
        case "-z": return a[1] === ""; case "-n": return a[1] !== "";
        case "-e": return !!f; case "-f": return !!f && !f.dir; case "-d": return !!f && !!f.dir;
        case "-s": return !!f && !f.dir && !!(f.bin ? f.bin.length : (f.data || "").length);
        case "-r": return !!f && can(P(a[1]), "r"); case "-w": return !!f && can(P(a[1]), "w"); case "-x": return !!f && !!(f.mode & 0o111);
      }
      return false;
    }
    var x = a[0], o = a[1], y = a[2], nx = parseInt(x, 10), ny = parseInt(y, 10);
    switch (o) {
      case "=": case "==": return x === y; case "!=": return x !== y;
      case "-eq": return nx === ny; case "-ne": return nx !== ny; case "-lt": return nx < ny; case "-le": return nx <= ny; case "-gt": return nx > ny; case "-ge": return nx >= ny;
    }
    throw new Error("test: 看不懂 " + a.join(" "));
  }
  Shell.prototype.exec = function (argv, stdin, eo) {
    eo = eo || {};
    var self = this, cmd = argv[0], args = argv.slice(1), P = function (p) { return norm(p, self.cwd); };
    who = self.who; // 这条命令以谁的身份执行（同步部分都在下面，不会被别的调用插进来）
    try {
      switch (cmd) {
        case "pwd": return ok(self.cwd + "\n");
        case "cd": { var d = P(args[0] || (self.who ? self.who.home : HOME)); if (!isDir(d)) return fail("cd: 没有这个目录：" + (args[0] || "")); if (!can(d, "r")) return fail("cd: Permission denied: " + d); self.cwd = d; return ok(); }
        case "echo": { var n = args[0] === "-n"; return ok(args.slice(n ? 1 : 0).join(" ") + (n ? "" : "\n")); }
        case "ls": {
          var o = flags(args), targets = o.rest.length ? o.rest : ["."], lines = [];
          targets.forEach(function (t) {
            var p = P(t);
            if (!exists(p)) throw new Error("ls: 没有这个文件：" + t);
            var items = isDir(p) ? list(p) : [p];
            if (targets.length > 1 && isDir(p)) lines.push(t + ":");
            // -a：连 . 和 .. 一起列（同 ls）
            if (o.f.a && isDir(p)) items = [{ dot: ".", k: p }, { dot: "..", k: parent(p) }].concat(items);
            items.forEach(function (it) {
              var k = typeof it === "string" ? it : it.k, f = files.get(k), name = (typeof it === "string" ? base(k) : it.dot) + (f.dir ? "/" : "");
              if (!o.f.a && base(k)[0] === ".") return;
              var size = f.dir ? (can(k, "r") ? list(k).length : 0) : f.bin ? f.bin.length : f.size !== undefined ? f.size : (f.data || "").length;
              if (o.f.l) lines.push(modeStr(f) + "  " + String(userName(f.owner || "user")).padEnd(10) + String(size).padStart(7) + "  " + lsTime(f.mtime) + "  " + name);
              else lines.push(name);
            });
          });
          return ok(lines.join("\n") + (lines.length ? "\n" : ""));
        }
        case "cat": return ok(args.length ? args.map(function (a) { return read(P(a)); }).join("") : stdin || "");
        case "mkdir": { var m = flags(args); m.rest.forEach(function (a) { var p = P(a); if (exists(p) && !m.f.p) throw new Error("mkdir: 已存在：" + a); if (!m.f.p && !isDir(parent(p))) throw new Error("mkdir: 上级目录不存在（用 -p）：" + a); mkdirp(p); }); return ok(); }
        case "touch": args.forEach(function (a) { var p = P(a); if (exists(p)) { files.get(p).mtime = Date.now(); changed(p); } else write(p, ""); }); return ok();
        case "rm": { var r = flags(args); r.rest.forEach(function (a) { var p = P(a); if (!exists(p) && r.f.f) return; remove(p, r.f.r || r.f.R); }); return ok(); }
        case "rmdir": args.forEach(function (a) { remove(P(a), false); }); return ok();
        case "mv": case "cp": { var c = flags(args); if (c.rest.length < 2) return fail(cmd + ": 要两个参数"); var dest = P(c.rest.pop()); c.rest.forEach(function (a) { copy(P(a), dest, cmd === "mv"); }); return ok(); }
        case "head": case "tail": {
          // 行数：-n 5、-n5、-5 都认
          var count = 10, rest2 = [];
          for (var ai = 0; ai < args.length; ai++) {
            var aa = args[ai];
            if (aa === "-n") count = parseInt(args[++ai], 10);
            else if (/^-n\d+$/.test(aa)) count = parseInt(aa.slice(2), 10);
            else if (/^-\d+$/.test(aa)) count = parseInt(aa.slice(1), 10);
            else rest2.push(aa);
          }
          var h = { rest: rest2 };
          var text = h.rest.length ? read(P(h.rest[0])) : stdin || "", ls = text.replace(/\n$/, "").split("\n");
          ls = cmd === "head" ? ls.slice(0, count) : ls.slice(-count);
          return ok(ls.join("\n") + (ls.length ? "\n" : ""));
        }
        case "wc": {
          var w = flags(args), src = w.rest.length ? read(P(w.rest[0])) : stdin || "";
          var nl = (src.match(/\n/g) || []).length, words = (src.match(/\S+/g) || []).length;
          if (w.f.l) return ok(nl + "\n");
          if (w.f.w) return ok(words + "\n");
          if (w.f.c) return ok(src.length + "\n");
          return ok("  " + nl + "  " + words + "  " + src.length + (w.rest[0] ? " " + w.rest[0] : "") + "\n");
        }
        case "grep": {
          var g = flags(args), pat = g.rest.shift();
          if (pat === undefined) return fail("grep: 要一个模式");
          var re = new RegExp(pat, g.f.i ? "i" : ""), res = [], targetsG = g.rest.length ? g.rest : null;
          var scan = function (text, label) {
            text.split("\n").forEach(function (l, i) { if (re.test(l) !== !!g.f.v) res.push((label ? label + ":" : "") + (g.f.n ? i + 1 + ":" : "") + l); });
          };
          if (!targetsG) scan(stdin || "");
          else targetsG.forEach(function (t) {
            var p = P(t);
            if (isDir(p)) { if (!g.f.r) throw new Error("grep: 是目录（用 -r）：" + t); walk(p).forEach(function (k) { var fk = files.get(k); if (!fk.dir && !fk.bin) scan(read(k), k.slice(self.cwd.length + 1) || k); }); }
            else scan(read(p), targetsG.length > 1 ? t : "");
          });
          if (g.f.c) return ok(res.length + "\n");
          return Promise.resolve({ out: res.join("\n") + (res.length ? "\n" : ""), err: "", code: res.length ? 0 : 1 });
        }
        case "find": {
          var root = P(args[0] && args[0][0] !== "-" ? args[0] : "."), ni = args.indexOf("-name"), re2 = ni >= 0 ? globRe(args[ni + 1]) : null, ti = args.indexOf("-type"), ty = ti >= 0 ? args[ti + 1] : "";
          var shown = walk(root).filter(function (k) { return (!re2 || re2.test(base(k))) && (!ty || (ty === "d") === isDir(k)); });
          // 输出路径的写法跟参数一样：给的是绝对路径就输出绝对路径，相对的就 ./ 开头（同 find）
          var given = args[0] && args[0][0] !== "-" ? args[0] : ".";
          return ok(shown.map(function (k) { return given[0] === "/" ? k : k === root ? given : given.replace(/\/$/, "") + k.slice(root.length); }).join("\n") + (shown.length ? "\n" : ""));
        }
        case "tree": {
          var rootT = P(args[0] || "."), lines2 = [args[0] || "."];
          (function draw(p, prefix) {
            var kids = list(p);
            kids.forEach(function (k, i) {
              var last = i === kids.length - 1;
              lines2.push(prefix + (last ? "└── " : "├── ") + base(k) + (isDir(k) ? "/" : ""));
              if (isDir(k)) draw(k, prefix + (last ? "    " : "│   "));
            });
          })(rootT, "");
          return ok(lines2.join("\n") + "\n");
        }
        case "date": return ok(new Date().toString() + "\n");
        case "sort": {
          var so = flags(args), srcS = so.rest.length ? so.rest.map(function (a) { return read(P(a)); }).join("") : stdin || "", arr = srcS.replace(/\n$/, "").split("\n");
          if (!srcS) return ok();
          arr.sort(so.f.n ? function (a, b) { return parseFloat(a) - parseFloat(b); } : undefined);
          if (so.f.r) arr.reverse();
          if (so.f.u) arr = arr.filter(function (x, i) { return arr.indexOf(x) === i; });
          return ok(arr.join("\n") + "\n");
        }
        case "uniq": {
          var uq = flags(args), srcU = uq.rest.length ? read(P(uq.rest[0])) : stdin || "", outU = [], prev = null, cnt = 0;
          srcU.replace(/\n$/, "").split("\n").concat([null]).forEach(function (l) {
            if (l === prev) { cnt++; return; }
            if (prev !== null) outU.push(uq.f.c ? String(cnt).padStart(7) + " " + prev : prev);
            prev = l; cnt = 1;
          });
          return ok(srcU ? outU.join("\n") + "\n" : "");
        }
        case "printf": {
          // 同 sh 的 printf：%s %d %i %f %x %X %o %c %b %%，宽度 / 精度 / - 0 + 空格；参数比格式多就把格式再用一遍（printf "%s\n" a b → 两行）
          var bs = function (x) { return String(x).replace(/\\(\\|n|t|r|a|b|f|v|"|0[0-7]{0,3}|[1-7][0-7]{0,2})/g, function (m0, e) { return { "\\": "\\", n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", f: "\f", v: "\v", '"': '"' }[e] || String.fromCharCode(parseInt(e, 8)); }); };
          var fmtP = bs(args[0] || ""), restP = args.slice(1), outP = "", guard = 0;
          var one = function () {
            var used = 0;
            var text = fmtP.replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?([sdifxXocb%])/g, function (m0, fl, w, pr, cv) {
              if (cv === "%") return "%";
              var a = restP.length ? restP.shift() : undefined, v;
              used++;
              if (cv === "s") v = a === undefined ? "" : String(a), v = pr !== undefined ? v.slice(0, +pr) : v;
              else if (cv === "b") v = a === undefined ? "" : bs(a);
              else if (cv === "c") v = a === undefined ? "" : String(a).charAt(0);
              else if (cv === "f") { var fv = parseFloat(a); v = (isNaN(fv) ? 0 : fv).toFixed(pr !== undefined ? +pr : 6); }
              else { var iv = parseInt(a, 10); iv = isNaN(iv) ? 0 : iv; v = cv === "x" ? iv.toString(16) : cv === "X" ? iv.toString(16).toUpperCase() : cv === "o" ? iv.toString(8) : String(iv); }
              if (/[dif]/.test(cv) && fl.indexOf("+") >= 0 && v[0] !== "-") v = "+" + v;
              else if (/[dif]/.test(cv) && fl.indexOf(" ") >= 0 && v[0] !== "-") v = " " + v;
              var width = w ? +w : 0;
              if (v.length < width) {
                if (fl.indexOf("-") >= 0) v = v + " ".repeat(width - v.length);
                else if (fl.indexOf("0") >= 0 && /[difxXo]/.test(cv)) { var sg = /^[-+ ]/.test(v) ? v[0] : ""; v = sg + "0".repeat(width - v.length) + v.slice(sg.length); }
                else v = " ".repeat(width - v.length) + v;
              }
              return v;
            });
            return { text: text, used: used };
          };
          do { var rp = one(); outP += rp.text; } while (restP.length && rp.used && ++guard < 10000);
          return ok(outP);
        }
        case "chmod": {
          // chmod [-R] 755 路径 / chmod o+w 路径：只有属主（或人）能改
          var cm = flags(args), spec = cm.rest.shift();
          if (!spec || !cm.rest.length) return fail("chmod: 用法 chmod [-R] 755|o+w|o-r 路径");
          cm.rest.forEach(function (a) {
            var p = P(a);
            (cm.f.R ? walk(p) : [p]).forEach(function (k) {
              var f = files.get(k);
              if (!f) throw new Error("chmod: 没有这个文件：" + a);
              if (who && f.owner !== who.name) throw denied(k);
              if (/^[0-7]{3}$/.test(spec)) f.mode = parseInt(spec, 8);
              else {
                var mm = /^([ugoa]*)([+-=])([rwx]+)$/.exec(spec);
                if (!mm) throw new Error("chmod: 看不懂 " + spec);
                var bits = (mm[3].indexOf("r") >= 0 ? 4 : 0) | (mm[3].indexOf("w") >= 0 ? 2 : 0) | (mm[3].indexOf("x") >= 0 ? 1 : 0), mask = 0;
                (mm[1] || "a").split("").forEach(function (c) { if (c === "u" || c === "a") mask |= bits << 6; if (c === "o" || c === "a" || c === "g") mask |= bits; });
                f.mode = mm[2] === "+" ? f.mode | mask : mm[2] === "-" ? f.mode & ~mask : (f.mode & ~(mm[1] === "u" ? 0o700 : 0o007)) | mask;
              }
              changed(k);
            });
          });
          return ok();
        }
        case "chown": {
          if (who) return fail("chown: 只有用户本人能改属主");
          var co = flags(args), owner = co.rest.shift();
          co.rest.forEach(function (a) { (co.f.R ? walk(P(a)) : [P(a)]).forEach(function (k) { var f = files.get(k); if (f) { f.owner = owner; changed(k); } }); });
          return ok();
        }
        case "whoami": return ok((who ? (who.label ? who.label + " (" + who.name + ")" : who.name) : "user") + "\n");
        case "true": return ok();
        case "false": return Promise.resolve({ out: "", err: "", code: 1 });
        case "clear": return ok("\x1b[clear]");
        case "node": return runNode(self, args, stdin, eo);
        case "python": case "python3": return runPython(self, args, stdin, eo);
        case "sleep": {
          var ms = args.reduce(function (n, a) { var m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(a); if (!m) throw new Error("sleep: 看不懂 " + a); return n + parseFloat(m[1]) * { "": 1e3, s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2]]; }, 0);
          return new Promise(function (resolve) {
            var t = setTimeout(function () { if (eo.signal) eo.signal.removeEventListener("abort", stop); resolve({ out: "", err: "", code: 0 }); }, ms);
            var stop = function () { clearTimeout(t); resolve({ out: "", err: "", code: 130 }); };
            if (eo.signal) { if (eo.signal.aborted) return stop(); eo.signal.addEventListener("abort", stop); }
          });
        }
        case "sh": case "bash": case "zsh": {
          // sh 脚本 参数… / sh -c "命令" / echo 命令 | sh：子 shell（同一个身份、目录、变量；$0 $1… $@ $#）
          var ci = args.indexOf("-c"), text, a0, pos;
          if (ci >= 0) { text = args[ci + 1] || ""; a0 = args[ci + 2] || cmd; pos = args.slice(ci + 3); }
          else if (args[0] && args[0][0] !== "-") { text = read(P(args[0])); a0 = args[0]; pos = args.slice(1); }
          else if (stdin) { text = stdin; a0 = cmd; pos = []; }
          else return fail(cmd + ": 要一个脚本文件或 -c 命令（这里没有交互式的子 shell）");
          var sub = new Shell(self.who);
          sub.cwd = self.cwd; sub.vars = Object.assign({}, self.vars);
          positional(sub, a0, pos);
          return sub.run(stripShebang(text), { signal: eo.signal, onOut: eo.onOut }).then(function (r) { who = self.who; return { out: r.out, err: r.err, code: r.code, streamed: eo.onOut ? { out: true, err: true } : null }; });
        }
        case "source": case ".": {
          if (!args[0]) return fail(cmd + ": 要一个文件");
          var src2 = read(P(args[0])), a00 = self.arg0, as0 = self.args;
          positional(self, args[0], args.slice(1));
          return self.run(stripShebang(src2), { signal: eo.signal, onOut: eo.onOut }).then(function (r) { positional(self, a00, as0); return { out: r.out, err: r.err, code: r.code, streamed: eo.onOut ? { out: true, err: true } : null }; });
        }
        case "exit": return Promise.resolve({ out: "", err: "", code: args[0] !== undefined ? parseInt(args[0], 10) || 0 : self.code, exit: true });
        case "env": case "printenv": {
          var en = self.environ();
          if (cmd === "printenv" && args[0]) return en[args[0]] !== undefined ? ok(en[args[0]] + "\n") : Promise.resolve({ out: "", err: "", code: 1 });
          return ok(Object.keys(en).sort().map(function (k) { return k + "=" + en[k]; }).join("\n") + "\n");
        }
        case "export": {
          if (!args.length || args[0] === "-p") { var ex = self.environ(); return ok(Object.keys(ex).sort().map(function (k) { return "export " + k + "=" + JSON.stringify(ex[k]); }).join("\n") + "\n"); }
          args.forEach(function (a) { var k = a.indexOf("="); if (k > 0) self.vars[a.slice(0, k)] = a.slice(k + 1); else if (self.vars[a] == null) self.vars[a] = ""; });
          return ok();
        }
        case "which": case "type": {
          var miss = 0, lines3 = args.map(function (a) {
            if (BUILTINS.indexOf(a) >= 0 || COMMANDS_EXT[a]) return cmd === "type" ? a + " is " + (/^(cd|export|exit|source|\.|type|test|\[)$/.test(a) ? "a shell builtin" : "/bin/" + a) : "/bin/" + a;
            miss++;
            return cmd === "type" ? cmd + ": " + a + ": not found" : "";
          }).filter(Boolean);
          return Promise.resolve({ out: lines3.join("\n") + (lines3.length ? "\n" : ""), err: "", code: miss ? 1 : 0 });
        }
        case "test": case "[": {
          var ta2 = args.slice();
          if (cmd === "[") { if (ta2[ta2.length - 1] !== "]") return fail("[: 缺少 ]", 2); ta2.pop(); }
          return Promise.resolve({ out: "", err: "", code: testExpr(ta2, P) ? 0 : 1 });
        }
        case "basename": { if (!args[0]) return fail("basename: 要一个路径"); var b0 = args[0].replace(/\/+$/, "").split("/").pop() || "/"; if (args[1] && b0.slice(-args[1].length) === args[1] && b0 !== args[1]) b0 = b0.slice(0, -args[1].length); return ok(b0 + "\n"); }
        case "dirname": { if (!args[0]) return fail("dirname: 要一个路径"); var d0 = args[0].replace(/\/+$/, ""), di = d0.lastIndexOf("/"); return ok((di < 0 ? "." : di === 0 ? "/" : d0.slice(0, di)) + "\n"); }
        case "seq": {
          var nums = args.map(Number);
          if (!args.length || nums.some(isNaN)) return fail("seq: 用法 seq [起] [步长] 止");
          var first = nums.length > 1 ? nums[0] : 1, step = nums.length > 2 ? nums[1] : 1, lastN = nums[nums.length - 1], outS = [];
          for (var x = first; step > 0 ? x <= lastN : x >= lastN; x += step) { outS.push(String(x)); if (outS.length > 100000) break; }
          return ok(outS.join("\n") + (outS.length ? "\n" : ""));
        }
        case "help": return ok("命令：" + BUILTINS.filter(function (b) { return b !== "["; }).join(" ") + (Object.keys(COMMANDS_EXT).length ? " " + Object.keys(COMMANDS_EXT).join(" ") : "") +
          "\n语法：| > >> 2>&1 2>/dev/null < && || ; heredoc（<<EOF）；$VAR ${VAR:-默认} $? $@ $1…；$( 命令 ) 与 `命令`；$(( 1 + 2 ))；test / [ ]；sh 脚本；source 文件\n" +
          "node：Node 的常用内置模块（fs path os util events crypto readline…）与 fetch；python：Pyodide（第一次要下载约 10 MB）\n");
        default:
          // 外部注册的命令（git.js 等）：同步执行，身份（who）在这条命令期间不变
          if (COMMANDS_EXT[cmd]) return Promise.resolve(COMMANDS_EXT[cmd]({ cwd: self.cwd, who: who, user: who ? who.name : "user", stdin: stdin, fs: FS_API, env: self.environ(), signal: eo.signal }, args));
          return fail(cmd + ": 没有这个命令（help 看可用命令）", 127);
      }
    } catch (e) {
      return fail(e.message);
    }
  };

  // ---- node：Worker（sandbox-node.js）里跑，行为同 Node：await / 定时器 / fetch 都等它们做完才结束；输出、文件改动边跑边回来 ----
  // 没有固定超时：由调用方给 signal（Bash 工具默认 2 分钟、最多 10 分钟；终端里 Ctrl+C）
  // 快照：这个身份能读的文件（文本是字符串，二进制是 { bin }），加上每个路径能不能写（agent；人 = null，都能写）
  function snapshot(forPython) {
    var fsSnap = {}, meta = {}, W = who ? {} : null;
    files.forEach(function (v, k) {
      if (!can(k, "r")) return;
      fsSnap[k] = v.dir ? true : v.bin ? (forPython ? v.bin : { bin: v.bin }) : v.data;
      meta[k] = { mtime: v.mtime, mode: v.mode };
      if (W) W[k] = can(k, "w");
    });
    return { files: fsSnap, meta: meta, writable: W };
  }
  // Worker 发回来的文件改动，按执行者的身份落盘
  function applyOp(o) {
    if (o[0] === "write") { if (typeof o[2] === "string") write(o[1], o[2]); else writeBin(o[1], o[2].bin); }
    else if (o[0] === "mkdir") mkdirp(o[1]);
    else if (o[0] === "rm") { if (exists(o[1])) remove(o[1], true); }
    else if (o[0] === "mv") { if (exists(o[2])) remove(o[2], true); copy(o[1], o[2], true); }
    else if (o[0] === "cp") copy(o[1], o[2], false);
  }
  function runNode(sh, args, stdin, eo) {
    eo = eo || {};
    var mode = "", code = "", script = null, rest = [];
    if (args[0] === "-v" || args[0] === "--version") return ok("v22.12.0\n");
    if (args[0] === "-h" || args[0] === "--help") return ok("用法：node 文件.js [参数…] | node -e \"代码\" | node -p \"表达式\" | echo 代码 | node\n沙盒里的 node：fs path os util events crypto readline timers stream 等内置模块，全局 fetch；没有 npm、子进程、http 服务器。\n");
    if (/^(-e|--eval|-p|--print)$/.test(args[0] || "")) { mode = /p/.test(args[0]) ? "p" : "e"; code = args[1] || ""; rest = args.slice(2); }
    else if (args[0] && args[0] !== "-") { script = norm(args[0], sh.cwd); try { code = read(script); } catch (e) { return fail("node: " + (/没有这个文件/.test(e.message) ? "Cannot find module '" + script + "'" : e.message)); } rest = args.slice(1); }
    else if (stdin) { code = stdin; stdin = ""; rest = args.slice(1); mode = "e"; }
    else return fail("node: 要一个文件或 -e 代码（沙盒里没有交互式 REPL）");
    var snap = snapshot(false);
    return new Promise(function (resolve) {
      var w, out = "", err = "", errs = "", done = false;
      try { w = new Worker(NODE_URL); } catch (e) { return resolve({ out: "", err: "node: 启动不了：" + e.message + "\n", code: 1 }); }
      function end(r) { if (done) return; done = true; w.terminate(); if (eo.signal) eo.signal.removeEventListener("abort", onAbort); r.streamed = eo.onOut ? { out: true, err: true } : null; who = sh.who; resolve(r); }
      function onAbort() { end({ out: out, err: err + errs, code: 130 }); }
      if (eo.signal) { if (eo.signal.aborted) return onAbort(); eo.signal.addEventListener("abort", onAbort); }
      w.onmessage = function (e) {
        var m = e.data;
        if (done) return;
        if (m.t === "io") {
          if (m.ops && m.ops.length) {
            who = sh.who;
            m.ops.forEach(function (o) { try { applyOp(o); } catch (x) { var msg = "node: " + x.message + "\n"; errs += msg; if (eo.onOut) eo.onOut(msg, 2); } });
          }
          if (m.out) { out += m.out; if (eo.onOut) eo.onOut(m.out, 1); }
          if (m.err) { err += m.err; if (eo.onOut) eo.onOut(m.err, 2); }
        } else if (m.t === "done") end({ out: out, err: err + errs, code: m.code || (errs ? 1 : 0) });
      };
      w.onerror = function (e) { if (e.preventDefault) e.preventDefault(); var msg = "node: " + (e.message || "Worker 出错") + "\n"; if (eo.onOut) eo.onOut(msg, 2); end({ out: out, err: err + errs + msg, code: 1 }); };
      w.postMessage({ files: snap.files, meta: snap.meta, writable: snap.writable, cwd: sh.cwd, home: sh.env("HOME"), user: sh.env("USER"), env: sh.environ(), script: script, code: code, args: rest, stdin: stdin || "", mode: mode });
    });
  }

  // ---- python：Pyodide（第一次用时从 CDN 下载，之后留在这个 Worker 里）；输出边跑边回来；跑完把文件的改动同步回沙盒 ----
  // 一次只跑一个（排队）；signal 中断 = 结束这个 Worker（下次再加载）
  var PY_WORKER = [
    "importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');",
    "var ready = loadPyodide();",
    "self.onmessage = async function (e) {",
    "  var d = e.data, py = await ready, pend = { out: '', err: '' }, flushT = 0;",
    "  var flush = function () { flushT = 0; if (pend.out || pend.err) { self.postMessage({ t: 'io', out: pend.out, err: pend.err }); pend = { out: '', err: '' }; } };",
    "  var put = function (k, s) { pend[k] += s + '\\n'; if (!flushT) flushT = setTimeout(flush, 30); };",
    "  py.setStdout({ batched: function (s) { put('out', s); } });",
    "  py.setStderr({ batched: function (s) { put('err', s); } });",
    "  var given = !d.stdin;",
    "  py.setStdin({ stdin: function () { if (given) return undefined; given = true; return d.stdin; }, isatty: false });",
    "  Object.keys(d.files).forEach(function (p) { try { if (d.files[p] === true) py.FS.mkdirTree(p); else { py.FS.mkdirTree(p.split('/').slice(0, -1).join('/') || '/'); py.FS.writeFile(p, d.files[p]); } } catch (x) {} });",
    "  try { py.FS.mkdirTree(d.cwd); py.FS.chdir(d.cwd); } catch (x) {}",
    "  var code = 0;",
    "  try { py.globals.set('__argv', py.toPy(d.argv)); py.globals.set('__env', py.toPy(d.env)); await py.runPythonAsync('import sys, os\\nsys.argv = list(__argv)\\nos.environ.update(dict(__env))\\n' + d.code); }",
    "  catch (x) { var m = String(x.message || x); var se = /SystemExit: (\\d+)/.exec(m); if (se) code = +se[1]; else if (/SystemExit/.test(m)) code = 0; else { code = 1; put('err', m.replace(/\\n$/, '')); } }",
    "  flush();",
    "  var back = {};",
    "  (function walk(p) { py.FS.readdir(p).forEach(function (n) { if (n === '.' || n === '..') return; var q = (p === '/' ? '' : p) + '/' + n;",
    "    if (/^\\/home\\/(pyodide|web_user)(\\/|$)/.test(q) || /^\\/(proc|dev|lib|usr|bin|sys)(\\/|$)/.test(q)) return;",
    "    var st = py.FS.stat(q); if (py.FS.isDir(st.mode)) { if (/^\\/(home|tmp|shared|agents|etc|Applications)(\\/|$)/.test(q)) { back[q] = true; walk(q); } }",
    "    else if (/^\\/(home|tmp|shared|agents|etc|Applications)\\//.test(q)) back[q] = py.FS.readFile(q); }); })('/');",
    "  self.postMessage({ t: 'done', code: code, files: back });",
    "};",
  ].join("\n");
  // Pyodide 自己的目录（/home/pyodide、/home/web_user）不同步回沙盒
  var pyWorker = null, pyQueue = Promise.resolve(), SYNC = /^\/(home\/(?!pyodide(\/|$)|web_user(\/|$))|tmp\/|shared\/|agents\/|etc\/|Applications\/)/;
  var sameBytes = function (a, b) { if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  function runPython(sh, args, stdin, eo) {
    eo = eo || {};
    var code, argv;
    if (args[0] === "-V" || args[0] === "--version") return ok("Python 3.12 (Pyodide 0.26)\n");
    if (args[0] === "-c") { code = args[1] || ""; argv = ["-c"].concat(args.slice(2)); }
    else if (args[0] === "-m") return fail("python: 沙盒里不支持 -m（没有 pip / venv 之类）");
    else if (args[0] && args[0] !== "-") { try { code = read(norm(args[0], sh.cwd)); } catch (e) { return fail("python: " + e.message); } argv = args; }
    else if (stdin) { code = stdin; stdin = ""; argv = [""]; }
    else return fail("python: 要一个文件或 -c 代码（沙盒里没有交互式解释器）");
    var job = pyQueue.then(function () { return pyRun(sh, code, argv, stdin, eo); });
    pyQueue = job.then(function () {}, function () {});
    return job;
  }
  function pyRun(sh, code, argv, stdin, eo) {
    if (eo.signal && eo.signal.aborted) return Promise.resolve({ out: "", err: "", code: 130 });
    who = sh.who;
    var fresh0 = !pyWorker;
    if (!pyWorker) pyWorker = new Worker(URL.createObjectURL(new Blob([PY_WORKER], { type: "text/javascript" })));
    var snap = snapshot(true);
    return new Promise(function (resolve) {
      var w = pyWorker, out = "", err = "", done = false;
      if (fresh0 && eo.onOut) eo.onOut("（正在加载 Python，第一次要下载约 10 MB…）\n", 2);
      function end(r) { if (done) return; done = true; if (eo.signal) eo.signal.removeEventListener("abort", onAbort); r.streamed = eo.onOut ? { out: true, err: true } : null; who = sh.who; resolve(r); }
      function onAbort() { w.terminate(); if (pyWorker === w) pyWorker = null; end({ out: out, err: err, code: 130 }); }
      if (eo.signal) eo.signal.addEventListener("abort", onAbort);
      w.onmessage = function (e) {
        var m = e.data;
        if (done) return;
        if (m.t === "io") { if (m.out) { out += m.out; if (eo.onOut) eo.onOut(m.out, 1); } if (m.err) { err += m.err; if (eo.onOut) eo.onOut(m.err, 2); } return; }
        if (m.t !== "done") return;
        who = sh.who;
        var back = m.files, errs = "";
        Object.keys(back).forEach(function (p) {
          try {
            if (back[p] === true) { if (!isDir(p)) mkdirp(p); return; }
            var sent = snap.files[p], now = back[p];
            if (sent !== undefined && sent !== true && sameBytes(typeof sent === "string" ? new TextEncoder().encode(sent) : sent, now)) return; // 没改过
            var text = null;
            try { text = new TextDecoder("utf-8", { fatal: true }).decode(now); } catch (x) { text = null; }
            if (text !== null) write(p, text); else writeBin(p, now);
          } catch (x) { errs += x.message + "\n"; }
        });
        // 删掉的：发过去时有、回来时没有的（只看发过去的那一份，别的地方同时新建的不算）
        Object.keys(snap.files).forEach(function (p) { try { if (SYNC.test(p) && !(p in back) && exists(p)) remove(p, true); } catch (x) { errs += x.message + "\n"; } });
        if (errs && eo.onOut) eo.onOut(errs, 2);
        end({ out: out, err: err + errs, code: errs ? 1 : m.code });
      };
      w.onerror = function (e) { if (pyWorker === w) pyWorker = null; var msg = "python: " + (e.message || "加载失败（要联网下载 Pyodide）") + "\n"; if (eo.onOut) eo.onOut(msg, 2); end({ out: out, err: err + msg, code: 1 }); };
      w.postMessage({ code: code, argv: argv, cwd: sh.cwd, files: snap.files, stdin: stdin || "", env: sh.environ() });
    });
  }

  // 属主的显示名（agent 的属主是它的 id；live.js 把 id 换成名字）
  var userName = function (owner) { return owner; };
  // 给外部命令用的文件接口：都按当前身份做权限检查
  var COMMANDS_EXT = {};
  var FS_API = { norm: norm, exists: exists, isDir: isDir, read: read, write: write, readBinary: readBin, writeBinary: writeBin, list: list, remove: remove, mkdirp: mkdirp, walk: walk,
    stat: function (p) { return files.get(p); }, copy: function (a, b) { copy(a, b, false); }, move: function (a, b) { copy(a, b, true); } };
  window.SANDBOX = {
    registerCommand: function (name, fn) { COMMANDS_EXT[name] = fn; },
    commandNames: function () { return BUILTINS.filter(function (b) { return b !== "["; }).concat(Object.keys(COMMANDS_EXT)).sort(); },
    // 二进制文件：writeBinary(路径, Uint8Array)、readBinary(路径) → Uint8Array（文本文件读出来是它的 UTF-8 字节）；stat(路径).binary / .size
    writeBinary: function (p, u8) { writeBin(p, u8); }, readBinary: function (p) { return readBin(p); },
    HOME: HOME,
    ready: function () { return ready || (ready = load()); },
    norm: norm, exists: exists, isDir: isDir, read: read, write: write, list: list, remove: remove, mkdirp: mkdirp, glob: glob, walk: walk,
    copy: function (a, b) { copy(a, b, false); }, move: function (a, b) { copy(a, b, true); },
    stat: function (p) { return files.get(p); },
    can: function (p, need, principal) { var w0 = who; who = principal || null; try { return can(p, need); } finally { who = w0; } },
    modeStr: modeStr,
    // 以某个身份执行一段同步的文件操作（Read / Write / Edit / Glob / Grep 工具用）
    as: function (principal, fn) { var w0 = who; who = principal || null; try { return fn(); } finally { who = w0; } },
    // agent 的独立空间：/agents/<名字>，属主是它自己，755（别人按自己的档位可以看、不能改）
    ensureAgent: function (name) {
      var home = "/agents/" + name;
      if (!files.has(home)) { files.set(home, { dir: true, mtime: Date.now(), owner: name, mode: 0o755 }); changed(home); }
      return home;
    },
    Shell: Shell,
    onChange: function (f) { listeners.push(f); },
    // 把某个属主的文件都改到另一个属主名下（agent 从名字换成 id 时用）
    renameOwner: function (from, to) { if (!from || from === to) return 0; var n = 0; files.forEach(function (v, k) { if (v.owner === from) { v.owner = to; persist(k); n++; } }); return n; },
    setUserNames: function (fn) { userName = function (o) { try { return fn(o) || o; } catch (e) { return o; } }; },
    // 真沙盒的镜像（/home/user、/agents、/shared）：mirrorStart(布局)、mirrorActive()、refreshMirror()、ensureLoaded(路径们) → Promise（大文件、二进制用到时再取）
    mirrorStart: mirrorStart,
    mirrorActive: function () { return !!mirror; },
    mirrorInfo: function () { return mirror ? { driver: mirror.driver, home: mirror.map["/home/user"] } : null; },
    mirrorImportable: importable,
    mirrorFlush: flushNow,
    mirrorImport: importLocal,
    // 虚拟路径（访达、编辑器看到的）↔ 真沙盒里的路径（Docker 一样；macOS 的 seatbelt 在 /Users/Shared/tsu/… 下）
    toReal: function (v) { return mirrored(v) ? toReal(v) : v; },
    toVirtual: function (p) { return mirror ? toVirt(p) || p : p; },
    refreshMirror: function () { return refreshMirror(); },
    ensureLoaded: function (paths) { return ensureLoaded(paths); },
    userName: function (o) { return userName(o); },
  };
})();
