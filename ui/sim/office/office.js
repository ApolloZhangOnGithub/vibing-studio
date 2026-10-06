// office/office.js —— Office（表格 / 文稿 / 讲演）的入口：Dock 图标、启动台、访达里的「打开方式」、给 agent 的说明。
// App 本身（core.js 与各 App 的 *-io.js、视图脚本、公式引擎 fx.js）和 vendor/ 里的库都在第一次打开时才载入，不拖慢页面。
// 文件就是标准的 .xlsx / .docx / .pptx，放在沙盒里（默认 ~/Documents）；agent 用 openpyxl / python-docx / python-pptx 读写，开着的文稿会跟着更新。
(function () {
  "use strict";
  var D = window.TSU_DESK;
  if (!D || !window.SANDBOX) return;
  var me = document.currentScript && document.currentScript.src;
  var BASE = me ? me.replace(/[^/]*$/, "") : "office/", ROOT = BASE.replace(/(sim\/)?office\/$/, "");

  // Dock 图标：连续圆角的底 + 白色的图形（表格：柱状图；文稿：纸与笔；讲演：讲台）
  var ICONS = {
    numbers: '<svg viewBox="0 0 50 50" width="50" height="50"><rect x="11" y="27" width="7" height="13" rx="2" fill="#fff"/><rect x="21.5" y="17" width="7" height="23" rx="2" fill="#fff"/><rect x="32" y="10" width="7" height="30" rx="2" fill="#fff" fill-opacity=".92"/><rect x="9" y="41.5" width="32" height="2" rx="1" fill="#fff" fill-opacity=".7"/></svg>',
    pages: '<svg viewBox="0 0 50 50" width="50" height="50"><rect x="12" y="9" width="22" height="30" rx="3" fill="#fff"/><path d="M16 16h13M16 20.5h13M16 25h9" stroke="#f59a23" stroke-width="2" stroke-linecap="round"/><path d="M37.8 18.5l3.2 3.2-12.6 12.6-4.6 1.4 1.4-4.6z" fill="#fff" stroke="#e57c0b" stroke-width="1.4" stroke-linejoin="round"/><path d="M35.6 20.7l3.2 3.2" stroke="#e57c0b" stroke-width="1.4"/></svg>',
    keynote: '<svg viewBox="0 0 50 50" width="50" height="50"><rect x="9" y="9" width="32" height="20" rx="2.5" fill="#fff"/><path d="M15 23l6-6 4.5 4.5L30 17l5 6" fill="none" stroke="#1a73e8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M25 29v5" stroke="#fff" stroke-width="2.4"/><path d="M17 42l8-8 8 8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.5 33.5h11" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>',
  };
  var APPS = [
    { id: "numbers", name: "表格", exts: ["xlsx", "xlsm", "xls", "ods", "numbers", "csv", "tsv"], scripts: ["fx.js", "numbers-io.js", "numbers.js"] },
    { id: "pages", name: "文稿", exts: ["docx"], scripts: ["pages-io.js", "pages.js"] },
    { id: "keynote", name: "讲演", exts: ["pptx"], scripts: ["keynote-io.js", "keynote.js"] },
  ];

  // ---- 按需载入脚本（同一个只载一次）；UMD 的库在有 AMD 加载器的页面上会注册成模块而不是全局变量，载入时先把 define 藏起来 ----
  var loaded = {};
  function loadScript(url) {
    if (loaded[url]) return loaded[url];
    loaded[url] = new Promise(function (res, rej) {
      var s = document.createElement("script"), amd = window.define;
      if (amd && amd.amd) window.define = undefined;
      s.src = url;
      s.async = false;
      s.onload = function () { if (amd) window.define = amd; res(); };
      s.onerror = function () { if (amd) window.define = amd; delete loaded[url]; rej(new Error("载入失败：" + url)); };
      document.head.appendChild(s);
    });
    return loaded[url];
  }
  var LIBS = {
    exceljs: ["vendor/exceljs/exceljs.min.js", "ExcelJS"],
    docx: ["vendor/docx/docx.min.js", "docx"],
    pptxgenjs: ["vendor/pptxgenjs/pptxgen.bundle.js", "PptxGenJS"],
    jszip: ["vendor/jszip/jszip.min.js", "JSZip"],
    sheetjs: ["vendor/sheetjs/xlsx.full.min.js", "XLSX"],
  };
  function lib(name) {
    var L = LIBS[name];
    if (!L) return Promise.reject(new Error("没有这个库：" + name));
    if (window[L[1]]) return Promise.resolve(window[L[1]]);
    return loadScript(ROOT + L[0]).then(function () {
      if (!window[L[1]]) throw new Error(name + " 载入了，但没有找到 " + L[1]);
      return window[L[1]];
    });
  }
  var booting = {};
  function boot(id) {
    var a = APPS.find(function (x) { return x.id === id; });
    if (!booting[id]) {
      booting[id] = loadScript(BASE + "core.js").then(function () {
        return Promise.all(a.scripts.map(function (s) { return loadScript(BASE + s); }));
      }).then(function () {
        var impl = window.TSU_OFFICE.apps[id];
        if (!impl) throw new Error(a.name + "没有载入");
        return impl;
      });
      booting[id].catch(function (e) {
        delete booting[id];
        D.alert({ title: "没能打开" + a.name, message: e.message, icon: "caution", buttons: [{ label: "好", role: "default" }] });
      });
    }
    return booting[id];
  }
  // 公共入口：别的 App / agent 用 TSU_OFFICE.open(路径) 打开文稿，TSU_OFFICE.launch("numbers") 打开 App
  window.TSU_OFFICE = {
    BASE: BASE, ROOT: ROOT, APPS: APPS, ICONS: ICONS, apps: {},
    loadScript: loadScript, lib: lib, boot: boot,
    launch: function (id) { return boot(id).then(function (impl) { return impl.launch(); }); },
    restore: function (id, wins) { return boot(id).then(function (impl) { return impl.restore ? impl.restore(wins) : impl.launch(); }); }, // 刷新后建回上次的窗口
    open: function (path, id) {
      var ext = (path.match(/\.([^./]+)$/) || [])[1];
      ext = ext ? ext.toLowerCase() : "";
      var a = id ? APPS.find(function (x) { return x.id === id; }) : APPS.find(function (x) { return x.exts.indexOf(ext) >= 0; });
      if (!a) return Promise.reject(new Error("Office 打不开 ." + ext + " 文件"));
      return boot(a.id).then(function (impl) { return impl.openPath(path); });
    },
  };

  APPS.forEach(function (a) {
    D.addDockApp({ app: a.id, title: a.name, className: "ico-ofc ico-ofc-" + a.id, icon: ICONS[a.id] });
    D.registerApp({ id: a.id, name: a.name, category: "效率", icon: '<span class="ico sq ico-ofc ico-ofc-' + a.id + '">' + ICONS[a.id] + "</span>",
      open: function () { window.TSU_OFFICE.launch(a.id); }, restore: function (wins) { return window.TSU_OFFICE.restore(a.id, wins); } });
    (window.TSU_OPENERS = window.TSU_OPENERS || []).push({ id: a.id, name: a.name, exts: a.exts.slice(), open: function (p) { window.TSU_OFFICE.open(p, a.id); } });
  });

  // ======== 系统命令 numbers / pages / keynote（同 Apple 的 App Intents）：人和 agent 在 Bash 里用，help numbers 看用法；第一次用时才载入 App ========
  // args：位置参数的顺序；stdin：没给时从管道读的参数；路径参数标 path: "read" / "write"：sys.js 先换成绝对路径、按调用者自己的权限查；改文稿前 core.js 再查文稿所在的位置能不能写
  var S = function (d, o) { return Object.assign({ type: "string", description: d }, o || {}); };
  var DOC = S("the document (a file path); default: the one in front, else the last one used", { path: "read" });
  var PDF = !!(window.nadosNative && window.nadosNative.call); // 在 Paimon App 里能直接出 PDF 文件（pdf.js）；浏览器里只有人能从打印对话框存
  var withPdf = function (a) { return PDF ? a.concat(["pdf"]) : a; };
  var FILL = { title: S("title text"), subtitle: S("subtitle text"), body: S("body text — one line per paragraph, or per bullet when the box is a list"), body2: S("second column (layout twoCol)"), notes: S("presenter notes") };
  var ACTION_SPECS = {
    numbers: [
      { name: "open", args: ["path"], summary: "open a spreadsheet so the human sees it", params: { type: "object", properties: { path: S("a .xlsx, .csv, .tsv, .xls or .ods file", { path: "read" }) }, required: ["path"] } },
      { name: "create", args: ["path"], summary: "create a new spreadsheet (saved to path, or left untitled)", params: { type: "object", properties: { path: S("where to save the new .xlsx; omit to keep it untitled", { path: "write" }), template: S("starting template", { enum: ["blank", "table", "budget", "todo", "invoice"], default: "blank" }) } } },
      { name: "sheets", summary: "list the sheets and the range each one uses", params: { type: "object", properties: { path: DOC } } },
      { name: "read", args: ["range"], summary: "read cell values (or formulas) from a range — tab-separated, --json for structure", params: { type: "object", properties: { range: S("A1 or A1:C10; default: the whole used area"), sheet: S("sheet name; default: the current sheet"), formulas: { type: "boolean", description: "return =formulas instead of computed values" }, path: DOC } } },
      { name: "write", args: ["range", "values"], stdin: "values", summary: "write values or formulas into cells (undoable in the app)", params: { type: "object", properties: {
        range: S("the top-left cell (A1) or the range (A1:C3) to fill"),
        values: { type: ["array", "string", "number", "boolean"], table: true, description: "JSON rows like [[\"Item\",\"Cost\"],[\"Rent\",3000],[\"Total\",\"=SUM(B2:B2)\"]], or CSV / TSV text (- or a pipe: cat data.csv | numbers write A1 -); one value fills one cell; text starting with = is a formula" },
        sheet: S("sheet name; default: the current sheet"), path: DOC }, required: ["range", "values"] } },
      { name: "addSheet", args: ["name"], summary: "add a sheet", params: { type: "object", properties: { name: S("sheet name"), path: DOC } } },
      { name: "export", args: ["to"], summary: "export to xlsx, csv or tsv (csv / tsv: the current sheet's values)" + (PDF ? ", or pdf (the current sheet as printed pages)" : ""), params: { type: "object", properties: { to: S("the file to write; its extension picks the format", { path: "write" }), format: S("file format, if not the extension of to", { enum: withPdf(["xlsx", "csv", "tsv"]) }), path: DOC }, required: ["to"] } },
    ],
    pages: [
      { name: "open", args: ["path"], summary: "open a .docx document so the human sees it", params: { type: "object", properties: { path: S("a .docx file", { path: "read" }) }, required: ["path"] } },
      { name: "create", args: ["path"], summary: "create a new document (saved to path, or left untitled)", params: { type: "object", properties: { path: S("where to save the new .docx; omit to keep it untitled", { path: "write" }), template: S("starting template", { enum: ["blank", "report", "note", "letter", "essay"], default: "blank" }) } } },
      { name: "text", summary: "get the outline (headings) and the plain text", params: { type: "object", properties: { path: DOC } } },
      { name: "insert", args: ["markdown"], stdin: "markdown", summary: "insert Markdown (headings, lists, tables, **bold** …) — as an argument or piped in", params: { type: "object", properties: { markdown: S("the content, as Markdown"), at: S("\"end\" (default), \"start\", or a heading's exact text to add at the end of that section"), path: DOC }, required: ["markdown"] } },
      { name: "replace", args: ["find", "replace"], summary: "find and replace text", params: { type: "object", properties: { find: S("text to find (within one run of formatting)"), replace: S("replacement text"), all: { type: "boolean", description: "replace every occurrence (default: the first)" }, path: DOC }, required: ["find", "replace"] } },
      { name: "export", args: ["to"], summary: "export to docx, md, txt or html" + (PDF ? ", or pdf (paginated like the app shows it)" : ""), params: { type: "object", properties: { to: S("the file to write; its extension picks the format", { path: "write" }), format: S("file format, if not the extension of to", { enum: withPdf(["docx", "md", "txt", "html"]) }), path: DOC }, required: ["to"] } },
    ],
    keynote: [
      { name: "open", args: ["path"], summary: "open a .pptx presentation so the human sees it", params: { type: "object", properties: { path: S("a .pptx file", { path: "read" }) }, required: ["path"] } },
      { name: "create", args: ["path"], summary: "create a new presentation (saved to path, or left untitled)", params: { type: "object", properties: { path: S("where to save the new .pptx; omit to keep it untitled", { path: "write" }), template: S("theme", { enum: ["white", "black", "gradient", "warm", "mint", "midnight"], default: "white" }) } } },
      { name: "slides", summary: "list the slides with their text", params: { type: "object", properties: { path: DOC } } },
      { name: "addSlide", summary: "add a slide with a layout and its text", params: { type: "object", properties: Object.assign({ layout: S("slide layout", { enum: ["title", "titleBody", "titleOnly", "section", "twoCol", "quote", "blank"], default: "titleBody" }), at: { type: "integer", description: "position (1 = first); default: after the last slide" } }, FILL, { path: DOC }) } },
      { name: "updateSlide", args: ["index"], summary: "change a slide's title, body or notes", params: { type: "object", properties: Object.assign({ index: { type: "integer", description: "slide number (1 = first)" } }, FILL, { path: DOC }), required: ["index"] } },
      { name: "export", args: ["to"], summary: "export to pptx" + (PDF ? " or pdf (one slide per page)" : ""), params: { type: "object", properties: { to: S(PDF ? "the .pptx or .pdf file to write" : "the .pptx file to write", { path: "write" }), format: S("file format", { enum: withPdf(["pptx"]) }), path: DOC }, required: ["to"] } },
    ],
  };
  var TITLES = { numbers: "Numbers", pages: "Pages", keynote: "Keynote" };
  var SUMMARY = { numbers: "表格 (spreadsheets): open or create, read and write cells, sheets, export — the human sees it happen",
    pages: "文稿 (documents): open or create, read the text, insert Markdown, find & replace, export — the human sees it happen",
    keynote: "讲演 (presentations): open or create, list, add and change slides, export — the human sees it happen" };
  var EXAMPLES = {
    numbers: "Examples:\n  numbers create ~/Documents/budget.xlsx\n  numbers write A1 '[[\"Item\",\"Cost\"],[\"Rent\",3000],[\"Food\",1500],[\"Total\",\"=SUM(B2:B3)\"]]'\n  cat data.csv | numbers write A1 -\n  numbers read A1:B4\n  numbers export ~/Documents/budget.csv",
    pages: "Examples:\n  pages create ~/Documents/report.docx --template report\n  pages insert '# Summary\n\n- one\n- two'\n  cat notes.md | pages insert --at end\n  pages replace 2025 2026 --all\n  pages text",
    keynote: "Examples:\n  keynote create ~/Documents/talk.pptx --template midnight\n  keynote add-slide --layout title --title 'Q3 review' --subtitle 'September'\n  keynote add-slide --title 'Three things' --body $'Faster\nCheaper\nSimpler'\n  keynote update-slide 2 --notes 'Say hi'\n  keynote slides",
  };
  if (window.TSU_SYS && TSU_SYS.registerApp) Object.keys(ACTION_SPECS).forEach(function (id) {
    var a = APPS.find(function (x) { return x.id === id; });
    TSU_SYS.registerApp(id, { name: a.name, title: TITLES[id], summary: SUMMARY[id], help: EXAMPLES[id], actions: ACTION_SPECS[id].map(function (spec) {
      return Object.assign({}, spec, { run: function (args, ctx) { return boot(id).then(function (impl) { return impl.action(spec.name, args, ctx); }); } });
    }) });
  });

  // 给 agent 的说明：写进它的提示词
  if (window.TSU_AGENTS && window.TSU_AGENTS.describeApp) window.TSU_AGENTS.describeApp({
    id: "office", name: "Office (表格 spreadsheets / 文稿 documents / 讲演 presentations)", path: "/home/user/Documents",
    about: "documents are standard .xlsx / .docx / .pptx files (表格 also opens .csv/.tsv/.xls/.ods; 文稿 also imports .md/.txt/.html). " +
      "Create or edit them with openpyxl / python-docx / python-pptx (pip install --user openpyxl python-docx python-pptx if missing) or any other tool; " +
      "save new files under this folder so the human finds them. Formulas in .xlsx are recalculated when opened, so writing formulas without cached values is fine. " +
      "If a file is open in the app when you change it, the app offers the human to reload it (it never silently overwrites your edit).",
  });
})();
