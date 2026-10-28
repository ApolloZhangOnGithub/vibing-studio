// claudeapp.js —— 应用风格「Claude App」（html.st-os-claude）：整个窗口照 Claude 桌面 App（Code）重画，不是给 VS Code 换皮：
//   左边一栏——新建会话、Agent Finder、自定义（设置）、更多；「已固定」「今天」「更早」的会话（就是竖着的标签页：点一下在中间显示）；最下面是账户；
//   标题栏——边栏开关、← →；中间是会话名 ⌄ 和目录，右边开关右侧卡片（终端、后台任务、浏览器）的按钮和 ⋮；
//   中间——对话（这个风格下 Agent 显示风格是 GUI）和输入框；右边——圆角卡片：终端（面板里的终端）、后台任务、浏览器（原生的网页视图）；
//   设置——盖在整个窗口上的一张表单（同 Claude App 的设置）：左边搜索和分区，右边一行一项、控件在右边（开关、下拉、分段）
//   只在 html.st-os-claude 时出现；别的风格下这些元素都藏着，工作台原样不动
(function () {
  "use strict";
  var root = document.documentElement, S = window.STUDIO, N = window.nadosNative;
  if (!S) return;
  var on = function () { return root.classList.contains("st-os-claude"); };
  // 当前的窗口：前面那个；窗口在后台时 front() 可能是空的——就用第一个开着的
  var front = function () { var T = window.TSU_TERM; if (!T) return null; var f = T.front && T.front(); if (f) return f; var ws = T.wins ? T.wins() : []; return ws.filter(function (w) { return w.open; })[0] || ws[0] || null; };
  var Ag = function () { return window.TSU_AGENTS; };
  var en = function () { return !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"); };
  var tr = function (zh, e) { return en() ? e : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var store = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  var keep = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 满了 */ } };
  // 线条 1.5（Retina 上正好 3 个像素）；横竖的线放在 .25 / .75 上，边正好落在像素上——锐利（同官方的图标），不发虚
  var SV = function (b, vb) { return '<svg viewBox="' + (vb || "0 0 16 16") + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + b + "</svg>"; };
  // 线条图标（同 Claude App 的样子）
  var IC = {
    plus: SV('<path d="M7.75 3.25v9M3.25 7.75h9"/>'),
    finder: SV('<rect x="2" y="2" width="5" height="5" rx="1.4"/><rect x="9" y="2" width="5" height="5" rx="1.4"/><rect x="2" y="9" width="5" height="5" rx="1.4"/><path d="M11.5 9.2c.2 1.2.8 1.8 2 2-1.2.2-1.8.8-2 2-.2-1.2-.8-1.8-2-2 1.2-.2 1.8-.8 2-2z"/>'),
    custom: SV('<rect x="2" y="4.2" width="12" height="9" rx="1.6"/><path d="M5.6 4.2V3.2c0-.6.4-1 1-1h2.8c.6 0 1 .4 1 1v1M2 8.2h12"/>'),
    down: SV('<path d="M4.2 6.2L8 10l3.8-3.8"/>'),
    right: SV('<path d="M6.2 4.2L10 8l-3.8 3.8"/>'),
    search: SV('<circle cx="7" cy="7" r="4.4"/><path d="M10.3 10.3L13.6 13.6"/>'),
    funnel: SV('<path d="M2.5 3.5h11L9.2 8.6v3.9l-2.4 1.2V8.6z"/>'), funnelOn: SV('<path d="M2.5 3.5h11L9.2 8.6v3.9l-2.4 1.2V8.6z" fill="currentColor"/>'), // 分段自己的筛选（同 VS Code 风格左边树上的漏斗）：仅显示运行中
    filter: SV('<path d="M4 2.5v11M12 2.5v11M8 2.5v11"/><circle cx="4" cy="10" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="6" r="1.6" fill="currentColor" stroke="none"/><circle cx="8" cy="11.5" r="1.6" fill="currentColor" stroke="none"/>'),
    laptop: SV('<rect x="3" y="3.5" width="10" height="7" rx="1"/><path d="M1.5 12.5h13"/>'),
    term: SV('<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.75"/><path d="M4.75 6.25l1.75 1.5-1.75 1.5M8.25 9.75h3"/>'),
    diff: SV('<rect x="2.4" y="2" width="11.2" height="12" rx="1.8"/><path d="M8 4.6v4M6 6.6h4M6 11h4"/>'),
    globe: SV('<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c1.8 1.8 2.6 3.8 2.6 6s-.8 4.2-2.6 6M8 2C6.2 3.8 5.4 5.8 5.4 8s.8 4.2 2.6 6"/>'),
    more: '<svg viewBox="0 0 16 16"><circle cx="8" cy="3.4" r="1.25" fill="currentColor"/><circle cx="8" cy="8" r="1.25" fill="currentColor"/><circle cx="8" cy="12.6" r="1.25" fill="currentColor"/></svg>',
    expand: SV('<path d="M9.25 2.75h4v4M13.25 2.75L9.5 6.5M6.75 13.25h-4v-4M2.75 13.25L6.5 9.5"/>'),
    collapse: SV('<path d="M13.25 2.75L9.5 6.5M9.25 3v3.75H13M2.75 13.25L6.5 9.5M6.75 13V9.25H3"/>'), // 退出全屏：两个箭头朝里（同 Claude 的 ↙↗）
    close: SV('<path d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5"/>'),
    // 浏览器卡片：版式（叠放 / 加宽）、手机宽度、在默认浏览器中打开、拷贝网址
    layout: SV('<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.8"/><path d="M2.2 8h11.6M10 5.1h1.6M10 10.9h1.6"/>'),
    phone: SV('<rect x="4.6" y="1.8" width="6.8" height="12.4" rx="1.6"/><path d="M7.2 3.9h1.6"/>'),
    extlink: SV('<path d="M9.5 2.5h4v4M13.5 2.5L8 8M12 9.5v3.3c0 .4-.3.7-.7.7H3.2c-.4 0-.7-.3-.7-.7V4.7c0-.4.3-.7.7-.7h3.3"/>'),
    link: SV('<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/>'),
    side: SV('<rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.75"/><path d="M6.25 2.75v10.5"/>'),
    back: SV('<path d="M12.75 7.75H3.25M7 4L3.25 7.75 7 11.5"/>'),
    fwd: SV('<path d="M3.25 7.75h9.5M9 4l3.75 3.75L9 11.5"/>'),
    reload: SV('<path d="M12.5 7.5A4.5 4.5 0 1 1 11 4.3"/><path d="M11.5 2v2.8H8.7"/>'),
    spark: SV('<path d="M8 1.8v12.4M1.8 8h12.4M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8"/>'),
    // 后台任务卡片：一张勾着的清单（以前借了「更改」的 ± 图标）；全局助手：两颗星（✦ 同 Paimon，助手就是它），不是像 Claude 标志的星号
    tasks: SV('<path d="M2.25 4.25l1.25 1.25 2-2.25M2.25 9.25l1.25 1.25 2-2.25M7.75 4.25h6M7.75 9.25h6M7.75 12.75h4"/>'),
    assist: SV('<path d="M7 2.4c.5 3 2 4.6 5 5-3 .5-4.5 2-5 5-.5-3-2-4.5-5-5 3-.4 4.5-2 5-5z"/><path d="M12.6 1.4c.1 1 .6 1.5 1.6 1.6-1 .1-1.5.6-1.6 1.6-.1-1-.6-1.5-1.6-1.6 1-.1 1.5-.6 1.6-1.6z"/>'),
    // 设置：真的齿轮（以前那个是一圈放射线，像太阳）；用量：仪表；连接器：插头；更新内容：一卷纸——一个意思一个图标，整个风格里都用这几个
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    gauge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>',
    plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/></svg>',
    scroll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/></svg>',
    signin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>',
    dash: SV('<rect x="2" y="2" width="5" height="6" rx="1"/><rect x="9" y="2" width="5" height="3.5" rx="1"/><rect x="9" y="7.5" width="5" height="6.5" rx="1"/><rect x="2" y="10" width="5" height="4" rx="1"/>'),
    folder: SV('<path d="M1.75 4.25c0-.55.45-1 1-1h3.1l1.4 1.5h5.99c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1z"/>'),
    keys: SV('<rect x="1.5" y="4" width="13" height="8.4" rx="1.6"/><path d="M4 6.7h.3M6.3 6.7h.3M8.6 6.7h.3M10.9 6.7h.3M4.8 9.6h6.4"/>'),
    pin: SV('<path d="M6 2.5h4l-.6 4 2.1 2H4.5l2.1-2zM8 8.5v5"/>'),
    rename: SV('<path d="M10.8 2.7l2.5 2.5-7.6 7.6H3.2v-2.5z"/>'),
    archive: SV('<rect x="1.8" y="3" width="12.4" height="3" rx=".8"/><path d="M3 6v6.6h10V6M6.4 8.6h3.2"/>'),
    copy: SV('<rect x="5" y="5" width="8.4" height="8.4" rx="1.4"/><path d="M11 5V3.6c0-.6-.4-1-1-1H3.6c-.6 0-1 .4-1 1V10c0 .6.4 1 1 1H5"/>'),
    lang: SV('<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c1.8 1.8 2.6 3.8 2.6 6s-.8 4.2-2.6 6M8 2C6.2 3.8 5.4 5.8 5.4 8s.8 4.2 2.6 6"/>'),
    os: SV('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M1.8 5.6h12.4"/>'),
    out: SV('<path d="M6.5 2.5H3.4c-.5 0-.9.4-.9.9v9.2c0 .5.4.9.9.9h3.1M10.5 5l3 3-3 3M13.2 8H6"/>'),
    help: SV('<circle cx="8" cy="8" r="6"/><path d="M6.4 6.2a1.7 1.7 0 0 1 3.3.5c0 1.2-1.7 1.4-1.7 2.6M8 11.3v.2"/>'),
    ext: SV('<rect x="2" y="6.5" width="4" height="4" rx=".5"/><rect x="2" y="10.5" width="4" height="4" rx=".5"/><rect x="6" y="10.5" width="4" height="4" rx=".5"/><rect x="9" y="2" width="4.6" height="4.6" rx=".5"/>'),
  };
  // Claude 那颗橙色的星（右下角的按钮、在跑的会话）
  var STAR = (window.TSU_LOGOS && TSU_LOGOS.claude) || '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2.2l1.2 6.1 4.6-4.2-2.7 5.6 6.2-.6-5.4 3 5.4 3-6.2-.6 2.7 5.6-4.6-4.2L12 21.8l-1.2-6.1-4.6 4.2 2.7-5.6-6.2.6 5.4-3-5.4-3 6.2.6-2.7-5.6 4.6 4.2z"/></svg>'; // Claude 自己的标志（ext.js 的 TSU_LOGOS）；没有才用原来那颗
  // ---- 连接器（会话在哪儿跑）：每个一个小图标——Claude Code 是 Claude 的星（橙）、Codex 是一个单色的结、Paimon 是派蒙的头像。
  //      边栏每一行前面、分段的标题、标题栏的小标签、新会话的「在哪跑」都用它，一眼看出是谁的会话 ----
  var CONN = {
    cc: { id: "claude-code", name: "Claude Code", glyph: STAR },
    cx: { id: "codex", name: "Codex", glyph: (window.TSU_LOGOS && TSU_LOGOS.codex) || "◎" }, // ChatGPT / OpenAI 的结（ext.js）
    pi: { id: "pi", name: "pi", glyph: (window.TSU_LOGOS && TSU_LOGOS.pi) || "" }, // pi：它自己的标志（ext.js）
    ty: { id: "teyvat", name: "Teyvat", get glyph() { return (window.TSU_LOGOS && TSU_LOGOS.teyvat) || ""; } }, // Teyvat：提瓦特这颗星球的图（ext.js）
    pm: { id: "paimon", name: "Paimon", get glyph() { return (window.TSU_LOGOS && TSU_LOGOS.paimon) || '<img class="pm-av" src="img/paimon.png" alt="" draggable="false">'; } }, // Paimon：派蒙的头像（读进内存的那一份，ext.js）
  };
  var CONN_ORDER = ["cc", "cx", "pi", "ty", "pm"]; // 按连接器分段时的先后
  // 开着没有：Claude Code、Codex 关着时 TSU_CLAUDE / TSU_CODEX 是空的；Paimon 看它的连接器开关；能不能在那儿开新会话
  var connOn = function (k) { return k === "cc" ? !!window.TSU_CLAUDE : k === "cx" ? !!window.TSU_CODEX : k === "pi" ? !!window.TSU_PI : k === "ty" ? !!window.TSU_TEYVAT : k === "pm" ? pmOn() : false; };
  var isConnK = function (k) { return k === "cc" || k === "cx" || k === "pi" || k === "ty"; }; // 连接器的会话（不是 Paimon 的 agent）
  var canNewIn = function (k) { if (k === "pm") return pmOn(); var C = window.TSU_CONNECTORS; return !!(C && C.canNew && CONN[k] && C.canNew(CONN[k].id)); };
  var ico = function (k, cls) { return CONN[k] ? '<span class="ca-ico ca-k-' + k + (cls ? " " + cls : "") + '">' + CONN[k].glyph + "</span>" : ""; }; // span 不是 i：标题栏里的 i 是红黄绿三个灯的样式

  // ---- 状态（这台设备记着）：哪些卡片开着、边栏收没收、搜索 ----
  var CARDS = store("st-claude-cards", { term: false, tasks: false, web: false });
  var MAX = "", Q = "", SEARCH = false, MORE = !!store("st-claude-more", false), SIDEOFF = !!store("st-claude-side-off", false);
  // ← →：中间那一块显示过什么（会话、页面），同浏览器的后退 / 前进。一项 { k, p（那个面板）, kind, id / page, arg }
  var NAV = { list: [], pos: -1, cur: "", lock: 0 };
  // ---- 边栏开没开：用户自己收起来的（SIDEOFF，这台设备记着）。中间是自己带侧栏的页（Agent Finder、File Finder）时自动收起来——只是这一次看的样子、不记；
  //      回到会话就是原来的样子。在这种页上点边栏按钮 / ⌘B：这一次打开（离开这一页就不算了） ----
  var OWN_SIDE = { explorer: 1 }, VISIT = { k: "", open: false };
  var viewKey = function (w) { var p = w && w.ws && w.ws.active, pr = p && p.program; return !pr ? "" : pr.page ? "p:" + pr.page + ":" + (pr.arg == null ? "" : String(pr.arg)) : pr.agentId ? "a:" + pr.agentId : ""; };
  var autoHide = function (w) { var p = w && w.ws && w.ws.active, pr = p && p.program; return !!(pr && pr.page && OWN_SIDE[pr.page]) || tight(w); };
  // 窗口太窄、右边卡片又开着：边栏也自己收起来（卡片那一列至少 280px、对话那一列至少 420px，谁都不被挤扁）；同样只是这一次的样子
  var phone = function (w) { return !!(w && w.el && w.el.clientWidth && w.el.clientWidth < 600); }; // iPhone 那么窄：侧栏平时收着，拉出来时盖在对话上面（claudeapp.css）
  var tight = function (w) { if (phone(w)) return true; if (!w || !w.el || !CARD_IDS.some(cardOn)) return false; var n = CARD_IDS.filter(cardOn).length; return w.el.clientWidth < (SIDEW || 258) + (n >= 3 ? 560 : 280) + 420; };
  var sideHidden = function (w) { return autoHide(w) ? !(VISIT.open && VISIT.k === viewKey(w)) : SIDEOFF; };
  function toggleSide(w) {
    if (!w) return;
    var hid = sideHidden(w);
    if (autoHide(w)) VISIT = { k: viewKey(w), open: hid }; // 这一次打开 / 再收起来
    else { SIDEOFF = !hid; keep("st-claude-side-off", SIDEOFF); }
    if (typeof peekClose === "function") peekClose(true);
    refresh(w, true);
  }
  // 边栏的筛选（右上角那个按钮，同 Claude App）：状态、环境、分组、排序、显示什么——存在设置里（claude* 几项）
  var getK = function (k, d) { var v = S.get ? S.get(k) : undefined; return v === undefined || v === null ? d : v; };
  var setK = function (k, v) { if (S.setv) S.setv(k, v); };
  var statusOf = function () { var v = getK("claudeStatus", "active"); return ["active", "running", "archived", "all"].indexOf(v) >= 0 ? v : "active"; };
  var envSel = function () { var v = getK("claudeEnv", []); return Array.isArray(v) ? v.filter(function (k) { return envKeys().indexOf(k) >= 0; }) : []; };
  // 分组（claudeGroupBy）：按连接器（默认：Claude Code、Codex、Paimon 各一段）、日期、状态、文件夹、不分组。以前的 claudeGroupByDate 不再看
  var GROUP_KEYS = ["connector", "date", "status", "group", "none"];
  var groupOf = function () { var v = getK("claudeGroupBy", "connector"); return GROUP_KEYS.indexOf(v) >= 0 ? v : "connector"; };
  // 未读（会话菜单「标为未读」；在后台跑完、没在看的也算）：切到它就是已读；这台设备记着
  var UNREAD = store("st-claude-unread", {}), PREVST = {}, lastCur = null;
  // Claude Code、Codex 的会话在这个边栏里的固定 / 改名 / 归档：只记在这台设备上（{ pin, name, arch }，键 = cc:id / cx:id），不改它们自己的会话文件
  var EXTS = store("st-claude-ext", {}); EXTS.pin = EXTS.pin || {}; EXTS.name = EXTS.name || {}; EXTS.arch = EXTS.arch || {};
  var saveExt = function () { keep("st-claude-ext", EXTS); };
  // VS Code 风格那棵树（live.js）也改这两份（固定、改名、归档、分组、未读）：用之前重新读一遍，免得拿这边早先读的旧的把那边改的盖掉
  var reloadExt = function () { var e = store("st-claude-ext", {}); e.pin = e.pin || {}; e.name = e.name || {}; e.arch = e.arch || {}; EXTS = e; UNREAD = store("st-claude-unread", {}); };
  var keyOf = function (kind, id) { return isConnK(kind) ? kind + ":" + id : String(id); };
  // 拆分视图（会话菜单「打开位置 › 拆分视图」）：并排两组；记着开没开（刷新后接着并排）
  var SPLITON = !!store("st-claude-split", false);
  // 分组 = agent 的文件夹（会话菜单「移到文件夹」）：同 Agent Finder、VS Code 那棵树里的文件夹，记在账号的索引里（agent.path）；分组方式选「文件夹」时边栏按它们分段；
  // 一个会话都没有的文件夹这里不显示。以前设置里记的分组（claudeGroupOf）第一次看到时搬进同名文件夹——只改索引，不动设置
  var legacyGroups = function () { var v = getK("claudeGroupOf", {}); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; };
  var movedG = {};
  var groupMap = function () {
    var A = Ag(), m = {}, old = legacyGroups();
    if (!A || !A.move) return old;
    A.list().concat(A.archived ? A.archived() : []).forEach(function (a) {
      if (!a.path && old[a.id] && !movedG[a.id]) { movedG[a.id] = 1; A.move(a.id, old[a.id]); }
      if (a.path) m[a.id] = a.path;
    });
    return m;
  };
  function groupNames() {
    var m = groupMap(), used = {}, order = getK("claudeGroupOrder", []), out;
    Object.keys(m).forEach(function (k) { used[m[k]] = 1; });
    out = (Array.isArray(order) ? order : []).filter(function (n) { return used[n]; });
    Object.keys(used).sort().forEach(function (n) { if (out.indexOf(n) < 0) out.push(n); });
    return out;
  }
  function setGroup(id, name, quiet) {
    var A = Ag(), a = A && A.get(id), old = legacyGroups();
    if (a && A.move) { if (!a.deleted) A.move(id, name || ""); } // 挪进文件夹（null：回到卷的最外层）
    if (old[id]) { var m = Object.assign({}, old); delete m[id]; movedG[id] = 1; setK("claudeGroupOf", m); } // 设置里老的那条不要了（不然移出后下次又被搬回去）
    if (name && !quiet && groupOf() !== "group") setK("claudeGroupBy", "group"); // 挪进了文件夹：边栏按文件夹显示（不然看不出挪到哪了）
  }
  var sortOf = function () { var v = getK("claudeSort", "activity"); return ["activity", "created", "name"].indexOf(v) >= 0 ? v : "activity"; };
  // 环境：这里 / 其他设备（Paimon Code 的，连接器关了就没有）、Claude Code、Codex
  var pmOn0 = function () { return !window.TSU_CONNECTORS || TSU_CONNECTORS.on("paimon"); };
  // 边栏里不再列 Paimon Code 的 agent（同 Agents 树、Agent Finder：Paimon 是内置的助手）；localStorage st-pm-vols = "1" 时照旧列
  var pmOn = function () { return localStorage.getItem("st-pm-vols") === "1" && pmOn0(); };
  var envKeys = function () { return ["here", "other", "cc", "cx", "pi", "ty"].filter(function (k) { return pmOn() || isConnK(k); }); };
  var cardsMode = function () { return S.get ? S.get("claudeCards") || "auto" : "auto"; };
  var filesOK = function () { return !!(S.viewDef && S.viewDef("files")); }; // 文件卡片：这台 Mac 上才有（files.js 的文件树）
  var globalOK = function () { return !!window.TSU_GLOBAL; }; // 全局助手卡片（globalagent.js）
  var cardOn = function (k) { if (k === "files" && !filesOK()) return false; if (k === "global" && !globalOK()) return false; var m = cardsMode(); return m === "always" ? true : m === "never" ? false : !!CARDS[k]; };

  // ---- 建：边栏（主行里、工作台左边）、标题栏里的三块、网格里的浏览器卡片；工作台还没建好（.st-row0 没有）就下次再来 ----
  function build(w) {
    if (!w || !w.el) return null;
    var row0 = w.el.querySelector(".st-row0"), lab = w.el.querySelector(".tlab"), bar = w.el.querySelector(".bar");
    if (w.ca && w.ca.side.isConnected && w.ca.web.isConnected) return w.ca;
    if (!row0 || !lab || !bar || !lab.classList.contains("st-grid")) return null;
    var mk = function (tag, cls, parent, before) { var e = document.createElement(tag); e.className = cls; if (before) parent.insertBefore(e, before); else parent.appendChild(e); return e; };
    var side = mk("aside", "ca-side", row0, lab);
    side.innerHTML = '<div class="ca-top"></div><div class="ca-find" hidden><input class="ca-q" type="text" spellcheck="false" autocomplete="off"></div><div class="ca-list" tabindex="-1"></div><div class="ca-acct"></div>';
    var nav = mk("div", "ca-nav", bar), ttl = mk("div", "ca-ttl", bar), acts = mk("div", "ca-acts", bar);
    // 这几组里只有按钮本身不能拖窗口（dragfill：native.js 只把里面的按钮、标签算成不能拖）——按钮之间、标题右边的空白照样能拖窗口
    [nav, ttl, acts].forEach(function (x) { x.dataset.dragfill = ""; ["pointerdown", "dblclick"].forEach(function (t) { x.addEventListener(t, function (e) { if (e.target.closest("button, input, a, .ca-chip, [data-nodrag]")) e.stopPropagation(); }); }); });
    var web = mk("section", "ca-web", lab);
    // 浏览器卡片（同 Claude 的浏览器）：标题行——标签页、+；右边 版式 ⋮ ⤢ ✕。下面——← → ⟳、网址框、手机宽度，底边一条加载进度；内容区里 .ca-webvp 是网页那一块
    web.innerHTML = '<div class="ca-cardh ca-webh"><div class="ca-tabs" role="tablist"></div><button class="ca-ib ca-hplus" data-w="new">' + IC.plus + '</button><span class="ca-fill"></span>' +
      '<button class="ca-ib ca-tog" data-w="wide">' + IC.layout + '</button><button class="ca-ib" data-w="more">' + IC.more + '</button><button class="ca-ib" data-w="max">' + IC.expand + '</button><button class="ca-ib" data-w="close">' + IC.close + "</button></div>" +
      '<div class="ca-webnav"><button class="ca-ib" data-w="back">' + IC.back + '</button><button class="ca-ib" data-w="fwd">' + IC.fwd + '</button><button class="ca-ib" data-w="reload">' + IC.reload + "</button>" +
      '<input class="ca-url" type="text" spellcheck="false" autocomplete="off"><button class="ca-ib ca-tog" data-w="device">' + IC.phone + '</button><span class="ca-webload"></span></div>' +
      '<div class="ca-webbody"><div class="ca-webvp"></div><div class="ca-webempty" hidden></div></div>';
    w.ca = { side: side, nav: nav, ttl: ttl, acts: acts, web: web, sig: {} };
    wire(w);
    return w.ca;
  }

  // ======== 左边一栏 ========
  // 每个去处只有一个入口（不重复）：新建会话在这里；「更多」里是 Agent Finder 和「App」里的那些（访达、终端、浏览器、设备、活动监视器……，STUDIO.apps 登记的）；
  //   File Finder 在标题栏右边 ···；仪表盘没有入口（只有打网址 dash.local.paimon）；
  // 设置、应用风格、语言、扩展、键盘快捷方式、登录 / 退出在左下角账户的菜单里（菜单栏里照样有命令）
  // ---- 「有新版本」卡片（新建上面，同 Claude App）：服务器上的页面换了（STUDIO.updateReady）才有；左边一幅手绘的小画，
  //      「有新版本」、灰字是新版本什么时候发的；点它重新载入就用上；「更新内容」打开更新记录；× 这个版本不再提（记住它的 id） ----
  var UPD = { id: "", at: "", asked: false }, UPD_ART = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M5.5 41.5c4.2-.4 8.9-2.4 13-6.3 3.6-3.4 6.3-8 8.1-13.2" stroke-width="1.5" stroke-dasharray=".1 3.6"/>' + // 一路上去的虚线（手画的轨迹）
    '<path d="M30.9 7.6c.9 4.7 3.1 7 7.8 7.9-4.7.9-6.9 3.2-7.8 7.9-.9-4.7-3.1-7-7.8-7.9 4.7-.9 6.9-3.2 7.8-7.9z" stroke-width="1.45" fill="currentColor" fill-opacity=".14"/>' + // 大的那颗星
    '<path d="M14.2 12.3c.35 1.9 1.2 2.75 3.1 3.1-1.9.35-2.75 1.2-3.1 3.1-.35-1.9-1.2-2.75-3.1-3.1 1.9-.35 2.75-1.2 3.1-3.1z" stroke-width="1.2"/>' + // 小的那颗
    '<path d="M40.5 29.2c.2.1.35.25.45.45" stroke-width="1.6"/><circle cx="21.5" cy="25.5" r=".9" fill="currentColor" stroke="none"/><path d="M36.8 36.5c1.6-.6 3-1.7 4-3.2" stroke-width="1.2"/></svg>';
  var updOn = function () { return !!(S.updateReady && S.updateReady()); };
  function updInfo(w) {
    if (UPD.asked) return;
    UPD.asked = true;
    fetch("/api/version", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j) { UPD.id = String(j.id || ""); UPD.at = String(j.at || ""); refresh(w, true); } }, function () {});
  }
  function updCard(w) {
    if (!updOn()) return "";
    updInfo(w);
    if (store("st-claude-upd-x", "") === (UPD.id || "any")) return ""; // 这个版本说过不要提了
    var d = UPD.at ? new Date(UPD.at) : null, when = "";
    if (d && !isNaN(d)) { var t0 = today0(), hm = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); when = d.getTime() >= t0 ? tr("今天 ", "Today ") + hm : (d.getMonth() + 1) + "/" + d.getDate() + " " + hm; }
    var sub = [when, UPD.id ? UPD.id.slice(0, 7) : ""].filter(Boolean).join(" · ") || tr("重新载入就用上", "Reload to update");
    return '<div class="ca-upd" data-upd="go" role="button" title="' + esc(tr("重新载入，用上新版本", "Reload to use the new version")) + '"><span class="ca-upd-art">' + UPD_ART + "</span>" +
      '<span class="ca-upd-tx"><b>' + esc(tr("有新版本", "Update available")) + '</b><span class="ca-upd-sub"><span>' + esc(sub) + "</span>" + (window.TSU_CHANGELOG ? '<span class="ca-upd-dot">·</span><a class="ca-upd-log" data-upd="log">' + esc(tr("更新内容", "What's new")) + "</a>" : "") + "</span></span>" +
      '<button class="ca-upd-x" data-upd="x" title="' + esc(tr("这个版本先不提醒", "Dismiss for this version")) + '">' + IC.close + "</button></div>";
  }
  document.addEventListener("st-update-ready", function () { refresh(null); });
  function paintTop(w) {
    var p = w.ws && w.ws.active, pr = p && p.program, inFinder = !!(pr && pr.page === "explorer" && pr.arg === "agents");
    // 「更多」：收着是 ⌄ 更多，展开了是 ⌃ 收起（箭头转过去、下面那一段滑出来；元素不重建，动画才看得见）
    // 「App」里的（同 VS Code 风格活动栏上「App」那一块）：这台设备上用得了的；开着的那一页在前面时亮
    var apps = S.apps && S.apps.list ? S.apps.list().filter(function (a) { return !a.ok || a.ok(); }) : [], act = w.ws && w.ws.active;
    var appIt = function (a) {
      var nm = typeof a.name === "function" ? a.name() : a.name, lg = typeof a.logo === "function" ? a.logo() : a.logo || "", on = !!(act && a.find && a.find(w) === act && !inFinder);
      return '<div class="ca-nav-it ca-sub ca-app' + (on ? " on" : "") + '" data-app="' + esc(a.id) + '" role="button"><i>' + lg + "</i><span>" + esc(nm) + "</span></div>";
    };
    var h = updCard(w) + '<div class="ca-nav-it" data-go="new"><i>' + IC.plus + "</i><span>" + tr("新建", "New") + "</span></div>" +
      '<div class="ca-nav-it ca-more" data-go="more" role="button"><i class="ca-disc">' + IC.down + '</i><span class="ca-more-l"></span></div>' +
      '<div class="ca-subs"><div class="ca-subs-in"><div class="ca-nav-it ca-sub" data-go="finder"><i>' + IC.finder + "</i><span>Agent Finder</span></div>" + apps.map(appIt).join("") + "</div></div>";
    var top = w.ca.side.querySelector(".ca-top");
    if (top.dataset.h !== h) { top.dataset.h = h; top.innerHTML = h; }
    var mo = top.querySelector(".ca-more"), lab = MORE ? tr("收起", "Less") : tr("更多", "More");
    mo.classList.toggle("open", MORE);
    mo.setAttribute("aria-expanded", MORE ? "true" : "false");
    if (mo.lastChild.textContent !== lab) mo.lastChild.textContent = lab;
    top.querySelector(".ca-subs").classList.toggle("open", MORE);
    top.querySelector('[data-go="finder"]').classList.toggle("on", inFinder);
  }
  var today0 = function () { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  // 会话在哪儿跑（筛选、分组的「环境」）：这里（本机 Mac / 云端沙盒 / 浏览器沙盒——看这个 App 接的是哪个）、别的设备上（租约在别的设备）、Claude Code
  function envLabel(k) {
    var A = Ag();
    if (k === "here") return A && A.local && A.local() ? tr("本机 Mac", "This Mac") : A && A.remote && A.remote() ? tr("云端沙盒", "Cloud Sandbox") : tr("浏览器沙盒", "Browser Sandbox");
    if (k === "other") return tr("其他设备", "Other Devices");
    return k === "cx" ? "Codex" : k === "pi" ? "pi" : k === "ty" ? "Teyvat" : "Claude Code";
  }
  function sessions(w, archived) {
    var A = Ag(), out = [];
    if (!A) return out;
    var add = function (a, arch) {
      var rt = null; if (!arch) { try { rt = A.runtime(a.id); } catch (e) { rt = null; } } // 归档的不去建运行时（不叫醒它）
      var el = !arch && A.elsewhere ? A.elsewhere(a.id) : null;
      out.push({ kind: "pm", id: a.id, name: a.name, pinned: !!a.pinned && !arch, arch: !!arch, t: a.active || a.created || 0, c: a.created || a.active || 0, state: rt && rt.state ? rt.state() || "idle" : "idle", env: el ? "other" : "here", dev: el && el.device || "" });
    };
    if (pmOn()) A.list().forEach(function (a) { add(a, false); }); // Paimon Code 连接器关了：边栏里没有它的会话
    if (archived && A.archived && pmOn()) A.archived().forEach(function (a) { add(a, true); });
    // 开着的 Claude Code、Codex 会话（这个窗口里有它的标签页）：它的运行时已经起来了，状态照它的（在这里说的话它正在答）；没开着的不去建运行时
    var openSt = {};
    if (w.ws && w.ws.all) w.ws.all().forEach(function (p) { var ag = p.program && p.program.agentId; if (ag && /^(c[cx]|pi|ty):/.test(ag)) { try { var r0 = A.runtime(String(ag)); if (r0 && r0.state) openSt[String(ag)] = r0.state(); } catch (e) { /* 还没起来 */ } } });
    var stNow = function (aid, busy) { return openSt[aid] === "working" || busy ? "working" : openSt[aid] === "waiting" ? "waiting" : "idle"; };
    // Claude Code 的会话（连接器开着才有）：边栏树里那一份；live = 在别的终端里开着（busy：正在干活）
    var cc = Q.trim() && w.side && w.side.ccSearchList ? w.side.ccSearchList() : ccList(w); // 搜的时候：这台 Mac 上全部的会话（平时只有最近 40 个）
    cc.forEach(function (x) { var k0 = "cc:" + x.id; if (EXTS.arch[k0] && !archived) return; var t = +new Date(x.mtime || x.updated || x.t || 0) || 0; out.push({ kind: "cc", id: x.id, name: EXTS.name[k0] || x.title || x.id, dim: !EXTS.name[k0] && !!x.dimTitle, pinned: !!EXTS.pin[k0], arch: !!EXTS.arch[k0], t: t, c: +new Date(x.created || x.ctime || 0) || t, state: stNow("cc:" + x.id, x.live && x.live.status === "busy"), live: !!x.live, cwd: x.cwd || "", job: x.job || "", env: "cc" }); });
    // Codex 的会话（连接器开着才有，codex.js）：最近的 60 个（搜的时候全部）；归档的只在看「已归档」时列
    var CX = window.TSU_CODEX;
    if (CX) CX.list().filter(function (x) { return archived || !(x.archived || EXTS.arch["cx:" + x.id]); }).slice(0, Q.trim() ? Infinity : 60).forEach(function (x) { var k1 = "cx:" + x.id; out.push({ kind: "cx", id: x.id, name: EXTS.name[k1] || x.title || x.id, dim: !EXTS.name[k1] && !!x.dimTitle, pinned: !!EXTS.pin[k1], arch: !!(x.archived || EXTS.arch[k1]), t: x.mtime || 0, c: x.mtime || 0, state: stNow("cx:" + x.id, x.live && x.live.status === "busy"), cwd: x.cwd || "", env: "cx" }); });
    // pi 的会话（连接器开着才有，pi.js）：同 Codex——最近的 60 个（搜的时候全部）；名字是 pi 自己的（改名写进它的记录）
    var PI = window.TSU_PI;
    if (PI) PI.list().filter(function (x) { return archived || !EXTS.arch["pi:" + x.id]; }).slice(0, Q.trim() ? Infinity : 60).forEach(function (x) { var k2 = "pi:" + x.id; out.push({ kind: "pi", id: x.id, name: x.title || x.id, dim: !!x.dimTitle, pinned: !!EXTS.pin[k2], arch: !!EXTS.arch[k2], t: x.mtime || 0, c: x.mtime || 0, state: stNow(k2, x.live && x.live.status === "busy"), live: !!x.live, cwd: x.cwd || "", env: "pi" }); });
    // Teyvat 的 agent（连接器开着才有，teyvat.js）：没归档的都列；在做什么照它自己的状态（工作中 = working，等待 / 休眠 = waiting）
    var TY = window.TSU_TEYVAT;
    if (TY) TY.list().filter(function (x) { return archived || !EXTS.arch["ty:" + x.id]; }).forEach(function (x) { var k3 = "ty:" + x.id; out.push({ kind: "ty", id: x.id, name: x.name || x.id, pinned: !!EXTS.pin[k3], arch: !!EXTS.arch[k3], t: x.mtime || 0, c: x.created || x.mtime || 0, state: x.state === "working" ? "working" : x.state === "waiting" || x.state === "hibernating" ? "waiting" : "idle", env: "ty" }); });
    return out;
  }
  // Claude Code 的会话列表（live.js 的侧栏读好的那一份：S.cc() 返回 { list, panes }）；连接器关着是空的
  function ccList(w) { var s = window.TSU_CLAUDE && w && w.side && w.side.cc, cc = s && (typeof s === "function" ? s() : s); return cc && Array.isArray(cc.list) ? cc.list : []; }
  // 一段会话在哪个目录（Claude Code、Codex 的；Paimon 的 agent 没有工作目录）
  function dirOfSess(w, k, sid) {
    var x = k === "cc" ? ccList(w).filter(function (y) { return y.id === sid; })[0] : k === "cx" && window.TSU_CODEX ? TSU_CODEX.get(sid) : k === "pi" && window.TSU_PI ? TSU_PI.get(sid) : null;
    if (x && x.cwd) return x.cwd;
    try { var A = Ag(), rt = A && A.runtime(k + ":" + sid); return rt && rt.home ? String(rt.home() || "") : ""; } catch (e) { return ""; }
  }
  function activeAgent(w) { var p = w.ws && w.ws.active, pr = p && p.program; return pr && pr.agentId ? String(pr.agentId) : ""; }
  // 多久以前（「显示时间」开着时每行右边那一段）
  function ago(t) {
    if (!t) return "";
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return tr("刚刚", "now");
    if (s < 3600) return Math.floor(s / 60) + tr("分钟", "m");
    if (s < 86400) return Math.floor(s / 3600) + tr("小时", "h");
    if (s < 7 * 86400) return Math.floor(s / 86400) + tr("天", "d");
    var d = new Date(t); return (d.getMonth() + 1) + "/" + d.getDate();
  }
  // 一行的状态（图标右下角那个小点）：在跑（橙、一闪一闪，图标慢慢转）> 等着你（琥珀）> 未读（蓝）> 在别的设备上跑（蓝圈）> Claude Code 在别的终端里开着（灰）
  var stOf = function (x, un) { return x.state === "working" ? "working" : x.state === "waiting" ? "waiting" : un ? "unread" : x.env === "other" ? "remote" : x.live ? "live" : ""; };
  var ST_TIP = { working: ["正在运行", "Running"], waiting: ["等着你", "Waiting for you"], unread: ["未读", "Unread"], live: ["在别的终端里开着", "Open in another terminal"] };
  var tildeOf = function (p) { var h = homeDir(); p = String(p || ""); return h && (p === h || p.indexOf(h + "/") === 0) ? "~" + p.slice(h.length) : p; };
  // 同名的 Claude Code 会话：名字后面淡淡地带短 id（TSU_CLAUDE.dupTag）
  var dupOf = function (x) { return x && x.kind === "cc" && window.TSU_CLAUDE && TSU_CLAUDE.dupTag ? TSU_CLAUDE.dupTag(x.id, x.name) : ""; };
  function row(x, cur) {
    var dots = getK("claudeDots", true) !== false, when = getK("claudeTime", false) === true, un = !!UNREAD[keyOf(x.kind, x.id)], s = dots ? stOf(x, un) : "";
    // 提示：名字；哪个连接器（Claude Code、Codex 还有目录）；状态
    var tip = x.name + "\n" + (CONN[x.kind] ? CONN[x.kind].name : "") + (x.cwd ? " · " + tildeOf(x.cwd) : "") + (x.dev ? " · " + tr("正在 ", "running on ") + x.dev + tr(" 上运行", "") : "") +
      (x.arch ? " · " + tr("已归档", "Archived") : "") + (ST_TIP[s] ? " · " + tr(ST_TIP[s][0], ST_TIP[s][1]) : un && s !== "unread" ? " · " + tr("未读", "Unread") : "");
    // 前面是连接器的小图标（状态是它右下角的小点）；右边：多久以前（开着「显示时间」）；指着这一行时换成 ⋮（会话菜单）
    return '<div class="ca-it' + (cur ? " on" : "") + (x.arch ? " arch" : "") + (x.dim ? " dimt" : "") /* 没有像样标题的：目录名 + 时间，淡的 */ + (un ? " unread" : "") + '" data-id="' + esc(x.id) + '" data-kind="' + x.kind + '" title="' + esc(tip) + '">' +
      '<i class="ca-ico ca-k-' + x.kind + (s ? " s-" + s : "") + '">' + (CONN[x.kind] ? CONN[x.kind].glyph : "") + (s ? '<b class="ca-bdg"></b>' : "") + "</i>" +
      '<span class="ca-name">' + esc(x.name) + (dupOf(x) ? ' <small class="ttag">' + esc(dupOf(x)) + "</small>" : "") + "</span>" + (when ? '<span class="ca-when">' + esc(ago(x.t)) + "</span>" : "") + '<button class="ca-rowmore" data-rm="1" title="' + esc(tr("更多", "More")) + '">' + IC.more + "</button></div>";
  }
  // 状态分组的几段（顺序）；排序
  var ST_GROUPS = [["working", "运行中", "Running"], ["waiting", "等待中", "Waiting"], ["idle", "空闲", "Idle"], ["arch", "已归档", "Archived"]];
  var stKey = function (x) { return x.arch ? "arch" : x.state === "working" || x.state === "waiting" ? x.state : "idle"; };
  function sorted(list) {
    var so = sortOf();
    return list.slice().sort(so === "name" ? function (a, b) { return String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: "base" }); }
      : so === "created" ? function (a, b) { return (b.c || 0) - (a.c || 0); } : function (a, b) { return (b.t || 0) - (a.t || 0); });
  }
  // 筛出来的会话 → 一段一段（{ key, label, items, conn? }）：固定的在最上面，其余按分组方式；按连接器分时一个连接器一段（关着的没有）
  function sectionsOf(w) {
    var st = statusOf(), env = envSel(), q = Q.trim().toLowerCase(), g = groupOf();
    var all = sessions(w, st === "archived" || st === "all");
    var items = all.filter(function (x) {
      if (q && String(x.name).toLowerCase().indexOf(q) < 0) return false;
      if (st === "active" && x.arch) return false;
      if (st === "running" && (x.arch || x.state === "idle")) return false;
      if (st === "archived" && !x.arch) return false;
      return !env.length || env.indexOf(x.env) >= 0;
    });
    var pinned = sorted(items.filter(function (x) { return x.pinned; })), rest = sorted(items.filter(function (x) { return !x.pinned; })), out = [];
    if (pinned.length) out.push({ key: "pin", label: tr("已固定", "Pinned"), items: pinned, pin: true });
    if (g === "connector") CONN_ORDER.forEach(function (k) { if (connOn(k)) out.push({ key: "c:" + k, conn: k, label: CONN[k].name, items: rest.filter(function (x) { return x.kind === k; }) }); });
    else if (g === "date") { var t0 = today0(); out.push({ key: "d:today", label: tr("今天", "Today"), items: rest.filter(function (x) { return x.t >= t0; }) }, { key: "d:older", label: tr("更早", "Older"), items: rest.filter(function (x) { return x.t < t0; }) }); }
    else if (g === "status") ST_GROUPS.forEach(function (s) { out.push({ key: "s:" + s[0], label: tr(s[1], s[2]), items: rest.filter(function (x) { return stKey(x) === s[0]; }) }); });
    else if (g === "group") {
      var gm = groupMap();
      groupNames().forEach(function (n) { out.push({ key: "g:" + n, label: n.split("/").join(" / "), items: rest.filter(function (x) { return x.kind === "pm" && gm[x.id] === n; }) }); });
      out.push({ key: "g:", label: tr("不在文件夹里", "Not in a folder"), items: rest.filter(function (x) { return x.kind !== "pm" || !gm[x.id]; }) });
    }
    else out.push({ key: "all", label: tr("会话", "Sessions"), items: rest });
    return { secs: out, total: items.length, all: all, filtered: !!(q || st !== "active" || env.length) };
  }
  // 每一段收没收起来、「全部显示」开没开（这台设备记着）。一段超过 MAXN + 2 行时只列前 MAXN 行（在跑的、等着你的、没读的、正看着的总在），下面一行「还有 N 个」——
  // 三个连接器的段一屏看得全
  var SECS = store("st-claude-secs", {}), MAXN = 5;
  var secSt = function (k) { return SECS[k] || {}; };
  function setSec(k, o) { SECS[k] = Object.assign({}, SECS[k] || {}, o); keep("st-claude-secs", SECS); }
  function paintList(w) {
    var cur = activeAgent(w), R = sectionsOf(w), st = statusOf(), env = envSel(), changed = false;
    // 未读：切到它就是已读；刚才还在跑、现在停了、又不是正看着的——在后台跑完了，记成未读（同 Claude App 的小蓝点）
    if (cur !== lastCur) { lastCur = cur; if (cur && UNREAD[cur]) { delete UNREAD[cur]; changed = true; } }
    R.all.forEach(function (x) { var k = keyOf(x.kind, x.id); if (PREVST[k] === "working" && x.state !== "working" && k !== cur && !UNREAD[k]) { UNREAD[k] = 1; changed = true; } PREVST[k] = x.state; });
    if (changed) keep("st-claude-unread", UNREAD);
    var curId = function (x) { return isConnK(x.kind) ? x.kind + ":" + x.id === cur : x.id === cur; };
    // 列表的标题行（在列表上面、不跟着滚）：「会话」和搜索、筛选——分段的标题上不再放按钮（按钮不会跟着第一段跳来跳去）
    var side = w.ca.side, lhe = side.querySelector(".ca-lhead");
    if (!lhe) { lhe = document.createElement("div"); lhe.className = "ca-lhead"; side.insertBefore(lhe, side.querySelector(".ca-find")); }
    var lh = '<span class="ca-lht">' + esc(tr("会话", "Sessions")) + '</span><span class="ca-fill"></span><button class="ca-ib' + (SEARCH ? " on" : "") + '" data-l="search" title="' + esc(tr("搜索", "Search")) + '">' + IC.search + "</button>" +
      '<button class="ca-ib' + (st !== "active" || env.length ? " on" : "") + '" data-l="filter" title="' + esc(tr("筛选、分组和排序", "Filter, group and sort")) + '">' + IC.filter + "</button>";
    if (lhe.dataset.h !== lh) { lhe.dataset.h = lh; lhe.innerHTML = lh; }
    // 每一段：标题（箭头、名字、几个；连接器的段指着时右边一个 +：在它那儿开新会话）、会话、「还有 N 个」；空的段不画
    var searching = !!Q.trim(), h = "";
    R.secs.filter(function (s) { return s.items.length; }).forEach(function (s) {
      // 这一段的漏斗开着（同 VS Code 风格左边树）：只列在跑、等着你、有新消息的（正看着的那个也留着）
      var only = !!(s.conn && secSt(s.key).only), its = only ? s.items.filter(function (x) { return x.state !== "idle" || curId(x) || UNREAD[keyOf(x.kind, x.id)]; }) : s.items;
      var shown = its, hid = 0, full = searching || !!secSt(s.key).all, long = its.length > MAXN + 2;
      var head = long ? its.filter(function (x, i) { return i < MAXN || curId(x) || x.state !== "idle" || UNREAD[keyOf(x.kind, x.id)]; }) : its; // 收着时露出来的那几行
      var rest = long && full && !searching ? its.filter(function (x) { return head.indexOf(x) < 0; }) : []; // 展开后多出来的：画在「收起」下面（按钮不挪位置，同 Show more 原地变 Show less）
      if (!full && long) { shown = head; hid = its.length - shown.length; } else if (rest.length) shown = head;
      var nm = s.conn ? CONN[s.conn].name : "", add = s.conn && canNewIn(s.conn) ? '<button class="ca-ib ca-shadd" data-new="' + s.conn + '" title="' + esc(tr("新建 " + nm + " 会话", "New " + nm + " session")) + '">' + IC.plus + "</button>" : "";
      if (s.conn) add = '<button class="ca-ib ca-shflt' + (only ? " on" : "") + '" data-only="' + esc(s.key) + '" title="' + esc(only ? tr("显示全部", "Show all") : tr("仅显示运行中", "Show running only")) + '">' + (only ? IC.funnelOn : IC.funnel) + "</button>" + add;
      h += '<div class="ca-sec' + (s.conn ? " ca-csec" : "") + '" data-key="' + esc(s.key) + '"><div class="ca-sh ca-shx" data-fold="' + esc(s.key) + '" role="button" tabindex="0"><i class="ca-fchev">' + IC.down + "</i>" +
        '<span class="ca-shl">' + esc(s.label) + '</span><span class="ca-cnt">' + (only ? its.length + " / " + s.items.length : its.length) + '</span><span class="ca-fill"></span>' + add + "</div>" +
        '<div class="ca-sbody"><div class="ca-sbody-in">' + shown.map(function (x) { return row(x, curId(x)); }).join("") +
        (hid ? '<div class="ca-smore" data-more="' + esc(s.key) + '" role="button">' + esc(tr("另外 " + hid + " 个", "Show " + hid + " more")) + "</div>"
          : !searching && long ? '<div class="ca-smore" data-more="' + esc(s.key) + '" role="button">' + esc(tr("收起", "Show less")) + "</div>" : "") +
        rest.map(function (x) { return row(x, curId(x)); }).join("") + "</div></div></div>";
    });
    if (!R.total) h += '<div class="ca-none">' + esc(R.filtered ? tr("没有匹配的会话", "No matching sessions") : tr("还没有会话", "No sessions yet")) + "</div>";
    var list = side.querySelector(".ca-list");
    if (list.dataset.h !== h) { list.dataset.h = h; list.innerHTML = h; }
    // 收起来的段：元素不重建，只换 class——箭头转过去、下面那一段滑上去（看得见动画）；搜的时候都展开
    list.querySelectorAll(".ca-sec[data-key]").forEach(function (sec) {
      var f = !searching && !!secSt(sec.dataset.key).fold;
      if (sec.classList.contains("folded") !== f) sec.classList.toggle("folded", f);
      var hd = sec.firstElementChild; if (hd && hd.getAttribute("aria-expanded") !== String(!f)) hd.setAttribute("aria-expanded", String(!f));
    });
  }
  // ---- 筛选按钮的菜单（同 Claude App）：状态 ›、环境 ›（多选）、分组方式 ›、排序方式 ›、显示状态 / 时间；每项右边灰字是现在的 ----
  function filterMenu(w, el) {
    var ST = [["active", "进行中", "Active"], ["running", "正在运行", "Running"], ["archived", "已归档", "Archived"], ["all", "全部", "All"]];
    var GB = [["connector", "连接器", "Connector"], ["date", "日期", "Date"], ["status", "状态", "Status"], ["group", "文件夹", "Folder"], ["none", "不分组", "None"]];
    var SO = [["activity", "最近活动", "Last activity"], ["created", "创建时间", "Created"], ["name", "名称", "Name"]];
    var nameIn = function (L, v) { var x = L.filter(function (y) { return y[0] === v; })[0]; return x ? tr(x[1], x[2]) : ""; };
    var done = function () { refresh(w, true); };
    var radios = function (L, cur, fn) { return L.map(function (x) { return { label: tr(x[1], x[2]), radio: true, close: true, checked: cur === x[0], run: function () { fn(x[0]); done(); } }; }); };
    var envItems = function () {
      var sel = envSel();
      return [{ label: tr("所有环境", "All environments"), box: true, checked: !sel.length, run: function () { setK("claudeEnv", []); done(); } }, { sep: true }].concat(envKeys().map(function (k) {
        return { label: envLabel(k), box: true, checked: sel.length > 0 && sel.indexOf(k) >= 0, run: function () {
          var s = envSel().slice(), i = s.indexOf(k);
          if (i >= 0) s.splice(i, 1); else s.push(k);
          setK("claudeEnv", s.length >= envKeys().length ? [] : s); // 全勾上 = 所有环境
          done();
        } };
      }));
    };
    var items = function () {
      var sel = envSel();
      return [
        { label: tr("状态", "Status"), value: nameIn(ST, statusOf()), items: function () { return radios(ST, statusOf(), function (v) { setK("claudeStatus", v); }); } },
        { label: tr("环境", "Environment"), value: !sel.length ? tr("全部", "All") : sel.length === 1 ? envLabel(sel[0]) : sel.length + tr(" 个", " selected"), items: envItems },
        { sep: true },
        { label: tr("分组方式", "Group by"), value: nameIn(GB, groupOf()), items: function () { return radios(GB, groupOf(), function (v) { setK("claudeGroupBy", v); }); } },
        { label: tr("排序方式", "Sort by"), value: nameIn(SO, sortOf()), items: function () { return radios(SO, sortOf(), function (v) { setK("claudeSort", v); }); } },
        { sep: true },
        { label: tr("显示状态", "Show status"), checked: getK("claudeDots", true) !== false, run: function () { setK("claudeDots", getK("claudeDots", true) === false); done(); } },
        { label: tr("显示时间", "Show time"), checked: getK("claudeTime", false) === true, run: function () { setK("claudeTime", getK("claudeTime", false) !== true); done(); } },
      ];
    };
    S.menu(items, { el: el, side: "below-right" });
  }
  function paintAcct(w) {
    // 头像、名字——agent 怎么称呼你（设置 › 账号里填的；没填是名字，再没有才是 GitHub 账号），同 Claude App 左下角的「Kezhen」；
    // 管理员后面写一个「管理员」（同 Claude App 的「Max」）；余额不放这里——在账户菜单 › 用量里看。GitHub 账号在账户菜单最上面那一行
    var A = Ag(), me = A && A.me ? A.me() || {} : {}, login = me.login || "", role = me.admin ? tr("管理员", "Admin") : "";
    var nm = String(getK("callMe", "") || me.fullName || me.name || login || "").trim();
    var ini = (login || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
    // 头像：设置里选的（STUDIO.avatarHtml：GitHub 的照片，或者字母放在一个淡淡的圆里）；它还没有时同以前（照片 / 账号的头两个字母）
    var av = S.avatarHtml ? '<span class="ca-av ca-av2">' + S.avatarHtml(24) + "</span>" : '<span class="ca-av">' + (me.avatar ? '<img src="' + esc(me.avatar) + '" alt="">' : esc(ini)) + "</span>";
    var h = '<div class="ca-me" data-a="me">' + av + '<span class="ca-login">' + esc(nm || tr("未登录", "Not signed in")) + "</span>" +
      (role ? '<span class="ca-plan">· ' + esc(role) + "</span>" : "") + '<i class="ca-chev">' + IC.down + "</i></div>";
    var box = w.ca.side.querySelector(".ca-acct");
    if (box.dataset.h !== h) { box.dataset.h = h; box.innerHTML = h; }
  }

  // ======== 标题栏：← →、会话名 ⌄、目录、右边的开关 ========
  function paintBar(w) {
    // 提示里不写快捷键（沉浸式的图形界面：键照样能用）
    var nav = '<button class="ca-ib" data-b="side" title="' + esc(sideHidden(w) ? tr("显示侧栏 ⌘B", "Show sidebar ⌘B") : tr("隐藏侧栏 ⌘B", "Hide sidebar ⌘B")) + '">' + IC.side + "</button>" +
      '<button class="ca-ib" data-b="back" title="' + esc(tr("后退", "Back")) + '"' + (NAV.pos > 0 ? "" : " disabled") + ">" + IC.back + "</button>" +
      '<button class="ca-ib" data-b="fwd" title="' + esc(tr("前进", "Forward")) + '"' + (NAV.pos < NAV.list.length - 1 ? "" : " disabled") + ">" + IC.fwd + "</button>";
    if (w.ca.nav.dataset.h !== nav) { w.ca.nav.dataset.h = nav; w.ca.nav.innerHTML = nav; }
    var p = w.ws && w.ws.active, aid = activeAgent(w), A = Ag(), chip = "", ck = "", cdir = "";
    // 标题旁边的小标签：哪个连接器的会话（图标 + 名字）· 在哪个目录（Claude Code、Codex 的项目目录；Paimon 的 agent 是它在哪个文件夹里）；新会话的草稿：选的连接器和目录
    if (aid && /^(c[cx]|pi):/.test(aid)) { ck = aid.slice(0, 2); var d0 = dirOfSess(w, ck, aid.slice(3)); cdir = d0 ? baseName(d0) : ""; }
    else if (aid && A && A.get(aid)) { ck = "pm"; var a0 = A.get(aid); cdir = a0 && a0.path ? String(a0.path).split("/").join(" / ") : ""; }
    else if (p && p.program && p.program.page === "ca-new") { ck = draftConn(); cdir = ck && ck !== "pm" ? baseName(draftDirOf(ck)) : ""; }
    if (ck && CONN[ck]) chip = '<span class="ca-chip ca-cchip" title="' + esc(CONN[ck].name + (cdir ? " · " + cdir : "")) + '">' + ico(ck) + '<span class="ca-cn">' + esc(CONN[ck].name) + "</span>" + (cdir ? '<span class="ca-csep">·</span><span class="ca-cdir">' + esc(cdir) + "</span>" : "") + "</span>";
    var title = p ? p.title() : tr("新会话", "New session"), ttag = p && p.program && p.program.titleTag ? p.program.titleTag() : ""; // 同名的会话：名字后面淡淡地带短 id
    var t = '<span class="ca-lap">' + IC.laptop + '</span><button class="ca-tbtn" data-b="title"><span class="ca-tt">' + esc(title) + (ttag ? ' <small class="ttag">' + esc(ttag) + "</small>" : "") + '</span><span class="ca-tc">' + IC.down + "</span></button>" + chip;
    if (w.ca.ttl.dataset.h !== t) { w.ca.ttl.dataset.h = t; w.ca.ttl.innerHTML = t; }
    var a = [["term", IC.term, tr("终端", "Terminal")], ["tasks", IC.tasks, tr("后台任务", "Background Tasks")], ["web", IC.globe, tr("浏览器", "Browser")], ["files", IC.folder, tr("文件", "Files")], ["global", IC.assist, tr("全局助手", "Studio Assistant")]].filter(function (x) { return (x[0] !== "files" || filesOK()) && (x[0] !== "global" || globalOK()); }).map(function (x) {
      return '<button class="ca-ib ca-tog' + (cardOn(x[0]) ? " on" : "") + '" data-c="' + x[0] + '" title="' + esc(x[2]) + '">' + x[1] + "</button>";
    }).join("") + '<button class="ca-ib" data-b="more" title="' + esc(tr("更多", "More")) + '">' + IC.more + "</button>";
    if (w.ca.acts.dataset.h !== a) { w.ca.acts.dataset.h = a; w.ca.acts.innerHTML = a; }
    var aw = w.ca.acts.offsetWidth; // 开关那一排多宽（按钮个数会变）：标题那一块的右边让出这么多
    if (aw && root.style.getPropertyValue("--ca-acts-w") !== aw + "px") root.style.setProperty("--ca-acts-w", aw + "px");
  }

  // ======== 右边的卡片：面板里的终端、后台任务（重新摆成卡片）；浏览器；文件（这台 Mac 上的文件树） ========
  var CARD_IDS = ["term", "tasks", "web", "files", "global"];
  // 全局助手卡片：标题「全局助手」⤢ ✕，下面是它的对话（globalagent.js 的那一块，同辅助侧栏「全局」那一层）；第一次用到才建
  function globalCard(w) {
    if (w.ca.gcard || !globalOK()) return w.ca.gcard || null;
    var el = document.createElement("section");
    el.className = "ca-gcard";
    el.innerHTML = '<div class="ca-cardh"><span class="ca-webt ca-gcardt"></span><span class="ca-fill"></span><button class="ca-ib" data-g="max">' + IC.expand + '</button></div><div class="ca-gbody"></div>'; // 没有 ✕：标题栏的开关管
    el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-g]");
      if (!b || !el.querySelector(".ca-cardh").contains(b)) return;
      if (b.dataset.g === "close") setCard(w, "global", false);
      else if (b.dataset.g === "max") MAX = MAX === "global" ? "" : "global";
      refresh(w, true);
    });
    w.ca.gcard = el;
    return el;
  }
  // 文件卡片：TSU_FILEPANEL（filepanel.js，学 Claude 的 Files 卡片）——它自己那一排（文件树开关、打开着的文件、搜索、⋮、⤢、✕）就是这张卡片的标题行，
  //   不另外画；它的 ⤢ ✕ 就是这张卡片的全屏、关闭。根目录跟着当前会话（Claude Code、Codex 的项目目录；Paimon 的 agent 没有工作目录：家目录）；
  //   打开过哪些文件、树多宽……按窗口记（App 的每个窗口一份）。没有 TSU_FILEPANEL 时退回下面 files.js 的文件树（标题「文件」+ 它那排按钮）
  var winKey = function () { var m = /[?&]win=([^&]+)/.exec(location.search); return "claude:" + (m ? decodeURIComponent(m[1]) : "main"); };
  function filesRoot(w) { var aid = activeAgent(w); if (aid && /^(c[cx]|pi):/.test(aid)) { var d = dirOfSess(w, aid.slice(0, 2), aid.slice(3)); if (d) return d; } return homeDir(); }
  function filesCard(w) {
    if (w.ca.files || !filesOK()) return w.ca.files || null;
    if (window.TSU_FILEPANEL) {
      var sec = document.createElement("section");
      sec.className = "ca-files ca-fpcard";
      sec.innerHTML = '<div class="ca-fpbox"></div>';
      w.ca.fpRoot = filesRoot(w); w.ca.fpMax = MAX === "files";
      w.ca.fp = TSU_FILEPANEL.mount(sec.firstChild, { root: w.ca.fpRoot, key: winKey(), expanded: w.ca.fpMax, // 不给 onClose：文件面板自己不画 ✕（卡片用标题栏的开关管）
        onExpand: function (on) { MAX = on ? "files" : MAX === "files" ? "" : MAX; refresh(w, true); } });
      w.ca.files = sec;
      return sec;
    }
    var def = S.viewDef("files"), el = document.createElement("section");
    el.className = "ca-files";
    el.innerHTML = '<div class="ca-cardh"><span class="ca-webt ca-filest"></span><span class="ca-fill"></span><button class="ca-ib" data-f="max">' + IC.expand + '</button></div><div class="ca-filesbody"></div>'; // 没有 ✕
    var view = def.create(w);
    el.querySelector(".ca-filesbody").appendChild(view);
    // 文件树自己那排按钮（新建文件、新建文件夹、刷新、折叠、···）搬进卡片的标题行：一行到顶（同 Claude 的卡片），不再单独占一行
    var vh = view.querySelector(":scope > .st-shdr"), fill = el.querySelector(".ca-cardh > .ca-fill");
    if (vh && fill) { vh.classList.add("ca-vacts"); fill.after(vh); }
    el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-f]");
      if (!b || !el.querySelector(".ca-cardh").contains(b)) return;
      if (b.dataset.f === "close") setCard(w, "files", false);
      else if (b.dataset.f === "max") MAX = MAX === "files" ? "" : "files";
      refresh(w, true);
    });
    w.ca.files = el; w.ca.filesView = view; w.ca.filesDef = def;
    return el;
  }
  function syncCards(w) {
    var t = cardOn("term"), k = cardOn("tasks"), b = cardOn("web"), f = cardOn("files");
    root.classList.toggle("ca-c-term", t);
    root.classList.toggle("ca-c-tasks", k);
    root.classList.toggle("ca-c-web", b);
    root.classList.toggle("ca-c-files", f);
    var gOn = cardOn("global"), gc = gOn ? globalCard(w) : w.ca.gcard;
    root.classList.toggle("ca-c-global", gOn);
    CARD_IDS.forEach(function (x) { root.classList.toggle("ca-max-" + x, MAX === x && cardOn(x)); });
    root.classList.toggle("ca-wide-web", !!WEB.wide && b && MAX !== "web"); // 浏览器加宽：它占整个右边那一列（别的卡片收在后面），那一列宽到对话只剩 420px
    // 开着几张（右边那一列怎么排：1 占满、2 上下、3–4 两列两行）；浏览器、文件卡片放进面板的那张网格里，和终端、后台任务排在一起
    var pvs = w.el.querySelector(".st-panel .st-pviews"), open = CARD_IDS.filter(cardOn), fc = f ? filesCard(w) : w.ca.files;
    if (pvs && w.ca.web.parentNode !== pvs) pvs.appendChild(w.ca.web);
    if (pvs && fc && fc.parentNode !== pvs) pvs.appendChild(fc);
    if (fc && w.ca.fp) { // 文件面板：根目录跟着当前会话；全屏的样子同卡片（Esc、别处退出全屏时它的 ⤢ 也跟着）；它的 ⤢ 提示同别的卡片「全屏 / 退出全屏」
      var fr = filesRoot(w);
      if (fr && fr !== w.ca.fpRoot) { w.ca.fpRoot = fr; w.ca.fp.setRoot(fr); }
      if (w.ca.fpMax !== (MAX === "files")) { w.ca.fpMax = MAX === "files"; w.ca.fp.setExpanded(w.ca.fpMax); }
      tip(fc.querySelector('.fp-top [data-a="expand"]'), MAX === "files" ? tr("退出全屏", "Exit full screen") : tr("全屏", "Full screen"));
    } else if (fc) {
      var ft = fc.querySelector(".ca-filest"), fl = tr("文件", "Files");
      if (ft.textContent !== fl) ft.textContent = fl;
      maxBtn(fc.querySelector('[data-f="max"]'), MAX === "files");

      if (f && !w.ca.filesShown) { w.ca.filesShown = true; try { w.ca.filesDef.show(w.ca.filesView, w, true); } catch (e) { /* 文件树自己会再画 */ } }
      if (!f) w.ca.filesShown = false;
    }
    if (pvs && gc && gc.parentNode !== pvs) pvs.appendChild(gc);
    if (gc) {
      var gt = gc.querySelector(".ca-gcardt"), gl = tr("全局助手", "Studio Assistant");
      if (gt.textContent !== gl) gt.textContent = gl;
      maxBtn(gc.querySelector('[data-g="max"]'), MAX === "global");

      if (gOn) TSU_GLOBAL.mount(w, gc.querySelector(".ca-gbody"));
    }
    [0, 1, 2, 3, 4, 5].forEach(function (n) { root.classList.toggle("ca-n" + n, open.length === n); });
    CARD_IDS.forEach(function (x) {
      var el = x === "web" ? w.ca.web : x === "files" ? w.ca.files : x === "global" ? w.ca.gcard : w.el.querySelector('.st-panel .st-pv[data-v="' + x + '"]'), i = open.indexOf(x);
      if (!el) return;
      if (i < 0) { el.removeAttribute("data-ca-slot"); el.style.order = ""; }
      else if (el.dataset.caSlot !== String(i)) { el.dataset.caSlot = String(i); el.style.order = String(i); }
    });
    // 终端、后台任务两张卡片的标题行：一行排下来——名字（放不下省略）、它的 + ⌄、空、右边 ⋮（窄了才有）⤢ ✕。
    // 标题行是面板画的（会整个重画）：右边这几个按钮只建一次，每次重画完放回去
    w.el.querySelectorAll('.st-panel .st-pv[data-v="term"], .st-panel .st-pv[data-v="tasks"]').forEach(function (pv) {
      var head = pv.querySelector(".st-pvh"), box = pv._caActs;
      if (!head) return;
      if (!box) {
        box = pv._caActs = document.createElement("span");
        box.className = "ca-cardacts";
        // 没有 ✕（用户：卡片用标题栏上那几个开关管，不要 ✕）；⤢ 在松手时就算（按下和松手之间标题行被重画过，click 会丢——以前点了没反应）
        box.innerHTML = '<button class="ca-ib ca-cmore" data-k="more">' + IC.more + '</button><button class="ca-ib" data-k="max">' + IC.expand + "</button>";
        var pressK = "";
        var act = function (k, bt) { var v = pv.dataset.v; if (k === "more") return cardMore(pv, bt); if (k === "max") { MAX = MAX === v ? "" : v; refresh(w, true); } };
        box.addEventListener("pointerdown", function (e) { e.stopPropagation(); var bt = e.target.closest("[data-k]"); pressK = bt ? bt.dataset.k : ""; }); // 不当成按住标题行拖动
        box.addEventListener("pointerup", function (e) { var bt = e.target.closest("[data-k]"), k = pressK; pressK = ""; if (!bt || bt.dataset.k !== k) return; e.stopPropagation(); act(k, bt); });
        box.addEventListener("click", function (e) { e.stopPropagation(); var bt = e.target.closest("[data-k]"); if (bt && e.detail === 0) act(bt.dataset.k, bt); }); // 键盘（回车、空格）按的
        new MutationObserver(function () { tidyHead(head, box); }).observe(head, { childList: true });
      }
      tidyHead(head, box);
      tip(box.querySelector('[data-k="more"]'), tr("更多", "More"));
      maxBtn(box.querySelector('[data-k="max"]'), MAX === pv.dataset.v);
    });
  }
  // 这个风格不讲快捷键：窗口里各处的提示（「发送 (↵)」「新建终端 (⌃⇧`)」……）去掉括号里的键，原来的记着，换风格时还原
  var KEY_HINT = /\s*\((?:[⌃⌥⇧⌘][^)]*|↵|⏎|Enter|Esc)\)\s*$/;
  function stripKeyHints(el) {
    if (!el) return;
    el.querySelectorAll("[title]").forEach(function (b) { var t = b.getAttribute("title"); if (t && KEY_HINT.test(t)) { var o = origT(b, t); b.dataset.caT = o; b.setAttribute("title", (KEY_HINT.test(o) ? o : t).replace(KEY_HINT, "")); } });
  }
  // 记下的、放回去的都是原来的字（没换成英文的那份）：换了语言，i18n 照样换得过来（记英文的话换回中文时就卡在英文上了）
  var origT = function (b, t) { return window.TSU_I18N && TSU_I18N.orig ? TSU_I18N.orig(b, "title") || t : t; };
  function restoreKeyHints(el) { if (el) el.querySelectorAll("[data-ca-t]").forEach(function (b) { b.setAttribute("title", b.dataset.caT); delete b.dataset.caT; }); }
  // 面板重画了标题行：右边的按钮放回去；提示里不写快捷键（这个风格不讲快捷键）
  function tidyHead(head, box) {
    if (!on()) { if (box.parentNode) box.remove(); return; } // 别的风格：面板的标题行原样
    if (box.parentNode !== head) head.appendChild(box);
    head.querySelectorAll(".st-hbtn[title]").forEach(function (b) { var t = b.getAttribute("title"), t2 = t.replace(/\s*\([⌃⌥⇧⌘][^)]*\)\s*$/, ""); if (t2 !== t) { var o = origT(b, t), o2 = o.replace(/\s*\([⌃⌥⇧⌘][^)]*\)\s*$/, ""); b.dataset.caT = o; b.setAttribute("title", o2 !== o ? o2 : t2); } });
  }
  // 卡片窄了：名字旁边的 + ⌄ 藏起来，收进 ⋮（点了就当点了那个按钮，菜单开在 ⋮ 这里）
  function cardMore(pv, anchor) {
    var btns = Array.prototype.slice.call(pv.querySelectorAll(".st-pvh .st-hbtn"));
    if (!btns.length) return;
    S.menu(btns.map(function (b) {
      return { label: b.getAttribute("title") || "", run: function () {
        var r = anchor.getBoundingClientRect();
        b.style.cssText = "display:inline-flex !important;position:fixed;left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;visibility:hidden";
        b.click();
        setTimeout(function () { b.style.cssText = ""; }, 0);
      } };
    }), { el: anchor, side: "below-right" });
  }
  function setCard(w, k, v) {
    if (cardsMode() !== "auto") return; // 设置里定了「始终显示」「不显示」：按钮不改它
    CARDS[k] = !!v;
    if (!v && MAX === k) MAX = "";
    keep("st-claude-cards", CARDS);
    if (v && k === "term") {
      if (S.panelOpen && !S.panelOpen(w) && S.togglePanel) S.togglePanel(w, true);
      if (w.st && w.st.terms && !w.st.terms.length && S.newTerm) S.newTerm(w); // 还没有终端：开一个
    }
    if (v && (k === "tasks" || k === "web" || k === "files") && S.panelOpen && !S.panelOpen(w) && S.togglePanel) S.togglePanel(w, true); // 卡片都在面板那张网格里
  }

  // 终端卡片里的终端：底色同卡片（终端自己画底色，CSS 管不着）；换回别的风格时还原
  var themed = false;
  function syncTermTheme(w) {
    var terms = w && w.st && w.st.terms;
    if (!terms || !S.xtermTheme) return;
    var want = on() ? (String(getComputedStyle(root).getPropertyValue("--ca-card-bg") || "").trim() || (root.classList.contains("light") ? "#ffffff" : "#171717")) : ""; // 同卡片的底色（配色改了也跟着）
    if (!want && !themed) return;
    terms.forEach(function (t) {
      var th = t.term && t.term.options && t.term.options.theme;
      if (!th) return;
      if (want && th.background !== want) t.term.options.theme = Object.assign({}, S.xtermTheme(), { background: want });
      else if (!want) t.term.options.theme = S.xtermTheme();
    });
    themed = !!want;
  }
  // ---- 浏览器卡片（同 Claude 的浏览器）：标题行是一排标签页（网站图标、标题；指着才有 ✕；只有一个时就是一行标题）和 +；右边 版式（叠放 ↔ 加宽）⋮ ⤢ ✕。
  //      下面一行 ← → ⟳、网址框（没在打字时只显示网站和路径）、手机宽度；网址框下面一条细线是加载进度；⋮ 里在默认浏览器中打开、拷贝网址、重新载入、关闭标签页。
  //      App 里每个标签页一个原生的网页视图（WebPanes）：只有当前那个叠在内容区（.ca-webvp）上，位置、大小每次照着量（全屏、加宽、拖宽窄、边栏开关都跟着）；
  //      菜单、浮层盖到它时先藏起来，底下垫着它刚才的样子（快照），不会一下变空白。浏览器里（没有原生）退回 iframe。
  //      「选取网页上的元素」要原生能往网页里注入脚本——现在的桥没有，先不做 ----
  var WEB = { tabs: [], cur: "", seq: 0, dev: !!store("st-claude-web-dev", false), wide: !!store("st-claude-web-wide", false), hist: store("st-claude-web-hist", []) || [], devs: null, devAt: 0, scan: false };
  var cmds = [];
  var canN = function (c) { return !!N && cmds.indexOf(c) >= 0; };
  var native = function () { return canN("web.open"); };
  if (N) N.call("info").then(function (i) { cmds = (i && i.commands) || []; }).catch(function () {});
  var tabOf = function (id) { for (var i = 0; i < WEB.tabs.length; i++) if (WEB.tabs[i].id === id) return WEB.tabs[i]; return null; };
  function addTab() {
    var t = { id: "ca-web-" + Date.now().toString(36) + "-" + (WEB.seq++), url: "", title: "", loading: false, progress: 0, back: false, fwd: false, err: "", opened: false, frame: "", snap: "", snapAt: 0 };
    WEB.tabs.push(t); WEB.cur = t.id;
    return t;
  }
  function curTab() { var t = tabOf(WEB.cur) || WEB.tabs[0] || addTab(); WEB.cur = t.id; return t; }
  var reframe = function (w) { WEB.tabs.forEach(function (t) { t.frame = ""; }); if (w && w.ca) placeWeb(w); }; // 下一次照量到的重新放一遍（原生那边可能被别的藏过）
  if (N && N.on) N.on("web.state", function (d) {
    var t = d && tabOf(d.id);
    if (!t) return;
    var was = t.loading, p = +d.progress || 0;
    t.url = d.url || t.url; t.title = d.title || ""; t.loading = !!d.loading; t.back = !!d.back; t.fwd = !!d.forward; t.err = d.error || "";
    t.progress = !t.loading ? 1 : !was ? Math.max(.08, p) : Math.max(t.progress || 0, p); // 新的一次加载从头走；同一次只往前
    if (was && !t.loading && !t.err) { remember(t); setTimeout(function () { snap(t); }, 400); }
    var w = front(); if (w && w.ca) paintWeb(w);
  });
  var normalize = function (u) { return window.TSU_WEB && TSU_WEB.normalize ? TSU_WEB.normalize(u) : String(u || "").trim(); };
  var originOf = function (u) { var m = /^(https?:\/\/[^\/?#]+)/i.exec(String(u || "")); return m ? m[1].toLowerCase() : ""; };
  var hostOf = function (u) { var m = /^[a-z][\w+.-]*:\/\/(?:[^@\/?#]*@)?([^\/?#]+)/i.exec(String(u || "")); return m ? m[1] : String(u || ""); };
  var prettyUrl = function (u) { return String(u || "").replace(/^https?:\/\//i, "").replace(/^([^\/?#]+)\/$/, "$1"); }; // 没在打字时：只显示网站和路径（同 Safari、Chrome）
  var tabName = function (t) { return t.title || (!t.url ? tr("新标签页", "New tab") : /^(data|about):/i.test(t.url) ? tr("网页", "Page") : hostOf(t.url)); };
  // 走过的网站（记在这台设备上，新标签页里的「最近」）：同一个地址只留最新的一条
  function remember(t) {
    var u = String(t.url || "");
    if (!/^https?:\/\//i.test(u)) return;
    WEB.hist = [{ u: u, t: String(t.title || "").slice(0, 120), at: Date.now() }].concat(WEB.hist.filter(function (x) { return x && x.u !== u; })).slice(0, 24);
    keep("st-claude-web-hist", WEB.hist);
  }
  // 网站图标：那个网站的 /favicon.ico；没有就是地球（记住没有的，不再去要）；在加载就是一个转圈
  var favBad = {};
  function favHtml(u, loading) {
    if (loading) return '<span class="ca-fav ca-favld"></span>';
    var o = originOf(u);
    return '<span class="ca-fav">' + (o && !favBad[o] ? '<img src="' + esc(o + "/favicon.ico") + '" alt="" data-o="' + esc(o) + '">' : IC.globe) + "</span>";
  }
  function webGo(w, u, t) {
    u = normalize(u);
    if (!u) return;
    t = t || curTab();
    t.url = u; t.title = ""; t.err = ""; t.loading = true; t.progress = .08; t.snap = "";
    var ui = w.ca.web.querySelector(".ca-url"); if (document.activeElement === ui) ui.blur(); // 网址框里显示新的地址
    if (native()) { t.opened = true; N.call("web.open", { id: t.id, url: u }).catch(function (e) { t.loading = false; t.err = String((e && e.message) || e || ""); paintWeb(w); }); }
    else frameOf(w, t).src = u;
    paintWeb(w); placeWeb(w);
  }
  // 浏览器里（没有原生）：每个标签页一个 iframe，只显示当前那个
  function frameOf(w, t) {
    var vp = w.ca.web.querySelector(".ca-webvp"), f = vp.querySelector('iframe[data-t="' + t.id + '"]');
    if (f) return f;
    f = document.createElement("iframe");
    f.className = "ca-frame"; f.dataset.t = t.id;
    f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-modals");
    f.addEventListener("load", function () {
      t.loading = false; t.progress = 1;
      try { t.title = (f.contentDocument && f.contentDocument.title) || t.title; } catch (e) { /* 别的网站：读不到标题 */ }
      remember(t);
      var w2 = front(); if (w2 && w2.ca) paintWeb(w2);
    });
    vp.appendChild(f);
    return f;
  }
  function pickTab(w, id) { if (!tabOf(id) || WEB.cur === id) return; WEB.cur = id; paintWeb(w); placeWeb(w); }
  function newTabIn(w) { addTab(); paintWeb(w); placeWeb(w); var u = w.ca.web.querySelector(".ca-url"); setTimeout(function () { u.focus(); }, 0); }
  function closeTab(w, t) {
    var i = t ? WEB.tabs.indexOf(t) : -1;
    if (i < 0) return;
    if (t.opened && native()) N.call("web.close", { id: t.id }).catch(function () {});
    var f = w.ca.web.querySelector('.ca-webvp > iframe[data-t="' + t.id + '"]'); if (f) f.remove();
    WEB.tabs.splice(i, 1);
    if (WEB.cur === t.id) { var nx = WEB.tabs[i] || WEB.tabs[i - 1]; WEB.cur = nx ? nx.id : ""; }
    if (!WEB.tabs.length) addTab(); // 最后一个也关了：留一个新标签页（卡片还开着）
    paintWeb(w); placeWeb(w);
  }
  function reloadTab(w, t) {
    t = t || curTab();
    if (!t.url) return;
    if (t.err || !(native() && t.opened)) return webGo(w, t.url, t); // 打不开的那一页、iframe：重新打开这个地址
    t.loading = true; t.progress = .08; paintWeb(w);
    N.call("web.nav", { id: t.id, action: "reload" }).catch(function () {});
  }
  function openExt(u) {
    if (!/^(https?|mailto):/i.test(u || "")) return;
    if (canN("openExternal")) N.call("openExternal", { url: u }).catch(function () {}); else window.open(u, "_blank", "noopener");
  }
  function copyText(s) {
    var viaN = function () { if (canN("clipboard.write")) N.call("clipboard.write", { text: s }).catch(function () {}); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).catch(viaN); else viaN();
  }
  // 当前页的样子（原生视图藏起来的时候垫在底下）：加载完、指针移到卡片的按钮上（多半要开菜单了）时拍一张
  function snap(t) {
    if (!t || !t.opened || t.err || t.id !== WEB.cur || !t.frame || t.frame === "hide" || !canN("web.snapshot") || Date.now() - t.snapAt < 700) return;
    var w = front(), vp = w && w.ca && w.ca.web.querySelector(".ca-webvp");
    if (!vp) return;
    t.snapAt = Date.now();
    N.call("web.snapshot", { id: t.id, width: Math.max(200, Math.min(1600, Math.round(vp.clientWidth))) }).then(function (u) { if (typeof u === "string" && u) { t.snap = u; var w2 = front(); if (w2 && w2.ca) paintSnap(w2); } }).catch(function () {});
  }
  function paintSnap(w) {
    var vp = w.ca.web.querySelector(".ca-webvp"), t = curTab(), k = t.snap && t.url && !t.err ? t.id + ":" + t.snapAt : "";
    if (vp.dataset.snap === k) return;
    vp.dataset.snap = k;
    vp.style.backgroundImage = k ? 'url("' + t.snap + '")' : "";
  }
  var tip = function (el, s) { if (el && el.title !== s) el.title = s; };
  var setIcon = function (el, k) { if (el && el.dataset.ic !== k) { el.dataset.ic = k; el.innerHTML = IC[k]; } };
  // 全屏按钮（每张卡片都有）：没全屏是 ⤢「全屏」，全屏了是 ⤡「退出全屏」（Esc 也退出）
  function maxBtn(b, maxed) { setIcon(b, maxed ? "collapse" : "expand"); tip(b, maxed ? tr("退出全屏", "Exit full screen") : tr("全屏", "Full screen")); }
  function paintWeb(w) {
    var web = w.ca.web, t = curTab(), has = !!t.url;
    // 标签页
    var th = WEB.tabs.map(function (x) {
      var nm = tabName(x);
      return '<div class="ca-tab' + (x.id === t.id ? " on" : "") + '" data-t="' + esc(x.id) + '" role="tab" title="' + esc(x.url && !/^data:/i.test(x.url) ? nm + "\n" + x.url : nm) + '">' + (x.url ? favHtml(x.url, x.loading) : "") +
        '<span class="ca-tabt">' + esc(nm) + '</span><button class="ca-tabx" data-w="tabx" title="' + esc(tr("关闭标签页", "Close tab")) + '">' + IC.close + "</button></div>";
    }).join("");
    var strip = web.querySelector(".ca-tabs");
    if (strip.dataset.h !== th) {
      strip.dataset.h = th; strip.innerHTML = th;
      var o1 = strip.querySelector(".ca-tab.on"); // 当前那个露出来
      if (o1) { var a = o1.offsetLeft, b = a + o1.offsetWidth; if (a < strip.scrollLeft) strip.scrollLeft = a; else if (b > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = b - strip.clientWidth; }
    }
    web.classList.toggle("multi", WEB.tabs.length > 1);
    // 右上角：版式（叠放 ↔ 加宽）、⋮、全屏、关闭
    tip(web.querySelector('[data-w="new"]'), tr("新标签页", "New tab"));
    var wd = web.querySelector('[data-w="wide"]');
    wd.classList.toggle("on", WEB.wide); tip(wd, WEB.wide ? tr("恢复卡片大小", "Card layout") : tr("加宽", "Wide layout"));
    tip(web.querySelector('[data-w="more"]'), tr("更多", "More"));
    maxBtn(web.querySelector('[data-w="max"]'), MAX === "web");
    tip(web.querySelector('[data-w="close"]'), tr("关闭", "Close"));
    // ← → ⟳（在加载时 ⟳ 变成 ✕：停止）
    var bk = web.querySelector('[data-w="back"]'), fw = web.querySelector('[data-w="fwd"]'), rl = web.querySelector('[data-w="reload"]');
    bk.disabled = !t.back; fw.disabled = !t.fwd; rl.disabled = !has;
    tip(bk, tr("后退", "Back")); tip(fw, tr("前进", "Forward"));
    setIcon(rl, t.loading ? "close" : "reload"); tip(rl, t.loading ? tr("停止载入", "Stop") : tr("重新载入", "Reload"));
    // 网址框
    var url = web.querySelector(".ca-url");
    url.placeholder = tr("输入网址", "Type a URL");
    if (document.activeElement !== url) { var pv = prettyUrl(t.url); if (url.value !== pv) url.value = pv; }
    // 手机宽度（390px，居中）
    var dv = web.querySelector('[data-w="device"]');
    dv.classList.toggle("on", WEB.dev); tip(dv, WEB.dev ? tr("恢复全宽", "Full width") : tr("手机宽度", "Mobile width"));
    web.classList.toggle("dev", WEB.dev);
    // 加载进度：网址框下面一条细线
    var ld = web.querySelector(".ca-webload");
    ld.classList.toggle("on", !!t.loading);
    ld.style.setProperty("--p", String(t.loading ? Math.max(.08, Math.min(1, t.progress || 0)) : 1));
    // 内容区：新标签页 / 打不开 / 网页
    web.classList.toggle("has", has && !t.err);
    web.querySelectorAll(".ca-webvp > iframe").forEach(function (f) { f.hidden = f.dataset.t !== t.id; });
    var em = web.querySelector(".ca-webempty"), eh = t.err ? errHtml(t) : has ? "" : newTabHtml();
    em.hidden = !eh;
    if (em.dataset.h !== eh) { em.dataset.h = eh; em.innerHTML = eh; }
    if (!has && native() && cardOn("web") && !WEB.scan && (WEB.devs === null || Date.now() - WEB.devAt > 30000)) scanDev(w); // 新标签页：看看这台 Mac 上有没有在跑的开发服务器
    paintSnap(w);
  }
  // 新标签页：一幅手绘的小画（地球、虚线轨道、一颗星）、一句话；这台 Mac 上在跑的开发服务器、最近去过的网站，点一下就开
  var WEB_ART = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M10.6 24.2c-.2-6.9 5.2-12.4 12-12.5 6.9-.1 12.3 5.3 12.3 12.1.1 6.8-5.4 12.3-12.2 12.3-6.6.1-11.9-5.2-12.1-11.9z"/>' +
    '<path d="M22.4 11.9c-3.2 3.3-4.8 7.3-4.7 12 .1 4.6 1.7 8.4 4.9 11.5"/><path d="M22.8 11.8c3.1 3.4 4.6 7.5 4.5 12.2-.1 4.4-1.8 8.3-5 11.3"/>' +
    '<path d="M11.2 21.3c3.6 1.6 7.4 2.4 11.4 2.3 4.2-.1 8.1-.9 11.7-2.5"/><path d="M12.1 29.3c3.3 1.1 6.8 1.6 10.6 1.5 3.6-.1 6.9-.6 10-1.7"/>' +
    '<path class="o" d="M5.6 31.6c-2.1-3.6 5.3-10.1 16.4-14.4 10.4-4 19.7-4.9 21.6-1.6.9 1.6-.4 4-3.4 6.5" stroke-dasharray=".1 3.3"/>' +
    '<path class="o f" d="M38.6 5.8c.3 2.4 1.5 3.6 3.9 3.9-2.4.3-3.6 1.5-3.9 3.9-.3-2.4-1.5-3.6-3.9-3.9 2.4-.3 3.6-1.5 3.9-3.9z"/><circle class="o f" cx="43.2" cy="18.6" r=".9"/></svg>';
  function newTabHtml() {
    var devs = WEB.devs || [], rec = WEB.hist.filter(function (x) { return x && x.u && !devs.some(function (d) { return d.u === x.u; }); }).slice(0, 5);
    var row = function (u, name, sub) { return '<button class="ca-wit" data-go="' + esc(u) + '" title="' + esc(u) + '">' + favHtml(u) + '<span class="ca-witn">' + esc(name) + "</span>" + (sub ? '<span class="ca-wits">' + esc(sub) + "</span>" : "") + "</button>"; };
    var h = '<div class="ca-wnew"><div class="ca-wart">' + WEB_ART + "</div><b>" + esc(tr("用 Agent 浏览", "Browse with your agent")) + "</b><p>" + esc(tr("输入网址，或让 Agent 打开一个网站。", "Type a URL, or ask your agent to open a site.")) + "</p>";
    if (devs.length) h += '<div class="ca-wsec">' + esc(tr("这台 Mac 上的开发服务器", "Dev servers on this Mac")) + "</div>" + devs.map(function (d) { return row(d.u, "localhost:" + d.p, ""); }).join("");
    if (rec.length) h += '<div class="ca-wsec">' + esc(tr("最近", "Recent")) + "</div>" + rec.map(function (x) { var hs = hostOf(x.u); return row(x.u, x.t || hs, x.t ? hs : ""); }).join("");
    var note = WEB.scan ? '<span class="ca-wnote">' + esc(tr("正在检测开发服务器…", "Looking for dev servers…")) + "</span>"
      : WEB.devs && !devs.length ? '<span class="ca-wnote">' + esc(tr("没有在跑的开发服务器", "No dev server running")) + '</span><a data-w="detect">' + esc(tr("再检测一次", "Check again")) + "</a>"
      : '<a data-w="detect">' + esc(devs.length ? tr("重新检测", "Check again") : tr("检测开发服务器", "Detect dev server")) + "</a>";
    return h + '<div class="ca-wdev">' + note + "</div></div>";
  }
  function errHtml(t) {
    return '<div class="ca-wnew"><div class="ca-wico">' + IC.globe + "</div><b>" + esc(tr("无法打开这一页", "Can't open this page")) + "</b><p>" + esc(t.err) + "</p>" +
      '<p class="ca-wurl">' + esc(prettyUrl(t.url)) + '</p><div class="ca-wdev"><a data-w="retry">' + esc(tr("再试一次", "Try again")) + "</a></div></div>";
  }
  // ⋮（和标签页上右键）：新标签页（+ 让出来了才有）、在默认浏览器中打开、拷贝网址、重新载入；窄了让出来的按钮也在这里；关闭其他标签页、关闭标签页
  function webMenu(w, anchor, t, at) {
    t = t || curTab();
    var has = !!t.url, web = w.ca.web, gone = function (k) { var b = web.querySelector('.ca-cardh [data-w="' + k + '"], .ca-webnav [data-w="' + k + '"]'); return !b || !b.offsetParent; };
    var items = [
      !at && gone("new") ? { label: tr("新标签页", "New Tab"), icon: IC.plus, run: function () { newTabIn(w); } } : null,
      { label: tr("在默认浏览器中打开", "Open in Default Browser"), icon: IC.extlink, disabled: !/^https?:/i.test(t.url), run: function () { openExt(t.url); } },
      { label: tr("拷贝网址", "Copy URL"), icon: IC.link, disabled: !has || /^data:/i.test(t.url), run: function () { copyText(t.url); } },
      { label: tr("重新载入", "Reload"), icon: IC.reload, disabled: !has, run: function () { reloadTab(w, t); } },
      !at && gone("device") ? { label: tr("手机宽度", "Mobile Width"), icon: IC.phone, checked: WEB.dev, run: function () { web.querySelector('[data-w="device"]').click(); } } : null,
      !at && gone("wide") && MAX !== "web" ? { label: tr("加宽", "Wide Layout"), icon: IC.layout, checked: WEB.wide, run: function () { web.querySelector('[data-w="wide"]').click(); } } : null,
      !at && gone("max") ? { label: MAX === "web" ? tr("退出全屏", "Exit Full Screen") : tr("全屏", "Full Screen"), icon: MAX === "web" ? IC.collapse : IC.expand, run: function () { web.querySelector('[data-w="max"]').click(); } } : null,
      { sep: true },
      WEB.tabs.length > 1 && at ? { label: tr("关闭其他标签页", "Close Other Tabs"), run: function () { WEB.tabs.filter(function (x) { return x !== t; }).forEach(function (x) { closeTab(w, x); }); } } : null,
      { label: tr("关闭标签页", "Close Tab"), icon: IC.close, run: function () { closeTab(w, t); } },
    ].filter(Boolean);
    S.menu(items, anchor ? { el: anchor, side: "below-right" } : { x: at.x, y: at.y });
  }
  var OVER = ".st-menu, .st-pop, .st-palette, .st-float, .gv-pop, .ss-ddlist, .xp-ql, .ts-sug:not([hidden]), .ov-wrap, .ca-sheetdim, .ca-dlgdim, html.ca-peek .ca-side";
  function covered(r) {
    var hit = false;
    document.querySelectorAll(OVER).forEach(function (o) {
      if (hit) return;
      var q = o.getBoundingClientRect();
      if (q.width && q.height && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top) hit = true;
    });
    return hit;
  }
  // 原生的网页视图跟着 .ca-webvp 走：当前那个标签页放上去（位置、大小同它），别的标签页藏起来；被盖住、拖宽窄、卡片关了也藏
  function placeWeb(w) {
    if (!native() || !WEB.tabs.length) return;
    var t = curTab(), vp = w && w.ca && w.ca.web.querySelector(".ca-webvp"), r = vp ? vp.getBoundingClientRect() : null;
    var show = !!(t.opened && r && on() && cardOn("web") && t.url && !t.err && r.width > 20 && r.height > 20 && vp.offsetParent && !covered(r) && !root.classList.contains("ca-resizing"));
    WEB.tabs.forEach(function (x) {
      if (!x.opened) return;
      var vis = show && x === t, k = vis ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(",") : "hide";
      if (k === x.frame) return;
      x.frame = k;
      N.call("web.frame", vis ? { id: x.id, x: r.left, y: r.top, w: r.width, h: r.height, visible: true } : { id: x.id, x: 0, y: 0, w: 0, h: 0, visible: false }).catch(function () {});
    });
  }
  // 布局一变（全屏、加宽、卡片开关、边栏开关）：接下来 300ms 每 16ms 量一遍，原生的网页视图一直贴着（不等 400ms 那一轮）
  function followWeb(w) {
    if (!native() || !WEB.tabs.length || !w || !w.ca) return;
    var until = Date.now() + 300, step = function () { placeWeb(w); if (Date.now() < until) setTimeout(step, 16); };
    step();
  }
  // 菜单、对话框、浮层（都挂在 body 上）一出来马上让开、收起来马上回来——不等 400ms 那一轮（不然菜单会被原生的网页视图盖住一下）
  if (window.MutationObserver) new MutationObserver(function (ms) {
    if (!on() || !WEB.tabs.length) return;
    for (var i = 0; i < ms.length; i++) {
      var ns = [].slice.call(ms[i].addedNodes).concat([].slice.call(ms[i].removedNodes));
      for (var j = 0; j < ns.length; j++) if (ns[j].nodeType === 1 && ns[j].matches && ns[j].matches(OVER)) { var w = front(); if (w && w.ca) placeWeb(w); return; }
    }
  }).observe(document.body || document.documentElement, { childList: true });
  // 检测开发服务器：这台 Mac 上常见的几个端口，有回应的都列在新标签页上（不含这个页面自己的端口；5000 是 macOS 的隔空播放接收器，不算）
  var DEV_PORTS = [3000, 5173, 8080, 8000, 4200, 4321, 3001, 8787, 1313, 8888];
  function scanDev(w) {
    if (WEB.scan) return;
    WEB.scan = true;
    var self = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? +location.port : 0;
    var ports = DEV_PORTS.filter(function (p) { return p !== self; }), found = [], left = ports.length;
    ports.forEach(function (pt) {
      var ctl = window.AbortController ? new AbortController() : null, tm = setTimeout(function () { if (ctl) ctl.abort(); }, 900);
      fetch("http://localhost:" + pt + "/", { mode: "no-cors", cache: "no-store", signal: ctl ? ctl.signal : undefined }).then(function () { found.push(pt); }, function () {}).then(function () {
        clearTimeout(tm);
        if (--left) return;
        WEB.scan = false; WEB.devAt = Date.now();
        WEB.devs = ports.filter(function (p) { return found.indexOf(p) >= 0; }).map(function (p) { return { p: p, u: "http://localhost:" + p + "/" }; });
        var w2 = front(); if (w2 && w2.ca) paintWeb(w2);
      });
    });
    if (w && w.ca) paintWeb(w);
  }

  // ======== 新会话（同 Claude App 的 New session）：只是一张草稿——左上「✳ 接下来做什么，<名字>？」、用量卡片；下面：在哪跑、哪个文件夹、输入框、
  //   权限 / 模型 / 推理强度。点「新建会话」什么都不建（边栏不多一行）；说了第一句话才真的建一个会话（这时才出现在边栏），这句话发给它；没说话离开 = 什么都没有 ========
  var DRAFT = { text: "", images: [], model: "", effort: "high", access: "read", dir: "" };
  var ACC_L = { none: ["仅自己的文件夹", "Own folder only"], read: ["只读", "Read-only"], rw: ["读写", "Read & write"] };
  var EFF_L = { off: ["关", "Off"], low: ["低", "Low"], high: ["高", "High"], max: ["最高", "Max"] };
  var homeDir = function () { var L = window.TSU_LOCAL, i = L && L.info ? L.info() : null; return (i && i.home) || ""; };
  var draftDir = function () { return DRAFT.dir || homeDir(); };
  var baseName = function (p) { p = String(p || "").replace(/\/+$/, ""); return p.slice(p.lastIndexOf("/") + 1) || p || "/"; };
  function draftModel() {
    var A = Ag(), ms = A && A.models ? A.models() : [], dm = A && A.cfg ? A.cfg.defaultModel : "";
    if (DRAFT.model && ms.some(function (m) { return m.id === DRAFT.model; })) return DRAFT.model;
    return dm && ms.some(function (m) { return m.id === dm; }) ? dm : (ms[0] && ms[0].id) || "";
  }
  function openDraft(w) {
    var p = S.openPage(w, "ca-new", "");
    later(w);
    setTimeout(function () { var ta = p && p.el && p.el.querySelector(".ca-new-ta"); if (ta) ta.focus(); if (p && p.el && p.el.querySelector(".ca-new")) paintDraft(p.el); }, 60);
    return p;
  }
  // 新会话在哪个连接器上开（草稿左下角第一个小标签；边栏里连接器那一段标题上的 + 直接选好）：上次用的；它关了就换成开着的第一个
  DRAFT.conn = store("st-claude-draft-conn", "pm");
  DRAFT.dirs = {}; // Claude Code、Codex：在哪个目录开（Paimon 的 agent 没有工作目录）
  function draftConn() {
    if (CONN[DRAFT.conn] && canNewIn(DRAFT.conn)) return DRAFT.conn;
    return ["pm", "cc", "cx", "pi"].filter(canNewIn)[0] || "";
  }
  // Claude Code、Codex 的目录：选过的；没选过就是这个连接器最近那段会话的目录；都没有就是主目录
  function draftDirOf(k) {
    if (DRAFT.dirs[k]) return DRAFT.dirs[k];
    var w = front(), last = k === "cc" ? ccList(w).slice().sort(function (a, b) { return (+new Date(b.mtime || 0) || 0) - (+new Date(a.mtime || 0) || 0); })[0] : k === "cx" && window.TSU_CODEX ? TSU_CODEX.list()[0] : k === "pi" && window.TSU_PI ? TSU_PI.list()[0] : null;
    return (last && last.cwd && !last.missing) ? last.cwd : homeDir();
  }
  // 在这个连接器上开新会话：打开草稿、选好它（打过的字留着）
  function newIn(w, k) { if (CONN[k] && canNewIn(k)) { DRAFT.conn = k; keep("st-claude-draft-conn", k); } return openDraft(w); }
  var SVG_FOLDER = SV('<path d="M1.8 4.2c0-.6.4-1 1-1h3.1l1.4 1.5h5.9c.6 0 1 .4 1 1v6.6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z"/>');
  var SVG_FOLDER_ADD = SV('<path d="M1.8 4.2c0-.6.4-1 1-1h3.1l1.4 1.5h5.9c.6 0 1 .4 1 1v6.6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z"/><path d="M8 7.2v4M6 9.2h4"/>');
  var SVG_LOCK = SV('<path d="M5 7V5a3 3 0 0 1 6 0v2"/><rect x="3.5" y="7" width="9" height="6.5" rx="1.2"/>');
  var SVG_CLOUD = SV('<path d="M4.6 12.5h7a2.9 2.9 0 0 0 .3-5.8A4 4 0 0 0 4.2 7.4a2.6 2.6 0 0 0 .4 5.1z"/>');
  S.pages["ca-new"] = {
    title: function () { return tr("新会话", "New session"); },
    address: function () { return ""; },
    render: function (host, P, arg, V) {
      if (!V.built) {
        V.built = true;
        host.innerHTML = '<div class="ca-new"><div class="ca-new-top"><div class="ca-new-hi"><i class="ca-new-star">' + STAR + '</i><span class="ca-new-q"></span></div><div class="ca-new-stats"></div></div>' +
          '<div class="ca-new-bot"><div class="ca-new-chips"><button class="ca-nchip ca-nconn" data-c="conn"></button><span class="ca-nchip ca-nenv"></span><button class="ca-nchip ca-ndir" data-c="dir"></button><button class="ca-ib ca-naddf" data-c="dir" title=""></button></div>' +
          '<div class="ca-new-box"><div class="ca-new-att" hidden></div><textarea class="ca-new-ta" rows="2" spellcheck="false"></textarea><button class="ca-new-send" data-c="send" title=""></button></div>' +
          '<div class="ca-new-bar"><button class="ca-nb ca-nplus" data-c="attach" title="">' + IC.plus + '</button><button class="ca-nb" data-c="access"></button><span class="ca-fill"></span><button class="ca-nb" data-c="model"></button><button class="ca-nb" data-c="effort"></button></div>' +
          '<input class="ca-new-file" type="file" accept="image/*" multiple hidden></div></div>';
        var ta = host.querySelector(".ca-new-ta"), file = host.querySelector(".ca-new-file");
        ta.value = DRAFT.text;
        var grow = function () { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 280) + "px"; };
        ta.addEventListener("input", function () { DRAFT.text = ta.value; grow(); paintDraft(host); });
        ta.addEventListener("keydown", function (e) {
          if (e.key === "Enter" && !e.shiftKey && !e.altKey && !(window.TSU_IME ? TSU_IME(e) : e.isComposing)) { e.preventDefault(); e.stopPropagation(); sendDraft(P); }
        });
        ta.addEventListener("paste", function (e) { var fs = e.clipboardData && e.clipboardData.files; if (fs && fs.length) { e.preventDefault(); Array.prototype.forEach.call(fs, function (f) { addDraftImage(f, host); }); } });
        file.addEventListener("change", function () { Array.prototype.forEach.call(file.files || [], function (f) { addDraftImage(f, host); }); file.value = ""; });
        host.addEventListener("click", function (e) {
          var b = e.target.closest("[data-c]"), x = e.target.closest(".ca-new-att button[data-i]");
          if (x) { DRAFT.images.splice(+x.dataset.i, 1); return paintDraft(host); }
          if (!b) return;
          var c = b.dataset.c;
          if (c === "send") return sendDraft(P);
          if (c === "attach") return file.click();
          if (c === "dir") return dirMenu(host, b);
          if (c === "conn") return connMenu(host, b);
          if (c === "access") return S.menu(Object.keys(ACC_L).map(function (k) { return { label: tr(ACC_L[k][0], ACC_L[k][1]), radio: true, close: true, checked: DRAFT.access === k, run: function () { DRAFT.access = k; paintDraft(host); } }; }), { el: b, side: "above" });
          if (c === "effort") return S.menu(((Ag() && Ag().EFFORTS) || ["off", "low", "high", "max"]).map(function (k) { return { label: tr(EFF_L[k] ? EFF_L[k][0] : k, EFF_L[k] ? EFF_L[k][1] : k), radio: true, close: true, checked: DRAFT.effort === k, run: function () { DRAFT.effort = k; paintDraft(host); } }; }), { el: b, side: "above" });
          if (c === "model") return modelMenu(host, b);
        });
        grow();
      }
      paintDraft(host);
    },
    focus: function () { var ta = document.querySelector(".tpane.active .ca-new-ta"); if (ta) ta.focus(); },
  };
  function paintDraft(host) {
    var A = Ag(), me = A && A.me ? A.me() || {} : {}, nm = getK("callMe", "") || me.login || "";
    var set = function (sel, html) { var e = host.querySelector(sel); if (e && e.dataset.h !== html) { e.dataset.h = html; e.innerHTML = html; } };
    set(".ca-new-q", esc(nm ? tr("接下来做什么，" + nm + "？", "What's up next, " + nm + "?") : tr("接下来做什么？", "What's up next?")));
    var local = A && A.local && A.local(), k = draftConn(), pm = k === "pm", dir = pm ? draftDir() : draftDirOf(k);
    // 在哪个连接器上开（图标 + 名字 ⌄）；Paimon：在哪儿跑（本机 / 云端）；Claude Code、Codex：在哪个目录（它们按目录找会话）
    var cb = host.querySelector(".ca-nconn");
    if (cb) { cb.hidden = !k; cb.title = tr("在哪个连接器上开这段会话", "Which connector runs this session"); set(".ca-nconn", k ? ico(k) + "<span>" + esc(CONN[k].name) + "</span>" + IC.down : ""); }
    var envE = host.querySelector(".ca-nenv"); if (envE) envE.hidden = !pm;
    set(".ca-nenv", (local ? IC.laptop : SVG_CLOUD) + "<span>" + esc(envLabel("here")) + "</span>");
    var dirB = host.querySelector(".ca-ndir"), addB = host.querySelector(".ca-naddf");
    dirB.hidden = addB.hidden = pm || !k; // Paimon 的 agent 没有「工作目录」：它自己的包就是它的家（不让选文件夹）
    set(".ca-ndir", SVG_FOLDER + "<span>" + esc(baseName(dir)) + "</span>");
    dirB.title = tildeOf(dir);
    // 模型、推理强度、权限、图片只对 Paimon 的会话（Claude Code、Codex 用它们自己的设置）
    ["attach", "access", "model", "effort"].forEach(function (c) { var e = host.querySelector('[data-c="' + c + '"]'); if (e) e.hidden = !pm; });
    var attE = host.querySelector(".ca-new-att"); if (attE && !pm) attE.hidden = true;
    set(".ca-naddf", SVG_FOLDER_ADD);
    addB.title = tr("选择文件夹", "Choose folder");
    var ta = host.querySelector(".ca-new-ta");
    ta.placeholder = tr("描述一个任务，或者问个问题", "Describe a task or ask a question");
    var ready = !!(ta.value.trim() || DRAFT.images.length);
    var sb = host.querySelector(".ca-new-send");
    sb.classList.toggle("ready", ready);
    sb.title = tr("发送", "Send");
    set(".ca-new-send", SV('<path d="M8 12.6V3.6M4.2 7.2L8 3.4l3.8 3.8"/>'));
    host.querySelector('[data-c="attach"]').title = tr("添加图片", "Add images");
    set('[data-c="access"]', SVG_LOCK + "<span>" + esc(tr(ACC_L[DRAFT.access][0], ACC_L[DRAFT.access][1])) + "</span>" + IC.down);
    var mid = draftModel(), m = A && A.modelOf ? A.modelOf(mid) : null;
    set('[data-c="model"]', "<span>" + esc((m && (m.name || m.id)) || tr("模型", "Model")) + "</span>" + IC.down);
    set('[data-c="effort"]', "<span>" + esc(tr("推理 ", "Effort ") + tr(EFF_L[DRAFT.effort][0], EFF_L[DRAFT.effort][1])) + "</span>" + IC.down);
    var att = host.querySelector(".ca-new-att"), ah = DRAFT.images.map(function (im, i) { return '<span class="ca-natt"><img src="data:' + im.media_type + ";base64," + im.data + '" alt=""><button data-i="' + i + '" title="' + esc(tr("移除", "Remove")) + '">×</button></span>'; }).join("");
    att.hidden = !DRAFT.images.length || !pm;
    if (att.dataset.h !== ah) { att.dataset.h = ah; att.innerHTML = ah; }
    var st = host.querySelector(".ca-new-stats"); // 用量卡片（stats.js；还没载入就下次再挂）
    if (st && !st.dataset.mounted && window.TSU_STATS && TSU_STATS.mount) { st.dataset.mounted = "1"; TSU_STATS.mount(st); }
  }
  function addDraftImage(file, host) {
    if (!file || !/^image\//.test(file.type)) return;
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var k = Math.min(1, 1568 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      var type = file.type === "image/png" ? "image/png" : "image/jpeg", data = c.toDataURL(type, 0.9);
      DRAFT.images.push({ media_type: type, data: data.slice(data.indexOf(",") + 1) });
      URL.revokeObjectURL(url);
      paintDraft(host);
    };
    img.src = url;
  }
  // 模型：按提供方分几组（子菜单），勾着的是现在选的
  function modelMenu(host, el) {
    var A = Ag(), ms = A && A.models ? A.models() : [], pv = A && A.providerOf ? A.providerOf : function () { return ""; }, cur = draftModel(), provs = [];
    ms.forEach(function (m) { var p = pv(m) || "—"; if (provs.indexOf(p) < 0) provs.push(p); });
    var item = function (m) { return { label: m.name || m.id, radio: true, close: true, checked: m.id === cur, run: function () { DRAFT.model = m.id; paintDraft(host); } }; };
    var items = provs.length > 1 ? provs.map(function (p) { var L0 = ms.filter(function (m) { return (pv(m) || "—") === p; }); return { label: p, value: L0.some(function (m) { return m.id === cur; }) ? "✓" : "", items: L0.map(item) }; }) : ms.map(item);
    S.menu(items.length ? items : [{ label: tr("没有可用的模型", "No models available"), disabled: true }], { el: el, side: "above" });
  }
  // 在哪个文件夹干活（这台 Mac 上）：主目录、别的会话用过的、其他文件夹…（打一个路径）
  // 在哪个目录开（Claude Code、Codex 的新会话）：这个连接器最近几段会话的目录（新的在前）、主目录、其他文件夹…（打一个路径）
  function dirMenu(host, el) {
    var L = window.TSU_LOCAL, home = homeDir(), k0 = draftConn(), cur = k0 === "pm" ? draftDir() : draftDirOf(k0), seen = {}, list = [];
    var add = function (d) { d = String(d || "").replace(/\/+$/, "") || "/"; if (!d || seen[d]) return; seen[d] = 1; list.push(d); };
    var setDir = function (d) { if (k0 === "pm") DRAFT.dir = d === home ? "" : d; else DRAFT.dirs[k0] = d; paintDraft(host); later(front()); };
    if (k0 === "cc") ccList(front()).slice().sort(function (a, b) { return (+new Date(b.mtime || 0) || 0) - (+new Date(a.mtime || 0) || 0); }).forEach(function (x) { if (x.cwd && !x.missing) add(x.cwd); });
    if (k0 === "cx" && window.TSU_CODEX) TSU_CODEX.list().forEach(function (x) { if (x.cwd) add(x.cwd); });
    if (k0 === "pi" && window.TSU_PI) TSU_PI.list().forEach(function (x) { if (x.cwd) add(x.cwd); });
    add(home);
    var tilde = function (d) { return home && (d === home || d.indexOf(home + "/") === 0) ? "~" + d.slice(home.length) : d; };
    S.menu(list.slice(0, 12).map(function (d) { return { label: baseName(d), value: tilde(d), radio: true, close: true, checked: d === cur, run: function () { setDir(d); } }; }).concat([{ sep: true }, {
      label: tr("其他文件夹…", "Other folder…"), run: function () {
        dialog({ title: tr("在哪个文件夹干活？", "Choose a working folder"), text: tr("输入这台 Mac 上一个文件夹的路径（~ 是主目录）", "Type the path of a folder on this Mac (~ is your home folder)"), value: tilde(cur), ok: tr("选择", "Choose") }).then(function (v) {
          if (v == null) return;
          var p = String(v).trim().replace(/\/+$/, "");
          if (p === "~" || p.indexOf("~/") === 0) p = home + p.slice(1);
          if (!p) return;
          (L && L.stat ? L.stat(p) : Promise.resolve({ dir: true })).then(function (st) {
            if (st && (st.dir || st.isDir || st.type === "dir" || st.kind === "dir")) setDir(p);
            else dialog({ title: tr("找不到这个文件夹", "Folder not found"), text: p, buttons: [{ label: tr("好", "OK"), value: true, primary: true }] });
          }, function () { dialog({ title: tr("找不到这个文件夹", "Folder not found"), text: p, buttons: [{ label: tr("好", "OK"), value: true, primary: true }] }); });
        });
      },
    }]), { el: el, side: "above" });
  }
  // 在哪个连接器上开：开着的都列出来（图标、名字）；关着的灰着写明「未开启」（去「设置 › 连接器」开）
  function connMenu(host, el) {
    var cur = draftConn();
    S.menu(["pm", "cc", "cx", "pi"].filter(function (k) { var C = window.TSU_CONNECTORS; return k === "pm" || !C || !C.get || C.get(CONN[k].id); }).map(function (k) {
      var ok = canNewIn(k);
      return { label: CONN[k].name, icon: ico(k), radio: true, close: true, checked: k === cur, disabled: !ok, value: ok ? "" : tr("未开启", "Off"),
        run: function () { DRAFT.conn = k; keep("st-claude-draft-conn", k); paintDraft(host); later(front()); var ta = host.querySelector(".ca-new-ta"); if (ta) ta.focus(); } };
    }), { el: el, side: "above" });
  }
  // 第一句话：这时才建会话（带上草稿里选的模型、推理强度、权限、文件夹），打开它、把这句话发给它；草稿清空、这一页关掉。
  // Claude Code、Codex：在选的目录里开它们的新会话，第一句马上说出去（TSU_CONNECTORS.newSession：开一个标签页，说了才有记录、边栏里才有它）
  function sendDraft(P) {
    var A = Ag(), w = P && P.win ? P.win : front(), host = P && P.el;
    if (!A || !w) return;
    var ta = host && host.querySelector(".ca-new-ta"), text = String(ta ? ta.value : DRAFT.text).replace(/\s+$/, ""), k = draftConn();
    if (isConnK(k)) {
      if (!text.trim()) return;
      var C = window.TSU_CONNECTORS, r = C && C.newSession ? C.newSession(CONN[k].id, draftDirOf(k), text) : null;
      if (!r) return dialog({ title: tr("没能开始新会话", "Couldn't start a new session"), text: tr(CONN[k].name + " 连接器没有开启，或者这台 Mac 上没有找到它的命令。", "The " + CONN[k].name + " connector is off, or its command wasn't found on this Mac."), buttons: [{ label: tr("好", "OK"), value: true, primary: true }] });
      DRAFT.text = ""; if (ta) ta.value = "";
      if (P && P.program && P.program.page === "ca-new" && w.ws && w.ws.all && w.ws.all().indexOf(P) >= 0 && r.pane !== P) w.ws.closePane(P);
      return later(w);
    }
    if (!k) return dialog({ title: tr("没有开着的连接器", "No connector is on"), text: tr("在「设置 › 连接器」里打开 Paimon、Claude Code 或 Codex。", "Turn on Paimon, Claude Code or Codex in Settings › Connectors."), buttons: [{ label: tr("好", "OK"), value: true, primary: true }] });
    if (!text.trim() && !DRAFT.images.length) return;
    var me = A.me ? A.me() || {} : {};
    if (!me.loggedIn || !me.allowed) return dialog({ title: tr("还不能发送", "Can't send yet"), text: me.loggedIn ? tr("这个账号还没有开通。", "This account isn't enabled yet.") : tr("先用 GitHub 登录。", "Sign in with GitHub first."), buttons: [{ label: tr("好", "OK"), value: true, primary: true }] });
    var a = A.create({ model: draftModel(), effort: DRAFT.effort, access: DRAFT.access }), rt = A.runtime(a.id);
    if (DRAFT.dir && rt.setWorkdir) rt.setWorkdir(DRAFT.dir);
    var imgs = DRAFT.images.slice();
    DRAFT.text = ""; DRAFT.images = [];
    if (w.side && w.side.open) w.side.open(a.id);
    rt.send(text, imgs.length ? imgs : undefined);
    // 草稿这一页用完了：还是草稿（没被拿去放这个会话）才关
    if (P && P.program && P.program.page === "ca-new" && w.ws && w.ws.all && w.ws.all().indexOf(P) >= 0) w.ws.closePane(P);
    later(w);
  }

  // ======== 事件 ========
  function wire(w) {
    var ca = w.ca;
    ca.side.addEventListener("click", function (e) {
      var nv = e.target.closest("[data-go]"), it = e.target.closest(".ca-it"), lb = e.target.closest("[data-l]"), ac = e.target.closest("[data-a]");
      var rm = e.target.closest(".ca-rowmore");
      if (rm) { e.stopPropagation(); var r0 = rm.closest(".ca-it"); return itemMenu(w, r0.dataset.kind, r0.dataset.id, { el: rm, side: "below-right" }, r0); }
      var ap = e.target.closest("[data-app]");
      if (ap && S.apps && S.apps.open) { S.apps.open(ap.dataset.app, w); return later(w); } // 「更多」里的 App：开着就切过去，没有就开
      // 「有新版本」卡片：× 这个版本不再提；「更新内容」；点别处重新载入
      var up = e.target.closest("[data-upd]");
      if (up) {
        e.stopPropagation();
        if (up.dataset.upd === "x") { keep("st-claude-upd-x", UPD.id || "any"); return refresh(w, true); }
        if (up.dataset.upd === "log") { if (window.TSU_CHANGELOG) TSU_CHANGELOG.open(w); return; }
        return location.reload();
      }
      // 分段：标题上的 +（在这个连接器上开新会话）、点标题收起 / 展开、「还有 N 个」/「收起」
      var sa = e.target.closest(".ca-shadd"), sf = e.target.closest(".ca-shx"), sm = e.target.closest(".ca-smore"), so = e.target.closest(".ca-shflt");
      if (sa) { e.stopPropagation(); peekClose(true); return newIn(w, sa.dataset.new); }
      if (so) { e.stopPropagation(); setSec(so.dataset.only, { only: !secSt(so.dataset.only).only }); return refresh(w, true); } // 漏斗：仅显示运行中 ↔ 全部
      if (sf) { if (!Q.trim()) { setSec(sf.dataset.fold, { fold: !secSt(sf.dataset.fold).fold }); refresh(w, true); } return; }
      if (sm) { setSec(sm.dataset.more, { all: !secSt(sm.dataset.more).all }); return refresh(w, true); }
      if (nv || it) peekClose(true); // 偷看的边栏里点了去处、会话：打开它、边栏收回去
      if (nv) return navGo(w, nv.dataset.go);
      if (lb) {
        e.stopPropagation();
        if (lb.dataset.l === "search") { SEARCH = !SEARCH; var fd = ca.side.querySelector(".ca-find"); fd.hidden = !SEARCH; if (SEARCH) fd.querySelector("input").focus(); else { Q = ""; fd.querySelector("input").value = ""; } return refresh(w, true); }
        if (lb.dataset.l === "filter") return filterMenu(w, lb);
      }
      if (ac && ac.dataset.a === "me") return acctMenu(w, ac);
      if (it) openItem(w, it.dataset.kind, it.dataset.id);
    });
    ca.side.addEventListener("contextmenu", function (e) { var it = e.target.closest(".ca-it"); if (!it) return; e.preventDefault(); itemMenu(w, it.dataset.kind, it.dataset.id, { x: e.clientX, y: e.clientY }, it); });
    ca.side.addEventListener("keydown", function (e) { var sf = e.target.closest && e.target.closest(".ca-shx"); if (sf && e.target === sf && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); sf.click(); } }); // 标题：回车 / 空格收起、展开
    // 收起来的边栏浮出来时（偷看）：指针在它上面就一直在；离开一会儿滑回去
    ca.side.addEventListener("pointerenter", function () { PEEK.inside = true; clearTimeout(PEEK.out); });
    ca.side.addEventListener("pointerleave", function () { PEEK.inside = false; if (PEEK.on) peekClose(); });
    ca.nav.addEventListener("pointerover", function (e) { if (e.target.closest('[data-b="side"]') && sideHidden(w) && !PEEK.on) peekSoon(200); });
    ca.nav.addEventListener("pointerout", function (e) { var b = e.target.closest('[data-b="side"]'); if (b && !b.contains(e.relatedTarget)) { clearTimeout(PEEK.t); if (PEEK.on && !PEEK.inside) peekClose(); } });
    // 浮出来的边栏通到了窗口顶上：标题栏那一组按钮在它上面，指针在这组按钮上也算「在边栏里」（不收回去）
    ca.nav.addEventListener("pointerenter", function () { if (PEEK.on) { PEEK.inside = true; clearTimeout(PEEK.out); } });
    ca.nav.addEventListener("pointerleave", function (e) { if (PEEK.on && !(e.relatedTarget && ca.side.contains(e.relatedTarget))) { PEEK.inside = false; peekClose(); } });
    ca.side.querySelector(".ca-q").addEventListener("input", function (e) { Q = e.target.value; refresh(w, true); });
    ca.side.querySelector(".ca-q").addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); SEARCH = false; Q = ""; e.target.value = ""; ca.side.querySelector(".ca-find").hidden = true; refresh(w, true); } });
    ca.nav.addEventListener("click", function (e) {
      var b = e.target.closest("[data-b]");
      if (!b) return;
      if (b.dataset.b === "side") return toggleSide(w);
      if (b.dataset.b === "back") return navStep(w, -1);
      if (b.dataset.b === "fwd") return navStep(w, 1);
    });
    ca.ttl.addEventListener("click", function (e) { var b = e.target.closest('[data-b="title"]'); if (b) titleMenu(w, b); });
    ca.acts.addEventListener("click", function (e) {
      var c = e.target.closest("[data-c]"), b = e.target.closest("[data-b]");
      if (c) {
        var ck = c.dataset.c;
        if (ck !== "web" && root.classList.contains("ca-wide-web")) { WEB.wide = false; keep("st-claude-web-wide", false); if (!cardOn(ck)) setCard(w, ck, true); return refresh(w, true); } // 浏览器加宽着：点别的卡片 = 回到叠放、把那一张露出来
        setCard(w, ck, !cardOn(ck));
        if (ck === "web" && cardOn("web")) setTimeout(function () { var u = ca.web.querySelector(".ca-url"); if (!curTab().url) u.focus(); }, 60);
        return refresh(w, true);
      }
      if (b && b.dataset.b === "more") moreMenu(w, b);
    });
    // 浏览器卡片：标签页（点 = 换过去，✕ / 中键 = 关，右键 = 菜单）、右上角、← → ⟳、手机宽度、新标签页上的网站、检测开发服务器
    ca.web.addEventListener("click", function (e) {
      var go = e.target.closest("[data-go]");
      if (go) return webGo(w, go.dataset.go);
      var b = e.target.closest("[data-w]"), tb = e.target.closest(".ca-tab"), k = b && b.dataset.w, t = curTab();
      if (k === "tabx" && tb) return closeTab(w, tabOf(tb.dataset.t));
      if (tb) return pickTab(w, tb.dataset.t);
      if (!k) return;
      if (k === "close") { setCard(w, "web", false); return refresh(w, true); }
      if (k === "max") { MAX = MAX === "web" ? "" : "web"; return refresh(w, true); }
      if (k === "wide") { WEB.wide = !WEB.wide; keep("st-claude-web-wide", WEB.wide); return refresh(w, true); }
      if (k === "more") return webMenu(w, b);
      if (k === "new") return newTabIn(w);
      if (k === "back" || k === "fwd") { if (native() && t.opened) N.call("web.nav", { id: t.id, action: k === "back" ? "back" : "forward" }).catch(function () {}); return; }
      if (k === "reload") { if (t.loading && native() && t.opened) { N.call("web.nav", { id: t.id, action: "stop" }).catch(function () {}); return; } return reloadTab(w, t); }
      if (k === "retry") return webGo(w, t.url, t);
      if (k === "device") { WEB.dev = !WEB.dev; keep("st-claude-web-dev", WEB.dev); paintWeb(w); return followWeb(w); }
      if (k === "detect") { WEB.devs = null; return scanDev(w); }
    });
    ca.web.addEventListener("auxclick", function (e) { var tb = e.button === 1 && e.target.closest(".ca-tab"); if (tb) { e.preventDefault(); closeTab(w, tabOf(tb.dataset.t)); } }); // 中键：关掉这个标签页
    ca.web.addEventListener("contextmenu", function (e) { var tb = e.target.closest(".ca-tab"); if (!tb) return; e.preventDefault(); webMenu(w, null, tabOf(tb.dataset.t), { x: e.clientX, y: e.clientY }); });
    ca.web.addEventListener("error", function (e) { var im = e.target; if (im && im.tagName === "IMG" && im.dataset.o) { favBad[im.dataset.o] = 1; im.outerHTML = IC.globe; } }, true); // 网站没有图标：换成地球，记住不再要
    var ui = ca.web.querySelector(".ca-url");
    ui.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); webGo(w, e.target.value); e.target.blur(); } else if (e.key === "Escape") { e.preventDefault(); e.target.value = curTab().url || ""; e.target.blur(); } e.stopPropagation(); });
    ui.addEventListener("focus", function () { var t = curTab(); if (t.url && ui.value !== t.url) ui.value = t.url; setTimeout(function () { if (document.activeElement === ui) ui.select(); }, 0); }); // 点进来：完整的地址、全选（同 Safari）
    [ca.web.querySelector(".ca-cardh"), ca.web.querySelector(".ca-webnav"), ca.acts].forEach(function (el) { el.addEventListener("pointerenter", function () { if (WEB.tabs.length) snap(curTab()); }); }); // 多半要开菜单了：先拍一张垫着
    new ResizeObserver(function () { placeWeb(w); }).observe(ca.web.querySelector(".ca-webvp"));
    // 面板在这个风格里是卡片：点标题行不折叠、按住标题行不拖动排序（卡片自己的按钮照常）
    var panel = w.el.querySelector(".st-panel");
    if (panel) ["click", "pointerdown"].forEach(function (t) { panel.addEventListener(t, function (e) { if (on() && e.target.closest(".st-pvh") && !e.target.closest("button")) { e.stopPropagation(); if (t === "pointerdown") e.preventDefault(); } }, true); });
  }
  function navGo(w, k) {
    if (k === "new") return openDraft(w); // 草稿：说了第一句话才真的建
    if (k === "finder") { S.openPage(w, "explorer", "agents"); return later(w); }
    if (k === "custom") { openSettings(w); return; }
    if (k === "more") { MORE = !MORE; keep("st-claude-more", MORE); return refresh(w, true); }
    if (k === "files") { S.openPage(w, "explorer", ""); return later(w); }
    if (k === "keys" && S.showPage) { S.showPage(w, "keys"); return later(w); }
  }
  function openSettings(w) { if (S.settings) S.settings(w, "general"); else if (S.floatPage) S.floatPage(w, "settings", null); } // 设置一律从「通用」进
  function openItem(w, kind, id) {
    if (!w.side) return;
    // Claude Code、Codex 的会话：用这个风格的外壳（图形界面）看它、接着说——不是开个终端跑 claude
    if (kind === "cc") { if (w.side.viewCC && window.TSU_CLAUDE) w.side.viewCC(id); else if (w.side.openCC) w.side.openCC(id); }
    else if (kind === "cx") { if (w.side.viewCX) w.side.viewCX(id); }
    else if (kind === "pi") { if (w.side.viewPI) w.side.viewPI(id); }
    else if (kind === "ty") { if (w.side.viewTY) w.side.viewTY(id); }
    else w.side.open(id);
    later(w);
  }
  var later = function (w) { setTimeout(function () { refresh(w, true); }, 30); };
  // ---- ← →：记下中间显示过的（会话、Agent Finder、File Finder、打网址开的页面……），同浏览器——后退、前进；关掉了的重新打开 ----
  function viewOf(p) {
    var pr = p && p.program;
    if (!pr) return null;
    if (pr.agentId) { var id = String(pr.agentId); return /^(c[cx]|pi):/.test(id) ? { k: "a:" + id, kind: id.slice(0, 2), id: id.slice(3) } : { k: "a:" + id, kind: "pm", id: id }; }
    if (pr.page) return { k: "p:" + pr.page + ":" + (pr.arg == null ? "" : String(pr.arg)), kind: "page", page: pr.page, arg: pr.arg };
    return null;
  }
  function navNote(w) {
    var p = w.ws && w.ws.active, v = viewOf(p);
    if (!v || v.k === NAV.cur) return;
    v.p = p;
    if (Date.now() < NAV.lock && NAV.list[NAV.pos]) { NAV.list[NAV.pos] = v; NAV.cur = v.k; return; } // ← → 自己开的：就是那一项（打开后的样子）
    NAV.list = NAV.list.slice(0, NAV.pos + 1);
    NAV.list.push(v);
    if (NAV.list.length > 60) NAV.list.shift();
    NAV.pos = NAV.list.length - 1;
    NAV.cur = v.k;
  }
  function navStep(w, d) {
    var i = NAV.pos + d, v = NAV.list[i];
    if (!v || !w) return;
    NAV.pos = i; NAV.cur = v.k; NAV.lock = Date.now() + 900;
    var open = w.ws && w.ws.all ? w.ws.all() : [];
    if (v.p && open.indexOf(v.p) >= 0 && w.ws.show) w.ws.show(v.p); // 还开着：切过去
    else if (v.kind === "pm" || isConnK(v.kind)) openItem(w, v.kind, v.id); // 关掉了：重新打开
    else S.openPage(w, v.page, v.arg);
    refresh(w, true);
    later(w);
  }
  // 会话的右键 / 标题 ⌄：固定、重命名、归档、在 Agent Finder 中显示、复制 ID
  // ---- 会话的菜单（行上的 ⋮、右键、标题 ⌄；同 Claude App）：打开位置 ›（拆分视图、新窗口；VS Code、访达）、固定、标为未读、重命名、分支、移到分组 ›、归档、删除。
  //      右边一列是菜单开着时按的字母（1 2 3 4 P U R F A D） ----
  var canWin = function () { return !!N && cmds.indexOf("window.new") >= 0; };
  var shq = function (p) { return "'" + String(p).replace(/'/g, "'\\''") + "'"; };
  // VS Code 装了没有（「打开位置 › VS Code」）：Spotlight 按 bundle id 找一次（只在这台 Mac 上）
  var VSCODE = "";
  (function () {
    var L = window.TSU_LOCAL;
    if (!L || !L.exec) return;
    var go = function () { L.exec({ cmd: "mdfind 'kMDItemCFBundleIdentifier == \"com.microsoft.VSCode\"' 2>/dev/null | head -n 1" }).then(function (r) { VSCODE = String((r && r.out) || "").trim().split("\n")[0] || ""; }, function () {}); };
    if (L.ready && L.ready.then) L.ready.then(go, go); else setTimeout(go, 1500);
  })();
  // 空的项去掉；后面没东西的小标题去掉；分隔线不打头、不收尾、不连着两条
  function tidy(list) {
    var a = list.filter(Boolean), out = [];
    a = a.filter(function (it, i) { if (!it.header) return true; var nx = a[i + 1]; return !!(nx && !nx.sep && !nx.header); });
    a.forEach(function (it) { if (it.sep && (!out.length || out[out.length - 1].sep)) return; out.push(it); });
    while (out.length && out[out.length - 1].sep) out.pop();
    return out;
  }
  var rowOf = function (w, id) { var r = null; w.ca.side.querySelectorAll(".ca-it").forEach(function (e) { if (!r && e.dataset.id === id) r = e; }); return r; };
  function itemMenu(w, kind, id, at, rowEl) {
    reloadExt();
    var A = Ag(), a = kind === "pm" && A ? A.get(id) : null, key = keyOf(kind, id), cur = activeAgent(w) === key, L = window.TSU_LOCAL;
    var local = !!(A && A.local && A.local() && L && L.exec), dir = "";
    if (a) { try { dir = String(A.runtime(id).home() || ""); } catch (e) { dir = ""; } }
    var openIn = function () {
      return tidy([
        { label: tr("拆分视图", "Split view"), acc: "1", disabled: cur, run: function () { splitWith(w, kind, id); } },
        a && canWin() ? { label: tr("新窗口", "New window"), acc: "2", run: function () { N.call("window.new", { open: JSON.stringify({ agent: id }) }).catch(function () {}); } } : null,
        { sep: true },
        { header: true, label: tr("用应用打开", "Open in") },
        a && local && dir && VSCODE ? { label: "Visual Studio Code", acc: "3", run: function () { L.exec({ cmd: "open -a " + shq(VSCODE) + " " + shq(dir) }).catch(function () {}); } } : null,
        a ? (local && dir ? { label: tr("访达", "Finder"), acc: "4", run: function () { L.exec({ cmd: "open " + shq(dir) }).catch(function () {}); } }
          : { label: "Agent Finder", acc: "4", run: function () { S.openPage(w, "explorer", id); later(w); } }) : null,
      ]);
    };
    if (rowEl) rowEl.classList.add("ca-mopen"); // 先亮起来（⋮ 出来）：菜单按它的位置开
    var M = S.menu(tidy([
      { label: tr("打开位置", "Open in"), items: openIn },
      kind === "cc" && window.TSU_CCINFO ? { label: tr("详情", "Details"), acc: "I", run: function () { TSU_CCINFO.open(id); } } : null, // 名字、ID、创建、工作时长、Token……（ccinfo.js）
      { sep: true },
      a && !a.archived ? { label: a.pinned ? tr("取消固定", "Unpin") : tr("固定", "Pin"), acc: "P", run: function () { A.pin(id, !a.pinned); later(w); } } : null,
      !a && isConnK(kind) ? { label: EXTS.pin[key] ? tr("取消固定", "Unpin") : tr("固定", "Pin"), acc: "P", run: function () { if (EXTS.pin[key]) delete EXTS.pin[key]; else EXTS.pin[key] = 1; saveExt(); refresh(w, true); } } : null,
      { label: UNREAD[key] ? tr("标为已读", "Mark as read") : tr("标为未读", "Mark as unread"), acc: "U", run: function () { if (UNREAD[key]) delete UNREAD[key]; else UNREAD[key] = 1; keep("st-claude-unread", UNREAD); refresh(w, true); } },
      a ? { label: tr("重命名", "Rename"), acc: "R", run: function () { renameInline(w, id, rowEl && rowEl.isConnected ? rowEl : rowOf(w, id)); } } : null,
      !a && kind === "pi" ? { label: tr("重命名", "Rename"), acc: "R", run: function () { piRename(w, id); } } : null,
      !a && (kind === "cc" || kind === "cx") ? { label: tr("重命名", "Rename"), acc: "R", run: function () {
        var r0 = rowEl && rowEl.isConnected ? rowEl : rowOf(w, id), cur0 = EXTS.name[key] || (r0 && r0.querySelector(".ca-name") ? r0.querySelector(".ca-name").textContent : "");
        dialog({ title: tr("重命名", "Rename"), value: cur0, ok: tr("好", "OK") }).then(function (v) { if (v == null) return; v = String(v).trim().slice(0, 80); if (v) EXTS.name[key] = v; else delete EXTS.name[key]; saveExt(); refresh(w, true); });
      } } : null,
      a ? { label: tr("分支", "Fork"), acc: "F", run: function () { forkIt(w, id); } } : null,
      { sep: true },
      a ? { label: tr("移到文件夹", "Move to folder"), items: function () { return groupItems(w, id); } } : null,
      { sep: true },
      !a && isConnK(kind) ? { label: EXTS.arch[key] ? tr("取消归档", "Unarchive") : tr("归档", "Archive"), acc: "A", run: function () { if (EXTS.arch[key]) delete EXTS.arch[key]; else EXTS.arch[key] = 1; saveExt(); refresh(w, true); } } : null,
      a ? (a.archived ? { label: tr("取消归档", "Unarchive"), acc: "A", run: function () { if (A.unarchive) A.unarchive(id); later(w); } }
        : { label: tr("归档", "Archive"), acc: "A", run: function () { A.archive(id); later(w); } }) : null,
      a ? { label: tr("删除", "Delete"), acc: "D", danger: true, run: function () { deleteIt(w, id); } } : null,
      !a && kind === "pi" && window.TSU_PI && TSU_PI.get(id) ? { label: tr("在访达中显示记录", "Reveal transcript in Finder"), run: function () { var x = TSU_PI.get(id); if (L && L.exec && x && x.path) L.exec({ cmd: "f=" + shq(x.path) + "; if [ \"$(uname)\" = Darwin ]; then open -R \"$f\"; else d=$(dirname \"$f\"); (xdg-open \"$d\" || gio open \"$d\") >/dev/null 2>&1; fi" }).catch(function () {}); } } : null,
    ]), at);
    // 菜单开着时这一行一直亮着、⋮ 一直在
    if (rowEl && M && M.el) { var t = setInterval(function () { if (!M.el.isConnected) { rowEl.classList.remove("ca-mopen"); clearInterval(t); } }, 150); }
    else if (rowEl) rowEl.classList.remove("ca-mopen");
  }
  // pi 的会话改名：同它的 /name，写进它自己的记录（pi.js 的 rename）；它在跑时先等它停下
  function piRename(w, id) {
    var PI = window.TSU_PI, x = PI && PI.get(id);
    if (!x || !PI.rename) return;
    var wait = function () { dialog({ title: tr("pi 正在用这段会话", "pi is using this session"), text: tr("等它停下再改名：pi 正在往这段会话的记录里写。", "Wait for it to stop, then rename it: pi is writing to this session's transcript."), buttons: [{ label: tr("好", "OK"), value: true, primary: true }] }); };
    if (PI.busy && PI.busy(id)) return wait();
    dialog({ title: tr("重命名", "Rename"), value: x.named ? x.title : "", ok: tr("好", "OK") }).then(function (v) {
      if (v == null) return;
      PI.rename(id, String(v)).then(function () { reloadExt(); delete EXTS.name["pi:" + id]; saveExt(); refresh(w, true); }, function (e) { if (e && e.busy) return wait(); dialog({ title: tr("没能改名", "Couldn't rename"), text: String(e && e.message || e), buttons: [{ label: tr("好", "OK"), value: true, primary: true }] }); });
    });
  }
  // 移到分组 ›：已有的组（勾着现在在的）、新建分组…、移出分组
  function groupItems(w, id) {
    var A = Ag(), cur = groupMap()[id] || "", names = A && A.folders && A.get(id) ? A.folders(A.volOf(id)) : groupNames(); // 它那个卷里所有的文件夹（空的也在）
    return tidy(names.map(function (n) { return { label: n.split("/").join(" / "), radio: true, close: true, checked: n === cur, run: function () { setGroup(id, n); refresh(w, true); } }; }).concat([
      { sep: true },
      { label: tr("新建文件夹…", "New folder…"), run: function () {
        dialog({ title: tr("新建文件夹", "New folder"), value: "", placeholder: tr("文件夹名称", "Folder name"), ok: tr("创建", "Create") }).then(function (v) { v = String(v == null ? "" : v).trim().slice(0, 40); if (v) { setGroup(id, v); refresh(w, true); } });
      } },
      cur ? { label: tr("移出文件夹", "Move out of folder"), run: function () { setGroup(id, null); refresh(w, true); } } : null,
    ]));
  }
  // 分支：新的 agent 带着到现在为止的对话，打开它；原来在哪个分组，它也在
  function forkIt(w, id) {
    var A = Ag(), nb = A && A.fork ? A.fork(id) : null;
    if (!nb) return;
    var g = groupMap()[id];
    if (g) setGroup(nb.id, g, true);
    openItem(w, "pm", nb.id);
  }
  // 删除：先问（同 Claude App 的对话框）；开着它的都关掉，未读、分组、← → 里的记录都拿掉；什么都没开着了就到新会话
  function deleteIt(w, id) {
    var A = Ag(), a = A && A.get(id);
    if (!a || !A.remove) return;
    dialog({ title: tr("删除「" + a.name + "」？", "Delete “" + a.name + "”?"), text: tr("这个会话会从你所有的设备上移除。", "This session will be removed from all your devices."), ok: tr("删除", "Delete"), danger: true }).then(function (ok) {
      if (!ok) return;
      var ws = w.ws;
      if (ws && ws.all) ws.all().filter(function (p) { return p.program && p.program.agentId != null && String(p.program.agentId) === id; }).forEach(function (p) { ws.closePane(p); });
      A.remove(id);
      if (UNREAD[id]) { delete UNREAD[id]; keep("st-claude-unread", UNREAD); }
      if (groupMap()[id]) setGroup(id, null);
      NAV.list = NAV.list.filter(function (v) { return v.k !== "a:" + id; });
      NAV.pos = Math.min(NAV.pos, NAV.list.length - 1);
      NAV.cur = NAV.list[NAV.pos] ? NAV.list[NAV.pos].k : "";
      if (ws && ws.all && !ws.all().length) openDraft(w);
      refresh(w, true);
    });
  }
  // ---- 拆分视图：当前这组的右边再开一组放这个会话，两组并排（这个风格平时只显示一组）；每组顶上一条：名字、✕（收起这一边：它的会话还开着，只是不并排了）----
  function paneOf(w, key) { var ps = w.ws && w.ws.all ? w.ws.all() : [], hit = null; ps.forEach(function (p) { var pr = p.program; if (!hit && pr && pr.agentId != null && String(pr.agentId) === key) hit = p; }); return hit; }
  function splitWith(w, kind, id) {
    var ws = w.ws, key = keyOf(kind, id), A = Ag();
    if (!ws || !ws.splitTo || !ws.moveTab || !ws.group || !ws.active) return openItem(w, kind, id);
    if (kind === "pm" && A) { var a = A.get(id); if (a && a.archived && A.unarchive) A.unarchive(id); }
    var pair = pairOf(w), p0 = paneOf(w, key);
    if (p0 === ws.active) return;
    if (pair) { // 已经并排着：放到另一边
      var other = pair[0] === ws.group ? pair[1] : pair[0];
      if (p0) ws.moveTab(p0, other, other.editors.length);
      else { if (other.active) ws.show(other.active); openItem(w, kind, id); }
      return later(w);
    }
    ws.splitTo("right"); // 右边一组，里面先是当前这个的另一个视图……
    var clone = ws.active, ng = ws.group;
    if (p0) { ws.moveTab(p0, ng, ng.editors.length); ws.closePane(clone); ws.show(p0); } // ……已经开着（藏在后面）：挪过去
    else openItem(w, kind, id); // ……换成这个会话
    SPLITON = true; keep("st-claude-split", true);
    later(w);
  }
  // 现在并排着的两组（左、右）：拆分视图开着、当前这组在一个左右拆分里、旁边也是一组
  function pairOf(w) {
    var ws = w.ws, g = ws && ws.group, el = g && g.el, par = el && el.parentNode;
    if (!SPLITON || !ws.groups || !par || !par.classList || !par.classList.contains("split") || !par.classList.contains("row")) return null;
    var sibEl = Array.prototype.filter.call(par.children, function (c) { return c !== el && c.classList.contains("tgroup"); })[0];
    var sib = sibEl ? ws.groups().filter(function (x) { return x.el === sibEl; })[0] : null;
    if (!sib || !sib.editors.length) return null;
    return par.firstElementChild === el ? [g, sib] : [sib, g];
  }
  function syncSplit(w) {
    var pair = pairOf(w), ws = w.ws;
    if (SPLITON && !pair && ws && ws.group && ws.group.el && ws.group.el.isConnected) { SPLITON = false; keep("st-claude-split", false); } // 不并排了（关掉了一边……）
    root.classList.toggle("ca-split", !!pair);
    w.el.querySelectorAll(".tgroup[data-ca-show]").forEach(function (e) { if (!pair || (e !== pair[0].el && e !== pair[1].el)) { e.removeAttribute("data-ca-show"); var h = e.querySelector(":scope > .ca-splith"); if (h) h.remove(); } });
    w.el.querySelectorAll(".split[data-ca-pair]").forEach(function (e) { if (!pair || e !== pair[0].el.parentNode) e.removeAttribute("data-ca-pair"); });
    if (!pair) return;
    pair[0].el.parentNode.setAttribute("data-ca-pair", "");
    pair.forEach(function (g) {
      g.el.setAttribute("data-ca-show", "");
      var h = g.el.querySelector(":scope > .ca-splith");
      if (!h) {
        h = document.createElement("div");
        h.className = "ca-splith";
        h.innerHTML = '<span class="ca-splitt"></span><button class="ca-ib" data-sx="1">' + IC.close + "</button>";
        g.el.insertBefore(h, g.body || null);
        h.querySelector("[data-sx]").addEventListener("click", function (e) { e.stopPropagation(); unsplit(w, g); });
      }
      var t = "", tg = "";
      try { t = g.active && g.active.title ? g.active.title() : ""; tg = g.active && g.active.program && g.active.program.titleTag ? g.active.program.titleTag() : ""; } catch (e) { t = ""; }
      var te = h.querySelector(".ca-splitt"), xb = h.querySelector("[data-sx]");
      if (te.textContent !== t + (tg ? " " + tg : "")) { te.textContent = t; if (tg) { var sm = document.createElement("small"); sm.className = "ttag"; sm.textContent = tg; te.appendChild(document.createTextNode(" ")); te.appendChild(sm); } } // 同名的会话带短 id
      if (xb.title !== tr("收起这一边", "Close this side")) xb.title = tr("收起这一边", "Close this side");
      h.classList.toggle("on", g === ws.group);
    });
  }
  // 收起一边：它那组的会话都挪到另一组里（还开着，藏在后面），另一边照旧显示
  function unsplit(w, drop) {
    var pair = pairOf(w), ws = w.ws;
    if (!pair) return;
    var keepG = pair[0] === drop ? pair[1] : pair[0], ka = keepG.active;
    drop.editors.slice().forEach(function (p) { ws.moveTab(p, keepG, keepG.editors.length); });
    if (ka) ws.show(ka);
    SPLITON = false; keep("st-claude-split", false);
    refresh(w, true);
  }
  function titleMenu(w, btn) {
    var aid = activeAgent(w);
    if (aid) return itemMenu(w, /^cc:/.test(aid) ? "cc" : "pm", aid.replace(/^cc:/, ""), { el: btn, side: "below" }, null);
    var p = w.ws && w.ws.active;
    S.menu([{ label: tr("关闭", "Close"), icon: (S.menuIcons() || {}).close, run: function () { if (p) w.ws.closePane(p); later(w); } }], { el: btn, side: "below" });
  }
  // 重命名：就在那一行里改（回车定、Esc 不改）；标题 ⌄ 里点的没有那一行：用系统的输入框
  function renameInline(w, id, rowEl) {
    var A = Ag(), a = A && A.get(id);
    if (!a) return;
    var done = function (v) { v = String(v || "").trim(); if (!v || v === a.name) return refresh(w, true); var err = A.runtime(id).rename(v); if (err) dialog({ title: tr("无法重命名", "Couldn't rename"), text: String(err), buttons: [{ label: tr("好", "OK"), value: true, primary: true }] }); refresh(w, true); };
    var nm = rowEl && rowEl.querySelector(".ca-name");
    if (!nm) return dialog({ title: tr("重命名会话", "Rename session"), value: a.name, ok: tr("重命名", "Rename") }).then(function (v) { if (v != null) done(v); });
    var inp = document.createElement("input");
    inp.className = "ca-ren"; inp.value = a.name; inp.spellcheck = false;
    nm.replaceWith(inp);
    inp.focus(); inp.select();
    var fin = false, finish = function (ok) { if (fin) return; fin = true; if (ok) done(inp.value); else refresh(w, true); };
    inp.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.preventDefault(); finish(false); } });
    inp.addEventListener("blur", function () { finish(true); });
    inp.addEventListener("click", function (e) { e.stopPropagation(); });
  }
  // 应用风格、语言：每个风格里都能换（点了才改）
  function osItems() { return (S.osModes || []).map(function (x) { return { label: x[1], radio: true, checked: (S.get("os") || "vscode") === x[0], run: function () { S.setv("os", x[0]); } }; }); }
  function langItems() { return [["auto", "跟随系统"], ["en", "English"], ["zh", "简体中文"]].map(function (x) { var cur = S.get("lang"); return { label: x[1], radio: true, checked: (cur === "en" || cur === "zh" ? cur : "auto") === x[0], run: function () { S.setv("lang", x[0]); if (window.TSU_I18N) TSU_I18N.set(x[0]); } }; }); }
  // 账户菜单（同 Claude App 的）：最上面一行灰字是 GitHub 账号（点它：设置 › 账号）；设置、用量、语言 ›；应用风格 ›、连接器、更新内容；退出登录。
  // 每一项一个自己的图标（同一个意思整个风格里用同一个）；没有「帮助」——还没有帮助文档
  var settingsAt = function (w, sec) { if (S.settings) S.settings(w, sec); else openSettings(w); };
  function acctMenu(w, el) {
    var A = Ag(), me = A && A.me ? A.me() || {} : {}, login = me.loggedIn !== false && me.login;
    S.menu([
      login ? { label: login, dim: true, flush: true, run: function () { settingsAt(w, "account"); } } : { label: tr("未登录", "Not signed in"), dim: true, flush: true, disabled: true }, // 设置里的「账号」那一页；下面紧接着就是「设置」（同 Claude：账号和第一项之间没有分隔线）
      { label: tr("设置", "Settings"), icon: IC.gear, value: "⌘,", run: function () { openSettings(w); } },
      login ? { label: tr("用量", "Usage"), icon: IC.gauge, run: function () { settingsAt(w, "usage"); } } : null, // 余额、Paimon 用了多少、Codex / Claude Code 的限额
      { label: tr("语言", "Language"), icon: IC.lang, items: langItems },
      { sep: true },
      { label: tr("应用风格", "Application Style"), icon: IC.os, items: osItems },
      { label: tr("连接器", "Connectors"), icon: IC.plug, run: function () { settingsAt(w, "connectors"); } }, // Paimon、Claude Code、Codex 开不开
      window.TSU_CHANGELOG ? { label: tr("更新内容", "What's New"), icon: IC.scroll, run: function () { TSU_CHANGELOG.open(w); } } : null,
      { sep: true },
      login ? { label: tr("退出登录", "Log out"), icon: IC.out, run: function () { location.href = "/auth/logout"; } }
        : { label: tr("使用 GitHub 登录…", "Sign in with GitHub…"), icon: IC.signin, run: function () { location.href = "/auth/login?next=" + encodeURIComponent(location.pathname + location.search); } },
    ].filter(Boolean), { el: el, side: "above" });
  }
  // 标题栏右边 ···：File Finder（只在这里）。Paimon 的 agent 没有工作目录，不再有「显示 / 拷贝工作目录」
  function moreMenu(w, el) {
    var ph = phone(w), tog = function (k, label, icon) { return { label: label, icon: icon, checked: cardOn(k), run: function () { var b = w.ca && w.ca.acts && w.ca.acts.querySelector('[data-c="' + k + '"]'); if (b) b.click(); } }; };
    S.menu([
      ph ? { label: tr("后退", "Back"), icon: IC.back || null, run: function () { var b = w.ca && w.ca.nav.querySelector('[data-b="back"]'); if (b) b.click(); } } : null,
      ph ? { label: tr("前进", "Forward"), icon: IC.fwd || null, run: function () { var b = w.ca && w.ca.nav.querySelector('[data-b="fwd"]'); if (b) b.click(); } } : null,
      ph ? { sep: true } : null,
      ph ? tog("tasks", tr("后台任务", "Background Tasks"), IC.tasks) : null,
      ph ? tog("term", tr("终端", "Terminal"), IC.term) : null,
      ph ? tog("web", tr("浏览器", "Browser"), IC.globe) : null,
      ph ? tog("global", tr("全局助手", "Studio Assistant"), IC.assist) : null,
      ph ? { sep: true } : null,
      { label: "File Finder", icon: IC.folder, run: function () { navGo(w, "files"); } },

    ].filter(Boolean), { el: el, side: "below-right" });
  }

  // ======== 设置：盖在整个窗口上的一张表单（里面怎么画在 studio.js：分组、图标、分段控件、代码预览都是它画好的，这里不再往里加东西——加了会闪）========
  // 表单外面（变暗的那片）点一下：关掉表单（同 Claude App）；菜单、下拉列表里点的不算
  document.addEventListener("pointerdown", function (e) {
    if (!on()) return;
    var f = document.querySelector(".st-float");
    if (!f || f.contains(e.target) || e.target.closest(".st-menu, .ss-ddlist, .st-palette, .st-pop")) return;
    var x = f.querySelector('[data-f="close"]');
    if (x) x.click();
  }, true);

  // ======== 对话框（同 Claude App：窗口变暗，中间一张圆角卡片）——这个风格里代替系统的 alert / confirm / prompt、桌面的提示框 ========
  //   o：{ title, text?, value?（有就带一个输入框）, placeholder?, ok?, cancel?, danger?, buttons?: [{ label, value, primary?, danger? }] }
  //   → Promise：点的那个按钮的 value（默认的「好」是 true；有输入框时是输入的字）；Esc、点外面 → null
  function dialog(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var hasIn = o.value !== undefined, bs = o.buttons || [{ label: o.cancel || tr("取消", "Cancel"), value: null }, { label: o.ok || tr("好", "OK"), value: true, primary: true, danger: !!o.danger }];
      var dim = document.createElement("div");
      dim.className = "ca-dlgdim";
      dim.innerHTML = '<div class="ca-dlg" role="dialog" aria-modal="true"><div class="ca-dlgt"></div>' + (o.text ? '<div class="ca-dlgx"></div>' : "") + (hasIn ? '<input class="ca-dlgin" type="text" spellcheck="false" autocomplete="off">' : "") +
        '<div class="ca-dlgb">' + bs.map(function (b, i) { return '<button class="ca-btn' + (b.primary ? " pri" : "") + (b.danger ? " dan" : "") + '" data-i="' + i + '">' + esc(b.label) + "</button>"; }).join("") + "</div></div>";
      dim.querySelector(".ca-dlgt").textContent = o.title || "";
      if (o.text) dim.querySelector(".ca-dlgx").textContent = o.text;
      var inp = dim.querySelector(".ca-dlgin");
      if (inp) { inp.value = o.value == null ? "" : String(o.value); if (o.placeholder) inp.placeholder = o.placeholder; }
      // 放进共用的模态层（STUDIO.modal）：底下整个 App 标成 inert（点不到、Tab 不到），焦点关掉时还回去，原生网页被盖住就藏起来
      var M = window.STUDIO && STUDIO.modal ? STUDIO.modal.open(dim, { cls: "ca-dlglayer", onBackdrop: function () { fin(null); } }) : (document.body.appendChild(dim), null);
      var back = M && M.back || document.activeElement, done = false;
      var fin = function (b) {
        if (done) return;
        done = true;
        dim.classList.add("out");
        setTimeout(function () { if (M) STUDIO.modal.close(M); else dim.remove(); }, 140);
        if (back && back.focus && document.contains(back)) back.focus();
        resolve(!b ? null : inp && b.value === true ? inp.value : b.value);
      };
      var pri = function () { return bs.filter(function (b) { return b.primary; })[0] || bs[bs.length - 1]; };
      dim.addEventListener("pointerdown", function (e) { if (e.target === dim) { e.preventDefault(); fin(null); } });
      dim.addEventListener("click", function (e) { var b = e.target.closest("[data-i]"); if (b) fin(bs[+b.dataset.i]); });
      dim.addEventListener("keydown", function (e) {
        e.stopPropagation();
        var f = dim.querySelectorAll("input, button"), i = Array.prototype.indexOf.call(f, document.activeElement);
        if (e.key === "Escape") { e.preventDefault(); fin(null); }
        else if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); var ab = document.activeElement && document.activeElement.closest && document.activeElement.closest(".ca-btn"); fin(ab ? bs[+ab.dataset.i] : pri()); }
        else if (e.key === "Tab" && f.length) { e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); } // 焦点只在对话框里转
      });
      void dim.offsetWidth; // 先排一次版再加 in：淡入照样有；不用 requestAnimationFrame（窗口被挡住时它不跑，对话框就一直是透明的）
      dim.classList.add("in");
      // 焦点：有输入框在输入框；危险的（删除）在「取消」上——顺手按的回车不会删掉东西；别的在主按钮上
      var cancelI = bs.findIndex(function (b) { return b.value == null; }), risky = bs.some(function (b) { return b.danger; });
      setTimeout(function () { var t = inp || (risky && cancelI >= 0 ? dim.querySelector('.ca-btn[data-i="' + cancelI + '"]') : null) || dim.querySelector(".ca-btn.pri") || dim.querySelector(".ca-btn"); if (t) t.focus(); if (inp) inp.select(); }, 0);
    });
  }
  // 桌面的提示框（TSU_DESK.alert：关掉还在跑的终端、…）：这个风格里画成上面的对话框
  (function hook(n) {
    var D = window.TSU_DESK;
    if (!D || !D.alert) { if (n < 100) setTimeout(function () { hook(n + 1); }, 100); return; }
    if (D.alert.caWrapped) return;
    var orig = D.alert;
    D.alert = function (o) {
      if (!on() || !o) return orig.apply(this, arguments);
      var list = (o.buttons && o.buttons.length ? o.buttons : [{ label: tr("好", "OK"), role: "default" }]);
      dialog({ title: o.title || "", text: o.message || "", buttons: list.map(function (b, i) { return { label: b.label, value: i, primary: b.role === "default", danger: /终止|删除|Terminate|Delete/.test(b.label || "") }; }) })
        .then(function (i) { var b = i == null ? list.filter(function (x) { return x.role === "cancel"; })[0] : list[i]; if (b && b.run) b.run(); });
    };
    D.alert.caWrapped = true;
  })(0);

  // ======== 边栏收起来时「偷看」（同 Claude App）：指着标题栏的边栏按钮一会儿（200ms）或窗口最左边那一条（6px，150ms），边栏浮出来盖在上面——
  //   不挤中间、右边圆角、有影子；指针离开它 300ms 后滑回去（菜单、对话框开着，搜索框里在打字时不收）；在里面点了会话：打开它、收回去；点边栏按钮：钉住（正常打开） ========
  var PEEK = { on: false, inside: false, t: 0, out: 0 };
  function peekOpen() {
    var w = front();
    if (!on() || !w || !w.ca || !sideHidden(w)) return;
    clearTimeout(PEEK.out);
    if (PEEK.on) return;
    PEEK.on = true;
    root.classList.add("ca-peek");
    reframe(w); // 原生的网页视图被盖住的话让开
  }
  function peekClose(now) {
    clearTimeout(PEEK.t); clearTimeout(PEEK.out);
    if (!PEEK.on) return;
    var go = function () {
      if (!now && PEEK.inside) return; // 指针又回来了
      var busy = document.querySelector(".st-menu, .ca-dlgdim") || (document.activeElement && document.activeElement.matches && document.activeElement.matches(".ca-side input") && document.activeElement.value);
      if (!now && busy) { PEEK.out = setTimeout(go, 400); return; }
      PEEK.on = false;
      root.classList.remove("ca-peek");
      var w = front(); if (w && w.ca) reframe(w);
    };
    if (now) go(); else PEEK.out = setTimeout(go, 300);
  }
  function peekSoon(ms) { clearTimeout(PEEK.t); clearTimeout(PEEK.out); PEEK.t = setTimeout(peekOpen, ms); }
  // 窗口最左边那一条（标题栏下面）：边栏收着时才有
  var EDGE = document.createElement("div");
  EDGE.className = "ca-edge";
  EDGE.addEventListener("pointerenter", function () { var w = front(); if (on() && w && w.ca && sideHidden(w) && !PEEK.on) peekSoon(150); });
  EDGE.addEventListener("pointerleave", function () { if (!PEEK.on) clearTimeout(PEEK.t); });
  (document.body || document.documentElement).appendChild(EDGE);
  // ⌘B：边栏收起 / 打开（同 Claude App；自带侧栏的页上是这一次打开）。先接住，不让它去开关 VS Code 的主侧栏
  window.addEventListener("keydown", function (e) {
    if (!on() || !e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.code !== "KeyB") return;
    var w = front();
    if (!w || !w.ca) return;
    e.preventDefault(); e.stopPropagation();
    toggleSide(w);
  }, true);

  // ======== 边栏、右边卡片那一列的宽度：按住边上那条缝拖（同 Claude App）。边栏 200–480px（不超过窗口的 40%）；卡片那一列至少 260px、给对话留 420px；
  //   记在这台设备上（卡片一两张、三张以上各记一个）；双击那条缝回到默认；拖的时候不选字，原生的网页视图先让开 ========
  var SIDEW = +store("st-claude-side-w", 0) || 0, CARDW = store("st-claude-cards-w", {}) || {};
  function applyWidths() {
    if (SIDEW) root.style.setProperty("--ca-side-user", SIDEW + "px"); else root.style.removeProperty("--ca-side-user");
    ["cw1", "cw2"].forEach(function (k) { if (CARDW[k]) root.style.setProperty("--ca-" + k, CARDW[k] + "px"); else root.style.removeProperty("--ca-" + k); });
  }
  applyWidths();
  var cardSlot = function () { return root.classList.contains("ca-n1") || root.classList.contains("ca-n2") ? "cw1" : "cw2"; }; // 卡片一两张（一列）、三张以上（两列）
  // 右边卡片那一列现在实际多宽：量出来放在 --ca-col-w（标题栏里它那一段的底色和细线、中间标题行的右边界照它；拖的时候、窗口变了都跟着量）
  function syncColW(w) {
    var pnl = w.el.querySelector(".tlab.st-grid > .st-panel"), cw = CARD_IDS.some(cardOn) && pnl && pnl.offsetParent ? Math.round(pnl.getBoundingClientRect().width) : 0;
    if (root.style.getPropertyValue("--ca-col-w") !== cw + "px") root.style.setProperty("--ca-col-w", cw + "px");
  }
  var wT = 0;
  function sash(w, el, kind) {
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* 不是真指针 */ }
      var slot = kind === "cards" ? cardSlot() : "";
      root.classList.add("ca-resizing"); el.classList.add("drag");
      if (WEB.tabs.length) snap(curTab());
      reframe(w); // 原生的网页视图先藏起来（不然指针划过它时事件被它吃了；底下垫着它刚才的样子）
      var move = function (ev) {
        if (kind === "side") {
          var left = w.ca.side.getBoundingClientRect().left;
          SIDEW = Math.round(Math.max(200, Math.min(Math.min(480, innerWidth * 0.4), ev.clientX - left)));
        } else {
          var lab = w.el.querySelector(".tlab.st-grid"), r = lab ? lab.getBoundingClientRect() : null;
          if (!r) return;
          CARDW[slot] = Math.round(Math.max(260, Math.min(Math.max(260, r.width - 420), r.right - ev.clientX))); // 对话那一列至少留 420px（输入框下面那一排放得下）
        }
        applyWidths();
        syncColW(w);
      };
      var up = function () {
        el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
        root.classList.remove("ca-resizing"); el.classList.remove("drag");
        if (kind === "side") keep("st-claude-side-w", SIDEW); else keep("st-claude-cards-w", CARDW);
        clearTimeout(wT); wT = setTimeout(function () { reframe(w); if (S.fitTerms) S.fitTerms(w); }, 30);
      };
      el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    });
    el.addEventListener("dblclick", function (e) {
      e.preventDefault();
      if (kind === "side") { SIDEW = 0; keep("st-claude-side-w", 0); } else { delete CARDW[cardSlot()]; keep("st-claude-cards-w", CARDW); }
      applyWidths();
      clearTimeout(wT); wT = setTimeout(function () { reframe(w); if (S.fitTerms) S.fitTerms(w); }, 30);
    });
  }
  // 两条缝：边栏的右边、卡片那一列的左边（网格里和卡片同一格、贴着左边）；工作台重建过就再放一次
  function ensureSashes(w) {
    if (!w.ca.side.querySelector(":scope > .ca-sash-side")) { var s1 = document.createElement("div"); s1.className = "ca-sash ca-sash-side"; w.ca.side.appendChild(s1); sash(w, s1, "side"); }
    var lab = w.el.querySelector(".tlab.st-grid");
    if (lab && !lab.querySelector(":scope > .ca-sash-cards")) { var s2 = document.createElement("div"); s2.className = "ca-sash ca-sash-cards"; lab.appendChild(s2); sash(w, s2, "cards"); }
  }

  // ======== 刷新：卡片、边栏、标题栏；看得见的才画，画的东西没变就不动 DOM ========
  var raf = 0;
  function refresh(w, now) {
    // 菜单开着（账户菜单、会话菜单……）：边栏、卡片先不重画，等菜单关了再画——一边重画一边指菜单，指到哪一行都要等一下才亮（卡）
    if (!now) { if (raf) return; raf = setTimeout(function go() { if (S.menuOpen && S.menuOpen()) { raf = setTimeout(go, 250); return; } raf = 0; refresh(front(), true); }, 16); return; } // 不用 requestAnimationFrame：窗口被挡住时它不跑
    w = w || front();
    if (!w) return;
    reloadExt(); // 那棵树（live.js）可能刚改过固定、改名、未读
    if (!on()) {
      root.classList.remove("ca-c-term", "ca-c-tasks", "ca-c-web", "ca-c-files", "ca-c-global", "ca-max-term", "ca-max-tasks", "ca-max-web", "ca-max-files", "ca-max-global", "ca-wide-web", "ca-side-off", "ca-n0", "ca-n1", "ca-n2", "ca-n3", "ca-n4", "ca-n5", "ca-peek", "ca-resizing");
      LAYSIG = "";
      PEEK.on = false;
      if (w.ws && w.ws.all) w.ws.all().filter(function (p) { return p.program && p.program.page === "ca-new"; }).forEach(function (p) { w.ws.closePane(p); }); // 新会话的草稿只在这个风格里有
      if (w.caWas) { // 刚从这个风格换走：面板里的视图回到原来的排法和标题行（右边的按钮拿掉、提示里的快捷键回来）
        w.caWas = false;
        w.el.querySelectorAll(".st-panel .st-pv").forEach(function (pv) {
          pv.style.order = ""; pv.removeAttribute("data-ca-slot");
          if (pv._caActs && pv._caActs.parentNode) pv._caActs.remove();
        });
        restoreKeyHints(w.el);
      }
      if (w.ca) placeWeb(w); syncTermTheme(w); return;
    }
    var ca = build(w);
    if (!ca) return;
    if (!w.caWas && S.familyChanged) setTimeout(function () { try { S.familyChanged(); } catch (e) { /* 下一轮它自己会同步 */ } }, 0); // 刚换到这个风格：studio 的面板马上按这个风格重排（它的「Agent 那一层」不在这里出现）
    w.caWas = true;
    if (VISIT.k && VISIT.k !== viewKey(w)) VISIT = { k: "", open: false }; // 离开了那一页：「这一次打开」不算了
    var hid = sideHidden(w);
    root.classList.toggle("ca-side-off", hid); // 自己收起来的，或者中间是自带侧栏的页（Agent Finder、File Finder）
    if (!hid && PEEK.on) peekClose(true); // 边栏正常打开了：不用再偷看
    ensureSashes(w);
    navNote(w); // 中间换了显示的：记下来（← →）
    var ap = w.ws && w.ws.active;
    if (ap && ap.program && ap.program.page === "ca-new" && ap.el && ap.el.querySelector(".ca-new")) paintDraft(ap.el); // 草稿：名字、语言、模型跟着变
    syncCards(w);
    syncColW(w); // 卡片那一列实际多宽（标题栏里它那一段、中间标题行的右边界）
    syncSplit(w); // 拆分视图：并排的两组
    syncTermTheme(w);
    paintTop(w); paintList(w); paintAcct(w); paintBar(w); paintWeb(w);
    stripKeyHints(w.el); // 提示里不写快捷键
    placeWeb(w);
    // 布局变了（全屏、加宽、开着几张卡片、边栏开关）：原生的网页视图接下来一小会儿每一帧都贴着量；刚进全屏时焦点不留在被盖住的地方（不然 Esc 给了底下的输入框）
    var sig = [MAX, root.className.match(/\bca-(?:n\d|side-off|wide-web|peek)\b/g)].join("|");
    if (sig !== LAYSIG) {
      var enter = !!MAX && LAYSIG.split("|")[0] !== MAX;
      LAYSIG = sig; followWeb(w);
      var mc = enter ? maxEl(w) : null, ae = document.activeElement;
      if (mc && ae && ae !== document.body && !mc.contains(ae) && ae.blur) ae.blur();
    }
  }
  var LAYSIG = "";
  setInterval(function () { refresh(null); }, 700);
  // 全屏的卡片：Esc 退出（菜单、对话框开着时先收它们；焦点在那张卡片里的输入框、终端里时不管——Esc 是给它们的）
  var maxEl = function (w) { return MAX === "web" ? w.ca.web : MAX === "files" ? w.ca.files : MAX === "global" ? w.ca.gcard : MAX ? w.el.querySelector('.st-panel .st-pv[data-v="' + MAX + '"]') : null; };
  window.addEventListener("keydown", function (e) {
    if (!on() || !MAX || e.key !== "Escape" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (document.querySelector(".st-menu, .ca-dlgdim, .st-palette, .ca-sheetdim")) return;
    var w = front(), card = w && w.ca ? maxEl(w) : null, a = document.activeElement;
    if (!card) return;
    if (a && a !== document.body && card.contains(a) && (a.matches("input, textarea, select, [contenteditable]") || a.closest(".xterm"))) return;
    e.preventDefault();
    MAX = ""; refresh(w, true);
  });
  document.addEventListener("st-avatar", function () { refresh(null); }); // 设置里改了名字：左下角的头像跟着换
  // ⌘[ ⌘]：后退 / 前进（页面自己先接——访达里有它自己的后退就用它的）；鼠标的侧键同样
  window.addEventListener("keydown", function (e) {
    if (!on() || e.defaultPrevented || !e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || (e.code !== "BracketLeft" && e.code !== "BracketRight")) return;
    var w = front();
    if (!w || !w.ca) return;
    e.preventDefault();
    navStep(w, e.code === "BracketLeft" ? -1 : 1);
  });
  window.addEventListener("mouseup", function (e) { if (on() && (e.button === 3 || e.button === 4)) { var w = front(); if (w && w.ca) { e.preventDefault(); navStep(w, e.button === 3 ? -1 : 1); } } });
  if (window.MutationObserver) new MutationObserver(function (ms) {
    if (!on()) return;
    for (var i = 0; i < ms.length; i++) { var t = ms[i].target; if (t.nodeType === 1 && (t.classList.contains("st-pg-settings") || t.closest && t.closest(".st-float, .st-pg-settings"))) { refresh(null); return; } }
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("st-settings-changed", function () { refresh(null); });
  if (window.TSU_I18N && TSU_I18N.onChange) TSU_I18N.onChange(function () { var w = front(); if (w && w.ca) { ["nav", "ttl", "acts"].forEach(function (k) { w.ca[k].dataset.h = ""; }); } refresh(null); });
  if (Ag() && Ag().on) Ag().on(function () { refresh(null); });
  window.addEventListener("resize", function () { var w = front(); if (w && w.ca) { reframe(w); refresh(w, true); } }); // 窗口变了：卡片那一列的宽度、太窄时边栏收起来都跟上
  // 表单开着、菜单弹出来时原生的网页视图让开
  setInterval(function () { var w = front(); if (w && w.ca && on()) placeWeb(w); }, 400);
  window.TSU_CLAUDEAPP = { refresh: function () { refresh(null); }, dialog: dialog,
    open: function (u) { var w = front(); if (w && build(w)) { setCard(w, "web", true); var t = curTab(); if (t.url) t = addTab(); webGo(w, u, t); refresh(w, true); } }, // Agent 开网页：当前标签页有东西就开一个新的，不盖掉人正在看的
    web: function () { return { cur: WEB.cur, dev: WEB.dev, wide: WEB.wide, tabs: WEB.tabs.map(function (t) { return { id: t.id, url: t.url, title: t.title, loading: t.loading, err: t.err, frame: t.frame }; }) }; }, // 浏览器卡片现在开着哪些页（给 Agent、测试看）
    newSession: function () { var w = front(); return w && on() && build(w) ? openDraft(w) : null; } }; // 别处的「新建会话」在这个风格里也走草稿
})();
