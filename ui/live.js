// live.js —— 终端 App：经典终端（窗口 × 标签页 × 分屏，每个面板一个 shell），在 shell 里敲 `agent` 进入 agent 的界面（同在终端里跑 Claude Code）。
// 结构：面板 Pane（屏幕、输入、光标、整行滚动、选区）上跑一个「程序」——ShellView（经典终端：提示符、命令、输出、历史、Tab 补全）
// 或 AgentView（接上 TSU_AGENTS 里的一个 agent：对话、工具、输入栏、面板）。agent 自己在 agents.js 里跑，和面板无关：
// 退出 agent 界面、关掉窗口，agent 照样在后台；再敲 paimon <名字> 接回去（agent 是 paimon 的旧名字，也还能用）。窗口：第一个是页面里的 #win，其余由 TSU_DESK.createWindow 建
(function () {
  "use strict";
  var A = window.TSU_AGENTS, F = A.fmt, cfg = A.cfg;
  // Claude Code 的支持是扩展（ext.js）：默认不装；没装时树里没有它那一区、不读 ~/.claude、它的标签页不恢复
  var ccOn = function () { return !!(window.TSU_EXT && TSU_EXT.on("claude-code")); };
  var ccSpec = function (sp) { return !!sp && (/^cc:/.test(sp.agent || "") || sp.page === "claude"); };
  // Codex 也是连接器（codex.js）：关着时它的标签页同样先收着
  var cxOn = function () { return !!(window.TSU_CONNECTORS && TSU_CONNECTORS.on("codex")); };
  // Paimon Code 也是连接器（默认开着）：关了没有它的那一区、新建 Agent 的入口
  var pmOn = function () { return !window.TSU_CONNECTORS || TSU_CONNECTORS.on("paimon"); };
  // Agents 树、Agent Finder 里不再列 Paimon Code 的卷和 agent（用户：这里不要这些了）——Paimon 是内置的助手，不是一堆 agent；
  //   数据都还在，localStorage st-pm-vols = "1" 时照旧列出来（同 dash.js）
  var pmTree = function () { return localStorage.getItem("st-pm-vols") === "1" && pmOn(); };
  var cxSpec = function (sp) { return !!sp && /^cx:/.test(sp.agent || ""); };
  // 没装时不恢复的 Claude Code 标签页先收着（装上时再打开，不丢）
  var ccStash = function (sp) {
    var l = []; try { l = JSON.parse(localStorage.getItem("tsu-cc-stash") || "[]") || []; } catch (e) { /* 坏了就重来 */ }
    var k = function (x) { return (x.agent || "") + "|" + (x.page || "") + "|" + (x.arg || ""); };
    if (sp) { if (!l.some(function (x) { return k(x) === k(sp); })) l.push({ agent: sp.agent, page: sp.page, arg: sp.arg }); localStorage.setItem("tsu-cc-stash", JSON.stringify(l.slice(-30))); }
    return l;
  };
  var root = document.documentElement;
  // 对话里的图（记录里是 base64，截屏一张就几 MB）：HTML 里只放一个短键（data-img），用到时才转成 blob: 地址、转一次记住——
  //   以前把整段 base64 拼进 HTML：每次重画都要拼接、转义、解析几十 MB，带图的对话一动就卡死；悬停、点开预览也每次重新解码
  //   图的对象（{media_type, data}）只弱引用：会话换掉、记录重读以后旧的能回收，它的 blob: 地址跟着释放
  window.TSU_IMG = window.TSU_IMG || (function () {
    var reg = new Map(), byStr = new Map(), n = 0;
    var fin = typeof FinalizationRegistry === "function" ? new FinalizationRegistry(function (x) { reg.delete(x.k); if (x.u) URL.revokeObjectURL(x.u); }) : null;
    var blobUrl = function (mt, b64) {
      try { var bin = atob(b64), len = bin.length, u8 = new Uint8Array(len); for (var i = 0; i < len; i++) u8[i] = bin.charCodeAt(i); return URL.createObjectURL(new Blob([u8], { type: mt || "image/png" })); }
      catch (e) { return "data:" + (mt || "image/png") + ";base64," + b64; }
    };
    function key(src) {
      if (!src) return "";
      if (typeof src === "object") {
        if (src._ik) return src._ik;
        src._ik = "i" + (++n);
        var tok = { k: src._ik, u: "" };
        Object.defineProperty(src, "_itok", { value: tok, enumerable: false });
        reg.set(src._ik, typeof WeakRef === "function" ? new WeakRef(src) : { deref: function () { return src; } });
        if (fin) fin.register(src, tok);
        return src._ik;
      }
      var k = byStr.get(src);
      if (!k) { k = "i" + (++n); byStr.set(src, k); reg.set(k, { s: src }); }
      return k;
    }
    function url(k) {
      var e = reg.get(k);
      if (!e) return "";
      if (e.deref) {
        var o = e.deref();
        if (!o) return "";
        if (!o._itok.u) {
          if (o.data) o._itok.u = blobUrl(o.media_type, o.data);
          else if (o.bytes) o._itok.u = URL.createObjectURL(new Blob([o.bytes], { type: o.media_type || "image/png" }));
          else { if (o.load && !o.missing) o.load(function () { if (o.bytes) window.dispatchEvent(new CustomEvent("tsu-img", { detail: k })); }); return ""; } // 存在文件里的图（这边附的截图）：读好了再说
        }
        return o._itok.u;
      }
      if (!e.u) { var m = /^data:([^;,]+);base64,/.exec(e.s); e.u = m ? blobUrl(m[1], e.s.slice(m[0].length)) : e.s; }
      return e.u;
    }
    // 点的、悬停的那个元素要看的图：[Image #N]（data-img）/ 老的 data-src / <img>
    function srcOf(el) { if (!el) return ""; var d = el.dataset || {}, h = /#vs-img:(\w+)/.exec((el.getAttribute && el.getAttribute("href")) || ""); return h ? url(h[1]) : d.img ? url(d.img) : d.src || el.currentSrc || el.src || ""; }
    return { key: key, url: url, srcOf: srcOf, of: function (src) { return url(key(src)); } };
  })();
  // 中文里的粗体：CommonMark 的左右侧规则对中文不友好——「**南部钨矿：**钻机」收尾的 ** 前面是标点、后面紧跟着字，不算收尾，** 原样露出来
  //   （英文原文「**South mine:** drill」有空格所以没事；翻成中文、中文回复里常见）。画之前把粗体两头贴着的标点挪到 ** 外面：**南部钨矿**：钻机
  //   代码块、行内代码里的不动
  // （TTU 是打包出来的模块对象：markdownLines 只有 getter、改不了——所以这里是自己的 mdLines，本文件里都用它）
  var cjkEm = function (md) { return md; };
  if (window.TTU && TTU.markdownLines) {
    var emFix = function (s) {
      return s.replace(/\*\*([^*\n]+?)\*\*/g, function (m, inner, off, all) {
        var before = all.charAt(off - 1), after = all.charAt(off + m.length), body = inner, lead = "", trail = "", tm, lm;
        var plain = function (c) { return !!c && !/[\s\p{P}\p{S}]/u.test(c); }; // 字（不是空白、不是标点符号）
        if ((tm = /[\p{P}\p{S}]+$/u.exec(body)) && plain(after)) { trail = tm[0]; body = body.slice(0, -trail.length); }
        if ((lm = /^[\p{P}\p{S}]+/u.exec(body)) && plain(before)) { lead = lm[0]; body = body.slice(lead.length); }
        return body && (lead || trail) ? lead + "**" + body + "**" + trail : m;
      });
    };
    cjkEm = function (md) {
      md = md == null ? "" : String(md);
      if (md.indexOf("**") < 0 || !/[　-〿㐀-鿿＀-￯]/.test(md)) return md;
      var fence = false;
      return md.split("\n").map(function (line) {
        if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return line; }
        if (fence) return line;
        var seg = line.split(/(`+[^`]*`+)/);
        for (var i = 0; i < seg.length; i += 2) seg[i] = emFix(seg[i]);
        return seg.join("");
      }).join("\n");
    };
  }
  var mdLines = function (md, o) { return TTU.markdownLines(cjkEm(md), o); };
  window.TSU_MD = { lines: mdLines, cjkEm: cjkEm }; // 别的文件（翻译、GUI）要同样的修正时用
  // 这是 App 的第几个窗口（原生开的新窗口带 ?win=2…）：各窗口的布局各记各的；?open=<标签页的 spec（JSON）> 开一个只有这一页的窗口（拖出去的标签页）
  var WIN_Q = new URLSearchParams(location.search), WIN_ID = Math.max(1, parseInt(WIN_Q.get("win") || "1", 10) || 1), WSUF = WIN_ID > 1 ? ":" + WIN_ID : "";
  window.TSU_WIN = { id: WIN_ID, suffix: WSUF, open: WIN_Q.get("open"), fresh: !!WIN_Q.get("fresh") };
  // open / fresh 只管这个窗口刚开出来的那一次：用过就从地址里拿掉——不然这个窗口以后每次重新载入（更新、刷新）都当成新开的，
  //   记下的标签页全不恢复、只剩一个空白页（历史记录）（用户：重启丢了窗口）。win=N 留着：它说的是这个窗口记的是哪一份
  if (TSU_WIN.open || TSU_WIN.fresh) { try { var wu = new URL(location.href); wu.searchParams.delete("open"); wu.searchParams.delete("fresh"); history.replaceState(history.state, "", wu.pathname + wu.search + wu.hash); } catch (e) { /* 改不了地址就算了 */ } }
  // 原生能开新窗口（App 里 window.new）：标签页右键「移到 / 复制到新窗口」、把标签页拖出窗口
  var NCMDS = [];
  if (window.nadosNative) nadosNative.call("info").then(function (i) { NCMDS = (i && i.commands) || []; }).catch(function () {});
  var canNewWin = function () { return NCMDS.indexOf("window.new") >= 0; };
  // Claude App 风格：「新建 Agent / 新标签页」都是开一张新会话的草稿（说了第一句话才真的建，见 claudeapp.js）；别的风格返回 false 照旧
  var caNew = function () { if (!document.documentElement.classList.contains("st-os-claude") || !window.TSU_CLAUDEAPP || !TSU_CLAUDEAPP.newSession) return false; TSU_CLAUDEAPP.newSession(); return true; };
  function toNewWindow(tw, p, move, at) {
    if (!canNewWin() || !p || !p.spec) return;
    var pty = p.program && p.program.pty;
    nadosNative.call("window.new", Object.assign({ open: JSON.stringify(pty ? { sh: p.spec().sh } : p.spec()) }, at || {})).then(function () { if (move && !pty) { p.moving = true; tw.ws.closePane(p); } }).catch(function () {});
  }
  // 标签页拖出窗口松开：落在另一个窗口上 = 放进那个窗口（它的标签条上按位置插）；落在空处 = 开新窗口（同 Safari / Chrome）
  function dropOutside(tw, p, sx, sy) {
    if (!p || !p.spec) return;
    var pty = p.program && p.program.pty, sp = JSON.stringify(pty ? { sh: p.spec().sh } : p.spec());
    if (NCMDS.indexOf("window.tabDrop") < 0) return toNewWindow(tw, p, true, { x: sx, y: sy });
    nadosNative.call("window.tabDrop", { x: sx, y: sy, spec: sp }).then(function (r) {
      if (r && r.ok) { if (!pty) { p.moving = true; tw.ws.closePane(p); } return; }
      toNewWindow(tw, p, true, { x: sx, y: sy });
    }, function () { toNewWindow(tw, p, true, { x: sx, y: sy }); });
  }
  // 别的窗口拖过来的标签页：插到指着的那个标签条、那个位置（指着的不是标签条就放在当前这组的最后）
  if (window.nadosNative && nadosNative.on) nadosNative.on("tab.dropin", function (d) {
    var tw = frontTerm(), spec = null;
    try { spec = JSON.parse(d && d.spec || "null"); } catch (e) { spec = null; }
    if (!tw || !spec) return;
    var p = tw.ws.newTab(spec);
    var hitEl = document.elementFromPoint(+d.x || 0, +d.y || 0), strip = hitEl && hitEl.closest && hitEl.closest(".gtabs");
    if (p && strip && strip._g && strip._ws === tw.ws && tw.ws.moveTab) {
      var tb0 = hitEl.closest(".tab"), idx = strip._g.editors.length;
      if (tb0 && tb0._p) { var rr = tb0.getBoundingClientRect(); idx = strip._g.editors.indexOf(tb0._p) + ((+d.x || 0) > rr.left + rr.width / 2 ? 1 : 0); }
      try { tw.ws.moveTab(p, strip._g, idx); } catch (e) { /* 放不进那个位置就留在最后 */ }
    }
    persistAll();
  });
  var ESC = "\x1b", RESET = ESC + "[0m", BOLD = ESC + "[1m", ITALIC = ESC + "[3m";
  var rgb = function (c) { return ESC + "[38;2;" + c + "m"; };
  // 状态点（同 Claude Code、teyvat 的 ⏺）：私用区的一个记号，画的时候换成 CSS 圆点——不靠字体（⏺、● 在浏览器里各自回退到不同字体，大小不一）
  var DOT = "\uE017", DOT_RUN = "\uE018"; // 状态点；在跑的那种（一闪一闪，同 Claude Code 的灰点）
  var AMBER = rgb("255;193;7"), ORANGE = rgb("215;119;87"), RED = rgb("255;107;128"), GREEN = rgb("78;186;101"), LAV = rgb("177;185;249"), PINK = rgb("253;93;177"), BLUE = rgb("110;170;255"), CYAN = rgb("0;200;210");
  // 浅色主题：深色主题用的那几种颜色换成浅色版，不然白底上看不清。照 Claude Code 2.1.281 自己的浅色主题取色：
  //   淡紫蓝（permission / suggestion，「◎ /goal active」那种）→ 它浅色的 rgb(87,105,247)（以前换成靛蓝 79,70,229，看着是紫的）；
  //   黄（warning：想着的转圈那一行）：它浅色主题是褐色 rgb(150,108,30)——不像黄。取深色主题同一种黄（255,193,7，色相 45°）只压暗一点，白底上还是黄
  var LIGHT_RGB = { "177;185;249": "87;105;247", "78;186;101": "44;122;57", "255;107;128": "171;43;63", "255;193;7": "232;170;0", "61;187;255": "0;119;204", "113;142;244": "74;99;200", "110;170;255": "87;101;247", "0;200;210": "30;122;110" };
  var forLight = function (s) { return s.replace(/\x1b\[38;2;(\d+;\d+;\d+)m/g, function (m, c) { return LIGHT_RGB[c] ? ESC + "[38;2;" + LIGHT_RGB[c] + "m" : m; }); };
  var W = function (s) { return TTU.visibleWidth(s); };
  // 把一行（带颜色码、带私用区记号的）截到 cols 格宽：颜色码、记号都留着（不拆开成对的 span），只丢看得见的字，最后补一个「…」
  function clipLine(s, cols) {
    if (!s || W(s) <= cols) return s;
    var out = "", w = 0, i = 0, full = false, m;
    while (i < s.length) {
      if (s[i] === "\x1b" && (m = /^\x1b\[[0-9;?]*[A-Za-z]|^\x1b\][^\x07]*\x07/.exec(s.slice(i, i + 256)))) { out += m[0]; i += m[0].length; continue; }
      var cp = s.codePointAt(i), c = String.fromCodePoint(cp);
      i += c.length;
      if (cp >= 0xE000 && cp <= 0xE017) { out += c; continue; }
      if (full) continue;
      var cw = W(c);
      if (w + cw <= cols - 1) { out += c; w += cw; } else { out += "…"; full = true; }
    }
    return out;
  }
  // 文件名里的时间：本地时区，20260926-102829
  var fileStamp = function (d) { d = d || new Date(); var z = function (n) { return (n < 10 ? "0" : "") + n; }; return d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + "-" + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds()); };
  var pad = function (s, n) { var w = W(s); return w < n ? s + " ".repeat(n - w) : s; };
  var NO_START = /^[，。、；：！？）」』”’》〉…—,.;:!?)\]]/;
  // 显示用的折行：避头尾、英文词不拆
  function wrap(s, w) {
    var lines = [], cur = "", cw = 0;
    Array.from(s).forEach(function (tok) {
      var x = W(tok);
      if (cw + x > w && cur) {
        var carry = "";
        if (NO_START.test(tok) && Array.from(cur).length > 1) { var cs = Array.from(cur); carry = cs.pop(); cur = cs.join(""); }
        var tail = /^[A-Za-z0-9'’]/.test(tok) && /[A-Za-z0-9._/'’-]+$/.exec(cur); // 英文的词（连同 agent's 这种）整个挪到下一行
        if (tail && tail[0].length < cur.length && W(tail[0]) < w / 2) { carry = tail[0]; cur = cur.slice(0, -tail[0].length); }
        lines.push(cur.replace(/ +$/, ""));
        cur = carry;
        cw = W(carry);
      }
      cur += tok;
      cw += x;
    });
    lines.push(cur);
    return lines;
  }
  // 输入用的折行：只按宽度切、一个字都不丢，记下每行在原文里的起点（光标按它定位）
  function wrapKeep(s, w, first) {
    var lines = [], offset = 0;
    s.split("\n").forEach(function (para, pi) {
      var cur = "", cw = pi ? 0 : first || 0, start = offset;
      Array.from(para).forEach(function (ch) {
        var x = W(ch);
        if (cw + x > w && (cur || cw)) { lines.push({ text: cur, start: start }); start += cur.length; cur = ""; cw = 0; }
        cur += ch;
        cw += x;
      });
      lines.push({ text: cur, start: start });
      offset += para.length + 1;
    });
    return lines;
  }
  function trim(lines) {
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines;
  }
  var clip = function (s, w) { var c = ""; Array.from(String(s)).some(function (ch) { if (W(c + ch) > w - 1) return true; c += ch; return false; }); return c.length < String(s).length ? c + "…" : c; };
  var link = function (url, text) { return "\x1b]8;;" + url + "\x07" + text + "\x1b]8;;\x07"; };
  // agent 的底部（输入框、状态行、子 agent）拖出来的高度：按 agent 记在本机（终端界面、图形界面共用，刷新也在）；0 = 贴着内容
  var FH_KEY = "tsu-foot-h";
  function footHOf(aid) { try { return +((JSON.parse(localStorage.getItem(FH_KEY) || "{}") || {})[aid]) || 0; } catch (e) { return 0; } }
  function setFootH(aid, h) { var o = {}; try { o = JSON.parse(localStorage.getItem(FH_KEY) || "{}") || {}; } catch (e) { o = {}; } if (h > 0) o[aid] = Math.round(h); else delete o[aid]; try { localStorage.setItem(FH_KEY, JSON.stringify(o)); } catch (e) { /* 满了就不记 */ } }
  var escHtml = function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); };
  var termPref = function () { return localStorage.getItem("tsu-term") || "auto"; };
  var termLight = function () { var p = termPref(); return p === "auto" ? root.classList.contains("light") : p === "light"; };
  var timeOf = function (t, opts) { return new Date(t).toLocaleTimeString(cfg.time === "24h" ? "en-GB" : "en-US", opts || { hour: "numeric", minute: "2-digit" }); };

  // ---- 终端颜色：TTU 只认真彩色（38;2）。shell 输出里的 16 色 / 256 色换成真彩色（调色板同 VS Code 的终端）----
  var PALETTE = ["0;0;0", "205;49;49", "13;188;121", "229;229;16", "36;114;200", "188;63;188", "17;168;205", "229;229;229",
    "102;102;102", "241;76;76", "35;209;139", "245;245;67", "59;142;234", "214;112;214", "41;184;219", "255;255;255"];
  function x256(c) {
    if (c < 16) return PALETTE[c];
    if (c >= 232) { var g = 8 + (c - 232) * 10; return g + ";" + g + ";" + g; }
    c -= 16;
    var L = [0, 95, 135, 175, 215, 255];
    return L[Math.floor(c / 36)] + ";" + L[Math.floor(c / 6) % 6] + ";" + L[c % 6];
  }
  function ansiTrue(s) {
    return s.replace(/\x1b\[([\d;]*)m/g, function (m, p) {
      if (!p) return m;
      var parts = p.split(";"), o = [];
      for (var i = 0; i < parts.length; i++) {
        var n = +parts[i];
        if ((n === 38 || n === 48) && parts[i + 1] === "5") { o.push(n + ";2;" + x256(+parts[i + 2])); i += 2; continue; }
        if ((n === 38 || n === 48) && parts[i + 1] === "2") { o.push(parts.slice(i, i + 5).join(";")); i += 4; continue; }
        if (n >= 30 && n <= 37) o.push("38;2;" + PALETTE[n - 30]);
        else if (n >= 90 && n <= 97) o.push("38;2;" + PALETTE[n - 82]);
        else if (n >= 40 && n <= 47) o.push("48;2;" + PALETTE[n - 40]);
        else if (n >= 100 && n <= 107) o.push("48;2;" + PALETTE[n - 92]);
        else o.push(parts[i]);
      }
      return "\x1b[" + o.join(";") + "m";
    });
  }
  // 一行终端输出：\r 覆盖（进度条）、制表符、去掉光标移动之类的控制序列，再按列宽折行（颜色延续到下一行）
  function termLines(text, width) {
    var out = [];
    String(text).split("\n").forEach(function (raw) {
      if (raw.indexOf("\r") >= 0) { var segs = raw.split("\r").filter(function (x, i, a) { return x || i === a.length - 1; }); raw = segs[segs.length - 1] || ""; }
      raw = ansiTrue(raw.replace(/\x1b\[[\d;?]*[A-HJKSTfhlnsu]/g, "").replace(/\x1b[()][A-Z0-9]/g, ""));
      // u 标志：一个 emoji（代理对）算一个字；落单的半个代理也只算一个，不会让循环回头
      var cur = "", w = 0, sgr = "", re = /\x1b\[[\d;]*m|\x1b\]8;;[^\x07]*\x07|[\s\S]/gu, mt;
      var col = 0;
      while ((mt = re.exec(raw))) {
        var t = mt[0];
        if (t.charCodeAt(0) === 27) { cur += t; if (t[1] === "[") sgr = /^\x1b\[0?m$/.test(t) ? "" : sgr + t; continue; }
        if (t === "\t") { var n = 8 - (col % 8); t = " ".repeat(n); }
        var cp = t.charCodeAt(0);
        if (cp < 32 && t.charCodeAt(0) !== 32) continue;
        var cw = W(t);
        if (w + cw > width && w) { out.push(cur + RESET); cur = sgr; w = 0; col = 0; }
        cur += t;
        w += cw;
        col += cw;
      }
      out.push(cur + (sgr ? RESET : ""));
    });
    return out;
  }

  // ======== 面板：屏幕 + 输入 + 光标 + 滚动 + 选区；上面跑一个程序（ShellView / AgentView）========
  var PANE_HTML = '<div class="screen"><div class="topgap"></div><div class="page"><pre class="term terminal-style-ui"><div class="sel"></div><span class="out"></span></pre></div>' +
    '<div class="botgap"></div></div><pre class="jump terminal-style-ui"></pre><pre class="foot terminal-style-ui"><span class="input"></span></pre>' +
    '<textarea class="ta" rows="1" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="终端输入"></textarea><i class="grip" title="拖动以移动面板（或按住 ⌥⌘ 拖动面板任意位置）">⠿</i>';
  var paneSeq = 0;
  // ---- 拖进终端的路径：访达拖出来的带着 application/x-tsu-paths（JSON 数组）----
  function droppedPaths(e) {
    var raw = e.dataTransfer && e.dataTransfer.getData && e.dataTransfer.getData("application/x-tsu-paths");
    if (!raw) return null;
    try { var a = JSON.parse(raw); return Array.isArray(a) && a.length ? a : null; } catch (x) { return null; }
  }
  // 同 macOS 的终端：空格、引号这些前面加反斜杠，几个路径用空格隔开，最后带一个空格；real = 换成真沙盒里的路径
  var shEsc = function (p) { return String(p).replace(/([\s'"\\$`!&*()[\]{};<>?|#])/g, "\\$1"); };
  function pathsText(paths, real) { return paths.map(function (p) { return shEsc(real && window.SANDBOX && SANDBOX.toReal ? SANDBOX.toReal(p) : p); }).join(" ") + " "; }
  // 插到光标处：真终端直接敲给 shell；浏览器里的 shell、agent 的输入框插进输入行
  function dropText(P, text) {
    var prog = P.program;
    if (prog && prog.pty && prog.type) return prog.type(text);
    var ta = P.ta, a = ta.selectionStart == null ? ta.value.length : ta.selectionStart, b = ta.selectionEnd == null ? a : ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    ta.selectionStart = ta.selectionEnd = a + text.length;
    if (prog && prog.inputChanged) prog.inputChanged("input");
  }
  // 最近一次你自己用滚轮、触控板、指针（按下、按着拖）、手指动过的时间：对话区看到 scrollTop 变了时，分清是你翻的还是浏览器自己挪的（见 P.onScroll）。
  //   按键不算：回车发出去以后内容变了，那一下不能当成往上翻
  var USER_AT = 0, userNow = function () { USER_AT = performance.now(); };
  ["wheel", "pointerdown", "touchstart", "touchmove"].forEach(function (t) { document.addEventListener(t, userNow, { capture: true, passive: true }); });
  document.addEventListener("pointermove", function (e) { if (e.buttons) userNow(); }, { capture: true, passive: true });
  // 全屏只看对话（手机上标签栏 ··· 旁边那个按钮）：活动栏、标题栏、标签栏、侧栏、面板都收起来，只剩当前这一格；右上角浮着一个「缩小」
  var focusBtn = null;
  function focusMode(on) {
    root.classList.toggle("st-focus", !!on);
    try { webkit.messageHandlers.vsApp.postMessage({ type: "fullscreen", on: !!on }); } catch (e) { /* 不在 App 里 */ } // iPhone：网页铺到整屏（上下那两条也是对话的）
    if (on && !focusBtn) {
      focusBtn = document.createElement("button");
      focusBtn.type = "button"; focusBtn.className = "st-focus-exit"; focusBtn.title = "退出全屏";
      focusBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5"/></svg>';
      // 能拖到别处（不挡字），记住放在哪儿；按下没怎么动就松开才是点（退出）
      var fpos = (function () { try { return JSON.parse(localStorage.getItem("st-focus-btn") || "null"); } catch (e) { return null; } })();
      var place = function (x, y) { x = Math.max(4, Math.min(innerWidth - 36, x)); y = Math.max(4, Math.min(innerHeight - 36, y)); focusBtn.style.left = x + "px"; focusBtn.style.top = y + "px"; focusBtn.style.right = "auto"; return [x, y]; };
      if (fpos) place(fpos[0], fpos[1]);
      var drag = null;
      focusBtn.addEventListener("pointerdown", function (e) { var r = focusBtn.getBoundingClientRect(); drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false }; try { focusBtn.setPointerCapture(e.pointerId); } catch (x) { /* 测试里不是真的指针 */ } e.preventDefault(); });
      focusBtn.addEventListener("pointermove", function (e) { if (!drag || e.pointerId !== drag.id) return; if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 6) drag.moved = true; if (drag.moved) place(e.clientX - drag.dx, e.clientY - drag.dy); });
      focusBtn.addEventListener("pointerup", function (e) { if (!drag) return; var mv = drag.moved; drag = null; if (mv) { var r = focusBtn.getBoundingClientRect(); localStorage.setItem("st-focus-btn", JSON.stringify([Math.round(r.left), Math.round(r.top)])); return; } focusMode(false); });
      focusBtn.addEventListener("pointercancel", function () { drag = null; });
      document.body.appendChild(focusBtn);
    }
    if (focusBtn) focusBtn.hidden = !on;
    allPanes().forEach(function (p) { if (p.measure && p.el.offsetParent) { p.measure(); if (p.renderNow) p.renderNow(); } });
  }
  function Pane(tw, spec) {
    spec = spec || {};
    var el = document.createElement("div");
    el.className = "tpane";
    el.innerHTML = PANE_HTML;
    var q = function (c) { return el.querySelector("." + c); };
    var P = {
      el: el, win: tw, id: ++paneSeq, side: !!spec.side, // side：右侧栏里的那个对话（跟着编辑区当前的 agent，见 studio.js）
      screen: q("screen"), term: q("term"), out: q("out"), foot: q("foot"), input: q("input"), ta: q("ta"), jump: q("jump"), page: q("page"),
      chPx: 8, rowH: 17, cols: 80, padL: 0, theme: "dark", DIM: "", light: false, program: null, dirty: true,
    };
    el.pane = P; el.addEventListener("scroll", function () { if (el.scrollLeft) el.scrollLeft = 0; if (el.scrollTop) el.scrollTop = 0; }); // 这一格自己不滚（输入太长、输入法选字时浏览器想把光标滚进来——不让它把整格往左推，露出黑的） // 手机上的按键条（ios/term.js）直接找到这个面板：P.program.type()、P.focus()
    var screen = P.screen, term = P.term, foot = P.foot, ta = P.ta, jump = P.jump, topgap = q("topgap"), botgap = q("botgap"), selLayer = q("sel");
    var caret = document.createElement("i");
    caret.className = "caret";
    P.caret = caret;
    var flashEl = document.createElement("span");
    flashEl.className = "flash";
    flashEl.hidden = true;
    foot.appendChild(flashEl);

    // ---- 排版 ----
    // 格宽用 offsetWidth（排版尺寸，不受 transform 影响）量 1000 个 0：窗口在台前调度的左边条里（缩小 + 转了角度）、
    // 调度中心、神奇效果的动画里也量得准。以前用 getBoundingClientRect——agent 在条里接着输出时量到的是缩小后的宽度，
    // 回到台上后没有尺寸变化、不会重量，中文（两格宽）就挤成一半、叠在一起
    P.measure = function () {
      var probe = document.createElement("span");
      probe.style.cssText = "position:absolute;left:0;top:0;visibility:hidden;white-space:pre"; // 不折行、不占位；字体照样继承终端的
      probe.textContent = "0".repeat(1000);
      term.appendChild(probe);
      P.chPx = probe.offsetWidth / 1000 || 8;
      probe.remove();
      // 格宽变了才写（这个变量往下传：写一次整段对话都要重新算样式——对话区一变高矮就会量一次，打字多一行、拖底部都会）
      if (P.cellPx !== P.chPx) { P.cellPx = P.chPx; [term, foot, jump].forEach(function (x) { x.style.setProperty("--ttu-cell", P.chPx + "px"); }); }
      var style = getComputedStyle(term);
      P.padL = parseFloat(style.paddingLeft);
      P.rowH = parseFloat(style.lineHeight) || 17;
      topgap.style.height = botgap.style.height = P.rowH + "px";
      topgap.style.marginBottom = botgap.style.marginTop = -P.rowH + "px";
      P.cols = Math.max(24, Math.floor((term.clientWidth - P.padL - parseFloat(style.paddingRight)) / P.chPx));
      return P.cols;
    };
    // 记号（私用区字符，转完 HTML 再换）：改动的一行是一整块（inline-block、一行高，上下行连成一片，不留缝），行号、改了的词各自一个 span
    // \uE000 … \uE001：能点的那几个字（.hot）
    var MARKS = { "\uE009": '<span class="vs-needs">', "\uE000": '<span class="hot">', "\uE001": "</span>", "\uE002": '<span class="hot hmore">', "\uE003": '<span class="hot hitem">', "\uE004": '<span class="gn">', "\uE005": "</span>", "\uE006": '<span class="hot hnum">', "\uE010": '<span class="drow dadd">', "\uE011": '<span class="drow ddel">', "\uE012": "</span>", "\uE013": '<span class="dnum">', "\uE014": "</span>", "\uE015": '<span class="dhi">', "\uE016": "</span>", "\uE007": '<span class="vs-bgnow" title="把这条命令放到后台接着跑">', "\uE008": "</span>" };
    P.toHtml = function (lines, width) {
      // 一行比这块宽（转圈那行、工具的一句总结）：截到这块的宽度，末尾「…」（同 Claude Code 在终端里）——正文本来就按宽度折过行，这里只兜底。
      // 对话区按 P.cols；输入框那块比对话区宽（右边没有缩略图），用它自己的宽度（width），不能按对话区的截
      var cw = width === undefined ? P.cols : width;
      if (cw) lines = [].concat.apply([], lines.map(function (l) { return String(l).split("\n"); })).map(function (l) { return clipLine(l, cw); });
      var j = lines.join("\n"), h = TTU.ansiToHtml(P.light ? forLight(j) : j, P.theme, { widthOf: TTU.visibleWidth, links: true });
      if (window.STUDIO && STUDIO.hlHtml) h = STUDIO.hlHtml(h); // 代码块的颜色跟着「高亮配色」
      if (!/[\uE000-\uE018]/.test(h)) return h;
      // TTU 把认不得宽度的字（私用区）各自包进一格宽的 inline-block：先拆掉那层，再把记号换成元素
      return h.replace(/<span style="display:inline-block;width:var\(--ttu-cell,1ch\)">([\uE000-\uE016])<\/span>/g, "$1")
        .replace(/[\uE000-\uE016]/g, function (c) { return MARKS[c] || ""; })
        .replace(/\uE017/g, '<span class="tdot"></span>') // 状态点：留着 TTU 那层一格宽的框，里面画圆
        .replace(/\uE018/g, '<span class="tdot blink"></span>') // 在跑的：一闪一闪
        .replace(/<span class="drow (dadd|ddel)">/g, function (m0, k) { return '<span class="drow ' + k + '" style="width:calc(var(--ttu-cell,1ch)*' + (P.cols - 10) + ')">'; });
    };
    P.Rows = function (width) { this.rows = []; this.pending = []; this.width = width; };
    P.Rows.prototype.text = function (lines) { this.pending.push.apply(this.pending, lines); return this; };
    P.Rows.prototype.flush = function () {
      var self = this;
      if (this.pending.length) P.toHtml(this.pending, this.width).split("\n").forEach(function (h) { self.rows.push({ k: "t", h: h || " " }); });
      this.pending = [];
      return this;
    };
    P.Rows.prototype.block = function (h) { this.flush().rows.push({ k: "b", h: h }); return this; };
    P.join = function (rows) {
      var s = "", prev = "";
      rows.forEach(function (r) { if (prev === "t" && r.k === "t") s += "\n"; s += r.h; prev = r.k; });
      return s;
    };
    P.rowsHtml = function (lines, width) { return P.join(new P.Rows(width).text(lines).flush().rows); };
    P.footCols = function () { return Math.max(24, Math.floor(P.foot.clientWidth / P.chPx) || P.cols); }; // 输入框那块的宽度（格）
    // 离看着的那段很远的块才不画（content-visibility: hidden + 记住的高度）：前后三屏以内的照常排好、画好——
    //   以前是整段 content-visibility: auto，滚到哪儿才临时排哪儿，滚快了会露出排了一半的行（再滚几下才好）
    var farIO = window.IntersectionObserver ? new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.target.classList.toggle("cvfar", !e.isIntersecting); });
    }, { root: screen, rootMargin: "300% 0px 300% 0px" }) : null;
    P.block = function (html, before) {
      var b = document.createElement("span");
      b.className = "blk";
      b.innerHTML = html;
      P.out.insertBefore(b, before || null);
      if (farIO) farIO.observe(b);
      return b;
    };

    // ---- 程序 ----
    P.run = function (prog, quiet) {
      if (P.side && P.onRun && P.onRun(prog)) { if (prog !== P.shell && prog.detach) prog.detach(); return; } // 右侧栏：换别的 agent、退出，交给编辑区
      if (P.program && P.program !== prog && P.program.detach) P.program.detach();
      if (P.vs && P.vs.onRun) P.vs.onRun(prog); // 这个标签页拆成了几格（vsplit.js）：换了外壳跟着换，换了别的就合回一格
      P.program = prog;
      el.classList.toggle("shellmode", !!prog.shell);
      el.classList.toggle("ptymode", !!prog.pty);
      el.classList.toggle("pagemode", !!prog.page);
      el.classList.toggle("guimode", !!prog.gui);
      P.renderNow();
      if (!P.side) { P.win.persist(); P.win.syncTitles(); }
      if (!quiet) P.focus();
    };
    P.title = function () { return P.program ? P.program.title() : "终端"; };
    P.busy = function () { return P.program && P.program.busy ? P.program.busy() : false; };
    P.spec = function () { if (P.lostSpec && P.program === P.shell) return P.lostSpec; var s = P.program && P.program.spec ? P.program.spec() : {}; if (P.vs && P.vs.state && s.agent) { var st = P.vs.state(); if (st) s.vs = st; } return s; }; // 拆成的几格、每格的筛选也记下来
    P.close = function () { try { noteClosed(P); } catch (e) { /* 记不了就算了 */ } if (P.vs && P.vs.close) P.vs.close(); if (P.program && P.program.detach) P.program.detach(); if (P.shell && P.shell !== P.program) P.shell.detach(); if (P.shell && P.shell.dispose) P.shell.dispose(); P.closed = true; };

    // 淡的字（Claude Code 的 dimColor，也就是终端的 faint）：同终端画 faint 一样——正常的字色和底色各一半（xterm.js、Ghostty、iTerm 都是这样），
    //   以前写死 120 灰，比 Claude Code 在终端里的淡字亮一截；换配色跟着变
    function dimRGB() {
      var num = function (v) { var m = /rgba?\(([^)]+)\)/.exec(v || ""); if (!m) return null; var a = m[1].split(",").map(function (x) { return parseFloat(x); }); return a.length >= 3 ? a : null; };
      var fg = num(getComputedStyle(term).color), bg = null;
      for (var e = term; e && !bg; e = e.parentElement) { var c = num(getComputedStyle(e).backgroundColor); if (c && (c.length < 4 || c[3] > 0)) bg = c; }
      if (!fg || !bg) return P.light ? "130;130;130" : "120;120;120";
      return [0, 1, 2].map(function (i) { return Math.round((fg[i] + bg[i]) / 2); }).join(";");
    }
    // ---- 全量重画：换主题、改宽度、换程序 ----
    P.renderAll = function () {
      if (!el.clientWidth || P.off) { P.dirty = true; return; } // 没露着（藏在同一组后面）：露出来时再画
      P.dirty = false;
      P.light = termLight();
      P.theme = P.light ? "light" : "dark";
      el.classList.toggle("tl", P.light);
      P.DIM = rgb(dimRGB());
      [term, foot, jump].forEach(function (x) { x.classList.toggle("ttu-light", P.light); });
      P.measure();
      if (P.program) P.program.render();
      P.drawn = true; // 这次打开后画过（标签页概览：没画过的不为了缩略图整段画一遍）
      P.fit();
      paintSelection();
      P.stick();
      P.onScroll();
    };
    P.renderNow = function () { P.dirty = true; P.renderAll(); };
    P.renderLater = function () { P.dirty = true; check(); };
    // 切回来（换标签页、别的组重排）：画好了、没被标脏、格数 / 字宽 / 深浅都没变——不整段重画（几千行的大会话整段重画要一两百毫秒，切一下卡一下）；
    //   离开时它在看哪儿（贴着底 / 翻到了中间）照原样回去：从页面上拿下来再放回去，滚动位置会归零——不回去就到了最顶上，还会触发往前读更早的记录
    var parked = null;
    P.park = function () { if (el.isConnected && screen.clientHeight) parked = { follow: following, top: screen.scrollTop }; if (el.isConnected && P.program && P.program.park) P.program.park(); };
    P.reshow = function () {
      var s0 = parked;
      parked = null;
      var full = P.dirty || !P.program || !el.clientWidth || !!P.program.pty;
      if (!full) { var ch0 = P.chPx, c0 = P.cols, cw = P.measure() !== c0 || P.chPx !== ch0; full = (cw && !P.program.gui) || termLight() !== P.light; } // 图形界面（gui.js）：换行交给浏览器，宽度变了不用整段重画
      if (full) P.renderNow(); else P.fit();
      if (!P.program || P.program.pty) return;
      if (s0 && !s0.follow) { screen.scrollTop = Math.min(s0.top, maxY()); ownTop = screen.scrollTop; following = atBottom(); }
      else if (!full) P.stick();
      if (P.program.unpark) P.program.unpark();
      if (!full) paintSelection();
      P.onScroll();
    };

    // ---- 临时提示：输入栏上沿的上一行，右对齐、淡紫（同 Claude Code）----
    var flashTimer = 0;
    P.flash = function (msg, ms) {
      flashEl.textContent = msg;
      flashEl.hidden = !msg;
      flashEl.style.right = 3 * P.chPx + "px";
      flashEl.style.top = -P.rowH + "px";
      flashEl.style.lineHeight = P.rowH + "px";
      clearTimeout(flashTimer);
      if (msg) flashTimer = setTimeout(function () { flashEl.hidden = true; }, ms || 4000);
    };

    // ---- 光标：实心块，块里那个字反色；没焦点时不画 ----
    var imeCtx = null, taMoved = false, TA_KEYS = ["font", "lineHeight", "padding", "whiteSpace", "width", "left", "right", "top", "bottom", "height"];
    // 底部那套字的一个字宽（等宽的格子）：量一次，字体变了再量
    var footChKey = "", footChW = 0;
    var footCh = function (cs) {
      var k = cs.font;
      if (k === footChKey && footChW) return footChW;
      var sp = document.createElement("span"); sp.textContent = "MMMMMMMMMM"; sp.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:" + cs.font;
      foot.appendChild(sp); footChW = sp.getBoundingClientRect().width / 10; sp.remove(); footChKey = k;
      return footChW;
    };
    // 底部（输入框）那一套格子：字宽、行高、内边距——点哪儿放光标要按它算（不能用对话区的字宽：底部字号不一样时会往左偏好几个字）
    P.footCell = function () { var cs = getComputedStyle(foot); return { cw: footCh(cs) || P.chPx, rh: parseFloat(cs.lineHeight) || P.rowH, padL: parseFloat(cs.paddingLeft) || 0, padT: parseFloat(cs.paddingTop) || 0 }; };
    P.drawCaret = function (o) {
      // o: { where: "foot" | "page", row, col, ch, color }
      var page = o.where === "page", host = page ? P.page : foot, cs = getComputedStyle(page ? term : foot);
      if (caret.parentNode !== host) host.appendChild(caret);
      // 底部上面留了内边距（agent 的底部）：从内容的第一行算起——光标和字在同一格里，不往上歪
      // 底部的字可能和对话不是同一套字号 / 行高（Agent 界面字体）：按底部自己量出来的行高、字宽放光标，才和字在同一格里（不往上歪）
      var rh = page ? P.rowH : (parseFloat(cs.lineHeight) || P.rowH), cw = page ? P.chPx : footCh(cs) || P.chPx;
      var left = (page ? P.padL : parseFloat(cs.paddingLeft) || 0) + o.col * cw, top = (page ? 0 : parseFloat(cs.paddingTop) || 0) + o.row * rh;
      caret.style.left = left + "px";
      caret.style.top = top + "px";
      caret.style.width = (o.ch && W(o.ch) === 2 ? 2 : 1) * cw + "px";
      caret.style.height = rh + "px";
      caret.style.lineHeight = rh + "px";
      caret.style.font = cs.font;
      caret.style.background = o.color || (P.light ? "#1a1a1a" : "#c7c7c7");
      caret.style.color = P.light ? "#fff" : "#000";
      caret.textContent = o.ch && o.ch !== "\n" ? o.ch : "";
      caret.hidden = document.activeElement !== ta || !!o.hidden;
      // 输入法的候选框跟着光标：把透明的 textarea 挪到光标那一行
      if (page) {
        var y = P.page.offsetTop + o.row * P.rowH - screen.scrollTop + screen.offsetTop;
        ta.style.top = Math.max(0, Math.min(el.clientHeight - P.rowH, y)) + "px";
        ta.style.bottom = "auto";
        ta.style.height = P.rowH + "px";
      } else if (P.ime) {
        // 选字中：textarea 的字体、行高同这里、不折行，摆到它自己的光标正好落在画出来的光标上（这一行光标前面的字有多宽就往左挪多少）——
        // 候选框、拼音都出在光标这儿；选完放回原处（下面）
        var v = ta.value, s = ta.selectionStart == null ? v.length : ta.selectionStart, ls = s > 0 ? v.lastIndexOf("\n", s - 1) + 1 : 0, L = ls ? v.slice(0, ls).split("\n").length - 1 : 0;
        if (!imeCtx) imeCtx = document.createElement("canvas").getContext("2d");
        imeCtx.font = cs.font;
        var st = ta.style;
        st.font = cs.font; st.lineHeight = P.rowH + "px"; st.padding = "0"; st.whiteSpace = "pre"; st.width = "20000px"; st.right = "auto"; st.bottom = "auto";
        st.left = foot.offsetLeft + left - imeCtx.measureText(v.slice(ls, s)).width + "px";
        st.top = foot.offsetTop + top - L * P.rowH + "px";
        st.height = (L + 1) * P.rowH + "px";
        ta.scrollTop = 0; ta.scrollLeft = 0;
        taMoved = true;
      } else if (taMoved || ta.style.top || ta.style.height) { TA_KEYS.forEach(function (k) { ta.style[k] = ""; }); taMoved = false; }
    };
    P.hideCaret = function () { caret.hidden = true; };

    // ---- 跟随（同 Claude Code）：发出东西、滚到底时开始跟随；用户往上翻立刻停止；回到最底才恢复 ----
    var following = true, ownTop = -1;
    P.unread = 0;
    var maxY = function () { return screen.scrollHeight - screen.clientHeight; };
    var atBottom = function () { return maxY() - screen.scrollTop < 2; };
    P.toBottom = function () { following = true; if (P.off) return; screen.scrollTop = screen.scrollHeight; ownTop = screen.scrollTop; if (P.program && P.program.afterScroll) P.program.afterScroll(); }; // 藏在同一组后面的：不量（一量就要排版），露出来时 reshow 贴底；回到底了外壳跟着改（吸顶那一行收起）
    P.stick = function () { if (P.off) return; if (following && cfg.autoscroll !== false) P.toBottom(); if (P.program && P.program.afterScroll) P.program.afterScroll(); };
    P.following = function () { return following; };
    P.scrollByRows = function (n) {
      screen.scrollTop = Math.max(0, Math.min(maxY(), Math.round(screen.scrollTop / P.rowH + n) * P.rowH));
      ownTop = screen.scrollTop;
      following = atBottom();
      P.onScroll();
    };
    // 跟着到底时浏览器自己挪了 scrollTop（内容先变短被夹回来、同一帧里又接上新的一问——连发几句时排着的那几句收走、读进来就是这样）：
    //   不当成你往上翻了，接着贴底。往上翻只认你自己的操作：滚轮、触控板、手指、按键（都走 scrollByRows，在那里定）；
    //   别的路（图片上原生滚、拖着选字、拖缩略图）看 USER_AT——刚用指针、滚轮、手指动过；跳到某一问的传 onScroll(true)
    P.onScroll = function (intent) {
      if (Math.abs(screen.scrollTop - ownTop) > 1) {
        if (following && intent !== true && performance.now() - USER_AT > 400 && !atBottom() && !P.off) { screen.scrollTop = screen.scrollHeight; }
        else following = atBottom();
        ownTop = screen.scrollTop;
      }
      if (screen.scrollLeft) screen.scrollLeft = 0; // 不许横着滚（宽的内容自己折行）
      topgap.classList.toggle("on", screen.scrollTop > 0);
      if (following) P.unread = 0;
      var show = !following && !(P.program && P.program.noJump && P.program.noJump());
      jump.classList.toggle("on", show);
      if (show) {
        jump.textContent = P.unread ? P.unread + " new message" + (P.unread > 1 ? "s" : "") + " ↓" : "Jump to bottom ↓";
        placeJump();
      }
      if (P.program && P.program.afterScroll) P.program.afterScroll();
    };
    // 「Jump to bottom」贴在对话区底边上方一点（不压着输入框上沿那条线）；输入框变高 / 变矮（换行、面板开关）时对话区变了，它跟着挪——看尺寸，不轮询
    //   位置按输入框那一块（foot）的上沿算：底部面板开着、输入框在别处（右侧栏）时也对——不按对话区自己的高度推
    //   横竖都按它真正的定位框（offsetParent，不一定是这一格）算：对准对话区的正中、贴着输入框上沿——以前按这一格算，右边有辅助侧栏时整个往右歪
    function placeJump() {
      if (!jump.classList.contains("on")) return;
      var cb = jump.offsetParent || el, cr = cb.getBoundingClientRect(), er = el.getBoundingClientRect(), sr = screen.getBoundingClientRect(), fr = foot.getClientRects().length ? foot.getBoundingClientRect() : null;
      var edge = fr && fr.height && fr.top >= sr.top && fr.top <= er.bottom + 1 ? fr.top : Math.min(sr.bottom, er.bottom); // 输入框在这一格里：贴着它的上沿；不在（输入框挪到右侧栏了）：贴着对话区的下沿
      // 按字格摆（同 Claude Code 在终端里画的那一行）：一行高、同对话的字，正好盖住对话区最后一整行；左边对到字格（居中取整到格）。
      //   以前是居中 + 往上浮 6px：压在两行中间，上下左右都不在格子上，怎么看都歪
      var tr = term.getBoundingClientRect(), n = String(jump.textContent || "").length + 2, col = Math.max(0, Math.floor(((P.cols || 80) - n) / 2));
      jump.style.font = getComputedStyle(term).font;
      jump.style.height = jump.style.lineHeight = P.rowH + "px";
      jump.style.padding = "0 " + P.chPx + "px";
      jump.style.transform = "none";
      jump.style.bottom = Math.max(0, Math.round(cr.bottom - edge)) + "px";
      jump.style.left = Math.round(tr.left - cr.left + (P.padL || 0) + col * P.chPx) + "px";
    }
    if (window.ResizeObserver) { var jro = new ResizeObserver(placeJump); jro.observe(screen); jro.observe(foot); jro.observe(el); }
    screen.addEventListener("scroll", P.onScroll, { passive: true });
    jump.addEventListener("click", function () { P.toBottom(); P.onScroll(); if (!matchMedia("(hover: none)").matches) P.focus(); }); // 手机、iPad 上不把焦点给输入框：一给键盘就弹出来
    // 阻尼（同 Claude Code 在终端里滚）：一整行一整行地走，不无级滚——滚轮、触控板攒够一行走一行（触控板松手后的惯性照样一行一行走完）；
    //   图片上照原生的顺滑滚；左右滑吃掉（对话没有横向滚动）
    var wheelAcc = 0;
    function rowStep(px) { // 攒着的像素够一行就走一行（正数往下）；走不动了（到头）返回 false
      if (Math.sign(px) !== Math.sign(wheelAcc)) wheelAcc = 0;
      wheelAcc += px;
      var rows = Math.trunc(wheelAcc / P.rowH);
      if (!rows) return true;
      wheelAcc -= rows * P.rowH;
      var y0 = screen.scrollTop;
      P.scrollByRows(rows);
      return screen.scrollTop !== y0;
    }
    screen.addEventListener("wheel", function (e) {
      if (e.ctrlKey || e.metaKey) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); return; }
      if (e.target.closest && e.target.closest(".fig")) { wheelAcc = 0; return; } // 图片上原生顺滑滚
      e.preventDefault();
      rowStep(e.deltaMode === 1 ? e.deltaY * P.rowH : e.deltaMode === 2 ? e.deltaY * screen.clientHeight : e.deltaY);
    }, { passive: false });
    // 手指（iPad）：同样一整行一整行地走——跟着手指攒够一行走一行；松手后带惯性接着一行一行走、慢慢停（减速同 iOS 的 0.998/ms）；到头就停，不回弹
    var tY = null, tT = 0, tV = 0, fling = 0;
    var flingStop = function () { if (fling) cancelAnimationFrame(fling); fling = 0; };
    screen.addEventListener("touchstart", function (e) {
      flingStop();
      if (e.touches.length !== 1 || (e.target.closest && e.target.closest(".fig"))) { tY = null; return; }
      tY = e.touches[0].clientY; tT = e.timeStamp; tV = 0; wheelAcc = 0;
    }, { passive: true });
    screen.addEventListener("touchmove", function (e) {
      if (tY == null || e.touches.length !== 1) return;
      e.preventDefault();
      var y = e.touches[0].clientY, dy = tY - y, dt = Math.max(1, e.timeStamp - tT);
      tV = 0.8 * (dy / dt) + 0.2 * tV;
      tY = y; tT = e.timeStamp;
      rowStep(dy);
    }, { passive: false });
    var touchUp = function (e) {
      if (tY == null) return;
      tY = null;
      var v = e.type === "touchend" && e.timeStamp - tT < 100 ? tV : 0; // 停住了再抬手：没有惯性
      if (Math.abs(v) < 0.1) return;
      var last = performance.now();
      var step = function (now) {
        var dt = Math.min(50, now - last); last = now;
        v *= Math.pow(0.998, dt);
        if (Math.abs(v) < 0.03 || !rowStep(v * dt)) { fling = 0; return; }
        fling = requestAnimationFrame(step);
      };
      fling = requestAnimationFrame(step);
    };
    screen.addEventListener("touchend", touchUp, { passive: true });
    screen.addEventListener("touchcancel", touchUp, { passive: true });

    // ---- 对话区高度取整到整行（同终端）；零头放在最底下（输入栏下面），不夹在内容中间 ----
    var lastH = 0;
    // 输入框在不在这里：agent 的对话，Studio 的右侧栏开着输入框时就在那边（这里只剩对话）
    P.compAway = function () { return !P.side && !!(P.program && P.program.agentId && !P.program.gui && window.STUDIO && STUDIO.composerAway && STUDIO.composerAway(P)); }; // Paimon Code 的 agent、Claude Code 的会话一样
    var wasAway = false;
    P.fit = function () {
      var away = P.compAway();
      if (away !== wasAway) { wasAway = away; el.classList.toggle("nocomp", away); if (!away && P.program && P.program.syncDraft) P.program.syncDraft(); } // 输入框回到这里：接着右侧栏里没发出去的字
      var dr = el.querySelector(":scope > .st-tdrawer"), drH = dr && !dr.hidden && dr.offsetParent ? dr.offsetHeight : 0; // 这个标签页底下「后台任务 · 子 Agent」的抽屉（tdrawer.js）也要让出来
      var fs = el.querySelector(":scope > .st-fsubs"); if (fs && !fs.hidden && fs.offsetParent) drH += fs.offsetHeight; // 面板的 Agent 那一层里输入框上面的「子 Agent」（studio.js footSubs）
      var footH = foot.offsetParent ? foot.offsetHeight : 0, avail = el.clientHeight - footH - drH;
      var h = Math.max(P.rowH * 3, Math.floor(avail / P.rowH) * P.rowH);
      if (P.side && P.compact) h = Math.min(Math.ceil(P.page.offsetHeight / P.rowH) * P.rowH, Math.max(P.rowH, Math.floor((P.maxH ? P.maxH() : 400) / P.rowH) * P.rowH) - footH); // 右侧栏只有输入框：对话区按内容（状态、任务清单）有多高就多高
      if (P.program && P.program.full && P.program.full()) h = 0;
      var vg = P.vs && h && P.vs.fit ? P.vs.fit(avail) : null; // 拆成了几格（vsplit.js）：这一格（主视图）多高，上面让出标题行，下面让给别的格
      if (vg) h = vg.h;
      // 同样的值不再写一遍（写了就算没变也要重新排版：切标签页时白白把整个对话区重排一遍）
      var ss = screen.style, hv = h + "px", mt = (vg ? vg.top : 0) + "px", mb = (vg ? vg.bottom : 0) + "px";
      if (ss.flex !== "none" && ss.flex !== "0 0 auto") ss.flex = "none";
      if (ss.height !== hv) ss.height = hv;
      if (ss.marginTop !== mt) ss.marginTop = mt;
      if (ss.marginBottom !== mb) ss.marginBottom = mb;
      lastH = el.clientHeight;
    };
    // 右侧栏只有输入框时，对话区按内容定高：内容（状态、任务清单）一变就重新量
    var sideRaf = 0;
    if (P.side) new ResizeObserver(function () { if (!P.compact) return; cancelAnimationFrame(sideRaf); sideRaf = requestAnimationFrame(function () { P.fit(); }); }).observe(P.page); // 下一帧再排（回调里直接改高度会「ResizeObserver loop」）
    var resizeT = 0;
    function check() {
      clearTimeout(resizeT);
      // 用 setTimeout 而不是 requestAnimationFrame：后台标签页、屏幕外的 WebView 里 rAF 可能很久不来
      resizeT = setTimeout(function () {
        if (!el.clientWidth || P.closed || P.off) return; // 藏着的：露出来时 reshow 自己量
        // 真终端：宽、高一变就让 xterm 按新大小重排（shell、Claude Code 收到新的行列数重画）——下面按我们自己的屏幕量宽度，真终端时那块是藏着的，量不出变化
        if (P.program && P.program.pty) { if (P.program.fitted) P.program.fitted(); lastH = el.clientHeight; return; }
        var ch0 = P.chPx, c0 = P.cols, cw = P.measure() !== c0 || P.chPx !== ch0;
        if (P.dirty || (cw && !(P.program && P.program.gui))) P.renderAll(); // 图形界面：换行交给浏览器，只是变宽变窄不整段重画
        else if (el.clientHeight !== lastH || cw) { P.fit(); if (P.program && P.program.fitted) P.program.fitted(); }
        P.stick();
      }, 16);
    }
    P.check = check;
    new ResizeObserver(check).observe(el);
    new ResizeObserver(check).observe(screen); // 对话区自己变窄 / 变宽（右边出了缩略图、分屏）而面板没变：也要按新宽度重排，不然右边被裁掉
    new ResizeObserver(function () { P.stick(); }).observe(term); // 内容长高了 → 跟随中就贴底
    screen.addEventListener("contextmenu", function (e) { transcriptCtx(e, P); }); // 对话上右键：对话里显示什么（agent 的对话才有）

    // ---- 选区：自己画（同博客页：浅蓝底、黑字），与选中文字同帧 ----
    var marked = [], lastSelHtml = "";
    function paintSelection() {
      var blocks = [], sel = document.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount && term.contains(sel.anchorNode)) {
        var bx = term.getBoundingClientRect(), rows = new Map();
        Array.prototype.forEach.call(sel.getRangeAt(0).getClientRects(), function (r) {
          var midY = (r.top + r.bottom) / 2;
          if (midY < bx.top || midY > bx.bottom || r.height > P.rowH * 1.5) return;
          var row = Math.floor((midY - bx.top) / P.rowH);
          var c0 = Math.round((r.left - bx.left - P.padL) / P.chPx), c1 = Math.round((r.right - bx.left - P.padL) / P.chPx);
          var cur = rows.get(row);
          rows.set(row, cur ? [Math.min(cur[0], c0), Math.max(cur[1], c1)] : [c0, c1]);
        });
        rows.forEach(function (c, row) {
          if (c[1] > c[0]) blocks.push('<div style="top:' + row * P.rowH + "px;left:" + (P.padL + c[0] * P.chPx) + "px;width:" + (c[1] - c[0]) * P.chPx + "px;height:" + P.rowH + 'px"></div>');
        });
      }
      var html = blocks.join("");
      if (html === lastSelHtml && !blocks.length && !marked.length) return;
      lastSelHtml = html;
      if (selLayer.innerHTML !== html) selLayer.innerHTML = html;
      marked.forEach(function (x) { x.classList.remove("sel"); });
      marked = [];
      if (blocks.length) {
        var range = sel.getRangeAt(0), scope = range.commonAncestorContainer;
        if (scope.nodeType !== 1) scope = scope.parentElement;
        Array.prototype.forEach.call(scope.querySelectorAll(".ttu-box"), function (x) { if (range.intersectsNode(x)) { x.classList.add("sel"); marked.push(x); } });
      }
    }
    document.addEventListener("selectionchange", paintSelection);

    // ---- 输入：透明 textarea；按键交给程序 ----
    P.focus = function () {
      if (P.closed) return;
      if (P.compAway() && window.STUDIO && STUDIO.focusSide && STUDIO.focusSide(tw)) return; // 输入框在右侧栏
      if (P.program && P.program.focus) P.program.focus(); else ta.focus({ preventScroll: true });
    };
    // 输入法选字：从哪儿开始、现在是哪几个字（程序给这几个字画下划线；textarea 挪到光标上，见 drawCaret）；选完重画一次（去掉下划线、textarea 放回去）
    P.ime = null;
    ta.addEventListener("compositionstart", function () { P.ime = { start: ta.selectionStart, text: "" }; });
    ta.addEventListener("compositionupdate", function (e) { if (P.ime) P.ime.text = e.data || ""; });
    ta.addEventListener("compositionend", function () { P.ime = null; if (P.program && P.program.inputChanged) P.program.inputChanged("select"); });
    ["input", "focus", "blur", "select", "click"].forEach(function (t) { ta.addEventListener(t, function () { if (P.program) P.program.inputChanged(t); }); });
    // 光标动了才重画（重画会改 DOM；只看 selectionchange 本身可能自己触发自己）
    var lastCaret = "";
    // 「[Image #N]」「[Pasted text #N +M lines]」是一整块（同 Claude Code）：光标不进到里面——方向键挪进去就跳到另一头、点在里面放到近的那一头；
    //   选中的一头落在里面就扩到整块；Delete（往后删）紧挨着它整块删（Backspace 往前删整块在各自的程序里）
    var TAG_RE = /\[(?:Image #\d+|Pasted text #\d+(?: \+\d+ lines?)?|\.\.\.Truncated text #\d+(?: \+\d+ lines?)?)\]/g, selWas = [0, 0];
    var tagSpans = function (v) { var out = [], m; TAG_RE.lastIndex = 0; while ((m = TAG_RE.exec(v))) out.push([m.index, m.index + m[0].length]); return out; };
    function snapTags() {
      var a = ta.selectionStart, b = ta.selectionEnd, a1 = a, b1 = b;
      if (!P.ime && ta.value.indexOf("[") >= 0) tagSpans(ta.value).forEach(function (r) {
        if (a1 === b1 && a > r[0] && a < r[1]) { a1 = b1 = selWas[0] === r[0] && selWas[1] === r[0] ? r[1] : selWas[0] === r[1] && selWas[1] === r[1] ? r[0] : a - r[0] <= r[1] - a ? r[0] : r[1]; return; } // 从左头往右挪 → 跳到右头；从右头往左 → 左头；点的、按词跳的 → 近的那头
        if (a1 !== b1) { if (a1 > r[0] && a1 < r[1]) a1 = r[0]; if (b1 > r[0] && b1 < r[1]) b1 = r[1]; }
      });
      if (a1 !== a || b1 !== b) ta.setSelectionRange(a1, b1, ta.selectionDirection);
      selWas = [ta.selectionStart, ta.selectionEnd];
    }
    document.addEventListener("selectionchange", function () {
      if (document.activeElement !== ta || !P.program) return;
      snapTags();
      var k = ta.selectionStart + ":" + ta.selectionEnd + ":" + ta.value.length;
      if (k === lastCaret) return;
      lastCaret = k;
      P.program.inputChanged("select");
    });
    ta.addEventListener("keydown", function (e) {
      if (e.isComposing || e.keyCode === 229) return; // 输入法选字中
      if (e.key === "Delete" && !e.metaKey && !e.altKey && ta.selectionStart === ta.selectionEnd) { // 往后删：紧挨着的是一整块就整块删
        var c0 = ta.selectionStart, hitR = tagSpans(ta.value).filter(function (r) { return r[0] === c0; })[0];
        if (hitR) { e.preventDefault(); ta.setRangeText("", hitR[0], hitR[1], "start"); ta.dispatchEvent(new Event("input")); return; }
      }
      if (P.program) P.program.key(e);
    });
    ta.addEventListener("paste", function (e) { if (P.program && P.program.paste) P.program.paste(e); });
    el.addEventListener("click", function (e) { var ref = e.target.closest(".st-imgref"); if (ref && window.STUDIO && STUDIO.preview) { e.preventDefault(); STUDIO.preview(P.win, { src: TSU_IMG.srcOf(ref), title: ref.dataset.name }); } });
    // 拖进来：访达的文件 → 插入路径（同 macOS 的终端）；这台电脑的文件 → 图片给 agent 当附件，别的先放进 ~/上传 再插入路径
    el.addEventListener("dragover", function (e) { e.preventDefault(); el.classList.add("drop-on"); });
    el.addEventListener("dragleave", function (e) { if (!el.contains(e.relatedTarget)) el.classList.remove("drop-on"); });
    el.addEventListener("drop", function (e) {
      e.preventDefault();
      el.classList.remove("drop-on");
      var prog = P.program, real = !!(prog && (prog.pty || (A.remote && A.remote()))), paths = droppedPaths(e);
      if (paths && prog) { dropText(P, pathsText(paths, real)); return P.focus(); }
      // 图片：agent 收下当附件；其余（含文件夹）：交给「传输」上传（它会弹通知），完了把路径插进来。items 得在 drop 这一刻同步取
      var isImg = function (t) { return !!(prog && prog.drop) && /^image\//.test(t || ""); };
      var items = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.items) || []).filter(function (it) { return it.kind === "file"; });
      if (items.some(function (it) { return isImg(it.type); })) prog.drop(e);
      var rest = items.filter(function (it) { return !isImg(it.type); });
      if (rest.length && window.TSU_TRANSFER && TSU_TRANSFER.upload) {
        TSU_TRANSFER.upload(rest).then(function (res) {
          if (!res || !res.dest) return;
          var ps = res.parts.length > 1 ? res.parts.map(function (n) { return res.dest + "/" + n; }) : [res.dest];
          dropText(P, pathsText(ps, real));
        });
      }
      P.focus();
    });
    // 点终端任何地方（没在选字时）都把焦点给输入；选了字：按设置复制
    el.addEventListener("mouseup", function (e) {
      if (P.program && P.program.gui) return; // 图形界面（同 Claude App）：点别处就是点别处，不把焦点拉回输入框（输入框自己失焦）
      var sel = String(document.getSelection());
      if (!sel) { if (!(e.target.closest && e.target.closest(".grp"))) P.focus(); return; } // 点折叠的一组（展开 / 收起）：不把焦点拉走
      // 选了字：按设置复制——松手在折叠的一组（工具、命令输出）里也照样复制（以前在组里松手就不复制：选中了却没进剪贴板）；
      //   网页的剪贴板不让写（App 里常见）就走原生的
      if (cfg.copyOnSelect === false) return;
      var ok = function () { P.flash("Copied " + sel.length + " chars"); }, nat = function () { if (window.nadosNative) nadosNative.call("clipboard.write", { text: sel }).then(ok, function () {}); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(sel).then(ok, nat); else nat();
    });
    foot.addEventListener("mousedown", function (e) { if (P.program && P.program.footDown) P.program.footDown(e); });
    el.addEventListener("mousedown", function () { if (!P.side) tw.ws.activate(P); }, true);
    ta.addEventListener("focus", function () {
      if (P.off) { var a0 = tw.ws && tw.ws.active; if (a0 && a0 !== P && a0.focus) setTimeout(function () { if (P.off) a0.focus(); }, 0); return; } // 藏在同一组后面的（屏幕外）：Tab 键跳进来也不算，焦点还给露着的那个
      if (!P.side) tw.ws.activate(P);
    });
    draggable(el, function (e) { return !P.side && (e.target.classList.contains("grip") || (e.altKey && e.metaKey)) ? { kind: "pane", pane: P } : null; }, function () { return "⠿ " + clip(P.title(), 24); });
    P.setFont = function (px) { [term, foot, jump].forEach(function (x) { x.style.setProperty("--ttu-font-size", px + "px"); }); P.renderLater(); if (P.shell && P.shell.pty && P.program === P.shell) setTimeout(function () { P.shell.render(); }, 30); };
    var savedFont = localStorage.getItem("tsu-font");
    if (savedFont) [term, foot, jump].forEach(function (x) { x.style.setProperty("--ttu-font-size", savedFont + "px"); });

    // 每个面板底下是一个 shell（登录 shell）：服务器有真沙盒就是真终端（xterm.js ↔ 容器里的 bash），否则是浏览器里的小 shell；需要时在上面跑 agent 界面
    var me0 = A.me();
    if (P.side) P.shell = { shell: true, title: function () { return ""; }, busy: function () { return false; }, spec: function () { return { sh: {} }; }, render: function () {}, detach: function () {}, dispose: function () {}, returned: function () {}, focus: function () {}, key: function () {}, inputChanged: function () {}, cwd: function () { return ""; } };
    else P.shell = window.Terminal && (window.TSU_LOCAL || (me0 && me0.sandbox)) ? new PtyView(P, spec.sh || {}) : new ShellView(P, spec.sh || {}); // Paimon Terminal：这台 Mac 上真的 shell
    // 上次开着的 Claude Code / Codex 会话：刚启动时它们可能还没登记（App 刚换过新版、读会话列表慢）——先按 id 建起来；
    //   还是没有就先占着这一格、记着原来是哪个会话（不能存成一个空 shell：以前这样存下去，更新重启后标签页就只剩历史记录），隔一会儿再试
    var ag = spec.agent && (A.get(spec.agent) || connEnsure(spec.agent));
    if (spec.page && window.TSU_BROWSER) P.program = TSU_BROWSER.page(P, spec.page, spec.arg); // Paimon Terminal 的页面（claude.code、paimon.code、历史记录、设置、文件），见 browser.js、studio.js
    else if (ag && !ag.archived) P.program = makeView(P, ag.id); else { P.program = P.shell; if (spec.agent && !ag) { P.lostSpec = spec; retryAgent(P, spec.agent); } }
    el.classList.toggle("shellmode", P.program === P.shell);
    el.classList.toggle("ptymode", !!P.program.pty);
    el.classList.toggle("pagemode", !!P.program.page);
    el.classList.toggle("guimode", !!P.program.gui);
    if (spec.vs && P.program.agentId && window.TSU_VSPLIT) TSU_VSPLIT.restore(P, spec.vs); // 上次拆成的几格、每格的筛选（放进窗口、量得出大小了再摆）
    return P;
  }

  // ======== 真终端：xterm.js ↔ WebSocket ↔ 容器里的 bash（sandboxd 的 /v1/pty，经 Worker 的 /api/sbx/pty）========
  // 敲 paimon（旧名字 agent）：沙盒里的 paimon 命令发一个 OSC 1337 记号，这里收到就切到 agent 的界面；退出 agent 回到这里，shell 一直在
  var XPAL = ["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5", "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff"];
  var XKEYS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
  // Paimon Terminal：终端的颜色跟配色方案走（studio.js）；这里是方案没写的那些（Paimon 深 / 浅）
  function xtermTheme(light) { return window.STUDIO && STUDIO.xtermTheme && root.classList.contains("termapp") ? STUDIO.xtermTheme(null, "editor") : baseXterm(light); } // 编辑区的终端：底色同 TUI
  function baseXterm(light) {
    var t = light ? { background: "#ffffff", foreground: "#1a1a1a", cursor: "#2a2a2a", cursorAccent: "#ffffff", selectionBackground: "#b5d5ff", selectionForeground: "#000000" }
      : { background: "#000000", foreground: "#e3e3e3", cursor: "#d6d6d6", cursorAccent: "#000000", selectionBackground: "#b5d5ff", selectionForeground: "#000000" };
    XPAL.forEach(function (c, i) { t[(i >= 8 ? "bright" + XKEYS[i - 8].charAt(0).toUpperCase() + XKEYS[i - 8].slice(1) : XKEYS[i])] = light && i === 7 ? "#6b6b6b" : light && i === 15 ? "#3a3a3a" : c; });
    return t;
  }
  // Paimon Terminal 的标题（同 macOS 终端）：目录名 — -zsh（家目录是 ~）
  function macTitle(dir) {
    var i = window.TSU_LOCAL && TSU_LOCAL.info(), home = i ? i.home : "", sh = i && i.shell ? "-" + i.shell.split("/").pop() : "-zsh";
    var d = !dir || dir === home ? "~" : dir.split("/").filter(Boolean).pop() || "/";
    return d + " — " + sh;
  }
  // 网址用默认浏览器开（App 里经原生的桥；浏览器里新标签页）
  function openLink(uri) {
    if (!/^https?:\/\//i.test(uri)) return;
    if (window.nadosNative) nadosNative.call("openExternal", { url: uri }).catch(function () {}); else window.open(uri, "_blank", "noopener");
  }
  // 点了网址：按 设置 › 通用 › 打开链接——默认在内置浏览器里开（新标签页），选了「系统浏览器」才交给 Safari 这些
  function openUrl(uri) {
    if (!/^https?:\/\//i.test(uri)) return;
    if (uri.split("#")[0] === location.origin + location.pathname) return; // 这个 App 自己的地址：不在内置浏览器里再开一个自己
    var how = window.STUDIO && STUDIO.get ? STUDIO.get("linkOpen") : "", tw = frontTerm();
    if (how !== "system" && window.TSU_WEB && TSU_WEB.open && tw) { TSU_WEB.open(tw, uri); return; }
    openLink(uri);
  }
  // 对话、终端标签页、右侧栏里的网址：点了走 openUrl（不让页面自己跳走——原生那边会把它交给系统浏览器）
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href^="http"]');
    if (!a || e.defaultPrevented || !a.closest(".tpane, .tside, .st-fam, .st-panel")) return;
    if (/#vs-file:/.test(a.getAttribute("href") || "")) return; // 文件路径（界面从 https 载入时也是 https 开头）：交给对话自己的处理（在右侧打开文件），不当网址开——不然内置浏览器里又开一个 Vibing Studio，一层套一层
    e.preventDefault(); e.stopPropagation();
    openUrl(a.href);
  }, true);
  // 响铃：面板闪一下；不在眼前的挂个铃（标签页上），App 在后台时 Dock 图标跳一下。一秒最多一次
  function ring(P) {
    var now = Date.now();
    if (now - (P.rungAt || 0) < 1000) return;
    P.rungAt = now;
    P.el.classList.remove("bell");
    void P.el.offsetWidth;
    P.el.classList.add("bell");
    setTimeout(function () { P.el.classList.remove("bell"); }, 400);
    if (P.win.ws.active !== P) { P.bell = true; P.win.syncTitles(); }
    if (!document.hasFocus() && window.nadosNative) nadosNative.call("attention").catch(function () {});
  }
  // 路径贴进 shell：同「终端」拖文件进来——空格、括号、引号这些前面加 \（中文不动）
  function shellEscape(p) { return String(p).replace(/[^A-Za-z0-9_\-.,:\/@%+=\u0080-\uffff]/g, "\\$&"); }
  // 要关的面板里有程序在跑（claude、npm run dev……）：先问一声（同「终端」：只开着 shell 的直接关）
  // 先问改了没存的文件（保存 / 不保存 / 取消，studio.js 的 askUnsaved），答好了再问正在跑的程序
  function askClose(panes, what, go) {
    if (window.STUDIO && STUDIO.askUnsaved) return STUDIO.askUnsaved(panes, function () { askRunning(panes, what, go); });
    askRunning(panes, what, go);
  }
  function askRunning(panes, what, go) {
    var names = [];
    panes.forEach(function (p) { var f = p.shell && p.program === p.shell && p.shell.fg; if (f && f.name && names.indexOf(f.name) < 0) names.push(f.name); });
    if (!names.length || !window.TSU_DESK || !TSU_DESK.alert) return go();
    TSU_DESK.alert({ title: "要终止此" + what + "中正在运行的进程吗？", message: "关闭此" + what + "将终止以下进程：" + names.join("、") + "。", icon: "caution",
      buttons: [{ label: "取消", role: "cancel" }, { label: "终止", role: "default", run: go }] });
  }
  function PtyView(P, spec) {
    var LOC = window.TSU_LOCAL, V = this, host = document.createElement("div"), term = null, fit = null, glh = null, ws = null, cwd = spec.cwd || "", alive = false, ended = false, shown = false;
    var title = LOC ? macTitle(cwd) : "user@code: ~";
    // Paimon Terminal：页面刷新前开着的那个 shell（原生那边还在跑）——显示出来时接回去；接不上（App 重开过）才写回留着的字、开新的
    var reattach = LOC && spec.pid ? spec.pid : null, osc = "", fgTitle = "";
    // 标题：程序自己设的（OSC 0 / 2）优先，没有就是「目录 — shell」；程序退了、它设的标题没被别人换掉，就回到「目录 — shell」
    var retitle = function () { title = osc || (LOC ? macTitle(cwd) : title); P.win.syncTitles(); };
    if (reattach) LOC.want(reattach);
    V.shell = true; V.pty = true;
    host.className = "xt";
    P.el.appendChild(host);
    V.title = function () { return title; };
    V.busy = function () { return false; };
    V.spec = function () {
      var bk = backLines(), sh = { cwd: cwd, pty: true }, id = ws && ws.id && ws.readyState <= 1 ? ws.id : reattach;
      if (bk) sh.back = bk;
      if (id) sh.pid = id;
      return { sh: sh };
    };
    V.oscTitle = function () { return osc; }; // 程序自己设的标题（Claude Code：「✳ 会话名」）
    V.cwd = function () { return cwd || (LOC && LOC.info() ? LOC.info().home : "/home/user"); }; // 分屏、新标签页从这里开始
    // 刷新不丢屏幕上的字：最后 200 行（16 KB 以内）的纯文字，刷新后先写回去再接新的 shell（同 macOS 终端恢复窗口）
    function backLines() {
      if (!term) return spec.back;
      var b = term.buffer.active, last = b.length - 1, out = [], total = 0;
      while (last >= 0 && !(b.getLine(last) && b.getLine(last).translateToString(true).trim())) last--;
      for (var i = last; i >= 0 && out.length < 200; i--) {
        var l = b.getLine(i), t = l ? l.translateToString(true) : "";
        total += t.length + 1;
        if (total > 16000) break;
        out.unshift(t);
      }
      return out.length ? out : undefined;
    }
    V.noJump = function () { return true; };
    V.full = function () { return true; };
    V.inputChanged = function () {};
    V.key = function () {};
    V.focus = function () { if (term) term.focus(); };
    V.detach = function () { host.style.display = "none"; shown = false; };
    V.dispose = function () { ended = true; clearInterval(V.cwdT); try { if (ws) ws.close(); } catch (e) { /* 已关 */ } if (reattach && !ws) LOC.drop(reattach); if (glh) glh.dispose(); if (term) term.dispose(); host.remove(); };
    V.paste = function (text) { if (term) term.paste(text); }; // 拖进来的文件路径等：同粘贴（程序开了括号粘贴就包上）
    V.interrupt = function () { if (ws && ws.readyState === 1) ws.send("\x03"); };
    // 替用户敲一段（访达的「在终端中运行」等）：shell 出了第一个提示符（第一次 OSC 7）才发，早了会被 shell 的初始化吃掉
    var typeq = [], prompted = false;
    V.type = function (text) { if (prompted && ws && ws.readyState === 1) ws.send(text); else typeq.push(text); };
    V.clearScrollback = function () { if (term) term.clear(); };
    function writeBack() { if (spec.back && spec.back.length) term.write(spec.back.join("\r\n") + "\r\n\r\nRestored session: " + macDate(new Date()) + "\r\n\r\n"); }
    V.exportText = function () { if (!term) return ""; var b = term.buffer.active, out = []; for (var i = 0; i < b.length; i++) { var l = b.getLine(i); if (l) out.push(l.translateToString(true)); } return out.join("\n").replace(/\s+$/, "") + "\n"; };
    function fontPx() { return +(localStorage.getItem("tsu-font") || 12); }
    function make() {
      var cs = getComputedStyle(P.term), size = fontPx();
      term = new Terminal({ fontFamily: cs.fontFamily, fontSize: size, lineHeight: Math.max(1, Math.round(size * 1.3) / size), letterSpacing: 0, cursorBlink: false, cursorStyle: "block", scrollback: 10000,
        allowProposedApi: true, macOptionIsMeta: true, macOptionClickForcesSelection: true, rightClickSelectsWord: false, drawBoldTextInBrightColors: false, theme: xtermTheme(termLight()) });
      fit = new FitAddon.FitAddon();
      term.loadAddon(fit);
      // 字宽按 Unicode 11（emoji、中日韩字两格；Claude Code 这类程序按这个排版）
      if (window.Unicode11Addon) try { term.loadAddon(new Unicode11Addon.Unicode11Addon()); term.unicode.activeVersion = "11"; } catch (e) { /* 老浏览器：照旧 */ }
      term.open(host);
      // WebGL 画（同 iTerm）：方块、框线字符自己画满整格——行高大于字高时字体里的 ▐▛█▜▌ 之间会有缝（Claude Code 的标志就碎了）；也更快。
      // 挂、摘、丢了再挂（一页最多 16 个 WebGL：藏着的先让出来）见 xterm-gl.js
      if (window.TSU_XGL) glh = TSU_XGL.attach(term, host);
      // 网址：⌘ 点一下用默认浏览器打开（同 iTerm）；程序给的超链接（OSC 8）也一样
      if (window.WebLinksAddon) try { term.loadAddon(new WebLinksAddon.WebLinksAddon(function (e, uri) { if (e.metaKey || e.ctrlKey) openUrl(uri); })); } catch (e) { /* 照旧 */ }
      term.options.linkHandler = { activate: function (e, uri) { if (e.metaKey || e.ctrlKey) openUrl(uri); }, allowNonHttpProtocols: false };
      // 文件路径：⌘ 点一下在右侧打开（Studio）；程序交的元素（OSC 7700，见 studio.js）
      if (window.STUDIO && LOC) STUDIO.fileLinks(term, P);
      term.parser.registerOscHandler(7700, function (d) { if (window.STUDIO) STUDIO.fromOSC(P, d); return true; });
      // 响铃：面板闪一下；不在眼前（别的标签页、窗口在后台）就在标签页上挂个铃，App 在后台时 Dock 图标跳一下（同「终端」）
      term.onBell(function () { ring(P); });
      if (!reattach) { writeBack(); spec.back = null; }
      // 中文输入法直接出的标点（，。？！、……，也包括它开着时敲的半角 . / ?）：WebKit 里按键先报 229（输入法在处理），不组字、只来一个 insertText——
      // xterm 见过这个按键就把这段字丢了（经典问题）。这里在它前面接住，交给 term.input；组字（拼音 → 汉字）照旧由 xterm 处理
      // 只在按键真是 229、xterm 没自己打出这个字的时候接（输入法有时把标点当普通按键放过来：keydown 188 + keypress，xterm 已经打了，再接就成了两个「，，」）
      // 接住以后把输入框还原成按键那一刻的样子（不是清空）：xterm 自己也会在按键后比一比输入框变了什么，清空了它会以为删了字，发一个退格
      var xta = term.textarea, composing = false, compEnd = 0, ime229 = false, pressed = false, kdValue = "";
      if (xta) {
        xta.addEventListener("keydown", function (e) { ime229 = e.keyCode === 229; pressed = false; kdValue = xta.value; }, true);
        xta.addEventListener("keypress", function () { pressed = true; }, true);
        xta.addEventListener("compositionstart", function () { composing = true; }, true);
        xta.addEventListener("compositionend", function () { composing = false; compEnd = performance.now(); }, true);
        xta.addEventListener("input", function (e) {
          if (!ime229 || e.inputType !== "insertText" || !e.data || e.isComposing || composing || performance.now() - compEnd < 60) return;
          ime229 = false;
          e.stopImmediatePropagation();
          if (!pressed) term.input(e.data, true); // 半角的（输入法开着时敲的 . / ? 数字）也接：输入法慢一拍时 xterm 会漏掉
          xta.value = kdValue;
        }, true);
      }
      // Shift+Enter = 换行不发送（Claude Code 认 ESC + 回车；zsh 里它也是「在命令行里插一个换行」）
      term.attachCustomKeyEventHandler(function (e) {
        if (e.type === "keydown" && e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing) { if (ws && ws.readyState === 1) ws.send("\x1b\r"); e.preventDefault(); return false; }
        return true;
      });
      // 程序发的通知（OSC 9，iTerm 的写法；OSC 777;notify;标题;正文）：Claude Code 等着你确认时会发——转成桌面 / 系统通知
      var oscNote = function (title, body) { if (window.TSU_DESK && TSU_DESK.notify) TSU_DESK.notify({ app: "终端", title: String(title || "").slice(0, 200), body: String(body || "").slice(0, 500) }); };
      term.parser.registerOscHandler(9, function (d) { if (!/^\d+;/.test(d)) oscNote(title, d); return true; }); // 9;4;… 是进度条（ConEmu），不当通知
      term.parser.registerOscHandler(777, function (d) { var m = /^notify;([^;]*);?(.*)$/.exec(d); if (m) oscNote(m[1] || title, m[2]); return true; });
      // agent 命令：OSC 1337;TSUAgent=<base64 参数>；OSC 7：shell 的当前目录（恢复窗口时从这里开新 shell）
      term.parser.registerOscHandler(1337, function (data) {
        if (data.indexOf("TSUAgent=") === 0) {
          var bits = data.slice(9).split(";TSUCwd="), dec = function (x) { try { return decodeURIComponent(escape(atob(x || ""))); } catch (e) { return ""; } };
          var args = dec(bits[0]), at = bits.length > 1 ? dec(bits[1]) : "";
          if (at) { cwd = at; retitle(); }
          setTimeout(function () { agentCmd(args.trim(), at); }, 0);
        }
        return true;
      });
      // 每次出提示符 = 一条命令跑完了：让访达、编辑器里的真沙盒镜像再拉一次
      term.parser.registerOscHandler(7, function (data) {
        var m = /^file:\/\/[^/]*(\/.*)$/.exec(data);
        if (m) { var real = decodeURIComponent(m[1]); cwd = (window.SANDBOX && SANDBOX.toVirtual && SANDBOX.toVirtual(real)) || real; P.win.persist(); } // 记成网页里的路径（访达、分屏新开的都认这个）
        if (!prompted) { prompted = true; if (ws && ws.readyState === 1) typeq.splice(0).forEach(function (t) { ws.send(t); }); }
        document.dispatchEvent(new Event("tsu-sandbox-touch"));
        return true;
      });
      term.onTitleChange(function (t) { osc = t || ""; retitle(); });
      // 在跑 Claude Code 的标签页里敲 /config（或 /settings）回车：打开 Studio 的设置窗口（Claude Code 那一区），不是它画在终端里的面板；
      // 窗口里有按钮回到它自带的。只认一个字一个字敲的（用了方向键、Tab 补全、粘贴的就不管，照旧交给 Claude Code）
      var typed = "", typedOK = true;
      var ccConfig = function (d) {
        if (!window.STUDIO || !LOC || !ccOn() || !(V.fg && /claude/i.test(V.fg.name || ""))) { typed = ""; typedOK = true; return false; }
        if (d === "\r") {
          var hit = typedOK && /^\/(config|settings)\s*$/.test(typed), n = typed.length;
          typed = ""; typedOK = true;
          if (!hit) return false;
          if (ws && ws.readyState === 1) ws.send("\x7f".repeat(n)); // 把敲进输入框的 /config 退掉
          STUDIO.settings(P.win, "claude");
          return true;
        }
        if (d === "\x7f") typed = typed.slice(0, -1);
        else if (d === "\x03" || d === "\x15") { typed = ""; typedOK = true; }
        else if (/[\x00-\x1f\x7f]/.test(d)) { typed = ""; typedOK = false; }
        else typed += d;
        return false;
      };
      term.onData(function (d) { if (ccConfig(d)) return; if (ws && ws.readyState === 1) ws.send(d); else if (ended || !alive) connect(); });
      term.onResize(function (sz) { if (ws && ws.readyState === 1) { if (ws.resize) ws.resize(sz.cols, sz.rows); else ws.send(JSON.stringify({ resize: [sz.cols, sz.rows] })); } });
      host.addEventListener("mousedown", function () { P.win.ws.activate(P); }, true);
      term.textarea && term.textarea.addEventListener("focus", function () { P.win.ws.activate(P); });
    }
    function connect() {
      if (ws && ws.readyState <= 1) return;
      ended = false;
      // 起始目录：访达、编辑器那边给的是它们的路径（/home/user/…），换成真沙盒里的（macOS 的 seatbelt 在 /Users/Shared/tsu/… 下；OSC 7 报回来的本来就是真的）
      var start = !LOC && cwd && window.SANDBOX && SANDBOX.toReal ? SANDBOX.toReal(cwd) : cwd;
      if (LOC) { ws = LOC.pty({ cols: term.cols, rows: term.rows, cwd: start, attach: reattach }); reattach = null; } // Paimon Terminal：伪终端在这台 Mac 上（原生的桥），不走服务器
      else ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/sbx/pty?as=user&cols=" + term.cols + "&rows=" + term.rows + (start ? "&cwd=" + encodeURIComponent(start) : ""));
      prompted = false; // 新的 shell：等它的第一个提示符
      ws.binaryType = "arraybuffer";
      ws.onopen = function () {
        alive = true;
        if (LOC && spec.back && !ws.attached) { writeBack(); spec.back = null; } // 原来的 shell 没了：留着的字写回去，下面接新的
        if (ws.attached) prompted = true;
        if (LOC) P.win.persist(); // 记下这个 shell 的 id：页面刷新后接回来
        if (LOC && !V.cwdT) V.cwdT = setInterval(function () {
          if (!ws || !ws.cwd) return; // 藏着的标签页也问（侧栏要知道它在跑什么）
          ws.cwd().then(function (d) {
            if (d && d !== cwd) { cwd = d; retitle(); P.win.persist(); }
            var f = ws.fg && ws.lastFg ? ws.lastFg() : null, had = V.fg;
            V.fg = f; // 前台在跑什么（侧栏据此标出哪个标签页在跑 Claude Code）
            if (f) fgTitle = osc; else if (had && osc && osc === fgTitle) { osc = ""; retitle(); } // 程序退了：它设的标题换回「目录 — shell」
            if (window.STUDIO && (had && had.pid) !== (f && f.pid)) STUDIO.fgChanged(P, f); // 前台换了程序：上一个交的元素收掉
          });
          if (!prompted) { prompted = true; typeq.splice(0).forEach(function (t) { ws.send(t); }); } // 这边的 shell 不发 OSC 7：等一会儿就当它好了
        }, 2000);
      };
      var sock = ws; // 流控按这一个伪终端算（重连以后是新的一个）
      ws.onmessage = function (e) { var d = typeof e.data === "string" ? e.data : new Uint8Array(e.data); if (sock.feed) sock.feed(term, d); else term.write(d); }; // feed：积压多了叫原生先别读（流控），见 studio/local.js；网页版的真 WebSocket 没有
      ws.onclose = function (e) {
        var was = alive;
        alive = false;
        if (V.disposed) return;
        term.write("\r\n\x1b[2m" + (was && e.code === 1000 ? uiT("[进程已完成]") : uiT("[连接断开" + (e.reason ? "：" + e.reason : "") + "]")) + " " + uiT("按任意键新建 Shell") + "\x1b[0m\r\n");
        ended = true;
      };
    }
    V.render = function () {
      host.style.display = "";
      if (!term) { make(); }
      term.options.theme = xtermTheme(termLight());
      if (term.options.fontSize !== fontPx()) { term.options.fontSize = fontPx(); term.options.lineHeight = Math.max(1, Math.round(fontPx() * 1.3) / fontPx()); }
      try { fit.fit(); } catch (e) { /* 还没尺寸 */ }
      if (!ws) connect();
      shown = true;
    };
    V.fitted = function () { try { if (term) fit.fit(); } catch (e) { /* 忽略 */ } };
    V.xterm = function () { return term; }; // 测试、调试用
    V.afterScroll = function () {};
    // 在 xterm 里写几行（不经过 shell）：先清掉当前这行，写完敲一个回车过去——paimon 帮手脚本在等它（等到了才退出，shell 只画一次提示符）；
    // 脚本已经等不及退出了（agent 界面开着超过 5 秒）的话，这个回车就是让 shell 重画提示符
    function note(text) { term.write("\r\x1b[2K\x1b[2m" + text + "\x1b[0m"); if (ws && ws.readyState === 1) ws.send("\r"); }
    function agentCmd(arg, at) {
      var parts = arg.split(/\s+/).filter(Boolean), sub = parts[0] || "", me = A.me();
      if (sub === "ls" || sub === "list" || sub === "archived") return note(agentList(term.cols || 100, { archived: sub === "archived" || parts[1] === "archived" }).rows.join("\r\n") + "\r\n");
      if (sub === "help" || sub === "-h" || sub === "--help") return note("用法：paimon（继续最近的 Agent）· paimon <名字或id> · paimon new [名字] · paimon ls · paimon ls archived\r\n在 Agent 中：/exit 或连按两次 Ctrl+C 返回（agent 在后台继续）\r\n");
      if (!me || !me.loggedIn) { location.href = "/auth/login"; return; }
      if (!me.allowed) return note("此账号尚未获得邀请（仅限受邀用户）。\r\n");
      var target = null;
      if (sub === "new") {
        var nm = parts[1];
        if (nm && !A.validName(nm)) return note("paimon: names start with a letter and use only letters, digits, - and _\r\n");
        if (nm && A.byName(nm)) return note("paimon: there is already an agent named " + nm + " (paimon " + nm + " opens it)\r\n");
        target = A.create({ name: nm });
      } else if (sub) {
        target = A.byName(sub);
        if (!target) return note("paimon: no agent named " + sub + " (paimon ls lists them; paimon new " + sub + " creates it)\r\n");
      } else target = A.list()[0] || A.create({});
      if (at && LOC) A.runtime(target.id).setWorkdir(at); // Paimon Terminal：agent 在敲 paimon 的这个目录干活（同 Claude Code）
      P.run(makeView(P, target.id));
    }
    V.returned = function (agentId) {
      var a = A.get(agentId);
      if (!a || !term) return;
      var st = A.runtime(agentId).state();
      setTimeout(function () { note(a.name + (st === "working" ? " keeps working in the background" : " is in the background") + " · back to it: paimon " + a.name + "\r\n"); }, 30);
    };
    V.print = function (t) { if (term) note(String(t).replace(/\n/g, "\r\n")); };
  }

  // ======== agent 列表（同 teyvat 的 genshin ls）：agent 面板和 paimon ls 共用一套 ========
  // 状态同 teyvat 的 AHW+FBO：[W] 在干活 / [NW] 没在干活；[F] 开在某个终端面板里（前台）、[B] 没开着但还活着（在干活、等定时、等后台任务）、[O] 离线
  // 编号按 F / B / O 三组各自从 1 数，颜色：前台绿、后台蓝、离线白；状态那一列跟编号同色
  var agoCN = function (t) { if (!t) return "从未启动"; var s0 = (Date.now() - t) / 1000; return s0 < 5 ? "刚刚" : s0 < 60 ? Math.floor(s0) + "秒前" : s0 < 3600 ? Math.floor(s0 / 60) + "分钟前" : s0 < 86400 ? Math.floor(s0 / 3600) + "小时前" : Math.floor(s0 / 86400) + "天前"; };
  var durCN = function (ms) { var m = Math.floor(Math.max(0, ms) / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24); return ms < 5000 ? "刚刚" : ms < 60000 ? Math.floor(ms / 1000) + "秒" : m < 60 ? m + "分钟" : h < 24 ? h + "小时" + (m % 60 ? m % 60 + "分钟" : "") : d + "天" + (h % 24 ? h % 24 + "小时" : ""); };
  var ageOf = function (t) { if (!t) return "—"; var s0 = (Date.now() - t) / 1000; return s0 < 3600 ? Math.max(1, Math.floor(s0 / 60)) + "m" : s0 < 86400 ? (s0 / 3600).toFixed(1) + "h" : s0 < 604800 ? (s0 / 86400).toFixed(1) + "d" : s0 < 2592000 ? (s0 / 604800).toFixed(1) + "w" : (s0 / 2592000).toFixed(1) + "mo"; };
  var tokStr = function (n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n); };
  var tokColor = function (n) { return n >= 2e7 ? rgb("200;100;230") : n >= 1e6 ? BLUE : GREEN; };
  // 同 macOS 的 date：Sat Sep 26 12:20:34 GMT+8 2026
  function macDate(d) {
    var tz = "";
    try { tz = (new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(d).find(function (x) { return x.type === "timeZoneName"; }) || {}).value || ""; } catch (e) { tz = ""; }
    var p = d.toString().split(" ");
    return p[0] + " " + p[1] + " " + p[2] + " " + p[4] + (tz ? " " + tz : "") + " " + p[3];
  }
  var GROUP_COLOR = { f: GREEN, b: rgb("113;142;244"), o: "" };
  if (A.setOpenCheck) A.setOpenCheck(function (id) { return allPanes().some(function (p) { return p.program && p.program.agentId === id; }); });
  function agentStatus(a) {
    var r2 = A.runtime(a.id), st = r2.state(), open = allPanes().some(function (p) { return p.program && p.program.agentId === a.id; });
    var working = st === "working" || r2.tasks.some(function (x) { return x.status === "running"; });
    var g = open ? "f" : st !== "idle" || working ? "b" : "o";
    var tag = g === "o" ? "[O] " : (working ? "[W] " : "[NW]") + " [" + g.toUpperCase() + "]";
    return { g: g, tag: tag, time: g === "o" ? agoCN(a.active) : durCN(Date.now() - ((working && r2.stream && r2.stream.t0) || a.active || Date.now())) };
  }
  // cols：可用宽度；o.archived：列归档的（同 genshin ls archived，没有状态列）；o.sel：选中的下标；o.current：当前这个 agent 的 id（名字用淡紫）
  // → { rows, order（按显示顺序的 agent）, at（行号 → order 的下标）}
  function agentList(cols, o) {
    o = o || {};
    var DIMC = rgb("128;128;128"), all = o.archived ? A.archived() : A.list(), st = {};
    if (!o.archived) all.forEach(function (a) { st[a.id] = agentStatus(a); });
    var order = o.archived ? all : ["f", "b", "o"].reduce(function (acc, g) { return acc.concat(all.filter(function (a) { return st[a.id].g === g; }).sort(function (x, y) { return (y.active || 0) - (x.active || 0); })); }, []);
    var rows = [BOLD + "Paimon" + RESET + DIMC + " · " + (o.archived ? uiT(order.length + " 已归档") : F.plural(order.length, "agent") + "  v" + A.SPIRIT.version) + RESET, ""], at = {};
    if (!order.length) return { rows: rows.concat([DIMC + (o.archived ? uiT("无已归档的 Agent。") : "No agents yet — paimon new creates one.") + RESET]), order: order, at: at };
    var mname = function (a) { var m = A.modelOf(a.model); return m ? m.name : a.model || ""; };
    var statusS = function (a) { return st[a.id].tag + " " + uiT(st[a.id].time); };
    var numW = String(order.length).length + 2, nameW = Math.min(36, Math.max.apply(null, [W(uiT("名称")) + 2].concat(order.map(function (a) { return W(a.name); }))) + 2);
    var modelW = Math.max.apply(null, [W(uiT("模型"))].concat(order.map(function (a) { return W(mname(a)); }))) + 2, idW = 10, ageW = 8, histW = 9;
    var statW = o.archived ? 0 : Math.max.apply(null, [W(uiT("运行时长/上次访问"))].concat(order.map(function (a) { return W(statusS(a)); })));
    var base = 2 + numW + nameW + statW, show = { model: true, id: true, age: true, hist: true };
    ["model", "id", "age", "hist"].reverse().forEach(function () {}); // 窄了按顺序去掉：模型、ID、年龄、履历（同 teyvat 先去组织）
    var width = function () { return base + (show.model ? modelW : 0) + (show.id ? idW : 0) + (show.age ? ageW : 0) + (show.hist ? histW : 0); };
    ["model", "id", "age", "hist"].forEach(function (k) { if (width() > cols) show[k] = false; });
    rows.push("  " + " ".repeat(numW) + DIMC + pad(uiT("名称"), nameW) + (show.model ? pad(uiT("模型"), modelW) : "") + (show.id ? pad("ID", idW) : "") + (show.age ? pad(uiT("年龄"), ageW) : "") + (show.hist ? pad(uiT("履历"), histW) : "") + (o.archived ? "" : uiT("运行时长/上次访问")) + RESET);
    rows.push("  " + DIMC + "─".repeat(Math.max(10, Math.min(width() - 2, cols - 2))) + RESET);
    var n = { f: 0, b: 0, o: 0 };
    order.forEach(function (a, i) {
      var g = o.archived ? "o" : st[a.id].g, col = GROUP_COLOR[g], num = ++n[g] + ".", h = A.history ? A.history(a.id) : 0;
      at[rows.length] = i;
      rows.push((o.sel === i ? LAV + "❯" + RESET : " ") + " " + col + pad(num, numW) + RESET + (a.id === o.current ? LAV : "") + pad(clip(a.name, nameW - 1), nameW) + RESET +
        (show.model ? DIMC + pad(clip(mname(a), modelW - 1), modelW) + RESET : "") + (show.id ? DIMC + pad(a.id, idW) + RESET : "") + (show.age ? DIMC + pad(ageOf(a.created), ageW) + RESET : "") +
        (show.hist ? tokColor(h) + pad(tokStr(h), histW) + RESET : "") + (o.archived ? "" : col + statusS(a) + RESET));
    });
    return { rows: rows, order: order, at: at };
  }

  // ======== 经典终端 ========
  var HOST = "code";
  var CMD_NAMES = ["agent", "paimon", "cat", "cd", "chmod", "clear", "cp", "date", "echo", "exit", "find", "grep", "head", "help", "history", "ls", "mkdir", "mv", "node", "printf", "pwd", "python", "rm", "rmdir", "sort", "tail", "touch", "tree", "uniq", "wc", "whoami"];
  var shellHist = (function () { try { return JSON.parse(localStorage.getItem("tsu-shell-history") || "[]"); } catch (e) { return []; } })();
  function pushHist(line) {
    if (!line.trim() || shellHist[shellHist.length - 1] === line) return;
    shellHist.push(line);
    if (shellHist.length > 1000) shellHist = shellHist.slice(-1000);
    try { localStorage.setItem("tsu-shell-history", JSON.stringify(shellHist)); } catch (e) { /* 满了 */ }
  }
  function ShellView(P, spec) {
    var V = this, sh = null, entries = [], running = null, motd = true, histIdx = -1, draft = "", listEl = null, promptEl = null, compl = null;
    V.shell = true;
    var cwd0 = spec.cwd || "/home/user";
    function shellObj() {
      if (!sh && window.SANDBOX) { sh = new SANDBOX.Shell(); if (SANDBOX.exists(cwd0) && SANDBOX.isDir(cwd0)) sh.cwd = cwd0; }
      return sh;
    }
    V.cwd = function () { return sh ? sh.cwd : cwd0; };
    var short = function () { var c = V.cwd(); return c === "/home/user" ? "~" : c === "/" ? "/" : c.slice(c.lastIndexOf("/") + 1); };
    V.prompt = function () { return BOLD + "user@" + HOST + RESET + " " + short() + " % "; };
    var promptW = function () { return W("user@" + HOST + " " + short() + " % "); };
    V.title = function () { return running ? running.cmd.split(/\s+/)[0] : "user@" + HOST + ": " + short(); };
    V.busy = function () { return !!running; };
    V.spec = function () { var bk = backOf(); return { sh: bk ? { cwd: V.cwd(), back: bk } : { cwd: V.cwd() } }; };
    V.detach = function () {};
    // 刷新不丢：最近的命令与输出（最多 100 条、24 KB），刷新后照原样摆回去，下面一行 Restored session: 日期（同 macOS 终端）
    function backOf() {
      var list = [], total = 0;
      for (var i = entries.length - 1; i >= 0 && list.length < 100; i--) {
        var e = entries[i], o = e.raw ? { raw: e.raw } : { prompt: e.prompt, cmd: e.cmd, out: String(e.out || "").slice(-4000) };
        if (e.note) o.note = e.note;
        total += (o.out || "").length + (o.cmd || "").length + (o.raw ? o.raw.join("").length : 0) + 40;
        if (total > 24000) break;
        list.unshift(o);
      }
      return list.length ? { motd: V.motdLines || null, entries: list } : undefined;
    }
    if (spec.back && Array.isArray(spec.back.entries)) {
      motd = false;
      V.motdLines = spec.back.motd || null;
      entries = spec.back.entries.map(function (e) { return e.raw ? { raw: e.raw } : { prompt: e.prompt || "", cmd: e.cmd || "", out: e.out || "", note: e.note }; });
      entries.push({ raw: ["", "Restored session: " + macDate(new Date())] });
    }
    V.noJump = function () { return false; };
    V.full = function () { return false; };

    function entryLines(en) {
      if (en.raw) return en.raw.slice();
      var lines = [];
      var first = V.promptFor(en) + en.cmd;
      wrapKeep(first, P.cols).forEach(function (l) { lines.push(l.text); });
      if (en.out) lines = lines.concat(termLines(en.out.replace(/\n$/, ""), P.cols));
      if (en.note) lines.push(P.DIM + en.note + RESET);
      return lines;
    }
    V.promptFor = function (en) { return en.prompt; };
    function drawEntry(en) {
      var html = P.rowsHtml(entryLines(en));
      if (en.el) en.el.innerHTML = html; else en.el = P.block(html, promptEl);
    }
    V.render = function () {
      P.out.textContent = "";
      promptEl = null;
      listEl = null;
      if (motd) {
        var d = new Date(), last = localStorage.getItem("tsu-last-login");
        localStorage.setItem("tsu-last-login", d.toString().slice(0, 24));
        V.motdLines = ["Last login: " + (last || d.toString().slice(0, 24)) + " on ttys00" + (P.id - 1), P.DIM + "输入 paimon 开始与 AI Agent 对话；paimon ls 列出所有 Agent；help 查看命令。" + RESET];
        motd = false;
      }
      if (V.motdLines) P.block(P.rowsHtml(V.motdLines));
      promptEl = P.block("");
      entries.forEach(function (en) { en.el = null; drawEntry(en); });
      drawPrompt();
    };
    // 当前这一行：提示符 + 正在输入的命令 + 块光标（命令在跑时没有提示符；Tab 补全的候选列在下面）
    function drawPrompt() {
      if (!promptEl) return;
      var rows = [], v = P.ta.value, caretAt = null;
      if (running) {
        promptEl.innerHTML = v ? P.rowsHtml([v], P.footCols()) : "";
        P.hideCaret();
        if (running) return;
      }
      var pw = promptW(), wl = wrapKeep(v, P.cols, pw), pos = P.ta.selectionStart;
      wl.forEach(function (l, i) { rows.push((i ? "" : V.prompt()) + l.text); });
      for (var i = 0; i < wl.length; i++) {
        var nx = wl[i + 1];
        if (!nx || pos < nx.start) { caretAt = { row: i, col: (i ? 0 : pw) + W(v.slice(wl[i].start, Math.max(wl[i].start, pos))) }; break; }
      }
      if (compl) rows = rows.concat(compl);
      promptEl.innerHTML = P.rowsHtml(rows, P.footCols());
      // 光标：这一块在整页里的第几行
      var row0 = Math.round(promptEl.offsetTop / P.rowH);
      if (caretAt) P.drawCaret({ where: "page", row: row0 + caretAt.row, col: caretAt.col, ch: Array.from(v.slice(pos))[0] });
    }
    V.afterScroll = function () { if (!running && promptEl && document.activeElement === P.ta) drawPrompt(); };
    V.fitted = function () {};
    V.inputChanged = function (t) { if (t === "input") compl = null; drawPrompt(); if (t === "input" || t === "click") P.stick(); };
    V.print = function (text, cls) { var en = { prompt: "", cmd: "", out: text }; entries.push(en); drawEntry(en); P.stick(); };

    function run(line) {
      var en = { prompt: V.prompt(), cmd: line, out: "", at: Date.now() };
      entries.push(en);
      if (entries.length > 2000) { entries.splice(0, entries.length - 2000).forEach(function (x) { if (x.el) x.el.remove(); }); }
      drawEntry(en);
      P.ta.value = "";
      compl = null;
      pushHist(line);
      histIdx = -1;
      var trimmed = line.trim();
      if (!trimmed) { drawPrompt(); P.toBottom(); return; }
      // 内置的：清屏、退出、历史、paimon（进 agent 的界面；agent 是旧名字，也认）
      if (/^(clear|cls)$/.test(trimmed)) { entries = []; V.motdLines = null; V.render(); P.fit(); P.toBottom(); return; }
      if (/^(exit|logout)$/.test(trimmed)) { en.note = "[进程已完成]"; drawEntry(en); setTimeout(function () { P.win.ws.closePane(P); }, 250); return; }
      if (trimmed === "history") { en.out = shellHist.slice(-50).map(function (h, i, a) { return String(shellHist.length - a.length + i + 1).padStart(5) + "  " + h; }).join("\n"); drawEntry(en); drawPrompt(); P.toBottom(); return; }
      var ag = /^(?:paimon|agent)(?:\s+(.*))?$/.exec(trimmed);
      if (ag && !/[|>;&]/.test(trimmed) && agentCommand(en, (ag[1] || "").trim())) return;
      var ctl = new AbortController();
      running = { cmd: trimmed, ctl: ctl, en: en };
      P.win.syncBusy();
      P.win.syncTitles();
      drawPrompt();
      var t0 = Date.now(), pending = false;
      var flushOut = function () { pending = false; drawEntry(en); P.stick(); };
      A.ready().then(function () { return SANDBOX.ready(); }).then(function () {
        var s0 = shellObj();
        return s0.run(line, { signal: ctl.signal, onOut: function (chunk) { en.streamed = true; en.out += chunk; if (!pending) { pending = true; setTimeout(flushOut, 30); } } });
      }).then(function (r) {
        if (r.out.indexOf("\x1b[clear]") >= 0) { entries = []; V.motdLines = null; running = null; P.win.syncBusy(); V.render(); P.fit(); P.toBottom(); return; }
        if (!en.streamed) en.out = r.out + r.err;
        if (ctl.signal.aborted && !/\^C\n?$/.test(en.out)) en.out += (en.out && !/\n$/.test(en.out) ? "\n" : "") + "^C";
        done();
      }, function (e) { en.out += (e && e.message || String(e)) + "\n"; done(); });
      function done() {
        running = null;
        en.ms = Date.now() - t0;
        drawEntry(en);
        P.win.syncBusy();
        P.win.syncTitles();
        P.win.persist();
        drawPrompt();
        P.stick();
      }
      P.toBottom();
    }
    // paimon / paimon <名字> / paimon new [名字] / paimon ls：进 agent 界面，或者列出来。返回 false = 交给沙盒里的命令（管道等）
    function agentCommand(en, arg) {
      var parts = arg.split(/\s+/).filter(Boolean), sub = parts[0] || "";
      var me = A.me();
      var say = function (t) { en.out = t; drawEntry(en); drawPrompt(); P.toBottom(); return true; };
      if (sub === "ls" || sub === "list" || sub === "archived") return say(agentList(P.cols, { archived: sub === "archived" || parts[1] === "archived" }).rows.join("\n") + "\n");
      if (sub === "help" || sub === "-h" || sub === "--help") return say("用法：\n  paimon              继续最近使用的 Agent（若无则新建）\n  paimon <名字或id>    继续此 Agent\n  paimon new [名字]    新建 Agent\n  paimon ls           列出所有 agent（[F] 开着 / [B] 后台 / [O] 离线；[W] 在干活）\n  paimon ls archived  列出归档的 agent\n在 agent 里：/exit 或连按两次 Ctrl+C 回到 shell（agent 在后台继续）；空输入按 ← 看所有 agent\n");
      if (!me || !me.loggedIn) { setTimeout(function () { location.href = "/auth/login"; }, 600); return say("需要登录（正在打开 GitHub 登录）…\n"); }
      if (!me.allowed) return say("此账号尚未获得邀请（仅限受邀用户）。\n");
      var target = null;
      if (sub === "new") {
        var nm = parts[1];
        if (nm && !A.validName(nm)) return say("paimon: names start with a letter and use only letters, digits, - and _\n");
        if (nm && A.byName(nm)) return say("paimon: there is already an agent named " + nm + " (paimon " + nm + " opens it)\n");
        target = A.create({ name: nm });
      } else if (sub) {
        target = A.byName(sub);
        if (!target) return say("paimon: no agent named " + sub + " (paimon ls lists them; paimon new " + sub + " creates it)\n");
      } else target = A.list()[0] || A.create({});
      drawEntry(en);
      P.run(makeView(P, target.id));
      return true;
    }
    V.returned = function (agentId) {
      var a = A.get(agentId);
      if (!a) return;
      var rt = A.runtime(agentId), st = rt.state();
      V.print(P.DIM + a.name + (st === "working" ? " keeps working in the background" : st === "waiting" ? " is waiting in the background (tasks / timer)" : " is in the background") + " · back to it: paimon " + a.name + RESET + "\n");
    };

    // ---- Tab 补全：第一个词补命令，其余补路径；多个候选先补公共前缀，补不动了就列出来（同 zsh：不用按两次）----
    function complete() {
      var v = P.ta.value, pos = P.ta.selectionStart, before = v.slice(0, pos), m = /(\S*)$/.exec(before), word = m[1], isCmd = !before.slice(0, before.length - word.length).trim();
      var cands = [];
      if (isCmd && word.indexOf("/") < 0) cands = CMD_NAMES.filter(function (c) { return c.indexOf(word) === 0; }).map(function (c) { return { full: c, show: c, dir: false }; });
      else if (window.SANDBOX) {
        var s0 = shellObj(), slash = word.lastIndexOf("/"), dirPart = slash >= 0 ? word.slice(0, slash + 1) : "", base = word.slice(slash + 1);
        var dir = SANDBOX.norm(dirPart.replace(/^~(?=\/|$)/, "/home/user") || ".", s0.cwd);
        try {
          if (SANDBOX.isDir(dir)) SANDBOX.list(dir).forEach(function (p) {
            var name = p.slice(p.lastIndexOf("/") + 1);
            if (name.indexOf(base) === 0 && (base[0] === "." || name[0] !== ".")) cands.push({ full: dirPart + name, show: name, dir: SANDBOX.isDir(p) });
          });
        } catch (e) { /* 没权限就没有候选 */ }
      }
      if (!cands.length) return;
      var insert = function (text) { P.ta.setRangeText(text, pos - word.length, pos, "end"); };
      if (cands.length === 1) { insert(cands[0].full + (cands[0].dir ? "/" : " ")); compl = null; drawPrompt(); return; }
      var common = cands.reduce(function (acc, c) { var i = 0; while (i < acc.length && acc[i] === c.full[i]) i++; return acc.slice(0, i); }, cands[0].full);
      if (common.length > word.length) { insert(common); compl = null; drawPrompt(); return; }
      var names = cands.map(function (c) { return c.show + (c.dir ? "/" : ""); }), colW = Math.max.apply(null, names.map(W)) + 2, per = Math.max(1, Math.floor(P.cols / colW));
      compl = [];
      for (var i = 0; i < names.length; i += per) compl.push(names.slice(i, i + per).map(function (n) { return pad(n, colW); }).join(""));
      drawPrompt();
      P.stick();
    }

    V.key = function (e) {
      var ta = P.ta, k = e.key;
      if (e.metaKey && !e.ctrlKey) return; // ⌘ 快捷键交给窗口
      if (running) {
        if (e.ctrlKey && (k === "c" || k === "C")) { e.preventDefault(); running.ctl.abort(); return; }
        if (k === "Enter") { e.preventDefault(); return; }
        return;
      }
      if (k === "Enter" && !e.shiftKey) { e.preventDefault(); return run(ta.value); }
      if (e.ctrlKey && (k === "c" || k === "C") && !String(document.getSelection())) {
        e.preventDefault();
        var en = { prompt: V.prompt(), cmd: ta.value + "^C", out: "" };
        entries.push(en); drawEntry(en); ta.value = ""; compl = null; histIdx = -1; drawPrompt(); P.toBottom(); return;
      }
      if (e.ctrlKey && (k === "d" || k === "D") && !ta.value) { e.preventDefault(); return run("exit"); }
      if (e.ctrlKey && (k === "l" || k === "L")) { e.preventDefault(); entries.forEach(function (x) { if (x.el) x.el.remove(); }); entries = []; V.motdLines = null; V.render(); P.fit(); P.toBottom(); return; }
      if (e.ctrlKey && (k === "u" || k === "U")) { e.preventDefault(); ta.setRangeText("", 0, ta.selectionStart, "start"); drawPrompt(); return; }
      if (e.ctrlKey && (k === "w" || k === "W")) { e.preventDefault(); var b = ta.value.slice(0, ta.selectionStart), m = /\S*\s*$/.exec(b); ta.setRangeText("", ta.selectionStart - m[0].length, ta.selectionStart, "start"); drawPrompt(); return; }
      if (k === "Tab") { e.preventDefault(); complete(); return; }
      if (k === "ArrowUp" && ta.value.slice(0, ta.selectionStart).indexOf("\n") < 0) {
        if (histIdx + 1 >= shellHist.length) return;
        e.preventDefault();
        if (histIdx < 0) draft = ta.value;
        histIdx++;
        ta.value = shellHist[shellHist.length - 1 - histIdx];
        ta.setSelectionRange(ta.value.length, ta.value.length);
        drawPrompt(); P.toBottom(); return;
      }
      if (k === "ArrowDown" && histIdx >= 0) {
        e.preventDefault();
        histIdx--;
        ta.value = histIdx < 0 ? draft : shellHist[shellHist.length - 1 - histIdx];
        ta.setSelectionRange(ta.value.length, ta.value.length);
        drawPrompt(); return;
      }
      var pg = { PageDown: 1, PageUp: -1 }[k];
      if (pg) { e.preventDefault(); P.scrollByRows(pg * Math.max(1, Math.floor(P.screen.clientHeight / P.rowH) - 1)); return; }
      if (k === "Escape") { compl = null; drawPrompt(); }
      if (!P.following()) P.toBottom();
    };
    V.paste = function () { setTimeout(drawPrompt, 0); };
    V.clearScrollback = function () { entries = []; V.motdLines = null; V.render(); P.fit(); P.toBottom(); };
    V.interrupt = function () { if (running) running.ctl.abort(); };
    V.exportText = function () { return entries.map(function (en) { return (en.prompt ? en.prompt.replace(/\x1b\[[\d;]*m/g, "") : "") + en.cmd + "\n" + (en.out || "").replace(/\x1b\[[\d;]*m/g, ""); }).join(""); };
  }

  // ======== agent 的界面（同 Claude Code 全屏模式）：接上一个 agent；关掉 / 退出只是不看了，agent 照样跑 ========
  var COMMANDS = [
    { name: "/model", desc: "切换此 Agent 的模型" },
    { name: "/effort", desc: "推理强度：off / low / high / max" },
    { name: "/agents", desc: "所有 Agent（空输入时按 ←）" },
    { name: "/tasks", desc: "后台任务与子 Agent（空输入时按 ↓）" },
    { name: "/rename", args: "名称", desc: "重命名此 Agent" },
    { name: "/permissions", desc: "工作目录外的权限：禁止 / 只读 / 读写（Shift+Tab）" },
    { name: "/goal", args: "条件", desc: "设定目标：每轮结束后检查，未达成则继续（/goal clear 取消）" },
    { name: "/recap", desc: "生成简要回顾：当前进展与下一步（离开 30 分钟后返回时自动生成）" },
    { name: "/statusline", desc: "配置输入框下方显示的信息" },
    { name: "/status", desc: "Agent、模型、余额与上下文" },
    { name: "/usage", desc: "用量与剩余额度" },
    { name: "/context", desc: "上下文窗口的用量明细" },
    { name: "/admin", args: "credit 账号 金额", desc: "管理员：增加额度（/admin credit 账号 50）、授权账号（/admin allow 账号）", admin: true },
    { name: "/config", desc: "设置" },
    { name: "/export", desc: "将此会话导出为 Markdown" },
    { name: "/exit", desc: "返回 Shell（Agent 在后台继续运行）" },
    { name: "/help", desc: "命令与快捷键" },
  ];
  var TOOL_NAMES = { web_search: "Web Search", WebFetch: "Fetch", SendMessage: "Social", ListAgents: "Social", help: "Help" };
  var CC_NAMES = { Edit: "Update", MultiEdit: "Update", Grep: "Search", Glob: "Search", TodoWrite: "Update Todos" }; // Claude Code 风格里的叫法（同 Claude Code 2.x）
  // Claude Code 里不画的工具（同 ~/Desktop/src：renderToolUseMessage 返回 null、或 userFacingName 是空的）：
  //   ABSORB——任务清单那几个，并进前后那一组、不打断（Claude Code 的 isAbsorbedSilently）；SILENT——不画，但前后的组到这里断开
  var CC_ABSORB = /^(TodoWrite|TaskCreate|TaskGet|TaskList|TaskUpdate)$/, CC_SILENT = /^(ToolSearch|AskUserQuestion|EnterPlanMode|SendUserMessage)$/;
  // 别的 agent 发来的消息（同 teyvat 的 social-message）：青蓝色的 ➤ 一行（谁 [mode] · 时间），正文带淡行号
  var SOCIAL_C = { dark: rgb("61;187;255"), light: rgb("0;119;204") };
  var hms = function (t) { var d = new Date(t), z = function (n) { return (n < 10 ? "0" : "") + n; }; return z(d.getHours()) + ":" + z(d.getMinutes()) + ":" + z(d.getSeconds()); };
  var stamp = function (t) { var d = new Date(t), z = function (n, w) { return String(n).padStart(w || 2, "0"); }; return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + " " + hms(t) + "." + z(d.getMilliseconds(), 3); };
  // 桌面的系统命令（sys.js）里有自己名字的（Screenshot、Numbers…）：单独一行 ⏺ Numbers(write A1:B3)，点开看输出；截屏的下面带一张小图
  var sysTitle = function (p) { if (p.name !== "Bash" || !p.sys || !window.TSU_SYS) return ""; var c = TSU_SYS.list().filter(function (x) { return x.name === p.sys; })[0]; return c && c.title ? c.title : ""; };
  var VERB = {
    Bash: ["Running", "Ran", "shell command", "shell commands"], Read: ["Reading", "read", "file", "files"],
    Glob: ["Searching for", "searched for", "pattern", "patterns"], TaskOutput: ["Checking", "checked", "task", "tasks"],
    TaskCreate: ["Creating", "created", "task", "tasks"], TaskUpdate: ["Updating", "updated", "task", "tasks"], TaskList: ["Listing", "listed", "task list", "task lists"], TaskGet: ["Reading", "read", "task", "tasks"],
  };
  var ACCESS_LABEL = { none: [GREEN, "own folder only"], read: [BLUE, "read access outside own folder"], rw: [RED, "read & write outside own folder"] };
  var EFFORT_DESC = { off: "关闭推理（最快、最省）", low: "低", high: "高（默认）", max: "最高（最慢、最贵）" };
  var THINKING = ["hidden", "collapsed", "expanded"];
  var TABS = ["Status", "Config", "Usage", "Stats", "Help"];

  // 输入框里还没发出去的话（按 agent 记，连同折叠起来的粘贴）：刷新不丢
  var DRAFTS = "tsu-drafts", draftsT = 0, drafts = null;
  function draftsMap() { if (!drafts) { try { drafts = JSON.parse(localStorage.getItem(DRAFTS) || "{}") || {}; } catch (e) { drafts = {}; } } return drafts; }
  function saveDrafts() { clearTimeout(draftsT); draftsT = 0; if (drafts) try { localStorage.setItem(DRAFTS, JSON.stringify(drafts)); } catch (e) { /* 满了就算了 */ } }
  function draftSet(id, text, pastes) {
    var m = draftsMap();
    if (text && text.trim()) m[id] = { text: text, pastes: pastes && pastes.length ? pastes.filter(function (p) { return text.indexOf(p.tag) >= 0; }) : undefined };
    else if (m[id]) delete m[id];
    else return;
    clearTimeout(draftsT);
    draftsT = setTimeout(saveDrafts, 120); // 很快就记下：App 退出时页面不一定等得到 pagehide（写了一半的话不能丢）
  }
  window.addEventListener("pagehide", function () { if (draftsT) saveDrafts(); });
  // App 退出前（原生的 applicationShouldTerminate 叫它）：写了一半的话马上记下；正在送的那一句本来就随时记着（claude.js 的 lqSave）
  window.TSU_FLUSH = function () { try { if (draftsT) { clearTimeout(draftsT); saveDrafts(); } } catch (e) { /* 记不了就算了 */ } };
  document.addEventListener("visibilitychange", function () { if (document.hidden && draftsT) saveDrafts(); });
  // ---- 对话里的内容（每个区域右上角的 ··· ；设置 › 对话）：消息、回答、思考、工具、你的 ! 命令、图片、系统 ----
  // 工具按类分，每类一个档位：一次工具调用 = 调用（⏺ Name(参数)）+ 结果（⎿ …）——完整结果 / 结果预览（前几行）/ 只看调用（一行摘要）/ 隐藏
  var TOOL_CATS = [["toolRead", "读取与搜索", "Read、Glob、Grep、LS"], ["toolBash", "命令", "Bash、后台命令的输出"], ["toolEdit", "文件更改", "Edit、Write 的改动"], ["toolWeb", "网页", "网页搜索、网页抓取"],
    ["toolAgent", "子 Agent", "子 Agent、给别的 Agent 发消息"], ["toolTodo", "任务清单", "TodoWrite 与任务"], ["toolOther", "其他工具", "MCP 与其他工具"]];
  var TMODES = [["full", "完整结果"], ["preview", "结果预览"], ["call", "仅调用"], ["hidden", "隐藏"]];
  var THINK_MODES = [["expanded", "展开"], ["collapsed", "一行"], ["hidden", "隐藏"]], BASH_MODES = [["expanded", "完整"], ["preview", "前几行"], ["hidden", "隐藏"]];
  var SYS_KINDS = [["recaps", "回顾（※ recap）"], ["doneLine", "完成行（✻ …）"], ["notices", "后台任务通知"]];
  // 系统错误：不是模型说的、也不是工具的——API 出错（402 额度、429、5xx、过载）、网络、登录与权限、沙盒不可用、中断、模型什么都没回……（工具失败归工具的那几类管）
  var ERR_MODES = [["full", "完整"], ["line", "一行"], ["hidden", "隐藏"]];
  // 运行状态行：在跑时最后那一行（✢ Reticulating… (1s · ↓ 579 tokens · esc to interrupt)）——完整 / 简洁（只有转圈和用时）/ 隐藏（Esc 照样能打断；标签页标题上的 ✳、状态栏还在）
  var WORK_MODES = [["full", "完整"], ["brief", "简洁"], ["hidden", "隐藏"]];
  // 回答分两种：过程说明（一问里夹在工具调用之间的话）——完整 / 一行 / 隐藏；最终回复（最后一次调用工具之后说给你的话）——开 / 关。在跑的这一问：最后那段先算过程说明
  var PROG_MODES = [["full", "完整"], ["line", "一行"], ["hidden", "隐藏"]];
  // ---- 时间戳：隐藏 / 指着那一块时显示 / 始终显示（右边一列时间；换天的地方一条「今天」「昨天」「9月26日」）。用对话记录里的时间（这一问、每个工具、每段话自己的）----
  var TS_MODES = [["hide", "隐藏"], ["hover", "悬停时显示"], ["show", "始终显示"]];
  var tsModeOf = function (view) { var m = view && view.vals ? vcv(view, "timestamps") : view && view.timestamps ? view.timestamps : cv("timestamps"); return m === "hover" || m === "show" ? m : "hide"; }; // 右侧栏、拆分的一格有自己的就用它的
  var enLang = function () { return !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"); };
  var uiT = function (s) { return s && enLang() && TSU_I18N.t ? TSU_I18N.t(s) : s; }; // 终端格子里画的界面字（i18n 不看这里）：英文时自己查词典
  var z2 = function (n) { return (n < 10 ? "0" : "") + n; };
  // 中文 24 小时「03:49」；英文按地区习惯「3:49 AM」；悬停看完整的日期时间
  function tsFmt(t) {
    var d = new Date(t), en = enLang();
    return { hm: en ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : z2(d.getHours()) + ":" + z2(d.getMinutes()),
      full: en ? d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }) : d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 " + z2(d.getHours()) + ":" + z2(d.getMinutes()) + ":" + z2(d.getSeconds()) };
  }
  var dayKey = function (t) { var d = new Date(t); return d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate(); };
  function dayLabel(t) {
    var d = new Date(t), now = new Date(), en = enLang(), k = dayKey(t), yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
    if (k === dayKey(now.getTime())) return en ? "Today" : "今天";
    if (k === dayKey(yest)) return en ? "Yesterday" : "昨天";
    var sameY = d.getFullYear() === now.getFullYear();
    return en ? d.toLocaleDateString("en-US", sameY ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" }) : (sameY ? "" : d.getFullYear() + "年") + (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }
  var turnTime = function (t) { if (!t) return 0; if (t.at) return t.at; var ps = t.parts || []; for (var i = 0; i < ps.length; i++) if (ps[i].t0 || ps[i].at) return ps[i].t0 || ps[i].at; return 0; };
  var tsHtml = function (t) { if (!t) return ""; var f = tsFmt(t); return '<span class="tts" data-t="' + escHtml(f.hm) + '" title="' + escHtml(f.full) + '"></span>'; };
  // 能单独开关的几种（右侧栏自己的筛选用）；有档位的几种（VMODES：关掉再打开回到关之前的那一档，没有就是默认）
  var KINDS = [["prompts", "消息"], ["progress", "过程说明"], ["answers", "最终回复"], ["thinking", "思考"]].concat(TOOL_CATS.map(function (c) { return [c[0], c[1]]; }), [["bashOut", "你用 ! 运行的命令"], ["images", "图片"], ["sysErrors", "系统错误"], ["workLine", "运行状态行"]], SYS_KINDS);
  var VMODES = { thinking: "collapsed", bashOut: "preview", sysErrors: "full", workLine: "full", progress: "full", toolRead: "call", toolBash: "preview", toolEdit: "preview", toolWeb: "call", toolAgent: "call", toolTodo: "full", toolOther: "preview" }; // 各种显示时默认的一档：同「Claude Code 原样」（子 Agent 同 Claude Code：一行状态）
  var PREV = {}; // 预览（编辑区 ··· 里指着的那一项）：临时的值，不存；移开、关菜单就回去
  var cv = function (k) { return k in PREV ? PREV[k] : cfg[k]; };
  var realOn = function (k) { var c = cfg[k]; return c !== false && c !== "hidden"; };
  var kindOn = function (k) { var c = cv(k); return c !== false && c !== "hidden"; };
  var modeNow = function (k) { var c = cfg[k]; return c && c !== true ? c : VMODES[k]; }; // 存下的档位（不算预览）
  var vlast = function () { try { return JSON.parse(localStorage.getItem("tsu-vlast") || "{}") || {}; } catch (e) { return {}; } };
  var kindTo = function (k, on) { var modal = k in VMODES; return on ? (modal ? vlast()[k] || VMODES[k] : true) : (modal ? "hidden" : false); };
  var redrawAgents = function () { allPanes().forEach(function (p) { if (p.program && p.program.agentId) p.renderNow(); }); };
  function setKind(k, on) {
    if (!on && k in VMODES && realOn(k)) { var last = vlast(); last[k] = cfg[k]; try { localStorage.setItem("tsu-vlast", JSON.stringify(last)); } catch (e) { /* 满了 */ } }
    if (A.setCfg(k, kindTo(k, on))) allPanes().forEach(function (p) { p.renderNow(); });
  }
  function setMode(k, v) { delete PREV[k]; if (A.setCfg(k, v)) allPanes().forEach(function (p) { p.renderNow(); }); }
  var prevRaf = 0;
  var prevSoon = function () { cancelAnimationFrame(prevRaf); prevRaf = requestAnimationFrame(redrawAgents); };
  function previewKind(k, on) { if (on) PREV[k] = kindTo(k, !realOn(k)); else delete PREV[k]; prevSoon(); }
  function previewMode(k, v) { if (v === null || v === undefined) delete PREV[k]; else PREV[k] = v; prevSoon(); }
  // 右侧栏自己的筛选（开 / 关）：以前存的是 tools / diffs / web 三个，按类的读不到就看它们
  var sideOn = function (view, k) { if (k in view) return !!view[k]; if (/^tool/.test(k)) return !!(k === "toolEdit" ? view.diffs : k === "toolWeb" ? view.web : view.tools); if (k === "sysErrors" || k === "progress") return !!view.answers; if (k === "workLine") return true;
    if (k === "agentIn") return !!view.prompts; if (k === "agentOut") return sideOn(view, "toolAgent"); if (k === "agentReports") return !!view.notices; // Agent 消息以前跟着：收到的 →「消息」，发出的 → 工具 › 子 Agent，报告 → 后台任务通知
    return false; }; // 系统错误、过程说明以前跟着「回答」；运行状态行以前一直在
  // ---- 一格自己的一整套筛选（同一个标签页拆成几格时的每一格、选了预设的标签页；vsplit.js）：{ vals, preset, base, inv }——
  //   vals 里写了的按它，没写的跟设置（编辑区的 ···、设置 › 对话）；preset：用的哪个预设（改过了就是 null = 自定义，base 记着从哪个改来的）
  var isFull = function (v) { return !!(v && v.vals); };
  var vcv = function (view, k) { if (isFull(view)) { if (view.prev && k in view.prev) return view.prev[k]; if (k in view.vals) return view.vals[k]; } return cv(k); }; // prev：菜单里指着的那一项（预览）
  var shownV = function (c) { return c !== false && c !== "hidden"; };
  // ---- agent 之间的消息（Agent 消息 ›）：「全部」一个档位（agentMsgs），收到的 / 发出的 / 子 Agent 报告各自能单独设（inherit = 跟「全部」）----
  //   收到的：别的 agent 发给它的（› Message from @…）；发出的：它的 SendMessage（› Message to @…）；子 Agent 报告：子 agent 跑完的通知（✓ fork · … finished）
  var AM_MODES = [["full", "完整"], ["line", "一行"], ["hidden", "隐藏"]], AM_SUB = [["agentIn", "收到的"], ["agentOut", "发出的"], ["agentReports", "子 Agent 报告"]];
  var AM_DEF = { agentMsgs: "line", agentIn: "inherit", agentOut: "inherit", agentReports: "inherit" }, AM_VIS = { agentMsgs: "line", agentIn: "line", agentOut: "line", agentReports: "line" }; // 存着的默认（同 Claude Code：都收成一行）、隐藏的反选回来按哪一档
  // 这一种实际按哪一档（full / line / hidden）；右侧栏旧的那种筛选（只有开 / 关）：关着就是隐藏，开着的按设置
  function agentModeIn(view, k) {
    var full = isFull(view);
    if (view && !full && !sideOn(view, k)) return "hidden";
    var g = function (x) { var c = full ? vcv(view, x) : cv(x); return c === undefined ? AM_DEF[x] : c; }, own = g(k), m = own && own !== "inherit" ? own : g("agentMsgs");
    return m === "full" || m === "line" ? m : "hidden";
  }
  // 反选：能开关的每一种——显示着的 → 隐藏，隐藏着的 → 它默认的那一档；按工具单独设过的也一样翻；Agent 消息：「全部」翻，单独设过的（不是继承）也翻
  function invertVals(get, back) {
    var o = {}, own = get("toolModes") || {}, tm = {};
    KINDS.forEach(function (x) { var k = x[0], on = shownV(get(k)); o[k] = k in VMODES ? (on ? "hidden" : back ? back(k) : VMODES[k]) : !on; });
    Object.keys(own).forEach(function (n) { tm[n] = own[n] === "hidden" ? VMODES[A.toolCat(n)] : "hidden"; });
    o.toolModes = tm;
    var am = get("agentMsgs") || AM_DEF.agentMsgs;
    o.agentMsgs = am === "hidden" ? AM_VIS.agentMsgs : "hidden";
    AM_SUB.forEach(function (x) { var c = get(x[0]); if (c && c !== "inherit") o[x[0]] = c === "hidden" ? AM_VIS[x[0]] : "hidden"; });
    return o;
  }
  // ---- 预设：几套各有用处的 + 自己存的（设置里的 viewPresets）。每一套都是完整的一份（每一项都写了，不跟着设置变）：
  //   Claude Code 原样——和 Claude Code 自己画的一样（● Tool(参数) ⎿ 结果前几行 … +N lines；连着的读取与搜索并成一行；思考收成一行；过程说明、最终回复照常；
  //     任务清单在对话里；别的 agent 的消息收着（› Message from @… (ctrl+o to expand)）；子 agent 跑完一行；提醒、钩子这些不显示；时间戳关；出错完整）。
  //     Claude Code 的会话默认用它，设置的出厂值也是它；只看对话；调试（全部完整）；精简（最终回复 + 系统错误）。
  //   「跟随设置」不是一套样子：这一格没有自己的筛选，按 设置 › 对话 来（只在标签页、拆出来的格里有）----
  var CC_VALS = { prompts: true, progress: "full", answers: true, thinking: "collapsed", toolRead: "call", toolBash: "preview", toolEdit: "preview", toolWeb: "call", toolAgent: "call", toolTodo: "hidden", toolOther: "preview", // 任务清单的工具（TaskCreate、TodoWrite…）同 Claude Code 不画：清单在转圈下面
    bashOut: "preview", images: true, sysErrors: "full", workLine: "full", recaps: true, doneLine: true, notices: true, // 回顾：Claude Code 自己也画（※ recap: …）
    agentPrompt: false, agentSteps: true, agentResult: true, mergeReads: true, errorsFull: true, toolModes: {}, timestamps: "hide",
    agentMsgs: "line", agentIn: "inherit", agentOut: "inherit", agentReports: "inherit" };
  var P_OFF = { prompts: false, progress: "hidden", answers: false, thinking: "hidden", bashOut: "hidden", images: false, sysErrors: "hidden", workLine: "hidden", recaps: false, doneLine: false, notices: false, toolModes: {},
    agentMsgs: "hidden", agentIn: "inherit", agentOut: "inherit", agentReports: "inherit" };
  var toolsAll = function (m) { var o = {}; TOOL_CATS.forEach(function (c) { o[c[0]] = m; }); return o; };
  // 三套（用户：没有你自己说的话的模式绝对不行——以前的「精简」去掉）：
  //   Claude Code 风格——同 Claude Code 自己；只看对话——两边说的话 + 过程说明 + 要你确认 / 回答的（提问、计划、权限）+ 出错；调试——全部完整
  //   你自己调过的一套自动存成「自定义」（换到别的预设也不会丢，选回来就是它）
  var PRESETS = [
    { id: "cc", name: "Claude Code 风格", desc: "与 Claude Code 终端界面一致", vals: CC_VALS },
    { id: "chat", name: "只看对话", desc: "仅显示消息与过程说明", vals: Object.assign({}, CC_VALS, toolsAll("hidden"), { prompts: true, progress: "full", answers: true, thinking: "hidden", images: true, sysErrors: "full", workLine: "full", agentIn: "line",
      toolModes: { AskUserQuestion: "full", ExitPlanMode: "full" } }) }, // 提问、提交计划：是要你回应的，不能藏
    { id: "debug", name: "调试", desc: "显示全部内容", vals: Object.assign({}, CC_VALS, toolsAll("full"), { progress: "full", thinking: "expanded", bashOut: "expanded", recaps: true, agentPrompt: true, mergeReads: false, timestamps: "show", agentMsgs: "full" }) },
  ];
  var FOLLOW = { id: "default", name: "跟随设置", desc: "按 设置 › 对话", vals: null }; // 这一格没有自己的筛选（「默认」以前的 id）
  var presetFor = function (agentId) { return /^cc:/.test(String(agentId || "")) ? "cc" : null; }; // 没选过预设的标签页默认用哪一套：Claude Code 的会话 →「Claude Code 原样」
  // 一格筛选里存的那几项（预设存一整份：不跟着设置变）
  var VIEW_KEYS = KINDS.map(function (x) { return x[0]; }).concat(["agentPrompt", "agentSteps", "agentResult", "mergeReads", "errorsFull", "toolModes", "timestamps", "agentMsgs", "agentIn", "agentOut", "agentReports"]);
  function userPresets() {
    var v = window.STUDIO && STUDIO.get ? STUDIO.get("viewPresets") : undefined;
    if (!Array.isArray(v)) { try { v = JSON.parse(localStorage.getItem("tsu-vpresets") || "[]"); } catch (e) { v = []; } }
    return (Array.isArray(v) ? v : []).filter(function (p) { return p && typeof p.id === "string" && typeof p.name === "string" && p.vals && typeof p.vals === "object"; });
  }
  function saveUserPresets(list) { if (window.STUDIO && STUDIO.setv) STUDIO.setv("viewPresets", list); else try { localStorage.setItem("tsu-vpresets", JSON.stringify(list)); } catch (e) { /* 满了 */ } }
  var presetOf = function (id) { return [FOLLOW].concat(PRESETS, userPresets()).filter(function (p) { return p.id === id; })[0] || null; };
  var copyJ = function (o) { return JSON.parse(JSON.stringify(o)); };
  function viewOfPreset(id) { var p = presetOf(id); return p && p.vals ? { vals: copyJ(p.vals), preset: p.id } : null; }
  function viewName(view) {
    if (!isFull(view) || view.preset === "default" && !Object.keys(view.vals).length) return "跟随设置";
    var p = view.preset && presetOf(view.preset); if (p) return p.name;
    var b = view.base && presetOf(view.base);
    return b ? (view.inv ? "反选（" + b.name + "）" : "自定义（" + b.name + "）") : "自定义";
  }
  // 这一格现在实际用的每一项（写了的、跟着设置的都算）：存成预设、反选用
  var snapView = function (view) { var o = {}; VIEW_KEYS.forEach(function (k) { var c = vcv(view, k); if (c !== undefined) o[k] = copyJ(c); }); return o; };
  function invertView(view) { var o = snapView(view); Object.assign(o, invertVals(function (k) { return o[k]; })); return { vals: o, preset: null, base: isFull(view) ? view.preset || view.base || null : "default", inv: true }; }
  // 这一次工具调用显示成哪一档（编辑区按设置和预览；右侧栏关掉的类是 hidden；出错的按「出错的结果总是完整显示」）
  // 按工具单独设了档位的（设置 › 对话 › 按工具、··· › 工具 › 按工具）：盖过它那一类（右侧栏里这一类关着的除外）；一格自己的筛选（view.vals）按它的
  function toolModeIn(view, p) {
    var full = isFull(view), g = function (x) { return vcv(view, x); }, k = A.toolCat(p.name), c = g(k), on = view && !full ? sideOn(view, k) : shownV(c), own = (g("toolModes") || {})[p.name];
    var m = view && !full && !on ? "hidden" : own || (!on ? "hidden" : c && c !== "hidden" ? c : VMODES[k]);
    if (p.name === "SendMessage" && !own) { var ao = agentModeIn(view, "agentOut"); on = ao !== "hidden"; m = ao === "full" ? "full" : ao === "line" ? "call" : "hidden"; } // 发出的消息：按「Agent 消息 › 发出的」（完整 / 一行 / 隐藏）
    // 出错的调用完整显示——只在这一格本来就显示这一类时；自己筛过的一格（底部面板里只有输入框那一份：view = {}）不因为出错冒出来（不然每个出过错的工具都画在底部，看着像又开了一份对话）
    return p.status === "error" && g("errorsFull") !== false && !(view && !full && !on) ? "full" : m;
  }
  // ---- 按工具：列出对话里出现过的工具（给了 agent：它的；没给：所有会话里的），加上已经单独设过的；内置的按类别排，MCP 的按服务器分组 ----
  var TOOL_LABEL = { web_search: "WebSearch" };
  var toolLabel = function (n) { var m = /^mcp__(.+?)__(.+)$/.exec(n); return m ? m[2] : TOOL_LABEL[n] || n; };
  function toolsSeen(agentId) {
    var seen = {}, scan = function (ts) { (ts || []).forEach(function (t) { (t.parts || []).forEach(function (p) { if (p.kind === "tool" && p.name) seen[p.name] = 1; }); }); };
    try {
      // 这个 agent 所有的会话（Claude Code 的会话在它自己的运行时里）；没给 agent：所有会话
      (A.allSessions ? A.allSessions() : []).forEach(function (ss) { if (ss && (!agentId || ss.agentId === agentId)) scan(ss.turns); });
      if (agentId) scan(A.runtime(agentId).session().turns);
    } catch (e) { /* 读不到：只列单独设过的 */ }
    Object.keys(cfg.toolModes || {}).forEach(function (n) { seen[n] = 1; });
    var order = TOOL_CATS.map(function (c) { return c[0]; });
    return Object.keys(seen).sort(function (a, b) {
      var ma = /^mcp__/.test(a), mb = /^mcp__/.test(b);
      if (ma !== mb) return ma ? 1 : -1;
      return order.indexOf(A.toolCat(a)) - order.indexOf(A.toolCat(b)) || (a < b ? -1 : a > b ? 1 : 0);
    });
  }
  // ---- 菜单、表单改谁：编辑区的设置（cfg），或者一格自己的筛选（view：拆分视图里的一格、选了预设的标签页）——同一套菜单 ----
  function invertGlobal() {
    var last = vlast(), o = invertVals(function (k) { return cfg[k]; }, function (k) { return last[k] || VMODES[k]; });
    KINDS.forEach(function (x) { if (x[0] in VMODES && realOn(x[0])) last[x[0]] = cfg[x[0]]; }); // 藏起来的记下原来的档位：再反选回来还是那一档
    try { localStorage.setItem("tsu-vlast", JSON.stringify(last)); } catch (e) { /* 满了 */ }
    var ch = A.setCfgMany ? A.setCfgMany(o) : Object.keys(o).filter(function (k) { return A.setCfg(k, o[k]); }).length > 0;
    if (ch) allPanes().forEach(function (p) { p.renderNow(); });
  }
  var amReset = function (m) { var o = { agentMsgs: m }; AM_SUB.forEach(function (x) { o[x[0]] = "inherit"; }); return o; }; // Agent 消息选「全部」的一档：单独设的都回到继承
  var accGlobal = { on: realOn, now: modeNow, flag: function (k) { return cfg[k]; }, setKind: setKind, setMode: function (k, v) { if (k === "agentMsgs") return accGlobal.setMany(amReset(v)); setMode(k, v); }, prevKind: previewKind, prevMode: previewMode, invert: invertGlobal,
    // 一次改好几项（Agent 消息 ›「全部」：定下一档，单独设的都回到继承）；预览同样一次几项
    setMany: function (o) { Object.keys(o).forEach(function (k) { delete PREV[k]; }); if (A.setCfgMany ? A.setCfgMany(o) : Object.keys(o).filter(function (k) { return A.setCfg(k, o[k]); }).length) allPanes().forEach(function (p) { p.renderNow(); }); },
    prevMany: function (o, on) { Object.keys(o).forEach(function (k) { if (on) PREV[k] = o[k]; else delete PREV[k]; }); prevSoon(); } };
  // redraw(preview)：这一格重画（预览时只重画；定下来的还要存、刷新标题行）
  function viewAcc(view, redraw) {
    var val = function (k) { return k in view.vals ? view.vals[k] : cfg[k]; };
    // 改完了：每一项还和原来那套预设一样就还是它（点了本来就选着的那一档不算改）；真不一样了才是「自定义（从哪套改来的）」，改回去又是它
    var settle = function () {
      delete view.prev; delete view.inv;
      var id = view.preset || view.base, p = id && presetOf(id);
      if (!p || !p.vals) { if (view.preset) { view.base = view.preset; view.preset = null; } return; }
      var same = VIEW_KEYS.every(function (k) { return sameV(k in view.vals ? view.vals[k] : cv(k), p.vals[k]); });
      if (same) { view.preset = p.id; delete view.base; } else { view.base = p.id; view.preset = null; }
    };
    var set = function (k, v) { delete view.prev; view.vals[k] = v; settle(); redraw(false); };
    var prev = function (k, v) { if (v === null || v === undefined) delete view.prev; else { view.prev = {}; view.prev[k] = v; } redraw(true); };
    var kindV = function (k, on) { return on ? (k in VMODES ? VMODES[k] : true) : (k in VMODES ? "hidden" : false); };
    return { view: view, on: function (k) { return shownV(val(k)); }, now: function (k) { var c = val(k); return c && c !== true ? c : VMODES[k]; }, flag: val,
      setKind: function (k, on) { set(k, kindV(k, on)); }, setMode: function (k, v) { if (k === "agentMsgs") { Object.assign(view.vals, amReset(v)); settle(); return redraw(false); } set(k, v); }, prevKind: function (k, p) { prev(k, p ? kindV(k, !shownV(val(k))) : null); }, prevMode: prev,
      setMany: function (o) { Object.assign(view.vals, copyJ(o)); settle(); redraw(false); },
      prevMany: function (o, on) { if (on) view.prev = copyJ(o); else delete view.prev; redraw(true); },
      invert: function () { var nv = invertView(view); Object.keys(view).forEach(function (k) { delete view[k]; }); Object.assign(view, nv); redraw(false); } };
  }
  function byToolItems(agentId, acc) {
    acc = acc || accGlobal;
    var names = toolsSeen(agentId), nm = function (list, v) { var o = list.filter(function (x) { return x[0] === v; })[0]; return o ? o[1] : ""; };
    var catOf = function (k) { return (TOOL_CATS.filter(function (c) { return c[0] === k; })[0] || ["", ""])[1]; };
    var withTool = function (n, v) { var o = Object.assign({}, acc.flag("toolModes") || {}); if (v) o[n] = v; else delete o[n]; return o; };
    var item = function (n) {
      var own = (acc.flag("toolModes") || {})[n], k = A.toolCat(n), inh = nm(TMODES, acc.now(k));
      return { label: toolLabel(n), value: own ? nm(TMODES, own) : "继承（" + inh + "）", items: function () {
        return [{ label: "继承类别（" + catOf(k) + " · " + inh + "）", radio: true, checked: !own, run: function () { acc.setMode("toolModes", withTool(n, null)); }, preview: function (p) { acc.prevMode("toolModes", p ? withTool(n, null) : null); } }, { sep: true }]
          .concat(TMODES.map(function (x) { return { label: x[1], radio: true, checked: own === x[0], run: function () { acc.setMode("toolModes", withTool(n, x[0])); }, preview: function (p) { acc.prevMode("toolModes", p ? withTool(n, x[0]) : null); } }; }));
      } };
    };
    var servers = {}, builtin = names.filter(function (n) { return !/^mcp__/.test(n); }).map(item);
    names.filter(function (n) { return /^mcp__/.test(n); }).forEach(function (n) { var sv = /^mcp__(.+?)__/.exec(n); sv = sv ? sv[1] : "mcp"; (servers[sv] = servers[sv] || []).push(n); });
    var mcp = Object.keys(servers).sort().map(function (sv) { return { label: sv + "（MCP）", items: function () { return servers[sv].map(item); } }; });
    var out = builtin.concat(builtin.length && mcp.length ? [{ sep: true }] : [], mcp);
    return out.length ? out : [{ label: "此对话尚未调用工具", disabled: true }];
  }
  // Agent 显示风格（TUI / GUI）放在对话 ··· 的最上面：应用风格定死了的（Claude App 只有 GUI、Pure Terminal 只有 TUI），另一个灰着写「在此应用风格下不可用」
  function uiMenuItem(MI) {
    var S = window.STUDIO;
    if (!S || !S.get || !S.setv || !S.uiModes) return null;
    var forced = { claude: "gui", terminal: "tui" }[S.get("os")], cur = forced || S.get("ui") || "tui"; // 现在实际用着的（带预览）
    return { label: "Agent 显示风格", icon: MI.ui, value: (S.uiModes.filter(function (x) { return x[0] === cur; })[0] || ["", ""])[1], items: function () {
      return S.uiModes.map(function (x) { var off = !!forced && forced !== x[0]; return { label: x[1] + (off ? "（在此应用风格下不可用）" : ""), icon: MI[x[0]], radio: true, checked: cur === x[0], disabled: off, run: function () { if (!off) S.setv("ui", x[0]); } }; });
    } };
  }
  // 对话自己的 ···（没有编辑区标签栏的地方用：macOS 风格的窗口标题栏）：同编辑区 ··· 里对话那一段
  function agentMenu(anchor, agentId) {
    if (!window.STUDIO || !STUDIO.menu) return;
    var MI = STUDIO.menuIcons ? STUDIO.menuIcons() : {};
    STUDIO.menu(function () { return convMenu(MI, agentId); }, anchor ? { el: anchor, side: "below-end" } : { x: Math.round(innerWidth / 2), y: 60 });
  }
  // 对话上右键：只有对话里显示什么——视图预设 ›、消息、回答、思考 ›、工具 ›……（显示风格、拆分在编辑区的 ···；任务、输入框那些在它们自己的地方右键）
  function transcriptMenu(MI, agentId, P) {
    MI = MI || {};
    var VS = window.TSU_VSPLIT, x = VS && VS.menu ? VS.menu(MI, agentId, P) : null;
    var pre = x && x.items ? x.items.filter(function (it) { return it.label === "视图预设"; }) : [];
    return pre.concat(pre.length ? [{ sep: true }] : [], convItems(MI, agentId, x && x.acc), [{ sep: true }, tsItem(MI, agentId, x && x.acc)]);
  }
  // 对话区（终端界面的对话、图形界面的消息列表）上右键：选着字时照常（拷贝），不然弹上面那个
  function transcriptCtx(e, P) {
    var pr = P && P.program, aid = pr && pr.agentId;
    if (!aid || P.side || !window.STUDIO || !STUDIO.menu) return;
    if (String(window.getSelection() || "").trim()) return;
    e.preventDefault();
    var MI = STUDIO.menuIcons ? STUDIO.menuIcons() : {};
    // 手机、iPad：对话里不让系统自己选字（一碰就整屏选中、松手了还在选），要复制的长按这里：复制按住的那一段
    var blk = document.documentElement.classList.contains("ipad") && e.target && e.target.closest ? e.target.closest(".blk") : null, bt = blk ? String(blk.innerText || "").replace(/\s+$/, "") : "";
    var copyIt = bt ? [{ label: "复制这一段", icon: MI.copy, run: function () { if (navigator.clipboard) navigator.clipboard.writeText(bt).catch(function () {}); } }, { sep: true }] : [];
    STUDIO.menu(function () { return copyIt.concat(transcriptMenu(MI, aid, P)); }, { x: e.clientX, y: e.clientY });
  }
  var DOTS3 = '<svg viewBox="0 0 16 16"><circle cx="4" cy="8" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/><circle cx="12" cy="8" r="1.1" fill="currentColor"/></svg>';
  // 终端界面、图形界面的对话都交这一个按钮（只在 macOS 风格的窗口标题栏里：别的风格有编辑区的 ···，Claude App 的在它自己的标题 ⌄ 里）
  function agentTabActions(agentId) {
    if (!root.classList.contains("st-macos")) return [];
    return [{ icon: DOTS3, title: "显示方式与内容", run: function () { var e = window.event, b = e && e.target && e.target.closest ? e.target.closest("button") : null; agentMenu(b, agentId); } }];
  }
  // 一样的几档画成菜单（编辑区的 ···）：Agent 显示风格 ›；消息、回答、思考 ›、工具 ›（每类 › 四档；合并读取、出错完整）、你的 ! 命令输出 ›、图片、系统 ›
  // P：这个 agent 的标签页（拆开了、选了预设：显示的那几项改的是当前这一格自己的筛选；前面多「视图预设 ›」「拆分视图 ›」，vsplit.js 给）
  function convMenu(MI, agentId, P) {
    MI = MI || {};
    var ui = uiMenuItem(MI), VS = window.TSU_VSPLIT, x = VS && VS.menu ? VS.menu(MI, agentId, P) : null;
    // 用着一套预设（Claude Code 原样、只看对话……）：不再摊开一长串单项——收成一项「自定义 ›」（在里面改就成了自己的一套）；
    //   跟随设置 / 自己调过的：照旧每项都在。翻译回复是全局的，一直在外面
    var kinds = convItems(MI, agentId, x && x.acc), trI = kinds.filter(function (it) { return it && it.label === "翻译回复"; });
    if (x && x.preset) kinds = [{ label: "自定义", icon: MI.sliders || MI.filter, items: function () { var l = convItems(MI, agentId, x && x.acc).filter(function (it) { return !(it && it.label === "翻译回复"); }); while (l.length && l[l.length - 1] && l[l.length - 1].sep) l.pop(); return l; } }, { sep: true }].concat(trI);
    return (ui ? [ui, { sep: true }] : []).concat(x && x.items.length ? x.items.concat([{ sep: true }]) : [], kinds, window.STUDIO && STUDIO.agentMenuItems ? STUDIO.agentMenuItems(MI, agentId) : []); // 显示 ›（任务清单 ⌃T、后台任务、子 Agent、状态信息）；在跑的时候还有「停止」
  }
  function convItems(MI, agentId, acc) {
    acc = acc || accGlobal;
    var nameOf = function (list, v) { var o = list.filter(function (x) { return x[0] === v; })[0]; return o ? o[1] : ""; };
    var chk = function (k, label, ic) { var on = acc.on(k); return { label: label, icon: MI[ic], checked: on, run: function () { acc.setKind(k, !on); }, preview: function (p) { acc.prevKind(k, p); } }; };
    var modes = function (k, list) { return function () { var now = acc.now(k); return list.map(function (x) { return { label: x[1], radio: true, checked: now === x[0], run: function () { acc.setMode(k, x[0]); }, preview: function (p) { acc.prevMode(k, p ? x[0] : null); } }; }); }; };
    var flag = function (k, label) { var on = acc.flag(k) !== false; return { label: label, checked: on, run: function () { acc.setMode(k, !on); }, preview: function (p) { acc.prevMode(k, p ? !on : null); } }; };
    var modeNow = acc.now, byTool = function (id) { return byToolItems(id, acc); }; // 下面照旧写 modeNow、按工具：都是改谁的那一份
    return [
      chk("prompts", "消息", "msg"),
      { label: "过程说明", icon: MI.note || MI.answer, value: nameOf(PROG_MODES, modeNow("progress")), items: modes("progress", PROG_MODES) },
      chk("answers", "最终回复", "answer"),
      { label: "思考", icon: MI.think, value: nameOf(THINK_MODES, modeNow("thinking")), items: modes("thinking", THINK_MODES) },
      { label: "工具", icon: MI.tool, items: function () {
        return TOOL_CATS.map(function (c) {
          var it = { label: c[1], value: nameOf(TMODES, modeNow(c[0])), items: modes(c[0], TMODES) }, base = it.items;
          // 子 Agent：几档之外还能挑显示哪几块——任务说明（交给它的 prompt）、过程（它自己的每一步）、结果（它的报告）
          if (c[0] === "toolAgent") it.items = function () { return base().concat([{ sep: true }, flag("agentPrompt", "任务说明"), flag("agentSteps", "子 Agent 过程"), flag("agentResult", "结果")]); };
          return it;
        }).concat([{ sep: true }, { label: "按工具", items: function () { return byTool(agentId); } }, { sep: true }, flag("mergeReads", "合并连续的读取与搜索"), flag("errorsFull", "出错的结果总是完整显示")]);
      } },
      agentMsgItem(MI, acc, modes),
      { label: "你用 ! 运行的命令", icon: MI.term, value: nameOf(BASH_MODES, modeNow("bashOut")), items: modes("bashOut", BASH_MODES) },
      chk("images", "图片", "image"),
      { label: "系统", icon: MI.bell, items: function () {
        return [{ label: "系统错误", value: nameOf(ERR_MODES, modeNow("sysErrors")), items: modes("sysErrors", ERR_MODES) },
          { label: "运行状态行", value: nameOf(WORK_MODES, modeNow("workLine")), items: modes("workLine", WORK_MODES) }, { sep: true }]
          .concat(SYS_KINDS.map(function (x) { return chk(x[0], x[1], { recaps: "recap", doneLine: "done", notices: "tray" }[x[0]]); }));
      } },
      // 反选：显示着的都藏起来，藏着的都按默认的一档显示（再点一次回来）
      { label: "反选", icon: MI.invert || MI.swap, run: function () { acc.invert(); } },
      { sep: true },
      // 翻译回复（translate.js）：Agent 说的话翻成选的语言（全局的，同设置 › 对话 › 回复翻译）
      { label: "翻译回复", icon: MI.web, value: nameOf(REPLY_TR, cfg.translateReplies || "off"), items: function () { var cur0 = cfg.translateReplies || "off"; return REPLY_TR.map(function (x) { return { label: x[1], radio: true, checked: cur0 === x[0], run: function () { A.setCfg("translateReplies", x[0]); }, preview: function (p) { if (window.TSU_TRANSLATE && TSU_TRANSLATE.previewReplies) TSU_TRANSLATE.previewReplies(p ? x[0] : null); } }; }); } },
    ];
  }
  // 时间戳：和「缩略图」一组（对话旁边的那些东西，不是对话里显示什么）
  function tsItem(MI, agentId, acc0) {
    var VS = window.TSU_VSPLIT, x = !acc0 && VS && VS.menu ? VS.menu(MI || {}, agentId) : null, acc = acc0 || (x && x.acc) || accGlobal;
    var cur = acc.now("timestamps"), o = TS_MODES.filter(function (m) { return m[0] === cur; })[0];
    return { label: "时间戳", icon: (MI || {}).clock || (MI || {}).time, value: o ? o[1] : "", items: function () { var now = acc.now("timestamps"); return TS_MODES.map(function (m) { return { label: m[1], radio: true, checked: now === m[0], run: function () { acc.setMode("timestamps", m[0]); }, preview: function (p) { acc.prevMode("timestamps", p ? m[0] : null); } }; }); } };
  }
  var REPLY_TR = [["off", "关"], ["display", "跟随显示语言"], ["zh", "简体中文"], ["en", "English"], ["ja", "日本語"], ["ko", "한국어"], ["fr", "Français"], ["de", "Deutsch"], ["es", "Español"]];
  // Agent 消息 ›：全部（定下一档，单独设的都回到继承）；收到的 / 发出的 / 子 Agent 报告（继承全部，或者自己一档）；启动子 Agent（就是 工具 › 子 Agent 那一档，同一个设置）
  function agentMsgItem(MI, acc, modes) {
    var nameOf = function (list, v) { var o = list.filter(function (x) { return x[0] === v; })[0]; return o ? o[1] : ""; };
    var allNow = function () { var c = acc.now("agentMsgs"); return c === "full" || c === "line" || c === "hidden" ? c : AM_DEF.agentMsgs; };
    var reset = amReset;
    var sub = function (k, label) {
      var own = acc.now(k), inh = !own || own === "inherit", allN = nameOf(AM_MODES, allNow());
      return { label: label, value: inh ? "继承（" + allN + "）" : nameOf(AM_MODES, own), items: function () {
        return [{ label: "继承（全部 · " + allN + "）", radio: true, checked: inh, run: function () { acc.setMode(k, "inherit"); }, preview: function (p) { acc.prevMode(k, p ? "inherit" : null); } }, { sep: true }]
          .concat(AM_MODES.map(function (x) { return { label: x[1], radio: true, checked: !inh && own === x[0], run: function () { acc.setMode(k, x[0]); }, preview: function (p) { acc.prevMode(k, p ? x[0] : null); } }; }));
      } };
    };
    return { label: "Agent 消息", icon: MI.agents || MI.msg, value: nameOf(AM_MODES, allNow()), items: function () {
      var all = allNow();
      return [{ label: "全部", value: nameOf(AM_MODES, all), items: function () {
        return AM_MODES.map(function (x) { var o = reset(x[0]); return { label: x[1], radio: true, checked: all === x[0], run: function () { acc.setMany(o); }, preview: function (p) { acc.prevMany(o, p); } }; });
      } }, { sep: true }].concat(AM_SUB.map(function (x) { return sub(x[0], x[1]); }), [{ sep: true },
        { label: "启动子 Agent", value: nameOf(TMODES, acc.now("toolAgent")), items: modes("toolAgent", TMODES) }]); // 同 工具 › 子 Agent（同一个设置）
    } };
  }
  // 右侧栏的筛选（studio.js 的 ···）：同样的分法，每种开 / 关（怎么显示跟编辑区的设置）
  function sideKindItems(sv, set, prev, MI) {
    MI = MI || {};
    var chk = function (k, label, ic) { var on = sideOn(sv, k); return { label: label, icon: MI[ic], checked: on, run: function () { set(k, !on); }, preview: prev(k, !on) }; };
    return [chk("prompts", "消息", "msg"), chk("progress", "过程说明", "note"), chk("answers", "最终回复", "answer"), chk("thinking", "思考", "think"),
      { label: "工具", icon: MI.tool, items: function () { return TOOL_CATS.map(function (c) { return chk(c[0], c[1]); }); } },
      { label: "Agent 消息", icon: MI.agents || MI.msg, items: function () { return AM_SUB.map(function (x) { return chk(x[0], x[1]); }); } },
      chk("bashOut", "你用 ! 运行的命令", "term"),
      { label: "系统", icon: MI.bell, items: function () { return [chk("sysErrors", "系统错误"), chk("workLine", "运行状态行")].concat(SYS_KINDS.map(function (x) { return chk(x[0], x[1]); })); } },
      // 反选：开着的关掉、关着的打开（每一种）
      { label: "反选", icon: MI.invert || MI.swap, run: function () { KINDS.forEach(function (x) { set(x[0], !sideOn(sv, x[0])); }); } },
      // 时间戳：右侧栏自己的（没选就跟编辑区的设置）
      { label: "时间戳", value: sv.timestamps ? (TS_MODES.filter(function (x) { return x[0] === sv.timestamps; })[0] || ["", ""])[1] : "跟随编辑区", items: function () {
        return [["", "跟随编辑区"]].concat(TS_MODES).map(function (x) { return { label: x[1], radio: true, checked: (sv.timestamps || "") === x[0], run: function () { set("timestamps", x[0] || null); }, preview: prev("timestamps", x[0] || null) }; });
      } }];
  }
  // 设置 › 对话、右侧栏里的「视图」：同一张表（P：这一块的——任务清单、状态行放哪；没有就只有内容这几项）
  // 显示哪些内容、怎么显示（设置 › 对话；拆分视图里一格的「编辑…」用同一张表，acc 是那一格的）
  function filterFields(acc) {
    acc = acc || accGlobal;
    var TSHORT = [["full", "完整"], ["preview", "预览"], ["call", "仅调用"], ["hidden", "隐藏"]], val = acc.flag, modeNow = acc.now, tmN = Object.keys(val("toolModes") || {}).length;
    return [
      { key: "$invert", label: "反选", desc: "隐藏当前显示的项，已隐藏的项按默认级别显示；再次反选可恢复", kind: "button", act: "invert", text: "反选" },
      { head: "对话" },
      { key: "prompts", label: "消息", desc: "你发送的消息和斜杠命令", kind: "toggle", value: val("prompts") !== false },
      { key: "progress", label: "过程说明", desc: "一轮回复中穿插在工具调用之间的说明", kind: "seg", options: PROG_MODES, value: modeNow("progress") },
      { key: "answers", label: "最终回复", desc: "最后一次工具调用之后 Agent 给出的回复", kind: "toggle", value: val("answers") !== false },
      { key: "thinking", label: "思考", desc: "Claude Code 的会话记录不含思考内容，此项对其无效；适用于 Paimon 和 Codex 的会话", kind: "seg", options: THINK_MODES, value: modeNow("thinking") },
      { key: "bashOut", label: "你用 ! 运行的命令", desc: "在输入框中以 ! 开头运行的命令", kind: "seg", options: BASH_MODES, value: modeNow("bashOut") },
      // 图片两种（不再有「不显示」）：悬停预览——一行 [Image #N]，指着浮出小图、点了放大（同 Claude Code）；直接显示——缩略图排在对话里
      { key: "imageShow", label: "图片", desc: "悬停预览：显示为 [Image #N]，悬停显示缩略图，点按放大；直接显示：在对话中显示缩略图", kind: "seg", options: [["hover", "悬停预览"], ["inline", "直接显示"]], value: cfg.imageShow || "hover" },
      { key: "timestamps", label: "时间戳", desc: "在每条内容右侧显示时间，悬停可查看完整日期；设为始终显示时，在日期变化处显示分隔线", kind: "seg", options: TS_MODES, value: val("timestamps") || "hide" },
      { head: "工具（调用与结果）" },
    ].concat(TOOL_CATS.map(function (c) { return { key: c[0], label: c[1], desc: c[2], kind: "seg", options: TSHORT, value: modeNow(c[0]) }; }), [
      { key: "agentPrompt", label: "子 Agent：任务说明", desc: "分派给子 Agent 的提示词", kind: "toggle", value: val("agentPrompt") === true },
      { key: "agentSteps", label: "子 Agent：过程", desc: "子 Agent 的执行步骤（如有记录）", kind: "toggle", value: val("agentSteps") !== false },
      { key: "agentResult", label: "子 Agent：结果", desc: "子 Agent 返回的最终报告", kind: "toggle", value: val("agentResult") !== false },
      { key: "toolModes", label: "按工具", desc: "为单个工具设置显示级别，优先于所属类别；仅列出此对话中使用过的工具", kind: "button", act: "bytool", text: tmN ? tmN + " 个单独设置…" : "按工具…" },
      { key: "mergeReads", label: "合并连续的读取与搜索", desc: "将连续的读取和搜索合并为一行（如 Read 3 files, searched for 2 patterns），点按可展开每一项", kind: "toggle", value: val("mergeReads") !== false },
      { key: "errorsFull", label: "出错的结果总是完整显示", desc: "无论所属类别如何设置，失败的调用始终完整显示（红色）", kind: "toggle", value: val("errorsFull") !== false },
      // Agent 消息：全部一档（选了就把下面单独设的都放回继承），收到的 / 发出的 / 子 Agent 报告各自能单独设；启动子 Agent 就是 工具 › 子 Agent 那一档
      { head: "Agent 消息" },
      { key: "agentMsgs", label: "全部", desc: "Agent 之间的消息，包括收到的、发出的消息和子 Agent 报告；在此设置会使下方各项恢复为继承", kind: "seg", options: AM_MODES, value: modeNow("agentMsgs") || AM_DEF.agentMsgs },
      { key: "agentIn", label: "收到的", desc: "其他 Agent 发来的消息（› Message from @…）", kind: "seg", options: [["inherit", "继承"]].concat(AM_MODES), value: modeNow("agentIn") || "inherit" },
      { key: "agentOut", label: "发出的", desc: "发给其他 Agent 的消息（SendMessage：› Message to @…），下方一行显示投递状态", kind: "seg", options: [["inherit", "继承"]].concat(AM_MODES), value: modeNow("agentOut") || "inherit" },
      { key: "agentReports", label: "子 Agent 报告", desc: "子 Agent 完成后返回的结果（✓ fork · … finished · 用时 · tokens）；完整显示时附带报告", kind: "seg", options: [["inherit", "继承"]].concat(AM_MODES), value: modeNow("agentReports") || "inherit" },
      { key: "toolAgent", label: "启动子 Agent", desc: "启动子 Agent 的工具调用（与「工具 › 子 Agent」为同一设置）", kind: "seg", options: TSHORT, value: modeNow("toolAgent") },
      { head: "系统" },
      { key: "sysErrors", label: "系统错误", desc: "模型和工具以外的错误：API 错误（402 额度不足、429、5xx）、网络、登录与权限、沙盒不可用、中断", kind: "seg", options: ERR_MODES, value: modeNow("sysErrors") },
      { key: "workLine", label: "运行状态行", desc: "Agent 运行时显示在最下方的状态行（✢ … (12s · ↓ 579 tokens)）；隐藏后仍可按 Esc 中断，标签页图标仍显示运行状态", kind: "seg", options: WORK_MODES, value: modeNow("workLine") },
    ], SYS_KINDS.map(function (x) { return { key: x[0], label: x[1], kind: "toggle", value: val(x[0]) !== false }; }));
  }
  // ---- 设置 › 对话最上面的「视图预设」：内置的几套 + 自己存的。现在的设置和哪一套一样就显示哪一套，都不一样是「自定义」（改了下面的项就是自定义）；
  //      选一套：把它的每一项写进设置（默认 = 每一项都回到默认的档位）----
  var FLAG_DEF = { agentPrompt: false, agentSteps: true, agentResult: true, mergeReads: true, errorsFull: true, toolModes: {}, timestamps: "hide", agentMsgs: AM_DEF.agentMsgs, agentIn: AM_DEF.agentIn, agentOut: AM_DEF.agentOut, agentReports: AM_DEF.agentReports }; // Agent 消息各项的默认也在这（比较、套用「默认」）
  var effV = function (k) { var c = cfg[k]; if (k in VMODES) return c === "hidden" || c === false ? "hidden" : c && c !== true ? c : VMODES[k]; if (k in FLAG_DEF) return c === undefined ? FLAG_DEF[k] : c; return c !== false; };
  var defVals = function () { var o = {}; KINDS.forEach(function (x) { o[x[0]] = x[0] in VMODES ? VMODES[x[0]] : true; }); return Object.assign(o, copyJ(FLAG_DEF)); };
  var sameV = function (a, b) { if (a && typeof a === "object" || b && typeof b === "object") return JSON.stringify(a || {}) === JSON.stringify(b || {}); return a === b; };
  function globalPresetId(ps) {
    var hit = ps.filter(function (p) { var v = p.vals || defVals(); return Object.keys(v).every(function (k) { return sameV(effV(k), v[k] === true && k in VMODES ? VMODES[k] : v[k]); }); })[0];
    return hit ? hit.id : "custom";
  }
  function presetField() {
    var ps = PRESETS.concat(userPresets()), cur = globalPresetId(ps);
    if (cur === "custom") { saveCustom(); ps = PRESETS.concat(userPresets()); cur = globalPresetId(ps); } // 和哪一套都不一样：就是你自己的——存成「自定义」
    var opts = ps.map(function (p) { return [p.id, p.id === "custom" ? "自定义" : p.name, p.id === "custom" ? "你自己调的（自动保存）" : p.desc || "", p.id !== "custom" && !PRESETS.some(function (b) { return b.id === p.id; }) ? "user" : p.id === "custom" ? "custom" : ""]; });
    return { key: "$preset", label: "视图预设", desc: "一次应用下方「内容」中的全部设置；修改任一项后即为「自定义」，并自动保存", kind: "seg", options: opts, value: cur };
  }
  // 现在的设置存成「自定义」这一套（有就更新）：你调过的永远留着
  function saveCustom() {
    var vals = {}; Object.keys(defVals()).forEach(function (k) { vals[k] = copyJ(effV(k)); });
    VIEW_KEYS.forEach(function (k) { if (!(k in vals)) vals[k] = copyJ(effV(k)); });
    var list = userPresets().filter(function (p) { return p.id !== "custom"; });
    list.unshift({ id: "custom", name: "自定义", vals: vals });
    saveUserPresets(list);
  }
  function applyGlobalPreset(id) {
    if (globalPresetId(PRESETS.concat(userPresets())) === "custom") saveCustom(); // 换走之前：你自己的那套先存好
    var p = presetOf(id); if (!p) return;
    var v = copyJ(p.vals || defVals());
    var ch = A.setCfgMany ? A.setCfgMany(v) : Object.keys(v).filter(function (k) { return A.setCfg(k, v[k]); }).length > 0;
    if (ch) allPanes().forEach(function (q) { q.renderNow(); });
  }
  function convFields(P) {
    // 设置 › 对话：视图预设；内容（消息、过程说明……、工具每类、系统）；显示（时间戳、缩略图、任务清单放哪、任务翻译……）。
    // 「反选」不是一项设置（对话的右键、··· 里有）；「对话」小节改叫「内容」，时间戳挪到「显示」
    var ts = null, out = filterFields(accGlobal).filter(function (x) { if (x.key === "$invert") return false; if (x.key === "timestamps") { ts = x; return false; } return true; }).map(function (x) { return x.head === "对话" ? { head: "内容" } : x; });
    out = [presetField()].concat(out);
    // 显示哪些（位置是定的，有规律：任务清单、后台任务、子 Agent 在 agent 的右边；状态信息在输入框下面）——只有开 / 关；任务清单还有 ⌃T。终端界面、图形界面一样
    var mm = window.STUDIO && STUDIO.miniModes && STUDIO.get ? { key: "minimap", label: "缩略图", desc: "在对话右侧显示缩略图", kind: "seg", options: STUDIO.miniModes, value: STUDIO.get("minimap"), os: ["vscode", "terminal", "macos"] } : null;
    out = out.concat([{ head: "显示" }], ts ? [ts] : [], mm ? [mm] : [], [
      { key: "taskList", label: "任务清单", desc: "在辅助侧栏中显示 Agent 的任务清单（Claude Desktop 风格显示在右侧卡片中）；按 ⌃T 临时显示或隐藏", kind: "toggle", value: cfg.taskList !== false },
      { key: "bgList", label: "后台任务", desc: "在辅助侧栏中显示 Agent 的后台命令", kind: "toggle", value: cfg.bgList !== false },
      { key: "subList", label: "子 Agent", desc: "在辅助侧栏中显示 Agent 启动的子 Agent", kind: "toggle", value: cfg.subList !== false },
      // 任务翻译（translate.js）：任务清单、后台任务、子 Agent、运行状态行那一句翻成选的语言；用自己的额度，翻过的都缓存着（同一句不会翻第二次）
      { key: "translateTasks", label: "任务翻译", desc: "将任务清单、后台任务、子 Agent 和运行状态行翻译为所选语言。翻译使用账户额度，结果会缓存，相同内容不重复计费；费用可在「用量」中查看", kind: "seg", options: [["off", "关"], ["display", "跟随显示语言"], ["zh", "简体中文"], ["en", "English"], ["ja", "日本語"], ["ko", "한국어"], ["fr", "Français"], ["de", "Deutsch"], ["es", "Español"]], value: cfg.translateTasks || "off" },
      // 回复翻译（translate.js）：Agent 说的话（● 那几段、最终回复）按段落翻成选的语言；代码、命令、路径、表格原样；点一下译文看原文（浅色底），再点换回
      { key: "translateShow", label: "译文出现方式", desc: "显示翻译过程：先显示原文，翻译完成后替换为译文（默认）；只显示译文：翻译完成前显示占位符", kind: "seg", options: [["swap", "显示翻译过程"], ["only", "只显示译文"]], value: cfg.translateShow || "swap", show: function () { return (cfg.translateReplies || "off") !== "off"; } },
      { key: "translateReplies", label: "回复翻译", desc: "将 Agent 的回复（不含工具输出和代码）按段落翻译为所选语言。翻译使用账户额度，结果保存在本机和账户中，相同段落不重复翻译；点按译文可查看原文", kind: "seg", options: [["off", "关"], ["display", "跟随显示语言"], ["zh", "简体中文"], ["en", "English"], ["ja", "日本語"], ["ko", "한국어"], ["fr", "Français"], ["de", "Deutsch"], ["es", "Español"]], value: cfg.translateReplies || "off" },
      { key: "footInfo", label: "输入框下的模型与上下文", desc: "在输入框下方显示模型、上下文用量和权限模式", must: true, kind: "toggle", value: cfg.footInfo !== false }]);
    return out;
  }
  function convChange(k, v) {
    if (k === "$preset") return applyGlobalPreset(v);
    if (k === "minimap" && window.STUDIO) return STUDIO.setv("minimap", v); // 缩略图是 Studio 的设置（studio.js 画）
    if (k === "tasks" && window.STUDIO) return STUDIO.place("paimon", "tasks", v);
    if (k === "agentMsgs") { accGlobal.setMode(k, v); autoCustom(); return; } // Agent 消息的「全部」：单独设的都回到继承
    if (A.setCfg(k, v)) allPanes().forEach(function (p) { p.renderNow(); });
    autoCustom();
  }
  // 改了一项、和哪一套内置的都不一样了：马上存成「自定义」（下次换走再换回来还是它）
  function autoCustom() { if (!PRESETS.some(function (b) { return globalPresetId([b]) === b.id; })) saveCustom(); }
  // ---- 界面外壳（wrapper）：agent 在跑什么（运行时）和怎么显示分开；整个 Studio 用同一种——终端界面（下面的 AgentView，同 Claude Code 的 TUI）或图形界面（gui.js）----
  function uiMode() { return window.STUDIO && STUDIO.get && STUDIO.get("ui") === "gui" && window.TSU_GUI ? "gui" : "tui"; } // Agent 显示风格（和应用风格无关）
  // 外壳（ext.js 的 TSU_WRAPPERS）：TUI、GUI 下面各有几种；这里登记 TUI 的「Claude Code 风格」（下面的 AgentView），gui.js 登记 GUI 的
  // 同一个 AgentView，两种样子（style）：Claude Code 风格（默认：别的 agent 发来的消息同 Claude Code 的「› Message from @…」，点开 / ctrl+o 是灰底的正文）、
  // Teyvat 风格（青蓝的 ➤ 名字 [mode] · 时间，正文带行号）
  if (window.TSU_WRAPPERS) {
    TSU_WRAPPERS.register({ id: "claude-code", kind: "tui", name: "Claude Code 风格", make: function (P, id) { return new AgentView(P, id); } });
    TSU_WRAPPERS.register({ id: "teyvat", kind: "tui", name: "Teyvat 风格", make: function (P, id) { return new AgentView(P, id, { style: "teyvat" }); } });
  }
  var wrapperNow = function () { var W = window.TSU_WRAPPERS, k = uiMode(), w = W && W.current(k); return w || { id: k === "gui" ? "claude-app" : "claude-code", make: function (P, id) { return k === "gui" ? TSU_GUI.view(P, id) : new AgentView(P, id); } }; };
  var wrapperOf = function (prog) { return prog.wrapper || (prog.gui ? "claude-app" : "claude-code"); };
  // 右侧栏里的对话：一直是终端界面那种，用 TUI 下选的那一种外壳
  var tuiNow = function () { var W = window.TSU_WRAPPERS, w = W && W.current("tui"); return w || { id: "claude-code", make: function (P, id) { return new AgentView(P, id); } }; };
  // 连接器的会话（cc: / cx:）按 id 登记起来（会话列表还没读到时也能先开着，记录随后读）
  function connEnsure(id) {
    try {
      if (/^cc:/.test(id) && window.TSU_CLAUDE && TSU_CLAUDE.ensure) TSU_CLAUDE.ensure(id.slice(3));
      else if (/^cx:/.test(id) && window.TSU_CODEX && TSU_CODEX.ensure) TSU_CODEX.ensure(id.slice(3));
    } catch (e) { /* 还建不了：等一会儿再试 */ }
    return A.get(id);
  }
  function retryAgent(P, id) {
    var n = 0, t = setInterval(function () {
      if (P.closed || P.program !== P.shell || !P.lostSpec) return clearInterval(t);
      var g = connEnsure(id);
      if (g && !g.archived) { clearInterval(t); P.lostSpec = null; P.run(makeView(P, g.id)); try { if (P.win && P.win.syncTitles) P.win.syncTitles(); } catch (e) { /* 标题下一次再画 */ } persistAll(); return; }
      if (++n >= 60) clearInterval(t); // 30 秒还没有：留着原来的记录（下次启动再试），这一格先是空的 shell
    }, 500);
  }
  function makeView(P, id) {
    if (!P.side && !P.view && !P.follow && presetFor(id)) P.view = viewOfPreset(presetFor(id)); // 没选过预设的标签页：Claude Code 的会话默认「Claude Code 原样」（选了「跟随设置」的记着 P.follow）
    var w = P.side && !P.mirror ? tuiNow() : wrapperNow(), v = w.make(P, id); // 标签页里拆出来的格（P.mirror）：同标签页用的那种外壳
    if (v && !v.wrapper) v.wrapper = w.id;
    return v;
  }
  // 换了界面（TUI / GUI，或者换了一种外壳）：开着的 agent 标签页都换成新的外壳（运行时照跑，对话、没发出去的字都在）
  function applyUI() {
    wins.forEach(function (w) { if (w.open && w.ws && w.ws.ptSync) w.ws.ptSync(); });
    var want = wrapperNow().id, n = 0, wantT = tuiNow().id;
    wins.forEach(function (w) { var sp = w.sidePane; if (sp && sp.program && sp.program.agentId && sp.program.style && wrapperOf(sp.program) !== wantT) sp.run(makeView(sp, sp.program.agentId), true); });
    allPanes().forEach(function (p) {
      if (p.side || !p.program || !p.program.agentId || wrapperOf(p.program) === want) return;
      p.run(makeView(p, p.program.agentId), true);
      n++;
    });
    // 真换了外壳才把焦点给回当前的标签页（别的设置变了也会走到这里：选配色方案时焦点在选择框里，不能抢——抢了选择框就关了）
    if (n) wins.forEach(function (w) { if (w.open && w.ws.active) w.ws.active.focus(); });
  }
  function AgentView(P, agentId, opt) {
    var V = this, rt = A.runtime(agentId), agent = rt.agent;
    V.style = opt && opt.style || "claude-code"; // 外壳的样子：claude-code / teyvat（见上面登记的两种）
    var DIM = function () { return P.DIM; };
    var blocks = new Map(), statusEl = null, bannerEl = null;
    var panel = null, menuIdx = 0, histIdx = -1, draft = "", attach = [], pastes = [], verbose = false, open = {}, moreOpen = {}, tlv = {}, idet = {}, lastCtrlC = 0; // tlv：跑完的一组点开到「标题」这一层；idet：标题这一层里单独点开细节的那几条
    V.agentId = agentId;
    // ---- agent 自己的底部（输入框 → 在跑的那一行 → 状态行）：自动高度；右上角 ··· 管显示哪几块 ----
    var fsash = null, dragH = null, footBase = 0, sashRO = null;
    if (!P.side && !P.mirror) {
      P.el.querySelectorAll(":scope > .st-fsash").forEach(function (x) { x.remove(); }); // 这一格以前那个界面留下的（没收干净的）：只要现在这一个
      P.foot.querySelectorAll(":scope > .st-fsash, :scope > .st-fmore").forEach(function (x) { x.remove(); });
      // 底部（输入框、在跑的那一行、状态行）的高度跟着内容走，不能手动拖（没有 sash、没有「还原高度」）；fsash 只当「这一格有自己的底部」的记号，不挂到页面上
      fsash = document.createElement("div");
      // 底部自己一块（淡淡的底色、上沿一条细线）；右上角「···」：显示哪几块。没有 ×（输入框在这里，不能随手关掉）
      P.el.classList.add("agentfoot");
      var fmore = document.createElement("button");
      fmore.type = "button"; fmore.className = "st-fmore"; fmore.title = "底部的选项";
      fmore.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="3.5" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="12.5" cy="8" r="1.2" fill="currentColor"/></svg>';
      P.foot.appendChild(fmore);
      fmore.addEventListener("mousedown", function (e) { e.stopPropagation(); });
      fmore.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (window.STUDIO && STUDIO.menu) STUDIO.menu(function () { return (P.foot._footItems || footItems)(); }, { el: fmore, side: "below-end" }); });
      // 右键：底部这块元素一直在（换界面、重新挂上都是同一个）——只挂一次，点的时候问现在挂着的那个界面（以前每挂一次多一个，右键一下弹好几个菜单）
      P.foot._footItems = footItems;
      if (!P.foot._ctxOn) { P.foot._ctxOn = true; P.foot.addEventListener("contextmenu", function (e) { var fi = P.foot._footItems; if (!fi || String(window.getSelection() || "").trim()) return; e.preventDefault(); if (window.STUDIO && STUDIO.menu) STUDIO.menu(function () { return fi(); }, { x: e.clientX, y: e.clientY }); }); }
    }
    // 底部的 ···：显示哪几块（运行状态行、状态信息；子 Agent 在辅助侧栏，它的 ··· 里开关）
    function footItems() {
      var MI = window.STUDIO && STUDIO.menuIcons ? STUDIO.menuIcons() : {}, wl = vmode("workLine"), wOn = wl !== "hidden", iOn = cfg.footInfo !== false;
      var set = function (k, v) { return function () { if (A.setCfg(k, v)) allPanes().forEach(function (p) { if (p.renderNow) p.renderNow(); }); }; };
      // 运行状态行：这个标签页有自己的一套筛选（Claude Code 的会话默认套着预设）时改它自己的那一套——只改设置的话被它那一套盖着，点了没反应
      var setWork = function () {
        var v = wOn ? "hidden" : "full";
        if (isFull(P.view)) return viewAcc(P.view, function (prev) { P.renderNow(); if (!prev && window.TSU_VSPLIT && TSU_VSPLIT.setView) TSU_VSPLIT.setView(P, 0, P.view); }).setMode("workLine", v);
        set("workLine", v)();
      };
      var cxs = function (v) { return function () { localStorage.setItem("tsu-cx-center", v); if (panel && panel.kind === "island") renderInput(); }; }, cxOn0 = localStorage.getItem("tsu-cx-center") !== "claude";
      return [
        { label: "添加图片…", icon: MI.image, run: pickImages }, { sep: true }, // 手机、iPad 上没法拖、不好粘：从相册选、拍照（长按输入框也是这个菜单）
        { label: "运行状态行", icon: MI.workline || MI.status, checked: wOn, run: setWork },
        { label: "状态信息", icon: MI.info || MI.eye, checked: iOn, run: set("footInfo", !iOn) },
      ].concat(/^cx:/.test(agentId) ? [{ sep: true }, { header: true, label: "← 会话列表的样子" }, { label: "Codex", checked: cxOn0, radio: true, run: cxs("codex") }, { label: "Claude Code", checked: !cxOn0, radio: true, run: cxs("claude") }] : []);
    }
    V.claude = !!agent.claude;
    // 这一块显示哪些内容：编辑区里按设置（cfg——编辑区标签栏的 ··· 改的就是它）；右侧栏里的按它自己的筛选（P.view，studio.js 给）
    function vmode(k) {
      var full = isFull(P.view), c = full ? vcv(P.view, k) : cv(k), on = full ? shownV(c) : P.view ? sideOn(P.view, k) : kindOn(k); // 拆分的一格、选了预设的：按它自己的一整套
      if (!(k in VMODES)) return on;
      return !on ? "hidden" : c && c !== "hidden" ? c : VMODES[k];
    }
    V.vmode = vmode;
    var toolMode = function (p) { return toolModeIn(P.view, p); };
    var vflag = function (k) { return vcv(P.view, k); }; // 子 Agent 的几块、合并读取、按工具：一格自己的筛选有就按它的
    var amode = function (k) { return agentModeIn(P.view, k); }; // Agent 消息的一种按哪一档：full / line / hidden
    // 输入框换了地方（右侧栏 ↔ 这里）：接着那边没发出去的字
    V.syncDraft = function () { var d = draftsMap()[agentId]; P.ta.value = d ? d.text : ""; pastes = d ? (d.pastes || []).slice() : []; renderInput(); };
    var d0 = draftsMap()[agentId];
    if (d0 && !P.ta.value) { P.ta.value = d0.text; pastes = (d0.pastes || []).slice(); } // 上次没发出去的
    V.title = function () { return agent.name; }; // 在跑不在名字后面挂 ✳：标签页图标那一格换成转圈（V.working，见 drawTabs）
    V.working = function () { return !!rt.stream; };
    // 在等你：问答（AskUserQuestion 还没答）、或者它自己登记成 waiting（权限确认、要你输入）——同 Claude Code 的「needs you / awaiting input」
    V.needsYou = function () {
      if (!agent.claude) return null;
      var q = rt.question ? rt.question() : null;
      if (q) return { kind: "question", text: String((q.questions && q.questions[0] && (q.questions[0].question || q.questions[0].header)) || "") };
      var lv = rt.info && rt.info.live;
      return lv && lv.status === "waiting" ? { kind: "waiting", text: "" } : null;
    };
    V.busy = function () { return false; }; // agent 在后台照样跑：关窗口不用问
    V.spec = function () { return { sh: P.shell.spec().sh, agent: agentId }; };
    V.tabActions = function () { return agentTabActions(agentId); }; // macOS 风格的窗口标题栏：··· 显示方式与内容
    V.noJump = function () { return !!panel; };
    V.full = function () { return !!(panel && panel.full); };

    // ---- 订阅：运行时的事件 → 重画对应的部分 ----
    var wasWorking = !!rt.stream;
    var off1 = rt.on(function (type, data) {
      if (P.closed) return;
      if (type === "append") { appendTurn(data); P.stick(); }
      else if (type === "turn") { drawTurn(data); P.stick(); }
      else if (type === "reset") { // 整段重读了：跟着到底的照旧贴底；在往上翻着看的，离底部的距离照旧（不被一下子拉回最底下）
        var scR = P.screen, folR = P.following(), fbR = scR.scrollHeight - scR.scrollTop;
        P.renderNow();
        if (folR) P.toBottom(); else if (!anchored) { scR.scrollTop = Math.max(0, scR.scrollHeight - fbR); P.onScroll(true); }
        fillN = 0; fill();
      }
      else if (type === "prepend") { // 前面接上了更早的：看着的那段不动（重画时以眼前那一问为锚，见 V.render）；没对上锚的照旧按高度差挪
        var sc = P.screen, h0 = sc.scrollHeight, t0 = sc.scrollTop; P.renderNow();
        if (!anchored) sc.scrollTop = t0 + (sc.scrollHeight - h0);
        P.onScroll(); fill();
      }
      else if (type === "tick") tick();
      else if (type === "edit" && data) editAgain(data); // 打断时这一问它还没回：同 Claude Code，这句退回输入框改
      else if (type === "status" || type === "state") {
        var wk = !!rt.stream;
        // 忙 ↔ 闲：刚才按「在跑」画的那一问重画成做完的样子（整段文字、做完那一行）；做完那一行在对话最后 ↔ 输入框下面
        if (wk !== wasWorking) {
          wasWorking = wk; var lvt = liveT, ldt = lastDone(); if (!wk && lvt && blocks.has(lvt)) { liveT = null; drawTurn(lvt); } if (ldt && ldt !== lvt && blocks.has(ldt)) drawTurn(ldt);
          var tsw = rt.session().turns, rcT = ldt ? tsw[tsw.indexOf(ldt) + 1] : null; if (rcT && rcT.recap !== undefined && blocks.has(rcT)) drawTurn(rcT); // 跟在它后面的回顾（做完那一行在回顾上面 ↔ 输入框下面）
        }
        renderStatus(); renderInput(); if (P.win.syncTitlesSoon) P.win.syncTitlesSoon(); else P.win.syncTitles();
        ccWatch();
      }
      else if (type === "tasks") { renderStatus(); if (panel && panel.kind === "tasks") renderInput(); if (rt.stream) drawTurn(rt.stream.turn); }
      else if (type === "config") { renderInput(); if (bannerEl) bannerEl.innerHTML = P.rowsHtml(banner()); }
    });
    setTimeout(function () { if (!P.closed) ccWatch(); }, 1200); // 打开时它已经在等（面板开着）：也看一眼
    var onNeeds = function () { if (!P.closed) renderInput(); };
    document.addEventListener("vs-needs", onNeeds);
    var off2 = A.on(function (type) {
      if (P.closed) return;
      if (type === "me" || type === "cfg") P.renderLater();
      if (type === "agents" && panel && panel.kind === "agents") renderInput();
    });
    // 离开一阵再回到这个 agent（页面回到前台、窗口拿到焦点、刚打开它）：回顾一句（够不够久、最后一条是不是已经是回顾，agents.js 判断）
    var onBack = function () { if (!P.closed && !P.off && document.visibilityState === "visible" && P.el && P.el.offsetParent) rt.maybeRecap(); };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    setTimeout(onBack, 1500);
    // 会话记录只读了后面一段（Claude Code 的大会话）：滚到顶自动往前接着读，看的是历史上的一段时滚到底往后接着读——同终端的回滚，不出提示
    var fillN = 0;
    function fill() { // 读进来的不够一屏（筛过的视图、很短的一段）：再往前读一点，最多几次
      if (!rt.more || !rt.more() || (P.side && P.compact) || fillN >= 4) return;
      setTimeout(function () { var sc = P.screen; if (P.program === V && !P.off && sc.clientHeight && sc.scrollHeight <= sc.clientHeight + P.rowH * 10) { fillN++; rt.earlier(); } }, 60);
    }
    // 往前读一段没成（正在重读、上一段还没读回来）：以前就这么算了——已经在最顶上、再往上滚也没有 scroll 事件，更早的永远出不来（「往上拉不动」）。
    //   没成就过一会儿再试（还在顶上附近才试，最多 20 次）；在最顶上接着往上滚（滚轮、手指）也再要一次
    var earlierT = 0, earlierN = 0;
    function wantEarlier() {
      clearTimeout(earlierT);
      if (P.program !== V || P.closed || !rt.earlier || !rt.more || !rt.more() || P.screen.scrollTop >= P.rowH * 30) { earlierN = 0; return; }
      Promise.resolve(rt.earlier()).then(function (ok) {
        if (ok) { earlierN = 0; return; }
        if (++earlierN <= 20) earlierT = setTimeout(wantEarlier, 600);
      });
    }
    var onSc = function () {
      if (P.program !== V || !rt.earlier) return;
      var sc = P.screen;
      if (sc.scrollTop < P.rowH * 30 && rt.more()) wantEarlier();
      else if (rt.historical && rt.historical() && sc.scrollHeight - sc.scrollTop - sc.clientHeight < P.rowH * 30) rt.later();
    };
    P.screen.addEventListener("scroll", onSc, { passive: true });
    var onTopPull = function (e) { if (P.program === V && P.screen.scrollTop < P.rowH * 2 && (e.type !== "wheel" || e.deltaY < 0)) { earlierN = 0; wantEarlier(); } };
    P.screen.addEventListener("wheel", onTopPull, { passive: true });
    P.screen.addEventListener("touchmove", onTopPull, { passive: true });
    // ---- 往上翻的时候，最上面一行是现在看的这段属于哪一问（同 Claude Code 全屏时的 sticky prompt）：「❯ 那一问」，只占一行，点了跳到那一问；
    //   在最底下（跟着最新的）不显示。找法同它：最后一个整行已经翻到上面去的「❯ 你说的话」。设置 › 高级 里能关（默认开）
    //   画法同对话里那一行「❯ 你说的话」（同一套格子、同样的灰底），字是淡的
    var stw = document.createElement("div"), stk = document.createElement("pre"), stkTurn = null, stkRaf = 0, stkKey = "";
    stw.className = "vs-stickyw"; stk.className = "term terminal-style-ui vs-sticky"; stk.hidden = true; stw.appendChild(stk); P.screen.insertBefore(stw, P.screen.firstChild);
    var stickyOn = function () { return !A.cfg || A.cfg.stickyPrompt !== false; };
    function stickyHide() { if (!stk.hidden) stk.hidden = true; stkTurn = null; }
    function stickyNow() {
      stkRaf = 0;
      var sc0 = P.screen, atBottom = sc0.scrollHeight - sc0.scrollTop - sc0.clientHeight < (P.rowH || 16) * 1.5; // 回到最底下（跟着最新的）：不挂（同 Claude Code）——自己量，不只看 following（有的路回到底时它没跟上）
      if (P.program !== V || P.footOnly || P.off || !stickyOn() || P.following() || atBottom) return stickyHide();
      if (sc0.scrollTop < (P.rowH || 16) * 1.5) return stickyHide(); // 最上面（第一问上面没有别的了）：不挂（同 Claude Code：第一条之上没有东西）
      var sc = P.screen, top = sc.getBoundingClientRect().top, ts = rt.session().turns, lo = 0, hi = ts.length - 1, at = -1, rh = P.rowH || 16; // 最上面那一行被这一条盖着：算到它下沿（盖住的也算翻上去了）
      var topOf = function (i) { var b = blocks.get(ts[i]); return b && b.isConnected ? b.getBoundingClientRect().top : null; };
      while (lo <= hi) { var mid = (lo + hi) >> 1, tm = topOf(mid); if (tm === null) { var j = mid; while (j <= hi && topOf(j) === null) j++; if (j > hi) { hi = mid - 1; continue; } mid = j; tm = topOf(mid); } if (tm <= top + rh + 1) { at = mid; lo = mid + 1; } else hi = mid - 1; } // 最后一个开头已经在顶上（或上面）的那一问
      // 下一问紧接在最上面（顶上这一段只剩一两行、下一句「❯ 原话」就在眼前）：不挂——不然最上面两行一样（同一句话出现两次）
      for (var k2 = at + 1, nAsk = null; k2 < ts.length && k2 <= at + 40 && !nAsk; k2++) { var t2 = ts[k2], b2 = t2 && t2.ask !== undefined && !t2.system ? blocks.get(t2) : null; nAsk = b2 && b2.isConnected ? b2.querySelector(".ask") : null; }
      if (nAsk && nAsk.getBoundingClientRect().top < top + (P.rowH || 16) * 2.5) return stickyHide();
      // 只挂最上面看着的这一段所属的那一问；那一问自己（「❯ 原话」那几行）还在眼前（比如点了它跳过去之后，它就在最上面）就不挂——不盖住它
      for (var k = at; k >= 0 && k > at - 60; k--) {
        var t = ts[k];
        if (!t || t.recap !== undefined || t.compact || t.system || t.cmd !== undefined || t.bash !== undefined) continue;
        if (t.ask === undefined) continue; // 接在上一问后面的那一段（没有自己的话）：往前找它属于的那一问
        var b = blocks.get(t), a = b && b.querySelector(".ask");
        if (!a) break;
        var ar = a.getBoundingClientRect();
        if (ar.bottom > top + rh * 1.2) break; // 这一问的话在这一条下面还看得见：不挂（被这一条盖住、翻上去了才挂它——挂的就是现在这一问）
        if (ar.top >= top - 1) break; // 这一问正好在最上面（点了这一条跳过去之后就是这样）：两行重合，显示它本来的样子（白字），不拿淡的这一条盖着
        var line = String(t.ask || "").replace(/\[Image #(\d+): "[^"\n]+"\]/g, "[Image #$1]").replace(/\s+/g, " ").trim(), sk = line + "|" + P.cols + "|" + P.DIM;
        if (stkTurn !== t || stkKey !== sk) {
          stkTurn = t; stkKey = sk;
          stk.style.setProperty("--ttu-font-size", P.term.style.getPropertyValue("--ttu-font-size") || getComputedStyle(P.term).getPropertyValue("--ttu-font-size"));
          // 底色：往外找第一层真有颜色的（对话区自己是透明的）——不然下面的字透上来，两行叠在一起
          for (var bgEl = P.screen, bgc = ""; bgEl && bgEl.nodeType === 1; bgEl = bgEl.parentNode) { var c0 = getComputedStyle(bgEl).backgroundColor; if (c0 && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(c0)) { bgc = c0; break; } }
          stk.style.background = bgc || (P.light ? "#fff" : "#000");
          stk.innerHTML = '<span class="ask">' + P.toHtml([pad(P.DIM + "❯ " + clip(line, Math.max(8, P.cols - 3)) + RESET, P.cols)]) + "</span>";
        }
        if (stk.hidden) stk.hidden = false;
        return;
      }
      stickyHide();
    }
    var stickySoon = function () { if (!stkRaf) stkRaf = requestAnimationFrame(stickyNow); };
    P.screen.addEventListener("scroll", stickySoon, { passive: true });
    new ResizeObserver(stickySoon).observe(P.term); // 内容长了 / 换了（跟着往下滚到底时不一定有 scroll 事件）：也再看一次
    // 点了跳到那一问。按下就跳，不等松开：按下时这一格被点成当前的、重画一下，松开时指着的已经不是这一条，click 就丢了。
    //   那一问离得远时它那一块是「不画」的（content-visibility: hidden，见 P.block）：里面的行量不出位置（WebKit 里是 0，只挪一点点，看着就是点不动）——
    //   先让它画出来再量；前后的块跟着画出来、高度和记住的不一样会把它挤开：接下来几帧再对一次
    function stickyGo() {
      var t = stkTurn, b = t && blocks.get(t);
      if (!b || !b.isConnected) return;
      b.classList.remove("cvfar"); void b.offsetHeight;
      var a = b.querySelector(".ask"), sc = P.screen;
      if (!a) return;
      var fix = function () { var d = a.getBoundingClientRect().top - sc.getBoundingClientRect().top; if (Math.abs(d) >= 1) sc.scrollTop += d; P.onScroll(true); };
      fix();
      var n = 0;
      (function again() { requestAnimationFrame(function () { if (P.program !== V || !a.isConnected) return; fix(); if (++n < 3) again(); else stickySoon(); }); })();
      stickySoon();
    }
    stk.addEventListener("mousedown", function (e) { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); stickyGo(); });
    stk.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); });
    V.detach = function () { ccTuiDrop(""); clearTimeout(ccWaitT); if (sashRO) { sashRO.disconnect(); sashRO = null; } if (fsash) { fsash.remove(); fsash = null; P.foot.style.height = ""; P.foot.style.paddingLeft = ""; P.el.classList.remove("fh-set", "agentfoot"); P.foot.querySelectorAll(":scope > .st-fmore").forEach(function (x) { x.remove(); }); if (P.foot._footItems === footItems) P.foot._footItems = null; } off1(); off2(); document.removeEventListener("vs-needs", onNeeds); P.screen.removeEventListener("scroll", onSc); P.screen.removeEventListener("wheel", onTopPull); P.screen.removeEventListener("touchmove", onTopPull); clearTimeout(earlierT); document.removeEventListener("visibilitychange", onBack); window.removeEventListener("focus", onBack); if (window.STUDIO) STUDIO.clear(P, "paimon"); if (P.el.classList.contains("ts-show") || P.el.classList.contains("ts-hover")) { P.el.classList.remove("ts-show", "ts-hover"); if (P.measure) P.measure(); } };
    // 跳到某一问（搜索结果）：滚过去，闪一下
    // 跳到一问（搜索里点的那一处）：给了找到的字就在这一问里找到第 nth 处、滚到它在屏幕上三分之一的地方、亮一下（不是只跳到这一问开头——一问很长时差好几屏）；
    //   折行、行首的缩进不算（照字连起来找），不分大小写；这一问里没画出来（收着的工具输出里）就退回到这一问开头
    V.reveal = function (turn, needle, nth, ctx) {
      if (!blocks.get(turn) && pendTurns) flushTurns(); // 要跳去的还没补画：先全补上
      var b = blocks.get(turn);
      if (!b) return false;
      var rg = needle ? findIn(b, String(needle), nth || 1, ctx) : null;
      if (rg) {
        var rc = rg.getBoundingClientRect(), sc = P.screen.getBoundingClientRect();
        P.screen.scrollTop = Math.max(0, P.screen.scrollTop + (rc.top - sc.top) - P.screen.clientHeight / 3);
        P.onScroll(true);
        markFound(rg);
        return true;
      }
      P.screen.scrollTop = Math.max(0, b.offsetTop - P.screen.clientHeight / 3);
      P.onScroll(true);
      b.classList.remove("st-flash"); void b.offsetWidth; b.classList.add("st-flash");
      return true;
    };
    // 先按搜索结果那一行的上下文认（同一个词在一问里出现好几次时认得出是哪一处）；认不出按这一问里第 nth 处，再不行第一处。
    //   比的时候空白、Markdown 记号（` * _ ~）都不算：画出来的字没有这些
    function findIn(root, needle, nth, ctx) {
      var norm = function (t) { return String(t || "").replace(/[\s`*_~]+/g, "").toLowerCase(); }, want = norm(needle);
      if (!want) return null;
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), chars = [], txt = "";
      while (w.nextNode()) { var n = w.currentNode, v = n.nodeValue; for (var i = 0; i < v.length; i++) { if (/[\s`*_~]/.test(v[i])) continue; chars.push([n, i]); txt += v[i].toLowerCase(); } }
      var at = -1, cx = norm(String(ctx || "").replace(/^…|…$/g, ""));
      if (cx && cx.indexOf(want) >= 0) { var ci = txt.indexOf(cx); if (ci < 0 && cx.length > 24) ci = txt.indexOf(cx.slice(0, Math.max(want.length + 8, Math.floor(cx.length / 2)))); if (ci >= 0) { var wi = txt.indexOf(want, ci); if (wi >= 0 && wi - ci <= cx.length) at = wi; } }
      if (at < 0) { var k = 0; do { at = txt.indexOf(want, at + 1); if (at >= 0) k++; } while (at >= 0 && k < nth); }
      if (at < 0) { at = txt.indexOf(want); if (at < 0) return null; } // 第 nth 处没画出来：用这一问里画出来的第一处
      var a = chars[at], z = chars[at + want.length - 1], r = document.createRange();
      r.setStart(a[0], a[1]); r.setEnd(z[0], z[1] + 1);
      return r;
    }
    // 找到的那几个字亮一下（同 VS Code 跳到搜索结果）：盖一层浅黄的底，3 秒后淡掉
    function markFound(rg) {
      (P.el.querySelectorAll(".st-found") || []).forEach(function (x) { x.remove(); });
      var host = P.screen, hr = host.getBoundingClientRect();
      Array.prototype.forEach.call(rg.getClientRects(), function (r) {
        var d = document.createElement("div");
        d.className = "st-found";
        d.style.cssText = "position:absolute;pointer-events:none;z-index:3;left:" + (r.left - hr.left + host.scrollLeft) + "px;top:" + (r.top - hr.top + host.scrollTop) + "px;width:" + r.width + "px;height:" + r.height + "px";
        host.appendChild(d);
        setTimeout(function () { d.classList.add("off"); setTimeout(function () { d.remove(); }, 600); }, 3000);
      });
    }
    var tickN = 0, lastCtx = -1;
    function tick() {
      tickN++;
      renderStatus();
      if (rt.session().ctx !== lastCtx && !panel) { lastCtx = rt.session().ctx; renderInput(); }
      // 在跑的工具（Running 1 shell command · 5s…）每秒刷新一次时间
      if (tickN % 8 === 0 && rt.stream && rt.stream.turn.parts.some(function (p) { return p.status === "running"; })) drawTurn(rt.stream.turn);
      if (tickN % 8 === 0 && panel && (panel.kind === "tasks" || panel.kind === "agents")) renderInput();
    }

    // ---- 画 ----
    // 时间戳的样子放在这一块上（悬停时显示 / 始终显示：右边让出一列，列数变了要重新量宽度）
    function tsPane() {
      var m = tsModeOf(P.view), show = m === "show";
      P.el.classList.toggle("ts-hover", m === "hover");
      P.el.style.setProperty("--tsw", enLang() ? 9 : 6);
      if (P.el.classList.contains("ts-show") !== show) { P.el.classList.toggle("ts-show", show); if (P.measure) P.measure(); }
    }
    // 整段重画（换了宽度：拆分、挪标签页、合并……；换了筛选）：贴着底看的时候，先画最后几问（够三屏，马上就看得到），
    //   更早的在后面分几次补上（一次十来毫秒，插在最前面；贴着底的还贴着底，往上翻着看的那段不动）——几千块的大会话一次整段画完要一两秒，拆分、挪标签页时卡住
    var renderGen = 0, pendTurns = null, firstBlk = null;
    function placeTurn(t, ref) { var h = htmlOf(t, liveOf(t)), b = P.block(h, ref); b._n = htmlN; blocks.set(t, b); markOpened(b); return b; }
    // 一问画成的那一段：宽度、字宽、深浅、筛选、设置、后台任务、这一问自己（有变就 drawTurn 升一版）、它的译文到了几段都没变——直接用上次画的；
    //   拆分、挪标签页、合并时宽度来回变，变回来过的那个宽度不用再算一遍（几千行的一问算一遍要几十上百毫秒）。在跑的那一问、还有在跑的工具的不留
    var rowCache = new Map(), rcSig = "", htmlN = 0, idxOf = null;
    function rcGlobal() { var tk = rt.tasks || []; return [P.cols, P.chPx, P.light ? 1 : 0, verbose ? 1 : 0, enLang() ? 1 : 0, JSON.stringify(P.view || null), JSON.stringify(cfg), tk.length + ":" + tk.filter(function (x) { return x.status === "running"; }).length].join("|"); }
    function trN(t) { // 这一问的话里已经有译文的有几段（回复翻译开着时；译文到了，这一问要重画）
      if (!window.TSU_TRANSLATE || !TSU_TRANSLATE.reply || !cfg.translateReplies || cfg.translateReplies === "off") return 0;
      var n = 0; (t.parts || []).forEach(function (x) { if (x.kind === "text" && x.text && TSU_TRANSLATE.reply(x.text, agentId)) n++; });
      if (t.compact && t.compact.summary && (verbose || open[rt.session().turns.indexOf(t) + ":c"]) && TSU_TRANSLATE.reply(t.compact.summary, agentId)) n++; // 展开着的压缩摘要：译文到了也要重画
      if (t.recap && TSU_TRANSLATE.reply(t.recap, agentId)) n++; // 回顾的译文到了：重画
      return n;
    }
    function htmlOf(t, live, fresh) {
      var run = !live && (t.parts || []).some(function (x) { return x.status === "running"; });
      var ts0 = rt.session().turns, ix = idxOf && idxOf.has(t) ? idxOf.get(t) : ts0.indexOf(t), nx = ts0[ix + 1];
      // 这一问在第几个（点开 / 收起按它找到是哪一问；前面接上更早的记录时都往后挪）、后面紧跟的是不是回顾（做完那一行挪不挪）也算
      var k = rcSig + "|" + (t.__rv || 0) + "|" + trN(t) + "|" + ix + (nx && nx.recap !== undefined ? "r" : "") + (footDone(t) ? "f" : "") + (t.recap !== undefined && footDone(ts0[ix - 1]) ? "p" : ""), c = rowCache.get(t);
      if (!fresh && !live && !run && c && c.k === k) { htmlN = c.n; return c.h; }
      var rows = turnRows(t, live), h = P.join(rows);
      htmlN = rows.length;
      if (!live && !run) rowCache.set(t, { k: k, h: h, n: rows.length }); else rowCache.delete(t);
      return h;
    }
    // 译文到了：只重画译文有变化的那几问（不再整段重画——几千行的会话每来一批译文就卡一下）
    V.retranslate = function () {
      if (P.closed || P.footOnly) return;
      blocks.forEach(function (b, t) { var c = rowCache.get(t); if (c && c.k.split("|").slice(-2, -1)[0] !== String(trN(t))) drawTurn(t); }); // 译文有变化的那几问（键里倒数第二段是译文段数）
    };
    function restTurns(gen) {
      if (gen !== renderGen || P.closed || P.program !== V || !pendTurns) return;
      if (!pendTurns.length) { pendTurns = null; return; }
      var sc = P.screen, h0 = sc.scrollHeight, top0 = sc.scrollTop, fol = P.following(), t0 = performance.now();
      while (pendTurns.length && performance.now() - t0 < 12) { var t = pendTurns.pop(); if (!blocks.has(t) && firstBlk && firstBlk.parentNode === P.out) firstBlk = placeTurn(t, firstBlk); }
      var dh = sc.scrollHeight - h0;
      if (fol) P.stick(); else if (dh) { sc.scrollTop = top0 + dh; if (P.onScroll) P.onScroll(); }
      if (pendTurns.length) setTimeout(function () { restTurns(gen); }, 0); else pendTurns = null;
    }
    V.flushTurns = function () { flushTurns(); }; // 要整段都在的时候（导出、测试）：没补画的马上全补上
    function flushTurns() {
      var g = renderGen;
      while (pendTurns && pendTurns.length && g === renderGen) { var t = pendTurns.pop(); if (!blocks.has(t) && firstBlk && firstBlk.parentNode === P.out) firstBlk = placeTurn(t, firstBlk); }
      pendTurns = null;
      while (pendTail && pendTail.length && g === renderGen) { var t2 = pendTail.shift(); if (!blocks.has(t2)) placeTurn(t2, statusEl); }
      pendTail = null;
    }
    // ---- 不在底部（往上翻着看）时整段重画：以前一口气把几百上千问全画出来——600 问要 1.6 秒，整个 App 卡住（往上接更早的、重读、改设置时都会）。
    //   现在以眼前的那一问为锚：它、它上面够填满到屏幕顶的几问、它下面三屏马上画，放回原来在屏幕上的位置；
    //   更早的分段补在上面（补上时滚动位置跟着挪，眼前的不动），更晚的分段接在下面
    var pendTail = null, anchored = false;
    function anchorNow() {
      var sc = P.screen, top = sc.getBoundingClientRect().top, best = null, cover = null;
      blocks.forEach(function (b, t) {
        if (!b.isConnected) return;
        var y = b.getBoundingClientRect().top - top;
        if (y >= 0 && (!best || y < best.off)) best = { turn: t, off: y }; // 上沿在对话区里、最靠上的那一问
        if (y < 0 && (!cover || y > cover.off)) cover = { turn: t, off: y }; // 顶上盖着的那一问（一问比一屏还长时用它）
      });
      return [best, cover];
    }
    function restTail(gen) {
      if (gen !== renderGen || P.closed || P.program !== V || !pendTail) return;
      var t0 = performance.now();
      while (pendTail.length && performance.now() - t0 < 12) { var t = pendTail.shift(); if (!blocks.has(t)) placeTurn(t, statusEl); }
      if (pendTail.length) setTimeout(function () { restTail(gen); }, 0); else pendTail = null;
    }
    V.render = function () {
      tsPane();
      var anch = !P.footOnly && !P.following() && P.screen.clientHeight && blocks.size ? anchorNow() : null; // 清掉之前量好眼前是哪一问
      P.out.innerHTML = '<span class="blk status"></span>';
      statusEl = P.out.querySelector(".status");
      blocks = new Map();
      rcSig = rcGlobal();
      idxOf = new Map(); rt.session().turns.forEach(function (t, i) { idxOf.set(t, i); });
      var gen = ++renderGen; pendTurns = null; pendTail = null; firstBlk = null; anchored = false;
      if (!P.footOnly) { // 面板里那份（agent 的底部）：对话一条都不画——跑着的工具、上一轮的输出、压缩的分隔线都不画；只有在跑的那一行、输入框、状态信息
        bannerEl = P.block(P.rowsHtml(banner()), statusEl);
        var ts = rt.session().turns, ai = -1, aoff = 0;
        if (anch) anch.some(function (a) { var k = a ? ts.indexOf(a.turn) : -1; if (k < 0) return false; ai = k; aoff = a.off; return true; });
        if (ts.length >= 24 && !P.following() && ai >= 0) {
          var sc = P.screen, rows = Math.ceil(sc.clientHeight / (P.rowH || 16)), got = 0, j = ai;
          for (; j < ts.length; j++) { var bj = placeTurn(ts[j], statusEl); got += bj._n || 1; if (got >= rows * 3 && j - ai >= 2) { j++; break; } }
          var ab = firstBlk = blocks.get(ts[ai]), top0 = P.out.getBoundingClientRect().top;
          var above = function () { return ab.getBoundingClientRect().top - top0; }; // 锚上面已经有多高
          var h = ai - 1;
          for (; h >= 0 && above() < aoff + (P.rowH || 16) * 2; h--) firstBlk = placeTurn(ts[h], firstBlk); // 锚上面先补够一屏顶上的那一截（不然锚贴不回原来的位置）
          sc.scrollTop += (ab.getBoundingClientRect().top - sc.getBoundingClientRect().top) - aoff;
          if (h >= 0) { pendTurns = ts.slice(0, h + 1); setTimeout(function () { restTurns(gen); }, 0); }
          if (j < ts.length) { pendTail = ts.slice(j); setTimeout(function () { restTail(gen); }, 0); }
          anchored = true;
        }
        else if (ts.length < 24 || !P.following() || !P.screen.clientHeight) ts.forEach(function (t) { appendTurn(t, true); });
        else {
          var need = Math.ceil(P.screen.clientHeight / (P.rowH || 16)) * 3, got = 0, i = ts.length - 1;
          firstBlk = statusEl;
          for (; i >= 0; i--) { firstBlk = placeTurn(ts[i], firstBlk); got += firstBlk._n || 1; if (got >= need && ts.length - i >= 3) { i--; break; } }
          if (i >= 0) { pendTurns = ts.slice(0, i + 1); setTimeout(function () { restTurns(gen); }, 0); }
        }
      }
      renderStatus();
      renderInput();
    };
    // 画成「在跑」的那一问：换到新的一问（一轮中间读进去一句话，后面的接在新的一问里）时，它重画一遍——
    //   不然它最后那组命令一直是「● 说明 · 31s」一闪一闪，和真在跑的那组两个一起闪（同 Claude Code：前面那组变成 Ran 2 shell commands）
    var liveT = null;
    function liveOf(t) { var lv = !!(rt.stream && rt.stream.turn === t); if (lv) liveT = t; return lv; }
    function appendTurn(t, quiet) {
      if (P.footOnly) return;
      if (blocks.has(t)) return drawTurn(t);
      if (pendTurns && pendTurns.indexOf(t) >= 0) return; // 还没轮到补画的更早的一问：补画时画在它自己的位置
      if (pendTail) { if (pendTail.indexOf(t) < 0) pendTail.push(t); return; } // 后面的还在分段补画：新来的排在它们后面（不插到中间去）
      var was0 = liveT, b = P.block(htmlOf(t, liveOf(t)), statusEl);
      blocks.set(t, b);
      var ts1 = rt.session().turns, pv1 = ts1[ts1.indexOf(t) - 1]; // 前一问做完那一行原来在输入框下面（它曾是最后一问）：现在回到对话里它自己的位置
      if (pv1 && pv1 !== was0 && pv1.stats && blocks.has(pv1)) drawTurn(pv1);
      if (was0 && was0 !== t && blocks.has(was0) && !(rt.stream && rt.stream.turn === was0)) { if (liveT === was0) liveT = null; drawTurn(was0); }
      markOpened(b);
      if (t.recap !== undefined) { var ts0 = rt.session().turns, pv0 = ts0[ts0.indexOf(t) - 1]; if (pv0 && blocks.has(pv0)) drawTurn(pv0); } // 上一问做完那一行挪到 recap 下面：上一问重画一遍（去掉它那一行）
      if (!quiet && !P.following()) P.unread++;
    }
    // 重画一问：只换真的变了的那几个节点（在跑的工具每秒刷新用时，整块 innerHTML 一换，鼠标指着的那一行的高亮每秒闪一下、选中的字也丢了）
    var sameAttrs = function (x, y) { if (x.attributes.length !== y.attributes.length) return false; for (var i = 0; i < x.attributes.length; i++) { var a = x.attributes[i]; if (y.getAttribute(a.name) !== a.value) return false; } return true; };
    function patchNodes(el, src) {
      var an = Array.prototype.slice.call(el.childNodes), bn = Array.prototype.slice.call(src.childNodes);
      for (var k = 0; k < bn.length; k++) {
        var x = an[k], y = bn[k];
        if (!x) { el.appendChild(y); continue; }
        if (x.nodeType === 3 && y.nodeType === 3) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; }
        if (x.nodeType === 1 && y.nodeType === 1 && x.tagName === y.tagName && sameAttrs(x, y)) { if (x.innerHTML !== y.innerHTML) patchNodes(x, y); continue; }
        el.replaceChild(y, x);
      }
      for (var r = an.length - 1; r >= bn.length; r--) el.removeChild(an[r]);
    }
    function setBlockHtml(b, h) {
      if (!b.firstChild) { b.innerHTML = h; return; }
      var tmp = b.cloneNode(false); tmp.innerHTML = h;
      patchNodes(b, tmp);
    }
    function drawTurn(t) {
      if (P.footOnly) return;
      var b = blocks.get(t);
      if (!b) return appendTurn(t);
      var was1 = liveT;
      t.__rv = (t.__rv || 0) + 1; // 这一问变了：各处的缓存都作废
      setBlockHtml(b, htmlOf(t, liveOf(t), true));
      markOpened(b);
      if (was1 && was1 !== t && blocks.has(was1) && !(rt.stream && rt.stream.turn === was1)) { if (liveT === was1) liveT = null; drawTurn(was1); }
    }
    // 你点开的（不是按设置本来就展开的）：整块灰底包起来（同你说的话那种灰），块里任何地方再点一下就收起——很长的内容不用回去找标题
    function markOpened(b) { if (b && b.querySelectorAll) b.querySelectorAll(".grp.open:not(.trsw)").forEach(function (g) { g.classList.toggle("uopen", open[g.dataset.key] === true); }); }
    function box(lines, width, color) {
      var r = [color + "╭" + "─".repeat(width - 2) + "╮" + RESET];
      lines.forEach(function (l) { r.push(color + "│" + RESET + " " + pad(l, width - 4) + " " + color + "│" + RESET); });
      r.push(color + "╰" + "─".repeat(width - 2) + "╯" + RESET);
      return r;
    }
    // 开头不画框、不堆信息（名字在输入框上面那条线上，模型、目录在 /status）；只有没登录、没被邀请时说一句
    function banner() {
      var me = A.me(), D = P.DIM;
      if (!me || (me.loggedIn && me.allowed)) return [];
      if (!me.loggedIn) return ["", "  " + link(location.origin + "/auth/login", ORANGE + uiT("使用 GitHub 登录") + RESET) + D + uiT("（或按 Enter）· 仅限受邀账号，按实际用量从账户余额扣费") + RESET];
      return ["", "  " + D + uiT("已登录为 " + me.login + "，但此账号尚未获得邀请 · ") + RESET + link(location.origin + "/auth/logout", D + uiT("退出登录") + RESET)];
    }
    function answer(md) {
      var dot = P.light ? rgb("85;85;85") + DOT + RESET : DOT;
      return trim(mdLines(md, { width: P.cols - 2, theme: P.theme })).map(function (l, i) { return (i ? "  " : dot + " ") + l; });
    }
    // 流式中只排写完了的行；开头的围栏、表格分隔行不单独出（免得冒出空代码块、空表格）
    function settled(text) {
      var lines = text.slice(0, text.lastIndexOf("\n") + 1).split("\n");
      lines.pop();
      var fences = lines.filter(function (l) { return /^\s*```/.test(l); }).length;
      if (fences % 2 === 1 && lines.length && /^\s*```/.test(lines[lines.length - 1])) lines.pop();
      if (lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[lines.length - 1])) lines.pop();
      return lines.join("\n");
    }
    function askBlock(r, text, mark) {
      var ask = [];
      text.split("\n").forEach(function (para) { ask.push.apply(ask, wrap(para, P.cols - 2)); });
      r.block('<span class="ask">' + P.toHtml(ask.map(function (l, i) { return pad((i ? "  " : mark) + l, P.cols); })) + "</span>");
    }
    // 图片不直接摊在对话里（同 Claude Code）：一行「⎿  [Image #1] [Image #2]」，虚线下划线，点一下在右侧栏里看
    // 附的图：同 Claude Code 2.x，一张一行「⎿  [Image #N]」（虚线下划线的链接：悬停浮出小图、点了放大）。srcs：记录里的图对象 {media_type, data}，或 data: 地址
    //   HTML 里只放短键（data-img），不放几 MB 的 base64（见 TSU_IMG）
    function imageRefs(srcs, indent, nums) {
      return srcs.map(function (src, i) {
        var n = nums && nums[i] != null ? nums[i] : i + 1;
        if (src && src.load && !src.bytes && !src.missing) src.load(); // 存在文件里的图：先读着，悬停时就有
        return '<span class="blk st-imgrefs">' + " ".repeat(indent) + '<span class="st-dim">⎿  </span><span class="st-imgref" data-img="' + TSU_IMG.key(src) + '" data-name="Image #' + n + '">[Image #' + n + "]</span></span>";
      }).join("");
    }
    function thumbs(images) {
      var h = Math.round(P.rowH * 5);
      return '<span class="fig thumbs" style="padding-left:' + 2 * P.chPx + "px;padding-top:" + P.rowH / 3 + "px;height:" + P.rowH * 6 + 'px">' +
        images.map(function (im) { return '<img src="' + TSU_IMG.of(im) + '" style="height:' + h + 'px" alt="">'; }).join("") + "</span>";
    }
    // 一问做完那一行：「✻ Cooked for 13m 47s · done …」（没有就空）
    // foot：画在输入框下面那一行（闲着时顶替转圈那一行，同 Claude Code 结尾那行：✻ Baked for 18m 16s · done 12:07 PM · 1 shell still running）
    function doneLine(turn, foot) {
      // 对话里每问后面那行看「回合结尾」（cfg.footer）选了哪几项，一项没选就不画；闲着时输入框下面那行（foot）一直有：至少「用了多久 · done 几点」
      //   （同 Claude Code 闲着时的「✻ Baked for 2h 19m · done 9:02 AM」——以前 footer 一项没选，闲着时下面就空着，看不出是闲着）
      if (!turn || !turn.stats || !vmode("doneLine") || (!foot && !(cfg.footer || []).length)) return "";
      var st = turn.stats, bits = [], ft = (cfg.footer || []).slice(), D = P.DIM;
      if (foot && ft.indexOf("duration") < 0) ft.unshift("duration");
      if (foot && ft.indexOf("time") < 0) ft.push("time");
      ft.forEach(function (f) {
        if (f === "duration") bits.push((st.verb || "Worked") + " for " + F.dur(st.secs * 1000));
        if (f === "tokens" && (st.in || st.out)) bits.push("↑ " + F.k(st.in) + " ↓ " + F.k(st.out) + " tokens");
        if (f === "cost" && st.cost) bits.push("≈" + F.money(st.cost));
      });
      // 「done 3:04 PM」就是「完成时间」这一项：关了就整段不显示（不单留一个 done）；不写「还有 n 个后台任务在跑」（右侧栏就看得到）
      if (ft.indexOf("time") >= 0) bits.push((turn.error ? "" : "done ") + timeOf(st.at));
      return bits.length ? D + "✻ " + bits.join(" · ") + RESET : "";
    }
    // 最后一问（做完了的）：闲着时它那行「✻ … for …」画在输入框下面（footDone），对话最后就不再画一遍
    //   最后一问：跳过不是「一问」的（回顾、压缩、别的会话 / 后台发来的通知、/ 命令、! 命令）——它们后面没有自己的「✻ … for …」
    // 最后一问（不管有没有「用了多久」）
    function lastAsk() { var ts = rt.session().turns; for (var i = ts.length - 1; i >= 0; i--) { var t = ts[i]; if (t.recap !== undefined || t.compact || t.system || t.cmd !== undefined || t.bash !== undefined || t.ask === undefined) continue; return t; } return null; }
    function lastDone() {
      var ts = rt.session().turns;
      for (var i = ts.length - 1; i >= 0; i--) {
        var t = ts[i];
        if (t.recap !== undefined || t.compact || t.system || t.cmd !== undefined || t.bash !== undefined || t.ask === undefined) continue;
        return t.stats ? t : null;
      }
      return null;
    }
    function footDone(t) { return !!(fsash && !rt.stream && vmode("workLine") !== "hidden" && t && t === lastDone());
    }
    function turnRows(turn, live) {
      var r = new P.Rows().text([""]), D = P.DIM, hdr = null;
      // 时间戳（设置 › 对话 › 时间戳）：每一块第一行的右边一个时间（绝对定位、字由 ::after 画：不占排版的宽度，也不会被选中、拷走）；
      // 「始终显示」时换天的地方先一条「今天」「昨天」「9月26日」
      var tsm = tsModeOf(P.view), stamps = [], tI = rt.session().turns.indexOf(turn), lastEnd = turn.at || 0;
      var mark = function (t) { if (tsm === "hide" || !t) return; var n = r.rows.length; r.pending.forEach(function (l) { n += String(l).split("\n").length; }); stamps.push([n, t]); };
      // 一块 html（灰底的问、能点开的一组）：时间放进它里面第一行；一行字：放在这一行的最前面
      // 空行只留一行（同 Claude Code：两块之间正好空一行）——什么都没画的那一块不留它前面的空行；这一问末尾的空行不要（下一问开头自己有一行）
      var blankRow = function (x) { return !!x && x.k === "t" && !x.h.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, "").trim(); };
      var done = function () {
        var rows0 = r.flush().rows;
        stamps.forEach(function (x) { var row = rows0[x[0]]; if (!row) return; row.h = row.k === "b" && /^\s*<[a-z][^>]*>/i.test(row.h) ? row.h.replace(/^(\s*<[a-z][^>]*>)/i, "$1" + tsHtml(x[1])) : tsHtml(x[1]) + row.h; });
        rows0 = rows0.filter(function (x, i) { return !(blankRow(x) && blankRow(rows0[i - 1])); });
        while (rows0.length > 1 && blankRow(rows0[rows0.length - 1])) rows0.pop();
        return rows0;
      };
      if (tsm === "show") {
        var tt0 = turnTime(turn), prevT = 0;
        for (var pj = tI - 1; pj >= 0 && !prevT; pj--) prevT = turnTime(rt.session().turns[pj]);
        if (tt0 && (!prevT || dayKey(prevT) !== dayKey(tt0))) { var lab = " " + dayLabel(tt0) + " ", side0 = Math.max(2, Math.floor((P.cols - W(lab)) / 2)); r.text([D + "─".repeat(side0) + lab + "─".repeat(Math.max(2, P.cols - side0 - W(lab))) + RESET, ""]); }
      }
      if (turn.compact) { // 连接器那边压缩了上下文（Claude Code、Codex）：同 Claude Code 2.1.281 那一行（淡的「∷ Compacted · 968.1k tokens summarized」），
        //   加上压缩后剩多少（记录里的 postTokens）；点它（或 ctrl+o）看它写的摘要——不是用户说的话
        var cti = rt.session().turns.indexOf(turn), ck = cti + ":c", co = verbose || open[ck], en0 = enLang(), cp0 = turn.compact, ksz = function (n) { return F.k(n) + " tokens"; };
        var cdet = en0 ? (cp0.pre && cp0.post ? ksz(cp0.pre) + " summarized to " + F.k(cp0.post) : cp0.pre ? ksz(cp0.pre) + " summarized" : cp0.msgs ? F.plural(cp0.msgs, "message") + " summarized" : "") + (cp0.summary ? " (ctrl+o to see summary)" : "")
          : (cp0.pre && cp0.post ? ksz(cp0.pre) + " 压缩到 " + F.k(cp0.post) : cp0.pre ? "压缩了 " + ksz(cp0.pre) : cp0.msgs ? "压缩了 " + cp0.msgs + " 条消息" : "") + (cp0.summary ? "（ctrl+o 查看摘要）" : "");
        r.text([""]);
        r.block('<span class="grp' + (co ? " open" : "") + '" data-key="' + ck + '">' + hotHtml([D + (en0 ? ITALIC : "") + "∷ " + HOT + (en0 ? "Compacted" : "已压缩") + (cdet ? " · " + cdet : "") + HOT_END + RESET]) + "</span>");
        // 摘要正文按 Markdown 原样的颜色画（不整体套灰：行里的代码、列表记号会把灰色重置掉，一行灰一行黑、半行灰半行黑）
        //   回复翻译开着时摘要也翻：同回复的译文——点摘要正文换成原文（浅色底），再点换回；点上面那条分隔线才是收起（两个地方，不打架，也不要按钮）
        if (co && turn.compact.summary) {
          var sm0 = turn.compact.summary, strk = cti + ":cs", strd = window.TSU_TRANSLATE && TSU_TRANSLATE.reply ? TSU_TRANSLATE.reply(sm0, agentId) : null, sO = !!(strd && open[strk]);
          var sl = trim(mdLines(strd && !sO ? strd : sm0, { width: P.cols - 4, theme: P.theme })).map(function (l) { return "  " + l; });
          if (strd) r.block('<span class="grp trsw' + (sO ? " open" : "") + '" data-key="' + strk + '">' + hotHtml(sl) + "</span>"); else r.text(sl);
        }
        return done();
      }
      if (turn.recap !== undefined) { // 回来时的回顾（同 Claude Code）：※ recap: 在做什么、下一步是什么（灰）
        if (!vmode("recaps")) return [];
        // 同 Claude Code：上一问做完那一行（✻ … for …）在上，空一行，下面「※ recap: …」——recap: 粗体，正文淡色斜体。
        //   闲着时做完那一行画在输入框下面（footDone），这里就不再画；回复翻译开着时 recap 也翻（同回复：点一下看原文，再点换回）
        var pvT = rt.session().turns[tI - 1], dl1 = pvT && !footDone(pvT) ? doneLine(pvT) : "";
        if (dl1) r.text(["", dl1]);
        mark(turn.at);
        var rtk = tI + ":rc", rtr = window.TSU_TRANSLATE && TSU_TRANSLATE.reply ? TSU_TRANSLATE.reply(turn.recap, agentId) : null, rO = !!(rtr && open[rtk]), RH = "※ recap:";
        var rl = wrap(RH + " " + (rtr && !rO ? rtr : turn.recap), P.cols - 2).map(function (l, i) { return i ? D + ITALIC + "  " + l + RESET : D + "※ recap:" + RESET + D + ITALIC + l.slice(RH.length) + RESET; });
        r.text([""]);
        if (rtr) r.block('<span class="grp trsw' + (rO ? " open" : "") + '" data-key="' + rtk + '">' + hotHtml(rl) + "</span>"); else r.text(rl);
        return done();
      }
      if (turn.cmd !== undefined) { // 命令与它的结果（❯ /model ⎿ Set model to …）
        if (!vmode("prompts")) return [];
        mark(turn.at);
        askBlock(r, turn.cmd, "❯ ");
        // 结果：淡字（stdout）、红字（stderr）；没有结果的（空的、「(no content)」）不画 ⎿（同 Claude Code）。记下的说明：英文时按词典换（Paimon 的原样存着）
        var cmdL = (turn.note ? wrap(String(uiT(turn.note)), P.cols - 6).map(function (l) { return D + l + RESET; }) : []).concat(turn.err ? wrap(String(turn.err), P.cols - 6).map(function (l) { return RED + l + RESET; }) : []);
        cmdL.forEach(function (l, i) { r.text([(i ? "     " : "  " + D + "⎿" + RESET + "  ") + l]); });
        return done();
      }
      if (turn.bash !== undefined) {
        if (!vmode("prompts") && vmode("bashOut") === "hidden") return [];
        var cmdl = wrap(turn.bash, P.cols - 2);
        mark(turn.at);
        r.block('<span class="ask">' + P.toHtml(cmdl.map(function (l, i) { return pad((i ? "  " : PINK + "!" + RESET + " ") + l, P.cols); })) + "</span>");
        if (turn.code === null) return r.text(["  " + D + "⎿  Running…" + RESET]), done();
        var bm = vmode("bashOut"), outl = turn.out ? termLines(turn.out, P.cols - 5) : [], lim = verbose || bm === "expanded" ? outl.length : bm === "hidden" ? 0 : 12;
        if (!outl.length) r.text(["  " + D + "⎿  (No output)" + RESET]);
        else if (!lim) return r.text(["  " + D + "⎿  " + F.plural(outl.length, "line") + " of output" + RESET]), done();
        outl.slice(0, lim).forEach(function (l, i) { r.text([(i ? "     " : "  " + D + "⎿" + RESET + "  ") + (turn.code ? RED : "") + l + (turn.code ? RESET : "")]); });
        if (outl.length > lim) r.text(["     " + D + HOT + "… +" + (outl.length - lim) + " lines (ctrl+o to expand)" + HOT_END + RESET]);
        return done();
      }
      if (turn.note !== undefined) {
        if (!vmode("prompts")) return [];
        var nl = trim(mdLines(turn.note, { width: P.cols - 5, theme: P.theme }));
        mark(turn.at);
        return r.text(nl.map(function (l, i) { return (i ? "     " : "  " + D + "⎿" + RESET + "  ") + l; })), done();
      }
      if (turn.system && ((turn.goal && !vmode("prompts")) || (turn.social && !turn.goal && amode("agentIn") === "hidden"))) { /* 目标算「消息」；别的 agent 发来的按「Agent 消息 › 收到的」（它接着的回答照常画） */ }
      else if (turn.system && turn.goal) {
        var gm = /^\[goal\] (?:The goal is not met yet: ([^\n]*)|New goal set)/.exec(turn.ask);
        mark(turn.at);
        r.text([CYAN + "◎ " + RESET + D + (gm && gm[1] ? "Goal not met yet — " + gm[1] : "Working toward the goal") + RESET]);
      } else if (turn.system && turn.social && V.style !== "teyvat") {
        // Claude Code 风格（同 Claude Code 自己画的）：收着是一行淡的「› Message from @名字 (ctrl+o to expand)」；
        // 点开（或 ctrl+o）是灰底的一块：淡的「› Message from 名字」，下面缩进两格的正文（Markdown）
        var sti = rt.session().turns.indexOf(turn);
        turn.social.forEach(function (m, mi) {
          var mk = sti + ":m" + mi, mo = verbose || (mk in open ? !!open[mk] : amode("agentIn") === "full"), who = String(m.from_name || m.from || "agent"); // 完整：一开始就展开；一行：收着（点开看）
          r.text([""]);
          mark(m.ts || turn.at);
          if (!mo) { r.block('<span class="grp" data-key="' + mk + '">' + hotHtml([D + "› " + HOT + "Message from @" + who + HOT_END + " (ctrl+o to expand)" + RESET]) + "</span>"); return; }
          var body = trim(mdLines(String(m.text || "").replace(/\r/g, ""), { width: P.cols - 4, theme: P.theme }));
          r.block('<span class="grp open" data-key="' + mk + '"><span class="gdet">' + hotHtml([D + "› " + HOT + "Message from " + who + HOT_END + RESET].concat(body.map(function (l) { return "  " + l; }))) + "</span></span>");
        });
      } else if (turn.system && turn.social) {
        var sc = P.light ? SOCIAL_C.light : SOCIAL_C.dark;
        turn.social.forEach(function (m, mi) {
          if (mi) r.text([""]);
          mark(m.ts || turn.at);
          r.text([sc + "➤ " + BOLD + (m.from_name || m.from) + " [" + (m.mode_used || m.mode) + "]" + (m.ts ? " · " + hms(m.ts) : "") + RESET]);
          if (amode("agentIn") === "line" && !verbose) { var l0 = String(m.text || "").replace(/\s+/g, " ").trim(); if (l0) r.text(["    " + D + clip(l0, P.cols - 6) + RESET]); return; } // 一行：只留开头
          var ls = String(m.text || "").replace(/\r/g, "").split("\n"), gw = String(ls.length).length;
          ls.forEach(function (l, li) {
            wrap(l, P.cols - 6 - gw).forEach(function (x, xi) { r.text(["    " + D + (xi ? " ".repeat(gw) : String(li + 1).padStart(gw)) + "  " + RESET + x]); });
          });
        });
      } else if (turn.system) {
        // 后台命令跑完、叫醒：按「后台任务通知」；子 agent 跑完的：按「Agent 消息 › 子 Agent 报告」。关掉的只是这一行，它接着的回答照常画
        var nts = turn.notices || oldNotices(turn.ask), nbg = nts.filter(function (n) { return n.kind !== "agent"; }), nrp = nts.filter(function (n) { return n.kind === "agent"; });
        if (vmode("notices") && (nbg.length || !nts.length)) { mark(turn.at); if (nbg.length) noticeBlock(r, nbg, rt.session().turns.indexOf(turn) + ":n"); else r.text([D + "⎿  " + (turn.woke ? "Woke: " + turn.woke : "System") + RESET]); }
        if (nrp.length) reportRows(r, nrp, rt.session().turns.indexOf(turn) + ":r", turn.at, mark);
      } else {
        var askText = turn.ask, imgNo = null;
        // 图的编号用它自己的（[Image #419]，Claude Code 记在 imagePasteIds 里；话里已经写着的就是那几个）——不另编 #1，也不在前面重复加一个
        if (turn.images && turn.images.length) {
          var inTx = (String(askText || "").match(/\[Image #(\d+)\]/g) || []).map(function (x) { return +/\d+/.exec(x)[0]; });
          var ids0 = turn.imgIds && turn.imgIds.length ? turn.imgIds : inTx;
          imgNo = turn.images.map(function (im, i) { return ids0[i] != null ? ids0[i] : im && im.no ? im.no : i + 1; }); // 这边附的图：发的时候编好的号（[Image #N: "路径"]）
          if (!inTx.length) askText = imgNo.map(function (n) { return "[Image #" + n + "] "; }).join("") + askText;
        }
        // 不显示「消息」时，这一问还是一组：一行淡的「❯ 问的话」做组的标题（回答、出错跟在它下面，才看得出是回哪一问的）
        if (turn.cont && !String(askText || "").trim()) { /* 接着上一问的（它的问题在还没读进来的那段里）：没有问题这一行 */ }
        else if (vmode("prompts")) { mark(turn.at); askBlock(r, askText, "❯ "); }
        else hdr = D + "❯ " + clip(String(askText).replace(/\s+/g, " ").trim(), P.cols - 4) + RESET;
        if (turn.images && turn.images.length && vmode("prompts")) r.block(cfg.imageShow === "inline" ? thumbs(turn.images) : imageRefs(turn.images, 2, imgNo)); // 悬停预览（默认）/ 直接显示
      }
      var tm = vmode("thinking");
      if (turn.thought && tm !== "hidden" && V.style === "teyvat") {
        var first = (turn.thinking || "").replace(/\s+/g, " ").trim(), head = "∴ Thought for " + turn.thought + "s";
        if (tm === "collapsed" && first) head += " · " + clip(first, P.cols - W(head) - 6);
        r.text(["", D + head + RESET]);
        if (tm === "expanded" && turn.thinking) turn.thinking.trim().split("\n").forEach(function (p) { wrap(p, P.cols - 2).forEach(function (l) { r.text(["  " + D + ITALIC + l + RESET]); }); });
      }
      var parts = turn.parts || [{ kind: "text", text: turn.answer || "" }], group = [], gi = 0, ti = rt.session().turns.indexOf(turn);
      // 一次工具调用 = 调用 + 结果：每类按设置的档位画（完整 / 预览 / 只看调用 / 隐藏）；点调用那一行在「完整」和「只看调用」之间切（open 里记着，没点过就跟设置）
      var merge = vflag("mergeReads") !== false, readM = vmode("toolRead"), lastTool = -1;
      parts.forEach(function (p, i) { if (p.kind === "tool") lastTool = i; });
      var lvlOf = function (key, m) { return verbose ? "full" : key in open ? (open[key] ? "full" : "call") : m === "hidden" ? "call" : m; };
      var gIdx = []; // 并在一组里的每一条是第几块（只有一条命令的组：照常画成一条）
      // 一次工具调用：● Tool(参数) + 按档位的结果（点调用那一行在「完整」和「只看调用」之间切）
      var oneTool = function (p, i, m) {
        if (m === "hidden" && p.status !== "running") return; // 隐藏的类：跑着的时候照样露一行（看得出在做什么），跑完就不显示
        var pk = ti + ":p" + i, lvl = p.status === "running" ? "call" : lvlOf(pk, m), tr = toolRows(p, lvl);
        var attach = ccs && p.name === "SendMessage" && lvl !== "full" && !verbose; // 同 Claude Code：发消息的调用不画，结果「⎿ Message queued …」接在上一块下面（不空一行）；点它看全文
        if (!attach) r.text([""]);
        mark(p.t0);
        if (p.status === "running" || !tr.length) r.text(tr);
        else if (attach) { tr[0] = tr[0].replace(/^(\s*\S+\s+)/, "$1" + HOT) + HOT_END; r.block('<span class="grp" data-key="' + pk + '">' + hotHtml(tr) + "</span>"); }
        else if (/^\s/.test(tr[0])) r.text(tr);
        else {
          tr[0] = tr[0].replace(/^(\S+ )/, "$1" + HOT) + HOT_END; // 能点的是「Write(路径)」这几个字，不含前面的点
          r.block('<span class="grp' + (lvl === "full" ? " open" : "") + '" data-key="' + pk + '" data-def="' + String(m || "").replace(/[^\w-]/g, "") + '">' + hotHtml(tr) + "</span>");
        }
        if (p.thumb && /^data:image\//.test(p.thumb) && lvl !== "call") r.block(imageRefs([p.thumb], 5));
      };
      // Claude Code 的提问（AskUserQuestion）答完了（同 2.1.281）：空一行，「⏺ User answered Claude's questions:」，下面每题「⎿  · 问题 → 回答」（inactive 灰）；
      //   不答（Esc）的：「⏺ User declined to answer questions」，下面「· 问题 (选项 / 选项)」。问着的时候不画（问答在输入框那里）
      var askAnswered = function (p) {
        if (p.status === "running") return;
        var INACT = P.light ? rgb("102;102;102") : rgb("153;153;153"), D = P.DIM, qs = (p.input && p.input.questions) || [], lines = [], head;
        if (p.status === "error") {
          head = "User declined to answer questions";
          qs.forEach(function (q) { lines.push("· " + String(q.question || "") + " (" + (q.options || []).map(function (o) { return o.label; }).join(" / ") + ")"); });
        } else {
          var ents = p.answers ? Object.keys(p.answers).map(function (k) { return [k, String(p.answers[k])]; }) : [], has = !!p.response || ents.length > 0;
          if (!p.followUp && !has) return;
          head = p.followUp ? (has ? "User asked Claude for more questions (so far):" : "User asked Claude for more questions") : "User answered Claude's questions:";
          if (p.followUp || !p.response) ents.forEach(function (e) { lines.push("· " + e[0] + " → " + e[1]); });
          if (p.response) lines.push("· " + p.response);
        }
        r.text([""]);
        mark(p.t0);
        var out = [DOT + " " + head], first = true;
        lines.forEach(function (l) {
          l.split("\n").forEach(function (seg) {
            wrap(seg, Math.max(10, P.cols - 7)).forEach(function (w) { out.push((first ? "  " + D + "⎿" + RESET + "  " : "     ") + INACT + w + RESET); first = false; });
          });
        });
        r.text(out);
      };
      var ccs = V.style !== "teyvat", gThink = null; // gThink：并进这一组的思考（Claude Code 风格：{ ms, text }）
      // 思考（claude.js 记在后一块上的 thinkBefore、这一问最后的 turn.think）：「收起」并进当前这一组；「展开」原地画成「∴ Thinking…」和全文；隐藏：不画
      var addThink = function (list) {
        if (!ccs || !list || !list.length || tm === "hidden") return;
        if (tm === "expanded" || verbose) { flushGroup(); list.forEach(function (x) { r.text(["", D + ITALIC + "∴ Thinking…" + RESET]); String(x.text || "").trim().split("\n").forEach(function (p0) { wrap(p0, P.cols - 2).forEach(function (l) { r.text(["  " + D + ITALIC + l + RESET]); }); }); }); return; }
        gThink = gThink || { ms: 0, text: "" };
        list.forEach(function (x) { gThink.ms += x.ms || 0; gThink.text = String(x.text || "").replace(/\s+/g, " ").trim(); });
      };
      // 连着放到后台的几个子 agent（同一步里一起派出去的）：并成一块（同 Claude Code）——
      //   ● 2 background agents launched (↓ to manage)
      //     ├ 名字（Explore 这类写上种类；fork 的不写）
      //     └ 名字
      var FORK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/></svg>';
      var agB = [];
      var flushAg = function () {
        if (!agB.length) return;
        var b0 = agB; agB = [];
        if (b0.length === 1) return oneTool(b0[0].p, b0[0].i, toolMode(b0[0].p));
        // 整块包在一个块级的 span 里：r.block 的 HTML 不是块级的话，会和前一行（上面那行空行）连成一行、和后一行也连上——
        //   「● 2 background agents launched」前面多了一格、上下的空行都没了（用户：渲染有问题）
        var D1 = P.DIM, html = [P.toHtml([GREEN + DOT + RESET + " " + BOLD + b0.length + RESET + " background agents launched" + D1 + " (↓ to manage)" + RESET])];
        b0.forEach(function (x, k) {
          var inp = x.p.input || {}, ty0 = String(inp.subagent_type || ""), nm = String(inp.description || inp.name || ty0 || "agent"), fk = ty0 === "fork";
          var ty = ty0 && ty0 !== "general-purpose" && ty0 !== "worker" && !fk ? ty0 : ""; // 种类：Explore 这些写字；fork 用分叉的小图标（同右侧栏），不写字
          html.push(P.toHtml(["  " + D1 + (k === b0.length - 1 ? "└" : "├") + RESET + " "]) + (fk ? '<span class="cc-forki" title="fork">' + FORK_SVG + "</span>" + P.toHtml([" "]) : "") +
            P.toHtml([BOLD + clip(nm, P.cols - 8 - (fk ? 2 : 0) - (ty ? ty.length + 3 : 0)) + RESET + (ty ? D1 + " · " + ty + RESET : "")]));
        });
        r.text([""]);
        mark(b0[0].p.t0);
        r.block('<span class="agl">' + html.join("\n") + "</span>");
      };
      var flushGroup = function (tail) {
        flushAg();
        if (!group.length && !gThink) return;
        if (!ccs && group.length === 1 && group[0].name !== "Read" && A.toolCat(group[0].name) !== "toolRead") { var g0 = group[0], i0 = gIdx[0]; group = []; gIdx = []; return oneTool(g0, i0, toolMode(g0)); } // 只有一条命令 / 任务操作：照常一条
        var key = ti + ":g" + gi++, byMode = readM === "full" || readM === "preview", on = verbose || (key in open ? !!open[key] : byMode && group.length > 0);
        r.text([""]);
        mark((group[0] && group[0].t0) || lastEnd);
        r.block(ccs ? ccGroupHtml(group, key, on, gThink, !!(tail && live)) : groupHtml(group, key, on, verbose || open[key] === true ? "full" : byMode ? readM : "full"));
        group = []; gIdx = []; gThink = null;
      };
      parts.forEach(function (p, i) {
        addThink(p.thinkBefore);
        if (p.kind === "tool") {
          lastEnd = Math.max(lastEnd, (p.t0 || lastEnd) + (p.secs || 0) * 1000); // 下一段话的时间（没记的时候）：这个工具跑完的时候
          var m = toolMode(p), bg = p.status === "background" || (p.input && p.input.run_in_background);
          if (ccs) {
            // 同 Claude Code 2.x：读、搜、列、命令（MCP 也是）连着的并成一组——跑完的一条命令也是（Ran 1 shell command），在跑的、出错的也在组里（出错的在组下面红字）；
            // 任务清单那几个（TaskCreate、TodoWrite…）不画、也不打断一组；ToolSearch 这些不画、但打断（同 Claude Code）；单独设了档位的工具不并
            if (CC_ABSORB.test(p.name) && (m === "hidden" || !verbose && m !== "full")) return;
            if (m === "hidden" && p.status !== "running") return;
            if (p.name === "Agent" && (p.asyncLaunched || p.status === "background") && !verbose && !(ti + ":p" + i in open)) { if (group.length || gThink) flushGroup(); agB.push({ p: p, i: i }); return; } // 放到后台的子 agent：连着的并成一块
            if (agB.length) flushAg();
            if (merge && ccKind(p) && !(vflag("toolModes") || {})[p.name] && !(p.edits && p.edits.length)) { group.push(p); gIdx.push(i); return; } // 改了文件的命令单独一条（同 Claude Code）
            flushGroup();
            if (p.name === "AskUserQuestion") { if (m !== "hidden" || verbose) askAnswered(p); return; } // 同 Claude Code：问的那一下不画，答了画一块
            if (CC_SILENT.test(p.name) && !verbose && m !== "full") return;
            oneTool(p, i, m);
            return;
          }
          // 连着的读取与搜索并成一行（「Read 3 files, searched for 2 patterns」，设置里可关）；出错的、后台的单独一条
          if (merge && A.toolCat(p.name) === "toolRead" && m !== "hidden" && p.status !== "error" && !bg && !(vflag("toolModes") || {})[p.name]) { group.push(p); gIdx.push(i); return; } // 单独设了档位的工具不并
          flushGroup();
          oneTool(p, i, m);
          return;
        }
        flushGroup();
        if (p.kind === "notice") { // 一轮中间读进去的通知：后台命令的按「后台任务通知」，子 agent 跑完的按「Agent 消息 › 子 Agent 报告」
          var pbg = (p.notices || []).filter(function (n) { return n.kind !== "agent"; }), prp = (p.notices || []).filter(function (n) { return n.kind === "agent"; });
          if (pbg.length && vmode("notices")) { r.text([""]); noticeBlock(r, pbg, ti + ":pn" + i + ":"); }
          if (prp.length) reportRows(r, prp, ti + ":r" + i, p.at || turn.at, mark);
          return;
        }
        var stm = live && i === parts.length - 1 && !p.whole; // 还在流的那一段（p.whole：连接器记录里读到的都是说完了的整段——Codex 的一句话回复没有换行，按流式只画到换行就整句不见）
        var md = stm ? settled(p.text) : p.text;
        if (!md.trim()) return;
        // 回复翻译（translate.js 的 reply）：说完了的一段（还在流的那段不翻）每一块都有译文了就整段换上。没有「原文 / 译文」按钮：
        //   译文那一块指上去淡淡一层高亮，点一下换成原文（浅色底）；原文那块里任何地方点一下换回译文（划选文字、点链接不算）
        var trk = ti + ":tr" + i, trd = !stm && window.TSU_TRANSLATE && TSU_TRANSLATE.reply ? TSU_TRANSLATE.reply(md, agentId) : null, showO = !!(trd && open[trk]);
        if (trd && !showO) md = trd;
        else if (!trd && cfg.translateShow === "only" && !stm && window.TSU_TRANSLATE && TSU_TRANSLATE.replyPending && TSU_TRANSLATE.replyPending(md)) { r.text(["", "  " + P.DIM + "…" + RESET]); return; } // 只显示译文：还没翻好的段落先是一行淡的 …
        var trWrap = function (rows) { return '<span class="grp trsw' + (showO ? " open" : "") + '" data-key="' + trk + '">' + hotHtml(rows) + "</span>"; };
        // 最后一次调用工具之后的话是最终回复（说给你的）；夹在工具调用之间的是过程说明（在跑的这一问：最后那段也先算过程说明）
        var tAt = p.at || (!live && i > lastTool && turn.stats && turn.stats.at) || lastEnd; // 这段话的时间：记了的用它；最终回复没记的：答完的时候
        if (!live && i > lastTool) { if (vmode("answers")) { r.text([""]); mark(tAt); if (trd) r.block(trWrap(answer(md))); else r.text(answer(md)); } return; }
        var pm = vmode("progress"), xk = ti + ":x" + i;
        if (pm === "hidden") return;
        if (verbose || (xk in open ? open[xk] : pm === "full")) {
          var ar = answer(md);
          r.text([""]);
          mark(tAt);
          if (!(xk in open) || !/^\S+ /.test(ar[0]) || (trd && ar.length < 2)) return trd ? r.block(trWrap(ar)) : r.text(ar);
          ar[0] = ar[0].replace(/^(\S+ )/, "$1" + HOT) + HOT_END; // 点开过的：点第一行收回一行
          if (trd) { var head0 = [ar.shift()]; return r.block('<span class="grp open" data-key="' + xk + '">' + hotHtml(head0) + "\n" + trWrap(ar) + "</span>"); } // 第一行点了收起；下面几行点了换原文 / 译文
          return r.block('<span class="grp open" data-key="' + xk + '">' + hotHtml(ar) + "</span>");
        }
        // 一行：灰的第一句，后面还有就「…」；点一下看全
        var first = String(md).trim().split("\n")[0].replace(/^[#>*\-\s]+/, "").replace(/[*`_]/g, ""), more = String(md).trim().indexOf("\n") >= 0;
        r.text([""]);
        mark(tAt);
        r.block('<span class="grp" data-key="' + xk + '">' + hotHtml([D + DOT + " " + HOT + clip(first, P.cols - 6) + (more ? " …" : "") + HOT_END + RESET]) + "</span>");
      });
      addThink(turn.think);
      flushGroup(true);
      // 系统错误（不是模型说的、也不是工具的）：API 出错（402、429、5xx）、网络、登录、沙盒、中断、模型什么都没回……
      // 同 Claude Code 紧跟一行「⎿  API Error: …」（红；中断、没内容是灰的），不是 ⏺ 开头的一段话（那样像 agent 自己说的）。按「系统错误」的档位：
      // 完整 / 一行（长的截成一行，点一下看全）/ 隐藏；工具自己的失败不在这里（归工具那几类）
      var em = vmode("sysErrors");
      var sysLine = function (text, tone, key) {
        var all = wrap(String(text), P.cols - 6), full = verbose || (key in open ? !!open[key] : em === "full"), ls = full || all.length < 2 ? all : [clip(String(text).replace(/\s+/g, " "), P.cols - 8)];
        var rows = ls.map(function (l, i) { return (i ? "     " : "  " + D + "⎿" + RESET + "  " + (all.length > 1 ? HOT : "")) + tone + l + RESET + (!i && all.length > 1 ? HOT_END : ""); });
        if (all.length < 2) r.text(rows); else r.block('<span class="grp' + (full ? " open" : "") + '" data-key="' + key + '">' + hotHtml(rows) + "</span>");
      };
      var tErr = (turn.stats && turn.stats.at) || lastEnd;
      if (em !== "hidden" && (turn.error || (turn.note && turn.ask !== undefined))) mark(tErr);
      if (em === "hidden") { /* 系统错误不显示 */ }
      else if (turn.error === "Interrupted by user") r.text(["  " + D + "⎿" + RESET + "  " + (V.style !== "teyvat" ? D + (agent.connector === "codex" ? "Conversation interrupted · tell the model what to do differently" : "Interrupted · What should Claude do instead?") : RED + "Interrupted" + RESET + D + " · What should " + agent.name + " do instead?") + RESET]);
      else if (/^Interrupted · /.test(turn.error || "")) r.text(["  " + D + "⎿" + RESET + "  " + RED + "Interrupted" + RESET + D + " · " + turn.error.slice(14) + RESET]);
      else if (turn.error) sysLine(turn.error, RED, ti + ":err");
      if (turn.note && turn.ask !== undefined && em !== "hidden") sysLine(turn.note, D, ti + ":note"); // 「(no content) · stop_reason: …」这类
      // 结尾那行（同 Claude Code）：✻ Brewed for 6m 51s——过去式的词每一问不一样；打开了「时间」再加 done 3:04 PM。
      //   后面紧跟着一条「※ recap」的：这一行挪到 recap 下面（总在最下面），这里不画
      var nxT = rt.session().turns[tI + 1];
      if (!live && !(nxT && nxT.recap !== undefined && vmode("recaps")) && !footDone(turn)) { var dl0 = doneLine(turn); if (dl0) r.text(["", dl0]); }
      var rows = done();
      // 这一问的内容全被筛掉了（右侧栏只看某几种）：不占地方；有内容就在最前面加上组的标题
      if (!rows.some(function (x) { return x.k === "b" || x.h.replace(/<[^>]*>/g, "").trim(); })) return [];
      if (hdr) rows.splice.apply(rows, [1, 0].concat(new P.Rows().text([hdr]).flush().rows));
      return rows;
    }
    // ---- 一组折叠的工具调用：一行摘要（数字加粗），悬停高亮，点开是灰底的详情（每条完整的命令和输出）----
    // 「Ran 1 shell command, read 2 files」：字是 tone 色（折叠的是灰的）；在跑的数字加粗，跑完的数字同整行一样淡
    function describe(list, running, tone) {
      var by = {}, order = [];
      tone = tone || "";
      list.forEach(function (p) { var k = p.name === "Grep" ? "Glob" : p.name; if (!by[k]) { by[k] = 0; order.push(k); } by[k]++; });
      return order.map(function (k, i) {
        var v = VERB[k] || [k, k, "call", "calls"], n = by[k], verb = running ? v[0] : v[1];
        verb = i ? verb.charAt(0).toLowerCase() + verb.slice(1) : verb.charAt(0).toUpperCase() + verb.slice(1); // Read 1 file, ran 1 shell command
        return tone + (i ? ", " : "") + verb + " " + (running ? BOLD + n + RESET + tone : n) + " " + (n === 1 ? v[2] : v[3]) + RESET; // 跑完的：数字同整行一样淡
      }).join("");
    }
    // 后台任务跑完（同 Claude Code）：● Background command "描述" completed (exit code 0) / failed with exit code 1 / was stopped
    function ccNote(n) {
      var dot = (n.status === "done" ? GREEN : n.status === "stopped" ? AMBER : RED) + DOT + RESET, ms = n.ms || 0;
      return dot + " " + clip(String(n.summary || "").replace(/\s+/g, " ").trim(), P.cols - 4 - (ms > 0 ? W(F.dur(ms)) + 3 : 0)) + (ms > 0 ? P.DIM + " · " + F.dur(ms) + RESET : "");
    }
    // 后台命令跑完的那一行能点开（同点开工具调用）：下面是它的输出——通知里带着的，或者读它的输出文件（读一次记着）
    var noteOut = {};
    function noticeBlock(r, list, key) {
      var rows = noticeRows(list);
      rows.forEach(function (row, j) {
        var n = list[j], k = key + j, op = verbose || open[k] === true;
        var out = String(n.result || "") || (noteOut[n.outFile] && noteOut[n.outFile].text) || "";
        if (op && !out && n.outFile && !noteOut[n.outFile] && window.TSU_LOCAL && TSU_LOCAL.read) {
          noteOut[n.outFile] = { text: "", loading: true };
          TSU_LOCAL.read(n.outFile, { max: 400000 }).then(function (b) { noteOut[n.outFile] = { text: new TextDecoder().decode(new Uint8Array(b)) }; }, function () { noteOut[n.outFile] = { text: "", gone: true }; }).then(function () { var ti0 = parseInt(k, 10), t0 = rt.session().turns[ti0]; if (t0) drawTurn(t0); });
        }
        var lines = [row.replace(/^(\S+ )/, "$1" + HOT) + HOT_END];
        if (op) {
          var D = P.DIM, st = noteOut[n.outFile] || {}, ol = out ? termLines(out.replace(/\s+$/, ""), P.cols - 6) : [];
          if (!out) lines.push("  " + D + "⎿  " + (st.loading ? "Reading output…" : st.gone ? "(output file no longer available)" : "(No output)") + RESET);
          else { var lim = verbose ? 4000 : 400; ol.slice(0, lim).forEach(function (l, i) { lines.push((i ? "     " : "  " + D + "⎿  " + RESET) + l); }); if (ol.length > lim) lines.push("     " + D + "… +" + (ol.length - lim) + " lines" + RESET); }
        }
        r.block('<span class="grp' + (op ? " open" : "") + '" data-key="' + k + '">' + hotHtml(lines) + "</span>");
      });
    }
    function noticeRows(list) {
      if (V.style !== "teyvat") return list.map(function (n) { return n.summary ? ccNote(n) : ccNote(Object.assign({}, n, { summary: (n.kind === "shell" ? "Background command" : "Agent") + ' "' + String(n.desc || n.cmd || n.id || "") + '" ' + (n.status === "done" ? "completed" : n.status === "stopped" ? "was stopped" : "failed") })); });
      return list.map(function (n) {
        var shell = n.kind === "shell", name = String(n.desc || n.cmd || n.id || "").replace(/\s+/g, " ").trim();
        var st = n.status === "done" ? "completed" + (shell ? " (exit code " + (n.code || 0) + ")" : "")
          : n.status === "stopped" ? "was stopped"
          : shell && n.code ? "failed with exit code " + n.code
          : "failed" + (n.error ? ": " + String(n.error).split("\n")[0] : "");
        var head = (shell ? "Background command" : "Agent") + ' "', tail = '" ' + st;
        name = clip(name, Math.max(12, Math.min(W(name), P.cols - 2 - W(head) - Math.min(W(tail), 34)))); // 名字优先，放不下时截后面的报错
        return (n.status === "done" ? GREEN : n.status === "stopped" ? P.DIM : RED) + DOT + RESET + " " + clip(head + name + tail, P.cols - 2);
      });
    }
    // 子 agent 跑完交回来的（Agent 消息 › 子 Agent 报告）：一行「✓ fork · 描述 finished · 1h 25m · 460k tokens」（失败 ✗ 红、停下 ■ 灰）；
    // 完整：下面是它的报告（Markdown）。有报告的那一行能点开 / 收起；隐藏：不画
    function reportRows(r, list, key, at, mk) { // mk：turnRows 里记时间戳的那个（mark）
      var m = amode("agentReports"), D = P.DIM;
      if (m === "hidden") return;
      list.forEach(function (n, j) {
        var tk = (rt.tasks || []).filter(function (x) { return x.id && x.id === n.id; })[0] || {}, st = n.status || tk.status, ms = n.ms || tk.ms || 0, tok = n.tokens || tk.tokens || 0;
        var ok = st === "done", stop = st === "stopped", part = n.partial || tk.partial;
        var verb = part ? "stopped at turn limit" : ok ? "finished" : stop ? "was stopped" : "failed";
        var txt = [n.type || tk.type || "agent", String(n.desc || tk.desc || n.id || "").replace(/\s+/g, " ").trim() + " " + verb].concat(ms ? [(F.durS || F.dur)(ms)] : [], tok ? [(F.kS || F.k)(tok) + " tokens"] : []).join(" · ");
        var icon = (ok && !part ? GREEN + "✓" : stop || part ? P.DIM + "■" : RED + "✗") + RESET + " ", rep = String(n.result || tk.result || "").trim(), rk = key + ":" + j;
        var line0 = V.style !== "teyvat" && n.summary ? ccNote(Object.assign({}, n, { status: st, ms: ms })) : icon + clip(txt, P.cols - 4); // Claude Code 风格：同 Claude Code 的通知那一行
        r.text([""]);
        if (mk) mk(n.at || at);
        if (!rep) { r.text([line0]); return; }
        var op = verbose || (rk in open ? !!open[rk] : m === "full"), rows = [line0.replace(/^(\S+ )/, "$1" + HOT) + HOT_END];
        if (op) trim(mdLines(rep, { width: P.cols - 7, theme: P.theme })).forEach(function (l, li) { rows.push((li ? "     " : "  " + D + "⎿" + RESET + "  ") + l); });
        r.block('<span class="grp' + (op ? " open" : "") + '" data-key="' + rk + '">' + hotHtml(rows) + "</span>");
      });
    }
    // 以前存下的系统轮只有给模型的那段字：从里面认出来
    function oldNotices(ask) {
      var out = [], re = /<task-notification>Background (task|agent) (\w\d+) \(([\s\S]*?)\) (done|error|stopped|running) after [^\n]*\nResult:\n([\s\S]*?)<\/task-notification>/g, m;
      while ((m = re.exec(String(ask || "")))) {
        var code = /\(exit code (\d+)\)\s*$/.exec(m[5]);
        out.push({ kind: m[1] === "task" ? "shell" : "agent", id: m[2], desc: m[1] === "task" ? m[3].replace(/^\$ /, "") : m[3], status: m[4], code: code ? +code[1] : 0, error: m[4] === "error" && !code ? m[5].trim().split("\n").pop() : "" });
      }
      return out;
    }
    var SLOW_MS = 800; // 一下就完的（多数 Read、ls）：不画「进行中」那两三行，只把这一行换成进行时，免得一闪
    var HOT = "\uE000", HOT_END = "\uE001", HOT_MORE = "\uE002", HOT_ITEM = "\uE003", NUM_A = "\uE004", NUM_B = "\uE005", HOT_NUM = "\uE006"; // NUM_A…NUM_B：跑完的一组标题里的数字（指上去时加粗变白）；HOT_NUM：这种标题能点的那段 // HOT_ITEM：跑完的一组在「标题」这一层时的一条（点了只展开 / 收起这一条的细节） // HOT_MORE：「… +n more」那一行（点了只展开 / 收起前面几条的标题，不展开整组）
    var hotHtml = function (rows) { return P.toHtml(rows); }; // 记号的替换在 P.toHtml 里
    // 并成一行的连续读取与搜索：一行摘要；开着的（点开、或设置是完整 / 预览）下面按 lvl 列出每一条
    function groupHtml(list, key, isOpen, lvl) {
      var running = list.filter(function (p) { return p.status === "running"; }), D = P.DIM;
      var rows = [], t0 = running.length ? Math.min.apply(null, running.map(function (p) { return p.t0 || Date.now(); })) : 0;
      var slow = running.length && Date.now() - t0 >= SLOW_MS;
      if (slow) {
        rows.push(D + DOT + RESET + " " + describe(running, true) + "…");
        var cur = running[running.length - 1];
        var what = cur.name === "Bash" ? "$ " + String((cur.input || {}).command || "").replace(/\s*\n\s*/g, " ↵ ") : (TOOL_NAMES[cur.name] || cur.name) + "(" + toolArg(cur) + ")";
        var wl = wrap(what, P.cols - 7), more = wl.length > 3;
        wl.slice(0, 3).forEach(function (l, i) { rows.push((i ? "     " : "  " + D + "⎿" + RESET + "  ") + D + (more && i === 2 ? clip(l, P.cols - 8) + "…" : l) + RESET); });
        if (cur.detach) rows.push("     " + D + "(ctrl+b to run in background)" + RESET);
      } else if (running.length) rows.push("  " + HOT + describe(list, true, D) + D + "…" + RESET + HOT_END);
      else rows.push("  " + HOT + describe(list, false, D) + HOT_END); // 不写「N failed」：出错的那一条展开后自己是红的（同 Claude Code）
      var html = hotHtml(rows);
      if (isOpen) { // 展开着的：跑完的照样摆着（不因为又来了一条就整块收起再展开），在跑的那条跑完再进来
        var det = [];
        list.forEach(function (p) { if (p.status === "running") return; if (det.length) det.push(""); det.push.apply(det, toolRows(p, lvl || "full")); });
        if (det.length) html += "\n" + '<span class="gdet">' + P.toHtml(det.map(function (l) { return pad(l, P.cols); })) + "</span>";
      }
      return '<span class="grp' + (isOpen ? " open" : "") + (slow ? " live" : "") + '" data-key="' + key + '">' + html + "</span>";
    }
    // ======== 同 Claude Code 2.x（Claude Code 风格）========
    // 工具 → 标题 / 结果 / 画不画（照 ~/Desktop/src/tools/*/UI.tsx 与 2.1.281）：
    //   Bash        折叠组「Ran N shell commands」（跑完的都并进来，cat/grep/ls 这类算读 / 搜 / 列）；在跑的：● 说明 · Ns / ⎿ $ 命令 (Ns)；单独一条：● Bash(命令，2 行 160 字) / ⎿ 输出前 3 行 … +N lines / (No output)
    //   Read        折叠组「Read N files」；单独：● Read(路径) / ⎿ Read N lines · Read image (120.6KB) · Read PDF (…) · Read N cells
    //   Grep/Glob   折叠组「Searched for N patterns」；单独：● Search(pattern: "…", path: "…") / ⎿ Found N files · Found N lines · Found N matches across M files
    //   Write       ● Write(路径) / ⎿ Wrote N lines to 路径 + 前 10 行（行号、按文件类型上色）/ … +N lines；覆盖已有的：同 Update
    //   Edit        ● Update(路径)（新建是 Create）/ ⎿ Added N lines, removed M lines + diff（行号、上色、红绿底）
    //   WebFetch    ● Fetch(网址) / ⎿ Received 12KB (200 OK)；WebSearch：● Web Search("…") / ⎿ Did 1 search in 3s
    //   Skill       ● Skill(名字) / ⎿ Successfully loaded skill；TaskStop：● Stop Task / ⎿ 命令 · stopped
    //   不画        TaskCreate、TaskGet、TaskList、TaskUpdate、TodoWrite（并进前后那一组）；ToolSearch、AskUserQuestion、EnterPlanMode（组到这里断开）
    //   出错        ⎿ Error: …（红，最多 10 行）；工具自己报的：File not found / Error reading file / Error writing file / Error searching files
    //   思考        旁白（narration）的是一段话「● …」；别的并进前后那一组「Thought for 5s, …」
    // 路径（同 Claude Code 的 getDisplayPath）：会话目录里的写相对路径，家目录下的 ~/…，别的照原样；展开 / ctrl+o 的写全路径
    // 路径（同 Claude Code）：调用那一刻所在目录（base，记录里每条都写着 cwd——它 cd 进哪里就跟到哪里）里的写相对的，家目录下的 ~/…；展开（ctrl+o）写全路径
    function ccPath(fp, full, base) {
      fp = String(fp || "");
      if (full || verbose) return fp;
      var cwd = String(base || (rt.session && rt.session().cwd) || (rt.cwd && rt.cwd()) || "").replace(/\/+$/, "");
      if (cwd && fp.indexOf(cwd + "/") === 0) return fp.slice(cwd.length + 1);
      var li = window.TSU_LOCAL && TSU_LOCAL.info ? TSU_LOCAL.info() : null, home = (li && li.home) || (/^\/Users\/[^/]+/.exec(fp) || [""])[0];
      if (home && fp.indexOf(home + "/") === 0) return "~" + fp.slice(home.length);
      return fp;
    }
    // 命令算哪一种（同 Claude Code 的 isSearchOrReadCommand）：每一段（| && ; 隔开）开头的命令都是搜 / 读 / 列（echo 这些不算）才算那一种，不然是「命令」；列 > 搜 > 读
    var CC_SEARCH = /^(find|grep|rg|ag|ack|locate|which|whereis)$/, CC_READ = /^(cat|head|tail|less|more|wc|stat|file|strings|jq|awk|cut|sort|uniq|tr)$/, CC_LIST = /^(ls|tree|du)$/, CC_NEUTRAL = /^(echo|printf|true|false|:)$/;
    function bashKind(cmd) {
      var c = String(cmd || ""), fs0 = false, rd = false, ls0 = false, any = false, first = (/^\s*(?:(?:#[^\n]*|\\)\n\s*)*([^\s|&;()<>]+)/.exec(c) || [])[1];
      var known = function (w) { return CC_SEARCH.test(w) || CC_READ.test(w) || CC_LIST.test(w) || CC_NEUTRAL.test(w); };
      if (!first || !known(first)) return "bash";
      var segs = c.split(/\|\|?|&&|;|\n/);
      for (var i = 0; i < segs.length; i++) {
        var w = segs[i].trim().split(/\s+/)[0];
        if (!w || CC_NEUTRAL.test(w)) continue;
        if (!known(w)) return "bash";
        any = true; if (CC_SEARCH.test(w)) fs0 = true; if (CC_READ.test(w)) rd = true; if (CC_LIST.test(w)) ls0 = true;
      }
      return !any ? "bash" : ls0 ? "list" : fs0 ? "search" : "read";
    }
    function ccKind(p) {
      if (p.name === "Read") return "read";
      if (p.name === "Grep" || p.name === "Glob") return "search";
      if (p.name === "LS") return "list";
      if (/^mcp__/.test(p.name)) return "mcp";
      if (p.name === "Bash" && !sysTitle(p)) return bashKind(p.input && p.input.command);
      return "";
    }
    // 在跑的那一组下面那行（同 Claude Code 的 latestDisplayHint）：命令「$ 命令」（每行的空白并成一个、空行去掉，最多 300 字），读的是路径，搜的是「"模式"」
    var cap300 = function (t) { return t.length > 300 ? t.slice(0, 299) + "…" : t; };
    function ccHint(p) {
      var a = p.input || {}, k = ccKind(p);
      if (p.name === "Bash") return a.command ? cap300("$ " + String(a.command).split("\n").map(function (l) { return l.replace(/\s+/g, " ").trim(); }).filter(Boolean).join("\n")) : "";
      if (k === "read") return a.file_path ? cap300(ccPath(a.file_path, false, p.cwd)) : "";
      if (k === "search") return a.pattern ? '"' + cap300(String(a.pattern).replace(/\s+/g, " ").trim()) + '"' : "";
      if (k === "list") return a.path ? cap300(ccPath(a.path, false, p.cwd)) : "";
      return "";
    }
    // 出错（同 Claude Code 的 FallbackToolUseErrorMessage）：红的「Error: …」最多 10 行；工具自己报的（<tool_use_error>）按工具写一句
    function errRows(p, all) {
      var D = P.DIM, sub = "  " + D + "⎿" + RESET + "  ", raw = String((p.detail && p.detail.length ? p.detail.join("\n") : "") || p.error || "Error");
      if (!all) {
        var nf = /Note: your current working directory is/.test(raw) && /^(Read|Grep|Glob)$/.test(p.name);
        var nm = nf ? "File not found" : /<tool_use_error>/.test(raw) ? { Read: "Error reading file", Write: "Error writing file", Edit: "Error editing file", Grep: "Error searching files", Glob: "Error searching files" }[p.name] : "";
        if (nm) return [sub + RED + nm + RESET];
      }
      var t = raw.replace(/<\/?tool_use_error>|<\/?error>/g, "").trim();
      if (!/^(Error|Cancelled): /.test(t)) t = "Error: " + t;
      var ls = [];
      t.split("\n").forEach(function (l) { wrap(l, P.cols - 6).forEach(function (x) { ls.push(x); }); });
      var lim = all ? Math.min(ls.length, 400) : 10, rows = ls.slice(0, lim).map(function (l, i) { return (i ? "     " : sub) + RED + l + RESET; });
      if (ls.length > lim) rows.push("     " + D + HOT + "… +" + (ls.length - lim) + " lines" + HOT_END + RESET);
      return rows;
    }
    // 代码（同 Claude Code 的 HighlightedCode）：左边一列淡的行号（右对齐，前后各空一格），代码按文件类型上色（颜色跟着「高亮配色」），放在「⎿」那一块里；
    // max：最多几行（折行也算，0 = 全部）；返回 { rows, more（还有几行没画）}
    var CC_LANG = { py: "python", pyw: "python", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx", ts: "typescript", mts: "typescript", tsx: "tsx", json: "json", md: "markdown", markdown: "markdown", sh: "bash", bash: "bash", zsh: "bash",
      css: "css", scss: "scss", html: "html", htm: "html", xml: "xml", svg: "xml", yml: "yaml", yaml: "yaml", toml: "toml", rs: "rust", go: "go", java: "java", kt: "kotlin", swift: "swift", c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp",
      m: "objectivec", rb: "ruby", php: "php", sql: "sql", lua: "lua", r: "r", ini: "ini", cfg: "ini", tex: "latex", diff: "diff", patch: "diff", dockerfile: "dockerfile" };
    var langOf = function (fp) { var b = String(fp || "").split("/").pop().toLowerCase(), e = b.lastIndexOf(".") > 0 ? b.slice(b.lastIndexOf(".") + 1) : b; return CC_LANG[e] || ""; };
    var HL_CACHE = new Map();
    // 整块一起上色（多行的字符串、注释才对）：每一行 → 带颜色的一行（ANSI）；没有语言、上色失败：null
    function hlBlock(lines, lang) {
      if (!lang || !window.TTU || !TTU.markdownLines || !lines.length) return null;
      var key = lang + "\u0001" + P.theme + "\u0001" + lines.join("\n");
      if (HL_CACHE.has(key)) return HL_CACHE.get(key);
      var res = null;
      try {
        var run = (lines.join("\n").match(/`+/g) || []).reduce(function (mx, t) { return Math.max(mx, t.length); }, 0), fence = "`".repeat(Math.max(3, run + 1));
        var out = mdLines(fence + lang + "\n" + lines.join("\n") + "\n" + fence, { width: 100000, theme: P.theme });
        res = [];
        for (var i = 0; i < out.length && res.length < lines.length; i++) {
          var m = /^(\s*(?:\x1b\[[\d;]*m)?\s*\d+(?:\x1b\[[\d;]*m)? ?)/.exec(out[i]);
          if (m) res.push(out[i].slice(m[1].length));
        }
        if (res.length !== lines.length) res = null;
      } catch (e) { res = null; }
      if (HL_CACHE.size > 5000) HL_CACHE.clear();
      HL_CACHE.set(key, res);
      return res;
    }
    function hlEach(lines, lang) {
      if (!lang) return null;
      var out = [];
      for (var i = 0; i < lines.length; i++) {
        if (!String(lines[i]).trim()) { out.push(lines[i]); continue; }
        var h = hlBlock([lines[i]], lang);
        if (!h) return null;
        out.push(h[0]);
      }
      return out;
    }
    // 一行带颜色的字 → 每个字的颜色（"r;g;b" / null）
    function ansiCols(t) {
      var out = [], c = null, re = /\x1b\[([\d;]*)m|[\s\S]/gu, m;
      while ((m = re.exec(t))) {
        if (m[1] === undefined) { out.push(c); continue; }
        var ps = m[1].split(";");
        for (var k = 0; k < ps.length; k++) {
          if (ps[k] === "38" && ps[k + 1] === "2") { c = ps[k + 2] + ";" + ps[k + 3] + ";" + ps[k + 4]; k += 4; }
          else if (ps[k] === "" || ps[k] === "0" || ps[k] === "39") c = null;
        }
      }
      return out;
    }
    function codeRows(text, fp, max) {
      var D = P.DIM, src = String(text).replace(/\r/g, "").replace(/^\t+/gm, function (t) { return "  ".repeat(t.length); }).split("\n");
      if (src.length > 1 && src[src.length - 1] === "") src.pop();
      var take = src.slice(0, max || 2000), digits = String(take.length).length, hl = hlEach(take, langOf(fp)), rows = [], used = 0, w = Math.max(10, P.cols - 7 - digits);
      for (var i = 0; i < take.length && (!max || rows.length < max); i++) {
        var segs = hl ? termLines(hl[i], w) : wrap(take[i], w);
        if (!segs.length) segs = [""];
        for (var j = 0; j < segs.length && (!max || rows.length < max); j++) rows.push("      " + (j ? " ".repeat(digits) : D + String(i + 1).padStart(digits) + RESET) + " " + segs[j]);
        used = i + 1;
      }
      return { rows: rows, more: src.length - used };
    }
    // 一组（同 Claude Code 2.x 的折叠组 CollapsedReadSearchContent）：
    //   跑完的：前面空两格、灰字「Thought for 5s, searched for 1 pattern, read 2 files, ran 3 shell commands」（数字粗体，没有点）；
    //   在跑的：一闪一闪的灰点 + 在跑的命令的说明（没有就「Running 3 shell commands…」，现在进行时）+ 淡的「· 用时」（2 秒起），
    //           下面「⎿ $ 命令」（淡，最后一行后面「(用时)」）；还在想的：「⎿ 想的那句」（淡、斜体，最多 10 行）；能放到后台的（Paimon 的）才有「(ctrl+b to run in background)」；
    //   出错的、放到后台的：也只是组里的一条；点这一行（或 ctrl+o）展开：每一条的完整样子（全路径、全部输出、红的 Error）
    function ccGroupHtml(list, key, isOpen, think, tail) {
      var D = P.DIM, run = list.filter(function (p) { return p.status === "running"; }), act = run.length > 0 || tail, dur = F.dur;
      var n = { search: 0, list: 0, bash: 0, mcp: 0, readOps: 0 }, files = {}, servers = [];
      list.forEach(function (p) {
        var k = ccKind(p);
        if (k === "read" && p.name === "Read" && p.input && p.input.file_path) files[p.input.file_path] = 1;
        else if (k === "read") n.readOps++;
        else if (k === "mcp") { n.mcp++; var sv = String(p.name).split("__")[1] || "MCP"; if (servers.indexOf(sv) < 0) servers.push(sv); }
        else if (k) n[k]++;
      });
      var nRead = Object.keys(files).length || n.readOps, tone = act ? "" : P.light ? rgb("102;102;102") : rgb("153;153;153"), bits = []; // 跑完的一组：整行 Claude Code 的 inactive 灰（照截图取的 153），不是淡的一半
      // 数字：在跑的一组白、加粗；跑完的一组整行都是淡的，数字也淡（不加亮）——指上去时字回到正文的颜色、数字白且加粗（同 Claude Code 指上去的样子，见 panes.css .hnum）
      var num = function (c) { return act ? RESET + BOLD + c + RESET + tone : NUM_A + c + NUM_B; };
      if (think && (think.ms > 0 || think.text)) bits.push(tone + (act && !list.length ? "Thinking" : "Thought") + " for " + num(dur(Math.max(1000, think.ms || 0))) + RESET);
      var add = function (ing, ed, c, one, many) { if (!c) return; var v = act ? ing : ed; bits.push(tone + (bits.length ? ", " + v : v.charAt(0).toUpperCase() + v.slice(1)) + " " + num(c) + " " + (c === 1 ? one : many) + RESET); };
      add("searching for", "searched for", n.search, "pattern", "patterns");
      add("reading", "read", nRead, "file", "files");
      add("listing", "listed", n.list, "directory", "directories");
      if (n.mcp) bits.push(tone + (bits.length ? ", " : "") + (act ? (bits.length ? "calling" : "Calling") : bits.length ? "called" : "Called") + " " + servers.join(", ") + (n.mcp > 1 ? " " + num(n.mcp) + " times" : "") + RESET);
      add("running", "ran", n.bash, "shell command", "shell commands");
      var rows = [];
      // 用时：这一组从第一条开始算起的总时长（墙上时间：中间它想、写的那几秒也算——这一批活一共干了多久）；每一条自己的用时写在它的标题后面
      var g0 = list.reduce(function (m, p) { return p.t0 && (!m || p.t0 < m) ? p.t0 : m; }, 0), g1 = list.reduce(function (m, p) { return Math.max(m, p.t1 || p.t0 || 0); }, 0);
      if (act) {
        var cur = run[run.length - 1], el = g0 ? Date.now() - g0 : cur ? Date.now() - (cur.t0 || Date.now()) : 0;
        // 标题：组里只有一条命令时写它的说明；几条的写「Running 3 shell commands」（同 Claude Code：在跑那条的命令写在下面 ⎿ 里）
        // 标题一直是「Running 7 shell commands」这种统计（同 Claude Code）；下面列出这一组每条的说明（agent 写的标题，译文），在跑的那条在最后、正常颜色带用时，
        //   它的命令淡色跟在下面——统计、每条在干什么都看得到（Claude Code 从第二条起就只剩「$ 命令」）
        // 点：真有一条在跑才闪；两条之间的空当（上一条跑完、下一条还没开始，它在想）不闪
        rows.push(D + (run.length ? DOT_RUN : DOT) + RESET + " " + HOT + bits.join("") + "…" + HOT_END); // 「…」紧跟着字、同色；这一组一共多久不写在这里（右侧栏「正在运行」那一行写）
      } else rows.push("  " + HOT_NUM + bits.join("") + HOT_END + ((isOpen || tlv[key]) && list.length > 1 && g0 && g1 - g0 >= 2000 ? D + " · " + dur(g1 - g0) + RESET : "")); // 跑完的：收着时不写用时（同 Claude Code），点开了才写
      var titleOf = function (p) { var a = p.input || {}; return String(p.name === "Bash" ? a.description || String(a.command || "").split("\n")[0] : (ccHint(p) || "").split("\n")[0] || p.name).replace(/\s+/g, " ").trim(); };
      // 出错的、放到后台的：同 Claude Code 也只是组里的一条（组下面不另画红字；点开 / ctrl+o 的完整样子里才看得到）
      // segs：一段段——普通的行（数组）和单独点开的那一条的细节（{ det, i }，灰底；点它收起）；items：每条能点的标题对应第几条（data-items）
      var segs = [rows], items = [], curR = rows;
      var itemDet = function (p, i) { segs.push({ det: [""].concat(toolRows(Object.assign(Object.create(p), { fullPath: true }), "full")).concat([""]), i: i }); curR = []; segs.push(curR); };
      if (act) {
        // 下面那几行命令 / 路径（淡的）：在跑的那条的；没有在跑的（两条之间的空当）留着刚跑完那条的——下一条开始才换，不是一闪就没
        var last = list[list.length - 1], hintP = cur || last, hint = !list.length ? "" : hintP ? ccHint(hintP) : "";
        if (!list.length && think && think.text) { // 还在想：想的那句（淡、斜体，最多 10 行）
          var tl = wrap(think.text, P.cols - 6), cut = tl.length > 10;
          tl.slice(0, 10).forEach(function (l, i) { rows.push((i ? "     " : "  " + D + "⎿" + RESET + "  ") + D + ITALIC + (cut && i === 9 ? clip(l, P.cols - 7) + "…" : l) + RESET); });
        } else if (list.length) {
          // 每条一行：跑完的淡色，在跑的正常颜色（多的只留最后几条，前面写「… +n more」）；在跑那条的命令淡色跟在它下面（最多两行）
          //   「… +n more」点一下列出前面的全部（每条带它自己的用时），再点收起（moreOpen，同 open 记在这个视图里）
          // 收着时列几条：看屏幕还剩多少——对话区能放几行，减去下面排着的消息（排队的那几句）要占的行、上下文留 8 行，三分之一给这一组；
          //   至少 4 条、最多 12 条（没排队、屏幕高就多列几条；排着好几句就少列，保证一屏里看得全、好看）
          var scrRows = Math.max(12, Math.floor((P.screen.clientHeight || 600) / (P.rowH || 17))), qRows = 0;
          (rt.pending ? rt.pending() : []).concat(rt.queued ? [rt.queued] : []).forEach(function (q0) { qRows += 1 + Math.ceil(Math.max(1, W(String(q0 && q0.text || ""))) / Math.max(20, P.cols - 4)); });
          var MAXT = Math.max(4, Math.min(12, Math.floor((scrRows - qRows - 8) / 3))), allT = !!moreOpen[key], shown = allT ? list : list.slice(-MAXT), more = list.length - list.slice(-MAXT).length, first = true, lead = function () { var x = first ? "  " + D + "⎿" + RESET + "  " : "     "; first = false; return x; };
          if (more > 0) rows.push(lead() + HOT_MORE + D + (allT ? "… hide " + more + " earlier" : "… +" + more + " more") + RESET + HOT_END);
          // 每条前面一个序号（第几条：数字一直在涨，不写序号不知道在跑的是第几个）；跑完的都写用时（不到 1 秒写 <1s——以前不写，看着像漏了）；
          //   每条的字能点：只展开 / 收起这一条的细节（灰底，同别处点开的；在跑的也行）——前面几条折着时点「… +n more」列出来
          var nw = String(list.length).length;
          shown.forEach(function (p) {
            var ii = list.indexOf(p), op = !!idet[key + ":" + ii];
            var on = run.indexOf(p) >= 0, pel = on && p.t0 ? Date.now() - p.t0 : p.t0 && p.t1 ? p.t1 - p.t0 : 0, tm = on ? (pel >= 1000 ? " · " + dur(pel) : "") : pel >= 1000 ? " · " + dur(pel) : p.t0 && p.t1 ? " · <1s" : "";
            var no = String(ii + 1), num = D + " ".repeat(Math.max(0, nw - no.length)) + no + "." + RESET + " ", t = clip(trTask(titleOf(p)), P.cols - 13 - nw - tm.length);
            curR.push(lead() + HOT_ITEM + num + (on || op ? t + (on ? (pel >= 2000 ? D + tm + RESET : "") : D + tm + RESET) : D + t + tm + RESET) + HOT_END);
            items.push(ii);
            if (op) return itemDet(p, ii);
            if (p === hintP && hint) {
              var hs = hint.split("\n"), hl = [], ind2 = "       " + " ".repeat(nw + 2); // 命令对齐到标题（序号后面）
              hs.forEach(function (l) { wrap(l, P.cols - 10 - nw).forEach(function (x) { hl.push(x); }); });
              hl.slice(0, 2).forEach(function (l, i) { curR.push(ind2 + D + (i === 1 && hl.length > 2 ? clip(l, P.cols - 12 - nw) + " …" : l) + RESET); });
            }
          });
        } else if (hint) {
          var hs0 = hint.split("\n"), hl0 = [];
          hs0.forEach(function (l) { wrap(l, P.cols - 6).forEach(function (x) { hl0.push(x); }); });
          hl0.forEach(function (l, i) { rows.push((i ? "     " : "  " + D + "⎿" + RESET + "  ") + D + l + RESET); });
        }
        // 「run in background」能点（同按 ctrl+b）：点了马上换成「moving to background…」，没成写原因
        if (cur && (cur.detach || (agent.claude && cur.name === "Bash" && rt.toBackground && rt.canInject && rt.canInject()))) { var bgs = agent.claude && rt.bgState ? rt.bgState() : ""; curR.push("     " + D + (bgs === "moving" ? "(moving to background…)" : "(ctrl+b to \uE007run in background\uE008)") + RESET); if (bgs === "error") curR.push("     " + RED + rt.bgError() + RESET); } // Claude Code 的后台会话：ctrl+b 也送得进去
      }
      // 跑完的一组三层：收着（一行统计）→ 点一下列出每条的标题（序号、说明、用时）→ 点其中一条只展开它的细节（灰底；点灰底收起）；全部的细节：ctrl+o（同 Claude Code）
      if (!act && !isOpen && tlv[key] && list.length) {
        var nw1 = String(list.length).length;
        list.forEach(function (p, i) {
          var pel = p.t0 && p.t1 ? p.t1 - p.t0 : 0, tm = pel >= 1000 ? " · " + dur(pel) : p.t0 && p.t1 ? " · <1s" : "", no = String(i + 1), op = !!idet[key + ":" + i];
          var num = " ".repeat(nw1 - no.length) + no + ". ", t = clip(trTask(titleOf(p)), P.cols - 13 - nw1 - tm.length), bad = p.status === "error" ? RED + " ✗" + RESET : "";
          curR.push((i ? "     " : "  " + D + "⎿" + RESET + "  ") + HOT_ITEM + (op ? "" : D) + num + t + D + tm + RESET + HOT_END + bad);
          items.push(i);
          if (op) itemDet(p, i);
        });
      }
      var html = segs.map(function (sg) { return sg.det ? '<span class="gdet idet" data-i="' + sg.i + '" title="点按以收起">' + P.toHtml(sg.det.map(function (l) { return pad(l, P.cols); })) + "</span>" : sg.length ? hotHtml(sg) : ""; }).filter(Boolean).join("\n");
      if (isOpen && list.length) { // 展开：每一条的完整样子（同 Claude Code 点开 / ctrl+o）
        var det = [];
        list.forEach(function (p) { det.push(""); det.push.apply(det, toolRows(Object.assign(Object.create(p), { fullPath: true }), "full")); });
        html += "\n" + '<span class="gdet">' + P.toHtml(det.map(function (l) { return pad(l, P.cols); })) + "</span>";
      }
      return '<span class="grp ccg' + (isOpen ? " open" : "") + (run.length ? " live" : "") + (act ? "" : " done") + '" data-key="' + key + '"' + (items.length ? ' data-items="' + items.join(",") + '"' : "") + ">" + html + "</span>";
    }
    function toolArg(p) {
      var a = p.input || {};
      if (p.name === "help") return a.name || "";
      if (sysTitle(p)) { var cm = String(a.command || "").trim(); return cm.split(/\s+/)[0] === p.sys ? cm.replace(/^\S+\s*/, "") : cm; } // ⏺ Numbers(write A1:B3 …)：开头的命令名换成标题
      if (p.name === "web_search") return '"' + (a.query || "") + '"';
      if (p.name === "WebFetch") return a.url || "";
      if (p.name === "Bash") return a.command || "";
      if (p.name === "Glob" || p.name === "Grep") return V.style !== "teyvat" ? 'pattern: "' + (a.pattern || "") + '"' + (a.path ? ', path: "' + ccPath(a.path, p.fullPath, p.cwd) + '"' : "") : a.pattern || ""; // 同 Claude Code：Search(pattern: "…", path: "…")
      if (p.name === "Agent") return a.description || "";
      if (p.name === "TaskOutput" || p.name === "TaskStop") return a.id || a.task_id || "";
      if (/^Task(Update|Get)$/.test(p.name)) { var tid = a.taskId || a.task_id || a.id; return (tid ? "#" + tid : "") + (a.status ? " → " + a.status : ""); } // 同 Claude Code：TaskUpdate(#3 → completed)
      if (p.name === "TaskCreate") return a.subject || a.title || a.description || "";
      if (p.name === "Skill") return a.skill || a.command || "";
      if (V.style !== "teyvat" && (a.file_path || a.notebook_path)) return ccPath(a.file_path || a.notebook_path, p.fullPath, p.cwd); // 同 Claude Code：那时所在目录里的写相对路径、家目录下的 ~/…；展开的写全路径
      return a.file_path || "";
    }
    // 一条工具调用（同 Claude Code）：⏺ Name(参数) / ⎿ 结果；进行中是灰点，失败是红点。lvl：full 完整（全部参数与结果）/ preview 结果的前几行 / call 只看调用（一行摘要）
    function toolRows(p, lvl) {
      if (lvl === true) lvl = "full"; else if (!lvl) lvl = "call";
      // 改了文件的命令（同 Claude Code）：命令、输出照常，后面每个文件「⎿ Updated overview.js (+41 -5)」+ 改动（行号、红绿底）
      if (p.edits && p.edits.length && !p._eds && V.style !== "teyvat") {
        p._eds = true; var base0; try { base0 = toolRows(p, lvl); } finally { p._eds = false; }
        var D1 = P.DIM, fullE = lvl === "full" || verbose;
        p.edits.forEach(function (e) {
          base0.push("  " + D1 + "⎿" + RESET + "  Updated " + BOLD + (fullE ? e.path : e.path.split("/").pop()) + RESET + " (+" + e.add + " -" + e.del + ")"); // 同 Claude Code：文件名；展开是全路径
          base0 = base0.concat(diffRows(e.diff, fullE ? 4000 : lvl === "call" ? 16 : 60, e.path)); // 同 Claude Code：改动默认就给看前面一段，展开看全部
        });
        return base0;
      }
      var full = lvl === "full", peek = lvl === "preview", D = P.DIM, dot = p.status === "error" ? RED + DOT + RESET : p.status === "running" ? D + DOT_RUN + RESET : GREEN + DOT + RESET;
      if (p.name === "Bash" && V.style !== "teyvat" && !sysTitle(p)) return bashRows(p, lvl, dot); // 同 Claude Code 2.x 的 Bash
      var cc = V.style !== "teyvat", head = sysTitle(p) || (cc && CC_NAMES[p.name]) || TOOL_NAMES[p.name] || p.name, argRaw = toolArg(p), rows, sub = "  " + D + "⎿" + RESET + "  ", pad5 = "     ";
      // 任务清单（同 Claude Code）：● Update Todos，下面每一项 ☐ 没做 / 粗体 ☐ 在做 / 灰的划掉 ☒ 做完；只看调用：只有这一行
      if (cc && p.name === "TodoWrite") {
        var tds = (p.input && p.input.todos) || [], tr0 = [dot + " " + BOLD + "Update Todos" + RESET];
        if (lvl === "call" && !verbose) return tr0;
        tds.forEach(function (t, ti0) { var c0 = clip(String(t.content || t.subject || ""), P.cols - 9); tr0.push((ti0 ? pad5 : sub) + (t.status === "completed" ? D + "☒ " + ESC + "[9m" + c0 + RESET : t.status === "in_progress" ? BOLD + "☐ " + c0 + RESET : "☐ " + c0)); });
        return tr0;
      }
      // 读 / 改的文件：路径能点（Paimon Terminal 里在右侧打开，网页桌面里交给编辑器）
      var fp = (p.name === "Read" || p.name === "Edit" || p.name === "Write") && p.input && p.input.file_path && window.STUDIO ? String(p.input.file_path) : "";
      if (cc && verbose && !p.fullPath) argRaw = toolArg(Object.assign(Object.create(p), { fullPath: true })); // ctrl+o 展开的：全路径（同 Claude Code 的 verbose）；平常「完整结果」照样是短的（同它默认的样子）
      if (cc && p.name === "Edit" && p.input && p.input.old_string === "" && !p.input.edits) head = "Create"; // 同 Claude Code：没有原文的是新建
      if (cc && p.name === "Skill") head = "Skill";
      if (cc && p.name === "Agent") { var sty = String((p.input && p.input.subagent_type) || ""); head = sty && sty !== "general-purpose" && sty !== "worker" ? sty : "Agent"; } // 同 Claude Code：子 agent 的种类（通用的、worker 叫 Agent）
      if (cc && p.name === "TaskStop") { head = "Stop Task"; argRaw = ""; }
      if (fp && (!full || cc) && W(argRaw) <= P.cols - W(head) - 5) { rows = [dot + " " + BOLD + head + RESET + "(" + link(location.origin + location.pathname + "#vs-file:" + encodeURIComponent(fp), argRaw) + ")"]; fp = "done"; } // TTU 只留 http(s) 的链接：用本页加个 #
      if (fp === "done") { /* 上面画好了 */ } else if (full) {
        var al = wrap(argRaw, P.cols - W(head) - 4);
        rows = al.map(function (l, i) { return i ? pad(" ", W(head) + 3) + l + (i === al.length - 1 ? ")" : "") : dot + " " + BOLD + head + RESET + "(" + l + (al.length === 1 ? ")" : ""); });
      } else rows = [dot + " " + BOLD + head + RESET + "(" + clip(argRaw.replace(/\n/g, " ↵ "), P.cols - W(head) - 5) + ")"];
      var cl = function (s) { return full ? s : clip(s, P.cols - 6); };
      if (cc && !argRaw && rows.length === 1) rows[0] = rows[0].replace(/\(\)$/, ""); // 同 Claude Code：没有参数的不写括号（Stop Task）
      if (p.name === "hibernate") {
        var a2 = p.input || {}, when = p.until ? " · wakes " + timeOf(p.until) : "";
        return [D + "⏾ " + (p.status === "sleeping" ? "Hibernating" + when + (a2.summary ? " — " + a2.summary : "") : (p.wake || "Slept") + (a2.summary ? " — " + a2.summary : "")) + RESET];
      }
      // 子 Agent（Paimon 的 Agent、Claude Code 的 Task）：一行状态；再按设置挑几块——任务说明（交给它的 prompt）、过程（它自己的每一步，有记录的话）、结果（它的报告）；
      // 只看调用：只有状态（在跑的时候照样露最近几步）；预览：每块前几行；完整：全部
      if (cc && p.name === "Agent") {
        // 同 Claude Code 的 AgentTool UI：● 种类(说明)；在跑：⎿ 它最近 3 步（「+N more tool uses」）/ 还没动静：Initializing…；放到后台的：⎿ Backgrounded agent (↓ to manage)；
        // 跑完：⎿ Done (N tool uses · Xk tokens · 用时)；展开（完整 / ctrl+o）：Prompt: 交给它的、Response: 它的报告
        var tsk = rt.tasks || [], ag1 = tsk.find(function (x) { return x.id === p.agentId; }) || tsk.filter(function (x) { return x.desc === (p.input || {}).description; }).pop();
        var st1 = ag1 && ag1.log ? ag1.log.filter(function (x) { return x.kind === "tool"; }) : [], many1 = full || verbose;
        if (p.status === "error") return rows.concat(errRows(p, many1));
        if (p.asyncLaunched || p.status === "background") rows.push(sub + "Backgrounded agent" + D + " (↓ to manage)" + RESET);
        else if (p.status === "running") {
          if (!st1.length) rows.push(sub + D + "Initializing…" + RESET);
          else {
            var sh1 = many1 ? st1 : st1.slice(-3);
            sh1.forEach(function (x, k) { var nm1 = CC_NAMES[x.name] || TOOL_NAMES[x.name] || x.name, ar1 = toolArg(x); rows.push((k ? pad5 : sub) + BOLD + nm1 + RESET + (ar1 ? "(" + clip(String(ar1).replace(/\s+/g, " "), P.cols - 10 - W(nm1)) + ")" : "")); });
            if (st1.length > sh1.length) rows.push(pad5 + D + "+" + (st1.length - sh1.length) + " more tool " + (st1.length - sh1.length === 1 ? "use" : "uses") + RESET);
          }
        } else {
          var sa1 = p.agentStats || (ag1 && ag1.status === "done" ? { tools: ag1.tools || 0, tokens: (ag1.tokensIn || 0) + (ag1.tokensOut || 0), ms: ag1.ms || 0 } : null);
          rows.push(sub + (sa1 ? "Done (" + (sa1.tools === 1 ? "1 tool use" : sa1.tools + " tool uses") + " · " + F.k(sa1.tokens) + " tokens · " + F.dur(sa1.ms) + ")" : "Done"));
        }
        if (many1) {
          var pr1 = String((p.input || {}).prompt || "").trim(), rp1 = String((ag1 && ag1.result) || (p.detail || []).join("\n") || "").trim();
          if (pr1) { rows.push(sub + GREEN + BOLD + "Prompt:" + RESET); trim(mdLines(pr1, { width: P.cols - 9, theme: P.theme })).forEach(function (l) { rows.push(pad5 + "  " + l); }); }
          if (rp1) { rows.push(sub + GREEN + BOLD + "Response:" + RESET); trim(mdLines(rp1, { width: P.cols - 9, theme: P.theme })).forEach(function (l) { rows.push(pad5 + "  " + l); }); }
        }
        return rows;
      }
      if (p.name === "Agent") {
        var tasks = rt.tasks || [], ag = tasks.find(function (x) { return x.id === p.agentId; }) || tasks.filter(function (x) { return x.desc === (p.input || {}).description; }).pop();
        if (ag) {
          var el2 = F.dur(ag.ms || Date.now() - ag.t0);
          var tus = ag.tools === 1 ? "1 tool use" : ag.tools + " tool uses"; // 同 Claude Code：1 tool use / 12 tool uses
          var st = ag.status === "running" ? (ag.background ? "Running in background" : "Running") + "… · " + tus + " · " + el2 : ag.status === "done" ? "Done (" + tus + " · " + F.k(ag.tokensIn + ag.tokensOut) + " tokens · " + el2 + ")" : RED + ag.status + (ag.error ? ": " + ag.error : "") + RESET;
          rows.push(sub + D + st + RESET);
        } else rows.push(sub + (p.status === "error" ? RED + (p.error || "Error") : D + (p.status === "running" ? "Running…" : p.status === "background" ? "Running in background…" : "Done")) + RESET);
        var run = ag ? ag.status === "running" : p.status === "running" || p.status === "background";
        var steps = ag && ag.log ? ag.log.filter(function (x) { return x.kind === "tool"; }) : [];
        var report = ag && ag.result ? String(ag.result).split("\n") : p.status !== "error" && p.detail ? p.detail : [];
        var many = full || verbose, block = function (title, ls, tone) {
          if (!ls.length) return;
          var w = [];
          ls.forEach(function (l) { w.push.apply(w, wrap(String(l), P.cols - 8)); });
          var lim = many ? Math.min(w.length, 400) : 3;
          rows.push(pad5 + D + title + RESET);
          w.slice(0, lim).forEach(function (l) { rows.push(pad5 + "  " + (tone || "") + l + (tone ? RESET : "")); });
          if (w.length > lim) rows.push(pad5 + "  " + D + HOT + "… +" + (w.length - lim) + " lines" + (many ? "" : " (click to expand)") + HOT_END + RESET);
        };
        if (lvl === "call" && !run) return rows;
        if (vflag("agentPrompt") === true && lvl !== "call") block("Prompt", String((p.input || {}).prompt || "").split("\n").filter(function (l, i, a) { return l.trim() || (i && i < a.length - 1); }), D);
        if (vflag("agentSteps") !== false && steps.length) {
          var sl = (run || !many ? steps.slice(-3) : steps.slice(0, 50)).map(function (x) { return (TOOL_NAMES[x.name] || x.name) + "(" + clip(toolArg(x), P.cols - 24) + ")"; });
          if (run) sl.forEach(function (l) { rows.push(pad5 + D + l + RESET); }); else if (lvl !== "call") block("Steps", sl, D);
        }
        if (run) return rows;
        if (vflag("agentResult") !== false && lvl !== "call") block("Report", report.slice(0, 200));
        return rows;
      }
      if (cc && p.status === "error" && !/^(Agent|SendMessage|ListAgents|hibernate)$/.test(p.name)) return rows.concat(errRows(p, full || verbose)); // 同 Claude Code：出错的是红的「Error: …」
      if (p.name === "SendMessage" && V.style !== "teyvat") {
        // Claude Code 风格：同收到的消息——一行淡的「› Message to @谁 (ctrl+o to expand)」，下面「⎿ 送到哪了」（Message queued for delivery to … at its next tool round.）；
        // 展开（完整）是正文（Markdown，缩进两格）
        var sm0 = p.input || {}, so0 = p.social || {}, to0 = String(so0.to || sm0.to || "?"), md0 = sm0.mode === "interrupt" || so0.mode === "interrupt";
        var res0 = p.summary || (so0.count > 1 ? "Message sent to " + so0.count + " agents." : md0 ? "Message delivered to " + to0 + " (interrupt)." : "Message queued for delivery to " + to0 + " at its next tool round.");
        if (lvl !== "full" && !verbose) { // 同 Claude Code：只有那一行淡的结果
          if (p.status === "running") return [];
          if (p.status === "error") return [sub + RED + String(p.error || "error") + RESET];
          return wrap(res0, P.cols - 6).map(function (l, i) { return (i ? pad5 : sub) + D + l + RESET; });
        }
        rows = [D + "› " + (lvl === "full" ? "Message to " + clip(to0, P.cols - 16) : "Message to @" + clip(to0, P.cols - 36) + " (ctrl+o to expand)") + RESET];
        if (lvl === "full") trim(mdLines(String(sm0.message || "").replace(/\r/g, ""), { width: P.cols - 4, theme: P.theme })).forEach(function (l) { rows.push("  " + l); });
        if (p.status === "running") return rows;
        if (p.status === "error") { rows.push(sub + RED + String(p.error || "error") + RESET); return rows; }
        wrap(res0, P.cols - 6).forEach(function (l, i) { rows.push((i ? pad5 : sub) + D + l + RESET); });
        return rows;
      }
      if (p.name === "SendMessage" || p.name === "ListAgents") {
        var sa = p.input || {}, smode = sa.mode === "interrupt" ? "interrupt" : "queue"; // 默认 queue
        rows = [dot + " " + BOLD + "Social" + RESET + (p.name === "ListAgents" ? " list" : " send " + (smode === "interrupt" ? "an" : "a") + " " + smode + " message to " + LAV + clip(String(sa.to || ""), P.cols - 40) + RESET)];
        if (p.status === "running") return rows;
        if (p.status === "error") { rows.push(sub + RED + String(p.error || "error") + RESET); return rows; }
        var so = p.social || {}, when = "  " + D + "[" + stamp(so.ts || p.t0 || Date.now()) + "]" + RESET;
        if (p.name === "ListAgents") { rows.push(sub + "Agents " + BOLD + (p.count || 0) + RESET + (W(sub + "Agents 00" + when) <= P.cols ? when : "")); return rows; }
        var sline = sub + (so.count > 1 ? "Sent to " + BOLD + so.count + RESET + " receivers" : "Sent and " + BOLD + (so.mode || smode) + RESET + " " + LAV + (so.to || sa.to || "?") + RESET + (so.id ? " (" + so.id + ")" : ""));
        rows.push(W(sline + when) <= P.cols ? sline + when : sline); // 时间戳放不下就不放
        if (lvl === "call") return rows;
        var mrows = [];
        (so.lines || []).forEach(function (l) { mrows.push(pad5 + D + clip(l, P.cols - 6) + RESET); });
        String(sa.message || "").split("\n").forEach(function (l) { wrap(l, P.cols - 6).forEach(function (x) { mrows.push(pad5 + x); }); });
        if (peek && mrows.length > 3) mrows = mrows.slice(0, 3).concat([pad5 + D + HOT + "… +" + (mrows.length - 3) + " lines" + HOT_END + RESET]);
        return rows.concat(mrows);
      }
      if (p.status === "running") { rows.push(sub + D + (p.name === "web_search" ? "Searching…" : p.name === "WebFetch" ? "Fetching…" : p.name === "Skill" ? "Initializing…" : "Running…") + RESET); if (p.detach) rows.push(pad5 + D + "(ctrl+b to run in background)" + RESET); return rows; }
      if (cc) { // 同 Claude Code 2.x 各个工具的结果那一行（字是正常色，数字、路径粗体）
        var bnum = function (t) { return String(t).replace(/(\d[\d.,]*)/, BOLD + "$1" + RESET); };
        if (p.name === "Read" || p.name === "Grep" || p.name === "Glob" || p.name === "LS") {
          var sm = String(p.summary || "Done");
          rows.push(sub + (p.readKind === "file_unchanged" ? D + sm + RESET : p.readKind === "image" || p.readKind === "pdf" ? sm : /^Found /.test(sm) ? sm.replace(/^Found (\d+) /, "Found " + BOLD + "$1 " + RESET).replace(/ across (\d+) /, " across " + BOLD + "$1 " + RESET) : bnum(sm)));
          if ((full || verbose) && p.name !== "Read" && p.detail && p.detail.length) p.detail.slice(0, 400).forEach(function (l) { wrap(l, P.cols - 6).forEach(function (x) { rows.push(pad5 + x); }); });
          return rows;
        }
        if (p.name === "web_search") { rows.push(sub + String(p.summary || "Did 1 search")); return rows; }
        if (p.name === "WebFetch") {
          rows.push(sub + (p.bytes !== undefined ? "Received " + BOLD + String(p.summary || "").replace(/^Received (\S+) .*$/, "$1") + RESET + (p.httpStatus ? " (" + p.httpStatus + ")" : "") : D + (p.summary || "Done") + RESET));
          if ((full || verbose) && p.detail) p.detail.slice(0, 400).forEach(function (l) { wrap(l, P.cols - 6).forEach(function (x) { rows.push(pad5 + x); }); });
          return rows;
        }
        if (p.name === "Skill") { rows.push(sub + String(p.summary || "Successfully loaded skill")); return rows; }
        if (p.name === "TaskStop") { var sc = String(p.stopCmd || (p.input && (p.input.task_id || p.input.shell_id)) || ""), st2 = full || verbose ? sc : sc.split("\n").slice(0, 2).join("\n").slice(0, 160).trim(); rows.push(sub + st2 + (st2 !== sc ? "… · stopped" : " · stopped")); return rows; }
        if (p.name === "Write" && p.detail && !p.diff) { // Wrote N lines to 路径 + 前 10 行（行号、上色）+ … +N lines；展开：全部
          var wc = p.detail.length - (p.detail.length > 1 && p.detail[p.detail.length - 1] === "" ? 1 : 0), wfp = (p.input && p.input.file_path) || "";
          rows.push(sub + "Wrote " + BOLD + wc + RESET + " " + (wc === 1 ? "line" : "lines") + " to " + BOLD + (verbose || p.fullPath ? wfp : ccPath(wfp, false, p.cwd)) + RESET);
          if (lvl === "call" && !verbose) return rows;
          var wcr = codeRows(p.detail.join("\n") || "(No content)", wfp, full || verbose ? 0 : 10);
          rows = rows.concat(wcr.rows);
          if (wcr.more > 0) rows.push(pad5 + D + HOT + "… +" + wcr.more + " " + (wcr.more === 1 ? "line" : "lines") + HOT_END + RESET);
          return rows;
        }
        if (p.diff) { // Added N lines, removed M lines + diff（行号、上色、红绿底）
          var na = 0, nd = 0;
          p.diff.forEach(function (d) { if (d.t === "+") na++; else if (d.t === "-") nd++; });
          rows.push(sub + (na ? "Added " + BOLD + na + RESET + " " + (na > 1 ? "lines" : "line") : "") + (na && nd ? ", " : "") + (nd ? (na ? "r" : "R") + "emoved " + BOLD + nd + RESET + " " + (nd > 1 ? "lines" : "line") : "") + (na || nd ? "" : D + "(No changes)" + RESET));
          return lvl === "call" && !verbose ? rows : rows.concat(diffRows(p.diff, full || verbose ? 4000 : 400, (p.input && p.input.file_path) || ""));
        }
      }
      if (p.name === "web_search") {
        rows.push(sub + (p.status === "error" ? RED + p.error + RESET : D + "Did 1 search in " + p.secs + "s · " + (p.results || []).length + " results" + RESET));
        if ((verbose || full || peek) && p.results) p.results.slice(0, full || verbose ? 100 : 3).forEach(function (x) {
          rows.push(pad5 + "· " + link(x.url, x.title) + RESET);
          rows.push(pad5 + "  " + D + clip(x.url, P.cols - 10) + (x.age ? " · " + x.age : "") + RESET);
          if (full && x.description) wrap(x.description, P.cols - 9).slice(0, 3).forEach(function (l) { rows.push(pad5 + "  " + D + l + RESET); });
        });
        return rows;
      }
      if (p.name === "WebFetch") {
        if (p.status === "error") rows.push(sub + RED + p.error + RESET);
        else rows.push(sub + (p.bytes !== undefined ? "Received " + BOLD + F.kb(p.bytes) + RESET + " " + D + String(p.summary || "").replace(/^Received [\d.,]+\s*[KMG]?B /i, "") + RESET : D + (p.summary || "Done") + RESET));
        if ((full || peek) && p.detail) {
          var wl = [];
          p.detail.slice(0, full ? 300 : 5).forEach(function (l) { wrap(l, P.cols - 6).forEach(function (x) { wl.push(pad5 + D + x + RESET); }); });
          rows = rows.concat(peek ? wl.slice(0, 5) : wl);
          if (peek && p.detail.length > 5) rows.push(pad5 + D + HOT + "… +" + (p.detail.length - 5) + " lines (click to expand)" + HOT_END + RESET);
        }
        return rows;
      }
      if (p.name === "Write" && p.detail && !full) { rows.push(sub + D + (p.summary || "Wrote") + RESET); if (!peek) return rows; p.detail.slice(0, 4).forEach(function (l) { (cfg.wrap !== "clip" ? wrap(l, P.cols - 6) : [clip(l, P.cols - 6)]).forEach(function (x) { rows.push(pad5 + D + x + RESET); }); }); if (p.detail.length > 4) rows.push(pad5 + D + "… +" + (p.detail.length - 4) + " lines (click to expand)" + RESET); return rows; }
      if (p.diff) {
        rows.push(sub + D + p.summary + RESET);
        return lvl === "call" && !verbose ? rows : rows.concat(diffRows(p.diff, full || verbose ? 2000 : 24));
      }
      var st0 = sysTitle(p), lines = p.detail || [], limit = full ? Math.min(lines.length, 400) : verbose ? lines.length : peek ? 5 : 0;
      if (p.status === "error" && !lines.length) rows.push(sub + RED + p.error + RESET);
      else if (p.summary && (p.name !== "Bash" || !lines.length || st0)) rows.push(sub + (p.status === "error" ? RED : D) + (p.img ? link(location.origin + location.pathname + "#vs-img:" + TSU_IMG.key(p.img), p.summary) : p.summary) + RESET); // 读的图：「Read image (…)」是链接，悬停浮出、点了放大
      else if ((st0 && !full) || (!limit && lines.length)) rows.push(sub + (p.status === "error" ? RED + clip(lines[lines.length - 1] || p.error, P.cols - 8) : D + clip(lines[0] || "Done", P.cols - 18) + (lines.length > 1 ? " … +" + (lines.length - 1) + " lines" : "")) + RESET); // 只看调用：一行摘要（第一行 + 还有几行）
      else if (!lines.length && !p.summary && p.status !== "background") rows.push(sub + D + (p.status === "error" ? RED + (p.error || "Error") : "Done") + RESET);
      lines.slice(0, limit).forEach(function (l, i) {
        var pre = i || (p.summary && (p.name !== "Bash" || st0)) || (st0 && !full) ? pad5 : sub;
        if (full || cfg.wrap !== "clip") termLines(l, P.cols - 6).forEach(function (x, j) { rows.push((j ? pad5 : pre) + x); });
        else rows.push(pre + clip(l, P.cols - 6));
      });
      if (lines.length > limit && limit) rows.push(pad5 + D + HOT + "… +" + (lines.length - limit) + " lines" + (full || cc ? "" : " (click to expand)") + HOT_END + RESET);
      if (p.status === "error" && lines.length) rows.push(pad5 + RED + p.error + RESET);
      if (p.status === "background") rows.push(sub + D + "Running in background as " + (p.taskId || "a task") + RESET);
      return rows;
    }
    // Bash 单独一条（同 Claude Code 2.x 的 BashTool UI；Claude Code 风格里只有不并成一组时才这样画：单独设了档位、关了合并、组展开的详情）：
    //   ● Bash(命令)——不是完整时最多 2 行、160 个字，多的「…」；
    //   跑着：⎿ Running… (用时)；有输出的：最后 5 行 +「+N lines (用时)」；能放到后台的（Paimon 的）才有「(ctrl+b to run in background)」——Claude Code 的会话这边做不到，不写；
    //   跑完：⎿ 输出（折到宽度后前 3 行，正好 4 行就 4 行）+「… +N lines」；完整：全部；没有输出：(No output)；后台的：Running in the background (↓ to manage)；出错：红的「Error: …」
    function bashRows(p, lvl, dot) {
      var a = p.input || {}, D = P.DIM, sub = "  " + D + "⎿" + RESET + "  ", pad5 = "     ", cmd = String(a.command || "").replace(/\s+$/, ""), all = lvl === "full" || verbose, shown = cmd;
      if (!all) { var cl0 = cmd.split("\n"); if (cl0.length > 2 || cmd.length > 160) shown = (cl0.length > 2 ? cl0.slice(0, 2).join("\n") : cmd).slice(0, 160).trim() + "…"; }
      var hl = [];
      ("Bash(" + shown + ")").split("\n").forEach(function (l) { wrap(l, P.cols - 2).forEach(function (x) { hl.push(x); }); });
      var rows = hl.map(function (l, i) { return i ? "  " + l : dot + " " + BOLD + "Bash" + RESET + l.slice(4); });
      if (p.status === "running") {
        var ms = Date.now() - (p.t0 || Date.now()), et = ms >= 1000 ? D + "(" + F.dur(ms) + ")" + RESET : "", out = (p.detail || []).map(String).filter(function (l) { return l.trim(); });
        if (!out.length) rows.push(sub + D + "Running…" + RESET + (et ? " " + et : ""));
        else {
          var tl = out.slice(-5), more = out.length - tl.length;
          tl.forEach(function (l, i) { rows.push((i ? pad5 : sub) + D + clip(l, P.cols - 6) + RESET); });
          if (more > 0 || et) rows.push(pad5 + (more > 0 ? D + "+" + more + " lines" + RESET + (et ? " " : "") : "") + et);
        }
        if (p.detach) rows.push(pad5 + D + "(ctrl+b to run in background)" + RESET);
        return rows;
      }
      if (p.status === "error") return rows.concat(errRows(p, all));
      if (p.status === "background") { rows.push(sub + D + "Running in the background (↓ to manage)" + RESET); return rows; }
      var lines = (p.detail || []).map(String);
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      if (!lines.length) { rows.push(sub + D + (p.stale ? "Interrupted" : p.summary && !/^Done$/i.test(p.summary) ? p.summary : "(No output)") + RESET); return rows; }
      var wl = [];
      lines.forEach(function (l) { termLines(l, Math.max(10, P.cols - 10)).forEach(function (x) { wl.push(x); }); });
      var lim = all ? Math.min(wl.length, 2000) : lvl === "call" ? 1 : wl.length === 4 ? 4 : 3;
      wl.slice(0, lim).forEach(function (x, i) { rows.push((i ? pad5 : sub) + x); });
      if (wl.length > lim) rows.push(pad5 + D + HOT + "… +" + (wl.length - lim) + " lines" + HOT_END + RESET);
      return rows;
    }
    // 词级对比：两行都切成词，最长公共子序列，没对上的就是改了的
    function wordDiff(a, b) {
      var ta = a.match(/\s+|[A-Za-z0-9_$]+|[\u4e00-\u9fff]|[^\sA-Za-z0-9_$]/g) || [], tb = b.match(/\s+|[A-Za-z0-9_$]+|[\u4e00-\u9fff]|[^\sA-Za-z0-9_$]/g) || [];
      if (ta.length * tb.length > 40000) return null;
      var n = ta.length, m = tb.length, L = [];
      for (var i = 0; i <= n; i++) L.push(new Int16Array(m + 1));
      for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) L[i][j] = ta[i] === tb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      var ka = [], kb = [];
      i = 0; j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && ta[i] === tb[j]) { ka.push([ta[i], 0]); kb.push([tb[j], 0]); i++; j++; }
        else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { kb.push([tb[j], 1]); j++; }
        else { ka.push([ta[i], 1]); i++; }
      }
      return [ka, kb];
    }
    // 改动（同 Claude Code）：一块左右对称（两边各留 5 格），删的一行整行暗红、加的一行整行暗绿，行号在块里；
    // 长行默认折行（续行在 +/- 后面接着写），设置里可以改成截断（cfg.wrap = "clip"）；一删一加紧挨着时改了的词再深一档
    function diffRows(dl, limit, fp) {
      var rows = [], D = P.DIM, wrapOn = cfg.wrap !== "clip";
      // 代码上色（Claude Code 风格，同 Claude Code 的 diff）：整段一起上色，再按行拆回每个字的颜色
      var hlm = null, lang = fp ? langOf(fp) : "";
      if (lang) {
        var hsrc = dl.filter(function (d) { return d.t !== "…"; }), hb = hlBlock(hsrc.map(function (d) { return String(d.l || "").replace(/\t/g, "  "); }), lang);
        if (hb) { hlm = new Map(); hsrc.forEach(function (d, k) { hlm.set(d, ansiCols(hb[k])); }); }
      }
      var colsOf = function (d) { return hlm ? hlm.get(d) || null : null; };
      var numW = String(dl.reduce(function (mx, d) { return Math.max(mx, d.n || 0); }, 0)).length;
      // 颜色同 teyvat（也就是 Claude Code 的深色主题）：见 panes.css 的 .drow
      var B = Math.max(30, P.cols - 10), codeW = Math.max(10, B - numW - 3), L = "     ";
      // 一行代码（带「改了的词」标记）→ 若干段，每段不超过 codeW 宽
      var chunks = function (pieces, cols) {
        var out = [[]], w = 0, k = 0;
        pieces.forEach(function (pc) {
          Array.from(String(pc[0]).replace(/\t/g, "  ")).forEach(function (ch) {
            var cw = W(ch), co = cols ? cols[k] || null : null;
            k++;
            if (w + cw > codeW) { out.push([]); w = 0; }
            var cur = out[out.length - 1], last = cur[cur.length - 1];
            if (last && last[1] === pc[1] && last[2] === co) last[0] += ch; else cur.push([ch, pc[1], co]);
            w += cw;
          });
        });
        if (!wrapOn && out.length > 1) { var txt = out[0].map(function (x) { return x[0]; }).join(""); out = [[[clip(txt + "…", codeW), 0, null]]]; }
        return out;
      };
      // 同 teyvat：「 17 +」再接代码（代码自己的缩进照留）；续行是「    +」接着写
      var line = function (t, num, pieces, cols) {
        chunks(pieces, cols).forEach(function (seg, k) {
          if (rows.length >= limit) return;
          var head = " " + (k ? " ".repeat(numW) : String(num).padStart(numW)) + " ", text = seg.map(function (x) { var s0 = x[1] ? "\uE015" + x[0] + "\uE016" : x[0]; return x[2] ? "\x1b[38;2;" + x[2] + "m" + s0 + "\x1b[39m" : s0; }).join("");
          if (t === " ") { rows.push(L + D + head + " " + RESET + text.replace(/[\uE015\uE016]/g, "")); return; }
          rows.push(L + (t === "+" ? "\uE010" : "\uE011") + "\uE013" + head + t + "\uE014" + text + "\uE012");
        });
      };
      for (var i = 0; i < dl.length && rows.length < limit; i++) {
        var d = dl[i];
        if (d.t === "…") { rows.push(L + D + " ".repeat(numW + 1) + "  …" + RESET); continue; }
        var text = String(d.l || "");
        // 一行删、紧跟一行加：改了的词再深一档
        var nx = dl[i + 1], pv = dl[i - 1], nx2 = dl[i + 2];
        if (d.t === "-" && nx && nx.t === "+" && (!pv || pv.t !== "-") && (!nx2 || nx2.t !== "+")) {
          var wd = wordDiff(text, String(nx.l || ""));
          if (wd) { line("-", d.n, wd[0], colsOf(d)); line("+", nx.n, wd[1], colsOf(nx)); i++; continue; }
        }
        line(d.t, d.n, [[text, 0]], colsOf(d));
      }
      var rest = dl.length - dl.slice(0, i).length;
      if (rest > 0) rows.push(L + D + HOT + "… +" + rest + " lines" + (V.style !== "teyvat" ? "" : " (ctrl+o to expand)") + HOT_END + RESET);
      return rows;
    }
    // 点折叠的一组：展开 / 收起
    P.term.addEventListener("click", function (e) {
      if (P.program !== V) return;
      var fa = e.target.closest && e.target.closest('a[href*="#vs-file:"]');
      if (fa) { e.preventDefault(); e.stopPropagation(); if (window.STUDIO) STUDIO.openFile(P.win, decodeURIComponent(fa.getAttribute("href").split("#vs-file:")[1])); return; } // 路径：在右侧打开
      if (String(document.getSelection()) || (e.target.closest && e.target.closest("a[href]"))) return;
      // 单独点开的那一条的细节（灰底）里任何地方：收起这一条（同别处点开的灰底那块）
      var idc = e.target.closest && e.target.closest(".gdet.idet"), ig = idc && idc.closest(".grp");
      if (ig) { idet[ig.dataset.key + ":" + idc.dataset.i] = false; var ti0 = rt.session().turns[parseInt(ig.dataset.key, 10)]; if (ti0) drawTurn(ti0); return; }
      // 标题（能点的那几个字）：展开 / 收起；译文 / 原文那一块里任何地方：换原文 / 译文；你点开的那一块（灰底）里任何地方：收起
      var g = e.target.closest && e.target.closest(".hot") && e.target.closest(".grp");
      if (!g) g = e.target.closest && e.target.closest(".grp.trsw");
      if (!g) g = e.target.closest && e.target.closest(".grp.uopen");
      if (!g) return;
      var hit0 = e.target.closest(".hitem");
      if (hit0) { var its0 = String(g.dataset.items || "").split(",").map(Number), k0 = Array.prototype.indexOf.call(g.querySelectorAll(".hitem"), hit0); if (k0 >= 0 && its0[k0] >= 0) { var ik = g.dataset.key + ":" + its0[k0]; idet[ik] = !idet[ik]; } } // 标题这一层：只开 / 收这一条的细节
      else if (e.target.closest(".hmore")) moreOpen[g.dataset.key] = !moreOpen[g.dataset.key]; // 「… +n more」：只列出 / 收起前面几条的标题
      else if (g.classList.contains("ccg") && g.classList.contains("done")) { // 跑完的一组：收着 ↔ 标题；全部细节开着（完整结果、ctrl+o 以外点开过的）就收起
        if (g.classList.contains("open")) { open[g.dataset.key] = false; tlv[g.dataset.key] = false; } else tlv[g.dataset.key] = !tlv[g.dataset.key];
      }
      else if (g.classList.contains("open")) { if (g.dataset.def && g.dataset.def !== "full") delete open[g.dataset.key]; else open[g.dataset.key] = false; } // 收起：回到设置的样子（预览就回到预览的那几行，不是收成只剩一行）；设置本来就是完整结果的才收成只看调用
      else open[g.dataset.key] = true; // 展开：完整
      var ti = parseInt(g.dataset.key, 10), t = rt.session().turns[ti];
      if (t) drawTurn(t);
    });

    // ---- 状态（对话末尾）：转圈、后台任务、排队的消息。末尾一行空行（与输入栏隔开，同 Claude Code）----
    // 转圈（同 Claude Code、teyvat 的 statebar）：· ✢ ✳ ✶ ✻ ✽ 来回，两头各多停一帧；120ms 一帧，按帧往下走（不按钟点算，漏了 tick 也不跳帧）
    var SPIN = ["·", "✢", "✳\uFE0E", "✶", "✻", "✽", "✽", "✻", "✶", "✳\uFE0E", "✢", "·"], SHINE = rgb("235;159;127"); // ✳ 后面带 U+FE0E（文字样式）：iPad、iPhone 上不带的话它画成绿底的 emoji ✳️
    // 转圈旁边的词：一道亮光从右往左扫过去（同 teyvat 的 shimmer：200ms 挪一格，亮三格，扫完歇一会儿）
    function shimmer(text, t0) {
      if (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(text)) return ORANGE + text + RESET; // 有中文的不走亮光：一段段换颜色时中文字一个一个往右蹦
      var ch = Array.from(text), n = ch.length, pos = Math.floor((Date.now() - t0) / 200), idx = n + 10 - (pos % (n + 20)), s0 = idx - 1, e0 = idx + 1;
      if (s0 >= n || e0 < 0) return ORANGE + text + RESET;
      var cs = Math.max(0, s0), ce = Math.min(n, e0 + 1);
      return ORANGE + ch.slice(0, cs).join("") + SHINE + ch.slice(cs, ce).join("") + ORANGE + ch.slice(ce).join("") + RESET;
    }
    // 任务清单（agent 用 TaskCreate / TaskUpdate 列的，同 Claude Code）：7 tasks (6 done, 1 in progress, 0 open)，◼ 在做、◻ 没开始、✔ 做完（灰、划掉）；ctrl+t 收起 / 展开
    var showTodo = cfg.taskList !== false;
    var trTask = function (x) { return x && window.TSU_TRANSLATE ? TSU_TRANSLATE.text(x, agentId) : x; }; // 任务翻译（translate.js）：任务的标题、在做时那一句
    function todoRows(r, D) {
      var list = rt.todo ? rt.todo() : [];
      if (!(window.STUDIO && STUDIO.todoShown ? STUDIO.todoShown(agentId) : showTodo) || !list.length || !list.some(function (x) { return x.status !== "completed"; })) return; // ⌃T 的开关记在 Studio（同一个 agent 在哪都一样）
      var done = list.filter(function (x) { return x.status === "completed"; }), doing = list.filter(function (x) { return x.status === "in_progress"; }), open = list.filter(function (x) { return x.status === "pending"; });
      var MAX = 6, head = doing.concat(open), shown = head.slice(0, MAX), room = Math.max(0, MAX - shown.length), w = P.cols - 6;
      if (V.style !== "teyvat") { // Claude Code 风格（同 Claude Code 转圈下面那一块）：⎿ ■ 在做的、□ 没做的；放不下的「… +2 pending, 72 completed」
        var sh5 = head.slice(0, 5), restP = open.length - sh5.filter(function (x) { return x.status === "pending"; }).length, more = [];
        sh5.forEach(function (x, i) { r.text([(i ? "     " : "  " + D + "⎿" + RESET + "  ") + (x.status === "in_progress" ? BOLD + "■ " + clip(trTask(x.subject), w) + RESET : D + "□ " + RESET + clip(trTask(x.subject), w))]); });
        if (restP > 0) more.push(restP + " pending");
        if (done.length) more.push(done.length + " completed");
        if (more.length) r.text(["      " + D + "… +" + more.join(", ") + RESET]);
        return;
      }
      r.text(["", "  " + D + F.plural(list.length, "task") + " (" + done.length + " done, " + doing.length + " in progress, " + open.length + " open)" + RESET]);
      shown.forEach(function (x) { r.text(["  " + (x.status === "in_progress" ? BOLD + "◼ " + clip(trTask(x.subject), w) : "◻ " + clip(trTask(x.subject), w)) + RESET]); });
      done.slice(0, room).forEach(function (x) { r.text(["  " + D + "✔ " + ESC + "[9m" + clip(trTask(x.subject), w) + RESET]); });
      if (head.length > shown.length) r.text(["   " + D + "… +" + (head.length - shown.length) + " open" + RESET]);
      if (done.length > room) r.text(["   " + D + "… +" + (done.length - room) + " completed" + RESET]);
    }
    // 转圈旁边的词：有任务在做就用它的 activeForm（同 Claude Code：「Running the tests…」），没有就是这一问随机的那个词
    function spinLabel(s) {
      var act = (rt.todo ? rt.todo() : []).filter(function (x) { return x.status === "in_progress" && x.activeForm; })[0];
      return act ? trTask(act.activeForm) : s.verb;
    }
    // Studio（studio.js）的元素：任务、状态交出去（放哪由 Studio 定：行内就还是这里画），视图（每种块怎么显示）放在右侧
    function publish() {
      if (!window.STUDIO || P.program !== V || P.side) return; // 右侧栏里的这份不交（状态栏、右侧栏看编辑区里的那份）
      var s = rt.stream, items = (rt.todo ? rt.todo() : []).map(function (x) { return { id: x.id, subject: x.subject, status: x.status, activeForm: x.activeForm }; });
      if (items.length && items.some(function (x) { return x.status !== "completed"; })) STUDIO.set(P, { id: "tasks", type: "tasks", site: "paimon", data: { items: items } });
      else STUDIO.remove(P, "tasks");
      STUDIO.set(P, { id: "status", type: "status", site: "paimon", title: agent.name, data: s ? { busy: true, label: spinLabel(s), t0: s.t0, detail: (s.thinking ? "thinking" : "") + (agent.effort && agent.effort !== "off" ? (s.thinking ? " with " : "") + agent.effort + " effort" : "") } : { busy: false, label: "空闲" } });
      STUDIO.set(P, { id: "view", type: "form", site: "paimon", title: "对话", fields: viewFields, change: viewChange });
    }
    function viewFields() { return convFields(P); } // 同 设置 › 对话：消息、回答、思考、你的 ! 命令、图片；工具每类的档位；系统；任务清单、状态行放哪
    function viewChange(k, v) {
      if (k === "$preset" || k === "minimap") return convChange(k, v); // 视图预设、缩略图：同 设置 › 对话
      if (k === "tasks" || k === "status") { STUDIO.place("paimon", k, v); renderStatus(); P.fit(); return; }
      if (k === "agentMsgs") return accGlobal.setMode(k, v); // Agent 消息的「全部」：单独设的都回到继承
      if (A.setCfg(k, v)) allPanes().forEach(function (p) { p.renderNow(); });
    }
    // 压缩进度（同 Claude Code 转圈下面那条：开始压缩以来 ms 毫秒 → 百分比，最多 95）
    function compactPct(ms) { return Math.min(95, Math.round((1 - Math.exp(-Math.max(0, ms) / 90000)) * 100)); }
    // 它在想吗（同 Claude Code 转圈那一行：「thinking with max effort」→ still thinking → thinking more → thinking some more → deep in thought）：
    //   自己起的（claude -p）看流里的 s.thinking；别处跑的 Claude Code 会话看记录——最后一条是要它回的（你的话、工具结果）、它还没写出东西（claude.js 的 rt.thinkSince）。
    //   effort：会话自己的，没有就是 Claude Code 设置里的（~/.claude/settings.json）
    function thinkT0(s) { return s && s.thinking ? s.thinkAt || Date.now() : rt.thinkSince ? rt.thinkSince() : 0; }
    function thinkPhrase(s) {
      var t0 = thinkT0(s);
      if (!t0) return "";
      var eff = agent.effort || (agent.claude && window.STUDIO && STUDIO.ccEffort ? STUDIO.ccEffort(agent.model) : "");
      var ms = Date.now() - t0; // 同 Claude Code：想了 10 / 20 / 30 / 45 秒起换说法
      return (ms >= 45000 ? "deep in thought" : ms >= 30000 ? "thinking some more" : ms >= 20000 ? "thinking more" : ms >= 10000 ? "still thinking" : "thinking") + (eff && eff !== "off" ? " with " + eff + " effort" : "");
    }
    // 在想的那几个字的颜色（同 Claude Code 2.1.281 转圈那一行的 thinking：Ko）：前 3 秒 153 灰，之后在 153 和 185 灰之间 2 秒一个来回；
    //   想了 10 秒起往警告黄过渡，20 秒全黄。只有这几个字变——前面转圈的字、动词照常（橙色、闪光），不跟着变黄
    //   t0：这一段开始想的时刻；sinceT：转圈从什么时候起（呼吸按它算）
    function thinkTint(t0, sinceT) {
      var now = Date.now(), v = t0 ? Math.min(1, Math.max(0, (now - t0 - 10000) / 10000)) : 0;
      var g = P.light ? 102 : 153, W = P.light ? [150, 108, 30] : [255, 193, 7]; // 没变黄时同括号里别的字一个颜色（照 iTerm2 里 Claude Code 采的：153 灰），不发白
      return rgb(W.map(function (w) { return Math.round(g + (w - g) * v); }).join(";"));
    }
    // 转圈那一行括号里的字（用时、token、thought for…）、压缩进度的百分比：同 Claude Code 在 iTerm2 里（采样 153 灰；浅色 102）——比别处的淡字亮一档
    function statusDim() { return P.light ? rgb("102;102;102") : rgb("153;153;153"); }
    // 在跑的那一行、排着的、后台任务、目标——画成底部的几行（在输入框上面，同一块底部里；排着的那句是「❯ 原话」+ 一行淡的说明）
    function workRows(fcols, indent) {
      var out = [], s = rt.stream, D = P.DIM, w = Math.max(20, fcols - indent.length - 4), spinHere = !window.STUDIO || STUDIO.inline(P, "status");
      if (agent.claude && rt.question && rt.question() && panel && panel.kind === "ask") { out.push(indent + D + "✻ Waiting for your answer…" + RESET); return out; } // 在等你回答（问答面板开着）：状态行就写在等你
      var bg = rt.tasks.filter(function (x) { return x.status === "running"; }).length, wl = vmode("workLine");
      // 排着的一句：「❯ 原话」（原样的颜色：这是你已经发出去的话，它下一步读到），太长的收成「… +n lines」；提示只在最后一句下面写一次（同 Claude Code）
      var quote = function (text) { var pl = []; String(text || "").split("\n").forEach(function (p0) { pl.push.apply(pl, wrap(p0, w)); }); pl.slice(0, 6).forEach(function (l, i) { out.push(indent + (i ? "  " : "❯ ") + l); }); if (pl.length > 6) out.push(indent + "  " + D + "… +" + (pl.length - 6) + " lines" + RESET); };
      if (s && spinHere && wl !== "hidden") {
        var st0 = s.turn || {}, secs = Math.floor((Date.now() - s.t0) / 1000), n = Math.max(s.outTokens || 0, Math.ceil((String(st0.answer || "").length + String(st0.thinking || "").length) / 1.3));
        var SD = statusDim(), tph = thinkPhrase(s), phase = !s.firstAt ? " · waiting for the model" : tph ? " · " + thinkTint(thinkT0(s), s.t0) + tph + RESET + SD : "", took = secs < 60 ? secs + "s" : F.dur(secs * 1000); // 在想的那几个字（同 Claude Code：灰、想久了变黄），前面的「·」同括号里的字
        var cp = rt.compacting;
        if (cp) { // 在压缩上下文（同 Claude Code：「Compacting conversation…」，下面一条进度条 + 百分比）
          // 百分比同 Claude Code 自己的算法：开始压缩以来 t 秒 → (1 − e^(−t/90))，最多 95%，只涨不落；括号里同它那一行（这一问的用时、写了多少 token）
          var cpct = Math.max(cp.pct || 0, compactPct(Date.now() - cp.since)), BW = Math.max(8, Math.min(40, w - 8)), fl = Math.round(BW * cpct / 100);
          var SD0 = statusDim();
          out.push(indent + LAV + SPIN[tickN % SPIN.length] + " Compacting conversation…" + RESET + SD0 + " (" + (cp.paren || took + (n > 0 ? " · ↓ " + F.k(n) + " tokens" : "")) + ")" + RESET);
          out.push(indent + "  " + LAV + "▰".repeat(fl) + RESET + SD0 + "▱".repeat(BW - fl) + " " + cpct + "%" + RESET);
        } else
        if (s.wait) { var left = Math.max(0, Math.ceil((s.wait.until - Date.now()) / 1000)); out.push(indent + RED + SPIN[Math.floor(Date.now() / 120) % SPIN.length] + (wl === "brief" ? " retry in " + left + "s" + RESET : " Waiting for API response" + RESET + D + " · will retry in " + left + "s (attempt " + s.wait.attempt + "/" + s.wait.max + ")" + RESET)); }
        else if (wl === "brief") out.push(indent + ORANGE + SPIN[tickN % SPIN.length] + " " + RESET + D + took + RESET);
        else {
          var pend = V.style !== "teyvat" && rt.pending ? rt.pending() : null;
          // 后台会话：它自己屏幕上那一行读得到（claude.js 的 rt.native）——词、用时、token、状态照它的；读不到才按记录估
          // 在想：只有括号里 thinking 那几个字变色（thinkTint：灰，想久了变黄）；转圈的字、动词照常橙色闪光（同 Claude Code）
          var nv = rt.native && Date.now() - rt.native.at < 4000 ? rt.native : null;
          // 词：有在做的任务就用任务自己的说法（同 Claude Code 转圈那一行写的就是它），不从它屏幕上抠——它的亮光一格格重画，中文抠出来常缺几个字，看着一个一个往外蹦
          var actT = (rt.todo ? rt.todo() : []).some(function (x) { return x.status === "in_progress" && x.activeForm; });
          var nx = nv && nv.extra ? " · " + (nv.thinkAt ? thinkTint(nv.thinkAt, s.t0) + nv.extra + RESET + SD : nv.extra) : "", lab0 = (nv && nv.label && !actT ? nv.label : spinLabel(s)) + "…";
          out.push(indent + ORANGE + SPIN[tickN % SPIN.length] + " " + RESET + shimmer(lab0, s.t0) + SD + " (" + (nv ? (nv.time || took) + (nv.tokens ? " · " + nv.tokens : "") + nx : took + (n > 0 ? " · ↓ " + F.k(n) + " tokens" : "") + phase) + escHint() + ")" + RESET + (!pend && rt.pendingMsgs && rt.pendingMsgs() ? " " + LAV + F.plural(rt.pendingMsgs(), "msg") + " pending" + RESET : ""));
          // （排着的那几句画在对话最后——发了就是到上面，见 renderStatus）
        }
      }
      // 闲着：转圈那一行换成最后一问做完的那行（同 Claude Code：✻ Baked for 18m 16s · done 12:07 PM · 1 shell still running）
      if (!s && spinHere && wl !== "hidden") {
        var ld = lastDone(), dlf = ld ? doneLine(ld, true) : "";
        if (!dlf) { var li = lastAsk(); if (li && /^Interrupted/.test(li.error || "")) dlf = P.DIM + "Interrupted · " + timeOf(li.last || li.at) + RESET; } // 打断了的那一问没有「用了多久」：写 Interrupted 和时间，不空着
        if (dlf) out.push(indent + dlf);
      }
      // （rt.queued 也画在对话最后）
      var aq = agent.claude && rt.question ? rt.question() : null; // 它在问你、问答面板收起着：一行提示（↑ 或点它打开）
      if (aq && !(panel && panel.kind === "ask")) out.push(indent + LAV + "? " + RESET + "Claude is asking: " + clip(String(aq.questions[0].question || ""), Math.max(10, fcols - 40)) + D + " · press ↑ to answer" + RESET);
      var g = agent.claude ? null : agent.goal; // Claude Code 的会话：/goal 在右侧栏最上面
      if (g) out.push(indent + CYAN + "◎ " + RESET + D + "Goal: " + clip(g.text, Math.max(10, fcols - 40)) + (g.checking ? " · checking…" : g.paused ? " · paused" : g.iterations ? " · check " + g.iterations : "") + " · /goal clear" + RESET);
      return out; // 下面紧接着状态行，不另空一行（底部不留一大块空）
    }
    function renderStatus() {
      if (!statusEl) return;
      if (P.off) { statusStale = true; return; }
      publish();
      try { askWatch(); } catch (e) { /* 问答面板出错不挡状态行 */ }
      if (P.compAway()) { statusEl.innerHTML = ""; return; } // 转圈、任务清单这些跟着输入框（在右侧栏）
      if (fsash) { // 标签页自己的底部：在跑的那一行画在底部里（workRows）；发出去、它还没读到的那几句画在对话最后（发了就是到上面，不在底部）
        var rq = new P.Rows(), D0 = P.DIM, pq = V.style !== "teyvat" && rt.pending ? rt.pending().slice() : [];
        if (rt.queued) pq.push({ text: rt.queued.text });
        pendRows(rq, pq, D0);
        // 最后总留一行空行：对话区最底下那一行被 .botgap（贴底的一行底色）盖着——没有这行空行，盖住的就是最后一问的最后一行
        //   （最后一张 [Image #N]、回复的最后一行、「ctrl+x ctrl+s to send now」都会看不见，等下一条来了往上挪才露出来）
        var qh = P.join(rq.text([""]).flush().rows);
        if (statusEl.innerHTML !== qh) statusEl.innerHTML = qh;
        statusEl.classList.remove("live");
        renderInput(); return;
      }
      var r = new P.Rows(), s = rt.stream, D = P.DIM, spinHere = !window.STUDIO || STUDIO.inline(P, "status");
      var bg = rt.tasks.filter(function (x) { return x.status === "running"; }).length;
      if (s && spinHere) {
        // Claude Code 的会话（claude.js）流里的这一问是会话记录里的样子：没有 answer / thinking 两段字，别当它有（不然整个重排在这里断掉，宽度变了也不重排）
        var st0 = s.turn || {}, secs = Math.floor((Date.now() - s.t0) / 1000), n = Math.max(s.outTokens || 0, Math.ceil((String(st0.answer || "").length + String(st0.thinking || "").length) / 1.3));
        var SD = statusDim(), tph = thinkPhrase(s), phase = !s.firstAt ? " · waiting for the model" : tph ? " · " + thinkTint(thinkT0(s), s.t0) + tph + RESET + SD : "";
        var wl = vmode("workLine"), took = secs < 60 ? secs + "s" : F.dur(secs * 1000); // 运行状态行：完整 / 简洁（转圈和用时）/ 隐藏
        if (wl === "hidden") { /* 不画这一行：Esc 照样能打断，标签页的图标照样在转 */ }
        else if (s.wait) { // 这一次没成、等着重试（同 Claude Code：红的）
          var left = Math.max(0, Math.ceil((s.wait.until - Date.now()) / 1000));
          r.text(["", RED + SPIN[Math.floor(Date.now() / 120) % SPIN.length] + (wl === "brief" ? " retry in " + left + "s" + RESET : " Waiting for API response" + RESET + D + " · will retry in " + left + "s (attempt " + s.wait.attempt + "/" + s.wait.max + ")" + RESET)]);
        } else if (wl === "brief") r.text(["", ORANGE + SPIN[tickN % SPIN.length] + " " + RESET + D + took + RESET]);
        else {
          // Claude Code 风格：排着还没被读到的几句（它自己记的队 + 这边送进去的）画在转圈上面——灰底的「❯ 原话」，下面一行淡的说明（同 Claude Code）
          var pend = V.style !== "teyvat" && rt.pending ? rt.pending() : null;
          r.text(["", ORANGE + SPIN[tickN % SPIN.length] + " " + RESET + shimmer(spinLabel(s) + "…", s.t0) + SD + " (" + took + (n > 0 ? " · ↓ " + F.k(n) + " tokens" : "") + phase + escHint() + ")" + RESET +
            (!pend && rt.pendingMsgs && rt.pendingMsgs() ? " " + LAV + F.plural(rt.pendingMsgs(), "msg") + " pending" + RESET : "")]);
          // 排着的几句（已经发出去、它下一步读到）：转圈下面「❯ 原话」，最后一行淡的「ctrl+x ctrl+s to send now」（同 Claude Code；ctrl+enter 也行）
          if (pend && pend.length) pendRows(r, pend, D);
        }
        if (rt.queued) {
          r.text([""]);
          var ql = [];
          rt.queued.text.split("\n").forEach(function (p) { ql.push.apply(ql, wrap(p, P.cols - 2)); });
          r.block('<span class="ask">' + P.toHtml(ql.map(function (l, i) { return pad((i ? "  " : D + "❯" + RESET + " ") + l, P.cols); })) + "</span>");
          r.block(sendNowRow(D, " · esc to edit"));
        }
      }
      if (s && !spinHere && rt.queued) r.text([""]).block(sendNowRow(D, " · esc to edit"));
      if (!window.STUDIO || STUDIO.inline(P, "tasks")) todoRows(r, D);
      var g = agent.goal;
      if (g) r.text(["", CYAN + "◎ " + RESET + D + "Goal: " + clip(g.text, P.cols - 36) + (g.checking ? " · checking…" : g.paused ? " · paused" : g.iterations ? " · check " + g.iterations : "") + " · /goal clear" + RESET]);
      var live = r.flush().rows.length > 0; // 有在跑的那一行、排着的、后台任务、目标：钉在输入框上面（往上翻看记录时也看得见，同 agent 底部；tdrawer.css）
      r.text([""]);
      statusEl.innerHTML = P.join(r.flush().rows);
      statusEl.classList.toggle("live", live);
    }

    // ---- 输入栏：上下两条灰线（上面那条右边是 agent 的名字）；下面是状态线、权限档位（右边是上下文占用）----
    function statusFields() {
      var me = A.me(), m = rt.model(), out = [];
      (cfg.statusline || []).forEach(function (f) {
        if (f === "model" && m) out.push(m.name);
        if (f === "balance" && me && me.allowed) out.push("Balance: " + F.money(me.balance));
        if (f === "cost") out.push("Session: " + F.money(rt.cost()));
        if (f === "cwd") out.push(rt.cwd());
        if (f === "access") out.push("Access: " + (agent.access || "read"));
      });
      return out.join(" | ");
    }
    // Claude Code 的会话：斜杠菜单是 Claude Code 自己的命令（名字、说明照它的；commands/ 里抄的）+ 你的技能（~/.claude/skills）——不列 Paimon 的 agent
    var CC_CMDS = [["add-dir", "Add a new working directory"], ["agents", "Manage agent configurations"], ["branch", "Create a branch of the current conversation at this point"], ["btw", "Ask a quick side question without interrupting the main conversation"],
      ["clear", "Clear conversation history and free up context"], ["compact", "Clear conversation history but keep a summary in context. Optional: /compact [instructions for summarization]"], ["config", "Open config panel"], ["context", "Show current context usage"],
      ["copy", "Copy Claude's last response to clipboard (or /copy N for the Nth-latest)"], ["cost", "Show the total cost and duration of the current session"], ["diff", "View uncommitted changes and per-turn diffs"], ["doctor", "Diagnose and verify your Claude Code installation and settings"],
      ["effort", "Set effort level for model usage"], ["exit", "Exit the REPL"], ["export", "Export the current conversation to a file or clipboard"], ["files", "List all files currently in context"], ["goal", "Set a goal: keep working until the condition is met"],
      ["help", "Show help and available commands"], ["hooks", "View hook configurations for tool events"], ["init", "Initialize a new CLAUDE.md file with codebase documentation"], ["mcp", "Manage MCP servers"], ["memory", "Edit Claude memory files"],
      ["model", "Set the AI model for Claude Code"], ["permissions", "Manage allow & deny tool permission rules"], ["plan", "Enable plan mode or view the current session plan"], ["plugin", "Manage Claude Code plugins"], ["pr-comments", "Get comments from a GitHub pull request"],
      ["release-notes", "View release notes"], ["rename", "Rename the current conversation"], ["resume", "Resume a previous conversation"], ["review", "Review a pull request"], ["rewind", "Restore the code and/or conversation to a previous point"],
      ["security-review", "Complete a security review of the pending changes on the current branch"], ["skills", "List available skills"], ["stats", "Show your Claude Code usage statistics and activity"], ["status", "Show Claude Code status including version, model, account, API connectivity, and tool statuses"],
      ["statusline", "Set up Claude Code's status line UI"], ["tasks", "List and manage background tasks"], ["todos", "List current todo items"], ["usage", "Show plan usage limits"], ["vim", "Toggle between Vim and Normal editing modes"]];
    // Codex 的会话：斜杠菜单是 Codex 自己的命令（说明照它 TUI 的）+ 你的提示词（~/.codex/prompts/*.md → /prompts:名字）
    var CX_CMDS = [["model", "choose what model and reasoning effort to use"], ["effort", "set reasoning effort: minimal / low / medium / high / xhigh"], ["review", "review my current changes and find issues"],
      ["rename", "rename the current thread"], ["new", "start a new chat during a conversation"], ["fork", "fork the current chat"], ["init", "create an AGENTS.md file with instructions for Codex"],
      ["compact", "summarize conversation to prevent hitting the context limit"], ["goal", "set a goal for this thread (/goal clear to clear)"], ["diff", "show git diff (including untracked files)"],
      ["status", "show current session configuration and token usage"], ["mcp", "list configured MCP tools"], ["quit", "exit Codex"]];
    var cxPrompts = null;
    function loadCxPrompts() {
      if (cxPrompts || !window.TSU_LOCAL || !TSU_LOCAL.list) return;
      cxPrompts = [];
      var home = (TSU_LOCAL.info() || {}).home || "";
      TSU_LOCAL.list(home + "/.codex/prompts").then(function (fs) {
        (Array.isArray(fs) ? fs : []).filter(function (f) { return !f.dir && /\.md$/.test(f.name); }).slice(0, 200).forEach(function (f) {
          TSU_LOCAL.read(home + "/.codex/prompts/" + f.name).then(function (b) {
            var t = new TextDecoder().decode(new Uint8Array(b)).slice(0, 4000), m = /^---[\s\S]*?\ndescription:\s*(.+)/m.exec(t);
            cxPrompts.push([f.name.replace(/\.md$/, ""), m ? m[1].replace(/^["']|["']$/g, "").trim() : t.replace(/^---[\s\S]*?\n---\n/, "").trim().split("\n")[0].slice(0, 80)]);
          }, function () {});
        });
      }, function () {});
    }
    var ccSkills = null;
    function loadSkills() {
      if (ccSkills || !window.TSU_LOCAL || !TSU_LOCAL.list) return;
      ccSkills = [];
      var home = (TSU_LOCAL.info() || {}).home || "";
      TSU_LOCAL.list(home + "/.claude/skills").then(function (ds) {
        (Array.isArray(ds) ? ds : []).filter(function (d) { return d.dir; }).slice(0, 200).forEach(function (d) {
          TSU_LOCAL.read(home + "/.claude/skills/" + d.name + "/SKILL.md").then(function (b) {
            var t = new TextDecoder().decode(new Uint8Array(b)).slice(0, 4000), m = /^---[\s\S]*?\ndescription:\s*(.+)/m.exec(t);
            ccSkills.push([d.name, m ? m[1].replace(/^["']|["']$/g, "").trim() : "(skill)"]);
          }, function () {});
        });
      }, function () {});
    }
    function menuItems() {
      var v = P.ta.value;
      if (!/^\/\S*$/.test(v)) return [];
      if (agent.claude) {
        if (agent.connector === "codex") loadCxPrompts(); else loadSkills();
        var q = v.slice(1).toLowerCase(), all = agent.connector === "codex" ? CX_CMDS.concat((cxPrompts || []).map(function (x) { return ["prompts:" + x[0], x[1] + " (prompt)"]; })) : CC_CMDS.concat((ccSkills || []).map(function (x) { return [x[0], x[1] + " (skill)"]; }));
        return all.filter(function (c) { return c[0].toLowerCase().indexOf(q) === 0; }).concat(q ? all.filter(function (c) { return c[0].toLowerCase().indexOf(q) > 0; }) : []).map(function (c) { return { name: "/" + c[0], desc: c[1], cc: true }; });
      }
      var ags = A.list().filter(function (a) { return a.id !== agentId; }).map(function (a) { return { name: "/" + a.name, desc: "切换到 " + a.name + "（" + A.runtime(a.id).state() + "）" }; });
      return COMMANDS.concat(ags).filter(function (c) { return (!c.admin || (A.me() || {}).admin) && c.name.toLowerCase().indexOf(v.toLowerCase()) === 0; });
    }
    var lastFootRows = -1;
    // 子 agent 不在底部了：回到右边的辅助侧栏（任务清单 → 后台任务 → 子 Agent 一家子，studio.js familyHtml）。底部只有在跑的那一行（+ 排着的）、输入框、状态行
    var hms = function (ms) { var s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60); return h ? h + "h " + (m % 60) + "m " + (s % 60) + "s" : m ? m + "m " + (s % 60) + "s" : s + "s"; };
    var footVpad = -1; // 底部上下的内边距 + 边框（拖出来的高度按它算能放几行）
    var inputStale = false, statusStale = false;
    // 藏在同一组后面的（content-visibility:hidden）：不画输入框、状态行——在那里量尺寸会把整块藏着的对话强行排版一遍（切走时失焦那一下就要二十多毫秒）；露出来时补画
    V.unpark = function () { if (inputStale) { inputStale = false; renderInput(); } if (statusStale) { statusStale = false; renderStatus(); } ccWatch(); };
    var needsAid = ""; // 底部「● N awaiting input」点了去的那个会话
    function renderInput() {
      if (P.off) { inputStale = true; return; }
      var fW = P.foot.clientWidth, fcols = Math.max(24, Math.floor(fW / P.chPx) || P.cols), indent = " ".repeat(Math.round(P.padL / P.chPx)), me = A.me(), D = P.DIM;
      // 输入框上下两条线左右对称：排不满一格的那点余量左右各留一半（以前全剩在右边：左边贴着边、右边空出一截）；右上角「···」对到线的右端
      if (fsash && fW) {
        var fpad = Math.floor(fW - fcols * P.chPx) / 2, fpx = fpad + "px", mr = Math.max(0, fpad + (4 * P.chPx - 24) / 2).toFixed(1) + "px"; // 「···」24px 宽，摆在给它留的最后 4 格正中
        if (P.foot.style.paddingLeft !== fpx) P.foot.style.paddingLeft = fpx;
        if (fmore && fmore.style.right !== mr) fmore.style.right = mr;
      }
      if (panel && !ABOVE[panel.kind]) return renderPanel(fcols, indent);
      var label = " " + agent.name + " ", ta = P.ta, v = ta.value, bang = v[0] === "!", lineCol = bang ? PINK : D;
      // 最右边留 4 格给「···」按钮（绝对定位在这一行的右端）：名字、线都不被它压着
      var top = fsash ? lineCol + "─".repeat(Math.max(2, fcols - W(label) - 4)) + RESET + D + label + RESET + "    " : lineCol + "─".repeat(Math.max(2, fcols - W(label) - 2)) + RESET + D + label + RESET + lineCol + "──" + RESET;
      var lines, caretRow = 1, caretCol = indent.length + 2, textW = fcols - indent.length - 4;
      // 附的图就在字里：粘贴、拖进来时在光标处插一个「[Image #N]」（同 Claude Code），跟着字一起折行、能在任何位置——不再另外排在最前面
      var chips = "", preRows = [];
      var fresh = !rt.session().turns.some(function (t) { return t.ask !== undefined || t.bash !== undefined; });
      var placeholder = agent.claude && rt.localQueued && rt.localQueued() ? "Press up to edit queued messages" : uiT(!me ? "" : !me.loggedIn ? "按 Enter 使用 GitHub 登录" : !me.allowed ? "账号尚未获得邀请" : fresh ? "向 " + agent.name + " 发送消息" + (cfg.tips ? "，输入 ! 执行命令，输入 / 查看命令" : "") : "");
      if (!v) { lines = preRows.concat([chips + D + placeholder + RESET]); caretRow += preRows.length; caretCol += W(chips); }
      else {
        // 光标在选区「动的那一头」（shift+← 往左选：在左边；拖着往右选：在右边）
        var hasSel = ta.selectionEnd > ta.selectionStart, fpos = hasSel && ta.selectionDirection !== "backward" ? ta.selectionEnd : ta.selectionStart;
        var shown = bang ? v.slice(1) : v, off = bang ? 1 : 0, wl = wrapKeep(shown, textW, W(chips)), pos = Math.max(0, fpos - off);
        var ia = P.ime && P.ime.text ? P.ime.start - off : -1, ib = ia >= 0 ? ia + P.ime.text.length : -1; // 输入法还没选定的字（拼音）：下划线，同系统的输入框
        var sa0 = hasSel && ia < 0 ? ta.selectionStart - off : -1, sb0 = hasSel ? ta.selectionEnd - off : -1, SELBG = P.light ? "\x1b[48;2;173;214;255m" : "\x1b[48;2;38;79;120m"; // 选中的字：同 VS Code 的选区底色
        lines = wl.map(function (l, i) {
          var t = l.text, a = Math.max(0, ia - l.start), b = Math.min(t.length, ib - l.start);
          if (ia >= 0 && b > a) t = t.slice(0, a) + "\x1b[4m" + t.slice(a, b) + "\x1b[24m" + t.slice(b);
          else if (sa0 >= 0) { var c0 = Math.max(0, sa0 - l.start), c1 = Math.min(t.length, sb0 - l.start); if (c1 > c0) t = t.slice(0, c0) + SELBG + t.slice(c0, c1) + "\x1b[49m" + t.slice(c1); }
          return (i ? "" : chips) + t;
        });
        lines = preRows.concat(lines);
        inMap = { wl: wl, shown: shown, off: off, textCol: indent.length + 2, chipsW: W(chips), pre: preRows.length };
        for (var i = 0; i < wl.length; i++) {
          var nx = wl[i + 1];
          if (!nx || pos < nx.start) { caretRow = 1 + preRows.length + i; caretCol = indent.length + 2 + (i ? 0 : W(chips)) + W(shown.slice(wl[i].start, Math.max(wl[i].start, pos))); break; }
        }
      }
      var prompt = bang ? PINK + "!" + RESET + " " : "❯ ";
      if (!v) inMap = null;
      var rows = [top].concat(lines.map(function (l, i) { return indent + (i ? "  " : prompt) + l; }), [lineCol + "─".repeat(fcols) + RESET]);
      var inputLen = rows.length; // 输入框这一块（上下两条线和中间的字）有几行：在跑的那一行接在它下面
      // 状态信息（权限级别、余额、上下文、模型、在哪跑）在 agent 的底部、输入框下面（同 Claude Code；位置定死，有规律）——窗口底部的状态栏只放工作区的东西。
      // 显示不显示：设置 › 对话 › 显示 › 状态信息、对话 ··· › 显示（cfg.footInfo）
      var toBar = false, footInfo = cfg.footInfo !== false;
      if (window.STUDIO && STUDIO.remove) { STUDIO.remove(P, "access"); STUDIO.remove(P, "statusline"); STUDIO.remove(P, "where"); }
      if (agent.claude && toBar) {
        // 连接器的会话（Claude Code、Codex）：在别处跑的，状态栏上一个短词（后台 / 另一个终端），不是一句话
        var tok0 = connWhere();
        if (tok0) STUDIO.set(P, { id: "where", type: "text", site: "claude", title: rt.label || "Claude Code", left: true, data: { text: tok0, cls: "st-dim" } }); else STUDIO.remove(P, "where");
      } else if (agent.claude && footInfo) { islandCount(); rows.push.apply(rows, connFoot(indent, fcols)); } // 同 Claude Code 最下面那两行
      if (!agent.claude && toBar) {
        var sl0 = statusFields(), acc0 = ACCESS_LABEL[agent.access || "read"], run0 = rt.tasks.filter(function (x) { return x.status === "running"; }), sh0 = run0.filter(function (x) { return x.kind === "shell"; }).length;
        STUDIO.set(P, { id: "access", type: "text", site: "paimon", title: "权限级别", left: true, data: { text: "⏵⏵ " + acc0[1] + (sh0 ? " · " + F.plural(sh0, "shell") : "") + (run0.length - sh0 ? " · " + F.plural(run0.length - sh0, "agent") : "") }, click: function () { rt.setAccess({ none: "read", read: "rw", rw: "none" }[agent.access || "read"]); } });
        if (sl0) STUDIO.set(P, { id: "statusline", type: "text", site: "paimon", title: "信息", data: { text: sl0, cls: "st-dim" } }); else STUDIO.remove(P, "statusline");
      }
      if (!agent.claude && !toBar && footInfo) {
      var sl = statusFields();
      if (sl) rows.push(indent + "  " + D + sl + RESET);
      // 权限档位；上下文占用在同一行右对齐。放不下先省掉「(shift+tab to cycle)」，再放不下就不显示占用
      var acc = ACCESS_LABEL[agent.access || "read"], base = indent + "  " + acc[0] + "⏵⏵ " + acc[1] + RESET, hintS = D + " (shift+tab to cycle)" + RESET;
      var runningT = rt.tasks.filter(function (x) { return x.status === "running"; }), nSh = runningT.filter(function (x) { return x.kind === "shell"; }).length, nAg = runningT.length - nSh;
      var tasksS = (nSh ? D + " · " + RESET + CYAN + F.plural(nSh, "shell") + RESET : "") + (nAg ? D + " · " + RESET + CYAN + F.plural(nAg, "agent") + RESET : "");
      base += tasksS;
      var left = base + hintS;
      if ((cfg.statusline || []).indexOf("context") >= 0) {
        var c = rt.ctx(), ctxs = "Ctx: " + (c.pct < 10 ? c.pct.toFixed(1) : Math.round(c.pct)) + "%";
        if (W(left) + W(ctxs) + 3 > fcols) left = base;
        if (W(left) + W(ctxs) + 3 <= fcols) left += " ".repeat(fcols - W(left) - W(ctxs) - 1) + D + ctxs + RESET;
      }
      rows.push(left);
      }
      // 输入框上面：打开着的选项面板，或者斜杠菜单（最多 6 项，跟着选中的滚；说明最多两行）
      var above = [];
      if (panel) { panel.map = {}; above = panelAbove(fcols, indent); Object.keys(panel.map).forEach(function () {}); }
      else {
        var items = menuItems();
        if (items.length) {
          menuIdx = Math.min(menuIdx, items.length - 1);
          var MAXI = 6, first = Math.max(0, Math.min(menuIdx - 2, items.length - MAXI)), nameW = Math.min(28, Math.max(16, Math.max.apply(null, items.map(function (c) { return W(c.name + (c.args ? " " + uiT(c.args) : "")); })) + 3)), descW = Math.max(10, fcols - indent.length - 3 - nameW);
          items.slice(first, first + MAXI).forEach(function (c, j) {
            var on = first + j === menuIdx, col = on ? LAV : D, dl = wrap(enLang() && TSU_I18N.t ? TSU_I18N.t(c.desc) : c.desc, descW); // 画在终端的格子里（i18n 不看这里）：英文时自己查词典
            if (dl.length > 2) { var sp0 = enLang() ? " " : ""; dl = [dl[0], clip(dl[1] + sp0 + dl.slice(2).join(sp0), descW)]; } // 英文：拼回去要带空格
            dl.forEach(function (l, k) { above.push(indent + "  " + (k ? " ".repeat(nameW) : col + pad(c.name + (c.args ? " " + uiT(c.args) : ""), nameW) + RESET) + col + l + RESET); });
          });
        }
      }
      var work = fsash && !panel ? workRows(fcols, indent) : []; // 在跑的那一行、排着的：接在输入框下面（状态行上面）
      // 全屏只看对话（手机）：输入框贴到最下面——在跑的那一行挪到输入框上面，状态信息那两行不要（下面不留一截）
      var focusNow = root.classList.contains("st-focus");
      if (focusNow) { above = above.concat(work); work = []; rows = rows.slice(0, inputLen); }
      rows = above.concat(rows.slice(0, inputLen), work, rows.slice(inputLen));
      caretRow += above.length;
      if (inMap) inMap.row0 = above.length + 1; // 字的第一行在底部的第几行（上面是面板 / 菜单、再上面一条线）
      // 拖出来的高度（拖着的时候用拖到哪儿）：最矮 = 现在这些行，最高这一格的 70%；多出来的地方给输入框（输入框变高，同 VS Code 聊天的输入框），状态行还在最下面
      var fh0 = 0 /* 自动高度：不按拖过的高度 */, fcs = fh0 > 0 ? getComputedStyle(P.foot) : null;
      var vpad = fcs ? (parseFloat(fcs.paddingTop) || 0) + (parseFloat(fcs.paddingBottom) || 0) + (parseFloat(fcs.borderTopWidth) || 0) + (parseFloat(fcs.borderBottomWidth) || 0) : 8; // 拖出来的是整个底部的高度（含内边距、上沿那条线）
      var nBase = rows.length, fhMin = nBase * P.rowH + vpad, fhMax = Math.max(fhMin, Math.round((P.el.clientHeight || 600) * 0.7));
      var fh = fh0 > 0 ? Math.round(Math.max(fhMin, Math.min(fhMax, fh0))) : 0, spare = fh && !panel ? Math.floor((fh - vpad) / P.rowH) - nBase : 0;
      if (spare > 0) rows.splice.apply(rows, [above.length + inputLen - 1, 0].concat(new Array(spare).fill(""))); // 空行加在输入框里（下面那条线上面）
      if (fsash) { P.foot.style.height = fh ? fh + "px" : ""; P.el.classList.toggle("fh-set", !!fh); }
      // 别的会话在等你（问你问题、等你确认）：在跑的那一行最右边写「● 1 awaiting input · 名字」（蓝的，同 Claude Code 的说法），点一下过去；这个会话自己的问答就在眼前，不算。
      //   放进那一行的字里、靠右对齐；那一行先截短留出位置——两段字不会叠在一起
      var nd = window.STUDIO && STUDIO.needsList ? STUDIO.needsList().filter(function (x) { return x.aid !== agentId; }) : [];
      needsAid = nd.length ? nd[0].aid : "";
      if (nd.length && work.length) {
        var wi = above.length + inputLen + Math.max(0, spare), fc0 = P.footCols(), ind = "● " + nd.length + " awaiting input" + (nd.length === 1 ? " · " + nd[0].name : "");
        if (W(ind) > fc0 / 2) ind = "● " + nd.length + " awaiting input";
        var base = clipLine(String(rows[wi] || ""), Math.max(8, fc0 - W(ind) - 2));
        rows[wi] = base + RESET + " ".repeat(Math.max(1, fc0 - W(base) - W(ind))) + "\uE009" + ind + "\uE008";
      }
      P.input.innerHTML = logoMarks(P.rowsHtml(rows, P.footCols()));
      var ne0 = P.input.querySelector(".vs-needs");
      if (ne0) ne0.title = nd.map(function (x) { return x.name + (x.text ? "：" + x.text : ""); }).join("\n");
      if (rows.length !== lastFootRows) { lastFootRows = rows.length; P.fit(); P.stick(); }
      var under = v ? (ta.selectionEnd > ta.selectionStart ? "" : Array.from(v.slice(ta.selectionStart))[0]) : attach.length ? "" : Array.from(placeholder)[0];
      var fg = !v && placeholder ? (P.light ? "#828282" : "#787878") : bang && ta.selectionStart === 0 ? "#fd5db1" : null;
      if (bang && ta.selectionStart === 0) { under = "!"; caretCol = indent.length; caretRow = 1 + above.length; }
      if (panel) return P.hideCaret(); // 选项面板开着：键盘给面板，输入框不闪光标
      P.drawCaret({ where: "foot", row: caretRow, col: caretCol, ch: under, color: fg });
    }
    V.inputChanged = function (t) { if (t === "input") { menuIdx = 0; histIdx = -1; if (!(panel && panel.typing)) draftSet(agentId, P.ta.value, pastes); } if (!panel || t !== "select" || askTyping()) renderInput(); }; // 在写回答（问答面板开着）时光标挪了也重画：画出来的光标跟着键盘走；写的回答不当草稿记

    // ======== 面板（同 Claude Code）：占输入栏的位置，顶上一条淡紫线；Esc 关掉 ========
    function openPanel(p) { panel = p; P.jump.classList.remove("on"); renderInput(); P.fit(); P.stick(); }
    function closePanel() { panel = null; lastFootRows = -1; renderInput(); P.fit(); P.stick(); P.onScroll(); }
    // ---- Claude Code 自己的面板（/config、/model、/theme、/help… 和它的对话框）：这边不一个个仿——后台会话接上它的界面（rt.tui，同 claude attach），
    //   它画的那一块原样搬到输入框的位置（字、颜色照它的），键原样送进去；它把面板关了（屏幕上回到输入框）就断开、收起。
    //   面板的上边是它画的一整行 ▔（同它自己的样子），按这个找；找不到（不是面板、或者命令直接就有结果）一会儿就断开，什么都不显示
    var ccT = null, ccPalC = null, ccPalL = null;
    function ccTuiOpen(why) {
      if (ccT || !agent.claude || !rt.tui || !window.Terminal || (rt.tuiBy && rt.tuiBy !== V)) return; // 同一个会话开在几处：只一处接上（不然几处一起改它的终端大小）
      var cols = Math.max(40, P.footCols() - 1), rows = 60, term = new Terminal({ cols: cols, rows: rows, scrollback: 0, allowProposedApi: true });
      try { if (window.Unicode11Addon) { term.loadAddon(new Unicode11Addon.Unicode11Addon()); term.unicode.activeVersion = "11"; } } catch (e) { /* 没有就按默认宽度 */ }
      var st = ccT = { term: term, cols: cols, rows: rows, lines: [], row0: 0, seen: false, mouse: false, paste: false, t: 0, give: 0 };
      rt.tuiBy = V;
      st.tui = rt.tui(cols, rows, {
        open: function (modes) {
          st.mouse = modes.indexOf(1006) >= 0 && (modes.indexOf(1000) >= 0 || modes.indexOf(1002) >= 0 || modes.indexOf(1003) >= 0); st.paste = modes.indexOf(2004) >= 0;
          var r = st.tui && st.tui.rows ? st.tui.rows() : rows; // 接上时可能少一行（逼它整屏重画）：这边的屏幕跟着
          if (r !== st.rows) { st.rows = r; try { term.resize(cols, r); } catch (e) { /* 大小不对就算了 */ } }
        },
        data: function (d) { term.write(d, function () { if (!st.t) st.t = setTimeout(function () { st.t = 0; ccTuiScan(st); }, 30); }); },
        close: function (err) { if (ccT === st) ccTuiDrop(err && st.seen ? uiT("与 Claude Code 的连接断开了") : ""); },
      });
      if (!st.tui) { ccT = null; rt.tuiBy = null; term.dispose(); return; }
      st.give = setTimeout(function () { if (ccT === st && !st.seen) { ccTuiDrop(""); setTimeout(ccWatch, 200); } }, 4000); // 送了命令没弹面板（直接就有结果的）：一会儿就断开；那时它要是在等（命令排着、后来才弹）再看一眼
    }
    function ccTuiDrop(msg) {
      var st = ccT;
      if (!st) return;
      ccT = null;
      if (rt.tuiBy === V) rt.tuiBy = null;
      clearTimeout(st.give); clearTimeout(st.t); clearTimeout(st.re);
      try { st.tui.close(); } catch (e) { /* 已经断了 */ }
      try { st.term.dispose(); } catch (e) { /* 已经没了 */ }
      if (panel && panel.kind === "cc") closePanel();
      if (msg) P.flash(msg, 3000);
    }
    // 它的屏幕：最后一整行 ▔ 往下是它的面板；那下面又有输入框（一整行 ─，下一行是 ❯）就是面板关了
    function ccTuiScan(st) {
      if (ccT !== st) return;
      var b = st.term.buffer.active, txt = [], top = -1, i;
      for (i = 0; i < st.rows; i++) { var l = b.getLine(b.viewportY + i); txt.push(l ? l.translateToString(true) : ""); }
      // 上边那行可能嵌着字（它把「● high · /effort」画进这一行的右边）：一行以一串 ▔ 开头、▔ 占了大半就算；输入框上面那条 ─ 也一样（右边嵌着会话名）
      var rule = function (l, ch) { var t = l.trim(), n = t.split(ch).length - 1; return t.indexOf(ch + ch + ch + ch + ch + ch + ch + ch) === 0 && n >= t.length * 0.6; };
      for (i = txt.length - 1; i >= 0; i--) if (rule(txt[i], "▔")) { top = i; break; }
      var prompt = false;
      for (i = Math.max(0, top + 1); i < txt.length - 1; i++) if (rule(txt[i], "─") && /^❯/.test(txt[i + 1])) { prompt = true; break; }
      // 面板比屏幕还高、上边那行 ▔ 挤出去了：屏幕上没有输入框、最下面几行里有它面板的那句提示（Esc to cancel / close…）——整屏都是面板
      var full = top < 0 && !prompt && txt.slice(-6).some(function (l) { return /\bEsc to (cancel|close|clear|exit|go back)\b/.test(l); });
      if (!st.seen && top < 0 && !full) { clearTimeout(st.re); st.re = setTimeout(function () { ccTuiScan(st); }, 400); } // 还没看见面板：隔一会儿再读一遍
      if ((top < 0 && !full) || prompt) { if (st.seen) { ccWaitSeen = rt.waitingDialog ? rt.waitingDialog() : 0; ccTuiDrop(""); if (rt.dialogClosed) rt.dialogClosed(); } return; } // 面板关了：这一回不再接上；它不在等了（排着的马上送，不等它的登记改过来）
      var last = txt.length - 1;
      while (last > top && !txt[last].trim()) last--;
      st.lines = []; st.row0 = full ? 0 : top + 1;
      for (i = st.row0; i <= last; i++) st.lines.push(ccRowAnsi(b.getLine(b.viewportY + i), st.cols));
      if (!st.seen) { st.seen = true; clearTimeout(st.give); }
      if (!panel || panel.kind !== "cc") openPanel({ kind: "cc" }); else renderInput();
    }
    // 256 色（它在「只用 ANSI 颜色」的主题里用前 16 个）：前 16 个照这边终端的配色，其余按 xterm 的标准算；这边的画法只认 24 位色，一律换成 RGB
    function ccPal() {
      if (ccPalC && ccPalL === P.light) return ccPalC;
      var th = xtermTheme(P.light) || {}, names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white", "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"];
      var DEF = [0x000000, 0xcd3131, 0x0dbc79, 0xe5e510, 0x2472c8, 0xbc3fbc, 0x11a8cd, 0xe5e5e5, 0x666666, 0xf14c4c, 0x23d18b, 0xf5f543, 0x3b8eea, 0xd670d6, 0x29b8db, 0xffffff];
      var num = function (c, d) { var s0 = String(c || ""), m = /^#([0-9a-f]{6})/i.exec(s0), r = /^rgba?\((\d+)\D+(\d+)\D+(\d+)/i.exec(s0); return m ? parseInt(m[1], 16) : r ? (+r[1] << 16 | +r[2] << 8 | +r[3]) : d; };
      var pal = names.map(function (n, k) { return num(th[n], DEF[k]); }), lv = [0, 95, 135, 175, 215, 255];
      for (var r0 = 0; r0 < 6; r0++) for (var g0 = 0; g0 < 6; g0++) for (var b0 = 0; b0 < 6; b0++) pal.push(lv[r0] << 16 | lv[g0] << 8 | lv[b0]);
      for (var k = 0; k < 24; k++) { var v = 8 + k * 10; pal.push(v << 16 | v << 8 | v); }
      ccPalL = P.light;
      return (ccPalC = pal);
    }
    function ccSgr(c, pal) {
      var p = [], rgb = function (v) { return (v >> 16 & 255) + ";" + (v >> 8 & 255) + ";" + (v & 255); };
      if (c.isBold()) p.push("1"); if (c.isDim()) p.push("2"); if (c.isItalic()) p.push("3"); if (c.isUnderline()) p.push("4"); if (c.isInverse()) p.push("7"); if (c.isStrikethrough && c.isStrikethrough()) p.push("9");
      if (c.isFgRGB()) p.push("38;2;" + rgb(c.getFgColor())); else if (c.isFgPalette()) p.push("38;2;" + rgb(pal[c.getFgColor()] || 0));
      if (c.isBgRGB()) p.push("48;2;" + rgb(c.getBgColor())); else if (c.isBgPalette()) p.push("48;2;" + rgb(pal[c.getBgColor()] || 0));
      return p.length ? "\x1b[" + p.join(";") + "m" : "";
    }
    // 一行：一格一格读出字和样子，样子变了才换（行尾没底色的空格不要）
    function ccRowAnsi(line, cols) {
      if (!line) return "";
      var pal = ccPal(), cell, end = -1, x, out = "", cur = "";
      for (x = 0; x < cols; x++) { cell = line.getCell(x, cell); if (!cell) break; var ch = cell.getChars(); if ((ch && ch !== " ") || !cell.isBgDefault() || cell.isInverse()) end = x; }
      for (x = 0; x <= end; x++) {
        cell = line.getCell(x, cell);
        if (!cell || cell.getWidth() === 0) continue; // 两格宽的字的后一半
        var sg = ccSgr(cell, pal);
        if (sg !== cur) { out += RESET + sg; cur = sg; }
        out += cell.getChars() || " ";
      }
      return out + (cur ? RESET : "");
    }
    function ccRows() {
      var st = ccT;
      if (!st) return [];
      st.lines.forEach(function (l, i) { panel.map[i] = { cc: st.row0 + i }; });
      return st.lines.slice();
    }
    // 键 → 终端里那几个字节（同 claude attach 送的）；⌘ 开头的归 App。Ctrl+C / Ctrl+D 不送（在它那里连按会退出会话）——当 Esc
    function ccKeyBytes(e) {
      var k = e.key, m = (e.shiftKey ? 1 : 0) + (e.altKey ? 2 : 0) + (e.ctrlKey ? 4 : 0), csi = function (f) { return m ? "\x1b[1;" + (m + 1) + f : "\x1b[" + f; };
      switch (k) {
        case "Enter": return e.shiftKey ? "\x1b\r" : "\r";
        case "Escape": return "\x1b";
        case "Backspace": return e.altKey ? "\x1b\x7f" : "\x7f";
        case "Tab": return e.shiftKey ? "\x1b[Z" : "\t";
        case "ArrowUp": return csi("A"); case "ArrowDown": return csi("B"); case "ArrowRight": return csi("C"); case "ArrowLeft": return csi("D");
        case "Home": return csi("H"); case "End": return csi("F");
        case "PageUp": return "\x1b[5~"; case "PageDown": return "\x1b[6~"; case "Delete": return "\x1b[3~";
      }
      if (e.metaKey || e.isComposing) return null;
      if (e.ctrlKey && k.length === 1) { var lc = k.toLowerCase(), cc0 = lc.charCodeAt(0); if (lc === "c") return "\x1b"; if (lc === "d") return null; return cc0 >= 97 && cc0 <= 122 ? String.fromCharCode(cc0 - 96) : null; }
      return k.length === 1 || /^[^\x00-\x7f]+$/.test(k) ? k : null;
    }
    function ccKey(e) { var bs = ccKeyBytes(e); if (bs != null && ccT) ccT.tui.send(bs); }
    function ccClick(e, row) {
      var st = ccT;
      if (!st || !st.mouse) return;
      var ir = P.input.getBoundingClientRect(), col = Math.max(0, Math.floor((e.clientX - ir.left) / P.chPx)), at = (col + 1) + ";" + (row + 1);
      st.tui.send("\x1b[<0;" + at + "M"); st.tui.send("\x1b[<0;" + at + "m");
    }
    // 它在等你（Claude Code 登记成 waiting）、又不是在问你问题（那个这边自己画）：接上看一眼是不是它的面板。
    //   每次「在等」只看一次（不是面板就算了，不反复接上）；这一格看得见时才看（接上会把它的终端改成这边的大小，别的终端里接着它的会跟着变）
    var ccWaitSeen = 0, ccWaitT = 0; // 看过的那一回「在等」（rt.waitingDialog() 的记号）
    V.ccState = function () { if (!ccT) return null; var b = ccT.term.buffer.active, tx = []; for (var i = 0; i < ccT.rows; i++) { var l = b.getLine(b.viewportY + i); tx.push(l ? l.translateToString(true) : ""); } return { seen: ccT.seen, lines: ccT.lines.length, row0: ccT.row0, screen: tx }; }; // 测试、排查用
    function ccWatch() {
      clearTimeout(ccWaitT);
      var w = rt.waitingDialog ? rt.waitingDialog() : 0;
      if (!w) { ccWaitSeen = 0; return; }
      if (ccWaitSeen === w || ccT || !rt.tui || (rt.question && rt.question()) || P.closed || P.program !== V) return;
      if (document.hidden || P.off || !P.el.offsetParent) { ccWaitT = setTimeout(ccWatch, 1500); return; } // 现在看不见（后面的标签页、App 在后台）：露出来再看
      ccWaitSeen = w;
      ccTuiOpen("wait");
    }
    // 选择器：/model、/effort、/permissions、/statusline
    function picker(o) { openPanel(Object.assign({ kind: "pick", sel: Math.max(0, o.options.findIndex(function (x) { return x.current; })) }, o)); }
    // /model：两级——先选提供方，再选它的模型（Esc 回到提供方）
    // 连接器的会话（Claude Code、Codex）：连接器给的模型（id 原样，带 [1m] 的是 1M 上下文），下一句起用上
    function pickConnModel() {
      var cur = rt.model() || {}, who = rt.agentName && rt.agentName();
      picker({ title: "Select model", sub: (rt.label || "Claude Code") + (who ? " · " + who : "") + (enLang() ? " · applies from the next message" : " · 下一句起生效"), cmd: "/model",
        options: rt.models().map(function (m) { return { value: m.id, label: m.name, current: m.id === cur.id, desc: m.desc || "" }; }), // 不写完整的模型 ID（名字就够了）
        onPick: function (id) { rt.setModel(id); rt.record("/model", "Set model to " + id); } });
    }
    function pickModel(provider) {
      if (agent.claude) return rt.models ? pickConnModel() : null;
      var ms = A.models(), cur = rt.model(), pr = (A.me() || {}).pricing || {}, pv = A.providerOf || function () { return ""; };
      if (!ms.length) return rt.record("/model", "No models available (not signed in?)");
      if (!provider) {
        var provs = [];
        ms.forEach(function (m) { var p0 = pv(m); if (provs.indexOf(p0) < 0) provs.push(p0); });
        var curP = pv(A.modelOf(cur && cur.id) || cur || {});
        return picker({ title: "Select provider", sub: agent.name + " 的模型提供方", cmd: "/model",
          options: provs.map(function (p0) { var n = ms.filter(function (m) { return pv(m) === p0; }).length; return { value: p0, label: p0, current: p0 === curP, desc: n + " 个模型" }; }),
          onPick: function (p0) { pickModel(p0); } });
      }
      ms = ms.filter(function (m) { return pv(m) === provider; });
      picker({ title: "Select model · " + provider, sub: "" + agent.name + " 的模型。价格：元 / 百万 token，" + (pr.peak ? "当前为高峰价" : "当前为平时价（高峰价的一半）") + "。", cmd: "/model", back: function () { pickModel(); },
        options: ms.map(function (m) {
          var f = pr.peak === false && m.offpeak ? m.offpeak : 1, yuan = function (x) { return "¥" + +(x * f).toFixed(3); };
          return { value: m.id, label: m.name, current: cur && m.id === cur.id, desc: "输入 " + yuan(m.in) + "（缓存 " + yuan(m.hit !== undefined ? m.hit : m.in * 0.1) + "）· 输出 " + yuan(m.out) + " · " + F.k(m.ctx).replace("m", "M") + " 上下文" + (m.vision ? " · 支持图片" : "") };
        }),
        onPick: function (id) { var m = A.modelOf(id); rt.setModel(id); rt.record("/model", "Set model to " + (m ? m.name : id)); } });
    }
    function pickEffort() { openPanel({ kind: "effort", sel: Math.max(0, A.EFFORTS.indexOf(agent.effort || "high")) }); }
    // 滑杆：两头 Faster / Smarter，一条线上 ▲ 指着选中的那一档，下面是各档的名字（选中的亮）
    function effortSlider(fcols, indent, sel) {
      var D = P.DIM, E = A.EFFORTS, n = E.length, T = Math.max(28, Math.min(66, fcols - indent.length - 16)), left = indent + "      ";
      var at = function (i) { return Math.round(i * (T - 1) / (n - 1)); };
      var rows = [left + "Faster" + " ".repeat(Math.max(1, T - 13)) + "Smarter"];
      var x = at(sel);
      rows.push(left + D + "─".repeat(x) + RESET + BOLD + "▲" + RESET + D + "─".repeat(Math.max(0, T - x - 1)) + RESET);
      var line = "", col = 0;
      E.forEach(function (e, i) {
        var start = Math.max(col, Math.min(T - W(e), at(i) - Math.floor(W(e) / 2)));
        line += " ".repeat(start - col) + (i === sel ? GREEN + BOLD + e + RESET : D + e + RESET);
        col = start + W(e);
      });
      rows.push(left + line);
      return rows;
    }
    function effortRows(fcols, indent) {
      var D = P.DIM, e = A.EFFORTS[panel.sel];
      return [indent + BOLD + "Effort" + RESET, ""].concat(effortSlider(fcols, indent, panel.sel),
        [indent + D + clip(uiT(EFFORT_DESC[e]) || "", fcols - indent.length - 2) + RESET, "", indent + D + "←/→ to adjust · Enter to confirm · Esc to cancel" + RESET]);
    }
    function effortKey(e) {
      var k = e.key;
      if (k === "Escape") return closePanel();
      if (k === "ArrowLeft" || k === "ArrowRight") panel.sel = Math.max(0, Math.min(A.EFFORTS.length - 1, panel.sel + (k === "ArrowRight" ? 1 : -1)));
      else if (k === "Enter") { var ef = A.EFFORTS[panel.sel]; closePanel(); rt.setEffort(ef); rt.record("/effort", "Set effort to " + ef + (ef === "off" ? " (no thinking)" : "")); return; }
      else return;
      renderInput();
    }
    function pickAccess() {
      var L = { none: "禁止：仅限工作目录 " + rt.home(), read: "只读：工作目录外只读", rw: "读写：工作目录外可修改（仍受文件权限限制）" };
      picker({ title: "Permissions", sub: agent.name + " 工作目录外的权限（Shift+Tab 切换）。", cmd: "/permissions",
        options: ["none", "read", "rw"].map(function (k) { return { value: k, label: ACCESS_LABEL[k][1], current: k === (agent.access || "read"), desc: L[k] }; }),
        onPick: function (k) { rt.setAccess(k); rt.record("/permissions", "Access outside own folder: " + ACCESS_LABEL[k][1]); } });
    }
    function pickStatusline() {
      var names = { balance: "Balance（余额）", context: "Ctx（上下文用量）", cost: "Session（本会话费用）", model: "模型", cwd: "工作目录", access: "权限级别" };
      var fnames = { duration: "Brewed for 12s（用时）", time: "done 3:04 PM（完成时间）", tokens: "↑ 9.9k ↓ 3.6k tokens", cost: "≈¥0.0172（本轮费用）" };
      openPanel({ kind: "pick", multi: true, title: "Status line", sub: "输入框下方与每轮结尾显示的信息（保存在 /.paimon/config/settings.json）。空格选择，回车完成。", cmd: "/statusline", sel: 0,
        options: A.STATUS_FIELDS.map(function (f) { return { key: "statusline", value: f, label: names[f] }; }).concat(A.FOOTER_FIELDS.map(function (f) { return { key: "footer", value: f, label: "回合结尾 · " + fnames[f] }; })),
        onDone: function () { rt.record("/statusline", "Status line: " + ((cfg.statusline || []).join(", ") || "(none)") + " · footer: " + ((cfg.footer || []).join(", ") || "(none)")); } });
    }
    function toggleField(k, f) {
      var l = (cfg[k] || []).slice(), i = l.indexOf(f);
      if (i >= 0) l.splice(i, 1); else l.push(f);
      var order = k === "statusline" ? A.STATUS_FIELDS : A.FOOTER_FIELDS;
      A.setCfg(k, order.filter(function (x) { return l.indexOf(x) >= 0; }));
    }
    function pickRows(fcols, indent) {
      var rows = [indent + BOLD + uiT(panel.title) + RESET, ""], D = P.DIM, map = panel.map;
      wrap(uiT(panel.sub), fcols - 4).forEach(function (l) { rows.push(indent + D + l + RESET); });
      rows.push("");
      var MAXO = 10, o0 = Math.max(0, Math.min(panel.sel - 4, panel.options.length - MAXO));
      panel.options.forEach(function (o, i) {
        if (i < o0 || i >= o0 + MAXO) return;
        var on = i === panel.sel, checked = panel.multi ? ((cfg[o.key] || []).indexOf(o.value) >= 0) : o.current;
        var mark = panel.multi ? (checked ? "[✔] " : "[ ] ") : (i + 1) + ". ";
        map[rows.length] = { opt: i };
        var line = indent + (on ? LAV + "❯ " : "  ") + mark + pad(uiT(o.label) + (checked && !panel.multi ? " ✔" : ""), panel.multi ? 40 : 26) + RESET;
        if (o.desc) line += (on ? "" : D) + clip(uiT(o.desc), Math.max(10, fcols - W(line) - 2)) + RESET;
        rows.push(line);
      });
      rows.push("", indent + D + (panel.multi ? "Space to toggle · Enter when done · Esc to exit" : "Enter to confirm · Esc to exit") + RESET);
      return rows;
    }
    function pickKey(e) {
      var k = e.key, o = panel.options;
      if (k === "Escape") { var bk = panel.back; closePanel(); if (bk) bk(); return; } // 二级的（/model 的模型）：回到上一级
      if (k === "ArrowDown") panel.sel = Math.min(o.length - 1, panel.sel + 1);
      else if (k === "ArrowUp") panel.sel = Math.max(0, panel.sel - 1);
      else if (/^[1-9]$/.test(k) && !panel.multi && o[+k - 1]) { panel.sel = +k - 1; return pickKey({ key: "Enter" }); }
      else if (panel.multi && (k === " " || k === "Enter" && e.shiftKey)) toggleField(o[panel.sel].key, o[panel.sel].value);
      else if (k === "Enter") {
        var p0 = panel;
        closePanel();
        if (p0.multi) { if (p0.onDone) p0.onDone(); }
        else if (p0.onPick) p0.onPick(o[p0.sel].value);
        return;
      } else return;
      renderInput();
    }

    // ---- 所有 agent（← 打开，同 Claude Code 的 agents 视图）：和这个 agent 平级的，按状态分组；回车接上，Esc 回来 ----
    function openAgents() { if (agent.claude && rt.island) return openIsland(); openPanel({ kind: "agents", full: true, sel: 0, from: agentId }); }
    // 「esc to interrupt」只在真能打断时写：开在别的终端里的会话，这里按 Esc 没用——写「running in another terminal」
    function escHint() { return ""; } // 转圈那一行不写「esc to interrupt」（哪种风格都不写；Esc 照样能打断）——同 Claude Code 2.x
    // ---- 连接器的会话：输入框下面同 Claude Code 的两行（淡的）——「5h: 3% | 7d: 1% | Ctx: 17%」，
    //      「⏵⏵ bypass permissions on (shift+tab to cycle) · ← 1 agent · 2 shells」（模式用它的颜色；能换才写「(shift+tab to cycle)」；
    //      在别处跑的多一个短词「· background」「· other terminal」）----
    var MODE_LOOK = { bypassPermissions: ["⏵⏵ bypass permissions on", "255;107;128"], acceptEdits: ["⏵⏵ accept edits on", "175;135;255"], plan: ["⏸ plan mode on", "72;150;140"] };
    var islandRunning = 0;
    function connWhere() { var inf = rt.info || {}; if (!(rt.elsewhere && rt.elsewhere())) return ""; return inf.live && inf.live.kind === "bg" ? "background" : "other terminal"; }
    function connFoot(indent, fcols) {
      var D = P.DIM, out = [], L = rt.limits ? rt.limits() : null, c = rt.ctx ? rt.ctx() : null;
      var pcs = function (v) { return v === null || v === undefined ? "n/a" : v + "%"; };
      out.push(indent + "  " + D + "5h: " + pcs(L && L.five) + " | 7d: " + pcs(L && L.week) + " | Ctx: " + (c && c.window ? Math.round(c.pct) + "%" : "n/a") + RESET);
      var mode = rt.permMode ? rt.permMode() : "", look = MODE_LOOK[mode], bits = [];
      var sh = (rt.tasks || []).filter(function (x) { return x.kind === "shell" && x.status === "running"; }).length, wh = connWhere();
      if (islandRunning) bits.push(D + "← " + islandRunning + " agent" + (islandRunning === 1 ? "" : "s") + RESET);
      if (sh) bits.push(CYAN + sh + " shell" + (sh === 1 ? "" : "s") + RESET);
      if (wh) bits.push(D + wh + RESET);
      var line = look ? rgb(look[1]) + look[0] + RESET + (rt.canCycle && rt.canCycle() ? D + " (shift+tab to cycle)" + RESET : "") : "";
      if (line || bits.length) out.push(indent + "  " + line + (line && bits.length ? D + " · " + RESET : "") + bits.join(D + " · " + RESET));
      return out;
    }
    // 「← N agents」：它别的正在干活的后台会话（← 那一块里「Working」的，不算自己）；隔一阵问一次
    var islandAt = 0;
    function islandCount() { if (!rt.island || Date.now() - islandAt < 5000) return; islandAt = Date.now(); rt.island().then(function (d) { var n = d && d.running || 0; if (n !== islandRunning) { islandRunning = n; renderInput(); } }, function () {}); }
    // ---- 连接器的会话（Claude Code、Codex）：← 打开它们自己的那一块（同 Claude Code 的 ← 视图）：后台会话按「Needs input / Working / Completed」分，
    //      右边一列是状态或最后一句；最下面「❯ describe a task for a new session」在同一个目录开新会话；↑↓ 选，回车打开，Esc 回来；出错的红字在最下面 ----
    // 字里的 \uE030 / \uE035：换成 Claude / OpenAI 的标志（一格宽，同侧栏的会话树）
    function logoMarks(h) {
      if (!/[\uE030\uE035]/.test(h)) return h;
      var L0 = window.TSU_LOGOS || {}, ic = function (c) { return c === "\uE035" ? '<i class="ts-ccl ts-cxl">' + (L0.codex || "") + "</i>" : '<i class="ts-ccl vs-cclo">' + (L0.claude || "") + "</i>"; };
      return h.replace(/<span style="display:inline-block;width:var\(--ttu-cell,1ch\)">([\uE030\uE035])<\/span>/g, function (m, c) { return ic(c); }).replace(/[\uE030\uE035]/g, ic);
    }
    function openIsland() {
      openPanel({ kind: "island", full: true, sel: 0, q: "", data: null, err: "" });
      rt.island().then(function (d) { if (panel && panel.kind === "island") { panel.data = d; renderInput(); } }, function (e) { if (panel && panel.kind === "island") { panel.err = String(e && e.message || e); renderInput(); } });
    }
    function islandItems() { var o = []; ((panel.data || {}).groups || []).forEach(function (g) { g.items.forEach(function (it) { o.push(it); }); }); return cxStyleOn() ? cxItems(o) : o; }
    // ---- Codex 的会话按 ← ：默认是 Codex 自己的样子（同 codex resume 的列表：最上面搜索，一张表「Updated · Status · Directory · Conversation」，› 选中，
    //      最下面一行淡的按键说明）；底部 ··· 里能换成 Claude Code 的样子 ----
    var cxStyleOn = function () { return /^cx:/.test(agentId) && localStorage.getItem("tsu-cx-center") !== "claude"; };
    function cxItems(all) {
      var q = String(panel.q || "").trim().toLowerCase(), rank = { working: 0, busy: 0, needs: 1, idle: 2, done: 3 };
      return all.filter(function (it) { return !q || (String(it.current ? it.title || "" : it.name || "") + " " + (it.cwd || "") + " " + (it.right || "")).toLowerCase().indexOf(q) >= 0; })
        .sort(function (a, b) { return (b.current ? 1 : 0) - (a.current ? 1 : 0) || (rank[a.st] == null ? 3 : rank[a.st]) - (rank[b.st] == null ? 3 : rank[b.st]) || (b.at || 0) - (a.at || 0); });
    }
    function cxRows(fcols, indent) {
      var D = P.DIM, rows = [], w = Math.max(30, fcols - indent.length - 1), items = islandItems(), q = panel.q || "";
      if (panel.sel >= items.length) panel.sel = Math.max(0, items.length - 1);
      var tilde = function (p0) { var h = (window.TSU_LOCAL && TSU_LOCAL.info && (TSU_LOCAL.info() || {}).home) || ""; return h && String(p0).indexOf(h) === 0 ? "~" + String(p0).slice(h.length) : String(p0 || ""); };
      var cU = 16, cS = 10, cD = Math.min(26, Math.max(12, Math.floor(w * 0.22))), cC = Math.max(10, w - cU - cS - cD - 2);
      rows.push(indent + "\uE035 " + BOLD + "Codex sessions" + RESET);
      panel.caretAt = { row: 2 + rows.length, col: indent.length + W("Type to search: ") + W(q) };
      rows.push(indent + D + "Type to search: " + RESET + (q || ""), "");
      rows.push(indent + "  " + BOLD + pad("Updated", cU) + pad("Status", cS) + pad("Directory", cD) + "Conversation" + RESET);
      if (!panel.data) rows.push(indent + "  " + D + "Loading…" + RESET);
      else if (!items.length) rows.push(indent + "  " + D + (q ? "No sessions match — enter starts a new session with it" : "No sessions yet") + RESET);
      items.forEach(function (it, i) {
        var sel = i === panel.sel, st = it.st === "working" || it.st === "busy" ? "working" : it.st === "needs" ? "waiting" : it.st === "idle" ? "open" : "done";
        var name = it.current ? (it.title || "this session") + " (current)" : it.name || it.id;
        panel.map[rows.length] = { island: i };
        rows.push(indent + (sel ? CYAN + BOLD + "› " : "  ") + pad(it.at ? (Date.now() - it.at < 60000 ? "just now" : ago(it.at) + " ago") : "", cU) + RESET + (st === "working" ? CYAN : D) + pad(st, cS) + RESET + D + pad(clip(tilde(it.cwd), cD - 2), cD) + RESET + (sel ? BOLD : "") + clip(name, cC) + RESET);
      });
      var total = Math.floor(P.el.clientHeight / P.rowH) - 3;
      while (rows.length < total - 2) rows.push("");
      rows.push("", indent + D + clip("enter to open · esc to go back · ↑/↓ to browse · type to search" + (q ? " · enter with no match starts a new session" : ""), w) + RESET);
      if (panel.err) rows.push(indent + RED + clip(panel.err, w) + RESET);
      return rows;
    }
    function islandRows(fcols, indent) {
      if (cxStyleOn()) return cxRows(fcols, indent);
      var D = P.DIM, rows = [], w = Math.max(20, fcols - indent.length - 1), items = islandItems(), nameW = Math.min(38, Math.max(16, Math.floor(w * 0.4))), n = 0;
      if (panel.sel >= items.length) panel.sel = Math.max(0, items.length - 1);
      rows.push(indent + D + clip("Your conversation moved to the background — enter opens it · esc returns to it · ↑↓ to move", w) + RESET, "");
      if (!panel.data) rows.push(indent + D + "…" + RESET);
      ((panel.data || {}).groups || []).forEach(function (g, gi) {
        if (gi) rows.push("");
        rows.push(indent + g.title);
        g.items.forEach(function (it) {
          var i = n++, sel = i === panel.sel, done = g.title === "Completed";
          // 现在这个会话：它自己的标志（Claude Code 的会话是 Claude 的标志，Codex 的是 OpenAI 的；renderInput 换成图标），不用「✻」这种字符
          var dot = it.current ? (/^cx:/.test(agentId) ? "\uE035" : "\uE030") : (it.st === "failed" ? RED : it.st === "working" ? ORANGE : done ? GREEN : D) + (done ? "•" : "·") + RESET;
          var mark = sel && panel.moved; // 挪过了才亮选中的那一行（刚打开时同 Claude Code：光标在下面的输入框里）
          var nm = it.current ? (mark ? LAV : "") + BOLD + "current session" + RESET : (mark ? LAV + BOLD : "") + clip(it.name, nameW - 3) + RESET;
          var rw = w - nameW - 2, rt0 = String(it.right || ""), right = it.term ? LAV + clip(rt0.split(" · ")[0], rw) + RESET + D + " · " + clip(rt0.split(" · ").slice(1).join(" · "), Math.max(4, rw - W(rt0.split(" · ")[0]) - 3)) + RESET : D + clip(rt0, rw) + RESET;
          panel.map[rows.length] = { island: i };
          rows.push(indent + dot + " " + pad(nm, nameW) + right);
        });
      });
      // 最下面：两条线夹着的输入（在同一个目录开新会话），出错的红字在它下面
      var total = Math.floor(P.el.clientHeight / P.rowH) - 3, tail = 3 + (panel.err ? 1 : 0), rule = D + "─".repeat(Math.max(4, fcols - indent.length - 1)) + RESET, q = panel.q || "";
      while (rows.length < total - tail) rows.push("");
      rows.push(indent + rule);
      panel.caretAt = { row: 2 + rows.length, col: indent.length + 2 + W(q) };
      rows.push(indent + "❯ " + (q || D + "describe a task for a new session" + RESET));
      rows.push(indent + rule);
      if (panel.err) rows.push(indent + "  " + RED + clip(panel.err, w - 2) + RESET);
      return rows;
    }
    function islandKey(e) {
      var k = e.key, items = islandItems(), cx = agentId.slice(0, 3) === "cx:";
      if (cxStyleOn()) { // Codex 的样子：打字是搜，回车打开选中的（搜不到就用这句开新会话）
        if (k === "Escape") { if (panel.q) { panel.q = ""; panel.sel = 0; } else return closePanel(); }
        else if (k === "ArrowDown") panel.sel = Math.min(Math.max(0, items.length - 1), panel.sel + 1);
        else if (k === "ArrowUp") panel.sel = Math.max(0, panel.sel - 1);
        else if (k === "Enter") {
          var it0 = items[panel.sel], q0 = String(panel.q || "").trim();
          if (!it0 && q0) { if (!window.TSU_CONNECTORS || !TSU_CONNECTORS.canNew("codex")) { panel.err = "Can't start a new session here"; return renderInput(); } closePanel(); TSU_CONNECTORS.newSession("codex", rt.cwd ? rt.cwd() : "", q0); return; }
          if (!it0) return;
          if (it0.current) return closePanel();
          closePanel();
          if (focusAgent("cx:" + it0.id)) return;
          if (window.TSU_CODEX) TSU_CODEX.ensure(it0.id);
          return P.run(makeView(P, "cx:" + it0.id));
        }
        else if (k === "Backspace") { panel.q = String(panel.q || "").slice(0, -1); panel.sel = 0; panel.err = ""; }
        else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { panel.q = (panel.q || "") + k; panel.sel = 0; panel.err = ""; }
        else if (e.ctrlKey && (k === "c" || k === "C")) return ctrlC();
        else return;
        return renderInput();
      }
      if (k === "Escape") { if (panel.q) panel.q = ""; else return closePanel(); }
      else if (k === "ArrowDown") { panel.sel = panel.moved ? Math.min(Math.max(0, items.length - 1), panel.sel + 1) : panel.sel; panel.moved = true; }
      else if (k === "ArrowUp") { panel.sel = Math.max(0, panel.sel - 1); panel.moved = true; }
      else if (k === "Enter") {
        var q = String(panel.q || "").trim(), conn = cx ? "codex" : "claude-code";
        if (q) { // 在这个会话的目录里开新会话，第一句就是这句
          if (!window.TSU_CONNECTORS || !TSU_CONNECTORS.canNew(conn)) { panel.err = "Can't start a new session here"; return renderInput(); }
          closePanel();
          TSU_CONNECTORS.newSession(conn, rt.cwd ? rt.cwd() : "", q);
          return;
        }
        var it = items[panel.sel];
        if (!it) return;
        if (it.current) return closePanel();
        var aid = (cx ? "cx:" : "cc:") + it.id;
        closePanel();
        if (focusAgent(aid)) return; // 已经开在别的标签页里：跳过去
        if (cx) { if (window.TSU_CODEX) TSU_CODEX.ensure(it.id); } else if (window.TSU_CLAUDE) TSU_CLAUDE.ensure(it.id, { cwd: it.cwd, title: it.name });
        return P.run(makeView(P, aid));
      }
      else if (k === "Backspace") { panel.q = String(panel.q || "").slice(0, -1); panel.err = ""; }
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { panel.q = (panel.q || "") + k; panel.err = ""; }
      else if (e.ctrlKey && (k === "c" || k === "C")) return ctrlC();
      else return;
      renderInput();
    }
    function agentsRows(fcols, indent) {
      var D = P.DIM, res = agentList(fcols - indent.length - 1, { archived: panel.archived, sel: panel.sel, current: agentId });
      if (panel.follow) { var fi = res.order.findIndex(function (a) { return a.id === panel.follow; }); if (fi >= 0) { panel.sel = fi; res = agentList(fcols - indent.length - 1, { archived: panel.archived, sel: fi, current: agentId }); } panel.follow = null; }
      panel.list = res.order;
      if (panel.sel >= res.order.length) { panel.sel = Math.max(0, res.order.length - 1); res = agentList(fcols - indent.length - 1, { archived: panel.archived, sel: panel.sel, current: agentId }); }
      var rows = res.rows.map(function (r) { return indent + r; });
      Object.keys(res.at).forEach(function (k) { panel.map[+k] = { agent: res.at[k] }; });
      rows.push("", indent + D + clip(uiT(panel.archived ? "Enter 恢复并打开 · Ctrl+X ×2 恢复 · Ctrl+A 返回列表 · Esc 返回" : "Enter 打开 · Esc 返回 · N 新建 · X 停止 · Ctrl+X ×2 归档 · Ctrl+A 查看已归档"), fcols - 2) + RESET);
      return rows;
    }

    var ago = function (t) { var s = (Date.now() - t) / 1000; return s < 60 ? "now" : s < 3600 ? Math.floor(s / 60) + "m" : s < 86400 ? Math.floor(s / 3600) + "h" : Math.floor(s / 86400) + "d"; };
    function agentsKey(e) {
      var k = e.key, l = panel.list || [];
      if (k === "Escape" || k === "ArrowRight") return closePanel();
      if (k === "ArrowDown") panel.sel = Math.min(l.length - 1, panel.sel + 1);
      else if (k === "ArrowUp") panel.sel = Math.max(0, panel.sel - 1);
      else if (k === "Enter") { var a = l[panel.sel]; if (!a) return; if (a.archived) A.unarchive(a.id); if (a.id === agentId) return closePanel(); return P.run(makeView(P, a.id)); }
      else if (k === "n" || k === "N") { var na = A.create({ model: agent.model }); return P.run(makeView(P, na.id)); }
      else if (k === "x" && !e.ctrlKey) { var b = l[panel.sel]; if (b) A.runtime(b.id).interrupt(); }
      else if (e.ctrlKey && (k === "a" || k === "A")) { panel.archived = !panel.archived; panel.sel = 0; } // 归档的单独一个界面
      else if (e.ctrlKey && (k === "x" || k === "X")) { // 连按两次：归档（归档的再连按两次：恢复）。从不删除
        var c2 = l[panel.sel];
        if (!c2) return;
        if (!panel.cx || panel.cx.id !== c2.id || Date.now() - panel.cx.t > 1500) { panel.cx = { id: c2.id, t: Date.now() }; P.flash("Press ctrl+x again to " + (c2.archived ? "restore " : "archive ") + c2.name, 1500); return; }
        panel.cx = null;
        if (c2.archived) { A.unarchive(c2.id); P.flash("Restored " + c2.name, 1500); } else { A.archive(c2.id); P.flash("Archived " + c2.name + " · nothing is deleted · ctrl+x twice restores it", 2500); }
      }
      else if (e.ctrlKey && (k === "c" || k === "C")) return ctrlC();
      else return;
      renderInput();
    }

    // ---- 后台任务与子 agent（/tasks，空输入按 ↓）----
    function openTasks() { openPanel({ kind: "tasks", sel: 0, view: null, scroll: 0 }); }
    // 底下面板里点了一个后台任务 / 子 Agent：在这里打开它的详情（提示、每一步、结果）
    V.openTask = function (id) { var t = rt.tasks.filter(function (x) { return x.id === id; })[0]; if (!t) return; openPanel({ kind: "tasks", sel: 0, view: t, scroll: 0 }); P.focus(); };
    function tasksRows(fcols, indent) {
      var rows = [], D = P.DIM, map = panel.map;
      if (panel.view) {
        var t = panel.view, st = t.status === "running" ? ORANGE + "running" + RESET : t.status === "done" ? GREEN + "done" + RESET : RED + t.status + RESET;
        rows.push(indent + BOLD + t.id + "  " + clip(t.desc, fcols - 40) + RESET + "   " + st + D + " · " + (t.kind === "shell" ? "" : t.tools + " tool uses · " + F.k(t.tokensIn + t.tokensOut) + " tokens · ") + F.dur(t.ms || Date.now() - t.t0) + RESET, "");
        var body = [];
        if (t.kind === "shell") {
          body.push(D + "$ " + t.cmd + RESET);
          termLines(String(t.result || (t.ctx && t.ctx.live) || t.error || "(no output yet)"), fcols - 4).forEach(function (l) { body.push("  " + l); });
        } else {
          body.push(D + "Prompt" + RESET);
          wrap(t.prompt, fcols - 4).forEach(function (l) { body.push("  " + l); });
          t.log.forEach(function (x) {
            body.push("");
            if (x.kind === "text") trim(mdLines(x.text, { width: fcols - 2, theme: P.theme })).forEach(function (l, i) { body.push((i ? "  " : DOT + " ") + l); });
            else toolRows(x, false).forEach(function (l) { body.push(l); });
          });
        }
        if (t.error && t.kind !== "shell") body.push("", RED + t.error + RESET);
        var room = Math.max(4, Math.floor(P.el.clientHeight / P.rowH) - 8);
        if (panel.follow !== false) panel.scroll = Math.max(0, body.length - room);
        panel.scroll = Math.max(0, Math.min(panel.scroll, body.length - room));
        body.slice(panel.scroll, panel.scroll + room).forEach(function (l) { rows.push(l); });
        rows.push("", indent + D + "↑↓ scroll · x stop · Esc / ← back" + RESET);
        return rows;
      }
      var list = rt.tasks.slice().reverse();
      panel.list = list;
      panel.sel = Math.min(panel.sel, Math.max(0, list.length - 1));
      rows.push(indent + BOLD + "Background tasks" + RESET + D + "   " + agent.name + " · " + list.filter(function (x) { return x.status === "running"; }).length + " running" + RESET, "");
      list.forEach(function (x, i) {
        var on = i === panel.sel, dot = x.status === "running" ? ORANGE + DOT + RESET : x.status === "done" ? GREEN + DOT + RESET : RED + DOT + RESET;
        map[rows.length] = { task: i };
        rows.push(indent + (on ? LAV + "❯ " : "  ") + pad(x.id, 5) + RESET + dot + " " + pad(clip(x.kind === "shell" ? "$ " + x.cmd : x.desc, fcols - 40), fcols - 38) + D + pad(x.kind === "shell" ? "shell" : x.tools + " tools", 10) + F.dur(x.ms || Date.now() - x.t0) + RESET);
      });
      if (!list.length) wrap("无后台任务。", fcols - 4).forEach(function (l) { rows.push(indent + D + l + RESET); });
      rows.push("", indent + D + "↑↓ select · Enter view · x stop · Esc back" + RESET);
      return rows;
    }
    function tasksKey(e) {
      var k = e.key;
      if (panel.view) {
        if (k === "Escape" || k === "ArrowLeft") { panel.view = null; panel.follow = true; }
        else if (k === "ArrowUp") { panel.follow = false; panel.scroll = Math.max(0, panel.scroll - 1); }
        else if (k === "ArrowDown") panel.scroll++;
        else if (k === "x" && panel.view.status === "running") rt.stopTask(panel.view.id);
        else return;
        return renderInput();
      }
      var l = panel.list || [];
      if (k === "Escape" || k === "ArrowUp" && panel.sel === 0 && !l.length) return closePanel();
      if (k === "ArrowDown") panel.sel = Math.min(l.length - 1, panel.sel + 1);
      else if (k === "ArrowUp") { if (panel.sel === 0) return closePanel(); panel.sel--; }
      else if (k === "Enter") { var x = l[panel.sel]; if (x) { panel.view = x; panel.follow = true; } }
      else if (k === "x") { var y = l[panel.sel]; if (y) rt.stopTask(y.id); }
      else return;
      renderInput();
    }

    // ---- 以前的会话（/resume）----
    function openResume() {
      var all = A.sessionsOf(agentId);
      if (!all.length) return rt.record("/resume", "No previous conversations");
      openPanel({ kind: "resume", list: all, query: "", sel: 0 });
    }
    function resumeRows(fcols, indent) {
      var rows = [indent + BOLD + "Resume session" + RESET + P.DIM + "   " + agent.name + " · type to filter · enter to open · esc to cancel" + RESET, ""], map = panel.map;
      var q = panel.query.toLowerCase(), list = panel.list.filter(function (x) { return !q || (x.title || "").toLowerCase().indexOf(q) >= 0; });
      panel.shown = list;
      panel.sel = Math.min(panel.sel, Math.max(0, list.length - 1));
      list.slice(0, 14).forEach(function (x, i) {
        var on = i === panel.sel, n = x.turns.filter(function (t) { return t.ask && !t.system; }).length;
        map[rows.length] = { resume: i };
        rows.push(indent + (on ? LAV + "❯ " : "  ") + pad(clip(x.title || "(untitled)", fcols - 38), fcols - 36) + RESET + P.DIM + pad(n + " msgs", 9) + new Date(x.updated).toLocaleDateString() + RESET + (x.id === agent.current ? LAV + "  ●" + RESET : ""));
      });
      if (list.length > 14) rows.push(indent + P.DIM + "↓ " + (list.length - 14) + " more" + RESET);
      if (panel.query) rows.push("", indent + P.DIM + "filter: " + RESET + panel.query);
      return rows;
    }
    function resumeKey(e) {
      var k = e.key, list = panel.shown || [];
      if (k === "Escape") { if (panel.query) panel.query = ""; else return closePanel(); }
      else if (k === "ArrowDown") panel.sel = Math.min(list.length - 1, panel.sel + 1);
      else if (k === "ArrowUp") panel.sel = Math.max(0, panel.sel - 1);
      else if (k === "Enter") { var pick = list[panel.sel]; panel = null; if (pick) rt.resume(pick.id); else renderInput(); return; }
      else if (k === "Backspace") panel.query = panel.query.slice(0, -1);
      else if (k.length === 1 && !e.metaKey && !e.ctrlKey) panel.query += k;
      else return;
      renderInput();
    }

    // ---- 设置（/config）：Status / Config / Usage / Stats / Help ----
    function openSettings(tab) {
      openPanel({ kind: "settings", tab: Math.max(0, TABS.indexOf(tab || "Config")), query: "", focus: tab === "Config" || !tab ? "search" : "tabs", sel: 0, scroll: 0, usage: null });
      loadUsage();
    }
    function loadUsage() { fetch("/api/usage").then(function (r) { return r.json(); }).then(function (u) { if (panel && panel.kind === "settings") { panel.usage = u; renderInput(); } }, function () {}); }
    function settingsItems() {
      var onOff = function (k) { return { value: function () { return String(cfg[k] !== false); }, next: function () { A.setCfg(k, cfg[k] === false); } }; };
      var cyc = function (k, vals) { return { value: function () { return cfg[k]; }, next: function () { A.setCfg(k, vals[(vals.indexOf(cfg[k]) + 1) % vals.length]); }, prev: function () { A.setCfg(k, vals[(vals.indexOf(cfg[k]) + vals.length - 1) % vals.length]); } }; };
      var m = rt.model();
      return [
        { name: "Model", note: "按 Enter 打开选择", value: function () { return m ? m.name : "—"; }, next: function () { closePanel(); pickModel(); } },
        { name: "Effort (thinking)", value: function () { return agent.effort || "high"; }, next: function () { var E = A.EFFORTS; rt.setEffort(E[(E.indexOf(agent.effort || "high") + 1) % E.length]); }, prev: function () { var E = A.EFFORTS; rt.setEffort(E[(E.indexOf(agent.effort || "high") + E.length - 1) % E.length]); } },
        Object.assign({ name: "Thinking display (/thinking)" }, cyc("thinking", THINKING)),
        { name: "Verbose tool output (ctrl+o)", value: function () { return String(verbose); }, next: function () { verbose = !verbose; P.renderNow(); } },
        { name: "Theme", value: function () { var p = termPref(); return p === "auto" ? "Auto (follow system)" : p === "light" ? "Light mode" : "Dark mode"; },
          next: function () { var n = { auto: "light", light: "dark", dark: "auto" }[termPref()]; if (n === "auto") localStorage.removeItem("tsu-term"); else localStorage.setItem("tsu-term", n); allPanes().forEach(function (p) { p.renderNow(); }); } },
        { name: "Font size", value: function () { return (localStorage.getItem("tsu-font") || 12) + " px"; }, next: function () { TSU_APP.setFont(Math.min(18, +(localStorage.getItem("tsu-font") || 12) + 1)); }, prev: function () { TSU_APP.setFont(Math.max(11, +(localStorage.getItem("tsu-font") || 12) - 1)); } },
        Object.assign({ name: "Web search" }, onOff("webSearch")),
        Object.assign({ name: "Web fetch" }, onOff("webFetch")),
        Object.assign({ name: "Sandbox tools (Bash, Read, Write, Edit…)" }, onOff("sandbox")),
        Object.assign({ name: "Auto-scroll" }, onOff("autoscroll")),
        Object.assign({ name: "Show tips" }, onOff("tips")),
        Object.assign({ name: "Copy on select" }, onOff("copyOnSelect")),
        Object.assign({ name: "Time format" }, cyc("time", ["12h", "24h"])),
        Object.assign({ name: "Long lines (code, diffs, output)", note: "wrap = 折行（默认） · clip = 截断" }, cyc("wrap", ["wrap", "clip"])),
      ];
    }
    function filtered() { var q = panel.query.toLowerCase(); return settingsItems().filter(function (it) { return !q || it.name.toLowerCase().indexOf(q) >= 0 || it.value().toLowerCase().indexOf(q) >= 0; }); }
    function bar(frac, width) { var n = Math.round(Math.max(0, Math.min(1, frac)) * width); return "\x1b[48;2;177;185;249m" + " ".repeat(n) + "\x1b[48;2;78;80;110m" + " ".repeat(width - n) + RESET; }
    function kv(k, v) { return "  " + pad(k, 22) + v; }
    function panelBody(fcols) {
      var t = TABS[panel.tab], lines = [], u = panel.usage, me = A.me(), D = P.DIM, m = rt.model();
      if (t === "Status") {
        var files = 0;
        try { SANDBOX.walk("/").forEach(function (k) { if (!SANDBOX.isDir(k)) files++; }); } catch (e) { /* 沙盒没好 */ }
        var c = rt.ctx(), pr = (me && me.pricing) || {};
        lines.push(kv("Version:", "code.paimon.beer · v" + A.SPIRIT.version),
          kv("Agent:", agent.name + D + "  id " + agent.id + " · " + rt.state() + RESET),
          kv("Session:", (rt.session().title || "(new)") + D + "  " + rt.session().id + RESET),
          kv("Account:", uiT(me && me.loggedIn ? me.login + (me.allowed ? "" : "（未获邀请）") : "未登录")),
          kv("Model:", m ? m.name + D + "  " + m.id + " · effort " + (agent.effort || "high") + RESET : "—"),
          kv("Pricing:", pr.currency ? uiT(pr.peak ? "高峰价" : "平时价（半价）") + D + "  " + uiT("高峰：" + (pr.peakHours || "")) + RESET : "—"),
          kv("Balance:", me && me.loggedIn ? F.money(me.balance) : "—"),
          kv("Home:", rt.home() + D + "  · cwd " + rt.cwd() + " · " + files + " files" + RESET),
          kv("Access outside home:", ACCESS_LABEL[agent.access || "read"][1]),
          kv("Context:", c.tokens ? F.k(c.tokens) + " tokens · " + c.pct.toFixed(1) + "% of " + F.k(c.window) : "—"));
      } else if (t === "Config") {
        var focusS = panel.focus === "search", bw = fcols - 4, bc = focusS ? LAV : D, q = panel.query ? panel.query : D + "Search settings…" + RESET;
        lines.push("  " + bc + "╭" + "─".repeat(bw - 2) + "╮" + RESET, "  " + bc + "│" + RESET + " ⌕ " + pad(q, bw - 6) + " " + bc + "│" + RESET, "  " + bc + "╰" + "─".repeat(bw - 2) + "╯" + RESET, "");
        var items = filtered();
        if (!items.length) lines.push("  " + D + "No settings match" + RESET);
        items.forEach(function (it, i) {
          var on = panel.focus === "list" && i === panel.sel;
          lines.push({ list: i, text: "  " + (on ? LAV + "❯ " : "  ") + pad(it.name, 40) + RESET + (on ? LAV : "") + it.value() + RESET + (it.note ? D + "   " + uiT(it.note) + RESET : "") });
        });
      } else if (t === "Usage") {
        var tot = { cost: 0, ms: 0 }, by = {}, first = Infinity, searches = 0;
        rt.session().turns.forEach(function (x) {
          if (x.at) first = Math.min(first, x.at);
          (x.parts || []).forEach(function (p) { if (p.kind === "tool" && p.name === "web_search") searches++; });
          if (!x.usage) return;
          tot.cost += x.usage.cost || 0; tot.ms += x.usage.ms || 0;
          var b = by[x.usage.model] = by[x.usage.model] || { in: 0, cache: 0, out: 0, cost: 0 };
          b.in += x.usage.in || 0; b.cache += x.usage.cache || 0; b.out += x.usage.out || 0; b.cost += x.usage.cost || 0;
        });
        lines.push("  " + BOLD + "Session" + RESET, "", kv("Total cost:", F.money(tot.cost)), kv("Total duration (API):", F.dur(tot.ms)),
          kv("Total duration (wall):", first < Infinity ? F.dur(Date.now() - first) : "—"), kv("Usage by model:", Object.keys(by).length ? "" : "—"));
        Object.keys(by).forEach(function (k) { var b = by[k]; lines.push("      " + k + ":  " + F.k(b.in) + " input, " + F.k(b.cache) + " cached, " + F.k(b.out) + " output (" + F.money(b.cost) + ")"); });
        if (searches) lines.push(kv("Web searches:", String(searches)));
        lines.push("", "  " + BOLD + "Credit" + RESET);
        if (!u) lines.push("  " + D + "Loading…" + RESET);
        else if (u.error) lines.push("  " + RED + u.error + RESET);
        else {
          var used = u.granted ? (u.granted - u.balance) / u.granted : 0;
          lines.push("  " + bar(used, 30) + " " + Math.round(used * 100) + "% used", "  " + D + F.money(u.balance) + " left of " + F.money(u.granted) + " granted" + RESET, "",
            kv("Last 24h:", F.money(u.spentDay)), kv("Last 7 days:", F.money(u.spentWeek)), "", "  " + BOLD + "Recent" + RESET);
          (u.rows || []).slice(0, 8).forEach(function (x) {
            lines.push("  " + D + new Date(x.at).toLocaleString(cfg.time === "24h" ? "en-GB" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + RESET + "  " +
              pad(x.kind === "tool" ? x.model || "tool" : x.kind, 8) + pad(x.kind === "tool" ? "" : x.model || "", 18) + (x.delta < 0 ? "-" : "+") + F.money(Math.abs(x.delta)).replace("-", "") + (x.note ? D + "  " + clip(x.note, 36) + RESET : ""));
          });
        }
      } else if (t === "Stats") {
        var all = A.allSessions(), tools = {}, asks = 0, bashN = 0, written = 0, days = {};
        all.forEach(function (x) { x.turns.forEach(function (tt) {
          if (tt.at) days[new Date(tt.at).toDateString()] = 1;
          if (tt.ask !== undefined && !tt.system) asks++;
          if (tt.bash !== undefined) bashN++;
          (tt.parts || []).forEach(function (p) { if (p.kind !== "tool") return; tools[p.name] = (tools[p.name] || 0) + 1; if (p.name === "Write" && p.detail) written += p.detail.length; if (p.diff) written += p.diff.filter(function (d) { return d.t === "+"; }).length; });
        }); });
        lines.push(kv("Agents:", String(A.list().length)), kv("Sessions:", String(all.filter(function (x) { return x.turns.length; }).length)), kv("Messages:", String(asks)), kv("Shell commands (!):", String(bashN)),
          kv("Lines written:", String(written)), kv("Active days:", String(Object.keys(days).length)), "", "  " + BOLD + "Tool calls" + RESET);
        var names = Object.keys(tools).sort(function (a, b) { return tools[b] - tools[a]; }), max = names.length ? tools[names[0]] : 1;
        if (!names.length) lines.push("  " + D + "—" + RESET);
        names.forEach(function (n) { lines.push("  " + pad(n, 14) + bar(tools[n] / max, 20) + " " + tools[n]); });
      } else {
        lines.push("  " + BOLD + "Commands" + RESET);
        COMMANDS.forEach(function (x) { if (!x.admin || (A.me() || {}).admin) lines.push("  " + pad(x.name, 14) + D + uiT(x.desc) + RESET); });
        lines.push("  " + pad(uiT("!命令"), 14) + D + uiT("在沙盒中执行 Shell 命令，输出同时提供给 Agent") + RESET, "", "  " + BOLD + "Shortcuts" + RESET);
        [["Enter / Shift+Enter", "发送 / 换行"], ["Ctrl+Enter", "回答过程中立即发送（中断当前回合；空输入时发送排队消息）"], ["↑ ↓", "历史"], ["Esc", "中断；有排队消息时先取回"], ["← (空输入)", "所有 Agent"], ["↓ (空输入)", "后台任务"],
          ["Shift+Tab", "工作目录外的权限"], ["Ctrl+T", "任务清单：收起 / 展开"], ["Ctrl+O", "展开所有工具输出"], ["Ctrl+B", "将运行中的命令转到后台"], ["Ctrl+C ×2", "返回 Shell（Agent 在后台继续运行）"]].forEach(function (k) { lines.push("  " + pad(uiT(k[0]), 22) + D + uiT(k[1]) + RESET); });
      }
      return lines;
    }
    function settingsRows(fcols, indent) {
      var rows = [], map = panel.map, caretAt = null;
      var tabLine = indent + LAV + BOLD + "Settings" + RESET + "  ", tabCols = [], col = indent.length + 10;
      TABS.forEach(function (t, i) {
        tabCols.push([col, col + t.length + 2, i]);
        col += t.length + 3;
        if (i === panel.tab) tabLine += (panel.focus === "tabs" ? "\x1b[48;2;177;185;249m\x1b[38;2;0;0;0m" : "\x1b[48;2;90;90;96m\x1b[38;2;240;240;240m") + " " + t + " " + RESET + " ";
        else tabLine += " " + t + "  ";
      });
      map[2] = { tabs: tabCols };
      rows.push(tabLine, "");
      var body = panelBody(fcols), room = Math.max(4, Math.floor((P.el.clientHeight - P.rowH * 8) / P.rowH) - 4);
      var selRow = body.findIndex(function (l) { return typeof l === "object" && l.list === panel.sel && panel.focus === "list"; });
      if (selRow >= 0) { if (selRow < panel.scroll) panel.scroll = selRow; if (selRow >= panel.scroll + room) panel.scroll = selRow - room + 1; }
      panel.scroll = Math.max(0, Math.min(panel.scroll, body.length - room));
      if (TABS[panel.tab] === "Config") map[rows.length + 2 + 1 - panel.scroll] = { search: true };
      body.slice(panel.scroll, panel.scroll + room).forEach(function (l) { if (typeof l === "object") map[rows.length + 2] = { item: l.list }; rows.push(typeof l === "object" ? l.text : l); });
      if (body.length > panel.scroll + room) rows.push(indent + P.DIM + "↓ " + (body.length - panel.scroll - room) + " more below" + RESET);
      if (TABS[panel.tab] === "Config" && panel.focus === "search") caretAt = { row: 2 + 2 + 1, col: 2 + 4 + W(panel.query) };
      var hint = TABS[panel.tab] === "Config" ? (panel.focus === "search" ? "Type to filter · Enter/↓ to select · ↑ to tabs · Esc to " + (panel.query ? "clear" : "close") : "←/→ or click to change · ↑↓ to move · Esc to close") : "←/→ to switch tabs · ↑↓ to scroll · Esc to close";
      rows.push("", indent + P.DIM + hint + RESET);
      panel.caretAt = caretAt;
      return rows;
    }
    function settingsKey(e) {
      var k = e.key, tab = TABS[panel.tab], items = tab === "Config" ? filtered() : [];
      if (k === "Escape") { if (tab === "Config" && panel.query) { panel.query = ""; panel.sel = 0; } else return closePanel(); }
      else if ((panel.focus === "tabs" || tab !== "Config") && (k === "ArrowLeft" || k === "ArrowRight" || k === "Tab")) {
        panel.tab = (panel.tab + (k === "ArrowLeft" ? TABS.length - 1 : 1)) % TABS.length;
        panel.scroll = 0;
        panel.focus = "tabs";
        loadUsage();
      } else if (tab === "Config") {
        if (panel.focus === "tabs") { if (k === "ArrowDown" || k === "Enter") panel.focus = "search"; else if (k.length === 1) { panel.focus = "search"; panel.query += k; } }
        else if (panel.focus === "search") {
          if (k === "ArrowDown" || k === "Enter") { if (items.length) { panel.focus = "list"; panel.sel = 0; } }
          else if (k === "ArrowUp") panel.focus = "tabs";
          else if (k === "Backspace") panel.query = panel.query.slice(0, -1);
          else if (k.length === 1 && !e.metaKey && !e.ctrlKey) { panel.query += k; panel.sel = 0; }
          else return;
        } else {
          if (k === "ArrowDown") panel.sel = Math.min(items.length - 1, panel.sel + 1);
          else if (k === "ArrowUp") { if (panel.sel === 0) panel.focus = "search"; else panel.sel--; }
          else if (k === "Enter" || k === " " || k === "ArrowRight") { if (items[panel.sel]) items[panel.sel].next(); }
          else if (k === "ArrowLeft") { var it0 = items[panel.sel]; if (it0) (it0.prev || it0.next)(); }
          else if (k.length === 1 && !e.metaKey && !e.ctrlKey) { panel.focus = "search"; panel.query += k; panel.sel = 0; }
          else return;
        }
      } else {
        if (k === "ArrowDown") panel.scroll++;
        else if (k === "ArrowUp") panel.scroll = Math.max(0, panel.scroll - 1);
        else return;
      }
      if (panel) renderInput();
    }

    var ABOVE = { pick: 1, effort: 1, ask: 1 };
    function panelAbove(fcols, indent) {
      var rows = panel.kind === "effort" ? effortRows(fcols, indent) : panel.kind === "ask" ? askRows(fcols, indent) : pickRows(fcols, indent);
      return rows.concat([""]);
    }
    // ---- 它在问你（Claude Code 的 AskUserQuestion）：同它自己的问答——顶上一排问题（☐ 没答 / ☒ 答了）· ✔ Submit，
    //   下面当前这一问：❯ 1. 选项（后面淡的说明），多选的是 [ ] / [✔]；最后一项「Type something」自己写。↑↓ 选、回车定（多选是切换）、←→ / Tab 换问题、数字直接选、Esc 先收起（它还在等，底下点「回答」再打开）
    // 稍后再答：选了一半、写了一半的回答记着（同一问再打开时接着；问题卡片那边也用这一份）
    var askDrafts = window.TSU_ASKDRAFT = window.TSU_ASKDRAFT || {};
    function openAsk(q) { if (!q) return; var d = askDrafts[q.id]; openPanel({ kind: "ask", q: q, qi: d ? Math.min(d.qi || 0, q.questions.length - 1) : 0, sel: 0, ans: d && d.ans && d.ans.length === q.questions.length ? JSON.parse(JSON.stringify(d.ans)) : q.questions.map(function () { return { pick: [], text: "" }; }) }); }
    function askKeep() { if (!panel || panel.kind !== "ask") return; if (panel.typing) { var tv = String(P.ta.value || "").trim(); if (tv) panel.ans[panel.qi].text = tv; } askDrafts[panel.q.id] = { qi: panel.qi, ans: JSON.parse(JSON.stringify(panel.ans)) }; }
    function askDone(a) { return a.pick.length > 0 || !!a.text; }
    function askRows(fcols, indent) {
      var q = panel.q, qs = q.questions, D = P.DIM, map = panel.map, rows = [];
      var tabs = qs.map(function (x, i) { var on = i === panel.qi && !panel.review; return (on ? LAV + BOLD : D) + (askDone(panel.ans[i]) ? "☒ " : "☐ ") + clip(String(x.header || "Q" + (i + 1)), 16) + RESET; });
      var one = qs.length === 1 && !qs[0].multiSelect; // 只有一问、单选：没有「Submit」那一格，选了就交（同 Claude Code 的 hideSubmitTab）
      if (!one) tabs.push((panel.review ? LAV + BOLD : D) + "✔ Submit" + RESET);
      rows.push(indent + D + "← " + RESET + tabs.join("  ") + D + " →" + RESET, "");
      if (panel.review) {
        rows.push(indent + BOLD + "Review your answers" + RESET, "");
        qs.forEach(function (x, i) { var a = panel.ans[i]; rows.push(indent + "  " + D + "● " + RESET + clip(String(x.question || ""), fcols - 10)); rows.push(indent + "    " + LAV + "→ " + RESET + clip(askText(x, a) || "(no answer)", fcols - 12)); });
        rows.push("");
        map[rows.length] = { askSubmit: true };
        rows.push(indent + (panel.sel === 0 ? LAV + "❯ " : "  ") + "1. Submit answers" + RESET);
        map[rows.length] = { askCancel: true };
        rows.push(indent + (panel.sel === 1 ? LAV + "❯ " : "  ") + "2. Cancel" + RESET);
        rows.push("", indent + D + "Enter to confirm · ← to go back · Esc to hide" + RESET);
        return rows;
      }
      var x = qs[panel.qi], a = panel.ans[panel.qi], opts = x.options || [], multi = !!x.multiSelect;
      var tq = function (s0) { s0 = String(s0 || ""); return window.TSU_TRANSLATE && TSU_TRANSLATE.text ? TSU_TRANSLATE.text(s0, agentId) || s0 : s0; }; // 问题、选项、说明按「任务翻译」译出来看（交回去的还是原文）
      wrap(tq(x.question), fcols - 4).forEach(function (l) { rows.push(indent + BOLD + l + RESET); });
      rows.push("");
      opts.concat([{ label: "Type something", other: true }]).forEach(function (o, i) {
        var on = i === panel.sel, chosen = o.other ? !!a.text : a.pick.indexOf(i) >= 0;
        var mark = multi ? (chosen ? "[✔] " : "[ ] ") : (i + 1) + ". ";
        map[rows.length] = { askOpt: i };
        var typed = o.other && on && panel.typing ? String(P.ta.value || "").replace(/\s+/g, " ").trim() : "", lab = o.other && (typed || a.text) ? "Type something: " + (typed || a.text) : o.other ? "Type something" : tq(o.label);
        rows.push(indent + (on ? LAV + "❯ " : "  ") + mark + clip(lab, Math.max(12, fcols - 10)) + (chosen && !multi ? " ✔" : "") + RESET + (o.other && on && !typed ? D + (panel.typing ? "  type your answer below, Enter to submit" : "  Enter to type your answer") + RESET : ""));
        if (o.description) wrap(tq(o.description), fcols - 10).slice(0, 2).forEach(function (l) { rows.push(indent + "     " + D + l + RESET); });
      });
      if (multi) { map[rows.length] = { askNext: true }; rows.push(indent + (panel.sel === opts.length + 1 ? LAV + "❯ " : "  ") + (panel.qi === qs.length - 1 ? "Submit" : "Next") + RESET); }
      rows.push("", indent + D + (multi ? "Enter to toggle · " : "Enter to select · ") + "↑↓ to move · 1–" + Math.min(9, opts.length + 1) + " to choose · " + (qs.length > 1 || multi ? "Tab/←→ to switch questions · " : "") + "Esc to hide" + RESET + (panel.stash ? D + " · your draft comes back after you answer" + RESET : ""));
      return rows;
    }
    function askTyping() { if (!panel || panel.kind !== "ask" || panel.review) return false; var x = panel.q.questions[panel.qi]; return !!x && panel.sel === (x.options || []).length && !!panel.typing; }
    function askUnstash() { if (!panel || !panel.typing) return; P.ta.value = panel.stash || ""; panel.stash = ""; panel.typing = false; if (V.inputChanged) try { V.inputChanged("input"); } catch (e) { /* 没有也行 */ } }
    function askText(x, a) { var labs = a.pick.map(function (i) { return (x.options[i] || {}).label || ""; }).filter(Boolean); if (a.text) labs.push(a.text); return labs.join(", "); }
    function askSend() {
      askUnstash();
      delete askDrafts[panel.q.id];
      var q = panel.q, qs = q.questions, ans = panel.ans;
      var text = qs.length === 1 ? askText(qs[0], ans[0]) : qs.map(function (x, i) { return (x.question || x.header || "Q" + (i + 1)) + " → " + (askText(x, ans[i]) || "(no answer)"); }).join("\n");
      closePanel();
      askSeen = q.id;
      P.flash(uiT("回答已送出"), 1500);
      rt.answerQuestion(text).catch(function (e) { P.flash(String(e.message || e), 4000); askSeen = null; });
    }
    function askNextQ() { if (panel.qi < panel.q.questions.length - 1) { panel.qi++; panel.sel = 0; } else { panel.review = true; panel.sel = 0; } }
    function askKey(e) {
      var k = e.key, q = panel.q, qs = q.questions;
      if (k === "Escape") { askKeep(); askUnstash(); closePanel(); askHidden = q.id; return; } // 稍后：写了一半的记着
      if (panel.review) {
        if (k === "ArrowUp" || k === "ArrowDown") panel.sel = panel.sel ? 0 : 1;
        else if (k === "ArrowLeft" || (k === "Tab" && e.shiftKey)) { panel.review = false; panel.qi = qs.length - 1; panel.sel = 0; }
        else if (k === "Enter" || k === "1" || k === "2") { if (k === "2" || (k === "Enter" && panel.sel === 1)) { closePanel(); askHidden = q.id; return; } return askSend(); }
        else return;
        return renderInput();
      }
      var x = qs[panel.qi], a = panel.ans[panel.qi], n = (x.options || []).length, multi = !!x.multiSelect, last = multi ? n + 1 : n;
      // 「Type something」：交的是下面输入框里打的字（打完回车）；还没打字时点它 / 回车只是选上它、光标进输入框
      // 「Type something」：第一次回车——输入框腾出来给你写回答（里面原来打着的话先收起来，答完放回去）；写好了再回车交
      var pickOther = function () {
        if (!panel.typing) { panel.stash = panel.stash || P.ta.value || ""; P.ta.value = a.text || ""; panel.typing = true; P.focus(); renderInput(); return; }
        var tv = String(P.ta.value || "").trim();
        if (!tv) { P.focus(); renderInput(); return; }
        a.text = tv; askUnstash();
        if (!multi) { a.pick = []; if (qs.length === 1) return askSend(); askNextQ(); }
        renderInput();
      };
      if (panel.typing && (k === "ArrowUp" || k === "ArrowDown" || k === "Tab" || k === "ArrowLeft" || k === "ArrowRight")) { var tv0 = String(P.ta.value || "").trim(); if (tv0) a.text = tv0; askUnstash(); } // 离开「Type something」：写了一半的回答记着，原来的话放回输入框
      if (k === "ArrowDown") panel.sel = Math.min(last, panel.sel + 1);
      else if (k === "ArrowUp") panel.sel = Math.max(0, panel.sel - 1);
      else if (k === "ArrowRight" || (k === "Tab" && !e.shiftKey)) { if (!(qs.length === 1 && !multi)) askNextQ(); }
      else if (k === "ArrowLeft" || (k === "Tab" && e.shiftKey)) { if (panel.qi > 0) { panel.qi--; panel.sel = 0; } }
      else if (/^[1-9]$/.test(k) && +k - 1 <= n) { panel.sel = +k - 1; return askKey({ key: "Enter" }); }
      else if (k === "Enter" || k === " ") {
        if (panel.sel === n) { pickOther(); return; }
        if (multi && panel.sel === n + 1) { askNextQ(); }
        else if (multi) { var ix = a.pick.indexOf(panel.sel); if (ix >= 0) a.pick.splice(ix, 1); else a.pick.push(panel.sel); }
        else { a.pick = [panel.sel]; a.text = ""; if (qs.length === 1) return askSend(); askNextQ(); }
      } else return;
      renderInput();
    }
    var askSeen = null, askHidden = null;
    // 它开始问了：自动打开（同一问只自动开一次；收起了就在底下给一句「它在问你 · 回答」）
    function askWatch() {
      if (!agent.claude || !rt.question) return;
      var q = rt.question();
      if (!q) { if (panel && panel.kind === "ask") closePanel(); return; }
      if (panel && panel.kind === "ask") { if (panel.q.id !== q.id) openAsk(q); return; }
      if (panel || q.id === askSeen || q.id === askHidden) return;
      openAsk(q);
    }
    V.openAsk = function () { var q = rt.question && rt.question(); if (q) { askHidden = null; openAsk(q); } };
    function renderPanel(fcols, indent) {
      var rows = ["", ""]; // 顶上不画线（以前是一条淡紫的横线）
      panel.map = {};
      panel.caretAt = null;
      var body = panel.kind === "cc" ? ccRows() : panel.kind === "island" ? islandRows(fcols, indent) : panel.kind === "agents" ? agentsRows(fcols, indent) : panel.kind === "tasks" ? tasksRows(fcols, indent) : panel.kind === "resume" ? resumeRows(fcols, indent)
        : panel.kind === "pick" ? pickRows(fcols, indent) : settingsRows(fcols, indent);
      // map 的行号是相对 body 的：加上顶上两行
      var shifted = {};
      Object.keys(panel.map).forEach(function (k) { shifted[+k + 2] = panel.map[k]; });
      if (panel.kind === "settings") shifted = panel.map; // settingsRows 自己已经算上了
      panel.map = shifted;
      rows = rows.concat(body);
      if (panel.full) { var total = Math.floor(P.el.clientHeight / P.rowH) - 1; while (rows.length < total) rows.push(""); }
      P.input.innerHTML = logoMarks(P.rowsHtml(rows, P.footCols())); // 会话列表里的 Claude / OpenAI 标志（\uE030 / \uE035）换成图标
      if (rows.length !== lastFootRows) { lastFootRows = rows.length; P.fit(); P.stick(); }
      if (panel.caretAt) P.drawCaret({ where: "foot", row: panel.caretAt.row, col: panel.caretAt.col, ch: "" });
      else P.hideCaret();
    }
    // 输入框里的字能用鼠标选（同普通的输入框）：按下定一头、拖着选、双击选一个词、三击选整段；shift+点 接着上次的选区
    var inMap = null;
    // 光标上 / 下挪一行（按画出来的折行；列按字宽算：中文两格）；已经在第一 / 最后一行返回 false（交给翻历史）
    function caretVMove(dir) {
      var ta = P.ta;
      if (!inMap || !inMap.wl || ta.selectionStart !== ta.selectionEnd) return false;
      var wl = inMap.wl, pos = ta.selectionStart - inMap.off, row = 0;
      if (pos < 0) return false;
      for (var i = 0; i < wl.length; i++) { var nx = wl[i + 1]; if (!nx || pos < nx.start) { row = i; break; } }
      var tgt = row + dir;
      if (tgt < 0 || tgt >= wl.length) return false;
      var col = W(inMap.shown.slice(wl[row].start, pos)) + (row ? 0 : inMap.chipsW), l = wl[tgt], acc = tgt ? 0 : inMap.chipsW, n = 0, cs = Array.from(l.text);
      for (var j = 0; j < cs.length; j++) { var w = W(cs[j]); if (acc + w / 2 > col) break; acc += w; n += cs[j].length; }
      var np = inMap.off + l.start + n;
      ta.setSelectionRange(np, np);
      renderInput();
      return true;
    }
    function inOffset(e) {
      if (!inMap) return -1;
      var fc = P.footCell ? P.footCell() : { cw: P.chPx, rh: P.rowH, padL: 0, padT: parseFloat(getComputedStyle(P.foot).paddingTop) || 0 }, r = P.foot.getBoundingClientRect();
      var row = Math.floor((e.clientY - r.top - fc.padT) / fc.rh) - inMap.row0 - (inMap.pre || 0), wl = inMap.wl;
      if (row < 0) return inMap.off; if (row >= wl.length) return inMap.off + inMap.shown.length;
      var l = wl[row], x = (e.clientX - r.left - fc.padL) / fc.cw - inMap.textCol - (row ? 0 : inMap.chipsW), acc = 0, i = 0, cs = Array.from(l.text), n = 0;
      for (; i < cs.length; i++) { var w = W(cs[i]); if (acc + w / 2 > x) break; acc += w; n += cs[i].length; }
      return inMap.off + l.start + n;
    }
    function inSelect(e) {
      var o = inOffset(e);
      if (o < 0) return false;
      var ta = P.ta, v = ta.value;
      e.preventDefault();
      ta.focus({ preventScroll: true });
      if (e.detail >= 3) { ta.setSelectionRange(0, v.length, "forward"); renderInput(); return true; } // 三击：整段
      if (e.detail === 2) { // 双击：一个词（中文按连着的字、英文按字母数字）
        var re = /[\p{L}\p{N}_]/u, a = o, b = o;
        while (a > 0 && re.test(v[a - 1])) a--; while (b < v.length && re.test(v[b])) b++;
        if (a === b && b < v.length) b++;
        ta.setSelectionRange(a, b, "forward"); renderInput(); return true;
      }
      var anchor = e.shiftKey ? (ta.selectionDirection === "backward" ? ta.selectionEnd : ta.selectionStart) : o;
      var set = function (f) { if (f >= anchor) ta.setSelectionRange(anchor, f, "forward"); else ta.setSelectionRange(f, anchor, "backward"); renderInput(); };
      set(o);
      var mv = function (ev) { var f = inOffset(ev); if (f >= 0) set(f); };
      var up = function () { document.removeEventListener("mousemove", mv, true); document.removeEventListener("mouseup", up, true); };
      document.addEventListener("mousemove", mv, true);
      document.addEventListener("mouseup", up, true);
      return true;
    }
    V.footDown = function (e) {
      if (!panel && e.button === 0 && inSelect(e)) return;
      if (!panel || !panel.map) return; // 底部只有在跑的那一行、输入框、状态行（子 agent 在辅助侧栏）：没有能点的行
      var padT = parseFloat(getComputedStyle(P.foot).paddingTop) || 0; // 底部上面的内边距：行从内容的第一行算起（同光标）
      var r = P.foot.getBoundingClientRect(), row = Math.floor((e.clientY - r.top - padT) / P.rowH), col = Math.floor((e.clientX - r.left) / P.chPx), m = panel.map[row];
      if (!m) return;
      e.preventDefault();
      if (m.cc !== undefined) { ccClick(e, m.cc); P.focus(); return; }
      if (m.tabs) { var hit = m.tabs.find(function (t) { return col >= t[0] - 1 && col <= t[1] + 1; }); if (hit) { panel.tab = hit[2]; panel.scroll = 0; panel.focus = TABS[hit[2]] === "Config" ? "search" : "tabs"; loadUsage(); } }
      else if (m.search) panel.focus = "search";
      else if (m.item !== undefined) { var items = filtered(); if (panel.focus === "list" && panel.sel === m.item && items[m.item]) items[m.item].next(); panel.focus = "list"; panel.sel = m.item; }
      else if (m.opt !== undefined) { if (panel.sel === m.opt) return pickKey(panel.multi ? { key: " " } : { key: "Enter" }); panel.sel = m.opt; }
      else if (m.askOpt !== undefined) { panel.sel = m.askOpt; return askKey({ key: "Enter" }); }
      else if (m.askNext) { panel.sel = ((panel.q.questions[panel.qi].options || []).length) + 1; return askKey({ key: "Enter" }); }
      else if (m.askSubmit) { panel.sel = 0; return askKey({ key: "Enter" }); }
      else if (m.askCancel) { panel.sel = 1; return askKey({ key: "Enter" }); }
      else if (m.resume !== undefined) { if (panel.sel === m.resume) return resumeKey({ key: "Enter" }); panel.sel = m.resume; }
      else if (m.agent !== undefined) { if (panel.sel === m.agent) return agentsKey({ key: "Enter" }); panel.sel = m.agent; }
      else if (m.island !== undefined) { if (panel.sel === m.island) return islandKey({ key: "Enter" }); panel.sel = m.island; }
      else if (m.task !== undefined) { if (panel.sel === m.task) return tasksKey({ key: "Enter" }); panel.sel = m.task; }
      P.focus();
      if (panel) renderInput();
    };
    function panelKey(e) {
      if (panel.kind === "cc") return ccKey(e);
      if (panel.kind === "island") return islandKey(e);
      if (panel.kind === "agents") return agentsKey(e);
      if (panel.kind === "tasks") return tasksKey(e);
      if (panel.kind === "resume") return resumeKey(e);
      if (panel.kind === "pick") return pickKey(e);
      if (panel.kind === "effort") return effortKey(e);
      if (panel.kind === "ask") return askKey(e);
      return settingsKey(e);
    }

    // ---- 命令：回应记进对话（❯ /cmd ⎿ 结果，同 Claude Code），不发给模型；要选的打开选择器 ----
    function command(text) {
      var parts = text.trim().split(/\s+/), c = parts[0], arg = parts.slice(1).join(" ");
      if (c === "/admin") { A.adminCommand(arg).then(function (msg) { rt.record(text, msg); }); return; }
      if (c === "/context" && window.TSU_CTX) { TSU_CTX.open(rt, P.ta || P.el, { tui: true }); return; } // 上下文窗口的明细（ctxmap.js）：贴着输入框的一张卡片，不记进对话
      if (c === "/model") { if (!arg) return pickModel(); var want = arg.toLowerCase(), hit = A.models().find(function (m) { return m.id.toLowerCase().indexOf(want) >= 0 || m.name.toLowerCase().indexOf(want) >= 0; }); if (!hit) return rt.record(text, "No such model: " + arg); rt.setModel(hit.id); return rt.record(text, "Set model to " + hit.name); }
      if (c === "/effort") { if (!arg) return pickEffort(); if (!rt.setEffort(arg.toLowerCase())) return rt.record(text, "Effort must be one of: " + A.EFFORTS.join(", ")); return rt.record(text, "Set effort to " + agent.effort); }
      if (c === "/agents") return openAgents();
      if (c === "/tasks" || c === "/bashes") return openTasks();
      // /<agent 的名字>：切到那个 agent（同终端里敲 paimon <名字>）
      var toA = A.byName(c.slice(1));
      if (toA && !COMMANDS.some(function (x) { return x.name === c; })) { if (toA.archived) A.unarchive(toA.id); if (toA.id === agentId) return; return P.run(makeView(P, toA.id)); }
      if (c === "/rename") { if (!arg) return rt.record(text, "Usage: /rename <new name>"); var err = rt.rename(arg); P.win.syncTitles(); return rt.record(text, err || "Renamed to " + agent.name + " (id " + agent.id + " unchanged)"); }
      if (c === "/permissions" || c === "/access") return pickAccess();
      if (c === "/recap") { P.flash("Writing a recap…", 2500); rt.recap().then(function (t) { if (!t) P.flash("Couldn't write a recap (not signed in, or the model didn't answer)", 3000); }); return; }
      if (c === "/goal") {
        var g = agent.goal;
        if (!arg) return rt.record(text, g ? "Goal: " + g.text + " · 已检查 " + g.iterations + " 次" + (g.last ? " · 上次：" + g.last : "") + (g.paused ? " · 已暂停（发送消息以继续）" : "") + "\n/goal clear 取消 · /goal <条件> 更换" : "No goal set. 用法：/goal <条件>（每轮结束后检查，未达成则继续）");
        if (/^(clear|stop|off|取消)$/i.test(arg)) return rt.record(text, rt.clearGoal() ? "Goal cleared" : "No goal set");
        rt.setGoal(arg);
        rt.record(text, "Goal set: " + arg);
        if (!rt.stream) rt.send("[goal] New goal set by the user: " + arg + "\nWork toward it now; after each of your turns a separate check decides whether it is met.", [], { system: true, reason: "goal set", goal: true });
        return;
      }
      if (c === "/statusline") return pickStatusline();
      if (c === "/config" || c === "/settings") { if (window.STUDIO && document.documentElement.classList.contains("termapp")) { P.ta.value = ""; renderInput(); return STUDIO.settings(P.win, "paimon"); } return openSettings("Config"); } // Paimon Terminal：设置是个窗口（Studio）
      var tabs = { "/status": "Status", "/usage": "Usage", "/cost": "Usage", "/stats": "Stats", "/help": "Help" };
      if (tabs[c]) return openSettings(tabs[c]);
      if (c === "/thinking") { A.setCfg("thinking", THINKING[(THINKING.indexOf(cfg.thinking) + 1) % 3]); return P.flash("Thinking: " + cfg.thinking); }
      if (c === "/export") { exportMd(); return; }
      if (c === "/exit" || c === "/quit") return exit();
      if (c === "/logout") { location.href = "/auth/logout"; return; }
      rt.record(text, "Unknown command: " + c + " · /help lists commands");
    }
    function exportMd() {
      var s = rt.session(), md = "# " + agent.name + " · " + (s.title || "会话") + "\n\n" + s.turns.filter(function (t) { return t.ask !== undefined && !t.system; }).map(function (t) {
        return "## ❯ " + t.ask.split("\n")[0] + "\n\n" + (t.ask.indexOf("\n") >= 0 ? "> " + t.ask.split("\n").join("\n> ") + "\n\n" : "") + (t.answer || "") + (t.error ? "\n\n_" + t.error + "_" : "") + "\n";
      }).join("\n");
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
      a.download = agent.name + "-" + fileStamp() + ".md";
      a.click();
      rt.record("/export", "Exported " + a.download);
    }
    function exit() { P.run(P.shell); P.shell.returned(agentId); }
    V.exit = exit;
    V.exit = exit;
    function ctrlC() {
      if (Date.now() - lastCtrlC < 1500) return exit();
      lastCtrlC = Date.now();
      P.flash("Press Ctrl-C again to exit", 1500);
    }

    // 退回输入框的那一句（打断时它还没回）：字放回输入框（输入框里已经有字的：放在前面，空一行），附的图照原来的号跟回来，光标在最后
    function editAgain(d) {
      var ta = P.ta, t0 = String(d.text || "");
      (d.images || []).forEach(function (im, i) {
        var no = im && im.no ? im.no : 0, tag = no ? "[Image #" + no + "]" : "";
        if (!tag || t0.indexOf(tag) < 0) { no = takeNo(); tag = "[Image #" + no + "]"; t0 = tag + " " + t0; }
        attach.push({ no: no, tag: tag, media_type: (im && im.media_type) || "image/png", data: (im && im.data) || "", path: (im && im.path) || "" });
      });
      ta.value = t0 + (ta.value ? "\n\n" + ta.value : "");
      try { ta.selectionStart = ta.selectionEnd = ta.value.length; } catch (e) { /* 没有焦点 */ }
      draftSet(agentId, ta.value, pastes);
      renderInput();
      P.focus();
    }
    // ---- 图片：粘贴 / 拖入，长边缩到 1568 以内再发 ----
    // 编号（同 Claude Code：图和粘贴的长文字共用一个号，整个会话一直往上数，不是每句从 #1 起）：Claude Code 的会话照它记录里的号往下接（claude.js）；
    //   Codex 每句从 #1 起（同它自己给图起的名字）；Paimon 的 agent 按这个会话里用过的最大号往下接
    function takeNo() {
      if (rt.takeImageNo) return rt.takeImageNo();
      var mx = 0, see = function (n) { n = +n; if (n > mx) mx = n; }, refs = function (t) { String(t || "").replace(/\[(?:Image|Pasted text|\.\.\.Truncated text) #(\d+)/g, function (a, n) { see(n); return a; }); };
      if (agent.connector !== "codex") rt.session().turns.forEach(function (t) { refs(t.ask); (t.images || []).forEach(function (im) { if (im && im.no) see(im.no); }); });
      attach.forEach(function (a) { see(a.no || 0); });
      refs(P.ta.value);
      return mx + 1;
    }
    // 在光标处插「[Image #N]」（同 Claude Code：图就在你粘贴的那个位置，字里删掉这几个字就是不要这张图）；图解出来、缩好了再跟上
    // 选图（系统的选取器：相册、拍照、文件）：选好的一张张按粘贴进来的那样插在光标处（[Image #N]）
    function pickImages() {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
      inp.style.cssText = "position:fixed;left:-1000px;top:0;opacity:0";
      inp.addEventListener("change", function () { Array.prototype.forEach.call(inp.files || [], function (f) { addImage(f); }); inp.remove(); });
      document.body.appendChild(inp);
      inp.click();
    }
    function addImage(file, fail) {
      if (!file || !/^image\//.test(file.type)) return fail && fail();
      var ta = P.ta, no = takeNo(), a = { no: no, tag: "[Image #" + no + "]", media_type: "", data: "" };
      ta.setRangeText(a.tag, ta.selectionStart, ta.selectionEnd, "end");
      attach.push(a);
      draftSet(agentId, ta.value, pastes);
      renderInput();
      var img = new Image(), url = URL.createObjectURL(file);
      img.onerror = function () { // 解不开的（有的 HEIC、TIFF）：拿掉这个号，交回去插路径
        URL.revokeObjectURL(url);
        var at = ta.value.indexOf(a.tag);
        if (at >= 0) ta.setRangeText("", at, at + a.tag.length, "end");
        attach = attach.filter(function (x) { return x !== a; });
        renderInput();
        if (fail) fail();
      };
      img.onload = function () {
        var k = Math.min(1, 1568 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        var type = file.type === "image/png" ? "image/png" : "image/jpeg", data = c.toDataURL(type, 0.9);
        a.media_type = type; a.data = data.slice(data.indexOf(",") + 1);
        URL.revokeObjectURL(url);
        renderInput();
      };
      img.src = url;
    }
    V.paste = function (e) {
      var text = e.clipboardData && e.clipboardData.getData("text/plain"), ta = P.ta;
      if (panel && panel.kind === "cc" && ccT) { e.preventDefault(); if (text) ccT.tui.send(ccT.paste ? "\x1b[200~" + text + "\x1b[201~" : text); return; }
      if (text && (text.split("\n").length > 10 || text.length > 1000)) {
        e.preventDefault();
        text = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
        var nl = (text.match(/\r\n|\r|\n/g) || []).length, pn = takeNo(), tag = "[Pasted text #" + pn + (nl ? " +" + nl + " lines]" : "]"); // 同 Claude Code：和图共用一个号
        pastes.push({ tag: tag, text: text, no: pn });
        ta.setRangeText(tag, ta.selectionStart, ta.selectionEnd, "end");
        draftSet(agentId, ta.value, pastes);
        renderInput();
        return;
      }
      Array.prototype.forEach.call((e.clipboardData && e.clipboardData.items) || [], function (it) { if (it.kind === "file" && /^image\//.test(it.type)) { e.preventDefault(); addImage(it.getAsFile()); } });
    };
    V.drop = function (e) { Array.prototype.forEach.call(e.dataTransfer.files || [], function (f) { addImage(f); }); };
    V.attachFile = addImage; // 从访达、截图缩略图拖进来的图（原生那边给的是路径，读成文件再交过来）

    // ---- 按键 ----
    // 发出去、它还没读到的那几句（rt.pending）：「❯ 原话」——排在它队里的灰底淡字（同 Claude Code），在发的同平常的一问；
    //   附的图同已经发出去的：一张一行「⎿  [Image #N]」（悬停看、点开）；没送成的下面一行红的「未发送：原因 · 重试」（不再像是排进去了）；
    //   最后一行看 send now 的状态：能点（ctrl+x ctrl+s to send now）/ 点了在发（sending…，不能再点）/ 在压缩（压完自动发，不用点）
    function pendRows(r, list, D) {
      list.forEach(function (q) {
        if (q.from) { var fl = []; String(q.text || "").split("\n").forEach(function (p0) { fl.push.apply(fl, wrap(p0, P.cols - 4)); }); r.text(["", D + "› Message from @" + q.from + RESET].concat(fl.slice(0, 6).map(function (l) { return "  " + D + l + RESET; }), fl.length > 6 ? ["  " + D + "… +" + (fl.length - 6) + " lines" + RESET] : [])); return; }
        if (q.sys) { r.text([""].concat(wrap(String(q.text || ""), P.cols - 4).slice(0, 4).map(function (l, i) { return (i ? "    " : "  " + D + "⎿  ") + D + l + RESET; }))); return; } // 它自己排的（/goal 的「Goal set: …」）：照样列出来，淡的、不能改、不出 send now
        var pl = []; String(q.text || "").replace(/\[Image #(\d+): "[^"\n]+"\]/g, "[Image #$1]").split("\n").forEach(function (p0) { pl.push.apply(pl, wrap(p0, P.cols - 2)); }); // 附的图：只写 [Image #N]，不露路径
        r.text([""]);
        r.block('<span class="ask' + (q.sending ? "" : " q") + '">' + P.toHtml(pl.slice(0, 12).map(function (l, i) { return pad((i ? "  " : "❯ ") + l, P.cols); })) + "</span>");
        if (pl.length > 12) r.text(["  " + D + "… +" + (pl.length - 12) + " lines" + RESET]);
        if (q.images && q.images.length && vmode("prompts")) r.block(cfg.imageShow === "inline" ? thumbs(q.images) : imageRefs(q.images, 2, q.images.map(function (im, i) { return im.no || i + 1; })));
        if (q.err) {
          var en = enLang(), el = wrap((en ? "Not sent: " : "未发送：") + q.err, Math.max(20, P.cols - 14)), rl = en ? "retry" : "重试";
          r.block('<span class="blk vs-unsent">' + P.toHtml(el.map(function (l, i) { return "  " + (i ? "   " : RED + "⎿  ") + RED + l + RESET + (i === el.length - 1 ? D + " · " + RESET : ""); })).replace(/\n?$/, "") + '<span class="vs-retry">' + rl + "</span></span>");
        }
      });
      var st = rt.sendNowState ? rt.sendNowState() : list.some(function (q) { return !q.sending && !q.from && !q.sys; }) ? "ready" : null;
      var canEd = !!rt.editQueued && list.some(function (q) { return !q.from && !q.err && !q.sys; });
      if (rt.editingQueued && rt.editingQueued()) r.text(["  " + D + "editing…" + RESET]);
      else if (st === "ready") r.block(sendNowRow(D, canEd ? "edit" : ""));
      else if (st === "sending") r.text(["  " + D + "sending…" + RESET]);
      else if (st === "waiting") r.text(["  " + D + "queued · sent once the dialog is answered" + RESET]); // 它在等你处理对话框（权限、提问）：同上面 compacting 那一行，英文、一句
      else if (st === "compacting") r.block('<span class="blk vs-sendnow-row">' + P.toHtml(["  " + D + "queued · sent automatically when compaction finishes" + (canEd ? " · ↑ to " : "") + RESET]) + (canEd ? '<span class="vs-qedit">edit</span>' : "") + "</span>");
      var se = rt.sendNowError ? rt.sendNowError() : "";
      if (se && !list.some(function (q) { return q.err; })) r.text(wrap(se, Math.max(20, P.cols - 6)).map(function (l, i) { return "  " + RED + (i ? "   " : "⎿  ") + l + RESET; }));
    }
    // 「ctrl+x ctrl+s to send now」那一行：send now 这几个字能点（iPad 上没有这组键）——点了同按 ctrl+x ctrl+s：排着的马上发
    // tail === "edit"：后面接「· ↑ to edit」，edit 也能点（取回排着的最新那句，同在 Claude Code 里按 ↑ 再回车）
    function sendNowRow(D, tail) { return '<span class="blk vs-sendnow-row">' + P.toHtml(["  " + D + "ctrl+x ctrl+s to " + RESET]) + '<span class="vs-sendnow" title="立即发送">send now</span>' + (tail === "edit" ? P.toHtml([D + " · ↑ to " + RESET]) + '<span class="vs-qedit" title="取回排着的最新一句，放进输入框修改">edit</span>' : tail ? P.toHtml([D + tail + RESET]) : "") + "</span>"; }
    // 取回排着的那句：放回输入框（图跟着回来），光标放最后
    function editQueuedNow() {
      if (!rt.editQueued) return false;
      rt.editQueued().then(function (r) {
        if (!r || P.closed) return;
        var ta = P.ta, t = String(r.text || "");
        (r.images || []).forEach(function (im) { if (im && im.no) attach.push({ no: im.no, tag: "[Image #" + im.no + "]", media_type: im.media_type || "image/png", data: "", path: im.path }); });
        ta.value = t + (ta.value ? "\n" + ta.value : ""); ta.selectionStart = ta.selectionEnd = t.length;
        draftSet(agentId, ta.value, pastes); renderInput(); ta.focus();
      }, function (e) { P.flash(String(e && e.message || e), 4000); renderStatus(); });
      renderStatus();
      return true;
    }
    // Claude Code 的会话：rt.sendQueuedNow（claude.js）——同它的 chat:sendNow；点了马上画成在发（不能再点），压缩中说一句压完自动发
    function sendQueuedNow() {
      var me = A.me();
      if (rt.queued && me && me.allowed) { rt.sendNow("", []); P.toBottom(); return; }
      if (agent.claude && rt.sendQueuedNow) {
        var r0 = rt.sendQueuedNow();
        if (r0 === "compacting") P.flash("Compacting · queued messages are sent automatically when it finishes", 2600);
        else if (r0 === "waiting") P.flash("Waiting on a dialog · queued messages are sent once it's answered", 2600);
        else if (r0 === "nothing") P.flash("Nothing queued to send now", 1600);
        renderStatus();
      } else if (agent.claude && rt.pending && rt.pending().length && rt.interrupt && rt.interrupt() !== false) P.flash("Sending queued messages now", 1600);
      P.toBottom();
    }
    P.el.addEventListener("click", function (e) {
      if (P.program !== V || !e.target.closest) return;
      var bgb = e.target.closest(".vs-bgnow");
      if (bgb) { e.preventDefault(); e.stopPropagation(); if (rt.toBackground) rt.toBackground(); if (rt.stream) drawTurn(rt.stream.turn); return; }
      var nb = e.target.closest(".vs-needs");
      if (nb && window.TSU_TERM && TSU_TERM.agent && (nb.dataset.aid || needsAid)) { e.preventDefault(); e.stopPropagation(); TSU_TERM.agent(nb.dataset.aid || needsAid); return; }
      var b = e.target.closest(".vs-sendnow"), rb = e.target.closest(".vs-retry"), qe = e.target.closest(".vs-qedit");
      if (qe) { e.preventDefault(); e.stopPropagation(); editQueuedNow(); return; }
      if (rb && rt.retryQueued) { e.preventDefault(); e.stopPropagation(); rt.retryQueued(); renderStatus(); return; }
      if (!b) return;
      e.preventDefault(); e.stopPropagation(); sendQueuedNow();
    });
    var cxAt = 0; // ctrl+x ctrl+s：马上发（同 Claude Code 的「ctrl+x ctrl+s to send now」；ctrl+enter 一样）
    V.key = function (e) {
      var ta = P.ta, k = e.key;
      if (panel && askTyping() && !(e.key === "Enter" || e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Tab" || e.key === "Escape") || (panel && askTyping() && e.isComposing)) return; // 「Type something」：字直接打进下面的输入框（同 Claude Code 在那一行里写），不弹框
      if (panel) { if (!(e.metaKey && !e.ctrlKey)) { e.preventDefault(); panelKey(e); } return; }
      if (e.metaKey && !e.ctrlKey) return;
      if (e.ctrlKey && !e.altKey && !e.shiftKey && (k === "x" || k === "X")) { e.preventDefault(); cxAt = Date.now(); return; }
      if (e.ctrlKey && !e.altKey && !e.shiftKey && (k === "s" || k === "S") && Date.now() - cxAt < 2000) { cxAt = 0; k = "Enter"; e = { key: "Enter", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, isComposing: false, preventDefault: e.preventDefault.bind(e), stopPropagation: e.stopPropagation.bind(e) }; }
      else if (k !== "Control") cxAt = 0;
      var items = menuItems();
      if (k === "Tab" && e.shiftKey && !items.length && agent.claude) { e.preventDefault(); if (rt.cycleMode && rt.cycleMode()) renderInput(); return; } // 连接器的会话：换权限模式（能换的时候）
      if (k === "Tab" && e.shiftKey && !items.length) { e.preventDefault(); rt.setAccess({ none: "read", read: "rw", rw: "none" }[agent.access || "read"]); return; }
      if (e.ctrlKey && (k === "b" || k === "B")) { if (rt.detachBash()) { e.preventDefault(); P.flash("Moved to background"); } return; }
      if (e.ctrlKey && (k === "t" || k === "T")) { e.preventDefault(); showTodo = window.STUDIO && STUDIO.toggleTodo ? STUDIO.toggleTodo(agentId) : !showTodo; renderStatus(); P.fit(); P.flash(showTodo ? "Task list shown (ctrl+t to hide)" : "Task list hidden (ctrl+t to show)"); return; } // 同 Claude Code；清单在哪（输入框上方、抽屉、侧栏）都跟着收起 / 展开；思考的显示方式用 /thinking
      if (e.ctrlKey && (k === "o" || k === "O")) { e.preventDefault(); verbose = !verbose; P.renderNow(); P.flash(verbose ? "Showing full tool output (ctrl+o to collapse)" : "Tool output collapsed"); return; }
      if (k === "ArrowLeft" && !ta.value && !e.shiftKey && !e.altKey) { e.preventDefault(); return openAgents(); }
      // （以前空输入按 ↓ 打开后台任务列表：任务、后台任务、子 Agent 都在右侧栏里看，不再在输入框里弹一块）
      if (items.length && (k === "ArrowDown" || k === "ArrowUp")) { e.preventDefault(); menuIdx = (menuIdx + (k === "ArrowDown" ? 1 : items.length - 1)) % items.length; renderInput(); return; }
      if (items.length && k === "Tab") { e.preventDefault(); ta.value = items[menuIdx].name + (items[menuIdx].args ? " " : ""); renderInput(); return; }
      if (k === "Enter" && !e.shiftKey) {
        e.preventDefault();
        var me = A.me(), now = e.ctrlKey || e.metaKey; // ctrl+enter：答着的时候不排队，打断这一问马上发（闲着就是普通地发）
        if (!me || !me.loggedIn) { location.href = "/auth/login"; return; }
        var exact = /^\/\S+$/.test(ta.value) && (COMMANDS.some(function (c) { return c.name === ta.value; }) || /^\/(status|usage|cost|stats|thinking|bashes|new|settings|access|quit|logout)$/.test(ta.value));
        var v = items.length && !exact ? items[menuIdx].name : ta.value, imgs = attach.filter(function (a) { return (a.data || a.path) && ta.value.indexOf(a.tag) >= 0; }).sort(function (a, b) { return ta.value.indexOf(a.tag) - ta.value.indexOf(b.tag); }); // 字里删掉了「[Image #N]」的图不发
        if (items.length && !exact && items[menuIdx].args && v === items[menuIdx].name) { ta.value = v + " "; renderInput(); return; }
        pastes.forEach(function (p) { v = v.split(p.tag).join(p.text); });
        // 正在别的设备上跑（账号里的租约在那台）：这台不插进去，输入留着；ctrl+enter = 接管到这台
        var far = A.elsewhere && A.elsewhere(agentId);
        if (far && !now && (v.trim() || imgs.length) && !/^[\/!]/.test(v.trim())) { P.flash(agent.name + " is running on " + far.device + " · ctrl+enter to take over here", 3500); return; }
        ta.value = ""; attach = []; pastes = []; histIdx = -1;
        draftSet(agentId, "");
        renderInput();
        if (now && !v.trim() && !imgs.length && rt.queued && me.allowed) { rt.sendNow("", []); P.toBottom(); return; } // 空输入：把排着的那条马上发
        // Claude Code 的会话：ctrl+enter（空输入）= 排着的那几句马上发——打断这一问，Claude Code 接着就读排着的（同它自己的 ctrl+enter to send now）
        if ((now || (rt.pending && rt.pending().some(function (q) { return q.local; }))) && !v.trim() && !imgs.length && agent.claude) { /* 空着按回车也一样（同 Claude Code 的「Enter to send them now」） */ if (rt.sendQueuedNow) { sendQueuedNow(); return; } if (rt.pending && rt.pending().length && rt.interrupt && rt.interrupt() !== false) P.flash("Sending queued messages now", 1600); else P.flash("Nothing queued to send now", 1600); P.toBottom(); return; }
        if (!v.trim() && !imgs.length) return;
        // Claude Code 的会话（claude.js）：说的话、/ 命令都交给 Claude Code 自己；只有 /exit 是关掉这个视图（它照跑）
        if (agent.claude) {
          if (/^\/(exit|quit)$/.test(v.trim())) return command(v.trim());
          var mc = /^\/model(?:\s+(\S+))?\s*$/.exec(v.trim()); // /model：这边换（claude -p 不认 / 命令），下一句起用上
          if (mc && rt.models) { if (!mc[1]) return pickConnModel(); rt.setModel(mc[1]); rt.record(v.trim(), "Set model to " + mc[1]); return; }
          // Codex：它自己的 / 命令这边做（codex.js rt.command：问它的守护进程），不当话发给模型；路径（/Users/…）照常是话
          if (rt.command && /^\/[^\s\/]+(\s|$)/.test(v.trim()) && !imgs.length && rt.command(v.trim()) !== false) { P.toBottom(); return; }
          if (now && rt.sendNowAfter && rt.sendNowAfter()) now = false; // ctrl+enter：这句照常送进它的队，送到了马上按它的 ctrl+x ctrl+s（同在它那里按，不打断）
          else if (now && rt.interrupt) rt.interrupt(); // 自己起的 claude -p：打断这一问，这句马上当下一问（它排着，打断后接着读）
          rt.send(v, imgs); P.toBottom();
          if (rt.tui && /^\/[\w:-]+(\s|$)/.test(v.trim()) && !imgs.length) setTimeout(function () { ccTuiOpen("cmd"); }, 120); // 斜杠命令：它可能弹面板（/config、/model…）——接上它的界面看一眼，没弹就断开
          return;
        }
        // 斜杠命令只认「/单词」开头；/home/user/… 这种路径开头的是普通消息（同 Claude Code；从访达拖进来的路径也是这样）
        // 「/tmp 里有什么」这种：第一个词是沙盒里存在的路径，也是普通消息
        var first = v.trim().split(/\s/)[0], known = COMMANDS.some(function (x) { return x.name === first; }) || /^\/(status|usage|cost|stats|thinking|bashes|settings|access|quit|logout|exit)$/.test(first) || !!A.byName(first.slice(1));
        if (/^\/[^\s\/]+(\s|$)/.test(v) && !imgs.length && (known || !(window.SANDBOX && SANDBOX.exists(first)))) return command(v.trim());
        if (v[0] === "!") return rt.bang(v.slice(1).trim());
        if (!me.allowed) return;
        if (now) rt.sendNow(v, imgs); else rt.send(v, imgs);
        P.toBottom();
        return;
      }
      // Ctrl+C：选着字就照常复制；没选：清空输入；空输入连按两次回到 shell
      if (e.ctrlKey && (k === "c" || k === "C") && !String(document.getSelection()) && ta.selectionStart === ta.selectionEnd) {
        e.preventDefault();
        if (ta.value || attach.length) { ta.value = ""; pastes = []; attach = []; draftSet(agentId, ""); renderInput(); return; }
        return ctrlC();
      }
      // Esc 只做一件事，按优先级：关命令菜单 > 把排队的消息拿回输入框 > 打断
      if (k === "Escape") {
        if (items.length) { e.preventDefault(); ta.value = ""; renderInput(); return; }
        if (rt.queued) { e.preventDefault(); var q = rt.takeQueued(); ta.value = q.text + (ta.value ? "\n" + ta.value : ""); attach = (q.images || []).concat(attach); renderInput(); return; }
        if (rt.interrupt()) { e.preventDefault(); return; }
      }
      if (k === "Backspace" && ta.selectionStart === ta.selectionEnd) { // 光标紧跟着「[Pasted text #N …]」「[Image #N]」：一下删掉整个（同 Claude Code）
        var upto = ta.value.slice(0, ta.selectionStart), hit = pastes.find(function (p) { return upto.slice(-p.tag.length) === p.tag; }), ih = hit ? null : attach.find(function (a) { return upto.slice(-a.tag.length) === a.tag; });
        if (hit) { e.preventDefault(); ta.setRangeText("", ta.selectionStart - hit.tag.length, ta.selectionStart, "end"); pastes.splice(pastes.indexOf(hit), 1); draftSet(agentId, ta.value, pastes); renderInput(); return; }
        if (ih) { e.preventDefault(); ta.setRangeText("", ta.selectionStart - ih.tag.length, ta.selectionStart, "end"); attach = attach.filter(function (x) { return x !== ih; }); draftSet(agentId, ta.value, pastes); renderInput(); return; }
      }
      if (k === "End" && e.ctrlKey) { e.preventDefault(); P.toBottom(); P.onScroll(); return; }
      var before = ta.value.slice(0, ta.selectionStart), after = ta.value.slice(ta.selectionEnd);
      if ((k === "ArrowUp" || k === "ArrowDown") && e.shiftKey) return; // shift+↑↓：选字（输入框自己处理），不翻历史
      if (k === "ArrowUp" && !ta.value && agent.claude && rt.question && rt.question()) { e.preventDefault(); V.openAsk(); return; } // 它在问你：↑ 打开问答
      // Claude Code 的会话：这边排着、还没送出去的那几句——空着按 ↑ 拿回输入框改（同 Claude Code 的「Press up to edit queued messages」）
      if (k === "ArrowUp" && !ta.value && histIdx < 0 && agent.claude && rt.editQueued && rt.pending && rt.pending().some(function (q) { return !q.from && !q.err && !q.sys; })) { e.preventDefault(); editQueuedNow(); return; }
      if (k === "ArrowUp" && !ta.value && histIdx < 0 && agent.claude && rt.localQueued && rt.localQueued() && rt.takeQueued) { var lqT = rt.takeQueued(); if (lqT) { e.preventDefault(); ta.value = lqT.text; ta.selectionStart = ta.selectionEnd = ta.value.length; draftSet(agentId, ta.value, pastes); renderInput(); return; } }
      // ↑↓ 按画出来的行走（折行的中文一句也是好几行）：不在第一 / 最后一行时，光标挪到上 / 下一行差不多同一列的地方——
      //   以前只看有没有换行符：一整段折成好几行时按 ↑ 直接翻出上一句历史（用户：光标定位不对）；输入框自己的 ↑↓ 按它看不见的那层排版走，也对不上
      if ((k === "ArrowUp" || k === "ArrowDown") && !e.altKey && !e.metaKey && !e.ctrlKey && caretVMove(k === "ArrowUp" ? -1 : 1)) { e.preventDefault(); return; }
      if (k === "ArrowUp" && before.indexOf("\n") < 0) {
        var h = askHistory();
        if (histIdx + 1 < h.length) {
          e.preventDefault();
          if (histIdx < 0) draft = ta.value;
          histIdx++;
          ta.value = h[h.length - 1 - histIdx];
          ta.setSelectionRange(ta.value.length, ta.value.length);
          renderInput();
        }
        return;
      }
      if (k === "ArrowDown" && after.indexOf("\n") < 0 && histIdx >= 0) {
        e.preventDefault();
        histIdx--;
        var h2 = askHistory();
        ta.value = histIdx < 0 ? draft : h2[h2.length - 1 - histIdx];
        ta.setSelectionRange(ta.value.length, ta.value.length);
        renderInput();
        return;
      }
      var pg = { PageDown: 1, PageUp: -1 }[k];
      if (pg) { e.preventDefault(); P.scrollByRows(pg * Math.max(1, Math.floor(P.screen.clientHeight / P.rowH) - 1)); }
    };
    function askHistory() {
      var asks = [];
      A.sessionsOf(agentId).slice().reverse().forEach(function (s) { s.turns.forEach(function (t) { if (t.ask && !t.system) asks.push(t.ask); }); });
      return asks.filter(function (a, i) { return asks.indexOf(a, i + 1) < 0; });
    }
    V.command = command;
    V.interrupt = function () { rt.interrupt(); };
    V.clearScrollback = function () { rt.clear(); };
    V.exportText = function () { return rt.session().turns.map(function (t) { return (t.ask ? "❯ " + t.ask + "\n\n" : "") + (t.answer || "") + "\n"; }).join("\n"); };
    V.afterScroll = function () { stickySoon(); }; // 跟随状态变了（回到底、发了一句、往上翻）都再看一次吸顶那一行：不留一个过时的挂在最上面
  }

  // ======== 窗口：标签页 × 分屏（同 iTerm / Terminal.app）========
  // 分屏树：{ pane } 或 { dir: "row"（左右）| "col"（上下）, a, b, ratio }。每个窗口一棵；布局存在本地
  var wins = [];
  function allPanes() { var o = []; wins.forEach(function (w) { if (w.open) { w.ws.all().forEach(function (p) { o.push(p); if (p.vs && p.vs.panes) o.push.apply(o, p.vs.panes()); }); if (w.sidePane) o.push(w.sidePane); } }); return o; } // 右侧栏里的那个对话、标签页里拆出来的几格也算（换配色、改设置时一起重画）
  // 这个 agent（Paimon、cc:…、cx:…）已经开在某个标签页里：跳过去（前面那个窗口先找），返回那个面板；没开着返回 null——开的路（树、Agent Finder、命令面板、通知……）都先问它，同一个只开一个
  function focusAgent(id) {
    if (!id) return null;
    var order = wins.filter(function (w) { return w.open; }), fw = frontTerm(), hit = null;
    if (fw && order.indexOf(fw) > 0) { order.splice(order.indexOf(fw), 1); order.unshift(fw); }
    order.some(function (w) {
      return w.ws.tabs.some(function (t, ti) {
        var l = w.ws.leaves(t.root).filter(function (x) { return x.pane && x.pane.program && x.pane.program.agentId === id; })[0];
        if (!l) return false;
        if (w.ws.cur !== ti) w.ws.select(ti);
        w.ws.activate(l.pane);
        if (w.focus) w.focus();
        l.pane.focus();
        hit = l.pane;
        return true;
      });
    });
    return hit;
  }
  function TermWindow(el, dw) {
    var tw = this;
    tw.el = el;
    tw.dw = dw;
    tw.id = el.id;
    tw.open = false;
    el.classList.add("termwin");
    var body = el.querySelector(".body");
    tw.tabsEl = body.querySelector(".tabs");
    tw.panesEl = body.querySelector(".panes");
    tw.titleEl = el.querySelector("#title") || el.querySelector(".bar span");
    tw.ws = document.documentElement.classList.contains("termapp") ? new GroupSpace(tw) : new Workspace(tw);
    tw.persist = function () { persistAll(); };
    tw.syncTitles = function () { tw.ws.syncTitles(); };
    // 运行时的状态事件（在答没在答、限额、压缩……）一来一大串（状态行文件一变，每个开着的会话各来一次）：并成一次，稍后同步标题、标签条、左边树
    var titlesT = 0;
    tw.syncTitlesSoon = function () { if (!titlesT) titlesT = setTimeout(function () { titlesT = 0; tw.ws.syncTitles(); }, 50); };
    tw.syncBusy = function () {
      var busy = tw.ws.all().some(function (p) { return p.shell && p.shell.busy(); });
      if (window.TSU_DESK) TSU_DESK.setBusy(tw.id, busy, busy ? "要终止此窗口中正在运行的进程吗？" : "");
    };
    if (window.TSU_DESK) TSU_DESK.onBeforeClose(tw.id, function () {
      // 先问改了没存的文件（保存 / 不保存 / 取消）；取消了窗口不关
      var saved = window.STUDIO && STUDIO.askUnsaved ? new Promise(function (res) { STUDIO.askUnsaved(tw.ws.all(), function () { res(true); }, function () { res(false); }); }) : Promise.resolve(true);
      return saved.then(function (ok0) { if (!ok0) return false; return closeRunning(); });
    });
    function closeRunning() {
      var running = tw.ws.all().filter(function (p) { return p.shell && p.shell.busy(); });
      var ask = running.length ? TSU_DESK.alert({ window: tw.id, title: "要终止此窗口中正在运行的进程吗？", message: "关闭窗口将终止以下进程：" + running.map(function (p) { return p.shell.title(); }).join("、"), icon: "caution",
        buttons: [{ label: "取消", role: "cancel" }, { label: "终止", role: "default" }] }).then(function (l) { return l === "终止"; }) : Promise.resolve(true);
      return ask.then(function (ok) {
        if (!ok) return false;
        // agent 不跟着窗口走：还在干活的，提醒一句它在后台继续
        tw.ws.all().forEach(function (p) {
          if (p.program && p.program.agentId) { var rt = A.runtime(p.program.agentId); if (rt.state() !== "idle" && TSU_DESK.notify) TSU_DESK.notify({ app: "终端", title: rt.agent.name + " 在后台继续运行", body: "在终端中输入 paimon " + rt.agent.name + " 继续" }); }
        });
        setTimeout(function () { tw.dispose(); }, 0);
        return true;
      });
    }
    tw.dispose = function () {
      tw.ws.all().forEach(function (p) { if (p.shell) p.shell.interrupt(); p.close(); });
      tw.ws.tabs = [];
      tw.ws.active = null;
      tw.panesEl.textContent = "";
      tw.open = false;
      if (window.TSU_DESK) TSU_DESK.setBusy(tw.id, false);
      persistAll();
    };
    tw.start = function (saved) {
      tw.open = true;
      tw.ws.restore(saved);
    };
    tw.side = new LabSide(tw);
  }

  // ======== 左边栏（lab）：这个窗口里所有 agent 一眼看完，点一下切过去 ========
  // 同 paimon ls（teyvat 的 genshin ls）：前台 / 后台 / 离线各自编号（绿 / 蓝 / 白），[W] / [NW] + [F] / [B] / [O]，第二行是它在做的 / 最后说的。
  // 字和颜色同终端：没有底色，指到的字变亮；当前面板的 agent 名字是淡紫。⌃⌘S 或标题栏左边的按钮开 / 关，右边缘拖动调宽、双击恢复；记在本机
  var SIDE_KEY = "tsu-lab-side", SIDE_W0 = 250, SIDE_MIN = 170, SIDE_MAX = 520;
  var sidePref = (function () { try { return JSON.parse(localStorage.getItem(SIDE_KEY) || "null") || {}; } catch (e) { return {}; } })();
  // Claude Code / Codex 的会话在边栏里的改名、固定、归档（只记在这台设备上；Claude App 的边栏 claudeapp.js 用同一份 st-claude-ext）
  function ccExt() { try { var e = JSON.parse(localStorage.getItem("st-claude-ext") || "{}") || {}; e.pin = e.pin || {}; e.name = e.name || {}; e.arch = e.arch || {}; e.group = e.group || {}; return e; } catch (err) { return { pin: {}, name: {}, arch: {}, group: {} }; } }
  // 未读（会话菜单「标为未读」；Claude App 的边栏用同一份 st-claude-unread，键 cc:<id>）：打开它就是已读
  function ccUnread() { try { return JSON.parse(localStorage.getItem("st-claude-unread") || "{}") || {}; } catch (e) { return {}; } }
  function ccUnreadSave(u) { try { localStorage.setItem("st-claude-unread", JSON.stringify(u)); } catch (e) { /* 满了 */ } }
  function ccMarkRead(id) { var u = ccUnread(); if (u["cc:" + id]) { delete u["cc:" + id]; ccUnreadSave(u); } }
  // 分组（会话菜单「移到分组」）：自己起的名字，记在 st-claude-ext 的 group 里（{ cc:<id>: 组名 }）；树里在「已固定」下面各成一组
  function ccGroupNames() { var g = ccExt().group, seen = {}; Object.keys(g).forEach(function (k) { if (g[k]) seen[g[k]] = 1; }); return Object.keys(seen).sort(); }
  function ccExtSave(e) { try { localStorage.setItem("st-claude-ext", JSON.stringify(e)); } catch (err) { /* 满了 */ } }
  function saveSidePref() { try { localStorage.setItem(SIDE_KEY, JSON.stringify(sidePref)); } catch (e) { /* 满了 */ } }
  var SIDE_ICON = '<svg viewBox="0 0 20 20" width="17" height="17"><rect x="2.5" y="4" width="15" height="12" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7.5 4.4v11.2" stroke="currentColor" stroke-width="1.5"/></svg>';
  // Agents 视图标题行的按钮、树的右键菜单（16 格线条，同「文件」视图）
  var TIC = function (b) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' + b + "</svg>"; };
  var TREE_IC = {
    newAgent: TIC('<path d="M6.3 2.4c.3 2.2 1.4 3.3 3.6 3.6-2.2.3-3.3 1.4-3.6 3.6-.3-2.2-1.4-3.3-3.6-3.6 2.2-.3 3.3-1.4 3.6-3.6z"/><path d="M11.8 9.4v4.2M9.7 11.5h4.2"/>'),
    newFolder: TIC('<path d="M8 12.5H2.8a.8.8 0 0 1-.8-.8V4.1a.8.8 0 0 1 .8-.8h3.1l1.4 1.5h5.9a.8.8 0 0 1 .8.8v2.2"/><path d="M11.8 9.2v4.2M9.7 11.3h4.2"/>'),
    refresh: TIC('<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M11.8 1.9v2.7H9.1"/>'),
    folder: TIC('<path d="M2 4.2a.8.8 0 0 1 .8-.8h3.1l1.4 1.5h5.9a.8.8 0 0 1 .8.8v6.4a.8.8 0 0 1-.8.8H2.8a.8.8 0 0 1-.8-.8z"/>'),
    copy: TIC('<rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.3"/><path d="M10.8 5.2V3.8a1.3 1.3 0 0 0-1.3-1.3H3.8a1.3 1.3 0 0 0-1.3 1.3v5.7a1.3 1.3 0 0 0 1.3 1.3h1.4"/>'),
    cut: TIC('<circle cx="4.6" cy="11.6" r="1.9"/><circle cx="11.4" cy="11.6" r="1.9"/><path d="M5.9 10.2L11.6 2.6M10.1 10.2L4.4 2.6"/>'),
    paste: TIC('<rect x="3.4" y="3.2" width="9.2" height="10.6" rx="1.3"/><path d="M6 3.2V2.2h4v1"/>'),
    trash: TIC('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4"/>'),
  };
  function LabSide(tw) {
    var S = this, body = tw.el.querySelector(".body"), bar = tw.el.querySelector(".bar");
    var lab = document.createElement("div"), side = document.createElement("div"), grip = document.createElement("i"), main = document.createElement("div");
    lab.className = "tlab"; side.className = "tside"; grip.className = "ts-grip"; main.className = "tmain";
    body.insertBefore(lab, tw.tabsEl);
    main.appendChild(tw.tabsEl);
    main.appendChild(tw.panesEl);
    side.innerHTML = '<pre class="terminal-style-ui ts-list"></pre>';
    if (root.classList.contains("termapp")) {
      var vhead = document.createElement("div");
      vhead.className = "st-shdr st-vhead terminal-style-ui";
      // 标题行右边：刷新、全部折叠，再是 ···（新建 Agent、新建文件夹在「Paimon Code」那一组的标题旁边，新建会话在 Claude Code、Codex 各自的标题旁边）
      var ico0 = window.STUDIO && STUDIO.icons ? STUDIO.icons : {};
      vhead.innerHTML = '<span class="st-vtitle">Agents</span><span class="st-fill"></span>' +
        '<button class="st-hbtn" data-h="refresh" title="刷新">' + TREE_IC.refresh + '</button><button class="st-hbtn" data-h="collapse" title="全部折叠">' + (ico0.collapse || "⊟") + "</button>" +
        '<button class="st-hbtn st-vmore" title="更多操作">' + (ico0.more || "···") + "</button>";
      side.insertBefore(vhead, side.firstChild);
      // 标题下面的搜索框（同 VS Code「搜索」视图顶上那一栏）：按名字找 agent、会话——见下面的 setTreeQ
      var vfind = document.createElement("div");
      vfind.className = "st-search st-sbox ts-find";
      vfind.innerHTML = '<input class="ts-q" spellcheck="false" autocomplete="off" placeholder="搜索 Agent 和会话"><button class="ts-qx" tabindex="-1" title="清除">' + TIC('<path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8"/>') + "</button>";
      side.insertBefore(vfind, vhead.nextSibling);
      if (window.TSU_I18N && TSU_I18N.add) TSU_I18N.add({ "搜索 Agent 和会话": "Search agents and sessions" });
      vhead.addEventListener("click", function (e) {
        var b = e.target.closest("[data-h]");
        if (!b) return;
        var f = b.dataset.h;
        if (f === "newAgent") { if (!caNew()) startEdit("agent"); }
        else if (f === "newFolder") startEdit("folder");
        else if (f === "refresh") refreshAll();
        else if (f === "collapse") collapseAll();
      });
      vhead.querySelector(".st-vmore").addEventListener("click", function (e) {
        if (!window.STUDIO || !STUDIO.menu) return;
        var MI = STUDIO.menuIcons ? STUDIO.menuIcons() : {};
        var mi = function (label, keys, run, ic) { return { label: label, keys: keys || "", run: run, icon: MI[ic] }; };
        STUDIO.menu([
          pmTree() ? mi("新建 Agent…", "", function () { if (!caNew()) startEdit("agent"); }, "agent") : null,
          pmTree() ? Object.assign(mi("新建文件夹…", "", function () { startEdit("folder"); }), { icon: TREE_IC.newFolder }) : null,
          window.TSU_LOCAL && ccOn() ? mi("新建 Claude Code 会话", "", function () { S.newCC(); }, "term") : null,
          { sep: true },
          mi("刷新", "", function () { refreshAll(); }, "recap"),
          mi("全部折叠", "", function () { collapseAll(); }, "collapse"),
          { sep: true },
          mi("隐藏主侧栏", "⌘B", function () { S.toggle(false); }, "hide"),
        ].filter(Boolean), { el: e.currentTarget, side: "below-end" });
      });
    }
    lab.appendChild(side);
    lab.appendChild(grip);
    lab.appendChild(main);
    var list = side.querySelector(".ts-list"), btn = document.createElement("button");
    btn.className = "ts-btn";
    btn.title = "切换主侧栏 (⌃⌘S)";
    btn.innerHTML = SIDE_ICON;
    var lights = bar.querySelectorAll(":scope > i");
    bar.insertBefore(btn, lights.length ? lights[lights.length - 1].nextSibling : bar.firstChild);
    btn.addEventListener("pointerdown", function (e) { e.stopPropagation(); }); // 不拖窗口
    btn.addEventListener("dblclick", function (e) { e.stopPropagation(); });
    btn.addEventListener("click", function () { S.toggle(); });
    var archived = false, lastHtml = "", order = [], chPx = 0;
    var width = function (w) { side.style.width = Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, w))) + "px"; };
    width(sidePref.w || SIDE_W0);
    // 开着的边栏在窗口太窄时自己收起来（同 macOS 的边栏），宽回来再出来；窄的时候点按钮也能硬开
    var userOn = sidePref.on !== false, force = false, NARROW = 700;
    var narrow = function () { return tw.el.offsetWidth > 0 && tw.el.offsetWidth < NARROW; };
    function apply() {
      var on = userOn && (!narrow() || force);
      lab.classList.toggle("ts-drawer", on && narrow() && tw.el.offsetWidth < 600); // 手机那么窄：盖在上面，不挤编辑区
      if (lab.classList.contains("off") === !on) return;
      lab.classList.toggle("off", !on);
      if (on) S.render(true);
      if (window.STUDIO && STUDIO.renderSoon) STUDIO.renderSoon(tw); // 右上角主侧栏的开关、活动栏跟着
    }
    S.shown = function () { return !lab.classList.contains("off"); };
    // 很窄的屏幕（iPhone）：边栏盖在编辑区上面（panes.css 的 .ts-drawer）；点了里面的会话、点到编辑区，就收回去（下次点图标再拉出来）
    S.dismiss = function () { if (force && narrow()) { force = false; apply(); } };
    main.addEventListener("pointerdown", function () { if (lab.classList.contains("ts-drawer")) S.dismiss(); }, true);
    S.toggle = function (on) {
      if (on === undefined && userOn && !S.shown()) { force = true; return apply(); } // 窄了自己收起来的：这次硬开
      userOn = on === undefined ? !S.shown() : !!on;
      force = userOn && narrow();
      sidePref.on = userOn;
      saveSidePref();
      apply();
    };
    apply();
    // 拖右边缘调宽，双击恢复默认（同 teyvat IM 的会话栏）
    grip.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      var x0 = e.clientX, w0 = side.offsetWidth;
      tw.el.classList.add("ts-resizing");
      var move = function (ev) { width(w0 + (lab.classList.contains("st-sright") ? -1 : 1) * (ev.clientX - x0)); S.render(); }; // 主侧栏在右边：往左拖是变宽
      var up = function () {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        tw.el.classList.remove("ts-resizing");
        sidePref.w = side.offsetWidth;
        saveSidePref();
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
    grip.addEventListener("dblclick", function () { width(SIDE_W0); delete sidePref.w; saveSidePref(); S.render(true); });

    // ---- 画：拼成终端的行（ANSI），交给 TTU 转 HTML；每个 agent 一块（两行），块上记着它的 id ----
    function measure() {
      var probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
      probe.textContent = "0".repeat(100);
      list.appendChild(probe);
      chPx = probe.offsetWidth / 100 || 7.8;
      probe.remove();
      list.style.setProperty("--ttu-cell", chPx + "px");
    }
    function here() { // 这个窗口里开着的 agent：当前面板的、别的面板的
      var cur = tw.ws.active && tw.ws.active.program && tw.ws.active.program.agentId, open = {};
      tw.ws.all().forEach(function (p) { if (p.program && p.program.agentId) open[p.program.agentId] = 1; });
      return { cur: cur, open: open };
    }
    // 切标签页：「当前」那一行挪过去就行（整棵树重拼一遍要十几二十毫秒）。挪不了的（没显示、老样子的树、终端里跑着的 claude、要标已读的）返回 false：整棵画
    S.markCur = function () {
      if (!S.shown() || !list || !root.classList.contains("termapp")) return false;
      var ap = tw.ws.active, cur = String((ap && ap.program && ap.program.agentId) || ""), sel = "";
      if (ap && ap.program && ap.program.pty) return false;
      if (/^cc:/.test(cur)) { if (ccUnread()[cur]) return false; sel = '[data-cc="' + CSS.escape(cur.slice(3)) + '"]'; }
      else if (/^cx:/.test(cur)) sel = '[data-cx="' + CSS.escape(cur.slice(3)) + '"]';
      else if (cur) sel = '[data-id="' + CSS.escape(cur) + '"]';
      Array.prototype.forEach.call(list.querySelectorAll(".ts-it.cur"), function (e) { e.classList.remove("cur"); });
      if (sel) Array.prototype.forEach.call(list.querySelectorAll(".ts-it" + sel), function (e) { e.classList.add("cur"); });
      lastHtml = ""; // 下一次整棵重画时照常写回（跟拼出来的一致）
      return true;
    };
    S.render = function (force) {
      if (!S.shown() || !side.clientWidth) return;
      if (!chPx || force) measure();
      if (root.classList.contains("termapp")) return renderTree();
      var light = termLight(), theme = light ? "light" : "dark", DIMC = rgb(light ? "130;130;130" : "120;120;120");
      var cols = Math.max(14, Math.floor((side.clientWidth - 16) / chPx)), h = here(), blocks = [];
      var head = function (t) { return TTU.ansiToHtml(light ? forLight(t) : t, theme, { widthOf: TTU.visibleWidth }); };
      var line = function (left, right) { var gap = cols - W(left) - W(right); return gap >= 1 ? left + " ".repeat(gap) + right : left; };
      var all = archived ? A.archived() : A.list(), st = {};
      if (!archived) all.forEach(function (a) { st[a.id] = agentStatus(a); });
      order = archived ? all : ["f", "b", "o"].reduce(function (acc, g) { return acc.concat(all.filter(function (a) { return st[a.id].g === g; }).sort(function (x, y) { return (y.active || 0) - (x.active || 0); })); }, []);
      var out = '<span class="ts-head">' + head(BOLD + "Paimon" + RESET + DIMC + " · " + (archived ? order.length + " 已归档" : F.plural(order.length, "agent")) + RESET) + "</span>\n\n";
      var n = { f: 0, b: 0, o: 0 }, numW = String(order.length).length + 2;
      order.forEach(function (a) {
        var g = archived ? "o" : st[a.id].g, col = GROUP_COLOR[g], num = ++n[g] + ".", rt2 = A.runtime(a.id);
        var tag = archived ? "" : st[a.id].tag.replace(/\s+$/, ""), nameC = a.id === h.cur ? LAV + BOLD : h.open[a.id] ? BOLD : "";
        var tagW = W(tag) + 1, name = clip(a.name, Math.max(4, cols - 1 - numW - tagW));
        var l1 = line(" " + col + pad(num, numW) + RESET + nameC + name + RESET, tag ? col + tag + RESET : "");
        var when = archived ? agoCN(a.archivedAt || a.active) : st[a.id].time, tail = plainTail(rt2);
        var l2 = " ".repeat(numW + 1) + DIMC + clip(tail, Math.max(4, cols - numW - 2 - W(when) - 1)) + RESET;
        l2 = line(l2, DIMC + when + RESET);
        out += '<span class="ts-it' + (a.id === h.cur ? " cur" : "") + '" data-id="' + a.id + '">' + head(l1 + "\n" + l2) + "</span>\n";
      });
      if (!order.length) out += head(DIMC + (archived ? " 无已归档的 Agent" : " 暂无 Agent") + RESET) + "\n";
      if (!archived && window.TSU_LOCAL) out += ccRows(cols, head, line, DIMC) + "\n";
      var na = A.archived().length;
      out += "\n" + '<span class="ts-act" data-act="new">' + head(DIMC + " + 新建 Agent" + RESET) + "</span>\n" +
        (archived ? '<span class="ts-act" data-act="back">' + head(DIMC + " ← 全部 Agent" + RESET) + "</span>" : na ? '<span class="ts-act" data-act="archived">' + head(DIMC + " 已归档 " + na + RESET) + "</span>" : "");
      list.classList.toggle("ttu-light", light);
      if (out !== lastHtml) { lastHtml = out; list.innerHTML = out; }
    };
    // ---- Paimon Terminal：目录树（同 VS Code 的资源管理器）——能展开的都能折叠（▾ / ▸），新建、刷新、全部折叠在标题行右边 ----
    //   ▾ Paimon · N agents                 +  ⊟
    //     ▸ ✦ paimon-01          [NW] [F]  23分钟      （展开是它的会话；最后有「已归档」一组）
    //   ▾ Claude Code · N sessions          +  ↻  ⊟
    //     ▾ ~/项目目录                                  （按开会话的目录分组）
    //         ✻ 会话标题          [W]  [B]  1天9小时
    var fold = sidePref.fold || (sidePref.fold = {});
    // 搜索（标题下面的搜索框）：treeQ 是搜的字。搜着的时候树的折叠另记在 qfold（键前面带 q:，默认都展开，不存）——清掉搜索就回到平时的样子
    var treeQ = "", qfold = {};
    var folded = function (k, def) { if (/^q:/.test(k)) return !!qfold[k]; if (treeQ) return !!qfold["q:" + k]; return k in fold ? !!fold[k] : !!def; };
    var setFold = function (k, v) { if (/^q:/.test(k)) qfold[k] = v; else { fold[k] = v; saveSidePref(); } };
    // ======== Paimon Code 这一组同 VS Code 的资源管理器：卷 › 文件夹（多少层都行）› agent（名字.agent）——
    //   新建 / 重命名是树里的一行输入框（回车定、Esc 算了、点别处也定；重名就在下面说一句）；剪切 / 拷贝 / 粘贴（拷贝 = 分支：带着对话的新 agent）、
    //   拖着挪；删除先问（同 Claude App 的对话框），是「哪儿都不再出现」的标记（A.remove），会话还在。文件夹是账号里的索引，空的也在 ========
    var edit = null, editPaint = false; // 正在打字的那一行：{ kind: agent | folder | rename | rendir, vol, path（在哪个文件夹里）, id（改名的 agent）, dir（改名的文件夹）, value, err }
    var cutBuf = null; // 剪切 / 拷贝的：{ cut, id } 或 { cut, vol, dir }（不叫 clip：那是上面截字的）
    var tt = function (zh, e) { return enLang() ? e : zh; };
    var vpParent = function (p) { var i = String(p || "").lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };
    var homeVol = function () { return (A.localVol && A.localVol()) || "cloud"; };
    var dirKey = function (vol, p) { return p ? "pm:d:" + vol + "|" + p : "pm:v:" + vol; };
    var keyAt = function (k) { // 树里的一行（kKey）是什么：{ id } agent；{ vol, dir } 卷（dir 空）/ 文件夹
      k = String(k || "").replace(/^f:q:/, "f:"); // 搜着的时候的折叠键
      var m = /^a:(.+)$/.exec(k || "");
      if (m) return A.get(m[1]) ? { id: m[1] } : null;
      if ((m = /^f:pm:d:([^|]*)\|(.+)$/.exec(k || ""))) return { vol: m[1], dir: m[2] };
      if ((m = /^f:pm:v:(.+)$/.exec(k || ""))) return { vol: m[1], dir: "" };
      return null;
    };
    // 新建、粘贴放哪：选中的文件夹 / 卷里；选中的是 agent：它所在的文件夹；都没有：这台 Mac（网页里是 Cloud）的最外层
    function targetDir() {
      var x = keyAt(kKey), a = x && x.id && A.get(x.id);
      if (a) return { vol: A.volOf(a.id), path: a.path || "" };
      return x ? { vol: x.vol, path: x.dir } : { vol: homeVol(), path: "" };
    }
    function reveal(vol, p) { // 一路展开到这个文件夹
      fold.pm = false; fold[dirKey(vol, "")] = false;
      var segs = String(p || "").split("/").filter(Boolean);
      segs.forEach(function (_, i) { fold[dirKey(vol, segs.slice(0, i + 1).join("/"))] = false; });
      saveSidePref();
    }
    function moveFold(vol, from, to) { // 文件夹改名 / 挪了：展开没展开跟着走
      var pre = dirKey(vol, from);
      Object.keys(fold).forEach(function (k) { if (k === pre || k.indexOf(pre + "/") === 0) { fold[dirKey(vol, to) + k.slice(pre.length)] = fold[k]; delete fold[k]; } });
      saveSidePref();
    }
    var paintEdit = function () { editPaint = true; S.render(true); };
    function startEdit(kind, at) {
      if (treeQ) setTreeQ(""); // 新建：先清掉搜索（不然要放的那个文件夹可能正被筛掉）
      at = at || targetDir();
      if (A.volHere && !A.volHere(at.vol)) at = { vol: homeVol(), path: "" }; // 别的 Mac 上的卷：这里建不了（它的文件在那台上）
      edit = { kind: kind, vol: at.vol, path: at.path, value: "", err: "" };
      reveal(at.vol, at.path);
      if (!S.shown()) S.toggle(true);
      if (window.STUDIO && STUDIO.showView && tw.stView && tw.stView !== "agents") STUDIO.showView(tw, "agents");
      paintEdit();
    }
    function startRename(k) {
      var x = keyAt(k), a = x && x.id && A.get(x.id);
      if (a) edit = { kind: "rename", id: a.id, value: a.name, err: "" };
      else if (x && x.dir) edit = { kind: "rendir", vol: x.vol, dir: x.dir, value: x.dir.split("/").pop(), err: "" };
      else return;
      paintEdit();
    }
    // 定下来（ok = false：算了）；blur：点了别处——不对就算了，不留着报错
    function commitEdit(ok, blur) {
      var e0 = edit;
      if (!e0) return;
      var nm = String(e0.value || "").trim(), cur = e0.kind === "rename" ? (A.get(e0.id) || {}).name : e0.kind === "rendir" ? e0.dir.split("/").pop() : null;
      if (!ok || !nm || nm === cur) { edit = null; paintEdit(); if (!blur) list.focus({ preventScroll: true }); return; }
      var base = e0.kind === "rendir" ? vpParent(e0.dir) : e0.path, full = (base ? base + "/" : "") + nm, err = "";
      var taken = function (n) { n = n.toLowerCase(); return A.list().concat(A.archived()).some(function (a) { return a.id !== e0.id && a.name.toLowerCase() === n; }); };
      if (e0.kind === "folder" || e0.kind === "rendir") {
        if (/\//.test(nm) || nm === "." || nm === "..") err = tt("名称不能包含「/」。", "A name can't contain \"/\".");
        else if (A.folders(e0.vol).indexOf(full) >= 0) err = tt("此位置已存在文件夹「" + nm + "」。请选择其他名称。", "A folder “" + nm + "” already exists at this location. Please choose a different name.");
      } else if (!/^[A-Za-z][\w.-]{0,44}$/.test(nm)) err = tt("名字以字母开头，只能用字母、数字和 . _ -（最多 45 个）。", "Names start with a letter and use only letters, digits, ., _ and - (max 45).");
      else if (/-\d{2,}$/.test(nm) && taken(nm)) err = tt("已经有叫「" + nm + "」的 Agent 了。请选择其他名称。", "An agent “" + nm + "” already exists. Please choose a different name."); // 不带编号的会自动编上（dev → dev-01），不会重
      if (err) { if (blur) edit = null; else e0.err = err; paintEdit(); return; }
      edit = null;
      if (e0.kind === "agent") { var ag = A.create({ name: nm, vol: e0.vol, path: e0.path }); kKey = "a:" + ag.id; paintEdit(); S.open(ag.id); return; } // 同 VS Code 新建文件：建好就打开
      if (e0.kind === "folder") { A.mkdir(e0.vol, full); kKey = "f:" + dirKey(e0.vol, full); }
      else if (e0.kind === "rename") { var er = A.runtime(e0.id).rename(nm); if (er) { e0.err = er; edit = e0; } }
      else if (e0.kind === "rendir") { if (A.moveDir(e0.vol, e0.dir, full)) { moveFold(e0.vol, e0.dir, full); kKey = "f:" + dirKey(e0.vol, full); } else { e0.err = tt("没能改名。", "Couldn't rename."); edit = e0; } }
      paintEdit();
      if (!edit && !blur) list.focus({ preventScroll: true });
    }
    // 全部折叠：Paimon Code 的卷、文件夹，Claude Code 的目录（sec：只折这一组）
    function collapseAll(sec) {
      if (treeQ) { // 搜着的时候：折起这次搜出来的（各组的标题行不折）
        list.querySelectorAll('[data-fold^="q:"]').forEach(function (r) { var k = r.dataset.fold.slice(2); if (/^(pm|cc|cx)$/.test(k)) return; if (!sec || k.replace(/^o/, "").indexOf(sec + ":") === 0) qfold[r.dataset.fold] = true; });
        return S.render(true);
      }
      if (sec !== "cc") { (A.volumes ? A.volumes() : []).forEach(function (v) { fold[dirKey(v.id, "")] = true; (A.folders ? A.folders(v.id) : []).forEach(function (p) { fold[dirKey(v.id, p)] = true; }); }); fold.pm = false; }
      if (sec !== "pm") { cc.list.forEach(function (x) { ccDirKeys(x.cwd).forEach(function (k) { fold[(fold["only:cc"] ? "o" : "") + k] = true; }); }); fold.cc = false; }
      saveSidePref();
      S.render(true);
    }
    function refreshAll() { refreshCC(true); if (A.sync) A.sync(); S.render(true); }
    // 地址（agents.local.paimon/<卷>/<文件夹>/<名字>.agent，dash.js 给的）：拷贝路径、在 Agent Finder 中显示
    var AD = function () { return window.STUDIO && STUDIO.agentAddr; };
    var addrOf = function (x) { var ad = AD(), a = x && x.id && A.get(x.id); return !ad || !x ? "" : "agents.local.paimon/" + (a ? ad.agent(a) : ad.dir(x.vol, x.dir)); };
    var copyText = function (t) { if (!t) return; if (window.nadosNative) nadosNative.call("clipboard.write", { text: t }).catch(function () {}); else if (navigator.clipboard) navigator.clipboard.writeText(t).catch(function () {}); };
    var finderArg = function (key, dir) { var hm = (window.TSU_LOCAL && TSU_LOCAL.info() || {}).home || "", t = hm && (dir === hm || dir.indexOf(hm + "/") === 0) ? "~" + dir.slice(hm.length) : dir; return key + "/" + t.replace(/^\/+/, ""); }; // Agent Finder 里 Claude Code / Codex 的项目文件夹（dash.js 的地址）
    function inFinder(x) { // agent：到它所在的文件夹；文件夹 / 卷：到那里
      var a = x && x.id && A.get(x.id), ad = AD();
      if (!ad || !x || !window.STUDIO || !STUDIO.openPage) return;
      STUDIO.openPage(tw, "explorer", a ? ad.dir(A.volOf(a.id), a.path || "") : ad.dir(x.vol, x.dir));
    }
    var msg = function (t) { if (window.TSU_CLAUDEAPP && TSU_CLAUDEAPP.dialog) TSU_CLAUDEAPP.dialog({ title: t, buttons: [{ label: tt("好", "OK"), value: true, primary: true }] }); else alert(t); };
    // 剪切 / 拷贝 / 粘贴：agent 剪切 = 挪过去，拷贝 = 分支（带着到现在为止的对话的新 agent）；文件夹只能剪切（同一个卷里挪）
    function clipRow(k, cut) { var x = keyAt(k); if (!x || (!x.id && !(cut && x.dir))) return; cutBuf = x.id ? { cut: cut, id: x.id } : { cut: true, vol: x.vol, dir: x.dir }; S.render(true); }
    var canPaste = function (at) { var c = cutBuf; return !!c && !!at && (!A.volHere || A.volHere(at.vol)) && (c.id ? !!A.get(c.id) : c.vol === at.vol && at.path !== c.dir && at.path.indexOf(c.dir + "/") !== 0 && vpParent(c.dir) !== at.path); };
    function paste(at) {
      at = at || targetDir();
      var c = cutBuf;
      if (!canPaste(at)) return;
      if (c.id) {
        if (c.cut) { if (A.move(c.id, at.path, at.vol)) cutBuf = null; kKey = "a:" + c.id; }
        else { var nb = A.fork ? A.fork(c.id) : null; if (nb) { A.move(nb.id, at.path, at.vol); kKey = "a:" + nb.id; } }
      } else {
        var to = (at.path ? at.path + "/" : "") + c.dir.split("/").pop();
        if (!A.moveDir(c.vol, c.dir, to)) return msg(tt("那里已经有叫「" + c.dir.split("/").pop() + "」的文件夹了。", "There's already a folder named “" + c.dir.split("/").pop() + "” there."));
        moveFold(c.vol, c.dir, to); cutBuf = null; kKey = "f:" + dirKey(c.vol, to);
      }
      reveal(at.vol, at.path);
      S.render(true);
    }
    // 删除：agent 先问（同 Claude App），开着它的面板关掉，再 A.remove（一个标记，会话都还在）；文件夹只删空的
    function delRow(k) {
      var x = keyAt(k), a = x && x.id && A.get(x.id);
      if (a) {
        var go = function () { tw.ws.all().filter(function (p) { return p.program && p.program.agentId === a.id; }).forEach(function (p) { tw.ws.closePane(p); }); A.remove(a.id); if (cutBuf && cutBuf.id === a.id) cutBuf = null; S.render(true); };
        var q = { title: tt("删除「" + a.name + "」？", "Delete “" + a.name + "”?"), text: tt("这个 Agent 会从你所有的设备上移除。", "This agent will be removed from all your devices."), ok: tt("删除", "Delete"), danger: true };
        if (window.TSU_CLAUDEAPP && TSU_CLAUDEAPP.dialog) TSU_CLAUDEAPP.dialog(q).then(function (ok) { if (ok) go(); });
        else if (confirm(q.title + "\n" + q.text)) go();
        return;
      }
      if (!x || !x.dir) return;
      if (!A.rmdir(x.vol, x.dir)) return msg(tt("「" + x.dir.split("/").pop() + "」里还有 Agent，先把它们挪走。", "“" + x.dir.split("/").pop() + "” still has agents in it. Move them out first."));
      kKey = "f:" + dirKey(x.vol, vpParent(x.dir));
      S.render(true);
    }
    // 在侧边打开（同 VS Code：右边分出一组放它）
    S.openSide = function (id) { var a = A.get(id); if (!a) return; if (a.archived) A.unarchive(id); if (tw.ws.active && tw.ws.drop) tw.ws.drop({ kind: "agent", id: id }, tw.ws.active, "right"); else S.open(id); S.render(); };
    // 拖着挪（draggable 问）：放到卷 / 文件夹上，放到 agent 上 = 它所在的文件夹；agent 能换卷（资源还不在卷里时，A.move 管），文件夹只在同一个卷里
    S.dropAt = function (x, y, item) {
      if (item.kind !== "agent" && item.kind !== "vfolder") return null;
      var el = document.elementFromPoint(x, y), r = el && el.closest && el.closest(".ts-row[data-vol], .ts-it[data-id]"), t = null;
      if (!r || !list.contains(r)) return null;
      if (r.dataset.vol !== undefined) t = { el: r, vol: r.dataset.vol, path: r.dataset.vdir || "" };
      else { var a2 = A.get(r.dataset.id); if (!a2 || a2.archived) return null; t = { el: r, vol: A.volOf(a2.id), path: a2.path || "" }; }
      if (A.volHere && !A.volHere(t.vol)) return null;
      if (item.kind === "agent") { var a = A.get(item.id); return a && !a.archived && (A.volOf(a.id) !== t.vol || (a.path || "") !== t.path) ? t : null; }
      return item.vol === t.vol && t.path !== item.dir && vpParent(item.dir) !== t.path && t.path.indexOf(item.dir + "/") !== 0 ? t : null;
    };
    S.drop = function (item, t) {
      if (item.kind === "agent") { A.move(item.id, t.path, t.vol); kKey = "a:" + item.id; }
      else { var to = (t.path ? t.path + "/" : "") + item.dir.split("/").pop(); if (!A.moveDir(item.vol, item.dir, to)) return msg(tt("那里已经有叫「" + item.dir.split("/").pop() + "」的文件夹了。", "There's already a folder named “" + item.dir.split("/").pop() + "” there.")); moveFold(item.vol, item.dir, to); kKey = "f:" + dirKey(item.vol, to); }
      reveal(t.vol, t.path);
      S.render(true);
    };
    var TREE_SPIN = ["·", "✢", "✳\uFE0E", "✶", "✻", "✽", "✽", "✻", "✶", "✳\uFE0E", "✢", "·"]; // ✳ 后面带 U+FE0E（文字样式）：iPad、iPhone 上不带的话它画成绿底的 emoji ✳️
    // 在答的会话（Claude 的标志一明一暗）：每个会话自己的快慢（1.8–2.6 秒一次）和相位，按墙上的钟接着走——一排一起同步呼吸很吓人；
    //   树重画（换了 innerHTML）也不从头来：相位按现在的时间算，看上去是接着的
    function breathSync(box) {
      var now = Date.now() / 1000;
      Array.prototype.forEach.call(box.querySelectorAll("[data-bid]"), function (el) {
        var id = el.dataset.bid, h = 0;
        for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
        var dur = 1.8 + (h % 9) / 10, off = ((h >>> 4) % 997) / 997 * dur;
        el.style.animationDuration = dur.toFixed(2) + "s";
        el.style.animationDelay = (-((now + off) % dur)).toFixed(2) + "s";
      });
    }
    function renderTree() {
      if (edit && !editPaint && list.querySelector(".ts-in")) return; // 正在打字（新建、重命名）：别的原因的重画先等等，输入法、光标都不断
      editPaint = false;
      var light = termLight(), theme = light ? "light" : "dark", DIMC = rgb(light ? "130;130;130" : "120;120;120"), FAINT = rgb(light ? "180;180;180" : "80;80;80");
      var cols = Math.max(14, Math.floor((side.clientWidth - 18) / chPx)), h = here();
      side.style.setProperty("--ts-rgap", (8 + (side.clientWidth - 18 - cols * chPx)).toFixed(1) + "px");
      var H = function (t) { return TTU.ansiToHtml(light ? forLight(t) : t, theme, { widthOf: TTU.visibleWidth }); };
      // 一行：左边一段（可以点），右边几个按钮（各自能点）
      // left：[[文字, 颜色], …]（放不下时从最后一段往前截，颜色码不会被切断）
      var fitSegs = function (segs, room) {
        var out = "", used = 0;
        segs.forEach(function (sg) { if (used >= room) return; var t = sg[0], w = W(t); if (used + w > room) { t = clip(t, Math.max(1, room - used)); w = W(t); } out += (sg[1] || "") + t + RESET; used += w; });
        return out;
      };
      var row = function (cls, attrs, segs, acts) {
        acts = acts || [];
        var rw = acts.reduce(function (n, a, i) { return n + W(a[1]) + (i ? 2 : 0); }, 0), l = fitSegs(segs, Math.max(4, cols - rw - 1));
        return '<span class="ts-row' + (/ts-head/.test(cls) ? " ts-rhead" : "") + '"' + attrs + '><span class="' + cls + '">' + H(l) + "</span>" + H(" ".repeat(Math.max(1, cols - W(l) - rw))) +
          acts.map(function (a, i) { return (i ? H("  ") : "") + '<span class="ts-act ts-btn2" data-act="' + a[0] + '" title="' + escHtml(a[2] || "") + '">' + H(DIMC + a[1] + RESET) + "</span>"; }).join("") + "</span>\n";
      };
      var foldAt = function (k, def) { if (treeQ) { k = "q:" + k; def = false; } return ' data-fold="' + escHtml(k) + '" data-def="' + (def ? 1 : 0) + '"'; };
      // 搜索：名字里每个词都有才算（不分大小写，中文也行）；Claude Code / Codex 的会话 id 开头也认（至少 4 位）。搜到的字同 VS Code 列表里的：蓝、粗
      var qToks = treeQ.toLowerCase().split(/\s+/).filter(Boolean), qLow = treeQ.trim().toLowerCase(), HLC = BLUE + BOLD;
      var qHit = function (name, id) {
        if (!qToks.length) return true;
        var n = String(name || "").toLowerCase();
        return qToks.every(function (t) { return n.indexOf(t) >= 0; }) || (qLow.length >= 4 && /^[0-9a-f-]+$/.test(qLow) && String(id || "").toLowerCase().indexOf(qLow) === 0);
      };
      var marks = function (text, col) { // 名字 → 几段 [字, 颜色]：搜到的那几段加上 HLC
        text = String(text == null ? "" : text);
        var low = text.toLowerCase(), on = [], out0 = [], cur0 = "", hl = false;
        if (!qToks.length || low.length !== text.length) return [[text, col]];
        qToks.forEach(function (t) { for (var i = low.indexOf(t); i >= 0; i = low.indexOf(t, i + t.length)) for (var j = i; j < i + t.length; j++) on[j] = 1; });
        for (var i = 0; i < text.length; i++) { if (!!on[i] !== hl && cur0) { out0.push([cur0, hl ? col + HLC : col]); cur0 = ""; } hl = !!on[i]; cur0 += text[i]; }
        if (cur0) out0.push([cur0, hl ? col + HLC : col]);
        return out0;
      };
      // 一行：左边几段（名字放不下就截），右边一段（标签、时间）
      var right = function (segs, r) { var l = fitSegs(segs, Math.max(4, cols - W(r) - 1)); return l + " ".repeat(Math.max(1, cols - W(l) - W(r))) + r; };
      // 折叠的箭头：同 VS Code 的细线箭头（› / ⌄，左右对称）。先写成私用区的一个字占一格，转完 HTML 再换成画出来的箭头
      var chev = function (k, def) { return folded(k, def) ? "\uE020 " : "\uE021 "; };
      // 标题行右边：筛选（漏斗：空心 = 全部，实心 = 只看在跑的）、全部折叠；新建、刷新在上面的 ··· 里
      var only = function (sec) { return !!fold["only:" + sec]; };
      var canNewIn = function (id) { return !!(window.TSU_CONNECTORS && TSU_CONNECTORS.canNew && TSU_CONNECTORS.canNew(id)); };
      var newActs = function (sec) { // 这一组自己的「新建」：Paimon Code 是 Agent 和文件夹，Claude Code、Codex 是会话
        if (sec === "pm") return [["new-pm-agent", "\uE025", "新建 Agent…"], ["new-pm-folder", "\uE026", "新建文件夹…"]];
        if (sec === "cc") return canNewIn("claude-code") || window.TSU_CLAUDE ? [["new-cc-sess", "\uE027", "新建 Claude Code 会话"]] : [];
        if (sec === "cx") return canNewIn("codex") ? [["new-cx-sess", "\uE027", "新建 Codex 会话"]] : [];
        return [];
      };
      var headActs = function (sec) { return newActs(sec).concat([["only-" + sec, only(sec) ? "\uE023" : "\uE022", only(sec) ? "显示全部" : "仅显示运行中"], ["fold-" + sec, "\uE024", "全部折叠"]]); };
      // ---- 界面字是比例字（html.st-uiprop：设置 › 界面字体 = 系统字体）：树不用等宽格子画，一行一行的 DOM（同「文件」视图：缩进一层 16px、展开箭头一格、
      //   图标一格、名字从同一列开始（放不下就 …）、右边时间；样子在 fonts.css）。行的 class、data-* 和等宽那种一样，点、键盘、拖、右键、翻译都照旧 ----
      var dom = root.classList.contains("st-uiprop");
      list.classList.toggle("ts-dom", dom);
      var HR = function (segs, r) { return H(right(segs, r)); }; // agent / 会话那一行：左边几段 + 右边时间
      var domEdit = null;
      if (dom) {
        side.style.setProperty("--ts-rgap", "8px");
        var strip = function (t) { return String(t).replace(/\x1b\[[\d;]*m/g, ""); };
        var colorOf = function (t) { var m, c = "", re = /\x1b\[([\d;]*)m/g; while ((m = re.exec(String(t)))) { var a = m[1].split(";"); if (a[0] === "0" || a[0] === "39" || a[0] === "") c = ""; if (a[0] === "38" && a[1] === "2") c = "rgb(" + a[2] + "," + a[3] + "," + a[4] + ")"; } return c; };
        var ansiHtml = function (t) { // 一段带颜色码的字 → <span style>（不画成格子；颜色写成 color:rgb(…)，下面换成配色方案里的淡色）
          var html = "", bold = false, color = "";
          String(light ? forLight(t) : t).split(/(\x1b\[[\d;]*m)/).forEach(function (part) {
            var m = /^\x1b\[([\d;]*)m$/.exec(part);
            if (m) {
              var a = m[1].split(";").map(Number);
              for (var i = 0; i < a.length; i++) {
                if (a[i] === 0) { bold = false; color = ""; } else if (a[i] === 1) bold = true; else if (a[i] === 22) bold = false; else if (a[i] === 39) color = "";
                else if (a[i] === 38 && a[i + 1] === 2) { color = "rgb(" + a[i + 2] + "," + a[i + 3] + "," + a[i + 4] + ")"; i += 4; }
              }
              return;
            }
            if (!part) return;
            var sty = (color ? "color:" + color + ";" : "") + (bold ? "font-weight:600;" : "");
            html += sty ? '<span style="' + sty + '">' + escHtml(part) + "</span>" : escHtml(part);
          });
          return html;
        };
        var CHV = { "": "ts-chev r", "": "ts-chev d" }, ACTIC = { "": "ts-ic filter", "": "ts-ic filter on", "": "ts-ic collapse", "": "ts-ic newagent", "": "ts-ic newfolder", "": "ts-ic newsess" };
        var FOLD_IC = '<span class="ts-dic ts-dfold">' + (TREE_IC.folder || "") + "</span>";
        // 没有文件夹图标的那几种标题行（已固定、已归档、自己分的组、Paimon 的卷）也放一个图标：名字和同一层的文件夹对齐（data-ic）
        var ROW_IC = { pin: TIC('<path d="M10.4 2.3l3.3 3.3-1.6.4-2.4 2.4.2 2.6-1.1 1.1-5.3-5.3 1.1-1.1 2.6.2 2.4-2.4z"/><path d="M5.7 10.3l-3.1 3.1"/>'),
          arch: TIC('<rect x="2" y="3" width="12" height="3" rx=".8"/><path d="M3.2 6v6.2c0 .5.4.9.9.9h7.8c.5 0 .9-.4.9-.9V6M6.5 8.6h3"/>'), grp: TREE_IC.folder,
          disk: TIC('<rect x="1.8" y="4.4" width="12.4" height="7.2" rx="1.6"/><path d="M1.8 8.6h12.4M11.4 10.2h.01"/>'), cloud: TIC('<path d="M4.6 12.4h7a2.8 2.8 0 0 0 .4-5.6A3.8 3.8 0 0 0 4.7 6a3 3 0 0 0-.1 6.4z"/>') };
        var parse = function (segs) { // 几段（[字, 颜色]）→ 第几层（行首两个空格一层）、展开箭头、图标（✻ ◎）、名字
          var lead = 0, dis = "", icon = "", label = "", started = false;
          segs.forEach(function (sg) {
            var raw = String(sg[0] || ""), c = sg[1] || "", t = strip(raw);
            if (!started && !dis && !icon) { var sp = /^ */.exec(t)[0].length; lead += sp; t = t.slice(sp); }
            if (!t) return;
            if (CHV[t.charAt(0)]) { dis = '<span class="' + CHV[t.charAt(0)] + '"></span>'; t = t.slice(1).replace(/^ +/, ""); if (!t) return; }
            if (!started && /^[✻◎✦✳\uE030-\uE035] *$/.test(t)) { var col = colorOf(c + raw); icon = '<span class="ts-dic"' + (col ? ' style="color:' + col + '"' : "") + ">" + escHtml(t.trim()) + "</span>"; return; }
            started = true;
            label += ansiHtml(c + t + RESET);
          });
          return { d: Math.floor(lead / 2), dis: dis, icon: icon, label: label };
        };
        H = function (t) { // 单独的一行字（「暂无会话」这种、「全部 N 个会话」）
          var sp = /^ */.exec(strip(t))[0].length;
          return '<span class="ts-row ts-note"><span class="ts-dl" style="--d:' + Math.floor(sp / 2) + '"><span class="ts-ddis"></span><span class="ts-dn">' + ansiHtml(String(t).replace(/^ +/, "")) + "</span></span></span>";
        };
        row = function (cls, attrs, segs, acts) {
          var x = parse(segs), isDir = / data-vdir="[^"]/.test(attrs) || / data-conn="/.test(attrs), ic2 = / data-ic="(\w+)"/.exec(attrs); // 文件夹（Paimon 的、Claude Code / Codex 的目录）：前面一个文件夹图标，名字和同一层的 agent、会话对齐
          if (ic2 && ROW_IC[ic2[1]] && !x.icon) x.icon = '<span class="ts-dic ts-dfold">' + ROW_IC[ic2[1]] + "</span>";
          return '<span class="ts-row' + (/ts-head/.test(cls) ? " ts-rhead" : "") + '"' + attrs + '><span class="' + cls + ' ts-dl" style="--d:' + x.d + '"><span class="ts-ddis">' + x.dis + "</span>" + (x.icon || (isDir ? FOLD_IC : "")) + '<span class="ts-dn">' + x.label + "</span></span>" +
            (acts || []).map(function (a) { return '<span class="ts-act ts-btn2" data-act="' + a[0] + '" title="' + escHtml(a[2] || "") + '"><span class="' + (ACTIC[a[1]] || "") + '"></span></span>'; }).join("") + "</span>\n";
        };
        // leaf：agent、会话这种没有下一层的行不留展开箭头那一格——图标就落在上一层文件夹图标的那一列（同 Codex 那组：子文件夹的箭头也在这一列）
        HR = function (segs, r, leaf) { var x = parse(segs); return '<span class="ts-dl" style="--d:' + x.d + '">' + (leaf ? "" : '<span class="ts-ddis"></span>') + x.icon + '<span class="ts-dn">' + x.label + '</span><span class="ts-dt">' + ansiHtml(r) + "</span></span>"; };
        domEdit = function (indent, ic) { // 新建 / 重命名的输入框那一行（新建 / 改名 agent 的同 agent 那一行：不留箭头格）
          var x = parse([[indent, ""], [ic, ""]]), dir = edit.kind === "folder" || edit.kind === "rendir";
          return '<span class="ts-row ts-edit"><span class="ts-dl" style="--d:' + x.d + '">' + (dir || x.dis ? '<span class="ts-ddis">' + x.dis + "</span>" : "") + (x.icon || (dir ? FOLD_IC : "")) +
            '<input class="st-finput ts-in" spellcheck="false" autocomplete="off" value="' + escHtml(edit.value || "") + '"></span></span>\n' +
            (edit.err ? '<span class="st-ferr ts-err' + (dir || x.dis ? "" : " ts-errl") + '" style="--d:' + x.d + '">' + escHtml(edit.err) + "</span>\n" : "");
        };
      }
      var out = "", all = A.list(), st = {};
      all.forEach(function (a) { st[a.id] = agentStatus(a); });
      order = ["f", "b", "o"].reduce(function (acc, g) { return acc.concat(all.filter(function (a) { return st[a.id].g === g; }).sort(function (x, y) { return (y.active || 0) - (x.active || 0); })); }, []);
      // ---- Paimon（连接器：关了整区不画，新建 Agent / 文件夹的按钮在它的标题上，一起没有）----
      var pmHits = qToks.length ? order.filter(function (a) { return qHit(a.name, a.id); }) : order, pmArchHits = qToks.length && pmTree() ? A.archived().filter(function (a) { return qHit(a.name, a.id); }) : null;
      var pmShow = pmTree() && (!qToks.length || pmHits.length || pmArchHits.length); // 搜着的时候：这一组一个都没搜到就整组不画
      if (pmShow) out += row("ts-fold ts-head", foldAt("pm", false), [[chev("pm"), ""], ["Paimon Code", BOLD]], headActs("pm"));
      if (pmShow && !folded("pm")) {
        var shownPm = only("pm") ? pmHits.filter(function (a) { return st[a.id].g !== "o"; }) : pmHits;
        if (only("pm") && !shownPm.length) out += H("  " + DIMC + "无运行中的 Agent" + RESET) + "\n";
        // 卷 › 文件夹 › agent（同 VS Code 的资源管理器：同一层文件夹在前、agent 在后，往下一层多缩两格）。文件夹平时收着，里面有在跑的才展开；
        // 只看在跑的：没有在跑的卷、文件夹整个不显示
        var ind = function (depth) { return "  " + "  ".repeat(depth); };
        var busyIn = function (vol, p) { return order.some(function (a) { var ap = a.path || ""; return st[a.id].g !== "o" && A.volOf(a.id) === vol && (!p || ap === p || ap.indexOf(p + "/") === 0); }); };
        var hitIn = function (vol, p) { return !qToks.length || shownPm.some(function (a) { var ap = a.path || ""; return A.volOf(a.id) === vol && (!p || ap === p || ap.indexOf(p + "/") === 0); }); }; // 搜着的时候：里面有搜到的才画这个卷 / 文件夹
        var editRow = function (depth, ic) { // 新建 / 重命名的那一行：输入框（同「文件」视图的），不对就在下面说
          if (domEdit) return domEdit(ind(depth), ic);
          return '<span class="ts-row ts-edit">' + H(ind(depth) + ic) + '<input class="st-finput ts-in" spellcheck="false" autocomplete="off" value="' + escHtml(edit.value || "") + '"></span>\n' +
            (edit.err ? '<span class="st-ferr ts-err" style="--ind:' + (W(ind(depth)) + 2) + '">' + escHtml(edit.err) + "</span>\n" : "");
        };
        // Paimon 的 agent：前面是派蒙的头像（不是 ✻）——占位字 \uE031 没在跑、\uE032 开在这个窗口里、\uE033 在后台、\uE034 在干活，画完换成头像：
        //   没在跑的淡一些；开着、在后台的右下角一个小点（绿 / 蓝）；在干活的一明一暗（各自的快慢、起点：data-bid，画完见 breathSync）
        var PM_ST = { "\uE031": "idle", "\uE032": "open", "\uE033": "bg", "\uE034": "work" };
        var pmLogoIn = function (html, id) { var src = (window.TSU_LOGOS && TSU_LOGOS.paimonSrc) || "img/paimon.png"; return String(html).replace(/[\uE031-\uE034]/g, function (c) { var k = PM_ST[c]; return '<i class="ts-pml s-' + k + '"' + (k === "work" && id ? ' data-bid="' + escHtml(id) + '"' : "") + '><img src="' + src + '" alt="" draggable="false"></i>'; }); };
        var agentRow = function (a, depth) {
          var g = st[a.id].g, tag = st[a.id].tag.replace(/\s+$/, ""), nameC = h.open[a.id] || a.id === h.cur ? BOLD : ""; // 开着的粗体；当前那个靠底色（.cur），字不变色
          // 同 Claude Code 的会话：✻（不转，颜色看状态）——在干活的橙、开在这个窗口里的绿、在后台的蓝、没在跑的灰；右边只留时间。
          // 一个 agent 的几段会话不在树里展开（右键 › 会话）；名字后面淡淡的 .agent（它是一个包）
          var work = /\[W\]/.test(tag), icC = work ? ORANGE : g === "f" ? GREEN : g === "b" ? rgb("113;142;244") : DIMC;
          var pmk = work ? "\uE034" : g === "f" ? "\uE032" : g === "b" ? "\uE033" : "\uE031"; // 派蒙的头像（占位字，画完换，见 pmLogoIn）
          if (edit && edit.kind === "rename" && edit.id === a.id) return pmLogoIn(editRow(depth, icC + pmk + " " + RESET), a.id);
          return pmLogoIn('<span class="ts-it' + (a.id === h.cur ? " cur" : "") + (cutBuf && cutBuf.cut && cutBuf.id === a.id ? " ts-cut" : "") + '" data-id="' + a.id + '">' + HR([[ind(depth), ""], [pmk + " ", icC]].concat(marks(a.name, nameC), [[".agent", FAINT]]), DIMC + st[a.id].time + RESET, true) + "</span>\n", a.id);
        };
        var level = function (vol, p, depth) { // 这一层：新建的输入框、子文件夹、住在这一层的 agent
          if (edit && (edit.kind === "agent" || edit.kind === "folder") && edit.vol === vol && edit.path === p) out += pmLogoIn(editRow(depth, edit.kind === "folder" ? " " : DIMC + "\uE031 " + RESET));
          (A.folders ? A.folders(vol) : []).filter(function (q) { return vpParent(q) === p; }).forEach(function (q) {
            if (only("pm") && !busyIn(vol, q) || !hitIn(vol, q)) return;
            var k = dirKey(vol, q), def = !only("pm") && !busyIn(vol, q);
            if (edit && edit.kind === "rendir" && edit.vol === vol && edit.dir === q) out += editRow(depth, chev(k, def));
            else out += row("ts-fold" + (cutBuf && cutBuf.cut && !cutBuf.id && cutBuf.vol === vol && cutBuf.dir === q ? " ts-cut" : ""), foldAt(k, def) + ' data-vol="' + escHtml(vol) + '" data-vdir="' + escHtml(q) + '"', [[ind(depth) + chev(k, def), ""], [q.split("/").pop(), DIMC]]);
            if (!folded(k, def)) level(vol, q, depth + 1);
          });
          shownPm.filter(function (a) { return A.volOf(a.id) === vol && (a.path || "") === p; }).forEach(function (a) { out += agentRow(a, depth); });
        };
        (A.volumes ? A.volumes() : [{ id: "cloud", label: "Cloud", here: true }]).forEach(function (v) { // 卷：这台 Mac、Cloud、别的 Mac（这台够不着的淡一点）
          if (only("pm") && !busyIn(v.id, "") || !hitIn(v.id, "")) return;
          var k = dirKey(v.id, "");
          out += row("ts-fold ts-vol", foldAt(k, false) + ' data-vol="' + escHtml(v.id) + '" data-vdir="" data-ic="' + (v.id === "cloud" ? "cloud" : "disk") + '"', [["  " + chev(k, false), ""], [v.label, v.here ? "" : DIMC]]);
          if (!folded(k, false)) level(v.id, "", 1);
        });
        var arch = only("pm") ? [] : pmArchHits || A.archived();
        if (arch.length) {
          out += row("ts-fold", foldAt("pm:arch", true) + ' data-ic="arch"', [["  " + chev("pm:arch", true), ""], ["已归档", DIMC]]);
          if (!folded("pm:arch", true)) arch.forEach(function (a) { out += pmLogoIn('<span class="ts-it" data-id="' + a.id + '">' + HR([["    ", ""], ["\uE031 ", DIMC]].concat(marks(a.name, DIMC)), DIMC + agoCN(a.archivedAt || a.active) + RESET, true) + "</span>\n"); });
        }
      }
      // ---- Claude Code（扩展）：按目录分组 ----
      var EXTc = ccExt(), ccL = window.TSU_LOCAL && ccOn() ? (qToks.length ? ccSearchList().filter(function (x) { return qHit(EXTc.name["cc:" + x.id] || x.title, x.id); }) : cc.list) : []; // 改过的名字、固定、归档（和 Claude App 的边栏共用一份）；搜着的时候：全部会话里搜到的
      if (window.TSU_LOCAL && ccOn() && (!qToks.length || ccL.length)) {
        var here2 = ccPanes(), grp = function (x) { return here2[x.id] ? "f" : x.live ? "b" : "o"; }, home0 = (TSU_LOCAL.info() || {}).home || "";
        var tl = function (p) { return home0 && (p === home0 || String(p).indexOf(home0 + "/") === 0) ? "~" + p.slice(home0.length) : p || "?"; };
        out += "\n" + row("ts-fold ts-head", foldAt("cc", false), [[chev("cc"), ""], ["Claude Code", BOLD]], headActs("cc"));
        if (!folded("cc")) {
          // 缩进的规矩：同一层的行第一个字在同一列（目录的箭头、会话的图标），往下一层多缩两格——同缩进就是同级。
          // 目录树（同 VS Code 资源管理器的「紧凑文件夹」）：会话挂在开它的目录上；一个目录自己没有会话、只有一个子目录，就和子目录并成一行（a/b/c），一直并到分叉的地方
          var ccKey = function (x) { return "cc:" + x.id; };
          var ccPin = ccL.filter(function (x) { return EXTc.pin[ccKey(x)] && !EXTc.arch[ccKey(x)]; }), ccArch = ccL.filter(function (x) { return EXTc.arch[ccKey(x)]; });
          var ccGrpOf = function (x) { return !EXTc.pin[ccKey(x)] && !EXTc.arch[ccKey(x)] && EXTc.group && EXTc.group[ccKey(x)] || ""; }, UNR = ccUnread(); // 自己分的组（会话菜单「移到分组」）；未读（蓝点）
          var ccOrder = function (a, b) { return ({ f: 0, b: 1, o: 2 }[grp(a)] - { f: 0, b: 1, o: 2 }[grp(b)]) || b.mtime - a.mtime; };
          // 行里占位的那个字（\uE030）换成 Claude 的标志：等宽的树里占一格，界面字是比例字的树里在图标那一格（parse 认它）
          //   在答的一明一暗：每个会话自己的快慢、起点（data-bid，画完见 breathSync）——一排一起同步呼吸很吓人
          var ccLogoIn = function (html, busy, id) { var L0 = window.TSU_LOGOS && TSU_LOGOS.claude; return L0 ? String(html).replace(/\uE030/g, '<i class="ts-ccl' + (busy ? " busy" : "") + '"' + (busy && id ? ' data-bid="' + escHtml(id) + '"' : "") + ">" + L0 + "</i>") : String(html).replace(/\uE030/g, ""); };
          var ccRowOut = function (x, ind) {
            var g = grp(x), busy = x.live && x.live.status === "busy";
            var viewing = null;
            tw.ws.all().forEach(function (p) { if (p.program && p.program.agentId === "cc:" + x.id) viewing = p; });
            var when = g === "o" ? agoCN(x.mtime) : durCN(Date.now() - (x.live && x.live.since || x.mtime)), isCur = !!(here2[x.id] || viewing) && (here2[x.id] || viewing) === tw.ws.active, nameC = here2[x.id] || viewing ? BOLD : x.missing && !x.job ? DIMC : "";
            // Claude Code 的会话：前面是 Claude 自己的标志（不是 ✻ 这种山寨的星星）——在跑、开着的是 Claude 的橙（在答的一明一暗），没在跑的淡灰
            var icc = "\uE030 ", iccC = busy || g !== "o" ? rgb("217;119;87") : DIMC;
            if (isCur && UNR["cc:" + x.id]) { delete UNR["cc:" + x.id]; ccMarkRead(x.id); } // 正看着：已读
            var unDot = UNR["cc:" + x.id] ? [[" ●", rgb("61;123;245")]] : []; // 未读：名字后面一个蓝点（同 Claude App）
            out += '<span class="ts-it' + (isCur ? " cur" : "") + '" data-cc="' + x.id + '">' + ccLogoIn(HR([[ind + "  ", ""], [icc, iccC]].concat(marks(EXTc.name["cc:" + x.id] || x.title, x.dimTitle && !EXTc.name["cc:" + x.id] && !nameC ? DIMC : nameC), unDot), DIMC + when + RESET, true), busy, x.id) + "</span>\n";
          };
          var top = { kids: {}, items: [] };
          ccL.filter(function (x) { return !EXTc.pin[ccKey(x)] && !EXTc.arch[ccKey(x)] && !ccGrpOf(x); }).forEach(function (x) {
            var parts = tl(x.cwd || "?").split("/"), n = top, at = "";
            if (parts[0] === "") parts[0] = "/";
            parts.filter(Boolean).forEach(function (sg) {
              at = !at ? sg : at === "/" ? "/" + sg : at + "/" + sg;
              n = n.kids[sg] || (n.kids[sg] = { name: sg, path: at, kids: {}, items: [] });
            });
            n.items.push(x);
          });
          // 每个目录：一共几个会话、几个在跑、最近什么时候动过；子目录按「有在跑的、最近动过的」排前面
          (function stat(n) {
            n.list = Object.keys(n.kids).map(function (k) { return n.kids[k]; });
            n.list.forEach(stat);
            n.total = n.items.length + n.list.reduce(function (t, c) { return t + c.total; }, 0);
            n.live = n.items.filter(function (x) { return grp(x) !== "o"; }).length + n.list.reduce(function (t, c) { return t + c.live; }, 0);
            n.t = n.items.concat(n.list).reduce(function (t, c) { return Math.max(t, c.t || c.mtime || 0); }, 0);
            n.list.sort(function (a, b) { return (b.live > 0) - (a.live > 0) || b.t - a.t; });
          })(top);
          var join = function (a, b) { return a === "/" ? "/" + b : a + "/" + b; };
          var drawDir = function (n, depth) {
            while (!n.items.length && n.list.length === 1) { var c = n.list[0]; n = { name: join(n.name, c.name), path: c.path, items: c.items, list: c.list, total: c.total, live: c.live, t: c.t }; }
            if (only("cc") && !n.live) return; // 只看在跑的：这个目录下没有在跑的，整个不显示
            // 平时：顶层的展开，再往下有在跑的会话才展开。筛选（只看在跑的）时：全都展开（筛出来就是要看的）；这时候的折叠另记一份，关了筛选回到平时的样子
            var k = (only("cc") ? "o" : "") + "cc:" + n.path, def = !only("cc") && depth > 0 && !n.live, ind = "  " + "  ".repeat(depth);
            out += row("ts-fold", foldAt(k, def) + ' data-conn="claude-code" data-dir="' + escHtml(n.path.replace(/^~(?=\/|$)/, home0)) + '"', [[ind + chev(k, def), ""], [n.name, DIMC]]);
            if (folded(k, def)) return;
            n.list.forEach(function (c) { drawDir(c, depth + 1); });
            n.items.filter(function (x) { return !only("cc") || grp(x) !== "o"; }).sort(ccOrder).forEach(function (x) { ccRowOut(x, ind); });
          };
          var pinShown = ccPin.filter(function (x) { return !only("cc") || grp(x) !== "o"; });
          if (pinShown.length) { var kp = "cc:#pinned"; out += row("ts-fold", foldAt(kp, false) + ' data-ic="pin"', [["  " + chev(kp, false), ""], ["已固定", DIMC]]); if (!folded(kp, false)) pinShown.sort(ccOrder).forEach(function (x) { ccRowOut(x, "  "); }); }
          // 自己分的组：「已固定」下面，一组一个（按名字排），里面按在跑、最近排
          var ccG = {}; ccL.forEach(function (x) { var g0 = ccGrpOf(x); if (g0 && (!only("cc") || grp(x) !== "o")) (ccG[g0] = ccG[g0] || []).push(x); });
          Object.keys(ccG).sort().forEach(function (gn) { var kg = "cc:#g:" + gn; out += row("ts-fold", foldAt(kg, false) + ' data-ic="grp"', [["  " + chev(kg, false), ""], [gn, DIMC]]); if (!folded(kg, false)) ccG[gn].sort(ccOrder).forEach(function (x) { ccRowOut(x, "  "); }); });
          if (!top.list.length && !pinShown.length && !Object.keys(ccG).length && !(qToks.length && ccArch.length)) out += H("  " + DIMC + "暂无会话" + RESET) + "\n";
          else if (only("cc") && !top.live && !pinShown.length) out += H("  " + DIMC + "无运行中的会话" + RESET) + "\n";
          top.list.forEach(function (c) { drawDir(c, 0); });
          if (ccArch.length && !only("cc")) { var ka = "cc:#archived"; out += row("ts-fold", foldAt(ka, true) + ' data-ic="arch"', [["  " + chev(ka, true), ""], ["已归档 " + ccArch.length, DIMC]]); if (!folded(ka, true)) ccArch.sort(ccOrder).forEach(function (x) { ccRowOut(x, "  "); }); }
        }
      }
      // ---- Codex（连接器，codex.js）：同 Claude Code，按目录分组；最近 40 个，「全部」看其余的；已归档的在最后一组（收着）----
      //   目录行带 data-conn="codex" data-dir="<绝对路径>"（在那里开新会话：TSU_CONNECTORS.newSession("codex", 目录)）
      var cxQ = window.TSU_LOCAL && cxOn() && window.TSU_CODEX && qToks.length ? TSU_CODEX.list().filter(function (x) { return qHit(EXTc.name["cx:" + x.id] || x.title, x.id); }) : null; // 搜着的时候（改过名的按新名字搜）：全部会话里搜到的（不止最近 40 个）
      if (window.TSU_LOCAL && cxOn() && window.TSU_CODEX && (!cxQ || cxQ.length)) {
        var kx = function (x) { return "cx:" + x.id; }, UNRx = ccUnread(); // 固定、改名、归档、分组、未读：同 Claude Code（同一份 st-claude-ext，键是 cx:<id>）
        var CX = TSU_CODEX, cxAll = cxQ || CX.list(), cxArchQ = function (x) { return x.archived || EXTc.arch[kx(x)]; }, cxLive = cxAll.filter(function (x) { return !cxArchQ(x); }), cxArch = cxAll.filter(cxArchQ);
        var cxPinL = cxLive.filter(function (x) { return EXTc.pin[kx(x)]; }), cxGrpOf = function (x) { return !EXTc.pin[kx(x)] && EXTc.group && EXTc.group[kx(x)] || ""; };
        var home1 = (TSU_LOCAL.info() || {}).home || "", seeX = {};
        tw.ws.all().forEach(function (p) { var ag = p.program && p.program.agentId; if (ag && /^cx:/.test(ag)) seeX[CX.real(ag.slice(3))] = p; });
        var grpX = function (x) { return seeX[x.id] ? "f" : x.live ? "b" : "o"; };
        var tlX = function (p) { return home1 && (p === home1 || String(p).indexOf(home1 + "/") === 0) ? "~" + p.slice(home1.length) : p || "?"; };
        // Codex 的会话：前面是 Codex 的标志（ChatGPT / OpenAI 的结，同标签页、仪表盘上的），不是 ◎——占位字 \uE035 画完换成它（同 Claude Code 的 \uE030）；
        //   开着、在跑的是 OpenAI 的绿（在跑的一明一暗），没在跑的淡灰
        var cxLogoIn = function (html, busy) { var L0 = window.TSU_LOGOS && TSU_LOGOS.codex; return L0 ? String(html).replace(/\uE035/g, '<i class="ts-ccl ts-cxl' + (busy ? " busy" : "") + '">' + L0 + "</i>") : String(html).replace(/\uE035/g, "◎"); };
        var cxRow = function (x, ind) {
          var g = grpX(x), busy = x.live && x.live.status === "busy", pv = seeX[x.id], isCur = !!pv && pv === tw.ws.active;
          var when = g === "o" ? agoCN(x.mtime) : durCN(Date.now() - (x.live && x.live.since || x.mtime)), icC = busy || g !== "o" ? "" : DIMC; // 活着的用字色（OpenAI 的黑 / 白；同 Claude Code 的会话用它的橙），没在跑的淡灰
          if (isCur && UNRx[kx(x)]) { delete UNRx[kx(x)]; ccUnreadSave(UNRx); } // 正看着：已读
          var nm = EXTc.name[kx(x)] || x.title, unDot = UNRx[kx(x)] ? [[" ●", rgb("61;123;245")]] : [];
          return '<span class="ts-it' + (isCur ? " cur" : "") + '" data-cx="' + x.id + '">' + cxLogoIn(HR([[ind + "  ", ""], ["\uE035 ", icC]].concat(marks(nm, pv ? BOLD : x.dimTitle && !EXTc.name[kx(x)] ? DIMC : ""), unDot), DIMC + when + RESET, true), busy) + "</span>\n"; // 没有像样标题的（只有 /exit 这种）：目录名 + 时间，淡的
        };
        out += "\n" + row("ts-fold ts-head", foldAt("cx", false), [[chev("cx"), ""], ["Codex", BOLD]], headActs("cx"));
        if (!folded("cx")) {
          var cxOrd = function (a, b) { return ({ f: 0, b: 1, o: 2 }[grpX(a)] - { f: 0, b: 1, o: 2 }[grpX(b)]) || b.mtime - a.mtime; };
          // 已固定、自己分的组：放在目录树上面（同 Claude Code）
          var pinX = cxPinL.filter(function (x) { return !only("cx") || grpX(x) !== "o"; });
          if (pinX.length) { var kpx = "cx:#pinned"; out += row("ts-fold", foldAt(kpx, false) + ' data-ic="pin"', [["  " + chev(kpx, false), ""], ["已固定", DIMC]]); if (!folded(kpx, false)) pinX.sort(cxOrd).forEach(function (x) { out += cxRow(x, "  "); }); }
          var cxG = {}; cxLive.forEach(function (x) { var g0 = cxGrpOf(x); if (g0 && (!only("cx") || grpX(x) !== "o")) (cxG[g0] = cxG[g0] || []).push(x); });
          Object.keys(cxG).sort().forEach(function (gn) { var kgx = "cx:#g:" + gn; out += row("ts-fold", foldAt(kgx, false) + ' data-ic="grp"', [["  " + chev(kgx, false), ""], [gn, DIMC]]); if (!folded(kgx, false)) cxG[gn].sort(cxOrd).forEach(function (x) { out += cxRow(x, "  "); }); });
          var treeX = cxLive.filter(function (x) { return !EXTc.pin[kx(x)] && !cxGrpOf(x); });
          var cut0 = fold["cx:all"] || cxQ ? treeX.length : 40, shownX = treeX.filter(function (x, i) { return i < cut0 || grpX(x) !== "o"; });
          var topX = { kids: {}, items: [] };
          shownX.forEach(function (x) {
            var parts = tlX(x.cwd || "?").split("/"), n = topX, at = "";
            if (parts[0] === "") parts[0] = "/";
            parts.filter(Boolean).forEach(function (sg) { at = !at ? sg : at === "/" ? "/" + sg : at + "/" + sg; n = n.kids[sg] || (n.kids[sg] = { name: sg, path: at, kids: {}, items: [] }); });
            n.items.push(x);
          });
          (function statX(n) {
            n.list = Object.keys(n.kids).map(function (k) { return n.kids[k]; });
            n.list.forEach(statX);
            n.live = n.items.filter(function (x) { return grpX(x) !== "o"; }).length + n.list.reduce(function (t, c) { return t + c.live; }, 0);
            n.t = n.items.concat(n.list).reduce(function (t, c) { return Math.max(t, c.t || c.mtime || 0); }, 0);
            n.list.sort(function (a, b) { return (b.live > 0) - (a.live > 0) || b.t - a.t; });
          })(topX);
          var drawX = function (n, depth) {
            while (!n.items.length && n.list.length === 1) { var c = n.list[0]; n = { name: n.name === "/" ? "/" + c.name : n.name + "/" + c.name, path: c.path, items: c.items, list: c.list, live: c.live, t: c.t }; }
            if (only("cx") && !n.live) return;
            var k = (only("cx") ? "o" : "") + "cx:" + n.path, def = !only("cx") && depth > 0 && !n.live, ind = "  " + "  ".repeat(depth);
            out += row("ts-fold", foldAt(k, def) + ' data-conn="codex" data-dir="' + escHtml(n.path.replace(/^~(?=\/|$)/, home1)) + '"', [[ind + chev(k, def), ""], [n.name, DIMC]]);
            if (folded(k, def)) return;
            n.list.forEach(function (c) { drawX(c, depth + 1); });
            n.items.filter(function (x) { return !only("cx") || grpX(x) !== "o"; }).sort(function (a, b) { return ({ f: 0, b: 1, o: 2 }[grpX(a)] - { f: 0, b: 1, o: 2 }[grpX(b)]) || b.mtime - a.mtime; }).forEach(function (x) { out += cxRow(x, ind); });
          };
          if (!cxAll.length) out += H("  " + DIMC + "暂无会话" + RESET) + "\n";
          else if (only("cx") && !topX.live) out += H("  " + DIMC + "无运行中的会话" + RESET) + "\n";
          topX.list.forEach(function (c) { drawX(c, 0); });
          if (!only("cx") && !cxQ && cxLive.length > 40) out += '<span class="ts-act" data-act="cx-all">' + H("  " + DIMC + (fold["cx:all"] ? "仅显示最近" : "全部 " + cxLive.length + " 个会话") + RESET) + "</span>\n";
          if (!only("cx") && cxArch.length) {
            out += row("ts-fold", foldAt("cx:arch", true) + ' data-ic="arch"', [["  " + chev("cx:arch", true), ""], ["已归档", DIMC]]);
            if (!folded("cx:arch", true)) cxArch.forEach(function (x) { out += cxRow(x, "  "); });
          }
        }
      }
      out = out.replace(/^\n+/, ""); // Paimon 那组没开：Claude Code 那组前面隔开用的空行不要（搜索框下面空出一大块）
      if (qToks.length && !out.trim()) out = H("  " + DIMC + tt("没有找到「" + treeQ.trim() + "」", "No results for “" + treeQ.trim() + "”") + RESET) + "\n"; // 搜着的时候一个都没有
      list.classList.toggle("ttu-light", light);
      // 树里的淡色、更淡的颜色写的是固定的灰：换成配色方案里的（换了方案跟着变）
      out = out.replace(/color:rgb\((\d+),(\d+),(\d+)\)/g, function (m, r, g, b) { var k = r + "," + g + "," + b; return k === "120,120,120" || k === "130,130,130" ? "color:var(--st-dim)" : k === "80,80,80" || k === "180,180,180" ? "color:var(--st-faint)" : m; });
      out = out.replace(/<span style="display:inline-block;width:var\(--ttu-cell,1ch\)">([\uE020-\uE027])<\/span>/g, function (m, c) { return '<span class="' + { "\uE020": "ts-chev r", "\uE021": "ts-chev d", "\uE022": "ts-ic filter", "\uE023": "ts-ic filter on", "\uE024": "ts-ic collapse", "\uE025": "ts-ic newagent", "\uE026": "ts-ic newfolder", "\uE027": "ts-ic newsess" }[c] + '"></span>'; });
      if (out !== lastHtml) { lastHtml = out; list.innerHTML = out; breathSync(list); if (S.paintFocus) S.paintFocus(); }
      var tin = edit && list.querySelector(".ts-in"); // 新建 / 重命名的输入框：拿到焦点（改名的全选上）
      if (tin && document.activeElement !== tin) { tin.focus({ preventScroll: true }); tin.setSelectionRange(edit.kind === "rename" || edit.kind === "rendir" ? 0 : tin.value.length, tin.value.length); tin.scrollIntoView({ block: "nearest" }); }
    }
    // ---- Claude Code（Paimon Terminal：这台 Mac 上的，~/.claude）：同上面 agent 的 FBO——[F] 开在这个窗口的某个标签页里、[B] 在别处跑着（后台会话、别的终端里）、
    // [O] 没在跑；[W] 在干活、[NW] 闲着。点一下：开着就跳过去；后台会话 claude attach；别的回到开它的目录 claude --resume（Claude Code 按目录找会话）----
    // 上次读到的列表（这台设备记着）：一打开就先画它，不等原生那边读完；读到新的再换。在跑没在跑不记（等真读到）
    var CC_KEEP = "tsu-cc-list", ccKept = "";
    var ccCached = function () { try { var l = JSON.parse(localStorage.getItem(CC_KEEP) || "[]"); return Array.isArray(l) ? l.filter(function (x) { return x && x.id; }) : []; } catch (e) { return []; } };
    var ccKeep = function (l) {
      try {
        var j = JSON.stringify(l.map(function (x) { var o = { last: String(x.last || "").slice(0, 400) }; ["id", "path", "cwd", "missing", "title", "custom", "dimTitle", "mtime", "size", "job", "turnAt", "ctx", "model"].forEach(function (k) { if (x[k] !== undefined) o[k] = x[k]; }); return o; }));
        if (j !== ccKept) { ccKept = j; localStorage.setItem(CC_KEEP, j); }
      } catch (e) { /* 满了就不记 */ }
    };
    var cc = { list: ccCached(), busy: false, all: false, at: 0 };
    // 搜索用：这台 Mac 上全部的 Claude Code 会话（平时的列表只读最近 40 个）；15 秒里最多问一次，读好了重画、告诉别处（Claude App 的边栏、Agent Finder）
    var ccFull = { list: null, at: 0, busy: false };
    function ccFullLoad() {
      if (!window.TSU_LOCAL || !ccOn() || ccFull.busy || Date.now() - ccFull.at < 15000) return;
      ccFull.busy = true;
      TSU_LOCAL.ccSessions(5000).then(function (l) {
        ccFull.list = l || []; ccFull.at = Date.now(); ccFull.busy = false;
        var again = function () { if (treeQ) S.render(); document.dispatchEvent(new Event("tsu-cc")); };
        if (window.TSU_CLAUDE && TSU_CLAUDE.titles) TSU_CLAUDE.titles(ccFull.list, again);
        again();
      }, function () { ccFull.busy = false; ccFull.at = Date.now(); });
    }
    function ccSearchList() { // 最近的那一份（4 秒一读，状态准）+ 全部里其余的
      ccFullLoad();
      var seen = {}, out = cc.list.slice();
      cc.list.forEach(function (x) { seen[x.id] = 1; });
      (ccFull.list || []).forEach(function (x) { if (!seen[x.id]) out.push(x); });
      return out;
    }
    var ccById = function (id) { return cc.list.filter(function (y) { return y.id === id; })[0] || (ccFull.list || []).filter(function (y) { return y.id === id; })[0]; };
    // 一个会话的目录一路往上每一层的折叠键（和目录树里的一样：家目录写成 ~）
    function ccDirKeys(cwd) {
      var home0 = (TSU_LOCAL.info() || {}).home || "", p = String(cwd || "?");
      if (home0 && (p === home0 || p.indexOf(home0 + "/") === 0)) p = "~" + p.slice(home0.length);
      var parts = p.split("/"), at = "", keys = [];
      if (parts[0] === "") parts[0] = "/";
      parts.filter(Boolean).forEach(function (sg) { at = !at ? sg : at === "/" ? "/" + sg : at + "/" + sg; keys.push("cc:" + at); });
      return keys;
    }
    function ccRefresh(force) {
      if (!window.TSU_LOCAL || !ccOn()) { cc.list = []; return Promise.resolve([]); }
      if (cc.busy) return cc.busy;
      // 侧栏收着就不读——但 Claude App 风格的边栏用的就是这一份（那个风格里这棵树整个藏着）：那时照读，不然直接从 Claude App 风格启动时 Claude Code 那一组一直是空的、整组不见
      // 侧栏收着也在后台读（20 秒一次，刚启动时马上读）：打开侧栏、展开哪一组都不用等
      if (!S.shown() && !force && !(window.TSU_BROWSER && TSU_BROWSER.wantsCC()) && !document.documentElement.classList.contains("st-os-claude") && Date.now() - cc.at < 20000) return Promise.resolve(cc.list);
      cc.busy = TSU_LOCAL.ccSessions(40).then(function (l) {
        cc.list = l || []; cc.busy = false; cc.at = Date.now();
        // 标题同 Claude Code 自己的（列表给的常是原样的 <command-name>… 标记）：就地清一遍，读文件补准的回来了再重画
        if (window.TSU_CLAUDE && TSU_CLAUDE.titles) TSU_CLAUDE.titles(cc.list, function () { ccKeep(cc.list); S.render(); document.dispatchEvent(new Event("tsu-cc")); });
        ccKeep(cc.list);
        S.render(); document.dispatchEvent(new Event("tsu-cc")); return cc.list;
      }, function () { cc.busy = false; return cc.list; });
      return cc.busy;
    }
    S.cc = function () { return { list: cc.list, panes: ccPanes() }; }; // claude.code 的主页（browser.js）也用这份
    S.ccSearchList = ccSearchList; // Claude App 的边栏搜的时候用（全部会话）
    S.refreshCC = ccRefresh;
    if (window.TSU_LOCAL) { setTimeout(ccRefresh, 0); setInterval(ccRefresh, 4000); if (TSU_LOCAL.ready) TSU_LOCAL.ready.then(function () { ccRefresh(true); }); } // 原生那边一好就读（不等下一个 4 秒） // 窗口一搭好就去读（以前等 0.8 秒：侧栏里 Claude Code 那一组晚出来一大截）
    var refreshCC = function (f) { return ccRefresh(f); };
    // 哪个面板在跑哪个会话：终端标题（Claude Code 把会话名写进标题：「✳ tmd—01」；在里面切到别的会话标题也跟着变）> 前台进程的 pid（Claude Code 登记了 pid → 会话）> 从侧栏开的
    function isClaude(f, byPid) { return !!(f && f.pid && (byPid[f.pid] || /claude/i.test(f.name || ""))); }
    function ccPanes() {
      var map = {}, byPid = {}, byName = {};
      cc.list.forEach(function (x) {
        if (x.live && x.live.pid) byPid[x.live.pid] = x.id;
        [x.title, x.live && x.live.name].forEach(function (n) { if (n && !byName[n]) byName[n] = x.id; });
      });
      tw.ws.all().forEach(function (p) {
        var sh = p.shell, f = sh && sh.fg;
        if (!isClaude(f, byPid)) { if (p.ccSession && Date.now() - (p.ccAt || 0) > 20000) p.ccSession = null; return; } // 刚从侧栏开的：claude 还没起来，先记着
        var t = sh.oscTitle ? sh.oscTitle().replace(/^[^\p{L}\p{N}]+/u, "").trim() : "";
        var id = byName[t] || byPid[f.pid] || p.ccSession;
        if (id && !map[id]) map[id] = p;
      });
      return map;
    }
    function ccRows(cols, head, line, DIMC) {
      if (!cc.list.length) return "\n" + head(BOLD + "Claude Code" + RESET + DIMC + " · 暂无会话" + RESET) + "\n" + '<span class="ts-act" data-act="cc-new">' + head(DIMC + " + 新建 Claude Code 会话" + RESET) + "</span>\n";
      var here2 = ccPanes(), grp = function (x) { return here2[x.id] ? "f" : x.live ? "b" : "o"; };
      var order = ["f", "b", "o"].reduce(function (acc, g) { return acc.concat(cc.list.filter(function (x) { return grp(x) === g; })); }, []);
      var live = order.filter(function (x) { return grp(x) !== "o"; }).length, cut = cc.all ? order.length : Math.min(order.length, live + Math.max(3, 8 - live));
      var shown = order.slice(0, cut), n = { f: 0, b: 0, o: 0 }, numW = String(shown.length).length + 2, cur = tw.ws.active, home = (TSU_LOCAL.info() || {}).home || "";
      var out = "\n" + '<span class="ts-head">' + head(BOLD + "Claude Code" + RESET + DIMC + " · " + F.plural(order.length, "session") + RESET) + "</span>\n\n";
      shown.forEach(function (x) {
        var g = grp(x), col = GROUP_COLOR[g], num = ++n[g] + ".", busy = x.live && x.live.status === "busy";
        var tag = g === "o" ? "[O]" : (busy ? "[W] " : "[NW]") + " [" + g.toUpperCase() + "]", nameC = here2[x.id] && here2[x.id] === cur ? LAV + BOLD : here2[x.id] ? BOLD : "";
        var l1 = line(" " + col + pad(num, numW) + RESET + nameC + clip(x.title, Math.max(4, cols - 1 - numW - W(tag) - 1)) + RESET, col + tag + RESET);
        var when = g === "o" ? agoCN(x.mtime) : durCN(Date.now() - (x.live && x.live.since || x.mtime));
        var tail = x.missing && !x.job ? "目录不存在：" + (home && x.cwd.indexOf(home) === 0 ? "~" + x.cwd.slice(home.length) : x.cwd) : x.last || "";
        var l2 = line(" ".repeat(numW + 1) + DIMC + clip(tail, Math.max(4, cols - numW - 2 - W(when) - 1)) + RESET, DIMC + when + RESET);
        out += '<span class="ts-it' + (nameC.indexOf(LAV) >= 0 ? " cur" : "") + '" data-cc="' + x.id + '">' + head(l1 + "\n" + l2) + "</span>\n";
      });
      if (cut < order.length || cc.all && order.length > 8) out += '<span class="ts-act" data-act="cc-all">' + head(DIMC + (cc.all ? " 仅显示最近" : " 全部 " + order.length + " 个会话") + RESET) + "</span>\n";
      return out + '<span class="ts-act" data-act="cc-new">' + head(DIMC + " + 新建 Claude Code 会话" + RESET) + "</span>\n";
    }
    // 在新标签页里（从那个目录起）跑一条命令；inPane：就地换掉那个面板（claude.code 主页里点的：这个标签页变成它）
    function ccTab(x, dir, cmd, inPane) {
      // Paimon Terminal：终端只在底下的面板里——在那里开一个终端（从会话的目录起）跑这条命令
      if (root.classList.contains("termapp") && window.STUDIO && STUDIO.newTerm) { STUDIO.newTerm(tw, null, dir, cmd); S.render(); return null; }
      var spec = { sh: { cwd: dir, pty: true } }, p = inPane ? tw.ws.replacePane(inPane, spec) : tw.ws.newTab(spec);
      if (!p) return null;
      p.ccSession = x ? x.id : null;
      p.ccAt = Date.now();
      if (p.shell && p.shell.type) p.shell.type(cmd + "\r");
      S.render();
      return p;
    }
    // Paimon Terminal：点一个 Claude Code 会话 = 在标签页里打开观察它的视图（claude.js：同 Paimon 的对话界面，读它的会话记录）；
    // 已经开着这个视图的标签页就跳过去。在终端里接上（claude attach / --resume）在右键菜单里
    // ---- Claude Code 会话菜单用到的（同 Claude App）：VS Code 装了没有（「打开位置 › VS Code」，Spotlight 按 bundle id 找一次）、分支、删除 ----
    var shq = function (p) { return "'" + String(p).replace(/'/g, "'\\''") + "'"; };
    var CC_VSCODE = "";
    setTimeout(function () { var L0 = window.TSU_LOCAL; if (L0 && L0.exec) L0.exec({ cmd: "mdfind 'kMDItemCFBundleIdentifier == \"com.microsoft.VSCode\"' 2>/dev/null | head -n 1" }).then(function (r) { CC_VSCODE = String((r && r.out) || "").trim().split("\n")[0] || ""; }, function () {}); }, 2500);
    var ccTitleOf = function (x) { var ex = ccExt(); return ex.name["cc:" + x.id] || x.title || String(x.id || "").slice(0, 8); };
    // 分支：一段新的会话，带着到现在为止的全部对话（同 claude --fork-session：把会话记录抄一份、换成新的会话 id，标题后面加「（分支）」），在这里打开它。
    //   原来那段一个字都不动；不起终端、不起后台会话——说第一句时才在后台接着跑
    function ccFork(x) {
      var L0 = window.TSU_LOCAL;
      if (!x || !x.path || !L0 || !L0.exec) return;
      var nid = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2)).toLowerCase(), dir = x.path.replace(/\/[^\/]*$/, ""), np = dir + "/" + nid + ".jsonl";
      var t = ccTitleOf(x) + tt("（分支）", " (fork)"), meta = JSON.stringify({ type: "custom-title", customTitle: t, sessionId: nid }) + "\n" + JSON.stringify({ type: "agent-name", agentName: t, sessionId: nid }) + "\n";
      var cmd = "[ -e " + shq(np) + " ] && exit 3; sed " + shq("s/\"sessionId\":\"" + x.id + "\"/\"sessionId\":\"" + nid + "\"/g") + " " + shq(x.path) + " > " + shq(np) + " && printf '%s' " + shq(meta) + " >> " + shq(np) + " && echo FORK-OK";
      L0.exec({ cmd: cmd }).then(function (r) {
        if (!/FORK-OK/.test(String((r && r.out) || ""))) throw new Error(String((r && (r.err || r.out)) || "").trim().slice(0, 200) || "抄不了会话记录");
        S.refreshCC(true);
        S.viewCC(nid, { id: nid, path: np, cwd: x.cwd, title: t, mtime: Date.now() });
      }).catch(function (e) { if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: tt("分支没建成", "Couldn't fork"), message: String(e && e.message || e), icon: "caution" }); });
    }
    // 删除：先问；会话记录（和它旁边那个放子 agent、工具输出的文件夹）移到废纸篓——能从废纸篓放回来；开着它的标签页关掉，改名、固定、分组、未读都去掉。
    //   正在跑的不让删（菜单里是灰的）
    function ccDelete(x) {
      var L0 = window.TSU_LOCAL;
      if (!x || !x.path || !L0 || !L0.exec || x.live) return;
      var name = ccTitleOf(x), go = function () {
        var side = x.path.replace(/\.jsonl$/, ""), q = [x.path, side].map(shq).join(" ");
        var cmd = "for f in " + q + "; do [ -e \"$f\" ] || continue; if [ -x /usr/bin/trash ]; then /usr/bin/trash \"$f\"; else osascript -e 'on run a' -e 'tell application \"Finder\" to delete (POSIX file (item 1 of a) as alias)' -e 'end run' \"$f\" >/dev/null; fi || exit 1; done; echo TRASH-OK";
        L0.exec({ cmd: cmd }).then(function (r) {
          if (!/TRASH-OK/.test(String((r && r.out) || ""))) throw new Error(String((r && (r.err || r.out)) || "").trim().slice(0, 200) || "没能移到废纸篓");
          var aid = "cc:" + x.id;
          tw.ws.all().filter(function (p) { return p.program && p.program.agentId === aid; }).forEach(function (p) { tw.ws.closePane(p); });
          var ex = ccExt(); ["pin", "arch", "name", "group"].forEach(function (k) { delete ex[k][aid]; }); ccExtSave(ex); ccMarkRead(x.id);
          S.refreshCC(true); S.render(true); document.dispatchEvent(new Event("tsu-cc"));
        }).catch(function (e) { if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: tt("没删掉", "Couldn't delete"), message: String(e && e.message || e), icon: "caution" }); });
      };
      if (!window.TSU_DESK || !TSU_DESK.alert) return;
      TSU_DESK.alert({ title: tt("删除「" + name + "」？", "Delete “" + name + "”?"), message: tt("会话记录会移到废纸篓，需要时可以从废纸篓放回来。", "The transcript moves to the Trash; you can put it back from there."), icon: "caution",
        buttons: [{ label: tt("取消", "Cancel"), role: "cancel" }, { label: tt("删除", "Delete"), role: "default", run: go }] });
    }
    function cxDelete(x) {
      var L0 = window.TSU_LOCAL;
      if (!x || !x.path || !L0 || !L0.exec) return;
      var name = ccExt().name["cx:" + x.id] || x.title || String(x.id || "").slice(0, 8), go = function () {
        var cmd = "f=" + shq(x.path) + "; [ -e \"$f\" ] || exit 0; if [ -x /usr/bin/trash ]; then /usr/bin/trash \"$f\"; elif command -v gio >/dev/null 2>&1; then gio trash \"$f\"; else osascript -e 'on run a' -e 'tell application \"Finder\" to delete (POSIX file (item 1 of a) as alias)' -e 'end run' \"$f\" >/dev/null; fi && echo TRASH-OK";
        L0.exec({ cmd: cmd }).then(function (r) {
          if (!/TRASH-OK/.test(String((r && r.out) || ""))) throw new Error(String((r && (r.err || r.out)) || "").trim().slice(0, 200) || tt("没能移到废纸篓", "Couldn't move it to the Trash"));
          var aid = "cx:" + x.id;
          tw.ws.all().filter(function (p) { return p.program && p.program.agentId === aid; }).forEach(function (p) { tw.ws.closePane(p); });
          var ex = ccExt(); ["pin", "arch", "name", "group"].forEach(function (k) { delete ex[k][aid]; }); ccExtSave(ex); var u = ccUnread(); delete u[aid]; ccUnreadSave(u);
          if (window.TSU_CODEX && TSU_CODEX.refresh) TSU_CODEX.refresh();
          S.render(true); document.dispatchEvent(new Event("tsu-cc"));
        }).catch(function (e) { if (window.TSU_DESK && TSU_DESK.alert) TSU_DESK.alert({ title: tt("没删掉", "Couldn't delete"), message: String(e && e.message || e), icon: "caution" }); });
      };
      if (!window.TSU_DESK || !TSU_DESK.alert) return;
      TSU_DESK.alert({ title: tt("删除「" + name + "」？", "Delete “" + name + "”?"), message: tt("会话记录会移到废纸篓，需要时可以从废纸篓放回来。", "The transcript moves to the Trash; you can put it back from there."), icon: "caution",
        buttons: [{ label: tt("取消", "Cancel"), role: "cancel" }, { label: tt("删除", "Delete"), role: "default", run: go }] });
    }
    S.viewCC = function (id, info) {
      ccMarkRead(id); // 打开了：已读
      if (!window.TSU_CLAUDE) return S.openCC(id);
      var x = info || ccById(id) || {}, aid = TSU_CLAUDE.id(id), hit = null;
      TSU_CLAUDE.ensure(id, x);
      tw.ws.tabs.forEach(function (t, ti) { ws0(t).forEach(function (p) { if (!hit && p.program && p.program.agentId === aid) hit = { ti: ti, p: p }; }); });
      if (hit) { if (tw.ws.cur !== hit.ti) tw.ws.select(hit.ti); tw.ws.activate(hit.p); hit.p.focus(); return hit.p; }
      var p = tw.ws.newTab({ sh: { cwd: x.cwd || "" }, agent: aid });
      S.render();
      return p;
    };
    S.openCC = function (id, inPane, info) {
      var x = info || ccById(id), p0 = ccPanes()[id], home = (TSU_LOCAL.info() || {}).home || "";
      if (p0) { tw.ws.tabs.forEach(function (t, ti) { if (ws0(t).indexOf(p0) >= 0 && tw.ws.cur !== ti) tw.ws.select(ti); }); tw.ws.activate(p0); p0.focus(); return; }
      if (!x) return;
      if (x.job) return ccTab(x, x.missing ? home : x.cwd, "claude attach " + x.job, inPane); // 后台会话：接上去（在跑的、停了的都行），不另起一份
      if (x.missing) return TSU_DESK.alert({ title: "找不到会话目录", message: "Claude Code 按创建会话时的目录查找会话，该目录已不存在：\n" + x.cwd, icon: "caution" });
      if (x.live) return TSU_DESK.alert({ title: "“" + x.title + "”已在其他终端中打开", message: "在此继续会与其他终端同时写入同一会话。可以创建副本（新会话，包含截至目前的对话）。", icon: "caution",
        buttons: [{ label: "取消", role: "cancel" }, { label: "创建副本", role: "default", run: function () { ccTab(x, x.cwd, "claude --resume " + x.id + " --fork-session", inPane); } }] });
      return ccTab(x, x.cwd, "claude --resume " + x.id, inPane);
    };
    S.newCC = function (dir, inPane) { return ccTab(null, dir || (tw.ws.active && tw.ws.active.shell && tw.ws.active.shell.cwd ? tw.ws.active.shell.cwd() : ""), "claude", inPane); };
    // ---- Codex（连接器，codex.js）：点一个会话 = 开一个看它的标签页（用现在的外壳）；已经开着就跳过去（标签页里记着的可能还是 new-…，按真 id 认）----
    S.viewCX = function (id, info) {
      var CX = window.TSU_CODEX;
      if (!CX) return null;
      var u0 = ccUnread(); if (u0["cx:" + id]) { delete u0["cx:" + id]; ccUnreadSave(u0); } // 打开了：已读
      var x = info || CX.get(id) || {}, aid = CX.id(id), hit = null;
      CX.ensure(id, info || (CX.get(id) || undefined));
      tw.ws.tabs.forEach(function (t, ti) { ws0(t).forEach(function (p) { var ag = p.program && p.program.agentId; if (!hit && ag && (ag === aid || /^cx:/.test(ag) && CX.real(ag.slice(3)) === id)) hit = { ti: ti, p: p }; }); });
      if (hit) { if (tw.ws.cur !== hit.ti) tw.ws.select(hit.ti); tw.ws.activate(hit.p); hit.p.focus(); return hit.p; }
      var p = tw.ws.newTab({ sh: { cwd: x.cwd || "" }, agent: aid });
      S.render();
      return p;
    };
    document.addEventListener("tsu-cx", function () { if (S.shown()) S.render(); });

    // 一行近况：去掉换行，同 paimon ls 的尾巴
    function plainTail(r) { var t = r.tail ? r.tail() : ""; return String(t || "").replace(/\s+/g, " ").trim(); }

    // ---- 点：切到这个 agent（这个窗口里已经开着就跳过去，否则当前面板换成它）----
    // ---- 键盘（同 VS Code 资源管理器）：↑↓ 在看得见的每一行里走（展开了的也走进去），→ 展开、← 收起，回车 / 空格打开 ----
    list.tabIndex = 0;
    var kKey = null;
    var rowKey = function (el) { return el.dataset.fold ? "f:" + el.dataset.fold : el.dataset.cc ? "c:" + el.dataset.cc : el.dataset.cx ? "k:" + el.dataset.cx : el.dataset.sess ? "s:" + el.dataset.sess : el.dataset.id ? "a:" + el.dataset.id : el.dataset.act ? "x:" + el.dataset.act : null; };
    var rowsNow = function () { return Array.prototype.filter.call(list.querySelectorAll(".ts-row, .ts-it"), function (r) { return rowKey(r); }); };
    function paintFocus() { rowsNow().forEach(function (r) { r.classList.toggle("kfocus", !!kKey && rowKey(r) === kKey); }); }
    S.paintFocus = paintFocus;
    function toggleRow(r) {
      if (r.dataset.fold) { var k = r.dataset.fold; setFold(k, !folded(k, r.dataset.def === "1")); }
      else if (r.dataset.fold2) { var k2 = r.dataset.fold2; fold[k2] = !folded(k2, true); }
      else return false;
      saveSidePref();
      S.render(true);
      return true;
    }
    function openRow(r) {
      if (r.dataset.fold) return toggleRow(r);
      if (r.dataset.cc) return root.classList.contains("termapp") && window.TSU_CLAUDE ? S.viewCC(r.dataset.cc) : S.openCC(r.dataset.cc);
      if (r.dataset.cx) return S.viewCX(r.dataset.cx);
      if (r.dataset.sess) { var ps = r.dataset.sess.split(":"), rt3 = A.runtime(ps[0]); if (rt3.session().id !== ps[1]) rt3.resume(ps[1]); return S.open(ps[0]); }
      if (r.dataset.id) return S.open(r.dataset.id);
    }
    list.addEventListener("keydown", function (e) {
      if (e.target.classList && e.target.classList.contains("ts-in")) { // 新建 / 重命名的输入框：回车定、Esc 算了，别的键归它自己
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") { e.preventDefault(); commitEdit(true); }
        else if (e.key === "Escape") { e.preventDefault(); commitEdit(false); }
        e.stopPropagation();
        return;
      }
      // 同「文件」视图 / VS Code：F2 重命名、⌘⌫ 删除、⌘X / ⌘C / ⌘V 剪切 / 拷贝 / 粘贴、⌥⌘C 拷贝路径、⌃↩ 在侧边打开
      var k0 = kKey || "", ka = /^a:(.+)$/.exec(k0);
      if (e.key === "F2") { e.preventDefault(); return startRename(k0); }
      if (e.metaKey && (e.key === "Backspace" || e.key === "Delete")) { e.preventDefault(); return delRow(k0); }
      if (e.metaKey && e.altKey && e.code === "KeyC") { e.preventDefault(); return copyText(addrOf(keyAt(k0))); }
      if (e.metaKey && !e.altKey && !e.shiftKey && (e.code === "KeyX" || e.code === "KeyC")) { e.preventDefault(); return clipRow(k0, e.code === "KeyX"); }
      if (e.metaKey && !e.altKey && !e.shiftKey && e.code === "KeyV") { e.preventDefault(); return paste(); }
      if (e.ctrlKey && e.key === "Enter" && ka) { e.preventDefault(); return S.openSide(ka[1]); }
      var tq0 = side.querySelector(".ts-q");
      if (tq0 && e.metaKey && !e.altKey && !e.shiftKey && e.code === "KeyF") { e.preventDefault(); e.stopPropagation(); tq0.focus(); tq0.select(); return; } // ⌘F：到搜索框
      if (tq0 && e.key === "Escape" && treeQ) { e.preventDefault(); return setTreeQ(""); }
      if (tq0 && e.key.length === 1 && e.key !== " " && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing) { e.preventDefault(); setTreeQ(tq0.value + e.key); tq0.focus(); tq0.setSelectionRange(tq0.value.length, tq0.value.length); return; } // 在树上打字：接着写进搜索框（同 VS Code 的「键入时筛选」）
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var rs = rowsNow(), i = rs.findIndex(function (r) { return rowKey(r) === kKey; }), cur = rs[i];
      if (!rs.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        i = i < 0 ? 0 : Math.max(0, Math.min(rs.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
        kKey = rowKey(rs[i]);
        paintFocus();
        rs[i].scrollIntoView({ block: "nearest" });
      } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && cur) {
        e.preventDefault();
        var shut = !!cur.querySelector(".ts-chev.r"), open = !!cur.querySelector(".ts-chev.d");
        if (e.key === "ArrowRight" && shut || e.key === "ArrowLeft" && open) toggleRow(cur);
        else if (e.key === "ArrowRight" && open && rs[i + 1]) { kKey = rowKey(rs[i + 1]); paintFocus(); }
      } else if ((e.key === "Enter" || e.key === " ") && cur) { e.preventDefault(); openRow(cur); }
    });
    list.addEventListener("mousedown", function (e) { var r = e.target.closest(".ts-row, .ts-it"); if (r && rowKey(r)) { kKey = rowKey(r); paintFocus(); } });
    // ---- 搜索框（标题下面）：打字就筛（输入法拼字时先不筛）；Esc 清掉（空的时候回到树里）；↓ 到树里第一个搜到的；回车打开它 ----
    function setTreeQ(v) {
      var fd = side.querySelector(".ts-find"), tq = fd && fd.querySelector(".ts-q");
      v = String(v || "");
      if (tq && tq.value !== v) tq.value = v;
      if (fd) fd.classList.toggle("has", !!v);
      var nq = v.trim() ? v : "";
      if (nq === treeQ) return;
      treeQ = nq; qfold = {}; kKey = null;
      S.render(true);
    }
    S.search = setTreeQ;
    (function () {
      var fd = side.querySelector(".ts-find"), tq = fd && fd.querySelector(".ts-q");
      if (!tq) return;
      tq.addEventListener("input", function (e) { if (!e.isComposing) setTreeQ(tq.value); });
      tq.addEventListener("compositionend", function () { setTreeQ(tq.value); });
      tq.addEventListener("keydown", function (e) {
        if (e.isComposing || e.keyCode === 229) return;
        var first = function () { return list.querySelector(".ts-it") || rowsNow()[0]; };
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (tq.value) setTreeQ(""); else list.focus({ preventScroll: true }); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); var r0 = first(); if (r0) { kKey = rowKey(r0); paintFocus(); } list.focus({ preventScroll: true }); return; }
        if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); var r1 = list.querySelector(".ts-it"); if (r1) { kKey = rowKey(r1); paintFocus(); openRow(r1); } }
      });
      fd.querySelector(".ts-qx").addEventListener("click", function () { setTreeQ(""); tq.focus(); });
    })();
    // 输入框：打字记下来（有报错就先收起）；点了别处 = 定下来（不对就算了）
    list.addEventListener("input", function (e) { if (!e.target.classList.contains("ts-in") || !edit) return; edit.value = e.target.value; if (edit.err) { edit.err = ""; var er = list.querySelector(".ts-err"); if (er) er.remove(); } });
    list.addEventListener("focusout", function (e) { if (e.target.classList && e.target.classList.contains("ts-in") && edit) setTimeout(function () { var tin = list.querySelector(".ts-in"); if (edit && (!tin || document.activeElement !== tin)) commitEdit(true, true); }, 0); });

    // 按住 agent / 会话拖到编辑区：放中间是在那个面板里看，放边上是分屏（同 VS Code 把文件拖进编辑区）
    draggable(list, function (e) {
      if (e.target.closest(".ts-in, .ts-edit")) return null;
      var fr = e.target.closest(".ts-row[data-vdir]"); // 文件夹：拖到别的文件夹 / 卷上是挪过去（同一个卷里）
      if (fr && fr.dataset.vdir && !e.target.closest(".ts-act")) return { kind: "vfolder", vol: fr.dataset.vol, dir: fr.dataset.vdir, name: "▸ " + fr.dataset.vdir.split("/").pop(), tree: S };
      var it = e.target.closest(".ts-it");
      if (!it || e.target.closest(".ts-act")) return null;
      if (it.dataset.id && A.get(it.dataset.id) && !it.dataset.sess) return { kind: "agent", id: it.dataset.id, name: "✦ " + A.get(it.dataset.id).name, tree: S }; // agent：拖进编辑区是打开，拖到文件夹上是挪过去
      if (it.dataset.cc) { var x = ccById(it.dataset.cc); return x ? { kind: "cc", id: x.id, info: x, name: x.title } : null; }
      if (it.dataset.cx) { var xx = window.TSU_CODEX && TSU_CODEX.get(it.dataset.cx); if (xx) TSU_CODEX.ensure(xx.id, xx); return xx ? { kind: "agent", id: "cx:" + xx.id, name: "◎ " + xx.title } : null; } // Codex：当成一个 agent 拖（cx:<会话>）
      var id = it.dataset.id || (it.dataset.sess || "").split(":")[0], a = id && A.get(id);
      if (it.dataset.sess && a) { var ps = it.dataset.sess.split(":"), rt3 = A.runtime(ps[0]); return { kind: "agent", id: a.id, name: a.name, sess: ps[1], rt: rt3 }; }
      return a ? { kind: "agent", id: a.id, name: "✦ " + a.name } : null;
    }, function (item) { if (item.sess && item.rt && item.rt.session().id !== item.sess) item.rt.resume(item.sess); return item.name; });
    var canNewIn0 = function (id) { return !!(window.TSU_CONNECTORS && TSU_CONNECTORS.canNew && TSU_CONNECTORS.canNew(id)); };
    list.addEventListener("click", function (e) {
      if (e.target.closest(".ts-in, .ts-edit, .ts-err")) return; // 输入框那一行
      var fo = e.target.closest("[data-fold]"), it0 = e.target.closest(".ts-it"), act0 = e.target.closest(".ts-act");
      if (fo && !act0) { setFold(fo.dataset.fold, !folded(fo.dataset.fold, fo.dataset.def === "1")); return S.render(true); }
      // agent 行前面的 ▾ / ▸：展开它的会话（点名字是打开）
      if (it0 && it0.dataset.fold2 && e.offsetX < chPx * 5) { var k2 = it0.dataset.fold2; fold[k2] = !folded(k2, true); saveSidePref(); return S.render(true); }
      if (it0 && it0.dataset.sess) { var ps = it0.dataset.sess.split(":"), rt3 = A.runtime(ps[0]); if (rt3.session().id !== ps[1]) rt3.resume(ps[1]); return S.open(ps[0]); }
      if (act0 && act0.dataset.act === "cc-refresh") { refreshCC(true); return; }
      if (act0 && act0.dataset.act === "fold-cx" && treeQ) return collapseAll("cx");
      if (act0 && act0.dataset.act === "fold-cx") { var ox = fold["only:cx"] ? "o" : ""; Object.keys(fold).forEach(function (k) { if (/^o?cx:/.test(k) && k !== "cx:all") fold[k] = true; }); if (window.TSU_CODEX) TSU_CODEX.list().forEach(function (x) { ccDirKeys(x.cwd).forEach(function (k) { fold[ox + "cx:" + k.slice(3)] = true; }); }); saveSidePref(); return S.render(true); }
      if (act0 && act0.dataset.act === "new-pm-agent") { if (!caNew()) startEdit("agent"); return; }
      if (act0 && act0.dataset.act === "new-pm-folder") { startEdit("folder"); return; }
      if (act0 && act0.dataset.act === "new-cc-sess") { if (!(canNewIn0("claude-code") && TSU_CONNECTORS.newSession("claude-code", ""))) S.newCC(); return; }
      if (act0 && act0.dataset.act === "new-cx-sess") { if (canNewIn0("codex")) TSU_CONNECTORS.newSession("codex", ""); return; }
      if (act0 && /^only-(pm|cc|cx)$/.test(act0.dataset.act)) { var ok0 = "only:" + act0.dataset.act.slice(5); fold[ok0] = !fold[ok0]; saveSidePref(); return S.render(true); }
      if (act0 && (act0.dataset.act === "fold-pm" || act0.dataset.act === "fold-cc")) return collapseAll(act0.dataset.act.slice(5));
      var it = e.target.closest(".ts-it"), act = e.target.closest(".ts-act");
      if (it && it.dataset.cc) return root.classList.contains("termapp") && window.TSU_CLAUDE ? S.viewCC(it.dataset.cc) : S.openCC(it.dataset.cc);
      if (it && it.dataset.cx) return S.viewCX(it.dataset.cx);
      if (it) return S.open(it.dataset.id);
      if (!act) return;
      if (act.dataset.act === "cc-new") return S.newCC();
      if (act.dataset.act === "cc-all") { cc.all = !cc.all; return S.render(true); }
      if (act.dataset.act === "cx-all") { fold["cx:all"] = !fold["cx:all"]; saveSidePref(); return S.render(true); }
      if (act.dataset.act === "archived") { archived = true; S.render(true); }
      else if (act.dataset.act === "back") { archived = false; S.render(true); }
      else if (act.dataset.act === "new") { if (caNew()) return; var cur = tw.ws.active && tw.ws.active.program && tw.ws.active.program.agentId, ag = A.create({ model: cur && A.get(cur) ? A.get(cur).model : undefined }); archived = false; S.open(ag.id); }
    });
    S.open = function (id, where) {
      S.dismiss();
      var a = A.get(id);
      if (!a) return;
      if (a.archived) A.unarchive(id);
      if (where === "tab") { if (focusAgent(id)) return; var p0 = tw.ws.newTab(); p0.run(makeView(p0, id)); return; } // 已经开着：跳过去，不再开一个
      if (where === "window") { var w2 = openWindow(); if (w2.ws.active) w2.ws.active.run(makeView(w2.ws.active, id)); return; }
      var hit = null;
      tw.ws.tabs.forEach(function (t, ti) { ws0(t).forEach(function (p) { if (!hit && p.program && p.program.agentId === id) hit = { ti: ti, p: p }; }); });
      if (hit) { if (tw.ws.cur !== hit.ti) tw.ws.select(hit.ti); tw.ws.activate(hit.p); hit.p.focus(); S.render(); return; }
      var p = tw.ws.active || tw.ws.newTab();
      p.run(makeView(p, id));
      S.render();
    };
    var ws0 = function (t) { return tw.ws.leaves(t.root).map(function (l) { return l.pane; }); };
    // 右键：在新标签页 / 新窗口打开、重命名、归档（同 ctrl+x 两次：不删，随时能恢复）
    list.addEventListener("contextmenu", function (e) {
      if (e.target.closest(".ts-in")) return; // 输入框里：系统的（拷贝、粘贴）
      var TI = function (label, run, icon, keys, dis) { return { label: label, keys: keys || "", run: run, icon: icon, disabled: !!dis }; };
      var MIc = window.STUDIO && STUDIO.menuIcons ? STUDIO.menuIcons() : {}, at0 = { x: e.clientX, y: e.clientY };
      var pop = function (items) { items = items.filter(Boolean); if (window.STUDIO && STUDIO.menu) STUDIO.menu(items, at0); else if (window.TSU_DESK && TSU_DESK.popup) TSU_DESK.popup(items, at0); };
      // 卷 / 文件夹（同 VS Code 资源管理器里文件夹的右键）
      var vr = e.target.closest(".ts-row[data-vol]");
      if (vr) {
        e.preventDefault();
        kKey = rowKey(vr); paintFocus();
        var x0 = keyAt(kKey), here0 = !A.volHere || A.volHere(x0.vol), at1 = { vol: x0.vol, path: x0.dir }, isDir = !!x0.dir;
        return pop([
          TI(tt("新建 Agent…", "New Agent…"), function () { startEdit("agent", at1); }, TREE_IC.newAgent, "", !here0),
          TI(tt("新建文件夹…", "New Folder…"), function () { startEdit("folder", at1); }, TREE_IC.newFolder, "", !here0),
          { sep: true },
          TI(tt("在 Agent Finder 中显示", "Reveal in Agent Finder"), function () { inFinder(x0); }, TREE_IC.folder),
          { sep: true },
          isDir ? TI(tt("剪切", "Cut"), function () { clipRow(kKey, true); }, TREE_IC.cut, "⌘X") : null,
          TI(tt("粘贴", "Paste"), function () { paste(at1); }, TREE_IC.paste, "⌘V", !canPaste(at1)),
          { sep: true },
          TI(tt("复制路径", "Copy Path"), function () { copyText(addrOf(x0)); }, TREE_IC.copy, "⌥⌘C"),
          isDir ? { sep: true } : null,
          isDir ? TI(tt("重命名…", "Rename…"), function () { startRename("f:" + dirKey(x0.vol, x0.dir)); }, MIc.rename, "F2") : null,
          isDir ? TI(tt("删除", "Delete"), function () { delRow("f:" + dirKey(x0.vol, x0.dir)); }, TREE_IC.trash, "⌘⌫") : null,
        ]);
      }
      // Claude Code 的目录：新建会话只在连接器给了入口时有（连接器自己的事）；拷贝路径
      var cf = e.target.closest(".ts-row[data-fold]");
      if (cf && /^(q:)?o?cc:/.test(cf.dataset.fold)) {
        e.preventDefault();
        var tp = cf.dataset.fold.replace(/^(q:)?o?cc:/, ""), hm = (window.TSU_LOCAL && TSU_LOCAL.info() || {}).home || "", abs = tp === "~" ? hm : tp.indexOf("~/") === 0 ? hm + tp.slice(1) : tp, CN = window.TSU_CONNECTORS;
        return pop([
          CN && CN.newSession ? TI(tt("新建会话", "New Session"), function () { CN.newSession("claude", abs); }, MIc.term) : null,
          CN && CN.newSession ? { sep: true } : null,
          TI(tt("复制路径", "Copy Path"), function () { copyText(abs); }, TREE_IC.copy),
        ]);
      }
      var it = e.target.closest(".ts-it");
      if (!it || !window.TSU_DESK || !TSU_DESK.popup) return;
      if (it.dataset.cc) {
        e.preventDefault();
        var cid = it.dataset.cc, x0 = ccById(cid) || {}, LC = window.TSU_LOCAL, kk = "cc:" + cid, exN = ccExt(), MIc0 = window.STUDIO && STUDIO.menuIcons ? STUDIO.menuIcons() : {};
        var setExt = function (f) { var ex = ccExt(); f(ex); ccExtSave(ex); S.render(true); document.dispatchEvent(new Event("tsu-cc")); };
        var isUn = !!ccUnread()[kk], curG = exN.group[kk] || "", canFs = !!(x0.path && LC && LC.exec);
        // 同 Claude App 的会话菜单（用户指定的就这几项）：打开位置 ›、固定、标为未读、重命名、分支、移到分组 ›、归档、删除；右边一列是菜单开着时按的字母
        TSU_DESK.popup([
          { label: tt("打开位置", "Open in"), icon: MIc0.open, items: function () { return [
            { label: tt("拆分视图", "Split View"), icon: MIc0.splitR, run: function () { if (tw.ws.active && tw.ws.drop) tw.ws.drop({ kind: "cc", id: cid, info: x0 }, tw.ws.active, "right"); else S.viewCC(cid); } },
            { label: tt("终端", "Terminal"), icon: MIc0.term, run: function () { S.openCC(cid); } },
            x0.cwd && LC && LC.exec ? { sep: true } : null,
            x0.cwd && LC && LC.exec && CC_VSCODE ? { label: "Visual Studio Code", icon: MIc0.json, run: function () { LC.exec({ cmd: "open -a " + shq(CC_VSCODE) + " " + shq(x0.cwd) }).catch(function () {}); } } : null,
            x0.cwd && LC && LC.exec ? { label: tt("访达", "Finder"), icon: MIc0.window, run: function () { LC.exec({ cmd: "open " + shq(x0.cwd) }).catch(function () {}); } } : null,
          ].filter(Boolean); } },
          { sep: true },
          { label: exN.pin[kk] ? tt("取消固定", "Unpin") : tt("固定", "Pin"), acc: "P", run: function () { setExt(function (ex) { if (ex.pin[kk]) delete ex.pin[kk]; else { ex.pin[kk] = Date.now(); delete ex.arch[kk]; } }); } },
          { label: isUn ? tt("标为已读", "Mark as Read") : tt("标为未读", "Mark as Unread"), acc: "U", run: function () { var u = ccUnread(); if (u[kk]) delete u[kk]; else u[kk] = 1; ccUnreadSave(u); S.render(true); document.dispatchEvent(new Event("tsu-cc")); } },
          { label: tt("重命名…", "Rename…"), acc: "R", icon: MIc0.rename, run: function () {
            if (!window.STUDIO || !STUDIO.ask) return;
            STUDIO.ask({ title: tt("重命名", "Rename"), value: exN.name[kk] || x0.title || "" }).then(function (v) { if (v == null || v === true) return; v = String(v).trim().slice(0, 80); setExt(function (ex) { if (v) ex.name[kk] = v; else delete ex.name[kk]; }); });
          } },
          canFs ? { label: tt("分支", "Fork"), acc: "F", run: function () { ccFork(x0); } } : null,
          { sep: true },
          { label: tt("移到分组", "Move to Group"), items: function () {
            return ccGroupNames().map(function (g) { return { label: g, radio: true, checked: g === curG, close: true, run: function () { setExt(function (ex) { ex.group[kk] = g; delete ex.pin[kk]; delete ex.arch[kk]; }); } }; }).concat([
              ccGroupNames().length ? { sep: true } : null,
              { label: tt("新建分组…", "New Group…"), run: function () {
                if (!window.STUDIO || !STUDIO.ask) return;
                STUDIO.ask({ title: tt("新建分组", "New Group"), value: "" }).then(function (v) { if (v == null || v === true) return; v = String(v).trim().slice(0, 40); if (v) setExt(function (ex) { ex.group[kk] = v; delete ex.pin[kk]; delete ex.arch[kk]; }); });
              } },
              curG ? { label: tt("移出分组", "Remove from Group"), run: function () { setExt(function (ex) { delete ex.group[kk]; }); } } : null,
            ]).filter(Boolean);
          } },
          { sep: true },
          { label: exN.arch[kk] ? tt("取消归档", "Unarchive") : tt("归档", "Archive"), acc: "A", icon: MIc0.archive, run: function () { setExt(function (ex) { if (ex.arch[kk]) delete ex.arch[kk]; else { ex.arch[kk] = Date.now(); delete ex.pin[kk]; } }); } },
          canFs ? { label: tt("删除", "Delete"), acc: "D", danger: true, disabled: !!x0.live, run: function () { ccDelete(x0); } } : null,
        ], { x: e.clientX, y: e.clientY });
        return;
      }
      if (it.dataset.cx) {
        e.preventDefault();
        var xid = it.dataset.cx, xi = (window.TSU_CODEX && TSU_CODEX.get(xid)) || {}, kx0 = "cx:" + xid, exX = ccExt(), LCx = window.TSU_LOCAL, MIx = window.STUDIO && STUDIO.menuIcons ? STUDIO.menuIcons() : {};
        var setExtX = function (f) { var ex = ccExt(); f(ex); ccExtSave(ex); S.render(true); document.dispatchEvent(new Event("tsu-cc")); };
        var isUnX = !!ccUnread()[kx0], curGX = exX.group[kx0] || "", canFsX = !!(xi.path && LCx && LCx.exec);
        TSU_DESK.popup([
          { label: tt("打开位置", "Open in"), icon: MIx.open, items: function () { return [
            { label: tt("拆分视图", "Split View"), icon: MIx.splitR, run: function () { if (tw.ws.active && tw.ws.drop && window.TSU_CODEX && xi.id) { TSU_CODEX.ensure(xi.id, xi); tw.ws.drop({ kind: "agent", id: "cx:" + xi.id }, tw.ws.active, "right"); } else S.viewCX(xid); } },
            xi.cwd && window.STUDIO && STUDIO.newTerm ? { label: tt("终端", "Terminal"), icon: MIx.term, run: function () { STUDIO.newTerm(tw, null, xi.cwd, "codex resume " + xid); } } : null,
            xi.cwd && LCx && LCx.exec ? { sep: true } : null,
            xi.cwd && LCx && LCx.exec && CC_VSCODE ? { label: "Visual Studio Code", icon: MIx.json, run: function () { LCx.exec({ cmd: "open -a " + shq(CC_VSCODE) + " " + shq(xi.cwd) }).catch(function () {}); } } : null,
            xi.cwd && LCx && LCx.exec ? { label: tt("访达", "Finder"), icon: MIx.window, run: function () { LCx.exec({ cmd: "open " + shq(xi.cwd) }).catch(function () {}); } } : null,
          ].filter(Boolean); } },
          { sep: true },
          { label: exX.pin[kx0] ? tt("取消固定", "Unpin") : tt("固定", "Pin"), acc: "P", run: function () { setExtX(function (ex) { if (ex.pin[kx0]) delete ex.pin[kx0]; else { ex.pin[kx0] = Date.now(); delete ex.arch[kx0]; } }); } },
          { label: isUnX ? tt("标为已读", "Mark as Read") : tt("标为未读", "Mark as Unread"), acc: "U", run: function () { var u = ccUnread(); if (u[kx0]) delete u[kx0]; else u[kx0] = 1; ccUnreadSave(u); S.render(true); document.dispatchEvent(new Event("tsu-cc")); } },
          { label: tt("重命名…", "Rename…"), acc: "R", icon: MIx.rename, run: function () {
            if (!window.STUDIO || !STUDIO.ask) return;
            STUDIO.ask({ title: tt("重命名", "Rename"), value: exX.name[kx0] || xi.title || "" }).then(function (v) { if (v == null || v === true) return; v = String(v).trim().slice(0, 80); setExtX(function (ex) { if (v) ex.name[kx0] = v; else delete ex.name[kx0]; }); });
          } },
          { sep: true },
          { label: tt("移到分组", "Move to Group"), items: function () {
            return ccGroupNames().map(function (g) { return { label: g, radio: true, checked: g === curGX, close: true, run: function () { setExtX(function (ex) { ex.group[kx0] = g; delete ex.pin[kx0]; delete ex.arch[kx0]; }); } }; }).concat([
              ccGroupNames().length ? { sep: true } : null,
              { label: tt("新建分组…", "New Group…"), run: function () {
                if (!window.STUDIO || !STUDIO.ask) return;
                STUDIO.ask({ title: tt("新建分组", "New Group"), value: "" }).then(function (v) { if (v == null || v === true) return; v = String(v).trim().slice(0, 40); if (v) setExtX(function (ex) { ex.group[kx0] = v; delete ex.pin[kx0]; delete ex.arch[kx0]; }); });
              } },
              curGX ? { label: tt("移出分组", "Remove from Group"), run: function () { setExtX(function (ex) { delete ex.group[kx0]; }); } } : null,
            ]).filter(Boolean);
          } },
          { sep: true },
          { label: exX.arch[kx0] ? tt("取消归档", "Unarchive") : tt("归档", "Archive"), acc: "A", icon: MIx.archive, disabled: !!xi.archived && !exX.arch[kx0], run: function () { setExtX(function (ex) { if (ex.arch[kx0]) delete ex.arch[kx0]; else { ex.arch[kx0] = Date.now(); delete ex.pin[kx0]; } }); } },
          canFsX ? { label: tt("删除", "Delete"), acc: "D", danger: true, disabled: !!(xi.live && xi.live.status === "busy"), run: function () { cxDelete(xi); } } : null,
        ], { x: e.clientX, y: e.clientY });
        return;
      }
      e.preventDefault();
      var id = it.dataset.id, a = A.get(id);
      if (!a) return;
      var MI = window.STUDIO && STUDIO.menuIcons ? STUDIO.menuIcons() : {};
      var mi = function (label, run, ic) { return { label: label, keys: "", run: run, icon: MI[ic] }; };
      var ss0 = A.allSessions().filter(function (x) { return x.agentId === id && x.turns && x.turns.length; }).sort(function (x, y) { return (y.updated || 0) - (x.updated || 0); }), rt4 = A.runtime(id);
      // 同 VS Code 资源管理器里文件的右键：打开几种、在 Agent Finder 中显示、剪切 / 拷贝（= 分支）/ 粘贴、复制路径、重命名（树里就地改，F2）、归档、删除（先问）
      kKey = "a:" + id; paintFocus();
      var atA = { vol: A.volOf(id), path: a.path || "" };
      pop([
        mi("打开", function () { S.open(id); }, "open"),
        mi("在新标签页中打开", function () { S.open(id, "tab"); }, "tab"),
        TI(tt("在侧边打开", "Open to the Side"), function () { S.openSide(id); }, MI.splitR, "⌃↩"),
        mi("在新窗口中打开", function () { S.open(id, "window"); }, "window"),
        ss0.length > 1 && window.STUDIO ? { label: "会话", icon: MI.history, items: ss0.slice(0, 12).map(function (x) { return { label: x.title || "（未命名）", keys: agoCN(x.updated), checked: rt4.session().id === x.id, close: true, run: function () { if (rt4.session().id !== x.id) rt4.resume(x.id); S.open(id); } }; }) } : null,
        { sep: true },
        TI(tt("在 Agent Finder 中显示", "Reveal in Agent Finder"), function () { inFinder({ id: id }); }, TREE_IC.folder),
        { sep: true },
        TI(tt("剪切", "Cut"), function () { clipRow("a:" + id, true); }, TREE_IC.cut, "⌘X"),
        TI(tt("拷贝", "Copy"), function () { clipRow("a:" + id, false); }, TREE_IC.copy, "⌘C"),
        TI(tt("粘贴", "Paste"), function () { paste(atA); }, TREE_IC.paste, "⌘V", !canPaste(atA)),
        { sep: true },
        TI(tt("复制路径", "Copy Path"), function () { copyText(addrOf({ id: id })); }, TREE_IC.copy, "⌥⌘C"),
        { sep: true },
        TI(tt("重命名…", "Rename…"), function () { startRename("a:" + id); }, MI.rename, "F2"),
        a.archived ? mi("恢复", function () { A.unarchive(id); S.render(true); }, "archive") : mi("归档", function () { A.archive(id); S.render(true); }, "archive"),
        TI(tt("删除…", "Delete…"), function () { delRow("a:" + id); }, TREE_IC.trash, "⌘⌫"),
      ]);
    });
    // ---- 什么时候重画：agent 列表变了、这个窗口换了面板、有 agent 在跑（每秒，跑的时长在走）----
    A.on(function (type) { if (type === "agents" || type === "me") S.render(); });
    setInterval(function () { if (S.shown() && tw.open && !document.hidden && A.list().some(function (a) { var r3 = A.runtime(a.id); return r3.stream || r3.tasks.some(function (x) { return x.status === "running"; }); })) S.render(); }, 1000);
    new ResizeObserver(function () { if (!narrow()) force = false; apply(); if (S.shown()) S.render(); }).observe(lab);
  }
  function Workspace(tw) {
    var ws = this;
    ws.tabs = [];
    ws.cur = 0;
    ws.active = null;
    ws.tab = function () { return ws.tabs[ws.cur]; };
    ws.leaves = function (node, o) { o = o || []; if (!node) return o; if (node.pane) o.push(node); else { ws.leaves(node.a, o); ws.leaves(node.b, o); } return o; };
    ws.all = function () { var o = []; ws.tabs.forEach(function (t) { ws.leaves(t.root, o); }); return o.map(function (l) { return l.pane; }); };
    ws.layout = function () {
      tw.panesEl.textContent = "";
      if (!ws.tab()) return;
      tw.panesEl.appendChild(build(ws.tab().root));
      ws.all().forEach(function (p) { p.el.classList.toggle("active", p === ws.active); p.el.classList.toggle("solo", ws.leaves(ws.tab().root).length === 1); });
      ws.leaves(ws.tab().root).forEach(function (l) { l.pane.renderNow(); });
      ws.syncTitles();
      persistAll();
    };
    ws.activate = function (pane) {
      if (ws.active === pane) return;
      ws.active = pane;
      pane.bell = false;
      ws.tabs.forEach(function (t, i) { if (ws.leaves(t.root).some(function (l) { return l.pane === pane; })) { t.active = pane; ws.cur = i; } });
      ws.all().forEach(function (p) { p.el.classList.toggle("active", p === pane); });
      ws.syncTitles();
      persistAll();
    };
    ws.newPane = function (spec) { return Pane(tw, spec || { sh: { cwd: ws.active && ws.active.shell ? ws.active.shell.cwd() : "/home/user" } }); };
    ws.split = function (dir) {
      if (!ws.active) return;
      var leaf = find(ws.tab().root, ws.active), fresh = ws.newPane();
      var node = { dir: dir, a: { pane: leaf.pane }, b: { pane: fresh }, ratio: 0.5 };
      delete leaf.pane;
      Object.assign(leaf, node);
      ws.active = fresh;
      ws.tab().active = fresh;
      ws.layout();
      fresh.focus();
    };
    // 关一个面板：父节点换成兄弟；标签页空了就关标签页；窗口空了就关窗口
    ws.closePane = function (pane) {
      var ti = ws.tabs.findIndex(function (t) { return !!find(t.root, pane); });
      if (ti < 0) return;
      var t = ws.tabs[ti], leaf = find(t.root, pane), parent = parentOf(t.root, leaf);
      pane.close();
      if (!parent) return ws.closeTab(ti, true);
      var sibling = parent.a === leaf ? parent.b : parent.a;
      Object.keys(parent).forEach(function (k) { delete parent[k]; });
      Object.assign(parent, sibling);
      var next = ws.leaves(parent)[0].pane;
      ws.active = next;
      t.active = next;
      ws.layout();
      next.focus();
    };
    ws.close = function () { if (ws.active) ws.closePane(ws.active); };
    // 就地换一个面板（Paimon Terminal 的页面里点了一个会话：这个标签页变成它，shell 从会话的目录起）
    ws.replacePane = function (old, spec) {
      var ti = ws.tabs.findIndex(function (t) { return !!find(t.root, old); });
      if (ti < 0) return null;
      var t = ws.tabs[ti], leaf = find(t.root, old), p = ws.newPane(spec);
      old.close();
      leaf.pane = p;
      if (t.active === old) t.active = p;
      if (ws.active === old) ws.active = p;
      ws.layout();
      p.focus();
      return p;
    };
    ws.newTab = function (spec) {
      var p = ws.newPane(spec);
      ws.tabs.push({ root: { pane: p }, active: p });
      ws.select(ws.tabs.length - 1);
      return p;
    };
    ws.closeTab = function (i, already) {
      if (!ws.tabs[i]) return;
      if (!already) ws.leaves(ws.tabs[i].root).forEach(function (l) { l.pane.close(); });
      ws.tabs.splice(i, 1);
      if (!ws.tabs.length && document.documentElement.classList.contains("termapp")) { setTimeout(function () { ws.newTab(); }, 0); return; } // Paimon Terminal：窗口就是终端，最后一个标签页关了就开一个新的
      if (!ws.tabs.length) { tw.open = false; if (window.TSU_DESK && tw.dw) { TSU_DESK.onBeforeClose(tw.id, null); tw.dw.hide("closed"); setTimeout(function () { installCloseHook(tw); }, 0); } persistAll(); return; }
      ws.select(Math.min(i, ws.tabs.length - 1));
    };
    ws.select = function (i) {
      if (!ws.tabs[i]) return;
      ws.cur = i;
      ws.active = ws.tab().active || ws.leaves(ws.tab().root)[0].pane;
      ws.active.bell = false;
      ws.layout();
      ws.active.focus();
    };
    ws.move = function (dx, dy) {
      if (!ws.active) return;
      var r0 = ws.active.el.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2, best = null, bestD = Infinity;
      ws.leaves(ws.tab().root).forEach(function (l) {
        if (l.pane === ws.active) return;
        var r = l.pane.el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        if ((dx && Math.sign(x - cx) !== dx) || (dy && Math.sign(y - cy) !== dy)) return;
        var d = Math.abs(x - cx) * (dx ? 1 : 3) + Math.abs(y - cy) * (dy ? 1 : 3);
        if (d < bestD) { bestD = d; best = l.pane; }
      });
      if (best) { ws.activate(best); best.focus(); }
    };
    // 标题栏：当前面板里在跑的东西（shell：user@code: ~；agent：它的名字）；标签页栏：多于一个才出现
    ws.syncTitles = function () {
      var t = ws.active ? ws.active.title() : "终端";
      if (tw.titleEl) tw.titleEl.textContent = t;
      if (window.TSU_DESK && TSU_DESK.front() && TSU_DESK.front().el === tw.el) TSU_DESK.refreshMenus();
      var termapp = document.documentElement.classList.contains("termapp");
      tw.tabsEl.hidden = !termapp && ws.tabs.length < 2 && !tw.showTabs; // Paimon Terminal：同浏览器，一个标签页也显示标签页栏
      tw.tabsEl.textContent = "";
      ws.tabs.forEach(function (tb, i) {
        var b = document.createElement("div");
        b.className = "tab" + (i === ws.cur ? " on" : "");
        b.innerHTML = '<i class="tx" title="关闭标签页">×</i><span></span><kbd>' + (window.nadosNative ? "⌘" : "⌥⌘") + (i + 1) + "</kbd>";
        var p = tb.active || ws.leaves(tb.root)[0].pane, rang = ws.leaves(tb.root).some(function (l) { return l.pane.bell; });
        b.querySelector("span").textContent = (rang ? "🔔 " : "") + p.title();
        if (window.TSU_BROWSER) TSU_BROWSER.fav(b, p);
        b.addEventListener("mousedown", function (e) {
          e.preventDefault();
          if (!e.target.closest(".tx")) return ws.select(i); // 只有 × 是关；标签上的图标也是 <i>，点它是切过去
          var panes = ws.leaves(tb.root).map(function (l) { return l.pane; });
          askClose(panes, "标签页", function () { var j = ws.tabs.indexOf(tb); if (j >= 0) ws.closeTab(j); });
        });
        draggable(b, function (e) { return e.target.closest(".tx") ? null : { kind: "tab", index: i, ws: ws }; }, "↳ " + b.querySelector("span").textContent);
        tw.tabsEl.appendChild(b);
      });
      if (window.TSU_BROWSER) TSU_BROWSER.sync(tw);
      if (termapp) { // 标签条右端（同 VS Code 编辑区右上）：新终端 · 分屏 · ···
        var acts = document.createElement("div");
        acts.className = "st-tacts";
        acts.innerHTML = '<button data-t="new" title="新建终端"><svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor"/><path d="M4 6l2.5 2L4 10M8 10.5h4" fill="none" stroke="currentColor" stroke-linecap="round"/></svg></button>' +
          '<button data-t="split" title="向右拆分 (⌘D)"><svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor"/><path d="M8 3v10" stroke="currentColor"/></svg></button>' +
          '<button data-t="more" title="更多操作"><svg viewBox="0 0 16 16"><circle cx="4" cy="8" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/><circle cx="12" cy="8" r="1.1" fill="currentColor"/></svg></button>';
        acts.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); });
        acts.addEventListener("click", function (e) {
          var b = e.target.closest("[data-t]");
          if (!b) return;
          if (b.dataset.t === "new") ws.newTab();
          if (b.dataset.t === "split") ws.split("row");
          if (b.dataset.t === "more" && window.TSU_DESK && TSU_DESK.popup) {
            var r = b.getBoundingClientRect(), mi = function (l, k, run) { return { label: l, keys: k || "", run: run }; };
            TSU_DESK.popup([mi("向下拆分", "⇧⌘D", function () { ws.split("col"); }), { sep: true },
              mi("关闭", "⌘W", function () { ACTIONS.closePane.run(); }),
              mi("关闭其他", "", function () { var keepT = ws.tab(); ws.tabs.slice().forEach(function (t) { if (t !== keepT) { var j = ws.tabs.indexOf(t); askClose(ws.leaves(t.root).map(function (l) { return l.pane; }), "标签页", function () { var jj = ws.tabs.indexOf(t); if (jj >= 0) ws.closeTab(jj); }); } }); }),
              { sep: true }, mi("命令面板…", "⇧⌘P", function () { if (window.STUDIO) STUDIO.palette(tw, "cmd"); })], { x: r.left, y: r.bottom + 4 });
          }
        });
        tw.tabsEl.appendChild(acts);
        if (window.STUDIO) STUDIO.crumbs(tw);
        if (tw.side) tw.side.render();
        return;
      }
      var plus = document.createElement("div");
      plus.className = "tab plus";
      plus.textContent = "+";
      plus.title = "新建标签页 (⌥⌘T)";
      plus.addEventListener("click", function () { ws.newTabUser(); });
      draggable(plus, function () { return { kind: "new" }; }, "＋ 新建面板");
      tw.tabsEl.appendChild(plus);
      if (tw.side) tw.side.render(); // 当前面板换了 agent：边栏里淡紫的那个跟着
    };
    ws.detach = function (pane) {
      for (var i = 0; i < ws.tabs.length; i++) {
        var t = ws.tabs[i], leaf = find(t.root, pane);
        if (!leaf) continue;
        var parent = parentOf(t.root, leaf);
        if (!parent) { ws.tabs.splice(i, 1); if (ws.cur > i || ws.cur >= ws.tabs.length) ws.cur = Math.max(0, ws.cur - 1); return; }
        var sibling = parent.a === leaf ? parent.b : parent.a;
        Object.keys(parent).forEach(function (k) { delete parent[k]; });
        Object.assign(parent, sibling);
        if (t.active === pane) t.active = ws.leaves(t.root)[0].pane;
        return;
      }
    };
    ws.drop = function (item, targetPane, side) {
      var node;
      if (item.kind === "pane" && side === "center") {
        var a = null, b = null;
        ws.tabs.forEach(function (t) { a = a || find(t.root, item.pane); b = b || find(t.root, targetPane); });
        if (!a || !b) return;
        a.pane = targetPane;
        b.pane = item.pane;
      } else {
        if (item.kind === "pane") { ws.detach(item.pane); node = { pane: item.pane }; }
        else if (item.kind === "tab") { node = ws.tabs[item.index].root; ws.tabs.splice(item.index, 1); ws.cur = Math.max(0, ws.tabs.indexOf(ws.tabs.filter(function (t) { return find(t.root, targetPane); })[0])); }
        else if (item.kind === "agent" || item.kind === "cc") {
          var aid = item.kind === "cc" && window.TSU_CLAUDE ? (TSU_CLAUDE.ensure(item.id, item.info), TSU_CLAUDE.id(item.id)) : item.id;
          if (side === "center") { targetPane.run(makeView(targetPane, aid)); ws.active = targetPane; ws.tab().active = targetPane; ws.layout(); targetPane.focus(); return; }
          var fresh = ws.newPane({ agent: aid });
          if (fresh.program && fresh.program.agentId !== aid) fresh.run(makeView(fresh, aid));
          node = { pane: fresh };
        }
        else node = { pane: ws.newPane() };
        var leaf = find(ws.tab().root, targetPane), keep = { pane: leaf.pane };
        delete leaf.pane;
        var first = side === "left" || side === "top";
        Object.assign(leaf, { dir: side === "left" || side === "right" ? "row" : "col", a: first ? node : keep, b: first ? keep : node, ratio: 0.5 });
      }
      var focus = node && node.pane ? node.pane : item.pane || targetPane;
      ws.active = focus;
      ws.tab().active = focus;
      ws.layout();
      focus.focus();
    };
    ws.serialize = function () {
      var ser = function (n) { return n.pane ? { p: n.pane.spec() } : { dir: n.dir, ratio: n.ratio, a: ser(n.a), b: ser(n.b) }; };
      return { cur: ws.cur, tabs: ws.tabs.map(function (t) { var leaves = ws.leaves(t.root); return { root: ser(t.root), active: Math.max(0, leaves.findIndex(function (l) { return l.pane === t.active; })) }; }) };
    };
    ws.restore = function (saved) {
      ws.tabs = [];
      var de = function (n) { if (n.p) return { pane: Pane(tw, n.p) }; return { dir: n.dir, ratio: n.ratio, a: de(n.a), b: de(n.b) }; };
      if (saved && saved.tabs && saved.tabs.length) {
        saved.tabs.forEach(function (st) { var t = { root: de(st.root) }; t.active = ws.leaves(t.root)[st.active || 0] ? ws.leaves(t.root)[st.active || 0].pane : ws.leaves(t.root)[0].pane; ws.tabs.push(t); });
        ws.cur = Math.min(saved.cur || 0, ws.tabs.length - 1);
      } else {
        var p0 = ws.newPane({ sh: { cwd: "/home/user" } });
        ws.tabs.push({ root: { pane: p0 }, active: p0 });
        ws.cur = 0;
      }
      ws.select(ws.cur);
    };
  }
  function find(node, pane) { if (!node) return null; if (node.pane) return node.pane === pane ? node : null; return find(node.a, pane) || find(node.b, pane); }
  function parentOf(node, child) { if (!node || node.pane) return null; if (node.a === child || node.b === child) return node; return parentOf(node.a, child) || parentOf(node.b, child); }
  function build(node) {
    if (node.pane) { node.pane.el.style.flex = ""; return node.pane.el; }
    var box = document.createElement("div"), a = build(node.a), b = build(node.b), bar = document.createElement("div");
    box.className = "split " + node.dir;
    bar.className = "divider";
    var apply = function () { a.style.flex = node.ratio + " 1 0"; b.style.flex = (1 - node.ratio) + " 1 0"; };
    apply();
    bar.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      var r = box.getBoundingClientRect();
      var move = function (ev) { var f = node.dir === "row" ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height; node.ratio = Math.max(0.15, Math.min(0.85, f)); apply(); };
      var up = function () { bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); persistAll(); };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
    });
    box.appendChild(a);
    box.appendChild(bar);
    box.appendChild(b);
    return box;
  }

  // ======== Paimon Terminal 的编辑区（同 VS Code 的编辑器组）：一张网格（左右 / 上下分），每一格是一组；
  //   每组有自己的标签条、面包屑，显示组里当前的那个。拆分 = 分出新的一组（它的标签条对着它自己那块），不是在一个标签页里分屏。
  //   对外还是 Workspace 那套接口：tabs 是「每个编辑器算一个标签页」的一张表（root 只有它一格），别处的代码照旧能用 ========
  function GroupSpace(tw) {
    var ws = this, seq = 0;
    ws.grid = null;   // { g: 组 } | { dir: "row" | "col", ratio, a, b }
    ws.group = null;  // 当前组
    ws.active = null; // 当前组里当前的那个（有焦点的）
    var Group = function (editors, active) { return { id: ++seq, editors: editors || [], active: active || (editors && editors[0]) || null }; };
    var walk = function (n, f) { if (!n) return; if (n.g) f(n.g, n); else { walk(n.a, f); walk(n.b, f); } };
    ws.groups = function () { var o = []; walk(ws.grid, function (g) { o.push(g); }); return o; };
    var leafOf = function (g) { var hit = null; walk(ws.grid, function (x, n) { if (x === g) hit = n; }); return hit; };
    var parentIn = function (n, child) { if (!n || n.g) return null; if (n.a === child || n.b === child) return n; return parentIn(n.a, child) || parentIn(n.b, child); };
    ws.groupOf = function (p) { var hit = null; walk(ws.grid, function (g) { if (g.editors.indexOf(p) >= 0) hit = g; }); return hit; };
    ws.all = function () { var o = []; if (ws.itabs) { if (ws.grid) ws.itabs[ws.ti] = ws.grid; ws.itabs.forEach(function (gr) { walk(gr, function (g) { o = o.concat(g.editors); }); }); return o; } ws.groups().forEach(function (g) { o = o.concat(g.editors); }); return o; };
    ws.visible = function () { return ws.groups().map(function (g) { return g.active; }).filter(Boolean); };
    // 兼容：每个编辑器一张「标签页」（同一个对象，indexOf 找得到）
    var tabOf = function (p) { return p._tab || (p._tab = { root: { pane: p }, active: p }); };
    Object.defineProperty(ws, "tabs", { get: function () { return ws.all().map(tabOf); }, set: function (v) { if (Array.isArray(v) && !v.length) { ws.grid = null; ws.group = null; ws.active = null; } } });
    Object.defineProperty(ws, "cur", { get: function () { return Math.max(0, ws.all().indexOf(ws.active)); }, set: function () {} });
    ws.tab = function () { return ws.active ? tabOf(ws.active) : null; };
    ws.leaves = function (node, o) { o = o || []; if (!node) return o; if (node.pane) o.push(node); else if (node.a) { ws.leaves(node.a, o); ws.leaves(node.b, o); } return o; };
    // 新开的默认是 Paimon 的主页（同浏览器的新标签页）：编辑区里不再开终端，终端在底下的面板里
    ws.newPane = function (spec) { return Pane(tw, spec || { page: "history" }); }; // 没说开什么：空白页（历史记录）——不再是仪表盘
    // ======== Pure Terminal（同 iTerm）：窗口顶上一排标签页，每个标签页里是自己的分屏（每格一个会话，分屏时每格上面一条小标题）；
    //          VS Code 的是「每一格一组标签页」。换应用风格时两种互相转：组里没显示的各成一个标签页；换回去全并进当前组 ========
    var PT = function () { return !!(window.STUDIO && STUDIO.get && STUDIO.get("os") === "terminal"); };
    ws.itabs = null; ws.ti = 0;
    var gridPanes = function (grid) { var o = []; walk(grid, function (g) { o = o.concat(g.editors); }); return o; };
    function enterPT() {
      if (ws.itabs) return;
      var extra = [];
      ws.groups().forEach(function (g) { g.editors.filter(function (p) { return p !== g.active; }).forEach(function (p) { extra.push(p); }); g.editors = g.active ? [g.active] : g.editors.slice(0, 1); });
      ws.itabs = (ws.grid ? [ws.grid] : []).concat(extra.map(function (p) { return { g: Group([p], p) }; }));
      ws.ti = 0;
    }
    function leavePT() {
      if (!ws.itabs) return;
      if (ws.grid) ws.itabs[ws.ti] = ws.grid;
      var cur = ws.grid, extra = [];
      ws.itabs.forEach(function (gr) { if (gr !== cur) extra = extra.concat(gridPanes(gr)); });
      ws.itabs = null;
      if (!extra.length) return;
      if (!ws.grid) { ws.grid = { g: Group(extra, extra[0]) }; ws.group = ws.grid.g; ws.active = extra[0]; return; }
      var g = ws.group || ws.groups()[0];
      extra.forEach(function (p) { g.editors.push(p); });
    }
    // 应用风格变了（设置里、菜单里）：要的和现在的不一样就转一下、重画
    ws.ptSync = function () { var want = PT(); if (want === !!ws.itabs) return false; if (want) enterPT(); else leavePT(); ws.layout(); if (ws.active) ws.active.focus(); return true; };
    // 切到第 i 个标签页：回到它里面上次那一格
    function useTab(i) {
      if (!ws.itabs || !ws.itabs[i]) return;
      if (ws.grid) ws.itabs[ws.ti] = ws.grid;
      ws.ti = i; ws.grid = ws.itabs[i];
      var gs = ws.groups(), g = gs.filter(function (x) { return x.editors.indexOf(ws.grid._last) >= 0; })[0] || gs[0];
      ws.group = g || null; ws.active = g ? g.active : null;
    }
    ws.useTab = function (i) { useTab(i); ws.layout(); if (ws.active) ws.active.focus(); };
    function tabOfPane(p) { if (!ws.itabs) return -1; if (ws.grid) ws.itabs[ws.ti] = ws.grid; for (var i = 0; i < ws.itabs.length; i++) if (gridPanes(ws.itabs[i]).indexOf(p) >= 0) return i; return -1; }
    // 当前标签页整个空了：去掉它，到旁边那个
    function ptFix() {
      if (!ws.itabs) return;
      if (ws.grid) { ws.itabs[ws.ti] = ws.grid; return; }
      ws.itabs.splice(ws.ti, 1);
      if (!ws.itabs.length) { ws.ti = 0; return; }
      useTab(Math.min(ws.ti, ws.itabs.length - 1));
    }
    // 新开、拆分出来的是一个 shell（同 iTerm）：在当前那格的目录里
    function ptShellSpec() { var i = window.TSU_LOCAL && TSU_LOCAL.info && TSU_LOCAL.info(), cwd = ws.active && ws.active.shell && ws.active.shell.cwd ? ws.active.shell.cwd() : (i && i.home) || "/home/user"; return { sh: { cwd: cwd, pty: true } }; }
    // 窗口顶上那一排（同 iTerm）：每个标签页一格（标题、⌘1…），只有一个时不显示（设置里可以改成始终显示），最右边 +
    function drawITabs() {
      var el = tw.tabsEl, always = window.STUDIO && STUDIO.get && STUDIO.get("ptTabBar") === "always";
      if (ws.grid) ws.itabs[ws.ti] = ws.grid;
      el.hidden = !(ws.itabs.length > 1 || always);
      el.classList.add("pt-tabs");
      el.textContent = "";
      ws.itabs.forEach(function (gr, i) {
        var ps = gridPanes(gr), p = (i === ws.ti ? ws.active : gr._last) || ps[0];
        if (!p) return;
        var b = document.createElement("div");
        b.className = "tab" + (i === ws.ti ? " on" : "");
        b.innerHTML = '<i class="tx" title="关闭标签页">×</i><span></span><em class="pt-k">' + (i < 9 ? "⌘" + (i + 1) : "") + "</em>";
        b.querySelector("span").textContent = p.title() + (ps.length > 1 ? " (" + ps.length + ")" : "");
        if (window.TSU_BROWSER) TSU_BROWSER.fav(b, p);
        b.addEventListener("mousedown", function (e) { e.preventDefault(); if (e.target.closest(".tx")) askClose(ps, "标签页", function () { ps.forEach(function (x) { ws.closePane(x); }); }); });
        b.addEventListener("click", function (e) { if (!e.target.closest(".tx")) ws.useTab(i); });
        b.addEventListener("auxclick", function (e) { if (e.button === 1) askClose(ps, "标签页", function () { ps.forEach(function (x) { ws.closePane(x); }); }); });
        el.appendChild(b);
      });
      var plus = document.createElement("button");
      plus.className = "pt-new"; plus.title = "新建标签页 (⌘T)"; plus.textContent = "+";
      plus.addEventListener("mousedown", function (e) { e.preventDefault(); });
      plus.addEventListener("click", function () { ws.newTab(); });
      el.appendChild(plus);
    }

    // ---- 画：网格 → 每组（标签条 + 面包屑 + 当前那个）----
    function groupEl(g) {
      if (!g.el) {
        g.el = document.createElement("div");
        g.el.className = "tgroup";
        g.tabsEl = document.createElement("div");
        g.tabsEl.className = "tabs gtabs";
        g.crumbsEl = document.createElement("div");
        g.crumbsEl.className = "st-crumbs";
        g.body = document.createElement("div");
        g.body.className = "tgbody";
        g.el.appendChild(g.tabsEl);
        g.el.appendChild(g.crumbsEl);
        g.el.appendChild(g.body);
        g.el.addEventListener("mousedown", function () { if (g.active && ws.active !== g.active) ws.activate(g.active); }, true); // 点到哪组，哪组就是当前组
      }
      g.el.classList.toggle("on", g === ws.group);
      bodyPanes(g);
      return g.el;
    }
    // 这一组开着的几个都留在页面上、叠在一起：当前那个露着，别的 content-visibility:hidden 藏着（不排版、不画，排好的样子和滚动位置都还在）——
    //   切过去只是换个 class（原来是从页面上拿下来再放回去：几千行的会话整段重新排版要一两百毫秒）
    function bodyPanes(g) {
      var kids = g.body.children;
      for (var ki = kids.length - 1; ki >= 0; ki--) { var kc = kids[ki]; if (!g.editors.some(function (p) { return p.el === kc; })) g.body.removeChild(kc); }
      g.editors.forEach(function (p) {
        if (p.el.parentNode !== g.body) g.body.appendChild(p.el);
        var off = p !== g.active;
        p.off = off;
        if (p.el.classList.contains("tpoff") !== off) { p.el.classList.toggle("tpoff", off); if (off) p.el.setAttribute("aria-hidden", "true"); else p.el.removeAttribute("aria-hidden"); } // 不用 inert：WebKit 里一改就把整棵子树重算样式（大会话要好几秒）
      });
    }
    function buildGrid(node) {
      if (node.g) { var e = groupEl(node.g); e.style.flex = ""; return e; }
      var box = document.createElement("div"), a = buildGrid(node.a), b = buildGrid(node.b), bar = document.createElement("div");
      box.className = "split " + node.dir;
      bar.className = "divider";
      var apply = function () { a.style.flex = node.ratio + " 1 0"; b.style.flex = (1 - node.ratio) + " 1 0"; };
      apply();
      bar.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        try { bar.setPointerCapture(e.pointerId); } catch (x) { /* 不是真指针 */ }
        var r = box.getBoundingClientRect();
        var move = function (ev) { var f = node.dir === "row" ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height; node.ratio = Math.max(0.12, Math.min(0.88, f)); apply(); };
        var up = function () { bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); persistAll(); };
        bar.addEventListener("pointermove", move);
        bar.addEventListener("pointerup", up);
      });
      box.appendChild(a);
      box.appendChild(bar);
      box.appendChild(b);
      return box;
    }
    // 网格的样子（怎么拆、比例、哪几组）没变：不把整个编辑区拆了重搭——只换每组里当前的那个；别的组里开着的那几个不从页面上拿下来（拿下来再放回去要整段重新排版）
    var gridSig = "", nodeSeq = 0;
    var sigOf = function (n) { if (!n) return ""; if (!n._sid) n._sid = ++nodeSeq; if (n.g) { if (!n.g._sid) n.g._sid = ++nodeSeq; return "g" + n.g._sid + "@" + n._sid; } return "(" + n._sid + n.dir + n.ratio + " " + sigOf(n.a) + " " + sigOf(n.b) + ")"; };
    ws.layout = function () {
      if (window.TSU_MACOS && TSU_MACOS.on && TSU_MACOS.on() && tw.el.id === "win") { TSU_MACOS.layout(tw, ws); ws.syncTitles(); persistAll(); return; } // macOS 风格：每个标签页是桌面上的一个窗口（只管 App 的主窗口）
      ws.all().forEach(function (p) { if (p.park) p.park(); }); // 拿下来之前记住各自看到哪儿了
      var sig = ws.grid ? sigOf(ws.grid) : "", root = tw.panesEl.firstChild;
      if (sig && sig === gridSig && root && root._gridSig === sig && tw.panesEl.childNodes.length === 1 && ws.groups().every(function (g) { return g.el && root.contains(g.el); })) ws.groups().forEach(function (g) { groupEl(g); });
      else {
        tw.panesEl.textContent = "";
        root = ws.grid ? buildGrid(ws.grid) : watermark();
        root._gridSig = gridSig = sig;
        tw.panesEl.appendChild(root);
      }
      ws.all().forEach(function (p) { p.el.classList.toggle("active", p === ws.active); p.el.classList.add("solo"); });
      ws.visible().forEach(function (p) { if (p.reshow) p.reshow(); else p.renderNow(); }); // 画好了的不整段重画（见 Pane 的 reshow）
      ws.syncTitles();
      persistAll();
    };
    // 编辑区空着时（同 VS Code）：淡的标志 + 几个常用的快捷键（点了也行）；双击空白处开新标签页
    function watermark() {
      var el = document.createElement("div"), K = function (k) { return window.STUDIO && STUDIO.keycaps ? STUDIO.keycaps(k) : escHtml(k); };
      var items = [["显示所有命令", "⇧⌘P", function () { STUDIO.palette(tw, "cmd"); }], ["快速打开", "⌘P", function () { STUDIO.palette(tw, "open"); }], ["新建标签页", "⌘T", function () { ws.newTabUser(); }],
        ["打开位置", "⌘L", function () { if (tw.browser) tw.browser.focus(); }], ["切换面板", "⌘J", function () { STUDIO.togglePanel(tw); }]];
      el.className = "st-watermark";
      el.innerHTML = '<div class="st-wmark">' + (window.STUDIO && STUDIO.icons && STUDIO.icons.logo ? STUDIO.icons.logo : "✦") + '</div><div class="st-wkeys">' + items.map(function (x, i) { return '<div class="st-wk" data-i="' + i + '"><span>' + escHtml(x[0]) + "</span>" + K(x[1]) + "</div>"; }).join("") + "</div>";
      el.addEventListener("click", function (e) { var r = e.target.closest("[data-i]"); if (r && window.STUDIO) items[+r.dataset.i][2](); });
      el.addEventListener("dblclick", function (e) { if (!e.target.closest("[data-i]")) ws.newTabUser(); });
      return el;
    }
    // 标签条：每组一条（图标 + 名字 + ×），右端「新建终端（在面板里）· 向右拆分 · 更多」
    function drawTabs(g) {
      var el = g.tabsEl;
      if (!el) return;
      el.textContent = "";
      el._g = g; el._ws = ws;
      if (!el._ctx) { el._ctx = true; el.addEventListener("contextmenu", function (e) { if (e.target.closest(".st-tacts")) return; e.preventDefault(); var t = e.target.closest(".tab"); tabMenu(e, el._g, t && t._p); }); }
      g.editors.forEach(function (p) {
        var b = document.createElement("div");
        b._p = p;
        b.className = "tab" + (p === g.active ? " on" : "") + (p === ws.active ? " focus" : "");
        b.innerHTML = '<i class="tx" title="关闭">×</i><span></span>';
        b.querySelector("span").textContent = (p.bell ? "🔔 " : "") + p.title();
        if (window.TSU_BROWSER) TSU_BROWSER.fav(b, p);
        // 按下不切换（同 VS Code 拖标签页去分屏：拖着的时候当前看着的那个不变，放下才对）；松开没拖动才切过去；中键关闭
        b.addEventListener("mousedown", function (e) {
          e.preventDefault();
          if (e.target.closest(".tx")) askClose([p], "标签页", function () { ws.closePane(p); });
        });
        b.addEventListener("click", function (e) { if (!e.target.closest(".tx")) ws.show(p); });
        b.addEventListener("auxclick", function (e) { if (e.button === 1) { e.preventDefault(); askClose([p], "标签页", function () { ws.closePane(p); }); } });
        draggable(b, function (e) { return e.target.closest(".tx") ? null : { kind: "tab", pane: p, ws: ws }; }, "↳ " + p.title());
        el.appendChild(b);
      });
      drawActs(g);
      // 标签栏放不下（手机上那么窄，绕开灵动岛时只剩一小段）：当前那一页滑进看得见的地方
      var onT = el.querySelector(".tab.on");
      if (onT && el.scrollWidth > el.clientWidth + 1) { var tr0 = onT.getBoundingClientRect(), er0 = el.getBoundingClientRect(), aw = (el.querySelector(":scope > .st-tacts") || {}).offsetWidth || 0; if (getComputedStyle(el.querySelector(":scope > .st-tacts") || el).position === "absolute") aw = 0; if (tr0.left < er0.left || tr0.right > er0.right - aw) el.scrollLeft += tr0.left - er0.left - 4; }
    }
    // 标签条右端的按钮：跟着这一组当前的那个换（同一组里切标签页时只重画这一段，见 syncQuick）
    function drawActs(g) {
      var el = g.tabsEl;
      if (!el) return;
      var old = el.querySelector(":scope > .st-tacts");
      if (old) old.remove();
      var acts = document.createElement("div"), extra = g.active && g.active.program && g.active.program.tabActions ? g.active.program.tabActions() : [];
      // 右端的按钮（同 VS Code）：页面自己的几个、向右拆分、更多；右键能把哪个藏起来；「新建终端」不放这里（终端在面板里）
      var hid = function (id) { return !!(window.STUDIO && STUDIO.tbHidden && STUDIO.tbHidden("editor", id)); }, pk = (g.active && g.active.program && g.active.program.page) || "agent";
      var tbItems = extra.map(function (x, i) { return { id: pk + ":" + x.title, label: x.title, icon: x.icon, i: i }; }).concat([{ id: "split", label: "向右拆分", keys: "⌘D" }]);
      var shownX = extra.filter(function (x, i) { return !hid(tbItems[i].id); }).length;
      acts.className = "st-tacts";
      acts.dataset.nodrag = "";
      acts.innerHTML = extra.map(function (x, i) { return hid(tbItems[i].id) ? "" : '<button data-x="' + i + '" data-tb="' + escHtml(tbItems[i].id) + '" title="' + escHtml(x.title) + '">' + x.icon + "</button>"; }).join("") + (shownX ? '<i class="st-tsep"></i>' : "") +
        (hid("split") ? "" : '<button data-t="split" data-tb="split" title="向右拆分 (⌘D)"><svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor"/><path d="M8 3v10" stroke="currentColor"/></svg></button>') +
        '<button data-t="lay" title="设置、账号、侧栏、面板、浏览器"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><circle cx="8" cy="8" r="2.1"/><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2"/></svg></button>' + // 齿轮：设置在这里（还有账号、侧栏、面板、浏览器）
        '<button data-t="focus" title="全屏：只看对话"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg></button>' +
        '<button data-t="more" title="更多操作"><svg viewBox="0 0 16 16"><circle cx="4" cy="8" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/><circle cx="12" cy="8" r="1.1" fill="currentColor"/></svg></button>';
      acts.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); });
      acts.addEventListener("contextmenu", function (e) { var b = e.target.closest("[data-tb]"); if (window.STUDIO && STUDIO.toolbarMenu) STUDIO.toolbarMenu(e, "editor", tbItems, b && b.dataset.tb, function () { ws.syncTitles(); }); });
      acts.addEventListener("click", function (e) {
        var b = e.target.closest("[data-t], [data-x]");
        if (!b) return;
        if (g.active && ws.active !== g.active) ws.activate(g.active);
        if (b.dataset.x) { var x = extra[+b.dataset.x]; if (x) x.run(); return; }
        if (b.dataset.t === "split") return ws.split("row");
        if (b.dataset.t === "focus") return focusMode(true);
        if (b.dataset.t === "lay" && window.STUDIO && STUDIO.layMenu) return STUDIO.layMenu(frontTerm(), b); // 这一组所在的窗口（以前传错了，点了没反应）
        if (b.dataset.t === "more" && window.STUDIO && STUDIO.menu) {
          var MI = STUDIO.menuIcons ? STUDIO.menuIcons() : {};
          var mi = function (l, k, run, ic) { return { label: l, keys: k || "", run: run, icon: MI[ic] }; };
          var ag0 = g.active && g.active.program && g.active.program.agentId; // 对话（Paimon Code、Claude Code 的会话记录）：显示哪些内容
          // 显示哪些、怎么显示（消息、回答、思考 ›、工具 › 每类的档位……）：指着就预览，点了定下来
          var kindsNow = function () {
            var kinds = ag0 ? convMenu(MI, ag0, g.active).concat([{ sep: true }]) : [];
            // 右边那条缩略图也是这一块显示的东西：在这里选（始终显示、仅滚动时显示、透明、隐藏）
            var MM = STUDIO.miniModes || [];
            if (ag0) kinds = kinds.concat([tsItem(MI, ag0)]); // 时间戳、缩略图一组
            if (STUDIO.get && MM.length) kinds = kinds.concat([{ label: "缩略图", icon: MI.minimap, value: (MM.filter(function (x) { return x[0] === STUDIO.get("minimap", true); })[0] || ["", ""])[1], items: function () { var mm = STUDIO.get("minimap", true); return MM.map(function (x) { return { label: x[1], radio: true, checked: mm === x[0], run: function () { STUDIO.setv("minimap", x[0]); }, preview: function (p) { STUDIO.previewSet("minimap", p ? x[0] : null); } }; }); } }, { sep: true }]);
            // 代码文件：行号显示 / 隐藏（同 设置 › 外观 › 行号；记在设置里，所有代码文件一起变）
            var fpr = g.active && g.active.program;
            if (fpr && fpr.page === "file" && STUDIO.get && STUDIO.setv) {
              var en0 = window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en", lnOn = STUDIO.get("codeLineNumbers") !== false; // 「显示」在词典里是 Display：这里直接写英文
              var ln = function (on) { return { label: on ? (en0 ? "Shown" : "显示") : (en0 ? "Hidden" : "隐藏"), radio: true, checked: lnOn === on, run: function () { STUDIO.setv("codeLineNumbers", on); } }; };
              if (kinds.length && kinds[kinds.length - 1].sep) kinds.pop();
              kinds = kinds.concat([{ label: "行号", icon: MI.lineNo, value: lnOn ? (en0 ? "Shown" : "显示") : (en0 ? "Hidden" : "隐藏"), items: function () { return [ln(true), ln(false)]; } }, { sep: true }]);
            }
            return kinds;
          };
          STUDIO.menu(function () { return kindsNow().concat([mi("向右拆分", "⌘D", function () { ws.split("row"); }, "splitR"), mi("向下拆分", "⇧⌘D", function () { ws.split("col"); }, "splitD"), { sep: true },
            // agent 的标签页：只有「关闭」，而且先问一句（agent 不该被随手关掉；关的只是这个视图，它在后台照跑）；「关闭其他」「关闭此组」不放
            ag0 ? mi("关闭…", "⌘W", function () { var P0 = g.active; if (!P0) return; var nm = P0.title ? P0.title() : "";
              if (!window.TSU_DESK || !TSU_DESK.alert) return ws.closePane(P0);
              TSU_DESK.alert({ title: "关闭「" + nm + "」？", message: "只关掉这个标签页，会话在后台照常运行；之后可以从侧栏再打开。", icon: "caution", buttons: [{ label: "取消", role: "cancel" }, { label: "关闭", role: "default", run: function () { ws.closePane(P0); } }] }); }, "close")
              : mi("关闭", "⌘W", function () { if (g.active) askClose([g.active], "标签页", function () { ws.closePane(g.active); }); }, "close"),
            ag0 ? null : mi("关闭其他", "", function () { var ps = g.editors.filter(function (p) { return p !== g.active; }); askClose(ps, "标签页", function () { ps.forEach(function (p) { ws.closePane(p); }); }); }, "closeOthers"),
            ag0 ? null : mi("关闭此组", "", function () { askClose(g.editors.slice(), "标签页", function () { g.editors.slice().forEach(function (p) { ws.closePane(p); }); }); }, "close")].filter(Boolean)); }, { el: b, side: "below-end" });
        }
      });
      var where = window.STUDIO && STUDIO.get ? STUDIO.get("editorActions") : "tabbar", tbv = window.STUDIO && STUDIO.get ? STUDIO.get("tabBar") : "multiple";
      if (g === ws.group && !(where === "titlebar" || tbv === "hidden")) { var s0 = tw.el.querySelector(".bar > .st-tbacts"); if (s0) s0.textContent = ""; } // 换回标签栏：标题栏里那份清掉
      if (where === "hidden") return;
      if (where === "titlebar" || tbv === "hidden") { if (g === ws.group) titleActs(acts); return; } // 标签栏藏着：按钮放到标题栏
      el.appendChild(acts);
    }
    // 编辑器的按钮放在窗口标题栏里（同 VS Code「编辑器操作位置：标题栏」）：布局按钮前面一格
    function titleActs(acts) {
      var bar = tw.el.querySelector(".bar");
      if (!bar) return;
      var slot = bar.querySelector(":scope > .st-tbacts");
      if (!slot) { slot = document.createElement("div"); slot.className = "st-tbacts"; slot.dataset.nodrag = ""; ["pointerdown", "dblclick"].forEach(function (t) { slot.addEventListener(t, function (e) { e.stopPropagation(); }); }); }
      var lay = bar.querySelector(":scope > .st-lay");
      if (lay) bar.insertBefore(slot, lay); else bar.appendChild(slot);
      slot.textContent = "";
      slot.appendChild(acts);
    }
    // ---- 标签页右键（同 VS Code）：关闭几种、拆分到四个方向、标签栏外观 / 位置、编辑器操作位置、配置标签页；空白处右键：新建、打开、拆分、同上几项 ----
    function tabMenu(e, g, p) {
      if (!window.STUDIO || !STUDIO.menu) return;
      var MI = STUDIO.menuIcons ? STUDIO.menuIcons() : {}, get = function (k) { return STUDIO.get(k); };
      var mi = function (l, k, run, ic, o) { return Object.assign({ label: l, keys: k || "", run: run, icon: MI[ic] }, o || {}); };
      var radio = function (label, ic, key, opts) { return mi(label, "", null, ic, { items: function () { var cur = get(key); return opts.map(function (x) { return { label: x[1], radio: true, checked: cur === x[0], run: function () { STUDIO.setv(key, x[0]); } }; }); } }); };
      var closeSome = function (list) { if (list.length) askClose(list, "标签页", function () { list.forEach(function (x) { ws.closePane(x); }); }); };
      var at = p ? g.editors.indexOf(p) : -1;
      var head = p ? [
        mi("关闭", "⌘W", function () { closeSome([p]); }, "close"),
        mi("关闭其他", "", function () { closeSome(g.editors.filter(function (x) { return x !== p; })); }, "closeOthers", { disabled: g.editors.length < 2 }),
        mi("关闭右侧", "", function () { closeSome(g.editors.slice(at + 1)); }, "close", { disabled: at === g.editors.length - 1 }),
        mi("全部关闭", "", function () { closeSome(g.editors.slice()); }, "close"),
      ].concat(p.program && p.program.page === "file" ? [{ sep: true }, mi("复制路径", "", function () { if (navigator.clipboard) navigator.clipboard.writeText(p.program.arg || ""); }, "open")] : [])
        .concat(canNewWin() ? [{ sep: true }, mi("移到新窗口", "", function () { toNewWindow(tw, p, true); }, "window", { disabled: !!(p.program && p.program.pty) }), mi("复制到新窗口", "", function () { toNewWindow(tw, p, false); }, "window")] : [])
        : [
        pmTree() ? mi("新建 Agent", "", function () { if (caNew()) return; var ag = A.create({}); var np = ws.newPane({ agent: ag.id }); if (!np.program || np.program.agentId !== ag.id) np.run(makeView(np, ag.id)); ws.adopt(np); }, "agent") : null,
        mi("快速打开…", "⌘P", function () { STUDIO.palette(tw, "open"); }, "palette"),
        mi("新建终端", "⌃`", function () { STUDIO.newTerm(tw); }, "term"),
      ];
      var target = p || g.active;
      var split = function (side) { return function () { if (target) ws.show(target); ws.splitTo(side); }; };
      STUDIO.menu(function () {
        return head.concat([{ sep: true },
          mi("向上拆分", "", split("top"), "splitD"), mi("向下拆分", "⇧⌘D", split("bottom"), "splitD"), mi("向左拆分", "", split("left"), "splitR"), mi("向右拆分", "⌘D", split("right"), "splitR"),
          { sep: true },
          radio("标签栏外观", "tab", "tabBar", [["multiple", "多个标签页"], ["single", "单个标签页"], ["hidden", "隐藏"]]),
          radio("标签栏位置", "layout", "tabBarPos", [["top", "顶部"], ["bottom", "底部"]]),
          radio("编辑器操作位置", "collapse", "editorActions", [["tabbar", "标签栏"], ["titlebar", "标题栏"], ["hidden", "隐藏"]]),
          { sep: true },
          mi("配置标签页…", "", function () { STUDIO.settings(tw, "appearance:tabBar"); }, "gear"),
        ]);
      }, { x: e.clientX, y: e.clientY });
    }
    // 同一组里换一个之后：标签条上亮哪个、窗口标题马上改（只改 class 和字）；别的等这一帧画完再做——换过的那几组标签条右端的按钮（跟着页面换）、🔔、
    //   面包屑、菜单、地址栏、左边树上「当前」那一行（只挪 class，整棵树重拼一遍要十几二十毫秒）、存布局。标签条不整条重画（几十个标签页要十几毫秒）
    var afterT = 0, afterR = 0, afterG = [];
    function syncQuick(g) {
      ws.groups().forEach(function (g2) {
        if (g2.el && g2.el.classList.contains("on") !== (g2 === ws.group)) g2.el.classList.toggle("on", g2 === ws.group);
        if (g2.tabsEl) Array.prototype.forEach.call(g2.tabsEl.children, function (b) { if (!b._p) return; var on = b._p === g2.active, fo = b._p === ws.active; if (b.classList.contains("on") !== on) b.classList.toggle("on", on); if (b.classList.contains("focus") !== fo) b.classList.toggle("focus", fo); });
      });
      if (tw.titleEl) tw.titleEl.textContent = ws.active ? ws.active.title() : "Vibing Studio";
      if (afterG.indexOf(g) < 0) afterG.push(g);
      var run = function () {
        clearTimeout(afterT); cancelAnimationFrame(afterR); afterT = afterR = 0;
        var gs = afterG; afterG = [];
        if (ws.itabs || gs.some(function (g1) { return !g1.el || !g1.el.isConnected || ws.groups().indexOf(g1) < 0; })) { ws.syncTitles(); persistAll(); return; } // 这期间布局变了：整个同步一遍
        if (window.TSU_DESK && TSU_DESK.front() && TSU_DESK.front().el === tw.el) TSU_DESK.refreshMenus();
        gs.forEach(function (g1) {
          if (g1.tabsEl) Array.prototype.forEach.call(g1.tabsEl.children, function (b) { var sp = b._p === g1.active && b.querySelector("span"), t = sp && (b._p.bell ? "🔔 " : "") + b._p.title(); if (sp && sp.textContent !== t) sp.textContent = t; }); // 🔔 去掉
          drawActs(g1);
          if (window.STUDIO && STUDIO.crumbsInto) STUDIO.crumbsInto(g1.crumbsEl, g1.active);
        });
        if (window.TSU_BROWSER) TSU_BROWSER.sync(tw);
        if (tw.side && !(tw.side.markCur && tw.side.markCur())) tw.side.render();
        persistAll();
      };
      clearTimeout(afterT); cancelAnimationFrame(afterR);
      afterR = requestAnimationFrame(function () { afterR = 0; clearTimeout(afterT); afterT = setTimeout(run, 0); }); // 画完这一帧再做
      afterT = setTimeout(run, 120); // 窗口在后台时 rAF 不来：兜底
    }
    ws.syncTitles = function () {
      if (DRAG && DRAG.on) { if (DRAG.pend.indexOf(ws) < 0) DRAG.pend.push(ws); return; } // 拖着的时候不整条重画标签条（放下后补一遍）
      if (tw.titleEl) tw.titleEl.textContent = ws.active ? ws.active.title() : "Vibing Studio";
      if (window.TSU_DESK && TSU_DESK.front() && TSU_DESK.front().el === tw.el) TSU_DESK.refreshMenus();
      if (ws.itabs) drawITabs(); else { tw.tabsEl.hidden = true; tw.tabsEl.classList.remove("pt-tabs"); } // VS Code：窗口那一条不用，每组自己的标签条；Pure Terminal：窗口那一条是 iTerm 的标签页
      tw.panesEl.classList.toggle("pt-split", !!ws.itabs && ws.groups().length > 1);
      ws.groups().forEach(function (g) {
        if (!g.el) return;
        g.el.classList.toggle("on", g === ws.group);
        drawTabs(g);
        if (window.STUDIO && STUDIO.crumbsInto) STUDIO.crumbsInto(g.crumbsEl, g.active);
      });
      if (window.TSU_BROWSER) TSU_BROWSER.sync(tw);
      if (tw.side) tw.side.render();
    };

    // ---- 切换、打开、关 ----
    ws.show = function (p) {
      if (ws.itabs && !ws.groupOf(p)) { var ti0 = tabOfPane(p); if (ti0 >= 0) useTab(ti0); } // 在别的标签页里：先切过去
      var g = ws.groupOf(p);
      if (!g) return;
      if (ws.grid) ws.grid._last = p;
      var swap = g.active !== p || !g.el || p.el.parentNode !== g.body || p.el.classList.contains("tpoff");
      var quick = swap && g.el && g.el.isConnected && p.el.parentNode === g.body && !(window.TSU_MACOS && TSU_MACOS.on && TSU_MACOS.on() && tw.el.id === "win"); // 同一组里换一个：只换露着的那个
      var prev = g.active;
      g.active = p;
      mruTouch(g, p);
      ws.group = g;
      ws.active = p;
      p.bell = false;
      if (quick) {
        if (prev && prev !== p && prev.park) prev.park();
        bodyPanes(g);
        ws.all().forEach(function (x) { if (x.el.classList.contains("active") !== (x === p)) x.el.classList.toggle("active", x === p); });
        if (p.reshow) p.reshow(); else p.renderNow();
        syncQuick(g);
      } else if (swap) ws.layout(); else { ws.all().forEach(function (x) { x.el.classList.toggle("active", x === p); }); ws.syncTitles(); persistAll(); }
      p.focus();
    };
    ws.activate = function (pane) {
      if (ws.active === pane) return;
      var g = ws.groupOf(pane);
      if (!g) return;
      if (ws.grid) ws.grid._last = pane;
      if (g.active !== pane) return ws.show(pane);
      ws.group = g;
      ws.active = pane;
      pane.bell = false;
      ws.all().forEach(function (p) { p.el.classList.toggle("active", p === pane); });
      ws.syncTitles();
      persistAll();
    };
    ws.select = function (i) { if (ws.itabs) return ws.useTab(Math.min(i, ws.itabs.length - 1)); var p = ws.all()[i]; if (p) ws.show(p); };
    ws.selectInGroup = function (n) { var g = ws.group; if (!g || !g.editors.length) return; var p = n < 0 ? g.editors[g.editors.length - 1] : g.editors[n]; if (p) ws.show(p); };
    ws.cycle = function (d) { if (ws.itabs) { if (ws.itabs.length > 1) ws.useTab((ws.ti + d + ws.itabs.length) % ws.itabs.length); return; } var g = ws.group; if (!g || g.editors.length < 2) return; var i = g.editors.indexOf(g.active); ws.show(g.editors[(i + d + g.editors.length) % g.editors.length]); };
    // 在当前组里、当前那个后面开一个
    ws.newTab = function (spec) {
      if (ws.itabs) { // Pure Terminal：新的标签页（默认一个 shell），放在当前的后面
        var np = ws.newPane(spec || ptShellSpec()), gr = { g: Group([np], np) };
        if (ws.grid) ws.itabs[ws.ti] = ws.grid;
        ws.itabs.splice(ws.itabs.length ? ws.ti + 1 : 0, 0, gr);
        ws.ti = ws.itabs.indexOf(gr); ws.grid = gr; ws.group = gr.g; ws.active = np; gr._last = np;
        ws.layout(); np.focus();
        return np;
      }
      var p = ws.newPane(spec);
      if (!ws.grid) { ws.grid = { g: Group([p], p) }; ws.group = ws.grid.g; ws.show(p); return p; } // 编辑区空着：新的一组里就它一个（以前这里又插了一次——同一个标签页出现两个）
      var g = ws.group || ws.groups()[0];
      g.editors.splice(g.editors.indexOf(g.active) + 1, 0, p);
      ws.show(p);
      return p;
    };
    // 新建标签页（⌘T、标签条 / 顶栏的 +、双击空白处、命令面板）：不是仪表盘——Claude Code 连接器开着就是一个新的 Claude Code 会话
    //   （同 Claude App 的「新会话」：在当前这个标签页的目录里，说第一句时才建出来），没开就是 Codex 的新会话；都没开是空白页（历史记录）
    ws.newTabUser = function () {
      if (ws.itabs) return ws.newTab();
      var ap = ws.active, rt0 = null, cwd = "";
      try { rt0 = ap && ap.program && ap.program.agentId && A.runtime(ap.program.agentId); } catch (e) { rt0 = null; }
      try { cwd = (rt0 && rt0.info && rt0.info.cwd) || (ap && ap.shell && ap.shell.cwd ? ap.shell.cwd() : "") || ""; } catch (e) { cwd = ""; }
      if (!cwd || cwd === "/home/user") cwd = (window.TSU_LOCAL && TSU_LOCAL.info && TSU_LOCAL.info() || {}).home || cwd;
      if (ccOn() && window.TSU_CLAUDE && TSU_CLAUDE.newSession) { var r = TSU_CLAUDE.newSession(cwd); if (r && r.pane) return r.pane; }
      if (cxOn() && window.TSU_CODEX && TSU_CODEX.newSession) { var r2 = TSU_CODEX.newSession(cwd); if (r2 && r2.pane) return r2.pane; }
      return ws.newTab({ page: "history" });
    };
    // 把一组在网格里拆成两格：新的一组放在 side 那边
    function splitGroup(g, ng, side) {
      var leaf = leafOf(g), keep = { g: g }, node = { g: ng }, first = side === "left" || side === "top";
      delete leaf.g;
      Object.assign(leaf, { dir: side === "left" || side === "right" ? "row" : "col", a: first ? node : keep, b: first ? keep : node, ratio: 0.5 });
    }
    function removeGroup(g) {
      var leaf = leafOf(g);
      if (!leaf) return;
      var parent = parentIn(ws.grid, leaf);
      if (!parent) { ws.grid = null; return; }
      var sib = parent.a === leaf ? parent.b : parent.a;
      Object.keys(parent).forEach(function (k) { delete parent[k]; });
      Object.assign(parent, sib);
    }
    // 每组记着最近看过的先后（ws.show 时记）：关掉当前那个，回到这一组里「打开它之前在看的那个」（同 VS Code），没看过别的就是左边那个
    function mruTouch(g, p) { var m = g.mru || (g.mru = []), k = m.indexOf(p); if (k >= 0) m.splice(k, 1); m.unshift(p); if (m.length > 60) m.length = 60; }
    // 从它的组里拿出来（不关）；组空了就把这一格去掉
    function take(p) {
      var g = ws.groupOf(p);
      if (!g) return null;
      var i = g.editors.indexOf(p);
      g.editors.splice(i, 1);
      if (g.mru) { var mk = g.mru.indexOf(p); if (mk >= 0) g.mru.splice(mk, 1); }
      if (g.active === p) g.active = (g.mru || []).filter(function (x) { return g.editors.indexOf(x) >= 0; })[0] || g.editors[i - 1] || g.editors[i] || null;
      if (!g.editors.length) { removeGroup(g); if (ws.group === g) ws.group = null; }
      return g;
    }
    ws.detach = function (p) { take(p); };
    ws.adopt = function (p) { var g = ws.group || ws.groups()[0]; if (!g) { ws.grid = { g: Group([p], p) }; ws.group = ws.grid.g; } else g.editors.splice(g.editors.indexOf(g.active) + 1, 0, p); ws.show(p); };
    // 拆分（同 VS Code「拆分编辑器」，最早的那种）：新的一组，里面是一模一样的一份（agent 一直在跑，多开一个看它的窗口）——
    //   两边各是一个标签页：各滚各的、各自能关（× / ⌘W）。不再在一个标签页里拆成几格（那种拆了关不掉）
    var dupSpec = function (src) {
      var sp = src.spec();
      if (sp && sp.vs && Array.isArray(sp.vs.views) && sp.vs.views.length > 1) sp = Object.assign({}, sp, { vs: { views: [sp.vs.views[0]], dir: sp.vs.dir } }); // 原来那种拆开的几格：只带主视图那一格的筛选
      return sp;
    };
    ws.split = function (dir) {
      if (!ws.active || !ws.group) return;
      var src = ws.active, spec = ws.itabs ? ptShellSpec() : src.program && src.program.pty ? null : dupSpec(src); // Pure Terminal：拆出来的是新的 shell（同 iTerm ⌘D）
      var p = ws.newPane(spec);
      splitGroup(ws.group, Group([p], p), dir === "col" ? "bottom" : "right");
      ws.show(p);
    };
    // 拆分到四个方向（同 VS Code 标签页右键的「向上 / 下 / 左 / 右拆分」）
    ws.splitTo = function (side) {
      if (!ws.active || !ws.group) return;
      var src = ws.active, spec = src.program && src.program.pty ? null : dupSpec(src);
      var p = ws.newPane(spec);
      splitGroup(ws.group, Group([p], p), side);
      ws.show(p);
    };
    // 拖标签页排序：同一组里挪位置，或挪进别的组的标签条
    ws.moveTab = function (p, g, idx) {
      var sg = ws.groupOf(p);
      if (!sg || !g) return;
      if (sg === g) { var i = g.editors.indexOf(p); if (idx === i || idx === i + 1) return ws.show(p); g.editors.splice(i, 1); if (idx > i) idx--; }
      else take(p);
      g.editors.splice(Math.max(0, Math.min(idx, g.editors.length)), 0, p);
      g.active = p;
      ws.show(p);
    };
    ws.closePane = function (pane) {
      if (ws.itabs && !ws.groupOf(pane)) { var ti1 = tabOfPane(pane); if (ti1 < 0) return; useTab(ti1); }
      var g = ws.groupOf(pane);
      if (!g) return;
      var wasActive = ws.active === pane;
      take(pane);
      pane.close();
      if (!ws.grid && ws.itabs) { ptFix(); if (ws.grid) { ws.layout(); if (ws.active) ws.active.focus(); return; } } // 这个标签页空了：到旁边那个
      if (!ws.grid) { ws.group = null; ws.active = null; ws.layout(); return; } // 最后一个关了：同 VS Code，编辑区空着，中间一个淡的标志和几个常用的快捷键（不自动开新的）
      if (!wasActive && ws.active && ws.groupOf(ws.active)) return ws.layout();
      var next = ws.groupOf(g.active) ? g : ws.groups()[0];
      ws.group = next;
      ws.active = next.active;
      ws.layout();
      if (ws.active) ws.active.focus();
    };
    ws.close = function () { if (ws.active) ws.closePane(ws.active); };
    ws.closeTab = function (i, already) { var p = ws.all()[i]; if (!p) return; if (already) { take(p); return ws.layout(); } ws.closePane(p); };
    ws.replacePane = function (old, spec) {
      var g = ws.groupOf(old);
      if (!g) return null;
      var p = ws.newPane(spec), i = g.editors.indexOf(old);
      g.editors[i] = p;
      if (g.active === old) g.active = p;
      if (ws.active === old) ws.active = p;
      old.close();
      ws.layout();
      p.focus();
      return p;
    };
    // 在组之间移焦点（⌥⌘←→↑↓）
    ws.move = function (dx, dy) {
      if (!ws.active) return;
      var r0 = ws.active.el.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2, best = null, bestD = Infinity;
      ws.visible().forEach(function (p) {
        if (p === ws.active) return;
        var r = p.el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        if ((dx && Math.sign(x - cx) !== dx) || (dy && Math.sign(y - cy) !== dy)) return;
        var d = Math.abs(x - cx) * (dx ? 1 : 3) + Math.abs(y - cy) * (dy ? 1 : 3);
        if (d < bestD) { bestD = d; best = p; }
      });
      if (best) { ws.activate(best); best.focus(); }
    };
    // 拖进来：标签页、agent / Claude Code 会话、面板；放中间 = 进这一组，放边上 = 分出新的一组
    ws.drop = function (item, targetPane, side) {
      var tg = ws.groupOf(targetPane);
      if (!tg) return;
      var p = null;
      if (item.kind === "tab" || item.kind === "pane") {
        p = item.pane;
        var sg = ws.groupOf(p);
        if (sg === tg && (side === "center" || tg.editors.length === 1)) return ws.show(p);
        take(p);
        if (side === "center") { tg.editors.splice(tg.editors.indexOf(tg.active) + 1, 0, p); tg.active = p; }
        else splitGroup(tg, Group([p], p), side);
      } else {
        var aid = item.kind === "cc" && window.TSU_CLAUDE ? (TSU_CLAUDE.ensure(item.id, item.info), TSU_CLAUDE.id(item.id)) : item.id;
        if (item.kind === "agent" || item.kind === "cc") {
          var have = null;
          tg.editors.forEach(function (x) { if (!have && x.program && x.program.agentId === aid) have = x; });
          if (have && side === "center") return ws.show(have); // 这一组里已经开着它：切过去
          p = ws.newPane({ agent: aid });
          if (!p.program || p.program.agentId !== aid) p.run(makeView(p, aid));
        } else p = ws.newPane();
        if (side === "center") { tg.editors.splice(tg.editors.indexOf(tg.active) + 1, 0, p); tg.active = p; }
        else splitGroup(tg, Group([p], p), side);
      }
      ws.show(p);
    };
    ws.serialize = function () {
      var ser = function (n) { return n.g ? { e: n.g.editors.map(function (p) { return p.spec(); }), i: Math.max(0, n.g.editors.indexOf(n.g.active)) } : { dir: n.dir, ratio: n.ratio, a: ser(n.a), b: ser(n.b) }; };
      if (ws.itabs) { if (ws.grid) ws.itabs[ws.ti] = ws.grid; return { v: 3, itabs: ws.itabs.map(ser), ti: ws.ti, g: Math.max(0, ws.groups().indexOf(ws.group)) }; } // Pure Terminal：每个标签页一个格子
      return { v: 2, grid: ws.grid ? ser(ws.grid) : null, g: Math.max(0, ws.groups().indexOf(ws.group)) };
    };
    ws.restore = function (saved) {
      var keep = function (sp) { if (sp && sp.page === "dash") return false; if (ccSpec(sp) ? ccOn() : cxSpec(sp) ? cxOn() : true) return true; ccStash(sp); return false; }; // 以前的仪表盘标签页：不再恢复 // 连接器（Claude Code、Codex）关着：它的标签页不恢复（整组都是就整组不要），先收着
      var de = function (n) {
        if (n.e) { var eds = n.e.filter(keep).map(function (sp) { return Pane(tw, sp); }); return eds.length ? { g: Group(eds, eds[Math.min(n.i || 0, eds.length - 1)]) } : null; }
        var a = de(n.a), b = de(n.b);
        return a && b ? { dir: n.dir, ratio: n.ratio, a: a, b: b } : a || b;
      };
      ws.grid = null; ws.itabs = null; ws.ti = 0;
      if (saved && saved.v === 3 && saved.itabs) { // Pure Terminal 存的：几个标签页；现在不是这个风格就并成一组
        var its = saved.itabs.map(de).filter(Boolean);
        if (its.length) { ws.itabs = its; ws.ti = Math.max(0, Math.min(saved.ti || 0, its.length - 1)); ws.grid = its[ws.ti]; }
      }
      else if (saved && saved.v === 2 && saved.grid) ws.grid = de(saved.grid);
      else if (saved && saved.tabs && saved.tabs.length) { // 以前的格式（标签页里分屏）：所有面板按顺序放进一组
        var eds = [], act = null;
        saved.tabs.forEach(function (st, ti) {
          var ps = [];
          (function old(n) { if (!n) return; if (n.p) { if (keep(n.p)) ps.push(Pane(tw, n.p)); } else { old(n.a); old(n.b); } })(st.root);
          eds = eds.concat(ps);
          if (ti === (saved.cur || 0)) act = ps[st.active || 0] || ps[0];
        });
        if (eds.length) ws.grid = { g: Group(eds, act || eds[0]) };
      }
      if (!ws.grid && !saved) { var p0 = ws.newPane(); ws.grid = { g: Group([p0], p0) }; } // 头一次开：一个标签页；上次全关了：空着（水印）
      var gs = ws.groups();
      ws.group = gs[Math.min(saved && saved.g || 0, gs.length - 1)] || gs[0] || null;
      ws.active = ws.group ? ws.group.active : null;
      if (PT() && !ws.itabs) enterPT(); else if (!PT() && ws.itabs) leavePT();
      ws.layout();
      if (ws.active) ws.active.focus();
    };
  }

  // ======== 拖拽分屏（同 VSCode / iTerm）：面板（抓手 ⠿ 或 ⌥⌘ 拖）、标签页、「+」、Dock 里的终端图标 ========
  var hint = document.createElement("div"), ghost = document.createElement("div");
  hint.className = "drop-hint";
  ghost.className = "drag-ghost";
  hint.hidden = ghost.hidden = true;
  document.body.appendChild(hint);
  document.body.appendChild(ghost);
  function frontTerm() {
    var fw = window.TSU_DESK && TSU_DESK.front();
    var hit = fw && wins.find(function (w) { return w.el === fw.el && w.open; });
    return hit || wins.filter(function (w) { return w.open; }).pop() || null;
  }
  function dropAt(x, y, allowCenter) {
    var tw = frontTerm(), hit = null;
    if (!tw || !tw.ws.tab()) return null;
    (tw.ws.visible ? tw.ws.visible().map(function (p) { return { pane: p }; }) : tw.ws.leaves(tw.ws.tab().root)).forEach(function (l) {
      var r = l.pane.el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
      var fx = (x - r.left) / r.width, fy = (y - r.top) / r.height, edge = Math.min(fx, 1 - fx, fy, 1 - fy), side;
      if (edge > 0.25 && allowCenter) side = "center";
      else side = edge === fx ? "left" : edge === 1 - fx ? "right" : edge === fy ? "top" : "bottom";
      var z = { left: [0, 0, 0.5, 1], right: [0.5, 0, 0.5, 1], top: [0, 0, 1, 0.5], bottom: [0, 0.5, 1, 0.5], center: [0, 0, 1, 1] }[side];
      hit = { ws: tw.ws, pane: l.pane, side: side, rect: { left: r.left + z[0] * r.width, top: r.top + z[1] * r.height, width: z[2] * r.width, height: z[3] * r.height } };
    });
    return hit;
  }
  // 拖着的时候：标签条不整条重画（对话在刷新、状态在变也不动它——拖着的那个标签页不会被换掉，指着的位置不会跳），放下以后补一遍
  var DRAG = { on: false, pend: [], cancel: null };
  function dragEnded() { if (!DRAG.pend.length) return; setTimeout(function () { if (DRAG.on) return; var l = DRAG.pend; DRAG.pend = []; l.forEach(function (ws) { try { ws.syncTitles(); } catch (e) { setTimeout(function () { throw e; }, 0); } }); }, 0); } // 放下以后补画（下一轮：正在派发的按下 / 点击不被换掉元素）
  // 拖一样东西（标签页、面板、树上的 agent / 会话 / 文件夹……）：不管怎么结束都收得了尾——松开、系统取消（pointercancel）、指针被收回、
  //   窗口失焦、切到后台、Esc、松开了却没收到 pointerup（下一次移动 buttons 是 0）、又按下了一次、很久没有指针事件；
  //   浮着的那个只改 transform（不排版），指着哪儿、放下去会怎样一帧算一次；先收尾再做放下的事——做的时候出错也不会留下浮着的标签
  function draggable(el, what, label) {
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      if (DRAG.cancel) DRAG.cancel(); // 上一次的没收尾：先收掉，不叠着
      var item = what(e);
      if (!item) return;
      var x0 = e.clientX, y0 = e.clientY, pid = e.pointerId, dragging = false, done = false;
      var target = null, tabTarget = null, treeT = null, lastEv = e, lastAt = Date.now(), lit = null, cap = null, raf = 0, tmo = 0, dog = 0;
      // 亮着的那一个（排序时指着的标签页 / 标签条末尾 / 树上的文件夹）：换了才改 class，不每次全页找
      var light = function (x, cls) { if (lit && (lit.el !== x || lit.cls !== cls)) lit.el.classList.remove(lit.cls); lit = x ? { el: x, cls: cls } : null; if (x) x.classList.add(cls); };
      var start = function () {
        dragging = true;
        DRAG.on = true;
        // 拖标签页：跟着指针走的是这个标签页本身（半透明的一份，从抓住的地方拖），原位淡下去——同 VS Code；别的还是一句名字
        if (item.kind === "tab" && el.classList && el.classList.contains("tab")) {
          var er = el.getBoundingClientRect(), cl = el.cloneNode(true);
          ghost.textContent = ""; ghost.appendChild(cl); ghost.classList.add("tab-ghost");
          ghost.style.width = er.width + "px"; ghost.style.height = er.height + "px";
          ghost._ox = x0 - er.left; ghost._oy = y0 - er.top;
          el.classList.add("st-dragsrc");
        } else { ghost.classList.remove("tab-ghost"); ghost.style.width = ghost.style.height = ""; ghost._ox = -12; ghost._oy = -12; ghost.textContent = typeof label === "function" ? label(item) : label; }
        ghost.style.left = ghost.style.top = "0px";
        ghost.hidden = false; document.body.classList.add("dragging");
        try { document.documentElement.setPointerCapture(pid); cap = document.documentElement; } catch (x) { cap = null; } // 指针拖出窗口、指着别的东西也还归这里：松开一定收得到
      };
      var place = function (ev) { ghost.style.transform = "translate3d(" + (ev.clientX - (ghost._ox || 0)) + "px," + (ev.clientY - (ghost._oy || 0)) + "px,0)"; };
      // 指着哪儿、放下去会怎样
      var update = function (ev) {
        // 拖到标签条上：排序（指着的那个标签页亮一下；放在它前面还是后面看指针在左半边还是右半边）
        if (item.kind === "tab" && item.pane) {
          var hitEl = document.elementFromPoint(ev.clientX, ev.clientY), strip = hitEl && hitEl.closest(".gtabs");
          if (strip && strip._g && strip._ws === item.ws) {
            var tb0 = hitEl.closest(".tab"), idx = strip._g.editors.length;
            // 放在哪儿：指针在它左半边 = 插在它前面，右半边 = 后面——画一条插入线（同 Safari / Chrome），不把整个标签页亮起来（看着像「拖到它上面」）
            if (tb0 && tb0._p) { var rr = tb0.getBoundingClientRect(), aft = ev.clientX > rr.left + rr.width / 2; idx = strip._g.editors.indexOf(tb0._p) + (aft ? 1 : 0); light(tb0, aft ? "st-ins-r" : "st-ins-l"); } else light(strip, "st-dropend");
            tabTarget = { g: strip._g, index: idx };
            target = null; treeT = null; hint.hidden = true;
            return;
          }
          tabTarget = null;
        }
        treeT = null;
        if (item.tree && item.tree.dropAt) { // Agents 树里：拖到文件夹 / 卷上 = 挪过去（亮着那一行）
          var td = item.tree.dropAt(ev.clientX, ev.clientY, item);
          treeT = td || null;
          if (td) { light(td.el, "ts-dropon"); target = null; hint.hidden = true; return; }
          light(null);
          if (item.kind === "vfolder") { target = null; hint.hidden = true; return; } // 文件夹不往编辑区里放
        } else light(null);
        target = dropAt(ev.clientX, ev.clientY, item.kind === "pane" || item.kind === "agent" || item.kind === "cc" || (item.kind === "tab" && !!item.pane));
        if (target && target.side === "center" && (item.kind === "agent" || item.kind === "cc") && target.pane.program && target.pane.program.pty) target = null; // 终端里跑着东西：不替换它
        if (target && item.kind === "pane" && target.pane === item.pane) target = null;
        if (target && item.kind === "pane" && target.ws !== item.pane.win.ws) target = null;
        if (target && item.kind === "tab" && item.pane) { // 编辑器组：拖到自己这组的中间、或只剩它一个的组的边上，都是原地不动
          var sg = item.ws.groupOf(item.pane), tg0 = item.ws.groupOf(target.pane);
          if (item.ws !== target.ws || (sg === tg0 && (target.side === "center" || sg.editors.length === 1))) target = null;
        } else if (target && item.kind === "tab" && (item.ws !== target.ws || item.ws.tabs[item.index] === item.ws.tab())) target = null;
        hint.hidden = !target;
        if (target) Object.assign(hint.style, { left: target.rect.left + "px", top: target.rect.top + "px", width: target.rect.width + "px", height: target.rect.height + "px" });
      };
      var flush = function () { cancelAnimationFrame(raf); clearTimeout(tmo); raf = tmo = 0; if (!done && dragging) try { update(lastEv); } catch (x) { finish(false, "error"); throw x; } };
      var soon = function () { if (raf || tmo) return; raf = requestAnimationFrame(flush); tmo = setTimeout(flush, 50); }; // 一帧一次；窗口在后台 rAF 不来：兜底
      var move = function (ev) {
        if (ev.pointerId !== pid) return;
        if (!ev.buttons) return finish(false, "released"); // 已经松开了却没收到 pointerup（被别的东西吃了）：不放下，收尾
        lastEv = ev; lastAt = Date.now();
        if (!dragging) { if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 5) return; start(); }
        ev.preventDefault();
        place(ev);
        soon();
      };
      var up = function (ev) { if (ev.pointerId !== pid) return; lastEv = ev; finish(true, "up"); };
      var cancel = function (ev) { finish(false, ev && ev.type || "cancel"); };
      var lost = function (ev) { if (ev.pointerId === pid) finish(false, "lost"); }; // 指针被收回了（系统拿走、元素没了）
      var down2 = function () { finish(false, "redown"); }; // 又按下了一次：上一次的松开没收到
      var key = function (ev) { if (ev.key === "Escape" && dragging) { ev.preventDefault(); ev.stopPropagation(); finish(false, "esc"); } };
      var vis = function () { if (document.hidden) finish(false, "hidden"); };
      var noNative = function (ev) { ev.preventDefault(); }; // 拖着时不让网页自己的拖放（拖图、拖选中的字）接手：接手了就再也收不到松开
      function finish(commit, why) {
        if (done) return;
        done = true;
        if (dragging) DRAG.why = why || ""; // 最近一次拖拽是怎么结束的（排查用）
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", cancel, true);
        window.removeEventListener("lostpointercapture", lost, true);
        window.removeEventListener("pointerdown", down2, true);
        window.removeEventListener("blur", cancel);
        window.removeEventListener("keydown", key, true);
        document.removeEventListener("visibilitychange", vis);
        document.removeEventListener("dragstart", noNative, true);
        if (cap) try { if (cap.hasPointerCapture(pid)) cap.releasePointerCapture(pid); } catch (x) { /* 已经放了 */ }
        clearInterval(dog); cancelAnimationFrame(raf); clearTimeout(tmo);
        if (DRAG.cancel === cancel) DRAG.cancel = null;
        var was = dragging;
        if (was && commit) try { update(lastEv); } catch (x) { commit = false; setTimeout(function () { throw x; }, 0); } // 按松开的那一点再算一次
        hint.hidden = ghost.hidden = true; ghost.classList.remove("tab-ghost"); ghost.textContent = ""; ghost.style.transform = "";
        document.querySelectorAll(".st-dragsrc").forEach(function (x) { x.classList.remove("st-dragsrc"); });
        light(null);
        document.body.classList.remove("dragging");
        DRAG.on = false;
        if (was) { // 拖过：接下来那一下 click 不算点击
          var stop = function (ce) { ce.stopPropagation(); ce.preventDefault(); window.removeEventListener("click", stop, true); };
          window.addEventListener("click", stop, true);
          setTimeout(function () { window.removeEventListener("click", stop, true); }, 0);
        }
        try {
          if (was && commit) {
            var M = 24, outside = lastEv && (lastEv.clientX < -M || lastEv.clientY < -M || lastEv.clientX > innerWidth + M || lastEv.clientY > innerHeight + M); // 拖出窗口一截才算出去（贴着边松开不算）
            if (treeT) item.tree.drop(item, treeT);
            else if (outside && item.kind === "tab" && item.pane && canNewWin()) dropOutside(item.pane.win, item.pane, lastEv.screenX, lastEv.screenY);
            else if (tabTarget) item.ws.moveTab(item.pane, tabTarget.g, tabTarget.index);
            else if (target) target.ws.drop(item, target.pane, target.side);
          }
        } finally { dragEnded(); }
      }
      DRAG.cancel = cancel;
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", cancel, true);
      window.addEventListener("lostpointercapture", lost, true);
      window.addEventListener("pointerdown", down2, true);
      window.addEventListener("blur", cancel);
      window.addEventListener("keydown", key, true);
      document.addEventListener("visibilitychange", vis);
      document.addEventListener("dragstart", noNative, true);
      dog = setInterval(function () { if (Date.now() - lastAt > 15000) finish(false, "idle"); }, 1000); // 兜底：很久没有任何指针事件
    });
  }

  // ---- 窗口的建立、恢复、存 ----
  function persistAll() {
    try {
      var st = JSON.stringify({ wins: wins.filter(function (w) { return w.open; }).map(function (w) { return { id: w.id, ws: w.ws.serialize() }; }) });
      localStorage.setItem("tsu-termwins" + WSUF, st);
      if (/"agent":"/.test(st)) localStorage.setItem("tsu-termwins-bak" + WSUF, JSON.stringify({ at: Date.now(), state: JSON.parse(st) })); // 最近一次还开着 agent 的样子：万一又只剩一个空白页，能一下子开回来（历史记录页上的按钮）
    } catch (e) { /* 满了就不存 */ }
  }
  // 上次开着、现在没开的标签页（按记下的最近一次还开着 agent 的样子）：[spec…]；reopenLast 把它们开回来
  function lastTabs() {
    var b = null; try { b = JSON.parse(localStorage.getItem("tsu-termwins-bak" + WSUF) || "null"); } catch (e) { b = null; }
    if (!b || !b.state || !Array.isArray(b.state.wins)) return [];
    var out = [], walk = function (n) { if (!n) return; if (Array.isArray(n.e)) out.push.apply(out, n.e); else { walk(n.a); walk(n.b); } };
    b.state.wins.forEach(function (w) { var ws = w.ws || {}; if (ws.grid) walk(ws.grid); (ws.itabs || []).forEach(walk); });
    var tw = frontTerm(), open = {};
    if (tw) tw.ws.all().forEach(function (p) { var sp = p.spec ? p.spec() : null; if (sp) open[(sp.agent || "") + "|" + (sp.page || "") + "|" + (sp.arg || "")] = 1; });
    return out.filter(function (sp) { return sp && (sp.agent || (sp.page && sp.page !== "history")) && !open[(sp.agent || "") + "|" + (sp.page || "") + "|" + (sp.arg || "")]; });
  }
  function reopenLast() { var tw = frontTerm(), l = lastTabs(); if (!tw) return 0; l.forEach(function (sp) { tw.ws.newTab(sp); }); return l.length; }
  // 开着会话的时候每分钟记一下「还开着」：App 刚关（更新、重启）几分钟内又打开、却一个会话标签页都没接回来（只剩历史记录）——自动把上次开着的开回来
  setInterval(function () { try { if (allPanes().some(function (p) { return p.program && (p.program.agentId || p.lostSpec); })) localStorage.setItem("tsu-agents-alive" + WSUF, String(Date.now())); } catch (e) { /* 记不了就算了 */ } }, 60000);
  window.addEventListener("pagehide", function () { try { if (allPanes().some(function (p) { return p.program && (p.program.agentId || p.lostSpec); })) localStorage.setItem("tsu-agents-alive" + WSUF, String(Date.now())); } catch (e) { /* 记不了就算了 */ } });
  function autoReopen() {
    if (TSU_WIN.open || TSU_WIN.fresh) return;
    if (allPanes().some(function (p) { return p.program && (p.program.agentId || p.lostSpec); })) return;
    var alive = +localStorage.getItem("tsu-agents-alive" + WSUF) || 0;
    if (!alive || Date.now() - alive > 10 * 60000) return; // 很久以前关的：是你自己关的，不替你开
    var hist0 = allPanes().filter(function (p) { return p.program && p.program.page === "history"; });
    if (!reopenLast()) return;
    hist0.forEach(function (p) { try { if (p.win && p.win.ws && p.win.ws.closePane) p.win.ws.closePane(p); } catch (e) { /* 关不掉就留着 */ } }); // 只剩的那个历史记录页：换成接回来的会话
    persistAll();
  }
  // 最近关闭的标签页（同 Safari「历史记录 › 最近关闭」、⇧⌘T）：会话、页面这些（空的 shell、历史记录页不记），最多 20 个，新的在前
  var CLOSED_KEY = "tsu-closed-tabs" + WSUF;
  function closedList() { try { var l = JSON.parse(localStorage.getItem(CLOSED_KEY) || "[]"); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function noteClosed(P) {
    if (P.closed || P.moving || !P.spec || !P.program) return; // 挪到别的窗口去的不算关了
    var sp = P.spec();
    if (!sp || !(sp.agent || (sp.page && sp.page !== "history"))) return;
    var a = window.TSU_BROWSER && TSU_BROWSER.address ? TSU_BROWSER.address(P) : { url: "", title: "" }, k = (sp.agent || "") + "|" + (sp.page || "") + "|" + (sp.arg || "");
    var l = closedList().filter(function (x) { return x.k !== k; });
    l.unshift({ k: k, spec: sp, url: a.url || "", title: a.title || (P.title ? P.title() : ""), at: Date.now() });
    try { localStorage.setItem(CLOSED_KEY, JSON.stringify(l.slice(0, 20))); } catch (e) { /* 满了 */ }
  }
  function reopenClosed(i) {
    var tw = frontTerm(), l = closedList(), x = l[i || 0];
    if (!tw || !x) return false;
    l.splice(i || 0, 1);
    try { localStorage.setItem(CLOSED_KEY, JSON.stringify(l)); } catch (e) { /* 满了 */ }
    tw.ws.newTab(x.spec);
    return true;
  }
  window.addEventListener("pagehide", persistAll);
  document.addEventListener("visibilitychange", function () { if (document.hidden) persistAll(); });
  function installCloseHook(tw) { /* TermWindow 构造时已装；关掉后重新打开前再装一次 */ if (tw.reinstall) tw.reinstall(); }
  var winSeq = 1;
  function makeWindow(wantId) {
    // 先用关着的（包括页面里的 #win），没有再新建一个；刷新恢复时按记下的 id 建（桌面按 id 记着位置）
    var reuse = !wantId && wins.find(function (w) { return !w.open; });
    if (reuse) return reuse;
    var m = wantId && !document.getElementById(wantId) && /^term-(\d+)$/.exec(wantId);
    var content = document.createElement("div");
    content.className = "termbody";
    content.innerHTML = '<div class="tabs" hidden></div><div class="panes"></div>';
    var id = m ? wantId : "term-" + (++winSeq);
    if (m) winSeq = Math.max(winSeq, +m[1]);
    var dw = TSU_DESK.createWindow({ id: id, app: "win", name: "终端", content: content, className: "termwin", width: 900, height: 600, menus: termMenus, appMenu: appMenu, title: function () { var t = wins.find(function (w) { return w.id === id; }); return t && t.ws.active ? t.ws.active.title() : "终端"; } });
    // 结构同 #win：.body 里直接是 .tabs 与 .panes
    var body = dw.el.querySelector(".body");
    body.appendChild(content.querySelector(".tabs"));
    body.appendChild(content.querySelector(".panes"));
    content.remove();
    var toggleBtn = document.createElement("button");
    toggleBtn.className = "term-toggle";
    toggleBtn.title = "终端外观";
    dw.el.querySelector(".bar").appendChild(toggleBtn);
    toggleBtn.addEventListener("click", cycleTermTheme);
    var tw = new TermWindow(dw.el, dw);
    tw.titleEl = dw.el.querySelector(".bar span");
    wins.push(tw);
    return tw;
  }
  function openWindow(saved, wantId) {
    var tw = makeWindow(wantId);
    tw.start(saved);
    if (tw.dw && (tw.dw.state === "closed" || tw.dw.state === "min")) tw.dw.show(); else if (tw.dw) tw.dw.front();
    persistAll();
    return tw;
  }
  // Dock 里的终端 / 启动台：有开着的终端窗口就叫到前面（最小化的先还原）；都关了就开一个新的
  function openTerminal() {
    var open = wins.filter(function (w) { return w.open; });
    if (open.length) { var w = open[open.length - 1]; if (w.dw.state === "min" || w.dw.state === "closed") w.dw.show(); else w.dw.front(); if (w.ws.active) w.ws.active.focus(); return; }
    openWindow();
  }

  // ---- 快捷键（浏览器占着 ⌘N / ⌘T / ⌘W，所以用 ⌥⌘）：只在终端是前台窗口时接管 ----
  function act(fn) { return function () { var tw = frontTerm(); if (tw) fn(tw, tw.ws.active); }; }
  var ACTIONS = {
    newWindow: { label: "新建窗口", keys: "⌥⌘N", run: function () { openWindow(); } },
    newTab: { label: "新建标签页", keys: "⌥⌘T", run: act(function (tw) { if (caNew()) return; (tw.ws.newTabUser || tw.ws.newTab)(); }) },
    splitRight: { label: "拆分窗格（左右）", keys: "⌘D", run: act(function (tw) { tw.ws.split("row"); }) },
    splitDown: { label: "拆分窗格（上下）", keys: "⇧⌘D", run: act(function (tw) { tw.ws.split("col"); }) },
    closePane: { label: "关闭窗格", keys: "⌥⌘W", run: act(function (tw) { var p = tw.ws.active; if (p) askClose([p], tw.ws.leaves(tw.ws.tab().root).length > 1 ? "窗格" : "标签页", function () { tw.ws.closePane(p); }); }) },
    closeWindow: { label: "关闭窗口", keys: "⇧⌥⌘W", run: act(function (tw) { if (tw.dw) TSU_DESK.close(tw.id); }) },
    left: { label: "选择左边的窗格", keys: "⌥⌘←", run: act(function (tw) { tw.ws.move(-1, 0); }) },
    right: { label: "选择右边的窗格", keys: "⌥⌘→", run: act(function (tw) { tw.ws.move(1, 0); }) },
    up: { label: "选择上面的窗格", keys: "⌥⌘↑", run: act(function (tw) { tw.ws.move(0, -1); }) },
    down: { label: "选择下面的窗格", keys: "⌥⌘↓", run: act(function (tw) { tw.ws.move(0, 1); }) },
    prevTab: { label: "显示上一个标签页", keys: "⇧⌘[", run: act(function (tw) { if (tw.ws.cycle) return tw.ws.cycle(-1); tw.ws.select((tw.ws.cur + tw.ws.tabs.length - 1) % tw.ws.tabs.length); }) },
    nextTab: { label: "显示下一个标签页", keys: "⇧⌘]", run: act(function (tw) { if (tw.ws.cycle) return tw.ws.cycle(1); tw.ws.select((tw.ws.cur + 1) % tw.ws.tabs.length); }) },
    clear: { label: "清除到开始", keys: "⌘K", run: act(function (tw, p) { if (p && p.program && p.program.clearScrollback) p.program.clearScrollback(); }) },
  };
  if (window.STUDIO && STUDIO.command && document.documentElement.classList.contains("termapp")) Object.keys(ACTIONS).forEach(function (k) {
    var a = ACTIONS[k], keys = window.nadosNative ? { newTab: "⌘T", closePane: "⌘W" }[k] || a.keys : a.keys;
    STUDIO.command("win." + k, { title: { newTab: "新建标签页", closePane: "关闭标签页", splitRight: "向右拆分", splitDown: "向下拆分", left: "聚焦左侧编辑器组", right: "聚焦右侧编辑器组", up: "聚焦上方编辑器组", down: "聚焦下方编辑器组", prevTab: "上一个标签页", nextTab: "下一个标签页", clear: "清屏" }[k] || a.label, keys: keys, scope: k === "clear" ? "终端" : /^(left|right|up|down|prevTab|nextTab)$/.test(k) ? "编辑器组" : "全局", run: function () { a.run(); } });
  });
  window.addEventListener("keydown", function (e) {
    if (!e.metaKey) return;
    var tw = frontTerm(), fw = window.TSU_DESK && TSU_DESK.front();
    if (!tw || (fw && fw.el !== tw.el)) return;
    if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === "KeyS") { e.preventDefault(); e.stopPropagation(); if (tw.side) tw.side.toggle(); return; } // ⌃⌘S：边栏（同 macOS）
    if (e.ctrlKey) return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key, hit = null;
    if (!e.altKey && k === "d") hit = e.shiftKey ? ACTIONS.splitDown : ACTIONS.splitRight;
    if (!e.altKey && !e.shiftKey && k === "k") hit = ACTIONS.clear;
    if (e.altKey && (k === "n" || e.code === "KeyN")) hit = ACTIONS.newWindow;
    if (e.altKey && (k === "t" || e.code === "KeyT")) hit = ACTIONS.newTab;
    if (e.altKey && (k === "w" || e.code === "KeyW")) hit = e.shiftKey ? ACTIONS.closeWindow : ACTIONS.closePane;
    if (e.shiftKey && (e.code === "BracketLeft" || e.code === "BracketRight")) hit = e.code === "BracketLeft" ? ACTIONS.prevTab : ACTIONS.nextTab;
    // App 里（浏览器不占这些键）：同 iTerm——⌘T 新标签页、⌘W 关、⌘1…⌘9 切标签页、⌘+ ⌘- ⌘0 字号
    if (window.nadosNative && !e.altKey && !e.shiftKey) {
      if (e.code === "KeyT") hit = ACTIONS.newTab;
      else if (e.code === "KeyW") hit = ACTIONS.closePane;
      else if (/^Digit[1-9]$/.test(e.code)) { e.preventDefault(); e.stopPropagation(); var n9 = +e.code.slice(5); if (tw.ws.selectInGroup) tw.ws.selectInGroup(n9 === 9 ? -1 : n9 - 1); else tw.ws.select(n9 === 9 ? tw.ws.tabs.length - 1 : n9 - 1); return; }
      else if (e.code === "Equal" || e.code === "Minus" || e.code === "Digit0") {
        e.preventDefault(); e.stopPropagation();
        var f0 = +(localStorage.getItem("tsu-font") || 12);
        TSU_APP.setFont(e.code === "Digit0" ? 12 : Math.max(10, Math.min(24, f0 + (e.code === "Equal" ? 1 : -1))));
        return;
      }
    }
    if (window.nadosNative && e.shiftKey && !e.altKey && e.code === "Equal") { e.preventDefault(); e.stopPropagation(); TSU_APP.setFont(Math.min(24, +(localStorage.getItem("tsu-font") || 12) + 1)); return; } // ⌘+（带 Shift）
    if (e.altKey && { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1 }[e.key]) hit = { ArrowLeft: ACTIONS.left, ArrowRight: ACTIONS.right, ArrowUp: ACTIONS.up, ArrowDown: ACTIONS.down }[e.key];
    if (e.altKey && /^Digit[1-9]$/.test(e.code)) { e.preventDefault(); tw.ws.select(+e.code.slice(5) - 1); return; }
    if (hit) { e.preventDefault(); e.stopPropagation(); hit.run(); }
  }, true);

  // ---- Paimon Terminal：从访达拖文件进来 = 把路径贴进鼠标下面那个终端（转义好、后面带个空格，同「终端」）；agent 的输入框里就插进去 ----
  if (window.nadosNative && nadosNative.local) nadosNative.on("drop.paths", function (d) {
    if (!d || !d.paths || !d.paths.length) return;
    var el = document.elementFromPoint(d.x, d.y), p = el && allPanes().filter(function (x) { return x.el.contains(el); })[0], tw = frontTerm();
    if (!p && tw) p = tw.ws.active;
    if (!p) return;
    p.win.ws.activate(p);
    p.focus();
    if (p.program === p.shell && p.shell.paste) p.shell.paste(d.paths.map(shellEscape).join(" ") + " ");
    else if (p.ta) {
      // 图片：现在就读进来当附图（同粘贴的截图）——截图缩略图拖进来的是系统临时目录（TemporaryItems）里的文件，只有接住这次拖的 App 读得到、
      //   过一会儿还会被删：只贴路径的话 agent 读不到（Operation not permitted）。读不了的、别的文件照旧插路径
      var IMGX = /\.(png|jpe?g|gif|webp|heic|heif|tiff?|bmp)$/i, prog = p.program, LX = window.TSU_LOCAL;
      var imgs = prog && prog.attachFile && LX && LX.read ? d.paths.filter(function (x) { return IMGX.test(x); }) : [];
      var rest = d.paths.filter(function (x) { return imgs.indexOf(x) < 0; });
      var ins = function (t) { p.ta.focus(); document.execCommand("insertText", false, t + " "); };
      p.ta.focus();
      imgs.forEach(function (path) {
        LX.read(path, { access: "user" }).then(function (buf) {
          var ext = ((/\.(\w+)$/.exec(path) || [])[1] || "png").toLowerCase(), type = ext === "jpg" ? "image/jpeg" : /^tiff?$/.test(ext) ? "image/tiff" : "image/" + ext;
          if (!buf || !buf.byteLength) return ins(path);
          prog.attachFile(new File([buf], path.split("/").pop(), { type: type }), function () { ins(path); });
        }, function () { ins(path); });
      });
      if (rest.length) ins(rest.join(" "));
    }
  });

  // ---- 菜单栏：经典终端的菜单（外壳 / 编辑 / 显示 / 窗口 / 帮助）；agent 的东西都在 agent 自己的 / 命令里 ----
  function item(a) { return { label: a.label, keys: a.keys, run: a.run }; }
  function termMenus() {
    var tw = frontTerm(), p = tw && tw.ws.active, fontNow = +(localStorage.getItem("tsu-font") || 12);
    return [
      { title: "外壳", items: [item(ACTIONS.newWindow), item(ACTIONS.newTab), { sep: true }, item(ACTIONS.splitRight), item(ACTIONS.splitDown), item(ACTIONS.closePane), { sep: true },
        item(ACTIONS.closeWindow), { sep: true },
        { label: "导出文本为…", keys: "", run: function () { if (!p || !p.program || !p.program.exportText) return; var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([p.program.exportText()], { type: "text/plain" })); a.download = "终端-" + fileStamp() + ".txt"; a.click(); } }] },
      { title: "编辑", items: [
        { label: "复制", keys: "⌘C", run: function () { document.execCommand("copy"); } },
        { label: "粘贴", keys: "⌘V", run: function () { if (p) p.focus(); if (navigator.clipboard) navigator.clipboard.readText().then(function (t) { document.execCommand("insertText", false, t); }, function () {}); } },
        { label: "全选", keys: "⌘A", run: function () { if (!p) return; var r = document.createRange(); r.selectNodeContents(p.out); var s = getSelection(); s.removeAllRanges(); s.addRange(r); } },
        { sep: true }, item(ACTIONS.clear),
        { label: "中断", keys: "⌃C", run: function () { if (p && p.program && p.program.interrupt) p.program.interrupt(); } }] },
      { title: "显示", items: [
        { label: tw && tw.side && tw.side.shown() ? "隐藏边栏" : "显示边栏", keys: "⌃⌘S", run: function () { if (tw && tw.side) tw.side.toggle(); } },
        { label: tw && !tw.tabsEl.hidden ? "隐藏标签页栏" : "显示标签页栏", keys: "", run: function () { if (!tw) return; tw.showTabs = tw.tabsEl.hidden; tw.ws.syncTitles(); allPanes().forEach(function (x) { x.renderLater(); }); } },
        { sep: true },
        { label: "放大", keys: "⌘+", run: function () { TSU_APP.setFont(Math.min(20, fontNow + 1)); } },
        { label: "缩小", keys: "⌘-", run: function () { TSU_APP.setFont(Math.max(10, fontNow - 1)); } },
        { label: "默认字体大小", keys: "", run: function () { TSU_APP.setFont(12); } },
        { sep: true },
        { label: "外观：" + { auto: "跟随系统", light: "浅色", dark: "深色" }[termPref()], keys: "", run: cycleTermTheme }] },
      { title: "窗口", items: [item(ACTIONS.prevTab), item(ACTIONS.nextTab), { sep: true }, item(ACTIONS.left), item(ACTIONS.right), item(ACTIONS.up), item(ACTIONS.down)] },
      { title: "帮助", items: [{ label: "终端使用手册", keys: "", run: function () { if (!p) return; if (p.program === p.shell) { p.ta.value = "help"; p.program.key({ key: "Enter", preventDefault: function () {} }); } else p.program.command("/help"); } }] },
    ];
  }
  function appMenu() {
    return [{ label: "关于终端", keys: "", run: function () { if (TSU_DESK.alert) TSU_DESK.alert({ title: "终端", message: "code.paimon.beer · v" + A.SPIRIT.version + "\n在 Shell 中输入 paimon 以开始与 AI Agent 对话。", icon: "app", buttons: [{ label: "好", role: "default" }] }); } }];
  }
  function cycleTermTheme() {
    var n = { auto: "light", light: "dark", dark: "auto" }[termPref()];
    if (n === "auto") localStorage.removeItem("tsu-term"); else localStorage.setItem("tsu-term", n);
    syncToggles();
    allPanes().forEach(function (p) { p.renderNow(); });
  }
  function syncToggles() {
    var p = termPref(), glyph = p === "auto" ? "◐" : p === "light" ? "☀" : "☾";
    document.querySelectorAll("#toggle, .term-toggle").forEach(function (b) { b.textContent = glyph; });
    wins.forEach(function (w) { w.el.classList.toggle("tl", termLight()); if (w.side) w.side.render(true); });
  }

  // ---- Studio 的设置窗口（/config、⌘,）：终端、Paimon、视图、快捷键这几区（Claude Code 那区在 studio.js）----
  if (window.STUDIO) {
    var C = function () { return A.cfg; };
    var redraw = function () { allPanes().forEach(function (p) { p.renderNow(); }); };
    STUDIO.addSettings("terminal", {
      title: "终端", icon: "›_", order: 10, desc: "长行、时间格式、侧栏、滚动与选中即复制",
      fields: function (tw) {
        var c = C();
        return [
          // 长行、时间格式：很少有人要动——在左边的「高级」里（换行叫「自动换行」）
          // 下面一小块示例：选的这一种画出来是什么样（抽象的两项光看名字想不出来）
          { key: "wrap", label: "长行（代码、diff、输出）", page: "advanced", kind: "seg", options: [["wrap", "自动换行"], ["clip", "截断"]], value: c.wrap,
            after: function () { var ln = '<i class="dn">12</i> <i class="da">+</i> ', code = "const total = items.reduce((sum, x) =&gt; sum + x.price * x.qty, 0);";
              return '<div class="ss-demo">' + (c.wrap === "clip" ? ln + "const total = items.reduce((sum, x) =&gt; sum + x.pr…" : ln + "const total = items.reduce((sum, x) =&gt;\n" + '<i class="dn">  </i>   ' + "  sum + x.price * x.qty, 0);") + "</div>"; void code; } },
          { key: "time", label: "时间格式", page: "advanced", kind: "seg", options: [["12h", "12 小时"], ["24h", "24 小时"]], value: c.time,
            after: function () { return '<div class="ss-demo"><i class="dd">✻ Brewed for 2m 14s · done ' + (c.time === "24h" ? "15:07" : "3:07 PM") + "</i></div>"; } },
          { head: "行为" }, // 主侧栏、辅助侧栏开没开是眼前的视图（⌘B、⌥⌘I、标题栏右边的开关），不是设置——不放这里
          // 两项都用分段的选块（开 / 关），默认的那个写「（默认）」
          { key: "autoscroll", label: "自动滚动", desc: "有新内容时自动滚动到底部（向上翻阅时不滚动）", kind: "seg", options: [["on", "开（默认）"], ["off", "关"]], value: c.autoscroll !== false ? "on" : "off", def: "on" },
          { key: "copyOnSelect", label: "选中即复制", desc: "选中文字时自动复制到剪贴板", kind: "seg", options: [["on", "开（默认）"], ["off", "关"]], value: c.copyOnSelect !== false ? "on" : "off", def: "on" },
          // 往上翻时最上面一行挂着所在的那一问（同 Claude Code）：只在「高级」里
          { key: "stickyPrompt", label: "往上翻时显示所在的那一问", desc: "向上翻阅对话时，最上面一行显示这一段属于哪一问；点按跳到那一问", page: "advanced", kind: "seg", options: [["on", "开（默认）"], ["off", "关"]], value: c.stickyPrompt !== false ? "on" : "off", def: "on" },
        ];
      },
      change: function (k, v, tw) {
        if (k === "theme") return TSU_APP.setTermTheme(v);
        if (k === "font") return TSU_APP.setFont(+v);
        if (k === "side") return tw && tw.side && tw.side.toggle(!!v);
        if (k === "insp") return tw && STUDIO.toggle(tw, !!v);
        if (k === "autoscroll" || k === "copyOnSelect" || k === "stickyPrompt") v = v === "on" || v === true; // 选块给的是 on / off
        if (A.setCfg(k, v)) redraw();
      },
    });
    var paimonAgent = function (tw) { var p = tw && tw.ws.active; return p && p.program && p.program.agentId ? A.get(p.program.agentId) : null; };
    STUDIO.addSettings("paimon", {
      title: "Paimon Code", icon: "✦", order: 20, desc: "当前 Agent 的模型、推理强度和可用工具",
      fields: function (tw) {
        var c = C(), ag = paimonAgent(tw), out = [];
        if (ag) {
          out.push({ head: ag.name });
          var ms = A.models().slice(0, 8).map(function (m) { return [m.id, m.name]; });
          if (ms.length) out.push({ key: "model", label: "模型", kind: "seg", options: ms, value: (A.modelOf(ag.model) || {}).id });
          out.push({ key: "effort", label: "推理强度", kind: "slider", options: A.EFFORTS.map(function (e) { return [e, { off: "关", low: "低", high: "高", max: "最高" }[e] || e]; }), value: ag.effort || "high" });
        }
        return out.concat([
          { head: "工具" },
          { key: "webSearch", label: "联网搜索", desc: "允许 Agent 使用 web_search", kind: "toggle", value: c.webSearch !== false, def: true },
          { key: "webFetch", label: "网页抓取", desc: "允许 Agent 使用 WebFetch 读取网页", kind: "toggle", value: c.webFetch !== false, def: true },
          { key: "sandbox", label: "Bash 与文件", desc: "允许 Agent 运行命令、读写文件", kind: "toggle", value: c.sandbox !== false, def: true },
          { head: "其他" },
          { key: "recap", label: "回顾", desc: "离开 30 分钟后返回时显示回顾（※ recap）", kind: "toggle", value: c.recap !== false, def: true },
          { key: "tips", label: "输入框提示", desc: "在输入框中显示提示", kind: "toggle", value: c.tips !== false, def: true },
        ]);
      },
      change: function (k, v, tw) {
        var ag = paimonAgent(tw);
        if (k === "model" && ag) return A.runtime(ag.id).setModel(v);
        if (k === "effort" && ag) return A.runtime(ag.id).setEffort(v);
        if (A.setCfg(k, v)) redraw();
      },
    });
    // 对话：显示什么、怎么显示（消息、思考、每类工具的调用与结果……）。当前标签页交出了自己的「视图」元素就用它的（多了任务清单、状态行放哪；
    // Claude Code 的会话是它那几样），没有就是这张通用的表——右侧栏里的同一份
    var viewEl = function (tw) { var p = tw && tw.ws.active; return p && p.els && p.els.view; };
    STUDIO.addSettings("view", {
      title: "对话", icon: "◧", order: 25, desc: "设置对话中显示的内容：消息、思考，以及各类工具的调用与结果",
      fields: function (tw) { var el = viewEl(tw); return el ? el.fields() : convFields(null); },
      change: function (k, v, tw) { var el = viewEl(tw); if (el) el.change(k, v); else convChange(k, v); },
      // 「按工具…」：一个菜单列出所有会话里出现过的工具，每个一档（··· 菜单里的只列那个 agent 的）
      action: function (what, tw) {
        if (what === "invert") return invertGlobal(); // 反选（设置是全局的：改编辑区的设置）
        if (what !== "bytool" || !STUDIO.menu) return;
        var ae = document.activeElement;
        var b = ae && ae.closest ? ae.closest('[data-sact="bytool"]') : null;
        b = b || document.querySelector('.ss-btn[data-sact="bytool"]');
        STUDIO.menu(function () { return byToolItems(null); }, b ? { el: b, side: "below-end" } : { x: Math.round(innerWidth / 2), y: 120 }); // 设置是全局的：列所有会话里出现过的
      },
    });
  }
  window.TSU_APP = {
    // 终端的外观：auto（跟随系统）/ light / dark
    setTermTheme: function (m) { if (m === "auto") localStorage.removeItem("tsu-term"); else localStorage.setItem("tsu-term", m); syncToggles(); allPanes().forEach(function (p) { p.renderNow(); }); },
    menus: termMenus,
    appMenu: appMenu,
    forceQuit: function () { wins.forEach(function (w) { if (w.open) w.dispose(); }); },
    help: function () { var tw = frontTerm(); if (tw && tw.ws.active && tw.ws.active.program.command) tw.ws.active.program.command("/help"); },
    setTheme: function (mode) {
      // Studio 里（macOS 风格的控制中心、菜单）：深色 / 浅色 / 自动 = 换配色方案（同一套的深浅两种），整个界面、终端、对话一起变——不能只换外壳的底色
      if (window.STUDIO && STUDIO.setv && STUDIO.get && root.classList.contains("termapp")) {
        var PAIR = { "dark-gray": "light-gray", "light-gray": "dark-gray", "paimon-dark": "paimon-light", "paimon-light": "paimon-dark", "solarized-dark": "solarized-light", "solarized-light": "solarized-dark" };
        var cur = STUDIO.get("colorScheme"), isLight = STUDIO.scheme && STUDIO.scheme().type === "light", next;
        if (mode === "auto") next = "auto";
        else if ((mode === "light") === isLight && cur !== "auto") next = cur;
        else next = typeof cur === "string" && PAIR[cur] ? PAIR[cur] : mode === "light" ? "light-gray" : "dark-gray";
        if (next !== cur) STUDIO.setv("colorScheme", next);
        syncToggles();
        return;
      }
      if (mode === "auto") localStorage.removeItem("tsu-theme"); else localStorage.setItem("tsu-theme", mode);
      root.classList.toggle("light", mode === "auto" ? matchMedia("(prefers-color-scheme: light)").matches : mode === "light");
      syncToggles();
      allPanes().forEach(function (p) { p.renderLater(); });
      document.dispatchEvent(new Event("tsu-theme"));
    },
    // 字号：⌘+ / ⌘- / ⌘0 和设置里的「字号」是同一个值——一起存进设置（studio.json），下次打开直接用这个字号（不再先用标准字号、读到设置后又缩放一次）
    setFont: function (px) { px = +px || 12; localStorage.setItem("tsu-font", px); localStorage.setItem("tsu-font-at", String(Date.now())); allPanes().forEach(function (p) { p.setFont(px); }); document.dispatchEvent(new CustomEvent("tsu-font", { detail: px })); if (window.STUDIO && STUDIO.get && STUDIO.setv && +STUDIO.get("fontSize") !== px) STUDIO.setv("fontSize", px); },
    setTps: function () {},
    tps: 0,
  };
  window.TSU_TERM = {
    open: function (path) { var tw = frontTerm() || openWindow(); var p = tw.ws.newTab({ sh: { cwd: path && window.SANDBOX && SANDBOX.isDir(path) ? path : "/home/user" } }); return p; },
    run: function (cmd, cwd) {
      var p = window.TSU_TERM.open(cwd);
      setTimeout(function () {
        if (p.program && p.program.pty && p.program.type) p.program.type(cmd + "\r"); // 真终端：等提示符出来再敲
        else if (p.program === p.shell) { p.ta.value = cmd; p.program.key({ key: "Enter", preventDefault: function () {} }); }
      }, 50);
    },
    agent: function (id) { var hit = focusAgent(id); if (hit) return hit; var tw = frontTerm() || openWindow(); var p = tw.ws.newTab(); p.run(makeView(p, id)); return p; }, // 开着的就跳过去（每条开的路都只有一个）
    dragInfo: function () { return { on: DRAG.on, why: DRAG.why || "" }; }, // 拖拽的状态、最近一次怎么结束的（排查、自测用）
    // 新窗口；给了文件夹就从那里开始（访达右键「服务 → 新建位于文件夹位置的终端窗口」）
    openWindow: function (path) {
      var ok = path && window.SANDBOX && SANDBOX.isDir(path);
      return openWindow(ok ? { cur: 0, tabs: [{ root: { p: { sh: { cwd: path } } }, active: 0 }] } : undefined);
    },
    // browser.js（Paimon Terminal 的地址栏、标签页概览、主页、历史记录）要用的
    front: frontTerm, panes: allPanes, wins: function () { return wins; }, baseXterm: baseXterm, termLight: termLight,
    agentView: function (P, id) { return new AgentView(P, id); }, // 右侧栏里那份：终端界面
    makeView: function (P, id) { return makeView(P, id); }, applyUI: applyUI,
    // 没发出去的字（终端界面、图形界面共用一份）：draft(id) 读、draft(id, 字) 存
    draft: function (id, text) { if (text === undefined) { var d = draftsMap()[id]; return d ? d.text : ""; } draftSet(id, text); },
    setUI: function (P, ui) { if (window.STUDIO && STUDIO.setv) STUDIO.setv("ui", ui); },
    // 右侧栏里的对话（studio.js 放进右侧栏；跟着编辑区当前的 agent 换）
    sidePane: function (tw) { if (!tw.sidePane) tw.sidePane = new Pane(tw, { side: true }); return tw.sidePane; },
    // 全局助手（globalagent.js）自己那一块：不跟着编辑区换 agent，辅助侧栏「全局」、Claude App 的卡片都挂它
    globalPane: function (tw) { if (!tw.globalPane) tw.globalPane = new Pane(tw, { side: true }); return tw.globalPane; },
    kinds: KINDS,
    // 对话显示的分法（右侧栏的 ··· 用同一套；图形界面、快速查看按同样的档位画）
    sideKinds: sideKindItems, convMenu: convMenu, agentMenu: agentMenu, footH: footHOf, setFootH: setFootH, transcriptMenu: transcriptMenu, transcriptCtx: transcriptCtx, agentTabActions: agentTabActions, byToolItems: byToolItems, toolsSeen: toolsSeen,
    tsFmt: tsFmt, dayKey: dayKey, dayLabel: dayLabel, turnTime: turnTime, // 时间戳（图形界面也用）
    viewMode: function (k, view) { var c = isFull(view) ? vcv(view, k) : cv(k); return c === undefined ? VMODES[k] : c; }, // 带预览的当前值（图形界面用：指着菜单时一起变；拆出来的一格按它自己的）
    toolMode: function (p, view) { return toolModeIn(view || null, p); },
    agentMode: function (k, view) { return agentModeIn(view || null, k); }, // Agent 消息的一种（agentIn / agentOut / agentReports）按哪一档：full / line / hidden
    // 同一个标签页拆成几格（vsplit.js）：拆出来的格是一个不带输入框的面板；每格的筛选、预设、反选
    mirrorPane: function (P) { return new Pane(P.win, { side: true }); },
    viewAcc: viewAcc, filterFields: filterFields, accGlobal: accGlobal,
    presets: { list: function () { return PRESETS.concat(userPresets()); }, builtin: PRESETS, follow: FOLLOW, defaultFor: presetFor, user: userPresets, save: saveUserPresets, of: presetOf, view: viewOfPreset, name: viewName, snap: snapView, invert: invertView, isFull: isFull },
    askClose: askClose, openLink: openLink, openUrl: openUrl, shellEscape: shellEscape, ago: agoCN, dur: durCN, status: agentStatus, lastTabs: function () { return lastTabs(); }, closedTabs: function () { return closedList(); }, reopenClosed: reopenClosed, reopenLast: function () { return reopenLast(); },
    action: function (name) { if (ACTIONS[name]) ACTIONS[name].run(); },
  };
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", function (e) { if (!localStorage.getItem("tsu-theme")) { root.classList.toggle("light", e.matches); syncToggles(); allPanes().forEach(function (p) { p.renderLater(); }); } });
  // Claude Code 扩展装上 / 卸掉：树、菜单马上跟着变；卸掉时它的标签页（会话记录、主页）都关掉
  if (window.TSU_EXT) TSU_EXT.watch(function (id, on) {
    if (id === "paimon") return wins.forEach(function (w) { if (w.open && w.side) w.side.render(true); }); // Paimon Code 开关：侧栏里那一区跟着有 / 没有（开着的标签页不关）
    if (id !== "claude-code" && id !== "codex") return;
    var mine = id === "codex" ? cxSpec : ccSpec;
    wins.forEach(function (w, wi) {
      if (!w.open) return;
      if (!on) w.ws.all().slice().forEach(function (p) { var sp = p.spec(); if (mine(sp)) { ccStash(sp); w.ws.closePane(p); } });
      if (on && wi === 0) { var l = ccStash(), back = l.filter(mine); localStorage.setItem("tsu-cc-stash", JSON.stringify(l.filter(function (sp) { return !mine(sp); }))); back.forEach(function (sp) { w.ws.newTab({ agent: sp.agent, page: sp.page, arg: sp.arg }); }); } // 开了：收着的（这个连接器的）标签页接着打开
      if (w.side) { if (on && w.side.refreshCC) w.side.refreshCC(true); w.side.render(true); }
    });
  });
  // agent 的通知被点了：开一个接上它的标签页
  A.on(function (type, id) { if (type === "open" && id) window.TSU_TERM.agent(id); });

  // ---- 启动：等字体、agent 数据；恢复上次的窗口（旧版布局里存的是会话 id：换成那个会话的 agent）----
  // agent 数据、登录状态（/api/me）同时要，不排队（线上每个请求一个来回）；resumeAll 等两样都好了才跑，谁后到谁叫
  var ready = (document.fonts ? document.fonts.ready : Promise.resolve()).then(function () { return Promise.all([A.ready(), A.refreshMe()]); });
  var restored = ready.then(function () {
    var first = new TermWindow(document.getElementById("win"), window.TSU_DESK && TSU_DESK.apps && TSU_DESK.apps.win);
    wins.push(first);
    document.getElementById("toggle").addEventListener("click", cycleTermTheme);
    if (window.TSU_DESK) {
      TSU_DESK.registerApp({ id: "win", name: "终端", open: openTerminal });
      var dockTerm = document.querySelector('#dock [data-app="win"]');
      if (dockTerm) draggable(dockTerm, function () { return { kind: "new" }; }, "＋ 新建面板");
      var dw0 = TSU_DESK.apps.win;
      if (dw0) { dw0.menus = termMenus; dw0.appMenu = appMenu; }
    }
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem("tsu-termwins" + WSUF) || "null"); } catch (e) { saved = null; }
    if (TSU_WIN.open) { try { saved = { wins: [{ id: "win", ws: { v: 2, grid: { e: [JSON.parse(TSU_WIN.open)], i: 0 }, g: 0 } }] }; } catch (e) { /* 坏了就照常 */ } } // 拖出来的标签页：新窗口里只有它
    else if (TSU_WIN.fresh) saved = null; // 新建窗口（⇧⌘N）：空的，不接上次这个窗口号记的
    if (!saved && !WSUF) {
      var old = null;
      try { old = JSON.parse(localStorage.getItem("tsu-layout") || "null"); } catch (e) { old = null; }
      if (old && old.tabs) {
        var sess = {}; A.allSessions().forEach(function (s) { sess[s.id] = s; });
        var conv = function (n) { if (n.s !== undefined) { var s = sess[n.s]; return { p: s ? { agent: s.agentId, sh: { cwd: "/home/user" } } : { sh: { cwd: "/home/user" } } }; } return { dir: n.dir, ratio: n.ratio, a: conv(n.a), b: conv(n.b) }; };
        saved = { wins: [{ id: "win", ws: { cur: old.cur || 0, tabs: old.tabs.map(function (t) { return { root: conv(t.root), active: 0 }; }) } }] };
      }
    }
    // 记过（哪怕是「全关了」）就照记的来；第一次来才默认开一个终端（刷新不重开用户关掉的窗口）。
    // 每个窗口按记下的 id 建回来（桌面按 id 摆回原来的位置）：页面里的 #win 接 id 是 win 的那个；
    // 记的里没有它、它又开着（以前没记桌面的时候）就接第一个
    var list = saved && Array.isArray(saved.wins) ? saved.wins : [{ id: "win", ws: null }];
    var winClosed = first.dw && first.dw.state === "closed";
    var mine = list.find(function (sw) { return sw.id === "win"; }) || (!winClosed && list[0]) || null;
    if (!mine && root.classList.contains("termapp")) mine = { id: "win", ws: null }; // App 里只有这一个窗口：记的是「全关了」也要开（空的编辑区，同 VS Code），不然整个窗口是空白
    if (mine) { first.start(mine.ws); if (first.dw && winClosed) first.dw.show(); }
    else if (first.dw && !winClosed && window.TSU_DESK && TSU_DESK.close) TSU_DESK.close(first.id); // 上次终端全关了：页面里那个也不开
    list.forEach(function (sw) { if (sw !== mine) openWindow(sw.ws, sw.id); });
    setTimeout(function () { try { autoReopen(); } catch (e) { setTimeout(function () { throw e; }, 0); } }, 1500);
    syncToggles();
    A.refreshMe().then(function () { var tw = frontTerm(); if (tw && tw.ws.active) tw.ws.active.focus(); });
  });
  // 窗口都建回来了：整个界面淡入（terminal.html 的 TSU_BOOT；之前一直是 App 的底色）。出错了也要露出来
  //   还要等设置文件读过一次（字号、配色照文件里的）——不然露出来以后才换，看得见字号跳一下；最多等 0.9 秒
  //   开着的 Claude Code 会话也等它读完第一段（claude.js 的 TSU_CC_BOOT）再露出来——最多 2.5 秒，读得慢的就先露出来接着读
  var bootShow = function () {
    var sr = window.STUDIO && STUDIO.settingsReady ? STUDIO.settingsReady() : null, cap = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var cc = function () { return Promise.all((window.TSU_CC_BOOT || []).map(function (p) { return Promise.resolve(p).catch(function () {}); })); };
    Promise.all([Promise.race([sr || Promise.resolve(), cap(900)]), Promise.race([cap(0).then(cc), cap(2500)])]).then(function () { if (window.TSU_BOOT) TSU_BOOT.done(); });
  };
  restored.then(bootShow, bootShow);
  // 桌面等终端窗口都建回来再排叠放（desk.js 在这个文件后面才载入：等页面脚本都跑完再交）
  document.addEventListener("DOMContentLoaded", function () { if (window.TSU_DESK && TSU_DESK.holdRestore) TSU_DESK.holdRestore(restored); });
})();
