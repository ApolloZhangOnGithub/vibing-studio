// office/numbers.js —— 表格：Numbers 的样子、Excel 的网格与习惯
// · 网格画在 canvas 上，只画看得见的格子（上百万行也不卡）；滚动交给一层透明的滚动层（原生的惯性、滚动条）
// · 编辑：直接打字、双击 / F2、公式栏；公式里点格子或用方向键插入引用（彩色框）、函数自动补全与参数提示、F4 切换 $
// · 选择：拖选、⇧ 扩展、⌘ 多选、整行整列、⌘ 方向键跳到数据边缘；填充柄（数列、日期、星期、带编号的文字、公式平移）
// · 拷贝粘贴：系统剪贴板用 TSV + HTML（和 Excel、Numbers、网页表格互通），自己窗口之间带公式和格式；剪切移动
// · 撤销 / 重做（记录每个格子与属性的前后值）、冻结窗格、排序与过滤、插入删除行列、行高列宽（拖动、双击自适应）、隐藏、合并
// · 检查器：单元格（数据格式、填充、边框）、文本（字体、字号、颜色、对齐、换行）、表格（网格线、冻结、标签颜色）、整理（排序、过滤）
(function () {
  "use strict";
  var O = window.TSU_OFFICE, FX = window.TSU_FX, NB = O.nb, D = window.TSU_DESK;
  if (!O || !FX || !NB) return;
  var ui = O.ui, el = O.el, esc = O.esc, it = O.item, SEP = O.SEP;
  var K = NB.K, KR = NB.KR, KC = NB.KC, MAXR = NB.MAXR, MAXC = NB.MAXC;
  var HEAD_H = 22, PT = 1.2, DEF_SZ = 11;
  var FONT = '-apple-system, "PingFang SC", "Helvetica Neue", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  var FONTS = [
    ["", "系统默认"], ["PingFang SC", "苹方"], ["Helvetica Neue", "Helvetica Neue"], ["Arial", "Arial"], ["Calibri", "Calibri"], ["Times New Roman", "Times New Roman"],
    ["Georgia", "Georgia"], ["Menlo", "Menlo"], ["Courier New", "Courier New"], ["Songti SC", "宋体"], ["Kaiti SC", "楷体"], ["Heiti SC", "黑体"],
    ["Microsoft YaHei", "微软雅黑"], ["DengXian", "等线"], ["Avenir Next", "Avenir Next"], ["Futura", "Futura"],
  ];
  var REF_COLORS = ["#1a73e8", "#d93025", "#188038", "#a142f4", "#e8710a", "#12a4af", "#c5221f", "#7627bb"];
  // 函数说明（自动补全、参数提示）
  var FNINFO = {
    SUM: ["数值1, [数值2], …", "求和"], AVERAGE: ["数值1, [数值2], …", "平均值"], MIN: ["数值1, [数值2], …", "最小值"], MAX: ["数值1, [数值2], …", "最大值"],
    COUNT: ["值1, [值2], …", "数字的个数"], COUNTA: ["值1, [值2], …", "非空格子的个数"], COUNTBLANK: ["区域", "空格子的个数"], PRODUCT: ["数值1, [数值2], …", "乘积"],
    IF: ["条件, 为真时, [为假时]", "按条件取值"], IFS: ["条件1, 值1, [条件2, 值2], …", "多个条件，取第一个成立的"], IFERROR: ["值, 出错时的值", "出错时换成别的值"], IFNA: ["值, 为 #N/A 时的值", "#N/A 时换成别的值"],
    AND: ["条件1, [条件2], …", "都成立"], OR: ["条件1, [条件2], …", "任一成立"], NOT: ["条件", "取反"], XOR: ["条件1, [条件2], …", "成立的个数为奇数"],
    SWITCH: ["表达式, 值1, 结果1, …, [默认]", "按值选结果"], CHOOSE: ["序号, 值1, [值2], …", "按序号取值"],
    ROUND: ["数值, 小数位数", "四舍五入"], ROUNDUP: ["数值, 小数位数", "向上舍入"], ROUNDDOWN: ["数值, 小数位数", "向下舍入"], INT: ["数值", "向下取整"], TRUNC: ["数值, [小数位数]", "截尾取整"],
    ABS: ["数值", "绝对值"], MOD: ["被除数, 除数", "余数"], POWER: ["底数, 指数", "乘方"], SQRT: ["数值", "平方根"], SUMPRODUCT: ["数组1, [数组2], …", "对应相乘再求和"],
    CEILING: ["数值, [基数]", "向上舍入到基数的倍数"], FLOOR: ["数值, [基数]", "向下舍入到基数的倍数"], MROUND: ["数值, 基数", "舍入到基数的倍数"],
    VLOOKUP: ["查找值, 表格区域, 列序号, [近似匹配]", "在区域第一列查找，返回同一行第几列的值"], HLOOKUP: ["查找值, 表格区域, 行序号, [近似匹配]", "在区域第一行查找"],
    XLOOKUP: ["查找值, 查找区域, 返回区域, [找不到时], [匹配方式], [搜索方式]", "查找并返回对应的值"], INDEX: ["区域, 行号, [列号]", "区域里某个位置的值"],
    MATCH: ["查找值, 查找区域, [匹配方式]", "查找值在区域里的位置"], XMATCH: ["查找值, 查找区域, [匹配方式], [搜索方式]", "查找值的位置"],
    SUMIF: ["区域, 条件, [求和区域]", "按条件求和"], SUMIFS: ["求和区域, 条件区域1, 条件1, …", "按多个条件求和"], COUNTIF: ["区域, 条件", "按条件计数"], COUNTIFS: ["条件区域1, 条件1, …", "按多个条件计数"],
    AVERAGEIF: ["区域, 条件, [平均区域]", "按条件求平均"], AVERAGEIFS: ["平均区域, 条件区域1, 条件1, …", "按多个条件求平均"], MAXIFS: ["最大值区域, 条件区域1, 条件1, …", "按条件求最大"], MINIFS: ["最小值区域, 条件区域1, 条件1, …", "按条件求最小"],
    TEXT: ["值, 格式代码", "按格式把数字变成文字"], LEN: ["文字", "字数"], LEFT: ["文字, [字数]", "左边几个字"], RIGHT: ["文字, [字数]", "右边几个字"], MID: ["文字, 开始位置, 字数", "中间几个字"],
    UPPER: ["文字", "变大写"], LOWER: ["文字", "变小写"], PROPER: ["文字", "首字母大写"], TRIM: ["文字", "去掉多余的空格"], CONCAT: ["文字1, [文字2], …", "连接文字"], CONCATENATE: ["文字1, [文字2], …", "连接文字"],
    TEXTJOIN: ["分隔符, 忽略空白, 文字1, …", "用分隔符连接"], SUBSTITUTE: ["文字, 旧文字, 新文字, [第几个]", "替换文字"], REPLACE: ["文字, 开始位置, 字数, 新文字", "按位置替换"],
    FIND: ["要找的, 文字, [开始位置]", "位置（区分大小写）"], SEARCH: ["要找的, 文字, [开始位置]", "位置（不区分大小写，可用通配符）"], VALUE: ["文字", "文字转数字"], REPT: ["文字, 次数", "重复"], EXACT: ["文字1, 文字2", "是否完全相同"],
    DATE: ["年, 月, 日", "日期"], TIME: ["时, 分, 秒", "时间"], TODAY: ["", "今天"], NOW: ["", "现在"], YEAR: ["日期", "年"], MONTH: ["日期", "月"], DAY: ["日期", "日"], HOUR: ["时间", "时"], MINUTE: ["时间", "分"], SECOND: ["时间", "秒"],
    WEEKDAY: ["日期, [类型]", "星期几"], WEEKNUM: ["日期, [类型]", "第几周"], EDATE: ["开始日期, 月数", "几个月以后的同一天"], EOMONTH: ["开始日期, 月数", "几个月以后的月底"],
    DATEDIF: ["开始日期, 结束日期, 单位", "相差的年 / 月 / 日（\"Y\" \"M\" \"D\"）"], NETWORKDAYS: ["开始日期, 结束日期, [假日]", "工作日天数"], WORKDAY: ["开始日期, 天数, [假日]", "若干个工作日以后"], DAYS: ["结束日期, 开始日期", "相差天数"],
    MEDIAN: ["数值1, [数值2], …", "中位数"], MODE: ["数值1, [数值2], …", "众数"], STDEV: ["数值1, [数值2], …", "样本标准差"], VAR: ["数值1, [数值2], …", "样本方差"],
    LARGE: ["区域, 第几", "第 k 大"], SMALL: ["区域, 第几", "第 k 小"], RANK: ["数值, 区域, [升序]", "排名"], PERCENTILE: ["区域, 百分点", "百分位数"],
    PMT: ["利率, 期数, 现值, [终值], [类型]", "每期还款额"], FV: ["利率, 期数, 每期付款, [现值], [类型]", "终值"], PV: ["利率, 期数, 每期付款, [终值], [类型]", "现值"], NPV: ["利率, 现金流1, …", "净现值"],
    RAND: ["", "0 到 1 的随机数"], RANDBETWEEN: ["下限, 上限", "随机整数"], ROW: ["[引用]", "行号"], COLUMN: ["[引用]", "列号"], ROWS: ["区域", "行数"], COLUMNS: ["区域", "列数"],
    ISBLANK: ["值", "是否为空"], ISNUMBER: ["值", "是否为数字"], ISTEXT: ["值", "是否为文字"], ISERROR: ["值", "是否为错误"], NA: ["", "#N/A"], TRANSPOSE: ["区域", "转置"],
  };
  var clip = null; // 表格窗口之间共用的剪贴板（带公式、格式）

  // ======== 一个文稿的视图 ========
  function createView(doc, book) {
    var sh = book.sheets[book.active], calc = NB.calcFor(book);
    var zoom = sh.zoom || 1, editing = null, drag = null, copyMark = null, showFormulas = false, inspMode = "format", inspTab = "cell";
    var undoStack = [], redoStack = [], cur = null, rowsN = 200, colsN = 26, rafId = 0, antsT = 0, antsOff = 0;
    var mergeCache = { src: null, map: null, big: [] }, measureCache = new Map();

    // ---- DOM ----
    var root = el("div", "nb");
    root.innerHTML =
      '<div class="nb-tabs"><button type="button" class="nb-addsheet" title="新建工作表">＋</button><div class="nb-tablist"></div></div>' +
      '<div class="nb-fx"><input class="nb-name" spellcheck="false" title="名称框：输入 B3、A1:C9 跳过去"><div class="nb-fxb"><button type="button" data-a="cancel" title="取消">✕</button><button type="button" data-a="ok" title="确定">✓</button><button type="button" data-a="fn" title="插入函数">ƒx</button></div><div class="nb-fxw"><div class="nb-fxhl"></div><textarea class="nb-fxin" rows="1" spellcheck="false" autocomplete="off"></textarea></div></div>' +
      '<div class="nb-find" hidden><input class="ofc-in nb-fq" placeholder="查找" spellcheck="false"><span class="nb-fn"></span><button type="button" class="ofc-btn" data-f="prev">‹</button><button type="button" class="ofc-btn" data-f="next">›</button>' +
      '<input class="ofc-in nb-fr" placeholder="替换为" spellcheck="false"><button type="button" class="ofc-btn" data-f="rep">替换</button><button type="button" class="ofc-btn" data-f="all">全部替换</button>' +
      '<label class="ofc-check"><input type="checkbox" data-f="case"><span>区分大小写</span></label><span class="nb-sp"></span><button type="button" class="ofc-btn" data-f="done">完成</button></div>' +
      '<div class="nb-grid"><canvas class="nb-cv"></canvas><div class="nb-scroll"><div class="nb-space"></div></div>' +
      '<div class="nb-edw"><div class="nb-edhl"></div><textarea class="nb-ed" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"></textarea></div>' +
      '<div class="nb-ac" hidden></div><div class="nb-tip" hidden></div></div>' +
      '<div class="nb-status"><span class="nb-mode">就绪</span><span class="nb-sum"></span></div>';
    var $ = function (s) { return root.querySelector(s); };
    var tabsEl = $(".nb-tablist"), nameBox = $(".nb-name"), fxIn = $(".nb-fxin"), fxHL = $(".nb-fxhl"), gridEl = $(".nb-grid"), cv = $(".nb-cv"), scrollEl = $(".nb-scroll"), space = $(".nb-space");
    var edw = $(".nb-edw"), ed = $(".nb-ed"), edHL = $(".nb-edhl"), acEl = $(".nb-ac"), tipEl = $(".nb-tip"), modeEl = $(".nb-mode"), sumEl = $(".nb-sum"), findEl = $(".nb-find");
    var ctx = cv.getContext("2d");

    // ======== 几何 ========
    function geom() {
      var W = gridEl.clientWidth, H = gridEl.clientHeight, z = zoom;
      var vw = W / z, vh = H / z, digits = String(rowsN).length;
      var hw = Math.max(36, 14 + digits * 7.2), hh = HEAD_H;
      var fr = Math.min(sh.freeze.r || 0, MAXR), fc = Math.min(sh.freeze.c || 0, MAXC);
      return { W: W, H: H, z: z, vw: vw, vh: vh, hw: hw, hh: hh, fr: fr, fc: fc, FW: sh.cols.pos(fc), FH: sh.rows.pos(fr), sx: scrollEl.scrollLeft / z, sy: scrollEl.scrollTop / z };
    }
    // 格子左上角在屏幕上的位置（画布坐标，未乘缩放）
    function sX(c, g) { return g.hw + sh.cols.pos(c) - (c < g.fc ? 0 : g.sx); }
    function sY(r, g) { return g.hh + sh.rows.pos(r) - (r < g.fr ? 0 : g.sy); }
    function updateSpace() {
      var u = NB.used(sh), sel = sh.sel, g = geom();
      var needR = Math.max(u.r + 60, (sel.ranges[sel.ranges.length - 1] || {}).r2 + 30 || 0, 200, sh.freeze.r + 50);
      var needC = Math.max(u.c + 12, (sel.ranges[sel.ranges.length - 1] || {}).c2 + 8 || 0, 26, sh.freeze.c + 10);
      rowsN = Math.min(MAXR, Math.max(rowsN, needR));
      colsN = Math.min(MAXC, Math.max(colsN, needC));
      space.style.width = Math.ceil((g.hw + sh.cols.pos(colsN)) * zoom) + "px";
      space.style.height = Math.ceil((g.hh + sh.rows.pos(rowsN)) * zoom + 2) + "px";
    }
    function fitRows() { rowsN = 200; colsN = 26; updateSpace(); }

    // ======== 值与样式 ========
    function cellAt(s, r, c) { return s.cells.get(K(r, c)); }
    function valueOf(s, r, c) { var cell = s.cells.get(K(r, c)); if (!cell) return null; if (cell.f != null) return calc.get(s.name, r, c); return cell.v; }
    function styleId(s, r, c) {
      var cell = s.cells.get(K(r, c));
      if (cell) return cell.s || 0;
      var rs = s.rowStyle.size ? s.rowStyle.get(r) : null;
      if (rs) return rs;
      return s.colStyle.size ? s.colStyle.get(c) || 0 : 0;
    }
    var styleOf = function (s, r, c) { return book.styles.get(styleId(s, r, c)); };
    function fontOf(st, z) {
      var fam = st.font ? '"' + st.font.replace(/"/g, "") + '", ' + FONT : FONT;
      return (st.i ? "italic " : "") + (st.b ? "600 " : "") + ((st.sz || DEF_SZ) * PT * (z || 1)).toFixed(2) + "px " + fam;
    }
    function measure(text, font) {
      var key = font + "\u0000" + text, w = measureCache.get(key);
      if (w == null) { ctx.font = font; w = ctx.measureText(text).width; if (measureCache.size > 8000) measureCache.clear(); measureCache.set(key, w); }
      return w;
    }
    // 格子里显示的文字：{ text, color, align }
    function display(v, st, cell, width) {
      if (showFormulas && cell && cell.f != null) return { text: "=" + cell.f, align: "left" };
      if (v == null || v === "") return null;
      var res;
      if (FX.isErr(v)) return { text: v.code, align: "center", err: true };
      if (typeof v === "boolean") return { text: v ? "TRUE" : "FALSE", align: "center" };
      if (typeof v === "number") {
        if (!st.nf) {
          var t = FX.formatGeneral(v);
          if (width != null) {
            var font = fontOf(st), avail = width - 6;
            if (measure(t, font) > avail) {
              // 常规格式放不下：少显示几位小数，再不行用科学计数，最后是 ###
              for (var p = 10; p >= 1; p--) {
                var s2 = Math.abs(v) >= 1e11 || Math.abs(v) < 1e-4 && v !== 0 ? v.toExponential(Math.max(0, p - 5)).replace("e+", "E+").replace("e-", "E-") : String(parseFloat(v.toPrecision(p)));
                if (measure(s2, font) <= avail) { t = s2; break; }
                if (p === 1) t = "#".repeat(Math.max(1, Math.floor(avail / measure("#", font))));
              }
            }
          }
          return { text: t, align: "right", num: true };
        }
        res = FX.format(v, st.nf);
        return { text: res.text, color: res.color, align: "right", num: true };
      }
      if (st.nf && st.nf !== "@" && st.nf.indexOf("@") >= 0) { res = FX.format(v, st.nf); return { text: res.text, color: res.color, align: "left" }; }
      return { text: String(v), align: "left", link: cell && cell.link || /^https?:\/\/\S+$/.test(v) };
    }

    // ======== 合并 ========
    function merges() {
      if (mergeCache.src !== sh.merges) {
        var map = new Map(), big = [];
        sh.merges.forEach(function (m) {
          if ((m.r2 - m.r1 + 1) * (m.c2 - m.c1 + 1) > 40000) { big.push(m); return; }
          for (var r = m.r1; r <= m.r2; r++) for (var c = m.c1; c <= m.c2; c++) map.set(K(r, c), m);
        });
        mergeCache = { src: sh.merges, map: map, big: big };
      }
      return mergeCache;
    }
    function mergeAt(r, c) {
      var mc = merges(), m = mc.map.get(K(r, c));
      if (m) return m;
      for (var i = 0; i < mc.big.length; i++) { var b = mc.big[i]; if (r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2) return b; }
      return null;
    }
    function expandMerges(rg) {
      if (!sh.merges.length) return rg;
      var out = { r1: rg.r1, c1: rg.c1, r2: rg.r2, c2: rg.c2 }, changed = true, guard = 0;
      while (changed && guard++ < 50) {
        changed = false;
        sh.merges.forEach(function (m) {
          if (m.r2 < out.r1 || m.r1 > out.r2 || m.c2 < out.c1 || m.c1 > out.c2) return;
          if (m.r1 < out.r1) { out.r1 = m.r1; changed = true; }
          if (m.c1 < out.c1) { out.c1 = m.c1; changed = true; }
          if (m.r2 > out.r2) { out.r2 = m.r2; changed = true; }
          if (m.c2 > out.c2) { out.c2 = m.c2; changed = true; }
        });
      }
      return out;
    }

    // ======== 条件格式（只显示；规则原样存回文件）========
    // 支持：单元格值（大于、介于……）、公式、文本包含 / 开头 / 结尾、空与非空、前 N 项 / 后 N 项、高于 / 低于平均、重复值 / 唯一值、色阶、数据条
    var cfVer = 0, cfState = null;
    function cfRules() {
      if (cfState && cfState.sh === sh && cfState.v === cfVer) return cfState;
      var list = (sh.extra && sh.extra.cf) || [], rules = [];
      list.forEach(function (cf) {
        var ranges = String(cf.ref || "").split(/\s+/).map(NB.parseRange).filter(Boolean);
        (cf.rules || []).forEach(function (rule) { if (ranges.length) rules.push({ ranges: ranges, rule: rule, pri: rule.priority || 0, stats: null }); });
      });
      rules.sort(function (a, b) { return a.pri - b.pri; });
      cfState = { sh: sh, v: cfVer, rules: rules, memo: new Map() };
      return cfState;
    }
    var inRanges = function (rs, r, c) { for (var i = 0; i < rs.length; i++) { var x = rs[i]; if (r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2) return x; } return null; };
    function cfEval(f, r, c) {
      var tree = calc.tree(String(f).replace(/^=/, ""));
      return FX.evaluate(tree, { get: calc.get, used: function (n) { var s2 = NB.sheetByName(book, n); return s2 ? NB.used(s2) : { r: -1, c: -1 }; }, sheet: sh.name, r: r, c: c, sheetExists: function (n) { return !!NB.sheetByName(book, n); } });
    }
    function cfStats(x) {
      if (x.stats) return x.stats;
      var nums = [], counts = new Map(), u = NB.used(sh), seen = 0;
      x.ranges.forEach(function (rg) {
        for (var r = rg.r1; r <= Math.min(rg.r2, u.r); r++) for (var c = rg.c1; c <= Math.min(rg.c2, u.c); c++) {
          if (++seen > 200000) return;
          var v = valueOf(sh, r, c);
          if (typeof v === "number") nums.push(v);
          if (v != null && v !== "") { var k = FX.str(v).toLowerCase(); counts.set(k, (counts.get(k) || 0) + 1); }
        }
      });
      nums.sort(function (a, b) { return a - b; });
      var sum = nums.reduce(function (a, b) { return a + b; }, 0);
      x.stats = { nums: nums, counts: counts, min: nums[0], max: nums[nums.length - 1], avg: nums.length ? sum / nums.length : 0 };
      return x.stats;
    }
    function cfvoValue(o, st, r, c) {
      if (!o) return null;
      var t = o.type, v = o.value;
      if (t === "min") return st.min;
      if (t === "max") return st.max;
      if (t === "num") return +v;
      if (t === "percent") return st.min + (st.max - st.min) * (+v) / 100;
      if (t === "percentile") { var n = st.nums, pos = (n.length - 1) * (+v) / 100, lo = Math.floor(pos); return n.length ? n[lo] + (n[Math.min(n.length - 1, lo + 1)] - n[lo]) * (pos - lo) : 0; }
      if (t === "formula") { var fv = cfEval(v, r, c); return typeof fv === "number" ? fv : null; }
      return null;
    }
    var hexC = function (c) { return NB.xcolor(c) || null; };
    function mix(a, b, t) {
      var p = function (h, i) { return parseInt(h.slice(1 + i * 2, 3 + i * 2), 16); };
      var ch = function (i) { var v = Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16); return v.length < 2 ? "0" + v : v; };
      return "#" + ch(0) + ch(1) + ch(2);
    }
    // 某一格的条件格式结果：{ fill, color, b, i, u, st, bar: { f, color } }
    function cfFor(r, c, v) {
      var S = cfRules();
      if (!S.rules.length) return null;
      var key = K(r, c), hit = S.memo.get(key);
      if (hit !== undefined) return hit;
      var out = null;
      for (var i = 0; i < S.rules.length; i++) {
        var x = S.rules[i], rg = inRanges(x.ranges, r, c);
        if (!rg) continue;
        var rule = x.rule, t = rule.type, ok = false, extra = null;
        try {
          if (t === "cellIs") {
            if (v == null || v === "") { ok = false; } else {
              var shiftF = function (f) { return FX.shift(String(f), r - x.ranges[0].r1, c - x.ranges[0].c1); };
              var a = cfEval(shiftF((rule.formulae || [])[0]), r, c), b = (rule.formulae || [])[1] != null ? cfEval(shiftF(rule.formulae[1]), r, c) : null, cmp = FX.compare(v, a);
              var op = rule.operator;
              ok = op === "greaterThan" ? cmp > 0 : op === "lessThan" ? cmp < 0 : op === "greaterThanOrEqual" ? cmp >= 0 : op === "lessThanOrEqual" ? cmp <= 0 : op === "equal" ? cmp === 0 : op === "notEqual" ? cmp !== 0 :
                op === "between" ? cmp >= 0 && FX.compare(v, b) <= 0 : op === "notBetween" ? cmp < 0 || FX.compare(v, b) > 0 : false;
            }
          } else if (t === "expression") {
            var ev = cfEval(FX.shift(String((rule.formulae || [])[0] || "FALSE"), r - x.ranges[0].r1, c - x.ranges[0].c1), r, c);
            ok = ev === true || typeof ev === "number" && ev !== 0;
          } else if (t === "containsText") {
            var s0 = v == null ? "" : FX.str(v).toLowerCase(), q = String(rule.text || "").toLowerCase(), opx = rule.operator;
            ok = opx === "containsBlanks" ? !s0.trim() : opx === "notContainsBlanks" ? !!s0.trim() : opx === "containsErrors" ? FX.isErr(v) : opx === "notContainsErrors" ? !FX.isErr(v) :
              opx === "beginsWith" ? s0.indexOf(q) === 0 : opx === "endsWith" ? s0.slice(-q.length) === q && !!q : opx === "notContainsText" || opx === "notContains" ? s0.indexOf(q) < 0 : s0.indexOf(q) >= 0;
          } else if (t === "top10" && typeof v === "number") {
            var st = cfStats(x), n = st.nums.length, k = rule.percent ? Math.max(1, Math.floor(n * (rule.rank || 10) / 100)) : (rule.rank || 10);
            ok = rule.bottom ? v <= st.nums[Math.min(n - 1, k - 1)] : v >= st.nums[Math.max(0, n - k)];
          } else if (t === "aboveAverage" && typeof v === "number") {
            var st2 = cfStats(x), above = rule.aboveAverage !== false;
            ok = above ? (rule.equalAverage ? v >= st2.avg : v > st2.avg) : (rule.equalAverage ? v <= st2.avg : v < st2.avg);
          } else if ((t === "duplicateValues" || t === "uniqueValues") && v != null && v !== "") {
            var cnt = cfStats(x).counts.get(FX.str(v).toLowerCase()) || 0;
            ok = t === "duplicateValues" ? cnt > 1 : cnt === 1;
          } else if (t === "colorScale" && typeof v === "number") {
            var st3 = cfStats(x), cf = rule.cfvo || [], cols = (rule.color || []).map(hexC);
            if (cols.length >= 2 && cols.every(Boolean)) {
              var lo = cfvoValue(cf[0], st3, r, c), hi = cfvoValue(cf[cf.length - 1], st3, r, c), col;
              if (cols.length >= 3) { var mid = cfvoValue(cf[1], st3, r, c); col = v <= mid ? mix(cols[0], cols[1], hi === lo || mid === lo ? 0 : Math.max(0, Math.min(1, (v - lo) / (mid - lo)))) : mix(cols[1], cols[2], hi === mid ? 1 : Math.max(0, Math.min(1, (v - mid) / (hi - mid)))); }
              else col = mix(cols[0], cols[1], hi === lo ? 0 : Math.max(0, Math.min(1, (v - lo) / (hi - lo))));
              extra = { fill: col };
              ok = true;
            }
          } else if (t === "dataBar" && typeof v === "number") {
            var st4 = cfStats(x), cf2 = rule.cfvo || [], lo2 = cfvoValue(cf2[0], st4, r, c), hi2 = cfvoValue(cf2[1], st4, r, c);
            if (lo2 == null) lo2 = Math.min(0, st4.min);
            if (hi2 == null) hi2 = st4.max;
            extra = { bar: { f: hi2 === lo2 ? 1 : Math.max(0, Math.min(1, (v - lo2) / (hi2 - lo2))), color: hexC(rule.color) || "#638ec6" } };
            ok = true;
          }
        } catch (e) { ok = false; }
        if (!ok) continue;
        out = out || {};
        var sty = rule.style || {};
        if (extra) Object.keys(extra).forEach(function (k2) { if (out[k2] == null) out[k2] = extra[k2]; });
        if (sty.fill && out.fill == null) { var fc = hexC(sty.fill.bgColor) || hexC(sty.fill.fgColor); if (fc) out.fill = fc; }
        if (sty.font) {
          if (out.color == null && sty.font.color) out.color = hexC(sty.font.color);
          if (out.b == null && sty.font.bold != null) out.b = !!sty.font.bold;
          if (out.i == null && sty.font.italic != null) out.i = !!sty.font.italic;
          if (out.u == null && sty.font.underline) out.u = true;
          if (out.st == null && sty.font.strike) out.st = true;
        }
        if (rule.stopIfTrue) break;
      }
      S.memo.set(key, out);
      return out;
    }

    // ======== 画 ========
    function colors() {
      var dk = O.dark();
      return dk ? { bg: "#1e1e1e", grid: "#343434", text: "#e6e6e6", head: "#262626", headText: "#8e8e93", headLine: "#3a3a3a", headSel: "#23374f", headSelText: "#5aa7ff", acc: "#0a84ff", selFill: "rgba(10,132,255,0.16)", freeze: "#5a5a5a", border: "#d0d0d0", link: "#5aa7ff", err: "#ff6b61", corner: "#2c2c2c", fbtn: "#3a3a3c", fbtnOn: "#0a84ff" }
        : { bg: "#ffffff", grid: "#e2e2e2", text: "#1d1d1f", head: "#f6f6f6", headText: "#8a8a8e", headLine: "#d9d9d9", headSel: "#dfe9f8", headSelText: "#0a64d6", acc: "#0a7aff", selFill: "rgba(10,122,255,0.10)", freeze: "#b8b8b8", border: "#1d1d1f", link: "#0b62d6", err: "#d93025", corner: "#ececec", fbtn: "#ffffff", fbtnOn: "#0a7aff" };
    }
    function paintSoon() { if (!rafId) rafId = requestAnimationFrame(paint); }
    function paint() {
      rafId = 0;
      if (!root.isConnected) return;
      var g = geom(), C = colors(), dpr = window.devicePixelRatio || 1;
      if (!g.W || !g.H) return;
      var pw = Math.round(g.W * dpr), ph = Math.round(g.H * dpr);
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; cv.style.width = g.W + "px"; cv.style.height = g.H + "px"; }
      ctx.setTransform(dpr * g.z, 0, 0, dpr * g.z, 0, 0);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, g.vw, g.vh);
      var quads = [], sc = visCols(g.FW + g.sx, g.vw - g.hw - g.FW), sr = visRows(g.FH + g.sy, g.vh - g.hh - g.FH);
      quads.push({ x0: g.hw + g.FW, y0: g.hh + g.FH, x1: g.vw, y1: g.vh, cs: sc, rs: sr });
      if (g.fc) quads.push({ x0: g.hw, y0: g.hh + g.FH, x1: g.hw + g.FW, y1: g.vh, cs: [0, g.fc - 1], rs: sr });
      if (g.fr) quads.push({ x0: g.hw + g.FW, y0: g.hh, x1: g.vw, y1: g.hh + g.FH, cs: sc, rs: [0, g.fr - 1] });
      if (g.fr && g.fc) quads.push({ x0: g.hw, y0: g.hh, x1: g.hw + g.FW, y1: g.hh + g.FH, cs: [0, g.fc - 1], rs: [0, g.fr - 1] });
      quads.forEach(function (q) { if (q.x1 > q.x0 && q.y1 > q.y0) drawCells(q, g, C); });
      quads.forEach(function (q) { if (q.x1 > q.x0 && q.y1 > q.y0) drawOverlay(q, g, C); });
      drawHeaders(g, C, sc, sr);
      // 冻结线
      ctx.fillStyle = C.freeze;
      if (g.fc) ctx.fillRect(g.hw + g.FW - 0.5, 0, 1 / g.z + 0.5, g.vh);
      if (g.fr) ctx.fillRect(0, g.hh + g.FH - 0.5, g.vw, 1 / g.z + 0.5);
      placeEditor();
    }
    function visCols(x, w) { var a = sh.cols.at(x, MAXC), b = sh.cols.at(x + Math.max(0, w), MAXC); return [a, Math.min(MAXC - 1, b)]; }
    function visRows(y, h) { var a = sh.rows.at(y, MAXR), b = sh.rows.at(y + Math.max(0, h), MAXR); return [a, Math.min(MAXR - 1, b)]; }

    function drawCells(q, g, C) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(q.x0, q.y0, q.x1 - q.x0, q.y1 - q.y0);
      ctx.clip();
      var rows = [], cols = [], r, c, i, j;
      for (r = q.rs[0]; r <= q.rs[1]; r++) if (sh.rows.sz(r) > 0) rows.push(r);
      for (c = q.cs[0]; c <= q.cs[1]; c++) if (sh.cols.sz(c) > 0) cols.push(c);
      var X = cols.map(function (c) { return sX(c, g); }), Y = rows.map(function (r) { return sY(r, g); });
      var Wd = cols.map(function (c) { return sh.cols.sz(c); }), Ht = rows.map(function (r) { return sh.rows.sz(r); });
      var hasM = sh.merges.length > 0, px = 1 / (g.z * (window.devicePixelRatio || 1));
      // 1) 网格线
      if (sh.grid) {
        ctx.fillStyle = C.grid;
        var top = Y.length ? Y[0] : q.y0, bot = Y.length ? Y[Y.length - 1] + Ht[Ht.length - 1] : q.y1, left = X.length ? X[0] : q.x0, right = X.length ? X[X.length - 1] + Wd[Wd.length - 1] : q.x1;
        for (j = 0; j < cols.length; j++) ctx.fillRect(X[j] + Wd[j] - px, top, px, bot - top);
        for (i = 0; i < rows.length; i++) ctx.fillRect(left, Y[i] + Ht[i] - px, right - left, px);
      }
      // 2) 填充（盖住网格线）、3) 文字、4) 边框
      var texts = [], borders = [];
      for (i = 0; i < rows.length; i++) {
        r = rows[i];
        for (j = 0; j < cols.length; j++) {
          c = cols[j];
          var m = hasM ? mergeAt(r, c) : null;
          if (m && (m.r1 !== r || m.c1 !== c)) {
            // 合并区域里别的格子：左上角不在可见范围时由第一个可见的格子代画
            if (!(r === Math.max(m.r1, rows[0]) && c === Math.max(m.c1, cols[0]))) continue;
          }
          var cell = sh.cells.get(K(r, c)), sid = cell ? cell.s || 0 : styleId(sh, r, c), st = book.styles.get(sid);
          var x = X[j], y = Y[i], w = Wd[j], h = Ht[i];
          var mr = r, mc = c;
          if (m) {
            mr = m.r1; mc = m.c1;
            cell = sh.cells.get(K(mr, mc)); st = book.styles.get(cell ? cell.s || 0 : styleId(sh, mr, mc));
            x = sX(m.c1, g); y = sY(m.r1, g);
            w = sh.cols.pos(m.c2 + 1) - sh.cols.pos(m.c1); h = sh.rows.pos(m.r2 + 1) - sh.rows.pos(m.r1);
            ctx.fillStyle = st.fill || C.bg;
            ctx.fillRect(x, y, w - px, h - px);
          }
          var cfx = cell && sh.extra && sh.extra.cf ? cfFor(mr, mc, cell.f != null ? calc.get(sh.name, mr, mc) : cell.v) : null;
          if (cfx) {
            st = Object.assign({}, st);
            if (cfx.fill) st.fill = cfx.fill;
            if (cfx.color) st.color = cfx.color;
            if (cfx.b != null) st.b = cfx.b;
            if (cfx.i != null) st.i = cfx.i;
            if (cfx.u) st.u = 1;
            if (cfx.st) st.st = 1;
          }
          if (!m && st.fill) { ctx.fillStyle = st.fill; ctx.fillRect(x - px, y - px, w + px, h + px); }
          if (m && cfx && cfx.fill) { ctx.fillStyle = cfx.fill; ctx.fillRect(x, y, w - px, h - px); }
          if (cfx && cfx.bar) {
            var bw = Math.max(0, (w - 4) * cfx.bar.f), grd = ctx.createLinearGradient(x + 2, 0, x + 2 + Math.max(1, bw), 0);
            grd.addColorStop(0, cfx.bar.color);
            grd.addColorStop(1, cfx.bar.color + "22");
            ctx.fillStyle = grd;
            ctx.fillRect(x + 2, y + 3, bw, h - 6 - px);
          }
          if (st.bt || st.bb || st.bl || st.br) borders.push([x, y, w, h, st]);
          if (!cell) continue;
          var v = cell ? (cell.f != null ? calc.get(sh.name, mr, mc) : cell.v) : null;
          var dv = display(v, st, cell, w);
          if (!dv) continue;
          texts.push({ r: mr, c: mc, x: x, y: y, w: w, h: h, st: st, dv: dv, merged: !!m, j: j });
        }
      }
      // 文字：向右（左）溢出到空格子里
      texts.forEach(function (t) {
        var st = t.st, font = fontOf(st), text = t.dv.text, align = st.ha || t.dv.align, pad = 3 + (st.ind || 0) * 8;
        ctx.font = font;
        ctx.fillStyle = t.dv.err ? C.err : t.dv.color || (t.dv.link ? C.link : st.color && !(O.dark() && isBlack(st.color) && !st.fill) ? st.color : autoText(st, C));
        if (st.wrap && !t.dv.num) { drawWrapped(t, font, align, pad); return; }
        if (text.indexOf("\n") >= 0) text = text.replace(/\r?\n/g, " ");
        var tw = measure(text, font), cx0 = t.x, cx1 = t.x + t.w;
        if (tw > t.w - pad * 2 && !t.dv.num && !t.merged) {
          // 溢出：左对齐往右、右对齐往左、居中两边，碰到有内容的格子为止
          var need = tw + pad * 2, cc;
          if (align === "left" || align === "justify") { cc = t.c + 1; while (cx1 - cx0 < need && cc < MAXC && isEmpty(t.r, cc)) { cx1 += sh.cols.sz(cc); cc++; } }
          else if (align === "right") { cc = t.c - 1; while (cx1 - cx0 < need && cc >= 0 && isEmpty(t.r, cc)) { cx0 -= sh.cols.sz(cc); cc--; } }
          else { var l = t.c - 1, rr = t.c + 1; while (cx1 - cx0 < need && ((l >= 0 && isEmpty(t.r, l)) || (rr < MAXC && isEmpty(t.r, rr)))) { if (l >= 0 && isEmpty(t.r, l)) { cx0 -= sh.cols.sz(l); l--; } if (rr < MAXC && isEmpty(t.r, rr)) { cx1 += sh.cols.sz(rr); rr++; } } }
          // 溢出进来的地方把网格线盖掉
          if (cx0 < t.x || cx1 > t.x + t.w) { ctx.fillStyle = C.bg; if (cx1 > t.x + t.w) ctx.fillRect(t.x + t.w - 2, t.y, cx1 - (t.x + t.w) + 1, t.h - px); if (cx0 < t.x) ctx.fillRect(cx0, t.y, t.x - cx0 + 1, t.h - px); ctx.fillStyle = t.dv.color || (st.color && !(O.dark() && isBlack(st.color)) ? st.color : autoText(st, C)); }
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx0, t.y, cx1 - cx0, t.h);
        ctx.clip();
        var y = vpos(st, t.y, t.h), x;
        ctx.textBaseline = st.va === "top" ? "top" : st.va === "middle" ? "middle" : "alphabetic";
        if (align === "right") { ctx.textAlign = "right"; x = t.x + t.w - pad; }
        else if (align === "center") { ctx.textAlign = "center"; x = t.x + t.w / 2; }
        else { ctx.textAlign = "left"; x = t.x + pad; }
        ctx.fillText(text, x, y);
        if (st.u || st.st || t.dv.link) {
          var lx = align === "right" ? x - tw : align === "center" ? x - tw / 2 : x, sz = (st.sz || DEF_SZ) * PT;
          var base = ctx.textBaseline === "alphabetic" ? y : ctx.textBaseline === "top" ? y + sz * 0.9 : y + sz * 0.35;
          ctx.fillRect(lx, st.st ? base - sz * 0.32 : base + 1.5, tw, Math.max(0.8, sz / 14));
          if (st.u && st.st) ctx.fillRect(lx, base + 1.5, tw, Math.max(0.8, sz / 14));
        }
        ctx.restore();
      });
      // 边框
      borders.forEach(function (b) { drawBorder(b[0], b[1], b[2], b[3], b[4], C, px); });
      // 过滤按钮
      if (sh.filter) {
        var f = sh.filter;
        if (f.r1 >= q.rs[0] && f.r1 <= q.rs[1]) {
          for (c = Math.max(f.c1, q.cs[0]); c <= Math.min(f.c2, q.cs[1]); c++) {
            if (!sh.cols.sz(c)) continue;
            var bx = sX(c + 1, g) - 17, by = sY(f.r1, g) + (sh.rows.sz(f.r1) - 15) / 2, on = f.cols && f.cols[c];
            ctx.fillStyle = on ? C.fbtnOn : C.fbtn;
            roundRect(bx, by, 15, 15, 3.5);
            ctx.fill();
            ctx.strokeStyle = on ? C.fbtnOn : C.headLine;
            ctx.lineWidth = px;
            ctx.stroke();
            ctx.fillStyle = on ? "#fff" : C.headText;
            ctx.beginPath();
            if (on) { ctx.moveTo(bx + 3.5, by + 4); ctx.lineTo(bx + 11.5, by + 4); ctx.lineTo(bx + 8.5, by + 8); ctx.lineTo(bx + 8.5, by + 11.5); ctx.lineTo(bx + 6.5, by + 12); ctx.lineTo(bx + 6.5, by + 8); }
            else { ctx.moveTo(bx + 4, by + 6); ctx.lineTo(bx + 11, by + 6); ctx.lineTo(bx + 7.5, by + 10); }
            ctx.closePath();
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }
    // 自动的文字颜色：深色外观里，浅色填充的格子上用深色字（不然看不清）
    function autoText(st, C) { return O.dark() && st.fill && NB_lum(st.fill) > 0.55 ? "#1d1d1f" : C.text; }
    function NB_lum(hx) { var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hx || ""); if (!m) return 0; return (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255; }
    function isBlack(c) { return /^#0{6}$/i.test(c) || /^#(1[0-9a-f]){3}$/i.test(c); }
    function isEmpty(r, c) { var cell = sh.cells.get(K(r, c)); if (!cell) return true; if (cell.f != null) { var v = calc.get(sh.name, r, c); return v == null || v === ""; } return cell.v == null || cell.v === ""; }
    function vpos(st, y, h) {
      var sz = (st.sz || DEF_SZ) * PT;
      if (st.va === "top") return y + 3;
      if (st.va === "middle") return y + h / 2 + 0.5;
      return y + h - Math.max(4, sz * 0.3);
    }
    function drawWrapped(t, font, align, pad) {
      var st = t.st, sz = (st.sz || DEF_SZ) * PT, lh = sz * 1.28, lines = wrapText(t.dv.text, font, Math.max(8, t.w - pad * 2));
      var total = lines.length * lh, y0 = st.va === "top" ? t.y + 3 : st.va === "middle" ? t.y + (t.h - total) / 2 : t.y + t.h - total - 3;
      ctx.save();
      ctx.beginPath();
      ctx.rect(t.x, t.y, t.w, t.h);
      ctx.clip();
      ctx.textBaseline = "middle";
      ctx.textAlign = align === "right" ? "right" : align === "center" ? "center" : "left";
      var x = align === "right" ? t.x + t.w - pad : align === "center" ? t.x + t.w / 2 : t.x + pad;
      lines.forEach(function (ln, i) { ctx.fillText(ln, x, y0 + lh * i + lh / 2); });
      ctx.restore();
    }
    var wrapCache = new Map();
    function wrapText(text, font, width) {
      var key = font + "\u0000" + width + "\u0000" + text, hit = wrapCache.get(key);
      if (hit) return hit;
      var out = [];
      String(text).split(/\r?\n/).forEach(function (para) {
        if (!para) { out.push(""); return; }
        // 按词断行（中日韩文字每个字都能断）
        var toks = para.match(/[⺀-鿿豈-﫿＀-￯]|[^\s⺀-鿿豈-﫿＀-￯]+|\s+/g) || [para], line = "";
        toks.forEach(function (tk) {
          var test = line + tk;
          if (measure(test, font) <= width || !line) {
            if (!line && measure(tk, font) > width && tk.length > 1) {
              // 一个词本身太长：硬断
              var part = "";
              for (var k = 0; k < tk.length; k++) { if (measure(part + tk[k], font) > width && part) { out.push(part); part = ""; } part += tk[k]; }
              line = part;
            } else line = test;
          } else { out.push(line.replace(/\s+$/, "")); line = /^\s+$/.test(tk) ? "" : tk; }
        });
        out.push(line);
      });
      if (wrapCache.size > 3000) wrapCache.clear();
      wrapCache.set(key, out);
      return out;
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    function drawBorder(x, y, w, h, st, C, px) {
      var edge = function (b, x1, y1, x2, y2) {
        if (!b) return;
        var lw = b.s === "medium" || b.s === "mediumDashed" || b.s === "mediumDashDot" || b.s === "mediumDashDotDot" ? 2 : b.s === "thick" ? 3 : b.s === "hair" ? 0.5 : 1;
        var col = b.c && !(O.dark() && isBlack(b.c)) ? b.c : C.border;
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.setLineDash(/dash/i.test(b.s) ? [4, 2] : b.s === "dotted" || b.s === "hair" ? [1, 1.5] : []);
        ctx.beginPath();
        if (b.s === "double") {
          ctx.lineWidth = 0.8;
          var dx = y1 === y2 ? 0 : 1.2, dy = y1 === y2 ? 1.2 : 0;
          ctx.moveTo(x1 - dx, y1 - dy); ctx.lineTo(x2 - dx, y2 - dy); ctx.moveTo(x1 + dx, y1 + dy); ctx.lineTo(x2 + dx, y2 + dy);
        } else { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
        ctx.stroke();
      };
      var r = x + w - px / 2, b = y + h - px / 2, l = x - px / 2, t = y - px / 2;
      edge(st.bt, l, t, r, t);
      edge(st.bb, l, b, r, b);
      edge(st.bl, l, t, l, b);
      edge(st.br, r, t, r, b);
      ctx.setLineDash([]);
    }
    // 选区、公式引用框、复制框、填充柄
    function rectOf(rg, g) {
      var x1 = sX(rg.c1, g), y1 = sY(rg.r1, g);
      // 跨冻结线的区域：起点在冻结区、终点在滚动区——按各自的位置算
      var x2 = sX(rg.c2, g) + sh.cols.sz(rg.c2), y2 = sY(rg.r2, g) + sh.rows.sz(rg.r2);
      if (rg.c1 < g.fc && rg.c2 >= g.fc) x2 = Math.max(x2, g.hw + g.FW);
      if (rg.r1 < g.fr && rg.r2 >= g.fr) y2 = Math.max(y2, g.hh + g.FH);
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    function drawOverlay(q, g, C) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(q.x0, q.y0, q.x1 - q.x0, q.y1 - q.y0);
      ctx.clip();
      var sel = sh.sel, px = 1 / g.z;
      // 公式里的引用
      if (editing && editing.formula) {
        refsInEdit().forEach(function (rf) {
          if (!rf.onSheet) return;
          var rc = rectOf(rf.rg, g);
          ctx.fillStyle = rf.color + "1f";
          ctx.fillRect(rc.x, rc.y, rc.w, rc.h);
          ctx.strokeStyle = rf.color;
          ctx.lineWidth = 2 * px;
          ctx.setLineDash(rf.active ? [4 * px, 2 * px] : []);
          ctx.strokeRect(rc.x + px, rc.y + px, rc.w - 2 * px, rc.h - 2 * px);
          ctx.setLineDash([]);
        });
      }
      if (!editing || editing.sheet === sh) {
        var multi = sel.ranges.length > 1 || sel.ranges.some(function (x) { return x.r1 !== x.r2 || x.c1 !== x.c2; });
        sel.ranges.forEach(function (rg0) {
          var rg = expandMerges(rg0), rc = rectOf(rg, g);
          if (multi) {
            ctx.fillStyle = C.selFill;
            ctx.fillRect(rc.x, rc.y, rc.w, rc.h);
          }
          ctx.strokeStyle = C.acc;
          ctx.lineWidth = (sel.ranges.length > 1 ? 1 : 2) * px * (sel.ranges.length > 1 ? 1 : 1);
          ctx.strokeRect(rc.x + px / 2, rc.y + px / 2, rc.w - px, rc.h - px);
        });
        // 活动格：不填底色，粗框
        var am = mergeAt(sel.r, sel.c) || { r1: sel.r, c1: sel.c, r2: sel.r, c2: sel.c }, ar = rectOf(am, g);
        if (multi) {
          // 活动格里把选区的底色擦掉（重画这一格）
          ctx.save();
          ctx.beginPath();
          ctx.rect(ar.x + px, ar.y + px, ar.w - 2 * px, ar.h - 2 * px);
          ctx.clip();
          var qq = { x0: ar.x, y0: ar.y, x1: ar.x + ar.w, y1: ar.y + ar.h, cs: [am.c1, am.c2], rs: [am.r1, am.r2] };
          ctx.fillStyle = C.bg;
          ctx.fillRect(ar.x, ar.y, ar.w, ar.h);
          ctx.restore();
          drawCells(Object.assign(qq, { x0: Math.max(q.x0, ar.x + px), y0: Math.max(q.y0, ar.y + px), x1: Math.min(q.x1, ar.x + ar.w - px), y1: Math.min(q.y1, ar.y + ar.h - px) }), g, C);
        }
        ctx.strokeStyle = C.acc;
        ctx.lineWidth = 2 * px;
        ctx.strokeRect(ar.x + px, ar.y + px, ar.w - 2 * px, ar.h - 2 * px);
        // 填充柄
        if (!editing && sel.ranges.length === 1) {
          var last = expandMerges(sel.ranges[0]), lr = rectOf(last, g);
          ctx.fillStyle = C.bg;
          ctx.fillRect(lr.x + lr.w - 4.5 * px - 2.5, lr.y + lr.h - 4.5 * px - 2.5, 7 + 2 * px, 7 + 2 * px);
          ctx.fillStyle = C.acc;
          ctx.fillRect(lr.x + lr.w - 3.5 * px - 2.5, lr.y + lr.h - 3.5 * px - 2.5, 7, 7);
        }
      }
      // 填充预览
      if (drag && drag.kind === "fill" && drag.dst) {
        var fr = rectOf(drag.dst, g);
        ctx.strokeStyle = O.dark() ? "#aaa" : "#666";
        ctx.lineWidth = px;
        ctx.setLineDash([3 * px, 2 * px]);
        ctx.strokeRect(fr.x + px / 2, fr.y + px / 2, fr.w - px, fr.h - px);
        ctx.setLineDash([]);
      }
      // 复制框（行进的蚂蚁线）
      if (copyMark && copyMark.sheet === sh) {
        var cr = rectOf(copyMark, g);
        ctx.strokeStyle = C.acc;
        ctx.lineWidth = 1.5 * px;
        ctx.setLineDash([4 * px, 3 * px]);
        ctx.lineDashOffset = -antsOff * px;
        ctx.strokeRect(cr.x + px, cr.y + px, cr.w - 2 * px, cr.h - 2 * px);
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
      ctx.restore();
    }
    function drawHeaders(g, C, sc, sr) {
      var sel = sh.sel, px = 1 / (g.z * (window.devicePixelRatio || 1));
      var colSel = function (c) { return sel.ranges.some(function (x) { return c >= x.c1 && c <= x.c2; }); };
      var rowSel = function (r) { return sel.ranges.some(function (x) { return r >= x.r1 && r <= x.r2; }); };
      var fullCol = function (c) { return sel.ranges.some(function (x) { return c >= x.c1 && c <= x.c2 && x.r1 === 0 && x.r2 >= MAXR - 1; }); };
      var fullRow = function (r) { return sel.ranges.some(function (x) { return r >= x.r1 && r <= x.r2 && x.c1 === 0 && x.c2 >= MAXC - 1; }); };
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.font = "500 " + (11 * PT * 0.95).toFixed(1) + "px " + FONT;
      // 列标
      var drawCol = function (c0, c1, clipX0, clipX1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(clipX0, 0, clipX1 - clipX0, g.hh);
        ctx.clip();
        for (var c = c0; c <= c1; c++) {
          var w = sh.cols.sz(c);
          if (!w) continue;
          var x = sX(c, g), on = colSel(c), full = fullCol(c);
          ctx.fillStyle = full ? C.acc : on ? C.headSel : C.head;
          ctx.fillRect(x, 0, w, g.hh);
          ctx.fillStyle = C.headLine;
          ctx.fillRect(x + w - px, 3, px, g.hh - 6);
          ctx.fillStyle = full ? "#fff" : on ? C.headSelText : C.headText;
          if (w > 14) ctx.fillText(FX.colName(c), x + w / 2, g.hh / 2 + 0.5);
          // 隐藏的列：边上画一小道
          if (c > 0 && sh.cols.isHidden(c - 1)) { ctx.fillStyle = C.acc; ctx.fillRect(x - 1, 4, 2 * px + 1, g.hh - 8); }
        }
        ctx.restore();
      };
      ctx.fillStyle = C.head;
      ctx.fillRect(g.hw, 0, g.vw - g.hw, g.hh);
      drawCol(sc[0], sc[1], g.hw + g.FW, g.vw);
      if (g.fc) drawCol(0, g.fc - 1, g.hw, g.hw + g.FW);
      // 行号
      var drawRow = function (r0, r1, clipY0, clipY1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, clipY0, g.hw, clipY1 - clipY0);
        ctx.clip();
        for (var r = r0; r <= r1; r++) {
          var h = sh.rows.sz(r);
          if (!h) continue;
          var y = sY(r, g), on = rowSel(r), full = fullRow(r);
          ctx.fillStyle = full ? C.acc : on ? C.headSel : C.head;
          ctx.fillRect(0, y, g.hw, h);
          ctx.fillStyle = C.headLine;
          ctx.fillRect(4, y + h - px, g.hw - 8, px);
          ctx.fillStyle = full ? "#fff" : on ? C.headSelText : sh.rows.fhidden.size && sh.filter && r > sh.filter.r1 && r <= sh.filter.r2 ? C.acc : C.headText;
          if (h > 9) ctx.fillText(String(r + 1), g.hw / 2, y + h / 2 + 0.5);
          if (r > 0 && sh.rows.hidden.has(r - 1)) { ctx.fillStyle = C.acc; ctx.fillRect(4, y - 1, g.hw - 8, 2 * px + 1); }
        }
        ctx.restore();
      };
      ctx.fillStyle = C.head;
      ctx.fillRect(0, g.hh, g.hw, g.vh - g.hh);
      drawRow(sr[0], sr[1], g.hh + g.FH, g.vh);
      if (g.fr) drawRow(0, g.fr - 1, g.hh, g.hh + g.FH);
      // 表头与内容之间的线、角落
      ctx.fillStyle = C.headLine;
      ctx.fillRect(g.hw, g.hh - px, g.vw - g.hw, px);
      ctx.fillRect(g.hw - px, g.hh, px, g.vh - g.hh);
      ctx.fillStyle = C.corner;
      ctx.fillRect(0, 0, g.hw, g.hh);
      ctx.fillStyle = C.headLine;
      ctx.fillRect(g.hw - px, 0, px, g.hh);
      ctx.fillRect(0, g.hh - px, g.hw, px);
      ctx.fillStyle = C.headText;
      ctx.beginPath();
      ctx.moveTo(g.hw - 5, g.hh - 12);
      ctx.lineTo(g.hw - 5, g.hh - 5);
      ctx.lineTo(g.hw - 12, g.hh - 5);
      ctx.closePath();
      ctx.fill();
    }

    // ======== 点中了什么 ========
    function hit(clientX, clientY) {
      var rc = gridEl.getBoundingClientRect(), g = geom(), x = (clientX - rc.left) / g.z, y = (clientY - rc.top) / g.z;
      var res = { x: x, y: y, g: g };
      var colAtX = function (xx) { var cx = xx - g.hw; return cx < g.FW ? sh.cols.at(cx, MAXC) : sh.cols.at(cx + g.sx, MAXC); };
      var rowAtY = function (yy) { var cy = yy - g.hh; return cy < g.FH ? sh.rows.at(cy, MAXR) : sh.rows.at(cy + g.sy, MAXR); };
      res.c = colAtX(Math.max(g.hw, x));
      res.r = rowAtY(Math.max(g.hh, y));
      if (x < g.hw && y < g.hh) res.area = "corner";
      else if (y < g.hh) {
        res.area = "colhead";
        // 列边界（拉宽窄）：离右边 4 像素以内；离左边 4 像素以内算前一列
        var xr = sX(res.c, g) + sh.cols.sz(res.c);
        if (Math.abs(x - xr) <= 4 / g.z + 1) res.edge = res.c;
        else if (Math.abs(x - sX(res.c, g)) <= 4 / g.z + 1 && res.c > 0) { var pc = res.c - 1; while (pc > 0 && !sh.cols.sz(pc)) pc--; res.edge = pc; }
      } else if (x < g.hw) {
        res.area = "rowhead";
        var yb = sY(res.r, g) + sh.rows.sz(res.r);
        if (Math.abs(y - yb) <= 3 / g.z + 1) res.edge = res.r;
        else if (Math.abs(y - sY(res.r, g)) <= 3 / g.z + 1 && res.r > 0) { var pr = res.r - 1; while (pr > 0 && !sh.rows.sz(pr)) pr--; res.edge = pr; }
      } else {
        res.area = "cell";
        var sel = sh.sel;
        if (sel.ranges.length === 1 && !editing) {
          var last = expandMerges(sel.ranges[0]), lr = rectOf(last, g);
          if (Math.abs(x - (lr.x + lr.w - 1)) <= 5 && Math.abs(y - (lr.y + lr.h - 1)) <= 5) res.handle = true;
        }
        if (sh.filter && res.r === sh.filter.r1 && res.c >= sh.filter.c1 && res.c <= sh.filter.c2) {
          var bx = sX(res.c + 1, g) - 17, by = sY(sh.filter.r1, g) + (sh.rows.sz(sh.filter.r1) - 15) / 2;
          if (x >= bx - 1 && x <= bx + 16 && y >= by - 1 && y <= by + 16) res.filterBtn = res.c;
        }
      }
      return res;
    }

    // ======== 选择 ========
    function curRange() { var s = sh.sel; return s.ranges[s.ranges.length - 1]; }
    function setSel(r, c, r2, c2, add) {
      tabAnchor = null;
      r = clampR(r); c = clampC(c);
      var rg = { r1: Math.min(r, r2 == null ? r : r2), c1: Math.min(c, c2 == null ? c : c2), r2: Math.max(r, r2 == null ? r : r2), c2: Math.max(c, c2 == null ? c : c2) };
      rg = expandMerges(rg);
      if (add) sh.sel.ranges.push(rg); else sh.sel.ranges = [rg];
      sh.sel.r = r;
      sh.sel.c = c;
      sh.sel.er = r2 == null ? r : r2;
      sh.sel.ec = c2 == null ? c : c2;
      selChanged();
    }
    function extendTo(r, c) {
      var s = sh.sel, rg = { r1: Math.min(s.r, r), c1: Math.min(s.c, c), r2: Math.max(s.r, r), c2: Math.max(s.c, c) };
      s.ranges[s.ranges.length - 1] = expandMerges(rg);
      s.er = r;
      s.ec = c;
      selChanged();
    }
    var clampR = function (r) { return Math.max(0, Math.min(MAXR - 1, r)); }, clampC = function (c) { return Math.max(0, Math.min(MAXC - 1, c)); };
    var selT = 0;
    function selChanged() {
      updateSpace();
      paintSoon();
      updateNameBox();
      if (!editing) showFx();
      clearTimeout(selT);
      kindOverride = null;
      selT = setTimeout(function () { updateStatus(); syncInspector(); doc.refresh(); }, 60);
    }
    function ensureVisible(r, c) {
      var g = geom(), z = g.z;
      if (c >= g.fc) {
        var x0 = sh.cols.pos(c), x1 = x0 + sh.cols.sz(c), viewW = g.vw - g.hw - g.FW, left = g.FW + g.sx;
        if (x0 < left) scrollEl.scrollLeft = (x0 - g.FW) * z;
        else if (x1 > left + viewW) scrollEl.scrollLeft = Math.min((x1 - g.FW - viewW) * z, (x0 - g.FW) * z);
      }
      if (r >= g.fr) {
        var y0 = sh.rows.pos(r), y1 = y0 + sh.rows.sz(r), viewH = g.vh - g.hh - g.FH, top = g.FH + g.sy;
        if (y0 < top) scrollEl.scrollTop = (y0 - g.FH) * z;
        else if (y1 > top + viewH) scrollEl.scrollTop = Math.min((y1 - g.FH - viewH) * z, (y0 - g.FH) * z);
      }
    }
    // 下一个看得见的行 / 列
    function stepR(r, d) { var n = r; do { n += d; } while (n >= 0 && n < MAXR && !sh.rows.sz(n)); return n < 0 || n >= MAXR ? r : n; }
    function stepC(c, d) { var n = c; do { n += d; } while (n >= 0 && n < MAXC && !sh.cols.sz(n)); return n < 0 || n >= MAXC ? c : n; }
    // ⌘ 方向键：跳到数据块的边缘（同 Excel）
    function jump(r, c, dr, dc) {
      var filled = function (rr, cc) { return !isEmpty(rr, cc); }, u = NB.used(sh);
      var nr = r, nc = c, lim = dr ? (dr > 0 ? Math.max(u.r, r) + 1 : 0) : (dc > 0 ? Math.max(u.c, c) + 1 : 0);
      var next = function () { return dr ? stepR(nr, dr) : stepC(nc, dc); };
      var n1 = next(); if (dr ? n1 === nr : n1 === nc) return { r: nr, c: nc };
      var here = filled(r, c), nx = dr ? filled(n1, c) : filled(r, n1);
      if (here && nx) {
        while (true) { var t = next(); if (dr ? t === nr : t === nc) break; if (!(dr ? filled(t, c) : filled(r, t))) break; if (dr) nr = t; else nc = t; }
        return { r: nr, c: nc };
      }
      while (true) {
        var t2 = next();
        if (dr ? t2 === nr : t2 === nc) break;
        if (dr) nr = t2; else nc = t2;
        if (dr ? filled(nr, c) : filled(r, nc)) return { r: nr, c: nc };
        if (dr > 0 && nr > lim || dc > 0 && nc > lim) return { r: dr > 0 ? MAXR - 1 : nr, c: dc > 0 ? MAXC - 1 : nc };
      }
      return { r: nr, c: nc };
    }
    function move(dr, dc, extend, toEdge) {
      var s = sh.sel, r = extend ? s.er : s.r, c = extend ? s.ec : s.c;
      if (!extend) { var m = mergeAt(r, c); if (m) { if (dr > 0) r = m.r2; if (dc > 0) c = m.c2; if (dr < 0) r = m.r1; if (dc < 0) c = m.c1; } }
      var t;
      if (toEdge) t = jump(r, c, dr, dc);
      else t = { r: dr ? stepR(r, dr) : r, c: dc ? stepC(c, dc) : c };
      if (extend) extendTo(t.r, t.c);
      else { var m2 = mergeAt(t.r, t.c); if (m2) t = { r: m2.r1, c: m2.c1 }; setSel(t.r, t.c); }
      ensureVisible(t.r, t.c);
    }
    // 回车 / Tab 在选区里走（选区只有一格时就是往下 / 往右）
    function moveInSel(dr, dc) {
      var s = sh.sel, rg = curRange();
      if (s.ranges.length === 1 && rg.r1 === rg.r2 && rg.c1 === rg.c2 || !rg) return move(dr, dc);
      var r = s.r + dr, c = s.c + dc;
      if (r > rg.r2) { r = rg.r1; c++; if (c > rg.c2) c = rg.c1; }
      if (r < rg.r1) { r = rg.r2; c--; if (c < rg.c1) c = rg.c2; }
      if (c > rg.c2) { c = rg.c1; r++; if (r > rg.r2) r = rg.r1; }
      if (c < rg.c1) { c = rg.c2; r--; if (r < rg.r1) r = rg.r2; }
      s.r = r;
      s.c = c;
      ensureVisible(r, c);
      selChanged();
    }
    function selectAll() { sh.sel.ranges = [{ r1: 0, c1: 0, r2: MAXR - 1, c2: MAXC - 1 }]; sh.sel.er = MAXR - 1; sh.sel.ec = MAXC - 1; selChanged(); }
    function selRanges() { return sh.sel.ranges.map(function (x) { return { r1: x.r1, c1: x.c1, r2: x.r2, c2: x.c2 }; }); }
    // 选区限在有内容的范围里（整列、整行不用走一百万行）
    function clipToUsed(rg) { var u = NB.used(sh); return { r1: rg.r1, c1: rg.c1, r2: Math.min(rg.r2, Math.max(u.r, rg.r1)), c2: Math.min(rg.c2, Math.max(u.c, rg.c1)) }; }
    function rangeText(rg) {
      if (rg.r1 === 0 && rg.r2 >= MAXR - 1 && rg.c1 === 0 && rg.c2 >= MAXC - 1) return "全部";
      if (rg.r1 === 0 && rg.r2 >= MAXR - 1) return FX.colName(rg.c1) + ":" + FX.colName(rg.c2);
      if (rg.c1 === 0 && rg.c2 >= MAXC - 1) return (rg.r1 + 1) + ":" + (rg.r2 + 1);
      return FX.addr(rg.r1, rg.c1) + (rg.r1 === rg.r2 && rg.c1 === rg.c2 ? "" : ":" + FX.addr(rg.r2, rg.c2));
    }
    function updateNameBox() {
      if (document.activeElement === nameBox) return;
      var s = sh.sel, rg = curRange();
      if (drag && drag.kind === "sel" && rg) nameBox.value = (rg.r2 - rg.r1 + 1) + "行 × " + (rg.c2 - rg.c1 + 1) + "列";
      else nameBox.value = FX.addr(s.r, s.c);
    }

    // ======== 撤销：记录每个格子、每个属性改之前 / 之后的值 ========
    function tx(label, fn) {
      if (cur) return fn();
      cur = { label: label, cells: new Map(), props: [], selBefore: snapSel(), sheetBefore: book.sheets.indexOf(sh) };
      try { fn(); } finally {
        var j = cur;
        cur = null;
        if (j.cells.size || j.props.length) {
          j.cells.forEach(function (e) { e.after = e.sh.cells.get(e.k); });
          j.props.forEach(function (p) { p.after = p.obj[p.key]; });
          j.selAfter = snapSel();
          j.sheetAfter = book.sheets.indexOf(sh);
          undoStack.push(j);
          if (undoStack.length > 400) undoStack.shift();
          redoStack = [];
          afterChange();
        }
      }
    }
    function setCell(s, r, c, cell) {
      var k = K(r, c);
      if (cur) { var jk = s.uid + ":" + k; if (!cur.cells.has(jk)) cur.cells.set(jk, { sh: s, k: k, before: s.cells.get(k) }); }
      NB.putCell(s, r, c, cell || null);
    }
    function setProp(obj, key, val) {
      if (cur && !cur.props.some(function (p) { return p.obj === obj && p.key === key; })) cur.props.push({ obj: obj, key: key, before: obj[key] });
      obj[key] = val;
      if (obj instanceof NB.Axis) obj.dirty();
    }
    function snapSel() { return { sheet: sh, r: sh.sel.r, c: sh.sel.c, ranges: selRanges() }; }
    function applyJournal(j, back) {
      if (back) {
        j.cells.forEach(function (e) { NB.putCell(e.sh, KR(e.k), KC(e.k), e.before || null); e.sh.usedDirty = true; });
        j.props.slice().reverse().forEach(function (p) { p.obj[p.key] = p.before; if (p.obj instanceof NB.Axis) p.obj.dirty(); });
      } else {
        j.props.forEach(function (p) { p.obj[p.key] = p.after; if (p.obj instanceof NB.Axis) p.obj.dirty(); });
        j.cells.forEach(function (e) { NB.putCell(e.sh, KR(e.k), KC(e.k), e.after || null); e.sh.usedDirty = true; });
      }
      var idx = back ? j.sheetBefore : j.sheetAfter, snap = back ? j.selBefore : j.selAfter;
      book.sheets.forEach(function (s) { s.usedDirty = true; });
      var target = book.sheets.indexOf(snap.sheet) >= 0 ? snap.sheet : book.sheets[Math.max(0, Math.min(book.sheets.length - 1, idx))];
      switchTo(target, true);
      if (snap.sheet === sh) { sh.sel.r = snap.r; sh.sel.c = snap.c; sh.sel.ranges = snap.ranges.map(function (x) { return Object.assign({}, x); }); sh.sel.er = snap.r; sh.sel.ec = snap.c; }
      afterChange();
      ensureVisible(sh.sel.r, sh.sel.c);
    }
    function undo() { if (editing) return; var j = undoStack.pop(); if (!j) return; redoStack.push(j); applyJournal(j, true); }
    function redo() { if (editing) return; var j = redoStack.pop(); if (!j) return; undoStack.push(j); applyJournal(j, false); }
    function afterChange() {
      calc.reset();
      cfVer++;
      mergeCache.src = null;
      wrapCache.clear();
      renderTabs();
      updateSpace();
      paintSoon();
      showFx();
      updateStatus();
      syncInspector();
      doc.changed();
      doc.refresh();
    }

    // ======== 写格子 ========
    // 输入的文字 → 格子：= 开头是公式；否则认数字、百分比、货币、日期（顺便配上格式）
    function normFormula(f) {
      var out = FX.shift(f, 0, 0), res = "", i = 0;
      // 函数名大写（引号里的不动）
      while (i < out.length) {
        if (out[i] === '"') { var j = i + 1; while (j < out.length) { if (out[j] === '"') { if (out[j + 1] === '"') { j += 2; continue; } break; } j++; } res += out.slice(i, j + 1); i = j + 1; continue; }
        var m = /^([A-Za-z_][A-Za-z0-9_.]*)(\s*\()/.exec(out.slice(i));
        if (m && !/[A-Za-z0-9_.$]$/.test(res)) { res += m[1].toUpperCase() + m[2]; i += m[0].length; continue; }
        res += out[i++];
      }
      return res;
    }
    function checkFormula(f) {
      // 少了右括号就补上（同 Excel）
      var tries = [f], open = (f.match(/\(/g) || []).length - (f.match(/\)/g) || []).length;
      if (open > 0) tries.unshift(f + ")".repeat(open));
      for (var i = 0; i < tries.length; i++) { try { FX.parse(tries[i]); return { ok: true, f: tries[i] }; } catch (e) { /* 试下一个 */ } }
      return { ok: false };
    }
    function cellFromText(s, r, c, text) {
      var old = s.cells.get(K(r, c)), sid = old ? old.s || 0 : styleId(s, r, c), st = book.styles.get(sid);
      if (text === "") return sid ? { v: null, s: sid } : null;
      if (text[0] === "=" && text.length > 1 && st.nf !== "@") {
        var chk = checkFormula(text.slice(1));
        var o = { f: chk.ok ? normFormula(chk.f) : text.slice(1), v: null };
        if (sid) o.s = sid;
        return o;
      }
      if (st.nf === "@") return { v: text, s: sid };
      var p = FX.parseInput(text), out = { v: p.v };
      if (p.kind === "num" && typeof p.v === "number" && st.nf && /%/.test(st.nf.split(";")[0].replace(/"[^"]*"/g, "")) && !/%/.test(text)) out.v = p.v / 100;
      if (p.kind === "text" && text[0] === "'") out.v = text.slice(1);
      var ns = sid;
      if (p.nf && (!st.nf || (p.kind === "date" || p.kind === "time") && !FX.isDateFormat(st.nf))) ns = book.styles.with(sid, { nf: p.nf });
      if (ns) out.s = ns;
      if (old && old.link && p.kind === "text") out.link = old.link;
      return out;
    }
    function writeText(r, c, text, label) {
      tx(label || "输入", function () { setCell(sh, r, c, cellFromText(sh, r, c, text)); });
    }
    // 对选区里（有内容的）每一格做点什么
    function eachSelCell(fn, opts) {
      opts = opts || {};
      sh.sel.ranges.forEach(function (rg0) {
        var rg = opts.all ? rg0 : clipToUsed(rg0), area = (rg.r2 - rg.r1 + 1) * (rg.c2 - rg.c1 + 1);
        if (area > sh.cells.size * 4 && !opts.all) {
          // 大区域：只走已有的格子
          Array.from(sh.cells.keys()).forEach(function (k) { var r = KR(k), c = KC(k); if (r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2) fn(r, c, sh.cells.get(k)); });
        } else {
          for (var r = rg.r1; r <= rg.r2; r++) for (var c = rg.c1; c <= rg.c2; c++) fn(r, c, sh.cells.get(K(r, c)));
        }
      });
    }
    function clearSel(what) {
      tx(what === "formats" ? "清除格式" : what === "all" ? "全部清除" : "清除内容", function () {
        eachSelCell(function (r, c, cell) {
          if (!cell) return;
          if (what === "formats") setCell(sh, r, c, cell.v == null && cell.f == null ? null : strip(cell, "s"));
          else if (what === "all") setCell(sh, r, c, null);
          else setCell(sh, r, c, cell.s ? { v: null, s: cell.s } : null);
        });
        if (what !== "contents") {
          sh.sel.ranges.forEach(function (rg) {
            if (rg.r1 === 0 && rg.r2 >= MAXR - 1) { var cs = new Map(sh.colStyle); for (var c = rg.c1; c <= Math.min(rg.c2, MAXC - 1); c++) cs.delete(c); setProp(sh, "colStyle", cs); }
            if (rg.c1 === 0 && rg.c2 >= MAXC - 1) { var rs = new Map(sh.rowStyle); for (var r = rg.r1; r <= Math.min(rg.r2, rg.r1 + 100000); r++) rs.delete(r); setProp(sh, "rowStyle", rs); }
          });
        }
      });
    }
    function strip(o, k) { var n = Object.assign({}, o); delete n[k]; return n; }
    // 改样式：patch 是对象或 function(旧样式) → 新的片段；整行整列记在行 / 列的样式上
    function applyStyle(patch, label) {
      var pf = typeof patch === "function" ? patch : function () { return patch; };
      var memo = new Map();
      var next = function (sid) { var n = memo.get(sid); if (n == null) { var st = book.styles.get(sid); n = book.styles.id(Object.assign({}, st, pf(st))); memo.set(sid, n); } return n; };
      tx(label || "格式", function () {
        sh.sel.ranges.forEach(function (rg) {
          var wholeCol = rg.r1 === 0 && rg.r2 >= MAXR - 1, wholeRow = rg.c1 === 0 && rg.c2 >= MAXC - 1;
          if (wholeCol) { var cs = new Map(sh.colStyle); for (var c = rg.c1; c <= Math.min(rg.c2, rg.c1 + 16383); c++) { var n1 = next(cs.get(c) || 0); if (n1) cs.set(c, n1); else cs.delete(c); } setProp(sh, "colStyle", cs); }
          else if (wholeRow) { var rs = new Map(sh.rowStyle); for (var r = rg.r1; r <= Math.min(rg.r2, rg.r1 + 200000); r++) { var n2 = next(rs.get(r) || 0); if (n2) rs.set(r, n2); else rs.delete(r); } setProp(sh, "rowStyle", rs); }
        });
        var seen = new Set();
        sh.sel.ranges.forEach(function (rg) {
          var wholeCol = rg.r1 === 0 && rg.r2 >= MAXR - 1, wholeRow = rg.c1 === 0 && rg.c2 >= MAXC - 1, area = (rg.r2 - rg.r1 + 1) * (rg.c2 - rg.c1 + 1);
          var visit = function (r, c) {
            var k = K(r, c);
            if (seen.has(k)) return;
            seen.add(k);
            var cell = sh.cells.get(k), sid = cell ? cell.s || 0 : styleId(sh, r, c), n = next(sid);
            if (cell) { if (n !== (cell.s || 0)) setCell(sh, r, c, n ? Object.assign({}, cell, { s: n }) : strip(cell, "s")); }
            else if (!wholeCol && !wholeRow && n !== sid) setCell(sh, r, c, { v: null, s: n });
          };
          if (wholeCol || wholeRow || area > 250000) Array.from(sh.cells.keys()).forEach(function (k) { var r = KR(k), c = KC(k); if (r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2) visit(r, c); });
          else for (var r = rg.r1; r <= rg.r2; r++) for (var c = rg.c1; c <= rg.c2; c++) visit(r, c);
        });
      });
    }
    var activeStyle = function () { return styleOf(sh, sh.sel.r, sh.sel.c); };
    function toggleStyle(key) { var on = !activeStyle()[key]; var p = {}; p[key] = on ? 1 : null; applyStyle(p, { b: "粗体", i: "斜体", u: "下划线", st: "删除线" }[key]); }

    // ======== 编辑 ========
    function beginEdit(text, mode, opts) {
      opts = opts || {};
      var s = sh.sel, cell = cellAt(sh, s.r, s.c);
      if (text == null) text = cell ? (cell.f != null ? "=" + cell.f : editText(cell)) : "";
      editing = { sheet: sh, r: s.r, c: s.c, mode: mode || "enter", orig: cell, formula: text[0] === "=", point: null };
      stopAnts();
      if (ed.value !== text) ed.value = text;
      if (fxIn.value !== text) fxIn.value = text;
      edw.classList.add("on");
      root.classList.add("editing");
      placeEditor();
      var input = opts.inFx ? fxIn : ed;
      editing.input = input;
      if (input !== document.activeElement) input.focus({ preventScroll: true });
      var n = input.value.length;
      if (!opts.keepCaret) input.setSelectionRange(n, n);
      sizeEditor();
      updateAssist();
      modeText();
      paintSoon();
    }
    function editText(cell) {
      var v = cell.v;
      if (v == null) return "";
      var st = book.styles.get(cell.s || 0);
      if (typeof v === "number" && st.nf && FX.isDateFormat(st.nf)) {
        // 日期、时间编辑时显示成好改的样子
        var hasDate = /[yd]/i.test(st.nf.replace(/"[^"]*"/g, "")) || /m/i.test(st.nf.replace(/"[^"]*"/g, "").replace(/h+[^a-z]*m+|m+[^a-z]*s+/gi, ""));
        var hasTime = /[hs]/i.test(st.nf.replace(/"[^"]*"/g, ""));
        var f = (hasDate || !hasTime ? "yyyy-mm-dd" : "") + (hasTime ? (hasDate ? " " : "") + "hh:mm:ss" : "");
        return FX.format(v, f).text;
      }
      if (typeof v === "number" && st.nf && /%/.test(st.nf)) return String(parseFloat((v * 100).toPrecision(12))) + "%";
      if (typeof v === "number") return String(parseFloat(v.toPrecision(15)));
      if (FX.isErr(v)) return v.code;
      if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
      return String(v);
    }
    function endEditUI() {
      editing = null;
      edw.classList.remove("on");
      root.classList.remove("editing");
      ed.value = "";
      ed.style.width = "";
      ed.style.height = "";
      acEl.hidden = true;
      tipEl.hidden = true;
      edHL.textContent = "";
      fxHL.textContent = "";
      ed.classList.remove("hl");
      fxIn.classList.remove("hl");
      modeText();
      showFx();
    }
    // 提交：move = [dr, dc] 或 null；all = 填到选区里每一格（⌘↩）
    function commitEdit(move, all) {
      if (!editing) return true;
      var e = editing, text = e.input.value;
      if (text[0] === "=" && text.length > 1) {
        var chk = checkFormula(text.slice(1));
        if (!chk.ok) {
          edw.classList.add("bad");
          setTimeout(function () { edw.classList.remove("bad"); }, 700);
          D.alert({ window: doc.win.el.id, title: "这个公式有问题", message: "检查一下括号、引号和函数名。不想输入公式的话，在开头加一个单引号（'）。", icon: "caution" }).then(function () { if (editing) editing.input.focus(); });
          return false;
        }
      }
      var target = e.sheet;
      if (target !== sh) switchTo(target, true);
      var origText = e.orig ? (e.orig.f != null ? "=" + e.orig.f : editText(e.orig)) : "";
      endEditUI();
      if (copyMark && !copyMark.cut) stopAnts();
      if (all) {
        var base = cellFromText(sh, e.r, e.c, text);
        tx("输入", function () {
          sh.sel.ranges.forEach(function (rg0) {
            var rg = clipToUsedIfHuge(rg0);
            for (var r = rg.r1; r <= rg.r2; r++) for (var c = rg.c1; c <= rg.c2; c++) {
              var o = cellFromText(sh, r, c, text);
              if (o && o.f != null && base && base.f != null) o.f = FX.shift(base.f, r - e.r, c - e.c);
              setCell(sh, r, c, o);
            }
          });
        });
      } else if (text !== origText) writeText(e.r, e.c, text);
      // Tab 往右填了几格后按回车：回到开始那一列的下一行（同 Excel）
      var anchor = tabAnchor, single = sh.sel.ranges.length === 1 && curRange().r1 === curRange().r2 && curRange().c1 === curRange().c2;
      if (move && move[0] === 1 && move[1] === 0 && anchor != null && single) { setSel(e.r + 1, anchor); ensureVisible(e.r + 1, anchor); }
      else if (move) moveInSel(move[0], move[1]);
      if (move && move[0] === 0 && move[1] === 1 && single) tabAnchor = anchor == null ? e.c : anchor;
      focus();
      return true;
    }
    function clipToUsedIfHuge(rg) { return (rg.r2 - rg.r1 + 1) * (rg.c2 - rg.c1 + 1) > 200000 ? clipToUsed(rg) : rg; }
    function cancelEdit() {
      if (!editing) return;
      var target = editing.sheet;
      endEditUI();
      if (target !== sh) switchTo(target, true);
      focus();
      paintSoon();
    }
    // 编辑框放在活动格上，跟着滚动；文字多了往右、往下长
    function placeEditor() {
      var s = editing ? editing : { r: sh.sel.r, c: sh.sel.c, sheet: sh };
      if (s.sheet !== sh) { edw.style.transform = "translate(-9999px, 0)"; return; }
      var g = geom(), m = mergeAt(s.r, s.c) || { r1: s.r, c1: s.c, r2: s.r, c2: s.c }, rc = rectOf(m, g);
      var x = rc.x * g.z, y = rc.y * g.z;
      edw.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
      edw.style.minWidth = Math.max(20, rc.w * g.z) + "px";
      edw.style.minHeight = Math.max(16, rc.h * g.z) + "px";
      edw.style.maxWidth = Math.max(60, g.W - x - 4) + "px";
      if (editing) {
        var st = styleOf(sh, m.r1, m.c1);
        ed.style.font = fontOf(st, g.z);
        edHL.style.font = ed.style.font;
        ed.style.textAlign = "left";
        edw.style.setProperty("--ed-bg", st.fill || "");
        ed.style.color = st.color && !(O.dark() && isBlack(st.color)) ? st.color : "";
      }
    }
    function sizeEditor() {
      if (!editing) return;
      ed.style.width = "0px";
      ed.style.height = "0px";
      var w = Math.min(parseFloat(edw.style.maxWidth) || 600, Math.max(parseFloat(edw.style.minWidth) || 60, ed.scrollWidth + 10));
      ed.style.width = w + "px";
      ed.style.height = Math.max(parseFloat(edw.style.minHeight) || 20, ed.scrollHeight) + "px";
      paintHL();
    }
    // 公式里的引用上色（编辑框下面垫一层同样排版的彩色字）
    function refsInEdit() {
      if (!editing || !editing.formula) return [];
      var text = editing.input.value, out = [], n = 0;
      scanRefs(text).forEach(function (t) {
        var node;
        try { node = FX.parse(t.text); } catch (e) { return; }
        var color = REF_COLORS[n++ % REF_COLORS.length], sheetName = node.sheet || editing.sheet.name;
        var rg = node.t === "ref" ? { r1: node.r, c1: node.c, r2: node.r, c2: node.c } : { r1: node.r1, c1: node.c1, r2: Math.min(node.r2, MAXR - 1), c2: Math.min(node.c2, MAXC - 1) };
        out.push({ start: t.start, end: t.end, color: color, rg: rg, onSheet: sheetName.toLowerCase() === sh.name.toLowerCase(), active: editing.point && editing.point.start === t.start });
      });
      return out;
    }
    // 公式文字里引用的位置（引号里的不算）
    function scanRefs(text) {
      var out = [], i = 0, re = /^(?:(?:'(?:[^']|'')+'|[A-Za-z_一-鿿][\w.一-鿿]*)!)?(?:\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d+:\$?\d+)(?![\w(!])/;
      while (i < text.length) {
        var ch = text[i];
        if (ch === '"') { var j = text.indexOf('"', i + 1); while (j >= 0 && text[j + 1] === '"') j = text.indexOf('"', j + 2); i = j < 0 ? text.length : j + 1; continue; }
        var prev = i > 0 ? text[i - 1] : "";
        if (!/[\w.$一-鿿]/.test(prev)) {
          var m = re.exec(text.slice(i));
          if (m && !/^\d+(\.\d+)?$/.test(m[0])) { out.push({ start: i, end: i + m[0].length, text: m[0] }); i += m[0].length; continue; }
        }
        i++;
      }
      return out;
    }
    function paintHL() {
      if (!editing || !editing.formula) { edHL.textContent = ""; fxHL.textContent = ""; ed.classList.remove("hl"); fxIn.classList.remove("hl"); return; }
      var text = editing.input.value, refs = refsInEdit(), html = "", i = 0;
      refs.forEach(function (rf) { html += esc(text.slice(i, rf.start)) + '<span style="color:' + rf.color + '">' + esc(text.slice(rf.start, rf.end)) + "</span>"; i = rf.end; });
      html += esc(text.slice(i)) + "​";
      edHL.innerHTML = html;
      fxHL.innerHTML = html;
      ed.classList.add("hl");
      fxIn.classList.add("hl");
      edHL.scrollTop = ed.scrollTop;
      fxHL.scrollLeft = fxIn.scrollLeft;
    }
    // 光标前面能不能插引用：在 = ( , 运算符后面
    function canPoint() {
      if (!editing || !editing.formula) return false;
      var inp = editing.input, pos = inp.selectionStart, before = inp.value.slice(0, pos);
      if (editing.point && editing.point.end === pos && inp.selectionEnd === pos) return true;
      if (inp.selectionEnd !== pos) return false;
      return /[=(,+\-*/^&<>:;%]\s*$/.test(before) && before.length > 0;
    }
    function refTextFor(r1, c1, r2, c2) {
      var t = FX.addr(r1, c1) + (r2 != null && (r2 !== r1 || c2 !== c1) ? ":" + FX.addr(r2, c2) : "");
      if (editing && sh !== editing.sheet) t = FX.quoteSheet(sh.name) + "!" + t;
      return t;
    }
    // 在光标处插入（或替换上一次插的）引用
    function pointAt(r1, c1, r2, c2) {
      var inp = editing.input, text = inp.value, p = editing.point, start, end;
      if (p && p.end === inp.selectionStart) { start = p.start; end = p.end; }
      else { start = inp.selectionStart; end = inp.selectionEnd; }
      var ref = refTextFor(r1, c1, r2, c2);
      inp.value = text.slice(0, start) + ref + text.slice(end);
      editing.point = { start: start, end: start + ref.length, r: r1, c: c1, r2: r2 == null ? r1 : r2, c2: c2 == null ? c1 : c2 };
      inp.setSelectionRange(start + ref.length, start + ref.length);
      syncEditInputs(inp);
      paintSoon();
    }
    function syncEditInputs(from) {
      if (!editing) return;
      var other = from === ed ? fxIn : ed;
      if (other.value !== from.value) other.value = from.value;
      editing.formula = from.value[0] === "=";
      sizeEditor();
      updateAssist();
      paintSoon();
    }
    // 自动补全：光标前是函数名的开头
    var acItems = [], acIdx = 0;
    function updateAssist() {
      if (!editing || !editing.formula) { acEl.hidden = true; tipEl.hidden = true; return; }
      var inp = editing.input, pos = inp.selectionStart, before = inp.value.slice(0, pos);
      var m = /(^|[=(,+\-*/^&<>:;\s])([A-Za-z][A-Za-z0-9.]*)$/.exec(before);
      acItems = [];
      if (m && inp.selectionEnd === pos) {
        var pre = m[2].toUpperCase();
        acItems = FX.functionNames().filter(function (n) { return n.indexOf(pre) === 0; });
        acItems.sort(function (a, b) { return (FNINFO[b] ? 1 : 0) - (FNINFO[a] ? 1 : 0) || a.length - b.length || (a < b ? -1 : 1); });
        acItems = acItems.slice(0, 9);
        if (acItems.length === 1 && acItems[0] === pre) acItems = [];
      }
      acIdx = 0;
      renderAC();
      // 参数提示：光标在哪个函数的括号里、第几个参数
      var depth = 0, argN = 0, fnName = null, inStr = false;
      for (var i = pos - 1; i >= 0; i--) {
        var ch = before[i];
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === ")") depth++;
        else if (ch === "(") {
          if (depth === 0) { var fm = /([A-Za-z][A-Za-z0-9.]*)\s*$/.exec(before.slice(0, i)); fnName = fm ? fm[1].toUpperCase() : null; break; }
          depth--;
        } else if (ch === "," && depth === 0) argN++;
      }
      if (fnName && FNINFO[fnName] && acEl.hidden) {
        var args = FNINFO[fnName][0].split(/,\s*/);
        tipEl.innerHTML = "<b>" + esc(fnName) + "</b>(" + args.map(function (a, k) { return k === Math.min(argN, args.length - 1) || (a === "…" && argN >= k) ? "<u>" + esc(a) + "</u>" : esc(a); }).join(", ") + ")<span>" + esc(FNINFO[fnName][1]) + "</span>";
        placeAssist(tipEl);
        tipEl.hidden = false;
      } else tipEl.hidden = true;
    }
    function renderAC() {
      if (!acItems.length) { acEl.hidden = true; return; }
      acEl.innerHTML = acItems.map(function (n, i) { var inf = FNINFO[n]; return '<div class="nb-aci' + (i === acIdx ? " on" : "") + '" data-i="' + i + '"><b>' + esc(n) + "</b>" + (inf ? "<span>" + esc(inf[1]) + "</span>" : "") + "</div>"; }).join("");
      placeAssist(acEl);
      acEl.hidden = false;
    }
    function placeAssist(box) {
      var anchor = editing && editing.input === fxIn ? fxIn : edw, ar = anchor.getBoundingClientRect(), gr = gridEl.getBoundingClientRect();
      var x = Math.max(0, Math.min(ar.left - gr.left, gr.width - 320)), y = ar.bottom - gr.top + 2;
      if (anchor === fxIn) y = 2;
      box.style.left = x + "px";
      box.style.top = y + "px";
    }
    function acceptAC(i) {
      var name = acItems[i == null ? acIdx : i];
      if (!name || !editing) return;
      var inp = editing.input, pos = inp.selectionStart, before = inp.value.slice(0, pos), m = /([A-Za-z][A-Za-z0-9.]*)$/.exec(before);
      var start = pos - (m ? m[1].length : 0), after = inp.value.slice(pos), addParen = after[0] !== "(";
      inp.value = inp.value.slice(0, start) + name + (addParen ? "(" : "") + after;
      var np = start + name.length + 1;
      inp.setSelectionRange(np, np);
      acItems = [];
      acEl.hidden = true;
      syncEditInputs(inp);
    }
    acEl.addEventListener("mousedown", function (e) { e.preventDefault(); var d = e.target.closest(".nb-aci"); if (d) acceptAC(+d.dataset.i); });
    // F4：光标所在的引用在 A1 → $A$1 → A$1 → $A1 之间切换
    function toggleAbs() {
      var inp = editing.input, pos = inp.selectionStart, text = inp.value, refs = scanRefs(text), rf = refs.find(function (x) { return pos >= x.start && pos <= x.end; });
      if (!rf) return;
      var t = rf.text, bang = t.lastIndexOf("!"), prefix = bang >= 0 ? t.slice(0, bang + 1) : "", body = bang >= 0 ? t.slice(bang + 1) : t;
      var cyc = function (a) {
        var m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(a);
        if (!m) return a;
        var state = (m[1] ? 2 : 0) + (m[3] ? 1 : 0), next = { 0: 3, 3: 1, 1: 2, 2: 0 }[state];
        return (next & 2 ? "$" : "") + m[2] + (next & 1 ? "$" : "") + m[4];
      };
      var nb = body.split(":").map(cyc).join(":"), nt = prefix + nb;
      inp.value = text.slice(0, rf.start) + nt + text.slice(rf.end);
      inp.setSelectionRange(rf.start + nt.length, rf.start + nt.length);
      syncEditInputs(inp);
    }

    // ======== 键盘 ========
    function onKey(e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (editing) return editKey(e, e.target);
      var mod = e.metaKey || e.ctrlKey, k = e.key, sh2 = e.shiftKey;
      var handled = true;
      if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
        var dr = k === "ArrowUp" ? -1 : k === "ArrowDown" ? 1 : 0, dc = k === "ArrowLeft" ? -1 : k === "ArrowRight" ? 1 : 0;
        if (e.altKey && !mod) handled = false;
        else move(dr, dc, sh2, mod);
      }
      else if (k === "Tab") moveInSel(0, sh2 ? -1 : 1);
      else if (k === "Enter") { if (mod && !sh2) beginEdit(null, "edit"); else moveInSel(sh2 ? -1 : 1, 0); }
      else if (k === "Home") { if (mod) { setSel(sh.freeze.r ? sh.freeze.r : 0, 0); ensureVisible(0, 0); scrollEl.scrollTop = 0; scrollEl.scrollLeft = 0; } else { setSel(sh.sel.r, 0); ensureVisible(sh.sel.r, 0); } }
      else if (k === "End" && mod) { var u = NB.used(sh); setSel(Math.max(0, u.r), Math.max(0, u.c)); ensureVisible(Math.max(0, u.r), Math.max(0, u.c)); }
      else if (k === "PageDown" || k === "PageUp") {
        var g = geom(), rowsPer = Math.max(1, Math.floor((g.vh - g.hh - g.FH) / sh.rows.def) - 1), d = k === "PageDown" ? 1 : -1;
        if (e.altKey) { var cn = sh.sel.c; for (var i = 0; i < 8; i++) cn = stepC(cn, d); if (sh2) extendTo(sh.sel.er, cn); else setSel(sh.sel.r, cn); ensureVisible(sh.sel.r, cn); scrollEl.scrollLeft += d * (g.vw - g.hw) * zoom * 0.8; }
        else { var rn = sh.sel.r; for (var j = 0; j < rowsPer; j++) rn = stepR(rn, d); if (sh2) extendTo(rn, sh.sel.ec); else setSel(rn, sh.sel.c); scrollEl.scrollTop += d * rowsPer * sh.rows.def * zoom; ensureVisible(rn, sh.sel.c); }
      }
      else if ((k === "Backspace" || k === "Delete") && !mod) clearSel("contents");
      else if (k === "F2") beginEdit(null, "edit");
      else if (k === "Escape") { if (copyMark) stopAnts(); else handled = false; }
      else if (mod && !e.altKey) {
        var code = e.code;
        if (code === "KeyZ") { if (sh2) redo(); else undo(); }
        else if (code === "KeyY") redo();
        else if (code === "KeyA") selectAll();
        else if (code === "KeyB") toggleStyle("b");
        else if (code === "KeyI") toggleStyle("i");
        else if (code === "KeyU") toggleStyle("u");
        else if (code === "KeyD") fillDir("down");
        else if (code === "KeyR") fillDir("right");
        else if (code === "KeyF") openFind(false);
        else if (code === "Semicolon") insertNow(sh2 ? "time" : "date");
        else if (code === "Equal" || code === "NumpadAdd") setZoom(zoom + 0.1);
        else if (code === "Minus" || code === "NumpadSubtract") setZoom(zoom - 0.1);
        else if (code === "Digit0") setZoom(1);
        else if (code === "Digit1") doc.showInspector(true);
        else if (code === "KeyK") handled = false;
        else handled = false;
      }
      else if (mod && e.altKey && e.code === "KeyI") doc.showInspector();
      else if (mod && e.altKey && e.shiftKey && e.code === "KeyV") pasteFromMenu(true);
      else handled = false;
      if (handled) e.preventDefault();
    }
    function editKey(e, inp) {
      var k = e.key, mod = e.metaKey || e.ctrlKey;
      if (!acEl.hidden && (k === "ArrowDown" || k === "ArrowUp")) { e.preventDefault(); acIdx = (acIdx + (k === "ArrowDown" ? 1 : -1) + acItems.length) % acItems.length; renderAC(); acEl.dataset.nav = "1"; return; }
      if (!acEl.hidden && (k === "Tab" || k === "Enter" && acEl.dataset.nav)) { e.preventDefault(); delete acEl.dataset.nav; acceptAC(); return; }
      if (k === "Escape") { e.preventDefault(); if (!acEl.hidden) { acEl.hidden = true; return; } cancelEdit(); return; }
      if (k === "Enter") {
        if (e.altKey || e.ctrlKey && !e.metaKey) { e.preventDefault(); insertAtCaret(inp, "\n"); return; }
        e.preventDefault();
        if (mod) { commitEdit(null, true); return; }
        commitEdit([e.shiftKey ? -1 : 1, 0]);
        return;
      }
      if (k === "Tab") { e.preventDefault(); commitEdit([0, e.shiftKey ? -1 : 1]); return; }
      if (k === "F4") { e.preventDefault(); toggleAbs(); return; }
      if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
        var dr = k === "ArrowUp" ? -1 : k === "ArrowDown" ? 1 : 0, dc = k === "ArrowLeft" ? -1 : k === "ArrowRight" ? 1 : 0;
        if (editing.formula && editing.mode === "enter" && canPoint()) {
          e.preventDefault();
          var p = editing.point && editing.point.end === inp.selectionStart ? editing.point : null;
          var r0 = p ? (e.shiftKey ? p.r2 : p.r) : editing.r, c0 = p ? (e.shiftKey ? p.c2 : p.c) : editing.c;
          var nr = dr ? stepR(r0, dr) : r0, nc = dc ? stepC(c0, dc) : c0;
          if (e.shiftKey && p) pointAt(Math.min(p.r, nr), Math.min(p.c, nc), Math.max(p.r, nr), Math.max(p.c, nc));
          else pointAt(nr, nc);
          if (e.shiftKey && p) { editing.point.r = p.r; editing.point.c = p.c; editing.point.r2 = nr; editing.point.c2 = nc; }
          ensureVisible(nr, nc);
          return;
        }
        if (editing.mode === "enter" && inp === ed && !e.shiftKey && !mod) { e.preventDefault(); commitEdit([dr, dc]); return; }
        return;
      }
      if (mod && e.code === "KeyZ" && !editing.input.value && !e.shiftKey) { e.preventDefault(); cancelEdit(); undo(); return; }
      if (mod && (e.code === "KeyB" || e.code === "KeyI" || e.code === "KeyU")) { e.preventDefault(); return; }
      editing.mode = editing.mode === "enter" && (k === "Home" || k === "End") ? "edit" : editing.mode;
    }
    function insertAtCaret(inp, s) {
      var a = inp.selectionStart, b = inp.selectionEnd;
      inp.value = inp.value.slice(0, a) + s + inp.value.slice(b);
      inp.setSelectionRange(a + s.length, a + s.length);
      syncEditInputs(inp);
    }
    ed.addEventListener("keydown", onKey);
    ed.addEventListener("input", function () {
      if (!editing) { var v = ed.value; if (!v) return; beginEdit(v, "enter"); return; }
      editing.point = editing.point && editing.point.end === ed.selectionStart ? editing.point : null;
      syncEditInputs(ed);
    });
    ed.addEventListener("compositionstart", function () { if (!editing) beginEdit("", "enter", { keepCaret: true }); });
    ed.addEventListener("compositionend", function () { if (editing) syncEditInputs(ed); });
    ed.addEventListener("scroll", function () { edHL.scrollTop = ed.scrollTop; });
    ed.addEventListener("click", function () { if (editing) { editing.mode = "edit"; updateAssist(); } });
    ed.addEventListener("keyup", function (e) { if (editing && /Arrow|Home|End/.test(e.key)) updateAssist(); });
    // 公式栏
    fxIn.addEventListener("focus", function () { if (!editing) beginEdit(null, "edit", { inFx: true }); else editing.input = fxIn; });
    fxIn.addEventListener("keydown", function (e) { if (editing) editKey(e, fxIn); });
    fxIn.addEventListener("input", function () { if (!editing) beginEdit(fxIn.value, "edit", { inFx: true }); editing.point = editing.point && editing.point.end === fxIn.selectionStart ? editing.point : null; syncEditInputs(fxIn); });
    fxIn.addEventListener("scroll", function () { fxHL.scrollLeft = fxIn.scrollLeft; });
    fxIn.addEventListener("click", function () { if (editing) updateAssist(); });
    root.querySelector(".nb-fxb").addEventListener("mousedown", function (e) { e.preventDefault(); });
    root.querySelector(".nb-fxb").addEventListener("click", function (e) {
      var a = e.target.dataset && e.target.dataset.a;
      if (a === "cancel") cancelEdit();
      else if (a === "ok") commitEdit(null);
      else if (a === "fn") { var b = e.target; ui.menuBelow(b, fnMenuItems(true)); }
    });
    function showFx() {
      if (editing) return;
      var cell = cellAt(sh, sh.sel.r, sh.sel.c);
      fxIn.value = cell ? (cell.f != null ? "=" + cell.f : editText(cell)) : "";
      fxHL.textContent = "";
      fxIn.classList.remove("hl");
    }
    // 名称框：输入地址跳过去
    nameBox.addEventListener("focus", function () { nameBox.select(); });
    nameBox.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Escape") { updateNameBox(); focus(); return; }
      if (e.key !== "Enter") return;
      e.preventDefault();
      var t = nameBox.value.trim(), m = /^(?:(.+)!)?(.+)$/.exec(t);
      if (m && m[1]) { var target = NB.sheetByName(book, m[1].replace(/^'|'$/g, "").replace(/''/g, "'")); if (target) switchTo(target); }
      var rg = NB.parseRange(m ? m[2] : t);
      if (!rg) {
        var cm = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$/.exec(m ? m[2] : t), rm = /^\$?(\d+):\$?(\d+)$/.exec(m ? m[2] : t);
        if (cm) rg = { r1: 0, c1: Math.min(FX.colIndex(cm[1]), FX.colIndex(cm[2])), r2: MAXR - 1, c2: Math.max(FX.colIndex(cm[1]), FX.colIndex(cm[2])) };
        else if (rm) rg = { r1: Math.min(+rm[1], +rm[2]) - 1, c1: 0, r2: Math.max(+rm[1], +rm[2]) - 1, c2: MAXC - 1 };
      }
      if (rg) { setSel(rg.r1, rg.c1, rg.r2, rg.c2); ensureVisible(rg.r1, rg.c1); }
      focus();
    });
    nameBox.addEventListener("blur", updateNameBox);

    // ======== 鼠标 ========
    scrollEl.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 && e.button !== 2) return;
      if (e.offsetX > scrollEl.clientWidth || e.offsetY > scrollEl.clientHeight) return; // 滚动条
      var h = hit(e.clientX, e.clientY);
      e.preventDefault();
      if (e.button === 2) {
        // 右键：点在选区外就先选中那一格
        if (h.area === "cell" && !inSel(h.r, h.c)) { if (editing) commitEdit(); setSel(h.r, h.c); }
        else if (h.area === "colhead" && !sh.sel.ranges.some(function (x) { return x.r1 === 0 && x.r2 >= MAXR - 1 && h.c >= x.c1 && h.c <= x.c2; })) setSel(0, h.c, MAXR - 1, h.c);
        else if (h.area === "rowhead" && !sh.sel.ranges.some(function (x) { return x.c1 === 0 && x.c2 >= MAXC - 1 && h.r >= x.r1 && h.r <= x.r2; })) setSel(h.r, 0, h.r, MAXC - 1);
        return;
      }
      // 编辑公式时点格子 = 插入引用
      if (editing && editing.formula && h.area === "cell" && canPoint()) {
        if (e.shiftKey && editing.point) pointAt(Math.min(editing.point.r, h.r), Math.min(editing.point.c, h.c), Math.max(editing.point.r, h.r), Math.max(editing.point.c, h.c));
        else pointAt(h.r, h.c);
        var p0 = { r: editing.point.r, c: editing.point.c };
        startDrag(e, { kind: "point", r0: p0.r, c0: p0.c });
        editing.input.focus({ preventScroll: true });
        return;
      }
      if (editing && !commitEdit()) return;
      ensureFocus();
      if (h.area === "corner") { selectAll(); return; }
      if (h.area === "colhead") {
        if (h.edge != null) return startDrag(e, { kind: "colw", c: h.edge, x0: e.clientX, w0: sh.cols.sz(h.edge) || sh.cols.def, list: colsForResize(h.edge) });
        if (e.shiftKey) { var s = sh.sel; extendTo(MAXR - 1, h.c); s.ranges[s.ranges.length - 1] = { r1: 0, c1: Math.min(s.c, h.c), r2: MAXR - 1, c2: Math.max(s.c, h.c) }; }
        else setSel(0, h.c, MAXR - 1, h.c, e.metaKey || e.ctrlKey);
        if (!e.shiftKey) { sh.sel.r = firstVisibleRow(); sh.sel.c = h.c; }
        return startDrag(e, { kind: "cols", c0: h.c, add: e.metaKey || e.ctrlKey });
      }
      if (h.area === "rowhead") {
        if (h.edge != null) return startDrag(e, { kind: "rowh", r: h.edge, y0: e.clientY, h0: sh.rows.sz(h.edge) || sh.rows.def, list: rowsForResize(h.edge) });
        if (e.shiftKey) { var s2 = sh.sel; s2.ranges[s2.ranges.length - 1] = { r1: Math.min(s2.r, h.r), c1: 0, r2: Math.max(s2.r, h.r), c2: MAXC - 1 }; selChanged(); }
        else { setSel(h.r, 0, h.r, MAXC - 1, e.metaKey || e.ctrlKey); sh.sel.c = firstVisibleCol(); sh.sel.r = h.r; }
        return startDrag(e, { kind: "rows", r0: h.r, add: e.metaKey || e.ctrlKey });
      }
      if (h.filterBtn != null) { openFilterPop(h.filterBtn); return; }
      if (h.handle) return startDrag(e, { kind: "fill", src: expandMerges(sh.sel.ranges[0]) });
      // ⌘ 点链接
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        var cell = cellAt(sh, h.r, h.c), link = cell && (cell.link || (typeof cell.v === "string" && /^https?:\/\/\S+$/.test(cell.v) ? cell.v : null));
        if (link) { window.open(link, "_blank", "noopener"); return; }
      }
      var m = mergeAt(h.r, h.c), r = m ? m.r1 : h.r, c = m ? m.c1 : h.c;
      if (e.shiftKey) extendTo(h.r, h.c);
      else setSel(r, c, null, null, e.metaKey || e.ctrlKey);
      startDrag(e, { kind: "sel" });
    });
    scrollEl.addEventListener("mousedown", function (e) { if (e.offsetX <= scrollEl.clientWidth && e.offsetY <= scrollEl.clientHeight) e.preventDefault(); });
    scrollEl.addEventListener("dblclick", function (e) {
      var h = hit(e.clientX, e.clientY);
      if (h.area === "colhead" && h.edge != null) { autofitCols(colsForResize(h.edge)); return; }
      if (h.area === "rowhead" && h.edge != null) { autofitRows(rowsForResize(h.edge)); return; }
      if (h.area === "cell" && !editing && !h.filterBtn) { beginEdit(null, "edit"); placeCaretAt(e); }
    });
    scrollEl.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      var h = hit(e.clientX, e.clientY);
      ui.menuAt(contextItems(h), e.clientX, e.clientY);
    });
    scrollEl.addEventListener("pointermove", function (e) {
      if (drag) return;
      var h = hit(e.clientX, e.clientY);
      scrollEl.style.cursor = h.area === "colhead" && h.edge != null ? "col-resize" : h.area === "rowhead" && h.edge != null ? "row-resize" : h.handle ? "crosshair" : h.filterBtn != null ? "pointer" : h.area === "colhead" ? "s-resize" : h.area === "rowhead" ? "e-resize" : "cell";
      if (h.area === "colhead" && h.edge == null) scrollEl.style.cursor = "default";
      if (h.area === "rowhead" && h.edge == null) scrollEl.style.cursor = "default";
    });
    function placeCaretAt(e) {
      // 双击的位置大概对应第几个字
      var inp = ed, text = inp.value;
      if (!text || text[0] === "=") return;
      var rc = edw.getBoundingClientRect(), x = e.clientX - rc.left - 3, font = ed.style.font, best = text.length, acc = 0;
      for (var i = 0; i < text.length; i++) { var w = measure(text[i], font); if (acc + w / 2 > x) { best = i; break; } acc += w; }
      inp.setSelectionRange(best, best);
    }
    var inSel = function (r, c) { return sh.sel.ranges.some(function (x) { return r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2; }); };
    function firstVisibleRow() { var r = 0; while (r < MAXR - 1 && !sh.rows.sz(r)) r++; return r; }
    function firstVisibleCol() { var c = 0; while (c < MAXC - 1 && !sh.cols.sz(c)) c++; return c; }
    // 拖列宽时，要是这一列在选中的整列里，选中的整列一起变
    function colsForResize(c) { var rg = sh.sel.ranges.find(function (x) { return x.r1 === 0 && x.r2 >= MAXR - 1 && c >= x.c1 && c <= x.c2; }); var out = []; if (rg) { for (var i = rg.c1; i <= Math.min(rg.c2, rg.c1 + 2000); i++) out.push(i); } else out.push(c); return out; }
    function rowsForResize(r) { var rg = sh.sel.ranges.find(function (x) { return x.c1 === 0 && x.c2 >= MAXC - 1 && r >= x.r1 && r <= x.r2; }); var out = []; if (rg) { for (var i = rg.r1; i <= Math.min(rg.r2, rg.r1 + 5000); i++) out.push(i); } else out.push(r); return out; }
    function startDrag(e, d) {
      drag = d;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      try { scrollEl.setPointerCapture(e.pointerId); } catch (x) { /* 没关系 */ }
      var mv = function (ev) { d.lastX = ev.clientX; d.lastY = ev.clientY; dragMove(ev.clientX, ev.clientY, ev); };
      var up = function (ev) {
        scrollEl.removeEventListener("pointermove", mv);
        scrollEl.removeEventListener("pointerup", up);
        scrollEl.removeEventListener("pointercancel", up);
        cancelAnimationFrame(d.auto);
        dragEnd(ev);
        drag = null;
        updateNameBox();
        paintSoon();
      };
      scrollEl.addEventListener("pointermove", mv);
      scrollEl.addEventListener("pointerup", up);
      scrollEl.addEventListener("pointercancel", up);
      // 拖到边外面：自动滚
      var tick = function () {
        if (drag !== d) return;
        var rc = gridEl.getBoundingClientRect(), g = geom(), dx = 0, dy = 0;
        if (d.kind === "sel" || d.kind === "fill" || d.kind === "point" || d.kind === "cols" || d.kind === "rows") {
          if (d.lastX > rc.right - 4) dx = d.lastX - rc.right + 4; else if (d.lastX < rc.left + (g.hw + g.FW) * g.z && d.kind !== "rows") dx = Math.min(0, d.lastX - rc.left - (g.hw + g.FW) * g.z);
          if (d.lastY > rc.bottom - 4) dy = d.lastY - rc.bottom + 4; else if (d.lastY < rc.top + (g.hh + g.FH) * g.z && d.kind !== "cols") dy = Math.min(0, d.lastY - rc.top - (g.hh + g.FH) * g.z);
          if (dx || dy) {
            if (dx && scrollEl.scrollLeft + dx < 0) dx = -scrollEl.scrollLeft;
            if (dy && scrollEl.scrollTop + dy < 0) dy = -scrollEl.scrollTop;
            scrollEl.scrollLeft += Math.sign(dx) * Math.min(60, Math.abs(dx) * 0.5);
            scrollEl.scrollTop += Math.sign(dy) * Math.min(60, Math.abs(dy) * 0.5);
            dragMove(d.lastX, d.lastY);
          }
        }
        d.auto = requestAnimationFrame(tick);
      };
      d.auto = requestAnimationFrame(tick);
    }
    function dragMove(x, y, ev) {
      var d = drag;
      if (!d) return;
      var h = hit(x, y);
      if (d.kind === "sel") { if (h.r !== sh.sel.er || h.c !== sh.sel.ec) extendTo(h.r, h.c); updateNameBox(); }
      else if (d.kind === "cols") { var s = sh.sel; s.ranges[s.ranges.length - 1] = { r1: 0, c1: Math.min(d.c0, h.c), r2: MAXR - 1, c2: Math.max(d.c0, h.c) }; selChanged(); }
      else if (d.kind === "rows") { var s2 = sh.sel; s2.ranges[s2.ranges.length - 1] = { r1: Math.min(d.r0, h.r), c1: 0, r2: Math.max(d.r0, h.r), c2: MAXC - 1 }; selChanged(); }
      else if (d.kind === "point") { pointAt(Math.min(d.r0, h.r), Math.min(d.c0, h.c), Math.max(d.r0, h.r), Math.max(d.c0, h.c)); editing.point.r = d.r0; editing.point.c = d.c0; }
      else if (d.kind === "colw") {
        var w = Math.max(0, Math.round(d.w0 + (x - d.x0) / zoom));
        d.w = w;
        var tmp = new Map(sh.cols.size);
        d.list.forEach(function (c) { tmp.set(c, w); });
        if (!d.orig) d.orig = sh.cols.size;
        sh.cols.size = tmp;
        sh.cols.dirty();
        updateSpace();
        paintSoon();
        showSizeTip(x, y, "宽度：" + w + " 像素");
      } else if (d.kind === "rowh") {
        var hgt = Math.max(0, Math.round(d.h0 + (y - d.y0) / zoom));
        d.h = hgt;
        var tmp2 = new Map(sh.rows.size);
        d.list.forEach(function (r) { tmp2.set(r, hgt); });
        if (!d.orig) d.orig = sh.rows.size;
        sh.rows.size = tmp2;
        sh.rows.dirty();
        updateSpace();
        paintSoon();
        showSizeTip(x, y, "高度：" + hgt + " 像素");
      } else if (d.kind === "fill") {
        var src = d.src, dst = null;
        var below = h.r > src.r2, above = h.r < src.r1, right = h.c > src.c2, left = h.c < src.c1;
        var vd = below ? h.r - src.r2 : above ? src.r1 - h.r : 0, hd = right ? h.c - src.c2 : left ? src.c1 - h.c : 0;
        if (vd >= hd && vd > 0) dst = below ? { r1: src.r1, c1: src.c1, r2: h.r, c2: src.c2, dir: "down", n: vd } : { r1: h.r, c1: src.c1, r2: src.r2, c2: src.c2, dir: "up", n: vd };
        else if (hd > 0) dst = right ? { r1: src.r1, c1: src.c1, r2: src.r2, c2: h.c, dir: "right", n: hd } : { r1: src.r1, c1: h.c, r2: src.r2, c2: src.c2, dir: "left", n: hd };
        d.dst = dst;
        paintSoon();
      }
    }
    function dragEnd() {
      var d = drag;
      hideSizeTip();
      if (d.kind === "colw" && d.orig) {
        var nu = sh.cols.size;
        sh.cols.size = d.orig;
        sh.cols.dirty();
        tx("调整列宽", function () { setProp(sh.cols, "size", nu); if (d.w === 0) { var hs = new Set(sh.cols.hidden); d.list.forEach(function (c) { hs.add(c); nu.delete(c); }); setProp(sh.cols, "hidden", hs); } });
      } else if (d.kind === "rowh" && d.orig) {
        var nu2 = sh.rows.size;
        sh.rows.size = d.orig;
        sh.rows.dirty();
        tx("调整行高", function () { setProp(sh.rows, "size", nu2); if (d.h === 0) { var hs = new Set(sh.rows.hidden); d.list.forEach(function (r) { hs.add(r); nu2.delete(r); }); setProp(sh.rows, "hidden", hs); } });
      } else if (d.kind === "fill" && d.dst) {
        doFill(d.src, d.dst.dir, d.dst.n);
        var t = d.dst;
        setSel(t.dir === "up" ? t.r1 : d.src.r1, t.dir === "left" ? t.c1 : d.src.c1, t.r2, t.c2);
        sh.sel.r = d.src.r1; sh.sel.c = d.src.c1;
        selChanged();
      }
    }
    var sizeTip = null;
    function showSizeTip(x, y, text) {
      if (!sizeTip) { sizeTip = el("div", "nb-sizetip"); document.body.appendChild(sizeTip); }
      sizeTip.textContent = text;
      sizeTip.style.left = x + 12 + "px";
      sizeTip.style.top = y - 30 + "px";
    }
    function hideSizeTip() { if (sizeTip) { sizeTip.remove(); sizeTip = null; } }
    scrollEl.addEventListener("scroll", function () {
      var nearR = scrollEl.scrollTop + scrollEl.clientHeight > scrollEl.scrollHeight - scrollEl.clientHeight * 0.5;
      var nearC = scrollEl.scrollLeft + scrollEl.clientWidth > scrollEl.scrollWidth - scrollEl.clientWidth * 0.5;
      if (nearR && rowsN < MAXR) { rowsN = Math.min(MAXR, rowsN + 200); updateSpace(); }
      if (nearC && colsN < MAXC) { colsN = Math.min(MAXC, colsN + 20); updateSpace(); }
      sh.scroll = { x: scrollEl.scrollLeft, y: scrollEl.scrollTop };
      paint();
      if (!acEl.hidden || !tipEl.hidden) { if (editing) { placeAssist(acEl); placeAssist(tipEl); } }
    }, { passive: true });
    // 触控板捏合 / ⌘ 滚轮 = 缩放
    scrollEl.addEventListener("wheel", function (e) { if (e.ctrlKey) { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY / 300)); } }, { passive: false });
    function ensureFocus() { if (!editing && document.activeElement !== ed) ed.focus({ preventScroll: true }); }
    function focus() { if (editing) editing.input.focus({ preventScroll: true }); else ed.focus({ preventScroll: true }); }

    // ======== 拷贝 / 剪切 / 粘贴 ========
    function copyData(rg) {
      var rows = [], html = ['<table style="border-collapse:collapse">'], tsvRows = [], cells = [];
      for (var r = rg.r1; r <= rg.r2; r++) {
        if (sh.rows.isHidden(r) && sh.rows.fhidden.has(r)) continue;
        var line = [], row = [], hrow = ["<tr>"];
        for (var c = rg.c1; c <= rg.c2; c++) {
          var cell = cellAt(sh, r, c), st = styleOf(sh, r, c), v = valueOf(sh, r, c), dv = display(v, st, cell, null), t = dv ? dv.text : "";
          line.push(/[\t\n"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t);
          row.push({ cell: cell || null, style: book.styles.get(cell ? cell.s || 0 : styleId(sh, r, c)), r: r, c: c });
          var css = [];
          if (st.b) css.push("font-weight:bold");
          if (st.i) css.push("font-style:italic");
          if (st.u) css.push("text-decoration:underline");
          if (st.color) css.push("color:" + st.color);
          if (st.fill) css.push("background:" + st.fill);
          if (st.ha) css.push("text-align:" + st.ha);
          if (st.sz) css.push("font-size:" + st.sz + "pt");
          if (st.font) css.push("font-family:" + st.font);
          hrow.push("<td" + (css.length ? ' style="' + css.join(";") + '"' : "") + (typeof v === "number" ? ' data-num="' + v + '"' : "") + ">" + esc(t).replace(/\n/g, "<br>") + "</td>");
        }
        tsvRows.push(line.join("\t"));
        cells.push(row);
        hrow.push("</tr>");
        html.push(hrow.join(""));
      }
      html.push("</table>");
      return { tsv: tsvRows.join("\n"), html: '<meta charset="utf-8">' + html.join(""), cells: cells, rows: cells.length, cols: rg.c2 - rg.c1 + 1, src: { sheet: sh, r1: rg.r1, c1: rg.c1, r2: rg.r2, c2: rg.c2 }, book: book };
    }
    function onCopy(e, cut) {
      if (editing) return;
      if (sh.sel.ranges.length > 1) { e.preventDefault(); D.alert({ window: doc.win.el.id, title: "不能拷贝多个选区", message: "一次选一块区域再拷贝。", icon: "caution" }); return; }
      var rg = clipToUsedIfHuge(expandMerges(curRange()));
      if ((rg.r2 - rg.r1 + 1) * (rg.c2 - rg.c1 + 1) > 2000000) rg = clipToUsed(rg);
      var data = copyData(rg);
      data.cut = !!cut;
      clip = data;
      e.clipboardData.setData("text/plain", data.tsv);
      e.clipboardData.setData("text/html", data.html);
      e.preventDefault();
      copyMark = { sheet: sh, r1: rg.r1, c1: rg.c1, r2: rg.r2, c2: rg.c2, cut: !!cut, keep: true };
      startAnts();
    }
    ed.addEventListener("copy", function (e) { onCopy(e, false); });
    ed.addEventListener("cut", function (e) { onCopy(e, true); });
    ed.addEventListener("paste", function (e) {
      if (editing) return;
      e.preventDefault();
      var text = e.clipboardData.getData("text/plain"), html = e.clipboardData.getData("text/html");
      pasteAny(text, html, false);
    });
    function pasteAny(text, html, valuesOnly) {
      if (clip && text != null && text.replace(/\r\n/g, "\n") === clip.tsv.replace(/\r\n/g, "\n")) return pasteInternal(clip, valuesOnly);
      if (html && /<table/i.test(html)) { var grid = parseHTMLTable(html); if (grid && grid.length) return pasteGrid(grid, valuesOnly); }
      if (text) pasteGrid(parseTSV(text).map(function (row) { return row.map(function (t) { return { text: t }; }); }), valuesOnly);
    }
    function parseTSV(text) {
      text = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
      if (text.indexOf("\t") < 0 && text.indexOf('"') < 0) return text.split("\n").map(function (l) { return [l]; });
      return NB.parseCSV(text, "\t").rows.map(function (row) { return row.map(function (x) { return typeof x === "object" ? x.q : x; }); });
    }
    function parseHTMLTable(html) {
      var dom = new DOMParser().parseFromString(html, "text/html"), table = dom.querySelector("table");
      if (!table) return null;
      var out = [];
      table.querySelectorAll("tr").forEach(function (tr) {
        var row = [];
        tr.querySelectorAll("td, th").forEach(function (td) {
          var s = td.getAttribute("style") || "", st = {};
          if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(s) || td.querySelector("b, strong") || td.tagName === "TH") st.b = 1;
          if (/font-style\s*:\s*italic/i.test(s) || td.querySelector("i, em")) st.i = 1;
          var col = /(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,6}|rgb\([^)]*\))/i.exec(s), bg = /background(?:-color)?\s*:\s*(#[0-9a-f]{3,6}|rgb\([^)]*\))/i.exec(s);
          if (col) st.color = hexOf(col[1]);
          if (bg) st.fill = hexOf(bg[1]);
          if (st.fill === "#ffffff") delete st.fill;
          if (st.color === "#000000") delete st.color;
          var text = td.innerText != null ? td.innerText : td.textContent;
          td.querySelectorAll("br").forEach(function (b) { b.replaceWith("\n"); });
          text = td.textContent.replace(/ /g, " ").replace(/^\s+|\s+$/g, "");
          var num = td.getAttribute("data-num");
          row.push({ text: text, style: Object.keys(st).length ? st : null, num: num != null ? +num : null });
          var span = +(td.getAttribute("colspan") || 1);
          for (var i = 1; i < span; i++) row.push({ text: "" });
        });
        out.push(row);
      });
      return out;
    }
    function hexOf(c) {
      var m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
      if (m) return ("#" + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toLowerCase();
      var r = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(c);
      if (r) return "#" + [r[1], r[2], r[3]].map(function (x) { var h = (+x).toString(16); return h.length < 2 ? "0" + h : h; }).join("");
      return c.toLowerCase();
    }
    // 粘贴的目标：选区是来源大小的整数倍 → 铺满；否则从活动格开始按来源大小
    function pasteTarget(rows, cols) {
      var rg = curRange(), R = rg.r2 - rg.r1 + 1, C = rg.c2 - rg.c1 + 1;
      if (sh.sel.ranges.length === 1 && R % rows === 0 && C % cols === 0 && R * C <= 200000 && (R > rows || C > cols)) return { r1: rg.r1, c1: rg.c1, r2: rg.r2, c2: rg.c2 };
      var r0 = sh.sel.ranges.length === 1 ? rg.r1 : sh.sel.r, c0 = sh.sel.ranges.length === 1 ? rg.c1 : sh.sel.c;
      return { r1: r0, c1: c0, r2: Math.min(MAXR - 1, r0 + rows - 1), c2: Math.min(MAXC - 1, c0 + cols - 1) };
    }
    function pasteGrid(grid, valuesOnly) {
      var rows = grid.length, cols = Math.max.apply(null, grid.map(function (r) { return r.length; }).concat([1]));
      var t = pasteTarget(rows, cols);
      tx("粘贴", function () {
        for (var r = t.r1; r <= t.r2; r++) for (var c = t.c1; c <= t.c2; c++) {
          var src = (grid[(r - t.r1) % rows] || [])[(c - t.c1) % cols] || { text: "" };
          var o = src.num != null && !isNaN(src.num) ? Object.assign({}, cellFromText(sh, r, c, src.text), { v: src.num }) : cellFromText(sh, r, c, src.text);
          if (o && o.f != null) { o = cellFromText(sh, r, c, "'" + src.text); } // 从外面贴进来的 = 开头的文字不当公式
          if (src.style && !valuesOnly) { var base = o ? o.s || 0 : styleId(sh, r, c), ns = book.styles.with(base, src.style); o = Object.assign(o || { v: null }, { s: ns }); }
          setCell(sh, r, c, o);
        }
      });
      setSel(t.r1, t.c1, t.r2, t.c2);
      sh.sel.r = t.r1; sh.sel.c = t.c1;
      selChanged();
    }
    function pasteInternal(cb, valuesOnly) {
      var t = pasteTarget(cb.rows, cb.cols), srcBook = cb.book, sameBook = srcBook === book, calcSrc = sameBook ? calc : NB.calcFor(srcBook);
      var styleMap = new Map(), sid = function (stObj) { var key = JSON.stringify(stObj); var id = styleMap.get(key); if (id == null) { id = book.styles.id(stObj); styleMap.set(key, id); } return id; };
      var cut = cb.cut && sameBook && !valuesOnly;
      tx(cut ? "移动" : "粘贴", function () {
        var dr = t.r1 - cb.src.r1, dc = t.c1 - cb.src.c1;
        if (cut) {
          // 剪切：先清掉原处（和目标重叠的部分之后会被盖上）
          for (var r0 = cb.src.r1; r0 <= cb.src.r2; r0++) for (var c0 = cb.src.c1; c0 <= cb.src.c2; c0++) setCell(cb.src.sheet, r0, c0, null);
        }
        for (var r = t.r1; r <= t.r2; r++) for (var c = t.c1; c <= t.c2; c++) {
          var i = (r - t.r1) % cb.rows, j = (c - t.c1) % cb.cols, src = cb.cells[i] && cb.cells[i][j];
          if (!src) continue;
          var cell = src.cell, o = null;
          if (cell) {
            o = Object.assign({}, cell);
            if (valuesOnly) { var v = cell.f != null ? calcSrc.get(cb.src.sheet.name, src.r, src.c) : cell.v; o = { v: v === undefined ? null : v }; var keep = cellAt(sh, r, c); if (keep && keep.s) o.s = keep.s; }
            else {
              if (cell.f != null && !cut) o.f = FX.shift(cell.f, r - src.r, c - src.c);
              if (!sameBook) { if (cell.s) o.s = sid(src.style); }
            }
          } else if (!valuesOnly && src.style && Object.keys(src.style).length) o = { v: null, s: sid(src.style) };
          setCell(sh, r, c, o);
        }
        if (cut) {
          // 别的公式里指向被移走区域的引用，跟着指到新位置
          var from = cb.src;
          book.sheets.forEach(function (s) {
            s.cells.forEach(function (cell, k) {
              if (cell.f == null) return;
              var nf = FX.mapRefs(cell.f, function (n) {
                var ns = n.sheet ? NB.sheetByName(book, n.sheet) : s;
                if (ns !== from.sheet) return n;
                var o2 = Object.assign({}, n);
                if (n.t === "ref") { if (n.r >= from.r1 && n.r <= from.r2 && n.c >= from.c1 && n.c <= from.c2) { o2.r += dr; o2.c += dc; if (from.sheet !== sh) o2.sheet = sh.name; } return o2; }
                if (n.r1 >= from.r1 && n.r2 <= from.r2 && n.c1 >= from.c1 && n.c2 <= from.c2 && !n.wholeCol && !n.wholeRow) { o2.r1 += dr; o2.r2 += dr; o2.c1 += dc; o2.c2 += dc; if (from.sheet !== sh) o2.sheet = sh.name; }
                return o2;
              });
              if (nf !== cell.f) setCell(s, KR(k), KC(k), Object.assign({}, cell, { f: nf }));
            });
          });
        }
      });
      if (cut) { clip = null; stopAnts(); }
      setSel(t.r1, t.c1, t.r2, t.c2);
      sh.sel.r = t.r1; sh.sel.c = t.c1;
      selChanged();
    }
    function copyFromMenu(cut) {
      ensureFocus();
      var ok = false;
      try { ok = document.execCommand(cut ? "cut" : "copy"); } catch (e) { ok = false; }
      if (!ok) { var data = copyData(clipToUsedIfHuge(curRange())); data.cut = cut; clip = data; if (navigator.clipboard) navigator.clipboard.writeText(data.tsv).catch(function () {}); copyMark = Object.assign({ sheet: sh, cut: cut, keep: true }, data.src); startAnts(); }
    }
    function pasteFromMenu(valuesOnly) {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (t) { pasteAny(t, null, valuesOnly); }, function () { if (clip) pasteInternal(clip, valuesOnly); });
      } else if (clip) pasteInternal(clip, valuesOnly);
    }
    function startAnts() {
      clearInterval(antsT);
      antsT = setInterval(function () { antsOff = (antsOff + 1) % 14; paintSoon(); }, 70);
      paintSoon();
    }
    function stopAnts() { clearInterval(antsT); antsT = 0; copyMark = null; paintSoon(); }

    // ======== 填充（填充柄、⌘D、⌘R）========
    var LISTS = [
      ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"], ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
      ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"],
      ["第一季度", "第二季度", "第三季度", "第四季度"], ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"], ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"],
      ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
      ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], ["Q1", "Q2", "Q3", "Q4"],
    ];
    // 一条线上的来源格子 → 往后（或往前）接着的 n 个
    function series(src, n, back) {
      var L = src.length, out = [];
      var vals = src.map(function (x) { return x.cell ? x.cell : null; });
      var isNum = vals.every(function (c) { return c && c.f == null && typeof c.v === "number"; });
      var st0 = vals[0] ? book.styles.get(vals[0].s || 0) : {};
      var isDate = isNum && st0.nf && FX.isDateFormat(st0.nf);
      var gen = null;
      if (isNum && (L >= 2 || isDate)) {
        var xs = vals.map(function (c) { return c.v; });
        if (isDate && L >= 2) {
          var a = FX.ymdOf(xs[0]), b = FX.ymdOf(xs[1]), mstep = (b.y - a.y) * 12 + b.m - a.m;
          if (a.d === b.d && mstep !== 0 && xs.every(function (v, i) { var p = FX.ymdOf(v); return p.d === a.d && (p.y - a.y) * 12 + p.m - a.m === mstep * i; })) {
            gen = function (k) { var p = FX.ymdOf(xs[back ? 0 : L - 1]), mm = p.m + (back ? -k : k) * mstep; return FX.serialOf(p.y, mm, Math.min(p.d, FX.ymdOf(FX.serialOf(p.y, mm + 1, 0)).d)) + (xs[0] - Math.floor(xs[0])); };
          }
        }
        if (!gen) {
          var step;
          if (L === 1) step = 1;
          else {
            var diffs = [], ok = true;
            for (var i = 1; i < L; i++) diffs.push(xs[i] - xs[i - 1]);
            diffs.forEach(function (d) { if (Math.abs(d - diffs[0]) > 1e-9 * Math.max(1, Math.abs(d))) ok = false; });
            if (ok) step = diffs[0];
            else { // 线性趋势（最小二乘）
              var mx = (L - 1) / 2, my = xs.reduce(function (s, v) { return s + v; }, 0) / L, num = 0, den = 0;
              xs.forEach(function (v, i2) { num += (i2 - mx) * (v - my); den += (i2 - mx) * (i2 - mx); });
              var slope = num / den, icpt = my - slope * mx;
              gen = function (k) { var x = back ? -k : L - 1 + k; return clean(icpt + slope * x); };
            }
          }
          if (!gen) gen = function (k) { return clean(back ? xs[0] - step * k : xs[L - 1] + step * k); };
        }
        for (var k = 1; k <= n; k++) { var srcCell = vals[back ? (L - (k - 1) % L - 1) : (k - 1) % L]; out.push(Object.assign({}, srcCell, { v: gen(k) })); }
        return out;
      }
      // 文字：列表（星期、月份……）或者末尾带数字
      var texts = vals.map(function (c) { return c && c.f == null && typeof c.v === "string" ? c.v : null; });
      if (texts.every(function (t) { return t != null; })) {
        var list = LISTS.find(function (l) { return texts.every(function (t) { return l.indexOf(t) >= 0; }); });
        if (list) {
          var idx = texts.map(function (t) { return list.indexOf(t); }), lstep = L >= 2 ? ((idx[1] - idx[0]) % list.length + list.length) % list.length || 1 : 1;
          for (var k2 = 1; k2 <= n; k2++) { var base = back ? idx[0] - lstep * k2 : idx[L - 1] + lstep * k2, sc = vals[back ? (L - (k2 - 1) % L - 1) : (k2 - 1) % L]; out.push(Object.assign({}, sc, { v: list[((base % list.length) + list.length) % list.length] })); }
          return out;
        }
        var parts = texts.map(function (t) { return /^(.*?)(\d+)(\D*)$/.exec(t); });
        if (parts.every(function (p) { return p && p[1] === parts[0][1] && p[3] === parts[0][3]; })) {
          var nums = parts.map(function (p) { return +p[2]; }), nstep = L >= 2 ? nums[1] - nums[0] : 1, width = parts[0][2].length, zero = /^0/.test(parts[0][2]);
          for (var k3 = 1; k3 <= n; k3++) {
            var nv = back ? nums[0] - nstep * k3 : nums[L - 1] + nstep * k3, s = String(Math.abs(nv));
            if (zero) while (s.length < width) s = "0" + s;
            var sc2 = vals[back ? (L - (k3 - 1) % L - 1) : (k3 - 1) % L];
            out.push(Object.assign({}, sc2, { v: parts[0][1] + (nv < 0 ? "-" : "") + s + parts[0][3] }));
          }
          return out;
        }
      }
      // 其余：照着循环拷贝（公式平移）
      for (var k4 = 1; k4 <= n; k4++) {
        var si = back ? L - 1 - (k4 - 1) % L : (k4 - 1) % L, sc3 = src[si];
        out.push(sc3.cell ? Object.assign({ _from: sc3 }, sc3.cell) : sc3.style ? { v: null, s: sc3.style, _from: sc3 } : { _from: sc3, _empty: true });
      }
      return out;
    }
    var clean = function (v) { return Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : parseFloat(v.toPrecision(15)); };
    function doFill(src, dir, n) {
      tx("填充", function () {
        var vertical = dir === "down" || dir === "up", back = dir === "up" || dir === "left";
        var lines = vertical ? src.c2 - src.c1 + 1 : src.r2 - src.r1 + 1, L = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1;
        for (var li = 0; li < lines; li++) {
          var cells = [];
          for (var i = 0; i < L; i++) {
            var r = vertical ? src.r1 + i : src.r1 + li, c = vertical ? src.c1 + li : src.c1 + i, cell = cellAt(sh, r, c);
            cells.push({ cell: cell || null, style: cell ? 0 : styleId(sh, r, c), r: r, c: c });
          }
          var gen = series(cells, n, back);
          gen.forEach(function (o, k) {
            var step = k + 1, r2 = vertical ? (back ? src.r1 - step : src.r2 + step) : src.r1 + li, c2 = vertical ? src.c1 + li : (back ? src.c1 - step : src.c2 + step);
            if (r2 < 0 || c2 < 0) return;
            var from = o._from;
            delete o._from;
            if (o._empty) { setCell(sh, r2, c2, null); return; }
            if (o.f != null && from) o.f = FX.shift(o.f, r2 - from.r, c2 - from.c);
            if (o.f != null) o.v = null;
            setCell(sh, r2, c2, o);
          });
        }
      });
    }
    function fillDir(dir) {
      var rg = curRange();
      if (dir === "down") {
        if (rg.r1 === rg.r2) { if (rg.r1 === 0) return; tx("向下填充", function () { for (var c = rg.c1; c <= Math.min(rg.c2, rg.c1 + 16383); c++) copyCell(rg.r1 - 1, c, rg.r1, c); }); }
        else tx("向下填充", function () { for (var c = rg.c1; c <= Math.min(rg.c2, NB.used(sh).c); c++) for (var r = rg.r1 + 1; r <= Math.min(rg.r2, Math.max(NB.used(sh).r, rg.r1 + 1)); r++) copyCell(rg.r1, c, r, c); });
      } else {
        if (rg.c1 === rg.c2) { if (rg.c1 === 0) return; tx("向右填充", function () { for (var r = rg.r1; r <= Math.min(rg.r2, NB.used(sh).r); r++) copyCell(r, rg.c1 - 1, r, rg.c1); }); }
        else tx("向右填充", function () { for (var r = rg.r1; r <= Math.min(rg.r2, NB.used(sh).r); r++) for (var c = rg.c1 + 1; c <= rg.c2; c++) copyCell(r, rg.c1, r, c); });
      }
    }
    function copyCell(r0, c0, r1, c1) {
      var cell = cellAt(sh, r0, c0);
      if (!cell) { setCell(sh, r1, c1, null); return; }
      var o = Object.assign({}, cell);
      if (o.f != null) { o.f = FX.shift(o.f, r1 - r0, c1 - c0); o.v = null; }
      setCell(sh, r1, c1, o);
    }
    function insertNow(kind) {
      var now = FX.nowSerial();
      if (kind === "date") writeTextStyled(Math.floor(now), "yyyy-mm-dd");
      else writeTextStyled(now - Math.floor(now), "hh:mm");
    }
    function writeTextStyled(v, nf) {
      var r = sh.sel.r, c = sh.sel.c, old = cellAt(sh, r, c), sid = old ? old.s || 0 : styleId(sh, r, c), st = book.styles.get(sid);
      tx("插入日期", function () { setCell(sh, r, c, { v: v, s: st.nf && FX.isDateFormat(st.nf) ? sid : book.styles.with(sid, { nf: nf }) }); });
    }

    // ======== 行列：插入、删除、隐藏、宽高 ========
    function shiftKeys(map, at, n, isSet) {
      var out = isSet ? new Set() : new Map();
      map.forEach(function (v, k) {
        var key = isSet ? v : k, val = isSet ? null : v;
        if (n < 0 && key >= at && key < at - n) return;
        var nk = key >= at ? key + n : key;
        if (isSet) out.add(nk); else out.set(nk, val);
      });
      return out;
    }
    function shiftRange(m, axis, at, n) {
      var a1 = axis === "r" ? "r1" : "c1", a2 = axis === "r" ? "r2" : "c2", o = Object.assign({}, m);
      if (n > 0) { if (o[a1] >= at) o[a1] += n; if (o[a2] >= at) o[a2] += n; return o; }
      var end = at - n - 1;
      if (o[a2] < at) return o;
      if (o[a1] > end) { o[a1] += n; o[a2] += n; return o; }
      if (o[a1] >= at && o[a2] <= end) return null;
      o[a1] = o[a1] < at ? o[a1] : at;
      o[a2] = o[a2] > end ? o[a2] + n : at - 1;
      return o[a2] < o[a1] ? null : o;
    }
    // axis：r / c；n > 0 插入，n < 0 删除 [at, at - n)
    function structural(axis, at, n, label) {
      tx(label, function () {
        var old = sh.cells, nu = new Map();
        old.forEach(function (cell, k) {
          var r = KR(k), c = KC(k), p = axis === "r" ? r : c;
          if (n < 0 && p >= at && p < at - n) return;
          if (p >= at) { if (axis === "r") r += n; else c += n; }
          if (r >= MAXR || c >= MAXC) return;
          nu.set(K(r, c), cell);
        });
        setProp(sh, "cells", nu);
        sh.usedDirty = true;
        // 所有公式里指向这张表的引用跟着挪
        book.sheets.forEach(function (s) {
          s.cells.forEach(function (cell, k) {
            if (cell.f == null) return;
            var nf = FX.adjust(cell.f, s.name, sh.name, axis, at, n);
            if (nf !== cell.f) setCell(s, KR(k), KC(k), Object.assign({}, cell, { f: nf }));
          });
        });
        var ax = axis === "r" ? sh.rows : sh.cols;
        setProp(ax, "size", shiftKeys(ax.size, at, n));
        setProp(ax, "hidden", shiftKeys(ax.hidden, at, n, true));
        if (axis === "r") setProp(ax, "fhidden", shiftKeys(ax.fhidden, at, n, true));
        if (axis === "r") setProp(sh, "rowStyle", shiftKeys(sh.rowStyle, at, n)); else setProp(sh, "colStyle", shiftKeys(sh.colStyle, at, n));
        setProp(sh, "merges", sh.merges.map(function (m) { return shiftRange(m, axis, at, n); }).filter(function (m) { return m && (m.r2 > m.r1 || m.c2 > m.c1); }));
        var fz = sh.freeze, fk = axis === "r" ? "r" : "c";
        if (fz[fk] > at) { var nf2 = Object.assign({}, fz); nf2[fk] = Math.max(at, fz[fk] + n); setProp(sh, "freeze", nf2); }
        if (sh.filter) { var f = shiftRange(sh.filter, axis, at, n); if (f) { f.cols = {}; Object.keys(sh.filter.cols || {}).forEach(function (c) { var nc = axis === "c" ? (+c >= at ? +c + n : +c) : +c; if (!(axis === "c" && n < 0 && +c >= at && +c < at - n)) f.cols[nc] = sh.filter.cols[c]; }); } setProp(sh, "filter", f); }
      });
    }
    function selRowsCols(axis) {
      // 选中的整行（整列）；没有的话就是选区覆盖的那些
      var rg = curRange(), a = axis === "r" ? rg.r1 : rg.c1, b = axis === "r" ? rg.r2 : rg.c2;
      return { at: a, n: Math.min(b - a + 1, axis === "r" ? 100000 : 16384) };
    }
    function insertRows(below) { var s = selRowsCols("r"); structural("r", below ? s.at + s.n : s.at, s.n, "插入行"); }
    function insertCols(right) { var s = selRowsCols("c"); structural("c", right ? s.at + s.n : s.at, s.n, "插入列"); }
    function deleteRows() { var rg0 = curRange(); if (rg0.r1 === 0 && rg0.r2 >= MAXR - 1) return; var s = selRowsCols("r"); structural("r", s.at, -s.n, "删除行"); setSel(Math.min(s.at, MAXR - 1), sh.sel.c); }
    function deleteCols() { var rg0 = curRange(); if (rg0.c1 === 0 && rg0.c2 >= MAXC - 1) return; var s = selRowsCols("c"); structural("c", s.at, -s.n, "删除列"); setSel(sh.sel.r, Math.min(s.at, MAXC - 1)); }
    function hideAxis(axis, hide) {
      var rg = curRange(), ax = axis === "r" ? sh.rows : sh.cols, a = axis === "r" ? rg.r1 : rg.c1, b = Math.min(axis === "r" ? rg.r2 : rg.c2, a + (axis === "r" ? 200000 : 16383));
      tx(hide ? (axis === "r" ? "隐藏行" : "隐藏列") : "取消隐藏", function () {
        var hs = new Set(ax.hidden);
        if (hide) for (var i = a; i <= b; i++) hs.add(i);
        else { if (a === b) { hs.delete(a - 1); hs.delete(a + 1); } for (var j = Math.max(0, a - 1); j <= b + 1; j++) hs.delete(j); }
        setProp(ax, "hidden", hs);
      });
    }
    function unhideAll(axis) { var ax = axis === "r" ? sh.rows : sh.cols; if (!ax.hidden.size) return; tx("取消隐藏", function () { setProp(ax, "hidden", new Set()); }); }
    function autofitCols(list) {
      var u = NB.used(sh);
      tx("自动调整列宽", function () {
        var size = new Map(sh.cols.size);
        list.forEach(function (c) {
          var best = 0;
          for (var r = 0; r <= u.r; r++) {
            if (!sh.rows.sz(r)) continue;
            var cell = cellAt(sh, r, c);
            if (!cell) continue;
            var m = mergeAt(r, c);
            if (m && (m.c1 !== m.c2)) continue;
            var st = book.styles.get(cell.s || 0), dv = display(valueOf(sh, r, c), st, cell, null);
            if (!dv) continue;
            var w = st.wrap ? 0 : Math.max.apply(null, dv.text.split("\n").map(function (t) { return measure(t, fontOf(st)); })) + 10 + (st.ind || 0) * 8;
            if (sh.filter && r === sh.filter.r1 && c >= sh.filter.c1 && c <= sh.filter.c2) w += 18;
            best = Math.max(best, w);
          }
          if (best) size.set(c, Math.min(800, Math.ceil(Math.max(24, best)))); else size.delete(c);
        });
        setProp(sh.cols, "size", size);
      });
    }
    function autofitRows(list) {
      tx("自动调整行高", function () {
        var size = new Map(sh.rows.size), u = NB.used(sh);
        list.forEach(function (r) {
          var best = 0;
          for (var c = 0; c <= u.c; c++) {
            var cell = cellAt(sh, r, c);
            if (!cell) continue;
            var st = book.styles.get(cell.s || 0), sz = (st.sz || DEF_SZ) * PT, dv = display(valueOf(sh, r, c), st, cell, null);
            if (!dv) continue;
            var lines = st.wrap ? wrapText(dv.text, fontOf(st), Math.max(8, sh.cols.sz(c) - 6)).length : 1;
            best = Math.max(best, lines * sz * 1.28 + 6);
          }
          if (best > sh.rows.def) size.set(r, Math.ceil(best)); else size.delete(r);
        });
        setProp(sh.rows, "size", size);
      });
    }
    function setSizes(axis, px) {
      var rg = curRange(), ax = axis === "r" ? sh.rows : sh.cols, a = axis === "r" ? rg.r1 : rg.c1, b = Math.min(axis === "r" ? rg.r2 : rg.c2, a + 20000);
      tx(axis === "r" ? "行高" : "列宽", function () { var m = new Map(ax.size); for (var i = a; i <= b; i++) m.set(i, px); setProp(ax, "size", m); });
    }

    // ======== 合并、冻结 ========
    function mergeSel(mode) {
      var rg = curRange();
      if (rg.r1 === rg.r2 && rg.c1 === rg.c2) return;
      if ((rg.r2 - rg.r1 + 1) * (rg.c2 - rg.c1 + 1) > 100000) return;
      var hasData = 0;
      for (var r = rg.r1; r <= rg.r2; r++) for (var c = rg.c1; c <= rg.c2; c++) if ((r !== rg.r1 || c !== rg.c1) && !isEmpty(r, c)) hasData++;
      var go = function () {
        tx("合并单元格", function () {
          var list = sh.merges.filter(function (m) { return m.r2 < rg.r1 || m.r1 > rg.r2 || m.c2 < rg.c1 || m.c1 > rg.c2; });
          if (mode === "across") { for (var r2 = rg.r1; r2 <= rg.r2; r2++) if (rg.c2 > rg.c1) list.push({ r1: r2, c1: rg.c1, r2: r2, c2: rg.c2 }); }
          else list.push({ r1: rg.r1, c1: rg.c1, r2: rg.r2, c2: rg.c2 });
          setProp(sh, "merges", list);
          for (var r = rg.r1; r <= rg.r2; r++) for (var c = rg.c1; c <= rg.c2; c++) {
            var keepCol = mode === "across" ? c === rg.c1 : r === rg.r1 && c === rg.c1;
            if (!keepCol) { var cell = cellAt(sh, r, c); if (cell && (cell.v != null || cell.f != null)) setCell(sh, r, c, cell.s ? { v: null, s: cell.s } : null); }
          }
          var tl = cellAt(sh, rg.r1, rg.c1), st = book.styles.get(tl ? tl.s || 0 : 0);
          if (!st.ha) { eachRangeTopLeft(rg, mode, function (r, c) { var cc = cellAt(sh, r, c); var ns = book.styles.with(cc ? cc.s || 0 : styleId(sh, r, c), { ha: "center" }); setCell(sh, r, c, Object.assign(cc || { v: null }, { s: ns })); }); }
        });
      };
      if (hasData) D.alert({ window: doc.win.el.id, title: "合并单元格只保留左上角的值", message: "其余 " + hasData + " 个格子里的内容会被清掉。", icon: "caution", buttons: [{ label: "取消", role: "cancel" }, { label: "合并", role: "default" }] }).then(function (b) { if (b === "合并") go(); });
      else go();
    }
    function eachRangeTopLeft(rg, mode, fn) { if (mode === "across") for (var r = rg.r1; r <= rg.r2; r++) fn(r, rg.c1); else fn(rg.r1, rg.c1); }
    function unmergeSel() {
      var rg = curRange();
      var list = sh.merges.filter(function (m) { return m.r2 < rg.r1 || m.r1 > rg.r2 || m.c2 < rg.c1 || m.c1 > rg.c2; });
      if (list.length === sh.merges.length) return;
      tx("取消合并", function () { setProp(sh, "merges", list); });
    }
    var selHasMerge = function () { var rg = curRange(); return sh.merges.some(function (m) { return !(m.r2 < rg.r1 || m.r1 > rg.r2 || m.c2 < rg.c1 || m.c1 > rg.c2); }); };
    function setFreeze(r, c) { tx(r || c ? "冻结" : "取消冻结", function () { setProp(sh, "freeze", { r: r, c: c }); }); scrollEl.scrollTop = 0; scrollEl.scrollLeft = 0; }

    // ======== 排序、过滤 ========
    // 当前区域：活动格周围连着的一块数据（同 Excel 的 ⌃A / 当前区域）
    function currentRegion(r, c) {
      var rg = { r1: r, c1: c, r2: r, c2: c }, grew = true, n = 0;
      var has = function (rr, cc) { return rr >= 0 && cc >= 0 && !isEmpty(rr, cc); };
      while (grew && n++ < 2000) {
        grew = false;
        var i;
        for (i = rg.c1 - 1; i <= rg.c2 + 1; i++) { if (has(rg.r1 - 1, i)) { rg.r1--; grew = true; break; } }
        for (i = rg.c1 - 1; i <= rg.c2 + 1; i++) { if (has(rg.r2 + 1, i)) { rg.r2++; grew = true; break; } }
        for (i = rg.r1 - 1; i <= rg.r2 + 1; i++) { if (has(i, rg.c1 - 1)) { rg.c1--; grew = true; break; } }
        for (i = rg.r1 - 1; i <= rg.r2 + 1; i++) { if (has(i, rg.c2 + 1)) { rg.c2++; grew = true; break; } }
      }
      return rg;
    }
    function looksLikeHeader(rg) {
      if (rg.r2 <= rg.r1) return false;
      var textTop = 0, numBelow = 0, cols = 0;
      for (var c = rg.c1; c <= rg.c2; c++) {
        var a = valueOf(sh, rg.r1, c), b = valueOf(sh, rg.r1 + 1, c);
        if (a == null) continue;
        cols++;
        if (typeof a === "string") textTop++;
        if (typeof b === "number" || typeof b === "string" && typeof a === "string" && styleOf(sh, rg.r1, c).b && !styleOf(sh, rg.r1 + 1, c).b) numBelow++;
      }
      return cols > 0 && textTop === cols && (numBelow > 0 || styleOf(sh, rg.r1, rg.c1).b || styleOf(sh, rg.r1, rg.c1).fill);
    }
    // 过滤区域的最后一行：记下的范围，再往下接着有数据的行也算（同 Excel：紧挨着新加的行会并进来）
    function filterLast(s) {
      var f = s.filter, u = NB.used(s), r = f.r2;
      var rowHas = function (rr) { for (var c = f.c1; c <= f.c2; c++) { var cell = s.cells.get(K(rr, c)); if (cell && (cell.v != null && cell.v !== "" || cell.f != null)) return true; } return false; };
      while (r + 1 <= u.r && rowHas(r + 1)) r++;
      return r;
    }
    function sortTarget() {
      if (sh.filter) return { rg: { r1: sh.filter.r1, c1: sh.filter.c1, r2: filterLast(sh), c2: sh.filter.c2 }, header: true };
      var rg = curRange();
      if (rg.r1 === rg.r2 && rg.c1 === rg.c2) { var cr = currentRegion(rg.r1, rg.c1); return { rg: cr, header: looksLikeHeader(cr) }; }
      var u = NB.used(sh), r = { r1: rg.r1, c1: rg.c1, r2: Math.min(rg.r2, u.r), c2: Math.min(rg.c2, u.c) };
      return { rg: r, header: looksLikeHeader(r) && rg.r2 - rg.r1 > 1 };
    }
    function sortBy(keys, target) {
      target = target || sortTarget();
      var rg = target.rg, r0 = rg.r1 + (target.header ? 1 : 0);
      if (rg.r2 <= r0) return;
      if (sh.merges.some(function (m) { return !(m.r2 < r0 || m.r1 > rg.r2 || m.c2 < rg.c1 || m.c1 > rg.c2); })) {
        D.alert({ window: doc.win.el.id, title: "有合并的单元格，不能排序", message: "先取消合并再排序。", icon: "caution" });
        return;
      }
      var rows = [];
      for (var r = r0; r <= rg.r2; r++) rows.push(r);
      var vals = new Map();
      rows.forEach(function (r) { vals.set(r, keys.map(function (k) { return valueOf(sh, r, k.c); })); });
      rows.sort(function (a, b) {
        var va = vals.get(a), vb = vals.get(b);
        for (var i = 0; i < keys.length; i++) {
          var x = va[i], y = vb[i], ex = x == null || x === "", ey = y == null || y === "";
          if (ex || ey) { if (ex && ey) continue; return ex ? 1 : -1; } // 空的总在最后
          if (FX.isErr(x) || FX.isErr(y)) { if (FX.isErr(x) && FX.isErr(y)) continue; return FX.isErr(x) ? 1 : -1; }
          var cmp = typeof x === "string" && typeof y === "string" ? x.localeCompare(y, "zh-Hans-CN", { numeric: true, sensitivity: "base" }) : FX.compare(x, y);
          if (cmp) return keys[i].desc ? -cmp : cmp;
        }
        return a - b;
      });
      tx("排序", function () {
        var snap = rows.map(function (r) { var a = []; for (var c = rg.c1; c <= rg.c2; c++) a.push(cellAt(sh, r, c)); return a; });
        rows.forEach(function (src, i) {
          var dst = r0 + i;
          for (var c = rg.c1; c <= rg.c2; c++) {
            var cell = snap[i][c - rg.c1];
            setCell(sh, dst, c, cell ? (cell.f != null && src !== dst ? Object.assign({}, cell, { f: FX.shift(cell.f, dst - src, 0) }) : cell) : null);
          }
        });
      });
    }
    function quickSort(desc) {
      var t = sortTarget();
      sortBy([{ c: sh.sel.c, desc: desc }], t);
    }
    function filterRangeFor() {
      var rg = curRange();
      if (rg.r1 === rg.r2 && rg.c1 === rg.c2) return currentRegion(rg.r1, rg.c1);
      var u = NB.used(sh);
      return { r1: rg.r1, c1: rg.c1, r2: Math.min(rg.r2, Math.max(u.r, rg.r1)), c2: Math.min(rg.c2, Math.max(u.c, rg.c1)) };
    }
    function toggleFilter() {
      if (sh.filter) { tx("关闭过滤", function () { setProp(sh, "filter", null); setProp(sh.rows, "fhidden", new Set()); }); return; }
      var rg = filterRangeFor();
      tx("过滤", function () { setProp(sh, "filter", { r1: rg.r1, c1: rg.c1, r2: rg.r2, c2: rg.c2, cols: {} }); });
    }
    function filterText(s, r, c) { var v = valueOf(s, r, c), dv = display(v, styleOf(s, r, c), cellAt(s, r, c), null); return dv ? dv.text : ""; }
    // 按条件算出要藏起来的行（过滤区域往下接着有数据的行也算进去）
    function applyFilterRows(s, quiet) {
      var f = s.filter;
      if (!f) { if (s.rows.fhidden.size) { if (quiet) { s.rows.fhidden = new Set(); s.rows.dirty(); } else setProp(s.rows, "fhidden", new Set()); } return; }
      var last = filterLast(s), hide = new Set(), crit = f.cols || {}, cols = Object.keys(crit);
      if (cols.length) {
        for (var r = f.r1 + 1; r <= last; r++) {
          for (var i = 0; i < cols.length; i++) {
            var c = +cols[i], cr = crit[c], t = filterText(s, r, c);
            var ok = true;
            if (cr.vals) ok = cr.vals.indexOf(t) >= 0;
            if (ok && cr.q) ok = t.toLowerCase().indexOf(cr.q.toLowerCase()) >= 0;
            if (!ok) { hide.add(r); break; }
          }
        }
      }
      var same = hide.size === s.rows.fhidden.size && Array.from(hide).every(function (x) { return s.rows.fhidden.has(x); });
      if (same) return;
      if (quiet) { s.rows.fhidden = hide; s.rows.dirty(); } else setProp(s.rows, "fhidden", hide);
    }
    function setFilterCol(c, cr) {
      tx("过滤", function () {
        var f = Object.assign({}, sh.filter, { cols: Object.assign({}, sh.filter.cols) });
        if (cr) f.cols[c] = cr; else delete f.cols[c];
        f.r2 = filterLast(sh);
        setProp(sh, "filter", f);
        applyFilterRows(sh, false);
      });
    }
    function openFilterPop(c) {
      var f = sh.filter, last = filterLast(sh), counts = new Map(), cur0 = (f.cols || {})[c];
      for (var r = f.r1 + 1; r <= last; r++) {
        // 只看被别的列的条件留下来的行（同 Excel）
        var t = filterText(sh, r, c);
        counts.set(t, (counts.get(t) || 0) + 1);
      }
      var vals = Array.from(counts.keys()).sort(function (a, b) {
        var na = parseFloat(a), nb = parseFloat(b);
        if (a === "") return 1; if (b === "") return -1;
        if (!isNaN(na) && !isNaN(nb) && String(na) === a.replace(/,/g, "") && String(nb) === b.replace(/,/g, "")) return na - nb;
        return a.localeCompare(b, "zh-Hans-CN", { numeric: true });
      }).slice(0, 2000);
      var chosen = new Set(cur0 && cur0.vals ? cur0.vals : vals);
      var box = el("div", "nb-fpop");
      box.innerHTML = '<div class="nb-fpop-sort"><button type="button" class="ofc-btn" data-k="asc">升序 A→Z</button><button type="button" class="ofc-btn" data-k="desc">降序 Z→A</button></div>' +
        '<input class="ofc-in" placeholder="搜索" spellcheck="false"><label class="ofc-check nb-fall"><input type="checkbox"><span>（全选）</span></label><div class="nb-flist"></div>' +
        '<div class="nb-fpop-b"><button type="button" class="ofc-btn" data-k="clear">清除过滤</button><span class="nb-sp"></span><button type="button" class="ofc-btn ofc-default" data-k="ok">好</button></div>';
      var list = box.querySelector(".nb-flist"), q = box.querySelector("input.ofc-in"), all = box.querySelector(".nb-fall input");
      function render() {
        var qq = q.value.trim().toLowerCase();
        list.textContent = "";
        vals.forEach(function (v) {
          if (qq && v.toLowerCase().indexOf(qq) < 0) return;
          var l = el("label", "ofc-check"), cb = el("input");
          cb.type = "checkbox";
          cb.checked = chosen.has(v);
          cb.addEventListener("change", function () { if (cb.checked) chosen.add(v); else chosen.delete(v); syncAll(); });
          l.appendChild(cb);
          l.appendChild(el("span", null, esc(v === "" ? "（空白）" : v) + ' <em>' + counts.get(v) + "</em>"));
          list.appendChild(l);
        });
        syncAll();
      }
      function syncAll() { all.checked = chosen.size === vals.length; all.indeterminate = chosen.size > 0 && chosen.size < vals.length; }
      all.addEventListener("change", function () { if (all.checked) vals.forEach(function (v) { chosen.add(v); }); else chosen.clear(); render(); });
      q.addEventListener("input", render);
      q.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") ok(); });
      render();
      var g = geom(), gr = gridEl.getBoundingClientRect(), anchor = el("div", "nb-anchor");
      anchor.style.left = (sX(c + 1, g) - 17) * g.z + "px";
      anchor.style.top = sY(f.r1, g) * g.z + "px";
      anchor.style.width = 16 * g.z + "px";
      anchor.style.height = sh.rows.sz(f.r1) * g.z + "px";
      gridEl.appendChild(anchor);
      var pop = ui.popover(anchor, box, { cls: "nb-fpopw", onClose: function () { anchor.remove(); focus(); } });
      function ok() {
        pop.close();
        var q2 = q.value.trim();
        if (chosen.size === vals.length && !q2) setFilterCol(c, null);
        else setFilterCol(c, { vals: Array.from(chosen).filter(function (v) { return !q2 || v.toLowerCase().indexOf(q2.toLowerCase()) >= 0; }) });
      }
      box.querySelector('[data-k="ok"]').addEventListener("click", ok);
      box.querySelector('[data-k="clear"]').addEventListener("click", function () { pop.close(); setFilterCol(c, null); });
      box.querySelector('[data-k="asc"]').addEventListener("click", function () { pop.close(); sortBy([{ c: c, desc: false }], sortTarget()); });
      box.querySelector('[data-k="desc"]').addEventListener("click", function () { pop.close(); sortBy([{ c: c, desc: true }], sortTarget()); });
      setTimeout(function () { q.focus(); }, 30);
    }

    // ======== 工作表 ========
    function renderTabs() {
      tabsEl.textContent = "";
      book.sheets.forEach(function (s, i) {
        if (s.hidden) return;
        var t = el("div", "nb-tab" + (s === sh ? " on" : ""), esc(s.name));
        t.dataset.i = i;
        if (s.tab) t.style.setProperty("--tab", s.tab);
        t.title = s.name;
        tabsEl.appendChild(t);
      });
    }
    tabsEl.addEventListener("mousedown", function (e) {
      var t = e.target.closest(".nb-tab");
      if (!t || e.button !== 0) return;
      var s = book.sheets[+t.dataset.i];
      e.preventDefault();
      if (editing && editing.formula && canPoint()) { switchTo(s, true, true); return; } // 编辑公式时点别的表 = 去那边点引用
      if (editing && !commitEdit()) return;
      switchTo(s);
      // 拖动换位置
      var x0 = e.clientX, moved = false, from = +t.dataset.i;
      var mv = function (ev) {
        if (Math.abs(ev.clientX - x0) < 6 && !moved) return;
        moved = true;
        t.classList.add("drag");
        t.style.transform = "translateX(" + (ev.clientX - x0) + "px)";
      };
      var up = function (ev) {
        document.removeEventListener("mousemove", mv);
        document.removeEventListener("mouseup", up);
        t.classList.remove("drag");
        t.style.transform = "";
        if (!moved) return;
        var tabs = Array.prototype.slice.call(tabsEl.children), to = from;
        tabs.forEach(function (x) { var r = x.getBoundingClientRect(); if (ev.clientX > r.left + r.width / 2) to = +x.dataset.i; else if (ev.clientX < r.left + r.width / 2 && +x.dataset.i < from && to === from) to = +x.dataset.i; });
        if (ev.clientX < tabs[0].getBoundingClientRect().left) to = +tabs[0].dataset.i;
        if (to !== from) moveSheet(from, to);
      };
      document.addEventListener("mousemove", mv);
      document.addEventListener("mouseup", up);
    });
    tabsEl.addEventListener("dblclick", function (e) { var t = e.target.closest(".nb-tab"); if (t) renameSheetUI(book.sheets[+t.dataset.i], t); });
    tabsEl.addEventListener("contextmenu", function (e) {
      var t = e.target.closest(".nb-tab");
      e.preventDefault();
      if (!t) return ui.menuAt([it("新建工作表", "", addSheet)].concat(hiddenSheetsItems()), e.clientX, e.clientY);
      var s = book.sheets[+t.dataset.i];
      switchTo(s);
      ui.menuAt(sheetMenuItems(s, t), e.clientX, e.clientY);
    });
    $(".nb-addsheet").addEventListener("mousedown", function (e) { e.preventDefault(); });
    $(".nb-addsheet").addEventListener("click", function () { addSheet(); });
    function hiddenSheetsItems() {
      var hid = book.sheets.filter(function (s) { return s.hidden; });
      return hid.length ? [SEP, it("取消隐藏", "", null, { items: hid.map(function (s) { return it(s.name, "", function () { tx("取消隐藏工作表", function () { setProp(s, "hidden", false); }); switchTo(s); }); }) })] : [];
    }
    function sheetMenuItems(s, tabEl) {
      var i = book.sheets.indexOf(s), vis = book.sheets.filter(function (x) { return !x.hidden; });
      return [
        it("重新命名", "", function () { renameSheetUI(s, tabEl || tabsEl.querySelector('[data-i="' + i + '"]')); }),
        it("复制工作表", "", function () { duplicateSheet(s); }),
        it("删除工作表", "", function () { deleteSheet(s); }, { disabled: vis.length <= 1 }),
        SEP,
        it("左移", "", function () { moveSheet(i, i - 1); }, { disabled: i === 0 }),
        it("右移", "", function () { moveSheet(i, i + 1); }, { disabled: i === book.sheets.length - 1 }),
        it("标签颜色", "", null, { items: [["无", null], ["红色", "#ff3b30"], ["橙色", "#ff9500"], ["黄色", "#ffcc00"], ["绿色", "#34c759"], ["蓝色", "#007aff"], ["紫色", "#af52de"], ["灰色", "#8e8e93"]].map(function (x) { return it(x[0], "", function () { tx("标签颜色", function () { setProp(s, "tab", x[1]); }); }, { checked: (s.tab || null) === x[1] }); }) }),
        it("隐藏工作表", "", function () { tx("隐藏工作表", function () { setProp(s, "hidden", true); }); switchTo(book.sheets.find(function (x) { return !x.hidden; })); }, { disabled: vis.length <= 1 }),
      ].concat(hiddenSheetsItems());
    }
    function uniqueSheetName(base) {
      var n = base, k = 2;
      while (NB.sheetByName(book, n)) n = base.replace(/\s*\d+$/, "") + " " + k++;
      return n;
    }
    function addSheet() {
      var s = NB.newSheet(uniqueSheetName("工作表 " + (book.sheets.length + 1)));
      var i = book.sheets.indexOf(sh) + 1;
      tx("新建工作表", function () { var arr = book.sheets.slice(); arr.splice(i, 0, s); setProp(book, "sheets", arr); });
      switchTo(s);
    }
    function duplicateSheet(s) {
      var c = NB.newSheet(uniqueSheetName(s.name + " 副本"));
      c.cells = new Map(s.cells);
      c.cols = s.cols.clone();
      c.rows = s.rows.clone();
      c.colStyle = new Map(s.colStyle);
      c.rowStyle = new Map(s.rowStyle);
      c.freeze = Object.assign({}, s.freeze);
      c.merges = s.merges.map(function (m) { return Object.assign({}, m); });
      c.grid = s.grid;
      c.tab = s.tab;
      c.maxR = s.maxR; c.maxC = s.maxC; c.usedDirty = true;
      c.filter = s.filter ? JSON.parse(JSON.stringify(s.filter)) : null;
      c.extra = s.extra;
      tx("复制工作表", function () { var arr = book.sheets.slice(); arr.splice(book.sheets.indexOf(s) + 1, 0, c); setProp(book, "sheets", arr); });
      switchTo(c);
    }
    function deleteSheet(s) {
      if (book.sheets.filter(function (x) { return !x.hidden; }).length <= 1) return;
      var go = function () {
        var i = book.sheets.indexOf(s);
        tx("删除工作表", function () {
          var arr = book.sheets.filter(function (x) { return x !== s; });
          setProp(book, "sheets", arr);
          // 引用它的公式变成 #REF!（同 Excel）
          arr.forEach(function (o) {
            o.cells.forEach(function (cell, k) {
              if (cell.f == null) return;
              var nf = FX.mapRefs(cell.f, function (n) { return n.sheet && n.sheet.toLowerCase() === s.name.toLowerCase() ? null : n; });
              if (nf !== cell.f) setCell(o, KR(k), KC(k), Object.assign({}, cell, { f: nf }));
            });
          });
        });
        var next = book.sheets[Math.min(i, book.sheets.length - 1)];
        if (next.hidden) next = book.sheets.find(function (x) { return !x.hidden; });
        switchTo(next);
      };
      if (!s.cells.size) return go();
      D.alert({ window: doc.win.el.id, title: "删除工作表“" + s.name + "”？", message: "可以用「撤销」找回来。", icon: "caution", buttons: [{ label: "取消", role: "cancel" }, { label: "删除", role: "destructive" }] })
        .then(function (b) { if (b === "删除") go(); });
    }
    function moveSheet(from, to) {
      if (to < 0 || to >= book.sheets.length || from === to) return;
      var s = book.sheets[from];
      tx("移动工作表", function () { var arr = book.sheets.slice(); arr.splice(from, 1); arr.splice(to, 0, s); setProp(book, "sheets", arr); });
      switchTo(s);
    }
    function renameSheetUI(s, tabEl) {
      if (!tabEl) return;
      var inp = el("input", "nb-tabin");
      inp.value = s.name;
      inp.spellcheck = false;
      tabEl.textContent = "";
      tabEl.appendChild(inp);
      inp.focus();
      inp.select();
      var done = false;
      var finish = function (ok) {
        if (done) return;
        done = true;
        var n = inp.value.trim().slice(0, 31);
        if (ok && n && n !== s.name) {
          if (/[\[\]:*?\/\\]/.test(n)) { D.alert({ window: doc.win.el.id, title: "工作表名称里不能有 [ ] : * ? / \\", icon: "caution" }); }
          else if (NB.sheetByName(book, n) && NB.sheetByName(book, n) !== s) { D.alert({ window: doc.win.el.id, title: "已经有叫“" + n + "”的工作表了", icon: "caution" }); }
          else renameSheet(s, n);
        }
        renderTabs();
        focus();
      };
      inp.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
      inp.addEventListener("blur", function () { finish(true); });
      inp.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    }
    function renameSheet(s, n) {
      var oldName = s.name;
      tx("重新命名工作表", function () {
        setProp(s, "name", n);
        book.sheets.forEach(function (o) {
          o.cells.forEach(function (cell, k) {
            if (cell.f == null) return;
            var nf = FX.mapRefs(cell.f, function (node) { if (node.sheet && node.sheet.toLowerCase() === oldName.toLowerCase()) { var x = Object.assign({}, node); x.sheet = n; return x; } return node; });
            if (nf !== cell.f) setCell(o, KR(k), KC(k), Object.assign({}, cell, { f: nf }));
          });
        });
      });
    }
    function switchTo(s, quiet, keepEdit) {
      if (!s || s === sh) { if (s && !quiet) paintSoon(); return; }
      if (sh) { sh.scroll = { x: scrollEl.scrollLeft, y: scrollEl.scrollTop }; sh.zoom = zoom; }
      sh = s;
      book.active = book.sheets.indexOf(s);
      zoom = sh.zoom || 1;
      rowsN = 200;
      colsN = 26;
      mergeCache.src = null;
      updateSpace();
      scrollEl.scrollLeft = sh.scroll ? sh.scroll.x : 0;
      scrollEl.scrollTop = sh.scroll ? sh.scroll.y : 0;
      renderTabs();
      if (!keepEdit) { if (editing && !quiet) commitEdit(); }
      paintSoon();
      updateNameBox();
      if (!editing) showFx();
      updateStatus();
      syncInspector();
      doc.refresh();
    }

    // ======== 缩放 ========
    function setZoom(z) {
      z = Math.max(0.25, Math.min(4, Math.round(z * 100) / 100));
      if (z === zoom) return;
      var g = geom(), cx = g.sx, cy = g.sy;
      zoom = z;
      sh.zoom = z;
      measureCache.clear();
      wrapCache.clear();
      updateSpace();
      scrollEl.scrollLeft = cx * z;
      scrollEl.scrollTop = cy * z;
      paintSoon();
      doc.refresh();
    }

    // ======== 查找与替换 ========
    var found = [], foundIdx = -1;
    function openFind(replace) {
      findEl.hidden = false;
      findEl.classList.toggle("rep", !!replace);
      var q = findEl.querySelector(".nb-fq");
      q.focus();
      q.select();
      resize();
    }
    function closeFind() { findEl.hidden = true; found = []; resize(); focus(); }
    function runFind() {
      var q = findEl.querySelector(".nb-fq").value, cs = findEl.querySelector('[data-f="case"]').checked;
      found = [];
      if (q) {
        var needle = cs ? q : q.toLowerCase();
        var keys = Array.from(sh.cells.keys()).sort(function (a, b) { return KR(a) - KR(b) || KC(a) - KC(b); });
        keys.forEach(function (k) {
          var r = KR(k), c = KC(k), cell = sh.cells.get(k), t = filterText(sh, r, c), f = cell.f != null ? "=" + cell.f : "";
          if (!cs) { t = t.toLowerCase(); f = f.toLowerCase(); }
          if (t.indexOf(needle) >= 0 || f && f.indexOf(needle) >= 0) found.push({ r: r, c: c });
        });
      }
      foundIdx = -1;
      findEl.querySelector(".nb-fn").textContent = q ? (found.length ? found.length + " 个" : "没有找到") : "";
    }
    function findNext(d) {
      if (!found.length) runFind();
      if (!found.length) return;
      var s = sh.sel;
      if (foundIdx < 0) { foundIdx = found.findIndex(function (x) { return x.r > s.r || x.r === s.r && x.c >= s.c; }); if (foundIdx < 0) foundIdx = 0; if (d < 0) foundIdx = (foundIdx - 1 + found.length) % found.length; }
      else foundIdx = (foundIdx + d + found.length) % found.length;
      var x = found[foundIdx];
      setSel(x.r, x.c);
      ensureVisible(x.r, x.c);
      findEl.querySelector(".nb-fn").textContent = (foundIdx + 1) + " / " + found.length;
    }
    function replaceIn(cell, q, rep, cs) {
      var re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), cs ? "g" : "gi");
      if (cell.f != null) return Object.assign({}, cell, { f: cell.f.replace(re, rep) });
      if (typeof cell.v === "string") { var nv = cell.v.replace(re, rep); return nv === cell.v ? cell : Object.assign({}, cell, { v: nv }); }
      return cell;
    }
    function doReplace(all) {
      var q = findEl.querySelector(".nb-fq").value, rep = findEl.querySelector(".nb-fr").value, cs = findEl.querySelector('[data-f="case"]').checked;
      if (!q) return;
      if (!found.length) runFind();
      var targets = all ? found.slice() : foundIdx >= 0 ? [found[foundIdx]] : [];
      if (!targets.length) return findNext(1);
      var n = 0;
      tx(all ? "全部替换" : "替换", function () {
        targets.forEach(function (x) {
          var cell = cellAt(sh, x.r, x.c);
          if (!cell) return;
          var nc = typeof cell.v === "number" && cell.f == null ? cellFromText(sh, x.r, x.c, filterText(sh, x.r, x.c).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), cs ? "g" : "gi"), rep)) : replaceIn(cell, q, rep, cs);
          if (nc !== cell) { setCell(sh, x.r, x.c, nc); n++; }
        });
      });
      runFind();
      if (all) O.toast(doc, "替换了 " + n + " 处");
      else findNext(1);
    }
    findEl.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); closeFind(); }
      if (e.key === "Enter") { e.preventDefault(); if (e.target.classList.contains("nb-fr")) doReplace(false); else findNext(e.shiftKey ? -1 : 1); }
    });
    findEl.querySelector(".nb-fq").addEventListener("input", function () { runFind(); });
    findEl.addEventListener("click", function (e) {
      var f = e.target.dataset && e.target.dataset.f;
      if (f === "next") findNext(1);
      else if (f === "prev") findNext(-1);
      else if (f === "rep") doReplace(false);
      else if (f === "all") doReplace(true);
      else if (f === "done") closeFind();
      else if (f === "case") runFind();
    });

    // ======== 底栏：选区的合计、平均……（同 Numbers 窗口底部）========
    function updateStatus() {
      var nums = [], count = 0, limit = 200000, seen = 0;
      if (sh.sel.ranges.length === 1 && curRange().r1 === curRange().r2 && curRange().c1 === curRange().c2) { sumEl.textContent = ""; modeText(); return; }
      sh.sel.ranges.forEach(function (rg0) {
        var rg = clipToUsed(rg0);
        if ((rg.r2 - rg.r1 + 1) * (rg.c2 - rg.c1 + 1) > limit) {
          sh.cells.forEach(function (cell, k) { var r = KR(k), c = KC(k); if (r < rg.r1 || r > rg.r2 || c < rg.c1 || c > rg.c2 || sh.rows.fhidden.has(r)) return; var v = valueOf(sh, r, c); if (v == null || v === "") return; count++; if (typeof v === "number") nums.push(v); });
          return;
        }
        for (var r = rg.r1; r <= rg.r2; r++) {
          if (sh.rows.fhidden.has(r)) continue;
          for (var c = rg.c1; c <= rg.c2; c++) { if (++seen > limit) return; var v = valueOf(sh, r, c); if (v == null || v === "") continue; count++; if (typeof v === "number") nums.push(v); }
        }
      });
      var st = styleOf(sh, sh.sel.r, sh.sel.c), f = function (v) { return st.nf && !/@/.test(st.nf) ? FX.format(v, st.nf).text : Number.isInteger(v) ? FX.formatGeneral(v) : FX.format(Math.round(v * 100) / 100, "#,##0.##").text.replace(/\.$/, ""); };
      if (!nums.length) { sumEl.innerHTML = count ? "<span>计数 <b>" + count + "</b></span>" : ""; modeText(); return; }
      var sum = nums.reduce(function (a, b) { return a + b; }, 0);
      sumEl.innerHTML = [["求和", f(sum)], ["平均值", f(sum / nums.length)], ["最小值", f(Math.min.apply(null, nums))], ["最大值", f(Math.max.apply(null, nums))], ["计数", String(count)]]
        .map(function (x) { return "<span>" + x[0] + " <b>" + esc(x[1]) + "</b></span>"; }).join("");
      modeText();
    }
    function modeText() {
      modeEl.textContent = editing ? (editing.formula ? (canPoint() ? "点选引用" : "编辑公式") : editing.mode === "enter" ? "输入" : "编辑") : copyMark ? (copyMark.cut ? "选好位置后粘贴以移动" : "选好位置后粘贴") : sh.filter && sh.rows.fhidden.size ? "已过滤：藏起了 " + sh.rows.fhidden.size + " 行" : "就绪";
    }

    // ======== 检查器 ========
    var insp = el("div", "nb-insp");
    var tabsBar = el("div", "ofc-tabs"), body = el("div", "ofc-insp-body");
    insp.appendChild(tabsBar);
    insp.appendChild(body);
    var C = {}; // 控件
    function inspTabs() {
      var list = inspMode === "format" ? [["cell", "单元格"], ["text", "文本"], ["sheet", "表格"]] : [["sort", "排序"], ["filter", "过滤"]];
      if (!list.some(function (x) { return x[0] === inspTab; })) inspTab = list[0][0];
      tabsBar.innerHTML = list.map(function (x) { return '<button type="button" data-t="' + x[0] + '" class="' + (x[0] === inspTab ? "on" : "") + '">' + x[1] + "</button>"; }).join("");
      buildInsp();
    }
    tabsBar.addEventListener("mousedown", function (e) { e.preventDefault(); });
    tabsBar.addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; inspTab = b.dataset.t; inspTabs(); });
    function showInsp(mode) {
      if (doc.inspectorOn() && inspMode === mode) { doc.showInspector(false); return; }
      inspMode = mode;
      inspTabs();
      doc.showInspector(true);
    }
    var NUMKINDS = [{ v: "auto", label: "自动" }, { v: "number", label: "数字" }, { v: "currency", label: "货币" }, { v: "percent", label: "百分比" }, { v: "fraction", label: "分数" }, { v: "sci", label: "科学记数" }, { v: "date", label: "日期与时间" }, { v: "duration", label: "时长" }, { v: "text", label: "文本" }, { v: "custom", label: "自定格式" }];
    var DATE_FMTS = [["yyyy-mm-dd", "2026-09-26"], ["yyyy/m/d", "2026/9/26"], ['yyyy"年"m"月"d"日"', "2026年9月26日"], ['yyyy"年"m"月"d"日" aaaa', "2026年9月26日 星期六"], ['m"月"d"日"', "9月26日"], ["m/d/yy", "9/26/26"], ["mmm d, yyyy", "Sep 26, 2026"], ["d mmmm yyyy", "26 September 2026"], ["yyyy-mm", "2026-09"], ["", "无日期"]];
    var TIME_FMTS = [["", "无时间"], ["h:mm", "9:41"], ["hh:mm:ss", "09:41:00"], ["h:mm AM/PM", "9:41 AM"], ['h"时"mm"分"', "9时41分"]];
    var CURRENCIES = [["¥", "人民币 ¥"], ["$", "美元 $"], ["€", "欧元 €"], ["£", "英镑 £"], ["HK$", "港元 HK$"], ["JP¥", "日元 ¥"]];
    function numKind(nf) {
      if (!nf) return "auto";
      if (nf === "@") return "text";
      var plain = nf.split(";")[0].replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
      if (FX.isDateFormat(nf)) return /\[h\]|\[m\]|\[s\]/i.test(nf) ? "duration" : "date";
      if (/E[+-]/i.test(plain)) return "sci";
      if (/\?\/|\/\d/.test(plain)) return "fraction";
      if (/%/.test(plain)) return "percent";
      if (/[¥$€£]/.test(nf)) return "currency";
      if (/^[#,0.]+$/.test(plain.trim())) return "number";
      return "custom";
    }
    function nfInfo(nf) {
      var first = (nf || "").split(";")[0], plain = first.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, ""), dm = /\.(0+)/.exec(plain);
      var sym = (/"([^"]*[¥$€£][^"]*)"/.exec(first) || /\[\$([^\]-]+)/.exec(first) || [])[1] || "¥";
      var secs = (nf || "").split(";");
      var neg = secs.length < 2 ? "minus" : /\[Red\]/i.test(secs[1]) ? (/\(/.test(secs[1]) ? "redparen" : "red") : /\(/.test(secs[1]) ? "paren" : "minus";
      return { dec: dm ? dm[1].length : 0, sep: /#,##0|0,0/.test(plain), sym: sym.replace(/^JP/, ""), neg: neg };
    }
    function buildNf(kind, o) {
      var zeros = function (n) { return n > 0 ? "." + "0".repeat(n) : ""; };
      var base = (o.sep ? "#,##0" : "0") + zeros(o.dec);
      var withNeg = function (b) { return o.neg === "paren" ? b + ";(" + b + ")" : o.neg === "red" ? b + ";[Red]-" + b : o.neg === "redparen" ? b + ";[Red](" + b + ")" : b; };
      if (kind === "auto") return null;
      if (kind === "number") return withNeg(base);
      if (kind === "currency") return withNeg('"' + (o.sym || "¥") + '"' + base);
      if (kind === "percent") return "0" + zeros(o.dec) + "%";
      if (kind === "sci") return "0" + zeros(Math.max(o.dec, 1)) + "E+00";
      if (kind === "fraction") return o.frac || "# ?/?";
      if (kind === "date") return [o.date, o.time].filter(Boolean).join(" ") || "yyyy-mm-dd";
      if (kind === "duration") return o.dur || "[h]:mm:ss";
      if (kind === "text") return "@";
      return o.custom || null;
    }
    function setNf(nf, label) { applyStyle({ nf: nf || null }, label || "数据格式"); }
    function buildInsp() {
      body.textContent = "";
      C = {};
      var S = ui.section, R = ui.row;
      if (inspMode === "format" && inspTab === "cell") {
        var s1 = S("数据格式");
        C.kind = ui.select(NUMKINDS, "auto", function (v) {
          var st = activeStyle(), info = nfInfo(st.nf), kind0 = numKind(st.nf);
          var o = { dec: v === "percent" ? (kind0 === "percent" ? info.dec : 0) : kind0 === "auto" ? (v === "currency" || v === "number" ? 2 : 0) : info.dec, sep: v === "currency" || v === "number" ? (kind0 === "auto" ? true : info.sep) : false, sym: info.sym, neg: info.neg, date: "yyyy-mm-dd", time: "", custom: st.nf || "General" };
          if (v === "custom") { kindOverride = "custom"; C.custom.set(st.nf || "General"); syncInspector(true); C.custom.focus(); return; }
          setNf(buildNf(v, o));
        });
        s1.appendChild(C.kind);
        C.numRow = el("div", "nb-numopts");
        C.dec = ui.stepper(2, { min: 0, max: 10, step: 1, digits: 0, width: 64 }, function (v) { var st = activeStyle(), k = numKind(st.nf), info = nfInfo(st.nf); info.dec = v; setNf(buildNf(k === "auto" ? "number" : k, info)); });
        C.sep = ui.check("千位分隔符", true, function (v) { var st = activeStyle(), k = numKind(st.nf), info = nfInfo(st.nf); info.sep = v; setNf(buildNf(k === "auto" ? "number" : k, info)); });
        C.sym = ui.select(CURRENCIES.map(function (x) { return { v: x[0], label: x[1] }; }), "¥", function (v) { var info = nfInfo(activeStyle().nf); info.sym = v; setNf(buildNf("currency", info)); });
        C.neg = ui.select([{ v: "minus", label: "-100" }, { v: "red", label: "-100（红色）" }, { v: "paren", label: "(100)" }, { v: "redparen", label: "(100)（红色）" }], "minus", function (v) { var st = activeStyle(), k = numKind(st.nf), info = nfInfo(st.nf); info.neg = v; setNf(buildNf(k === "auto" ? "number" : k, info)); });
        C.numRow.appendChild(R("小数", C.dec));
        C.numRow.appendChild(R("货币", C.sym));
        C.numRow.appendChild(R("负数", C.neg));
        C.numRow.appendChild(C.sep);
        s1.appendChild(C.numRow);
        C.dateRow = el("div", "nb-numopts");
        C.date = ui.select(DATE_FMTS.map(function (x) { return { v: x[0], label: x[1] }; }), "yyyy-mm-dd", function (v) { var cur0 = splitDate(activeStyle().nf); setNf(buildNf("date", { date: v, time: cur0.time })); });
        C.time = ui.select(TIME_FMTS.map(function (x) { return { v: x[0], label: x[1] }; }), "", function (v) { var cur0 = splitDate(activeStyle().nf); setNf(buildNf("date", { date: cur0.date, time: v })); });
        C.dateRow.appendChild(R("日期", C.date));
        C.dateRow.appendChild(R("时间", C.time));
        s1.appendChild(C.dateRow);
        C.durRow = el("div", "nb-numopts");
        C.dur = ui.select([{ v: "[h]:mm:ss", label: "时:分:秒（累计）" }, { v: "[h]:mm", label: "时:分（累计）" }, { v: "[m]:ss", label: "分:秒（累计）" }, { v: "h:mm:ss", label: "时:分:秒" }], "[h]:mm:ss", function (v) { setNf(v); });
        C.durRow.appendChild(R("单位", C.dur));
        s1.appendChild(C.durRow);
        C.fracRow = el("div", "nb-numopts");
        C.frac = ui.select([{ v: "# ?/?", label: "一位数（1/4）" }, { v: "# ??/??", label: "两位数（21/25）" }, { v: "# ?/2", label: "二分之几" }, { v: "# ?/4", label: "四分之几" }, { v: "# ?/8", label: "八分之几" }, { v: "# ??/100", label: "百分之几" }], "# ?/?", function (v) { setNf(v); });
        C.fracRow.appendChild(R("精度", C.frac));
        s1.appendChild(C.fracRow);
        C.customRow = el("div", "nb-numopts");
        C.custom = el("input", "ofc-in nb-custom");
        C.custom.spellcheck = false;
        C.custom.placeholder = '如 #,##0.00;[Red]-#,##0.00';
        C.custom.set = function (v) { if (document.activeElement !== C.custom) C.custom.value = v || ""; };
        C.custom.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") { setNf(C.custom.value.trim() === "General" ? null : C.custom.value.trim(), "自定格式"); } });
        C.customRow.appendChild(C.custom);
        C.customRow.appendChild(el("div", "ofc-note", "用 Excel 的格式代码：0 位数、# 可选位、, 千位、% 百分比、yyyy mm dd hh:mm 日期时间、[Red] 颜色、; 分正数;负数;零;文字"));
        s1.appendChild(C.customRow);
        C.preview = el("div", "nb-preview");
        s1.appendChild(C.preview);
        body.appendChild(s1);
        var s2 = S("填充");
        C.fill = ui.color(null, function (v) { applyStyle({ fill: v }, "填充颜色"); }, { none: "无填充" });
        s2.appendChild(R("颜色", C.fill));
        body.appendChild(s2);
        var s3 = S("边框");
        var bIcon = function (d) { return '<svg viewBox="0 0 20 20" width="18" height="18"><rect x="3.5" y="3.5" width="13" height="13" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-dasharray="1.5 1.5"/><path d="' + d + '" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>'; };
        C.bpreset = ui.seg([
          { v: "all", icon: bIcon("M3.5 3.5h13v13h-13zM10 3.5v13M3.5 10h13"), tip: "所有边框" }, { v: "outer", icon: bIcon("M3.5 3.5h13v13h-13z"), tip: "外边框" }, { v: "inner", icon: bIcon("M10 3.5v13M3.5 10h13"), tip: "内部边框" },
          { v: "top", icon: bIcon("M3.5 3.5h13"), tip: "上边框" }, { v: "bottom", icon: bIcon("M3.5 16.5h13"), tip: "下边框" }, { v: "left", icon: bIcon("M3.5 3.5v13"), tip: "左边框" }, { v: "right", icon: bIcon("M16.5 3.5v13"), tip: "右边框" }, { v: "none", icon: bIcon(""), tip: "无边框" },
        ], null, function (v) { applyBorders(v); C.bpreset.set(null); }, { cls: "nb-bseg" });
        s3.appendChild(C.bpreset);
        C.bstyle = ui.select([{ v: "thin", label: "细线" }, { v: "medium", label: "中等" }, { v: "thick", label: "粗线" }, { v: "dashed", label: "虚线" }, { v: "dotted", label: "点线" }, { v: "double", label: "双线" }], "thin", function () {});
        C.bcolor = ui.color(borderColor, function (v) { borderColor = v || "#000000"; });
        s3.appendChild(R("线型", C.bstyle, C.bcolor));
        body.appendChild(s3);
        var s4 = S("合并");
        var mrow = el("div", "ofc-btnrow");
        mrow.appendChild(ui.button("合并单元格", function () { mergeSel(); }));
        mrow.appendChild(ui.button("跨列合并", function () { mergeSel("across"); }));
        mrow.appendChild(ui.button("取消合并", function () { unmergeSel(); }));
        s4.appendChild(mrow);
        body.appendChild(s4);
      } else if (inspMode === "format" && inspTab === "text") {
        var t1 = S("字体");
        C.font = ui.select(FONTS.map(function (f) { return { v: f[0], label: f[1] }; }), "", function (v) { applyStyle({ font: v || null }, "字体"); });
        t1.appendChild(C.font);
        C.size = ui.stepper(DEF_SZ, { min: 6, max: 96, step: 1, digits: 1, unit: " 磅", width: 84 }, function (v) { applyStyle({ sz: v === DEF_SZ ? null : v }, "字号"); });
        C.bius = ui.seg([{ v: "b", label: "B", tip: "粗体 ⌘B", style: "font-weight:700" }, { v: "i", label: "I", tip: "斜体 ⌘I", style: "font-style:italic;font-family:Georgia,serif" }, { v: "u", label: "U", tip: "下划线 ⌘U", style: "text-decoration:underline" }, { v: "st", label: "S", tip: "删除线", style: "text-decoration:line-through" }], {}, function (v, on) { var p = {}; p[v] = on ? 1 : null; applyStyle(p); }, { multi: true });
        t1.appendChild(R(null, C.bius, C.size));
        C.color = ui.color(null, function (v) { applyStyle({ color: v }, "文字颜色"); }, { auto: "自动" });
        t1.appendChild(R("颜色", C.color));
        body.appendChild(t1);
        var t2 = S("对齐");
        var aIcon = function (lines) { return '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' + lines + "</svg>"; };
        C.ha = ui.seg([
          { v: "", label: "自动", tip: "自动（文字靠左、数字靠右）" },
          { v: "left", icon: aIcon('<path d="M3 5h14M3 9h9M3 13h14M3 17h9"/>'), tip: "靠左" }, { v: "center", icon: aIcon('<path d="M3 5h14M5.5 9h9M3 13h14M5.5 17h9"/>'), tip: "居中" },
          { v: "right", icon: aIcon('<path d="M3 5h14M8 9h9M3 13h14M8 17h9"/>'), tip: "靠右" }, { v: "justify", icon: aIcon('<path d="M3 5h14M3 9h14M3 13h14M3 17h14"/>'), tip: "两端对齐" },
        ], "", function (v) { applyStyle({ ha: v || null }, "对齐"); });
        t2.appendChild(C.ha);
        C.va = ui.seg([
          { v: "top", icon: aIcon('<path d="M3 3.5h14"/><path d="M10 16V7M7 9.5 10 6.5l3 3"/>'), tip: "顶端" }, { v: "middle", icon: aIcon('<path d="M3 10h14"/><path d="M10 3.5v3.5M10 13v3.5"/>'), tip: "居中" }, { v: "", icon: aIcon('<path d="M3 16.5h14"/><path d="M10 4v9M7 10.5l3 3 3-3"/>'), tip: "底端" },
        ], "", function (v) { applyStyle({ va: v || null }, "对齐"); });
        C.wrap = ui.check("自动换行", false, function (v) { applyStyle({ wrap: v ? 1 : null }, "自动换行"); });
        t2.appendChild(R("垂直", C.va));
        t2.appendChild(C.wrap);
        C.ind = ui.stepper(0, { min: 0, max: 15, step: 1, digits: 0, width: 64 }, function (v) { applyStyle({ ind: v || null }, "缩进"); });
        t2.appendChild(R("缩进", C.ind));
        body.appendChild(t2);
      } else if (inspMode === "format" && inspTab === "sheet") {
        var h1 = S("工作表");
        C.sname = el("input", "ofc-in");
        C.sname.spellcheck = false;
        C.sname.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") { var n = C.sname.value.trim(); if (n && n !== sh.name && !NB.sheetByName(book, n) && !/[\[\]:*?\/\\]/.test(n)) renameSheet(sh, n.slice(0, 31)); focus(); } });
        h1.appendChild(R("名称", C.sname));
        C.tab = ui.color(null, function (v) { tx("标签颜色", function () { setProp(sh, "tab", v); }); }, { none: "无" });
        h1.appendChild(R("标签颜色", C.tab));
        C.grid = ui.check("显示网格线", true, function (v) { tx(v ? "显示网格线" : "隐藏网格线", function () { setProp(sh, "grid", v); }); });
        h1.appendChild(C.grid);
        body.appendChild(h1);
        var h2 = S("冻结");
        C.freeze = ui.select([{ v: "0,0", label: "不冻结" }, { v: "1,0", label: "首行" }, { v: "0,1", label: "首列" }, { v: "1,1", label: "首行和首列" }, { v: "sel", label: "到当前单元格为止" }], "0,0", function (v) {
          if (v === "sel") setFreeze(sh.sel.r, sh.sel.c); else { var p = v.split(","); setFreeze(+p[0], +p[1]); }
        });
        h2.appendChild(C.freeze);
        body.appendChild(h2);
        var h3 = S("行与列");
        C.rowh = ui.stepper(sh.rows.def, { min: 8, max: 400, step: 1, digits: 0, unit: " 像素", width: 96 }, function (v) { setSizes("r", v); });
        C.colw = ui.stepper(sh.cols.def, { min: 8, max: 1000, step: 1, digits: 0, unit: " 像素", width: 96 }, function (v) { setSizes("c", v); });
        h3.appendChild(R("行高", C.rowh));
        h3.appendChild(R("列宽", C.colw));
        var brow = el("div", "ofc-btnrow");
        brow.appendChild(ui.button("自动列宽", function () { var rg = curRange(); var list = []; for (var c = rg.c1; c <= Math.min(rg.c2, Math.max(rg.c1, NB.used(sh).c)); c++) list.push(c); autofitCols(list); }));
        brow.appendChild(ui.button("自动行高", function () { var rg = curRange(); var list = []; for (var r = rg.r1; r <= Math.min(rg.r2, Math.max(rg.r1, NB.used(sh).r)); r++) list.push(r); autofitRows(list); }));
        h3.appendChild(brow);
        body.appendChild(h3);
      } else if (inspMode === "organize" && inspTab === "sort") {
        var o1 = S("排序");
        C.sortInfo = el("div", "ofc-note");
        o1.appendChild(C.sortInfo);
        C.rules = el("div", "nb-rules");
        o1.appendChild(C.rules);
        var add = ui.button("＋ 添加一列", function () { sortRules.push({ c: sh.sel.c, desc: false }); renderRules(); });
        o1.appendChild(add);
        C.hdr = ui.check("第一行是标题（不参与排序）", false, function (v) { sortHeader = v; renderSortInfo(); });
        o1.appendChild(C.hdr);
        var go = el("div", "ofc-btnrow");
        go.appendChild(ui.button("现在排序", function () { var t = sortTarget(); t.header = sortHeader; sortBy(sortRules.length ? sortRules : [{ c: sh.sel.c, desc: false }], t); }, "ofc-default"));
        o1.appendChild(go);
        body.appendChild(o1);
        var t0 = sortTarget();
        sortHeader = t0.header;
        if (!sortRules.length) sortRules = [{ c: sh.sel.c, desc: false }];
        renderRules();
      } else if (inspMode === "organize" && inspTab === "filter") {
        var f1 = S("过滤");
        C.fon = ui.check("开启过滤（表头出现 ▾ 按钮）", !!sh.filter, function () { toggleFilter(); });
        f1.appendChild(C.fon);
        C.flist = el("div", "nb-rules");
        f1.appendChild(C.flist);
        var fb = el("div", "ofc-btnrow");
        fb.appendChild(ui.button("清除所有条件", function () { if (!sh.filter) return; tx("清除过滤", function () { setProp(sh, "filter", Object.assign({}, sh.filter, { cols: {} })); applyFilterRows(sh, false); }); }));
        f1.appendChild(fb);
        f1.appendChild(el("div", "ofc-note", "点表头格子右边的 ▾：勾选要显示的值、搜索，或者直接升序 / 降序排列。"));
        body.appendChild(f1);
      }
      syncInspector(true);
    }
    var sortRules = [], sortHeader = false, kindOverride = null, tabAnchor = null;
    function colLabel(c, rg) {
      var name = FX.colName(c), hdr = rg && sortHeader ? valueOf(sh, rg.r1, c) : null;
      return "列 " + name + (hdr != null && hdr !== "" ? "（" + FX.str(hdr).slice(0, 16) + "）" : "");
    }
    function renderSortInfo() { var t = sortTarget(); if (C.sortInfo) C.sortInfo.textContent = "范围：" + rangeText(t.rg) + (sortHeader ? "（第 " + (t.rg.r1 + 1) + " 行是标题）" : ""); if (C.hdr) C.hdr.set(sortHeader); renderRulesOnly(); }
    function renderRules() { renderSortInfo(); }
    function renderRulesOnly() {
      if (!C.rules) return;
      var t = sortTarget(), opts = [];
      for (var c = t.rg.c1; c <= Math.min(t.rg.c2, t.rg.c1 + 200); c++) opts.push({ v: String(c), label: colLabel(c, t.rg) });
      C.rules.textContent = "";
      sortRules.forEach(function (rule, i) {
        var row = el("div", "nb-rule");
        var s = ui.select(opts, String(rule.c), function (v) { rule.c = +v; });
        var d = ui.seg([{ v: "asc", label: "升序" }, { v: "desc", label: "降序" }], rule.desc ? "desc" : "asc", function (v) { rule.desc = v === "desc"; });
        var x = ui.button("✕", function () { sortRules.splice(i, 1); renderRulesOnly(); }, "nb-x");
        row.appendChild(s);
        row.appendChild(d);
        row.appendChild(x);
        C.rules.appendChild(row);
      });
    }
    function splitDate(nf) {
      var s = nf || "", t = TIME_FMTS.slice(1).map(function (x) { return x[0]; }).sort(function (a, b) { return b.length - a.length; }).find(function (x) { return s.slice(-x.length) === x; }) || "";
      var d = t ? s.slice(0, s.length - t.length).trim() : s;
      return { date: d, time: t };
    }
    function applyBorders(preset) {
      var b = { s: C.bstyle ? C.bstyle.value : "thin", c: borderColor && borderColor !== "#000000" ? borderColor : null };
      tx("边框", function () {
        sh.sel.ranges.forEach(function (rg0) {
          var rg = clipToUsedIfHuge(rg0);
          if ((rg.r2 - rg.r1 + 1) * (rg.c2 - rg.c1 + 1) > 100000) return;
          for (var r = rg.r1; r <= rg.r2; r++) for (var c = rg.c1; c <= rg.c2; c++) {
            var p = {}, top = r === rg.r1, bot = r === rg.r2, lef = c === rg.c1, rig = c === rg.c2;
            if (preset === "none") p = { bt: null, bb: null, bl: null, br: null };
            else if (preset === "all") p = { bt: b, bb: b, bl: b, br: b };
            else if (preset === "outer") { if (top) p.bt = b; if (bot) p.bb = b; if (lef) p.bl = b; if (rig) p.br = b; }
            else if (preset === "inner") { if (!top) p.bt = b; if (!bot) p.bb = b; if (!lef) p.bl = b; if (!rig) p.br = b; }
            else if (preset === "top" && top) p.bt = b;
            else if (preset === "bottom" && bot) p.bb = b;
            else if (preset === "left" && lef) p.bl = b;
            else if (preset === "right" && rig) p.br = b;
            if (!Object.keys(p).length) continue;
            var cell = cellAt(sh, r, c), sid = cell ? cell.s || 0 : styleId(sh, r, c), ns = book.styles.with(sid, p);
            if (ns !== sid) setCell(sh, r, c, Object.assign(cell ? Object.assign({}, cell) : { v: null }, { s: ns }));
          }
          if (preset === "none") {
            // 旁边格子朝这边的那条边也去掉
            var clr = function (r2, c2, key) { var cell = cellAt(sh, r2, c2); if (!cell || !cell.s) return; var st = book.styles.get(cell.s); if (!st[key]) return; var p2 = {}; p2[key] = null; setCell(sh, r2, c2, Object.assign({}, cell, { s: book.styles.with(cell.s, p2) })); };
            for (var c2 = rg.c1; c2 <= rg.c2; c2++) { if (rg.r1 > 0) clr(rg.r1 - 1, c2, "bb"); clr(rg.r2 + 1, c2, "bt"); }
            for (var r2 = rg.r1; r2 <= rg.r2; r2++) { if (rg.c1 > 0) clr(r2, rg.c1 - 1, "br"); clr(r2, rg.c2 + 1, "bl"); }
          }
        });
      });
    }
    var borderColor = "#000000";
    function syncInspector(force) {
      if (!doc.inspectorOn() && !force) return;
      var st = activeStyle();
      if (C.kind) {
        var k = kindOverride || numKind(st.nf), info = nfInfo(st.nf);
        C.kind.set(k);
        C.numRow.hidden = !(k === "number" || k === "currency" || k === "percent" || k === "sci");
        C.sep.hidden = !(k === "number" || k === "currency");
        C.sym.closest(".ofc-row").hidden = k !== "currency";
        C.neg.closest(".ofc-row").hidden = !(k === "number" || k === "currency");
        C.dec.set(info.dec);
        C.sep.set(info.sep);
        C.sym.set(info.sym === "¥" && /JP/.test(st.nf || "") ? "JP¥" : info.sym);
        C.neg.set(info.neg);
        C.dateRow.hidden = k !== "date";
        if (k === "date") { var sd = splitDate(st.nf); C.date.set(sd.date); C.time.set(sd.time); }
        C.durRow.hidden = k !== "duration";
        if (k === "duration") C.dur.set(st.nf);
        C.fracRow.hidden = k !== "fraction";
        if (k === "fraction") C.frac.set(st.nf);
        C.customRow.hidden = k !== "custom";
        C.custom.set(st.nf || "General");
        var v = valueOf(sh, sh.sel.r, sh.sel.c), dv = display(v, st, cellAt(sh, sh.sel.r, sh.sel.c), null);
        C.preview.textContent = v == null ? "" : "预览：" + (dv ? dv.text : "");
        C.fill.set(st.fill || null);
      }
      if (C.font) {
        C.font.set(st.font || "");
        if (st.font && C.font.dataset.mixed) { C.font.setOptions(FONTS.map(function (f) { return { v: f[0], label: f[1] }; }).concat([{ v: st.font, label: st.font }])); C.font.set(st.font); }
        C.size.set(st.sz || DEF_SZ);
        C.bius.set({ b: st.b, i: st.i, u: st.u, st: st.st });
        C.color.set(st.color || null);
        C.ha.set(st.ha || "");
        C.va.set(st.va || "");
        C.wrap.set(!!st.wrap);
        C.ind.set(st.ind || 0);
      }
      if (C.sname) {
        if (document.activeElement !== C.sname) C.sname.value = sh.name;
        C.tab.set(sh.tab || null);
        C.grid.set(sh.grid !== false);
        var fz = sh.freeze, fv = fz.r === 0 && fz.c === 0 ? "0,0" : fz.r === 1 && fz.c === 0 ? "1,0" : fz.r === 0 && fz.c === 1 ? "0,1" : fz.r === 1 && fz.c === 1 ? "1,1" : "sel";
        C.freeze.set(fv);
        var rg = curRange();
        C.rowh.set(sh.rows.sz(rg.r1) || sh.rows.def);
        C.colw.set(sh.cols.sz(rg.c1) || sh.cols.def);
      }
      if (C.fon) {
        C.fon.set(!!sh.filter);
        C.flist.textContent = "";
        if (sh.filter) {
          var cols = Object.keys(sh.filter.cols || {});
          C.flist.appendChild(el("div", "ofc-note", "范围：" + rangeText({ r1: sh.filter.r1, c1: sh.filter.c1, r2: filterLast(sh), c2: sh.filter.c2 }) + (sh.rows.fhidden.size ? "，藏起了 " + sh.rows.fhidden.size + " 行" : "")));
          cols.forEach(function (c) {
            var cr = sh.filter.cols[c], row = el("div", "nb-rule");
            row.appendChild(el("span", "nb-rule-t", esc(colLabel(+c, { r1: sh.filter.r1 })) + "：" + esc(cr.vals ? "显示 " + cr.vals.length + " 个值" : "包含 “" + cr.q + "”")));
            row.appendChild(ui.button("编辑", function () { openFilterPop(+c); }));
            row.appendChild(ui.button("✕", function () { setFilterCol(+c, null); }, "nb-x"));
            C.flist.appendChild(row);
          });
        }
      }
      if (C.sortInfo) renderSortInfo();
    }

    // ======== 菜单 ========
    function fnMenuItems(fromFx) {
      var ins = function (name) { return function () { insertFunction(name); }; };
      var quick = [["求和", "SUM"], ["平均值", "AVERAGE"], ["最小值", "MIN"], ["最大值", "MAX"], ["计数", "COUNT"], ["乘积", "PRODUCT"]];
      var cats = [
        ["逻辑", ["IF", "IFS", "IFERROR", "AND", "OR", "NOT", "SWITCH"]],
        ["查找与引用", ["VLOOKUP", "XLOOKUP", "INDEX", "MATCH", "HLOOKUP", "CHOOSE", "ROW", "COLUMN"]],
        ["条件汇总", ["SUMIF", "SUMIFS", "COUNTIF", "COUNTIFS", "AVERAGEIF", "AVERAGEIFS", "MAXIFS", "MINIFS"]],
        ["数学", ["ROUND", "ROUNDUP", "ROUNDDOWN", "INT", "ABS", "MOD", "POWER", "SQRT", "SUMPRODUCT", "RAND", "RANDBETWEEN"]],
        ["文本", ["TEXT", "LEN", "LEFT", "RIGHT", "MID", "CONCAT", "TEXTJOIN", "SUBSTITUTE", "TRIM", "UPPER", "LOWER", "FIND", "VALUE"]],
        ["日期与时间", ["TODAY", "NOW", "DATE", "YEAR", "MONTH", "DAY", "WEEKDAY", "EDATE", "EOMONTH", "DATEDIF", "NETWORKDAYS", "WORKDAY"]],
        ["统计", ["MEDIAN", "MODE", "STDEV", "VAR", "LARGE", "SMALL", "RANK", "PERCENTILE"]],
        ["财务", ["PMT", "FV", "PV", "NPV"]],
      ];
      return quick.map(function (q) { return it(q[0] + "（" + q[1] + "）", "", function () { autoSum(q[1]); }); })
        .concat([SEP], cats.map(function (c) { return it(c[0], "", null, { items: c[1].map(function (n) { return it(n + (FNINFO[n] ? "  —  " + FNINFO[n][1] : ""), "", ins(n)); }) }); }));
    }
    function insertFunction(name) {
      if (!editing) beginEdit("=", "enter");
      var inp = editing.input;
      if (!editing.formula) { inp.value = "=" + inp.value; }
      var pos = inp.selectionStart, before = inp.value.slice(0, pos), after = inp.value.slice(pos);
      inp.value = before + name + "(" + after;
      var np = pos + name.length + 1;
      if (!FNINFO[name] || !FNINFO[name][0]) { inp.value = before + name + "()" + after; np = pos + name.length + 2; }
      inp.focus();
      inp.setSelectionRange(np, np);
      syncEditInputs(inp);
    }
    // Σ：选的是一格 → 猜上面（或左边）连着的数字；选的是一块 → 在下面（右边）写结果
    function autoSum(fn) {
      var rg = curRange(), s = sh.sel;
      if (rg.r1 === rg.r2 && rg.c1 === rg.c2) {
        var r = s.r, c = s.c, top = r, left = c;
        while (top > 0 && typeof valueOf(sh, top - 1, c) === "number") top--;
        var refText = "";
        if (top < r) refText = FX.addr(top, c) + ":" + FX.addr(r - 1, c);
        else { while (left > 0 && typeof valueOf(sh, r, left - 1) === "number") left--; if (left < c) refText = FX.addr(r, left) + ":" + FX.addr(r, c - 1); }
        beginEdit("=" + fn + "(" + refText + ")", "enter");
        var inp = editing.input, st = fn.length + 2;
        inp.setSelectionRange(st, st + refText.length);
        if (refText) { var p = NB.parseRange(refText); editing.point = { start: st, end: st + refText.length, r: p.r1, c: p.c1, r2: p.r2, c2: p.c2 }; inp.setSelectionRange(st + refText.length, st + refText.length); }
        syncEditInputs(inp);
        return;
      }
      var u = NB.used(sh), r2 = Math.min(rg.r2, u.r), c2 = Math.min(rg.c2, u.c);
      tx("插入公式", function () {
        if (r2 > rg.r1 || rg.c1 === c2) {
          for (var c3 = rg.c1; c3 <= c2; c3++) setCell(sh, r2 + 1, c3, Object.assign(cellFromText(sh, r2 + 1, c3, "=" + fn + "(" + FX.addr(rg.r1, c3) + ":" + FX.addr(r2, c3) + ")") || {}, {}));
        } else {
          for (var r3 = rg.r1; r3 <= r2; r3++) setCell(sh, r3, c2 + 1, cellFromText(sh, r3, c2 + 1, "=" + fn + "(" + FX.addr(r3, rg.c1) + ":" + FX.addr(r3, c2) + ")"));
        }
      });
    }
    function contextItems(h) {
      var items = [];
      if (h.area === "colhead" || h.area === "rowhead" || h.area === "cell" || h.area === "corner") {
        items.push(it("剪切", "⌘X", function () { copyFromMenu(true); }), it("拷贝", "⌘C", function () { copyFromMenu(false); }), it("粘贴", "⌘V", function () { pasteFromMenu(false); }), it("只粘贴值", "⌥⇧⌘V", function () { pasteFromMenu(true); }), SEP);
      }
      if (h.area === "colhead") {
        items.push(it("在左侧插入列", "", function () { insertCols(false); }), it("在右侧插入列", "", function () { insertCols(true); }), it("删除列", "", deleteCols), SEP,
          it("隐藏列", "", function () { hideAxis("c", true); }), it("取消隐藏列", "", function () { hideAxis("c", false); }), it("自动调整列宽", "", function () { var rg = curRange(), l = []; for (var c = rg.c1; c <= Math.min(rg.c2, rg.c1 + 500); c++) l.push(c); autofitCols(l); }), SEP,
          it("升序排列", "", function () { quickSort(false); }), it("降序排列", "", function () { quickSort(true); }));
      } else if (h.area === "rowhead") {
        items.push(it("在上方插入行", "", function () { insertRows(false); }), it("在下方插入行", "", function () { insertRows(true); }), it("删除行", "", deleteRows), SEP,
          it("隐藏行", "", function () { hideAxis("r", true); }), it("取消隐藏行", "", function () { hideAxis("r", false); }), it("自动调整行高", "", function () { var rg = curRange(), l = []; for (var r = rg.r1; r <= Math.min(rg.r2, rg.r1 + 2000); r++) l.push(r); autofitRows(l); }));
      } else if (h.area === "cell") {
        items.push(it("清除内容", "⌫", function () { clearSel("contents"); }), it("清除格式", "", function () { clearSel("formats"); }), SEP,
          it("插入", "", null, { items: [it("在上方插入行", "", function () { insertRows(false); }), it("在下方插入行", "", function () { insertRows(true); }), it("在左侧插入列", "", function () { insertCols(false); }), it("在右侧插入列", "", function () { insertCols(true); })] }),
          it("删除", "", null, { items: [it("删除行", "", deleteRows), it("删除列", "", deleteCols)] }), SEP,
          selHasMerge() ? it("取消合并", "", unmergeSel) : it("合并单元格", "", function () { mergeSel(); }, { disabled: curRange().r1 === curRange().r2 && curRange().c1 === curRange().c2 }),
          it("升序排列", "", function () { quickSort(false); }), it("降序排列", "", function () { quickSort(true); }), it(sh.filter ? "关闭过滤" : "过滤", "", toggleFilter), SEP,
          it("格式…", "⌘1", function () { showInsp("format"); }));
      }
      return items;
    }
    function viewMenuItems() {
      return [
        it("显示网格线", "", function () { tx("网格线", function () { setProp(sh, "grid", !sh.grid); }); }, { checked: sh.grid !== false }),
        it("显示公式", "⌃`", function () { showFormulas = !showFormulas; paintSoon(); doc.refresh(); }, { checked: showFormulas }),
        it("冻结", "", null, { items: freezeItems() }),
        SEP,
        it("放大", "⌘+", function () { setZoom(zoom + 0.1); }),
        it("缩小", "⌘−", function () { setZoom(zoom - 0.1); }),
        it("实际大小", "⌘0", function () { setZoom(1); }),
        SEP,
        it(doc.inspectorOn() && inspMode === "format" ? "隐藏检查器" : "显示格式检查器", "⌥⌘I", function () { showInsp("format"); }),
        it("显示整理检查器", "", function () { showInsp("organize"); }),
      ];
    }
    function freezeItems() {
      var fz = sh.freeze;
      return [
        it("冻结首行", "", function () { setFreeze(1, 0); }, { checked: fz.r === 1 && fz.c === 0 }),
        it("冻结首列", "", function () { setFreeze(0, 1); }, { checked: fz.r === 0 && fz.c === 1 }),
        it("冻结至当前单元格（" + FX.addr(sh.sel.r, sh.sel.c) + " 的左上方）", "", function () { setFreeze(sh.sel.r, sh.sel.c); }),
        it("取消冻结", "", function () { setFreeze(0, 0); }, { disabled: !fz.r && !fz.c }),
      ];
    }
    function zoomItems() {
      return [0.5, 0.75, 1, 1.25, 1.5, 2].map(function (z) { return it(Math.round(z * 100) + "%", "", function () { setZoom(z); }, { checked: Math.abs(zoom - z) < 0.001 }); })
        .concat([SEP, it("放大", "⌘+", function () { setZoom(zoom + 0.1); }), it("缩小", "⌘−", function () { setZoom(zoom - 0.1); })]);
    }
    function numFmtItems() {
      var st = activeStyle(), k = numKind(st.nf);
      return [
        it("自动", "", function () { setNf(null); }, { checked: k === "auto" }),
        it("数字（1,234.56）", "", function () { setNf("#,##0.00"); }, { checked: k === "number" }),
        it("货币（¥1,234.56）", "", function () { setNf('"¥"#,##0.00'); }, { checked: k === "currency" }),
        it("百分比（12%）", "", function () { setNf("0%"); }, { checked: k === "percent" }),
        it("日期（2026-09-26）", "", function () { setNf("yyyy-mm-dd"); }, { checked: k === "date" }),
        it("时间（09:41）", "", function () { setNf("hh:mm"); }),
        it("文本", "", function () { setNf("@"); }, { checked: k === "text" }),
        SEP,
        it("增加小数位数", "", function () { var info = nfInfo(st.nf); info.dec = Math.min(10, info.dec + 1); setNf(buildNf(k === "auto" ? "number" : k === "custom" ? "number" : k, info)); }),
        it("减少小数位数", "", function () { var info = nfInfo(st.nf); info.dec = Math.max(0, info.dec - 1); setNf(buildNf(k === "auto" ? "number" : k === "custom" ? "number" : k, info)); }),
      ];
    }
    var view = {
      el: root,
      inspector: insp,
      toolbar: [
        { id: "view", label: "显示", icon: "sidebar", menu: viewMenuItems },
        { id: "zoom", label: "缩放", text: function () { return Math.round(zoom * 100) + "%"; }, menu: zoomItems },
        "sep",
        { id: "sheet", label: "工作表", icon: "addSheet", run: function () { addSheet(); }, tip: "新建工作表" },
        { id: "insert", label: "插入", icon: "plus", menu: function () { return [it("在上方插入行", "", function () { insertRows(false); }), it("在下方插入行", "", function () { insertRows(true); }), it("在左侧插入列", "", function () { insertCols(false); }), it("在右侧插入列", "", function () { insertCols(true); }), SEP, it("当前日期", "⌘;", function () { insertNow("date"); }), it("当前时间", "⇧⌘;", function () { insertNow("time"); }), SEP, it("函数", "", null, { items: fnMenuItems() })]; } },
        { id: "fn", label: "函数", icon: "sigma", menu: function () { return fnMenuItems(); } },
        { id: "merge", label: "合并", icon: "merge", run: function () { if (selHasMerge()) unmergeSel(); else mergeSel(); }, on: selHasMerge, tip: "合并 / 取消合并单元格" },
        { id: "freeze", label: "冻结", icon: "freeze", menu: freezeItems, on: function () { return !!(sh.freeze.r || sh.freeze.c); } },
        "flex",
        { id: "filter", label: "过滤", icon: "filter", run: function () { toggleFilter(); }, on: function () { return !!sh.filter; } },
        { id: "organize", label: "整理", icon: "sort", run: function () { showInsp("organize"); }, on: function () { return doc.inspectorOn() && inspMode === "organize"; } },
        { id: "format", label: "格式", icon: "brush", run: function () { showInsp("format"); }, on: function () { return doc.inspectorOn() && inspMode === "format"; } },
      ],
      menus: function () {
        var rg = curRange(), single = rg.r1 === rg.r2 && rg.c1 === rg.c2;
        return [
          { title: "编辑", items: [
            it(undoStack.length ? "撤销" + undoStack[undoStack.length - 1].label : "撤销", "⌘Z", undo, { disabled: !undoStack.length }),
            it(redoStack.length ? "重做" + redoStack[redoStack.length - 1].label : "重做", "⇧⌘Z", redo, { disabled: !redoStack.length }),
            SEP,
            it("剪切", "⌘X", function () { copyFromMenu(true); }), it("拷贝", "⌘C", function () { copyFromMenu(false); }), it("粘贴", "⌘V", function () { pasteFromMenu(false); }), it("只粘贴值", "⌥⇧⌘V", function () { pasteFromMenu(true); }),
            it("删除（清除内容）", "⌫", function () { clearSel("contents"); }), it("全部清除（含格式）", "", function () { clearSel("all"); }),
            it("全选", "⌘A", selectAll),
            SEP,
            it("填充", "", null, { items: [it("向下填充", "⌘D", function () { fillDir("down"); }), it("向右填充", "⌘R", function () { fillDir("right"); })] }),
            SEP,
            it("查找…", "⌘F", function () { openFind(false); }), it("查找与替换…", "⌥⌘F", function () { openFind(true); }),
          ] },
          { title: "插入", items: [
            it("工作表", "", addSheet), SEP,
            it("在上方插入行", "", function () { insertRows(false); }), it("在下方插入行", "", function () { insertRows(true); }), it("在左侧插入列", "", function () { insertCols(false); }), it("在右侧插入列", "", function () { insertCols(true); }),
            SEP, it("函数", "", null, { items: fnMenuItems() }), it("当前日期", "⌘;", function () { insertNow("date"); }), it("当前时间", "⇧⌘;", function () { insertNow("time"); }),
          ] },
          { title: "工作表", items: [
            it("删除行", "", deleteRows), it("删除列", "", deleteCols), SEP,
            it("隐藏行", "", function () { hideAxis("r", true); }), it("隐藏列", "", function () { hideAxis("c", true); }), it("取消隐藏所有行", "", function () { unhideAll("r"); }, { disabled: !sh.rows.hidden.size }), it("取消隐藏所有列", "", function () { unhideAll("c"); }, { disabled: !sh.cols.hidden.size }), SEP,
            it("合并单元格", "", function () { mergeSel(); }, { disabled: single }), it("取消合并", "", unmergeSel, { disabled: !selHasMerge() }), SEP,
            it("冻结", "", null, { items: freezeItems() }),
            it("自动调整列宽", "", function () { var l = []; for (var c = rg.c1; c <= Math.min(rg.c2, Math.max(rg.c1, NB.used(sh).c)); c++) l.push(c); autofitCols(l); }),
            it("自动调整行高", "", function () { var l = []; for (var r = rg.r1; r <= Math.min(rg.r2, Math.max(rg.r1, NB.used(sh).r)); r++) l.push(r); autofitRows(l); }),
            SEP,
            it("工作表", "", null, { items: sheetMenuItems(sh) }),
          ] },
          { title: "格式", items: [
            it("字体", "", null, { items: [it("粗体", "⌘B", function () { toggleStyle("b"); }, { checked: !!activeStyle().b }), it("斜体", "⌘I", function () { toggleStyle("i"); }, { checked: !!activeStyle().i }), it("下划线", "⌘U", function () { toggleStyle("u"); }, { checked: !!activeStyle().u }), it("删除线", "", function () { toggleStyle("st"); }, { checked: !!activeStyle().st }), SEP,
              it("更大", "", function () { applyStyle(function (st) { return { sz: Math.min(96, (st.sz || DEF_SZ) + 1) }; }, "字号"); }), it("更小", "", function () { applyStyle(function (st) { return { sz: Math.max(6, (st.sz || DEF_SZ) - 1) }; }, "字号"); })] }),
            it("数据格式", "", null, { items: numFmtItems() }),
            it("对齐", "", null, { items: [it("靠左", "", function () { applyStyle({ ha: "left" }); }), it("居中", "", function () { applyStyle({ ha: "center" }); }), it("靠右", "", function () { applyStyle({ ha: "right" }); }), it("自动", "", function () { applyStyle({ ha: null }); }), SEP, it("顶端", "", function () { applyStyle({ va: "top" }); }), it("垂直居中", "", function () { applyStyle({ va: "middle" }); }), it("底端", "", function () { applyStyle({ va: null }); })] }),
            it("自动换行", "", function () { applyStyle({ wrap: activeStyle().wrap ? null : 1 }, "自动换行"); }, { checked: !!activeStyle().wrap }),
            SEP,
            it("清除格式", "", function () { clearSel("formats"); }),
            it("显示检查器", "⌥⌘I", function () { showInsp("format"); }),
          ] },
          { title: "整理", items: [
            it("升序排列", "", function () { quickSort(false); }), it("降序排列", "", function () { quickSort(true); }), it("排序…", "", function () { inspTab = "sort"; showInsp("organize"); }),
            SEP,
            it(sh.filter ? "关闭过滤" : "开启过滤", "", toggleFilter),
            it("清除所有过滤条件", "", function () { if (sh.filter) tx("清除过滤", function () { setProp(sh, "filter", Object.assign({}, sh.filter, { cols: {} })); applyFilterRows(sh, false); }); }, { disabled: !sh.filter || !Object.keys(sh.filter.cols || {}).length }),
          ] },
          { title: "显示", items: viewMenuItems() },
        ];
      },
      serialize: function (fmt) {
        if (fmt === "csv" || fmt === "tsv") {
          var s = doc.fmt === fmt && doc.path ? book.sheets[0] : sh;
          return NB.csvText(book, calc, s, fmt === "tsv" ? "\t" : ",");
        }
        sh.zoom = zoom;
        return NB.writeXlsx(book, calc);
      },
      replace: function (nb) {
        var idx = book.sheets.indexOf(sh), name = sh.name, selSnap = { r: sh.sel.r, c: sh.sel.c };
        book = nb;
        calc = NB.calcFor(book);
        undoStack = [];
        redoStack = [];
        if (editing) endEditUI();
        var s = NB.sheetByName(book, name) || book.sheets[Math.min(idx, book.sheets.length - 1)] || book.sheets[0];
        sh = null;
        switchTo(s, true);
        sh.sel.r = Math.min(selSnap.r, MAXR - 1); sh.sel.c = selSnap.c; sh.sel.ranges = [{ r1: sh.sel.r, c1: sh.sel.c, r2: sh.sel.r, c2: sh.sel.c }];
        stopAnts();
        afterReload();
      },
      printable: function () { return printHTML(); },
      focus: function () { focus(); },
      resize: function () { resize(); },
      mounted: function () { resize(); ensureVisible(sh.sel.r, sh.sel.c); },
      destroy: function () { ro.disconnect(); offTheme(); clearInterval(antsT); hideSizeTip(); },
    };
    function afterReload() {
      calc.reset();
      cfVer++;
      mergeCache.src = null;
      wrapCache.clear();
      renderTabs();
      updateSpace();
      paintSoon();
      showFx();
      updateStatus();
      syncInspector();
      doc.refresh();
    }
    // ======== 打印 / 导出 PDF：当前工作表用到的区域画成表格（列宽、行高、格式同表格），行多了自动分页；
    // 纸不够宽就把列分成几段，一段印完再印下一段（同 Excel 的「先往下、再往右」），不会有列被裁掉 ========
    function printHTML() {
      var u = NB.used(sh), mergeOf = new Map();
      sh.merges.forEach(function (m) { for (var r = m.r1; r <= m.r2; r++) for (var c = m.c1; c <= m.c2; c++) mergeOf.set(K(r, c), m); });
      var cols = [], rows = [];
      for (var c0 = 0; c0 <= u.c; c0++) if (sh.cols.sz(c0)) cols.push(c0);
      for (var r0 = 0; r0 <= u.r; r0++) if (sh.rows.sz(r0)) rows.push(r0);
      // A4、页边距 14mm：竖着版心 182mm 宽，横着 269mm（CSS px）
      var total = cols.reduce(function (s, c) { return s + sh.cols.sz(c); }, 0), land = total > 182 / 25.4 * 96, maxW = (land ? 269 : 182) / 25.4 * 96;
      var groups = [], cur = [], w = 0, groupOf = new Map();
      cols.forEach(function (c) { var cw = sh.cols.sz(c); if (cur.length && w + cw > maxW) { groups.push(cur); cur = []; w = 0; } cur.push(c); w += cw; });
      groups.push(cur);
      groups.forEach(function (g, gi) { g.forEach(function (c) { groupOf.set(c, gi); }); });
      var visRows = function (m) { return rows.filter(function (r) { return r >= m.r1 && r <= m.r2; }); };
      function td(r, c, span, text) {
        var st = styleOf(sh, r, c), cell = cellAt(sh, r, c), dv = text ? display(valueOf(sh, r, c), st, cell, null) : null, css = [];
        if (st.b) css.push("font-weight:600");
        if (st.i) css.push("font-style:italic");
        if (st.u || st.st) css.push("text-decoration:" + [st.u && "underline", st.st && "line-through"].filter(Boolean).join(" "));
        if (st.color || dv && dv.color) css.push("color:" + (dv && dv.color || st.color));
        if (st.fill) css.push("background:" + st.fill);
        css.push("text-align:" + (st.ha || (dv ? dv.align : "left")));
        if (st.va) css.push("vertical-align:" + st.va);
        if (st.sz) css.push("font-size:" + st.sz + "pt");
        if (st.font) css.push("font-family:'" + st.font + "'," + FONT);
        if (st.wrap) css.push("white-space:pre-wrap");
        [["bt", "top"], ["bb", "bottom"], ["bl", "left"], ["br", "right"]].forEach(function (x) { var b = st[x[0]]; if (b) css.push("border-" + x[1] + ":" + (b.s === "medium" ? 2 : b.s === "thick" ? 3 : 1) + "px " + (b.s === "dashed" ? "dashed" : b.s === "dotted" ? "dotted" : b.s === "double" ? "double" : "solid") + " " + (b.c || "#000")); });
        return "<td" + (span ? ' colspan="' + span[0] + '" rowspan="' + span[1] + '"' : "") + ' style="' + css.join(";") + '">' + (dv ? esc(dv.text).replace(/\n/g, "<br>") : "") + "</td>";
      }
      var tables = groups.map(function (g, gi) {
        var body = rows.map(function (r0) {
          var tds = [];
          g.forEach(function (c) {
            var m = mergeOf.get(K(r0, c));
            if (!m) return tds.push(td(r0, c, null, true));
            // 合并的格子：画在它在这一段里最上面一行、最左一列的位置，只数看得见的行列；从前一段伸过来的那截只画底色和框线
            var mc = g.filter(function (x) { return x >= m.c1 && x <= m.c2; }), mr = visRows(m);
            if (r0 !== mr[0] || c !== mc[0]) return;
            var lead = Math.min.apply(null, cols.filter(function (x) { return x >= m.c1 && x <= m.c2; }).map(function (x) { return groupOf.get(x); })) === gi;
            tds.push(td(m.r1, m.c1, [mc.length, mr.length], lead));
          });
          return '<tr style="height:' + sh.rows.sz(r0) + 'px">' + tds.join("") + "</tr>";
        }).join("");
        var width = g.reduce(function (s, c) { return s + sh.cols.sz(c); }, 0);
        return '<table style="width:' + width + "px" + (gi ? ";break-before:page;page-break-before:always" : "") + '"><colgroup>' + g.map(function (c) { return '<col style="width:' + sh.cols.sz(c) + 'px">'; }).join("") + "</colgroup>" + body + "</table>";
      });
      var grid = sh.grid !== false ? "td{border:0.5px solid #d0d0d0}" : "";
      return {
        html: "<h1>" + esc(doc.label() + (book.sheets.length > 1 ? " — " + sh.name : "")) + "</h1>" + tables.join(""),
        css: "@page{size:A4 " + (land ? "landscape" : "portrait") + ";margin:14mm}body{font:" + (DEF_SZ * PT) + "px " + FONT + ";color:#000;margin:0}h1{font-size:14px;font-weight:600;margin:0 0 8px;color:#444}table{border-collapse:collapse;table-layout:fixed}" + grid + "td{padding:1px 4px;overflow:hidden;white-space:nowrap;vertical-align:bottom}tr{page-break-inside:avoid;break-inside:avoid}",
        page: "A4", landscape: land, margin: 14 / 25.4 * 72,
      };
    }

    // ======== 尺寸、外观 ========
    function resize() { updateSpace(); paint(); }
    var ro = new ResizeObserver(function () { resize(); });
    ro.observe(gridEl);
    var offTheme = O.onTheme(function () { paintSoon(); });

    // 起步
    renderTabs();
    inspTabs();
    updateSpace();
    if (sh.scroll) { scrollEl.scrollLeft = sh.scroll.x || 0; scrollEl.scrollTop = sh.scroll.y || 0; }
    showFx();
    updateNameBox();
    updateStatus();
    paintSoon();
    // ======== App 的动作（系统命令 numbers / pages / keynote 用）：按工作表名、A1 区域读写；每次写是一步可撤销的操作，界面跟着刷新、选中写过的地方 ========
    function sheetOf(name) {
      if (!name) return sh;
      var s = NB.sheetByName(book, name);
      if (!s) throw new Error("no sheet named \"" + name + "\" (sheets: " + book.sheets.map(function (x) { return x.name; }).join(", ") + ")");
      return s;
    }
    function rangeOf(ref) {
      var m = /^\s*(\$?[A-Za-z]{1,3}\$?\d+)\s*(?::\s*(\$?[A-Za-z]{1,3}\$?\d+))?\s*$/.exec(String(ref || ""));
      var a = m && FX.parseAddr(m[1]), b = m && (m[2] ? FX.parseAddr(m[2]) : a);
      if (!a || !b) throw new Error("range should look like A1 or A1:C5, got \"" + ref + "\"");
      return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
    }
    var plain = function (v) { return v == null ? "" : v instanceof Object && v.code ? String(v.code) : typeof v === "object" ? String(v) : v; };
    view.api = {
      sheets: function () {
        return book.sheets.map(function (s) { var u = NB.used(s); return { name: s.name, used: u.r >= 0 && u.c >= 0 ? "A1:" + FX.addr(u.r, u.c) : "", current: s === sh }; });
      },
      // formulas：true 时有公式的格子给「=公式」，不给算好的值
      read: function (ref, sheet, formulas) {
        var s = sheetOf(sheet), rg;
        if (ref) rg = rangeOf(ref);
        else { var u = NB.used(s); if (u.r < 0 || u.c < 0) return { sheet: s.name, range: "", values: [] }; rg = { r1: 0, c1: 0, r2: u.r, c2: u.c }; }
        var r2 = Math.min(rg.r2, rg.r1 + 499), c2 = Math.min(rg.c2, rg.c1 + 49), rows = [];
        for (var r = rg.r1; r <= r2; r++) {
          var row = [];
          for (var c = rg.c1; c <= c2; c++) { var cell = s.cells.get(K(r, c)); row.push(formulas && cell && cell.f != null ? "=" + cell.f : plain(valueOf(s, r, c))); }
          rows.push(row);
        }
        return { sheet: s.name, range: FX.addr(rg.r1, rg.c1) + ":" + FX.addr(r2, c2), values: rows, truncated: r2 < rg.r2 || c2 < rg.c2 };
      },
      // values：二维数组（一行一行）；一维数组 = 一行；单个值 = 一格。字符串以 = 开头是公式；数字、日期文字照常识别（同手打）
      write: function (ref, values, sheet) {
        var s = sheetOf(sheet), rg = rangeOf(ref);
        var grid = Array.isArray(values) ? (values.length && !Array.isArray(values[0]) ? [values] : values) : [[values]];
        var n = 0, maxC = 0;
        if (editing) commitEdit();
        tx("agent 写入 " + FX.addr(rg.r1, rg.c1), function () {
          grid.forEach(function (row, i) {
            (Array.isArray(row) ? row : [row]).forEach(function (v, j) {
              var r = rg.r1 + i, c = rg.c1 + j, text = v == null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
              setCell(s, r, c, cellFromText(s, r, c, text));
              n++; maxC = Math.max(maxC, j);
            });
          });
        });
        var r2 = rg.r1 + Math.max(0, grid.length - 1), c2 = rg.c1 + maxC;
        if (s !== sh) switchTo(s, true);
        setSel(rg.r1, rg.c1, r2, c2);
        ensureVisible(rg.r1, rg.c1);
        paintSoon();
        return { sheet: s.name, range: FX.addr(rg.r1, rg.c1) + ":" + FX.addr(r2, c2), cells: n };
      },
      addSheet: function (name) {
        var s = NB.newSheet(uniqueSheetName(String(name || "").trim() || "工作表 " + (book.sheets.length + 1)));
        tx("新建工作表", function () { var arr = book.sheets.slice(); arr.push(s); setProp(book, "sheets", arr); });
        switchTo(s);
        return s.name;
      },
    };
    // 给测试 / agent 调试用
    view._debug = { book: function () { return book; }, sheet: function () { return sh; }, calc: function () { return calc; }, sel: function () { return sh.sel; }, setSel: setSel, writeText: writeText, beginEdit: beginEdit, commitEdit: commitEdit, undo: undo, redo: redo, insertRows: insertRows, deleteRows: deleteRows, insertCols: insertCols, deleteCols: deleteCols, sortBy: sortBy, toggleFilter: toggleFilter, setFilterCol: setFilterCol, doFill: doFill, mergeSel: mergeSel, setFreeze: setFreeze, applyStyle: applyStyle, addSheet: addSheet, renameSheet: renameSheet, switchTo: switchTo, pasteAny: pasteAny, copyData: copyData, display: display, valueOf: valueOf, geom: geom, hit: hit, paint: paint, zoom: function () { return zoom; } };
    return view;
  }

  O.defineApp({
    id: "numbers", name: "表格", native: "xlsx",
    opens: ["xlsx", "xlsm", "xls", "ods", "numbers", "csv", "tsv"],
    writes: { xlsx: "lossless", csv: "lossy", tsv: "lossy" },
    saveFormats: [{ ext: "xlsx", label: "Excel 工作簿" }, { ext: "csv", label: "CSV（逗号分隔，只存当前工作表的值）" }, { ext: "tsv", label: "TSV（制表符分隔）" }],
    exportFormats: [{ ext: "xlsx", label: "Excel" }, { ext: "csv", label: "CSV" }, { ext: "tsv", label: "TSV" }, { ext: "pdf", label: "PDF" }],
    lossyNote: function (ext) { return ext.toUpperCase() + " 只存第一个工作表的值：公式存成算好的结果，格式、其他工作表、合并、冻结都不会存。要全部留着，请存储为 .xlsx。"; },
    about: "表格文件是标准的 Excel 工作簿（.xlsx），可以直接用 Microsoft Excel、WPS、Numbers 打开；也能打开和存储 CSV / TSV，读取 .xls / .ods / .numbers。agent 可以用 openpyxl 读写同一个文件，打开着的表格会提示重新载入。",
    width: 1080, height: 700,
    templates: NB.TEMPLATES.map(function (t) { return { id: t.id, name: t.name, thumb: thumbFor(t.id) }; }),
    newState: function (tpl) { return NB.templateBook(tpl); },
    read: function (u8, ext, path) { return NB.read(u8, ext, path); },
    createView: createView,
    // App 的动作（系统命令用，参数说明在 office.js）：h.check() 查能不能改这份文稿，h.settle() 改完存下去
    actions: {
      sheets: function (doc) { var l = doc.view.api.sheets(); return { data: l, text: l.map(function (x) { return x.name + "\t" + (x.used || "(empty)") + (x.current ? "\t(current)" : ""); }).join("\n"), summary: l.length + " sheet" + (l.length > 1 ? "s" : "") }; },
      // 值：制表符分隔的行（接着用 cut、awk、python 都方便）；--json 给 { sheet, range, values }
      read: function (doc, a) {
        var r = doc.view.api.read(a.range, a.sheet, a.formulas), cell = function (v) { return v == null ? "" : String(v).replace(/[\t\n]/g, " "); };
        return { data: r, text: r.values.map(function (row) { return row.map(cell).join("\t"); }).join("\n") + (r.truncated ? "\n(truncated: read a smaller range)" : ""), summary: "Read " + r.sheet + (r.range ? "!" + r.range : " (empty)") };
      },
      write: function (doc, a, h) {
        h.check();
        var r = doc.view.api.write(a.range, a.values, a.sheet);
        return h.settle().then(function (sv) { return { text: "Wrote " + r.cells + " cell" + (r.cells > 1 ? "s" : "") + " to " + r.sheet + "!" + r.range + " in " + h.label + sv + ".", summary: "Wrote " + r.sheet + "!" + r.range }; });
      },
      addSheet: function (doc, a, h) { h.check(); var n = doc.view.api.addSheet(a.name); return h.settle().then(function (sv) { return { text: "Added sheet " + n + " to " + h.label + sv + ".", summary: "Added sheet " + n }; }); },
    },
  });
  // 模板的小预览
  function thumbFor(id) {
    var rows = function (n, cols, head) {
      var h = '<div class="nbt-grid">';
      for (var r = 0; r < n; r++) { h += '<div class="nbt-row' + (r === 0 && head ? " head" : "") + '">'; for (var c = 0; c < cols; c++) h += "<i></i>"; h += "</div>"; }
      return h + "</div>";
    };
    if (id === "blank") return '<div class="nbt nbt-blank">' + rows(9, 5, false) + "</div>";
    if (id === "table") return '<div class="nbt">' + rows(9, 5, true) + "</div>";
    if (id === "budget") return '<div class="nbt nbt-budget"><b class="nbt-title">个人月度预算</b>' + rows(4, 4, true) + rows(5, 4, true) + "</div>";
    if (id === "todo") return '<div class="nbt nbt-todo"><b class="nbt-title">待办清单</b>' + rows(7, 4, true) + "</div>";
    if (id === "invoice") return '<div class="nbt nbt-inv"><b class="nbt-title">发 票</b><span class="nbt-lines"><i></i><i></i><i></i></span>' + rows(5, 4, true) + "</div>";
    return '<div class="nbt">' + rows(8, 5, true) + "</div>";
  }
})();
