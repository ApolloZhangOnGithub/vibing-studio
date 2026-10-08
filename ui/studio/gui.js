// gui.js —— 界面外壳（wrapper）之二：图形界面。agent 在跑什么（运行时：Paimon Code 的 agent、Claude Code 的会话）和怎么显示（外壳）分开，
// 同一个运行时可以换着用不同的外壳：终端界面（live.js 的 AgentView，同 Claude Code 的 TUI）、图形界面（这里，同 Claude App 的 Code）。
//   对话：你的话是右边的气泡；回答按 Markdown 排版；连着的几次工具调用并成一组（使用了 N 个工具 / 运行了 N 条命令，失败的标红），点开看每一个，
//   Bash 是一张卡片（命令、输出）；思考折起来；出错一行红字
//   输入：圆角输入框（回车发送、⇧回车换行、Esc 打断）；下面一排：附件、权限、模型、推理强度、上下文用量；/ 打开命令菜单
// 运行时的接口同 live.js 的 AgentView 用的：on、session()、stream、state()、todo()、model()、ctx()、send()、interrupt()、setModel()……
(function () {
  "use strict";
  var GUI_BLUR = false; // 点外面让输入框失焦的监听只挂一次（整个页面一个）
  var A = window.TSU_AGENTS;
  if (!A) return;
  // 浮层的最上面一层：输入框那一列搬进 Studio 面板时，按钮上的浮层放这里（面板会裁掉超出去的）。带 .gv：颜色变量同对话里；占满窗口、不挡点击（gui.css .gv-float）
  var floatEl = null;
  function floatLayer() { if (!floatEl || !floatEl.isConnected) { floatEl = document.createElement("div"); floatEl.className = "gv gv-float"; document.body.appendChild(floatEl); } return floatEl; }
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var base = function (p) { p = String(p || ""); return p.slice(p.lastIndexOf("/") + 1) || p; };
  var clip = function (s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  var dur = function (ms) { var s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + " 秒" : Math.floor(s / 60) + " 分 " + (s % 60) + " 秒"; };
  var EN = function () { return document.documentElement.getAttribute("data-lang") === "en"; };
  // 用时（紧凑）：一组的总时长、每一条自己的
  var durC = function (ms) { var s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60); return EN() ? (h ? h + "h " + (m % 60) + "m" : m ? m + "m " + (s % 60) + "s" : s + "s") : (h ? h + " 小时 " + (m % 60) + " 分" : m ? m + " 分 " + (s % 60) + " 秒" : s + " 秒"); };
  // 工具的类：一组的汇总按类数（运行了 12 条命令、读取了 3 个文件……），缩略图按类上色
  function kindOf(n) {
    n = String(n || "");
    if (/^(Bash|BashOutput|KillShell|KillBash|exec_command|write_stdin|shell)$/.test(n)) return "bash";
    if (/^(Read|NotebookRead|LS|view_image)$/.test(n)) return "read";
    if (/^(Glob|Grep|ToolSearch)$/.test(n)) return "search";
    if (/^(Edit|MultiEdit|Write|NotebookEdit|apply_patch)$/.test(n)) return "edit";
    if (/^(WebFetch|WebSearch|web_search)$/.test(n)) return "web";
    if (/^(Agent|Task|spawn_agent)$/.test(n)) return "agent";
    if (/^(Task(Create|Update|List|Get|Output|Stop)|TodoWrite|update_plan)$/.test(n)) return "task";
    if (/^mcp__/.test(n)) return "mcp";
    return "other";
  }
  var KIND_TXT = {
    bash: [["运行了 ", " 条命令", "正在运行 "], ["Ran ", "command", "Running "]], read: [["读取了 ", " 个文件", "正在读取 "], ["Read ", "file", "Reading "]],
    search: [["搜索了 ", " 次", "正在搜索 "], ["Searched ", "time", "Searching "]], edit: [["编辑了 ", " 个文件", "正在编辑 "], ["Edited ", "file", "Editing "]],
    web: [["读取了 ", " 个网页", "正在读取 "], ["Fetched ", "page", "Fetching "]], agent: [["运行了 ", " 个子 Agent", "正在运行 "], ["Ran ", "agent", "Running "]],
    task: [["更新了 ", " 次任务清单", "正在更新 "], ["Updated tasks ", "time", "Updating tasks "]], mcp: [["调用了 ", " 次 MCP 工具", "正在调用 "], ["Called ", "MCP tool", "Calling "]],
    other: [["使用了 ", " 个工具", "正在使用 "], ["Used ", "tool", "Using "]]
  };
  function sumText(list, live) {
    var c = {}, order = [];
    list.forEach(function (p) { var k = kindOf(p.name); if (!c[k]) { c[k] = 0; order.push(k); } c[k]++; });
    var en = EN();
    return order.map(function (k, i) {
      var T = KIND_TXT[k][en ? 1 : 0], n = c[k], verb = live && i === order.length - 1 ? T[2] : T[0];
      if (en) { var noun = k === "task" && !live ? "" : n + " " + T[1] + (n === 1 ? "" : "s"); verb = i ? verb.charAt(0).toLowerCase() + verb.slice(1) : verb; return k === "task" ? (i ? "updated tasks" : "Updated tasks") + (n > 1 ? " ×" + n : "") : verb + noun; }
      return verb + n + T[1];
    }).join(en ? ", " : "、");
  }

  var ICON = {
    copy: '<svg viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 3.6V3.4A1.9 1.9 0 0 0 8.6 1.5H3.9A1.9 1.9 0 0 0 2 3.4v4.7a1.9 1.9 0 0 0 1.9 1.9h.2"/></svg>',
    check: '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>',
    ret: '<svg viewBox="0 0 16 16"><path d="M12.5 3.5v4.1a2.1 2.1 0 0 1-2.1 2.1H3.8"/><path d="M6.6 6.7L3.6 9.7l3 3"/></svg>',
    stop: '<svg viewBox="0 0 16 16"><rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.6"/></svg>',
    down: '<svg viewBox="0 0 16 16"><path d="M4 6.2l4 4 4-4"/></svg>',
  };
  // 代码块的「复制」（对话里、资源管理器的 Markdown 预览里都有）：复制完换成 ✓ 一会儿
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".gv-copy");
    if (!b) return;
    var pre = b.parentNode.querySelector("pre"), text = pre ? pre.innerText.replace(/\n$/, "") : "";
    var done = function () { b.innerHTML = ICON.check; b.classList.add("ok"); clearTimeout(b._t); b._t = setTimeout(function () { b.innerHTML = ICON.copy; b.classList.remove("ok"); }, 1200); };
    var fallback = function () { var t = document.createElement("textarea"); t.value = text; t.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (x) {} t.remove(); done(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  });

  // ---- Markdown → HTML（回答用）：代码块（按语言高亮）、标题、列表、引用、表格、分隔线；行内的代码、粗体、斜体、删除线、链接 ----
  function inline(s) {
    var codes = [];
    s = esc(s).replace(/`([^`]+)`/g, function (m, c) { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/__([^_]+)__/g, "<b>$1</b>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>").replace(/~~([^~]+)~~/g, "<s>$1</s>");
    return s.replace(/\u0000(\d+)\u0000/g, function (m, i) { return "<code>" + codes[+i] + "</code>"; });
  }
  function codeHtml(text, lang) {
    var H = window.TSU_HL, L = H && (H.LANG[{ js: "javascript", ts: "typescript", sh: "shell", bash: "shell", zsh: "shell", py: "python", yml: "yaml", md: "markdown" }[lang] || lang] || null);
    if (!L) return esc(text);
    var st = "";
    return text.split("\n").map(function (l) { var r = H.line(l, st, L); st = r[1]; return r[0]; }).join("\n");
  }
  function md(src) {
    var lines = String(src || "").replace(/\r/g, "").split("\n"), out = [], i = 0, para = [];
    var flush = function () { if (para.length) { out.push("<p>" + para.map(inline).join("<br>") + "</p>"); para = []; } };
    while (i < lines.length) {
      var l = lines[i], m;
      if ((m = /^\s*(```|~~~)\s*([\w+-]*)/.exec(l))) {
        flush();
        var fence = m[1], lang = m[2].toLowerCase(), buf = [];
        i++;
        while (i < lines.length && lines[i].trim().indexOf(fence) !== 0) buf.push(lines[i++]);
        i++;
        out.push('<div class="gv-codebox"><button class="gv-copy" title="复制">' + ICON.copy + '</button><pre class="gv-code"' + (lang ? ' data-lang="' + esc(lang) + '"' : "") + "><code>" + codeHtml(buf.join("\n"), lang) + "</code></pre></div>");
        continue;
      }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { flush(); out.push("<h" + m[1].length + ">" + inline(m[2]) + "</h" + m[1].length + ">"); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out.push("<hr>"); i++; continue; }
      if (/^\s*>/.test(l)) { flush(); var q = []; while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, "")); out.push("<blockquote>" + md(q.join("\n")) + "</blockquote>"); continue; }
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        flush();
        var cells = function (r) { return r.trim().replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); }); };
        var head = cells(l), rows = [];
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push("<table><thead><tr>" + head.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table>");
        continue;
      }
      if ((m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l))) {
        flush();
        var ordered = /\d/.test(m[2]), items = [], ind = m[1].length;
        while (i < lines.length && (m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])) && m[1].length >= ind) {
          if (m[1].length > ind && items.length) { var sub = []; while (i < lines.length && /^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) && /^\s*/.exec(lines[i])[0].length > ind) sub.push(lines[i++].slice(ind + 2)); items[items.length - 1] += md(sub.join("\n")); continue; }
          var t = m[3], task = /^\[( |x|X)\]\s+(.*)$/.exec(t);
          items.push(task ? '<span class="gv-task' + (task[1] !== " " ? " done" : "") + '"></span>' + inline(task[2]) : inline(t));
          i++;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i])) items[items.length - 1] += "<br>" + inline(lines[i++].trim());
        }
        out.push((ordered ? "<ol>" : "<ul>") + items.map(function (x) { return "<li>" + x + "</li>"; }).join("") + (ordered ? "</ol>" : "</ul>"));
        continue;
      }
      if (!l.trim()) { flush(); i++; continue; }
      para.push(l);
      i++;
    }
    flush();
    return out.join("");
  }

  // ---- 一次工具调用：一句话说它做了什么（同 Claude App：有 description 就用它）----
  function title(p) {
    var a = p.input || {}, n = p.name;
    if (n === "Bash") return a.description ? clip(a.description, 90) : "运行 " + clip(a.command, 70);
    if (n === "Read") return "读取 " + base(a.file_path);
    if (n === "Edit" || n === "MultiEdit") return "编辑 " + base(a.file_path);
    if (n === "Write") return "写入 " + base(a.file_path);
    if (n === "Glob") return "查找文件 " + clip(a.pattern, 60);
    if (n === "Grep") return "搜索 " + clip(a.pattern, 60);
    if (n === "web_search" || n === "WebSearch") return "搜索网页 " + clip(a.query, 60);
    if (n === "WebFetch") { var h = /^https?:\/\/([^/]+)/.exec(a.url || ""); return "读取网页 " + (h ? h[1] : clip(a.url, 60)); }
    if (n === "Agent" || n === "Task") return "子 Agent：" + clip(a.description || a.prompt, 70);
    if (/^Task(Create|Update|List|Output|Stop)$|^TodoWrite$/.test(n)) return "更新任务清单";
    if (n === "SendMessage") return "发送消息给 " + clip(a.to, 40);
    if (n === "ListAgents") return "列出 Agent";
    if (n === "hibernate") return "休眠";
    if (n === "ToolSearch") { var sel = /^select:(.+)$/.exec(String(a.query || "")); return sel ? "加载 " + sel[1].split(",").length + " 个工具" : "查找工具 " + clip(a.query, 50); }
    if (n === "NotebookEdit") return "编辑 " + base(a.notebook_path);
    if (n === "LS") return "列出 " + base(a.path);
    if (n === "BashOutput") return "查看后台命令的输出";
    if (n === "KillShell" || n === "KillBash") return "停止后台命令";
    if (n === "ExitPlanMode") return "提交计划";
    if (n === "AskUserQuestion") return "向你提问";
    if (n === "Skill") return "使用技能 " + clip(a.skill || a.name, 40);
    if (n === "SlashCommand") return clip(a.command, 60);
    var mc = /^mcp__(.+?)__(.+)$/.exec(n);
    if (mc) return mc[1] + " · " + mc[2];
    return n;
  }
  var isErr = function (p) { return p.status === "error"; };
  var running = function (p) { return p.status === "running" || p.status === "background"; };
  function diffHtml(d) {
    return d.slice(0, 2000).map(function (x) { return x.t === "…" ? '<div class="gv-dl gv-dgap">⋯</div>' : '<div class="gv-dl' + (x.t === "+" ? " add" : x.t === "-" ? " del" : "") + '"><span class="gv-dn">' + (x.n || "") + "</span>" + esc((x.t === " " ? " " : x.t) + " " + x.l) + "</div>"; }).join("");
  }
  // 点开后的内容（结果）：short = 结果预览（前几行，设置里「结果预览」那一档）
  // 显示什么（带 ··· 菜单里指着时的预览）：同终端界面
  var vmv = function (k, view) { return window.TSU_TERM && TSU_TERM.viewMode ? TSU_TERM.viewMode(k, view) : (A.cfg || {})[k]; };
  // short：true = 预览（前 5 行）；"card" = 卡片（前 40 行，「… 还有 N 行」点开看全）；"all" = 全部（最后「收起」）；false / 不给 = 老样子（前 400 行，别处的快速查看用）
  //   k：这一条的键（「… 还有 N 行」点了记在 open[k + ":all"]）
  function detail(p, short, rtx, view, k) { // view：拆出来的一格自己的筛选（没有就按设置）
    var lvl = short === true ? "peek" : short === "card" || short === "all" ? short : "old";
    var a = p.input || {}, out = "", lines = p.detail || [], n = { peek: 5, card: 40, all: 20000, old: 400 }[lvl];
    short = lvl === "peek";
    var more = function (len) {
      if (k && lvl === "all" && len > 40) return '<button type="button" class="gv-more gv-morebtn" data-more="' + esc(k) + '">' + (EN() ? "Show less" : "收起") + "</button>";
      if (len <= n || lvl === "old" || lvl === "all") return "";
      return k ? '<button type="button" class="gv-more gv-morebtn" data-more="' + esc(k) + '">… 还有 ' + (len - n) + " 行</button>" : '<div class="gv-more">… 还有 ' + (len - n) + " 行</div>";
    };
    // 子 Agent（Agent、Claude Code 的 Task）：一行状态，再按设置挑几块——任务说明（交给它的 prompt）、过程（它的每一步，有记录的话）、结果（它的报告）
    if (p.name === "Agent" || p.name === "Task") {
      var tasks = (rtx && rtx.tasks) || [], ag = tasks.filter(function (x) { return x.id === p.agentId; })[0] || tasks.filter(function (x) { return x.desc === a.description; }).pop();
      var steps = ag && ag.log ? ag.log.filter(function (x) { return x.kind === "tool"; }) : [], report = ag && ag.result ? String(ag.result) : !isErr(p) && lines.length ? lines.join("\n") : "";
      var sec = function (h, body) { return '<div class="gv-sub"><div class="gv-subh">' + esc(h) + "</div>" + body + "</div>"; }, cut = function (txt, k) { var ls = String(txt).split("\n"); return { t: short ? ls.slice(0, k).join("\n") : txt, more: short && ls.length > k ? ls.length - k : 0 }; };
      out += '<div class="gv-ch' + (isErr(p) ? " err" : "") + '">' + esc(isErr(p) ? p.error || "" : ag ? (ag.status === "running" ? "运行中" : "完成") + " · " + ag.tools + " 次工具调用" : running(p) ? "运行中" : "完成") + "</div>";
      if (vmv("agentPrompt", view) === true && a.prompt) { var pc = cut(a.prompt, 3); out += sec("任务说明", '<pre class="gv-out">' + esc(pc.t) + "</pre>" + (pc.more ? '<div class="gv-more">… 还有 ' + pc.more + " 行</div>" : "")); }
      if (vmv("agentSteps", view) !== false && steps.length) { var sv = short ? steps.slice(-3) : steps.slice(0, 50); out += sec("子 Agent 过程", sv.map(function (x) { return '<div class="gv-step">' + esc(title(x)) + "</div>"; }).join("") + (steps.length > sv.length ? '<div class="gv-more">… 共 ' + steps.length + " 步</div>" : "")); }
      if (vmv("agentResult", view) !== false && report) { var rc = cut(report, 6); out += sec("结果", '<div class="gv-md">' + md(rc.t) + "</div>" + (rc.more ? '<div class="gv-more">… 还有 ' + rc.more + " 行</div>" : "")); }
      return out;
    }
    if (p.name === "Bash") {
      // 命令本身也会很长（一大段 heredoc、一行几百个字）：卡片里最多露 5 行的高度（小预览 3 行，按折行后看得见的行算，CSS 限高），
      //   放不下的底下淡出去、一个「展开完整命令」（画完量一下真放不下才露出来，fitCmds）；「全部」才整段（几乎没人一行一行看）
      var full = String(a.command || ""), clip = lvl !== "all";
      out += '<div class="gv-ch">Bash</div><pre class="gv-cmd' + (clip ? " gv-clip" + (short ? " gv-clip3" : "") : "") + '"><code><span class="gv-ps">$ </span>' + codeHtml(full.length > 20000 ? full.slice(0, 20000) + " …" : full, "shell") + "</code></pre>" +
        (clip && k ? '<button type="button" class="gv-more gv-morebtn gv-cmdmore" data-more="' + esc(k) + '" hidden>' + (EN() ? "Show full command" : "展开完整命令") + "</button>" : "");
      if (isErr(p) && !lines.length) out += '<pre class="gv-out err">' + esc(p.error || "") + "</pre>";
      else if (lines.length) out += '<pre class="gv-out' + (isErr(p) ? " err" : "") + '">' + esc(lines.slice(0, n).join("\n")) + "</pre>" + more(lines.length);
      return out;
    }
    if (p.diff) { var dn = lvl === "peek" ? 12 : lvl === "card" ? 60 : 2000; return '<div class="gv-ch">' + esc(p.summary || "") + '</div><div class="gv-diff">' + diffHtml(p.diff.slice(0, dn)) + "</div>" + (p.diff.length > dn ? (k && lvl !== "peek" ? '<button type="button" class="gv-more gv-morebtn" data-more="' + esc(k) + '">… 还有 ' + (p.diff.length - dn) + " 行改动</button>" : '<div class="gv-more">… 还有 ' + (p.diff.length - dn) + " 行改动</div>") : lvl === "all" && k && p.diff.length > 60 ? '<button type="button" class="gv-more gv-morebtn" data-more="' + esc(k) + '">' + (EN() ? "Show less" : "收起") + "</button>" : ""); }
    if (p.name === "web_search" && p.results) return '<div class="gv-ch">' + esc(p.summary || "搜索结果") + "</div>" + p.results.slice(0, short ? 3 : 100).map(function (x) { return '<div class="gv-res"><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a><span class="gv-dim">' + esc(x.url) + "</span></div>"; }).join("") + (short && p.results.length > 3 ? '<div class="gv-more">… 还有 ' + (p.results.length - 3) + " 条结果</div>" : "");
    var headL = p.summary || (isErr(p) ? p.error : "");
    if (headL) out += '<div class="gv-ch' + (isErr(p) ? " err" : "") + '">' + esc(headL) + "</div>";
    if (lines.length) out += '<pre class="gv-out">' + esc(lines.slice(0, n).join("\n")) + "</pre>" + more(lines.length);
    else if (!headL && !short) out += '<pre class="gv-out">' + esc(JSON.stringify(a, null, 2)) + "</pre>";
    return out;
  }

  function GuiView(P, agentId) {
    var V = this, rt = A.runtime(agentId), agent = rt.agent, cfg = A.cfg;
    V.gui = true; V.agentId = agentId; V.claude = !!agent.claude;
    // 显示什么、怎么显示：同终端界面的设置（live.js 带着菜单里指着时的预览）——工具每类一个档位：full 完整 / preview 预览 / call 只看调用 / hidden 隐藏
    var TT = function () { return window.TSU_TERM || {}; };
    var vm = function (k) { return TT().viewMode ? TT().viewMode(k, P.view) : cfg[k]; }; // 同一个标签页拆成几格：每格按它自己的筛选（P.view，vsplit.js 给）
    var on = function (k) { var v = vm(k); return v !== false && v !== "hidden"; };
    var modeOf = function (p) { return TT().toolMode ? TT().toolMode(p, P.view) : A.toolMode(p); };
    V.title = function () { return agent.name; }; // 在跑不在名字后面挂 ✳：标签页图标那一格换成转圈（V.working，见 drawTabs）
    // 同名的 Claude Code 会话：标签页、窗口标题上名字后面淡淡地带短 id（同终端界面，见 live.js titleInto）
    V.titleTag = function () { return /^cc:/.test(agentId) && window.TSU_CLAUDE && TSU_CLAUDE.dupTag ? TSU_CLAUDE.dupTag(agentId.slice(3), agent.name) : ""; };
    V.working = function () { return !!rt.stream; };
    V.busy = function () { return false; };
    V.spec = function () { return { sh: P.shell.spec().sh, agent: agentId, ui: "gui" }; };
    V.tabActions = function () { return window.TSU_TERM && TSU_TERM.agentTabActions ? TSU_TERM.agentTabActions(agentId) : []; }; // 同终端界面：macOS 风格的窗口标题栏里 ··· 显示方式与内容
    V.full = function () { return true; }; // 终端那块（screen / foot）不用：整块给图形界面
    V.noJump = function () { return true; };
    V.inputChanged = function () {};
    V.key = function () {};
    var host = document.createElement("div");
    host.className = "gv";
    // 有规律的几块：上面是对话（只有消息）；下面是 agent 的底部——在跑的那一行、排着的、输入框、下面一排（权限、模型、推理强度、状态信息）。任务清单那些在 agent 的右边（studio.js）
    host.innerHTML = '<div class="gv-scroll"><div class="gv-col gv-list"></div><div class="gv-col gv-queued" hidden></div></div>' +
      '<div class="gv-bottom"><button class="gv-jump" title="滚动到底部" hidden>' + ICON.down + '</button><div class="gv-col"><div class="gv-todo" hidden></div>' +
      '<div class="gv-comp"><div class="gv-att" hidden></div><textarea rows="1" spellcheck="false"></textarea><button class="gv-send" title="发送 (↵)"></button></div>' +
      '<div class="gv-bar"><button class="gv-chip gv-plus" data-c="attach" title="添加图片"><svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg></button>' +
      '<button class="gv-chip" data-c="access"></button><div class="gv-live" hidden></div><span class="gv-fill"></span><button class="gv-chip" data-c="model"></button><button class="gv-chip" data-c="effort"></button>' +
      '<button class="gv-chip gv-ring" data-c="ctx" title=""><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7"/><circle class="gv-ringv" cx="10" cy="10" r="7"/></svg></button></div>' +
      '<input type="file" accept="image/*" multiple hidden></div></div>'; // 在跑的那一行（.gv-live）在下面那一排的左边：和右边的模型同一行、对齐（用户定的）
    P.el.appendChild(host);
    V.host = host;
    var scroll = host.querySelector(".gv-scroll"), listEl = host.querySelector(".gv-list"), liveEl = host.querySelector(".gv-live"), ta = host.querySelector("textarea");
    var jumpB = host.querySelector(".gv-jump"), sendB = host.querySelector(".gv-send"), attEl = host.querySelector(".gv-att"), todoEl = host.querySelector(".gv-todo"), qEl = host.querySelector(".gv-queued"), fileIn = host.querySelector("input[type=file]");
    var blocks = new Map(), open = {}, attach = [], follow = true, shown = false;
    V.scrollEl = scroll;
    // 输入框这一列（在跑的那一行、排着的、输入框、下面一排）：能整列搬到别处——Studio 面板的 Agent 那一层（agent 的底部），标签页里就只剩对话
    var bottomEl = host.querySelector(".gv-bottom"), colEl = bottomEl.querySelector(":scope > .gv-col"), dockWrap = null;
    var inCol = function (sel) { return colEl.querySelector(sel); };
    // target：搬进去（外面包一层 .gv > .gv-bottom，样子、颜色变量同原来）；null：搬回来
    V.dock = function (target) {
      if (target) {
        if (!dockWrap) { dockWrap = document.createElement("div"); dockWrap.className = "gv gv-dock"; dockWrap.innerHTML = '<div class="gv-bottom"></div>'; }
        if (dockWrap.parentNode !== target) target.appendChild(dockWrap);
        if (colEl.parentNode !== dockWrap.firstChild) dockWrap.firstChild.appendChild(colEl);
      } else {
        if (colEl.parentNode !== bottomEl) bottomEl.appendChild(colEl);
        if (dockWrap && dockWrap.parentNode) dockWrap.parentNode.removeChild(dockWrap);
      }
      host.classList.toggle("gv-docked", !!target);
      grow(); status(); stick();
    };
    V.dockCol = function () { return colEl; };
    // ---- 底部（在跑的那一行、输入框、下面一排）：高度跟着内容走，不能手动拖（没有 sash、没有「还原高度」）----
    var TT = function () { return window.TSU_TERM; };
    // 底部右上角「···」：显示哪几块（运行状态行、状态信息；子 Agent 在右侧栏）（同终端界面那份）
    var fmoreG = document.createElement("button");
    fmoreG.type = "button"; fmoreG.className = "gv-fmore"; fmoreG.title = "底部的选项";
    fmoreG.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="3.5" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="12.5" cy="8" r="1.2" fill="currentColor"/></svg>';
    bottomEl.appendChild(fmoreG);
    fmoreG.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var SU = window.STUDIO, MI = SU && SU.menuIcons ? SU.menuIcons() : {}, c = A.cfg || {}, wOn = (c.workLine || "full") !== "hidden", iOn = c.footInfo !== false;
      var set = function (k, v) { return function () { A.setCfg(k, v); status(); bar(); }; };
      if (SU && SU.menu) SU.menu(function () { return [
        { label: "运行状态行", icon: MI.workline || MI.status, checked: wOn, run: set("workLine", wOn ? "hidden" : "full") },
        { label: "状态信息", icon: MI.info || MI.eye, checked: iOn, run: set("footInfo", !iOn) },
      ]; }, { el: fmoreG, side: "below-end" });
    });

    // ---- 一问 → 一块 ----
    function turnHtml(t, ti) {
      var h = "", out0 = turnHtml0(t, ti);
      // 时间戳（设置 › 对话 › 时间戳）：「始终显示」时换天的地方先一条「今天」「昨天」「9月26日」
      var TT = window.TSU_TERM || {}, tsm = vm("timestamps") || "hide";
      host.classList.toggle("gv-ts-show", tsm === "show");
      host.classList.toggle("gv-ts-hover", tsm === "hover");
      if (tsm === "show" && out0 && TT.turnTime) {
        var t0 = TT.turnTime(t), prev = 0, ts0 = rt.session().turns;
        for (var j = ti - 1; j >= 0 && !prev; j--) prev = TT.turnTime(ts0[j]);
        if (t0 && (!prev || TT.dayKey(prev) !== TT.dayKey(t0))) h = '<div class="gv-day">' + esc(TT.dayLabel(t0)) + "</div>";
      }
      return h + out0;
    }
    // 时间戳：一块的右上角（你的话：气泡左边）一个小的灰时间，悬停看完整的日期时间；隐藏时什么都不加
    function tsEl(t) { var TT = window.TSU_TERM; if (!t || !TT || !TT.tsFmt || (vm("timestamps") || "hide") === "hide") return ""; var f = TT.tsFmt(t); return '<time class="gv-ts" title="' + esc(f.full) + '">' + esc(f.hm) + "</time>"; }
    function tsw(t, html) { var e = html ? tsEl(t) : ""; return e ? '<div class="gv-tsb">' + e + html + "</div>" : html; }
    function turnHtml0(t, ti) {
      var h = "";
      // 连接器那边压缩了上下文（Claude Code、Codex）：一条分隔线，点开是它写的摘要——不是用户的气泡
      if (t.compact) { // 压缩了上下文：一条分隔线（点开是摘要）；中英文照界面语言
        var ck = ti + ":c", co = !!open[ck], en1 = !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"), kt = t.compact.pre ? esc(String(Math.round(t.compact.pre / 1000))) + "k tokens" : "", kp = t.compact.post ? esc(String(Math.round(t.compact.post / 100) / 10)) + "k" : "";
        var ctl = en1 ? "Compacted" + (kt ? " · " + kt + " summarized" + (kp ? " to " + kp : "") : "") : "已压缩" + (kt ? " · " + kt + (kp ? " 压缩到 " + kp : "") : ""); // 同 TUI：压缩前、压缩后各多少
        return '<div class="gv-compact' + (co ? " open" : "") + '" data-k="' + ck + '"><button class="gv-sum"><span class="gv-st">' + ctl + "</span><i></i></button>" + (co && t.compact.summary ? '<div class="gv-det gv-md">' + md(t.compact.summary) + "</div>" : "") + "</div>";
      }
      if (t.recap !== undefined) return !on("recaps") ? "" : tsw(t.at, '<div class="gv-note">回顾：' + esc(t.recap) + "</div>");
      if (t.cmd !== undefined) return tsw(t.at, '<div class="gv-cmdrec"><span class="gv-dim">' + esc(t.cmd) + "</span>" + (t.note ? '<div class="gv-note">' + md(t.note) + "</div>" : "") + (t.err ? '<div class="gv-note gv-err">' + esc(t.err) + "</div>" : "") + "</div>");
      if (t.bash !== undefined) { // 你自己用 ! 跑的命令：输出按「你的 ! 命令输出」（完整 / 前几行 / 隐藏）
        var bm = vm("bashOut") || "preview", bp = { kind: "tool", name: "Bash", input: { command: t.bash }, status: t.code === null ? "running" : t.code ? "error" : "done", detail: String(t.out || "").replace(/\n$/, "").split("\n") };
        return '<div class="gv-user">' + tsEl(t.at) + '<div class="gv-bubble gv-mono">! ' + esc(t.bash) + "</div></div>" + (bm === "hidden" ? "" : '<div class="gv-ai">' + toolOne(bp, ti + ":b", bm === "expanded" ? "full" : "preview") + "</div>");
      }
      if (t.note !== undefined && t.ask === undefined) return '<div class="gv-note">' + md(t.note) + "</div>";
      if (t.system) {
        // 别的 agent 发来的（Agent 消息 › 收到的）、子 agent 跑完的（› 子 Agent 报告）、后台命令跑完的（后台任务通知）：先画这一条，它接着的回答（有的话）照常画在下面
        var sh = "";
        if (t.social) sh = t.social.map(function (m, mi) { return tsw(m.ts || t.at, agentMsgHtml(m, ti + ":m" + mi)); }).join("");
        else {
          var nts = t.notices || [], nbg = nts.filter(function (n) { return n.kind !== "agent"; });
          if (on("notices")) sh += tsw(t.at, nbg.map(function (n) { return '<div class="gv-note">' + esc(noteText(n)) + "</div>"; }).join("") || (!nts.length && t.woke ? '<div class="gv-note">' + esc(t.woke) + "</div>" : ""));
          sh += reportsHtml(nts.filter(function (n) { return n.kind === "agent"; }), ti + ":r", t.at);
        }
        if (!(t.parts && t.parts.length)) return sh;
        h += sh;
      }
      var ask = String(t.ask || "");
      if (on("prompts") && (ask.trim() || (t.images && t.images.length))) {
        // 图片：悬停预览（默认，[Image #N] 指着看、点了放大）/ 直接显示（缩略图）——设置 › 对话 › 图片
        var inl = ((A && A.cfg && A.cfg.imageShow) || "hover") === "inline";
        var imh = t.images && t.images.length ? (inl ? '<div class="gv-imgs">' + t.images.map(function (im) { return '<img src="' + TSU_IMG.of(im) + '" alt="">'; }).join("") + "</div>" : '<div class="gv-imgrefs">' + t.images.map(function (im, i) { return '<span class="st-imgref" data-img="' + TSU_IMG.key(im) + '" data-name="Image #' + (im && im.no ? im.no : i + 1) + '">[Image #' + (im && im.no ? im.no : i + 1) + "]</span>"; }).join(" ") + "</div>") : "";
        h += '<div class="gv-user">' + tsEl(t.at) + '<div class="gv-bubble">' + imh + esc(ask).replace(/\n/g, "<br>") + "</div></div>";
      }
      var ai = "";
      var tm = vm("thinking") || "hidden";
      if (t.thought && tm !== "hidden") { // 思考：一行（点开看）/ 展开
        var k0 = ti + ":th", o0 = k0 in open ? open[k0] : tm === "expanded";
        ai += '<div class="gv-think' + (o0 ? " open" : "") + '" data-k="' + k0 + '"><button class="gv-sum">思考了 ' + t.thought + " 秒<i></i></button>" + (o0 && t.thinking ? '<div class="gv-det gv-thought">' + md(t.thinking) + "</div>" : "") + "</div>";
      }
      var parts = t.parts || [{ kind: "text", text: t.answer || "" }], group = [], gi = 0, merge = vm("mergeReads") !== false, live = !!(rt.stream && rt.stream.turn === t), lastTool = -1;
      parts.forEach(function (p, i) { if (p.kind === "tool") lastTool = i; });
      // 最新的：最后一问（有工具调用的那一问里最后的那一次）——它所在的那一组展开、它露出结果的前几行
      var tsAll = rt.session().turns, latestTi = -1;
      for (var q = tsAll.length - 1; q >= 0 && q >= tsAll.length - 6; q--) { if ((tsAll[q].parts || []).some(function (x) { return x.kind === "tool"; })) { latestTi = q; break; } }
      var lastEnd = t.at || 0; // 没记时间的那段话：用前一个工具跑完的时候
      // 连着的工具调用（中间没说话）并成一组（设置「合并连续的读取」关了：只有一条一条）；一条的就是它自己
      var flushG = function () {
        if (!group.length) return;
        var g0 = group, hotG = ti === latestTi && g0[g0.length - 1].__i === lastTool;
        var rk = function (p) { return ti + ":t" + p.__i; }; // 每一条的键：这一问里第几段（组变长了、拆开了，展开的还是那一条）
        ai += tsw(g0[0].t0 || lastEnd, g0.length === 1 || !merge ? g0.map(function (p) { return toolOne(p, rk(p), modeOf(p), hotG && p.__i === lastTool); }).join("") : toolGroup(g0, ti + ":g" + g0[0].__i, hotG, rk));
        group = [];
      };
      parts.forEach(function (p, i) {
        if (p.kind === "tool") {
          lastEnd = Math.max(lastEnd, (p.t0 || lastEnd) + (p.secs || 0) * 1000);
          var m = modeOf(p);
          if (m === "hidden" && !running(p)) return;
          Object.defineProperty(p, "__i", { value: i, configurable: true, enumerable: false }); // 在这一问里是第几段（键用它：展开的状态跟着这一条，不跟着分组）
          group.push(p);
          return;
        }
        flushG();
        if (p.kind === "notice") { // 一轮中间读进去的通知：后台命令的按「后台任务通知」，子 agent 跑完的按「Agent 消息 › 子 Agent 报告」
          if (on("notices")) ai += (p.notices || []).filter(function (n) { return n.kind !== "agent"; }).map(function (n) { return '<div class="gv-note">' + esc(noteText(n)) + "</div>"; }).join("");
          ai += reportsHtml((p.notices || []).filter(function (n) { return n.kind === "agent"; }), ti + ":r" + i, p.at || t.at);
          return;
        }
        if (p.kind !== "text" || !String(p.text || "").trim()) return;
        // 回复翻译（translate.js 的 reply）：说完了的一段有译文就换上（还在流的那段照原文）。没有「原文 / 译文」按钮：
        //   译文那一块指上去淡淡一层高亮，点一下换成原文（浅色底）；原文那块里任何地方点一下换回译文（划选文字、点链接不算）
        var trk = ti + ":tr" + i, ptx = String(p.text), trd = !(live && i === parts.length - 1 && !p.whole) && window.TSU_TRANSLATE && TSU_TRANSLATE.reply ? TSU_TRANSLATE.reply(ptx, agentId) : null, showO = !!(trd && open[trk]);
        if (trd && !showO) ptx = trd;
        else if (!trd && !(live && i === parts.length - 1 && !p.whole) && window.TSU_TRANSLATE && TSU_TRANSLATE.replyPending && (function () { try { return ((typeof A.cfg === "function" ? A.cfg() : A.cfg) || {}).translateShow === "only"; } catch (e) { return false; } })() && TSU_TRANSLATE.replyPending(ptx)) { ai += '<div class="gv-md gv-trwait">…</div>'; return; } // 只显示译文：还没翻好的段落先是一个淡的 …
        var mdT = function (x) { var h0 = md(x); return trd ? '<div class="gv-tr' + (showO ? " on" : "") + '" data-tr="' + trk + '">' + h0 + "</div>" : h0; };
        // 最后一次调用工具之后的话是最终回复；夹在工具调用之间的是过程说明（完整 / 一行：灰的第一句，点开看全 / 隐藏；在跑的这一问，最后那段也先算过程说明）
        var tAt = p.at || (!live && i > lastTool && t.stats && t.stats.at) || lastEnd;
        if (!live && i > lastTool) { if (on("answers")) ai += tsw(tAt, '<div class="gv-md">' + mdT(ptx) + "</div>"); return; }
        var pm = vm("progress") || "full", xk = ti + ":x" + i, po = xk in open ? !!open[xk] : pm === "full";
        if (pm === "hidden") return;
        if (po && !(xk in open)) { ai += tsw(tAt, '<div class="gv-md gv-prog">' + mdT(ptx) + "</div>"); return; }
        var first = String(ptx).trim().split("\n")[0].replace(/^[#>*\-\s]+/, "").replace(/[*`_]/g, "");
        ai += tsEl(tAt) ? '<div class="gv-tsb">' + tsEl(tAt) : "";
        ai += '<div class="gv-progl' + (po ? " open" : "") + '" data-k="' + xk + '"><button class="gv-sum"><span class="gv-st">' + esc(first) + "</span><i></i></button>" + (po ? '<div class="gv-md gv-prog">' + mdT(ptx) + "</div>" : "") + "</div>";
        if (tsEl(tAt)) ai += "</div>"; // 时间戳那层
      });
      flushG();
      if (ai) h += '<div class="gv-ai">' + ai + "</div>";
      // 系统错误（API 出错、网络、登录、沙盒、中断、模型什么都没回……）：不是 Agent 说的，不放进回答里——单独一条紧凑的条（出错红、中断灰）；
      // 按「系统错误」的档位：完整 / 一行（点一下看全）/ 隐藏
      var em = vm("sysErrors") || "full";
      if (em !== "hidden") {
        var tErr = (t.stats && t.stats.at) || lastEnd; // 出错的时间：这一问结束的时候
        if (t.error) h += tsw(tErr, sysErr(t.error === "Interrupted by user" ? "已中断" : t.error, ti + ":err", em, !/^(Interrupted|Stopped)\b/.test(t.error)));
        if (t.note && t.ask !== undefined) h += tsw(tErr, sysErr(t.note, ti + ":note", em, false));
      }
      return h;
    }
    var ERR_IC = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.8v3.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11" r=".85" fill="currentColor"/></svg>';
    var STOP_IC = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="5.9" y="5.9" width="4.2" height="4.2" rx=".6" fill="currentColor"/></svg>';
    // ---- Agent 消息：按「Agent 消息 ›」里各自的档位（完整 / 一行 / 隐藏）----
    var am = function (k) { return TT().agentMode ? TT().agentMode(k, P.view) : "full"; };
    // 后台命令跑完的一句（同终端界面）：Background command "描述" completed (exit code 0) / was stopped / failed
    var noteText = function (n) { if (n.text || n.summary) return n.text || n.summary; var d = String(n.desc || n.cmd || n.id || ""); return n.kind === "shell" ? 'Background command "' + d + '" ' + (n.status === "done" ? "completed" + (n.code != null ? " (exit code " + (n.code || 0) + ")" : "") : n.status === "stopped" ? "was stopped" : "failed" + (n.code ? " with exit code " + n.code : "")) : d; };
    // 别的 agent 发来的一条：完整——名字 + 正文；一行——「名字 · 第一句」，点开看全
    function agentMsgHtml(m, k) {
      var md0 = am("agentIn"), who = String(m.from_name || m.from || "agent");
      if (md0 === "hidden") return "";
      var o = k in open ? !!open[k] : md0 === "full", first = String(m.text || "").replace(/\s+/g, " ").trim();
      return '<div class="gv-progl gv-amsg' + (o ? " open" : "") + '" data-k="' + k + '"><button class="gv-sum"><span class="gv-st"><b>' + esc(who) + "</b>" + (o ? "" : " · " + esc(first)) + "</span><i></i></button>" +
        (o ? '<div class="gv-md gv-amsgb">' + md(String(m.text || "")) + "</div>" : "") + "</div>";
    }
    // 子 agent 跑完的：一行「✓ fork · 描述 finished · 1h 25m · 460k tokens」；完整：下面是它的报告（有报告的能点开 / 收起）
    function reportsHtml(list, key, at) {
      var md0 = am("agentReports"), F0 = A.fmt || {};
      if (md0 === "hidden" || !list || !list.length) return "";
      return list.map(function (n, j) {
        var tk = (rt.tasks || []).filter(function (x) { return x.id && x.id === n.id; })[0] || {}, st = n.status || tk.status, ms = n.ms || tk.ms || 0, tok = n.tokens || tk.tokens || 0, part = n.partial || tk.partial;
        var ok = st === "done" && !part, bad = st === "error", verb = part ? "stopped at turn limit" : st === "done" ? "finished" : st === "stopped" ? "was stopped" : "failed";
        var txt = [n.type || tk.type || "agent", String(n.desc || tk.desc || n.id || "").replace(/\s+/g, " ").trim() + " " + verb].concat(ms && (F0.durS || F0.dur) ? [(F0.durS || F0.dur)(ms)] : [], tok && (F0.kS || F0.k) ? [(F0.kS || F0.k)(tok) + " tokens"] : []).join(" · ");
        var rep = String(n.result || tk.result || "").trim(), k = key + ":" + j, o = !!rep && (k in open ? !!open[k] : md0 === "full");
        var ic = '<span class="gv-repi ' + (ok ? "ok" : bad ? "bad" : "stop") + '">' + (ok ? "✓" : bad ? "✗" : "■") + "</span> ";
        return tsw(n.at || at, '<div class="gv-progl gv-rep' + (o ? " open" : "") + '"' + (rep ? ' data-k="' + k + '"' : "") + '><button class="gv-sum"><span class="gv-st">' + ic + esc(txt) + "</span>" + (rep ? "<i></i>" : "") + "</button>" +
          (o ? '<div class="gv-md gv-repb">' + md(rep) + "</div>" : "") + "</div>");
      }).join("");
    }
    function sysErr(text, k, m, bad) {
      var o = k in open ? !!open[k] : m === "full";
      return '<div class="gv-syserr' + (bad ? " bad" : "") + (o ? " open" : "") + '" data-k="' + k + '"><button class="gv-sum" title="' + esc(o ? "" : text) + '"><span class="gv-sei">' + (bad ? ERR_IC : STOP_IC) + '</span><span class="gv-set">' + esc(text) + "</span></button></div>";
    }
    // 一次工具调用：一行（标题 · 用时；出错红；在跑的带 …）+ 点开的卡片。图形界面默认收着（同终端界面的 TUI：一问里几十次调用全摊开没法看）：
    //   在跑的那条自动展开（跑完收回）；最新的那一条（最后一问里最后一次调用）露出结果的前几行；别的只有一行，点一下看卡片、再点收起。
    //   卡片里的输出先给 40 行，「… 还有 N 行」点开看全，最后「收起」。档位「只看调用」：只有这一行（点开照样看）；「隐藏」：不画（在跑的除外）
    function toolOne(p, k, m, hot) {
      var run = running(p), auto = run || (hot && m !== "call"), o = k in open ? !!open[k] : auto, lvl = open[k + ":all"] ? "all" : o && !(k in open) && !run ? "peek" : "card", t = title(p);
      // 在跑的：用时不写进 HTML（每秒一变，整问重画一遍，看着的那一块就跳）——空的 span 带起点，旁边每秒填一次（tickTm）
      var ms = p.t0 && p.t1 ? p.t1 - p.t0 : (p.secs || 0) * 1000, tm = run && p.t0 ? '<span class="gv-tm gv-tick" data-t0="' + p.t0 + '"></span>' : ms >= 1000 ? '<span class="gv-tm">' + esc(durC(ms)) + "</span>" : "";
      return '<div class="gv-tool' + (o ? " open" : "") + (o && lvl === "peek" ? " peek" : "") + (run ? " run" : "") + '" data-k="' + k + '" data-kind="' + kindOf(p.name) + '"><button class="gv-sum"><span class="gv-st">' + esc(t) + "</span>" + (run ? '<span class="gv-dots"></span>' : "") + tm + "<i></i></button>" +
        (o ? '<div class="gv-det gv-card' + (lvl === "peek" ? " gv-peek" : "") + '">' + detail(p, lvl === "peek" ? true : lvl, rt, P.view, k) + "</div>" : "") + "</div>";
    }
    // 连着的几次工具调用（中间没说话）：一行汇总「运行了 12 条命令、读取了 3 个文件 · 6 分 3 秒」（这一组从第一条开始的总时长），点开是每一条一行；
    //   在跑的那组、最新的那组默认展开，只列最后 4 条（前面的「… 还有 N 条」点开，再点收起）；别的组收着
    function toolGroup(g, key, hot, rowKey) {
      var live = g.some(running), o = key in open ? !!open[key] : live || hot, allR = !!open[key + ":more"], MAXR = 4;
      var t0 = g.reduce(function (m0, p) { return p.t0 && (!m0 || p.t0 < m0) ? p.t0 : m0; }, 0), t1 = live ? 0 : g.reduce(function (m0, p) { return Math.max(m0, p.t1 || (p.t0 ? p.t0 + (p.secs || 0) * 1000 : 0)); }, 0);
      var bad = 0, head = sumText(g, live); // 失败的不单独标（同 Claude Code：组的那一行不写几个失败、不变红；点开那一条自己看）
      var rows = "";
      if (o) {
        var hid = Math.max(0, g.length - MAXR), from = allR ? 0 : hid;
        if (hid) rows += '<button type="button" class="gv-gmore" data-gmore="' + key + '">' + (allR ? (EN() ? "Hide " + hid + " earlier" : "收起前面 " + hid + " 条") : (EN() ? "… " + hid + " more" : "… 还有 " + hid + " 条")) + "</button>";
        rows += g.slice(from).map(function (p, j) { var i = from + j; return toolOne(p, rowKey ? rowKey(p, i) : key + ":" + i, modeOf(p), hot && i === g.length - 1); }).join("");
      }
      return '<div class="gv-group' + (o ? " open" : "") + (live ? " run" : "") + (bad ? " bad" : "") + '" data-k="' + key + '" data-kind="' + kindOf((g[g.length - 1] || {}).name) + '"><button class="gv-sum"><span class="gv-st">' + esc(head) + "</span>" + (live ? '<span class="gv-dots"></span>' : "") +
        (live && t0 ? '<span class="gv-tm gv-tick" data-t0="' + t0 + '"></span>' : t0 && t1 - t0 >= 1000 ? '<span class="gv-tm">' + esc(durC(t1 - t0)) + "</span>" : "") + "<i></i></button>" + (o ? '<div class="gv-card gv-rows">' + rows + "</div>" : "") + "</div>";
    }
    function readGroup(g, key) { return toolGroup(g, key, false); } // 老名字（别处还叫它）
    // 重画一问的时候（在跑的那组收起、展开，工具跑完换样子）：没贴着底的，看着的那一处不动——WebKit 没有 overflow-anchor，
    //   上面的东西一变高变矮，看着的内容就跳。记下视口顶上那一块（带 data-k 的最里面那个，没有就是那一问）离顶多远，重画后按同一个键找回来补上差
    function anchorOf() {
      if (follow || !scroll.clientHeight) return null;
      var sr = scroll.getBoundingClientRect(), x = sr.left + Math.min(60, sr.width / 2), y = sr.top + 8;
      var hit = document.elementFromPoint(x, y), k = hit && hit.closest && hit.closest("[data-k]"), tEl = hit && hit.closest && hit.closest(".gv-turn");
      if (!tEl || !listEl.contains(tEl)) return null;
      var ref = k && tEl.contains(k) ? k : tEl;
      return { turn: tEl, key: ref === tEl ? null : ref.dataset.k, top: ref.getBoundingClientRect().top };
    }
    function reanchor(a) {
      if (!a || follow) return;
      var ref = a.key ? a.turn.querySelector('[data-k="' + CSS.escape(a.key) + '"]') : null;
      if (!ref) ref = a.turn;
      if (!ref.isConnected) return;
      var d = ref.getBoundingClientRect().top - a.top;
      if (Math.abs(d) >= 1) scroll.scrollTop += d;
    }
    function paintTurn(t, el) {
      var ti = rt.session().turns.indexOf(t), h = turnHtml(t, ti);
      if (el.dataset.h !== h) { var an = anchorOf(); el.dataset.h = h; el.innerHTML = h; tickTm(el); fitCmds(el); reanchor(an); }
      el.hidden = !h;
    }
    // 限了高的命令：真放不下才淡出去、露出「展开完整命令」
    function fitCmds(box) { box.querySelectorAll(".gv-cmd.gv-clip").forEach(function (pre) { var over = pre.scrollHeight > pre.clientHeight + 2, b = pre.nextElementSibling; pre.classList.toggle("gv-over", over); if (b && b.classList.contains("gv-cmdmore")) b.hidden = !over; }); }
    // 在跑的用时（.gv-tick，data-t0 是起点）：只换这几个字，不重画整问；一秒一次，看不见的时候不走
    function tickTm(box) { var now = Date.now(); (box || listEl).querySelectorAll(".gv-tick").forEach(function (x) { var ms = now - (+x.dataset.t0 || now), v = ms >= 1000 ? durC(ms) : ""; if (x.textContent !== v) x.textContent = v; }); }
    var tmT = setInterval(function () { if (!host.isConnected) { clearInterval(tmT); return; } if (P.off || document.hidden || !rt.stream) return; tickTm(listEl); }, 1000);
    // 离看着的那段很远（前后三屏以外）的几问才不画（.gv-far：content-visibility: hidden，高度记着）；近处的一直排好、画好——滚动时不露白、回去也不重画
    var farIO = window.IntersectionObserver ? new IntersectionObserver(function (es) { es.forEach(function (e) { e.target.classList.toggle("gv-far", !e.isIntersecting); }); }, { root: scroll, rootMargin: "300% 0px 300% 0px" }) : null;
    function add(t, before) {
      var el = document.createElement("div");
      el.className = "gv-turn";
      blocks.set(t, el);
      listEl.insertBefore(el, before || null);
      paintTurn(t, el);
      if (farIO) farIO.observe(el);
    }
    function redraw(t) { var el = blocks.get(t); if (el) paintTurn(t, el); else add(t); }
    // 输入框里的提示：连接器的会话（Claude Code、Codex）照它自己说的（后台会话能送进去、开在别的终端里只读、新会话……），同终端外壳的状态行
    var hintNow = function () { ta.placeholder = (rt.localQueued && rt.localQueued() ? "按 ↑ 编辑排队的消息" : "") || (V.claude && rt.hint && rt.hint()) || (rt.session().turns.length ? "回复…" : "要做什么？"); };
    function renderAll() {
      hintNow();
      if (farIO) farIO.disconnect();
      listEl.textContent = "";
      blocks = new Map();
      rt.session().turns.forEach(function (t) { add(t); });
      status();
      bar();
      toBottom();
    }
    var jumpShow = function () { var h = follow || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 120; if (jumpB.hidden !== h) jumpB.hidden = h; };
    var toBottom = function () { follow = true; scroll.scrollTop = scroll.scrollHeight; jumpShow(); };
    var stick = function () { if (follow && !P.off) scroll.scrollTop = scroll.scrollHeight; }; // 藏在同一组后面的（live.js bodyPanes）：不量，露出来时 unpark 贴底
    jumpB.addEventListener("click", function () { scroll.scrollTo({ top: scroll.scrollHeight, behavior: "smooth" }); follow = true; jumpB.hidden = true; });
    scroll.addEventListener("contextmenu", function (e) { if (window.TSU_TERM && TSU_TERM.transcriptCtx) TSU_TERM.transcriptCtx(e, P); }); // 消息上右键：对话里显示什么（同终端界面）
    scroll.addEventListener("scroll", function () {
      follow = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40;
      scroll.classList.toggle("gv-scrolled", scroll.scrollTop > 2); // 滚过了：上面淡出去（Claude App 风格的遮罩，见 claudeapp.css）
      jumpShow();
      if (scroll.scrollTop < 200 && rt.more && rt.more() && rt.earlier) rt.earlier(); // 会话记录只读了后面一段（Claude Code 的大会话）：滚到顶接着往前读
    }, { passive: true });
    new ResizeObserver(stick).observe(listEl);
    new ResizeObserver(stick).observe(scroll); // 对话区自己变矮 / 变高（底部多了一行在跑的、排着的、输入框长高、拖了底部）：在底下就还贴着底（排完版、画之前，不跳）
    // 点输入框外面（对话、空白处；不是输入框那一块、它弹出来的菜单）：输入框失焦（同 Claude App）。点到别的能输入的地方自然就换过去了
    if (!GUI_BLUR) { GUI_BLUR = true; document.addEventListener("mousedown", function (e) {
      var a = document.activeElement;
      if (!a || a.tagName !== "TEXTAREA" || !a.closest(".gv-comp")) return;
      if (e.target.closest && e.target.closest(".gv-comp, .gv-pop, .gv-sug, .st-menu, .st-pop, .st-palette, input, textarea, [contenteditable]")) return;
      setTimeout(function () { if (document.activeElement === a) a.blur(); }, 0);
    }, true); }
    // 点开 / 收起（思考、工具、一组）；链接在浏览器里开。
    //   展开着的卡片：点卡片里面空的地方（不是链接、按钮、图片，也不是在选字、不是双击）也收起——不用回到标题行去点小箭头；
    //   等 260ms 看是不是双击（双击是选词，不收），选了字不收
    var colT = 0;
    listEl.addEventListener("dblclick", function () { clearTimeout(colT); });
    listEl.addEventListener("click", function (e) {
      var cb = e.target.closest && e.target.closest(".gv-tool.open > .gv-det, .gv-group.open > .gv-card");
      if (cb && e.detail === 1 && !String(document.getSelection()) && !e.target.closest("a[href], button, input, textarea, select, .gv-imgs img, [data-more], [data-gmore], .gv-sum")) {
        var cbox = cb.parentNode;
        clearTimeout(colT);
        colT = setTimeout(function () {
          if (String(document.getSelection()) || !cbox.isConnected || !cbox.dataset.k) return;
          open[cbox.dataset.k] = false;
          var tEc = cbox.closest(".gv-turn"), tc = null;
          blocks.forEach(function (el, k3) { if (el === tEc) tc = k3; });
          if (tc) paintTurn(tc, tEc);
        }, 260);
        return;
      }
      var sw = e.target.closest(".gv-tr");
      if (sw && !String(document.getSelection()) && !e.target.closest("a[href], button, .gv-sum, .gv-imgs img")) {
        e.preventDefault();
        open[sw.dataset.tr] = !sw.classList.contains("on");
        var tEl0 = sw.closest(".gv-turn"), t0 = null;
        blocks.forEach(function (el, k) { if (el === tEl0) t0 = k; });
        if (t0 != null) paintTurn(t0, tEl0);
        return;
      }
      var mb = e.target.closest("[data-more], [data-gmore]");
      if (mb) { // 卡片里「… 还有 N 行」/「收起」；一组里「… 还有 N 条」/「收起前面 N 条」
        e.preventDefault();
        var kk = mb.dataset.more ? mb.dataset.more + ":all" : mb.dataset.gmore + ":more";
        open[kk] = !open[kk];
        if (mb.dataset.more) open[mb.dataset.more] = true; // 看全的时候卡片当然是开着的
        var tE = mb.closest(".gv-turn"), tt = null;
        blocks.forEach(function (el, k2) { if (el === tE) tt = k2; });
        if (tt) paintTurn(tt, tE);
        return;
      }
      var s = e.target.closest(".gv-sum"), box = s && s.parentNode;
      if (!s || !box.dataset.k) return;
      open[box.dataset.k] = !box.classList.contains("open"); // 开着（设置是完整、或点开过）就收起，反之展开
      var tEl = box.closest(".gv-turn"), t = null;
      blocks.forEach(function (el, k) { if (el === tEl) t = k; });
      if (t) paintTurn(t, tEl);
    });

    // ---- 在跑：输入框上面那一行（转着的点 · 在做什么 · 用时 · token · 不显眼的「停止」）；排着的那条也在输入框上面 ----
    // 停止不占发送键（在跑的时候发送键照样是发送：发的这条排在后面，答完接着发）：这一行最右边淡淡的「■ 停止」（指着底部才看得清）、Esc、对话 ··· 里的「停止」
    var trG = function (x) { return x && window.TSU_TRANSLATE ? TSU_TRANSLATE.text(x, agentId) : x; }; // 任务翻译（translate.js）：运行状态行那一句、任务标题
    // 转着的那个字：同终端界面那一套（· ✢ ✳ ✶ ✻ ✽ 来回换，每 120ms 一帧），不是一颗转圈的星；只在跑着、看得见时走
    var SPIN_G = ["·", "✢", "✳\uFE0E", "✶", "✻", "✽", "✽", "✻", "✶", "✳\uFE0E", "✢", "·"], spinT = 0, spinN = 0; // ✳ 后面带 U+FE0E（文字样式）：iPad、iPhone 上不带的话它画成绿底的 emoji ✳️
    function spinGo() {
      var i0 = liveEl.querySelector(".gv-spin > i");
      if (i0) i0.textContent = SPIN_G[spinN % SPIN_G.length];
      if (spinT) return;
      spinT = setInterval(function () {
        var i = liveEl.querySelector(".gv-spin > i");
        if (!i || liveEl.hidden || !rt.stream || !liveEl.isConnected) { clearInterval(spinT); spinT = 0; return; }
        if (document.hidden) return;
        i.textContent = SPIN_G[++spinN % SPIN_G.length];
      }, 120);
    }
    function status() {
      var s = rt.stream, wl = vm("workLine") || "full"; // 运行状态行：完整 / 简洁（转圈和用时）/ 隐藏（Esc、对话 ··· 照样能停）
      var STOPB = ""; // 不再画「■ 停止」（用户不要：跑着的时候没事不打断；要停用 Esc、对话 ···）。以前还和强度滑条的刻度撞了类名，跑到输入框下面压着 +
      liveEl.hidden = !s || wl === "hidden";
      if (s && wl === "brief") { var hb = '<div class="gv-spin brief"><i>·</i><span class="gv-dim">' + (s.wait ? "等待重试 · " : "") + dur(Date.now() - s.t0) + "</span>" + STOPB + "</div>"; if (liveEl.dataset.h !== hb) { liveEl.dataset.h = hb; liveEl.innerHTML = hb; } spinGo(); }
      else if (s && wl !== "hidden") {
        var act = (rt.todo ? rt.todo() : []).filter(function (x) { return x.status === "in_progress" && x.activeForm; })[0];
        // 同终端界面（Claude Code）：在做的任务的 activeForm，没有就是这一问随机的那个词（Concocting… Swirling…）；等模型、思考中写在后面淡的那段
        var label = s.wait ? "等待重试" : act ? trG(act.activeForm) : s.verb || "Working", phase = s.wait ? "" : !s.firstAt ? "等待模型" : s.thinking ? "思考中" : "";
        var h = '<div class="gv-spin"><i>·</i><span class="gv-cut">' + esc(label) + '…</span><span class="gv-dim">' + dur(Date.now() - s.t0) + (s.outTokens ? " · ↓ " + (s.outTokens >= 1000 ? (s.outTokens / 1000).toFixed(1) + "k" : s.outTokens) + " tokens" : "") + "</span>" + (phase ? '<span class="gv-dim gv-phase">' + esc(phase) + "</span>" : "") + STOPB + "</div>";
        if (liveEl.dataset.h !== h) { liveEl.dataset.h = h; liveEl.innerHTML = h; }
        spinGo();
      }
      var todo = rt.todo ? rt.todo() : [], openT = todo.filter(function (x) { return x.status !== "completed"; }), SU = window.STUDIO;
      // 任务清单放「输入框上方」才画在这里（也能放 Agent 底部抽屉、Agent 侧栏或隐藏；⌃T 收起 / 展开）。在做的在前、没开始的其次（多了收成「还有 n 项」），做完的收成「n 项已完成」
      var todoHere = !SU || !SU.inline || SU.inline(P, "tasks") && (!SU.todoShown || SU.todoShown(agentId));
      todoEl.hidden = !openT.length || !todoHere;
      if (openT.length && todoHere) {
        var ordT = openT.filter(function (x) { return x.status === "in_progress"; }).concat(openT.filter(function (x) { return x.status !== "in_progress"; })), doneT = todo.filter(function (x) { return x.status === "completed"; }), nT = todoEl._all ? ordT.length : 6;
        var liT = function (x) { return '<div class="gv-todoi ' + x.status + '"><span class="gv-task' + (x.status === "completed" ? " done" : x.status === "in_progress" ? " doing" : "") + '"></span>' + esc(trG(x.status === "in_progress" && x.activeForm ? x.activeForm : x.subject)) + "</div>"; };
        var th = '<div class="gv-todoh">任务 ' + doneT.length + " / " + todo.length + "</div>" + ordT.slice(0, nT).map(liT).join("") + (ordT.length > nT ? '<div class="gv-todoi gv-todom" data-todo="all"><span>' + esc("还有 " + (ordT.length - nT) + " 项") + "</span></div>" : "") +
          (doneT.length ? '<div class="gv-todoi gv-todom" data-todo="done"><span class="gv-tchev">' + (todoEl._done ? "▾" : "▸") + "</span><span>" + esc(doneT.length + " 项已完成") + "</span></div>" + (todoEl._done ? doneT.map(liT).join("") : "") : "");
        if (!todoEl._bound) { todoEl._bound = true; todoEl.addEventListener("click", function (e) { var t = e.target.closest("[data-todo]"); if (!t) return; if (t.dataset.todo === "all") todoEl._all = !todoEl._all; else todoEl._done = !todoEl._done; status(); }); }
        if (todoEl.dataset.h !== th) { todoEl.dataset.h = th; todoEl.innerHTML = th; }
      }
      // 排着的那条（在跑的时候又发的：答完接着发）：立即发送（打断这一轮马上发）、编辑（拿回输入框，同 Esc）；送进去还没被读到的几条（Claude Code 的后台会话）
      var pm = rt.pendingMsgs ? rt.pendingMsgs() : 0, pq = [];
      if (rt.queued) pq.push({ text: rt.queued.text, local: true });
      if (rt.pending) rt.pending().forEach(function (q) { pq.push(q); });
      var canNow = !!rt.sendNow && pq.some(function (q) { return q.local; }), canEdit = !!rt.takeQueued && (!!rt.queued || !!(rt.localQueued && rt.localQueued()));
      var qh = pq.length ? pq.map(function (q) {
        if (q.from) return '<div class="gv-pq gv-pqfrom"><span class="gv-dim">@' + esc(q.from) + " · </span>" + esc(clip(q.text, 200)) + "</div>";
        return '<div class="gv-user gv-pq"><div class="gv-bubble">' + esc(q.text).replace(/\n/g, "<br>") + "</div></div>";
      }).join("") + '<div class="gv-pqh"><span class="gv-dim">排队中 · ctrl+x ctrl+s ' + (canNow ? '</span><button type="button" class="gv-qlink" data-g="q-now" title="中断当前回合，将排队的消息合并后立即发送">' + (EN() ? "send now" : "立即发送") + "</button>" : "立即发送</span>") + // 「立即发送」这几个字就能点（用户：比另外一个按钮顺手）
 (canEdit ? '<button type="button" class="gv-qb" data-g="q-edit" title="移回输入框编辑 (↑)">编辑</button>' : "") + "</div>"
        : pm ? '<div class="gv-pqh"><span class="gv-dim">' + esc(pm + " 条消息等它下一步读到") + "</span></div>" : "";
      qEl.hidden = !qh;
      if (qEl.dataset.h !== qh) { qEl.dataset.h = qh; qEl.innerHTML = qh; }
      // 发送键一直是发送（在跑的时候发 = 排在后面）
      if (sendB.dataset.s !== "send") { sendB.dataset.s = "send"; sendB.classList.remove("stop"); sendB.innerHTML = ICON.ret; }
      sendB.title = s ? "发送 (↵) · 答完接着发" : "发送 (↵)";
      sendB.classList.toggle("ready", !!(ta.value.trim() || attach.length));
      stick();
    }
    // 子 agent 不在底部了：在右边的辅助侧栏（任务清单 → 后台任务 → 子 Agent 一家子，studio.js）。底部只有在跑的那一行（+ 排着的）、输入框、下面一排
    // ---- 输入框下面那一排：权限、模型、推理强度、上下文 ----
    var ACC = { none: "仅自己的文件夹", read: "只读", rw: "读写" }, EFF = { off: "关", low: "低", high: "高", max: "最高" };
    function bar() {
      var m = rt.model() || {}, c = rt.ctx ? rt.ctx() : null, set = function (k, html, show) { var b = inCol('[data-c="' + k + '"]'); b.hidden = !show; if (b.dataset.h !== html) { b.dataset.h = html; b.innerHTML = html; } };
      set("access", '<svg viewBox="0 0 16 16"><path d="M5 7V5a3 3 0 0 1 6 0v2"/><rect x="3.5" y="7" width="9" height="6.5" rx="1.2"/></svg>' + esc(ACC[agent.access || "read"] || agent.access), !V.claude);
      set("model", esc(m.name || m.id || "模型"), true); // 连接器的会话：模型（真在用的，带 1M）；后面不再挂会话名（用户：没有意义）
      set("effort", "推理 " + esc(EFF[agent.effort || "high"] || agent.effort), !V.claude);
      var pct = c && c.pct ? Math.min(100, c.pct) : 0, ring = inCol(".gv-ringv"), R = 2 * Math.PI * 7;
      ring.style.strokeDasharray = (R * pct / 100).toFixed(1) + " " + R.toFixed(1);
      inCol(".gv-ring").title = "上下文 " + Math.round(pct) + "%";
      inCol(".gv-ring").hidden = !!(A && A.cfg && A.cfg.footInfo === false); // 状态信息关了（设置 › 对话 › 显示、对话 ···）：上下文这一圈也收起（权限、模型、推理强度是按钮，留着）
      inCol('[data-c="attach"]').hidden = true; // 「+」不要了（点了只有一个「添加文件或照片…」，还常常没反应）：图片拖进来、粘贴照样行
    }
    // ---- 浮层：贴在按钮上面，点外面 / Esc 关 ----
    var popEl = null;
    function closePop() { if (popEl) { popEl.remove(); popEl = null; document.removeEventListener("pointerdown", outPop, true); document.removeEventListener("keydown", escPop, true); } }
    function outPop(e) { if (popEl && !popEl.contains(e.target) && !e.target.closest(".gv-bar [data-c]")) closePop(); }
    function escPop(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePop(); ta.focus(); } }
    function pop(el, html, cls) {
      var same = popEl && popEl.dataset.for === el.dataset.c;
      closePop();
      if (same) return null;
      popEl = document.createElement("div");
      popEl.className = "gv-pop " + (cls || "");
      popEl.dataset.for = el.dataset.c;
      popEl.innerHTML = html;
      // 输入框那一列搬到面板里了：浮层放到页面最上面一层（不被面板裁掉；坐标按窗口算）
      var layer = host.contains(el) ? host : floatLayer();
      layer.appendChild(popEl);
      var r = el.getBoundingClientRect(), hr = layer.getBoundingClientRect(), w = popEl.offsetWidth, h = popEl.offsetHeight;
      popEl.style.left = Math.max(8, Math.min(hr.width - w - 8, r.left - hr.left + r.width / 2 - w / 2)) + "px";
      popEl.style.top = Math.max(8, r.top - hr.top - h - 8) + "px";
      document.addEventListener("pointerdown", outPop, true);
      document.addEventListener("keydown", escPop, true);
      return popEl;
    }
    var yuan = function (x) { return "¥" + +(+x || 0).toFixed(3); };
    // 推理强度：一条滑杆（更快 ↔ 更聪明），点哪一档就是哪一档，也能拖、←→
    function effortPop(el) {
      var E = A.EFFORTS, cur = Math.max(0, E.indexOf(agent.effort || "high"));
      var draw = function () {
        cur = Math.max(0, E.indexOf(agent.effort || "high"));
        return '<div class="gv-ph"><span class="gv-dim">推理强度</span><b>' + esc(EFF[E[cur]] || E[cur]) + '</b></div><div class="gv-ends"><span>更快</span><span>更聪明</span></div>' +
          '<div class="gv-track" tabindex="0">' + E.map(function (x, i) { return '<span class="gv-tstop' + (i === cur ? " on" : "") + '" data-i="' + i + '" style="--p:' + (i / (E.length - 1)) + '"></span>'; }).join("") + '<span class="gv-thumb" style="--p:' + (cur / (E.length - 1)) + '"></span></div>' +
          '<div class="gv-names">' + E.map(function (x, i) { return '<span class="' + (i === cur ? "on" : "") + '" style="--p:' + (i / (E.length - 1)) + '">' + esc(EFF[x] || x) + "</span>"; }).join("") + "</div>";
      };
      var p = pop(el, draw(), "gv-pop-effort");
      if (!p) return;
      var set = function (i) { i = Math.max(0, Math.min(E.length - 1, i)); if (E[i] !== agent.effort) { rt.setEffort(E[i]); bar(); } p.innerHTML = draw(); var t2 = p.querySelector(".gv-track"); if (t2) t2.focus(); };
      var at = function (x) { var tr = p.querySelector(".gv-track").getBoundingClientRect(); return Math.round((x - tr.left - 14) / Math.max(1, tr.width - 28) * (E.length - 1)); }; // 两头各留 14px（滑块的一半）
      p.addEventListener("pointerdown", function (e) {
        if (!e.target.closest(".gv-track")) return;
        e.preventDefault();
        set(at(e.clientX));
        var mv = function (ev) { set(at(ev.clientX)); }, up = function () { document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); };
        document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
      });
      p.addEventListener("keydown", function (e) { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); set(cur + (e.key === "ArrowRight" ? 1 : -1)); } else if (e.key === "Enter") { closePop(); ta.focus(); } });
      p.querySelector(".gv-track").focus();
    }
    // 上下文：用了多少（一条用量条）；下面是余额、这段会话花了多少、模型的价格
    function ctxPop(el) {
      var c = rt.ctx ? rt.ctx() : null, me = A.me() || {}, m = A.modelOf ? A.modelOf((rt.model() || {}).id) : null, F = A.fmt || {}, k = function (n) { return String(F.k ? F.k(n) : n).replace(/m$/, "M"); };
      var pct = c && c.pct ? Math.min(100, c.pct) : 0, used = c ? c.tokens || 0 : 0, win = c ? c.window || (m && m.ctx) || 0 : 0;
      var rows = [];
      if (!V.claude && me.allowed && me.balance !== undefined) rows.push(["余额", F.money ? F.money(me.balance) : yuan(me.balance)]);
      if (!V.claude && rt.cost) rows.push(["本段会话", F.money ? F.money(rt.cost()) : yuan(rt.cost())]);
      if (m && m.in !== undefined) rows.push(["价格（每百万 token）", "输入 " + yuan(m.in) + " · 输出 " + yuan(m.out)]);
      // 上面是上下文的明细（ctxmap.js：每一块多少、占比、可展开的每一项）；没有它：退回一条总的占用
      var top = window.TSU_CTX ? TSU_CTX.html(rt) : '<div class="gv-ph"><span>上下文窗口</span><span class="gv-fill"></span><span class="gv-dim">' + k(used) + " / " + k(win) + "（" + Math.round(pct) + "%）</span></div>" +
        '<div class="gv-meter"><span style="width:' + pct.toFixed(1) + '%"' + (pct > 85 ? ' class="hot"' : "") + "></span></div>";
      var p = pop(el, top + (rows.length ? '<div class="gv-psep"></div>' + rows.map(function (r) { return '<div class="gv-prow"><span>' + esc(r[0]) + '</span><span class="gv-dim">' + esc(r[1]) + "</span></div>"; }).join("") : ""), "gv-pop-ctx");
      if (p && window.TSU_CTX) TSU_CTX.bind(p);
    }
    // 一列可选的（模型、权限）：名字、下面一行说明，当前的有 ✓
    function listPop(el, items, cls) {
      var p = pop(el, items.map(function (x, i) { return '<div class="gv-opt' + (x.on ? " on" : "") + '" data-i="' + i + '" tabindex="-1"><span class="gv-ck">' + (x.on ? "✓" : "") + '</span><span class="gv-om"><span class="gv-on">' + esc(x.label) + "</span>" + (x.desc ? '<span class="gv-od">' + esc(x.desc) + "</span>" : "") + "</span></div>"; }).join(""), "gv-pop-list " + (cls || ""));
      if (!p) return;
      var sel = Math.max(0, items.findIndex(function (x) { return x.on; }));
      var hi = function () { p.querySelectorAll(".gv-opt").forEach(function (o, i) { o.classList.toggle("kf", i === sel); }); var o2 = p.querySelectorAll(".gv-opt")[sel]; if (o2) o2.focus({ preventScroll: true }); };
      p.addEventListener("click", function (e) { var o = e.target.closest(".gv-opt"); if (o) { items[+o.dataset.i].run(); closePop(); ta.focus(); } });
      p.addEventListener("keydown", function (e) { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1))); hi(); } else if (e.key === "Enter") { e.preventDefault(); items[sel].run(); closePop(); ta.focus(); } });
      hi();
    }
    // 模型：提供方 › 模型两级——左边一列提供方（指着哪家右边就是它的模型），右边是模型和价格；←→ 在两列之间，↑↓ 选，回车定
    function modelPop(el) {
      var ms = A.models(), cur = rt.model() || {}, pv = A.providerOf || function () { return ""; }, pr = (A.me() || {}).pricing || {}, F = A.fmt || {};
      var provs = [];
      ms.forEach(function (x) { var p0 = pv(x); if (provs.indexOf(p0) < 0) provs.push(p0); });
      var ap = Math.max(0, provs.indexOf(pv(A.modelOf(cur.id) || cur))), col = 0, mi = 0;
      var listOf = function () { return ms.filter(function (x) { return pv(x) === provs[ap]; }); };
      var desc = function (x) { var f = pr.peak === false && x.offpeak ? x.offpeak : 1; return "输入 " + yuan(x.in * f) + " · 输出 " + yuan(x.out * f) + (x.ctx ? " · " + String(F.k ? F.k(x.ctx) : x.ctx).replace(/m$/, "M") + " 上下文" : "") + (x.vision ? " · 支持图片" : ""); };
      var draw = function () {
        var L0 = listOf();
        return '<div class="gv-casc"><div class="gv-provs">' + provs.map(function (p0, i) { return '<div class="gv-prov' + (i === ap ? " on" : "") + (col === 0 && i === ap ? " kf" : "") + '" data-p="' + i + '"><span>' + esc(p0) + '</span><span class="gv-dim">' + ms.filter(function (x) { return pv(x) === p0; }).length + '</span><i></i></div>'; }).join("") + "</div>" +
          '<div class="gv-models">' + L0.map(function (x, i) { return '<div class="gv-opt' + (x.id === cur.id ? " on" : "") + (col === 1 && i === mi ? " kf" : "") + '" data-m="' + esc(x.id) + '"><span class="gv-ck">' + (x.id === cur.id ? "✓" : "") + '</span><span class="gv-om"><span class="gv-on">' + esc(x.name) + '</span><span class="gv-od">' + esc(desc(x)) + "</span></span></div>"; }).join("") + "</div></div>";
      };
      var p = pop(el, draw(), "gv-pop-model");
      if (!p) return;
      p.tabIndex = -1;
      var redraw = function () { p.innerHTML = draw(); };
      var pick = function (id) { rt.setModel(id); bar(); closePop(); ta.focus(); };
      p.addEventListener("mouseover", function (e) { var r = e.target.closest(".gv-prov"); if (r && +r.dataset.p !== ap) { ap = +r.dataset.p; mi = 0; col = 0; redraw(); } });
      p.addEventListener("click", function (e) { var o = e.target.closest("[data-m]"); if (o) pick(o.dataset.m); });
      p.addEventListener("keydown", function (e) {
        var L0 = listOf();
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); var d = e.key === "ArrowDown" ? 1 : -1; if (col === 0) { ap = Math.max(0, Math.min(provs.length - 1, ap + d)); mi = 0; } else mi = Math.max(0, Math.min(L0.length - 1, mi + d)); redraw(); }
        else if (e.key === "ArrowRight" && col === 0) { e.preventDefault(); col = 1; mi = Math.max(0, L0.findIndex(function (x) { return x.id === cur.id; })); redraw(); }
        else if (e.key === "ArrowLeft" && col === 1) { e.preventDefault(); col = 0; redraw(); }
        else if (e.key === "Enter") { e.preventDefault(); if (col === 0) { col = 1; mi = 0; redraw(); } else if (L0[mi]) pick(L0[mi].id); }
      });
      p.focus();
    }
    var ACC_DESC = { none: "只能读写自己的文件夹", read: "可以读取其他位置，不能修改", rw: "可以读写其他位置" };
    host.querySelector(".gv-bar").addEventListener("click", function (e) {
      var b = e.target.closest("[data-c]");
      if (!b) return;
      var k = b.dataset.c;
      if (k === "attach") return plusMenu(b);
      if (k === "access") return listPop(b, Object.keys(ACC).map(function (a) { return { label: ACC[a], desc: ACC_DESC[a], on: (agent.access || "read") === a, run: function () { rt.setAccess(a); bar(); } }; }));
      if (k === "effort") return effortPop(b);
      if (k === "ctx") return ctxPop(b);
      // 模型：Paimon 的走提供方 › 模型；连接器的会话（Claude Code、Codex）列连接器给的（id 原样，[1m] 也在），选了下一句起用上
      if (k === "model") return !V.claude ? modelPop(b) : rt.models ? listPop(b, rt.models().map(function (x) { return { label: x.name, desc: "", on: (rt.model() || {}).id === x.id, run: function () { rt.setModel(x.id); bar(); } }; })) : null;
    });

    // ---- 输入 ----
    var T = window.TSU_TERM, drafts = T && T.draft;
    // 输入框跟着字长高：用一个看不见的同款 textarea 量（不把真的那个先缩成 auto——一缩对话区就变高、滚动位置被截到新的底，再长回去最后几行就被盖住，
    // 每打一个字对话一跳）；高度真变了才改，改了在底下的就还贴着底
    var sizer = null;
    function grow() {
      if (!sizer) { sizer = ta.cloneNode(false); sizer.removeAttribute("id"); sizer.removeAttribute("name"); sizer.tabIndex = -1; sizer.setAttribute("aria-hidden", "true"); sizer.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;height:auto;"; ta.parentNode.appendChild(sizer); }
      sizer.style.width = ta.offsetWidth + "px";
      sizer.value = ta.value;
      var h = Math.min(sizer.scrollHeight, 260) + "px";
      if (ta.style.height === h) return;
      var pin = follow || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 2;
      ta.style.height = h;
      if (pin) { follow = true; scroll.scrollTop = scroll.scrollHeight; }
    }
    function atts() {
      attEl.hidden = !attach.length;
      sendB.classList.toggle("ready", !!(ta.value.trim() || attach.length));
      attEl.innerHTML = attach.map(function (im, i) { return '<span class="gv-attimg"><img src="data:' + im.media_type + ";base64," + im.data + '" alt=""><button data-i="' + i + '" title="移除">×</button></span>'; }).join("");
    }
    attEl.addEventListener("click", function (e) { var b = e.target.closest("button[data-i]"); if (b) { attach.splice(+b.dataset.i, 1); atts(); } });
    function addImage(file) {
      if (!file || !/^image\//.test(file.type)) return;
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 1568 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        var type = file.type === "image/png" ? "image/png" : "image/jpeg", data = c.toDataURL(type, 0.9);
        attach.push({ media_type: type, data: data.slice(data.indexOf(",") + 1) });
        URL.revokeObjectURL(url);
        atts();
      };
      img.src = url;
    }
    fileIn.addEventListener("change", function () { Array.prototype.forEach.call(fileIn.files || [], addImage); fileIn.value = ""; });
    // 「+」（同 Claude App）：马上出一个小菜单——添加文件或照片…（系统的选文件窗口）、截取屏幕（有屏幕录制权限时，不拍 Vibing Studio 自己）。
    //   以前一点就直接开选文件的窗口：要等它从窗口顶上滑下来，看着像卡住了
    var screenOK = false;
    if (window.nadosNative) nadosNative.call("permissions").then(function (r) { screenOK = !!(r && r.screen === "granted"); }, function () {});
    function plusMenu(b) {
      var SU = window.STUDIO, MI0 = SU && SU.menuIcons ? SU.menuIcons() : {};
      if (!SU || !SU.menu) return fileIn.click();
      SU.menu([
        { label: "添加文件或照片…", icon: MI0.image, run: function () { fileIn.click(); } },
        screenOK ? { label: "截取屏幕", icon: MI0.window, run: function () {
          nadosNative.call("screenshot", { excludeSelf: true, format: "jpeg", quality: 0.85, maxWidth: 1568 }).then(function (r) {
            var m = /^data:([^;]+);base64,(.*)$/.exec((r && r.dataURL) || "");
            if (m) { attach.push({ media_type: m[1], data: m[2] }); atts(); ta.focus(); }
          }, function () {});
        } } : null,
      ].filter(Boolean), { el: b, side: "above" });
    }
    ta.addEventListener("paste", function (e) { Array.prototype.forEach.call((e.clipboardData && e.clipboardData.items) || [], function (it) { if (it.kind === "file" && /^image\//.test(it.type)) { e.preventDefault(); addImage(it.getAsFile()); } }); });
    host.addEventListener("dragover", function (e) { if (e.dataTransfer && Array.prototype.some.call(e.dataTransfer.items || [], function (x) { return x.kind === "file"; })) e.preventDefault(); });
    host.addEventListener("drop", function (e) { var fs = e.dataTransfer && e.dataTransfer.files; if (fs && fs.length) { e.preventDefault(); e.stopPropagation(); Array.prototype.forEach.call(fs, addImage); } });
    ta.addEventListener("input", function () { grow(); sendB.classList.toggle("ready", !!(ta.value.trim() || attach.length)); if (drafts) drafts(agentId, ta.value); sugUpdate(); });
    // / 命令（Paimon Code）：常用的几个；Claude Code 的会话里 / 命令交给 Claude Code 自己
    var CMDS = [
      { name: "/model", label: "切换模型", run: function () { inCol('[data-c="model"]').click(); } },
      { name: "/effort", label: "推理强度", run: function () { inCol('[data-c="effort"]').click(); } },
      { name: "/context", label: "上下文明细", run: function () { var b = inCol('[data-c="ctx"]'); if (b && !b.hidden) b.click(); else if (window.TSU_CTX) TSU_CTX.open(rt, ta, {}); } },
      { name: "/permissions", label: "权限", run: function () { inCol('[data-c="access"]').click(); } },
      { name: "/tui", label: "切换到终端界面", run: function () { if (T && T.setUI) T.setUI(P, "tui"); } },
      { name: "/admin", label: "管理员：增加额度、授权账号", admin: true, run: function () { var me = A && A.me ? A.me() || {} : {}; ta.value = "/admin credit " + (me.login || "") + " "; grow(); sendB.classList.add("ready"); ta.focus(); } },
    ];
    var isAdmin = function () { return !!(A && A.me && (A.me() || {}).admin); };
    // 打 / 的时候输入框上面出一小列命令（同 Claude App）：不抢键盘，接着打字就是在筛选；↑↓ 选，回车 / Tab 选定，Esc 收起
    var sug = null, compEl = host.querySelector(".gv-comp");
    function sugList() {
      var m = !V.claude && /^\/(\S*)$/.exec(ta.value);
      if (!m) return [];
      var q = m[1].toLowerCase(), rank = function (c) { var n = c.name.slice(1); return n.indexOf(q) === 0 ? 0 : n.indexOf(q) > 0 || c.label.indexOf(q) >= 0 ? 1 : -1; };
      return CMDS.filter(function (c) { return !c.admin || isAdmin(); }).map(function (c) { return [rank(c), c]; }).filter(function (x) { return x[0] >= 0; }).sort(function (a, b) { return a[0] - b[0]; }).map(function (x) { return x[1]; });
    }
    function sugPaint() {
      sug.el.innerHTML = sug.items.map(function (c, i) { return '<div class="gv-sugi' + (i === sug.sel ? " on" : "") + '" data-i="' + i + '"><span class="gv-sugn">' + esc(c.name) + '</span><span class="gv-sugd">' + esc(c.label) + "</span></div>"; }).join("");
    }
    function sugClose() { if (sug) { sug.el.remove(); sug = null; } }
    function sugUpdate() {
      var items = sugList();
      if (!items.length) return sugClose();
      if (!sug) {
        sug = { el: document.createElement("div"), sel: 0, items: items };
        sug.el.className = "gv-sug";
        sug.el.addEventListener("mousedown", function (e) { e.preventDefault(); var r = e.target.closest(".gv-sugi"); if (r) sugPick(+r.dataset.i); }); // 按下不让输入框失焦
        sug.el.addEventListener("mousemove", function (e) { var r = e.target.closest(".gv-sugi"); if (r && sug && +r.dataset.i !== sug.sel) { sug.sel = +r.dataset.i; sugPaint(); } });
        compEl.appendChild(sug.el);
      }
      var keep = sug.items[sug.sel];
      sug.items = items;
      sug.sel = Math.max(0, items.indexOf(keep));
      sugPaint();
    }
    function sugPick(i) {
      var c = sug && sug.items[i];
      sugClose();
      if (!c) return;
      ta.value = ""; grow(); sendB.classList.remove("ready");
      if (drafts) drafts(agentId, "");
      c.run();
    }
    ta.addEventListener("blur", sugClose);
    function submit() {
      var v = ta.value, imgs = attach.slice();
      if (!v.trim() && !imgs.length) { if ((rt.queued || (rt.pending && rt.pending().some(function (q) { return q.local; }))) && rt.sendNow) (rt.sendQueuedNow ? rt.sendQueuedNow() : rt.sendNow("", [])); return; } // 空着回车：排着的马上发（同 Claude Code 的「Enter to send them now」）
      var w = v.trim().split(/\s+/)[0], c = !V.claude && CMDS.filter(function (x) { return x.name === w; })[0];
      ta.value = ""; attach = []; atts(); grow();
      if (drafts) drafts(agentId, "");
      if (!V.claude && w === "/admin" && A && A.adminCommand) { A.adminCommand(v.trim().slice(6)).then(function (msg) { if (rt.record) rt.record(v.trim(), msg); toBottom(); }); return; } // 带参数的：直接办，不发给模型
      if (c) return c.run();
      if (!V.claude && v.trim()[0] === "!" && rt.bang) { rt.bang(v.trim().slice(1).trim()); toBottom(); return; }
      rt.send(v, imgs);
      toBottom();
    }
    var gCx = 0; // ctrl+x 按下的时间（等 ctrl+s）
    ta.addEventListener("keydown", function (e) {
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "t" || e.key === "T") && window.STUDIO && STUDIO.toggleTodo) { e.preventDefault(); STUDIO.toggleTodo(agentId); status(); return; } // ⌃T：任务清单收起 / 展开（同终端界面；在哪都行）
      if (sug) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sug.sel = (sug.sel + (e.key === "ArrowDown" ? 1 : -1) + sug.items.length) % sug.items.length; sugPaint(); return; }
        if ((e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) || e.key === "Tab") { e.preventDefault(); sugPick(sug.sel); return; }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); sugClose(); return; }
      }
      // 排着的马上发：ctrl+x ctrl+s（同 Claude Code）、ctrl+enter（输入框空着时）；排着的拿回来改：空着按 ↑
      var hasQ = !!rt.queued || (rt.pending && rt.pending().some(function (q) { return q.local; }));
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "x" || e.key === "X")) { gCx = Date.now(); e.preventDefault(); return; }
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "s" || e.key === "S") && Date.now() - gCx < 2000) { gCx = 0; e.preventDefault(); if (hasQ && rt.sendNow) (rt.sendQueuedNow ? rt.sendQueuedNow() : rt.sendNow("", [])); return; }
      if (e.key === "Enter" && e.ctrlKey && !ta.value.trim() && !attach.length && hasQ && rt.sendNow) { e.preventDefault(); (rt.sendQueuedNow ? rt.sendQueuedNow() : rt.sendNow("", [])); return; }
      if (e.key === "ArrowUp" && !ta.value && rt.takeQueued && (rt.queued || (rt.localQueued && rt.localQueued()))) { var q0 = rt.takeQueued(); if (q0) { e.preventDefault(); ta.value = q0.text; attach = (q0.images || []).concat(attach); atts(); grow(); status(); return; } }
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(); return; }
      if (e.key === "Escape") {
        if (rt.queued && rt.takeQueued) { e.preventDefault(); var q = rt.takeQueued(); ta.value = q.text + (ta.value ? "\n" + ta.value : ""); attach = (q.images || []).concat(attach); atts(); grow(); status(); return; }
        if (rt.stream && rt.interrupt && rt.interrupt()) { e.preventDefault(); return; }
      }
    });
    sendB.addEventListener("click", function () { submit(); ta.focus(); }); // 在跑的时候也是发送：排在后面（停止在在跑那一行、Esc、对话 ···）
    // 在跑那一行的「停止」；排着那条的「立即发送」「编辑」
    // 排着的那几条现在画在对话最后（.gv-queued 在滚动区里，不在输入框那一列上）：它的「立即发送」「编辑」也要接得到——同一个处理挂在两处
    var onColClick = function (e) { // 在输入框那一列上（搬到面板里也跟着）
      var b = e.target.closest("[data-g]");
      if (!b) return;
      if (b.dataset.g === "stop") { if (rt.interrupt) rt.interrupt(); }
      else if (b.dataset.g === "q-now") { if (rt.sendNow) (rt.sendQueuedNow ? rt.sendQueuedNow() : rt.sendNow("", [])); }
      else if (b.dataset.g === "q-edit" && (rt.queued || (rt.localQueued && rt.localQueued())) && rt.takeQueued) { var q = rt.takeQueued(); if (q) { ta.value = q.text + (ta.value ? "\n" + ta.value : ""); attach = (q.images || []).concat(attach); atts(); grow(); } }
      else return;
      status();
      ta.focus();
    };
    colEl.addEventListener("click", onColClick);
    // 排着的那几条画在对话最后（.gv-queued 在滚动区里，不在输入框那一列上）：它的「立即发送」「编辑」也接上（以前只挂在输入框那一列，点了没反应）
    qEl.addEventListener("click", function (e) { var b = e.target.closest("[data-g]"); if (b && /^q-/.test(b.dataset.g) && !colEl.contains(b)) onColClick(e); });

    // ---- 运行时的事件 → 重画对应的部分 ----
    var pend = new Set(), raf = 0;
    var soon = function (t) { if (t) pend.add(t); if (raf) return; raf = requestAnimationFrame(function () { raf = 0; pend.forEach(redraw); pend.clear(); status(); }); };
    var off1 = rt.on(function (type, data) {
      if (!shown) return;
      if (type === "append") { add(data); stick(); }
      else if (type === "turn") soon(data);
      else if (type === "reset") renderAll();
      else if (type === "prepend") { var h0 = scroll.scrollHeight, t0 = scroll.scrollTop; renderAll(); follow = false; scroll.scrollTop = t0 + (scroll.scrollHeight - h0); }
      else if (type === "tick") { status(); if (rt.stream && rt.stream.turn) soon(rt.stream.turn); }
      else if (type === "status" || type === "state" || type === "tasks") { status(); bar(); if (V.claude) hintNow(); if (P.win) { if (P.win.syncTitlesSoon) P.win.syncTitlesSoon(); else P.win.syncTitles(); } }
      else if (type === "config") { bar(); if (V.claude) hintNow(); }
    });
    var off2 = A.on(function (type) { if (shown && (type === "me" || type === "cfg")) { bar(); if (type === "cfg") renderAll(); } });

    V.refreshStatus = function () { status(); }; // 任务清单换了位置、⌃T（studio.js）：输入框上方那一块重画
    V.render = function () {
      host.hidden = false;
      if (!shown) { shown = true; var d = drafts ? drafts(agentId) : ""; if (d && !ta.value) ta.value = d; grow(); }
      renderAll();
    };
    // 换标签页时这一格被从页面上拿下来再放回去（live.js P.park / P.reshow）：不整段重画，回到离开时看着的地方（贴底的接着贴底）
    var parkedAt = null;
    V.park = function () { if (shown && scroll.isConnected && scroll.clientHeight) parkedAt = { follow: follow, top: scroll.scrollTop }; };
    V.unpark = function () { var s0 = parkedAt; parkedAt = null; if (!shown) return; if (!s0 || s0.follow) toBottom(); else { follow = false; scroll.scrollTop = s0.top; jumpShow(); } };
    V.detach = function () { if (host.classList.contains("gv-docked")) V.dock(null); off1(); off2(); closePop(); sugClose(); host.remove(); shown = false; }; // 输入框那一列在面板里：先搬回来，一起收走
    V.focus = function () { ta.focus({ preventScroll: true }); };
    V.exportText = function () { return rt.session().turns.map(function (t) { return (t.ask ? "> " + t.ask + "\n\n" : "") + (t.parts || []).filter(function (p) { return p.kind === "text"; }).map(function (p) { return p.text; }).join("\n\n"); }).join("\n\n"); };
    // 搜索结果：滚到那一问，闪一下
    V.reveal = function (t) {
      var el = blocks.get(t);
      if (!el) return false;
      follow = false;
      scroll.scrollTop = Math.max(0, el.offsetTop - scroll.clientHeight / 3);
      el.classList.remove("st-flash"); void el.offsetWidth; el.classList.add("st-flash");
      return true;
    };
  }

  window.TSU_GUI = { view: function (P, id) { return new GuiView(P, id); }, md: md, detail: detail, title: title }; // detail(p, short)：一次工具调用的结果（快速查看、缩略图也用）
  // GUI 下面的一种外壳：「Claude App 风格」（ext.js 的 TSU_WRAPPERS；任何连接器的会话都能用它看）
  if (window.TSU_WRAPPERS) TSU_WRAPPERS.register({ id: "claude-app", kind: "gui", name: "Claude App 风格", make: function (P, id) { var v = new GuiView(P, id); v.wrapper = "claude-app"; return v; } });
})();
