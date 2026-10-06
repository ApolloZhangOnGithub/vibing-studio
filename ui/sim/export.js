// export.js —— 「传输」：沙盒和这台电脑之间搬文件（下载只在这里做，访达不再管下载）。
// ⬇︎ 下载到本机：从访达拖文件 / 文件夹进来（application/x-tsu-paths）放上架子，一起打成 zip 下载；只有一个普通文件时原样下载（勾了「总是打包」除外）。
//    zip 是自己写的：本地文件头 + 中央目录 + 目录结尾，CRC-32，UTF-8 文件名（标志位第 11 位）；浏览器有 CompressionStream("deflate-raw") 就压缩，没有就只存储
// ⬆︎ 上传到沙盒：从电脑拖文件 / 文件夹进来（webkitGetAsEntry 走目录，保留结构），放进 ~/上传；拖进来的 zip 可以解压（DecompressionStream）
// Dock 图标也收拖放，按拖的是什么自动分流：访达里的 → 打包下载，电脑里的 → 上传。
// 对外：window.TSU_TRANSFER（同 TSU_EXPORT）{ add(paths), download(paths), upload(文件 / entry / DataTransfer), extract(zip, 名字), open(tab), zip, unzip, pack }
(function () {
  "use strict";
  var FS = window.SANDBOX;
  if (!FS) return;
  var HOME = FS.HOME || "/home/user", UP = HOME + "/上传";
  var MIME = "application/x-tsu-paths"; // 访达拖出来的：被拖的沙盒路径（JSON 数组）
  var MAX_FILE = 50e6, MAX_TOTAL = 200e6; // 上传 / 解压的上限：单个 50 MB、一次 200 MB（整个沙盒都放在内存里）

  // ---- 小工具 ----
  var baseOf = function (p) { return p === "/" ? "/" : p.slice(p.lastIndexOf("/") + 1); };
  var join = function (dir, name) { return (dir === "/" ? "" : dir) + "/" + name; };
  var extOf = function (n) { var i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; };
  var tilde = function (p) { return p === HOME ? "~" : p.indexOf(HOME + "/") === 0 ? "~" + p.slice(HOME.length) : p; };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var two = function (n) { return String(n).padStart(2, "0"); };
  var topName = function (p) { return p === "/" ? "根目录" : baseOf(p); };
  var stemOf = function (n) { return n.replace(/\.zip$/i, "") || n; };
  var list = function (x) { return x == null ? [] : typeof x === "string" ? [x] : Array.prototype.slice.call(x); };
  function stamp() { var d = new Date(); return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + "-" + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds()); } // 本地时区，20260926-102829
  var defZip = function () { return "导出-" + stamp() + ".zip"; };
  // 用户填的 zip 名：去掉不能进文件名的字，补上 .zip；空的就用默认名
  function cleanZip(s) {
    s = String(s || "").replace(/[\/\\\u0000-\u001f]/g, "-").trim();
    return !s || /^\.zip$/i.test(s) ? defZip() : /\.zip$/i.test(s) ? s : s + ".zip";
  }
  // 大小（同访达：十进制，1 KB = 1000 字节）
  function size(n) {
    if (n < 1000) return n + " 字节";
    if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + " KB";
    if (n < 1e9) return (n / 1e6).toFixed(1) + " MB";
    return (n / 1e9).toFixed(1) + " GB";
  }
  var enc = new TextEncoder(), utf8Strict = new TextDecoder("utf-8", { fatal: true });
  var utf8Keep = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }); // 判断上传的是不是文本：BOM 原样留着，存回去字节不变
  var store = {
    get: function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  // 一律以「人」的身份读写：agent 的 shell 跑完后，SANDBOX 里的当前身份可能还停在那个 agent 上
  var human = function (fn) { return FS.as ? FS.as(null, fn) : fn(); };
  var canBin = function () { return typeof FS.writeBinary === "function"; };
  // macOS 打包 / 拖放时夹带的杂物，不要
  var junk = function (rel) { return /(^|\/)__MACOSX(\/|$)/.test(rel) || /(^|\/)\.DS_Store$/.test(rel); };
  // 字符串按 UTF-8 编码后的长度（不真的编码，文件多时省内存）
  function utf8Len(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  // 沙盒里一个文件的字节 / 大小：二进制的（stat.binary）走 readBinary，文本按 UTF-8
  function bytesOf(p) {
    return human(function () { return (FS.stat(p) || {}).binary && FS.readBinary ? FS.readBinary(p) : enc.encode(FS.read(p)); });
  }
  function sizeOf(p) {
    var st = FS.stat(p) || {};
    if (!st.binary) return utf8Len(typeof st.data === "string" ? st.data : "");
    if (typeof st.size === "number") return st.size;
    if (st.data && typeof st.data.byteLength === "number") return st.data.byteLength;
    try { return bytesOf(p).length; } catch (e) { return 0; }
  }
  // 重名时换成「名字 2.扩展名」「名字 3.扩展名」……（同 macOS）；taken(名字) 说这个名字有没有被占
  function nextName(name, isDir, taken) {
    var dot = isDir ? -1 : name.lastIndexOf("."), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "", n = name;
    for (var i = 2; taken(n); i++) n = stem + " " + i + ext;
    return n;
  }
  function freeName(dir, name, isDir, used) {
    used = used || {};
    var n = nextName(name, isDir, function (x) { return used[x] || FS.exists(join(dir, x)); });
    used[n] = 1;
    return n;
  }
  // 一项一项地做（fn 可以返回 Promise）；隔一会儿让出主线程，进度条才画得出来
  function each(items, fn) {
    return new Promise(function (resolve, reject) {
      var i = 0, t0 = Date.now();
      (function step() {
        try {
          while (i < items.length) {
            var r = fn(items[i], i++);
            if (r && typeof r.then === "function") { r.then(step, reject); return; }
            if (Date.now() - t0 > 30) { t0 = Date.now(); setTimeout(step, 0); return; }
          }
          resolve();
        } catch (e) { reject(e); }
      })();
    });
  }

  // ======== ZIP：写 ========
  var CRC_T = (function () {
    var t = new Int32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return t;
  })();
  function crc32(u8) {
    var c = -1;
    for (var i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }
  // 浏览器支不支持 deflate-raw：不支持时构造就会抛错
  var streamOK = function (C) { try { new C("deflate-raw"); return true; } catch (e) { return false; } };
  var CAN_DEFLATE = typeof CompressionStream === "function" && streamOK(CompressionStream);
  var CAN_INFLATE = typeof DecompressionStream === "function" && streamOK(DecompressionStream);
  function deflate(u8) {
    return new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  // DOS 时间：本地时间、2 秒一格，只能表示 1980–2107 年
  function dosTime(ms) {
    var d = new Date(ms || Date.now()), y = d.getFullYear();
    if (y < 1980) d = new Date(1980, 0, 1); else if (y > 2107) d = new Date(2107, 11, 31, 23, 59, 58);
    return [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()];
  }
  // 扩展时间戳（0x5455「UT」）：修改时间的 Unix 秒，解压出来的时间不受时区影响。本地头和中央目录里各放一份，都是 9 字节
  function utStamp(v, at, unix) {
    v.setUint16(at, 0x5455, true);
    v.setUint16(at + 2, 5, true);
    v.setUint8(at + 4, 1);
    v.setUint32(at + 5, unix >>> 0, true);
  }
  // entries：[{ name（zip 里的相对路径，目录以 / 结尾）, data（Uint8Array 或字符串；目录不用给）, mtime }] → Promise<Blob>
  // 每项：本地文件头（30 字节 + 文件名 + 扩展字段）+ 数据；最后是中央目录（每项 46 字节 + 文件名 + 扩展字段）与目录结尾（22 字节）。
  // 大小、CRC 都先算好再写头，所以不用数据描述符（标志位第 3 位）；压了不见小就只存储
  function zip(entries, opts) {
    opts = opts || {};
    var squeeze = CAN_DEFLATE && !opts.store, parts = [], cd = [], cdLen = 0, off = 0;
    if (entries.length > 0xffff) return Promise.reject(new Error("项目太多了（zip 最多 65535 项）"));
    return each(entries, function (e, i) {
      var dir = /\/$/.test(e.name), raw = dir ? new Uint8Array(0) : typeof e.data === "string" ? enc.encode(e.data) : e.data || new Uint8Array(0);
      return (squeeze && raw.length > 32 ? deflate(raw) : Promise.resolve(null)).then(function (z) {
        var method = z && z.length < raw.length ? 8 : 0, body = method ? z : raw, name = enc.encode(e.name);
        var t = dosTime(e.mtime), unix = Math.floor((e.mtime || Date.now()) / 1000), crc = crc32(raw), need = dir || method ? 20 : 10;
        if (off + 39 + name.length + body.length > 0xffffffff) throw new Error("太大了（zip 最大 4 GB）");
        // 本地文件头
        var lh = new Uint8Array(30 + name.length + 9), v = new DataView(lh.buffer);
        v.setUint32(0, 0x04034b50, true);
        v.setUint16(4, need, true);        // 解压所需版本：存储 1.0，压缩 / 目录 2.0
        v.setUint16(6, 0x0800, true);      // 第 11 位：文件名是 UTF-8
        v.setUint16(8, method, true);      // 0 存储 / 8 deflate
        v.setUint16(10, t[0], true);
        v.setUint16(12, t[1], true);
        v.setUint32(14, crc, true);
        v.setUint32(18, body.length, true);
        v.setUint32(22, raw.length, true);
        v.setUint16(26, name.length, true);
        v.setUint16(28, 9, true);
        lh.set(name, 30);
        utStamp(v, 30 + name.length, unix);
        // 中央目录里的这一项
        var ch = new Uint8Array(46 + name.length + 9), w = new DataView(ch.buffer);
        w.setUint32(0, 0x02014b50, true);
        w.setUint16(4, 0x0314, true);      // 由 Unix 写成（外部属性的高 16 位是 Unix 权限），规范 2.0
        w.setUint16(6, need, true);
        w.setUint16(8, 0x0800, true);
        w.setUint16(10, method, true);
        w.setUint16(12, t[0], true);
        w.setUint16(14, t[1], true);
        w.setUint32(16, crc, true);
        w.setUint32(20, body.length, true);
        w.setUint32(24, raw.length, true);
        w.setUint16(28, name.length, true);
        w.setUint16(30, 9, true);          // 32 注释长度、34 起始盘号、36 内部属性都是 0
        w.setUint32(38, dir ? 0x41ed0010 : 0x81a40000, true); // drwxr-xr-x（加 DOS 的目录位）/ -rw-r--r--
        w.setUint32(42, off, true);        // 本地文件头在哪
        ch.set(name, 46);
        utStamp(w, 46 + name.length, unix);
        parts.push(lh, body);
        cd.push(ch);
        off += lh.length + body.length;
        cdLen += ch.length;
        if (opts.progress) opts.progress(i + 1, entries.length);
      });
    }).then(function () {
      var eo = new Uint8Array(22), v = new DataView(eo.buffer);
      v.setUint32(0, 0x06054b50, true);   // 4 本盘号、6 中央目录所在盘号都是 0
      v.setUint16(8, entries.length, true);
      v.setUint16(10, entries.length, true);
      v.setUint32(12, cdLen, true);
      v.setUint32(16, off, true);         // 中央目录从哪开始；20 注释长度 0
      return new Blob(parts.concat(cd, [eo]), { type: "application/zip" });
    });
  }

  // ======== ZIP：读 ========
  var u64 = function (v, at) { return v.getUint32(at, true) + v.getUint32(at + 4, true) * 4294967296; };
  // 没打 UTF-8 标记的文件名：先当 UTF-8（很多工具写 UTF-8 却不打标记）→ 再当 GB18030（中文 Windows 压的包）→ 最后按规范当 CP437
  var CP437 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0";
  function decodeName(b, utf8) {
    if (utf8) return new TextDecoder().decode(b);
    try { return utf8Strict.decode(b); } catch (e) { /* 不是 UTF-8 */ }
    try { return new TextDecoder("gb18030", { fatal: true }).decode(b); } catch (e) { /* 也不是 GB18030 */ }
    var s = "";
    for (var i = 0; i < b.length; i++) s += b[i] < 128 ? String.fromCharCode(b[i]) : CP437[b[i] - 128];
    return s;
  }
  // zip 里的路径 → 安全的相对路径：反斜杠也当分隔符，去掉开头的 /、盘符、. 与 ..（不许解压到目标文件夹外面）
  function cleanPath(name) {
    return name.replace(/\\/g, "/").split("/").filter(function (s) { return s && s !== "." && s !== ".." && !/^[A-Za-z]:$/.test(s); }).join("/");
  }
  var dosMs = function (date, time) { return new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2).getTime(); };
  // 解 deflate：边解边数，超过记录的大小就停（防 zip 炸弹）
  function inflate(u8, limit) {
    var rd = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader(), chunks = [], got = 0;
    return (function pump() {
      return rd.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(got), at = 0;
          chunks.forEach(function (c) { out.set(c, at); at += c.length; });
          return out;
        }
        got += r.value.length;
        if (got > limit) { rd.cancel().catch(function () {}); throw new Error("解压出来比记录的大"); }
        chunks.push(r.value);
        return pump();
      });
    })();
  }
  // 读 zip → Promise<{ entries: [{ name（清理过的相对路径）, dir, data, mtime }], skipped: [{ name, why }] }>
  // 从目录结尾找中央目录（支持 ZIP64），逐项到本地文件头后面取数据：存储（0）直接用，deflate（8）用 DecompressionStream；CRC 对不上的不要
  function unzip(src) {
    var u8 = src instanceof Uint8Array ? src : new Uint8Array(src), n = u8.length, v = new DataView(u8.buffer, u8.byteOffset, n), eocd = -1;
    for (var i = n - 22; i >= 0 && i >= n - 22 - 0xffff; i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return Promise.reject(new Error("不是 zip 文件，或者已经损坏"));
    var count = v.getUint16(eocd + 10, true), at = v.getUint32(eocd + 16, true);
    // ZIP64：条目数 / 偏移放不下时写成全 1，真的值在 ZIP64 目录结尾里（位置由紧挨着的定位器给）
    if ((count === 0xffff || at === 0xffffffff) && eocd >= 20 && v.getUint32(eocd - 20, true) === 0x07064b50) {
      var z64 = u64(v, eocd - 12);
      if (z64 + 56 <= n && v.getUint32(z64, true) === 0x06064b50) { count = u64(v, z64 + 32); at = u64(v, z64 + 48); }
    }
    var items = [];
    for (var k = 0, p = at; k < count && p + 46 <= n && v.getUint32(p, true) === 0x02014b50; k++) {
      var e = { host: v.getUint16(p + 4, true) >> 8, flags: v.getUint16(p + 8, true), method: v.getUint16(p + 10, true), time: v.getUint16(p + 12, true),
        date: v.getUint16(p + 14, true), crc: v.getUint32(p + 16, true), csize: v.getUint32(p + 20, true), usize: v.getUint32(p + 24, true),
        attr: v.getUint32(p + 38, true), off: v.getUint32(p + 42, true), name: null };
      var nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), raw = u8.subarray(p + 46, p + 46 + nl);
      // 扩展字段：ZIP64 的真实大小 / 偏移（按顺序，只放头里写成全 1 的那几个）；Info-ZIP 的 UTF-8 文件名（原文件名的 CRC 对得上才用）
      for (var x = p + 46 + nl, xe = x + xl; x + 4 <= xe; x += 4 + v.getUint16(x + 2, true)) {
        var id = v.getUint16(x, true), d = x + 4, de = Math.min(d + v.getUint16(x + 2, true), xe);
        if (id === 0x0001) {
          if (e.usize === 0xffffffff && d + 8 <= de) { e.usize = u64(v, d); d += 8; }
          if (e.csize === 0xffffffff && d + 8 <= de) { e.csize = u64(v, d); d += 8; }
          if (e.off === 0xffffffff && d + 8 <= de) e.off = u64(v, d);
        } else if (id === 0x7075 && de - d > 5 && v.getUint32(d + 1, true) === crc32(raw)) {
          try { e.name = utf8Strict.decode(u8.subarray(d + 5, de)); } catch (err) { /* 坏了就用原来的名字 */ }
        }
      }
      if (e.name == null) e.name = decodeName(raw, e.flags & 0x800);
      items.push(e);
      p += 46 + nl + xl + cl;
    }
    var out = [], skipped = [], total = 0;
    return each(items, function (e) {
      var name = cleanPath(e.name), mode = e.host === 3 ? e.attr >>> 16 : 0, mtime = dosMs(e.date, e.time);
      if (!name || junk(name)) return;
      if (/[\/\\]$/.test(e.name) || (mode & 0xf000) === 0x4000) { out.push({ name: name, dir: true, mtime: mtime }); return; }
      var why = e.flags & 1 ? "加密了" : (mode & 0xf000) === 0xa000 ? "符号链接" : e.method !== 0 && e.method !== 8 ? "压缩方式不支持（" + e.method + "）" :
        e.method === 8 && !CAN_INFLATE ? "浏览器不支持解压" : e.usize > MAX_FILE ? "超过 50 MB" : (total += e.usize) > MAX_TOTAL ? "解压后超过 200 MB" : "";
      var s = e.off + 30 + (e.off + 30 <= n ? v.getUint16(e.off + 26, true) + v.getUint16(e.off + 28, true) : 0);
      if (!why && (e.off + 30 > n || v.getUint32(e.off, true) !== 0x04034b50 || s + e.csize > n)) why = "数据损坏";
      if (why) { skipped.push({ name: name, why: why }); return; }
      var body = u8.subarray(s, s + e.csize); // 数据在本地头的文件名与扩展字段之后（这两个长度以本地头为准）
      return (e.method === 8 ? inflate(body, e.usize) : Promise.resolve(body.slice())).then(function (data) {
        if (data.length !== e.usize || crc32(data) !== e.crc) throw new Error("CRC");
        out.push({ name: name, dir: false, data: data, mtime: mtime });
      }).catch(function () { skipped.push({ name: name, why: "数据损坏（校验不对）" }); });
    }).then(function () { return { entries: out, skipped: skipped }; });
  }

  // ======== 下载：沙盒 → 这台电脑 ========
  // 路径 → zip 条目：文件夹保留自己的名字和里面的结构；顶层重名的（不同位置的两个 README.md）加「 2」；读不了的跳过
  function collect(paths) {
    return human(function () {
      var out = { entries: [], files: 0, bytes: 0, skipped: [] }, used = {};
      paths.forEach(function (p) {
        if (!FS.exists(p)) return;
        var dir = FS.isDir(p), top = nextName(topName(p), dir, function (x) { return used[x.toLowerCase()]; });
        used[top.toLowerCase()] = 1; // 不分大小写：macOS 上 a.txt 与 A.txt 会撞
        (dir ? FS.walk(p) : [p]).forEach(function (q) {
          var name = q === p ? top : top + "/" + q.slice(p === "/" ? 1 : p.length + 1), st = FS.stat(q) || {}, data;
          if (FS.isDir(q)) { out.entries.push({ name: name + "/", mtime: st.mtime }); return; }
          try { data = bytesOf(q); } catch (e) { out.skipped.push({ name: name, why: e.message }); return; }
          out.entries.push({ name: name, data: data, mtime: st.mtime });
          out.files++;
          out.bytes += data.length;
        });
      });
      return out;
    });
  }
  // 打包：只有一个普通文件、又没要求总是打包 → 原样；否则 zip。名字：给了就用；只有一项叫「它.zip」；多项用「导出-时间.zip」
  // → Promise<{ blob, name, files, bytes, zip, skipped }>
  function pack(paths, opts) {
    opts = opts || {};
    return FS.ready().then(function () {
      // 真沙盒的镜像里，大文件、二进制的内容用到时才取：打包前先都取回来
      if (!FS.ensureLoaded) return;
      var lazy = [];
      list(paths).forEach(function (p) { if (typeof p === "string" && FS.exists(p)) (FS.isDir(p) ? FS.walk(p) : [p]).forEach(function (q) { var st = FS.stat(q); if (st && st.lazy) lazy.push(q); }); });
      return FS.ensureLoaded(lazy);
    }).then(function () {
      var todo = list(paths).filter(function (p, i, a) { return typeof p === "string" && a.indexOf(p) === i && FS.exists(p); });
      if (!todo.length) throw new Error("没有可以下载的文件");
      if (todo.length === 1 && !FS.isDir(todo[0]) && !opts.always) {
        var d = bytesOf(todo[0]);
        return { blob: new Blob([d], { type: "application/octet-stream" }), name: topName(todo[0]), files: 1, bytes: d.length, zip: false, skipped: [] };
      }
      var c = collect(todo);
      if (!c.files && !c.entries.length) throw new Error("没有可以下载的文件");
      return zip(c.entries, opts).then(function (blob) {
        var name = opts.name ? cleanZip(opts.name) : todo.length === 1 ? topName(todo[0]) + ".zip" : defZip();
        return { blob: blob, name: name, files: c.files, bytes: c.bytes, zip: true, skipped: c.skipped };
      });
    });
  }
  // 存到本机：Blob URL + <a download>，点完过一会儿再收回 URL（马上收回，有的浏览器会取消下载）
  function save(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  // ======== 上传：这台电脑 → 沙盒 ========
  // 拖放 / 选择的东西 → [FileSystemEntry 或 File]。DataTransfer 里的 entry 只在 drop 事件当下取得到，所以这一步必须同步
  function sources(src) {
    if (!src) return [];
    var arr = src.items && src.items.length ? src.items : src.files ? src.files : src.length != null ? src : [src];
    return Array.prototype.slice.call(arr).map(function (x) {
      if (x && typeof x.webkitGetAsEntry === "function") return x.kind === "file" ? x.webkitGetAsEntry() || x.getAsFile() : null;
      return x;
    }).filter(Boolean);
  }
  // → [{ rel（相对路径）, file } | { rel, dir: true } | { rel, error }]：文件夹一层层读（readEntries 一次最多给 100 个，要读到空为止）
  // 每一项记着它是第几样拖进来的（src）：两样同名的（不同文件夹里的 a.txt）要分开放，不能写到同一个路径上互相盖掉
  function gather(srcs) {
    var out = [], si = 0;
    function walk(en, rel, src) {
      if (en.isFile) return new Promise(function (res) { en.file(function (f) { out.push({ rel: rel, file: f, src: src }); res(); }, function () { out.push({ rel: rel, error: "读不了", src: src }); res(); }); });
      if (!en.isDirectory) return;
      out.push({ rel: rel, dir: true, src: src });
      var reader = en.createReader(), kids = [];
      return new Promise(function (res) {
        (function more() {
          reader.readEntries(function (batch) {
            if (batch.length) { kids = kids.concat(Array.prototype.slice.call(batch)); return more(); }
            res(each(kids, function (k) { return walk(k, rel + "/" + k.name, src); }));
          }, function () { out.push({ rel: rel, error: "文件夹读不了", src: src }); res(); });
        })();
      });
    }
    return each(srcs, function (x) {
      var src = si++;
      if (x.isFile || x.isDirectory) return walk(x, x.name, src);
      // 选文件夹时带相对路径：同一个文件夹里的文件是一样东西（src 记成文件夹名）
      if (typeof x.arrayBuffer === "function") { var rel = cleanPath(x.webkitRelativePath || x.name); out.push({ rel: rel, file: x, src: rel.indexOf("/") > 0 ? "d:" + rel.split("/")[0] : src }); }
    }).then(function () { return out.filter(function (it) { return it.rel && !junk(it.rel); }); });
  }
  // 是 UTF-8 文本（且没有 NUL）就给字符串，不然算二进制
  function asText(u8) {
    var s;
    try { s = utf8Keep.decode(u8); } catch (e) { return null; }
    return s.indexOf("\u0000") >= 0 ? null : s;
  }
  // 写进沙盒一个文件：文本存字符串；二进制有 writeBinary 就存字节，没有就跳过。→ 跳过的原因（""：写好了）
  function put(path, u8) {
    var text = asText(u8);
    return human(function () {
      if (text != null) { FS.write(path, text); return ""; }
      if (canBin()) { FS.writeBinary(path, u8); return ""; }
      return "二进制文件，沙盒暂不支持";
    });
  }
  // 上传。只拖了一样东西：直接放进 ~/上传；好几样：一起放进 ~/上传/上传-时间（同一分钟再来一次就「上传-时间 2」）；顶层重名的加「 2」。
  // hooks：plan(结果) 定好放哪以后、progress(已做, 总数, 名字)。→ Promise<{ dest, name, dir, files, bytes, skipped, zips（顶层的 zip，可解压）, parts }>
  function uploadCore(srcs, hooks) {
    hooks = hooks || {};
    var res = { dest: "", name: "", dir: false, files: 0, bytes: 0, skipped: [], zips: [], parts: [] };
    return FS.ready().then(function () { return gather(srcs); }).then(function (items) {
      // 顶层的每一样（按拖进来的那一样分，不按名字：两个同名的各算各的）
      var tops = [], nameOf = {}, keyOf = function (it) { return it.src + "\u0000" + it.rel.split("/")[0]; };
      items.forEach(function (it) { var k = keyOf(it); it.top = k; if (tops.indexOf(k) < 0) { tops.push(k); nameOf[k] = it.rel.split("/")[0]; } });
      if (!tops.length) throw new Error("没有可以上传的文件");
      var isDir = function (k) { return items.some(function (it) { return it.top === k && (it.rel === nameOf[k] ? !!it.dir : true); }); };
      var base = UP, map = {}, used = {};
      human(function () {
        FS.mkdirp(UP);
        if (tops.length > 1) { base = join(UP, freeName(UP, "上传-" + stamp(), true)); FS.mkdirp(base); }
      });
      tops.forEach(function (k) { map[k] = freeName(base, nameOf[k], isDir(k), used); });
      res.parts = tops.map(function (t) { return map[t]; });
      res.dir = tops.length > 1 || isDir(tops[0]);
      res.dest = tops.length > 1 ? base : join(base, map[tops[0]]);
      res.name = baseOf(res.dest);
      var files = items.filter(function (it) { return !it.dir; }), done = 0, total = 0;
      if (hooks.plan) hooks.plan(res);
      if (hooks.progress) hooks.progress(0, files.length, "");
      return each(items, function (it) {
        var segs = it.rel.split("/"), path = join(base, [map[it.top]].concat(segs.slice(1)).join("/"));
        var zipTop = segs.length === 1 && extOf(it.rel) === "zip" && !it.dir;
        var tick = function (why) {
          if (why) res.skipped.push({ name: it.rel, why: why });
          done++;
          if (hooks.progress) hooks.progress(done, files.length, it.rel);
        };
        if (it.dir) { try { human(function () { FS.mkdirp(path); }); } catch (e) { res.skipped.push({ name: it.rel, why: e.message }); } return; }
        if (it.error) return tick(it.error);
        if (it.file.size > MAX_FILE) return tick("超过 50 MB");
        if ((total += it.file.size) > MAX_TOTAL) return tick("这一次超过 200 MB");
        return it.file.arrayBuffer().then(function (buf) {
          var u8 = new Uint8Array(buf), why;
          try { why = put(path, u8); } catch (e) { why = e.message; }
          if (!why) { res.files++; res.bytes += u8.length; }
          // 顶层的 zip：存不进去（二进制）也照样可以解压，原因记在它自己身上，不算「跳过」
          if (zipTop) res.zips.push({ name: map[it.top], path: why ? "" : path, why: why || "", file: it.file });
          tick(zipTop ? "" : why);
        }, function () { tick("读不了"); });
      });
    }).then(function () {
      // 只有一个文件、又没写进去（比如二进制）：沙盒里什么都没有
      if (!res.dir && !res.files) res.dest = "";
      return res;
    });
  }
  // 解压到 ~/上传/<名字>/（hooks.dir 给了就解到那个文件夹里）。包里只有一个同名的顶层文件夹时去掉这一层（免得变成 上传/foo/foo/…）。
  // src：File / Blob / Uint8Array / ArrayBuffer / 沙盒里的路径（要有 readBinary）
  function extractCore(src, zipName, hooks) {
    hooks = hooks || {};
    var stem = stemOf(String(zipName || (typeof src === "string" ? baseOf(src) : src && src.name) || "压缩包"));
    return FS.ready().then(function () {
      if (typeof src === "string") return human(function () { return FS.readBinary ? FS.readBinary(src) : null; });
      if (src && typeof src.arrayBuffer === "function") return src.arrayBuffer();
      return src;
    }).then(function (bytes) {
      if (!bytes) throw new Error("拿不到 zip 的内容");
      return unzip(bytes);
    }).then(function (r) {
      var ents = r.entries, pre = stem + "/";
      if (ents.length && ents.every(function (e) { return e.name === stem ? e.dir : e.name.indexOf(pre) === 0; }))
        ents = ents.filter(function (e) { return e.name !== stem; }).map(function (e) { return { name: e.name.slice(pre.length), dir: e.dir, data: e.data }; });
      var res = { dest: "", name: "", dir: true, files: 0, bytes: 0, skipped: r.skipped.slice(), zips: [], parts: [] };
      var into = hooks.dir || UP; // 访达里双击 zip：解压到 zip 旁边（同 macOS 的「归档实用工具」）
      human(function () { FS.mkdirp(into); res.dest = join(into, freeName(into, stem, true)); FS.mkdirp(res.dest); });
      res.name = baseOf(res.dest);
      var total = ents.filter(function (e) { return !e.dir; }).length, done = 0;
      if (hooks.plan) hooks.plan(res);
      if (hooks.progress) hooks.progress(0, total, "");
      return each(ents, function (e) {
        var path = join(res.dest, e.name), why = "";
        try { if (e.dir) return human(function () { FS.mkdirp(path); }); why = put(path, e.data); } catch (err) { why = err.message; }
        if (why) res.skipped.push({ name: e.name, why: why }); else { res.files++; res.bytes += e.data.length; }
        done++;
        if (hooks.progress) hooks.progress(done, total, e.name);
      }).then(function () { return res; });
    });
  }

  // ---- 对外接口（没有桌面时也能用：只打包 / 上传，不开窗口）----
  var api = {
    add: function () { return 0; },
    download: function (paths, opts) { return pack(paths, opts).then(function (r) { if (typeof document !== "undefined") save(r.blob, r.name); return r; }); },
    upload: function (src, hooks) { return uploadCore(sources(src), hooks); },
    extract: function (src, name, hooks) { return extractCore(src, name, hooks); },
    pack: pack, zip: zip, unzip: unzip, crc32: crc32,
    canDeflate: CAN_DEFLATE, canInflate: CAN_INFLATE,
  };
  window.TSU_EXPORT = window.TSU_TRANSFER = api;

  var D = window.TSU_DESK;
  if (!D || typeof document === "undefined") return;

  // ======== 窗口 ========
  // 图标：文件夹、文稿（同访达的样子）、zip（中间一条拉链）
  var FOLDER = '<svg viewBox="0 0 64 52"><path d="M3 9.5A4.5 4.5 0 0 1 7.5 5h15.2c1.3 0 2.5.5 3.3 1.5L29 10h27.5A4.5 4.5 0 0 1 61 14.5V16H3z" fill="#4ea5ec"/>' +
    '<rect x="3" y="13" width="58" height="36" rx="4.5" fill="#6ec1fb"/><rect x="3" y="13" width="58" height="1.6" rx=".8" fill="#a6dcff"/></svg>';
  var PAGE = '<path d="M13 3h26l14 14v42a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="#fff" stroke="rgba(0,0,0,.18)"/><path d="M39 3v11a3 3 0 0 0 3 3h11" fill="#e9e9ee" stroke="rgba(0,0,0,.18)"/>';
  var TAG = function (t, col) { return '<text x="32" y="53" text-anchor="middle" font-family="-apple-system,Helvetica,sans-serif" font-weight="700" font-size="' + (t.length > 3 ? 8.5 : 10) + '" fill="' + col + '">' + esc(t) + "</text>"; };
  var ZIPPER = (function () { var s = ""; for (var i = 0; i < 7; i++) s += '<rect x="' + (i % 2 ? 32 : 28) + '" y="' + (4 + i * 3) + '" width="4" height="2.2" rx=".6"/>'; return s; })();
  var ZIP_SVG = '<svg viewBox="0 0 64 64">' + PAGE + '<g fill="#98989d">' + ZIPPER + '</g><rect x="27.5" y="26" width="9" height="11" rx="2.2" fill="none" stroke="#8e8e93" stroke-width="2"/>' + TAG("ZIP", "#8e8e93") + "</svg>";
  var EXT_COLOR = { md: "#6e6e73", js: "#c9a400", ts: "#2f74c0", py: "#3572a5", json: "#8a6d3b", html: "#e44d26", css: "#264de4", sh: "#2e8b57" };
  function iconFor(name, dir) {
    if (dir) return FOLDER;
    var ext = extOf(name);
    if (ext === "zip") return ZIP_SVG;
    return '<svg viewBox="0 0 64 64">' + PAGE + '<g stroke="#d6d6dc" stroke-width="1.6"><path d="M18 26h28M18 31h28M18 36h22"/></g>' + (ext ? TAG(ext.slice(0, 4).toUpperCase(), EXT_COLOR[ext] || "#8e8e93") : "") + "</svg>";
  }
  // 线条图标（跟文字颜色）：托盘 + 箭头，⬇︎ 下载到本机 / ⬆︎ 上传到沙盒
  var LINE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
  var ARROW = { down: "M32 8v29M21 26l11 11 11-11", up: "M32 37V8M21 19 32 8l11 11" };
  var BIG = function (k) { return '<svg viewBox="0 0 64 64" ' + LINE + ' stroke-width="3.2"><path d="M10 36v11a7 7 0 0 0 7 7h30a7 7 0 0 0 7-7V36"/><path d="' + ARROW[k] + '"/></svg>'; };
  var SMALL = { down: '<svg viewBox="0 0 16 16" ' + LINE + ' stroke-width="1.7"><path d="M8 2.5v8M4.6 7.2 8 10.6l3.4-3.4M3 13.6h10"/></svg>',
    up: '<svg viewBox="0 0 16 16" ' + LINE + ' stroke-width="1.7"><path d="M8 10.6v-8M4.6 5.9 8 2.5l3.4 3.4M3 13.6h10"/></svg>' };
  var XSVG = '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M2.6 2.6l4.8 4.8M7.4 2.6 2.6 7.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  // Dock / 启动台的图标：绿色方块上一个托盘，一上一下两个箭头
  var APP_SVG = '<svg viewBox="0 0 50 50" width="50" height="50" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="3.3" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M11 28.5v6a5 5 0 0 0 5 5h18a5 5 0 0 0 5-5v-6"/><path d="M19.5 10.5v15.5M14.8 21.3l4.7 4.7 4.7-4.7"/><path d="M30.5 26V10.5M25.8 15.2l4.7-4.7 4.7 4.7"/></g></svg>';

  var arr = function (v) { return Array.isArray(v) ? v : []; }; // 存的东西坏了就当空的
  var S = {
    tab: store.get("tsu-export-tab", "down") === "up" ? "up" : "down",
    shelf: arr(store.get("tsu-export-shelf", [])).filter(function (p) { return typeof p === "string" && p[0] === "/"; }), // 下载架上的沙盒路径
    always: store.get("tsu-export-always", false) === true, // 只有一个文件也打包
    zipName: "", named: false, // 用户改过 zip 名：不再换成新的默认名
    busy: false, // 正在打包
    recs: arr(store.get("tsu-export-recs", [])).filter(function (r) { return r && r.id; }), // 上传 / 解压记录（新的在前）
    msg: null, // 底栏临时提示 { pane, text, warn, until }
  };
  var zipSrc = {}; // 记录 id + zip 名 → 拖进来的 File（沙盒存不了二进制时，解压靠它；刷新就没了）
  S.recs.forEach(function (r) { if (r.state === "run") { r.state = "fail"; r.err = "没做完就刷新了"; } });
  var saveShelf = function () { store.set("tsu-export-shelf", S.shelf); };
  var saveRecs = function () {
    S.recs = S.recs.slice(0, 40);
    store.set("tsu-export-recs", S.recs.map(function (r) {
      return { id: r.id, t: r.t, kind: r.kind, name: r.name, dest: r.dest, dir: r.dir, files: r.files, bytes: r.bytes, state: r.state, err: r.err || "",
        skipped: (r.skipped || []).slice(0, 20), parts: (r.parts || []).slice(0, 30),
        zips: (r.zips || []).map(function (z) { return { name: z.name, path: z.path, why: z.why || "", out: z.out || "" }; }) };
    }));
  };

  // ---- 界面：标题栏里居中一个分段控件；下面两页——下载（架子 + 底栏）、上传（记录 + 底栏）；空的时候是一大块虚线拖放区 ----
  function zoneHTML(k) {
    return '<div class="ex-zone"><div class="ex-zone-in"><span class="ex-zone-ico">' + BIG(k) + "</span>" + (k === "down" ?
      "<b>把文件或文件夹从访达拖到这里</b><small>打包成 zip 下载到本机</small><em>也可以直接拖到 Dock 上的「传输」图标</em>" :
      '<b>把电脑上的文件或文件夹拖到这里</b><small>放进沙盒的 ~/上传，保留文件夹结构</small><em class="ex-up-note"></em>' +
      '<span class="ex-picks"><button class="ex-btn" data-a="pick">选择文件…</button><button class="ex-btn" data-a="pickdir">选择文件夹…</button></span>') + "</div></div>";
  }
  var root = document.createElement("div");
  root.className = "ex";
  root.tabIndex = -1;
  root.innerHTML =
    '<section class="ex-pane ex-down">' + zoneHTML("down") + '<div class="ex-list"></div>' +
      '<div class="ex-foot"><div class="ex-sum"></div><div class="ex-ctl">' +
      '<label class="ex-fname"><span>存储为</span><input spellcheck="false" autocomplete="off"></label>' +
      '<label class="ex-always" title="只有一个文件时也打包成 zip"><input type="checkbox">总是打包</label>' +
      '<button class="ex-btn" data-a="clear">清空</button><button class="ex-btn ex-primary" data-a="pack">打包下载</button></div></div></section>' +
    '<section class="ex-pane ex-up">' + zoneHTML("up") + '<div class="ex-list"></div>' +
      '<div class="ex-foot"><div class="ex-sum"></div><div class="ex-ctl"><span class="ex-flex"></span>' +
      '<button class="ex-btn" data-a="forget">清除记录</button><button class="ex-btn" data-a="pick">选择文件…</button>' +
      '<button class="ex-btn" data-a="open-up" title="在访达中打开 ~/上传">在访达中打开</button></div></div></section>' +
    '<div class="ex-veil" hidden><span></span></div>' +
    '<input type="file" class="ex-file" multiple hidden><input type="file" class="ex-dir" webkitdirectory multiple hidden>';
  var $ = function (s) { return root.querySelector(s); };
  var down = $(".ex-down"), up = $(".ex-up"), downList = down.querySelector(".ex-list"), upList = up.querySelector(".ex-list");
  var nameIn = $(".ex-fname input"), alwaysIn = $(".ex-always input"), packBtn = $('[data-a="pack"]'), clearBtn = $('[data-a="clear"]');
  var veil = $(".ex-veil"), fileIn = $(".ex-file"), dirIn = $(".ex-dir");

  var win = D.createWindow({ id: "export", name: "传输", width: 640, height: 500, content: root, title: function () { return "传输"; }, menus: menus });
  var tb = document.createElement("div");
  tb.className = "ex-tb";
  tb.innerHTML = '<div class="ex-seg" role="tablist"><button data-tab="down" role="tab">' + SMALL.down + "<span>下载到本机</span></button>" +
    '<button data-tab="up" role="tab">' + SMALL.up + "<span>上传到沙盒</span></button></div>";
  win.el.querySelector(".bar").appendChild(tb);

  // ---- 画 ----
  function render() { renderTabs(); renderDown(); renderUp(); if (D.front() === win) D.refreshMenus(); }
  function renderTabs() {
    root.dataset.tab = S.tab;
    tb.querySelectorAll("[data-tab]").forEach(function (b) { var on = b.dataset.tab === S.tab; b.classList.toggle("ex-on", on); b.setAttribute("aria-selected", on); });
  }
  function setTab(k) {
    if (S.tab === k) return;
    S.tab = k;
    store.set("tsu-export-tab", k);
    render();
  }
  // 底栏左边一行字：平时是汇总，toast 时临时换成提示
  function summary(pane, text) {
    var el = pane.querySelector(".ex-sum"), m = S.msg && S.msg.pane === pane && Date.now() < S.msg.until ? S.msg : null;
    el.textContent = m ? m.text : text;
    el.classList.toggle("ex-warn", !!(m && m.warn));
  }
  var toastT = 0;
  function toast(pane, text, warn) {
    S.msg = { pane: pane, text: text, warn: !!warn, until: Date.now() + 3500 };
    clearTimeout(toastT);
    toastT = setTimeout(render, 3600);
    render();
  }
  // 架子上一项的情况：还在不在、是不是文件夹、多大、里面几个文件
  function info(p) {
    return human(function () {
      if (!FS.exists(p)) return { ok: false };
      if (!FS.isDir(p)) return { ok: true, dir: false, files: 1, bytes: sizeOf(p) };
      var files = 0, bytes = 0;
      FS.walk(p).forEach(function (q) { if (!FS.isDir(q)) { files++; bytes += sizeOf(q); } });
      return { ok: true, dir: true, files: files, bytes: bytes };
    });
  }
  function row(icon, name, path, meta) {
    var el = document.createElement("div");
    el.className = "ex-it";
    el.innerHTML = '<span class="ex-ico">' + icon + '</span><span class="ex-txt"><b class="ex-nm"></b><small class="ex-path"></small></span><span class="ex-meta"></span>';
    el.querySelector(".ex-nm").textContent = name;
    el.querySelector(".ex-path").textContent = path;
    el.querySelector(".ex-meta").textContent = meta;
    return el;
  }
  var singleFile = function (ok) { return ok.length === 1 && !ok[0].i.dir && !S.always; };
  function renderDown() {
    var rows = S.shelf.map(function (p) { return { p: p, i: info(p) }; }), ok = rows.filter(function (r) { return r.i.ok; }), files = 0, bytes = 0;
    down.classList.toggle("ex-empty", !rows.length);
    downList.textContent = "";
    rows.forEach(function (r) {
      var el = row(iconFor(topName(r.p), r.i.dir), topName(r.p), r.p === HOME ? HOME : tilde(r.p), // 家目录本身写全（只写一个 ~ 像是坏了）
        !r.i.ok ? "已不存在" : r.i.dir ? (r.i.files ? r.i.files + " 个文件 · " + size(r.i.bytes) : "空文件夹") : size(r.i.bytes));
      el.dataset.path = r.p;
      el.classList.toggle("ex-gone", !r.i.ok);
      el.insertAdjacentHTML("beforeend", '<button class="ex-x" title="从列表移除">' + XSVG + "</button>");
      downList.appendChild(el);
      if (r.i.ok) { files += r.i.files; bytes += r.i.bytes; }
    });
    var single = singleFile(ok), gone = rows.length - ok.length;
    var want = single ? topName(ok[0].p) : S.named ? S.zipName : defZip();
    if (document.activeElement !== nameIn && nameIn.value !== want) nameIn.value = want;
    nameIn.disabled = single || !ok.length || S.busy;
    nameIn.title = single ? "只有一个文件：原样下载，不打包" : "";
    alwaysIn.checked = S.always;
    packBtn.textContent = S.busy ? "正在打包…" : single ? "下载" : "打包下载";
    packBtn.disabled = S.busy || !ok.length;
    clearBtn.disabled = S.busy || !rows.length;
    summary(down, !rows.length ? "还没有项目" : rows.length + " 项 · 共 " + files + " 个文件 · " + size(bytes) + (gone ? "（" + gone + " 项已不存在）" : "") + (single ? " · 原样下载" : ""));
  }
  var zipKey = function (r, z) { return r.id + "/" + z.name; };
  var zipReady = function (r, z) { return !!zipSrc[zipKey(r, z)] || !!(z.path && FS.readBinary && FS.exists(z.path)); };
  function note(txt, text, warn) {
    var n = document.createElement("small");
    n.className = "ex-note" + (warn ? " ex-warn" : "");
    n.textContent = text;
    txt.appendChild(n);
  }
  function button(label, act, title) {
    var b = document.createElement("button");
    b.className = "ex-btn ex-mini";
    b.dataset.a = act;
    b.textContent = label;
    if (title) b.title = title;
    return b;
  }
  var pct = function (r) { return r.total ? Math.round(r.done / r.total * 100) : 0; };
  // 上传 / 解压记录的一行：进行中是进度条；完了是放到哪、多大，跳过了什么，zip 可以解压，「在访达中显示」
  function recRow(r) {
    var live = !!r.dest && human(function () { return FS.exists(r.dest); }), run = r.state === "run";
    var lone = !r.dir && r.zips && r.zips.length === 1 && r.zips[0].name === r.name ? r.zips[0] : null; // 这条就是拖进来的那一个 zip
    var el = row(iconFor(r.name, r.dir), r.name, r.dest ? tilde(r.dest) : run ? "正在读取…" : r.state === "fail" ? "没有完成" :
      "没有放进沙盒" + (lone && lone.why ? "（" + lone.why + "）" : ""), "");
    var txt = el.querySelector(".ex-txt"), meta = el.querySelector(".ex-meta"), acts = document.createElement("span");
    el.classList.add("ex-rec");
    el.dataset.id = r.id;
    acts.className = "ex-acts";
    el.appendChild(acts);
    if (run) {
      el.classList.add("ex-run");
      meta.textContent = r.total ? r.done + " / " + r.total : "";
      txt.insertAdjacentHTML("beforeend", '<span class="ex-bar"><b style="width:' + pct(r) + '%"></b></span>');
      return el;
    }
    el.classList.toggle("ex-gone", !!r.dest && !live);
    meta.textContent = r.dest && !live ? "已不存在" : r.dir ? r.files + " 个文件 · " + size(r.bytes) : r.files ? size(r.bytes) : "";
    if (r.parts && r.parts.length > 1) note(txt, r.parts.join("、"));
    if (r.err) note(txt, r.err, true);
    if (r.skipped && r.skipped.length) note(txt, "跳过 " + r.skipped.length + " 个：" + r.skipped.slice(0, 3).map(function (s) { return s.name + "（" + s.why + "）"; }).join("、") + (r.skipped.length > 3 ? " 等" : ""), true);
    (r.zips || []).forEach(function (z) {
      var who = z === lone ? "" : z.name + "：";
      if (z.out) return note(txt, who + "已解压到 " + tilde(z.out));
      if (!zipReady(r, z)) return;
      var b = button(z.busy ? "正在解压…" : z === lone ? "解压" : "解压 " + z.name, "unzip", "解压到 ~/上传/" + stemOf(z.name) + "/");
      b.dataset.zip = z.name;
      b.disabled = !!z.busy;
      acts.appendChild(b);
      note(txt, who + (z.path || z === lone ? "" : "没放进沙盒，") + "可以解压到 ~/上传/" + stemOf(z.name) + "/");
    });
    if (live && window.TSU_FINDER) acts.appendChild(button("在访达中显示", "reveal"));
    return el;
  }
  function renderUp() {
    var run = S.recs.filter(function (r) { return r.state === "run"; })[0];
    up.classList.toggle("ex-empty", !S.recs.length);
    up.querySelector(".ex-up-note").textContent = canBin() ? "图片等二进制文件原样保存；zip 压缩包可以解压" : "图片等二进制文件暂时放不进沙盒，会跳过；zip 压缩包可以解压";
    upList.textContent = "";
    S.recs.forEach(function (r) { upList.appendChild(recRow(r)); });
    $('[data-a="forget"]').disabled = !S.recs.length || !!run;
    $('[data-a="open-up"]').hidden = !window.TSU_FINDER;
    summary(up, run ? runText(run) : "文件放在 ~/上传");
  }
  var runText = function (r) { return (r.kind === "unzip" ? "正在解压" : "正在上传") + (r.total ? " " + r.done + " / " + r.total : "…") + (r.cur ? " · " + r.cur : ""); };
  // 进度只改那一行（不重画整页）
  function paint(r) {
    var el = upList.querySelector('[data-id="' + r.id + '"]');
    if (!el) return;
    var bar = el.querySelector(".ex-bar b");
    if (bar) bar.style.width = pct(r) + "%";
    el.querySelector(".ex-meta").textContent = r.total ? r.done + " / " + r.total : "";
    el.querySelector(".ex-path").textContent = r.dest ? tilde(r.dest) : "正在读取…";
    el.querySelector(".ex-nm").textContent = r.name;
    summary(up, runText(r));
  }

  // ---- Dock：拖到图标上直接办；图标底部一条进度 ----
  var dockA = D.addDockApp({ app: "export", title: "传输", className: "ico-export", icon: APP_SVG + '<b class="ex-dprog"><b></b></b>' });
  var dockIco = dockA.querySelector(".ico"), dockJobs = 0;
  function dockBusy(on, frac) {
    dockJobs += on === true ? 1 : on === false ? -1 : 0;
    dockIco.classList.toggle("ex-busy", dockJobs > 0);
    if (frac != null) dockIco.querySelector(".ex-dprog b").style.width = Math.round(frac * 100) + "%";
  }
  function bounce() { dockA.classList.remove("bounce"); void dockA.offsetWidth; dockA.classList.add("bounce"); }
  if (D.registerApp) D.registerApp({ id: "export", name: "传输", icon: '<span class="ico sq ico-export">' + APP_SVG + "</span>", open: function () { openWin(); } });

  function notify(title, body, onClick) { if (D.notify) D.notify({ app: "export", title: title, body: body, onClick: onClick }); }
  function reveal(p) { if (p && window.TSU_FINDER) window.TSU_FINDER.open(p); }
  function openWin(tab) {
    if (tab) setTab(tab);
    if (win.state === "min" || win.state === "closed") win.show(); else win.front();
  }

  // ---- 下载 ----
  function add(paths) {
    var fresh = list(paths).map(function (p) { return FS.norm ? FS.norm(String(p)) : String(p); })
      .filter(function (p, i, a) { return p[0] === "/" && a.indexOf(p) === i && S.shelf.indexOf(p) < 0; });
    var dup = list(paths).length - fresh.length;
    S.shelf = S.shelf.concat(fresh);
    saveShelf();
    openWin("down");
    if (fresh.length) toast(down, "加入了 " + fresh.length + " 项" + (dup > 0 ? "（" + dup + " 项已经在列表里）" : ""));
    else if (dup > 0) toast(down, "已经在列表里了", true);
    else render();
    return fresh.length;
  }
  function remove(p) { S.shelf = S.shelf.filter(function (x) { return x !== p; }); saveShelf(); render(); }
  function clearShelf() { S.shelf = []; S.named = false; saveShelf(); render(); }
  function doneText(r) { return r.zip ? r.files + " 个文件 · " + size(r.bytes) + "，zip " + size(r.blob.size) : size(r.bytes); }
  // 下载（窗口里的「打包下载」、Dock 图标、访达的菜单项都走这里）
  function download(paths, opts) {
    opts = opts || {};
    return pack(paths, { always: S.always, name: opts.name }).then(function (r) {
      save(r.blob, r.name);
      notify("已下载「" + r.name + "」", doneText(r) + (r.skipped.length ? "；跳过 " + r.skipped.length + " 个读不了的文件" : ""));
      return r;
    });
  }
  function packShelf() {
    var ok = S.shelf.filter(function (p) { return FS.exists(p); });
    if (S.busy || !ok.length) return;
    S.busy = true;
    render();
    download(ok, { name: singleFile(ok.map(function (p) { return { i: info(p) }; })) ? "" : S.named ? S.zipName : defZip() }).then(function (r) {
      S.busy = false;
      toast(down, "已下载「" + r.name + "」· " + doneText(r));
    }, function (e) {
      S.busy = false;
      toast(down, e.message, true);
    });
  }
  function quickDownload(paths) {
    bounce();
    return download(paths).then(null, function (e) { notify("没能下载", e.message); });
  }

  // ---- 上传 / 解压：每次一条记录，进行中实时更新，完了发通知 ----
  var seq = 0;
  function track(kind, run, title, after) {
    var r = { id: "r" + Date.now().toString(36) + seq++, t: Date.now(), kind: kind, name: title, dest: "", dir: kind === "unzip", files: 0, bytes: 0,
      done: 0, total: 0, state: "run", skipped: [], parts: [], zips: [] };
    S.recs.unshift(r);
    saveRecs();
    render();
    dockBusy(true, 0);
    var hooks = {
      plan: function (res) { r.name = res.name; r.dest = res.dest; r.dir = res.dir; paint(r); },
      progress: function (done, total, cur) { r.done = done; r.total = total; r.cur = cur; paint(r); dockBusy(null, total ? done / total : 0); },
    };
    // 先收起 Dock 上的进度条再发通知（通知的图标是照着 Dock 图标拷的）
    return run(hooks).then(function (res) {
      Object.assign(r, { name: res.name || r.name, dest: res.dest, dir: res.dir, files: res.files, bytes: res.bytes, skipped: res.skipped, parts: res.parts, state: "done" });
      r.zips = res.zips.map(function (z) { if (z.file) zipSrc[r.id + "/" + z.name] = z.file; return { name: z.name, path: z.path, why: z.why }; });
      fin();
      after(r, res);
      return res;
    }, function (e) {
      r.state = "fail";
      r.err = e.message;
      fin();
      notify(kind === "unzip" ? "没能解压" : "没能上传", e.message);
      throw e;
    });
    function fin() { r.cur = ""; dockBusy(false); saveRecs(); render(); }
  }
  var skipText = function (res) { return res.skipped.length ? "，跳过 " + res.skipped.length + " 个" : ""; };
  function upload(src) {
    var srcs = sources(src); // 同步：drop 事件一过，DataTransfer 就读不到了
    return track("up", function (hooks) { return uploadCore(srcs, hooks); }, "正在上传", function (r, res) {
      var what = res.parts.length > 1 ? res.parts.length + " 项" : res.name || res.parts[0];
      if (!res.files && !res.zips.length) return notify("没有上传任何文件", what + skipText(res).replace(/^，/, "："), function () { openWin("up"); });
      if (res.zips.length && !res.files) return notify("收到「" + res.zips[0].name + "」", "在「传输」里可以解压到 ~/上传/" + stemOf(res.zips[0].name) + "/", function () { openWin("up"); }); // 传输窗口关着时点通知也要把它打开
      notify("已上传到沙盒", what + " → " + tilde(res.dest) + skipText(res) + (res.zips.length ? "；zip 可以在「传输」里解压" : ""),
        res.zips.length ? function () { openWin("up"); } : function () { reveal(res.dest); });
    }).then(null, function () { return null; });
  }
  function extract(src, name) {
    name = String(name || (typeof src === "string" ? baseOf(src) : src && src.name) || "压缩包.zip");
    return track("unzip", function (hooks) { return extractCore(src, name, hooks); }, stemOf(name), function (r, res) {
      notify("已解压「" + name + "」", res.files + " 个文件 → " + tilde(res.dest) + skipText(res), function () { reveal(res.dest); });
    });
  }
  function unzipRec(r, z) {
    if (z.busy) return;
    z.busy = true;
    extract(zipSrc[zipKey(r, z)] || z.path, z.name).then(function (res) { z.out = res.dest; }, function () {}).then(function () { z.busy = false; saveRecs(); render(); });
    render();
  }
  function forget() { S.recs = S.recs.filter(function (r) { return r.state === "run"; }); zipSrc = {}; saveRecs(); render(); }

  // ---- 拖放：拖的是什么就切到哪一页（访达里的 → 下载，电脑里的 → 上传）----
  function kindOf(dt) {
    var t = Array.prototype.slice.call((dt && dt.types) || []);
    return t.indexOf(MIME) >= 0 ? "down" : t.indexOf("Files") >= 0 ? "up" : "";
  }
  // 放下时的效果得在 effectAllowed 允许的范围里，不然浏览器不让放（访达拖出来的是 move）
  function effect(dt) {
    var a = dt.effectAllowed || "all";
    return a === "all" || a === "uninitialized" || /copy/i.test(a) ? "copy" : /move/i.test(a) ? "move" : /link/i.test(a) ? "link" : "copy";
  }
  function pathsOf(dt) {
    var ps = null;
    try { ps = JSON.parse(dt.getData(MIME)); } catch (e) { /* 退回 text/plain：一行一个路径 */ }
    if (!Array.isArray(ps)) ps = (dt.getData("text/plain") || "").split("\n");
    return ps.filter(function (p) { return typeof p === "string" && p[0] === "/"; });
  }
  // 真的离开了吗：Safari 的 dragleave 有时没有 relatedTarget，就看指针还在不在里面
  function left(e, el) {
    if (e.relatedTarget) return !el.contains(e.relatedTarget);
    var r = el.getBoundingClientRect();
    return e.clientX <= r.left || e.clientX >= r.right || e.clientY <= r.top || e.clientY >= r.bottom;
  }
  function setDrop(k) {
    root.classList.toggle("ex-drop", !!k);
    veil.hidden = !k || (S.tab === "down" ? down : up).classList.contains("ex-empty");
    if (k) {
      veil.firstChild.textContent = k === "down" ? "松手加入下载列表" : "松手上传到 ~/上传";
      window.addEventListener("mousemove", clearDrop, { once: true }); // 拖到一半按 Esc：之后鼠标一动就收起
    }
  }
  var clearDrop = function () { setDrop(""); };
  function over(e) {
    var k = kindOf(e.dataTransfer);
    if (!k) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = effect(e.dataTransfer);
    if (S.tab !== k) setTab(k);
    setDrop(k);
  }
  win.el.addEventListener("dragenter", over);
  win.el.addEventListener("dragover", over);
  win.el.addEventListener("dragleave", function (e) { if (left(e, win.el)) setDrop(""); });
  win.el.addEventListener("drop", function (e) {
    var k = kindOf(e.dataTransfer);
    setDrop("");
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    if (k === "down") { var ps = pathsOf(e.dataTransfer); if (ps.length) add(ps); else toast(down, "没有拿到路径", true); }
    else upload(e.dataTransfer);
  });
  document.addEventListener("dragend", clearDrop);
  // Dock 图标：拖上去就办，不用开窗口
  function dockOver(e) {
    var k = kindOf(e.dataTransfer);
    if (!k) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = effect(e.dataTransfer);
    dockA.classList.add("ex-dock-on");
    dockA.dataset.exHint = k === "down" ? "打包下载" : "上传到沙盒";
  }
  var dockOff = function () { dockA.classList.remove("ex-dock-on"); };
  dockA.addEventListener("dragenter", dockOver);
  dockA.addEventListener("dragover", dockOver);
  dockA.addEventListener("dragleave", function (e) { if (left(e, dockA)) dockOff(); });
  dockA.addEventListener("drop", function (e) {
    var k = kindOf(e.dataTransfer);
    dockOff();
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    if (k === "down") { var ps = pathsOf(e.dataTransfer); if (ps.length) quickDownload(ps); }
    else { bounce(); upload(e.dataTransfer); }
  });
  document.addEventListener("dragend", dockOff);

  // ---- 点击 ----
  function pickFiles() { fileIn.click(); }
  function pickFolder() { dirIn.click(); }
  root.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b || b.disabled) return;
    var it = b.closest(".ex-it"), r = it && S.recs.find(function (x) { return x.id === it.dataset.id; });
    if (b.classList.contains("ex-x") && it) return remove(it.dataset.path);
    ({
      pack: packShelf, clear: clearShelf, pick: pickFiles, pickdir: pickFolder, forget: forget,
      "open-up": function () { human(function () { FS.mkdirp(UP); }); reveal(UP); },
      reveal: function () { if (r) reveal(r.dest); },
      unzip: function () { var z = r && (r.zips || []).find(function (x) { return x.name === b.dataset.zip; }); if (z) unzipRec(r, z); },
    }[b.dataset.a] || function () {})();
  });
  tb.addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); });
  [fileIn, dirIn].forEach(function (inp) {
    inp.addEventListener("change", function () {
      if (inp.files && inp.files.length) { setTab("up"); upload(Array.prototype.slice.call(inp.files)); }
      inp.value = "";
    });
  });
  nameIn.addEventListener("input", function () { S.zipName = nameIn.value; S.named = !!nameIn.value.trim(); });
  nameIn.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); packShelf(); } });
  nameIn.addEventListener("blur", function () { if (!S.named) nameIn.value = defZip(); });
  alwaysIn.addEventListener("change", function () { S.always = alwaysIn.checked; store.set("tsu-export-always", S.always); render(); });
  // 点窗口里的空白：键盘焦点给窗口（快捷键才收得到），不抢输入框
  root.addEventListener("pointerdown", function (e) { if (!e.target.closest("input, button, label")) setTimeout(function () { root.focus({ preventScroll: true }); }, 0); });
  win.el.addEventListener("keydown", function (e) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    var k = e.key.toLowerCase(), hit = k === "1" ? function () { setTab("down"); } : k === "2" ? function () { setTab("up"); } :
      k === "s" ? packShelf : k === "o" ? (e.shiftKey ? pickFolder : pickFiles) : null;
    if (hit) { e.preventDefault(); e.stopPropagation(); hit(); }
  });

  // ---- 菜单栏 ----
  function menus() {
    var it = function (l, k, run, o) { return Object.assign({ label: l, keys: k || "", run: run }, o || {}); };
    var ok = S.shelf.filter(function (p) { return FS.exists(p); });
    return [
      { title: "文件", items: [
        it(ok.length === 1 && !FS.isDir(ok[0]) && !S.always ? "下载" : "打包下载", "⌘S", packShelf, { disabled: !ok.length || S.busy }),
        it("总是打包", "", function () { S.always = !S.always; store.set("tsu-export-always", S.always); render(); }, { checked: S.always }),
        it("清空下载列表", "", clearShelf, { disabled: !S.shelf.length }),
        { sep: true },
        it("选择要上传的文件…", "⌘O", function () { openWin("up"); pickFiles(); }),
        it("选择要上传的文件夹…", "⇧⌘O", function () { openWin("up"); pickFolder(); }),
        it("在访达中打开「上传」", "", function () { human(function () { FS.mkdirp(UP); }); reveal(UP); }, { disabled: !window.TSU_FINDER }),
        it("清除上传记录", "", forget, { disabled: !S.recs.length }),
      ] },
      { title: "显示", items: [
        it("下载到本机", "⌘1", function () { setTab("down"); }, { checked: S.tab === "down" }),
        it("上传到沙盒", "⌘2", function () { setTab("up"); }, { checked: S.tab === "up" }),
      ] },
    ];
  }

  // ---- 打开时画一遍；文件系统变了（开着时）跟着刷新 ----
  var show0 = win.show;
  win.show = function () { show0.apply(win, arguments); render(); };
  var pending = 0;
  FS.onChange(function () {
    if (pending) return;
    pending = setTimeout(function () { pending = 0; if (win.state !== "closed") render(); }, 150);
  });
  FS.ready().then(render);

  api.add = add;
  api.download = download;
  api.upload = upload;
  api.extract = extract;
  api.open = openWin;
  api.win = win;
})();
