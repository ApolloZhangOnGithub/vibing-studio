// reminders.js —— 提醒事项（同 macOS 26）
// 数据：~/Library/Reminders/<列表名>.json，一个列表一个文件（格式见那个文件夹里的 README.md）。agent 用自己的文件工具读写，App 马上跟着变；
//   App 改之前先重读文件、只动改到的那几条（按 id 合并），不会冲掉别人刚写进去的；文件写坏了只读不写，改好了自动恢复
// 界面：侧边栏（搜索、今天 / 计划 / 全部 / 旗标 / 已完成五张卡片、我的列表）+ 列表（圆形勾选框、就地编辑、子任务、截止日期、优先级、旗标、URL、标签）
//   + 简介浮层（ⓘ）；「今天」按上午 / 下午 / 今晚分组，「计划」按日子分组；到时间发通知，Dock 图标上是过期 + 今天的个数
(function () {
  "use strict";
  var K = window.TSU_APPKIT;
  if (!K) return;
  var FS = K.FS, D = K.D, esc = K.esc, ICON = K.ICON;
  var APP = "reminders", NAME = "提醒事项", DIR = FS.HOME + "/Library/Reminders";
  var TZ = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; } })();

  var README = [
    "# 提醒事项",
    "",
    "「提醒事项」App 的数据就是这个文件夹：**一个列表一个 JSON 文件**（`<列表名>.json`）。App 开着时，这里的改动马上显示出来；App 里的改动也马上写回这里。",
    "",
    "```json",
    "{",
    '  "name": "购物",',
    '  "color": "orange",',
    '  "icon": "cart",',
    '  "order": 1,',
    '  "reminders": [',
    '    { "id": "r-1a2b3c", "title": "买牛奶", "notes": "全脂的", "done": false, "due": "2026-09-27T09:00", "priority": 2, "flagged": true },',
    '    { "id": "r-4d5e6f", "title": "低脂的也行", "done": false, "parent": "r-1a2b3c" },',
    '    { "id": "r-7g8h9i", "title": "面包", "done": true, "doneAt": "2026-09-26T18:20" }',
    "  ]",
    "}",
    "```",
    "",
    "## 列表",
    "",
    "| 字段 | 说明 |",
    "|---|---|",
    "| `name` | 列表名（不写就用文件名） |",
    "| `color` | `red` `orange` `yellow` `green` `mint` `cyan` `blue` `indigo` `purple` `pink` `brown` `gray`，或 `#RRGGBB` |",
    "| `icon` | 可选：`list` `bookmark` `pin` `gift` `cart` `house` `briefcase` `book` `star` `heart` `leaf` `airplane` `dumbbell` `graduation` `music` `pills` `fork`，或一个 emoji |",
    "| `order` | 侧边栏里的顺序，小的在前 |",
    "| `reminders` | 提醒事项。**数组的顺序就是显示的顺序**，子任务跟在父项后面 |",
    "",
    "## 提醒事项",
    "",
    "| 字段 | 说明 |",
    "|---|---|",
    "| `id` | 唯一的字符串。新建时可以不写，App 下次保存这个文件时补上 |",
    "| `title` | 标题 |",
    "| `notes` | 备注（可选） |",
    "| `done` | 完成了没有；`doneAt` 是完成的时间 |",
    "| `due` | 截止（可选）：`YYYY-MM-DD`（只有日期，当天 9:00 通知）或 `YYYY-MM-DDTHH:MM`（到点通知）。**本地时间" + (TZ ? "，时区 " + TZ : "") + "** |",
    "| `early` | 提前提醒（可选）：提前几分钟再通知一次 |",
    "| `priority` | 0 无、1 低（!）、2 中（!!）、3 高（!!!） |",
    "| `flagged` | 旗标 |",
    "| `url` | 链接（可选） |",
    "| `repeat` | 重复（可选）：iCalendar 的 RRULE，如 `FREQ=DAILY`、`FREQ=WEEKLY;BYDAY=MO,WE`、`FREQ=MONTHLY;INTERVAL=3`；也认 `daily` `weekdays` `weekends` `weekly` `biweekly` `monthly` `yearly`。完成一个重复的提醒事项时，它的截止挪到下一次，另记一条已完成的 |",
    "| `parent` | 子任务：父项的 `id`（只有一层） |",
    "| `tags` | 标签（可选），如 `[\"家\"]` |",
    "| `created` | 创建时间 |",
    "",
    "## 约定",
    "",
    "- 新建列表 = 新建一个 `.json` 文件；删除列表 = 把文件移到废纸篓（`~/.Trash`），不要直接删",
    "- 改的时候请保留你不认识的字段；App 也会保留你加的字段",
    "- 文件写坏了（不是合法的 JSON）：App 把这个列表标成读不了，不会覆盖它；改好就恢复",
    "- App 按 `id` 合并：你改一条、App 同时改另一条，两边都不丢",
    "",
  ].join("\n");

  // ======== 颜色、图标 ========
  var COLORS = [["red", "红色", "#ff3b30", "#ff453a"], ["orange", "橙色", "#ff9500", "#ff9f0a"], ["yellow", "黄色", "#ffcc00", "#ffd60a"], ["green", "绿色", "#34c759", "#30d158"],
    ["mint", "薄荷绿", "#00c7be", "#63e6e2"], ["cyan", "浅蓝色", "#32ade6", "#64d2ff"], ["blue", "蓝色", "#007aff", "#0a84ff"], ["indigo", "靛蓝色", "#5856d6", "#5e5ce6"],
    ["purple", "紫色", "#af52de", "#bf5af2"], ["pink", "粉色", "#ff2d55", "#ff375f"], ["brown", "棕色", "#a2845e", "#ac8e68"], ["gray", "灰色", "#8e8e93", "#98989d"]];
  function hex(c) {
    var hit = COLORS.find(function (x) { return x[0] === c; });
    if (hit) return K.light() ? hit[2] : hit[3];
    return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c || "") ? c : K.light() ? "#007aff" : "#0a84ff";
  }
  var SMART_C = { today: ["#007aff", "#0a84ff"], scheduled: ["#ff3b30", "#ff453a"], all: ["#3a3a3c", "#8e8e93"], flagged: ["#ff9500", "#ff9f0a"], completed: ["#8e8e93", "#8e8e93"] };
  var smartHex = function (k) { return SMART_C[k][K.light() ? 0 : 1]; };
  var W = 'fill="#fff"';
  var GLYPH = {
    list: '<g ' + W + '><circle cx="5.4" cy="6" r="1.45"/><circle cx="5.4" cy="10" r="1.45"/><circle cx="5.4" cy="14" r="1.45"/><rect x="8.2" y="5.15" width="7.4" height="1.7" rx=".85"/><rect x="8.2" y="9.15" width="7.4" height="1.7" rx=".85"/><rect x="8.2" y="13.15" width="7.4" height="1.7" rx=".85"/></g>',
    bookmark: '<path ' + W + ' d="M6.2 3.4h7.6c.6 0 1 .4 1 1v12.2L10 13.5l-4.8 3.1V4.4c0-.6.4-1 1-1z"/>',
    pin: '<path ' + W + ' fill-rule="evenodd" d="M10 2.6a5.1 5.1 0 0 1 5.1 5.1c0 3.7-5.1 9.7-5.1 9.7S4.9 11.4 4.9 7.7A5.1 5.1 0 0 1 10 2.6zm0 3.1a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>',
    gift: '<g ' + W + '><rect x="3.6" y="7.2" width="12.8" height="3" rx=".7"/><rect x="4.6" y="11" width="10.8" height="5.8" rx=".7"/><path d="M10 7.2C8.6 3.6 5.6 3.8 5.6 5.5c0 1.4 2.2 1.7 4.4 1.7zm0 0c1.4-3.6 4.4-3.4 4.4-1.7 0 1.4-2.2 1.7-4.4 1.7z"/></g><path d="M10 7v10" stroke="currentColor" stroke-width="1.3"/>',
    cart: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.8 4h2l1.9 8.4h7.9l1.6-6H6"/></g><g ' + W + '><circle cx="7.6" cy="15.2" r="1.35"/><circle cx="13.8" cy="15.2" r="1.35"/></g>',
    house: '<path ' + W + ' d="M10 3.2 2.8 9.6h2v6.6c0 .4.3.7.7.7h3.3v-4.4h2.4v4.4h3.3c.4 0 .7-.3.7-.7V9.6h2z"/>',
    briefcase: '<g ' + W + '><path d="M7.4 5.6V4.5c0-.6.4-1 1-1h3.2c.6 0 1 .4 1 1v1.1h-1.4v-.8H8.8v.8z"/><rect x="2.8" y="6.2" width="14.4" height="10" rx="1.6"/></g><path d="M2.9 10.4h14.2" stroke="currentColor" stroke-width="1.1"/>',
    book: '<g ' + W + '><path d="M9.3 5.4C7.6 4.2 5.3 3.9 3 4.3v10.9c2.3-.4 4.6-.1 6.3 1.1z"/><path d="M10.7 5.4c1.7-1.2 4-1.5 6.3-1.1v10.9c-2.3-.4-4.6-.1-6.3 1.1z"/></g>',
    star: '<path ' + W + ' d="m10 2.8 2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5L2.8 8l5-.6z"/>',
    heart: '<path ' + W + ' d="M10 16.6S3 12.3 3 7.6a3.7 3.7 0 0 1 7-1.7 3.7 3.7 0 0 1 7 1.7c0 4.7-7 9-7 9z"/>',
    leaf: '<path ' + W + ' d="M16.6 3.4C8.6 3.2 4.2 7 4.4 12.6c0 .9.2 1.7.5 2.4l-1.4 1.5 1 .9 1.4-1.5c.8.5 1.8.8 2.9.8 5.3 0 8-5 7.8-13.3zM7.2 14l5.2-6.1-.7-.6-5.4 5.9z"/>',
    airplane: '<path ' + W + ' d="M17.3 9.2 11.2 6 10.8 3c-.1-.9-1.5-.9-1.6 0L8.8 6 2.7 9.2v1.6l6.1-1.6.3 4.4-1.9 1.6v1.2l2.8-.8 2.8.8v-1.2l-1.9-1.6.3-4.4 6.1 1.6z"/>',
    dumbbell: '<g ' + W + '><rect x="2.4" y="7.4" width="2.2" height="5.2" rx=".8"/><rect x="4.8" y="5.8" width="2.4" height="8.4" rx=".9"/><rect x="12.8" y="5.8" width="2.4" height="8.4" rx=".9"/><rect x="15.4" y="7.4" width="2.2" height="5.2" rx=".8"/><rect x="7" y="9.1" width="6" height="1.8"/></g>',
    graduation: '<g ' + W + '><path d="M10 3.6 1.8 7.8 10 12l8.2-4.2z"/><path d="M5.2 10.1v3.6c1.2 1.3 2.9 2 4.8 2s3.6-.7 4.8-2v-3.6L10 12.6z"/><rect x="16.4" y="8.2" width="1.2" height="5.6" rx=".6"/></g>',
    music: '<path ' + W + ' d="M15.8 3v9.6a2.4 2.4 0 1 1-1.5-2.2V6.3L8.2 7.7v6.6a2.4 2.4 0 1 1-1.5-2.2V5.2z"/>',
    pills: '<g transform="rotate(-45 10 10)"><rect x="3.4" y="7.1" width="13.2" height="5.8" rx="2.9" ' + W + '/><path d="M10 7.2v5.6" stroke="currentColor" stroke-width="1.3"/></g>',
    fork: '<g ' + W + '><path d="M5 2.8h1v4.1h.8V2.8h1v4.1h.8V2.8h1v4.8c0 1-.6 1.8-1.6 2v7.4c0 .5-.4.9-.9.9s-.9-.4-.9-.9V9.6C5.6 9.4 5 8.6 5 7.6z"/><path d="M13.9 2.8c1.4 0 2.3 2 2.3 4.6 0 1.8-.6 2.8-1.4 3.1v6.5c0 .5-.4.9-.9.9s-.9-.4-.9-.9V2.9c.3-.1.6-.1.9-.1z"/></g>',
  };
  var GLYPH_KEYS = Object.keys(GLYPH);
  // 列表图标：有颜色的圆 + 白色的图形；icon 是 emoji 时只显示 emoji
  function listIcon(L, cls) {
    var ic = L.icon || "list";
    if (!GLYPH[ic]) return '<span class="rm-lico rm-emo ' + (cls || "") + '">' + esc(String(ic).slice(0, 4)) + "</span>";
    return '<span class="rm-lico ' + (cls || "") + '" style="background:' + hex(L.color) + ";color:" + hex(L.color) + '"><svg viewBox="0 0 20 20">' + GLYPH[ic] + "</svg></span>";
  }
  var SMART = [["today", "今天"], ["scheduled", "计划"], ["all", "全部"], ["flagged", "旗标"], ["completed", "已完成"]];
  var smartName = function (k) { return (SMART.find(function (s) { return s[0] === k; }) || [0, ""])[1]; };
  function smartIcon(k) {
    var g = {
      today: '<rect x="4.2" y="4.6" width="11.6" height="11" rx="2.2" fill="#fff"/><rect x="4.2" y="4.6" width="11.6" height="3" rx="1.2" fill="#fff"/><text x="10" y="14.3" text-anchor="middle" font-family="-apple-system,Helvetica" font-size="7.2" font-weight="700" fill="currentColor">' + new Date().getDate() + "</text>",
      scheduled: '<rect x="4.2" y="4.6" width="11.6" height="11" rx="2.2" fill="#fff"/><g fill="currentColor"><rect x="4.2" y="7.4" width="11.6" height="1"/><circle cx="7.3" cy="10.6" r=".9"/><circle cx="10" cy="10.6" r=".9"/><circle cx="12.7" cy="10.6" r=".9"/><circle cx="7.3" cy="13.2" r=".9"/><circle cx="10" cy="13.2" r=".9"/></g>',
      all: '<path d="M3.8 10.8h3.4l.9 1.8h3.8l.9-1.8h3.4v4c0 .6-.4 1-1 1H4.8c-.6 0-1-.4-1-1zM5.5 4.4h9l1.7 5.4h-3.8l-.9 1.8H8.5l-.9-1.8H3.8z" fill="#fff"/>',
      flagged: '<path d="M6.2 16.2V4.2c2.9-1.5 5.4 1.3 8.4 0v6.6c-3 1.3-5.5-1.5-8.4 0" fill="#fff" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>',
      completed: '<path d="m5.6 10.3 3 3 5.8-6.4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    }[k];
    return '<span class="rm-cico" style="background:' + smartHex(k) + ";color:" + smartHex(k) + '"><svg viewBox="0 0 20 20">' + g + "</svg></span>";
  }
  var DOCK_ICON = '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true"><rect width="100" height="100" fill="#fff"/>' +
    [["#0a84ff", 27], ["#ff3b30", 50], ["#ff9500", 73]].map(function (x) {
      return '<circle cx="26" cy="' + x[1] + '" r="8.2" fill="none" stroke="' + x[0] + '" stroke-width="3.2"/><circle cx="26" cy="' + x[1] + '" r="4.6" fill="' + x[0] + '"/>' +
        '<rect x="41" y="' + (x[1] - 2.4) + '" width="40" height="4.8" rx="2.4" fill="#d6d6db"/>';
    }).join("") + "</svg>";

  // ======== 数据 ========
  var store = K.dataDir(DIR, README);
  var lists = []; // 侧边栏的顺序
  var LIST_KEYS = ["name", "title", "color", "icon", "order", "reminders", "items", "tasks"];
  var REM_KEYS = ["id", "title", "name", "text", "notes", "note", "body", "description", "done", "completed", "isCompleted", "checked", "doneAt", "completedAt", "completionDate",
    "due", "dueDate", "date", "deadline", "early", "priority", "flagged", "flag", "url", "link", "repeat", "rrule", "recurrence", "parent", "parentId", "tags", "created", "createdAt"];
  var base = function (p) { return p.slice(p.lastIndexOf("/") + 1); };
  var stem = function (p) { return base(p).replace(/\.json$/i, ""); };
  var str = function (v) { return v == null ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : ""; };
  var first = function () { for (var i = 0; i < arguments.length; i++) if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i]; return undefined; };
  function extraOf(o, known) { var x = {}; Object.keys(o).forEach(function (k) { if (known.indexOf(k) < 0) x[k] = o[k]; }); return x; }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  // 日期：统一成本地时间的 "YYYY-MM-DD"（只有日期）或 "YYYY-MM-DDTHH:MM"；带时区的 ISO 换成本地
  function normDate(v, withTime) {
    if (v == null || v === "" || v === false || v === true) return "";
    if (typeof v === "number") v = new Date(v > 1e11 ? v : v * 1000);
    if (typeof v === "string" && K.dateOnly(v) && !withTime) { var d0 = K.parse(v); return d0 ? K.ymd(d0) : ""; }
    var d = K.parse(v);
    return d ? K.local(d, true) : "";
  }
  function normPri(p) {
    if (typeof p === "number") return p >= 1 && p <= 3 ? Math.round(p) : 0;
    var s = String(p == null ? "" : p).toLowerCase().trim();
    return /^(3|high|高|!!!)$/.test(s) ? 3 : /^(2|medium|med|中|!!)$/.test(s) ? 2 : /^(1|low|低|!)$/.test(s) ? 1 : 0;
  }
  function normRem(x, i, path) {
    if (typeof x === "string") x = { title: x };
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    var c = first(x.done, x.completed, x.isCompleted, x.checked);
    var r = {
      title: str(first(x.title, x.name, x.text)),
      notes: str(first(x.notes, x.note, x.body, x.description)),
      done: c === true || c === 1 || c === "true" || (typeof c === "string" && !!K.parse(c)),
      due: normDate(first(x.due, x.dueDate, x.date, x.deadline)),
      early: +x.early > 0 ? Math.round(+x.early) : 0,
      priority: normPri(x.priority),
      flagged: !!first(x.flagged, x.flag),
      url: str(first(x.url, x.link)),
      repeat: K.rrNorm(first(x.repeat, x.rrule, x.recurrence)),
      parent: str(first(x.parent, x.parentId)),
      tags: Array.isArray(x.tags) ? x.tags.map(str).map(function (t) { return t.replace(/^#/, ""); }).filter(Boolean) : typeof x.tags === "string" ? x.tags.split(/[,，\s]+/).map(function (t) { return t.replace(/^#/, ""); }).filter(Boolean) : [],
      created: normDate(first(x.created, x.createdAt), true),
      extra: extraOf(x, REM_KEYS),
    };
    r.doneAt = r.done ? normDate(first(x.doneAt, x.completedAt, x.completionDate, typeof x.completed === "string" ? x.completed : undefined), true) : "";
    r.id = str(x.id) || "auto-" + hash(path + "|" + i + "|" + r.title);
    return r;
  }
  function normList(path, data) {
    var o = Array.isArray(data) ? { reminders: data } : data && typeof data === "object" ? data : null;
    if (!o) return { path: path, name: stem(path), color: "gray", items: [], extra: {}, error: "内容不是列表（要一个对象，或者提醒事项的数组）" };
    var arr = Array.isArray(o.reminders) ? o.reminders : Array.isArray(o.items) ? o.items : Array.isArray(o.tasks) ? o.tasks : [];
    var L = { path: path, name: str(first(o.name, o.title)).trim() || stem(path), color: str(o.color) || "blue", icon: str(o.icon), order: typeof o.order === "number" ? o.order : null,
      extra: extraOf(o, LIST_KEYS), items: [], bad: [] };
    var seen = {};
    arr.forEach(function (x, i) {
      var r = normRem(x, i, path);
      if (!r) { L.bad.push(x); return; } // 看不懂的：不显示，但原样留在文件里
      if (seen[r.id]) r.id += "-" + i;
      seen[r.id] = 1;
      L.items.push(r);
    });
    // 子任务只有一层：父项不在、或父项自己也是子任务的，当成普通的
    var ids = {};
    L.items.forEach(function (r) { ids[r.id] = r; });
    L.items.forEach(function (r) { if (r.parent && (!ids[r.parent] || ids[r.parent].parent || r.parent === r.id)) r.parent = ""; });
    return L;
  }
  function outRem(r) {
    var o = { id: r.id, title: r.title };
    if (r.notes) o.notes = r.notes;
    o.done = !!r.done;
    if (r.done && r.doneAt) o.doneAt = r.doneAt;
    if (r.due) o.due = r.due;
    if (r.early) o.early = r.early;
    if (r.priority) o.priority = r.priority;
    if (r.flagged) o.flagged = true;
    if (r.url) o.url = r.url;
    if (r.repeat) o.repeat = r.repeat;
    if (r.parent) o.parent = r.parent;
    if (r.tags && r.tags.length) o.tags = r.tags.slice();
    if (r.created) o.created = r.created;
    Object.keys(r.extra || {}).forEach(function (k) { if (!(k in o)) o[k] = r.extra[k]; });
    return o;
  }
  function outList(L) {
    var o = { name: L.name, color: L.color || "blue" };
    if (L.icon) o.icon = L.icon;
    if (L.order != null) o.order = L.order;
    Object.keys(L.extra || {}).forEach(function (k) { if (!(k in o)) o[k] = L.extra[k]; });
    o.reminders = L.items.map(outRem).concat(L.bad || []);
    return o;
  }
  var clone = function (L) { return normList(L.path, outList(L)); };
  function readList(p, old) {
    var r = store.readJSON(p);
    if (r.missing) return null;
    if (r.lazy || r.text == null && !r.error) return old || { path: p, name: stem(p), color: "gray", items: [], extra: {}, loading: true };
    if (r.error) return { path: p, name: (old && old.name) || stem(p), color: (old && old.color) || "gray", icon: old ? old.icon : "", order: old ? old.order : null, items: [], extra: {}, error: r.error };
    return normList(p, r.data);
  }
  var isListFile = function (p) { return p.slice(0, p.lastIndexOf("/")) === DIR && /\.json$/i.test(p) && base(p).charAt(0) !== "."; };
  function sortLists(a) {
    return a.slice().sort(function (x, y) {
      var ox = x.order == null ? 1e9 : x.order, oy = y.order == null ? 1e9 : y.order;
      return ox - oy || x.name.localeCompare(y.name, "zh");
    });
  }
  function loadAll() {
    lists = sortLists(store.files(null, ".json").filter(isListFile).map(function (p) { return readList(p, byPath(p)); }).filter(Boolean));
  }
  var byPath = function (p) { return lists.find(function (L) { return L.path === p; }) || null; };
  function findRem(id) {
    for (var i = 0; i < lists.length; i++) { var r = lists[i].items.find(function (x) { return x.id === id; }); if (r) return { L: lists[i], r: r }; }
    return null;
  }
  // 文件变了（agent、终端、别的窗口）：只重读变了的那几个
  function reload(paths) {
    var dirty = false;
    paths.forEach(function (p) {
      if (p === DIR || !isListFile(p)) { if (p === DIR) { loadAll(); dirty = true; } return; }
      var old = byPath(p), L = readList(p, old);
      if (L && old) lists[lists.indexOf(old)] = L;
      else if (L) lists.push(L);
      else if (old) lists.splice(lists.indexOf(old), 1);
      dirty = true;
    });
    if (!dirty) return;
    lists = sortLists(lists);
    if (UI.sel.list && !byPath(UI.sel.list)) UI.sel = { smart: "today" };
    changed();
  }

  // ---- 改：先重读（别人可能刚改过）→ 改 → 写回；记下改了哪些条，撤销 / 重做只动这些条 ----
  var undo = K.undoStack(), batch = null;
  function snap(L) {
    var items = {}, order = [];
    L.items.forEach(function (r) { items[r.id] = JSON.stringify(outRem(r)); order.push(r.id); });
    return { props: JSON.stringify({ name: L.name, color: L.color, icon: L.icon, order: L.order }), items: items, order: order };
  }
  // 改之前的「最新版」：文件里的（合法的话）；真沙盒里的内容还没取回来就用内存里的；文件被别人删了就不改（免得又把它写回来）
  function fresh(path) {
    var r = store.readJSON(path), cur = byPath(path);
    if (r.error) return { broken: Object.assign({}, cur || { path: path, name: stem(path) }, { error: r.error }) };
    if (r.data !== undefined) { var L = normList(path, r.data); return L.error ? { broken: L } : { L: L }; }
    if (r.missing) { if (cur) setTimeout(function () { reload([path]); }, 0); return {}; }
    if (cur && cur.error) return { broken: cur };
    if (!cur || cur.loading) return {}; // 真沙盒里的内容还没取回来：先不改（不能拿空的盖掉）
    return { L: clone(cur) };
  }
  function commit(L, silent) {
    store.writeJSON(L.path, outList(L));
    var old = byPath(L.path);
    if (old) lists[lists.indexOf(old)] = L; else lists.push(L);
    lists = sortLists(lists);
    if (!silent) changed();
  }
  function edit(path, fn, label) {
    var f = fresh(path);
    if (f.broken) { brokenAlert(f.broken); return null; }
    if (!f.L) return null;
    var L = f.L, before = snap(L);
    if (fn(L) === false) return null;
    var after = snap(L);
    if (before.props === after.props && JSON.stringify(before.items) === JSON.stringify(after.items) && before.order.join() === after.order.join()) return L;
    commit(L);
    var rec = { path: path, before: before, after: after };
    if (batch) batch.push(rec);
    else if (label !== false) undo.push({ label: label || "", undo: function () { applySnap(rec.path, rec.after, rec.before); }, redo: function () { applySnap(rec.path, rec.before, rec.after); } });
    return L;
  }
  function group(label, fn) {
    var outer = batch;
    if (outer) return fn();
    batch = [];
    try { fn(); } finally {
      var b = batch;
      batch = null;
      if (b.length) undo.push({ label: label, undo: function () { b.slice().reverse().forEach(function (x) { applySnap(x.path, x.after, x.before); }); },
        redo: function () { b.forEach(function (x) { applySnap(x.path, x.before, x.after); }); } });
    }
  }
  // 把文件里的这些条从 from 的样子改成 to 的样子（别的条不动）
  function applySnap(path, from, to) {
    var f = fresh(path);
    if (f.broken || !f.L) return;
    var L = f.L;
    if (from.props !== to.props) { var p = JSON.parse(to.props); L.name = p.name; L.color = p.color; L.icon = p.icon; L.order = p.order; }
    Object.keys(from.items).forEach(function (id) { if (!(id in to.items)) L.items = L.items.filter(function (r) { return r.id !== id; }); });
    Object.keys(to.items).forEach(function (id) {
      if (from.items[id] === to.items[id]) return;
      var r = normRem(JSON.parse(to.items[id]), 0, path), i = L.items.findIndex(function (x) { return x.id === id; });
      if (i >= 0) { L.items[i] = r; return; }
      // 放回原来的位置：排在 to 里它前面、现在还在的那一条后面
      var k = to.order.indexOf(id), at = 0;
      for (var j = k - 1; j >= 0; j--) { var q = L.items.findIndex(function (x) { return x.id === to.order[j]; }); if (q >= 0) { at = q + 1; break; } }
      L.items.splice(at, 0, r);
    });
    commit(L);
  }
  function brokenAlert(L) {
    D.alert({ window: APP, title: "“" + (L.name || stem(L.path)) + "”现在改不了", icon: "caution",
      message: "这个列表的文件（" + L.path.replace(FS.HOME, "~") + "）不是合法的 JSON：" + (L.error || "") + "\n\n提醒事项不会覆盖它，免得把里面的东西弄丢。把文件改好后会自动恢复。",
      buttons: [{ label: "好", role: "default" }] });
  }
  var nowStr = function () { return K.local(new Date(), true); };
  var newId = function () { return K.uid("r-"); };

  // 默认列表（设置里可以换）：没有就是第一个；一个列表都没有就建「提醒事项」
  function defaultList(create) {
    var want = K.store.get("tsu-rem-default", "");
    var L = byPath(want) || lists.find(function (x) { return !x.error; }) || null;
    if (!L && create) L = createList({ name: "提醒事项", color: "blue", icon: "list" });
    return L;
  }
  function freePath(name, self) {
    var nm = K.safeName(name, "列表"), p = DIR + "/" + nm + ".json", n = 2;
    while (FS.exists(p) && p !== self) p = DIR + "/" + nm + " " + n++ + ".json";
    return p;
  }
  function createList(o) {
    store.ensure();
    var maxOrder = lists.reduce(function (m, L) { return Math.max(m, L.order == null ? -1 : L.order); }, -1);
    var L = { path: freePath(o.name), name: o.name, color: o.color || "blue", icon: o.icon || "list", order: maxOrder + 1, items: [], extra: {} };
    commit(L);
    return L;
  }
  function renameList(L, name) {
    name = String(name || "").trim();
    if (!name || name === L.name || L.error) return;
    var old = L.path, np = freePath(name, old), oldName = L.name;
    // 先改文件名、再写新名字（反过来的话，真沙盒那边会丢掉那次写）
    if (np !== old) {
      try { store.move(old, np); } catch (e) { return; }
      var cur = byPath(old);
      if (cur) cur.path = np;
      if (UI.sel.list === old) UI.sel = { list: np };
      if (K.store.get("tsu-rem-default", "") === old) K.store.set("tsu-rem-default", np);
      saveUI();
    }
    edit(np, function (x) { x.name = name; }, false);
    undo.push({ label: "重新命名列表", undo: function () { var c = byPath(np) || byPath(old); if (c) renameList(c, oldName); }, redo: function () { var c = byPath(old) || byPath(np); if (c) renameList(c, name); } });
    changed();
  }
  // 删除列表：文件移到废纸篓（能放回原处），不是真删
  function deleteList(L) {
    var n = L.items.length;
    D.alert({ window: APP, title: "要删除“" + L.name + "”吗？", icon: "caution",
      message: n ? "这会删除此列表中的全部 " + n + " 个提醒事项。列表的文件会移到废纸篓，需要时可以从废纸篓放回。" : "列表的文件会移到废纸篓。",
      buttons: [{ label: "取消", role: "cancel" }, { label: "删除", role: "destructive" }] }).then(function (b) {
      if (b !== "删除") return;
      var F = window.TSU_FINDER;
      if (F && F.trash) F.trash([L.path]);
      else { var T = FS.HOME + "/.Trash"; if (!FS.isDir(T)) FS.mkdirp(T); var to = T + "/" + base(L.path), i = 2; while (FS.exists(to)) to = T + "/" + stem(L.path) + " " + i++ + ".json"; FS.move(L.path, to); }
      lists = lists.filter(function (x) { return x !== L; });
      if (UI.sel.list === L.path) UI.sel = { smart: "today" };
      changed();
    });
  }
  function reorderLists(paths) {
    group("重新排列列表", function () { paths.forEach(function (p, i) { var L = byPath(p); if (L && L.order !== i && !L.error) edit(p, function (x) { x.order = i; }); }); });
  }

  // ======== 查询 ========
  var today0 = function () { return K.day0(new Date()); };
  var dueDate = function (r) { return r.due ? K.parse(r.due) : null; };
  var hasTime = function (r) { return !!r.due && !K.dateOnly(r.due); };
  function isOverdue(r) {
    if (!r.due || r.done) return false;
    var d = dueDate(r);
    return hasTime(r) ? d < new Date() : d < today0();
  }
  var isToday = function (r) { var d = dueDate(r); return !!d && K.sameDay(d, new Date()); };
  var inToday = function (r) { var d = dueDate(r); return !!d && K.day0(d) <= today0(); };
  var allItems = function () { var out = []; lists.forEach(function (L) { if (!L.error) L.items.forEach(function (r) { out.push({ r: r, L: L }); }); }); return out; };
  function counts() {
    var c = { today: 0, scheduled: 0, all: 0, flagged: 0, completed: 0, badge: 0 };
    allItems().forEach(function (x) {
      var r = x.r;
      if (r.done) { c.completed++; return; }
      c.all++;
      if (r.due) c.scheduled++;
      if (r.flagged) c.flagged++;
      if (inToday(r)) { c.today++; c.badge++; }
    });
    return c;
  }
  var openCount = function (L) { return L.items.filter(function (r) { return !r.done; }).length; };

  // ======== 通知：到点（只有日期的是当天 9:00）发；提前提醒再早发一次。页面关着时错过的只补最近 10 分钟的 ========
  function alertTimes(r) {
    if (!r.due || r.done) return [];
    var d = dueDate(r);
    if (!d) return [];
    if (!hasTime(r)) d = new Date(d.getFullYear(), d.getMonth(), d.getDate(), +(K.store.get("tsu-rem-allday-hour", 9)), 0);
    var out = [d];
    if (r.early) out.push(new Date(d.getTime() - r.early * 60000));
    return out;
  }
  function tick() {
    var now = Date.now(), last = K.store.get("tsu-rem-lastcheck", 0), sent = K.store.get("tsu-rem-sent", {});
    if (!last || now - last > 600000) last = now - 600000;
    allItems().forEach(function (x) {
      alertTimes(x.r).forEach(function (t, i) {
        var ms = t.getTime(), key = x.r.id + "|" + ms;
        if (ms > last && ms <= now && !sent[key]) { sent[key] = now; fire(x, i === 1, key); }
      });
    });
    Object.keys(sent).forEach(function (k) { if (now - sent[k] > 7 * 864e5) delete sent[k]; });
    K.store.set("tsu-rem-sent", sent);
    K.store.set("tsu-rem-lastcheck", now);
    badge();
  }
  // key = 这条提醒的这一次到点：几台设备同时到点，账号里只有一条通知，在哪台上处理，别的都收起
  function fire(x, early, key) {
    var r = x.r, d = dueDate(r);
    if (!M) build(); // 通知上的名字、图标跟着窗口走：窗口还没建就先建好（不显示）
    D.notify({ app: APP, key: "rem:" + key, title: r.title || "新提醒事项", body: (early ? "提前提醒 · " : "") + (hasTime(r) ? K.relDay(d) + " " + K.hm(d) : K.relDay(d)) + " · " + x.L.name + (r.notes ? "\n" + r.notes.split("\n")[0] : ""),
      onClick: function () { open(); UI.sel = { list: x.L.path }; UI.query = ""; UI.selected = [r.id]; renderAll(); reveal(r.id); } });
  }
  var dockA = null;
  function badge() {
    if (!dockA) return;
    var n = counts().badge, b = dockA.querySelector(".rm-badge");
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("b"); b.className = "rm-badge"; dockA.appendChild(b); }
    b.textContent = n > 99 ? "99+" : n;
  }

  // ======== 界面状态 ========
  var UI = {
    sel: K.store.get("tsu-rem-sel", { smart: "today" }), // { smart: today|scheduled|all|flagged|completed } | { list: 路径 }
    query: "", showDone: K.store.get("tsu-rem-showdone", {}), sort: K.store.get("tsu-rem-sort", {}),
    selected: [], editing: null, draft: null, collapsed: K.store.get("tsu-rem-collapsed", {}), justDone: {}, sug: null,
  };
  var viewKey = function () { return UI.query ? "search" : UI.sel.list || UI.sel.smart; };
  var showDone = function () { return !!UI.showDone[viewKey()] || viewKey() === "completed" || viewKey() === "search"; };
  function saveUI() { K.store.set("tsu-rem-sel", UI.sel); K.store.set("tsu-rem-showdone", UI.showDone); K.store.set("tsu-rem-sort", UI.sort); K.store.set("tsu-rem-collapsed", UI.collapsed); }
  var visible = function (r) { return !r.done || showDone() || UI.justDone[r.id]; };

  // 一个列表里的行：父项，后面跟着它的子任务（收起的不跟）
  function treeRows(L, filter, sortBy) {
    var kids = {}, tops = [];
    L.items.forEach(function (r) { if (r.parent) (kids[r.parent] = kids[r.parent] || []).push(r); else tops.push(r); });
    if (sortBy && sortBy !== "manual") tops = sortItems(tops, sortBy);
    var out = [];
    tops.forEach(function (r) {
      var ks = (kids[r.id] || []).filter(filter), self = filter(r);
      if (!self && !ks.length) return;
      out.push({ r: r, L: L, depth: 0, kids: (kids[r.id] || []).length, dim: !self });
      if (!UI.collapsed[r.id]) ks.forEach(function (k) { out.push({ r: k, L: L, depth: 1 }); });
    });
    return out;
  }
  function sortItems(a, by) {
    var key = {
      due: function (r) { var d = dueDate(r); return d ? d.getTime() + (hasTime(r) ? 0 : 86399000) : 9e15; },
      created: function (r) { var d = K.parse(r.created); return d ? -d.getTime() : 0; },
      priority: function (r) { return -r.priority; },
      title: null,
    }[by];
    return a.slice().sort(function (x, y) { return key ? key(x) - key(y) : x.title.localeCompare(y.title, "zh"); });
  }
  // 当前视图：分节 [{ key, title, color, L（在这一节里新建放进哪个列表）, preset（新建时带上的）, rows }]
  function sections() {
    var t0 = today0(), vis = visible;
    if (UI.query) {
      var q = UI.query.toLowerCase();
      return lists.filter(function (L) { return !L.error; }).map(function (L) {
        var hit = function (r) { return (r.title + "\n" + r.notes + "\n" + r.url + "\n" + r.tags.map(function (t) { return "#" + t; }).join(" ")).toLowerCase().indexOf(q) >= 0; };
        return { key: L.path, title: L.name, color: hex(L.color), L: L, rows: L.items.filter(hit).map(function (r) { return { r: r, L: L, depth: 0 }; }), noAdd: true };
      }).filter(function (s) { return s.rows.length; });
    }
    if (UI.sel.list) {
      var L = byPath(UI.sel.list);
      return L ? [{ key: L.path, L: L, rows: treeRows(L, vis, UI.sort[L.path]) }] : [];
    }
    var k = UI.sel.smart, all = allItems();
    if (k === "all" || k === "flagged") {
      return lists.filter(function (L) { return !L.error; }).map(function (L) {
        var f = k === "flagged" ? function (r) { return r.flagged && vis(r); } : vis;
        return { key: L.path, title: L.name, color: hex(L.color), L: L, rows: treeRows(L, f, UI.sort[k]), preset: k === "flagged" ? { flagged: true } : null, noAdd: k === "flagged" };
      }).filter(function (s) { return s.rows.length || k === "all"; });
    }
    if (k === "completed") {
      var done = all.filter(function (x) { return x.r.done; }).sort(function (a, b) { return (b.r.doneAt || "").localeCompare(a.r.doneAt || ""); });
      var groups = [], at = {};
      done.forEach(function (x) {
        var d = K.parse(x.r.doneAt), n = d ? K.dayDiff(d, new Date()) : 9999;
        var g = !d ? "更早" : n <= 0 ? "今天" : n === 1 ? "昨天" : n < 7 ? "前 7 天" : n < 30 ? "前 30 天" : d.getFullYear() === new Date().getFullYear() ? d.getMonth() + 1 + "月" : d.getFullYear() + "年";
        if (!at[g]) groups.push(at[g] = { key: g, title: g, rows: [], noAdd: true });
        at[g].rows.push({ r: x.r, L: x.L, depth: 0, showList: true });
      });
      return groups;
    }
    if (k === "today") {
      var def = defaultList(false), secs = [["late", "过期"], ["allday", "全天"], ["am", "上午"], ["pm", "下午"], ["night", "今晚"]].map(function (s) { return { key: s[0], title: s[1], rows: [], L: def }; });
      var pick = function (key) { return secs.find(function (s) { return s.key === key; }); };
      all.filter(function (x) { return x.r.due && (inToday(x.r) && !x.r.done || (x.r.done && (showDone() || UI.justDone[x.r.id]) && isToday(x.r)) || UI.justDone[x.r.id]); })
        .sort(function (a, b) { return a.r.due.localeCompare(b.r.due); })
        .forEach(function (x) {
          var d = dueDate(x.r), h = d.getHours(), key = K.day0(d) < t0 ? "late" : !hasTime(x.r) ? "allday" : h < 12 ? "am" : h < 18 ? "pm" : "night";
          pick(key).rows.push({ r: x.r, L: x.L, depth: 0, showList: true, timeOnly: key !== "late" });
        });
      secs.forEach(function (s) { s.preset = s.key === "late" || s.key === "allday" ? { due: K.ymd(t0) } : { due: K.ymd(t0) + "T" + { am: "09:00", pm: "14:00", night: "19:00" }[s.key] }; s.noAdd = s.key === "late"; });
      var used = secs.filter(function (s) { return s.rows.length; });
      return used.length ? used : [{ key: "today", title: "", rows: [], L: def, preset: { due: K.ymd(t0) } }];
    }
    // 计划：过期、今天、明天、之后 5 天每天一节，再往后按月、按年
    var map = {}, order = [];
    var add = function (key, title, preset, sortKey) { if (!map[key]) { map[key] = { key: key, title: title, rows: [], L: defaultList(false), preset: preset, sk: sortKey }; order.push(map[key]); } return map[key]; };
    all.filter(function (x) { return x.r.due && (vis(x.r) || UI.justDone[x.r.id]); }).sort(function (a, b) { return a.r.due.localeCompare(b.r.due); }).forEach(function (x) {
      var d = K.day0(dueDate(x.r)), n = K.dayDiff(t0, d), s;
      if (n < 0) s = add("late", "过期", null, -1);
      else if (n === 0) s = add("d0", "今天", { due: K.ymd(d) }, 0);
      else if (n === 1) s = add("d1", "明天", { due: K.ymd(d) }, 1);
      else if (n < 7) s = add("d" + n, "周" + K.WD[d.getDay()] + " " + K.fmtMD(d), { due: K.ymd(d) }, n);
      else if (d.getFullYear() === t0.getFullYear() || K.dayDiff(t0, d) < 300) s = add("m" + d.getFullYear() + "-" + d.getMonth(), (d.getFullYear() === t0.getFullYear() ? "" : d.getFullYear() + "年") + (d.getMonth() + 1) + "月", null, 100 + (d.getFullYear() - t0.getFullYear()) * 12 + d.getMonth());
      else s = add("y" + d.getFullYear(), d.getFullYear() + "年", null, 10000 + d.getFullYear());
      s.rows.push({ r: x.r, L: x.L, depth: 0, showList: true, timeOnly: n >= 0 && n < 7 });
    });
    if (!map.d0) add("d0", "今天", { due: K.ymd(t0) }, 0);
    if (!map.d1) add("d1", "明天", { due: K.ymd(K.addDays(t0, 1)) }, 1);
    order.forEach(function (s) { s.noAdd = s.key === "late" || !s.preset; });
    return order.sort(function (a, b) { return a.sk - b.sk; });
  }

  // ======== 窗口（第一次打开时才建）========
  var M = null; // { win, side, main, tb, … }
  function open() {
    if (!M) build();
    if (M.win.state === "min" || M.win.state === "closed") M.win.show(); else M.win.front();
    renderAll();
    return M.win;
  }
  function build() {
    M = K.window({ id: APP, name: NAME, className: "rm-win", width: 900, height: 620, sideW: 250, minSide: 210, maxSide: 360, menus: menus, appMenu: appMenu,
      title: function () { return NAME; }, onClose: function () { finishEdit(); } });
    M.tb.innerHTML = K.group(K.btn("sidebar", "显示或隐藏边栏")) + '<span class="ma-flex"></span>' + K.group(K.btn("more", "显示选项", ICON.more) + K.btn("share", "共享", ICON.share)) + K.group(K.btn("plus", "新建提醒事项"));
    M.side.insertAdjacentHTML("afterbegin", '<div class="rm-sside">' + K.searchBox("搜索") + '</div><div class="rm-sscroll ma-scroll"><div class="rm-cards"></div><h4 class="rm-sh">我的列表</h4><div class="rm-lists"></div></div>' +
      '<div class="rm-sfoot"><button class="rm-addlist" tabindex="-1"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 6.6v6.8M6.6 10h6.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>添加列表</button></div>');
    M.main.innerHTML = '<div class="rm-head"><h1></h1><span class="rm-hn"></span></div><div class="rm-sub"></div><div class="rm-body ma-scroll" tabindex="-1"><div class="rm-list"></div><div class="rm-tail"></div></div><div class="ma-empty" hidden>无提醒事项</div>';
    bindToolbar();
    bindSide();
    bindMain();
    window.addEventListener("keydown", onKey, true);
    K.onTheme(renderAll);
  }

  // ======== 画 ========
  var pending = false;
  function changed() { badge(); if (M) scheduleRender(); }
  function scheduleRender() { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; renderAll(); }); }
  function renderAll() {
    if (!M) return;
    renderSide();
    renderMain(true);
  }
  var editingNow = function () { var a = document.activeElement; return !!(M && a && M.main.contains(a) && a.isContentEditable); };
  function renderSide() {
    if (M.side.querySelector(".rm-lname.renaming")) { M.needSide = true; return; } // 正在改列表名：改完再画
    M.needSide = false;
    var c = counts(), cards = M.side.querySelector(".rm-cards"), on = !UI.query && UI.sel.smart;
    cards.innerHTML = SMART.map(function (s) {
      return '<div class="rm-card' + (on === s[0] ? " on" : "") + '" data-smart="' + s[0] + '" style="--c:' + smartHex(s[0]) + '">' + smartIcon(s[0]) +
        '<b class="rm-cn">' + (s[0] === "completed" ? "" : c[s[0]]) + '</b><span class="rm-cname">' + s[1] + "</span></div>";
    }).join("");
    var box = M.side.querySelector(".rm-lists");
    box.innerHTML = lists.map(function (L) {
      return '<div class="rm-li' + (!UI.query && UI.sel.list === L.path ? " on" : "") + (L.error ? " broken" : "") + '" data-path="' + esc(L.path) + '" draggable="true">' + listIcon(L) +
        '<span class="rm-lname">' + esc(L.name) + "</span>" + (L.error ? '<span class="rm-warn" title="文件读不了">!</span>' : '<span class="rm-ln">' + (openCount(L) || "") + "</span>") + "</div>";
    }).join("");
    M.side.querySelector(".rm-sh").hidden = !lists.length;
  }
  function renderMain(keepEditing) {
    // 数据变了（agent 在外面改了、或者点了别的行）而这边正在打字：打字的那一行原样留着（连同光标），别的行照常重画
    var keep = null, act = document.activeElement;
    if (keepEditing && UI.editing && act && act.isContentEditable && M.main.contains(act)) {
      var er = act.closest(".rm-row"), sel = getSelection(), rg = sel.rangeCount ? sel.getRangeAt(0) : null;
      if (er && er.dataset.id === UI.editing.id) keep = { row: er, field: act, rg: rg && act.contains(rg.startContainer) ? { sc: rg.startContainer, so: rg.startOffset, ec: rg.endContainer, eo: rg.endOffset } : null };
    }
    var body = M.main.querySelector(".rm-body"), listEl = M.main.querySelector(".rm-list"), top = body.scrollTop;
    var secs = sections(), L = UI.sel.list ? byPath(UI.sel.list) : null, color = L ? hex(L.color) : UI.query ? (K.light() ? "#1d1d1f" : "#f2f2f4") : smartHex(UI.sel.smart);
    var title = UI.query ? "“" + UI.query + "”的结果" : L ? L.name : smartName(UI.sel.smart);
    var h1 = M.main.querySelector(".rm-head h1"), hn = M.main.querySelector(".rm-hn");
    h1.textContent = title;
    h1.style.color = UI.query || UI.sel.smart === "all" ? "" : color;
    var n = 0, done = 0, scope = [];
    if (UI.query) secs.forEach(function (s) { s.rows.forEach(function (x) { scope.push(x.r); }); });
    else if (L) scope = L.items;
    else scope = allItems().filter(function (x) { var r = x.r, k = UI.sel.smart; return k === "all" || k === "completed" || (k === "flagged" && r.flagged) || (k === "today" && r.due && (r.done ? isToday(r) : inToday(r))) || (k === "scheduled" && r.due); }).map(function (x) { return x.r; });
    scope.forEach(function (r) { if (r.done) done++; else n++; });
    hn.textContent = (UI.sel.smart === "completed" && !UI.query && !L) || (L && L.error) ? "" : n;
    hn.style.color = UI.query || UI.sel.smart === "all" ? "" : color;
    M.main.style.setProperty("--c", color);
    var sub = M.main.querySelector(".rm-sub");
    if (L && L.error) sub.innerHTML = '<div class="ma-banner">这个列表的文件读不了：' + esc(L.error) + "<br><code>" + esc(L.path.replace(FS.HOME, "~")) + "</code> 改好后会自动恢复；在这之前提醒事项不会覆盖它。</div>";
    else if (UI.sel.smart === "completed" && !UI.query && !L) sub.innerHTML = '<span>' + done + ' 项已完成</span>' + (done ? '<span class="rm-dot">·</span><a data-a="clear">清除</a>' : "");
    else if (done || showDone()) sub.innerHTML = "<span>" + done + " 项已完成</span>" + (done ? '<span class="rm-dot">·</span><a data-a="clear">清除</a>' : "") + '<span class="ma-flex"></span>' +
      (UI.query ? "" : '<a data-a="toggle">' + (showDone() ? "隐藏" : "显示") + "</a>");
    else sub.innerHTML = "";
    var html = "";
    secs.forEach(function (s) {
      var rows = s.rows.slice(), dr = UI.draft && UI.draft.sec === s.key ? UI.draft : null;
      if (s.title !== undefined && s.title !== "" && (secs.length > 1 || s.title)) html += '<div class="rm-sec" data-sec="' + esc(s.key) + '"><h3' + (s.color ? ' style="color:' + s.color + '"' : "") + ">" + esc(s.title) + "</h3></div>";
      html += '<div class="rm-group" data-sec="' + esc(s.key) + '">';
      rows.forEach(function (x) {
        html += rowHTML(x);
        if (dr && dr.after === x.r.id) { html += draftHTML(dr, x.depth ? 1 : dr.parent ? 1 : 0, s); dr = null; }
      });
      if (dr) html += draftHTML(dr, dr.parent ? 1 : 0, s);
      if (!s.noAdd && s.L && !(s.L.error)) html += '<div class="rm-addrow" data-sec="' + esc(s.key) + '"></div>';
      html += "</div>";
    });
    listEl.innerHTML = html;
    var empty = !secs.some(function (s) { return s.rows.length; }) && !UI.draft && !(L && L.error);
    var em = M.main.querySelector(".ma-empty");
    em.hidden = !empty;
    em.textContent = UI.query ? "无结果" : UI.sel.smart === "completed" && !L ? "无已完成的提醒事项" : "无提醒事项";
    M.secs = secs;
    var slot = keep && listEl.querySelector('.rm-row[data-id="' + CSS.escape(keep.row.dataset.id) + '"]');
    if (slot) {
      slot.replaceWith(keep.row);
      keep.field.focus({ preventScroll: true });
      if (keep.rg) try { getSelection().setBaseAndExtent(keep.rg.sc, keep.rg.so, keep.rg.ec, keep.rg.eo); } catch (e) { /* 光标放不回去就算了 */ }
      body.scrollTop = top;
    } else {
      body.scrollTop = top;
      if (UI.editing) {
        var el = listEl.querySelector('[data-id="' + CSS.escape(UI.editing.id) + '"] ' + (UI.editing.field === "notes" ? ".rm-notes" : ".rm-t"));
        if (el) focusEnd(el); else UI.editing = null;
      }
    }
    syncTitle();
  }
  function syncTitle() { if (M) M.win.setTitle(NAME); }
  function dueText(x) {
    var r = x.r, d = dueDate(r);
    if (!d) return "";
    if (x.timeOnly && hasTime(r)) return K.hm(d);
    if (x.timeOnly) return "";
    return K.relDay(d) + (hasTime(r) ? " " + K.hm(d) : "");
  }
  function rowHTML(x) {
    var r = x.r, L = x.L, c = hex(L.color), sel = UI.selected.indexOf(r.id) >= 0, ed = UI.editing && UI.editing.id === r.id;
    var meta = [], dt = dueText(x);
    if (dt) meta.push('<span class="rm-due' + (isOverdue(r) ? " late" : "") + '">' + esc(dt) + "</span>");
    if (r.repeat) meta.push('<span class="rm-rep">' + ICON.repeat + esc(K.rrText(r.repeat, dueDate(r) || undefined)) + "</span>");
    if (x.showList && (UI.query || !UI.sel.list)) meta.push('<span class="rm-inlist" style="color:' + c + '">' + esc(L.name) + "</span>");
    if (x.kids && !x.depth) meta.push('<button class="rm-kids" data-a="kids" tabindex="-1">' + (UI.collapsed[r.id] ? "▸ " : "▾ ") + x.kids + " 个子任务</button>");
    var tags = r.tags.length ? '<div class="rm-tags">' + r.tags.map(function (t) { return '<span class="rm-tag">#' + esc(t) + "</span>"; }).join("") + "</div>" : "";
    var url = r.url ? '<a class="rm-url" data-a="url" title="' + esc(r.url) + '">' + ICON.link + "<span>" + esc(r.url.replace(/^https?:\/\//, "").replace(/\/$/, "")) + "</span></a>" : "";
    return '<div class="rm-row' + (r.done ? " done" : "") + (sel ? " sel" : "") + (ed ? " editing" : "") + (x.depth ? " sub" : "") + (x.dim ? " dimmed" : "") + (UI.justDone[r.id] ? " just" : "") +
      '" data-id="' + esc(r.id) + '" data-path="' + esc(L.path) + '" style="--c:' + c + '" draggable="true">' +
      '<button class="rm-check" data-a="check" tabindex="-1" title="' + (r.done ? "标记为未完成" : "标记为已完成") + '"></button>' +
      '<div class="rm-txt"><div class="rm-line">' + (r.priority ? '<b class="rm-pri">' + "!!!".slice(0, r.priority) + "</b>" : "") +
      '<span class="rm-t" contenteditable="plaintext-only" spellcheck="false" data-ph="' + (r.title ? "" : "新提醒事项") + '">' + esc(r.title) + "</span></div>" +
      '<div class="rm-notes' + (r.notes ? "" : " empty") + '" contenteditable="plaintext-only" spellcheck="false" data-ph="备注">' + esc(r.notes) + "</div>" +
      tags + (meta.length ? '<div class="rm-meta">' + meta.join("") + "</div>" : "") + url + chipsHTML(r) + "</div>" +
      (r.flagged ? '<span class="rm-flag" title="已加旗标">' + ICON.flag + "</span>" : "") +
      '<button class="rm-info" data-a="info" tabindex="-1" title="显示简介">' + ICON.info + "</button></div>";
  }
  // 正在编辑的那一行底下：日期小胶囊（没有日期时是「添加日期」），打字时认出了日期就多一个建议
  function chipsHTML(r) {
    var d = dueDate(r);
    return '<div class="rm-chips">' + (d ? '<button class="rm-chip on" data-a="date" tabindex="-1">' + ICON.calendar + esc(K.relDay(d) + (hasTime(r) ? " " + K.hm(d) : "")) + "</button>" :
      '<button class="rm-chip" data-a="date" tabindex="-1">' + ICON.calendar + "添加日期</button>") +
      '<button class="rm-chip' + (r.flagged ? " on flag" : "") + '" data-a="flag" tabindex="-1">' + ICON.flagLine + (r.flagged ? "已加旗标" : "旗标") + "</button>" +
      '<button class="rm-chip sug" data-a="sug" tabindex="-1" hidden></button></div>';
  }
  function draftHTML(dr, depth, s) {
    var L = byPath(dr.path) || s.L, c = L ? hex(L.color) : "#0a84ff";
    return '<div class="rm-row editing draft' + (depth ? " sub" : "") + '" data-id="' + dr.id + '" data-path="' + esc(dr.path) + '" style="--c:' + c + '">' +
      '<button class="rm-check" tabindex="-1" disabled></button><div class="rm-txt"><div class="rm-line"><span class="rm-t" contenteditable="plaintext-only" spellcheck="false" data-ph="">' + esc(dr.title || "") + "</span></div>" +
      '<div class="rm-notes empty" contenteditable="plaintext-only" spellcheck="false" data-ph="备注"></div>' + chipsHTML({ due: dr.preset && dr.preset.due || "", flagged: dr.preset && dr.preset.flagged }) + "</div></div>";
  }
  function focusEnd(el) {
    el.focus({ preventScroll: true });
    var s = getSelection(), rg = document.createRange();
    rg.selectNodeContents(el);
    rg.collapse(false);
    s.removeAllRanges();
    s.addRange(rg);
    var row = el.closest(".rm-row");
    if (row) row.scrollIntoView({ block: "nearest" });
  }
  function reveal(id) { if (!M) return; var el = M.main.querySelector('.rm-row[data-id="' + CSS.escape(id) + '"]'); if (el) el.scrollIntoView({ block: "center" }); }
  var rowEl = function (id) { return M && M.main.querySelector('.rm-row[data-id="' + CSS.escape(id) + '"]'); };
  var textOf = function (el) { return el ? el.innerText.replace(/ /g, " ").replace(/\n+$/, "") : ""; };

  // ======== 编辑 ========
  // 新建：先是一行草稿（不进文件），打了字、提交时才写进去；空着离开就没了（同 macOS）
  function newDraft(o) {
    finishEdit();
    o = o || {};
    var secs = M.secs || sections(), s = null;
    if (o.sec) s = secs.find(function (x) { return x.key === o.sec; });
    if (!s && o.after) s = secs.find(function (x) { return x.rows.some(function (y) { return y.r.id === o.after; }); });
    if (!s) s = secs.find(function (x) { return !x.noAdd && x.L; }) || secs[0];
    var L = o.path ? byPath(o.path) : s && s.L ? s.L : defaultList(true);
    if (!L) L = defaultList(true);
    if (!L || L.error) { if (L) brokenAlert(L); return; }
    if (UI.sel.smart === "completed" && !UI.sel.list && !UI.query) { UI.sel = { list: L.path }; s = null; }
    if (UI.query) { UI.query = ""; setSearch(""); UI.sel = { list: L.path }; s = null; }
    var sec = s ? s.key : L.path;
    if (!s) { renderMain(); s = (M.secs || []).find(function (x) { return x.key === L.path; }); sec = s ? s.key : L.path; }
    var after = o.after || null;
    if (!after && s && s.rows.length && !o.top) after = s.rows[s.rows.length - 1].r.id;
    UI.draft = { id: "draft", path: L.path, sec: sec, after: after, parent: o.parent || "", preset: Object.assign({}, (s && s.preset) || {}, o.preset || {}), title: "" };
    UI.selected = [];
    UI.editing = { id: "draft", field: "title" };
    renderMain();
  }
  // 提交正在编辑的那一行（标题、备注），回车新建时由调用方接着开下一行
  function finishEdit() {
    if (!M || !UI.editing) return null;
    var ed = UI.editing, row = rowEl(ed.id);
    UI.editing = null;
    if (!row) { if (ed.id === "draft") UI.draft = null; return null; }
    var title = textOf(row.querySelector(".rm-t")).replace(/\s*\n\s*/g, " "), notes = textOf(row.querySelector(".rm-notes"));
    if (ed.id === "draft") {
      var dr = UI.draft;
      UI.draft = null;
      if (!dr || (!title.trim() && !notes.trim())) return null;
      var r = { id: newId(), title: title.trim(), notes: notes, done: false, due: "", early: 0, priority: 0, flagged: false, url: "", repeat: "", parent: dr.parent || "", tags: [], created: nowStr(), extra: {} };
      Object.keys(dr.preset || {}).forEach(function (k) { r[k] = dr.preset[k]; });
      applyNatural(r, true);
      var L = edit(dr.path, function (x) {
        var at = dr.after ? x.items.findIndex(function (y) { return y.id === dr.after; }) : -1;
        if (at >= 0) {
          // 新的是顶层的：排在 after 那一家（它和它的子任务）后面；是子任务：紧跟在 after 后面
          var host = x.items[at], fam = host.parent || host.id;
          if (!r.parent) while (x.items[at + 1] && x.items[at + 1].parent === fam) at++;
          x.items.splice(at + 1, 0, r);
        } else x.items.push(r);
      }, "新建提醒事项");
      return L ? r : null;
    }
    var hit = findRem(ed.id);
    if (!hit) return null;
    var upd = { title: title, notes: notes, due: hit.r.due, tags: hit.r.tags.slice() };
    applyNatural(upd, false);
    if (upd.title === hit.r.title && notes === hit.r.notes && upd.tags.join() === hit.r.tags.join()) return hit.r;
    edit(hit.L.path, function (x) { var y = x.items.find(function (q) { return q.id === ed.id; }); if (!y) return false; y.title = upd.title; y.notes = notes; y.tags = upd.tags; }, "输入");
    return hit.r;
  }
  // 标题里的「#标签」变成标签；新建时认出了日期（「明天下午3点」）就直接用上、字从标题里拿掉（同 macOS 的自然语言输入）
  function applyNatural(r, isNew) {
    var tags = [];
    r.title = r.title.replace(/(^|\s)#([^\s#]+)/g, function (m, sp, t) { tags.push(t); return sp; }).replace(/\s{2,}/g, " ").trim();
    tags.forEach(function (t) { if (r.tags.indexOf(t) < 0) r.tags.push(t); });
    if (!isNew || r.due) return;
    var nl = K.parseNatural(r.title);
    if (!nl || !nl.rest) return;
    r.due = nl.time ? K.local(nl.date, true) : K.ymd(nl.date);
    r.title = nl.rest;
  }
  // 改一条的同时保持它还在编辑（日期、旗标小胶囊）：先提交、改、再重画并把焦点放回去
  function withEdit(fn) {
    var ed = UI.editing;
    if (ed && ed.id !== "draft") finishEdit();
    fn();
    if (ed && ed.id !== "draft" && findRem(ed.id)) { UI.editing = ed; renderMain(); } else renderAll();
  }
  function toggleDone(id) {
    var hit = findRem(id);
    if (!hit || hit.L.error) return hit && brokenAlert(hit.L);
    var r = hit.r, becomes = !r.done;
    if (becomes) {
      UI.justDone[id] = Date.now();
      setTimeout(function () { delete UI.justDone[id]; scheduleRender(); }, 1600);
    } else delete UI.justDone[id];
    edit(hit.L.path, function (x) {
      var y = x.items.find(function (q) { return q.id === id; });
      if (!y) return false;
      if (becomes && y.repeat && y.due) {
        // 重复的：另记一条已完成的，这一条的截止挪到下一次
        var d = K.parse(y.due), nx = K.rrNext(y.repeat, d, d);
        if (nx) {
          var copy = Object.assign({}, y, { id: newId(), done: true, doneAt: nowStr(), repeat: "", extra: Object.assign({}, y.extra) });
          x.items.splice(x.items.indexOf(y), 0, copy);
          y.due = K.dateOnly(y.due) ? K.ymd(nx) : K.local(nx, true);
          UI.justDone[copy.id] = Date.now();
          setTimeout(function () { delete UI.justDone[copy.id]; scheduleRender(); }, 1600);
          return;
        }
      }
      y.done = becomes;
      y.doneAt = becomes ? nowStr() : "";
      // 父项完成：子任务一起完成
      if (becomes && !y.parent) x.items.forEach(function (k) { if (k.parent === y.id && !k.done) { k.done = true; k.doneAt = y.doneAt; } });
    }, becomes ? "标记为已完成" : "标记为未完成");
  }
  function setField(ids, fn, label) {
    group(label, function () {
      var byList = {};
      ids.forEach(function (id) { var h = findRem(id); if (h) (byList[h.L.path] = byList[h.L.path] || []).push(id); });
      Object.keys(byList).forEach(function (p) { edit(p, function (x) { x.items.forEach(function (y) { if (byList[p].indexOf(y.id) >= 0) fn(y); }); }); });
    });
  }
  function deleteItems(ids) {
    if (!ids.length) return;
    group(ids.length > 1 ? "删除提醒事项" : "删除提醒事项", function () {
      var byList = {};
      ids.forEach(function (id) { var h = findRem(id); if (h) (byList[h.L.path] = byList[h.L.path] || []).push(id); });
      Object.keys(byList).forEach(function (p) {
        edit(p, function (x) {
          var gone = byList[p];
          x.items = x.items.filter(function (y) { return gone.indexOf(y.id) < 0 && gone.indexOf(y.parent) < 0; }); // 父项删了，子任务跟着删
        });
      });
    });
    UI.selected = [];
  }
  // 挪到别的列表（带上子任务）；toPath 里放在 before 前面（没有就放最后）
  function moveItems(ids, toPath, beforeId) {
    var T = byPath(toPath);
    if (!T || T.error) return T && brokenAlert(T);
    group("移动提醒事项", function () {
      var moving = [];
      var byList = {};
      ids.forEach(function (id) { var h = findRem(id); if (h) (byList[h.L.path] = byList[h.L.path] || []).push(id); });
      Object.keys(byList).forEach(function (p) {
        if (p === toPath) return;
        edit(p, function (x) {
          var ids2 = byList[p];
          x.items.forEach(function (y) { if (ids2.indexOf(y.id) >= 0 || ids2.indexOf(y.parent) >= 0) moving.push(y); });
          x.items = x.items.filter(function (y) { return moving.indexOf(y) < 0; });
        });
      });
      var same = (byList[toPath] || []);
      edit(toPath, function (x) {
        var sameItems = x.items.filter(function (y) { return same.indexOf(y.id) >= 0 || same.indexOf(y.parent) >= 0; });
        x.items = x.items.filter(function (y) { return sameItems.indexOf(y) < 0; });
        var ins = sameItems.concat(moving.map(function (y) { var c = Object.assign({}, y); if (c.parent && moving.every(function (m) { return m.id !== c.parent; })) c.parent = ""; return c; }));
        if (!ins.length) return false;
        var at = beforeId ? x.items.findIndex(function (y) { return y.id === beforeId; }) : -1;
        if (at < 0) at = x.items.length;
        Array.prototype.splice.apply(x.items, [at, 0].concat(ins));
      });
    });
  }
  // 缩进：变成上面那一条（同一层的父项）的子任务；取消缩进：回到顶层（排在原来的父项和它的子任务后面）
  function indent(id, dir) {
    var hit = findRem(id);
    if (!hit || hit.L.error) return;
    edit(hit.L.path, function (x) {
      var i = x.items.findIndex(function (y) { return y.id === id; }), y = x.items[i];
      if (dir > 0) {
        if (y.parent) return false;
        if (x.items.some(function (k) { return k.parent === y.id; })) return false; // 自己有子任务的不能再缩进（只有一层）
        var prev = null;
        for (var j = i - 1; j >= 0; j--) if (!x.items[j].parent) { prev = x.items[j]; break; }
        if (!prev) return false;
        y.parent = prev.id;
      } else {
        if (!y.parent) return false;
        var par = y.parent;
        y.parent = "";
        x.items.splice(i, 1);
        var last = x.items.findIndex(function (k) { return k.id === par; });
        while (x.items[last + 1] && x.items[last + 1].parent === par) last++;
        x.items.splice(last + 1, 0, y);
      }
    }, dir > 0 ? "缩进提醒事项" : "取消缩进提醒事项");
  }
  function clearCompleted(scopeIds) {
    var n = scopeIds.length;
    if (!n) return;
    D.alert({ window: APP, title: "要删除 " + n + " 个已完成的提醒事项吗？", message: "可以用「编辑 → 撤销」恢复。", icon: "caution",
      buttons: [{ label: "取消", role: "cancel" }, { label: "删除", role: "destructive" }] }).then(function (b) { if (b === "删除") deleteItems(scopeIds); });
  }

  // ======== 日期的小菜单（「添加日期」胶囊、右键菜单）========
  function dateItems(ids, cur) {
    var t = today0(), sat = K.addDays(t, (6 - t.getDay() + 7) % 7 || 7), mon = K.addDays(t, ((8 - t.getDay()) % 7) || 7);
    var set = function (d) { return function () { withEdit(function () { setField(ids, function (y) { y.due = d; }, d ? "设定日期" : "移除日期"); }); }; };
    return [
      { label: "今天", run: set(K.ymd(t)) },
      { label: "明天", run: set(K.ymd(K.addDays(t, 1))) },
      { label: "本周末", run: set(K.ymd(sat)) },
      { label: "下周", run: set(K.ymd(mon)) },
      K.SEP,
      { label: "自定…", run: function () { var el = rowEl(ids[0]); customDate(ids, el ? el.querySelector(".rm-chip[data-a=date]") || el : M.main, cur); } },
    ].concat(cur ? [{ label: "移除日期", run: set("") }] : []);
  }
  function customDate(ids, anchor, cur) {
    var hit = findRem(ids[0]), r = hit ? hit.r : null, d = r && dueDate(r) || K.addMinutes(K.day0(new Date()), 9 * 60);
    K.pickDate(anchor, { value: d, time: true, clear: !!(r && r.due), onClear: function () { withEdit(function () { setField(ids, function (y) { y.due = ""; }, "移除日期"); }); },
      onChange: function (nd) { withEdit(function () { setField(ids, function (y) { y.due = K.local(nd, true); }, "设定日期"); }); } });
  }
  // 打开简介之前：正在编辑的先提交，焦点离开列表
  function commitEditsFirst() {
    if (!UI.editing) return;
    finishEdit();
    var a = document.activeElement;
    if (a && M.main.contains(a) && a.isContentEditable) a.blur();
    renderMain();
  }

  // ======== 简介（ⓘ）：标题、备注、URL、日期 / 时间、重复、提前提醒、旗标、优先级、列表、子任务 ========
  var REPEATS = [["", "从不"], ["FREQ=DAILY", "每天"], ["FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "工作日"], ["FREQ=WEEKLY;BYDAY=SA,SU", "周末"], ["FREQ=WEEKLY", "每周"],
    ["FREQ=WEEKLY;INTERVAL=2", "每两周"], ["FREQ=MONTHLY", "每月"], ["FREQ=MONTHLY;INTERVAL=3", "每 3 个月"], ["FREQ=MONTHLY;INTERVAL=6", "每 6 个月"], ["FREQ=YEARLY", "每年"]];
  var EARLY = [[0, "无"], [5, "5 分钟前"], [15, "15 分钟前"], [30, "30 分钟前"], [60, "1 小时前"], [120, "2 小时前"], [1440, "1 天前"], [2880, "2 天前"], [10080, "1 周前"]];
  var PRI = [[0, "无"], [1, "低"], [2, "中"], [3, "高"]];
  var infoPop = null;
  function openInfo(id, anchor) {
    commitEditsFirst();
    var hit = findRem(id);
    if (!hit) return;
    var fresh0 = rowEl(id);
    if (fresh0 && (!anchor || !anchor.isConnected)) anchor = fresh0.querySelector(".rm-info") || fresh0;
    if (!anchor || !anchor.isConnected) anchor = M.main;
    UI.selected = [id];
    paintSel();
    var box = document.createElement("div");
    box.className = "rm-info-pop";
    var ro = !!hit.L.error;
    function cur() { var h = findRem(id); return h ? h : null; }
    function upd(fn, label) { if (ro) return brokenAlert(hit.L); setField([id], fn, label); draw(); }
    function draw() {
      var h = cur();
      if (!h) { if (infoPop) infoPop.close(); return; }
      var r = h.r, d = dueDate(r), c = hex(h.L.color), kids = h.L.items.filter(function (k) { return k.parent === r.id; }).length;
      box.style.setProperty("--c", c);
      box.innerHTML =
        '<div class="rm-ip-top"><textarea class="ma-in rm-ip-title" rows="1" placeholder="标题" spellcheck="false">' + esc(r.title) + "</textarea>" +
        '<textarea class="ma-in rm-ip-notes" rows="1" placeholder="备注" spellcheck="false">' + esc(r.notes) + "</textarea>" +
        '<input class="ma-in rm-ip-url" placeholder="URL" spellcheck="false" value="' + esc(r.url) + '"></div>' +
        '<div class="rm-ip-card">' +
        row("rm-ic-red", ICON.calendar, "日期", d ? '<button class="rm-ip-val" data-a="date">' + esc(K.fmtYMD(d) + " " + "周" + K.WD[d.getDay()]) + "</button>" : "", K.toggle(!!d, "date")) +
        row("rm-ic-blue", ICON.clock, "时间", hasTime(r) ? '<input class="ma-time" data-a="time" value="' + K.hm(d) + '">' : "", K.toggle(hasTime(r), "time")) +
        (d ? row("rm-ic-gray", ICON.repeat, "重复", "", '<button class="ma-drop" data-a="repeat"><span>' + esc(repeatLabel(r)) + "</span></button>") : "") +
        (hasTime(r) ? row("rm-ic-purple", ICON.clock, "提前提醒", "", '<button class="ma-drop" data-a="early"><span>' + esc((EARLY.find(function (e) { return e[0] === r.early; }) || [0, r.early + " 分钟前"])[1]) + "</span></button>") : "") +
        "</div>" +
        '<div class="rm-ip-card">' + row("rm-ic-orange", ICON.flag, "旗标", "", K.toggle(r.flagged, "flag")) + "</div>" +
        '<div class="rm-ip-card">' +
        row("", "", "优先级", "", '<button class="ma-drop" data-a="pri"><span>' + PRI[r.priority][1] + "</span></button>") +
        row("", "", "列表", "", '<button class="ma-drop" data-a="list"><span><i class="rm-dotc" style="background:' + c + '"></i>' + esc(h.L.name) + "</span></button>") +
        (r.parent ? "" : row("", "", "子任务", "", '<span class="rm-ip-n">' + kids + "</span>")) +
        "</div>" + (ro ? '<div class="ma-banner">列表的文件读不了，现在不能改。</div>' : "");
      requestAnimationFrame(function () { autoGrow(box.querySelector(".rm-ip-title")); autoGrow(box.querySelector(".rm-ip-notes")); if (infoPop) infoPop.place(); });
      box.querySelectorAll("textarea, input").forEach(function (el) { el.disabled = ro; });
      var t = box.querySelector('[data-a="time"]');
      if (t) K.bindTime(t, function (hh, mm) { var dd = dueDate(cur().r); dd.setHours(hh, mm, 0, 0); upd(function (y) { y.due = K.local(dd, true); }, "设定时间"); });
    }
    function row(cls, ico, label, sub, ctl) {
      return '<div class="rm-ip-row">' + (ico ? '<span class="rm-ip-ico ' + cls + '">' + ico + "</span>" : "") + '<div class="rm-ip-lab"><span>' + label + "</span>" + (sub ? "<div>" + sub + "</div>" : "") + "</div>" + ctl + "</div>";
    }
    box.addEventListener("input", function (e) { if (e.target.tagName === "TEXTAREA") autoGrow(e.target); });
    box.addEventListener("change", function (e) {
      var t = e.target, v = t.value;
      if (t.classList.contains("rm-ip-title")) upd(function (y) { y.title = v.replace(/\n/g, " ").trim(); }, "更改标题");
      if (t.classList.contains("rm-ip-notes")) upd(function (y) { y.notes = v; }, "更改备注");
      if (t.classList.contains("rm-ip-url")) upd(function (y) { y.url = v.trim(); }, "更改 URL");
    });
    box.addEventListener("keydown", function (e) { if (e.isComposing || e.keyCode === 229) return;
      e.stopPropagation();
      if (e.key === "Enter" && e.target.classList.contains("rm-ip-title")) { e.preventDefault(); e.target.blur(); }
      if (e.key === "Escape") { e.preventDefault(); document.activeElement.blur(); infoPop.close(); }
    });
    box.addEventListener("click", function (e) {
      var sw = e.target.closest(".ma-switch"), b = e.target.closest("[data-a]"), h = cur();
      if (!h) return;
      var r = h.r;
      if (sw) {
        var k = sw.dataset.k, on = !sw.classList.contains("on");
        if (k === "date") upd(function (y) { y.due = on ? K.ymd(new Date()) : ""; if (!on) y.early = 0; }, on ? "设定日期" : "移除日期");
        if (k === "time") upd(function (y) { var dd = dueDate(y) || new Date(); if (on) { var nx = new Date(); nx.setMinutes(0, 0, 0); nx.setHours(nx.getHours() + 1); dd.setHours(nx.getHours(), 0, 0, 0); y.due = K.local(dd, true); } else { y.due = K.ymd(dd); y.early = 0; } }, on ? "设定时间" : "移除时间");
        if (k === "flag") upd(function (y) { y.flagged = on; }, on ? "加旗标" : "取消旗标");
        return;
      }
      if (!b || ro) return;
      var a = b.dataset.a, at = { x: b.getBoundingClientRect().left, y: b.getBoundingClientRect().bottom + 2 };
      if (a === "date") K.pickDate(b, { value: dueDate(r), onChange: function (nd) { upd(function (y) { var od = dueDate(y); if (hasTime(y)) { nd.setHours(od.getHours(), od.getMinutes()); y.due = K.local(nd, true); } else y.due = K.ymd(nd); }, "设定日期"); } });
      if (a === "repeat") D.popup(REPEATS.map(function (x) { return { label: x[1], checked: x[0] === r.repeat, run: function () { upd(function (y) { y.repeat = x[0]; }, "设定重复"); } }; }).concat([K.SEP,
        { label: "自定…", checked: !!r.repeat && !REPEATS.some(function (x) { return x[0] === r.repeat; }), run: function () { K.editRule(b, { rule: r.repeat || "FREQ=WEEKLY", start: dueDate(r), onDone: function (s) { upd(function (y) { y.repeat = s; }, "设定重复"); } }); } }]), at);
      if (a === "early") D.popup(EARLY.map(function (x) { return { label: x[1], checked: x[0] === r.early, run: function () { upd(function (y) { y.early = x[0]; }, "设定提前提醒"); } }; }), at);
      if (a === "pri") D.popup(PRI.map(function (x) { return { label: x[1], checked: x[0] === r.priority, run: function () { upd(function (y) { y.priority = x[0]; }, "设定优先级"); } }; }), at);
      if (a === "list") D.popup(lists.filter(function (L) { return !L.error; }).map(function (L) { return { label: L.name, checked: L === h.L, run: function () { if (L !== h.L) { moveItems([id], L.path); draw(); } } }; }), at);
    });
    draw();
    if (infoPop) infoPop.close();
    infoPop = K.popover(anchor, box, { className: "rm-pop", onClose: function () { var a = document.activeElement; if (a && box.contains(a)) a.blur(); infoPop = null; } });
    return infoPop;
  }
  function repeatLabel(r) { var hit = REPEATS.find(function (x) { return x[0] === r.repeat; }); return hit ? hit[1] : K.rrText(r.repeat, dueDate(r)); }
  function autoGrow(t) { if (!t) return; t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }

  // ======== 列表的简介 / 新建列表：名称、颜色、图标 ========
  function listSheet(anchor, L) {
    var isNew = !L, st = { name: L ? L.name : "", color: L ? L.color : "blue", icon: L ? L.icon || "list" : "list" };
    var box = document.createElement("div");
    box.className = "rm-lsheet";
    function draw() {
      var fake = { color: st.color, icon: st.icon };
      box.innerHTML = '<div class="rm-ls-top">' + listIcon(fake, "big") + '<input class="ma-field rm-ls-name" placeholder="列表名称" spellcheck="false" value="' + esc(st.name) + '"></div>' +
        '<div class="rm-ls-colors">' + COLORS.map(function (c) { return '<button data-c="' + c[0] + '" title="' + c[1] + '" class="' + (c[0] === st.color ? "on" : "") + '" style="background:' + hex(c[0]) + '"></button>'; }).join("") + "</div>" +
        '<div class="rm-ls-icons">' + GLYPH_KEYS.map(function (g) { return '<button data-g="' + g + '" class="' + (g === st.icon ? "on" : "") + '"><svg viewBox="0 0 20 20" style="color:var(--ma-field)">' + GLYPH[g].replace(/fill="#fff"/g, 'fill="currentColor"').replace(/stroke="#fff"/g, 'stroke="currentColor"') + "</svg></button>"; }).join("") +
        '<input class="ma-field rm-ls-emoji" maxlength="4" placeholder="😀" title="也可以用一个 emoji" value="' + esc(GLYPH[st.icon] ? "" : st.icon) + '"></div>' +
        '<div class="ma-btns"><button class="ma-pbtn" data-a="cancel">取消</button><button class="ma-pbtn default" data-a="ok">好</button></div>';
    }
    box.addEventListener("click", function (e) {
      var t = e.target.closest("button");
      if (!t) return;
      st.name = box.querySelector(".rm-ls-name").value;
      if (t.dataset.c) { st.color = t.dataset.c; draw(); focusName(); }
      else if (t.dataset.g) { st.icon = t.dataset.g; draw(); focusName(); }
      else if (t.dataset.a === "cancel") pop.close();
      else if (t.dataset.a === "ok") done();
    });
    box.addEventListener("input", function (e) { if (e.target.classList.contains("rm-ls-emoji")) { var v = e.target.value.trim(); st.name = box.querySelector(".rm-ls-name").value; st.icon = v || "list"; var ic = box.querySelector(".rm-ls-top .rm-lico"); ic.outerHTML = listIcon({ color: st.color, icon: st.icon }, "big"); } });
    box.addEventListener("keydown", function (e) { if (e.isComposing || e.keyCode === 229) return; e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); st.name = box.querySelector(".rm-ls-name").value; done(); } if (e.key === "Escape") pop.close(); });
    var focusName = function () { var n = box.querySelector(".rm-ls-name"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    function done() {
      var name = st.name.trim() || (isNew ? "新列表" : L.name);
      pop.close();
      if (isNew) { var nl = createList({ name: name, color: st.color, icon: st.icon }); UI.sel = { list: nl.path }; UI.query = ""; setSearch(""); saveUI(); renderAll(); return; }
      if (L.error) return brokenAlert(L);
      group("更改列表", function () { edit(L.path, function (x) { x.color = st.color; x.icon = st.icon === "list" && !L.icon ? "" : st.icon; }); });
      if (name !== L.name) renameList(byPath(L.path) || L, name);
      renderAll();
    }
    draw();
    var pop = K.popover(anchor, box, { side: isNew ? "top" : "right", className: "rm-pop" });
    setTimeout(focusName, 30);
    return pop;
  }

  // ======== 工具栏、侧边栏、列表的事件 ========
  function setSearch(v) { if (!M) return; var i = M.side.querySelector(".ma-search input"); if (i && i.value !== v) i.value = v; M.side.querySelector(".ma-search").classList.toggle("has", !!v); }
  function bindToolbar() {
    M.tb.addEventListener("click", function (e) {
      var b = e.target.closest("[data-b]");
      if (b) tbAction(b.dataset.b, b);
    });
  }
  // 工具栏上一个按钮做的事；手机上的版式用自己的按钮调进来（b = 那个按钮：菜单挂在它旁边）
  function tbAction(k, b) {
    if (k === "sidebar") M.toggleSide();
    if (k === "plus") newDraft();
    if (k === "more") D.popup(moreMenu(), { x: b.getBoundingClientRect().left, y: b.getBoundingClientRect().bottom + 6 });
    if (k === "share") D.popup(shareMenu(), { x: b.getBoundingClientRect().left, y: b.getBoundingClientRect().bottom + 6 });
    if (k === "addlist") listSheet(b, null);
  }
  function bindSide() {
    var side = M.side, input = side.querySelector(".ma-search input");
    input.addEventListener("input", function () { finishEdit(); UI.query = input.value.trim(); UI.selected = []; side.querySelector(".ma-search").classList.toggle("has", !!input.value); renderAll(); });
    input.addEventListener("keydown", function (e) { if (e.isComposing || e.keyCode === 229) return; e.stopPropagation(); if (e.key === "Escape") { input.value = ""; UI.query = ""; setSearch(""); renderAll(); input.blur(); } });
    side.querySelector(".ma-clear").addEventListener("mousedown", function (e) { e.preventDefault(); input.value = ""; UI.query = ""; setSearch(""); renderAll(); });
    side.addEventListener("click", function (e) {
      var card = e.target.closest(".rm-card"), li = e.target.closest(".rm-li");
      if (e.target.closest(".rm-addlist")) return listSheet(e.target.closest(".rm-addlist"), null);
      if (!card && !li) return;
      var same = !UI.query && (card ? UI.sel.smart === card.dataset.smart : UI.sel.list === li.dataset.path);
      if (same) return; // 点已经选中的：不重画（连点两下改名时，第二下不能把正要改名的那一行换掉）
      finishEdit();
      UI.query = "";
      setSearch("");
      UI.sel = card ? { smart: card.dataset.smart } : { list: li.dataset.path };
      UI.selected = [];
      UI.draft = null;
      saveUI();
      renderAll();
      M.main.querySelector(".rm-body").scrollTop = 0;
    });
    side.addEventListener("dblclick", function (e) {
      var li = e.target.closest(".rm-li");
      if (!li || !e.target.closest(".rm-lname")) return;
      var cur = M.side.querySelector('.rm-li[data-path="' + CSS.escape(li.dataset.path) + '"]'); // 第一下点击可能已经重画过
      if (cur) inlineRename(cur);
    });
    side.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      var li = e.target.closest(".rm-li"), card = e.target.closest(".rm-card");
      if (card) return D.popup([{ label: "显示“" + smartName(card.dataset.smart) + "”", run: function () { card.click(); } }], { x: e.clientX, y: e.clientY });
      if (!li) return D.popup([{ label: "新建列表…", run: function () { listSheet(side.querySelector(".rm-addlist"), null); } }], { x: e.clientX, y: e.clientY });
      var L = byPath(li.dataset.path);
      if (!L) return;
      D.popup([
        { label: "显示简介", run: function () { listSheet(li, L); } },
        { label: "重新命名", disabled: !!L.error, run: function () { inlineRename(li); } },
        { label: "设为默认列表", checked: defaultList(false) === L, disabled: !!L.error, run: function () { K.store.set("tsu-rem-default", L.path); } },
        K.SEP,
        { label: "在访达中显示文件", run: function () { revealFile(L.path); } },
        { label: "拷贝为文本", run: function () { copyText(L); } },
        K.SEP,
        { label: "删除", run: function () { deleteList(L); } },
      ], { x: e.clientX, y: e.clientY });
    });
    // 拖动：列表之间换顺序；提醒事项拖到列表上 = 挪进去
    var dragList = null;
    side.addEventListener("dragstart", function (e) {
      var li = e.target.closest(".rm-li");
      if (!li) return;
      dragList = li.dataset.path;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", byPath(dragList) ? byPath(dragList).name : "");
    });
    side.addEventListener("dragend", function () { dragList = null; clearMarks(); });
    side.addEventListener("dragover", function (e) {
      var li = e.target.closest(".rm-li");
      clearMarks();
      if (!li) return;
      if (dragList && dragList !== li.dataset.path) { e.preventDefault(); var r = li.getBoundingClientRect(); li.classList.add(e.clientY < r.top + r.height / 2 ? "drop-above" : "drop-below"); }
      else if (dragRems && byPath(li.dataset.path) && !byPath(li.dataset.path).error) { e.preventDefault(); li.classList.add("drop-in"); }
    });
    side.addEventListener("drop", function (e) {
      var li = e.target.closest(".rm-li");
      if (!li) return;
      e.preventDefault();
      var above = li.classList.contains("drop-above");
      clearMarks();
      if (dragList) {
        var order = lists.map(function (L) { return L.path; }).filter(function (p) { return p !== dragList; }), at = order.indexOf(li.dataset.path) + (above ? 0 : 1);
        order.splice(at, 0, dragList);
        reorderLists(order);
      } else if (dragRems) moveItems(dragRems, li.dataset.path);
    });
  }
  function clearMarks() { if (!M) return; M.win.el.querySelectorAll(".drop-above, .drop-below, .drop-in").forEach(function (x) { x.classList.remove("drop-above", "drop-below", "drop-in"); }); }
  function inlineRename(li) {
    var L = byPath(li.dataset.path), nm = li.querySelector(".rm-lname");
    if (!L || L.error) return;
    nm.contentEditable = "plaintext-only";
    nm.classList.add("renaming");
    focusEnd(nm);
    document.execCommand("selectAll");
    var done = function (ok) {
      nm.removeEventListener("keydown", key);
      nm.removeEventListener("blur", blur);
      nm.contentEditable = "false";
      nm.classList.remove("renaming");
      if (ok) renameList(byPath(li.dataset.path) || L, nm.textContent);
      renderAll();
    };
    var key = function (e) { if (e.isComposing || e.keyCode === 229) return; e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); done(true); } if (e.key === "Escape") { e.preventDefault(); done(false); } };
    var blur = function () { done(true); };
    nm.addEventListener("keydown", key);
    nm.addEventListener("blur", blur);
  }
  var dragRems = null;
  function bindMain() {
    var main = M.main, body = main.querySelector(".rm-body");
    main.addEventListener("mousedown", function (e) {
      var row = e.target.closest(".rm-row");
      if (e.button !== 0) return;
      // 按钮、小胶囊不抢焦点（正在打字的那一行接着打）
      if (e.target.closest("button, a")) e.preventDefault();
      // 草稿开着、点了别处：先把草稿提交、重画，再把焦点给点到的那一行（DOM 换过了，只能放到末尾）
      if (UI.draft && !(row && row.dataset.id === "draft") && !e.target.closest(".rm-sub a")) {
        var tid = row && row.dataset.id, field = e.target.closest(".rm-notes") ? "notes" : e.target.closest(".rm-t") ? "title" : null;
        e.preventDefault();
        finishEdit();
        renderMain();
        if (tid && field && rowEl(tid)) { UI.editing = { id: tid, field: field }; focusEnd(rowEl(tid).querySelector(field === "notes" ? ".rm-notes" : ".rm-t")); }
        else if (tid) { UI.selected = [tid]; paintSel(); }
        return;
      }
      if (!row) {
        if (e.target.closest(".rm-sub a, .rm-sec")) return;
        // 点空白：提交正在编辑的；点列表底下的空白 = 新建（同 macOS）
        var add = e.target.closest(".rm-addrow, .rm-tail");
        var wasEditing = !!UI.editing;
        if (wasEditing) { e.preventDefault(); finishEdit(); renderMain(); }
        UI.selected = [];
        paintSel();
        if (add && !wasEditing) { e.preventDefault(); var sec = add.dataset.sec || lastAddable(); newDraft(sec ? { sec: sec } : {}); }
        return;
      }
      var id = row.dataset.id;
      if (e.target.closest("button, a, [contenteditable]")) {
        if (e.target.closest("[contenteditable]") && !e.metaKey && !e.shiftKey) { if (UI.editing && UI.editing.id !== id) finishEdit(); UI.selected = [id]; paintSel(); }
        return;
      }
      e.preventDefault();
      if (UI.editing && UI.editing.id !== id) { finishEdit(); renderMain(); row = rowEl(id); }
      if (e.metaKey) UI.selected = UI.selected.indexOf(id) >= 0 ? UI.selected.filter(function (x) { return x !== id; }) : UI.selected.concat([id]);
      else if (e.shiftKey && UI.selected.length) {
        var ids = visibleIds(), a = ids.indexOf(UI.selected[UI.selected.length - 1]), b = ids.indexOf(id);
        UI.selected = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
      } else UI.selected = [id];
      paintSel();
      body.focus({ preventScroll: true });
    });
    main.addEventListener("dblclick", function (e) {
      var row = e.target.closest(".rm-row");
      if (!row || e.target.closest("button, a, [contenteditable]")) return;
      var t = row.querySelector(".rm-t");
      if (t) focusEnd(t);
    });
    main.addEventListener("click", function (e) {
      var a = e.target.closest("[data-a]");
      if (!a) return;
      var row = a.closest(".rm-row"), id = row && row.dataset.id, k = a.dataset.a;
      if (k === "toggle") { UI.showDone[viewKey()] = !showDone(); saveUI(); renderMain(); return; }
      if (k === "clear") { clearCompleted(currentDoneIds()); return; }
      if (!row) return;
      if (id === "draft") {
        if (k === "date") return D.popup(draftDateItems(), { x: a.getBoundingClientRect().left, y: a.getBoundingClientRect().bottom + 4 });
        if (k === "flag") { UI.draft.preset = Object.assign({}, UI.draft.preset, { flagged: !(UI.draft.preset || {}).flagged }); a.classList.toggle("on"); a.classList.toggle("flag"); return; }
        if (k === "sug") return applySug(row);
        return;
      }
      if (k === "check") return toggleDone(id);
      if (k === "info") return openInfo(id, a);
      if (k === "kids") { UI.collapsed[id] = !UI.collapsed[id]; saveUI(); renderMain(); return; }
      if (k === "url") { var hit = findRem(id); if (hit) openURL(hit.r.url); return; }
      if (k === "date") { var h = findRem(id); return D.popup(dateItems([id], h && h.r.due), { x: a.getBoundingClientRect().left, y: a.getBoundingClientRect().bottom + 4 }); }
      if (k === "flag") { var hf = findRem(id); if (hf) withEdit(function () { setField([id], function (y) { y.flagged = !hf.r.flagged; }, hf.r.flagged ? "取消旗标" : "加旗标"); }); return; }
      if (k === "sug") return applySug(row);
    });
    // 开始 / 结束编辑：焦点进出标题、备注。从 A 行点进 B 行：B 得到焦点时先把 A 提交（不重画，DOM 上本来就是刚打的字）
    main.addEventListener("focusin", function (e) {
      var ed = e.target.closest && e.target.closest(".rm-t, .rm-notes");
      if (!ed) return;
      var row = ed.closest(".rm-row"), id = row.dataset.id, field = ed.classList.contains("rm-notes") ? "notes" : "title";
      if (id === "draft" && !UI.draft) return;
      if (UI.editing && UI.editing.id !== id) finishEdit();
      UI.editing = { id: id, field: field };
      if (id !== "draft") UI.selected = [id];
      main.querySelectorAll(".rm-row.editing").forEach(function (x) { if (x !== row) x.classList.remove("editing"); });
      row.classList.add("editing");
      paintSel();
    });
    main.addEventListener("focusout", function (e) {
      var ed = e.target.closest && e.target.closest(".rm-t, .rm-notes");
      if (!ed) return;
      var row = ed.closest(".rm-row"), to = e.relatedTarget, id = row.dataset.id;
      if (to && row.contains(to)) return; // 标题 ↔ 备注
      setTimeout(function () {
        if (!UI.editing || UI.editing.id !== id) return;
        var a = document.activeElement;
        if (a && M.main.contains(a) && a.isContentEditable) return; // 焦点还在列表里的某一行（重画后放回去的、或别的行）
        finishEdit();
        renderMain();
      }, 0);
    });
    main.addEventListener("input", function (e) {
      var t = e.target.closest(".rm-t, .rm-notes");
      if (!t) return;
      t.classList.toggle("empty", !t.textContent);
      if (t.classList.contains("rm-t")) suggest(t.closest(".rm-row"));
    });
    main.addEventListener("keydown", function (e) { if (e.isComposing || e.keyCode === 229) return;
      var t = e.target.closest && e.target.closest(".rm-t, .rm-notes");
      if (!t) return;
      var row = t.closest(".rm-row"), id = row.dataset.id, isTitle = t.classList.contains("rm-t");
      e.stopPropagation();
      if (e.key === "Enter" && isTitle && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        var hit = findRem(id), dr = UI.draft, title = textOf(t);
        if (id === "draft" && !title.trim()) { UI.editing = null; UI.draft = null; renderMain(); return; }
        var parent = id === "draft" ? dr.parent : hit ? hit.r.parent : "", sec = id === "draft" ? dr.sec : secOfRow(row), path = row.dataset.path;
        var r = finishEdit();
        newDraft({ sec: sec, after: r ? r.id : null, parent: parent, path: path });
        return;
      }
      if (e.key === "Enter" && !isTitle && (e.metaKey || e.ctrlKey)) { e.preventDefault(); t.blur(); return; }
      if (e.key === "Escape") { e.preventDefault(); t.blur(); body.focus({ preventScroll: true }); return; }
      if (e.key === "Tab") {
        e.preventDefault();
        if (id === "draft") { draftIndent(e.shiftKey ? -1 : 1); return; }
        var cur = finishEdit();
        if (cur) { indent(cur.id, e.shiftKey ? -1 : 1); UI.editing = { id: cur.id, field: "title" }; renderMain(); }
        return;
      }
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && isTitle && !e.shiftKey && !e.altKey && !e.metaKey) {
        var rows = Array.prototype.slice.call(main.querySelectorAll(".rm-row")), i = rows.indexOf(row), next = rows[i + (e.key === "ArrowUp" ? -1 : 1)];
        if (!next) return;
        e.preventDefault();
        var nid = next.dataset.id;
        finishEdit();
        UI.editing = nid === "draft" && !UI.draft ? null : { id: nid, field: "title" };
        renderMain();
        return;
      }
      if (e.key === "Backspace" && isTitle && id === "draft" && !textOf(t)) {
        e.preventDefault();
        var before = row.previousElementSibling;
        UI.editing = null;
        UI.draft = null;
        if (before && before.classList.contains("rm-row")) UI.editing = { id: before.dataset.id, field: "title" };
        renderMain();
      }
      if ((e.key === "]" || e.key === "[") && e.metaKey && id !== "draft") { e.preventDefault(); var c2 = finishEdit(); if (c2) { indent(c2.id, e.key === "]" ? 1 : -1); UI.editing = { id: c2.id, field: "title" }; renderMain(); } }
      if ((e.key === "i" || e.key === "I") && e.metaKey && id !== "draft") { e.preventDefault(); openInfo(id, row.querySelector(".rm-info")); }
    });
    main.addEventListener("contextmenu", function (e) {
      var row = e.target.closest(".rm-row");
      if (!row || row.dataset.id === "draft") return;
      if (e.target.closest("[contenteditable]") && document.activeElement === e.target.closest("[contenteditable]")) return; // 正在打字：浏览器自己的菜单（拼写、粘贴）
      e.preventDefault();
      var id = row.dataset.id;
      if (UI.selected.indexOf(id) < 0) { UI.selected = [id]; paintSel(); }
      D.popup(rowMenu(UI.selected.slice()), { x: e.clientX, y: e.clientY });
    });
    // 拖：换顺序（手动排序时）、拖到侧边栏的列表上
    main.addEventListener("dragstart", function (e) {
      var row = e.target.closest && e.target.closest(".rm-row");
      if (!row || row.dataset.id === "draft" || editingNow()) { e.preventDefault(); return; }
      var id = row.dataset.id;
      if (UI.selected.indexOf(id) < 0) { UI.selected = [id]; paintSel(); }
      dragRems = UI.selected.slice();
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragRems.map(function (x) { var h = findRem(x); return h ? h.r.title : ""; }).join("\n"));
    });
    main.addEventListener("dragend", function () { dragRems = null; clearMarks(); });
    main.addEventListener("dragover", function (e) {
      var row = e.target.closest(".rm-row");
      clearMarks();
      if (!dragRems || !row || row.dataset.id === "draft" || dragRems.indexOf(row.dataset.id) >= 0) return;
      if (!canReorder(row)) return;
      e.preventDefault();
      var r = row.getBoundingClientRect();
      row.classList.add(e.clientY < r.top + r.height / 2 ? "drop-above" : "drop-below");
    });
    main.addEventListener("drop", function (e) {
      var row = e.target.closest(".rm-row");
      if (!row || !dragRems) return;
      e.preventDefault();
      var above = row.classList.contains("drop-above"), target = row.dataset.id, path = row.dataset.path;
      clearMarks();
      reorder(dragRems, path, target, above);
    });
  }
  // 手动排序时才能拖着换位置（和 macOS 一样：按日期排序的时候不行）
  function canReorder(row) {
    var k = UI.sel.list ? UI.sort[UI.sel.list] : UI.sel.smart === "all" ? UI.sort.all : "x";
    return !UI.query && (!k || k === "manual") && !!row;
  }
  function reorder(ids, path, targetId, above) {
    var hit = findRem(targetId);
    if (!hit) return;
    var outside = ids.filter(function (id) { var h = findRem(id); return h && h.L.path !== path; });
    if (outside.length) { moveItems(ids, path, above ? targetId : nextTop(hit.L, targetId)); return; }
    edit(path, function (x) {
      var moving = x.items.filter(function (y) { return ids.indexOf(y.id) >= 0 || ids.indexOf(y.parent) >= 0; });
      if (moving.some(function (y) { return y.id === targetId; })) return false;
      x.items = x.items.filter(function (y) { return moving.indexOf(y) < 0; });
      var t = x.items.findIndex(function (y) { return y.id === targetId; }), tgt = x.items[t];
      if (!above) { t++; while (x.items[t] && x.items[t].parent === tgt.id) t++; }
      // 拖到子任务中间：跟着成为同一个父项的子任务；拖到顶层：变回顶层
      var par = tgt.parent || "";
      moving.forEach(function (y) { if (ids.indexOf(y.id) >= 0 && !moving.some(function (m) { return m.id === y.parent && ids.indexOf(m.id) >= 0; })) y.parent = x.items.some(function (k) { return k.parent === y.id; }) ? "" : par; });
      Array.prototype.splice.apply(x.items, [t, 0].concat(moving));
    }, "移动提醒事项");
  }
  function nextTop(L, id) { var i = L.items.findIndex(function (y) { return y.id === id; }); for (var j = i + 1; j < L.items.length; j++) if (!L.items[j].parent) return L.items[j].id; return null; }
  function secOfRow(row) { var g = row.closest(".rm-group"); return g ? g.dataset.sec : null; }
  function lastAddable() { var s = (M.secs || []).filter(function (x) { return !x.noAdd && x.L; }); return s.length ? s[s.length - 1].key : null; }
  function visibleIds() { return Array.prototype.map.call(M.main.querySelectorAll(".rm-row:not(.draft)"), function (x) { return x.dataset.id; }); }
  function paintSel() { if (!M) return; M.main.querySelectorAll(".rm-row").forEach(function (x) { x.classList.toggle("sel", UI.selected.indexOf(x.dataset.id) >= 0); }); }
  function currentDoneIds() {
    var out = [];
    if (UI.sel.list) { var L = byPath(UI.sel.list); if (L) L.items.forEach(function (r) { if (r.done) out.push(r.id); }); return out; }
    var k = UI.sel.smart;
    allItems().forEach(function (x) { var r = x.r; if (r.done && (k === "all" || k === "completed" || (k === "flagged" && r.flagged) || (k === "today" && r.due && isToday(r)) || (k === "scheduled" && r.due))) out.push(r.id); });
    return out;
  }
  function draftIndent(dir) {
    var dr = UI.draft, row = rowEl("draft");
    if (!dr || !row) return;
    dr.title = textOf(row.querySelector(".rm-t"));
    if (dir > 0 && !dr.parent) {
      var prev = row.previousElementSibling;
      while (prev && !(prev.classList.contains("rm-row") && !prev.classList.contains("sub"))) prev = prev.previousElementSibling;
      if (prev) { dr.parent = prev.dataset.id; if (!dr.after) dr.after = prev.dataset.id; }
    } else if (dir < 0) dr.parent = "";
    renderMain();
  }
  function draftDateItems() {
    var t = today0(), sat = K.addDays(t, (6 - t.getDay() + 7) % 7 || 7), mon = K.addDays(t, ((8 - t.getDay()) % 7) || 7);
    var set = function (d) { return function () { var row = rowEl("draft"); if (row) UI.draft.title = textOf(row.querySelector(".rm-t")); UI.draft.preset = Object.assign({}, UI.draft.preset, { due: d }); renderMain(); }; };
    return [{ label: "今天", run: set(K.ymd(t)) }, { label: "明天", run: set(K.ymd(K.addDays(t, 1))) }, { label: "本周末", run: set(K.ymd(sat)) }, { label: "下周", run: set(K.ymd(mon)) }]
      .concat(UI.draft.preset && UI.draft.preset.due ? [K.SEP, { label: "移除日期", run: set("") }] : []);
  }
  // 打字时认出了日期：多一个建议胶囊（点了就用上）
  function suggest(row) {
    var chip = row && row.querySelector(".rm-chip.sug");
    if (!chip) return;
    var nl = K.parseNatural(textOf(row.querySelector(".rm-t")));
    UI.sug = nl && nl.rest ? nl : null;
    chip.hidden = !UI.sug;
    if (UI.sug) chip.innerHTML = ICON.calendar + esc(K.relDay(nl.date) + (nl.time ? " " + K.hm(nl.date) : ""));
  }
  function applySug(row) {
    var nl = UI.sug, t = row.querySelector(".rm-t");
    if (!nl) return;
    var due = nl.time ? K.local(nl.date, true) : K.ymd(nl.date);
    if (row.dataset.id === "draft") { UI.draft.preset = Object.assign({}, UI.draft.preset, { due: due }); UI.draft.title = nl.rest; UI.editing = { id: "draft", field: "title" }; renderMain(); return; }
    t.textContent = nl.rest;
    var id = row.dataset.id;
    finishEdit();
    setField([id], function (y) { y.due = due; }, "设定日期");
    UI.editing = { id: id, field: "title" };
    renderMain();
  }
  function openURL(u) {
    var url = K.safeURL(u);
    if (!url) return;
    if (/^https?:/i.test(url) && window.TSU_SAFARI && TSU_SAFARI.open) TSU_SAFARI.open(url); else window.open(url, "_blank", "noopener");
  }
  function revealFile(p) { var F = window.TSU_FINDER; if (F && F.reveal) F.reveal(p); }
  function copyText(L) {
    var lines = [L.name, ""];
    treeRows(L, function (r) { return !r.done; }).forEach(function (x) { lines.push((x.depth ? "    " : "") + "○ " + x.r.title + (x.r.due ? "（" + K.relDay(dueDate(x.r)) + (hasTime(x.r) ? " " + K.hm(dueDate(x.r)) : "") + "）" : "")); });
    var t = lines.join("\n") + "\n";
    if (navigator.clipboard) navigator.clipboard.writeText(t).catch(function () {});
  }

  // ======== 菜单 ========
  function rowMenu(ids) {
    var hs = ids.map(findRem).filter(Boolean);
    if (!hs.length) return [];
    var r = hs[0].r, allDone = hs.every(function (h) { return h.r.done; }), allFlag = hs.every(function (h) { return h.r.flagged; });
    return [
      { label: allDone ? "标记为未完成" : "标记为已完成", run: function () { hs.forEach(function (h) { if (h.r.done === allDone) toggleDone(h.r.id); }); } },
      { label: "显示简介", keys: "⌘I", disabled: hs.length > 1, run: function () { var el = rowEl(r.id); openInfo(r.id, el ? el.querySelector(".rm-info") : M.main); } },
      K.SEP,
      { label: "日期", items: dateItems(ids, r.due) },
      { label: allFlag ? "取消旗标" : "旗标", keys: "⇧⌘F", run: function () { setField(ids, function (y) { y.flagged = !allFlag; }, allFlag ? "取消旗标" : "加旗标"); } },
      { label: "优先级", items: PRI.map(function (p) { return { label: p[1], checked: hs.every(function (h) { return h.r.priority === p[0]; }), run: function () { setField(ids, function (y) { y.priority = p[0]; }, "设定优先级"); } }; }) },
      { label: "列表", items: lists.filter(function (L) { return !L.error; }).map(function (L) { return { label: L.name, checked: hs.every(function (h) { return h.L === L; }), run: function () { moveItems(ids, L.path); } }; }) },
      K.SEP,
      { label: "缩进提醒事项", keys: "⌘]", disabled: hs.length > 1 || !!r.parent, run: function () { indent(r.id, 1); } },
      { label: "取消缩进提醒事项", keys: "⌘[", disabled: hs.length > 1 || !r.parent, run: function () { indent(r.id, -1); } },
      K.SEP,
      { label: "拷贝", run: function () { if (navigator.clipboard) navigator.clipboard.writeText(hs.map(function (h) { return h.r.title; }).join("\n")).catch(function () {}); } },
      { label: "删除", keys: "⌫", run: function () { deleteItems(ids); } },
    ];
  }
  function moreMenu() {
    var key = viewKey(), sortable = UI.sel.list || UI.sel.smart === "all";
    var sortKey = UI.sel.list || "all", cur = UI.sort[sortKey] || "manual";
    var items = [
      { label: showDone() ? "隐藏已完成的提醒事项" : "显示已完成的提醒事项", keys: "⇧⌘H", disabled: key === "completed" || key === "search", run: function () { UI.showDone[key] = !showDone(); saveUI(); renderMain(); } },
    ];
    if (sortable && !UI.query) items.push({ label: "排序方式", items: [["manual", "手动"], ["due", "截止日期"], ["created", "创建日期"], ["priority", "优先级"], ["title", "标题"]].map(function (s) {
      return { label: s[1], checked: cur === s[0], run: function () { UI.sort[sortKey] = s[0]; saveUI(); renderMain(); } };
    }) });
    var L = UI.sel.list && byPath(UI.sel.list);
    if (L) items.push(K.SEP, { label: "显示列表简介…", run: function () { var li = M.side.querySelector('.rm-li[data-path="' + CSS.escape(L.path) + '"]'); listSheet(li || M.tb, L); } },
      { label: "在访达中显示文件", run: function () { revealFile(L.path); } }, K.SEP, { label: "删除列表…", run: function () { deleteList(L); } });
    return items;
  }
  function shareMenu() {
    var L = UI.sel.list && byPath(UI.sel.list);
    return [
      { label: "拷贝为文本", disabled: !L, run: function () { copyText(L); } },
      { label: "在访达中显示数据文件", run: function () { revealFile(L ? L.path : DIR); } },
      { label: "在编辑器中打开 README", disabled: !window.TSU_IDE, run: function () { store.ensure(); if (window.TSU_IDE && TSU_IDE.open) TSU_IDE.open(DIR + "/README.md"); } },
    ];
  }
  function menus() {
    var sel = UI.selected.slice(), one = sel.length === 1 ? findRem(sel[0]) : null, L = UI.sel.list && byPath(UI.sel.list);
    var ul = undo.undoLabel(), rl = undo.redoLabel();
    return [
      { title: "文件", items: [
        { label: "新建提醒事项", keys: "⌥⌘N", run: function () { newDraft(); } },
        { label: "新建列表…", keys: "⇧⌥⌘N", run: function () { listSheet(M.side.querySelector(".rm-addlist"), null); } },
        K.SEP,
        { label: "在访达中显示数据文件", run: function () { revealFile(L ? L.path : DIR); } },
        { label: "拷贝列表为文本", disabled: !L, run: function () { copyText(L); } },
      ] },
      { title: "编辑", items: [
        { label: ul !== null ? "撤销" + ul : "撤销", keys: "⌘Z", disabled: ul === null, run: function () { finishEdit(); undo.undo(); renderAll(); } },
        { label: rl !== null ? "重做" + rl : "重做", keys: "⇧⌘Z", disabled: rl === null, run: function () { finishEdit(); undo.redo(); renderAll(); } },
        K.SEP,
        { label: "删除", keys: "⌫", disabled: !sel.length, run: function () { deleteItems(sel); } },
        { label: "全选", keys: "⌘A", run: function () { UI.selected = visibleIds(); paintSel(); } },
        K.SEP,
        { label: one && one.r.done ? "标记为未完成" : "标记为已完成", disabled: !sel.length, run: function () { sel.forEach(toggleDone); } },
        { label: one && one.r.flagged ? "取消旗标" : "旗标", keys: "⇧⌘F", disabled: !sel.length, run: function () { var f = !(one && one.r.flagged); setField(sel, function (y) { y.flagged = f; }, f ? "加旗标" : "取消旗标"); } },
        { label: "缩进提醒事项", keys: "⌘]", disabled: !one || !!one.r.parent, run: function () { indent(one.r.id, 1); } },
        { label: "取消缩进提醒事项", keys: "⌘[", disabled: !one || !one.r.parent, run: function () { indent(one.r.id, -1); } },
        K.SEP,
        { label: "显示简介", keys: "⌘I", disabled: !one, run: function () { var el = rowEl(one.r.id); openInfo(one.r.id, el ? el.querySelector(".rm-info") : M.main); } },
        { label: "查找", keys: "⌘F", run: focusSearch },
      ] },
      { title: "显示", items: [
        { label: M && M.sideShown() ? "隐藏边栏" : "显示边栏", keys: "⌃⌘S", run: function () { M.toggleSide(); } },
        K.SEP,
        { label: showDone() ? "隐藏已完成的提醒事项" : "显示已完成的提醒事项", keys: "⇧⌘H", run: function () { UI.showDone[viewKey()] = !showDone(); saveUI(); renderMain(); } },
      ].concat(moreMenu().filter(function (x) { return x.label === "排序方式"; }), [K.SEP], SMART.map(function (s) {
        return { label: s[1], checked: !UI.query && UI.sel.smart === s[0], run: function () { UI.query = ""; setSearch(""); UI.sel = { smart: s[0] }; saveUI(); renderAll(); } };
      })) },
      { title: "帮助", items: [{ label: "数据文件格式（README.md）", run: function () { store.ensure(); if (window.TSU_IDE && TSU_IDE.open) TSU_IDE.open(DIR + "/README.md"); else revealFile(DIR + "/README.md"); } }] },
    ];
  }
  function appMenu() {
    return [
      { label: "关于提醒事项", run: function () { D.alert({ window: APP, icon: "app", title: "提醒事项", message: "数据是 " + DIR.replace(FS.HOME, "~") + " 里的 JSON 文件，agent 可以直接读写。", buttons: [{ label: "好", role: "default" }] }); } },
      { label: "设置…", run: settings },
    ];
  }
  function settings() {
    if (!M) open();
    var box = document.createElement("div");
    box.className = "rm-settings";
    var def = defaultList(false), hour = K.store.get("tsu-rem-allday-hour", 9);
    box.innerHTML = '<h3>提醒事项设置</h3><div class="ma-row"><span class="ma-lab">默认列表</span><button class="ma-drop" data-a="def"><span>' + esc(def ? def.name : "（无）") + "</span></button></div>" +
      '<div class="ma-row"><span class="ma-lab">今天通知</span>' + K.timeField(K.pad(hour) + ":00") + '</div><p>只有日期、没有时间的提醒事项在这个时间通知。</p><div class="ma-btns"><button class="ma-pbtn default" data-a="ok">完成</button></div>';
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-a]");
      if (!b) return;
      if (b.dataset.a === "ok") pop.close();
      if (b.dataset.a === "def") D.popup(lists.filter(function (L) { return !L.error; }).map(function (L) { return { label: L.name, checked: L === defaultList(false), run: function () { K.store.set("tsu-rem-default", L.path); b.querySelector("span").textContent = L.name; } }; }), { x: b.getBoundingClientRect().left, y: b.getBoundingClientRect().bottom + 2 });
    });
    K.bindTime(box.querySelector(".ma-time"), function (h) { K.store.set("tsu-rem-allday-hour", h); });
    var r = M.win.el.getBoundingClientRect();
    var pop = K.popover({ left: r.left + r.width / 2 - 1, right: r.left + r.width / 2 + 1, top: r.top + 40, bottom: r.top + 46, width: 2, height: 6 }, box, { side: "bottom", className: "rm-pop" });
  }
  function focusSearch() { if (!M) return; if (!M.sideShown()) M.toggleSide(true); var i = M.side.querySelector(".ma-search input"); i.focus(); i.select(); }

  // ======== 快捷键（只在提醒事项在最前时）========
  function onKey(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (!M || D.front() !== M.win || M.win.state === "closed" || M.win.state === "min") return;
    var a = document.activeElement, typing = a && M.win.el.contains(a) && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    var inPop = a && a.closest && a.closest(".ma-pop");
    if (inPop || document.querySelector(".ma-pop:not(.out)") && e.key === "Escape") return;
    var cmd = e.metaKey && !e.ctrlKey, k = e.key.length === 1 ? e.key.toLowerCase() : e.key, hit = null;
    if (cmd && e.altKey && !e.shiftKey && e.code === "KeyN") hit = function () { newDraft(); };
    else if (cmd && e.altKey && e.shiftKey && e.code === "KeyN") hit = function () { listSheet(M.side.querySelector(".rm-addlist"), null); };
    else if (cmd && !e.altKey && !e.shiftKey && k === "f") hit = focusSearch;
    else if (e.metaKey && e.ctrlKey && k === "s") hit = function () { M.toggleSide(); };
    else if (cmd && e.shiftKey && k === "h") hit = function () { UI.showDone[viewKey()] = !showDone(); saveUI(); renderMain(); };
    else if (!typing) {
      var sel = UI.selected;
      if (cmd && !e.shiftKey && k === "z") hit = function () { undo.undo(); renderAll(); };
      else if (cmd && e.shiftKey && k === "z") hit = function () { undo.redo(); renderAll(); };
      else if (cmd && !e.shiftKey && k === "a") hit = function () { UI.selected = visibleIds(); paintSel(); };
      else if (cmd && k === "i" && sel.length === 1) hit = function () { var el = rowEl(sel[0]); openInfo(sel[0], el ? el.querySelector(".rm-info") : M.main); };
      else if (cmd && e.shiftKey && k === "f" && sel.length) hit = function () { var h = findRem(sel[0]), f = !(h && h.r.flagged); setField(sel, function (y) { y.flagged = f; }, f ? "加旗标" : "取消旗标"); };
      else if (cmd && (e.code === "BracketRight" || e.code === "BracketLeft") && sel.length === 1) hit = function () { indent(sel[0], e.code === "BracketRight" ? 1 : -1); };
      else if ((e.key === "Backspace" || e.key === "Delete") && sel.length && !e.altKey) hit = function () { deleteItems(sel); };
      else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !cmd) hit = function () {
        var ids = visibleIds(), i = sel.length ? ids.indexOf(sel[sel.length - 1]) : -1, n = K.clamp(i + (e.key === "ArrowDown" ? 1 : -1), 0, ids.length - 1);
        if (!ids.length) return;
        if (i < 0) n = e.key === "ArrowDown" ? 0 : ids.length - 1;
        UI.selected = e.shiftKey ? sel.concat([ids[n]]) : [ids[n]];
        paintSel();
        var el = rowEl(ids[n]);
        if (el) el.scrollIntoView({ block: "nearest" });
      };
      else if (e.key === "Enter" && sel.length === 1) hit = function () { var el = rowEl(sel[0]); if (el) focusEnd(el.querySelector(".rm-t")); };
      else if (e.key === " " && sel.length) hit = function () { sel.forEach(toggleDone); };
      else if (e.key === "Escape" && (sel.length || UI.query)) hit = function () { if (sel.length) { UI.selected = []; paintSel(); } else { UI.query = ""; setSearch(""); renderAll(); } };
    }
    if (hit) { e.preventDefault(); e.stopPropagation(); hit(); }
  }

  // ======== 启动 ========
  var readyFlag = false;
  var dockSpan = '<span class="ico sq ico-reminders">' + DOCK_ICON + "</span>";
  D.registerApp({ id: APP, name: NAME, icon: dockSpan, open: open, category: "效率" });
  dockA = D.addDockApp({ app: APP, title: NAME, className: "ico-reminders", icon: DOCK_ICON, onOpen: open });
  K.describe({ id: APP, name: NAME + " (Reminders)", path: DIR,
    about: "one JSON file per list, `<list name>.json` = {name, color, icon, order, reminders:[{id, title, notes, done, doneAt, due, early, priority 0-3, flagged, url, repeat (RRULE), parent (id of the parent; one level of subtasks), tags, created}]}. " +
      "Array order = display order. Dates are local time" + (TZ ? " (" + TZ + ")" : "") + ": \"YYYY-MM-DD\" or \"YYYY-MM-DDTHH:MM\"; the app notifies at the due time. Keep fields you don't know; new list = new file; to delete a list move its file to ~/.Trash. Full format: README.md in that folder." });
  FS.ready().then(function () {
    loadAll();
    readyFlag = true;
    store.watch(reload);
    changed();
    K.settled(function () {
      store.ensure();
      K.shareWithAgents(DIR);
      loadAll(); // 先按真沙盒里的重新读一遍（同日历：拿接上以前那份判断，每台新设备都会再建一个「提醒事项」）
      if (!lists.length) { createList({ name: "提醒事项", color: "blue", icon: "list" }); loadAll(); }
      changed();
      tick();
      K.every(15000, tick);
    });
  });
  // 过了午夜：今天 / 计划的分组、Dock 上的数字跟着换
  var dayWas = new Date().getDate();
  K.every(60000, function () { if (new Date().getDate() !== dayWas) { dayWas = new Date().getDate(); changed(); } });
  window.TSU_REMINDERS = { open: open, dir: DIR, lists: function () { return lists; }, reload: function () { loadAll(); changed(); }, ready: function () { return readyFlag; },
    // 手机上的版式（ios/apps.js）用：工具栏的动作（plus、more、share、addlist）、现在选的是哪个列表
    action: function (k, anchor) { if (M) tbAction(k, anchor || M.tb); },
    state: function () { return { sel: UI.sel, query: UI.query, editing: !!UI.editing }; } };
})();
