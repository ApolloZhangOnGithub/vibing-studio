// codex.js —— 连接器：这台 Mac 上的 Codex 会话（~/.codex/sessions/年/月/日/rollout-…-<会话>.jsonl，已归档的在 ~/.codex/archived_sessions）。
//   看：读它的记录转成 Paimon 的对话（同 claude.js 的 Runtime），任何外壳都能显示（Claude Code 风格的 TUI、Claude App 风格的 GUI……）；
//       只读最后一段（大文件也快），之后跟着读新追加的——它在 Codex 里、在别的终端里干什么，这里都看得见
//   说：没在别处开着的——codex exec resume <会话> --json "…"（它照常把对话写回记录，这边跟着读出来）；Esc 打断（停掉那个进程）；
//       正开在 Codex 里的（app-server 守护进程载入着的）——codex queue --thread <会话> --message "…"（官方的「排进去」）
//   id：cx:<会话 id>（agents.js 的外部运行时，前缀 cx）。列表：TSU_CODEX.list()（侧栏、Agent Finder 用），变了发 tsu-cx 事件
(function () {
  "use strict";
  var LOC = window.TSU_LOCAL, A = window.TSU_AGENTS, CON = window.TSU_CONNECTORS;
  if (!LOC || !A || !A.registerExternal) { window.TSU_CODEX = null; return; }
  var TAIL = 4 << 20;
  var home = function () { return (LOC.info() || {}).home || ""; };
  // 附的图（粘贴、拖进来的截屏）：存成文件（~/Library/Application Support/Vibing Studio/shots/，同 claude.js），发话时 --image 带上
  async function saveShots(imgs) {
    if (!LOC.write && imgs.some(function (im) { return !im.path; })) throw new Error("无法写入本地图片");
    var dir = home() + "/Library/Application Support/Vibing Studio/shots", stamp = crypto.randomUUID();
    return Promise.all(imgs.map(function (im, i) {
      if (im.path && !im.data) return im.path;
      var ext = /png/.test(im.media_type) ? "png" : /gif/.test(im.media_type) ? "gif" : /webp/.test(im.media_type) ? "webp" : "jpg", p = dir + "/shot-" + stamp + "-cx" + (i + 1) + "." + ext;
      var bin = atob(im.data), u8 = new Uint8Array(bin.length);
      for (var k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
      return LOC.write(p, u8).then(function () { return p; });
    }));
  }
  var on = function () { return !!(CON && CON.on("codex")); };
  var ts = function (s) { var t = Date.parse(s || ""); return isNaN(t) ? Date.now() : t; };
  var dec = function (buf) { return new TextDecoder().decode(new Uint8Array(buf)); };
  var segmentOwners = new Map();
  var uuidPattern = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
  var rolloutName = new RegExp("-(" + uuidPattern + ")(?:_(" + uuidPattern + "))?\\.jsonl(?:\\.zst)?$", "i");
  function idOf(path) {
    var match = rolloutName.exec(path || "");
    if (!match) return "";
    var id = match[1].toLowerCase();
    if (match[2]) segmentOwners.set(match[2].toLowerCase(), id);
    return id;
  }
  function threadId(id) { return segmentOwners.get(id) || id; }
  // 界面上的字（提示、记下的说明、标题）：用 i18n.js 的词典 / 规则翻成现在的语言（中文原样）
  var tr = function (s) { return window.TSU_I18N && TSU_I18N.t ? TSU_I18N.t(s) : s; };
  var clip = function (s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  // 用户消息里 Codex 自己塞进来的（环境、说明、提醒……）：都是 <标签> 开头
  var synthetic = function (t) { return /^\s*<[a-z_][\w-]*[\s>]/i.test(t || "") || /^\s*# AGENTS\.md instructions(?: for |\s*\n+<INSTRUCTIONS>)/.test(t || ""); }; // 还有它塞进来的 AGENTS.md 说明
  var textOf = function (content) { return (Array.isArray(content) ? content : []).filter(function (b) { return b && (b.type === "input_text" || b.type === "output_text" || b.type === "text"); }).map(function (b) { return b.text || ""; }).join("\n"); };
  function assistantDisplayText(text) {
    if (typeof text !== "string" || !text.trimStart().startsWith("::browser-complete{")) return text;
    var marker = /^::browser-complete\{title=("(?:[^"\\]|\\.)*")\}$/.exec(text.trim());
    if (!marker) return text;
    try { return JSON.parse(marker[1]); } catch (_) { return text; }
  }
  // 你说的一句：带图的，Codex 把图包成 <image name=[Image #1] path="…"> 图 </image> 放在话前面——包装去掉（不然整句当成它塞进来的、不显示），图单独取出来（同 claude.js 的 { media_type, data }）
  var userOf = function (content) {
    var txt = [], imgs = [];
    (Array.isArray(content) ? content : []).forEach(function (b) {
      if (!b) return;
      if (b.type === "input_image") { var m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(String(b.image_url || "")); if (m) imgs.push({ media_type: m[1], data: m[2] }); return; }
      if (b.type !== "input_text" && b.type !== "text") return;
      var t = String(b.text || "");
      if (/^\s*<image\b[^>]*>\s*$/i.test(t) || /^\s*<\/image>\s*$/i.test(t)) return;
      txt.push(t);
    });
    return { text: txt.join("\n"), images: imgs };
  };
  var shq = function (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };
  // 问本机共享的 Codex app-server 守护进程（Codex app、终端里的 codex 都连着它）：官方协议（codex app-server generate-json-schema），
  //   控制 socket（~/.codex/app-server-control/app-server-control.sock）上是 WebSocket——握手、initialize、再发这一个请求，打出它的回答（一行 JSON）
  var CXRPC_PL = 'use IO::Socket::UNIX; my ($sp, $m, $pa) = @ARGV; my $s = IO::Socket::UNIX->new(Peer => $sp) or do { print qq({"error":"noconn"}\\n); exit 0 }; $SIG{ALRM} = sub { print qq({"error":"timeout"}\\n); exit 0 }; alarm 8;' +
    ' print $s "GET / HTTP/1.1\\r\\nHost: localhost\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n"; $s->flush;' +
    ' my $h = q(); while ($h !~ /\\r\\n\\r\\n/) { sysread($s, my $c, 1) or exit 0; $h .= $c } $h =~ / 101 / or do { print qq({"error":"nows"}\\n); exit 0 };' +
    ' sub sw { my $d = shift; my $l = length $d; my $f = chr(129) . ($l < 126 ? chr(128 | $l) : $l < 65536 ? chr(254) . pack(q(n), $l) : chr(255) . pack(q(Q>), $l)); my @k = map { int rand 256 } 1..4; $f .= pack(q(C4), @k); my $i = 0; $f .= join q(), map { chr(ord($_) ^ $k[$i++ % 4]) } split //, $d; print $s $f; $s->flush }' +
    ' sub rd { my $n = shift; my $b = q(); while (length($b) < $n) { sysread($s, my $c, $n - length $b) or exit 0; $b .= $c } $b }' +
    ' sub rw { my ($a, $b) = unpack(q(C2), rd(2)); my $l = $b & 127; $l = unpack(q(n), rd(2)) if $l == 126; $l = unpack(q(Q>), rd(8)) if $l == 127; return ($a & 15, $l ? rd($l) : q()) }' +
    ' sw(q({"id":1,"method":"initialize","params":{"clientInfo":{"name":"vibing-studio","version":"1"},"capabilities":{"experimentalApi":true}}}));' +
    ' while (1) { my ($o, $p) = rw(); next unless $o == 1; if ($p =~ /"id":1[,}]/) { sw(q({"method":"initialized"})); sw(qq({"id":2,"method":"$m","params":$pa})); } elsif ($p =~ /"id":2[,}]/) { print $p, "\\n"; exit 0 } }';
  // → { result } / { error }；连不上（守护进程没在跑）→ { error: "noconn" }
  // Codex 的模型目录（model/list）：十分钟问一次；名字照它的 displayName（gpt-6-astra → GPT-6 Astra），没读到就按 id 拼一个像样的
  var CXCAT = {at: 0, list: [], pending: null};
  function cxCatalog() {
    if (!LOC || !LOC.exec || Date.now() - CXCAT.at < 600000) return Promise.resolve();
    if (!CXCAT.pending) CXCAT.pending = cxRpc("model/list", {includeHidden: false}).then(function (reply) {
      var models = reply.result?.data;
      if (!models?.length) return;
      CXCAT.list = models.filter(m => !m.hidden).map(m => ({
        id: m.model || m.id, name: m.displayName || cxName(m.model || m.id),
        desc: m.description || "", def: !!m.isDefault, defaultEffort: m.defaultReasoningEffort,
        efforts: (m.supportedReasoningEfforts || []).map(level => level.reasoningEffort)
      }));
      CXCAT.at = Date.now();
    }).finally(function () { CXCAT.pending = null; });
    return CXCAT.pending;
  }
  function cxProfile(id) {
    var model = id || CXDEF.model;
    return model ? CXCAT.list.find(m => m.id === model) : CXCAT.list.find(m => m.def);
  }
  function cxLevels(id) { return cxProfile(id)?.efforts.slice() || []; }
  function cxName(id) {
    var c = CXCAT.list && CXCAT.list.filter(function (m) { return m.id === id; })[0];
    if (c) return c.name;
    return String(id || "").replace(/^gpt-/i, "GPT-").replace(/-([a-z])([a-z]*)$/, function (m, a, b) { return " " + a.toUpperCase() + b; });
  }
  var daemonStart;
  async function sendRpc(request) {
    var deadline = Date.now() + 180000, starts = 0;
    for (var attempt = 0; ; attempt++) {
      var reply = await request();
      // Only retry explicit rejections, never an ambiguous timeout after submission.
      if (Date.now() >= deadline) return reply;
      if (/server is draining/i.test(reply?.error?.message || "")) {
        await new Promise(resolve => setTimeout(resolve, Math.min(5000, 500 * 2 ** attempt)));
        continue;
      }
      if (reply.error !== "noconn" || ++starts > 4) return reply;
      if (!daemonStart) daemonStart = LOC.exec({cmd: "codex app-server daemon start", timeout: 20000})
        .finally(function () { daemonStart = null; });
      var start = await daemonStart;
      if (start.code) throw new Error("无法启动 Codex 服务：" + (start.err || start.out || "启动失败").trim().slice(-240));
    }
  }
  function cxRpc(method, params) {
    return LOC.exec({ cmd: "/usr/bin/perl -e '" + CXRPC_PL + "' \"$HOME/.codex/app-server-control/app-server-control.sock\" " + shq(method) + " " + shq(JSON.stringify(params || {})) }).then(function (r) {
      var m = /\{[^\n]*\}/.exec(String(r && r.out || "")); if (!m) return { error: "noreply" };
      try { return JSON.parse(m[0]); } catch (e) { return { error: "badjson" }; }
    }, function (e) { return { error: String(e && e.message || e) }; });
  }
  // Limits belong to the signed-in account. Replaying a thread must never change them.
  var accountQuota = null, quotaRequest = null, quotaReadAt = 0;
  function readAccountQuota() {
    if (quotaRequest) return quotaRequest;
    if (Date.now() - quotaReadAt < 60000) return Promise.resolve(accountQuota);
    quotaReadAt = Date.now();
    quotaRequest = cxRpc("account/rateLimits/read", {}).then(function (reply) {
      if (!reply.result) {
        if (accountQuota && Date.now() - accountQuota.at > 120000) accountQuota = null;
        return accountQuota;
      }
      var limits = reply.result.rateLimitsByLimitId?.codex || reply.result.rateLimits;
      if (limits?.limitId && limits.limitId !== "codex") limits = null;
      function windowOf(w) {
        if (!w || !Number.isFinite(w.usedPercent) || !(w.windowDurationMins > 0)) return null;
        return { used_percent: w.usedPercent, window_minutes: w.windowDurationMins, resets_at: w.resetsAt };
      }
      var rl = limits && { primary: windowOf(limits.primary), secondary: windowOf(limits.secondary),
        plan_type: limits.planType, credits: limits.credits && { has_credits: limits.credits.hasCredits, unlimited: limits.credits.unlimited, balance: limits.credits.balance } };
      accountQuota = {rl: rl, at: Date.now()};
      return accountQuota;
    }).finally(function () {
      quotaRequest = null;
      Object.values(rts).forEach(rt => rt.fire("status"));
    });
    return quotaRequest;
  }
  function currentLimits() {
    var rl = accountQuota?.rl;
    if (!rl) return null;
    var windows = [rl.primary, rl.secondary].filter(w => w && (!w.resets_at || w.resets_at * 1000 > Date.now()));
    var used = minutes => windows.find(w => w.window_minutes === minutes)?.used_percent ?? null;
    return {five: used(300), week: used(10080), at: accountQuota.at, buckets: windows.map(w => {
      var minutes = w.window_minutes;
      return {name: minutes === 10080 ? "weekly" : minutes % 60 ? minutes + "m" : minutes / 60 + "h",
        remaining: Math.min(1, Math.max(0, 1 - w.used_percent / 100)),
        reset: w.resets_at ? new Date(w.resets_at * 1000).toISOString() : null};
    })};
  }
  // 一连串请求（上一个回了再发下一个，都在同一条连接上：thread/resume 载入以后接着 thread/compact/start）；wait：最后一个回了以后接着等，
  //   等到这样的通知（如 "method":"thread/compacted"）再回（最多 secs 秒）。回最后一个请求的回答
  var CXSEQ_PL = "use IO::Socket::UNIX; use JSON::PP; my ($sp, $cj, $wait, $to) = @ARGV; my @calls = @{ decode_json($cj) }; my $s = IO::Socket::UNIX->new(Peer => $sp) or do { print qq({\"error\":\"noconn\"}\\n); exit 0 }; my $last = qq({\"error\":\"timeout\"}); $SIG{ALRM} = sub { print $last, \"\\n\"; exit 0 }; alarm($to || 8); print $s \"GET / HTTP/1.1\\r\\nHost: localhost\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n\"; $s->flush; my $h = q(); while ($h !~ /\\r\\n\\r\\n/) { sysread($s, my $c, 1) or exit 0; $h .= $c } $h =~ / 101 / or do { print qq({\"error\":\"nows\"}\\n); exit 0 }; sub sw { my $d = shift; utf8::encode($d) if utf8::is_utf8($d); my $l = length $d; my $f = chr(129) . ($l < 126 ? chr(128 | $l) : $l < 65536 ? chr(254) . pack(q(n), $l) : chr(255) . pack(q(Q>), $l)); my @k = map { int rand 256 } 1..4; $f .= pack(q(C4), @k); my $i = 0; $f .= join q(), map { chr(ord($_) ^ $k[$i++ % 4]) } split //, $d; print $s $f; $s->flush } sub rd { my $n = shift; my $b = q(); while (length($b) < $n) { sysread($s, my $c, $n - length $b) or exit 0; $b .= $c } $b } sub rw { my ($a, $b) = unpack(q(C2), rd(2)); my $l = $b & 127; $l = unpack(q(n), rd(2)) if $l == 126; $l = unpack(q(Q>), rd(8)) if $l == 127; return ($a & 15, $l ? rd($l) : q()) } my $js = JSON::PP->new->canonical; my $n = 1; my $waiting = 0; sw(q({\"id\":1,\"method\":\"initialize\",\"params\":{\"clientInfo\":{\"name\":\"vibing-studio\",\"version\":\"1\"},\"capabilities\":{\"experimentalApi\":true}}})); while (1) { my ($o, $p) = rw(); next unless $o == 1;   if ($waiting) { if ($p =~ /$wait/) { print $last, \"\\n\"; exit 0 } next }   next unless $p =~ /\"id\":(\\d+)[,}]/ && $1 == $n;   if ($n == 1) { sw(q({\"method\":\"initialized\"})) } else { $last = $p; if (exists $js->decode($p)->{error}) { print $p, \"\\n\"; exit 0 } }   if (@calls) { $last = q({\"error\":\"timeout\"}); my $c = shift @calls; $n++; sw($js->encode({ id => $n, method => $c->[0], params => $c->[1] })) }   elsif ($wait) { $waiting = 1 } else { print $p, \"\\n\"; exit 0 } }";
  function cxSeq(calls, wait, secs) {
    return LOC.exec({ cmd: "/usr/bin/perl -e '" + CXSEQ_PL + "' \"$HOME/.codex/app-server-control/app-server-control.sock\" " + shq(JSON.stringify(calls)) + " " + shq(wait || "") + " " + (secs || 8), timeout: ((secs || 8) + 5) * 1000 }).then(function (r) {
      var m = /\{[^\n]*\}/.exec(String(r && r.out || "")); if (!m) return { error: "noreply" };
      try { return JSON.parse(m[0]); } catch (e) { return { error: "badjson" }; }
    }, function (e) { return { error: String(e && e.message || e) }; });
  }
  // Codex 的「写代码调工具」（code mode）里，tools.<名字>( 后面第一个字符串参数（"…" / '…' / `…`，模板里 ${常量} 按前面的 const 换上）
  function jsArg(code, fn) {
    var i = code.indexOf("tools." + fn + "(");
    if (i < 0) return "";
    return jsString(code.slice(i + fn.length + 7).trimStart(), code);
  }
  function jsString(s, code) {
    var qc = s.charAt(0), out = "";
    if (qc !== '"' && qc !== "'" && qc !== "`") return "";
    for (var k = 1; k < s.length; k++) {
      var c = s.charAt(k);
      if (c === "\\") { var n = s.charAt(k + 1); out += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n; k++; continue; }
      if (c === qc) break;
      out += c;
    }
    if (qc === "`") {
      var vars = {};
      code.replace(/(?:const|let|var)\s+(\w+)\s*=\s*(["'])((?:(?!\2)[^\\]|\\.)*)\2/g, function (_, n, q, v) { vars[n] = v.replace(/\\(.)/g, "$1"); return _; });
      out = out.replace(/\$\{\s*(\w+)\s*\}/g, function (m, n) { return n in vars ? vars[n] : m; });
    }
    return out;
  }

  // ======== 会话列表 ========
  var LIST = [], byId = {}, scanning = null, lastScan = 0, scanError = "";
  var taskSources = ["cli", "vscode", "exec", "appServer"];
  var taskCacheKey = LOC.hostKey("tsu-cx-task-index-v1"), keptList = "";
  // Old tab layouts may contain segment IDs. They are aliases, never list entries.
  try { Object.keys(JSON.parse(localStorage.getItem("tsu-cx-heads") || "{}")).forEach(idOf); } catch (_) {}
  try {
    for (var cached of JSON.parse(localStorage.getItem(taskCacheKey) || "[]")) {
      if (!cached.id) continue;
      idOf(cached.path);
      byId[cached.id] = cached;
      LIST.push(cached);
    }
  } catch (_) {}
  function keepList() {
    try {
      var json = JSON.stringify(LIST.filter(x => x.listed).map(({live, ...entry}) => entry));
      if (json !== keptList) { localStorage.setItem(taskCacheKey, json); keptList = json; }
    } catch (_) {}
  }
  // Follow every cursor. Compressed segments, internal threads and uncommitted
  // journal entries are not independent tasks.
  async function taskPages(method, params) {
    var data = [], cursor = null, seen = new Set();
    do {
      var reply = await cxRpc(method, Object.assign({limit: 64, cursor: cursor}, params));
      if (!Array.isArray(reply.result?.data)) throw new Error(reply.error?.message || reply.error || method);
      data.push(...reply.result.data);
      cursor = reply.result.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error("Repeated Codex task cursor");
      seen.add(cursor);
    } while (cursor);
    return data;
  }
  function listedTasks(archived) {
    return taskPages("thread/list", {archived: archived, currentAccountOnly: true, useStateDbOnly: true,
      sourceKinds: taskSources, sortKey: "updated_at"});
  }
  // 最后一句（助手说的）：列表里第二行
  function readLast(f) {
    return LOC.read(f.path, { offset: Math.max(0, f.size - (48 << 10)), max: 48 << 10 }).then(function (b) {
      var ls = dec(b).split("\n"), last = "";
      for (var i = ls.length - 1; i >= 0 && !last; i--) {
        if (ls[i].indexOf('"assistant"') < 0 && ls[i].indexOf("task_complete") < 0) continue;
        try { var j = JSON.parse(ls[i]), p = j.payload || {}; if (j.type === "response_item" && p.type === "message" && p.role === "assistant") last = textOf(p.content); else if (j.type === "event_msg" && p.type === "task_complete") last = p.last_agent_message || ""; } catch (e) { /* 半行 */ }
      }
      return clip(assistantDisplayText(last), 160);
    }, function () { return ""; });
  }
  // Look up rollout files only to open a task or show its last reply. A new
  // Ready task can already exist on the server before its first file is written.
  var rolloutDirs = new Map();
  async function rolloutFiles(threads) {
    var dirs = new Map(), files = new Map();
    for (var thread of threads) {
      if (!thread.path) continue;
      var dir = thread.path.slice(0, thread.path.lastIndexOf("/"));
      if (!dirs.has(dir)) dirs.set(dir, []);
      dirs.get(dir).push(thread);
    }
    await Promise.all(Array.from(dirs, async ([dir, rows]) => {
      var stamp = rows.map(t => t.path + ":" + t.updatedAt).join("|");
      var entry = rolloutDirs.get(dir);
      if (entry?.stamp !== stamp || rows.some(t => t.status?.type === "active")) {
        var items = await LOC.list(dir).catch(() => null);
        if (items) {
          var paths = new Map();
          items.forEach(f => {
            if (!f.dir && idOf(f.name)) paths.set(dir + "/" + f.name, f);
          });
          entry = {stamp: stamp, paths: paths};
          rolloutDirs.set(dir, entry);
        }
      }
      for (var row of rows) {
        var path = row.path;
        if (!entry?.paths.has(path) && entry?.paths.has(path + ".zst")) path += ".zst";
        var file = entry?.paths.get(path);
        if (file) files.set(row.id, {path: path, size: file.size});
      }
    }));
    for (var dir of rolloutDirs.keys()) if (!dirs.has(dir)) rolloutDirs.delete(dir);
    return files;
  }
  async function taskCatalog() {
    try {
      return await Promise.all([listedTasks(false), listedTasks(true), taskPages("thread/loaded/list", {})]);
    } catch (error) {
      if (error.message !== "noconn") throw error;
      // With the daemon stopped, use its on-disk index. If it contains multiple
      // accounts, only the last account-scoped snapshot identifies visible IDs.
      var query = "SELECT id,rollout_path AS path,updated_at AS updatedAt,cwd,model,reasoning_effort AS reasoningEffort,name,substr(preview,1,600) AS preview,archived"
        + " FROM threads WHERE source IN ('cli','vscode','exec','appServer') AND preview <> '' AND attached_thread_parent_id IS NULL ORDER BY updated_at_ms DESC, id DESC";
      var snapshot = LIST.filter(x => x.listed);
      var sql = "SELECT count(DISTINCT creator_account_id) AS accounts FROM threads";
      var db = shq(home() + "/.codex/state_5.sqlite");
      var accounts = await LOC.exec({cmd: "sqlite3 -readonly " + db + " " + shq(sql)});
      if (accounts.code) throw new Error("无法读取 Codex 会话索引");
      if (Number(accounts.out.trim()) > 1) {
        if (!snapshot.length) throw new Error("等待 Codex 服务确认当前账户");
        var cached = snapshot.map(x => ({id: x.id, path: x.path, name: x.named ? x.title : null, preview: x.dimTitle ? "" : x.title,
          updatedAt: x.mtime / 1000, cwd: x.cwd, model: x.model, reasoningEffort: x.reasoningEffort, archived: x.archived}));
        return [cached.filter(t => !t.archived), cached.filter(t => t.archived), []];
      }
      var result = await LOC.exec({cmd: "sqlite3 -readonly -json " + db + " " + shq(query)});
      if (result.code) throw error;
      var rows = JSON.parse(result.out || "[]");
      return [rows.filter(t => !t.archived), rows.filter(t => t.archived), []];
    }
  }
  async function refreshTasks() {
    await LOC.ready;
    var sampledAt = Date.now();
    var [[active, archived, loaded], origins] = await Promise.all([
      taskCatalog(), LOC.list(LOC.info().home + "/Library/Application Support/Vibing Studio/verification-sessions").catch(() => [])
    ]);
    var verification = new Set(origins.map(entry => entry.name));
    var entries = new Map(), archivedIds = new Set(archived.map(t => t.id));
    active.concat(archived).forEach(t => entries.set(t.id, t));
    var listed = new Set(entries.keys());
    await Promise.all(loaded.map(async id => {
      var reply = await cxRpc("thread/read", {threadId: id, includeTurns: false}), t = reply.result?.thread;
      if (t && (listed.has(t.id) || taskSources.includes(t.source) && !t.attachedToThreadId && !t.parentThreadId)) entries.set(t.id, {...entries.get(t.id), ...t});
    }));
    var threads = Array.from(entries.values()), files = await rolloutFiles(threads);
    var out = threads.map(t => {
      var file = files.get(t.id), previous = byId[t.id];
      var name = (t.name?.trim() || t.preview?.trim() || "").split(/\r?\n/, 1)[0];
      var x = {id: t.id, verification: verification.has("cx-" + t.id), conn: "codex", live: null, listed: listed.has(t.id), archived: archivedIds.has(t.id),
        path: file?.path || (listed.has(t.id) ? t.path : null), size: file?.size || 0,
        mtime: t.updatedAt * 1000, cwd: t.cwd || "", model: t.model || "", reasoningEffort: t.reasoningEffort || "",
        title: name || "Untitled task", named: !!t.name, dimTitle: !name, last: previous?.last || ""};
      var state = t.status?.type;
      if (state === "active" || state === "idle" || state === "systemError") {
        var needsInput = t.status.activeFlags?.some(f => f === "waitingOnApproval" || f === "waitingOnUserInput");
        x.live = {kind: "codex", status: (needsInput || state === "systemError") ? "needs" : state === "active" ? "busy" : "idle", since: x.mtime, sampledAt: sampledAt};
      }
      return x;
    }).sort((a, b) => b.mtime - a.mtime);
    await Promise.all(out.filter(x => !x.archived && x.size && !x.path.endsWith(".zst")).slice(0, 12).map(async x => {
      var old = byId[x.id];
      if (!old || old.path !== x.path || old.size !== x.size || old.mtime !== x.mtime) x.last = await readLast(x);
    }));
    if (!on()) return LIST;
    LIST = out; byId = {};
    LIST.forEach(x => { byId[x.id] = x; rts["cx:" + x.id]?.adopt(x); });
    keepList();
    document.dispatchEvent(new Event("tsu-cx"));
    return LIST;
  }
  function scan(force) {
    if (!on()) { LIST = []; return Promise.resolve(LIST); }
    if (scanning) return scanning;
    if (!force && Date.now() - lastScan < 8000) return Promise.resolve(LIST);
    scanning = refreshTasks().then(rows => { scanError = ""; return rows; }).catch(error => {
      scanError = error.message || String(error);
      return LIST;
    }).finally(() => {
      lastScan = Date.now(); scanning = null;
      if (!LIST.length) document.dispatchEvent(new Event("tsu-cx"));
    });
    return scanning;
  }

  // ======== 一段会话：同 claude.js 的 Runtime（每种外壳只认这些）========
  var rts = {};
  var TOOL = { exec_command: "Bash", shell: "Bash", local_shell: "Bash", write_stdin: "TaskOutput", apply_patch: "Edit", update_plan: "TodoWrite", view_image: "Read", spawn_agent: "Agent", send_input: "SendMessage", tool_search: "ToolSearch" };
  function scriptCall(code) {
    var source = code.trim().replace(/^\/\/\s*@exec:[^\n]*\n/, "").trim();
    // Prefer the expression which returned the result over setup on the same line.
    var description = source.split("\n").find(line => line.trim() && !line.trimStart().startsWith("//"));
    var lastLine = source.slice(source.lastIndexOf("\n") + 1).trim();
    var writes = /(?:^|;)[ \t]*(text\()/g, call, start = -1;
    while ((call = writes.exec(lastLine))) start = writes.lastIndex - call[1].length;
    if (start >= 0) {
      var statement = lastLine.slice(start).replace(/;$/, "");
      var single = /^text\(\s*(?:await\s+)?(.+)\)$/.exec(statement);
      description = single && !statement.includes(");") ? single[1] : statement;
    }
    return {name: "Code", input: {description: clip(description || source, 140), language: "javascript", code: code}};
  }
  // 一次工具调用 → Paimon 的一格：名字对到 Claude Code 那一套（筛选、外壳都认），参数放进 input
  function toolPart(p, at) {
    var name = p.name || "", args = {}, input = {};
    if (p.type === "function_call") { try { args = JSON.parse(p.arguments || "{}") || {}; } catch (e) { args = { raw: p.arguments }; } }
    if (p.type === "web_search_call") {
      var ac = p.action || {};
      if (ac.type === "open_page" || ac.type === "find_in_page") return { name: "WebFetch", input: { url: ac.url || "", prompt: ac.pattern || "" } };
      return { name: "web_search", input: { query: ac.query || (ac.queries || [])[0] || "", queries: ac.queries || [] } };
    }
    if (p.type === "local_shell_call") { var cm = (p.action && p.action.command) || []; return { name: "Bash", input: { command: Array.isArray(cm) ? cm.join(" ") : String(cm) } }; }
    if (p.type === "tool_search_call") return { name: "ToolSearch", input: { query: (p.arguments && p.arguments.query) || "" } };
    if (p.namespace && /^mcp__/.test(p.namespace)) return { name: p.namespace.replace(/_+$/, "") + "__" + name.replace(/^_+/, ""), input: args };
    if (p.type === "custom_tool_call" && name === "apply_patch") {
      var files = [], m, re = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm;
      while ((m = re.exec(p.input || ""))) files.push(m[2].trim());
      return { name: "Edit", input: { file_path: files[0] || "", files: files, patch: p.input || "" } };
    }
    if (p.type === "custom_tool_call" && name === "exec") { // 写一段脚本调别的工具（Codex 的 code mode）：按它调的第一个工具来叫
      var code = p.input || "", calls = /tools\.(\w+)\s*\(/g, inner = calls.exec(code), q = function (k) { var r = new RegExp(k + '\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(code); try { return r ? JSON.parse('"' + r[1] + '"') : ""; } catch (e) { return r ? r[1] : ""; } };
      var iname = inner ? inner[1] : "";
      if (inner && calls.test(code)) return scriptCall(code);
      if (iname === "exec_command") {
        var field = /(?:[,{]\s*)(?:cmd|"cmd"|'cmd')\s*:\s*/g;
        field.lastIndex = inner.index + inner[0].length;
        var found = field.exec(code);
        var cmd = found && jsString(code.slice(field.lastIndex), code);
        return cmd ? { name: "Bash", input: { command: cmd } } : scriptCall(code);
      }
      if (iname === "write_stdin") { var sm = /session_id\s*:\s*(\d+)/.exec(code); return sm ? { name: "TaskOutput", input: { task_id: sm[1], chars: q("chars") } } : scriptCall(code); }
      if (iname === "web__run") return q("q") ? { name: "web_search", input: { query: q("q") } } : { name: "WebFetch", input: { url: q("ref_id") || q("url") } };
      if (iname === "apply_patch") { var pt = jsArg(code, "apply_patch"), fl = [], fm, fre = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm; while ((fm = fre.exec(pt))) fl.push(fm[2].trim()); return { name: "Edit", input: { file_path: fl[0] || "", files: fl, patch: pt } }; } // 补丁本身在 tools.apply_patch("…") 的参数里
      if (iname === "view_image") return { name: "Read", input: { file_path: q("path") } };
      return scriptCall(code);
    }
    var mapped = TOOL[name] || name;
    if (mapped === "Bash") input = { command: args.cmd || (Array.isArray(args.command) ? args.command.join(" ") : args.command) || "", workdir: args.workdir || "" };
    else if (mapped === "TaskOutput") input = { task_id: String(args.session_id || ""), chars: args.chars || "" };
    else if (mapped === "TodoWrite") input = { todos: (args.plan || []).map(function (x) { return { content: x.step, status: x.status }; }) };
    else if (mapped === "Read") input = { file_path: args.path || "" };
    else if (mapped === "Agent") input = { description: clip(args.message || args.task || args.prompt || "", 120), prompt: args.message || args.task || args.prompt || "", subagent_type: args.agent_type || "" };
    else input = args;
    return { name: mapped, input: input };
  }
  // 工具的结果：去掉 Codex 包在外面的那层（Chunk ID、Wall time……），取出输出和退出码
  //   还没跑完的命令（exec_command 到时间先返回）：「Process running with session ID 72507」/ code mode 里 "session_id":72507 → sess（之后 write_stdin 接着等它）
  function outputOf(o) {
    var s = typeof o === "string" ? o : Array.isArray(o) ? o.map(function (b) { return b && (b.text || b.output || "") || ""; }).join("\n") : o && typeof o === "object" ? (o.output || o.content || JSON.stringify(o)) : "";
    var code = null, sess = null, m;
    try { var j = JSON.parse(s); if (j && typeof j === "object") { if (j.metadata && j.metadata.exit_code !== undefined) code = j.metadata.exit_code; if (j.exit_code !== undefined) code = j.exit_code; if (typeof j.output === "string") s = j.output; } } catch (e) { /* 不是 JSON */ }
    if ((m = /Process exited with code (-?\d+)/.exec(s))) code = +m[1];
    else if ((m = /Process running with session ID (\d+)/.exec(s))) sess = +m[1];
    if ((m = /\nOutput:\n([\s\S]*)$/.exec(s))) s = m[1];
    // code mode：脚本里每调一次工具一段 {"chunk_id":…,"exit_code":0 或 "session_id":N,…,"output":"…"}——各自换成它的输出（脚本自己打的字原样留着）
    s = s.replace(/\{"chunk_id":[^\n]*?"output":"((?:[^"\\]|\\.)*)"\}/g, function (w, body) {
      var ec = /"exit_code":(-?\d+)/.exec(w), sd = /"session_id":(\d+)/.exec(w);
      if (ec) { code = +ec[1]; sess = null; } else if (sd) sess = +sd[1];
      try { return JSON.parse('"' + body + '"'); } catch (e) { return body; }
    });
    return { text: String(s || ""), code: code, sess: code === null ? sess : null };
  }
  function result(p, o) {
    p.secs = Math.max(0, Math.round(((p.turn && p.turn.last) || p.t0) - p.t0) / 1000);
    if (p.name === "Code" && p.input.language === "javascript") {
      var blocks = Array.isArray(o) ? o : [o], output = [], failed = false;
      blocks.forEach(function (block) {
        var raw = typeof block === "string" ? block : block?.text;
        if (typeof raw !== "string") {
          if (block?.type === "input_image" || block?.type === "image") output.push("Image");
          return;
        }
        if (/^Script (completed|failed|running)\b/.test(raw)) {
          failed = failed || /^Script failed\b/.test(raw);
          raw = raw.replace(/^Script (?:completed|failed|running)[^\n]*\n(?:Wall time[^\n]*\n)?(?:Output:\s*\n|Output:\s*$)/, "");
        }
        var frame;
        try { frame = JSON.parse(raw); } catch (e) { /* plain script output */ }
        if (frame?.chunk_id && typeof frame.output === "string") {
          if (frame.session_id != null) output.push("Terminal session " + frame.session_id);
          else if (frame.exit_code != null) output.push("Exit code " + frame.exit_code);
          raw = frame.output;
        }
        if (raw.trim()) output.push(raw.trimEnd());
      });
      p.status = failed ? "error" : "done";
      p.detail = output.length ? output.join("\n").replace(/\r/g, "").split("\n") : [];
      if (failed) p.error = p.detail.find(line => line.trim()) || "Script failed";
      return;
    }
    var r = outputOf(o), lines = r.text.replace(/\r/g, "").split("\n");
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    p.exitCode = r.code;
    var err = r.code !== null && r.code !== 0;
    if (r.sess !== null && p.name === "Bash") { p.status = "running"; p.sess = r.sess; p.detail = lines.slice(-400); return; } // 还在跑：之后等它的输出接在这里（Codex 自己也是这样显示）
    p.status = err ? "error" : "done";
    if (err) { p.error = (lines.filter(Boolean).slice(-1)[0] || "exit code " + r.code).slice(0, 300); p.detail = lines; return; }
    if (p.name === "wait") {
      var raw = Array.isArray(o) ? o.map(x => x.text || "").join("\n") : String(o || "");
      var output = lines.find(line => line.trim() && !/^(Script (completed|running)|Wall time:|Output:|Original token count:)/i.test(line));
      var duration = /^Wall time:\s*([\d.]+)\s*seconds?/im.exec(raw);
      p.summary = output ? output.trim().slice(0, 160) :
        (/Script running/i.test(raw) ? "Still running" : "Finished waiting") + (duration ? " · " + duration[1] + "s" : "");
      p.detail = lines.length ? lines : [p.summary];
      return;
    }
    if (p.name === "Edit") {
      var d = [], add = 0, del = 0, pl = String(p.input.patch || "").split("\n");
      pl.forEach(function (l) { if (/^\*\*\* /.test(l)) { if (d.length) d.push({ t: "…" }); return; } if (l[0] === "+") { d.push({ t: "+", l: l.slice(1) }); add++; } else if (l[0] === "-") { d.push({ t: "-", l: l.slice(1) }); del++; } else if (l[0] === " ") d.push({ t: " ", l: l.slice(1) }); });
      p.diff = d.slice(0, 400);
      var fp = (p.input.files || [p.input.file_path]).filter(Boolean);
      p.summary = "Updated " + (fp.length > 1 ? fp.length + " files" : String(fp[0] || "files").split("/").pop()) + " with " + add + " addition" + (add === 1 ? "" : "s") + " and " + del + " removal" + (del === 1 ? "" : "s");
      return;
    }
    if (p.name === "Read") { p.summary = "Viewed image"; return; }
    if (p.name === "web_search") { p.summary = "Did 1 search"; p.detail = lines.slice(0, 60); return; }
    if (p.name === "WebFetch") { p.summary = lines[0] ? lines[0].slice(0, 160) : "Done"; p.detail = lines.slice(0, 200); return; }
    if (p.name === "TodoWrite") { p.summary = "Updated plan"; return; }
    if (p.name === "Agent") { p.summary = lines[0] ? lines[0].slice(0, 200) : "Done"; p.detail = lines.slice(0, 200); return; }
    p.detail = p.name === "Bash" ? lines : lines.slice(0, 400);
  }

  // Map app-server history into the same transcript rows as the live event stream.
  function historyTurn(turn) {
    var start = (turn.startedAt || turn.completedAt || 0) * 1000, rows = [], row;
    function append(ask, images, at) {
      row = {ask: ask, images: images, parts: [], at: at, cont: !ask && !images.length};
      rows.push(row);
    }
    for (var item of turn.items) {
      var at = item.startedAtMs || start;
      if (item.type === "userMessage") {
        var user = userOf(item.content.map(b => b.type === "image" ? {type:"input_image", image_url:b.url} : b));
        user.images.push(...item.content.filter(b => b.type === "localImage").map(b => ({path:b.path})));
        if (!synthetic(user.text) && (user.text.trim() || user.images.length)) append(user.text, user.images, at);
        continue;
      }
      if (item.type === "hookPrompt") continue;
      if (item.type === "contextCompaction") { rows.push({at:at, compact:{}}); row = null; continue; }
      if (!row) append("", [], at);
      if (item.type === "agentMessage" || item.type === "plan") {
        row.parts.push({kind:"text", text:item.type === "agentMessage" ? assistantDisplayText(item.text) : item.text, whole:true, at:at, phase:item.phase === "final_answer" ? "final" : item.phase === "commentary" ? "progress" : ""});
      } else if (item.type === "reasoning") {
        var summary = (item.summary || []).join("\n\n");
        if (summary) row.thinking = [row.thinking, summary].filter(Boolean).join("\n\n");
        row.thought = Math.max(1, row.thought || 0, Math.round(((item.completedAtMs || at) - at) / 1000));
      } else {
        var name = item.tool || item.name || item.type, input = item.arguments || {}, output = null;
        if (item.type === "commandExecution") { name = "Bash"; input = {command:item.command, workdir:item.cwd}; output = item.aggregatedOutput; }
        else if (item.type === "fileChange") { name = "Edit"; input = {file_path:item.changes[0]?.path || ""}; output = item.changes.map(c => c.diff).join("\n"); }
        else if (item.type === "webSearch") { name = "web_search"; input = {query:item.query || item.action?.query || ""}; }
        else if (item.type === "imageView") { name = "Read"; input = {file_path:item.path}; }
        else if (item.type === "collabAgentToolCall") { name = TOOL[item.tool] || item.tool; input = {description:item.prompt, ids:item.receiverThreadIds}; }
        else if (item.type === "mcpToolCall") { name = "mcp__" + item.server + "__" + item.tool; output = item.error || item.result?.content; }
        else if (item.type === "dynamicToolCall") { output = item.contentItems; }
        else { output = item.output || item.review || null; }
        var part = {kind:"tool", name:name, input:input, id:item.id, t0:at, turn:row, status:"done"};
        if (output != null) result(part, typeof output === "string" ? output : JSON.stringify(output));
        if (item.status === "failed" || item.exitCode) part.status = "error";
        row.parts.push(part);
      }
      row.last = item.completedAtMs || at;
    }
    if (row && turn.completedAt) {
      row.last = turn.completedAt * 1000;
      row.stats = {secs: Math.max(1, Math.round((turn.durationMs ?? row.last - row.at) / 1000)), verb:"Worked", at:row.last};
    }
    return rows;
  }
  function Runtime(aid, info, historyOnly) {
    var rt = this, sid = aid.slice(3), subs = [], turns = [], sess = { id: sid, title: info.title || sid.slice(0, 8), turns: turns, todo: { items: [] }, ctx: 0, window: 0, updated: info.mtime || 0 };
    rt.tabLightReady = false;
    var agent = rt.agent = { id: aid, name: sess.title, effort: "", access: "rw", model: info.model || "", current: sid, goal: null, archived: false, claude: true, connector: "codex" };
    rt.info = info; rt.sid = sid; rt.label = "Codex";
    var emit = function (t, d) { subs.slice().forEach(function (f) { try { f(t, d); } catch (e) { console.error(e); } }); };
    rt.on = function (fn) { subs.push(fn); if (subs.length === 1) start(); return function () { subs = subs.filter(function (f) { return f !== fn; }); if (!subs.length) stop(); }; };
    rt.fire = emit;
    rt.session = function () { return sess; };
    rt.stream = null; rt.tasks = []; rt.queued = null;
    var serverQueue = [], queueReadAt = 0, readingQueue = false, deliveredQueueKeys = new Set();
    function syncQueue() {
      if (readingQueue || Date.now() - queueReadAt < 3000 || !/^[a-f0-9-]{36}$/i.test(sid)) return;
      queueReadAt = Date.now();
      readingQueue = true;
      cxRpc("thread/queue/list", { threadId: sid }).then(function (reply) {
        var items = reply && reply.result && reply.result.data;
        if (!Array.isArray(items)) return;
        var observed = Date.now();
        var known = new Map(serverQueue.map(item => [item.id, item.at]));
        var next = items.map(function (item) {
          var imageNumber = 0;
          var text = item.input.map(function (part) { return part.type === "text" ? part.text : "[Image #" + (++imageNumber) + "]"; }).join(" ");
          return { id: item.id, at: known.get(item.id) || observed, key: item.clientUserMessageId || item.id, paths: item.input.filter(p => p.type === "localImage").map(p => p.path), caption: item.input.filter(part => part.type === "text").map(part => part.text).join(" "), text: text, ours: true, sending: false };
        });
        for (var key of deliveredQueueKeys) {
          if (!next.some(item => item.key === key)) deliveredQueueKeys.delete(key);
        }
        next = next.filter(item => !deliveredQueueKeys.has(item.key));
        if (JSON.stringify(next) !== JSON.stringify(serverQueue)) {
          serverQueue = next;
          emit("status");
        }
      }).finally(function () { readingQueue = false; });
    }
    rt.pendingMsgs = function () { return rt.pending().length; };
    rt.pending = function () {
      var local = sentWait.slice();
      function images(entry) {
        if (!entry.previewImages) Object.defineProperty(entry, "previewImages", {value:(entry.paths || []).map(path => {
          var reading, image = {path, media_type: "image/" + path.split(".").pop().toLowerCase().replace(/^jpg$/, "jpeg")};
          image.load = function(done) { if (!reading) reading = LOC.read(path).then(buf => {image.bytes = buf;}, () => {image.missing = true;}); if (done) reading.then(done); };
          return image;
        })});
        return entry.previewImages;
      }
      var pending = local.map(x => ({key:x.key, text:x.text, at:x.at, first:x.at, ours:true, delivery:x.q ? "queue" : x.waitingDispatch ? "local" : x.steerTurn ? "steer" : "current",
        sending:!x.q && !x.err, images:images(x), err:x.err === "Codex 服务正在重启，请重试" ? "Codex 在重启期间未接收此消息" : x.err, local:!!x.err, li:sentWait.indexOf(x)}));
      var matched = new Set(), external = [];
      for (var q of serverQueue) {
        var i = local.findIndex(x => x.key === q.key);
        if (i < 0) i = local.findIndex((x, n) => !matched.has(n) && !x.err && x.q && x.text === q.caption &&
          JSON.stringify(x.paths || []) === JSON.stringify(q.paths));
        if (i >= 0) matched.add(i);
        else external.push({...q, first:q.at, delivery:"queue"});
      }
      return external.concat(pending).sort((a,b) => a.at - b.at);

    };
    rt.takeQueued = function () { var q = rt.queued; rt.queued = null; emit("status"); return q; };
    rt.todo = function () { return sess.todo.items; };
    rt.model = function () { var m = agent.model || ""; return { id: m, name: m || "Codex", window: sess.window || 272000 }; };
    rt.state = function () { return busy ? "working" : "idle"; };
    var contextUsage = null;
    rt.readContextParts = async function () {
      var path = await withPath();
      if (!path) return null;
      var ui = !window.nadosNative?.remote && window.TSU_UI_LOCAL?.dir;
      var script;
      if (ui) script = shq(ui + "/studio/context_parts.py");
      else {
        var response = await fetch("studio/context_parts.py");
        if (!response.ok) throw new Error("Cannot load context reader");
        script = "-c " + shq(await response.text());
      }
      var result = await LOC.exec({cmd:"python3 " + script + " " + shq(path)});
      return JSON.parse(result.out);
    };
    rt.contextBreakdown = function () {
      var c = rt.ctx(), u = contextUsage || {}, total = c.tokens;
      var input = Math.min(total, u.input_tokens || 0);
      var cached = Math.min(input, u.cached_input_tokens || 0);
      var output = Math.min(total - input, u.output_tokens || 0);
      var parts = [
        { id: "cachedInput", tokens: cached, color: "#5b8def" },
        { id: "input", tokens: input - cached, color: "#78a9af" },
        { id: "output", tokens: output, color: "#ad84bd" },
        { id: "used", tokens: total - input - output, color: "#949ca8" }
      ].filter(p => p.tokens > 0);
      var baseline = Math.min(12000, c.window);
      var capacity = c.window - baseline;
      var occupied = Math.min(capacity, Math.max(0, total - baseline));
      return { total: occupied, window: capacity, parts: [{ id: "used", tokens: occupied, color: "#5b8def" }],
        requestUsage: contextUsage ? parts.filter(p => p.id !== "used") : null };
    };
    rt.ctx = function () { var w = sess.window || 272000; return { tokens: sess.ctx, window: w, pct: sess.ctx / w * 100 }; };
    rt.home = rt.cwd = function () { return info.cwd || ""; };
    rt.cost = function () { return 0; };
    rt.tail = function () { return info.last || ""; };
    rt.maybeRecap = rt.recap = function () {};
    rt.record = function (cmd, res) { var t = { cmd: cmd, note: tr(res), at: Date.now(), local: true }; turns.push(t); emit("append", t); };
    ["setEffort", "setModel", "setAccess", "rename", "setGoal", "clearGoal", "clear", "resume", "bang", "detachBash", "stopTask", "wakeUp", "receive", "afterReload"].forEach(function (k) { rt[k] = function () { return false; }; });
    rt.turnOf = function () { return null; };
    rt.historical = function () { return false; };
    var historyStart = 0, readingHistory = false, inherited = false, parentCursor, firstRawTurn;
    rt.more = function () { return historyStart > 0 || inherited; };
    function startOfSegment(page) {
      if (page.start) return;
      for (var line of page.lines) {
        if (!line.includes('"session_meta"') && !line.includes('"task_started"')) continue;
        var record;
        try { record = JSON.parse(line); } catch (_) { continue; }
        if (record.type === "session_meta") inherited = !!record.payload?.history_base;
        if (record.type === "event_msg" && record.payload?.type === "task_started") {
          firstRawTurn = record.payload.turn_id;
          break;
        }
      }
    }
    async function listTurns(cursor, limit, itemsView) {
      var reply = await cxRpc("thread/turns/list", {threadId: sid, sortDirection: "desc", cursor: cursor, limit: limit, itemsView: itemsView});
      if (!Array.isArray(reply.result?.data)) throw new Error("无法读取 Codex 历史记录");
      return reply.result;
    }
    // The active JSONL is one segment. Codex applies fork/rollback boundaries
    // (including compressed ancestors) when paging the logical thread by cursor.
    async function beforeSegment() {
      var cursor = null;
      if (!firstRawTurn) return {cursor: null, more: true};
      do {
        var page = await listTurns(cursor, 100, "notLoaded");
        var index = page.data.findIndex(t => t.id === firstRawTurn);
        if (index >= 0) {
          var prefix = index + 1 === page.data.length ? page : await listTurns(cursor, index + 1, "notLoaded");
          return {cursor: prefix.nextCursor, more: !!prefix.nextCursor};
        }
        cursor = page.nextCursor;
      } while (cursor);
      throw new Error("无法定位 Codex 会话的历史分界");
    }
    rt.earlier = async function () {
      if (!rt.more() || loadingNow || readingHistory) return false;
      var generation = gen, rows;
      readingHistory = true;
      rt.historyProgress = -1; emit("historyProgress");
      try {
        if (historyStart) {
          var page = await readPage(historyStart);
          if (gen !== generation) return false;
          const segment = new Runtime(aid, Object.assign({}, info), true);
          await segment.readHistory(page.lines, () => gen === generation);
          if (gen !== generation) return false;
          rows = segment.session().turns;
          historyStart = page.start;
          startOfSegment(page);
        } else {
          if (parentCursor === undefined) {
            var anchor = await beforeSegment();
            if (gen !== generation) return false;
            parentCursor = anchor.cursor; inherited = anchor.more;
            if (!inherited) return false;
          }
          var older = await listTurns(parentCursor, 4, "full");
          if (gen !== generation) return false;
          rows = older.data.reverse().flatMap(historyTurn);
          parentCursor = older.nextCursor; inherited = !!parentCursor;
        }
        turns.unshift.apply(turns, rows);
        restorePromptOrder();
        emit("prepend");
        return true;
      } catch (err) {
        console.warn("Codex scrollback:", err.message);
        return false;
      } finally { readingHistory = false; if (!loadingNow) { rt.historyProgress = null; emit("historyProgress"); } }
    };
    rt.later = function () { return Promise.resolve(false); };
    rt.latest = function () { return load(); };

    // ---- 读记录 ----
    var offset = 0, pollT = 0, cur = null, byCall = {}, loading = null, running = null;
    // 它在想吗（同 Claude Code 转圈那一行的 thinking / still thinking / deep in thought：live.js 的 thinkPhrase 问 rt.thinkSince）：
    //   最后一条是要它回的（你的话、开始一问、工具的结果）、它还没写出东西（推理、回复、工具调用）——这段时间它在推理。用户 2026-10-28：Codex 以前只写 Working
    var pendingPolls = new Map(), compactSince = 0, compactEnd = 0, compactCheck = 0, checkingCompact = false;
    function phase() {
      return compactSince ? "Compacting context" : pendingPolls.size ? "Waiting for background terminal" : "";
    }
    function checkCompact() {
      if (!running || checkingCompact || Date.now() < compactCheck || !/^[a-f0-9-]+$/i.test(sid) || !/^[a-f0-9-]+$/i.test(running)) return;
      var turn = running;
      compactCheck = Date.now() + 2500;
      checkingCompact = true;
      var sql = "SELECT (ts * 1000 + ts_nanos / 1000000) FROM logs WHERE thread_id='" + sid + "' AND ts >= " + Math.floor(runAt / 1000) + " AND instr(feedback_log_body,'run_auto_compact{') > 0 AND instr(feedback_log_body,'" + turn + "') > 0 AND (ts * 1000 + ts_nanos / 1000000) > " + compactEnd + " ORDER BY ts, ts_nanos LIMIT 1";
      LOC.exec({cmd: '/usr/bin/sqlite3 -readonly "$HOME/.codex/logs_2.sqlite" ' + shq(sql)}).then(function (result) {
        var time = Number(result && result.out);
        if (!compactSince && running === turn && time > compactEnd && time >= runAt) compactSince = time;
      }).finally(function () { checkingCompact = false; });
    }
    var lastIn = 0, lastOut = 0;
    rt.thinkSince = function () { return rt.stream && !phase() && running && lastIn > lastOut ? lastIn : 0; };

    // 在跑的那一问（转圈那一行、「在跑」的画法跟着它）：读到新的一问就换成它——不然还指着上一问（已经答完的），
    //   新的一问的回复、「Worked for」那一行都画错（上一问当成在跑、少了做完那一行）
    // 发出去、Codex 还没写进记录的那几句：先画成「排着」（灰底的「❯ 原话」），记录里出现了就划掉——不然要等它答了这句话才冒出来，像被吞了
    var pendingKey = "tsu-cx-awaiting-log:" + sid, sentWait = [];
    try {
      var savedPending = JSON.parse(sessionStorage.getItem(pendingKey) || "[]");
      if (Array.isArray(savedPending)) sentWait = savedPending.filter(x => x && typeof x.text === "string" && Number.isFinite(x.at)).map(x => x.paths?.length && x.text === "(image)" ? {...x, text:""} : x);
    } catch (e) {}
    sentWait.forEach(entry => { if (!entry.key) entry.key = crypto.randomUUID(); });
    function failureKey() { return LOC.hostKey("tsu-cx-failed:" + (window.TSU_UID || 0) + ":" + sid); }
    function failedEntries() {
      try { return JSON.parse(localStorage.getItem(failureKey())) || {}; } catch (_) { return {}; }
    }
    for (var saved of Object.values(failedEntries())) {
      if (saved.err && !sentWait.some(entry => entry.key === saved.key)) sentWait.push(saved);
    }
    function storeFailure(entry, error) {
      if (!sentWait.includes(entry)) return;
      entry.err = error;
      var entries = failedEntries();
      if (error) entries[entry.key] = entry;
      else delete entries[entry.key];
      try {
        if (Object.keys(entries).length) localStorage.setItem(failureKey(), JSON.stringify(entries));
        else localStorage.removeItem(failureKey());
      } catch (_) {}
      savePending();
      emit("status");
    }
    rt.retryOne = function (li, at) {
      var entry = sentWait[li];
      if (!entry?.err || entry.at !== at) return;
      var message = (entry.paths || []).map(path => '[Image: "' + path + '"]').concat(entry.text).join(" ").trim();
      if (rt.send(message, null, {queue: entry.q})) {
        storeFailure(entry, "");
        sentWait.splice(sentWait.indexOf(entry), 1); savePending(); emit("status");
      }
    };
    function savePending() {
      try {
        if (sentWait.length) sessionStorage.setItem(pendingKey, JSON.stringify(sentWait));
        else sessionStorage.removeItem(pendingKey);
      } catch (e) {}
    }
    function orderKey() { return LOC.hostKey("tsu-cx-prompt-order:" + sid); }
    var promptOrder = {};
    try { promptOrder = JSON.parse(localStorage.getItem(orderKey()) || "{}") || {}; } catch (_) {}
    function turnKey(t) { return t.at + ":" + t.ask.length + ":" + (t.images?.length || 0); }
    function placePrompt(t, entry) {
      if (!t.ask && !t.images?.length) return;
      var key = turnKey(t), order = promptOrder[key];
      if (!order && !entry) return;
      var before = turns.find(other => other !== t && (other.ask || other.images?.length) &&
        (order ? turnKey(other) === order.before : (other.submittedAt || other.at) > entry.at && other.at <= t.at));
      if (!before || t.promptMoved) return;
      if (!order) {
        promptOrder[key] = order = {before:turnKey(before), at:entry.at};
        try { localStorage.setItem(orderKey(), JSON.stringify(promptOrder)); } catch (_) {}
      }
      t.submittedAt = order.at;
      t.promptMoved = true;
      (before.leadingPrompts ||= []).push(t);
      before.leadingPrompts.sort((a,b) => a.submittedAt - b.submittedAt);
      if (!loadingNow) emit("turn", before);
    }
    function restorePromptOrder() {
      if (Object.keys(promptOrder).length) turns.forEach(t => placePrompt(t));
    }
    var wnorm = function (t) { return String(t || "").replace(/\r\n/g, "\n").trim(); };
    function newTurn(text, at, imgs) {
      if (cur) settle(cur);
      cur = {ask:text, images:imgs || [], parts:[], at};
      turns.push(cur);
      if (rt.stream) rt.stream.turn = cur;
      var entry = sentWait.length ? dropSent(text, at, cur.images.length) : null;
      if (entry) cur.submittedAt = entry.at;
      placePrompt(cur, entry);
      return cur;
    }
    function dropSent(text, at, imageCount) {
      var hit = sentWait.findIndex(function (x) {
        return !x.waitingDispatch && !x.err && (!at || at >= x.at) && (imageCount == null || (x.paths || []).length === imageCount) && wnorm(x.text) === wnorm(text);
      });
      if (hit >= 0) {
        var [entry] = sentWait.splice(hit, 1);
        if (entry.q) {
          var item = serverQueue.find(q => q.key === entry.key) || serverQueue.find(q =>
            q.caption === entry.text && JSON.stringify(q.paths) === JSON.stringify(entry.paths));
          deliveredQueueKeys.add(item?.key || entry.key);
          if (item) serverQueue = serverQueue.filter(q => q !== item);
        }
        savePending();
        return entry;
      }
    }
    function ensureTurn(at) { if (!cur) { cur = { ask: "", parts: [], at: at, cont: true }; turns.push(cur); if (rt.stream) rt.stream.turn = cur; } return cur; }
    // 还在跑的命令（exec_command 先返回了、session ID N）：之后 write_stdin 等它的输出——不另起一格，接在那条命令下面（同 Codex 自己）
    var sessOf = {}, runAt = 0;
    function pollOf(p) {
      var a = {};
      if (p.type === "function_call" && p.name === "write_stdin") { try { a = JSON.parse(p.arguments || "{}") || {}; } catch (e) { return null; } return a.session_id != null ? { sess: +a.session_id, chars: String(a.chars || "") } : null; }
      if (p.type === "custom_tool_call" && p.name === "exec") {
        var code = String(p.input || ""), calls = code.match(/tools\.(\w+)\s*\(/g) || [];
        if (calls.length !== 1 || !/write_stdin/.test(calls[0])) return null;
        var sm = /session_id\s*:\s*(\d+)/.exec(code), cm = /chars\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(code), ch = "";
        try { ch = cm ? JSON.parse('"' + cm[1] + '"') : ""; } catch (e) { ch = cm ? cm[1] : ""; }
        return sm ? { sess: +sm[1], chars: ch } : null;
      }
      return null;
    }
    function more(tgt, o, at, chars) { // 接着等到的输出：加在那条命令的输出后面；退出了就是跑完了
      var r = outputOf(o), ls = r.text.replace(/\r/g, "").split("\n");
      while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
      if (chars) ls.unshift("› " + chars.replace(/\n/g, "⏎"));
      tgt.detail = (tgt.detail || []).concat(ls).slice(-400);
      tgt.secs = Math.max(0, Math.round((at - tgt.t0) / 1000));
      if (r.code !== null) { tgt.status = r.code === 0 ? "done" : "error"; if (r.code !== 0) tgt.error = (tgt.detail.filter(Boolean).slice(-1)[0] || "exit code " + r.code).slice(0, 300); delete sessOf[tgt.sess]; }
      if (tgt.turn) tgt.turn.last = at;
      return tgt.turn;
    }
    // 一问做完 / 停下：还挂着「在跑」的工具不再转（后台还在跑的命令，之后再等它的输出照样接上：sessOf 留着）
    function settle(t) { (t.parts || []).forEach(function (q) { if (q.kind === "tool" && q.status === "running") q.status = "done"; }); }
    function assistantText(text, phase, at, source, id) {
      text = assistantDisplayText(text);
      if (!text || !text.trim()) return null;
      var t = ensureTurn(at), last = t.parts[t.parts.length - 1];
      if (last && last.kind === "text" && ((id && last.messageId === id) ||
          (last.text === text && last.source !== source))) return null;
      lastOut = Math.max(lastOut, at);
      t.parts.push({kind: "text", text: text, whole: true, at: at, source: source, messageId: id,
        phase: phase === "commentary" ? "progress" : phase === "final_answer" ? "final" : ""});
      t.last = at;
      return t;
    }
    function feedLine(line) {
      if (!line || line.length < 10) return null;
      var j; try { j = JSON.parse(line); } catch (e) { return null; }
      var p = j.payload || {}, at = ts(j.timestamp);
      if (j.type === "session_meta") { info.cwd = p.cwd || info.cwd; return null; }
      if (j.type === "turn_context") { if (p.model) agent.model = p.model; var cs = p.collaboration_mode && p.collaboration_mode.settings; if (p.effort || (cs && cs.reasoning_effort)) agent.effort = effortSel || p.effort || cs.reasoning_effort; return null; }
      if (j.type === "compacted") { compactSince = 0; compactEnd = at;
        if (cur) {
          cur.beforeCompaction = true;
          settle(cur);
          if (!loadingNow) emit("turn", cur);
        }
        cur = null; var c = { compact: { summary: String(p.message || "").trim() }, at: at }; if (Array.isArray(p.replacement_history)) c.compact.retainedMessages = p.replacement_history.filter(item => item?.type === "message").length;
        var retained = p.retained_context || {};
        var entries = [];
        for (var role of ["user", "assistant"]) {
          for (var msg of retained[role + "_messages"] || []) {
            if (typeof msg.text === "string" && msg.text.trim()) entries.push({ role: role, text: msg.text, order: msg.order });
          }
        }
        if (!entries.length && Array.isArray(p.replacement_history)) {
          for (var item of p.replacement_history) {
            if (item.type !== "message" || !["user", "assistant"].includes(item.role) || !Array.isArray(item.content)) continue;
            var body = item.content.filter(part => typeof part.text === "string").map(part => part.text).join("\n");
            if (body.trim()) entries.push({ role: item.role, text: body });
          }
        }
        c.compact.entries = entries.sort((a, b) => (a.order || 0) - (b.order || 0));
        turns.push(c); return c; }
      if (j.type === "event_msg") {
        if (p.type === "item_completed" && p.item && p.item.type === "AgentMessage") {
          var message = p.item;
          return assistantText((message.content || []).map(function (block) { return block.type === "Text" ? block.text : ""; }).filter(Boolean).join("\n"), message.phase, at, "item", message.id);
        }
        if (p.type === "item_completed" && p.item && p.item.type === "CommandExecution" && cur) {
          var item = p.item, argv = item.command;
          if (!Array.isArray(argv) || !argv.length) return null;
          var command = /^-[a-z]*c$/.test(argv[1]) ? argv[2] : argv.join(" ");
          var candidates = cur.parts.filter(function (part) { return part.name === "Bash" && !part.nativeCommand && part.status === "running"; });
          var match = candidates.find(function (part) { return part.input.command === command; });
          if (!match && candidates.length === 1 && !candidates[0].input.command) match = candidates[0];
          if (match) {
            match.nativeCommand = true;
            match.parsedCommand = item.parsed_cmd;
            match.input.command = command;
            match.input.workdir = item.cwd;
            result(match, { output: JSON.stringify({output: item.aggregated_output || "", exit_code: item.exit_code}) });
            return cur;
          }
        }
        if (p.type === "task_started") { pendingPolls.clear(); compactSince = 0; running = p.turn_id || "?"; runAt = p.started_at ? p.started_at * 1000 : at; if (rt.stream) { rt.stream.t0 = runAt; rt.stream.phaseAt = 0; } lastIn = Math.max(lastIn, at); if (at >= sentAt - 2000) sentAt = 0; return null; } // 排进去的那句开始跑了：不再靠「刚排进去」算在跑（跑完马上停转）
        if (p.type === "task_complete") { if (running && running !== "?" && p.turn_id && p.turn_id !== running) return null; turnEndedAt = Math.max(turnEndedAt, at); assistantText(p.last_agent_message, "final_answer", at, "completion"); if (at >= sentAt) sentAt = 0; running = null; if (cur) { settle(cur); var dsec = p.duration_ms ? p.duration_ms / 1000 : p.completed_at && p.started_at ? p.completed_at - p.started_at : ((cur.last || at) - cur.at) / 1000; cur.stats = { secs: Math.max(1, Math.round(dsec)), verb: "Worked", at: at }; cur.last = at; } return cur; }
        if (p.type === "turn_aborted") { if (running && running !== "?" && p.turn_id && p.turn_id !== running) return null; if (at >= sentAt) sentAt = 0;
          turnEndedAt = Math.max(turnEndedAt, at);
          var abortedId = p.turn_id || running;
          var stranded = sentWait.filter(x => x.steerTurn && x.steerTurn === abortedId);
          if (stranded.length) {
            stranded.filter(x => !x.err).forEach(x => storeFailure(x, "追加消息尚未写入会话记录，请确认后重试"));
          }
          running = null; if (cur) { settle(cur); cur.error = "Interrupted by user"; return cur; } return null; }
        if (p.type === "token_count" && p.info) { var u = p.info.last_token_usage || {}; if (u.total_tokens || u.input_tokens) contextUsage = u; if (u.total_tokens || u.input_tokens) sess.ctx = u.total_tokens || ((u.input_tokens || 0) + (u.output_tokens || 0)); if (p.info.model_context_window) sess.window = p.info.model_context_window; return null; }
        if (p.item && /^(contextCompaction|context_compaction)$/i.test(p.item.type)) {
          if (p.type === "item_started") compactSince = p.started_at_ms || at;
          if (p.type === "item_completed") {
            var start = p.started_at_ms || compactSince, end = p.completed_at_ms || at;
            var entry = turns[turns.length - 1];
            if (!entry || !entry.compact || (start && entry.at < start)) {
              // The large compacted record can be outside the loaded page. Close the
              // preceding segment here too, so later output follows the marker.
              if (cur) settle(cur);
              cur = null;
              entry = { compact: {}, at: end };
              turns.push(entry);
            }
            if (start && end >= start) entry.compact.duration = end - start;
            compactSince = 0; compactEnd = end;
            return entry;
          }
        }
        if (p.type === "context_compacted") { compactSince = 0; compactEnd = at; return null; } // 同一回事的 compacted 那一行已经画了
        return null;
      }
      if (j.type !== "response_item") return null;
      if (p.type === "message") {
        if (p.role === "user") { var u = userOf(p.content); if ((!u.text.trim() && !u.images.length) || synthetic(u.text)) return null; lastIn = Math.max(lastIn, at); return newTurn(u.text, at, u.images); }
        return p.role === "assistant" ? assistantText(textOf(p.content), p.phase, at, "response", p.id) : null;
      }
      if (p.type === "reasoning") {
        lastOut = Math.max(lastOut, at); // 推理写进记录了：这一段想完了（接下来是回复或工具调用）
        var sm = (p.summary || []).map(function (x) { return x && x.text || ""; }).filter(Boolean).join("\n\n");
        var t2 = ensureTurn(at);
        if (sm) t2.thinking = (t2.thinking ? t2.thinking + "\n\n" : "") + sm;
        t2.thought = Math.max(t2.thought || 1, Math.round((at - t2.at) / 1000));
        return t2;
      }
      if (/_call$/.test(p.type) && p.type !== "function_call_output") lastOut = Math.max(lastOut, at);
      if (/_call$/.test(p.type) && p.type !== "function_call_output") {
        var po = pollOf(p), tg = po && sessOf[po.sess];
        if (po && !po.chars && (p.call_id || p.id)) pendingPolls.set(p.call_id || p.id, at);
        if (tg && (p.call_id || p.id)) { byCall[p.call_id || p.id] = { poll: tg, chars: po.chars }; return null; }
        var tp = toolPart(p, at), t3 = ensureTurn(at);
        var part = { kind: "tool", name: tp.name, input: tp.input || {}, status: p.type === "web_search_call" ? "done" : "running", id: p.call_id || p.id, t0: at, turn: t3 };
        if (p.type === "web_search_call") part.summary = part.name === "web_search" ? "Did 1 search" : "Opened page";
        if (tp.name === "TodoWrite" && tp.input.todos) sess.todo.items = tp.input.todos.map(function (x, i) { return { id: String(i + 1), subject: x.content, status: x.status }; });
        if (part.id) byCall[part.id] = part;
        t3.parts.push(part);
        t3.last = at;
        return t3;
      }
      if (p.type === "function_call_output" || p.type === "custom_tool_call_output" || p.type === "tool_search_output") lastIn = Math.max(lastIn, at); // 工具的结果回去了：它又要想了
      if (p.type === "function_call_output" || p.type === "custom_tool_call_output" || p.type === "tool_search_output") {
        pendingPolls.delete(p.call_id);
        var pp = byCall[p.call_id];
        if (!pp) return null;
        if (pp.poll) { delete byCall[p.call_id]; return more(pp.poll, p.output, at, pp.chars); }
        if (!pp.nativeCommand) result(pp, p.output);
        if (pp.status === "running" && pp.sess != null) sessOf[pp.sess] = pp;
        if (pp.turn) pp.turn.last = at;
        return pp.turn;
      }
      return null;
    }
    // 记录在哪：列表里有；刷新后第一次打开、列表还没扫到的：先扫一遍
    rt.adopt = function (entry) {
      var changed = info.path !== entry.path, oldEffort = info.reasoningEffort;
      Object.assign(info, entry);
      if (entry.reasoningEffort && entry.reasoningEffort !== oldEffort) emit("config");
      sess.title = agent.name = info.title;
      if (changed) { loading = null; if (subs.length) load(); }
      if (subs.length && !loadingNow) liveBusy();
    };
    async function withPath() {
      if (info.path || info.fresh || (info.listed === false && info.live)) return info.path;
      await scan(true);
      if (threadId(sid) !== sid) rekey(threadId(sid), true);
      var x = byId[sid];
      if (x) {
        Object.assign(info, x);
        sess.title = agent.name = x.title || sess.title;
        agent.model = x.model || agent.model;
        return info.path;
      }
      // An existing tab may refer directly to a child outside the task list.
      var reply = await cxRpc("thread/read", {threadId: sid, includeTurns: false}), t = reply.result?.thread;
      if (!t?.path) throw new Error("找不到 Codex 会话：" + sid);
      var st = await LOC.stat(t.path).catch(() => null);
      var packed = !st && await LOC.stat(t.path + ".zst").catch(() => null);
      info.path = packed ? t.path + ".zst" : t.path;
      sess.title = agent.name = t.name || t.preview?.split("\n", 1)[0] || sess.title;
      return info.path;
    }
    // 跟着读新写进来的：同一时间只有一次在读（两次从同一个位置读，同一段会接上两遍）；重读了，之前没回来的读作废（gen）；
    // 按字节找换行，最后没写完的半行不要（offset 停在它前面，下次连着读）——同 claude.js
    var gen = 0, loadingNow = false, pollBusy = false, pollAgain = false;
    function linesOf(buf, dropHead) {
      var u8 = new Uint8Array(buf), a = 0;
      if (dropHead) { var i = u8.indexOf(10); a = i < 0 ? u8.length : i + 1; }
      var j = u8.lastIndexOf(10), end = j + 1 > a ? j + 1 : a;
      return { end: end, lines: end > a ? dec(u8.subarray(a, end)).split("\n") : [] };
    }
    async function readPage(end, firstBytes = TAIL) {
      var cursor = end, suffix = new Uint8Array(0), groups = [], consumed = end;
      do {
        var start = Math.max(0, cursor - (cursor === end ? firstBytes : TAIL));
        var block = new Uint8Array(await LOC.read(info.path, { offset: start, max: cursor - start }));
        if (block.length !== cursor - start) throw new Error("Codex 历史记录传输不完整");
        var bytes = new Uint8Array(block.length + suffix.length);
        bytes.set(block); bytes.set(suffix, block.length);
        var first = start ? bytes.indexOf(10) + 1 : 0;
        if (!start || first) {
          var last = bytes.lastIndexOf(10) + 1;
          if (cursor === end || !groups.length) consumed = start + last;
          var lines = dec(bytes.subarray(first, last)).split("\n");
          var boundary = start ? lines.findIndex(function (line) {
            if (!line.includes('"task_started"')) return false;
            try { var j = JSON.parse(line); return j.type === "event_msg" && j.payload.type === "task_started"; } catch (_) { return false; }
          }) : 0;
          if (boundary >= 0) {
            var skip = boundary ? new TextEncoder().encode(lines.slice(0, boundary).join("\n") + "\n").length : 0;
            groups.unshift(lines.slice(boundary));
            return { start: start + first + skip, end: consumed, lines: groups.flat() };
          }
          groups.unshift(lines);
        }
        suffix = first ? bytes.slice(0, first) : bytes;
        cursor = start;
      } while (cursor);
    }
    async function openPage(st) {
      var key = LOC.hostKey("cx-history:" + (window.TSU_UID || 0) + ":" + info.path);
      var [meta, cached] = await LOC.cachedHistory(key).catch(() => []);
      if (cached && meta.size === st.size && meta.mtime === st.mtime) return cached;
      var page;
      if (cached && st.size > meta.size && st.size - cached.end <= TAIL && meta.tail) {
        var tail = new TextEncoder().encode(meta.tail);
        var check = new Uint8Array(await LOC.read(info.path, {offset: cached.end - tail.length, max: tail.length}));
        if (check.length === tail.length && check.every((byte, i) => byte === tail[i])) {
          var suffix = linesOf(await LOC.read(info.path, {offset:cached.end, max:st.size - cached.end}), false);
          page = {start:cached.start, end:cached.end + suffix.end, lines:cached.lines.concat(suffix.lines)};
        }
      }
      if (!page) page = await readPage(st.size, 256 << 10);
      if (page.end - page.start <= 2 * TAIL) {
        var last = page.lines.findLast(line => line.length);
        var tail = last ? Array.from(last.slice(-256)).slice(1).join("") + "\n" : "";
        LOC.cacheHistory(key, {size:st.size, mtime:st.mtime, tail}, [page], 0).catch(() => {});
      }
      return page;
    }
    function load() {
      var g = ++gen;
      loadingNow = true;
      rt.historyProgress = -1; emit("historyProgress");
      loading = withPath().then(async function (pth) {
        if (g !== gen) return;
        if (!pth) { rt.tabLightReady = !!(info.fresh || info.live); emit("reset"); emit("status"); return; }
        if (pth.endsWith(".zst")) {
          var latest = await listTurns(null, 4, "full");
          if (g !== gen) return;
          var rows = latest.data.reverse().flatMap(historyTurn);
          turns.length = 0;
          turns.push(...rows);
          restorePromptOrder();
          historyStart = 0; parentCursor = latest.nextCursor; inherited = !!parentCursor;
          offset = 0; cur = null; running = null; liveBusy(); rt.tabLightReady = true;
          emit("reset"); emit("status");
          return;
        }
        var st = await LOC.stat(pth);
        if (g !== gen) return;
        if (!st) throw new Error("会话记录不存在");
        return openPage(st).then(function (page) {
          if (g !== gen) return;
          pendingPolls.clear(); compactSince = compactEnd = 0; turns.length = 0; cur = null; byCall = {}; sessOf = {}; running = null; runAt = 0;
          historyStart = page.start; inherited = false; parentCursor = undefined; firstRawTurn = null;
          startOfSegment(page);
          page.lines.forEach(feedLine);
          offset = page.end;
          sess.updated = st.mtime;
          turns.forEach(function (t) { if (t !== cur || !running) settle(t); });
          liveBusy(); rt.tabLightReady = true;
          emit("reset"); emit("status");
        });
      }).catch(function (e) { if (g !== gen) return; turns.length = 0; if (!info.fresh) turns.push({ note: tr("无法读取会话：" + e.message), at: 0 }); emit("reset"); })
        .then(function () { if (g === gen) { loadingNow = false; if (!readingHistory) { rt.historyProgress = null; emit("historyProgress"); } } });
      return loading;
    }
    var goalReadAt = 0, readingGoal = false;
    function syncGoal() {
      if (readingGoal || Date.now() - goalReadAt < 4000 || !/^[a-f0-9-]{36}$/i.test(sid)) return;
      readingGoal = true;
      goalReadAt = Date.now();
      var id = sid;
      cxRpc("thread/goal/get", { threadId: id }).then(function (reply) {
        if (id !== sid || !reply.result || !("goal" in reply.result)) return;
        var g = reply.result.goal;
        var next = g && g.status === "active" ? { text: g.objective, at: g.createdAt * 1000, checking: false, iterations: 0 } : null;
        if (JSON.stringify(next) === JSON.stringify(agent.goal)) return;
        agent.goal = next;
        emit("config");
        emit("status");
      }).finally(function () { readingGoal = false; });
    }
    function poll() {
      if (!quotaRequest && Date.now() - quotaReadAt >= 60000) readAccountQuota();
      syncGoal();
      syncQueue();
      if (!info.path || info.path.endsWith(".zst") || loadingNow) return;
      if (pollBusy) { pollAgain = true; return; }
      pollBusy = true;
      var g = gen;
      LOC.stat(info.path).then(function (st) {
        if (g !== gen || !st) return;
        if (st.size < offset) return load(); // 文件变短了（被改写）：重建
        if (st.size <= offset) { liveBusy(); return; } // 没新写的：在不在跑也要重新看（Codex 退出了、一问停在半截，转圈要停）
        return LOC.read(info.path, { offset: offset, max: Math.min(st.size - offset, TAIL) }).then(function (buf) {
          if (g !== gen) return;
          var r = linesOf(buf, false);
          if (!r.end) { if (buf.byteLength >= TAIL) offset += buf.byteLength; return; }
          offset += r.end;
          var before = turns.length, touched = new Set();
          r.lines.forEach(function (l) { var t = feedLine(l); if (t) touched.add(t); });
          sess.updated = st.mtime;
          turns.slice(before).forEach(function (t) { touched.delete(t); emit("append", t); });
          touched.forEach(function (t) { emit("turn", t); });
          emit("status");
          liveBusy();
        });
      }).catch(function () {}).then(function () { pollBusy = false; if (pollAgain) { pollAgain = false; setTimeout(poll, 0); } });
    }
    // 在跑时读得勤（120ms）、闲着读得慢（700ms）——streaming 时才是一行一行地出来，不是 700ms 一整块（用户 2026-10-30：「block 一个 block 返回」）
    function start() { if (busy) tickOn(); if (!loading) load(); clearTimeout(pollT); pollT = 0; var loop = function () { pollT = setTimeout(function () { loop(); }, busy ? 120 : 700); poll(); }; loop(); }
    function stop() { clearTimeout(pollT); pollT = 0; clearInterval(ticker); ticker = 0; }

    // ---- 在跑吗：自己起的进程；或者记录里有一问开了头还没结束、文件刚写过（在 Codex 里跑着）----
    var turnEndedAt = 0;
    var busy = false, proc = null, outBuf = "", sentAt = 0, sendingCount = 0, dispatch = Promise.resolve();
    // 转圈那一行指着的一问：正在跑的那一问（记录里开了头、还没做完）；刚说完、记录里还没有新的一问：先空着（读到新的一问时 newTurn 换上）——
    //   不指着上一问（答完了的）：它会被当成还在跑（少了「Worked for」那一行，最后一段话只画到换行为止）
    //   从几点算：在 Codex 那边跑着的，从它开始那一刻（task_started）；这边刚说的，从现在
    // 在跑时每 120ms 一个 tick：转圈那一行的雪花照样转（同 Claude Code 的会话；原来只在有新事件时才画一次，停在「·」不动）
    var ticker = 0;
    function tickOn() { if (ticker || !subs.length) return; ticker = setInterval(function () { if (!busy) { clearInterval(ticker); ticker = 0; return; } if (document.hidden) return; emit("tick"); }, 120); } // 看不见时不转（同 claude.js）
    function setBusy(v) {
      if (v === busy) {
        if (v && rt.stream && running && cur && !cur.stats) rt.stream.turn = cur;
        return;
      }
      busy = v;
      if (v) tickOn();
      if (v) rt.stream = { t0: running && runAt ? runAt : Date.now(), turn: cur && running && !cur.stats ? cur : { parts: [] }, outTokens: 0, thinking: false, firstAt: Date.now(), verb: "Working", specialStatus: phase(), phaseAt: compactSince || pendingPolls.values().next().value || 0, answer: "", ctl: { abort: function () {} } };
      else { rt.stream = null; clearInterval(ticker); ticker = 0; if (cur) { settle(cur); emit("turn", cur); } }
      emit("status"); emit("state");
      if (!historyOnly) document.dispatchEvent(new Event("tsu-cx"));
    }
    // 在跑：这边起的 codex exec 还没退；或者记录里一问开了头还没结束，而且它正开在 Codex 里（守护进程载入着）或者文件一分钟内写过（没开着又停在半截的：Codex 退出了，不一直转）；
    //   刚排进 Codex 的（codex queue）：它开始写之前的十秒也算
    var statusCheckAt = 0, checkingStatus = false;
    function liveBusy() {
      checkCompact();
      if (rt.stream) { rt.stream.specialStatus = phase(); rt.stream.phaseAt = compactSince || pendingPolls.values().next().value || 0; }
      if (proc && proc.alive()) return;
      var now = Date.now(), recent = now - (sess.updated || 0) < 60000;
      var catalogBusy = info.live?.status === "busy" && info.live.sampledAt > turnEndedAt && now - info.live.sampledAt < 30000;
      setBusy(catalogBusy || sendingCount > 0 || !!running && (recent || live() && busy) || now - sentAt < 10000);
      if (!running || recent || checkingStatus || now < statusCheckAt || !live()) return;
      var turnId = running, seen = sess.updated;
      checkingStatus = true;
      statusCheckAt = now + 10000;
      cxRpc("thread/read", { threadId: sid, includeTurns: false }).then(function (reply) {
        checkingStatus = false;
        if (sendingCount || turnId !== running || seen !== sess.updated || proc && proc.alive()) return;
        var thread = reply && reply.result && reply.result.thread;
        var active = thread && thread.status && thread.status.type === "active";
        if (!thread) return;
        if (!active) running = null;
        setBusy(!!active);
      });
    }
    var live = function () { var x = byId[sid]; return !!(x && x.live); };
    rt.elsewhere = function () { return live() && !(proc && proc.alive()); };
    rt.canInject = function () { return true; };
    rt.hint = function () { return ""; }; // 能说话就不写提示（输入框就是普通的输入框）
    // 新会话（TSU_CONNECTORS.newSession）：Codex 不让事先定 id——第一句用 codex exec 建出来，它一开头报 thread.started（会话 id），
    // 这时把这个运行时也登记到 cx:<真 id> 下，开着它的标签页换成看真 id（布局记住的就是真的），再找它的记录文件接着读
    function rekey(real, historicalAlias) {
      real = String(real || "").toLowerCase();
      if (!real || real === sid) return;
      var old = "cx:" + sid, nu = "cx:" + real;
      if (!historicalAlias) newKeep(sid, { real: real });
      if (window.TSU_VERIFICATION_RUN && !historicalAlias && sid.startsWith("new-") && /^[a-f0-9-]{36}$/.test(real)) {
        var directory = shq(LOC.info().home + "/Library/Application Support/Vibing Studio/verification-sessions");
        LOC.exec({cmd: 'mkdir -p ' + directory + ' && touch ' + directory + '/cx-' + real}).catch(console.error);
      }
      if (modelSel) cxModelKeep(real, modelSel);
      if (effortSel) info.reasoningEffort = effortSel;
      var previousKey = pendingKey; pendingKey = "tsu-cx-awaiting-log:" + real; savePending();
      try { sessionStorage.removeItem(previousKey); } catch (e) {}
      sid = real; sess.id = agent.current = real; agent.id = nu; rt.sid = real;
      rts[nu] = rt; A.registerExternal(nu, rt);
      if (window.TSU_TERM && TSU_TERM.panes) TSU_TERM.panes().forEach(function (p) { if (p.program && p.program.agentId === old) p.run(TSU_TERM.makeView(p, nu), true); });
      if (historicalAlias) return;
      var tries = 0, look = function () {
        scan(true).then(function () {
          var x = byId[real];
          if (!x) { if (++tries < 15) setTimeout(look, 1500); return; }
          Object.assign(info, x); info.fresh = false; sess.title = agent.name = x.title || sess.title;
          load(); emit("config");
        });
      };
      setTimeout(look, 600);
    }
    // 模型：真在用的是记录里最近一次 turn_context 的；这边选的（-m，下一句起）记在这台设备上。可选的：默认设置里的 + 这台 Mac 上的会话用过的
    var modelSel = cxModels()[sid] || "";
    rt.model = function () { var real = agent.model || "", pending = !!modelSel && !!real && modelSel !== real, id = pending ? modelSel : real || modelSel; return { id: id, name: pending ? tr(cxName(id) + " · 下一句起") : cxName(id) || "Codex", window: sess.window || 272000, pending: pending }; };
    // 可选的模型：Codex 自己的目录（app-server 的 model/list：GPT-6 Astra、GPT-5.6 Sol……同 Codex App 的选择器，名字、默认的那个都照它）；
    //   读不到（守护进程没在跑）才退回：默认设置里的 + 这台 Mac 上的会话用过的
    rt.prepareChoices = async function () {
      var read = !sid.startsWith("new-") && cxRpc("thread/read", {threadId:sid, includeTurns:false});
      var [, reply] = await Promise.all([cxCatalog(), read]);
      var thread = reply?.result?.thread;
      if (thread?.model) agent.model = info.model = thread.model;
      if (thread?.reasoningEffort) info.reasoningEffort = thread.reasoningEffort;
    };
    cxCatalog().then(() => emit("config")).catch(() => {});
    rt.models = function () {
      var cat = CXCAT.list, ids = [], add = function (x) { if (x && ids.indexOf(x) < 0) ids.push(x); };
      if (cat && cat.length) { var out = cat.map(function (m) { return { id: m.id, name: m.name, desc: m.desc, def: m.def }; }); [agent.model, modelSel].forEach(function (x) { if (x && !out.some(function (m) { return m.id === x; })) out.push({ id: x, name: cxName(x), desc: "", more: true }); }); return out; }
      add(CXDEF.model); add(agent.model); add(modelSel); LIST.forEach(function (x) { add(x.model); }); return ids.map(function (id) { return { id: id, name: cxName(id), desc: "" }; });
    };
    rt.setModel = function (id) {
      id = String(id || "").trim();
      if (!id) return false;
      var profile = cxProfile(id);
      if (profile && effortSel && !profile.efforts.includes(effortSel)) {
        effortSel = ""; cxEffortKeep(sid, "");
      }
      modelSel = id; cxModelKeep(sid, id);
      emit("config"); emit("status");
      return true;
    };
    var effortSel = sid.startsWith("new-") ? cxEfforts()[sid] || "" : "";
    rt.efforts = () => cxLevels(rt.model().id);
    rt.currentEffort = function () {
      var profile = cxProfile(rt.model().id);
      var level = effortSel || info.reasoningEffort || agent.effort || CXDEF.effort;
      return profile && !profile.efforts.includes(level) ? profile.defaultEffort : level || "";
    };
    rt.setEffort = function (v) {
      v = String(v || "").toLowerCase().trim();
      if (!rt.efforts().includes(v)) return false;
      if (sid.startsWith("new-")) {
        effortSel = agent.effort = v; cxEffortKeep(sid, v);
        emit("config"); emit("status");
        return true;
      }
      var params = {threadId:sid, effort:v, model:modelSel || undefined};
      var update = dispatch.then(async function () {
        var reply = await sendRpc(() => cxRpc("thread/settings/update", params));
        if (/thread not found|not loaded|no active worker/i.test(reply.error?.message || "")) {
          reply = await cxSeq([["thread/resume", {threadId:sid, excludeTurns:true}], ["thread/settings/update", params]]);
        }
        if (!reply.result) throw new Error(reply.error?.message || "Codex 未确认推理强度");
        effortSel = ""; info.reasoningEffort = agent.effort = v;
        cxEffortKeep(sid, ""); emit("config"); emit("status");
        return true;
      });
      dispatch = update.catch(() => {});
      return update;
    };
    // 发话时带上这边选的模型、推理强度（下一句起）；附的图（[Image: "…"]，见 rt.send）→ --image=路径，话里去掉
    function runOpts() { var o = []; if (modelSel) o.push("-m", modelSel); var level = rt.currentEffort(); if (level) o.push("-c", "model_reasoning_effort=" + level); return o; }
    function takeShots(text) { var ims = []; text = String(text || "").replace(/\[Image: "([^"\n]+)"\] ?/g, function (all, p) { ims.push("--image=" + p); return ""; }).trim(); return { text: text, args: ims }; }
    rt.agentName = function () { return ""; };
    function runExec(text) {
      outBuf = "";
      var mk = info.fresh && !info.path && /^new-/.test(sid), mm = runOpts(), sh = takeShots(text);
      text = sh.text;
      var argv = mk ? ["codex", "exec"].concat(sh.args, ["--json", "--skip-git-repo-check", "-C", info.cwd || home()], mm, [text]) : ["codex", "exec", "resume", sid].concat(sh.args, mm, ["--json", "--skip-git-repo-check", text]);
      var mine = proc = LOC.proc({ argv: argv, cwd: info.cwd || "" }, function (s, isErr) {
        if (isErr) { if (/\berror\b/i.test(s) && !/^\s*(WARN|INFO)/.test(s)) rt.record("codex", s.trim().slice(0, 600)); return; }
        outBuf += s;
        var ls = outBuf.split("\n");
        outBuf = ls.pop();
        ls.forEach(function (l) {
          var j; try { j = JSON.parse(l); } catch (e) { return; }
          var tid = j.type === "thread.started" ? j.thread_id : j.msg && j.msg.type === "session_configured" ? j.msg.session_id : "";
          if (tid && mk) rekey(tid);
          var em = j.type === "error" ? j.message : j.type === "turn.failed" ? j.error && j.error.message : j.msg && j.msg.type === "error" ? j.msg.message : null;
          if (em !== null && em !== undefined) rt.record("codex", String(em || "error").slice(0, 600));
        });
      }, function (code) {
        if (proc !== mine && proc) return; // 已经又起了一个（这一个是被打断的）：不动它
        proc = null; setBusy(false); poll();
        if (code && code !== 143 && code !== 130) rt.record("codex", "Codex 已退出（" + code + "）");
        if (rt.queued) { var q = rt.queued; rt.queued = null; emit("status"); setTimeout(function () { rt.send(q.text); }, 300); } // 排着的（几句拼成的一条）一次发出去
      });
      eof(proc);
      setBusy(true);
      setTimeout(poll, 400);
    }
    // codex exec 的 stdin 是接着的管道时会一直读到头（把读到的接在话后面）：起来就关掉 stdin，不然它一直等着
    function eof(p) { if (p && p.close && p.started) p.started.then(function () { p.close(); }, function () {}); }
    // 排进正开在 Codex 里的会话（官方的 codex queue：守护进程收下，它闲着马上开始、忙着排在后面）
    function queueIn(text, steerTurn, entry) {
      sentAt = Date.now(); liveBusy();
      var sh = takeShots(text);
      if (steerTurn) {
        var waiting = entry;
        if (waiting) { waiting.steerTurn = steerTurn; savePending(); emit("status"); }
      }
      var input = sh.args.map(function (arg) { return {type: "localImage", path: arg.slice("--image=".length)}; });
      if (sh.text) input.push({type: "text", text: sh.text});
      var clientId = entry?.key || crypto.randomUUID();
      var request = () => steerTurn
        ? cxRpc("turn/steer", {threadId: sid, expectedTurnId: steerTurn, clientUserMessageId: clientId, input: input})
        : cxSeq([["thread/resume", {threadId: sid, excludeTurns: true}], ["thread/queue/add", {threadId: sid, clientUserMessageId: clientId, input: input}]]);
      return sendRpc(request).then(function (reply) {
        if (steerTurn && reply && reply.error && /no active turn|turn (?:has |already )?(?:ended|completed)|expected.*turn.*(?:mismatch|got)|no turn in progress/i.test(reply.error.message || "")) {
          return startTurn(text);
        }
        if (steerTurn && /thread not found|no active worker/i.test(String(reply?.error?.message || ""))) return startTurn(text);
        if (!reply || reply.result == null) throw new Error(String(reply && reply.error && (reply.error.message || reply.error) || "无响应"));
        setTimeout(poll, 600);
      });
    }
    async function sendToLoadedTurn(text, fallbackTurn, entry) {
      if (fallbackTurn && fallbackTurn !== "?") return queueIn(text, fallbackTurn, entry);
      var statusReply = await cxRpc("thread/read", {threadId: sid, includeTurns: false});
      var state = statusReply?.result?.thread?.status?.type;
      if (state === "idle" || state === "notLoaded") return startTurn(text);
      var reply = await cxRpc("thread/turns/list", { threadId: sid, limit: 1, sortDirection: "desc" });
      var turns = reply && reply.result && reply.result.data;
      if (!Array.isArray(turns)) {
        return startTurn(text);
      }
      var latest = turns[0];
      if (latest && latest.status === "inProgress") return queueIn(text, latest.id, entry);
      return startTurn(text);
    }
    async function startTurn(text, fresh) {
        var sh = takeShots(text), input = sh.args.map(arg => ({type: "localImage", path: arg.slice(8)}));
        if (sh.text) input.push({type: "text", text: sh.text});
        var params = {threadId: sid, input: input, model: modelSel || undefined, effort: rt.currentEffort() || undefined};
        var started = await sendRpc(() => fresh ? cxRpc("turn/start", params) : cxSeq([["thread/resume", {threadId: sid, excludeTurns: true}], ["turn/start", params]]));
        if (started.result?.turn?.id) { effortSel = ""; running = started.result.turn.id; sentAt = runAt = Date.now(); setBusy(true); }
        if (!started.result?.turn?.id) throw new Error(String(started.error?.message || started.error || "Codex 未确认发送"));
        setTimeout(poll, 400);
    }
    rt.send = function (text, imgs, options) {
      text = String(text || "").trim();
      imgs = (imgs || []).filter(function (x) { return x && (x.data || x.path); });
      if (!text && !imgs.length) return false;
      var sh = takeShots(text);
      var entry = {key: crypto.randomUUID(), paths: sh.args.map(arg => arg.slice(8)), text: sh.text, at: Date.now(), q: !!options?.queue, waitingDispatch: true };
      if (imgs.length) Object.defineProperty(entry, "previewImages", {value:imgs, configurable:true});
      sentWait.push(entry);
      sendingCount++;
      setBusy(true);
      savePending(); emit("status");
      dispatch = dispatch.then(async function () {
        if (imgs.length) {
          try { entry.paths = await saveShots(imgs); }
          catch (error) {
            var index = sentWait.indexOf(entry);
            if (index >= 0) sentWait.splice(index, 1);
            savePending();
            emit("edit", {text, images:imgs});
            rt.record("Codex", "图片发送失败：" + error.message);
            return;
          }
          text = entry.paths.map(path => '[Image: "' + path + '"]').concat(text || []).join(" ");
          savePending();
        }
        entry.waitingDispatch = false;
        savePending(); emit("status");
        if (sid.startsWith("new-")) {
          var created = await sendRpc(() => cxRpc("thread/start", {cwd: info.cwd || home(), model: modelSel || undefined}));
          if (!created.result?.thread?.id) throw new Error(created.error?.message || "Codex 未创建会话");
          rekey(created.result.thread.id);
          await startTurn(text, true);
        } else if (options?.queue) {
          await queueIn(text, null, entry);
        } else {
          await sendToLoadedTurn(text, running, entry);
        }
      }).catch(function (err) {
        sentAt = 0;
        storeFailure(entry, /server is draining/i.test(err.message) ? "Codex 在重启期间未接收此消息" : err.message);
      }).finally(function () { sendingCount--; liveBusy(); });
      return true;
    };
    // 打断：这边起的 codex exec 停掉它；正开在 Codex 里、正在跑的一问：请守护进程停下这一问（turn/interrupt，同在 Codex 里按 Esc）
    rt.interrupt = function () {
      if (proc && proc.alive()) { proc.kill(); return true; }
      if (!running || running === "?") return false;
      var tid = running;
      cxRpc("turn/interrupt", { threadId: sid, turnId: tid }).then(function (j) {
        if (j && j.error) rt.record("Esc", "没能打断 Codex：" + String(j.error.message || j.error).slice(0, 200));
        setTimeout(poll, 400);
        if (rt.queued) { var q = rt.queued; rt.queued = null; emit("status"); queueIn(q.text); } // ctrl+enter 排着的：停下来以后排进去
      });
      return true;
    };
    // 权限模式 Codex 没有 Shift+Tab 这一套
    rt.canInterrupt = function () { return !!(proc && proc.alive()) || !!(running && running !== "?"); };
    // ---- / 命令：Codex 自己的命令这边做（问它的 app-server 守护进程 / 在这台 Mac 上跑），不当话发给模型——
    //   以前原样发过去：「/effort max」「/rename xx」模型当成一句话来答，命令一个都不生效。回 false：不是命令（交回去当话发）
    rt.command = function (line) {
      var m = /^\/(\S+)\s*([\s\S]*)$/.exec(String(line || "").trim());
      if (!m) return false;
      var c = m[1].toLowerCase(), arg = m[2].trim(), made = !/^new-/.test(sid), say = function (res) { rt.record(line, res); };
      var needThread = function () { if (made) return true; say("先说一句建出这段会话，再用 /" + c); return false; };
      var fail = function (j) { var e = j && j.error; e = e && e.message || e || "no reply"; say(e === "noconn" ? "Codex 的守护进程没在跑（打开 Codex app 或终端里的 codex 以后再试）" : "Codex 没做成：" + String(e).slice(0, 300)); };
      var cwd = info.cwd || home();
      switch (c) {
        case "effort":
          rt.prepareChoices().then(async function () {
            if (!arg) return say("Reasoning effort: " + rt.currentEffort() + " · options: " + rt.efforts().join(" / "));
            if (!await rt.setEffort(arg)) return say("Effort must be one of: " + rt.efforts().join(", "));
            say("Set reasoning effort to " + rt.currentEffort());
          }).catch(err => say(err.message));
          return true;
        case "rename":
          if (!arg) { say("Usage: /rename <name>"); return true; }
          if (!needThread()) return true;
          cxRpc("thread/name/set", { threadId: sid, name: arg }).then(function (j) {
            if (!j || j.result === undefined) return fail(j);
            sess.title = agent.name = arg; if (byId[sid]) byId[sid].title = arg;
            emit("config"); say("Renamed to " + arg);
          });
          return true;
        case "compact":
          if (!needThread()) return true;
          if (busy) { say("Codex 正在答：等这一问答完再压缩"); return true; }
          say("Compacting conversation…");
          // 正开在 Codex 里的：直接压；没开着的：先在守护进程里载入（thread/resume）再压，等它压完（thread/compacted）
          (live() ? cxRpc("thread/compact/start", { threadId: sid }) : cxSeq([["thread/resume", { threadId: sid, excludeTurns: true }], ["thread/compact/start", { threadId: sid }]], '"method":"(thread/compacted|turn/completed)"', 300)).then(function (j) {
            if (!j || j.result === undefined) return fail(j);
            say("Compacted"); setTimeout(poll, 600);
          });
          return true;
        case "goal":
          if (!needThread()) return true;
          if (!arg) { say(agent.goal ? "Goal: " + agent.goal.text : "No goal set · /goal <objective> to set one, /goal clear to clear"); return true; }
          if (/^(clear|off|stop|cancel|none)$/i.test(arg)) { cxRpc("thread/goal/clear", { threadId: sid }).then(function (j) { if (!j || j.result === undefined) return fail(j); agent.goal = null; emit("config"); say("Goal cleared"); }); return true; }
          cxRpc("thread/goal/set", { threadId: sid, objective: arg, status: "active" }).then(function (j) { if (!j || j.result === undefined) return fail(j); agent.goal = { text: arg, at: Date.now(), checking: false, iterations: 0 }; emit("config"); say("Goal set: " + arg); });
          return true;
        case "review":
          if (!needThread()) return true;
          var tgt = !arg ? { type: "uncommittedChanges" } : /^base\s+(\S+)$/i.exec(arg) ? { type: "baseBranch", branch: /^base\s+(\S+)$/i.exec(arg)[1] } : /^[0-9a-f]{7,40}$/i.test(arg) ? { type: "commit", sha: arg } : { type: "custom", instructions: arg };
          (live() ? cxRpc("review/start", { threadId: sid, target: tgt }) : cxSeq([["thread/resume", { threadId: sid, excludeTurns: true }], ["review/start", { threadId: sid, target: tgt }]], '"method":"turn/completed"', 900)).then(function (j) { if (!j || j.result === undefined) return fail(j); setTimeout(poll, 600); });
          say("Reviewing " + (tgt.type === "uncommittedChanges" ? "uncommitted changes" : tgt.type === "baseBranch" ? "changes against " + tgt.branch : tgt.type === "commit" ? "commit " + tgt.sha : "with your instructions") + "…");
          return true;
        case "fork":
          if (!needThread()) return true;
          cxRpc("thread/fork", { threadId: sid }).then(function (j) {
            var t = j && j.result && (j.result.thread || j.result), nid = t && (t.id || t.threadId);
            if (!nid) return fail(j);
            say("Forked into a new thread (" + String(nid).slice(0, 8) + ")");
            scan(true).then(function () { if (window.TSU_TERM && TSU_TERM.agent) TSU_TERM.agent("cx:" + String(nid).toLowerCase()); });
          });
          return true;
        case "new": case "clear":
          newSession(cwd); return true;
        case "init":
          rt.send(CX_INIT); return true;
        case "diff":
          LOC.exec({ cmd: "cd " + shq(cwd) + " && git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo '(not a git repository)'; exit 0; }; git status --short | head -60; echo; git --no-pager diff --stat | tail -40" }).then(function (r) { say(String(r && r.out || "").trim().slice(0, 6000) || "No changes"); }, function (e) { say(String(e && e.message || e)); });
          return true;
        case "status":
          readAccountQuota().then(function (snapshot) {
            var rl = snapshot?.rl, windows = rt.quotaBuckets();
            var ctx = rt.ctx(), lines = [
              "Model: " + (rt.model().id || CXDEF.model || "default") + (effortSel ? " (reasoning " + effortSel + ")" : ""),
              "Directory: " + cwd.replace(home(), "~"),
              "Session: " + (made ? sid : "not started yet") + (live() ? " · open in Codex" : ""),
              "Context: " + (ctx.tokens ? Math.round(ctx.pct) + "% used (" + Math.round(ctx.tokens / 1000) + "k / " + Math.round(ctx.window / 1000) + "k)" : "—"),
              windows.length ? "Limits: " + windows.map(w => w.name + " " + Math.round(100 - w.remaining * 100) + "% used").join(" · ") + (rl.plan_type ? " · " + rl.plan_type : "") : ""
            ];
            say(lines.filter(Boolean).join("\n"));
          });
          return true;
        case "mcp":
          cxRpc("mcpServerStatus/list", {}).then(function (j) {
            var d = j && j.result && j.result.data;
            if (!d) return fail(j);
            say(d.length ? d.map(function (x) { return "• " + x.name + ((x.tools && x.tools.length) ? " (" + x.tools.length + " tools)" : ""); }).join("\n") : "No MCP servers configured");
          });
          return true;
        case "exit": case "quit":
          return false; // 交回去（关掉这个视图）
      }
      // 自己的提示词（~/.codex/prompts/名字.md → /prompts:名字）：读出来当话发（$ARGUMENTS 换成后面的参数）
      if (/^prompts:/.test(c)) {
        LOC.read(home() + "/.codex/prompts/" + c.slice(8) + ".md").then(function (b) {
          var t = dec(b).replace(/^---[\s\S]*?\n---\n/, "").replace(/\$ARGUMENTS/g, arg).trim();
          if (t) rt.send(t); else say("Empty prompt");
        }, function () { say("No such prompt: ~/.codex/prompts/" + c.slice(8) + ".md"); });
        return true;
      }
      say("Unrecognized command '/" + c + "'. Type \"/\" for a list of supported commands.");
      return true;
    };
    rt.canCycle = function () { return false; };
    rt.footerFields = function () {
      var bits = [];
      if (sess.window && sess.ctx) {
        // Codex rounds the remaining fraction after reserving its 12k baseline.
        var usable = sess.window - 12000;
        var remaining = usable > 0 ? Math.max(0, usable - Math.max(0, sess.ctx - 12000)) / usable : 0;
        bits.push("Context " + (100 - Math.round(remaining * 100)) + "% used");
      }
      var quota = rt.quotaLabel();
      if (quota) bits.push(quota);
      return bits.concat([rt.model().name, rt.currentEffort()]).filter(Boolean);
    };
    rt.quotaBuckets = function () { return currentLimits()?.buckets || []; };
    rt.quotaLabel = function () {
      var buckets = rt.quotaBuckets(), main = buckets.find(w => w.name === "weekly") || buckets[0];
      return main ? main.name + " " + Math.round(main.remaining * 100) + "% left" : "";
    };
    rt.limits = currentLimits;
    // ← 那一块：这台 Mac 上的 Codex 会话——正开在 Codex 里的算「在干活」（刚写过）/「等你回复」，其余最近的 15 个是「已完成」；最前面是现在这个
    rt.island = function () {
      var me = { id: sid, name: "current session", current: true, st: busy ? "working" : "needs", at: Date.now(), cwd: info.cwd || "", title: info.title || "", right: info.fresh && !info.path ? "send a prompt to start" : busy ? "working" : clip(info.last || "send a prompt to continue", 200) };
      var needs = busy ? [] : [me], working = busy ? [me] : [], done = [];
      LIST.forEach(function (x) {
        if (x.id === sid || x.archived) return;
        var it = { id: x.id, name: x.title, cwd: x.cwd || "", at: x.mtime || 0, st: x.live ? x.live.status : "done", right: clip(x.last || "", 200) };
        if (x.live && x.live.status === "busy") working.push(it); else if (x.live) { it.term = true; it.right = "Open in Codex · continue it there"; needs.push(it); } else if (done.length < 15) done.push(it);
      });
      return Promise.resolve({ groups: [{ title: "Needs input", items: needs }, { title: "Working", items: working }, { title: "Completed", items: done }].filter(function (g) { return g.items.length; }), running: working.length - (busy ? 1 : 0) });
    };
    if (historyOnly) rt.readHistory = async function (lines, current) {
      let deadline = performance.now() + 4;
      for (const line of lines) {
        feedLine(line);
        if (performance.now() >= deadline) {
          await new Promise(resolve => setTimeout(resolve, 0));
          if (!current()) return;
          deadline = performance.now() + 4;
        }
      }
      turns.forEach(settle);
    };
  }

  // /init（同 Codex 的 prompt_for_init_command.md）
  var CX_INIT = "Generate a file named AGENTS.md that serves as a contributor guide for this repository.\nYour goal is to produce a clear, concise, and well-structured document with descriptive headings and actionable explanations for each section.\nFollow the outline below, but adapt as needed — add sections if relevant, and omit those that do not apply to this project.\n\nDocument Requirements\n\n- Title the document \"Repository Guidelines\".\n- Use Markdown headings (#, ##, etc.) for structure.\n- Keep the document concise. 200-400 words is optimal.\n- Keep explanations short, direct, and specific to this repository.\n- Provide examples where helpful (commands, directory paths, naming patterns).\n- Maintain a professional, instructional tone.\n\nRecommended Sections\n\nProject Structure & Module Organization\n- Outline the project structure, including where the source code, tests, and assets are located.\n\nBuild, Test, and Development Commands\n- List key commands for building, testing, and running locally (e.g., npm test, make build).\n- Briefly explain what each command does.\n\nCoding Style & Naming Conventions\n- Specify indentation rules, language-specific style preferences, and naming patterns.\n- Include any formatting or linting tools used.\n\nTesting Guidelines\n- Identify testing frameworks and coverage requirements.\n- State test naming conventions and how to run tests.\n\nCommit & Pull Request Guidelines\n- Summarize commit message conventions found in the project's Git history.\n- Outline pull request requirements (descriptions, linked issues, screenshots, etc.).\n\n(Optional) Add other sections if relevant, such as Security & Configuration Tips, Architecture Overview, or Agent-Specific Instructions.";
  // 每段会话选的模型（-m）；默认模型：~/.codex/config.toml 的 model
  var cxModels = function () { try { return JSON.parse(localStorage.getItem("tsu-cx-model") || "{}") || {}; } catch (e) { return {}; } };
  function cxModelKeep(sid, id) { var m = cxModels(); m[sid] = id; try { localStorage.setItem("tsu-cx-model", JSON.stringify(m)); } catch (e) { /* 满了 */ } }
  // 推理强度（Codex 的 model_reasoning_effort）：同模型，每段会话这边选的，发话时带 -c model_reasoning_effort=…
  var cxEfforts = function () { try { return JSON.parse(localStorage.getItem("tsu-cx-effort") || "{}") || {}; } catch (e) { return {}; } };
  function cxEffortKeep(sid, v) { var m = cxEfforts(); m[sid] = v; try { localStorage.setItem("tsu-cx-effort", JSON.stringify(m)); } catch (e) { /* 满了 */ } }
  var CXDEF = { model: "" };
  (LOC.ready || Promise.resolve()).then(function () { return LOC.read(home() + "/.codex/config.toml"); }).then(function (b) { var cfg = dec(b).split(/^\s*\[/m)[0], m = /^\s*model\s*=\s*"([^"]+)"/m.exec(cfg); if (m) CXDEF.model = m[1]; CXDEF.effort = /^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m.exec(cfg)?.[1]; }, function () {});
  // 新开的会话（new-…，说第一句之前 Codex 还没给 id）：记着目录；说了以后记着它的真 id（刷新后布局里还是 new-… 的，照样找到它）
  var NEWS = "tsu-cx-new";
  var newMap = function () { try { return JSON.parse(localStorage.getItem(NEWS) || "{}") || {}; } catch (e) { return {}; } };
  function newKeep(nid, o) {
    var m = newMap();
    m[nid] = Object.assign(m[nid] || { at: Date.now() }, o);
    Object.keys(m).forEach(function (k) { if (Date.now() - (m[k].at || 0) > 30 * 864e5) delete m[k]; });
    try { localStorage.setItem(NEWS, JSON.stringify(m)); } catch (e) { /* 满了 */ }
  }
  function ensure(sid, info) {
    sid = info?.path && idOf(info.path) || threadId(sid);
    var nw = /^new-/.test(sid) ? newMap()[sid] : null;
    if (nw && nw.real) return ensure(nw.real, info);
    if (nw && !info) info = { cwd: nw.cwd || "", title: tr("新会话"), fresh: true };
    var aid = "cx:" + sid, x = byId[sid] || {};
    if (!rts[aid]) { rts[aid] = new Runtime(aid, Object.assign({}, info, x, {id: sid})); A.registerExternal(aid, rts[aid]); }
    else if (info) rts[aid].adopt(Object.assign({}, info, x));
    return rts[aid];
  }
  // 新会话（TSU_CONNECTORS.newSession("codex", 目录, 第一句?)）：开标签页（用现在的外壳）；第一句 codex exec 在那个目录里建出来
  // opts：{ model, effort }——新会话那张草稿里选的（第一句话起就用：-m、-c model_reasoning_effort=）
  function newSession(cwd, prompt, opts) {
    var nid = "new-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), x = { cwd: cwd, title: tr("新会话"), fresh: true, mtime: Date.now() };
    newKeep(nid, { cwd: cwd });
    var rt = ensure(nid, x), tw = window.TSU_TERM && TSU_TERM.front ? TSU_TERM.front() : null;
    if (opts && opts.model && rt.setModel) rt.setModel(opts.model);
    var p = tw && tw.side && tw.side.viewCX ? tw.side.viewCX(nid, x) : null;
    if (opts?.effort) {
      rt.prepareChoices().then(function () {
        if (!rt.setEffort(opts.effort)) throw new Error("当前模型不支持 " + opts.effort);
        if (prompt) rt.send(prompt);
      }).catch(function (err) {
        if (prompt) rt.fire("edit", {text:prompt});
        rt.record("/effort", err.message);
      });
    } else if (prompt) rt.send(prompt);
    return { id: nid, aid: "cx:" + nid, pane: p || null };
  }
  // 刷新后（布局里记着 cx:<会话>）、搜索、侧栏：第一次用到时现建（还没扫到的：先扫一遍再找它的文件）
  A.setExternalResolver(function (aid) { return on() ? ensure(aid.slice(3)) : null; }, "cx");
  var API = {
    // 新会话草稿用：Codex 自己的模型目录（读不到就是默认设置里的、用过的）、推理强度
    modelList: function () { var cat = CXCAT.list; if (cat && cat.length) return cat.map(function (m) { return { id: m.id, name: m.name, def: m.def }; }); var ids = []; [CXDEF.model].concat(LIST.map(function (x) { return x.model; })).forEach(function (x) { if (x && ids.indexOf(x) < 0) ids.push(x); }); return ids.map(function (id) { return { id: id, name: cxName(id), def: id === CXDEF.model }; }); },
    efforts: cxLevels, prepareChoices: cxCatalog, defModel: function () { return CXDEF.model || ""; },
    runningStatus: () => scanError ? "读取 Codex 会话失败 · " + scanError : lastScan ? "无运行中或已打开的会话" : "正在读取会话…",
    status: function () { return scanError ? "读取 Codex 会话失败 · " + scanError : lastScan ? "暂无会话" : "正在读取会话…"; },
    list: function () {
      var rows = LIST.map(x => !x.live && rts["cx:" + x.id]?.state() === "working"
        ? {...x, live: {kind: "codex", status: "busy", since: x.mtime}} : x);
      for (var aid of window.TSU_TERM?.openSessionIds?.() || []) {
        if (!aid.startsWith("cx:")) continue;
        var id = aid.slice(3), rt = rts[aid];
        if (!byId[id] && rt) rows.push({...rt.info, id, title:rt.agent.name, mtime:rt.session().updated || rt.info.mtime || 0});
      }
      return rows;
    }, refresh: scan, ensure: ensure, id: function (sid) { return "cx:" + sid; }, get: function (sid) { return byId[threadId(sid)] || null; }, newSession: newSession,
    // 标签页里记着的 id（可能是 new-…）→ 现在的真 id
    real: function (sid) { var nw = /^new-/.test(sid) ? newMap()[sid] : null; return nw && nw.real || threadId(sid); },
  };
  if (CON && CON.provide) CON.provide("codex", { newSession: newSession });
  window.TSU_CODEX_USAGE = readAccountQuota;
  window.TSU_CODEX = on() ? API : null;
  if (CON) CON.watch(function (id, v) { if (id !== "codex") return; window.TSU_CODEX = v ? API : null; if (v) scan(true); else { LIST = []; document.dispatchEvent(new Event("tsu-cx")); } });
  if (on()) setTimeout(function () { scan(true); }, 1200);
  setInterval(function () { if (on() && !document.hidden) scan(); }, 10000);
})();
