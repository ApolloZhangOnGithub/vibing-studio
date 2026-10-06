// ficons.js —— 文件类型的小图标：一套 16 格的细线图标，同「文件」视图里的文件夹（1.2 的线、圆角、淡淡的填色），全都一样大、放在同一格里——
//   文稿（一张纸，右上角折一下）里放一个小图案：文本几行、代码 ‹ ›、JSON { }、Markdown M↓、配置两根滑杆、字体 A、压缩包一条拉链；
//   PDF / Word / Excel / PowerPoint：纸的下面一条带颜色的签（同访达的文稿图标），签上面是几行字、表格、柱子；
//   图片、影片是相框（山和太阳、播放键），音频一个音符，脚本一个终端窗口，数据库一个圆柱，磁盘映像一块硬盘，Git 的分叉。
//   颜色按种类：跟配色方案走的那几种（蓝、黄、绿、橙、红、淡色），外加固定的紫（图片、影音）、青（Go 这些）。
//   TSU_FICON(name) → 文件是 Seti 的彩色图标（见 setiOf），文件夹是 '<i class="st-ico st-fi st-fc-…"><svg…></svg></i>'；TSU_FICON.svg(name, dir) → 只要图形（Claude 风格的文件卡片，单色，还是这里的细线图标）
//   「文件」视图（files.js）、标签页（browser.js）、文件卡片（filepanel.js）都用这一套
(function () {
  "use strict";
  if (window.TSU_FICON) return;
  var SV = function (b) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' + b + "</svg>"; };
  var TINT = ' fill="currentColor" fill-opacity=".14"';
  // 纸：9 格宽、12.6 格高，圆角；右上角折过来的一角
  var PAGE = '<path d="M4.5 1.75h4.4c.2 0 .4.1.5.2l2.9 2.9c.1.1.2.3.2.5v8.2c0 .6-.5 1.1-1.1 1.1H4.5c-.6 0-1.1-.5-1.1-1.1V2.85c0-.6.5-1.1 1.1-1.1z"' + TINT + '/><path d="M9.1 1.9v2.6c0 .4.3.7.7.7h2.6"/>';
  // 相框（图片、影片、脚本的窗口）：12 格宽、10 格高
  var FRAME = '<rect x="1.9" y="2.9" width="12.2" height="10.2" rx="1.8"' + TINT + "/>";
  // 纸的下面一条签（PDF、Office）：实心的一条
  var LABEL = '<path d="M3.4 10.3h9.1v2.9c0 .6-.5 1.1-1.1 1.1H4.5c-.6 0-1.1-.5-1.1-1.1z" fill="currentColor" stroke="none"/>';
  var G = {
    file: PAGE,
    text: PAGE + '<path d="M5.6 8h4.8M5.6 10h4.8M5.6 12h3"/>',
    code: PAGE + '<path d="M6.8 8.1 5.3 9.8l1.5 1.7M9.2 8.1l1.5 1.7-1.5 1.7"/>',
    json: PAGE + '<path d="M6.9 7.9c-.7 0-1 .3-1 .9v.5c0 .4-.2.6-.6.6.4 0 .6.2.6.6v.5c0 .6.3.9 1 .9M9.1 7.9c.7 0 1 .3 1 .9v.5c0 .4.2.6.6.6-.4 0-.6.2-.6.6v.5c0 .6-.3.9-1 .9"/>',
    md: PAGE + '<path d="M5.4 12V8.3l1.4 1.8 1.4-1.8V12M10.5 8.3V12M9.4 10.9l1.1 1.1 1.1-1.1"/>',
    cfg: PAGE + '<path d="M5.5 8.5h1.3M8.7 8.5h1.8M5.5 11.3h2.9M10.3 11.3h.2"/><circle cx="7.7" cy="8.5" r=".9"/><circle cx="9.4" cy="11.3" r=".9"/>',
    font: PAGE + '<path d="M6.1 12 8 7.6 9.9 12M6.8 10.5h2.4"/>',
    zip: PAGE + '<path d="M8 2.5v.8M8 4.2v.8M8 5.9v.8"/><rect x="6.9" y="7.8" width="2.2" height="3" rx=".6"/>',
    pdf: PAGE + LABEL + '<path d="M5.6 6.9h4.8M5.6 8.6h3.2"/>',
    doc: PAGE + LABEL + '<path d="M5.6 6.9h4.8M5.6 8.6h4.8"/>',
    sheet: PAGE + LABEL + '<path d="M5.4 5.9h5.2v3.3H5.4zM5.4 7.55h5.2M8 5.9v3.3"/>',
    slide: PAGE + LABEL + '<path d="M6.2 8.8V7.6M8 8.8V6.4M9.8 8.8V7.1"/>',
    image: FRAME + '<circle cx="5.7" cy="6.3" r="1.1"/><path d="M2.5 12.3l3.4-3.1 2.5 2.3 1.9-1.6 3.1 2.6"/>',
    video: FRAME + '<path d="M6.9 6.1v3.8l3.1-1.9z" fill="currentColor" fill-opacity=".35"/>',
    audio: '<path d="M6.4 11.6V4.3l5.4-1.2v7.2"/><circle cx="4.9" cy="11.7" r="1.6"' + TINT + '/><circle cx="10.3" cy="10.4" r="1.6"' + TINT + "/>",
    sh: FRAME + '<path d="M4.6 6.3 6.5 8 4.6 9.7M8.2 10.1h3.2"/>',
    db: '<ellipse cx="8" cy="4.3" rx="4.6" ry="1.8"' + TINT + '/><path d="M3.4 4.3v7.4c0 1 2.1 1.8 4.6 1.8s4.6-.8 4.6-1.8V4.3M3.4 8c0 1 2.1 1.8 4.6 1.8s4.6-.8 4.6-1.8"/>',
    disk: '<rect x="1.9" y="4.2" width="12.2" height="7.6" rx="1.7"' + TINT + '/><path d="M1.9 9h12.2M11.2 10.5h.1"/>',
    git: '<circle cx="4.8" cy="3.9" r="1.4"/><circle cx="4.8" cy="12.1" r="1.4"/><circle cx="11.2" cy="5.9" r="1.4"/><path d="M4.8 5.3v5.4M11.2 7.3c0 2.3-1.5 3.1-3.9 3.4-1 .1-1.9.4-2.3.9"/>',
    folder: '<path d="M1.8 4.2c0-.6.4-1 1-1h3.1l1.4 1.5h5.9c.6 0 1 .4 1 1v6.6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z" fill="currentColor" fill-opacity=".18"/>',
  };
  // 扩展名 → [图形, 颜色]
  var BY = {};
  var put = function (exts, g, c) { exts.split(" ").forEach(function (e) { BY[e] = [g, c]; }); };
  put("txt text log out err nfo me", "text", "dim");
  put("md markdown mdx mdown rst adoc", "md", "blue");
  put("json jsonc json5 jsonl ndjson geojson webmanifest har", "json", "yellow");
  put("js mjs cjs jsx", "code", "yellow");
  put("ts tsx mts cts", "code", "blue");
  put("py pyw pyi pyx ipynb", "code", "blue");
  put("c h cc cpp cxx c++ hpp hh hxx m mm cs fs dart lua", "code", "blue");
  put("css scss sass less styl pcss", "code", "blue");
  put("swift rs html htm xhtml svelte astro", "code", "orange");
  put("java kt kts scala groovy rb erb rake", "code", "red");
  put("vue nim", "code", "green");
  put("php hs lhs ex exs erl hrl clj cljs edn elm ml mli", "code", "purple");
  put("go r jl", "code", "cyan");
  put("sql prisma graphql gql proto", "code", "yellow");
  put("xml xsd xsl plist pl pm vim el zig asm s wat gradle cmake mk tex bib", "code", "dim");
  put("yml yaml toml ini conf cfg cnf env properties lock editorconfig npmrc nvmrc yarnrc prettierrc eslintrc babelrc browserslist gitconfig mod sum service desktop reg", "cfg", "dim");
  put("csv tsv xls xlsx xlsm xlsb ods numbers", "sheet", "green");
  put("doc docx dotx odt pages rtf rtfd wpd", "doc", "blue");
  put("ppt pptx pps ppsx odp key", "slide", "orange");
  put("pdf", "pdf", "red");
  put("png jpg jpeg jpe jfif gif webp bmp ico icns cur heic heif avif tif tiff svg svgz psd ai sketch fig xcf raw cr2 cr3 nef arw dng", "image", "purple");
  put("mp4 m4v mov avi mkv webm flv wmv mpg mpeg 3gp m2ts", "video", "purple");
  put("mp3 wav m4a aac flac ogg oga opus aiff aif caf mid midi wma", "audio", "purple");
  put("zip gz tgz tar bz2 tbz xz txz zst lz lzma 7z rar jar war ear apk xip", "zip", "yellow");
  put("dmg iso img pkg vmdk qcow2 sparseimage", "disk", "dim");
  put("sh zsh bash fish ksh csh tcsh command tool bat cmd ps1 psm1", "sh", "green");
  put("ttf otf woff woff2 eot ttc dfont", "font", "dim");
  put("db sqlite sqlite3 db3 mdb accdb realm", "db", "yellow");
  // 没有扩展名、按名字认的
  var NAMES = {
    dockerfile: ["cfg", "blue"], containerfile: ["cfg", "blue"], makefile: ["cfg", "dim"], gnumakefile: ["cfg", "dim"], justfile: ["cfg", "dim"], procfile: ["cfg", "dim"],
    gemfile: ["cfg", "red"], podfile: ["cfg", "red"], rakefile: ["cfg", "red"], brewfile: ["cfg", "dim"], vagrantfile: ["cfg", "dim"],
    license: ["text", "dim"], licence: ["text", "dim"], copying: ["text", "dim"], notice: ["text", "dim"], authors: ["text", "dim"], changelog: ["md", "blue"], readme: ["md", "blue"],
    ".gitignore": ["git", "orange"], ".gitattributes": ["git", "orange"], ".gitmodules": ["git", "orange"], ".gitkeep": ["git", "orange"], ".git": ["git", "orange"],
  };
  function pick(name, dir) {
    if (dir) return ["folder", "blue"];
    var n = String(name || "").split("/").pop().toLowerCase(), i = n.lastIndexOf("."), ext = i > 0 ? n.slice(i + 1) : "";
    if (NAMES[n]) return NAMES[n];
    if (ext && BY[ext]) return BY[ext];
    if (/^\.env(\..+)?$/.test(n)) return ["cfg", "dim"];
    if (/^(readme|changelog|contributing)\b/.test(n)) return ["md", "blue"];
    if (/^(license|licence|copying)\b/.test(n)) return ["text", "dim"];
    if (n.charAt(0) === ".") return ["cfg", "dim"]; // 点开头的：多半是配置
    return ["file", "dim"];
  }
  var cache = {};
  // 文件：VS Code 默认的 Seti 图标（seti.js 的数据）——JS 黄色的「JS」、TS 蓝色的「TS」、{ }、# 这一套约定俗成的样子；
  //   先按整个文件名（package.json、Dockerfile……），再按扩展名从长到短（x.d.ts 先找 d.ts 再找 ts），都没有用 Seti 默认的文件图标。文件夹还是下面那个
  function setiOf(name) {
    var S = window.TSU_SETI;
    if (!S) return null;
    var n = String(name || "").split("/").pop().toLowerCase(), id = S.n[n];
    if (!id) { var p = n.split("."); for (var i = 1; i < p.length && !id; i++) id = S.e[p.slice(i).join(".")]; }
    return S.i[id] || S.i[S.d] || null;
  }
  // 换掉 Seti 里不好看的两个（同一个 200 格的坐标）：Markdown 用它的标志（圆角框里 M 和向下的箭头）；图片是一张相片（Seti 画的是一叠相册）
  var OVR = {
    md: { c: "#519aba", cl: "#498ba7", svg: '<g fill="none" stroke="currentColor" stroke-width="11" stroke-linejoin="round" stroke-linecap="round"><rect x="31" y="56" width="138" height="88" rx="15"/><path d="M54 123V79l19 23 19-23v44"/><path d="M130 79v34"/></g><path d="M112 106h36l-18 21z" fill="currentColor"/>' },
    img: { c: "#a074c4", cl: "#8d63b0", svg: '<g fill="none" stroke="currentColor" stroke-width="11" stroke-linejoin="round"><rect x="33" y="45" width="134" height="110" rx="16"/></g><circle cx="79" cy="84" r="13" fill="currentColor"/><path d="M45 143l40-40 26 25 17-15 27 30z" fill="currentColor"/>' },
  };
  var OVR_EXT = { md: "md", markdown: "md", mdx: "md", mdown: "md", png: "img", jpg: "img", jpeg: "img", jpe: "img", gif: "img", webp: "img", bmp: "img", ico: "img", heic: "img", heif: "img", avif: "img", tif: "img", tiff: "img", svg: "img" };
  function icon(name, dir) {
    var nm = String(name || "").split("/").pop().toLowerCase(), e0 = nm.lastIndexOf(".") > 0 ? nm.slice(nm.lastIndexOf(".") + 1) : "", ov = !dir && OVR[OVR_EXT[e0]];
    if (ov) { var ok = "ovr|" + OVR_EXT[e0]; return cache[ok] || (cache[ok] = '<i class="st-ico st-fi st-seti" style="--c:' + ov.c + ";--cl:" + ov.cl + '"><svg viewBox="20 20 160 160" aria-hidden="true">' + ov.svg + "</svg></i>"); }
    var x = dir ? null : setiOf(name);
    if (x) { var sk = "seti|" + x[0] + "|" + x[1]; return cache[sk] || (cache[sk] = '<i class="st-ico st-fi st-seti" style="--c:' + x[1] + ";--cl:" + x[2] + '"><svg viewBox="20 20 160 160" aria-hidden="true"><path d="' + window.TSU_SETI.g[x[0]] + '"/></svg></i>'); }
    var k = pick(name, dir), key = k[0] + "|" + k[1];
    return cache[key] || (cache[key] = '<i class="st-ico st-fi st-fc-' + k[1] + '">' + SV(G[k[0]]) + "</i>");
  }
  icon.svg = function (name, dir) { return SV(G[pick(name, dir)[0]]); };
  icon.kind = function (name, dir) { return pick(name, dir)[0]; };
  window.TSU_FICON = icon;

  // 样子：图标一格 14px（「文件」视图里 15px，同文件夹）；颜色按种类
  var css = document.createElement("style");
  css.id = "st-ficons";
  css.textContent =
    ".st-ico.st-fi { display: inline-flex; align-items: center; justify-content: center; font-weight: 400; line-height: 1; }" +
    ".st-ico.st-fi > svg { display: block; width: 14px; height: 14px; }" +
    ".st-ft-ic .st-ico.st-fi > svg { width: 15px; height: 15px; }" +
    ".st-ico.st-fc-dim { color: var(--st-dim); } .st-ico.st-fc-blue { color: var(--st-blue); } .st-ico.st-fc-yellow { color: var(--st-yellow); } .st-ico.st-fc-green { color: var(--st-green); }" +
    ".st-ico.st-fc-orange { color: var(--st-orange); } .st-ico.st-fc-red { color: var(--st-red); } .st-ico.st-fc-purple { color: #a77bd8; } .st-ico.st-fc-cyan { color: #3aa9bd; }" +
    // Seti：颜色是它自己的（深色、浅色各一套）；字形在 200 格里大约占中间 112 格，画 16px 大、外边让出 1px，看着同 VS Code 里一样大
    ".st-ico.st-seti { color: var(--c); } html.light .st-ico.st-seti { color: var(--cl, var(--c)); }" +
    ".st-ico.st-fi.st-seti > svg, .st-ft-ic .st-ico.st-fi.st-seti > svg { width: 16px; height: 16px; margin: -1px; fill: currentColor; overflow: visible; }";
  (document.head || document.documentElement).appendChild(css);
})();
