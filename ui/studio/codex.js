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
  function saveShots(imgs) {
    if (!LOC.write) return Promise.resolve([]);
    var dir = home() + "/Library/Application Support/Vibing Studio/shots", stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
    return Promise.all(imgs.map(function (im, i) {
      var ext = /png/.test(im.media_type) ? "png" : /gif/.test(im.media_type) ? "gif" : /webp/.test(im.media_type) ? "webp" : "jpg", p = dir + "/shot-" + stamp + "-cx" + (i + 1) + "." + ext;
      var bin = atob(im.data), u8 = new Uint8Array(bin.length);
      for (var k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
      return LOC.write(p, u8).then(function () { return p; }, function () { return ""; });
    })).then(function (ps) { return ps.filter(Boolean); });
  }
  var on = function () { return !!(CON && CON.on("codex")); };
  var ts = function (s) { var t = Date.parse(s || ""); return isNaN(t) ? Date.now() : t; };
  var dec = function (buf) { return new TextDecoder().decode(new Uint8Array(buf)); };
  var idOf = function (path) { var m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(path || ""); return m ? m[1].toLowerCase() : ""; };
  // 界面上的字（提示、记下的说明、标题）：用 i18n.js 的词典 / 规则翻成现在的语言（中文原样）
  var tr = function (s) { return window.TSU_I18N && TSU_I18N.t ? TSU_I18N.t(s) : s; };
  var clip = function (s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  // 用户消息里 Codex 自己塞进来的（环境、说明、提醒……）：都是 <标签> 开头
  var synthetic = function (t) { return /^\s*<[a-z_][\w-]*[\s>]/i.test(t || "") || /^\s*# AGENTS\.md instructions for /.test(t || ""); }; // 还有它塞进来的 AGENTS.md 说明
  var textOf = function (content) { return (Array.isArray(content) ? content : []).filter(function (b) { return b && (b.type === "input_text" || b.type === "output_text" || b.type === "text"); }).map(function (b) { return b.text || ""; }).join("\n"); };
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
    ' sw(q({"id":1,"method":"initialize","params":{"clientInfo":{"name":"vibing-studio","version":"1"}}}));' +
    ' while (1) { my ($o, $p) = rw(); next unless $o == 1; if ($p =~ /"id":1[,}]/) { sw(q({"method":"initialized"})); sw(qq({"id":2,"method":"$m","params":$pa})); } elsif ($p =~ /"id":2[,}]/) { print $p, "\\n"; exit 0 } }';
  // → { result } / { error }；连不上（守护进程没在跑）→ { error: "noconn" }
  // Codex 的模型目录（model/list）：十分钟问一次；名字照它的 displayName（gpt-6-astra → GPT-6 Astra），没读到就按 id 拼一个像样的
  var CXCAT = { at: 0, list: null };
  function cxCatalog() {
    if (!LOC || !LOC.exec || Date.now() - CXCAT.at < 600000) return;
    CXCAT.at = Date.now();
    cxRpc("model/list", { includeHidden: false }).then(function (j) { var d = j && j.result && j.result.data; if (Array.isArray(d) && d.length) CXCAT.list = d.filter(function (m) { return m && !m.hidden; }).map(function (m) { return { id: m.model || m.id, name: m.displayName || cxName(m.model || m.id), desc: m.description || "", def: !!m.isDefault }; }); }, function () {});
  }
  function cxName(id) {
    var c = CXCAT.list && CXCAT.list.filter(function (m) { return m.id === id; })[0];
    if (c) return c.name;
    return String(id || "").replace(/^gpt-/i, "GPT-").replace(/-([a-z])([a-z]*)$/, function (m, a, b) { return " " + a.toUpperCase() + b; });
  }
  function cxRpc(method, params) {
    return LOC.exec({ cmd: "/usr/bin/perl -e '" + CXRPC_PL + "' \"$HOME/.codex/app-server-control/app-server-control.sock\" " + shq(method) + " " + shq(JSON.stringify(params || {})) }).then(function (r) {
      var m = /\{[^\n]*\}/.exec(String(r && r.out || "")); if (!m) return { error: "noreply" };
      try { return JSON.parse(m[0]); } catch (e) { return { error: "badjson" }; }
    }, function (e) { return { error: String(e && e.message || e) }; });
  }
  // 一连串请求（上一个回了再发下一个，都在同一条连接上：thread/resume 载入以后接着 thread/compact/start）；wait：最后一个回了以后接着等，
  //   等到这样的通知（如 "method":"thread/compacted"）再回（最多 secs 秒）。回最后一个请求的回答
  var CXSEQ_PL = "use IO::Socket::UNIX; use JSON::PP; my ($sp, $cj, $wait, $to) = @ARGV; my @calls = @{ decode_json($cj) }; my $s = IO::Socket::UNIX->new(Peer => $sp) or do { print qq({\"error\":\"noconn\"}\\n); exit 0 }; my $last = qq({\"error\":\"timeout\"}); $SIG{ALRM} = sub { print $last, \"\\n\"; exit 0 }; alarm($to || 8); print $s \"GET / HTTP/1.1\\r\\nHost: localhost\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n\"; $s->flush; my $h = q(); while ($h !~ /\\r\\n\\r\\n/) { sysread($s, my $c, 1) or exit 0; $h .= $c } $h =~ / 101 / or do { print qq({\"error\":\"nows\"}\\n); exit 0 }; sub sw { my $d = shift; utf8::encode($d) if utf8::is_utf8($d); my $l = length $d; my $f = chr(129) . ($l < 126 ? chr(128 | $l) : $l < 65536 ? chr(254) . pack(q(n), $l) : chr(255) . pack(q(Q>), $l)); my @k = map { int rand 256 } 1..4; $f .= pack(q(C4), @k); my $i = 0; $f .= join q(), map { chr(ord($_) ^ $k[$i++ % 4]) } split //, $d; print $s $f; $s->flush } sub rd { my $n = shift; my $b = q(); while (length($b) < $n) { sysread($s, my $c, $n - length $b) or exit 0; $b .= $c } $b } sub rw { my ($a, $b) = unpack(q(C2), rd(2)); my $l = $b & 127; $l = unpack(q(n), rd(2)) if $l == 126; $l = unpack(q(Q>), rd(8)) if $l == 127; return ($a & 15, $l ? rd($l) : q()) } my $js = JSON::PP->new->canonical; my $n = 1; my $waiting = 0; sw(q({\"id\":1,\"method\":\"initialize\",\"params\":{\"clientInfo\":{\"name\":\"vibing-studio\",\"version\":\"1\"}}})); while (1) { my ($o, $p) = rw(); next unless $o == 1;   if ($waiting) { if ($p =~ /$wait/) { print $last, \"\\n\"; exit 0 } next }   next unless $p =~ /\"id\":(\\d+)[,}]/ && $1 == $n;   if ($n == 1) { sw(q({\"method\":\"initialized\"})) } else { $last = $p; if ($p =~ /\"error\"/) { print $p, \"\\n\"; exit 0 } }   if (@calls) { my $c = shift @calls; $n++; sw($js->encode({ id => $n, method => $c->[0], params => $c->[1] })) }   elsif ($wait) { $waiting = 1 } else { print $p, \"\\n\"; exit 0 } }";
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
    var s = code.slice(i + fn.length + 7).replace(/^\s+/, ""), qc = s.charAt(0), out = "";
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
  var LIST = [], byId = {}, names = {}, heads = {}, dayCache = {}, scanning = null, lastScan = 0, loaded = {};
  try { heads = JSON.parse(localStorage.getItem("tsu-cx-heads") || "{}") || {}; } catch (e) { heads = {}; }
  // 上次扫到的列表（这台设备记着）：一载入就有（Agents 树、Agent Finder 马上画），扫完一遍再换成新的；在跑没在跑不记
  try { LIST = (JSON.parse(localStorage.getItem("tsu-cx-list") || "[]") || []).filter(function (x) { return x && x.id; }); LIST.forEach(function (x) { byId[x.id] = x; }); } catch (e) { LIST = []; }
  var keptList = "", keepList = function () {
    try {
      var j = JSON.stringify(LIST.map(function (x) { return { id: x.id, conn: x.conn, path: x.path, size: x.size, mtime: x.mtime, cwd: x.cwd, model: x.model, title: x.title, dimTitle: x.dimTitle, named: x.named, last: String(x.last || "").slice(0, 400), archived: x.archived }; }));
      if (j !== keptList) { keptList = j; localStorage.setItem("tsu-cx-list", j); }
    } catch (e) { /* 满了就不记 */ }
  };
  var saveHeads = function () { try { localStorage.setItem("tsu-cx-heads", JSON.stringify(heads)); } catch (e) { /* 满了就不记 */ } };
  var list = function (p) { return LOC.list(p).catch(function () { return []; }); };
  // 会话名（Codex 里改过名的、它自己起的）：~/.codex/session_index.jsonl
  function readNames() {
    return LOC.read(home() + "/.codex/session_index.jsonl").then(function (b) {
      dec(b).split("\n").forEach(function (l) { try { var j = JSON.parse(l); if (j && j.id && j.thread_name) names[j.id] = j.thread_name; } catch (e) { /* 半行 */ } });
    }, function () {});
  }
  // 正开在 Codex 里的：守护进程载入着的（thread/loaded/list；Codex app、终端里的 codex 打开着，或者它自己正在跑排进去的话）。
  //   以前读的 ~/.codex/app-server-daemon/loaded-threads.json 现在的 Codex 已经不写了——一直当没开着，全都另起 codex exec resume
  //   （同一段会话两个进程一起写）。守护进程没在跑：都没开着；问不到（超时）：上次的不动
  function readLoaded() {
    return cxRpc("thread/loaded/list", {}).then(function (j) {
      if (j && j.result && Array.isArray(j.result.data)) { loaded = {}; j.result.data.forEach(function (id) { loaded[String(id).toLowerCase()] = 1; }); }
      else if (j && j.error === "noconn") loaded = {};
      return loaded;
    });
  }
  // 一个会话文件开头：目录、模型、第一句话（没名字时当标题）。第一行（session_meta）带着整段系统说明，可能几十 KB——不整行解析，用正则在读到的那一段里找
  var unq = function (s) { try { return JSON.parse('"' + s + '"'); } catch (e) { return s; } };
  function headFrom(txt, o) {
    var m;
    if (!o.cwd && (m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(txt))) o.cwd = unq(m[1]);
    if (!o.origin && (m = /"originator":"([^"]*)"/.exec(txt))) o.origin = m[1];
    if (!o.model && (m = /"type":"turn_context"[\s\S]{0,4000}?"model":"([^"]+)"/.exec(txt))) o.model = m[1];
    if (!o.title) {
      var re = /"role":"user","content":\[\{"type":"input_text","text":"((?:[^"\\]|\\.){1,600})/g;
      while ((m = re.exec(txt))) { var t = unq(m[1].replace(/\\$/, "")); if (t.trim() && !synthetic(t)) { o.title = clip(t.replace(/<\/?[a-z][\w-]*(\s[^>]*)?>/gi, " "), 80); break; } } // 标题里不留 <标记>
    }
    return o;
  }
  function readHead(f, deep) {
    var h = heads[f.path];
    if (h && h.v !== 2) h = null; // 以前记下的（标题规矩改了）：重读
    if (h && h.size === f.size && (h.title || !deep || h.deep)) return Promise.resolve(h);
    var o = h && h.cwd ? Object.assign({}, h, { size: f.size }) : { size: f.size, cwd: "", model: "", title: "", origin: "", v: 2 };
    var max = Math.min(f.size, deep ? 640 << 10 : 64 << 10);
    return LOC.read(f.path, { offset: 0, max: max }).then(function (b) {
      headFrom(dec(b), o);
      if (deep) o.deep = true;
      heads[f.path] = o;
      return o;
    }, function () { return o; });
  }
  // 会话的标题（同 Claude Code 那边的规矩）：它的名字（session_index 里的）> 第一句真的话 > 斜杠命令（干净的「/cnb-model 参数」）>
  // 只有 /exit、/login 这种杂事的：目录名 + 时间（淡的）。名字里常是原样的 <command-name>… 标记，先清掉
  var CHORE = /^\/(exit|quit|login|logout|clear|new|status|model|approvals|compact|diff|init|mention|resume|help|mcp|review)$/;
  var cmdOf = function (t) {
    var n = /<command-name>\s*([^<]*?)\s*<\/command-name>/.exec(t || ""), m = /<command-message>\s*([^<]*?)\s*<\/command-message>/.exec(t || ""), a = /<command-args>\s*([^<]*?)\s*<\/command-args>/.exec(t || "");
    var name = n && n[1] ? n[1] : m && m[1] ? m[1] : "";
    return name ? ("/" + name.replace(/^\//, "") + (a && a[1].trim() ? " " + a[1].trim() : "")).replace(/\s+/g, " ").slice(0, 80) : "";
  };
  function titleOf(name, h, f) {
    var n = /<\/?command-(name|message|args)>/.test(name || "") ? cmdOf(name) : clip(String(name || "").replace(/<\/?[a-z][\w-]*(\s[^>]*)?>/gi, " "), 80);
    if (n && !CHORE.test(n.split(" ")[0])) return { t: n };
    if (h && h.title) return { t: h.title };
    if (n && !/^\/(exit|quit|login|logout)$/.test(n)) return { t: n };
    var d = new Date(f.mtime || Date.now());
    return { t: (String(h && h.cwd || "").split("/").filter(Boolean).pop() || "~") + " · " + (d.getMonth() + 1) + "/" + d.getDate() + " " + d.toTimeString().slice(0, 5), dim: true };
  }
  // 最后一句（助手说的）：列表里第二行
  function readLast(f) {
    return LOC.read(f.path, { offset: Math.max(0, f.size - (48 << 10)), max: 48 << 10 }).then(function (b) {
      var ls = dec(b).split("\n"), last = "";
      for (var i = ls.length - 1; i >= 0 && !last; i--) {
        if (ls[i].indexOf('"assistant"') < 0 && ls[i].indexOf("task_complete") < 0) continue;
        try { var j = JSON.parse(ls[i]), p = j.payload || {}; if (j.type === "response_item" && p.type === "message" && p.role === "assistant") last = textOf(p.content); else if (j.type === "event_msg" && p.type === "task_complete") last = p.last_agent_message || ""; } catch (e) { /* 半行 */ }
      }
      return clip(last, 160);
    }, function () { return ""; });
  }
  // 扫一遍：年 / 月 / 日三层目录（只重读最近几天的，旧的日子记着），再加已归档的
  function scan(force) {
    if (!on()) { LIST = []; return Promise.resolve(LIST); }
    if (scanning) return scanning;
    if (!force && Date.now() - lastScan < 8000) return Promise.resolve(LIST);
    var root = home() + "/.codex/sessions", files = [];
    scanning = LOC.ready.then(function () { return Promise.all([readNames(), readLoaded()]); }).then(function () { return list(root); }).then(function (ys) {
      var days = [];
      return Promise.all(ys.filter(function (y) { return y.dir; }).map(function (y) {
        return list(root + "/" + y.name).then(function (ms) {
          return Promise.all(ms.filter(function (m) { return m.dir; }).map(function (m) {
            return list(root + "/" + y.name + "/" + m.name).then(function (ds) { ds.filter(function (d) { return d.dir; }).forEach(function (d) { days.push(root + "/" + y.name + "/" + m.name + "/" + d.name); }); });
          }));
        });
      })).then(function () {
        days.sort().reverse();
        return Promise.all(days.map(function (d, i) {
          if (i >= 3 && dayCache[d] && !force) { files = files.concat(dayCache[d]); return null; }
          return list(d).then(function (fs) { var got = fs.filter(function (f) { return !f.dir && /\.jsonl$/.test(f.name); }).map(function (f) { return { path: d + "/" + f.name, size: f.size, mtime: f.mtime, archived: false }; }); dayCache[d] = got; files = files.concat(got); });
        }));
      });
    }).then(function () {
      return list(home() + "/.codex/archived_sessions").then(function (fs) { fs.forEach(function (f) { if (!f.dir && /\.jsonl$/.test(f.name)) files.push({ path: home() + "/.codex/archived_sessions/" + f.name, size: f.size, mtime: f.mtime, archived: true }); }); });
    }).then(function () {
      files.sort(function (a, b) { return b.mtime - a.mtime; });
      // 开头：全部读一小段（有缓存）；最近 20 个没名字、还没找到第一句话的，往后多读一些找标题
      return Promise.all(files.map(function (f, i) { return readHead(f, i < 20 && !names[idOf(f.path)]).then(function (h) { f.head = h; }); }));
    }).then(function () {
      saveHeads();
      var top = files.filter(function (f) { return !f.archived; }).slice(0, 12);
      return Promise.all(top.map(function (f) { var id = idOf(f.path), old = byId[id]; if (old && old.size === f.size && old.last !== undefined) { f.last = old.last; return null; } return readLast(f).then(function (l) { f.last = l; }); }));
    }).then(function () {
      var out = [], seen = {};
      files.forEach(function (f) {
        var id = idOf(f.path), h = f.head || {};
        if (!id || seen[id]) return;
        seen[id] = 1;
        var tt = titleOf(names[id], h, f);
        var x = { id: id, conn: "codex", path: f.path, size: f.size, mtime: f.mtime, cwd: h.cwd || "", model: h.model || "", title: tt.t || id.slice(0, 8), dimTitle: !!tt.dim, named: !!names[id], last: f.last || (byId[id] && byId[id].last) || "", archived: f.archived };
        if (loaded[id]) x.live = { kind: "codex", status: Date.now() - f.mtime < 15000 ? "busy" : "idle", since: f.mtime };
        out.push(x);
      });
      LIST = out; byId = {};
      LIST.forEach(function (x) { byId[x.id] = x; });
      keepList();
      lastScan = Date.now(); scanning = null;
      document.dispatchEvent(new Event("tsu-cx"));
      return LIST;
    }).catch(function () { scanning = null; return LIST; });
    return scanning;
  }

  // ======== 一段会话：同 claude.js 的 Runtime（每种外壳只认这些）========
  var rts = {};
  var TOOL = { exec_command: "Bash", shell: "Bash", local_shell: "Bash", write_stdin: "TaskOutput", apply_patch: "Edit", update_plan: "TodoWrite", view_image: "Read", spawn_agent: "Agent", send_input: "SendMessage", tool_search: "ToolSearch" };
  // 一次工具调用 → Paimon 的一格：名字对到 Claude Code 那一套（筛选、外壳都认），参数放进 input
  function toolPart(p, at) {
    var name = p.name || "", args = {}, input = {};
    if (p.type === "function_call") { try { args = JSON.parse(p.arguments || "{}") || {}; } catch (e) { args = { raw: p.arguments }; } }
    if (p.type === "web_search_call") {
      var ac = p.action || {};
      if (ac.type === "open_page" || ac.type === "find_in_page") return { name: "WebFetch", input: { url: ac.url || "", prompt: ac.pattern || "" } };
      return { name: "web_search", input: { query: ac.query || (ac.queries || [])[0] || "" } };
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
      var code = p.input || "", inner = /tools\.(\w+)\s*\(/.exec(code), q = function (k) { var r = new RegExp(k + '\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(code); try { return r ? JSON.parse('"' + r[1] + '"') : ""; } catch (e) { return r ? r[1] : ""; } };
      var iname = inner ? inner[1] : "";
      if (iname === "exec_command") return { name: "Bash", input: { command: q("cmd") || clip(code, 200) } };
      if (iname === "write_stdin") { var sm = /session_id\s*:\s*(\d+)/.exec(code); return { name: "TaskOutput", input: { task_id: sm ? sm[1] : "", chars: q("chars") } }; } // 等一条还在跑的命令的输出（接在那条命令下面，见 pollOf）
      if (iname === "web__run") return q("q") ? { name: "web_search", input: { query: q("q") } } : { name: "WebFetch", input: { url: q("ref_id") || q("url") } };
      if (iname === "apply_patch") { var pt = jsArg(code, "apply_patch"), fl = [], fm, fre = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm; while ((fm = fre.exec(pt))) fl.push(fm[2].trim()); return { name: "Edit", input: { file_path: fl[0] || "", files: fl, patch: pt } }; } // 补丁本身在 tools.apply_patch("…") 的参数里
      if (iname === "view_image") return { name: "Read", input: { file_path: q("path") } };
      return { name: "Code", input: { description: clip(code.split("\n")[0], 120), code: code } };
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
    var r = outputOf(o), lines = r.text.replace(/\r/g, "").split("\n");
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    var err = r.code !== null && r.code !== 0;
    p.secs = Math.max(0, Math.round(((p.turn && p.turn.last) || p.t0) - p.t0) / 1000);
    if (r.sess !== null && p.name === "Bash") { p.status = "running"; p.sess = r.sess; p.detail = lines.slice(-400); return; } // 还在跑：之后等它的输出接在这里（Codex 自己也是这样显示）
    p.status = err ? "error" : "done";
    if (err) { p.error = (lines.filter(Boolean).slice(-1)[0] || "exit code " + r.code).slice(0, 300); p.detail = lines.slice(0, 200); return; }
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
    p.detail = lines.slice(0, 400);
  }

  function Runtime(aid, info) {
    var rt = this, sid = aid.slice(3), subs = [], turns = [], sess = { id: sid, title: info.title || sid.slice(0, 8), turns: turns, todo: { items: [] }, ctx: 0, window: 0, updated: info.mtime || 0 };
    var agent = rt.agent = { id: aid, name: sess.title, effort: "", access: "rw", model: info.model || "", current: sid, goal: null, archived: false, claude: true, connector: "codex" };
    rt.info = info; rt.sid = sid; rt.label = "Codex";
    var emit = function (t, d) { subs.slice().forEach(function (f) { try { f(t, d); } catch (e) { console.error(e); } }); };
    rt.on = function (fn) { subs.push(fn); if (subs.length === 1) start(); return function () { subs = subs.filter(function (f) { return f !== fn; }); if (!subs.length) stop(); }; };
    rt.fire = emit;
    rt.session = function () { return sess; };
    rt.stream = null; rt.tasks = []; rt.queued = null;
    rt.pendingMsgs = function () { return 0; };
    rt.pending = function () {
      sentWait = sentWait.filter(function (x) { return Date.now() - x.at < 600000; });
      // sending：闲着时发的——它马上就开始这一问，不是排着（不画成灰底的排队、不写「ctrl+x ctrl+s to send now」）；忙着时发的才是排着
      return sentWait.map(function (x) { return { text: x.text, at: x.at, ours: true, sending: !x.q }; }); // rt.queued（这边排着的）live.js 自己另画
    };
    rt.takeQueued = function () { var q = rt.queued; rt.queued = null; emit("status"); return q; };
    rt.todo = function () { return sess.todo.items; };
    rt.model = function () { var m = agent.model || ""; return { id: m, name: m || "Codex", window: sess.window || 272000 }; };
    rt.state = function () { return busy ? "working" : "idle"; };
    rt.ctx = function () { var w = sess.window || 272000; return { tokens: sess.ctx, window: w, pct: sess.ctx / w * 100 }; };
    rt.home = rt.cwd = function () { return info.cwd || ""; };
    rt.cost = function () { return 0; };
    rt.tail = function () { return info.last || ""; };
    rt.maybeRecap = rt.recap = function () {};
    rt.record = function (cmd, res) { var t = { cmd: cmd, note: tr(res), at: Date.now(), local: true }; turns.push(t); emit("append", t); };
    ["setEffort", "setModel", "setAccess", "rename", "setGoal", "clearGoal", "clear", "resume", "bang", "detachBash", "stopTask", "wakeUp", "receive", "afterReload"].forEach(function (k) { rt[k] = function () { return false; }; });
    rt.turnOf = function () { return null; };
    rt.historical = function () { return false; };
    rt.more = function () { return false; };
    rt.earlier = function () { return Promise.resolve(false); };
    rt.later = function () { return Promise.resolve(false); };
    rt.latest = function () { return load(); };

    // ---- 读记录 ----
    var offset = 0, pollT = 0, cur = null, byCall = {}, loading = null, running = null;
    // 它在想吗（同 Claude Code 转圈那一行的 thinking / still thinking / deep in thought：live.js 的 thinkPhrase 问 rt.thinkSince）：
    //   最后一条是要它回的（你的话、开始一问、工具的结果）、它还没写出东西（推理、回复、工具调用）——这段时间它在推理。用户 2026-10-28：Codex 以前只写 Working
    var lastIn = 0, lastOut = 0;
    rt.thinkSince = function () { return rt.stream && running && lastIn > lastOut ? lastIn : 0; };
    function finishTurn() { if (cur && cur.last && !cur.stats && cur.at) cur.stats = { secs: Math.max(1, Math.round((cur.last - cur.at) / 1000)), verb: "Worked", at: cur.last, auto: true }; }
    // 在跑的那一问（转圈那一行、「在跑」的画法跟着它）：读到新的一问就换成它——不然还指着上一问（已经答完的），
    //   新的一问的回复、「Worked for」那一行都画错（上一问当成在跑、少了做完那一行）
    // 发出去、Codex 还没写进记录的那几句：先画成「排着」（灰底的「❯ 原话」），记录里出现了就划掉——不然要等它答了这句话才冒出来，像被吞了
    var sentWait = [];
    var wnorm = function (t) { return String(t || "").replace(/\s+/g, ""); };
    function newTurn(text, at, imgs) { finishTurn(); cur = { ask: text, images: imgs || [], parts: [], at: at }; turns.push(cur); if (rt.stream) rt.stream.turn = cur; if (sentWait.length) dropSent(text, at); return cur; }
    // 记录里来了新的一问：把这边「刚发的」那条去掉（不然同一句画两遍：用户「怎么又重复了」）——原话一样最好；Codex 记下来的话常常和发的不完全一样
    //   （带图的少了图、几句拼成一条、前后多了空白）：包含 / 开头一样也算；都对不上时，发出以后才开始的第一问就是它
    function dropSent(text, at) {
      var k = wnorm(text), hit = -1;
      sentWait.forEach(function (x, i) { if (hit >= 0) return; var w = wnorm(x.text); if (w === k || (w && k && (k.indexOf(w) >= 0 || w.indexOf(k) >= 0 || (w.length >= 12 && w.slice(0, 24) === k.slice(0, 24))))) hit = i; });
      if (hit < 0 && at && at >= sentWait[0].at - 3000) hit = 0;
      if (hit >= 0) sentWait.splice(hit, 1);
    }
    function ensureTurn(at) { if (!cur) { cur = { ask: "", parts: [], at: at, cont: true }; turns.push(cur); if (rt.stream && !rt.stream.turn.at) rt.stream.turn = cur; } return cur; }
    // 还在跑的命令（exec_command 先返回了、session ID N）：之后 write_stdin 等它的输出——不另起一格，接在那条命令下面（同 Codex 自己）
    var sessOf = {}, runAt = 0;
    function pollOf(p) {
      var a = {};
      if (p.type === "function_call" && p.name === "write_stdin") { try { a = JSON.parse(p.arguments || "{}") || {}; } catch (e) { return null; } return a.session_id != null ? { sess: +a.session_id, chars: String(a.chars || "") } : null; }
      if (p.type === "custom_tool_call" && p.name === "exec") {
        var code = String(p.input || ""), calls = code.match(/tools\.(\w+)\s*\(/g) || [];
        if (!calls.length || calls.some(function (c) { return !/write_stdin/.test(c); })) return null; // 脚本里还调了别的：照常一格
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
    function feedLine(line) {
      if (!line || line.length < 10) return null;
      var j; try { j = JSON.parse(line); } catch (e) { return null; }
      var p = j.payload || {}, at = ts(j.timestamp);
      if (j.type === "session_meta") { info.cwd = p.cwd || info.cwd; return null; }
      if (j.type === "turn_context") { if (p.model) agent.model = p.model; var cs = p.collaboration_mode && p.collaboration_mode.settings; if (cs && cs.reasoning_effort) agent.effort = cs.reasoning_effort; return null; }
      if (j.type === "compacted") { finishTurn(); cur = null; var c = { compact: { summary: String(p.message || "").trim() }, at: at }; turns.push(c); return c; }
      if (j.type === "event_msg") {
        if (p.type === "task_started") { running = p.turn_id || "?"; runAt = p.started_at ? p.started_at * 1000 : at; lastIn = Math.max(lastIn, at); if (at >= sentAt - 2000) sentAt = 0; return null; } // 排进去的那句开始跑了：不再靠「刚排进去」算在跑（跑完马上停转）
        if (p.type === "task_complete") { running = null; if (cur) { settle(cur); var dsec = p.duration_ms ? p.duration_ms / 1000 : p.completed_at && p.started_at ? p.completed_at - p.started_at : ((cur.last || at) - cur.at) / 1000; cur.stats = { secs: Math.max(1, Math.round(dsec)), verb: "Worked", at: at }; cur.last = at; } return cur; }
        if (p.type === "thread_goal_updated") { var g = p.goal || {}; agent.goal = g.status === "active" && g.objective ? { text: String(g.objective), at: (g.createdAt || 0) * 1000 || at, checking: false, iterations: 0 } : null; emit("config"); return null; } // Codex 的 /goal
        if (p.type === "turn_aborted") { running = null; if (cur) { settle(cur); cur.error = "Interrupted by user"; return cur; } return null; }
        if (p.type === "token_count" && p.rate_limits) { var rl = p.rate_limits, pcx = function (x) { return x && typeof x.used_percent === "number" ? Math.round(x.used_percent) : null; }; sess.limits = { five: pcx(rl.primary), week: pcx(rl.secondary), at: at }; } // 5 小时、7 天的限额（它自己记的）
        if (p.type === "token_count" && p.info) { var u = p.info.last_token_usage || {}; if (u.total_tokens || u.input_tokens) sess.ctx = (u.input_tokens || 0) + (u.output_tokens || 0); if (p.info.model_context_window) sess.window = p.info.model_context_window; return null; }
        if (p.type === "context_compacted") return null; // 同一回事的 compacted 那一行已经画了
        return null;
      }
      if (j.type !== "response_item") return null;
      if (p.type === "message") {
        if (p.role === "user") { var u = userOf(p.content); if ((!u.text.trim() && !u.images.length) || synthetic(u.text)) return null; lastIn = Math.max(lastIn, at); return newTurn(u.text, at, u.images); }
        if (p.role === "assistant") lastOut = Math.max(lastOut, at);
        var text = textOf(p.content);
        if (p.role !== "assistant" || !text.trim()) return null;
        var t = ensureTurn(at);
        // whole：Codex 写进记录的是说完了的整段（不是流式的半段）——在跑的这一问里也整段画（live.js 不再只画到最后一个换行：单行的回复整句都不见）
        t.parts.push({ kind: "text", text: text, whole: true, at: at, phase: p.phase === "commentary" ? "progress" : p.phase === "final_answer" ? "final" : "" });
        t.last = at;
        return t;
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
        var pp = byCall[p.call_id];
        if (!pp) return null;
        if (pp.poll) { delete byCall[p.call_id]; return more(pp.poll, p.output, at, pp.chars); }
        result(pp, p.output);
        if (pp.status === "running" && pp.sess != null) sessOf[pp.sess] = pp;
        if (pp.turn) pp.turn.last = at;
        return pp.turn;
      }
      return null;
    }
    // 记录在哪：列表里有；刷新后第一次打开、列表还没扫到的：先扫一遍
    function withPath() {
      if (info.path) return Promise.resolve(info.path);
      return scan(true).then(function () { var x = byId[sid]; if (!x) throw new Error("找不到 Codex 会话：" + sid); Object.assign(info, x); sess.title = agent.name = x.title || sess.title; agent.model = x.model || agent.model; return info.path; });
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
    function load() {
      var g = ++gen;
      loadingNow = true;
      loading = withPath().then(function (pth) { return LOC.stat(pth); }).then(function (st) {
        if (g !== gen) return;
        if (!st) throw new Error("会话记录不存在");
        var size = st.size, start = size > TAIL ? size - TAIL : 0;
        return LOC.read(info.path, { offset: start, max: size - start }).then(function (buf) {
          if (g !== gen) return;
          turns.length = 0; cur = null; byCall = {}; sessOf = {}; running = null; runAt = 0;
          var r = linesOf(buf, start > 0);
          r.lines.forEach(feedLine);
          finishTurn();
          offset = start + r.end;
          sess.updated = st.mtime;
          (turns.length ? turns : []).forEach(function (t) { (t.parts || []).forEach(function (q) { if (q.kind === "tool" && q.status === "running" && !running) q.status = "done"; }); });
          emit("reset"); emit("status");
          liveBusy();
        });
      }).catch(function (e) { if (g !== gen) return; turns.length = 0; if (!info.fresh) turns.push({ note: tr("无法读取会话：" + e.message), at: 0 }); emit("reset"); })
        .then(function () { if (g === gen) loadingNow = false; });
      return loading;
    }
    function poll() {
      if (!info.path || loadingNow) return;
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
    function start() { if (!loading) load(); clearInterval(pollT); pollT = setInterval(poll, 700); }
    function stop() { clearInterval(pollT); pollT = 0; }

    // ---- 在跑吗：自己起的进程；或者记录里有一问开了头还没结束、文件刚写过（在 Codex 里跑着）----
    var busy = false, proc = null, outBuf = "", sentAt = 0, deciding = false;
    // 转圈那一行指着的一问：正在跑的那一问（记录里开了头、还没做完）；刚说完、记录里还没有新的一问：先空着（读到新的一问时 newTurn 换上）——
    //   不指着上一问（答完了的）：它会被当成还在跑（少了「Worked for」那一行，最后一段话只画到换行为止）
    //   从几点算：在 Codex 那边跑着的，从它开始那一刻（task_started）；这边刚说的，从现在
    // 在跑时每 120ms 一个 tick：转圈那一行的雪花照样转（同 Claude Code 的会话；原来只在有新事件时才画一次，停在「·」不动）
    var ticker = 0;
    function tickOn() { if (ticker) return; ticker = setInterval(function () { if (!busy) { clearInterval(ticker); ticker = 0; return; } if (document.hidden) return; emit("tick"); }, 120); } // 看不见时不转（同 claude.js）
    function setBusy(v) {
      if (v === busy) return;
      busy = v;
      if (v) tickOn();
      if (v) rt.stream = { t0: running && runAt && !(proc && proc.alive()) ? runAt : Date.now(), turn: cur && running && !cur.stats ? cur : { parts: [] }, outTokens: 0, thinking: false, firstAt: Date.now(), verb: "Working", answer: "", ctl: { abort: function () {} } };
      else { rt.stream = null; finishTurn(); if (cur) emit("turn", cur); }
      emit("status"); emit("state");
    }
    // 在跑：这边起的 codex exec 还没退；或者记录里一问开了头还没结束，而且它正开在 Codex 里（守护进程载入着）或者文件一分钟内写过（没开着又停在半截的：Codex 退出了，不一直转）；
    //   刚排进 Codex 的（codex queue）：它开始写之前的十秒也算
    function liveBusy() { if (proc && proc.alive()) return; setBusy(!!running && (live() || Date.now() - (sess.updated || 0) < 60000) || Date.now() - sentAt < 10000); }
    var live = function () { var x = byId[sid]; return !!(x && x.live); };
    rt.elsewhere = function () { return live() && !(proc && proc.alive()); };
    rt.canInject = function () { return true; };
    rt.hint = function () { return ""; }; // 能说话就不写提示（输入框就是普通的输入框）
    // 新会话（TSU_CONNECTORS.newSession）：Codex 不让事先定 id——第一句用 codex exec 建出来，它一开头报 thread.started（会话 id），
    // 这时把这个运行时也登记到 cx:<真 id> 下，开着它的标签页换成看真 id（布局记住的就是真的），再找它的记录文件接着读
    function rekey(real) {
      real = String(real || "").toLowerCase();
      if (!real || real === sid) return;
      var old = "cx:" + sid, nu = "cx:" + real;
      newKeep(sid, { real: real });
      if (modelSel) cxModelKeep(real, modelSel);
      sid = real; sess.id = agent.current = real; agent.id = nu; rt.sid = real;
      rts[nu] = rt; A.registerExternal(nu, rt);
      if (window.TSU_TERM && TSU_TERM.panes) TSU_TERM.panes().forEach(function (p) { if (p.program && p.program.agentId === old) p.run(TSU_TERM.makeView(p, nu), true); });
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
    cxCatalog();
    rt.models = function () {
      var cat = CXCAT.list, ids = [], add = function (x) { if (x && ids.indexOf(x) < 0) ids.push(x); };
      if (cat && cat.length) { var out = cat.map(function (m) { return { id: m.id, name: m.name, desc: m.desc, def: m.def }; }); [agent.model, modelSel].forEach(function (x) { if (x && !out.some(function (m) { return m.id === x; })) out.push({ id: x, name: cxName(x), desc: "", more: true }); }); return out; }
      add(CXDEF.model); add(agent.model); add(modelSel); LIST.forEach(function (x) { add(x.model); }); return ids.map(function (id) { return { id: id, name: cxName(id), desc: "" }; });
    };
    rt.setModel = function (id) {
      id = String(id || "").trim();
      if (!id) return false;
      modelSel = id; cxModelKeep(sid, id);
      emit("config"); emit("status");
      return true;
    };
    var CX_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"], effortSel = cxEfforts()[sid] || "";
    agent.effort = effortSel;
    rt.efforts = function () { return CX_EFFORTS.slice(); };
    rt.setEffort = function (v) {
      v = String(v || "").toLowerCase().trim();
      if (v === "max") v = "xhigh";
      if (CX_EFFORTS.indexOf(v) < 0) return false;
      effortSel = agent.effort = v; cxEffortKeep(sid, v);
      emit("config"); emit("status");
      return true;
    };
    // 发话时带上这边选的模型、推理强度（下一句起）；附的图（[Image: "…"]，见 rt.send）→ --image=路径，话里去掉
    function runOpts() { var o = []; if (modelSel) o.push("-m", modelSel); if (effortSel) o.push("-c", "model_reasoning_effort=" + effortSel); return o; }
    function takeShots(text) { var ims = []; text = String(text || "").replace(/\[Image: "([^"\n]+)"\] ?/g, function (all, p) { ims.push("--image=" + p); return ""; }).trim(); return { text: text || (ims.length ? "(image)" : ""), args: ims }; }
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
    function queueIn(text) {
      sentAt = Date.now(); liveBusy();
      var sh = takeShots(text);
      eof(LOC.proc({ argv: ["codex", "queue", "--thread", sid].concat(sh.args, runOpts(), ["--message", sh.text]), cwd: info.cwd || "" }, function (s, isErr) { if (isErr && /error/i.test(s)) rt.record(text, "没排进 Codex：" + s.trim().slice(0, 300)); }, function (code) { if (code) { sentAt = 0; rt.record(text, "没排进 Codex（" + code + "）"); liveBusy(); } setTimeout(poll, 600); }));
    }
    rt.send = function (text, imgs) {
      text = String(text || "").trim();
      imgs = (imgs || []).filter(function (x) { return x && x.data; });
      if (imgs.length) { saveShots(imgs).then(function (ps) { rt.send(ps.map(function (p) { return '[Image: "' + p + '"]'; }).join(" ") + (ps.length && text ? " " : "") + text); }); return true; }
      if (!text) return false;
      if (!(deciding || (proc && proc.alive()))) { sentWait.push({ text: takeShots(text).text, at: Date.now(), q: busy }); emit("status"); } // 马上发的：先画成排着（附的图不算在话里：记录里的话不带它）
      if (deciding || (proc && proc.alive())) { rt.queued = rt.queued ? { text: rt.queued.text + "\n\n" + text } : { text: text }; emit("status"); return true; } // 这边起的那一问还没完：排着（又说的拼在后面，空一行），完了一次发出去
      if (info.fresh && !info.path) { runExec(text); return true; } // 新会话：第一句建出来
      // 正开在 Codex 里（Codex app、终端里的 codex）→ codex queue；没开着 → codex exec resume。开没开着现问守护进程（列表里记的最多是十秒前的）：
      //   开着的另起 exec 就是两个进程一起写同一段会话；没开着的用 codex queue，话只是存进它的队列，要等有人在 Codex 里打开这段会话才会跑
      deciding = true;
      readLoaded().then(function () {
        deciding = false;
        var x = byId[sid], isLive = !!loaded[sid];
        if (x) { if (isLive) x.live = x.live || { kind: "codex", status: "idle", since: Date.now() }; else delete x.live; }
        if (isLive) queueIn(text); else runExec(text);
        if (rt.queued && isLive) { var q = rt.queued; rt.queued = null; emit("status"); queueIn(q.text); } // 问的那一下又说的：也排进去（在后面）
      });
      return true;
    };
    // 打断：这边起的 codex exec 停掉它；正开在 Codex 里、正在跑的一问：请守护进程停下这一问（turn/interrupt，同在 Codex 里按 Esc）
    rt.interrupt = function () {
      if (proc && proc.alive()) { proc.kill(); return true; }
      if (!live() || !running || running === "?") return false;
      var tid = running;
      cxRpc("turn/interrupt", { threadId: sid, turnId: tid }).then(function (j) {
        if (j && j.error) rt.record("Esc", "没能打断 Codex：" + String(j.error.message || j.error).slice(0, 200));
        setTimeout(poll, 400);
        if (rt.queued) { var q = rt.queued; rt.queued = null; emit("status"); queueIn(q.text); } // ctrl+enter 排着的：停下来以后排进去
      });
      return true;
    };
    // 权限模式 Codex 没有 Shift+Tab 这一套
    rt.canInterrupt = function () { return !!(proc && proc.alive()) || !!(live() && running && running !== "?"); };
    rt.canSendNow = rt.canInterrupt;
    // ctrl+enter：排着的（加上这一句）拼成一条；在跑就停掉这一问（停下来以后一次发出去），闲着就直接发
    rt.sendNow = function (text, imgs) {
      imgs = (imgs || []).filter(function (x) { return x && x.data; });
      if (imgs.length) { saveShots(imgs).then(function (ps) { rt.sendNow(ps.map(function (p) { return '[Image: "' + p + '"]'; }).join(" ") + (ps.length && text ? " " : "") + String(text || "").trim()); }); return true; }
      text = String(text || "").trim();
      if (text) rt.queued = rt.queued ? { text: rt.queued.text + "\n\n" + text } : { text: text };
      if (rt.interrupt()) { emit("status"); return true; }
      if (!rt.queued) return false;
      var q = rt.queued; rt.queued = null; emit("status");
      return rt.send(q.text);
    };
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
          if (!arg) { say("Reasoning effort: " + (effortSel || "default") + " · options: " + CX_EFFORTS.join(" / ")); return true; }
          if (!rt.setEffort(arg)) say("Effort must be one of: " + CX_EFFORTS.join(", ")); else say("Set reasoning effort to " + effortSel + " (from the next message)");
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
          cxRpc("account/rateLimits/read", {}).then(function (j) {
            var rl = j && j.result && j.result.rateLimits, pct = function (w, n) { return w && w.usedPercent != null ? n + " " + Math.round(w.usedPercent) + "% used" : ""; };
            var ctx = rt.ctx(), lines = [
              "Model: " + (rt.model().id || CXDEF.model || "default") + (effortSel ? " (reasoning " + effortSel + ")" : ""),
              "Directory: " + cwd.replace(home(), "~"),
              "Session: " + (made ? sid : "not started yet") + (live() ? " · open in Codex" : ""),
              "Context: " + (ctx.tokens ? Math.round(ctx.pct) + "% used (" + Math.round(ctx.tokens / 1000) + "k / " + Math.round(ctx.window / 1000) + "k)" : "—"),
              rl ? "Limits: " + [pct(rl.primary, "5h"), pct(rl.secondary, "weekly")].filter(Boolean).join(" · ") + (rl.planType ? " · " + rl.planType : "") : ""
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
    rt.limits = function () { return sess.limits || null; };
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
  (LOC.ready || Promise.resolve()).then(function () { return LOC.read(home() + "/.codex/config.toml"); }).then(function (b) { var m = /^\s*model\s*=\s*"([^"]+)"/m.exec(dec(b)); if (m) CXDEF.model = m[1]; }, function () {});
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
    var nw = /^new-/.test(sid) ? newMap()[sid] : null;
    if (nw && nw.real) return ensure(nw.real, info);
    if (nw && !info) info = { cwd: nw.cwd || "", title: tr("新会话"), fresh: true };
    var aid = "cx:" + sid, x = byId[sid] || {};
    if (!rts[aid]) { rts[aid] = new Runtime(aid, Object.assign({ id: sid }, x, info || {})); A.registerExternal(aid, rts[aid]); }
    else if (info) Object.assign(rts[aid].info, info);
    return rts[aid];
  }
  // 新会话（TSU_CONNECTORS.newSession("codex", 目录, 第一句?)）：开标签页（用现在的外壳）；第一句 codex exec 在那个目录里建出来
  // opts：{ model, effort }——新会话那张草稿里选的（第一句话起就用：-m、-c model_reasoning_effort=）
  function newSession(cwd, prompt, opts) {
    var nid = "new-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), x = { cwd: cwd, title: tr("新会话"), fresh: true, mtime: Date.now() };
    newKeep(nid, { cwd: cwd });
    var rt = ensure(nid, x), tw = window.TSU_TERM && TSU_TERM.front ? TSU_TERM.front() : null;
    if (opts && opts.model && rt.setModel) rt.setModel(opts.model);
    if (opts && opts.effort && rt.setEffort) rt.setEffort(opts.effort);
    var p = tw && tw.side && tw.side.viewCX ? tw.side.viewCX(nid, x) : null;
    if (prompt) rt.send(prompt);
    return { id: nid, aid: "cx:" + nid, pane: p || null };
  }
  // 刷新后（布局里记着 cx:<会话>）、搜索、侧栏：第一次用到时现建（还没扫到的：先扫一遍再找它的文件）
  A.setExternalResolver(function (aid) { return on() ? ensure(aid.slice(3)) : null; }, "cx");
  var API = {
    // 新会话草稿用：Codex 自己的模型目录（读不到就是默认设置里的、用过的）、推理强度
    modelList: function () { var cat = CXCAT.list; if (cat && cat.length) return cat.map(function (m) { return { id: m.id, name: m.name, def: m.def }; }); var ids = []; [CXDEF.model].concat(LIST.map(function (x) { return x.model; })).forEach(function (x) { if (x && ids.indexOf(x) < 0) ids.push(x); }); return ids.map(function (id) { return { id: id, name: cxName(id), def: id === CXDEF.model }; }); },
    efforts: function () { return ["minimal", "low", "medium", "high", "xhigh"]; }, defModel: function () { return CXDEF.model || ""; },
    list: function () { return LIST; }, refresh: scan, ensure: ensure, id: function (sid) { return "cx:" + sid; }, get: function (sid) { return byId[sid] || null; }, newSession: newSession,
    // 标签页里记着的 id（可能是 new-…）→ 现在的真 id
    real: function (sid) { var nw = /^new-/.test(sid) ? newMap()[sid] : null; return nw && nw.real || sid; },
  };
  if (CON && CON.provide) CON.provide("codex", { newSession: newSession });
  window.TSU_CODEX = on() ? API : null;
  if (CON) CON.watch(function (id, v) { if (id !== "codex") return; window.TSU_CODEX = v ? API : null; if (v) scan(true); else { LIST = []; document.dispatchEvent(new Event("tsu-cx")); } });
  if (on()) setTimeout(function () { scan(true); }, 1200);
  setInterval(function () { if (on() && !document.hidden) scan(); }, 10000);
})();
