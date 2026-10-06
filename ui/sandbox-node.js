// sandbox-node.js —— 沙盒里 `node` 命令的 Worker：尽量像 Node 那样跑。
// 退出：同 Node——主模块跑完、并且没有挂着的事（定时器、网络请求、读响应体……）才结束；所以 await / Promise / setTimeout / fetch 都照常。
// 输出与文件：边跑边发回主线程（约 30ms 一批）；文件是主线程发来的一份快照（只含这个身份能读的），读写都在这份副本上同步完成，
// 每次改动同时发回去、按这个身份落盘（权限在这里先按 can() 的规则查一遍，主线程落盘时再查一次）。
// 协议：主线程 → { files, meta, writable, cwd, home, user, env, script, code, args, stdin, mode: "" | "e" | "p" }
//       Worker → { t: "io", out, err, ops: [["write", p, 字符串] | ["mkdir", p] | ["rm", p] | ["mv", a, b] | ["cp", a, b]] } …… 最后 { t: "done", code }
"use strict";
var nativeSetTimeout = self.setTimeout.bind(self), nativeClearTimeout = self.clearTimeout.bind(self);
var nativeSetInterval = self.setInterval.bind(self), nativeClearInterval = self.clearInterval.bind(self);
var post = self.postMessage.bind(self);
self.onmessage = function (e) { self.onmessage = null; boot(e.data); };

function boot(d) {
  var EXIT = { exit: true }; // process.exit() 抛出它，一路退到最外层
  var finished = false, finishing = false;
  var cwd = d.cwd, HOME = d.home || "/home/user";

  // ======== 输出与文件改动：攒一小会儿一起发 ========
  var buf = { out: "", err: "", ops: [] }, flushing = false;
  function schedule() { if (!flushing) { flushing = true; nativeSetTimeout(flush, 30); } }
  function flush() {
    flushing = false;
    if (!buf.out && !buf.err && !buf.ops.length) return;
    post({ t: "io", out: buf.out, err: buf.err, ops: buf.ops });
    buf = { out: "", err: "", ops: [] };
  }
  function emit(fd, s) { if (finished) return; buf[fd === 2 ? "err" : "out"] += s; schedule(); }
  function op(o) {
    // 连着写同一个文件只留最后一次（循环里 appendFileSync 一万次也只发一回）
    var last = buf.ops[buf.ops.length - 1];
    if (o[0] === "write" && last && last[0] === "write" && last[1] === o[1]) last[2] = o[2]; else buf.ops.push(o);
    schedule();
  }

  // ======== 退出：同 Node，没有挂着的事就结束 ========
  var handles = 0, checking = false, idle = 0;
  function hold() { handles++; }
  function release() { handles--; later(); }
  function later() { if (!checking && !finished) { checking = true; nativeSetTimeout(check, 0); } }
  function check() {
    checking = false;
    if (finished) return;
    if (handles > 0) { idle = 0; return; }
    // 再等两拍：浏览器内部的一些异步（不经过我们计数的）有机会接上
    if (++idle < 3) { checking = true; nativeSetTimeout(check, 5); return; }
    finish(process.exitCode | 0);
  }
  function finish(code) {
    if (finished || finishing) return;
    finishing = true;
    process.exitCode = code;
    try { process.emit("exit", code); } catch (x) { if (x !== EXIT) report(x); }
    finished = true;
    flush();
    post({ t: "done", code: process.exitCode | 0 });
  }
  function errText(x) {
    if (x && typeof x === "object" && ("stack" in x || x instanceof Error)) {
      var st = String(x.stack || ""), head = String(x);
      if (!st) return head;
      if (st.indexOf(head) === 0) return st;
      // Safari 的 stack 不带消息，一行一个「函数@位置」
      return head + "\n" + st.split("\n").filter(Boolean).map(function (l) { return "    at " + l; }).join("\n");
    }
    return "Uncaught " + inspect(x);
  }
  function report(x) { emit(2, errText(x) + "\n"); }
  // 回调外面包一层：未捕获的异常 → 有 uncaughtException 的监听就交给它，否则打印、退出码 1（同 Node）
  function crash(x) {
    if (x === EXIT || finished) return;
    if (process.listenerCount("uncaughtException")) { try { process.emit("uncaughtException", x); } catch (y) { report(y); finish(1); } return; }
    report(x);
    finish(1);
  }
  function guard(fn) { return function () { if (finished) return; try { return fn.apply(this, arguments); } catch (x) { crash(x); } }; }
  self.addEventListener("unhandledrejection", function (e) {
    e.preventDefault();
    var x = e.reason;
    if (x === EXIT || finished) return;
    if (process.listenerCount("unhandledRejection")) { process.emit("unhandledRejection", x, e.promise); return; }
    crash(x);
  });
  self.addEventListener("error", function (e) { e.preventDefault(); crash(e.error || new Error(e.message)); });

  // ======== 定时器（能 ref / unref，同 Node 的 Timeout）========
  var timers = {};
  function Timeout(repeat) { this._repeat = repeat; this._ref = true; this._live = true; }
  Timeout.prototype.ref = function () { if (!this._ref && this._live) { this._ref = true; hold(); } return this; };
  Timeout.prototype.unref = function () { if (this._ref && this._live) { this._ref = false; release(); } return this; };
  Timeout.prototype.hasRef = function () { return this._ref; };
  Timeout.prototype.refresh = function () { return this; };
  Timeout.prototype.close = function () { clearT(this); return this; };
  Timeout.prototype[Symbol.toPrimitive] = function () { return this._id; };
  function setT(fn, ms, args, repeat) {
    if (typeof fn !== "function") throw new TypeError('The "callback" argument must be of type function. Received ' + typeof fn);
    var t = new Timeout(repeat);
    hold();
    var run = guard(function () {
      if (!t._live) return;
      if (!repeat) { t._live = false; delete timers[t._id]; if (t._ref) handles--; }
      fn.apply(null, args);
      if (!repeat) later();
    });
    t._id = repeat ? nativeSetInterval(run, Math.max(1, ms | 0)) : nativeSetTimeout(run, Math.max(0, ms | 0));
    timers[t._id] = t;
    return t;
  }
  function clearT(t) {
    if (t == null) return;
    var id = typeof t === "object" ? t._id : t, tt = timers[id];
    if (!tt || !tt._live) return;
    tt._live = false;
    delete timers[id];
    (tt._repeat ? nativeClearInterval : nativeClearTimeout)(id);
    if (tt._ref) release();
  }
  self.setTimeout = function (fn, ms) { return setT(fn, ms, [].slice.call(arguments, 2), false); };
  self.setInterval = function (fn, ms) { return setT(fn, ms, [].slice.call(arguments, 2), true); };
  self.setImmediate = function (fn) { return setT(fn, 0, [].slice.call(arguments, 1), false); };
  self.clearTimeout = self.clearInterval = self.clearImmediate = clearT;

  // ---- 网络等浏览器的异步：挂着的时候不退出 ----
  function track(p) { hold(); var done = function () { release(); }; p.then(done, done); return p; }
  var wrapAsync = function (proto, names) { if (!proto) return; names.forEach(function (m) { var f = proto[m]; if (typeof f === "function") proto[m] = function () { return track(f.apply(this, arguments)); }; }); };
  if (self.fetch) { var nf = self.fetch.bind(self); self.fetch = function (u, init) { return track(nf(u, init)); }; }
  if (self.Response) wrapAsync(Response.prototype, ["text", "json", "arrayBuffer", "blob", "formData", "bytes"]);
  if (self.Request) wrapAsync(Request.prototype, ["text", "json", "arrayBuffer", "blob", "formData"]);
  if (self.Blob) wrapAsync(Blob.prototype, ["text", "arrayBuffer", "bytes"]);
  if (self.ReadableStreamDefaultReader) wrapAsync(ReadableStreamDefaultReader.prototype, ["read"]);
  if (self.crypto && self.crypto.subtle) wrapAsync(Object.getPrototypeOf(self.crypto.subtle), ["digest", "encrypt", "decrypt", "sign", "verify", "importKey", "exportKey", "generateKey", "deriveKey", "deriveBits"]);
  if (self.XMLHttpRequest) {
    var xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u, async) { this._async = async !== false; return xo.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      if (this._async) { var x = this, done = false; hold(); x.addEventListener("loadend", function () { if (!done) { done = true; release(); } }); }
      return xs.apply(this, arguments);
    };
  }

  // ======== util.inspect / format（接近 Node 的样子）========
  function inspect(v, opts) {
    var depth = opts && opts.depth !== undefined ? (opts.depth === null ? Infinity : opts.depth) : 2, seen = [];
    var q = function (s) { return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") + "'"; };
    var key = function (k) { return typeof k === "symbol" ? "[" + k.toString() + "]" : /^[A-Za-z_$][\w$]*$/.test(k) ? k : q(k); };
    function fmt(x, lvl) {
      var t = typeof x;
      if (t === "string") return lvl ? q(x) : x;
      if (t === "number") return Object.is(x, -0) ? "-0" : String(x);
      if (t === "bigint") return x + "n";
      if (t === "undefined" || t === "boolean" || x === null) return String(x);
      if (t === "symbol") return x.toString();
      if (t === "function") { var src = ""; try { src = Function.prototype.toString.call(x); } catch (e) { /* 原生 */ } return /^class\s/.test(src) ? "[class " + (x.name || "(anonymous)") + "]" : "[Function: " + (x.name || "(anonymous)") + "]"; }
      if (x instanceof Error) return lvl ? "[" + String(x) + "]" : errText(x);
      if (x instanceof Date) return isNaN(x) ? "Invalid Date" : x.toISOString();
      if (x instanceof RegExp) return String(x);
      if (typeof Promise !== "undefined" && x instanceof Promise) return "Promise { <pending> }";
      if (x instanceof Buffer) { var hx = Array.prototype.slice.call(x, 0, 50).map(function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(" "); return "<Buffer" + (hx ? " " + hx : "") + (x.length > 50 ? " ... " + (x.length - 50) + " more bytes" : "") + ">"; }
      if (seen.indexOf(x) >= 0) return "[Circular *1]";
      if (lvl > depth) return Array.isArray(x) ? "[Array]" : "[Object]";
      seen.push(x);
      var parts, open = "{", close = "}", pre = "";
      try {
        if (Array.isArray(x)) {
          open = "["; close = "]";
          parts = [];
          for (var i = 0; i < Math.min(x.length, 100); i++) parts.push(i in x ? fmt(x[i], lvl + 1) : "<1 empty item>");
          if (x.length > 100) parts.push("... " + (x.length - 100) + " more items");
        } else if (x instanceof Map) { pre = "Map(" + x.size + ") "; parts = []; x.forEach(function (v2, k2) { parts.push(fmt(k2, lvl + 1) + " => " + fmt(v2, lvl + 1)); }); }
        else if (x instanceof Set) { pre = "Set(" + x.size + ") "; parts = []; x.forEach(function (v2) { parts.push(fmt(v2, lvl + 1)); }); }
        else if (ArrayBuffer.isView(x)) { pre = x.constructor.name + "(" + x.length + ") "; open = "["; close = "]"; parts = Array.prototype.slice.call(x, 0, 100).map(function (n) { return fmt(n, lvl + 1); }); }
        else {
          var proto = Object.getPrototypeOf(x);
          pre = proto === null ? "[Object: null prototype] " : proto && proto.constructor && proto.constructor.name && proto.constructor.name !== "Object" ? proto.constructor.name + " " : "";
          parts = Object.keys(x).map(function (k) {
            var dsc = Object.getOwnPropertyDescriptor(x, k);
            return key(k) + ": " + (dsc && dsc.get ? (dsc.set ? "[Getter/Setter]" : "[Getter]") : fmt(x[k], lvl + 1));
          });
        }
      } finally { seen.pop(); }
      if (!parts.length) return pre + open + close;
      var one = pre + open + " " + parts.join(", ") + " " + close;
      if (one.length + lvl * 2 <= 76 && one.indexOf("\n") < 0) return one;
      var ind = "  ".repeat(lvl + 1);
      return pre + open + "\n" + parts.map(function (p) { return ind + p; }).join(",\n") + "\n" + "  ".repeat(lvl) + close;
    }
    return fmt(v, 0);
  }
  function format(f) {
    var args = [].slice.call(arguments, 1);
    if (typeof f !== "string") return [].map.call(arguments, function (x) { return typeof x === "string" ? x : inspect(x); }).join(" ");
    var i = 0;
    var s = f.replace(/%[sdifjoOc%]/g, function (m) {
      if (m === "%%") return "%";
      if (i >= args.length) return m;
      var a = args[i++];
      switch (m) {
        case "%s": return typeof a === "string" ? a : typeof a === "bigint" ? a + "n" : a !== null && typeof a === "object" ? inspect(a, { depth: 1 }) : String(a);
        case "%d": return typeof a === "bigint" ? a + "n" : typeof a === "object" && a !== null ? "NaN" : String(Number(a));
        case "%i": return String(parseInt(a, 10));
        case "%f": return String(parseFloat(a));
        case "%j": try { return JSON.stringify(a); } catch (e) { return "[Circular]"; }
        case "%o": return inspect(a, { depth: 4 });
        case "%O": return inspect(a);
        case "%c": return "";
      }
      return m;
    });
    return [s].concat(args.slice(i).map(function (x) { return typeof x === "string" ? x : inspect(x); })).join(" ");
  }

  // ======== console ========
  var indent = "", counts = {}, clocks = {};
  function line(fd, args) { var s = format.apply(null, args); if (indent) s = s.replace(/^/gm, indent); emit(fd, s + "\n"); }
  var konsole = {
    log: function () { line(1, arguments); }, info: function () { line(1, arguments); }, debug: function () { line(1, arguments); },
    error: function () { line(2, arguments); }, warn: function () { line(2, arguments); },
    trace: function () { var e = new Error(format.apply(null, arguments)); emit(2, "Trace: " + errText(e).replace(/^Error: /, "") + "\n"); },
    dir: function (o, opt) { emit(1, indent + inspect(o, opt) + "\n"); },
    assert: function (c) { if (!c) line(2, ["Assertion failed" + (arguments.length > 1 ? ": " + format.apply(null, [].slice.call(arguments, 1)) : "")]); },
    time: function (l) { clocks[l || "default"] = performance.now(); },
    timeLog: function (l) { l = l || "default"; if (clocks[l] !== undefined) emit(1, indent + l + ": " + (performance.now() - clocks[l]).toFixed(3) + "ms\n"); },
    timeEnd: function (l) { l = l || "default"; if (clocks[l] !== undefined) { emit(1, indent + l + ": " + (performance.now() - clocks[l]).toFixed(3) + "ms\n"); delete clocks[l]; } },
    count: function (l) { l = l || "default"; counts[l] = (counts[l] || 0) + 1; emit(1, indent + l + ": " + counts[l] + "\n"); },
    countReset: function (l) { counts[l || "default"] = 0; },
    group: function () { if (arguments.length) line(1, arguments); indent += "  "; },
    groupCollapsed: function () { if (arguments.length) line(1, arguments); indent += "  "; },
    groupEnd: function () { indent = indent.slice(2); },
    table: function (data) {
      if (!data || typeof data !== "object") return line(1, [data]);
      var rows = Object.keys(data), cols = [], cell = function (v) { return typeof v === "string" ? "'" + v + "'" : inspect(v, { depth: 0 }); };
      rows.forEach(function (r) { var v = data[r]; if (v && typeof v === "object") Object.keys(v).forEach(function (c) { if (cols.indexOf(c) < 0) cols.push(c); }); });
      var hasVal = rows.some(function (r) { return !data[r] || typeof data[r] !== "object"; });
      var head = ["(index)"].concat(cols, hasVal ? ["Values"] : []);
      var body = rows.map(function (r) { var v = data[r], o = [r]; cols.forEach(function (c) { o.push(v && typeof v === "object" && c in v ? cell(v[c]) : ""); }); if (hasVal) o.push(v && typeof v === "object" ? "" : cell(v)); return o; });
      var w = head.map(function (h, i) { return Math.max(h.length, Math.max.apply(null, body.map(function (b) { return String(b[i]).length; }).concat([0]))) + 2; });
      var cen = function (s, n) { s = String(s); var l = Math.floor((n - s.length) / 2); return " ".repeat(l) + s + " ".repeat(n - s.length - l); };
      var sep = function (a, b, c) { return a + w.map(function (n) { return "─".repeat(n); }).join(b) + c; };
      var out = [sep("┌", "┬", "┐"), "│" + head.map(function (h, i) { return cen(h, w[i]); }).join("│") + "│", sep("├", "┼", "┤")].concat(body.map(function (b) { return "│" + b.map(function (x, i) { return cen(x, w[i]); }).join("│") + "│"; }), [sep("└", "┴", "┘")]);
      emit(1, out.join("\n") + "\n");
    },
  };
  self.console = konsole;

  // ======== Buffer（Uint8Array 的子类）========
  function encodeStr(s, enc) {
    enc = String(enc || "utf8").toLowerCase().replace("-", "");
    s = String(s);
    var u, i;
    if (enc === "utf8") return new TextEncoder().encode(s);
    if (enc === "hex") { var n = s.length >> 1; u = new Uint8Array(n); for (i = 0; i < n; i++) { var b = parseInt(s.substr(i * 2, 2), 16); if (isNaN(b)) return u.subarray(0, i); u[i] = b; } return u; }
    if (enc === "base64" || enc === "base64url") { var bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "").replace(/^(.{4})*(.{2,3})$/, function (m) { return m + "===".slice((m.length % 4) - 1); })); u = new Uint8Array(bin.length); for (i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    if (enc === "latin1" || enc === "binary" || enc === "ascii") { u = new Uint8Array(s.length); for (i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; }
    if (enc === "utf16le" || enc === "ucs2") { u = new Uint8Array(s.length * 2); for (i = 0; i < s.length; i++) { var c = s.charCodeAt(i); u[i * 2] = c & 255; u[i * 2 + 1] = c >> 8; } return u; }
    throw new TypeError("Unknown encoding: " + enc);
  }
  function bytesToLatin1(u) { var s = ""; for (var i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, Array.prototype.slice.call(u, i, i + 8192)); return s; }
  function decodeBytes(u, enc) {
    enc = String(enc || "utf8").toLowerCase().replace("-", "");
    if (enc === "utf8") return new TextDecoder().decode(u);
    if (enc === "hex") return Array.prototype.map.call(u, function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
    if (enc === "base64") return btoa(bytesToLatin1(u));
    if (enc === "base64url") return btoa(bytesToLatin1(u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (enc === "latin1" || enc === "binary") return bytesToLatin1(u);
    if (enc === "ascii") return bytesToLatin1(u.map(function (b) { return b & 127; }));
    if (enc === "utf16le" || enc === "ucs2") { var s = ""; for (var i = 0; i + 1 < u.length; i += 2) s += String.fromCharCode(u[i] | (u[i + 1] << 8)); return s; }
    throw new TypeError("Unknown encoding: " + enc);
  }
  class Buffer extends Uint8Array {
    static from(v, enc, len) {
      if (typeof v === "string") { var e = encodeStr(v, enc); return new Buffer(e.buffer, e.byteOffset, e.length); }
      if (v instanceof ArrayBuffer) return new Buffer(v, enc || 0, len !== undefined ? len : v.byteLength - (enc || 0));
      if (ArrayBuffer.isView(v) || Array.isArray(v)) { var b = new Buffer(v.length); for (var i = 0; i < v.length; i++) b[i] = v[i] & 255; return b; }
      if (v && v.type === "Buffer" && Array.isArray(v.data)) return Buffer.from(v.data);
      throw new TypeError("The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object.");
    }
    static alloc(n, fill, enc) { var b = new Buffer(n); if (fill !== undefined) { if (typeof fill === "string") { var f = encodeStr(fill, enc); for (var i = 0; i < n; i++) b[i] = f[i % f.length]; } else b.fill(fill); } return b; }
    static allocUnsafe(n) { return new Buffer(n); }
    static isBuffer(b) { return b instanceof Buffer; }
    static isEncoding(e) { return /^(utf-?8|hex|base64(url)?|latin1|binary|ascii|utf-?16le|ucs-?2)$/i.test(String(e)); }
    static byteLength(s, enc) { return typeof s === "string" ? encodeStr(s, enc).length : s.byteLength; }
    static concat(list, total) {
      total = total !== undefined ? total : list.reduce(function (n, b) { return n + b.length; }, 0);
      var out = Buffer.alloc(total), o = 0;
      list.forEach(function (b) { if (o >= total) return; out.set(b.subarray(0, Math.min(b.length, total - o)), o); o += b.length; });
      return out;
    }
    static compare(a, b) { return a.compare(b); }
    toString(enc, start, end) { return decodeBytes(this.subarray(start || 0, end === undefined ? this.length : end), enc); }
    toJSON() { return { type: "Buffer", data: Array.from(this) }; }
    equals(o) { if (o.length !== this.length) return false; for (var i = 0; i < this.length; i++) if (this[i] !== o[i]) return false; return true; }
    compare(o) { for (var i = 0; i < Math.min(this.length, o.length); i++) if (this[i] !== o[i]) return this[i] < o[i] ? -1 : 1; return this.length === o.length ? 0 : this.length < o.length ? -1 : 1; }
    slice(a, b) { return this.subarray(a, b); }
    write(s, off, enc) { var e = encodeStr(s, typeof off === "string" ? off : enc); off = typeof off === "number" ? off : 0; var n = Math.min(e.length, this.length - off); this.set(e.subarray(0, n), off); return n; }
    indexOf(v, from, enc) {
      if (typeof v === "number") return Uint8Array.prototype.indexOf.call(this, v, from);
      var n = typeof v === "string" ? encodeStr(v, enc) : v;
      for (var i = from || 0; i <= this.length - n.length; i++) { var j = 0; while (j < n.length && this[i + j] === n[j]) j++; if (j === n.length) return i; }
      return -1;
    }
    includes(v, from, enc) { return this.indexOf(v, from, enc) >= 0; }
    readUInt8(o) { return this[o || 0]; }
    readUInt16LE(o) { o = o || 0; return this[o] | (this[o + 1] << 8); }
    readUInt16BE(o) { o = o || 0; return (this[o] << 8) | this[o + 1]; }
    readUInt32LE(o) { o = o || 0; return (this[o] | (this[o + 1] << 8) | (this[o + 2] << 16)) + this[o + 3] * 0x1000000; }
    readUInt32BE(o) { o = o || 0; return this[o] * 0x1000000 + ((this[o + 1] << 16) | (this[o + 2] << 8) | this[o + 3]); }
    readInt32LE(o) { o = o || 0; return this[o] | (this[o + 1] << 8) | (this[o + 2] << 16) | (this[o + 3] << 24); }
  }
  self.Buffer = Buffer;

  // ======== 路径（posix）========
  function normalizeStr(p) {
    if (p === "") return ".";
    var abs = p[0] === "/", trail = p[p.length - 1] === "/", out = [];
    p.split("/").forEach(function (s) { if (!s || s === ".") return; if (s === "..") { if (out.length && out[out.length - 1] !== "..") out.pop(); else if (!abs) out.push(".."); } else out.push(s); });
    var r = (abs ? "/" : "") + out.join("/");
    if (!r) r = abs ? "/" : ".";
    if (trail && r !== "/") r += "/";
    return r;
  }
  var path = {
    sep: "/", delimiter: ":",
    normalize: normalizeStr,
    join: function () { var a = [].filter.call(arguments, function (s) { if (typeof s !== "string") throw new TypeError('The "path" argument must be of type string'); return s !== ""; }); return a.length ? normalizeStr(a.join("/")) : "."; },
    resolve: function () { var r = ""; for (var i = arguments.length - 1; i >= -1 && r[0] !== "/"; i--) { var s = i >= 0 ? arguments[i] : cwd; if (s) r = s + (r ? "/" + r : ""); } r = normalizeStr(r); return r.length > 1 ? r.replace(/\/$/, "") : r; },
    isAbsolute: function (p) { return p[0] === "/"; },
    dirname: function (p) { p = String(p).replace(/\/+$/, "") || (p[0] === "/" ? "/" : ""); var i = p.lastIndexOf("/"); return i < 0 ? "." : i === 0 ? "/" : p.slice(0, i); },
    basename: function (p, ext) { p = String(p).replace(/\/+$/, ""); var b = p.slice(p.lastIndexOf("/") + 1); if (ext && b !== ext && b.slice(-ext.length) === ext) b = b.slice(0, -ext.length); return b; },
    extname: function (p) { var b = path.basename(p), i = b.lastIndexOf("."); return i <= 0 ? "" : b.slice(i); },
    relative: function (from, to) {
      var a = path.resolve(from).split("/").filter(Boolean), b = path.resolve(to).split("/").filter(Boolean), i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return a.slice(i).map(function () { return ".."; }).concat(b.slice(i)).join("/");
    },
    parse: function (p) { var root = p[0] === "/" ? "/" : "", base = path.basename(p), ext = path.extname(p), dir = path.dirname(p); return { root: root, dir: dir === "." && !p.includes("/") ? "" : dir, base: base, ext: ext, name: ext ? base.slice(0, -ext.length) : base }; },
    format: function (o) { var dir = o.dir || o.root || "", base = o.base || (o.name || "") + (o.ext || ""); return dir ? (dir === o.root ? dir + base : dir + "/" + base) : base; },
    toNamespacedPath: function (p) { return p; },
  };
  path.posix = path;

  // ======== 文件系统（在快照上同步完成；改动发回主线程）========
  var files = d.files; // 路径 → 字符串（文本）| { bin: Uint8Array } | true（目录）
  var meta = d.meta || {}, W = d.writable; // W：null = 人（都能写）；否则 路径 → 能不能写（按 can(p, "w")）
  var made = {}; // 这次运行里建出来的：属于自己，能写
  var abs = function (p) {
    if (typeof p === "number") return p;
    if (p instanceof URL) p = decodeURIComponent(p.pathname);
    if (p && typeof p === "object" && p.href) p = decodeURIComponent(new URL(p.href).pathname);
    p = String(p);
    if (p[0] !== "/") p = cwd + "/" + p;
    var r = normalizeStr(p);
    return r.length > 1 ? r.replace(/\/$/, "") : r;
  };
  var isDirP = function (p) { return files[p] === true; };
  var existsP = function (p) { return Object.prototype.hasOwnProperty.call(files, p); };
  var parentOf = function (p) { return p.slice(0, p.lastIndexOf("/")) || "/"; };
  function fsErr(code, syscall, p, extra) {
    var msg = { ENOENT: "no such file or directory", EEXIST: "file already exists", EISDIR: "illegal operation on a directory", ENOTDIR: "not a directory", ENOTEMPTY: "directory not empty", EACCES: "permission denied", EPERM: "operation not permitted", EBADF: "bad file descriptor", ENOSYS: "function not implemented" }[code];
    var e = new Error(code + ": " + msg + ", " + syscall + " '" + p + "'" + (extra ? " -> '" + extra + "'" : ""));
    e.code = code; e.errno = { ENOENT: -2, EEXIST: -17, EISDIR: -21, ENOTDIR: -20, ENOTEMPTY: -39, EACCES: -13, EPERM: -1, EBADF: -9, ENOSYS: -38 }[code]; e.syscall = syscall; e.path = p;
    if (extra) e.dest = extra;
    return e;
  }
  function writable(p) {
    if (!W) return true;
    var q = p;
    while (!existsP(q) && q !== "/") { if (made[q]) return true; q = parentOf(q); }
    return !!(made[q] || W[q]);
  }
  function needWrite(p, sys) { if (!writable(p)) throw fsErr("EACCES", sys, p); }
  function needDir(p, sys) { var par = parentOf(p); if (!existsP(par)) throw fsErr("ENOENT", sys, p); if (!isDirP(par)) throw fsErr("ENOTDIR", sys, p); }
  function toText(data, enc) {
    if (typeof data === "string") return data;
    if (data instanceof ArrayBuffer) data = new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return { bin: new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice() };
    return String(data);
  }
  // 存进去的内容：能按 UTF-8 解开的二进制存成文本（沙盒里的工具都按文本处理）；解不开的存成二进制
  function stored(v) {
    if (typeof v === "string" || !v || !v.bin) return v;
    try { return new TextDecoder("utf-8", { fatal: true }).decode(v.bin); } catch (e) { return v; }
  }
  function bytesOf(v) { return typeof v === "string" ? new TextEncoder().encode(v) : v && v.bin ? v.bin : new Uint8Array(0); }
  function putFile(p, v, sys) {
    if (isDirP(p)) throw fsErr("EISDIR", sys, p);
    needDir(p, sys);
    needWrite(p, sys);
    v = stored(v);
    if (!existsP(p)) made[p] = true;
    files[p] = v;
    meta[p] = { mtime: Date.now(), mode: (meta[p] && meta[p].mode) || 0o644 };
    op(["write", p, v]);
  }
  function readRaw(p, sys) {
    if (p === 0 || p === "/dev/stdin") return d.stdin || "";
    if (!existsP(p)) throw fsErr("ENOENT", sys || "open", p);
    if (isDirP(p)) throw fsErr("EISDIR", "read", p);
    return files[p];
  }
  function listDir(p, sys) {
    if (!existsP(p)) throw fsErr("ENOENT", sys, p);
    if (!isDirP(p)) throw fsErr("ENOTDIR", sys, p);
    var pre = p === "/" ? "/" : p + "/", s = {};
    Object.keys(files).forEach(function (k) { if (k !== p && k.indexOf(pre) === 0) s[k.slice(pre.length).split("/")[0]] = 1; });
    return Object.keys(s).sort();
  }
  function Stats(p) {
    var v = files[p], m = meta[p] || {}, isD = v === true, t = new Date(m.mtime || Date.now());
    this.dev = 1; this.ino = 0; this.nlink = 1; this.uid = 501; this.gid = 20; this.rdev = 0; this.blksize = 4096;
    this.size = isD ? 0 : bytesOf(v).length;
    this.blocks = Math.ceil(this.size / 512);
    this.mode = (isD ? 0o40000 : 0o100000) | (m.mode || (isD ? 0o755 : 0o644));
    this.atime = this.mtime = this.ctime = this.birthtime = t;
    this.atimeMs = this.mtimeMs = this.ctimeMs = this.birthtimeMs = t.getTime();
    this._dir = isD;
  }
  Stats.prototype.isFile = function () { return !this._dir; };
  Stats.prototype.isDirectory = function () { return this._dir; };
  Stats.prototype.isSymbolicLink = function () { return false; };
  Stats.prototype.isFIFO = Stats.prototype.isSocket = Stats.prototype.isBlockDevice = Stats.prototype.isCharacterDevice = function () { return false; };
  function Dirent(name, dir, parent) { this.name = name; this.path = this.parentPath = parent; this._dir = dir; }
  Dirent.prototype.isFile = function () { return !this._dir; };
  Dirent.prototype.isDirectory = function () { return this._dir; };
  Dirent.prototype.isSymbolicLink = function () { return false; };
  var encOf = function (o) { return typeof o === "string" ? o : o && o.encoding; };
  var fds = {}, nextFd = 10;
  var fs = {
    constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64, O_EXCL: 128, O_TRUNC: 512, O_APPEND: 1024 },
    existsSync: function (p) { try { return existsP(abs(p)); } catch (e) { return false; } },
    readFileSync: function (p, o) {
      var q = typeof p === "number" ? p : abs(p), v = readRaw(q, "open"), enc = encOf(o);
      if (typeof v === "string") return enc ? v : Buffer.from(v, "utf8");
      var b = Buffer.from(v.bin);
      return enc ? b.toString(enc) : b;
    },
    writeFileSync: function (p, data, o) {
      if (typeof p === "number") { if (p === 1 || p === 2) return emit(p, String(data)); var fd = fds[p]; if (!fd) throw fsErr("EBADF", "write", String(p)); return fs.writeFileSync(fd.path, data, o); }
      var q = abs(p), flag = o && o.flag;
      if (flag && flag[0] === "a") return fs.appendFileSync(q, data, o);
      if (flag === "wx" && existsP(q)) throw fsErr("EEXIST", "open", q);
      putFile(q, typeof data === "string" && encOf(o) && encOf(o) !== "utf8" && encOf(o) !== "utf-8" ? toText(Buffer.from(data, encOf(o))) : toText(data), "open");
    },
    appendFileSync: function (p, data, o) {
      var q = abs(p), old = existsP(q) ? files[q] : "";
      if (old === true) throw fsErr("EISDIR", "open", q);
      var add = toText(data);
      if (typeof old === "string" && typeof add === "string") return putFile(q, old + add, "open");
      putFile(q, { bin: Buffer.concat([bytesOf(old), bytesOf(add)]) }, "open");
    },
    statSync: function (p, o) { var q = abs(p); if (!existsP(q)) { if (o && o.throwIfNoEntry === false) return undefined; throw fsErr("ENOENT", "stat", q); } return new Stats(q); },
    readdirSync: function (p, o) { var q = abs(p), names = listDir(q, "scandir"); return o && o.withFileTypes ? names.map(function (n) { var k = (q === "/" ? "" : q) + "/" + n; return new Dirent(n, isDirP(k), q); }) : names; },
    mkdirSync: function (p, o) {
      var q = abs(p), rec = o === true || (o && o.recursive);
      if (existsP(q)) { if (rec && isDirP(q)) return undefined; throw fsErr("EEXIST", "mkdir", q); }
      if (!rec) { needDir(q, "mkdir"); needWrite(q, "mkdir"); files[q] = true; made[q] = true; meta[q] = { mtime: Date.now(), mode: 0o755 }; op(["mkdir", q]); return undefined; }
      var parts = q.split("/").filter(Boolean), cur = "", first;
      parts.forEach(function (s) {
        cur += "/" + s;
        if (existsP(cur)) { if (!isDirP(cur)) throw fsErr("ENOTDIR", "mkdir", q); return; }
        needWrite(cur, "mkdir");
        files[cur] = true; made[cur] = true; meta[cur] = { mtime: Date.now(), mode: 0o755 };
        if (!first) first = cur;
      });
      if (first) op(["mkdir", q]);
      return first;
    },
    rmSync: function (p, o) {
      var q = abs(p);
      if (!existsP(q)) { if (o && o.force) return; throw fsErr("ENOENT", "rm", q); }
      if (isDirP(q) && !(o && o.recursive)) { var e = new Error("Path is a directory: rm returned EISDIR (is a directory) " + q); e.code = "ERR_FS_EISDIR"; throw e; }
      needWrite(q, "rm");
      Object.keys(files).forEach(function (k) { if (k === q || k.indexOf(q + "/") === 0) { delete files[k]; delete meta[k]; } });
      op(["rm", q]);
    },
    rmdirSync: function (p, o) {
      var q = abs(p);
      if (!existsP(q)) throw fsErr("ENOENT", "rmdir", q);
      if (!isDirP(q)) throw fsErr("ENOTDIR", "rmdir", q);
      if (listDir(q, "rmdir").length && !(o && o.recursive)) throw fsErr("ENOTEMPTY", "rmdir", q);
      fs.rmSync(q, { recursive: true });
    },
    unlinkSync: function (p) { var q = abs(p); if (!existsP(q)) throw fsErr("ENOENT", "unlink", q); if (isDirP(q)) throw fsErr("EISDIR", "unlink", q); fs.rmSync(q); },
    renameSync: function (a, b) {
      var from = abs(a), to = abs(b);
      if (!existsP(from)) throw fsErr("ENOENT", "rename", from, to);
      needWrite(from, "rename"); needWrite(to, "rename"); needDir(to, "rename");
      if (existsP(to)) { if (isDirP(to) && listDir(to, "rename").length) throw fsErr("ENOTEMPTY", "rename", from, to); fs.rmSync(to, { recursive: true }); }
      Object.keys(files).forEach(function (k) { if (k === from || k.indexOf(from + "/") === 0) { var n = to + k.slice(from.length); files[n] = files[k]; meta[n] = meta[k]; made[n] = true; delete files[k]; delete meta[k]; } });
      op(["mv", from, to]);
    },
    copyFileSync: function (a, b) {
      var from = abs(a), to = abs(b), v = readRaw(from, "copyfile");
      if (isDirP(to)) throw fsErr("EISDIR", "copyfile", from, to);
      putFile(to, v, "copyfile");
    },
    cpSync: function (a, b, o) {
      var from = abs(a), to = abs(b);
      if (!existsP(from)) throw fsErr("ENOENT", "cp", from, to);
      if (isDirP(from) && !(o && o.recursive)) { var e = new Error("Recursive option is required to copy a directory: " + from); e.code = "ERR_FS_EISDIR"; throw e; }
      Object.keys(files).filter(function (k) { return k === from || k.indexOf(from + "/") === 0; }).sort().forEach(function (k) {
        var n = to + k.slice(from.length);
        if (files[k] === true) { if (!existsP(n)) { needWrite(n, "cp"); files[n] = true; made[n] = true; meta[n] = { mtime: Date.now(), mode: 0o755 }; op(["mkdir", n]); } }
        else putFile(n, files[k], "cp");
      });
    },
    accessSync: function (p, mode) { var q = abs(p); if (!existsP(q)) throw fsErr("ENOENT", "access", q); if (mode & 2 && !writable(q)) throw fsErr("EACCES", "access", q); },
    realpathSync: function (p) { var q = abs(p); if (!existsP(q)) throw fsErr("ENOENT", "realpath", q); return q; },
    mkdtempSync: function (prefix) { var q; do { q = abs(prefix + Math.random().toString(36).slice(2, 8)); } while (existsP(q)); fs.mkdirSync(q); return q; },
    lstatSync: null,
    openSync: function (p, flags) {
      var q = abs(p), f = String(flags || "r");
      if (f[0] === "r") readRaw(q, "open");
      else if (f[0] === "w") putFile(q, "", "open");
      else if (f[0] === "a" && !existsP(q)) putFile(q, "", "open");
      var fd = nextFd++;
      fds[fd] = { path: q, flags: f, pos: 0 };
      return fd;
    },
    closeSync: function (fd) { if (!fds[fd]) throw fsErr("EBADF", "close", String(fd)); delete fds[fd]; },
    // (fd, 字符串, position?, 编码?) 或 (fd, buffer, offset?, length?, position?)：只截 buffer 的那一段；这里的文件是按文本存的，
    // 只能接着往后写——给了别的位置就老实报 ENOSYS（以前是一律追加，写乱了也不说）
    writeSync: function (fd, data, a, b, c) {
      var str = typeof data === "string", pos = str ? a : c;
      if (!str && data && (a != null || b != null)) { var off = a || 0; data = Buffer.from(data).subarray(off, b != null ? off + b : undefined); }
      var n = str ? Buffer.byteLength(data, typeof b === "string" ? b : "utf8") : data.length;
      if (fd === 1 || fd === 2) { emit(fd, str ? data : Buffer.from(data).toString()); return n; }
      var h = fds[fd];
      if (!h) throw fsErr("EBADF", "write", String(fd));
      if (typeof pos === "number" && pos !== (existsP(h.path) ? fs.statSync(h.path).size : 0)) throw fsErr("ENOSYS", "write", h.path);
      fs.appendFileSync(h.path, data);
      return n;
    },
    fstatSync: function (fd) { var h = fds[fd]; if (!h) throw fsErr("EBADF", "fstat", String(fd)); return new Stats(h.path); },
    readSync: function () { throw fsErr("ENOSYS", "read", ""); },
    watch: function () { var e = new EventEmitter(); e.close = function () {}; return e; },
    watchFile: function () {}, unwatchFile: function () {},
    chmodSync: function (p, mode) { var q = abs(p); if (!existsP(q)) throw fsErr("ENOENT", "chmod", q); meta[q] = Object.assign({}, meta[q], { mode: typeof mode === "string" ? parseInt(mode, 8) : mode }); },
    utimesSync: function (p) { var q = abs(p); if (!existsP(q)) throw fsErr("ENOENT", "utime", q); },
    symlinkSync: function (a, b) { throw fsErr("EPERM", "symlink", abs(a), abs(b)); },
  };
  fs.lstatSync = fs.statSync;
  fs.Stats = Stats;
  fs.Dirent = Dirent;
  // 流：写就是追加；读一次给完
  fs.createWriteStream = function (p, o) {
    var q = abs(p), s = new EventEmitter(), flag = o && o.flags || "w";
    if (flag[0] !== "a") putFile(q, "", "open");
    s.write = function (chunk, enc, cb) { if (typeof enc === "function") cb = enc; fs.appendFileSync(q, chunk); if (cb) setT(cb, 0, [], false); return true; };
    s.end = function (chunk, enc, cb) { if (typeof chunk === "function") { cb = chunk; chunk = null; } if (typeof enc === "function") cb = enc; if (chunk != null) fs.appendFileSync(q, chunk); setT(function () { s.emit("finish"); s.emit("close"); if (cb) cb(); }, 0, [], false); return s; };
    s.path = q; s.bytesWritten = 0; s.writable = true;
    s.on("pipe", function () {});
    return s;
  };
  fs.createReadStream = function (p, o) {
    var q = abs(p), s = new EventEmitter(), enc = encOf(o), started = false;
    var start = function () { if (started) return; started = true; setT(function () { try { var data = fs.readFileSync(q, enc ? { encoding: enc } : undefined); s.emit("data", data); s.emit("end"); s.emit("close"); } catch (e) { s.emit("error", e); } }, 0, [], false); };
    var on = s.on;
    s.on = function (ev) { var r = on.apply(s, arguments); if (ev === "data" || ev === "end" || ev === "readable") start(); return r; };
    s.pipe = function (dest) { s.on("data", function (c) { dest.write(c); }); s.on("end", function () { if (dest.end && dest !== process.stdout && dest !== process.stderr) dest.end(); }); return dest; };
    s.setEncoding = function (e) { enc = e; return s; };
    s[Symbol.asyncIterator] = function () { var done = false; return { next: function () { if (done) return Promise.resolve({ done: true }); done = true; return Promise.resolve({ value: fs.readFileSync(q, enc ? { encoding: enc } : undefined), done: false }); } }; };
    s.path = q;
    return s;
  };
  // 回调版与 promises 版：由同步版生成（结果在下一轮事件循环给）
  var promises = {};
  ["readFile", "writeFile", "appendFile", "stat", "lstat", "readdir", "mkdir", "rm", "rmdir", "unlink", "rename", "copyFile", "cp", "access", "realpath", "mkdtemp", "chmod", "utimes"].forEach(function (n) {
    var sync = fs[n + "Sync"];
    fs[n] = function () {
      var args = [].slice.call(arguments), cb = typeof args[args.length - 1] === "function" ? args.pop() : null, res, err = null;
      try { res = sync.apply(null, args); } catch (e) { err = e; }
      if (cb) setT(function () { cb(err, res); }, 0, [], false);
    };
    promises[n] = function () { var args = arguments; return new Promise(function (ok, no) { try { ok(sync.apply(null, args)); } catch (e) { no(e); } }); };
  });
  fs.exists = function (p, cb) { var r = fs.existsSync(p); setT(function () { cb(r); }, 0, [], false); };
  promises.open = function (p, flags) { return Promise.resolve().then(function () { var fd = fs.openSync(p, flags); return { fd: fd, close: function () { fs.closeSync(fd); return Promise.resolve(); }, writeFile: function (dt) { fs.writeFileSync(fds[fd].path, dt); return Promise.resolve(); }, readFile: function (o) { return Promise.resolve(fs.readFileSync(fds[fd].path, o)); } }; }); };
  promises.constants = fs.constants;
  fs.promises = promises;

  // ======== events ========
  function EventEmitter() { this._events = {}; this._max = 10; }
  var evs = function (em) { return em._events || (em._events = {}); };
  EventEmitter.prototype.on = EventEmitter.prototype.addListener = function (n, f) { var e = evs(this); if (e.newListener && n !== "newListener") this.emit("newListener", n, f); (e[n] = e[n] || []).push(f); return this; };
  EventEmitter.prototype.prependListener = function (n, f) { var e = evs(this); (e[n] = e[n] || []).unshift(f); return this; };
  EventEmitter.prototype.once = function (n, f) { var self2 = this, w = function () { self2.off(n, w); return f.apply(this, arguments); }; w.listener = f; return this.on(n, w); };
  EventEmitter.prototype.prependOnceListener = function (n, f) { var self2 = this, w = function () { self2.off(n, w); return f.apply(this, arguments); }; w.listener = f; return this.prependListener(n, w); };
  EventEmitter.prototype.off = EventEmitter.prototype.removeListener = function (n, f) { var l = evs(this)[n]; if (!l) return this; var i = l.findIndex(function (x) { return x === f || x.listener === f; }); if (i >= 0) l.splice(i, 1); return this; };
  EventEmitter.prototype.removeAllListeners = function (n) { if (n === undefined) this._events = {}; else delete evs(this)[n]; return this; };
  EventEmitter.prototype.emit = function (n) {
    var l = evs(this)[n], args = [].slice.call(arguments, 1);
    if (n === "error" && (!l || !l.length)) { throw args[0] instanceof Error ? args[0] : new Error("Unhandled error. (" + inspect(args[0]) + ")"); }
    if (!l || !l.length) return false;
    l.slice().forEach(function (f) { f.apply(this, args); }, this);
    return true;
  };
  EventEmitter.prototype.listenerCount = function (n) { return (evs(this)[n] || []).length; };
  EventEmitter.prototype.listeners = function (n) { return (evs(this)[n] || []).map(function (f) { return f.listener || f; }); };
  EventEmitter.prototype.rawListeners = function (n) { return (evs(this)[n] || []).slice(); };
  EventEmitter.prototype.eventNames = function () { var e = evs(this); return Object.keys(e).filter(function (k) { return e[k].length; }); };
  EventEmitter.prototype.setMaxListeners = function (n) { this._max = n; return this; };
  EventEmitter.prototype.getMaxListeners = function () { return this._max; };
  EventEmitter.EventEmitter = EventEmitter;
  EventEmitter.defaultMaxListeners = 10;
  EventEmitter.once = function (em, n) { return new Promise(function (ok, no) { var onErr = function (e) { em.off(n, h); no(e); }, h = function () { if (n !== "error") em.off("error", onErr); ok([].slice.call(arguments)); }; em.once(n, h); if (n !== "error") em.once("error", onErr); }); };
  EventEmitter.on = function () { throw new Error("events.on is not supported in the sandbox"); };

  // ======== process ========
  var process = new EventEmitter();
  var t0 = performance.now();
  var stdinUsed = false;
  function makeStdin() {
    var s = new EventEmitter(), enc = null, started = false;
    var start = function () {
      if (started) return;
      started = true;
      stdinUsed = true;
      setT(function () { var txt = d.stdin || ""; if (txt) s.emit("data", enc ? txt : Buffer.from(txt)); s.emit("end"); s.emit("close"); }, 0, [], false);
    };
    var on = s.on;
    s.on = s.addListener = function (ev) { var r = on.apply(s, arguments); if (ev === "data" || ev === "end" || ev === "readable") start(); return r; };
    s.setEncoding = function (e) { enc = e || "utf8"; return s; };
    s.resume = function () { start(); return s; };
    s.pause = function () { return s; };
    s.read = function () { return null; };
    s.isTTY = false; s.fd = 0;
    s[Symbol.asyncIterator] = function () { var done = false; return { next: function () { if (done) return Promise.resolve({ done: true }); done = true; stdinUsed = true; var txt = d.stdin || ""; return Promise.resolve(txt ? { value: enc ? txt : Buffer.from(txt), done: false } : { done: true }); }, return: function () { done = true; return Promise.resolve({ done: true }); } }; };
    return s;
  }
  var out = function (fd) { var s = new EventEmitter(); s.write = function (c, enc, cb) { emit(fd, typeof c === "string" ? c : Buffer.from(c).toString()); if (typeof enc === "function") cb = enc; if (cb) setT(cb, 0, [], false); return true; }; s.end = function (c) { if (c != null) s.write(c); }; s.isTTY = false; s.columns = 80; s.rows = 24; s.fd = fd; return s; };
  Object.assign(process, {
    argv: ["/usr/local/bin/node"].concat(d.script ? [d.script] : []).concat(d.args || []),
    argv0: "node", execArgv: [], execPath: "/usr/local/bin/node",
    env: Object.assign({ HOME: HOME, USER: d.user || "user", PWD: cwd, PATH: "/usr/local/bin:/usr/bin:/bin", SHELL: "/bin/sh", LANG: "zh_CN.UTF-8", TERM: "xterm-256color" }, d.env || {}),
    cwd: function () { return cwd; },
    chdir: function (p) { var q = abs(p); if (!existsP(q)) throw fsErr("ENOENT", "chdir", q); if (!isDirP(q)) throw fsErr("ENOTDIR", "chdir", q); cwd = q; },
    exit: function (c) { if (c !== undefined) process.exitCode = c; finish(process.exitCode | 0); throw EXIT; },
    abort: function () { finish(134); throw EXIT; },
    exitCode: undefined,
    stdout: out(1), stderr: out(2), stdin: makeStdin(),
    nextTick: function (fn) { var args = [].slice.call(arguments, 1); queueMicrotask(guard(function () { fn.apply(null, args); })); },
    hrtime: Object.assign(function (prev) { var ns = BigInt(Math.round((performance.now() - t0) * 1e6)), s = Number(ns / 1000000000n), n = Number(ns % 1000000000n); if (prev) { s -= prev[0]; n -= prev[1]; if (n < 0) { s--; n += 1e9; } } return [s, n]; }, { bigint: function () { return BigInt(Math.round((performance.now() - t0) * 1e6)); } }),
    uptime: function () { return (performance.now() - t0) / 1000; },
    memoryUsage: Object.assign(function () { var m = performance.memory; return { rss: m ? m.totalJSHeapSize : 5e7, heapTotal: m ? m.totalJSHeapSize : 3e7, heapUsed: m ? m.usedJSHeapSize : 2e7, external: 0, arrayBuffers: 0 }; }, { rss: function () { return 5e7; } }),
    cpuUsage: function () { var us = Math.round((performance.now() - t0) * 1000); return { user: us, system: 0 }; },
    platform: "linux", arch: "x64", pid: 42, ppid: 1, title: "node", version: "v22.12.0",
    versions: { node: "22.12.0", v8: "12.4", uv: "1.49", modules: "127" }, release: { name: "node", lts: "Jod" },
    config: {}, features: {}, emitWarning: function (w) { emit(2, "(node) Warning: " + (w && w.message || w) + "\n"); },
    kill: function () { return true; }, umask: function () { return 0o22; }, getuid: function () { return 501; }, getgid: function () { return 20; },
  });
  self.process = process;
  self.global = self;

  // ======== 其余内置模块 ========
  var os = {
    EOL: "\n", platform: function () { return "linux"; }, type: function () { return "Linux"; }, release: function () { return "6.0.0-sandbox"; }, arch: function () { return "x64"; },
    homedir: function () { return HOME; }, tmpdir: function () { return "/tmp"; }, hostname: function () { return "code"; },
    cpus: function () { return Array.from({ length: navigator.hardwareConcurrency || 4 }, function () { return { model: "sandbox", speed: 3000, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }; }); },
    availableParallelism: function () { return navigator.hardwareConcurrency || 4; },
    totalmem: function () { return 8 * 1024 ** 3; }, freemem: function () { return 4 * 1024 ** 3; }, uptime: function () { return Math.round(performance.now() / 1000); },
    loadavg: function () { return [0, 0, 0]; }, networkInterfaces: function () { return {}; }, endianness: function () { return "LE"; },
    userInfo: function () { return { username: d.user || "user", uid: 501, gid: 20, shell: "/bin/sh", homedir: HOME }; },
    constants: { signals: { SIGINT: 2, SIGTERM: 15, SIGKILL: 9 } },
  };
  function promisify(fn) {
    if (fn && fn[promisify.custom]) return fn[promisify.custom];
    return function () { var args = [].slice.call(arguments), self2 = this; return new Promise(function (ok, no) { fn.apply(self2, args.concat([function (e, v) { if (e) no(e); else ok(arguments.length > 2 ? [].slice.call(arguments, 1) : v); }])); }); };
  }
  promisify.custom = Symbol.for("nodejs.util.promisify.custom");
  function isDeepStrictEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (typeof a !== "object" || typeof b !== "object" || !a || !b || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    if (a instanceof Date) return a.getTime() === b.getTime();
    if (a instanceof Map || a instanceof Set) { if (a.size !== b.size) return false; return isDeepStrictEqual(Array.from(a), Array.from(b)); }
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(function (k) { return Object.prototype.hasOwnProperty.call(b, k) && isDeepStrictEqual(a[k], b[k]); });
  }
  var util = {
    format: format, inspect: inspect, promisify: promisify, isDeepStrictEqual: isDeepStrictEqual,
    callbackify: function (fn) { return function () { var args = [].slice.call(arguments), cb = args.pop(); fn.apply(this, args).then(function (v) { cb(null, v); }, function (e) { cb(e); }); }; },
    inherits: function (c, p) { Object.setPrototypeOf(c.prototype, p.prototype); Object.setPrototypeOf(c, p); c.super_ = p; },
    deprecate: function (fn) { return fn; }, debuglog: function () { return function () {}; },
    types: { isPromise: function (x) { return x instanceof Promise; }, isDate: function (x) { return x instanceof Date; }, isRegExp: function (x) { return x instanceof RegExp; }, isMap: function (x) { return x instanceof Map; }, isSet: function (x) { return x instanceof Set; }, isUint8Array: function (x) { return x instanceof Uint8Array; }, isNativeError: function (x) { return x instanceof Error; } },
    isArray: Array.isArray, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    stripVTControlCharacters: function (s) { return String(s).replace(/\x1b\[[\d;]*[A-Za-z]/g, ""); },
    styleText: function (f, s) { return s; },
    parseArgs: function (o) { o = o || {}; var args = o.args || process.argv.slice(2), values = {}, positionals = []; for (var i = 0; i < args.length; i++) { var a = args[i], m = /^--?([^=]+)(?:=(.*))?$/.exec(a); if (!m) { positionals.push(a); continue; } var name = m[1], def = (o.options || {})[name]; if (!def) { Object.keys(o.options || {}).forEach(function (k) { if (o.options[k].short === name) { name = k; def = o.options[k]; } }); } if (def && def.type === "string") values[name] = m[2] !== undefined ? m[2] : args[++i]; else values[name] = true; } return { values: values, positionals: positionals }; },
  };
  inspect.custom = Symbol.for("nodejs.util.inspect.custom");
  function AssertionError(msg) { var e = new Error(msg); e.name = "AssertionError"; e.code = "ERR_ASSERTION"; return e; }
  var assert = function (v, m) { if (!v) throw AssertionError(m || "The expression evaluated to a falsy value:\n\n  assert(" + inspect(v) + ")\n"); };
  Object.assign(assert, {
    ok: assert, AssertionError: AssertionError,
    equal: function (a, b, m) { if (a != b) throw AssertionError(m || inspect(a) + " == " + inspect(b)); },
    notEqual: function (a, b, m) { if (a == b) throw AssertionError(m || inspect(a) + " != " + inspect(b)); },
    strictEqual: function (a, b, m) { if (!Object.is(a, b)) throw AssertionError(m || "Expected values to be strictly equal:\n\n" + inspect(a) + " !== " + inspect(b) + "\n"); },
    notStrictEqual: function (a, b, m) { if (Object.is(a, b)) throw AssertionError(m || "Expected \"actual\" to be strictly unequal to: " + inspect(b)); },
    deepEqual: function (a, b, m) { if (!isDeepStrictEqual(a, b) && JSON.stringify(a) !== JSON.stringify(b)) throw AssertionError(m || "Expected values to be loosely deep-equal:\n\n" + inspect(a) + "\n\nshould loosely deep-equal\n\n" + inspect(b)); },
    deepStrictEqual: function (a, b, m) { if (!isDeepStrictEqual(a, b)) throw AssertionError(m || "Expected values to be strictly deep-equal:\n+ actual - expected\n\n+ " + inspect(a) + "\n- " + inspect(b)); },
    notDeepStrictEqual: function (a, b, m) { if (isDeepStrictEqual(a, b)) throw AssertionError(m || "Expected \"actual\" not to be strictly deep-equal to: " + inspect(b)); },
    throws: function (fn, exp, m) { try { fn(); } catch (e) { if (exp instanceof RegExp && !exp.test(String(e && e.message || e))) throw AssertionError(m || "The error message does not match"); return; } throw AssertionError(typeof exp === "string" ? exp : m || "Missing expected exception."); },
    doesNotThrow: function (fn) { fn(); },
    rejects: function (p) { return Promise.resolve(typeof p === "function" ? p() : p).then(function () { throw AssertionError("Missing expected rejection."); }, function () {}); },
    fail: function (m) { throw AssertionError(m || "Failed"); },
    match: function (s, re, m) { if (!re.test(s)) throw AssertionError(m || "The input did not match the regular expression " + re); },
  });
  assert.strict = assert;
  var urlMod = {
    URL: URL, URLSearchParams: URLSearchParams,
    fileURLToPath: function (u) { return decodeURIComponent(new URL(String(u)).pathname); },
    pathToFileURL: function (p) { return new URL("file://" + encodeURI(abs(p))); },
    parse: function (s) { try { var u = new URL(s); return { protocol: u.protocol, host: u.host, hostname: u.hostname, port: u.port, pathname: u.pathname, search: u.search, query: u.search.slice(1), hash: u.hash, href: u.href }; } catch (e) { return { pathname: s, href: s }; } },
    format: function (o) { return typeof o === "string" ? o : o.href || (o.protocol ? o.protocol + "//" : "") + (o.host || o.hostname || "") + (o.pathname || "") + (o.search || ""); },
  };
  var querystring = {
    parse: function (s) { var o = {}; new URLSearchParams(s).forEach(function (v, k) { if (k in o) o[k] = [].concat(o[k], v); else o[k] = v; }); return o; },
    stringify: function (o) { return Object.keys(o).map(function (k) { return [].concat(o[k]).map(function (v) { return encodeURIComponent(k) + "=" + encodeURIComponent(v); }).join("&"); }).join("&"); },
    escape: encodeURIComponent, unescape: decodeURIComponent,
  };
  querystring.decode = querystring.parse; querystring.encode = querystring.stringify;
  function StringDecoder(enc) { this.enc = enc || "utf8"; this.td = new TextDecoder(); }
  StringDecoder.prototype.write = function (b) { return this.enc === "utf8" || this.enc === "utf-8" ? this.td.decode(b, { stream: true }) : Buffer.from(b).toString(this.enc); };
  StringDecoder.prototype.end = function (b) { return (b ? this.write(b) : "") + (this.enc === "utf8" || this.enc === "utf-8" ? this.td.decode() : ""); };
  var timersMod = { setTimeout: self.setTimeout, setInterval: self.setInterval, setImmediate: self.setImmediate, clearTimeout: clearT, clearInterval: clearT, clearImmediate: clearT };
  var timersPromises = {
    setTimeout: function (ms, v) { return new Promise(function (ok) { setT(function () { ok(v); }, ms, [], false); }); },
    setImmediate: function (v) { return new Promise(function (ok) { setT(function () { ok(v); }, 0, [], false); }); },
    setInterval: function (ms, v) { var q = [], w = null, t = setT(function () { if (w) { var f = w; w = null; f({ value: v, done: false }); } else q.push(v); }, ms, [], true); return { next: function () { return q.length ? Promise.resolve({ value: q.shift(), done: false }) : new Promise(function (ok) { w = ok; }); }, return: function () { clearT(t); return Promise.resolve({ done: true }); }, [Symbol.asyncIterator]: function () { return this; } }; },
    scheduler: { wait: function (ms) { return timersPromises.setTimeout(ms); }, yield: function () { return timersPromises.setImmediate(); } },
  };
  // readline：一行一行读 stdin；question 从 stdin 里拿下一行
  var readline = {
    createInterface: function (o) {
      var rl = new EventEmitter(), lines = String(d.stdin || "").split("\n"), closed = false, started = false, waiting = [];
      if (lines.length && lines[lines.length - 1] === "") lines.pop();
      stdinUsed = stdinUsed || !!(o && o.input === process.stdin);
      var drain = function () {
        if (started) return;
        started = true;
        setT(function () { while (lines.length && !closed) rl.emit("line", lines.shift()); if (!closed) rl.close(); }, 0, [], false);
      };
      var on = rl.on;
      rl.on = rl.addListener = function (ev) { var r = on.apply(rl, arguments); if (ev === "line") drain(); return r; };
      rl.question = function (q, opt, cb) { if (typeof opt === "function") cb = opt; emit(1, q); var a = lines.length ? lines.shift() : ""; setT(function () { cb(a); }, 0, [], false); };
      rl.close = function () { if (closed) return; closed = true; rl.emit("close"); waiting.splice(0).forEach(function (f) { f({ done: true }); }); };
      rl.write = function () {}; rl.pause = rl.resume = function () { return rl; }; rl.setPrompt = function () {}; rl.prompt = function () {};
      rl[Symbol.asyncIterator] = function () { return { next: function () { if (lines.length) return Promise.resolve({ value: lines.shift(), done: false }); closed = true; return Promise.resolve({ done: true }); }, return: function () { rl.close(); return Promise.resolve({ done: true }); } }; };
      return rl;
    },
  };
  var readlinePromises = { createInterface: function (o) { var rl = readline.createInterface(o), q = rl.question; rl.question = function (text) { return new Promise(function (ok) { q.call(rl, text, ok); }); }; return rl; } };

  // ---- crypto：随机数、摘要（md5 / sha1 / sha256，同步，纯 JS）、HMAC ----
  var K256 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function pad64(bytes, little) {
    var l = bytes.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n), dv = new DataView(m.buffer);
    m.set(bytes); m[l] = 0x80;
    var hi = Math.floor(l / 0x20000000), lo = (l * 8) >>> 0;
    if (little) { dv.setUint32(n - 8, lo, true); dv.setUint32(n - 4, hi, true); } else { dv.setUint32(n - 4, lo); dv.setUint32(n - 8, hi); }
    return { m: m, dv: dv, n: n };
  }
  function sha256(bytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], p = pad64(bytes), w = new Int32Array(64);
    for (var o = 0; o < p.n; o += 64) {
      for (var i = 0; i < 16; i++) w[i] = p.dv.getInt32(o + i * 4);
      for (i = 16; i < 64; i++) { var a0 = w[i - 15], b0 = w[i - 2]; w[i] = (((a0 >>> 7 | a0 << 25) ^ (a0 >>> 18 | a0 << 14) ^ (a0 >>> 3)) + w[i - 16] + ((b0 >>> 17 | b0 << 15) ^ (b0 >>> 19 | b0 << 13) ^ (b0 >>> 10)) + w[i - 7]) | 0; }
      var A = H[0], B = H[1], C = H[2], D = H[3], E = H[4], Fh = H[5], G = H[6], Hh = H[7];
      for (i = 0; i < 64; i++) {
        var t1 = (Hh + ((E >>> 6 | E << 26) ^ (E >>> 11 | E << 21) ^ (E >>> 25 | E << 7)) + ((E & Fh) ^ (~E & G)) + K256[i] + w[i]) | 0;
        var t2 = (((A >>> 2 | A << 30) ^ (A >>> 13 | A << 19) ^ (A >>> 22 | A << 10)) + ((A & B) ^ (A & C) ^ (B & C))) | 0;
        Hh = G; G = Fh; Fh = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0;
      }
      H[0] = (H[0] + A) | 0; H[1] = (H[1] + B) | 0; H[2] = (H[2] + C) | 0; H[3] = (H[3] + D) | 0; H[4] = (H[4] + E) | 0; H[5] = (H[5] + Fh) | 0; H[6] = (H[6] + G) | 0; H[7] = (H[7] + Hh) | 0;
    }
    var out = new Uint8Array(32), od = new DataView(out.buffer);
    H.forEach(function (h, i2) { od.setInt32(i2 * 4, h); });
    return out;
  }
  function sha1(bytes) {
    var H = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476, 0xc3d2e1f0 | 0], p = pad64(bytes), w = new Int32Array(80);
    for (var o = 0; o < p.n; o += 64) {
      for (var i = 0; i < 16; i++) w[i] = p.dv.getInt32(o + i * 4);
      for (i = 16; i < 80; i++) { var x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = x << 1 | x >>> 31; }
      var A = H[0], B = H[1], C = H[2], D = H[3], E = H[4];
      for (i = 0; i < 80; i++) {
        var f, k;
        if (i < 20) { f = (B & C) | (~B & D); k = 0x5a827999; } else if (i < 40) { f = B ^ C ^ D; k = 0x6ed9eba1; } else if (i < 60) { f = (B & C) | (B & D) | (C & D); k = 0x8f1bbcdc | 0; } else { f = B ^ C ^ D; k = 0xca62c1d6 | 0; }
        var t = ((A << 5 | A >>> 27) + f + E + k + w[i]) | 0;
        E = D; D = C; C = B << 30 | B >>> 2; B = A; A = t;
      }
      H[0] = (H[0] + A) | 0; H[1] = (H[1] + B) | 0; H[2] = (H[2] + C) | 0; H[3] = (H[3] + D) | 0; H[4] = (H[4] + E) | 0;
    }
    var out = new Uint8Array(20), od = new DataView(out.buffer);
    H.forEach(function (h, i2) { od.setInt32(i2 * 4, h); });
    return out;
  }
  var S5 = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  var K5 = []; for (var ki = 0; ki < 64; ki++) K5[ki] = Math.floor(Math.abs(Math.sin(ki + 1)) * 4294967296) | 0;
  function md5(bytes) {
    var p = pad64(bytes, true), a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (var o = 0; o < p.n; o += 64) {
      var A = a0, B = b0, C = c0, D = d0;
      for (var i = 0; i < 64; i++) {
        var F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; } else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; } else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + K5[i] + p.dv.getInt32(o + g * 4, true)) | 0;
        A = D; D = C; C = B; B = (B + (F << S5[i] | F >>> (32 - S5[i]))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    var out = new Uint8Array(16), od = new DataView(out.buffer);
    [a0, b0, c0, d0].forEach(function (h, i2) { od.setInt32(i2 * 4, h, true); });
    return out;
  }
  var HASHES = { md5: md5, sha1: sha1, sha256: sha256 };
  var asBytes = function (data, enc) { return typeof data === "string" ? encodeStr(data, enc) : data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength); };
  function Hash(alg, key) {
    alg = String(alg).toLowerCase().replace("-", "");
    if (!HASHES[alg]) throw new Error("Digest method not supported: " + alg + "（沙盒里有 md5、sha1、sha256）");
    this.fn = HASHES[alg]; this.parts = []; this.key = key;
  }
  Hash.prototype.update = function (data, enc) { this.parts.push(asBytes(data, enc)); return this; };
  Hash.prototype.digest = function (enc) {
    var msg = Buffer.concat(this.parts.map(function (u) { return Buffer.from(u); })), r;
    if (this.key !== undefined) {
      var k = asBytes(this.key);
      if (k.length > 64) k = this.fn(k);
      var ip = new Uint8Array(64 + msg.length), opd = new Uint8Array(64);
      for (var i = 0; i < 64; i++) { var b = k[i] || 0; ip[i] = b ^ 0x36; opd[i] = b ^ 0x5c; }
      ip.set(msg, 64);
      var inner = this.fn(ip), outer = new Uint8Array(64 + inner.length);
      outer.set(opd); outer.set(inner, 64);
      r = this.fn(outer);
    } else r = this.fn(msg);
    var buf = Buffer.from(r);
    return enc ? buf.toString(enc) : buf;
  };
  Hash.prototype.copy = function () { var h = new Hash("sha256"); h.fn = this.fn; h.parts = this.parts.slice(); h.key = this.key; return h; };
  var cryptoMod = {
    createHash: function (alg) { return new Hash(alg); },
    createHmac: function (alg, key) { return new Hash(alg, key); },
    randomUUID: function () { return self.crypto.randomUUID(); },
    randomBytes: function (n, cb) { var b = Buffer.alloc(n); for (var i = 0; i < n; i += 65536) self.crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536))); if (cb) { setT(function () { cb(null, b); }, 0, [], false); return; } return b; },
    randomInt: function (a, b, cb) { if (typeof b === "function" || b === undefined) { cb = b; b = a; a = 0; } var v = a + Math.floor(Math.random() * (b - a)); if (typeof cb === "function") { setT(function () { cb(null, v); }, 0, [], false); return; } return v; },
    getRandomValues: function (v) { return self.crypto.getRandomValues(v); },
    timingSafeEqual: function (a, b) { if (a.length !== b.length) throw new RangeError("Input buffers must have the same byte length"); var r = 0; for (var i = 0; i < a.length; i++) r |= a[i] ^ b[i]; return r === 0; },
    getHashes: function () { return Object.keys(HASHES); },
    webcrypto: self.crypto, subtle: self.crypto.subtle,
  };

  // ---- 不支持的：给一句能照着做的提示 ----
  var NOPE = {
    child_process: "沙盒里没有子进程：在 shell 里用 && 或 ; 把命令串起来",
    http: "沙盒里不能开服务器，也没有 http 模块：请求用全局的 fetch", https: "请求用全局的 fetch（沙盒里没有 https 模块）",
    net: "沙盒里没有网络套接字：请求用 fetch", tls: "沙盒里没有 tls：请求用 fetch", dgram: "沙盒里没有 UDP", dns: "沙盒里没有 dns：直接 fetch 网址",
    worker_threads: "沙盒里没有 worker_threads", cluster: "沙盒里没有 cluster", vm: "沙盒里没有 vm 模块", v8: "沙盒里没有 v8 模块", zlib: "沙盒里没有 zlib：可以用全局的 CompressionStream",
  };
  var stream = (function () {
    function Stream() { EventEmitter.call(this); }
    Stream.prototype = Object.create(EventEmitter.prototype);
    function Writable(o) { Stream.call(this); this._w = o && o.write; this.chunks = []; }
    Writable.prototype = Object.create(Stream.prototype);
    Writable.prototype.write = function (c, e, cb) { var self2 = this; if (typeof e === "function") cb = e; if (this._w) this._w.call(this, c, e, cb || function () {}); else { this.chunks.push(c); if (cb) setT(cb, 0, [], false); } return true; };
    Writable.prototype.end = function (c) { if (c != null) this.write(c); var self2 = this; setT(function () { self2.emit("finish"); self2.emit("close"); }, 0, [], false); return this; };
    function Readable(o) { Stream.call(this); this._r = o && o.read; this.queue = []; this.ended = false; }
    Readable.prototype = Object.create(Stream.prototype);
    Readable.prototype.push = function (c) { var self2 = this; if (c === null) { this.ended = true; setT(function () { self2.emit("end"); self2.emit("close"); }, 0, [], false); } else setT(function () { self2.emit("data", c); }, 0, [], false); return true; };
    Readable.prototype.pipe = function (dest) { this.on("data", function (c) { dest.write(c); }); this.on("end", function () { if (dest.end && dest !== process.stdout) dest.end(); }); return dest; };
    Readable.prototype.setEncoding = function () { return this; };
    Readable.prototype.resume = function () { return this; };
    Readable.from = function (it) { var r = new Readable(); (async function () { for await (var x of it) r.push(x); r.push(null); })(); return r; };
    function Transform(o) { Readable.call(this); this._t = o && o.transform; }
    Transform.prototype = Object.create(Readable.prototype);
    Transform.prototype.write = function (c, e, cb) { var self2 = this; if (this._t) this._t.call(this, c, e, function (err, out) { if (out != null) self2.push(out); if (cb) cb(err); }); else this.push(c); return true; };
    Transform.prototype.end = function (c) { if (c != null) this.write(c); this.push(null); return this; };
    var PassThrough = function (o) { Transform.call(this, o); };
    PassThrough.prototype = Object.create(Transform.prototype);
    Stream.Stream = Stream; Stream.Readable = Readable; Stream.Writable = Writable; Stream.Transform = Transform; Stream.PassThrough = PassThrough;
    Stream.pipeline = function () { var a = [].slice.call(arguments), cb = typeof a[a.length - 1] === "function" ? a.pop() : null; for (var i = 0; i < a.length - 1; i++) a[i].pipe(a[i + 1]); if (cb) a[a.length - 1].on("finish", function () { cb(); }); return a[a.length - 1]; };
    return Stream;
  })();
  var BUILTIN = {
    fs: fs, "fs/promises": promises, path: path, "path/posix": path, os: os, util: util, events: EventEmitter, assert: assert, "assert/strict": assert,
    buffer: { Buffer: Buffer, constants: { MAX_LENGTH: 2 ** 31 - 1 } }, url: urlMod, querystring: querystring, string_decoder: { StringDecoder: StringDecoder },
    crypto: cryptoMod, readline: readline, "readline/promises": readlinePromises, timers: timersMod, "timers/promises": timersPromises, stream: stream,
    process: process, console: konsole, perf_hooks: { performance: performance }, module: { builtinModules: [] }, constants: fs.constants,
  };
  BUILTIN.module.builtinModules = Object.keys(BUILTIN).concat(Object.keys(NOPE));

  // ======== 模块：CommonJS（本地文件、package.json 的 main、node_modules），ESM 的常见写法换成 CommonJS ========
  var cache = {};
  function resolveFile(p) {
    if (existsP(p) && !isDirP(p)) return p;
    var exts = [".js", ".cjs", ".mjs", ".json"];
    for (var i = 0; i < exts.length; i++) if (existsP(p + exts[i]) && !isDirP(p + exts[i])) return p + exts[i];
    if (isDirP(p)) {
      if (existsP(p + "/package.json")) { try { var pj = JSON.parse(readText(p + "/package.json")); var mainF = pj.main || (typeof pj.exports === "string" ? pj.exports : pj.exports && pj.exports["."] && (pj.exports["."].require || pj.exports["."].default || pj.exports["."])); if (typeof mainF === "string") { var r = resolveFile(normalizeStr(p + "/" + mainF)); if (r) return r; } } catch (e) { /* 坏的 package.json */ } }
      for (i = 0; i < exts.length; i++) if (existsP(p + "/index" + exts[i])) return p + "/index" + exts[i];
    }
    return null;
  }
  function readText(p) { var v = files[p]; return typeof v === "string" ? v : v && v.bin ? new TextDecoder().decode(v.bin) : ""; }
  function makeRequire(dir, parent) {
    var req = function (id) {
      id = String(id);
      var bare = id.replace(/^node:/, "");
      if (Object.prototype.hasOwnProperty.call(BUILTIN, bare)) return BUILTIN[bare];
      if (NOPE[bare]) { var e0 = new Error("Cannot find module '" + id + "'（" + NOPE[bare] + "）"); e0.code = "MODULE_NOT_FOUND"; throw e0; }
      var file = req.resolve(id);
      return load(file, parent);
    };
    req.resolve = function (id) {
      var bare = String(id).replace(/^node:/, "");
      if (Object.prototype.hasOwnProperty.call(BUILTIN, bare)) return bare;
      var hit = null;
      if (/^(\.{1,2}(\/|$)|\/)/.test(id)) hit = resolveFile(normalizeStr(id[0] === "/" ? id : dir + "/" + id));
      else for (var q = dir; !hit; q = parentOf(q)) { hit = resolveFile(normalizeStr(q + "/node_modules/" + id)); if (q === "/") break; }
      if (!hit) { var e = new Error("Cannot find module '" + id + "'\nRequire stack:\n- " + (parent ? parent.filename : "[eval]") + (/^[.\/]/.test(id) ? "" : "\n（沙盒里没有 npm：内置模块有 " + Object.keys(BUILTIN).slice(0, 14).join("、") + " 等；也可以把依赖的源码放进 node_modules/）")); e.code = "MODULE_NOT_FOUND"; throw e; }
      return hit;
    };
    req.cache = cache;
    req.main = mainModule;
    return req;
  }
  function load(file, parent) {
    if (cache[file]) return cache[file].exports;
    var mod = { id: file, filename: file, path: parentOf(file), loaded: false, exports: {}, children: [], paths: [], parent: parent || null };
    cache[file] = mod;
    if (parent) parent.children.push(mod);
    var src = readText(file);
    if (/\.json$/.test(file)) mod.exports = JSON.parse(src);
    else run(mod, src);
    mod.loaded = true;
    return mod.exports;
  }
  // ESM → CommonJS（常见写法；不是完整的 ESM）
  function esm(src) {
    // export const a = 1, b = 2 / export const { a, b: c } = o：一行里声明的名字都要导出（不止第一个）
    function declNames(rest) {
      var out = [], depth = 0, q = "", cur = "", parts = [];
      for (var i = 0; i < rest.length; i++) {
        var ch = rest[i];
        if (q) { cur += ch; if (ch === "\\") { cur += rest[++i] || ""; continue; } if (ch === q) q = ""; continue; }
        if (ch === "'" || ch === '"' || ch === "`") { q = ch; cur += ch; continue; }
        if ("([{".indexOf(ch) >= 0) depth++;
        if (")]}".indexOf(ch) >= 0) depth--;
        if (depth === 0 && (ch === "," || ch === ";")) { parts.push(cur); cur = ""; if (ch === ";") break; continue; }
        cur += ch;
      }
      if (cur.trim()) parts.push(cur);
      parts.forEach(function (d) {
        d = d.trim();
        var head = /^([\w$]+)/.exec(d);
        if (head) return out.push(head[1]);
        var pat = /^[\[{]/.test(d) ? d.slice(0, d.search(/[\]}]\s*=/) + 1) : "";
        pat.replace(/[\[\]{},]/g, " , ").split(",").forEach(function (x) {
          x = x.replace(/=.*$/, "").trim();
          if (!x) return;
          var mm = /(?:\.\.\.)?\s*(?:[\w$]+\s*:\s*)?([\w$]+)\s*$/.exec(x);
          if (mm) out.push(mm[1]);
        });
      });
      return out;
    }
    if (!/^\s*(import|export)\b/m.test(src) && !/\bimport\.meta\b/.test(src)) return src;
    var tail = [], n = 0;
    // 同一行里用分号隔开的几条 import / export：先拆到各自一行（下面的替换都按行首认）
    src = src.replace(/;[ \t]*(?=(?:import|export)\b)/g, ";\n");
    var dflt = function (m) { return "(" + m + " && " + m + ".__esModule ? " + m + ".default : " + m + ")"; };
    src = src.replace(/^\s*import\s+([\w$]+)\s*,\s*\{([^}]*)\}\s*from\s*(['"][^'"]+['"])\s*;?/gm, function (m, d2, names, from) { var v = "__m" + n++; return "const " + v + " = require(" + from + "); const " + d2 + " = " + dflt(v) + "; const {" + names.replace(/\s+as\s+/g, ": ") + "} = " + v + ";"; })
      .replace(/^\s*import\s+([\w$]+)\s*,\s*\*\s*as\s+([\w$]+)\s*from\s*(['"][^'"]+['"])\s*;?/gm, function (m, d2, ns, from) { return "const " + ns + " = require(" + from + "); const " + d2 + " = " + dflt(ns) + ";"; })
      .replace(/^\s*import\s+\*\s+as\s+([\w$]+)\s+from\s*(['"][^'"]+['"])\s*;?/gm, "const $1 = require($2);")
      .replace(/^\s*import\s*\{([^}]*)\}\s*from\s*(['"][^'"]+['"])\s*;?/gm, function (m, names, from) { return "const {" + names.replace(/\s+as\s+/g, ": ") + "} = require(" + from + ");"; })
      .replace(/^\s*import\s+([\w$]+)\s+from\s*(['"][^'"]+['"])\s*;?/gm, function (m, d2, from) { var v = "__m" + n++; return "const " + v + " = require(" + from + "); const " + d2 + " = " + dflt(v) + ";"; })
      .replace(/^\s*import\s*(['"][^'"]+['"])\s*;?/gm, "require($1);")
      .replace(/^\s*export\s+default\s+/gm, "module.exports.default = ")
      .replace(/^\s*export\s+(async\s+function\*?|function\*?|class)\s+([\w$]+)/gm, function (m, kw, name) { tail.push(name); return kw + " " + name; })
      .replace(/^(\s*)export\s+(const|let|var)\s+([^\n]*)/gm, function (m, sp, kw, rest) { declNames(rest).forEach(function (x) { tail.push(x); }); return sp + kw + " " + rest; })
      .replace(/^\s*export\s*\{([^}]*)\}\s*from\s*(['"][^'"]+['"])\s*;?/gm, function (m, names, from) { var v = "__m" + n++; return "const " + v + " = require(" + from + "); " + names.split(",").filter(function (x) { return x.trim(); }).map(function (x) { var p2 = x.trim().split(/\s+as\s+/); return "module.exports." + (p2[1] || p2[0]) + " = " + v + "." + p2[0] + ";"; }).join(" "); })
      .replace(/^\s*export\s*\{([^}]*)\}\s*;?/gm, function (m, names) { return names.split(",").filter(function (x) { return x.trim(); }).map(function (x) { var p2 = x.trim().split(/\s+as\s+/); return "module.exports." + (p2[1] || p2[0]) + " = " + p2[0] + ";"; }).join(" "); })
      .replace(/^\s*export\s*\*\s*from\s*(['"][^'"]+['"])\s*;?/gm, "Object.assign(module.exports, require($1));")
      .replace(/\bimport\.meta\.url\b/g, '("file://" + __filename)')
      .replace(/\bimport\.meta\.dirname\b/g, "__dirname").replace(/\bimport\.meta\.filename\b/g, "__filename")
      .replace(/(^|[^.\w$])import\s*\(/g, "$1__import(");
    return "Object.defineProperty(module.exports, '__esModule', { value: true });\n" + src + (tail.length ? "\n;" + tail.map(function (t) { return "module.exports." + t + " = " + t + ";"; }).join(" ") : "");
  }
  var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  function compile(src, file) {
    var params = ["exports", "require", "module", "__filename", "__dirname", "__import"], body = src.replace(/^#!.*/, "") + "\n//# sourceURL=" + file;
    try { return Function.apply(null, params.concat([body])); }
    catch (x) {
      // 顶层 await：换成 async 函数再编一次（CommonJS 本来不许，但写脚本时很常用）
      if (x instanceof SyntaxError && /\bawait\b|\bfor\s+await\b/.test(src)) { try { return AsyncFunction.apply(null, params.concat([body])); } catch (y) { /* 还是不行：报原来的错 */ } }
      x.message = x.message + (file ? "（" + file + "）" : "");
      throw x;
    }
  }
  function run(mod, src) {
    var fn = compile(esm(src), mod.filename), req = makeRequire(mod.path, mod);
    var imp = function (id) { return Promise.resolve().then(function () { var m = req(id); return m && m.__esModule ? m : Object.assign({ default: m }, m); }); };
    return fn.call(mod.exports, mod.exports, req, mod, mod.filename, mod.path, imp);
  }

  // ======== 跑 ========
  var mainModule = { id: ".", filename: d.script || "[eval]", path: d.script ? parentOf(d.script) : cwd, exports: {}, loaded: false, children: [], paths: [], parent: null };
  self.require = makeRequire(mainModule.path, mainModule);
  self.module = mainModule;
  self.exports = mainModule.exports;
  self.__filename = mainModule.filename;
  self.__dirname = mainModule.path;
  // 用户代码拿不到协议用的 postMessage / close（免得误伤）
  self.postMessage = function () {};
  self.close = function () { process.exit(); };
  try {
    var result;
    if (d.mode === "p" || d.mode === "e") {
      // -e / -p：同 node 的 [eval]——表达式的值在 -p 时打印
      var code = esm(d.code);
      try { result = (0, eval)(code + "\n//# sourceURL=[eval]"); }
      catch (x) {
        if (x instanceof SyntaxError && /\bawait\b/.test(code)) result = AsyncFunction(code.replace(/;?\s*$/, "") + "\n//# sourceURL=[eval]")();
        else throw x;
      }
      if (d.mode === "p") Promise.resolve(result).then(function (v) { emit(1, (typeof v === "string" ? v : inspect(v)) + "\n"); }, crash);
      else if (result && typeof result.then === "function") result.then(null, crash);
    } else {
      if (d.script) cache[d.script] = mainModule;
      result = run(mainModule, d.code);
      if (result && typeof result.then === "function") result.then(null, crash);
    }
    mainModule.loaded = true;
  } catch (x) { crash(x); }
  later();
}
