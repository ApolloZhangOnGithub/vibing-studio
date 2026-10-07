// sync.js —— 跟着账号走的数据（同 iCloud）在设备这一头：设备身份、拉 / 推、租约、通知。
// 服务器上只有一份（src/account.js），设备上的都是缓存；窗口、Dock、壁纸、主题这些界面状态跟着设备走，不经过这里。
//   · 设备：每个浏览器 / App 一个 id（存在这台设备上）和一个给人看的名字（「Mac · Chrome」「iPhone · App」），打开时报到
//   · 记录：agent、会话、每一轮（agents.js 接上来：它管缓存和拉到了哪儿，这里管收发、拆段拼段、定时拉）
//   · 租约：同一件事同一时间只在一台设备上做（agent:<id> = 谁在跑这个 agent）
//   · 通知：同一件事只有一条，谁先处理算谁的
// 没登录（本地开发没有账号 id）时 TSU_SYNC 为 null，别的脚本照旧只用本地
(function () {
  "use strict";
  var UID = window.TSU_UID || 0;
  if (!UID) { window.TSU_SYNC = null; return; }
  var ABC = "abcdefghijklmnopqrstuvwxyz0123456789";
  function rnd(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, function (b) { return ABC[b % 36]; }).join(""); }
  var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  var dev = ls("tsu-device");
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(dev || "")) { dev = "d" + rnd(15); ls("tsu-device", dev); }
  // 设备名：什么设备 + 浏览器（原生 App 里就是 App）；人可以在设置里改（tsu-device-name）
  function guessName() {
    var ua = navigator.userAgent, pf = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    var kind = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(pf + ua) ? "Mac" : /Win/.test(pf) ? "Windows" : /Linux/.test(pf) ? "Linux" : "设备";
    if (window.nadosNative) return kind + " · App";
    return kind + " · " + (/Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "浏览器");
  }
  // 名字、型号都由设备自己认出来（不让人改，以前在设置里改过的也不再用）：
  //   App（Mac、Linux）：这台电脑自己的名字（系统设置里起的「Kezhen 的 MacBook Pro」；Linux 是 hostnamectl 的名字）+ 精确的型号（「MacBook Air (M2, 2022)」「Dell Precision 5820 Tower」）；
  //   iPhone、iPad 的 App：App 给的设备名、型号（window.vsApp）；浏览器：设备 + 浏览器（「iPhone · Safari」）
  //   kind：mac（Mac 的 App）、linux（Linux 的 App）、ios（iPhone、iPad 的 App）、web（浏览器）
  var VS = window.vsApp || {}, iosName = String(VS.name || "").trim(), iosModel = String(VS.model || "").trim();
  // App 里认出来的名字、硬件编号记在这台设备上（tsu-device-auto、tsu-device-hw）：打开时先用它（不先报一个「Mac · App」），
  //   同一个 App 里借别的 Mac 用的那一页（nadosNative.remote，不自己认）也照它报
  var name = iosName || (window.nadosNative && ls("tsu-device-auto")) || guessName(), ua0 = navigator.userAgent;
  var kind = !window.nadosNative ? "web" : /iPhone|iPad|Android/.test(name + " " + iosModel + " " + ua0) && !/Macintosh/.test(ua0) || /iPad/.test(name) ? "ios" : /Linux/.test(ua0) ? "linux" : "mac";
  var model = iosModel || ls("tsu-device-model") || "", hw = "";
  // 系统、App 版本（设备卡片里写）：浏览器从 UA 读系统；App 的版本下面问原生那边
  var osName = (function () { var ua = navigator.userAgent, m; if ((m = /(iPhone|CPU) OS (\d+)[_.](\d+)/.exec(ua))) return "iOS " + m[2] + "." + m[3]; if ((m = /Android (\d+(\.\d+)?)/.exec(ua))) return "Android " + m[1]; if (/Mac OS X/.test(ua)) return "macOS"; if (/Windows/.test(ua)) return "Windows"; if (/Linux/.test(ua)) return "Linux"; return ""; })();
  var appVer = "";
  fetch("version.json", { cache: "no-store", credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && j.version && !appVer) { appVer = (window.nadosNative ? "" : "网页 ") + j.version; } }, function () {});
  if (iosModel && (!iosName || /^(iPhone|iPad|iPod)$/.test(iosName))) name = iosModel; // 系统只给了「iPhone」这样的通用名：用精确的型号当名字（「iPhone 15 Pro」）
  var sh = function (cmd) { return window.TSU_LOCAL && TSU_LOCAL.exec ? TSU_LOCAL.exec({ cmd: cmd }).then(function (r) { return String((r && (r.out || r.stdout)) || "").trim(); }, function () { return ""; }) : Promise.resolve(""); };
  // 硬件编号只发哈希（混上账号，不同账号之间对不上）：同一台机器上不同的 App、页面（各有各的本地存储、设备 id）按它并成一台
  var fnv = function (s) {
    var a = 0x811c9dc5, b = 0x050c5d1f;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15); }
    return ("0000000" + (a >>> 0).toString(16)).slice(-8) + ("0000000" + (b >>> 0).toString(16)).slice(-8);
  };
  var hwOf = function (raw) { raw = String(raw || "").trim(); return raw ? fnv("vs:" + UID + ":" + raw.toLowerCase()) : ""; };
  hw = hwOf(VS.hw) || (window.nadosNative && ls("tsu-device-hw")) || "";
  // 名字、型号、硬件编号、系统都由这台机器自己给：一段 shell，Mac、Linux 各走各的
  //   Mac：系统设置里起的名字（ComputerName）；型号是「关于本机」那个（「MacBook Air (M2, 2022)」，Apple 芯片的 Mac 记在 ioreg 的 product-name），
  //        Intel 的 Mac 没有就用 system_profiler 的机型 · 处理器 · 型号代码；硬件编号 IOPlatformUUID；系统 sw_vers
  //   Linux：hostnamectl 起的名字（没起就是主机名）、DMI 的厂商 + 型号、machine-id、os-release
  var ID_SH = [
    "if [ \"$(uname -s)\" = Darwin ]; then",
    "  echo \"name=$(scutil --get ComputerName 2>/dev/null)\"",
    "  m=$(ioreg -rc IOPlatformDevice -k product-name 2>/dev/null | sed -n 's/.*\"product-name\" = <\"\\([^\"]*\\)\".*/\\1/p' | head -1)",
    "  [ -n \"$m\" ] || m=$(/usr/sbin/system_profiler SPHardwareDataType 2>/dev/null | sed -nE 's/^ *(Model Name|Chip|Processor Name|Model Identifier): (.*)$/\\2/p' | awk 'NR>1{printf \" · \"}{printf \"%s\",$0}')",
    "  echo \"model=$m\"",
    "  echo \"hw=$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | sed -n 's/.*\"IOPlatformUUID\" = \"\\([^\"]*\\)\".*/\\1/p')\"",
    "  echo \"os=macOS $(sw_vers -productVersion 2>/dev/null)\"",
    "else",
    "  n=$(hostnamectl --pretty 2>/dev/null); [ -n \"$n\" ] || n=$(hostname 2>/dev/null)",
    "  echo \"name=$n\"",
    "  echo \"model=$(cat /sys/class/dmi/id/sys_vendor /sys/class/dmi/id/product_name 2>/dev/null | tr '\\n' ' ')\"",
    "  echo \"hw=$(cat /etc/machine-id 2>/dev/null || cat /var/lib/dbus/machine-id 2>/dev/null)\"",
    "  echo \"os=$(. /etc/os-release 2>/dev/null && echo \"$PRETTY_NAME\")\"",
    "  echo \"linux=1\"",
    "fi",
  ].join("\n");
  var identified = false;
  function identify(tries) {
    var N = window.nadosNative;
    if (!N || N.remote || !N.call) return;
    (window.TSU_LOCAL && TSU_LOCAL.ready ? TSU_LOCAL.ready : Promise.resolve()).then(function () {
      return N.call("info").then(function (x) { if (x && x.version) appVer = String(x.version); }, function () {});
    }).then(function () { return N.call("local.info"); }).then(function (i) {
      var host = i && String(i.host || "").replace(/\.local$/, "").trim();
      return sh(ID_SH).then(function (out) {
        var kv = {};
        String(out || "").split("\n").forEach(function (l) { var k = l.indexOf("="); if (k > 0) kv[l.slice(0, k)] = l.slice(k + 1).trim(); });
        var n2 = kv.name || host || name, m2 = String(kv.model || "").replace(/\s+/g, " ").replace(/^Apple Inc\.? /, "").replace(/ Inc\.( |$)/, "$1").trim().slice(0, 80);
        var h2 = hwOf(kv.hw), o2 = kv.os && !/^macOS\s*$/.test(kv.os) ? kv.os : (i && i.os) || osName;
        if (kv.linux) kind = "linux";
        if (m2) ls("tsu-device-model", m2);
        if (n2) ls("tsu-device-auto", n2);
        if (h2) ls("tsu-device-hw", h2);
        name = n2; model = m2 || model; hw = h2 || hw; osName = o2;
        identified = true;
        hello();
      });
    }, function () { if ((tries || 0) < 5) setTimeout(function () { identify((tries || 0) + 1); }, 2000); }); // 原生那边还没好：过一会儿再试
  }
  identify(0);

  var fns = [];
  function emit(type, data) { fns.slice().forEach(function (f) { try { f(type, data); } catch (e) { console.error(e); } }); }
  function post(path, body) {
    return fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-tsu-device": dev }, body: typeof body === "string" ? body : JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "HTTP " + r.status); return j; }); });
  }

  // ---- 设备报到：打开时一次，之后每 10 分钟（「上次在线」）----
  var devices = {}; // id → { name, kind, last_seen }
  // 中转里的编号：这台 Mac 当主机时的（remote-host.js）、这台设备连别的 Mac 时的（remote.js）——「设备」App 按它把在线的 Mac、连着它的设备和这里对上
  function relayIds() { var a = []; try { var h = window.TSU_REMOTE_HOST; if (h && h.device) a.push(h.device()); a.push(localStorage.getItem("vs-remote-client")); } catch (e) { /* 没有 */ } return a.filter(Boolean).join(" ").slice(0, 120); }
  function hello() { return post("/api/devices", { id: dev, name: name, kind: kind, model: model || undefined, os: osName || undefined, app: appVer || undefined, hw: hw || undefined, relay: relayIds() || undefined }).catch(function () {}); }
  // App 里（自己认得出名字、型号）：认出来时报到；3 秒还没认出来就先用记着的报一次
  var N0 = window.nadosNative;
  if (N0 && !N0.remote && N0.call) setTimeout(function () { if (!identified) hello(); }, 3000); else hello();
  setInterval(hello, 600000);

  // ---- 拉：since 之后的所有记录（一页放不下自动翻页），同一条的几段拼好；还没推全的那条这次先不给（推全以后会整条再来）----
  var skew = 0; // 服务器时间 - 本机时间（租约、稍后提醒按服务器的钟算）
  function pull(since) {
    var rows = [], first = null, after = "";
    function page() {
      var q = "/api/sync?since=" + since + (after ? "&after=" + encodeURIComponent(after) : "");
      return fetch(q, { headers: { "x-tsu-device": dev } }).then(function (r) {
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || "HTTP " + r.status); });
        return r.json();
      }).then(function (j) {
        if (!first) first = j;
        rows = rows.concat(j.rows || []);
        if (j.rest > 0 && j.after && j.after !== after) { after = j.after; return page(); }
        skew = (first.now || Date.now()) - Date.now();
        note(first);
        return { recs: assemble(rows), head: first.head || 0, notices: first.notices || [], leases: first.leases || [] };
      });
    }
    return page();
  }
  function assemble(rows) {
    var groups = {}, out = [];
    rows.forEach(function (r) {
      var k = r.ns + "|" + r.id, g = groups[k] || (groups[k] = {}), vk = r.v || "", x = g[vk] || (g[vk] = { parts: r.parts || 1, rev: 0, got: {}, n: 0, dev: r.dev, at: r.at });
      if (!(r.part in x.got)) x.n++;
      x.got[r.part] = r.data;
      if (r.rev >= x.rev) { x.rev = r.rev; x.dev = r.dev; x.at = r.at; }
    });
    Object.keys(groups).forEach(function (k) {
      var best = null;
      Object.keys(groups[k]).forEach(function (vk) { var x = groups[k][vk]; if (!best || x.rev > best.rev) best = x; });
      if (best.n < best.parts) return;
      var data = best.got[0];
      if (best.parts > 1) { data = ""; for (var i = 0; i < best.parts; i++) data += best.got[i]; }
      var i0 = k.indexOf("|");
      out.push({ ns: k.slice(0, i0), id: k.slice(i0 + 1), data: data == null ? null : data, dev: best.dev, at: best.at, rev: best.rev });
    });
    return out.sort(function (a, b) { return a.rev - b.rev; });
  }

  // ---- 推：[{ ns, id, data（字符串；null = 删了）}]。大的拆成几段（每段 20 万个字符以内，UTF-8 最多 600 KB），按 1.5 MB 一批依次推 ----
  var PART = 200000, BATCH = 1500000, enc = new TextEncoder();
  function push(recs) {
    var rows = [], t = Date.now();
    recs.forEach(function (r) {
      if (r.data == null) { rows.push({ ns: r.ns, id: r.id, part: 0, parts: 1, v: null, data: null, at: t }); return; }
      var s = String(r.data), chunks = [], pos = 0;
      while (pos < s.length) {
        var end = Math.min(s.length, pos + PART), c = s.charCodeAt(end - 1);
        if (end < s.length && c >= 0xd800 && c <= 0xdbff) end--; // 不把一个 emoji 的两半拆开
        chunks.push(s.slice(pos, end));
        pos = end;
      }
      if (!chunks.length) chunks.push("");
      var v = chunks.length > 1 ? rnd(10) : null;
      chunks.forEach(function (ch, i) { rows.push({ ns: r.ns, id: r.id, part: i, parts: chunks.length, v: v, data: ch, at: t }); });
    });
    var batches = [], cur = [], size = 2;
    rows.forEach(function (row) {
      var j = JSON.stringify(row), n = enc.encode(j).length + 1;
      if (cur.length && size + n > BATCH) { batches.push(cur); cur = []; size = 2; }
      cur.push(j);
      size += n;
    });
    if (cur.length) batches.push(cur);
    var rev = 0;
    return batches.reduce(function (p, b) {
      return p.then(function () { return post("/api/store", "[" + b.join(",") + "]").then(function (j) { rev = j.rev; }); });
    }, Promise.resolve()).then(function () { return rev; });
  }

  // ---- 租约 ----
  var leases = {}; // name → { dev, until, device }
  var serverNow = function () { return Date.now() + skew; };
  function note(j) {
    if (j.devices) { var nd = {}; j.devices.forEach(function (d) { nd[d.id] = d; }); var ch = JSON.stringify(nd) !== JSON.stringify(devices); devices = nd; if (ch) emit("devices"); } // 每次拉都是整份（移除了的也就没了）
    if (j.leases) {
      var mine = {};
      Object.keys(leases).forEach(function (k) { if (leases[k].dev === dev && leases[k].until > serverNow()) mine[k] = leases[k]; }); // 自己刚拿到的先留着（拉的那一刻它可能还没写进去）
      leases = mine;
      j.leases.forEach(function (l) { if (!leases[l.name] || l.dev !== dev) leases[l.name] = { dev: l.dev, until: l.until, device: devices[l.dev] ? plainName(devices[l.dev]) : null }; });
      emit("leases");
    }
    if (j.notices && j.notices.length) noticesIn(j.notices);
  }
  function lease(nm, op, o) {
    o = o || {};
    return post("/api/lease", { name: nm, dev: dev, op: op, force: !!o.force, ttl: o.ttl }).then(function (j) {
      if (op === "free") { if (leases[nm] && leases[nm].dev === dev) delete leases[nm]; }
      else if (j.dev) leases[nm] = { dev: j.dev, until: j.until, device: j.device };
      emit("leases");
      return j;
    });
  }
  // 别的设备拿着、还没过期：返回 { dev, until, device（名字）}
  function elsewhere(nm) { var l = leases[nm]; return l && l.dev !== dev && l.until > serverNow() ? l : null; }

  // ---- 通知：同一件事一条（key）；处理经服务器，只生效一次 ----
  var notices = {}; // key → 服务器上的那条
  function noticesIn(list) {
    var changed = [];
    list.forEach(function (n) { var old = notices[n.key]; if (!old || n.rev > old.rev) { notices[n.key] = n; changed.push(n); } });
    if (changed.length) emit("notices", changed);
  }
  function noticeAdd(key, n) {
    return post("/api/notices", { op: "add", key: key, app: n.app, title: n.title, body: n.body, data: n.data, dev: dev }).then(function (j) {
      if (j.notice) noticesIn([j.notice]);
      return j;
    });
  }
  function noticeAct(key, action, until) {
    return post("/api/notices", { op: "act", key: key, action: action || "dismiss", until: until, dev: dev }).then(function (j) {
      if (j.notice) noticesIn([j.notice]);
      return j;
    });
  }

  // ---- 定时拉：agents.js 接上来以后开始（它给出拉到了哪儿、拿到以后怎么合进去）。
  // 有 agent 在别的设备上跑时 3 秒一次（看得到它在答什么），平时 20 秒；页面藏着不拉，回到前台马上拉一次 ----
  var consumer = null, timer = 0, busy = false;
  function interval() { return Object.keys(leases).some(function (k) { return elsewhere(k); }) ? 3000 : 20000; }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(poll, ms == null ? interval() : ms); }
  function poll() {
    if (!consumer || busy) return schedule();
    if (document.hidden) return schedule();
    busy = true;
    pull(consumer.since()).then(function (res) { return consumer.apply(res); })
      .catch(function (e) { console.warn("同步：拉取失败，稍后再试 ·", e.message || e); })
      .then(function () { busy = false; schedule(); });
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) schedule(0); });
  window.addEventListener("focus", function () { schedule(0); });

  // ---- 给人看的设备列表（「设备」App、设置 › 账号）----
  //   · 同一台机器（hw 一样：同一台 Mac 上不同版本的 App、页面各有各的设备 id）并成一台，用最近报到的那条；ids 是它名下所有的设备 id
  //   · 以前的版本留下的旧记录不列：那时认不出名字，记成了「Mac · App」「iPhone · Safari」这样的通用名。同一类设备里有比它晚出现的
  //     （名字认出来了的、同名的，或者网页的被同一类的 App 取代）就是被取代了——同一台机器换了设备 id、同一台 iPhone 先用网页后来装了 App；
  //     还在用的设备打开新版时会自己报上真名
  //   · 30 天没出现的不列
  var GENERIC = /^(Mac|iPad|iPhone|Android|Windows|Linux|设备) · (App|Safari|Chrome|Edge|Firefox|浏览器)$/;
  var famOf = function (d) {
    var s = [d.name, d.model, d.os].join(" ");
    if (/iPad/i.test(s)) return "ipad";
    if (/iPhone|iPod/i.test(s)) return "iphone";
    if (/Android/i.test(s)) return "android";
    if (d.kind === "ios") return "iphone";
    return "computer"; // Mac、Linux、Windows（以前 Linux 的 App 也记成 mac）
  };
  var isWeb = function (d) { return d.kind === "web" || / · (Safari|Chrome|Edge|Firefox|浏览器)$/.test(String(d.name || "")); };
  // 给人看的名字：通用名的 App 记录用型号（没有就是「iPad」），浏览器的写「iPhone 上的 Safari」
  var EN = function () { return !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"); };
  var plainName = function (d) {
    var m = GENERIC.exec(String(d.name || ""));
    if (!m) return String(d.name || "") || (EN() ? "Another Device" : "另一台设备");
    if (m[2] !== "App") { var br = m[2] === "浏览器" ? (EN() ? "Browser" : "浏览器") : m[2], dv = d.model || m[1]; return EN() ? br + " on " + dv : dv + " 上的 " + br; }
    return d.model || m[1];
  };
  function deviceList() {
    var now = serverNow(), mine = devices[dev] || {};
    var all = Object.keys(devices).filter(function (id) { return id !== dev; }).map(function (id) { return Object.assign({}, devices[id]); });
    all.push({ id: dev, name: name, kind: kind, model: model, os: osName, app: appVer, hw: hw, relay: relayIds(), created_at: mine.created_at || now, last_seen: now, self: true });
    all.sort(function (a, b) { return (b.self ? 1 : 0) - (a.self ? 1 : 0) || (b.last_seen || 0) - (a.last_seen || 0); });
    // 并进来的记录（ids 跟着走：从账户里移除这一台时，它名下以前的记录一起移除，不会又冒出一台）
    //   guess：只是猜它被取代了（不一定是同一台）——首次登录、中转编号不跟着并
    var absorb = function (k, d, guess) { k.ids.push.apply(k.ids, d.ids); if (guess) return; if (d.created_at && d.created_at < k.created_at) k.created_at = d.created_at; if (d.relay) k.relay = [k.relay, d.relay].filter(Boolean).join(" "); };
    var byHw = {}, out = [];
    all.forEach(function (d) {
      d.ids = [d.id];
      if (d.hw && byHw[d.hw]) return absorb(byHw[d.hw], d);
      if (d.hw) byHw[d.hw] = d;
      out.push(d);
    });
    // 还没报过硬件编号的老记录、名字和某台报过的一样（同一台机器上以前的 App、页面）：也并进那一台
    var lc = function (s) { return String(s || "").trim().toLowerCase(); };
    out = out.filter(function (d) {
      if (d.hw || d.self || !lc(d.name)) return true;
      var k = out.filter(function (o) { return o !== d && o.hw && lc(o.name) === lc(d.name) && famOf(o) === famOf(d); })[0];
      if (!k) return true;
      absorb(k, d);
      return false;
    });
    // 被取代的旧记录：并进取代它的那一台（有别的就不并进这台设备自己——这台不能从这里移除）；从旧到新一条条看，一串取代时 ids 一路带过去
    var gen = function (d) { return !d.hw && GENERIC.test(String(d.name || "")); }, gone = {};
    out.slice().sort(function (a, b) { return (a.last_seen || 0) - (b.last_seen || 0); }).forEach(function (d) {
      if (d.self || !gen(d)) return;
      var f = famOf(d), web = isWeb(d);
      var cs = out.filter(function (o) { return o !== d && !gone[o.id] && famOf(o) === f && (o.last_seen || 0) > (d.last_seen || 0) && (!gen(o) || o.name === d.name || (web && !isWeb(o))); });
      if (!cs.length) return;
      var os = function (x) { var s = [x.kind, x.name, x.os].join(" "); return /linux|ubuntu|debian|fedora/i.test(s) ? "linux" : /windows/i.test(s) ? "windows" : "mac"; };
      cs.sort(function (a, b) { return (os(b) === os(d)) - (os(a) === os(d)) || (a.self ? 1 : 0) - (b.self ? 1 : 0) || (b.last_seen || 0) - (a.last_seen || 0); }); // 同一种系统的、不是这台的、最近出现的
      absorb(cs[0], d, true);
      gone[d.id] = true;
    });
    out = out.filter(function (d) { return !gone[d.id] && (d.self || now - (d.last_seen || 0) <= 30 * 86400000); });
    return out.map(function (d) { var m = GENERIC.exec(String(d.name || "")); d.label = plainName(d); d.web = isWeb(d); d.browser = d.web && m ? m[2] : ""; d.family = famOf(d); return d; });
  }
  // 从账户里移除（ids：并成一台的那几个设备 id 一起）；还登录着的设备下次报到时会重新出现
  function removeDevices(ids) {
    ids = (ids || []).filter(function (id) { return id && id !== dev; });
    if (!ids.length) return Promise.resolve({ ok: true, removed: 0 });
    return post("/api/devices", { op: "remove", ids: ids }).then(function (j) { ids.forEach(function (id) { delete devices[id]; }); emit("devices"); return j; });
  }

  window.TSU_SYNC = {
    uid: UID, dev: dev,
    name: function () { return name; },
    model: function () { return model; },
    os: function () { return osName; },
    app: function () { return appVer; },
    hw: function () { return hw; },
    kind: function () { return kind; },
    devices: function () { return devices; },
    deviceList: deviceList, removeDevices: removeDevices,
    deviceName: function (id) { return id === dev ? name : devices[id] ? plainName(devices[id]) : "另一台设备"; },
    pull: pull, push: push,
    attach: function (c) { consumer = c; schedule(interval()); }, // c: { since() → 拉到了哪个 rev, apply({ recs, head, notices, leases }) → Promise }
    poke: function (ms) { schedule(ms == null ? 300 : ms); },
    lease: lease, elsewhere: elsewhere, leases: function () { return leases; },
    notices: function () { return notices; }, noticeAdd: noticeAdd, noticeAct: noticeAct,
    now: serverNow,
    on: function (f) { fns.push(f); return function () { var i = fns.indexOf(f); if (i >= 0) fns.splice(i, 1); }; },
  };
})();
