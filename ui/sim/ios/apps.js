// ios/apps.js —— 手机上（html.ios）的各个 App：照 iPhone 上 Apple 自己的 App（iOS 26）排。
// 桌面版的 App 一行不改，这里只在 iOS 模式下给它们换一身：
// · 访达 →「文件」：自己的一套界面（最近项目 / 共享 / 浏览，导航栈、左边缘右滑返回、长按菜单、选择、搜索、快速查看、共享），文件操作走 SANDBOX / TSU_FINDER / TSU_TRANSFER
// · Safari、编辑器、传输、备忘录、提醒事项、日历、表格 / 文稿 / 讲演、系统设置 → 各自的 iPhone 版式（见各段）
// 去掉 html 上的 ios（回到桌面），这里画的都藏起来，挪过位置的元素放回原处
(function () {
  "use strict";
  var D = window.TSU_DESK, FS = window.SANDBOX;
  if (!D) return;
  var root = document.documentElement;
  var ios = function () { return root.classList.contains("ios"); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var two = function (n) { return String(n).padStart(2, "0"); };
  var store = {
    get: function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 满了就算了 */ } },
  };
  var IO = window.TSU_IOS_APPS = { ios: ios, esc: esc };

  // ======== SF Symbols 风格的图标（24 × 24，颜色跟文字走）========
  var sv = function (body, vb) { return '<svg viewBox="' + (vb || "0 0 24 24") + '" aria-hidden="true">' + body + "</svg>"; };
  var ln = function (d, w) { return '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="' + (w || 1.8) + '" stroke-linecap="round" stroke-linejoin="round"/>'; };
  var SYM = IO.SYM = {
    back: sv(ln("M14.6 4.6 7.2 12l7.4 7.4", 2.4)),
    chev: sv(ln("m9.5 5.5 6.5 6.5-6.5 6.5", 2.1)),
    down: sv(ln("m5.5 9.5 6.5 6.5 6.5-6.5", 2.1)),
    up: sv(ln("m5.5 14.5 6.5-6.5 6.5 6.5", 2.1)),
    more: sv('<circle cx="5.6" cy="12" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/><circle cx="18.4" cy="12" r="1.9" fill="currentColor"/>'),
    search: sv('<circle cx="10.4" cy="10.4" r="6.4" fill="none" stroke="currentColor" stroke-width="2.2"/>' + ln("m15.2 15.2 5 5", 2.4)),
    clear: sv('<circle cx="12" cy="12" r="9" fill="currentColor"/><path d="m8.8 8.8 6.4 6.4m0-6.4-6.4 6.4" stroke="var(--io-clearx, #fff)" style="stroke:var(--io-clearx,#fff)" stroke-width="1.9" stroke-linecap="round"/>'),
    check: sv(ln("m5 12.6 4.6 4.6L19.2 7", 2.4)),
    xmark: sv(ln("M6.5 6.5l11 11m0-11-11 11", 2.3)),
    plus: sv(ln("M12 4.8v14.4M4.8 12h14.4", 2.3)),
    clock: sv('<circle cx="12" cy="12" r="9.6" fill="currentColor"/><path d="M12 6.6V12l3.6 2.2" fill="none" stroke="var(--io-cut,#fff)" style="stroke:var(--io-cut,#fff)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
    people: sv('<circle cx="9" cy="8" r="3.6" fill="currentColor"/><path d="M2.4 19.2c0-3.6 3-6 6.6-6s6.6 2.4 6.6 6c0 .6-.4.9-1 .9H3.4c-.6 0-1-.3-1-.9z" fill="currentColor"/><circle cx="16.6" cy="8.6" r="3" fill="currentColor" opacity=".72"/><path d="M16.8 13.4c2.9.1 5 2.1 5 5 0 .6-.4.9-1 .9h-3.6c.1-2.2-.3-4.4-2-5.9.5-.1 1-.1 1.6 0z" fill="currentColor" opacity=".72"/>'),
    folderFill: sv('<path d="M2.2 6.4c0-1.3 1-2.2 2.2-2.2h4.6c.7 0 1.3.3 1.7.8l1.2 1.4h7.7c1.3 0 2.2 1 2.2 2.2v9.2c0 1.3-1 2.2-2.2 2.2H4.4c-1.3 0-2.2-1-2.2-2.2z" fill="currentColor"/>'),
    folder: sv(ln("M3 7c0-1.2.9-2 2-2h4.2c.6 0 1.1.3 1.5.7l1.2 1.4H19c1.1 0 2 .9 2 2V17c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2z M3 9.6h18")),
    newFolder: sv(ln("M3 7c0-1.2.9-2 2-2h4.2c.6 0 1.1.3 1.5.7l1.2 1.4H19c1.1 0 2 .9 2 2V17c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2z M12 10.6v5.6M9.2 13.4h5.6")),
    selectCircle: sv('<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.8"/>' + ln("m8.2 12.3 2.6 2.6 5-5.2", 1.9)),
    grid: sv('<g fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.6" y="3.6" width="7" height="7" rx="1.8"/><rect x="13.4" y="3.6" width="7" height="7" rx="1.8"/><rect x="3.6" y="13.4" width="7" height="7" rx="1.8"/><rect x="13.4" y="13.4" width="7" height="7" rx="1.8"/></g>'),
    list: sv('<g fill="currentColor"><circle cx="4.6" cy="6.4" r="1.4"/><circle cx="4.6" cy="12" r="1.4"/><circle cx="4.6" cy="17.6" r="1.4"/></g>' + ln("M9 6.4h11.4M9 12h11.4M9 17.6h11.4")),
    share: sv(ln("M12 14.6V3.4M8.2 7 12 3.2 15.8 7") + ln("M8.4 9.6H7c-1.1 0-2 .9-2 2v7.6c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-7.6c0-1.1-.9-2-2-2h-1.4")),
    dup: sv('<rect x="8.2" y="8.2" width="12" height="12" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/>' + ln("M15.8 5.4c-.2-1-1-1.8-2.1-1.8H6.2c-1.4 0-2.6 1.2-2.6 2.6v7.5c0 1.1.8 1.9 1.8 2.1M14.2 11.4v5.6M11.4 14.2H17")),
    move: sv(ln("M3 7c0-1.2.9-2 2-2h4.2c.6 0 1.1.3 1.5.7l1.2 1.4H19c1.1 0 2 .9 2 2V17c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2z M9 13.4h6.4M13 11l2.4 2.4-2.4 2.4")),
    trash: sv(ln("M4.4 6.4h15.2M9.2 6.2V4.6c0-.7.5-1.2 1.2-1.2h3.2c.7 0 1.2.5 1.2 1.2v1.6M6.2 6.6l.9 12.4c.1 1 .9 1.7 1.8 1.7h6.2c1 0 1.8-.7 1.8-1.7l.9-12.4M10 10.2v6.6M14 10.2v6.6")),
    pencil: sv(ln("M15.6 4.6 19.4 8.4 9 18.8l-4.6.8.8-4.6z M13.6 6.6l3.8 3.8")),
    eye: sv(ln("M2.6 12c2-4 5.4-6.4 9.4-6.4s7.4 2.4 9.4 6.4c-2 4-5.4 6.4-9.4 6.4S4.6 16 2.6 12z") + '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/>'),
    zip: sv(ln("M3.6 7.4h16.8v11c0 1.1-.9 2-2 2H5.6c-1.1 0-2-.9-2-2z M2.8 4.2c0-.4.3-.8.8-.8h16.8c.4 0 .8.3.8.8v3.2H2.8z M9.6 11.4h4.8")),
    info: sv('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="7.8" r="1.3" fill="currentColor"/>' + ln("M10.4 11h1.8v6.2M10.2 17.2h3.8", 1.8)),
    tag: sv(ln("M3.4 4.6v6.2c0 .6.2 1.1.6 1.5l7.8 7.8c.8.8 2 .8 2.8 0l5-5c.8-.8.8-2 0-2.8L11.8 4.5c-.4-.4-.9-.6-1.5-.6H4.1c-.4 0-.7.3-.7.7z") + '<circle cx="7.6" cy="8" r="1.4" fill="currentColor"/>'),
    restore: sv(ln("M9 5.4 4.4 10 9 14.6M4.8 10h9.4c3.2 0 5.8 2.6 5.8 5.8v.2")),
    copy: sv('<rect x="8.4" y="8.4" width="11.6" height="11.6" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/>' + ln("M15.6 5.4c-.2-1-1-1.8-2.1-1.8H6.2c-1.4 0-2.6 1.2-2.6 2.6v7.3c0 1.1.8 1.9 1.8 2.1")),
    download: sv('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/>' + ln("M12 7.2v9.2M8.2 12.8 12 16.6l3.8-3.8")),
    open: sv(ln("M13 4.4h6.6V11M19.4 4.6l-8.2 8.2M17.6 14v4c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V8.4c0-1.1.9-2 2-2h4")),
    house: sv('<path d="M3.2 11.4 12 4l8.8 7.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.6 10.2V19c0 .6.4 1 1 1h3.6v-5.2h3.6V20h3.6c.6 0 1-.4 1-1v-8.8L12 5z" fill="currentColor"/>'),
    drive: sv('<rect x="2.8" y="6.8" width="18.4" height="10.4" rx="2.6" fill="currentColor"/><circle cx="17" cy="12" r="1.2" fill="var(--io-cut,#fff)" style="fill:var(--io-cut,#fff)"/>'),
    tray: sv('<path d="M5.8 4.4h12.4l2.6 8v5.4c0 1-.8 1.8-1.8 1.8H5c-1 0-1.8-.8-1.8-1.8v-5.4z" fill="currentColor"/><path d="M3.8 12.4h4.6l1.3 2.2h4.6l1.3-2.2h4.6" fill="none" stroke="var(--io-cut,#fff)" style="stroke:var(--io-cut,#fff)" stroke-width="1.5" stroke-linejoin="round"/>'),
    upload: sv('<path d="M6.4 2.8h7.4l4.8 4.8V19c0 1.2-1 2.2-2.2 2.2H6.4c-1.2 0-2.2-1-2.2-2.2V5c0-1.2 1-2.2 2.2-2.2z" fill="currentColor"/><path d="M11.4 17.4v-6.6M8.6 13.4l2.8-2.8 2.8 2.8" fill="none" stroke="var(--io-cut,#fff)" style="stroke:var(--io-cut,#fff)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'),
    apps: sv('<g fill="currentColor"><rect x="3" y="3" width="7.8" height="7.8" rx="2.2"/><rect x="13.2" y="3" width="7.8" height="7.8" rx="2.2"/><rect x="3" y="13.2" width="7.8" height="7.8" rx="2.2"/><rect x="13.2" y="13.2" width="7.8" height="7.8" rx="2.2"/></g>'),
    trashFill: sv('<path d="M4.2 6.2h15.6M9.2 6V4.4c0-.6.5-1.1 1.1-1.1h3.4c.6 0 1.1.5 1.1 1.1V6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M5.8 7.6h12.4l-.9 11.6c-.1 1-.9 1.8-1.9 1.8H8.6c-1 0-1.8-.8-1.9-1.8z" fill="currentColor"/>'),
    person: sv('<circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4.2 19.6c0-4 3.4-6.4 7.8-6.4s7.8 2.4 7.8 6.4c0 .7-.5 1.1-1.1 1.1H5.3c-.6 0-1.1-.4-1.1-1.1z" fill="currentColor"/>'),
    agents: sv('<path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z" fill="currentColor"/><path d="m4.6 7.8 7.4 4.3 7.4-4.3M12 12.1v8.6" fill="none" stroke="var(--io-cut,#fff)" style="stroke:var(--io-cut,#fff)" stroke-width="1.4"/>'),
    sortUp: sv(ln("M12 19V5.6M6.8 10.8 12 5.6l5.2 5.2", 2)),
    sortDown: sv(ln("M12 5v13.4M6.8 13.2 12 18.4l5.2-5.2", 2)),
    safari: sv('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m15.8 8.2-2.4 5.2-5.2 2.4 2.4-5.2z" fill="currentColor"/>'),
    tabs: sv('<rect x="3.4" y="6.4" width="12.4" height="14" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/>' + ln("M8.2 3.6h9.6c1.5 0 2.6 1.2 2.6 2.6v10")),
    book: sv(ln("M12 6.4c-1.8-1.4-4.6-2-8-1.8v13.2c3.4-.2 6.2.4 8 1.8 1.8-1.4 4.6-2 8-1.8V4.6c-3.4-.2-6.2.4-8 1.8zM12 6.4v13.2")),
    reload: sv(ln("M19.2 12a7.2 7.2 0 1 1-2.3-5.3M17.4 3.6v3.8h-3.8", 2)),
    reader: sv(ln("M4.6 5.6h14.8M4.6 10h14.8M4.6 14.4h14.8M4.6 18.8h8.6", 1.9)),
    fwd: sv(ln("M9.4 4.6 16.8 12l-7.4 7.4", 2.4)),
    gear: sv('<path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z" fill="none" stroke="currentColor" stroke-width="1.8"/>' + ln("M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M5.4 18.6l1.8-1.8M16.8 7.2l1.8-1.8")),
    sidebar: sv('<rect x="2.8" y="4.4" width="18.4" height="15.2" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/>' + ln("M9.2 4.8v14.4M5.2 8.2h1.8M5.2 11h1.8M5.2 13.8h1.8")),
    play: sv('<path d="M7.4 4.6v14.8c0 .8.9 1.3 1.6.9l11.6-7.4c.6-.4.6-1.3 0-1.7L9 3.8c-.7-.4-1.6.1-1.6.8z" fill="currentColor"/>'),
    undo: sv(ln("M8.6 5 4.2 9.4l4.4 4.4M4.6 9.4h9.8a5.4 5.4 0 0 1 0 10.8H11", 2)),
    redo: sv(ln("M15.4 5l4.4 4.4-4.4 4.4M19.4 9.4H9.6a5.4 5.4 0 0 0 0 10.8H13", 2)),
    brush: sv(ln("M14.8 4.2l5 5-7.6 7.6-5-5z M7.2 11.8c-1.8 0-3.2 1.4-3.2 3.2 0 1.6-.4 3-1.2 4.2 3 .6 6.8.2 8.2-2.4")),
    compose: sv(ln("M11.2 4.4H6.4c-1.1 0-2 .9-2 2v11.2c0 1.1.9 2 2 2h11.2c1.1 0 2-.9 2-2v-4.8M17.8 3.4l2.8 2.8-8.2 8.2-3.6.8.8-3.6z")),
    calendar: sv('<rect x="3.4" y="4.6" width="17.2" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/>' + ln("M3.6 9.4h16.8M8 2.8v3.6M16 2.8v3.6")),
    inbox: sv(ln("M5.8 4.6h12.4l2.6 8v5.4c0 1-.8 1.8-1.8 1.8H5c-1 0-1.8-.8-1.8-1.8v-5.4z M3.6 12.6h4.6l1.3 2.2h5l1.3-2.2h4.6")),
    table: sv('<rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/>' + ln("M3.8 9.4h16.4M3.8 14.4h16.4M9.4 4.8v14.4M14.8 4.8v14.4", 1.5)),
    checklist: sv('<circle cx="6" cy="7" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="6" cy="16.6" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/>' + ln("M11.4 7h9M11.4 16.6h9", 1.9)),
    camera: sv('<path d="M3.2 8.6c0-1.1.9-2 2-2h2.6l1.6-2h5.2l1.6 2h2.6c1.1 0 2 .9 2 2V18c0 1.1-.9 2-2 2H5.2c-1.1 0-2-.9-2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/>'),
    format: '<svg viewBox="0 0 28 24" aria-hidden="true"><text x="1" y="18.6" font-family="-apple-system,Helvetica,sans-serif" font-size="16" font-weight="500" fill="currentColor">Aa</text></svg>',
    keyboardDown: sv('<rect x="2.6" y="3.4" width="18.8" height="12" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.7"/>' + ln("M6.4 7.4h.1M10 7.4h.1M13.6 7.4h.1M17.2 7.4h.1M6.4 11.2h11.2M9.4 18.2 12 20.8l2.6-2.6", 1.7)),
    terminal: sv('<rect x="2.8" y="4" width="18.4" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/>' + ln("m6.8 9 3 3-3 3M11.6 15.4h5")),
    run: sv('<path d="M7 4.8v14.4c0 .8.9 1.3 1.6.8l11.2-7.2c.6-.4.6-1.3 0-1.7L8.6 4c-.7-.4-1.6 0-1.6.8z" fill="currentColor"/>'),
    save: sv(ln("M5 3.8h11.4l3.6 3.6V18c0 1.2-1 2.2-2.2 2.2H6.2C5 20.2 4 19.2 4 18V5c0-.7.5-1.2 1-1.2z M8 3.8v5h7.2v-5M7.6 20v-6h8.8v6")),
    filetree: sv(ln("M4.6 4.4h5M7 4.4v14.2h4.4M7 11.4h4.4M13.4 9.4h7v4h-7zM13.4 16.6h7v4h-7z")),
    sun: sv('<circle cx="12" cy="12" r="4.2" fill="currentColor"/>' + ln("M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6", 2)),
    flower: sv('<g fill="currentColor"><circle cx="12" cy="6.6" r="3.3"/><circle cx="12" cy="17.4" r="3.3"/><circle cx="6.6" cy="12" r="3.3"/><circle cx="17.4" cy="12" r="3.3"/></g><circle cx="12" cy="12" r="2.4" fill="var(--io-cut,#fff)" style="fill:rgba(255,255,255,.55)"/>'),
    moon: sv('<path d="M14.8 3.2a8.8 8.8 0 1 0 6 13.8A7.4 7.4 0 0 1 14.8 3.2z" fill="currentColor"/>'),
    gearFill: sv('<path d="M10.6 2.6h2.8l.5 2.4c.6.2 1.2.5 1.7.9l2.3-.8 1.4 2.4-1.8 1.6c.1.6.1 1.3 0 1.9l1.8 1.6-1.4 2.4-2.3-.8c-.5.4-1.1.7-1.7.9l-.5 2.4h-2.8l-.5-2.4c-.6-.2-1.2-.5-1.7-.9l-2.3.8-1.4-2.4 1.8-1.6c-.1-.6-.1-1.3 0-1.9L4.7 7.9l1.4-2.4 2.3.8c.5-.4 1.1-.7 1.7-.9z" fill="currentColor" transform="translate(0 2.2)"/><circle cx="12" cy="12.2" r="2.8" fill="var(--io-cut,#fff)" style="fill:rgba(0,0,0,.28)"/>'),
    hdd: sv('<rect x="2.8" y="6.8" width="18.4" height="10.4" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="12" r="1.2" fill="currentColor"/>'),
    bell: sv('<path d="M12 3.2c-3.4 0-5.8 2.6-5.8 6v3.6L4.6 15.6c-.3.6.1 1.2.8 1.2h13.2c.7 0 1.1-.6.8-1.2l-1.6-2.8V9.2c0-3.4-2.4-6-5.8-6z" fill="currentColor"/><path d="M9.6 18.4a2.4 2.4 0 0 0 4.8 0z" fill="currentColor"/>'),
    doc: sv(ln("M6.4 2.8h7.4l4.8 4.8V19c0 1.2-1 2.2-2.2 2.2H6.4c-1.2 0-2.2-1-2.2-2.2V5c0-1.2 1-2.2 2.2-2.2z M13.6 3v4.8h4.8")),
    textsize: '<svg viewBox="0 0 28 24" aria-hidden="true"><text x="1" y="19" font-family="-apple-system,Helvetica,sans-serif" font-size="11" font-weight="600" fill="currentColor">A</text><text x="10" y="19" font-family="-apple-system,Helvetica,sans-serif" font-size="18" font-weight="600" fill="currentColor">A</text></svg>',
  };

  // ======== 小组件：导航栈、页面（大标题）、玻璃按钮、菜单、长按菜单、操作表、提醒、表单 ========
  var fb = function (name, act, cls, title) { return '<button class="io-gb' + (cls ? " " + cls : "") + '" data-act="' + act + '"' + (title ? ' aria-label="' + esc(title) + '"' : "") + ">" + (SYM[name] || name) + "</button>"; };
  IO.gbtn = fb;
  // 长按：按住 480ms 不动；触发后吃掉紧跟着的 click
  var eatClick = 0;
  document.addEventListener("click", function (e) { if (eatClick && Date.now() - eatClick < 700) { e.preventDefault(); e.stopPropagation(); } eatClick = 0; }, true);
  function longPress(host, sel, fn) {
    var t = 0, x0 = 0, y0 = 0, tgt = null;
    host.addEventListener("pointerdown", function (e) {
      if (e.button > 0) return;
      tgt = e.target.closest(sel);
      if (!tgt || !host.contains(tgt)) return;
      x0 = e.clientX; y0 = e.clientY;
      clearTimeout(t);
      var el = tgt;
      el.classList.add("io-pressing");
      t = setTimeout(function () { el.classList.remove("io-pressing"); if (tgt === el) { eatClick = Date.now(); tgt = null; if (navigator.vibrate) try { navigator.vibrate(8); } catch (x) {} fn(el, e); } }, 480);
    });
    var cancel = function () { clearTimeout(t); if (tgt) tgt.classList.remove("io-pressing"); tgt = null; };
    host.addEventListener("pointermove", function (e) { if (tgt && Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 10) cancel(); });
    host.addEventListener("pointerup", cancel);
    host.addEventListener("pointercancel", cancel);
    host.addEventListener("contextmenu", function (e) { if (e.target.closest(sel)) { e.preventDefault(); e.stopPropagation(); } }); // 外壳把长按也当右键再发一次：这里已经处理了
  }
  IO.longPress = longPress;

  // 页面：顶上一排导航按钮（左：返回；中：小标题，滚过大标题才出现；右：按钮），下面可滚动（大标题在滚动内容里）
  function Page(o) {
    o = o || {};
    var el = document.createElement("section");
    el.className = "io-page" + (o.cls ? " " + o.cls : "") + (o.large === false ? " io-nolarge" : "");
    el.innerHTML = '<div class="io-scroll"><h1 class="io-lt"></h1><div class="io-pc"></div></div><div class="io-edge"></div>' +
      '<header class="io-nav"><div class="io-nav-l"></div><div class="io-nav-t"></div><div class="io-nav-r"></div></header>';
    var pg = { el: el, scroll: el.querySelector(".io-scroll"), body: el.querySelector(".io-pc"), navL: el.querySelector(".io-nav-l"), navR: el.querySelector(".io-nav-r"),
      navT: el.querySelector(".io-nav-t"), lt: el.querySelector(".io-lt"), stack: null };
    pg.setTitle = function (t) { pg.title = t; pg.lt.textContent = t; pg.navT.textContent = t; };
    pg.setTitle(o.title || "");
    var onScroll = function () {
      var y = pg.scroll.scrollTop, big = o.large !== false;
      el.classList.toggle("io-scrolled", big ? y > pg.lt.offsetTop + pg.lt.offsetHeight - 50 : y > 2);
      el.classList.toggle("io-edgeon", y > 2);
    };
    pg.scroll.addEventListener("scroll", onScroll, { passive: true });
    pg.syncScroll = onScroll;
    pg.navL.addEventListener("click", function (e) { if (e.target.closest('[data-act="back"]') && pg.stack) pg.stack.pop(); });
    return pg;
  }
  IO.Page = Page;

  // 导航栈：push 从右边滑进、pop 滑回去；左边缘往右拖 = 返回（跟手，松手看拖了多远 / 多快）
  function Stack(host) {
    var S = { el: document.createElement("div"), pages: [] };
    S.el.className = "io-stack";
    host.appendChild(S.el);
    pinScroll(S.el);
    var grip = document.createElement("i");
    grip.className = "io-edgegrip";
    S.el.appendChild(grip);
    var syncGrip = function () { S.el.classList.toggle("io-canback", S.pages.length > 1); };
    S.top = function () { return S.pages[S.pages.length - 1]; };
    var backBtn = function (pg) { if (!pg.navL.querySelector('[data-act="back"]')) pg.navL.insertAdjacentHTML("afterbegin", fb("back", "back", "", "返回")); };
    var DUR = 380, EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
    function slide(a, b, dir, done) { // a 离开、b 进来；dir：push | pop
      var w = S.el.offsetWidth || 390;
      var fromB = dir === "push" ? w : -w * 0.3, toA = dir === "push" ? -w * 0.3 : w;
      b.el.hidden = false;
      b.el.classList.add("io-moving");
      a.el.classList.add("io-moving");
      (dir === "push" ? b : a).el.classList.add("io-front");
      var an1 = b.el.animate([{ transform: "translateX(" + fromB + "px)" }, { transform: "translateX(0)" }], { duration: DUR, easing: EASE });
      a.el.animate([{ transform: "translateX(0)" }, { transform: "translateX(" + toA + "px)" }], { duration: DUR, easing: EASE, fill: "forwards" });
      an1.onfinish = function () {
        a.el.classList.remove("io-moving", "io-front");
        b.el.classList.remove("io-moving", "io-front");
        a.el.getAnimations().forEach(function (x) { x.cancel(); });
        if (done) done();
      };
    }
    S.push = function (pg, anim) {
      var prev = S.top();
      pg.stack = S;
      S.pages.push(pg);
      if (S.pages.length > 1) backBtn(pg);
      S.el.insertBefore(pg.el, grip);
      syncGrip();
      if (pg.render) pg.render();
      if (pg.syncScroll) pg.syncScroll();
      if (!prev) return pg;
      if (anim === false || !S.el.offsetWidth) prev.el.hidden = true;
      else slide(prev, pg, "push", function () { if (S.top() !== prev) prev.el.hidden = true; });
      if (S.onChange) S.onChange();
      return pg;
    };
    S.pop = function (anim) {
      if (S.pages.length < 2) return;
      var pg = S.pages.pop(), prev = S.top();
      prev.el.hidden = false;
      if (prev.render) prev.render();
      var gone = function () { pg.el.remove(); if (pg.onClose) pg.onClose(); };
      if (anim === false || !S.el.offsetWidth) gone(); else slide(pg, prev, "pop", gone);
      syncGrip();
      if (S.onChange) S.onChange();
    };
    S.popTo = function (n) { while (S.pages.length > n + 1) { var pg = S.pages.pop(); pg.el.remove(); if (pg.onClose) pg.onClose(); } var t = S.top(); if (t) { t.el.hidden = false; if (t.render) t.render(); } syncGrip(); if (S.onChange) S.onChange(); };
    // 左边缘右滑返回
    var drag = null;
    S.el.addEventListener("pointerdown", function (e) {
      if (S.pages.length < 2 || e.button > 0 || S.locked) return;
      var r = S.el.getBoundingClientRect();
      if (e.clientX - r.left > 26) return;
      drag = { x0: e.clientX, y0: e.clientY, t0: e.timeStamp, on: false, w: r.width, id: e.pointerId, lastX: e.clientX, lastT: e.timeStamp, v: 0 };
    });
    S.el.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.on) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
        if (dx < 10) return;
        drag.on = true;
        try { S.el.setPointerCapture(e.pointerId); } catch (x) {}
        var a = S.top(), b = S.pages[S.pages.length - 2];
        drag.a = a; drag.b = b;
        b.el.hidden = false;
        a.el.classList.add("io-moving", "io-front");
        b.el.classList.add("io-moving");
      }
      var x = Math.max(0, dx);
      drag.v = (e.clientX - drag.lastX) / Math.max(1, e.timeStamp - drag.lastT);
      drag.lastX = e.clientX; drag.lastT = e.timeStamp;
      drag.a.el.style.transform = "translateX(" + x + "px)";
      drag.b.el.style.transform = "translateX(" + (-drag.w * 0.3 + x * 0.3) + "px)";
    });
    var end = function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag;
      drag = null;
      if (!d.on) return;
      eatClick = Date.now();
      var dx = Math.max(0, e.clientX - d.x0), go = e.type === "pointerup" && (dx > d.w * 0.35 || d.v > 0.45);
      var ax = go ? d.w : 0, bx = go ? 0 : -d.w * 0.3, ms = 260;
      d.a.el.style.transition = d.b.el.style.transition = "transform " + ms + "ms cubic-bezier(0.25, 0.8, 0.3, 1)";
      d.a.el.style.transform = "translateX(" + ax + "px)";
      d.b.el.style.transform = "translateX(" + bx + "px)";
      setTimeout(function () {
        [d.a, d.b].forEach(function (p) { p.el.style.transition = ""; p.el.style.transform = ""; p.el.classList.remove("io-moving", "io-front"); });
        if (go) S.pop(false); else d.b.el.hidden = true;
      }, ms + 20);
    };
    S.el.addEventListener("pointerup", end);
    S.el.addEventListener("pointercancel", end);
    return S;
  }
  IO.Stack = Stack;

  // ---- 弹出的菜单（⋯ 按钮、长按）：items = [{ label, icon, run, danger, checked, disabled, sub }] / { sep: true } / { title }；
  var menuOpen = null;
  function closeMenu(now) {
    var m = menuOpen;
    if (!m) return;
    menuOpen = null;
    if (m.onClose) m.onClose();
    if (now) { m.ov.remove(); return; }
    m.ov.classList.add("io-out");
    setTimeout(function () { m.ov.remove(); }, 200);
  }
  IO.closeMenu = closeMenu;
  function menuBox(items, done) {
    var box = document.createElement("div");
    box.className = "io-menu";
    var html = "";
    items.forEach(function (it, i) {
      if (!it) return;
      if (it.sep) { html += '<div class="io-msep"></div>'; return; }
      if (it.title) { html += '<div class="io-mtitle">' + esc(it.title) + "</div>"; return; }
      if (it.row) { // 一排横着的大按钮（iOS 菜单顶上的那种）
        html += '<div class="io-mrow">' + it.row.map(function (r, k) { return '<button data-i="' + i + "." + k + '"' + (r.disabled ? " disabled" : "") + ">" + (SYM[r.icon] || r.icon || "") + "<span>" + esc(r.label) + "</span></button>"; }).join("") + "</div>";
        return;
      }
      // 图标在前（iOS 26），勾 / 方向在后
      var tr = it.checked ? SYM.check : it.trail ? SYM[it.trail] || it.trail : "";
      html += '<button class="io-mi' + (it.danger ? " io-danger" : "") + '" data-i="' + i + '"' + (it.disabled ? " disabled" : "") + ">" +
        '<i class="io-mic">' + (it.icon ? SYM[it.icon] || it.icon : "") + "</i><span>" + esc(it.label) + (it.sub ? "<small>" + esc(it.sub) + "</small>" : "") + "</span>" +
        (tr ? '<i class="io-mtr">' + tr + "</i>" : "") + "</button>";
    });
    box.innerHTML = html;
    if (!items.some(function (it) { return it && it.icon; })) box.classList.add("io-noic");
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-i]");
      if (!b || b.disabled) return;
      var ix = b.dataset.i.split("."), it = items[+ix[0]];
      if (ix.length > 1) it = it.row[+ix[1]];
      done();
      if (it && it.run) setTimeout(function () { it.run(); }, 10);
    });
    return box;
  }
  // 从按钮里长出来的菜单（贴着按钮，右半边的按钮右对齐）
  IO.menu = function (anchor, items, o) {
    o = o || {};
    closeMenu(true);
    var ov = document.createElement("div");
    ov.className = "io-menu-ov";
    var box = menuBox(items, function () { closeMenu(); });
    ov.appendChild(box);
    document.body.appendChild(ov);
    var r = anchor.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight, w = box.offsetWidth, h = box.offsetHeight;
    var right = r.left + r.width / 2 > vw / 2, x = right ? Math.min(vw - 10, r.right) - w : Math.max(10, r.left), y = r.bottom + 8;
    if (o.above || y + h > vh - 20) y = Math.max(54, r.top - 8 - h);
    x = Math.max(10, Math.min(vw - 10 - w, x));
    box.style.left = x + "px";
    box.style.top = y + "px";
    box.style.transformOrigin = (right ? "right " : "left ") + (y > r.top ? "top" : "bottom");
    ov.addEventListener("pointerdown", function (e) { if (!box.contains(e.target)) { e.preventDefault(); closeMenu(); } });
    menuOpen = { ov: ov, onClose: o.onClose };
    return box;
  };
  // 长按：原来那一项浮起来（背后模糊、变暗），菜单贴在它下面（放不下就上面）
  // o: { cls（浮起来那一块的类）, wrap（套一层容器的类，好让原来的样式还管用）, preview（自己给的预览元素）, size: [宽, 高]（自己给的预览多大，以原来那一项为中心）}
  IO.contextMenu = function (itemEl, items, o) {
    o = o || {};
    closeMenu(true);
    var r0 = itemEl.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight, r = { left: r0.left, top: r0.top, width: r0.width, height: r0.height };
    if (o.size) { r = { width: o.size[0], height: o.size[1], left: r0.left + r0.width / 2 - o.size[0] / 2, top: r0.top + (o.anchorY != null ? o.anchorY : r0.height / 2) - o.size[1] / 2 }; }
    r.left = Math.max(12, Math.min(vw - 12 - r.width, r.left));
    r.top = Math.max(60, r.top);
    r.right = r.left + r.width; r.bottom = r.top + r.height;
    var ov = document.createElement("div");
    ov.className = "io-menu-ov io-ctx";
    var pv = o.preview || itemEl.cloneNode(true);
    pv.classList.remove("io-pressing");
    pv.classList.add("io-ctx-pv");
    var holder = document.createElement("div");
    holder.className = "io-ctx-holder " + (o.cls || "");
    holder.style.cssText = "left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px";
    if (o.wrap) { var wr = document.createElement("div"); wr.className = o.wrap; wr.appendChild(pv); holder.appendChild(wr); } else holder.appendChild(pv);
    ov.appendChild(holder);
    var box = menuBox(items, function () { closeMenu(); });
    ov.appendChild(box);
    document.body.appendChild(ov);
    var w = box.offsetWidth, h = box.offsetHeight, below = r.bottom + 10 + h < vh - 16, y = below ? r.bottom + 10 : r.top - 10 - h;
    if (y < 54) { // 上下都放不下：把那一项往上挪
      var shift = Math.min(r.top - 60, r.bottom + 10 + h - (vh - 16));
      holder.style.top = r.top - shift + "px";
      y = r.bottom - shift + 10;
      below = true;
    }
    var x = r.left + r.width / 2 > vw / 2 ? r.right - w : r.left;
    x = Math.max(12, Math.min(vw - 12 - w, x));
    box.style.left = x + "px";
    box.style.top = y + "px";
    box.style.transformOrigin = (x + w / 2 > r.left + r.width / 2 ? "left " : "right ") + (below ? "top" : "bottom");
    itemEl.classList.add("io-lifted");
    ov.addEventListener("pointerdown", function (e) { if (!box.contains(e.target)) { e.preventDefault(); closeMenu(); } });
    menuOpen = { ov: ov, onClose: function () { itemEl.classList.remove("io-lifted"); if (o.onClose) o.onClose(); } };
    return box;
  };

  // ---- 从底下升起来的面板（sheet）：host 是 App 自己的根元素；返回 { el, body, close }。o: { title, left, right, cls, detent: "large" | "medium" }
  IO.sheet = function (host, o) {
    o = o || {};
    var ov = document.createElement("div");
    ov.className = "io-sheet-ov";
    ov.innerHTML = '<div class="io-sheet io-' + (o.detent || "large") + (o.cls ? " " + o.cls : "") + '"><i class="io-grab"></i>' +
      '<header class="io-snav"><div class="io-nav-l"></div><div class="io-snav-t"></div><div class="io-nav-r"></div></header><div class="io-sbody"></div></div>';
    var sh = ov.firstChild, api = { el: sh, ov: ov, body: sh.querySelector(".io-sbody"), navL: sh.querySelector(".io-nav-l"), navR: sh.querySelector(".io-nav-r"), titleEl: sh.querySelector(".io-snav-t") };
    api.titleEl.textContent = o.title || "";
    api.close = function (v) {
      if (api.closed) return;
      api.closed = true;
      ov.classList.add("io-out");
      setTimeout(function () { ov.remove(); }, 320);
      if (o.onClose) o.onClose(v);
    };
    ov.addEventListener("pointerdown", function (e) { if (e.target === ov) api.close(); });
    // 往下拖把手 / 标题栏：关掉
    var y0 = null;
    sh.querySelector(".io-grab").parentNode.addEventListener("pointerdown", function (e) {
      if (!e.target.closest(".io-grab, .io-snav") || e.target.closest("button")) return;
      y0 = e.clientY;
      sh.setPointerCapture(e.pointerId);
    });
    sh.addEventListener("pointermove", function (e) { if (y0 == null) return; var dy = Math.max(0, e.clientY - y0); sh.style.transform = "translateY(" + dy + "px)"; });
    sh.addEventListener("pointerup", function (e) {
      if (y0 == null) return;
      var dy = e.clientY - y0;
      y0 = null;
      if (dy > 120) api.close(); else { sh.style.transition = "transform .25s"; sh.style.transform = ""; setTimeout(function () { sh.style.transition = ""; }, 260); }
    });
    (host || document.body).appendChild(ov);
    return api;
  };

  // ---- 提醒（iOS 26：大圆角，按钮是胶囊）：o = { title, message, field: { value, placeholder, select }, buttons: [{ label, role: cancel | default | destructive }] } → Promise<{ button, value }>
  IO.alert = function (o) {
    return new Promise(function (resolve) {
      var ov = document.createElement("div");
      ov.className = "io-alert-ov";
      var bs = o.buttons || [{ label: "好", role: "default" }];
      ov.innerHTML = '<div class="io-alert"><b>' + esc(o.title || "") + "</b>" + (o.message ? "<p>" + esc(o.message) + "</p>" : "") +
        (o.field ? '<input class="io-afield" spellcheck="false" autocomplete="off" autocapitalize="off">' : "") +
        '<div class="io-abtns' + (bs.length > 2 ? " io-vert" : "") + '">' + bs.map(function (b, i) { return '<button data-i="' + i + '" class="io-ab-' + (b.role || "plain") + '">' + esc(b.label) + "</button>"; }).join("") + "</div></div>";
      document.body.appendChild(ov);
      var inp = ov.querySelector("input");
      if (inp) {
        inp.value = o.field.value || "";
        inp.placeholder = o.field.placeholder || "";
        setTimeout(function () { inp.focus(); if (o.field.select) inp.setSelectionRange(0, o.field.select === true ? inp.value.length : o.field.select); }, 60);
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); var d = bs.findIndex(function (b) { return b.role === "default"; }); finish(d < 0 ? bs.length - 1 : d); } if (e.key === "Escape") finish(bs.findIndex(function (b) { return b.role === "cancel"; })); });
      }
      function finish(i) {
        if (ov.classList.contains("io-out")) return;
        ov.classList.add("io-out");
        setTimeout(function () { ov.remove(); }, 200);
        var b = bs[i] || {};
        resolve({ button: b.label || null, value: inp ? inp.value : undefined });
      }
      ov.addEventListener("click", function (e) { var b = e.target.closest("[data-i]"); if (b) finish(+b.dataset.i); });
    });
  };
  // ---- 操作表：底下一组按钮 + 单独的「取消」（destructive 是红色）→ Promise<选中的 label | null>
  IO.actionSheet = function (o) {
    return new Promise(function (resolve) {
      var ov = document.createElement("div");
      ov.className = "io-as-ov";
      ov.innerHTML = '<div class="io-as"><div class="io-as-grp">' + (o.title || o.message ? '<div class="io-as-head">' + (o.title ? "<b>" + esc(o.title) + "</b>" : "") + (o.message ? "<p>" + esc(o.message) + "</p>" : "") + "</div>" : "") +
        o.buttons.map(function (b, i) { return '<button data-i="' + i + '" class="' + (b.role === "destructive" ? "io-danger" : "") + '">' + esc(b.label) + "</button>"; }).join("") +
        '</div><button class="io-as-cancel" data-i="-1">取消</button></div>';
      document.body.appendChild(ov);
      var done = function (v) { ov.classList.add("io-out"); setTimeout(function () { ov.remove(); }, 260); resolve(v); };
      ov.addEventListener("click", function (e) {
        var b = e.target.closest("[data-i]");
        if (b) return done(+b.dataset.i < 0 ? null : o.buttons[+b.dataset.i].label);
        if (e.target === ov) done(null);
      });
    });
  };

  // ---- 分组的表格（设置、简介）：rows = [{ label, value, icon: { bg, sym }, chev, sw: 开关, onTap, cls }] ----
  IO.group = function (rows, o) {
    o = o || {};
    return (o.header ? '<h3 class="io-gh">' + esc(o.header) + "</h3>" : "") + '<div class="io-grp' + (o.cls ? " " + o.cls : "") + '">' + rows.map(function (r, i) {
      return '<div class="io-row' + (r.onTap || r.chev ? " io-tap" : "") + (r.cls ? " " + r.cls : "") + '" data-r="' + (r.key || i) + '">' +
        (r.icon ? '<i class="io-ricon" style="background:' + r.icon.bg + '">' + (SYM[r.icon.sym] || r.icon.sym || "") + "</i>" : "") +
        '<span class="io-rl">' + esc(r.label) + (r.sub ? "<small>" + esc(r.sub) + "</small>" : "") + "</span>" +
        (r.value != null ? '<span class="io-rv">' + esc(r.value) + "</span>" : "") + (r.html || "") +
        (r.sw != null ? '<span class="io-sw' + (r.sw ? " on" : "") + '" role="switch"><i></i></span>' : "") + (r.chev ? '<i class="io-rchev">' + SYM.chev + "</i>" : "") + (r.checked ? '<i class="io-rck">' + SYM.check + "</i>" : "") + "</div>";
    }).join("") + "</div>" + (o.footer ? '<p class="io-gf">' + esc(o.footer) + "</p>" : "");
  };

  // ======== 挂到窗口上：iOS 模式下窗口第一次出现时，按 App 调各自的 attach；退出 iOS 模式时调 detach ========
  var attachers = []; // { test(winEl), attach(winEl), detach?(winEl) }
  IO.register = function (a) { attachers.push(a); schedule(); };
  var scheduled = false, wasIOS = false;
  function schedule() { if (scheduled) return; scheduled = true; requestAnimationFrame(function () { scheduled = false; scan(); }); }
  function scan() {
    var on = ios();
    if (on !== wasIOS) { wasIOS = on; if (!on) closeMenu(true); }
    Array.prototype.forEach.call(document.querySelectorAll(".win"), function (w) {
      attachers.forEach(function (a) {
        if (!a.test(w)) return;
        var key = "ioAttached";
        // 自己画导航栏的 App：外壳加在窗口顶上的那条（.ios-nav）不要（.ios-nonav）
        if (on && !w.classList.contains("closed") && !w[key + a.name]) { w[key + a.name] = true; if (a.nonav) w.classList.add("ios-nonav"); try { a.attach(w); } catch (e) { console.error("iOS 版式（" + a.name + "）出错：", e); } }
        if (on && w[key + a.name] && a.sync) { try { a.sync(w); } catch (e) { console.error(e); } }
        if (!on && w[key + a.name] && a.detach) { w[key + a.name] = false; if (a.nonav) w.classList.remove("ios-nonav"); try { a.detach(w); } catch (e) { console.error(e); } }
      });
    });
  }
  new MutationObserver(schedule).observe(root, { attributes: true, attributeFilter: ["class"] });
  function watchWins() {
    var layer = document.getElementById("wins") || document.getElementById("desktop") || document.body;
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) { var m = ms[i]; if (m.type === "childList" || (m.target.classList && m.target.classList.contains("win"))) { schedule(); return; } }
    }).observe(layer, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { watchWins(); schedule(); }); else { watchWins(); schedule(); }

  // =====================================================================================================
  // 文件（访达的 iPhone 版）
  // =====================================================================================================
  (function files() {
    if (!FS) return;
    var HOME = FS.HOME, TRASH = HOME + "/.Trash", UPLOADS = HOME + "/上传", APPS = "/Applications", SHARED = "/shared";
    var parentOf = function (p) { return p.slice(0, p.lastIndexOf("/")) || "/"; };
    var baseOf = function (p) { return p === "/" ? "/" : p.slice(p.lastIndexOf("/") + 1); };
    var extOf = function (n) { var b = baseOf(n), i = b.lastIndexOf("."); return i > 0 ? b.slice(i + 1).toLowerCase() : ""; };
    var join = function (dir, name) { return (dir === "/" ? "" : dir) + "/" + name; };
    var under = function (p, dir) { return p === dir || p.indexOf(dir === "/" ? "/" : dir + "/") === 0; };
    var st = function (p) { return FS.stat(p) || {}; };
    var hidden = function (p) { return baseOf(p).charAt(0) === "."; };
    var ROOTS = { "/": 1, "/home": 1, "/tmp": 1, "/shared": 1, "/agents": 1, "/.paimon": 1 };
    ROOTS[HOME] = ROOTS[APPS] = ROOTS[UPLOADS] = ROOTS[TRASH] = 1;
    var KINDS = { md: "Markdown 文稿", markdown: "Markdown 文稿", txt: "纯文本文稿", js: "JavaScript 脚本", mjs: "JavaScript 脚本", ts: "TypeScript 脚本", py: "Python 脚本",
      json: "JSON 文稿", html: "HTML 文稿", htm: "HTML 文稿", css: "CSS 样式表", sh: "Shell 脚本", csv: "CSV 文稿", yml: "YAML 文稿", yaml: "YAML 文稿", xml: "XML 文稿",
      c: "C 源代码", h: "C 头文件", cpp: "C++ 源代码", go: "Go 源代码", rs: "Rust 源代码", java: "Java 源代码", rb: "Ruby 脚本", log: "日志文件", toml: "TOML 文稿",
      ini: "配置设置", svg: "SVG 图像", png: "PNG 图像", jpg: "JPEG 图像", jpeg: "JPEG 图像", gif: "GIF 图像", webp: "WebP 图像", bmp: "BMP 图像", ico: "Windows 图标",
      avif: "AVIF 图像", zip: "ZIP 归档", gz: "GZip 压缩归档", tgz: "GZip 压缩归档", tar: "tar 归档", pdf: "PDF 文稿", mp3: "MP3 音频", wav: "WAV 音频", mp4: "MPEG-4 影片",
      mov: "QuickTime 影片", docx: "Microsoft Word 文稿", xlsx: "Microsoft Excel 工作簿", pptx: "Microsoft PowerPoint 演示文稿", pages: "Pages 文稿", numbers: "Numbers 表格",
      key: "Keynote 讲演", ics: "iCalendar 文件", rtf: "RTF 文稿" };
    var IMG = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif" };
    var CODE = { js: 1, mjs: 1, ts: 1, py: 1, sh: 1, json: 1, html: 1, htm: 1, css: 1, c: 1, h: 1, cpp: 1, go: 1, rs: 1, java: 1, rb: 1, yml: 1, yaml: 1, xml: 1, toml: 1, ini: 1 };
    var DOCS = { md: 1, markdown: 1, txt: 1, csv: 1, log: 1, rtf: 1, "": 1 };
    var EXT_COLOR = { md: "#6e6e73", js: "#c9a400", ts: "#2f74c0", py: "#3572a5", json: "#8a6d3b", html: "#e44d26", css: "#264de4", sh: "#2e8b57", zip: "#7a6a58",
      docx: "#2b579a", xlsx: "#217346", pptx: "#d24726", ics: "#e0443e", pages: "#f09a37", numbers: "#30b050", key: "#3a8bf0" };
    var isBin = function (p) { var s = st(p); return !!(s.bin || s.binary); };
    var textish = function (p) { var e = extOf(p); return !isBin(p) && !!(DOCS[e] || CODE[e] || (KINDS[e] && !IMG[e] && !/^(zip|gz|tgz|tar|pdf|mp3|wav|mp4|mov|docx|xlsx|pptx|pages|numbers|key)$/.test(e)) || /^(\.|readme|license|makefile|dockerfile)/i.test(baseOf(p))); };
    function appInfo(p) {
      if (!/\.app$/.test(p) || !FS.isDir(p) || !FS.exists(p + "/Info.json")) return null;
      try { var j = JSON.parse(FS.read(p + "/Info.json")); return j && j.id ? j : null; } catch (e) { return null; }
    }
    var isApp = function (p) { return !!appInfo(p); };
    var isFolder = function (p) { return FS.isDir(p) && !isApp(p); };
    var fixed = function (p) { return !!ROOTS[p] || (isApp(p) && parentOf(p) === APPS) || /\.app\//.test(p); };
    var inTrash = function (p) { return p !== TRASH && under(p, TRASH); };
    var PLACE = {};
    PLACE[HOME] = "个人"; PLACE["/"] = "根目录"; PLACE[TRASH] = "最近删除"; PLACE[SHARED] = "共享"; PLACE["/tmp"] = "临时"; PLACE[UPLOADS] = "上传"; PLACE[APPS] = "应用程序";
    var nameOf = function (p) { if (PLACE[p]) return PLACE[p]; var b = baseOf(p); return isApp(p) ? b.slice(0, -4) : b; };
    var bytesOf = function (s) { return !s || s.dir ? 0 : s.size != null ? s.size : new TextEncoder().encode(s.data || "").length; };
    function sizeText(n) { if (n < 1000) return n + " 字节"; if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + " KB"; if (n < 1e9) return (n / 1e6).toFixed(1) + " MB"; return (n / 1e9).toFixed(2) + " GB"; }
    function kindOf(p) { if (isApp(p)) return "应用程序"; if (FS.isDir(p)) return "文件夹"; var e = extOf(p); return KINDS[e] || (e ? e.toUpperCase() + " 文稿" : "文稿"); }
    function kids(dir) { try { return FS.list(dir).filter(function (p) { return !hidden(p); }); } catch (e) { return []; } }
    var countOf = function (p) { return kids(p).length; };
    function dateText(t, long) {
      if (!t) return "";
      var d = new Date(t), now = new Date(), day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), hm = two(d.getHours()) + ":" + two(d.getMinutes());
      if (t >= day0) return "今天 " + hm;
      if (t >= day0 - 864e5) return "昨天 " + hm;
      return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate() + (long ? " " + hm : "");
    }
    var metaLine = function (p) { return FS.isDir(p) && !isApp(p) ? countOf(p) + " 项" : sizeText(isApp(p) ? 0 : bytesOf(st(p))); };
    // 本 App 的设置：显示方式、排序；最近打开过的（也读访达记的）
    var PREF = Object.assign({ view: "icons", sort: "name", dir: 1 }, store.get("tsu-ios-files", {}));
    var savePref = function () { store.set("tsu-ios-files", PREF); };
    var myRecent = store.get("tsu-ios-files-recent", {});
    function touch(p) { myRecent[p] = Date.now(); var ks = Object.keys(myRecent); if (ks.length > 200) ks.sort(function (a, b) { return myRecent[a] - myRecent[b]; }).slice(0, ks.length - 200).forEach(function (k) { delete myRecent[k]; }); store.set("tsu-ios-files-recent", myRecent); }
    function finderMeta() { var m = store.get("tsu-finder-meta", {}); return m && typeof m === "object" ? m : {}; }
    function recents() {
      var m = finderMeta().open || {}, all = {};
      Object.keys(m).forEach(function (p) { all[p] = m[p]; });
      Object.keys(myRecent).forEach(function (p) { all[p] = Math.max(all[p] || 0, myRecent[p]); });
      return Object.keys(all).filter(function (p) { return FS.exists(p) && !FS.isDir(p) && !inTrash(p) && !p.split("/").some(function (s) { return s.charAt(0) === "."; }); })
        .sort(function (a, b) { return all[b] - all[a]; }).slice(0, 60);
    }
    var TAGS = [["red", "红色", "#ff3b30"], ["orange", "橙色", "#ff9500"], ["yellow", "黄色", "#ffcc00"], ["green", "绿色", "#34c759"], ["blue", "蓝色", "#007aff"], ["purple", "紫色", "#af52de"], ["gray", "灰色", "#8e8e93"]];
    function tagged(k) { var t = finderMeta().tags || {}; return Object.keys(t).filter(function (p) { return (t[p] || []).indexOf(k) >= 0 && FS.exists(p) && !inTrash(p); }).sort(); }
    function sortList(list) {
      var k = PREF.sort, dir = PREF.dir;
      var val = function (p) { var s = st(p); return k === "date" ? s.mtime || 0 : k === "size" ? (FS.isDir(p) ? -1 : bytesOf(s)) : k === "kind" ? kindOf(p) : nameOf(p).toLowerCase(); };
      return list.slice().sort(function (a, b) {
        var x = val(a), y = val(b), c = typeof x === "number" ? x - y : String(x).localeCompare(String(y), "zh", { numeric: true });
        if (!c) c = nameOf(a).localeCompare(nameOf(b), "zh", { numeric: true });
        return c * (k === "date" || k === "size" ? -dir : dir);
      });
    }

    // ---- 图标：文件夹（iOS 的蓝色文件夹）、文稿（一页纸，上面是真的开头几行）、图片（缩略图）、App（它的图标）----
    function folderIco(p) {
      var badge = p === HOME ? SYM.house : p === SHARED ? SYM.people : p === UPLOADS ? SYM.upload : p === "/tmp" ? SYM.tray : p === APPS ? SYM.apps : p === "/agents" ? SYM.agents : "";
      return '<span class="iof-folder"><svg viewBox="0 0 80 64"><path d="M4 12a6 6 0 0 1 6-6h17.4c1.7 0 3.3.7 4.4 2L36 12.4h34a6 6 0 0 1 6 6V20H4z" fill="var(--iof-f1)"/>' +
        '<rect x="4" y="16" width="72" height="44" rx="6" fill="var(--iof-f2)"/></svg>' + (badge ? '<i class="iof-fbadge">' + badge + "</i>" : "") + "</span>";
    }
    var binURLs = {};
    function imageURL(p) {
      var e = extOf(p), s = st(p);
      if (!IMG[e] || s.dir || s.lazy) return null;
      if (s.bin) {
        var c = binURLs[p];
        if (c && c.mtime === s.mtime) return c.url;
        if (c) URL.revokeObjectURL(c.url);
        binURLs[p] = { mtime: s.mtime, url: URL.createObjectURL(new Blob([s.bin], { type: IMG[e] })) };
        return binURLs[p].url;
      }
      var t = String(s.data || "").trim();
      if (/^data:image\//.test(t)) return t;
      if (e === "svg") return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s.data || "");
      if (t.length > 16 && /^[A-Za-z0-9+/=\s]+$/.test(t)) return "data:" + IMG[e] + ";base64," + t.replace(/\s+/g, "");
      return null;
    }
    function appIco(p) {
      var info = appInfo(p), list = D.appList ? D.appList() : [], a = info && list.find(function (x) { return x.id === info.id; });
      return '<span class="iof-app">' + (a && a.icon ? a.icon : '<span class="iof-appraw">' + esc(nameOf(p).slice(0, 1)) + "</span>") + "</span>";
    }
    function docIco(p) {
      var e = extOf(p), tag = e.slice(0, 4).toUpperCase(), s = st(p), txt = "";
      if (textish(p) && !s.lazy) txt = String(s.data || "").slice(0, 900).split("\n").slice(0, 26).join("\n");
      return '<span class="iof-doc">' + (txt ? '<pre class="iof-doctext">' + esc(txt) + "</pre>" : "") + (tag ? '<i class="iof-ext" style="color:' + (EXT_COLOR[e] || "var(--io-fg2)") + '">' + esc(tag) + "</i>" : "") + "</span>";
    }
    function icon(p) {
      if (isApp(p)) return appIco(p);
      if (p === TRASH) return '<span class="iof-trash">' + SYM.trashFill + "</span>";
      if (FS.isDir(p)) return folderIco(p);
      var u = imageURL(p);
      if (u) return '<span class="iof-img"><img src="' + esc(u) + '" alt="" draggable="false" loading="lazy"></span>';
      return docIco(p);
    }

    // ---- 打开：文件夹进去；App 启动；zip 解压到旁边；登记过的 App（表格 / 文稿 / 讲演、日历）；代码 / 文本 → 编辑器；别的快速查看 ----
    function registered(p) { var e = extOf(p); return (window.TSU_OPENERS || []).filter(function (o) { return o && o.exts && o.exts.indexOf(e) >= 0 && typeof o.open === "function"; }); }
    function openersOf(p) {
      if (!p || FS.isDir(p)) return [];
      var out = registered(p).map(function (o) { return { id: o.id, name: o.name, run: function () { o.open(p); } }; }), e = extOf(p);
      var has = function (id) { return out.some(function (o) { return o.id === id; }); };
      if (window.TSU_IDE && !has("ide") && !isBin(p) && (!IMG[e] || e === "svg")) out.push({ id: "ide", name: appName("ide", "编辑器"), run: function () { TSU_IDE.open(p); } });
      if (window.TSU_SAFARI && !has("safari") && (/^html?$/.test(e) || IMG[e])) out.push({ id: "safari", name: appName("safari", "Safari浏览器"), run: function () { TSU_SAFARI.open(blobURL(p)); } });
      return out;
    }
    function appName(id, d) { var a = (D.appList ? D.appList() : []).find(function (x) { return x.id === id; }); return (a && a.name) || d; }
    function appIconHTML(id) { var a = (D.appList ? D.appList() : []).find(function (x) { return x.id === id; }); return a && a.icon ? a.icon : ""; }
    function blobURL(p) {
      var u = imageURL(p);
      if (u) return u;
      return URL.createObjectURL(new Blob([FS.read(p)], { type: (/^html?$/.test(extOf(p)) ? "text/html" : "text/plain") + ";charset=utf-8" }));
    }
    function whenLoaded(p, fn) {
      var s = st(p);
      if (!s.lazy || !FS.ensureLoaded) return fn();
      FS.ensureLoaded([p]).then(function () { fn(); }, function (e) { IO.alert({ title: "打不开“" + nameOf(p) + "”", message: e && e.message || "取不到文件内容" }); });
    }
    function openItem(F, p) {
      if (!FS.exists(p)) return;
      if (isFolder(p)) return F.pushFolder(p);
      var info = appInfo(p);
      if (info) return D.launch(info.id);
      if (inTrash(p)) return F.quickLook(p);
      touch(p);
      var e = extOf(p);
      if (e === "zip" && window.TSU_TRANSFER && TSU_TRANSFER.extract) {
        return TSU_TRANSFER.extract(p, baseOf(p), { dir: parentOf(p) }).then(function (r) { if (r && r.dest) F.flash(r.dest); }, function (err) { IO.alert({ title: "无法解压“" + baseOf(p) + "”", message: err.message }); });
      }
      var reg = registered(p);
      if (reg.length) return reg[0].open(p);
      if (textish(p) && !/^html?$/.test(e) && window.TSU_IDE) return whenLoaded(p, function () { TSU_IDE.open(p); });
      F.quickLook(p);
    }

    // ---- 一个「文件」App（挂在一个访达窗口里）----
    var all = [];
    function Files(winEl) {
      var F = { win: winEl, tab: store.get("tsu-ios-files-tab", "browse"), stacks: {}, selecting: null };
      var el = F.el = document.createElement("div");
      el.className = "io-app iof";
      el.innerHTML = '<div class="iof-host"></div>' +
        '<nav class="io-tabbar iof-tabs">' + [["recents", "最近项目", "clock"], ["shared", "共享", "people"], ["browse", "浏览", "folderFill"]].map(function (t) {
          return '<button data-tab="' + t[0] + '">' + SYM[t[2]] + "<span>" + t[1] + "</span></button>"; }).join("") + "</nav>" +
        '<nav class="io-toolbar iof-seltb" hidden>' + fb("share", "share", "io-plain", "共享") + fb("dup", "dup", "io-plain", "复制") + fb("move", "move", "io-plain", "移动") + fb("trash", "trash", "io-plain", "删除") + "</nav>";
      winEl.querySelector(".body").appendChild(el);
      var host = el.querySelector(".iof-host");
      F.stacks.recents = Stack(host);
      F.stacks.shared = Stack(host);
      F.stacks.browse = Stack(host);
      F.stacks.recents.push(listPage(F, { kind: "recents", title: "最近项目" }), false);
      F.stacks.shared.push(listPage(F, { kind: "folder", path: SHARED, title: "共享" }), false);
      F.stacks.browse.push(browsePage(F), false);
      Object.keys(F.stacks).forEach(function (k) { F.stacks[k].onChange = function () { if (F.selecting) F.select(false); saveState(); }; });
      F.setTab = function (t) {
        if (!F.stacks[t]) t = "browse";
        if (F.selecting) F.select(false);
        F.tab = t;
        F.shown = true;
        store.set("tsu-ios-files-tab", t);
        Object.keys(F.stacks).forEach(function (k) { F.stacks[k].el.hidden = k !== t; });
        el.querySelectorAll(".iof-tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === t); });
        var top = F.stacks[t].top();
        if (top && top.render) top.render();
      };
      el.querySelector(".iof-tabs").addEventListener("click", function (e) {
        var b = e.target.closest("[data-tab]");
        if (!b) return;
        if (F.tab === b.dataset.tab && F.stacks[F.tab].pages.length > 1) return F.stacks[F.tab].popTo(0); // 再点一下当前的标签：回到最上层（同 iOS）
        F.setTab(b.dataset.tab);
      });
      F.page = function () { return F.stacks[F.tab].top(); };
      F.pushFolder = function (p) { F.stacks[F.tab].push(listPage(F, { kind: "folder", path: p, title: nameOf(p) })); };
      // 在「浏览」里一路打开到某个文件夹（「在访达中显示」、刷新后复原）
      F.openPath = function (dir, anim) {
        var S = F.stacks.browse, chain = [], base = under(dir, HOME) ? HOME : dir === TRASH || under(dir, TRASH) ? TRASH : "/";
        for (var q = dir; ; q = parentOf(q)) { chain.unshift(q); if (q === base || q === "/") break; }
        if (base === HOME && chain[0] !== HOME) chain.unshift(HOME);
        S.popTo(0);
        chain.forEach(function (q, i) { if (FS.isDir(q)) S.push(listPage(F, { kind: "folder", path: q, title: nameOf(q) }), anim !== false && i === chain.length - 1); });
        F.setTab("browse");
      };
      F.reveal = function (p) {
        if (!p || !FS.exists(p)) return;
        F.openPath(FS.isDir(p) && !isApp(p) ? p : parentOf(p));
        if (!FS.isDir(p) || isApp(p)) setTimeout(function () { F.flash(p); }, 420);
      };
      F.flash = function (p) {
        var pg = F.page();
        if (pg && pg.render) pg.render();
        var it = pg && pg.el.querySelector('.iof-it[data-p="' + CSS.escape(p) + '"]');
        if (!it) return;
        it.scrollIntoView({ block: "center" });
        it.classList.add("iof-flash");
        setTimeout(function () { it.classList.remove("iof-flash"); }, 1400);
      };
      // 选择
      F.select = function (on) {
        var pg = F.page();
        if (on && pg && pg.canSelect) { F.selecting = { page: pg, set: new Set() }; pg.el.classList.add("io-selecting"); }
        else { if (F.selecting) { F.selecting.page.el.classList.remove("io-selecting"); F.selecting.page.el.querySelectorAll(".iof-it.sel").forEach(function (x) { x.classList.remove("sel"); }); } F.selecting = null; }
        el.classList.toggle("iof-sel", !!F.selecting);
        el.querySelector(".iof-seltb").hidden = !F.selecting;
        el.querySelector(".iof-tabs").hidden = !!F.selecting;
        if (pg && pg.chrome) pg.chrome();
        syncSel();
      };
      F.syncSel = function () { syncSel(); };
      F.toggleSel = function (p) {
        var S = F.selecting;
        if (!S) return;
        if (S.set.has(p)) S.set.delete(p); else S.set.add(p);
        syncSel();
      };
      function syncSel() {
        var S = F.selecting, n = S ? S.set.size : 0;
        if (S) {
          S.page.el.querySelectorAll(".iof-it").forEach(function (x) { x.classList.toggle("sel", S.set.has(x.dataset.p)); });
          S.page.navT.textContent = n ? "已选择 " + n + " 项" : "选择项目";
          var allB = S.page.navL.querySelector('[data-act="all"]');
          if (allB) allB.textContent = n && n === S.page.items().length ? "取消全选" : "全选";
          S.page.el.classList.add("io-scrolled");
        }
        var paths = S ? Array.from(S.set) : [], canMod = paths.length && paths.every(function (p) { return !fixed(p); });
        var tb = el.querySelector(".iof-seltb");
        tb.querySelector('[data-act="share"]').disabled = !paths.length;
        tb.querySelector('[data-act="dup"]').disabled = !canMod || (S && S.page.kind === "trash");
        tb.querySelector('[data-act="move"]').disabled = !canMod;
        tb.querySelector('[data-act="trash"]').disabled = !canMod;
      }
      el.querySelector(".iof-seltb").addEventListener("click", function (e) {
        var b = e.target.closest("[data-act]");
        if (!b || b.disabled || !F.selecting) return;
        var paths = Array.from(F.selecting.set), a = b.dataset.act, pg = F.selecting.page;
        if (a === "share") F.share(paths, b);
        if (a === "dup") { paths.forEach(duplicate); F.select(false); }
        if (a === "move") F.moveSheet(paths, function () { F.select(false); });
        if (a === "trash") { if (pg.kind === "trash") eraseForever(paths, function () { F.select(false); }); else { TSU_FINDER.trash(paths); F.select(false); } }
      });
      F.quickLook = function (p) { quickLook(F, p); };
      F.share = function (paths, anchor) { shareSheet(F, paths, anchor); };
      F.moveSheet = function (paths, done) { moveSheet(F, paths, done); };
      F.rerender = function () {
        Object.keys(F.stacks).forEach(function (k) {
          F.stacks[k].pages.forEach(function (pg, i, arr) {
            if (pg.path && !FS.exists(pg.path)) { F.stacks[k].popTo(Math.max(0, i - 1)); return; }
            if (i === arr.length - 1 && pg.render && !F.stacks[k].el.hidden) pg.render();
            else if (pg.render) pg.stale = true;
          });
        });
      };
      function saveState() { store.set("tsu-ios-files-path", F.stacks.browse.top().path || ""); }
      // 刷新后回到上次的位置
      var last = store.get("tsu-ios-files-path", "");
      if (last && FS.isDir(last)) F.openPath(last, false);
      F.setTab(F.tab);
      all.push(F);
      return F;
    }

    // ---- 「浏览」首页：位置、个人收藏、标签 ----
    function browsePage(F) {
      var pg = Page({ title: "浏览", cls: "iof-browse" });
      pg.navR.innerHTML = fb("more", "more", "", "更多");
      var row = function (p, name, sym, color) {
        return '<div class="io-row io-tap iof-place" data-p="' + esc(p) + '"><i class="iof-pic" style="color:' + color + '">' + SYM[sym] + '</i><span class="io-rl">' + esc(name) + '</span><i class="io-rchev">' + SYM.chev + "</i></div>";
      };
      pg.render = function () {
        var q = pg.q || "";
        if (q) return renderSearch(F, pg, "/", q);
        pg.body.innerHTML = searchField(pg) +
          '<h3 class="io-gh io-ghl">位置</h3><div class="io-grp">' + row(HOME, "个人", "house", "var(--io-blue)") + row(SHARED, "共享", "people", "var(--io-blue)") +
          row("/agents", "Agents", "agents", "var(--io-blue)") + row("/tmp", "临时", "tray", "var(--io-blue)") + row("/", "根目录", "drive", "var(--io-gray)") + row(TRASH, "最近删除", "trashFill", "var(--io-gray)") + "</div>" +
          '<h3 class="io-gh io-ghl">个人收藏</h3><div class="io-grp">' + row(UPLOADS, "上传", "upload", "var(--io-blue)") + row(APPS, "应用程序", "apps", "var(--io-blue)") + "</div>" +
          '<h3 class="io-gh io-ghl">标签</h3><div class="io-grp">' + TAGS.map(function (t) {
            return '<div class="io-row io-tap iof-place" data-tag="' + t[0] + '"><i class="iof-tagdot" style="background:' + t[2] + '"></i><span class="io-rl">' + t[1] + '</span><i class="io-rchev">' + SYM.chev + "</i></div>"; }).join("") + "</div>";
        bindSearch(F, pg);
      };
      pg.body.addEventListener("click", function (e) {
        var r = e.target.closest(".iof-place");
        if (!r) return;
        if (r.dataset.tag) { var t = TAGS.find(function (x) { return x[0] === r.dataset.tag; }); F.stacks.browse.push(listPage(F, { kind: "tag", tag: t[0], title: t[1] })); return; }
        var p = r.dataset.p;
        try { if (p === TRASH && !FS.isDir(TRASH)) FS.mkdirp(TRASH); } catch (x) {}
        if (FS.isDir(p)) F.stacks.browse.push(listPage(F, { kind: p === TRASH ? "trash" : "folder", path: p, title: nameOf(p) }));
      });
      pg.navR.addEventListener("click", function (e) {
        var b = e.target.closest('[data-act="more"]');
        if (b) IO.menu(b, [{ label: "新建文件夹", icon: "newFolder", run: function () { F.openPath(HOME, false); setTimeout(function () { newFolder(F, F.page()); }, 60); } }]);
      });
      return pg;
    }
    function searchField(pg) {
      return '<div class="io-searchrow"><label class="io-search">' + SYM.search + '<input type="search" placeholder="搜索" spellcheck="false" autocomplete="off" enterkeyhint="search">' +
        '<button class="io-sclear" hidden aria-label="清除">' + SYM.clear + '</button></label><button class="io-scancel" hidden>取消</button></div>';
    }
    function bindSearch(F, pg) {
      var inp = pg.body.querySelector(".io-search input");
      if (!inp) return;
      var clr = pg.body.querySelector(".io-sclear"), cancel = pg.body.querySelector(".io-scancel");
      inp.value = pg.q || "";
      clr.hidden = !inp.value;
      cancel.hidden = !pg.searching;
      pg.el.classList.toggle("io-searching", !!pg.searching);
      var t = 0;
      inp.addEventListener("focus", function () { pg.searching = true; cancel.hidden = false; pg.el.classList.add("io-searching"); });
      inp.addEventListener("input", function () {
        clr.hidden = !inp.value;
        clearTimeout(t);
        t = setTimeout(function () { pg.q = inp.value.trim(); var pos = inp.selectionStart; pg.render(); var i2 = pg.body.querySelector(".io-search input"); if (i2) { i2.focus(); try { i2.setSelectionRange(pos, pos); } catch (x) {} } }, 160);
      });
      clr.addEventListener("pointerdown", function (e) { e.preventDefault(); inp.value = ""; pg.q = ""; pg.render(); var i2 = pg.body.querySelector(".io-search input"); if (i2) i2.focus(); });
      cancel.addEventListener("click", function () { pg.q = ""; pg.searching = false; pg.render(); });
    }
    // 搜索：当前位置以下（含子文件夹），按名字
    function renderSearch(F, pg, base, q) {
      var ql = q.toLowerCase(), hits = [];
      try {
        FS.walk(base).some(function (p) {
          if (p === base || hidden(p) || p.slice(base.length).split("/").some(function (s) { return s.charAt(0) === "."; })) return false;
          if (baseOf(p).toLowerCase().indexOf(ql) >= 0) hits.push(p);
          return hits.length >= 200;
        });
      } catch (e) { /* 读不了的跳过 */ }
      pg.shown = hits;
      pg.body.innerHTML = searchField(pg) + (hits.length ? '<div class="iof-list iof-results">' + hits.map(function (p) { return itemHTML(p, true); }).join("") + "</div>" : '<div class="io-empty"><b>无结果</b><span>找不到“' + esc(q) + "”</span></div>");
      bindSearch(F, pg);
    }
    function itemHTML(p, list, loc) {
      var s = st(p);
      return '<div class="iof-it" data-p="' + esc(p) + '"><span class="iof-ic">' + icon(p) + '</span><i class="iof-selmark">' + SYM.check + "</i>" +
        '<span class="iof-tx"><b class="iof-nm">' + esc(nameOf(p)) + "</b>" +
        (list ? '<small>' + (loc ? esc(nameOf(parentOf(p))) + " · " : "") + esc(dateText(s.mtime)) + " - " + esc(metaLine(p)) + "</small>" : '<small>' + esc(dateText(s.mtime)) + "</small><small>" + esc(metaLine(p)) + "</small>") +
        "</span>" + (list && isFolder(p) ? '<i class="io-rchev">' + SYM.chev + "</i>" : "") + "</div>";
    }

    // ---- 文件夹 / 最近项目 / 标签 / 最近删除：同一种页面 ----
    function listPage(F, o) {
      var pg = Page({ title: o.title, cls: "iof-listpage" });
      pg.kind = o.kind === "folder" && o.path === TRASH ? "trash" : o.kind;
      pg.path = o.path || null;
      pg.canSelect = true;
      pg.items = function () { return pg.shown || []; };
      pg.chrome = function () {
        if (F.selecting && F.selecting.page === pg) {
          pg.navL.innerHTML = '<button class="io-gb io-txt" data-act="all">全选</button>';
          pg.navR.innerHTML = '<button class="io-gb io-txt io-bold" data-act="done">完成</button>';
        } else {
          pg.navL.innerHTML = pg.stack && pg.stack.pages.indexOf(pg) > 0 ? fb("back", "back", "", "返回") : "";
          pg.navR.innerHTML = fb("more", "more", "", "更多");
          pg.navT.textContent = pg.title;
          if (pg.syncScroll) pg.syncScroll();
        }
      };
      pg.render = function () {
        pg.stale = false;
        var list;
        if (pg.q) { renderSearch(F, pg, pg.path || (pg.kind === "recents" ? HOME : "/"), pg.q); pg.chrome(); return; }
        if (pg.kind === "recents") list = recents();
        else if (pg.kind === "tag") list = sortList(tagged(o.tag));
        else list = sortList(kids(pg.path));
        pg.shown = list;
        var grid = PREF.view === "icons";
        var head = pg.kind === "trash" && list.length ? '<p class="iof-note">项目在删除前会在这里保留。</p>' : "";
        pg.body.innerHTML = searchField(pg) + head + (list.length
          ? '<div class="' + (grid ? "iof-grid" : "iof-list") + '">' + list.map(function (p) { return itemHTML(p, !grid, pg.kind === "recents" || pg.kind === "tag"); }).join("") + "</div>" +
            '<p class="iof-count">' + list.length + " 个项目</p>"
          : '<div class="io-empty"><b>' + (pg.kind === "recents" ? "无最近项目" : pg.kind === "trash" ? "无项目" : pg.kind === "tag" ? "无项目" : "文件夹是空的") + "</b>" +
            (pg.kind === "recents" ? "<span>最近打开过的文件会显示在这里。</span>" : "") + "</div>");
        bindSearch(F, pg);
        pg.chrome();
        if (F.selecting && F.selecting.page === pg) {
          F.selecting.set.forEach(function (p) { if (list.indexOf(p) < 0) F.selecting.set.delete(p); });
          pg.body.querySelectorAll(".iof-it").forEach(function (x) { x.classList.toggle("sel", F.selecting.set.has(x.dataset.p)); });
        }
      };
      pg.body.addEventListener("click", function (e) {
        var it = e.target.closest(".iof-it");
        if (!it || it.querySelector(".iof-rename")) return;
        if (F.selecting && F.selecting.page === pg) return F.toggleSel(it.dataset.p);
        openItem(F, it.dataset.p);
      });
      longPress(pg.body, ".iof-it", function (it) {
        if (F.selecting) return;
        var p = it.dataset.p, menu = itemMenu(F, pg, p, it);
        if (it.closest(".iof-grid")) { // 图标方式：浮起来的是放大的缩略图（同 iOS）
          var pv = document.createElement("div");
          pv.className = "iof-pv";
          pv.innerHTML = '<span class="iof-ic">' + icon(p) + "</span>";
          var ic = it.querySelector(".iof-ic").getBoundingClientRect(), ir = it.getBoundingClientRect();
          IO.contextMenu(it, menu, { cls: "iof-ctx-grid", preview: pv, size: [196, 176], anchorY: ic.top - ir.top + ic.height / 2 });
        } else IO.contextMenu(it, menu, { cls: "iof-ctx-list", wrap: "iof-list" });
      });
      pg.navL.addEventListener("click", function (e) {
        var b = e.target.closest('[data-act="all"]');
        if (!b || !F.selecting) return;
        var S = F.selecting, items = pg.items();
        if (S.set.size === items.length) S.set.clear(); else items.forEach(function (p) { S.set.add(p); });
        F.syncSel();
      });
      pg.navR.addEventListener("click", function (e) {
        var b = e.target.closest("[data-act]");
        if (!b) return;
        if (b.dataset.act === "done") return F.select(false);
        if (b.dataset.act !== "more") return;
        var canNew = pg.kind === "folder" && pg.path && canWrite(pg.path);
        var sortIt = function (k, label) { return { label: label, trail: PREF.sort === k ? (PREF.dir > 0 ? "up" : "down") : null, run: function () { if (PREF.sort === k) PREF.dir = -PREF.dir; else { PREF.sort = k; PREF.dir = 1; } savePref(); F.rerender(); } }; };
        IO.menu(b, [
          { label: "选择", icon: "selectCircle", disabled: !pg.items().length, run: function () { F.select(true); } },
          canNew ? { label: "新建文件夹", icon: "newFolder", run: function () { newFolder(F, pg); } } : null,
          pg.kind === "trash" ? { label: "全部删除", icon: "trash", danger: true, disabled: !pg.items().length, run: function () { eraseForever(pg.items()); } } : null,
          { sep: true },
          { label: "图标", icon: "grid", checked: PREF.view === "icons", run: function () { PREF.view = "icons"; savePref(); F.rerender(); } },
          { label: "列表", icon: "list", checked: PREF.view === "list", run: function () { PREF.view = "list"; savePref(); F.rerender(); } },
          { sep: true },
          pg.kind === "recents" ? null : sortIt("name", "名称"),
          pg.kind === "recents" ? null : sortIt("kind", "种类"),
          pg.kind === "recents" ? null : sortIt("date", "日期"),
          pg.kind === "recents" ? null : sortIt("size", "大小"),
        ].filter(Boolean));
      });
      return pg;
    }
    function canWrite(dir) { try { return !FS.can || FS.can(dir, "w"); } catch (e) { return true; } }

    // ---- 长按菜单 ----
    function itemMenu(F, pg, p, itEl) {
      var fx = fixed(p), dir = isFolder(p), app = isApp(p);
      if (inTrash(p) && parentOf(p) === TRASH) {
        return [
          { label: "恢复", icon: "restore", run: function () { restore([p]); } },
          { label: "显示简介", icon: "info", run: function () { infoSheet(F, p); } },
          { sep: true },
          { label: "删除", icon: "trash", danger: true, run: function () { eraseForever([p]); } },
        ];
      }
      if (app) return [{ label: "打开", icon: "open", run: function () { openItem(F, p); } }, { label: "显示简介", icon: "info", run: function () { infoSheet(F, p); } }];
      return [
        dir ? null : { label: "快速查看", icon: "eye", run: function () { F.quickLook(p); } },
        dir ? null : { sep: true },
        { label: "重新命名", icon: "pencil", disabled: fx, run: function () { inlineRename(F, pg, p); } },
        { label: "压缩", icon: "zip", disabled: !window.TSU_TRANSFER, run: function () { compress(F, [p]); } },
        { label: "复制", icon: "dup", disabled: fx, run: function () { var q = duplicate(p); if (q) setTimeout(function () { F.flash(q); }, 60); } },
        { sep: true },
        { label: "移动", icon: "move", disabled: fx, run: function () { F.moveSheet([p]); } },
        { label: "共享", icon: "share", run: function () { F.share([p], itEl); } },
        { sep: true },
        { label: "显示简介", icon: "info", run: function () { infoSheet(F, p); } },
        { sep: true },
        { label: "删除", icon: "trash", danger: true, disabled: fx, run: function () { if (window.TSU_FINDER) TSU_FINDER.trash([p]); } },
      ].filter(Boolean);
    }
    function fail(title, e) { IO.alert({ title: title, message: e && e.message ? e.message : String(e || "") }); }
    // 复制：「名称 2」（同 iOS 的文件 App）
    function freeName(dir, name) {
      if (!FS.exists(join(dir, name))) return name;
      var dot = FS.isDir(join(dir, name)) ? -1 : name.lastIndexOf("."), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
      var m = / (\d+)$/.exec(stem), n = m ? +m[1] + 1 : 2;
      if (m) stem = stem.slice(0, -m[0].length);
      while (FS.exists(join(dir, stem + " " + n + ext))) n++;
      return stem + " " + n + ext;
    }
    function duplicate(p) {
      var to = join(parentOf(p), freeName(parentOf(p), baseOf(p)));
      try { FS.copy(p, to); return to; } catch (e) { fail("无法复制“" + nameOf(p) + "”", e); return null; }
    }
    function newFolder(F, pg) {
      if (!pg || !pg.path) return;
      var p = join(pg.path, freeName(pg.path, "未命名文件夹"));
      try { FS.mkdirp(p); } catch (e) { return fail("无法新建文件夹", e); }
      pg.render();
      setTimeout(function () { inlineRename(F, pg, p); }, 30);
    }
    // 就地改名：名字那一行变成输入框（同 iOS）；回车 / 点别处 = 完成
    function inlineRename(F, pg, p) {
      var it = pg.body.querySelector('.iof-it[data-p="' + CSS.escape(p) + '"]');
      if (!it) return;
      var nm = it.querySelector(".iof-nm"), inp = document.createElement("input");
      inp.className = "iof-rename";
      inp.value = baseOf(p);
      inp.spellcheck = false;
      inp.setAttribute("autocapitalize", "off");
      nm.replaceWith(inp);
      it.classList.add("iof-renaming");
      var dot = FS.isDir(p) ? -1 : inp.value.lastIndexOf(".");
      inp.focus();
      inp.setSelectionRange(0, dot > 0 ? dot : inp.value.length);
      var done = false;
      var finish = function (ok) {
        if (done) return;
        done = true;
        var name = inp.value.trim();
        it.classList.remove("iof-renaming");
        if (ok && name && name !== baseOf(p)) {
          if (/\//.test(name)) { pg.render(); return fail("名称里不能有“/”"); }
          var to = join(parentOf(p), name);
          if (FS.exists(to)) { pg.render(); return IO.alert({ title: "名称“" + name + "”已被使用。", message: "请选取其他名称。" }); }
          try { FS.move(p, to); } catch (e) { pg.render(); return fail("无法重新命名", e); }
        }
        pg.render();
      };
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); finish(true); } if (e.key === "Escape") finish(false); });
      inp.addEventListener("blur", function () { finish(true); });
      inp.addEventListener("click", function (e) { e.stopPropagation(); });
    }
    function compress(F, paths) {
      var one = paths.length === 1, dir = parentOf(paths[0]), name = freeName(dir, (one ? baseOf(paths[0]) : "归档") + ".zip");
      TSU_TRANSFER.pack(paths, { name: name }).then(function (r) { return r.blob.arrayBuffer(); }).then(function (buf) {
        FS.writeBinary(join(dir, name), new Uint8Array(buf));
        setTimeout(function () { F.flash(join(dir, name)); }, 60);
      }).catch(function (e) { fail("无法压缩", e); });
    }
    // 最近删除：恢复到原来的位置（访达记着从哪来的）；删除 = 永久抹掉（先问）
    function restore(paths) {
      var from = finderMeta().trash || {};
      paths.forEach(function (p) {
        var rec = from[p], to = rec && rec.from ? rec.from : join(HOME, baseOf(p)), dir = parentOf(to);
        try { if (!FS.isDir(dir)) FS.mkdirp(dir); if (FS.exists(to)) to = join(dir, freeName(dir, baseOf(to))); FS.move(p, to); } catch (e) { fail("无法恢复“" + baseOf(p) + "”", e); }
      });
      if (D.trashChanged) D.trashChanged();
    }
    function eraseForever(paths, done) {
      paths = paths.filter(function (p) { return FS.exists(p) && !fixed(p); });
      if (!paths.length) return;
      IO.actionSheet({ message: paths.length === 1 ? "此项目将被立即删除。你不能撤销此操作。" : "这些项目将被立即删除。你不能撤销此操作。",
        buttons: [{ label: paths.length === 1 ? "删除" : "删除 " + paths.length + " 个项目", role: "destructive" }] }).then(function (b) {
        if (!b) return;
        paths.forEach(function (p) { try { if (FS.exists(p)) FS.remove(p, true); } catch (e) { /* 删不了的留着 */ } });
        if (D.trashChanged) D.trashChanged();
        if (done) done();
      });
    }

    // ---- 快速查看：整屏；左上「完成」，中间文件名，底下共享；文本 / 代码、图片、网页、别的是一张卡片 ----
    function quickLook(F, p) {
      whenLoaded(p, function () {
        var ov = document.createElement("div");
        ov.className = "iof-ql";
        var e = extOf(p), u = imageURL(p), body = "";
        if (u) body = '<div class="iof-ql-img"><img src="' + esc(u) + '" alt=""></div>';
        else if (/^html?$/.test(e) && !isBin(p)) body = '<iframe class="iof-ql-web" sandbox="" referrerpolicy="no-referrer"></iframe>';
        else if (textish(p) && !isBin(p)) { var t = ""; try { t = FS.read(p); } catch (x) {} body = '<pre class="iof-ql-text' + (CODE[e] || e === "" ? " iof-mono" : "") + '">' + esc(t.slice(0, 300000)) + "</pre>"; }
        else body = '<div class="iof-ql-card"><span class="iof-ic">' + icon(p) + "</span><b>" + esc(nameOf(p)) + "</b><small>" + esc(kindOf(p)) + " - " + esc(metaLine(p)) + "</small></div>";
        var opn = openersOf(p)[0];
        ov.innerHTML = '<header class="io-nav"><div class="io-nav-l"><button class="io-gb io-txt io-bold" data-q="done">完成</button></div><div class="io-nav-t iof-ql-t"><b></b><small></small></div><div class="io-nav-r"></div></header>' +
          '<div class="iof-ql-body">' + body + "</div>" +
          '<nav class="io-toolbar iof-ql-tb">' + fb("share", "share", "io-plain", "共享") + '<span class="io-flex"></span>' +
          (opn ? '<button class="io-gb io-txt" data-q="open">用“' + esc(opn.name) + "”打开</button>" : "") + "</nav>";
        ov.querySelector(".iof-ql-t b").textContent = nameOf(p);
        ov.querySelector(".iof-ql-t small").textContent = kindOf(p);
        var fr = ov.querySelector("iframe");
        if (fr) { try { fr.srcdoc = FS.read(p); } catch (x) {} }
        F.el.appendChild(ov);
        var close = function () { ov.classList.add("io-out"); setTimeout(function () { ov.remove(); }, 300); };
        ov.addEventListener("click", function (ev) {
          var b = ev.target.closest("[data-q], [data-act]");
          if (!b) return;
          if (b.dataset.q === "done") close();
          if (b.dataset.q === "open" && opn) { close(); opn.run(); }
          if (b.dataset.act === "share") F.share([p], b);
        });
        // 往下拖关掉
        var y0 = null;
        ov.querySelector(".iof-ql-body").addEventListener("pointerdown", function (ev) { var sc = ev.target.closest("pre, .iof-ql-img"); if (!sc || sc.scrollTop <= 0) y0 = { y: ev.clientY, x: ev.clientX }; });
        ov.addEventListener("pointermove", function (ev) { if (!y0) return; var dy = ev.clientY - y0.y; if (dy > 0 && dy > Math.abs(ev.clientX - y0.x)) ov.querySelector(".iof-ql-body").style.transform = "translateY(" + dy * 0.6 + "px) scale(" + (1 - Math.min(0.12, dy / 2000)) + ")"; });
        var up = function (ev) { if (!y0) return; var dy = ev.clientY - y0.y; y0 = null; if (dy > 140) close(); else ov.querySelector(".iof-ql-body").style.transform = ""; };
        ov.addEventListener("pointerup", up);
        ov.addEventListener("pointercancel", up);
      });
    }

    // ---- 共享：iOS 的共享面板：顶上是文件，一排 App（能打开它的），下面是操作 ----
    function shareSheet(F, paths, anchor) {
      if (!paths.length) return;
      var one = paths.length === 1 ? paths[0] : null, sh = IO.sheet(F.el, { detent: "medium", cls: "io-share" });
      var ops = one ? openersOf(one) : [];
      if (one && isFolder(one) && window.TSU_IDE) ops.push({ id: "ide", name: appName("ide", "编辑器"), run: function () { TSU_IDE.open(one); } });
      var total = paths.reduce(function (n, p) { return n + (FS.isDir(p) ? 0 : bytesOf(st(p))); }, 0);
      sh.navR.innerHTML = fb("xmark", "close", "", "关闭");
      sh.body.innerHTML = '<div class="io-sh-head"><span class="iof-ic">' + icon(paths[0]) + "</span><div><b>" + esc(one ? nameOf(one) : paths.length + " 个项目") + "</b><small>" +
        esc(one ? kindOf(one) + (FS.isDir(one) ? "" : " · " + sizeText(total)) : sizeText(total)) + "</small></div></div>" +
        (ops.length ? '<div class="io-sh-apps">' + ops.map(function (o, i) { return '<button data-app="' + i + '"><span class="io-sh-ico">' + appIconHTML(o.id) + "</span><span>" + esc(o.name) + "</span></button>"; }).join("") + "</div>" : "") +
        '<div class="io-grp io-sh-acts">' +
        '<div class="io-row io-tap" data-s="download"><span class="io-rl">存储到本机</span><i class="io-ra">' + SYM.download + "</i></div>" +
        (window.TSU_TRANSFER && TSU_TRANSFER.add ? '<div class="io-row io-tap" data-s="shelf"><span class="io-rl">添加到“传输”</span><i class="io-ra">' + SYM.tray + "</i></div>" : "") +
        '<div class="io-row io-tap" data-s="copy"><span class="io-rl">拷贝路径</span><i class="io-ra">' + SYM.copy + "</i></div>" +
        (one && textish(one) ? '<div class="io-row io-tap" data-s="text"><span class="io-rl">拷贝文本</span><i class="io-ra">' + SYM.copy + "</i></div>" : "") +
        (window.TSU_TERM ? '<div class="io-row io-tap" data-s="term"><span class="io-rl">在终端中打开</span><i class="io-ra">' + SYM.terminal + "</i></div>" : "") + "</div>";
      sh.navR.addEventListener("click", function (e) { if (e.target.closest('[data-act="close"]')) sh.close(); });
      sh.body.addEventListener("click", function (e) {
        var a = e.target.closest("[data-app]"), s = e.target.closest("[data-s]");
        if (a) { sh.close(); if (one) touch(one); ops[+a.dataset.app].run(); return; }
        if (!s) return;
        var k = s.dataset.s;
        sh.close();
        if (k === "download" && window.TSU_TRANSFER) TSU_TRANSFER.download(paths).catch(function (err) { fail("无法存储", err); });
        if (k === "shelf" && window.TSU_TRANSFER) TSU_TRANSFER.add(paths);
        if (k === "copy" && navigator.clipboard) navigator.clipboard.writeText(paths.map(function (p) { return FS.toReal ? FS.toReal(p) : p; }).join("\n")).catch(function () {});
        if (k === "text" && navigator.clipboard) { try { navigator.clipboard.writeText(FS.read(one)); } catch (x) {} }
        if (k === "term" && window.TSU_TERM) { var dir = one && isFolder(one) ? one : parentOf(paths[0]); if (TSU_TERM.openWindow) TSU_TERM.openWindow(dir); else if (TSU_TERM.open) TSU_TERM.open(dir); }
      });
      if (F.selecting) F.select(false);
    }

    // ---- 移动：一张大面板，里面一层层点进文件夹，右上「移动」----
    function moveSheet(F, paths, done) {
      var sh = IO.sheet(F.el, { detent: "large", cls: "iof-move" }), cur = null;
      sh.navL.innerHTML = '<button class="io-gb io-txt" data-m="cancel">取消</button>';
      sh.navR.innerHTML = '<button class="io-gb io-txt io-tint" data-m="go">移动</button>';
      var from = parentOf(paths[0]);
      var bad = function (dir) { return paths.some(function (p) { return under(dir, p); }) || !canWrite(dir) || inTrash(dir) || dir === TRASH; };
      function show(dir) {
        cur = dir;
        sh.titleEl.innerHTML = "<b>" + (dir ? esc(nameOf(dir)) : "移动") + "</b><small>" + (paths.length === 1 ? "“" + esc(nameOf(paths[0])) + "”" : paths.length + " 个项目") + "</small>";
        sh.navR.querySelector("button").disabled = !dir || dir === from || bad(dir);
        var rows = dir ? kids(dir).filter(isFolder).sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b), "zh", { numeric: true }); }) : [HOME, SHARED, "/agents", "/tmp", UPLOADS, "/"];
        sh.body.innerHTML = (dir ? '<button class="iof-mback" data-up="' + esc(dir === "/" || [HOME, SHARED, "/agents", "/tmp", UPLOADS].indexOf(dir) >= 0 ? "" : parentOf(dir)) + '">' + SYM.back + "<span>" + esc(dir === "/" || [HOME, SHARED, "/agents", "/tmp", UPLOADS].indexOf(dir) >= 0 ? "位置" : nameOf(parentOf(dir))) + "</span></button>" : "") +
          '<div class="io-grp">' + (rows.length ? rows.map(function (q) {
            return '<div class="io-row io-tap' + (paths.indexOf(q) >= 0 ? " io-dim" : "") + '" data-d="' + esc(q) + '"><span class="iof-mico">' + folderIco(q) + '</span><span class="io-rl">' + esc(nameOf(q)) + '</span><i class="io-rchev">' + SYM.chev + "</i></div>"; }).join("")
            : '<div class="io-row"><span class="io-rl io-dimtext">没有文件夹</span></div>') + "</div>";
      }
      sh.body.addEventListener("click", function (e) {
        var r = e.target.closest("[data-d]"), up = e.target.closest("[data-up]");
        if (r && paths.indexOf(r.dataset.d) < 0) show(r.dataset.d);
        if (up) show(up.dataset.up || null);
      });
      sh.el.addEventListener("click", function (e) {
        var b = e.target.closest("[data-m]");
        if (!b || b.disabled) return;
        if (b.dataset.m === "cancel") return sh.close();
        var errs = [];
        paths.forEach(function (p) {
          var to = join(cur, baseOf(p));
          try { if (FS.exists(to)) to = join(cur, freeName(cur, baseOf(p))); FS.move(p, to); } catch (err) { errs.push(nameOf(p) + "：" + err.message); }
        });
        sh.close();
        if (errs.length) IO.alert({ title: "有些项目没能移动", message: errs.join("\n") });
        if (done) done();
      });
      show(under(from, HOME) || from === "/" ? from : null);
    }

    // ---- 显示简介 ----
    function infoSheet(F, p) {
      var sh = IO.sheet(F.el, { detent: "large", cls: "iof-info" }), s = st(p), open = (finderMeta().open || {})[p] || myRecent[p];
      sh.navR.innerHTML = '<button class="io-gb io-txt io-bold" data-i="done">完成</button>';
      sh.titleEl.textContent = "";
      sh.body.innerHTML = '<div class="iof-info-top"><span class="iof-ic">' + icon(p) + "</span><b>" + esc(nameOf(p)) + "</b><small>" + esc(kindOf(p)) + " - " + esc(metaLine(p)) + "</small></div>" +
        IO.group([
          { label: "种类", value: kindOf(p) },
          { label: "大小", value: FS.isDir(p) && !isApp(p) ? countOf(p) + " 项" : sizeText(bytesOf(s)) },
          { label: "位置", value: FS.toReal ? FS.toReal(parentOf(p)) : parentOf(p) },
          { label: "创建时间", value: dateText(s.ctime || s.mtime, true) },
          { label: "修改时间", value: dateText(s.mtime, true) },
          open ? { label: "上次打开时间", value: dateText(open, true) } : null,
          FS.modeStr && typeof s.mode === "number" ? { label: "权限", value: (s.owner ? String(FS.userName ? FS.userName(s.owner) : s.owner) + " · " : "") + FS.modeStr(s).slice(1) + "（" + (s.mode & 511).toString(8).padStart(3, "0") + "）" } : null,
        ].filter(Boolean), { header: "信息" });
      sh.el.addEventListener("click", function (e) { if (e.target.closest('[data-i="done"]')) sh.close(); });
    }

    // ---- 挂上：访达窗口在 iOS 模式下换成「文件」----
    IO.register({
      name: "files",
      nonav: true,
      test: function (w) { return w.classList.contains("finder"); },
      attach: function (w) {
        w.ioFiles = Files(w);
        if (w.ioPendingReveal) { var p = w.ioPendingReveal; w.ioPendingReveal = null; w.ioFiles.reveal(p); }
      },
    });
    var t = 0;
    FS.onChange(function () {
      clearTimeout(t);
      t = setTimeout(function () { if (!ios()) return; all.forEach(function (F) { if (!F.win.classList.contains("closed") && !F.el.querySelector(".iof-rename")) F.rerender(); }); }, 120);
    });
    // 别的 App 叫访达「显示」某个文件（编辑器、传输的「在访达中显示」、访达的 Dock 菜单）：iOS 模式下在「文件」里打开到那
    function filesOf(f) { var w = f && f.win && f.win.el; if (!w) { var fw = D.front && D.front(); w = fw && fw.el; } if (!w || !w.classList.contains("finder")) w = document.querySelector(".win.finder:not(.closed)"); return w; }
    function afterFinder(f, p) {
      var w = filesOf(f);
      if (!w) return;
      if (w.ioFiles) w.ioFiles.reveal(p); else w.ioPendingReveal = p;
    }
    function wrapFinder() {
      var FN = window.TSU_FINDER;
      if (!FN || FN.ioWrapped) return;
      FN.ioWrapped = true;
      ["open", "reveal", "go", "newWindow"].forEach(function (k) {
        var f0 = FN[k];
        if (typeof f0 !== "function") return;
        FN[k] = function (p) { var r = f0.apply(this, arguments); if (ios() && p) { var go = function () { afterFinder(r, p); }; requestAnimationFrame(function () { requestAnimationFrame(go); }); } return r; };
      });
      var pv0 = FN.preview;
      FN.preview = function (p) {
        if (!ios()) return pv0.apply(this, arguments);
        var r = FN.open(p);
        setTimeout(function () { var w = filesOf(r); if (w && w.ioFiles) w.ioFiles.quickLook(p); }, 480);
      };
    }
    wrapFinder();
    document.addEventListener("DOMContentLoaded", wrapFinder);
  })();
  // =====================================================================================================
  // 设置（系统设置的 iPhone 版）：账户、通用（关于本机、储存空间）、显示与亮度（外观、文字大小）、墙纸、专注模式——每一项都是真的设置
  // =====================================================================================================
  (function settings() {
    var S = function () { return D.settings; };
    var getSet = function (k) { try { return S() ? S().get(k) : null; } catch (e) { return null; } };
    var setSet = function (k, v) { try { if (S()) S().set(k, v); } catch (e) { console.error(e); } };
    var me = null;
    function loadMe(cb) { fetch("/api/me").then(function (r) { return r.json(); }).then(function (j) { me = j; cb(); }, function () { me = { loggedIn: false }; cb(); }); }
    var money = function (micro) { var A = window.TSU_AGENTS; return A && A.fmt && A.fmt.money ? A.fmt.money(micro) : "¥" + ((micro || 0) / 1e6).toFixed(2); };
    var version = function () { var A = window.TSU_AGENTS; return A && A.SPIRIT ? A.SPIRIT.version : ""; };
    var ICONS = { general: { bg: "#8e8e93", sym: "gearFill" }, display: { bg: "#007aff", sym: "sun" }, wall: { bg: "#32ade6", sym: "flower" }, focus: { bg: "#5856d6", sym: "moon" },
      about: { bg: "#8e8e93", sym: "info" }, storage: { bg: "#8e8e93", sym: "hdd" } };
    // 墙纸：用系统设置里原来那几个按钮的信息（本地才有的 Apple 墙纸取到了才显示）
    function walls() {
      return Array.prototype.map.call(document.querySelectorAll('#settings [data-set="wall"] button[data-v]'), function (b) {
        var img = b.querySelector("img");
        return { id: b.dataset.v, name: (b.querySelector("span") || b).textContent.trim(), thumb: img ? img.getAttribute("data-src") || img.getAttribute("src") : "", hidden: b.hidden };
      }).filter(function (w) { return !w.hidden; });
    }
    function treeBytes(dir) {
      var n = 0, files = 0;
      try { FS.walk(dir).forEach(function (p) { var s = FS.stat(p); if (s && !s.dir) { files++; n += s.size != null ? s.size : (s.data ? s.data.length : 0); } }); } catch (e) {}
      return { bytes: n, files: files };
    }
    function sizeText(n) { if (n < 1000) return n + " 字节"; if (n < 1e6) return (n / 1e3).toFixed(1) + " KB"; if (n < 1e9) return (n / 1e6).toFixed(1) + " MB"; return (n / 1e9).toFixed(2) + " GB"; }

    function Settings(winEl) {
      var T = { win: winEl };
      var el = T.el = document.createElement("div");
      el.className = "io-app ios-set";
      winEl.querySelector(".body").appendChild(el);
      var stack = T.stack = Stack(el);
      var bindRows = function (pg, handlers) {
        pg.body.addEventListener("click", function (e) {
          var sw = e.target.closest(".io-sw"), r = e.target.closest(".io-row[data-r]");
          if (!r) return;
          var h = handlers[r.dataset.r];
          if (!h) return;
          if (sw || h.toggle) { var on = !r.querySelector(".io-sw").classList.contains("on"); r.querySelector(".io-sw").classList.toggle("on", on); h.toggle(on); return; }
          if (h.tap) h.tap(r);
        });
      };
      var sub = function (title, render, handlers) {
        var pg = Page({ title: title, large: false, cls: "io-grouped" });
        pg.render = function () { pg.body.innerHTML = render(); };
        if (handlers) bindRows(pg, handlers);
        return pg;
      };
      // ---- 首页 ----
      function home() {
        var pg = Page({ title: "设置", cls: "io-grouped" });
        pg.render = function () {
          var q = (pg.q || "").trim();
          var acct = me && me.loggedIn ? '<div class="io-grp ios-acct"><div class="io-row io-tap" data-r="account"><span class="ios-avatar">' + (me.avatar ? '<img src="' + esc(me.avatar) + '" alt="">' : esc((me.login || "?").charAt(0).toUpperCase())) +
            '</span><span class="io-rl"><b>' + esc(me.login || "") + "</b><small>GitHub 账户、余额</small></span><i class=\"io-rchev\">" + SYM.chev + "</i></div></div>" : "";
          var A = window.TSU_AGENTS, nAg = A && A.list ? A.list().length : 0;
          var rows = [
            [{ key: "notify", label: "通知", icon: { bg: "#ff3b30", sym: "bell" }, chev: true }, { key: "focus", label: "专注模式", icon: ICONS.focus, chev: true, value: getSet("focus") ? "勿扰模式" : "" }],
            [{ key: "general", label: "通用", icon: ICONS.general, chev: true }, { key: "display", label: "显示与亮度", icon: ICONS.display, chev: true }, { key: "wall", label: "墙纸", icon: ICONS.wall, chev: true }],
            [{ key: "paimon", label: "Paimon", icon: { bg: "#d77757", sym: "✻" }, chev: true, value: nAg ? nAg + " 个 agent" : "" }], // App 自己的设置排在最后（同 iOS）
          ];
          if (q) { // 搜索：列出名字里有这几个字的设置项
            var hits = INDEX.filter(function (x) { return x.label.toLowerCase().indexOf(q.toLowerCase()) >= 0 || (x.also || "").indexOf(q) >= 0; });
            pg.body.innerHTML = searchRow(pg) + (hits.length ? IO.group(hits.map(function (x) { return { key: "go:" + x.go, label: x.label, sub: x.path, chev: true }; })) : '<div class="io-empty"><b>无结果</b><span>找不到“' + esc(q) + "”</span></div>");
          } else pg.body.innerHTML = searchRow(pg) + acct + rows.map(function (g) { return IO.group(g); }).join('<div class="io-gsp"></div>');
          bindSearchRow(pg);
        };
        pg.body.addEventListener("click", function (e) {
          var r = e.target.closest(".io-row[data-r]");
          if (!r) return;
          var k = r.dataset.r;
          if (k.indexOf("go:") === 0) { pg.q = ""; pg.searching = false; pg.render(); return T.go(k.slice(3)); }
          T.go(k);
        });
        return pg;
      }
      function searchRow(pg) {
        return '<div class="io-searchrow"><label class="io-search">' + SYM.search + '<input type="search" placeholder="搜索" spellcheck="false" autocomplete="off" enterkeyhint="search">' +
          '<button class="io-sclear" hidden aria-label="清除">' + SYM.clear + '</button></label><button class="io-scancel" hidden>取消</button></div>';
      }
      function bindSearchRow(pg) {
        var inp = pg.body.querySelector(".io-search input"), clr = pg.body.querySelector(".io-sclear"), cancel = pg.body.querySelector(".io-scancel");
        inp.value = pg.q || "";
        clr.hidden = !inp.value;
        cancel.hidden = !pg.searching;
        pg.el.classList.toggle("io-searching", !!pg.searching);
        inp.addEventListener("focus", function () { pg.searching = true; cancel.hidden = false; pg.el.classList.add("io-searching"); });
        inp.addEventListener("input", function () { pg.q = inp.value; var pos = inp.selectionStart; pg.render(); var i2 = pg.body.querySelector(".io-search input"); i2.focus(); try { i2.setSelectionRange(pos, pos); } catch (x) {} });
        clr.addEventListener("pointerdown", function (e) { e.preventDefault(); pg.q = ""; pg.render(); pg.body.querySelector(".io-search input").focus(); });
        cancel.addEventListener("click", function () { pg.q = ""; pg.searching = false; pg.render(); });
      }
      var INDEX = [
        { label: "通用", go: "general", path: "" }, { label: "关于本机", go: "about", path: "通用", also: "版本 沙盒" }, { label: "储存空间", go: "storage", path: "通用", also: "容量 空间" },
        { label: "显示与亮度", go: "display", path: "", also: "外观 浅色 深色 自动" }, { label: "外观", go: "display", path: "显示与亮度", also: "浅色 深色 自动" },
        { label: "文字大小", go: "textsize", path: "显示与亮度", also: "字体 字号" }, { label: "墙纸", go: "wall", path: "", also: "背景 动态" },
        { label: "专注模式", go: "focus", path: "", also: "勿扰" }, { label: "勿扰模式", go: "focus", path: "专注模式" }, { label: "账户", go: "account", path: "", also: "余额 退出登录 GitHub" },
        { label: "通知", go: "notify", path: "", also: "横幅 提醒" }, { label: "Paimon", go: "paimon", path: "", also: "agent 模型 权限 状态栏 思考 指令" },
      ];
      // ---- 选一项 / 选几项的页（同 iOS 的勾选列表）----
      function choice(title, opts, cur, onPick, o) {
        o = o || {};
        var pg = Page({ title: title, large: false, cls: "io-grouped" }), multi = Array.isArray(cur), val = multi ? cur.slice() : cur;
        pg.render = function () {
          pg.body.innerHTML = IO.group(opts.map(function (x) { return { key: "c:" + x[0], label: x[1], sub: x[2] || "", checked: multi ? val.indexOf(x[0]) >= 0 : String(val) === String(x[0]) }; }), { header: o.header || "", footer: o.footer || "" });
        };
        pg.body.addEventListener("click", function (e) {
          var r = e.target.closest(".io-row[data-r]");
          if (!r || r.dataset.r.indexOf("c:") !== 0) return;
          var v = r.dataset.r.slice(2);
          if (multi) { val = val.indexOf(v) >= 0 ? val.filter(function (x) { return x !== v; }) : val.concat([v]); onPick(opts.map(function (x) { return x[0]; }).filter(function (x) { return val.indexOf(x) >= 0; })); pg.render(); }
          else { val = v; onPick(v); pg.render(); setTimeout(function () { stack.pop(); }, 180); }
        });
        pg.render();
        stack.push(pg);
      }
      function textPage(title, value, onSave, o) {
        o = o || {};
        var pg = Page({ title: title, large: false, cls: "io-grouped" });
        pg.render = function () { if (pg.body.querySelector("textarea, input")) return; pg.body.innerHTML = '<div class="io-grp ios-text">' + (o.multi ? '<textarea rows="8" spellcheck="false" placeholder="' + esc(o.placeholder || "") + '">' + esc(value) + "</textarea>" : '<input spellcheck="false" autocomplete="off" value="' + esc(value) + '">') + "</div>" + (o.footer ? '<p class="io-gf">' + esc(o.footer) + "</p>" : "") + '<p class="io-gf ios-text-err"></p>'; };
        pg.render();
        var done = document.createElement("button");
        done.className = "io-gb io-txt io-bold";
        done.textContent = "完成";
        pg.navR.appendChild(done);
        done.addEventListener("click", function () { var f = pg.body.querySelector("textarea, input"), err = onSave(f.value); if (err) pg.body.querySelector(".ios-text-err").textContent = err; else stack.pop(); });
        stack.push(pg);
      }
      var ACCESS_ZH = { none: "只有自己的文件夹", read: "只读", rw: "读写" }, EFFORT_ZH = { off: "关", low: "低", high: "高", max: "最高" }, THINK_ZH = { hidden: "隐藏", collapsed: "折叠", expanded: "展开" };
      var STATUS_ZH = { balance: "余额", context: "上下文", cost: "花费", model: "模型", cwd: "当前目录", access: "权限" }, FOOTER_ZH = { duration: "用时", time: "完成时间", tokens: "token 数", cost: "花费" };
      function agentState(a) {
        var A = window.TSU_AGENTS, r = A.runtime(a.id), st = r.state(), working = st === "working" || r.tasks.some(function (x) { return x.status === "running"; });
        var here = Array.prototype.some.call(document.querySelectorAll(".tpane"), function (el) { return el.pane && el.pane.program && el.pane.program.agentId === a.id; });
        var g = here ? "F" : st !== "idle" || working ? "B" : "O";
        return { g: g, tag: g === "O" ? "[O]" : (working ? "[W]" : "[NW]") + " [" + g + "]", tail: String(r.tail() || "").replace(/\s+/g, " ") };
      }
      function agentPage(id) {
        var A = window.TSU_AGENTS, pg = Page({ title: "", large: false, cls: "io-grouped" });
        pg.render = function () {
          var a = A.get(id);
          if (!a) { pg.body.innerHTML = '<div class="io-empty"><b>没有这个 agent</b></div>'; return; }
          pg.setTitle(a.name);
          var s0 = agentState(a), m = A.modelOf(a.model), hist = A.history ? A.history(id) : 0;
          pg.body.innerHTML = '<div class="ios-acct-top"><span class="ios-avatar big" style="background:#d77757">' + esc(a.name.charAt(0).toUpperCase()) + "</span><b>" + esc(a.name) + "</b><small>" + esc(s0.tag + " · " + a.id) + "</small></div>" +
            IO.group([{ key: "name", label: "名称", value: a.name, chev: true }, { key: "model", label: "模型", value: m ? m.name : a.model, chev: true }, { key: "effort", label: "思考强度", value: EFFORT_ZH[a.effort || "high"], chev: true },
              { key: "access", label: "出了自己文件夹的权限", value: ACCESS_ZH[a.access || "read"], chev: true }]) + '<div class="io-gsp"></div>' +
            IO.group([{ label: "家目录", value: A.runtime(id).home() }, { label: "履历", value: (A.fmt ? A.fmt.k(hist) : hist) + " tokens" }, { label: "在做", value: s0.tail.slice(0, 40) || "—" }]) + '<div class="io-gsp"></div>' +
            IO.group([{ key: "open", label: "在终端中打开", cls: "io-center io-blue" }]) + '<div class="io-gsp"></div>' + IO.group([{ key: a.archived ? "restore" : "archive", label: a.archived ? "恢复" : "归档", cls: "io-center" + (a.archived ? " io-blue" : " io-destructive") }], { footer: "归档不会删除任何东西：会话、家目录都留着，随时能恢复。" });
        };
        pg.body.addEventListener("click", function (e) {
          var r = e.target.closest(".io-row[data-r]"), a = A.get(id);
          if (!r || !a) return;
          var k = r.dataset.r, rt = A.runtime(id);
          if (k === "name") textPage("名称", a.name, function (v) { return rt.rename(v.trim()) || ""; }, { footer: "字母开头，只用字母、数字、. - _；会自动带上编号（同 paimon new）。" });
          else if (k === "model") choice("模型", A.models().map(function (x) { return [x.id, x.name]; }), a.model, function (v) { rt.setModel(v); });
          else if (k === "effort") choice("思考强度", A.EFFORTS.map(function (x) { return [x, EFFORT_ZH[x] || x]; }), a.effort || "high", function (v) { rt.setEffort(v); });
          else if (k === "access") choice("权限", [["none", ACCESS_ZH.none], ["read", ACCESS_ZH.read], ["rw", ACCESS_ZH.rw]], a.access || "read", function (v) { rt.setAccess(v); }, { footer: "agent 出了自己的文件夹能对你的文件做什么。终端里 shift+tab 也能切。" });
          else if (k === "open") { if (window.TSU_TERM) TSU_TERM.agent(id); }
          else if (k === "archive") IO.actionSheet({ message: "归档后它不在列表里了，但什么都不删，随时能恢复。", buttons: [{ label: "归档", role: "destructive" }] }).then(function (b) { if (b) { A.archive(id); stack.pop(); } });
          else if (k === "restore") { A.unarchive(id); pg.render(); }
        });
        pg.render();
        stack.push(pg);
      }
      T.go = function (k) {
        var P = PAGES[k];
        if (!P) return;
        if (P.parent && stack.pages.length < 2) stack.push(PAGES[P.parent].make(), false);
        stack.push(P.make());
      };
      // ---- 各页 ----
      var PAGES = {
        account: { make: function () {
          return sub("账户", function () {
            return '<div class="ios-acct-top"><span class="ios-avatar big">' + (me && me.avatar ? '<img src="' + esc(me.avatar) + '" alt="">' : esc(((me && me.login) || "?").charAt(0).toUpperCase())) + "</span><b>" + esc(me && me.login || "") + "</b><small>GitHub 账户</small></div>" +
              IO.group([{ label: "余额", value: me && me.allowed ? money(me.balance) : "—" }, me && me.pricing ? { label: "计价", value: me.pricing.unit || "" } : null].filter(Boolean)) + '<div class="io-gsp"></div>' +
              IO.group([{ key: "logout", label: "退出登录", cls: "io-destructive io-center" }]);
          }, { logout: { tap: function () { IO.actionSheet({ message: "退出以后，要重新用 GitHub 登录。", buttons: [{ label: "退出登录", role: "destructive" }] }).then(function (b) { if (b) location.href = "/auth/logout"; }); } } });
        } },
        general: { make: function () {
          return sub("通用", function () { return IO.group([{ key: "about", label: "关于本机", chev: true }]) + '<div class="io-gsp"></div>' + IO.group([{ key: "storage", label: "储存空间", chev: true }]); },
            { about: { tap: function () { T.go("about"); } }, storage: { tap: function () { T.go("storage"); } } });
        } },
        about: { parent: "general", make: function () {
          return sub("关于本机", function () {
            var all = treeBytes("/"), info = FS && FS.mirrorInfo ? FS.mirrorInfo() : null;
            return IO.group([{ label: "名称", value: "code.paimon.beer" }, { label: "软件版本", value: version() ? "v" + version() : "—" },
              { label: "沙盒", value: info ? "真沙盒（" + (info.driver === "seatbelt" ? "macOS" : info.driver === "docker" ? "Docker" : info.driver) + "）" : "浏览器" }]) + '<div class="io-gsp"></div>' +
              IO.group([{ label: "文件", value: String(all.files) }, { label: "已使用", value: sizeText(all.bytes) }, me && me.login ? { label: "账户", value: me.login } : null].filter(Boolean));
          });
        } },
        storage: { parent: "general", make: function () {
          return sub("储存空间", function () {
            var parts = [["个人", FS.HOME, "#007aff"], ["Agents", "/agents", "#af52de"], ["共享", "/shared", "#34c759"], ["临时", "/tmp", "#ff9500"], ["系统", "/.paimon", "#8e8e93"]].map(function (x) { var t = treeBytes(x[1]); return { name: x[0], path: x[1], c: x[2], b: t.bytes, n: t.files }; });
            var whole = treeBytes("/"), rest = { name: "其他", c: "#c7c7cc", b: Math.max(0, whole.bytes - parts.reduce(function (a, x) { return a + x.b; }, 0)), n: Math.max(0, whole.files - parts.reduce(function (a, x) { return a + x.n; }, 0)) };
            if (rest.n) parts.push(rest);
            var total = parts.reduce(function (a, x) { return a + x.b; }, 0) || 1;
            return '<div class="io-grp ios-stor"><div class="ios-stor-h"><b>已使用 ' + esc(sizeText(total)) + "</b></div><div class=\"ios-stor-bar\">" +
              parts.map(function (x) { return '<i style="background:' + x.c + ";flex-grow:" + Math.max(x.b / total, x.b ? 0.01 : 0) + '"></i>'; }).join("") + '</div><div class="ios-stor-leg">' +
              parts.map(function (x) { return '<span><i style="background:' + x.c + '"></i>' + esc(x.name) + "</span>"; }).join("") + "</div></div>" + '<div class="io-gsp"></div>' +
              IO.group(parts.map(function (x) { return { label: x.name, sub: x.n + " 个文件", value: sizeText(x.b) }; }));
          });
        } },
        display: { make: function () {
          var pg = sub("显示与亮度", function () {
            var th = getSet("theme") || "auto", lightNow = root.classList.contains("light");
            var mock = function (k, name) {
              var on = th === "auto" ? (k === "light") === lightNow : th === k;
              return '<button class="ios-look' + (on ? " on" : "") + '" data-look="' + k + '"><span class="ios-phone ios-phone-' + k + '"><i></i><i></i><i></i></span><span>' + name + "</span><i class=\"ios-radio\">" + (on ? SYM.check : "") + "</i></button>";
            };
            return '<h3 class="io-gh">外观</h3><div class="io-grp"><div class="ios-looks">' + mock("light", "浅色") + mock("dark", "深色") + "</div>" +
              '<div class="io-row" data-r="auto"><span class="io-rl">自动</span><span class="io-sw' + (th === "auto" ? " on" : "") + '" role="switch"><i></i></span></div></div>' +
              '<h3 class="io-gh">文字</h3>' + IO.group([{ key: "textsize", label: "文字大小", chev: true }]);
          }, {
            auto: { toggle: function (on) { if (window.TSU_APP) TSU_APP.setTheme(on ? "auto" : root.classList.contains("light") ? "light" : "dark"); pg.render(); } },
            textsize: { tap: function () { T.go("textsize"); } },
          });
          pg.body.addEventListener("click", function (e) { var b = e.target.closest("[data-look]"); if (b && window.TSU_APP) { TSU_APP.setTheme(b.dataset.look); pg.render(); } });
          return pg;
        } },
        textsize: { parent: "display", make: function () {
          var pg = sub("文字大小", function () {
            var v = +getSet("fontSize") || 13;
            return '<p class="ios-ts-note">终端里的文字会调整为下方你偏好的大小。</p><div class="ios-ts-sample" style="font-size:' + v + 'px">❯ paimon<br>你好，我是 Paimon。</div>' +
              '<div class="io-grp ios-ts"><span class="ios-ts-a">A</span><input type="range" min="11" max="18" step="1" value="' + v + '"><span class="ios-ts-b">A</span></div>';
          });
          pg.body.addEventListener("input", function (e) {
            if (e.target.type !== "range") return;
            var v = +e.target.value;
            setSet("fontSize", v);
            var smp = pg.body.querySelector(".ios-ts-sample");
            if (smp) smp.style.fontSize = v + "px";
            e.target.style.setProperty("--p", (v - 11) / 7 * 100 + "%");
          });
          var r0 = pg.render;
          pg.render = function () { r0(); var r = pg.body.querySelector("input[type=range]"); if (r) r.style.setProperty("--p", (r.value - 11) / 7 * 100 + "%"); };
          return pg;
        } },
        wall: { make: function () {
          var pg = sub("墙纸", function () {
            var cur = getSet("wallpaper"), ws = walls(), motion = getSet("motion");
            var hasVideo = ws.some(function (w) { return w.id === cur && /^tahoe/.test(w.id); });
            return '<div class="ios-walls">' + ws.map(function (w) {
              return '<button class="ios-wall' + (w.id === cur ? " on" : "") + '" data-wall="' + esc(w.id) + '"><span class="ios-wthumb" style="background-image:url(\'' + esc(w.thumb) + '\')"></span><span>' + esc(w.name) + "</span></button>"; }).join("") + "</div>" +
              (hasVideo ? '<div class="io-gsp"></div>' + IO.group([{ key: "motion", label: "动态墙纸", sw: !!motion }], { footer: "太浩湖是航拍视频。" }) : "");
          }, { motion: { toggle: function (on) { setSet("motion", on); } } });
          pg.body.addEventListener("click", function (e) { var b = e.target.closest("[data-wall]"); if (b) { setSet("wallpaper", b.dataset.wall); pg.render(); } });
          return pg;
        } },
        notify: { make: function () {
          var list = function () { return (D.appList ? D.appList() : []).filter(function (a) { return ["launchpad", "missioncontrol"].indexOf(a.id) < 0; }); };
          var ST = { banner: "横幅", alert: "提醒", none: "关" };
          var pg = sub("通知", function () {
            return IO.group(list().map(function (a) { return { key: "n:" + a.id, label: a.name, value: ST[S().notifyStyle ? S().notifyStyle(a.id) : "banner"], chev: true }; }), { header: "通知样式", footer: "横幅：几秒后自己收起；提醒：一直留着，直到你点掉；关：这个 App 的通知都不要。" });
          });
          pg.body.addEventListener("click", function (e) {
            var r = e.target.closest(".io-row[data-r]");
            if (!r || r.dataset.r.indexOf("n:") !== 0) return;
            var id = r.dataset.r.slice(2), ap = list().find(function (a) { return a.id === id; });
            choice(ap ? ap.name : id, [["banner", "横幅"], ["alert", "提醒"], ["none", "关"]], S().notifyStyle(id), function (v) { S().setNotifyStyle(id, v); pg.render(); });
          });
          return pg;
        } },
        paimon: { make: function () {
          var A = window.TSU_AGENTS;
          var pg = sub("Paimon", function () {
            if (!A || !A.list) return '<div class="io-empty"><b>agent 还没载入</b></div>';
            var cfg = A.cfg, all = A.list(), st = {}, n = { F: 0, B: 0, O: 0 }, ms = A.models(), arch = A.archived();
            all.forEach(function (a) { st[a.id] = agentState(a); });
            var order = ["F", "B", "O"].reduce(function (acc, g) { return acc.concat(all.filter(function (a) { return st[a.id].g === g; })); }, []);
            var dm = ms.find(function (m) { return m.id === cfg.defaultModel; });
            return IO.group(order.map(function (a) { var s0 = st[a.id], m = A.modelOf(a.model); return { key: "a:" + a.id, label: (++n[s0.g]) + ". " + a.name, sub: (m ? m.name : a.model) + " · " + ACCESS_ZH[a.access || "read"] + (s0.tail ? " · " + s0.tail.slice(0, 40) : ""), value: s0.tag, chev: true, cls: "ios-agrow" }; })
                .concat([{ key: "new", label: "新建 agent", cls: "io-blue" }]), { header: "Agent · v" + A.SPIRIT.version }) +
              (arch.length ? '<div class="io-gsp"></div>' + IO.group(arch.map(function (a) { return { key: "a:" + a.id, label: a.name, sub: "已归档", chev: true, cls: "ios-agrow" }; }), { header: "已归档" }) : "") +
              '<div class="io-gsp"></div>' + IO.group([{ key: "defaultModel", label: "新 agent 的模型", value: dm ? dm.name : "第一个", chev: true }]) +
              '<div class="io-gsp"></div>' + IO.group([
                { key: "statusline", label: "状态栏显示", value: (cfg.statusline || []).map(function (f) { return STATUS_ZH[f] || f; }).join("、") || "无", chev: true },
                { key: "footer", label: "每一问结尾显示", value: (cfg.footer || []).map(function (f) { return FOOTER_ZH[f] || f; }).join("、") || "无", chev: true },
                { key: "thinking", label: "思考过程", value: THINK_ZH[cfg.thinking] || cfg.thinking, chev: true },
                { key: "wrap", label: "长行", value: cfg.wrap === "clip" ? "截断" : "折行", chev: true },
                { key: "time", label: "时间格式", value: cfg.time === "24h" ? "24 小时" : "12 小时", chev: true },
                { key: "tips", label: "输入框里的提示", sw: cfg.tips !== false }, { key: "autoscroll", label: "有新输出时滚到最下面", sw: cfg.autoscroll !== false }, { key: "copyOnSelect", label: "选中即拷贝", sw: !!cfg.copyOnSelect },
              ], { header: "终端" }) +
              '<div class="io-gsp"></div>' + IO.group([{ key: "sandbox", label: "沙盒工具", sub: "Bash、Read、Write、Edit…", sw: cfg.sandbox !== false }, { key: "webSearch", label: "网页搜索", sw: cfg.webSearch !== false }, { key: "webFetch", label: "读网页", sw: cfg.webFetch !== false }], { header: "工具" }) +
              '<div class="io-gsp"></div>' + IO.group([{ key: "instructions", label: "自定义指令", value: cfg.instructions ? cfg.instructions.slice(0, 16) + (cfg.instructions.length > 16 ? "…" : "") : "无", chev: true }], { footer: "这些都存在 /.paimon/config/settings.json，rw 档位的 agent 也能帮你改。" });
          }, {
            tips: { toggle: function (on) { A.setCfg("tips", on); } }, autoscroll: { toggle: function (on) { A.setCfg("autoscroll", on); } }, copyOnSelect: { toggle: function (on) { A.setCfg("copyOnSelect", on); } },
            sandbox: { toggle: function (on) { A.setCfg("sandbox", on); } }, webSearch: { toggle: function (on) { A.setCfg("webSearch", on); } }, webFetch: { toggle: function (on) { A.setCfg("webFetch", on); } },
          });
          pg.body.addEventListener("click", function (e) {
            var r = e.target.closest(".io-row[data-r]");
            if (!r || e.target.closest(".io-sw")) return;
            var k = r.dataset.r, cfg = A.cfg;
            if (k.indexOf("a:") === 0) agentPage(k.slice(2));
            else if (k === "new") { var na = A.create({}); agentPage(na.id); }
            else if (k === "defaultModel") choice("新 agent 的模型", [["", "第一个"]].concat(A.models().map(function (x) { return [x.id, x.name]; })), cfg.defaultModel || "", function (v) { A.setCfg("defaultModel", v); });
            else if (k === "statusline") choice("状态栏显示", A.STATUS_FIELDS.map(function (f) { return [f, STATUS_ZH[f] || f]; }), cfg.statusline || [], function (v) { A.setCfg("statusline", v); });
            else if (k === "footer") choice("每一问结尾显示", A.FOOTER_FIELDS.map(function (f) { return [f, FOOTER_ZH[f] || f]; }), cfg.footer || [], function (v) { A.setCfg("footer", v); });
            else if (k === "thinking") choice("思考过程", [["hidden", "隐藏"], ["collapsed", "折叠（一行）"], ["expanded", "展开"]], cfg.thinking, function (v) { A.setCfg("thinking", v); });
            else if (k === "wrap") choice("长行", [["wrap", "折行"], ["clip", "截断"]], cfg.wrap, function (v) { A.setCfg("wrap", v); }, { footer: "代码、改动、工具输出里的长行。" });
            else if (k === "time") choice("时间格式", [["12h", "12 小时"], ["24h", "24 小时"]], cfg.time, function (v) { A.setCfg("time", v); });
            else if (k === "instructions") textPage("自定义指令", cfg.instructions || "", function (v) { A.setCfg("instructions", v); return ""; }, { multi: true, placeholder: "例如：回答用中文；改代码前先说计划。", footer: "写进每个 agent 的提示词里。" });
          });
          if (A && A.on) A.on(function (type) { if ((type === "agents" || type === "cfg") && stack.top() === pg) pg.render(); });
          return pg;
        } },
        focus: { make: function () {
          return sub("专注模式", function () {
            return IO.group([{ key: "dnd", label: "勿扰模式", icon: ICONS.focus, sw: !!getSet("focus") }], { footer: "打开勿扰模式后，通知不会弹出横幅，照样收进通知中心。" });
          }, { dnd: { toggle: function (on) { setSet("focus", on); } } });
        } },
      };
      PAGES.home = { make: home };
      stack.push(home(), false);
      loadMe(function () { var t = stack.top(); if (t && t.render) t.render(); });
      var refresh = function () { var t = stack.top(); if (t && t.render && !el.querySelector("input:focus")) t.render(); };
      document.addEventListener("tsu-theme", refresh);
      document.addEventListener("tsu-settings", refresh);
      return T;
    }
    IO.register({ name: "settings", nonav: true, test: function (w) { return w.id === "settings"; }, attach: function (w) { w.ioSettings = Settings(w); } });
    // 「系统设置 → 墙纸」这类直达：iOS 模式下打开对应的一页
    function wrap() {
      if (!D.settingsPage || D.settingsPage.io) return;
      var f0 = D.settingsPage;
      D.settingsPage = function (id) {
        var r = f0.apply(this, arguments);
        if (ios()) setTimeout(function () { var w = document.getElementById("settings"); if (w && w.ioSettings) { w.ioSettings.stack.popTo(0); if (id === "look") w.ioSettings.go("display"); else if (id === "wall") w.ioSettings.go("wall"); } }, 30);
        return r;
      };
      D.settingsPage.io = true;
    }
    wrap();
    document.addEventListener("DOMContentLoaded", wrap);
  })();
  // ---- 键盘：visualViewport 变矮时，算出键盘盖住了每个 App 多少，写进 --io-kb（底下的工具栏、输入栏抬上去）----
  (function keyboard() {
    var vv = window.visualViewport;
    function upd() {
      if (!vv) return;
      document.querySelectorAll(".io-app, .io-kbhost").forEach(function (a) {
        var r = a.getBoundingClientRect(), cover = Math.max(0, Math.round(r.bottom - (vv.offsetTop + vv.height)));
        a.style.setProperty("--io-kb", cover + "px");
        a.classList.toggle("io-kbup", cover > 60);
      });
    }
    if (vv) { vv.addEventListener("resize", upd); vv.addEventListener("scroll", upd); }
    IO.kbSync = upd;
  })();

  // =====================================================================================================
  // Safari：iOS 26 的紧凑布局——网页铺满，底下浮着一条玻璃栏（后退 · 地址 · ⋯）；地址栏往上划 / ⋯ 里看所有标签页
  // 地址栏就是 Safari 自己的那个（挪到底下来，输入、回车、显示网址都照旧）；按钮点的是它工具栏里藏起来的原按钮
  // =====================================================================================================
  (function safari() {
    var HKEY = "tsu-safari-history";
    var favicon = function (u) { try { return "https://icons.duckduckgo.com/ip3/" + new URL(u).hostname + ".ico"; } catch (e) { return ""; } };
    function attach(w) {
      var tools = w.querySelector(".sf-tools"), addr = tools && tools.querySelector(".sf-addr"), main = w.querySelector(".sf-main");
      if (!tools || !addr || !main) return;
      var input = addr.querySelector("input"), orig = { parent: addr.parentNode, next: addr.nextSibling };
      var sfb = function (k) { return tools.querySelector('[data-sf="' + k + '"]'); };
      w.classList.add("io-kbhost");
      var bar = document.createElement("div");
      bar.className = "ios-sf-bar io-only";
      bar.innerHTML = fb("back", "back", "", "后退") + '<div class="ios-sf-slot"></div><button class="ios-sf-cancel" hidden>取消</button>' + fb("more", "more", "", "更多");
      bar.querySelector(".ios-sf-slot").appendChild(addr);
      main.appendChild(bar);
      w.ioSafari = { bar: bar, addr: addr, orig: orig };
      var cancel = bar.querySelector(".ios-sf-cancel");
      function sync() {
        bar.querySelector('[data-act="back"]').disabled = !!sfb("back").disabled;
        var editing = addr.classList.contains("editing");
        bar.classList.toggle("io-editing", editing);
        cancel.hidden = !editing;
        if (w.ioTabs) renderTabs();
      }
      new MutationObserver(sync).observe(tools, { attributes: true, subtree: true, attributeFilter: ["disabled", "class"] });
      new MutationObserver(sync).observe(addr, { attributes: true, attributeFilter: ["class"] });
      new MutationObserver(function () { if (w.ioTabs) renderTabs(); }).observe(w.querySelector(".sf-tabs"), { childList: true, subtree: true, attributes: true });
      sync();
      input.addEventListener("focus", function () { setTimeout(IO.kbSync, 300); });
      cancel.addEventListener("pointerdown", function (e) { e.preventDefault(); input.blur(); });
      bar.addEventListener("click", function (e) {
        var b = e.target.closest("[data-act]");
        if (!b) return;
        if (b.dataset.act === "back") sfb("back").click();
        if (b.dataset.act === "more") moreMenu(b);
      });
      // 地址栏往上划：所有标签页
      var y0 = null;
      addr.addEventListener("pointerdown", function (e) { if (!addr.classList.contains("editing")) y0 = e.clientY; });
      addr.addEventListener("pointermove", function (e) { if (y0 != null && y0 - e.clientY > 40) { y0 = null; e.preventDefault(); openTabs(); } });
      addr.addEventListener("pointerup", function () { y0 = null; });
      function tabEls() { return Array.prototype.slice.call(w.querySelectorAll(".sf-tabs .sf-tb")); }
      function curURL() { // 当前标签页的网址：网页是 iframe 就看它的 src；阅读器、卡片：Safari 在地址栏拿到焦点时才把网址填进输入框（借一下，不真的聚焦）
        var f = w.querySelector(".sf-view.on iframe.sf-frame");
        if (f && /^https?:/.test(f.src)) return f.src;
        input.select = function () {};
        input.dispatchEvent(new Event("focus"));
        var u = input.value;
        input.dispatchEvent(new Event("blur"));
        setTimeout(function () { delete input.select; }, 0);
        return u;
      }
      function moreMenu(b) {
        var n = Math.max(1, tabEls().length), u = curURL(), reader = sfb("reader");
        IO.menu(b, [
          { row: [{ label: "新建标签页", icon: "plus", run: newTab }, { label: n + " 个标签页", icon: "tabs", run: openTabs }, { label: "历史记录", icon: "book", run: historySheet }, { label: "共享", icon: "share", disabled: !u, run: function () { share(u); } }] },
          { label: "前进", icon: "fwd", disabled: !!sfb("fwd").disabled, run: function () { sfb("fwd").click(); } },
          { label: "重新载入", icon: "reload", disabled: !u, run: function () { sfb("reload").click(); } },
          { label: reader.classList.contains("on") ? "隐藏阅读器" : "显示阅读器", icon: "reader", disabled: !u, run: function () { reader.click(); } },
          { sep: true },
          { label: "在浏览器中打开", icon: "open", disabled: !u, run: function () { sfb("out").click(); } },
          { label: "拷贝链接", icon: "copy", disabled: !u, run: function () { if (navigator.clipboard) navigator.clipboard.writeText(u).catch(function () {}); } },
        ], { above: true });
      }
      function newTab() { sfb("new").click(); setTimeout(function () { input.focus(); }, 80); }
      function share(u) {
        IO.actionSheet({ title: u.replace(/^https?:\/\//, "").slice(0, 80), buttons: [{ label: "在浏览器中打开" }, { label: "拷贝链接" }] }).then(function (b) {
          if (b === "在浏览器中打开") sfb("out").click();
          if (b === "拷贝链接" && navigator.clipboard) navigator.clipboard.writeText(u).catch(function () {});
        });
      }
      // ---- 所有标签页：两列卡片（跨源网页截不到图：卡片上是网站图标和域名），底下「+ · N 个标签页 · 完成」----
      function openTabs() {
        if (w.ioTabs) return;
        var ov = document.createElement("div");
        ov.className = "ios-sf-tabs io-only";
        ov.innerHTML = '<div class="ios-sf-grid"></div><nav class="ios-sf-tbar">' + fb("plus", "new", "", "新建标签页") + '<span class="ios-sf-count"></span><button class="io-gb io-txt io-bold" data-act="done">完成</button></nav>';
        w.querySelector(".body").appendChild(ov);
        w.ioTabs = ov;
        renderTabs();
        ov.addEventListener("click", function (e) {
          var x = e.target.closest("[data-x]"), c = e.target.closest("[data-t]"), a = e.target.closest("[data-act]"), els = tabEls();
          if (x) { var tx = els[+x.dataset.x]; if (tx) { if (els.length === 1) closeTabs(); tx.querySelector(".sf-tb-x").click(); } return; }
          if (c) { var t = els[+c.dataset.t]; if (t) t.click(); closeTabs(); return; }
          if (a && a.dataset.act === "done") closeTabs();
          if (a && a.dataset.act === "new") { closeTabs(); newTab(); }
        });
      }
      function closeTabs() { var ov = w.ioTabs; if (!ov) return; w.ioTabs = null; ov.classList.add("io-out"); setTimeout(function () { ov.remove(); }, 260); }
      function renderTabs() {
        var ov = w.ioTabs;
        if (!ov) return;
        var els = tabEls();
        if (!els.length) { // 只有一个标签页时 Safari 不画标签条：当前页算一个
          var t0 = w.querySelector(".sf-show");
          els = [];
          ov.querySelector(".ios-sf-grid").innerHTML = card(0, (t0 && t0.textContent.trim()) || "起始页", "", true, false);
        } else ov.querySelector(".ios-sf-grid").innerHTML = els.map(function (t, i) {
          var img = t.querySelector("img");
          return card(i, t.querySelector(".sf-tb-t").textContent, img ? img.getAttribute("src") : "", t.classList.contains("on"), t.classList.contains("loading"));
        }).join("");
        ov.querySelector(".ios-sf-count").textContent = Math.max(1, els.length) + " 个标签页";
      }
      function card(i, title, ico, on, loading) {
        return '<div class="ios-sf-card' + (on ? " on" : "") + (loading ? " loading" : "") + '" data-t="' + i + '"><div class="ios-sf-shot">' +
          (ico ? '<img src="' + esc(ico) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()">' : '<i>' + SYM.safari + "</i>") + "</div>" +
          '<div class="ios-sf-ct"><span>' + esc(title) + '</span><button data-x="' + i + '" aria-label="关闭标签页">' + SYM.xmark + "</button></div></div>";
      }
      // ---- 历史记录（Safari 自己记在本地的那份）----
      function historySheet() {
        var h = store.get(HKEY, []), sh = IO.sheet(main, { title: "历史记录", cls: "ios-sf-hist" });
        sh.navR.innerHTML = '<button class="io-gb io-txt io-bold" data-h="done">完成</button>';
        var day = function (t) { var d = new Date(t), n = new Date(), d0 = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(); return t >= d0 ? "今天" : t >= d0 - 864e5 ? "昨天" : (d.getMonth() + 1) + "月" + d.getDate() + "日"; };
        var groups = [], last = null;
        h.forEach(function (x) { var k = day(x.t || 0); if (k !== last) { groups.push({ k: k, items: [] }); last = k; } groups[groups.length - 1].items.push(x); });
        sh.body.innerHTML = groups.length ? groups.map(function (g) {
          return '<h3 class="io-gh">' + esc(g.k) + '</h3><div class="io-grp">' + g.items.map(function (x) {
            return '<div class="io-row io-tap" data-u="' + esc(x.url) + '"><span class="ios-sf-hico"><img src="' + esc(favicon(x.url)) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()"></span><span class="io-rl">' + esc(x.title || x.url) + "<small>" + esc(x.url.replace(/^https?:\/\//, "")) + "</small></span></div>";
          }).join("") + "</div>";
        }).join("") : '<div class="io-empty"><b>无历史记录</b></div>';
        sh.el.addEventListener("click", function (e) {
          if (e.target.closest('[data-h="done"]')) return sh.close();
          var r = e.target.closest("[data-u]");
          if (r) { sh.close(); go(r.dataset.u); }
        });
      }
      function go(u) { input.value = u; input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); }
      w.ioSafari.go = go;
    }
    function detach(w) {
      var s = w.ioSafari;
      if (!s) return;
      if (s.orig.parent) s.orig.parent.insertBefore(s.addr, s.orig.next && s.orig.next.parentNode === s.orig.parent ? s.orig.next : null);
      s.bar.remove();
      if (w.ioTabs) { w.ioTabs.remove(); w.ioTabs = null; }
      w.ioSafari = null;
    }
    IO.register({ name: "safari", nonav: true, test: function (w) { return w.id === "safari"; }, attach: attach, detach: detach });
    // 别的 App 叫 Safari 打开网址：手机上 Safari 原来直接开浏览器的新标签页（离开这个页面）；iOS 模式下留在这里，在 Safari 窗口里开
    function wrap() {
      var SF = window.TSU_SAFARI;
      if (!SF || SF.ioWrapped) return;
      SF.ioWrapped = true;
      var open0 = SF.open;
      SF.open = function (url, opts) {
        if (!ios()) return open0.apply(this, arguments);
        var win = SF.win;
        if (win.state === "closed" || win.state === "min") win.show(); else win.front();
        return open0.call(this, url, opts); // safari.js 在 html.ios 下不当自己是「手机上没有桌面」，链接就在这个 Safari 里开
      };
    }
    wrap();
    document.addEventListener("DOMContentLoaded", wrap);
  })();
  // =====================================================================================================
  // 编辑器：代码区还是终端风格的那张字符网格，外面换成 iPhone 的样子——顶上导航栏（文件 · 文件名 · 运行 · ⋯），
  // 资源管理器是从左边滑出来的抽屉，打字时键盘上面一排符号键（Tab、括号、引号、方向键……）
  // =====================================================================================================
  (function editor() {
    var KEYS = ["⇥", "(", ")", "{", "}", "[", "]", '"', "'", "=", ":", ";", ".", ",", "<", ">", "/", "\\", "|", "-", "_", "+", "*", "&", "!", "?", "#", "$", "%", "`", "~", "@", "^"];
    function attach(w) {
      var body = w.querySelector(".body"), rootEl = w.querySelector(".ide-root");
      if (!rootEl) return;
      var M = function () { var a = D.apps && D.apps.ide; return a && a.menus ? a.menus() : []; };
      var item = function (label) { var hit = null; M().forEach(function (m) { (m.items || []).forEach(function (x) { if (x && x.label === label) hit = x; }); }); return hit; };
      var run = function (label) { var x = item(label); if (x && !x.disabled && x.run) x.run(); };
      w.classList.add("io-kbhost");
      var nav = document.createElement("div");
      nav.className = "ios-ide-nav io-only";
      nav.innerHTML = fb("sidebar", "side", "", "文件") + '<div class="ios-ide-t"><b></b><small></small></div><span class="io-grpb">' + fb("run", "run", "ios-ide-run", "运行") + fb("more", "more", "", "更多") + "</span>";
      body.insertBefore(nav, rootEl);
      var scrim = document.createElement("div");
      scrim.className = "ios-ide-scrim io-only";
      rootEl.appendChild(scrim);
      var kb = document.createElement("div");
      kb.className = "ios-ide-kb io-only";
      kb.innerHTML = '<div class="ios-ide-keys">' + KEYS.map(function (k) { return '<button data-k="' + esc(k) + '">' + esc(k) + "</button>"; }).join("") +
        '<button data-k="←" class="ios-ide-arrow">←</button><button data-k="→" class="ios-ide-arrow">→</button><button data-k="↑" class="ios-ide-arrow">↑</button><button data-k="↓" class="ios-ide-arrow">↓</button></div>' +
        '<span class="ios-ide-kbr"><button data-u="undo">' + SYM.undo + '</button><button data-u="redo">' + SYM.redo + '</button><button data-u="hide">' + SYM.keyboardDown + "</button></span>";
      body.appendChild(kb);
      w.ioIde = { nav: nav, kb: kb, scrim: scrim };
      // ---- 标题：当前文件名 + 所在文件夹；没改存的前面一个点 ----
      function sync() {
        var on = rootEl.querySelector(".ide-tab.ide-on"), name = on ? on.querySelector(".ide-tn").textContent : "编辑器", dir = on ? (on.getAttribute("title") || "").replace(/\/[^/]*$/, "") || "/" : "";
        nav.querySelector(".ios-ide-t b").textContent = (on && on.classList.contains("ide-dirty") ? "● " : "") + name;
        nav.querySelector(".ios-ide-t small").textContent = dir;
        var r = item("运行当前文件");
        nav.querySelector('[data-act="run"]').disabled = !r || !!r.disabled;
      }
      new MutationObserver(sync).observe(rootEl.querySelector(".ide-tabs"), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
      sync();
      // ---- 抽屉 ----
      var side = rootEl.querySelector(".ide-side");
      function drawer(on) {
        if (on && side.hidden) run("资源管理器");
        w.classList.toggle("ios-drawer", !!on);
        if (on && document.activeElement && document.activeElement.blur) document.activeElement.blur();
      }
      w.ioIde.drawer = drawer;
      scrim.addEventListener("click", function () { drawer(false); });
      side.addEventListener("click", function (e) {
        var r = e.target.closest('.ide-row[data-d="0"], .ide-sres [data-p], .ide-sres [data-l]');
        if (r) setTimeout(function () { drawer(false); }, 120);
      });
      // 左边缘往右拖：拉出抽屉；抽屉里往左拖：收回去
      var sx = null;
      rootEl.addEventListener("pointerdown", function (e) { var r = rootEl.getBoundingClientRect(); sx = (e.clientX - r.left < 22 && !w.classList.contains("ios-drawer")) || w.classList.contains("ios-drawer") ? { x: e.clientX, y: e.clientY, open: w.classList.contains("ios-drawer") } : null; });
      rootEl.addEventListener("pointermove", function (e) {
        if (!sx) return;
        var dx = e.clientX - sx.x, dy = e.clientY - sx.y;
        if (Math.abs(dy) > 30 && Math.abs(dy) > Math.abs(dx)) { sx = null; return; }
        if (!sx.open && dx > 50) { sx = null; drawer(true); }
        else if (sx.open && dx < -50) { sx = null; drawer(false); }
      });
      rootEl.addEventListener("pointerup", function () { sx = null; });
      // 树上长按 = 右键菜单（编辑器自己的：新建、重新命名、删除……）：外壳把长按转成了 contextmenu，这里不用另管
      // ---- 导航栏按钮 ----
      nav.addEventListener("click", function (e) {
        var b = e.target.closest("[data-act]");
        if (!b || b.disabled) return;
        if (b.dataset.act === "side") drawer(!w.classList.contains("ios-drawer"));
        if (b.dataset.act === "run") { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); run("运行当前文件"); }
        if (b.dataset.act === "more") moreMenu(b);
      });
      function moreMenu(b) {
        var X = function (label, icon, as) { var x = item(label); return { label: as || label, icon: icon, disabled: !x || !!x.disabled, checked: x && x.checked ? true : undefined, run: function () { run(label); } }; };
        IO.menu(b, [
          { row: [X("保存", "save"), X("查找", "search"), X("打开…", "doc", "打开"), X("终端", "terminal")] },
          X("全部保存", null), X("撤销", "undo"), X("重做", "redo"),
          { sep: true },
          X("替换", null), X("在文件中查找", null), X("跳到行…", null), X("切换行注释", null), X("Markdown 预览", null),
          { sep: true },
          X("新建文件…", "compose", "新建文件"), X("新建文件夹…", "newFolder", "新建文件夹"), X("在访达中显示", "folder", "在“文件”中显示"), X("关闭标签页", "xmark"),
        ].map(function (x) { if (x.row) x.row = x.row.map(function (r) { return { label: r.label, icon: r.icon, disabled: r.disabled, run: r.run }; }); return x; }));
      }
      // ---- 键盘上面的符号键：插字走 execCommand（撤销记得住），⇥ 交给编辑器自己的 Tab 缩进，方向键挪光标 ----
      var ta = function () { var a = document.activeElement; return a && a.classList && a.classList.contains("ide-src") && rootEl.contains(a) ? a : null; };
      var lastTa = null;
      rootEl.addEventListener("focusin", function (e) { if (e.target.classList && e.target.classList.contains("ide-src")) { lastTa = e.target; w.classList.add("ios-typing"); setTimeout(IO.kbSync, 350); } });
      rootEl.addEventListener("focusout", function (e) { setTimeout(function () { if (!ta()) w.classList.remove("ios-typing"); }, 60); });
      kb.addEventListener("pointerdown", function (e) { e.preventDefault(); }); // 按键时不让文本框失去焦点
      kb.addEventListener("click", function (e) {
        var b = e.target.closest("[data-k], [data-u]"), t = ta() || lastTa;
        if (!b || !t) return;
        t.focus();
        if (b.dataset.u === "hide") { t.blur(); w.classList.remove("ios-typing"); return; }
        if (b.dataset.u) { document.execCommand(b.dataset.u); return; }
        var k = b.dataset.k, s = t.selectionStart, v = t.value;
        if (k === "⇥") { t.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); return; }
        if (k === "←" || k === "→") { var p = Math.max(0, Math.min(v.length, (k === "←" ? Math.min(s, t.selectionEnd) - (s === t.selectionEnd ? 1 : 0) : Math.max(s, t.selectionEnd) + (s === t.selectionEnd ? 1 : 0)))); t.setSelectionRange(p, p); t.dispatchEvent(new Event("select")); return; }
        if (k === "↑" || k === "↓") {
          var ls = v.lastIndexOf("\n", s - 1) + 1, col = s - ls, q;
          if (k === "↑") { if (!ls) q = 0; else { var ps = v.lastIndexOf("\n", ls - 2) + 1; q = Math.min(ps + col, ls - 1); } }
          else { var le = v.indexOf("\n", s); if (le < 0) q = v.length; else { var ne = v.indexOf("\n", le + 1); q = Math.min(le + 1 + col, ne < 0 ? v.length : ne); } }
          t.setSelectionRange(q, q); t.dispatchEvent(new Event("select")); return;
        }
        if (!document.execCommand("insertText", false, k)) { t.setRangeText(k, t.selectionStart, t.selectionEnd, "end"); t.dispatchEvent(new Event("input")); }
      });
    }
    function detach(w) {
      var s = w.ioIde;
      if (!s) return;
      s.nav.remove(); s.kb.remove(); s.scrim.remove();
      w.classList.remove("ios-drawer", "ios-typing");
      w.ioIde = null;
    }
    IO.register({ name: "ide", nonav: true, test: function (w) { return w.id === "ide"; }, attach: attach, detach: detach });
  })();
  // =====================================================================================================
  // 备忘录 / 提醒事项 / 日历共用：macOS 版的几栏（侧边栏 | 列表 | 内容）在手机上变成一层层推进去的整屏（同 iPhone），
  // 每屏顶上一排导航按钮、底下一条工具栏；左边缘往右划 = 返回。data-iosp = 现在在第几屏
  // =====================================================================================================
  // 轻点（不是长按、没拖动）某一类元素：手指抬起时就算，不等 click（App 可能在 mousedown 里把那一行重画掉了）
  function tapOn(host, sel, fn) {
    var st = null;
    host.addEventListener("pointerdown", function (e) { var t = e.target.closest(sel); st = t && e.button < 1 ? { t: t, x: e.clientX, y: e.clientY, at: Date.now() } : null; });
    host.addEventListener("pointermove", function (e) { if (st && Math.abs(e.clientX - st.x) + Math.abs(e.clientY - st.y) > 10) st = null; });
    host.addEventListener("pointercancel", function () { st = null; });
    host.addEventListener("pointerup", function (e) { var x = st; st = null; if (x && Date.now() - x.at < 450) fn(x.t, e); });
  }
  IO.tapOn = tapOn;
  // 几屏叠在一个 overflow 的盒子里：屏外的输入框拿到焦点时浏览器会把盒子横着卷过去，卷回来
  function pinScroll(el) { el.addEventListener("scroll", function () { if (el.scrollLeft || el.scrollTop) { el.scrollLeft = 0; el.scrollTop = 0; } }); }
  IO.pinScroll = pinScroll;
  // els(i)：第 i 屏是哪几个元素（拖着返回时，这一屏跟着手指走、上一屏从左边露出来）
  function screens(w, n, onGo, els) {
    var S = { i: 0, n: n };
    var mark = function () {
      if (!els) return;
      w.querySelectorAll(".ios-scr-cur, .ios-scr-prev").forEach(function (x) { x.classList.remove("ios-scr-cur", "ios-scr-prev"); });
      (els(S.i) || []).forEach(function (x) { if (x) x.classList.add("ios-scr-cur"); });
      if (S.i > 0) (els(S.i - 1) || []).forEach(function (x) { if (x) x.classList.add("ios-scr-prev"); });
    };
    S.go = function (i, o) {
      i = Math.max(0, Math.min(n - 1, i));
      if (i < S.i && document.activeElement && w.contains(document.activeElement) && document.activeElement.blur) document.activeElement.blur();
      var from = S.i;
      S.i = i;
      w.dataset.iosp = i;
      w.classList.toggle("io-canback", i > 0);
      mark();
      if (onGo) onGo(i, from, o || {});
    };
    w.dataset.iosp = 0;
    var grip = document.createElement("i");
    grip.className = "io-edgegrip ios-scrgrip io-only";
    (w.querySelector(".ma-root") || w.querySelector(".body")).appendChild(grip);
    S.grip = grip;
    // 左边缘往右划：回上一屏（跟手）
    var d = null;
    w.addEventListener("pointerdown", function (e) {
      if (S.i === 0 || e.button > 0 || !ios()) return;
      var r = w.getBoundingClientRect();
      if (e.clientX - r.left > 24) return;
      d = { x: e.clientX, y: e.clientY, on: false, id: e.pointerId };
    }, true);
    w.addEventListener("pointermove", function (e) {
      if (!d || e.pointerId !== d.id) return;
      var dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.on) { if (Math.abs(dy) > 14 && Math.abs(dy) > dx) { d = null; return; } if (dx < 12) return; d.on = true; w.classList.add("ios-dragging"); }
      w.style.setProperty("--ios-dx", Math.max(0, dx) + "px");
    }, true);
    var end = function (e) {
      if (!d || e.pointerId !== d.id) return;
      var on = d.on, dx = e.clientX - d.x;
      d = null;
      if (!on) return;
      eatClick = Date.now();
      w.classList.remove("ios-dragging");
      w.style.removeProperty("--ios-dx");
      if (e.type === "pointerup" && dx > w.offsetWidth * 0.3) S.go(S.i - 1);
    };
    w.addEventListener("pointerup", end, true);
    w.addEventListener("pointercancel", end, true);
    return S;
  }
  IO.screens = screens;
  var mk = function (tag, cls, html) { var e = document.createElement(tag); e.className = cls; if (html != null) e.innerHTML = html; return e; };
  var navRow = function (l, r, t) { return '<header class="io-nav ios-snav"><div class="io-nav-l">' + (l || "") + '</div><div class="io-nav-t">' + (t || "") + '</div><div class="io-nav-r">' + (r || "") + "</div></header>"; };
  // 手机上的搜索框（胶囊）：打字时把字填进 App 自己那个（藏在工具栏里的）搜索框，再发一次 input
  function proxySearch(real, ph) {
    var box = mk("div", "io-searchrow ios-psearch", '<label class="io-search">' + SYM.search + '<input type="search" placeholder="' + esc(ph || "搜索") + '" spellcheck="false" autocomplete="off" enterkeyhint="search">' +
      '<button class="io-sclear" hidden aria-label="清除">' + SYM.clear + '</button></label><button class="io-scancel" hidden>取消</button>');
    var inp = box.querySelector("input"), clr = box.querySelector(".io-sclear"), cancel = box.querySelector(".io-scancel");
    var push = function () { if (real.value !== inp.value) { real.value = inp.value; real.dispatchEvent(new Event("input", { bubbles: true })); } clr.hidden = !inp.value; };
    inp.addEventListener("input", push);
    inp.addEventListener("focus", function () { cancel.hidden = false; box.classList.add("on"); });
    inp.addEventListener("blur", function () { if (!inp.value) { cancel.hidden = true; box.classList.remove("on"); } });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
    clr.addEventListener("pointerdown", function (e) { e.preventDefault(); inp.value = ""; push(); inp.focus(); });
    cancel.addEventListener("click", function () { inp.value = ""; push(); cancel.hidden = true; box.classList.remove("on"); inp.blur(); });
    box.reset = function () { if (inp.value || real.value) { inp.value = ""; push(); } cancel.hidden = true; box.classList.remove("on"); };
    box.sync = function () { if (document.activeElement !== inp && inp.value !== real.value) { inp.value = real.value; clr.hidden = !inp.value; } };
    return box;
  }

  // ---- 备忘录：文件夹 → 备忘录列表（或画廊）→ 备忘录 ----
  (function notes() {
    function attach(w) {
      var N = window.TSU_NOTES;
      var side = w.querySelector(".ma-side"), main = w.querySelector(".ma-main"), tb = w.querySelector(".ma-tb");
      if (!N || !N.action || !side || !main) return;
      var lc = main.querySelector(".nt-lc"), ec = main.querySelector(".nt-ec"), ed = main.querySelector(".nt-ed"), acct = side.querySelector(".nt-acct");
      var acct0 = acct ? acct.textContent : "";
      if (acct) acct.textContent = "在我的 iPhone 上";
      w.classList.add("ios-nt");
      pinScroll(w.querySelector(".ma-root"));
      pinScroll(main);
      // 第一屏：文件夹
      var c0 = mk("div", "ios-mc ios-nt-c0 io-only", navRow() + '<nav class="io-toolbar ios-bt">' + fb("newFolder", "newf", "io-plain", "新建文件夹") + '<span class="io-flex"></span>' + fb("compose", "compose", "io-plain", "新建备忘录") + "</nav>");
      side.appendChild(c0);
      var lt0 = mk("h1", "io-lt ios-lt io-only", "文件夹");
      var sscroll = side.querySelector(".nt-sscroll");
      sscroll.insertBefore(lt0, sscroll.firstChild);
      // 第二屏：列表
      var c1 = mk("div", "ios-mc ios-nt-c1 io-only", navRow(fb("back", "back", "", "文件夹"), fb("more", "more", "", "更多")) +
        '<nav class="io-toolbar ios-bt"><span class="io-flex"></span><span class="ios-bt-t"></span><span class="io-flex"></span>' + fb("compose", "compose", "io-plain", "新建备忘录") + "</nav>");
      main.appendChild(c1);
      var srch = proxySearch(tb.querySelector(".ma-search input"), "搜索");
      srch.classList.add("io-only");
      lc.insertBefore(srch, lc.querySelector(".nt-list"));
      // 第三屏：备忘录
      var c2 = mk("div", "ios-mc ios-nt-c2 io-only", navRow(fb("back", "back", "", "备忘录"), fb("share", "share", "", "共享") + fb("more", "more", "", "更多") + '<button class="io-gb io-tint ios-done" data-act="done" aria-label="完成">' + SYM.check + "</button>") +
        '<nav class="io-toolbar ios-bt">' + fb("checklist", "checklist", "io-plain", "核对清单") + fb("format", "format", "io-plain", "格式") + fb("table", "table", "io-plain", "表格") + fb("camera", "media", "io-plain", "图片") +
        '<span class="io-flex"></span>' + fb("compose", "compose", "io-plain", "新建备忘录") + "</nav>");
      ec.appendChild(c2);
      var S = screens(w, 3, function (i, from) {
        if (from === 2 && i < 2 && N.flush) N.flush();
        if (i === 0) srch.reset();
        sync();
      }, function (i) { return i === 0 ? [side] : i === 1 ? [lc, main.querySelector(".nt-gallery"), c1] : [ec]; });
      function sync() {
        var st = N.state();
        c1.querySelector(".ios-bt-t").textContent = st.count + " 个备忘录";
        c1.querySelector(".io-nav-t").textContent = st.title;
        srch.sync();
      }
      new MutationObserver(sync).observe(lc.querySelector(".nt-lhead"), { childList: true, subtree: true, characterData: true });
      // 往里走：点文件夹 → 列表；点备忘录 / 画廊里的卡片 → 备忘录
      side.addEventListener("click", function (e) {
        if (e.target.closest("[data-disc], .renaming")) return;
        if (e.target.closest(".nt-f, [data-tag]")) setTimeout(function () { S.go(1); }, 0);
      });
      // 点备忘录：App 在 mousedown 时就打开它并重画列表（click 可能落不到那一行上），所以看手指抬起时点的是哪一行
      tapOn(main, ".nt-it, .nt-card", function () { if (S.i === 1) setTimeout(function () { S.go(2); }, 30); });
      // 按钮
      w.addEventListener("click", function (e) {
        var b = e.target.closest(".ios-mc [data-act]");
        if (!b || b.disabled) return;
        var a = b.dataset.act;
        if (a === "back") return S.go(S.i - 1);
        if (a === "compose") { N.action("compose", b); S.go(2); return; }
        if (a === "newf") { var nf = side.querySelector(".nt-newf"); if (nf) nf.click(); return; }
        if (a === "done") { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return; }
        if (a === "more" && S.i === 1) {
          var st = N.state();
          return IO.menu(b, [{ label: "以列表显示", icon: "list", checked: st.view !== "gallery", run: function () { N.setView("list"); } },
            { label: "以画廊显示", icon: "grid", checked: st.view === "gallery", run: function () { N.setView("gallery"); } }]);
        }
        if (a === "more" && S.i === 2) { // 这个备忘录的菜单：就是 App 自己的右键菜单（置顶、移到、删除……）
          var cur = N.current(), it = cur && main.querySelector('.nt-it[data-p="' + CSS.escape(cur) + '"]'), r = b.getBoundingClientRect();
          if (it) it.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.right - 250, clientY: r.bottom + 6 }));
          return;
        }
        N.action(a, b);
      });
      // 编辑中：右上角是「完成」
      ed.addEventListener("focus", function () { w.classList.add("ios-editing"); });
      ed.addEventListener("blur", function () { w.classList.remove("ios-editing"); });
      w.ioNotes = { S: S, acct: acct, acct0: acct0, parts: [c0, c1, c2, lt0, srch] };
      S.go(N.current() ? 2 : 1);
      sync();
    }
    function detach(w) {
      var s = w.ioNotes;
      if (!s) return;
      s.parts.forEach(function (p) { p.remove(); });
      if (s.S.grip) s.S.grip.remove();
      if (s.acct) s.acct.textContent = s.acct0;
      w.classList.remove("ios-nt", "ios-editing");
      delete w.dataset.iosp;
      w.ioNotes = null;
    }
    IO.register({ name: "notes", nonav: true, test: function (w) { return w.classList.contains("nt-win"); }, attach: attach, detach: detach });
  })();
  // ---- 提醒事项：首页（搜索、智能列表卡片、我的列表）→ 一个列表 ----
  (function reminders() {
    function attach(w) {
      var R = window.TSU_REMINDERS;
      var side = w.querySelector(".ma-side"), main = w.querySelector(".ma-main");
      if (!R || !R.action || !side || !main) return;
      w.classList.add("ios-rm");
      pinScroll(w.querySelector(".ma-root"));
      var PLUSC = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 7v10M7 12h10" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>';
      var c0 = mk("div", "ios-mc ios-rm-c0 io-only", '<nav class="ios-rm-bt"><button class="io-gb io-txt ios-rm-new" data-act="plus">' + PLUSC + "<span>新提醒事项</span></button>" +
        '<span class="io-flex"></span><button class="io-gb io-txt ios-rm-add" data-act="addlist">添加列表</button></nav>');
      side.appendChild(c0);
      var c1 = mk("div", "ios-mc ios-rm-c1 io-only", navRow(fb("back", "back", "", "列表"), fb("share", "share", "", "共享") + fb("more", "more", "", "更多")) +
        '<nav class="ios-rm-bt"><button class="io-gb io-txt ios-rm-new" data-act="plus">' + PLUSC + "<span>新提醒事项</span></button></nav>");
      main.appendChild(c1);
      // 搜索框旁边的「取消」；有字的时候结果就排在搜索框下面（同 iPhone）
      var real = side.querySelector(".ma-search input"), cancel = mk("button", "ios-rm-cancel io-only", "取消");
      side.querySelector(".rm-sside").appendChild(cancel);
      cancel.hidden = true;
      var syncSearch = function () { w.classList.toggle("ios-rm-searching", !!real.value.trim()); cancel.hidden = !(real.value || document.activeElement === real); };
      real.addEventListener("input", syncSearch);
      real.addEventListener("focus", syncSearch);
      real.addEventListener("blur", function () { setTimeout(syncSearch, 0); });
      cancel.addEventListener("pointerdown", function (e) { e.preventDefault(); real.value = ""; real.dispatchEvent(new Event("input", { bubbles: true })); real.blur(); syncSearch(); });
      var S = screens(w, 2, function (i) { if (i === 0) syncSearch(); }, function (i) { return i === 0 ? [side] : [main, c1]; });
      side.addEventListener("click", function (e) { if (e.target.closest(".rm-card, .rm-li") && !e.target.closest(".renaming")) setTimeout(function () { S.go(1); }, 0); });
      w.addEventListener("click", function (e) {
        var b = e.target.closest(".ios-mc [data-act]");
        if (!b || b.disabled) return;
        var a = b.dataset.act;
        if (a === "back") return S.go(0);
        if (a === "plus") { if (S.i === 0) S.go(1); setTimeout(function () { R.action("plus", b); }, S.i === 0 ? 0 : 0); return; }
        R.action(a, b);
      });
      w.ioRem = { S: S, parts: [c0, c1, cancel] };
      S.go(1);
    }
    function detach(w) {
      var s = w.ioRem;
      if (!s) return;
      s.parts.forEach(function (p) { p.remove(); });
      if (s.S.grip) s.S.grip.remove();
      w.classList.remove("ios-rm", "ios-rm-searching");
      delete w.dataset.iosp;
      w.ioRem = null;
    }
    IO.register({ name: "reminders", nonav: true, test: function (w) { return w.classList.contains("rm-win"); }, attach: attach, detach: detach });
  })();
  // ---- 日历：年 → 月（一个个月往下连着滚，有事件的日子下面一个点）→ 日（上面一周的日期条，下面是 App 自己的日视图：点空白新建、点事件看简介）----
  (function calendar() {
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var ymd = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
    var parseD = function (s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };
    var day0 = function (d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
    var addD = function (d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; };
    var WD = "日一二三四五六";
    function attach(w) {
      var C = window.TSU_CALENDAR, rootEl = w.querySelector(".ma-root"), side = w.querySelector(".ma-side"), main = w.querySelector(".ma-main");
      if (!C || !C.action || !rootEl || !main) return;
      w.classList.add("ios-cal");
      pinScroll(rootEl);
      var ws = function () { return C.state().weekStart || 0; };
      var selDate = day0(C.state().date || new Date());
      // ---- 年 ----
      var yearEl = mk("div", "ios-cal-scr ios-cal-year io-only", navRow("", '<span class="io-grpb">' + fb("plus", "plus", "", "新建事件") + "</span>") + '<div class="ios-cal-ys"></div>');
      // ---- 月 ----
      var monthEl = mk("div", "ios-cal-scr ios-cal-month io-only", navRow('<button class="io-gb io-txt ios-cal-back" data-act="toyear">' + SYM.back + "<span></span></button>",
        '<span class="io-grpb">' + fb("plus", "plus", "", "新建事件") + "</span>") + '<div class="ios-cal-wdh"></div><div class="ios-cal-ms"></div>' +
        '<nav class="io-toolbar ios-cal-bt"><button class="io-gb io-txt" data-act="today">今天</button><button class="io-gb io-txt" data-act="cals">日历</button><span class="ios-cal-btsp"></span></nav>');
      // ---- 日：App 自己的日视图上面加一条周日期、一行日期 ----
      var dayTop = mk("div", "ios-cal-daytop io-only", navRow('<button class="io-gb io-txt ios-cal-back" data-act="tomonth">' + SYM.back + "<span></span></button>",
        '<span class="io-grpb">' + fb("plus", "plus", "", "新建事件") + "</span>") + '<div class="ios-cal-wdh"></div><div class="ios-cal-strip"></div><div class="ios-cal-dline"></div>');
      var dayBt = mk("nav", "io-toolbar ios-cal-bt io-only", '<button class="io-gb io-txt" data-act="today">今天</button><button class="io-gb io-txt" data-act="cals">日历</button><span class="ios-cal-btsp"></span>');
      rootEl.appendChild(yearEl);
      rootEl.appendChild(monthEl);
      main.insertBefore(dayTop, main.firstChild);
      main.appendChild(dayBt);
      var sheetHead = mk("div", "ios-cal-sheethead io-only", '<span class="io-flex"></span><b>日历</b><span class="io-flex"></span><button class="io-gb io-txt io-bold" data-act="cals-done">完成</button>');
      side.insertBefore(sheetHead, side.firstChild);
      var scrim = mk("div", "ios-cal-scrim io-only", "");
      rootEl.appendChild(scrim);
      var S = screens(w, 3, function (i) {
        if (i === 2) { C.setView("day"); C.go(ymd(selDate)); renderStrip(); }
        if (i === 1) { renderMonths(); }
        if (i === 0) renderYears();
        syncBacks();
      }, function (i) { return i === 0 ? [yearEl] : i === 1 ? [monthEl] : [main]; });
      function wdHead() { var h = ""; for (var i = 0; i < 7; i++) { var k = (i + ws()) % 7; h += '<span class="' + (k === 0 || k === 6 ? "we" : "") + '">' + WD[k] + "</span>"; } return h; }
      function syncBacks() {
        monthEl.querySelector(".ios-cal-back span").textContent = (monthEl.dataset.y || selDate.getFullYear()) + "年";
        dayTop.querySelector(".ios-cal-back span").textContent = (selDate.getMonth() + 1) + "月";
      }
      // 有事件的日子：按月取一次
      var marks = {};
      function markOf(d) {
        var k = d.getFullYear() * 12 + d.getMonth();
        if (!marks[k]) {
          var m0 = new Date(d.getFullYear(), d.getMonth(), 1), m1 = new Date(d.getFullYear(), d.getMonth() + 1, 1), set = {};
          try { C.occurrences(m0, m1).forEach(function (o) { for (var x = day0(o.s); x < o.e && x < m1; x = addD(x, 1)) set[ymd(x)] = (set[ymd(x)] || 0) + 1; }); } catch (e) { /* 读不了就不打点 */ }
          marks[k] = set;
        }
        return marks[k][ymd(d)] || 0;
      }
      C.onChange(function () { marks = {}; if (S.i === 1) renderMonths(true); if (S.i === 2) renderStrip(); if (S.i === 0) renderYears(); });
      // ---- 月视图：前后各一年，滚到头再往外补 ----
      var span = { from: -12, to: 12 }, base = new Date();
      function monthHTML(y, m) {
        var first = new Date(y, m, 1), today = day0(new Date()), lead = (first.getDay() - ws() + 7) % 7, days = new Date(y, m + 1, 0).getDate(), lunar = C.state().lunar && C.lunar;
        var cur = y === today.getFullYear() && m === today.getMonth();
        var h = '<section class="ios-cm" data-ym="' + y + "-" + (m + 1) + '"><div class="ios-cm-t"><span style="grid-column:' + (lead + 1) + '" class="' + (cur ? "cur" : "") + '">' + (m + 1) + "月</span></div><div class=\"ios-cm-g\">";
        for (var i = 0; i < lead; i++) h += "<i></i>";
        for (var dd = 1; dd <= days; dd++) {
          var d = new Date(y, m, dd), cls = "ios-cd", lab = lunar ? C.lunar.label(d) : null, n = markOf(d);
          if (+d === +today) cls += " today";
          if (+d === +selDate) cls += " sel";
          if (d.getDay() === 0 || d.getDay() === 6) cls += " we";
          h += '<button class="' + cls + '" data-d="' + ymd(d) + '"><b>' + dd + "</b>" + (lab ? '<small class="' + lab.kind + '">' + esc(lab.text) + "</small>" : "") + (n ? "<i></i>" : "") + "</button>";
        }
        return h + "</div></section>";
      }
      var ms = monthEl.querySelector(".ios-cal-ms");
      function renderMonths(keep) {
        monthEl.querySelector(".ios-cal-wdh").innerHTML = wdHead();
        var top = ms.scrollTop, anchor = keep && ms.querySelector(".ios-cm"), h = "";
        for (var k = span.from; k <= span.to; k++) { var d = new Date(base.getFullYear(), base.getMonth() + k, 1); h += monthHTML(d.getFullYear(), d.getMonth()); }
        ms.innerHTML = h;
        if (keep) ms.scrollTop = top; else scrollToMonth(selDate, false);
        syncYear();
      }
      function scrollToMonth(d, smooth) {
        var sec = ms.querySelector('.ios-cm[data-ym="' + d.getFullYear() + "-" + (d.getMonth() + 1) + '"]');
        if (!sec) { span = { from: -12, to: 12 }; base = new Date(d.getFullYear(), d.getMonth(), 1); renderMonths(true); sec = ms.querySelector('.ios-cm[data-ym="' + d.getFullYear() + "-" + (d.getMonth() + 1) + '"]'); }
        if (sec) ms.scrollTo({ top: sec.offsetTop - 6, behavior: smooth ? "smooth" : "auto" });
      }
      function syncYear() {
        var secs = ms.querySelectorAll(".ios-cm"), y = null;
        for (var i = 0; i < secs.length; i++) { if (secs[i].offsetTop + secs[i].offsetHeight - 40 > ms.scrollTop) { y = secs[i].dataset.ym.split("-")[0]; break; } }
        if (y && monthEl.dataset.y !== y) { monthEl.dataset.y = y; syncBacks(); }
      }
      ms.addEventListener("scroll", function () {
        syncYear();
        if (ms.scrollTop < 400) { var h0 = ms.scrollHeight; span.from -= 6; renderMonths(true); ms.scrollTop += ms.scrollHeight - h0; }
        else if (ms.scrollTop + ms.clientHeight > ms.scrollHeight - 500) { span.to += 6; renderMonths(true); }
      }, { passive: true });
      ms.addEventListener("click", function (e) {
        var c = e.target.closest(".ios-cd");
        if (!c) return;
        selDate = parseD(c.dataset.d);
        ms.querySelectorAll(".ios-cd.sel").forEach(function (x) { x.classList.remove("sel"); });
        c.classList.add("sel");
        S.go(2);
      });
      // ---- 年视图 ----
      var ys = yearEl.querySelector(".ios-cal-ys");
      function renderYears() {
        var y0 = (monthEl.dataset.y ? +monthEl.dataset.y : selDate.getFullYear()), today = day0(new Date()), h = "";
        for (var y = y0 - 2; y <= y0 + 2; y++) {
          h += '<section class="ios-cy" data-y="' + y + '"><h2 class="' + (y === today.getFullYear() ? "cur" : "") + '">' + y + '年</h2><div class="ios-cy-g">';
          for (var m = 0; m < 12; m++) {
            var first = new Date(y, m, 1), lead = (first.getDay() - ws() + 7) % 7, days = new Date(y, m + 1, 0).getDate();
            h += '<button class="ios-cym" data-ym="' + y + "-" + (m + 1) + '"><b class="' + (y === today.getFullYear() && m === today.getMonth() ? "cur" : "") + '">' + (m + 1) + '月</b><span class="ios-cym-g">';
            for (var i = 0; i < lead; i++) h += "<i></i>";
            for (var dd = 1; dd <= days; dd++) h += "<i" + (y === today.getFullYear() && m === today.getMonth() && dd === today.getDate() ? ' class="t"' : "") + ">" + dd + "</i>";
            h += "</span></button>";
          }
          h += "</div></section>";
        }
        ys.innerHTML = h;
        var sec = ys.querySelector('.ios-cy[data-y="' + y0 + '"]');
        if (sec) ys.scrollTop = sec.offsetTop - 4;
      }
      ys.addEventListener("click", function (e) {
        var b = e.target.closest(".ios-cym");
        if (!b) return;
        var p = b.dataset.ym.split("-");
        selDate = new Date(+p[0], +p[1] - 1, 1);
        S.go(1);
        scrollToMonth(selDate, false);
      });
      // ---- 日视图上面的一周 ----
      var strip = dayTop.querySelector(".ios-cal-strip");
      function renderStrip() {
        dayTop.querySelector(".ios-cal-wdh").innerHTML = wdHead();
        var s0 = addD(selDate, -((selDate.getDay() - ws() + 7) % 7)), today = day0(new Date()), h = "";
        for (var i = 0; i < 7; i++) {
          var d = addD(s0, i);
          h += '<button class="ios-cd' + (+d === +today ? " today" : "") + (+d === +selDate ? " sel" : "") + (d.getDay() === 0 || d.getDay() === 6 ? " we" : "") + '" data-d="' + ymd(d) + '"><b>' + d.getDate() + "</b>" + (markOf(d) ? "<i></i>" : "") + "</button>";
        }
        strip.innerHTML = h;
        var l = C.state().lunar && C.lunar && C.lunar.full ? C.lunar.full(selDate) : "";
        dayTop.querySelector(".ios-cal-dline").textContent = selDate.getFullYear() + "年" + (selDate.getMonth() + 1) + "月" + selDate.getDate() + "日 星期" + WD[selDate.getDay()] + (l ? "  " + l : "");
        syncBacks();
      }
      function pick(d) { selDate = day0(d); C.go(ymd(selDate)); renderStrip(); }
      strip.addEventListener("click", function (e) { var c = e.target.closest(".ios-cd"); if (c) pick(parseD(c.dataset.d)); });
      // 周条左右划：上一周 / 下一周
      var sx = null;
      strip.addEventListener("pointerdown", function (e) { sx = { x: e.clientX, y: e.clientY }; });
      strip.addEventListener("pointerup", function (e) { if (!sx) return; var dx = e.clientX - sx.x; sx = null; if (Math.abs(dx) > 50) { eatClick = Date.now(); pick(addD(selDate, dx < 0 ? 7 : -7)); } });
      // ---- 按钮 ----
      function calsSheet(on) { w.classList.toggle("ios-cal-sheet", on); }
      scrim.addEventListener("click", function () { calsSheet(false); });
      w.addEventListener("click", function (e) {
        var b = e.target.closest(".ios-cal-scr [data-act], .ios-cal-daytop [data-act], .ios-cal-bt [data-act], .ios-cal-sheethead [data-act]");
        if (!b) return;
        var a = b.dataset.act;
        if (a === "toyear") S.go(0);
        if (a === "tomonth") { S.go(1); }
        if (a === "plus") { if (S.i < 2) { S.go(2); } C.action("plus", b); }
        if (a === "today") { selDate = day0(new Date()); if (S.i === 2) pick(selDate); else if (S.i === 1) { renderMonths(true); scrollToMonth(selDate, true); } else { S.go(1); } }
        if (a === "cals") calsSheet(true);
        if (a === "cals-done") calsSheet(false);
      });
      w.ioCal = { S: S, parts: [yearEl, monthEl, dayTop, dayBt, sheetHead, scrim] };
      S.go(1);
    }
    function detach(w) {
      var s = w.ioCal;
      if (!s) return;
      s.parts.forEach(function (p) { p.remove(); });
      if (s.S.grip) s.S.grip.remove();
      w.classList.remove("ios-cal", "ios-cal-sheet");
      delete w.dataset.iosp;
      w.ioCal = null;
    }
    IO.register({ name: "calendar", nonav: true, test: function (w) { return w.classList.contains("cal-win"); }, attach: attach, detach: detach });
  })();
  // =====================================================================================================
  // 表格 / 文稿 / 讲演：文稿窗口顶上是 iPhone 版 iWork 的那一排（返回 · 文稿名 · 撤销 · 格式 · 插入 · ⋯，讲演多一个播放），
  // 右边的检查器（格式）变成从底下升起来的半屏面板；文稿浏览器变成 iPhone 上的文稿管理器（最近使用 / 浏览，右上角 + 选模板，点一下就打开）
  // =====================================================================================================
  (function office() {
    var APPNAME = { numbers: "表格", pages: "文稿", keynote: "讲演" };
    var appOf = function (w) { var m = /ofc-win-(numbers|pages|keynote)/.exec(w.className) || /^(numbers|pages|keynote)/.exec(w.id); return m ? m[1] : ""; };
    var winObj = function (w) { return D.apps && D.apps[w.id]; };
    // 桌面风格的菜单项（label、run、items、sep、disabled、checked）：有外壳就用它的 iOS 菜单（子菜单点进去）；没有就用这里的
    function showMenu(anchor, items) {
      if (!items || !items.length) return;
      if (window.TSU_IOS && TSU_IOS.menu) return TSU_IOS.menu(items, { el: anchor });
      IO.menu(anchor, items.filter(function (x) { return x && (x.sep || x.run); }).map(function (x) { return x.sep ? { sep: true } : { label: x.label, disabled: x.disabled, checked: x.checked ? true : undefined, run: x.run }; }));
    }
    function attachDoc(w) {
      var W = winObj(w), app = appOf(w), body = w.querySelector(".body");
      if (!W || !W._ofc || !app) return;
      w.classList.add("ios-ofc");
      var head = mk("div", "ios-ofc-head io-only", '<div class="io-nav-l">' + fb("back", "back", "", APPNAME[app]) + '</div><div class="ios-ofc-t"></div><div class="io-nav-r"><span class="io-grpb">' +
        fb("undo", "undo", "", "撤销") + (app === "keynote" ? fb("play", "play", "", "播放") : "") + fb("brush", "format", "", "格式") + fb("plus", "insert", "", "插入") + fb("more", "more", "", "更多") + "</span></div>");
      body.insertBefore(head, body.firstChild.nextSibling && body.firstChild.classList.contains("bar") ? body.firstChild.nextSibling : body.firstChild);
      var doc = function () { return W._ofc && W._ofc.doc; };
      var tb = function (id) { var d = doc(); return d && d.view && (d.view.toolbar || []).find(function (x) { return x && x.id === id; }); };
      var menuItem = function (re) { var hit = null; (W.menus ? W.menus() : []).forEach(function (m) { (m.items || []).forEach(function (x) { if (!hit && x && x.label && re.test(x.label)) hit = x; }); }); return hit; };
      function sync() {
        var d = doc();
        head.querySelector(".ios-ofc-t").textContent = d ? d.label() : APPNAME[app];
        var u = menuItem(/^撤销/);
        head.querySelector('[data-act="undo"]').disabled = !u || !!u.disabled;
        var f = tb("format");
        head.querySelector('[data-act="format"]').classList.toggle("on", !!(f && f.on && f.on()));
      }
      var bar = w.querySelector(".bar");
      new MutationObserver(sync).observe(bar, { childList: true, subtree: true, characterData: true, attributes: true });
      new MutationObserver(sync).observe(W._ofc.root, { attributes: true, attributeFilter: ["class"] });
      // 文稿：装进窗口时按屏幕宽度缩放（手机上一整页的宽度放不下）
      var fitted = null;
      function fit() {
        var d = doc();
        if (!d || fitted === d || app !== "pages") return;
        fitted = d;
        var z = tb("zoom"), f = z && z.menu && z.menu().find(function (x) { return x && x.label === "适合宽度"; });
        if (f && f.run) setTimeout(function () { f.run(); }, 60);
      }
      new MutationObserver(function () { fit(); sync(); }).observe(W._ofc.root, { childList: true });
      fit();
      sync();
      head.addEventListener("click", function (e) {
        var b = e.target.closest("[data-act]");
        if (!b || b.disabled) return;
        var a = b.dataset.act, x;
        if (a === "back") { // 同 iPhone：回到文稿管理器（这份文稿关掉，已经自动存好）
          D.close(w.id);
          var n = 0, t = setInterval(function () { if (w.classList.contains("closed") || ++n > 60) { clearInterval(t); if (w.classList.contains("closed") && window.TSU_OFFICE) TSU_OFFICE.launch(app); } }, 50);
          return;
        }
        if (a === "undo") { x = menuItem(/^撤销/); if (x && x.run) x.run(); setTimeout(sync, 30); return; }
        if (a === "format") { x = tb("format"); if (x && x.run) x.run(); setTimeout(sync, 30); return; }
        if (a === "play") { x = tb("play"); if (x && x.run) x.run(); return; }
        if (a === "insert") {
          var items;
          if (app === "keynote") {
            var add = tb("addslide"), txt = tb("text"), shp = tb("shape"), med = tb("media");
            items = [add && { label: "新建幻灯片", items: add.menu() }, txt && { label: "文本框", run: txt.run }, shp && { label: "形状", items: shp.menu() }, med && { label: "图片", items: med.menu() }].filter(Boolean);
          } else if (app === "pages") {
            var ins = tb("insert"), tab = tb("table"), md = tb("media"), ln = tb("link"), pg = tb("addpage");
            items = (ins ? ins.menu() : []).concat([{ sep: true }, tab && { label: "表格", items: tab.menu() }, md && { label: "图片", items: md.menu() }, ln && { label: "链接", run: ln.run }, pg && { label: "分页", run: pg.run }].filter(Boolean));
          } else {
            var ins2 = tb("insert"), sheet = tb("sheet");
            items = (sheet ? [{ label: "新建工作表", run: sheet.run }, { sep: true }] : []).concat(ins2 ? ins2.menu() : []);
          }
          return showMenu(b, items);
        }
        if (a === "more") { if (window.TSU_IOS && TSU_IOS.appMenu) TSU_IOS.appMenu(W, b); return; }
      });
      w.ioOfc = { head: head };
    }
    function detachDoc(w) {
      if (!w.ioOfc) return;
      w.ioOfc.head.remove();
      w.classList.remove("ios-ofc");
      w.ioOfc = null;
    }
    // ---- 文稿浏览器 → 文稿管理器 ----
    function attachBr(w) {
      var br = w.querySelector(".ofc-br"), app = appOf(w) || (/^(numbers|pages|keynote)-browser$/.exec(w.id) || [])[1];
      if (!br) return;
      w.classList.add("ios-ofcbr");
      var main = br.querySelector(".ofc-br-main"), titleEl = br.querySelector(".ofc-br-title"), q = br.querySelector(".ofc-br-q");
      var go = function (k) { var it = br.querySelector('.ofc-br-it[data-go="' + CSS.escape(k) + '"]'); if (it) it.click(); };
      var docsDir = (br.querySelectorAll(".ofc-br-it[data-go^='/']")[0] || {}).dataset;
      docsDir = docsDir ? docsDir.go : "";
      var head = mk("div", "ios-ofcbr-head io-only", navRow('<button class="io-gb io-txt ios-ofcbr-cancel" data-act="cancel">取消</button>' + fb("back", "up", "ios-ofcbr-up", "上一级"),
        '<span class="io-grpb">' + fb("plus", "new", "", "新建") + fb("more", "more", "", "更多") + "</span>"));
      main.insertBefore(head, main.firstChild);
      var tabs = mk("nav", "io-tabbar ios-ofcbr-tabs io-only", '<button data-tab="recent">' + SYM.clock + '<span>最近使用</span></button><button data-tab="browse">' + SYM.folderFill + "<span>浏览</span></button>");
      main.appendChild(tabs);
      function mode() { var t = titleEl.textContent; return t === "选取模板" ? "new" : t === "最近使用" ? "recent" : "browse"; }
      var last = "recent";
      function sync() {
        var m = mode();
        if (m !== "new") last = m;
        w.dataset.iosbr = m;
        tabs.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === m); });
        head.querySelector(".ios-ofcbr-up").hidden = m !== "browse" || br.querySelector(".ofc-br-back").hidden;
        head.querySelector(".ios-ofcbr-cancel").hidden = m !== "new";
      }
      new MutationObserver(sync).observe(titleEl, { childList: true, characterData: true, subtree: true });
      sync();
      tabs.addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (b) go(b.dataset.tab === "recent" ? "recent" : docsDir); });
      head.addEventListener("click", function (e) {
        var b = e.target.closest("[data-act]");
        if (!b) return;
        var a = b.dataset.act;
        if (a === "new") go("new");
        if (a === "cancel") go(last === "browse" ? docsDir : "recent");
        if (a === "up") br.querySelector(".ofc-br-back").click();
        if (a === "more") IO.menu(b, [{ label: "从电脑导入…", icon: "download", run: function () { br.querySelector('[data-k="import"]').click(); } }]);
      });
      // 点一下就打开（桌面上是选中、双击打开）
      tapOn(br.querySelector(".ofc-br-grid"), ".ofc-br-card", function (card) { setTimeout(function () { card.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); }, 0); });
      w.ioOfcBr = { head: head, tabs: tabs };
    }
    function detachBr(w) {
      if (!w.ioOfcBr) return;
      w.ioOfcBr.head.remove(); w.ioOfcBr.tabs.remove();
      w.classList.remove("ios-ofcbr");
      delete w.dataset.iosbr;
      w.ioOfcBr = null;
    }
    IO.register({ name: "office-doc", nonav: true, test: function (w) { return w.classList.contains("ofc-win") && !w.classList.contains("ofc-brwin"); }, attach: attachDoc, detach: detachDoc });
    IO.register({ name: "office-br", nonav: true, test: function (w) { return w.classList.contains("ofc-brwin"); }, attach: attachBr, detach: detachBr });
  })();
  // =====================================================================================================
  // 传输：顶上一个 iOS 的分段控件（下载到本机 / 上传到沙盒）；手机上没有拖放，说明换成手机上的做法；按钮是胶囊
  // =====================================================================================================
  (function transfer() {
    var TEXT = {
      down: ["还没有要下载的项目", "在「文件」里长按项目，选「共享」→「添加到“传输”」，再打包下载到这台 iPhone", ""],
      up: ["上传到沙盒", "选取这台 iPhone 上的文件，放进沙盒的 ~/上传", ""],
    };
    function attach(w) {
      var ex = w.querySelector(".ex"), seg0 = w.querySelector(".ex-seg"), body = w.querySelector(".body");
      if (!ex || !seg0) return;
      w.classList.add("ios-ex");
      var nav = mk("div", "ios-ex-nav io-only", '<div class="ios-seg"><button data-tab="down">下载到本机</button><button data-tab="up">上传到沙盒</button></div>');
      body.insertBefore(nav, ex);
      var sync = function () { nav.querySelectorAll("[data-tab]").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === ex.dataset.tab); }); nav.querySelector(".ios-seg").dataset.on = ex.dataset.tab; };
      new MutationObserver(sync).observe(ex, { attributes: true, attributeFilter: ["data-tab"] });
      sync();
      nav.addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (b) { var o = seg0.querySelector('[data-tab="' + b.dataset.tab + '"]'); if (o) o.click(); } });
      // 说明文字换成手机上的；原来的记着，回到桌面时放回去
      var saved = [];
      ["down", "up"].forEach(function (k) {
        var z = ex.querySelector(".ex-" + k + " .ex-zone-in");
        if (!z) return;
        ["b", "small", "em"].forEach(function (t, i) { var n = z.querySelector(t); if (n) { saved.push([n, n.textContent]); n.textContent = TEXT[k][i]; } });
      });
      var openUp = ex.querySelector('[data-a="open-up"]');
      if (openUp) { saved.push([openUp, openUp.textContent]); openUp.textContent = "在“文件”中打开"; }
      w.ioEx = { nav: nav, saved: saved };
    }
    function detach(w) {
      var s = w.ioEx;
      if (!s) return;
      s.nav.remove();
      s.saved.forEach(function (x) { x[0].textContent = x[1]; });
      w.classList.remove("ios-ex");
      w.ioEx = null;
    }
    IO.register({ name: "transfer", nonav: true, test: function (w) { return w.id === "export"; }, attach: attach, detach: detach });
  })();
})();
