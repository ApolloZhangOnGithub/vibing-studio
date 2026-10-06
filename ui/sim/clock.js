// clock.js —— 时钟（同 macOS / iOS 的「时钟」）：世界时钟、闹钟、秒表、计时器
// 数据：~/Library/Clock/ 里的 cities.json、alarms.json、timers.json（格式见那个文件夹里的 README.md）。agent 用自己的文件工具读写，App 马上跟着变
// 桌面：macOS 的窗口（工具栏正中是「世界时钟 · 闹钟 · 秒表 · 计时器」分段控件，右边 ＋）；世界时钟上面是世界地图（有昼夜）、下面是各城市的表盘
// 手机（html.ios）：iOS 的版式（大标题、编辑 / ＋、底下的标签栏；秒表左右滑是数字 / 表盘两页；计时器是滚轮）
// 闹钟、计时器只在这个页面开着时响（网页关了没法响）；打开时补一条「错过的闹钟」
(function () {
  "use strict";
  var K = window.TSU_APPKIT;
  if (!K) return;
  var FS = K.FS, D = K.D, esc = K.esc, pad = K.pad, ICON = K.ICON;
  var APP = "clock", NAME = "时钟", DIR = FS.HOME + "/Library/Clock";
  var F_CITIES = DIR + "/cities.json", F_ALARMS = DIR + "/alarms.json", F_TIMERS = DIR + "/timers.json";
  var root = document.documentElement;
  var isIOS = function () { return root.classList.contains("ios"); };
  var LOCAL_TZ = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; } })();
  var WD = ["日", "一", "二", "三", "四", "五", "六"];

  // ======== 城市（名字同 iOS 的中文；时区是 IANA 的；经纬度给地图上的点）：[名字, 国家或地区, 时区, 纬度, 经度, 英文名] ========
  var CITIES = [
    ["北京", "中国", "Asia/Shanghai", 39.9, 116.4, "Beijing"], ["上海", "中国", "Asia/Shanghai", 31.23, 121.47, "Shanghai"], ["广州", "中国", "Asia/Shanghai", 23.13, 113.26, "Guangzhou"],
    ["深圳", "中国", "Asia/Shanghai", 22.54, 114.06, "Shenzhen"], ["杭州", "中国", "Asia/Shanghai", 30.27, 120.15, "Hangzhou"], ["成都", "中国", "Asia/Shanghai", 30.57, 104.07, "Chengdu"],
    ["重庆", "中国", "Asia/Shanghai", 29.56, 106.55, "Chongqing"], ["西安", "中国", "Asia/Shanghai", 34.34, 108.94, "Xi'an"], ["南京", "中国", "Asia/Shanghai", 32.06, 118.8, "Nanjing"],
    ["武汉", "中国", "Asia/Shanghai", 30.59, 114.31, "Wuhan"], ["天津", "中国", "Asia/Shanghai", 39.34, 117.36, "Tianjin"], ["哈尔滨", "中国", "Asia/Shanghai", 45.8, 126.53, "Harbin"],
    ["拉萨", "中国", "Asia/Shanghai", 29.65, 91.14, "Lhasa"], ["香港", "中国香港", "Asia/Hong_Kong", 22.32, 114.17, "Hong Kong"], ["澳门", "中国澳门", "Asia/Macau", 22.2, 113.54, "Macau"],
    ["台北", "中国台湾", "Asia/Taipei", 25.03, 121.57, "Taipei"], ["东京", "日本", "Asia/Tokyo", 35.68, 139.69, "Tokyo"], ["大阪", "日本", "Asia/Tokyo", 34.69, 135.5, "Osaka"],
    ["札幌", "日本", "Asia/Tokyo", 43.06, 141.35, "Sapporo"], ["首尔", "韩国", "Asia/Seoul", 37.57, 126.98, "Seoul"], ["釜山", "韩国", "Asia/Seoul", 35.18, 129.08, "Busan"],
    ["乌兰巴托", "蒙古", "Asia/Ulaanbaatar", 47.89, 106.91, "Ulaanbaatar"], ["新加坡", "新加坡", "Asia/Singapore", 1.35, 103.82, "Singapore"], ["吉隆坡", "马来西亚", "Asia/Kuala_Lumpur", 3.14, 101.69, "Kuala Lumpur"],
    ["曼谷", "泰国", "Asia/Bangkok", 13.76, 100.5, "Bangkok"], ["河内", "越南", "Asia/Ho_Chi_Minh", 21.03, 105.85, "Hanoi"], ["胡志明市", "越南", "Asia/Ho_Chi_Minh", 10.82, 106.63, "Ho Chi Minh City"],
    ["金边", "柬埔寨", "Asia/Phnom_Penh", 11.56, 104.92, "Phnom Penh"], ["仰光", "缅甸", "Asia/Yangon", 16.87, 96.2, "Yangon"], ["雅加达", "印度尼西亚", "Asia/Jakarta", -6.21, 106.85, "Jakarta"],
    ["登巴萨", "印度尼西亚", "Asia/Makassar", -8.65, 115.22, "Denpasar"], ["马尼拉", "菲律宾", "Asia/Manila", 14.6, 120.98, "Manila"], ["孟买", "印度", "Asia/Kolkata", 19.08, 72.88, "Mumbai"],
    ["新德里", "印度", "Asia/Kolkata", 28.61, 77.21, "New Delhi"], ["班加罗尔", "印度", "Asia/Kolkata", 12.97, 77.59, "Bengaluru"], ["加尔各答", "印度", "Asia/Kolkata", 22.57, 88.36, "Kolkata"],
    ["加德满都", "尼泊尔", "Asia/Kathmandu", 27.72, 85.32, "Kathmandu"], ["达卡", "孟加拉国", "Asia/Dhaka", 23.81, 90.41, "Dhaka"], ["科伦坡", "斯里兰卡", "Asia/Colombo", 6.93, 79.86, "Colombo"],
    ["卡拉奇", "巴基斯坦", "Asia/Karachi", 24.86, 67.01, "Karachi"], ["伊斯兰堡", "巴基斯坦", "Asia/Karachi", 33.68, 73.05, "Islamabad"], ["喀布尔", "阿富汗", "Asia/Kabul", 34.56, 69.21, "Kabul"],
    ["塔什干", "乌兹别克斯坦", "Asia/Tashkent", 41.3, 69.24, "Tashkent"], ["阿拉木图", "哈萨克斯坦", "Asia/Almaty", 43.24, 76.89, "Almaty"], ["迪拜", "阿拉伯联合酋长国", "Asia/Dubai", 25.2, 55.27, "Dubai"],
    ["阿布扎比", "阿拉伯联合酋长国", "Asia/Dubai", 24.45, 54.38, "Abu Dhabi"], ["多哈", "卡塔尔", "Asia/Qatar", 25.29, 51.53, "Doha"], ["利雅得", "沙特阿拉伯", "Asia/Riyadh", 24.71, 46.68, "Riyadh"],
    ["德黑兰", "伊朗", "Asia/Tehran", 35.69, 51.39, "Tehran"], ["巴格达", "伊拉克", "Asia/Baghdad", 33.31, 44.36, "Baghdad"], ["特拉维夫", "以色列", "Asia/Jerusalem", 32.09, 34.78, "Tel Aviv"],
    ["伊斯坦布尔", "土耳其", "Europe/Istanbul", 41.01, 28.98, "Istanbul"], ["安卡拉", "土耳其", "Europe/Istanbul", 39.93, 32.86, "Ankara"], ["伦敦", "英国", "Europe/London", 51.51, -0.13, "London"],
    ["爱丁堡", "英国", "Europe/London", 55.95, -3.19, "Edinburgh"], ["都柏林", "爱尔兰", "Europe/Dublin", 53.35, -6.26, "Dublin"], ["巴黎", "法国", "Europe/Paris", 48.86, 2.35, "Paris"],
    ["柏林", "德国", "Europe/Berlin", 52.52, 13.4, "Berlin"], ["慕尼黑", "德国", "Europe/Berlin", 48.14, 11.58, "Munich"], ["法兰克福", "德国", "Europe/Berlin", 50.11, 8.68, "Frankfurt"],
    ["马德里", "西班牙", "Europe/Madrid", 40.42, -3.7, "Madrid"], ["巴塞罗那", "西班牙", "Europe/Madrid", 41.39, 2.17, "Barcelona"], ["里斯本", "葡萄牙", "Europe/Lisbon", 38.72, -9.14, "Lisbon"],
    ["罗马", "意大利", "Europe/Rome", 41.9, 12.5, "Rome"], ["米兰", "意大利", "Europe/Rome", 45.46, 9.19, "Milan"], ["阿姆斯特丹", "荷兰", "Europe/Amsterdam", 52.37, 4.9, "Amsterdam"],
    ["布鲁塞尔", "比利时", "Europe/Brussels", 50.85, 4.35, "Brussels"], ["苏黎世", "瑞士", "Europe/Zurich", 47.38, 8.54, "Zurich"], ["日内瓦", "瑞士", "Europe/Zurich", 46.2, 6.14, "Geneva"],
    ["维也纳", "奥地利", "Europe/Vienna", 48.21, 16.37, "Vienna"], ["布拉格", "捷克", "Europe/Prague", 50.08, 14.44, "Prague"], ["华沙", "波兰", "Europe/Warsaw", 52.23, 21.01, "Warsaw"],
    ["布达佩斯", "匈牙利", "Europe/Budapest", 47.5, 19.04, "Budapest"], ["布加勒斯特", "罗马尼亚", "Europe/Bucharest", 44.43, 26.1, "Bucharest"], ["哥本哈根", "丹麦", "Europe/Copenhagen", 55.68, 12.57, "Copenhagen"],
    ["斯德哥尔摩", "瑞典", "Europe/Stockholm", 59.33, 18.07, "Stockholm"], ["奥斯陆", "挪威", "Europe/Oslo", 59.91, 10.75, "Oslo"], ["赫尔辛基", "芬兰", "Europe/Helsinki", 60.17, 24.94, "Helsinki"],
    ["雷克雅未克", "冰岛", "Atlantic/Reykjavik", 64.15, -21.94, "Reykjavik"], ["雅典", "希腊", "Europe/Athens", 37.98, 23.73, "Athens"], ["基辅", "乌克兰", "Europe/Kiev", 50.45, 30.52, "Kyiv"],
    ["莫斯科", "俄罗斯", "Europe/Moscow", 55.76, 37.62, "Moscow"], ["圣彼得堡", "俄罗斯", "Europe/Moscow", 59.93, 30.34, "Saint Petersburg"], ["开罗", "埃及", "Africa/Cairo", 30.04, 31.24, "Cairo"],
    ["卡萨布兰卡", "摩洛哥", "Africa/Casablanca", 33.57, -7.59, "Casablanca"], ["拉各斯", "尼日利亚", "Africa/Lagos", 6.52, 3.38, "Lagos"], ["阿克拉", "加纳", "Africa/Accra", 5.6, -0.19, "Accra"],
    ["内罗毕", "肯尼亚", "Africa/Nairobi", -1.29, 36.82, "Nairobi"], ["亚的斯亚贝巴", "埃塞俄比亚", "Africa/Addis_Ababa", 9.03, 38.74, "Addis Ababa"], ["约翰内斯堡", "南非", "Africa/Johannesburg", -26.2, 28.05, "Johannesburg"],
    ["开普敦", "南非", "Africa/Johannesburg", -33.92, 18.42, "Cape Town"], ["纽约", "美国", "America/New_York", 40.71, -74.01, "New York"], ["华盛顿", "美国", "America/New_York", 38.91, -77.04, "Washington"],
    ["波士顿", "美国", "America/New_York", 42.36, -71.06, "Boston"], ["迈阿密", "美国", "America/New_York", 25.76, -80.19, "Miami"], ["亚特兰大", "美国", "America/New_York", 33.75, -84.39, "Atlanta"],
    ["芝加哥", "美国", "America/Chicago", 41.88, -87.63, "Chicago"], ["休斯敦", "美国", "America/Chicago", 29.76, -95.37, "Houston"], ["达拉斯", "美国", "America/Chicago", 32.78, -96.8, "Dallas"],
    ["丹佛", "美国", "America/Denver", 39.74, -104.99, "Denver"], ["凤凰城", "美国", "America/Phoenix", 33.45, -112.07, "Phoenix"], ["洛杉矶", "美国", "America/Los_Angeles", 34.05, -118.24, "Los Angeles"],
    ["旧金山", "美国", "America/Los_Angeles", 37.77, -122.42, "San Francisco"], ["库比蒂诺", "美国", "America/Los_Angeles", 37.32, -122.03, "Cupertino"], ["西雅图", "美国", "America/Los_Angeles", 47.61, -122.33, "Seattle"],
    ["拉斯维加斯", "美国", "America/Los_Angeles", 36.17, -115.14, "Las Vegas"], ["安克雷奇", "美国", "America/Anchorage", 61.22, -149.9, "Anchorage"], ["火奴鲁鲁", "美国", "Pacific/Honolulu", 21.31, -157.86, "Honolulu"],
    ["多伦多", "加拿大", "America/Toronto", 43.65, -79.38, "Toronto"], ["蒙特利尔", "加拿大", "America/Toronto", 45.5, -73.57, "Montreal"], ["温哥华", "加拿大", "America/Vancouver", 49.28, -123.12, "Vancouver"],
    ["卡尔加里", "加拿大", "America/Edmonton", 51.05, -114.07, "Calgary"], ["哈利法克斯", "加拿大", "America/Halifax", 44.65, -63.58, "Halifax"], ["圣约翰斯", "加拿大", "America/St_Johns", 47.56, -52.71, "St. John's"],
    ["墨西哥城", "墨西哥", "America/Mexico_City", 19.43, -99.13, "Mexico City"], ["坎昆", "墨西哥", "America/Cancun", 21.16, -86.85, "Cancun"], ["哈瓦那", "古巴", "America/Havana", 23.11, -82.37, "Havana"],
    ["波哥大", "哥伦比亚", "America/Bogota", 4.71, -74.07, "Bogota"], ["加拉加斯", "委内瑞拉", "America/Caracas", 10.48, -66.9, "Caracas"], ["利马", "秘鲁", "America/Lima", -12.05, -77.04, "Lima"],
    ["圣地亚哥", "智利", "America/Santiago", -33.45, -70.67, "Santiago"], ["布宜诺斯艾利斯", "阿根廷", "America/Argentina/Buenos_Aires", -34.6, -58.38, "Buenos Aires"], ["圣保罗", "巴西", "America/Sao_Paulo", -23.55, -46.63, "Sao Paulo"],
    ["里约热内卢", "巴西", "America/Sao_Paulo", -22.91, -43.17, "Rio de Janeiro"], ["悉尼", "澳大利亚", "Australia/Sydney", -33.87, 151.21, "Sydney"], ["墨尔本", "澳大利亚", "Australia/Melbourne", -37.81, 144.96, "Melbourne"],
    ["布里斯班", "澳大利亚", "Australia/Brisbane", -27.47, 153.03, "Brisbane"], ["珀斯", "澳大利亚", "Australia/Perth", -31.95, 115.86, "Perth"], ["阿德莱德", "澳大利亚", "Australia/Adelaide", -34.93, 138.6, "Adelaide"],
    ["达尔文", "澳大利亚", "Australia/Darwin", -12.46, 130.84, "Darwin"], ["奥克兰", "新西兰", "Pacific/Auckland", -36.85, 174.76, "Auckland"], ["惠灵顿", "新西兰", "Pacific/Auckland", -41.29, 174.78, "Wellington"],
    ["苏瓦", "斐济", "Pacific/Fiji", -18.14, 178.44, "Suva"],
  ].filter(function (c) { try { new Intl.DateTimeFormat("en-US", { timeZone: c[2] }); return true; } catch (e) { return false; } });
  var cityByName = function (n) { return CITIES.find(function (c) { return c[0] === n || c[5].toLowerCase() === String(n || "").toLowerCase(); }) || null; };
  var cityByTz = function (tz) { return CITIES.find(function (c) { return c[2] === tz; }) || null; };

  // ======== 时间：某个时区现在几点、和这里差几小时（Intl，不自己算夏令时）========
  var fmts = {};
  function partsIn(tz, d) {
    var f = fmts[tz];
    if (!f) { try { f = fmts[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }); } catch (e) { f = fmts[tz] = fmts[LOCAL_TZ] || new Intl.DateTimeFormat("en-US", { hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }); } }
    var o = {};
    f.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
  }
  function offsetMin(tz, d) { var p = partsIn(tz, d); return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(d.getTime() / 1000) * 1000) / 60000); }
  // 「今天，+0小时」「明天，+15小时」「昨天，-2:30小时」（同 iOS）
  function relText(tz, d) {
    d = d || new Date();
    var a = partsIn(tz, d), b = partsIn(LOCAL_TZ, d), days = Math.round((Date.UTC(a.y, a.mo - 1, a.d) - Date.UTC(b.y, b.mo - 1, b.d)) / 864e5);
    var diff = offsetMin(tz, d) - offsetMin(LOCAL_TZ, d), sign = diff < 0 ? "-" : "+", h = Math.floor(Math.abs(diff) / 60), m = Math.abs(diff) % 60;
    return (days === 0 ? "今天" : days === 1 ? "明天" : days === -1 ? "昨天" : days > 0 ? "后天" : "前天") + "，" + sign + h + (m ? ":" + pad(m) : "") + "小时";
  }
  var hm = function (h, m) { return pad(h) + ":" + pad(m); };
  // 本地时间字符串（给 agent 看的文件里都用这个）："YYYY-MM-DDTHH:MM:SS"
  function localStr(t) { var d = new Date(t); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); }
  function parseLocal(s) { var d = K.parse(s); return d ? d.getTime() : null; }
  // 秒 → 「15:00」「1:05:09」；ms → 秒表的「00:07.43」
  function hms(sec) { sec = Math.max(0, Math.round(sec)); var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60; return h ? h + ":" + pad(m) + ":" + pad(s) : pad(m) + ":" + pad(s); }
  function swText(ms) { ms = Math.max(0, ms); var cs = Math.floor(ms / 10) % 100, s = Math.floor(ms / 1000) % 60, m = Math.floor(ms / 60000) % 60, h = Math.floor(ms / 3600000); return (h ? h + ":" + pad(m) : pad(m)) + ":" + pad(s) + "." + pad(cs); }
  function durText(sec) { var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60, out = []; if (h) out.push(h + "小时"); if (m) out.push(m + "分钟"); if (s || !out.length) out.push(s + "秒"); return out.join(" "); }
  // 重复：[] 永不；7 天每天；一到五工作日；六日周末；一天「每周一」；别的「周一 周三」（同 iOS）
  function repeatText(r, never) {
    r = (r || []).slice().sort();
    if (!r.length) return never || "";
    if (r.length === 7) return "每天";
    if (r.join() === "1,2,3,4,5") return "工作日";
    if (r.join() === "0,6") return "周末";
    if (r.length === 1) return "每周" + WD[r[0]];
    return r.map(function (x) { return "周" + WD[x]; }).join(" ");
  }
  var alarmSub = function (a) { var r = repeatText(a.repeat); return (a.label || "闹钟") + (r ? "，" + r : ""); };

  // ======== 数据 ========
  var README = [
    "# 时钟",
    "",
    "「时钟」App 的数据就是这个文件夹里的三个 JSON 文件。App 开着时，这里的改动马上显示出来（闹钟、计时器照着新的响）；App 里的改动也马上写回这里。",
    "**时间一律是本地时间**（时区 " + LOCAL_TZ + "）。闹钟、计时器只在网页开着的时候响。",
    "",
    "## cities.json：世界时钟",
    "",
    "```json",
    '[{ "name": "北京", "tz": "Asia/Shanghai" }, { "name": "伦敦", "tz": "Europe/London" }]',
    "```",
    "",
    "数组的顺序就是显示的顺序。`tz` 是 IANA 时区名；`name` 随便起（App 里的城市名见「添加城市」）。",
    "",
    "## alarms.json：闹钟",
    "",
    "```json",
    '[{ "id": "a-1a2b3c", "time": "07:30", "on": true, "repeat": [1, 2, 3, 4, 5], "label": "起床", "sound": "雷达", "snooze": true }]',
    "```",
    "",
    "| 字段 | 说明 |",
    "|---|---|",
    "| `id` | 唯一的字符串（新建时可以不写，App 会补上） |",
    "| `time` | `HH:MM`，24 小时制 |",
    "| `on` | 开着没有 |",
    "| `repeat` | 星期几重复：0 周日、1 周一 … 6 周六；`[]` 只响一次（响过自己关掉） |",
    "| `label` | 标签（可选，默认「闹钟」） |",
    "| `sound` | 铃声：`雷达` `信号` `钟声` `波浪` `无` |",
    "| `snooze` | 能不能稍后提醒（9 分钟后再响） |",
    "| `snoozeUntil` | App 写的：稍后提醒到什么时候 |",
    "",
    "## timers.json：计时器",
    "",
    "```json",
    '{ "timers": [{ "id": "t-4d5e6f", "label": "泡茶", "duration": 180, "endsAt": "2026-09-26T15:03:00" }], "recents": [{ "duration": 180, "label": "泡茶" }] }',
    "```",
    "",
    "| 字段 | 说明 |",
    "|---|---|",
    "| `duration` | 总时长，秒 |",
    "| `endsAt` | 在跑：什么时候到（本地时间） |",
    "| `remaining` | 暂停着：还剩几秒 |",
    "| `label`、`sound` | 标签、铃声（同闹钟） |",
    "",
    "**新加一个计时器只写 `duration`（和 `label`），不写 `endsAt`、`remaining`：App 读到就开始计时。** 到点就响，响过从 `timers` 里拿掉、记进 `recents`。",
    "",
  ].join("\n");
  var store = K.dataDir(DIR, README);
  var cities = [], alarms = [], timers = [], recents = [], loaded = false;
  function readArr(p) { var r = store.readJSON(p); return r.lazy ? null : r.data; }
  function normCity(c) { if (!c) return null; if (typeof c === "string") { var k = cityByName(c) || cityByTz(c); return k ? { name: k[0], tz: k[2] } : null; } var tz = c.tz || c.timeZone || (cityByName(c.name) || [])[2]; if (!tz) return null; try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch (e) { return null; } return { name: String(c.name || (cityByTz(tz) || [tz.split("/").pop().replace(/_/g, " ")])[0]), tz: tz }; }
  function normAlarm(a) {
    if (!a || typeof a !== "object") return null;
    var m = /^(\d{1,2}):(\d{2})/.exec(String(a.time || ""));
    if (!m || +m[1] > 23 || +m[2] > 59) return null;
    var rep = Array.isArray(a.repeat) ? a.repeat.map(Number).filter(function (x) { return x >= 0 && x <= 6; }) : [];
    return { id: String(a.id || K.uid("a-")), time: hm(+m[1], +m[2]), on: a.on !== false, repeat: rep.filter(function (x, i) { return rep.indexOf(x) === i; }).sort(), label: String(a.label || ""),
      sound: SOUNDS[a.sound] || a.sound === "无" ? a.sound : "雷达", snooze: a.snooze !== false, snoozeUntil: a.snoozeUntil || undefined };
  }
  function normTimer(t) {
    if (!t || typeof t !== "object") return null;
    var dur = Math.round(+t.duration || 0);
    if (!(dur > 0)) return null;
    var o = { id: String(t.id || K.uid("t-")), label: String(t.label || ""), duration: dur, sound: SOUNDS[t.sound] || t.sound === "无" ? t.sound : "雷达" };
    var ends = t.endsAt ? parseLocal(t.endsAt) : null;
    if (ends) o.endsAt = ends; else if (t.remaining != null && +t.remaining >= 0) o.remaining = Math.round(+t.remaining); else { o.endsAt = Date.now() + dur * 1000; o.fresh = true; } // agent 新加的：现在开始
    return o;
  }
  function loadAll() {
    var c = readArr(F_CITIES), a = readArr(F_ALARMS), t = readArr(F_TIMERS);
    if (c !== null) cities = (Array.isArray(c) ? c : []).map(normCity).filter(Boolean);
    if (a !== null) {
      var seen = {};
      alarms = (Array.isArray(a) ? a : []).map(normAlarm).filter(Boolean);
      alarms.forEach(function (x) { if (seen[x.id]) x.id = K.uid("a-"); seen[x.id] = 1; }); // agent 抄了一条忘了改 id：换一个，不然开关、删除会动到另一条
    }
    if (t !== null) {
      var o = t && typeof t === "object" ? t : {}, fresh = false;
      timers = (Array.isArray(o.timers) ? o.timers : Array.isArray(t) ? t : []).map(normTimer).filter(Boolean);
      recents = (Array.isArray(o.recents) ? o.recents : []).map(function (r) { return r && +r.duration > 0 ? { duration: Math.round(+r.duration), label: String(r.label || "") } : null; }).filter(Boolean).slice(0, 12);
      timers.forEach(function (x) { if (x.fresh) { fresh = true; delete x.fresh; } });
      if (fresh && loaded) saveTimers(); // 写回去，endsAt 定下来
    }
  }
  var write = function (p, v) { if (!loaded) return; try { FS.as ? FS.as(null, function () { store.writeJSON(p, v); }) : store.writeJSON(p, v); } catch (e) { console.warn("时钟：" + e.message); } };
  function saveCities() { write(F_CITIES, cities.map(function (c) { return { name: c.name, tz: c.tz }; })); }
  function saveAlarms() { write(F_ALARMS, alarms.map(function (a) { var o = { id: a.id, time: a.time, on: a.on, repeat: a.repeat, label: a.label, sound: a.sound, snooze: a.snooze }; if (a.snoozeUntil) o.snoozeUntil = a.snoozeUntil; return o; })); }
  function saveTimers() {
    write(F_TIMERS, { timers: timers.map(function (t) { var o = { id: t.id, label: t.label, duration: t.duration, sound: t.sound }; if (t.endsAt) o.endsAt = localStr(t.endsAt); else o.remaining = t.remaining; return o; }), recents: recents });
  }

  // ======== 声音（Web Audio 合成）：铃声名 → 一段（返回这段多长，秒）========
  var AC = null;
  function audio() {
    if (!AC) { var C = window.AudioContext || window.webkitAudioContext; if (!C) return null; try { AC = new C(); } catch (e) { return null; } }
    if (AC.state === "suspended") AC.resume().catch(function () {});
    return AC;
  }
  // 浏览器要先有一次用户操作才让出声：第一次点页面时把声音准备好（之后到点响不用再点）
  ["pointerdown", "keydown"].forEach(function (t) { document.addEventListener(t, function first() { document.removeEventListener(t, first, true); if (window.AudioContext || window.webkitAudioContext) audio(); }, true); });
  function tone(ctx, out, t, f, dur, type, vol, f2) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }
  var SOUNDS = {
    "雷达": function (c, o, t) { for (var i = 0; i < 4; i++) { tone(c, o, t + i * 0.16, 1318, 0.12, "sine", 0.22); tone(c, o, t + i * 0.16, 2637, 0.1, "sine", 0.05); } for (var j = 0; j < 4; j++) tone(c, o, t + 0.9 + j * 0.16, 1568, 0.12, "sine", 0.22); return 2; },
    "信号": function (c, o, t) { [0, 0.22, 0.44].forEach(function (d) { tone(c, o, t + d, 880, 0.16, "square", 0.08); }); return 1.4; },
    "钟声": function (c, o, t) { [[784, 0], [988, 0.35], [1175, 0.7]].forEach(function (n) { tone(c, o, t + n[1], n[0], 1.4, "sine", 0.2); tone(c, o, t + n[1], n[0] * 2.01, 0.9, "sine", 0.05); }); return 2.2; },
    "波浪": function (c, o, t) { tone(c, o, t, 440, 1.6, "triangle", 0.18, 660); tone(c, o, t + 1.6, 660, 1.4, "triangle", 0.14, 440); return 3.2; },
  };
  var SOUND_NAMES = ["雷达", "信号", "钟声", "波浪"];
  function playOnce(name) {
    var ctx = audio(), fn = SOUNDS[name];
    if (!ctx || !fn) return;
    var g = ctx.createGain();
    g.connect(ctx.destination);
    fn(ctx, g, ctx.currentTime + 0.02);
    setTimeout(function () { try { g.disconnect(); } catch (e) {} }, 4000);
  }
  // 一直响到停：每段放完再来一段
  var loop = null;
  function startLoop(name) {
    stopLoop();
    var ctx = audio(), fn = SOUNDS[name];
    if (!ctx || !fn) return;
    var g = ctx.createGain(), me = { g: g, t: 0, on: true };
    g.connect(ctx.destination);
    var next = ctx.currentTime + 0.05;
    (function more() {
      if (!me.on) return;
      while (next < ctx.currentTime + 1) next += fn(ctx, g, next) + 0.6;
      me.t = setTimeout(more, 400);
    })();
    loop = me;
  }
  function stopLoop() { if (!loop) return; loop.on = false; clearTimeout(loop.t); try { loop.g.gain.setValueAtTime(0, (AC || { currentTime: 0 }).currentTime); loop.g.disconnect(); } catch (e) {} loop = null; }

  // ======== 响铃：通知 + 提醒框（稍后提醒 / 停止；计时器是重复 / 停止）+ 声音；15 分钟没人管自己停 ========
  // 几台设备同时到点：同一次响铃是账号里的同一条通知（o.key），在哪台上停了 / 稍后提醒了，别的设备跟着停（声音、提醒框都收），
  // 而且只有按的那台去改闹钟文件（不会一台写「稍后提醒」、另一台又写「停止」）
  var rings = [];
  function ring(o) {
    rings.push(o);
    if (o.sound && o.sound !== "无") startLoop(o.sound);
    var note = D.notify({ app: APP, key: o.key, title: o.title, body: o.body, onClick: function () { open(o.tab); } }) || {};
    var bs = (o.buttons || []).concat([{ label: "停止", role: "default" }]), ctl = new AbortController(), elsewhere = false;
    var gone = function (e) { if (note.id && ((e.detail && e.detail.ids) || []).indexOf(note.id) >= 0) { elsewhere = true; ctl.abort(); } };
    document.addEventListener("tsu-note-gone", gone);
    var done = false, finish = function (label) {
      if (done) return;
      done = true;
      document.removeEventListener("tsu-note-gone", gone);
      rings = rings.filter(function (x) { return x !== o; });
      if (!rings.length) stopLoop(); else if (rings[rings.length - 1].sound && rings[rings.length - 1].sound !== "无") startLoop(rings[rings.length - 1].sound);
      if (elsewhere) return; // 别的设备上处理了：它去改文件，这里只是停
      if (note.close) note.close(); // 这台处理了：账号里的那条算处理了，别的设备跟着停
      if (o.onDone) o.onDone(label);
    };
    o.stop = function () { finish("停止"); };
    D.alert({ title: o.title, message: o.body, icon: ICON_HTML, buttons: bs, signal: ctl.signal, signalLabel: "停止" }).then(finish, function () { finish("停止"); });
    setTimeout(tickIcons, 0); // 提醒框、通知上的图标：马上对上现在的时间（不等下一秒）
    setTimeout(function () { finish("停止"); }, 15 * 60000);
  }

  // ======== 闹钟：每秒看一次，（上次看过，现在] 之间到点的就响；网页关着时错过的，打开时补一条通知 ========
  function occurrences(a, t0, t1) {
    var out = [], hh = +a.time.slice(0, 2), mm = +a.time.slice(3, 5), d = new Date(t0);
    d.setHours(0, 0, 0, 0);
    for (var i = 0; i < 9 && d.getTime() <= t1; i++) {
      var c = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0).getTime();
      if (c > t0 && c <= t1 && (!a.repeat.length || a.repeat.indexOf(new Date(c).getDay()) >= 0)) out.push(c);
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  function nextAlarmTime(a, from) { var o = occurrences(a, from || Date.now(), (from || Date.now()) + 8 * 864e5); return o.length ? o[0] : null; }
  var lastTick = 0, firstTick = true;
  function tick() {
    if (!loaded) return;
    var now = Date.now(), last = lastTick || +(localStorage.getItem("tsu-clock-tick") || 0) || now, missed = [], changedA = false, changedT = false;
    if (now - last > 8 * 864e5) last = now - 8 * 864e5;
    alarms.forEach(function (a) {
      if (!a.on) return;
      var os = occurrences(a, last, now);
      if (a.snoozeUntil) { var su = parseLocal(a.snoozeUntil); if (su && su > last && su <= now) os.push(su); }
      if (!os.length) return;
      var t = os[os.length - 1];
      if (firstTick && now - t > 20000) { if (now - t < 3600e3) missed.push(a); } // 网页关着的时候到的点：不响，补一条通知（一小时以内的）
      else fireAlarm(a, t);
      if (a.snoozeUntil && parseLocal(a.snoozeUntil) <= now) delete a.snoozeUntil;
      if (!a.repeat.length && !a.snoozeUntil) a.on = false; // 只响一次的：响过（或错过）就关掉
      changedA = true;
    });
    timers.forEach(function (t) {
      if (!t.endsAt || t.endsAt > now) return;
      var late = now - t.endsAt;
      t.done = true;
      changedT = true;
      if (firstTick && late > 20000) { if (late < 3600e3) missed.push({ timer: t }); } else fireTimer(t);
    });
    if (changedT) { timers = timers.filter(function (t) { return !t.done; }); saveTimers(); }
    if (changedA) saveAlarms();
    if (missed.length) D.notify({ app: APP, title: "错过的闹钟", body: missed.map(function (m) { return m.timer ? "计时器 " + (m.timer.label || durText(m.timer.duration)) : m.time + " " + (m.label || "闹钟"); }).join("\n"), onClick: function () { open("alarm"); } });
    if (changedA || changedT) render();
    firstTick = false;
    lastTick = now;
    try { localStorage.setItem("tsu-clock-tick", String(now)); } catch (e) { /* 满了 */ }
  }
  function fireAlarm(a, t) {
    ring({ key: "clock:alarm:" + a.id + ":" + t, title: a.label || "闹钟", body: a.time, sound: a.sound, tab: "alarm", buttons: a.snooze ? [{ label: "稍后提醒" }] : [],
      onDone: function (label) {
        if (label !== "稍后提醒") return;
        var cur = alarms.find(function (x) { return x.id === a.id; });
        if (!cur) return;
        cur.snoozeUntil = localStr(Date.now() + 9 * 60000); // 同 Apple：9 分钟
        cur.on = true;
        saveAlarms();
        render();
      } });
  }
  function fireTimer(t) {
    addRecent(t.duration, t.label);
    ring({ key: "clock:timer:" + t.id + ":" + t.endsAt, title: t.label || "计时器", body: "计时结束 · " + durText(t.duration), sound: t.sound, tab: "timer", buttons: [{ label: "重复" }],
      onDone: function (label) { if (label === "重复") startTimer(t.duration, t.label, t.sound); } });
  }
  function addRecent(dur, label) {
    recents = [{ duration: dur, label: label || "" }].concat(recents.filter(function (r) { return !(r.duration === dur && (r.label || "") === (label || "")); })).slice(0, 12);
  }

  // ======== 操作（两套界面共用）========
  function addCity(c) { if (cities.some(function (x) { return x.tz === c[2] && x.name === c[0]; })) return; cities.push({ name: c[0], tz: c[2] }); saveCities(); render(); }
  function removeCity(i) { cities.splice(i, 1); saveCities(); render(); }
  function moveCity(from, to) { var c = cities.splice(from, 1)[0]; cities.splice(to, 0, c); saveCities(); render(); }
  function saveAlarm(a) {
    var i = alarms.findIndex(function (x) { return x.id === a.id; });
    delete a.snoozeUntil;
    a.on = true;
    if (i >= 0) alarms[i] = a; else alarms.push(a);
    sortAlarms();
    saveAlarms();
    render();
  }
  function sortAlarms() { alarms.sort(function (x, y) { return x.time < y.time ? -1 : x.time > y.time ? 1 : 0; }); }
  function toggleAlarm(id, on) { var a = alarms.find(function (x) { return x.id === id; }); if (!a) return; a.on = on; if (!on) delete a.snoozeUntil; saveAlarms(); render(); }
  function deleteAlarm(id) { alarms = alarms.filter(function (x) { return x.id !== id; }); saveAlarms(); render(); }
  function startTimer(sec, label, sound) {
    if (!(sec > 0)) return;
    timers.push({ id: K.uid("t-"), label: label || "", duration: sec, endsAt: Date.now() + sec * 1000, sound: sound || "雷达" });
    addRecent(sec, label);
    try { localStorage.setItem("tsu-clock-lastdur", String(sec)); } catch (e) {}
    audio(); // 用户刚点过：趁现在把声音准备好
    saveTimers();
    render();
  }
  function pauseTimer(id) { var t = timers.find(function (x) { return x.id === id; }); if (!t || !t.endsAt) return; t.remaining = Math.max(0, Math.round((t.endsAt - Date.now()) / 1000)); delete t.endsAt; saveTimers(); render(); }
  function resumeTimer(id) { var t = timers.find(function (x) { return x.id === id; }); if (!t || t.endsAt) return; t.endsAt = Date.now() + (t.remaining || 0) * 1000; delete t.remaining; saveTimers(); render(); }
  function cancelTimer(id) { timers = timers.filter(function (x) { return x.id !== id; }); saveTimers(); render(); }
  var timerLeft = function (t) { return t.endsAt ? Math.max(0, (t.endsAt - Date.now()) / 1000) : t.remaining || 0; };

  // 秒表：记在本机（刷新不停，同 iOS 退到后台也在走）
  var SW_KEY = "tsu-clock-sw", sw = K.store.get(SW_KEY, { run: false, t0: 0, acc: 0, laps: [] });
  if (!Array.isArray(sw.laps)) sw.laps = [];
  var swElapsed = function () { return sw.acc + (sw.run ? Date.now() - sw.t0 : 0); };
  var swLapNow = function () { return swElapsed() - sw.laps.reduce(function (a, b) { return a + b; }, 0); };
  function swSave() { K.store.set(SW_KEY, sw); }
  function swStart() { if (sw.run) return; sw.run = true; sw.t0 = Date.now(); swSave(); render(); }
  function swStop() { if (!sw.run) return; sw.acc += Date.now() - sw.t0; sw.run = false; swSave(); render(); }
  function swLap() { if (!sw.run) return; sw.laps.push(swLapNow()); swSave(); render(); }
  function swReset() { if (sw.run) return; sw = { run: false, t0: 0, acc: 0, laps: [] }; swSave(); render(); }
  // 最快（绿）/ 最慢（红）：至少有两圈跑完了才标（同 iOS）
  function lapMarks() { var l = sw.laps; if (l.length < 2) return {}; var mn = Math.min.apply(null, l), mx = Math.max.apply(null, l); return { min: l.indexOf(mn), max: l.lastIndexOf(mx) }; }

  // ======== 画表盘（SVG）：白天白底黑字、夜里黑底白字（同 iOS / iPad 的世界时钟）========
  function faceSVG(cls) {
    var nums = "";
    for (var i = 1; i <= 12; i++) { var a = i * Math.PI / 6, r = 37; nums += '<text x="' + (50 + r * Math.sin(a)).toFixed(1) + '" y="' + (50 - r * Math.cos(a) + 4.2).toFixed(1) + '">' + i + "</text>"; }
    var ticks = "";
    for (var j = 0; j < 60; j++) { if (j % 5 === 0) continue; var b = j * Math.PI / 30; ticks += "M" + (50 + 46 * Math.sin(b)).toFixed(2) + " " + (50 - 46 * Math.cos(b)).toFixed(2) + "L" + (50 + 44.3 * Math.sin(b)).toFixed(2) + " " + (50 - 44.3 * Math.cos(b)).toFixed(2); }
    return '<svg class="clk-face ' + (cls || "") + '" viewBox="0 0 100 100" aria-hidden="true"><circle class="clk-fbg" cx="50" cy="50" r="49"/><path class="clk-fticks" d="' + ticks + '"/>' +
      '<g class="clk-fnum">' + nums + '</g><g class="clk-hh"><line x1="50" y1="54" x2="50" y2="27"/></g><g class="clk-mh"><line x1="50" y1="56" x2="50" y2="12"/></g>' +
      '<g class="clk-sh"><line x1="50" y1="60" x2="50" y2="9"/><circle cx="50" cy="50" r="2.4"/></g><circle class="clk-fpin" cx="50" cy="50" r="1.1"/></svg>';
  }
  function setHands(svg, p) {
    var sec = p.s, min = p.mi + sec / 60, hr = (p.h % 12) + min / 60;
    var set = function (sel, deg) { var g = svg.querySelector(sel); if (g) g.setAttribute("transform", "rotate(" + deg.toFixed(2) + " 50 50)"); };
    set(".clk-hh", hr * 30); set(".clk-mh", min * 6); set(".clk-sh", sec * 6);
    svg.classList.toggle("night", p.h < 6 || p.h >= 18);
  }
  // Dock / 启动台 / iPhone 主屏幕上的图标：同 Apple 的「时钟」图标，指针是真的时间
  var ICON_SVG = (function () {
    var nums = "";
    for (var i = 1; i <= 12; i++) { var a = i * Math.PI / 6; nums += '<text x="' + (32 + 20.5 * Math.sin(a)).toFixed(1) + '" y="' + (32 - 20.5 * Math.cos(a) + 2.3).toFixed(1) + '">' + i + "</text>"; }
    return '<svg class="clk-live" viewBox="0 0 64 64" width="100%" height="100%"><rect width="64" height="64" rx="14" fill="#141414"/><circle cx="32" cy="32" r="27.5" fill="#fff"/>' +
      '<g font-family="-apple-system,Helvetica,sans-serif" font-size="6.4" font-weight="500" text-anchor="middle" fill="#111">' + nums + "</g>" +
      '<g class="clk-ih"><line x1="32" y1="34" x2="32" y2="18.5" stroke="#111" stroke-width="2.4" stroke-linecap="round"/></g><g class="clk-im"><line x1="32" y1="35" x2="32" y2="10.5" stroke="#111" stroke-width="1.8" stroke-linecap="round"/></g>' +
      '<g class="clk-is"><line x1="32" y1="37.5" x2="32" y2="9" stroke="#ff9500" stroke-width=".9" stroke-linecap="round"/><circle cx="32" cy="32" r="1.6" fill="#ff9500"/></g></svg>';
  })();
  var ICON_HTML = '<span class="ico sq ico-clockapp">' + ICON_SVG + "</span>";
  function tickIcons() {
    var d = new Date(), s = d.getSeconds(), m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
    Array.prototype.forEach.call(document.querySelectorAll("svg.clk-live"), function (svg) {
      var set = function (sel, deg) { var g = svg.querySelector(sel); if (g) g.setAttribute("transform", "rotate(" + deg.toFixed(1) + " 32 32)"); };
      set(".clk-ih", h * 30); set(".clk-im", m * 6); set(".clk-is", s * 6);
    });
  }

  // ======== 世界地图（Natural Earth，公有领域）：经度 -180…180 → x 0…360，纬度 84…-58 → y 0…142 ========
  var LAND = "M101.8 75.7l-1.4-0.6l-0.9 0.8l0.5 0.6l-0.9 0.3l-0.2-0.6l-2.4-0.6l-0.1-0.7l-1.4-1l-0.1 0.5l-0.6-0.3l0-1.2l-2-1.8l0.2-0.4l-3.7-0.6l-3.5-2.3l-1.9 0.5l-6.9-2.6l-2-1.6l-0.2-0.5l0.4-1l-0.7-1.4l-3.3-2.8l0-0.8l-1.1-0.8l-0.2-0.7l-1.6-1.1l-0.9-2.2l-1.7-0.6l0.1 1.6l3.1 3.5l0.9 2.4l0.5 0l0.8 1.1l-0.6 0.4l-2.2-1.9l-0.1-1.3l-2.8-1.7l0.5 0l0.4-0.9l-1.3-1l-1.8-3.4l-1.2-1l-2.1-0.6l-3.8-5.7l-0.1-2.5l0.6-2.7l-0.8-2.7l1.6 0.2l0.5 0.9l-0.2-1.9l-2.8-1.4l-1.8-0.4l-0.6-0.9l0.1-0.6l-1.2-0.5l-0.2-0.8l-2.7-1.9l-0.3-0.9l-1.2-0.8l-0.6-0.9l-2.5-0.1l-3.3-1.3l-7.2-1.4l-1.1 0.2l0.2 0.7l-3.7 0.8l0.3-1.5l1.1-0.3l-0.3-0.3l-3.4 1.9l0.7 0.5l-0.9 0.8l-2.1 0.7l-2.1 1.4l-6.4 1.6l7.1-3.2l0.7-1.3l-2.1 0.5l-1.3-0.7l-1.6 0.4l0.1-0.9l-0.6-0.4l-1.3 0.2l-1.5-0.7l-0.1-0.6l-0.7-0.4l0.4-0.6l1.1-1l1.5 0l2.3-0.7l-0.7-0.6l0.7-0.4l-4.2 0.4l-1.4-0.3l-1.7-1l3.6-0.9l0.8 0l-0.1 0.5l2.1 0l-5.1-2.3l0.6-0.5l3-0.5l1.3-0.9l5.3-1.1l2.3 0.7l10.7 0.5l7.1 1.3l2.1-0.7l1.5 0.1l3.1-0.7l0.7 0.4l1-0.7l2.3 1l1.4-0.7l0.1 0.8l2.8-0.4l7.6 1.4l-1.4 0.5l5.4-0.1l1 0.6l1.1-0.5l-1-0.4l0.6-0.4l2-0.1l1.9 0.8l2.8 0.4l3.1-0.2l-0.2-0.6l0.9-0.2l1.6 0.4l0 0.9l0.6-0.8l0.8 0l0.5-1l-2.3-1l0.1-1.1l1.2-0.7l1.3 0.1l2.4 1.6l-0.9 0.5l1.9 0.2l-0.1 1l1.4-0.8l1.2 0.7l-0.3 0.7l0.9 0.7l1.8-1.6l0.1-1.1l2.9 0.2l1.3 0.5l0.1 0.5l-0.8 0.6l0.7 0.5l-0.1 0.5l-1.9 0.7l-2.5-0.2l-1.5 1.8l-3.4 1.2l-0.1 0.6l-1.1 0.2l-2.3 1.9l-0.5 2l1.5 0.1l0.9 1.7l1.4-0.2l5.9 2l2.7 0.2l0.2 1.8l0.7 1.1l1.5 1l0.8-0.3l0.5-1.1l-0.5-1.5l-0.7-0.6l1.6-0.4l1.7-1.4l-0.8-1.6l-1.2-0.7l1.2-1.1l-0.8-2.4l4.3-0.1l2.4 1.3l1.8 0l0.3 2.1l1.7 0.8l1.4-0.6l1.6-1.5l3.2 3.3l-0.4 0.7l4.5 1.7l0.4 0.8l1.1 0.5l0.1 1.2l-4.3 1.9l-6.4 0l-4.7 3.4l2.4-1.5l3.6-0.9l0.9 0.5l-0.9 0.6l0.6 1.9l1.3 0.5l1.7-0.2l1-1.1l0.1 0.7l0.6 0.4l-5.6 2.4l-0.7-0.1l-0.1-0.9l1.8-0.8l-2.7 0.2l0.1 0.3l-3.1 1.1l-0.5 0.6l-0.2 0.8l0.8 0.7l-3.7 0.7l1.8 0l-2.1 0.1l-0.9 1.9l-0.6-0.6l0.4 1.1l-0.8 1.2l0.2-0.7l-0.7-1.2l0.1 1l-0.7-0.1l0.7 0.3l0.6 2.3l-3.4 2.1l-2.2 2.1l0 1.4l1.2 3.1l-0.3 1.7l-0.8 0l-0.5-0.7l-1.2-2l0.3-0.7l-1.1-1.3l-1.4 0.3l-1.3-0.8l-3.2 0.2l0.2 1l-4.4-0.5l-2.8 1.4l-0.8 0.9l0.3 1.5l-0.4 0.1l0.4-0.1l-0.8 3.5l2 3.6l1.5 0.7l3-0.8l0.6-0.4l0.5-1.7l3.2-0.5l0.3 0.7l-1 2.5l-0.5-0.2l-0.1 2l-0.5 0.6l3.9-0.1l1.6 0.7l0.2 1l-0.6 3.2l1.6 2.1l1.3 0.1l1.3-0.7l2.8 1l1.1-0.8l0.2-1.2l0.6-0.5l1.5-0.1l1.6-1.2l0.7 0.3l-0.8 0.7l0.2 2.3l0.7-0.8l-0.4-1.1l1.2-0.4l0.3-0.8l1.7 1.6l2 0l1.3 0.5l0.6-0.5l2.4-0.1l-0.8 0.3l0.3 0.5l1.6 0.5l0.1 0.8l1.6 0.6l0.6 1.2l1.4 0.8l3.1 0.2l2.7 1.6l0.8 2.3l0.5 0.2l0.1 0.7l-0.8 0.8l2.1 0.4l0 1l0.8-0.6l2.9 1l0.5 0.5l-0.2 0.6l1.2-0.3l3.4 0.5l2.8 1.9l2 0.7l0.5 1.8l-0.4 1.7l-3.6 4.1l-0.6 4.8l-1.6 4l-1.1 1.1l-2.6 0.4l-3 1.5l-0.9 1l-0.4 2.8l-4.9 5.7l-1.1 0.6l-1.3-0.1l-2.2-1l-0.1 0.5l1.3 0.9l-0.2 0.7l0.7 0.4l-0.1 0.5l-0.9 1.3l-1.5 0.5l-3.1 0.1l0.2 1.9l-0.6 0.3l-2.4 0.1l0.1 1l0.7 0.3l0.5-0.4l0.3 0.6l-1.7 0.9l-0.4 1.5l-1.7 0.6l-0.3 0.7l2 0.9l-0.4 0.9l-1.2 0.6l-0.6 1.2l-1.3 0.8l1 1.6l-1.4 0l-1.3 0.6l-0.2 0.9l-3.9-1.5l-0.7-3.6l0.4-1l1.1-0.8l-1.5-0.3l0.9-0.8l0.3-1.7l1.2 0.4l0.5-2.1l-0.7-0.3l-0.3 1.3l-0.6-0.2l1.1-3.9l-0.4-2.1l0.4-0.1l1.8-4.7l-0.1-3.5l0.6-1.3l0.7-7.8l-0.2-1.5l-1.1-0.9l-4.5-2.8l-3.8-7.4l-1.4-1.1l0.3-0.4l-0.5-1l1.6-2l-0.2-0.5l-0.4 0.5l-0.6-0.5l0.1-1.1l0.8-1.9l1.2-0.6l0.5-1.2l1.3-1.2l-0.4-0.3l0-2.6l-0.7-0.8l0-0.8zM24.1 64.9l0-1.2l1.1 0.8l-0.9 0.6l-0.2-0.2zM103.5 62.8l2.3 0.9l-3.6 0.4l0.7-0.5l-1-0.3l-0.6-0.9l-3.5-0.8l0.4-0.2l-3.2 0.7l1.7-1.1l2.7-0.1l1.3 0.7l1-0.1l1.8 1.3zM51.6 33.2l2.6 0.5l2.3 1.8l-2.2-0.3l-2.4-1.2l-0.3-0.8zM46.8 30.1l0-0.3l1.5 0.1l-0.3 1.1l0.8 0.8l-2-1.7zM26.8 26l1.1 0.4l-1.9 0.9l-0.5-0.3l-0.2-0.5l1.5-0.5zM98.1 21.1l-1.2 0.7l-0.9-0.3l0.7-0.4l1.4 0zM8.4 20.7l-0.1-0.5l3 0.5l-0.8 0.3l-2.1-0.3zM96.9 19.9l-2.4 1l-0.4-0.5l-1.3 0.1l0.8-0.5l0.5-1.7l5.8 2l-0.9 0.3l-2.1-0.7zM7.4 19.5l-1.3 0.2l-2.3-1.1l-2.2 0l-0.5-0.3l0.2-0.4l-1.2 0.2l0.5 0.5l-0.6 0.4l0-4l5.1 1.8l-0.1 0.6l0.7 0.3l-0.3-0.8l2.7 0.2l2 0.9l-2.6 0.6l-0.1 0.9zM82.8 14.1l1.6 0.8l-0.7 0.3l-3.5-0.6l1.6-0.7l1 0.2zM77.9 14.9l-0.3 0.3l-3.6-0.4l-7.3 0.7l-0.6-0.5l-2.2-0.2l-1.2-0.8l4.9-0.4l-5.5-0.1l-0.5-0.4l2.3-0.4l-3.3-0.3l1.5-1.1l2.7-0.6l1 0.2l-0.5 0.4l2.3-0.3l1.3 0.5l1.2-0.5l1.7 1.3l0.5-0.4l-0.7-1l0.9-0.1l2.1 0.5l0.9 1.7l3.5 1l-0.1 0.4l-1.6 0.1l0.6 0.4zM0 13.2l0.1-0.8l2.3 0.3l-1.1 0.4l-1.3 0.1zM83.3 12.3l-2.6 0.3l-3.2-1.4l2.1 0.1l-1.1-0.7l1.1-0.4l3 0l0.3 0.3l-1 0.5l1.6 0.4l-0.2 0.9zM59.5 12.6l-2.6 0.5l-2.8-1l2-1.8l-1-0.6l7.3 0.1l2.1 0.7l-3.7 1l-1.3 0.7l0 0.4zM84.5 10.1l1-0.2l4 0.2l-3.8 1.9l-1.1-0.1l-0.6-0.8l0.5-1zM73.1 10.5l1.6-0.1l0.8 0.2l-0.9 0.6l-1.5-0.7zM101.6 11.1l-1.4 0.1l-1.1-0.5l0.1-0.4l2.7 0l1.8 0.9l-2.1-0.1zM85.8 9.4l-1.4-0.1l-1.2-0.2l1.9-0.7l1.3 0.6l-0.6 0.4zM66.1 9.3l2.1-0.5l-5.9 0l2.3-1.3l6.3 1l-1.4-0.9l0.9-0.4l1.1 0.1l0.7 0.9l1.9-0.2l0.2 0.5l-0.6 0.5l-5.9 0.6l-1.7-0.3zM83.3 6.8l5.1 0.4l0.9 0.4l-0.3 0.3l1.8 0.5l8.1-0.1l1.3 0.8l-2.1 0.5l-6.3 0l-4.2-0.4l-0.5-1.1l-4.2-0.9l0.4-0.4zM77.4 7.7l4.1-0.4l0.8 1l-0.5 0.7l-1.6 0.1l-1.1-0.2l0-0.5l-1.6 0l-0.1-0.7zM62 7.5l-3.5 0.6l-1.4-0.2l3.8-1.4l2.9-0.1l-0.1 0.7l-1.7 0.4zM69.8 6.3l-1.9 0.3l-1.4-0.3l3.6-0.3l-0.3 0.3zM83.2 5.2l1.2 0.4l-1.7 0.5l-0.8-0.2l-0.5-0.8l1.8 0.1zM75.8 5.3l-1.2-0.2l-0.1-0.4l4.7 0.5l1.1 0.9l-5.5-0.5l1-0.3zM69.1 5.6l-1.6 0l1-0.4l1.8 0.2l-1.2 0.2zM93 4.3l1.2 0.4l-3.2 1l-1.8 0.1l-2.1-0.1l-1.1-0.5l0.9-0.6l-1.9 0l-1.7-0.8l2.4-0.8l-0.4-0.2l2.3-0.1l4.6 1l0.8 0.6zM106.7 138l-1.4-1.2l3.6 1.3l0.8-1.2l1-0.4l0.7 0.1l0.8 1.2l2.8 0.9l-0.5 0.5l-1.5-0.3l-1.6 0.7l-4.7-1.6zM119.3 136.3l-0.5-0.5l1.2-0.6l0.8 0.3l0.6-0.4l0.8 0.5l-2.9 0.7zM167.1 76.2l-0.3-1.1l-1.6-2l-1.8-1.3l-0.1-1.4l-0.9-1.1l1.1-1.4l0.4-2l-0.9-3.8l1.9-2.6l0.7-1.8l1.8-1.7l0.9-0.1l2.1-1.8l-0.2-1.3l0.5-1.4l2.4-1.5l1-1.7l3.7 0.6l3.7-1.4l6.9-0.3l1.1-0.4l0.7 0.1l0 0.5l0.9-0.2l-0.5 0.5l0.3 0.7l-0.1 0.9l-0.7 0.5l0.2 0.5l4.9 1.5l0.5 0.9l3.4 1.1l1-0.7l0-1.2l1.4-0.6l7.4 1.9l2.1-0.7l1 0.7l0.2-0.4l1.6 0.3l0.8-0.5l1.4-3.1l0.1-1.2l-0.3-0.5l0.4-0.4l-1.5-0.1l-0.7 0.6l-1.5 0.1l-0.8-0.5l-2 0.5l-2.1-0.6l-1.3-1.5l0.5-0.8l-0.6-0.5l1.1-0.9l1.5-0.1l0.4-0.7l1.9 0.1l2.4-0.9l1.7 0l3.1 1.1l2.1-0.1l1.2-0.5l-0.1-1.1l-4.8-2.6l1.5-1l-0.5-0.4l1.4-0.7l-4.1 1l0 0.6l1.5 0.2l-0.2 0.4l-2.4 0.7l-0.6-0.2l0.2-0.4l-1-0.3l1.1-0.6l-0.3-0.2l-2.6-0.5l-1.1 1.6l-0.8 0.1l-1.1 2.3l1.1 1.5l-1.2 0.1l-1.2 0.8l-0.3-0.6l-1.2-0.1l-1.2 0.2l0.7 0.6l-0.5 0.1l-1.3-0.3l0.8 1.1l-0.4 0.2l1 0.8l0 0.5l-0.9-0.2l0.3 0.5l-0.6 0.1l0.4 0.9l-0.7 0l-0.8-0.4l-0.6-1.5l-1.7-2l0.1-1.4l-3.5-1.8l-1.1-1.6l-0.6-0.1l-0.3 0.4l-0.1-0.8l-0.8-0.1l-0.8 0.3l0.3 1.3l2.5 2.1l0.8 0l0 0.5l2.6 1.3l-0.2 0.4l-1.4-0.6l-0.5 0.6l0.8 0.4l-0.1 0.5l-1 0.9l-0.4 0.1l0.4-1.1l-0.7-1l-3.3-1.7l-1.6-1.2l-0.3-1l-1.3-0.5l-2.4 1.3l-1.9-0.3l-1.5 0.3l-0.1 1.2l-2.2 0.9l-1.1 1.7l0.4 0.6l-2.2 2l-2.3 0l-1 0.8l-1.1-1l-2.4 0l0.1-1.4l-0.7-0.4l0.7-2.1l-0.6-2.2l1.4-0.7l6.1 0.3l0.5-0.6l0.2-2l-1.8-1.6l-1.5-0.4l-0.1-0.7l3 0.1l-0.3-1.2l0.9 0.5l2.3-0.8l0.3-0.8l2.2-0.7l0.9-1.5l3.4-0.4l0.7-0.5l-0.7-1.5l0.4-1.6l2.1-0.6l-0.3 0.8l0.6 0.4l-1.3 1l0.3 0.9l1.1 0.2l-0.1 0.4l1.6-0.5l1.6 0.7l3.5-1.1l2.1 0.5l1.6-0.8l-0.2-1.6l0.5-0.6l0.9-0.4l0.8 0.8l0.8 0l0.3-1.4l-1-0.2l-0.1-0.6l4.7-0.3l1.1-0.5l-1-0.5l-5.2 0.7l-1.6-0.9l0.2-1l-0.4-0.9l0.4-0.6l3.9-1.9l-0.1-0.4l-1.4-0.5l-1.7 0.3l-1 0.7l0.2 0.6l-3.6 1.7l-0.7 1.4l1.7 1.2l-0.9 1.1l-1.1 0.3l-0.9 2.6l-1.2-0.1l-0.6 0.8l-1.2 0l-2.5-4.1l-2 1.2l-1.4 0.2l-1.3-0.5l-0.7-3.4l5.5-2.5l4.3-3.3l4.4-2l3.8-0.4l1.5-0.8l3.7-0.2l3.1 0.7l-1.3 0.3l1.1 0.6l1-0.3l4.4 0.8l4.6 1.6l0 0.7l-2.7 0.8l-5.2-0.6l1.6 0.7l0.1 1.5l2.1 0.6l0.1-0.5l-0.6-0.5l0.7-0.3l2.4 0.6l0.8-0.3l-0.6-0.7l2.3-1l1.8 0.4l0.6-0.7l-0.8-0.6l0.5-0.6l-0.7-0.6l2.8 0.4l0.5 0.5l-1.2 0.1l0 0.6l0.7 0.3l1.6-0.2l0.2-0.6l5.6-1.4l0.8 0.1l-1 0.6l5.3-0.7l1.1 0.6l1.2-0.6l-1.1-0.6l0.6-0.4l2.9 0.4l5 1.4l0.7-0.5l-1.1-0.8l-1.2-0.1l0.4-0.4l-0.6-1.1l3.2-2l2.7 0.2l0.2 0.6l-1 0.8l1 1l-0.2 1.4l1.1 0.6l-2.4 2.1l1.1 0.1l2.7-1.6l-0.6-0.5l0.4-0.7l-1.1-0.1l-0.2-0.5l0.8-1l-1.3-0.8l1.8-0.7l-0.2-0.7l1 0.5l-0.4 1l1.1 0.1l-0.5-0.7l1.7-0.4l2.1 0l1.8 0.5l-0.9-0.8l-0.1-1l6.3-0.3l-0.8-0.6l1.2-0.6l6-0.9l3.5 0.1l4.1-0.5l1.2-0.9l2.4-0.4l1.7 0.3l-1.4 0.3l2.3 0.1l0.2 0.5l3.9-0.2l3 0.9l-0.2 0.5l-4.5 1.1l3.6 0.2l0.5 0.7l2.1-0.5l7.6 0.8l0.1-0.7l3.7 0.1l1.6 0.6l0.5 0.6l-0.6 0.4l2.8 1.2l1-1l1.6 0.4l6-0.1l-0.8-0.9l1.4-0.4l9 0.6l3.5 1.4l6-0.1l0.8 0.4l-0.1 0.8l1.2 0.3l6.9-0.2l1.8 0.9l1.2-0.3l-0.8-0.7l0.5-0.4l5.2 0.2l4.3 0.9l0 4l-2.6 0.4l2 1.6l-0.2 0.7l-1.8-0.2l-3.7 0.8l-3.4 1.8l-1.4-0.7l-2.6 0.8l-0.5-0.4l-0.9 0.5l-1.4-0.2l-1.5 1.7l0.1 0.4l1.1 0.2l-0.1 1.4l-1 0.1l-0.4 0.8l0.4 0.4l-1.7 0.6l-0.4 1.1l-1.5 0.2l-0.3 1.1l-1.4 0.9l-1.4-4.4l0.5-1.4l0.9-1l1.6-0.3l5.3-3l0.8-1.5l-1.2 0.1l-0.6 0.9l-2.6 1.1l-0.8-1.3l-2.6 0.4l-2.5 1.6l0.8 0.7l-3.7 0.3l0-0.7l-1.5-0.2l-1.3 0.5l-6.3 0.2l-7.1 4.3l1.6 0.1l1.5 0.8l0.6-0.5l1.1 0.1l1.4 1.1l0.1 0.9l-0.8 1l-0.5 2.8l-1.9 2.1l-3.3 2.9l-1.4 0.6l-1.2-0.5l-2.3 1.4l-0.3 1l-2.2 1.1l-0.1 0.6l0.9 0.6l1.2 1.8l-0.4 1.7l-2.6 0.7l-0.4-2.3l0.8-0.2l-0.7-0.8l-1.5-0.4l0.6-1.5l-1-0.3l-3.2 1l1.1-1.5l-0.6-0.5l-2.6 1.6l-1 0.1l-0.5 0.5l1.4 0.8l0 0.5l0.8 0.2l1.1-0.7l1.6 0.4l0.1 0.6l-1.4 0.2l-1.9 1.8l1 0.5l1.7 2.7l0 0.8l-0.6 0.2l0.8 0.9l-0.4 1.6l-0.6 0.1l-2.4 3.6l-2.8 1.7l-1.7 0.6l-0.4-0.3l-3 1.1l-0.4 1.1l-0.5 0l0-1.1l-1.4-0.3l-2.6 1.9l-0.2 0.7l3.2 3.8l0.4 1.9l-0.1 1.7l-4 3.1l-0.4-0.6l0.3-0.7l-1.6-0.7l-0.9-1.6l-1.8-0.4l0.2-0.8l-0.9 0l-0.9 4.2l0.7 0l0.6 1.8l2.5 1.9l1.2 4.2l-0.7 0.1l-2.1-1.6l-1.3-3.7l-1.6-1.9l-0.2 0.6l0.5-3.6l-1.6-5.5l-1.8 1.2l-1.2-0.3l0.1-2.2l-0.6-1.5l-1.3-1l-1-2.1l-0.9 0l-0.2 1l-1.3-0.3l-0.1 0.4l-1.9 0.2l0 0.8l-0.5 0.5l-1.4 0.7l-2.9 2.5l0 0.4l-1.9 0.7l-0.4 5.5l-0.6 0.1l-0.4 0.8l0.3 0.3l-0.9 0.3l-0.8 0.9l-0.9-0.9l-3.1-7.1l-0.9-5.4l-2.1 0.5l-1.3-1.2l0.4-0.4l-0.3-0.3l-1.9-1.1l-1-1.5l-4.9 0.3l-4.1-0.6l-0.4-1.3l-0.5-0.1l-1.8 0.6l-3.2-1.4l-1.4-2.2l-2.1 0.1l0.8 2.3l1.4 1l0.6 1.9l0.2-1.2l0.6 0.2l-0.2 1.2l0.4 0.6l2.2-0.1l2.4-2.3l0.4 2.2l1.9 0.6l1.1 1.3l-1.3 1.9l-0.7 0.2l-0.1 1.3l-2.4 1.3l0 0.4l-2.9 0.8l-0.2 0.8l-3.5 1.6l-3.1 0.7l-0.6 0.6l-1.5 0.1l-0.9-2.6l0-1.6l-1.7-2.7l-1.8-1.8l-0.6-2.4l-1-0.6l-2.4-3.8l-0.5 0l0.4-1.3l-0.1-0.1l-0.1-0.3l-0.9 2.2l-1.5-2.3l1.7 3.8l1.6 2.2l-0.2 0.8l1.4 1.1l0.6 3.4l0.9 0.6l0.9 2.1l4 3.5l-0.6 0.7l1.9 1.3l6.5-1.6l-0.1 1.4l-1.5 3.8l-1.8 2.6l-7.4 6.8l-1.1 2.1l-0.5 1.2l0.7 0.9l-0.2 1.7l1.3 2.3l0.3 3.9l-0.7 1.4l-2.7 1.5l-2.6 2.2l-0.1 0.7l0.9 1.6l-0.1 2l-2.9 1.6l0.3 0.5l-0.4 2.1l-2.4 2.8l-1.9 1.7l-2.4 1.1l-3.2 0l-3 0.9l-1.2-0.7l-0.5-1.5l0.3-0.9l-3-4.6l-0.9-5l-2.5-4l-0.2-1.4l0.9-3.2l1.1-1.5l0.1-1.3l-0.8-1.5l0.3-0.6l-1.3-3.6l-3.1-3.9l1-4.2l-1.3-1.7l-2.6 0.5l-1.6-2l-1.6 0l-4.7 1.6l-2.6-0.5l-3.4 0.8l-4.9-3.4zM101.8 65.5l1.3 0.1l0.7 0.5l-1 0.2l-1-0.8zM111.2 65l0.5 0.4l-0.4 0.4l-2-0.2l-0.7 0.8l-1-0.6l-2.1-0.1l0.1-0.4l2.1 0l-0.5-0.8l-0.6-0.1l0.2-0.3l2.4 0l2 0.9zM102.1 58.8l0.4 0.9l-0.3 0.6l-0.6-0.9l0.5-0.6zM116 37l0.3 0.4l1.7 0.2l-0.9 0.4l-1.2-0.4l-0.3-0.3l0.4-0.3zM126.5 34.8l-0.3 0.7l0.7-0.2l0.5 1.2l-0.5 0.8l-1.1-0.1l0-1l-1.2 0.9l-0.6 0l0.7-0.5l-1-0.2l-3.1-0.3l2-2.8l1.5-0.9l0.5 0l-1.4 1.8l0.7-0.4l0.6 0.3l-0.3 0.3l2.3 0.4zM173.3 28.8l1 0.6l-1.1 2.3l-1.8 0.6l-1.4-0.1l0.8-1.1l-0.5-1l3-1.3zM175 28.2l-0.6 0.5l-0.5-1.5l0.3-1l0.8-0.8l2 0l-1.1 1l2.1-0.1l-1.1 1.7l1 0.1l1 1.3l0.7 0.1l0.9 1.6l1.2 0.2l-0.6 0.9l0.3 0.5l-0.8 0.5l-6.4 0.6l2.4-1.2l-1.9-0.6l1.1-0.3l-0.6-0.5l0.2-0.7l1.5 0.1l0.2-0.6l-0.7-0.6l-1.2-0.2l-0.2-1zM158.2 19.6l-2.2-0.5l1.8-0.5l-2.1-0.2l0.6-0.7l1.6-0.1l1.5 0.7l1.5-0.6l1.3 0.3l1.6-0.5l1.7 0l-0.2 0.7l1.1 0.7l-1.3 0.7l-3.8 0.9l-4.1-0.5l1-0.4zM104.8 16.6l-1.8 0.3l-0.2-0.5l0.4-0.5l0.9-0.2l0.8 0.3l-0.1 0.6zM112.1 13.9l0.9 0.9l-1.8 0.5l3.9 0.9l1.5 0.9l1.5 0l-0.3 0.7l-1.7 1.2l-2.8-1.4l-1.3 0.1l-0.1 0.6l2.8 1.3l0.6 1l-0.3 0.7l-3.8-1l2.6 1.8l-4.8-1l-1.2-0.5l0.3-0.3l-2.9-1l-2.9 0.5l-0.9-0.4l0.7-0.7l3.9-0.2l-0.3-0.3l0.4-0.5l1.2-1l-0.6-0.8l-3.6-0.8l0.7-0.2l-2.8-1.1l-2.3 0.5l-7.4-0.7l-0.8-0.4l1-0.4l-1.4 0l-0.3-1l1.8-1.3l2.6-0.3l-0.8 0.6l0.8 0.7l0.9-0.8l2.6-0.5l1.7 1.1l-0.1 0.6l2.9-0.6l3.6 0.9l0.1 0.5l1.9-0.3l4.3 1.5zM153.5 1.7l-5.4 0.1l7.1 0.4l1.9-0.3l0.8 0.4l-1.1 0.5l7.4-0.7l3 0.2l0.6 0.4l-7.8 1.1l2.3 0.1l-2 1.3l0 1.2l1.2 0.6l-3.2 0.4l1.9 0.5l0.2 0.9l-1.1 0l1.3 0.9l-2.2 0.1l1.2 0.4l-0.4 0.3l-2.8 0.2l1.3 0.7l0 0.4l-2.5-0.1l2.7 0.8l0.3 0.8l-1.7 0.2l-2-0.9l0.3 0.6l-1.2 0.6l4.1 0.1l-5.4 1.6l-4.1 0.4l-2.4 1.4l-5.6 1.2l-0.9 0.7l-0.5 1.3l-1.6 0.8l0.4 0.8l-1 1.8l-1.4 0.1l-1.5-0.9l-2 0l-3.3-2.7l-0.7-1.6l-1.4-0.9l0.4-0.7l-0.7-0.4l1-1.2l1.5-0.3l0.6-1.2l-2.6 0.6l-1.2-0.3l0.3-1.2l3 0.2l-2.6-0.9l-1.8-0.2l1.1-0.9l-2.6-2.1l-1.3-0.4l0-0.4l-2.7-0.6l-7.2 0l-2.9-0.9l4.6-0.4l-6.5-0.6l0.1-0.4l7.5-1l0.4-0.4l-2.7-0.3l5.8-1.2l-0.5-0.5l2.4-0.2l7.3 0.1l2.6-0.5l5.9 0.7l-2.4-0.5l0.1-0.4l3.4-0.6l8.3-0.4l8 0.1l6.3 0.8l-5.7 0.4zM98.9 1l8.3-0.2l11 0.6l-5.9 1.1l2.2 0l-5.7 1.7l-5.7 0.5l1.4 0.1l-0.7 0.2l0.8 0.5l-4.4 1.3l1.9 0.4l-2.7 0.6l-8.9-0.3l-0.1-0.5l1.8-0.2l-0.5-0.7l3.3 0.4l-3-0.9l2.9-0.9l-1.8-1l5.1-0.2l-5.8 0l-4-1.4l6.1-0.8l2.3 0.4l2.1-0.7zM192.6 45.9l1.1 0.1l1.8-0.2l-0.4 1.6l-2.7-1l0.2-0.5zM188.2 43l1-0.2l0.6 0.7l-0.1 1.3l-1.3 0l-0.2-1.8zM189.6 41.8l-0.4 0.8l-0.7-0.9l0.9-0.7l0.2 0.8zM191 28.6l-0.1-0.4l1.5-0.3l0.3 0.5l-0.6 0.8l-1.1-0.6zM197.1 7.2l-3.3-0.6l0.9-0.3l-3.5-1.2l-0.8-0.8l6.6-0.4l4.5 1.1l-2.5 0.4l-1.9 1.8zM212.9 48.6l0.8 0l0.9-0.3l-0.6 0.7l-1.5 0.3l-0.2-0.4l0.6-0.3zM205.8 48.6l0.5 0.1l-0.1 0.3l-2.7-0.3l0.2-0.4l2.1 0.3zM202.5 6.6l-1.8-0.3l0.7-0.2l-0.6-0.4l2.1-0.2l1.8 0.6l-2.2 0.5zM201.9 3.6l1-0.3l4.5 0.6l-1.5 0.6l-2.9 0.1l-2.9-0.2l-2.7-0.7l4.5-0.1zM248.9 132.6l1.6 0.5l0.1 0.2l-0.3 0.4l-1.6 0.1l0.2-1.2zM229.7 99.7l0.1 1.2l-2.7 8l-1.7 0.7l-1.4-0.6l-0.7-2.9l1.1-2l-0.4-2.7l0.4-1.2l1.9-0.4l1.4-1.2l0.2-0.9l0.4 0.1l0.9-1.8l1.3 3.2l-0.3 0.8l-0.3-0.6l-0.2 0.3zM298.3 92.4l0.6-0.1l0.2 0.4l-2.4 0.3l1.2-0.9l0.4 0.3zM294.6 92.8l-6.3-1l-2.9-0.9l0.7-1l1.2 0.1l1.3 0.8l1.9 0.1l0.3-0.4l4.9 1.9l-1.1 0.4zM283.9 89l-2.5-2.2l-2.8-4.6l-3.3-3.7l2.2 0.3l3.1 3.1l1.1 0l2.1 2l-0.4 0.8l1 0.4l0.5 1.2l1.2 0.8l-0.3 2.8l-1.1 0l-0.8-0.9zM296.6 85.5l-0.5 2.5l-0.1-0.3l-1.1 0.4l-0.4-0.6l-1.2-0.4l-1.2 0.4l-0.4-0.5l-1.5-0.1l-0.1-1.3l-1-1.1l-0.1-0.9l0.7-1.6l1.5 0.1l0.2-0.8l1.6-0.4l4.1-3.8l0.6 0.9l1.5 0.6l-1.9 2.2l0.7 0.9l-0.1 0.5l1.1 0.9l-1.2 0.1l-0.3 1.6l-0.9 0.7zM261.8 76.5l-0.2 1l-1.3 0.5l-0.6-2.2l0.4-1.6l1.7 2.3zM298.5 74.7l-1.3 0.9l2.3-3l0.2 0.8l-1.2 1.3zM289.5 65.8l-0.8-0.3l-0.1-0.9l2.2-0.7l0.2 0.4l-0.7 1l-0.8 0.5zM248.9 7.5l-10.4 2.2l-3.1 1.9l0.2 0.9l1.9 0.8l-3.8-0.1l-0.3-0.4l-1.8-0.3l-0.1-0.5l1-0.2l-0.1-0.6l2-0.8l-0.9-0.1l2.4-0.9l-0.3-0.5l5.6-1.2l7-0.6l0.7 0.4zM285.1 5.7l-5.7 0.4l2.7-1.4l3.3 0.6l-0.3 0.4zM272.5 3.9l-1.3-0.2l4.7-1l4.3 1.5l-0.3 0.9l-2.1 0.1l-4.5-0.6l-0.8-0.7zM228.9 3.7l-1.3 0.3l-1.1-0.2l0.6-0.4l-2.3 0l6.7-0.1l-2.6 0.4zM354 124.9l0.2 0.9l-1.5 1.6l0.4 0.5l-1.6 0.3l-0.9 1.7l-1.3 0.7l-2.6-0.4l0.3-1.1l3.5-2.1l1.6-2l0.7-0.5l0.4 0.8l0.8-0.4zM326 127.5l-1.3-2.8l1.7 0.4l1.9-0.2l-0.4 2.3l-0.3-0.3l-0.7 0.7l-0.9-0.1zM353.8 123.5l0.8-0.7l0.1-1.4l-2.1-2.9l0.4 0l1.3 0.8l1 1.9l0.1-0.7l0.6 1.1l0.8 0.3l1.7-0.2l-0.5 1.5l-0.8-0.1l-1.2 2.2l-0.8 0.4l-0.5-0.4l0.5-0.8l-0.3-0.6l-1.1-0.4zM300.6 117.9l-2.6 1.2l-1.4-0.1l-1.6-0.8l0-0.6l0.7-0.3l0.1-1.1l-0.8-2.7l-1.7-3.4l0.5 0.4l-0.4-0.9l0.8 0.7l-0.8-1.9l0.3-1.9l0.4-0.7l0.1 0.7l0.4-0.7l2.1-1.1l4.2-1l1.3-1.5l0.1-0.9l0.7-0.9l0.4 0.9l0.5-0.2l-0.4-0.5l0.3-0.5l0.5 0.2l0.1-0.7l1.3-1.4l1.4-0.4l1.3 1.1l1.2 0.1l-0.2-0.6l1.2-1.9l2-0.4l0-0.5l-0.8-0.3l0.6-0.2l2.9 1.1l1.2-0.3l0.5 0.5l-1 0.9l-0.5 1.7l4.7 2.7l0.7-0.3l0.4-1l0.4-4l0.8-1.7l1.4 3.8l0.7-0.3l0.8 0.8l1 4l2.4 1.4l0.9 1.9l1 0.1l0.2 1.1l2 1.8l0.7 2.8l-0.7 3.5l-2.6 4.1l-0.3 1.7l-1.7 0.4l-2 1.2l-1.4-0.6l0.1-0.5l-1.4 0.9l-3-0.8l-1-1.9l-1.5-0.5l0.1-1.2l-0.5 0.7l-0.9 0.2l1.1-1.7l-0.1-0.7l-1.8 2l-0.8-0.4l-0.9-1.9l-3-1.1l-5.2 0.7l-1.9 0.8l-0.5 0.9l-3.1 0zM344 104.1l1 0.4l2.1 1.7l-0.4 0.2l-1.2-0.7l-1.5-1.6zM358.1 101.5l0.6 0.1l-0.1 0.6l-1.2 0l0.3-0.8l0.4 0.1zM360 100.6l-1.3 0.4l-0.1-0.4l1.4-0.5l0 0.5zM305.1 92.7l2.2-0.3l-3.7 2l0.4-1.1l1.1-0.6zM301.3 92.5l0.7 0l0.9-0.4l-0.1 0.5l-2.9 0.2l0.8-0.6l0.6 0.3zM327 90.7l1.7 2.4l0.6 0l0 0.4l0.7 0.2l-0.3 0.2l1 0.7l-2.8-0.5l-1.9-2l-1.3-0.5l-1.4 0.6l0.1 0.8l-0.8 0.3l-1.6-0.2l-0.9-0.8l-1-0.2l-1.5 0.3l1.1-1.1l-0.8-1.9l-4.2-1.9l-0.7 0.6l-0.2-0.8l-0.8-0.5l1.7-0.6l-1.5 0l-1.7-1.3l1.9-0.5l1.6 0.4l0.4 2l1.1 0.6l1.9-1.7l3.6 0.9l3.6 1.3l1.4 1.6l1.6 0.6l0.3 0.5l-0.9 0.1zM334.5 89.1l1.5 1.4l-0.1 0.3l-0.7-0.3l-0.7-1.4zM329.8 89.5l0.3-0.5l0.1 0.5l0.6 0l0.8-0.7l-0.1-0.6l0.8 0.1l-0.3 1.2l-1.8 0.8l-1.9-0.6l1.5-0.2zM330.7 86.7l0.2-0.2l1.3 0.7l0.9 1.3l-0.3 0.3l-0.4-1l-1.7-1.1zM309.4 86.8l1.1 0.3l0.3 0.8l-2.9-0.5l0.2-0.6l1.3 0zM300 84.5l0.9 0.9l2.4-0.8l0 0.5l-0.5-0.2l-1.3 1l1.7 3.4l-0.6 0.3l-0.4-0.3l0.5-0.8l-1.2 0.1l0.1-0.4l-0.7-0.6l0.1-1l-0.7 0.3l0.1 2.6l-0.6 0.2l-0.4-0.3l0.1-1.9l-0.7-0.7l1.2-3.4l0.9-0.7l2 0.4l2.3-0.5l-0.8 1l-0.7 0.2l-3.5 0l-0.2 0.7zM307.7 84.3l-0.3-1.3l0.5-1.2l0.1 0.6l0.6 0.1l0 1.2l-0.5-0.1l-0.1 0.7l0.4 0.5l-0.7-0.5zM304.2 77.8l0-1.2l-0.6-0.4l-1.5 0.9l-0.2-0.3l0.4-0.8l1.2-0.7l0.3 0.5l1.7-0.8l-0.1-0.8l0.8 0.5l0.3 2.1l-0.3 0.9l-0.4-1l-0.4 0.5l0 1.2l-1.2-0.6zM303.3 74.7l-0.3 0.3l-0.6-0.7l0.5-1.2l0.6 0l-0.2 0.6l0.8-0.9l-0.8 1.9zM302 72.6l-0.1-0.5l1.2 0.3l-1.1 1.2l0-1zM304.3 72.5l0.6 0.1l-0.6-1.2l0.9 0.1l0.6 1.5l-0.8-0.3l0.3 0.9l-0.5 0.3l-0.5-1.4zM301.5 70.9l-0.2 0.9l-1-1.3l0.9 0.1l0.3 0.3zM302.7 69.7l1.3 0.5l0.1 1.3l-1.2-1.1l-0.2 0.4l-0.7-0.6l-1.4-0.1l0.4-0.6l-0.3-0.3l-0.1 0.4l-0.5-0.6l-0.2-1.4l0.4 0.4l0.4-2.5l1.5 0l0.3 1.4l-1 2l0.2 0.8l1 0zM301.8 59.6l-0.6 1.6l-0.5 0.8l-0.6-1.6l1.4-1.7l0.5 0.3l-0.2 0.6zM313 51.3l-0.6-0.3l0.5-1.1l1.7 0l-0.4 0.9l-0.4-0.3l-0.8 0.8zM315.1 50.2l0-0.8l-4.1 0.7l1 0.8l-0.7 1.6l-0.6 0.5l-0.5-0.4l0.2-0.9l-1-1l3.2-2.1l3.1-0.1l1-1.8l0.7 0.5l2-1.4l0.7-1.2l-0.2-1.2l0.4-0.6l1.1-0.2l0.5 2.2l-0.9 1l-0.2 2.4l-0.5 0.7l-3.1 0.5l-1.4 1.1l-0.7-0.3zM319.8 41.4l0.5-0.7l1.1-0.1l0.6-2.2l1.9 1.4l0.7 0.2l0.7-0.4l0.2 1.1l-1.4 0.3l-0.9 1l-1.6-0.7l-0.5 1.1l-1.1 0l-0.2-1zM323.5 37.9l-0.8-0.6l-0.6 0.7l-0.2-0.8l0.3-4.2l-0.6-0.9l0.1-1.4l0.9-0.5l-0.4-0.4l0.5-0.2l0.5 2.6l1.5 2.8l-1.5-0.3l-0.6 1.4l0.9 1.1l0 0.7zM320.8 10.2l1.3-0.1l1.5 0.7l-3.7-0.2l0.9-0.4zM328 9.2l-1.9-0.4l0.3-0.3l4.3 0.4l-2.7 0.3zM321.5 7.9l3.6 0.5l-0.8 0.8l-5.3 0.2l-2-0.7l0.5-0.6l4-0.2z";
  var MAP_TOP = 84, MAP_H = 142;
  // 太阳直射点（精度够画昼夜线）：赤纬、经度
  function sunPoint(d) {
    var rad = Math.PI / 180, n = d.getTime() / 864e5 - 10957.5;
    var L = (280.46 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * rad;
    var lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad, eps = (23.439 - 0.0000004 * n) * rad;
    var dec = Math.asin(Math.sin(eps) * Math.sin(lam)) / rad;
    var ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / rad;
    var gmst = (280.46061837 + 360.98564736629 * n) % 360;
    var lon = ((ra - gmst) % 360 + 540) % 360 - 180;
    return { lat: dec, lon: lon };
  }
  function nightPath(d) {
    var s = sunPoint(d), rad = Math.PI / 180, dec = Math.abs(s.lat) < 0.1 ? 0.1 : s.lat, pts = [];
    for (var x = 0; x <= 360; x += 3) {
      var lon = x - 180, lat = Math.atan(-Math.cos((lon - s.lon) * rad) / Math.tan(dec * rad)) / rad;
      pts.push(x + " " + Math.max(-2, Math.min(MAP_H + 2, MAP_TOP - lat)).toFixed(1));
    }
    return "M" + pts.join("L") + (dec > 0 ? "L360 " + (MAP_H + 2) + "L0 " + (MAP_H + 2) : "L360 -2L0 -2") + "Z";
  }

  // ======== 公共：当前在哪一页 ========
  var TABS = [["world", "世界时钟"], ["alarm", "闹钟"], ["sw", "秒表"], ["timer", "计时器"]];
  var tab = localStorage.getItem("tsu-clock-tab");
  if (!TABS.some(function (t) { return t[0] === tab; })) tab = "world";
  function setTab(t) {
    if (!TABS.some(function (x) { return x[0] === t; })) return;
    tab = t;
    try { localStorage.setItem("tsu-clock-tab", t); } catch (e) {}
    render();
    if (M && D.front && D.front() === M.win && D.refreshMenus) D.refreshMenus();
  }

  // =====================================================================================================
  // 桌面（macOS 的「时钟」）
  // =====================================================================================================
  var M = null;
  function open(t) {
    if (!M) build();
    if (t) setTab(t);
    if (M.win.state === "min" || M.win.state === "closed") M.win.show(); else M.win.front();
    render();
    return M.win;
  }
  function build() {
    // 窗口的 id 不能叫 clock：菜单栏右边的时间已经是 #clock 了（同一个 id 两个元素，样式、查找都会串）；App 还是 clock
    M = K.window({ id: "clock-win", app: APP, name: NAME, className: "clk-win", width: 920, height: 640, menus: menus, appMenu: appMenu, title: function () { return NAME; } });
    M.win.el.classList.add("ma-noside");
    M.tb.innerHTML = '<div class="ma-seg clk-seg" role="tablist">' + TABS.map(function (t) { return '<button data-tab="' + t[0] + '" tabindex="-1">' + t[1] + "</button>"; }).join("") + "</div>" +
      '<span class="ma-flex"></span>' + K.group(K.btn("plus", "添加", ICON.plus));
    M.main.innerHTML =
      '<div class="clk-pane clk-world" data-pane="world"><div class="clk-mapwrap"><div class="clk-map"><svg viewBox="0 0 360 ' + MAP_H + '" preserveAspectRatio="none" aria-hidden="true"><path class="clk-land" d="' + LAND + '"/><path class="clk-night" d=""/></svg><div class="clk-pins"></div></div></div>' +
        '<div class="clk-tiles ma-scroll"></div></div>' +
      '<div class="clk-pane clk-alarms ma-scroll" data-pane="alarm"><div class="clk-cards"></div><div class="ma-empty" hidden>没有闹钟</div></div>' +
      '<div class="clk-pane clk-sw" data-pane="sw"><div class="clk-swtop"><div class="clk-swdig"></div><div class="clk-rbtns"><button class="clk-rb" data-sw="left"></button><button class="clk-rb" data-sw="right"></button></div></div><div class="clk-laps ma-scroll"></div></div>' +
      '<div class="clk-pane clk-timers" data-pane="timer"><div class="clk-tnew"></div><div class="clk-tcards ma-scroll"></div><div class="clk-trec"></div></div>';
    // 手机版（html.ios 才显示）：同一个窗口里另一套界面
    M.io = buildIOS();
    M.win.el.querySelector(".body").appendChild(M.io.el);
    bindDesk();
    K.onTheme(render);
    new ResizeObserver(function () { layoutMap(); }).observe(M.main);
  }
  function menus() {
    var it = K.item, SEP = K.SEP;
    return [
      { title: "文件", items: [it("添加城市…", "", function () { open("world"); addCityUI(); }), it("新建闹钟…", "", function () { open("alarm"); editAlarmUI(null); }), it("新建计时器…", "", function () { open("timer"); newTimerUI(); })] },
      { title: "显示", items: TABS.map(function (t, i) { return it(t[1], "⌥⌘" + (i + 1), function () { setTab(t[0]); }, { checked: tab === t[0] }); }).concat([SEP,
        it(sw.run ? "停止秒表" : "启动秒表", "", function () { if (sw.run) swStop(); else swStart(); }), it("计次", "", swLap, { disabled: !sw.run }), it("复位秒表", "", swReset, { disabled: sw.run || !swElapsed() })]) },
    ];
  }
  function appMenu() { return [K.item("关于时钟", "", function () { D.alert({ title: NAME, message: "世界时钟、闹钟、秒表、计时器。数据在 ~/Library/Clock（agent 也能读写）；闹钟、计时器在这个页面开着时才会响。", icon: ICON_HTML, buttons: [{ label: "好", role: "default" }] }); })]; }
  // ⌥⌘1–4 换页（⌘1–4 浏览器自己用）；秒表页：空格 启动 / 停止
  window.addEventListener("keydown", function (e) {
    if (!M || D.front() !== M.win || M.win.state === "min" || M.win.state === "closed" || isIOS()) return;
    if (e.target.closest && e.target.closest("input, textarea, [contenteditable]")) return;
    if (e.metaKey && e.altKey && /^Digit[1-4]$/.test(e.code)) { e.preventDefault(); setTab(TABS[+e.code.slice(5) - 1][0]); return; }
    if (tab === "sw" && e.key === " " && !e.metaKey) { e.preventDefault(); if (sw.run) swStop(); else swStart(); }
    if ((e.key === "Backspace" || e.key === "Delete") && selTile != null && tab === "world") { e.preventDefault(); removeCity(selTile); selTile = null; }
    if ((e.key === "Backspace" || e.key === "Delete") && selCard && tab === "alarm") { e.preventDefault(); deleteAlarm(selCard); selCard = null; }
  }, true);
  var selTile = null, selCard = null;
  function bindDesk() {
    M.tb.addEventListener("click", function (e) {
      var b = e.target.closest("[data-tab]");
      if (b) return setTab(b.dataset.tab);
      if (e.target.closest('[data-b="plus"]')) { var btn = e.target.closest('[data-b="plus"]'); if (tab === "world") addCityUI(btn); else if (tab === "alarm") editAlarmUI(null, btn); else if (tab === "timer") newTimerUI(btn); }
    });
    var main = M.main;
    main.addEventListener("click", function (e) {
      var t = e.target;
      var tile = t.closest(".clk-tile");
      if (tab === "world") { selTile = tile ? +tile.dataset.i : null; paintSel(); }
      var sws = t.closest(".ma-switch[data-alarm]");
      if (sws) { e.stopPropagation(); toggleAlarm(sws.dataset.alarm, !sws.classList.contains("on")); return; }
      var card = t.closest(".clk-card");
      if (card && tab === "alarm") { selCard = card.dataset.id; paintSel(); editAlarmUI(alarms.find(function (a) { return a.id === card.dataset.id; }), card); return; }
      if (tab === "alarm") { selCard = null; paintSel(); }
      var sb = t.closest("[data-sw]");
      if (sb) { var run = sw.run; if (sb.dataset.sw === "right") { if (run) swStop(); else swStart(); } else if (run) swLap(); else swReset(); return; }
      var tb = t.closest("[data-t]");
      if (tb) { var id = tb.closest("[data-id]").dataset.id, act = tb.dataset.t; if (act === "pause") pauseTimer(id); else if (act === "resume") resumeTimer(id); else if (act === "cancel") cancelTimer(id); return; }
      var rec = t.closest("[data-rec]");
      if (rec) { var r = recents[+rec.dataset.rec]; if (r) startTimer(r.duration, r.label); return; }
    });
    main.addEventListener("contextmenu", function (e) {
      var tile = e.target.closest(".clk-tile"), card = e.target.closest(".clk-card"), tc = e.target.closest(".clk-tcard");
      if (!tile && !card && !tc) return;
      e.preventDefault();
      var at = { x: e.clientX, y: e.clientY };
      if (tile) { var i = +tile.dataset.i; selTile = i; paintSel(); D.popup([K.item("删除", "", function () { removeCity(i); }), K.SEP, K.item("左移", "", function () { moveCity(i, i - 1); }, { disabled: i === 0 }), K.item("右移", "", function () { moveCity(i, i + 1); }, { disabled: i === cities.length - 1 })], at); }
      if (card) { var id = card.dataset.id, a = alarms.find(function (x) { return x.id === id; }); selCard = id; paintSel(); D.popup([K.item("编辑…", "", function () { editAlarmUI(a, card); }), K.item(a && a.on ? "关闭" : "打开", "", function () { toggleAlarm(id, !(a && a.on)); }), K.SEP, K.item("删除", "", function () { deleteAlarm(id); })], at); }
      if (tc) { var tid = tc.dataset.id; D.popup([K.item("删除", "", function () { cancelTimer(tid); })], at); }
    });
  }
  function paintSel() {
    if (!M) return;
    M.main.querySelectorAll(".clk-tile").forEach(function (el) { el.classList.toggle("sel", +el.dataset.i === selTile); });
    M.main.querySelectorAll(".clk-card").forEach(function (el) { el.classList.toggle("sel", el.dataset.id === selCard); });
  }
  // 地图：宽高比固定，铺满宽度，最多占半个窗口高（放不下就按高度缩、居中）
  function layoutMap() {
    if (!M) return;
    var wrap = M.main.querySelector(".clk-mapwrap"), map = M.main.querySelector(".clk-map");
    if (!wrap || !wrap.clientWidth) return;
    var W = wrap.clientWidth - 40, H = Math.max(120, (M.main.clientHeight - 60) * 0.5), w = Math.min(W, H * 360 / MAP_H);
    map.style.width = Math.round(w) + "px";
    map.style.height = Math.round(w * MAP_H / 360) + "px";
  }

  // ---- 画 ----
  var renderQueued = false;
  function render() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(function () { renderQueued = false; renderNow(); }); }
  function renderNow() {
    if (!M) return;
    if (isIOS()) return renderIOS();
    M.tb.querySelectorAll("[data-tab]").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === tab); });
    var plus = M.tb.querySelector('[data-b="plus"]');
    if (plus) plus.parentNode.style.visibility = tab === "sw" ? "hidden" : "";
    M.main.querySelectorAll(".clk-pane").forEach(function (p) { p.hidden = p.dataset.pane !== tab; });
    if (tab === "world") renderWorld();
    else if (tab === "alarm") renderAlarms();
    else if (tab === "sw") renderSW(true);
    else renderTimers(true);
  }
  function renderWorld() {
    var pane = M.main.querySelector(".clk-world"), now = new Date();
    layoutMap();
    pane.querySelector(".clk-night").setAttribute("d", nightPath(now));
    pane.querySelector(".clk-pins").innerHTML = cities.map(function (c) {
      var k = cityByName(c.name) || cityByTz(c.tz);
      if (!k) return "";
      var p = partsIn(c.tz, now), x = (k[4] + 180) / 360 * 100, y = (MAP_TOP - k[3]) / MAP_H * 100;
      return '<div class="clk-pin" style="left:' + x.toFixed(2) + "%;top:" + y.toFixed(2) + '%"><i></i><span><b>' + esc(c.name) + "</b> " + hm(p.h, p.mi) + "</span></div>";
    }).join("");
    unclutterPins(pane.querySelector(".clk-pins"));
    var tiles = pane.querySelector(".clk-tiles");
    tiles.innerHTML = cities.length ? cities.map(function (c, i) {
      return '<div class="clk-tile' + (selTile === i ? " sel" : "") + '" data-i="' + i + '">' + faceSVG() + '<b>' + esc(c.name) + "</b><small>" + esc(relText(c.tz, now)) + "</small></div>";
    }).join("") : '<div class="clk-none">点按 ＋ 添加城市</div>';
    tickFaces();
  }
  // 城市靠得近（伦敦、巴黎）时标签别叠在一起：叠了就换到点的左边，还叠就往下挪
  function unclutterPins(box) {
    var placed = [], hit = function (r) { return placed.some(function (q) { return r.left < q.right + 2 && r.right > q.left - 2 && r.top < q.bottom && r.bottom > q.top; }); };
    Array.prototype.forEach.call(box.children, function (pin) {
      var lab = pin.querySelector("span");
      if (!lab) return;
      lab.style.left = ""; lab.style.right = ""; lab.style.top = "";
      var r = lab.getBoundingClientRect();
      if (hit(r)) { lab.style.left = "auto"; lab.style.right = "7px"; r = lab.getBoundingClientRect(); }
      for (var k = 0; k < 4 && hit(r); k++) { lab.style.top = (-9 + (k + 1) * 19) + "px"; r = lab.getBoundingClientRect(); }
      placed.push(r);
    });
  }
  function tickFaces() {
    if (!M) return;
    var now = new Date();
    M.main.querySelectorAll(".clk-tile").forEach(function (el) { var c = cities[+el.dataset.i]; if (c) setHands(el.querySelector("svg"), partsIn(c.tz, now)); });
  }
  function renderAlarms() {
    var box = M.main.querySelector(".clk-cards");
    box.innerHTML = alarms.map(function (a) {
      return '<div class="clk-card' + (a.on ? "" : " off") + (selCard === a.id ? " sel" : "") + '" data-id="' + esc(a.id) + '"><div class="clk-ctop"><span class="clk-ctime">' + a.time + "</span>" +
        K.toggle(a.on).replace('class="ma-switch', 'data-alarm="' + esc(a.id) + '" class="ma-switch') + '</div><div class="clk-csub">' + esc(alarmSub(a)) + (a.snoozeUntil && a.on ? " · 稍后提醒 " + esc(a.snoozeUntil.slice(11, 16)) : "") + "</div></div>";
    }).join("");
    M.main.querySelector(".clk-alarms .ma-empty").hidden = !!alarms.length;
  }
  function renderSW(full) {
    var pane = M.main.querySelector(".clk-sw"), el = swElapsed();
    pane.querySelector(".clk-swdig").textContent = swText(el);
    if (!full && !sw.run) return;
    var L = pane.querySelector('[data-sw="left"]'), R = pane.querySelector('[data-sw="right"]');
    L.textContent = sw.run || !el ? "计次" : "复位";
    L.disabled = !sw.run && !el;
    R.textContent = sw.run ? "停止" : "启动";
    R.className = "clk-rb " + (sw.run ? "red" : "green");
    L.className = "clk-rb gray";
    var mk = lapMarks(), rows = [];
    if (el || sw.laps.length) rows.push('<div class="clk-lap cur"><span>计次 ' + (sw.laps.length + 1) + "</span><span>" + swText(swLapNow()) + "</span></div>");
    for (var i = sw.laps.length - 1; i >= 0; i--) rows.push('<div class="clk-lap' + (i === mk.min ? " fast" : i === mk.max ? " slow" : "") + '"><span>计次 ' + (i + 1) + "</span><span>" + swText(sw.laps[i]) + "</span></div>");
    pane.querySelector(".clk-laps").innerHTML = rows.join("");
  }
  // 计时器：没有在跑的 → 正中是滚轮（时 分 秒）、标签、铃声、启动；有 → 一张张卡片（圆环、剩余、暂停 / 继续、×），＋ 再加一个
  var deskPicker = null;
  function renderTimers(full) {
    var pane = M.main.querySelector(".clk-timers"), nw = pane.querySelector(".clk-tnew"), cards = pane.querySelector(".clk-tcards"), rec = pane.querySelector(".clk-trec");
    var has = timers.length > 0;
    pane.classList.toggle("has", has);
    if (full) {
      if (!has) {
        if (!deskPicker || !nw.contains(deskPicker.el)) { deskPicker = timerForm(function (sec, label, sound) { startTimer(sec, label, sound); }); nw.innerHTML = ""; nw.appendChild(deskPicker.el); }
        requestAnimationFrame(function () { if (deskPicker) deskPicker.wheels.forEach(function (w) { w.sync(); }); });
      } else { nw.innerHTML = ""; deskPicker = null; }
      cards.innerHTML = timers.map(function (t) {
        return '<div class="clk-tcard" data-id="' + esc(t.id) + '"><div class="clk-ring">' + ringSVG() + '<div class="clk-rtxt"><b></b><small></small></div></div>' +
          '<div class="clk-tlab">' + esc(t.label || durText(t.duration)) + '</div><div class="clk-tbtns"><button class="clk-mini gray" data-t="cancel" title="取消">✕</button><button class="clk-mini" data-t="pause"></button></div></div>';
      }).join("");
      rec.innerHTML = recents.length ? '<h3>最近项目</h3><div class="clk-chips">' + recents.map(function (r, i) { return '<button class="clk-chip" data-rec="' + i + '"><b>' + esc(hms(r.duration)) + "</b><span>" + esc(r.label || durText(r.duration)) + '</span><i>▶</i></button>'; }).join("") + "</div>" : "";
    }
    cards.querySelectorAll(".clk-tcard").forEach(function (el) {
      var t = timers.find(function (x) { return x.id === el.dataset.id; });
      if (!t) return;
      var left = timerLeft(t);
      el.querySelector(".clk-rtxt b").textContent = hms(Math.ceil(left));
      el.querySelector(".clk-rtxt small").textContent = t.endsAt ? "🔔 " + hm(new Date(t.endsAt).getHours(), new Date(t.endsAt).getMinutes()) : "已暂停";
      setRing(el.querySelector(".clk-ring svg"), left / t.duration);
      var pb = el.querySelector('[data-t="pause"], [data-t="resume"]');
      pb.dataset.t = t.endsAt ? "pause" : "resume";
      pb.className = "clk-mini " + (t.endsAt ? "orange" : "green");
      pb.textContent = t.endsAt ? "暂停" : "继续";
      el.classList.toggle("paused", !t.endsAt);
    });
  }
  function ringSVG() { return '<svg viewBox="0 0 100 100"><circle class="clk-rbg" cx="50" cy="50" r="45"/><circle class="clk-rfg" cx="50" cy="50" r="45" transform="rotate(-90 50 50)"/></svg>'; }
  function setRing(svg, frac) { var c = svg.querySelector(".clk-rfg"), L = 2 * Math.PI * 45; c.setAttribute("stroke-dasharray", L.toFixed(1)); c.setAttribute("stroke-dashoffset", (L * (1 - Math.max(0, Math.min(1, frac)))).toFixed(1)); }

  // ---- 滚轮（时 / 分 / 秒；闹钟的时 / 分）：可以拖、滚，停下来吸到最近的一格 ----
  function Wheel(n, value, suffix, o) {
    o = o || {};
    var el = document.createElement("div"), IH = o.itemH || 34, VIS = o.visible || 5;
    el.className = "clk-wheel" + (o.cls ? " " + o.cls : "");
    el.style.setProperty("--ih", IH + "px");
    el.style.height = IH * VIS + "px";
    var items = "";
    for (var i = 0; i < n; i++) items += "<div>" + (o.pad2 ? pad(i) : i) + "</div>";
    el.innerHTML = '<div class="clk-wl" tabindex="-1" style="padding:' + IH * (VIS - 1) / 2 + 'px 0">' + items + "</div>" + (suffix ? '<span class="clk-wsuf" style="--sufx:' + (o.sufx || 0) + 'px">' + suffix + "</span>" : "");
    var list = el.firstChild, t = 0, val = value || 0;
    var api = { el: el, get: function () { return val; }, set: function (v) { val = Math.max(0, Math.min(n - 1, v | 0)); list.scrollTop = val * IH; paint(); },
      sync: function () { if (Math.abs(list.scrollTop - val * IH) > 1) list.scrollTop = val * IH; paint(); } }; // 藏着的时候设不了滚动位置、深浅也没画对：显示出来再对一次
    function paint() {
      var c = list.scrollTop / IH;
      Array.prototype.forEach.call(list.children, function (it, i) { var d = Math.min(3, Math.abs(i - c)); it.style.opacity = (1 - d * 0.28).toFixed(2); it.style.transform = "scale(" + (1 - d * 0.06).toFixed(3) + ")"; });
    }
    // 只有人拖、滚过才改值：藏着的滚轮显示出来时浏览器会自己对齐一下（scrollTop 还是 0），那不算
    var user = false;
    ["pointerdown", "wheel", "touchstart", "keydown"].forEach(function (ev) { list.addEventListener(ev, function () { user = true; }, { passive: true }); });
    list.addEventListener("scroll", function () {
      paint();
      clearTimeout(t);
      t = setTimeout(function () {
        if (!user) return;
        var v = Math.round(list.scrollTop / IH);
        if (Math.abs(list.scrollTop - v * IH) > 1) { list.scrollTo({ top: v * IH, behavior: "smooth" }); return; } // 吸过去，停稳了再算
        user = false;
        if (v !== val) { val = Math.max(0, Math.min(n - 1, v)); if (o.onChange) o.onChange(val); }
      }, 110);
    }, { passive: true });
    // 桌面：按住拖（鼠标没有惯性滚动）
    list.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      var y0 = e.clientY, s0 = list.scrollTop;
      list.setPointerCapture(e.pointerId);
      var mv = function (ev) { list.scrollTop = s0 - (ev.clientY - y0); };
      var up = function () { list.removeEventListener("pointermove", mv); list.removeEventListener("pointerup", up); };
      list.addEventListener("pointermove", mv);
      list.addEventListener("pointerup", up);
    });
    list.addEventListener("click", function (e) { var it = e.target.closest(".clk-wl > div"); if (!it) return; api.set(Array.prototype.indexOf.call(list.children, it)); if (o.onChange) o.onChange(val); });
    requestAnimationFrame(function () { api.set(val); });
    return api;
  }
  // 新计时器的表单（桌面）：滚轮、标签、计时结束时、启动
  function timerForm(onStart, onCancel) {
    var last = +(localStorage.getItem("tsu-clock-lastdur") || 900) || 900;
    var el = document.createElement("div");
    el.className = "clk-tform";
    el.innerHTML = '<div class="clk-wheels"></div><div class="clk-trow"><label>标签</label><input class="clk-in" placeholder="计时器" maxlength="60"></div>' +
      '<div class="clk-trow"><label>计时结束时</label><button class="clk-drop" data-a="sound"><span>雷达</span></button></div><div class="clk-tact">' + (onCancel ? '<button class="clk-rb gray" data-a="cancel">取消</button>' : "") + '<button class="clk-rb green" data-a="start">启动</button></div>';
    var ws = el.querySelector(".clk-wheels"), h = Wheel(24, Math.floor(last / 3600), "小时", { sufx: 26 }), m = Wheel(60, Math.floor(last / 60) % 60, "分钟", { sufx: 26 }), s = Wheel(60, last % 60, "秒", { sufx: 26 });
    [h, m, s].forEach(function (w) { ws.appendChild(w.el); });
    var sound = "雷达";
    el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-a]");
      if (!b) return;
      if (b.dataset.a === "sound") { var r = b.getBoundingClientRect(); D.popup(soundItems(sound, function (v) { sound = v; b.firstChild.textContent = v; }), { x: r.left, y: r.bottom + 4 }); }
      if (b.dataset.a === "start") { var sec = h.get() * 3600 + m.get() * 60 + s.get(); if (sec > 0) onStart(sec, el.querySelector("input").value.trim(), sound); }
      if (b.dataset.a === "cancel" && onCancel) onCancel();
    });
    el.querySelector("input").addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") el.querySelector('[data-a="start"]').click(); });
    return { el: el, wheels: [h, m, s] };
  }
  function soundItems(cur, set) { return SOUND_NAMES.concat(["无"]).map(function (n) { return K.item(n, "", function () { set(n); if (n !== "无") playOnce(n); }, { checked: n === cur }); }); }
  function newTimerUI(anchor) {
    if (!timers.length) { render(); return; }
    var pop, f = timerForm(function (sec, label, sound) { pop.close(); startTimer(sec, label, sound); }, function () { pop.close(); });
    pop = K.popover(anchor || M.tb.querySelector('[data-b="plus"]') || M.main, f.el, { side: "bottom", className: "clk-pop" });
  }
  // 添加城市：搜索框 + 列表（中文名、英文名、国家都能搜）
  function addCityUI(anchor) {
    var box = document.createElement("div");
    box.className = "clk-cpick";
    box.innerHTML = '<div class="clk-cptitle">选取城市</div><label class="ma-search clk-csearch">' + ICON.search + '<input type="search" placeholder="搜索" spellcheck="false"></label><div class="clk-clist ma-scroll"></div>';
    var inp = box.querySelector("input"), list = box.querySelector(".clk-clist");
    function paintList() { list.innerHTML = searchCities(inp.value).map(function (c) { return '<div class="clk-citem" data-n="' + esc(c[0]) + '">' + esc(c[0]) + "，" + esc(c[1]) + "</div>"; }).join("") || '<div class="clk-cnone">没有结果</div>'; }
    inp.addEventListener("input", paintList);
    inp.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") { var f = list.querySelector(".clk-citem"); if (f) f.click(); } });
    list.addEventListener("click", function (e) { var it = e.target.closest(".clk-citem"); if (!it) return; var c = cityByName(it.dataset.n); if (c) addCity(c); pop.close(); });
    paintList();
    var pop = K.popover(anchor || M.tb.querySelector('[data-b="plus"]') || M.main, box, { side: "bottom", className: "clk-pop" });
    setTimeout(function () { inp.focus(); }, 30);
  }
  function searchCities(q) {
    q = String(q || "").trim().toLowerCase();
    var list = CITIES.filter(function (c) { return !q || c[0].indexOf(q) >= 0 || c[1].indexOf(q) >= 0 || c[5].toLowerCase().indexOf(q) >= 0; });
    return list.slice().sort(function (a, b) { return a[0].localeCompare(b[0], "zh-Hans-CN"); });
  }
  // 闹钟的编辑（桌面）：时间、重复、标签、铃声、稍后提醒；已有的多一个「删除闹钟」
  function editAlarmUI(a, anchor) {
    var cur = a ? JSON.parse(JSON.stringify(a)) : { id: K.uid("a-"), time: defaultAlarmTime(), on: true, repeat: [], label: "", sound: "雷达", snooze: true };
    var box = document.createElement("div");
    box.className = "clk-aedit";
    box.innerHTML = '<div class="clk-aetitle">' + (a ? "编辑闹钟" : "添加闹钟") + '</div><div class="clk-aetime">' + K.timeField(cur.time) + "</div>" +
      '<div class="clk-trow"><label>重复</label><button class="clk-drop" data-a="repeat"><span></span></button></div>' +
      '<div class="clk-trow"><label>标签</label><input class="clk-in" placeholder="闹钟" maxlength="60"></div>' +
      '<div class="clk-trow"><label>铃声</label><button class="clk-drop" data-a="sound"><span></span></button></div>' +
      '<div class="clk-trow"><label>稍后提醒</label>' + K.toggle(cur.snooze, "snooze") + "</div>" +
      '<div class="clk-aebtns">' + (a ? '<button class="ma-pbtn clk-del" data-a="del">删除闹钟</button>' : "") + '<span class="ma-flex"></span><button class="ma-pbtn" data-a="cancel">取消</button><button class="ma-pbtn default" data-a="save">存储</button></div>';
    var timeIn = box.querySelector(".ma-time"), labelIn = box.querySelector(".clk-in");
    labelIn.value = cur.label;
    K.bindTime(timeIn, function (h, m) { cur.time = hm(h, m); });
    function paint() { box.querySelector('[data-a="repeat"] span').textContent = repeatText(cur.repeat, "永不"); box.querySelector('[data-a="sound"] span').textContent = cur.sound; box.querySelector('[data-k="snooze"]').classList.toggle("on", cur.snooze); }
    paint();
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-a], [data-k]");
      if (!b) return;
      var r = b.getBoundingClientRect(), at = { x: r.left, y: r.bottom + 4 };
      if (b.dataset.k === "snooze") { cur.snooze = !cur.snooze; paint(); return; }
      var act = b.dataset.a;
      if (act === "repeat") D.popup([0, 1, 2, 3, 4, 5, 6].map(function (d) { return K.item("每周" + WD[d], "", function () { var i = cur.repeat.indexOf(d); if (i >= 0) cur.repeat.splice(i, 1); else cur.repeat.push(d); cur.repeat.sort(); paint(); }, { checked: cur.repeat.indexOf(d) >= 0 }); }), at);
      if (act === "sound") D.popup(soundItems(cur.sound, function (v) { cur.sound = v; paint(); }), at);
      if (act === "cancel") pop.close();
      if (act === "del") { pop.close(); deleteAlarm(cur.id); }
      if (act === "save") { timeIn.dispatchEvent(new Event("blur")); cur.label = labelIn.value.trim(); pop.close(); saveAlarm(normAlarm(cur)); }
    });
    labelIn.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") box.querySelector('[data-a="save"]').click(); });
    var pop = K.popover(anchor || M.tb.querySelector('[data-b="plus"]') || M.main, box, { side: anchor && anchor.classList && anchor.classList.contains("clk-card") ? "right" : "bottom", className: "clk-pop" });
    setTimeout(function () { timeIn.focus(); timeIn.select(); }, 30);
  }
  function defaultAlarmTime() { var d = new Date(Date.now() + 60000); return hm(d.getHours(), d.getMinutes()); }

  // =====================================================================================================
  // 手机（iOS 的「时钟」）：底下标签栏；世界时钟 / 闹钟是大标题的列表（编辑、＋）；秒表左右两页；计时器是滚轮
  // =====================================================================================================
  var IC = {
    world: '<svg viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="10.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M2.8 13h20.4M13 2.6c-3.4 3.6-3.4 17.2 0 20.8M13 2.6c3.4 3.6 3.4 17.2 0 20.8M4.6 7.4h16.8M4.6 18.6h16.8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    alarm: '<svg viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="14.2" r="8.6" fill="currentColor"/><path d="M13 9.6v4.8l3 1.8" fill="none" stroke="var(--io-cut,#000)" stroke-width="1.9" stroke-linecap="round"/><path d="M3.6 6.6 7 3.6M22.4 6.6 19 3.6M7 22.4l-1.4 1.6M19 22.4l1.4 1.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    sw: '<svg viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="14.4" r="9.4" fill="currentColor"/><path d="M13 14.4V9.2" stroke="var(--io-cut,#000)" stroke-width="2" stroke-linecap="round"/><path d="M10.4 2.6h5.2M13 2.8V5M20.4 6.4l1.6-1.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    timer: '<svg viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13.4" r="9.8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 13.4V5.6A7.8 7.8 0 1 1 7.5 8z" fill="currentColor"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.8v14.4M4.8 12h14.4" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#ff3b30"/><path d="M7 12h10" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>',
    grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 12h16M4 16h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5.5 6.5 6.5-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.6 4.6 7.2 12l7.4 7.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.6 4.6 4.6L19.2 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.4" cy="10.4" r="6.4" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="m15.2 15.2 5 5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.4v13.2c0 .7.8 1.2 1.4.8l10.2-6.6c.5-.4.5-1.2 0-1.6L9.4 4.6C8.8 4.2 8 4.7 8 5.4z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.4" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
    xmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11m0-11-11 11" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/></svg>',
  };
  var gb = function (act, inner, cls, label) { return '<button class="io-gb' + (cls ? " " + cls : "") + '" data-act="' + act + '"' + (label ? ' aria-label="' + esc(label) + '"' : "") + ">" + inner + "</button>"; };
  var ioEdit = { world: false, alarm: false }, ioSwPage = 0;
  function buildIOS() {
    var el = document.createElement("div");
    el.className = "io-app clk-io";
    el.innerHTML =
      '<section class="clk-ipage" data-p="world"><header class="clk-inav">' + gb("edit", "编辑", "io-txt") + '<span class="io-flex"></span>' + gb("add", IC.plus, "", "添加城市") + '</header><div class="clk-iscroll"><h1 class="io-lt">世界时钟</h1><div class="clk-irows"></div></div></section>' +
      '<section class="clk-ipage" data-p="alarm"><header class="clk-inav">' + gb("edit", "编辑", "io-txt") + '<span class="io-flex"></span>' + gb("add", IC.plus, "", "添加闹钟") + '</header><div class="clk-iscroll"><h1 class="io-lt">闹钟</h1><div class="clk-irows"></div></div></section>' +
      '<section class="clk-ipage clk-isw" data-p="sw"><div class="clk-ipager"><div class="clk-ipg"><div class="clk-isdig"></div></div><div class="clk-ipg"><div class="clk-isdial">' + dialSVG() + '<div class="clk-isdd"></div></div></div></div>' +
        '<div class="clk-idots"><i></i><i></i></div><div class="clk-irbtns"><button class="clk-irb" data-sw="left"></button><button class="clk-irb" data-sw="right"></button></div><div class="clk-ilaps"></div></section>' +
      '<section class="clk-ipage clk-itm" data-p="timer"><div class="clk-iscroll"><div class="clk-itop"></div><div class="clk-irbtns clk-itbtns"><button class="clk-irb gray" data-tm="cancel">取消</button><button class="clk-irb green" data-tm="start">启动</button></div>' +
        '<div class="io-grp clk-iopts"><div class="io-row"><span class="io-rl">标签</span><input class="clk-iin" placeholder="计时器" maxlength="60"></div><div class="io-row io-tap" data-tm="sound"><span class="io-rl">计时结束时</span><span class="io-rv">雷达</span><i class="io-rchev">' + IC.chev + '</i></div></div>' +
        '<div class="clk-iruns"></div><div class="clk-irecent"></div></div></section>' +
      '<nav class="io-tabbar clk-itabs">' + TABS.map(function (t) { return '<button data-tab="' + t[0] + '">' + IC[t[0]] + "<span>" + t[1] + "</span></button>"; }).join("") + "</nav>";
    var io = { el: el, tsound: "雷达" };
    // 计时器的滚轮（时 分 秒，同 iOS）
    var last = +(localStorage.getItem("tsu-clock-lastdur") || 900) || 900;
    io.wh = Wheel(24, Math.floor(last / 3600), "小时", { itemH: 34, visible: 7, cls: "clk-iwheel", sufx: 30 });
    io.wm = Wheel(60, Math.floor(last / 60) % 60, "分钟", { itemH: 34, visible: 7, cls: "clk-iwheel", sufx: 30 });
    io.ws = Wheel(60, last % 60, "秒", { itemH: 34, visible: 7, cls: "clk-iwheel", sufx: 30 });
    var top = el.querySelector(".clk-itop");
    top.innerHTML = '<div class="clk-iwheels"><i class="clk-iband"></i></div>';
    [io.wh, io.wm, io.ws].forEach(function (w) { top.firstChild.appendChild(w.el); });
    bindIOS(io);
    return io;
  }
  function bindIOS(io) {
    var el = io.el;
    el.addEventListener("click", function (e) {
      var t = e.target, b;
      if ((b = t.closest(".clk-itabs [data-tab]"))) return setTab(b.dataset.tab);
      var page = t.closest(".clk-ipage"), p = page && page.dataset.p;
      if ((b = t.closest('[data-act="edit"]'))) { ioEdit[p] = !ioEdit[p]; renderIOS(); return; }
      if ((b = t.closest('[data-act="add"]'))) { if (p === "world") iosAddCity(); else iosEditAlarm(null); return; }
      if ((b = t.closest(".clk-iminus"))) { var row0 = b.closest(".clk-irow"); row0.classList.toggle("del"); return; }
      if ((b = t.closest(".clk-idelbtn"))) { var r1 = b.closest(".clk-irow"); if (p === "world") removeCity(+r1.dataset.i); else deleteAlarm(r1.dataset.id); return; }
      if ((b = t.closest(".io-sw[data-alarm]"))) { toggleAlarm(b.dataset.alarm, !b.classList.contains("on")); return; }
      if (p === "alarm" && (b = t.closest(".clk-irow"))) { iosEditAlarm(alarms.find(function (a) { return a.id === b.dataset.id; })); return; }
      if ((b = t.closest("[data-sw]"))) { if (b.dataset.sw === "right") { if (sw.run) swStop(); else swStart(); } else if (sw.run) swLap(); else swReset(); return; }
      if ((b = t.closest("[data-tm]"))) {
        var act = b.dataset.tm;
        if (act === "start") { var sec = io.wh.get() * 3600 + io.wm.get() * 60 + io.ws.get(); startTimer(sec, el.querySelector(".clk-iin").value.trim(), io.tsound); }
        if (act === "sound") iosSoundPick(io.tsound, function (v) { io.tsound = v; renderIOS(); });
        if (act === "cancel" && timers.length) cancelTimer(timers[timers.length - 1].id);
        return;
      }
      if ((b = t.closest("[data-it]"))) { var id = b.closest("[data-id]").dataset.id, a2 = b.dataset.it; if (a2 === "pause") pauseTimer(id); else if (a2 === "resume") resumeTimer(id); else if (a2 === "cancel") cancelTimer(id); return; }
      if ((b = t.closest("[data-rec]"))) { var r = recents[+b.dataset.rec]; if (r) startTimer(r.duration, r.label, io.tsound); return; }
    });
    // 秒表：左右滑换数字 / 表盘两页
    var pager = el.querySelector(".clk-ipager");
    pager.addEventListener("scroll", function () { var i = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth)); if (i !== ioSwPage) { ioSwPage = i; paintDots(); } }, { passive: true });
    function paintDots() { el.querySelectorAll(".clk-idots i").forEach(function (d, i) { d.classList.toggle("on", i === ioSwPage); }); }
    paintDots();
    // 编辑时拖右边的三条线换顺序（世界时钟）
    el.addEventListener("pointerdown", function (e) {
      var g = e.target.closest(".clk-igrip");
      if (!g) return;
      e.preventDefault();
      var row = g.closest(".clk-irow"), list = row.parentNode, rows = Array.prototype.slice.call(list.children), from = rows.indexOf(row), y0 = e.clientY, h = row.offsetHeight, to = from;
      row.classList.add("drag");
      g.setPointerCapture(e.pointerId);
      var mv = function (ev) {
        var dy = ev.clientY - y0;
        row.style.transform = "translateY(" + dy + "px)";
        to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / h)));
        rows.forEach(function (r, i) { if (r === row) return; var sh = from < to && i > from && i <= to ? -h : from > to && i < from && i >= to ? h : 0; r.style.transform = sh ? "translateY(" + sh + "px)" : ""; });
      };
      var up = function () { g.removeEventListener("pointermove", mv); g.removeEventListener("pointerup", up); g.removeEventListener("pointercancel", up); rows.forEach(function (r) { r.style.transform = ""; }); row.classList.remove("drag"); if (to !== from) moveCity(from, to); };
      g.addEventListener("pointermove", mv);
      g.addEventListener("pointerup", up);
      g.addEventListener("pointercancel", up);
    });
  }
  // 秒表的表盘（iOS 的第二页）：60 秒一圈（橙色针），上面小表盘 30 分钟一圈；有计次时多一根蓝针（这一圈）
  function dialSVG() {
    var ticks = "", nums = "";
    for (var i = 0; i < 240; i++) { var a = i * Math.PI / 120, long = i % 20 === 0, mid = i % 4 === 0, r1 = 47, r2 = long ? 42 : mid ? 44 : 45.4; ticks += '<line class="' + (long ? "L" : mid ? "M" : "S") + '" x1="' + (50 + r1 * Math.sin(a)).toFixed(2) + '" y1="' + (50 - r1 * Math.cos(a)).toFixed(2) + '" x2="' + (50 + r2 * Math.sin(a)).toFixed(2) + '" y2="' + (50 - r2 * Math.cos(a)).toFixed(2) + '"/>'; }
    for (var j = 1; j <= 12; j++) { var b = j * Math.PI / 6; nums += '<text x="' + (50 + 36.5 * Math.sin(b)).toFixed(1) + '" y="' + (50 - 36.5 * Math.cos(b) + 2.6).toFixed(1) + '">' + j * 5 + "</text>"; }
    var sub = "", subn = "";
    for (var k = 0; k < 30; k++) { var c = k * Math.PI / 15, big = k % 5 === 0; sub += '<line x1="' + (50 + 10 * Math.sin(c)).toFixed(2) + '" y1="' + (30 - 10 * Math.cos(c)).toFixed(2) + '" x2="' + (50 + (big ? 8.2 : 9) * Math.sin(c)).toFixed(2) + '" y2="' + (30 - (big ? 8.2 : 9) * Math.cos(c)).toFixed(2) + '"/>'; }
    [[30, 0], [5, 1], [10, 2], [15, 3], [20, 4], [25, 5]].forEach(function (n) { var c = n[1] * Math.PI / 3; subn += '<text x="' + (50 + 6.2 * Math.sin(c)).toFixed(1) + '" y="' + (30 - 6.2 * Math.cos(c) + 1.2).toFixed(1) + '">' + n[0] + "</text>"; });
    return '<svg viewBox="0 0 100 100" class="clk-dial" aria-hidden="true"><g class="clk-dt">' + ticks + '</g><g class="clk-dn">' + nums + '</g><g class="clk-dsub">' + sub + '</g><g class="clk-dsn">' + subn + "</g>" +
      '<g class="clk-dmh"><line x1="50" y1="31.5" x2="50" y2="21.5"/></g><circle class="clk-dsc" cx="50" cy="30" r="1"/>' +
      '<g class="clk-dlap"><line x1="50" y1="56" x2="50" y2="4"/></g><g class="clk-dsh"><line x1="50" y1="57" x2="50" y2="4"/><circle cx="50" cy="50" r="1.7"/></g><circle class="clk-dcc" cx="50" cy="50" r=".7"/></svg>';
  }
  function renderIOS() {
    if (!M || !M.io) return;
    var io = M.io, el = io.el, now = new Date();
    el.querySelectorAll(".clk-ipage").forEach(function (p) { p.hidden = p.dataset.p !== tab; });
    el.querySelectorAll(".clk-itabs [data-tab]").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === tab); });
    if (tab === "world") {
      var pg = el.querySelector('[data-p="world"]'), ed = ioEdit.world && cities.length;
      if (!cities.length) ioEdit.world = false;
      pg.classList.toggle("editing", !!ed);
      pg.querySelector('[data-act="edit"]').textContent = ed ? "完成" : "编辑";
      pg.querySelector('[data-act="edit"]').hidden = !cities.length;
      pg.querySelector(".clk-irows").innerHTML = cities.length ? cities.map(function (c, i) {
        var p = partsIn(c.tz, now);
        return '<div class="clk-irow" data-i="' + i + '"><button class="clk-iminus">' + IC.minus + '</button><div class="clk-icity"><small>' + esc(relText(c.tz, now)) + "</small><b>" + esc(c.name) + '</b></div><span class="clk-itime">' + hm(p.h, p.mi) + '</span><button class="clk-idelbtn">删除</button><i class="clk-igrip">' + IC.grip + "</i></div>";
      }).join("") : '<div class="clk-iempty">没有世界时钟</div>';
    } else if (tab === "alarm") {
      var pa = el.querySelector('[data-p="alarm"]'), ea = ioEdit.alarm && alarms.length;
      if (!alarms.length) ioEdit.alarm = false;
      pa.classList.toggle("editing", !!ea);
      pa.querySelector('[data-act="edit"]').textContent = ea ? "完成" : "编辑";
      pa.querySelector('[data-act="edit"]').hidden = !alarms.length;
      pa.querySelector(".clk-irows").innerHTML = alarms.length ? alarms.map(function (a) {
        return '<div class="clk-irow clk-ialarm' + (a.on ? "" : " off") + '" data-id="' + esc(a.id) + '"><button class="clk-iminus">' + IC.minus + '</button><div class="clk-ial"><b>' + a.time + "</b><small>" + esc(alarmSub(a)) + (a.snoozeUntil && a.on ? " · 稍后提醒 " + esc(a.snoozeUntil.slice(11, 16)) : "") + '</small></div>' +
          '<span class="io-sw' + (a.on ? " on" : "") + '" data-alarm="' + esc(a.id) + '" role="switch"><i></i></span><i class="clk-ichev">' + IC.chev + '</i><button class="clk-idelbtn">删除</button></div>';
      }).join("") : '<div class="clk-iempty">没有闹钟</div>';
    } else if (tab === "sw") renderIOSsw(true);
    else renderIOStimer(true);
  }
  function renderIOSsw(full) {
    var el = M.io.el, e = swElapsed(), pg = el.querySelector('[data-p="sw"]');
    pg.querySelector(".clk-isdig").textContent = swText(e);
    pg.querySelector(".clk-isdd").textContent = swText(e);
    var svg = pg.querySelector(".clk-dial"), sec = (e / 1000) % 60, lapE = swLapNow();
    svg.querySelector(".clk-dsh").setAttribute("transform", "rotate(" + (sec * 6).toFixed(2) + " 50 50)");
    svg.querySelector(".clk-dmh").setAttribute("transform", "rotate(" + ((e / 60000) % 30 * 12).toFixed(2) + " 50 30)");
    var lh = svg.querySelector(".clk-dlap");
    lh.style.display = sw.laps.length ? "" : "none";
    lh.setAttribute("transform", "rotate(" + ((lapE / 1000) % 60 * 6).toFixed(2) + " 50 50)");
    if (!full && !sw.run) return;
    var L = pg.querySelector('[data-sw="left"]'), R = pg.querySelector('[data-sw="right"]');
    L.textContent = sw.run || !e ? "计次" : "复位";
    L.disabled = !sw.run && !e;
    L.className = "clk-irb gray";
    R.textContent = sw.run ? "停止" : "启动";
    R.className = "clk-irb " + (sw.run ? "red" : "green");
    var mk = lapMarks(), rows = [];
    if (e || sw.laps.length) rows.push('<div class="clk-ilap"><span>计次 ' + (sw.laps.length + 1) + "</span><span>" + swText(lapE) + "</span></div>");
    for (var i = sw.laps.length - 1; i >= 0; i--) rows.push('<div class="clk-ilap' + (i === mk.min ? " fast" : i === mk.max ? " slow" : "") + '"><span>计次 ' + (i + 1) + "</span><span>" + swText(sw.laps[i]) + "</span></div>");
    pg.querySelector(".clk-ilaps").innerHTML = rows.join("");
  }
  function renderIOStimer(full) {
    var io = M.io, el = io.el, pg = el.querySelector('[data-p="timer"]');
    if (full) {
      requestAnimationFrame(function () { [io.wh, io.wm, io.ws].forEach(function (w) { w.sync(); }); });
      pg.querySelector('[data-tm="cancel"]').disabled = !timers.length;
      pg.querySelector(".clk-iopts .io-rv").textContent = io.tsound;
      pg.querySelector(".clk-iruns").innerHTML = timers.length ? '<div class="io-grp clk-iruns-g">' + timers.map(function (t) {
        return '<div class="io-row clk-irun" data-id="' + esc(t.id) + '"><div class="clk-irl"><b></b><small>' + esc(t.label || durText(t.duration)) + '</small></div><button class="clk-icircle gray" data-it="cancel" aria-label="取消">' + IC.xmark + '</button><button class="clk-icircle" data-it="pause" aria-label="暂停"></button></div>';
      }).join("") + "</div>" : "";
      pg.querySelector(".clk-irecent").innerHTML = recents.length ? '<h3 class="io-gh">最近项目</h3><div class="io-grp">' + recents.map(function (r, i) {
        return '<div class="io-row clk-irec"><div class="clk-irl"><b>' + esc(hms(r.duration)) + "</b><small>" + esc(r.label || durText(r.duration)) + '</small></div><button class="clk-icircle green" data-rec="' + i + '" aria-label="启动">' + IC.play + "</button></div>";
      }).join("") + "</div>" : "";
    }
    pg.querySelectorAll(".clk-irun").forEach(function (row) {
      var t = timers.find(function (x) { return x.id === row.dataset.id; });
      if (!t) return;
      row.querySelector(".clk-irl b").textContent = hms(Math.ceil(timerLeft(t)));
      var b = row.querySelector('[data-it="pause"], [data-it="resume"]');
      b.dataset.it = t.endsAt ? "pause" : "resume";
      b.className = "clk-icircle " + (t.endsAt ? "orange" : "green");
      b.innerHTML = t.endsAt ? IC.pause : IC.play;
    });
  }
  // ---- 手机上的面板（从底下升起来）：取消 / 标题 / 存储；里面可以再推一页（重复、铃声）----
  function iosSheet(title, o) {
    o = o || {};
    var ov = document.createElement("div");
    ov.className = "io-sheet-ov clk-isheet-ov";
    ov.innerHTML = '<div class="io-sheet' + (o.medium ? " io-medium" : "") + ' clk-isheet"><i class="io-grab"></i><header class="io-snav"><div class="io-nav-l"></div><div class="io-snav-t"></div><div class="io-nav-r"></div></header><div class="io-sbody"></div></div>';
    var sh = ov.firstChild, api = { ov: ov, body: sh.querySelector(".io-sbody"), navL: sh.querySelector(".io-nav-l"), navR: sh.querySelector(".io-nav-r"), titleEl: sh.querySelector(".io-snav-t"), stack: [] };
    api.titleEl.textContent = title;
    api.close = function () { if (api.closed) return; api.closed = true; ov.classList.add("io-out"); setTimeout(function () { ov.remove(); }, 320); if (o.onClose) o.onClose(); };
    ov.addEventListener("pointerdown", function (e) { if (e.target === ov) api.close(); });
    // 推一页：换掉标题、左边变成「‹ 返回」，body 换成新的内容；返回时恢复
    api.push = function (t, html, bind) {
      api.stack.push({ title: api.titleEl.textContent, l: api.navL.innerHTML, r: api.navR.innerHTML, body: Array.prototype.slice.call(api.body.childNodes) });
      api.titleEl.textContent = t;
      api.navL.innerHTML = gb("back", IC.back, "", "返回");
      api.navR.innerHTML = "";
      api.body.innerHTML = html;
      if (bind) bind(api.body);
    };
    api.pop = function () {
      var s = api.stack.pop();
      if (!s) return;
      api.titleEl.textContent = s.title;
      api.navL.innerHTML = s.l;
      api.navR.innerHTML = s.r;
      api.body.innerHTML = "";
      s.body.forEach(function (n) { api.body.appendChild(n); });
      if (api.onPop) api.onPop();
    };
    sh.addEventListener("click", function (e) { if (e.target.closest('[data-act="back"]')) api.pop(); });
    (M && M.io ? M.io.el : document.body).appendChild(ov);
    return api;
  }
  function iosAddCity() {
    var s = iosSheet("选取城市");
    s.navR.innerHTML = gb("cancel", "取消", "io-txt");
    s.body.innerHTML = '<label class="clk-isearch">' + IC.search + '<input type="search" placeholder="搜索" spellcheck="false" autocomplete="off"></label><div class="io-grp clk-icities"></div>';
    var inp = s.body.querySelector("input"), list = s.body.querySelector(".clk-icities");
    function paint() { var r = searchCities(inp.value); list.innerHTML = r.length ? r.map(function (c) { return '<div class="io-row io-tap" data-n="' + esc(c[0]) + '"><span class="io-rl">' + esc(c[0]) + "，" + esc(c[1]) + "</span></div>"; }).join("") : '<div class="io-row"><span class="io-rl io-dimtext">没有结果</span></div>'; }
    inp.addEventListener("input", paint);
    paint();
    s.ov.addEventListener("click", function (e) {
      if (e.target.closest('[data-act="cancel"]')) return s.close();
      var r = e.target.closest("[data-n]");
      if (r) { var c = cityByName(r.dataset.n); if (c) addCity(c); s.close(); }
    });
    setTimeout(function () { inp.focus(); }, 350);
  }
  function iosSoundPick(cur, set, sheet) {
    var html = '<div class="io-grp">' + SOUND_NAMES.concat(["无"]).map(function (n) { return '<div class="io-row io-tap" data-snd="' + n + '"><span class="io-rl">' + n + "</span>" + (n === cur ? '<i class="io-rck">' + IC.check + "</i>" : "") + "</div>"; }).join("") + "</div>";
    var bind = function (body) {
      body.addEventListener("click", function (e) {
        var r = e.target.closest("[data-snd]");
        if (!r) return;
        cur = r.dataset.snd;
        set(cur);
        if (cur !== "无") playOnce(cur);
        body.querySelectorAll("[data-snd]").forEach(function (x) { var ck = x.querySelector(".io-rck"); if (x === r && !ck) x.insertAdjacentHTML("beforeend", '<i class="io-rck">' + IC.check + "</i>"); if (x !== r && ck) ck.remove(); });
      });
    };
    if (sheet) return sheet.push("铃声", html, bind);
    var s = iosSheet("计时结束时", { medium: true });
    s.navR.innerHTML = gb("done", "完成", "io-txt io-bold");
    s.body.innerHTML = html;
    bind(s.body);
    s.ov.addEventListener("click", function (e) { if (e.target.closest('[data-act="done"]')) s.close(); });
  }
  function iosEditAlarm(a) {
    var cur = a ? JSON.parse(JSON.stringify(a)) : { id: K.uid("a-"), time: defaultAlarmTime(), on: true, repeat: [], label: "", sound: "雷达", snooze: true };
    var s = iosSheet(a ? "编辑闹钟" : "添加闹钟");
    s.navL.innerHTML = gb("cancel", "取消", "io-txt");
    s.navR.innerHTML = gb("save", "存储", "io-txt io-tint");
    var hh = Wheel(24, +cur.time.slice(0, 2), "", { itemH: 40, visible: 5, cls: "clk-iwheel clk-iaw", pad2: true }), mm = Wheel(60, +cur.time.slice(3, 5), "", { itemH: 40, visible: 5, cls: "clk-iwheel clk-iaw", pad2: true });
    s.body.innerHTML = '<div class="clk-iawheels"><i class="clk-iband"></i></div><div class="io-grp clk-iaopts">' +
      '<div class="io-row io-tap" data-a="repeat"><span class="io-rl">重复</span><span class="io-rv"></span><i class="io-rchev">' + IC.chev + "</i></div>" +
      '<div class="io-row"><span class="io-rl">标签</span><input class="clk-iin" placeholder="闹钟" maxlength="60"></div>' +
      '<div class="io-row io-tap" data-a="sound"><span class="io-rl">铃声</span><span class="io-rv"></span><i class="io-rchev">' + IC.chev + "</i></div>" +
      '<div class="io-row"><span class="io-rl">稍后提醒</span><span class="io-sw' + (cur.snooze ? " on" : "") + '" data-a="snooze" role="switch"><i></i></span></div></div>' +
      (a ? '<div class="io-grp clk-idel"><div class="io-row io-tap" data-a="del"><span class="io-rl">删除闹钟</span></div></div>' : "");
    var wbox = s.body.querySelector(".clk-iawheels");
    wbox.appendChild(hh.el); wbox.appendChild(mm.el);
    var labelIn = s.body.querySelector(".clk-iin");
    labelIn.value = cur.label;
    var paint = function () { s.body.querySelector('[data-a="repeat"] .io-rv').textContent = repeatText(cur.repeat, "永不"); s.body.querySelector('[data-a="sound"] .io-rv').textContent = cur.sound; };
    paint();
    s.onPop = paint;
    s.ov.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act], [data-a]");
      if (!b) return;
      var act = b.dataset.act || b.dataset.a;
      if (act === "cancel") return s.close();
      if (act === "save") { cur.time = hm(hh.get(), mm.get()); cur.label = labelIn.value.trim(); s.close(); saveAlarm(normAlarm(cur)); return; }
      if (act === "del") { s.close(); deleteAlarm(cur.id); return; }
      if (act === "snooze") { cur.snooze = !cur.snooze; b.classList.toggle("on", cur.snooze); return; }
      if (act === "sound") return iosSoundPick(cur.sound, function (v) { cur.sound = v; }, s);
      if (act === "repeat") {
        s.push("重复", '<div class="io-grp">' + [0, 1, 2, 3, 4, 5, 6].map(function (d) { return '<div class="io-row io-tap" data-day="' + d + '"><span class="io-rl">每周' + WD[d] + "</span>" + (cur.repeat.indexOf(d) >= 0 ? '<i class="io-rck">' + IC.check + "</i>" : "") + "</div>"; }).join("") + "</div>", function (body) {
          body.addEventListener("click", function (ev) {
            var r = ev.target.closest("[data-day]");
            if (!r) return;
            var d = +r.dataset.day, i = cur.repeat.indexOf(d);
            if (i >= 0) cur.repeat.splice(i, 1); else cur.repeat.push(d);
            cur.repeat.sort();
            var ck = r.querySelector(".io-rck");
            if (ck) ck.remove(); else r.insertAdjacentHTML("beforeend", '<i class="io-rck">' + IC.check + "</i>");
          });
        });
      }
    });
  }

  // ======== 走针：每秒（世界时钟的秒针、图标、闹钟与计时器到点）；秒表在跑时每帧 ========
  var raf = 0;
  function frame() {
    raf = 0;
    if (!M || !sw.run || tab !== "sw" || M.win.state === "closed" || M.win.state === "min") return;
    if (isIOS()) renderIOSsw(false); else renderSW(false);
    raf = requestAnimationFrame(frame);
  }
  function everySecond() {
    tickIcons();
    tick();
    if (!M || M.win.state === "closed") return;
    if (isIOS()) {
      if (tab === "world" && new Date().getSeconds() === 0) renderIOS();
      if (tab === "timer") renderIOStimer(false);
    } else {
      if (tab === "world") { tickFaces(); if (new Date().getSeconds() === 0) renderWorld(); }
      if (tab === "timer") renderTimers(false);
    }
    if (sw.run && tab === "sw" && !raf) raf = requestAnimationFrame(frame);
  }
  // 深浅外观、手机 / 桌面切换：重画
  new MutationObserver(function () { render(); }).observe(root, { attributes: true, attributeFilter: ["class"] });

  // ======== 启动 ========
  D.registerApp({ id: APP, name: NAME, icon: ICON_HTML, open: function () { return open(); }, category: "工具" });
  K.describe({ id: APP, name: NAME + " (Clock: world clock, alarms, stopwatch, timers)", path: DIR,
    about: "cities.json = [{name, tz (IANA)}] (display order); alarms.json = [{id, time \"HH:MM\", on, repeat [0=Sun..6=Sat] ([] = once), label, sound (雷达|信号|钟声|波浪|无), snooze}]; " +
      "timers.json = {timers: [{id, label, duration (seconds), endsAt \"YYYY-MM-DDTHH:MM:SS\" when running | remaining (seconds) when paused, sound}], recents: [{duration, label}]}. " +
      "To set a timer for the user, append {\"duration\": 600, \"label\": \"…\"} to timers without endsAt/remaining — the app starts it when it reads the file. Times are local (" + LOCAL_TZ + "). " +
      "Alarms/timers ring only while the web page is open. Full format: README.md in that folder." });
  FS.ready().then(function () {
    loadAll();
    store.watch(function () { loadAll(); sortAlarms(); render(); });
    K.settled(function () {
      store.ensure();
      K.shareWithAgents(DIR);
      loadAll();
      var first = !FS.exists(F_CITIES);
      loaded = true;
      if (first) {
        var here = cityByTz(LOCAL_TZ), seed = (here ? [here] : []).concat(["库比蒂诺", "伦敦", "纽约"].map(cityByName)).filter(Boolean);
        cities = seed.filter(function (c, i) { return seed.findIndex(function (x) { return x[0] === c[0]; }) === i; }).map(function (c) { return { name: c[0], tz: c[2] }; });
        saveCities();
      }
      if (!FS.exists(F_ALARMS)) saveAlarms();
      if (!FS.exists(F_TIMERS)) saveTimers();
      sortAlarms();
      tick();
      render();
    });
  });
  setInterval(everySecond, 1000);
  tickIcons();
  window.TSU_CLOCK = { open: open, dir: DIR, tab: function () { return tab; }, setTab: setTab,
    state: function () { return { cities: cities, alarms: alarms, timers: timers, recents: recents, sw: sw }; }, reload: function () { loadAll(); render(); } };
})();
