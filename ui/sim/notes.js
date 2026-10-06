// notes.js —— 备忘录（同 macOS 26）
// 数据：~/Library/Notes/<文件夹>/<标题>.md，一个备忘录一个 Markdown 文件，文件夹就是子目录（可以套）；「最近删除」是 .Trash/（按原来的文件夹放）；
//   图片存在同一个文件夹的 .attachments/ 里。agent 用文件工具读写，App 马上跟着变；正在编辑的那篇在外面被改了，App 问用哪个版本，不会悄悄覆盖
// 界面：文件夹（带数量、可以套、最近删除、标签）| 备忘录列表（置顶、按日期分组、预览）或画廊 | 编辑器：标题 / 标头 / 副标头 / 正文 / 等宽、
//   粗体 / 斜体 / 下划线 / 删除线、项目符号 / 短划线 / 编号列表、核对清单、块引用、表格、链接、图片；打字时 "- " "1. " "[] " 自动变列表
(function () {
  "use strict";
  var K = window.TSU_APPKIT;
  if (!K) return;
  var FS = K.FS, D = K.D, esc = K.esc, ICON = K.ICON;
  var APP = "notes", NAME = "备忘录", DIR = FS.HOME + "/Library/Notes", TRASH = DIR + "/.Trash", DEF = "备忘录", ATT = ".attachments";

  var README = [
    "# 备忘录",
    "",
    "「备忘录」App 的数据就是这个文件夹：**一个备忘录一个 Markdown 文件**，放在文件夹（子目录）里。App 开着时，这里的改动马上显示出来；App 里的改动也马上写回这里。",
    "",
    "```",
    "~/Library/Notes/",
    "  备忘录/                ← 默认的文件夹",
    "    购物清单.md",
    "    .attachments/        ← 这个文件夹里的备忘录用到的图片",
    "  工作/",
    "    周会记录.md",
    "    项目/                ← 文件夹可以套文件夹",
    "  .Trash/                ← 「最近删除」，按原来的文件夹放",
    "```",
    "",
    "- **第一行是标题**（一般写成 `# 标题`）。在 App 里改了标题，文件会跟着重新命名",
    "- 格式：`# 标题`、`## 标头`、`### 副标头`、`**粗体**`、`*斜体*`、`<u>下划线</u>`、`~~删除线~~`、`[链接](https://…)`、",
    "  `* 项目符号列表`、`- 短划线列表`、`1. 编号列表`、`- [ ] 核对清单` / `- [x] 已勾选`（每深一级多缩进 4 个空格）、`> 块引用`、三个反引号围起来的等宽文字、",
    "  表格（`| a | b |`，第二行 `| --- | --- |`）、图片 `![](.attachments/图片.png)`（路径相对这个备忘录所在的文件夹）",
    "- 每一行是一段（不用空行隔开段落；空行就是空的一段）",
    "- 文件开头可以有 front matter：`pinned: true` 表示置顶",
    "- 新建备忘录 = 在某个文件夹里新建一个 `.md` 文件；新建文件夹 = 新建一个子目录",
    "- 删除备忘录 = 移到 `.Trash/<原来的文件夹>/`（就是 App 的「最近删除」）；不要直接删",
    "- 正在 App 里编辑的那篇如果在这里被改了，App 会问用哪个版本，不会悄悄覆盖",
    "",
  ].join("\n");

  var store = K.dataDir(DIR, README);
  var dirOf = function (p) { return p.slice(0, p.lastIndexOf("/")); };
  var baseOf = function (p) { return p.slice(p.lastIndexOf("/") + 1); };
  var stemOf = function (p) { return baseOf(p).replace(/\.(md|markdown|txt)$/i, ""); };
  var relOf = function (p) { return p === DIR ? "" : p.slice(DIR.length + 1); };
  var folderOf = function (p) { return relOf(dirOf(p)); }; // "" = 根目录（算在默认文件夹里）
  var folderPath = function (f) { return f ? DIR + "/" + f : DIR; };
  function folderName(f) { if (!f) return DEF; if (f === ".Trash" || f.indexOf(".Trash/") === 0) return "最近删除"; return f.slice(f.lastIndexOf("/") + 1); }
  var isNoteFile = function (p) { return /\.(md|markdown|txt)$/i.test(p); };

  // ======== Markdown ⇄ 编辑器里的块 ========
  // 块：h1 标题、h2 标头、h3 副标头、p 正文、div.nt-mono 等宽（一行一块，连着的写成一个 ``` 块）、div.nt-quote 块引用、
  //    div.nt-li[data-t=bullet|dash|num|check][data-l=级别][data-c=已勾选] 列表项（平铺，不套 ul）、table.nt-table、div.nt-img 图片
  function splitFront(text) {
    var t = String(text == null ? "" : text).replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
    var m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(t);
    if (!m) return { fm: [], meta: {}, body: t };
    var meta = {}, fm = m[1].split("\n");
    fm.forEach(function (ln) { var kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(ln); if (kv) { var v = kv[2].trim().replace(/^["']|["']$/g, ""); meta[kv[1]] = v === "true" ? true : v === "false" ? false : v; } });
    return { fm: fm, meta: meta, body: t.slice(m[0].length) };
  }
  function joinFront(fm, body) {
    var lines = (fm || []).filter(function (l) { return l.trim(); });
    return (lines.length ? "---\n" + lines.join("\n") + "\n---\n" : "") + body;
  }
  function setFront(fm, key, val) {
    var out = (fm || []).filter(function (l) { return !new RegExp("^" + key + "\\s*:").test(l); });
    if (val !== undefined && val !== false && val !== null) out.push(key + ": " + val);
    return out;
  }
  // ---- 行内：**粗** *斜* <u>下划线</u> ~~删除~~ `代码` [链接](url) 裸网址 <mark> \转义 ----
  var ESCAPABLE = /[\\`*_{}\[\]()#+\-.!|~<>=]/;
  var escAttr = function (s) { return esc(s).replace(/'/g, "&#39;"); };
  function inl(s) {
    var out = "", i = 0, m, rest, prev;
    while (i < s.length) {
      var c = s[i];
      rest = s.slice(i);
      prev = i ? s[i - 1] : "";
      if (c === "\\" && i + 1 < s.length && ESCAPABLE.test(s[i + 1])) { out += esc(s[i + 1]); i += 2; continue; }
      if (c === "`" && (m = /^`([^`\n]+)`/.exec(rest))) { out += "<code>" + esc(m[1]) + "</code>"; i += m[0].length; continue; }
      if (c === "!" && (m = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest))) { out += K.safeURL(m[2]) ? '<a href="' + escAttr(K.safeURL(m[2])) + '">' + esc(m[1] || m[2]) + "</a>" : esc(m[1] || m[2]); i += m[0].length; continue; }
      if (c === "[" && (m = /^\[((?:\\.|[^\]\\])+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest))) { out += K.safeURL(m[2]) ? '<a href="' + escAttr(K.safeURL(m[2])) + '">' + inl(m[1]) + "</a>" : inl(m[1]); i += m[0].length; continue; }
      if (c === "<" && (m = /^<(https?:\/\/[^>\s]+)>/.exec(rest))) { out += '<a href="' + escAttr(m[1]) + '">' + esc(m[1]) + "</a>"; i += m[0].length; continue; }
      if (c === "<" && (m = /^<(\/?)(u|b|i|s|del|mark|strong|em|br)\s*\/?>/i.exec(rest))) {
        var tg = m[2].toLowerCase(), map = { strong: "b", em: "i", del: "s" };
        out += tg === "br" ? "<br>" : "<" + m[1] + (map[tg] || tg) + ">";
        i += m[0].length;
        continue;
      }
      if (c === "h" && !/[\w\/]/.test(prev) && (m = /^https?:\/\/[^\s<>"'，。；、（）()]*[^\s<>"'，。；、（）().,;:!?]/.exec(rest))) { out += '<a href="' + escAttr(m[0]) + '">' + esc(m[0]) + "</a>"; i += m[0].length; continue; }
      if (c === "*" && (m = /^\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/.exec(rest))) { out += "<b><i>" + inl(m[1]) + "</i></b>"; i += m[0].length; continue; }
      if (c === "*" && (m = /^\*\*(?=\S)([\s\S]*?\S)\*\*/.exec(rest))) { out += "<b>" + inl(m[1]) + "</b>"; i += m[0].length; continue; }
      if (c === "_" && !/\w/.test(prev) && (m = /^__(?=\S)([\s\S]*?\S)__(?!\w)/.exec(rest))) { out += "<b>" + inl(m[1]) + "</b>"; i += m[0].length; continue; }
      if (c === "*" && (m = /^\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/.exec(rest))) { out += "<i>" + inl(m[1]) + "</i>"; i += m[0].length; continue; }
      if (c === "_" && !/\w/.test(prev) && (m = /^_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/.exec(rest))) { out += "<i>" + inl(m[1]) + "</i>"; i += m[0].length; continue; }
      if (c === "~" && (m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest))) { out += "<s>" + inl(m[1]) + "</s>"; i += m[0].length; continue; }
      if (c === "=" && (m = /^==(?=\S)([\s\S]*?\S)==/.exec(rest))) { out += "<mark>" + inl(m[1]) + "</mark>"; i += m[0].length; continue; }
      out += esc(c);
      i++;
    }
    return out;
  }
  function tableCells(line) {
    var t = line.trim().replace(/^\|/, "").replace(/\|$/, ""), cells = [], cur = "";
    for (var i = 0; i < t.length; i++) {
      if (t[i] === "\\" && t[i + 1] === "|") { cur += "\\|"; i++; continue; }
      if (t[i] === "|") { cells.push(cur.trim()); cur = ""; continue; }
      cur += t[i];
    }
    cells.push(cur.trim());
    return cells;
  }
  var LI_RE = /^(\s*)([-*+•]|\d{1,9}[.)])\s+(?:\[( |x|X)\](?:\s+|$))?(.*)$/;
  function mdToHTML(body) {
    if (!String(body || "").trim()) return "<h1><br></h1>"; // 空的备忘录：第一行是标题
    var lines = String(body || "").replace(/\r\n?/g, "\n").split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    var html = "", i = 0, stack = [], m;
    var level = function (indent) {
      while (stack.length && indent < stack[stack.length - 1]) stack.pop();
      if (!stack.length || indent > stack[stack.length - 1]) stack.push(indent);
      return Math.min(stack.length - 1, 5);
    };
    while (i < lines.length) {
      var ln = lines[i];
      if ((m = /^\s*(`{3,}|~{3,})(.*)$/.exec(ln))) {
        var fence = m[1], code = [];
        i++;
        while (i < lines.length && !(new RegExp("^\\s*" + fence.charAt(0) + "{" + fence.length + ",}\\s*$").test(lines[i]))) code.push(lines[i++]);
        i++;
        (code.length ? code : [""]).forEach(function (t) { html += '<div class="nt-mono">' + (esc(t) || "<br>") + "</div>"; });
        stack = [];
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        var rows = [tableCells(ln)];
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(tableCells(lines[i++]));
        var cols = rows.reduce(function (n, r) { return Math.max(n, r.length); }, 1);
        html += '<table class="nt-table"><tbody>' + rows.map(function (r) {
          var cs = [];
          for (var k = 0; k < cols; k++) cs.push("<td>" + (inl(r[k] || "") || "<br>") + "</td>");
          return "<tr>" + cs.join("") + "</tr>";
        }).join("") + "</tbody></table>";
        stack = [];
        continue;
      }
      if ((m = /^(#{1,6})(?:\s+(.*?))?\s*$/.exec(ln))) {
        var tg = m[1].length === 1 ? "h1" : m[1].length === 2 ? "h2" : "h3", txt = (m[2] || "").replace(/\s+#+\s*$/, "");
        html += "<" + tg + ">" + (inl(txt) || "<br>") + "</" + tg + ">";
        stack = [];
        i++;
        continue;
      }
      if ((m = /^\s*>\s?(.*)$/.exec(ln))) { html += '<div class="nt-quote">' + (inl(m[1]) || "<br>") + "</div>"; i++; continue; }
      if ((m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/.exec(ln.trim()))) { html += imgHTML(m[2], m[1]); i++; continue; }
      if ((m = LI_RE.exec(ln))) {
        var ind = m[1].replace(/\t/g, "    ").length, lv = level(ind);
        var t = m[3] !== undefined ? "check" : /\d/.test(m[2]) ? "num" : m[2] === "-" ? "dash" : "bullet";
        html += '<div class="nt-li" data-t="' + t + '" data-l="' + lv + '"' + (m[3] && m[3] !== " " ? ' data-c="1"' : "") + ">" + (inl(m[4]) || "<br>") + "</div>";
        i++;
        continue;
      }
      html += "<p>" + (inl(ln) || "<br>") + "</p>";
      stack = [];
      i++;
    }
    return html || "<h1><br></h1>";
  }
  var imgHTML = function (src, alt) { return '<div class="nt-img" contenteditable="false" data-src="' + escAttr(src) + '"' + (alt ? ' data-alt="' + escAttr(alt) + '"' : "") + '><img alt=""></div>'; };
  // ---- 编辑器 → Markdown ----
  function escText(t) {
    return t.replace(/\u00a0/g, " ").replace(/\u200b/g, "").replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/`/g, "\\`").replace(/~~/g, "\\~\\~").replace(/==/g, "\\=\\=")
      .replace(/<(?=[a-zA-Z\/!])/g, "\\<").replace(/\[(?=[^\]]*\]\()/g, "\\[").replace(/(^|[^\w\\])_(?=\S)/g, "$1\\_");
  }
  function wrapMark(mark, inner) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
    return m[2] ? m[1] + mark + m[2] + mark + m[3] : inner;
  }
  function mdInline(node) {
    var s = "";
    node.childNodes.forEach(function (n) {
      if (n.nodeType === 3) { s += escText(n.data); return; }
      if (n.nodeType !== 1) return;
      var tag = n.nodeName;
      if (tag === "BR") { if (n.nextSibling || n.parentNode.nodeName === "SPAN") s += "<br>"; return; }
      if (tag === "IMG") return;
      var inner = mdInline(n);
      if (tag === "A") { var href = n.getAttribute("href") || ""; s += href && (n.textContent === href) && /^https?:\/\//.test(href) ? href : href ? "[" + inner + "](" + href.replace(/\)/g, "%29").replace(/ /g, "%20") + ")" : inner; return; }
      if (tag === "CODE") { s += n.textContent ? "`" + n.textContent.replace(/`/g, "'") + "`" : ""; return; }
      if (!inner.trim()) { s += inner; return; }
      if (tag === "B" || tag === "STRONG") s += wrapMark("**", inner);
      else if (tag === "I" || tag === "EM") s += wrapMark("*", inner);
      else if (tag === "S" || tag === "STRIKE" || tag === "DEL") s += wrapMark("~~", inner);
      else if (tag === "U") s += "<u>" + inner + "</u>";
      else if (tag === "MARK") s += "<mark>" + inner + "</mark>";
      else s += inner;
    });
    return s;
  }
  // 正文开头像 Markdown 记号的：加反斜杠，免得读回来变成标题、列表
  function escLineStart(s) {
    var m = /^(\s*)([\s\S]*)$/.exec(s), lead = m[1], rest = m[2];
    if (/^(#{1,6}(\s|$)|>|[-*+•]\s|```|~~~|\|)/.test(rest)) return lead + "\\" + rest;
    var n = /^(\d{1,9})([.)])(\s)/.exec(rest);
    if (n) return lead + n[1] + "\\" + rest.slice(n[1].length);
    if (/^!\[/.test(rest)) return lead + "\\" + rest;
    return s;
  }
  function toMd(root) {
    var lines = [], kids = root.children, cnt = [0, 0, 0, 0, 0, 0];
    for (var i = 0; i < kids.length; i++) {
      var b = kids[i], k = kindOf(b);
      // 编号自己数（不靠 data-n）：别的块打断就重新数；更深的一级每次重新数
      if (isList(k)) { var lv0 = Math.min(5, +b.dataset.l || 0); for (var z = lv0 + 1; z < 6; z++) cnt[z] = 0; if (k === "num") { cnt[lv0]++; b.dataset.n = cnt[lv0]; } else cnt[lv0] = 0; }
      else cnt = [0, 0, 0, 0, 0, 0];
      if (k === "mono") {
        var code = [];
        while (i < kids.length && kindOf(kids[i]) === "mono") code.push(kids[i++].textContent.replace(/\u00a0/g, " "));
        i--;
        var fence = code.some(function (c) { return /^\s*```/.test(c); }) ? "~~~" : "```";
        lines.push(fence);
        lines = lines.concat(code);
        lines.push(fence);
        continue;
      }
      if (k === "table") {
        var rows = Array.prototype.map.call(b.rows, function (tr) { return Array.prototype.map.call(tr.cells, function (td) { return mdInline(td).replace(/\|/g, "\\|").replace(/\n/g, " ").trim(); }); });
        if (!rows.length) continue;
        var cols = rows.reduce(function (n, r) { return Math.max(n, r.length); }, 1);
        var line = function (r) { var cs = []; for (var q = 0; q < cols; q++) cs.push(r[q] || ""); return "| " + cs.join(" | ") + " |"; };
        lines.push(line(rows[0]));
        var sep = [];
        for (var q = 0; q < cols; q++) sep.push("---");
        lines.push("| " + sep.join(" | ") + " |");
        rows.slice(1).forEach(function (r) { lines.push(line(r)); });
        continue;
      }
      if (k === "img") { lines.push("![" + (b.dataset.alt || "") + "](" + (b.dataset.src || "") + ")"); continue; }
      var t = mdInline(b).replace(/\n/g, " ");
      if (k === "title") lines.push(t.trim() ? "# " + t : "#");
      else if (k === "heading") lines.push(t.trim() ? "## " + t : "##");
      else if (k === "subheading") lines.push(t.trim() ? "### " + t : "###");
      else if (k === "quote") lines.push(t ? "> " + t : ">");
      else if (/^(bullet|dash|num|check)$/.test(k)) {
        var ind = new Array((+b.dataset.l || 0) + 1).join("    ");
        var mark = k === "bullet" ? "*" : k === "num" ? (b.dataset.n || "1") + "." : "-";
        lines.push(ind + mark + " " + (k === "check" ? (b.dataset.c ? "[x] " : "[ ] ") : "") + t);
      } else lines.push(escLineStart(t));
    }
    return lines.join("\n") + "\n";
  }
  // 标题、预览、搜索用的纯文字（不用 DOM）
  function plainLine(l) {
    return l.replace(/^\s*(#{1,6}\s+|>\s?|[-*+•]\s+(\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)/, "").replace(/^#{1,6}$/, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, "$1")
      .replace(/<\/?(u|b|i|s|del|mark|strong|em)\s*>/gi, "").replace(/<br\s*\/?>/gi, " ").replace(/\*\*|__|~~|==|`/g, "").replace(/(^|[^\\])\*(?=\S)|(\S)\*(?=\s|$)/g, "$1$2")
      .replace(/\\([\\`*_{}\[\]()#+\-.!|~<>=])/g, "$1").trim();
  }
  function plainLines(body) {
    var out = [], lines = String(body || "").split("\n"), inCode = false;
    lines.forEach(function (l) {
      if (/^\s*(```|~~~)/.test(l)) { inCode = !inCode; return; }
      if (inCode) { out.push(l.trim()); return; }
      if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && /\|/.test(l)) return;
      if (/^\s*\|.*\|\s*$/.test(l)) { out.push(tableCells(l).map(plainLine).join("  ")); return; }
      out.push(plainLine(l));
    });
    return out;
  }
  var tagsOf = function (body) {
    var out = [], re = /(^|[\s(（，。,.;；])#([^\s#,，。.;；:：!！?？()（）\[\]{}"'<>\\/]{1,30})/g, m, t = String(body || "").replace(/```[\s\S]*?```/g, "");
    while ((m = re.exec(t))) { if (/^\d+$/.test(m[2])) continue; if (out.indexOf(m[2]) < 0) out.push(m[2]); }
    return out;
  };

  // ======== 索引：所有备忘录、文件夹 ========
  var notes = {}, folders = [];
  function scan() {
    var all = [];
    try { all = FS.isDir(DIR) ? FS.walk(DIR) : []; } catch (e) { all = []; }
    var next = {}, dirs = [];
    all.forEach(function (p) {
      if (p === DIR) return;
      var r = relOf(p), segs = r.split("/"), trashed = segs[0] === ".Trash";
      if (segs.some(function (s, k) { return s.charAt(0) === "." && !(k === 0 && s === ".Trash"); })) return;
      var st = FS.stat(p);
      if (!st) return;
      if (st.dir) { if (!trashed) dirs.push(r); return; }
      if (!isNoteFile(p) || (segs.length === 1 && /^readme\.md$/i.test(segs[0]))) return;
      var old = notes[p];
      next[p] = old && old.mtime === st.mtime && old.size === st.size && !old.lazy ? old : readNote(p, st, old);
    });
    notes = next;
    folders = dirs.sort(function (a, b) {
      var pa = a.split("/"), pb = b.split("/");
      for (var i = 0; i < Math.min(pa.length, pb.length); i++) {
        if (pa[i] === pb[i]) continue;
        if (i === 0 && pa[0] === DEF) return -1;
        if (i === 0 && pb[0] === DEF) return 1;
        return pa[i].localeCompare(pb[i], "zh");
      }
      return pa.length - pb.length;
    });
  }
  function readNote(p, st, old) {
    var n = { path: p, mtime: st.mtime || 0, ctime: st.ctime || st.mtime || 0, size: st.size, folder: folderOf(p), trashed: relOf(p).indexOf(".Trash/") === 0 };
    var r = store.read(p);
    if (r.lazy || (r.text == null && !r.error)) {
      n.lazy = true;
      ["text", "body", "fm", "title", "preview", "tags", "pinned", "thumb"].forEach(function (k) { if (old) n[k] = old[k]; });
      if (!old) { n.text = null; n.body = ""; n.fm = []; n.title = stemOf(p); n.preview = "正在载入…"; n.tags = []; n.pinned = false; }
      return n;
    }
    n.text = r.text == null ? "" : r.text;
    if (r.error) n.error = r.error;
    var f = splitFront(n.text);
    n.fm = f.fm;
    n.body = f.body;
    n.pinned = f.meta.pinned === true;
    var pl = plainLines(f.body).filter(Boolean);
    n.title = (pl[0] || "").slice(0, 120) || (f.body.trim() ? stemOf(p) : "新建备忘录");
    n.preview = pl.slice(1).join(" ").slice(0, 200);
    n.tags = tagsOf(f.body);
    var im = /!\[[^\]]*\]\(([^)\s]+)\)/.exec(f.body);
    n.thumb = im ? im[1] : "";
    return n;
  }
  function indexOne(p) { var st = FS.stat(p); if (st && !st.dir) notes[p] = readNote(p, st, notes[p]); else delete notes[p]; }
  var noteList = function () { return Object.keys(notes).map(function (k) { return notes[k]; }); };

  // ======== 界面状态 ========
  var UI = {
    folder: K.store.get("tsu-notes-folder", DEF), // 文件夹的相对路径 | "@all" | "@trash" | "#标签"（"#*" 所有标签）
    sel: K.store.get("tsu-notes-sel", null), query: "", view: K.store.get("tsu-notes-view", "list"), sort: K.store.get("tsu-notes-sort", "modified"),
    group: K.store.get("tsu-notes-group", true), listW: K.store.get("tsu-notes-listw", 290), collapsed: K.store.get("tsu-notes-collapsed", {}), galleryOpen: false,
  };
  function saveUI() { K.store.set("tsu-notes-folder", UI.folder); K.store.set("tsu-notes-sel", UI.sel); K.store.set("tsu-notes-view", UI.view); K.store.set("tsu-notes-sort", UI.sort); K.store.set("tsu-notes-group", UI.group); K.store.set("tsu-notes-collapsed", UI.collapsed); }
  function inView() {
    var all = noteList();
    if (UI.query) {
      var q = UI.query.toLowerCase();
      return all.filter(function (n) { return !n.trashed && ((n.title + "\n" + (n.body || "")).toLowerCase().indexOf(q) >= 0 || q.charAt(0) === "#" && n.tags.indexOf(q.slice(1)) >= 0); });
    }
    var f = UI.folder;
    if (f === "@all") return all.filter(function (n) { return !n.trashed; });
    if (f === "@trash") return all.filter(function (n) { return n.trashed; });
    if (f.charAt(0) === "#") { var tg = f.slice(1); return all.filter(function (n) { return !n.trashed && (tg === "*" ? n.tags.length : n.tags.indexOf(tg) >= 0); }); }
    return all.filter(function (n) { return !n.trashed && (n.folder === f || (f === DEF && n.folder === "")); });
  }
  function sorted(a) {
    return a.sort(function (x, y) {
      if (x.pinned !== y.pinned && UI.folder !== "@trash") return x.pinned ? -1 : 1;
      if (UI.sort === "title") return x.title.localeCompare(y.title, "zh");
      if (UI.sort === "created") return (y.ctime || 0) - (x.ctime || 0);
      return (y.mtime || 0) - (x.mtime || 0);
    });
  }
  var viewTitle = function () { return UI.query ? "搜索结果" : UI.folder === "@all" ? "所有备忘录" : UI.folder === "@trash" ? "最近删除" : UI.folder.charAt(0) === "#" ? (UI.folder === "#*" ? "所有标签" : UI.folder) : folderName(UI.folder); };
  var multiFolder = function () { return !!UI.query || UI.folder === "@all" || UI.folder.charAt(0) === "#"; };
  var countIn = function (f) { return noteList().filter(function (n) { return !n.trashed && (n.folder === f || (f === DEF && n.folder === "")); }).length; };
  var trashCount = function () { return noteList().filter(function (n) { return n.trashed; }).length; };
  function allTags() { var t = []; noteList().forEach(function (n) { if (!n.trashed) n.tags.forEach(function (x) { if (t.indexOf(x) < 0) t.push(x); }); }); return t.sort(function (a, b) { return a.localeCompare(b, "zh"); }); }

  // 日期：列表里「09:41 / 昨天 / 星期二 / 2026/9/12」；编辑器顶上「2026年9月26日 09:41」
  function listDate(t) {
    var d = new Date(t), n = K.dayDiff(d, new Date());
    if (n <= 0) return K.hm(d);
    if (n === 1) return "昨天";
    if (n < 7) return "星期" + K.WD[d.getDay()];
    return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
  }
  function groupOf(t) {
    var d = new Date(t), n = K.dayDiff(d, new Date());
    if (n <= 0) return "今天";
    if (n === 1) return "昨天";
    if (n < 7) return "前 7 天";
    if (n < 30) return "前 30 天";
    return d.getFullYear() === new Date().getFullYear() ? d.getMonth() + 1 + "月" : d.getFullYear() + "年";
  }
  var fullDate = function (t) { var d = new Date(t); return K.fmtYMD(d) + " " + K.hm(d); };

  // ======== 窗口 ========
  var M = null, ED = null;
  function open() {
    if (!M) build();
    if (M.win.state === "min" || M.win.state === "closed") M.win.show(); else M.win.front();
    renderAll();
    if (!E.path && !E.draft && UI.sel && notes[UI.sel]) openNote(UI.sel, true);
    return M.win;
  }
  function build() {
    M = K.window({ id: APP, name: NAME, className: "nt-win", width: 1080, height: 680, sideW: 210, minSide: 170, maxSide: 340, narrow: 880, menus: menus, appMenu: appMenu,
      title: function () { return NAME; }, onClose: function () { flush(); } });
    M.win.el.style.setProperty("--nt-lw", UI.listW + "px");
    M.tb.innerHTML = K.group(K.btn("sidebar", "显示或隐藏文件夹")) +
      '<span class="ma-seg nt-viewseg" data-tb><button data-v="list" title="以列表显示">' + ICON.rows + '</button><button data-v="gallery" title="以画廊显示">' + ICON.grid + "</button></span>" +
      K.group(K.btn("back", "返回画廊", ICON.left, "nt-back") + K.btn("trash", "删除")) + '<span class="nt-tbgap"></span>' +
      K.group(K.btn("compose", "新建备忘录")) + K.group(K.btn("format", "格式", ICON.format) + K.btn("checklist", "核对清单") + K.btn("table", "表格") + K.btn("media", "添加图片", ICON_PHOTO)) +
      '<span class="ma-flex"></span>' + K.group(K.btn("link", "添加链接", ICON.link) + K.btn("share", "共享")) + K.searchBox("搜索");
    M.side.insertAdjacentHTML("afterbegin", '<div class="nt-sscroll ma-scroll"><div class="nt-acct">在我的 Mac 上</div><div class="nt-folders"></div><div class="nt-tagbox"></div></div>' +
      '<div class="nt-sfoot"><button class="nt-newf" tabindex="-1"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 6.6v6.8M6.6 10h6.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>新建文件夹</button></div>');
    M.main.innerHTML = '<div class="nt-lc"><div class="nt-lhead"><b></b><span></span></div><div class="nt-list ma-scroll" tabindex="0"></div><div class="ma-empty" hidden>无备忘录</div></div>' +
      '<i class="nt-lsplit"></i><div class="nt-ec"><div class="nt-bar" hidden></div><div class="nt-scroll ma-scroll"><div class="nt-date"></div>' +
      '<div class="nt-ed selectable" contenteditable="true" spellcheck="false"></div></div><div class="nt-none" hidden>无备忘录</div></div>' +
      '<div class="nt-gallery ma-scroll" hidden></div>';
    ED = M.main.querySelector(".nt-ed");
    bindToolbar();
    bindSide();
    bindList();
    bindEditor();
    window.addEventListener("keydown", onKey, true);
    K.onTheme(function () { renderAll(); });
    document.addEventListener("visibilitychange", function () { if (document.hidden) flush(); });
    window.addEventListener("beforeunload", function () { flush(); });
  }
  var ICON_PHOTO = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.8" y="4" width="14.4" height="12" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7.2" cy="8.2" r="1.5" fill="currentColor"/><path d="m3.4 14.6 4.2-4 2.8 2.6 2.4-2.2 3.8 3.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  var ICON_TRASHF = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.8 5.6h12.4M8 5.4V4c0-.6.4-1 1-1h2c.6 0 1 .4 1 1v1.4M5.4 5.8l.8 10.3c.1.7.6 1.2 1.3 1.2h5c.7 0 1.2-.5 1.3-1.2l.8-10.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_FOLDER = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.6 6.2c0-1 .7-1.7 1.7-1.7h3.4l1.8 1.8h6.2c1 0 1.7.8 1.7 1.7v6.6c0 1-.8 1.7-1.7 1.7H4.3c-1 0-1.7-.8-1.7-1.7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2.8 8.6h14.4" stroke="currentColor" stroke-width="1.3"/></svg>';
  var ICON_ALL = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.6 3.6h8.2l2.6 2.6v9.2c0 .6-.4 1-1 1H4.6c-.6 0-1-.4-1-1V4.6c0-.6.4-1 1-1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6.6 8.6h6.8M6.6 11.4h6.8M6.6 14.2h4.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

  // ======== 画：侧边栏 ========
  function renderAll() { if (!M) return; renderSide(); renderList(); renderEditorChrome(); syncToolbar(); }
  function renderSide() {
    if (M.side.querySelector(".nt-fname.renaming")) return; // 正在改文件夹名：改完再画
    var box = M.side.querySelector(".nt-folders"), h = "", sel = UI.query ? null : UI.folder;
    var list = folders.slice();
    if (list.indexOf(DEF) < 0) list.unshift(DEF);
    if (list.length > 1) h += row("@all", "所有备忘录", ICON_ALL, noteList().filter(function (n) { return !n.trashed; }).length, 0, false);
    list.forEach(function (f) {
      var parts = f.split("/"), depth = parts.length - 1;
      for (var k = 1; k < parts.length; k++) if (UI.collapsed[parts.slice(0, k).join("/")]) return;
      var hasKids = list.some(function (x) { return x.indexOf(f + "/") === 0; });
      h += row(f, parts[parts.length - 1], ICON_FOLDER, countIn(f), depth, hasKids);
    });
    var tc = trashCount();
    if (tc) h += row("@trash", "最近删除", ICON_TRASHF, tc, 0, false);
    box.innerHTML = h;
    function row(key, name, ico, n, depth, kids) {
      return '<div class="nt-f' + (sel === key ? " on" : "") + '" data-f="' + esc(key) + '" style="--d:' + depth + '"' + (key.charAt(0) === "@" ? "" : ' draggable="true"') + ">" +
        (kids ? '<i class="nt-disc' + (UI.collapsed[key] ? "" : " open") + '" data-disc></i>' : '<i class="nt-disc none"></i>') + ico + '<span class="nt-fname">' + esc(name) + "</span><em>" + (n || "") + "</em></div>";
    }
    var tags = allTags(), tb = M.side.querySelector(".nt-tagbox");
    tb.innerHTML = tags.length ? '<div class="nt-acct">标签</div><div class="nt-tags"><button data-tag="*" class="' + (sel === "#*" ? "on" : "") + '">所有标签</button>' +
      tags.map(function (t) { return '<button data-tag="' + esc(t) + '" class="' + (sel === "#" + t ? "on" : "") + '">#' + esc(t) + "</button>"; }).join("") + "</div>" : "";
  }
  // ======== 画：备忘录列表 / 画廊 ========
  function renderList() {
    var lc = M.main.querySelector(".nt-lc"), list = lc.querySelector(".nt-list"), items = sorted(inView()), top = list.scrollTop;
    lc.querySelector(".nt-lhead b").textContent = viewTitle();
    lc.querySelector(".nt-lhead span").textContent = items.length + " 个备忘录";
    var h = "", last = null, draft = E.draft && !E.path && !UI.query && UI.folder !== "@trash";
    if (draft) h += itemHTML({ path: "", title: E.draftTitle || "新建备忘录", preview: "", mtime: Date.now(), folder: E.draftFolder, draft: true });
    items.forEach(function (n) {
      var g = UI.folder === "@trash" ? null : n.pinned ? "置顶" : UI.group && UI.sort !== "title" ? groupOf(UI.sort === "created" ? n.ctime : n.mtime) : null;
      if (g !== last && g) h += '<div class="nt-gh">' + esc(g) + "</div>";
      last = g;
      h += itemHTML(n);
    });
    list.innerHTML = h;
    list.scrollTop = top;
    var em = lc.querySelector(".ma-empty");
    em.hidden = !!items.length || draft;
    em.textContent = UI.query ? "无结果" : "无备忘录";
    loadThumbs(list);
    if (UI.view === "gallery") renderGallery(items);
  }
  function itemHTML(n) {
    var on = n.draft ? !E.path : UI.sel === n.path;
    return '<div class="nt-it' + (on ? " on" : "") + (n.draft ? " draft" : "") + '" data-p="' + esc(n.path) + '"' + (n.draft ? "" : ' draggable="true"') + ">" +
      (n.thumb ? '<span class="nt-thumb" data-img="' + esc(n.thumb) + '" data-note="' + esc(n.path) + '"></span>' : "") +
      '<div class="nt-it-t">' + (n.pinned && UI.folder !== "@trash" ? '<i class="nt-pin">' + ICON.pin + "</i>" : "") + hl(n.title) + "</div>" +
      '<div class="nt-it-s"><span class="nt-it-d">' + listDate(UI.sort === "created" ? n.ctime : n.mtime) + '</span><span class="nt-it-p">' + (n.preview ? hl(n.preview) : "无其他文本") + "</span></div>" +
      (multiFolder() && !n.draft ? '<div class="nt-it-f">' + ICON_FOLDER + esc(folderName(n.folder)) + "</div>" : "") + "</div>";
  }
  function hl(t) {
    var s = esc(t);
    if (!UI.query || UI.query.charAt(0) === "#") return s;
    var q = esc(UI.query), i = s.toLowerCase().indexOf(q.toLowerCase());
    return i < 0 ? s : s.slice(0, i) + "<mark>" + s.slice(i, i + q.length) + "</mark>" + s.slice(i + q.length);
  }
  function renderGallery(items) {
    var g = M.main.querySelector(".nt-gallery");
    g.innerHTML = '<div class="nt-ghead"><b>' + esc(viewTitle()) + "</b><span>" + items.length + " 个备忘录</span></div><div class=\"nt-cards\">" + items.map(function (n) {
      var lines = plainLines(n.body || "").filter(Boolean).slice(1, 9);
      return '<div class="nt-card' + (UI.sel === n.path ? " on" : "") + '" data-p="' + esc(n.path) + '"><div class="nt-card-pv">' +
        (n.thumb ? '<span class="nt-thumb big" data-img="' + esc(n.thumb) + '" data-note="' + esc(n.path) + '"></span>' : "") +
        "<b>" + esc(n.title) + "</b>" + lines.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") + '</div><div class="nt-card-t">' + esc(n.title) + '</div><div class="nt-card-d">' + listDate(n.mtime) + "</div></div>";
    }).join("") + "</div>";
    loadThumbs(g);
  }
  var gridMode = function () { return UI.view === "gallery" && !UI.galleryOpen; };
  function renderEditorChrome() {
    var gal = gridMode();
    M.win.el.classList.toggle("nt-grid", gal);
    M.win.el.classList.toggle("nt-galopen", UI.view === "gallery" && UI.galleryOpen);
    M.main.querySelector(".nt-gallery").hidden = !gal;
    var n = E.path && notes[E.path], has = !!n || E.draft;
    M.main.querySelector(".nt-none").hidden = has;
    M.main.querySelector(".nt-scroll").hidden = !has;
    M.main.querySelector(".nt-date").textContent = n ? fullDate(n.mtime) : E.draft ? fullDate(Date.now()) : "";
    var bar = M.main.querySelector(".nt-bar"), msg = "";
    if (E.conflict) msg = '<span>这个备忘录刚在别处被改过（可能是 agent）。</span><button data-bar="theirs">用那边的版本</button><button data-bar="mine">保留我的</button>';
    else if (n && n.trashed) msg = "<span>此备忘录在“最近删除”中。</span><button data-bar=\"restore\">恢复</button>";
    else if (n && n.error) msg = "<span>这个文件读不了（" + esc(n.error) + "），不能在这里编辑。</span>";
    else if (n && n.lazy && n.text == null) msg = "<span>正在从真沙盒取这个备忘录…</span>";
    else if (E.path && !n && !E.draft) msg = "<span>原来的文件不见了（被移走或删除了）。继续编辑会在原处重新保存。</span>";
    bar.innerHTML = msg;
    bar.hidden = !msg;
    ED.contentEditable = n && (n.trashed || n.error || (n.lazy && n.text == null)) ? "false" : "true";
  }
  function syncToolbar() {
    if (!M) return;
    M.tb.querySelectorAll(".nt-viewseg button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === UI.view); });
    var n = E.path && notes[E.path], editable = (!!n && !n.trashed) || E.draft;
    ["format", "checklist", "table", "media", "link"].forEach(function (k) { var b = M.tb.querySelector('[data-b="' + k + '"]'); if (b) b.disabled = !editable || gridMode(); });
    M.tb.querySelector('[data-b="trash"]').disabled = gridMode() ? !UI.sel || !notes[UI.sel] : !(n || E.draft);
    M.tb.querySelector('[data-b="compose"]').disabled = UI.folder === "@trash" && !UI.query;
  }
  // 缩略图：图片的相对路径按备忘录所在的文件夹算
  var blobs = {};
  function imgURL(src, notePath, cb) {
    if (/^(https?:|data:|blob:)/.test(src)) return cb(src);
    var p = src.charAt(0) === "/" ? src : FS.norm ? FS.norm(src, dirOf(notePath)) : dirOf(notePath) + "/" + src;
    var st = FS.stat(p);
    if (!st) return cb("");
    var key = p + "|" + st.mtime + "|" + st.size;
    if (blobs[key]) return cb(blobs[key]);
    if (st.lazy) { if (FS.ensureLoaded) FS.ensureLoaded([p]).then(function () { var s2 = FS.stat(p); if (s2 && !s2.lazy) imgURL(src, notePath, cb); }); return; }
    try {
      var u8 = FS.readBinary(p), ext = (p.split(".").pop() || "png").toLowerCase();
      blobs[key] = URL.createObjectURL(new Blob([u8], { type: ext === "svg" ? "image/svg+xml" : "image/" + (ext === "jpg" ? "jpeg" : ext) }));
      cb(blobs[key]);
    } catch (e) { cb(""); }
  }
  function loadThumbs(root) {
    root.querySelectorAll(".nt-thumb[data-img]").forEach(function (el) {
      imgURL(el.dataset.img, el.dataset.note, function (u) { if (u) el.style.backgroundImage = "url(\"" + u + "\")"; });
    });
  }

  // ======== 当前在编辑的备忘录 ========
  var E = { path: null, draft: false, draftFolder: DEF, draftTitle: "", loaded: "", fm: [], dirty: false, conflict: null, saveT: 0, renameT: 0 };
  function openNote(p, keepFocus) {
    if (E.path === p && !E.draft) return;
    flush(true);
    var n = notes[p];
    UI.sel = p;
    saveUI();
    E.draft = false;
    E.conflict = null;
    if (!n) { E.path = null; loadEditor(""); renderAll(); return; }
    E.path = p;
    if (n.lazy && n.text == null) { if (FS.ensureLoaded) FS.ensureLoaded([p]); }
    E.loaded = n.text || "";
    E.fm = n.fm || [];
    loadEditor(n.body || "");
    M.main.querySelector(".nt-scroll").scrollTop = 0;
    renderAll();
    if (!keepFocus) M.main.querySelector(".nt-list").focus({ preventScroll: true });
  }
  function loadEditor(body) {
    ED.innerHTML = mdToHTML(body);
    fixBlocks();
    loadImages();
    E.dirty = false;
    hist.reset();
  }
  // 新建：先是草稿（不建文件），打了字才在当前文件夹里建（同 macOS：空着离开就没了）
  function newNote() {
    if (!M) open();
    flush(true);
    if (UI.view === "gallery") UI.galleryOpen = true;
    var f = UI.folder;
    if (UI.query || f.charAt(0) === "@" || f.charAt(0) === "#") f = UI.sel && notes[UI.sel] && !notes[UI.sel].trashed ? notes[UI.sel].folder || DEF : DEF;
    if (UI.query) { UI.query = ""; setSearch(""); }
    if (UI.folder === "@trash") UI.folder = f;
    E.path = null;
    E.draft = true;
    E.draftFolder = f;
    E.draftTitle = "";
    E.fm = [];
    E.loaded = "";
    E.conflict = null;
    UI.sel = null;
    loadEditor("");
    renderAll();
    placeAt(ED.firstChild, 0);
  }
  function markDirty() {
    E.dirty = true;
    clearTimeout(E.saveT);
    E.saveT = setTimeout(save, 600);
    if (E.draft && !E.path) {
      var t = firstLineText();
      if (t !== E.draftTitle) { E.draftTitle = t; var it = M.main.querySelector(".nt-it.draft .nt-it-t"); if (it) it.textContent = t || "新建备忘录"; }
    }
  }
  var firstLineText = function () { for (var b = ED.firstElementChild; b; b = b.nextElementSibling) { var t = b.textContent.trim(); if (t) return t.slice(0, 120); } return ""; };
  function nameFor(title) { return K.safeName(String(title || "").replace(/[:：\\/]/g, "-").replace(/[.]+$/, "").slice(0, 60), "新建备忘录"); }
  function freeFile(dir, name, self) {
    var p = dir + "/" + name + ".md", i = 2;
    while (FS.exists(p) && p !== self) p = dir + "/" + name + " " + i++ + ".md";
    return p;
  }
  function save() {
    clearTimeout(E.saveT);
    if (!E.dirty || E.conflict || !M) return;
    var md = toMd(ED), text = joinFront(E.fm, md);
    if (!E.path) {
      if (!E.draft || !plainLines(md).some(Boolean)) return;
      store.ensure();
      var dir = folderPath(E.draftFolder === "" ? DEF : E.draftFolder);
      try { if (!FS.isDir(dir)) FS.mkdirp(dir); } catch (e) { return; }
      var p = freeFile(dir, nameFor(firstLineText()));
      store.writeText(p, text);
      E.path = p;
      E.draft = false;
      E.loaded = text;
      E.dirty = false;
      UI.sel = p;
      saveUI();
      indexOne(p);
      renderSide();
      renderList();
      renderEditorChrome();
      return;
    }
    var disk = store.read(E.path);
    if (disk.lazy) { E.saveT = setTimeout(save, 800); return; } // 真沙盒里的版本还没取回来：比不了，等一等再存
    if (disk.error) return; // 读不了（二进制之类）：不写
    if (disk.text != null && disk.text !== E.loaded && disk.text !== text) { E.conflict = { text: disk.text }; renderEditorChrome(); return; }
    if (disk.text !== text) {
      try { store.writeText(E.path, text); } catch (e) { console.warn(e); return; }
    }
    E.loaded = text;
    E.dirty = false;
    indexOne(E.path);
    renderSide();
    renderList();
    M.main.querySelector(".nt-date").textContent = notes[E.path] ? fullDate(notes[E.path].mtime) : "";
    clearTimeout(E.renameT);
    E.renameT = setTimeout(function () { renameToTitle(); }, 1800);
  }
  // 存盘 + 文件名跟上标题（切换备忘录、关窗口、离开页面时）
  function flush(rename) {
    if (!M) return;
    if (E.dirty) save();
    if (rename) { clearTimeout(E.renameT); renameToTitle(); }
  }
  // 文件名跟上标题：等刚写的推到真沙盒以后再改名（不然那边丢掉那次写）；切到别的备忘录以后也照样改
  function renameToTitle() {
    var p = E.path, n = p && notes[p];
    if (!n || n.trashed || E.dirty || E.conflict) return;
    var want = nameFor(n.title), cur = stemOf(p).replace(/ \d+$/, "");
    if (want === cur || want === stemOf(p)) return;
    K.afterSync(function () {
      if (!notes[p] || !FS.exists(p) || (E.path === p && (E.dirty || E.conflict))) return;
      var np = freeFile(dirOf(p), nameFor(notes[p].title), p);
      if (np === p) return;
      try { store.move(p, np); } catch (e) { return; }
      delete notes[p];
      indexOne(np);
      if (E.path === p) E.path = np;
      if (UI.sel === p) { UI.sel = np; saveUI(); }
      renderList();
    });
  }
  // 外面（agent、终端）改了文件：列表、侧边栏重算；正在编辑的那篇——没改过就直接换成新的，改过了就问
  function onFiles() {
    scan();
    if (E.path && M) {
      var st = FS.stat(E.path);
      if (!st) {
        var same = !E.dirty && noteList().find(function (n) { return n.text === E.loaded && n.path !== E.path; });
        if (same) { E.path = same.path; UI.sel = same.path; saveUI(); }
        else if (!E.dirty) { E.path = null; UI.sel = null; loadEditor(""); }
      } else if (!st.lazy) {
        var t = null;
        try { t = FS.read(E.path); } catch (e) { t = null; }
        if (t != null && t !== E.loaded) {
          if (!E.dirty) {
            var sel = saveSel(), sc = M.main.querySelector(".nt-scroll").scrollTop, f = splitFront(t);
            E.loaded = t;
            E.fm = f.fm;
            loadEditor(f.body);
            if (document.activeElement === ED) restoreSel(sel);
            M.main.querySelector(".nt-scroll").scrollTop = sc;
          } else E.conflict = { text: t };
        }
      }
    }
    if (UI.sel && !notes[UI.sel] && !E.draft) UI.sel = E.path;
    if (M) renderAll();
    badgeTags();
  }
  function resolveConflict(which) {
    var c = E.conflict;
    if (!c) return;
    E.conflict = null;
    if (which === "theirs") { var f = splitFront(c.text); E.loaded = c.text; E.fm = f.fm; loadEditor(f.body); }
    else { E.loaded = c.text; E.dirty = true; save(); }
    renderAll();
  }
  function badgeTags() { /* 标签在侧边栏里：renderSide 画 */ }

  // ======== 编辑器：块、选区、撤销 ========
  function kindOf(b) {
    if (!b || b.nodeType !== 1) return "body";
    var t = b.nodeName;
    if (t === "H1") return "title";
    if (t === "H2") return "heading";
    if (t === "H3") return "subheading";
    if (t === "TABLE") return "table";
    var c = b.classList;
    if (c.contains("nt-mono")) return "mono";
    if (c.contains("nt-quote")) return "quote";
    if (c.contains("nt-li")) return b.dataset.t || "bullet";
    if (c.contains("nt-img")) return "img";
    return "body";
  }
  var isList = function (k) { return /^(bullet|dash|num|check)$/.test(k); };
  function makeBlock(kind, level) {
    var el;
    if (kind === "title") el = document.createElement("h1");
    else if (kind === "heading") el = document.createElement("h2");
    else if (kind === "subheading") el = document.createElement("h3");
    else if (kind === "mono" || kind === "quote") { el = document.createElement("div"); el.className = "nt-" + kind; }
    else if (isList(kind)) { el = document.createElement("div"); el.className = "nt-li"; el.dataset.t = kind; el.dataset.l = level || 0; }
    else el = document.createElement("p");
    return el;
  }
  function blockOf(n) {
    if (!n) return null;
    if (n === ED) return null;
    while (n && n.parentNode !== ED) { n = n.parentNode; if (!n || n === document) return null; }
    return n;
  }
  function blockAt(node, off) { if (node === ED) return ED.childNodes[Math.min(off, ED.childNodes.length - 1)] || null; return blockOf(node); }
  function curBlock() { var s = getSelection(); return s.rangeCount && ED.contains(s.anchorNode) ? blockAt(s.anchorNode, s.anchorOffset) : null; }
  function blocksInSel() {
    var s = getSelection();
    if (!s.rangeCount || !ED.contains(s.anchorNode)) return [];
    var r = s.getRangeAt(0), a = blockAt(r.startContainer, r.startOffset), b = blockAt(r.endContainer, r.endOffset), out = [];
    if (r.endContainer === ED && r.endOffset > 0 && !r.collapsed) b = ED.childNodes[r.endOffset - 1];
    for (var n = a; n; n = n.nextSibling) { if (n.nodeType === 1) out.push(n); if (n === b) break; }
    return out;
  }
  // 选区 ⇄ （第几块，块里第几个字）：DOM 换过了也能放回差不多的位置
  function pointOf(node, off) {
    var b = blockAt(node, off);
    if (!b) return null;
    var r = document.createRange();
    r.setStart(b, 0);
    try { if (node === ED) r.setEnd(b, 0); else r.setEnd(node, off); } catch (e) { return null; }
    return { bi: Array.prototype.indexOf.call(ED.childNodes, b), off: r.toString().length };
  }
  function pointTo(p) {
    var b = ED.childNodes[Math.min(p.bi, ED.childNodes.length - 1)];
    if (!b) return null;
    var left = p.off, w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT), t, last = null;
    while ((t = w.nextNode())) { last = t; if (left <= t.data.length) return { node: t, off: left }; left -= t.data.length; }
    if (last) return { node: last, off: last.data.length };
    return { node: b, off: 0 };
  }
  function saveSel() { var s = getSelection(); if (!s.rangeCount || !ED.contains(s.anchorNode)) return null; return { a: pointOf(s.anchorNode, s.anchorOffset), f: pointOf(s.focusNode, s.focusOffset) }; }
  function restoreSel(x) {
    if (!x || !x.a) return;
    var a = pointTo(x.a), f = pointTo(x.f || x.a);
    if (a && f) try { getSelection().setBaseAndExtent(a.node, a.off, f.node, f.off); } catch (e) { /* 忽略 */ }
  }
  function placeAt(b, off) {
    if (!b) return;
    ED.focus({ preventScroll: true });
    var p = pointTo({ bi: Array.prototype.indexOf.call(ED.childNodes, b), off: off === "end" ? 1e9 : off || 0 });
    if (p) getSelection().setBaseAndExtent(p.node, p.off, p.node, p.off);
    var r = b.getBoundingClientRect(), sc = M.main.querySelector(".nt-scroll"), sr = sc.getBoundingClientRect();
    if (r.bottom > sr.bottom - 20 || r.top < sr.top) b.scrollIntoView({ block: "nearest" });
  }
  var hasContent = function (b) { return !!(b.textContent.length || b.querySelector("img, table")); };
  // 撤销：自己记（编辑器里的改动有一半是这里的代码直接改 DOM，浏览器自带的撤销管不了）；连着打字 1 秒内算一步
  var hist = {
    past: [], future: [], t: 0, kind: "",
    reset: function () { this.past = []; this.future = []; this.t = 0; this.kind = ""; },
    state: function () { return { html: ED.innerHTML, sel: saveSel() }; },
    record: function (kind) {
      var now = Date.now();
      if ((kind === "type" || kind === "del") && kind === this.kind && now - this.t < 1000) { this.t = now; return; }
      this.past.push(this.state());
      if (this.past.length > 300) this.past.shift();
      this.future = [];
      this.t = now;
      this.kind = kind;
    },
    undo: function () { if (!this.past.length) return; this.future.push(this.state()); this.apply(this.past.pop()); },
    redo: function () { if (!this.future.length) return; this.past.push(this.state()); this.apply(this.future.pop()); },
    apply: function (s) { ED.innerHTML = s.html; loadImages(); ED.focus({ preventScroll: true }); restoreSel(s.sel); this.kind = ""; renumber(); markDirty(); },
  };
  // 整理：顶层只能是认得的块；去掉浏览器合并段落时塞进来的 style、font、span；编号列表重新数；表格、图片后面留一段能打字的
  function fixBlocks() {
    var sel = saveSel(), changed = false;
    Array.prototype.slice.call(ED.childNodes).forEach(function (n) {
      if (n.nodeType === 3) { if (!n.data.length) { n.remove(); return; } var p = document.createElement("p"); ED.insertBefore(p, n); p.appendChild(n); changed = true; return; }
      if (n.nodeType !== 1) { n.remove(); return; }
      var tag = n.nodeName;
      if (tag === "BR") { var p2 = document.createElement("p"); ED.insertBefore(p2, n); p2.appendChild(n); changed = true; return; }
      if (tag === "DIV" && !/\bnt-(mono|quote|li|img)\b/.test(n.className)) { retag(n, "p"); changed = true; return; }
      if (tag === "UL" || tag === "OL") { listToBlocks(n, tag === "OL" ? "num" : "bullet", 0); changed = true; return; }
      if (tag === "BLOCKQUOTE") { retag(n, "div").className = "nt-quote"; changed = true; return; }
      if (tag === "PRE") { var lines = n.textContent.split("\n"); lines.forEach(function (l) { var d = makeBlock("mono"); d.textContent = l; if (!l) d.innerHTML = "<br>"; ED.insertBefore(d, n); }); n.remove(); changed = true; return; }
      if (/^H[4-6]$/.test(tag)) { retag(n, "h3"); changed = true; return; }
      if (!/^(H1|H2|H3|P|DIV|TABLE)$/.test(tag)) { var p3 = document.createElement("p"); ED.insertBefore(p3, n); p3.appendChild(n); changed = true; }
    });
    ED.querySelectorAll("[style]").forEach(function (x) { if (!x.closest(".nt-img")) { x.removeAttribute("style"); changed = true; } });
    ED.querySelectorAll("font, span:not([class]), .Apple-converted-space").forEach(function (x) { unwrap(x); changed = true; });
    ED.querySelectorAll("strong, em, strike, del").forEach(function (x) { retag(x, { STRONG: "b", EM: "i", STRIKE: "s", DEL: "s" }[x.nodeName]); changed = true; });
    ED.querySelectorAll("p p, h1 p, h2 p, h3 p, .nt-li p, .nt-quote p, td p, p div, td div").forEach(function (x) { unwrap(x); changed = true; });
    Array.prototype.forEach.call(ED.children, function (b) {
      if (b.nodeName !== "TABLE" && !b.classList.contains("nt-img") && !hasContent(b) && !b.querySelector("br")) { b.appendChild(document.createElement("br")); changed = true; }
      if (b.classList.contains("nt-li") && b.dataset.l === undefined) b.dataset.l = 0;
    });
    if (!ED.firstChild) { ED.innerHTML = "<h1><br></h1>"; changed = true; }
    var last = ED.lastElementChild;
    if (last && (last.nodeName === "TABLE" || last.classList.contains("nt-img"))) { ED.appendChild(document.createElement("p")).appendChild(document.createElement("br")); changed = true; }
    ED.querySelectorAll("td:empty").forEach(function (td) { td.appendChild(document.createElement("br")); });
    renumber();
    if (changed && sel && document.activeElement === ED) restoreSel(sel);
    return changed;
  }
  function retag(el, tag) {
    var n = document.createElement(tag);
    while (el.firstChild) n.appendChild(el.firstChild);
    el.parentNode.replaceChild(n, el);
    return n;
  }
  function unwrap(el) { var p = el.parentNode; if (!p) return; while (el.firstChild) p.insertBefore(el.firstChild, el); el.remove(); }
  function listToBlocks(list, type, level) {
    Array.prototype.slice.call(list.children).forEach(function (li) {
      var d = makeBlock(type, level), sub = [];
      Array.prototype.slice.call(li.childNodes).forEach(function (c) { if (c.nodeName === "UL" || c.nodeName === "OL") sub.push(c); else d.appendChild(c); });
      if (!hasContent(d)) d.appendChild(document.createElement("br"));
      ED.insertBefore(d, list);
      sub.forEach(function (s) { ED.insertBefore(s, list); listToBlocks(s, s.nodeName === "OL" ? "num" : "bullet", Math.min(5, level + 1)); });
    });
    list.remove();
  }
  function renumber() {
    var cnt = [0, 0, 0, 0, 0, 0];
    Array.prototype.forEach.call(ED.children, function (b) {
      if (!b.classList.contains("nt-li")) { cnt = [0, 0, 0, 0, 0, 0]; return; }
      var l = Math.min(5, +b.dataset.l || 0);
      for (var k = l + 1; k < 6; k++) cnt[k] = 0;
      if (b.dataset.t === "num") { cnt[l]++; if (b.dataset.n !== String(cnt[l])) b.dataset.n = cnt[l]; }
      else { cnt[l] = 0; if (b.dataset.n) delete b.dataset.n; }
    });
  }
  function convert(b, kind) {
    if (kindOf(b) === kind || b.nodeName === "TABLE" || b.classList.contains("nt-img")) return b;
    var nb = makeBlock(kind, b.classList.contains("nt-li") ? b.dataset.l : 0);
    if (kind === "mono") nb.textContent = b.textContent;
    else while (b.firstChild) nb.appendChild(b.firstChild);
    if (!hasContent(nb) && !nb.querySelector("br")) nb.appendChild(document.createElement("br"));
    b.parentNode.replaceChild(nb, b);
    return nb;
  }
  // 段落样式（同「格式」菜单）：列表再点一次同样的 = 变回正文
  function setStyle(kind) {
    if (!editable()) return;
    var bs = blocksInSel().filter(function (b) { return b.nodeName !== "TABLE" && !b.classList.contains("nt-img"); });
    if (!bs.length) return;
    hist.record("op");
    var sel = saveSel(), all = bs.every(function (b) { return kindOf(b) === kind; });
    var target = isList(kind) && all ? "body" : kind;
    bs.forEach(function (b) { convert(b, target); });
    renumber();
    restoreSel(sel);
    markDirty();
  }
  function inlineFmt(cmd) {
    if (!editable()) return;
    ED.focus({ preventScroll: true });
    hist.record("op");
    document.execCommand(cmd === "strike" ? "strikeThrough" : cmd, false, null);
    fixBlocks();
    markDirty();
  }
  function indentBy(d) {
    if (!editable()) return;
    var bs = blocksInSel().filter(function (b) { return b.classList.contains("nt-li"); });
    if (!bs.length) return;
    hist.record("op");
    bs.forEach(function (b) { b.dataset.l = K.clamp((+b.dataset.l || 0) + d, 0, 5); });
    renumber();
    markDirty();
  }
  function toggleChecked(b) { if (b.dataset.c) delete b.dataset.c; else b.dataset.c = "1"; }
  function markChecked() {
    var bs = blocksInSel().filter(function (b) { return b.dataset.t === "check"; });
    if (!bs.length) return;
    hist.record("op");
    var on = !bs.every(function (b) { return b.dataset.c; });
    bs.forEach(function (b) { if (on) b.dataset.c = "1"; else delete b.dataset.c; });
    markDirty();
  }
  function checkAll(on) {
    var bs = Array.prototype.filter.call(ED.children, function (b) { return b.dataset && b.dataset.t === "check"; });
    if (!bs.length) return;
    hist.record("op");
    bs.forEach(function (b) { if (on) b.dataset.c = "1"; else delete b.dataset.c; });
    markDirty();
  }
  // 已勾选的挪到那一组核对清单的底部
  function checkedToBottom() {
    hist.record("op");
    var kids = Array.prototype.slice.call(ED.children), i = 0;
    while (i < kids.length) {
      if (kids[i].dataset && kids[i].dataset.t === "check") {
        var run = [];
        while (i < kids.length && kids[i].dataset && kids[i].dataset.t === "check") run.push(kids[i++]);
        var after = run[run.length - 1].nextSibling, order = run.filter(function (b) { return !b.dataset.c; }).concat(run.filter(function (b) { return b.dataset.c; }));
        order.forEach(function (b) { ED.insertBefore(b, after); });
      } else i++;
    }
    markDirty();
  }
  var editable = function () { return !!M && ED.isContentEditable && !gridMode(); };
  function splitBlock(b, setup) {
    var s = getSelection(), r = s.getRangeAt(0);
    if (!r.collapsed) r.deleteContents();
    var tail = document.createRange();
    tail.setStart(r.endContainer, r.endOffset);
    tail.setEnd(b, b.childNodes.length);
    var frag = tail.extractContents(), nb = b.cloneNode(false);
    if (setup) setup(nb);
    nb.appendChild(frag);
    b.parentNode.insertBefore(nb, b.nextSibling);
    [b, nb].forEach(function (x) { if (!x.textContent.length && !x.querySelector("img")) x.innerHTML = "<br>"; });
    placeAt(nb, 0);
    return nb;
  }
  function atBlockStart(b) {
    var s = getSelection();
    if (!s.isCollapsed) return false;
    var p = pointOf(s.anchorNode, s.anchorOffset);
    return !!p && p.off === 0 && ED.childNodes[p.bi] === b;
  }
  var cellOf = function (n) { var c = n && (n.nodeType === 1 ? n : n.parentNode); c = c && c.closest ? c.closest("td, th") : null; return c && ED.contains(c) ? c : null; };
  function placeInCell(td, end) {
    var r = document.createRange();
    r.selectNodeContents(td);
    r.collapse(!end);
    var s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  function newRow(table, after) {
    var cols = table.rows[0] ? table.rows[0].cells.length : 1, tr = document.createElement("tr");
    for (var i = 0; i < cols; i++) tr.appendChild(document.createElement("td")).appendChild(document.createElement("br"));
    (after || table.rows[table.rows.length - 1]).after(tr);
    return tr;
  }
  function moveCell(td, dir) {
    var table = td.closest("table"), cells = Array.prototype.slice.call(table.querySelectorAll("td, th")), i = cells.indexOf(td), next = cells[i + dir];
    if (!next && dir > 0) { hist.record("op"); next = newRow(table).cells[0]; markDirty(); }
    if (next) placeInCell(next, true);
  }
  function tableOp(td, op) {
    var table = td.closest("table"), tr = td.parentNode, ci = td.cellIndex;
    hist.record("op");
    if (op === "rowAbove" || op === "rowBelow") { var nr = newRow(table, tr); if (op === "rowAbove") tr.before(nr); placeInCell(nr.cells[ci] || nr.cells[0]); }
    if (op === "colLeft" || op === "colRight") Array.prototype.forEach.call(table.rows, function (row) { var c = document.createElement("td"); c.appendChild(document.createElement("br")); var ref = row.cells[ci]; if (op === "colLeft") row.insertBefore(c, ref); else row.insertBefore(c, ref ? ref.nextSibling : null); });
    if (op === "delRow") { if (table.rows.length > 1) tr.remove(); else op = "delTable"; }
    if (op === "delCol") { if (table.rows[0].cells.length > 1) Array.prototype.forEach.call(table.rows, function (row) { if (row.cells[ci]) row.cells[ci].remove(); }); else op = "delTable"; }
    if (op === "toText") {
      var ps = Array.prototype.map.call(table.rows, function (row) { var p = document.createElement("p"); p.textContent = Array.prototype.map.call(row.cells, function (c) { return c.textContent; }).join("\t"); if (!p.textContent) p.innerHTML = "<br>"; return p; });
      ps.forEach(function (p) { table.before(p); });
      table.remove();
    }
    if (op === "delTable") { var p = document.createElement("p"); p.innerHTML = "<br>"; table.replaceWith(p); placeAt(p, 0); }
    fixBlocks();
    markDirty();
  }
  function insertTable() {
    if (!editable()) return;
    ED.focus({ preventScroll: true });
    hist.record("op");
    var t = document.createElement("table");
    t.className = "nt-table";
    t.innerHTML = "<tbody>" + [0, 1, 2].map(function () { return "<tr><td><br></td><td><br></td><td><br></td></tr>"; }).join("") + "</tbody>";
    var b = curBlock() || ED.lastElementChild;
    if (b && !hasContent(b) && b !== ED.firstElementChild && b.nodeName === "P") b.replaceWith(t); else if (b) b.after(t); else ED.appendChild(t);
    fixBlocks();
    placeInCell(t.rows[0].cells[0]);
    markDirty();
  }
  // 贴 / 拖进来的图片：存进这个文件夹的 .attachments，正文里一行 ![](.attachments/…)
  function insertImages(files) {
    if (!editable() || !files.length) return;
    if (!E.path) { E.dirty = true; if (!firstLineText()) { var h1 = ED.firstElementChild; if (h1) h1.textContent = "图片"; } save(); }
    if (!E.path) return;
    var dir = dirOf(E.path) + "/" + ATT;
    hist.record("op");
    var at = curBlock() || ED.lastElementChild;
    Promise.all(files.map(function (f) {
      return f.arrayBuffer().then(function (buf) {
        var ext = ((f.type.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "svg").replace(/[^a-z0-9]/g, "") || "png");
        var name = "img-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + "." + ext;
        if (!FS.isDir(dir)) FS.mkdirp(dir);
        FS.writeBinary(dir + "/" + name, new Uint8Array(buf));
        return ATT + "/" + name;
      });
    })).then(function (srcs) {
      var tmp = document.createElement("div");
      tmp.innerHTML = srcs.map(function (s) { return imgHTML(s, ""); }).join("");
      var imgs = Array.prototype.slice.call(tmp.childNodes), ref = at && at.parentNode === ED ? at.nextSibling : null;
      // 光标在一个空行上：图片就占这一行（同 macOS）；插好以后光标放到图片下面一行
      var empty = at && at.parentNode === ED && at !== ED.firstElementChild && at.nodeName === "P" && !hasContent(at);
      imgs.forEach(function (n) { ED.insertBefore(n, empty ? at : ref); });
      var last = imgs[imgs.length - 1];
      if (!empty && (!last.nextElementSibling || last.nextElementSibling.classList.contains("nt-img"))) last.after(document.createElement("p"));
      fixBlocks();
      loadImages();
      placeAt(last.nextElementSibling || ED.lastElementChild, 0);
      markDirty();
    }).catch(function (e) { D.alert({ window: APP, title: "图片存不进去", message: e.message, icon: "caution", buttons: [{ label: "好", role: "default" }] }); });
  }
  function loadImages() {
    ED.querySelectorAll(".nt-img").forEach(function (b) {
      var img = b.querySelector("img") || b.appendChild(document.createElement("img"));
      imgURL(b.dataset.src || "", E.path || folderPath(E.draftFolder) + "/x.md", function (u) { if (u) img.src = u; else b.classList.add("missing"); });
    });
  }
  function insertBlocksHTML(html) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    var nodes = Array.prototype.slice.call(tmp.childNodes);
    if (!nodes.length) return;
    var b = curBlock();
    if (!b) { nodes.forEach(function (n) { ED.appendChild(n); }); fixBlocks(); return; }
    var s = getSelection(), r = s.getRangeAt(0);
    if (!r.collapsed) r.deleteContents();
    // 只有一段正文：直接插在光标处
    if (nodes.length === 1 && nodes[0].nodeName === "P") { document.execCommand("insertHTML", false, nodes[0].innerHTML); return; }
    var tail = splitBlock(b, null), anchor = tail;
    nodes.forEach(function (n) { ED.insertBefore(n, anchor); });
    if (!hasContent(b) && b !== ED.firstElementChild) b.remove();
    var lastIns = anchor.previousSibling;
    if (!hasContent(tail) && tail.nextSibling) tail.remove();
    fixBlocks();
    loadImages();
    if (lastIns && lastIns.parentNode === ED) placeAt(lastIns, "end");
  }
  function linkDialog() {
    if (!editable()) return;
    var s = getSelection();
    if (!s.rangeCount || !ED.contains(s.anchorNode)) { ED.focus(); return; }
    var range = s.getRangeAt(0).cloneRange(), a0 = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentNode).closest("a");
    if (a0 && !ED.contains(a0)) a0 = null;
    var box = document.createElement("div");
    box.className = "nt-linkbox";
    box.innerHTML = '<div class="ma-row"><span class="ma-lab">链接</span><input class="ma-field" data-k="url" spellcheck="false" placeholder="https://" value="' + escAttr(a0 ? a0.getAttribute("href") : "") + '"></div>' +
      (range.collapsed && !a0 ? '<div class="ma-row"><span class="ma-lab">显示文字</span><input class="ma-field" data-k="text" spellcheck="false"></div>' : "") +
      '<div class="ma-btns">' + (a0 ? '<button class="ma-pbtn" data-a="rm">移除链接</button><span class="ma-flex"></span>' : "") + '<button class="ma-pbtn" data-a="cancel">取消</button><button class="ma-pbtn default" data-a="ok">好</button></div>';
    var r0 = range.getBoundingClientRect();
    var pop = K.popover(r0.width || r0.height ? r0 : ED, box, { side: "bottom", className: "nt-pop" });
    var input = box.querySelector("[data-k=url]");
    setTimeout(function () { input.focus(); input.select(); }, 20);
    function done(ok, remove) {
      var url = input.value.trim(), tx = box.querySelector("[data-k=text]");
      pop.close();
      ED.focus({ preventScroll: true });
      var sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      if (!ok) return;
      hist.record("op");
      if (remove && a0) { unwrap(a0); markDirty(); return; }
      url = K.safeURL(url);
      if (!url) return;
      if (a0) a0.setAttribute("href", url);
      else if (range.collapsed) document.execCommand("insertHTML", false, '<a href="' + escAttr(url) + '">' + esc(tx && tx.value.trim() || url) + "</a>&#8203;");
      else document.execCommand("createLink", false, url);
      ED.querySelectorAll("a").forEach(function (a) { a.removeAttribute("target"); });
      fixBlocks();
      markDirty();
    }
    box.addEventListener("keydown", function (e) { if (e.isComposing || e.keyCode === 229) return; e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); done(true); } if (e.key === "Escape") { e.preventDefault(); done(false); } });
    box.addEventListener("click", function (e) { var b = e.target.closest("[data-a]"); if (!b) return; done(b.dataset.a !== "cancel", b.dataset.a === "rm"); });
  }
  function openURL(u) {
    u = K.safeURL(u);
    if (!u) return;
    if (/^https?:/i.test(u) && window.TSU_SAFARI && TSU_SAFARI.open) TSU_SAFARI.open(u); else window.open(u, "_blank", "noopener");
  }
  // 拷贝：纯文本那份放 Markdown（贴回备忘录、贴给 agent 都不丢格式）
  function onCopy(e, cut) {
    var s = getSelection();
    if (!s.rangeCount || s.isCollapsed) return;
    var r = s.getRangeAt(0), frag = r.cloneContents(), box = document.createElement("div");
    box.appendChild(frag);
    var md;
    if (box.querySelector("h1,h2,h3,p,div,table")) {
      var a = blockAt(r.startContainer, r.startOffset);
      if (a && box.firstElementChild && a.nodeName === box.firstElementChild.nodeName && a.className === box.firstElementChild.className) Object.keys(a.dataset).forEach(function (k) { box.firstElementChild.dataset[k] = a.dataset[k]; });
      md = toMd(box).replace(/\n$/, "");
    } else md = mdInline(box).replace(/\\([\\`*_{}\[\]()#+\-.!|~<>=])/g, function (m, c) { return /[*_`~=\[\]<\\]/.test(c) ? m : c; });
    e.clipboardData.setData("text/plain", box.querySelector("h1,h2,h3,p,div,table") ? md : s.toString());
    e.clipboardData.setData("text/html", box.innerHTML);
    e.preventDefault();
    if (cut && editable()) { hist.record("op"); r.deleteContents(); fixBlocks(); markDirty(); }
  }
  function bindEditor() {
    try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) { /* 老浏览器 */ }
    ED.addEventListener("beforeinput", function (e) {
      var t = e.inputType;
      if (t === "historyUndo") { e.preventDefault(); hist.undo(); return; }
      if (t === "historyRedo") { e.preventDefault(); hist.redo(); return; }
      hist.record(/^insert(Text|CompositionText|ReplacementText)$/.test(t) ? "type" : /^delete(Content|Word|Soft|Hard)/.test(t) ? "del" : t);
    });
    ED.addEventListener("input", function (e) {
      if (e.isComposing) { markDirty(); return; }
      if (e.inputType === "insertText" && / $/.test(e.data || "")) autoList();
      fixBlocks();
      markDirty();
    });
    ED.addEventListener("compositionend", function () { fixBlocks(); markDirty(); });
    ED.addEventListener("keydown", edKey);
    ED.addEventListener("mousedown", function (e) {
      // 核对清单：点前面的圆圈 = 勾选 / 取消
      var b = e.target.closest && e.target.closest(".nt-li[data-t=check]");
      if (b && b.parentNode === ED && ED.isContentEditable) {
        var r = b.getBoundingClientRect(), pad = parseFloat(getComputedStyle(b).paddingLeft) || 28;
        if (e.clientX < r.left + pad && e.clientX > r.left + pad - 30) { e.preventDefault(); hist.record("op"); toggleChecked(b); markDirty(); }
      }
    });
    ED.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a[href]");
      if (a && ED.contains(a) && getSelection().isCollapsed) { e.preventDefault(); openURL(a.getAttribute("href")); }
      var img = e.target.closest && e.target.closest(".nt-img");
      if (img) { ED.querySelectorAll(".nt-img.on").forEach(function (x) { x.classList.remove("on"); }); img.classList.add("on"); }
    });
    ED.addEventListener("contextmenu", function (e) {
      var td = cellOf(e.target);
      if (!td || !ED.isContentEditable) return;
      e.preventDefault();
      D.popup([
        { label: "在上方添加行", run: function () { tableOp(td, "rowAbove"); } }, { label: "在下方添加行", run: function () { tableOp(td, "rowBelow"); } },
        { label: "在左侧添加列", run: function () { tableOp(td, "colLeft"); } }, { label: "在右侧添加列", run: function () { tableOp(td, "colRight"); } }, K.SEP,
        { label: "删除行", run: function () { tableOp(td, "delRow"); } }, { label: "删除列", run: function () { tableOp(td, "delCol"); } }, K.SEP,
        { label: "将表格转换为文本", run: function () { tableOp(td, "toText"); } }, { label: "删除表格", run: function () { tableOp(td, "delTable"); } },
      ], { x: e.clientX, y: e.clientY });
    });
    ED.addEventListener("paste", function (e) {
      if (!editable()) return;
      var dt = e.clipboardData;
      if (!dt) return;
      var files = Array.prototype.filter.call(dt.files || [], function (f) { return /^image\//.test(f.type); });
      if (files.length) { e.preventDefault(); insertImages(files); return; }
      var text = dt.getData("text/plain");
      if (!text) return;
      e.preventDefault();
      hist.record("paste");
      text = text.replace(/\r\n?/g, "\n");
      if (cellOf(getSelection().anchorNode) || text.indexOf("\n") < 0) document.execCommand("insertText", false, cellOf(getSelection().anchorNode) ? text.replace(/\n/g, " ") : text);
      else insertBlocksHTML(mdToHTML(text));
      fixBlocks();
      markDirty();
    });
    ED.addEventListener("copy", function (e) { onCopy(e, false); });
    ED.addEventListener("cut", function (e) { onCopy(e, true); });
    ED.addEventListener("dragover", function (e) { if (Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0 && editable()) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
    ED.addEventListener("drop", function (e) {
      var files = Array.prototype.filter.call(e.dataTransfer.files || [], function (f) { return /^image\//.test(f.type); });
      if (!files.length) return;
      e.preventDefault();
      var pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(e.clientX, e.clientY) : null;
      if (pos && ED.contains(pos.offsetNode)) getSelection().collapse(pos.offsetNode, pos.offset);
      insertImages(files);
    });
    M.main.querySelector(".nt-scroll").addEventListener("mousedown", function (e) {
      // 点正文下面的空白：光标放到最后
      if (e.target.classList.contains("nt-scroll") && ED.isContentEditable) { e.preventDefault(); placeAt(ED.lastElementChild, "end"); }
    });
    M.main.querySelector(".nt-bar").addEventListener("click", function (e) {
      var b = e.target.closest("[data-bar]");
      if (!b) return;
      if (b.dataset.bar === "theirs" || b.dataset.bar === "mine") resolveConflict(b.dataset.bar);
      if (b.dataset.bar === "restore" && E.path) restoreNotes([E.path]);
    });
  }
  // 打字自动变列表："- " "* " "1. " "[] " 在一段的开头
  function autoList() {
    var b = curBlock();
    if (!b || b.nodeName !== "P") return;
    var s = getSelection(), p = pointOf(s.anchorNode, s.anchorOffset);
    if (!p) return;
    var head = b.textContent.slice(0, p.off).replace(/\u00a0/g, " "), m = /^(?:([-*•])|(\d{1,3})[.)]|(\[ ?\]|- \[ ?\]))\s$/.exec(head);
    if (!m) return;
    var kind = m[3] ? "check" : m[1] === "-" ? "dash" : m[1] ? "bullet" : "num";
    var r = document.createRange(), t = pointTo({ bi: p.bi, off: 0 }), e2 = pointTo({ bi: p.bi, off: head.length });
    r.setStart(t.node, t.off);
    r.setEnd(e2.node, e2.off);
    r.deleteContents();
    var nb = convert(b, kind);
    placeAt(nb, 0);
  }
  function edKey(e) {
    if (e.isComposing || e.keyCode === 229) return;
    var b = curBlock(), td = cellOf(getSelection().anchorNode), k = e.key;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (k === "z" || k === "Z")) { e.preventDefault(); if (e.shiftKey) hist.redo(); else hist.undo(); return; }
    if (k === "Enter") {
      if (td) { e.preventDefault(); if (e.shiftKey) { hist.record("op"); document.execCommand("insertLineBreak"); markDirty(); return; } var tr = td.parentNode, table = tr.closest("table"), below = tr.nextElementSibling; if (!below) { hist.record("op"); below = newRow(table); markDirty(); } placeInCell(below.cells[td.cellIndex] || below.cells[0], true); return; }
      if (!b) return;
      if (b.classList.contains("nt-li")) {
        e.preventDefault();
        hist.record("op");
        if (e.shiftKey) { document.execCommand("insertLineBreak"); markDirty(); return; }
        if (!b.textContent.trim() && !b.querySelector("img")) { if (+b.dataset.l > 0) b.dataset.l = +b.dataset.l - 1; else placeAt(convert(b, "body"), 0); renumber(); markDirty(); return; }
        splitBlock(b, function (nb) { delete nb.dataset.c; delete nb.dataset.n; });
        renumber();
        markDirty();
        return;
      }
      if ((b.classList.contains("nt-quote") || b.classList.contains("nt-mono")) && !b.textContent.length) { e.preventDefault(); hist.record("op"); placeAt(convert(b, "body"), 0); markDirty(); return; }
      if (e.shiftKey && b.nodeName === "P") { e.preventDefault(); hist.record("op"); splitBlock(b, null); markDirty(); }
      return;
    }
    if (k === "Tab") {
      if (td) { e.preventDefault(); moveCell(td, e.shiftKey ? -1 : 1); return; }
      var lis = blocksInSel().filter(function (x) { return x.classList.contains("nt-li"); });
      e.preventDefault();
      if (lis.length) { indentBy(e.shiftKey ? -1 : 1); return; }
      if (!e.shiftKey) { hist.record("op"); document.execCommand("insertText", false, "\t"); }
      return;
    }
    if (k === "Backspace" && b && atBlockStart(b) && !td) {
      if (b.classList.contains("nt-li")) { e.preventDefault(); hist.record("op"); if (+b.dataset.l > 0) b.dataset.l = +b.dataset.l - 1; else placeAt(convert(b, "body"), 0); renumber(); markDirty(); return; }
      if (b.classList.contains("nt-quote") || b.classList.contains("nt-mono")) { var pv = b.previousElementSibling; if (!pv || kindOf(pv) !== kindOf(b)) { e.preventDefault(); hist.record("op"); placeAt(convert(b, "body"), 0); markDirty(); return; } }
      var prev = b.previousElementSibling;
      if (prev && prev.classList.contains("nt-img")) { e.preventDefault(); hist.record("op"); prev.remove(); markDirty(); return; }
      if (prev && prev.nodeName === "TABLE") { e.preventDefault(); if (!hasContent(b)) { hist.record("op"); b.remove(); markDirty(); } var lc = prev.rows[prev.rows.length - 1]; if (lc) placeInCell(lc.cells[lc.cells.length - 1], true); return; }
    }
    if ((k === "Backspace" || k === "Delete") && ED.querySelector(".nt-img.on")) { e.preventDefault(); hist.record("op"); ED.querySelectorAll(".nt-img.on").forEach(function (x) { x.remove(); }); fixBlocks(); markDirty(); return; }
    var cmd = e.metaKey && !e.ctrlKey;
    if (cmd && !e.shiftKey && !e.altKey && (k === "b" || k === "i" || k === "u")) { e.preventDefault(); inlineFmt({ b: "bold", i: "italic", u: "underline" }[k]); return; }
    if (cmd && !e.shiftKey && !e.altKey && k === "k") { e.preventDefault(); linkDialog(); return; }
    if (cmd && (e.code === "BracketRight" || e.code === "BracketLeft") && !e.shiftKey) { e.preventDefault(); indentBy(e.code === "BracketRight" ? 1 : -1); return; }
    if (cmd && e.shiftKey && !e.altKey) {
      var map = { KeyH: "heading", KeyJ: "subheading", KeyB: "body", KeyM: "mono", Digit7: "bullet", Digit8: "dash", Digit9: "num", KeyL: "check" };
      if (map[e.code]) { e.preventDefault(); setStyle(map[e.code]); return; }
      if (e.code === "KeyU") { e.preventDefault(); markChecked(); return; }
      if (e.code === "KeyX") { e.preventDefault(); inlineFmt("strike"); return; }
    }
    if (cmd && e.altKey && !e.shiftKey && e.code === "KeyT") { e.preventDefault(); insertTable(); return; }
    if (cmd && e.code === "Quote" && !e.shiftKey) { e.preventDefault(); setStyle("quote"); return; }
    if (e.key === "Escape") { ED.blur(); M.main.querySelector(".nt-list").focus({ preventScroll: true }); }
  }

  // ======== 格式（Aa）浮层 ========
  var fmtPop = null;
  var STYLES = [["title", "标题"], ["heading", "标头"], ["subheading", "副标头"], ["body", "正文"], ["mono", "等宽"], ["bullet", "•  项目符号列表"], ["dash", "–  短划线列表"], ["num", "1. 编号列表"], ["quote", "▏ 块引用"]];
  function formatPop(anchor) {
    if (!editable()) return;
    if (fmtPop) { fmtPop.close(); return; }
    var saved = saveSel();
    if (!saved) { placeAt(ED.lastElementChild, "end"); saved = saveSel(); }
    var box = document.createElement("div");
    box.className = "nt-fmt";
    function draw() {
      var k = kindOf(curBlock());
      box.innerHTML = '<div class="nt-fmt-list">' + STYLES.map(function (s) { return '<button data-s="' + s[0] + '" class="nt-s-' + s[0] + (k === s[0] ? " on" : "") + '">' + esc(s[1]) + "</button>"; }).join("") + "</div>" +
        '<div class="nt-fmt-row">' + [["bold", "<b>B</b>"], ["italic", "<i>I</i>"], ["underline", "<u>U</u>"], ["strike", "<s>S</s>"]].map(function (x) {
          var on = false;
          try { on = document.queryCommandState(x[0] === "strike" ? "strikeThrough" : x[0]); } catch (e) { on = false; }
          return '<button data-x="' + x[0] + '" class="' + (on ? "on" : "") + '">' + x[1] + "</button>";
        }).join("") + '</div><div class="nt-fmt-row"><button data-x="outdent" title="减小缩进">⇤</button><button data-x="indent" title="增大缩进">⇥</button></div>';
    }
    box.addEventListener("mousedown", function (e) { e.preventDefault(); });
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      ED.focus({ preventScroll: true });
      restoreSel(saved);
      if (b.dataset.s) setStyle(b.dataset.s);
      else if (b.dataset.x === "indent" || b.dataset.x === "outdent") indentBy(b.dataset.x === "indent" ? 1 : -1);
      else inlineFmt(b.dataset.x);
      saved = saveSel();
      draw();
    });
    ED.focus({ preventScroll: true });
    restoreSel(saved);
    draw();
    fmtPop = K.popover(anchor, box, { side: "bottom", className: "nt-pop", onClose: function () { fmtPop = null; } });
  }

  // ======== 备忘录的操作：删除、恢复、移动、置顶 ========
  function notePaths(ids) { return (ids || []).filter(function (p) { return notes[p]; }); }
  function attachmentsOf(n) { var out = [], re = /!\[[^\]]*\]\((\.attachments\/[^)\s]+)\)/g, m, b = n && n.body || ""; while ((m = re.exec(b))) out.push(m[1]); return out; }
  // 挪一篇：连着它用到的图片一起挪
  function moveNote(from, toDir, keepName) {
    var n = notes[from];
    if (!FS.isDir(toDir)) FS.mkdirp(toDir);
    var to = keepName ? freeFile(toDir, stemOf(from)) : toDir + "/" + baseOf(from);
    if (FS.exists(to)) to = freeFile(toDir, stemOf(from));
    attachmentsOf(n).forEach(function (a) {
      var src = dirOf(from) + "/" + a, dst = toDir + "/" + a;
      try { if (FS.exists(src) && !FS.exists(dst)) { if (!FS.isDir(dirOf(dst))) FS.mkdirp(dirOf(dst)); FS.move(src, dst); } } catch (e) { /* 图片挪不动就留在原处 */ }
    });
    store.move(from, to);
    if (E.path === from) E.path = to;
    if (UI.sel === from) UI.sel = to;
    return to;
  }
  function deleteNotes(paths) {
    paths = notePaths(paths);
    if (!paths.length) return;
    flush(false);
    if (paths.every(function (p) { return notes[p].trashed; })) return eraseNotes(paths);
    var next = neighbor(paths);
    K.afterSync(function () {
      paths.forEach(function (p) {
        var n = notes[p];
        if (!n || n.trashed || !FS.exists(p)) return;
        moveNote(p, TRASH + (n.folder ? "/" + n.folder : "/" + DEF), false);
      });
      if (paths.indexOf(E.path) >= 0 || E.path && !FS.exists(E.path)) { E.path = null; E.draft = false; }
      UI.sel = next;
      afterOps();
      if (next && notes[next]) openNote(next, true);
    });
  }
  // 最近删除里再删：移到废纸篓（~/.Trash，访达里还能放回原处）
  function eraseNotes(paths) {
    var what = paths.length === 1 ? "“" + notes[paths[0]].title + "”" : "这 " + paths.length + " 个备忘录";
    D.alert({ window: APP, title: "要永久删除" + what + "吗？", message: "文件会移到废纸篓，在访达里还可以放回原处。", icon: "caution",
      buttons: [{ label: "取消", role: "cancel" }, { label: "删除", role: "destructive" }] }).then(function (b) {
      if (b !== "删除") return;
      var all = [];
      paths.forEach(function (p) { all.push(p); attachmentsOf(notes[p]).forEach(function (a) { var ap = dirOf(p) + "/" + a; if (FS.exists(ap)) all.push(ap); }); });
      var F = window.TSU_FINDER;
      if (F && F.trash) F.trash(all);
      if (paths.indexOf(E.path) >= 0) { E.path = null; }
      UI.sel = null;
      afterOps();
    });
  }
  // 恢复：放回原来的文件夹（没了就重建），然后到那个文件夹里选中它
  function restoreNotes(paths) {
    paths = notePaths(paths);
    K.afterSync(function () {
      var last = null, lastF = null;
      paths.forEach(function (p) {
        if (!FS.exists(p)) return;
        var rel = relOf(dirOf(p)).replace(/^\.Trash\/?/, "");
        last = moveNote(p, folderPath(rel || DEF), true);
        lastF = rel || DEF;
      });
      if (lastF && !trashCountAfter()) UI.folder = lastF;
      afterOps();
      if (last) { E.path = null; openNote(last, true); }
    });
  }
  var trashCountAfter = function () { scan(); return trashCount(); };
  function moveNotesTo(paths, folder) {
    paths = notePaths(paths);
    if (!paths.length) return;
    flush(false);
    K.afterSync(function () {
      paths.forEach(function (p) { if (notes[p] && FS.exists(p) && (notes[p].folder !== folder || notes[p].trashed)) moveNote(p, folderPath(folder || DEF), true); });
      afterOps();
    });
  }
  function togglePin(p) {
    var n = notes[p];
    if (!n || n.trashed) return;
    if (p === E.path) flush(false);
    var r = store.read(p);
    if (r.text == null) return;
    var f = splitFront(r.text), on = f.meta.pinned !== true;
    var text = joinFront(setFront(f.fm, "pinned", on ? "true" : undefined), f.body);
    store.writeText(p, text);
    if (p === E.path) { E.loaded = text; E.fm = splitFront(text).fm; }
    indexOne(p);
    renderList();
  }
  function neighbor(paths) {
    var list = sorted(inView()).map(function (n) { return n.path; }), i = list.indexOf(paths[0]);
    var rest = list.filter(function (p) { return paths.indexOf(p) < 0; });
    return rest[Math.min(Math.max(0, i), rest.length - 1)] || null;
  }
  function afterOps() { scan(); if (UI.folder === "@trash" && !trashCount()) UI.folder = DEF; saveUI(); if (E.path && !notes[E.path]) E.path = null; renderAll(); }
  // ---- 文件夹 ----
  function newFolder(parent) {
    store.ensure();
    var base = parent ? parent + "/" : "", name = "新建文件夹", i = 2;
    while (FS.exists(folderPath(base + name))) name = "新建文件夹 " + i++;
    FS.mkdirp(folderPath(base + name));
    if (parent) delete UI.collapsed[parent];
    scan();
    UI.folder = base + name;
    UI.query = "";
    setSearch("");
    saveUI();
    renderAll();
    var row = M.side.querySelector('.nt-f[data-f="' + CSS.escape(base + name) + '"]');
    if (row) renameFolderInline(row);
  }
  function renameFolderInline(row) {
    var f = row.dataset.f, nm = row.querySelector(".nt-fname");
    if (!f || f.charAt(0) === "@") return;
    nm.contentEditable = "plaintext-only";
    nm.classList.add("renaming");
    nm.focus();
    var r = document.createRange();
    r.selectNodeContents(nm);
    var s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    var fin = function (ok) {
      nm.removeEventListener("keydown", key);
      nm.removeEventListener("blur", blur);
      nm.contentEditable = "false";
      nm.classList.remove("renaming");
      var name = K.safeName(nm.textContent.replace(/[:：]/g, "-"), "");
      if (ok && name && name.charAt(0) !== "." && name !== f.slice(f.lastIndexOf("/") + 1)) renameFolder(f, name);
      else renderSide();
    };
    var key = function (e) { if (e.isComposing || e.keyCode === 229) return; e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); fin(true); } if (e.key === "Escape") { e.preventDefault(); fin(false); } };
    var blur = function () { fin(true); };
    nm.addEventListener("keydown", key);
    nm.addEventListener("blur", blur);
  }
  function renameFolder(f, name) {
    var parent = f.indexOf("/") >= 0 ? f.slice(0, f.lastIndexOf("/")) + "/" : "", to = parent + name;
    if (FS.exists(folderPath(to))) { D.alert({ window: APP, title: "已经有一个叫“" + name + "”的文件夹了", icon: "caution", buttons: [{ label: "好", role: "default" }] }); renderSide(); return; }
    flush(false);
    K.afterSync(function () {
      if (!FS.exists(folderPath(f))) return;
      store.move(folderPath(f), folderPath(to));
      var fix = function (p) { return p && (p === folderPath(f) || p.indexOf(folderPath(f) + "/") === 0) ? folderPath(to) + p.slice(folderPath(f).length) : p; };
      E.path = fix(E.path);
      UI.sel = fix(UI.sel);
      if (UI.folder === f || UI.folder.indexOf(f + "/") === 0) UI.folder = to + UI.folder.slice(f.length);
      afterOps();
    });
  }
  // 删除文件夹：里面的备忘录进「最近删除」（连同文件夹的结构和图片），空了的文件夹移到废纸篓
  function deleteFolder(f) {
    var inside = noteList().filter(function (n) { return !n.trashed && (n.folder === f || n.folder.indexOf(f + "/") === 0); });
    D.alert({ window: APP, title: "要删除文件夹“" + folderName(f) + "”吗？", icon: "caution",
      message: inside.length ? "其中的 " + inside.length + " 个备忘录会移到“最近删除”。" : "这个文件夹是空的。",
      buttons: [{ label: "取消", role: "cancel" }, { label: "删除", role: "destructive" }] }).then(function (b) {
      if (b !== "删除") return;
      flush(false);
      K.afterSync(function () {
        if (!FS.exists(folderPath(f))) return;
        mergeMove(folderPath(f), TRASH + "/" + f);
        if (UI.folder === f || UI.folder.indexOf(f + "/") === 0) UI.folder = DEF;
        if (E.path && E.path.indexOf(folderPath(f) + "/") === 0) { E.path = null; UI.sel = null; }
        afterOps();
      });
    });
  }
  function mergeMove(src, dst) {
    if (!FS.exists(dst)) { if (!FS.isDir(dirOf(dst))) FS.mkdirp(dirOf(dst)); store.move(src, dst); return; }
    FS.list(src).forEach(function (c) {
      var t = dst + "/" + baseOf(c);
      if (FS.isDir(c)) mergeMove(c, t);
      else store.move(c, FS.exists(t) ? freeFile(dst, stemOf(c)) : t);
    });
    try { if (!FS.list(src).length) { var F = window.TSU_FINDER; if (F && F.trash) F.trash([src]); } } catch (e) { /* 留着 */ }
  }
  function emptyTrash() {
    var all = noteList().filter(function (n) { return n.trashed; });
    if (!all.length) return;
    D.alert({ window: APP, title: "要永久删除“最近删除”中的全部 " + all.length + " 个备忘录吗？", message: "文件会移到废纸篓，在访达里还可以放回原处。", icon: "caution",
      buttons: [{ label: "取消", role: "cancel" }, { label: "全部删除", role: "destructive" }] }).then(function (b) {
      if (b !== "全部删除") return;
      var F = window.TSU_FINDER;
      if (F && F.trash) F.trash(FS.list(TRASH));
      if (E.path && E.path.indexOf(TRASH + "/") === 0) E.path = null;
      afterOps();
    });
  }
  // ---- 分享 / 导出 ----
  function exportMd(n) {
    var r = store.read(n.path), text = r.text != null ? r.text : n.text || "";
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    a.download = baseOf(n.path);
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  // 导出为 PDF：标题 + 正文，样子同编辑器（纸是白的）。在 Paimon App 里存成真的 PDF 文件（~/Documents/<标题>.pdf，重名加个号），
  // 发通知，点一下在访达里显示；浏览器里出不了文件：打开打印对话框（只印这篇），在里面选「存储为 PDF」
  var PDF_CSS = 'body{margin:0;font:14px/1.55 -apple-system,"PingFang SC","Helvetica Neue",sans-serif;color:#1d1d1f;word-break:break-word;overflow-wrap:anywhere;tab-size:4}' +
    "h1{font-size:24px;line-height:1.3;font-weight:700;margin:0 0 2px}h2{font-size:18px;line-height:1.4;font-weight:700;margin:0}h3{font-size:15px;line-height:1.45;font-weight:600;margin:0}" +
    "h1,h2,h3{break-after:avoid;page-break-after:avoid}p{margin:0;white-space:pre-wrap}" +
    '.nt-mono{font:13px/1.55 ui-monospace,"SF Mono",Menlo,monospace;white-space:pre-wrap}.nt-quote{border-left:3px solid rgba(0,0,0,.22);padding-left:13px;margin-left:2px;white-space:pre-wrap}' +
    ".nt-li{position:relative;padding-left:calc(26px + var(--l,0)*26px);white-space:pre-wrap;break-inside:avoid}" +
    '.nt-li[data-l="1"]{--l:1}.nt-li[data-l="2"]{--l:2}.nt-li[data-l="3"]{--l:3}.nt-li[data-l="4"]{--l:4}.nt-li[data-l="5"]{--l:5}' +
    ".nt-li::before{position:absolute;left:calc(var(--l,0)*26px);width:22px;text-align:center}" +
    '.nt-li[data-t="bullet"]::before{content:"•";font-size:1.15em;line-height:1.35}.nt-li[data-t="bullet"][data-l="1"]::before,.nt-li[data-t="bullet"][data-l="4"]::before{content:"◦"}' +
    '.nt-li[data-t="bullet"][data-l="2"]::before,.nt-li[data-t="bullet"][data-l="5"]::before{content:"▪";font-size:.8em;line-height:1.95}.nt-li[data-t="dash"]::before{content:"–"}' +
    '.nt-li[data-t="num"]::before{content:attr(data-n) ".";text-align:right;width:20px;font-variant-numeric:tabular-nums}' +
    '.nt-li[data-t="check"]{padding-left:calc(30px + var(--l,0)*26px)}.nt-li[data-t="check"]::before{content:"";top:2px;left:calc(var(--l,0)*26px + 2px);width:18px;height:18px;box-sizing:border-box;border-radius:50%;border:1.5px solid rgba(60,60,67,.35)}' +
    ".nt-li[data-t=\"check\"][data-c]::before{border:0;background:#ffcc00 url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='m2.6 6.3 2.3 2.3 4.6-5' fill='none' stroke='%23fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\") center/12px no-repeat}" +
    '.nt-li[data-t="check"][data-c]{color:#8e8e93}h1+.nt-li,h2+.nt-li,.nt-li[data-t="check"]+.nt-li[data-t="check"]{margin-top:2px}' +
    'a{color:#b58500;text-decoration:underline;text-underline-offset:2px}code{font:12.5px ui-monospace,"SF Mono",Menlo,monospace;padding:1px 4px;border-radius:4px;background:rgba(0,0,0,.05)}mark{background:rgba(255,204,0,.45);color:inherit;border-radius:2px}' +
    "table.nt-table{border-collapse:collapse;margin:6px 0;min-width:60%;max-width:100%}td{border:1px solid rgba(0,0,0,.16);padding:6px 10px;min-width:64px;vertical-align:top;text-align:left;white-space:pre-wrap}tr{break-inside:avoid}" +
    ".nt-img{margin:6px 0;break-inside:avoid}.nt-img img{display:block;max-width:100%;max-height:520px;border-radius:8px}";
  function exportPDF(n) {
    var P = window.TSU_PDF, box = document.createElement("div"), cnt = [0, 0, 0, 0, 0, 0];
    if (!P) return;
    box.innerHTML = mdToHTML(n.body || "");
    // 编号列表：同编辑器那样数（别的块打断就重新数，更深的一级每次重新数）
    Array.prototype.forEach.call(box.children, function (b) { if (!b.classList.contains("nt-li")) { cnt = [0, 0, 0, 0, 0, 0]; return; } var l = +b.dataset.l || 0; for (var k = l + 1; k < 6; k++) cnt[k] = 0; if (b.dataset.t === "num") b.dataset.n = ++cnt[l]; });
    box.querySelectorAll("[contenteditable]").forEach(function (x) { x.removeAttribute("contenteditable"); });
    return Promise.all(Array.prototype.map.call(box.querySelectorAll(".nt-img"), function (b) {
      return new Promise(function (res) {
        var t = setTimeout(function () { b.remove(); res(); }, 8000); // 真沙盒里的大图要先取回来；取不到就不印这张
        imgURL(b.dataset.src, n.path, function (u) { clearTimeout(t); if (u) b.querySelector("img").src = u; else b.remove(); res(); });
      });
    })).then(function () {
      var name = String(n.title || "").replace(/[\/\u0000-\u001f]/g, "-").trim() || "未命名", o = { title: n.title || name, html: box.innerHTML, css: PDF_CSS, page: "A4", margin: 54 };
      if (!P.native) return P.print(o);
      return P.save(Object.assign(o, { path: FS.HOME + "/Documents/" + name + ".pdf", app: APP }));
    }).catch(function (e) { D.alert({ window: APP, title: "没能导出 PDF", message: e.message, icon: "caution", buttons: [{ label: "好", role: "default" }] }); });
  }
  function copyNote(n, md) {
    var text = md ? (n.body || "") : plainLines(n.body || "").join("\n");
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
  }
  function revealFile(p) { var F = window.TSU_FINDER; if (F && F.reveal) F.reveal(p); }
  function shareMenu(n) {
    return [
      { label: "拷贝为纯文本", disabled: !n, run: function () { copyNote(n, false); } },
      { label: "拷贝为 Markdown", disabled: !n, run: function () { copyNote(n, true); } },
      K.SEP,
      { label: "导出为 PDF…", disabled: !n, run: function () { flush(false); exportPDF(notes[n.path] || n); } },
      { label: "导出为 Markdown…", disabled: !n, run: function () { flush(false); exportMd(notes[n.path] || n); } },
      K.SEP,
      { label: "在访达中显示", disabled: !n, run: function () { revealFile(n.path); } },
      { label: "在编辑器中打开", disabled: !n || !window.TSU_IDE, run: function () { flush(false); TSU_IDE.open(n.path); } },
    ];
  }
  function noteMenu(paths) {
    var ns = notePaths(paths).map(function (p) { return notes[p]; });
    if (!ns.length) return [];
    var n = ns[0], trash = ns.every(function (x) { return x.trashed; });
    if (trash) return [{ label: "恢复", run: function () { restoreNotes(paths); } }, K.SEP, { label: "永久删除…", run: function () { eraseNotes(paths); } }];
    var flist = folders.slice();
    if (flist.indexOf(DEF) < 0) flist.unshift(DEF);
    return [
      { label: n.pinned ? "取消置顶备忘录" : "置顶备忘录", disabled: ns.length > 1, run: function () { togglePin(n.path); } },
      K.SEP,
      { label: "移到", items: flist.map(function (f) { return { label: new Array(f.split("/").length).join("   ") + folderName(f), checked: ns.every(function (x) { return (x.folder || DEF) === f; }), run: function () { moveNotesTo(paths, f); } }; }) },
      { label: "共享", items: shareMenu(n) },
      K.SEP,
      { label: "删除", keys: "⌘⌫", run: function () { deleteNotes(paths); } },
    ];
  }

  // ======== 事件：工具栏、侧边栏、列表 ========
  function setSearch(v) { if (!M) return; var i = M.tb.querySelector(".ma-search input"); if (i.value !== v) i.value = v; M.tb.querySelector(".ma-search").classList.toggle("has", !!v); }
  function bindToolbar() {
    M.tb.addEventListener("click", function (e) {
      var v = e.target.closest(".nt-viewseg button");
      if (v) { UI.view = v.dataset.v; UI.galleryOpen = false; saveUI(); renderAll(); return; }
      var b = e.target.closest("[data-b]");
      if (!b || b.disabled) return;
      tbAction(b.dataset.b, b);
    });
    var input = M.tb.querySelector(".ma-search input");
    input.addEventListener("input", function () { flush(false); UI.query = input.value.trim(); M.tb.querySelector(".ma-search").classList.toggle("has", !!input.value); renderAll(); });
    input.addEventListener("keydown", function (e) { if (e.isComposing || e.keyCode === 229) return;
      e.stopPropagation();
      if (e.key === "Escape") { input.value = ""; UI.query = ""; setSearch(""); renderAll(); input.blur(); }
      if (e.key === "Enter" || e.key === "ArrowDown") { var first = M.main.querySelector(".nt-it:not(.draft)"); if (first) { openNote(first.dataset.p); } }
    });
    M.tb.querySelector(".ma-clear").addEventListener("mousedown", function (e) { e.preventDefault(); input.value = ""; UI.query = ""; setSearch(""); renderAll(); });
    // 列表那一栏的宽度可以拖
    var split = M.main.querySelector(".nt-lsplit");
    split.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      var x0 = e.clientX, w0 = UI.listW;
      split.setPointerCapture(e.pointerId);
      var move = function (ev) { UI.listW = K.clamp(w0 + ev.clientX - x0, 200, 480); M.win.el.style.setProperty("--nt-lw", UI.listW + "px"); };
      var up = function () { split.removeEventListener("pointermove", move); split.removeEventListener("pointerup", up); K.store.set("tsu-notes-listw", UI.listW); };
      split.addEventListener("pointermove", move);
      split.addEventListener("pointerup", up);
    });
  }
  // 工具栏上一个按钮做的事；手机上的版式用自己的按钮调进来（b = 那个按钮：浮层、菜单挂在它旁边）
  function tbAction(k, b) {
    var cur = E.path && notes[E.path];
    if (k === "sidebar") M.toggleSide();
    if (k === "back") { flush(true); UI.galleryOpen = false; renderAll(); }
    if (k === "trash") { if (gridMode()) { if (UI.sel) deleteNotes([UI.sel]); } else if (E.draft && !E.path) { E.draft = false; loadEditor(""); renderAll(); } else if (cur) deleteNotes([cur.path]); }
    if (k === "compose") newNote();
    if (k === "format") formatPop(b);
    if (k === "checklist") { ED.focus({ preventScroll: true }); if (!curBlock()) placeAt(ED.lastElementChild, "end"); setStyle("check"); }
    if (k === "table") { if (!curBlock()) placeAt(ED.lastElementChild, "end"); insertTable(); }
    if (k === "media") pickImages();
    if (k === "link") linkDialog();
    if (k === "share") D.popup(shareMenu(cur || null), { x: b.getBoundingClientRect().left, y: b.getBoundingClientRect().bottom + 6 });
  }
  function pickImages() {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.multiple = true;
    inp.onchange = function () { if (!curBlock()) placeAt(ED.lastElementChild, "end"); insertImages(Array.prototype.slice.call(inp.files || [])); };
    inp.click();
  }
  function selectFolder(f) {
    flush(true);
    UI.folder = f;
    UI.query = "";
    setSearch("");
    UI.galleryOpen = false;
    var list = sorted(inView());
    if (!list.some(function (n) { return n.path === E.path; })) { if (list[0]) openNote(list[0].path, true); else { E.path = null; E.draft = false; UI.sel = null; loadEditor(""); } }
    saveUI();
    renderAll();
  }
  function bindSide() {
    var side = M.side;
    side.addEventListener("click", function (e) {
      if (e.target.closest(".nt-newf")) return newFolder(null);
      var disc = e.target.closest("[data-disc]"), row = e.target.closest(".nt-f"), tag = e.target.closest("[data-tag]");
      if (disc && row) { UI.collapsed[row.dataset.f] = !UI.collapsed[row.dataset.f]; saveUI(); renderSide(); return; }
      if (row && !e.target.closest(".renaming") && (UI.query || UI.folder !== row.dataset.f)) selectFolder(row.dataset.f);
      if (tag && (UI.query || UI.folder !== "#" + tag.dataset.tag)) selectFolder("#" + tag.dataset.tag);
    });
    side.addEventListener("dblclick", function (e) {
      var row = e.target.closest(".nt-f");
      if (!row || !e.target.closest(".nt-fname") || row.dataset.f.charAt(0) === "@" || row.dataset.f === DEF) return;
      var cur = M.side.querySelector('.nt-f[data-f="' + CSS.escape(row.dataset.f) + '"]');
      if (cur) renameFolderInline(cur);
    });
    side.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      var row = e.target.closest(".nt-f");
      if (!row) return D.popup([{ label: "新建文件夹", run: function () { newFolder(null); } }], { x: e.clientX, y: e.clientY });
      var f = row.dataset.f;
      if (f === "@trash") return D.popup([{ label: "全部删除…", run: emptyTrash }], { x: e.clientX, y: e.clientY });
      if (f === "@all") return;
      D.popup([
        { label: "新建文件夹", run: function () { newFolder(null); } },
        { label: "新建子文件夹", run: function () { newFolder(f); } },
        K.SEP,
        { label: "重新命名", disabled: f === DEF, run: function () { renameFolderInline(row); } },
        { label: "删除文件夹…", disabled: f === DEF, run: function () { deleteFolder(f); } },
        K.SEP,
        { label: "在访达中显示", run: function () { revealFile(folderPath(f)); } },
      ], { x: e.clientX, y: e.clientY });
    });
    // 备忘录拖到文件夹上 = 移过去；文件夹拖到文件夹上 = 放进去
    var dragF = null;
    side.addEventListener("dragstart", function (e) { var row = e.target.closest(".nt-f"); if (!row) return; dragF = row.dataset.f; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", folderName(dragF)); });
    side.addEventListener("dragend", function () { dragF = null; clearDrop(); });
    side.addEventListener("dragover", function (e) {
      var row = e.target.closest(".nt-f");
      clearDrop();
      if (!row || row.dataset.f === "@all" || row.dataset.f.charAt(0) === "#") return;
      if (dragF && (row.dataset.f === dragF || row.dataset.f.indexOf(dragF + "/") === 0 || row.dataset.f === "@trash")) return;
      if (!dragF && !dragNotes) return;
      e.preventDefault();
      row.classList.add("drop-in");
    });
    side.addEventListener("drop", function (e) {
      var row = e.target.closest(".nt-f");
      clearDrop();
      if (!row) return;
      e.preventDefault();
      var f = row.dataset.f;
      if (dragNotes) { if (f === "@trash") deleteNotes(dragNotes); else moveNotesTo(dragNotes, f); }
      else if (dragF) {
        var name = dragF.slice(dragF.lastIndexOf("/") + 1), from = dragF;
        if (!FS.exists(folderPath(f + "/" + name))) { flush(false); K.afterSync(function () { store.move(folderPath(from), folderPath(f + "/" + name)); if (UI.folder === from) UI.folder = f + "/" + name; E.path = null; afterOps(); }); }
      }
    });
  }
  function clearDrop() { if (M) M.win.el.querySelectorAll(".drop-in").forEach(function (x) { x.classList.remove("drop-in"); }); }
  var dragNotes = null;
  function bindList() {
    var list = M.main.querySelector(".nt-list"), gal = M.main.querySelector(".nt-gallery");
    list.addEventListener("mousedown", function (e) {
      var it = e.target.closest(".nt-it");
      if (!it || e.button !== 0) return;
      if (it.classList.contains("draft")) return;
      openNote(it.dataset.p, true);
      list.focus({ preventScroll: true });
    });
    list.addEventListener("dblclick", function (e) { var it = e.target.closest(".nt-it"); if (it && !it.classList.contains("draft")) placeAt(ED.lastElementChild, "end"); });
    list.addEventListener("contextmenu", function (e) {
      var it = e.target.closest(".nt-it");
      if (!it || it.classList.contains("draft")) return;
      e.preventDefault();
      openNote(it.dataset.p, true);
      D.popup(noteMenu([it.dataset.p]), { x: e.clientX, y: e.clientY });
    });
    list.addEventListener("keydown", function (e) { if (e.isComposing || e.keyCode === 229) return;
      var items = Array.prototype.slice.call(list.querySelectorAll(".nt-it:not(.draft)")), i = items.findIndex(function (x) { return x.dataset.p === UI.sel; });
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); var nx = items[K.clamp(i + (e.key === "ArrowDown" ? 1 : -1), 0, items.length - 1)]; if (nx) { openNote(nx.dataset.p, true); var el = list.querySelector('.nt-it[data-p="' + CSS.escape(nx.dataset.p) + '"]'); if (el) el.scrollIntoView({ block: "nearest" }); } }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); placeAt(ED.lastElementChild, "end"); }
      if ((e.key === "Backspace" || e.key === "Delete") && UI.sel) { e.preventDefault(); deleteNotes([UI.sel]); }
    });
    list.addEventListener("dragstart", function (e) {
      var it = e.target.closest(".nt-it");
      if (!it || it.classList.contains("draft")) return e.preventDefault();
      flush(true);
      dragNotes = [UI.sel === it.dataset.p ? E.path || it.dataset.p : it.dataset.p];
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", (notes[dragNotes[0]] || {}).title || "");
    });
    list.addEventListener("dragend", function () { dragNotes = null; clearDrop(); });
    // 画廊：点一下选中，连点两下打开（同 macOS）
    gal.addEventListener("click", function (e) {
      var c = e.target.closest(".nt-card");
      if (!c) return;
      UI.sel = c.dataset.p;
      saveUI();
      gal.querySelectorAll(".nt-card").forEach(function (x) { x.classList.toggle("on", x === c); });
      syncToolbar();
    });
    gal.addEventListener("dblclick", function (e) { var c = e.target.closest(".nt-card"); if (!c) return; UI.galleryOpen = true; if (E.path !== c.dataset.p) { UI.sel = null; openNote(c.dataset.p, true); } renderAll(); placeAt(ED.lastElementChild, "end"); });
    gal.addEventListener("contextmenu", function (e) { var c = e.target.closest(".nt-card"); if (!c) return; e.preventDefault(); D.popup(noteMenu([c.dataset.p]), { x: e.clientX, y: e.clientY }); });
  }

  // ======== 菜单 ========
  function menus() {
    var cur = E.path && notes[E.path], ok = editable() && (!!cur || E.draft), k = ok ? kindOf(curBlock()) : "";
    var st = function (kind, label, keys) { return { label: label, keys: keys || "", checked: k === kind, disabled: !ok, run: function () { setStyle(kind); } }; };
    var focusEd = document.activeElement === ED;
    return [
      { title: "文件", items: [
        { label: "新建备忘录", keys: "⌥⌘N", disabled: UI.folder === "@trash" && !UI.query, run: newNote },
        { label: "新建文件夹", keys: "⇧⌥⌘N", run: function () { newFolder(null); } },
        K.SEP,
        { label: cur && cur.pinned ? "取消置顶备忘录" : "置顶备忘录", disabled: !cur || cur.trashed, run: function () { togglePin(cur.path); } },
        K.SEP,
        { label: "导出为 PDF…", disabled: !cur, run: function () { flush(false); exportPDF(notes[E.path]); } },
        { label: "导出为 Markdown…", disabled: !cur, run: function () { flush(false); exportMd(notes[E.path]); } },
        { label: "在访达中显示", disabled: !cur, run: function () { revealFile(cur.path); } },
      ] },
      { title: "编辑", items: [
        { label: "撤销", keys: "⌘Z", disabled: !focusEd || !hist.past.length, run: function () { hist.undo(); } },
        { label: "重做", keys: "⇧⌘Z", disabled: !focusEd || !hist.future.length, run: function () { hist.redo(); } },
        K.SEP,
        { label: "剪切", keys: "⌘X", disabled: !focusEd, run: function () { document.execCommand("cut"); } },
        { label: "拷贝", keys: "⌘C", disabled: !focusEd, run: function () { document.execCommand("copy"); } },
        { label: "全选", keys: "⌘A", disabled: !focusEd, run: function () { document.execCommand("selectAll"); } },
        K.SEP,
        { label: "删除备忘录", keys: "⌘⌫", disabled: !cur, run: function () { deleteNotes([cur.path]); } },
        K.SEP,
        { label: "添加链接…", keys: "⌘K", disabled: !ok, run: linkDialog },
        { label: "查找", keys: "⌘F", run: focusSearch },
      ] },
      { title: "格式", items: [
        st("title", "标题"), st("heading", "标头", "⇧⌘H"), st("subheading", "副标头", "⇧⌘J"), st("body", "正文", "⇧⌘B"), st("mono", "等宽", "⇧⌘M"),
        K.SEP,
        st("bullet", "项目符号列表", "⇧⌘7"), st("dash", "短划线列表", "⇧⌘8"), st("num", "编号列表", "⇧⌘9"),
        K.SEP,
        st("check", "核对清单", "⇧⌘L"),
        { label: "标记为已勾选", keys: "⇧⌘U", disabled: !ok || k !== "check", run: markChecked },
        { label: "更多", disabled: !ok, items: [{ label: "全部勾选", run: function () { checkAll(true); } }, { label: "全部取消勾选", run: function () { checkAll(false); } }, K.SEP, { label: "将已勾选的项目移到底部", run: checkedToBottom }] },
        K.SEP,
        st("quote", "块引用", "⌘'"),
        K.SEP,
        { label: "字体", disabled: !ok, items: [
          { label: "粗体", keys: "⌘B", run: function () { inlineFmt("bold"); } }, { label: "斜体", keys: "⌘I", run: function () { inlineFmt("italic"); } },
          { label: "下划线", keys: "⌘U", run: function () { inlineFmt("underline"); } }, { label: "删除线", keys: "⇧⌘X", run: function () { inlineFmt("strike"); } }] },
        { label: "表格", keys: "⌥⌘T", disabled: !ok, run: insertTable },
        { label: "缩进", disabled: !ok, items: [{ label: "增大", keys: "⌘]", run: function () { indentBy(1); } }, { label: "减小", keys: "⌘[", run: function () { indentBy(-1); } }] },
      ] },
      { title: "显示", items: [
        { label: "以列表显示", checked: UI.view === "list", run: function () { UI.view = "list"; UI.galleryOpen = false; saveUI(); renderAll(); } },
        { label: "以画廊显示", checked: UI.view === "gallery", run: function () { UI.view = "gallery"; UI.galleryOpen = false; saveUI(); renderAll(); } },
        K.SEP,
        { label: "排序方式", items: [["modified", "编辑日期"], ["created", "创建日期"], ["title", "标题"]].map(function (s) { return { label: s[1], checked: UI.sort === s[0], run: function () { UI.sort = s[0]; saveUI(); renderList(); } }; }) },
        { label: "按日期分组", checked: UI.group, run: function () { UI.group = !UI.group; saveUI(); renderList(); } },
        K.SEP,
        { label: M && M.sideShown() ? "隐藏文件夹" : "显示文件夹", run: function () { M.toggleSide(); } },
      ] },
      { title: "帮助", items: [{ label: "数据文件格式（README.md）", run: function () { store.ensure(); if (window.TSU_IDE && TSU_IDE.open) TSU_IDE.open(DIR + "/README.md"); else revealFile(DIR + "/README.md"); } }] },
    ];
  }
  function appMenu() { return [{ label: "关于备忘录", run: function () { D.alert({ window: APP, icon: "app", title: "备忘录", message: "每个备忘录是 " + DIR.replace(FS.HOME, "~") + " 里的一个 Markdown 文件，agent 可以直接读写。", buttons: [{ label: "好", role: "default" }] }); } }]; }
  function focusSearch() { if (!M) return; var i = M.tb.querySelector(".ma-search input"); i.focus(); i.select(); }
  function onKey(e) {
    if (!M || D.front() !== M.win || M.win.state === "closed" || M.win.state === "min") return;
    if (e.isComposing || e.keyCode === 229) return;
    var a = document.activeElement, inPop = a && a.closest && a.closest(".ma-pop");
    if (inPop) return;
    var cmd = e.metaKey && !e.ctrlKey, hit = null, typing = a && M.win.el.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName);
    if (cmd && e.altKey && !e.shiftKey && e.code === "KeyN") hit = newNote;
    else if (cmd && e.altKey && e.shiftKey && e.code === "KeyN") hit = function () { newFolder(null); };
    else if (cmd && !e.shiftKey && !e.altKey && e.code === "KeyF") hit = focusSearch;
    else if (cmd && e.altKey && e.code === "KeyF") hit = focusSearch;
    else if (cmd && e.key === "Backspace" && a !== ED && !typing && E.path) hit = function () { deleteNotes([E.path]); };
    else if (e.metaKey && e.ctrlKey && e.code === "KeyS") hit = function () { M.toggleSide(); };
    if (hit) { e.preventDefault(); e.stopPropagation(); hit(); }
  }

  // ======== 启动 ========
  var DOCK_ICON = '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true"><defs><linearGradient id="nt-ico-y" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffdd4a"/><stop offset="1" stop-color="#f7c318"/></linearGradient></defs>' +
    '<rect width="100" height="100" fill="#fff"/><rect width="100" height="30" fill="url(#nt-ico-y)"/><rect y="30" width="100" height="2.2" fill="#e8b814" opacity=".5"/>' +
    '<g fill="#c7c7cc">' + [8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88].map(function (x) { return '<circle cx="' + x + '" cy="36.5" r="1.3"/>'; }).join("") + "</g>" +
    '<g stroke="#dcdce0" stroke-width="1.8"><path d="M10 52h80M10 66h80M10 80h80"/></g></svg>';
  var dockSpan = '<span class="ico sq ico-notes">' + DOCK_ICON + "</span>";
  D.registerApp({ id: APP, name: NAME, icon: dockSpan, open: open, category: "效率" });
  D.addDockApp({ app: APP, title: NAME, className: "ico-notes", icon: DOCK_ICON, onOpen: open });
  K.describe({ id: APP, name: NAME + " (Notes)", path: DIR,
    about: "one Markdown file per note inside folder subdirectories (default folder 备忘录/, e.g. 备忘录/购物清单.md; folders can nest). First line is the title (\"# Title\"); each line is one paragraph. " +
      "Supports ## heading, ### subheading, **bold**, *italic*, <u>underline</u>, ~~strike~~, [links](url), * bullets, - dashes, 1. numbers, - [ ] / - [x] checklists (indent 4 spaces per level), > quotes, ``` monospaced, | tables |, ![](.attachments/img.png). " +
      "Optional front matter `pinned: true`. Delete = move the file into .Trash/<folder>/ (never rm). The note open in the app is never silently overwritten. Full format: README.md in that folder." });
  FS.ready().then(function () {
    scan();
    store.watch(onFiles);
    K.settled(function () {
      store.ensure();
      try { if (!FS.isDir(folderPath(DEF))) FS.mkdirp(folderPath(DEF)); } catch (e) { /* 没权限就算了 */ }
      K.shareWithAgents(DIR);
      scan();
      if (M) renderAll();
    });
  });
  window.TSU_NOTES = { open: open, dir: DIR, notes: function () { return notes; }, current: function () { return E.path; }, newNote: newNote, md: { toHTML: mdToHTML, fromDOM: toMd },
    // 手机上的版式（ios/apps.js）用：工具栏的动作（compose、format、checklist、table、media、link、share、trash）、显示方式、选文件夹、现在的状态
    action: function (k, anchor) { if (M) tbAction(k, anchor || M.tb); },
    setView: function (v) { if (!M) return; UI.view = v === "gallery" ? "gallery" : "list"; UI.galleryOpen = false; saveUI(); renderAll(); },
    selectFolder: function (f) { if (M) selectFolder(f); },
    state: function () { return { folder: UI.folder, view: UI.view, query: UI.query, galleryOpen: !!UI.galleryOpen, open: !!(E.path || E.draft), sort: UI.sort, title: viewTitle(), count: inView().length }; },
    flush: function () { flush(true); } };
})();
