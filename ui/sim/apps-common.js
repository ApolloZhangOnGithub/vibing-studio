// apps-common.js —— 提醒事项、日历、备忘录共用的底子（window.TSU_APPKIT）
// · 数据：每个 App 的数据是沙盒里的普通文件（~/Library/…），agent 用自己的文件工具就能读写；读 JSON 容错，
//   写的时候记下「这是自己写的」，文件一变只把别人（agent、终端、另一个窗口）改的通知给 App
// · 日期：本地时间的 "YYYY-MM-DD" / "YYYY-MM-DDTHH:MM" 与 Date 互转、中文写法、「明天下午3点」这类说法
// · 界面：macOS 26 的窗口骨架（浮起的玻璃侧边栏 + 统一工具栏）、SF Symbols 风格的图标、浮层（带小箭头）、迷你月历、开关
(function () {
  "use strict";
  if (!window.SANDBOX || !window.TSU_DESK) return;
  var FS = window.SANDBOX, D = window.TSU_DESK;
  var K = { FS: FS, D: D, HOME: FS.HOME };

  // ======== 小工具 ========
  K.esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  K.uid = function (prefix) { return (prefix || "") + Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 6); };
  var pad = K.pad = function (n) { return (n < 10 ? "0" : "") + n; };
  K.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  K.store = {
    get: function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 满了就算了 */ } },
  };
  K.light = function () { return document.documentElement.classList.contains("light"); };
  // 链接只放行 http(s)、mailto、tel（数据文件是 agent 能写的：javascript: 之类一律不当链接）；没写协议的当 https
  K.safeURL = function (u) {
    u = String(u || "").trim();
    if (!u) return "";
    if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u) || /^\/\//.test(u)) return "";
    return "https://" + u;
  };
  // 深浅外观变了（手动切、跟随系统）：颜色是算出来的（列表颜色的深浅两套）要重画
  var themeFns = [], wasLight = K.light();
  new MutationObserver(function () {
    var l = K.light();
    if (l === wasLight) return;
    wasLight = l;
    themeFns.forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  K.onTheme = function (fn) { themeFns.push(fn); };
  // 文件名里不能有的字（/、控制字符）换掉；太长截短
  K.safeName = function (s, dflt) {
    var t = String(s || "").replace(/[\/\\\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    return t && t !== "." && t !== ".." ? t : dflt || "未命名";
  };

  // ======== 数据目录 ========
  // K.dataDir(dir, readme) → { dir, ensure, files, dirs, read, readJSON, writeText, writeJSON, move, watch }
  // 读的结果：{ missing } 没有这个文件 | { lazy } 真沙盒里的内容还没取回来（取回来会再通知一次）| { error, text } | { text, data }
  K.dataDir = function (dir, readme) {
    var own = {}; // 路径 → 自己最后写进去的内容：onChange 时内容一样就是自己写的，不再通知
    var api = {
      dir: dir,
      ensure: function () {
        try {
          if (!FS.isDir(dir)) FS.mkdirp(dir);
          if (readme && !FS.exists(dir + "/README.md")) api.writeText(dir + "/README.md", readme);
        } catch (e) { console.warn(dir + "：" + e.message); }
      },
      files: function (sub, ext) {
        var d = sub ? (sub.charAt(0) === "/" ? sub : dir + "/" + sub) : dir;
        try { return FS.list(d).filter(function (p) { return !FS.isDir(p) && (!ext || p.slice(-ext.length).toLowerCase() === ext); }); } catch (e) { return []; }
      },
      dirs: function (sub) {
        var d = sub ? (sub.charAt(0) === "/" ? sub : dir + "/" + sub) : dir;
        try { return FS.list(d).filter(function (p) { return FS.isDir(p); }); } catch (e) { return []; }
      },
      read: function (p) {
        var st = FS.stat(p);
        if (!st || st.dir) return { missing: true };
        if (st.lazy) { if (FS.ensureLoaded) FS.ensureLoaded([p]); return { lazy: true }; }
        try { return { text: FS.read(p) }; } catch (e) { return { error: e.message }; }
      },
      readJSON: function (p) {
        var r = api.read(p);
        if (r.text == null) return r;
        try { r.data = K.parseJSON(r.text); } catch (e) { r.error = "不是合法的 JSON：" + e.message; }
        return r;
      },
      writeText: function (p, text) { own[p] = text; FS.write(p, text); },
      writeJSON: function (p, obj) { api.writeText(p, JSON.stringify(obj, null, 2) + "\n"); },
      move: function (a, b) { if (own[a] !== undefined) { own[b] = own[a]; delete own[a]; } FS.move(a, b); },
      mine: function (p) { return own[p] !== undefined; },
      // fn(改了的路径们)：防抖；自己写的不算；真沙盒里刚变、内容还没取回来的先去取，取回来再算
      watch: function (fn) {
        var pend = new Set(), t = 0, dirWas = FS.isDir(dir);
        FS.onChange(function (p) {
          if (p !== dir && p.indexOf(dir + "/") !== 0) return;
          var rec = FS.stat(p);
          // 文件夹自己的记录变了（真沙盒拉下来的修改时间）不算：里面的文件变了会各自通知；只有文件夹新建 / 没了才算
          if (p === dir) { var isd = !!(rec && rec.dir); if (isd === dirWas) return; dirWas = isd; }
          if (rec && rec.lazy) { if (!rec.dir && FS.ensureLoaded) FS.ensureLoaded([p]); return; }
          if (own[p] !== undefined) {
            if (rec && !rec.dir && rec.data === own[p]) return;
            delete own[p]; // 别人改过了：以后再变都算别人的
          }
          pend.add(p);
          clearTimeout(t);
          t = setTimeout(function () { var a = Array.from(pend); pend.clear(); try { fn(a); } catch (e) { console.error(e); } }, 80);
        });
      },
    };
    return api;
  };
  // JSON，宽松一点：容忍 BOM、// 与 /* */ 注释、多出来的逗号（agent 手写时常见）；还是不行就抛错
  K.parseJSON = function (text) {
    var t = String(text).replace(/^\uFEFF/, "");
    try { return JSON.parse(t); } catch (e0) {
      var out = "", i = 0, n = t.length, inStr = false;
      while (i < n) {
        var c = t[i];
        if (inStr) { out += c; if (c === "\\") { out += t[i + 1] || ""; i += 2; continue; } if (c === '"') inStr = false; i++; continue; }
        if (c === '"') { inStr = true; out += c; i++; continue; }
        if (c === "/" && t[i + 1] === "/") { while (i < n && t[i] !== "\n") i++; continue; }
        if (c === "/" && t[i + 1] === "*") { var e = t.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
        out += c; i++;
      }
      out = out.replace(/,(\s*[}\]])/g, "$1");
      try { return JSON.parse(out); } catch (e1) { throw e0; }
    }
  };
  // 给 agent 登记数据在哪（agents.js 写进提示词）；agents.js 没加载就算了
  K.describe = function (o) { try { if (window.TSU_AGENTS && TSU_AGENTS.describeApp) TSU_AGENTS.describeApp(o); } catch (e) { /* 忽略 */ } };
  // 沙盒定下来了再建文件：没有真沙盒（就用浏览器里的）或真沙盒的镜像已经拉下来了。
  // 不等的话，开着真沙盒时会先往浏览器那份里写 README、默认列表，镜像一接上它们就变成「要不要导入」的文件
  K.settled = function (fn) {
    var t0 = Date.now(), done = false;
    FS.ready().then(function check() {
      if (done) return;
      var A = window.TSU_AGENTS, me = A && A.me ? A.me() : null, waited = Date.now() - t0;
      // 账号配了真沙盒（TSU_SBX / me.sandbox）：一直等到镜像接上（文件只在服务器上那一份，不往这台设备上写示例、默认列表）
      var sbx = window.TSU_SBX || (me && me.sandbox);
      var ok = (FS.mirrorActive && FS.mirrorActive()) || (!sbx && (!A || (me && !me.sandbox) || waited > 15000));
      if (ok) { done = true; try { fn(); } catch (e) { console.error(e); } } else setTimeout(check, 250);
    });
  };
  // 浏览器沙盒里 agent 改人的文件要看文件的「其他人」位：App 的数据文件夹放开写（agent 的档位是 rw 时才真能写）。真沙盒的权限由 sandboxd 管，不动
  K.shareWithAgents = function (dir) {
    if (FS.mirrorActive && FS.mirrorActive()) return;
    var st = FS.stat(dir);
    if (!st || !st.dir || (st.mode & 2) || !FS.Shell) return;
    try { new FS.Shell(null).run("chmod -R o+w '" + dir.replace(/'/g, "'\\''") + "'").catch(function () {}); } catch (e) { /* 算了 */ }
  };
  // 真沙盒的镜像里「刚写完马上移动同一个文件」会丢掉那次写（推送时本地已经没有原路径了，只发了 mv）：
  // 要移动、改名的，先等排队的推完再动
  K.afterSync = function (fn) {
    if (FS.mirrorActive && FS.mirrorActive() && FS.mirrorFlush) return FS.mirrorFlush().then(fn, fn);
    fn();
    return Promise.resolve();
  };
  // 撤销 / 重做：App 每做一步推一条 { label, undo(), redo() }
  K.undoStack = function () {
    var un = [], re = [];
    return {
      push: function (op) { un.push(op); if (un.length > 100) un.shift(); re = []; },
      undo: function () { var op = un.pop(); if (!op) return; try { op.undo(); } catch (e) { console.error(e); } re.push(op); },
      redo: function () { var op = re.pop(); if (!op) return; try { op.redo(); } catch (e) { console.error(e); } un.push(op); },
      undoLabel: function () { return un.length ? un[un.length - 1].label || "" : null; },
      redoLabel: function () { return re.length ? re[re.length - 1].label || "" : null; },
    };
  };

  // ======== 日期 ========
  K.WD = ["日", "一", "二", "三", "四", "五", "六"];
  K.ymd = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  K.hm = function (d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  K.local = function (d, withTime) { return withTime ? K.ymd(d) + "T" + K.hm(d) : K.ymd(d); };
  // "YYYY-MM-DD"、"YYYY-MM-DDTHH:MM[:SS]"、"YYYY-MM-DD HH:MM"，也认带时区的 ISO（换成本地）
  K.parse = function (s) {
    if (!s) return null;
    if (s instanceof Date) return isNaN(s) ? null : new Date(s);
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(s).trim());
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    var d = new Date(s);
    return isNaN(d) ? null : d;
  };
  K.dateOnly = function (s) { return /^\d{4}-\d{1,2}-\d{1,2}$/.test(String(s || "").trim()); };
  K.day0 = function (d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  K.addDays = function (d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; };
  K.addMinutes = function (d, n) { return new Date(d.getTime() + n * 60000); };
  K.dim = function (y, m) { return new Date(y, m + 1, 0).getDate(); };
  K.addMonths = function (d, n) {
    var x = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes());
    x.setDate(Math.min(d.getDate(), K.dim(x.getFullYear(), x.getMonth())));
    return x;
  };
  K.sameDay = function (a, b) { return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };
  K.dayDiff = function (a, b) { return Math.round((K.day0(b) - K.day0(a)) / 864e5); };
  // 一周从哪天开始：macOS 中文（中国大陆）默认周日；日历的「显示」菜单里可以改成周一
  K.weekStart = function () { return +(localStorage.getItem("tsu-cal-weekstart") || 0) === 1 ? 1 : 0; };
  K.startOfWeek = function (d) { var x = K.day0(d); return K.addDays(x, -((x.getDay() - K.weekStart() + 7) % 7)); };
  K.fmtMD = function (d) { return (d.getMonth() + 1) + "月" + d.getDate() + "日"; };
  K.fmtYMD = function (d) { return d.getFullYear() + "年" + K.fmtMD(d); };
  K.fmtDay = function (d) { return (d.getFullYear() === new Date().getFullYear() ? K.fmtMD(d) : K.fmtYMD(d)) + " 周" + K.WD[d.getDay()]; };
  // 今天 / 明天 / 昨天 / 后天 / 9月28日 / 2027年1月3日
  K.relDay = function (d) {
    var n = K.dayDiff(new Date(), d);
    if (n === 0) return "今天";
    if (n === 1) return "明天";
    if (n === -1) return "昨天";
    if (n === 2) return "后天";
    return d.getFullYear() === new Date().getFullYear() ? K.fmtMD(d) : K.fmtYMD(d);
  };

  // 「明天下午3点开会」「周五 9:30 交报告」「下周一」「9月30日」「3天后」「今晚」→ { date, time（有没有具体时间）, rest（去掉日期后的文字）}；没有日期返回 null
  var CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  function cnNum(s) {
    if (/^\d+$/.test(s)) return +s;
    if (s === "十") return 10;
    var m = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/.exec(s);
    if (m) return (m[1] ? CN[m[1]] : 1) * 10 + (m[2] ? CN[m[2]] : 0);
    return s.length === 1 && CN[s] !== undefined ? CN[s] : NaN;
  }
  var WDN = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  K.parseNatural = function (text, now) {
    now = now || new Date();
    var s = String(text || ""), date = null, time = null, used = [];
    var take = function (re, fn) { var m = re.exec(s); if (m) { var r = fn(m); if (r !== false) { used.push(m[0]); s = s.replace(m[0], " "); } } };
    var NUM = "(\\d{1,2}|[一二两三四五六七八九十]{1,3})";
    // 相对：N 天 / 周后，N 小时 / 分钟后
    take(new RegExp(NUM + "\\s*(?:个)?(天|周|星期|小时|钟头|分钟)(?:以)?后"), function (m) {
      var n = cnNum(m[1]); if (isNaN(n)) return false;
      if (m[2] === "天") date = K.addDays(K.day0(now), n);
      else if (m[2] === "周" || m[2] === "星期") date = K.addDays(K.day0(now), n * 7);
      else { var t = new Date(now.getTime() + n * (m[2] === "分钟" ? 60000 : 3600000)); date = K.day0(t); time = [t.getHours(), t.getMinutes()]; }
    });
    take(/(大后天|后天|明天|明日|今天|今日|明早|明晚|今晚|今早)/, function (m) {
      var k = m[1];
      date = K.addDays(K.day0(now), k === "大后天" ? 3 : k === "后天" ? 2 : /^明/.test(k) ? 1 : 0);
      if (/晚$/.test(k) && !time) time = [20, 0];
      if (/早$/.test(k) && !time) time = [9, 0];
    });
    take(/(下下|下|本|这|这个)?(?:周|星期|礼拜)([一二三四五六日天])/, function (m) {
      var target = WDN[m[2]], base = K.day0(now), dow = base.getDay();
      var monday = K.addDays(base, -((dow + 6) % 7)); // 本周一
      var off = (target + 6) % 7; // 周一 = 0 … 周日 = 6
      var d = K.addDays(monday, off + (m[1] === "下" ? 7 : m[1] === "下下" ? 14 : 0));
      if (!m[1] && d < base) d = K.addDays(d, 7); // 没说「本 / 下」：已经过了就是下一个
      date = d;
    });
    take(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/, function (m) {
      var y = m[1] ? +m[1] : now.getFullYear(), d = new Date(y, +m[2] - 1, +m[3]);
      if (!m[1] && d < K.day0(now)) d = new Date(y + 1, +m[2] - 1, +m[3]);
      date = d;
    });
    take(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, function (m) { date = new Date(+m[1], +m[2] - 1, +m[3]); });
    // 时间：上午 / 下午 / 晚上 + 3点[半 | 一刻 | 20分] 或 15:30
    take(new RegExp("(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里)?\\s*" + NUM + "\\s*(?:点|时)(?:\\s*(半|一刻|三刻|" + "(\\d{1,2}|[一二三四五六七八九十]{1,3})\\s*分?))?"), function (m) {
      var h = cnNum(m[2]); if (isNaN(h) || h > 24) return false;
      var mi = m[3] === "半" ? 30 : m[3] === "一刻" ? 15 : m[3] === "三刻" ? 45 : m[4] ? cnNum(m[4]) : 0;
      if (isNaN(mi) || mi > 59) mi = 0;
      if (/下午|傍晚|晚上|夜里/.test(m[1] || "") && h < 12) h += 12;
      if (m[1] === "中午" && h < 11) h += 12;
      time = [h % 24, mi];
    });
    take(/(凌晨|早上|上午|中午|下午|晚上)?\s*\b(\d{1,2}):(\d{2})\b/, function (m) {
      var h = +m[2], mi = +m[3]; if (h > 23 || mi > 59) return false;
      if (/下午|晚上/.test(m[1] || "") && h < 12) h += 12;
      time = [h, mi];
    });
    if (!date && !time) return null;
    if (!date) { date = K.day0(now); if (time && (time[0] * 60 + time[1]) <= now.getHours() * 60 + now.getMinutes()) date = K.addDays(date, 1); }
    var out = new Date(date);
    if (time) out.setHours(time[0], time[1], 0, 0);
    var rest = s.replace(/\s+/g, " ").replace(/^[\s，,、]+|[\s，,、]+$/g, "").trim();
    return { date: out, time: !!time, rest: rest, matched: used.join(" ") };
  };

  // ======== 重复规则：iCalendar RRULE 的常用子集 ========
  // FREQ=DAILY|WEEKLY|MONTHLY|YEARLY、INTERVAL、BYDAY（MO、2MO、-1FR）、BYMONTHDAY（负数从月底数）、BYMONTH、BYSETPOS、COUNT、UNTIL；一周从周一算（WKST=MO）
  var WDK = K.WDK = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  var RR_PRESET = { daily: "FREQ=DAILY", weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", weekends: "FREQ=WEEKLY;BYDAY=SA,SU", weekly: "FREQ=WEEKLY",
    biweekly: "FREQ=WEEKLY;INTERVAL=2", monthly: "FREQ=MONTHLY", quarterly: "FREQ=MONTHLY;INTERVAL=3", semiannually: "FREQ=MONTHLY;INTERVAL=6",
    yearly: "FREQ=YEARLY", annually: "FREQ=YEARLY", 每天: "FREQ=DAILY", 工作日: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", 周末: "FREQ=WEEKLY;BYDAY=SA,SU",
    每周: "FREQ=WEEKLY", 每两周: "FREQ=WEEKLY;INTERVAL=2", 每月: "FREQ=MONTHLY", 每年: "FREQ=YEARLY" };
  function parseUntil(v) {
    var m = /^(\d{4})-?(\d{2})-?(\d{2})(?:T(\d{2}):?(\d{2}):?(\d{2})?(Z)?)?$/i.exec(String(v).trim());
    if (!m) return K.parse(v);
    if (!m[4]) return new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59);
    return m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))) : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  }
  // 字符串（或 { freq, interval, … }、"weekly" 这类叫法）→ { freq, interval, byday: [{ n, wd }], bymonthday, bymonth, bysetpos, count, until }；看不懂返回 null
  K.rrParse = function (s) {
    if (!s) return null;
    if (typeof s === "object") {
      if ("bysetpos" in s && "count" in s && "until" in s) return s.freq ? s : null; // 已经是解析过的
      // agent 写成对象：{ freq: "weekly", interval: 2, byday: ["MO", "WE"], until: "2026-12-31", count: 5 }
      var src = s;
      s = Object.keys(src).filter(function (k) { return src[k] != null && src[k] !== ""; }).map(function (k) { return k.toUpperCase() + "=" + (Array.isArray(src[k]) ? src[k].join(",") : src[k]); }).join(";");
    }
    s = String(s).trim();
    if (RR_PRESET[s.toLowerCase()]) s = RR_PRESET[s.toLowerCase()];
    var o = { freq: "", interval: 1, byday: null, bymonthday: null, bymonth: null, bysetpos: null, count: 0, until: null };
    s.replace(/^RRULE:/i, "").split(";").forEach(function (kv) {
      var p = kv.split("="), k = (p[0] || "").trim().toUpperCase(), v = (p[1] || "").trim().toUpperCase();
      if (k === "FREQ") o.freq = v;
      else if (k === "INTERVAL") o.interval = Math.max(1, parseInt(v, 10) || 1);
      else if (k === "COUNT") o.count = Math.max(0, parseInt(v, 10) || 0);
      else if (k === "UNTIL") o.until = parseUntil(v);
      else if (k === "BYDAY") o.byday = v.split(",").map(function (d) { var m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(d.trim()); return m ? { n: m[1] ? parseInt(m[1], 10) : 0, wd: WDK.indexOf(m[2]) } : null; }).filter(Boolean);
      else if (k === "BYMONTHDAY") o.bymonthday = v.split(",").map(Number).filter(function (n) { return n && Math.abs(n) <= 31; });
      else if (k === "BYMONTH") o.bymonth = v.split(",").map(Number).filter(function (n) { return n >= 1 && n <= 12; });
      else if (k === "BYSETPOS") o.bysetpos = v.split(",").map(Number).filter(Boolean);
    });
    ["byday", "bymonthday", "bymonth", "bysetpos"].forEach(function (k) { if (o[k] && !o[k].length) o[k] = null; });
    return /^(DAILY|WEEKLY|MONTHLY|YEARLY)$/.test(o.freq) ? o : null;
  };
  K.rrString = function (r) {
    r = typeof r === "string" ? K.rrParse(r) : r;
    if (!r) return "";
    var p = ["FREQ=" + r.freq];
    if (r.interval > 1) p.push("INTERVAL=" + r.interval);
    if (r.byday) p.push("BYDAY=" + r.byday.map(function (x) { return (x.n || "") + WDK[x.wd]; }).join(","));
    if (r.bymonthday) p.push("BYMONTHDAY=" + r.bymonthday.join(","));
    if (r.bymonth) p.push("BYMONTH=" + r.bymonth.join(","));
    if (r.bysetpos) p.push("BYSETPOS=" + r.bysetpos.join(","));
    if (r.count) p.push("COUNT=" + r.count);
    else if (r.until) p.push("UNTIL=" + r.until.getFullYear() + pad(r.until.getMonth() + 1) + pad(r.until.getDate()));
    return p.join(";");
  };
  // 规范化：看得懂的写成标准 RRULE 字符串，看不懂的返回 ""
  K.rrNorm = function (v) { var r = K.rrParse(v); return r ? K.rrString(r) : ""; };
  function monthDays(r, y, m, start) {
    var dim = K.dim(y, m), days = [];
    if (r.bymonthday) r.bymonthday.forEach(function (n) { var d = n > 0 ? n : dim + 1 + n; if (d >= 1 && d <= dim) days.push(d); });
    else if (r.byday) r.byday.forEach(function (b) {
      var all = [];
      for (var d = 1; d <= dim; d++) if (new Date(y, m, d).getDay() === b.wd) all.push(d);
      if (!b.n) days = days.concat(all);
      else { var hit = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]; if (hit) days.push(hit); }
    });
    else if (start.getDate() <= dim) days.push(start.getDate());
    days = days.filter(function (d, i) { return days.indexOf(d) === i; }).sort(function (a, b) { return a - b; });
    if (r.bysetpos) { var set = days; days = r.bysetpos.map(function (p) { return p > 0 ? set[p - 1] : set[set.length + p]; }).filter(Boolean).sort(function (a, b) { return a - b; }); }
    return days;
  }
  // start（第一次）起按规则展开，返回 [from, to) 里的每一次（Date，时刻同 start）。exdates：{ "YYYY-MM-DD": 1 } 跳过的日子（仍算进 COUNT）
  K.rrBetween = function (rule, start, from, to, exdates) {
    var r = typeof rule === "string" ? K.rrParse(rule) : rule;
    if (!r) return start >= from && start < to ? [new Date(start)] : [];
    var out = [], n = 0, stop = false, guard = 0, H = start.getHours(), Mi = start.getMinutes();
    var y0 = start.getFullYear(), m0 = start.getMonth(), d0 = start.getDate(), iv = r.interval || 1;
    var mk = function (y, m, d) { return new Date(y, m, d, H, Mi); };
    var past = function (d) { return d >= to || (r.until && d > r.until); };
    var emit = function (d) {
      if (d < start) return;
      if (past(d)) { stop = true; return; }
      n++;
      if (r.count && n > r.count) { stop = true; return; }
      if (d >= from && !(exdates && exdates[K.ymd(d)])) out.push(d);
    };
    // 没有 COUNT 时可以直接跳到 from 附近（不用从很久以前一次次算过来）
    var skip = function (unitsPer, total) { return r.count ? 0 : Math.max(0, Math.floor(total / unitsPer) - 1) * unitsPer; };
    if (r.freq === "DAILY") {
      for (var k = skip(iv, K.dayDiff(start, from)); !stop && guard++ < 50000; k += iv) {
        var d = mk(y0, m0, d0 + k);
        if (past(d)) break;
        if (r.bymonth && r.bymonth.indexOf(d.getMonth() + 1) < 0) continue;
        if (r.bymonthday && r.bymonthday.indexOf(d.getDate()) < 0 && r.bymonthday.indexOf(d.getDate() - K.dim(d.getFullYear(), d.getMonth()) - 1) < 0) continue;
        if (r.byday && !r.byday.some(function (b) { return b.wd === d.getDay(); })) continue;
        emit(d);
      }
    } else if (r.freq === "WEEKLY") {
      var wds = (r.byday ? r.byday.map(function (b) { return b.wd; }) : [start.getDay()]).map(function (w) { return (w + 6) % 7; }).sort(function (a, b) { return a - b; });
      var mon = K.addDays(K.day0(start), -((start.getDay() + 6) % 7));
      for (var w = skip(iv, Math.floor(K.dayDiff(mon, from) / 7)); !stop && guard++ < 20000; w += iv) {
        if (past(mk(mon.getFullYear(), mon.getMonth(), mon.getDate() + w * 7))) break;
        for (var j = 0; j < wds.length && !stop; j++) {
          var dd = mk(mon.getFullYear(), mon.getMonth(), mon.getDate() + w * 7 + wds[j]);
          if (r.bymonth && r.bymonth.indexOf(dd.getMonth() + 1) < 0) continue;
          emit(dd);
        }
      }
    } else if (r.freq === "MONTHLY") {
      for (var mo = skip(iv, (from.getFullYear() - y0) * 12 + from.getMonth() - m0); !stop && guard++ < 5000; mo += iv) {
        var first = new Date(y0, m0 + mo, 1);
        if (past(first)) break;
        if (r.bymonth && r.bymonth.indexOf(first.getMonth() + 1) < 0) continue;
        var days = monthDays(r, first.getFullYear(), first.getMonth(), start);
        for (var q = 0; q < days.length && !stop; q++) emit(mk(first.getFullYear(), first.getMonth(), days[q]));
      }
    } else {
      var months = r.bymonth || [m0 + 1];
      for (var yy = skip(iv, from.getFullYear() - y0); !stop && guard++ < 2000; yy += iv) {
        var year = y0 + yy;
        if (past(new Date(year, 0, 1))) break;
        for (var mi = 0; mi < months.length && !stop; mi++) {
          var mm = months[mi] - 1, ds = r.bymonthday || r.byday ? monthDays(r, year, mm, start) : (d0 <= K.dim(year, mm) ? [d0] : []);
          for (var z = 0; z < ds.length && !stop; z++) emit(mk(year, mm, ds[z]));
        }
      }
    }
    return out;
  };
  // after 之后的下一次（不含 after）；没有了返回 null
  K.rrNext = function (rule, start, after) {
    var spans = [400, 4000, 40000];
    for (var i = 0; i < spans.length; i++) {
      var hit = K.rrBetween(rule, start, new Date(after.getTime() + 1), K.addDays(after, spans[i]));
      if (hit.length) return hit[0];
    }
    return null;
  };
  var CN_ORD = ["", "一", "二", "三", "四", "五"];
  // 中文说法：每天、每个工作日、每 2 周的周一、周三、每月的最后一个周五、每年……（，共 5 次 / ，直到 2026年12月31日）
  K.rrText = function (rule, start) {
    var r = typeof rule === "string" ? K.rrParse(rule) : rule;
    if (!r) return "";
    var iv = r.interval, t = "", bd = r.byday || [], wdN = function (b) { return "周" + K.WD[b.wd]; };
    var ordered = bd.slice().sort(function (a, b) { return (a.wd + 6) % 7 - (b.wd + 6) % 7; });
    if (r.freq === "DAILY") t = iv === 1 ? "每天" : "每 " + iv + " 天";
    else if (r.freq === "WEEKLY") {
      var set = bd.map(function (b) { return b.wd; }).sort().join(",");
      if (iv === 1 && set === "1,2,3,4,5") t = "每个工作日";
      else if (iv === 1 && set === "0,6") t = "每个周末";
      else {
        t = iv === 1 ? "每周" : iv === 2 ? "每两周" : "每 " + iv + " 周";
        if (bd.length && !(bd.length === 1 && start && bd[0].wd === start.getDay())) t += "的" + ordered.map(wdN).join("、");
      }
    } else if (r.freq === "MONTHLY") {
      t = iv === 1 ? "每月" : "每 " + iv + " 个月";
      if (r.bymonthday) t += "的" + r.bymonthday.map(function (d) { return d > 0 ? d + " 日" : d === -1 ? "最后一天" : "倒数第 " + -d + " 天"; }).join("、");
      else if (bd.length && bd[0].n) t += "的" + bd.map(function (b) { return (b.n > 0 ? "第" + (CN_ORD[b.n] || b.n) + "个" : b.n === -1 ? "最后一个" : "倒数第" + (CN_ORD[-b.n] || -b.n) + "个") + wdN(b); }).join("、");
      else if (bd.length && r.bysetpos) {
        var pos = r.bysetpos[0], what = bd.length === 5 && bd.every(function (b) { return b.wd >= 1 && b.wd <= 5; }) ? "工作日" : bd.length === 2 && bd.every(function (b) { return b.wd === 0 || b.wd === 6; }) ? "周末日" : bd.length === 7 ? "天" : ordered.map(wdN).join("、");
        t += "的" + (pos > 0 ? "第" + (CN_ORD[pos] || pos) + "个" : pos === -1 ? "最后一个" : "倒数第" + -pos + "个") + what;
      }
    } else {
      t = iv === 1 ? "每年" : "每 " + iv + " 年";
      if (r.bymonth && !(r.bymonth.length === 1 && start && r.bymonth[0] === start.getMonth() + 1)) t += "的" + r.bymonth.map(function (m) { return m + "月"; }).join("、");
    }
    if (r.count) t += "，共 " + r.count + " 次";
    else if (r.until) t += "，直到 " + K.fmtYMD(r.until);
    return t;
  };
  // 自定重复（同 macOS 的「自定」表单）：频率、每 N 个、周几 / 每月的哪天或第几个周几 / 哪几个月、结束重复（永不 / 于日期 / 次数）
  // o: { rule, start: Date, onDone(ruleString) }
  K.editRule = function (anchor, o) {
    var r = (typeof o.rule === "string" ? K.rrParse(o.rule) : o.rule) || { freq: "WEEKLY", interval: 1 };
    r = JSON.parse(JSON.stringify(r)); // 拷一份（until 变成字符串，下面转回来）
    r.until = r.until ? K.parse(r.until) : null;
    var start = o.start || new Date();
    var box = document.createElement("div");
    box.className = "ma-rule";
    var FREQ = [["DAILY", "每天", "天"], ["WEEKLY", "每周", "周"], ["MONTHLY", "每月", "个月"], ["YEARLY", "每年", "年"]];
    var ORD = [[1, "第一个"], [2, "第二个"], [3, "第三个"], [4, "第四个"], [5, "第五个"], [-1, "最后一个"]];
    var monthMode = r.byday && r.byday.length ? "wd" : "day";
    function render() {
      var f = FREQ.find(function (x) { return x[0] === r.freq; }) || FREQ[1];
      var h = '<div class="ma-row"><label>频率</label><button class="ma-drop" data-a="freq"><span>' + f[1] + "</span></button></div>" +
        '<div class="ma-row"><label>每</label><input class="ma-field ma-num" data-a="iv" value="' + (r.interval || 1) + '" maxlength="3"><span>' + f[2] + "</span></div>";
      if (r.freq === "WEEKLY") {
        var on = (r.byday || [{ wd: start.getDay() }]).map(function (b) { return b.wd; });
        h += '<div class="ma-chips">' + [1, 2, 3, 4, 5, 6, 0].map(function (w) { return '<button data-wd="' + w + '" class="' + (on.indexOf(w) >= 0 ? "on" : "") + '">' + K.WD[w] + "</button>"; }).join("") + "</div>";
      } else if (r.freq === "MONTHLY") {
        h += '<div class="ma-row ma-radio"><label></label><button data-mm="day" class="' + (monthMode === "day" ? "on" : "") + '"><i></i>每月的某几天</button></div>';
        if (monthMode === "day") {
          var ds = r.bymonthday || [start.getDate()];
          h += '<div class="ma-daygrid">';
          for (var d = 1; d <= 31; d++) h += '<button data-md="' + d + '" class="' + (ds.indexOf(d) >= 0 ? "on" : "") + '">' + d + "</button>";
          h += "</div>";
        }
        var b0 = r.byday && r.byday[0] && r.byday[0].n ? r.byday[0] : { n: Math.min(5, Math.ceil(start.getDate() / 7)), wd: start.getDay() };
        h += '<div class="ma-row ma-radio"><label></label><button data-mm="wd" class="' + (monthMode === "wd" ? "on" : "") + '"><i></i>在</button>' +
          '<button class="ma-drop" data-a="ord"' + (monthMode === "wd" ? "" : " disabled") + '><span>' + (ORD.find(function (x) { return x[0] === b0.n; }) || ORD[0])[1] + "</span></button>" +
          '<button class="ma-drop" data-a="owd"' + (monthMode === "wd" ? "" : " disabled") + '><span>周' + K.WD[b0.wd] + "</span></button></div>";
      } else if (r.freq === "YEARLY") {
        var ms = r.bymonth || [start.getMonth() + 1];
        h += '<div class="ma-mgrid">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (m) { return '<button data-mo="' + m + '" class="' + (ms.indexOf(m) >= 0 ? "on" : "") + '">' + m + "月</button>"; }).join("") + "</div>";
      }
      var endMode = r.count ? "count" : r.until ? "until" : "never";
      h += '<div class="ma-sep"></div><div class="ma-row"><label>结束重复</label><button class="ma-drop" data-a="end"><span>' + { never: "永不", until: "于日期", count: "重复次数" }[endMode] + "</span></button>" +
        (endMode === "until" ? '<button class="ma-drop ma-date" data-a="until"><span>' + K.fmtYMD(r.until) + "</span></button>" : endMode === "count" ? '<input class="ma-field ma-num" data-a="count" value="' + r.count + '" maxlength="4"><span>次</span>' : "") + "</div>" +
        '<div class="ma-rule-sum"></div><div class="ma-btns"><button class="ma-pbtn" data-a="cancel">取消</button><button class="ma-pbtn default" data-a="ok">好</button></div>';
      box.innerHTML = h;
      sum();
    }
    function sum() { var s = box.querySelector(".ma-rule-sum"); if (s) s.textContent = "事件将" + K.rrText(norm(), start) + "重复。"; }
    function norm() {
      var x = { freq: r.freq, interval: Math.max(1, r.interval | 0), byday: null, bymonthday: null, bymonth: null, bysetpos: null, count: r.count | 0, until: r.count ? null : r.until };
      if (r.freq === "WEEKLY") x.byday = (r.byday && r.byday.length ? r.byday : [{ n: 0, wd: start.getDay() }]).map(function (b) { return { n: 0, wd: b.wd }; });
      if (r.freq === "MONTHLY") { if (monthMode === "wd") x.byday = [r.byday && r.byday[0] && r.byday[0].n ? r.byday[0] : { n: Math.min(5, Math.ceil(start.getDate() / 7)), wd: start.getDay() }]; else x.bymonthday = r.bymonthday && r.bymonthday.length ? r.bymonthday : null; }
      if (r.freq === "YEARLY" && r.bymonth && !(r.bymonth.length === 1 && r.bymonth[0] === start.getMonth() + 1)) x.bymonth = r.bymonth;
      return x;
    }
    box.addEventListener("click", function (e) {
      var t = e.target.closest("button");
      if (!t || t.disabled) return;
      var a = t.dataset.a;
      if (a === "freq") return D.popup(FREQ.map(function (f) { return { label: f[1], checked: f[0] === r.freq, run: function () { r.freq = f[0]; r.byday = null; r.bymonthday = null; r.bymonth = null; monthMode = "day"; render(); } }; }), at(t));
      if (a === "end") return D.popup([["never", "永不"], ["until", "于日期"], ["count", "重复次数"]].map(function (m) {
        return { label: m[1], run: function () { r.count = m[0] === "count" ? r.count || 5 : 0; r.until = m[0] === "until" ? r.until || K.addMonths(start, 3) : null; render(); } };
      }), at(t));
      if (a === "until") return K.pickDate(t, { value: r.until, onChange: function (d) { r.until = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59); render(); } });
      if (a === "ord") return D.popup(ORD.map(function (x) { return { label: x[1], run: function () { var b = norm().byday[0]; r.byday = [{ n: x[0], wd: b.wd }]; render(); } }; }), at(t));
      if (a === "owd") return D.popup([1, 2, 3, 4, 5, 6, 0].map(function (w) { return { label: "周" + K.WD[w], run: function () { var b = norm().byday[0]; r.byday = [{ n: b.n, wd: w }]; render(); } }; }), at(t));
      if (a === "cancel") return pop.close();
      if (a === "ok") { var s = K.rrString(norm()); pop.close(); if (o.onDone) o.onDone(s); return; }
      if (t.dataset.wd) {
        var w = +t.dataset.wd, cur = (r.byday || [{ wd: start.getDay() }]).map(function (b) { return b.wd; });
        cur = cur.indexOf(w) >= 0 ? cur.filter(function (x) { return x !== w; }) : cur.concat([w]);
        if (!cur.length) return;
        r.byday = cur.map(function (x) { return { n: 0, wd: x }; });
        return render();
      }
      if (t.dataset.mm) { monthMode = t.dataset.mm; if (monthMode === "day") r.byday = null; else r.bymonthday = null; return render(); }
      if (t.dataset.md) {
        var md = +t.dataset.md, ds = r.bymonthday || [start.getDate()];
        ds = ds.indexOf(md) >= 0 ? ds.filter(function (x) { return x !== md; }) : ds.concat([md]).sort(function (p, q) { return p - q; });
        if (!ds.length) return;
        r.bymonthday = ds;
        return render();
      }
      if (t.dataset.mo) {
        var mo = +t.dataset.mo, ms = r.bymonth || [start.getMonth() + 1];
        ms = ms.indexOf(mo) >= 0 ? ms.filter(function (x) { return x !== mo; }) : ms.concat([mo]).sort(function (p, q) { return p - q; });
        if (!ms.length) return;
        r.bymonth = ms;
        return render();
      }
    });
    box.addEventListener("input", function (e) {
      var t = e.target;
      if (t.dataset.a === "iv") { r.interval = Math.max(1, parseInt(t.value, 10) || 1); sum(); }
      if (t.dataset.a === "count") { r.count = Math.max(1, parseInt(t.value, 10) || 1); sum(); }
    });
    box.addEventListener("keydown", function (e) { if (e.isComposing || e.keyCode === 229) return; e.stopPropagation(); if (e.key === "Enter") box.querySelector('[data-a="ok"]').click(); });
    var at = function (el) { var q = el.getBoundingClientRect(); return { x: q.left, y: q.bottom + 2 }; };
    render();
    var pop = K.popover(anchor, box, { side: o.side || "left", className: "ma-pop-rule", stack: true });
    return pop;
  };

  // ======== 图标（SF Symbols 风格的线条图标，跟文字颜色）========
  var st = function (d, w) { return '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="' + (w || 1.6) + '" stroke-linecap="round" stroke-linejoin="round"/>'; };
  var svg = function (body, vb) { return '<svg viewBox="' + (vb || "0 0 20 20") + '" aria-hidden="true">' + body + "</svg>"; };
  K.ICON = {
    plus: svg(st("M10 4v12M4 10h12", 1.8)),
    sidebar: svg('<rect x="2.5" y="4" width="15" height="12" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/>' + st("M7.5 4.4v11.2", 1.5)),
    share: svg(st("M10 12.2V2.8M6.9 5.8 10 2.7l3.1 3.1", 1.6) + st("M7 8.2H5.6c-.9 0-1.6.7-1.6 1.6v6c0 .9.7 1.6 1.6 1.6h8.8c.9 0 1.6-.7 1.6-1.6v-6c0-.9-.7-1.6-1.6-1.6H13", 1.6)),
    more: svg('<g fill="currentColor"><circle cx="5" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/></g>'),
    trash: svg(st("M3.8 5.6h12.4M8 5.4V4c0-.6.4-1 1-1h2c.6 0 1 .4 1 1v1.4M5.4 5.8l.8 10.3c.1.7.6 1.2 1.3 1.2h5c.7 0 1.2-.5 1.3-1.2l.8-10.3M8.3 8.6v5.8M11.7 8.6v5.8", 1.4)),
    compose: svg(st("M9.5 3.6H5.2c-1 0-1.7.8-1.7 1.7v9.5c0 1 .8 1.7 1.7 1.7h9.5c1 0 1.7-.8 1.7-1.7v-4.3", 1.5) + st("M15.4 2.8a1.4 1.4 0 0 1 2 2l-7 7-2.7.7.7-2.7z", 1.5)),
    checklist: svg('<circle cx="5" cy="6" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="5" cy="14" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/>' + st("M9.5 6h7M9.5 14h7", 1.5) + st("m3.9 14 .8.8 1.5-1.6", 1.3)),
    table: svg('<rect x="2.8" y="3.6" width="14.4" height="12.8" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/>' + st("M2.8 8h14.4M2.8 12.2h14.4M7.6 3.8v12.4M12.4 3.8v12.4", 1.2)),
    format: '<svg viewBox="0 0 22 20" aria-hidden="true"><text x="1" y="15.5" font-family="-apple-system,Helvetica" font-size="15" font-weight="500" fill="currentColor">Aa</text></svg>',
    search: svg('<circle cx="8.6" cy="8.6" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/>' + st("m12.4 12.4 4 4", 1.7)),
    left: svg(st("M12.5 4.5 7 10l5.5 5.5", 1.8)),
    right: svg(st("m7.5 4.5 5.5 5.5-5.5 5.5", 1.8)),
    down: svg(st("m5.5 8 4.5 4.5L14.5 8", 1.6)),
    flag: svg('<path d="M5 17.5V3.2M5 3.5c3.4-1.9 6.3 1.6 10 0v7.6c-3.7 1.6-6.6-1.9-10 0" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>'),
    flagLine: svg(st("M5 17.5V3.2M5 3.5c3.4-1.9 6.3 1.6 10 0v7.6c-3.7 1.6-6.6-1.9-10 0", 1.4)),
    info: svg('<circle cx="10" cy="10" r="7.4" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="6.4" r="1" fill="currentColor"/>' + st("M10 9v5", 1.6)),
    list: svg('<g fill="currentColor"><circle cx="5" cy="6" r="1.4"/><circle cx="5" cy="10" r="1.4"/><circle cx="5" cy="14" r="1.4"/></g>' + st("M8.5 6h7M8.5 10h7M8.5 14h7", 1.6)),
    tray: svg(st("M2.8 11h4l1 2h4.4l1-2h4M2.8 11l2-6.4h10.4l2 6.4v4.2c0 .6-.4 1-1 1H3.8c-.6 0-1-.4-1-1z", 1.5)),
    check: svg(st("m4.5 10.5 3.5 3.5 7.5-8", 2)),
    calendar: svg('<rect x="3" y="4" width="14" height="13" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/>' + st("M3.2 8h13.6M7 2.6v3M13 2.6v3", 1.5)),
    clock: svg('<circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" stroke-width="1.5"/>' + st("M10 5.8V10l2.8 1.8", 1.5)),
    repeat: svg(st("M4 9.2V8c0-1.7 1.3-3 3-3h8.5M13 2.5 15.5 5 13 7.5M16 10.8V12c0 1.7-1.3 3-3 3H4.5M7 17.5 4.5 15 7 12.5", 1.5)),
    link: svg(st("M8.6 11.4a3.2 3.2 0 0 0 4.6 0l2.6-2.6a3.2 3.2 0 0 0-4.6-4.6l-1.1 1.1M11.4 8.6a3.2 3.2 0 0 0-4.6 0l-2.6 2.6a3.2 3.2 0 0 0 4.6 4.6l1.1-1.1", 1.5)),
    folder: svg(st("M2.6 6.2c0-1 .7-1.7 1.7-1.7h3.4l1.8 1.8h6.2c1 0 1.7.8 1.7 1.7v6.6c0 1-.8 1.7-1.7 1.7H4.3c-1 0-1.7-.8-1.7-1.7z", 1.5)),
    pin: svg('<path d="M7.6 2.8h4.8l-.6 5 2.6 2.7v1.2H5.6v-1.2l2.6-2.7z" fill="currentColor"/>' + st("M10 11.8v5.4", 1.6)),
    lock: svg('<rect x="4.2" y="9" width="11.6" height="8.4" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>' + st("M6.8 9V6.6a3.2 3.2 0 0 1 6.4 0V9", 1.5)),
    grid: svg('<g fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="3" width="6" height="6" rx="1.4"/><rect x="11" y="3" width="6" height="6" rx="1.4"/><rect x="3" y="11" width="6" height="6" rx="1.4"/><rect x="11" y="11" width="6" height="6" rx="1.4"/></g>'),
    rows: svg(st("M3.5 5.5h13M3.5 10h13M3.5 14.5h13", 1.6)),
    bold: '<svg viewBox="0 0 20 20" aria-hidden="true"><text x="5" y="15" font-family="-apple-system,Helvetica" font-size="14" font-weight="800" fill="currentColor">B</text></svg>',
  };

  // ======== 窗口骨架（macOS 26）：浮起的圆角玻璃侧边栏（三个灯落在它上面）+ 标题栏里的统一工具栏 ========
  // o: { id, app, name, className, width, height, sideW, title(), menus(), onClose() } → { win, root, side, main, tb }
  // 侧边栏宽度可以拖（右边缘），开 / 关与宽度都记在本机
  K.window = function (o) {
    var pref = K.store.get("tsu-" + o.id + "-side", {}), minW = o.minSide || 180, maxW = o.maxSide || 380;
    var sideW = K.clamp(+pref.w || o.sideW || 220, minW, maxW);
    var root = document.createElement("div");
    root.className = "ma-root";
    root.innerHTML = '<aside class="ma-side"><i class="ma-split"></i></aside><section class="ma-main"></section>';
    var win = D.createWindow({ id: o.id, app: o.app || o.id, name: o.name, className: "mac-app " + (o.className || ""), width: o.width || 1000, height: o.height || 660,
      content: root, title: o.title || function () { return o.name; }, menus: o.menus, appMenu: o.appMenu, onClose: o.onClose });
    var setW = function (w) { sideW = w; win.el.style.setProperty("--ma-side", w + "px"); };
    setW(sideW);
    if (pref.off) win.el.classList.add("ma-noside");
    var save = function () { K.store.set("tsu-" + o.id + "-side", { w: sideW, off: win.el.classList.contains("ma-noside") }); };
    var tb = document.createElement("div");
    tb.className = "ma-tb";
    win.el.querySelector(".bar").appendChild(tb);
    // 工具栏里的控件：按下不拖窗口、连点不缩放；按钮不抢焦点
    tb.addEventListener("pointerdown", function (e) { if (e.target.closest("button, input, label, .ma-seg, [data-tb]")) e.stopPropagation(); });
    tb.addEventListener("dblclick", function (e) { if (e.target.closest("button, input, label, .ma-seg, [data-tb]")) e.stopPropagation(); });
    tb.addEventListener("mousedown", function (e) { if (e.target.closest("button, .ma-seg")) e.preventDefault(); });
    // 点窗口里不能拿焦点的地方（日历的格子、列表的空白）：键盘焦点也跟到这个窗口来，
    // 不然还留在上一个窗口的输入框里（比如终端），按键、打字都跑到那边去
    root.tabIndex = -1;
    win.el.addEventListener("pointerdown", function () {
      setTimeout(function () {
        var a = document.activeElement;
        if (a && (win.el.contains(a) || (a.closest && a.closest(".ma-pop, .menu")))) return;
        root.focus({ preventScroll: true });
      }, 0);
    }, true);
    var side = root.querySelector(".ma-side"), split = side.querySelector(".ma-split");
    split.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      var x0 = e.clientX, w0 = sideW;
      split.setPointerCapture(e.pointerId);
      var move = function (ev) { setW(K.clamp(w0 + ev.clientX - x0, minW, maxW)); if (o.onSideResize) o.onSideResize(sideW); };
      var up = function () { split.removeEventListener("pointermove", move); split.removeEventListener("pointerup", up); save(); };
      split.addEventListener("pointermove", move);
      split.addEventListener("pointerup", up);
    });
    // 窗口窄了（同 macOS）：侧边栏自动收起；这时再点「显示侧边栏」，它浮在内容上面，点别处就收回
    var narrow = false;
    if (o.narrow && window.ResizeObserver) new ResizeObserver(function () {
      var n = win.el.offsetWidth > 0 && win.el.offsetWidth < o.narrow;
      if (n === narrow) return;
      narrow = n;
      win.el.classList.toggle("ma-narrow", n);
      win.el.classList.remove("ma-sideover");
      if (o.onNarrow) o.onNarrow(n);
    }).observe(win.el);
    root.addEventListener("pointerdown", function (e) { if (win.el.classList.contains("ma-sideover") && !side.contains(e.target)) win.el.classList.remove("ma-sideover"); });
    return { win: win, root: root, side: side, main: root.querySelector(".ma-main"), tb: tb,
      narrow: function () { return narrow; },
      sideShown: function () { return narrow ? win.el.classList.contains("ma-sideover") : !win.el.classList.contains("ma-noside"); },
      toggleSide: function (on) {
        if (narrow) { var ov = on === undefined ? !win.el.classList.contains("ma-sideover") : !!on; win.el.classList.toggle("ma-sideover", ov); return ov; }
        var off = on === undefined ? !win.el.classList.contains("ma-noside") : !on;
        win.el.classList.toggle("ma-noside", off);
        save();
        return !off;
      } };
  };
  K.btn = function (name, title, icon, cls) { return '<button class="ma-btn' + (cls ? " " + cls : "") + '" data-b="' + name + '" title="' + K.esc(title) + '" tabindex="-1">' + (icon || K.ICON[name] || "") + "</button>"; };
  K.group = function (html) { return '<span class="ma-grp">' + html + "</span>"; };
  K.searchBox = function (ph) { return '<label class="ma-search">' + K.ICON.search + '<input type="search" placeholder="' + K.esc(ph || "搜索") + '" spellcheck="false"><i class="ma-clear" title="清除">✕</i></label>'; };
  // 开关（同 macOS 的 Switch）
  K.toggle = function (on, key) { return '<span class="ma-switch' + (on ? " on" : "") + '"' + (key ? ' data-k="' + key + '"' : "") + ' role="switch" tabindex="-1"><i></i></span>'; };

  // ======== 浮层：anchor = 元素或 {left, top, right, bottom}；side：right（默认，放不下放左边）/ bottom；点外面 / Esc 关 ========
  var pops = [];
  K.closePops = function () { pops.slice().forEach(function (p) { p.close(); }); };
  K.popover = function (anchor, content, o) {
    o = o || {};
    var pop = document.createElement("div"), arrow = document.createElement("i");
    pop.className = "ma-pop" + (o.className ? " " + o.className : "");
    arrow.className = "ma-pop-arrow";
    pop.appendChild(arrow);
    pop.appendChild(content);
    document.body.appendChild(pop);
    if (!o.stack) K.closePops();
    var api = { el: pop, closed: false }, lastRect = null;
    // 锚点被重画掉了（不在文档里了）：用最后一次量到的位置
    function rectOf() {
      if (anchor && anchor.getBoundingClientRect) { if (anchor.isConnected || !lastRect) lastRect = anchor.getBoundingClientRect(); return lastRect; }
      return anchor;
    }
    api.setAnchor = function (a) { if (a) { anchor = a; api.place(); } };
    api.place = function () {
      var r = rectOf(), w = pop.offsetWidth, h = pop.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, side = o.side || "right", x, y;
      if (side === "bottom" || side === "top") {
        x = K.clamp(r.left + r.width / 2 - w / 2, 8, vw - w - 8);
        var below = r.bottom + 10 + h < vh - 8 || side === "bottom" && r.top - 10 - h < 36;
        y = below ? r.bottom + 10 : r.top - 10 - h;
        pop.dataset.side = below ? "bottom" : "top";
        arrow.style.left = K.clamp(r.left + r.width / 2 - x, 16, w - 16) + "px";
        arrow.style.top = "";
      } else {
        var right = r.right + 12 + w < vw - 8 || r.left - 12 - w < 8;
        x = right ? r.right + 12 : r.left - 12 - w;
        y = K.clamp(r.top + r.height / 2 - h / 2, 36, vh - h - 8);
        pop.dataset.side = right ? "right" : "left";
        arrow.style.top = K.clamp(r.top + r.height / 2 - y, 16, h - 16) + "px";
        arrow.style.left = "";
      }
      pop.style.left = Math.round(x) + "px";
      pop.style.top = Math.round(y) + "px";
    };
    api.close = function () {
      if (api.closed) return;
      api.closed = true;
      pops.splice(pops.indexOf(api), 1);
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", onKey, true);
      pop.classList.add("out");
      setTimeout(function () { pop.remove(); }, 140);
      if (o.onClose) o.onClose();
    };
    function outside(e) {
      if (pop.contains(e.target)) return;
      if (e.target.closest && e.target.closest(".menu, .ma-pop")) return; // 浮层里弹出的菜单、叠在上面的浮层
      if (o.keepOn && o.keepOn(e)) return;
      api.close();
    }
    function onKey(e) { if (e.isComposing || e.keyCode === 229) return; if (e.key === "Escape" && pops[pops.length - 1] === api && !document.querySelector(".menu:not([hidden])")) { e.preventDefault(); e.stopPropagation(); api.close(); } }
    pops.push(api);
    api.place();
    setTimeout(function () { if (!api.closed) { document.addEventListener("pointerdown", outside, true); window.addEventListener("keydown", onKey, true); } }, 0);
    return api;
  };

  // ======== 迷你月历（选日期、日历的侧边栏、日视图）：o: { value, month, onPick(d), marks(d) → 颜色或 true, onMonth(d) } ========
  K.miniMonth = function (o) {
    o = o || {};
    var el = document.createElement("div"), value = o.value ? K.day0(o.value) : null, month = K.day0(o.month || o.value || new Date());
    month.setDate(1);
    el.className = "ma-mini";
    el.addEventListener("mousedown", function (e) { e.preventDefault(); });
    el.addEventListener("click", function (e) {
      var nav = e.target.closest("[data-nav]");
      if (nav) { api.setMonth(K.addMonths(month, +nav.dataset.nav)); if (o.onMonth) o.onMonth(month); return; }
      var d = e.target.closest("[data-d]");
      if (d) { var day = K.parse(d.dataset.d); value = day; if (day.getMonth() !== month.getMonth()) { month = new Date(day.getFullYear(), day.getMonth(), 1); } render(); if (o.onPick) o.onPick(day); }
    });
    function render() {
      var first = K.startOfWeek(month), today = new Date(), html = '<div class="ma-mini-head"><b>' + month.getFullYear() + "年" + (month.getMonth() + 1) + "月</b>" +
        '<span><button data-nav="-1" tabindex="-1">' + K.ICON.left + '</button><button data-nav="1" tabindex="-1">' + K.ICON.right + "</button></span></div><div class=\"ma-mini-grid\">";
      for (var i = 0; i < 7; i++) html += "<i>" + K.WD[(i + K.weekStart()) % 7] + "</i>";
      for (var j = 0; j < 42; j++) {
        var d = K.addDays(first, j), cls = [];
        if (d.getMonth() !== month.getMonth()) cls.push("out");
        if (K.sameDay(d, today)) cls.push("today");
        if (value && K.sameDay(d, value)) cls.push("sel");
        var mk = o.marks ? o.marks(d) : null;
        html += '<span data-d="' + K.ymd(d) + '" class="' + cls.join(" ") + '">' + d.getDate() + (mk ? '<em style="' + (typeof mk === "string" ? "background:" + mk : "") + '"></em>' : "") + "</span>";
      }
      el.innerHTML = html + "</div>";
    }
    var api = {
      el: el, render: render,
      set: function (d) { value = d ? K.day0(d) : null; if (d && (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear())) month = new Date(d.getFullYear(), d.getMonth(), 1); render(); },
      setMonth: function (d) { month = new Date(d.getFullYear(), d.getMonth(), 1); render(); },
      month: function () { return month; },
    };
    render();
    return api;
  };
  // 选日期（和时间）的浮层：o: { value: Date | null, time: 要不要时间, onChange(Date), clear: 有「移除」按钮 }
  K.pickDate = function (anchor, o) {
    var box = document.createElement("div"), cur = o.value ? new Date(o.value) : new Date();
    box.className = "ma-pick";
    var mm = K.miniMonth({ value: cur, onPick: function (d) { cur.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); emit(); } });
    box.appendChild(mm.el);
    var timeIn = null;
    if (o.time) {
      var row = document.createElement("div");
      row.className = "ma-pick-time";
      row.innerHTML = "<span>时间</span>" + K.timeField(K.hm(cur));
      box.appendChild(row);
      timeIn = row.querySelector("input");
      K.bindTime(timeIn, function (h, m) { cur.setHours(h, m, 0, 0); emit(); });
    }
    if (o.clear) {
      var c = document.createElement("button");
      c.className = "ma-link";
      c.textContent = o.clearLabel || "移除日期";
      c.addEventListener("click", function () { pop.close(); if (o.onClear) o.onClear(); });
      box.appendChild(c);
    }
    function emit() { if (o.onChange) o.onChange(new Date(cur)); }
    var pop = K.popover(anchor, box, { side: o.side || "bottom", className: "ma-pop-pick", stack: true });
    return pop;
  };
  // 时间输入框（24 小时制，HH:MM；↑↓ 改 5 分钟；回车 / 离开时生效）
  K.timeField = function (v) { return '<input class="ma-time" value="' + K.esc(v || "09:00") + '" maxlength="5" spellcheck="false" inputmode="numeric">'; };
  K.bindTime = function (input, onSet) {
    var apply = function () {
      var m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(input.value.trim().replace("：", ":"));
      if (!m) { input.classList.add("bad"); return; }
      var h = +m[1], mi = +(m[2] || 0);
      if (h > 23 || mi > 59) { input.classList.add("bad"); return; }
      input.classList.remove("bad");
      input.value = pad(h) + ":" + pad(mi);
      onSet(h, mi);
    };
    input.addEventListener("keydown", function (e) { if (e.isComposing || e.keyCode === 229) return;
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); apply(); input.blur(); }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        var m = /^(\d{1,2}):(\d{2})$/.exec(input.value) || [0, 9, 0], t = (+m[1] * 60 + +m[2] + (e.key === "ArrowUp" ? 5 : -5) + 1440) % 1440;
        input.value = pad(Math.floor(t / 60)) + ":" + pad(t % 60);
        apply();
      }
    });
    input.addEventListener("blur", apply);
  };

  // ======== 定时：每 N 毫秒（页面在后台也照样，提醒要准点）========
  K.every = function (ms, fn) { var id = setInterval(function () { try { fn(); } catch (e) { console.error(e); } }, ms); return function () { clearInterval(id); }; };

  // ======== 右键 / 下拉菜单的小包装 ========
  K.item = function (label, keys, run, o) { return Object.assign({ label: label, keys: keys || "", run: run }, o || {}); };
  K.SEP = { sep: true };
  K.menuAt = function (items, el) { var r = el.getBoundingClientRect(); D.popup(items, { x: r.left, y: r.bottom + 4 }); };

  window.TSU_APPKIT = K;
})();
