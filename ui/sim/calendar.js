// calendar.js —— 日历（同 macOS 26）
// 数据：~/Library/Calendars/<日历名>.json，一个日历一个文件（格式见那个文件夹里的 README.md）；放进去的 .ics 文件是只读的订阅日历。
//   agent 用文件工具读写，App 马上跟着变；App 改之前先重读、按 id 合并，不会冲掉别人刚写的；文件写坏了只读不写
// 界面：日 / 周 / 月 / 年四种视图、今天、前后翻；侧边栏是日历列表（颜色、勾选显示）和迷你月历；点、拖新建，拖动挪时间、拉下边改长短；
//   事件的简介浮层（标题、位置、全天、开始 / 结束、重复、提醒、日历、备注、URL）；重复事件问「仅此事件 / 将来所有事件」；
//   快速事件（「明天下午3点开会」）、搜索、农历与节气、到点提醒；.ics 导入（访达里打开 .ics）、导出
(function () {
  "use strict";
  var K = window.TSU_APPKIT;
  if (!K) return;
  var FS = K.FS, D = K.D, esc = K.esc, ICON = K.ICON;
  var APP = "calendar", NAME = "日历", DIR = FS.HOME + "/Library/Calendars";
  var TZ = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; } })();

  var README = [
    "# 日历",
    "",
    "「日历」App 的数据就是这个文件夹：**一个日历一个 JSON 文件**（`<日历名>.json`）。App 开着时，这里的改动马上显示出来；App 里的改动也马上写回这里。",
    "",
    "```json",
    "{",
    '  "name": "工作",',
    '  "color": "blue",',
    '  "order": 0,',
    '  "events": [',
    '    { "id": "e-1a2b3c", "title": "周会", "start": "2026-09-28T10:00", "end": "2026-09-28T11:00", "location": "3 楼会议室", "repeat": "FREQ=WEEKLY;BYDAY=MO", "alerts": [15] },',
    '    { "id": "e-4d5e6f", "title": "国庆假期", "start": "2026-10-01", "end": "2026-10-07", "allDay": true }',
    "  ]",
    "}",
    "```",
    "",
    "## 日历",
    "",
    "| 字段 | 说明 |",
    "|---|---|",
    "| `name` | 日历名（不写就用文件名） |",
    "| `color` | `red` `orange` `yellow` `green` `mint` `cyan` `blue` `indigo` `purple` `pink` `brown` `gray`，或 `#RRGGBB` |",
    "| `order` | 侧边栏里的顺序 |",
    "| `events` | 事件 |",
    "",
    "## 事件",
    "",
    "| 字段 | 说明 |",
    "|---|---|",
    "| `id` | 唯一的字符串。新建时可以不写，App 下次保存这个文件时补上 |",
    "| `title` | 标题 |",
    "| `start` / `end` | 本地时间" + (TZ ? "（时区 " + TZ + "）" : "") + "：有时间的写 `YYYY-MM-DDTHH:MM`；全天的写 `YYYY-MM-DD`，`end` 是**最后一天（含）**。不写 `end`：有时间的算 1 小时，全天的算一天 |",
    "| `allDay` | 全天（`start` 只有日期时自动算全天） |",
    "| `location` | 位置 |",
    "| `notes` / `url` | 备注、链接 |",
    "| `repeat` | 重复：iCalendar 的 RRULE，如 `FREQ=WEEKLY;BYDAY=MO,WE`、`FREQ=MONTHLY;BYMONTHDAY=15`、`FREQ=YEARLY`、`FREQ=DAILY;COUNT=5`、`FREQ=WEEKLY;UNTIL=20261231`；也认 `daily` `weekdays` `weekly` `monthly` `yearly` |",
    "| `exdates` | 重复事件里跳过的日子：`[\"2026-10-05\"]` |",
    "| `alerts` | 提醒：开始前几分钟，如 `[15]`、`[0]`（开始时）；全天事件从当天 0 点算，`-540` = 当天上午 9 点 |",
    "| `created` | 创建时间 |",
    "",
    "## 约定",
    "",
    "- 新建日历 = 新建一个 `.json` 文件；删除日历 = 把文件移到废纸篓（`~/.Trash`），不要直接删",
    "- 改的时候请保留你不认识的字段；App 也会保留你加的字段",
    "- 放进这个文件夹的 `.ics` 文件显示成只读的「订阅」日历",
    "- 文件写坏了（不是合法的 JSON）：App 把这个日历标成读不了，不会覆盖它；改好就恢复",
    "",
  ].join("\n");

  // ======== 颜色 ========
  var COLORS = [["red", "红色", "#ff3b30", "#ff453a"], ["orange", "橙色", "#ff9500", "#ff9f0a"], ["yellow", "黄色", "#ffcc00", "#ffd60a"], ["green", "绿色", "#34c759", "#30d158"],
    ["mint", "薄荷绿", "#00c7be", "#63e6e2"], ["cyan", "浅蓝色", "#32ade6", "#64d2ff"], ["blue", "蓝色", "#007aff", "#0a84ff"], ["indigo", "靛蓝色", "#5856d6", "#5e5ce6"],
    ["purple", "紫色", "#af52de", "#bf5af2"], ["pink", "粉色", "#ff2d55", "#ff375f"], ["brown", "棕色", "#a2845e", "#ac8e68"], ["gray", "灰色", "#8e8e93", "#98989d"]];
  function hex(c) {
    var hit = COLORS.find(function (x) { return x[0] === c; });
    if (hit) return K.light() ? hit[2] : hit[3];
    return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c || "") ? c : K.light() ? "#007aff" : "#0a84ff";
  }

  // ======== 农历、节气、节日（macOS 中文的「中国农历」）========
  var Lunar = (function () {
    var T = [0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, 0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
      0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, 0x06566, 0x0d4a0, 0x0ea50, 0x16a95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
      0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, 0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
      0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, 0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
      0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, 0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
      0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, 0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
      0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, 0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
      0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, 0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
      0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, 0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
      0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, 0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, 0x0d520];
    var leapM = function (y) { return T[y - 1900] & 0xf; };
    var leapD = function (y) { return leapM(y) ? (T[y - 1900] & 0x10000 ? 30 : 29) : 0; };
    var monD = function (y, m) { return T[y - 1900] & (0x10000 >> m) ? 30 : 29; };
    var yearD = function (y) { var s = 348; for (var i = 0x8000; i > 0x8; i >>= 1) s += T[y - 1900] & i ? 1 : 0; return s + leapD(y); };
    var cache = {};
    function toLunar(date) {
      var k = date.getFullYear() * 10000 + date.getMonth() * 100 + date.getDate();
      if (cache[k]) return cache[k];
      if (date.getFullYear() < 1901 || date.getFullYear() > 2099) return null;
      var off = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1900, 0, 31)) / 864e5), y = 1900, t = 0;
      for (; y < 2101 && off > 0; y++) { t = yearD(y); off -= t; }
      if (off < 0) { off += t; y--; }
      var leap = leapM(y), isLeap = false, m = 1;
      for (; m < 13 && off > 0; m++) {
        if (leap > 0 && m === leap + 1 && !isLeap) { --m; isLeap = true; t = leapD(y); } else t = monD(y, m);
        if (isLeap && m === leap + 1) isLeap = false;
        off -= t;
      }
      if (off === 0 && leap > 0 && m === leap + 1) { if (isLeap) isLeap = false; else { isLeap = true; --m; } }
      if (off < 0) { off += t; --m; }
      var r = { y: y, m: m, d: off + 1, leap: isLeap, big: (isLeap ? leapD(y) : monD(y, m)) === 30 };
      cache[k] = r;
      return r;
    }
    var MN = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
    var DN = ["初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
      "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"];
    // 节气（寿星公式，21 世纪；已知的几个例外单独改）
    var TERMS = ["小寒", "大寒", "立春", "雨水", "惊蛰", "春分", "清明", "谷雨", "立夏", "小满", "芒种", "夏至", "小暑", "大暑", "立秋", "处暑", "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至"];
    var C21 = [5.4055, 20.12, 3.87, 18.73, 5.63, 20.646, 4.81, 20.1, 5.52, 21.04, 5.678, 21.37, 7.108, 22.83, 7.5, 23.13, 7.646, 23.042, 8.318, 23.438, 7.438, 22.36, 7.18, 21.94];
    var FIX = { "2008-9": 1, "2016-12": 1, "2002-14": 1, "2089-19": 1, "2089-20": 1, "2084-5": 1, "2019-0": -1, "2082-1": 1, "2026-3": -1, "2021-23": -1 };
    function term(date) {
      var y = date.getFullYear();
      if (y < 2001 || y > 2099) return "";
      var m = date.getMonth(), Y = y % 100;
      for (var j = 0; j < 2; j++) {
        var i = m * 2 + j, L = i < 4 ? Math.floor((Y - 1) / 4) : Math.floor(Y / 4);
        if (Math.floor(Y * 0.2422 + C21[i]) - L + (FIX[y + "-" + i] || 0) === date.getDate()) return TERMS[i];
      }
      return "";
    }
    var LFEST = { "1-1": "春节", "1-15": "元宵节", "2-2": "龙抬头", "5-5": "端午节", "7-7": "七夕", "7-15": "中元节", "8-15": "中秋节", "9-9": "重阳节", "12-8": "腊八节", "12-23": "小年" };
    var SFEST = { "1-1": "元旦", "2-14": "情人节", "3-8": "妇女节", "3-12": "植树节", "5-1": "劳动节", "5-4": "青年节", "6-1": "儿童节", "7-1": "建党节", "8-1": "建军节", "9-10": "教师节", "10-1": "国庆节", "12-24": "平安夜", "12-25": "圣诞节" };
    // 一天显示什么：节日 > 节气 > 初一显示月份 > 日子。{ text, kind: fest | term | month | day }
    function label(date) {
      var l = toLunar(date);
      if (!l) return null;
      var eve = !l.leap && l.m === 12 && l.d === (l.big ? 30 : 29);
      var f = eve ? "除夕" : !l.leap ? LFEST[l.m + "-" + l.d] : "";
      if (f) return { text: f, kind: "fest" };
      var s = SFEST[date.getMonth() + 1 + "-" + date.getDate()];
      if (s) return { text: s, kind: "fest" };
      var tm = term(date);
      if (tm) return { text: tm, kind: "term" };
      if (l.d === 1) return { text: (l.leap ? "闰" : "") + MN[l.m - 1] + "月", kind: "month" };
      return { text: DN[l.d - 1], kind: "day" };
    }
    function full(date) { var l = toLunar(date); return l ? "农历" + (l.leap ? "闰" : "") + MN[l.m - 1] + "月" + DN[l.d - 1] : ""; }
    return { toLunar: toLunar, label: label, full: full, term: term };
  })();

  // ======== 数据 ========
  var store = K.dataDir(DIR, README);
  var cals = [];
  var CAL_KEYS = ["name", "title", "color", "order", "events", "items", "entries"];
  var EV_KEYS = ["id", "uid", "title", "summary", "name", "start", "startDate", "dtstart", "begin", "date", "end", "endDate", "dtend", "finish", "allDay", "all_day", "isAllDay",
    "location", "place", "notes", "note", "description", "body", "url", "link", "repeat", "rrule", "recurrence", "exdates", "exceptions", "exdate", "alerts", "alert", "alarms", "reminders",
    "created", "createdAt", "duration"];
  var base = function (p) { return p.slice(p.lastIndexOf("/") + 1); };
  var stem = function (p) { return base(p).replace(/\.(json|ics)$/i, ""); };
  var str = function (v) { return v == null ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : ""; };
  var first = function () { for (var i = 0; i < arguments.length; i++) if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i]; return undefined; };
  function extraOf(o, known) { var x = {}; Object.keys(o).forEach(function (k) { if (known.indexOf(k) < 0) x[k] = o[k]; }); return x; }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  var toDate = function (v) { return typeof v === "number" ? new Date(v > 1e11 ? v : v * 1000) : K.parse(v); };
  function normAlerts(v) {
    if (v == null || v === "" || v === false) return [];
    var arr = Array.isArray(v) ? v : [v], out = [];
    arr.forEach(function (a) {
      if (typeof a === "number" && isFinite(a)) { out.push(Math.round(a)); return; }
      var m = /^(-?\d+)\s*(m|min|mins|minutes?|分钟|h|hours?|小时|d|days?|天)?$/i.exec(String(a).trim());
      if (m) out.push(+m[1] * (/^(h|hour|小时)/i.test(m[2] || "") ? 60 : /^(d|day|天)/i.test(m[2] || "") ? 1440 : 1));
    });
    return out.filter(function (x, i) { return out.indexOf(x) === i; });
  }
  function normEx(v) { return (Array.isArray(v) ? v : v ? [v] : []).map(function (s) { var d = toDate(s); return d ? K.ymd(d) : ""; }).filter(Boolean); }
  function normEvent(x, i, path) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    var sRaw = first(x.start, x.startDate, x.dtstart, x.begin, x.date);
    var s = sRaw == null || sRaw === "" ? null : toDate(sRaw);
    if (!s) return null;
    var ad = first(x.allDay, x.all_day, x.isAllDay);
    var allDay = ad === true || ad === "true" || (ad == null && typeof sRaw === "string" && K.dateOnly(sRaw));
    var eRaw = first(x.end, x.endDate, x.dtend, x.finish), e = eRaw == null || eRaw === "" ? null : toDate(eRaw);
    var ev = { title: str(first(x.title, x.summary, x.name)), location: str(first(x.location, x.place)), notes: str(first(x.notes, x.note, x.description, x.body)), url: str(first(x.url, x.link)),
      repeat: K.rrNorm(first(x.repeat, x.rrule, x.recurrence)), exdates: normEx(first(x.exdates, x.exceptions, x.exdate)), alerts: normAlerts(first(x.alerts, x.alert, x.alarms, x.reminders)),
      created: (function () { var c = toDate(first(x.created, x.createdAt)); return c ? K.local(c, true) : ""; })(), extra: extraOf(x, EV_KEYS), allDay: allDay };
    if (allDay) {
      var sd = K.day0(s), ed = e ? K.day0(e) : sd;
      if (e && typeof eRaw === "string" && !K.dateOnly(eRaw) && e.getHours() === 0 && e.getMinutes() === 0 && ed > sd) ed = K.addDays(ed, -1); // 按 iCalendar 写的「不含」结束
      if (ed < sd) ed = sd;
      ev.start = K.ymd(sd);
      ev.end = K.ymd(ed);
    } else {
      if (!e || e <= s) e = K.addMinutes(s, +x.duration > 0 ? +x.duration : 60);
      ev.start = K.local(s, true);
      ev.end = K.local(e, true);
    }
    ev.id = str(first(x.id, x.uid)) || "auto-" + hash(path + "|" + i + "|" + ev.title + "|" + ev.start);
    return ev;
  }
  function normCal(path, data) {
    var o = Array.isArray(data) ? { events: data } : data && typeof data === "object" ? data : null;
    if (!o) return { path: path, name: stem(path), color: "gray", events: [], extra: {}, error: "内容不是日历（要一个对象，或者事件的数组）" };
    var arr = Array.isArray(o.events) ? o.events : Array.isArray(o.items) ? o.items : Array.isArray(o.entries) ? o.entries : [];
    var C = { path: path, name: str(first(o.name, o.title)).trim() || stem(path), color: str(o.color) || "blue", order: typeof o.order === "number" ? o.order : null, extra: extraOf(o, CAL_KEYS), events: [], bad: [] };
    var seen = {};
    arr.forEach(function (x, i) {
      var ev = normEvent(x, i, path);
      if (!ev) { C.bad.push(x); return; } // 看不懂的（比如没有开始时间）：不显示，但原样留在文件里
      if (seen[ev.id]) ev.id += "-" + i;
      seen[ev.id] = 1;
      C.events.push(ev);
    });
    return C;
  }
  function outEvent(ev) {
    var o = { id: ev.id, title: ev.title, start: ev.start, end: ev.end };
    if (ev.allDay) o.allDay = true;
    if (ev.location) o.location = ev.location;
    if (ev.notes) o.notes = ev.notes;
    if (ev.url) o.url = ev.url;
    if (ev.repeat) o.repeat = ev.repeat;
    if (ev.exdates && ev.exdates.length) o.exdates = ev.exdates.slice();
    if (ev.alerts && ev.alerts.length) o.alerts = ev.alerts.slice();
    if (ev.created) o.created = ev.created;
    Object.keys(ev.extra || {}).forEach(function (k) { if (!(k in o)) o[k] = ev.extra[k]; });
    return o;
  }
  function outCal(C) {
    var o = { name: C.name, color: C.color || "blue" };
    if (C.order != null) o.order = C.order;
    Object.keys(C.extra || {}).forEach(function (k) { if (!(k in o)) o[k] = C.extra[k]; });
    o.events = C.events.map(outEvent).concat(C.bad || []);
    return o;
  }
  var clone = function (C) { return normCal(C.path, outCal(C)); };
  var stillLoading = function (C) { return !!(C && C.loading); };
  function readCal(p, old) {
    var r = store.read(p);
    if (r.missing) return null;
    if (r.lazy || (r.text == null && !r.error)) return old || { path: p, name: stem(p), color: "gray", events: [], extra: {}, loading: true, readOnly: /\.ics$/i.test(p) };
    if (/\.ics$/i.test(p)) {
      if (r.text == null) return { path: p, name: stem(p), color: "purple", events: [], extra: {}, readOnly: true, error: r.error };
      var ics = parseICS(r.text);
      return { path: p, name: ics.name || stem(p), color: "purple", events: ics.events.map(function (x, i) { return icsToEvent(x, i, p); }).filter(Boolean), extra: {}, readOnly: true, subscribed: true };
    }
    if (r.text == null) return { path: p, name: (old && old.name) || stem(p), color: (old && old.color) || "gray", events: [], extra: {}, error: r.error || "读不了" };
    var data;
    try { data = K.parseJSON(r.text); } catch (e) { return { path: p, name: (old && old.name) || stem(p), color: (old && old.color) || "gray", order: old ? old.order : null, events: [], extra: {}, error: "不是合法的 JSON：" + e.message }; }
    return normCal(p, data);
  }
  var isCalFile = function (p) { return p.slice(0, p.lastIndexOf("/")) === DIR && /\.(json|ics)$/i.test(p) && base(p).charAt(0) !== "."; };
  function sortCals(a) {
    return a.slice().sort(function (x, y) {
      if (!!x.subscribed !== !!y.subscribed) return x.subscribed ? 1 : -1;
      var ox = x.order == null ? 1e9 : x.order, oy = y.order == null ? 1e9 : y.order;
      return ox - oy || x.name.localeCompare(y.name, "zh");
    });
  }
  var byPath = function (p) { return cals.find(function (c) { return c.path === p; }) || null; };
  function loadAll() { cals = sortCals(store.files(null).filter(isCalFile).map(function (p) { return readCal(p, byPath(p)); }).filter(Boolean)); }
  function reload(paths) {
    var dirty = false;
    paths.forEach(function (p) {
      if (p === DIR) { loadAll(); dirty = true; return; }
      if (!isCalFile(p)) return;
      var old = byPath(p), C = readCal(p, old);
      if (C && old) cals[cals.indexOf(old)] = C; else if (C) cals.push(C); else if (old) cals.splice(cals.indexOf(old), 1);
      dirty = true;
    });
    if (!dirty) return;
    cals = sortCals(cals);
    changed();
  }
  // ---- 改：先重读 → 改 → 写回；撤销 / 重做只动改到的那几条（同提醒事项）----
  var undo = K.undoStack(), batch = null;
  function snap(C) {
    var items = {}, order = [];
    C.events.forEach(function (ev) { items[ev.id] = JSON.stringify(outEvent(ev)); order.push(ev.id); });
    return { props: JSON.stringify({ name: C.name, color: C.color, order: C.order }), items: items, order: order };
  }
  function fresh(path) {
    var cur = byPath(path);
    if (cur && cur.readOnly) return { broken: cur, ro: true };
    var r = store.readJSON(path);
    if (r.error) return { broken: Object.assign({}, cur || { path: path, name: stem(path) }, { error: r.error }) };
    if (r.data !== undefined) { var C = normCal(path, r.data); return C.error ? { broken: C } : { C: C }; }
    if (r.missing) { if (cur) setTimeout(function () { reload([path]); }, 0); return {}; }
    if (cur && cur.error) return { broken: cur };
    if (!cur || stillLoading(cur)) return {}; // 真沙盒里的内容还没取回来：先不改（不能拿空的盖掉）
    return { C: clone(cur) };
  }
  function commit(C, silent) {
    store.writeJSON(C.path, outCal(C));
    var old = byPath(C.path);
    if (old) cals[cals.indexOf(old)] = C; else cals.push(C);
    cals = sortCals(cals);
    if (!silent) changed();
  }
  function edit(path, fn, label) {
    var f = fresh(path);
    if (f.broken) { brokenAlert(f.broken, f.ro); return null; }
    if (!f.C) return null;
    var C = f.C, before = snap(C);
    if (fn(C) === false) return null;
    var after = snap(C);
    if (before.props === after.props && JSON.stringify(before.items) === JSON.stringify(after.items) && before.order.join() === after.order.join()) return C;
    commit(C);
    var rec = { path: path, before: before, after: after };
    if (batch) batch.push(rec);
    else if (label !== false) undo.push({ label: label || "", undo: function () { applySnap(rec.path, rec.after, rec.before); }, redo: function () { applySnap(rec.path, rec.before, rec.after); } });
    return C;
  }
  function group(label, fn) {
    if (batch) return fn();
    batch = [];
    try { fn(); } finally {
      var b = batch;
      batch = null;
      if (b.length) undo.push({ label: label, undo: function () { b.slice().reverse().forEach(function (x) { applySnap(x.path, x.after, x.before); }); }, redo: function () { b.forEach(function (x) { applySnap(x.path, x.before, x.after); }); } });
    }
  }
  function applySnap(path, from, to) {
    var f = fresh(path);
    if (f.broken || !f.C) return;
    var C = f.C;
    if (from.props !== to.props) { var p = JSON.parse(to.props); C.name = p.name; C.color = p.color; C.order = p.order; }
    Object.keys(from.items).forEach(function (id) { if (!(id in to.items)) C.events = C.events.filter(function (e) { return e.id !== id; }); });
    Object.keys(to.items).forEach(function (id) {
      if (from.items[id] === to.items[id]) return;
      var ev = normEvent(JSON.parse(to.items[id]), 0, path), i = C.events.findIndex(function (x) { return x.id === id; });
      if (i >= 0) C.events[i] = ev; else C.events.push(ev);
    });
    commit(C);
  }
  function brokenAlert(C, ro) {
    D.alert({ window: APP, title: ro ? "“" + C.name + "”是只读的订阅日历" : "“" + (C.name || stem(C.path)) + "”现在改不了", icon: "caution",
      message: ro ? "它来自 .ics 文件（" + C.path.replace(FS.HOME, "~") + "），不能在这里改。可以把事件拷贝到别的日历。" :
        "这个日历的文件（" + C.path.replace(FS.HOME, "~") + "）不是合法的 JSON：" + (C.error || "") + "\n\n日历不会覆盖它，免得把里面的东西弄丢。把文件改好后会自动恢复。",
      buttons: [{ label: "好", role: "default" }] });
  }
  var newId = function () { return K.uid("e-"); };
  var nowStr = function () { return K.local(new Date(), true); };
  function freePath(name, self) {
    var nm = K.safeName(name, "日历"), p = DIR + "/" + nm + ".json", n = 2;
    while (FS.exists(p) && p !== self) p = DIR + "/" + nm + " " + n++ + ".json";
    return p;
  }
  function createCal(o) {
    store.ensure();
    var maxOrder = cals.reduce(function (m, c) { return Math.max(m, c.order == null ? -1 : c.order); }, -1);
    var C = { path: freePath(o.name), name: o.name, color: o.color || "blue", order: maxOrder + 1, events: [], extra: {} };
    commit(C);
    return C;
  }
  var writable = function () { return cals.filter(function (c) { return !c.readOnly && !c.error && !c.loading; }); };
  function defaultCal(create) {
    var want = K.store.get("tsu-cal-default", ""), w = writable();
    var C = w.find(function (c) { return c.path === want && !UI.hidden[c.path]; }) || w.find(function (c) { return !UI.hidden[c.path]; }) || w[0] || null;
    if (!C && create) C = createCal({ name: "日历", color: "blue" });
    return C;
  }

  // ======== .ics：解析、生成 ========
  function unfold(t) { return String(t).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, ""); }
  var icsUnesc = function (s) { return s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1"); };
  var icsEsc = function (s) { return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); };
  function tzOffset(t, tz) {
    var f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }), p = {};
    f.formatToParts(new Date(t)).forEach(function (x) { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t;
  }
  function icsDate(v, params) {
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(v).trim());
    if (!m) return null;
    if (!m[4] || (params.VALUE || "").toUpperCase() === "DATE") return { date: new Date(+m[1], +m[2] - 1, +m[3]), allDay: true };
    var a = [+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)];
    if (m[7]) return { date: new Date(Date.UTC(a[0], a[1], a[2], a[3], a[4], a[5])), allDay: false };
    if (params.TZID && params.TZID !== TZ) {
      try { var g = Date.UTC(a[0], a[1], a[2], a[3], a[4], a[5]), off = tzOffset(g, params.TZID), t = g - off, off2 = tzOffset(t, params.TZID); return { date: new Date(off2 === off ? t : g - off2), allDay: false }; } catch (e) { /* 不认识的时区：当本地时间 */ }
    }
    return { date: new Date(a[0], a[1], a[2], a[3], a[4], a[5]), allDay: false };
  }
  function parseParams(s) { var o = {}; (s || "").split(";").forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) o[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1).replace(/^"|"$/g, ""); }); return o; }
  function durMin(v) { var m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v).trim()); if (!m) return null; var n = (+m[2] || 0) * 10080 + (+m[3] || 0) * 1440 + (+m[4] || 0) * 60 + (+m[5] || 0) + Math.round((+m[6] || 0) / 60); return m[1] === "-" ? -n : n; }
  function parseICS(text) {
    var lines = unfold(text).split("\n"), events = [], cur = null, alarm = null, name = "";
    lines.forEach(function (ln) {
      var m = /^([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$/.exec(ln);
      if (!m) return;
      var key = m[1].toUpperCase(), params = parseParams(m[2].slice(1)), val = m[3], up = val.trim().toUpperCase();
      if (key === "BEGIN" && up === "VEVENT") { cur = { alerts: [], exdates: [] }; return; }
      if (key === "END" && up === "VEVENT") { if (cur) events.push(cur); cur = null; return; }
      if (key === "BEGIN" && up === "VALARM") { alarm = {}; return; }
      if (key === "END" && up === "VALARM") { if (cur && alarm && alarm.min != null) cur.alerts.push(alarm.min); alarm = null; return; }
      if (key === "X-WR-CALNAME" && !cur) { name = icsUnesc(val); return; }
      if (!cur) return;
      if (alarm) { if (key === "TRIGGER") { var d = durMin(val); if (d != null) alarm.min = -d; } return; }
      if (key === "UID") cur.uid = val.trim();
      else if (key === "SUMMARY") cur.title = icsUnesc(val);
      else if (key === "LOCATION") cur.location = icsUnesc(val);
      else if (key === "DESCRIPTION") cur.notes = icsUnesc(val);
      else if (key === "URL") cur.url = val.trim();
      else if (key === "DTSTART") cur.start = icsDate(val, params);
      else if (key === "DTEND") cur.end = icsDate(val, params);
      else if (key === "DURATION") cur.duration = durMin(val);
      else if (key === "RRULE") cur.repeat = val.trim();
      else if (key === "EXDATE") val.split(",").forEach(function (v) { var x = icsDate(v, params); if (x) cur.exdates.push(K.ymd(x.date)); });
      else if (key === "RECURRENCE-ID") cur.recId = icsDate(val, params);
    });
    // 改过的单次（RECURRENCE-ID）：原来那一串跳过那一天
    events.forEach(function (e) { if (e.recId && e.uid) events.forEach(function (s) { if (s !== e && s.uid === e.uid && s.repeat && !s.recId) s.exdates.push(K.ymd(e.recId.date)); }); });
    return { name: name, events: events };
  }
  function icsToEvent(x, i, path) {
    if (!x.start) return null;
    var o = { id: (x.uid || "ics") + (x.recId ? "-" + x.recId.date.getTime() : "") + "-" + i, title: x.title || "", location: x.location || "", notes: x.notes || "", url: x.url || "",
      repeat: x.recId ? "" : x.repeat || "", exdates: x.exdates, alerts: x.alerts };
    if (x.start.allDay) {
      var endEx = x.end ? x.end.date : K.addDays(x.start.date, x.duration ? Math.max(1, Math.round(x.duration / 1440)) : 1);
      o.start = K.ymd(x.start.date);
      o.end = K.ymd(K.addDays(endEx, -1) < x.start.date ? x.start.date : K.addDays(endEx, -1));
      o.allDay = true;
    } else {
      o.start = K.local(x.start.date, true);
      o.end = K.local(x.end ? x.end.date : K.addMinutes(x.start.date, x.duration != null ? x.duration : 60), true);
    }
    return normEvent(o, i, path);
  }
  function fold(line) {
    var out = [], cur = "", n = 0;
    for (var ch of line) { var b = new TextEncoder().encode(ch).length; if (n + b > 73) { out.push(cur); cur = " "; n = 1; } cur += ch; n += b; }
    out.push(cur);
    return out.join("\r\n");
  }
  var compact = function (d) { return d.getFullYear() + K.pad(d.getMonth() + 1) + K.pad(d.getDate()); };
  var compactT = function (d) { return compact(d) + "T" + K.pad(d.getHours()) + K.pad(d.getMinutes()) + "00"; };
  var utcStamp = function (d) { return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""); };
  function toICS(name, events) {
    var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//code.paimon.beer//Calendar//ZH", "CALSCALE:GREGORIAN", "X-WR-CALNAME:" + icsEsc(name)];
    if (TZ) L.push("X-WR-TIMEZONE:" + TZ);
    var tzp = TZ ? ";TZID=" + TZ : "";
    events.forEach(function (ev) {
      var s = K.parse(ev.start), e = K.parse(ev.end);
      L.push("BEGIN:VEVENT", "UID:" + ev.id + "@code.paimon.beer", "DTSTAMP:" + utcStamp(new Date()));
      if (ev.allDay) L.push("DTSTART;VALUE=DATE:" + compact(s), "DTEND;VALUE=DATE:" + compact(K.addDays(e, 1)));
      else L.push("DTSTART" + tzp + ":" + compactT(s), "DTEND" + tzp + ":" + compactT(e));
      L.push("SUMMARY:" + icsEsc(ev.title || ""));
      if (ev.location) L.push("LOCATION:" + icsEsc(ev.location));
      if (ev.notes) L.push("DESCRIPTION:" + icsEsc(ev.notes));
      if (ev.url) L.push("URL:" + ev.url);
      if (ev.repeat) L.push("RRULE:" + ev.repeat);
      (ev.exdates || []).forEach(function (x) { var d = K.parse(x); if (ev.allDay) L.push("EXDATE;VALUE=DATE:" + compact(d)); else { d.setHours(s.getHours(), s.getMinutes()); L.push("EXDATE" + tzp + ":" + compactT(d)); } });
      (ev.alerts || []).forEach(function (m) { L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsEsc(ev.title || "提醒"), "TRIGGER:" + (m >= 0 ? "-" : "") + "PT" + Math.abs(m) + "M", "END:VALARM"); });
      L.push("END:VEVENT");
    });
    L.push("END:VCALENDAR");
    return L.map(fold).join("\r\n") + "\r\n";
  }

  // ======== 展开：[from, to) 里的每一次 ========
  function range(ev) {
    var s = K.parse(ev.start);
    if (ev.allDay) return { s: s, e: K.addDays(K.parse(ev.end), 1), days: K.dayDiff(s, K.parse(ev.end)) + 1 };
    return { s: s, e: K.parse(ev.end) };
  }
  function occurrences(from, to, all) {
    var out = [];
    cals.forEach(function (c) {
      if (c.error || (!all && UI.hidden[c.path])) return;
      c.events.forEach(function (ev) {
        var r = range(ev);
        if (!r.s || !r.e) return;
        if (!ev.repeat) { if (r.s < to && r.e > from) out.push(occ(c, ev, r.s, r.e)); return; }
        var ex = {}, dur = r.e - r.s;
        ev.exdates.forEach(function (d) { ex[d] = 1; });
        K.rrBetween(ev.repeat, r.s, new Date(from.getTime() - dur - 864e5), to, ex).forEach(function (s) {
          var e = ev.allDay ? K.addDays(s, r.days) : new Date(s.getTime() + dur);
          if (e > from) out.push(occ(c, ev, s, e));
        });
      });
    });
    return out.sort(function (a, b) { return a.s - b.s || (b.e - b.s) - (a.e - a.s); });
  }
  var occ = function (c, ev, s, e) { return { cal: c, ev: ev, s: s, e: e, allDay: ev.allDay, key: c.path + "|" + ev.id + "|" + s.getTime() }; };
  function findOcc(key) {
    if (!key) return null;
    var p = key.split("|"), c = byPath(p[0]), ev = c && c.events.find(function (x) { return x.id === p[1]; });
    if (!ev) return null;
    var t = +p[2], r = range(ev);
    if (!ev.repeat) return occ(c, ev, r.s, r.e);
    var s = new Date(t);
    return occ(c, ev, s, ev.allDay ? K.addDays(s, r.days) : new Date(t + (r.e - r.s)));
  }
  var isMulti = function (o) { return o.allDay || K.dayDiff(o.s, new Date(o.e.getTime() - 1)) > 0; };
  function timeText(o) {
    if (o.allDay) { var last = K.addDays(o.e, -1); return K.sameDay(o.s, last) ? "全天" : K.fmtMD(o.s) + "至" + K.fmtMD(last); }
    var same = K.sameDay(o.s, new Date(o.e.getTime() - 1));
    return same ? K.hm(o.s) + "–" + K.hm(o.e) : K.fmtMD(o.s) + " " + K.hm(o.s) + " 至 " + K.fmtMD(o.e) + " " + K.hm(o.e);
  }

  // ======== 提醒 ========
  function tick() {
    var now = Date.now(), last = K.store.get("tsu-cal-lastcheck", 0), sent = K.store.get("tsu-cal-sent", {});
    if (!last || now - last > 600000) last = now - 600000;
    occurrences(new Date(now - 864e5), new Date(now + 9 * 864e5), true).forEach(function (o) {
      (o.ev.alerts || []).forEach(function (m) {
        var t = o.s.getTime() - m * 60000, key = o.key + "|" + m;
        if (t > last && t <= now && !sent[key]) { sent[key] = now; fire(o, key); }
      });
    });
    Object.keys(sent).forEach(function (k) { if (now - sent[k] > 14 * 864e5) delete sent[k]; });
    K.store.set("tsu-cal-sent", sent);
    K.store.set("tsu-cal-lastcheck", now);
  }
  // key = 这个日程的这一次、提前几分钟的那个提醒：几台设备同时到点，账号里只有一条通知，在哪台上关掉，别的都收起（RFC 9074 的 ACKNOWLEDGED）
  function fire(o, key) {
    if (!M) build(); // 通知上的名字、图标跟着窗口走：窗口还没建就先建好（不显示）
    var when = o.allDay ? K.relDay(o.s) + " · 全天" : (K.sameDay(o.s, new Date()) ? "" : K.relDay(o.s) + " ") + timeText(o);
    D.notify({ app: APP, key: "cal:" + key, title: o.ev.title || "新建事件", body: when + (o.ev.location ? "\n" + o.ev.location : ""),
      onClick: function () { open(); UI.date = K.day0(o.s); UI.sel = o.key; render(); } });
  }

  // ======== 界面状态 ========
  var UI = {
    view: K.store.get("tsu-cal-view", "month"), date: K.day0(new Date()), sel: null, query: "", hidden: K.store.get("tsu-cal-hidden", {}), lunar: K.store.get("tsu-cal-lunar", /^zh/i.test(navigator.language || "zh")),
    scrollY: null,
  };
  function saveUI() { K.store.set("tsu-cal-view", UI.view); K.store.set("tsu-cal-hidden", UI.hidden); K.store.set("tsu-cal-lunar", UI.lunar); }
  var HOUR = 48;

  // ======== 窗口 ========
  var M = null;
  function open() {
    if (!M) build();
    if (M.win.state === "min" || M.win.state === "closed") M.win.show(); else M.win.front();
    render();
    return M.win;
  }
  function build() {
    M = K.window({ id: APP, name: NAME, className: "cal-win", width: 1060, height: 700, sideW: 216, minSide: 180, maxSide: 320, narrow: 820, menus: menus, appMenu: appMenu,
      title: function () { return NAME; }, onClose: function () { K.closePops(); }, onNarrow: function () { requestAnimationFrame(render); } });
    M.tb.innerHTML = K.group(K.btn("sidebar", "显示或隐藏日历列表") + K.btn("plus", "新建事件")) + '<span class="ma-flex"></span>' +
      '<span class="ma-seg cal-seg" data-tb>' + [["day", "日"], ["week", "周"], ["month", "月"], ["year", "年"]].map(function (v) { return '<button data-v="' + v[0] + '">' + v[1] + "</button>"; }).join("") + "</span>" +
      '<span class="ma-flex"></span>' + K.searchBox("搜索");
    M.side.insertAdjacentHTML("afterbegin", '<div class="cal-sscroll ma-scroll"><div class="cal-cals"></div></div><div class="cal-smini"></div>');
    M.main.innerHTML = '<div class="cal-head"><div class="cal-title"></div><div class="cal-nav"><button data-nav="-1" title="上一个">' + ICON.left + '</button><button data-nav="0">今天</button><button data-nav="1" title="下一个">' + ICON.right + "</button></div></div>" +
      '<div class="cal-view"></div><div class="cal-results ma-scroll" hidden></div>';
    M.mini = K.miniMonth({ value: UI.date, onPick: function (d) { UI.date = d; render(); }, marks: function (d) { return markDay(d); } });
    M.side.querySelector(".cal-smini").appendChild(M.mini.el);
    bindChrome();
    window.addEventListener("keydown", onKey, true);
    K.onTheme(render);
  }
  // 迷你月历上有事件的日子打个点：按月算一次，缓存到数据变了为止
  var markCache = null;
  function markDay(d) {
    markCache = markCache || {};
    var key = d.getFullYear() * 12 + d.getMonth();
    if (!markCache[key]) {
      var m0 = new Date(d.getFullYear(), d.getMonth(), 1), m1 = new Date(d.getFullYear(), d.getMonth() + 1, 1), set = {};
      occurrences(m0, m1).forEach(function (o) { for (var x = K.day0(o.s); x < o.e; x = K.addDays(x, 1)) set[K.ymd(x)] = 1; });
      markCache[key] = set;
    }
    return markCache[key][K.ymd(d)] ? true : null;
  }

  // ======== 画 ========
  var pend = false;
  var changeFns = []; // 日历的数据变了：通知别处（手机上的月视图自己画，要跟着重画）
  function changed() { markCache = null; changeFns.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); if (M) { if (pend) return; pend = true; requestAnimationFrame(function () { pend = false; render(); }); } }
  function render() {
    if (!M) return;
    markCache = null;
    renderSide();
    renderHead();
    var v = M.main.querySelector(".cal-view");
    v.className = "cal-view cal-v-" + UI.view;
    if (UI.view === "month") renderMonth(v);
    else if (UI.view === "year") renderYear(v);
    else renderTimeline(v, UI.view === "day" ? [UI.date] : weekDays(UI.date));
    M.tb.querySelectorAll(".cal-seg button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === UI.view); });
    M.mini.set(UI.date);
    renderResults();
  }
  function renderSide() {
    var box = M.side.querySelector(".cal-cals"), own = cals.filter(function (c) { return !c.subscribed; }), sub = cals.filter(function (c) { return c.subscribed; });
    var row = function (c) {
      return '<div class="cal-c' + (c.error ? " broken" : "") + '" data-path="' + esc(c.path) + '"><i class="cal-cb' + (UI.hidden[c.path] ? "" : " on") + '" style="--c:' + hex(c.color) + '"></i>' +
        '<span class="cal-cname">' + esc(c.name) + "</span>" + (c.error ? '<span class="cal-warn" title="文件读不了">!</span>' : "") + "</div>";
    };
    box.innerHTML = '<div class="cal-acct">' + (document.documentElement.classList.contains("ios") ? "在我的 iPhone 上" : "在我的 Mac 上") + "</div>" + own.map(row).join("") + (sub.length ? '<div class="cal-acct">订阅</div>' + sub.map(row).join("") : "") +
      '<div class="cal-acct">其他</div><div class="cal-c" data-other="lunar"><i class="cal-cb' + (UI.lunar ? " on" : "") + '" style="--c:#8e8e93"></i><span class="cal-cname">中国农历</span></div>';
  }
  function renderHead() {
    var t = M.main.querySelector(".cal-title"), d = UI.date;
    if (UI.view === "year") t.innerHTML = "<b>" + d.getFullYear() + "年</b>";
    else if (UI.view === "day") t.innerHTML = "<b>" + K.fmtYMD(d) + '</b><span class="cal-sub">星期' + K.WD[d.getDay()] + (UI.lunar && Lunar.full(d) ? " · " + Lunar.full(d) : "") + "</span>";
    else if (UI.view === "week") {
      var ds = weekDays(d), a = ds[0], b = ds[6];
      t.innerHTML = a.getMonth() === b.getMonth() ? "<span>" + a.getFullYear() + "年</span><b>" + (a.getMonth() + 1) + "月</b>" :
        "<span>" + a.getFullYear() + "年</span><b>" + (a.getMonth() + 1) + "月</b><span> – " + (a.getFullYear() !== b.getFullYear() ? b.getFullYear() + "年" : "") + "</span><b>" + (b.getMonth() + 1) + "月</b>";
    } else t.innerHTML = "<span>" + d.getFullYear() + "年</span><b>" + (d.getMonth() + 1) + "月</b>";
  }
  var weekDays = function (d) { var s = K.startOfWeek(d), out = []; for (var i = 0; i < 7; i++) out.push(K.addDays(s, i)); return out; };
  function evStyle(c) { return "--c:" + hex(c.color); }
  function lunarHTML(d) {
    if (!UI.lunar) return "";
    var l = Lunar.label(d);
    return l ? '<span class="cal-lunar ' + l.kind + '">' + l.text + "</span>" : "";
  }

  // ---- 月 ----
  function renderMonth(v) {
    var first = new Date(UI.date.getFullYear(), UI.date.getMonth(), 1), start = K.startOfWeek(first), today = K.day0(new Date());
    var occs = occurrences(start, K.addDays(start, 42));
    var h = '<div class="cal-mhead">';
    for (var i = 0; i < 7; i++) { var wd = (i + K.weekStart()) % 7; h += '<span class="' + (wd === 0 || wd === 6 ? "we" : "") + '">周' + K.WD[wd] + "</span>"; }
    h += '</div><div class="cal-mgrid">';
    for (var w = 0; w < 6; w++) {
      h += '<div class="cal-mrow" data-w="' + w + '">';
      for (var j = 0; j < 7; j++) {
        var d = K.addDays(start, w * 7 + j), cls = ["cal-mcell"];
        if (d.getMonth() !== first.getMonth()) cls.push("out");
        if (d.getDay() === 0 || d.getDay() === 6) cls.push("we");
        if (K.sameDay(d, today)) cls.push("today");
        if (K.sameDay(d, UI.date)) cls.push("sel");
        h += '<div class="' + cls.join(" ") + '" data-d="' + K.ymd(d) + '"><div class="cal-mnum">' + lunarHTML(d) + "<b>" + (d.getDate() === 1 ? d.getMonth() + 1 + "月" + d.getDate() + "日" : d.getDate()) + "</b></div></div>";
      }
      h += '<div class="cal-mev"></div></div>';
    }
    v.innerHTML = h + "</div>";
    var rows = v.querySelectorAll(".cal-mrow"), rowH = rows[0] && rows[0].offsetHeight > 40 ? rows[0].offsetHeight : 110, slots = Math.max(1, Math.floor((rowH - 26) / 19));
    rows.forEach(function (row, w) {
      var ws = K.addDays(start, w * 7), lay = weekLayout(ws, occs), cellHTML = "", vis = [];
      for (var c = 0; c < 7; c++) {
        var lanes = lay.spans.filter(function (s) { return s.a <= c && s.b >= c; }), used = lanes.reduce(function (m, s) { return Math.max(m, s.lane + 1); }, 0);
        var total = used + lay.singles[c].length;
        vis[c] = { slots: total > slots ? slots - 1 : slots, used: used, total: total };
      }
      lay.spans.forEach(function (s) {
        var cap = 99;
        for (var c2 = s.a; c2 <= s.b; c2++) cap = Math.min(cap, vis[c2].slots);
        if (s.lane >= cap) { for (var c3 = s.a; c3 <= s.b; c3++) vis[c3].hidden = (vis[c3].hidden || 0) + 1; return; }
        cellHTML += '<div class="cal-mbar' + (s.o.allDay ? " allday" : "") + (s.o.key === UI.sel ? " sel" : "") + (s.cutL ? " cutl" : "") + (s.cutR ? " cutr" : "") + '" data-k="' + esc(s.o.key) + '" style="' + evStyle(s.o.cal) +
          ";top:" + (26 + s.lane * 19) + "px;left:calc(" + (s.a * 100 / 7) + "% + 3px);width:calc(" + ((s.b - s.a + 1) * 100 / 7) + '% - 6px)"><span>' + (s.o.allDay ? "" : '<i class="cal-t">' + K.hm(s.o.s) + "</i>") + esc(s.o.ev.title || "新建事件") + "</span></div>";
      });
      for (var c4 = 0; c4 < 7; c4++) {
        var slot = vis[c4].used, list = lay.singles[c4];
        list.forEach(function (o) {
          if (slot >= vis[c4].slots) { vis[c4].hidden = (vis[c4].hidden || 0) + 1; return; }
          cellHTML += '<div class="cal-mitem' + (o.key === UI.sel ? " sel" : "") + '" data-k="' + esc(o.key) + '" style="' + evStyle(o.cal) + ";top:" + (26 + slot * 19) + "px;left:calc(" + (c4 * 100 / 7) + "% + 3px);width:calc(" + (100 / 7) + '% - 6px)">' +
            '<i class="cal-dot"></i><span class="cal-mt">' + esc(o.ev.title || "新建事件") + '</span><span class="cal-t">' + K.hm(o.s) + "</span></div>";
          slot++;
        });
        if (vis[c4].hidden) cellHTML += '<div class="cal-more" data-d="' + K.ymd(K.addDays(ws, c4)) + '" style="top:' + (26 + (vis[c4].slots) * 19) + "px;left:calc(" + (c4 * 100 / 7) + '% + 8px)">还有 ' + vis[c4].hidden + " 项</div>";
      }
      row.querySelector(".cal-mev").innerHTML = cellHTML;
    });
  }
  function weekLayout(ws, occs) {
    var we = K.addDays(ws, 7), spans = [], singles = [[], [], [], [], [], [], []];
    occs.forEach(function (o) {
      if (o.e <= ws || o.s >= we) return;
      if (isMulti(o)) {
        var a = Math.max(0, K.dayDiff(ws, o.s)), b = Math.min(6, K.dayDiff(ws, new Date(o.e.getTime() - 1)));
        spans.push({ o: o, a: a, b: b, cutL: o.s < ws, cutR: o.e > we });
      } else { var c = K.dayDiff(ws, o.s); if (c >= 0 && c < 7) singles[c].push(o); }
    });
    spans.sort(function (x, y) { return x.a - y.a || (y.b - y.a) - (x.b - x.a) || x.o.s - y.o.s; });
    var lanes = [];
    spans.forEach(function (sp) {
      for (var k = 0; k < 50; k++) {
        lanes[k] = lanes[k] || [];
        var free = true;
        for (var c = sp.a; c <= sp.b; c++) if (lanes[k][c]) { free = false; break; }
        if (free) { for (c = sp.a; c <= sp.b; c++) lanes[k][c] = 1; sp.lane = k; break; }
      }
    });
    return { spans: spans, singles: singles };
  }

  // ---- 周 / 日：上面是全天一栏，下面是 24 小时的时间轴 ----
  function renderTimeline(v, days) {
    var from = days[0], to = K.addDays(days[days.length - 1], 1), occs = occurrences(from, to), today = K.day0(new Date()), n = days.length;
    var keep = v.querySelector(".cal-ws");
    if (keep && UI.scrollY == null) UI.scrollY = keep.scrollTop;
    var h = '<div class="cal-tl' + (n === 1 ? " one" : "") + '"><div class="cal-wh"><div class="cal-gut"></div>' + days.map(function (d) {
      var t = K.sameDay(d, today);
      return '<div class="cal-wd' + (t ? " today" : "") + (d.getDay() === 0 || d.getDay() === 6 ? " we" : "") + '" data-d="' + K.ymd(d) + '"><span>周' + K.WD[d.getDay()] + "</span><b>" + d.getDate() + "</b>" + lunarHTML(d) + "</div>";
    }).join("") + "</div>";
    // 全天一栏：跨天的、全天的，按行排
    var ws = days[0], spans = [];
    occs.forEach(function (o) {
      if (!isMulti(o) || o.e <= from || o.s >= to) return;
      spans.push({ o: o, a: Math.max(0, K.dayDiff(ws, o.s)), b: Math.min(n - 1, K.dayDiff(ws, new Date(o.e.getTime() - 1))) });
    });
    var lanes = [];
    spans.forEach(function (sp) { for (var k = 0; k < 30; k++) { lanes[k] = lanes[k] || []; var ok = true; for (var c = sp.a; c <= sp.b; c++) if (lanes[k][c]) { ok = false; break; } if (ok) { for (c = sp.a; c <= sp.b; c++) lanes[k][c] = 1; sp.lane = k; break; } } });
    var nl = Math.max(1, lanes.length);
    h += '<div class="cal-wa" style="height:' + (nl * 22 + 8) + 'px"><div class="cal-gut">全天</div><div class="cal-wacols">' + days.map(function (d) { return '<div class="cal-wacol" data-d="' + K.ymd(d) + '"></div>'; }).join("") +
      spans.map(function (s) {
        return '<div class="cal-abar' + (s.o.key === UI.sel ? " sel" : "") + '" data-k="' + esc(s.o.key) + '" style="' + evStyle(s.o.cal) + ";top:" + (4 + s.lane * 22) + "px;left:calc(" + (s.a * 100 / n) + "% + 2px);width:calc(" + ((s.b - s.a + 1) * 100 / n) + '% - 4px)">' +
          (s.o.allDay ? "" : '<i class="cal-t">' + K.hm(s.o.s) + " </i>") + esc(s.o.ev.title || "新建事件") + "</div>";
      }).join("") + "</div></div>";
    // 时间轴
    h += '<div class="cal-ws ma-scroll"><div class="cal-wgrid" style="height:' + 24 * HOUR + 'px"><div class="cal-hours">';
    for (var hr = 1; hr < 24; hr++) h += '<span style="top:' + hr * HOUR + 'px">' + hr + ":00</span>";
    h += '</div><div class="cal-cols">' + days.map(function (d) {
      var d0 = K.day0(d), d1 = K.addDays(d0, 1), segs = [];
      occs.forEach(function (o) { if (isMulti(o) || o.e <= d0 || o.s >= d1) return; segs.push({ o: o, s: Math.max(o.s, d0), e: Math.min(o.e, d1) }); });
      layoutCols(segs);
      return '<div class="cal-col' + (K.sameDay(d, today) ? " today" : "") + (d.getDay() === 0 || d.getDay() === 6 ? " we" : "") + '" data-d="' + K.ymd(d) + '">' + segs.map(function (g) {
        var top = (g.s - d0) / 60000 * HOUR / 60, ht = Math.max(18, (g.e - g.s) / 60000 * HOUR / 60 - 2), o = g.o;
        return '<div class="cal-ev' + (o.key === UI.sel ? " sel" : "") + (ht < 34 ? " short" : "") + '" data-k="' + esc(o.key) + '" style="' + evStyle(o.cal) + ";top:" + top + "px;height:" + ht + "px;left:calc(" + (g.col * 100 / g.cols) + "% + 1px);width:calc(" + (100 / g.cols) + '% - 3px)">' +
          '<b>' + esc(o.ev.title || "新建事件") + "</b>" + (ht >= 34 ? '<span class="cal-t">' + K.hm(o.s) + (o.ev.location ? " · " + esc(o.ev.location) : "") + "</span>" : '<span class="cal-t"> ' + K.hm(o.s) + "</span>") +
          '<i class="cal-rs cal-rs-t"></i><i class="cal-rs cal-rs-b"></i></div>';
      }).join("") + "</div>";
    }).join("") + '</div><div class="cal-now" hidden><i></i><span></span></div></div></div></div>';
    if (n === 1) h = '<div class="cal-dayw">' + h + '<div class="cal-dayside">' + daySideHTML(occs) + "</div></div>";
    v.innerHTML = h;
    var sc = v.querySelector(".cal-ws");
    sc.scrollTop = UI.scrollY != null ? UI.scrollY : Math.max(0, (Math.min(new Date().getHours(), 17) - 1.5) * HOUR);
    UI.scrollY = null;
    sc.addEventListener("scroll", function () { M.lastScroll = sc.scrollTop; });
    placeNow();
    if (n === 1) {
      var mm = K.miniMonth({ value: UI.date, onPick: function (d) { UI.date = d; render(); }, marks: function (d) { return markDay(d); } });
      v.querySelector(".cal-daymini").appendChild(mm.el);
    }
  }
  // 重叠的事件分几列并排
  function layoutCols(segs) {
    segs.sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    var group = [], cols = [], end = 0;
    var finish = function () { var n = group.reduce(function (m, g) { return Math.max(m, g.col + 1); }, 1); group.forEach(function (g) { g.cols = n; }); };
    segs.forEach(function (g) {
      if (group.length && g.s >= end) { finish(); group = []; cols = []; end = 0; }
      var c = cols.findIndex(function (e) { return e <= g.s; });
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = g.e;
      g.col = c;
      group.push(g);
      end = Math.max(end, +g.e);
    });
    if (group.length) finish();
  }
  function placeNow() {
    if (!M) return;
    var v = M.main.querySelector(".cal-view"), now = new Date(), line = v.querySelector(".cal-now");
    if (!line) return;
    var col = v.querySelector(".cal-col.today");
    line.hidden = !col;
    if (!col) return;
    var y = (now.getHours() * 60 + now.getMinutes()) * HOUR / 60;
    line.style.top = y + "px";
    var cols = v.querySelector(".cal-cols"), cr = cols.getBoundingClientRect(), tr = col.getBoundingClientRect();
    line.querySelector("i").style.left = tr.left - cr.left + "px";
    line.querySelector("span").textContent = K.hm(now);
    v.querySelectorAll(".cal-hours span").forEach(function (sp) { sp.classList.toggle("near", Math.abs(parseFloat(sp.style.top) - y) < 14); });
  }
  function daySideHTML(occs) {
    var o = findOcc(UI.sel), d = UI.date;
    var list = occs.filter(function (x) { return x.s < K.addDays(d, 1) && x.e > d; });
    var det = o ? '<div class="cal-det" style="' + evStyle(o.cal) + '"><b>' + esc(o.ev.title || "新建事件") + "</b>" + (o.ev.location ? "<p>" + esc(o.ev.location) + "</p>" : "") +
      "<p>" + (o.allDay ? K.fmtYMD(o.s) + " 全天" : K.fmtYMD(o.s) + " " + timeText(o)) + "</p>" + (o.ev.repeat ? "<p>" + esc(K.rrText(o.ev.repeat, K.parse(o.ev.start))) + "</p>" : "") +
      (o.ev.notes ? '<p class="cal-dnotes selectable">' + esc(o.ev.notes) + "</p>" : "") + '<p class="cal-dcal"><i></i>' + esc(o.cal.name) + "</p></div>" :
      '<div class="cal-det none">' + (list.length ? list.length + " 个事件" : "无事件") + "</div>";
    return '<div class="cal-daymini"></div>' + det;
  }

  // ---- 年 ----
  function renderYear(v) {
    var y = UI.date.getFullYear(), today = K.day0(new Date()), occs = occurrences(new Date(y, 0, 1), new Date(y + 1, 0, 1)), cnt = {};
    occs.forEach(function (o) { for (var x = K.day0(o.s); x < o.e && x.getFullYear() <= y; x = K.addDays(x, 1)) { var k = K.ymd(x); cnt[k] = cnt[k] || { n: 0, c: hex(o.cal.color) }; cnt[k].n++; } });
    var h = '<div class="cal-year">';
    for (var m = 0; m < 12; m++) {
      var first = new Date(y, m, 1), start = K.startOfWeek(first);
      h += '<div class="cal-ym"><h3 data-m="' + m + '" class="' + (today.getFullYear() === y && today.getMonth() === m ? "cur" : "") + '">' + (m + 1) + "月</h3><div class=\"cal-ygrid\">";
      for (var i = 0; i < 7; i++) h += "<i>" + K.WD[(i + K.weekStart()) % 7] + "</i>";
      for (var j = 0; j < 42; j++) {
        var d = K.addDays(start, j), inm = d.getMonth() === m, k = K.ymd(d), c = inm && cnt[k], cls = [];
        if (!inm) { h += "<span></span>"; continue; }
        if (K.sameDay(d, today)) cls.push("today");
        if (K.sameDay(d, UI.date)) cls.push("sel");
        if (d.getDay() === 0 || d.getDay() === 6) cls.push("we");
        h += '<span data-d="' + k + '" class="' + cls.join(" ") + '"' + (c ? ' style="--h:' + c.c + ";--a:" + Math.min(0.75, 0.22 + 0.16 * c.n) + '"' : "") + ">" + d.getDate() + "</span>";
      }
      h += "</div></div>";
    }
    v.innerHTML = h + "</div>";
  }

  // ---- 搜索结果 ----
  function renderResults() {
    var box = M.main.querySelector(".cal-results");
    box.hidden = !UI.query;
    if (!UI.query) return;
    var q = UI.query.toLowerCase(), now = new Date();
    var hits = occurrences(K.addDays(now, -366), K.addDays(now, 366)).filter(function (o) { return (o.ev.title + "\n" + o.ev.location + "\n" + o.ev.notes).toLowerCase().indexOf(q) >= 0; });
    var seen = {}, list = [];
    hits.forEach(function (o) { var k = o.cal.path + "|" + o.ev.id; if (o.ev.repeat) { if (seen[k] || o.e < now) return; seen[k] = 1; } list.push(o); });
    list = list.slice(0, 200);
    var h = '<div class="cal-rhead">' + list.length + " 个结果</div>", last = "";
    list.forEach(function (o) {
      var day = K.fmtDay(o.s);
      if (day !== last) { h += '<div class="cal-rday">' + esc(day) + "</div>"; last = day; }
      h += '<div class="cal-ritem' + (o.key === UI.sel ? " sel" : "") + '" data-k="' + esc(o.key) + '" style="' + evStyle(o.cal) + '"><i></i><div><b>' + esc(o.ev.title || "新建事件") + "</b><span>" + esc(o.allDay ? "全天" : timeText(o)) +
        (o.ev.location ? " · " + esc(o.ev.location) : "") + "</span></div></div>";
    });
    box.innerHTML = h + (list.length ? "" : '<div class="cal-rnone">没有找到</div>');
  }

  // ======== 新建、改、删 ========
  function newEvent(o) {
    var C = o.cal ? byPath(o.cal) : defaultCal(true);
    if (!C || C.error || C.readOnly) C = defaultCal(true);
    if (!C) return null;
    var ev = { id: newId(), title: o.title || "新建事件", start: o.start, end: o.end, allDay: !!o.allDay, location: o.location || "", notes: "", url: "", repeat: "", exdates: [], alerts: o.alerts || [], created: nowStr(), extra: {} };
    if (!edit(C.path, function (x) { x.events.push(ev); }, "新建事件")) return null;
    if (UI.hidden[C.path]) { delete UI.hidden[C.path]; saveUI(); }
    return occ(byPath(C.path), ev, range(ev).s, range(ev).e);
  }
  function createAndEdit(o) {
    var x = newEvent(o);
    if (!x) return;
    UI.sel = x.key;
    render();
    requestAnimationFrame(function () { var el = keyEl(x.key); openInspector(x.key, el || M.main, { focusTitle: true }); });
  }
  var keyEl = function (key) { return M && M.main.querySelector('[data-k="' + CSS.escape(key) + '"]'); };
  // 重复事件的某一次要改 / 删：先问「仅此事件 / 将来所有事件」
  function askScope(o, what) {
    var isFirst = K.parse(o.ev.start).getTime() === o.s.getTime();
    return D.alert({ window: APP, icon: "app", title: what === "delete" ? "你要删除这个重复事件的所有将来事件，还是只删除这一次？" : "你要更改这个重复事件的所有将来事件，还是只更改这一次？",
      message: what === "delete" ? "" : "更改所有将来事件会改变这之后的每一次。",
      buttons: [{ label: "取消", role: "cancel" }, { label: what === "delete" ? "删除所有将来事件" : "所有将来事件" }, { label: what === "delete" ? "仅删除此事件" : "仅此事件", role: "default" }] })
      .then(function (b) { return b === "取消" || !b ? null : /将来/.test(b) ? (isFirst ? "all" : "future") : "one"; });
  }
  // 按 scope 改一次（或整串）：fn(事件的拷贝, 这一次的开始) 改字段。返回改后那个事件的 key
  function changeOcc(o, scope, fn, label) {
    var path = o.cal.path, resKey = null;
    group(label, function () {
      if (!o.ev.repeat || scope === "all") {
        var before = K.parse(o.ev.start);
        edit(path, function (C) { var ev = C.events.find(function (x) { return x.id === o.ev.id; }); if (!ev) return false; var s0 = K.parse(ev.start); fn(ev, shiftOf(ev, o)); if (ev.repeat) ev.repeat = retarget(ev.repeat, s0, K.parse(ev.start)); });
        var C2 = byPath(path), ev2 = C2 && C2.events.find(function (x) { return x.id === o.ev.id; });
        if (ev2) resKey = ev2.repeat ? path + "|" + ev2.id + "|" + (o.s.getTime() + (K.parse(ev2.start) - before)) : occ(C2, ev2, range(ev2).s, range(ev2).e).key;
        return;
      }
      if (scope === "one") {
        var copy = detachCopy(o);
        fn(copy, 0);
        edit(path, function (C) { var ev = C.events.find(function (x) { return x.id === o.ev.id; }); if (!ev) return false; ev.exdates = ev.exdates.concat([K.ymd(o.s)]); C.events.push(copy); });
        resKey = path + "|" + copy.id + "|" + range(copy).s.getTime();
        return;
      }
      // future：原来那一串到前一天为止；从这一次起另起一串
      var tail = detachCopy(o), r = K.rrParse(o.ev.repeat);
      if (r) { r.count = 0; tail.repeat = K.rrString(r); }
      var t0 = K.parse(tail.start);
      fn(tail, 0);
      if (tail.repeat) tail.repeat = retarget(tail.repeat, t0, K.parse(tail.start));
      edit(path, function (C) {
        var ev = C.events.find(function (x) { return x.id === o.ev.id; });
        if (!ev) return false;
        var rr = K.rrParse(ev.repeat);
        if (rr) { rr.count = 0; rr.until = new Date(o.s.getFullYear(), o.s.getMonth(), o.s.getDate() - 1, 23, 59, 59); ev.repeat = K.rrString(rr); }
        C.events.push(tail);
      });
      resKey = path + "|" + tail.id + "|" + range(tail).s.getTime();
    });
    return resKey;
  }
  function detachCopy(o) {
    var ev = JSON.parse(JSON.stringify(outEvent(o.ev)));
    ev = normEvent(ev, 0, o.cal.path);
    ev.id = newId();
    ev.repeat = "";
    ev.exdates = [];
    if (o.allDay) { ev.start = K.ymd(o.s); ev.end = K.ymd(K.addDays(o.e, -1)); }
    else { ev.start = K.local(o.s, true); ev.end = K.local(o.e, true); }
    return ev;
  }
  var shiftOf = function (ev, o) { return o.s - K.parse(ev.start); };
  // 整串挪了日子：「每周一」跟着变成新的那天，「每月 15 日」跟着变成新的日期（同 macOS）
  function retarget(rule, a, b) {
    var r = K.rrParse(rule);
    if (!r || !a || !b || K.sameDay(a, b)) return rule;
    if (r.freq === "WEEKLY" && r.byday && r.byday.length === 1 && r.byday[0].wd === a.getDay()) r.byday = [{ n: 0, wd: b.getDay() }];
    if (r.freq === "MONTHLY" && r.bymonthday && r.bymonthday.length === 1 && r.bymonthday[0] === a.getDate()) r.bymonthday = [b.getDate()];
    if (r.freq === "MONTHLY" && r.byday && r.byday.length === 1 && r.byday[0].n && r.byday[0].wd === a.getDay()) r.byday = [{ n: r.byday[0].n, wd: b.getDay() }];
    if (r.freq === "YEARLY" && r.bymonth && r.bymonth.length === 1 && r.bymonth[0] === a.getMonth() + 1) r.bymonth = [b.getMonth() + 1];
    return K.rrString(r);
  }
  function deleteOcc(o) {
    if (o.cal.readOnly || o.cal.error) return brokenAlert(o.cal, o.cal.readOnly);
    var go = function (scope) {
      if (!scope) return;
      group("删除事件", function () {
        edit(o.cal.path, function (C) {
          var ev = C.events.find(function (x) { return x.id === o.ev.id; });
          if (!ev) return false;
          if (!ev.repeat || scope === "all") C.events = C.events.filter(function (x) { return x !== ev; });
          else if (scope === "one") ev.exdates = ev.exdates.concat([K.ymd(o.s)]);
          else { var r = K.rrParse(ev.repeat); if (r) { r.count = 0; r.until = new Date(o.s.getFullYear(), o.s.getMonth(), o.s.getDate() - 1, 23, 59, 59); ev.repeat = K.rrString(r); } }
        });
      });
      UI.sel = null;
      K.closePops();
      render();
    };
    if (o.ev.repeat) askScope(o, "delete").then(go); else go("all");
  }
  // 拖动 / 改时间：dStart、dEnd 是毫秒（全天是天数 × 一天）
  function moveOcc(o, dS, dE) {
    if (o.cal.readOnly || o.cal.error) { brokenAlert(o.cal, o.cal.readOnly); render(); return; }
    var fn = function (ev, shift) {
      var s = K.parse(ev.start), e = range(ev).e;
      if (ev.allDay) {
        var ds = Math.round(dS / 864e5), de = Math.round(dE / 864e5);
        ev.start = K.ymd(K.addDays(s, ds));
        var ne = K.addDays(K.addDays(e, -1), de);
        ev.end = K.ymd(ne < K.parse(ev.start) ? K.parse(ev.start) : ne);
      } else {
        var ns = new Date(s.getTime() + dS), nend = new Date(e.getTime() + dE);
        if (nend - ns < 15 * 60000) nend = new Date(ns.getTime() + 15 * 60000);
        ev.start = K.local(ns, true);
        ev.end = K.local(nend, true);
      }
      void shift;
    };
    var run = function (scope) { if (!scope) { render(); return; } var k = changeOcc(o, scope, fn, "移动事件"); if (k) UI.sel = k; render(); };
    if (o.ev.repeat) askScope(o, "change").then(run); else run("all");
  }

  // ======== 简介浮层 ========
  var REPEATS = [["", "无"], ["FREQ=DAILY", "每天"], ["FREQ=WEEKLY", "每周"], ["FREQ=MONTHLY", "每月"], ["FREQ=YEARLY", "每年"]];
  var ALERTS_T = [[null, "无"], [0, "事件发生时"], [5, "5 分钟前"], [10, "10 分钟前"], [15, "15 分钟前"], [30, "30 分钟前"], [60, "1 小时前"], [120, "2 小时前"], [1440, "1 天前"], [2880, "2 天前"]];
  var ALERTS_A = [[null, "无"], [-540, "当天（上午 9 点）"], [900, "1 天前（上午 9 点）"], [2340, "2 天前（上午 9 点）"], [9540, "1 周前"]];
  var insp = null;
  function openInspector(key, anchor, opts) {
    opts = opts || {};
    var o0 = findOcc(key);
    if (!o0) return;
    var T = { key: key, scope: null };
    var box = document.createElement("div");
    box.className = "cal-insp";
    var cur = function () { return findOcc(T.key); };
    function apply(fn, label, series) {
      var o = cur();
      if (!o) return;
      if (o.cal.readOnly || o.cal.error) return brokenAlert(o.cal, o.cal.readOnly);
      var go = function (scope) {
        if (!scope) { draw(); return; }
        T.scope = o.ev.repeat && scope !== "all" ? scope : T.scope;
        var k = changeOcc(o, series ? "all" : scope, fn, label);
        if (k) { T.key = k; UI.sel = k; }
        if (scope === "one" || scope === "future") T.scope = "all"; // 分出来的那个已经是单独的了
        render();
        draw();
        var el = keyEl(T.key);
        if (el && insp) insp.setAnchor(el);
      };
      if (o.ev.repeat && !series && !T.scope) askScope(o, "change").then(function (s) { T.scope = s; go(s); });
      else go(o.ev.repeat && !series ? T.scope : "all");
    }
    function draw() {
      var o = cur();
      if (!o) { if (insp) insp.close(); return; }
      var ev = o.ev, ro = !!(o.cal.readOnly || o.cal.error), c = hex(o.cal.color), s = o.s, e = o.allDay ? K.addDays(o.e, -1) : o.e;
      var alerts = o.allDay ? ALERTS_A : ALERTS_T, a0 = ev.alerts[0], alabel = (alerts.find(function (x) { return x[0] === (a0 == null ? null : a0); }) || [0, a0 + " 分钟前"])[1];
      box.style.setProperty("--c", c);
      box.innerHTML = '<div class="ci-top"><textarea class="ma-in ci-title" rows="1" spellcheck="false" placeholder="新建事件">' + esc(ev.title) + '</textarea><button class="ci-cal" data-a="cal" title="' + esc(o.cal.name) + '"><i></i></button></div>' +
        '<input class="ma-in ci-loc" placeholder="添加位置" spellcheck="false" value="' + esc(ev.location) + '">' +
        '<div class="ma-sep"></div>' +
        '<div class="ma-row"><label>全天</label><span class="ci-check' + (o.allDay ? " on" : "") + '" data-a="allday"></span></div>' +
        '<div class="ma-row"><label>开始</label><button class="ci-date" data-a="sd">' + fmtD(s) + "</button>" + (o.allDay ? "" : K.timeField(K.hm(s)).replace('class="ma-time"', 'class="ma-time" data-a="st"')) + "</div>" +
        '<div class="ma-row"><label>结束</label><button class="ci-date" data-a="ed">' + fmtD(e) + "</button>" + (o.allDay ? "" : K.timeField(K.hm(e)).replace('class="ma-time"', 'class="ma-time" data-a="et"')) + "</div>" +
        '<div class="ma-row"><label>重复</label><button class="ma-drop" data-a="rep"><span>' + esc(repLabel(ev)) + "</span></button></div>" +
        '<div class="ma-row"><label>提醒</label><button class="ma-drop" data-a="alert"><span>' + esc(alabel) + "</span></button></div>" +
        '<div class="ma-sep"></div><textarea class="ma-in ci-notes" rows="1" spellcheck="false" placeholder="添加备注">' + esc(ev.notes) + '</textarea>' +
        '<input class="ma-in ci-url" placeholder="添加 URL" spellcheck="false" value="' + esc(ev.url) + '">' +
        (ro ? '<div class="ci-ro">' + (o.cal.readOnly ? "订阅的日历，只读" : "日历的文件读不了，现在不能改") + "</div>" : "");
      box.querySelectorAll("textarea, input").forEach(function (x) { x.disabled = ro; });
      box.querySelectorAll(".ma-time").forEach(function (t) {
        K.bindTime(t, function (hh, mm) {
          var which = t.dataset.a, oo = cur();
          if (!oo) return;
          if (which === "st") { var ns = new Date(oo.s); ns.setHours(hh, mm, 0, 0); var d = ns - oo.s; if (d) apply(function (x) { var xs = K.parse(x.start), xe = K.parse(x.end); x.start = K.local(new Date(xs.getTime() + d), true); x.end = K.local(new Date(xe.getTime() + d), true); }, "更改时间"); }
          else { var ne = new Date(oo.e); ne.setHours(hh, mm, 0, 0); if (ne <= oo.s) ne = K.addDays(ne, 1); var d2 = ne - oo.e; if (d2) apply(function (x) { var xe = K.parse(x.end); x.end = K.local(new Date(xe.getTime() + d2), true); }, "更改时间"); }
        });
      });
      requestAnimationFrame(function () { box.querySelectorAll("textarea").forEach(grow); if (insp) insp.place(); });
    }
    var fmtD = function (d) { return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate(); };
    function grow(t) { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }
    function repLabel(ev) { var hit = REPEATS.find(function (x) { return x[0] === ev.repeat; }); return hit ? hit[1] : K.rrText(ev.repeat, K.parse(ev.start)); }
    box.addEventListener("input", function (e) { if (e.target.tagName === "TEXTAREA") grow(e.target); });
    box.addEventListener("change", function (e) {
      var t = e.target, v = t.value;
      if (t.classList.contains("ci-title")) apply(function (x) { x.title = v.replace(/\n/g, " ").trim(); }, "更改标题");
      if (t.classList.contains("ci-loc")) apply(function (x) { x.location = v.trim(); }, "更改位置");
      if (t.classList.contains("ci-notes")) apply(function (x) { x.notes = v; }, "更改备注");
      if (t.classList.contains("ci-url")) apply(function (x) { x.url = v.trim(); }, "更改 URL");
    });
    box.addEventListener("keydown", function (e) { if (e.isComposing || e.keyCode === 229) return;
      e.stopPropagation();
      if (e.key === "Enter" && (e.target.classList.contains("ci-title") || e.target.classList.contains("ci-loc") || e.target.classList.contains("ci-url"))) { e.preventDefault(); e.target.blur(); }
      if (e.key === "Escape") { e.preventDefault(); if (document.activeElement && box.contains(document.activeElement)) document.activeElement.blur(); if (insp) insp.close(); }
    });
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-a]"), o = cur();
      if (!b || !o || o.cal.readOnly || o.cal.error) return;
      var a = b.dataset.a, at = { x: b.getBoundingClientRect().left, y: b.getBoundingClientRect().bottom + 2 };
      if (a === "allday") {
        var toAll = !o.allDay;
        apply(function (x) {
          var xs = K.parse(x.start), xe = range(x).e;
          if (toAll) { x.allDay = true; x.start = K.ymd(xs); x.end = K.ymd(K.addDays(K.day0(new Date(xe.getTime() - 1)), 0) < K.day0(xs) ? xs : K.day0(new Date(xe.getTime() - 1))); }
          else { x.allDay = false; var st = new Date(xs); st.setHours(9, 0, 0, 0); x.start = K.local(st, true); x.end = K.local(K.addMinutes(st, 60), true); }
          x.alerts = [];
        }, toAll ? "设为全天" : "取消全天");
      }
      if (a === "sd" || a === "ed") K.pickDate(b, { value: a === "sd" ? o.s : (o.allDay ? K.addDays(o.e, -1) : o.e), onChange: function (d) {
        var oo = cur();
        if (!oo) return;
        if (a === "sd") { var dd = K.dayDiff(oo.s, d) * 864e5; if (dd) apply(function (x) { var xs = K.parse(x.start), xe = K.parse(x.end); if (x.allDay) { x.start = K.ymd(K.addDays(xs, Math.round(dd / 864e5))); x.end = K.ymd(K.addDays(xe, Math.round(dd / 864e5))); } else { x.start = K.local(K.addDays(xs, Math.round(dd / 864e5)), true); x.end = K.local(K.addDays(xe, Math.round(dd / 864e5)), true); } }, "更改日期"); }
        else { var last = oo.allDay ? K.addDays(oo.e, -1) : oo.e, n2 = K.dayDiff(last, d); if (n2) apply(function (x) { var xe = K.parse(x.end), ne = K.addDays(xe, n2); if (ne < K.parse(x.start)) ne = K.parse(x.start); x.end = x.allDay ? K.ymd(ne) : K.local(ne, true); }, "更改日期"); }
      } });
      if (a === "rep") D.popup(REPEATS.map(function (r) { return { label: r[1], checked: r[0] === o.ev.repeat, run: function () { apply(function (x) { x.repeat = r[0]; if (!r[0]) x.exdates = []; }, "更改重复", true); } }; }).concat([K.SEP,
        { label: "自定…", checked: !!o.ev.repeat && !REPEATS.some(function (r) { return r[0] === o.ev.repeat; }), run: function () { K.editRule(b, { rule: o.ev.repeat || "FREQ=WEEKLY", start: K.parse(o.ev.start), onDone: function (s) { apply(function (x) { x.repeat = s; }, "更改重复", true); } }); } }]), at);
      if (a === "alert") D.popup((o.allDay ? ALERTS_A : ALERTS_T).map(function (r) { return { label: r[1], checked: (o.ev.alerts[0] == null ? null : o.ev.alerts[0]) === r[0], run: function () { apply(function (x) { x.alerts = r[0] == null ? [] : [r[0]].concat(x.alerts.slice(1).filter(function (m) { return m !== r[0]; })); }, "更改提醒", true); } }; }), at);
      if (a === "cal") D.popup(writable().map(function (c) { return { label: c.name, icon: '<svg viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="2.5" fill="' + hex(c.color) + '"/></svg>', checked: c.path === o.cal.path, run: function () { moveToCal(o, c.path); } }; }), at);
    });
    function moveToCal(o, to) {
      if (to === o.cal.path) return;
      var ev = null;
      group("移到别的日历", function () {
        edit(o.cal.path, function (C) { ev = C.events.find(function (x) { return x.id === o.ev.id; }); if (!ev) return false; C.events = C.events.filter(function (x) { return x !== ev; }); });
        if (ev) edit(to, function (C) { C.events.push(ev); });
      });
      if (ev) { T.key = to + "|" + ev.id + "|" + o.s.getTime(); UI.sel = T.key; }
      render();
      draw();
      var el = keyEl(T.key);
      if (el && insp) insp.setAnchor(el);
    }
    draw();
    K.closePops();
    insp = K.popover(anchor, box, { className: "cal-pop", onClose: function () { var a = document.activeElement; if (a && box.contains(a)) a.blur(); insp = null; } });
    if (opts.focusTitle) setTimeout(function () { var t = box.querySelector(".ci-title"); if (t && !t.disabled) { t.focus(); t.select(); } }, 30);
    return insp;
  }
  // 快速事件：一行字（「明天下午3点和小王开会」），认出日期时间就用上
  function quickEvent(anchor) {
    if (!M) open();
    var box = document.createElement("div");
    box.className = "cal-quick";
    box.innerHTML = '<input class="ma-field" placeholder="创建快速事件（如：明天下午3点开会）" spellcheck="false"><div class="cal-qhint"></div>';
    var input = box.querySelector("input"), hint = box.querySelector(".cal-qhint");
    input.addEventListener("input", function () {
      var nl = K.parseNatural(input.value);
      hint.textContent = nl ? (nl.time ? K.fmtDay(nl.date) + " " + K.hm(nl.date) : K.fmtDay(nl.date) + " 全天") + (nl.rest ? " · " + nl.rest : "") : input.value.trim() ? "今天 " + K.hm(nextHalf()) + " · " + input.value.trim() : "";
    });
    input.addEventListener("keydown", function (e) { if (e.isComposing || e.keyCode === 229) return;
      e.stopPropagation();
      if (e.key === "Escape") pop.close();
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      var t = input.value.trim(), nl = K.parseNatural(t), s, allDay = false;
      if (nl) { s = nl.date; allDay = !nl.time; t = nl.rest || "新建事件"; }
      else s = UI.view === "day" || UI.view === "week" ? (function () { var x = new Date(UI.date); var nh = nextHalf(); x.setHours(nh.getHours(), nh.getMinutes(), 0, 0); return x; })() : nextHalf();
      pop.close();
      var o = allDay ? { title: t, start: K.ymd(s), end: K.ymd(s), allDay: true } : { title: t, start: K.local(s, true), end: K.local(K.addMinutes(s, 60), true) };
      UI.date = K.day0(s);
      var x = newEvent(o);
      if (!x) return;
      UI.sel = x.key;
      render();
      requestAnimationFrame(function () { var el = keyEl(x.key); openInspector(x.key, el || M.main, {}); });
    });
    var pop = K.popover(anchor, box, { side: "bottom", className: "cal-pop" });
    setTimeout(function () { input.focus(); }, 30);
  }
  var nextHalf = function () { var d = new Date(); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() < 30 ? 30 : 60); return d; };

  // ======== 日历：新建、简介、删除、导入导出 ========
  function calSheet(anchor, C) {
    var isNew = !C, st = { name: C ? C.name : "", color: C ? C.color : "blue" };
    var box = document.createElement("div");
    box.className = "cal-sheet";
    var draw = function () {
      box.innerHTML = '<div class="ma-row"><span class="ma-lab">名称</span><input class="ma-field" spellcheck="false" placeholder="未命名" value="' + esc(st.name) + '"></div>' +
        '<div class="cal-colors">' + COLORS.map(function (c) { return '<button data-c="' + c[0] + '" title="' + c[1] + '" class="' + (c[0] === st.color ? "on" : "") + '" style="background:' + hex(c[0]) + '"></button>'; }).join("") + "</div>" +
        '<div class="ma-btns"><button class="ma-pbtn" data-a="cancel">取消</button><button class="ma-pbtn default" data-a="ok">好</button></div>';
    };
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      st.name = box.querySelector("input").value;
      if (b.dataset.c) { st.color = b.dataset.c; draw(); }
      if (b.dataset.a === "cancel") pop.close();
      if (b.dataset.a === "ok") done();
    });
    box.addEventListener("keydown", function (e) { if (e.isComposing || e.keyCode === 229) return; e.stopPropagation(); if (e.key === "Enter") { st.name = box.querySelector("input").value; done(); } if (e.key === "Escape") pop.close(); });
    function done() {
      var name = st.name.trim() || (isNew ? "未命名" : C.name);
      pop.close();
      if (isNew) { var nc = createCal({ name: name, color: st.color }); if (nc) delete UI.hidden[nc.path]; render(); return; }
      if (C.error || C.readOnly) return brokenAlert(C, C.readOnly);
      // 先改文件名、再写新名字、颜色（反过来的话，真沙盒那边会丢掉那次写）
      var np = freePath(name, C.path), path = C.path;
      if (np !== C.path) {
        try { store.move(C.path, np); var cc = byPath(C.path); if (cc) cc.path = np; path = np; if (UI.hidden[C.path]) { UI.hidden[np] = true; delete UI.hidden[C.path]; } if (K.store.get("tsu-cal-default", "") === C.path) K.store.set("tsu-cal-default", np); saveUI(); } catch (e) { /* 改不了文件名就算了 */ }
      }
      edit(path, function (x) { x.name = name; x.color = st.color; }, "更改日历");
      render();
    }
    draw();
    var pop = K.popover(anchor, box, { className: "cal-pop" });
    setTimeout(function () { var i = box.querySelector("input"); i.focus(); i.select(); }, 30);
  }
  function deleteCal(C) {
    D.alert({ window: APP, icon: "caution", title: "要删除日历“" + C.name + "”吗？", message: (C.events.length ? "其中的 " + C.events.length + " 个事件会一起删除。" : "") + "日历的文件会移到废纸篓，需要时可以从废纸篓放回。",
      buttons: [{ label: "取消", role: "cancel" }, { label: "删除", role: "destructive" }] }).then(function (b) {
      if (b !== "删除") return;
      var F = window.TSU_FINDER;
      if (F && F.trash) F.trash([C.path]);
      cals = cals.filter(function (x) { return x !== C; });
      render();
    });
  }
  function download(name, text, type) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function exportCal(C) { download(K.safeName(C.name, "日历") + ".ics", toICS(C.name, C.events), "text/calendar;charset=utf-8"); }
  // 导入 .ics：访达里打开、文件菜单「导入…」都走这里
  function importICS(text, name) {
    var ics = parseICS(text), evs = ics.events.map(function (x, i) { return icsToEvent(x, i, "import"); }).filter(Boolean);
    if (!M) open();
    if (!evs.length) { D.alert({ window: APP, icon: "caution", title: "“" + name + "”里没有事件", buttons: [{ label: "好", role: "default" }] }); return; }
    var w = writable(), target = defaultCal(true), NEWC = "@new";
    var box = document.createElement("div");
    box.className = "cal-sheet";
    var draw = function () {
      var t = target === NEWC ? "新日历：" + (ics.name || name) : target ? target.name : "";
      box.innerHTML = "<h3>导入 " + evs.length + " 个事件</h3><p>" + esc(name) + "</p>" + '<div class="ma-row"><span class="ma-lab">添加到</span><button class="ma-drop" data-a="to"><span>' + esc(t) + "</span></button></div>" +
        '<div class="ma-btns"><button class="ma-pbtn" data-a="cancel">取消</button><button class="ma-pbtn default" data-a="ok">导入</button></div>';
    };
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-a]");
      if (!b) return;
      if (b.dataset.a === "to") D.popup(w.map(function (c) { return { label: c.name, checked: c === target, run: function () { target = c; draw(); } }; }).concat([K.SEP, { label: "新日历…", checked: target === NEWC, run: function () { target = NEWC; draw(); } }]),
        { x: b.getBoundingClientRect().left, y: b.getBoundingClientRect().bottom + 2 });
      if (b.dataset.a === "cancel") pop.close();
      if (b.dataset.a === "ok") {
        pop.close();
        var C = target === NEWC || !target ? createCal({ name: ics.name || name.replace(/\.ics$/i, ""), color: "purple" }) : target;
        edit(C.path, function (x) {
          var have = {};
          x.events.forEach(function (ev) { have[ev.title + "|" + ev.start + "|" + ev.end] = 1; });
          evs.forEach(function (ev) { if (have[ev.title + "|" + ev.start + "|" + ev.end]) return; ev.id = newId(); x.events.push(ev); });
        }, "导入事件");
        delete UI.hidden[C.path];
        var firstEv = evs.slice().sort(function (a, b) { return a.start.localeCompare(b.start); })[0];
        if (firstEv) UI.date = K.day0(K.parse(firstEv.start));
        render();
      }
    });
    draw();
    var r = M.win.el.getBoundingClientRect();
    var pop = K.popover({ left: r.left + r.width / 2 - 1, right: r.left + r.width / 2 + 1, top: r.top + 40, bottom: r.top + 46, width: 2, height: 6 }, box, { side: "bottom", className: "cal-pop" });
  }
  function importFromPath(p) {
    var r = store.read(p);
    if (r.lazy) { if (FS.ensureLoaded) FS.ensureLoaded([p]).then(function () { importFromPath(p); }); return; }
    if (r.text == null) { D.alert({ window: APP, icon: "caution", title: "打不开 " + base(p), message: r.error || "", buttons: [{ label: "好", role: "default" }] }); return; }
    open();
    importICS(r.text, base(p));
  }
  function pickImport() {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".ics,text/calendar";
    inp.onchange = function () { var f = inp.files && inp.files[0]; if (f) f.text().then(function (t) { importICS(t, f.name); }); };
    inp.click();
  }

  // ======== 事件（鼠标、键盘）========
  // 工具栏上一个按钮做的事；手机上的版式用自己的按钮调进来（b = 那个按钮：新事件的浮层挂在它旁边）
  function tbAction(k, b) {
    if (k === "sidebar") M.toggleSide();
    if (k === "plus") quickEvent(b);
  }
  function bindChrome() {
    M.tb.addEventListener("click", function (e) {
      var v = e.target.closest(".cal-seg button");
      if (v) { setView(v.dataset.v); return; }
      var b = e.target.closest("[data-b]");
      if (!b) return;
      tbAction(b.dataset.b, b);
    });
    var input = M.tb.querySelector(".ma-search input");
    input.addEventListener("input", function () { UI.query = input.value.trim(); M.tb.querySelector(".ma-search").classList.toggle("has", !!input.value); renderResults(); });
    input.addEventListener("keydown", function (e) { if (e.isComposing || e.keyCode === 229) return; e.stopPropagation(); if (e.key === "Escape") { input.value = ""; UI.query = ""; M.tb.querySelector(".ma-search").classList.remove("has"); renderResults(); input.blur(); } });
    M.tb.querySelector(".ma-clear").addEventListener("mousedown", function (e) { e.preventDefault(); input.value = ""; UI.query = ""; M.tb.querySelector(".ma-search").classList.remove("has"); renderResults(); });
    M.main.querySelector(".cal-nav").addEventListener("click", function (e) { var b = e.target.closest("[data-nav]"); if (b) nav(+b.dataset.nav); });
    M.main.querySelector(".cal-nav").addEventListener("mousedown", function (e) { e.preventDefault(); });
    // 侧边栏：勾选显示、右键
    M.side.addEventListener("click", function (e) {
      var row = e.target.closest(".cal-c");
      if (!row) return;
      if (row.dataset.other === "lunar") { UI.lunar = !UI.lunar; saveUI(); render(); return; }
      var p = row.dataset.path;
      if (UI.hidden[p]) delete UI.hidden[p]; else UI.hidden[p] = true;
      saveUI();
      render();
    });
    M.side.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      var row = e.target.closest(".cal-c[data-path]");
      var C = row && byPath(row.dataset.path);
      var items = [{ label: "新建日历…", run: function () { calSheet(row || M.side, null); } }];
      if (C) items = [
        { label: "显示简介", disabled: !!C.readOnly, run: function () { calSheet(row, C); } },
        { label: "设为默认日历", disabled: !!(C.readOnly || C.error), checked: defaultCal(false) === C, run: function () { K.store.set("tsu-cal-default", C.path); } },
        K.SEP,
        { label: "导出…", disabled: !!C.error, run: function () { exportCal(C); } },
        { label: "在访达中显示文件", run: function () { reveal(C.path); } },
        K.SEP,
      ].concat(items, [K.SEP, { label: "删除", run: function () { deleteCal(C); } }]);
      D.popup(items, { x: e.clientX, y: e.clientY });
    });
    // 视图里：点选、连点编辑、拖着新建 / 挪动 / 改长短、右键
    var view = M.main.querySelector(".cal-view");
    view.addEventListener("pointerdown", onDown);
    view.addEventListener("dblclick", onDbl);
    view.addEventListener("contextmenu", onCtx);
    view.addEventListener("click", function (e) {
      var more = e.target.closest(".cal-more");
      if (more) { UI.date = K.parse(more.dataset.d); setView("day"); return; }
      var ym = e.target.closest(".cal-ym h3");
      if (ym) { UI.date = new Date(UI.date.getFullYear(), +ym.dataset.m, 1); setView("month"); return; }
      var yd = e.target.closest(".cal-ygrid span[data-d]");
      if (yd) { UI.date = K.parse(yd.dataset.d); render(); return; }
      var wd = e.target.closest(".cal-wd[data-d]");
      if (wd && UI.view === "week") { UI.date = K.parse(wd.dataset.d); setView("day"); }
    });
    view.addEventListener("wheel", function (e) {
      if (UI.view !== "month" && UI.view !== "year") return;
      if (Math.abs(e.deltaY) < 30 || wheelLock) return;
      wheelLock = true;
      setTimeout(function () { wheelLock = false; }, 450);
      nav(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
    M.main.querySelector(".cal-results").addEventListener("click", function (e) {
      var it = e.target.closest(".cal-ritem");
      if (!it) return;
      var o = findOcc(it.dataset.k);
      if (!o) return;
      UI.sel = o.key;
      UI.date = K.day0(o.s);
      render();
    });
    M.main.querySelector(".cal-results").addEventListener("dblclick", function (e) { var it = e.target.closest(".cal-ritem"); if (it) openInspector(it.dataset.k, it); });
    K.every(30000, placeNow);
  }
  var wheelLock = false;
  function setView(v) { UI.view = v; saveUI(); K.closePops(); render(); }
  function nav(dir) {
    K.closePops();
    if (dir === 0) UI.date = K.day0(new Date());
    else if (UI.view === "month") UI.date = K.addMonths(UI.date, dir);
    else if (UI.view === "week") UI.date = K.addDays(UI.date, 7 * dir);
    else if (UI.view === "day") UI.date = K.addDays(UI.date, dir);
    else UI.date = new Date(UI.date.getFullYear() + dir, UI.date.getMonth(), Math.min(UI.date.getDate(), 28));
    render();
  }
  var evSel = ".cal-ev, .cal-mbar, .cal-mitem, .cal-abar";
  function select(key) {
    UI.sel = key;
    M.main.querySelectorAll(evSel).forEach(function (x) { x.classList.toggle("sel", x.dataset.k === key); });
    if (UI.view === "day") { var side = M.main.querySelector(".cal-dayside .cal-det"); if (side) { var html = daySideHTML(occurrences(UI.date, K.addDays(UI.date, 1))); side.outerHTML = html.replace('<div class="cal-daymini"></div>', ""); } }
  }
  function snapMin(y) { return Math.round(y / (HOUR / 4)) * 15; }
  // 拖：时间轴上新建、挪、拉长短；月视图里挪到别的日子
  function onDown(e) {
    if (e.button !== 0) return;
    var evEl = e.target.closest(evSel), col = e.target.closest(".cal-col"), cell = e.target.closest(".cal-mcell, .cal-mrow"), view = M.main.querySelector(".cal-view");
    if (e.target.closest(".cal-more")) return;
    if (evEl) {
      var o = findOcc(evEl.dataset.k);
      if (!o) return;
      select(o.key);
      if (o.cal.readOnly) return;
      var x0 = e.clientX, y0 = e.clientY, moved = false, mode = "move";
      if (evEl.classList.contains("cal-ev")) { var r = evEl.getBoundingClientRect(); if (e.clientY > r.bottom - 6) mode = "end"; else if (e.clientY < r.top + 5) mode = "start"; }
      var ghost = null, dDays = 0, dMin = 0, top0 = parseFloat(evEl.style.top) || 0, h0 = parseFloat(evEl.style.height) || 20;
      evEl.setPointerCapture(e.pointerId);
      var move = function (ev) {
        var dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
        if (!moved) { moved = true; K.closePops(); evEl.classList.add("dragging"); }
        if (evEl.classList.contains("cal-ev")) {
          var cols = view.querySelectorAll(".cal-col"), cw = cols[0].getBoundingClientRect().width;
          dMin = snapMin(dy);
          dDays = mode === "move" ? Math.round(dx / cw) : 0;
          var ci = Array.prototype.indexOf.call(cols, evEl.parentNode);
          dDays = K.clamp(dDays, -ci, cols.length - 1 - ci);
          evEl.style.transform = mode === "move" ? "translate(" + dDays * cw + "px," + dMin * HOUR / 60 + "px)" : "";
          if (mode === "end") { dMin = Math.max(dMin, 15 - Math.round(h0 / HOUR * 60)); evEl.style.height = Math.max(14, h0 + dMin * HOUR / 60) + "px"; }
          if (mode === "start") { dMin = Math.min(dMin, Math.round(h0 / HOUR * 60) - 15); evEl.style.top = top0 + dMin * HOUR / 60 + "px"; evEl.style.height = Math.max(14, h0 - dMin * HOUR / 60) + "px"; }
        } else {
          // 月视图 / 全天一栏：看指针在哪一天上
          var hit = document.elementFromPoint(ev.clientX, ev.clientY), dc = hit && hit.closest(".cal-mcell, .cal-wacol, .cal-wd");
          if (!ghost) { ghost = evEl.cloneNode(true); ghost.classList.add("cal-ghost"); document.body.appendChild(ghost); }
          ghost.style.cssText = "position:fixed;left:" + (ev.clientX - 30) + "px;top:" + (ev.clientY - 9) + "px;width:" + evEl.offsetWidth + "px;" + evEl.getAttribute("style").replace(/top:[^;]*;|left:[^;]*;|width:[^;]*;?/g, "");
          view.querySelectorAll(".cal-drop").forEach(function (x) { x.classList.remove("cal-drop"); });
          if (dc) { dc.classList.add("cal-drop"); dDays = K.dayDiff(K.day0(o.s), K.parse(dc.dataset.d)); }
        }
      };
      var up = function () {
        evEl.removeEventListener("pointermove", move);
        evEl.removeEventListener("pointerup", up);
        evEl.removeEventListener("pointercancel", up);
        if (ghost) ghost.remove();
        view.querySelectorAll(".cal-drop").forEach(function (x) { x.classList.remove("cal-drop"); });
        if (!moved) return;
        if (mode === "move" && (dDays || dMin)) moveOcc(o, o.allDay ? dDays * 864e5 : dDays * 864e5 + dMin * 60000, o.allDay ? dDays * 864e5 : dDays * 864e5 + dMin * 60000);
        else if (mode === "end" && dMin) moveOcc(o, 0, dMin * 60000);
        else if (mode === "start" && dMin) moveOcc(o, dMin * 60000, 0);
        else render();
      };
      evEl.addEventListener("pointermove", move);
      evEl.addEventListener("pointerup", up);
      evEl.addEventListener("pointercancel", up);
      return;
    }
    if (col) {
      // 空白处拖：画出新事件的时间段；只是点一下：取消选中
      var cr = col.getBoundingClientRect(), startMin = K.clamp(Math.floor((e.clientY - cr.top) / (HOUR / 4)) * 15, 0, 1425), endMin = startMin + 15, dragging = false, y1 = e.clientY;
      var g = document.createElement("div");
      g.className = "cal-ev cal-new";
      var cal0 = defaultCal(false);
      g.style.cssText = (cal0 ? evStyle(cal0) : "") + ";left:1px;width:calc(100% - 3px);";
      col.setPointerCapture(e.pointerId);
      var mv = function (ev) {
        if (!dragging && Math.abs(ev.clientY - y1) < 5) return;
        if (!dragging) { dragging = true; K.closePops(); col.appendChild(g); }
        var m = K.clamp(Math.round((ev.clientY - cr.top) / (HOUR / 4)) * 15, 0, 1440);
        var a = Math.min(startMin, m), b = Math.max(startMin + 15, m);
        if (m < startMin) { a = m; b = startMin + 15; }
        endMin = b;
        g.dataset.a = a;
        g.style.top = a * HOUR / 60 + "px";
        g.style.height = (b - a) * HOUR / 60 - 2 + "px";
        g.innerHTML = "<b>新建事件</b><span class=\"cal-t\">" + K.pad(Math.floor(a / 60)) + ":" + K.pad(a % 60) + " – " + K.pad(Math.floor(b / 60) % 24) + ":" + K.pad(b % 60) + "</span>";
      };
      var upc = function () {
        col.removeEventListener("pointermove", mv);
        col.removeEventListener("pointerup", upc);
        if (!dragging) { if (UI.sel) { select(null); } K.closePops(); return; }
        var day = K.parse(col.dataset.d), a = +g.dataset.a, s = K.addMinutes(day, a), en = K.addMinutes(day, endMin);
        g.remove();
        createAndEdit({ title: "新建事件", start: K.local(s, true), end: K.local(en, true) });
      };
      col.addEventListener("pointermove", mv);
      col.addEventListener("pointerup", upc);
      return;
    }
    if (cell && UI.view === "month") {
      var c0 = e.target.closest(".cal-mcell");
      if (c0) { UI.date = K.parse(c0.dataset.d); M.main.querySelectorAll(".cal-mcell.sel").forEach(function (x) { x.classList.remove("sel"); }); c0.classList.add("sel"); M.mini.set(UI.date); }
      if (UI.sel) select(null);
    }
  }
  function onDbl(e) {
    var evEl = e.target.closest(evSel);
    if (evEl) { openInspector(evEl.dataset.k, evEl); return; }
    var col = e.target.closest(".cal-col");
    if (col) {
      var cr = col.getBoundingClientRect(), m = K.clamp(Math.floor((e.clientY - cr.top) / (HOUR / 2)) * 30, 0, 1410), day = K.parse(col.dataset.d), s = K.addMinutes(day, m);
      createAndEdit({ start: K.local(s, true), end: K.local(K.addMinutes(s, 60), true) });
      return;
    }
    var wa = e.target.closest(".cal-wacol"), mc = e.target.closest(".cal-mcell");
    if (wa || mc) { var d = (wa || mc).dataset.d; createAndEdit({ start: d, end: d, allDay: true }); return; }
    var yd = e.target.closest(".cal-ygrid span[data-d]");
    if (yd) { UI.date = K.parse(yd.dataset.d); setView("day"); }
  }
  function onCtx(e) {
    var evEl = e.target.closest(evSel);
    e.preventDefault();
    if (!evEl) {
      var col = e.target.closest(".cal-col, .cal-mcell, .cal-wacol");
      return D.popup([{ label: "新建事件", run: function () {
        if (col && col.classList.contains("cal-col")) { var cr = col.getBoundingClientRect(), m = K.clamp(Math.floor((e.clientY - cr.top) / (HOUR / 2)) * 30, 0, 1410), s = K.addMinutes(K.parse(col.dataset.d), m); createAndEdit({ start: K.local(s, true), end: K.local(K.addMinutes(s, 60), true) }); }
        else if (col) createAndEdit({ start: col.dataset.d, end: col.dataset.d, allDay: true });
        else quickEvent(M.tb.querySelector('[data-b="plus"]'));
      } }], { x: e.clientX, y: e.clientY });
    }
    var o = findOcc(evEl.dataset.k);
    if (!o) return;
    select(o.key);
    var ro = o.cal.readOnly || o.cal.error;
    D.popup([
      { label: "显示简介", keys: "⌘I", run: function () { openInspector(o.key, keyEl(o.key) || evEl); } },
      K.SEP,
      { label: "日历", disabled: !!ro, items: writable().map(function (c) { return { label: c.name, checked: c.path === o.cal.path, icon: '<svg viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="2.5" fill="' + hex(c.color) + '"/></svg>', run: function () {
        if (c.path === o.cal.path) return;
        var ev = null;
        group("移到别的日历", function () { edit(o.cal.path, function (C) { ev = C.events.find(function (x) { return x.id === o.ev.id; }); if (!ev) return false; C.events = C.events.filter(function (x) { return x !== ev; }); }); if (ev) edit(c.path, function (C) { C.events.push(ev); }); });
        render();
      } }; }) },
      { label: "复制", disabled: !!ro, run: function () { var copy = detachCopy(o); copy.repeat = ""; group("复制事件", function () { edit(o.cal.path, function (C) { C.events.push(copy); }); }); UI.sel = o.cal.path + "|" + copy.id + "|" + range(copy).s.getTime(); render(); } },
      { label: "拷贝为文本", run: function () { if (navigator.clipboard) navigator.clipboard.writeText((o.ev.title || "新建事件") + "\n" + K.fmtDay(o.s) + " " + (o.allDay ? "全天" : timeText(o)) + (o.ev.location ? "\n" + o.ev.location : "")).catch(function () {}); } },
      K.SEP,
      { label: "删除", keys: "⌫", disabled: !!ro, run: function () { deleteOcc(o); } },
    ], { x: e.clientX, y: e.clientY });
  }
  function reveal(p) { var F = window.TSU_FINDER; if (F && F.reveal) F.reveal(p); }

  // ======== 菜单、快捷键 ========
  function menus() {
    var o = findOcc(UI.sel), ul = undo.undoLabel(), rl = undo.redoLabel();
    return [
      { title: "文件", items: [
        { label: "新建事件", keys: "⌥⌘N", run: function () { quickEvent(M.tb.querySelector('[data-b="plus"]')); } },
        { label: "新建日历…", keys: "⇧⌥⌘N", run: function () { calSheet(M.side.querySelector(".cal-cals") || M.side, null); } },
        K.SEP,
        { label: "导入…", run: pickImport },
        { label: "导出", items: writable().concat(cals.filter(function (c) { return c.subscribed; })).map(function (c) { return { label: c.name, run: function () { exportCal(c); } }; }) },
        K.SEP,
        { label: "在访达中显示数据文件", run: function () { reveal(o ? o.cal.path : DIR); } },
      ] },
      { title: "编辑", items: [
        { label: ul !== null ? "撤销" + ul : "撤销", keys: "⌘Z", disabled: ul === null, run: function () { undo.undo(); render(); } },
        { label: rl !== null ? "重做" + rl : "重做", keys: "⇧⌘Z", disabled: rl === null, run: function () { undo.redo(); render(); } },
        K.SEP,
        { label: "删除", keys: "⌫", disabled: !o, run: function () { deleteOcc(o); } },
        K.SEP,
        { label: "显示简介", keys: "⌘I", disabled: !o, run: function () { openInspector(o.key, keyEl(o.key) || M.main); } },
        { label: "查找", keys: "⌘F", run: focusSearch },
      ] },
      { title: "显示", items: [
        { label: "按日", keys: "⌘1", checked: UI.view === "day", run: function () { setView("day"); } },
        { label: "按周", keys: "⌘2", checked: UI.view === "week", run: function () { setView("week"); } },
        { label: "按月", keys: "⌘3", checked: UI.view === "month", run: function () { setView("month"); } },
        { label: "按年", keys: "⌘4", checked: UI.view === "year", run: function () { setView("year"); } },
        K.SEP,
        { label: "前往今天", run: function () { nav(0); } },
        { label: "上一个", keys: "⌘←", run: function () { nav(-1); } },
        { label: "下一个", keys: "⌘→", run: function () { nav(1); } },
        K.SEP,
        { label: M && M.sideShown() ? "隐藏日历列表" : "显示日历列表", run: function () { M.toggleSide(); } },
        { label: "显示中国农历", checked: UI.lunar, run: function () { UI.lunar = !UI.lunar; saveUI(); render(); } },
        { label: "一周的第一天", items: [[0, "星期日"], [1, "星期一"]].map(function (w) { return { label: w[1], checked: K.weekStart() === w[0], run: function () { localStorage.setItem("tsu-cal-weekstart", w[0]); M.mini.render(); render(); } }; }) },
      ] },
      { title: "帮助", items: [{ label: "数据文件格式（README.md）", run: function () { store.ensure(); if (window.TSU_IDE && TSU_IDE.open) TSU_IDE.open(DIR + "/README.md"); else reveal(DIR + "/README.md"); } }] },
    ];
  }
  function appMenu() { return [{ label: "关于日历", run: function () { D.alert({ window: APP, icon: "app", title: "日历", message: "每个日历是 " + DIR.replace(FS.HOME, "~") + " 里的一个 JSON 文件，agent 可以直接读写；.ics 文件放进去就是订阅日历。", buttons: [{ label: "好", role: "default" }] }); } }]; }
  function focusSearch() { if (!M) return; var i = M.tb.querySelector(".ma-search input"); i.focus(); i.select(); }
  function onKey(e) {
    if (!M || D.front() !== M.win || M.win.state === "closed" || M.win.state === "min") return;
    if (e.isComposing || e.keyCode === 229) return;
    var a = document.activeElement, typing = a && M.win.el.contains(a) && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    if (a && a.closest && a.closest(".ma-pop")) return;
    if (document.querySelector(".ma-pop:not(.out)") && e.key === "Escape") return;
    var cmd = e.metaKey && !e.ctrlKey, hit = null, o = findOcc(UI.sel);
    if (cmd && !e.shiftKey && !e.altKey && /^Digit[1-4]$/.test(e.code)) hit = function () { setView(["day", "week", "month", "year"][+e.code.slice(5) - 1]); };
    else if (cmd && e.altKey && !e.shiftKey && e.code === "KeyN") hit = function () { quickEvent(M.tb.querySelector('[data-b="plus"]')); };
    else if (cmd && e.altKey && e.shiftKey && e.code === "KeyN") hit = function () { calSheet(M.side.querySelector(".cal-cals") || M.side, null); };
    else if (cmd && !e.altKey && e.code === "KeyF") hit = focusSearch;
    else if (!typing) {
      if (cmd && (e.key === "ArrowLeft" || e.key === "ArrowRight")) hit = function () { nav(e.key === "ArrowLeft" ? -1 : 1); };
      else if (cmd && !e.shiftKey && e.code === "KeyZ") hit = function () { undo.undo(); render(); };
      else if (cmd && e.shiftKey && e.code === "KeyZ") hit = function () { undo.redo(); render(); };
      else if (cmd && e.code === "KeyI" && o) hit = function () { openInspector(o.key, keyEl(o.key) || M.main); };
      else if (e.key === "Enter" && o) hit = function () { openInspector(o.key, keyEl(o.key) || M.main); };
      else if ((e.key === "Backspace" || e.key === "Delete") && o) hit = function () { deleteOcc(o); };
      else if (e.key === "Escape" && (UI.sel || UI.query)) hit = function () { if (UI.query) { var i = M.tb.querySelector(".ma-search input"); i.value = ""; UI.query = ""; renderResults(); } else select(null); };
      else if (!cmd && !e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && UI.view !== "year") hit = function () { UI.date = K.addDays(UI.date, e.key === "ArrowLeft" ? -1 : 1); render(); };
    }
    if (hit) { e.preventDefault(); e.stopPropagation(); hit(); }
  }

  // ======== Dock 图标（星期几 + 几号，过了午夜会换）、启动 ========
  function dockSVG() {
    var d = new Date();
    return '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true"><rect width="100" height="100" fill="#fff"/>' +
      '<text x="50" y="30" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,\'PingFang SC\',sans-serif" font-size="15" font-weight="600" fill="#ff3b30">星期' + K.WD[d.getDay()] + "</text>" +
      '<text x="50" y="83" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,\'Helvetica Neue\',sans-serif" font-size="56" font-weight="300" letter-spacing="-2" fill="#1d1d1f">' + d.getDate() + "</text></svg>";
  }
  var dockA = null;
  function syncIcon() {
    var svg = dockSVG();
    if (dockA) { var ico = dockA.querySelector(".ico"); if (ico) ico.innerHTML = svg; }
    D.registerApp({ id: APP, name: NAME, icon: '<span class="ico sq ico-calendar">' + svg + "</span>" });
  }
  D.registerApp({ id: APP, name: NAME, icon: '<span class="ico sq ico-calendar">' + dockSVG() + "</span>", open: open, category: "效率" });
  dockA = D.addDockApp({ app: APP, title: NAME, className: "ico-calendar", icon: dockSVG(), onOpen: open });
  K.describe({ id: APP, name: NAME + " (Calendar)", path: DIR,
    about: "one JSON file per calendar, `<name>.json` = {name, color, order, events:[{id, title, start, end, allDay, location, notes, url, repeat (RRULE), exdates [\"YYYY-MM-DD\"], alerts [minutes before]}]}. " +
      "Local time" + (TZ ? " (" + TZ + ")" : "") + ": timed \"YYYY-MM-DDTHH:MM\"; all-day \"YYYY-MM-DD\" with end = last day inclusive. Keep fields you don't know; new calendar = new file; delete = move the file to ~/.Trash. " +
      "Any .ics file dropped in that folder shows up as a read-only subscribed calendar. Full format: README.md in that folder." });
  (window.TSU_OPENERS = window.TSU_OPENERS || []).push({ id: APP, name: NAME, exts: ["ics"], open: importFromPath });
  FS.ready().then(function () {
    loadAll();
    store.watch(reload);
    changed();
    K.settled(function () {
      store.ensure();
      K.shareWithAgents(DIR);
      loadAll(); // 先按真沙盒里的重新读一遍：之前读的是接上以前那份（新设备上是空的），拿它判断就会每台新设备都再建一个「日历」
      if (!cals.some(function (c) { return !c.subscribed; })) { createCal({ name: "日历", color: "blue" }); loadAll(); }
      changed();
      tick();
      K.every(15000, tick);
    });
  });
  var dayWas = new Date().getDate();
  K.every(60000, function () { if (new Date().getDate() !== dayWas) { dayWas = new Date().getDate(); syncIcon(); if (M) render(); } });
  window.TSU_CALENDAR = { open: open, dir: DIR, cals: function () { return cals; }, occurrences: occurrences, lunar: Lunar, ics: { parse: parseICS, build: toICS }, importICS: importICS, setView: setView, go: function (d) { UI.date = K.day0(K.parse(d)); render(); },
    // 手机上的版式（ios/apps.js）用：工具栏的动作（plus、sidebar）、现在的视图 / 日期 / 农历开没开、数据变了的通知
    action: function (k, anchor) { if (M) tbAction(k, anchor || M.tb); },
    state: function () { return { view: UI.view, date: UI.date, lunar: !!UI.lunar, weekStart: K.weekStart() }; },
    onChange: function (fn) { if (typeof fn === "function") changeFns.push(fn); } };
})();
