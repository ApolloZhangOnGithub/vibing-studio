// office/fx.js —— 表格的公式引擎与数字格式（纯计算，不碰 DOM；浏览器里是 window.TSU_FX，node 里 require 也能用，方便测）
// · 公式：分词 → 语法树（运算优先级同 Excel）→ 求值；引用 A1 / $A$1 / A1:B9 / A:A / 1:3 / Sheet2!A1 / 'My Sheet'!A1:B2；
//   区域参与运算时逐个元素算（SUMPRODUCT((A1:A9>5)*B1:B9) 这类）；错误值 #DIV/0! #N/A #NAME? #REF! #VALUE! #NUM! 同 Excel
// · 函数：数学、统计、逻辑、查找（VLOOKUP / XLOOKUP / INDEX / MATCH …）、文本、日期（序列号同 Excel 的 1900 日期系统）、条件汇总（SUMIF(S) / COUNTIF(S) …）
// · 引用平移（复制、填充）与插入 / 删除行列时的引用调整；数字格式（Excel 的格式代码：0.00、#,##0、0%、yyyy-mm-dd、[Red]、"文字"、分节 ;）；输入识别（数字、百分比、货币、日期、时间）
(function (root) {
  "use strict";

  // ======== 错误值 ========
  function FxError(code) { this.code = code; }
  FxError.prototype.toString = function () { return this.code; };
  var ERR = {};
  ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#CIRC!", "#SPILL!", "#CALC!"].forEach(function (c) { ERR[c] = new FxError(c); });
  var isErr = function (v) { return v instanceof FxError; };

  // ======== 地址 ========
  function colName(c) { var s = ""; c++; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
  function colIndex(name) { var n = 0; name = name.toUpperCase(); for (var i = 0; i < name.length; i++) n = n * 26 + (name.charCodeAt(i) - 64); return n - 1; }
  var MAXR = 1048576, MAXC = 16384;
  function addr(r, c) { return colName(c) + (r + 1); }
  // "B3" → { r: 2, c: 1 }；"$B$3" 也行
  function parseAddr(s) { var m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(s).trim()); return m ? { r: +m[2] - 1, c: colIndex(m[1]) } : null; }
  function quoteSheet(name) { return /^[A-Za-z_\u4e00-\u9fff][\w.\u4e00-\u9fff]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) ? name : "'" + String(name).replace(/'/g, "''") + "'"; }

  // ======== 分词 ========
  // 记号：{ k: "num"|"str"|"bool"|"err"|"ref"|"fn"|"name"|"op"|"(" |")"|","|"{"|"}"|";", v, … }
  var OPS2 = { "<=": 1, ">=": 1, "<>": 1 };
  function tokenize(src) {
    var s = String(src), i = 0, out = [], n = s.length;
    var refRe = /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_\u4e00-\u9fff][\w.\u4e00-\u9fff]*))!)?(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d+:\$?\d+)(?![\w(])/;
    while (i < n) {
      var ch = s[i];
      if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") { i++; continue; }
      if (ch === '"') { // 字符串："" 是一个引号
        var j = i + 1, str = "";
        for (;;) { if (j >= n) break; if (s[j] === '"') { if (s[j + 1] === '"') { str += '"'; j += 2; continue; } break; } str += s[j++]; }
        out.push({ k: "str", v: str }); i = j + 1; continue;
      }
      if (ch === "#") { var em = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|CIRC!|SPILL!|CALC!)/i.exec(s.slice(i)); if (em) { out.push({ k: "err", v: em[0].toUpperCase() }); i += em[0].length; continue; } }
      var rest = s.slice(i), m;
      // 数字（前面不是引用的一部分）
      if ((m = /^(\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest)) && !/^\d+:\$?\d+/.test(rest)) { out.push({ k: "num", v: parseFloat(m[0]) }); i += m[0].length; continue; }
      if ((m = refRe.exec(rest))) {
        out.push({ k: "ref", sheet: m[1] != null ? m[1].replace(/''/g, "'") : m[2] || null, v: m[3] });
        i += m[0].length; continue;
      }
      if ((m = /^(?:'((?:[^']|'')+)'|([A-Za-z_\u4e00-\u9fff][\w.\u4e00-\u9fff]*))!#REF!/.exec(rest))) { out.push({ k: "err", v: "#REF!" }); i += m[0].length; continue; }
      if ((m = /^([A-Za-z_][\w.]*)\s*\(/.exec(rest))) { out.push({ k: "fn", v: m[1].toUpperCase().replace(/^_XLFN\./, "").replace(/^_XLWS\./, "") }); i += m[0].length; continue; }
      if ((m = /^(TRUE|FALSE)(?![\w(])/i.exec(rest))) { out.push({ k: "bool", v: m[1].toUpperCase() === "TRUE" }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_\u4e00-\u9fff][\w.\u4e00-\u9fff]*/.exec(rest))) { out.push({ k: "name", v: m[0] }); i += m[0].length; continue; }
      var two = s.substr(i, 2);
      if (OPS2[two]) { out.push({ k: "op", v: two }); i += 2; continue; }
      if ("+-*/^&=<>%".indexOf(ch) >= 0) { out.push({ k: "op", v: ch }); i++; continue; }
      if ("(),{};".indexOf(ch) >= 0) { out.push({ k: ch }); i++; continue; }
      throw new FxError("#NAME?");
    }
    return out;
  }

  // ======== 语法树 ========
  // 优先级（低 → 高）：比较 < & < + - < * / < ^ < %（后缀）< 负号（一元）
  function parse(src) {
    var toks = tokenize(src), p = 0;
    var peek = function () { return toks[p]; }, next = function () { return toks[p++]; };
    function expect(k) { var t = next(); if (!t || t.k !== k) throw new FxError("#NAME?"); return t; }
    function cmp() {
      var a = concat();
      while (peek() && peek().k === "op" && /^(=|<>|<|>|<=|>=)$/.test(peek().v)) { var op = next().v; a = { t: "op", op: op, a: a, b: concat() }; }
      return a;
    }
    function concat() { var a = add(); while (peek() && peek().k === "op" && peek().v === "&") { next(); a = { t: "op", op: "&", a: a, b: add() }; } return a; }
    function add() { var a = mul(); while (peek() && peek().k === "op" && (peek().v === "+" || peek().v === "-")) { var op = next().v; a = { t: "op", op: op, a: a, b: mul() }; } return a; }
    function mul() { var a = pow(); while (peek() && peek().k === "op" && (peek().v === "*" || peek().v === "/")) { var op = next().v; a = { t: "op", op: op, a: a, b: pow() }; } return a; }
    function pow() { var a = pct(); while (peek() && peek().k === "op" && peek().v === "^") { next(); a = { t: "op", op: "^", a: a, b: pct() }; } return a; }
    function pct() { var a = unary(); while (peek() && peek().k === "op" && peek().v === "%") { next(); a = { t: "pct", a: a }; } return a; }
    function unary() {
      var t = peek();
      if (t && t.k === "op" && (t.v === "-" || t.v === "+")) { next(); var a = unary(); return t.v === "-" ? { t: "neg", a: a } : a; }
      return primary();
    }
    function primary() {
      var t = next();
      if (!t) throw new FxError("#NAME?");
      if (t.k === "num") return { t: "num", v: t.v };
      if (t.k === "str") return { t: "str", v: t.v };
      if (t.k === "bool") return { t: "bool", v: t.v };
      if (t.k === "err") return { t: "err", v: t.v };
      if (t.k === "ref") return refNode(t);
      if (t.k === "name") return { t: "name", v: t.v };
      if (t.k === "(") { var e = cmp(); expect(")"); return e; }
      if (t.k === "{") { // 数组常量 {1,2;3,4}
        var rows = [[]];
        for (;;) {
          var v = unary();
          rows[rows.length - 1].push(v.t === "num" || v.t === "str" || v.t === "bool" ? v.v : v.t === "neg" && v.a.t === "num" ? -v.a.v : ERR["#VALUE!"]);
          var sep = next();
          if (!sep) throw new FxError("#NAME?");
          if (sep.k === "}") break;
          if (sep.k === ";") rows.push([]);
          else if (sep.k !== ",") throw new FxError("#NAME?");
        }
        return { t: "arr", v: rows };
      }
      if (t.k === "fn") {
        var args = [];
        if (peek() && peek().k === ")") { next(); return { t: "fn", name: t.v, args: args }; }
        for (;;) {
          if (peek() && (peek().k === "," || peek().k === ")")) args.push({ t: "missing" }); else args.push(cmp());
          var sep2 = next();
          if (!sep2) throw new FxError("#NAME?");
          if (sep2.k === ")") break;
          if (sep2.k !== ",") throw new FxError("#NAME?");
        }
        return { t: "fn", name: t.v, args: args };
      }
      throw new FxError("#NAME?");
    }
    var tree = cmp();
    if (p < toks.length) throw new FxError("#NAME?");
    return tree;
  }
  // 引用记号 → 节点：单元格 / 区域（整列 A:A、整行 1:3 也是区域）
  function refNode(t) {
    var v = t.v, sheet = t.sheet, parts = v.split(":");
    var one = function (s, isEnd) {
      var m = /^(\$?)([A-Za-z]{1,3})?(\$?)(\d+)?$/.exec(s);
      if (!m) throw new FxError("#REF!");
      return { c: m[2] ? colIndex(m[2]) : isEnd ? MAXC - 1 : 0, ca: m[1] === "$" && !!m[2], r: m[4] ? +m[4] - 1 : isEnd ? MAXR - 1 : 0, ra: m[4] ? (m[2] ? m[3] === "$" : m[1] === "$") : false, hasC: !!m[2], hasR: !!m[4] };
    };
    if (parts.length === 1) { var a = one(parts[0]); return { t: "ref", sheet: sheet, r: a.r, c: a.c, ra: a.ra, ca: a.ca }; }
    var p1 = one(parts[0], false), p2 = one(parts[1], true);
    var wholeCol = !p1.hasR && !p2.hasR, wholeRow = !p1.hasC && !p2.hasC;
    if (wholeCol) { p1.r = 0; p2.r = MAXR - 1; }
    if (wholeRow) { p1.c = 0; p2.c = MAXC - 1; }
    return { t: "range", sheet: sheet, r1: Math.min(p1.r, p2.r), c1: Math.min(p1.c, p2.c), r2: Math.max(p1.r, p2.r), c2: Math.max(p1.c, p2.c),
      ra1: p1.ra, ca1: p1.ca, ra2: p2.ra, ca2: p2.ca, wholeCol: wholeCol, wholeRow: wholeRow };
  }

  // ======== 区域值 ========
  function Range(sheet, r1, c1, r2, c2, ctx) { this.sheet = sheet; this.r1 = r1; this.c1 = c1; this.r2 = r2; this.c2 = c2; this.ctx = ctx; }
  Range.prototype.rows = function () { return this.r2 - this.r1 + 1; };
  Range.prototype.cols = function () { return this.c2 - this.c1 + 1; };
  // 实际用到的边界（整列 A:A 只扫到有数据的最后一行）
  Range.prototype.bounds = function () {
    var u = this.ctx.used(this.sheet);
    return { r2: Math.min(this.r2, u.r), c2: Math.min(this.c2, u.c) };
  };
  Range.prototype.get = function (i, j) { return this.ctx.get(this.sheet, this.r1 + i, this.c1 + j); };
  Range.prototype.each = function (fn) { // 逐个（跳过没数据的行列之外的部分）
    var b = this.bounds();
    for (var r = this.r1; r <= b.r2; r++) for (var c = this.c1; c <= b.c2; c++) fn(this.ctx.get(this.sheet, r, c), r, c);
  };
  Range.prototype.toArray = function () {
    var b = this.bounds(), out = [];
    for (var r = this.r1; r <= Math.max(b.r2, this.r1); r++) { var row = []; for (var c = this.c1; c <= Math.max(b.c2, this.c1); c++) row.push(this.ctx.get(this.sheet, r, c)); out.push(row); }
    return out;
  };

  // ======== 求值 ========
  // ctx：{ get(sheet, r, c) → 值（已算好的；空格子是 null）, used(sheet) → {r, c} 最后有数据的行列, sheet（当前表名）, r, c（当前格）, sheetExists(name) }
  function evaluate(tree, ctx) {
    try { return scalarize(ev(tree, ctx), ctx); } catch (e) { if (e instanceof FxError) return e; throw e; }
  }
  function scalarize(v, ctx) { // 单个格子里的结果：区域取隐式交集（同一行 / 列），数组取左上角
    if (v instanceof Range) {
      if (v.rows() === 1 && v.cols() === 1) return v.get(0, 0);
      if (v.cols() === 1 && ctx.r >= v.r1 && ctx.r <= v.r2) return ctx.get(v.sheet, ctx.r, v.c1);
      if (v.rows() === 1 && ctx.c >= v.c1 && ctx.c <= v.c2) return ctx.get(v.sheet, v.r1, ctx.c);
      return ERR["#VALUE!"];
    }
    if (Array.isArray(v)) return v.length && v[0].length ? v[0][0] : null;
    return v === undefined ? null : v;
  }
  function ev(n, ctx) {
    switch (n.t) {
      case "num": case "str": case "bool": return n.v;
      case "err": return ERR[n.v] || new FxError(n.v);
      case "missing": return null;
      case "arr": return n.v;
      case "name": return ERR["#NAME?"];
      case "ref": {
        var sh = n.sheet || ctx.sheet;
        if (n.sheet && !ctx.sheetExists(n.sheet)) return ERR["#REF!"];
        return ctx.get(sh, n.r, n.c);
      }
      case "range": {
        var sh2 = n.sheet || ctx.sheet;
        if (n.sheet && !ctx.sheetExists(n.sheet)) return ERR["#REF!"];
        return new Range(sh2, n.r1, n.c1, n.r2, n.c2, ctx);
      }
      case "neg": return lift1(ev(n.a, ctx), ctx, function (x) { x = num(x); return isErr(x) ? x : -x; });
      case "pct": return lift1(ev(n.a, ctx), ctx, function (x) { x = num(x); return isErr(x) ? x : x / 100; });
      case "op": return binop(n.op, ev(n.a, ctx), ev(n.b, ctx), ctx);
      case "fn": {
        var f = FN[n.name];
        if (!f) return ERR["#NAME?"];
        if (f.lazy) return f(n.args, ctx);
        var args = n.args.map(function (a) { return ev(a, ctx); });
        return f(args, ctx);
      }
    }
    return ERR["#VALUE!"];
  }
  // 区域 / 数组 → 二维数组；单值原样
  function toGrid(v) { return v instanceof Range ? v.toArray() : Array.isArray(v) ? v : null; }
  function lift1(v, ctx, f) {
    var g = toGrid(v);
    if (!g) return f(v);
    return g.map(function (row) { return row.map(f); });
  }
  function binop(op, a, b, ctx) {
    var ga = toGrid(a), gb = toGrid(b);
    if (ga || gb) { // 逐个元素（单值广播）
      var R = Math.max(ga ? ga.length : 1, gb ? gb.length : 1), C = Math.max(ga ? ga[0].length : 1, gb ? gb[0].length : 1), out = [];
      for (var i = 0; i < R; i++) {
        var row = [];
        for (var j = 0; j < C; j++) {
          var x = ga ? (ga[i] !== undefined && ga[i][j] !== undefined ? ga[i][j] : ga.length === 1 && ga[0][j] !== undefined ? ga[0][j] : ga[i] && ga[i].length === 1 ? ga[i][0] : ERR["#N/A"]) : a;
          var y = gb ? (gb[i] !== undefined && gb[i][j] !== undefined ? gb[i][j] : gb.length === 1 && gb[0][j] !== undefined ? gb[0][j] : gb[i] && gb[i].length === 1 ? gb[i][0] : ERR["#N/A"]) : b;
          row.push(op1(op, x, y));
        }
        out.push(row);
      }
      return out;
    }
    return op1(op, a, b);
  }
  function op1(op, a, b) {
    if (isErr(a)) return a;
    if (isErr(b)) return b;
    if (op === "&") return str(a) + str(b);
    if (/^(=|<>|<|>|<=|>=)$/.test(op)) {
      var c = compare(a, b);
      return op === "=" ? c === 0 : op === "<>" ? c !== 0 : op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
    }
    var x = num(a), y = num(b);
    if (isErr(x)) return x;
    if (isErr(y)) return y;
    switch (op) {
      case "+": return x + y;
      case "-": return x - y;
      case "*": return x * y;
      case "/": return y === 0 ? ERR["#DIV/0!"] : x / y;
      case "^": { if (x === 0 && y === 0) return ERR["#NUM!"]; var p = Math.pow(x, y); return isFinite(p) ? p : ERR["#NUM!"]; }
    }
    return ERR["#VALUE!"];
  }
  // 比较（同 Excel：数字 < 文字 < 逻辑值；文字不分大小写；空格子按对方的类型当 0 / "" / FALSE）
  function typeRank(v) { return typeof v === "number" ? 1 : typeof v === "string" ? 2 : typeof v === "boolean" ? 3 : 0; }
  function compare(a, b) {
    if (a === null || a === undefined) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
    if (b === null || b === undefined) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
    var ta = typeRank(a), tb = typeRank(b);
    if (ta !== tb) return ta - tb;
    if (ta === 2) { var x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
    if (ta === 3) return (a ? 1 : 0) - (b ? 1 : 0);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  // 转数字：空 → 0；逻辑 → 1/0；文字能读成数（含百分比、日期）就用，否则 #VALUE!
  function num(v) {
    if (typeof v === "number") return v;
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (isErr(v)) return v;
    if (typeof v === "string") { var p = parseInput(v); return typeof p.v === "number" ? p.v : ERR["#VALUE!"]; }
    if (v instanceof Range) return num(v.get(0, 0));
    return ERR["#VALUE!"];
  }
  function str(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "number") return formatGeneral(v);
    if (isErr(v)) return v.code;
    return String(v);
  }
  function bool(v) {
    if (typeof v === "boolean") return v;
    if (v === null || v === undefined) return false;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") { var u = v.toUpperCase(); if (u === "TRUE") return true; if (u === "FALSE") return false; return ERR["#VALUE!"]; }
    return isErr(v) ? v : ERR["#VALUE!"];
  }
  // 参数里所有的数（区域里只取数字；直接写的文字能转就转，同 Excel 的 SUM）
  function nums(args, opt) {
    var out = [];
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (a instanceof Range || Array.isArray(a)) {
        var err = null;
        (a instanceof Range ? a.each.bind(a) : function (f) { a.forEach(function (row) { row.forEach(function (x) { f(x); }); }); })(function (x) {
          if (err) return;
          if (isErr(x)) { if (!(opt && opt.skipErr)) err = x; return; }
          if (typeof x === "number") out.push(x);
          else if (opt && opt.countBool && typeof x === "boolean") out.push(x ? 1 : 0);
        });
        if (err) throw err;
      } else if (a !== null && a !== undefined) {
        var n = num(a);
        if (isErr(n)) throw n;
        out.push(n);
      }
    }
    return out;
  }
  function flat(args) { // 所有值（包括文字、空）
    var out = [];
    args.forEach(function (a) {
      if (a instanceof Range) a.each(function (x) { out.push(x); });
      else if (Array.isArray(a)) a.forEach(function (row) { row.forEach(function (x) { out.push(x); }); });
      else out.push(a);
    });
    return out;
  }
  function flatAll(v) { // 区域里每一格（含空），行优先
    if (v instanceof Range) { var out = []; for (var r = v.r1; r <= v.r2; r++) for (var c = v.c1; c <= v.c2; c++) out.push(v.ctx.get(v.sheet, r, c)); return out; }
    if (Array.isArray(v)) return [].concat.apply([], v);
    return [v];
  }
  // 条件（SUMIF / COUNTIF）：">5"、"<>苹果"、"=a*"（* ? 通配）、"" 是空格子
  function criteria(c) {
    if (typeof c === "number" || typeof c === "boolean") return function (x) { return compare(x, c) === 0 && typeof x === typeof c; };
    var s = str(c), m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(s), op = m[1] || "=", rhs = m[2];
    var n = parseInput(rhs), isNum = rhs !== "" && typeof n.v === "number";
    var wild = /[*?]/.test(rhs) && (op === "=" || op === "<>");
    var re = wild ? new RegExp("^" + rhs.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/~\*/g, "\u0001").replace(/~\?/g, "\u0002").replace(/\*/g, "[\\s\\S]*").replace(/\?/g, "[\\s\\S]").replace(/\u0001/g, "\\*").replace(/\u0002/g, "\\?") + "$", "i") : null;
    return function (x) {
      if (isErr(x)) return false;
      if (rhs === "" && !m[1]) return x === null || x === undefined || x === "";
      if (rhs === "" && op === "<>") return !(x === null || x === undefined || x === "");
      if (wild) { var hit = re.test(str(x)); return op === "=" ? hit : !hit; }
      if (isNum) {
        if (typeof x !== "number") { if (op === "<>") return true; return false; }
        var d = x - n.v;
        return op === "=" ? d === 0 : op === "<>" ? d !== 0 : op === "<" ? d < 0 : op === ">" ? d > 0 : op === "<=" ? d <= 0 : d >= 0;
      }
      var cmp = compare(x === null || x === undefined ? "" : typeof x === "string" ? x : str(x), rhs);
      if (typeof x === "number" && op !== "=" && op !== "<>") return false;
      return op === "=" ? cmp === 0 : op === "<>" ? cmp !== 0 : op === "<" ? cmp < 0 : op === ">" ? cmp > 0 : op === "<=" ? cmp <= 0 : cmp >= 0;
    };
  }
  function rangeCells(v) { // 区域 → [{v, r, c}]（按区域大小，不截到已用范围）
    var out = [];
    if (v instanceof Range) { var b = v.bounds(); for (var r = v.r1; r <= Math.max(v.r1, b.r2); r++) for (var c = v.c1; c <= Math.max(v.c1, b.c2); c++) out.push({ v: v.ctx.get(v.sheet, r, c), i: r - v.r1, j: c - v.c1 }); }
    else if (Array.isArray(v)) v.forEach(function (row, i) { row.forEach(function (x, j) { out.push({ v: x, i: i, j: j }); }); });
    else out.push({ v: v, i: 0, j: 0 });
    return out;
  }
  var at = function (v, i, j) { return v instanceof Range ? v.get(i, j) : Array.isArray(v) ? (v[i] ? v[i][j] : undefined) : i === 0 && j === 0 ? v : undefined; };
  var dims = function (v) { return v instanceof Range ? { r: v.rows(), c: v.cols() } : Array.isArray(v) ? { r: v.length, c: v[0] ? v[0].length : 0 } : { r: 1, c: 1 }; };

  // ======== 日期（Excel 1900 系统：序列号 1 = 1900-01-01，60 = 并不存在的 1900-02-29）========
  var DAY = 864e5, EPOCH = Date.UTC(1899, 11, 30);
  function serialOf(y, m, d) { // m 从 1 开始；越界自动进位（同 DATE）
    var t = Date.UTC(y, m - 1, d), s = (t - EPOCH) / DAY;
    return s < 61 ? s - 1 + (s >= 60 ? 1 : 0) : s; // 1900-03-01 以前：Excel 的日数比真实的多 1（因为它有 1900-02-29）
  }
  function ymdOf(serial) {
    var s = Math.floor(serial);
    if (s === 60) return { y: 1900, m: 2, d: 29 };
    var t = EPOCH + (s < 60 ? s + 1 : s) * DAY, dt = new Date(t);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() };
  }
  function weekday(serial) { var s = Math.floor(serial); if (s < 60) s += 0; return ((s + 6) % 7 + 7) % 7; } // 0 = 周日（1900-01-01 是周日在 Excel 里）
  function timeOf(serial) { var f = serial - Math.floor(serial), secs = Math.round(f * 86400); return { h: Math.floor(secs / 3600) % 24, mi: Math.floor(secs / 60) % 60, s: secs % 60, ms: Math.round((f * 86400 - Math.floor(f * 86400)) * 1000) }; }
  function nowSerial() { var d = new Date(); return serialOf(d.getFullYear(), d.getMonth() + 1, d.getDate()) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; }
  function todaySerial() { var d = new Date(); return serialOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function dateOfJS(d) { return serialOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) + (d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds() + d.getUTCMilliseconds() / 1000) / 86400; }
  function jsDateOf(serial) { var p = ymdOf(serial), t = timeOf(serial); return new Date(Date.UTC(p.y, p.m - 1, p.d, t.h, t.mi, t.s)); }

  // ======== 函数 ========
  var FN = {};
  function def(names, f) { names.split(/\s+/).forEach(function (n) { FN[n] = f; }); }
  function lazy(names, f) { f.lazy = true; def(names, f); }
  var guard = function (f) { return function (args, ctx) { try { return f(args, ctx); } catch (e) { if (e instanceof FxError) return e; throw e; } }; };
  var N = function (v) { var x = num(v); if (isErr(x)) throw x; return x; };
  var S = function (v) { if (isErr(v)) throw v; return str(v); };
  var B = function (v) { var x = bool(v); if (isErr(x)) throw x; return x; };
  var sc = function (v) { return v instanceof Range ? (v.rows() === 1 && v.cols() === 1 ? v.get(0, 0) : ERR["#VALUE!"]) : Array.isArray(v) ? v[0][0] : v; };
  var sum = function (a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; };
  var round = function (x, d) { var p = Math.pow(10, d), y = Math.abs(x) * p; y = Math.round(y + 1e-9 * Math.max(1, y)); return (x < 0 ? -y : y) / p; };

  // 数学
  def("SUM", guard(function (a) { return sum(nums(a)); }));
  def("PRODUCT", guard(function (a) { var n = nums(a); return n.length ? n.reduce(function (x, y) { return x * y; }, 1) : 0; }));
  def("AVERAGE", guard(function (a) { var n = nums(a); return n.length ? sum(n) / n.length : ERR["#DIV/0!"]; }));
  def("AVERAGEA", guard(function (a) { var n = nums(a, { countBool: true }); return n.length ? sum(n) / n.length : ERR["#DIV/0!"]; }));
  def("MIN", guard(function (a) { var n = nums(a); return n.length ? Math.min.apply(null, n) : 0; }));
  def("MAX", guard(function (a) { var n = nums(a); return n.length ? Math.max.apply(null, n) : 0; }));
  def("COUNT", guard(function (a) { return flat(a).filter(function (x) { return typeof x === "number"; }).length; }));
  def("COUNTA", guard(function (a) { return flat(a).filter(function (x) { return x !== null && x !== undefined && x !== ""; }).length; }));
  def("COUNTBLANK", guard(function (a) { return a[0] instanceof Range ? rangeCells(a[0]).length + (a[0].rows() * a[0].cols() - rangeCells(a[0]).length) - rangeCells(a[0]).filter(function (x) { return x.v !== null && x.v !== undefined && x.v !== ""; }).length : 0; }));
  def("ABS", guard(function (a) { return Math.abs(N(sc(a[0]))); }));
  def("ROUND", guard(function (a) { return round(N(sc(a[0])), a.length > 1 ? Math.trunc(N(sc(a[1]))) : 0); }));
  def("ROUNDUP", guard(function (a) { var x = N(sc(a[0])), d = a.length > 1 ? Math.trunc(N(sc(a[1]))) : 0, p = Math.pow(10, d), y = Math.abs(x) * p; y = Math.ceil(y - 1e-9 * Math.max(1, y)); return (x < 0 ? -y : y) / p; }));
  def("ROUNDDOWN TRUNC", guard(function (a) { var x = N(sc(a[0])), d = a.length > 1 ? Math.trunc(N(sc(a[1]))) : 0, p = Math.pow(10, d), y = Math.abs(x) * p; y = Math.floor(y + 1e-9 * Math.max(1, y)); return (x < 0 ? -y : y) / p; }));
  def("INT", guard(function (a) { return Math.floor(N(sc(a[0]))); }));
  def("MOD", guard(function (a) { var x = N(sc(a[0])), y = N(sc(a[1])); if (y === 0) return ERR["#DIV/0!"]; var r = x - y * Math.floor(x / y); return Math.abs(r) < 1e-12 ? 0 : r; }));
  def("POWER", guard(function (a) { return op1("^", N(sc(a[0])), N(sc(a[1]))); }));
  def("SQRT", guard(function (a) { var x = N(sc(a[0])); return x < 0 ? ERR["#NUM!"] : Math.sqrt(x); }));
  def("EXP", guard(function (a) { return Math.exp(N(sc(a[0]))); }));
  def("LN", guard(function (a) { var x = N(sc(a[0])); return x <= 0 ? ERR["#NUM!"] : Math.log(x); }));
  def("LOG10", guard(function (a) { var x = N(sc(a[0])); return x <= 0 ? ERR["#NUM!"] : Math.log10(x); }));
  def("LOG", guard(function (a) { var x = N(sc(a[0])), b = a.length > 1 ? N(sc(a[1])) : 10; return x <= 0 || b <= 0 || b === 1 ? ERR["#NUM!"] : Math.log(x) / Math.log(b); }));
  def("PI", function () { return Math.PI; });
  def("RAND", function () { return Math.random(); });
  def("RANDBETWEEN", guard(function (a) { var lo = Math.ceil(N(sc(a[0]))), hi = Math.floor(N(sc(a[1]))); return hi < lo ? ERR["#NUM!"] : lo + Math.floor(Math.random() * (hi - lo + 1)); }));
  def("SIGN", guard(function (a) { var x = N(sc(a[0])); return x > 0 ? 1 : x < 0 ? -1 : 0; }));
  def("CEILING CEILING.MATH", guard(function (a) { var x = N(sc(a[0])), s = a.length > 1 && a[1] !== null ? N(sc(a[1])) : 1; if (s === 0) return 0; return Math.ceil(x / s - 1e-12) * s; }));
  def("FLOOR FLOOR.MATH", guard(function (a) { var x = N(sc(a[0])), s = a.length > 1 && a[1] !== null ? N(sc(a[1])) : 1; if (s === 0) return ERR["#DIV/0!"]; return Math.floor(x / s + 1e-12) * s; }));
  def("MROUND", guard(function (a) { var x = N(sc(a[0])), s = N(sc(a[1])); if (s === 0) return 0; if (x * s < 0) return ERR["#NUM!"]; return round(x / s, 0) * s; }));
  def("EVEN", guard(function (a) { var x = N(sc(a[0])), y = Math.ceil(Math.abs(x) / 2) * 2; return x < 0 ? -y : y; }));
  def("ODD", guard(function (a) { var x = N(sc(a[0])), y = Math.ceil(Math.abs(x)); if (y % 2 === 0) y++; return x < 0 ? -y : y; }));
  def("FACT", guard(function (a) { var x = Math.floor(N(sc(a[0]))); if (x < 0) return ERR["#NUM!"]; var f = 1; for (var i = 2; i <= x; i++) f *= i; return f; }));
  def("GCD", guard(function (a) { var g = function (x, y) { return y ? g(y, x % y) : x; }; return nums(a).map(Math.floor).reduce(g, 0); }));
  def("LCM", guard(function (a) { var g = function (x, y) { return y ? g(y, x % y) : x; }; return nums(a).map(Math.floor).reduce(function (x, y) { return x && y ? x * y / g(x, y) : 0; }, 1); }));
  def("SUMPRODUCT", guard(function (a) {
    if (!a.length) return ERR["#VALUE!"];
    var grids = a.map(function (x) { return toGrid(x) || [[x]]; }), R = grids[0].length, C = grids[0][0].length, s = 0;
    for (var g = 1; g < grids.length; g++) if (grids[g].length !== R || grids[g][0].length !== C) return ERR["#VALUE!"];
    for (var i = 0; i < R; i++) for (var j = 0; j < C; j++) {
      var p = 1;
      for (var k = 0; k < grids.length; k++) { var v = grids[k][i][j]; if (isErr(v)) return v; p *= typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : 0; }
      s += p;
    }
    return s;
  }));
  def("SUMSQ", guard(function (a) { return nums(a).reduce(function (s, x) { return s + x * x; }, 0); }));
  // 统计
  def("MEDIAN", guard(function (a) { var n = nums(a).sort(function (x, y) { return x - y; }); if (!n.length) return ERR["#NUM!"]; var h = n.length >> 1; return n.length % 2 ? n[h] : (n[h - 1] + n[h]) / 2; }));
  def("MODE MODE.SNGL", guard(function (a) { var n = nums(a), cnt = {}, best = null, bc = 1; n.forEach(function (x) { cnt[x] = (cnt[x] || 0) + 1; if (cnt[x] > bc) { bc = cnt[x]; best = x; } }); return best === null ? ERR["#N/A"] : best; }));
  var variance = function (n, samp) { if (n.length < (samp ? 2 : 1)) return ERR["#DIV/0!"]; var m = sum(n) / n.length; return n.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (n.length - (samp ? 1 : 0)); };
  def("VAR VAR.S", guard(function (a) { return variance(nums(a), true); }));
  def("VARP VAR.P", guard(function (a) { return variance(nums(a), false); }));
  def("STDEV STDEV.S", guard(function (a) { var v = variance(nums(a), true); return isErr(v) ? v : Math.sqrt(v); }));
  def("STDEVP STDEV.P", guard(function (a) { var v = variance(nums(a), false); return isErr(v) ? v : Math.sqrt(v); }));
  def("LARGE", guard(function (a) { var n = nums([a[0]]).sort(function (x, y) { return y - x; }), k = Math.ceil(N(sc(a[1]))); return k < 1 || k > n.length ? ERR["#NUM!"] : n[k - 1]; }));
  def("SMALL", guard(function (a) { var n = nums([a[0]]).sort(function (x, y) { return x - y; }), k = Math.ceil(N(sc(a[1]))); return k < 1 || k > n.length ? ERR["#NUM!"] : n[k - 1]; }));
  def("RANK RANK.EQ", guard(function (a) { var x = N(sc(a[0])), n = nums([a[1]]), asc = a.length > 2 && a[2] !== null && N(sc(a[2])) !== 0; if (n.indexOf(x) < 0) return ERR["#N/A"]; return 1 + n.filter(function (y) { return asc ? y < x : y > x; }).length; }));
  def("PERCENTILE PERCENTILE.INC", guard(function (a) { var n = nums([a[0]]).sort(function (x, y) { return x - y; }), k = N(sc(a[1])); if (!n.length || k < 0 || k > 1) return ERR["#NUM!"]; var pos = k * (n.length - 1), lo = Math.floor(pos); return lo + 1 < n.length ? n[lo] + (pos - lo) * (n[lo + 1] - n[lo]) : n[lo]; }));
  def("QUARTILE QUARTILE.INC", guard(function (a) { return FN.PERCENTILE([a[0], N(sc(a[1])) / 4]); }));
  // 条件汇总
  function condPairs(a, start) { var pairs = []; for (var i = start; i + 1 < a.length; i += 2) pairs.push({ range: a[i], test: criteria(sc(a[i + 1])) }); return pairs; }
  function condMatch(pairs, i, j) { return pairs.every(function (p) { return p.test(at(p.range, i, j)); }); }
  def("SUMIF", guard(function (a) {
    var test = criteria(sc(a[1])), tgt = a.length > 2 && a[2] !== null ? a[2] : a[0], s = 0;
    rangeCells(a[0]).forEach(function (x) { if (test(x.v)) { var y = at(tgt, x.i, x.j); if (typeof y === "number") s += y; } });
    return s;
  }));
  def("SUMIFS", guard(function (a) { var pairs = condPairs(a, 1), s = 0; rangeCells(a[0]).forEach(function (x) { if (typeof x.v === "number" && condMatch(pairs, x.i, x.j)) s += x.v; }); return s; }));
  def("COUNTIF", guard(function (a) { var test = criteria(sc(a[1])), n = 0, d = dims(a[0]); for (var i = 0; i < d.r; i++) for (var j = 0; j < d.c; j++) { var v = at(a[0], i, j); if (test(v)) n++; } return n; }));
  def("COUNTIFS", guard(function (a) { var pairs = condPairs(a, 0), n = 0, d = dims(a[0]); for (var i = 0; i < d.r; i++) for (var j = 0; j < d.c; j++) if (condMatch(pairs, i, j)) n++; return n; }));
  def("AVERAGEIF", guard(function (a) {
    var test = criteria(sc(a[1])), tgt = a.length > 2 && a[2] !== null ? a[2] : a[0], s = 0, n = 0;
    rangeCells(a[0]).forEach(function (x) { if (test(x.v)) { var y = at(tgt, x.i, x.j); if (typeof y === "number") { s += y; n++; } } });
    return n ? s / n : ERR["#DIV/0!"];
  }));
  def("AVERAGEIFS", guard(function (a) { var pairs = condPairs(a, 1), s = 0, n = 0; rangeCells(a[0]).forEach(function (x) { if (typeof x.v === "number" && condMatch(pairs, x.i, x.j)) { s += x.v; n++; } }); return n ? s / n : ERR["#DIV/0!"]; }));
  def("MAXIFS", guard(function (a) { var pairs = condPairs(a, 1), best = null; rangeCells(a[0]).forEach(function (x) { if (typeof x.v === "number" && condMatch(pairs, x.i, x.j) && (best === null || x.v > best)) best = x.v; }); return best === null ? 0 : best; }));
  def("MINIFS", guard(function (a) { var pairs = condPairs(a, 1), best = null; rangeCells(a[0]).forEach(function (x) { if (typeof x.v === "number" && condMatch(pairs, x.i, x.j) && (best === null || x.v < best)) best = x.v; }); return best === null ? 0 : best; }));
  // 逻辑（IF / IFERROR / AND / OR 懒求值：没走到的分支不算，避免无谓的错误）
  lazy("IF", function (args, ctx) {
    var c = scalarize(ev(args[0], ctx), ctx);
    if (isErr(c)) return c;
    var t = bool(c);
    if (isErr(t)) return t;
    if (t) return args.length > 1 ? (args[1].t === "missing" ? 0 : ev(args[1], ctx)) : true;
    return args.length > 2 ? (args[2].t === "missing" ? 0 : ev(args[2], ctx)) : false;
  });
  lazy("IFS", function (args, ctx) {
    for (var i = 0; i + 1 < args.length; i += 2) { var c = scalarize(ev(args[i], ctx), ctx); if (isErr(c)) return c; var t = bool(c); if (isErr(t)) return t; if (t) return ev(args[i + 1], ctx); }
    return ERR["#N/A"];
  });
  lazy("IFERROR", function (args, ctx) { var v = scalarize(ev(args[0], ctx), ctx); return isErr(v) ? (args.length > 1 ? ev(args[1], ctx) : 0) : v; });
  lazy("IFNA", function (args, ctx) { var v = scalarize(ev(args[0], ctx), ctx); return isErr(v) && v.code === "#N/A" ? ev(args[1], ctx) : v; });
  def("AND", guard(function (a) { var any = false, res = true; flat(a).forEach(function (x) { if (x === null || x === undefined || typeof x === "string") return; if (isErr(x)) throw x; any = true; if (!bool(x)) res = false; }); return any ? res : ERR["#VALUE!"]; }));
  def("OR", guard(function (a) { var any = false, res = false; flat(a).forEach(function (x) { if (x === null || x === undefined || typeof x === "string") return; if (isErr(x)) throw x; any = true; if (bool(x)) res = true; }); return any ? res : ERR["#VALUE!"]; }));
  def("XOR", guard(function (a) { var n = 0; flat(a).forEach(function (x) { if (x === null || x === undefined || typeof x === "string") return; if (isErr(x)) throw x; if (bool(x)) n++; }); return n % 2 === 1; }));
  def("NOT", guard(function (a) { return !B(sc(a[0])); }));
  def("TRUE", function () { return true; });
  def("FALSE", function () { return false; });
  lazy("SWITCH", function (args, ctx) {
    var v = scalarize(ev(args[0], ctx), ctx);
    if (isErr(v)) return v;
    for (var i = 1; i + 1 < args.length; i += 2) { var c = scalarize(ev(args[i], ctx), ctx); if (compare(v, c) === 0 && typeRank(v) === typeRank(c)) return ev(args[i + 1], ctx); }
    return args.length % 2 === 0 ? ev(args[args.length - 1], ctx) : ERR["#N/A"];
  });
  def("CHOOSE", guard(function (a) { var i = Math.floor(N(sc(a[0]))); return i < 1 || i >= a.length ? ERR["#VALUE!"] : a[i]; }));
  // 查找
  function matchIndex(needle, list, mode) { // mode：0 精确（支持通配），1 小于等于的最大（已升序），-1 大于等于的最小（已降序）
    if (mode === 0) {
      var wild = typeof needle === "string" && /[*?]/.test(needle), test = wild ? criteria("=" + needle) : null;
      for (var i = 0; i < list.length; i++) { var v = list[i]; if (wild ? test(v) : (compare(v, needle) === 0 && typeRank(v) === typeRank(needle))) return i; }
      return -1;
    }
    var best = -1;
    for (var k = 0; k < list.length; k++) {
      var x = list[k];
      if (x === null || x === undefined || typeRank(x) !== typeRank(needle)) continue;
      var c = compare(x, needle);
      if (mode === 1) { if (c <= 0) best = k; else break; }
      else { if (c >= 0) best = k; else break; }
    }
    return best;
  }
  def("VLOOKUP", guard(function (a) {
    var needle = sc(a[0]); if (isErr(needle)) return needle;
    var tbl = a[1], col = Math.floor(N(sc(a[2]))), approx = a.length > 3 && a[3] !== null ? B(sc(a[3])) : true, d = dims(tbl);
    if (col < 1 || col > d.c) return ERR["#REF!"];
    var first = []; for (var i = 0; i < d.r; i++) first.push(at(tbl, i, 0));
    var idx = matchIndex(needle, first, approx ? 1 : 0);
    return idx < 0 ? ERR["#N/A"] : nz(at(tbl, idx, col - 1));
  }));
  def("HLOOKUP", guard(function (a) {
    var needle = sc(a[0]); if (isErr(needle)) return needle;
    var tbl = a[1], row = Math.floor(N(sc(a[2]))), approx = a.length > 3 && a[3] !== null ? B(sc(a[3])) : true, d = dims(tbl);
    if (row < 1 || row > d.r) return ERR["#REF!"];
    var first = []; for (var j = 0; j < d.c; j++) first.push(at(tbl, 0, j));
    var idx = matchIndex(needle, first, approx ? 1 : 0);
    return idx < 0 ? ERR["#N/A"] : nz(at(tbl, row - 1, idx));
  }));
  var nz = function (v) { return v === null || v === undefined ? 0 : v; };
  def("MATCH", guard(function (a) {
    var needle = sc(a[0]); if (isErr(needle)) return needle;
    var list = flatAll(a[1]), mode = a.length > 2 && a[2] !== null ? Math.sign(N(sc(a[2]))) : 1;
    var idx = matchIndex(needle, list, mode);
    return idx < 0 ? ERR["#N/A"] : idx + 1;
  }));
  def("XMATCH", guard(function (a) {
    var needle = sc(a[0]), list = flatAll(a[1]), mode = a.length > 2 && a[2] !== null ? N(sc(a[2])) : 0, search = a.length > 3 && a[3] !== null ? N(sc(a[3])) : 1;
    var idx = xfind(needle, list, mode, search);
    return idx < 0 ? ERR["#N/A"] : idx + 1;
  }));
  function xfind(needle, list, mode, search) {
    var order = []; for (var i = 0; i < list.length; i++) order.push(i);
    if (search < 0) order.reverse();
    var best = -1;
    for (var k = 0; k < order.length; k++) {
      var j = order[k], v = list[j];
      if (mode === 2) { if (typeof needle === "string" ? criteria("=" + needle)(v) : compare(v, needle) === 0) return j; continue; }
      if (compare(v, needle) === 0 && typeRank(v) === typeRank(needle)) return j;
      if (mode === -1 && typeRank(v) === typeRank(needle) && compare(v, needle) < 0 && (best < 0 || compare(v, list[best]) > 0)) best = j;
      if (mode === 1 && typeRank(v) === typeRank(needle) && compare(v, needle) > 0 && (best < 0 || compare(v, list[best]) < 0)) best = j;
    }
    return mode === 0 || mode === 2 ? -1 : best;
  }
  def("XLOOKUP", guard(function (a) {
    var needle = sc(a[0]); if (isErr(needle)) return needle;
    var look = flatAll(a[1]), ret = a[2], mode = a.length > 4 && a[4] !== null ? N(sc(a[4])) : 0, search = a.length > 5 && a[5] !== null ? N(sc(a[5])) : 1;
    var idx = xfind(needle, look, mode, search);
    if (idx < 0) return a.length > 3 && a[3] !== null ? a[3] : ERR["#N/A"];
    var dl = dims(a[1]), dr = dims(ret);
    if (dl.c === 1) { // 竖着找：返回同一行（返回区域可以有多列：取第一列）
      return dr.c === 1 ? nz(at(ret, idx, 0)) : (function () { var row = []; for (var j = 0; j < dr.c; j++) row.push(nz(at(ret, idx, j))); return [row]; })();
    }
    return dr.r === 1 ? nz(at(ret, 0, idx)) : (function () { var col = []; for (var i = 0; i < dr.r; i++) col.push([nz(at(ret, i, idx))]); return col; })();
  }));
  def("INDEX", guard(function (a) {
    var tbl = a[0], d = dims(tbl), r = a.length > 1 && a[1] !== null ? Math.floor(N(sc(a[1]))) : 0, c = a.length > 2 && a[2] !== null ? Math.floor(N(sc(a[2]))) : 0;
    if (d.r === 1 && a.length === 2) { c = r; r = 1; }
    if (r < 0 || c < 0 || r > d.r || c > d.c) return ERR["#REF!"];
    if (r === 0 && c === 0) return tbl;
    if (tbl instanceof Range) {
      if (r === 0) return new Range(tbl.sheet, tbl.r1, tbl.c1 + c - 1, tbl.r2, tbl.c1 + c - 1, tbl.ctx);
      if (c === 0) return d.c === 1 ? nz(tbl.get(r - 1, 0)) : new Range(tbl.sheet, tbl.r1 + r - 1, tbl.c1, tbl.r1 + r - 1, tbl.c2, tbl.ctx);
      return nz(tbl.get(r - 1, c - 1));
    }
    return nz(at(tbl, (r || 1) - 1, (c || 1) - 1));
  }));
  lazy("ROW", function (args, ctx) { if (!args.length) return ctx.r + 1; var n = args[0]; return n.t === "ref" ? n.r + 1 : n.t === "range" ? n.r1 + 1 : ERR["#VALUE!"]; });
  lazy("COLUMN", function (args, ctx) { if (!args.length) return ctx.c + 1; var n = args[0]; return n.t === "ref" ? n.c + 1 : n.t === "range" ? n.c1 + 1 : ERR["#VALUE!"]; });
  def("ROWS", guard(function (a) { return dims(a[0]).r; }));
  def("COLUMNS", guard(function (a) { return dims(a[0]).c; }));
  lazy("ADDRESS", function (args, ctx) { var a = args.map(function (x) { return scalarize(ev(x, ctx), ctx); }); var r = N(a[0]), c = N(a[1]), abs = a.length > 2 && a[2] !== null ? N(a[2]) : 1; return (abs === 1 || abs === 3 ? "$" : "") + colName(c - 1) + (abs === 1 || abs === 2 ? "$" : "") + r; });
  def("TRANSPOSE", guard(function (a) { var g = toGrid(a[0]) || [[a[0]]], out = []; for (var j = 0; j < g[0].length; j++) { var row = []; for (var i = 0; i < g.length; i++) row.push(g[i][j]); out.push(row); } return out; }));
  // 文本
  def("LEN", guard(function (a) { return S(sc(a[0])).length; }));
  def("LEFT", guard(function (a) { var s = S(sc(a[0])), n = a.length > 1 ? N(sc(a[1])) : 1; return n < 0 ? ERR["#VALUE!"] : s.slice(0, n); }));
  def("RIGHT", guard(function (a) { var s = S(sc(a[0])), n = a.length > 1 ? N(sc(a[1])) : 1; return n < 0 ? ERR["#VALUE!"] : n === 0 ? "" : s.slice(-n); }));
  def("MID", guard(function (a) { var s = S(sc(a[0])), st = N(sc(a[1])), n = N(sc(a[2])); return st < 1 || n < 0 ? ERR["#VALUE!"] : s.substr(st - 1, n); }));
  def("UPPER", guard(function (a) { return S(sc(a[0])).toUpperCase(); }));
  def("LOWER", guard(function (a) { return S(sc(a[0])).toLowerCase(); }));
  def("PROPER", guard(function (a) { return S(sc(a[0])).toLowerCase().replace(/(^|[^a-z'])([a-z])/g, function (m, p, c) { return p + c.toUpperCase(); }); }));
  def("TRIM", guard(function (a) { return S(sc(a[0])).replace(/ +/g, " ").trim(); }));
  def("CLEAN", guard(function (a) { return S(sc(a[0])).replace(/[\x00-\x1f]/g, ""); }));
  def("CONCAT CONCATENATE", guard(function (a) { return flat(a).map(function (x) { if (isErr(x)) throw x; return str(x); }).join(""); }));
  def("TEXTJOIN", guard(function (a) { var sep = S(sc(a[0])), skip = B(sc(a[1])); return flat(a.slice(2)).filter(function (x) { if (isErr(x)) throw x; return !(skip && (x === null || x === undefined || x === "")); }).map(str).join(sep); }));
  def("REPT", guard(function (a) { var n = Math.floor(N(sc(a[1]))); return n < 0 ? ERR["#VALUE!"] : S(sc(a[0])).repeat(n); }));
  def("SUBSTITUTE", guard(function (a) {
    var s = S(sc(a[0])), from = S(sc(a[1])), to = S(sc(a[2]));
    if (!from) return s;
    if (a.length > 3 && a[3] !== null) { var k = Math.floor(N(sc(a[3]))), idx = -1; for (var i = 0; i < k; i++) { idx = s.indexOf(from, idx + 1); if (idx < 0) return s; } return s.slice(0, idx) + to + s.slice(idx + from.length); }
    return s.split(from).join(to);
  }));
  def("REPLACE", guard(function (a) { var s = S(sc(a[0])), st = N(sc(a[1])), n = N(sc(a[2])); return s.slice(0, st - 1) + S(sc(a[3])) + s.slice(st - 1 + n); }));
  def("FIND", guard(function (a) { var f = S(sc(a[0])), s = S(sc(a[1])), st = a.length > 2 ? N(sc(a[2])) : 1, i = s.indexOf(f, st - 1); return i < 0 ? ERR["#VALUE!"] : i + 1; }));
  def("SEARCH", guard(function (a) {
    var f = S(sc(a[0])), s = S(sc(a[1])), st = a.length > 2 ? N(sc(a[2])) : 1;
    var re = new RegExp(f.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[\\s\\S]*").replace(/\?/g, "[\\s\\S]"), "i"), m = re.exec(s.slice(st - 1));
    return m ? m.index + st : ERR["#VALUE!"];
  }));
  def("EXACT", guard(function (a) { return S(sc(a[0])) === S(sc(a[1])); }));
  def("CHAR UNICHAR", guard(function (a) { return String.fromCodePoint(Math.floor(N(sc(a[0])))); }));
  def("CODE UNICODE", guard(function (a) { var s = S(sc(a[0])); return s ? s.codePointAt(0) : ERR["#VALUE!"]; }));
  def("VALUE NUMBERVALUE", guard(function (a) { var v = sc(a[0]); if (typeof v === "number") return v; var p = parseInput(S(v)); return typeof p.v === "number" ? p.v : ERR["#VALUE!"]; }));
  def("TEXT", guard(function (a) { var v = sc(a[0]); if (isErr(v)) throw v; return format(v, S(sc(a[1]))).text; }));
  def("FIXED", guard(function (a) { var x = N(sc(a[0])), d = a.length > 1 && a[1] !== null ? N(sc(a[1])) : 2, noComma = a.length > 2 && a[2] !== null && B(sc(a[2])); return format(round(x, d), (noComma ? "0" : "#,##0") + (d > 0 ? "." + "0".repeat(d) : "")).text; }));
  def("T", guard(function (a) { var v = sc(a[0]); return typeof v === "string" ? v : ""; }));
  def("N", guard(function (a) { var v = sc(a[0]); return typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : 0; }));
  def("HYPERLINK", guard(function (a) { return a.length > 1 ? sc(a[1]) : sc(a[0]); }));
  // 信息
  def("ISBLANK", function (a) { var v = sc(a[0]); return v === null || v === undefined; });
  def("ISNUMBER", function (a) { return typeof sc(a[0]) === "number"; });
  def("ISTEXT", function (a) { return typeof sc(a[0]) === "string"; });
  def("ISNONTEXT", function (a) { return typeof sc(a[0]) !== "string"; });
  def("ISLOGICAL", function (a) { return typeof sc(a[0]) === "boolean"; });
  def("ISERROR", function (a) { return isErr(sc(a[0])); });
  def("ISERR", function (a) { var v = sc(a[0]); return isErr(v) && v.code !== "#N/A"; });
  def("ISNA", function (a) { var v = sc(a[0]); return isErr(v) && v.code === "#N/A"; });
  def("ISEVEN", guard(function (a) { return Math.floor(Math.abs(N(sc(a[0])))) % 2 === 0; }));
  def("ISODD", guard(function (a) { return Math.floor(Math.abs(N(sc(a[0])))) % 2 === 1; }));
  def("NA", function () { return ERR["#N/A"]; });
  // 日期与时间
  def("DATE", guard(function (a) { var y = Math.floor(N(sc(a[0]))), m = Math.floor(N(sc(a[1]))), d = Math.floor(N(sc(a[2]))); if (y < 1900) y += 1900; var s = serialOf(y, m, d); return s < 0 ? ERR["#NUM!"] : s; }));
  def("TIME", guard(function (a) { var s = (N(sc(a[0])) * 3600 + N(sc(a[1])) * 60 + N(sc(a[2]))) / 86400; return s < 0 ? ERR["#NUM!"] : s - Math.floor(s); }));
  def("TODAY", function () { return todaySerial(); });
  def("NOW", function () { return nowSerial(); });
  def("YEAR", guard(function (a) { return ymdOf(N(sc(a[0]))).y; }));
  def("MONTH", guard(function (a) { return ymdOf(N(sc(a[0]))).m; }));
  def("DAY", guard(function (a) { return ymdOf(N(sc(a[0]))).d; }));
  def("HOUR", guard(function (a) { return timeOf(N(sc(a[0]))).h; }));
  def("MINUTE", guard(function (a) { return timeOf(N(sc(a[0]))).mi; }));
  def("SECOND", guard(function (a) { return timeOf(N(sc(a[0]))).s; }));
  def("WEEKDAY", guard(function (a) {
    var wd = weekday(N(sc(a[0]))), t = a.length > 1 && a[1] !== null ? N(sc(a[1])) : 1; // wd：0 = 周日
    if (t === 1) return wd + 1;
    if (t === 2) return wd === 0 ? 7 : wd;
    if (t === 3) return wd === 0 ? 6 : wd - 1;
    return wd + 1;
  }));
  def("WEEKNUM", guard(function (a) { var s = Math.floor(N(sc(a[0]))), p = ymdOf(s), jan1 = serialOf(p.y, 1, 1), t = a.length > 1 && a[1] !== null ? N(sc(a[1])) : 1, off = t === 2 ? (weekday(jan1) + 6) % 7 : weekday(jan1); return Math.floor((s - jan1 + off) / 7) + 1; }));
  def("DAYS", guard(function (a) { return Math.floor(N(sc(a[0]))) - Math.floor(N(sc(a[1]))); }));
  def("EDATE", guard(function (a) { var p = ymdOf(N(sc(a[0]))), m = Math.floor(N(sc(a[1]))), last = ymdOf(serialOf(p.y, p.m + m + 1, 0)).d; return serialOf(p.y, p.m + m, Math.min(p.d, last)); }));
  def("EOMONTH", guard(function (a) { var p = ymdOf(N(sc(a[0]))), m = Math.floor(N(sc(a[1]))); return serialOf(p.y, p.m + m + 1, 0); }));
  def("DATEDIF", guard(function (a) {
    var s = Math.floor(N(sc(a[0]))), e = Math.floor(N(sc(a[1]))), u = S(sc(a[2])).toUpperCase();
    if (s > e) return ERR["#NUM!"];
    var p = ymdOf(s), q = ymdOf(e), months = (q.y - p.y) * 12 + q.m - p.m - (q.d < p.d ? 1 : 0);
    if (u === "D") return e - s;
    if (u === "M") return months;
    if (u === "Y") return Math.floor(months / 12);
    if (u === "YM") return months % 12;
    if (u === "MD") return q.d >= p.d ? q.d - p.d : e - serialOf(q.y, q.m - 1, p.d);
    if (u === "YD") { var yd = e - serialOf(q.y, p.m, p.d); return yd >= 0 ? yd : e - serialOf(q.y - 1, p.m, p.d); }
    return ERR["#NUM!"];
  }));
  def("NETWORKDAYS", guard(function (a) {
    var s = Math.floor(N(sc(a[0]))), e = Math.floor(N(sc(a[1]))), hol = a.length > 2 ? nums([a[2]]).map(Math.floor) : [], sign = 1;
    if (s > e) { var t = s; s = e; e = t; sign = -1; }
    var n = 0; for (var d = s; d <= e; d++) { var w = weekday(d); if (w !== 0 && w !== 6 && hol.indexOf(d) < 0) n++; }
    return n * sign;
  }));
  def("WORKDAY", guard(function (a) {
    var d = Math.floor(N(sc(a[0]))), k = Math.floor(N(sc(a[1]))), hol = a.length > 2 ? nums([a[2]]).map(Math.floor) : [], step = k < 0 ? -1 : 1;
    while (k !== 0) { d += step; var w = weekday(d); if (w !== 0 && w !== 6 && hol.indexOf(d) < 0) k -= step; }
    return d;
  }));
  def("DATEVALUE", guard(function (a) { var p = parseInput(S(sc(a[0]))); return typeof p.v === "number" && p.kind === "date" ? Math.floor(p.v) : ERR["#VALUE!"]; }));
  def("TIMEVALUE", guard(function (a) { var p = parseInput(S(sc(a[0]))); return typeof p.v === "number" ? p.v - Math.floor(p.v) : ERR["#VALUE!"]; }));
  // 财务（常用的几个）
  def("PMT", guard(function (a) { var r = N(sc(a[0])), n = N(sc(a[1])), pv = N(sc(a[2])), fv = a.length > 3 && a[3] !== null ? N(sc(a[3])) : 0, t = a.length > 4 && a[4] !== null ? N(sc(a[4])) : 0; if (r === 0) return -(pv + fv) / n; var q = Math.pow(1 + r, n); return -(r * (pv * q + fv)) / ((1 + r * t) * (q - 1)); }));
  def("FV", guard(function (a) { var r = N(sc(a[0])), n = N(sc(a[1])), pmt = N(sc(a[2])), pv = a.length > 3 && a[3] !== null ? N(sc(a[3])) : 0, t = a.length > 4 && a[4] !== null ? N(sc(a[4])) : 0; if (r === 0) return -(pv + pmt * n); var q = Math.pow(1 + r, n); return -(pv * q + pmt * (1 + r * t) * (q - 1) / r); }));
  def("PV", guard(function (a) { var r = N(sc(a[0])), n = N(sc(a[1])), pmt = N(sc(a[2])), fv = a.length > 3 && a[3] !== null ? N(sc(a[3])) : 0, t = a.length > 4 && a[4] !== null ? N(sc(a[4])) : 0; if (r === 0) return -(fv + pmt * n); var q = Math.pow(1 + r, n); return -(fv + pmt * (1 + r * t) * (q - 1) / r) / q; }));
  def("NPV", guard(function (a) { var r = N(sc(a[0])), s = 0; nums(a.slice(1)).forEach(function (v, i) { s += v / Math.pow(1 + r, i + 1); }); return s; }));

  // ======== 公式求值的入口：给一个工作簿接口，算一个格子 ========
  // book：{ sheetExists(name), used(name) → {r, c}, raw(name, r, c) → { v, f }（格子里存的：值或公式） }
  // 返回 { get(name, r, c) → 值 }：算过的缓存起来；循环引用 → #CIRC!
  function Calc(book) {
    var cache = new Map(), stack = new Set(), trees = new Map(), self = this;
    this.book = book;
    this.reset = function () { cache.clear(); };
    this.forget = function (keys) { if (!keys) return cache.clear(); keys.forEach(function (k) { cache.delete(k); }); };
    this.tree = function (f) { var t = trees.get(f); if (t === undefined) { try { t = parse(f); } catch (e) { t = e instanceof FxError ? { t: "err", v: e.code } : { t: "err", v: "#NAME?" }; } trees.set(f, t); if (trees.size > 20000) trees.clear(); } return t; };
    this.get = function (sheet, r, c) {
      var key = sheet + "\u0000" + r + "\u0000" + c;
      if (cache.has(key)) return cache.get(key);
      var cell = book.raw(sheet, r, c);
      if (!cell) return null;
      if (cell.f == null) return cell.v === undefined ? null : cell.v;
      if (stack.has(key)) return ERR["#CIRC!"];
      stack.add(key);
      var ctx = { get: self.get, used: book.used, sheet: sheet, r: r, c: c, sheetExists: book.sheetExists };
      var v;
      try { v = evaluate(self.tree(cell.f), ctx); } finally { stack.delete(key); }
      if (typeof v === "number" && !isFinite(v)) v = ERR["#NUM!"];
      if (v === undefined) v = null;
      cache.set(key, v);
      return v;
    };
  }

  // ======== 引用调整：复制 / 填充时平移相对引用；插入 / 删除行列时跟着挪 ========
  // 把记号序列还原成公式文字
  function refText(n) {
    var sh = n.sheet ? quoteSheet(n.sheet) + "!" : "";
    if (n.t === "ref") return sh + (n.ca ? "$" : "") + colName(n.c) + (n.ra ? "$" : "") + (n.r + 1);
    if (n.wholeCol) return sh + (n.ca1 ? "$" : "") + colName(n.c1) + ":" + (n.ca2 ? "$" : "") + colName(n.c2);
    if (n.wholeRow) return sh + (n.ra1 ? "$" : "") + (n.r1 + 1) + ":" + (n.ra2 ? "$" : "") + (n.r2 + 1);
    return sh + (n.ca1 ? "$" : "") + colName(n.c1) + (n.ra1 ? "$" : "") + (n.r1 + 1) + ":" + (n.ca2 ? "$" : "") + colName(n.c2) + (n.ra2 ? "$" : "") + (n.r2 + 1);
  }
  function rebuild(src, mapRef) { // 逐个记号改写（保留原来的空格与大小写，只改引用）
    var s = String(src), out = "", i = 0, n = s.length;
    var refRe = /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_\u4e00-\u9fff][\w.\u4e00-\u9fff]*))!)?(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d+:\$?\d+)(?![\w(])/;
    var prevIsWord = false;
    while (i < n) {
      var ch = s[i];
      if (ch === '"') { var j = i + 1; for (;;) { if (j >= n) break; if (s[j] === '"') { if (s[j + 1] === '"') { j += 2; continue; } break; } j++; } out += s.slice(i, j + 1); i = j + 1; prevIsWord = false; continue; }
      var rest = s.slice(i), m;
      if (!prevIsWord && (m = refRe.exec(rest)) && !/^\d+(\.\d+)?(e[+-]?\d+)?(?![\d:])/i.test(rest)) {
        var node = refNode({ v: m[3], sheet: m[1] != null ? m[1].replace(/''/g, "'") : m[2] || null });
        var repl = mapRef(node);
        out += repl === null ? (node.sheet ? quoteSheet(node.sheet) + "!" : "") + "#REF!" : refText(repl);
        i += m[0].length; prevIsWord = false; continue;
      }
      if ((m = /^[A-Za-z_\u4e00-\u9fff][\w.\u4e00-\u9fff]*/.exec(rest))) { out += m[0]; i += m[0].length; prevIsWord = true; continue; }
      if ((m = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest))) { out += m[0]; i += m[0].length; prevIsWord = false; continue; }
      out += ch; i++; prevIsWord = false;
    }
    return out;
  }
  // 平移：相对的部分加 dr / dc；越界 → #REF!
  function shift(f, dr, dc) {
    return rebuild(f, function (n) {
      var o = Object.assign({}, n);
      if (n.t === "ref") { if (!n.ra) o.r += dr; if (!n.ca) o.c += dc; return o.r < 0 || o.c < 0 || o.r >= MAXR || o.c >= MAXC ? null : o; }
      if (!n.wholeRow) { if (!n.ca1) o.c1 += dc; if (!n.ca2) o.c2 += dc; }
      if (!n.wholeCol) { if (!n.ra1) o.r1 += dr; if (!n.ra2) o.r2 += dr; }
      return o.r1 < 0 || o.c1 < 0 || o.r2 >= MAXR || o.c2 >= MAXC ? null : o;
    });
  }
  // 插入 / 删除：axis "r" | "c"，在 at 处插入 count（删除时 count 为负）；只动指向 sheet 这张表的引用（公式所在的表是 home）
  function adjust(f, home, sheet, axis, at, count) {
    return rebuild(f, function (n) {
      if (String(n.sheet || home).toLowerCase() !== String(sheet).toLowerCase()) return n;
      var o = Object.assign({}, n), del = count < 0, end = at - count - 1; // 删除的是 [at, at + |count| - 1]
      function mv(x) { if (!del) return x >= at ? x + count : x; if (x < at) return x; if (x > end) return x + count; return null; }
      if (n.t === "ref") {
        var k = axis === "r" ? "r" : "c", v = mv(o[k]);
        if (v === null) return null;
        o[k] = v;
        return o;
      }
      var k1 = axis === "r" ? "r1" : "c1", k2 = axis === "r" ? "r2" : "c2";
      if ((axis === "r" && n.wholeCol) || (axis === "c" && n.wholeRow)) return o;
      if (!del) { if (o[k1] >= at) o[k1] += count; if (o[k2] >= at) o[k2] += count; return o; }
      var a1 = o[k1], a2 = o[k2];
      if (a2 < at) return o;
      if (a1 > end) { o[k1] += count; o[k2] += count; return o; }
      if (a1 >= at && a2 <= end) return null; // 整个区域都删了
      o[k1] = a1 < at ? a1 : at;
      o[k2] = a2 > end ? a2 + count : at - 1;
      if (o[k2] < o[k1]) return null;
      return o;
    });
  }
  // 表改名：公式里引用它的表名跟着换
  function renameSheet(f, from, to) { return rebuild(f, function (n) { if (n.sheet === from) { var o = Object.assign({}, n); o.sheet = to; return o; } return n; }); }
  // 公式里引用到的格子 / 区域（高亮用）
  function refsOf(f) {
    var out = [];
    try { rebuild(f, function (n) { out.push(n); return n; }); } catch (e) { /* 不完整的公式 */ }
    return out;
  }

  // ======== 数字格式 ========
  function formatGeneral(v) {
    if (typeof v !== "number") return str(v);
    if (v === 0) return "0";
    var a = Math.abs(v);
    if (a >= 1e11 || a < 1e-9) {
      var e = v.toExponential(5).replace(/\.?0+e/, "e").replace("e+", "E+").replace("e-", "E-");
      return e.replace(/E([+-])(\d)$/, "E$10$2");
    }
    var digits = 10 - Math.floor(Math.log10(a)), s = (Math.round(v * Math.pow(10, Math.max(0, Math.min(digits, 10)))) / Math.pow(10, Math.max(0, Math.min(digits, 10)))).toString();
    if (/e/.test(s)) s = v.toPrecision(10).replace(/\.?0+$/, "");
    return s;
  }
  var fmtCache = new Map();
  // 把格式代码分成节（; 分开，引号、方括号里的不算）
  function sections(code) {
    var out = [], cur = "", q = false, br = false;
    for (var i = 0; i < code.length; i++) {
      var ch = code[i];
      if (ch === '"' && !br) q = !q;
      else if (ch === "\\" && !q && !br) { cur += ch + (code[i + 1] || ""); i++; continue; }
      else if (ch === "[" && !q) br = true;
      else if (ch === "]" && !q) br = false;
      else if (ch === ";" && !q && !br) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }
  var COLORS = { black: "#000000", white: "#ffffff", red: "#ff0000", green: "#00a000", blue: "#0000ff", yellow: "#ffd400", magenta: "#ff00ff", cyan: "#00c0c0" };
  var DAYS_ZH = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"], DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // 一节：解析成 { color, cond, kind: "date"|"num"|"text"|"general", parts }
  function compileSection(sec) {
    var s = { color: null, cond: null, raw: sec, locale: null };
    var body = sec.replace(/\[([^\]]*)\]/g, function (m, inner) {
      var low = inner.toLowerCase();
      if (COLORS[low]) { s.color = COLORS[low]; return ""; }
      if (/^color\s*\d+$/.test(low)) { s.color = null; return ""; }
      var cm = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/.exec(inner);
      if (cm) { s.cond = { op: cm[1], v: parseFloat(cm[2]) }; return ""; }
      if (/^\$/.test(inner)) { var sym = /^\$([^-]*)/.exec(inner)[1]; return sym ? '"' + sym.replace(/"/g, "") + '"' : ""; }
      if (/^(h+|m+|s+)$/i.test(inner)) return "\u0001" + inner.toLowerCase() + "\u0002"; // 累计时长 [h]
      return "";
    });
    s.body = body;
    var plain = body.replace(/"[^"]*"/g, "").replace(/\\./g, "");
    if (/^\s*general\s*$/i.test(plain) || !plain.trim() && !/"/.test(body)) s.kind = plain.trim() || /"/.test(body) ? "num" : "general";
    if (/general/i.test(plain)) s.kind = "general";
    else if (/[ymdhs]|AM\/PM|A\/P|aaa|\u0001/i.test(plain.replace(/E[+-]/gi, ""))) s.kind = "date";
    else if (/[0#?]/.test(plain)) s.kind = "num";
    else if (/@/.test(plain)) s.kind = "text";
    else s.kind = s.kind || "literal";
    return s;
  }
  function compile(code) {
    var c = fmtCache.get(code);
    if (c) return c;
    var secs = sections(code || "General").map(compileSection);
    c = { secs: secs };
    fmtCache.set(code, c);
    if (fmtCache.size > 2000) fmtCache.clear();
    return c;
  }
  // 格式化：→ { text, color }（color 可以没有）
  function format(v, code) {
    if (v === null || v === undefined) return { text: "" };
    if (isErr(v)) return { text: v.code };
    if (typeof v === "boolean") return { text: v ? "TRUE" : "FALSE" };
    if (!code || /^general$/i.test(code)) return { text: typeof v === "number" ? formatGeneral(v) : String(v) };
    var c = compile(code), secs = c.secs, sec;
    if (typeof v === "string") {
      sec = secs.length >= 4 ? secs[3] : secs.find(function (x) { return x.kind === "text"; });
      if (!sec) return { text: v };
      return { text: textSection(sec.body, v), color: sec.color };
    }
    // 选节：有条件的按条件；否则 正;负;零
    var val = v, useAbs = false;
    if (secs.some(function (x) { return x.cond; })) {
      sec = secs.find(function (x) { if (!x.cond) return false; var d = v - x.cond.v, op = x.cond.op; return op === "<" ? d < 0 : op === ">" ? d > 0 : op === "<=" ? d <= 0 : op === ">=" ? d >= 0 : op === "=" ? d === 0 : d !== 0; }) || secs.find(function (x) { return !x.cond && x.kind !== "text"; }) || secs[0];
      useAbs = sec !== secs[0] && v < 0;
    } else if (v < 0 && secs.length >= 2 && secs[1].kind !== "text") { sec = secs[1]; useAbs = true; }
    else if (v === 0 && secs.length >= 3 && secs[2].kind !== "text") sec = secs[2];
    else sec = secs[0];
    if (useAbs) val = Math.abs(v);
    var text;
    if (sec.kind === "general") text = sec.body.replace(/general/i, formatGeneral(val)).replace(/"([^"]*)"/g, "$1");
    else if (sec.kind === "date") text = dateSection(sec.body, val);
    else if (sec.kind === "num") text = numSection(sec.body, val, v < 0 && !useAbs);
    else if (sec.kind === "text") text = textSection(sec.body, formatGeneral(val));
    else text = literal(sec.body);
    return { text: text, color: sec.color };
  }
  function literal(body) { return body.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1").replace(/_./g, " ").replace(/\*./g, ""); }
  function textSection(body, t) {
    var out = "", i = 0;
    while (i < body.length) {
      var ch = body[i];
      if (ch === '"') { var j = body.indexOf('"', i + 1); if (j < 0) j = body.length; out += body.slice(i + 1, j); i = j + 1; continue; }
      if (ch === "\\") { out += body[i + 1] || ""; i += 2; continue; }
      if (ch === "_") { out += " "; i += 2; continue; }
      if (ch === "*") { i += 2; continue; }
      if (ch === "@") { out += t; i++; continue; }
      out += ch; i++;
    }
    return out;
  }
  // 数字节：整数部分 / 小数部分 / 指数；千位分隔、百分比、按千缩放（末尾的逗号）
  function numSection(body, v, keepSign) {
    // 先把字面文字换成占位，最后再放回
    var lits = [], b = body.replace(/"([^"]*)"|\\(.)|_(.)|\*(.)/g, function (m, q, esc, sp) { lits.push(q !== undefined ? q : esc !== undefined ? esc : sp !== undefined ? " " : ""); return String.fromCharCode(0xe000 + lits.length - 1); });
    var fr = /([#0?]*)(\s+)([#0?]+)\/([#0?]+|\d+)/.exec(b) || /()()([#0?]+)\/([#0?]+|\d+)/.exec(b);
    if (fr) return fraction(b, fr, v, keepSign).replace(/[\ue000-\uefff]/g, function (ch) { return lits[ch.charCodeAt(0) - 0xe000]; });
    var pct = (b.match(/%/g) || []).length;
    v = v * Math.pow(100, pct);
    var em = /([0#?.,]*)([eE][+-])([0#?]+)/.exec(b);
    var numPart = em ? em[1] : (b.match(/[0#?][0#?,]*(\.[0#?]*)?|\.[0#?]+/) || [""])[0];
    // 末尾的逗号：每个 ÷1000
    var trail = /,+$/.exec(numPart.replace(/\.[0#?]*$/, "")) ? /,+$/.exec(numPart.replace(/\.[0#?]*$/, ""))[0].length : 0;
    if (!em && trail) { v = v / Math.pow(1000, trail); }
    var intFmt = numPart.split(".")[0].replace(/,+$/, ""), decFmt = numPart.indexOf(".") >= 0 ? numPart.split(".")[1].replace(/,/g, "") : "";
    var thousands = /[0#?],[0#?]/.test(intFmt);
    intFmt = intFmt.replace(/,/g, "");
    var out;
    if (em) {
      var digits = decFmt.length, ex = v === 0 ? 0 : Math.floor(Math.log10(Math.abs(v)));
      var intDigits = Math.max(1, (intFmt.match(/[0#?]/g) || []).length);
      if (intDigits > 1) ex = Math.floor(ex / intDigits) * intDigits;
      var mant = v / Math.pow(10, ex);
      var ms = fmtInt(Math.abs(mant), intFmt || "0", decFmt, false);
      var es = String(Math.abs(ex)), ew = em[3].length;
      while (es.length < ew) es = "0" + es;
      out = (mant < 0 ? "-" : "") + ms + "E" + (ex < 0 ? "-" : em[2][1] === "+" ? "+" : "") + es;
      out = b.replace(em[0], out);
    } else {
      var body2 = fmtInt(Math.abs(v), intFmt, decFmt, thousands);
      out = b.replace(numPart, body2.replace(/\$/g, "$$$$"));
      if (v < 0 && keepSign !== false) out = "-" + out;
    }
    return out.replace(/[\ue000-\uefff]/g, function (ch) { return lits[ch.charCodeAt(0) - 0xe000]; });
  }
  // 分数：# ?/?、# ??/??、?/4
  function fraction(b, fr, v, keepSign) {
    var a = Math.abs(v), whole = fr[1] !== "" || fr[2] !== "", ip = whole ? Math.floor(a) : 0, f = a - ip, num, den;
    if (/^\d+$/.test(fr[4])) { den = +fr[4]; num = Math.round(f * den); }
    else {
      var maxD = Math.pow(10, fr[4].length) - 1, best = 1e9; num = 0; den = 1;
      for (var d = 1; d <= maxD; d++) { var n = Math.round(f * d), e = Math.abs(f - n / d); if (e < best - 1e-12) { best = e; num = n; den = d; } }
    }
    if (whole && num === den) { ip++; num = 0; }
    var w = fr[4].length, fracText = num === 0 && whole ? " ".repeat(fr[3].length + 1 + w) : String(num).padStart(fr[3].length, " ") + "/" + String(den).padEnd(w, " ");
    var intText = whole ? (ip === 0 && !/0/.test(fr[1]) ? "" : String(ip)) : "";
    var out = b.replace(fr[0], intText + (whole ? fr[2] || " " : "") + fracText);
    return (v < 0 && keepSign !== false ? "-" : "") + out;
  }
  function fmtInt(a, intFmt, decFmt, thousands) {
    var dmax = decFmt.length, dmin = (decFmt.match(/0/g) || []).length;
    var fixed = a.toFixed(Math.min(dmax, 20));
    if (/e/.test(fixed)) fixed = a.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
    var ip = fixed.split(".")[0], dp = (fixed.split(".")[1] || "");
    // 小数：# 的位去掉末尾的 0；? 的位补空格
    var d = dp;
    while (d.length > dmin && d[d.length - 1] === "0") d = d.slice(0, -1);
    var qpad = (decFmt.match(/\?/g) || []).length;
    if (d.length < dmax && qpad) d += " ".repeat(Math.min(qpad, dmax - d.length));
    // 整数：0 的位补 0，# 的位不补；0 值且格式里没有 0 → 空
    var need = (intFmt.match(/0/g) || []).length;
    if (ip === "0" && need === 0) ip = "";
    while (ip.length < need) ip = "0" + ip;
    if (thousands && ip) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return ip + (dmax ? (d.length ? "." + d : /0/.test(decFmt) || dmin ? "." : "") : "");
  }
  function dateSection(body, v) {
    if (v < 0) return "#".repeat(8);
    var p = ymdOf(v), t = timeOf(v), ampm = /AM\/PM|A\/P/i.test(body);
    var out = "", i = 0, lastWasHour = false;
    var toks = [];
    while (i < body.length) {
      var ch = body[i], rest = body.slice(i), m;
      if (ch === '"') { var j = body.indexOf('"', i + 1); if (j < 0) j = body.length; toks.push({ lit: body.slice(i + 1, j) }); i = j + 1; continue; }
      if (ch === "\\") { toks.push({ lit: body[i + 1] || "" }); i += 2; continue; }
      if (ch === "_") { toks.push({ lit: " " }); i += 2; continue; }
      if (ch === "*") { i += 2; continue; }
      if (ch === "\u0001") { var e = body.indexOf("\u0002", i); toks.push({ el: body.slice(i + 1, e) }); i = e + 1; continue; }
      if ((m = /^(AM\/PM|am\/pm|A\/P|a\/p)/.exec(rest))) { toks.push({ ap: m[0] }); i += m[0].length; continue; }
      if ((m = /^(y+|m+|d+|h+|s+|aaaa|aaa)/i.exec(rest))) { toks.push({ t: m[0].toLowerCase() }); i += m[0].length; continue; }
      if ((m = /^\.0+/.exec(rest)) && toks.length && toks[toks.length - 1].t && toks[toks.length - 1].t[0] === "s") { toks.push({ frac: m[0].length - 1 }); i += m[0].length; continue; }
      toks.push({ lit: ch }); i++;
    }
    // m 在 h 后面或 s 前面是分钟
    toks.forEach(function (tk, k) {
      if (!tk.t || tk.t[0] !== "m") return;
      var prev = null, nxt = null;
      for (var a = k - 1; a >= 0; a--) if (toks[a].t || toks[a].el) { prev = toks[a].t || toks[a].el; break; }
      for (var b = k + 1; b < toks.length; b++) if (toks[b].t || toks[b].el) { nxt = toks[b].t || toks[b].el; break; }
      if ((prev && prev[0] === "h") || (nxt && nxt[0] === "s")) tk.min = true;
    });
    var two = function (x) { return (x < 10 ? "0" : "") + x; };
    toks.forEach(function (tk) {
      if (tk.lit !== undefined) { out += tk.lit; return; }
      if (tk.ap) { var pm = t.h >= 12; out += tk.ap.length > 3 ? (pm ? "PM" : "AM") : (pm ? "P" : "A"); if (/[a-z]/.test(tk.ap[0])) out = out.slice(0, -tk.ap.replace("/", "").length / 2 | 0) + out.slice(-(tk.ap.length > 3 ? 2 : 1)).toLowerCase(); return; }
      if (tk.el) { var total = v * 24 * (tk.el[0] === "m" ? 60 : tk.el[0] === "s" ? 3600 : 1); out += Math.floor(total + 1e-9); return; }
      if (tk.frac !== undefined) { out += "." + String(Math.round(t.ms / Math.pow(10, 3 - Math.max(1, tk.frac + 1)))).padStart(tk.frac + 1, "0"); return; }
      var k = tk.t;
      if (k[0] === "y") out += k.length <= 2 ? two(p.y % 100) : p.y;
      else if (k[0] === "m" && tk.min) out += k.length >= 2 ? two(t.mi) : t.mi;
      else if (k[0] === "m") out += k.length === 1 ? p.m : k.length === 2 ? two(p.m) : k.length === 3 ? MONTHS_EN[p.m - 1].slice(0, 3) : k.length === 5 ? MONTHS_EN[p.m - 1][0] : MONTHS_EN[p.m - 1];
      else if (k[0] === "a") { var wd2 = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); out += k.length === 4 ? DAYS_ZH[wd2] : DAYS_ZH[wd2].slice(2); }
      else if (k[0] === "d") { var wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); out += k.length === 1 ? p.d : k.length === 2 ? two(p.d) : k.length === 3 ? DAYS_EN[wd].slice(0, 3) : DAYS_EN[wd]; }
      else if (k[0] === "h") { var h = ampm ? (t.h % 12 || 12) : t.h; out += k.length >= 2 ? two(h) : h; }
      else if (k[0] === "s") out += k.length >= 2 ? two(t.s) : t.s;
    });
    return out;
  }

  // ======== 输入识别：打字进格子 → 值（+ 建议的格式）========
  // 数字（1,234.5）、百分比（12%）、货币（¥1,200 / $5 / €3）、科学计数、日期（2026-09-26、2026/9/26、9/26、2026年9月26日）、时间（14:30、2:30 PM）、逻辑值
  function parseInput(text) {
    var s = String(text).trim();
    if (s === "") return { v: null };
    if (s[0] === "'") return { v: s.slice(1), kind: "text" };
    var u = s.toUpperCase();
    if (u === "TRUE" || u === "FALSE") return { v: u === "TRUE", kind: "bool" };
    var m;
    if ((m = /^([-+]?)([¥$€£])?\s*([-+]?)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)\s*(%?)$/.exec(s))) {
      var sign = (m[1] === "-" || m[3] === "-") ? -1 : 1, n = parseFloat(m[4].replace(/,/g, "")) * sign;
      if (m[5]) return { v: n / 100, kind: "num", nf: /\./.test(m[4]) ? "0." + "0".repeat(Math.min(4, m[4].split(".")[1].length)) + "%" : "0%" };
      if (m[2]) { var cur = m[2], dec = /\./.test(m[4]) ? 2 : 0; return { v: n, kind: "num", nf: (cur === "$" ? '"$"' : '"' + cur + '"') + "#,##0" + (dec ? ".00" : "") }; }
      if (/,/.test(m[4])) return { v: n, kind: "num", nf: /\./.test(m[4]) ? "#,##0.00" : "#,##0" };
      return { v: n, kind: "num" };
    }
    if ((m = /^[-+]?(\d+\.?\d*|\.\d+)[eE][-+]?\d+$/.exec(s))) return { v: parseFloat(s), kind: "num", nf: "0.00E+00" };
    // 日期
    var y, mo, d, hasTime = null;
    var tm = /\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|上午|下午)?$/i.exec(s);
    var dpart = tm ? s.slice(0, tm.index) : s;
    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(dpart))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = /^(\d{4})年(\d{1,2})月(\d{1,2})日?$/.exec(dpart))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = /^(\d{1,2})月(\d{1,2})日$/.exec(dpart))) { y = new Date().getFullYear(); mo = +m[1]; d = +m[2]; }
    else if ((m = /^(\d{1,2})[/-](\d{1,2})$/.exec(dpart))) { y = new Date().getFullYear(); mo = +m[1]; d = +m[2]; }
    else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dpart))) { y = +m[3]; mo = +m[1]; d = +m[2]; }
    if (y && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      var ser = serialOf(y, mo, d), nf = /年/.test(dpart) ? 'yyyy"年"m"月"d"日"' : /月/.test(dpart) ? 'm"月"d"日"' : "yyyy-mm-dd";
      if (tm) { var hh = +tm[1] % 24; if (/PM|下午/i.test(tm[4] || "") && hh < 12) hh += 12; if (/AM|上午/i.test(tm[4] || "") && hh === 12) hh = 0; ser += (hh * 3600 + +tm[2] * 60 + (+tm[3] || 0)) / 86400; nf += " hh:mm" + (tm[3] ? ":ss" : ""); }
      return { v: ser, kind: "date", nf: nf };
    }
    if ((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|上午|下午)?$/i.exec(s))) {
      var h2 = +m[1]; if (/PM|下午/i.test(m[4] || "") && h2 < 12) h2 += 12; if (/AM|上午/i.test(m[4] || "") && h2 === 12) h2 = 0;
      if (h2 < 24 && +m[2] < 60) return { v: (h2 * 3600 + +m[2] * 60 + (+m[3] || 0)) / 86400, kind: "time", nf: m[4] ? "h:mm AM/PM" : m[3] ? "hh:mm:ss" : "hh:mm" };
    }
    return { v: s, kind: "text" };
  }
  // 格式代码是日期 / 时间吗（给编辑框显示值用）
  function isDateFormat(code) { if (!code) return false; var c = compile(code); return c.secs[0].kind === "date"; }

  var api = {
    FxError: FxError, ERR: ERR, isErr: isErr,
    colName: colName, colIndex: colIndex, addr: addr, parseAddr: parseAddr, quoteSheet: quoteSheet, MAXR: MAXR, MAXC: MAXC,
    tokenize: tokenize, parse: parse, evaluate: evaluate, Calc: Calc, Range: Range, FN: FN, functionNames: function () { return Object.keys(FN).sort(); },
    shift: shift, adjust: adjust, renameSheet: renameSheet, refsOf: refsOf, mapRefs: rebuild, refText: refText,
    format: format, formatGeneral: formatGeneral, parseInput: parseInput, isDateFormat: isDateFormat, compare: compare,
    serialOf: serialOf, ymdOf: ymdOf, timeOf: timeOf, dateOfJS: dateOfJS, jsDateOf: jsDateOf, todaySerial: todaySerial, nowSerial: nowSerial,
    str: str, num: num,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TSU_FX = api;
})(typeof window !== "undefined" ? window : this);
