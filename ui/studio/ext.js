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
  var PI_D = "M4.6 7.4h14.8M9.3 7.6c0 4.4-.6 8.2-2.5 11.1M15.3 7.6v8.3c0 1.9 1 2.8 2.9 2.5";
  var TY_D = "M12 2.5C12.7 8.1 15.9 11.3 21.5 12 15.9 12.7 12.7 15.9 12 21.5 11.3 15.9 8.1 12.7 2.5 12 8.1 11.3 11.3 8.1 12 2.5Z"; // Teyvat：一颗四角星（画出来的，不是字）
  var OAI_D = "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z";
  window.TSU_LOGOS = { claudePath: CLAUDE_D, claude: '<svg class="cc-logo-svg" viewBox="0 0 100 101" aria-hidden="true"><path fill="currentColor" d="' + CLAUDE_D + '"/></svg>',
    paimonSrc: PM_SRC, paimon: '<img class="pm-av" src="' + PM_SRC + '" alt="" draggable="false">',
    // Codex：ChatGPT / OpenAI 的结（Codex 自己那朵紫蓝的云不好看；用户定的），单色跟着字色；oaiPath 给别处画大图标用
    oaiPath: OAI_D,
    codex: '<svg class="cx-logo-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + OAI_D + '"/></svg>',
    // pi（pi coding agent）：画出来的 π——一横、左边一条带弯的腿、右边一条收尾往右勾的腿；单色跟着字色
    piPath: PI_D,
    pi: '<svg class="cx-logo-svg pi-logo-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="' + PI_D + '"/></svg>',
    teyvat: '<svg class="cx-logo-svg ty-logo-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + TY_D + '"/></svg>' };
  // 派蒙的图只要一次：读进内存变成 blob: 地址，到处用这一个（左边的树、标签页、连接器的方块、设置）——
  //   以前每画一次都按路径重新要（App 里本地界面文件一律不缓存），连接器页面的派蒙一闪一闪、要等一下才出来。keep：留一张解码好的，别被回收
  var pmKeep = null;
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
    { id: "codex", name: "Codex", icon: "◎", cmd: "codex", desc: "在 Vibing Studio 中使用 Codex，可继续任意会话", descEn: "Work with Codex in Vibing Studio: pick up any session and keep going",
      publisher: "Vibing Studio", publisherId: "vibing-studio", verified: true, domain: "openai.com", homepage: "https://openai.com/codex/", version: "0.1.0", updated: "2026-09-28", builtin: true, files: ["studio/codex.js"], // 同上：Codex 的官网
      logo: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="' + SQ_D + '" fill="#fff"/><path d="' + SQ_D + '" fill="none" stroke="#000" stroke-opacity=".1" stroke-width=".8"/><g transform="translate(12.4 12.4) scale(1.633)"><path fill="#0d0d0d" d="' + OAI_D + '"/></g></svg>', // 同 ChatGPT App 的图标：白底黑结，结占 62%
      categories: [{ zh: "AI", en: "AI" }, { zh: "聊天", en: "Chat" }],
      links: [{ zh: "Codex 文档", en: "Codex Docs", url: "https://developers.openai.com/codex" }, { zh: "设置文件", en: "Settings File", file: "~/.codex/config.toml" }],
      readme: {
        zh: "# Codex\n\n在 Vibing Studio 里看、接着用这台 Mac 上的 Codex 会话（`~/.codex/sessions`）。会话用你选的外壳显示——比如 Claude Code 风格的 TUI。\n\n## 功能\n\n- **会话列表**：侧栏、Agent Finder 里列出这台 Mac 上的 Codex 会话。\n- **记录**：`local.codex:<会话>` 打开一段会话；它在别处跑，这里跟着读新写进来的。\n- **接着说**：`codex exec resume <会话>`；它正开在 Codex 里时用 `codex queue` 排进去。\n\n## 要求\n\n- 这台 Mac 上装有 Codex（`codex` 命令）。\n",
        en: "# Codex\n\nRead and continue the Codex sessions on this Mac (`~/.codex/sessions`) inside Vibing Studio, shown with the wrapper you choose — for example the Claude Code style TUI.\n\n## Features\n\n- **Sessions**: the side bar and Agent Finder list the Codex sessions on this Mac.\n- **Transcripts**: `local.codex:<session>` opens a session; while it runs elsewhere, new output streams in.\n- **Keep talking**: `codex exec resume <session>`; when it's open in Codex, messages are queued with `codex queue`.\n\n## Requirements\n\n- Codex installed on this Mac (the `codex` command).\n" } },
    { id: "pi", name: "pi", icon: "", cmd: "pi", third: true, desc: "在 Vibing Studio 中使用 pi：这台电脑上的 pi 会话都能接着说", descEn: "Work with pi in Vibing Studio: pick up any pi session on this computer and keep going",
      publisher: "Vibing Studio", publisherId: "vibing-studio", verified: true, domain: "pi.dev", homepage: "https://github.com/earendil-works/pi", version: "0.1.0", updated: "2026-10-07", builtin: false, files: ["studio/pi.js"],
      logo: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="' + SQ_D + '" fill="#141414"/><g transform="translate(12 12) scale(1.667)"><path fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="' + PI_D + '"/></g></svg>', // 黑底白色的 π
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
    { id: "teyvat", name: "Teyvat", icon: "", cmd: "genshin", third: true, desc: "在 Vibing Studio 中使用 Teyvat：这台电脑上的 Teyvat agent 都能看，后台运行的能直接对话", descEn: "Work with Teyvat in Vibing Studio: see every Teyvat agent on this computer and talk to the ones running in the background",
      publisher: "Vibing Studio", publisherId: "vibing-studio", verified: true, domain: "paimon.beer", homepage: "https://paimon.beer", version: "0.1.0", updated: "2026-10-13", builtin: false, files: ["studio/teyvat.js"],
      logo: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="' + SQ_D + '" fill="#10302e"/><g transform="translate(12 12) scale(1.667)"><path fill="#86e3d3" d="' + TY_D + '"/></g></svg>',
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
  var FOUND_KEY = "tsu-conn-found";
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
  function cfire() {
    CONN.forEach(function (x) {
      var now = connOn(x.id);
      if (now !== lastOn[x.id]) { lastOn[x.id] = now; csubs.slice().forEach(function (f) { try { f(x.id, now); } catch (e) { console.error(e); } }); }
    });
  }
  function detect() {
    var L = window.TSU_LOCAL;
    if (!L || !L.exec) return Promise.resolve(found);
    var sh = "for c in claude codex pi; do p=$(command -v $c 2>/dev/null); if [ -n \"$p\" ]; then v=$($c --version 2>/dev/null | head -1); echo \"$c|$p|$v\"; else echo \"$c||\"; fi; done; " +
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
    tmpOff: function (id, v) { try { if (v === "on") sessionStorage.setItem(tmpOffKey(id), "on"); else if (v) sessionStorage.setItem(tmpOffKey(id), "1"); else sessionStorage.removeItem(tmpOffKey(id)); } catch (e) { /* 没有就算了 */ } cfire(); document.dispatchEvent(new Event("st-settings-changed")); },
    set: function (id, v) {
      var s = settings(), c = Object.assign({}, s.connectors || {});
      c[id] = !!v;
      if (window.STUDIO && STUDIO.setv) STUDIO.setv("connectors", c);
      else { s.connectors = c; try { localStorage.setItem("st-settings", JSON.stringify(s)); } catch (e) { /* 满了 */ } }
      cfire(); fire();
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
    newSession: function (id, cwd, prompt) {
      var m = makers[id];
      if (!m || !connOn(id)) return null;
      var h = ((window.TSU_LOCAL && TSU_LOCAL.info && TSU_LOCAL.info()) || {}).home || "";
      cwd = String(cwd || "").trim();
      if (h && (cwd === "~" || cwd.indexOf("~/") === 0)) cwd = h + cwd.slice(1);
      return m.newSession(cwd || h, String(prompt || "").trim());
    },
  };
  if (window.nadosNative && nadosNative.local) setTimeout(detect, 1500);
  // 「设置 › 连接器」：每个一节——开关、找没找到命令（版本、在哪）；内置的 Paimon 一直开着
  document.addEventListener("DOMContentLoaded", function () {
    var ST = window.STUDIO;
    if (!ST || !ST.addSettings) return;
    var C = window.TSU_CONNECTORS, local = function () { return !!(window.nadosNative && nadosNative.local); };
    var status = function (c) {
      if (c.core) return connOn(c.id) ? "内置" : "已关闭";
      if (!local()) return "只能在 Vibing Studio App 中使用";
      var f = found[c.id];
      if (!f) return "正在检测…";
      return f.found ? (f.version ? f.version + " · " : "") + f.path : "这台 Mac 上没有找到 " + c.cmd + " 命令";
    };
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
        });
        // 不放「重新检测」：检测是自动的（打开 App、隔一会儿、打开这一页时都会查）
        return out;
      },
      change: function (k, v) { var id = String(k).replace(/\.on$/, ""); if (id !== k) C.set(id, !!v); },
      action: function (what) { if (what === "detect") detect().then(function () { document.dispatchEvent(new Event("st-settings-changed")); }); },
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
