// stats.js —— 用量统计卡片（新会话页上那张，同 Claude 桌面版）：「总览 | 模型」两页，右上「全部 | 30 天 | 7 天」。
//   总览：会话、消息（轮）、总 token、活跃天数、高峰时段、最常用模型六格；下面一张按天的热力图（一列一周，一行一个星期几）；最后一句好玩的换算。
//   模型：按天叠起来的柱状图（每个模型一种蓝），下面每个模型一行：输入 · 输出、占比。
//   数据：GET /api/stats（服务器把账本按本地日期 × 模型汇总好）；一分钟内再挂只用缓存。
//   用法：TSU_STATS.mount(el) —— 画进 el（再调一次就是刷新）。
(function () {
  "use strict";
  if (window.TSU_STATS) return;
  var en = function () { return !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"); };
  var tr = function (zh, e) { return en() ? e : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var BLUES = ["#5b8def", "#7fa6f2", "#a2bff6", "#c3d6f9", "#9aa7c7", "#6f7ea8"];
  var HOBBIT = 123000; // 《霍比特人》大约多少 token
  var cache = null, at = 0, wait = null;
  function load(force) {
    if (!force && cache && Date.now() - at < 60e3) return Promise.resolve(cache);
    if (wait) return wait;
    wait = fetch("/api/stats?tz=" + -new Date().getTimezoneOffset(), { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      wait = null;
      if (d && d.days) { cache = d; at = Date.now(); }
      return cache;
    }, function () { wait = null; return cache; });
    return wait;
  }
  // 数字：1.2k、3.4M、7.1B；整数加千分位
  var big = function (n) { n = +n || 0; var a = Math.abs(n); return a >= 1e9 ? +(n / 1e9).toFixed(1) + "B" : a >= 1e6 ? +(n / 1e6).toFixed(1) + "M" : a >= 1e3 ? +(n / 1e3).toFixed(1) + "k" : String(Math.round(n)); };
  var int = function (n) { return (Math.round(+n || 0)).toLocaleString(en() ? "en-US" : "zh-CN"); };
  var modelName = function (id) {
    var A = window.TSU_AGENTS, m = A && A.models ? (A.models() || []).find(function (x) { return x.id === id; }) : null;
    return m ? m.name : String(id || tr("未知", "Unknown")).replace(/^[a-z]+\//, "").replace(/[-_]/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  };
  var dayDate = function (d) { return new Date(d * 864e5); }; // 本地日期的第几天 → 那天（按 UTC 读年月日）
  var dayLabel = function (d) { var x = dayDate(d); return en() ? x.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : x.getUTCMonth() + 1 + "月" + x.getUTCDate() + "日"; };
  var hourLabel = function (h) { return en() ? (h % 12 || 12) + " " + (h < 12 ? "AM" : "PM") : (h < 6 ? "凌晨 " : h < 12 ? "上午 " : h < 13 ? "中午 " : h < 18 ? "下午 " : "晚上 ") + (h % 12 || 12) + " 点"; };

  // 按范围切出来：天 → { tokens, models{} }，合计
  function slice(d, range) {
    var from = range === "all" ? -Infinity : d.today - (+range) + 1, days = {}, models = {}, tot = { i: 0, o: 0, c: 0, n: 0 };
    d.days.forEach(function (r) {
      if (r.d < from) return;
      var t = (r.i || 0) + (r.o || 0) + (r.c || 0), day = days[r.d] || (days[r.d] = { t: 0, m: {} });
      day.t += t;
      day.m[r.m] = (day.m[r.m] || 0) + t;
      var m = models[r.m] || (models[r.m] = { i: 0, o: 0, c: 0, t: 0, n: 0 });
      m.i += r.i || 0; m.o += r.o || 0; m.c += r.c || 0; m.t += t; m.n += r.n || 0;
      tot.i += r.i || 0; tot.o += r.o || 0; tot.c += r.c || 0; tot.n += r.n || 0;
    });
    var cnt = function (list) { return (list || []).reduce(function (s, r) { return s + (r.d >= from ? r.n : 0); }, 0); };
    var peak = (d.hours || []).slice().sort(function (a, b) { return b.n - a.n; })[0];
    var order = Object.keys(models).sort(function (a, b) { return models[b].t - models[a].t; });
    return { from: from, days: days, models: models, order: order, tot: tot, tokens: tot.i + tot.o + tot.c, sessions: cnt(d.sessions), turns: cnt(d.turns), active: Object.keys(days).length, peak: peak ? peak.h : null };
  }

  function overview(d, s, width) {
    var tile = function (k, v, small) { return '<div class="us-tile"><div class="us-k">' + esc(k) + '</div><div class="us-v' + (small ? " sm" : "") + '">' + esc(v) + "</div></div>"; };
    var h = '<div class="us-tiles">' +
      tile(tr("会话", "Sessions"), int(s.sessions)) + tile(tr("消息", "Messages"), int(s.turns)) + tile(tr("总 token", "Total tokens"), big(s.tokens)) +
      tile(tr("活跃天数", "Active days"), int(s.active)) + tile(tr("高峰时段", "Peak hour"), s.peak == null ? "—" : hourLabel(s.peak)) +
      tile(tr("最常用模型", "Favorite model"), s.order[0] ? modelName(s.order[0]) : "—", true) + "</div>";
    // 热力图：一列一周（周日在上），最右一列是这周；放得下几列画几列
    var cell = 14, gap = 3.5, cols = Math.max(8, Math.min(53, Math.floor((width + gap) / (cell + gap)))), today = d.today;
    var dow = (dayDate(today).getUTCDay()), start = today - dow - (cols - 1) * 7;
    var all = slice(d, "all").days, vals = Object.keys(all).map(function (k) { return all[k].t; }).filter(Boolean).sort(function (a, b) { return a - b; });
    var q = function (p) { return vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 0; }, cuts = [q(0.25), q(0.5), q(0.75)];
    var lv = function (t) { return !t ? 0 : t <= cuts[0] ? 1 : t <= cuts[1] ? 2 : t <= cuts[2] ? 3 : 4; };
    h += '<div class="us-heat" style="--cols:' + cols + '">';
    for (var r = 0; r < 7; r++) for (var c = 0; c < cols; c++) {
      var dd = start + c * 7 + r, day = all[dd], out = dd > today || dd < s.from;
      h += '<i class="l' + (out ? "x" : lv(day && day.t)) + '" style="grid-row:' + (r + 1) + ";grid-column:" + (c + 1) + '"' + (dd <= today ? ' title="' + esc(dayLabel(dd) + (day ? " · " + big(day.t) + " tokens" : "")) + '"' : "") + "></i>";
    }
    h += "</div>";
    var x = s.tokens / HOBBIT;
    h += '<div class="us-fun">' + esc(!s.tokens ? tr("还没有用量。开个会话试试？", "No usage yet — start a session?") : x >= 1 ? tr("你用掉的 token 大约是《霍比特人》的 " + int(Math.round(x)) + " 倍。", "You've used ~" + int(Math.round(x)) + "× more tokens than The Hobbit.") : tr("你用掉的 token 相当于《霍比特人》的 " + Math.max(1, Math.round(x * 100)) + "%。", "You've used about " + Math.max(1, Math.round(x * 100)) + "% of The Hobbit in tokens.")) + "</div>";
    return h;
  }

  function models(d, s, width) {
    if (!s.order.length) return '<div class="us-empty">' + esc(tr("这段时间没有用量", "No usage in this period")) + "</div>";
    var color = {}; s.order.forEach(function (m, i) { color[m] = BLUES[i % BLUES.length]; });
    var keys = Object.keys(s.days).map(Number).sort(function (a, b) { return a - b; });
    // 天太多：按周并起来
    var bars = keys.map(function (k) { return { d: k, t: s.days[k].t, m: s.days[k].m }; });
    if (bars.length > 42) {
      var wk = {};
      bars.forEach(function (b) { var w = b.d - dayDate(b.d).getUTCDay(), x = wk[w] || (wk[w] = { d: w, t: 0, m: {} }); x.t += b.t; Object.keys(b.m).forEach(function (m) { x.m[m] = (x.m[m] || 0) + b.m[m]; }); });
      bars = Object.keys(wk).map(function (k) { return wk[k]; }).sort(function (a, b) { return a.d - b.d; });
    }
    var max = Math.max.apply(null, bars.map(function (b) { return b.t; }).concat([1]));
    var step = Math.pow(10, Math.floor(Math.log10(max))), nice = [1, 2, 2.5, 5, 10].map(function (f) { return f * step; }).find(function (v) { return v * 4 >= max; }) || step * 10;
    var top = nice * Math.ceil(max / nice), ticks = []; for (var v = 0; v <= top + 1e-9; v += nice) ticks.push(v);
    var W = Math.max(280, width), H = 200, L = 44, B = 22, T = 8, iw = W - L - 8, ih = H - B - T, bw = Math.max(3, Math.min(28, iw / bars.length * 0.62)), stepX = iw / bars.length;
    var y = function (t) { return T + ih - t / top * ih; };
    var svg = '<svg class="us-chart" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '">';
    ticks.forEach(function (t) { svg += '<text x="' + (L - 8) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + big(t) + "</text>"; });
    bars.forEach(function (b, i) {
      var x = L + stepX * i + (stepX - bw) / 2, acc = 0;
      s.order.forEach(function (m) {
        var t = b.m[m] || 0;
        if (!t) return;
        var y0 = y(acc), y1 = y(acc + t), hgt = Math.max(1, y0 - y1);
        svg += '<rect x="' + x.toFixed(1) + '" y="' + (y0 - hgt).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hgt.toFixed(1) + '" rx="1.5" fill="' + color[m] + '"><title>' + esc(dayLabel(b.d) + " · " + modelName(m) + " · " + big(t)) + "</title></rect>";
        acc += t;
      });
    });
    var every = Math.max(1, Math.ceil(bars.length / Math.max(2, Math.floor(iw / 64))));
    bars.forEach(function (b, i) { if (i % every === 0 || i === bars.length - 1 && bars.length > 1 && (bars.length - 1) % every > every / 2) svg += '<text x="' + (L + stepX * i + stepX / 2).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle">' + esc(dayLabel(b.d)) + "</text>"; });
    svg += "</svg>";
    var legend = '<div class="us-legend">' + s.order.map(function (m) {
      var x = s.models[m], pc = s.tokens ? x.t / s.tokens * 100 : 0;
      return '<div class="us-lg"><i style="background:' + color[m] + '"></i><span class="us-lgn">' + esc(modelName(m)) + '</span><span class="us-lgd">' + big(x.i + x.c) + " in · " + big(x.o) + ' out</span><b>' + (pc >= 10 ? pc.toFixed(1) : pc.toFixed(1)) + "%</b></div>";
    }).join("") + "</div>";
    return svg + legend;
  }

  function paint(el) {
    var st = el._us, body = el.querySelector(".us-body");
    if (!body) return;
    if (!st.data) { body.innerHTML = '<div class="us-empty">' + esc(st.failed ? tr("统计暂时不可用", "Stats are unavailable right now") : tr("正在读取用量…", "Loading usage…")) + "</div>"; return; }
    var s = slice(st.data, st.range), w = body.clientWidth || 520;
    body.innerHTML = st.tab === "models" ? models(st.data, s, w) : overview(st.data, s, w);
  }
  function mount(el) {
    if (!el) return;
    if (!el._us) {
      el._us = { tab: "overview", range: "all", data: cache };
      el.classList.add("us-card");
      el.innerHTML = '<div class="us-head"><div class="us-tabs st-seg" role="tablist" data-seg-key="us:tab"><button type="button" class="on" data-tab="overview">' + esc(tr("总览", "Overview")) +
        '</button><button type="button" data-tab="models">' + esc(tr("模型", "Models")) + '</button></div><div class="us-range st-seg" role="radiogroup" data-seg-key="us:range"><button type="button" class="on" data-r="all">' +
        esc(tr("全部", "All")) + '</button><button type="button" data-r="30">' + esc(tr("30 天", "30d")) + '</button><button type="button" data-r="7">' + esc(tr("7 天", "7d")) + '</button></div></div><div class="us-body"></div>';
      el.addEventListener("click", function (e) {
        var b = e.target.closest("[data-tab], [data-r]");
        if (!b) return;
        var st = el._us;
        if (b.dataset.tab) st.tab = b.dataset.tab; else st.range = b.dataset.r;
        b.parentNode.querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); });
        paint(el);
      });
      if (window.ResizeObserver) { var lw = 0; new ResizeObserver(function () { var w = el.clientWidth; if (Math.abs(w - lw) > 8) { lw = w; paint(el); } }).observe(el); }
    }
    paint(el);
    load().then(function (d) { el._us.data = d; el._us.failed = !d; paint(el); });
  }
  window.TSU_STATS = { mount: mount, load: load };
})();
