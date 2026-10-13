// dash.js —— 两个页面：
//   dash.local.paimon      仪表盘（原来的 local.paimon: 主页）：在跑的、最近的 agent；样子跟着「界面」——终端界面是等宽字的一张表，图形界面是卡片
//   explorer.local.paimon  资源管理器（同访达），两边：File Finder（finder.local.paimon/…）整台 Mac 的文件；Agent Finder（agents.local.paimon/…）agent 们——
//                          卷（Local 这台 Mac / Cloud / 别的 Mac）› 任意多层的文件夹 › 名字.agent（同 macOS 的 .app 包）：双击打开对话，「显示包内容」进去看
//                          它的会话、记忆、文件（它自己的文件夹：Paimon 的 agent 没有工作目录）、身份卡；文件夹能新建、改名、拖着移、删空的。
//                          图标 / 列表……几种看法，右边是预览栏，空格快速查看
(function () {
  "use strict";
  var S = window.STUDIO, A = window.TSU_AGENTS;
  if (!S || !S.pages || !A) return;
  var T = function () { return window.TSU_TERM; }, root = document.documentElement;
  var LOC = function () { return window.TSU_LOCAL; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var clip = function (s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  var gui = function () { return document.documentElement.classList.contains("st-gui"); };
  var home = function () { var i = LOC() && LOC().info(); return i ? i.home : ""; };
  var tilde = function (p) { var h = home(); return h && p && (p === h || p.indexOf(h + "/") === 0) ? "~" + p.slice(h.length) : p || ""; };
  var ago = function (t) { return T() && T().ago ? T().ago(t) : ""; };
  // 日期（同访达）：今天 / 昨天 / 前天 + 时间，再早的写日期
  var when = function (t) {
    if (!t) return "";
    var d = new Date(t), hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"), day0 = new Date(); day0.setHours(0, 0, 0, 0);
    var days = Math.floor((day0.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 864e5), en0 = !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en");
    if (days === 0) return en0 ? "Today at " + hm : "今天 " + hm;
    if (days === 1) return en0 ? "Yesterday at " + hm : "昨天 " + hm;
    if (days === 2 && !en0) return "前天 " + hm;
    return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate() + " " + hm;
  };
  var kb = function (n) { if (n == null) return ""; var e0 = !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"); return n < 1000 ? n + (e0 ? " bytes" : " 字节") : n < 1e6 ? Math.max(1, Math.round(n / 1e3)) + " KB" : n < 1e9 ? (n / 1e6).toFixed(1) + " MB" : (n / 1e9).toFixed(2) + " GB"; }; // 同访达：1000 进位，KB 不带小数
  // 一个 agent 现在怎样：在干活、开着、在后台、没在跑
  function stateOf(a) {
    var st = T() && T().status ? T().status(a) : { g: "o", tag: "", time: "" }, work = /\[W\]/.test(st.tag);
    return { g: st.g, work: work, label: work ? "工作中" : st.g === "f" ? "已打开" : st.g === "b" ? "后台运行" : "未运行", time: st.time, cls: work ? "work" : st.g === "f" ? "open" : st.g === "b" ? "bg" : "" };
  }
  var sessionsOf = function (id) { return A.allSessions().filter(function (x) { return x.agentId === id && x.turns && x.turns.length; }).sort(function (x, y) { return (y.updated || 0) - (x.updated || 0); }); };
  var modelName = function (a) { var m = A.modelOf(a.model); return m ? m.name : a.model || ""; };
  var tailOf = function (id) { var rt = A.runtime(id); return rt.tail ? clip(rt.tail(), 160) : ""; };
  // agent 的图标（同访达的文稿图标，不用花哨的颜色）：记号说明它是哪个连接器——Paimon ✦、Claude Code ✻、Codex（云里一个 >_），都是 SVG；
  //   小的（列表、侧栏、分栏、快速查看的标题行）没有底块，只是记号，淡的字色（同 VS Code / 访达的小图标）；
  //   大的（图标看法、画廊、预览栏、仪表盘的卡片、缩略图上的角标）是一块中性的底：跟着深浅色、一圈细边、顶上一点内高光，记号用字色；
  //   状态是角上（小的是右下）一个小点：在干活橙、有新消息蓝、开着绿、在后台空心绿；归档的、这台设备连不上的淡一些
  var GLYPH = {
    get paimon() { return (window.TSU_LOGOS && TSU_LOGOS.paimon) || '<img class="pm-av" src="img/paimon.png" alt="" draggable="false">'; }, // Paimon：派蒙的头像（读进内存的那一份，ext.js）
    claude: (window.TSU_LOGOS && TSU_LOGOS.claude) || '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor">' + [0, 45, 90, 135, 180, 225, 270, 315].map(function (r) { return '<path transform="rotate(' + r + ' 12 12)" d="M12 12c-.85-2.3-1.15-5.2-.66-7.9.13-.72 1.19-.72 1.32 0 .49 2.7.19 5.6-.66 7.9z"/>'; }).join("") + "</g></svg>",
    codex: (window.TSU_LOGOS && TSU_LOGOS.codex) || '<svg viewBox="0 0 24 24"></svg>', // Codex：ChatGPT / OpenAI 的结（ext.js）
    pi: (window.TSU_LOGOS && TSU_LOGOS.pi) || '<svg viewBox="0 0 24 24"></svg>', // pi：它自己的标志（ext.js）
  };
  var connOf = function (a) { var id = String((a && a.id) || ""); return /^cc:/.test(id) ? "claude" : /^cx:/.test(id) ? "codex" : /^pi:/.test(id) ? "pi" : "paimon"; };
  var bellOf = function (id) { var t = T(); try { return !!(t && t.panes && t.panes().some(function (p) { return p.bell && p.program && p.program.agentId === id; })); } catch (e) { return false; } }; // 在后台答完了、还没看（标签页上的铃）
  // size：不给——小的记号；"grid" / true（big）/ "huge" / "card" / "badge"——带底块的
  var bundleIcon = function (a, size) {
    var st = stateOf(a), far = A.reachable && !A.reachable(a.id), c = connOf(a), tile = !!size;
    var dot = st.work ? "work" : bellOf(a.id) ? "new" : st.g === "f" ? "open" : st.g === "b" ? "bg" : "";
    return '<span class="xb-ic c-' + c + (tile ? " tile " + (size === true ? "big" : size) : "") + (far ? " far" : "") + (a.archived ? " arch" : "") + (dot ? " on" : "") + '">' + GLYPH[c] + (dot ? '<span class="xb-st ' + dot + '"></span>' : "") + "</span>";
  };
  function openAgent(P, id, sess) {
    var rt = A.runtime(id), a = A.get(id);
    if (a && a.archived) A.unarchive(id);
    if (sess && rt.session().id !== sess) rt.resume(sess);
    if (P.win && P.win.side && P.win.side.open) P.win.side.open(id, "tab"); else if (T()) T().agent(id);
  }
  var pages = [];
  var redrawAll = function () { pages = pages.filter(function (V) { return !V.gone || !V.gone(); }); pages.forEach(function (V) { if (V.shown && V.shown()) V.redraw(); }); };
  A.on(function (t) { if (t === "agents") redrawAll(); });
  ["tsu-cc", "tsu-cx", "tsu-pi"].forEach(function (ev) { document.addEventListener(ev, function () { redrawSoon(); }); }); // Claude Code、Codex 的会话列表变了（Agent Finder 里有它们）
  setInterval(function () { if (!document.hidden) redrawAll(); }, 5000);

  // ======== 仪表盘 ========
  S.pages.dash = {
    title: function () { return "仪表盘"; },
    address: function () { return "dash.local.paimon"; },
    render: function (host, P, arg, V) {
      if (pages.indexOf(V) < 0) { V.gone = function () { return P.closed; }; pages.push(V); }
      var all = A.list().map(function (a) { return { a: a, st: stateOf(a) }; });
      all.sort(function (x, y) { return (y.st.work - x.st.work) || ((x.st.g === "o") - (y.st.g === "o")) || ((y.a.active || 0) - (x.a.active || 0)); });
      var live = all.filter(function (x) { return x.st.g !== "o"; }), rest = all.filter(function (x) { return x.st.g === "o"; }), sel = V.sel || 0, order = live.concat(rest), n = 0;
      var h;
      if (gui()) {
        var card = function (x) { var i = n++; return '<div class="dx-card' + (i === sel ? " on" : "") + '" data-id="' + x.a.id + '" data-i="' + i + '">' + bundleIcon(x.a, "card") + '<div class="dx-cm"><div class="dx-cn">' + esc(x.a.name) + '</div><div class="dx-cs"><span class="dx-pill ' + x.st.cls + '">' + x.st.label + "</span>" + esc(modelName(x.a)) + " · " + esc(x.st.time) + '</div><div class="dx-cx">' + esc(tailOf(x.a.id)) + "</div></div></div>"; };
        var rowG = function (x) { var i = n++; return '<div class="dx-row' + (i === sel ? " on" : "") + '" data-id="' + x.a.id + '" data-i="' + i + '">' + bundleIcon(x.a) + '<span class="dx-rn">' + esc(x.a.name) + '</span><span class="dx-rx">' + esc(tailOf(x.a.id)) + '</span><span class="dx-rt">' + esc(x.st.time) + "</span></div>"; };
        h = '<div class="dx dx-gui"><div class="dx-head"><div><div class="dx-t">Paimon Code</div><div class="dx-sub">' + all.length + " 个 Agent" + (live.length ? " · " + live.length + " 个运行中" : "") + '</div></div><span class="dx-fill"></span>' +
          '<button class="dx-btn plain" data-act="explorer">Agent Finder</button><button class="dx-btn" data-act="new">新建 Agent</button></div>' +
          (live.length ? '<div class="dx-sec">运行中</div><div class="dx-cards">' + live.map(card).join("") + "</div>" : "") +
          (rest.length ? '<div class="dx-sec">最近</div><div class="dx-list">' + rest.map(rowG).join("") + "</div>" : "") + (all.length ? "" : '<div class="dx-empty">暂无 Agent</div>') + "</div>";
      } else {
        // 终端界面：等宽字的一张表（同 paimon 命令列出来的那样）；前面是派蒙的头像（状态：在干活的一明一暗、没在跑的淡）
        var rowT = function (x) { var i = n++; return '<div class="dx-trow' + (i === sel ? " on" : "") + '" data-id="' + x.a.id + '" data-i="' + i + '"><span class="dx-tn"><span class="dx-star dx-pm ' + x.st.cls + '">' + GLYPH.paimon + "</span> " + esc(x.a.name) + '</span><span class="dx-tm">' + esc(modelName(x.a)) + '</span><span class="dx-tt">' + esc(x.st.g === "o" ? x.st.time : x.st.label + " · " + x.st.time) + '</span><span class="dx-tx">' + esc(tailOf(x.a.id)) + "</span></div>"; };
        h = '<div class="dx dx-tui"><div class="dx-th"><b>Paimon Code</b><span class="dx-dim"> · ' + all.length + " 个 Agent" + (live.length ? " · " + live.length + " 个运行中" : "") + '</span><span class="dx-fill"></span><span class="dx-a" data-act="explorer">资源管理器</span><span class="dx-a" data-act="new">+ 新建 Agent</span></div>' +
          (live.length ? '<div class="dx-tsec">运行中</div>' + live.map(rowT).join("") : "") + (rest.length ? '<div class="dx-tsec">最近</div>' + rest.map(rowT).join("") : "") + (all.length ? "" : '<div class="dx-dim">暂无 Agent</div>') + "</div>";
      }
      if (host.dataset.h !== h) { host.dataset.h = h; host.innerHTML = h; }
      V.order = order;
      if (!host.dataset.bound) {
        host.dataset.bound = "1";
        host.addEventListener("click", function (e) {
          var b = e.target.closest("[data-act]"), r = e.target.closest("[data-id]");
          if (b && b.dataset.act === "new") { var ag = A.create({}); return openAgent(P, ag.id); }
          if (b && b.dataset.act === "explorer") return S.openPage(P.win, "explorer", "agents");
          if (r) openAgent(P, r.dataset.id);
        });
        host.addEventListener("keydown", function (e) {
          var k = e.key, L0 = (V.order || []).length;
          if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); V.sel = Math.max(0, Math.min(L0 - 1, (V.sel || 0) + (k === "ArrowDown" ? 1 : -1))); V.redraw(); var on = host.querySelector(".on"); if (on) on.scrollIntoView({ block: "nearest" }); }
          else if (k === "Enter" && V.order && V.order[V.sel || 0]) { e.preventDefault(); openAgent(P, V.order[V.sel || 0].a.id); }
        });
      }
    },
  };

  // ======== 资源管理器（同访达）：整台 Mac 的文件（系统级）；左边一栏（关不掉）；agent 是一种「包」（同 macOS 的 .app），住在卷里的文件夹里 ========
  // 地方（V.arg）："" 主目录（默认，同访达的新窗口）| "~"、"~/…" 主目录下 | "/" 整个磁盘（Macintosh HD）| "Users/…" 别的路径（绝对路径去掉开头的 /，
  //   地址是 finder.local.paimon/Users/…）| "agents" 几个卷 | "Local"、"Cloud"、"Mac-xxxxxx" 一个卷 | "<卷>/<文件夹>/…" | "<卷>/…/<名字>.agent"（包里）
  //   | "…/<名字>.agent/sessions" | "…/memory/…" | "…/home/…"（它的文件）；老的 "<agent id>/…" 也认
  var store = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v && typeof v === "object" ? v : d; } catch (e) { return d; } };
  var XV = { view: localStorage.getItem("st-xp-view") || "grid", pane: localStorage.getItem("st-xp-pane") !== "0", hidden: localStorage.getItem("st-xp-hidden") === "1",
    more: localStorage.getItem("st-xp-more") === "1", fold: store("st-xp-side", {}), sidew: +localStorage.getItem("st-xp-sidew") || 0, panew: +localStorage.getItem("st-xp-panew") || 0 }; // sidew / panew：左边一栏、预览栏拖过的宽度（0：默认）
  var en = function () { return !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"); };
  var tr = function (zh, e) { return en() ? e : zh; };
  if (window.TSU_I18N && TSU_I18N.onChange) TSU_I18N.onChange(function () { redrawAll(); });
  if (LOC() && !LOC().info() && LOC().ready) LOC().ready.then(function () { redrawAll(); });
  var user = function () { var i = LOC() && LOC().info(); return (i && i.user) || home().split("/").pop() || ""; };
  function fsPath(arg) { var h = home(); arg = String(arg || ""); if (!arg || arg === "~") return h || "/"; if (arg === "/") return "/"; if (arg.slice(0, 2) === "~/") return (h || "") + arg.slice(1); return "/" + arg.replace(/^\/+/, ""); }
  function argOf(p) { var h = home(); if (!p || p === "/") return "/"; if (h && p === h) return "~"; if (h && p.indexOf(h + "/") === 0) return "~" + p.slice(h.length); return p.replace(/^\/+/, ""); }
  var parentOf = function (p) { if (!p || p === "/") return null; var i = p.lastIndexOf("/"); return i <= 0 ? "/" : p.slice(0, i); };
  var shq = function (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };
  // 几个有名字的文件夹（同访达：中文显示「桌面」「文稿」……，图标上有它的小图案）
  var SPECIAL = { Desktop: ["desktop", "桌面"], Documents: ["docs", "文稿"], Downloads: ["downloads", "下载"], Pictures: ["pics", "图片"], Music: ["music", "音乐"], Movies: ["movies", "影片"], Library: ["", "资源库"], Public: ["", "公共"] };
  function glyphOf(p) { var h = home(); if (p === "/") return "disk"; if (h && p === h) return "home"; if (p === "/Applications") return "apps"; var s = h && parentOf(p) === h && SPECIAL[p.slice(h.length + 1)]; return s ? s[0] : ""; }
  function nameOf(p, name) {
    var h = home();
    if (p === "/") return "Macintosh HD";
    if (h && p === h) return user() || name;
    if (en()) return name;
    if (p === "/Applications") return "应用程序";
    if (p === "/Users") return "用户";
    var s = h && parentOf(p) === h && SPECIAL[name];
    return s ? s[1] : name;
  }
  var PLACES = function () { var h = home(); return h ? [["home", h], ["desktop", h + "/Desktop"], ["docs", h + "/Documents"], ["downloads", h + "/Downloads"], ["apps", "/Applications"]] : []; };

  // ---- Agent 的「卷」（同访达的宗卷）：agent 住在哪——这台 Mac（Local）、Cloud、别的 Mac；卷里是任意多层的文件夹，文件夹里是 agent 的包（名字.agent）。
  // 地址：agents.local.paimon/Cloud/工作/Teyvat/paimon-01.agent/sessions；老的 agents.local.paimon/<id>/… 也认 ----
  var volKey = function (v) { return v === "cloud" ? "Cloud" : A.localVol && v === A.localVol() ? "Local" : "Mac-" + String(v).slice(6, 12); };
  function volFromKey(k) {
    k = String(k || "");
    if (/^cloud$/i.test(k)) return "cloud";
    if (/^local$/i.test(k)) return (A.localVol && A.localVol()) || null;
    var m = /^mac-(\w+)$/i.exec(k);
    if (!m || !A.volumes) return null;
    var hit = A.volumes().filter(function (v) { return v.id.slice(6, 6 + m[1].length) === m[1]; })[0];
    return hit ? hit.id : null;
  }
  var volLabelOf = function (v) { return A.volLabel ? A.volLabel(v) : v; };
  var vpParent = function (p) { var i = String(p || "").lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };
  // 一个 agent 的地址（卷/文件夹…/名字.agent）
  function agentArg(a) { var v = A.volOf ? A.volOf(a.id) : "cloud"; return [volKey(v)].concat(String(a.path || "").split("/").filter(Boolean)).concat([a.name + ".agent"]).join("/"); }
  // Agents 树（live.js）、Claude 侧栏拷贝地址、「在 Agent Finder 中显示」用：一个 agent / 一个文件夹（p 空 = 卷）在 Agent Finder 里的地方
  S.agentAddr = { agent: function (a) { return agentArg(a); }, dir: function (vol, p) { return [volKey(vol)].concat(String(p || "").split("/").filter(Boolean)).join("/"); } };
  function bundleOf(a, rest) {
    var kind = rest[0] || "", sub = rest.slice(1), d = dirsOf(a), base = kind === "memory" ? d.memory : kind === "home" ? d.home : "";
    return { a: a, kind: kind, sub: sub, dir: base ? base + (sub.length ? "/" + sub.join("/") : "") : "", cloud: !!d.cloud };
  }
  var dirsOf = function (a) { var rt = A.runtime(a.id); return rt && rt.dirs ? rt.dirs() : { home: rt ? rt.home() : "", memory: home() + "/.paimon/MemoryData/" + a.id, cloud: false }; };
  // ======== Claude Code、Codex（连接器开着才有）：Agent Finder 里各是一个「位置」（同卷）——里面按项目文件夹（开会话的那个目录）分，文件夹里是会话；
  //   双击 / ⌘↓ / 回车打开（同 Agents 树里点它：用现在的外壳看它、接着说）。Claude Code 要全部的会话（侧栏平时只读最近 40 个）：这里自己问一份（原生那边有缓存）。
  //   地址：agents.local.paimon/claude-code、…/claude-code/~/项目的/目录（家目录写成 ~，别的绝对路径去掉开头的 /）；codex 同 ========
  var CONN = { cc: { key: "claude-code", name: "Claude Code", glyph: "claude", ext: "cc:" }, cx: { key: "codex", name: "Codex", glyph: "codex", ext: "cx:" }, pi: { key: "pi", name: "pi", glyph: "pi", ext: "pi:" } };
  var pmOn = function () { return !window.TSU_CONNECTORS || TSU_CONNECTORS.on("paimon"); };
  // Paimon Code 的卷、agent：Agent Finder 里不再列（用户：这里不要 Paimon 的东西，乱）——数据都还在；localStorage st-pm-vols = "1" 时照旧列出来
  var pmVols = function () { return localStorage.getItem("st-pm-vols") === "1" && pmOn(); };
  var connOn = function (k) { return k === "cc" ? !!window.TSU_CLAUDE : k === "pi" ? !!(window.TSU_PI && (!window.TSU_CONNECTORS || TSU_CONNECTORS.on("pi"))) : !!(window.TSU_CODEX && (!window.TSU_CONNECTORS || TSU_CONNECTORS.on("codex"))); };
  var connKeys = function () { return ["cc", "cx", "pi"].filter(connOn); };
  var connOfKey = function (s0) { return /^claude[- ]?code$/i.test(s0 || "") ? "cc" : /^codex$/i.test(s0 || "") ? "cx" : /^pi$/i.test(s0 || "") ? "pi" : ""; };
  // 地址里的目录：家目录下的写 ~/…；别的地方从 Macintosh HD（即 /，同访达的路径条）写起——「/」自己也有地址
  var ROOTN = "Macintosh HD";
  var dirArg = function (p) { var t = tilde(p); return t.charAt(0) === "/" ? ROOTN + (t.length > 1 ? t : "") : t; };
  var cdirOf = function (cr) { return !cr.length ? "" : cr[0] === "~" ? home() + (cr.length > 1 ? "/" + cr.slice(1).join("/") : "") : cr[0] === ROOTN ? "/" + cr.slice(1).join("/") : "/" + cr.join("/"); }; // 老地址（开头不写 Macintosh HD 的）照认
  var connArg = function (k, dir) { return CONN[k].key + (dir ? "/" + dirArg(dir) : ""); };
  var dirName = function (d) { return d === home() ? "~" : d === "/" ? ROOTN : String(d || "").split("/").filter(Boolean).pop() || "/"; };
  // 从最上面（~ 或 Macintosh HD）到这个目录的每一层：[[目录, 名字]…]
  function connChain(dir) {
    if (!dir) return [];
    var h = home(), out = [], acc;
    if (h && (dir === h || dir.indexOf(h + "/") === 0)) { out.push([h, "~"]); acc = h; dir.slice(h.length).split("/").filter(Boolean).forEach(function (sg) { acc += "/" + sg; out.push([acc, sg]); }); }
    else { out.push(["/", ROOTN]); acc = ""; dir.split("/").filter(Boolean).forEach(function (sg) { acc += "/" + sg; out.push([acc, sg]); }); }
    return out;
  }
  // on：活着的（在干活、开着、在后台、有新消息的会话；开着的连接器）——记号用它自己的颜色（Claude 的橙、Codex 的绿）；别的淡灰（用户：全是灰的太阴间）
  var connIcon = function (k, size, dot, arch, on) { var c = CONN[k].glyph; return '<span class="xb-ic c-' + c + (size ? " tile " + (size === true ? "big" : size) : "") + (arch ? " arch" : "") + (on || dot ? " on" : "") + '">' + GLYPH[c] + (dot ? '<span class="xb-st ' + dot + '"></span>' : "") + "</span>"; };
  var ccModel = function (m) { // claude-opus-5-5[1m] → Opus 5.5 · 1M（同 claude.js）；Codex 的原样
    if (!m) return "";
    var one = /\[1m\]$/i.test(m), b = String(m).replace(/\[1m\]$/i, "").replace(/-\d{8}$/, ""), x = /^(?:claude-)?(opus|sonnet|haiku|fable)(?:-(\d+)(?:-(\d+))?)?$/i.exec(b);
    return (x ? x[1].charAt(0).toUpperCase() + x[1].slice(1).toLowerCase() + (x[2] ? " " + x[2] + (x[3] ? "." + x[3] : "") : "") : b) + (one ? " · 1M" : "");
  };
  var CCALL = { at: 0, list: null, busy: false };
  function ccAll(done) {
    if (!LOC() || !LOC().ccSessions) return [];
    if (!CCALL.busy && Date.now() - CCALL.at > 8000) {
      CCALL.busy = true;
      var fin = function () { CCALL.busy = false; CCALL.at = Date.now(); if (!CCALL.list) CCALL.list = []; (done || redrawAll)(); };
      LOC().ccSessions(5000).then(function (l) { CCALL.list = l || []; if (window.TSU_CLAUDE && TSU_CLAUDE.titles) TSU_CLAUDE.titles(CCALL.list, function () { redrawAll(); }); fin(); }, fin);
    }
    return CCALL.list;
  }
  var extStore = function () { try { var e = JSON.parse(localStorage.getItem("st-claude-ext") || "{}") || {}; return { name: e.name || {}, arch: e.arch || {} }; } catch (e) { return { name: {}, arch: {} }; } }; // 边栏里改的名字、归档（Agents 树、Claude App 边栏共用）
  var OPENS = { at: 0, set: {} }, openHere = function (aid) { // 开在哪个标签页里（看着它）：半秒里只数一遍
    if (Date.now() - OPENS.at > 500) { var o = {}, t = T(); try { (t && t.panes ? t.panes() : []).forEach(function (p) { var ag = p.program && p.program.agentId; if (ag) o[ag] = 1; }); } catch (e) { /* 还没搭好 */ } OPENS = { at: Date.now(), set: o }; }
    return !!OPENS.set[aid];
  };
  // 这个连接器的会话：[{ x, name, arch }]；还在读是 null
  function connSessions(k, done) {
    if (!connOn(k)) return [];
    var ex = extStore(), l = k === "cc" ? ccAll(done) : k === "pi" ? TSU_PI.list() : TSU_CODEX.list();
    if (!l) return null;
    return l.map(function (x) { var ek = CONN[k].ext + x.id; return { x: x, name: ex.name[ek] || x.title || x.id.slice(0, 8), arch: !!(x.archived || ex.arch[ek]) }; });
  }
  // 同名的 Claude Code 会话：名字后面淡淡地带短 id（tag，TSU_CLAUDE.dupTag）
  var nmH = function (it) { return esc(it.label || it.name) + (it.tag ? ' <small class="ttag">' + esc(it.tag) + "</small>" : ""); };
  function sessItem(k, s0) {
    var x = s0.x, busy = !!(x.live && x.live.status === "busy"), here = openHere(CONN[k].ext + x.id), run = busy || here || !!x.live;
    return { kind: "csess", conn: k, id: x.id, x: x, name: s0.name, label: s0.name, tag: k === "cc" && window.TSU_CLAUDE && TSU_CLAUDE.dupTag ? TSU_CLAUDE.dupTag(x.id, s0.name) : "", time: x.mtime || 0, sub: k === "cc" ? ccModel(x.model) : x.model || "", dot: s0.arch,
      status: s0.arch ? tr("已归档", "Archived") : run ? tr("运行中", "Running") : tr("空闲", "Idle"), srank: s0.arch ? 2 : run ? 0 : 1, st: busy ? "work" : here ? "open" : x.live ? "bg" : "" };
  }
  // 按真实的文件夹一层层分（同访达、同 Agents 树）：最上面是 ~（家目录）和 Macintosh HD（别的地方）；每一层是
  //   有会话的目录、走到它们要经过的目录（都是真的那一层：一层不并、一层不跳），加上就开在这一层的会话。
  //   结点：{ dir, name, subs: 目录 → 结点, ss: 开在这一层的会话, n: 里面（多少层都算）几个会话, t: 最近的动静 }；loose：不知道目录的
  function connTree(k, done) {
    var ss = connSessions(k, done);
    if (!ss) return null;
    var root = { dir: "", name: "", subs: {}, ss: [], n: 0, t: 0 }, loose = [], byDir = {};
    ss.forEach(function (s0) {
      var d = String(s0.x.cwd || "").replace(/(.)\/+$/, "$1");
      if (!d || d.charAt(0) !== "/") { loose.push(s0); return; }
      var par = root, nd = root, mt = s0.x.mtime || 0;
      connChain(d).forEach(function (c) {
        nd = par.subs[c[0]] || (par.subs[c[0]] = byDir[c[0]] = { dir: c[0], name: c[1], subs: {}, ss: [], n: 0, t: 0 });
        nd.n++; if (mt > nd.t) nd.t = mt;
        par = nd;
      });
      nd.ss.push(s0);
    });
    return { root: root, loose: loose, all: byDir, at: function (dir) { return dir ? byDir[dir] || null : root; } };
  }
  var sessNote = function (n) { return tr(n + " 个会话", n + (n === 1 ? " session" : " sessions")); };
  function dirItem(k, nd) {
    return { kind: "dir", cf: true, conn: k, cdir: nd.dir, id: "dir:" + nd.dir, name: nd.name, label: nd.name, go: connArg(k, nd.dir), n: nd.n, time: nd.t, note: sessNote(nd.n), sub: nd.dir === "/" ? "/" : tilde(nd.dir) };
  }
  function connRootItem(k) {
    var ss = connSessions(k, function () { redrawAll(); }) || [], t = ss.reduce(function (m, s0) { return Math.max(m, s0.x.mtime || 0); }, 0);
    return { kind: "dir", croot: true, conn: k, id: "conn:" + k, name: CONN[k].name, label: CONN[k].name, go: CONN[k].key, dflt: connHome(k), n: ss.length, time: t, note: sessNote(ss.length) };
  }
  // 点 Claude Code / Codex（左边一栏、最外层那一栏、打开）：直接到 ~——会话差不多都开在家目录下，最外层只有 ~、Macintosh HD 两个文件夹，没什么可看的；
  //   家目录下一个会话都没有才停在最外层（还在读的先当有）。方向键走过去不跳（→ 再进 ~）
  function connHome(k) { var h = home(), t0 = connTree(k, function () { redrawAll(); }); return h && (!t0 || t0.all[h]) ? connArg(k, h) : CONN[k].key; }
  // 一层：这一层的子文件夹 + 就开在这一层的会话（最外层再加上不知道目录的）
  function connItems(w, done) {
    var t0 = connTree(w.conn, done);
    if (!t0) return null;
    var nd = t0.at(w.cdir);
    if (!nd) return [];
    return Object.keys(nd.subs).map(function (d) { return dirItem(w.conn, nd.subs[d]); })
      .concat(nd.ss.map(function (s0) { return sessItem(w.conn, s0); }))
      .concat(w.cdir ? [] : t0.loose.map(function (s0) { return sessItem(w.conn, s0); }));
  }
  // 搜索（工具栏的搜索框）：Agent Finder 里在这个位置里往下找（多少层都算）——名字里每个词都有的 agent、文件夹、会话
  function deepFind(w, q, done) {
    var toks = String(q || "").toLowerCase().split(/\s+/).filter(Boolean), ok = function (n) { n = String(n || "").toLowerCase(); return toks.every(function (t) { return n.indexOf(t) >= 0; }); }, out = [];
    if (!toks.length) return null;
    if (!w.conn && pmVols()) {
      var vols = w.root ? (A.volumes ? A.volumes() : []).map(function (v) { return v.id; }) : [w.vol], under = function (ap) { return !w.path || ap === w.path || ap.indexOf(w.path + "/") === 0; };
      vols.forEach(function (vol) {
        (A.folders ? A.folders(vol) : []).forEach(function (p) { if (p !== w.path && under(p) && ok(p.split("/").pop())) out.push(vfItem(vol, p)); });
        agentsIn(vol).forEach(function (a) { if (under(a.path || "") && ok(a.name)) out.push(agentItem(a)); });
      });
    }
    (w.conn ? [w.conn] : w.root ? connKeys() : []).forEach(function (k) {
      var inDir = function (d) { d = String(d || ""); return !w.cdir || d === w.cdir || d.indexOf((w.cdir === "/" ? "" : w.cdir) + "/") === 0; }; // 这个文件夹里（多少层都算）
      var t1 = connTree(k, done);
      if (t1) Object.keys(t1.all).forEach(function (d) { var nd = t1.all[d]; if (d !== w.cdir && inDir(d) && ok(nd.name)) out.push(dirItem(k, nd)); });
      (connSessions(k, done) || []).forEach(function (s0) { if (inDir(s0.x.cwd) && ok(s0.name)) out.push(sessItem(k, s0)); });
    });
    return out;
  }
  function where(arg) {
    arg = String(arg || "");
    if (arg === "agents" || (!arg && !LOC())) return { agents: true, root: true };
    var ck = connOfKey(arg.split("/")[0]);
    if (ck) return { agents: true, conn: ck, cdir: cdirOf(arg.split("/").slice(1).filter(Boolean)) };
    var parts = arg.split("/").filter(Boolean), vol = volFromKey(parts[0]);
    if (vol) {
      var ai = parts.findIndex(function (x) { return /\.agent$/i.test(x); });
      if (ai < 0) return { agents: true, vol: vol, path: parts.slice(1).join("/") };
      var a0 = A.byName(parts[ai].replace(/\.agent$/i, "")) || (A.archived ? A.archived().filter(function (x) { return x.name.toLowerCase() === parts[ai].replace(/\.agent$/i, "").toLowerCase(); })[0] : null);
      if (a0) return bundleOf(a0, parts.slice(ai + 1));
      return { agents: true, vol: vol, path: parts.slice(1, ai).join("/") };
    }
    var id = parts[0], a = id && id !== "~" && !/^cc:/.test(id) && A.get(id);
    if (a) return bundleOf(a, parts.slice(1));
    return { fs: true, path: fsPath(arg) };
  }
  var cache = {}; // 目录 → { at, items, err }
  function listDir(dir, done) {
    var c = cache[dir];
    if (c && Date.now() - c.at < 4000) return c.items;
    if (!LOC() || (c && c.busy)) return c ? c.items : null;
    cache[dir] = { at: 0, items: c ? c.items : null, busy: true };
    LOC().list(dir).then(function (l) { cache[dir] = { at: Date.now(), items: l || [] }; done(); }, function (e) { cache[dir] = { at: Date.now(), items: [], err: String((e && e.message) || e || "") }; done(); });
    return cache[dir].items;
  }
  // Cloud 的 agent 的包在服务器的沙盒里：经 /api/sbx 列（以人的身份）
  function listCloud(dir, done) {
    var k = "cloud:" + dir, c = cache[k];
    if (c && Date.now() - c.at < 4000) return c.items;
    if (c && c.busy) return c.items;
    cache[k] = { at: 0, items: c ? c.items : null, busy: true };
    fetch("/api/sbx/fs/list?as=user&path=" + encodeURIComponent(dir)).then(function (r) { return r.ok ? r.json() : []; }).then(function (l) {
      cache[k] = { at: Date.now(), items: (Array.isArray(l) ? l : []).map(function (m) { return { name: m.name, dir: m.t === "d", size: m.s, mtime: m.m, hidden: false }; }) };
      done();
    }, function (e) { cache[k] = { at: Date.now(), items: [], err: String((e && e.message) || e || "") }; done(); });
    return cache[k].items;
  }
  // 不给人看的文件：Office 开着文稿时留的「~$」锁文件、Windows 的 Thumbs.db / desktop.ini、文件夹自定义图标（Icon\r）、回收站之类
  var JUNK = /^(~\$.*|Thumbs\.db|ehthumbs(_vista)?\.db|[Dd]esktop\.ini|Icon\r|\$RECYCLE\.BIN|System Volume Information)$/;
  var hiddenName = function (x) { return !!x.hidden || x.name[0] === "." || JUNK.test(x.name); };
  var visible = function (l) { return XV.hidden ? l : l.filter(function (x) { return !hiddenName(x); }); }; // 同访达：点开头的、带隐藏标记的（~/Library、/bin……）、上面那些都不显示
  function fsItem(dir, x) {
    var p = (dir === "/" ? "" : dir) + "/" + x.name, app = x.dir && /\.app$/i.test(x.name);
    return { kind: app ? "app" : x.dir ? "dir" : "file", name: x.name, label: nameOf(p, x.name), path: p, go: x.dir && !app ? argOf(p) : null, size: x.dir ? null : x.size, time: x.mtime, dot: hiddenName(x) };
  }
  // Agent Finder 里的一个文件夹（p 空 = 整个卷）：里面（多少层都算）有几个 agent、最近什么时候有动静
  var agentsIn = function (vol) { return A.list().concat(A.archived ? A.archived() : []).filter(function (a) { return A.volOf(a.id) === vol; }); };
  var agentItem = function (a) { var st = stateOf(a), arc = !!a.archived; return { kind: "agent", id: a.id, name: a.name, a: a, time: a.active, sub: modelName(a), status: arc ? tr("已归档", "Archived") : st.g !== "o" ? tr("运行中", "Running") : tr("空闲", "Idle"), srank: arc ? 2 : st.g !== "o" ? 0 : 1, dot: arc }; };
  function vfItem(vol, p) {
    var inside = agentsIn(vol).filter(function (a) { var ap = a.path || ""; return !p || ap === p || ap.indexOf(p + "/") === 0; }), nm = p ? p.split("/").pop() : volLabelOf(vol);
    return { kind: "dir", vf: !!p, volume: !p, vol: vol, vpath: p, name: nm, label: nm, go: [volKey(vol)].concat(p ? p.split("/") : []).join("/"), off: !p && !!A.volHere && !A.volHere(vol),
      note: tr(inside.length + " 个 Agent", inside.length + (inside.length === 1 ? " agent" : " agents")), n: inside.length, time: inside.reduce(function (m, a) { return Math.max(m, a.active || 0); }, 0) };
  }
  function itemsOf(w, V, refresh) {
    if (w.agents && w.root) { // 最外层：「最近」（同访达的「最近使用」）——各连接器的会话、Paimon 的 agent，按最近动过排；卷、Claude Code、Codex 在左边一栏，这里不再列一遍
      var rec = [], loading = false;
      connKeys().forEach(function (k) { var ss = connSessions(k, refresh); if (!ss) { loading = true; return; } ss.forEach(function (s0) { if (!s0.arch) { var it = sessItem(k, s0); it.sub = CONN[k].name; rec.push(it); } }); });
      if (pmVols()) A.list().forEach(function (a0) { var it = agentItem(a0); it.sub = "Paimon"; rec.push(it); });
      if (!rec.length && loading) return null;
      rec.sort(function (a1, b1) { return (b1.time || 0) - (a1.time || 0); });
      return rec.slice(0, 100);
    }
    if (w.conn) return connItems(w, refresh);
    if (w.agents) { // 一个卷里的一层：子文件夹 + 住在这一层的 agent
      var all0 = agentsIn(w.vol);
      var subs = (A.folders ? A.folders(w.vol) : []).filter(function (p) { return vpParent(p) === w.path; }).map(function (p) { return vfItem(w.vol, p); });
      return subs.concat(all0.filter(function (a) { return (a.path || "") === w.path; }).map(agentItem));
    }
    if (w.fs) { var l0 = listDir(w.path, refresh); return l0 ? visible(l0).map(function (x) { return fsItem(w.path, x); }) : null; }
    if (!w.kind) {
      // 包里（同 .app 的「显示包内容」）：会话、记忆、文件（它自己的文件夹——Paimon 的 agent 没有工作目录）、身份卡；Cloud 的 agent 这几样在服务器上
      var ss = sessionsOf(w.a.id), ba = agentArg(w.a), dd = dirsOf(w.a), out = [{ kind: "dir", name: tr("会话", "Sessions"), go: ba + "/sessions", note: tr(ss.length + " 段", ss.length + " sessions"), n: ss.length, fixed: true }]; // fixed：包里固定的几样，右键没有改名、移到废纸篓这些
      if ((LOC() || dd.cloud) && dd.here !== false) {
        out.push({ kind: "dir", name: tr("记忆", "Memory"), go: ba + "/memory", path: dd.cloud ? undefined : dd.memory, fixed: true });
        out.push({ kind: "dir", name: tr("文件", "Files"), go: ba + "/home", path: dd.cloud ? undefined : dd.home, fixed: true });
      }
      out.push({ kind: "identity", name: tr("身份卡.json", "Identity.json"), a: w.a });
      return out;
    }
    if (w.kind === "sessions") return sessionsOf(w.a.id).map(function (x) { return { kind: "session", id: x.id, a: w.a, name: x.title || "（未命名）", time: x.updated, note: x.turns.length + " 问", n: x.turns.length }; });
    var l = w.cloud ? listCloud(w.dir, refresh) : listDir(w.dir, refresh);
    if (!l) return null;
    return visible(l).map(function (x) { var it = fsItem(w.dir, x); if (it.kind === "dir") it.go = V.arg + "/" + x.name; it.label = x.name; if (w.cloud) { it.cloud = true; it.fixed = true; } return it; });
  }

  // ---- 图标 ----
  var ICONS = {
    dir: '<svg viewBox="0 0 48 48"><path d="M5 12a3 3 0 0 1 3-3h10l4 4h18a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z"/></svg>',
    file: '<svg viewBox="0 0 48 48"><path d="M12 5h17l9 9v27a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M29 5v9h9"/></svg>',
    session: '<svg viewBox="0 0 48 48"><path d="M8 10h32a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H22l-8 7v-7H8a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3z"/></svg>',
    app: '<svg viewBox="0 0 48 48"><rect x="7" y="7" width="34" height="34" rx="9"/><path d="M24 14l8 20M24 14l-8 20M19 28h10"/></svg>',
    disk: '<svg viewBox="0 0 48 48"><rect x="5" y="14" width="38" height="22" rx="4"/><path d="M5 27h38"/><circle cx="36" cy="31.5" r="1.2"/></svg>',
  };
  // 文件夹上的小图案、左边一栏的图标（16 格线条）
  var GLYPHS = {
    home: '<path d="M2.5 7.4L8 3l5.5 4.4"/><path d="M4 6.4V13h8V6.4"/><path d="M6.6 13V9.8h2.8V13"/>',
    desktop: '<rect x="2" y="3" width="12" height="8" rx="1.2"/><path d="M6 13.4h4M8 11v2.4"/>',
    docs: '<path d="M4.2 2h5.2l2.4 2.6V14H4.2z"/><path d="M6.2 7.4h3.6M6.2 9.8h3.6"/>',
    downloads: '<circle cx="8" cy="8" r="6"/><path d="M8 4.8v5.6M5.6 8.2L8 10.6l2.4-2.4"/>',
    apps: '<path d="M8 2.6l4.8 10.6M8 2.6L3.2 13.2M5 9.6h6"/>',
    pics: '<rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.2"/><circle cx="5.6" cy="6.4" r="1"/><path d="M2.6 11.4l3.2-3 2.4 2.2 1.8-1.4 3.4 2.8"/>',
    music: '<path d="M6 12V3.8l6.4-1.2v8"/><circle cx="4.6" cy="12" r="1.6"/><circle cx="11" cy="10.6" r="1.6"/>',
    movies: '<rect x="2.2" y="3.4" width="11.6" height="9.2" rx="1.2"/><path d="M5 3.4v9.2M11 3.4v9.2M2.2 8h11.6"/>',
    disk: '<rect x="1.8" y="4.4" width="12.4" height="7.2" rx="1.6"/><path d="M1.8 8.6h12.4"/><path d="M11.4 10.2h.01"/>',
    recents: '<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.6"/>',
    agents: '<path d="M7 2.6c.4 2.9 1.9 4.4 4.8 4.8-2.9.4-4.4 1.9-4.8 4.8-.4-2.9-1.9-4.4-4.8-4.8 2.9-.4 4.4-1.9 4.8-4.8z"/><path d="M12.4 1.6c.1 1 .6 1.5 1.6 1.6-1 .1-1.5.6-1.6 1.6-.1-1-.6-1.5-1.6-1.6 1-.1 1.5-.6 1.6-1.6z"/>',
  };
  var CLOUD_GLYPH = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.6 12.4h7a2.8 2.8 0 0 0 .4-5.6A3.8 3.8 0 0 0 4.7 6a3 3 0 0 0-.1 6.4z"/></svg>';
  var glyphSvg = function (g) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' + (GLYPHS[g] || "") + "</svg>"; };
  var extOf = function (name) { return (/\.([\w]{1,6})$/.exec(name || "") || ["", ""])[1].toLowerCase(); };
  // 原生给的缩略图 / 图标（fs.thumb）：先画自己的，拿到了换成真的
  var THUMB = {}, thumbWait = {}, canThumb = null, NCMDS = [];
  if (window.nadosNative) nadosNative.call("info").then(function (i) { NCMDS = (i && i.commands) || []; canThumb = NCMDS.indexOf("fs.thumb") >= 0; if (canThumb) redrawAll(); }).catch(function () { canThumb = false; });
  var can = function (c) { return NCMDS.indexOf(c) >= 0; }; // 原生有没有这条命令（fs.trash、fs.apps……老版本的 App 里没有）
  var THUMBABLE = /\.(png|jpe?g|gif|webp|heic|bmp|tiff?|svg|pdf|mov|mp4|m4v|key|pages|numbers|docx?|xlsx?|pptx?|psd|ai|sketch|fig)$/i;
  function thumbOf(it, px) {
    if (!canThumb || !it.path || it.cloud) return null;
    var want = it.kind === "app" || (it.kind === "file" && THUMBABLE.test(it.name || "")) || (it.kind === "dir" && glyphOf(it.path) === "" && /\.(app|bundle|framework|photoslibrary)$/i.test(it.name || ""));
    if (!want) return null;
    var key = it.path + "|" + px + "|" + (it.time || 0);
    if (THUMB[key]) return THUMB[key];
    if (!thumbWait[key]) { thumbWait[key] = true; thumbQ.push({ key: key, path: it.path, px: px }); thumbPump(); }
    return null;
  }
  // 排队要缩略图：以前一个文件夹里有几百个就同时向原生要几百个（快速查看一下子全在生成），每个都慢。现在同时最多 4 个，按画的先后（上面的先）
  var thumbQ = [], thumbN = 0;
  function thumbPump() {
    while (thumbN < 4 && thumbQ.length) {
      var j = thumbQ.shift();
      thumbN++;
      nadosNative.call("fs.thumb", { path: j.path, size: j.px }).then(function (u) { return u; }, function () { return null; }).then((function (j0) { return function (u) { thumbN--; if (u) { THUMB[j0.key] = u; redrawSoon(); } thumbPump(); }; })(j));
    }
  }
  var DOCISH = /\.(pdf|docx?|pages|key|pptx?|xlsx?|numbers|rtf|txt|md)$/i; // 白底的文稿：深色下压暗一点
  var rdT = 0; function redrawSoon() { clearTimeout(rdT); rdT = setTimeout(function () { redrawAll(); }, 80); }
  var CLOUD_SVG = '<svg viewBox="0 0 48 48"><path d="M14 36h21a8 8 0 0 0 1.2-15.9A11 11 0 0 0 15 18.6 8.8 8.8 0 0 0 14 36z"/></svg>';
  function iconOf(it, size) {
    if (it.kind === "agent") return bundleIcon(it.a, size);
    if (it.kind === "csess") return connIcon(it.conn, size, it.st, it.dot);
    if (it.croot) return connIcon(it.conn, size, null, false, true); // 列出来的连接器都是开着的：彩色
    if (it.volume) return '<span class="xp-ic ' + (it.vol === "cloud" ? "dir" : "disk") + (size ? " " + (size === true ? "big" : size) : "") + (it.off ? " off" : "") + '">' + (it.vol === "cloud" ? CLOUD_SVG : ICONS.disk) + "</span>";
    var th = thumbOf(it, size === "huge" ? 256 : size ? 96 : 48);
    if (th) return '<span class="xp-ic thumb' + (DOCISH.test(it.name || "") ? " doc" : "") + (size ? " " + (size === true ? "big" : size) : "") + '"><img src="' + th + '" alt="" draggable="false"></span>';
    var k = it.kind === "identity" ? "file" : it.kind, sz = size ? " " + (size === true ? "big" : size) : "", g = it.path && (it.kind === "dir" || it.path === "/") ? glyphOf(it.path) : it.cf && it.cdir ? glyphOf(it.cdir) : ""; // Claude Code / Codex 的文件夹也按真目录画（~ 是房子、Macintosh HD 是磁盘、文稿、桌面…）
    if (g === "disk") k = "disk";
    return '<span class="xp-ic ' + k + sz + '">' + ICONS[k] + (g && g !== "disk" && g !== "home" ? '<span class="xp-gl">' + glyphSvg(g) + "</span>" : g === "home" ? '<span class="xp-gl">' + glyphSvg("home") + "</span>" : "") +
      (k === "file" ? '<span class="xp-ext">' + esc(extOf(it.name).toUpperCase()) + "</span>" : "") + "</span>";
  }
  // 种类（同访达的「种类」）
  var KINDS = { md: ["Markdown 文稿", "Markdown Document"], markdown: ["Markdown 文稿", "Markdown Document"], txt: ["纯文本文稿", "Plain Text Document"], rtf: ["RTF 文稿", "RTF Document"], log: ["日志文件", "Log File"],
    js: ["JavaScript 脚本", "JavaScript Script"], mjs: ["JavaScript 脚本", "JavaScript Script"], ts: ["TypeScript 源文件", "TypeScript Source"], tsx: ["TypeScript 源文件", "TypeScript Source"], jsx: ["JavaScript 脚本", "JavaScript Script"],
    json: ["JSON 文件", "JSON File"], jsonl: ["JSON Lines 文件", "JSON Lines File"], py: ["Python 脚本", "Python Script"], sh: ["Shell 脚本", "Shell Script"], zsh: ["Shell 脚本", "Shell Script"], swift: ["Swift 源文件", "Swift Source"],
    c: ["C 源文件", "C Source"], h: ["C 头文件", "C Header"], cpp: ["C++ 源文件", "C++ Source"], go: ["Go 源文件", "Go Source"], rs: ["Rust 源文件", "Rust Source"], java: ["Java 源文件", "Java Source"],
    html: ["HTML 文稿", "HTML Document"], css: ["CSS 样式表", "CSS Style Sheet"], xml: ["XML 文稿", "XML Document"], yml: ["YAML 文件", "YAML File"], yaml: ["YAML 文件", "YAML File"], toml: ["TOML 文件", "TOML File"], csv: ["CSV 文稿", "CSV Document"],
    png: ["PNG 图像", "PNG Image"], jpg: ["JPEG 图像", "JPEG Image"], jpeg: ["JPEG 图像", "JPEG Image"], gif: ["GIF 图像", "GIF Image"], webp: ["WebP 图像", "WebP Image"], svg: ["SVG 图像", "SVG Image"], heic: ["HEIC 图像", "HEIC Image"],
    pdf: ["PDF 文稿", "PDF Document"], zip: ["ZIP 归档", "ZIP Archive"], gz: ["Gzip 归档", "Gzip Archive"], dmg: ["磁盘映像", "Disk Image"], mp4: ["MPEG-4 影片", "MPEG-4 Movie"], mov: ["QuickTime 影片", "QuickTime Movie"],
    mp3: ["MP3 音频", "MP3 Audio"], wav: ["WAVE 音频", "WAVE Audio"], docx: ["Word 文稿", "Word Document"], xlsx: ["Excel 工作簿", "Excel Workbook"], pptx: ["PowerPoint 演示文稿", "PowerPoint Presentation"] };
  function kindName(it) {
    if (it.kind === "agent") return "Paimon Code Agent";
    if (it.kind === "csess") return tr(CONN[it.conn].name + " 会话", CONN[it.conn].name + " Session");
    if (it.croot) return tr("连接器", "Connector");
    if (it.kind === "dir") return it.volume || it.path === "/" ? tr("宗卷", "Volume") : tr("文件夹", "Folder");
    if (it.kind === "app") return tr("应用程序", "Application");
    if (it.kind === "session") return tr("会话", "Session");
    if (it.kind === "identity") return tr("身份卡", "Identity Card");
    var e = extOf(it.name), k = KINDS[e];
    return k ? tr(k[0], k[1]) : e ? tr(e.toUpperCase() + " 文件", e.toUpperCase() + " File") : tr("文稿", "Document");
  }
  // 日期：同访达的长格式（2026年8月14日 星期五 04:05）
  function longDate(t) {
    if (!t) return "";
    var d = new Date(t), p2 = function (n) { return String(n).padStart(2, "0"); };
    if (en()) return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) + " at " + p2(d.getHours()) + ":" + p2(d.getMinutes());
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 星期" + "日一二三四五六"[d.getDay()] + " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
  }
  var items = function (n) { return tr(n + " 项", n + (n === 1 ? " item" : " items")); };
  // 创建时间：原生那边的 fs.stat 不带，问一次 stat（选中的那个才问；记住）
  var BIRTH = {};
  function birthOf(path) {
    var b = BIRTH[path];
    if (b) return b.t;
    if (!LOC() || !LOC().exec || !path) return 0;
    BIRTH[path] = { t: 0 };
    LOC().exec({ cmd: "/usr/bin/stat -f %B " + shq(path), access: "user" }).then(function (r) { var s = parseInt(String((r && r.out) || "").trim(), 10); if (s > 0) { BIRTH[path] = { t: s * 1000 }; redrawAll(); } }, function () {});
    return 0;
  }
  // 路径条：主目录 › 文稿 › …（不在主目录下的从 Macintosh HD 起）；agent 的包：Agent › paimon-01 › 记忆 › …
  // 最下面的路径条（同访达）：Macintosh HD › 用户 › 我 › 文稿，每段一个小图标；在 agent 里：Agent › 名字 › …
  // 路径条上的小图标：同侧栏、列表里的——有名字的文件夹（主目录、文稿……）、磁盘、云是它们的线条图标（强调色），别的文件夹是列表里那个蓝色的文件夹
  function pbIcon(k) {
    if (k === "dir") return '<span class="xp-ic dir xp-pbf">' + ICONS.dir + "</span>";
    return '<span class="xp-pbi">' + (k === "cloud" ? CLOUD_GLYPH : glyphSvg(k)) + "</span>";
  }
  function pathBar(w) {
    var seg = function (go, label, icon) { return '<span class="xp-pb" data-go="' + esc(go) + '">' + (icon || "") + "<span>" + esc(label) + "</span></span>"; }, out = [];
    if (w.fs) {
      var acc = "";
      out.push(seg("/", "Macintosh HD", pbIcon("disk")));
      w.path.split("/").filter(Boolean).forEach(function (s0) { acc += "/" + s0; out.push(seg(argOf(acc), nameOf(acc, s0), pbIcon(glyphOf(acc) || "dir"))); });
    } else {
      out.push(seg("agents", "Agent", pbIcon("agents")));
      agentTrail(w).forEach(function (x) { out.push(seg(x[0], x[1], x[2] === "agent" ? bundleIcon(w.a) : /^conn:/.test(x[2]) ? connIcon(x[2].slice(5)) : pbIcon(x[2]))); });
    }
    return out.join('<i class="xp-pbsep">›</i>');
  }
  function crumbs(w) {
    var cr = function (go, label) { return '<span class="xp-cr" data-go="' + esc(go) + '">' + esc(label) + "</span>"; }, out = [];
    if (w.fs) {
      var h = home(), p = w.path, acc, segs;
      if (h && (p === h || p.indexOf(h + "/") === 0)) { out.push(cr("~", user() || tr("主目录", "Home"))); acc = h; segs = p.slice(h.length).split("/").filter(Boolean); }
      else { out.push(cr("/", "Macintosh HD")); acc = ""; segs = p.split("/").filter(Boolean); }
      var all = segs.map(function (s) { acc += "/" + s; return [argOf(acc), nameOf(acc, s)]; });
      if (all.length > 4) { out.push('<span class="xp-cr xp-crmore" data-hidden="' + esc(JSON.stringify(all.slice(0, -3))) + '">…</span>'); all = all.slice(-3); }
      all.forEach(function (x) { out.push(cr(x[0], x[1])); });
    } else {
      out.push(cr("agents", "Agent"));
      agentTrail(w).forEach(function (x) { out.push(cr(x[0], x[1])); });
    }
    return out.join('<span class="xp-sep">›</span>');
  }
  var KIND_LABEL = function (k) { return { sessions: tr("会话", "Sessions"), memory: tr("记忆", "Memory"), home: tr("文件", "Files") }[k] || k; };
  // 卷 › 文件夹… › 名字.agent › 包里的：每一段 [去哪, 叫什么]
  function agentTrail(w) {
    var out = [];
    if (w.root) return out;
    if (w.conn) { out.push([CONN[w.conn].key, CONN[w.conn].name, "conn:" + w.conn]); connChain(w.cdir).forEach(function (c) { out.push([connArg(w.conn, c[0]), c[1], c[0] === "/" ? "disk" : "dir"]); }); return out; } // 连接器 › ~ › Documents › …（每一层）
    var vol = w.a ? A.volOf(w.a.id) : w.vol, segs = w.a ? String(w.a.path || "").split("/").filter(Boolean) : String(w.path || "").split("/").filter(Boolean);
    out.push([volKey(vol), volLabelOf(vol), vol === "cloud" ? "cloud" : "disk"]); // 第三样：路径条上画什么图标
    segs.forEach(function (sg, i) { out.push([[volKey(vol)].concat(segs.slice(0, i + 1)).join("/"), sg, "dir"]); });
    if (w.a) {
      var ba = agentArg(w.a);
      out.push([ba, w.a.name, "agent"]);
      if (w.kind) out.push([ba + "/" + w.kind, KIND_LABEL(w.kind), "dir"]);
      w.sub.forEach(function (sg, i) { out.push([[ba, w.kind].concat(w.sub.slice(0, i + 1)).join("/"), sg, "dir"]); });
    }
    return out;
  }
  var titleOf = function (w) { return w.conn ? (w.cdir ? dirName(w.cdir) : CONN[w.conn].name) : w.agents ? (w.root ? "Agent" : w.path ? w.path.split("/").pop() : volLabelOf(w.vol)) : w.fs ? nameOf(w.path, w.path.split("/").filter(Boolean).pop() || "/") : w.sub.length ? w.sub[w.sub.length - 1] : w.kind ? KIND_LABEL(w.kind) : w.a.name; };

  // ---- 左边一栏（同访达）：个人收藏、Agent、位置；点标题收起那一组；关不掉。最下面（左下角）是「文件 | Agent」两边的切换 ----
  function sideHtml(w) {
    var cur = w.fs ? w.path : w.agents ? "@agents" : w.a ? "@" + w.a.id : "";
    var row = function (key, go, icon, label, extra) { return '<div class="xs-it' + (key === cur ? " on" : "") + '" data-side="' + esc(go) + '"' + (extra || "") + ' title="' + esc(label) + '"><span class="xs-ic">' + icon + '</span><span class="xs-l">' + esc(label) + "</span></div>"; };
    var sec = function (id, title, rows) { var f = !!XV.fold[id]; return '<div class="xs-sec' + (f ? " fold" : "") + '"><div class="xs-h" data-fold="' + id + '"><span>' + esc(title) + '</span><span class="xs-chev">' + (f ? "›" : "⌄") + "</span></div>" + (f ? "" : rows.join("")) + "</div>"; };
    var side = w.fs ? "files" : "agents";
    var foot = LOC() ? '<div class="xs-foot"><div class="xs-seg st-seg" data-seg-key="finder-side" role="tablist">' + [["files", FINDER_ICON, tr("文件", "Files"), "File Finder"], ["agents", AGENTS_ICON, "Agent", "Agent Finder"]].map(function (x) {
      return '<button data-fside="' + x[0] + '" role="tab" title="' + x[3] + '"' + (side === x[0] ? ' class="on" aria-selected="true"' : "") + ">" + x[1] + "<span>" + esc(x[2]) + "</span></button>";
    }).join("") + "</div></div>" : ""; // 没有这台 Mac 的文件（网页里）：只有 Agent 这一边，不用切换
    var nav = function (inner) { return '<nav class="xs" tabindex="-1"><div class="xs-scroll">' + inner + "</div>" + foot + "</nav>"; };
    if (!w.fs) { // Agent Finder：同访达的「位置」——几个卷（Paimon Code）、Claude Code、Codex（连接器开着的）；置顶的 agent 放上面
      var curVol = w.a ? A.volOf(w.a.id) : w.vol || "";
      var vols = (pmVols() && A.volumes ? A.volumes() : []).map(function (v) {
        return '<div class="xs-it' + (!w.root && curVol === v.id && (w.a || !w.path) ? " on" : "") + (v.here ? "" : " off") + '" data-side="' + esc(volKey(v.id)) + '" data-vfto="' + esc(v.id + "|") + '" title="' + esc(v.label + (v.here ? "" : tr("（这台设备连不上）", " (not reachable from here)"))) + '"><span class="xs-ic">' + (v.id === "cloud" ? CLOUD_GLYPH : glyphSvg("disk")) + '</span><span class="xs-l">' + esc(v.label) + "</span></div>";
      });
      connKeys().forEach(function (k) { vols.push('<div class="xs-it' + (w.conn === k && (!w.cdir || w.cdir === home()) ? " on" : "") + '" data-side="' + esc(connHome(k)) + '" data-vfto="" title="' + esc(CONN[k].name) + '"><span class="xs-ic">' + connIcon(k, null, null, false, true) + '</span><span class="xs-l">' + esc(CONN[k].name) + "</span></div>"); }); // data-vfto：右键同卷的菜单、不是放文件的地方
      var pins = pmVols() ? A.list().filter(function (a) { return a.pinned; }).map(function (a) { return row("@" + a.id, agentArg(a), bundleIcon(a), a.name, ' data-agent="' + esc(a.id) + '"'); }) : []; // Paimon Code 连接器关了：没有它的卷、置顶
      if (!vols.length) return nav('<div class="xs-sec"><div class="xs-h"><span>' + esc(tr("没有打开的连接器（设置 › 连接器）", "No connectors are on (Settings › Connectors)")) + "</span></div></div>");
      var recent = row(w.root ? cur : "@recents", "agents", glyphSvg("recents"), tr("最近", "Recents"));
      return nav(sec("afav", tr("个人收藏", "Favorites"), [recent]) + (pins.length ? sec("pins", tr("置顶", "Pinned"), pins) : "") + sec("vols", tr("位置", "Locations"), vols));
    }
    var fav = PLACES().map(function (p) { return row(p[1], argOf(p[1]), glyphSvg(p[0]), nameOf(p[1], p[1].split("/").pop())); });
    var locs = LOC() ? [row("/", "/", glyphSvg("disk"), "Macintosh HD")] : []; // 不再列「Agent 工作目录」：Paimon 的 agent 没有工作目录，它们在 Agent 那边
    return nav((fav.length ? sec("fav", tr("个人收藏", "Favorites"), fav) : "") + (locs.length ? sec("loc", tr("位置", "Locations"), locs) : ""));
  }

  // ---- 右边的概览（同访达的预览栏）：agent——大图标、名字、「信息」；文件——上面是内容的预览，下面名字、种类、「信息」、「更多…」 ----
  function infoBlock(rows, more) {
    var all = XV.more ? rows.concat(more || []) : rows;
    return '<div class="xp-pvinfo"><div class="xp-pvh"><span>' + tr("信息", "Information") + "</span>" + (more && more.length ? '<span class="xp-link" data-act="more">' + (XV.more ? tr("收起", "Show Less") : tr("更多内容", "Show More")) + "</span>" : "") + "</div>" +
      all.filter(function (r) { return r[1] !== "" && r[1] != null; }).map(function (r) { return '<div class="xp-pvr"><span>' + esc(r[0]) + "</span><span>" + (r[1] && r[1].html ? r[1].html : esc(r[1])) + "</span></div>"; }).join("") + "</div>";
  }
  var EFFORT = { off: ["关", "Off"], low: ["低", "Low"], high: ["高", "High"], max: ["最高", "Max"] }, ACCESS = { none: ["仅自己的文件夹", "Own Folder Only"], read: ["只读", "Read Only"], rw: ["读写", "Read & Write"] };
  function agentPane(a) {
    var st = stateOf(a), rt = A.runtime(a.id), ss = sessionsOf(a.id), dd = dirsOf(a), dir = LOC() && !dd.cloud ? rt.home() : "", ef = EFFORT[a.effort || "high"] || ["", ""], ac = ACCESS[a.access || "read"] || ["", ""];
    var where0 = volLabelOf(A.volOf(a.id)) + (a.path ? " › " + String(a.path).split("/").join(" › ") : "");
    var rows = [[tr("状态", "Status"), dd.here === false ? tr("在「" + volLabelOf(A.volOf(a.id)) + "」上，这台设备连不上", "On “" + volLabelOf(A.volOf(a.id)) + "”, not reachable from here") : st.label], [tr("模型", "Model"), modelName(a)], [tr("推理强度", "Effort"), tr(ef[0], ef[1])], [tr("权限", "Access"), tr(ac[0], ac[1])], [tr("会话", "Sessions"), String(ss.length)], [tr("上次活跃", "Last Active"), longDate(a.active)]];
    var fdir = dd.here === false ? "" : dir ? tilde(dir) : dd.cloud ? dd.home : ""; // 它自己的文件夹（包里的「文件」）：点了进包里看
    var more = [[tr("位置", "Where"), where0], [tr("创建时间", "Created"), longDate(a.created)], [tr("它的文件夹", "Its Folder"), fdir ? { html: '<span class="xp-link" data-go="' + esc(agentArg(a) + "/home") + '">' + esc(fdir) + "</span>" } : ""], ["ID", a.id]];
    var mini = miniOf({ kind: "agent", id: a.id, a: a }, 5), top = mini ? '<div class="xp-agcard">' + miniBox(mini, "card") + "</div>" : '<div class="xp-pvtop">' + bundleIcon(a, "huge") + "</div>"; // 有对话：它现在的样子（同访达预览文稿的内容）
    return '<div class="xp-pv">' + top + '<div class="xp-pvname">' + esc(a.name) + '.agent</div><div class="xp-pvkind">Paimon Code Agent · ' + esc(volLabelOf(A.volOf(a.id))) + " · " + esc(tr(ss.length + " 个会话", ss.length + (ss.length === 1 ? " session" : " sessions"))) + "</div>" +
      infoBlock(rows, more) + "</div>"; // 同访达的预览栏：没有「打开」「显示包内容」按钮（双击打开、右键里有显示包内容），也不贴最后一句话 / 报错
  }
  var TEXTY = /^(md|markdown|txt|log|js|mjs|cjs|ts|tsx|jsx|json|jsonl|py|sh|zsh|bash|swift|c|h|cpp|go|rs|java|html|css|xml|yml|yaml|toml|csv|ini|conf|env|rb|php|sql|kt|m|mm|lua|r|pl|vue|svelte|gitignore)$/;
  var previewable = function (it) { return it.kind === "file" && (IMG.test(it.name) || TEXTY.test(extOf(it.name)) || !extOf(it.name)); };
  function filePane(it) {
    var n = it.kind === "dir" && it.path ? (function () { var l = (it.cloud ? listCloud : listDir)(it.path, redrawAll); return l ? visible(l).length : null; })() : it.n;
    var sub = kindName(it) + (it.kind === "file" ? " - " + kb(it.size) : n != null ? " - " + items(n) : "");
    var smini = it.kind === "session" ? miniOf(it, 5) : "";
    var top = smini ? '<div class="xp-agcard">' + miniBox(smini, "card") + "</div>" : previewable(it) ? '<div class="xp-pvcard" data-path="' + esc(it.path) + '"' + (it.cloud ? ' data-cloud="1"' : "") + "></div>" : '<div class="xp-pvtop">' + iconOf(it, "huge") + "</div>";
    var rows = it.kind === "session" ? [[tr("问答", "Prompts"), String(it.n || 0)], [tr("修改时间", "Modified"), longDate(it.time)]] : [[tr("创建时间", "Created"), it.cloud ? "" : longDate(birthOf(it.path))], [tr("修改时间", "Modified"), longDate(it.time)]];
    var more = it.path ? [[tr("位置", "Where"), tilde(parentOf(it.path) || "/")]].concat(it.kind === "file" ? [[tr("大小", "Size"), tr(it.size.toLocaleString() + " 字节", it.size.toLocaleString() + " bytes")]] : []) : [];
    return '<div class="xp-pv">' + top + '<div class="xp-pvname">' + esc(it.label || it.name) + '</div><div class="xp-pvkind">' + esc(sub) + "</div>" + infoBlock(rows, more) +
      '<div class="xp-pvmore"><button data-act="ctx"><span class="xp-dots">⋯</span>' + tr("更多…", "More…") + "</button></div></div>";
  }
  // Agent Finder 的文件夹 / 卷：大图标、名字、在哪、里面几个 agent
  function vfPane(it) {
    var up0 = vpParent(it.vpath), rows = it.volume ? [[tr("种类", "Kind"), it.vol === "cloud" ? "Cloud" : tr("Mac（Local）", "Mac (Local)")], [tr("状态", "Status"), it.off ? tr("这台设备连不上", "Not reachable from here") : tr("可以用", "Available")]]
      : [[tr("位置", "Where"), volLabelOf(it.vol) + (up0 ? " › " + up0.split("/").join(" › ") : "")]];
    rows = rows.concat([[tr("Agent", "Agents"), String(it.n || 0)], [tr("上次活跃", "Last Active"), longDate(it.time)]]);
    return '<div class="xp-pv"><div class="xp-pvtop">' + iconOf(it, "huge") + '</div><div class="xp-pvname">' + esc(it.label || it.name) + '</div><div class="xp-pvkind">' + esc(kindName(it) + " - " + it.note) + "</div>" + infoBlock(rows) + "</div>";
  }
  // Claude Code / Codex 的会话：大图标、名字、「信息」（状态、模型、项目文件夹、上次活跃），下面是最后一句话
  function sessPane(it) {
    var x = it.x || {}, k = it.conn;
    var rows = [[tr("状态", "Status"), it.status], [tr("模型", "Model"), it.sub], [tr("项目文件夹", "Project Folder"), x.cwd ? { html: '<span class="xp-link" data-go="' + esc(connArg(k, x.cwd)) + '">' + esc(tilde(x.cwd)) + "</span>" } : ""], [tr("上次活跃", "Last Active"), longDate(it.time)]];
    var more = [[tr("会话记录", "Transcript"), x.path ? tilde(x.path) : ""], [tr("大小", "Size"), x.size ? kb(x.size) : ""], ["ID", x.id]];
    return '<div class="xp-pv"><div class="xp-pvtop">' + iconOf(it, "huge") + '</div><div class="xp-pvname">' + nmH(it) + '</div><div class="xp-pvkind">' + esc(kindName(it) + (x.cwd ? " · " + dirName(x.cwd) : "")) + "</div>" +
      infoBlock(rows, more) + (x.last ? '<div class="xp-cslast">' + esc(clip(x.last, 600)) + "</div>" : "") + "</div>";
  }
  // 连接器的位置、项目文件夹：大图标、名字、在哪、几个会话、最近什么时候
  function connDirPane(it) {
    var rows = (it.croot ? [[tr("种类", "Kind"), tr("连接器", "Connector")]] : [[tr("位置", "Where"), tilde(it.cdir)]]).concat([[tr("会话", "Sessions"), String(it.n || 0)], [tr("上次活跃", "Last Active"), longDate(it.time)]]);
    return '<div class="xp-pv"><div class="xp-pvtop">' + iconOf(it, "huge") + '</div><div class="xp-pvname">' + esc(it.label || it.name) + '</div><div class="xp-pvkind">' + esc(kindName(it) + " - " + it.note) + "</div>" + infoBlock(rows) + "</div>";
  }
  function paneHtml(it, w) {
    if (!it) {
      if (w.a && !w.kind) return agentPane(w.a);
      if (w.fs) return filePane({ kind: "dir", name: w.path.split("/").pop() || "/", label: nameOf(w.path, w.path.split("/").pop()), path: w.path, time: 0 });
      if (w.conn) { var tp0 = w.cdir ? connTree(w.conn, redrawAll) : null, g0 = tp0 && tp0.at(w.cdir); return w.cdir ? g0 ? connDirPane(dirItem(w.conn, g0)) : "" : connDirPane(connRootItem(w.conn)); }
      if (w.agents && !w.root) return vfPane(vfItem(w.vol, w.path));
      return '<div class="xp-pempty">' + esc(tr(A.list().length + " 个 Agent", A.list().length + " agents")) + "</div>";
    }
    if (it.kind === "agent") return agentPane(it.a);
    if (it.vf || it.volume) return vfPane(it);
    if (it.kind === "csess") return sessPane(it);
    if (it.cf || it.croot) return connDirPane(it);
    if (it.kind === "identity") return '<div class="xp-pv"><div class="xp-pvcard"><pre class="xp-pre">' + esc(identityText(it.a)) + '</pre></div><div class="xp-pvname">' + esc(it.name) + '</div><div class="xp-pvkind">' + esc(kindName(it)) + "</div></div>";
    return filePane(it);
  }
  var identityText = function (a) { return JSON.stringify({ id: a.id, name: a.name, volume: A.volOf(a.id), folder: a.path || "", model: a.model, effort: a.effort || "high", access: a.access || "read", created: a.created ? new Date(a.created).toISOString() : "", home: A.runtime(a.id).home() }, null, 2); };
  // 文件的内容（概览里的预览、快速查看）：文字按扩展名高亮；Markdown 排好版；图片直接看；二进制的不预览（done(null)）
  var IMG = /\.(png|jpe?g|gif|webp|svg|heic|bmp)$/i;
  function fileView(path, lines, done, cloud) {
    if (!LOC() && !cloud) return done(null);
    var rd = function (o) { // Cloud 上的（agent 的包在服务器的沙盒里）：经 /api/sbx 读，以人的身份
      if (!cloud) return LOC().read(path, o);
      return fetch("/api/sbx/fs/read?as=user&path=" + encodeURIComponent(path)).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); }).then(function (b) { return o && o.max && b.byteLength > o.max ? b.slice(0, o.max) : b; });
    };
    if (IMG.test(path)) return rd().then(function (b) { var u = URL.createObjectURL(new Blob([b], { type: /\.svg$/i.test(path) ? "image/svg+xml" : "image/" + path.split(".").pop().toLowerCase().replace("jpg", "jpeg") })); done('<img class="xp-img" src="' + u + '" alt="">'); }, function () { done(null); });
    rd({ offset: 0, max: 256 << 10 }).then(function (b) {
      var text = new TextDecoder().decode(new Uint8Array(b));
      if (/\u0000/.test(text.slice(0, 2000))) return done(null);
      if (/\.(md|markdown)$/i.test(path) && window.TSU_GUI) return done('<div class="xp-md gv-md">' + TSU_GUI.md(text.split("\n").slice(0, lines * 4).join("\n")) + "</div>");
      var H = window.TSU_HL, L = H && H.LANG[H.langOf(path)], st = "";
      done('<pre class="xp-pre">' + text.split("\n").slice(0, lines).map(function (l) { if (!L) return esc(l); var r = H.line(l, st, L); st = r[1]; return r[0]; }).join("\n") + "</pre>");
    }, function () { done(null); });
  }
  // ======== agent 的对话缩略图（同访达里文稿显示自己的内容，不是一个图标）：最近几问照终端界面（TUI）/ 图形界面（GUI）的样子画——
  //   写法同 live.js（TTU 排 Markdown；❯ 灰底的问、● 回答、● Tool(参数) ⎿ 摘要、几条读文件 / 跑命令并成一行、✻ 用时）和 gui.js（气泡、gv-md、一行灰字的工具），
  //   样式也是那两套（.term .ask / .tdot、.gv-*）。静态的 HTML：不开终端、不订阅事件；按 agent（会话）缓存，会话、最后一问、界面风格、深浅色变了才重画 ========
  var E = "\x1b", RST = E + "[0m", BLD = E + "[1m", DOTC = "\uE017"; // DOTC：同 live.js 的状态点记号（TTU 给一格宽的框，里面换成 .tdot 圆点）
  var C24 = function (c) { return E + "[38;2;" + c + "m"; };
  var VERB_T = { Bash: ["Ran", "shell command", "shell commands"], Read: ["read", "file", "files"], Glob: ["searched for", "pattern", "patterns"], TaskOutput: ["checked", "task", "tasks"], TaskCreate: ["created", "task", "tasks"], TaskUpdate: ["updated", "task", "tasks"], TaskList: ["listed", "task list", "task lists"] };
  var TNAME = { web_search: "Web Search", WebFetch: "Fetch", SendMessage: "Social", ListAgents: "Social", help: "Help" };
  var vwid = function (s) { return window.TTU && TTU.visibleWidth ? TTU.visibleWidth(s) : String(s).length; };
  var padW = function (s, w) { var n = w - vwid(s); return n > 0 ? s + " ".repeat(n) : s; };
  var clipW = function (s, w) { s = String(s == null ? "" : s); if (vwid(s) <= w) return s; var out = "", n = 0; Array.from(s).some(function (ch) { var x = vwid(ch); if (n + x > w - 1) return true; out += ch; n += x; return false; }); return out + "…"; };
  // 按显示宽度折行（中文两格；英文按词）
  function wrapW(s, w) {
    var out = [];
    String(s == null ? "" : s).split("\n").forEach(function (para) {
      var toks = para.match(/\s+|[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]|[^\s\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]+/g) || [""], line = "", lw = 0;
      toks.forEach(function (t) {
        var tw = vwid(t);
        if (lw + tw > w && lw > 0) { out.push(line.replace(/\s+$/, "")); line = ""; lw = 0; if (/^\s+$/.test(t)) return; }
        while (tw > w && w > 0) { var cut = "", cw = 0; Array.from(t).some(function (ch) { var x = vwid(ch); if (cw + x > w) return true; cut += ch; cw += x; return false; }); if (!cut) break; out.push(cut); t = t.slice(cut.length); tw = vwid(t); }
        line += t; lw += tw;
      });
      out.push(line);
    });
    return out;
  }
  var sessOf = function (a, sid) { return sid ? A.allSessions().filter(function (x) { return x.id === sid; })[0] : A.runtime(a.id).session(); };
  var agentGui = function () { return !!(S.get && S.get("ui") === "gui" && window.TSU_GUI); }; // Agent 显示风格（同 live.js 的 uiMode）
  var termLight = function () { var t = T(); return t && t.termLight ? !!t.termLight() : root.classList.contains("light"); };
  function toolArgOf(p) { var a = p.input || {}; if (p.name === "web_search") return '"' + (a.query || "") + '"'; if (p.name === "WebFetch") return a.url || ""; if (p.name === "Bash") return a.command || ""; if (p.name === "Glob" || p.name === "Grep") return a.pattern || ""; if (p.name === "Agent") return a.description || ""; if (p.name === "SendMessage") return a.to || ""; return a.file_path || a.path || ""; }
  function mdLines(md, w, o) {
    var ls, blank = function (l) { return !String(l).replace(/\x1b\[[0-9;]*m/g, "").trim(); };
    try { ls = TTU.markdownLines(md, { width: w, theme: o.theme }); } catch (e) { ls = wrapW(md, w); }
    while (ls.length && blank(ls[0])) ls.shift();
    while (ls.length && blank(ls[ls.length - 1])) ls.pop();
    return ls;
  }
  function describeT(list, tone) { // 「Read 2 files, ran 1 shell command」：数字加粗（同 live.js 的 describe）
    var by = {}, order = [];
    list.forEach(function (p) { var k = p.name === "Grep" ? "Glob" : p.name; if (!by[k]) { by[k] = 0; order.push(k); } by[k]++; });
    return order.map(function (k, i) { var v = VERB_T[k] || [k, "call", "calls"], n = by[k], verb = i ? v[0].charAt(0).toLowerCase() + v[0].slice(1) : v[0].charAt(0).toUpperCase() + v[0].slice(1); return tone + (i ? ", " : "") + verb + " " + BLD + n + RST + tone + " " + (n === 1 ? v[1] : v[2]) + RST; }).join("");
  }
  // 一次工具调用（同 live.js 的 toolRows）：调用一行 + 结果——lvl：call 一行摘要 / preview 前几行 / full 更多（缩略图里也就十来行）
  function toolLinesT(p, o, lvl) {
    var D = o.D, dot = (p.status === "error" ? o.RED : p.status === "running" ? D : o.GREEN) + DOTC + RST, head = TNAME[p.name] || p.name, sub = "  " + D + "⎿" + RST + "  ";
    var rows = [dot + " " + BLD + head + RST + "(" + clipW(String(toolArgOf(p)).replace(/\n/g, " ↵ "), o.cols - vwid(head) - 5) + ")"];
    if (p.status === "running") rows.push(sub + D + "Running…" + RST);
    else if (p.status === "error") rows.push(sub + o.RED + clipW(String(p.error || p.summary || "Error").split("\n")[0], o.cols - 6) + RST);
    else if (p.summary || (p.detail && p.detail.length)) rows.push(sub + D + clipW(String(p.summary || p.detail[0]).split("\n")[0], o.cols - 6) + RST);
    var n = lvl === "full" ? (o.mini ? 6 : 16) : lvl === "preview" ? (o.mini ? 3 : 5) : 0;
    if (p.name === "Agent" || p.name === "Task") { // 子 Agent：按设置挑任务说明（prompt）、结果（报告）；过程不在对话记录里
      var cf = A.cfg || {}, sect = function (h, ls, tone) { if (!ls.length || !n) return; rows.push("     " + D + h + RST); ls.slice(0, n).forEach(function (l) { rows.push("       " + (tone || "") + clipW(String(l), o.cols - 8) + (tone ? RST : "")); }); if (ls.length > n) rows.push("       " + D + "… +" + (ls.length - n) + " lines" + RST); };
      if (cf.agentPrompt === true) sect("Prompt", String((p.input || {}).prompt || "").split("\n").filter(function (l) { return l.trim(); }), D);
      if (cf.agentResult !== false && p.status !== "error" && p.status !== "running") sect("Report", (p.detail || []).filter(function (l) { return String(l).trim(); }));
      return rows;
    }
    if (n && p.status !== "running") {
      var body = p.diff ? p.diff.filter(function (d) { return d.t !== "…"; }).map(function (d) { return (d.t === "+" ? o.GREEN + "+ " : d.t === "-" ? o.RED + "- " : "  ") + d.l + RST; })
        : p.results ? p.results.map(function (x) { return "· " + x.title; }) : (p.detail || []).slice(p.summary ? 0 : 1);
      body.slice(0, n).forEach(function (l) { rows.push("     " + (p.diff ? "" : D) + clipW(String(l), o.cols - 6) + (p.diff ? "" : RST)); });
      if (body.length > n) rows.push("     " + D + "… +" + (body.length - n) + " lines" + RST);
    }
    return rows;
  }
  // 一问 → 几行（同 live.js 的 turnRows，只要看得出样子的那些）：{ l: 一行 } 或 { ask: 灰底那几行 }
  function tuiTurn(t, o, out) {
    var cols = o.cols, D = o.D, sub = "  " + D + "⎿" + RST + "  ", few = o.mini ? 3 : 12;
    var L = function (x) { out.push({ l: x }); };
    var ask = function (text, mark) { var ls = []; String(text || "").split("\n").forEach(function (q) { ls.push.apply(ls, wrapW(q, cols - 2)); }); if (o.mini) ls = ls.slice(0, 4); out.push({ ask: ls.map(function (l, i) { return padW((i ? "  " : mark) + l, cols); }) }); };
    L("");
    if (t.compact) { L(D + "── " + L10("上下文已压缩 · 摘要") + " ──" + RST); return; } // 连接器那边压缩了上下文：一条分隔线（摘要不放进缩略图）
    if (t.recap !== undefined) { wrapW("※ recap: " + t.recap, cols - 2).forEach(function (l, i) { L(D + (i ? "  " : "") + l + RST); }); return; }
    if (t.cmd !== undefined) { ask(t.cmd, "❯ "); wrapW([t.note, t.err].filter(Boolean).join("\n"), cols - 6).forEach(function (l, i) { if (l) L((i ? "     " : sub) + D + l + RST); }); return; }
    if (t.bash !== undefined) {
      ask(t.bash, o.PINK + "!" + RST + " ");
      var ol = String(t.out || "").replace(/\s+$/, "").split("\n");
      if (t.code === null) L(sub + D + "Running…" + RST);
      else if (!ol[0]) L(sub + D + "(No output)" + RST);
      else { ol.slice(0, few).forEach(function (l, i) { L((i ? "     " : sub) + (t.code ? o.RED : "") + clipW(l, cols - 6) + (t.code ? RST : "")); }); if (ol.length > few) L("     " + D + "… +" + (ol.length - few) + " lines" + RST); }
      return;
    }
    if (t.note !== undefined && t.ask === undefined) { mdLines(t.note, cols - 5, o).forEach(function (l, i) { L((i ? "     " : sub) + l); }); return; }
    if (t.system) {
      if (t.social) t.social.forEach(function (m) { L(o.CYAN + "➤ " + BLD + (m.from_name || m.from || "") + RST); wrapW(String(m.text || ""), cols - 4).slice(0, few).forEach(function (l) { L("    " + l); }); });
      else (t.notices || []).forEach(function (n) { L((n.status === "done" ? o.GREEN : n.status === "stopped" ? D : o.RED) + DOTC + RST + " " + clipW((n.kind === "shell" ? "Background command" : "Agent") + ' "' + String(n.desc || n.cmd || n.id || "").replace(/\s+/g, " ").trim() + '" ' + (n.status === "done" ? "completed" : n.status === "stopped" ? "was stopped" : "failed"), cols - 2)); });
      return;
    }
    var askText = String(t.ask || "");
    if (t.images && t.images.length && !/\[Image #\d+\]/.test(askText)) askText = t.images.map(function (im, i) { return "[Image #" + (im && im.no ? im.no : i + 1) + "] "; }).join("") + askText; // 话里已经有 [Image #N]（图在原来的位置）就不另加
    if (!(t.cont && !askText.trim())) ask(askText, "❯ ");
    if (t.thought && (A.cfg || {}).thinking !== "hidden") { L(""); L(D + "∴ Thought for " + t.thought + "s" + RST); }
    // 工具：同对话里的设置——每类一个档位（隐藏的不画）；连着的读取与搜索并成一行（设置里可关）
    var parts = t.parts || [{ kind: "text", text: t.answer || "" }], group = [], merge = (A.cfg || {}).mergeReads !== false;
    var modeOf = function (q) { return A.toolMode ? A.toolMode(q) : "call"; };
    var flushG = function () { if (!group.length) return; L(""); L("  " + describeT(group, D)); group = []; };
    // 过程说明（夹在工具调用之间的话）/ 最终回复（最后一次调用工具之后的话）：同对话里的设置；在跑的这一问，最后那段也先算过程说明
    var cf = A.cfg || {}, lastTool = -1, liveT = o.live(t), pm = cf.progress || "full";
    parts.forEach(function (q, i) { if (q.kind === "tool") lastTool = i; });
    parts.forEach(function (q, qi) {
      var m = q.kind === "tool" ? modeOf(q) : "";
      if (q.kind === "tool" && merge && A.toolCat && A.toolCat(q.name) === "toolRead" && m !== "hidden" && q.status !== "background" && q.status !== "running" && q.status !== "error" && !(cf.toolModes || {})[q.name]) { group.push(q); return; }
      flushG();
      if (q.kind === "notice") return;
      if (q.kind === "tool") { if (m === "hidden") return; L(""); toolLinesT(q, o, m).forEach(L); return; }
      var md = String(q.text || "");
      if (!md.trim()) return;
      var fin = !liveT && qi > lastTool;
      if (fin ? cf.answers === false : pm === "hidden") return;
      if (!fin && pm === "line") { L(""); L(D + DOTC + " " + clipW(md.trim().split("\n")[0].replace(/^[#>*\-\s]+/, "").replace(/[*`_]/g, ""), cols - 4) + (md.trim().indexOf("\n") >= 0 ? " …" : "") + RST); return; }
      if (o.mini) md = md.split("\n").slice(-40).join("\n");
      L("");
      mdLines(md, cols - 2, o).forEach(function (l, i) { L((i ? "  " : o.BUL + " ") + l); });
    });
    flushG();
    // 系统错误（API 出错、网络、中断……）：同对话里「系统错误」的档位——完整（缩略图里最多 3 行）/ 一行 / 隐藏；中断、「没有内容」是灰的
    var em = (A.cfg || {}).sysErrors || "full", sysL = function (text, tone) { var ls = wrapW(String(text), cols - 6); if (em === "line" && ls.length > 1) ls = [clipW(String(text).replace(/\s+/g, " "), cols - 6)]; ls.slice(0, o.mini ? 3 : 12).forEach(function (l, i) { L((i ? "     " : sub) + tone + l + RST); }); };
    if (em !== "hidden" && t.error) sysL(t.error === "Interrupted by user" ? "Interrupted" : t.error, /^(Interrupted|Stopped)\b/.test(t.error) ? D : o.RED);
    if (em !== "hidden" && t.note && t.ask !== undefined) sysL(t.note, D);
    var st = t.stats, ft = (A.cfg && A.cfg.footer) || ["duration"];
    // 同对话里那一行（Claude Code 2.1.281）：这一问结束时还有后台 Agent 没跑完、现在也还在跑——「✻ Waiting for 2 background agents to finish」
    var wA = st && st.pendAgents && o.bgAgents && o.bgAgents() > 0 ? st.pendAgents : 0;
    if (st && st.secs && ft.indexOf("duration") >= 0 && !o.live(t)) { L(""); L(D + "✻ " + (wA ? "Waiting for " + wA + " background " + (wA === 1 ? "agent" : "agents") + " to finish" : (st.verb || "Worked") + " for " + A.fmt.ccDur(st.ms != null ? st.ms : st.secs * 1000)) + RST); }
  }
  function tuiHtml(items, o) {
    var h = "", lines = [];
    var toH = function (ls) { var x = TTU.ansiToHtml(ls.join("\n"), o.theme, { widthOf: TTU.visibleWidth, links: false }); if (S.hlHtml) x = S.hlHtml(x); return x.replace(/\uE017/g, '<span class="tdot"></span>'); };
    var flush = function () { if (lines.length) { h += toH(lines); lines = []; } };
    items.forEach(function (x) { if (x.ask) { flush(); h += '<span class="ask">' + toH(x.ask) + "</span>"; } else lines.push(x.l); });
    flush();
    return h;
  }
  // 图形界面的一问（同 gui.js 的 turnHtml：你的话是气泡、回答是 Markdown、工具一行灰字）
  function guiTitle(p) {
    var a = p.input || {}, n = p.name, base = function (f) { return String(f || "").split("/").pop(); };
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
    return n;
  }
  var L10 = function (zh) { return en() && window.TSU_I18N && TSU_I18N.t ? TSU_I18N.t(zh) : zh; }; // 同一句在图形界面里界面语言是英文时的样子（快速查看里的字不再经过翻译）
  var guiTool = function (p) { var t = guiTitle(p); if (p.status === "error") t += /[\u3000-\u9fff\uff00-\uffef]$/.test(t) ? "失败" : " 失败"; return '<div class="gv-tool' + (p.status === "error" ? " err" : "") + '"><button class="gv-sum" tabindex="-1"><span class="gv-st">' + esc(L10(t)) + "</span><i></i></button></div>"; };
  function guiTurn(t, o) {
    var md = window.TSU_GUI ? TSU_GUI.md : esc, cfg = A.cfg || {};
    if (t.compact) return '<div class="gv-compact"><button class="gv-sum" tabindex="-1"><span class="gv-st">' + esc(L10("上下文已压缩 · 摘要")) + "</span></button></div>";
    if (t.recap !== undefined) return cfg.recaps === false ? "" : '<div class="gv-note">' + esc(L10("回顾：" + t.recap)) + "</div>";
    if (t.cmd !== undefined) return '<div class="gv-cmdrec"><span class="gv-dim">' + esc(t.cmd) + "</span>" + (t.note ? '<div class="gv-note">' + md(t.note) + "</div>" : "") + (t.err ? '<div class="gv-note gv-err">' + esc(t.err) + "</div>" : "") + "</div>";
    if (t.bash !== undefined) return '<div class="gv-user"><div class="gv-bubble gv-mono">! ' + esc(t.bash) + '</div></div><div class="gv-ai">' + guiTool({ name: "Bash", input: { command: t.bash }, status: t.code === null ? "running" : t.code ? "error" : "done" }) + "</div>";
    if (t.note !== undefined && t.ask === undefined) return '<div class="gv-note">' + md(t.note) + "</div>";
    if (t.system) return (t.social || []).map(function (m) { return '<div class="gv-note"><b>' + esc(m.from_name || m.from) + "</b>：" + esc(m.text || "") + "</div>"; }).join("");
    var h = "", ask = String(t.ask || ""), ai = "", group = [];
    if (ask.trim() || (t.images && t.images.length)) h += '<div class="gv-user"><div class="gv-bubble">' + (!o.mini && t.images && t.images.length ? '<div class="gv-imgs">' + t.images.slice(0, 6).map(function (im) { return '<img src="' + TSU_IMG.of(im) + '" alt="">'; }).join("") + "</div>" : "") + esc(o.mini ? clip(ask, 300) : ask).replace(/\n/g, "<br>") + "</div></div>";
    if (t.thought && cfg.thinking !== "hidden") ai += '<div class="gv-think"><button class="gv-sum" tabindex="-1">' + esc(L10("思考了 " + t.thought + " 秒")) + "<i></i></button></div>";
    var flushG = function () {
      if (!group.length) return;
      var nr = group.filter(function (q) { return q.name === "Read" || q.name === "NotebookRead"; }).length, ns = group.length - nr; // 同 gui.js 的 readGroup：「读取了 3 个文件、搜索了 2 次」
      ai += group.length === 1 ? guiTool(group[0]) : '<div class="gv-group"><button class="gv-sum" tabindex="-1"><span class="gv-st">' + esc(L10([nr ? "读取了 " + nr + " 个文件" : "", ns ? "搜索了 " + ns + " 次" : ""].filter(Boolean).join("、"))) + "</span><i></i></button></div>";
      group = [];
    };
    // 工具：同对话里的设置——隐藏的类不画；连着的读取与搜索并成一组（设置里可关）；快速查看里「完整 / 预览」的画成卡片（结果的前几行，gui.js 的 detail）
    var merge = cfg.mergeReads !== false, modeOf = function (q) { return A.toolMode ? A.toolMode(q) : "call"; };
    var gparts = t.parts || [{ kind: "text", text: t.answer || "" }], gLast = -1, gLive = o.live ? o.live(t) : false, gpm = cfg.progress || "full";
    gparts.forEach(function (q, i) { if (q.kind === "tool") gLast = i; });
    gparts.forEach(function (q, qi) {
      if (q.kind === "tool") {
        var m = modeOf(q);
        if (m === "hidden") return;
        if (merge && A.toolCat && A.toolCat(q.name) === "toolRead" && q.status !== "error" && !(cfg.toolModes || {})[q.name]) { group.push(q); return; }
        flushG();
        if (!o.mini && m !== "call" && window.TSU_GUI && TSU_GUI.detail && q.status !== "running") ai += guiTool(q).replace(/<\/div>$/, '<div class="gv-det gv-card gv-peek">' + TSU_GUI.detail(q, true) + "</div></div>").replace('class="gv-tool', 'class="gv-tool open');
        else ai += guiTool(q);
        return;
      }
      flushG();
      if (q.kind !== "text" || !String(q.text || "").trim()) return;
      var gfin = !gLive && qi > gLast; // 最终回复 / 过程说明（一行：灰的第一句）
      if (gfin ? cfg.answers === false : gpm === "hidden") return;
      if (!gfin && gpm === "line") { ai += '<div class="gv-progl"><button class="gv-sum" tabindex="-1"><span class="gv-st">' + esc(String(q.text).trim().split("\n")[0].replace(/^[#>*\-\s]+/, "").replace(/[*`_]/g, "")) + "</span><i></i></button></div>"; return; }
      ai += '<div class="gv-md">' + md(o.mini ? String(q.text).split("\n").slice(-40).join("\n") : q.text) + "</div>";
    });
    flushG();
    // 系统错误：同 gui.js——回答外面单独一条（出错红、中断灰），按「系统错误」的档位（完整 / 一行 / 隐藏）
    var em = cfg.sysErrors || "full", bar = function (text, bad) { return '<div class="gv-syserr' + (bad ? " bad" : "") + (em === "full" ? " open" : "") + '"><button class="gv-sum" tabindex="-1"><span class="gv-set">' + esc(text) + "</span></button></div>"; };
    var errs = em === "hidden" ? "" : (t.error ? bar(t.error === "Interrupted by user" ? L10("已中断") : t.error, !/^(Interrupted|Stopped)\b/.test(t.error)) : "") + (t.note && t.ask !== undefined ? bar(t.note, false) : "");
    return h + (ai ? '<div class="gv-ai">' + ai + "</div>" : "") + errs;
  }
  // mini：缩略图用（少几问、长的回答只要最后一段）；不是 mini：快速查看（一整屏，最近 40 问）
  function snapOpts(mini) {
    var light = termLight(), c = function (d, l) { return C24(light ? l : d); };
    return { gui: agentGui(), light: light, theme: light ? "light" : "dark", mini: !!mini, cols: mini ? 56 : 84, n: mini ? 4 : 40,
      D: c("120;120;120", "130;130;130"), GREEN: c("78;186;101", "44;122;57"), RED: c("255;107;128", "171;43;63"), PINK: C24("253;93;177"), CYAN: c("61;187;255", "0;119;204"), BUL: light ? C24("85;85;85") + DOTC + RST : DOTC };
  }
  var SNAPS = {};
  // 画好的对话（HTML）；没有对话是 ""
  function snapHtml(a, o) {
    var s = sessOf(a, o.session), ts = (s && s.turns) || [], last = ts[ts.length - 1], rt = A.runtime(a.id);
    var bgA = (rt.tasks || []).filter(function (x) { return x.status === "running" && x.kind === "agent" && x.background; }).length; // 还在跑的后台 Agent（「Waiting for …」那行）
    var sig = [s && s.id, ts.length, last ? (last.parts || []).map(function (q) { return (q.kind || "")[0] + String(q.text || "").length + (q.status || ""); }).join(",") + "|" + String(last.answer || "").length + "|" + (last.error || "") + "|" + (last.stats ? 1 : 0) + "|" + (rt.stream && rt.stream.turn === last ? 1 : 0) : "", o.gui, o.light, o.cols, o.n, en(), S.get ? S.get("highlightScheme") : "", bgA].join("~");
    var key = a.id + "|" + (o.session || "") + "|" + (o.mini ? "m" : "f") + o.n, c = SNAPS[key];
    if (c && c.sig === sig) return c.html;
    var turns = ts.filter(function (t) { return !(t.system && !t.social && !(t.notices || []).length); }).slice(-o.n), html = "";
    o.live = function (t) { return !!(rt.stream && rt.stream.turn === t); };
    o.bgAgents = function () { return bgA; };
    if (turns.length && window.TTU) {
      if (o.gui) html = '<div class="gv xp-gsnap"><div class="gv-col gv-list">' + turns.map(function (t) { return '<div class="gv-turn">' + guiTurn(t, o) + "</div>"; }).join("") + "</div></div>";
      else { var items = []; turns.forEach(function (t) { tuiTurn(t, o, items); }); items.push({ l: "" }); html = '<div class="xp-tsnap' + (o.light ? " tl" : "") + '"><pre class="term terminal-style-ui' + (o.light ? " ttu-light" : "") + '"><span class="out">' + tuiHtml(items, o) + "</span></pre></div>"; }
    }
    SNAPS[key] = { sig: sig, html: html };
    return html;
  }
  // 缩小了放进一个框（图标、预览栏顶上、画廊）：画成 480 宽，按框的宽度缩放（fitMinis 量了设 --k），贴着底——最新的那几问看得见
  var MINI_W = 480;
  function miniOf(it, n) {
    var a = it.a || (it.kind === "agent" ? A.get(it.id) : null);
    if (!a) return "";
    var o = snapOpts(true);
    if (it.kind === "session") o.session = it.id;
    if (n) o.n = n;
    return snapHtml(a, o);
  }
  var miniBox = function (html, cls) { return '<div class="xp-mini ' + cls + '"><div class="xp-mini-in">' + html + "</div></div>"; };
  function agentThumb(it) { // 图标、画廊下面那排：对话的缩略图 + 右下角一个小的包图标（agent 的）
    var h = miniOf(it, 3);
    return h ? '<span class="xp-agthumb">' + miniBox(h, "thumb") + (it.kind === "agent" ? bundleIcon(it.a, "badge") : "") + "</span>" : "";
  }
  var thumbIcon = function (it, size) { var t0 = (it.kind === "agent" || it.kind === "session") && agentThumb(it); return t0 || iconOf(it, size); }; // 图标看法、画廊那排：agent / 会话有对话就是它的缩略图
  // 左边一栏从工具栏的下沿开始（同访达：上面那一截只是一块空的侧栏底）：量出工具栏的高，给 CSS
  // 分栏：放得下几栏就整栏地显示最后那几栏（左边不露半栏），右边空出来的给最后那块空栏
  function fitCols(host) {
    var cols = host.querySelector(".xp-cols"), fill = cols && cols.querySelector(".xp-colfill"), cs = cols ? cols.querySelectorAll(".xp-col:not(.xp-colfill)") : [], cw = cs.length ? cs[0].offsetWidth : 0;
    if (!cw || !fill) return;
    var n = Math.max(1, Math.min(cs.length, Math.floor((cols.clientWidth - 24) / cw)));
    fill.style.minWidth = Math.max(24, cols.clientWidth - n * cw) + "px";
    var first = cs.length - n, onI = -1;
    Array.prototype.forEach.call(cs, function (c, i) { if (c.querySelector(".xp-crow.on")) onI = i; });
    if (onI >= 0 && onI < first) first = onI; // 窄得只放得下一栏：选中的在前一栏里（文件夹本身）时，露出的是它那一栏
    cols.scrollLeft = first * cw;
  }
  function toolH(host) { var xp = host.querySelector(".xp"), tb = host.querySelector(".xp-tool"); if (xp && tb && tb.offsetHeight) xp.style.setProperty("--xp-toolh", tb.offsetHeight + "px"); }
  function fitMinis(host) {
    host.querySelectorAll(".xp-mini").forEach(function (m) {
      var w = m.clientWidth;
      if (!w) return;
      var k = Math.min(m.classList.contains("big") ? 1.25 : 1, w / MINI_W), inn = m.firstElementChild;
      m.style.setProperty("--k", k.toFixed(4));
      m.style.setProperty("--x", Math.max(0, (w - MINI_W * k) / 2).toFixed(1) + "px");
      m.classList.toggle("top", !!inn && inn.offsetHeight * k <= m.clientHeight + 1); // 放得下：从上面排起（同文稿的缩略图）；放不下：贴着底，看最新的
    });
  }
  function metaOf(it) {
    if (it.kind === "agent") { var st = stateOf(it.a); return ["Paimon Code Agent", modelName(it.a), st.label].filter(Boolean).join(" · "); }
    if (it.kind === "csess") return [kindName(it), it.sub, it.status, longDate(it.time)].filter(Boolean).join(" · ");
    if (it.kind === "session") return [kindName(it), tr((it.n || 0) + " 问", (it.n || 0) + " prompts"), longDate(it.time)].filter(Boolean).join(" · ");
    if (it.kind === "identity") return kindName(it);
    return [kindName(it), it.kind === "file" ? kb(it.size) : "", it.time ? tr("修改于 ", "Modified ") + longDate(it.time) : ""].filter(Boolean).join(" · ");
  }
  function bigBlock(it) { var m = metaOf(it); return '<div class="xp-qlbig">' + iconOf(it, "huge") + '<div class="xp-pvname">' + esc(it.label || it.name) + '</div><div class="xp-pvkind">' + esc(m) + "</div></div>"; }

  // ======== 快速查看（空格）：同 macOS 的 Quick Look——从这一项的图标放大出来，关的时候缩回它现在的位置（看不见了就淡出）；
  //   大小贴着内容：图片、PDF、影片按原来的比例（最大窗口的 85%，不放大，太小的放大到看得清）；文字一页宽、高度跟着内容；agent 的对话一屏终端宽；
  //   文件夹、App 是一张小卡片。开着时 ←→ / ↑↓ 换一项：内容换掉、大小动画过去。减少动态效果：只淡入淡出 ========
  var ql = null; // 开着的：{ el, bg, it, key, V, mode, tw, shown }
  var reduceMotion = function () { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); };
  var QL_EASE = "cubic-bezier(.2,.8,.2,1)";
  var qlKey = function (it) { return it ? [it.kind, it.path || "", it.id || "", it.name || "", it.time || 0, it.size || 0].join("|") : ""; };
  var sameItem = function (x, it) { return x === it || (it.path ? x.path === it.path : x.kind === it.kind && x.name === it.name && x.id === it.id); };
  var qlPlace = function (el, r) { el.style.left = r.x + "px"; el.style.top = r.y + "px"; el.style.width = r.w + "px"; el.style.height = r.h + "px"; };
  var chW = function (el) { var cs = getComputedStyle(el), cv = chW.c || (chW.c = document.createElement("canvas").getContext("2d")); cv.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily; return cv.measureText("0").width || 8; };
  // 这一项在列表里的图标（放大从这里出来、关的时候缩回这里）；看不见（滚走了、换了文件夹、页面不在前面）是 null
  function qlSrc(o) {
    var V = o.V, host = V && V.host;
    if (!host || !host.isConnected || !host.offsetParent) return null;
    var i = V.items.findIndex(function (x) { return sameItem(x, o.it); }), el = null;
    if (XV.view === "columns" && o.it.path && window.CSS && CSS.escape) el = host.querySelector('.xp-col:last-child [data-cpath="' + CSS.escape(o.it.path) + '"]');
    else if (XV.view === "gallery") el = i === (V.sel >= 0 ? V.sel : 0) ? host.querySelector(".xp-gal-big") : i >= 0 ? host.querySelector('[data-gi="' + i + '"]') : null;
    else if (i >= 0) el = host.querySelector('.xp-main [data-i="' + i + '"]');
    if (!el) return null;
    var ic = el.classList.contains("xp-gal-big") ? el : el.querySelector(".xp-agthumb, .xp-ic, .xb-ic") || el, r = ic.getBoundingClientRect(), m = host.querySelector(".xp-main"), mr = m ? m.getBoundingClientRect() : r;
    if (!r.width || !r.height || r.bottom <= mr.top || r.top >= mr.bottom || r.right <= mr.left || r.left >= mr.right) return null;
    return r;
  }
  // 按内容量出来的框：{ x, y, w, h }（居中）
  function qlMeasure(o) {
    var el = o.el, b = el.querySelector(".xp-qlb"), vw = innerWidth, vh = innerHeight, maxW = Math.floor(vw * 0.85), maxH = Math.floor(vh * 0.85), w, h;
    el.style.transition = "none";
    var natH = function (width) { el.style.width = width + "px"; el.style.height = "auto"; b.style.flex = "none"; var chrome = el.offsetHeight - b.offsetHeight, hh = chrome + b.scrollHeight; b.style.flex = ""; return { chrome: chrome, h: hh }; };
    if (o.mode === "img") {
      var img = b.querySelector("img"), nw = (img && img.naturalWidth) || 480, nh = (img && img.naturalHeight) || 360, chrome = natH(320).chrome; // 标题行、信息行、边框
      var sc = Math.min(1, (maxW - 2) / nw, (maxH - chrome) / nh);
      if (Math.max(nw, nh) * sc < 240) sc = Math.min(240 / Math.max(nw, nh), (maxW - 2) / nw, (maxH - chrome) / nh); // 很小的图：放大到看得清
      w = Math.max(Math.round(nw * sc) + 2, 320); h = Math.round(nh * sc) + chrome;
    } else if (o.mode === "text") {
      var pre = b.querySelector("pre"), cs = getComputedStyle(b), padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 2, tw = o.tw;
      if (tw === -1) tw = pre ? Math.max(420, Math.min(pre.scrollWidth, (o.cols || 90) * chW(pre) + 24) + padX) : 640; // 等宽的：最长那一行（终端界面的对话 84 格，代码最多 90 格）
      w = Math.min(maxW, Math.round(tw));
      h = Math.max(200, Math.min(maxH, natH(w).h));
    } else { w = Math.min(maxW, 400); h = Math.max(260, Math.min(maxH, natH(w).h)); }
    return { x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), w: w, h: h };
  }
  // 放大出来：从图标那一块（transform）变到这个框
  function qlZoomIn(o, r, src) {
    var el = o.el;
    qlPlace(el, r);
    el.style.visibility = "";
    o.bg.style.opacity = "1";
    if (reduceMotion() || !src) {
      el.style.transformOrigin = "50% 50%"; el.style.transform = reduceMotion() ? "none" : "scale(.96)"; el.style.opacity = "0";
      void el.offsetWidth;
      el.style.transition = "opacity .18s ease-out, transform .22s " + QL_EASE; el.style.opacity = "1"; el.style.transform = "none";
      return;
    }
    el.style.transformOrigin = "0 0";
    el.style.transform = "translate(" + (src.left - r.x) + "px," + (src.top - r.y) + "px) scale(" + Math.max(0.02, src.width / r.w) + "," + Math.max(0.02, src.height / r.h) + ")";
    el.style.opacity = "0.4";
    void el.offsetWidth;
    el.style.transition = "transform .26s " + QL_EASE + ", opacity .16s ease-out";
    el.style.transform = "none"; el.style.opacity = "1";
  }
  // 内容变了（换了一项、慢的内容到了）：大小动画过去
  function qlResize(o) {
    var el = o.el, f = el.getBoundingClientRect(), r = qlMeasure(o);
    if (reduceMotion() || !o.shown) { qlPlace(el, r); return; }
    qlPlace(el, { x: f.left, y: f.top, w: f.width, h: f.height });
    void el.offsetWidth;
    el.style.transition = ["left", "top", "width", "height"].map(function (k) { return k + " .22s " + QL_EASE; }).join(", ");
    qlPlace(el, r);
  }
  // 画这一项：标题行 + 内容；慢的（读文件、缩略图）好了再 ready()
  function qlFill(o, ready) {
    var it = o.it, key = o.key, g = gui(), el = o.el, name = esc(it.label || it.name), meta = esc(metaOf(it)), fin = false;
    var btns = '<span class="xp-qlbtns"><button data-act="ql-open">打开</button><button data-act="ql-close" title="关闭 (空格)">×</button></span>';
    el.className = "xp-ql " + (g ? "gv" : "tui");
    el.innerHTML = g ? '<div class="xp-qlh">' + iconOf(it) + '<div class="xp-qlt"><span class="xp-qln">' + name + '</span><span class="xp-qlm">' + meta + '</span></div><span class="xp-grow"></span>' + btns + '</div><div class="xp-qlb"></div>'
      : '<div class="xp-qlh"><span></span><span class="xp-qln">' + name + "</span>" + btns + '</div><div class="xp-qlm">' + meta + '</div><div class="xp-qlb"></div>';
    var b = el.querySelector(".xp-qlb");
    var set = function (html, mode, tw, cols) {
      if (o.key !== key || fin) return;
      fin = true;
      b.innerHTML = html; b.className = "xp-qlb xp-ql-" + mode; o.mode = mode; o.tw = tw || 0; o.cols = cols || 0;
      var img = mode === "img" && b.querySelector("img"), go = function () { if (o.key !== key) return; ready(); if (mode === "text") { var sc = b.querySelector(".xp-tsnap, .xp-gsnap") ? b : null; if (sc) sc.scrollTop = sc.scrollHeight; } }; // 对话：看最新的
      if (img && !(img.complete && img.naturalWidth)) img.onload = img.onerror = go; else go();
    };
    // Claude Code / Codex 的会话：同 Paimon 的 agent，画出这段对话（最近 40 问，按现在的显示方式）——读它的记录要一会儿：先等最多 4 秒，读到了就画；
    //   读不到（记录太大、没权限）才退回图标 + 最后一句
    if (it.kind === "csess") {
      var aid = it.conn + ":" + it.id, rt0 = null;
      try { rt0 = A.runtime(aid); } catch (e) { rt0 = null; }
      var fallback = function () { set(bigBlock(it) + (it.x && it.x.last ? '<div class="xp-cslast">' + esc(clip(it.x.last, 1200)) + "</div>" : ""), "card"); };
      if (!rt0 || !rt0.agent) return fallback();
      var so0 = snapOpts(false), t0 = Date.now();
      b.innerHTML = '<div class="xp-pempty">…</div>';
      var tryDraw = function () {
        if (o.key !== key || fin) return;
        var ss = rt0.session ? rt0.session() : null, n0 = ss && ss.turns ? ss.turns.length : 0;
        if (n0) { var sh0 = snapHtml(rt0.agent, so0); if (sh0) return set(sh0, "text", so0.gui ? 720 : -1, so0.cols); }
        if (Date.now() - t0 > 4000) return fallback();
        setTimeout(tryDraw, 200);
      };
      return tryDraw();
    }
    if (it.kind === "agent" || it.kind === "session") {
      var so = snapOpts(false);
      if (it.kind === "session") so.session = it.id;
      var sh = it.a ? snapHtml(it.a, so) : "";
      return sh ? set(sh, "text", so.gui ? 720 : -1, so.cols) : set(bigBlock(it), "card");
    }
    if (it.kind === "identity") return set('<pre class="xp-pre">' + esc(identityText(it.a)) + "</pre>", "text", -1, 76);
    b.innerHTML = '<div class="xp-pempty">…</div>';
    if (it.kind === "file" && previewable(it)) return fileView(it.path, 800, function (h) { if (!h) return set(bigBlock(it), "card"); set(h, /^<img/.test(h) ? "img" : "text", /xp-md/.test(h) ? 700 : -1, 90); }, it.cloud);
    if (it.kind === "file" && canThumb && THUMBABLE.test(it.name || "")) return nadosNative.call("fs.thumb", { path: it.path, size: 1600 }).then(function (u) { if (u) set('<img class="xp-img" src="' + u + '" alt="">', "img"); else set(bigBlock(it), "card"); }, function () { set(bigBlock(it), "card"); }); // PDF、影片、文稿：系统的缩略图（按原来的比例）
    set(bigBlock(it), "card");
  }
  function qlClose(instant) {
    var o = ql;
    if (!o) return;
    ql = null;
    var el = o.el, bg = o.bg, done = function () {
      el.remove(); bg.remove();
      if (!o.M || !window.STUDIO || !STUDIO.modal) return;
      STUDIO.modal.close(o.M);
      // 焦点回访达（打开时那个列表可能已经重画换掉了：找现在的那个）
      var mm = o.V && o.V.host && o.V.host.querySelector(".xp-main"), ae = document.activeElement;
      if (mm && (!ae || ae === document.body || !ae.isConnected)) try { mm.focus({ preventScroll: true }); } catch (e) { /* 聚不了焦 */ }
    };
    bg.style.opacity = "0";
    if (instant || !o.shown) return done();
    if (reduceMotion()) { el.style.transition = "opacity .14s"; el.style.opacity = "0"; setTimeout(done, 150); return; }
    var src = qlSrc(o), r = el.getBoundingClientRect();
    el.style.transition = "transform .22s cubic-bezier(.4,0,.7,.6), opacity .22s ease-in";
    if (src) { el.style.transformOrigin = "0 0"; el.style.transform = "translate(" + (src.left - r.left) + "px," + (src.top - r.top) + "px) scale(" + Math.max(0.02, src.width / r.width) + "," + Math.max(0.02, src.height / r.height) + ")"; el.style.opacity = "0.25"; }
    else { el.style.transformOrigin = "50% 50%"; el.style.transform = "scale(.94)"; el.style.opacity = "0"; }
    setTimeout(done, 240);
  }
  // quickLook(项, 这一页的 V)：开 / 换一项；quickLook(null)：关（instant：马上没，页面要走了）
  function quickLook(it, V, instant) {
    if (!it) return qlClose(instant);
    var key = qlKey(it);
    if (ql && V) ql.V = V;
    if (ql && ql.key === key) return ql.el; // 同一项（定时重画会走到这里）：不动
    if (ql) { var o0 = ql; o0.it = it; o0.key = key; qlFill(o0, function () { if (ql === o0) qlResize(o0); }); return o0.el; }
    var o = ql = { it: it, key: key, V: V || null, shown: false };
    o.bg = document.createElement("div"); o.bg.className = "xp-qlbg"; document.body.appendChild(o.bg);
    o.el = document.createElement("div"); o.el.style.visibility = "hidden"; document.body.appendChild(o.el);
    // VS Code、Claude App 风格：放进共用的模态层（底下的 App 标成 inert、点外面关、关了焦点回访达）；
    //   ↑↓←→ 照样换访达里选中的那一项（转给访达，快速查看跟着换，同 macOS）；空格、Esc 关（下面的全局按键）。macOS 风格照旧
    var dr = document.documentElement;
    if ((dr.classList.contains("st-os-vscode") || dr.classList.contains("st-os-claude")) && window.STUDIO && STUDIO.modal) {
      o.M = STUDIO.modal.open(o.el, { cls: "xp-qllayer", onBackdrop: function () { if (ql === o) quickLook(null); } });
      o.M.layer.insertBefore(o.bg, o.el);
      o.el.tabIndex = -1;
      o.M.layer.addEventListener("keydown", function (e) {
        if (!/^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown)$/.test(e.key)) return;
        var main = ql === o && o.V && o.V.host ? o.V.host.querySelector(".xp-main") : null;
        if (!main) return;
        e.preventDefault(); e.stopPropagation();
        main.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, code: e.code, shiftKey: e.shiftKey, metaKey: e.metaKey, altKey: e.altKey, ctrlKey: e.ctrlKey, bubbles: true, cancelable: true }));
      });
      o.M.layer.tabIndex = -1; // 焦点先放在这一层上（窗口还没显示出来、点不到）：按键都先到这里
      try { o.M.layer.focus({ preventScroll: true }); } catch (e) { /* 聚不了焦 */ }
    }
    var src = qlSrc(o);
    var show = function () { if (o.shown || ql !== o) return; o.shown = true; qlZoomIn(o, qlMeasure(o), src); };
    qlFill(o, function () { if (ql !== o) return; if (!o.shown) show(); else qlResize(o); });
    setTimeout(show, 260); // 内容半天没好（大文件、缩略图）：先按现在的样子放大出来，好了再变大小
    return o.el;
  }

  var SV = function (b) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' + b + "</svg>"; };
  // File Finder、Agent Finder 的图标：同活动栏上「文件」「Agents」那两个（标签页上、App 里一样，不再各画一套）
  // 访达（App 里、标签页上）：一张脸——圆角方块里一道竖着的分界、两只眼、一个笑（细线，同别的图标）
  var FINDER_FACE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M14.6 3.6C12.7 5.1 11.6 6.6 11.3 8.4L10.5 12.7l1.6.6c0 1.6.1 2.9.5 3.9.4 1.1.7 2.1 1 3.2"/><path d="M8.25 9.25v.7M15.2 9.25v.7"/><path d="M7.4 15c2.9 2.1 6 2.1 8.95-.1"/></svg>';
  var SV24 = function (b) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + b + "</svg>"; };
  var FINDER_ICON = SV24('<path d="M9.5 3.5h5.2l4.3 4.3v8.7a1.5 1.5 0 0 1-1.5 1.5h-8a1.5 1.5 0 0 1-1.5-1.5V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M14.5 3.7v3.1a1 1 0 0 0 1 1h3.3"/><path d="M5 7.5v11.2a1.8 1.8 0 0 0 1.8 1.8H15"/>'); // File Finder：两张纸
  var AGENTS_ICON = SV24('<path d="M10 4.5C10.5 9.2 12.8 11.5 17.5 12C12.8 12.5 10.5 14.8 10 19.5C9.5 14.8 7.2 12.5 2.5 12C7.2 11.5 9.5 9.2 10 4.5Z"/><path d="M18.5 2.8C18.7 4.6 19.4 5.3 21.2 5.5C19.4 5.7 18.7 6.4 18.5 8.2C18.3 6.4 17.6 5.7 15.8 5.5C17.6 5.3 18.3 4.6 18.5 2.8Z"/>'); // Agent Finder：✦
  // ---- 排序（同访达：名称、种类、修改日期、大小，正反两个方向；文件夹在前）、列表的列宽、拖动 ----
  XV.sort = store("st-xp-sort", { k: "name", d: 1 });
  XV.group = localStorage.getItem("st-xp-group") || "kind"; // none | kind | time | size（默认同访达：按种类分组）
  XV.clip = null; // 拷贝的（⌘C）：{ path, cut }；⌘V 贴到这个文件夹
  function groupOf(it) {
    if (it.vf || it.cf) return tr("文件夹", "Folders"); // Agent Finder 的文件夹（Paimon Code 的、Claude Code / Codex 的项目文件夹）：一组，放最前
    if (it.volume || it.croot) return "";
    var g = it.kind === "agent" || it.kind === "csess" ? (XV.agroup || "status") : XV.group;
    if (g === "status") return it.status || "";
    if (g === "model" && (it.kind === "agent" || it.kind === "csess")) return it.sub || tr("其他", "Other");
    if (g === "kind") { if (it.kind === "dir" || it.kind === "app") return it.kind === "app" ? tr("应用程序", "Applications") : tr("文件夹", "Folders"); var e = extOf(it.name || "").toLowerCase(); return /^(png|jpe?g|gif|webp|svg|heic|bmp|tiff?)$/.test(e) ? tr("图像", "Images") : /^(md|markdown|txt|rtf|pdf|docx?|pages|key|pptx?|xlsx?|csv)$/.test(e) ? tr("文稿", "Documents") : /^(js|mjs|ts|tsx|jsx|py|sh|zsh|swift|c|h|cpp|go|rs|java|json|jsonl|yml|yaml|toml|html|css|xml)$/.test(e) ? tr("开发者", "Developer") : /^(zip|gz|tgz|dmg|tar|7z)$/.test(e) ? tr("归档", "Archives") : /^(mp4|mov|mp3|wav|m4a)$/.test(e) ? tr("影片与音乐", "Movies & Music") : tr("其他", "Other"); }
    if (g === "time") { var d0 = new Date(); d0.setHours(0, 0, 0, 0); var t0 = it.time || 0, days = (d0.getTime() - t0) / 864e5; return t0 >= d0.getTime() ? tr("今天", "Today") : days < 1 ? tr("昨天", "Yesterday") : days < 7 ? tr("前 7 天", "Previous 7 Days") : days < 30 ? tr("前 30 天", "Previous 30 Days") : tr("更早", "Earlier"); }
    if (g === "size") { var sz = it.size; return it.kind === "dir" ? tr("文件夹", "Folders") : sz == null ? tr("其他", "Other") : sz < 1e6 ? tr("小于 1 MB", "Under 1 MB") : sz < 1e8 ? tr("1 MB 到 100 MB", "1 MB to 100 MB") : tr("大于 100 MB", "Over 100 MB"); }
    return "";
  }
  XV.agroup = localStorage.getItem("st-xp-agroup") || "status"; // Agent Finder 的分组：状态（默认）| model | time | none
  var GROUP_ORDER = function (name) { var o = [tr("运行中", "Running"), tr("空闲", "Idle"), tr("已归档", "Archived"), tr("今天", "Today"), tr("昨天", "Yesterday"), tr("前 7 天", "Previous 7 Days"), tr("前 30 天", "Previous 30 Days"), tr("更早", "Earlier"), tr("文件夹", "Folders"), tr("应用程序", "Applications")]; var i = o.indexOf(name); return i < 0 ? 50 : i; };
  XV.cols = store("st-xp-cols", null);
  function sortItems(list) {
    var st = XV.sort || { k: "name", d: 1 }, key = st.k, d = st.d || 1;
    var val = function (x) { return key === "status" ? (x.srank == null ? 9 : x.srank) : key === "kind" ? (x.kind === "agent" || x.kind === "csess" || x.cf ? x.sub || "" : kindName(x)) : key === "time" ? (x.time || 0) : key === "size" ? (x.size == null ? -1 : x.size) : (x.label || x.name || "").toLowerCase(); };
    return list.slice().sort(function (a, b) {
      var fa = a.kind === "dir" ? 0 : 1, fb = b.kind === "dir" ? 0 : 1;
      if (fa !== fb) return fa - fb;
      var va = val(a), vb = val(b), c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return c * d || String(a.label || a.name).localeCompare(String(b.label || b.name), undefined, { numeric: true });
    });
  }
  var colStyle = function () { return XV.cols && XV.cols.length === 4 ? "--xp-cols:" + XV.cols.map(function (w0, i) { return i === 0 ? "minmax(120px," + w0 + "px)" : w0 + "px"; }).join(" ") + ";" : ""; };
  // 能拖的（文件、文件夹、agent 的目录）：带着路径（终端、编辑区、文件夹都认）；Agent Finder 里 agent 的包、文件夹拖进别的文件夹（同一个卷）= 挪过去；
  // 卷、文件夹是放的地方（data-dvfto：卷|路径）；Cloud 上的文件不拖
  var dragAttr = function (it) {
    if (it.kind === "agent") return ' draggable="true" data-dagent="' + esc(it.id) + '"';
    if (it.vf) return ' draggable="true" data-dvf="' + esc(it.vol + "|" + it.vpath) + '" data-dvfto="' + esc(it.vol + "|" + it.vpath) + '"';
    if (it.volume) return ' data-dvfto="' + esc(it.vol + "|") + '"';
    return it.path && !it.cloud ? ' draggable="true" data-dpath="' + esc(it.path) + '"' + (it.kind === "dir" ? ' data-ddir="' + esc(it.path) + '"' : "") : "";
  };
  // ---- 四种看法（同访达）：图标、列表、分栏、画廊 ----
  var VSV = function (b) { return '<svg viewBox="0 0 16 16">' + b + "</svg>"; };
  var VIEWS = [
    ["grid", "图标", "Icons", VSV('<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>'), 1],
    ["list", "列表", "List", VSV('<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>'), 2],
    ["columns", "分栏", "Columns", VSV('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.4"/><path d="M6 3v10M10 3v10"/>'), 3],
    ["gallery", "画廊", "Gallery", VSV('<rect x="1.8" y="2.3" width="12.4" height="7.4" rx="1.2"/><rect x="2" y="11.2" width="3" height="2.5" rx=".6"/><rect x="6.5" y="11.2" width="3" height="2.5" rx=".6"/><rect x="11" y="11.2" width="3" height="2.5" rx=".6"/>'), 4],
  ];
  // 分栏（同访达）：从最上面一层（主目录 / 磁盘；Agent Finder 是几个卷）一层层列到现在这个地方，每层一栏；走过的那一项在上一栏里亮着；
  //   最后一栏是这里（文件、空文件夹、正在读都在这一栏里说，不换别的看法）。每栏顶上一行小字说这一层选中的（没选就是多数）是什么；
  //   栏是封闭的框：竖线到底，顶上那行下面的细线连着各栏一直到右边
  function colChain(w) {
    if (w.fs) {
      var h = home(), path = w.path, base = h && (path === h || path.indexOf(h + "/") === 0) ? h : "/", chain = [base];
      if (path !== base) { var rest = path.slice(base === "/" ? 1 : base.length + 1).split("/"), acc = base === "/" ? "" : base; rest.forEach(function (seg) { acc += "/" + seg; chain.push(acc); }); }
      return chain.map(function (d) { return argOf(d); });
    }
    return ["agents"].concat(agentTrail(w).map(function (x) { return x[0]; }));
  }
  var goOfItem = function (it) { return it.go || (it.kind === "agent" && it.a ? agentArg(it.a) : ""); }; // 这一项往里走是哪里（文件夹、卷、agent 的包）
  var leafInCols = function (it) { return !(it.go && it.kind === "dir"); }; // 分栏里点了不开新一栏的：文件、App、agent（包是一个整体，同 .app）、会话、身份卡
  var colKind = function (it) { return it.volume ? tr("宗卷", "Volume") : kindName(it); };
  function columnsHtml(w, V, list) {
    var chain = colChain(w), lastI = chain.length - 1;
    var cols = chain.map(function (arg, ci) {
      var last = ci === lastI, fake = { arg: arg }, items0 = last ? list : itemsOf(where(arg), fake, function () { redrawAll(); });
      if (items0 && !last) items0 = sortItems(items0);
      var next = chain[ci + 1], hit = null, rowsH = (items0 || []).map(function (it, i) {
        var g = goOfItem(it), on = last ? i === V.sel : !!next && (g === next || (it.path && argOf(it.path) === next)), dir = !leafInCols(it);
        var was = last && V.sel < 0 && V.trail && V.trail.at === (V.arg || "") && V.trail.name === it.name; // ← 退出来之前在这一栏选着的：淡的底色（再 → 回到它）
        if (on) hit = it;
        return '<div' + dragAttr(it) + (last ? ' data-i="' + i + '"' : "") + ' class="xp-crow' + (on ? (last || ci === lastI - 1 && V.sel < 0 ? " on" : " trail") : was ? " trail" : "") + (it.dot ? " dot" : "") + '"' + (it.path ? ' data-cpath="' + esc(it.path) + '"' : "") +
          ' data-cin="' + esc(arg) + '" data-cname="' + esc(it.name) + '"' + (dir ? ' data-cgo="' + esc(it.dflt || g) + '"' : "") + ">" + iconOf(it) + '<span class="xp-cn">' + nmH(it) + "</span>" + (dir ? '<span class="xp-carr">›</span>' : "") + "</div>";
      }).join("");
      var kinds = {}, top = "";
      (items0 || []).forEach(function (it) { var k = colKind(it); kinds[k] = (kinds[k] || 0) + 1; if (!top || kinds[k] > kinds[top]) top = k; });
      var head = hit ? colKind(hit) : top, err = last && w.fs && cache[w.path] && cache[w.path].err;
      var empty = !items0 ? "…" : err ? tr("无法读取这个文件夹", "Can't read this folder") : !items0.length ? (last && V.q ? tr("未找到结果", "No Results") : tr("空文件夹", "Empty Folder")) : "";
      return '<div class="xp-col" data-col="' + esc(arg) + '"><div class="xp-colh">' + esc(head) + '</div><div class="xp-colb">' + (rowsH || '<div class="xp-cempty">' + esc(empty) + "</div>") + "</div></div>";
    });
    return '<div class="xp-cols">' + cols.join("") + '<div class="xp-col xp-colfill"><div class="xp-colh"></div></div></div>';
  }
  // 画廊：上面一大块是选中那个的样子（没有选就第一个），下面一排小图，←→ 换
  function galleryHtml(list, V) {
    var cur = V.sel >= 0 ? list[V.sel] : list[0], bm = cur && (cur.kind === "agent" || cur.kind === "session") ? miniOf(cur, 8) : "";
    var big = bm ? '<div class="xp-gal-big xp-agbig">' + miniBox(bm, "big") + "</div>" : cur && (cur.kind === "file" && cur.path) ? '<div class="xp-gal-big xp-pvcard" data-path="' + esc(cur.path) + '"' + (cur.cloud ? ' data-cloud="1"' : "") + "></div>" : '<div class="xp-gal-big"><div class="xp-pvtop">' + (cur ? iconOf(cur, "huge") : "") + "</div></div>";
    return '<div class="xp-gal">' + big + '<div class="xp-gal-name">' + esc(cur ? cur.label || cur.name : "") + '</div><div class="xp-gal-strip">' + list.map(function (it, i) {
      return '<div class="xp-gal-it' + ((V.sel >= 0 ? i === V.sel : i === 0) ? " on" : "") + '" data-gi="' + i + '" title="' + esc(it.label || it.name) + '">' + thumbIcon(it, true) + "</div>";
    }).join("") + "</div></div>";
  }
  // ---- 访达的右键菜单：系统的菜单能画 App 的真图标（file）、颜色圆点（dot）、一排标签（dots）——studio.js 的 menu() 只转它认得的几样，这里自己交给原生；
  //      没有原生的菜单时（网页里、设置里关了）照样用网页画的：一排标签变成一组带颜色圆点的项，App 的图标用缩略图 ----
  var TAGSOF = {}; // 路径 → 上次问到的标签
  var DOT = function (c) { return '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="' + c + '" stroke="none"/></svg>'; };
  function keyOf(k) {
    k = String(k || "").trim();
    if (!k || /\s|…|↑|↓|←|→|空格/.test(k)) return null;
    var mods = [], i = 0, M0 = { "⌘": "cmd", "⇧": "shift", "⌥": "alt", "⌃": "ctrl" };
    while (i < k.length && M0[k[i]]) { mods.push(M0[k[i]]); i++; }
    var key = k.slice(i) === "⌫" ? "\b" : k.slice(i);
    return key.length === 1 ? { key: key.toLowerCase(), mods: mods.join(",") || "cmd" } : null;
  }
  function webMenu(list) {
    var out = [];
    list.forEach(function (it) {
      if (!it) return;
      if (it.dots) { it.dots.forEach(function (d) { out.push({ label: d.label, icon: DOT(d.color), checked: !!d.checked, run: d.run }); }); return; }
      var o = Object.assign({}, it);
      if (it.items) o.items = webMenu(it.items);
      if (it.dot && !o.icon) o.icon = DOT(it.dot);
      if (it.file && !o.icon) { var th = thumbOf({ kind: "app", path: it.file, name: it.file.split("/").pop(), time: 0 }, 32); if (th) o.icon = '<img src="' + th + '" alt="" width="16" height="16">'; }
      out.push(o);
    });
    return out;
  }
  function finderMenu(items, at) {
    if (!can("menu.popup") || (S.get && S.get("nativeMenus") === false)) return S.menu(webMenu(items), at);
    var byId = {};
    var conv = function (list, pre) {
      return list.filter(Boolean).map(function (it, i) {
        var id = pre + i;
        if (it.sep) return { sep: true };
        if (it.dots) return { dots: it.dots.map(function (d, j) { byId[id + "." + j] = d; return { id: id + "." + j, color: d.color, on: !!d.checked, title: d.label }; }) };
        byId[id] = it;
        var o = { id: id, title: it.label || "", enabled: !it.disabled, checked: !!it.checked }, k = keyOf(it.keys);
        if (k) { o.key = k.key; o.mods = k.mods; }
        if (it.sym) o.symbol = it.sym;
        if (it.file) o.file = it.file;
        if (it.dot) o.dot = it.dot;
        if (it.items) o.items = conv(it.items, id + ".");
        return o;
      });
    };
    var spec = conv(items, ""), back = document.activeElement;
    nadosNative.call("menu.popup", { items: spec, x: at.x || 0, y: at.y || 0 }).then(function (id) {
      if (back && back.focus && document.contains(back)) back.focus({ preventScroll: true });
      var it = id && byId[id];
      if (it && it.run) it.run();
    }, function () {});
  }
  // 这一处的规范地址（卷/文件夹…/名字.agent/…）：老的 <id>/… 进来也显示成这个
  var canonArg = function (w) { return w.conn ? connArg(w.conn, w.cdir) : w.a ? [agentArg(w.a)].concat(w.kind ? [w.kind] : []).concat(w.sub).join("/") : [volKey(w.vol)].concat(String(w.path || "").split("/").filter(Boolean)).join("/"); };
  S.pages.explorer = {
    title: function (arg) { var w = where(arg); return w.root ? tr("访达", "Finder") : titleOf(w); }, // 一个「访达」：左下角在「文件」「Agent」两边之间切换
    // 两个 App 共用这一页：File Finder（finder.local.paimon/…：整台 Mac 的文件）、Agent Finder（agents.local.paimon/<卷>/<文件夹>/<名字>.agent/…）
    address: function (arg) { var w = where(arg); return w.fs ? "finder.local.paimon" + (!arg ? "" : arg === "/" ? "/" : "/" + arg) : "agents.local.paimon" + (w.root ? "" : "/" + canonArg(w)); },
    icon: function () { return FINDER_FACE; }, // 标签页上：访达的图标（同 App 里那个，哪一边都一样）
    render: function (host, P, arg, V) {
      if (pages.indexOf(V) < 0) { V.gone = function () { return P.closed; }; pages.push(V); V.back = []; V.fwd = []; V.sel = -1; }
      V.host = host; // 快速查看要找这一项的图标（从那里放大、缩回那里）
      if (V.sel >= 0) V.self = false; // 选中了别的：不再说这个文件夹本身（「显示简介」的那一下）
      if (V.renaming && host.querySelector(".xp-ren")) return; // 正在改名：先不重画（不然输入框没了）
      if (V.sashing) return; // 正在拖两边的宽度
      var w = where(arg), list = itemsOf(w, V, function () { V.redraw(); }), q = (V.q || "").toLowerCase(), err = w.fs && cache[w.path] && cache[w.path].err;
      var deep = q && w.agents && !w.a ? deepFind(w, q, function () { V.redraw(); }) : null; // Agent Finder：在这个位置里往下找（同访达的搜索）；包里、文件照旧只筛这一层
      if (deep) list = deep;
      else if (list && q) list = list.filter(function (x) { return (x.label || x.name).toLowerCase().indexOf(q) >= 0 || x.name.toLowerCase().indexOf(q) >= 0; });
      if (list && !(w.root && !deep)) list = sortItems(list); // 「最近」：照最近动过的先后（不按名字重排、不分组）
      if (list && !(w.root && !deep) && XV.view !== "columns" && (w.agents ? XV.agroup !== "none" : XV.group !== "none")) { var gl = list.map(function (x, i) { return { x: x, g: groupOf(x), i: i }; }); var gord = function (g) { return w.agents && g === tr("文件夹", "Folders") ? -1 : GROUP_ORDER(g); }; gl.sort(function (a, b) { return gord(a.g) - gord(b.g) || String(a.g).localeCompare(String(b.g)) || a.i - b.i; }); list = gl.map(function (y) { y.x._grp = y.g; return y.x; }); } else if (list) list.forEach(function (x) { x._grp = ""; });
      V.items = list || [];
      if (V.pendingSel && list) { var ps = V.pendingSel; V.pendingSel = ""; V.sel = list.findIndex(function (x) { return x.name === ps; }); }
      if (V.sel >= V.items.length) V.sel = V.items.length - 1;
      var sel = V.sel >= 0 ? V.items[V.sel] : null, view = XV.view;
      var tool = '<div class="xp-tool"><button class="xp-tb" data-act="back" title="返回 (⌘[)"' + (V.back.length ? "" : " disabled") + '>‹</button><button class="xp-tb" data-act="fwd" title="前进 (⌘])"' + (V.fwd.length ? "" : " disabled") + ">›</button>" +
        '<div class="xp-title">' + esc(w.root ? tr("最近", "Recents") : titleOf(w)) + "</div><span class=\"xp-grow\"></span>" +
        (false ? '<div class="xp-seg">' + [["all", "全部"], ["running", "运行中"], ["archived", "已归档"]].map(function (x) { return '<button data-filter="' + x[0] + '"' + ((V.filter || "all") === x[0] ? ' class="on"' : "") + ">" + x[1] + "</button>"; }).join("") + "</div>" : "") +
        '<div class="xp-seg st-seg" data-seg-key="xp-view">' + VIEWS.map(function (x) { return '<button data-view="' + x[0] + '" title="' + esc(tr(x[1], x[2])) + " (⌘" + x[4] + ')"' + (view === x[0] ? ' class="on"' : "") + ">" + x[3] + "</button>"; }).join("") + "</div>" +
        '<button class="xp-tb' + (XV.pane ? " on" : "") + '" data-act="pane" title="' + esc(tr("预览", "Preview")) + '"><svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M10 3v10"/></svg></button>' +
        '<input class="xp-q" type="search" placeholder="搜索" spellcheck="false" autocomplete="off" value="' + esc(V.q || "") + '"></div>';
      var body;
      if (view === "columns") body = columnsHtml(w, V, list); // 分栏：空的、正在读的、出错的都在最后一栏里说，不换看法（Agent Finder 也有）
      else if (!list) body = '<div class="xp-pempty">…</div>';
      else if (err) body = '<div class="xp-pempty">' + esc(tr("无法读取这个文件夹", "Can't read this folder")) + "</div>";
      else if (!list.length) body = '<div class="xp-pempty">' + (q ? "未找到结果" : w.conn ? "暂无会话" : w.root ? tr("最近没有会话", "No recent sessions") : w.agents && !w.path ? "暂无 Agent" : "空文件夹") + "</div>";
      else if (view === "gallery") body = galleryHtml(list, V);
      else if (view === "grid") body = '<div class="xp-grid">' + list.map(function (it, i) { return '<div class="xp-it' + (i === V.sel ? " on" : "") + (it.dot ? " dot" : "") + '" data-i="' + i + '"' + dragAttr(it) + ">" + thumbIcon(it, "grid") + '<span class="xp-name">' + nmH(it) + "</span></div>"; }).join("") + "</div>";
      else body = '<div class="xp-table" style="' + colStyle() + '"><div class="xp-th">' + (w.agents ? [["name", tr("名称", "Name")], ["time", tr("上次活跃", "Last Active")], ["status", tr("状态", "Status")], ["kind", w.root ? tr("种类", "Kind") : w.conn && !w.cdir ? tr("位置", "Where") : tr("模型", "Model")]] : [["name", tr("名称", "Name")], ["time", tr("修改日期", "Date Modified")], ["size", tr("大小", "Size")], ["kind", tr("种类", "Kind")]]).map(function (h, ci) {
          var st = w.root && !deep ? { k: "time", d: -1 } : XV.sort || { k: "name", d: 1 }, on = st.k === h[0]; // 「最近」：照上次活跃（新的在前）
          return '<span class="xp-thc' + (on ? " on" : "") + '" data-sort="' + h[0] + '">' + esc(h[1]) + (on && h[1] ? '<i class="xp-sarr">' + (st.d > 0 ? "▲" : "▼") + "</i>" : "") + (ci < 3 ? '<i class="xp-colgrip" data-col="' + ci + '"></i>' : "") + "</span>";
        }).join("") + "</div>" + list.map(function (it, i) {
        var gh = it._grp && (i === 0 || list[i - 1]._grp !== it._grp) ? '<div class="xp-grp">' + esc(it._grp) + "</div>" : "";
        return gh + '<div class="xp-tr' + (i % 2 ? " alt" : "") + (i === V.sel ? " on" : "") + (it.dot ? " dot" : "") + '" data-i="' + i + '"' + dragAttr(it) + '><span class="xp-tn">' + iconOf(it) + nmH(it) + "</span><span>" + esc(when(it.time)) + '</span><span class="xp-tsz">' + esc(it.kind === "agent" || it.kind === "csess" ? it.status : it.kind === "file" ? kb(it.size) : it.note || "--") + "</span><span>" + esc(it.kind === "agent" || it.kind === "csess" || it.cf ? it.sub : kindName(it)) + "</span></div>";
      }).join("") + '<div class="xp-fill">' + Array.apply(null, Array(24)).map(function (_, k) { return '<div class="xp-tr xp-blank' + ((list.length + k) % 2 ? " alt" : "") + '"></div>'; }).join("") + "</div></div>";
      var msg = V.msg && Date.now() - V.msgAt < 6000 ? V.msg : ""; // 刚才出的错（改名重了、移不到废纸篓……）：在这里说几秒
      var status = '<div class="xp-status"><div class="xp-pathbar">' + pathBar(w) + '</div><span class="xp-count' + (msg ? " err" : "") + '">' + (msg ? esc(msg) : list ? esc(items(list.length)) + (V.sel >= 0 && sel ? " · " + esc(tr("已选择 1 项", "1 selected")) : "") : "") + "</span></div>";
      var xpw = (XV.sidew ? "--xp-sidew:" + XV.sidew + "px;" : "") + (XV.panew ? "--xp-panew:" + XV.panew + "px;" : ""), sashT = esc(tr("拖动调整宽度，双击恢复默认", "Drag to resize, double-click to reset"));
      var h = '<div class="xp' + (XV.pane ? " pane" : "") + '"' + (xpw ? ' style="' + xpw + '"' : "") + ">" + sideHtml(w) + '<div class="xp-sash side" data-sash="side" title="' + sashT + '"></div><div class="xp-right">' + tool + '<div class="xp-mid"><div class="xp-main" tabindex="0">' + body + "</div>" + (XV.pane ? '<div class="xp-sash pane" data-sash="pane" title="' + sashT + '"></div><div class="xp-pane">' + (sel ? (view === "columns" && !leafInCols(sel) ? "" : paneHtml(sel, w)) : V.self ? paneHtml(null, w) : "") + "</div>" : "") + "</div>" + status + "</div></div>";
      if (host.dataset.h !== h) {
        var had = host.querySelector(".xp-q"), qFocus = had && document.activeElement === had, main0 = host.querySelector(".xp-main"), top = main0 ? main0.scrollTop : 0, mFocus = main0 && document.activeElement === main0;
        var side0 = host.querySelector(".xs-scroll"), stop = side0 ? side0.scrollTop : 0, pane0 = host.querySelector(".xp-pane"), ptop = pane0 && host.dataset.psel === String(V.arg) + "|" + V.sel ? pane0.scrollTop : 0;
        var colTop = {}; host.querySelectorAll(".xp-col[data-col] > .xp-colb").forEach(function (b) { colTop[b.parentNode.dataset.col] = b.scrollTop; }); // 分栏：每一栏自己滚到哪
        host.dataset.h = h; host.innerHTML = h; host.dataset.psel = String(V.arg) + "|" + V.sel;
        host.querySelectorAll(".xp-col[data-col] > .xp-colb").forEach(function (b) {
          if (colTop[b.parentNode.dataset.col]) b.scrollTop = colTop[b.parentNode.dataset.col];
          var r = b.querySelector(".xp-crow.on, .xp-crow.trail");
          if (!r) return;
          var br = b.getBoundingClientRect(), rr = r.getBoundingClientRect();
          if (rr.top < br.top + 4) b.scrollTop -= br.top + 4 - rr.top; else if (rr.bottom > br.bottom - 4) b.scrollTop += rr.bottom - br.bottom + 4; // 亮着的那一行总在看得见的地方
        });
        var main = host.querySelector(".xp-main"), side1 = host.querySelector(".xs-scroll"), pane1 = host.querySelector(".xp-pane");
        main.scrollTop = top; if (side1) side1.scrollTop = stop; if (pane1) pane1.scrollTop = ptop;
        if (qFocus) { var qi = host.querySelector(".xp-q"); qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
        else if (mFocus) main.focus({ preventScroll: true });
        host.querySelectorAll(".xp-pvcard[data-path]").forEach(function (pv) {
          fileView(pv.dataset.path, 60, function (x) {
            if (!pv.isConnected) return;
            if (x) { pv.innerHTML = x; pv.classList.toggle("img", /^<img/.test(x)); }
            else { var it0 = V.items[V.sel] || V.items[0]; pv.outerHTML = '<div class="xp-pvtop">' + (it0 ? iconOf(it0, "huge") : "") + "</div>"; }
          }, pv.dataset.cloud === "1");
        });
        fitCols(host); fitMinis(host); toolH(host);
        requestAnimationFrame(function () { fitCols(host); }); // 排好版以后再对一次（刚换成分栏、预览栏刚开关时宽度还没定）
      }
      if (ql && sel && (!ql.V || ql.V === V)) quickLook(sel, V); // 快速查看开着：跟着这一页选中的换（别的访达窗口不动它）
      if (host.dataset.bound) return;
      host.dataset.bound = "1";
      new ResizeObserver(function () { fitCols(host); fitMinis(host); toolH(host); }).observe(host); // 分栏、对话缩略图跟着框的宽度；左边一栏跟着工具栏的高
      // ---- 两边的栏（左边一栏、右边的预览）：拖边上那条缝改宽度（同访达），双击回到默认；中间至少留 200 ----
      var SASH = { side: { key: "st-xp-sidew", prop: "--xp-sidew", xv: "sidew", col: ".xs", min: 150, max: 320, dir: 1 }, pane: { key: "st-xp-panew", prop: "--xp-panew", xv: "panew", col: ".xp-pane", min: 220, max: 480, dir: -1 } };
      host.addEventListener("pointerdown", function (e) {
        var sh = e.button === 0 && e.target.closest && e.target.closest(".xp-sash"), c = sh && SASH[sh.dataset.sash], xp = host.querySelector(".xp"), col = c && xp && xp.querySelector(c.col), mainEl = xp && xp.querySelector(".xp-main");
        if (!col) return;
        e.preventDefault(); e.stopPropagation();
        var x0 = e.clientX, w0 = parseFloat(getComputedStyle(col).width) || col.getBoundingClientRect().width, hi = Math.max(c.min, Math.min(c.max, w0 + (mainEl ? mainEl.getBoundingClientRect().width - 200 : 0))); // 宽度按 CSS 的 width（不含内边距、边框）算
        V.sashing = true; root.classList.add("xp-sashing"); sh.classList.add("drag");
        var mv = function (ev) { ev.preventDefault(); var w1 = Math.round(Math.max(c.min, Math.min(hi, w0 + (ev.clientX - x0) * c.dir))), x1 = host.querySelector(".xp"); XV[c.xv] = w1; if (x1) x1.style.setProperty(c.prop, w1 + "px"); fitMinis(host); };
        var upF = function () { window.removeEventListener("pointermove", mv, true); window.removeEventListener("pointerup", upF, true); window.removeEventListener("pointercancel", upF, true); V.sashing = false; root.classList.remove("xp-sashing"); sh.classList.remove("drag"); if (XV[c.xv]) localStorage.setItem(c.key, String(XV[c.xv])); redrawAll(); };
        window.addEventListener("pointermove", mv, true); window.addEventListener("pointerup", upF, true); window.addEventListener("pointercancel", upF, true);
      }, true);
      host.addEventListener("dblclick", function (e) { var sh = e.target.closest && e.target.closest(".xp-sash"), c = sh && SASH[sh.dataset.sash]; if (!c) return; e.preventDefault(); e.stopPropagation(); XV[c.xv] = 0; localStorage.setItem(c.key, ""); var x1 = host.querySelector(".xp"); if (x1) x1.style.removeProperty(c.prop); redrawAll(); }, true);
      var goTo = function (a0) { if (a0 === (V.arg || "") && a0 !== "") return; V.back.push(V.arg || ""); V.fwd = []; V.sel = -1; V.self = false; V.q = ""; V.trail = null; V.go(a0); };
      // ---- 分栏里的方向键（同访达）：选中的是最后一栏里的一项（V.sel ≥ 0），或者这个文件夹本身（V.sel < 0：它在前一栏里亮着，最后一栏是它里面的）。
      //   ↑↓ 在选中的那一栏里上下——走到文件夹就开出它那一栏（不记进返回的历史）；→ 进下一栏（回到刚才在那栏选着的，没有就第一项）；← 回前一栏，只退一层
      var colGo = function (a0, selName, trail) { V.sel = -1; V.self = false; V.q = ""; V.pendingSel = selName || ""; V.trail = trail ? { at: a0, name: trail } : null; V.go(a0); };
      var colPick = function (colArg, it, cur) { // 在 colArg 那一栏里选中 it：文件夹开出它那一栏；最后一栏里的直接选；前一栏里的文件：回那一层选它
        if (!it) return;
        if (!leafInCols(it)) return colGo(goOfItem(it));
        if (colArg === cur) { V.sel = V.items.indexOf(it); V.trail = null; return V.redraw(); }
        colGo(colArg, it.name);
      };
      var colKey = function (k) {
        var ch = colChain(where(V.arg)), cur = ch[ch.length - 1], par = ch.length > 1 ? ch[ch.length - 2] : null, its = V.items, d = k === "ArrowDown" ? 1 : k === "ArrowUp" ? -1 : 0;
        var colOf = function (a0) { return sortItems(itemsOf(where(a0), { arg: a0 }, function () { redrawAll(); }) || []); }; // 前一栏：同 columnsHtml 画的那一份、同样的顺序
        var isCur = function (x) { return goOfItem(x) === cur || (x.path && argOf(x.path) === cur); };
        if (d) {
          if (V.sel >= 0) return colPick(cur, its[V.sel + d], cur);
          if (!par) return colPick(cur, its[d > 0 ? 0 : its.length - 1], cur); // 最外面那一栏、什么都没选：从头 / 尾选起
          var sib = colOf(par), i0 = sib.findIndex(isCur);
          return i0 < 0 ? colPick(cur, its[0], cur) : colPick(par, sib[i0 + d], cur);
        }
        if (k === "ArrowRight") {
          if (V.sel >= 0) { var s0 = its[V.sel]; if (s0 && !leafInCols(s0)) colGo(goOfItem(s0)); return; }
          var tn = V.trail && V.trail.at === (V.arg || "") ? V.trail.name : "", t0 = tn ? its.filter(function (x) { return x.name === tn; })[0] : null;
          return colPick(cur, t0 || its[0], cur);
        }
        if (!par) return; // ←：最外面那一栏没有再往左的
        if (V.sel >= 0) { V.trail = { at: V.arg || "", name: its[V.sel].name }; V.sel = -1; return V.redraw(); } // 选着最后一栏里的：回到这个文件夹（前一栏里亮着）
        if (ch.length < 3) return; // 这个文件夹就在最外面那一栏里
        var me = colOf(par).filter(isCur)[0];
        colGo(par, "", me ? me.name : "");
      };
      var up = function () {
        var w2 = where(V.arg);
        if (w2.fs) { var pp = parentOf(w2.path); if (pp) goTo(argOf(pp)); return; }
        if (w2.a) { var ba0 = agentArg(w2.a); return goTo(w2.sub.length ? [ba0, w2.kind].concat(w2.sub.slice(0, -1)).join("/") : w2.kind ? ba0 : [volKey(A.volOf(w2.a.id))].concat(String(w2.a.path || "").split("/").filter(Boolean)).join("/")); }
        if (w2.conn) { var ch2 = connChain(w2.cdir); return goTo(ch2.length > 1 ? connArg(w2.conn, ch2[ch2.length - 2][0]) : w2.cdir ? CONN[w2.conn].key : "agents"); } // 上一层（~/Documents → ~ → Claude Code）
        if (w2.agents && !w2.root) goTo(w2.path ? [volKey(w2.vol)].concat(vpParent(w2.path).split("/").filter(Boolean)).join("/") : "agents");
      };
      // Claude Code / Codex 的会话：同 Agents 树里点它——用现在的外壳看它、接着说（开着的标签页就跳过去）；「在终端中继续」= 树的右键里那一项
      var openSess = function (it) {
        var sd = P.win && P.win.side, x1 = it.x || {};
        if (it.conn === "cc") { if (sd && sd.viewCC && window.TSU_CLAUDE) return sd.viewCC(x1.id, x1); if (sd && sd.openCC) return sd.openCC(x1.id, null, x1); return; }
        if (it.conn === "pi") { if (sd && sd.viewPI) sd.viewPI(x1.id, x1); return; }
        if (sd && sd.viewCX) sd.viewCX(x1.id, x1);
      };
      var contTerm = function (it) {
        var sd = P.win && P.win.side, x1 = it.x || {};
        if (it.conn === "cc") { if (sd && sd.openCC) sd.openCC(x1.id, null, x1); return; }
        if (x1.cwd && S.newTerm) S.newTerm(P.win, null, x1.cwd, it.conn === "pi" ? "pi --session " + shq(x1.path || x1.id) : "codex resume " + x1.id); // pi：按记录文件接着（另设了会话目录的也找得到）
      };
      var launch = function (path, reveal) { if (LOC() && LOC().exec) LOC().exec({ cmd: "/usr/bin/open " + (reveal ? "-R " : "") + shq(path), access: "user" }).catch(function () {}); };
      var copy = function (s) { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).catch(function () { if (window.nadosNative) nadosNative.call("clipboard.write", { text: s }).catch(function () {}); }); else if (window.nadosNative) nadosNative.call("clipboard.write", { text: s }).catch(function () {}); };
      var open = function (it, tab) {
        if (!it) return;
        if (it.kind === "agent") return openAgent(P, it.id);
        if (it.kind === "session") return openAgent(P, it.a.id, it.id);
        if (it.kind === "csess") return openSess(it);
        if (it.kind === "dir" && it.go) return tab ? S.openPage(P.win, "explorer", it.dflt || it.go) : goTo(it.dflt || it.go);
        if (it.kind === "app") return launch(it.path);
        if (it.kind === "identity" || it.cloud) return quickLook(it, V); // Cloud 上的文件：快速查看（编辑区开的是这台 Mac 的文件）
        if (it.kind === "file" && S.openFile) S.openFile(P.win, it.path);
      };
      var MI = S.menuIcons ? S.menuIcons() : {};
      var mi = function (l, k, run, icon, sym) { return { label: l, keys: k || "", run: run, icon: icon ? MI[icon] : undefined, sym: sym }; };
      // ---- 对文件做的事（同访达的右键菜单）：都不覆盖已有的（同名的先查、命令里再 test ! -e 一次）----
      var say = function (m) { V.msg = m; V.msgAt = Date.now(); V.redraw(); setTimeout(function () { if (V.msg === m) { V.msg = ""; V.redraw(); } }, 6000); };
      var fail = function (e) { say(String((e && e.message) || e || "").split("\n")[0].slice(0, 160) || tr("操作未能完成。", "The operation couldn’t be completed.")); };
      var sh = function (cmd) { return LOC() && LOC().exec ? LOC().exec({ cmd: cmd, access: "user" }).then(function (r) { if (r && r.code) throw new Error(String(r.err || r.out || "").trim() || "exit " + r.code); return r; }) : Promise.reject(new Error(tr("这里没有本机的文件", "No local files here"))); };
      var reload = function (dir, selName) { delete cache[dir]; if (selName) V.pendingSel = selName; redrawAll(); };
      var namesIn = function (dir) { var c = cache[dir]; return ((c && c.items) || []).map(function (x) { return x.name; }); };
      var freeName = function (dir, base, ext) { var names = namesIn(dir), n = base + ext, k = 2; while (names.indexOf(n) >= 0) n = base + " " + k++ + ext; return n; }; // 同名的已经有了：「名字 2」「名字 3」……
      var baseExt = function (it) { var m = it.kind !== "dir" && /^(.+?)(\.[^.\s]{1,12})$/.exec(it.name); return m ? [m[1], m[2]] : [it.name, ""]; };
      var join = function (dir, nm) { return (dir === "/" ? "" : dir) + "/" + nm; };
      // 系统的、有名字的文件夹（主目录、桌面、文稿、应用程序、/System……）和 agent 包里固定的几样：不能改名、移走
      var locked = function (it) { return !it.path || !!it.fixed || !!glyphOf(it.path) || /^\/[^/]*$/.test(it.path) || it.path === home(); };
      var trashIt = function (it) {
        if (!it || locked(it) || !can("fs.trash")) return;
        nadosNative.call("fs.trash", { path: it.path }).then(function (to) { XV.undo = to ? { from: to, to: it.path, what: tr("移到废纸篓", "Move to Trash") } : null; reload(parentOf(it.path)); }, fail);
      };
      var undo = function () { // ⌘Z：放回去（移到废纸篓、改名）
        var u = XV.undo;
        if (!u) return;
        XV.undo = null;
        sh("test ! -e " + shq(u.to) + " && /bin/mv -n " + shq(u.from) + " " + shq(u.to)).then(function () { delete cache[parentOf(u.from)]; reload(parentOf(u.to), u.to.split("/").pop()); }, fail);
      };
      var duplicate = function (it) {
        if (!it || locked(it)) return;
        var dir = parentOf(it.path), be = baseExt(it), nm = freeName(dir, be[0] + tr(" 副本", " copy"), be[1]), dst = join(dir, nm);
        sh("test ! -e " + shq(dst) + " && /bin/cp -Rp " + shq(it.path) + " " + shq(dst)).then(function () { reload(dir, nm); }, fail);
      };
      var makeAlias = function (it) {
        if (!it || !it.path || it.fixed) return;
        var dir = parentOf(it.path), nm = freeName(dir, it.name + tr(" 替身", " alias"), ""), dst = join(dir, nm);
        sh("test ! -e " + shq(dst) + " && /bin/ln -s " + shq(it.path) + " " + shq(dst)).then(function () { reload(dir, nm); }, fail);
      };
      var compress = function (it) {
        if (!it || !it.path || it.fixed) return;
        var dir = parentOf(it.path), nm = freeName(dir, it.name, ".zip"), dst = join(dir, nm);
        say(tr("正在压缩“" + it.name + "”…", "Compressing “" + it.name + "”…"));
        sh("test ! -e " + shq(dst) + " && /usr/bin/ditto -c -k --sequesterRsrc --keepParent " + shq(it.path) + " " + shq(dst)).then(function () { V.msg = ""; reload(dir, nm); }, fail);
      };
      var indexOf = function (it) { return V.items.findIndex(function (x) { return x === it || (it.path ? x.path === it.path : x.kind === it.kind && x.name === it.name && x.id === it.id); }); }; // 菜单开着时这一页可能重画过：按路径找回来
      var getInfo = function (it) { var i = indexOf(it); if (i >= 0) V.sel = i; XV.pane = true; XV.more = true; localStorage.setItem("st-xp-pane", "1"); localStorage.setItem("st-xp-more", "1"); redrawAll(); };
      var copyItem = function (it) { if (!it.path) return copy(it.name); XV.clip = { path: it.path }; copy(it.path); };
      var openWith = function (it, app) { if (can("fs.openWith")) nadosNative.call("fs.openWith", { path: it.path, app: app || "" }).catch(fail); else launch(it.path); };
      var chooseApp = function (it) { // 「打开方式 › 其他…」：系统的「选取应用程序」；老版本的 App 里没有：列出应用程序文件夹里的挑一个
        if (can("fs.chooseApp")) return nadosNative.call("fs.chooseApp", { message: tr("选取用来打开文稿“" + it.name + "”的应用程序。", "Choose an application to open the document “" + it.name + "”.") }).then(function (p) { if (p) openWith(it, p); }, fail);
        if (!LOC() || !S.quickPick) return;
        var all = [];
        Promise.all(["/Applications", "/System/Applications", home() + "/Applications"].map(function (d) { return LOC().list(d).then(function (l) { (l || []).forEach(function (x) { if (/\.app$/i.test(x.name)) all.push({ title: x.name.replace(/\.app$/i, ""), desc: tilde(d), id: d + "/" + x.name }); }); }, function () {}); })).then(function () {
          all.sort(function (a, b) { return a.title.localeCompare(b.title); });
          S.quickPick(P.win, { items: all, placeholder: tr("选取用来打开“" + it.name + "”的应用程序", "Choose an application to open “" + it.name + "”"), pick: function (x) { openWith(it, x.id); } });
        });
      };
      var share = function (it, at) { nadosNative.call("fs.share", { path: it.path, x: at.x || 0, y: at.y || 0 }).catch(fail); };
      var macStyle = function () { return document.documentElement.classList.contains("st-macos"); };
      var tabTerms = function () { var r0 = document.documentElement; return r0.classList.contains("st-macos") || r0.classList.contains("st-os-terminal") || !S.newTerm; }; // 终端是标签页（窗口）的风格
      var openTerm = function (dir) { // 新建位于文件夹位置的终端：终端是标签页（窗口）的风格开一个标签页，其余在底下的面板里
        if (tabTerms() && P.win && P.win.ws && P.win.ws.newTab) return P.win.ws.newTab({ sh: { cwd: dir, pty: true } });
        if (S.newTerm) S.newTerm(P.win, null, dir);
      };
      var newWindowAt = function (arg) { if (can("window.new")) nadosNative.call("window.new", { open: JSON.stringify({ sh: { cwd: "" }, page: "explorer", arg: arg }) }).catch(fail); }; // App 的新窗口里只开着这个文件夹
      var termItems = function (dir) { // 「服务」：同访达的「新建位于文件夹位置的终端窗口 / 标签页」
        var L1 = [mi(tabTerms() ? tr("新建位于文件夹位置的终端窗口", "New Terminal at Folder") : tr("新建位于文件夹位置的终端", "New Terminal at Folder"), "", function () { openTerm(dir); }, "tab", "terminal")];
        if (can("window.new") && !macStyle()) L1.push(mi(tr("新建位于文件夹位置的终端（新窗口）", "New Terminal Window at Folder"), "", function () { nadosNative.call("window.new", { open: JSON.stringify({ sh: { cwd: dir, pty: true } }) }).catch(fail); }, "window", "macwindow.badge.plus"));
        return L1;
      };
      // 标签（同访达：红橙黄绿蓝紫灰）：访达按名字认，名字跟着系统的语言（中文系统上红色的标签叫「红色」）
      var TAGS = [["#ff453a", "红色", "紅色", "Red"], ["#ff9f0a", "橙色", "橙色", "Orange"], ["#ffd60a", "黄色", "黃色", "Yellow"], ["#30d158", "绿色", "綠色", "Green"], ["#0a84ff", "蓝色", "藍色", "Blue"], ["#bf5af2", "紫色", "紫色", "Purple"], ["#98989d", "灰色", "灰色", "Gray"]];
      var tagName = function (t) { var l = XV.sysLang || ""; return /^zh-(Hant|TW|HK|MO)/i.test(l) ? t[2] : /^zh/i.test(l) ? t[1] : t[3]; };
      var tagLabel = function (t) { return en() ? t[3] : tagName(t); }; // 菜单上写的：界面是英文就写英文
      var hasTag = function (tags, t) { return (tags || []).some(function (x) { return x === t[1] || x === t[2] || x === t[3]; }); };
      var setTag = function (it, t, on) {
        return nadosNative.call("fs.tags", { path: it.path }).then(function (cur) {
          var rest = (cur || []).filter(function (x) { return x !== t[1] && x !== t[2] && x !== t[3]; });
          return nadosNative.call("fs.tags", { path: it.path, tags: on ? rest.concat([tagName(t)]) : rest });
        }).then(function (now) { TAGSOF[it.path] = now || []; redrawAll(); }, fail);
      };
      // 右键之前先问好：能用哪些 App 打开、有哪些标签（问不到的也不等太久）
      var prefetch = function (it) {
        var wait = function (p) { return Promise.race([p.catch(function () { return null; }), new Promise(function (r) { setTimeout(function () { r(null); }, 350); })]); };
        var apps = it.path && !it.cloud && it.kind !== "dir" && can("fs.apps") ? wait(nadosNative.call("fs.apps", { path: it.path })) : Promise.resolve(null);
        var tags = it.path && !it.cloud && can("fs.tags") ? wait(nadosNative.call("fs.tags", { path: it.path })) : Promise.resolve(null);
        var lang = XV.sysLang != null || !LOC() || !LOC().exec ? Promise.resolve() : wait(LOC().exec({ cmd: "/usr/bin/defaults read -g AppleLanguages", access: "user" }).then(function (r) { XV.sysLang = ((/"?([a-zA-Z-]+)"?/.exec(String((r && r.out) || "").replace(/[()\s]/g, "")) || [])[1] || ""); }));
        return Promise.all([apps, tags, lang]).then(function (x) {
          if (x[1]) TAGSOF[it.path] = x[1];
          (x[0] || []).forEach(function (ap) { thumbOf({ kind: "app", path: ap.path, name: ap.name, time: 0 }, 32); }); // 网页画的菜单用的 App 图标：先要着
          return { apps: x[0] || [], tags: x[1] || TAGSOF[it.path] || [] };
        });
      };
      // 「移到」：同一个卷里的文件夹（卷的最外层也算）；资源还不在卷里的（会话在账号里）也能换到这台 Mac / Cloud——只改索引，它的文件不跟着搬
      var moveToMenu = function (a) {
        var vol0 = A.volOf(a.id), cur0 = a.path || "", L1 = [];
        [""].concat(A.folders ? A.folders(vol0) : []).forEach(function (p) { if (p !== cur0) L1.push({ label: p ? p.split("/").join(" › ") : volLabelOf(vol0), icon: MI.tab, sym: p ? "folder" : "internaldrive", run: function () { A.move(a.id, p); } }); });
        var others = !(A.volumesV2 && A.volumesV2() && a.mig) && A.volumes ? A.volumes().filter(function (v) { return v.id !== vol0 && v.mine; }) : [];
        if (others.length) { if (L1.length) L1.push({ sep: true }); others.forEach(function (v) { L1.push({ label: v.label, icon: MI.tab, sym: v.id === "cloud" ? "cloud" : "internaldrive", run: function () { A.move(a.id, "", v.id); } }); }); }
        return { label: tr("移到", "Move To"), icon: MI.tab, sym: "folder", disabled: !L1.length, items: L1 };
      };
      // 一项的菜单（右键、预览栏最下面的「更多…」）：同访达——打开 / 打开方式 ›、移到废纸篓、显示简介、重新命名、压缩、复制、制作替身、快速查看、拷贝、共享、标签、快速操作 ›
      var itemMenu = function (it, info, at) {
        info = info || { apps: [], tags: TAGSOF[it.path] || [] };
        var nm = it.label || it.name, L0 = [mi(tr("打开", "Open"), "⌘↓", function () { open(it); }, "open", "arrow.up.forward.square")];
        if (it.kind === "agent") {
          L0.push(mi(tr("显示包内容", "Show Package Contents"), "", function () { goTo(agentArg(it.a)); }, "collapse", "shippingbox"));
          L0.push(moveToMenu(it.a));
          L0.push({ sep: true });
          L0.push(mi(tr("显示简介", "Get Info"), "⌘I", function () { getInfo(it); }, "image", "info.circle"));
          if (!info.side) L0.push(mi(tr("重新命名", "Rename"), "", function () { renameIt(it); }, "rename", "pencil"));
          L0.push(mi(tr("快速查看“", "Quick Look “") + nm + "”", "空格", function () { quickLook(it, V); }, "image", "viewfinder"));
          L0.push({ sep: true });
          L0.push(it.a.archived ? mi(tr("恢复", "Restore"), "", function () { A.unarchive(it.id); }, "history", "tray.and.arrow.up") : mi(tr("归档", "Archive"), "", function () { A.archive(it.id); }, "archive", "archivebox"));
          return L0;
        }
        if (it.kind === "csess") { // Claude Code / Codex 的会话：打开（上面那一项）、在终端中继续、快速查看、显示简介、项目文件夹、会话记录、拷贝 ID
          var x1 = it.x || {};
          L0.push(mi(tr("在终端中继续", "Continue in Terminal"), "", function () { contTerm(it); }, "tab", "terminal"));
          L0.push({ sep: true });
          L0.push(mi(tr("显示简介", "Get Info"), "⌘I", function () { getInfo(it); }, "image", "info.circle"));
          L0.push(mi(tr("快速查看“", "Quick Look “") + nm + "”", "空格", function () { quickLook(it, V); }, "image", "viewfinder"));
          L0.push({ sep: true });
          if (x1.cwd) L0.push(mi(tr("显示项目文件夹", "Show Project Folder"), "", function () { goTo(connArg(it.conn, x1.cwd)); }, "open", "folder"));
          if (x1.path && LOC()) L0.push(mi(tr("在访达中显示会话记录", "Show Transcript in Finder"), "", function () { launch(x1.path, true); }, "open", "doc.text.magnifyingglass"));
          L0.push(mi(tr("拷贝会话 ID", "Copy Session ID"), "", function () { copy(x1.id || it.id); }, "rename", "doc.on.doc"));
          return L0;
        }
        if (it.croot) { // Claude Code / Codex 自己（最外层那一栏）：打开（到 ~）、在新标签页中打开、在家目录新建会话、显示简介、连接器的设置
          var CN2 = window.TSU_CONNECTORS;
          L0.push(mi(tr("在新标签页中打开", "Open in New Tab"), "", function () { open(it, true); }, "tab", "plus.square.on.square"));
          if (CN2 && CN2.canNew && CN2.canNew(CONN[it.conn].key)) L0.push(mi(tr("新建会话", "New Session"), "", function () { CN2.newSession(CONN[it.conn].key, home()); }, "agent", "plus.circle"));
          L0.push({ sep: true });
          L0.push(mi(tr("显示简介", "Get Info"), "⌘I", function () { getInfo(it); }, "image", "info.circle"));
          if (S.settings) L0.push(mi(tr("连接器设置…", "Connector Settings…"), "", function () { S.settings(P.win, it.conn === "cc" ? "claude" : "connectors"); }, "gear", "gearshape"));
          return L0;
        }
        if (it.cf) { // Claude Code / Codex 的项目文件夹：打开 / 在新标签页中打开、新建会话、在访达中打开那个目录、拷贝路径
          var CN1 = window.TSU_CONNECTORS;
          L0.push(mi(tr("在新标签页中打开", "Open in New Tab"), "", function () { open(it, true); }, "tab", "plus.square.on.square"));
          if (CN1 && CN1.canNew && CN1.canNew(CONN[it.conn].key)) L0.push(mi(tr("在这里新建会话", "New Session Here"), "", function () { CN1.newSession(CONN[it.conn].key, it.cdir); }, "agent", "plus.circle"));
          L0.push({ sep: true });
          L0.push(mi(tr("显示简介", "Get Info"), "⌘I", function () { getInfo(it); }, "image", "info.circle"));
          if (LOC()) L0.push(mi(tr("在访达中打开", "Open in Finder"), "", function () { launch(it.cdir); }, "open", "folder"));
          L0.push(mi(tr("拷贝路径", "Copy Path"), "", function () { copy(it.cdir); }, "rename", "link"));
          return L0;
        }
        if (it.vf || it.volume) { // Agent Finder 的文件夹（在索引里，跟着账号走）、卷
          if (macStyle()) L0.push(mi(tr("在新窗口中打开", "Open in New Window"), "", function () { open(it, true); }, "window", "macwindow.badge.plus"));
          else L0.push(mi(tr("在新标签页中打开", "Open in New Tab"), "", function () { open(it, true); }, "tab", "plus.square.on.square"));
          if (it.vf) {
            L0.push({ sep: true });
            L0.push(Object.assign(mi(tr("删除空文件夹", "Delete Empty Folder"), "⌘⌫", function () { rmVF(it); }, "close", "trash"), { disabled: it.n > 0 })); // 里面还有 agent：先挪走
            L0.push({ sep: true });
            L0.push(mi(tr("显示简介", "Get Info"), "⌘I", function () { getInfo(it); }, "image", "info.circle"));
            L0.push(Object.assign(mi(tr("重新命名", "Rename"), "", function () { renameIt(it); }, "rename", "pencil"), { disabled: !!info.side || indexOf(it) < 0 }));
          } else L0.push(mi(tr("显示简介", "Get Info"), "⌘I", function () { getInfo(it); }, "image", "info.circle"));
          L0.push({ sep: true });
          L0.push(mi(tr("拷贝地址", "Copy Address"), "", function () { copy("agents.local.paimon/" + it.go); }, "rename", "link"));
          return L0;
        }
        if (it.cloud) { // Cloud 上的文件（服务器的沙盒里）：打开 / 快速查看、拷贝路径
          if (it.kind === "dir" && it.go) L0.push(mi(tr("在新标签页中打开", "Open in New Tab"), "", function () { open(it, true); }, "tab", "plus.square.on.square"));
          L0.push(mi(tr("快速查看“", "Quick Look “") + nm + "”", "空格", function () { quickLook(it, V); }, "image", "viewfinder"));
          L0.push({ sep: true });
          L0.push(mi(tr("拷贝路径", "Copy Path"), "⌥⌘C", function () { copy(it.path); }, "rename", "link"));
          return L0;
        }
        if (!it.path) { // 会话、身份卡、包里的「会话」：只有打开、快速查看
          if (it.kind === "dir" && it.go) L0.push(mi(tr("在新标签页中打开", "Open in New Tab"), "", function () { open(it, true); }, "tab", "plus.square.on.square"));
          L0.push(mi(tr("快速查看“", "Quick Look “") + nm + "”", "空格", function () { quickLook(it, V); }, "image", "viewfinder"));
          return L0;
        }
        var dirLike = it.kind === "dir", lock = locked(it);
        if (dirLike && it.go) {
          // 文件夹（同访达）：在新标签页 / 新窗口中打开——macOS 风格里标签页就是窗口：只有「在新窗口中打开」
          if (macStyle()) L0.push(mi(tr("在新窗口中打开", "Open in New Window"), "", function () { open(it, true); }, "window", "macwindow.badge.plus"));
          else {
            L0.push(mi(tr("在新标签页中打开", "Open in New Tab"), "", function () { open(it, true); }, "tab", "plus.square.on.square"));
            if (can("window.new")) L0.push(mi(tr("在新窗口中打开", "Open in New Window"), "", function () { newWindowAt(it.go); }, "window", "macwindow.badge.plus"));
          }
        }
        if (!dirLike && it.kind !== "app") {
          var apps = info.apps || [], def = apps.filter(function (x) { return x.default; })[0], rest = apps.filter(function (x) { return !x.default; }), sub = [];
          var appName = function (x) { return String(x.name || "").replace(/\.app$/i, ""); }; // 同访达：不带 .app
          if (def) sub.push({ label: appName(def) + tr("（默认）", " (default)"), file: def.path, run: function () { openWith(it, def.path); } });
          if (rest.length) { if (sub.length) sub.push({ sep: true }); rest.forEach(function (x) { sub.push({ label: appName(x), file: x.path, run: function () { openWith(it, x.path); } }); }); }
          if (!apps.length) sub.push({ label: tr("默认应用", "Default App"), sym: "macwindow", run: function () { openWith(it, ""); } });
          sub.push({ sep: true });
          sub.push({ label: tr("其他…", "Other…"), run: function () { chooseApp(it); } });
          L0.push({ label: tr("打开方式", "Open With"), icon: MI.window, sym: "macwindow", items: sub });
        }
        if (it.kind === "app") L0.push(mi(tr("显示包内容", "Show Package Contents"), "", function () { goTo(argOf(it.path)); }, "collapse", "shippingbox"));
        L0.push({ sep: true });
        if (can("fs.trash")) L0.push(Object.assign(mi(tr("移到废纸篓", "Move to Trash"), "⌘⌫", function () { trashIt(it); }, "close", "trash"), { disabled: lock }));
        L0.push({ sep: true });
        L0.push(mi(tr("显示简介", "Get Info"), "⌘I", function () { getInfo(it); }, "image", "info.circle"));
        L0.push(Object.assign(mi(tr("重新命名", "Rename"), "", function () { renameIt(it); }, "rename", "pencil"), { disabled: lock || !!info.side || indexOf(it) < 0 })); // 不在这一页的列表里（分栏里前面几栏的）：没处改
        L0.push(Object.assign(mi(tr("压缩“", "Compress “") + nm + "”", "", function () { compress(it); }, "archive", "archivebox"), { disabled: !!it.fixed }));
        L0.push(Object.assign(mi(tr("复制", "Duplicate"), "⌘D", function () { duplicate(it); }, "tab", "plus.square.on.square"), { disabled: lock }));
        L0.push(Object.assign(mi(tr("制作替身", "Make Alias"), "⌃⌘A", function () { makeAlias(it); }, "open", "arrowshape.turn.up.right"), { disabled: !!it.fixed }));
        L0.push(mi(tr("快速查看“", "Quick Look “") + nm + "”", "空格", function () { quickLook(it, V); }, "image", "viewfinder"));
        L0.push({ sep: true });
        L0.push(mi(tr("拷贝", "Copy"), "⌘C", function () { copyItem(it); }, "rename", "doc.on.doc"));
        L0.push(mi(tr("拷贝路径", "Copy Path"), "⌥⌘C", function () { copy(it.path); }, "rename", "link"));
        if (can("fs.share")) L0.push(mi(tr("共享…", "Share…"), "", function () { share(it, at || {}); }, "open", "square.and.arrow.up"));
        if (can("fs.tags")) {
          L0.push({ sep: true });
          L0.push({ dots: TAGS.map(function (t) { var on = hasTag(info.tags, t); return { label: tagLabel(t), color: t[0], checked: on, run: function () { setTag(it, t, !on); } }; }) });
          L0.push({ label: tr("标签…", "Tags…"), sym: "tag", items: TAGS.map(function (t) { var on = hasTag(info.tags, t); return { label: tagLabel(t), dot: t[0], checked: on, run: function () { setTag(it, t, !on); } }; }) });
        }
        L0.push({ sep: true });
        if (dirLike) { // 文件夹：快速操作 + 服务（同访达：「新建位于文件夹位置的终端窗口」在「服务」里）
          L0.push({ label: tr("快速操作", "Quick Actions"), sym: "bolt", items: [mi(tr("在访达中显示", "Show in Finder"), "", function () { launch(it.path, true); }, "open", "folder")] });
          L0.push({ label: tr("服务", "Services"), sym: "gearshape.2", items: termItems(it.path) });
        } else L0.push({ label: tr("快速操作", "Quick Actions"), sym: "bolt", items: [
          mi(tr("在访达中显示", "Show in Finder"), "", function () { launch(it.path, true); }, "open", "folder"),
          mi(tr("在所在文件夹打开终端", "Open Terminal at Enclosing Folder"), "", function () { openTerm(parentOf(it.path)); }, "tab", "terminal"),
        ] });
        return L0;
      };
      // 弹出这一项的菜单：先问好 App、标签，再交给系统的菜单（finderMenu）
      var showItemMenu = function (it, at, side) { if (!it) return; prefetch(it).then(function (info) { info.side = !!side; finderMenu(itemMenu(it, info, at), at); }); };
      // ---- 改名（同访达：名字那里变成输入框，选中不带扩展名的部分；回车 / 点别处定下，Esc 取消）----
      var renameIt = function (it) {
        if (!it || it.kind === "session" || it.kind === "identity" || it.kind !== "agent" && !it.vf && locked(it)) return;
        var i = indexOf(it);
        if (i < 0) return;
        it = V.items[i];
        if (V.sel !== i) { V.sel = i; V.redraw(); }
        var main = host.querySelector(".xp-main"), row = XV.view === "columns" ? host.querySelector(".xp-col:last-child .xp-crow.on") : main.querySelector('[data-i="' + i + '"]');
        var slot = XV.view === "gallery" ? host.querySelector(".xp-gal-name") : row && (row.querySelector(".xp-name, .xp-cn") || row.querySelector(".xp-tn"));
        if (!slot) return;
        var old = it.name, be = it.kind === "agent" || it.vf ? [old, ""] : baseExt(it), inp = document.createElement("input");
        inp.className = "xp-ren"; inp.value = old; inp.spellcheck = false; inp.setAttribute("autocomplete", "off");
        if (slot.classList.contains("xp-tn")) { var ic = slot.querySelector(".xp-ic, .xb-ic"); slot.textContent = ""; if (ic) slot.appendChild(ic); } else slot.textContent = "";
        slot.appendChild(inp);
        slot.classList.add("xp-renning");
        var dragEl = slot.closest("[draggable]"); if (dragEl) dragEl.draggable = false;
        V.renaming = true;
        var done = false;
        var back = function () { V.renaming = false; host.dataset.h = ""; V.redraw(); if (main.isConnected) main.focus({ preventScroll: true }); else { var m2 = host.querySelector(".xp-main"); if (m2) m2.focus({ preventScroll: true }); } };
        var finish = function (commit) {
          if (done) return;
          done = true;
          var nm = inp.value.trim();
          if (!commit || !nm || nm === old) return back();
          if (it.kind === "agent") { var er = A.runtime(it.id).rename(nm); back(); if (er) fail(er); return; }
          if (it.vf) { // Agent Finder 的文件夹：换这一层的名字（里面的 agent、子文件夹一起换前缀）
            if (/\//.test(nm)) { back(); return fail(tr("名称不能包含“/”。", "The name can’t contain “/”.")); }
            var up1 = vpParent(it.vpath), ok = A.moveDir(it.vol, it.vpath, (up1 ? up1 + "/" : "") + nm);
            V.pendingSel = ok ? nm : ""; back();
            if (!ok) fail(tr("名称“" + nm + "”已被使用。请选取另一个名称。", "The name “" + nm + "” is already taken. Please choose a different name."));
            return;
          }
          var dir = parentOf(it.path), dst = join(dir, nm);
          if (/\//.test(nm) || nm === "." || nm === "..") { back(); return fail(tr("名称不能包含“/”。", "The name can’t contain “/”.")); }
          if (namesIn(dir).indexOf(nm) >= 0) { back(); return fail(tr("名称“" + nm + "”已被使用。请选取另一个名称。", "The name “" + nm + "” is already taken. Please choose a different name.")); }
          V.renaming = false;
          sh("test ! -e " + shq(dst) + " && /bin/mv -n " + shq(it.path) + " " + shq(dst)).then(function () { XV.undo = { from: dst, to: it.path }; host.dataset.h = ""; reload(dir, nm); var m2 = host.querySelector(".xp-main"); if (m2) m2.focus({ preventScroll: true }); }, function (e) { back(); fail(e); });
        };
        inp.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.preventDefault(); finish(false); } });
        inp.addEventListener("blur", function () { finish(true); });
        ["click", "dblclick", "mousedown", "pointerdown", "contextmenu"].forEach(function (t) { inp.addEventListener(t, function (e) { e.stopPropagation(); }); });
        inp.focus();
        inp.setSelectionRange(0, be[0].length);
      };
      // 空白处的菜单：看法、显示隐藏文件
      var setGroup = function (g) { XV.group = g; localStorage.setItem("st-xp-group", g); V.sel = -1; redrawAll(); };
      // 新建的（文件夹、文本文件）：出现在列表里就进入改名（同访达）
      var renameWhenShown = function (dir, nm, tries) { var i = V.items.findIndex(function (x) { return x.path === join(dir, nm); }); if (i >= 0) return renameIt(V.items[i]); if ((tries || 0) < 20) setTimeout(function () { renameWhenShown(dir, nm, (tries || 0) + 1); }, 100); };
      // 删 Agent Finder 的文件夹：只删空的（里面还有 agent 的先挪走）；只是索引里的一条
      var rmVF = function (it) { if (!it || !it.vf) return; if (it.n > 0 || !A.rmdir(it.vol, it.vpath)) return fail(tr("“" + it.name + "”里还有 Agent，先把它们挪走。", "“" + it.name + "” still has agents in it. Move them out first.")); V.sel = -1; redrawAll(); };
      var newVFolder = function (w2) {
        var have = A.folders(w2.vol), base = tr("未命名文件夹", "untitled folder"), nm = base, k = 2, full = function (n0) { return (w2.path ? w2.path + "/" : "") + n0; };
        while (have.indexOf(full(nm)) >= 0) nm = base + " " + k++;
        if (!A.mkdir(w2.vol, full(nm))) return;
        V.pendingSel = nm; redrawAll();
        var tries = 0, go = function () { var i = V.items.findIndex(function (x) { return x.vf && x.vpath === full(nm); }); if (i >= 0) return renameIt(V.items[i]); if (tries++ < 20) setTimeout(go, 60); };
        setTimeout(go, 60);
      };
      var newFolder = function () { var w2 = where(V.arg); if (w2.conn) return; if (w2.agents && !w2.root) return newVFolder(w2); if (!w2.fs) return; var nm = freeName(w2.path, tr("未命名文件夹", "untitled folder"), ""); sh("test ! -e " + shq(join(w2.path, nm)) + " && /bin/mkdir " + shq(join(w2.path, nm))).then(function () { reload(w2.path, nm); renameWhenShown(w2.path, nm); }, fail); };
      var newFile = function () { var w2 = where(V.arg); if (!w2.fs) return; var nm = freeName(w2.path, tr("未命名", "untitled"), ".txt"); sh("test ! -e " + shq(join(w2.path, nm)) + " && /usr/bin/touch " + shq(join(w2.path, nm))).then(function () { reload(w2.path, nm); renameWhenShown(w2.path, nm); }, fail); };
      var paste = function (move) { var w2 = where(V.arg), c0 = XV.clip; if (!c0 || !w2.fs || !LOC() || !LOC().exec || parentOf(c0.path) === w2.path && move) return; LOC().exec({ cmd: (move ? "/bin/mv -n " : "/bin/cp -Rn ") + shq(c0.path) + " " + shq(w2.path + "/"), access: "user" }).then(function () { delete cache[w2.path]; delete cache[parentOf(c0.path)]; if (move) XV.clip = null; redrawAll(); }); };
      var bgMenu = function () {
        var w2 = where(V.arg), setAG = function (g) { XV.agroup = g; localStorage.setItem("st-xp-agroup", g); V.sel = -1; redrawAll(); };
        var inVol = w2.agents && !w2.root, vHere = !inVol || !A.volHere || A.volHere(w2.vol); // 别的 Mac 上的卷：这里建不了（它的文件在那台上）
        var CN = window.TSU_CONNECTORS, newIn = w2.conn && CN && CN.canNew && CN.canNew(CONN[w2.conn].key); // 连接器的位置里：在这个项目文件夹里新建会话
        if (w2.agents) return [
          w2.conn ? (newIn ? mi(tr("新建会话", "New Session"), "", function () { CN.newSession(CONN[w2.conn].key, w2.cdir || ""); }, "agent", "plus.circle") : null) : !pmVols() ? null : Object.assign(mi(tr("新建 Agent", "New Agent"), "", function () {
            var ag = A.create(inVol ? { vol: w2.vol, path: w2.path } : {});
            V.pendingSel = ag.name;
            if (inVol) redrawAll(); else goTo(volKey(A.volOf(ag.id))); // 在最外层（几个卷）：到它住的那个卷里选中它
          }, "agent", "plus.circle"), { disabled: !vHere }),
          inVol && !w2.conn ? mi(tr("新建文件夹", "New Folder"), "⇧⌘N", newFolder, "tab", "folder.badge.plus") : null,
          { sep: true },
          { label: tr("使用群组", "Use Groups"), checked: XV.agroup !== "none", run: function () { setAG(XV.agroup === "none" ? "status" : "none"); } },
          { label: tr("分组方式", "Group By"), items: [["status", "状态", "Status"], ["model", "模型", "Model"], ["time", "上次活跃", "Last Active"], ["none", "无", "None"]].map(function (x) { return { label: tr(x[1], x[2]), radio: true, checked: XV.agroup === x[0], run: function () { setAG(x[0]); } }; }) },
          { label: tr("排序方式", "Sort By"), items: [["name", "名称", "Name"], ["status", "状态", "Status"], ["time", "上次活跃", "Last Active"], ["kind", "模型", "Model"]].map(function (x) { return { label: tr(x[1], x[2]), radio: true, checked: (XV.sort || {}).k === x[0], run: function () { XV.sort = { k: x[0], d: (XV.sort || {}).d || 1 }; localStorage.setItem("st-xp-sort", JSON.stringify(XV.sort)); redrawAll(); } }; }) },
          { label: tr("显示方式", "View"), icon: MI.layout, sym: "square.grid.2x2", items: VIEWS.filter(function (x) { return x[0] !== "columns"; }).map(function (x) { return { label: tr(x[1], x[2]), radio: true, checked: XV.view === x[0], run: function () { XV.view = x[0]; localStorage.setItem("st-xp-view", XV.view); redrawAll(); } }; }) },
        ].filter(Boolean);
        var L0 = w2.fs ? [
          mi(tr("新建文件夹", "New Folder"), "⇧⌘N", newFolder, "tab", "folder.badge.plus"),
          mi(tr("新建文本文件", "New Text File"), "", newFile, "rename", "doc.badge.plus"),
          { sep: true },
          mi(tr("显示简介", "Get Info"), "⌘I", function () { V.sel = -1; V.self = true; XV.pane = true; localStorage.setItem("st-xp-pane", "1"); XV.more = true; localStorage.setItem("st-xp-more", "1"); redrawAll(); }, "image", "info.circle"), // 这个文件夹本身的简介
        ].concat(XV.clip ? [mi(tr("粘贴项目", "Paste Item"), "⌘V", function () { paste(false); }, "open", "doc.on.clipboard")] : []).concat([ // 有拷贝的东西才有「粘贴项目」（同访达）
          { sep: true },
          { label: tr("使用群组", "Use Groups"), checked: XV.group !== "none", run: function () { setGroup(XV.group === "none" ? "kind" : "none"); } },
          { label: tr("分组方式", "Group By"), items: [["kind", "种类", "Kind"], ["time", "修改日期", "Date Modified"], ["size", "大小", "Size"], ["none", "无", "None"]].map(function (x) { return { label: tr(x[1], x[2]), radio: true, checked: XV.group === x[0], run: function () { setGroup(x[0]); } }; }) },
        ]) : [];
        L0 = L0.concat([
          { label: tr("显示方式", "View"), icon: MI.layout, sym: "square.grid.2x2", items: VIEWS.map(function (x) { return [x[0], tr(x[1], x[2])]; }).map(function (x) { return { label: x[1], radio: true, checked: XV.view === x[0], run: function () { XV.view = x[0]; localStorage.setItem("st-xp-view", x[0]); redrawAll(); } }; }) },
          { label: tr("排序方式", "Sort By"), icon: MI.collapse, sym: "arrow.up.arrow.down", items: [["name", "名称", "Name"], ["kind", "种类", "Kind"], ["time", "修改日期", "Date Modified"], ["size", "大小", "Size"]].map(function (x) { return { label: tr(x[1], x[2]), radio: true, checked: (XV.sort || {}).k === x[0], run: function () { XV.sort = { k: x[0], d: (XV.sort || {}).d || 1 }; localStorage.setItem("st-xp-sort", JSON.stringify(XV.sort)); redrawAll(); } }; }).concat([{ sep: true },
            { label: tr("升序", "Ascending"), radio: true, checked: ((XV.sort || {}).d || 1) > 0, run: function () { XV.sort = { k: (XV.sort || {}).k || "name", d: 1 }; localStorage.setItem("st-xp-sort", JSON.stringify(XV.sort)); redrawAll(); } },
            { label: tr("降序", "Descending"), radio: true, checked: ((XV.sort || {}).d || 1) < 0, run: function () { XV.sort = { k: (XV.sort || {}).k || "name", d: -1 }; localStorage.setItem("st-xp-sort", JSON.stringify(XV.sort)); redrawAll(); } }]) },
          { sep: true },
          { label: tr("显示隐藏文件", "Show Hidden Files"), keys: "⇧⌘.", icon: MI.hidden, sym: "square.dashed", checked: XV.hidden, run: function () { toggleHidden(); } },
          { label: tr("显示预览", "Show Preview"), icon: MI.sideR, sym: "sidebar.right", checked: XV.pane, run: function () { XV.pane = !XV.pane; localStorage.setItem("st-xp-pane", XV.pane ? "1" : "0"); redrawAll(); } },
        ]);
        if (w2.fs) { L0.push({ sep: true }); L0.push({ label: tr("服务", "Services"), sym: "gearshape.2", items: termItems(w2.path) }); L0.push(mi(tr("在访达中打开", "Open in Finder"), "", function () { launch(w2.path); }, "open", "folder")); L0.push(mi(tr("拷贝路径", "Copy Path"), "", function () { copy(w2.path); }, "rename", "link")); }
        return L0;
      };
      var toggleHidden = function () { XV.hidden = !XV.hidden; localStorage.setItem("st-xp-hidden", XV.hidden ? "1" : "0"); redrawAll(); };
      var sideMenu = function (el) {
        var id = el.dataset.agent, go = el.dataset.side;
        if (id) { var a = A.get(id); return a ? itemMenu({ kind: "agent", id: id, a: a, name: a.name }, { side: true }) : []; }
        if (el.dataset.vfto !== undefined) return [mi(tr("打开", "Open"), "", function () { goTo(go); }, "open", "arrow.up.forward.square"), mi(tr("在新标签页中打开", "Open in New Tab"), "", function () { S.openPage(P.win, "explorer", go); }, "tab", "plus.square.on.square")]; // 卷
        var p = go === "agents" ? "" : fsPath(go);
        if (!p) return [mi("打开", "", function () { goTo(go); }, "open")];
        return [mi("打开", "", function () { goTo(go); }, "open", "arrow.up.forward.square"), mi(tr("在新标签页中打开", "Open in New Tab"), "", function () { S.openPage(P.win, "explorer", go); }, "tab", "plus.square.on.square"),
          { sep: true }, mi(tr("在访达中显示", "Show in Finder"), "", function () { launch(p, true); }, "open", "folder"), mi(tr("拷贝路径", "Copy Path"), "", function () { copy(p); }, "rename", "doc.on.doc")];
      };
      // Agent Finder：拖 agent 的包 / 文件夹，放到同一个卷里的文件夹上（左边一栏的卷 = 卷的最外层）
      var dropVF = function (e) { var t0 = e.target.closest && e.target.closest("[data-dvfto]"); if (!t0) return null; var s0 = t0.dataset.dvfto, i0 = s0.indexOf("|"); return { el: t0, vol: s0.slice(0, i0), dir: s0.slice(i0 + 1) }; };
      var vfOK = function (tg, src) { // 同一个卷；不放进自己、自己里面；本来就在那儿的不算
        if (!tg || !src || tg.vol !== src.vol) return false;
        if (src.agent) return src.path !== tg.dir;
        return tg.dir !== src.dir && vpParent(src.dir) !== tg.dir && tg.dir.indexOf(src.dir + "/") !== 0;
      };
      host.addEventListener("dragstart", function (e) {
        var dv = e.target.closest && e.target.closest("[data-dagent], [data-dvf]");
        if (dv) {
          var a1 = dv.dataset.dagent ? A.get(dv.dataset.dagent) : null, s1 = dv.dataset.dvf || "";
          host._dragV = a1 ? { agent: a1.id, vol: A.volOf(a1.id), path: a1.path || "" } : { vol: s1.slice(0, s1.indexOf("|")), dir: s1.slice(s1.indexOf("|") + 1) };
          e.dataTransfer.setData("text/plain", "agents.local.paimon/" + (a1 ? agentArg(a1) : [volKey(host._dragV.vol)].concat(host._dragV.dir.split("/")).join("/")));
          e.dataTransfer.effectAllowed = "move";
          return;
        }
        var d0 = e.target.closest && e.target.closest("[data-dpath]");
        if (!d0) return;
        var pth = d0.dataset.dpath;
        e.dataTransfer.setData("text/plain", pth);
        e.dataTransfer.setData("application/x-tsu-paths", JSON.stringify([pth]));
        e.dataTransfer.effectAllowed = "copyMove";
        host._drag = pth;
      });
      host.addEventListener("dragend", function () { host._drag = null; host._dragV = null; host.querySelectorAll(".xp-dropon").forEach(function (x) { x.classList.remove("xp-dropon"); }); });
      var dropDir = function (e) { var t0 = e.target.closest && e.target.closest("[data-ddir], .xs-it[data-side]:not([data-vfto])"); if (!t0) return null; var dd = t0.dataset.ddir || (t0.dataset.side && t0.dataset.side !== "agents" && !t0.dataset.agent ? fsPath(t0.dataset.side) : ""); return dd ? { el: t0, dir: dd } : null; };
      host.addEventListener("dragover", function (e) {
        if (host._dragV) {
          var tv = dropVF(e);
          host.querySelectorAll(".xp-dropon").forEach(function (x) { if (!tv || x !== tv.el) x.classList.remove("xp-dropon"); });
          if (!vfOK(tv, host._dragV)) return;
          e.preventDefault(); e.dataTransfer.dropEffect = "move"; tv.el.classList.add("xp-dropon");
          return;
        }
        var tg = dropDir(e), src = host._drag;
        host.querySelectorAll(".xp-dropon").forEach(function (x) { if (!tg || x !== tg.el) x.classList.remove("xp-dropon"); });
        if (!tg || !src || tg.dir === src || tg.dir === parentOf(src) || tg.dir.indexOf(src + "/") === 0) return;
        e.preventDefault(); e.dataTransfer.dropEffect = e.altKey ? "copy" : "move"; tg.el.classList.add("xp-dropon");
      });
      host.addEventListener("drop", function (e) {
        if (host._dragV) {
          var tv2 = dropVF(e), sv = host._dragV;
          host._dragV = null;
          host.querySelectorAll(".xp-dropon").forEach(function (x) { x.classList.remove("xp-dropon"); });
          if (!vfOK(tv2, sv)) return;
          e.preventDefault();
          if (sv.agent) A.move(sv.agent, tv2.dir);
          else if (!A.moveDir(sv.vol, sv.dir, (tv2.dir ? tv2.dir + "/" : "") + sv.dir.split("/").pop())) fail(tr("那里已经有叫“" + sv.dir.split("/").pop() + "”的文件夹了。", "There’s already a folder named “" + sv.dir.split("/").pop() + "” there."));
          return;
        }
        var tg = dropDir(e), src = host._drag;
        host.querySelectorAll(".xp-dropon").forEach(function (x) { x.classList.remove("xp-dropon"); });
        if (!tg || !src || !LOC() || !LOC().exec || tg.dir === parentOf(src)) return;
        e.preventDefault();
        var cmd = (e.altKey ? "/bin/cp -Rn " : "/bin/mv -n ") + shq(src) + " " + shq(tg.dir + "/"); // -n：同名的不覆盖
        LOC().exec({ cmd: cmd, access: "user" }).then(function () { delete cache[parentOf(src)]; delete cache[tg.dir]; redrawAll(); }, function () { redrawAll(); });
      });
      // 表头的缝：拖了调列宽（名称那列跟着剩下的宽度走）
      host.addEventListener("pointerdown", function (e) {
        var gp = e.target.closest(".xp-colgrip");
        if (!gp) return;
        e.preventDefault(); e.stopPropagation();
        var tbl = host.querySelector(".xp-table"), ths = tbl ? tbl.querySelectorAll(".xp-thc") : [];
        if (!ths.length) return;
        var widths = Array.prototype.map.call(ths, function (x) { return x.getBoundingClientRect().width; }), ci = +gp.dataset.col, x0 = e.clientX, w0 = widths.slice();
        var mv = function (ev) { var dx = ev.clientX - x0; widths[ci] = Math.max(60, w0[ci] + dx); if (ci + 1 < 4) widths[ci + 1] = Math.max(50, w0[ci + 1] - dx); XV.cols = widths.map(Math.round); tbl.style.cssText = colStyle(); };
        var upF = function () { window.removeEventListener("pointermove", mv, true); window.removeEventListener("pointerup", upF, true); localStorage.setItem("st-xp-cols", JSON.stringify(XV.cols)); redrawAll(); };
        window.addEventListener("pointermove", mv, true); window.addEventListener("pointerup", upF, true);
      }, true);
      host.addEventListener("click", function (e) {
        var sh = e.target.closest(".xp-thc[data-sort]");
        if (sh && !e.target.closest(".xp-colgrip") && sh.textContent.trim()) { var st = XV.sort || { k: "name", d: 1 }; XV.sort = st.k === sh.dataset.sort ? { k: st.k, d: -st.d } : { k: sh.dataset.sort, d: sh.dataset.sort === "time" || sh.dataset.sort === "size" ? -1 : 1 }; localStorage.setItem("st-xp-sort", JSON.stringify(XV.sort)); V.sel = -1; return redrawAll(); }
        var cc = e.target.closest(".xp-crow[data-cin]");
        if (cc) { // 分栏：文件夹（卷、包里的几样）开出下一栏；文件、agent 选中（在上一层的栏里就先走到那一层）
          if (cc.dataset.cgo) return goTo(cc.dataset.cgo);
          var dirA = cc.dataset.cin, here = V.arg || (where("").fs ? "~" : "agents");
          if (dirA !== here && !(dirA === "~" && !V.arg) && !(dirA === "agents" && !V.arg)) { V.pendingSel = cc.dataset.cname; return goTo(dirA); }
          V.sel = V.items.findIndex(function (x) { return x.name === cc.dataset.cname; }); V.redraw(); host.querySelector(".xp-main").focus({ preventScroll: true }); return;
        }
        var gi = e.target.closest("[data-gi]");
        if (gi) { V.sel = +gi.dataset.gi; return V.redraw(); }
        var crm = e.target.closest(".xp-crmore");
        if (crm && S.menu) { var rr = crm.getBoundingClientRect(), hid = JSON.parse(crm.dataset.hidden || "[]"); return S.menu(hid.map(function (x) { return { label: x[1], icon: MI.tab, sym: "folder", run: function () { goTo(x[0]); } }; }), { x: rr.left, y: rr.bottom + 4 }); }
        var cr = e.target.closest(".xp-cr[data-go], .xp-link[data-go], .xp-pb[data-go]"), act = e.target.closest("[data-act]"), fb = e.target.closest("[data-filter]"), vb = e.target.closest("[data-view]"), it = e.target.closest("[data-i]"), sd = e.target.closest("[data-side]"), fold = e.target.closest("[data-fold]");
        var fsd = e.target.closest("[data-fside]"); // 左下角「文件 | Agent」：换到另一边（文件回主目录）
        if (fsd) { var cur0 = where(V.arg).fs ? "files" : "agents"; try { localStorage.setItem("st-finder-side", fsd.dataset.fside); } catch (e1) { /* 满了 */ } if (fsd.dataset.fside !== cur0) goTo(fsd.dataset.fside === "agents" ? "agents" : ""); return; } // 记住上次在哪一边：App 里「访达」从这一边打开
        if (fold) { XV.fold[fold.dataset.fold] = !XV.fold[fold.dataset.fold]; localStorage.setItem("st-xp-side", JSON.stringify(XV.fold)); return redrawAll(); }
        if (sd) return goTo(sd.dataset.side);
        if (cr) return goTo(cr.dataset.go);
        if (fb) { V.filter = fb.dataset.filter; V.sel = -1; return V.redraw(); }
        if (vb) { XV.view = vb.dataset.view; localStorage.setItem("st-xp-view", XV.view); return redrawAll(); }
        if (act) {
          var k = act.dataset.act, cur = V.items[V.sel];
          if (k === "back" && V.back.length) { V.fwd.push(V.arg || ""); V.sel = -1; return V.go(V.back.pop()); }
          if (k === "fwd" && V.fwd.length) { V.back.push(V.arg || ""); V.sel = -1; return V.go(V.fwd.pop()); }
          if (k === "pane") { XV.pane = !XV.pane; localStorage.setItem("st-xp-pane", XV.pane ? "1" : "0"); return redrawAll(); }
          if (k === "more") { XV.more = !XV.more; localStorage.setItem("st-xp-more", XV.more ? "1" : "0"); return redrawAll(); }
          var w3 = where(V.arg), subj = cur || (w3.a && !w3.kind ? { kind: "agent", id: w3.a.id, a: w3.a, name: w3.a.name } : null);
          if (k === "open") return open(subj);
          if (k === "enter" && subj && subj.kind === "agent") return goTo(agentArg(subj.a));
          if (k === "ctx" && S.menu) { var r = act.getBoundingClientRect(), it2 = cur || (w3.fs ? { kind: "dir", name: w3.path.split("/").pop(), path: w3.path, go: null } : null); if (it2) { if (it2.go === null && it2.kind === "dir") S.menu(bgMenu(), { x: r.left, y: r.bottom + 4 }); else showItemMenu(it2, { x: r.left, y: r.bottom + 4 }); } }
          return;
        }
        if (it) { V.sel = +it.dataset.i; V.redraw(); host.querySelector(".xp-main").focus({ preventScroll: true }); return; }
        if (e.target.closest(".xp-main")) { V.sel = -1; V.self = false; V.redraw(); host.querySelector(".xp-main").focus({ preventScroll: true }); } // 点空白处：什么都不选（预览栏显示这个文件夹）
      });
      host.addEventListener("dblclick", function (e) { var it = e.target.closest("[data-i]"); if (it) open(V.items[+it.dataset.i], e.metaKey); });
      host.addEventListener("input", function (e) { if (e.target.classList.contains("xp-q")) { V.q = e.target.value; V.sel = -1; V.redraw(); } });
      host.addEventListener("contextmenu", function (e) {
        if (!S.menu || e.target.closest("input")) return;
        var el = e.target.closest("[data-i]"), sd = e.target.closest("[data-side]");
        e.preventDefault();
        if (sd) return S.menu(sideMenu(sd), { x: e.clientX, y: e.clientY });
        if (el) { V.sel = +el.dataset.i; V.redraw(); return showItemMenu(V.items[V.sel], { x: e.clientX, y: e.clientY }); }
        var gi = e.target.closest("[data-gi]"), cc = e.target.closest(".xp-crow[data-cin]"); // 画廊下面那排、分栏里的一行：也是这一项的菜单
        if (gi) { V.sel = +gi.dataset.gi; V.redraw(); return showItemMenu(V.items[V.sel], { x: e.clientX, y: e.clientY }); }
        if (cc) {
          var colIts = itemsOf(where(cc.dataset.cin), { arg: cc.dataset.cin }, function () {}) || [], cit = colIts.filter(function (x) { return x.name === cc.dataset.cname; })[0];
          return cit ? showItemMenu(cit, { x: e.clientX, y: e.clientY }) : null;
        }
        if (e.target.closest(".xp-main")) { if (V.sel >= 0) { V.sel = -1; V.redraw(); } S.menu(bgMenu(), { x: e.clientX, y: e.clientY }); } // 同访达：在空白处右键，先取消选中
      });
      var typed = "", typedT = 0;
      host.addEventListener("keydown", function (e) {
        if (e.target.classList.contains("xp-q")) { if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); if (V.sel < 0 && V.items.length) { V.sel = 0; V.redraw(); } host.querySelector(".xp-main").focus(); } return; }
        if (e.target.classList.contains("xp-ren")) return;
        var k = e.key, n = V.items.length, cols = 1, selIt = V.items[V.sel];
        // 同访达：⌘⌫ 移到废纸篓、⌘D 复制、⌃⌘A 制作替身、⌘Z 放回去（刚才移到废纸篓的、改的名）
        if (e.metaKey && !e.ctrlKey && (k === "Backspace" || k === "Delete") && selIt) { e.preventDefault(); e.stopPropagation(); return selIt.vf ? rmVF(selIt) : trashIt(selIt); }
        if (e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && (k === "d" || k === "D") && selIt && selIt.path) { e.preventDefault(); e.stopPropagation(); return duplicate(selIt); }
        if (e.metaKey && e.ctrlKey && (k === "a" || k === "A") && selIt && selIt.path) { e.preventDefault(); e.stopPropagation(); return makeAlias(selIt); }
        if (e.metaKey && !e.shiftKey && (k === "z" || k === "Z") && XV.undo) { e.preventDefault(); e.stopPropagation(); return undo(); }
        if (XV.view === "grid") { var g = host.querySelector(".xp-grid"), f = g && g.firstElementChild; if (f) cols = Math.max(1, Math.round(g.clientWidth / (f.offsetWidth + 6)) || 1); }
        var move = function (d) { e.preventDefault(); if (!n) return; V.sel = V.sel < 0 ? (d > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, V.sel + d)); V.redraw(); var on = host.querySelector(".xp-main .on"); if (on) on.scrollIntoView({ block: "nearest" }); };
        if (k === " ") { e.preventDefault(); if (ql) quickLook(null); else if (V.items[V.sel]) quickLook(V.items[V.sel], V); return; }
        if (k === "Escape" && ql) { e.preventDefault(); quickLook(null); return; }
        if (k === "." && e.metaKey && e.shiftKey) { e.preventDefault(); e.stopPropagation(); return toggleHidden(); }
        if ((k === "h" || k === "H") && e.metaKey && e.shiftKey && LOC()) { e.preventDefault(); e.stopPropagation(); return goTo("~"); }
        if ((k === "c" || k === "C" || k === "ç") && e.metaKey && e.altKey && V.items[V.sel] && V.items[V.sel].path) { e.preventDefault(); return copy(V.items[V.sel].path); }
        if (e.metaKey && !e.shiftKey && (k === "c" || k === "C") && !e.altKey && V.items[V.sel] && V.items[V.sel].path && !V.items[V.sel].cloud) { e.preventDefault(); XV.clip = { path: V.items[V.sel].path }; copy(V.items[V.sel].path); return; }
        if (e.metaKey && (k === "v" || k === "V" || k === "√")) { e.preventDefault(); return paste(e.altKey); }
        if (e.metaKey && e.shiftKey && (k === "n" || k === "N")) { e.preventDefault(); e.stopPropagation(); return newFolder(); }
        if (e.metaKey && (k === "i" || k === "I")) { e.preventDefault(); if (V.sel < 0) V.self = true; XV.pane = true; XV.more = true; localStorage.setItem("st-xp-pane", "1"); localStorage.setItem("st-xp-more", "1"); return redrawAll(); }
        if (e.metaKey && /^[1-4]$/.test(k)) { e.preventDefault(); e.stopPropagation(); XV.view = VIEWS[+k - 1][0]; localStorage.setItem("st-xp-view", XV.view); return redrawAll(); }
        if (XV.view === "columns" && !e.metaKey && !e.altKey && /^Arrow(Up|Down|Left|Right)$/.test(k)) { e.preventDefault(); return colKey(k); }
        if (XV.view === "gallery" && (k === "ArrowRight" || k === "ArrowLeft")) return move(k === "ArrowRight" ? 1 : -1);
        if (k === "ArrowRight") return move(XV.view === "grid" ? 1 : 0);
        if (k === "ArrowLeft") return move(XV.view === "grid" ? -1 : 0);
        if (k === "ArrowDown" && !e.metaKey) return move(cols);
        if (k === "ArrowUp" && !e.metaKey) return move(-cols);
        if ((k === "ArrowDown" && e.metaKey) || k === "Enter") { e.preventDefault(); return open(V.items[V.sel]); }
        if (k === "ArrowUp" && e.metaKey) { e.preventDefault(); return up(); }
        if (k === "[" && e.metaKey && V.back.length) { e.preventDefault(); V.fwd.push(V.arg || ""); V.sel = -1; return V.go(V.back.pop()); }
        if (k === "]" && e.metaKey && V.fwd.length) { e.preventDefault(); V.back.push(V.arg || ""); V.sel = -1; return V.go(V.fwd.pop()); }
        // 打字：跳到这个名字开头的那一项（同访达）
        if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && n) {
          clearTimeout(typedT); typed += k.toLowerCase(); typedT = setTimeout(function () { typed = ""; }, 900);
          var hit = V.items.findIndex(function (x) { return (x.label || x.name).toLowerCase().indexOf(typed) === 0 || x.name.toLowerCase().indexOf(typed) === 0; });
          if (hit >= 0 && XV.view === "columns") { e.preventDefault(); var ch3 = colChain(where(V.arg)); return colPick(ch3[ch3.length - 1], V.items[hit], ch3[ch3.length - 1]); }
          if (hit >= 0) { e.preventDefault(); V.sel = hit; V.redraw(); var on2 = host.querySelector(".xp-main .on"); if (on2) on2.scrollIntoView({ block: "nearest" }); }
        }
      });
    },
    focus: function (host) { var m = host.querySelector(".xp-main"); if (m) m.focus({ preventScroll: true }); },
    detach: function (host, P, arg, V) { if (ql && (!ql.V || ql.V === V)) quickLook(null, null, true); },
  };
  // 快速查看那块上的按钮
  document.addEventListener("click", function (e) {
    if (!ql || !ql.el.contains(e.target)) return;
    var b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "ql-close") quickLook(null);
    if (b.dataset.act === "ql-open") { var main = (ql.V && ql.V.host && ql.V.host.querySelector(".xp-main")) || document.querySelector(".st-pg-explorer .xp-main"); quickLook(null); if (main) main.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); } // 「打开」：打开的是开着快速查看的那一页里选中的
  });
  document.addEventListener("keydown", function (e) { if (ql && (e.key === "Escape" || e.key === " ") && !e.target.closest(".st-pg-explorer")) { e.preventDefault(); quickLook(null); } }, true);
  // 英文（这一页新加的固定的字；带数字、日期的在上面直接按语言写）
  if (window.TSU_I18N && TSU_I18N.add) TSU_I18N.add({ "打开工作目录": "Open Working Directory", "在新标签页中打开": "Open in New Tab", "用默认应用打开": "Open with Default App", "在访达中显示": "Show in Finder", "在访达中打开": "Open in Finder",
    "拷贝路径": "Copy Path", "显示隐藏文件": "Show Hidden Files", "查看方式": "View", "图标": "Icons", "列表": "List", "预览": "Preview", "无法读取这个文件夹": "Can't read this folder", "个人收藏": "Favorites", "位置": "Locations", "所有 Agent": "All Agents" });
})();
