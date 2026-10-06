// finder.js —— 访达：浏览沙盒文件系统（SANDBOX，存在 IndexedDB）
// · 多个窗口（⌥⌘N、Dock 右键「新建访达窗口」），每个窗口可以开多个标签页（⌥⌘T 新建、⌥⌘W 关闭、⇧⌘[ ] 切换；两个以上时工具栏下面出标签页栏）
// · 侧边栏：最近使用、应用程序（/Applications：每个 App 一个 <名字>.app 目录、里面 Info.json，终端和 agent 也能 ls）、个人、上传、临时、根目录
// · 四种显示：图标 / 列表 / 分栏（一层一栏，选中文件夹就在右边开下一栏，栏宽可拖）/ 画廊；可按名称、种类、日期、大小、标签分组（每个文件夹记住自己的）
// · 选择：点选、⌘ 加选、⇧ 连选、拖动框选（⌘ 反选、⇧ 加选，拖到边上自动滚）；隐藏文件（. 开头）默认不显示，⇧⌘. 切换
// · 前往：⇧⌘G 前往文件夹（边打边补全，Tab 补全、~ 与相对路径、最近前往），「前往」菜单里还有最近使用的文件夹
// · 按名称搜索（含子目录）；右侧预览面板（左边缘可拖宽窄）：顶上是真的预览——文稿按终端的样子排版、跟着宽度折行、按整行滚，图片按框缩放；下面是种类与大小、信息、标签
// · 快速查看（空格 / ⌘Y）：浮在访达上面的大面板（四边四角都能拉），TTU 渲染、按整行滚；App、文件夹、看不了内容的文件是一张小卡片（大图标 + 名称、版本、大小、修改时间）
// · 打开（双击 / ⌘O / ⌘↓）：文件夹进去，.app 启动，zip 解压到旁边，文件交给默认 App（代码 / 文本 → 编辑器，.html → Safari），没有合适的 App 就快速查看
// · 废纸篓（~/.Trash，Dock 最右边）：⌘⌫ 移到废纸篓（⌘Z 撤销），可以放回原处；立即删除（⌥⌘⌫）、清倒废纸篓（⇧⌘⌫）要确认，删了就不能恢复
// · 右键菜单同 macOS：在新标签页中打开、移到废纸篓、显示简介（⌘I，一个小窗口）、重新命名、压缩、复制（⌘D）、快速查看、拷贝 / 粘贴项目（⌘C / ⌘V）、共享、一排标签色点、服务
// · 从系统拖文件进来上传（只收文本）、拖到文件夹 / 标签页上移动、拖到 Dock 的废纸篓扔掉、拖给「导出 / 传输」打包下载；文件系统一变，所有访达窗口一起刷新
(function () {
  "use strict";
  if (!window.TSU_DESK || !window.SANDBOX) return;
  var FS = window.SANDBOX, D = window.TSU_DESK, HOME = FS.HOME, root = document.documentElement;
  var MIME = "application/x-tsu-paths"; // 窗口内拖动、拖给「导出」、拖到 Dock 的废纸篓：带上被拖的路径（JSON 数组）
  var APPS = "/Applications", UPLOADS = HOME + "/上传", TRASH = HOME + "/.Trash", RECENTS = "@recents"; // RECENTS：「最近使用」不是真目录，用个记号当位置
  var ROOTS = { "/": 1, "/home": 1, "/tmp": 1, "/shared": 1, "/agents": 1, "/.paimon": 1, "/.paimon/config": 1, "/.paimon/IdentityData": 1, "/.paimon/MemoryData": 1 }; // 系统目录：不能删、不能改名
  ROOTS[HOME] = ROOTS[APPS] = ROOTS[UPLOADS] = ROOTS[TRASH] = 1;
  var VIEWS = ["icons", "list", "columns", "gallery"];
  var SEP = { sep: true };
  // 隐藏文件（名字以 . 开头）：默认不显示，⇧⌘. 切换（同 macOS：所有访达窗口一起，记下来）
  var showHidden = localStorage.getItem("tsu-finder-hidden") === "1";
  var visible = function (p) { return showHidden || p === "/" || p.charAt(p.lastIndexOf("/") + 1) !== "."; };
  // base 以下的哪一层是隐藏的（搜索、最近使用里不列隐藏文件夹里的东西）
  var hiddenBelow = function (p, base) { return !showHidden && p.slice(base === "/" ? 1 : base.length + 1).split("/").some(function (x) { return x.charAt(0) === "."; }); };

  // ======== 小工具 ========
  var parentOf = function (p) { return p.slice(0, p.lastIndexOf("/")) || "/"; };
  var baseOf = function (p) { return p === "/" ? "/" : p.slice(p.lastIndexOf("/") + 1); };
  var extOf = function (n) { var i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; };
  var join = function (dir, name) { return (dir === "/" ? "" : dir) + "/" + name; };
  var under = function (p, dir) { return p === dir || p.indexOf(dir === "/" ? "/" : dir + "/") === 0; };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var two = function (n) { return String(n).padStart(2, "0"); };
  var light = function () { return root.classList.contains("light"); };
  var enc = window.TextEncoder ? new TextEncoder() : null;
  var bytesOf = function (s) { return enc ? enc.encode(s || "").length : (s || "").length; };
  var fileBytes = function (st) { return !st || st.dir ? 0 : st.size != null ? st.size : bytesOf(st.data); }; // 新写的文件带 size；老的文本文件按 UTF-8 量
  var store = {
    get: function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  var xfer = function () { return window.TSU_TRANSFER || window.TSU_EXPORT || null; };
  function popup(items, at) { if (D.popup) D.popup(items, at); }
  function under4(el) { var r = el.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4 }; } // 菜单挂在按钮下面
  function it(label, keys, run, disabled, extra) { return Object.assign({ label: label, keys: keys || "", run: run, disabled: !!disabled }, extra || {}); }
  // 同一个目录里不重名：「未命名文件夹」「未命名文件夹 2」……
  function freeName(dir, name) {
    if (!FS.exists(join(dir, name))) return name;
    var dot = name.lastIndexOf("."), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    for (var i = 2; ; i++) if (!FS.exists(join(dir, stem + " " + i + ext))) return stem + " " + i + ext;
  }
  // 「复制」、粘贴回同一个文件夹：「名字 副本.txt」「名字 副本 2.txt」……（同 macOS）
  function copyName(dir, name) {
    var dot = FS.isDir(join(dir, name)) ? -1 : name.lastIndexOf("."), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    var n = stem + " 副本" + ext;
    for (var i = 2; FS.exists(join(dir, n)); i++) n = stem + " 副本 " + i + ext;
    return n;
  }
  // 拖动：按下后指针移到哪都跟着（setPointerCapture），松手 end()
  function dragWith(e, target, move, end) {
    e.preventDefault();
    try { target.setPointerCapture(e.pointerId); } catch (x) {}
    function up() { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up); if (end) end(); }
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  // ======== .app：/Applications 里的 <名字>.app 目录，Info.json 写着 { id, name, version } ========
  var infoCache = {};
  function appInfo(p) {
    if (!/\.app$/.test(p)) return null;
    var st = FS.stat(p + "/Info.json");
    if (!st || st.dir || !FS.isDir(p)) return null;
    var c = infoCache[p];
    if (!c || c.mtime !== st.mtime) {
      var info = null;
      try { info = JSON.parse(st.data); } catch (e) {}
      c = infoCache[p] = { mtime: st.mtime, info: info && info.id ? info : null };
    }
    return c.info;
  }
  var isApp = function (p) { return !!appInfo(p); };
  var isFolder = function (p) { return FS.isDir(p) && !appInfo(p); }; // .app 是目录，但当一个文件用（双击启动、不进去）
  function inBundle(p) { var i = p.indexOf(".app/"); return i > 0 && isApp(p.slice(0, i + 4)); }
  function displayName(p) { var b = baseOf(p); return isApp(p) ? b.slice(0, -4) : b; }
  // 显示名：系统位置用中文名（同 macOS 的本地化文件夹名）
  function label(p) {
    return p === RECENTS ? "最近使用" : p === "/" ? "根目录" : p === HOME ? "个人" : p === APPS ? "应用程序" : p === UPLOADS ? "上传" : p === "/tmp" ? "临时" : p === TRASH ? "废纸篓" : displayName(p);
  }
  // 不能删 / 改名 / 移走：系统目录、由访达按 App 列表维护的 .app
  var fixed = function (p) { return !!ROOTS[p] || (isApp(p) && parentOf(p) === APPS) || inBundle(p); };
  var inTrash = function (p) { return p !== TRASH && under(p, TRASH); };

  // ======== 种类、大小、日期（同 macOS 访达的中文写法）========
  var KINDS = { md: "Markdown 文稿", markdown: "Markdown 文稿", txt: "纯文本文稿", js: "JavaScript 脚本", mjs: "JavaScript 脚本", ts: "TypeScript 脚本",
    py: "Python 脚本", json: "JSON 文稿", html: "HTML 文稿", htm: "HTML 文稿", css: "CSS 样式表", sh: "Shell 脚本", csv: "CSV 文稿", yml: "YAML 文稿", yaml: "YAML 文稿",
    xml: "XML 文稿", c: "C 源代码", h: "C 头文件", cpp: "C++ 源代码", go: "Go 源代码", rs: "Rust 源代码", java: "Java 源代码", rb: "Ruby 脚本", log: "日志文件",
    toml: "TOML 文稿", ini: "配置设置", svg: "SVG 图像", png: "PNG 图像", jpg: "JPEG 图像", jpeg: "JPEG 图像", gif: "GIF 图像", webp: "WebP 图像", bmp: "BMP 图像",
    ico: "Windows 图标", avif: "AVIF 图像", zip: "ZIP 归档", gz: "GZip 压缩归档", tgz: "GZip 压缩归档", tar: "tar 归档", pdf: "PDF 文稿",
    mp3: "MP3 音频", wav: "WAV 音频", mp4: "MPEG-4 影片", mov: "QuickTime 影片", wasm: "WebAssembly 模块",
    docx: "Microsoft Word 文稿", doc: "Microsoft Word 97 文稿", xlsx: "Microsoft Excel 工作簿", xls: "Microsoft Excel 97 工作簿", pptx: "Microsoft PowerPoint 演示文稿",
    ppt: "Microsoft PowerPoint 97 演示文稿", pages: "Pages 文稿", numbers: "Numbers 表格", key: "Keynote 讲演", ics: "iCalendar 文件", rtf: "RTF 文稿" };
  var IMG = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif" };
  var HTML = { html: 1, htm: 1 }, SCRIPT = { sh: 1, py: 1, js: 1, mjs: 1 }, ARCH = { zip: 1, gz: 1, tgz: 1, tar: 1 };
  var CODE = { js: 1, mjs: 1, ts: 1, py: 1, sh: 1, json: 1, html: 1, htm: 1, css: 1, c: 1, h: 1, cpp: 1, go: 1, rs: 1, java: 1, rb: 1, yml: 1, yaml: 1, xml: 1, toml: 1, ini: 1 };
  var DOCS = { md: 1, markdown: 1, txt: 1, csv: 1, log: 1, rtf: 1, "": 1 };
  var isBin = function (p) { var st = FS.stat(p); return !!(st && (st.bin || st.binary)); }; // 二进制文件（图片、压缩包……）：文本工具读不了
  var textish = function (p) { var e = extOf(baseOf(p)); return !isBin(p) && !!(DOCS[e] || CODE[e] || (KINDS[e] && !IMG[e] && !ARCH[e]) || /^(\.|readme|license|makefile|dockerfile)/i.test(baseOf(p))); };
  function kindOf(p) {
    if (isApp(p)) return "应用程序";
    if (FS.isDir(p)) return "文件夹";
    var e = extOf(baseOf(p));
    return KINDS[e] || (e ? e.toUpperCase() + " 文稿" : "文稿");
  }
  function sizeText(n) {
    if (n < 1000) return n + " 字节";
    if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + " KB";
    if (n < 1e9) return (n / 1e6).toFixed(1) + " MB";
    return (n / 1e9).toFixed(2) + " GB";
  }
  function treeBytes(p) { var n = 0; FS.walk(p).forEach(function (k) { n += fileBytes(FS.stat(k)); }); return n; }
  function sizeOf(p) { return isApp(p) ? sizeText(treeBytes(p)) : FS.isDir(p) ? "--" : sizeText(fileBytes(FS.stat(p))); }
  function countOf(p) { try { return FS.list(p).filter(function (q) { return q !== TRASH; }).length; } catch (e) { return 0; } }
  var kindLine = function (p) { return kindOf(p) + " - " + (isFolder(p) ? countOf(p) + " 项" : sizeOf(p)); }; // 「Markdown 文稿 - 418 字节」「文件夹 - 3 项」
  function daysAgo(t) {
    var day = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    return Math.round((day(new Date()) - day(new Date(t))) / 864e5);
  }
  function dateOf(t) {
    if (!t) return "--";
    var d = new Date(t), hm = d.getHours() + ":" + two(d.getMinutes()), n = daysAgo(t);
    if (n === 0) return "今天 " + hm;
    if (n === 1) return "昨天 " + hm;
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 " + hm;
  }
  function fullDate(t) {
    if (!t) return "--";
    var d = new Date(t);
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 " + two(d.getHours()) + ":" + two(d.getMinutes());
  }
  var longDate = function (t) { return t ? fullDate(t) + ":" + two(new Date(t).getSeconds()) : "--"; }; // 快速查看的卡片、简介：带秒

  // ======== 本机记下的东西：上次打开时间、创建时间（沙盒只记修改时间）、标签、废纸篓里每一项原来在哪。改名 / 移动时跟着走 ========
  var meta = store.get("tsu-finder-meta", {});
  var MKEYS = ["open", "birth", "tags", "trash"];
  MKEYS.forEach(function (k) { if (!meta[k] || typeof meta[k] !== "object") meta[k] = {}; });
  var metaT = 0, tagVer = 0;
  function saveMeta() { clearTimeout(metaT); metaT = setTimeout(function () { metaT = 0; store.set("tsu-finder-meta", meta); }, 250); }
  window.addEventListener("pagehide", function () { if (metaT) { clearTimeout(metaT); metaT = 0; store.set("tsu-finder-meta", meta); } }); // 关页面前还有没写下去的（标签、打开时间……）先写
  function eachMeta(p, fn, keys) { (keys || MKEYS).forEach(function (k) { Object.keys(meta[k]).forEach(function (q) { if (under(q, p)) fn(meta[k], q); }); }); }
  // 移动 / 改名：打开时间、创建时间、标签跟着新路径走；「原来在哪」只跟着还留在废纸篓里的那一项（移出废纸篓 = 放回去了，不再记）
  function remapMeta(from, to) {
    eachMeta(from, function (m, q) { m[to + q.slice(from.length)] = m[q]; delete m[q]; }, ["open", "birth", "tags"]);
    var t = meta.trash[from];
    if (t) { delete meta.trash[from]; if (parentOf(to) === TRASH) meta.trash[to] = t; }
    tagVer++;
    saveMeta();
  }
  function dropMeta(p) { eachMeta(p, function (m, q) { delete m[q]; }); tagVer++; saveMeta(); }
  function touchOpen(p) { meta.open[p] = Date.now(); saveMeta(); }
  // 创建时间：沙盒给了就用；否则用访达看着它出现的时间；都没有（访达之前就有的文件）就只能拿修改时间代替
  var created = function (p) { var st = FS.stat(p) || {}; return st.ctime || st.btime || st.birthtime || meta.birth[p] || st.mtime; };

  // ---- 标签（同 macOS 的七种颜色，只存在本机）----
  var TAGS = [["red", "红色", "#ff453a"], ["orange", "橙色", "#ff9f0a"], ["yellow", "黄色", "#ffd60a"], ["green", "绿色", "#30d158"],
    ["blue", "蓝色", "#0a84ff"], ["purple", "紫色", "#bf5af2"], ["gray", "灰色", "#98989d"]];
  var TAGC = {};
  TAGS.forEach(function (t) { TAGC[t[0]] = { n: t[1], c: t[2] }; });
  var tagsOf = function (p) { return meta.tags[p] || []; };
  function tagDots(p) {
    var t = tagsOf(p).filter(function (k) { return TAGC[k]; });
    return t.length ? '<span class="fd-dots">' + t.map(function (k) { return '<i style="background:' + TAGC[k].c + '"></i>'; }).join("") + "</span>" : "";
  }
  function setTag(paths, k, on) {
    paths.forEach(function (p) {
      var t = tagsOf(p).filter(function (x) { return x !== k; });
      if (on) t.push(k);
      if (t.length) meta.tags[p] = t; else delete meta.tags[p];
    });
    tagVer++;
    saveMeta();
    renderAll();
  }
  var allTagged = function (paths, k) { return paths.length > 0 && paths.every(function (p) { return tagsOf(p).indexOf(k) >= 0; }); };
  function tagItems(paths) {
    return TAGS.map(function (t) {
      var all = allTagged(paths, t[0]);
      return it(t[1], "", function () { setTag(paths, t[0], !all); }, !paths.length, { checked: all });
    });
  }
  // 菜单里的一排色点（同 macOS 右键菜单）：点一下加上 / 去掉
  function swatchRow(paths) {
    return { swatches: TAGS.map(function (t) { var on = allTagged(paths, t[0]); return { color: t[2], on: on, title: t[1], run: function () { setTag(paths, t[0], !on); } }; }) };
  }

  // ======== 分组（使用分组 / 分组方式）：每个文件夹记住自己的；「*」是上次用过的方式（⌃⌘0 打开分组时用它）========
  var GROUPS = [["none", "无"], ["name", "名称"], ["kind", "种类"], ["mtime", "修改日期"], ["size", "大小"], ["tags", "标签"]];
  var GORDER = { kind: ["文件夹", "文稿", "代码", "图像", "归档", "应用程序", "其他"], mtime: ["今天", "昨天", "前 7 天", "前 30 天", "更早"], size: ["大", "中", "小"],
    tags: TAGS.map(function (t) { return t[1]; }).concat(["无标签"]) };
  var groupPref = store.get("tsu-finder-group", {});
  var gwhereOf = function (S) { return S.query ? "@search" : S.cwd; };
  var gkeyOf = function (S) { return groupPref[gwhereOf(S)] || "none"; };
  // 按名称分组：拉丁字母按首字母；汉字按拼音首字母（拿每个声母的第一个字当边界，用中文排序比较）
  var PY = "阿八嚓哒妸发旮哈讥咔垃痳拏噢妑七呥扨它穵夕丫帀", PYL = "ABCDEFGHJKLMNOPQRSTWXYZ";
  function initial(name) {
    var c = name.charAt(0);
    if (/[a-z]/i.test(c)) return c.toUpperCase();
    if (/[0-9]/.test(c)) return "0–9";
    if (/[㐀-鿿]/.test(c)) { for (var i = PY.length - 1; i >= 0; i--) if (c.localeCompare(PY[i], "zh-CN") >= 0) return PYL[i]; return "A"; }
    return "#";
  }
  function bucket(p, k) {
    if (k === "name") return initial(displayName(p));
    if (k === "kind") {
      if (isApp(p)) return "应用程序";
      if (FS.isDir(p)) return "文件夹";
      var e = extOf(baseOf(p));
      return IMG[e] ? "图像" : ARCH[e] ? "归档" : CODE[e] ? "代码" : DOCS[e] ? "文稿" : "其他";
    }
    if (k === "mtime") { var d = daysAgo((FS.stat(p) || {}).mtime || 0); return d <= 0 ? "今天" : d === 1 ? "昨天" : d <= 7 ? "前 7 天" : d <= 30 ? "前 30 天" : "更早"; }
    if (k === "size") { var n = FS.isDir(p) ? treeBytes(p) : fileBytes(FS.stat(p)); return n >= 1e5 ? "大" : n >= 1e3 ? "中" : "小"; }
    if (k === "tags") { var t = tagsOf(p).filter(function (x) { return TAGC[x]; })[0]; return t ? TAGC[t].n : "无标签"; }
    return "";
  }
  function groupRank(k, name) {
    if (GORDER[k]) return GORDER[k].indexOf(name);
    return name === "0–9" ? 0 : name === "#" ? 99 : name.charCodeAt(0) - 63;
  }

  // ======== 图标（SVG）========
  var EXT_COLOR = { md: "#6e6e73", js: "#c9a400", ts: "#2f74c0", py: "#3572a5", json: "#8a6d3b", html: "#e44d26", css: "#264de4", sh: "#2e8b57", zip: "#7a6a58",
    docx: "#2b579a", doc: "#2b579a", xlsx: "#217346", xls: "#217346", pptx: "#d24726", ppt: "#d24726", ics: "#e0443e" };
  function folderSvg() {
    return '<svg viewBox="0 0 64 52" class="fd-svg"><path d="M3 9.5A4.5 4.5 0 0 1 7.5 5h15.2c1.3 0 2.5.5 3.3 1.5L29 10h27.5A4.5 4.5 0 0 1 61 14.5V16H3z" fill="#4ea5ec"/>' +
      '<rect x="3" y="13" width="58" height="36" rx="4.5" fill="#6ec1fb"/><rect x="3" y="13" width="58" height="1.6" rx=".8" fill="#a6dcff"/></svg>';
  }
  function fileSvg(name) {
    var ext = extOf(name), tag = ext.slice(0, 4).toUpperCase(), col = EXT_COLOR[ext] || "#8e8e93";
    return '<svg viewBox="0 0 64 64" class="fd-svg"><path d="M13 3h26l14 14v42a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="#fff" stroke="rgba(0,0,0,.18)"/>' +
      '<path d="M39 3v11a3 3 0 0 0 3 3h11" fill="#e9e9ee" stroke="rgba(0,0,0,.18)"/>' +
      (ARCH[ext] ? '<path d="M30 3v4h4v4h-4v4h4v4h-4v4h4v4h-4" fill="none" stroke="#9a9aa0" stroke-width="2"/><rect x="28" y="31" width="8" height="7" rx="1.5" fill="none" stroke="#9a9aa0" stroke-width="1.6"/>'
        : '<g stroke="#d6d6dc" stroke-width="1.6"><path d="M18 26h28M18 31h28M18 36h22"/></g>') +
      (tag ? '<text x="32" y="53" text-anchor="middle" font-family="-apple-system,Helvetica,sans-serif" font-weight="700" font-size="' + (tag.length > 3 ? 8.5 : 10) + '" fill="' + col + '">' + esc(tag) + "</text>" : "") + "</svg>";
  }
  var trashFull = function () { try { return FS.isDir(TRASH) && FS.list(TRASH).length > 0; } catch (e) { return false; } };
  function trashIco() { return '<span class="fd-trashico">' + (D.trashIcon ? D.trashIcon(trashFull()) : folderSvg()) + "</span>"; }
  var stroke = function (d, w) { return '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="' + (w || 1.3) + '" stroke-linecap="round" stroke-linejoin="round"/>'; };
  var svg16 = function (body) { return '<svg viewBox="0 0 16 16">' + body + "</svg>"; };
  // 侧边栏的小图标（线条，跟强调色）
  var SIDE_ICON = {
    recents: svg16('<circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" stroke-width="1.3"/>' + stroke("M8 4.6V8l2.3 1.5")),
    apps: svg16(stroke("M4.6 13.2 8 3.2l3.4 10M2.8 9.8h10.4", 1.35)),
    home: svg16(stroke("M2.5 7.5 8 3l5.5 4.5M4 6.5V13h3V9.5h2V13h3V6.5")),
    upload: svg16(stroke("M8 10.2V2.6M5.2 5.3 8 2.5l2.8 2.8") + stroke("M2.6 9.4v3c0 .7.5 1.2 1.2 1.2h8.4c.7 0 1.2-.5 1.2-1.2v-3")),
    tmp: svg16(stroke("M2.4 9.4h3.2l1 1.8h2.8l1-1.8h3.2M2.4 9.4 4.3 3.6h7.4l1.9 5.8v3.2c0 .5-.4.9-.9.9H3.3c-.5 0-.9-.4-.9-.9z")),
    root: svg16('<rect x="2" y="4.5" width="12" height="7" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="11.3" cy="8" r=".9" fill="currentColor"/>'),
  };
  var PLACES = [{ h: "个人收藏" }, { path: RECENTS, name: "最近使用", icon: "recents" }, { path: APPS, name: "应用程序", icon: "apps" }, { path: HOME, name: "个人", icon: "home" },
    { path: UPLOADS, name: "上传", icon: "upload" }, { path: "/tmp", name: "临时", icon: "tmp" }, { h: "位置" }, { path: "/", name: "根目录", icon: "root" }];
  // 工具栏、快速查看、标签页栏上的按钮
  var TB = {
    back: svg16(stroke("M10 3 5 8l5 5", 1.7)),
    fwd: svg16(stroke("m6 3 5 5-5 5", 1.7)),
    icons: svg16('<g fill="currentColor"><rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="9" y="2" width="5" height="5" rx="1.2"/><rect x="2" y="9" width="5" height="5" rx="1.2"/><rect x="9" y="9" width="5" height="5" rx="1.2"/></g>'),
    list: svg16('<g fill="currentColor"><circle cx="2.9" cy="4" r="1.1"/><circle cx="2.9" cy="8" r="1.1"/><circle cx="2.9" cy="12" r="1.1"/><rect x="5.4" y="3.3" width="8.8" height="1.4" rx=".7"/><rect x="5.4" y="7.3" width="8.8" height="1.4" rx=".7"/><rect x="5.4" y="11.3" width="8.8" height="1.4" rx=".7"/></g>'),
    columns: svg16('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/>' + stroke("M6 3.2v9.6M10 3.2v9.6")),
    gallery: svg16('<rect x="1.8" y="1.9" width="12.4" height="8.4" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.3"/><g fill="currentColor"><rect x="1.8" y="11.7" width="3.3" height="2.6" rx=".7"/><rect x="6.35" y="11.7" width="3.3" height="2.6" rx=".7"/><rect x="10.9" y="11.7" width="3.3" height="2.6" rx=".7"/></g>'),
    group: '<svg viewBox="0 0 22 16" class="fd-wide"><g fill="currentColor"><rect x="1.5" y="2.5" width="4" height="4" rx="1"/><rect x="7" y="2.5" width="4" height="4" rx="1"/><rect x="1.5" y="9.5" width="4" height="4" rx="1"/><rect x="7" y="9.5" width="4" height="4" rx="1"/></g>' + stroke("m15 6.8 2.5 2.5L20 6.8") + "</svg>",
    dir: svg16('<path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3.2l1.3 1.4H13c.7 0 1.2.5 1.2 1.2v6.6c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z" fill="none" stroke="currentColor" stroke-width="1.25"/>'),
    newdir: svg16('<path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3.2l1.3 1.4H13c.7 0 1.2.5 1.2 1.2v6.6c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z" fill="none" stroke="currentColor" stroke-width="1.2"/>' + stroke("M8 7v4M6 9h4", 1.2)),
    tag: svg16(stroke("M2.5 3.3v4.3c0 .4.2.8.5 1.1l5.1 5.1c.6.6 1.5.6 2.1 0l3.1-3.1c.6-.6.6-1.5 0-2.1L8.2 3.5c-.3-.3-.7-.5-1.1-.5H2.8c-.2 0-.3.1-.3.3z", 1.25) + '<circle cx="5.4" cy="5.9" r="1" fill="currentColor"/>'),
    insp: svg16('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/>' + stroke("M10.2 3.2v9.6") + '<rect x="10.8" y="3.6" width="2.6" height="8.8" rx=".7" fill="currentColor" opacity=".45"/>'),
    search: svg16('<circle cx="7" cy="7" r="4.3" fill="none" stroke="currentColor" stroke-width="1.4"/>' + stroke("m10.2 10.2 3.3 3.3", 1.4)),
    close: svg16(stroke("M4.5 4.5l7 7M11.5 4.5l-7 7", 1.5)),
    full: svg16(stroke("M9.6 2.6h3.8v3.8M6.4 13.4H2.6V9.6M13.2 2.8 9.4 6.6M2.8 13.2l3.8-3.8", 1.35)),
    share: svg16(stroke("M8 10V1.9M5.3 4.4 8 1.7l2.7 2.7") + stroke("M5.6 6.4H4.2c-.7 0-1.2.5-1.2 1.2v5.2c0 .7.5 1.2 1.2 1.2h7.6c.7 0 1.2-.5 1.2-1.2V7.6c0-.7-.5-1.2-1.2-1.2h-1.4")),
    down: svg16(stroke("m4.5 6.3 3.5 3.5 3.5-3.5", 1.5)),
    plus: svg16(stroke("M8 3.2v9.6M3.2 8h9.6", 1.4)),
  };
  // 右键菜单项前的小图标（同 macOS）
  var MI = {
    trash: svg16(stroke("M2.8 4.4h10.4M6.1 4.4V3c0-.4.3-.7.7-.7h2.4c.4 0 .7.3.7.7v1.4M4.2 4.4l.7 8.8c.1.6.5 1 1.1 1h4c.6 0 1-.4 1.1-1l.7-8.8M6.7 6.9v4.7M9.3 6.9v4.7", 1.15)),
    share: TB.share,
    tag: TB.tag,
    gear: svg16('<circle cx="8" cy="8" r="2.1" fill="none" stroke="currentColor" stroke-width="1.2"/>' + stroke("M8 1.9v1.9M8 12.2v1.9M1.9 8h1.9M12.2 8h1.9M3.7 3.7l1.3 1.3M11 11l1.3 1.3M3.7 12.3 5 11M11 5l1.3-1.3", 1.2)),
  };

  // ======== 缩略图：文稿画成一页纸（按终端的样子渲染前面一段再缩小），图片直接显示，.app 用它在 Dock 上的图标 ========
  var cellW = 0;
  function cell() { // 终端字体一格多宽（量 100 个 0）
    if (cellW) return cellW;
    var pre = document.createElement("pre"), s = document.createElement("span");
    pre.className = "terminal-style-ui";
    pre.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;padding:0";
    s.textContent = "0".repeat(100);
    pre.appendChild(s);
    document.body.appendChild(pre);
    cellW = s.getBoundingClientRect().width / 100 || 7.8;
    pre.remove();
    return cellW;
  }
  document.addEventListener("tsu-font", function () { cellW = 0; });
  function ttuHtml(p, text, cols) {
    try { return TTU.renderFile(baseOf(p), text, { width: cols, theme: light() ? "light" : "dark" }).html; } catch (e) { return esc(text); }
  }
  // 图片：二进制的（上传的 PNG、JPEG……）用 Blob URL（文件变了才换）；文本的 SVG 直接用；内容是 data: URL 或 base64 的位图也能显示
  var binURLs = {};
  function imageURL(p) {
    var ext = extOf(baseOf(p)), st = FS.stat(p), text;
    if (!IMG[ext] || !st || st.dir) return null;
    if (st.bin) {
      var c = binURLs[p];
      if (c && c.mtime === st.mtime) return c.url;
      if (c) URL.revokeObjectURL(c.url);
      binURLs[p] = { mtime: st.mtime, url: URL.createObjectURL(new Blob([st.bin], { type: IMG[ext] })) };
      return binURLs[p].url;
    }
    try { text = FS.read(p); } catch (e) { return null; }
    var t = text.trim();
    if (/^data:image\//.test(t)) return t;
    if (ext === "svg") return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
    if (t.length > 16 && /^[A-Za-z0-9+/=\s]+$/.test(t)) return "data:" + IMG[ext] + ";base64," + t.replace(/\s+/g, "");
    return null;
  }
  // PDF 的地址（快速查看里交给浏览器 / WebKit 自己的 PDF 阅读器）；真沙盒里还没取回来的（lazy）给 null
  function pdfURL(p) {
    var st = FS.stat(p), u8 = st && (st.bin || (typeof st.data === "string" && st.data ? new TextEncoder().encode(st.data) : null));
    if (!u8) return null;
    var c = binURLs[p];
    if (c && c.mtime === st.mtime) return c.url;
    if (c) URL.revokeObjectURL(c.url);
    binURLs[p] = { mtime: st.mtime, url: URL.createObjectURL(new Blob([u8], { type: "application/pdf" })) };
    return binURLs[p].url;
  }
  var thumbCache = new Map();
  // 一页纸：w × h；rich = 用 TTU 上色排版（画廊的大图），否则纯文字（图标小，省时间），底下写扩展名
  function pageThumb(p, w, h, rich) {
    var st = FS.stat(p) || {}, key = [p, st.mtime, st.lazy ? 1 : 0, w, h, rich ? 1 : 0, light() ? 1 : 0].join("|");
    if (thumbCache.has(key)) return thumbCache.get(key);
    var text = "";
    try { text = FS.read(p); } catch (e) {}
    var cols = rich ? 64 : 44, pad = rich ? 14 : 10, preW = cols * cell() + pad * 2, s = w / preW;
    var rows = Math.ceil(h / s / 17) + 1, src = text.split("\n").slice(0, rows).join("\n").slice(0, rows * cols * 2);
    var ext = extOf(baseOf(p)).slice(0, 4).toUpperCase();
    var html = '<span class="fd-page' + (light() ? "" : " fd-page-dark") + '" style="width:' + w + "px;height:" + h + 'px">' +
      '<pre class="terminal-style-ui' + (light() ? " ttu-light" : "") + '" style="width:' + preW.toFixed(1) + "px;padding:" + pad + "px;transform:scale(" + s.toFixed(4) + ')">' +
      (rich ? ttuHtml(p, src, cols) : esc(src)) + "</pre>" + (ext && !rich ? '<i class="fd-page-ext">' + esc(ext) + "</i>" : "") + "</span>";
    if (thumbCache.size > 400) thumbCache.clear();
    thumbCache.set(key, html);
    return html;
  }
  // ---- Office 文稿（.docx / .xlsx / .pptx，老的 .xls / .ods / .numbers，iWork 的 .pages / .key）：内容的预览与缩略图（office/preview.js，第一次用时才载入）----
  var OFC_EXT = { docx: 1, docm: 1, xlsx: 1, xlsm: 1, xls: 1, ods: 1, numbers: 1, pptx: 1, pptm: 1, pages: 1, key: 1 };
  var officeish = function (p) { return !!OFC_EXT[extOf(baseOf(p))] && FS.exists(p) && !FS.isDir(p); };
  var ofcBad = {}; // 预览不了的（坏文件、读取失败）：按路径 + 修改时间记着，别再试
  var ofcKey = function (p) { var st = FS.stat(p) || {}; return p + "|" + st.mtime + "|" + st.size; };
  function ofcPV() {
    var O = window.TSU_OFFICE;
    if (!O || !O.loadScript) return Promise.reject(new Error("no office"));
    return O.loadScript(O.BASE + "preview.js").then(function () { if (!O.preview) throw new Error("no preview"); return O.preview; });
  }
  // 缩略图：已经做好了就直接给；没有就先放文稿图标，做好了原地换掉（列表不重画）
  var ofcSeq = 0;
  function ofcThumb(p, w, h) {
    if (ofcBad[ofcKey(p)]) return null;
    var PV = window.TSU_OFFICE && TSU_OFFICE.preview, hit = PV ? PV.cachedThumb(p, w, h) : undefined;
    if (hit) return hit;
    if (hit === null) return null;
    var id = "fd-ofc-" + (++ofcSeq), k = ofcKey(p);
    ofcPV().then(function (pv) { return pv.thumb(p, w, h); }).then(function (html) {
      if (!html) { ofcBad[k] = 1; return; }
      var slot = document.getElementById(id);
      if (slot) slot.outerHTML = html;
    }, function () {});
    return '<span class="fd-ofc-slot" id="' + id + '">' + fileSvg(baseOf(p)) + "</span>";
  }
  // 行里的小图标（big = 图标 / 画廊里的大图：文稿画成一页纸、图片直接显示）
  function iconHtml(p, size, big) {
    var info = appInfo(p);
    if (info) return appIcon(info.id, size);
    if (p === TRASH) return trashIco();
    if (FS.isDir(p)) return folderSvg();
    if (big) {
      var u = imageURL(p);
      if (u) return '<img class="fd-img" src="' + esc(u) + '" alt="" draggable="false">';
      if (textish(p)) return pageThumb(p, Math.round(size * 0.74), Math.round(size * 0.96), false);
      if (officeish(p)) { var t = ofcThumb(p, Math.round(size * 0.96), Math.round(size * 0.96)); if (t) return t; }
    }
    return fileSvg(baseOf(p));
  }
  // 大图标 / 大缩略图：高 h（画廊、快速查看的卡片、预览里没法显示内容的东西）
  function bigThumb(p, h) {
    var info = appInfo(p);
    if (info) return appIcon(info.id, Math.round(Math.min(h * 0.72, 220)));
    if (p === TRASH) return '<span class="fd-bigico" style="width:' + Math.round(Math.min(h * 0.8, 200)) + 'px">' + trashIco() + "</span>";
    if (FS.isDir(p)) return '<span class="fd-bigico" style="width:' + Math.round(Math.min(h * 0.85, 240)) + 'px">' + folderSvg() + "</span>";
    var u = imageURL(p);
    if (u) return '<img class="fd-bigimg" style="max-height:' + h + 'px" src="' + esc(u) + '" alt="" draggable="false">';
    if (officeish(p)) { var t = ofcThumb(p, Math.round(h * 0.77), h); if (t) return t; } // 第一页 / 第一张幻灯片 / 表格左上角
    if (!textish(p)) return '<span class="fd-bigico" style="width:' + Math.round(Math.min(h * 0.8, 180)) + 'px">' + fileSvg(baseOf(p)) + "</span>";
    return pageThumb(p, Math.round(h * 0.77), h, true);
  }

  // ---- App 图标：照着 Dock 上那个图标克隆一份，把算好的样式写死在元素上（有的 App 的图标样式只写在 #dock 下面，拿出来就没了）----
  var ICON_CSS = ["background-image", "background-color", "background-size", "background-position", "background-repeat", "color", "font-family", "font-size",
    "font-weight", "font-style", "line-height", "letter-spacing", "text-shadow", "text-align", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "display", "align-items", "justify-content", "position", "top", "left", "filter", "box-shadow", "border-radius", "width", "height", "box-sizing", "opacity", "--r"];
  function styledClone(src) {
    var out = src.cloneNode(true);
    (function copy(a, b) {
      var cs = getComputedStyle(a);
      b.setAttribute("style", ICON_CSS.map(function (k) { var v = cs.getPropertyValue(k); return v ? k + ":" + v : ""; }).filter(Boolean).join(";"));
      for (var i = 0; i < a.children.length; i++) {
        var c = a.children[i];
        if (!(c instanceof SVGElement) || c.tagName.toLowerCase() === "svg") copy(c, b.children[i]);
      }
    })(src, out);
    return out;
  }
  var dockEl = function (id) { return Array.prototype.find.call(document.querySelectorAll("#dock [data-app]"), function (a) { return a.dataset.app === id; }); };
  var appIcons = {};
  function appIcon(id, size) {
    var c = appIcons[id];
    if (!c) {
      var a = dockEl(id), ico = a && a.querySelector(".ico"), entry = appEntry(id);
      if (ico) c = { html: styledClone(ico).outerHTML, w: ico.offsetWidth || 50 };
      else c = { html: '<span class="fd-appraw">' + (entry && entry.icon ? entry.icon : esc(((entry && entry.name) || id).slice(0, 1))) + "</span>", w: 50 };
      appIcons[id] = c;
    }
    return '<span class="fd-appico" style="width:' + size + "px;height:" + size + 'px"><span style="transform:scale(' + (size / c.w).toFixed(4) + ')">' + c.html + "</span></span>";
  }

  // ======== App 列表 → /Applications ========
  var appsCache = [];
  // 桌面给了 appList() 就用它；没有就看 Dock 上的图标
  function appList() {
    var list = null;
    try { if (D.appList) list = D.appList(); } catch (e) { list = null; }
    if (!list || !list.length) list = Array.prototype.map.call(document.querySelectorAll("#dock [data-app]"), function (a) { return { id: a.dataset.app, name: a.title || a.dataset.app }; });
    appsCache = list.filter(function (a) { return a && a.id; });
    return appsCache;
  }
  var appEntry = function (id) { return appsCache.find(function (a) { return a.id === id; }); };
  var appName = function (id, dflt) { var e = appEntry(id) || (appList(), appEntry(id)); return (e && e.name) || dflt; };
  var exportName = function () { return appName("export", "导出"); };
  // 每个 App 一个 <名字>.app/Info.json；内容没变就不写（不打扰修改时间）；prune = 去掉列表里已经没有的（只在桌面给了正式的 App 列表时）
  function syncApps(prune) {
    var list = appList(), want = {};
    appIcons = {};
    try {
      if (!FS.isDir(APPS)) FS.mkdirp(APPS);
      list.forEach(function (a) {
        var dir = join(APPS, String(a.name || a.id).replace(/\//g, "-") + ".app"), f = dir + "/Info.json";
        var info = JSON.stringify({ id: a.id, name: a.name || a.id, version: a.version || "1.0" }, null, 2) + "\n";
        want[dir] = 1;
        if (!FS.exists(f) || FS.read(f) !== info) FS.write(f, info);
      });
      if (prune && D.appList) FS.list(APPS).forEach(function (d) { if (!want[d] && isApp(d)) FS.remove(d, true); });
    } catch (e) { /* 写不了就算了，不影响浏览 */ }
  }
  function launch(id) {
    if (D.launch) return D.launch(id);
    var a = dockEl(id);
    if (a) return a.click(); // Dock 的点击会打开或调到最前（懒加载的 App 也走这里）
    var w = D.apps[id];
    if (w) { if (w.state === "closed" || w.state === "min") w.show(); else w.front(); }
  }

  // ======== 用什么打开：候选 App，第一个是默认 ========
  function blobURL(p) {
    var ext = extOf(baseOf(p)), u = imageURL(p);
    if (u) return u;
    return URL.createObjectURL(new Blob([FS.read(p)], { type: (HTML[ext] ? "text/html" : "text/plain") + ";charset=utf-8" }));
  }
  // 终端：脚本在它所在的文件夹里跑（python3 / node），别的文件 cat。用文件名、不用完整路径：开了真沙盒时访达的路径和真沙盒里的不一样
  function termOpener(p) {
    var T = window.TSU_TERM;
    if (!T) return null;
    var ext = extOf(baseOf(p)), q = "'" + baseOf(p).replace(/'/g, "'\\''") + "'";
    var cmd = ext === "py" ? "python3 " + q : ext === "js" || ext === "mjs" ? "node " + q : ext === "sh" ? "sh " + q : "cat " + q;
    var run = typeof T.run === "function" ? function () { T.run(cmd, parentOf(p)); } : typeof T.open === "function" ? function () { T.open(parentOf(p)); } : null;
    return run ? { id: "term", name: appName("win", "终端"), run: run } : null;
  }
  // 别的 App 登记自己能开的文件：(window.TSU_OPENERS = window.TSU_OPENERS || []).push({ id, name, exts: ["docx", …], open(path) })——排在最前（默认）
  function registered(p) {
    var ext = extOf(baseOf(p));
    return (window.TSU_OPENERS || []).filter(function (o) { return o && o.exts && o.exts.indexOf(ext) >= 0 && typeof o.open === "function"; })
      .map(function (o) { return { id: o.id, name: o.name || appName(o.id, o.id), run: function () { o.open(p); } }; });
  }
  function openers(p) {
    if (!p || FS.isDir(p)) return [];
    var reg = registered(p);
    if (reg.length) return reg.concat(openersBuiltin(p).filter(function (o) { return !reg.some(function (r) { return r.id === o.id; }); }));
    return openersBuiltin(p);
  }
  function openersBuiltin(p) {
    var ext = extOf(baseOf(p)), out = [], term = termOpener(p);
    var ide = window.TSU_IDE && TSU_IDE.open ? { id: "ide", name: appName("ide", "编辑器"), run: function () { TSU_IDE.open(p); } } : null;
    var web = window.TSU_SAFARI && TSU_SAFARI.open ? { id: "safari", name: appName("safari", "Safari浏览器"), run: function () { TSU_SAFARI.open(blobURL(p)); } } : null;
    if (isBin(p)) return web && IMG[ext] ? [web] : []; // 二进制：只有图片能交给浏览器
    if (web && (HTML[ext] || IMG[ext])) out.push(web);
    if (ide && (!IMG[ext] || ext === "svg")) out.push(ide);
    if (term && (SCRIPT[ext] || !ide) && !IMG[ext]) out.push(term);
    return out;
  }

  // ======== 移动（SANDBOX.move：b 是已有目录时移进去）；本机记的标签、打开时间跟着走，开着的「简介」窗口也跟着换路径 ========
  function mv(from, to) {
    var dest = FS.isDir(to) ? join(to, baseOf(from)) : to;
    if (FS.move) FS.move(from, to);
    else { FS.copy(from, to); FS.remove(from, true); }
    remapMeta(from, dest);
    infos.forEach(function (w) { if (under(w.path, from)) w.path = dest + w.path.slice(from.length); });
    return dest;
  }
  // 改名 → 新路径；不行就 say(原因) 返回 null
  function renameTo(p, name, say) {
    name = String(name || "").trim();
    if (!name || name === baseOf(p)) return null;
    if (name.indexOf("/") >= 0 || name === "." || name === "..") { say("名称里不能有“/”"); return null; }
    var to = join(parentOf(p), name);
    if (FS.exists(to)) { say("“" + name + "”已存在，请换一个名称"); return null; }
    try { return mv(p, to); } catch (e) { say(e.message); return null; }
  }

  // ======== 废纸篓：~/.Trash（同 macOS）。移进去时记下原来的位置（「放回原处」用）；立即删除、清倒废纸篓要确认，删了就不能恢复 ========
  var trashWas = null;
  function syncTrash() { var f = trashFull(); if (f !== trashWas) { trashWas = f; if (D.trashChanged) D.trashChanged(); } }
  // 移到废纸篓 → 废纸篓里的新路径；系统文件夹、App、已经在废纸篓里的跳过
  function toTrash(paths, say) {
    var out = [];
    paths.forEach(function (p) {
      if (!FS.exists(p) || fixed(p) || under(p, TRASH) || under(TRASH, p)) return;
      try {
        if (!FS.isDir(TRASH)) FS.mkdirp(TRASH);
        var dest = mv(p, join(TRASH, freeName(TRASH, baseOf(p))));
        meta.trash[dest] = { from: p, t: Date.now() };
        out.push(dest);
      } catch (e) { say(e.message); }
    });
    saveMeta();
    syncTrash();
    return out;
  }
  // 放回原处：原来的文件夹没了就重建；原处已有同名的，换个名字（「名字 2」）
  function putBack(paths, say) {
    var out = [];
    paths.forEach(function (p) {
      var rec = meta.trash[p];
      if (!rec || !FS.exists(p)) return;
      try {
        var to = rec.from, dir = parentOf(to);
        if (!FS.isDir(dir)) FS.mkdirp(dir);
        if (FS.exists(to)) to = join(dir, freeName(dir, baseOf(to)));
        out.push(mv(p, to));
      } catch (e) { say(e.message); }
    });
    syncTrash();
    return out;
  }
  // 立即删除（不经过废纸篓）/ 清倒废纸篓：先问，默认按钮是「取消」
  function eraseForever(paths, winId, done) {
    paths = paths.filter(function (p) { return FS.exists(p) && !fixed(p); });
    if (!paths.length) return;
    var what = paths.length === 1 ? "“" + displayName(paths[0]) + "”" : "这 " + paths.length + " 个项目";
    D.alert({ window: winId, title: "确定要删除" + what + "吗？", message: "此项目将被立即删除。你不能撤销此操作。", icon: "caution",
      buttons: [{ label: "取消", role: "cancel" }, { label: "删除", role: "destructive" }] }).then(function (b) {
      if (b !== "删除") return;
      paths.forEach(function (p) { try { if (FS.exists(p)) FS.remove(p, true); dropMeta(p); } catch (e) { /* 删不了的留着 */ } });
      syncTrash();
      if (done) done();
    });
  }
  function emptyTrash(winId) {
    if (!trashFull()) return;
    D.alert({ window: winId, title: "确定要永久抹掉废纸篓中的项目吗？", message: "你不能撤销此操作。", icon: "caution",
      buttons: [{ label: "取消", role: "cancel" }, { label: "清倒废纸篓", role: "destructive" }] }).then(function (b) {
      if (b !== "清倒废纸篓") return;
      FS.list(TRASH).forEach(function (p) { try { FS.remove(p, true); dropMeta(p); } catch (e) { /* 删不了的留着 */ } });
      syncTrash();
    });
  }

  // ======== 拷贝 / 粘贴项目：访达内部记着拷贝的是哪些；路径也写进系统剪贴板（终端里能粘贴）========
  var clip = [];
  function copyItems(paths, say) {
    clip = paths.slice();
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(paths.join("\n")).catch(function () {});
    say(paths.length === 1 ? "已拷贝“" + displayName(paths[0]) + "”" : "已拷贝 " + paths.length + " 项");
  }

  // ======== 终端式滚动（阻尼）：TTU 渲染的预览都按整行走，同 live.js 里终端的 wheelAcc / scrollByRows ========
  // 滚轮 / 触控板：累加像素，满一行走一行，方向一反就清零；横向滚动、⌃ / ⌘（缩放）不管；图片上原生滚。键盘：↑↓ 一行、PageUp / PageDown / 空格 一页、Home / End。
  // fit：可视高度取整到整行，零头放在下面——上面永远正好空一行（pre 的上内边距），底下不会露半行；不显示滚动条、滚到头不回弹（CSS）
  function rowScroll(box) {
    var acc = 0;
    function rowH() { var pre = box.querySelector("pre.terminal-style-ui"); return pre ? parseFloat(getComputedStyle(pre).lineHeight) || 0 : 0; }
    function by(n) {
      var h = rowH();
      if (!h) return;
      box.scrollTop = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, Math.round(box.scrollTop / h + n) * h));
    }
    box.addEventListener("wheel", function (e) {
      var h = rowH();
      if (!h || e.ctrlKey || e.metaKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (e.target.closest && e.target.closest("img")) { acc = 0; return; }
      e.preventDefault();
      var px = e.deltaMode === 1 ? e.deltaY * h : e.deltaMode === 2 ? e.deltaY * box.clientHeight : e.deltaY;
      if (Math.sign(px) !== Math.sign(acc)) acc = 0;
      acc += px;
      var n = Math.trunc(acc / h);
      if (!n) return;
      acc -= n * h;
      by(n);
    }, { passive: false });
    return {
      rowH: rowH,
      by: by,
      key: function (e) {
        var h = rowH(), k = e.key;
        if (!h) return false;
        var page = Math.max(1, Math.floor(box.clientHeight / h) - 1);
        if (k === "ArrowDown") by(1);
        else if (k === "ArrowUp") by(-1);
        else if (k === "PageDown" || (k === " " && !e.shiftKey)) by(page);
        else if (k === "PageUp" || (k === " " && e.shiftKey)) by(-page);
        else if (k === "Home") box.scrollTop = 0;
        else if (k === "End") by(1e6);
        else return false;
        return true;
      },
      fit: function (avail) {
        var h = rowH();
        if (!h) { box.style.flex = box.style.height = box.style.marginBottom = ""; return; }
        var n = Math.max(1, Math.floor(avail / h));
        box.style.flex = "none";
        box.style.height = n * h + "px";
        box.style.marginBottom = avail - n * h + "px";
      },
    };
  }

  // ======== 真的预览（预览面板顶上、分栏的预览栏）：文稿按终端的样子排版（真实字号、跟着宽度折行、上面空一整行、按整行滚），
  // 图片按框缩放，App / 文件夹 / 看不了内容的是大图标。宽 w、最高 maxH；内容、大小、主题都没变就不重画 ========
  var LIVE_MAX = 400;
  function drawLive(box, p, w, maxH) {
    var st = FS.stat(p) || {}, key = [p, st.mtime, st.lazy ? 1 : 0, Math.round(w), Math.round(maxH), light() ? 1 : 0, cell()].join("|");
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = "";
    box.className = "fd-live";
    box.style.height = "";
    var url = !FS.isDir(p) && imageURL(p);
    if (url) {
      box.classList.add("fd-live-img");
      box.innerHTML = '<img alt="" draggable="false">';
      box.firstChild.style.maxHeight = maxH + "px";
      box.firstChild.src = url;
      return;
    }
    if (officeish(p) && !ofcBad[ofcKey(p)]) { // Office：第一页 / 第一张幻灯片 / 第一张表，按面板的宽度
      box.classList.add("fd-live-ico", "fd-live-ofc");
      var tw = Math.round(Math.min(w, 320)), th = Math.round(Math.min(maxH, 260)), t = ofcThumb(p, tw, th);
      box.innerHTML = t || bigThumb(p, Math.min(maxH, 190));
      return;
    }
    if (FS.isDir(p) || !textish(p)) { box.classList.add("fd-live-ico"); box.innerHTML = bigThumb(p, Math.min(maxH, 190)); return; }
    var text = "";
    try { text = FS.read(p); } catch (e) { text = e.message; }
    var lines = text.split("\n"), cut = lines.length > LIVE_MAX;
    if (cut) text = lines.slice(0, LIVE_MAX).join("\n");
    box.classList.add("fd-live-text");
    var pre = document.createElement("pre");
    pre.className = "terminal-style-ui fd-live-pre" + (light() ? " ttu-light" : "");
    box.appendChild(pre);
    if (!box._rows) box._rows = rowScroll(box);
    var h = box._rows.rowH() || 17, padX = 12;
    pre.style.padding = h + "px " + padX + "px";
    var cols = Math.max(16, Math.floor((w - padX * 2) / cell()) - 1);
    pre.innerHTML = text ? ttuHtml(p, text, cols) + (cut ? '\n<span class="fd-note">…… 只显示前 ' + LIVE_MAX + " 行；按空格用快速查看看全部</span>" : "") : '<span class="fd-note">（空文件）</span>';
    var rows = Math.max(3, Math.floor(Math.min(pre.offsetHeight, maxH) / h));
    box.style.height = rows * h + "px";
    box.scrollTop = 0;
  }
  // 信息：左边灰色的名目，右边的值；有所有者 / 权限（沙盒的 Unix 权限）就一起列出；废纸篓里的写上原来在哪
  function infoRows(p) {
    var st = FS.stat(p) || {}, info = appInfo(p), rows = [["创建时间", fullDate(created(p))], ["修改时间", fullDate(st.mtime)], ["上次打开时间", fullDate(meta.open[p])]];
    if (info) rows.push(["版本", info.version || (appEntry(info.id) || {}).version || "1.0"]);
    else if (FS.isDir(p)) rows.push(["项目数", countOf(p) + " 项"]);
    else rows.push(["大小", sizeOf(p)]);
    if (meta.trash[p]) rows.push(["原来的位置", parentOf(meta.trash[p].from).replace(HOME, "~")]);
    if (st.owner) rows.push(["所有者", st.owner]);
    if (typeof st.mode === "number") {
      var m = FS.modeStr ? FS.modeStr(st).slice(1) : "";
      rows.push(["权限", (m ? m + " " : "") + "(" + (st.mode & 511).toString(8).padStart(3, "0") + ")"]);
    }
    return '<div class="fd-kv">' + rows.map(function (r) { return "<div><span>" + esc(r[0]) + "</span><span>" + esc(r[1]) + "</span></div>"; }).join("") + "</div>";
  }
  function tagChips(p) {
    return tagsOf(p).filter(function (k) { return TAGC[k]; }).map(function (k) {
      return '<span class="fd-chip"><i style="background:' + TAGC[k].c + '"></i>' + TAGC[k].n + '<b data-a="untag" data-tag="' + k + '" title="移除标签">✕</b></span>';
    }).join("");
  }
  // 快速查看的小卡片（App、文件夹、看不了内容的文件）：左边大图标，右边名称、版本 / 种类、大小、修改时间（同 macOS）
  function cardHtml(p) {
    var st = FS.stat(p) || {}, info = appInfo(p), lines = [];
    if (info) lines.push("版本 " + (info.version || (appEntry(info.id) || {}).version || "1.0"), sizeOf(p));
    else if (FS.isDir(p)) lines.push(p === TRASH ? "废纸篓" : "文件夹", countOf(p) + " 项");
    else lines.push(kindOf(p), sizeOf(p));
    if (meta.trash[p]) lines.push("原来在：" + parentOf(meta.trash[p].from).replace(HOME, "~"));
    lines.push("上次修改时间：" + longDate(st.mtime));
    var ico = info ? appIcon(info.id, 176) : p === TRASH ? '<span class="fd-bigico" style="width:170px">' + trashIco() + "</span>"
      : FS.isDir(p) ? '<span class="fd-bigico" style="width:188px">' + folderSvg() + "</span>" : '<span class="fd-bigico" style="width:150px">' + fileSvg(baseOf(p)) + "</span>";
    return '<div class="fd-qlc"><div class="fd-qlc-ico">' + ico + '</div><div class="fd-qlc-info"><b>' + esc(info ? baseOf(p) : label(p)) + "</b>" +
      lines.map(function (l) { return "<span>" + esc(l) + "</span>"; }).join("") + "</div></div>";
  }

  // ======== 一个访达窗口：自己的工具栏、侧边栏、标签页、预览面板、快速查看面板 ========
  var finders = [], winSeq = 1;
  var infos = []; // 开过的「简介」窗口
  function renderAll() { finders.forEach(function (f) { if (f.win.state !== "closed") f.render(); }); refreshInfos(); }
  function toggleHidden() { showHidden = !showHidden; localStorage.setItem("tsu-finder-hidden", showHidden ? "1" : "0"); renderAll(); }
  var savedView = function () { var v = localStorage.getItem("tsu-finder-view"); return VIEWS.indexOf(v) >= 0 ? v : "list"; };
  var colDefault = +localStorage.getItem("tsu-finder-colw") || 220;
  // 一个标签页：它自己的位置、前进后退、显示方式、搜索、选中、排序、分栏的栏宽、滚动位置
  function tabState(dir, view) {
    return { cwd: dir, back: [], fwd: [], view: view || savedView(), query: "", sel: [], anchor: null, sort: { key: "name", dir: 1 }, sortSet: false,
      items: [], colDir: dir, colW: {}, openGroups: {}, top: 0, left: 0 };
  }
  var openWins = function () { return finders.filter(function (f) { return f.win.state !== "closed"; }); };
  // 刷新不丢窗口：开着的访达窗口（id）和每个窗口的标签页记在 tsu-finder-wins（位置、大小由桌面记）
  var saveWinsT = 0, winsRestored = false;
  function saveWinsSoon() {
    if (!winsRestored) return;
    clearTimeout(saveWinsT);
    saveWinsT = setTimeout(function () { store.set("tsu-finder-wins", openWins().map(function (f) { return { id: f.id, st: f.getState() }; })); }, 400);
  }
  function restoreWins() {
    var saved = store.get("tsu-finder-wins", []);
    (Array.isArray(saved) ? saved : []).forEach(function (rec) {
      if (!rec || !rec.id) return;
      var f = finders.find(function (x) { return x.id === rec.id; });
      if (!f) {
        var m = /^finder-(\d+)$/.exec(rec.id);
        if (m) winSeq = Math.max(winSeq, +m[1]);
        f = Finder(rec.id, HOME);
      }
      f.setState(rec.st);
      if (f.win.state === "closed") f.win.show();
    });
    winsRestored = true;
  }
  // 最前面的访达窗口（按桌面的叠放次序，不算最小化的）；没有就 null
  function frontFinder() {
    var ws = D.appWindows ? D.appWindows("finder") : [];
    for (var i = ws.length - 1; i >= 0; i--) {
      var f = finders.find(function (x) { return x.win === ws[i]; });
      if (f && f.win.state !== "closed" && f.win.state !== "min") return f;
    }
    return null;
  }

  function Finder(id, start, firstTab) {
    var self = {};
    var tabs = [firstTab || tabState(start || HOME)], tabIdx = 0, S = tabs[0];
    // 窗口级：预览面板开没开、多宽；正在改名的；快速查看的是哪个
    var W = { insp: localStorage.getItem("tsu-finder-insp") === "1", inspW: +localStorage.getItem("tsu-finder-inspw") || 268, renaming: null, ql: null, dirty: false };
    var undoOp = null; // 最近一次「移到废纸篓」：⌘Z 放回去

    var gkey = function () { return gkeyOf(S); };
    function setGroup(k) {
      var w = gwhereOf(S);
      if (k === "none") delete groupPref[w]; else groupPref[w] = groupPref["*"] = k;
      store.set("tsu-finder-group", groupPref);
      S.openGroups = {};
      renderAll();
    }
    function toggleGroups() { setGroup(gkey() !== "none" ? "none" : groupPref["*"] || "kind"); }
    // 实际用哪种显示：搜索结果、「最近使用」来自不同目录，分栏 / 画廊没法摆，改用列表（同 macOS）
    function mode() { return (S.query || S.cwd === RECENTS) && (S.view === "columns" || S.view === "gallery") ? "list" : S.view; }
    // 新建的东西放哪：分栏里是当前那一栏；「最近使用」、搜索结果、废纸篓里不能新建
    var here = function () { return mode() === "columns" ? S.colDir : S.cwd; };
    var canCreate = function () { return S.cwd !== RECENTS && !S.query && !under(here(), TRASH); };
    function titleOf(t, cur) {
      if (t.query) return "搜索“" + t.query + "”";
      if (cur && mode() === "columns") return label(S.sel.length === 1 && isFolder(S.sel[0]) ? S.sel[0] : S.colDir);
      return label(t.cwd);
    }
    function title() { return titleOf(S, true); }

    // ======== 界面：工具栏放进窗口自己的标题栏（统一工具栏），下面侧边栏 | （标签页栏 / 内容 | 预览面板）========
    var fd = document.createElement("div");
    fd.className = "fd";
    fd.innerHTML =
      '<nav class="fd-side"></nav>' +
      '<div class="fd-right"><div class="fd-tabs" hidden></div><div class="fd-body">' +
      '<div class="fd-main">' +
      '<div class="fd-trashbar" hidden><b>废纸篓</b><button data-a="empty" tabindex="-1">清倒</button></div>' +
      '<div class="fd-head"><span data-k="name">名称</span><span data-k="mtime">修改日期</span><span data-k="size">大小</span><span data-k="kind">种类</span></div>' +
      '<div class="fd-scroll" tabindex="0"><div class="fd-items"></div><div class="fd-empty" hidden></div></div>' +
      '<div class="fd-status"><span class="fd-crumbs"></span><span class="fd-count"></span></div>' +
      "</div>" +
      '<aside class="fd-insp" hidden><b class="fd-insp-grip" title="拖动改宽窄"></b><div class="fd-insp-in"></div></aside>' +
      "</div></div>";
    var $ = function (s) { return fd.querySelector(s); };
    var side = $(".fd-side"), tabsEl = $(".fd-tabs"), head = $(".fd-head"), scroll = $(".fd-scroll"), itemsEl = $(".fd-items"), emptyEl = $(".fd-empty");
    var crumbs = $(".fd-crumbs"), count = $(".fd-count"), insp = $(".fd-insp"), inspIn = $(".fd-insp-in"), trashBar = $(".fd-trashbar");

    var tb = document.createElement("div");
    tb.className = "fd-tb";
    var btn = function (a, t) { return '<button data-a="' + a + '" title="' + t + '" tabindex="-1">' + TB[a] + "</button>"; };
    tb.innerHTML =
      '<span class="fd-nav">' + btn("back", "返回（⌘[）") + btn("fwd", "前进（⌘]）") + "</span>" +
      '<b class="fd-title"></b><span class="fd-flex"></span>' +
      '<span class="fd-seg">' + btn("icons", "图标（⌘1）") + btn("list", "列表（⌘2）") + btn("columns", "分栏（⌘3）") + btn("gallery", "画廊（⌘4）") + "</span>" +
      btn("group", "分组方式") + btn("newdir", "新建文件夹（⇧⌘N）") + btn("tag", "标签") + btn("insp", "预览面板（⇧⌘P）") +
      '<label class="fd-search">' + TB.search + '<input type="search" placeholder="搜索" spellcheck="false"><i class="fd-clear" title="清除">✕</i></label>';
    var search = tb.querySelector("input");
    var tbBtn = function (a) { return tb.querySelector('[data-a="' + a + '"]'); };

    var win = D.createWindow({
      id: id, app: "finder", name: "访达", className: "finder", width: 1000, height: 620, content: fd,
      title: title, menus: menus, onClose: function () { closeQL(); saveWinsSoon(); },
      // 新窗口从最前面那个访达窗口往右下错开一点（同 macOS）；没有就居中
      initial: function () {
        var a = D.area(), w = Math.min(1000, a.width - 40), h = Math.min(620, a.height - 30), f = frontFinder();
        if (f && f.win !== win) { var r = f.win.rect(); return { left: Math.max(a.left, Math.min(r.left + 26, a.right - r.width)), top: Math.max(a.top, Math.min(r.top + 26, a.bottom - r.height)), width: r.width, height: r.height }; }
        return { left: a.left + Math.round((a.width - w) / 2), top: a.top + Math.max(20, Math.round((a.height - h) / 3)), width: w, height: h };
      },
    });
    win.el.querySelector(".bar").appendChild(tb);
    insp.style.width = W.inspW + "px";
    // 工具栏：按下控件不触发标题栏拖动；点按钮不抢走文件区的键盘焦点
    tb.addEventListener("pointerdown", function (e) { if (e.target.closest("button, label, input")) e.stopPropagation(); });
    tb.addEventListener("mousedown", function (e) { if (e.target.closest("button")) e.preventDefault(); });

    // ======== 读目录：排序（文件夹在前）+ 分组（分组时按组的顺序，组内按排序方式）========
    function sortList(list) {
      var k = S.sort.key, dir = S.sort.dir, st = function (p) { return FS.stat(p) || {}; };
      var val = {
        name: function (p) { return displayName(p); },
        mtime: function (p) { return st(p).mtime || 0; },
        size: function (p) { return isFolder(p) ? -1 : isApp(p) ? treeBytes(p) : fileBytes(st(p)); },
        kind: function (p) { return kindOf(p); },
      }[k];
      return list.sort(function (a, b) {
        var da = isFolder(a), db = isFolder(b);
        if (da !== db) return da ? -1 : 1;
        var va = val(a), vb = val(b);
        var c = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "zh-CN", { numeric: true, sensitivity: "base" });
        return (c || baseOf(a).localeCompare(baseOf(b))) * dir;
      });
    }
    function arrange(list, keepOrder) {
      if (!keepOrder) list = sortList(list);
      var k = gkey();
      if (k === "none") return list;
      var buckets = {}, names = [];
      list.forEach(function (p) { var b = bucket(p, k); if (!buckets[b]) { buckets[b] = []; names.push(b); } buckets[b].push(p); });
      names.sort(function (a, b) { return groupRank(k, a) - groupRank(k, b); });
      return [].concat.apply([], names.map(function (n) { return buckets[n]; }));
    }
    // 个人文件夹里不列 .Trash（废纸篓从 Dock、「前往」进）
    function entriesOf(dir) { var l; try { l = FS.list(dir).filter(function (p) { return p !== TRASH && visible(p); }); } catch (e) { l = []; } return arrange(l); }
    function listing() {
      if (S.query) {
        var q = S.query.toLowerCase(), base = S.cwd === RECENTS ? "/" : S.cwd, withTrash = under(base, TRASH);
        return arrange(FS.walk(base).filter(function (p) { return p !== base && !inBundle(p) && (withTrash || !under(p, TRASH)) && !hiddenBelow(p, base) && displayName(p).toLowerCase().indexOf(q) >= 0; }));
      }
      if (S.cwd === RECENTS) {
        return arrange(Object.keys(meta.open).filter(function (p) { return FS.exists(p) && !isFolder(p) && !inBundle(p) && !under(p, TRASH) && !hiddenBelow(p, "/"); })
          .sort(function (a, b) { return meta.open[b] - meta.open[a]; }).slice(0, 60), !S.sortSet); // 默认按上次打开的先后
      }
      return entriesOf(mode() === "columns" ? S.colDir : S.cwd);
    }

    // ======== 渲染 ========
    function render() {
      if (W.renaming) { W.dirty = true; return; } // 正在改名：先不重画（会冲掉输入框），改完再画
      W.dirty = false;
      if (S.cwd !== RECENTS && !isFolder(S.cwd)) { var up = S.cwd; while (up !== "/" && !isFolder(up)) up = parentOf(up); S.cwd = up; }
      var m = mode();
      if (m === "columns") { // 当前栏必须在窗口的文件夹里面、还存在
        var d = S.colDir;
        while (d !== S.cwd && !(under(d, S.cwd) && isFolder(d))) d = under(d, S.cwd) ? parentOf(d) : S.cwd;
        S.colDir = d;
      }
      S.items = listing();
      S.sel = S.sel.filter(function (p) { return S.items.indexOf(p) >= 0; });
      if (S.anchor && S.items.indexOf(S.anchor) < 0) S.anchor = null;
      if (m === "gallery" && !S.sel.length && S.items.length) S.sel = [S.items[0]]; // 画廊总要显示一个
      VIEWS.forEach(function (v) { fd.classList.toggle("fd-v-" + v, m === v); });
      fd.classList.toggle("fd-grouped", gkey() !== "none");
      trashBar.hidden = !(S.cwd === TRASH && !S.query);
      trashBar.querySelector("button").disabled = !trashFull();
      if (m === "columns") renderColumns(); else if (m === "gallery") renderGallery(); else renderFlat(m);
      emptyEl.hidden = S.items.length > 0 || m === "columns";
      emptyEl.textContent = S.query ? "没有找到“" + S.query + "”" : S.cwd === RECENTS ? "最近没有打开过文件" : S.cwd === TRASH ? "废纸篓是空的" : "文件夹是空的";
      chrome();
      if (W.ql) drawQL();
      saveWinsSoon();
    }
    function row(p) {
      var el = document.createElement("div");
      el.className = "fd-it" + (S.sel.indexOf(p) >= 0 ? " fd-on" : "") + (isFolder(p) ? " fd-dir" : "") + (isApp(p) ? " fd-isapp" : "") + (baseOf(p)[0] === "." ? " fd-hidden" : "");
      el.dataset.path = p;
      el.draggable = true;
      return el;
    }
    function groupHead(name, withAll) {
      var h = document.createElement("div");
      h.className = "fd-grp";
      h.dataset.g = name;
      h.innerHTML = "<b></b>" + (withAll ? '<button class="fd-grp-all" tabindex="-1" hidden></button>' : "");
      h.firstChild.textContent = name;
      return h;
    }
    // 图标 / 列表
    function renderFlat(m) {
      var k = gkey(), many = S.query || S.cwd === RECENTS, frag = document.createDocumentFragment(), host = frag, last = null, n = 0;
      itemsEl.textContent = "";
      S.items.forEach(function (p) {
        if (k !== "none") {
          var b = bucket(p, k);
          if (b !== last) { // 新的一组：组名一行；图标显示时每组自己一行（放不下时可「显示全部」）
            last = b;
            n = 0;
            frag.appendChild(groupHead(b, m === "icons"));
            if (m === "icons") { host = document.createElement("div"); host.className = "fd-grow" + (S.openGroups[b] ? " fd-open" : ""); frag.appendChild(host); }
          }
        }
        var st = FS.stat(p) || {}, el = row(p);
        if (m === "list") {
          el.innerHTML = '<span class="fd-c-name"><span class="fd-ico">' + iconHtml(p, 16) + '</span><span class="fd-nm"></span>' + tagDots(p) + (many ? '<span class="fd-loc"></span>' : "") + "</span>" +
            '<span class="fd-c-date"></span><span class="fd-c-size"></span><span class="fd-c-kind"></span>';
          el.querySelector(".fd-c-date").textContent = dateOf(st.mtime);
          el.querySelector(".fd-c-size").textContent = sizeOf(p);
          el.querySelector(".fd-c-kind").textContent = kindOf(p);
          if (many) el.querySelector(".fd-loc").textContent = parentOf(p).replace(HOME, "~");
          if (n % 2) el.classList.add("fd-odd");
        } else {
          el.innerHTML = '<span class="fd-ico">' + iconHtml(p, 64, true) + '</span><span class="fd-cap">' + tagDots(p) + '<span class="fd-nm"></span></span>';
          el.title = displayName(p);
        }
        el.querySelector(".fd-nm").textContent = displayName(p);
        host.appendChild(el);
        n++;
      });
      itemsEl.appendChild(frag);
      if (m === "icons" && k !== "none") fitGroups();
    }
    // 分组的图标：一组放不下一行时，组名右边给「显示全部（N）」；展开后是「收起」
    function fitGroups() {
      itemsEl.querySelectorAll(".fd-grp").forEach(function (h) {
        var rowEl = h.nextElementSibling, b = h.querySelector(".fd-grp-all");
        if (!rowEl || !b) return;
        var open = rowEl.classList.contains("fd-open");
        b.hidden = !open && rowEl.scrollWidth <= rowEl.clientWidth + 2;
        b.textContent = open ? "收起" : "显示全部（" + rowEl.children.length + "）";
      });
    }

    // ---- 分栏：从窗口的文件夹到当前栏，一层一栏；选中文件夹在右边再开一栏，选中文件在右边开预览栏（开着预览面板时不重复）。
    // 已有的栏内容没变就原样留着（滚动位置、正在点的那一项都不动），只改选中态
    function colChain() { var out = [], d = S.colDir; for (;;) { out.unshift(d); if (d === S.cwd || d === "/") break; d = parentOf(d); } return out; }
    function renderColumns() {
      if (itemsEl.firstElementChild && !itemsEl.firstElementChild.classList.contains("fd-colw")) itemsEl.textContent = "";
      var chain = colChain(), specs = [], one = S.sel.length === 1 ? S.sel[0] : null, k = gkey();
      chain.forEach(function (d, i) { var last = i === chain.length - 1; specs.push({ dir: d, items: last ? S.items : entriesOf(d), hl: chain[i + 1] || null, active: last }); });
      if (one && isFolder(one)) specs.push({ dir: one, items: entriesOf(one), hl: null, active: false });
      // 选中的是文件（最后一级）：右边不再多出一栏；要看预览开预览面板（⇧⌘P）或按空格
      var cols = itemsEl.children;
      specs.forEach(function (sp, i) {
        var key = sp.pv ? ["pv", sp.pv, (FS.stat(sp.pv) || {}).mtime, (FS.stat(sp.pv) || {}).lazy ? 1 : 0, meta.open[sp.pv], tagVer, light() ? 1 : 0].join("|") : ["d", sp.dir, k, tagVer, sp.items.join("\n")].join("|");
        var el = cols[i];
        if (!el || el.dataset.key !== key) {
          var fresh = sp.pv ? previewCol(sp.pv) : dirCol(sp.dir, sp.items);
          fresh.dataset.key = key;
          if (el) itemsEl.replaceChild(fresh, el); else itemsEl.appendChild(fresh);
          el = fresh;
        }
        el.classList.toggle("fd-col-act", !!sp.active);
        if (!sp.pv) el.querySelectorAll(".fd-it").forEach(function (r) {
          var p = r.dataset.path;
          r.classList.toggle("fd-on", !!sp.active && S.sel.indexOf(p) >= 0);
          r.classList.toggle("fd-path", p === sp.hl);
        });
      });
      while (cols.length > specs.length) itemsEl.lastElementChild.remove();
      fitColPv();
      // 横向：先让最右一栏露出来，再保证当前栏在视野里
      var tail = itemsEl.lastElementChild, act = itemsEl.querySelector(".fd-col-act");
      if (tail) nudge(scroll, tail, true);
      if (act) nudge(scroll, act, true);
    }
    function dirCol(dir, items) {
      var w = document.createElement("div"), col = document.createElement("div"), g = document.createElement("b"), k = gkey(), last = null;
      w.className = "fd-colw";
      w.dataset.dir = dir;
      w.style.width = (S.colW[dir] || colDefault) + "px";
      col.className = "fd-col";
      items.forEach(function (p) {
        if (k !== "none") { var b = bucket(p, k); if (b !== last) { last = b; col.appendChild(groupHead(b, false)); } }
        var el = row(p);
        el.innerHTML = '<span class="fd-ico">' + iconHtml(p, 16) + '</span><span class="fd-nm"></span>' + tagDots(p) + (isFolder(p) ? '<i class="fd-chev"></i>' : "");
        el.querySelector(".fd-nm").textContent = displayName(p);
        col.appendChild(el);
      });
      g.className = "fd-grip";
      g.title = "拖动改栏宽（按住 ⌥ 一起改）；双击按内容适配";
      w.appendChild(col);
      w.appendChild(g);
      return w;
    }
    // 预览栏：顶上真的预览（跟着栏宽排版），下面名称、种类、信息
    function previewCol(p) {
      var w = document.createElement("div");
      w.className = "fd-colw fd-colpv";
      w.dataset.path = p;
      w.innerHTML = '<div class="fd-pv"><div class="fd-live"></div><div class="fd-pv-name"></div><div class="fd-pv-kind"></div>' + infoRows(p) + "</div>";
      w.querySelector(".fd-pv-name").textContent = displayName(p);
      w.querySelector(".fd-pv-kind").textContent = kindLine(p);
      return w;
    }
    function fitColPv() {
      var pv = itemsEl.querySelector(".fd-colpv"), box = pv && pv.querySelector(".fd-live");
      if (!box || !FS.exists(pv.dataset.path)) return;
      drawLive(box, pv.dataset.path, Math.min(760, Math.max(180, pv.clientWidth - 40)), Math.max(150, Math.round(pv.clientHeight * 0.58)));
    }

    // ---- 画廊：上面一张大图，底下一排缩略图 ----
    function renderGallery() {
      var g = itemsEl.firstElementChild;
      if (!g || !g.classList.contains("fd-gal")) {
        itemsEl.textContent = "";
        g = document.createElement("div");
        g.className = "fd-gal";
        g.innerHTML = '<div class="fd-gal-stage"></div><div class="fd-gal-cap"><span class="fd-nm"></span><span class="fd-gal-kind"></span></div><div class="fd-gal-strip"></div>';
        itemsEl.appendChild(g);
      }
      var strip = g.querySelector(".fd-gal-strip"), key = [S.cwd, tagVer, light() ? 1 : 0, S.items.join("\n")].join("|");
      if (strip.dataset.key !== key) {
        strip.textContent = "";
        S.items.forEach(function (p) { var el = row(p); el.innerHTML = '<span class="fd-ico">' + iconHtml(p, 52, true) + "</span>"; el.title = displayName(p); strip.appendChild(el); });
        strip.dataset.key = key;
      }
      strip.querySelectorAll(".fd-it").forEach(function (el) { el.classList.toggle("fd-on", S.sel.indexOf(el.dataset.path) >= 0); });
      var p = S.sel[S.sel.length - 1];
      g.querySelector(".fd-gal-cap .fd-nm").textContent = p ? displayName(p) : "";
      g.querySelector(".fd-gal-kind").textContent = p ? kindLine(p) : "";
      drawStage();
    }
    function drawStage() {
      var stage = itemsEl.querySelector(".fd-gal-stage");
      if (!stage) return;
      var p = S.sel[S.sel.length - 1], st = (p && FS.stat(p)) || {};
      var h = Math.round(Math.max(60, Math.min(stage.clientHeight - 28, (stage.clientWidth - 48) / 0.77)));
      var key = [p, st.mtime, st.lazy ? 1 : 0, h, light() ? 1 : 0].join("|");
      if (stage.dataset.key === key) return;
      stage.dataset.key = key;
      stage.innerHTML = p ? bigThumb(p, h) : "";
    }

    // ---- 工具栏、标题、标签页栏、侧边栏、路径栏、项数、预览面板 ----
    function chrome() {
      if (sideSig !== sbxSig()) renderSide(); // 真沙盒开了 / 关了 / 正在连：侧边栏跟着换
      tbBtn("back").disabled = !S.back.length;
      tbBtn("fwd").disabled = !S.fwd.length;
      VIEWS.forEach(function (v) { tbBtn(v).classList.toggle("fd-on", S.view === v); });
      tbBtn("group").classList.toggle("fd-on", gkey() !== "none");
      tbBtn("insp").classList.toggle("fd-on", W.insp);
      tbBtn("tag").disabled = !S.sel.length;
      tbBtn("newdir").disabled = !canCreate();
      var t = title();
      tb.querySelector(".fd-title").textContent = t;
      win.setTitle(t);
      side.querySelectorAll(".fd-place").forEach(function (a) { a.classList.toggle("fd-on", !S.query && a.dataset.path === S.cwd); });
      var byTime = S.cwd === RECENTS && !S.query && !S.sortSet;
      head.querySelectorAll("span").forEach(function (h) { h.classList.toggle("fd-sorted", !byTime && h.dataset.k === S.sort.key); h.dataset.dir = S.sort.dir > 0 ? "▲" : "▼"; });
      renderTabs();
      renderCrumbs();
      renderCount();
      renderInsp();
      if (D.front() === win) D.refreshMenus();
    }
    // 标签页栏：两个以上才出现；每个标签一样宽，指着时左边出 ✕；最右一个「+」
    function renderTabs() {
      var on = tabs.length > 1;
      tabsEl.hidden = !on;
      if (!on) { tabsEl.dataset.sig = ""; return; }
      var names = tabs.map(function (t, i) { return titleOf(t, i === tabIdx); });
      var sig = names.join("\n") + "|" + tabIdx + "|" + tabs.map(function (t) { return t.cwd; }).join("\n");
      if (tabsEl.dataset.sig === sig) return;
      tabsEl.dataset.sig = sig;
      tabsEl.textContent = "";
      tabs.forEach(function (t, i) {
        var el = document.createElement("div");
        el.className = "fd-tab" + (i === tabIdx ? " fd-on" : "");
        el.dataset.i = i;
        el.dataset.path = t.cwd;
        el.title = names[i];
        el.innerHTML = '<i class="fd-tab-x" title="关闭标签页（⌥⌘W）">' + TB.close + "</i><span></span>";
        el.lastChild.textContent = names[i];
        tabsEl.appendChild(el);
      });
      var add = document.createElement("button");
      add.className = "fd-tab-add";
      add.tabIndex = -1;
      add.title = "新建标签页（⌥⌘T）";
      add.innerHTML = TB.plus;
      tabsEl.appendChild(add);
    }
    // 路径栏：选中一项时是它的完整路径，否则是当前文件夹
    function renderCrumbs() {
      crumbs.textContent = "";
      var target = S.sel.length === 1 ? S.sel[0] : mode() === "columns" ? S.colDir : S.cwd;
      var parts = target === RECENTS ? [RECENTS] : target === "/" ? ["/"] : ["/"].concat(target.split("/").slice(1).map(function (_, i, a) { return "/" + a.slice(0, i + 1).join("/"); }));
      parts.forEach(function (p, i) {
        if (i) { var s = document.createElement("i"); s.textContent = "›"; crumbs.appendChild(s); }
        var b = document.createElement("span"), dir = p !== RECENTS && isFolder(p);
        b.className = "fd-crumb" + (dir ? "" : " fd-crumb-file");
        b.dataset.path = p;
        b.innerHTML = '<span class="fd-ico">' + (p === RECENTS ? SIDE_ICON.recents : iconHtml(p, 13)) + "</span>";
        b.appendChild(document.createTextNode(label(p)));
        crumbs.appendChild(b);
      });
    }
    function renderCount(msg) {
      count.textContent = msg || (S.sel.length ? "已选择 " + S.sel.length + " 项，共 " + S.items.length + " 项" : S.items.length + " 项");
    }
    var toastT = 0;
    function toast(msg) { renderCount(msg); count.classList.add("fd-warn"); clearTimeout(toastT); toastT = setTimeout(function () { count.classList.remove("fd-warn"); renderCount(); }, 3500); }
    var sideSig = null;
    if (window.TSU_AGENTS) TSU_AGENTS.on(function (t) { if ((t === "sandbox" || t === "me") && sideSig !== null && sideSig !== sbxSig()) renderSide(); }); // 正在连 → 连上了
    var sbxSig = function () { return FS.mirrorActive && FS.mirrorActive() ? "mirror" : window.TSU_AGENTS && TSU_AGENTS.sandboxWaiting && TSU_AGENTS.sandboxWaiting() ? "wait" : ""; };
    function renderSide() {
      sideSig = sbxSig();
      side.textContent = "";
      PLACES.forEach(function (pl) {
        if (pl.h) { var h = document.createElement("h4"); h.textContent = pl.h; side.appendChild(h); return; }
        var a = document.createElement("div");
        a.className = "fd-place";
        a.dataset.path = pl.path;
        a.innerHTML = SIDE_ICON[pl.icon] + "<span></span>";
        a.lastChild.textContent = pl.name;
        side.appendChild(a);
      });
      // 开了真沙盒：底下标一句「真沙盒」——个人、agents、shared 里是真的文件；配了但还没连上：「正在连接」（不用这台设备上的另一份）
      var mi = FS.mirrorInfo && FS.mirrorInfo(), waiting = !mi && window.TSU_AGENTS && TSU_AGENTS.sandboxWaiting && TSU_AGENTS.sandboxWaiting();
      if (mi || waiting) {
        var w = document.createElement("div");
        w.className = "fd-where" + (waiting ? " fd-where-wait" : "");
        w.title = mi ? "个人、/agents、/shared 里是真沙盒里的文件：" + mi.home : "真沙盒暂时连不上（服务器或网络），正在重试";
        w.innerHTML = "<i></i><span>真沙盒</span><small></small>";
        w.querySelector("small").textContent = waiting ? "正在连接…" : { seatbelt: "这台 Mac", bwrap: "服务器", docker: "Docker" }[mi.driver] || mi.driver || "";
        side.appendChild(w);
      }
    }
    // 预览面板：选中一项时是它；没选中时是当前文件夹；多选时只显示数目。顶上是真的预览（跟着面板的宽窄重排）
    function renderInsp() {
      insp.hidden = !W.insp;
      if (!W.insp) return;
      var p = S.sel.length === 1 ? S.sel[0] : S.sel.length || S.cwd === RECENTS ? null : mode() === "columns" ? S.colDir : S.cwd;
      var st = (p && FS.stat(p)) || {};
      var key = [p, S.sel.length, st.mtime, st.lazy ? 1 : 0, tagVer, p && meta.open[p], light() ? 1 : 0, p && FS.isDir(p) ? countOf(p) : ""].join("|");
      if (inspIn.dataset.key === key) return fitInsp();
      inspIn.dataset.key = key;
      insp.dataset.path = p || "";
      if (!p) { inspIn.innerHTML = '<div class="fd-insp-none">' + (S.sel.length ? "已选择 " + S.sel.length + " 项" : "未选择项目") + "</div>"; return; }
      var act = actionFor(p);
      inspIn.innerHTML = '<div class="fd-live"></div><div class="fd-insp-name"></div><div class="fd-insp-kind"></div>' +
        "<section><h5>信息</h5>" + infoRows(p) + "</section>" +
        '<section><h5>标签</h5><div class="fd-insp-tags">' + tagChips(p) + '<button class="fd-link" data-a="addtag" tabindex="-1">添加标签…</button></div></section>' +
        '<div class="fd-insp-act">' + (act ? '<button data-a="open" tabindex="-1"></button>' : "") + '<button data-a="more" tabindex="-1">更多…</button></div>';
      inspIn.querySelector(".fd-insp-name").textContent = label(p);
      inspIn.querySelector(".fd-insp-kind").textContent = kindLine(p);
      if (act) inspIn.querySelector('[data-a="open"]').textContent = act.label;
      fitInsp();
    }
    function fitInsp() {
      var box = inspIn.querySelector(".fd-live"), p = insp.dataset.path;
      if (!box || !p || !FS.exists(p) || insp.hidden) return;
      drawLive(box, p, inspIn.clientWidth - 32, Math.max(150, Math.round(inspIn.clientHeight * 0.5)));
    }

    // ---- 选中：列表 / 图标只改选中态；分栏、画廊要跟着换右边的栏 / 大图，重画（已有的部分会原样留着）----
    function paintSel() {
      itemsEl.querySelectorAll(".fd-it").forEach(function (el) { el.classList.toggle("fd-on", S.sel.indexOf(el.dataset.path) >= 0); });
      chrome();
    }
    function select(paths, anchor) {
      S.sel = paths;
      S.anchor = anchor !== undefined ? anchor : paths[paths.length - 1] || null;
      var m = mode();
      if (m === "columns" || m === "gallery") render(); else paintSel();
      reveal(elOf(paths[paths.length - 1]));
      if (W.ql && S.sel.length === 1 && S.sel[0] !== W.ql) openQL(S.sel[0]);
    }
    var elOf = function (p) { return p ? Array.prototype.find.call(itemsEl.querySelectorAll(".fd-it"), function (el) { return el.dataset.path === p; }) : null; };
    // 滚到能看见：只动访达自己的滚动区（scrollIntoView 可能把整个页面也挪了）
    function nudge(box, el, xOnly) {
      var b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
      if (!xOnly) {
        if (r.top < b.top) box.scrollTop -= b.top - r.top;
        else if (r.bottom > b.bottom) box.scrollTop += Math.min(r.bottom - b.bottom, r.top - b.top);
      }
      if (r.left < b.left) box.scrollLeft -= b.left - r.left;
      else if (r.right > b.right) box.scrollLeft += Math.min(r.right - b.right, r.left - b.left);
    }
    function reveal(el) {
      if (!el) return;
      nudge(el.closest(".fd-col, .fd-gal-strip, .fd-grow:not(.fd-open)") || scroll, el);
      var cw = el.closest(".fd-colw, .fd-grow");
      if (cw) nudge(scroll, cw, cw.classList.contains("fd-colw"));
    }

    // ======== 前往、打开 ========
    function go(dir, noHistory) {
      if (dir !== RECENTS && !isFolder(dir)) return;
      if (dir !== S.cwd && !noHistory) { S.back.push(S.cwd); S.fwd = []; }
      S.cwd = S.colDir = dir;
      S.sel = [];
      S.openGroups = {};
      if (dir !== RECENTS) touchOpen(dir);
      if (S.query) { S.query = ""; search.value = ""; tb.querySelector(".fd-search").classList.remove("fd-has"); }
      closeQL();
      render();
      scroll.scrollTop = scroll.scrollLeft = 0;
    }
    function goBack() { if (!S.back.length) return; S.fwd.push(S.cwd); go(S.back.pop(), true); }
    function goFwd() { if (!S.fwd.length) return; S.back.push(S.cwd); go(S.fwd.pop(), true); }
    function goUp() { if (S.cwd !== "/" && S.cwd !== RECENTS) { var from = S.cwd; go(parentOf(S.cwd)); select([from]); } }
    function goTrash() { try { if (!FS.isDir(TRASH)) FS.mkdirp(TRASH); } catch (e) { return toast(e.message); } go(TRASH); }
    // 「最近使用的文件夹」：去过的文件夹，新的在前
    function recentDirs() {
      return Object.keys(meta.open).filter(function (p) { return p !== RECENTS && isFolder(p) && !under(p, TRASH) && !hiddenBelow(p, "/"); })
        .sort(function (a, b) { return meta.open[b] - meta.open[a]; }).slice(0, 10);
    }

    // ======== 前往文件夹（⇧⌘G，同 macOS）：浮在窗口上面的输入框，边打边列出能去的地方——↑↓ 选、Tab 补全、↩ 前往、esc 关；空着时列最近前往过的。
    // 路径可以是绝对的、~ 开头的，或相对当前文件夹；是文件就打开它所在的文件夹并选中它
    var gt = null;
    function gotoAbs(t) {
      t = t.trim();
      if (t === "~" || t.indexOf("~/") === 0) t = HOME + t.slice(1);
      else if (t.charAt(0) !== "/") t = join(here() === RECENTS ? HOME : here(), t);
      var out = [];
      t.split("/").forEach(function (x) { if (!x || x === ".") return; if (x === "..") out.pop(); else out.push(x); });
      return "/" + out.join("/");
    }
    function gotoMatches(t) {
      if (!t.trim()) return store.get("tsu-finder-goto", []).filter(function (p) { return FS.exists(p); }).slice(0, 8);
      var abs = gotoAbs(t), slash = /\/$/.test(t.trim()) && abs !== "/", dir = slash || abs === "/" ? abs : parentOf(abs), pre = slash || abs === "/" ? "" : baseOf(abs).toLowerCase();
      if (!FS.isDir(dir)) return [];
      var kids;
      try { kids = FS.list(dir); } catch (e) { kids = []; }
      kids = kids.filter(function (p) { var b = baseOf(p); return b.toLowerCase().indexOf(pre) === 0 && (showHidden || b.charAt(0) !== "." || pre.charAt(0) === "."); })
        .sort(function (a, b) { return (isFolder(b) ? 1 : 0) - (isFolder(a) ? 1 : 0) || baseOf(a).localeCompare(baseOf(b)); });
      if (FS.exists(abs)) kids = [abs].concat(kids.filter(function (p) { return p !== abs; })); // 打的正好是一个在的地方：它排第一
      return kids.slice(0, 12);
    }
    function gotoFolder() {
      if (!gt) {
        var el = document.createElement("div");
        el.className = "fd-goto";
        el.innerHTML = '<label class="fd-goto-f">' + TB.dir + '<input spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="输入路径，如 ~/上传 或 /tmp"></label><div class="fd-goto-list"></div><div class="fd-goto-err" hidden></div>';
        fd.appendChild(el);
        gt = { el: el, input: el.querySelector("input"), list: el.querySelector(".fd-goto-list"), err: el.querySelector(".fd-goto-err"), items: [], i: 0 };
        gt.input.addEventListener("input", function () { gotoList(); });
        gt.input.addEventListener("keydown", function (e) {
          var k = e.key;
          if (e.isComposing) return;
          if (k === "Escape") { e.preventDefault(); closeGoto(true); }
          else if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); if (gt.items.length) { gt.i = (gt.i + (k === "ArrowDown" ? 1 : gt.items.length - 1)) % gt.items.length; gotoPaint(); } }
          else if (k === "Tab") { // 补全成选中的那一项（文件夹后面加 /，接着往下打）
            e.preventDefault();
            var p = gt.items[gt.i];
            if (p) { gt.input.value = (under(p, HOME) ? "~" + p.slice(HOME.length) : p) + (isFolder(p) && p !== "/" ? "/" : ""); gotoList(); }
          } else if (k === "Enter") { e.preventDefault(); gotoEnter(); }
          else return;
          e.stopPropagation();
        });
        gt.list.addEventListener("mousedown", function (e) { e.preventDefault(); }); // 点列表不让输入框失焦
        gt.list.addEventListener("click", function (e) { var r = e.target.closest(".fd-goto-it"); if (r) gotoPath(r.dataset.path); });
        gt.list.addEventListener("mousemove", function (e) { var r = e.target.closest(".fd-goto-it"); if (r && +r.dataset.i !== gt.i) { gt.i = +r.dataset.i; gotoPaint(); } });
        gt.outside = function (e) { if (gt && !gt.el.hidden && !gt.el.contains(e.target)) closeGoto(false); };
      }
      closeQL();
      gt.el.hidden = false;
      gt.input.value = "";
      gotoList();
      document.addEventListener("mousedown", gt.outside, true);
      setTimeout(function () { gt.input.focus(); }, 0);
    }
    function gotoList() {
      var t = gt.input.value;
      gt.items = gotoMatches(t);
      gt.i = 0;
      gt.err.hidden = true;
      gt.el.classList.remove("fd-shake");
      gt.list.innerHTML = (!t.trim() && gt.items.length ? '<div class="fd-goto-h">最近前往</div>' : "") + gt.items.map(function (p, i) {
        var dir = p === "/" ? "" : parentOf(p);
        return '<div class="fd-goto-it" data-i="' + i + '" data-path="' + esc(p) + '"><span class="fd-ico">' + iconHtml(p, 16) + "</span><span class=\"fd-goto-p\"><i>" +
          esc(dir === "/" ? "/" : dir ? dir + "/" : "") + "</i>" + esc(p === "/" ? "/" : baseOf(p)) + "</span></div>";
      }).join("");
      gotoPaint();
    }
    function gotoPaint() {
      gt.list.querySelectorAll(".fd-goto-it").forEach(function (r) { var on = +r.dataset.i === gt.i; r.classList.toggle("fd-on", on); if (on) nudge(gt.list, r); });
    }
    function gotoEnter() {
      var t = gt.input.value;
      if (!t.trim() && !gt.items.length) return closeGoto(true);
      var p = gt.items[gt.i] || gotoAbs(t);
      if (gotoPath(p)) return;
      gt.err.textContent = "找不到“" + t.trim() + "”";
      gt.err.hidden = false;
      gt.el.classList.remove("fd-shake");
      void gt.el.offsetWidth;
      gt.el.classList.add("fd-shake");
    }
    function gotoPath(p) {
      if (!p || !FS.exists(p)) return false;
      var h = store.get("tsu-finder-goto", []).filter(function (x) { return x !== p; });
      h.unshift(p);
      store.set("tsu-finder-goto", h.slice(0, 10));
      closeGoto(true);
      if (isFolder(p)) go(p);
      else { go(parentOf(p)); select(S.items.indexOf(p) >= 0 ? [p] : []); } // 文件、App：打开所在的文件夹并选中（同 macOS）
      return true;
    }
    function closeGoto(refocus) {
      if (!gt || gt.el.hidden) return;
      gt.el.hidden = true;
      document.removeEventListener("mousedown", gt.outside, true);
      if (refocus) scroll.focus({ preventScroll: true });
    }
    // 分栏里的左右：← 回到上一栏（选中来时的文件夹），→ 进选中的文件夹（选中它的第一项）
    function colLeft() { if (S.colDir === S.cwd) return; var d = S.colDir; S.colDir = parentOf(d); select([d]); }
    function colRight() {
      var p = S.sel[S.sel.length - 1];
      if (!p || !isFolder(p)) return;
      var kids = entriesOf(p);
      if (!kids.length) return;
      S.colDir = p;
      S.sel = [];
      select([kids[0]]);
    }
    function runOpener(p, o) { touchOpen(p); closeQL(); o.run(); }
    // 预览面板 / 快速查看的主按钮
    function actionFor(p) {
      if (!p) return null;
      if (isApp(p)) return { label: "打开", run: function () { openItem(p); } };
      if (FS.isDir(p)) return p === S.cwd ? null : { label: "打开", run: function () { closeQL(); go(p); } };
      if (extOf(baseOf(p)) === "zip" && xfer() && xfer().extract) return { label: "解压", run: function () { closeQL(); unzipHere(p); } };
      var o = openers(p)[0];
      return o ? { label: "通过 " + o.name + " 打开", run: function () { runOpener(p, o); } } : null;
    }
    // 打开（同 macOS）：文件夹进去（分栏里是进到它那一栏），.app 启动，zip 解压到旁边，文件交给默认 App；图片或没有合适的 App 就快速查看
    function openItem(p) {
      if (!p || !FS.exists(p)) return;
      if (isFolder(p)) {
        if (mode() === "columns" && under(p, S.cwd)) { S.colDir = p; S.sel = []; var kids = entriesOf(p); return select(kids.length ? [kids[0]] : []); }
        return go(p);
      }
      var info = appInfo(p);
      if (info) { touchOpen(p); closeQL(); return launch(info.id); }
      if (extOf(baseOf(p)) === "zip" && xfer() && xfer().extract) return unzipHere(p);
      var o = IMG[extOf(baseOf(p))] ? null : openers(p)[0];
      if (!o) { if (S.sel.indexOf(p) < 0) select([p]); return openQL(p); }
      runOpener(p, o);
    }
    function openSel() {
      if (S.sel.length === 1) return openItem(S.sel[0]);
      S.sel.filter(function (p) { return !isFolder(p); }).forEach(openItem); // 多选：文件逐个打开（文件夹就不一个个进了）
    }
    // zip：解压到它旁边的同名文件夹（同 macOS 的「归档实用工具」）
    function unzipHere(p) {
      touchOpen(p);
      toast("正在解压“" + baseOf(p) + "”…");
      xfer().extract(p, baseOf(p), { dir: parentOf(p) }).then(function (res) {
        render();
        if (res.dest && parentOf(res.dest) === here()) select([res.dest]);
        toast(res.skipped && res.skipped.length ? "解压完成，跳过了 " + res.skipped.length + " 项" : "已解压到“" + (res.name || baseOf(res.dest || p)) + "”");
      }, function (e) { toast("解压失败：" + e.message); });
    }

    // ======== 新建、改名、废纸篓、移动、拷贝 / 粘贴、复制、压缩、交给「导出」 ========
    function newFolder() {
      if (!canCreate()) return;
      var dir = here(), p = join(dir, freeName(dir, "未命名文件夹"));
      try { FS.mkdirp(p); } catch (e) { return toast(e.message); }
      render();
      select([p]);
      rename(p);
    }
    function newFile() {
      if (!canCreate()) return;
      var dir = here(), p = join(dir, freeName(dir, "未命名.txt"));
      try { FS.write(p, ""); } catch (e) { return toast(e.message); }
      render();
      select([p]);
      rename(p);
    }
    // 改名：名字换成输入框（先选中不含扩展名的部分，同 macOS），回车确定、Esc 取消、点别处也算确定
    function rename(p) {
      p = p || S.sel[0];
      if (!p || fixed(p)) return;
      var el = mode() === "gallery" ? itemsEl.querySelector(".fd-gal-cap") : elOf(p);
      var nm = el && el.querySelector(".fd-nm");
      if (!nm) return;
      var old = baseOf(p), input = document.createElement("input");
      input.className = "fd-rn";
      input.value = old;
      input.spellcheck = false;
      nm.replaceWith(input);
      W.renaming = p;
      input.focus();
      var dot = FS.isDir(p) ? -1 : old.lastIndexOf(".");
      input.setSelectionRange(0, dot > 0 ? dot : old.length);
      var done = false;
      // 点别处（按下时）就算确定：访达里很多地方的 mousedown 会 preventDefault，输入框收不到 blur，改名框就一直留着
      var outside = function (e) { if (e.target !== input) finish(true); };
      document.addEventListener("pointerdown", outside, true);
      function finish(ok) {
        if (done) return;
        done = true;
        document.removeEventListener("pointerdown", outside, true);
        W.renaming = null;
        var value = input.value;
        // 先把原来的名字放回去：分栏里名字没改（取消、同名、出错）时那一栏的内容没变、不会重建，输入框就一直留在那里
        if (input.parentNode) input.replaceWith(nm);
        var msg = "", to = ok ? renameTo(p, value, function (m) { msg = m; }) : null;
        if (to) {
          S.sel = [to];
          if (under(S.colDir, p)) S.colDir = to + S.colDir.slice(p.length); // 分栏：改的是当前栏路径上的文件夹
        }
        render();
        scroll.focus({ preventScroll: true });
        if (msg) toast(msg);
        if (to && W.ql === p) openQL(to);
      }
      input.addEventListener("keydown", function (e) {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        if (e.key === "Escape") { e.preventDefault(); finish(false); }
      });
      input.addEventListener("blur", function () { finish(true); });
      ["pointerdown", "mousedown", "dblclick", "click"].forEach(function (t) { input.addEventListener(t, function (e) { e.stopPropagation(); }); });
    }
    var endRename = function () { var rn = fd.querySelector(".fd-rn"); if (rn) rn.blur(); };
    // 移到废纸篓（⌘⌫）：选中挪到下一项；⌘Z 放回去
    function trashSel() {
      var list = S.sel.filter(function (p) { return !fixed(p) && !inTrash(p); });
      if (!list.length) return S.sel.length && toast(S.sel.some(inTrash) ? "已经在废纸篓里了" : "系统文件夹和应用程序不能移到废纸篓");
      var idx = S.items.indexOf(list[0]), names = list.map(displayName);
      var moved = toTrash(list, toast);
      if (!moved.length) return;
      undoOp = { label: "移到废纸篓", run: function () { var back = putBack(moved, toast); render(); if (back.length) select(back.filter(function (p) { return parentOf(p) === here(); })); } };
      closeQL();
      render();
      var next = S.items[Math.min(idx, S.items.length - 1)];
      select(next ? [next] : []);
      var gone = list.map(function (p, i) { return FS.exists(p) ? -1 : i; }).filter(function (i) { return i >= 0; }); // 真挪走的是哪几个（有的可能没挪成）
      toast(moved.length === 1 ? "已将“" + names[gone.length ? gone[0] : 0] + "”移到废纸篓（⌘Z 撤销）" : "已将 " + moved.length + " 项移到废纸篓（⌘Z 撤销）");
    }
    function putBackSel() {
      var back = putBack(S.sel.filter(function (p) { return meta.trash[p]; }), toast);
      render();
      if (back.length) toast(back.length === 1 ? "已将“" + displayName(back[0]) + "”放回原处" : "已放回 " + back.length + " 项");
    }
    function eraseSel() { eraseForever(S.sel.slice(), win.el.id, function () { render(); }); }
    function undo() { if (!undoOp) return; var u = undoOp; undoOp = null; u.run(); }
    // 拖到文件夹上：跳过移进自己 / 自己的子目录、原地不动、目标已有同名、系统文件夹和 App；拖进废纸篓 = 移到废纸篓
    function moveInto(paths, dir) {
      if (dir === TRASH) { var t = toTrash(paths, toast); render(); if (t.length) toast("已将 " + t.length + " 项移到废纸篓"); return; }
      var moved = [];
      paths.forEach(function (p) {
        if (fixed(p) || parentOf(p) === dir) return;
        if (under(dir, p)) return toast("不能把“" + displayName(p) + "”移到它自己里面");
        if (FS.exists(join(dir, baseOf(p)))) return toast("“" + label(dir) + "”里已有“" + baseOf(p) + "”");
        try { moved.push(mv(p, dir)); } catch (e) { toast(e.message); }
      });
      syncTrash();
      render();
      if (moved.length && here() === dir) select(moved);
    }
    // 粘贴项目：拷贝过的东西复制进 dir；粘回原来的文件夹时叫「名字 副本」，别处重名时叫「名字 2」（同 macOS 的「保留两者」）
    function pasteInto(dir) {
      if (!dir || dir === RECENTS || under(dir, TRASH) || !clip.length) return;
      var made = [];
      clip.filter(function (p) { return FS.exists(p); }).forEach(function (p) {
        if (under(dir, p)) return toast("不能把“" + displayName(p) + "”拷贝到它自己里面");
        var to = join(dir, parentOf(p) === dir ? copyName(dir, baseOf(p)) : freeName(dir, baseOf(p)));
        try { FS.copy(p, to); made.push(to); } catch (e) { toast(e.message); }
      });
      if (!made.length) return;
      render();
      if (here() === dir) select(made);
      toast("已粘贴 " + made.length + " 项");
    }
    // 复制（⌘D）：在原地做一份「名字 副本」
    function duplicateSel() {
      var made = [];
      S.sel.filter(function (p) { return FS.exists(p) && !fixed(p) && !inTrash(p); }).forEach(function (p) {
        var dir = parentOf(p), to = join(dir, copyName(dir, baseOf(p)));
        try { FS.copy(p, to); made.push(to); } catch (e) { toast(e.message); }
      });
      if (!made.length) return;
      render();
      select(made.filter(function (p) { return S.items.indexOf(p) >= 0; }));
    }
    // 压缩：一项叫「它.zip」，多项叫「归档.zip」，放在它们所在的文件夹（用「传输」App 的 zip）
    var compressLabel = function (sel) { return sel.length === 1 ? "压缩“" + displayName(sel[0]) + "”" : sel.length ? "压缩 " + sel.length + " 个项目" : "压缩"; };
    function compressSel() {
      var list = S.sel.filter(function (p) { return FS.exists(p); }), X = xfer();
      if (!list.length || !X || !X.pack) return;
      var dir = parentOf(list[0]);
      if (list.some(function (p) { return parentOf(p) !== dir; }) || dir === APPS) dir = canCreate() ? here() : HOME;
      toast("正在压缩…");
      X.pack(list, { always: true, name: list.length === 1 ? displayName(list[0]) + ".zip" : "归档.zip" }).then(function (r) {
        return r.blob.arrayBuffer().then(function (buf) {
          var to = join(dir, freeName(dir, r.name));
          FS.writeBinary(to, new Uint8Array(buf));
          render();
          if (here() === dir) select([to]);
          toast("已压缩为“" + baseOf(to) + "”" + (r.skipped && r.skipped.length ? "（跳过了 " + r.skipped.length + " 项）" : ""));
        });
      }).catch(function (e) { toast("压缩失败：" + e.message); });
    }
    // 交给「导出 / 传输」App：打包成 zip 下载到本机（访达自己不做下载）
    function exportPaths(paths) {
      var X = xfer();
      if (!X || !paths.length) return;
      X.add(paths); // 它会自己打开窗口（「下载到本机」那一页）；老版本不开的话这里补开
      var w = X.win || D.apps.export;
      if (w && (w.state === "closed" || w.state === "min")) { if (typeof X.open === "function") X.open("down"); else w.show(); }
    }

    // ======== 标签页 ========
    function saveScroll() { S.top = scroll.scrollTop; S.left = scroll.scrollLeft; }
    function useTab(i) {
      tabIdx = i;
      S = tabs[i];
      search.value = S.query;
      tb.querySelector(".fd-search").classList.toggle("fd-has", !!S.query);
      itemsEl.textContent = ""; // 分栏 / 画廊按内容缓存了 DOM：换标签页整个重建
      inspIn.dataset.key = "";
      render();
      scroll.scrollTop = S.top || 0;
      scroll.scrollLeft = S.left || 0;
      scroll.focus({ preventScroll: true });
    }
    function switchTab(i) { if (i === tabIdx || !tabs[i]) return; endRename(); closeQL(); saveScroll(); useTab(i); }
    function cycleTab(d) { if (tabs.length > 1) switchTab((tabIdx + d + tabs.length) % tabs.length); }
    // 新标签页：开在当前标签右边，默认是当前的文件夹
    function newTab(dir) {
      dir = dir && (dir === RECENTS || isFolder(dir)) ? dir : S.cwd;
      endRename();
      closeQL();
      saveScroll();
      tabs.splice(tabIdx + 1, 0, tabState(dir, S.view));
      if (win.state === "closed" || win.state === "min") win.show();
      useTab(tabIdx + 1);
      if (dir !== RECENTS) touchOpen(dir);
    }
    // 关标签页：最后一个就是关窗口；关的是当前的 → 换到右边那个（没有就左边）
    function closeTab(i) {
      if (i == null) i = tabIdx;
      if (!tabs[i]) return;
      if (tabs.length < 2) return D.close(win.el.id);
      endRename();
      if (i === tabIdx) closeQL(); else saveScroll();
      var keep = tabs[tabIdx];
      tabs.splice(i, 1);
      useTab(i === tabIdx ? Math.min(i, tabs.length - 1) : tabs.indexOf(keep));
    }
    function closeOthers(i) {
      if (!tabs[i] || tabs.length < 2) return;
      endRename();
      if (i !== tabIdx) closeQL();
      saveScroll();
      tabs = [tabs[i]];
      useTab(0);
    }
    function moveTabOut() {
      if (tabs.length < 2) return;
      saveScroll();
      closeQL();
      var t = tabs.splice(tabIdx, 1)[0];
      useTab(Math.min(tabIdx, tabs.length - 1));
      newWindow(null, t);
    }
    // 合并所有窗口：别的访达窗口的标签页都挪到这个窗口里，那些窗口关掉
    function mergeAll() {
      saveScroll();
      finders.forEach(function (f) {
        if (f === self || f.win.state === "closed") return;
        tabs = tabs.concat(f.takeTabs());
        f.win.hide("closed");
      });
      useTab(tabIdx);
    }

    // ======== 快速查看：浮在访达上面的面板（不是独立窗口：不抢菜单栏、不进「窗口」菜单）。文稿 / 图片是大面板（可拖、四边四角可拉、可全屏）；
    // App、文件夹、看不了内容的文件是一张小卡片。两种各记各的位置与大小 ========
    var qp = document.createElement("div");
    qp.className = "fd-ql";
    qp.hidden = true;
    qp.innerHTML = '<div class="fd-qlp-body sq"><div class="fd-qlp-bar">' +
      '<button data-q="close" title="关闭（空格）" tabindex="-1">' + TB.close + '</button><button data-q="full" title="全屏" tabindex="-1">' + TB.full + "</button>" +
      '<span class="fd-qlp-name"></span>' +
      '<button data-q="share" title="共享" tabindex="-1">' + TB.share + "</button>" +
      '<span class="fd-qlp-open"><button data-q="open" tabindex="-1"></button><button data-q="with" title="用其他 App 打开" tabindex="-1">' + TB.down + "</button></span>" +
      '</div><div class="fd-qlp-view" tabindex="-1"></div></div>';
    var qBody = qp.firstChild, qBar = qp.querySelector(".fd-qlp-bar"), qView = qp.querySelector(".fd-qlp-view"), qName = qp.querySelector(".fd-qlp-name");
    var qOpenWrap = qp.querySelector(".fd-qlp-open"), qOpen = qp.querySelector('[data-q="open"]'), qWith = qp.querySelector('[data-q="with"]'), qFull = qp.querySelector('[data-q="full"]');
    var qScroll = rowScroll(qView), qOps = [], qGeo = { big: null, card: null }, qMode = "";
    D.floating(qp, { owner: win, handle: qBar, minW: 360, minH: 220, locked: function () { return qp.classList.contains("fd-qlp-full"); } }); // owner：桌面把它放在这个窗口后面、管叠放
    function defaultGeo(m, around) {
      var a = D.area(), w = m === "card" ? Math.min(620, a.width - 40) : Math.min(980, a.width - 100), h = m === "card" ? Math.min(330, a.height - 40) : Math.min(a.height - 40, 780);
      var cx = around ? around.left + around.width / 2 : a.left + a.width / 2, cy = around ? around.top + around.height / 2 : a.top + a.height / 2;
      return { left: Math.round(Math.max(a.left + 8, Math.min(a.right - w - 8, cx - w / 2))), top: Math.round(Math.max(a.top + 8, Math.min(a.bottom - h - 8, cy - h / 2))), width: w, height: h };
    }
    function setQMode(m) {
      if (m === qMode) return;
      var cur = qMode ? { left: qp.offsetLeft, top: qp.offsetTop, width: qp.offsetWidth, height: qp.offsetHeight } : null;
      if (cur && cur.width) qGeo[qMode] = cur; else cur = null;
      qMode = m;
      var g = qGeo[m] || defaultGeo(m, cur);
      qp.style.left = g.left + "px";
      qp.style.top = g.top + "px";
      qp.style.width = g.width + "px";
      qp.style.height = g.height + "px";
      qp.classList.toggle("fd-qlp-cardmode", m === "card");
      if (m === "card") qp.classList.remove("fd-qlp-full");
    }
    function openQL(p) {
      if (!p || !FS.exists(p)) return;
      if (FS.ensureLoaded && (FS.stat(p) || {}).lazy) FS.ensureLoaded([p]); // 真沙盒里的大文件：先去取
      finders.forEach(function (f) { if (f !== self) f.closeQL(); }); // 同一时间只有一个快速查看
      W.ql = p;
      if (qp.hidden) {
        qp.hidden = false;
        qp.classList.add("fd-qlp-in");
        void qp.offsetWidth;
        qp.classList.remove("fd-qlp-in");
        if (D.front() !== win && win.state !== "closed") win.front();
      }
      drawQL();
      if (D.front() === win) D.refreshMenus();
    }
    function closeQL(refocus) {
      if (qp.hidden && !W.ql) return;
      W.ql = null;
      qp.hidden = true;
      qp.classList.remove("fd-qlp-full");
      qView.textContent = "";
      qView.dataset.key = "";
      qScroll.fit(0);
      if (refocus) scroll.focus({ preventScroll: true });
      if (D.front() === win) D.refreshMenus();
    }
    function toggleQL() { if (W.ql) closeQL(true); else if (S.sel.length) openQL(S.sel[S.sel.length - 1]); }
    function drawQL() {
      var p = W.ql;
      if (!p) return;
      if (!FS.exists(p)) return closeQL();
      var info = appInfo(p), act = actionFor(p), url = !FS.isDir(p) && imageURL(p), ofc = !url && officeish(p) && !ofcBad[ofcKey(p)];
      var pdf = !url && !ofc && !FS.isDir(p) && extOf(baseOf(p)) === "pdf", card = !url && !ofc && !pdf && (FS.isDir(p) || !textish(p));
      setQMode(card ? "card" : "big");
      qName.textContent = card ? "" : label(p);
      qOps = info || FS.isDir(p) ? [] : openers(p);
      qOpenWrap.hidden = !act;
      if (act) { qOpen.textContent = info ? "打开 " + displayName(p) : act.label; qWith.hidden = qOps.length < 2; }
      qFull.disabled = card;
      // Office 的预览按宽度排：宽度按 40px 一档算（拖面板大小时不用每一帧都重排），高度不影响
      var st = FS.stat(p) || {}, key = [p, st.mtime, st.lazy ? 1 : 0, light() ? 1 : 0, pdf ? 0 : ofc ? Math.round(qBody.clientWidth / 40) : qBody.clientWidth, ofc || pdf ? 0 : qBody.clientHeight, tagVer, cell()].join("|");
      if (qView.dataset.key === key) return;
      var same = qView.dataset.path === p, top = qView.scrollTop;
      qView.dataset.key = key;
      qView.dataset.path = p;
      qView.textContent = "";
      qView._ofc = null;
      if (ofc) {
        qView.innerHTML = '<div class="ofc-pv-wait">正在生成预览…</div>';
        var want = key, bad = ofcKey(p);
        ofcPV().then(function (pv) { return pv.view(p, { width: qView.clientWidth }); }).then(function (node) {
          if (qView.dataset.key !== want) return;
          if (!node) throw new Error("no preview");
          qView.textContent = "";
          qView.appendChild(node);
          qView._ofc = node;
          qView.scrollTop = same ? top : 0;
        }).catch(function () { if (qView.dataset.key !== want) return; ofcBad[bad] = 1; qView.dataset.key = ""; drawQL(); }); // 预览不了：退回文件卡片
      } else if (pdf) {
        // PDF：一页一页地看（浏览器 / WebKit 自己的阅读器，文字能选）；真沙盒里的先取回来
        var src = pdfURL(p), wantPdf = key;
        if (src) {
          var fr = document.createElement("iframe");
          fr.className = "fd-qlp-pdf";
          fr.title = label(p);
          fr.src = src + "#toolbar=0&navpanes=0&view=FitH";
          qView.appendChild(fr);
        } else {
          qView.innerHTML = '<div class="ofc-pv-wait">正在载入…</div>';
          if (FS.ensureLoaded) FS.ensureLoaded([p]).then(function () { if (qView.dataset.key === wantPdf) { qView.dataset.key = ""; drawQL(); } }, function () {});
        }
      } else if (card) qView.innerHTML = cardHtml(p);
      else if (url) {
        qView.innerHTML = '<div class="fd-qlp-img"><img alt="" draggable="false"></div>';
        qView.querySelector("img").src = url;
      } else {
        var text = "";
        try { text = FS.read(p); } catch (e) { text = e.message; }
        var pre = document.createElement("pre");
        pre.className = "terminal-style-ui fd-qlp-pre" + (light() ? " ttu-light" : "");
        qView.appendChild(pre);
        var h = qScroll.rowH() || 17;
        pre.style.padding = h + "px 22px"; // 上下各空一整行：滚动按整行对齐
        var cols = Math.max(20, Math.floor((qView.clientWidth - 44) / cell()) - 1), lines = text.split("\n"), cut = lines.length > 3000 || text.length > 400000;
        if (cut) text = lines.slice(0, 3000).join("\n").slice(0, 400000);
        pre.innerHTML = text ? ttuHtml(p, text, cols) + (cut ? '\n<span class="fd-note">…… 文件太大，只显示前面一部分；完整内容请用「' + (qOps[0] ? qOps[0].name : "编辑器") + "」打开</span>" : "") : '<span class="fd-note">（空文件）</span>';
      }
      qBody.classList.toggle("fd-qlp-text", !!qView.querySelector("pre"));
      qScroll.fit(qBody.clientHeight - qBar.offsetHeight);
      qView.scrollTop = same ? top : 0;
      qScroll.by(0);
    }
    // 面板上的按钮：✕、全屏、共享（拷贝路径 / 内容、下载、在访达中显示）、「通过 X 打开」和换一个 App
    qp.addEventListener("mousedown", function (e) { if (e.target.closest("button")) e.preventDefault(); });
    qp.addEventListener("pointerdown", function () { if (win.state === "normal" || win.state === "zoom" || win.state === "full") win.front(); }, true);
    qBar.addEventListener("click", function (e) {
      var b = e.target.closest("button"), p = W.ql;
      if (!b || !p || b.disabled) return;
      var q = b.dataset.q;
      if (q === "close") closeQL(true);
      else if (q === "full") { qp.classList.toggle("fd-qlp-full"); drawQL(); }
      else if (q === "open") { var act = actionFor(p); if (act) act.run(); }
      else if (q === "with") popup(qOps.map(function (o, i) { return it(o.name + (i ? "" : "（默认）"), "", function () { runOpener(p, o); }); }), under4(b));
      else if (q === "share") popup(shareItems([p], true), under4(b));
    });
    qBar.addEventListener("dblclick", function (e) { if (!e.target.closest("button") && qMode !== "card") { qp.classList.toggle("fd-qlp-full"); drawQL(); } });
    // 焦点在面板里（点过预览的文字）：Esc / ⌘Y 关，↑↓ / 翻页 / 空格 按整行滚，其余交给访达（换文件等）
    qp.addEventListener("keydown", function (e) {
      if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && /^[yw]$/i.test(e.key))) { e.preventDefault(); e.stopPropagation(); return closeQL(true); }
      if (qView._ofc && qView._ofc.onKey && !e.metaKey && !e.ctrlKey && qView._ofc.onKey(e)) { e.preventDefault(); e.stopPropagation(); return; } // Office：翻页、幻灯片 ← →、⌥← → 换工作表
      if (!e.metaKey && !e.ctrlKey && !e.altKey && qScroll.key(e)) { e.preventDefault(); e.stopPropagation(); return; }
      onKey(e);
    });
    if (window.ResizeObserver) new ResizeObserver(function () { if (W.ql) drawQL(); }).observe(qBody);

    // ======== 菜单：菜单栏与右键菜单 ========
    function viewItems() {
      return [["icons", "图标", "⌘1"], ["list", "列表", "⌘2"], ["columns", "分栏", "⌘3"], ["gallery", "画廊", "⌘4"]].map(function (v) {
        return it(v[1], v[2], function () { setView(v[0]); }, false, { checked: S.view === v[0] });
      });
    }
    function groupItems() { return GROUPS.map(function (g) { return it(g[1], "", function () { setGroup(g[0]); }, false, { checked: gkey() === g[0] }); }); }
    function openWithItem(p) {
      var ops = openers(p);
      return it("打开方式", "", null, false, { items: ops.length ? ops.map(function (o, i) { return it(o.name + (i ? "" : "（默认）"), "", function () { runOpener(p, o); }); }) : [it("没有可用的 App", "", null, true)] });
    }
    function shareItems(paths, fromQL) {
      var one = paths.length === 1 ? paths[0] : null;
      var copy = function (text, what) {
        if (!navigator.clipboard) return toast("无法访问剪贴板");
        navigator.clipboard.writeText(text).then(function () { toast("已拷贝" + what); }, function () { toast("无法访问剪贴板"); });
      };
      var out = [
        it("拷贝路径", "", function () { copy(paths.join("\n"), "路径"); }),
        it("拷贝内容", "", function () { try { copy(FS.read(one), "内容"); } catch (e) { toast(e.message); } }, !one || FS.isDir(one) || !textish(one)),
      ];
      if (xfer()) out.push(SEP, it("用「" + exportName() + "」下载到本机", "", function () { exportPaths(paths); }));
      if (fromQL) out.push(SEP, it("在访达中显示", "", function () { closeQL(true); revealIn(one); }));
      return out;
    }
    // 服务：文件夹 → 在那里开终端；文本 → 编辑器；脚本 → 终端里跑
    function serviceItems(sel) {
      var one = sel.length === 1 ? sel[0] : null, T = window.TSU_TERM, out = [];
      if (one && isFolder(one) && T) {
        if (T.openWindow) out.push(it("新建位于文件夹位置的终端窗口", "", function () { T.openWindow(one); }));
        if (T.open) out.push(it("新建位于文件夹位置的终端标签页", "", function () { T.open(one); }));
      }
      if (one && !FS.isDir(one) && textish(one) && window.TSU_IDE && TSU_IDE.open) out.push(it("在编辑器中打开", "", function () { touchOpen(one); TSU_IDE.open(one); }));
      if (one && !FS.isDir(one) && SCRIPT[extOf(baseOf(one))]) { var o = termOpener(one); if (o) out.push(it("在终端中运行", "", function () { runOpener(one, o); })); }
      return out.length ? out : [it("没有可用的服务", "", null, true)];
    }
    // 右键菜单（同 macOS 访达）：选中的东西在废纸篓里时换成「放回原处」「立即删除」
    function ctxItems() {
      var sel = S.sel.slice(), one = sel.length === 1 ? sel[0] : null;
      if (!sel.length) return bgItems();
      var locked = sel.some(fixed), trashed = sel.every(inTrash), folder = one && isFolder(one), out = [it("打开", "", openSel)];
      if (folder) out.push(it("在新标签页中打开", "", function () { newTab(one); }), it("在新窗口中打开", "", function () { newWindow(one); }));
      else if (one && !FS.isDir(one) && !trashed) out.push(openWithItem(one));
      if (one && (S.query || S.cwd === RECENTS)) out.push(it("在所附文件夹中显示", "", function () { revealIn(one); }));
      if (folder && clip.length && !trashed) out.push(it(clip.length > 1 ? "粘贴 " + clip.length + " 项" : "粘贴项目", "", function () { pasteInto(one); }));
      out.push(SEP);
      if (trashed) out.push(it("放回原处", "", putBackSel, !sel.some(function (p) { return meta.trash[p]; })), it("立即删除…", "", eraseSel, false, { icon: MI.trash }));
      else out.push(it("移到废纸篓", "", trashSel, locked, { icon: MI.trash }));
      out.push(SEP, it("显示简介", "", function () { showInfo(sel); }), it("重新命名", "", function () { rename(one); }, !one || locked));
      if (!trashed) out.push(it(compressLabel(sel), "", compressSel, !xfer()), it("复制", "", duplicateSel, locked));
      out.push(it("快速查看", "", function () { openQL(one || sel[sel.length - 1]); }),
        it(one ? "拷贝“" + displayName(one) + "”" : "拷贝 " + sel.length + " 项", "", function () { copyItems(sel, toast); }),
        SEP, it("共享…", "", null, false, { icon: MI.share, items: shareItems(sel, false) }),
        SEP, swatchRow(sel), it("标签…", "", null, false, { icon: MI.tag, items: tagItems(sel) }));
      if (!trashed) out.push(SEP, it("服务", "", null, false, { icon: MI.gear, items: serviceItems(sel) }));
      return out;
    }
    // 空白处：新建、简介、粘贴、分组与显示方式、预览面板；在废纸篓里多一个「清倒废纸篓」
    function bgItems() {
      var out = [it("新建文件夹", "", newFolder, !canCreate()), it("新建文本文件", "", newFile, !canCreate()), SEP, it("显示简介", "", function () { showInfo([here()]); }, S.cwd === RECENTS)];
      if (clip.length) out.push(SEP, it(clip.length > 1 ? "粘贴 " + clip.length + " 项" : "粘贴项目", "", function () { pasteInto(here()); }, !canCreate()));
      if (S.cwd === TRASH && !S.query) out.push(SEP, it("清倒废纸篓…", "", function () { emptyTrash(win.el.id); }, !trashFull()));
      out.push(SEP, it("使用分组", "", toggleGroups, false, { checked: gkey() !== "none" }), it("分组方式", "", null, false, { items: groupItems() }), it("显示方式", "", null, false, { items: viewItems() }),
        SEP, it(W.insp ? "隐藏预览面板" : "显示预览面板", "", toggleInsp));
      if (S.cwd !== RECENTS && !S.query && !under(here(), TRASH)) out.push(SEP, it("服务", "", null, false, { icon: MI.gear, items: serviceItems([here()]) }));
      return out;
    }
    function menus() {
      var sel = S.sel.slice(), one = sel.length === 1 ? sel[0] : null, any = sel.length > 0, locked = sel.some(fixed), trashed = any && sel.every(inTrash), X = xfer();
      var file = [
        it("新建访达窗口", "⌥⌘N", function () { newWindow(HOME); }),
        it("新建文件夹", "⇧⌘N", newFolder, !canCreate()),
        it("新建文本文件", "", newFile, !canCreate()),
        it("新建标签页", "⌥⌘T", function () { newTab(); }),
        SEP,
        it("打开", "⌘O", openSel, !any),
      ];
      if (one && !FS.isDir(one)) file.push(openWithItem(one));
      if (one && isFolder(one)) file.push(it("在新标签页中打开", "", function () { newTab(one); }));
      file.push(it("关闭标签页", "⌥⌘W", function () { closeTab(); }, tabs.length < 2), it("关闭窗口", "⇧⌥⌘W", function () { D.close(win.el.id); }),
        SEP,
        it("显示简介", "⌘I", function () { showInfo(any ? sel : [here()]); }, !any && S.cwd === RECENTS),
        it("重新命名", "↩", function () { rename(one); }, !one || locked),
        it(compressLabel(sel), "", compressSel, !any || !X || trashed),
        it("复制", "⌘D", duplicateSel, !any || locked || trashed),
        it("快速查看", "⌘Y", toggleQL, !any && !W.ql),
        SEP);
      if (trashed) file.push(it("放回原处", "", putBackSel, !sel.some(function (p) { return meta.trash[p]; })), it("立即删除…", "⌥⌘⌫", eraseSel));
      else file.push(it("移到废纸篓", "⌘⌫", trashSel, !any || locked));
      file.push(it("清倒废纸篓…", "⇧⌘⌫", function () { emptyTrash(win.el.id); }, !trashFull()));
      if (any) file.push(SEP, swatchRow(sel), it("标签…", "", null, false, { items: tagItems(sel) }));
      if (X) file.push(SEP, it("用「" + exportName() + "」打包下载", "", function () { exportPaths(sel); }, !any));
      // 开了真沙盒：浏览器沙盒里原来的文件（看不到了、还在）可以导进来
      var imp = FS.mirrorImportable ? FS.mirrorImportable() : null;
      if (imp && imp.files && window.TSU_AGENTS && TSU_AGENTS.importLocal) file.push(SEP, it("从浏览器沙盒导入 " + imp.files + " 个文件…", "", function () { TSU_AGENTS.importLocal(); }));
      return [
        { title: "文件", items: file },
        { title: "编辑", items: [
          it(undoOp ? "撤销" + undoOp.label : "撤销", "⌘Z", undo, !undoOp),
          SEP,
          it(one ? "拷贝“" + displayName(one) + "”" : any ? "拷贝 " + sel.length + " 项" : "拷贝", "⌘C", function () { copyItems(sel, toast); }, !any),
          it(clip.length > 1 ? "粘贴 " + clip.length + " 项" : "粘贴项目", "⌘V", function () { pasteInto(here()); }, !clip.length || !canCreate()),
          it("全选", "⌘A", function () { select(S.items.slice(), S.items[0]); }),
        ] },
        { title: "显示", items: viewItems().concat([SEP,
          it("使用分组", "⌃⌘0", toggleGroups, false, { checked: gkey() !== "none" }),
          it("分组方式", "", null, false, { items: groupItems() }),
          SEP,
          it(W.insp ? "隐藏预览面板" : "显示预览面板", "⇧⌘P", toggleInsp),
          it(W.ql ? "关闭快速查看" : "快速查看", "⌘Y", toggleQL, !W.ql && !any),
          SEP,
          it("显示隐藏文件", "⇧⌘.", toggleHidden, false, { checked: showHidden }),
        ]) },
        { title: "前往", items: [
          it("返回", "⌘[", goBack, !S.back.length),
          it("前进", "⌘]", goFwd, !S.fwd.length),
          it("上层文件夹", "⌘↑", goUp, S.cwd === "/" || S.cwd === RECENTS),
          SEP,
          it("最近使用", "⇧⌘F", function () { go(RECENTS); }),
          it("上传", "⌥⌘L", function () { go(UPLOADS); }, !isFolder(UPLOADS)),
          it("个人", "⇧⌘H", function () { go(HOME); }),
          it("根目录", "⇧⌘C", function () { go("/"); }),
          it("共享", "⇧⌘S", function () { go("/shared"); }, !isFolder("/shared")),
          it("应用程序", "⇧⌘A", function () { go(APPS); }),
          it("临时", "", function () { go("/tmp"); }),
          it("废纸篓", "", goTrash),
          SEP,
          it("最近使用的文件夹", "", null, !recentDirs().length, { items: recentDirs().map(function (p) { return it(label(p), "", function () { go(p); }, false, { icon: iconHtml(p, 16) }); }) }),
          SEP,
          it("前往文件夹…", "⇧⌘G", gotoFolder),
        ] },
        { title: "窗口", items: [
          it("显示上一个标签页", "⇧⌘[", function () { cycleTab(-1); }, tabs.length < 2),
          it("显示下一个标签页", "⇧⌘]", function () { cycleTab(1); }, tabs.length < 2),
          it("将标签页移到新窗口", "", moveTabOut, tabs.length < 2),
          it("合并所有窗口", "", mergeAll, openWins().length < 2),
        ] },
      ];
    }
    function setView(v) {
      S.view = v;
      localStorage.setItem("tsu-finder-view", v);
      render();
      reveal(elOf(S.sel[S.sel.length - 1]));
    }
    function toggleInsp() {
      W.insp = !W.insp;
      localStorage.setItem("tsu-finder-insp", W.insp ? "1" : "0");
      inspIn.dataset.key = "";
      render();
    }

    // ======== 鼠标：点选（⌘ 加选、⇧ 连选）、双击打开、右键菜单、拖栏宽、拖预览面板宽窄 ========
    itemsEl.addEventListener("mousedown", function (e) {
      if (W.renaming || e.target.closest(".fd-grip, .fd-grp")) return;
      var el = e.target.closest(".fd-it"), cw = e.target.closest(".fd-colw"), m = mode();
      // 分栏：点到别的栏 → 那一栏成为当前栏
      if (m === "columns" && cw && !cw.classList.contains("fd-colpv") && cw.dataset.dir !== S.colDir) {
        S.colDir = cw.dataset.dir;
        S.sel = [];
        S.anchor = null;
        if (!el) return select([]);
        if (!e.metaKey && !e.shiftKey) return select([el.dataset.path]);
      }
      if (!el) { if (e.button === 0 && !e.metaKey && !e.shiftKey && (m === "list" || m === "icons" || (cw && !cw.classList.contains("fd-colpv")))) select([]); return; }
      var p = el.dataset.path;
      if (e.metaKey) {
        var i = S.sel.indexOf(p);
        select(i >= 0 ? S.sel.filter(function (x) { return x !== p; }) : S.sel.concat([p]), p);
      } else if (e.shiftKey && S.anchor && S.items.indexOf(S.anchor) >= 0 && S.items.indexOf(p) >= 0) {
        var a = S.items.indexOf(S.anchor), b = S.items.indexOf(p);
        select(S.items.slice(Math.min(a, b), Math.max(a, b) + 1), S.anchor);
      } else if (S.sel.indexOf(p) < 0) select([p]);
    });
    scroll.addEventListener("mousedown", function (e) { // 内容区里、项目以外的空白
      var m = mode();
      if (!itemsEl.contains(e.target) && e.button === 0 && !W.renaming && !e.metaKey && !e.shiftKey && (m === "list" || m === "icons")) select([]);
    });

    // ---- 拖动框选（同 macOS）：空白处按下拖出一个框，碰到的都选上；按着 ⌘ = 碰到的反选，⇧ = 加选；拖到上下边缘自动滚。
    // 列表里在名字、图标以外的地方按下也是框选（名字、图标上按下是拖文件）；分栏在按下的那一栏里框 ----
    var band = null, bandClick = false;
    function bandBox(e) {
      var m = mode();
      if (e.button !== 0 || W.renaming || m === "gallery" || !e.target.closest || e.target.closest(".fd-grip, .fd-grp")) return null;
      var el = e.target.closest(".fd-it");
      if (m === "columns") {
        var cw = e.target.closest(".fd-colw");
        return cw && !el && !cw.classList.contains("fd-colpv") && cw.querySelector(".fd-col") ? { box: cw.querySelector(".fd-col"), dir: cw.dataset.dir } : null;
      }
      if (el && (m === "icons" || e.target.closest(".fd-ico, .fd-nm"))) return null;
      var r = scroll.getBoundingClientRect(); // 按在滚动条上：是滚，不是框
      if (e.clientX >= r.left + scroll.clientLeft + scroll.clientWidth || e.clientY >= r.top + scroll.clientTop + scroll.clientHeight) return null;
      return { box: scroll };
    }
    scroll.addEventListener("mousedown", function (e) { // 捕获阶段：先记下按下前选中的（⌘ 点一行时后面的处理会先改掉选中）
      var b = bandBox(e);
      if (!b) return;
      var r = b.box.getBoundingClientRect(), keep = (e.metaKey || e.shiftKey) && !(b.dir && b.dir !== S.colDir);
      band = { box: b.box, dir: b.dir, base: keep ? S.sel.slice() : [], flip: e.metaKey, sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, on: false, el: null, raf: 0,
        x0: e.clientX - r.left - b.box.clientLeft + b.box.scrollLeft, y0: e.clientY - r.top - b.box.clientTop + b.box.scrollTop };
      document.addEventListener("mousemove", bandMove, true);
      document.addEventListener("mouseup", bandUp, true);
    }, true);
    function bandMove(e) {
      if (!band) return;
      band.cx = e.clientX;
      band.cy = e.clientY;
      if (!band.on) {
        if (Math.abs(e.clientX - band.sx) + Math.abs(e.clientY - band.sy) < 4) return;
        band.on = true;
        band.el = document.createElement("div");
        band.el.className = "fd-band";
        band.raf = requestAnimationFrame(bandTick);
      }
      e.preventDefault();
      bandPaint();
    }
    function bandPaint() {
      if (band.dir && !band.box.isConnected) { // 分栏重画过：按目录找回那一栏
        var cw = Array.prototype.find.call(itemsEl.querySelectorAll(".fd-colw"), function (x) { return x.dataset.dir === band.dir; });
        if (cw && cw.querySelector(".fd-col")) band.box = cw.querySelector(".fd-col");
      }
      var box = band.box, r = box.getBoundingClientRect(), ox = r.left + box.clientLeft - box.scrollLeft, oy = r.top + box.clientTop - box.scrollTop;
      if (band.el.parentNode !== box) box.appendChild(band.el);
      var x1 = Math.max(0, Math.min(box.scrollWidth, band.cx - ox)), y1 = Math.max(0, Math.min(box.scrollHeight, band.cy - oy));
      var L = Math.min(band.x0, x1), T = Math.min(band.y0, y1), R = Math.max(band.x0, x1), B = Math.max(band.y0, y1);
      band.el.style.cssText = "left:" + L + "px;top:" + T + "px;width:" + (R - L) + "px;height:" + (B - T) + "px";
      // 碰到的：图标显示看图标和名字，列表、分栏看整行；分组那一行横着放不下被遮住的不算
      var hits = [], icons = mode() === "icons";
      box.querySelectorAll(".fd-it").forEach(function (el) {
        var parts = icons ? el.querySelectorAll(".fd-ico, .fd-nm") : [el], row = el.closest(".fd-grow:not(.fd-open)"), cr = row ? row.getBoundingClientRect() : null;
        for (var i = 0; i < parts.length; i++) {
          var q = parts[i].getBoundingClientRect(), ql = q.left, qr = q.right;
          if (cr) { ql = Math.max(ql, cr.left); qr = Math.min(qr, cr.right); }
          if (qr > ql && qr - ox > L && ql - ox < R && q.bottom - oy > T && q.top - oy < B) { hits.push(el.dataset.path); break; }
        }
      });
      var base = band.base, pick = band.flip ? base.filter(function (p) { return hits.indexOf(p) < 0; }).concat(hits.filter(function (p) { return base.indexOf(p) < 0; }))
        : base.concat(hits.filter(function (p) { return base.indexOf(p) < 0; }));
      var set = new Set(pick), sel = S.items.filter(function (p) { return set.has(p); });
      if (sel.join("\n") === S.sel.join("\n")) return;
      S.sel = sel;
      S.anchor = hits[hits.length - 1] || sel[sel.length - 1] || null;
      paintSel();
    }
    // 拖到上下边缘（或更外面）：一直滚，越出去越快
    function bandTick() {
      if (!band || !band.on) return;
      var box = band.box, r = box.getBoundingClientRect(), E = 16, dy = band.cy < r.top + E ? band.cy - r.top - E : band.cy > r.bottom - E ? band.cy - r.bottom + E : 0;
      if (dy) {
        var top = box.scrollTop;
        box.scrollTop += Math.max(-28, Math.min(28, Math.round(dy / 2) || (dy > 0 ? 1 : -1)));
        if (box.scrollTop !== top) bandPaint();
      }
      band.raf = requestAnimationFrame(bandTick);
    }
    function bandUp() {
      document.removeEventListener("mousemove", bandMove, true);
      document.removeEventListener("mouseup", bandUp, true);
      var b = band;
      band = null;
      if (!b || !b.on) return;
      cancelAnimationFrame(b.raf);
      if (b.el.parentNode) b.el.parentNode.removeChild(b.el);
      bandClick = true; // 松手时的 click 不算点了某一项（不然多选会缩成一项）
      setTimeout(function () { bandClick = false; }, 0);
      if (mode() === "columns") render(); // 分栏：选中的变了，右边的栏跟着换
      if (W.ql && S.sel.length === 1 && S.sel[0] !== W.ql) openQL(S.sel[0]);
    }
    scroll.addEventListener("click", function (e) { if (bandClick) { bandClick = false; e.stopPropagation(); } }, true);
    // 已选中的再点一下名字（停一会儿）= 改名，同 macOS；「显示全部」展开 / 收起一组
    var clickT = 0;
    itemsEl.addEventListener("click", function (e) {
      var all = e.target.closest(".fd-grp-all");
      if (all) { var g = all.parentElement.dataset.g; S.openGroups[g] = !S.openGroups[g]; return render(); }
      var nm = e.target.closest(".fd-nm"), el = e.target.closest(".fd-it");
      clearTimeout(clickT);
      // 多选时不带修饰键点其中一项：松手后只留这一项（按下时先不改，好整组拖走）
      if (el && !e.metaKey && !e.shiftKey && S.sel.length > 1) return select([el.dataset.path]);
      if (!nm || !el || e.metaKey || e.shiftKey || e.detail > 1) return;
      if (el.dataset.wasSel) clickT = setTimeout(function () { if (S.sel.length === 1 && S.sel[0] === el.dataset.path) rename(el.dataset.path); }, 650);
    });
    itemsEl.addEventListener("pointerdown", function (e) {
      var el = e.target.closest(".fd-it");
      if (el) { if (S.sel.indexOf(el.dataset.path) >= 0 && S.sel.length === 1) el.dataset.wasSel = "1"; else delete el.dataset.wasSel; }
    }, true);
    itemsEl.addEventListener("dblclick", function (e) {
      clearTimeout(clickT);
      var g = e.target.closest(".fd-grip");
      if (g) return autofit(g.parentElement);
      var el = e.target.closest(".fd-it");
      if (el && !W.renaming) openItem(el.dataset.path);
    });
    // 栏宽：拖每栏右边的分隔条；按住 ⌥ 所有栏一起改（并记成默认宽度）；双击按最长的名字适配
    itemsEl.addEventListener("pointerdown", function (e) {
      var g = e.target.closest(".fd-grip");
      if (!g || e.button !== 0) return;
      e.stopPropagation();
      var w = g.parentElement, dir = w.dataset.dir, x0 = e.clientX, w0 = w.offsetWidth, all = e.altKey;
      dragWith(e, g, function (ev) {
        var nw = Math.round(Math.max(120, Math.min(640, w0 + ev.clientX - x0)));
        if (all) {
          colDefault = nw;
          S.colW = {};
          localStorage.setItem("tsu-finder-colw", nw);
          itemsEl.querySelectorAll(".fd-colw:not(.fd-colpv)").forEach(function (c) { c.style.width = nw + "px"; });
        } else { S.colW[dir] = nw; w.style.width = nw + "px"; }
      });
    });
    function autofit(w) {
      var max = 0;
      w.querySelectorAll(".fd-it").forEach(function (r) { var nm = r.querySelector(".fd-nm"), dots = r.querySelector(".fd-dots"); max = Math.max(max, nm.scrollWidth + (dots ? dots.offsetWidth + 6 : 0)); });
      var nw = Math.round(Math.max(120, Math.min(640, max + 66)));
      S.colW[w.dataset.dir] = nw;
      w.style.width = nw + "px";
    }
    // 预览面板的宽窄：拖它的左边缘（记下来，下次开窗口也这么宽）
    insp.querySelector(".fd-insp-grip").addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.stopPropagation();
      var x0 = e.clientX, w0 = insp.offsetWidth;
      dragWith(e, e.target, function (ev) {
        var max = Math.max(220, Math.min(760, fd.clientWidth - 380));
        W.inspW = Math.round(Math.max(220, Math.min(max, w0 - (ev.clientX - x0))));
        insp.style.width = W.inspW + "px";
      }, function () { localStorage.setItem("tsu-finder-inspw", W.inspW); });
    });
    fd.addEventListener("contextmenu", function (e) {
      if (e.target.closest("input, .fd-side, .fd-status, .fd-insp, .fd-colpv, .fd-gal-stage, .fd-tabs, .fd-trashbar")) return;
      e.preventDefault();
      var el = e.target.closest(".fd-it");
      if (el && S.sel.indexOf(el.dataset.path) < 0) select([el.dataset.path]);
      else if (!el) select([]);
      scroll.focus({ preventScroll: true });
      popup(ctxItems(), { x: e.clientX, y: e.clientY });
    });
    // 侧边栏右键：同 macOS——在新标签页 / 新窗口中打开、显示简介
    side.addEventListener("contextmenu", function (e) {
      var a = e.target.closest(".fd-place");
      if (!a) return;
      e.preventDefault();
      var p = a.dataset.path, real = p !== RECENTS;
      popup([it("打开", "", function () { go(p); }), it("在新标签页中打开", "", function () { newTab(p); }), it("在新窗口中打开", "", function () { newWindow(p); }),
        SEP, it("显示简介", "", function () { showInfo([p]); }, !real),
        SEP, it(clip.length > 1 ? "粘贴 " + clip.length + " 项" : "粘贴项目", "", function () { pasteInto(p); }, !real || !clip.length)], { x: e.clientX, y: e.clientY });
    });
    head.addEventListener("click", function (e) {
      var h = e.target.closest("[data-k]");
      if (!h) return;
      S.sort = { key: h.dataset.k, dir: S.sort.key === h.dataset.k && S.sortSet ? -S.sort.dir : 1 };
      S.sortSet = true;
      render();
    });
    side.addEventListener("click", function (e) { var a = e.target.closest(".fd-place"); if (a) go(a.dataset.path); });
    crumbs.addEventListener("click", function (e) { var b = e.target.closest(".fd-crumb"); if (b && !b.classList.contains("fd-crumb-file")) go(b.dataset.path); });
    tb.addEventListener("click", function (e) {
      if (e.target.closest(".fd-clear")) { search.value = ""; onSearch(); search.focus(); return; }
      var b = e.target.closest("button");
      if (!b || b.disabled) return;
      var a = b.dataset.a;
      if (a === "back") goBack();
      else if (a === "fwd") goFwd();
      else if (VIEWS.indexOf(a) >= 0) setView(a);
      else if (a === "newdir") newFolder();
      else if (a === "insp") toggleInsp();
      else if (a === "tag") popup(tagItems(S.sel.slice()), under4(b));
      else if (a === "group") popup(groupItems(), under4(b));
    });
    tb.addEventListener("dblclick", function (e) { if (e.target.closest("button, label")) e.stopPropagation(); }); // 连点按钮不触发标题栏缩放
    trashBar.addEventListener("click", function (e) { if (e.target.closest('[data-a="empty"]')) emptyTrash(win.el.id); });
    // 标签页栏：点标签切换，✕ / 中键关掉，「+」新建
    tabsEl.addEventListener("mousedown", function (e) { if (e.target.closest(".fd-tab, .fd-tab-add")) e.preventDefault(); });
    tabsEl.addEventListener("click", function (e) {
      if (e.target.closest(".fd-tab-add")) return newTab();
      var t = e.target.closest(".fd-tab");
      if (!t) return;
      if (e.target.closest(".fd-tab-x")) return closeTab(+t.dataset.i);
      switchTab(+t.dataset.i);
    });
    tabsEl.addEventListener("auxclick", function (e) { var t = e.target.closest(".fd-tab"); if (t && e.button === 1) { e.preventDefault(); closeTab(+t.dataset.i); } });
    tabsEl.addEventListener("contextmenu", function (e) {
      var t = e.target.closest(".fd-tab");
      if (!t) return;
      e.preventDefault();
      var i = +t.dataset.i;
      popup([it("关闭标签页", "", function () { closeTab(i); }), it("关闭其他标签页", "", function () { closeOthers(i); }, tabs.length < 2),
        SEP, it("将标签页移到新窗口", "", function () { switchTab(i); moveTabOut(); }, tabs.length < 2)], { x: e.clientX, y: e.clientY });
    });
    // 预览面板里的按钮
    insp.addEventListener("mousedown", function (e) { if (e.target.closest("button, [data-a]")) e.preventDefault(); });
    insp.addEventListener("click", function (e) {
      var b = e.target.closest("[data-a]"), p = insp.dataset.path;
      if (!b || !p || !FS.exists(p)) return;
      var a = b.dataset.a;
      if (a === "more") openQL(p);
      else if (a === "open") { var act = actionFor(p); if (act) act.run(); }
      else if (a === "addtag") popup(tagItems([p]), under4(b));
      else if (a === "untag") setTag([p], b.dataset.tag, false);
    });
    // 点窗口里的空白处，键盘焦点回到文件区（不抢输入框、不抢预览里的文字选区）
    win.el.addEventListener("pointerdown", function (e) {
      if (e.target.closest("input, .fd-live-text")) return;
      setTimeout(function () { if (!W.renaming && document.activeElement !== search) scroll.focus({ preventScroll: true }); }, 0);
    });

    // ======== 搜索：按名称，含所有子目录 ========
    var searchT = 0;
    function onSearch() {
      S.query = search.value.trim();
      tb.querySelector(".fd-search").classList.toggle("fd-has", !!search.value);
      S.sel = [];
      closeQL();
      render();
    }
    search.addEventListener("input", function () { clearTimeout(searchT); searchT = setTimeout(onSearch, 80); });
    search.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Escape") { search.value = ""; onSearch(); scroll.focus(); }
      if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); scroll.focus(); if (S.items.length) select([S.items[0]]); }
    });

    // ======== 键盘（焦点在这个访达窗口里时）========
    var typed = "", typedT = 0;
    function moveSel(d, extend) {
      if (!S.items.length) return;
      var cur = S.items.indexOf(S.sel[S.sel.length - 1]);
      var i = cur < 0 ? (d > 0 ? 0 : S.items.length - 1) : Math.max(0, Math.min(S.items.length - 1, cur + d));
      if (extend && S.anchor && S.items.indexOf(S.anchor) >= 0) {
        var a = S.items.indexOf(S.anchor), range = S.items.slice(Math.min(a, i), Math.max(a, i) + 1);
        if (i < a) range.reverse();
        select(range, S.anchor);
      } else select([S.items[i]]);
    }
    // 图标（含分组的一行行）：↑↓ 按位置找上一行 / 下一行里横向最近的那个
    function geoMove(d, extend) {
      var cur = elOf(S.sel[S.sel.length - 1]);
      if (!cur) return moveSel(d, extend);
      var r = cur.getBoundingClientRect(), cx = (r.left + r.right) / 2, best = null, bd = Infinity;
      itemsEl.querySelectorAll(".fd-it").forEach(function (el) {
        if (el === cur) return;
        var q = el.getBoundingClientRect(), dy = d > 0 ? q.top - r.top : r.top - q.top;
        if (dy < 8) return;
        var score = Math.round(dy) * 10000 + Math.abs((q.left + q.right) / 2 - cx);
        if (score < bd) { bd = score; best = el; }
      });
      if (!best) return;
      var p = best.dataset.path;
      if (extend && S.anchor && S.items.indexOf(S.anchor) >= 0) {
        var a = S.items.indexOf(S.anchor), i = S.items.indexOf(p), range = S.items.slice(Math.min(a, i), Math.max(a, i) + 1);
        if (i < a) range.reverse(); // 最后一个是「当前」那一头：往上扩的时候要在前面（同 moveSel），不然下一次 ⇧↑ 又从锚点算、原地不动
        select(range, S.anchor);
      } else select([p]);
    }
    // 浏览器占着 ⌘N / ⌘T / ⌘W：新窗口、新标签页、关标签页用 ⌥⌘（同终端）
    function onKey(e) {
      if ((e.target.closest && e.target.closest("input, textarea")) || W.renaming) return;
      var k = e.key, K = k.length === 1 ? k.toLowerCase() : k, code = e.code || "", cmd = e.metaKey || e.ctrlKey, m = mode(), one = S.sel.length === 1 ? S.sel[0] : null, handled = true;
      var del = k === "Backspace" || k === "Delete";
      if (e.ctrlKey && e.metaKey && k === "0") toggleGroups();
      else if (cmd && e.altKey && code === "KeyN") newWindow(HOME);
      else if (cmd && e.altKey && code === "KeyT") newTab();
      else if (cmd && e.altKey && code === "KeyW") { if (e.shiftKey) D.close(win.el.id); else closeTab(); }
      else if (cmd && e.shiftKey && (code === "BracketLeft" || code === "BracketRight")) cycleTab(code === "BracketLeft" ? -1 : 1);
      else if (cmd && e.shiftKey && del) emptyTrash(win.el.id);
      else if (cmd && e.altKey && del) eraseSel();
      else if (cmd && del) { if (S.sel.length && S.sel.every(inTrash)) eraseSel(); else trashSel(); }
      else if (cmd && e.shiftKey && K === "n") newFolder();
      else if (cmd && e.shiftKey && K === "h") go(HOME);
      else if (cmd && e.shiftKey && K === "a") go(APPS);
      else if (cmd && e.shiftKey && K === "f") go(RECENTS);
      else if (cmd && e.shiftKey && K === "c") go("/");
      else if (cmd && e.shiftKey && K === "s") { if (isFolder("/shared")) go("/shared"); }
      else if (cmd && e.altKey && code === "KeyL") { if (isFolder(UPLOADS)) go(UPLOADS); }
      else if (cmd && e.shiftKey && K === "g") gotoFolder();
      else if (cmd && e.shiftKey && code === "Period") toggleHidden();
      else if (cmd && e.shiftKey && K === "p") toggleInsp();
      else if (cmd && (K === "o" || k === "ArrowDown")) openSel();
      else if (cmd && k === "[") goBack();
      else if (cmd && k === "]") goFwd();
      else if (cmd && k === "ArrowUp") { if (m === "columns" && S.colDir !== S.cwd) colLeft(); else goUp(); }
      else if (cmd && /^[1-4]$/.test(k)) setView(VIEWS[+k - 1]);
      else if (cmd && K === "f") { search.focus(); search.select(); }
      else if (cmd && K === "a") select(S.items.slice(), S.items[0]);
      else if (cmd && K === "y") toggleQL();
      else if (cmd && K === "i") showInfo(S.sel.length ? S.sel.slice() : S.cwd === RECENTS ? [] : [here()]);
      else if (cmd && K === "c") { if (S.sel.length) copyItems(S.sel.slice(), toast); else handled = false; }
      else if (cmd && K === "v") { if (canCreate()) pasteInto(here()); }
      else if (cmd && K === "d") duplicateSel();
      else if (cmd && K === "z") undo();
      else if (cmd) handled = false;
      else if (W.ql && (k === "PageDown" || k === "PageUp")) { if (!(qView._ofc && qView._ofc.onKey && qView._ofc.onKey(e))) qScroll.key(e); }
      else if (k === " ") toggleQL();
      else if (k === "Escape") { if (W.ql) closeQL(true); else if (m !== "gallery") select([]); }
      else if (k === "Enter") { if (one && isApp(one)) openItem(one); else if (one) rename(one); }
      else if (m === "columns" && k === "ArrowRight") colRight();
      else if (m === "columns" && k === "ArrowLeft") colLeft();
      else if (k === "ArrowDown" || k === "ArrowUp") { if (m === "icons") geoMove(k === "ArrowDown" ? 1 : -1, e.shiftKey); else moveSel(k === "ArrowDown" ? 1 : -1, e.shiftKey); }
      else if ((k === "ArrowRight" || k === "ArrowLeft") && (m === "icons" || m === "gallery")) moveSel(k === "ArrowRight" ? 1 : -1, e.shiftKey);
      else if (k === "Home") { if (S.items.length) select([S.items[0]]); }
      else if (k === "End") { if (S.items.length) select([S.items[S.items.length - 1]]); }
      else if (k.length === 1 && !e.altKey) {
        // 打字跳到以这些字开头的项
        clearTimeout(typedT);
        typed += k.toLowerCase();
        typedT = setTimeout(function () { typed = ""; }, 900);
        var hit = S.items.find(function (p) { return displayName(p).toLowerCase().indexOf(typed) === 0; });
        if (hit) select([hit]);
      } else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    }
    win.el.addEventListener("keydown", onKey);

    // ======== 拖放：窗口内拖到文件夹 / 标签页上 = 移动；从系统拖文件进来 = 上传到落点的文件夹（只收文本）；拖给「导出」= 打包下载；拖到 Dock 的废纸篓 = 扔掉 ========
    var dragPaths = null;
    itemsEl.addEventListener("dragstart", function (e) {
      var el = e.target.closest(".fd-it");
      if (!el || W.renaming || band) return e.preventDefault(); // 列表里在名字以外按下拖：是框选，不是拖文件
      if (S.sel.indexOf(el.dataset.path) < 0) select([el.dataset.path]);
      dragPaths = S.sel.slice();
      e.dataTransfer.effectAllowed = "copyMove"; // 访达里是移动；「导出」那边要的是拷贝
      e.dataTransfer.setData(MIME, JSON.stringify(dragPaths));
      e.dataTransfer.setData("text/plain", dragPaths.join("\n"));
    });
    itemsEl.addEventListener("dragend", function () { dragPaths = null; clearDropMarks(); });
    // 落点：文件夹 / 侧边栏的位置 / 路径栏里的文件夹 / 标签页 / 分栏的某一栏 → 那个文件夹；其余空白 → 当前文件夹
    function dropTarget(e) {
      var el = e.target.closest(".fd-it.fd-dir, .fd-place, .fd-crumb:not(.fd-crumb-file), .fd-tab");
      if (el && el.dataset.path !== RECENTS && isFolder(el.dataset.path)) return { el: el, dir: el.dataset.path };
      if (el) return null;
      var cw = e.target.closest(".fd-colw");
      if (cw && cw.dataset.dir) return { el: cw, dir: cw.dataset.dir };
      if (e.target.closest(".fd-main") && S.cwd !== RECENTS) return { el: null, dir: here() };
      return null;
    }
    function clearDropMarks() { fd.querySelectorAll(".fd-drop-on").forEach(function (x) { x.classList.remove("fd-drop-on"); }); fd.classList.remove("fd-dropping"); }
    var isExternal = function (e) { return Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0; };
    var hasPaths = function (e) { return !!dragPaths || Array.prototype.indexOf.call(e.dataTransfer.types || [], MIME) >= 0; }; // 别的访达窗口、别的 App（编辑器的文件树等）拖来的路径也收
    fd.addEventListener("dragover", function (e) {
      var t = dropTarget(e), ext = isExternal(e);
      if (!t || (!ext && !hasPaths(e)) || (ext && under(t.dir, TRASH))) return clearDropMarks();
      if (!ext && dragPaths && dragPaths.indexOf(t.dir) >= 0) return clearDropMarks(); // 拖到自己身上
      e.preventDefault();
      e.dataTransfer.dropEffect = ext ? "copy" : "move";
      clearDropMarks();
      if (t.el) t.el.classList.add("fd-drop-on"); else if (ext || !dragPaths || here() !== parentOf(dragPaths[0])) fd.classList.add("fd-dropping");
    });
    fd.addEventListener("dragleave", function (e) { if (!fd.contains(e.relatedTarget)) clearDropMarks(); });
    fd.addEventListener("drop", function (e) {
      var t = dropTarget(e);
      clearDropMarks();
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      if (isExternal(e) && e.dataTransfer.files.length) return under(t.dir, TRASH) ? null : upload(e.dataTransfer.files, t.dir);
      var paths = dragPaths;
      try { paths = paths || JSON.parse(e.dataTransfer.getData(MIME) || "null"); } catch (x) { paths = null; }
      if (paths && paths.length) moveInto(paths, t.dir);
    });
    // 上传：读成字节，按 UTF-8 严格解码：文本存文本，解不开（或含 NUL）的按二进制存（沙盒存得了的话）；写不进去（没权限）的跳过并说明
    function upload(files, dir) {
      var skipped = [], added = [], decoder = new TextDecoder("utf-8", { fatal: true });
      Promise.all(Array.prototype.map.call(files, function (f) {
        return f.arrayBuffer().then(function (buf) {
          var text;
          try { text = decoder.decode(buf); } catch (x) { text = null; }
          var bin = text === null || text.indexOf("\u0000") >= 0;
          if (bin && !FS.writeBinary) { skipped.push(f.name + "（二进制）"); return; }
          var p = join(dir, freeName(dir, f.name));
          try { if (bin) FS.writeBinary(p, new Uint8Array(buf)); else FS.write(p, text); } catch (x) { skipped.push(f.name + "（" + (x && x.message || x) + "）"); return; }
          added.push(p);
        }, function () { skipped.push(f.name + "（读不了）"); });
      })).then(function () {
        render();
        if (added.length && here() === dir) select(added);
        if (skipped.length) toast((added.length ? "已添加 " + added.length + " 个；" : "") + "没放进去：" + skipped.join("、"));
        else if (added.length) toast("已添加 " + added.length + " 个文件到“" + label(dir) + "”");
      }, function (e) { console.error(e); toast("上传没成：" + (e && e.message || e)); });
    }

    // 内容区大小变了：画廊的大图、分栏的预览重画，分组的「显示全部」重算；窗口窄了收起侧边栏；预览面板宽窄变了重排预览
    if (window.ResizeObserver) {
      new ResizeObserver(function () { var m = mode(); if (m === "gallery") drawStage(); else if (m === "columns") fitColPv(); else if (m === "icons" && gkey() !== "none") fitGroups(); }).observe(scroll);
      new ResizeObserver(function () { win.el.classList.toggle("fd-narrow", win.el.offsetWidth < 700); }).observe(win.el);
      new ResizeObserver(function () { fitInsp(); }).observe(inspIn);
    }
    // 打开时重画一次（关着的时候不跟着刷新）并把焦点给文件区；收起 / 关掉时快速查看也收起来
    var show0 = win.show, hide0 = win.hide;
    win.show = function () {
      var wasClosed = win.state === "closed";
      show0.apply(win, arguments);
      if (wasClosed) render();
      setTimeout(function () { if (!W.renaming) scroll.focus({ preventScroll: true }); }, 0);
    };
    win.hide = function () { closeQL(); return hide0.apply(win, arguments); };
    // 「在访达中显示」：文件夹就打开它，文件就打开所在的文件夹并选中它
    function revealIn(p) {
      win.show();
      if (!p || !FS.exists(p)) return;
      if (isFolder(p) && mode() !== "columns") { if (p !== S.cwd) go(p); return; }
      go(parentOf(p));
      select([p]);
    }
    renderSide();

    Object.assign(self, {
      id: id, win: win,
      render: render,
      go: function (p) { go(p); },
      cwd: function () { return S.cwd; },
      reveal: revealIn,
      openQL: openQL,
      closeQL: closeQL,
      gotoFolder: gotoFolder,
      toast: toast,
      menus: menus,
      refresh: function () { inspIn.dataset.key = ""; if (win.state !== "closed") render(); },
      // 关掉的窗口再拿来用（新建访达窗口）：从一个新的标签页开始
      reset: function (dir, tab) {
        closeQL();
        tabs = [tab || tabState(dir || HOME)];
        tabIdx = 0;
        S = tabs[0];
        undoOp = null;
        search.value = S.query;
        tb.querySelector(".fd-search").classList.toggle("fd-has", !!S.query);
        itemsEl.textContent = "";
        inspIn.dataset.key = "";
      },
      // 合并窗口时把自己的标签页交出去
      takeTabs: function () { saveScroll(); closeQL(); var t = tabs; tabs = [tabState(HOME)]; tabIdx = 0; S = tabs[0]; return t; },
      // 刷新不丢：每个标签页在哪、怎么显示、怎么排、选中了什么
      getState: function () { saveScroll(); return { idx: tabIdx, tabs: tabs.map(function (t) { return { cwd: t.cwd, colDir: t.colDir, view: t.view, sort: t.sort, sortSet: t.sortSet, colW: t.colW, sel: t.sel.slice(0, 50), top: t.top, left: t.left }; }) }; },
      setState: function (o) {
        if (!o || !o.tabs || !o.tabs.length) return;
        tabs = o.tabs.map(function (x) {
          var dir = x.cwd === RECENTS || isFolder(x.cwd) ? x.cwd : HOME, t = tabState(dir, VIEWS.indexOf(x.view) >= 0 ? x.view : undefined);
          if (x.colDir && isFolder(x.colDir) && under(x.colDir, dir)) t.colDir = x.colDir;
          if (x.sort) { t.sort = x.sort; t.sortSet = !!x.sortSet; }
          t.colW = x.colW || {}; t.sel = (x.sel || []).filter(function (p) { return FS.exists(p); }); t.top = x.top || 0; t.left = x.left || 0;
          return t;
        });
        tabIdx = Math.max(0, Math.min(tabs.length - 1, o.idx || 0));
        S = tabs[tabIdx];
        itemsEl.textContent = "";
        if (win.state !== "closed") render();
      },
    });
    finders.push(self);
    return self;
  }

  // ======== 窗口的管理：新建（先用关着的）、Dock / 启动台打开、「在访达中显示」========
  function newWindow(dir, tab) {
    var f = finders.find(function (x) { return x.win.state === "closed"; });
    if (f) f.reset(dir, tab);
    else f = Finder("finder-" + (++winSeq), dir || HOME, tab);
    f.win.show();
    return f;
  }
  // Dock、启动台：有开着的访达窗口就叫到前面，没有就开一个新的（同 macOS）
  function openFinder() {
    var f = frontFinder() || openWins().slice(-1)[0];
    if (f) { if (f.win.state === "min") f.win.show(); else f.win.front(); return f; }
    return newWindow(HOME);
  }
  function revealPath(p) {
    var f = frontFinder() || newWindow(HOME);
    f.reveal(p);
    return f;
  }
  function openTrashWin() {
    FS.ready().then(function () {
      try { if (!FS.isDir(TRASH)) FS.mkdirp(TRASH); } catch (e) { return; }
      var f = finders.find(function (x) { return x.win.state !== "closed" && x.cwd() === TRASH; });
      if (f) { if (f.win.state === "min") f.win.show(); else f.win.front(); return; }
      newWindow(TRASH);
    });
  }
  var toastAny = function (msg) { var f = frontFinder(); if (f) f.toast(msg); };
  // 拖到 Dock 里某个 App 上 = 用它打开（同 macOS）。文件：那个 App 能开才开；文件夹：访达开新窗口、终端在那开新窗口、编辑器设为工作目录。→ 开了几个
  function openWith(app, paths) {
    var n = 0, oid = app === "win" ? "term" : app;
    (paths || []).forEach(function (p) {
      if (!p || !FS.exists(p)) return;
      if (isFolder(p)) {
        if (app === "finder") { newWindow(p); n++; }
        else if (app === "ide" && window.TSU_IDE && TSU_IDE.open) { TSU_IDE.open(p); n++; }
        else if (app === "win" && window.TSU_TERM && TSU_TERM.openWindow) { TSU_TERM.openWindow(p); n++; }
        return;
      }
      if (app === "finder") { revealPath(p); n++; return; }
      var o = openers(p).filter(function (x) { return x.id === oid; })[0];
      if (o) { touchOpen(p); o.run(); n++; }
    });
    return n;
  }

  // ======== 显示简介（⌘I）：每项一个小窗口（同 macOS 的「简介」）：图标、名称、大小；一排标签、通用信息、名称与扩展名、共享与权限 ========
  function showInfo(paths) {
    paths.slice(0, 8).forEach(function (p) {
      if (!p || p === RECENTS || !FS.exists(p)) return;
      var w = infos.find(function (x) { return x.path === p && x.win.state !== "closed"; }) || infos.find(function (x) { return x.win.state === "closed"; });
      if (!w) w = makeInfo();
      w.path = p;
      drawInfo(w);
      if (w.win.state === "normal" || w.win.state === "zoom") w.win.front(); else w.win.show();
    });
  }
  function makeInfo() {
    var body = document.createElement("div"), rec = { path: "", body: body };
    body.className = "fd-info";
    rec.win = D.createWindow({ id: "finder-info-" + (infos.length + 1), app: "finder", name: "访达", className: "fd-infowin", width: 290, height: 560, content: body,
      title: function () { return rec.path ? "“" + displayName(rec.path) + "”简介" : "简介"; },
      menus: function () { return [{ title: "文件", items: [it("新建访达窗口", "⌥⌘N", function () { newWindow(HOME); }), SEP, it("关闭窗口", "", function () { rec.win.hide("closed"); })] }]; },
      initial: function () { // 一个挨一个往右下错开
        var a = D.area(), n = infos.filter(function (x) { return x.win.state !== "closed"; }).length;
        return { left: a.left + 60 + (n % 8) * 24, top: a.top + 40 + (n % 8) * 24, width: 290, height: Math.min(560, a.height - 60) };
      },
    });
    body.addEventListener("click", function (e) {
      var b = e.target.closest("[data-tag]");
      if (b && FS.exists(rec.path)) setTag([rec.path], b.dataset.tag, !b.classList.contains("on"));
    });
    body.addEventListener("keydown", function (e) {
      var inp = e.target.closest(".fd-info-name");
      if (!inp) return;
      e.stopPropagation();
      if (e.key === "Escape") { inp.value = baseOf(rec.path); inp.blur(); }
      if (e.key === "Enter") {
        e.preventDefault();
        var msg = "", to = renameTo(rec.path, inp.value, function (m) { msg = m; });
        if (msg) { D.alert({ window: rec.win.el.id, title: msg, icon: "caution" }); inp.value = baseOf(rec.path); }
        if (to) { rec.path = to; inp.blur(); renderAll(); }
      }
    });
    infos.push(rec);
    return rec;
  }
  function drawInfo(w) {
    var p = w.path, b = w.body;
    if (!FS.exists(p)) { if (w.win.state !== "closed") w.win.hide("closed"); return; }
    var st = FS.stat(p) || {}, info = appInfo(p), size = isFolder(p) ? countOf(p) + " 项" : sizeOf(p);
    var rows = [["种类", kindOf(p)], ["大小", size], ["位置", parentOf(p).replace(HOME, "~")], ["创建时间", longDate(created(p))], ["修改时间", longDate(st.mtime)]];
    if (info) rows.splice(1, 0, ["版本", info.version || "1.0"]);
    if (meta.open[p]) rows.push(["上次打开", longDate(meta.open[p])]);
    if (meta.trash[p]) rows.push(["原来的位置", parentOf(meta.trash[p].from).replace(HOME, "~")]);
    var perm = [];
    if (st.owner) perm.push(["所有者", st.owner]);
    if (typeof st.mode === "number") perm.push(["权限", (FS.modeStr ? FS.modeStr(st).slice(1) + " " : "") + "(" + (st.mode & 511).toString(8).padStart(3, "0") + ")"]);
    var kv = function (list) { return '<div class="fd-kv">' + list.map(function (r) { return "<div><span>" + esc(r[0]) + "：</span><span>" + esc(r[1]) + "</span></div>"; }).join("") + "</div>"; };
    b.innerHTML = '<div class="fd-info-head"><span class="fd-info-ico">' + (info ? appIcon(info.id, 44) : p === TRASH ? trashIco() : iconHtml(p, 44, true)) + "</span><div><b></b><span>" + esc(size) + "</span></div></div>" +
      '<div class="fd-info-date">修改时间：' + esc(longDate(st.mtime)) + "</div>" +
      '<div class="fd-info-tags">' + TAGS.map(function (t) { return '<button data-tag="' + t[0] + '" title="' + t[1] + '" style="background:' + t[2] + '"' + (tagsOf(p).indexOf(t[0]) >= 0 ? ' class="on"' : "") + "></button>"; }).join("") + "</div>" +
      "<section><h5>通用</h5>" + kv(rows) + "</section>" +
      '<section><h5>名称与扩展名</h5><input class="fd-info-name" spellcheck="false"' + (fixed(p) ? " disabled" : "") + "></section>" +
      (perm.length ? "<section><h5>共享与权限</h5>" + kv(perm) + "</section>" : "");
    b.querySelector(".fd-info-head b").textContent = info ? baseOf(p) : label(p);
    b.querySelector(".fd-info-name").value = baseOf(p);
    w.win.setTitle("“" + displayName(p) + "”简介");
  }
  // 文件变了：开着的简介跟着刷新（正在改名字的那个不动）
  function refreshInfos() { infos.forEach(function (w) { if (w.win.state !== "closed" && !w.body.contains(document.activeElement)) drawInfo(w); }); }

  // ======== 第一个窗口（id 仍是 finder：桌面、别的 App 按这个找它）========
  var main = Finder("finder", HOME);

  // ======== 文件系统变了：记下新出现的文件的「创建时间」；合并同一轮里的多次变更，所有访达窗口一起刷新 ========
  var known = null, gone = [], goneT = 0, pending = 0;
  FS.onChange(function (p) {
    if (known) {
      if (FS.exists(p)) { if (!known.has(p)) { known.add(p); if (!meta.birth[p]) { meta.birth[p] = Date.now(); saveMeta(); } } }
      else if (known.has(p)) {
        known.delete(p);
        // 删掉的：稍后清掉本机记的东西（移动 / 改名时新路径已经先接过去了）
        gone.push(p);
        clearTimeout(goneT);
        goneT = setTimeout(function () { var g = gone; gone = []; g.forEach(function (q) { if (!FS.exists(q)) eachMeta(q, function (mm, key) { delete mm[key]; }); }); saveMeta(); }, 0);
      }
    }
    if (pending) return;
    pending = setTimeout(function () { pending = 0; renderAll(); syncTrash(); }, 40);
  });
  document.addEventListener("tsu-theme", function () { thumbCache.clear(); finders.forEach(function (f) { f.refresh(); }); refreshInfos(); });
  // 另一个浏览器标签页改了标签 / 分组：跟着换（不然两边各存各的，后存的把先存的盖掉）
  window.addEventListener("storage", function (e) {
    if (e.key === "tsu-finder-meta") {
      var m = store.get("tsu-finder-meta", {});
      MKEYS.forEach(function (k) { meta[k] = m[k] && typeof m[k] === "object" ? m[k] : {}; });
      tagVer++;
    } else if (e.key === "tsu-finder-group") groupPref = store.get("tsu-finder-group", {});
    else if (e.key === "tsu-finder-hidden") showHidden = e.newValue === "1";
    else return;
    finders.forEach(function (f) { f.refresh(); });
  });
  document.addEventListener("tsu-apps", function () { FS.ready().then(function () { syncApps(true); renderAll(); }); });
  if (!D.appList && window.MutationObserver && document.getElementById("dock")) { // 没有正式的 App 列表：Dock 上的图标变了就同步一次
    var dockT = 0;
    new MutationObserver(function () { clearTimeout(dockT); dockT = setTimeout(function () { syncApps(false); renderAll(); }, 300); })
      .observe(document.getElementById("dock"), { childList: true });
  }

  // ======== Dock：蓝色文件夹，放在「系统设置」后面；点它 = openFinder；最右边的废纸篓也由访达管 ========
  var dockA = D.addDockApp({ app: "finder", title: "访达", className: "ico-folder", icon: "" });
  var gear = dockEl("settings");
  if (gear) gear.after(dockA);
  if (D.registerApp) D.registerApp({ id: "finder", name: "访达", open: openFinder });
  if (D.setTrash) D.setTrash({
    full: trashFull,
    open: openTrashWin,
    empty: function () { emptyTrash(null); },
    drop: function (paths) { var moved = toTrash(paths, toastAny); if (moved.length) toastAny("已将 " + moved.length + " 项移到废纸篓"); },
  });

  var restored = FS.ready().then(function () {
    known = new Set(FS.walk("/"));
    MKEYS.forEach(function (k) { Object.keys(meta[k]).forEach(function (q) { if (!FS.exists(q)) delete meta[k][q]; }); }); // 清掉已经不在的
    saveMeta();
    try { if (!FS.exists(UPLOADS)) FS.mkdirp(UPLOADS); } catch (e) {}
    return new Promise(function (done) { setTimeout(function () { syncApps(false); restoreWins(); renderAll(); syncTrash(); done(); }, 0); });
  });
  if (D.holdRestore) D.holdRestore(restored); // 桌面等访达窗口建回来再排叠放
  // 所有脚本都跑完（各 App 都挂上 Dock 了）再对一次 App 列表
  window.addEventListener("load", function () { FS.ready().then(function () { syncApps(true); renderAll(); }); });

  window.TSU_FINDER = {
    win: main.win,
    putBack: function (paths) { return putBack(paths || [], toastAny); }, // 放回原处（手机上的「文件」App 也用这个，废纸篓的记录才对得上）
    go: function (p) { var f = frontFinder() || newWindow(HOME); f.win.show(); f.go(p); },
    open: revealPath, // 文件夹：打开它；文件：打开所在的文件夹并选中它（「在访达中显示」）
    reveal: revealPath,
    preview: function (p) { var f = revealPath(p); f.openQL(p); },
    newWindow: function (p) { return newWindow(p && FS.isDir(p) ? p : HOME); },
    gotoFolder: function () { var f = frontFinder() || newWindow(HOME); f.win.show(); f.gotoFolder(); },
    openWith: openWith,
    // 桌面的右键菜单用：访达的剪贴板里有几项、粘贴到某个文件夹、在某个文件夹里新建文件夹（都会在访达里显示出来）
    clipCount: function () { return clip.filter(function (p) { return FS.exists(p); }).length; },
    pasteTo: function (dir) {
      if (!dir || !clip.length) return [];
      if (!FS.isDir(dir)) FS.mkdirp(dir);
      var made = [];
      clip.filter(function (p) { return FS.exists(p) && !under(dir, p); }).forEach(function (p) {
        var to = join(dir, parentOf(p) === dir ? copyName(dir, baseOf(p)) : freeName(dir, baseOf(p)));
        try { FS.copy(p, to); made.push(to); } catch (e) { toastAny(e.message); }
      });
      if (made.length) revealPath(made[0]);
      return made;
    },
    newFolder: function (dir) { if (!FS.isDir(dir)) FS.mkdirp(dir); var p = join(dir, freeName(dir, "未命名文件夹")); FS.mkdirp(p); revealPath(p); return p; },
    openTrash: openTrashWin,
    emptyTrash: function () { emptyTrash(null); },
    trash: function (paths) { return toTrash(paths || [], toastAny); },
    info: function (paths) { showInfo(paths || []); },
  };
})();
