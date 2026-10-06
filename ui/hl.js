// hl.js —— 代码高亮（编辑器 ide.js、Paimon Terminal 的文件面板共用）：逐行扫描，行与行之间只传一个状态串（块注释 / 多行字符串 / Markdown 代码块）。
// 出来的是带 class 的 HTML（ide-k 关键字、ide-d 声明、ide-f 函数名、ide-s 字符串、ide-c 注释、ide-n 数字 / 常量、ide-v 变量、ide-h 标题……，颜色在 ide.css）。
// 对外：window.TSU_HL = { LANG, langOf(路径), langName(路径), line(一行, 状态, LANG[语言]) → [html, 下一行的状态] }
(function () {
  "use strict";
  var baseOf = function (p) { return p === "/" ? "/" : p.slice(p.lastIndexOf("/") + 1); };
  var extOf = function (n) { var i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var Wd = function (s) { var o = {}; s.split(" ").forEach(function (k) { if (k) o[k] = 1; }); return o; };
  var JSKW = "break case catch continue debugger default delete do else export extends finally for from if import in instanceof new of return super switch throw try typeof void while with yield async await static get set as";
  var CKW = "if else for while do switch case default break continue return goto sizeof typedef struct union enum static const extern volatile inline new delete class public private protected virtual override template typename namespace using try catch throw import package func go defer select chan map range type interface fn let mut impl trait pub use mod match where loop as crate super async await dyn move ref unsafe extends implements final abstract synchronized throws instanceof var val when object";
  var LANG = {
    python: { name: "Python", unit: 4, lc: ["#"], ml: ['"""', "'''"], q: "\"'", kw: Wd("and as assert async await break continue del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case"),
      decl: Wd("def class"), cons: Wd("True False None"), fnAfter: Wd("def class"), deco: true, pfx: true, cmt: "# ", run: "python" },
    javascript: { name: "JavaScript", unit: 2, lc: ["//"], bc: [["/*", "*/"]], q: "\"'`", mlq: "`", kw: Wd(JSKW), decl: Wd("const let var function class"),
      cons: Wd("true false null undefined NaN Infinity this"), fnAfter: Wd("function class"), cmt: "// ", run: "node" },
    json: { name: "JSON", unit: 2, q: "\"", keyStr: true, kw: {}, decl: {}, cons: Wd("true false null") },
    shell: { name: "Shell", unit: 2, lc: ["#"], lcWs: true, q: "\"'", sh: true, kw: Wd("if then else elif fi for while until do done case esac in function return export local select break continue"),
      decl: {}, cons: {}, cmt: "# ", run: "sh" },
    css: { name: "CSS", unit: 2, bc: [["/*", "*/"]], q: "\"'", prop: true, css: true, kw: Wd("important"), decl: {}, cons: {} },
    c: { name: "C", unit: 4, lc: ["//"], bc: [["/*", "*/"]], q: "\"'", kw: Wd(CKW), decl: Wd("int char void float double long short unsigned signed bool auto string i32 i64 u8 u32 u64 f32 f64 usize String boolean byte"),
      cons: Wd("true false null NULL nullptr nil None Some Ok Err this self"), fnAfter: Wd("fn func class struct enum trait interface"), pre: true, cmt: "// " },
    yaml: { name: "YAML", unit: 2, lc: ["#"], lcWs: true, q: "\"'", yaml: true, kw: {}, decl: {}, cons: Wd("true false null yes no on off"), cmt: "# " },
    markdown: { name: "Markdown", unit: 2, md: true },
    html: { name: "HTML", unit: 2, html: true },
    text: { name: "纯文本", unit: 4, plain: true },
  };
  LANG.typescript = Object.assign({}, LANG.javascript, { name: "TypeScript", run: "", kw: Wd(JSKW + " implements private public protected readonly declare namespace abstract keyof satisfies"),
    decl: Wd("const let var function class interface type enum"), fnAfter: Wd("function class interface type enum") });
  var EXT = { py: "python", pyw: "python", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", json: "json",
    sh: "shell", bash: "shell", zsh: "shell", css: "css", scss: "css", less: "css", html: "html", htm: "html", xml: "html", svg: "html", vue: "html", md: "markdown", markdown: "markdown",
    c: "c", h: "c", cpp: "c", cc: "c", hpp: "c", java: "c", go: "c", rs: "c", cs: "c", swift: "c", kt: "c", yml: "yaml", yaml: "yaml", toml: "yaml", ini: "yaml" };
  var LNAME = { h: "C", cpp: "C++", cc: "C++", hpp: "C++", java: "Java", go: "Go", rs: "Rust", cs: "C#", swift: "Swift", kt: "Kotlin", toml: "TOML", ini: "INI", xml: "XML", svg: "SVG", vue: "Vue", scss: "SCSS", less: "Less", jsx: "JSX", tsx: "TSX" };
  var langOf = function (p) { return EXT[extOf(baseOf(p))] || (/^(Makefile|Dockerfile)$/.test(baseOf(p)) ? "shell" : "text"); };
  var langName = function (p) { return LNAME[extOf(baseOf(p))] || LANG[langOf(p)].name; };

  var NUM = /^(0[xX][0-9a-fA-F_]+|0[bBoO][0-7_]+|\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)[a-zA-Z%]*/;
  var span = function (cls, text) { return cls ? '<span class="ide-' + cls + '">' + esc(text) + "</span>" : esc(text); };
  function startsAny(line, i, list) { for (var k = 0; k < list.length; k++) if (line.startsWith(list[k], i)) return list[k]; return ""; }
  function findEnd(line, i, tok, escapes) {
    for (var j = i; j <= line.length - tok.length; j++) {
      if (escapes && line[j] === "\\") { j++; continue; }
      if (line.startsWith(tok, j)) return j;
    }
    return -1;
  }
  // 代码：注释 k 关键字、d 声明、f 函数名、s 字符串、c 注释、n 数字 / 常量、v 变量（shell）
  function hlCode(line, st, L) {
    var out = "", i = 0, n = line.length, prev = "", cmd = true, m, j, k;
    var startRe = L.sh ? /[A-Za-z_.\/~]/ : L.css ? /[A-Za-z_-]/ : /[A-Za-z_$]/, idRe = L.sh ? /[\w.\/+~-]/ : L.css ? /[\w-]/ : /[\w$]/;
    while (i < n) {
      var c = line[i];
      if (st) { // 接着上一行的块注释 / 多行字符串
        var endTok = st.slice(2), cls0 = st[0] === "c" ? "c" : "s";
        j = findEnd(line, i, endTok, cls0 === "s");
        if (j < 0) return [out + span(cls0, line.slice(i)), st];
        out += span(cls0, line.slice(i, j + endTok.length));
        i = j + endTok.length;
        st = "";
        continue;
      }
      if (c === " " || c === "\t") { j = i; while (j < n && (line[j] === " " || line[j] === "\t")) j++; out += line.slice(i, j); i = j; continue; }
      if (L.lc && startsAny(line, i, L.lc) && (!L.lcWs || i === 0 || /\s/.test(line[i - 1]))) return [out + span("c", line.slice(i)), ""];
      if (L.bc && line.startsWith(L.bc[0][0], i)) { st = "c:" + L.bc[0][1]; out += span("c", L.bc[0][0]); i += L.bc[0][0].length; continue; }
      if (L.ml && (m = startsAny(line, i, L.ml))) { st = "s:" + m; out += span("s", m); i += m.length; continue; }
      if (L.q && L.q.indexOf(c) >= 0) {
        j = i + 1;
        while (j < n && line[j] !== c) { if (line[j] === "\\") j++; j++; }
        if (j >= n && L.mlq && L.mlq.indexOf(c) >= 0) return [out + span("s", line.slice(i)), "s:" + c];
        j = Math.min(j + 1, n);
        k = j; while (k < n && line[k] === " ") k++;
        out += span(L.keyStr && line[k] === ":" ? "f" : "s", line.slice(i, j));
        i = j; cmd = false; prev = "";
        continue;
      }
      if ((/[0-9]/.test(c) || (c === "." && /[0-9]/.test(line[i + 1] || ""))) && (!i || !/[\w$]/.test(line[i - 1])) && (m = NUM.exec(line.slice(i)))) {
        out += span("n", m[0]); i += m[0].length; cmd = false; continue;
      }
      if (L.pre && c === "#" && !line.slice(0, i).trim()) { m = /^#\s*\w*/.exec(line.slice(i)); out += span("k", m[0]); i += m[0].length; continue; }
      if (L.deco && c === "@" && (m = /^@[\w.]+/.exec(line.slice(i)))) { out += span("f", m[0]); i += m[0].length; continue; }
      if (L.css && c === "#" && (m = /^#[0-9a-fA-F]{3,8}\b/.exec(line.slice(i)))) { out += span("n", m[0]); i += m[0].length; continue; }
      if (L.css && c === "@" && (m = /^@[\w-]+/.exec(line.slice(i)))) { out += span("k", m[0]); i += m[0].length; continue; }
      if (L.sh && c === "$" && (m = /^\$(\{[^}]*\}|\w+|[@#?$!*0-9])/.exec(line.slice(i)))) { out += span("v", m[0]); i += m[0].length; cmd = false; continue; }
      if (L.yaml && !line.slice(0, i).replace(/^\s*(-\s+)?/, "") && (m = /^([^\s:#][^:#]*?)(\s*:)(?=\s|$)/.exec(line.slice(i)))) { out += span("k", m[1]) + esc(m[2]); i += m[0].length; continue; }
      if (startRe.test(c)) {
        j = i + 1; while (j < n && idRe.test(line[j])) j++;
        var w = line.slice(i, j), cls = "";
        if (L.pfx && /^[rbfuRBFU]{1,2}$/.test(w) && (line[j] === '"' || line[j] === "'")) { out += span("s", w); i = j; continue; } // f"…" r'…'
        if (L.kw[w]) cls = "k"; else if (L.decl[w]) cls = "d"; else if (L.cons[w]) cls = "n";
        else if (L.fnAfter && L.fnAfter[prev]) cls = "f";
        else { k = j; while (k < n && line[k] === " ") k++; if (line[k] === "(" && !L.sh) cls = "f"; else if (L.prop && line[k] === ":") cls = "d"; }
        if (L.sh && cmd && !cls) cls = "f"; // shell：命令位置上的词（第一个词、| ; && 之后）
        cmd = !!(L.sh && L.kw[w]);
        out += span(cls, w);
        prev = w; i = j;
        continue;
      }
      out += esc(c);
      cmd = !!(L.sh && "|;&(`".indexOf(c) >= 0);
      prev = "";
      i++;
    }
    return [out, st];
  }
  // Markdown：标题、代码块、引用、列表符号、行内代码、粗体、链接
  function hlMd(line, st) {
    var fence = /^\s*(```|~~~)/.test(line);
    if (st === "f") return fence ? [span("c", line), ""] : [span("s", line), "f"];
    if (fence) return [span("c", line), "f"];
    if (/^#{1,6}(\s|$)/.test(line)) return [span("h", line), ""];
    if (/^\s*>/.test(line) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return [span("c", line), ""];
    var out = "", m = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s)?/.exec(line), rest = line;
    if (m) { out = m[1] + span("p", m[2]) + m[3] + (m[4] ? span("n", m[4]) : ""); rest = line.slice(m[0].length); }
    var re = /`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\[[^\]]*\]\([^)\s]*\)|https?:\/\/[^\s)>]+/g, last = 0, mm;
    while ((mm = re.exec(rest))) {
      out += esc(rest.slice(last, mm.index));
      out += span(mm[0][0] === "*" || mm[0][0] === "_" ? "b" : "a", mm[0]);
      last = re.lastIndex;
    }
    return [out + esc(rest.slice(last)), ""];
  }
  // HTML / XML：标签名 k、属性名 f、属性值 s、注释 c、实体 n
  function hlHtml(line, st) {
    var out = "", i = 0, n = line.length, j, m;
    while (i < n) {
      var c = line[i];
      if (st === "c") {
        j = line.indexOf("-->", i);
        if (j < 0) return [out + span("c", line.slice(i)), "c"];
        out += span("c", line.slice(i, j + 3)); i = j + 3; st = ""; continue;
      }
      if (st === "t") {
        if (c === ">" || line.startsWith("/>", i)) { var e = c === ">" ? ">" : "/>"; out += span("k", e); i += e.length; st = ""; continue; }
        if (c === '"' || c === "'") { j = line.indexOf(c, i + 1); j = j < 0 ? n : j + 1; out += span("s", line.slice(i, j)); i = j; continue; }
        if ((m = /^[\w:@.-]+/.exec(line.slice(i)))) { out += span("f", m[0]); i += m[0].length; continue; }
        out += esc(c); i++; continue;
      }
      if (line.startsWith("<!--", i)) { st = "c"; out += span("c", "<!--"); i += 4; continue; }
      if (c === "<" && /[\/!?a-zA-Z]/.test(line[i + 1] || "") && (m = /^<[\/!?]?[\w:.-]*/.exec(line.slice(i)))) { out += span("k", m[0]); i += m[0].length; st = "t"; continue; }
      if (c === "&" && (m = /^&#?\w+;/.exec(line.slice(i)))) { out += span("n", m[0]); i += m[0].length; continue; }
      j = i + 1; while (j < n && line[j] !== "<" && line[j] !== "&") j++;
      out += esc(line.slice(i, j)); i = j;
    }
    return [out, st];
  }
  function hlLine(line, st, L) {
    if (L.plain || line.length > 3000) return [esc(line), st];
    if (L.md) return hlMd(line, st);
    if (L.html) return hlHtml(line, st);
    return hlCode(line, st, L);
  }
  window.TSU_HL = { LANG: LANG, EXT: EXT, langOf: langOf, langName: langName, line: hlLine, esc: esc };
})();
