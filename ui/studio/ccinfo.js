// ccinfo.js —— Claude Code 会话的详情：会话列表、标签页上右键「详情」，辅助侧栏的「详情」那一块。
//   会话：名字、ID、目录、分支、创建、最近活动、状态、权限模式、Claude Code 版本
//   工作：工作时长（它自己记的每一问用了多久加起来）、提问几次、回复几条、压缩几次
//   Token：输入、输出（其中思考）、缓存读取、缓存写入；用过不止一个模型的按模型分
//   子 Agent：几个、哪几种、Token；工具：各调用几次（前几名）、网页搜索 / 读取；记录文件：路径、大小
//   统计：整份会话记录（连子 agent 的）用 perl 扫一遍（几百 MB 两秒左右，只读，不改任何东西）；按文件大小记着，没变就不重扫
(function () {
  "use strict";
  if (window.TSU_CCINFO) return;
  var I18N = window.TSU_I18N;
  var en = function () { return !!(I18N && I18N.lang && I18N.lang() === "en"); };
  var t = function (zh, e) { return en() ? e : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var shq = function (p) { return "'" + String(p).replace(/'/g, "'\\''") + "'"; };
  var LOC = function () { return window.TSU_LOCAL; };
  var PL = [
    "use strict; use warnings; use JSON::PP;",
    "# 一段 Claude Code 会话的统计（只读）：perl ccstats.pl <会话记录.jsonl> [subagents 目录]",
    "#   主会话：第一条、最后一条的时间，每一问用了多久（turn_duration）加起来，问了几次（promptId），压缩了几次，",
    "#     每条回复的 token（同一条回复分成几行写：按消息 id 只算一次），按模型分，工具各调用几次，网页搜索 / 读取几次，目录、分支、版本、权限模式、标题",
    "#   子 agent：几个（按类型）、token",
    "sub scan {",
    "  my ($path, $agg, $main) = @_;",
    "  open(my $fh, '<', $path) or return;",
    "  my %msg;",
    "  while (my $l = <$fh>) {",
    "    next if length($l) < 20;",
    "    if ($main) {",
    "      if ($l =~ /\"timestamp\":\"([^\"]+)\"/) { $agg->{first} //= $1; $agg->{last} = $1; }",
    "      if ($l =~ /\"subtype\":\"turn_duration\",\"durationMs\":(\\d+)/) { $agg->{workMs} += $1; $agg->{turns}++; }",
    "      $agg->{compactions}++ if $l =~ /\"subtype\":\"compact_boundary\"/;",
    "      $agg->{prompts}{$1} = 1 if $l =~ /\"promptId\":\"([^\"]+)\",\"type\":\"user\"/;",
    "      if ($l =~ /^\\{\"type\":\"custom-title\",\"customTitle\":\"((?:[^\"\\\\]|\\\\.)*)\"/) { $agg->{title} = $1; }",
    "      if ($l =~ /^\\{\"type\":\"ai-title\",\"aiTitle\":\"((?:[^\"\\\\]|\\\\.)*)\"/) { $agg->{aiTitle} = $1; }",
    "      if ($l =~ /^\\{\"type\":\"permission-mode\",\"permissionMode\":\"([^\"]+)\"/) { $agg->{mode} = $1; }",
    "      $agg->{cwd} = $1 if $l =~ /\"cwd\":\"((?:[^\"\\\\]|\\\\.)*)\"/;",
    "      $agg->{branch} = $1 if $l =~ /\"gitBranch\":\"((?:[^\"\\\\]|\\\\.)*)\"/;",
    "      $agg->{version} = $1 if $l =~ /\"version\":\"([\\d.]+)\"/;",
    "      $agg->{kind} = $1 if $l =~ /\"sessionKind\":\"(\\w+)\"/;",
    "    }",
    "    if ($l =~ /\"message\":\\{\"model\":\"([^\"]+)\",\"id\":\"(msg_[^\"]+)\"/) {",
    "      my ($model, $id) = ($1, $2);",
    "      my $m = $msg{$id} //= { model => $model, in => 0, out => 0, cr => 0, cw => 0, think => 0, ws => 0, wf => 0, tools => {} };",
    "      if ($l =~ /\"usage\":\\{\"input_tokens\":(\\d+),\"cache_creation_input_tokens\":(\\d+),\"cache_read_input_tokens\":(\\d+),\"output_tokens\":(\\d+)/) {",
    "        $m->{in} = $1 if $1 > $m->{in}; $m->{cw} = $2 if $2 > $m->{cw}; $m->{cr} = $3 if $3 > $m->{cr}; $m->{out} = $4 if $4 > $m->{out};",
    "      }",
    "      $m->{think} = $1 if $l =~ /\"output_tokens_details\":\\{\"thinking_tokens\":(\\d+)/ && $1 > $m->{think};",
    "      if ($l =~ /\"web_search_requests\":(\\d+),\"web_fetch_requests\":(\\d+)/) { $m->{ws} = $1 if $1 > $m->{ws}; $m->{wf} = $2 if $2 > $m->{wf}; }",
    "      while ($l =~ /\\{\"type\":\"tool_use\",\"id\":\"(toolu_[^\"]+)\",\"name\":\"([^\"]+)\"/g) { $m->{tools}{$1} = $2; }",
    "    }",
    "  }",
    "  close($fh);",
    "  for my $m (values %msg) {",
    "    next if $m->{model} eq '<synthetic>';",
    "    $agg->{msgs}++;",
    "    my $b = $agg->{byModel}{$m->{model}} //= { in => 0, out => 0, cr => 0, cw => 0, think => 0, n => 0 };",
    "    $b->{n}++;",
    "    for my $k (qw(in out cr cw think)) { $agg->{tok}{$k} += $m->{$k}; $b->{$k} += $m->{$k}; }",
    "    $agg->{webSearch} += $m->{ws}; $agg->{webFetch} += $m->{wf};",
    "    $agg->{tools}{$_}++ for values %{ $m->{tools} };",
    "  }",
    "}",
    "my ($path, $subdir) = @ARGV;",
    "my %main = (tok => { in => 0, out => 0, cr => 0, cw => 0, think => 0 }, msgs => 0, workMs => 0, turns => 0, compactions => 0, webSearch => 0, webFetch => 0);",
    "scan($path, \\%main, 1);",
    "$main{prompts} = scalar keys %{ $main{prompts} || {} };",
    "$main{size} = -s $path;",
    "my %sub = (tok => { in => 0, out => 0, cr => 0, cw => 0, think => 0 }, msgs => 0, count => 0, types => {}, webSearch => 0, webFetch => 0);",
    "if ($subdir && -d $subdir) {",
    "  for my $f (glob(\"$subdir/agent-*.jsonl\")) {",
    "    $sub{count}++;",
    "    my $meta = $f; $meta =~ s/\\.jsonl$/.meta.json/;",
    "    my $type = 'agent';",
    "    if (open(my $mh, '<', $meta)) { local $/; my $mj = <$mh>; close $mh; $type = $1 if $mj =~ /\"agentType\":\"([^\"]+)\"/; }",
    "    $sub{types}{$type}++;",
    "    scan($f, \\%sub, 0);",
    "  }",
    "}",
    "print JSON::PP->new->canonical->encode({ main => \\%main, sub => \\%sub }), \"\\n\";",
  ].join("\n") + "\n";

  // ---- 统计 ----
  var CK = "tsu-ccinfo", cache = (function () { try { return JSON.parse(localStorage.getItem(CK) || "{}") || {}; } catch (e) { return {}; } })(), busy = {}, plReady = null;
  var keep = function () { try { var ks = Object.keys(cache); if (ks.length > 60) ks.sort(function (a, b) { return cache[a].data.at - cache[b].data.at; }).slice(0, ks.length - 60).forEach(function (k) { delete cache[k]; }); localStorage.setItem(CK, JSON.stringify(cache)); } catch (e) { /* 满了 */ } };
  var plPath = function () { return LOC().info().home + "/Library/Application Support/Vibing Studio/run/ccstats.pl"; };
  function ensurePl() { if (!plReady) plReady = LOC().write(plPath(), PL).then(function () { return true; }, function (e) { plReady = null; throw e; }); return plReady; }
  function stats(sid, force) {
    var L = LOC();
    if (!L || !L.exec || !L.ccFind || !L.write) return Promise.reject(new Error(t("这台设备上读不到会话记录", "Session records aren't available on this device")));
    return L.ccFind(sid).then(function (x) {
      if (!x || !x.path) throw new Error(t("找不到这个会话的记录", "The transcript for this session wasn't found"));
      var c = cache[sid];
      if (!force && c && c.size === x.size && c.path === x.path) return c.data;
      if (busy[sid]) return busy[sid];
      var sub = x.path.replace(/\.jsonl$/, "") + "/subagents";
      busy[sid] = ensurePl().then(function () { return L.exec({ cmd: "/usr/bin/perl " + shq(plPath()) + " " + shq(x.path) + " " + shq(sub) }); }).then(function (r) {
        var out = String((r && (r.out || r.stdout)) || "").trim().split("\n").pop();
        var j = JSON.parse(out);
        j.file = { path: x.path, size: x.size }; j.at = Date.now();
        cache[sid] = { size: x.size, path: x.path, data: j }; keep();
        delete busy[sid];
        return j;
      }, function (e) { delete busy[sid]; throw e; });
      return busy[sid];
    });
  }
  var cached = function (sid) { return cache[sid] ? cache[sid].data : null; };

  // ---- 写成给人看的 ----
  var num = function (n) { return Number(n || 0).toLocaleString(en() ? "en-US" : "zh-CN"); };
  var big = function (n) { n = Number(n || 0); return n >= 1e9 ? (n / 1e9).toFixed(n >= 1e11 ? 0 : n >= 1e10 ? 1 : 2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e8 ? 0 : n >= 1e7 ? 1 : 2) + "M" : n >= 1e4 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + "K" : num(n); };
  var dur = function (ms) { var m = Math.round((ms || 0) / 60000), h = Math.floor(m / 60); m %= 60; return h ? t(h + " 小时 " + m + " 分", h + " h " + m + " min") : t(m + " 分钟", m + " min"); };
  var size = function (b) { b = Number(b || 0); return b >= 1 << 30 ? (b / (1 << 30)).toFixed(2) + " GB" : b >= 1 << 20 ? (b / (1 << 20)).toFixed(1) + " MB" : b >= 1024 ? Math.round(b / 1024) + " KB" : b + " B"; };
  var when = function (iso) {
    if (!iso) return "";
    var d = new Date(iso), now = new Date(), hm = d.toLocaleTimeString(en() ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit", hour12: en() });
    if (d.toDateString() === now.toDateString()) return t("今天 ", "Today ") + hm;
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return t("昨天 ", "Yesterday ") + hm;
    return en() ? d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) + ", " + hm : d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 " + hm;
  };
  var home = function () { try { return LOC().info().home || ""; } catch (e) { return ""; } };
  var tilde = function (p) { var h = home(); return h && String(p || "").indexOf(h) === 0 ? "~" + String(p).slice(h.length) : String(p || ""); };
  var MODES = { default: t("默认", "Default"), acceptEdits: t("自动接受编辑", "Accept edits"), plan: t("计划模式", "Plan mode"), bypassPermissions: t("跳过权限确认", "Bypass permissions") };
  // 现在在哪跑：后台服务里的 job / 某个终端里 / 没在跑（同会话列表）
  function liveOf(sid) {
    var rt = null; try { rt = window.TSU_CLAUDE && TSU_CLAUDE.ensure(sid); } catch (e) { rt = null; }
    var lv = rt && rt.info && rt.info.live;
    if (!lv) return t("没在运行", "Not running");
    if (lv.kind === "bg") return t("在后台运行", "Running in the background") + (rt.info.job ? " · job " + rt.info.job : "");
    return t("在终端里运行", "Running in a terminal") + (lv.pid ? t("（进程 " + lv.pid + "）", " (process " + lv.pid + ")") : "");
  }
  var titleOf = function (sid, s) { var rt = null; try { rt = window.TSU_CLAUDE && TSU_CLAUDE.ensure(sid); } catch (e) { rt = null; } return (s && s.main && s.main.title) || (rt && rt.session && rt.session().title) || (rt && rt.info && rt.info.title) || (s && s.main && s.main.aiTitle) || String(sid).slice(0, 8); };
  // 一项项（[名字, 值, 鼠标指上去看的全数]）；没有的不写
  function sections(sid, s) {
    var m = (s && s.main) || {}, b = (s && s.sub) || {}, tk = m.tok || {}, out = [];
    var row = function (rows, k, v, tip, html) { if (v !== undefined && v !== null && v !== "") rows.push([k, v, tip || "", html || ""]); };
    var a = [];
    row(a, "ID", sid, "", '<code>' + esc(sid) + '</code><button type="button" class="cci-copy" data-copy="' + esc(sid) + '" title="' + esc(t("拷贝", "Copy")) + '">' + COPY + "</button>");
    row(a, t("目录", "Folder"), m.cwd ? tilde(m.cwd) : "", m.cwd || "");
    row(a, t("分支", "Branch"), m.branch && m.branch !== "HEAD" ? m.branch : m.branch === "HEAD" ? t("HEAD（没在分支上）", "HEAD (detached)") : "");
    row(a, t("创建", "Created"), when(m.first));
    row(a, t("最近活动", "Last activity"), when(m.last));
    row(a, t("状态", "Status"), liveOf(sid));
    row(a, t("权限模式", "Permission mode"), m.mode ? MODES[m.mode] || m.mode : "");
    row(a, "Claude Code", m.version || "");
    out.push([t("会话", "Session"), a]);
    if (!s) return out;
    var w = [];
    row(w, t("工作时长", "Working time"), m.workMs ? dur(m.workMs) : "", m.turns ? t(m.turns + " 问记了用时", m.turns + " timed turns") : "");
    row(w, t("提问", "Prompts"), m.prompts ? t(num(m.prompts) + " 次", num(m.prompts)) : "");
    row(w, t("回复", "Responses"), m.msgs ? t(num(m.msgs) + " 条", num(m.msgs)) : "");
    row(w, t("压缩", "Compactions"), m.compactions ? t(m.compactions + " 次", String(m.compactions)) : "");
    if (w.length) out.push([t("工作", "Work"), w]);
    var k = [];
    row(k, t("输入", "Input"), big(tk["in"]), num(tk["in"]));
    row(k, t("输出", "Output"), big(tk.out) + (tk.think ? t("（其中思考 " + big(tk.think) + "）", " (" + big(tk.think) + " thinking)") : ""), num(tk.out));
    row(k, t("缓存读取", "Cache read"), big(tk.cr), num(tk.cr));
    row(k, t("缓存写入", "Cache write"), big(tk.cw), num(tk.cw));
    var models = Object.keys(m.byModel || {}).sort(function (x, y) { return m.byModel[y].n - m.byModel[x].n; });
    models.forEach(function (id) { var bm = m.byModel[id]; row(k, models.length > 1 ? id : t("模型", "Model"), models.length > 1 ? t(num(bm.n) + " 条 · 输出 " + big(bm.out), num(bm.n) + " responses · " + big(bm.out) + " output") : id); });
    out.push(["Token", k]);
    if (b.count) {
      var sb = [], types = Object.keys(b.types || {}).sort(function (x, y) { return b.types[y] - b.types[x]; });
      row(sb, t("数量", "Count"), num(b.count) + (types.length ? " · " + types.map(function (x) { return x + " " + b.types[x]; }).join(" · ") : ""));
      var bt = b.tok || {};
      row(sb, "Token", t("输入 " + big(bt["in"]) + " · 输出 " + big(bt.out) + " · 缓存读取 " + big(bt.cr) + " · 缓存写入 " + big(bt.cw), "In " + big(bt["in"]) + " · Out " + big(bt.out) + " · Cache read " + big(bt.cr) + " · Cache write " + big(bt.cw)));
      out.push([t("子 Agent", "Subagents"), sb]);
    }
    var tools = Object.keys(m.tools || {}).sort(function (x, y) { return m.tools[y] - m.tools[x]; });
    if (tools.length || m.webSearch || m.webFetch) {
      var tl = [];
      row(tl, t("调用", "Calls"), tools.slice(0, 8).map(function (x) { return x.replace(/^mcp__([^_]+(?:_[^_]+)*)__/, "$1 · ") + " " + num(m.tools[x]); }).join(" · ") + (tools.length > 8 ? t(" · 另 " + (tools.length - 8) + " 种", " · " + (tools.length - 8) + " more") : ""));
      if (m.webSearch || m.webFetch) row(tl, t("网页", "Web"), t("搜索 " + num(m.webSearch) + " 次 · 读取 " + num(m.webFetch) + " 次", num(m.webSearch) + " searches · " + num(m.webFetch) + " fetches"));
      out.push([t("工具", "Tools"), tl]);
    }
    var f = [];
    var fp = s.file && s.file.path;
    row(f, t("记录", "Transcript"), fp ? tilde(fp) : "", fp || "", fp ? esc(tilde(fp)) + ' <span class="cci-dim">· ' + esc(size(s.file.size)) + '</span><button type="button" class="cci-link" data-reveal="' + esc(fp) + '">' + esc(t("在访达中显示", "Show in Finder")) + "</button>" : "");
    out.push([t("文件", "File"), f]);
    return out;
  }
  var COPY = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.2A1.3 1.3 0 0 0 9.2 2H3.3A1.3 1.3 0 0 0 2 3.3v5.9a1.3 1.3 0 0 0 1.3 1.3h.2"/></svg>';
  var DONE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 8.4l3 3 6.6-6.6"/></svg>';
  function rowsHtml(rows) { return '<dl class="cci-rows">' + rows.map(function (r) { return "<dt>" + esc(r[0]) + '</dt><dd' + (r[2] ? ' title="' + esc(r[2]) + '"' : "") + ">" + (r[3] || esc(r[1])) + "</dd>"; }).join("") + "</dl>"; }

  // ---- 详情面板（浮在窗口正中；Esc、点外面、× 关） ----
  var panel = null;
  function close() { if (panel) { panel.remove(); panel = null; document.removeEventListener("keydown", onKey, true); } }
  function onKey(e) { if (e.key === "Escape" && panel) { e.preventDefault(); e.stopPropagation(); close(); } }
  function paint(sid, s, err) {
    if (!panel) return;
    var secs = sections(sid, s);
    panel.querySelector(".cci-body").innerHTML = secs.map(function (x) { return x[1].length ? '<section><h3>' + esc(x[0]) + "</h3>" + rowsHtml(x[1]) + "</section>" : ""; }).join("") +
      (s ? "" : '<p class="cci-wait">' + esc(err ? String(err.message || err) : t("正在统计…", "Counting…")) + "</p>");
    panel.querySelector(".cci-title").textContent = titleOf(sid, s);
  }
  function open(sid) {
    close();
    panel = document.createElement("div");
    panel.className = "cci-back";
    panel.innerHTML = '<div class="cci" role="dialog" aria-label="' + esc(t("会话详情", "Session Details")) + '"><div class="cci-head"><div><div class="cci-title"></div><div class="cci-sub">' + esc(t("Claude Code 会话", "Claude Code session")) + " · " + esc(String(sid).slice(0, 8)) + '</div></div><button type="button" class="cci-x" aria-label="' + esc(t("关闭", "Close")) + '"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div><div class="cci-body"></div></div>';
    document.body.appendChild(panel);
    document.addEventListener("keydown", onKey, true);
    panel.addEventListener("mousedown", function (e) { if (e.target === panel) close(); });
    panel.addEventListener("click", function (e) {
      if (e.target.closest(".cci-x")) return close();
      var c = e.target.closest("[data-copy]");
      if (c) { var s0 = c.dataset.copy; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s0).catch(function () {}); else if (window.nadosNative) nadosNative.call("clipboard.write", { text: s0 }).catch(function () {}); c.innerHTML = DONE; setTimeout(function () { c.innerHTML = COPY; }, 1200); return; }
      var rv = e.target.closest("[data-reveal]");
      if (rv && LOC() && LOC().exec) LOC().exec({ cmd: "open -R " + shq(rv.dataset.reveal) }).catch(function () {});
    });
    var c0 = cached(sid);
    paint(sid, c0);
    stats(sid, false).then(function (s) { if (panel) paint(sid, s); }, function (e) { if (panel) paint(sid, c0, e); });
  }
  // 辅助侧栏「详情」那一块：几项要紧的 + 「全部」；还没统计过的先统计（好了 done() 重画）
  function summaryHtml(sid, done) {
    var s = cached(sid);
    if (!s || (cache[sid] && Date.now() - s.at > 60000)) stats(sid, false).then(function (x) { if (x !== s && done) done(); }, function () {});
    if (!s) return '<div class="cci-mini"><p class="cci-dim">' + esc(t("正在统计…", "Counting…")) + "</p></div>";
    var m = s.main || {}, tk = m.tok || {}, b = s.sub || {}, rows = [];
    rows.push([t("创建", "Created"), when(m.first)]);
    if (m.workMs) rows.push([t("工作时长", "Working time"), dur(m.workMs)]);
    rows.push([t("输出", "Output"), big(tk.out), num(tk.out)]);
    rows.push([t("缓存读取", "Cache read"), big(tk.cr), num(tk.cr)]);
    if (b.count) rows.push([t("子 Agent", "Subagents"), num(b.count)]);
    return '<div class="cci-mini">' + rowsHtml(rows) + '<button type="button" class="cci-link" data-st="cc-info" data-sid="' + esc(sid) + '">' + esc(t("全部详情…", "All details…")) + "</button></div>";
  }
  window.TSU_CCINFO = { open: open, stats: stats, cached: cached, summaryHtml: summaryHtml, close: close };
})();
