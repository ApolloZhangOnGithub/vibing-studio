// ext.js —— 连接器、外壳、扩展（三样东西分开）：
//   连接器（connector）：agent / 会话实际在哪里跑——Paimon（内置）、Claude Code（这台 Mac 上的 claude）、Codex（这台 Mac 上的 codex）。
//     在「设置 › 连接器」里开关；没设过的：这台 Mac 上找得到命令就开着。开没开记在 Studio 的设置里（studio.json 的 connectors；
//     以前「扩展」里装的 Claude Code 记在 extensions，照认）。
//   外壳（wrapper）：会话怎么显示——TUI 下面一种种（Claude Code 风格，默认装着）、GUI 下面一种种（Claude App 风格）；
//     任何连接器的会话都能用任何外壳看（Codex 的会话也能用 Claude Code 风格的 TUI 看）。live.js、gui.js 往 TSU_WRAPPERS 里登记自己。
//   扩展（extension）：真正额外装的东西（现在没有）；TSU_EXT 还在，旧代码问 TSU_EXT.on("claude-code") 的照样回答（转给连接器）
(function () {
  "use strict";
  var en = function () { if (window.TSU_I18N && TSU_I18N.lang) return TSU_I18N.lang() === "en"; try { return (JSON.parse(localStorage.getItem("st-settings") || "{}") || {}).lang === "en"; } catch (e) { return false; } };
  var settings = function () { try { return JSON.parse(localStorage.getItem("st-settings") || "{}") || {}; } catch (e) { return {}; } };
  // Claude 的标志（Claude 自己的那个，不是画出来的星星）：Claude Code 连接器在哪儿都用它——树、标签页、边栏、Finder、连接器设置。
  //   这是连接器，里面跑的就是 Claude Code 本身，不用山寨图标
  var CLAUDE_D = "m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z";
  // 派蒙（Paimon 自己的 agent、Paimon 连接器）：派蒙的头像（terminal-icon.png，64×64），哪儿代表 Paimon 就用它——不用星星
  var PM_PATH = "img/paimon.png", PM_SRC = PM_PATH; // 派蒙（用户给的那一只：闭着眼、头上光环；192×192，透明底，不裁）
  // 连接器的图标：同 macOS App 图标的形状（超椭圆 n=5 的「连续圆角」，不是普通圆角矩形），记号的比例照各自 App 图标量出来的
  var SQ_D = "M64.0 32.0 L63.97 42.75 L63.89 46.17 L63.75 48.64 L63.56 50.64 L63.31 52.32 L63.0 53.79 L62.64 55.09 L62.21 56.25 L61.72 57.3 L61.17 58.24 L60.55 59.09 L59.86 59.86 L59.09 60.55 L58.24 61.17 L57.3 61.72 L56.25 62.21 L55.09 62.64 L53.79 63.0 L52.32 63.31 L50.64 63.56 L48.64 63.75 L46.17 63.89 L42.75 63.97 L32.0 64.0 L21.25 63.97 L17.83 63.89 L15.36 63.75 L13.36 63.56 L11.68 63.31 L10.21 63.0 L8.91 62.64 L7.75 62.21 L6.7 61.72 L5.76 61.17 L4.91 60.55 L4.14 59.86 L3.45 59.09 L2.83 58.24 L2.28 57.3 L1.79 56.25 L1.36 55.09 L1.0 53.79 L0.69 52.32 L0.44 50.64 L0.25 48.64 L0.11 46.17 L0.03 42.75 L0.0 32.0 L0.03 21.25 L0.11 17.83 L0.25 15.36 L0.44 13.36 L0.69 11.68 L1.0 10.21 L1.36 8.91 L1.79 7.75 L2.28 6.7 L2.83 5.76 L3.45 4.91 L4.14 4.14 L4.91 3.45 L5.76 2.83 L6.7 2.28 L7.75 1.79 L8.91 1.36 L10.21 1.0 L11.68 0.69 L13.36 0.44 L15.36 0.25 L17.83 0.11 L21.25 0.03 L32.0 0.0 L42.75 0.03 L46.17 0.11 L48.64 0.25 L50.64 0.44 L52.32 0.69 L53.79 1.0 L55.09 1.36 L56.25 1.79 L57.3 2.28 L58.24 2.83 L59.09 3.45 L59.86 4.14 L60.55 4.91 L61.17 5.76 L61.72 6.7 L62.21 7.75 L62.64 8.91 L63.0 10.21 L63.31 11.68 L63.56 13.36 L63.75 15.36 L63.89 17.83 L63.97 21.25Z";
  // pi（pi coding agent，pi.dev）：它自己的标志——粉、蓝、黄三块拼成（用户给的原图，470×470；彩色，不跟字色）。不是圆周率的 π
  var PI_MARK = '<path fill="#F09082" d="M0 0H352.07V234.71H234.71V117.36H0Z"/><path fill="#4D9ABF" d="M0 117.36H117.36V234.71H234.71V352.07H117.36V469.43H0Z"/><path fill="#F1BE58" d="M352.07 234.71H469.43V469.43H352.07V234.71Z"/>';
  // Teyvat：提瓦特这颗星球（用户给的图，裁成圆、透明底，256×256；暂用）——同派蒙的头像一样是图（class 同 pm-av：各处给派蒙头像定的大小、灰掉照样适用）
  var TY_PATH = "img/teyvat.png", TY_SRC = TY_PATH;
  var OAI_D = "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z";
  window.TSU_LOGOS = { agy: '<svg class="agy-logo" viewBox="0 0 6 6" aria-hidden="true"><g transform="translate(0 .5)"><path fill="#e49746" d="M2 0h1v1h-1z"/><path fill="#e17946" d="M3 0h1v1h-1z"/><path fill="#a6c259" d="M1 1h1v1h-1z"/><path fill="#d79d4f" d="M2 1h1v1h-1z"/><path fill="#e68246" d="M3 1h1v1h-1z"/><path fill="#dd604b" d="M4 1h1v1h-1z"/><path fill="#8cc060" d="M1 2h1v1h-1z"/><path fill="#6fa690" d="M2 2h1v1h-1z"/><path fill="#7370bd" d="M3 2h1v1h-1z"/><path fill="#9160a4" d="M4 2h1v1h-1z"/><path fill="#7ac183" d="M1 3h1v1h-1z"/><path fill="#577fe2" d="M4 3h1v1h-1z"/><path fill="#7ab7ef" d="M0 4h1v1h-1z"/><path fill="#78b4f1" d="M1 4h1v1h-1z"/><path fill="#4d81f1" d="M4 4h1v1h-1z"/><path fill="#5083f4" d="M5 4h1v1h-1z"/></g></svg>', claudePath: CLAUDE_D, claude: '<svg class="cc-logo-svg" viewBox="0 0 100 101" aria-hidden="true"><path fill="currentColor" d="' + CLAUDE_D + '"/></svg>',
    dsh: '<svg class="dsh-logo" viewBox="0 0 128 128" aria-hidden="true"><image href="data:image/png;base64,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" width="128" height="128"/></svg>',
    paimonSrc: PM_SRC, paimon: '<img class="pm-av" src="' + PM_SRC + '" alt="" draggable="false">',
    // Codex：ChatGPT / OpenAI 的结（Codex 自己那朵紫蓝的云不好看；用户定的），单色跟着字色；oaiPath 给别处画大图标用
    oaiPath: OAI_D,
    codex: '<svg class="cx-logo-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + OAI_D + '"/></svg>',
    // pi：它自己的标志（彩色的三块，见上面 PI_MARK）
    pi: '<svg class="cx-logo-svg pi-logo-svg" viewBox="0 0 470 470" aria-hidden="true">' + PI_MARK + "</svg>",
    teyvatSrc: TY_SRC, teyvat: '<img class="pm-av ty-av" src="' + TY_SRC + '" alt="" draggable="false">' };
  // 派蒙的图只要一次：读进内存变成 blob: 地址，到处用这一个（左边的树、标签页、连接器的方块、设置）——
  //   以前每画一次都按路径重新要（App 里本地界面文件一律不缓存），连接器页面的派蒙一闪一闪、要等一下才出来。keep：留一张解码好的，别被回收
  var pmKeep = null, tyKeep = null;
  try {
    fetch(PM_PATH).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) {
      if (!b) return;
      var u = URL.createObjectURL(b);
      pmKeep = new Image(); pmKeep.decoding = "async"; pmKeep.src = u;
      var swap = function (h) { return String(h).split('href="' + PM_SRC + '"').join('href="' + u + '"').split('src="' + PM_SRC + '"').join('src="' + u + '"'); };
      CONN.forEach(function (c) { if (c.logo) c.logo = swap(c.logo); });
      PM_SRC = u; window.TSU_LOGOS.paimonSrc = u; window.TSU_LOGOS.paimon = '<img class="pm-av" src="' + u + '" alt="" draggable="false">';
      document.dispatchEvent(new Event("tsu-logos"));
    }, function () {});
    fetch(TY_PATH).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) {
      if (!b) return;
      var u = URL.createObjectURL(b);
      tyKeep = new Image(); tyKeep.decoding = "async"; tyKeep.src = u;
      var swap = function (h) { return String(h).split('href="' + TY_SRC + '"').join('href="' + u + '"').split('src="' + TY_SRC + '"').join('src="' + u + '"'); };
      CONN.forEach(function (c) { if (c.logo) c.logo = swap(c.logo); });
      TY_SRC = u; window.TSU_LOGOS.teyvatSrc = u; window.TSU_LOGOS.teyvat = '<img class="pm-av ty-av" src="' + u + '" alt="" draggable="false">';
      document.dispatchEvent(new Event("tsu-logos"));
    }, function () {});
  } catch (e) { /* 读不到就照旧按路径 */ }
  // ======== 连接器 ========
  // 每个：id、名字、desc、logo、cmd（这台 Mac 上要有的命令；内置的没有）、builtin；详情页（extview.js）用的字段同以前的扩展
  var CONN = [
    { id: "claude-code", name: "Claude Code", icon: "", desc: "本机 Claude Code 的会话：会话目录、会话记录、搜索与设置",
      descEn: "Claude Code sessions on this Mac: session tree, transcripts, search, and settings",
      publisher: "Vibing Studio", publisherId: "vibing-studio", verified: true, domain: "claude.com", homepage: "https://claude.com/product/claude-code", // 连接的是 Claude Code：写它的官网（做连接器的是本 Studio）
      version: "0.2.0", updated: "2026-09-27", builtin: true, files: ["studio/claude.js"], settings: "claude",
      logo: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="ccTileG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#db7a5a"/><stop offset="1" stop-color="#d5704f"/></linearGradient></defs><path d="' + SQ_D + '" fill="url(#ccTileG)"/><g transform="translate(8.8 8.55) scale(.464)"><path fill="#fffcfa" d="' + CLAUDE_D + '"/></g></svg>', // 同 Claude App 的图标：橙底（#D97757）白星，星占 72%
      categories: [{ zh: "AI", en: "AI" }, { zh: "聊天", en: "Chat" }],
      links: [{ zh: "Claude Code 文档", en: "Claude Code Docs", url: "https://docs.claude.com/en/docs/claude-code/overview" }, { zh: "设置文件", en: "Settings File", file: "~/.claude/settings.json" }],
      readme: {
        zh: "# Claude Code\n\n在 Vibing Studio 里使用这台 Mac 上的 Claude Code：会话、记录、搜索和设置都在 Studio 里，不用切到终端去找。\n\n" +
          "## 功能\n\n" +
          "- **会话目录树**：主侧栏里的「Claude Code」一组，按项目目录列出这台 Mac 上的全部会话，点一下打开。\n" +
          "- **会话记录**：`local.claude:` 地址打开一段会话的记录，在 Studio 里阅读、搜索。\n" +
          "- **搜索**：「搜索」视图连同 Claude Code 的会话一起找。\n" +
          "- **设置**：「设置 › Claude Code」修改 `~/.claude/settings.json`（主题、推理强度、默认权限模式……）；第一次修改前留一份备份 `settings.json.paimon-bak`。\n" +
          "- **状态**：运行中的会话的状态、任务清单、上下文用量显示在状态栏或辅助侧栏。\n\n" +
          "## 要求\n\n" +
          "- 这台 Mac 上装有 Claude Code（`claude` 命令）。\n" +
          "- 在 Vibing Studio App 中使用：网页版读不到本机的会话文件。\n",
        en: "# Claude Code\n\nUse the Claude Code sessions on this Mac inside Vibing Studio: sessions, transcripts, search and settings all live in the Studio, no terminal hunting.\n\n" +
          "## Features\n\n" +
          "- **Session tree**: the \"Claude Code\" group in the Primary Side Bar lists every session on this Mac by project folder; click one to open it.\n" +
          "- **Transcripts**: `local.claude:` addresses open a session's transcript, readable and searchable right in the Studio.\n" +
          "- **Search**: the Search view includes Claude Code sessions.\n" +
          "- **Settings**: \"Settings › Claude Code\" edits `~/.claude/settings.json` (theme, reasoning effort, default permission mode…); a backup `settings.json.paimon-bak` is kept before the first change.\n" +
          "- **Status**: status, task list and context usage of running sessions show in the Status Bar or the Secondary Side Bar.\n\n" +
          "## Requirements\n\n" +
          "- Claude Code installed on this Mac (the `claude` command).\n" +
          "- Use it in the Vibing Studio app: the web version can't read local session files.\n",
      },
      features: {
        commands: [
          { zh: "新建 Claude Code 会话", en: "New Claude Code Session", where: "文件菜单、主侧栏的 ···", whereEn: "File menu, Primary Side Bar ···" },
          { zh: "刷新 Claude Code 会话", en: "Refresh Claude Code Sessions", where: "主侧栏的 ···", whereEn: "Primary Side Bar ···" },
          { zh: "设置：Claude Code", en: "Settings: Claude Code", where: "命令面板", whereEn: "Command Palette" },
          { zh: "打开 Claude Code 的 settings.json", en: "Open Claude Code settings.json", where: "命令面板", whereEn: "Command Palette" },
        ],
        settings: [
          { key: "theme", zh: "主题", en: "Theme" }, { key: "tui", zh: "界面", en: "Interface" }, { key: "editorMode", zh: "输入框编辑模式", en: "Input Editing Mode" },
          { key: "spinnerTipsEnabled", zh: "加载时显示提示", en: "Show Tips While Loading" }, { key: "prefersReducedMotion", zh: "减少动画", en: "Reduce Motion" },
          { key: "effortLevel", zh: "推理强度", en: "Reasoning Effort" }, { key: "preferredNotifChannel", zh: "通知", en: "Notifications" },
          { key: "permissions.defaultMode", zh: "默认权限模式", en: "Default Permission Mode" }, { key: "autoMemoryEnabled", zh: "自动记忆", en: "Auto Memory" },
        ],
        views: [
          { zh: "Claude Code 会话目录树", en: "Claude Code session tree", where: "主侧栏", whereEn: "Primary Side Bar" },
          { zh: "状态、任务清单、上下文", en: "Status, task list, context", where: "状态栏或辅助侧栏", whereEn: "Status Bar or Secondary Side Bar" },
        ],
        addresses: [{ pat: "local.claude:<账号>/<会话>", patEn: "local.claude:<account>/<session>", zh: "打开一段 Claude Code 会话", en: "Open a Claude Code session" }],
      } },
    { id: "codex", name: "Codex", settings: "connectors/codex", icon: "◎", cmd: "codex", desc: "在 Vibing Studio 中使用 Codex，可继续任意会话", descEn: "Work with Codex in Vibing Studio: pick up any session and keep going",
      publisher: "Vibing Studio", publisherId: "vibing-studio", verified: true, domain: "openai.com", homepage: "https://openai.com/codex/", version: "0.1.0", updated: "2026-09-28", builtin: true, files: ["studio/codex.js"], // 同上：Codex 的官网
      logo: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="' + SQ_D + '" fill="#fff"/><path d="' + SQ_D + '" fill="none" stroke="#000" stroke-opacity=".1" stroke-width=".8"/><g transform="translate(12.4 12.4) scale(1.633)"><path fill="#0d0d0d" d="' + OAI_D + '"/></g></svg>', // 同 ChatGPT App 的图标：白底黑结，结占 62%
      categories: [{ zh: "AI", en: "AI" }, { zh: "聊天", en: "Chat" }],
      links: [{ zh: "Codex 文档", en: "Codex Docs", url: "https://developers.openai.com/codex" }, { zh: "设置文件", en: "Settings File", file: "~/.codex/config.toml" }],
      readme: {
        zh: "# Codex\n\n在 Vibing Studio 里看、接着用这台 Mac 上的 Codex 会话（`~/.codex/sessions`）。会话用你选的外壳显示——比如 Claude Code 风格的 TUI。\n\n## 功能\n\n- **会话列表**：侧栏、Agent Finder 里列出这台 Mac 上的 Codex 会话。\n- **记录**：`local.codex:<会话>` 打开一段会话；它在别处跑，这里跟着读新写进来的。\n- **接着说**：`codex exec resume <会话>`；它正开在 Codex 里时用 `codex queue` 排进去。\n\n## 要求\n\n- 这台 Mac 上装有 Codex（`codex` 命令）。\n",
        en: "# Codex\n\nRead and continue the Codex sessions on this Mac (`~/.codex/sessions`) inside Vibing Studio, shown with the wrapper you choose — for example the Claude Code style TUI.\n\n## Features\n\n- **Sessions**: the side bar and Agent Finder list the Codex sessions on this Mac.\n- **Transcripts**: `local.codex:<session>` opens a session; while it runs elsewhere, new output streams in.\n- **Keep talking**: `codex exec resume <session>`; when it's open in Codex, messages are queued with `codex queue`.\n\n## Requirements\n\n- Codex installed on this Mac (the `codex` command).\n" } },
    { id: "pi", name: "pi", icon: "", cmd: "pi", third: true, desc: "在 Vibing Studio 中使用 pi：这台电脑上的 pi 会话都能接着说", descEn: "Work with pi in Vibing Studio: pick up any pi session on this computer and keep going",
      publisher: "Vibing Studio", publisherId: "vibing-studio", verified: true, domain: "pi.dev", homepage: "https://github.com/earendil-works/pi", version: "0.1.0", updated: "2026-10-07", builtin: false, files: ["studio/pi.js"],
      logo: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="' + SQ_D + '" fill="#fff"/><g transform="translate(17 17) scale(0.0639)">' + PI_MARK + "</g></svg>", // 白底上 pi 自己的彩色标志
      categories: [{ zh: "AI", en: "AI" }, { zh: "聊天", en: "Chat" }],
      links: [{ zh: "pi 的源代码", en: "pi on GitHub", url: "https://github.com/earendil-works/pi" }, { zh: "设置文件", en: "Settings File", file: "~/.pi/agent/settings.json" }],
      readme: {
        zh: "# pi\n\n在 Vibing Studio 里看、接着用这台电脑上的 pi 会话（`~/.pi/agent/sessions`）。会话用你选的外壳显示——比如 Claude Code 风格的 TUI。\n\n## 功能\n\n- **会话列表**：主侧栏「pi」一组按目录列出这台电脑上的 pi 会话；Agent Finder 里也有。\n- **记录**：读 pi 的记录（一棵树：/tree 回到前面接着说会分出一支），只画现在这一支；它在终端里跑时，这里跟着读新写进来的。\n- **接着说**：`pi -p --mode json --session <记录>`；新会话 `pi --session-id <id>`，在你选的目录里建。\n- **打断**：Esc 停掉这边起的那一问。\n\n## 要求\n\n- 这台电脑上装有 pi（`pi` 命令），并且已经在 pi 里设好模型和登录。\n",
        en: "# pi\n\nRead and continue the pi sessions on this computer (`~/.pi/agent/sessions`) inside Vibing Studio, shown with the wrapper you choose — for example the Claude Code style TUI.\n\n## Features\n\n- **Sessions**: the \"pi\" group in the Primary Side Bar lists pi sessions by folder; Agent Finder lists them too.\n- **Transcripts**: pi stores a session as a tree (going back with /tree starts a new branch); only the current branch is shown, and new output streams in while it runs in a terminal.\n- **Keep talking**: `pi -p --mode json --session <file>`; new sessions use `pi --session-id <id>` in the folder you choose.\n- **Interrupt**: Esc stops a turn started here.\n\n## Requirements\n\n- pi installed on this computer (the `pi` command), with a model and sign-in set up in pi.\n",
      },
      features: {
        commands: [{ zh: "新建 pi 会话", en: "New pi Session", where: "主侧栏「pi」一组的标题行", whereEn: "pi group header in the Primary Side Bar" }],
        views: [{ zh: "pi 会话目录树", en: "pi session tree", where: "主侧栏", whereEn: "Primary Side Bar" }],
      } },
    { id: "dsh", name: "DeepSeek Harness", cmd: "dsh", logo: window.TSU_LOGOS.dsh, third: true, settings: "connectors/dsh", version: "0.1.0", publisher: "Vibing Studio",
      desc: "按工作目录查看和继续本机 DSH 会话", descEn: "Browse and continue local DSH sessions by workspace" },
    { id: "agy", name: "Google Antigravity", cmd: "agy", readme: { zh: "在左侧 Agents 中展开 Google Antigravity，点击会话标题即可查看对话。会话从本机 JSONL 记录加载。", en: "Expand Google Antigravity in Agents and select a session to read its transcript from local JSONL files." }, settings: "connectors/agy", version: "0.1.0", logo: window.TSU_LOGOS.agy, builtin: true, desc: "查看本机会话记录", descEn: "Read local session transcripts", homepage: "https://antigravity.google/", publisher: "Vibing Studio" },
    { id: "teyvat", name: "Teyvat", icon: "", cmd: "genshin", third: true, desc: "在 Vibing Studio 中使用 Teyvat：这台电脑上的 Teyvat agent 都能看，后台运行的能直接对话", descEn: "Work with Teyvat in Vibing Studio: see every Teyvat agent on this computer and talk to the ones running in the background",
      publisher: "Vibing Studio", publisherId: "vibing-studio", verified: true, domain: "paimon.beer", homepage: "https://paimon.beer", version: "0.1.0", updated: "2026-10-13", builtin: false, files: ["studio/teyvat.js"],
      logo: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="' + SQ_D + '" fill="#0a1424"/><image href="' + TY_SRC + '" x="7" y="7" width="50" height="50"/></svg>', // 深蓝底上一颗提瓦特
      categories: [{ zh: "AI", en: "AI" }, { zh: "聊天", en: "Chat" }],
      links: [{ zh: "数据目录", en: "Data Folder", file: "~/.teyvat" }, { zh: "设置文件", en: "Settings File", file: "~/.teyvat/config/settings.json" }],
      readme: {
        zh: "# Teyvat\n\n在 Vibing Studio 里看、接着用这台电脑上的 Teyvat agent（`~/.teyvat`）。不改 Teyvat 自己的文件，只读它的数据、用它自己的后台通道说话。\n\n## 功能\n\n- **Agent 列表**：主侧栏「Teyvat」一组列出没有归档的 agent，写着它在哪儿跑（前台 / 后台）、在做什么（工作中、等待中、休眠中、已暂停）。\n- **记录**：读它的记录（每次启动一份，往上翻接着读更早的），工具、通知照它自己的画法画：Execute 的标题和结果、Wait 等了多久、休眠的说明、Agent 之间的消息、Life Restarted。\n- **对话**：后台运行的 agent 直接对话（同它自己的 web-tui：从它的后台命令通道递 prompt，Esc 打断）；没在运行的先在后台启动（`genshin bg`）；在终端里运行（前台）的只能看——在它的终端里按 Ctrl+C 转到后台后就能在这里说。\n\n## 要求\n\n- 这台电脑上装了 Teyvat（`genshin` 命令）。",
        en: "# Teyvat\n\nRead and continue the Teyvat agents on this computer (`~/.teyvat`) inside Vibing Studio. Teyvat's own files are never changed: Vibing Studio only reads its data and talks through its own background channel.\n\n## Features\n\n- **Agents**: the \"Teyvat\" group in the Primary Side Bar lists agents that are not archived, with where each runs (foreground or background) and what it is doing (working, waiting, hibernating, paused).\n- **Transcripts**: each start writes a new transcript; scroll up to read earlier ones. Tools and notices are drawn the way Teyvat draws them: Execute titles and results, how long a Wait lasted, hibernation notes, messages between agents, Life Restarted.\n- **Chat**: talk to agents running in the background directly (prompts go through their background command channel, the same one Teyvat's web-tui uses; Esc interrupts). Agents that are not running are started in the background first (`genshin bg`). Agents running in a terminal are read-only here; press Ctrl+C in their terminal to move them to the background.\n\n## Requirements\n\n- Teyvat installed on this computer (the `genshin` command).",
      },
      features: {
        views: [{ zh: "Teyvat agent 列表", en: "Teyvat agents", where: "主侧栏", whereEn: "Primary Side Bar" }],
        addresses: [{ pat: "local.teyvat:<agent>", patEn: "local.teyvat:<agent>", zh: "打开一个 Teyvat agent", en: "Open a Teyvat agent" }],
      } },
    { id: "paimon", name: "Paimon", icon: "✦", builtin: true, core: true, version: "0.1.0", publisher: "Vibing Studio", publisherId: "vibing-studio", verified: true, desc: "Vibing Studio 内置助手：监看各个 Agent 的运行，并在需要时协助处理", descEn: "Your helper in Vibing Studio: keeps an eye on your agents and lends a hand",
      // 派蒙：夜空的底（她斗篷上的星空），几颗星、一点光，派蒙整只在中间——同另外两个一样满，不空
      logo: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="pmTileG" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#34528f"/><stop offset="1" stop-color="#1b2552"/></linearGradient>' +
        '<radialGradient id="pmTileGl" cx=".5" cy=".56" r=".48"><stop offset="0" stop-color="#bcd4ff" stop-opacity=".55"/><stop offset="1" stop-color="#bcd4ff" stop-opacity="0"/></radialGradient><clipPath id="pmTileC"><path d="' + SQ_D + '"/></clipPath></defs>' +
        '<g clip-path="url(#pmTileC)"><rect width="64" height="64" fill="url(#pmTileG)"/><g fill="#fff"><circle cx="9" cy="11" r=".9" opacity=".9"/><circle cx="54" cy="9" r=".7" opacity=".7"/><circle cx="57" cy="24" r=".5" opacity=".6"/><circle cx="7" cy="30" r=".55" opacity=".6"/><circle cx="47" cy="17" r=".45" opacity=".5"/><circle cx="16" cy="20" r=".4" opacity=".5"/></g>' +
        '<path fill="#ffe9a8" d="M52 44.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z" opacity=".95"/><path fill="#fff" d="M11 46l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" opacity=".85"/><circle cx="32" cy="36" r="27" fill="url(#pmTileGl)"/>' +
        '<image href="' + PM_SRC + '" x="2" y="3" width="60" height="60"/></g></svg>',
      readme: {
        zh: "# Paimon\n\n派蒙是 Vibing Studio 里的小助手：不替你写代码，而是帮你**看着**正在干活的 agent（Claude Code、Codex），在你需要的时候说一声、搭把手。\n\n" +
          "## 能做什么\n\n" +
          "- **盯着进度**：哪个会话在跑、跑了多久、卡在哪一步，等你回复的会第一时间告诉你。\n" +
          "- **帮你回顾**：离开一会儿回来，问她「刚才都做了什么」，按会话给你一段简短的回顾。\n" +
          "- **跨会话找东西**：某个命令的输出、某次改动、某张截图在哪段对话里，她帮你找到并打开。\n" +
          "- **Studio 的操作**：切换视图、打开文件、调整设置——直接跟她说。\n\n" +
          "## 使用\n\n" +
          "- 默认不启用：需要的时候在这里点「启用」，或者第一次用到她的功能时按提示打开。\n" +
          "- 模型：用你自己的 API Key（设置 › Paimon）。\n\n" +
          "## 说明\n\n" +
          "派蒙还在早期阶段，功能会围绕「辅助别的 agent」继续完善。\n",
        en: "# Paimon\n\nPaimon is the little helper inside Vibing Studio. She doesn't write your code — she **keeps an eye on** the agents doing the work (Claude Code, Codex) and speaks up or lends a hand when you need it.\n\n" +
          "## What she does\n\n" +
          "- **Watches progress**: which session is running, for how long, where it's stuck — and tells you right away when one is waiting for you.\n" +
          "- **Catches you up**: step away, come back, ask \"what happened?\" and get a short recap per session.\n" +
          "- **Finds things across sessions**: a command's output, a change, a screenshot — she finds the conversation and opens it.\n" +
          "- **Drives the Studio**: switch views, open files, change settings — just ask.\n\n" +
          "## Using it\n\n" +
          "- Off by default: click Enable here, or turn it on when you first use one of her features.\n" +
          "- Model: bring your own API key (Settings › Paimon).\n\n" +
          "## Status\n\n" +
          "Paimon is early; her features will keep growing around helping your other agents.\n",
      },
    },
  ];
  CONN.forEach(function (x) { if (x.id === "claude-code") { x.cmd = "claude"; x.desc = "在 Vibing Studio 里用 Claude Code：所有会话，一处接着聊"; x.descEn = "Work with Claude Code in Vibing Studio: every session, picked up in one place"; } }); // 一句话（同扩展商店）：不写目录、路径
  // 这台 Mac 上找没找到命令（缓存着：下次载入时马上就有；App 里一会儿再查一次）
  var hostKey = key => window.TSU_LOCAL?.hostKey(key) || key;
  var FOUND_KEY = hostKey("tsu-conn-found");
  var found = (function () { try { return JSON.parse(localStorage.getItem(FOUND_KEY) || "{}") || {}; } catch (e) { return {}; } })();
  var csubs = [];
  // 暂时停用：这次打开 App 期间（sessionStorage：刷新页面还在，重新打开 App 就没了）
  var tmpOffKey = function (id) { return "tsu-conn-tmpoff:" + id; };
  var connOn = function (id) {
    var x = CONN.filter(function (c) { return c.id === id; })[0];
    if (!x) return false;
    try { var tv = sessionStorage.getItem(tmpOffKey(id)); if (tv === "1") return false; if (tv === "on") return true; } catch (e) { /* 没有就算了 */ } // 暂时停用 / 只这次启用
    var s = settings(), c = (window.STUDIO && STUDIO.get && STUDIO.get("connectors")) || s.connectors || {}, ex = s.extensions || {}; // Studio 手上的那份（预览中的也算）优先
    if (x.core) return c[id] === true; // 派蒙：默认不开（Studio 里的辅助 agent，要用时启用；关着时侧栏、新建菜单、Claude App 边栏、Agent Finder 里都没有她）
    if (!window.nadosNative || !nadosNative.local) return false; // 网页版读不到这台 Mac 上的会话
    if (typeof c[id] === "boolean") return c[id];
    if (typeof ex[id] === "boolean") return ex[id]; // 以前「扩展」里装过 / 卸过的 Claude Code
    if (!found[id] && nadosNative.remote) return id === "claude-code"; // 借 Mac 用（iPhone、iPad）、还没查过那台 Mac 上有没有：Claude Code 先开着（不然一打开会话列表是空的，要等几分钟后的自动检测）
    return !!(found[id] && found[id].found); // 没设过：找得到命令就开着
  };
  // 一次性：以前「Paimon Code」默认开着、设置里写死了 paimon: true——派蒙改成默认不开的辅助 agent 以后，把这个旧的开着改回关（只做一次；之后你自己开就一直开着）
  var MIG_PM = "tsu-mig-pm-off-1";
  function migratePaimon() {
    if (localStorage.getItem(MIG_PM) || !window.STUDIO || !STUDIO.get || !STUDIO.setv) return !!localStorage.getItem(MIG_PM);
    localStorage.setItem(MIG_PM, "1");
    var c = STUDIO.get("connectors") || {};
    if (c.paimon === true) { var n = Object.assign({}, c); n.paimon = false; STUDIO.setv("connectors", n); }
    return true;
  }
  (function tryMig(n) { if (!migratePaimon() && n < 40) setTimeout(function () { tryMig(n + 1); }, 250); })(0);
  var lastOn = {};
  CONN.forEach(function (x) { lastOn[x.id] = connOn(x.id); });
  var changingConnector = null;
  function cfire(explicitId) {
    CONN.forEach(function (x) {
      var now = connOn(x.id);
      if (now !== lastOn[x.id]) { lastOn[x.id] = now; csubs.slice().forEach(function (f) { try { f(x.id, now, (explicitId || changingConnector) === x.id); } catch (e) { console.error(e); } }); }
    });
  }
  function detect() {
    var L = window.TSU_LOCAL;
    if (!L || !L.exec) return Promise.resolve(found);
    var sh = "for c in claude codex pi agy dsh; do p=$(command -v $c 2>/dev/null); if [ -n \"$p\" ]; then v=$($c --version 2>/dev/null | head -1); echo \"$c|$p|$v\"; else echo \"$c||\"; fi; done; " +
      // Teyvat：genshin 不问 --version（它的 launcher 会做别的事）——版本读它自己记的 ~/.teyvat/agent/version.json
      "p=$(command -v genshin 2>/dev/null); [ -z \"$p\" ] && [ -x \"$HOME/.local/bin/genshin\" ] && p=\"$HOME/.local/bin/genshin\"; v=$(sed -n 's/.*\"genshin\" *: *\"\\([^\"]*\\)\".*/\\1/p' \"$HOME/.teyvat/agent/version.json\" 2>/dev/null | head -1); echo \"genshin|$p|$v\"";
    return (L.ready || Promise.resolve()).then(function () { return L.exec({ cmd: sh }); }).then(function (r) {
      var next = {};
      String(r.out || "").split("\n").forEach(function (l) { var m = l.split("|"); if (m.length < 3) return; var id = m[0] === "claude" ? "claude-code" : m[0] === "genshin" ? "teyvat" : m[0]; next[id] = { found: !!m[1], path: m[1], version: m.slice(2).join("|").trim(), at: Date.now() }; });
      found = next;
      try { localStorage.setItem(FOUND_KEY, JSON.stringify(found)); } catch (e) { /* 满了 */ }
      cfire();
      return found;
    }, function () { return found; });
  }
  setInterval(function () { if (!document.hidden) detect(); }, 300000); // 自动检测：装好、卸掉 claude / codex 以后几分钟内就跟上（不用点「重新检测」）
  setTimeout(detect, 1500); // 打开时先查一次：新设备（iPhone、iPad 第一次借 Mac 用）上不用等 5 分钟才知道 Mac 上有 claude / codex
  var makers = {};
  window.TSU_CONNECTORS = {
    list: function () { return CONN; },
    get: function (id) { return CONN.filter(function (c) { return c.id === id; })[0] || null; },
    on: connOn,
    runningFilter: function (section, fallback) {
      var saved = window.STUDIO && STUDIO.get("runningFilter." + section, true);
      if (typeof saved === "boolean") return saved;
      var value = localStorage.getItem("tsu-side-filter:" + section);
      return value === null ? !!fallback : value === "1";
    },
    setRunningFilter: function (section, enabled) {
      if (window.STUDIO) STUDIO.setv("runningFilter." + section, !!enabled);
      try { localStorage.setItem("tsu-side-filter:" + section, enabled ? "1" : "0"); } catch (e) { /* The desktop settings file also stores this preference. */ }
    },
    tmpOff: function (id, v) { try { if (v === "on") sessionStorage.setItem(tmpOffKey(id), "on"); else if (v) sessionStorage.setItem(tmpOffKey(id), "1"); else sessionStorage.removeItem(tmpOffKey(id)); } catch (e) { /* 没有就算了 */ } cfire(id); document.dispatchEvent(new Event("st-settings-changed")); },
    set: function (id, v) {
      var s = settings(), c = Object.assign({}, s.connectors || {});
      c[id] = !!v;
      changingConnector = id;
      if (window.STUDIO && STUDIO.setv) STUDIO.setv("connectors", c);
      else { s.connectors = c; try { localStorage.setItem("st-settings", JSON.stringify(s)); } catch (e) { /* 满了 */ } }
      cfire(id); changingConnector = null; fire();
    },
    found: function (id) { return found[id] || null; },
    detect: detect,
    // 开关变了（这里改的、设置文件在别处改的、刚查到命令的）：fn(id, on)
    watch: function (fn) { csubs.push(fn); },
    refresh: function () { cfire(); },
    // 新会话：在最前面那个窗口开一个新标签页（用现在的外壳）；给了 prompt 马上说出去，没给的等你说第一句——说了才真的建出来（列表里才有它）。
    // 每个连接器自己登记怎么开（claude.js、codex.js：provide(id, { newSession(cwd, prompt) })）；cwd 可以写 ~/…，不给就是家目录。
    // 返回 { id（会话 id；Codex 说第一句之前是临时的 new-…）, aid（agent id：cc:… / cx:…）, pane }，开不了是 null
    provide: function (id, o) { makers[id] = o; },
    canNew: function (id) { return !!(makers[id] && connOn(id)); },
    newSession: function (id, cwd, prompt, opts) {
      var m = makers[id];
      if (!m || !connOn(id)) return null;
      var h = ((window.TSU_LOCAL && TSU_LOCAL.info && TSU_LOCAL.info()) || {}).home || "";
      cwd = String(cwd || "").trim();
      if (h && (cwd === "~" || cwd.indexOf("~/") === 0)) cwd = h + cwd.slice(1);
      return m.newSession(cwd || h, String(prompt || "").trim(), opts || null);
    },
  };

  // 「设置 › 连接器」：每个一节——开关、找没找到命令（版本、在哪）；内置的 Paimon 一直开着
  document.addEventListener("DOMContentLoaded", function () {
    var ST = window.STUDIO;
    if (!ST || !ST.addSettings) return;
    var C = window.TSU_CONNECTORS, local = function () { return !!(window.nadosNative && nadosNative.local); };
      var quote = function (v) { return "'" + String(v).replace(/'/g, "'\\''") + "'"; };
      async function readAgy(args, onDelta, onProgress) {
        if (!local() || !C.on("agy")) throw new Error("AGY 连接器未启用");
        var cmd = ["python3", await TSU_LOCAL.studioHelper("agy_sessions.py")].concat(args).map(quote).join(" ");
        if (args[0] === "--session" && typeof DecompressionStream !== "undefined") cmd = "VIBING_PACK_HISTORY=1 " + cmd;
        var controller = new AbortController(), timer = args[0] === "--send" ? null : setTimeout(function () { controller.abort(); }, 45000);
        try {
          var carry = "";
          // The relay can reconnect between exec.data and exec.exit. A completed
          // snapshot remains readable even when its completion event is lost.
          var ticket = args[0] === "--session" && !args.includes("--known-prefix") && window.nadosNative.remote && typeof DecompressionStream !== "undefined" ? crypto.randomUUID() : "";
          var target = ticket && "/tmp/vibing-history-" + ticket + ".gz";
          if (ticket) cmd = "VIBING_HISTORY_TOKEN=" + quote(ticket) + " " + cmd;
          var execution = TSU_LOCAL.exec({ cmd: cmd }, controller.signal, onDelta && function (chunk, channel) {
            if (channel !== 1) return;
            var lines = (carry + chunk).split("\n");
            carry = lines.pop();
            for (var line of lines) {
              if (!line.trim()) continue;
              var event = JSON.parse(line);
              if (event.configured || event.delta || typeof event.thinking === "boolean") onDelta(event);
            }
          });
          var result;
          if (ticket) {
            var finished = false;
            execution.finally(() => { finished = true; }).catch(() => {});
            while (!finished && !controller.signal.aborted) {
              await Promise.race([execution, new Promise(resolve => setTimeout(resolve, 400))]);
              if (finished) break;
              var stat = await TSU_LOCAL.stat(target).catch(() => null);
              if (stat?.size) {
                result = {code:0, out:JSON.stringify({historyFile:target, bytes:stat.size}), err:""};
                controller.abort();
                break;
              }
            }
          }
          result ||= await execution;
          if (result.code || !result.out.trim()) {
            var reason = result.err.trim().split(/\r?\n/).pop() || "agy 未返回会话数据";
            console.warn("agy", args[0], result.err);
            throw new Error(reason.slice(0, 150));
          }
          var data = JSON.parse(args[0] === "--send" ? result.out.trim().split("\n").pop() : result.out);
          if (args[0] !== "--session" || !data.historyFile) return data;
          if (!/\/vibing-history-[a-zA-Z0-9_-]+\.gz$/.test(data.historyFile) || !Number.isSafeInteger(data.bytes) || data.bytes <= 0)
            throw new Error("AGY 历史记录格式错误");
          try {
            var chunkSize = 512 * 1024, chunks = [], received = 0;
            for (var offset = 0; offset < data.bytes; offset += 3 * chunkSize) {
              var batch = [];
              for (var pos = offset; pos < Math.min(offset + 3 * chunkSize, data.bytes); pos += chunkSize) {
                let size = Math.min(chunkSize, data.bytes - pos);
                batch.push(TSU_LOCAL.read(data.historyFile, {offset:pos, max:size}).then(chunk => {
                  if (chunk.byteLength !== size) throw new Error("AGY 历史记录传输不完整");
                  received += size;
                  onProgress?.(received / data.bytes);
                  return chunk;
                }));
              }
              chunks.push(...await Promise.all(batch));
            }
            return await new Response(new Blob(chunks).stream().pipeThrough(new DecompressionStream("gzip"))).json();
          } finally {
            TSU_LOCAL.exec({cmd: "rm -f -- " + quote(data.historyFile)}).catch(() => {});
          }
        } finally { clearTimeout(timer); }
      }
    var sessions = [], sessionSignature = "", pending, loadedAt = 0, listError = "";
    var quotaAttempted = false, quotaState = {}, quotaNext = 0, quotaPending, modelChoices = [], modelRequest;
    try { quotaState = JSON.parse(localStorage.getItem(hostKey("tsu-agy-weekly")) || "{}"); } catch (_) {}
    function refreshQuota() {
      if (quotaPending || Date.now() < quotaNext) return;
      quotaNext = Date.now() + 60000;
      quotaPending = readAgy(["--weekly"]).then(q => {
        if (!Number.isFinite(q.remaining)) return;
        quotaState = q;
        quotaNext = Date.now() + 300000;
        localStorage.setItem(hostKey("tsu-agy-weekly"), JSON.stringify(q));
      }).catch(() => {}).finally(() => { quotaPending = null; quotaAttempted = true; document.dispatchEvent(new Event("tsu-agy-quota")); });
    }
    var modelsLoadedAt = 0;
    try {
      var savedModels = JSON.parse(localStorage.getItem(hostKey("tsu-agy-model-list")));
      if (Array.isArray(savedModels?.rows) && savedModels.rows.every(m => m && typeof m.id === "string" && typeof m.name === "string")) {
        modelChoices = savedModels.rows;
        modelsLoadedAt = Number(savedModels.at) || 0;
      }
    } catch (_) {}
    function prepareModels() {
      if (modelChoices.length && Date.now() - modelsLoadedAt < 60000) return Promise.resolve();
      if (!modelRequest) modelRequest = readAgy(["--models"]).then(rows => {
        if (!rows.length) throw new Error("agy 未返回可用模型");
        modelChoices = rows; modelsLoadedAt = Date.now();
        try { localStorage.setItem(hostKey("tsu-agy-model-list"), JSON.stringify({rows, at: modelsLoadedAt})); } catch (_) {}
      }).finally(() => { modelRequest = null; });
      if (modelChoices.length) {
        modelRequest.catch(() => {});
        return Promise.resolve();
      }
      return modelRequest;
    }
    async function refreshAgy() {
      if (!pending) pending = (async function () {
        var changed = !loadedAt, previousError = listError;
        try {
          var rows = (await readAgy([])).sessions;
          if (!Array.isArray(rows)) throw new Error("无效的会话列表");
          var signature = JSON.stringify(rows);
          if (signature !== sessionSignature) {
            changed = true;
            sessions = rows;
            sessionSignature = signature;
            try { localStorage.setItem(hostKey("tsu-sidebar-agy-v1"), signature); } catch (_) {}
          }
          listError = "";
        } catch (e) { listError = e.message; }
        finally {
          loadedAt = Date.now(); pending = null;
          if (changed || previousError !== listError) document.dispatchEvent(new Event("tsu-agy"));
        }
      })();
      return pending;
    }
    var agyCommands = [
      ["help", "命令和快捷键"], ["goal", "设定会话目标"], ["model", "选择模型"],
      ["config", "配置"], ["context", "上下文用量"], ["agents", "可用 Agent"],
      ["add-dir", "添加目录"], ["artifact", "查看产物"], ["btw", "临时提问"],
      ["changelog", "更新记录"], ["resume", "恢复会话"], ["fork", "创建会话分支"],
      ["boost", "深度推理"], ["browser", "浏览器任务"], ["clear", "新会话"],
      ["codesearch", "搜索代码"], ["compact", "压缩上下文"], ["copy", "复制回复"],
      ["credits", "积分"], ["diff", "查看修改"], ["effort", "思考强度"],
      ["exit", "退出终端"], ["feedback", "反馈"], ["grill-me", "逐项提问"],
      ["hooks", "查看钩子"], ["keybindings", "快捷键"], ["learn", "保存规则或技能"],
      ["logout", "退出账号"], ["mcp", "管理 MCP"], ["open", "打开文件"],
      ["permissions", "工具权限"], ["plan", "规划任务"], ["plugin", "插件"],
      ["rename", "重命名会话"], ["remote-control", "远程控制"], ["rewind", "回退会话"],
      ["schedule", "定时任务"], ["skills", "技能"], ["statusline", "状态栏"],
      ["swarm", "多智能体协作"], ["tasks", "后台任务"], ["teamwork", "团队协作"],
      ["title", "终端标题"], ["usage", "额度"], ["voice", "语音"],
      ["agy-customizations", "配置指南"], ["antigravity-guide", "使用指南"]
    ];
    var agyCommandNames = new Set(agyCommands.map(command => command[0]).concat(["quota", "settings"]));
    function isAgyCommand(message) {
      var token = /^\s*\/([\w-]+)(?=\s|$)/.exec(message);
      return !!token && agyCommandNames.has(token[1]);
    }
    function agyLocalAction(message) {
      var cmd = message.trim();
      if (!isAgyCommand(cmd) || /^\/goal\s+/.test(cmd)) return "";
      if (cmd === "/quota") return "/usage";
      if (cmd === "/settings") return "/config";
      return ["/tasks", "/usage", "/config", "/context", "/model", "/help", "/goal"].includes(cmd) ? cmd : "unsupported";
    }
    window.TSU_AGY = {
      commands: agyCommands, localAction: agyLocalAction,
      create: async function () { var result = await readAgy(["--create"]); await refreshAgy(); return result.sessionId; },
      quota: function () {
        refreshQuota();
        return {data: Date.parse(quotaState.reset) > Date.now() ? quotaState : null, loading: !quotaAttempted && !!quotaPending};
      },
      enabled: function () { return local() && C.on("agy"); },
      list: function () {
        if (Date.now() - loadedAt > 120000) refreshAgy();
        return sessions.filter(s => !s.subagent);
      },
      status: function () { return listError || (pending ? "正在读取会话…" : "没有会话"); },
      refresh: refreshAgy
    };
    if (local()) {
      try {
        var cachedSessions = JSON.parse(localStorage.getItem(hostKey("tsu-sidebar-agy-v1")));
        if (Array.isArray(cachedSessions)) sessions = cachedSessions;
      } catch (_) {}
      setTimeout(function () { if (TSU_AGY.enabled() && !loadedAt) refreshAgy(); }, 0);
    }
    setInterval(function () {
      if ((!document.hidden || sessions.some(s => s.workingSince)) && TSU_AGY.enabled() && loadedAt && !pending) refreshAgy();
    }, 5000);
    function findSession(id) { return sessions.find(function (s) { return s.sessionId === id; }); }
    TSU_AGY.ensure = function (id) {
      var A = window.TSU_AGENTS, aid = "agy:" + id;
      if (!A || !TSU_AGY.enabled()) return null;
      if (A.get(aid)) return A.runtime(aid);
      prepareModels().catch(() => {});
      var info = findSession(id) || {}, listeners = new Set(), loading;
      var session = { id: id, title: info.title || "Google Antigravity", turns: [], todo: { items: [] } };
      var agent = { id: aid, current: id, name: session.title, connector: "agy", claude: true, access: "ro" };
      var modelKey = "tsu-agy-model:" + id;
      var preferred;
      try { preferred = JSON.parse(localStorage.getItem(modelKey)); } catch (_) {}
      function quotaChanged() { listeners.forEach(fn => fn("status")); }
      var no = function () { return false; };
      function attachment(path) {
        var image = {path, media_type: "image/" + path.split(".").pop().toLowerCase().replace(/^jpg$/, "jpeg")};
        var reading;
        image.load = function (done) {
          if (!reading) reading = TSU_LOCAL.read(path).then(buf => { image.bytes = buf; }, () => { image.missing = true; });
          if (done) reading.then(done);
        };
        return image;
      }
      function readPrompt(turn, text) {
        turn.ask = text.replace(/@("(?:[^"\\\n]|\\.)*")/g, function (match, quoted) {
          var path;
          try { path = JSON.parse(quoted); } catch (_) { return match; }
          if (!/^\/.*\.(?:png|jpe?g|gif|webp)$/i.test(path)) return match;
          if (!turn.images) { turn.images = []; turn.wireAsk = text; }
          turn.images.push(attachment(path));
          return "[Image #" + turn.images.length + "]";
        });
      }
      function addEvent(turn, event) {
        if (event.role === "tool") {
          var tool = turn.parts.find(function (p) { return p.kind === "tool" && p.id === event.id; });
          if (!tool) {
            tool = { kind: "tool", id: event.id, name: event.action || "Tool", input: {}, status: "running", t0: Date.parse(event.created_at) || 0 };
            turn.parts.push(tool);
          }
          if (event.file_path) {
            tool.name = event.action === "edit_file" ? "Edit" : "Write";
            tool.input.file_path = event.file_path;
            if (event.lines) tool.detail = event.lines;
            if (event.diff) tool.diff = event.diff;
          }
          if (event.action === "update_steps" && event.steps != null) {
            var steps = Array.isArray(event.steps) ? event.steps : [event.steps];
            tool.detail = steps.map((step, i) => {
              if (typeof step === "string") return step;
              var status = String(step?.status || "").replace(/_/g, " ");
              return (i + 1) + ". " + [step?.title || JSON.stringify(step), status].filter(Boolean).join(" · ");
            });
            tool.taskHeading = (event.status === "completed" ? "Updated " : "Update ") + steps.length + (steps.length === 1 ? " step" : " steps");
            tool.summary = tool.detail[0] || tool.taskHeading;
            if (event.error) tool.detail.push(String(event.error));
          }
          if (event.action === "ask_question") {
            var questions = Array.isArray(event.questions) ? event.questions.filter(q => q && q.question) : [];
            var result = String(event.output || event.error || "").split(/\r?\n/);
            while (result.length && /^(?:Created At:|Completed At:|\s*$)/.test(result[0])) result.shift();
            tool.summary = [questions[0]?.question, result[0]].filter(Boolean).join(" → ");
            tool.detail = questions.flatMap((q, index) => [
              "Q" + (index + 1) + ": " + q.question,
              ...(Array.isArray(q.options) ? q.options.map(option => "  · " + (typeof option === "string" ? option : option.label || JSON.stringify(option))) : [])
            ]).concat(result);
          }
          if (event.action === "manage_subagents" || event.action === "invoke_subagent") {
            var args = event.taskArgs || {};
            var action = String(args.Action || "").replace(/^"|"$/g, "");
            var body = String(event.error || event.output || "").split(/\r?\n/).filter(l => !/^(Created|Completed) At:/.test(l)).join("\n").trim();
            var list = /^You have (\d+) active subagent\(s\):\s*([\s\S]*)$/.exec(body);
            tool.taskHeading = event.action === "invoke_subagent" ? "Spawn subagent" : action === "list" ? "List subagents" : "Manage subagents";
            tool.detail = body.split("\n");
            tool.summary = body.split("\n")[0] || action || tool.taskHeading;
            if (list) {
              try {
                var children = JSON.parse(list[2]).map(c => [c.role || c.type, c.state, c.stateDetail].filter(Boolean).join(" · "));
                tool.summary = children.join("; ") || "0 active subagents";
                tool.detail = children.concat(tool.detail);
              } catch (_) {}
            }
          }
          if (event.action === "manage_task") {
            var args = event.taskArgs || {};
            var output = String(event.output || event.error || "");
            var taskStatus = /^Status:\s*(.+)$/im.exec(output);
            var target = String(args.TaskId || "").split("/").pop();
            var done = event.status === "completed" && !event.error;
            var verbs = {
              kill: done && /\b(?:cancell?ed|terminated)\b/i.test(output) ? "Terminated" : "Terminate",
              status: done ? "Checked" : "Check",
              list: done ? "Listed tasks" : "List tasks",
              send_input: done ? "Sent input to" : "Send input to"
            };
            tool.taskHeading = [verbs[args.Action] || args.Action || "Manage", target || (args.Action === "list" ? "" : "task")].filter(Boolean).join(" ");
            tool.summary = [args.Action, args.TaskId && String(args.TaskId).split("/").pop(), taskStatus && taskStatus[1]].filter(Boolean).join(" · ") || "manage_task";
            tool.detail = Object.entries(args).map(([key, value]) => key + ": " + value);
            if (output) {
              var stamps = new Set();
              tool.detail.push(...output.trimEnd().split(/\r?\n/).filter(line => {
                if (!/^(Created|Completed) At:/.test(line)) return true;
                if (stamps.has(line)) return false;
                stamps.add(line);
                return true;
              }));
            }
          }
          if (event.schedule) {
            var schedule = event.schedule;
            var timing = schedule.CronExpression === "* * * * *" ? "每分钟 (* * * * *)" : schedule.CronExpression;
            if (schedule.DurationSeconds) timing = [timing, schedule.DurationSeconds + " 秒"].filter(Boolean).join(" · ");
            var interval = /^\*(?:\/(\d+))? \* \* \* \*$/.exec(schedule.CronExpression || "");
            var cadence = interval ? "every " + (interval[1] || 1) + "m" : schedule.CronExpression;
            if (!cadence && schedule.DurationSeconds) cadence = "in " + schedule.DurationSeconds + "s";
            var taskId = /task id:\s*(?:[^\s/]+\/)?(task-[\w-]+)/i.exec(event.output || "");
            tool.taskHeading = [taskId && event.status === "completed" ? "Scheduled" : "Schedule", taskId?.[1] || "task", cadence].filter(Boolean).join(" ");
            tool.summary = [timing, schedule.Prompt && schedule.Prompt.split("\n")[0].slice(0, 64)].filter(Boolean).join(" · ");
            tool.detail = [schedule.Prompt, event.output].filter(Boolean).join("\n").split("\n").filter(Boolean);
          }
          if (event.commandSummary) tool.commandSummary = event.commandSummary;
          if (event.title) tool.input.description = event.title;
          if (event.kind === "execute") { tool.name = "Bash"; tool.input.command = tool.input.description; }
          if (event.action === "search_web") {
            tool.name = "web_search";
            tool.input.query = tool.input.description;
          }
          if (event.action === "read_file" || event.action === "view_file") {
            tool.name = "Read"; tool.input.file_path = event.title;
            if (/^\/.*\.(?:png|jpe?g|gif|webp)$/i.test(event.title) && tool.img?.path !== event.title) {
              tool.img = attachment(event.title);
            }
          }
          tool.agyAction = event.action;
          tool.agyError = event.error;
          if (event.status === "failed") { tool.status = "error"; tool.out = "Antigravity 报告工具执行失败"; }
          if (event.status === "completed") tool.status = "done";
          if (event.output) tool.out = tool.name === "web_search" ? event.output.replace(/^(?:(?:Created|Completed) At:[^\n]*\n)+/, "") : event.output;
        } else if (event.role === "thinking") {
          turn.parts.push({ kind: "agyThinking", text: event.text, seconds: event.seconds });
          turn.thinking = turn.thinking ? turn.thinking + "\n\n" + event.text : event.text;
        } else if (event.role === "agent_message_chunk") {
          var last = turn.parts[turn.parts.length - 1];
          if (!last || last.kind !== "text") { last = { kind: "text", text: "", whole: true }; turn.parts.push(last); }
          (turn.agyTextSteps || (turn.agyTextSteps = new Set())).add(event.step);
          last.text += event.text;
          turn.answer = (turn.answer || "") + event.text;
          var at = event.end_ms;
          if (Number.isFinite(at) && Number.isFinite(turn.at) && at >= turn.at) turn.stats = { ms: at - turn.at, at: at };
          else delete turn.stats;
        }
      }
      var pendingTurn = null, optimisticTurns = [], workingSince = 0;
      var acknowledgedStart = 0, displayedStart = 0;
      var revision = "", followTimer, checking = false;
      var screenBusy = false, nextScreen = 0;
      var observedWorking = false, turnHashes = [], knownPrefix = "", knownSource = "";
      var waitingSince = 0;
      function backgroundWaitSince() {
        var explicit = /^Waiting for background terminal\b/i.test(rt.liveStatus || "");
        var waiting = !rt.stream && (explicit || (rt.state() !== "working" &&
          rt.tasks.some(task => task.kind === "shell" && task.status === "running")));
        if (!waiting) waitingSince = 0;
        else if (!waitingSince) waitingSince = Date.now();
        return waitingSince;
      }
      var workingKey = "tsu-agy-working:" + id;
      var restoredWorking = Number(sessionStorage.getItem(workingKey)) > Date.now() - 60000;
      async function updateScreen() {
        if (screenBusy || Date.now() < nextScreen) return;
        var current = findSession(id);
        var active = current && current.tty && current.tty !== "??";
        nextScreen = Date.now() + 1000;
        screenBusy = true;
        var screen = {};
        try { if (active) screen = await readAgy(["--screen", id]); }
        catch (e) { nextScreen = Date.now() + 10000; }
        finally { screenBusy = false; }
        var status = screen.status || "";
        // An unreadable frame during a terminal repaint has no lifecycle signal.
        var tasks = active ? screen.tasks || [] : rt.recordedTasks || [];
        var schedules = tasks.filter(task => task.kind === "cron"), shells = tasks.filter(task => task.kind === "shell");
        var children = sessions.filter(s => s.subagent && s.subagent.parent === id).map(s => ({
          kind: "agent", id: s.sessionId, type: s.subagent.role || "Subagent", desc: s.title,
          status: s.subagent.status, t0: Date.parse(s.subagent.createdAt || s.updatedAt)
        }));
        if (active && typeof screen.working !== "boolean") {
          shells = (rt.tasks || []).filter(t => t.kind === "shell");
          schedules = rt.schedules || [];
        }
        shells = shells.concat(children);
        if (JSON.stringify(rt.schedules) !== JSON.stringify(schedules) || JSON.stringify(rt.tasks) !== JSON.stringify(shells)) {
          rt.schedules = schedules;
          rt.tasks = shells;
          listeners.forEach(fn => fn("tasks"));
          ST.familyChanged();
        }
        if (active && typeof screen.working !== "boolean") return;
        var terminalWorking = active && screen.working === true;
        if (terminalWorking) {
          if (Number(sessionStorage.getItem(workingKey)) < Date.now() - 15000) sessionStorage.setItem(workingKey, String(Date.now()));
        } else sessionStorage.removeItem(workingKey);
        if (rt.terminalWorking === terminalWorking && rt.liveStatus === status && rt.liveFooter === screen.footer) return;
        var activityChanged = rt.terminalWorking !== terminalWorking;
        rt.terminalWorking = terminalWorking;
        if (active) {
          var thinking = /\bthinking\b/i.test(status);
          rt.thinkingAt = thinking ? rt.thinkingAt || Date.now() : 0;
        }
        rt.liveStatus = status; rt.liveFooter = screen.footer;
        var latest = session.turns.at(-1);
        if (latest && activityChanged) listeners.forEach(fn => fn("turn", latest));
        listeners.forEach(function (fn) { fn("status"); });
      }
      async function fileRevision(path) {
        var full = path.replace(/transcript\.jsonl$/, "transcript_full.jsonl");
        var database = path.replace(/\/brain\/[^/]+\/.*$/, "/conversations/" + id + ".db");
        var stats = await Promise.all([path, full, database, database + "-wal"].map(file => TSU_LOCAL.stat(file).catch(() => null)));
        return stats.map(function (st) { return st ? st.size + ":" + st.mtime : "-"; }).join("/");
      }
      async function follow() {
        if (!document.hidden) refreshQuota();
        if (!info.path || loading || checking || !TSU_AGY.enabled()) return;
        var working = rt.state() === "working";
        backgroundWaitSince();
        if (working !== observedWorking) {
          observedWorking = working;
          listeners.forEach(fn => fn("status"));
        }
        updateScreen();
        if ((working || rt.schedules?.some(task => task.status === "running") || rt.tasks.some(task => task.kind === "shell" && task.status === "running")) && rt.lastWorkingSecond !== Math.floor(Date.now()/1000)) { rt.lastWorkingSecond = Math.floor(Date.now()/1000); listeners.forEach(fn => fn("status")); }
        checking = true;
        try {
          var current = await fileRevision(info.path);
          if (listeners.size && !loading && current !== revision) await (loading = load(current));
        } catch (e) { console.warn("agy transcript refresh", e); }
        finally { checking = false; }
      }
      var cacheChecked = false;
      function historyProgress(value) {
        if (rt.historyProgress === value) return;
        rt.historyProgress = value;
        listeners.forEach(f => f("historyProgress"));
      }
      async function load(observedRevision) {
        var changes = null, appended = [];
        var scope = hostKey("agy-history:" + (window.TSU_UID || 0) + ":" + id);
        function applyMessages(messages) {
          rt.contextTokens = messages.contextTokens;
          rt.contextLimit = messages.contextLimit;
          rt.finalAt = messages.finalAt || 0;
          rt.recordedTasks = messages.background || [];
          rt.notificationTasks = messages.notificationTasks || {};
          session.todo.items = (messages.steps || []).filter(step => step?.title).map((step, index) => ({
            id: String(step.id ?? index + 1), subject: step.title,
            status: step.status === "done" ? "completed" : step.status || "pending"
          }));
          var turns = session.turns.slice(0, messages.reuseTurns || 0), turn, reuse;
          var hashes = messages.turnHashes || [], previous = session.turns;
          var model = messages.model || "";
          var effort = /-(low|medium|high|xhigh|max)$/.exec(model);
          var display = model.replace(/-(low|medium|high|xhigh|max)$/, "").replace(/(\d)-(\d)/g, "$1.$2").split("-").map(function (word) { return word.charAt(0).toUpperCase() + word.slice(1); }).join(" ");
          var selected = typeof messages.selectedModel === "string" && /^(.*?) (?:\((low|medium|high|xhigh|max)\))$/i.exec(messages.selectedModel);
          if (!model && messages.selectedModel) display = selected ? selected[1] : messages.selectedModel;
          if (!model && messages.selectedModel) effort = selected ? [null, selected[2].toLowerCase()] : null;
          session.modelId = model;
          agent.effort = effort && effort[1];
          session.mode = messages.mode;
          session.statusLabel = [display, effort && effort[1]].filter(Boolean).join(" · ");
          messages.events.forEach(function (message) {
            if (!turn || message.role === "user_message_chunk") {
              var index = turns.length;
              reuse = hashes[index] && hashes[index] === turnHashes[index] && previous[index] && previous[index] !== pendingTurn;
              turn = reuse ? previous[index] : { ask: "", parts: [] };
              turns.push(turn);
            }
            if (reuse) return;
            if (message.role === "user_message_chunk") {
              readPrompt(turn, message.text);
              var start = Number.isFinite(message.start_ms) ? message.start_ms : Date.parse(message.created_at);
              if (Number.isFinite(start)) turn.at = start;
            }
            else addEvent(turn, message);
          });
          var matched = new Set();
          optimisticTurns = optimisticTurns.filter(function (entry) {
            var index = turns.findIndex((t, i) => i >= entry.start && !matched.has(i) &&
              (t.wireAsk || t.ask) === (entry.turn.wireAsk || entry.turn.ask));
            if (index < 0) return true;
            matched.add(index);
            if (entry.turn === pendingTurn) pendingTurn = null;
            // Another identical prompt must match a later transcript entry, even on a later poll.
            optimisticTurns.forEach(other => { if (other !== entry && other.turn.ask === entry.turn.ask) other.start = Math.max(other.start, index + 1); });
            return false;
          });
          optimisticTurns.forEach(entry => turns.push(entry.turn));
          if (turnHashes.length && hashes.length === turns.length && previous.length === turnHashes.length && turns.length >= previous.length &&
              turnHashes.slice(0, -1).every((h, i) => h === hashes[i])) {
            changes = [];
            var index = previous.length - 1;
            if (index >= 0 && hashes[index] !== turnHashes[index]) {
              var last = previous[index];
              delete last.stats; delete last.answer; delete last.thinking;
              Object.assign(last, turns[index]);
              changes.push(last);
            }
            appended = turns.slice(previous.length);
            for (var added of appended) previous.push(added);
          } else session.turns = turns;
          turnHashes = hashes;
          knownPrefix = messages.prefix || "";
          knownSource = messages.notificationTasks ? messages.source || "" : "";
        }
        try {
          if (!cacheChecked) {
            cacheChecked = true;
            historyProgress(-1);
            var cached = await TSU_LOCAL.cachedHistory(scope).catch(() => []);
            var head = cached.shift();
            if (head && cached.length === head.turnHashes?.length) {
              applyMessages({...head, reuseTurns: 0, events: cached.flat()});
              listeners.forEach(f => f("reset"));
              historyProgress(null);
            }
          }
          if (!findSession(id)) await refreshAgy();
          info = findSession(id);
          if (!info) throw new Error(listError || "找不到该会话");
          session.title = agent.name = info.title || id;
          var before = observedRevision || await fileRevision(info.path);
          var args = ["--session", id];
          if (knownSource) args.push("--known-source", knownSource);
          if (knownPrefix && turnHashes.length) {
            args.push("--known-prefix", knownPrefix, "--known-turns", String(turnHashes.length - 1), "--known-last", turnHashes.at(-1));
          }
          var messages = await readAgy(args, null, rt.historyProgress != null ? historyProgress : null);
          if (messages.unchanged) {
            revision = before;
            changes = [];
            return;
          }
          var oldPrefix = knownPrefix;
          applyMessages(messages);
          var {events, ...metadata} = messages;
          var pages = [];
          for (var event of events) {
            if (!pages.length || event.role === "user_message_chunk") pages.push([]);
            pages.at(-1).push(event);
          }
          TSU_LOCAL.cacheHistory(scope, metadata, pages, messages.reuseTurns || 0, oldPrefix).catch(() => {});
          revision = before;
        } catch (e) { if (!session.turns.length) session.turns = [{ note: e.message, parts: [] }]; }
        finally { historyProgress(null); loading = null; listeners.forEach(function (f) { try { if (changes === null) f("reset"); else { changes.forEach(t => f("turn", t)); appended.forEach(t => f("append", t)); f("status"); } } catch (e) { console.error(e); } }); }
      }
      async function outboundMessage(message, images) {
        var outbound = message;
        for (var image of images || []) {
          var path = image.path;
          if (!path) {
            var extension = {"image/png":"png","image/gif":"gif","image/webp":"webp","image/jpeg":"jpg"}[image.media_type];
            if (!extension) throw new Error("不支持的图片格式：" + image.media_type);
            path = TSU_LOCAL.info().home + "/Library/Application Support/Vibing Studio/shots/shot-" + crypto.randomUUID() + "." + extension;
            await TSU_LOCAL.write(path, Uint8Array.from(atob(image.data), ch => ch.charCodeAt(0)));
          }
          outbound = outbound.replace(image.tag, () => "@" + JSON.stringify(path));
        }
        return outbound;
      }
      var rt = {
        agent: agent, sid: id, label: "Google Antigravity", terminalWorking: restoredWorking, tasks: [], stream: null,
        session: function () { return session; },
        on: function (fn) {
          listeners.add(fn);
          if (!followTimer) {
            refreshQuota();
            document.addEventListener("tsu-agy-quota", quotaChanged);
            followTimer = setInterval(follow, 400);
          }
          if (!session.turns.length && !loading) loading = load();
          return function () { listeners.delete(fn); if (!listeners.size) { clearInterval(followTimer); followTimer = null; document.removeEventListener("tsu-agy-quota", quotaChanged); } };
        },
        ready: function () { return loading || (revision && info.path ? Promise.resolve() : (loading = load())); },
        hideInputHint: true,
        more: no, historical: no,
        weeklyLabel: function () {
          return Number.isFinite(quotaState.remaining) && Date.parse(quotaState.reset) > Date.now() ?
            "weekly " + Math.round(quotaState.remaining * 100) + "% left" : "";
        },
        confirmedModel: function () { return rt.headless() && preferred?.confirmed ? preferred : null; },
        currentModelId: function () { return rt.confirmedModel()?.id || session.modelId; },
        model: function () { return (rt.headless() && preferred) || modelChoices.find(m => m.id === session.modelId) || {id: session.modelId, name: session.statusLabel}; },
        models: function () {
          var levels = ["low", "medium", "high", "xhigh", "max"];
          var effortSuffix = /-(low|medium|high|xhigh|max)$/;
          var selected = rt.model().id || "";
          var level = levels.indexOf((selected.match(effortSuffix) || [])[1]);
          var families = new Map();
          for (var choice of modelChoices) {
            var base = choice.id.replace(effortSuffix, "");
            var rank = levels.indexOf((choice.id.match(effortSuffix) || [])[1]);
            var distance = level < 0 ? 0 : Math.abs(rank - level);
            var previous = families.get(base);
            if (!previous || distance < previous.distance) {
              families.set(base, {distance, id: choice.id,
                name: choice.name.replace(/ \((low|medium|high|xhigh|max)\)$/i, "")});
            }
          }
          return Array.from(families.values());
        },
        prepareChoices: prepareModels,
        setModel: async function (key) {
          if (!rt.headless()) throw new Error("此会话由 agy 终端控制，请在那里切换模型");
          var choice = modelChoices.find(m => m.id === key);
          if (!choice) throw new Error("此模型不可用");
          var ack = await readAgy(["--configure", id, "--model", key]);
          if (ack.configured !== key) throw new Error("AGY 未确认模型切换");
          preferred = {...choice, confirmed:true};
          localStorage.setItem(modelKey, JSON.stringify(preferred));
          listeners.forEach(fn => fn("status"));
        },
        state: function () {
          var child = findSession(id)?.subagent;
          if (child) return child.status === "running" ? "working" : "idle";
          if (!rt.headless()) return rt.sending || rt.terminalWorking ? "working" : "idle";
          var start = workingSince || findSession(id)?.workingSince;
          if (start && rt.finalAt >= start && !pendingTurn) return "idle";
          return rt.sending || start ? "working" : "idle";
        },
        detachBash: no, takeQueued: function () { return null; },
        ctx: function () { var tokens = rt.contextTokens || 0, window = rt.contextLimit || 0; return {tokens, window, pct:window ? tokens/window*100 : 0}; },
        cwd: function () { return info && info.cwd || ""; },
        todo: function () { return session.todo.items; },
        pendingMsgs: function () {
          return Math.max(optimisticTurns.filter(entry => entry.followup).length, findSession(id)?.queuedInputs || 0);
        },
        cost: function () { return 0; },
        tail: function () { return ""; },
        headless: function () { return !/^ttys[0-9]+$/.test(findSession(id)?.tty || ""); },
        thinkSince: function () { return rt.thinkingAt || 0; },
        backgroundWaitSince: backgroundWaitSince,
        backgroundWaitTimeout: function () {
          var next = null;
          for (var task of rt.tasks) {
            if (task.kind !== "shell" || task.status !== "running") continue;
            var record = task;
            if (task.clock) {
              var matches = Object.entries(rt.notificationTasks || {}).filter(([id, t]) =>
                id === task.id || task.cmd.includes(id) || (t.cmd === task.cmd &&
                  new Date(t.createdAt).toTimeString().slice(0, 8) === task.clock));
              if (matches.length !== 1) continue;
              record = matches[0][1];
            }
            var seconds = record.notificationTimeoutSeconds, due = Date.parse(record.createdAt) + seconds * 1000;
            if (seconds > 0 && Number.isFinite(due) && (!next || due < next.due)) next = {due, seconds};
          }
          return next?.seconds || 0;
        },
        workingStartedAt: function () {
          var ownerStart = findSession(id)?.workingSince;
          if (workingSince) return workingSince;
          if (ownerStart) return ownerStart === acknowledgedStart ? displayedStart : ownerStart;
          return Date.parse(findSession(id)?.subagent?.createdAt) || session.turns.at(-1)?.at;
        },
        sendTerminal: async function (message, images) {
          var followup = rt.sending || rt.state() === "working";
          var localTurn;
          if (!followup) { rt.sending = true; waitingSince = 0; }
          if (rt.headless()) {
            var at = Date.now();
            localTurn = {ask:message, at:at, parts:[], pendingDelivery:true};
            if (images?.length) localTurn.images = images.map(im => im.path && !im.data ? attachment(im.path) : im);
            optimisticTurns.push({turn:localTurn, followup, start:session.turns.length - optimisticTurns.length});
            if (!followup) workingSince = at;
            pendingTurn = localTurn;
            session.turns.push(localTurn);
            listeners.forEach(fn => fn("append", localTurn));
            listeners.forEach(fn => fn("status"));
          }
          try {
            var outbound = await outboundMessage(message, images);
            if (localTurn) localTurn.wireAsk = outbound;
            var chunks = new Map(), liveThought;
            var args = ["--send", id, "--message=" + outbound];
            if (!images?.length && isAgyCommand(outbound)) args.push("--slash-command");
            if (preferred && rt.headless()) args.push("--model", preferred.id);
            var result = await readAgy(args, function (event) {
              if (event.configured) {
                if (preferred?.id === event.configured) {
                  preferred = {...preferred, confirmed:true};
                  localStorage.setItem(modelKey, JSON.stringify(preferred));
                  listeners.forEach(fn => fn("status"));
                }
                return;
              }
              if (localTurn?.pendingDelivery && (event.delta || event.thinking)) {
                localTurn.pendingDelivery = false;
                listeners.forEach(fn => fn("turn", localTurn));
              }
              if (typeof event.thinking === "boolean") {
                rt.thinkingAt = event.thinking ? rt.thinkingAt || Date.now() : 0;
                if (!event.thinking) liveThought = null;
                listeners.forEach(fn => fn("status"));
                if (!event.delta) return;
              }
              rt.streamingText = true;
              var turn = session.turns.findLast(t => t.ask === message && (t === localTurn || !optimisticTurns.some(e => e.turn === t)));
              if (!turn || turn.ask !== message) return;
              if (event.thinking) {
                if (!liveThought) liveThought = {kind:"agyThinking", text:"", streaming:true};
                var delta = event.delta;
                liveThought.text = delta.startsWith(liveThought.text) ? delta : liveThought.text + delta;
                var stored = turn.parts.find(p => p.kind === "agyThinking" && !p.streaming && p.text &&
                  (p.text.startsWith(liveThought.text) || liveThought.text.startsWith(p.text)));
                if (!stored && !turn.parts.includes(liveThought)) turn.parts.push(liveThought);
                listeners.forEach(fn => fn("turn", turn));
                return;
              }
              if (turn.agyTextSteps?.has(event.step) || (event.step === "acp" && turn.answer)) return;
              var part = chunks.get(event.step);
              if (!part) {
                part = {kind:"text", text:"", whole:true, phase:"final"};
                chunks.set(event.step, part);
              }
              if (!turn.parts.includes(part)) turn.parts.push(part);
              part.text += event.delta;
              listeners.forEach(fn => fn("turn", turn));
            });
            if (localTurn?.pendingDelivery && !result?.queued) {
              localTurn.pendingDelivery = false;
              listeners.forEach(fn => fn("turn", localTurn));
            }
            if (localTurn) {
              await refreshAgy();
              if (loading) await loading;
              await (loading = load());
            }
            return result;
          }
          catch (error) {
            if (localTurn) {
              optimisticTurns = optimisticTurns.filter(entry => entry.turn !== localTurn);
              session.turns = session.turns.filter(t => t !== localTurn);
              if (pendingTurn === localTurn) pendingTurn = null;
              listeners.forEach(fn => fn("reset"));
            }
            throw error;
          } finally {
            if (!followup) {
              // The connector can acknowledge a prompt before its worker finishes.
              acknowledgedStart = findSession(id)?.workingSince || 0;
              displayedStart = workingSince || acknowledgedStart;
              rt.sending = false;
              rt.thinkingAt = 0;
              rt.streamingText = false;
              workingSince = 0;
            }
            var latest = session.turns.at(-1);
            if (latest) listeners.forEach(fn => fn("turn", latest));
            listeners.forEach(fn => fn("status"));
          }
        }, send: no, sendNow: no, interrupt: function () {
          if (!rt.canInterrupt()) return false;
          readAgy(["--interrupt", id]).catch(error => {
            listeners.forEach(fn => fn("notice", String(error.message || error)));
          });
          return true;
        }, canInject: no, canSendNow: no,
        canInterrupt: function () { return rt.state() === "working"; }, canCycle: no, maybeRecap: no, recap: no,
        record: no, setGoal: no, clearGoal: no, clear: no, bang: no, wakeUp: no,
        setAccess: no, resume: no, afterReload: no,
        efforts: function () {
          var base = rt.model().id?.replace(/-(low|medium|high|xhigh|max)$/, "");
          return ["low", "medium", "high", "xhigh", "max"].filter(level => modelChoices.some(m => m.id === base + "-" + level));
        },
        setEffort: function (level) {
          var base = rt.model().id?.replace(/-(low|medium|high|xhigh|max)$/, "");
          return rt.setModel(base + "-" + level);
        }
      };
      rt.home = rt.cwd;
      A.registerExternal(aid, rt);
      return rt;
    };
    var status = function (c) {
      if (c.core) return connOn(c.id) ? "内置" : "已关闭";
      if (!local()) return "只能在 Vibing Studio App 中使用";
      var f = found[c.id];
      if (!f) return "正在检测…";
      return f.found ? (f.version ? f.version + " · " : "") + f.path : "这台 Mac 上没有找到 " + c.cmd + " 命令";
    };
    var dshSetupStatus = "", dshInstalling = false;
    ST.addSettings("connectors", {
      title: "连接器", icon: "⌁", order: 15, desc: "会话的运行位置：本机的 Claude Code 和 Codex。任何连接器的会话都可使用任意外壳显示",
      levels: 2, // 设置里两级：第一级一行一个连接器（名字、版本 · 在哪、开关、›），点进去是它自己的一页（Paimon Code、Claude Code 自己的设置也在那一页）；「重新检测」留在第一级（top）
      // 第一级那一行右边：版本 · 命令在哪（家目录写成 ~）；开没开看那行的开关
      summary: function (p) {
        var c = CONN.filter(function (x) { return x.id === p.id; })[0];
        if (!c) return "";
        if (c.core) return "内置";
        if (!local()) return "只能在 App 中使用";
        var f = found[c.id];
        if (!f) return "正在检测…";
        if (!f.found) return "未检测到";
        var home = ((window.TSU_LOCAL && TSU_LOCAL.info && TSU_LOCAL.info()) || {}).home || "";
        return home && f.path.indexOf(home + "/") === 0 ? "~" + f.path.slice(home.length) : f.path; // 位置（版本在连接器页上）
      },
      fields: function () {
        var out = [];
        CONN.filter(function (c) { return !c.core; }).forEach(function (c) { // Paimon（内置）不在这里：设置左边单独一项
          out.push({ head: c.name, id: c.id }); // 一个连接器一页（id：连接器 › 它）；开 / 关在连接器自己的页面上（这里不再放开关）
          var fd = found[c.id], home0 = ((window.TSU_LOCAL && TSU_LOCAL.info && TSU_LOCAL.info()) || {}).home || "";
          var where = c.core ? "内置" : !local() ? "只能在 App 中使用" : !fd ? "正在检测…" : !fd.found ? "未检测到" : home0 && fd.path.indexOf(home0 + "/") === 0 ? "~" + fd.path.slice(home0.length) : fd.path;
          out.push({ key: c.id + ".st", label: "安装位置", kind: "info", value: where, cls: !c.core && local() && fd && !fd.found ? "neg" : "" });
          // 它装的钩子、MCP 服务器、插件、技能……（eco.js）：就在它自己这一页里
          if (c.id === "agy" && local() && !nadosNative.remote && fd && fd.found && C.on("agy"))
            out.push({ key: "agy.sessions", kind: "info", label: "查看会话", value: "左侧 Agents → Google Antigravity" });
          if (c.id === "dsh" && local() && !nadosNative.remote && window.TSU_UI_LOCAL)
            out.push({ key: "dsh.sendSetup", must: true, label: "桌面会话发送", kind: "button", text: "连接桌面端", act: "dsh-install",
              desc: dshSetupStatus || "将 Studio 随附的发送连接器安装到 DSH 桌面和后台配置。请先保存工作并退出 DSH，再点击连接。" });
          var ek = { "claude-code": "cc", codex: "cx", pi: "pi" }[c.id];
          if (ek && local() && fd && fd.found) out.push({ key: c.id + ".eco", kind: "embed", embed: "eco", arg: ek });
        });
        // 不放「重新检测」：检测是自动的（打开 App、隔一会儿、打开这一页时都会查）
        return out;
      },
      change: function (k, v) { var id = String(k).replace(/\.on$/, ""); if (id !== k) C.set(id, !!v); },
      action: async function (what) {
        if (what === "dsh-install") {
          if (dshInstalling) return;
          dshInstalling = true;
          dshSetupStatus = "正在安装…";
          document.dispatchEvent(new Event("st-settings-changed"));
          try {
            var helper = TSU_UI_LOCAL.dir + "/studio/dsh_send.py";
            var result = await TSU_LOCAL.exec({cmd: "python3 '" + helper.replace(/'/g, "'\\''") + "' --install"});
            dshSetupStatus = result.code === 0 ? "已连接。DeepSeek Harness 打开或退出时均可发送。" : (result.err || result.out || "安装失败").trim().slice(-800);
          } catch (error) { dshSetupStatus = error.message; }
          finally { dshInstalling = false; document.dispatchEvent(new Event("st-settings-changed")); }
          return;
        }
        if (what === "detect") detect().then(function () { document.dispatchEvent(new Event("st-settings-changed")); }); },
    });
  });

  // ======== 外壳（显示会话的样子）：TUI、GUI 下面各有几种；live.js、gui.js 载入时登记 ========
  var WR = [];
  window.TSU_WRAPPERS = {
    register: function (w) { WR = WR.filter(function (x) { return x.id !== w.id; }).concat([w]); },
    list: function (kind) { return WR.filter(function (x) { return !kind || x.kind === kind; }); },
    get: function (id) { return WR.filter(function (x) { return x.id === id; })[0] || null; },
    // 这一类现在用哪一种：设置里选的（uiTui / uiGui），没有就是这一类登记的第一种
    current: function (kind) {
      var k = kind === "gui" ? "uiGui" : "uiTui", want = window.STUDIO && STUDIO.get ? STUDIO.get(k) : settings()[k];
      var l = WR.filter(function (x) { return x.kind === kind; });
      return l.filter(function (x) { return x.id === want; })[0] || l[0] || null;
    },
  };

  // ======== 扩展：真正额外装的（现在没有）========
  var LIST = [];
  var subs = [];
  var read = function () { try { return (JSON.parse(localStorage.getItem("st-settings") || "{}") || {}).extensions || {}; } catch (e) { return {}; } };
  var last = read();
  function fire() {
    var now = read();
    LIST.forEach(function (x) { if (!!now[x.id] !== !!last[x.id]) subs.slice().forEach(function (f) { try { f(x.id, !!now[x.id]); } catch (e) { console.error(e); } }); });
    last = now;
  }
  var isConn = function (id) { return CONN.some(function (c) { return c.id === id; }); };
  window.TSU_EXT = {
    list: function () { return LIST; },
    // 详情页（extview.js）：扩展和连接器都能打开
    get: function (id) { return LIST.filter(function (x) { return x.id === id; })[0] || window.TSU_CONNECTORS.get(id); },
    // 旧代码问的 on("claude-code")：是连接器的转给连接器
    on: function (id) { return isConn(id) ? connOn(id) : !!read()[id]; },
    set: function (id, v) {
      if (isConn(id)) return window.TSU_CONNECTORS.set(id, v);
      var o = Object.assign({}, read());
      if (v) o[id] = true; else delete o[id];
      if (window.STUDIO && STUDIO.setv) STUDIO.setv("extensions", o);
      else { var s = {}; try { s = JSON.parse(localStorage.getItem("st-settings") || "{}") || {}; } catch (e) { /* 坏了就重来 */ } s.extensions = o; localStorage.setItem("st-settings", JSON.stringify(s)); }
      fire();
    },
    // 装上 / 卸掉时（这里改的、设置文件在别处改的）、连接器开关变了：fn(id, on)
    watch: function (fn) { subs.push(fn); csubs.push(fn); },
    refresh: function () { fire(); cfire(); },
  };
})();
