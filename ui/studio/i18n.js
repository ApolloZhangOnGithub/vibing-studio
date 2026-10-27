// i18n.js —— 界面的第二种语言（英文）：页面照旧用中文写，显示之前按词典换成英文；切回中文原样换回来（每个节点原来的字都记着）。
//   语言记在 Studio 的设置里（~/.paimon/studio.json 的 lang，本地缓存 localStorage 的 st-settings）："zh"（默认）| "en"
//   window.TSU_I18N = { lang(), set(lang), t(中文), onChange(fn), add({ 中文: 英文 }), refresh() }
//   · 页面上的字：文字节点，以及 title / placeholder / aria-label；后来加的、改了的跟着换（MutationObserver；按帧分批，每帧有限额；自己改的不再看）
//   · 用户的内容不碰（对话、终端、文件、输入框里的字……见 SKIP）；只认词典里一模一样的字、几条格式（数字、名字换进去的），用户写的字自然碰不上
//   · 主侧栏的树是 TTU 画的等宽格子（一个中文字一个 span）：按一段颜色整段换，宽度跟原来一样（右边的时间照样对齐）
//   · macOS 菜单栏、窗口标题、系统通知：经桥发出去的字在桥底下换（nadosNative 是冻住的：换不了它的 call，换它底下的 postMessage）
(function () {
  "use strict";
  if (window.TSU_I18N) return;
  var root = document.documentElement;
  var CJK = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;
  var noop = function () {};

  // ======== 词典：中文原文 → 英文（整段一模一样才换；前后的空白、「· 」照留）========
  var WORDS = new Map();
  function words(o) { Object.keys(o).forEach(function (k) { WORDS.set(k, o[k]); }); }
  // ---- 通用 ----
  words({
    "设置": "Settings", "取消": "Cancel", "好": "OK", "打开": "Open", "关闭": "Close", "保存": "Save", "完成": "Done", "编辑": "Edit",
    "复制": "Copy", "粘贴": "Paste", "全选": "Select All", "刷新": "Refresh", "停止": "Stop", "中断": "Interrupt", "终止": "Terminate",
    "清除": "Clear", "搜索": "Search", "显示": "Display", "隐藏": "Hidden", "开": "On", "关": "Off", "默认": "Default", "自动": "Auto",
    "全部": "All", "其他": "Other", "工具": "Tools", "模型": "Model", "权限": "Permissions", "余额": "Balance", "状态": "Status",
    "上下文": "Context", "任务": "Tasks", "视图": "View", "外观": "Appearance", "界面": "Interface", "布局": "Layout", "交互": "Interaction",
    "通知": "Notifications", "帮助": "Help", "窗口": "Window", "文件": "File", "文件夹": "Folder", "历史记录": "History", "历史": "History",
    "终端": "Terminal", "对话": "Chat", "会话": "Sessions", "记忆": "Memory", "工作目录": "Working Directory", "身份卡": "Identity Card",
    "身份卡.json": "identity.json", "重命名": "Rename", "重命名…": "Rename…", "恢复": "Unarchive", "归档": "Archive", "已归档": "Archived",
    "空闲": "Idle", "运行中": "Running", "正在运行": "Running", "工作中": "Working", "已打开": "Open", "后台": "Background",
    "后台运行": "Background", "后台运行中": "Running in background", "正在后台运行": "Running in background", "未运行": "Not Running",
    "最近": "Recent", "系统": "System", "名称": "Name", "大小": "Size", "位置": "Location", "内容": "Contents", "种类": "Kind",
    "修改日期": "Date Modified", "创建于": "Created", "修改于": "Modified", "上次活动": "Last Active", "问答": "Turns", "信息": "Info",
    "预览": "Preview", "展开": "Expanded", "一行": "One Line", "更多操作": "More Actions", "更多": "More", "只读": "Read-Only", "读写": "Read & Write",
    "低": "Low", "中": "Medium", "高": "High", "很高": "Extra High", "最高": "Max", "本窗口": "This Window", "其他终端": "Other Terminal",
    "已在其他终端中打开": "Open in another terminal", "创建副本": "Create Copy", "复制会话 ID": "Copy Session ID", "在终端中继续": "Continue in Terminal",
    "在新标签页中打开": "Open in New Tab", "在新窗口中打开": "Open in New Window", "（未命名）": "(Untitled)", "未命名": "Untitled",
    "未登录": "Not Signed In", "退出登录": "Sign Out", "使用 GitHub 登录": "Sign in with GitHub", "语言": "Language", "界面语言": "Display Language",
    "显示语言": "Display Language", "界面显示的语言": "The language of the interface", "设备": "Device", "浏览器": "Browser", "添加文件或照片…": "Add Files or Photos…", "截取屏幕": "Take a Screenshot", "分支没建成": "Couldn't Fork", "没删掉": "Couldn't Delete", "另一台设备": "Another device",
  });
  // ---- 活动栏、主侧栏（Agent 的树）----
  words({
    "搜索 (⇧⌘F)": "Search (⇧⌘F)", "扩展 (⇧⌘X)": "Extensions (⇧⌘X)", "管理": "Manage",
    "新建 Agent": "New Agent", "+ 新建 Agent": "+ New Agent", "新建 Agent…": "New Agent…", "新建 Codex 会话": "New Codex Session", "新建 pi 会话": "New pi Session", "新建 Claude Code 会话": "New Claude Code Session", "+ 新建 Claude Code 会话": "+ New Claude Code Session",
    "全部折叠": "Collapse All", "隐藏主侧栏": "Hide Primary Side Bar", "切换主侧栏 (⌃⌘S)": "Toggle Primary Side Bar (⌃⌘S)",
    "显示全部": "Show All", "仅显示运行中": "Show Running Only", "暂无 Agent": "No agents yet", "无运行中的 Agent": "No running agents",
    "无已归档的 Agent": "No archived agents", "无已归档的 Agent。": "No archived agents.", "暂无会话": "No sessions yet", "无运行中的会话": "No running sessions",
    "← 全部 Agent": "← All Agents", "仅显示最近": "Show Recent Only", "找不到会话目录": "Session Folder Not Found",
    "在此继续会与其他终端同时写入同一会话。可以创建副本（新会话，包含截至目前的对话）。": "Continuing here would write to the same session as the other terminal at the same time. You can create a copy instead (a new session with the conversation so far).",
    "刚刚": "now", "从未启动": "never",
  });
  // ---- 标签页、编辑区、文件、内嵌的浏览器 ----
  words({
    "关闭标签页": "Close Tab", "新建终端": "New Terminal", "向右拆分 (⌘D)": "Split Right (⌘D)", "向右拆分": "Split Right", "向下拆分": "Split Down",
    "关闭其他": "Close Others", "关闭此组": "Close Group", "新建标签页 (⌥⌘T)": "New Tab (⌥⌘T)", "＋ 新建面板": "＋ New Pane", "终端外观": "Terminal Appearance",
    "终端输入": "Terminal input", "拖动以移动面板（或按住 ⌥⌘ 拖动面板任意位置）": "Drag the pane (or hold ⌥⌘ and drag anywhere in it)",
    "移到编辑区": "Move into Editor Area", "还原": "Restore", "放大": "Zoom In", "缩小": "Zoom Out", "实际大小": "Actual Size",
    "关闭 (Esc)": "Close (Esc)", "保存 (⌘S)": "Save (⌘S)", "保存 ⌘S": "Save ⌘S", "在访达中显示": "Reveal in Finder", "读取中…": "Loading…",
    "二进制文件，无法预览": "Binary file, can't be previewed", "（空文件）": "(Empty file)", "无法保存": "Couldn't Save",
    "文件已在外部被修改": "The File Changed on Disk", "覆盖": "Overwrite",
    "文件在打开后被其他程序（可能是 Agent）修改。要用当前内容覆盖吗？": "Another program (possibly an agent) changed the file after it was opened. Overwrite it with your version?",
    "新标签页": "New Tab", "无法打开这一页": "Can't Open This Page", "重新载入": "Reload", "后退": "Back", "前进": "Forward",
    "在顶上的地址栏输入网址，例如 localhost:3000": "Enter a URL in the address bar above, e.g. localhost:3000",
    "重新载入 (⌘R)": "Reload (⌘R)", "在默认浏览器中打开": "Open in Default Browser", "打开浏览器标签页": "Open Browser Tab",
  });
  // ---- 辅助侧栏、面板、状态栏 ----
  words({
    "行内": "Inline", "状态栏": "Status Bar", "辅助侧栏": "Secondary Side Bar", "主侧栏": "Primary Side Bar", "面板": "Panel", "活动栏": "Activity Bar",
    "面包屑": "Breadcrumbs", "缩略图": "Minimap", "输入框": "Composer", "隐藏辅助侧栏": "Hide Secondary Side Bar", "隐藏状态栏": "Hide Status Bar",
    "地址栏": "Address Bar", "布局控件": "Layout Controls", "新建标签页": "New Tab", "标签页概览": "Tab Overview", "（无任务）": "(No tasks)",
    "关闭面板 (⌘J)": "Close Panel (⌘J)", "关闭预览": "Close Preview", "无内容": "No content", "模型 · Effort": "Model · Effort",
    "重新载入以使用新版本": "Reload to use the new version", "有新版本": "Update Available", "后台任务": "Background Tasks", "子 Agent": "Subagents", "主 Agent": "Main Agent",
    "终止终端（结束此 Shell 进程）": "Kill Terminal (ends this shell)", "无终端": "No terminals", "无后台任务": "No background tasks", "无后台任务。": "No background tasks.",
    "无子 Agent": "No subagents", "任务清单": "Task List", "权限级别": "Access Level", "纯文本": "Plain Text",
  });
  // ---- 菜单：⚙ 管理、自定义布局、标签条的 ···、编辑区显示哪些 ----
  words({
    "命令面板…": "Command Palette…", "命令面板": "Command Palette", "打开设置 (JSON)": "Open Settings (JSON)", "键盘快捷方式": "Keyboard Shortcuts",
    "配色方案…": "Color Theme…", "高亮配色…": "Syntax Theme…", "自定义布局…": "Customize Layout…", "自定义布局": "Customize Layout",
    "可见性": "Visibility", "模式": "Modes", "全屏": "Full Screen", "禅模式": "Zen Mode", "恢复默认": "Reset to Default",
    "消息": "Messages", "回答": "Answers", "思考": "Thinking", "工具调用": "Tool Calls", "文件更改": "File Changes", "网页": "Web",
    "命令输出": "Command Output", "回顾": "Recaps", "完成行": "Done Line", "后台任务通知": "Background Task Notices", "图片": "Images",
    "快速查看": "Quick Look", "显示包内容": "Show Package Contents", "空格": "Space", "隐藏活动栏": "Hide Activity Bar",
    "显示所有命令": "Show All Commands", "打开位置": "Open Location",
  });
  // ---- 命令、键盘快捷方式 ----
  words({
    "新建标签页 (⌘T)": "New Tab (⌘T)", "标签页概览 (⇧⌘\\)": "Tab Overview (⇧⌘\\)", "切换主侧栏 (⌘B)": "Toggle Primary Side Bar (⌘B)",
    "切换面板 (⌘J)": "Toggle Panel (⌘J)", "切换辅助侧栏 (⌥⌘I)": "Toggle Secondary Side Bar (⌥⌘I)", "切换辅助侧栏": "Toggle Secondary Side Bar",
    "切换面板": "Toggle Panel", "切换状态栏": "Toggle Status Bar", "切换主侧栏": "Toggle Primary Side Bar", "显示 Agent": "Show Agents",
    "在对话中搜索": "Search in Chats", "显示扩展": "Show Extensions", "切换禅模式": "Toggle Zen Mode",
    "切换界面（终端界面 / 图形界面）": "Toggle Interface (Terminal UI / Graphical UI)", "设置：Claude Code": "Settings: Claude Code",
    "打开 Claude Code 的 settings.json": "Open Claude Code settings.json", "切换缩略图": "Toggle Minimap", "快速打开": "Quick Open",
    "切换面包屑": "Toggle Breadcrumbs", "切换路径导航": "Toggle Breadcrumbs", "标签栏下方的路径导航（现在在哪：Agent › 会话、文件夹 › 文件）": "The breadcrumbs under the tab bar (where you are: Agent › session, folder › file)", "切换活动栏": "Toggle Activity Bar", "聚焦地址栏": "Focus Address Bar", "全局": "Global",
    "切换到第 1–8 个标签页": "Go to Tab 1–8", "编辑器组": "Editor Group", "切换到最后一个标签页": "Go to Last Tab",
    "换行（不发送）": "Insert Line Break (Don't Send)", "打开文件路径": "Open File Path", "⌘+单击": "⌘+Click", "+单击": "+Click", "单击": "Click",
    "终端、对话": "Terminal, Chat", "在浏览器中打开链接": "Open Link in Browser", "搜索快捷键": "Search keybindings", "命令": "Command",
    "快捷键": "Keybinding", "适用于": "When", "来源": "Source", "未找到结果": "No results found",
    "新建窗口": "New Window", "拆分窗格（左右）": "Split Pane Left and Right", "拆分窗格（上下）": "Split Pane Top and Bottom", "关闭窗格": "Close Pane",
    "关闭窗口": "Close Window", "选择左边的窗格": "Select Pane on the Left", "选择右边的窗格": "Select Pane on the Right", "选择上面的窗格": "Select Pane Above",
    "选择下面的窗格": "Select Pane Below", "显示上一个标签页": "Show Previous Tab", "显示下一个标签页": "Show Next Tab", "清除到开始": "Clear to Start",
    "聚焦左侧编辑器组": "Focus Left Editor Group", "聚焦右侧编辑器组": "Focus Right Editor Group", "聚焦上方编辑器组": "Focus Editor Group Above",
    "聚焦下方编辑器组": "Focus Editor Group Below", "上一个标签页": "Previous Tab", "下一个标签页": "Next Tab", "清屏": "Clear Terminal",
  });
  // ---- 命令面板、快速选择（配色方案、高亮配色）----
  words({
    "输入命令": "Type a command", "无匹配结果": "No matching results",
    "搜索会话、Agent、文件或输入网址（输入 > 以运行命令）": "Search sessions, agents, and files, or enter a URL (type > to run a command)",
    "选择配色方案": "Select Color Theme", "跟随系统": "Follow System", "选择高亮配色": "Select Syntax Theme", "跟随配色方案": "Follow Color Theme",
    "浅色": "Light", "深色": "Dark", "Paimon 深色": "Paimon Dark", "Paimon 浅色": "Paimon Light", "默认深色": "Default dark", "默认浅色": "Default light",
    "深灰": "Dark Gray", "VS Code 深色": "VS Code Dark", "VS Code 默认深色": "VS Code default dark", "VS Code 默认浅色": "VS Code default light", "Visual Studio Code 默认深色": "Visual Studio Code default dark", "Visual Studio Code 默认浅色": "Visual Studio Code default light",
    "Solarized 深色": "Solarized Dark", "Solarized 浅色": "Solarized Light", "GitHub 深色": "GitHub Dark", "GitHub 浅色": "GitHub Light", "自定义": "Custom",
  });
  // ---- 设置页：外观、终端、Paimon Code、视图、Claude Code ----
  words({
    "搜索设置": "Search settings", "配色方案": "Color Theme", "应用于整个窗口": "Applies to the whole window", "高亮配色": "Syntax Theme",
    "文件与对话中代码的语法高亮": "Syntax highlighting for code in files and chats", "字号": "Font Size",
    "Agent 对话的显示方式；运行时不变": "How agent chats are displayed; the runtime stays the same", "终端界面": "Terminal UI", "图形界面": "Graphical UI",
    "始终显示": "Always", "仅滚动时显示": "While Scrolling", "透明": "Transparent", "显示完整地址": "Show Full Address",
    "关闭时只显示站点，如 local.claude": "When off, only the site is shown, e.g. local.claude", "允许选择界面文字": "Allow Selecting UI Text",
    "对话、终端与文件内容始终可选择": "Chat, terminal, and file content can always be selected",
    "长行（代码、diff、输出）": "Long Lines (Code, Diffs, Output)", "折行": "Wrap", "截断": "Clip", "时间格式": "Time Format", "12 小时": "12-Hour", "24 小时": "24-Hour",
    "有新内容时自动滚动到底部": "Scroll to Bottom on New Output", "选中即复制": "Copy on Select",
    "Effort（推理强度）": "Effort", "联网搜索（web_search）": "Web Search (web_search)", "网页抓取（WebFetch）": "Web Fetch (WebFetch)",
    "Bash 与文件读写工具": "Bash and File Tools", "离开 30 分钟后返回时显示回顾（※ recap）": "Show a Recap After 30 Minutes Away (※ recap)", "输入框提示": "Composer Hints",
    "Read、Glob、Grep、Bash…": "Read, Glob, Grep, Bash…", "Edit 与 Write 的 Diff": "Diffs from Edit and Write", "搜索与网页抓取": "Search and web fetch",
    "! 命令输出": "! Command Output", "前几行": "First Lines", "状态行": "Status Line", "回顾（※ recap）": "Recaps (※ recap)", "完成行（✻ …）": "Done Line (✻ …)",
    "图片缩略图": "Image Thumbnails",
    "Claude Code 界面元素的显示位置": "Where Claude Code UI elements appear", "运行状态、持续时间与推理强度": "Run state, duration, and effort",
    "~/.claude/tasks 中的任务": "Tasks in ~/.claude/tasks", "上下文用量": "Context usage", "主题": "Theme", "深色（色弱）": "Dark (Colorblind)",
    "浅色（色弱）": "Light (Colorblind)", "深色 ANSI": "Dark ANSI", "浅色 ANSI": "Light ANSI", "全屏模式：无闪烁、可滚动": "Fullscreen mode: flicker-free and scrollable",
    "输入框编辑模式": "Input Editing Mode", "普通": "Normal", "加载时显示提示": "Show Tips While Loading", "减少动画": "Reduce Motion",
    "通知与权限": "Notifications & Permissions", "选择 iTerm2 时，Claude Code 等待输入会发送系统通知": "With iTerm2, Claude Code sends a system notification when it's waiting for input",
    "iTerm2 + 响铃": "iTerm2 + Bell", "响铃": "Bell", "默认权限模式": "Default Permission Mode", "每次询问": "Ask Every Time",
    "自动接受编辑": "Accept Edits Automatically", "计划模式": "Plan Mode", "跳过权限确认": "Bypass Permissions", "自动记忆": "Auto Memory",
    "没有运行 Claude Code 的标签页": "No Tab Is Running Claude Code", "请先在标签页中打开 Claude Code。": "Open Claude Code in a tab first.",
  });
  // ---- 搜索、扩展 ----
  words({
    "扩展": "Extensions", "无扩展": "No extensions", "区分大小写": "Match Case", "全字匹配": "Match Whole Word", "使用正则表达式": "Use Regular Expression",
    "正则表达式无效": "Invalid regular expression", "正在搜索 Claude Code 会话…": "Searching Claude Code sessions…",
    "本机 Claude Code 的会话：会话目录、会话记录、搜索与设置": "Claude Code sessions on this Mac: session tree, transcripts, search, and settings",
  });
  // ---- 地址栏、主页（Claude Code、Paimon Code）、历史记录、标签页概览 ----
  words({
    "搜索或输入地址": "Search or enter address", "新建标签页（⌘T）": "New Tab (⌘T)", "显示标签页概览（⇧⌘\\）": "Show Tab Overview (⇧⌘\\)",
    "搜索标签页": "Search tabs", "在此打开 Shell": "Open Shell Here", "仪表盘 · Paimon Code": "Dashboard · Paimon Code",
    "资源管理器 · Paimon Code": "Explorer · Paimon Code", "未安装 Claude Code 扩展": "The Claude Code extension isn't installed", "新建会话": "New Session",
    "暂无 Claude Code 会话": "No Claude Code sessions yet", "清除历史记录…": "Clear History…", "暂无历史记录": "No history yet", "今天": "Today", "昨天": "Yesterday",
    "要清除全部历史记录吗？": "Clear All History?", "仅清除本机记录，不影响 Agent 与会话。": "Only this Mac's history is cleared. Agents and sessions aren't affected.",
  });
  // ---- 仪表盘、资源管理器 ----
  words({
    "仪表盘": "Dashboard", "资源管理器": "Explorer", "返回 (⌘[)": "Back (⌘[)", "前进 (⌘])": "Forward (⌘])", "图标": "Icons", "列表": "List", "概览": "Overview",
    "空文件夹": "Empty folder", "二进制文件": "Binary file", "无法读取": "Can't read the file", "暂无对话": "No conversation yet", "关闭 (空格)": "Close (Space)",
    "无法预览": "No preview available",
  });
  // ---- 图形界面：对话、输入框、下面那排、浮层 ----
  words({
    "输入 / 使用命令": "Type / for commands", "发送 (↵)": "Send (↵)", "停止 (Esc)": "Stop (Esc)", "添加图片": "Add Image", "移除": "Remove",
    "搜索结果": "Search Results", "已中断": "Interrupted", "正在使用工具": "Using tools", "等待重试": "Waiting to retry", "等待模型": "Waiting for the model",
    "思考中": "Thinking", "排队中": "Queued", "Esc 中断": "Esc to interrupt", "仅自己的文件夹": "Own Folder Only", "推理强度": "Effort",
    "推理 关": "Effort: Off", "推理 低": "Effort: Low", "推理 高": "Effort: High", "推理 最高": "Effort: Max",
    "更快": "Faster", "更聪明": "Smarter", "上下文窗口": "Context window", "本段会话": "This session", "价格（每百万 token）": "Price (per 1M tokens)",
    "支持图片": "Vision", "只能读写自己的文件夹": "Can read and write only its own folder", "可以读取其他位置，不能修改": "Can read other locations but not change them",
    "可以读写其他位置": "Can read and write other locations", "新会话": "New Session", "切换模型": "Switch Model", "切换到终端界面": "Switch to Terminal UI",
    "更新任务清单": "Update task list", "列出 Agent": "List agents", "休眠": "Hibernate", "会话记录不存在": "The transcript doesn't exist",
    "通义千问": "Qwen", "智谱": "Zhipu", "豆包": "Doubao",
  });
  // ---- 提醒、确认框、系统通知 ----
  words({
    "终止并关闭": "Terminate and Close", "这个窗口里还有正在运行的任务，关闭会终止它们。": "This window still has running tasks. Closing it will terminate them.",
    "要终止此窗口中正在运行的进程吗？": "Terminate the running processes in this window?", "全部清除": "Clear All", "没有通知": "No notifications",
    "清除这一组": "Clear This Group", "最小化": "Minimize", "现在": "Now", "关于终端": "About Terminal",
    "此账号尚未获得邀请（仅限受邀用户）。": "This account hasn't been invited yet (invite only).", "账号尚未获得邀请": "This account hasn't been invited yet",
  });
  // ---- macOS 菜单栏（页面经桥给的：文件 / 显示 / 历史记录 / 帮助）----
  words({
    "设置…": "Settings…", "新建 Paimon Code Agent": "New Paimon Code Agent", "打开位置…": "Open Location…", "显示全部历史记录": "Show All History",
    "Vibing Studio 帮助": "Vibing Studio Help", "编辑器布局": "Editor Layout", "快速打开…": "Quick Open…", "导出文本为…": "Export Text As…",
    "隐藏边栏": "Hide Sidebar", "显示边栏": "Show Sidebar", "隐藏标签页栏": "Hide Tab Bar", "显示标签页栏": "Show Tab Bar", "默认字体大小": "Default Font Size",
    "终端使用手册": "Terminal Help", "外壳": "Shell",
  });
  // ---- 设置页：通用 / 账户 / 各应用风格自己的分区 ----
  words({
    "在此应用风格下不可用": "Not Available in This Application Style", "通用": "General", "应用风格、Agent 显示风格、配色、字体和语言": "Application style, agent view style, colors, fonts and language",
    "语言与交互": "Language & Interaction", "设置说明": "Setting Descriptions", "在每项设置下方显示说明": "The explanation under each setting",
    "全部显示": "Show All", "仅必要项": "Only Essential", "没有设置": "No settings",
    "布局": "Layout", "活动栏、侧栏、标签栏、状态栏和标题栏": "Activity bar, side bars, tab bar, status bar and title bar", "活动栏与侧栏": "Activity Bar & Side Bars",
    "编辑区": "Editor", "状态栏与标题栏": "Status Bar & Title Bar", "地址栏：关闭时只显示站点，如 local.claude": "Address bar: when off, only the site is shown, e.g. local.claude",
    "桌面与程序坞": "Desktop & Dock", "程序坞的位置与大小、桌面墙纸与小组件": "Dock position and size, desktop wallpaper and widgets", "大小": "Size",
    "程序坞图标的大小（像素）": "Size of the icons in the Dock (px)", "在屏幕上的位置": "Position on Screen", "墙纸": "Wallpaper",
    "太浩湖黄昏": "Tahoe Dusk", "翡翠湾": "Emerald Bay", "石墨": "Graphite", "黑色": "Black",
    "在桌面上显示时钟、Agent、余额小组件": "Show the clock, Agent and balance widgets on the desktop",
    "侧边栏与卡片": "Sidebar & Cards", "会话列表和右侧的工具卡片": "The session list and the tool cards on the right",
    "标签页与窗口": "Tabs & Window", "标签栏与窗口标题（与 iTerm 一致）": "Tab bar and window title (like iTerm)",
    "账号": "Account", "GitHub 账号、额度与用量、登录的设备": "GitHub account, credit and usage, signed-in devices", "个人资料": "Profile", "头像": "Avatar",
    "GitHub 账号": "GitHub Account", "Agent 怎么称呼你": "What should agents call you?", "将写入每个 Agent 的系统提示词": "Added to every agent's system prompt",
    "额度": "Credit", "最近 24 小时用了": "Spent in the last 24 hours", "最近 7 天用了": "Spent in the last 7 days", "累计充值": "Total credited",
    "登录的设备": "Signed-in Devices", "设备名称": "This Device's Name", "在其他设备上显示的名称": "The name your other devices see",
    "在这台设备上退出 GitHub 账号": "Sign out of GitHub on this device", "使用 GitHub 登录": "Sign in with GitHub",
    "在这台设备上退出登录": "Sign out on this device", "Agent 和会话将保留在账户中，重新登录后即可恢复": "Your agents and sessions stay in your account; sign in again to get them back",
    "代码外观": "Code Appearance", "浅色模式": "Light Mode", "深色模式": "Dark Mode",
    "用量": "Usage", "Paimon 的余额和用量，以及本机 Codex 和 Claude Code 的用量限额": "Paimon credit and usage; Codex and Claude Code limits (only what's on this Mac)",
    "对话字体": "Chat Font", "衬线": "Serif", "无衬线": "Sans", "动画": "Motion", "减少": "Reduced",
    "减少流式输出和界面中的动画效果": "Reduce animation in streaming responses and other interface elements", "所有应用风格共用": "Shared by All Application Styles",
    "余额与用量": "Credit & Usage", "在「用量」里看（同 Claude 的 Settings › Usage）": "See them on the Usage page", "查看用量": "View Usage",
    "登录后可查看 Paimon 的余额和用量": "Sign in to see your Paimon credit and usage", "余额用完了：请管理员充值后再用 Paimon 的模型": "Out of credit: ask an admin to top up before using Paimon's models",
    "最近 7 天没有用 Paimon 的模型": "No Paimon model usage in the last 7 days", "余额充足：照最近 7 天的用量，够用两个月以上": "Plenty left: at the last 7 days' pace it lasts more than two months",
    "最近 24 小时": "Last 24 Hours", "最近 7 天": "Last 7 Days", "Paimon · 最近 7 天各模型": "Paimon · Models, Last 7 Days", "Paimon · 最近的账": "Paimon · Recent Charges", "充值": "Top-up",
    "仅在 App 中可读取本机的 Codex 数据": "Codex data on this Mac can only be read in the app", "暂无本地数据（本机尚无 Codex 会话记录）": "No local data (no Codex sessions on this Mac yet)",
    "每周限额": "Weekly limit", "已经重置过": "Already reset", "Codex 额度": "Codex Credits", "不限": "Unlimited",
    "仅在 App 中可读取本机的 Claude Code 数据": "Claude Code data on this Mac can only be read in the app", "5 小时 / 每周限额": "5-Hour / Weekly Limits",
    "Claude Code 不在本机保存限额；不向 Claude 的服务器查询": "Claude Code doesn't keep its limits on this Mac; Claude's servers are not queried", "没有本地数据": "No local data",
    "订阅方式": "Subscription", "App Store 订阅": "App Store subscription", "Google Play 订阅": "Google Play subscription", "本地统计的 7 天": "Local Stats, 7 Days",
    "开发者": "Developer", "开发者功能": "Developer Features", "显示暂停开发的应用风格：macOS、Pure Terminal（⌃⌘3、⌃⌘4）": "Show the paused application styles: macOS and Pure Terminal (⌃⌘3, ⌃⌘4)",
    "显示已暂停开发的应用风格（macOS、Pure Terminal）": "Show the paused application styles: macOS and Pure Terminal", "仍然切换": "Switch Anyway",
    "此风格已暂停开发，不再修复问题或添加新功能，部分内容可能无法正常显示或使用。建议使用 Visual Studio Code 或 Claude Desktop 风格。": "Development of this style is paused: it no longer gets fixes or new features, and parts of it may look wrong or not work. Visual Studio Code or Claude Desktop style is recommended.", "显示试验中的应用风格：macOS、Pure Terminal（⌃⌘3、⌃⌘4）": "Show the experimental application styles: macOS and Pure Terminal (⌃⌘3, ⌃⌘4)",
    "显示试验中的应用风格：macOS、Pure Terminal": "Show the experimental application styles: macOS and Pure Terminal",
    "选择高亮配色（浅色模式）": "Select Syntax Theme (Light Mode)", "选择高亮配色（深色模式）": "Select Syntax Theme (Dark Mode)",
    "登录后，Agent 和会话将与账户同步，可在其他设备上继续使用": "Sign in so your agents and sessions follow your account to your other devices",
    // 两级（同 macOS 的系统设置）：顶上 ‹ ›、第二级的入口、去第二级那一行右边的样子
    "返回": "Back", "高级": "Advanced", "高级…": "Advanced…", "详细": "Detailed", "已开启": "On", "已关闭": "Off", "未找到": "Not Found", "只能在 App 中使用": "Only in the App",
    // 左边的分组、分区；账号 › 个人资料；开发者
    "显示风格": "View Style", "Agent 显示": "Agent View", "行为": "Behavior", "应用风格、显示语言": "Application style and language",
    "配色、字体、代码外观与 Agent 显示风格": "Colors, fonts, code appearance and how agents are shown", "设置文件与已暂停开发的应用风格": "Settings file and paused application styles",
    "设置文件": "Settings File", "在编辑器中打开设置文件": "Open the Settings File in the Editor", "暂停开发的应用风格": "Paused Application Styles", "已显示": "Shown",
    "可在「通用 › 应用风格」中选择 macOS 和 Pure Terminal": "macOS and Pure Terminal can now be picked in General › Application Style", "只有在 App 里才有": "Only in the app",
    "全名": "Full Name", "你的全名": "Your full name", "Agent 对你的称呼": "What should agents call you?", "更换头像": "Change Avatar", "应用": "App", "查找 claude 和 codex 命令": "Find the claude and codex Commands",
    // 用量（两级：卡片、明细）
    "Paimon 额度": "Paimon Credit", "剩余": "Left", "累计": "Total", "最近的账": "Recent Charges", "各模型（最近 7 天）": "By Model (Last 7 Days)", "最近 7 天各模型": "By Model, Last 7 Days",
    "照最近 7 天的用量，够用两个月以上": "At the last 7 days' pace, it lasts more than two months", "已翻译的内容会缓存，相同内容不重复计费": "Translated strings are cached; the same string is never billed twice",
    "尚未使用任务翻译": "Task translation hasn't been used yet", "在「用量」中查看": "See them on the Usage page", "调整": "Adjustment", "扣费": "Charge",
    // 对话：视图预设、内容、显示
    "内容": "Content", "每一项都用默认的档位": "Every item at its default level", "和哪一套预设都不一样（改过下面的项）": "Doesn't match any preset (items below were changed)",
    "一次换好下面「内容」里的每一项；再改其中一项就是自定义": "Sets every item under Content at once; changing one of them makes it Custom",
  });

  // ---- 同一个词在不同地方的译法（位置优先于上面的通用译法）----
  var CTX_ATTR = { "放大": "Maximize", "视图": "Views", "全屏": "Full Screen" }; // title / aria-label / placeholder：按钮上的是动作
  var CTX_MENU = { "显示": "View", "对话": "Chat", "文件": "File" }; // macOS 菜单栏（「文件」在菜单栏上是 File，别处的「文件」视图才是 Files）
  var CTX = [
    [".vcs-chip, .st-opt", { "关闭": "Off", "全部": "Full" }], // 选项：一种状态
    [".xp-pk, .xp-tr > span:nth-child(2)", { "会话": "Session" }], // 资源管理器的「种类」：一个
  ];
  // 标签、浮动窗口的标题、窗口标题：只换页面的名字（agent、会话、文件的名字不动）
  var TITLES = new Set(["仪表盘", "资源管理器", "设置", "键盘快捷方式", "历史记录", "新标签页", "终端", "会话", "记忆", "工作目录"]);

  // ======== 格式：数字、名字换进去的（按顺序，先具体的）========
  var pl = function (n, one, many) { return n + " " + (+n === 1 ? one : many || one + "s"); };
  var sub = function (s) { var r = look(s, null, 1); return r == null ? s : r; }; // 抓出来的那段：词典里有就换，没有原样
  var WHAT = { "标签页": "tab", "窗格": "pane", "窗口": "window" };
  var DAYS = { "日": "Sunday", "一": "Monday", "二": "Tuesday", "三": "Wednesday", "四": "Thursday", "五": "Friday", "六": "Saturday" };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // 时间（「几分钟前」「1天9小时」）：树里右边那一列只认这几条
  var TIME = [
    [/^隐藏「(.+)」$/, function (m) { return "Hide '" + (WORDS.get(m[1]) || m[1]) + "'"; }],
    [/^由应用风格决定（(.+) 只有 (TUI|GUI)）$/, function (m) { return "Set by the application style (" + m[1] + " only has " + m[2] + ")"; }],
    [/^(TUI|GUI) 在此应用风格下不可用$/, "$1 is not available in this application style"],
    [/^已归档 (\d+)$/, "Archived $1"],
    // 设置 › 用量
    [/^照最近 7 天的用量，余额还够用约 (\d+) 天$/, "At the last 7 days' pace, your credit lasts about $1 more days"],
    [/^累计充值 (.+) · 还剩 (.+)$/, "$1 credited in total · $2 left"],
    [/^(\d+) 次 · (.+) tokens$/, "$1 requests · $2 tokens"],
    [/^(\d+) 条消息 · (\d+) 个会话 · (.+) tokens$/, "$1 messages · $2 sessions · $3 tokens"],
    [/^(.+?) · (\S+) → (\S+) tokens$/, function (m) { return sub(m[1]) + " · " + m[2] + " → " + m[3] + " tokens"; }],
    [/^(.*)最近一次 Codex 会话里记下的（(.+)）；不向 OpenAI 查询$/, function (m) { return m[1] + "From your latest Codex session (" + sub(m[2]) + "); OpenAI is not queried"; }],
    [/^(\d+) 小时限额$/, "$1-hour limit"], [/^(\d+) 天限额$/, "$1-day limit"], [/^(\d+) 分钟限额$/, "$1-minute limit"],
    [/^(\d+) 分钟后重置$/, "Resets in $1 min"], [/^(\d+) 小时 (\d+) 分钟后重置$/, "Resets in $1 hr $2 min"],
    [/^周(.) (\d+:\d+) 重置$/, function (m) { return "Resets " + ({ 日: "Sun", 一: "Mon", 二: "Tue", 三: "Wed", 四: "Thu", 五: "Fri", 六: "Sat" }[m[1]] || m[1]) + " " + m[2]; }],
    [/^到 (.+) 为止（Claude Code 的 \/stats 算的）$/, "Up to $1 (computed by Claude Code's /stats)"],
    [/^(.+)（在此应用风格下不可用）$/, function (m) { return (WORDS.get(m[1]) || m[1]) + " — Not Available in This Application Style"; }],
    [/^(.+)（暂停开发）$/, function (m) { return (WORDS.get(m[1]) || m[1]) + " (Development Paused)"; }],
    [/^任务 · (\d+) 完成 · (\d+) 进行中 · (\d+) 待办$/, function (m) { return "Tasks · " + m[1] + " done · " + m[2] + " in progress · " + m[3] + " open"; }],
    [/^(后台任务|子 Agent)( · (\d+) 运行中)? · (\d+) 已结束$/, function (m) { return (m[1] === "后台任务" ? "Background tasks" : "Subagents") + (m[3] ? " · " + m[3] + " running" : "") + " · " + m[4] + " finished"; }],
    [/^(\d+) 个已结束$/, function (m) { return m[1] + " finished"; }],
    [/^正在运行 · (\d+)$/, "Running · $1"],
    [/^切换到 (.+) 风格？$/, function (m) { return "Switch to the " + m[1] + " Style?"; }],
    [/^切换到 (.+) 风格？\n([\s\S]+)$/, function (m) { return "Switch to the " + m[1] + " Style?\n" + (WORDS.get(m[2]) || m[2]); }], // 浏览器的确认框：标题和说明连在一起
    [/^上次在线 (.+)$/, function (m) { return "Last seen " + sub(m[1]); }],
    [/^(.+) · 管理员$/, "$1 · Admin"],
    [/^(zsh|bash|tmux|sh)（默认）$/, "$1 (Default)"],
    [/^(\d+)秒前$/, "$1s ago"], [/^(\d+)分钟前$/, "$1m ago"], [/^(\d+)小时前$/, "$1h ago"], [/^(\d+)天前$/, "$1d ago"],
    [/^(\d+)秒$/, "$1s"], [/^(\d+)分钟$/, "$1m"], [/^(\d+)小时(\d+)分钟$/, "$1h $2m"], [/^(\d+)小时$/, "$1h"], [/^(\d+)天(\d+)小时$/, "$1d $2h"], [/^(\d+)天$/, "$1d"],
  ];
  var TIME_WORDS = { "刚刚": "now", "从未启动": "never" };
  var PATTERNS = TIME.concat([
    // 数量
    [/^(\d+) 个 Agent$/, function (m) { return pl(m[1], "agent"); }],
    [/^(\d+) 个运行中$/, "$1 running"],
    [/^(\d+) 个在运行$/, "$1 running"], [/^(\d+) 个已完成$/, "$1 finished"], [/^后台任务 · (.+)$/, "Background Tasks · $1"], // 底部面板的「Agent 活动」、Claude App 的后台任务卡片
    [/^退出登录 (.+)？$/, "Sign out of $1?"], [/^(.+) 做完了$/, "$1 finished"], [/^这个模型（(.+)）单独设的；新会话用它$/, "Set for this model ($1); used by new sessions"], [/^关闭「(.+)」？$/, "Close “$1”?"], [/^设备（(\d+)）…$/, "Devices ($1)…"],
    [/^(\d+) 项已完成$/, "$1 completed"], [/^还有 (\d+) 项$/, "$1 more"], [/^任务清单 (\d+)\/(\d+)$/, "Tasks $1/$2"], // 任务清单（输入框上方、抽屉、侧栏、卡片）
    [/^后台任务 (\d+)$/, "Background tasks $1"], [/^子 Agent (\d+)$/, "Subagents $1"], [/^(\d+) 条消息等它下一步读到$/, "$1 messages pending"], // agent 右边「任务」一家子的标题行；图形界面排着的
    [/^跟着 (.+)（最近用的 agent；点一下切过去）$/, "Following $1 (the most recent agent; click to switch to it)"], // 辅助侧栏标题行上 agent 的名字
    [/^文件太大（(.+)），不在这里预览$/, "File too large ($1) to preview here"], [/^二进制文件（(.+)），不显示内容$/, "Binary file ($1), content not shown"], [/^只显示前 (.+)（共 (.+)）$/, "Showing the first $1 (of $2)"], [/^打不开：(.+)$/, "Can't open: $1"], // 小的文件面板（filepanel.js）
    [/^(\d+) 个会话$/, function (m) { return pl(m[1], "session"); }],
    [/^全部 (\d+) 个会话$/, function (m) { return "All " + pl(m[1], "session"); }],
    [/^(\d+) 个项目$/, function (m) { return pl(m[1], "item"); }],
    [/^(\d+) 条$/, function (m) { return pl(m[1], "entry", "entries"); }],
    [/^(\d+) 段$/, function (m) { return pl(m[1], "session"); }],
    [/^(\d+) 问$/, function (m) { return pl(m[1], "turn"); }],
    [/^(\d+) 项已全部完成$/, "All $1 done"],
    [/^(\d+) 个对话中有 (\d+) 个结果$/, function (m) { return pl(m[2], "result") + " in " + pl(m[1], "chat"); }],
    [/^还有 (\d+) 个结果$/, function (m) { return m[1] + " more " + (+m[1] === 1 ? "result" : "results"); }],
    [/^已归档 (\d+)$/, "Archived $1"],
    [/^(\d+) 秒$/, "$1s"], [/^(\d+) 分 (\d+) 秒$/, "$1m $2s"], [/^(\d+) 分钟前$/, "$1 min ago"],
    [/^账号 (\S+)$/, "Account $1"],
    // 图形界面：一次工具调用一句话、一组、思考、在跑
    [/^使用了 (\d+) 个工具$/, function (m) { return "Used " + pl(m[1], "tool"); }],
    [/^运行了 (\d+) 条命令$/, function (m) { return "Ran " + pl(m[1], "command"); }],
    [/^读取了 (\d+) 个文件、搜索了 (\d+) 次$/, function (m) { return "Read " + pl(m[1], "file") + ", searched " + pl(m[2], "time"); }],
    [/^读取了 (\d+) 个文件$/, function (m) { return "Read " + pl(m[1], "file"); }],
    [/^搜索了 (\d+) 次$/, function (m) { return "Searched " + pl(m[1], "time"); }],
    [/^… 还有 (\d+) 行$/, "… $1 more lines"], [/^… 还有 (\d+) 行改动$/, "… $1 more changed lines"], [/^… 还有 (\d+) 条结果$/, "… $1 more results"],
    // 按工具（··· › 工具 › 按工具、设置 › 对话）：继承类别的那一档；子 Agent 的状态
    [/^继承（全部 · (.+)）$/, function (m) { return "Inherit (All · " + (WORDS.get(m[1]) || m[1]) + ")"; }], // Agent 消息 › 收到的 / 发出的 / 子 Agent 报告
    [/^继承（(.+)）$/, function (m) { return "Inherit (" + (WORDS.get(m[1]) || m[1]) + ")"; }],
    [/^继承类别（(.+) · (.+)）$/, function (m) { return "Inherit Category (" + (WORDS.get(m[1]) || m[1]) + " · " + (WORDS.get(m[2]) || m[2]) + ")"; }],
    [/^(\d+) 个单独设置…$/, "$1 overrides…"], [/^… 共 (\d+) 步$/, "… $1 steps in all"],
    // 拆分视图的每一格：预设名（改过的「自定义（…）」、反选出来的「反选（…）」）、第几格、最多几格
    [/^自定义（(.+)）$/, function (m) { return "Custom (" + (WORDS.get(m[1]) || m[1]) + ")"; }],
    [/^反选（(.+)）$/, function (m) { return "Inverted (" + (WORDS.get(m[1]) || m[1]) + ")"; }],
    [/^(.+) · 第 (\d+) 格$/, function (m) { var a = m[1], b = /^(自定义|反选)（(.+)）$/.exec(a); return (b ? (b[1] === "自定义" ? "Custom (" : "Inverted (") + (WORDS.get(b[2]) || b[2]) + ")" : WORDS.get(a) || a) + " · Pane " + m[2]; }],
    [/^最多拆成 (\d+) 格$/, "At most $1 panes"],
    [/^(运行中|完成) · (\d+) 次工具调用$/, function (m) { return (m[1] === "运行中" ? "Running" : "Done") + " · " + pl(m[2], "tool use"); }],
    [/^(.+)（MCP）$/, "$1 (MCP)"],
    [/^，(\d+) 个失败$/, ", $1 failed"],
    [/^思考了 (\d+) 秒$/, "Thought for $1s"],
    [/^任务 (\d+) \/ (\d+)$/, "Tasks $1 / $2"],
    [/^上下文 (\d+)%$/, "Context $1%"],
    [/^(\S+) \/ (\S+)（(\d+)%）$/, "$1 / $2 ($3%)"],
    [/^输入 (¥\S*)$/, "Input $1"], [/^输出 (¥\S*)$/, "Output $1"], [/^(\S+) 上下文$/, "$1 context"],
    [/^推理 (.+)$/, function (m) { return "Effort: " + sub(m[1]); }],
    [/^回顾：([\s\S]*)$/, "Recap: $1"],
    [/^搜索网页 ([\s\S]+)$/, "Search the web: $1"],
    [/^读取网页 ([\s\S]+)$/, "Fetch $1"],
    [/^查找文件 ([\s\S]+)$/, "Find files $1"],
    [/^子 Agent：([\s\S]+)$/, "Subagent: $1"],
    [/^发送消息给 ([\s\S]+)$/, "Send message to $1"],
    [/^运行 ([\s\S]+)$/, "Run $1"],
    [/^读取 ([\s\S]+)$/, "Read $1"],
    [/^编辑 ([\s\S]+)$/, "Edit $1"],
    [/^写入 ([\s\S]+)$/, "Write $1"],
    [/^搜索 ([\s\S]+)$/, "Search $1"],
    // Studio：放在哪、预览、配色、设置页、文件
    [/^「(.+)」放在$/, function (m) { return "Place “" + sub(m[1]) + "” in"; }],
    [/^❯ (.+) ✔$/, function (m) { return "❯ " + sub(m[1]) + " ✔"; }],
    [/^预览 · ([\s\S]*)$/, "Preview · $1"],
    [/^当前：(.+)$/, function (m) { return "Current: " + sub(m[1]); }],
    [/^换成 (.+)？$/, function (m) { return "Switch to " + sub(m[1]) + "?"; }],
    [/^(?:换成|切换到)「(.+)」？$/, function (m) { return "Switch to “" + m[1] + "”?"; }],
    [/^恢复上次的 (\d+) 个标签页$/, function (m) { return "Reopen " + m[1] + " Previous Tab" + (m[1] === "1" ? "" : "s"); }],
    [/^这个会话开在别的终端里：在那里打 \/model (.+)$/, "This session is open in another terminal: type /model $1 there"],
    [/^没换成：([\s\S]*)$/, "Couldn't switch: $1"],
    [/^当前模型（(.*)）$/, function (m) { return "Current model (" + sub(m[1]) + ")"; }],
    [/^未找到「([\s\S]*)」$/, "No settings found for “$1”"],
    [/^打开 (.+)$/, "Open $1"],
    [/^文件不存在：([\s\S]*)$/, "File not found: $1"],
    [/^目录不存在：([\s\S]*)$/, "Folder not found: $1"],
    [/^无法读取：([\s\S]*)$/, "Can't read: $1"],
    [/^文件太大（(.+)），无法预览$/, "File too large to preview ($1)"],
    [/^「(.+)」有未保存的更改。要放弃这些更改吗？$/, "“$1” has unsaved changes. Discard them?"],
    [/^是否要保存对「(.+)」的更改？$/, "Do you want to save the changes you made to “$1”?"], // 关标签页 / 编辑完了：保存 / 不保存 / 取消
    [/^正在生成预览（快速查看）… (\d+) 秒$/, "Generating preview (Quick Look)… $1s"], [/^无法预览：([\s\S]*)$/, "Can't preview: $1"], // 文件：Office 的快速查看预览
    // 地址栏、Claude Code 会话
    [/^找不到 Agent：(.+)$/, "Agent not found: $1"],
    [/^本机没有此 Claude Code 会话：(.+)$/, "No Claude Code session like this on this Mac: $1"],
    [/^无法识别的地址：(.+)$/, "Unrecognized address: $1"],
    [/^找不到 Claude Code 会话：(.+)$/, "Claude Code session not found: $1"],
    [/^无法读取会话：([\s\S]+)$/, "Couldn't read the session: $1"],
    [/^此会话正在(后台|其他终端中)运行，此处为只读。如需继续，请在终端中连接（(.+)）$/, function (m) { return "This session is running " + (m[1] === "后台" ? "in the background" : "in another terminal") + ", so it's read-only here. To continue, attach to it in a terminal (" + m[2] + ")."; }],
    [/^Claude Code 已退出（(.+)）$/, "Claude Code exited ($1)"],
    // 连接器（Claude Code、Codex）：送进后台会话、只读、换模型、找不到会话
    [/^此会话开在另一个终端里，此处只读。请在那个终端里继续，或者关掉它后在这里接着说（(.+)）$/, "This session is open in another terminal, so it's read-only here. Continue in that terminal, or close it and keep talking here ($1)."],
    [/^没送进后台会话：([\s\S]+)$/, function (m) { return "Couldn't deliver to the background session: " + sub(m[1]); }],
    [/^(?:没送进后台会话，还排着（ctrl\+enter 再试）|未能发送到后台会话，消息仍在队列中（按 ctrl\+enter 重试）)：([\s\S]+)$/, function (m) { return "Couldn't deliver to the background session; still queued (ctrl+enter to retry): " + sub(m[1]); }],
    [/^今天访问(的网站)?$/, "Today"], [/^昨天访问(的网站)?$/, "Yesterday"], [/^(\d+) 项$/, "$1 items"], [/^网站$/, "Website"], [/^地址$/, "Address"],
    [/^未能发送，消息仍在队列中（按 ctrl\+enter 重试）：([\s\S]+)$/, function (m) { return "Couldn't deliver; still queued (ctrl+enter to retry): " + sub(m[1]); }],
    [/^这个会话开在 iTerm2 以外的终端里，无法从这里发送；请在那个终端里发送$/, "This session is open in a terminal other than iTerm2, so it can't be sent from here; send it in that terminal"],
    [/^这个会话不在 Vibing Studio 能送达的地方运行$/, "This session isn't running anywhere Vibing Studio can deliver to"],
    [/^这个会话开在 Vibing Studio 的一个终端标签页里（进程 (\d+)），请在那个标签页里发送$/, "This session is open in one of Vibing Studio's terminal tabs (process $1); send it in that tab"],
    [/^这个会话开在「(.+?)」里（进程 (\d+)），Vibing Studio 只能把消息送进 iTerm2 和后台会话，请在「.+?」里发送$/, "This session is open in $1 (process $2). Vibing Studio can only deliver to iTerm2 and background sessions; send it in $1"],
    [/^这个会话的进程（(\d+)）不在 iTerm2、也不在后台服务里，Vibing Studio 送不进去$/, "This session's process ($1) isn't in iTerm2 or the background service, so Vibing Studio can't deliver to it"],
    [/^找不到这个后台会话的 job，无法送达$/, "Couldn't find this background session's job, so it can't be delivered"],
    [/^未能立即发送：([\s\S]+)$/, function (m) { return "Couldn't send now: " + sub(m[1]); }],
    [/^macOS 拦下了 Vibing Studio 控制 iTerm2(（-\d+）)?：现在装的这一版 Vibing Studio 缺少控制其他 App 的授权声明，装上新版后就能送达$/, function (m) { return "macOS blocked Vibing Studio from controlling iTerm2" + (m[1] ? " (" + m[1].slice(1, -1) + ")" : "") + ": the installed Vibing Studio was signed without the entitlement to control other apps; the new build fixes it"; }],
    // 后台任务 / 子 Agent 的详情：读不到输出时说为什么
    [/^找不到输出文件：(.+)$/, "Output file not found: $1"],
    [/^没有记下输出文件，也不在：(.+)$/, "No output file was recorded, and there's none at the usual place: $1"],
    [/^读不了输出文件：(.+)$/, "Can't read the output file: $1"],
    [/^找不到它自己的记录：(.+)$/, "Subagent transcript not found: $1"],
    [/^读不了它自己的记录：(.+)$/, "Can't read the subagent transcript: $1"],
    [/^读不了：(.+)$/, "Can't read it: $1"],
    [/^(?:没能打断后台会话|无法中断后台会话)：([\s\S]+)$/, "Couldn't interrupt the background session: $1"],
    [/^它在等你确认一个权限 \/ 选项，请在终端里接上处理（(.+)）$/, "It's waiting for you to confirm a permission or choice; attach in a terminal to handle it ($1)."],
    [/^换模型（(.+)）时它在等你选，请在终端里接上处理（(.+)）$/, "It asked you to choose while switching the model ($1); attach in a terminal to handle it ($2)."],
    [/^此会话开在另一个终端里：模型要在那个终端里换（(.+)）$/, "This session is open in another terminal: switch the model there ($1)."],
    [/^这个会话正在别处运行：在那里换模型（claude attach (\S+) 后 \/model (\S+)）。从这里送 \/model 会连你的默认模型一起改掉，所以不替它换$/, "This session is running elsewhere: switch the model there (claude attach $1, then /model $2). Sending /model from here would also change your default model, so it isn't done for you."],
    [/^本机没有此 Codex 会话：(.+)$/, "No Codex session like this on this Mac: $1"],
    [/^找不到 Codex 会话：(.+)$/, "Codex session not found: $1"],
    [/^Codex 已退出（(.+)）$/, "Codex exited ($1)"],
    [/^本机没有此 pi 会话：(.+)$/, "No pi session like this on this computer: $1"],
    [/^找不到 pi 会话：(.+)$/, "pi session not found: $1"],
    [/^pi 已退出（(.+)）$/, "pi exited ($1)"],
    [/^这条命令只能在 pi 自己的终端界面里用：(.+)$/, "$1 is only available in pi's own terminal interface"],
    [/^没排进 Codex[：（]([\s\S]+?)）?$/, "Couldn't queue into Codex: $1"],
    [/^这台 Mac 上没有找到 (\S+) 命令$/, "The $1 command wasn't found on this Mac"],
    [/^上下文已压缩（原 (.+) tokens）$/, "Context compacted (was $1 tokens)"],
    [/^(.+) · 下一句起$/, function (m) { return m[1] + " · from next message"; }],
    [/^“(.+)”已在其他终端中打开$/, "“$1” Is Open in Another Terminal"],
    [/^Claude Code 按创建会话时的目录查找会话，该目录已不存在：\n([\s\S]*)$/, "Claude Code finds a session by the folder it was created in, and that folder no longer exists:\n$1"],
    // 关标签页、窗口时问一声
    [/^要终止此(标签页|窗格|窗口)中正在运行的进程吗？$/, function (m) { return "Terminate the running processes in this " + WHAT[m[1]] + "?"; }],
    [/^关闭此(标签页|窗格)将终止以下进程：([\s\S]+)。$/, function (m) { return "Closing this " + WHAT[m[1]] + " will terminate these processes: " + m[2].replace(/、/g, ", ") + "."; }],
    [/^关闭窗口将终止以下进程：([\s\S]+)$/, function (m) { return "Closing the window will terminate these processes: " + m[1].replace(/、/g, ", "); }],
    // 通知、目标、关于
    [/^(.+) 在后台继续运行$/, "$1 keeps running in the background"],
    [/^在终端中输入 paimon (.+) 继续$/, "Type paimon $1 in a terminal to continue"],
    [/^Goal met — ([\s\S]+)（(\d+) 次检查）$/, "Goal met — $1 ($2 checks)"],
    [/^已检查 (\d+) 次仍未达成，已暂停（([\s\S]*)）。发送消息以继续，或输入 \/goal clear$/, "Still not met after $1 checks, so it's paused ($2). Send a message to continue, or type /goal clear"],
    [/^目标检查出错，已暂停：([\s\S]*)$/, "The goal check failed and is paused: $1"],
    [/^([^\n]*)\n在 Shell 中输入 paimon 以开始与 AI Agent 对话。$/, "$1\nType paimon in a shell to start chatting with an AI agent."],
    // 日期：「9月27日 星期六」
    [/^(\d+)月(\d+)日 星期([日一二三四五六])$/, function (m) { return DAYS[m[3]] + ", " + MONTHS[+m[1] - 1] + " " + m[2]; }],
  ]);

  // ======== 补漏（i18n 普查）：设置、菜单、视图、对话框；TUI 画在终端格子里的（live.js 经 TSU_I18N.t 查这里）；GUI 的工具行 ========
  words({
    // 通用、设置、视图
    "添加": "Add", "选择": "Select", "工作中…": "Working…", "每周": "Weekly", "正在读取…": "Loading…", "订阅": "Subscription", "本机": "This Mac", "管理员": "Admin",
    "暂停开发": "On Hold", "窗格": "Pane", "仍然切换": "Switch Anyway", "在资源管理器中折叠文件夹": "Collapse Folders in Explorer", "刷新资源管理器": "Refresh Explorer",
    "长行、时间格式、侧栏、滚动与选中即复制": "Long lines, time format, side bars and scrolling in windows, copy on select",
    "当前 Agent 的模型、推理强度和可用工具": "The current agent's model and reasoning effort, and the tools agents can use",
    "Claude Code 的主题、编辑模式、推理强度、通知与权限（~/.claude/settings.json）": "Claude Code's theme, editor mode, reasoning effort, notifications and permissions (~/.claude/settings.json)",
    "显示暂停开发的应用风格：macOS、Pure Terminal（⌃⌘3、⌃⌘4）": "Show the application styles that are on hold: macOS and Pure Terminal (⌃⌘3, ⌃⌘4)",
    "显示已暂停开发的应用风格（macOS、Pure Terminal）": "Show the application styles that are on hold: macOS and Pure Terminal",
    "此风格已暂停开发，不再修复问题或添加新功能，部分内容可能无法正常显示或使用。建议使用 Visual Studio Code 或 Claude Desktop 风格。": "This style is on hold: it no longer gets fixes or new features, and parts of it may look wrong or not work. The Visual Studio Code or Claude Desktop style is recommended.",
    "把浏览器沙盒里的文件搬进真沙盒？": "Move the files from the browser sandbox into the real sandbox?", "不用了": "Not Now", "导入": "Import", "浏览器里那份照旧留着": "The copies in the browser are kept",
    // GUI：工具的一句话、管理员命令
    "查看后台命令的输出": "Check background command output", "停止后台命令": "Stop background command", "提交计划": "Submit plan", "向你提问": "Ask you a question",
    "管理员：增加额度、授权账号": "Admin: add credit, allow accounts",
    // TUI：/ 命令菜单、/help
    "切换此 Agent 的模型": "Switch this agent's model", "推理强度：off / low / high / max": "Reasoning effort: off / low / high / max",
    "所有 Agent（空输入时按 ←）": "All agents (← on an empty input)", "后台任务与子 Agent（空输入时按 ↓）": "Background tasks and subagents (↓ on an empty input)",
    "重命名此 Agent": "Rename this agent", "工作目录外的权限：禁止 / 只读 / 读写（Shift+Tab）": "Access outside the working directory: none / read / read & write (Shift+Tab)",
    "条件": "condition", "设定目标：每轮结束后检查，未达成则继续（/goal clear 取消）": "Set a goal: checked after every turn, keeps going until it's met (/goal clear to cancel)",
    "生成简要回顾：当前进展与下一步（离开 30 分钟后返回时自动生成）": "Write a short recap of progress and next steps (written automatically when you come back after 30 minutes)",
    "配置输入框下方显示的信息": "Choose what's shown under the input", "Agent、模型、余额与上下文": "Agent, model, balance and context", "用量与剩余额度": "Usage and remaining credit",
    "credit 账号 金额": "credit <login> <amount>", "管理员：增加额度（/admin credit 账号 50）、授权账号（/admin allow 账号）": "Admin: add credit (/admin credit <login> 50), allow an account (/admin allow <login>)",
    "将此会话导出为 Markdown": "Export this session as Markdown", "返回 Shell（Agent 在后台继续运行）": "Back to the shell (the agent keeps running in the background)", "命令与快捷键": "Commands and shortcuts",
    "!命令": "!command", "在沙盒中执行 Shell 命令，输出同时提供给 Agent": "Run a shell command in the sandbox; the agent sees the output too",
    "发送 / 换行": "Send / new line", "回答过程中立即发送（中断当前回合；空输入时发送排队消息）": "Send right away while it answers (interrupts the turn; on an empty input, sends the queued message)",
    "中断；有排队消息时先取回": "Interrupt; takes back a queued message first", "← (空输入)": "← (empty input)", "↓ (空输入)": "↓ (empty input)", "所有 Agent": "All agents",
    "工作目录外的权限": "Access outside the working directory", "任务清单：收起 / 展开": "Task list: collapse / expand", "展开所有工具输出": "Expand all tool output", "将运行中的命令转到后台": "Move the running command to the background",
    // TUI：/effort、/permissions、/statusline、/config、/status、输入框、Agent 列表
    "关闭推理（最快、最省）": "No reasoning (fastest, cheapest)", "高（默认）": "High (default)", "最高（最慢、最贵）": "Max (slowest, most expensive)",
    "只读：工作目录外只读": "Read: read-only outside the working directory", "读写：工作目录外可修改（仍受文件权限限制）": "Read & write: can change files outside the working directory (file permissions still apply)",
    "Balance（余额）": "Balance", "Ctx（上下文用量）": "Ctx (context used)", "Session（本会话费用）": "Session (this session's cost)", "权限级别": "Access level", "回合结尾": "End of turn",
    "Brewed for 12s（用时）": "Brewed for 12s (time taken)", "done 3:04 PM（完成时间）": "done 3:04 PM (finish time)", "≈¥0.0172（本轮费用）": "≈¥0.0172 (turn cost)",
    "输入框下方与每轮结尾显示的信息（保存在 /.paimon/config/settings.json）。空格选择，回车完成。": "What's shown under the input and at the end of each turn (saved in /.paimon/config/settings.json). Space to toggle, Enter when done.",
    "按 Enter 打开选择": "Enter to choose", "wrap = 折行（默认） · clip = 截断": "wrap = wrap long lines (default) · clip = cut them off", "高峰价": "Peak pricing", "平时价（半价）": "Off-peak pricing (half price)",
    "按 Enter 使用 GitHub 登录": "Press Enter to sign in with GitHub", "（或按 Enter）· 仅限受邀账号，按实际用量从账户余额扣费": "(or press Enter) · Invited accounts only; usage is charged to your balance",
    "Enter 恢复并打开 · Ctrl+X ×2 恢复 · Ctrl+A 返回列表 · Esc 返回": "Enter to restore and open · Ctrl+X ×2 to restore · Ctrl+A back to the list · Esc to go back",
    "Enter 打开 · Esc 返回 · N 新建 · X 停止 · Ctrl+X ×2 归档 · Ctrl+A 查看已归档": "Enter to open · Esc to go back · N for new · X to stop · Ctrl+X ×2 to archive · Ctrl+A for archived",
    "[进程已完成]": "[Process completed]", "按任意键新建 Shell": "Press any key to start a new shell",
    // 面板、Claude App 的边栏（换语言时还没重画的那一下）
    "关闭面板": "Close Panel", "未读": "Unread", "筛选、分组和排序": "Filter, group and sort", "输入网址": "Enter URL",
    "图形界面的 agent：输入框在它的对话下面": "A GUI agent's input sits under its conversation",
    // TUI：Agent 列表（空输入按 ←）
    "年龄": "Age", "履历": "History", "运行时长/上次访问": "Uptime / Last Seen",
    // Claude App 里去掉了快捷键的提示（「发送 (↵)」→「发送」）；树的标题栏菜单
    "发送": "Send", "新建文件夹…": "New Folder…",
  });
  PATTERNS.unshift(
    [/^跟着 (.+)（最近用的 agent；点一下切过去）$/, "Following $1 (the most recently used agent; click to switch to it)"],
    [/^(.+)（暂停开发）$/, function (m) { return (WORDS.get(m[1]) || m[1]) + " (On Hold)"; }],
    [/^切换到 (.+) 风格？$/, "Switch to the $1 style?"],
    [/^加载 (\d+) 个工具$/, function (m) { return "Load " + pl(m[1], "tool"); }], [/^查找工具 ([\s\S]+)$/, "Search tools: $1"], [/^使用技能 ([\s\S]+)$/, "Use skill $1"], [/^列出 ([\s\S]+)$/, "List $1"],
    [/^(\d+) 已归档$/, "$1 archived"], [/^切换到 (.+)（([a-z]+)）$/, "Switch to $1 ($2)"], [/^外观：(.+)$/, function (m) { return "Appearance: " + sub(m[1]); }],
    [/^只读，如需继续请在终端中连接（(.+)）$/, "Read-only; to continue, attach in a terminal ($1)"], [/^第 (\d+) 格$/, "Pane $1"],
    [/^输入 (¥\S*)（缓存 (¥\S*)）$/, "Input $1 (cached $2)"], [/^输入 (¥\S*)（缓存 (¥\S*)）· 输出 (¥\S*)$/, "Input $1 (cached $2) · Output $3"], [/^(\d+) 个模型$/, function (m) { return pl(m[1], "model"); }], [/^(.+) 的模型提供方$/, "Model providers for $1"],
    [/^(.+) 的模型。价格：元 \/ 百万 token，当前为高峰价。$/, "Models for $1. Prices in yuan per million tokens; peak rates now."],
    [/^(.+) 的模型。价格：元 \/ 百万 token，当前为平时价（高峰价的一半）。$/, "Models for $1. Prices in yuan per million tokens; off-peak rates now (half the peak price)."],
    [/^禁止：仅限工作目录 (.+)$/, "None: only the working directory $1"], [/^(.+) 工作目录外的权限（Shift\+Tab 切换）。$/, "$1's access outside its working directory (Shift+Tab to switch)."],
    [/^已登录为 (.+)，但此账号尚未获得邀请$/, "Signed in as $1, but this account hasn't been invited yet"], [/^(.+)（未获邀请）$/, "$1 (not invited)"], [/^高峰：(.*)$/, "Peak: $1"],
    [/^向 (.+) 发送消息，输入 ! 执行命令，输入 \/ 查看命令$/, "Message $1 — ! runs a command, / shows commands"], [/^向 (.+) 发送消息$/, "Message $1"],
    [/^\[连接断开(?:：([\s\S]*))?\]$/, function (m) { return "[Connection lost" + (m[1] ? ": " + m[1] : "") + "]"; }],
    [/^已把 (\d+) 个文件导入真沙盒$/, function (m) { return "Imported " + pl(m[1], "file") + " into the real sandbox"; }], [/^(\d+) 个没导进去：([\s\S]+)$/, "$1 couldn't be imported: $2"],
    [/^开了真沙盒以后，访达和编辑器看到的是真沙盒里的文件。浏览器里原来的 (\d+) 个文件（(.+)）还在，只是看不到了。\n\n导入 = 复制到真沙盒里同样的位置（已有的跳过），浏览器里那份照旧留着。以后也可以在访达的「文件」菜单里导入。$/,
      "With the real sandbox on, Finder and the editor show the files in the real sandbox. The $1 files ($2) from the browser are still there, just not shown.\n\nImport copies them to the same places in the real sandbox (skipping ones that exist) and keeps the browser copies. You can also import later from Finder's File menu."]
  );

  // ---- 补漏（两个方向的普查，2026-09-29）：TUI 格子里画的提示、会话里记下的说明（claude.js / codex.js 经 tr 查）、新加的设置项 ----
  words({ "与 Claude Code 的连接断开了": "Lost the connection to Claude Code" });
  words({ "快到自动压缩时显示剩余百分比": "Show context left before auto-compact", "上下文快满时，在 Claude Code 会话底部右侧显示「N% until auto-compact」（同 Claude Code）": "When the context is nearly full, show “N% until auto-compact” at the bottom right of Claude Code sessions, as Claude Code does",
    "往上翻时显示所在的那一问": "Show the current prompt when scrolled up", "向上翻阅对话时，最上面一行显示这一段属于哪一问；点按跳到那一问": "While scrolling up, the top line shows which prompt the visible part belongs to; click it to jump there" }); // Claude Code 自己的面板（live.js 的 cc 面板）接着时断开
  words({ "在上面输入网址，例如 localhost:3000": "Enter a URL above, e.g. localhost:3000", "回答已送出": "Answer sent",
    "该会话未在后台运行，无法在此回答，请在其终端中回答": "This session isn't running in the background, so it can't be answered here — answer in its terminal",
    "译文出现方式": "Translation Display", "先原文": "Original First", "只显示译文": "Translation Only",
    "先原文：先显示原文，翻好后换成译文；只显示译文：翻好之前不显示原文（只有一行淡的 …），翻好直接出现译文": "Original First: show the original, then swap in the translation when it's ready. Translation Only: hide the original until the translation is ready (just a faint …), then show the translation",
    "找不到 Claude Code 后台服务": "Can't find the Claude Code background service", "连不上 Claude Code 后台服务": "Can't connect to the Claude Code background service", "后台服务没收": "The background service didn't accept it",
    "没有后台会话": "No background session" });
  PATTERNS.push(
    [/^无法读取会话：(.*)$/, function (m) { return "Couldn't read the session: " + sub(m[1]); }],
    [/^停不了：这个会话开在别的终端里（进程 (\d+)），请在那边按 Esc$/, "Can't stop it: this session is open in another terminal (process $1) — press Esc there"],
    [/^(?:这个会话正开在另一个终端里（进程 (\d+)）：在那边接着说，或者关掉它以后再在这里说|该会话正在另一个终端中运行（进程 (\d+)），请在该终端中继续，或关闭后在此继续)$/, function (m) { return "This session is open in another terminal (process " + (m[1] || m[2]) + "): keep talking there, or close it and talk here"; }],
    [/^(?:这个会话正开在另一个终端里（进程 (\d+)）：在那边接着说|该会话正在另一个终端中运行（进程 (\d+)），请在该终端中继续)$/, function (m) { return "This session is open in another terminal (process " + (m[1] || m[2]) + "): keep talking there"; }],
    [/^没能打断后台会话：(.*)$/, function (m) { return "Couldn't interrupt the background session: " + sub(m[1]); }],
    [/^Goal: ([\s\S]*?) · 已检查 (\d+) 次( · 上次：[\s\S]*?)?( · 已暂停（发送消息以继续）)?\n\/goal clear 取消 · ([\s\S]*)$/, function (m) { return "Goal: " + m[1] + " · checked " + pl(m[2], "time") + (m[3] ? " · last: " + m[3].replace(/^ · 上次：/, "") : "") + (m[4] ? " · paused (send a message to continue)" : "") + "\n/goal clear to cancel · " + sub(m[5]); }]
  );

  // ======== 查词 ========
  // 前后的空白、「 · 」不算在词里，换完照原样接上 → [前, 词, 后]
  var PAD = { 9: 1, 10: 1, 13: 1, 32: 1, 0xa0: 1, 0xb7: 1, 0x3000: 1 };
  function split3(s) {
    var a = 0, b = s.length;
    while (a < b && PAD[s.charCodeAt(a)]) a++;
    while (b > a && PAD[s.charCodeAt(b - 1)]) b--;
    return [s.slice(0, a), s.slice(a, b), s.slice(b)];
  }
  function look(core, ctx, depth) { // 整段 → 英文；没有返回 null（不分段）
    var hit = ctx && ctx[core];
    if (hit) return hit;
    hit = WORDS.get(core);
    if (hit !== undefined) return hit;
    if (depth > 3) return null;
    for (var i = 0; i < PATTERNS.length; i++) {
      var p = PATTERNS[i], m = p[0].exec(core);
      if (m) return typeof p[1] === "string" ? core.replace(p[0], p[1]) : p[1](m);
    }
    return null;
  }
  // 「运行中 · 本窗口」这种：整段查不到就按「 · 」分开各查各的，有中文的每段都查到了才算
  function segs(core, ctx) {
    var ps = core.split(" · "), ok = true;
    var out = ps.map(function (s) { if (!ok || !CJK.test(s)) return s; var r = look(s, ctx, 1); if (r == null) ok = false; return r; });
    return ok ? out.join(" · ") : null;
  }
  var cache = new Map();
  function tr(s, ctx, key) { // 一段字（带前后空白）→ 英文；换不了 null
    if (typeof s !== "string" || !CJK.test(s)) return null;
    var m = split3(s), core = m[1];
    if (!core || core.length > 400) return null; // 太长的是内容，不是界面上的字
    var k = (key || "") + "\u0001" + core, r = cache.get(k);
    if (r === undefined) {
      r = WORDS.has(core) || ctx && ctx[core] || core.indexOf(" · ") < 0 ? null : segs(core, ctx); // 带「 · 」的先分段（别让格式把整串吞了）
      if (r == null) r = look(core, ctx, 0);
      if (cache.size > 5000) cache.clear();
      cache.set(k, r);
    }
    return r == null ? null : m[0] + r + m[2];
  }
  function titleTr(s) { // 页面的名字（标签、窗口标题）：「🔔 」「● 」这种前缀照留
    var m = /^((?:🔔 |● )?\s*)([\s\S]*?)(\s*)$/.exec(String(s || ""));
    return m && TITLES.has(m[2]) ? m[1] + WORDS.get(m[2]) + m[3] : null;
  }
  function timeTr(core) {
    if (TIME_WORDS[core]) return TIME_WORDS[core];
    for (var i = 0; i < TIME.length; i++) if (TIME[i][0].test(core)) return core.replace(TIME[i][0], TIME[i][1]);
    return null;
  }

  // ======== 页面上的字 ========
  var lang = "zh";
  var ATTRS = ["title", "placeholder", "aria-label"];
  // 用户的内容：整块不碰（对话正文、终端、文件、输入框、代码、搜索命中的那一行……）
  // ---- 设置页、自定义布局、活动栏位置、账户（后来加的）----
  // 其他设备使用这台 Mac：连入方式、允许过的设备；App 里连另一台 Mac（开一个窗口）
  words({
    "其他设备": "Other Devices", "允许过的设备": "Allowed Devices", "其他设备连接时": "When Another Device Connects",
    "允许登录同一个 GitHub 账号的其他 Mac、iPhone、iPad 和网页端连接这台 Mac；终端、文件和会话都在这台 Mac 上运行": "Let your other Macs, iPhone, iPad and the web — signed in to the same GitHub account — connect to this Mac; terminals, files and sessions run on this Mac",
    "每台设备用自己的密钥识别，只知道设备号无法冒充。「直接允许」：登录同一个 GitHub 账号的设备不再确认": "Each device is identified by its own key, so knowing a device ID isn’t enough to impersonate it. “Allow Without Asking” lets devices on the same GitHub account connect without confirmation",
    "首次连接时确认": "Ask the First Time", "每次连接都确认": "Ask Every Time", "首次连接时确认并输入验证码": "Ask and Enter a Code the First Time", "直接允许": "Allow Without Asking",
    "连接到另一台 Mac…": "Connect to Another Mac…", "连接到另一台设备…": "Connect to Another Device…", "选择要连接的设备": "Choose a device to connect to", "没有可连接的设备。": "No devices to connect to.", "远程设备": "Remote Device", "没能打开这台 Mac。": "Couldn’t open this Mac.",
    "在另一台 Mac 上的 Vibing Studio 里打开 设置 › 通用 › 「其他设备使用这台 Mac」。": "On the other Mac, open Vibing Studio and turn on Settings › General › Let Other Devices Use This Mac.",
    "这个版本的 App 还不能连接另一台 Mac：在 ⚙ 菜单里检查更新，重启以更新后再试。": "This version of the app can’t connect to another Mac yet. Check for updates in the ⚙ menu, restart to update, then try again.",
  });
  words({"Linux 版有新版本 · 下载": "Linux Update Available · Download", "打开终端": "Open Terminal"});
  words({"登录方式": "Sign-In Methods", "用 Touch ID 登录": "Sign In with Touch ID", "用这台 Mac 的密码登录": "Sign In with This Mac’s Password", "正在开启：请按一下指纹…": "Turning on — touch the sensor…", "正在关闭…": "Turning off…", "不可用": "Unavailable", "移除": "Remove", "通行密钥": "Passkeys", "在这个浏览器里用 Touch ID、Face ID 或手机登录，不用每次都经过 GitHub": "Sign in with Touch ID, Face ID or your phone in this browser instead of going through GitHub every time", "这个浏览器、这台设备不能用通行密钥（要 Touch ID、Face ID、Windows Hello，或者能用手机的浏览器）": "Passkeys aren’t available in this browser on this device (they need Touch ID, Face ID, Windows Hello, or a browser that can use your phone)"});
  words({"收藏到摘录本": "Save to Clippings", "已收藏到摘录本": "Saved to Clippings", "标记这里": "Flag Here", "取消标记": "Remove Flag",
    "收藏": "Favorite", "取消收藏": "Remove from Favorites", "已收藏": "Added to Favorites", "已取消收藏": "Removed from Favorites"});
  words({"设备与权限": "Devices and Access", "打开「设备」": "Open Devices", "谁能使用这台 Mac、这台 Mac 又能用哪几台，在「设备」里看和管理": "See who can use this Mac and which devices this Mac can use in Devices"});
  words({"其他设备使用这台 Mac": "Let Other Devices Use This Mac", "允许 iPhone、iPad 和网页端连接并使用这台 Mac；终端、文件和会话均在这台 Mac 上运行": "Let iPhone, iPad and the web connect to and use this Mac — terminals, files and sessions run on this Mac", "在 Mac 上的 Vibing Studio 里打开 设置 › 通用 › 「其他设备使用这台 Mac」。": "On your Mac, open Vibing Studio › Settings › General › “Let Other Devices Use This Mac”."});
  words({"搜索设置": "Search settings", "未找到设置": "No settings found", "自定义": "Custom", "已修改": "Modified", "显示语言": "Display Language", "界面显示的语言": "The language of the interface", "界面风格": "Interface Style", "整个 Studio 的外观；Agent 的运行时不变": "The look of the whole Studio; agent runtimes stay the same", "界面、对话与终端的字号（像素）": "Font size of the interface, chats and terminals (px)", "显示活动栏": "Show the activity bar", "活动栏位置": "Activity Bar Position", "主侧栏位置": "Primary Side Bar Position", "在编辑区上方显示面包屑": "Show breadcrumbs above the editor", "在对话右侧显示缩略图": "Minimap on the right of chats", "在窗口底部显示状态栏": "Show the status bar at the bottom of the window", "左侧": "Left", "右侧": "Right", "顶部": "Top", "底部": "Bottom", "显示主侧栏": "Show the primary side bar", "显示辅助侧栏": "Show the secondary side bar", "自动滚动": "Auto Scroll", "有新内容时自动滚动到底部": "Scroll to the bottom when new content arrives", "选中文字时自动复制到剪贴板": "Copy selected text to the clipboard", "联网搜索": "Web Search", "允许 Agent 使用 web_search": "Allow agents to use web_search", "网页抓取": "Web Fetch", "允许 Agent 使用 WebFetch 读取网页": "Allow agents to read web pages with WebFetch", "Bash 与文件": "Bash and Files", "允许 Agent 运行命令、读写文件": "Allow agents to run commands and read and write files", "回顾": "Recap", "离开 30 分钟后返回时显示回顾（※ recap）": "Show a recap when returning after 30 minutes away (※ recap)", "在输入框中显示提示": "Show tips in the input box", "推理强度": "Reasoning Effort", "低": "Low", "中": "Medium", "高": "High", "很高": "Very High", "最高": "Max", "左对齐": "Left", "右对齐": "Right", "居中": "Center", "两端对齐": "Justify", "面板对齐": "Panel Alignment", "快速输入位置": "Quick Input Position", "布局密度": "Layout Density", "紧凑": "Compact", "恢复默认": "Restore Defaults", "账户": "Accounts", "未登录": "Not Signed In", "退出登录": "Sign Out", "使用 GitHub 登录…": "Sign in with GitHub…", "管理 · 有新版本": "Manage · Update Available", "重新载入以更新": "Reload to Update", "App 启动器": "App Launcher", "正在检查和下载更新…": "Checking for and downloading updates…", "下载好后 ⚙ 菜单最下面会出现「重启以更新」。": "When it's downloaded, “Restart to Update” appears at the bottom of the ⚙ menu.", "检查更新没有成功。": "Couldn't check for updates.", "有新版本": "Update available", "，已经下载好。": ", downloaded.", "当前已是最新版本": "You're up to date", "正在下载更新": "Downloading update", "重启以更新：标签页、会话都会接回去；旧版本留在「Application Support / Vibing Studio / previous」。": "Restart to update. Tabs and sessions reconnect; the old version stays in Application Support / Vibing Studio / previous.", "这台设备": "This device", "开始菜单：点活动栏上的 App 按钮弹出一块；程序坞：窗口最下面一排 App，鼠标移到窗口底边时出现": "Start menu: click the Apps button in the activity bar. Dock: a row of apps at the bottom of the window that appears when you move the pointer to the bottom edge.", "开始菜单": "Start Menu", "程序坞": "Dock", "通行密钥": "Passkeys", "通行密钥…": "Passkeys…", "管理通行密钥…": "Manage Passkeys…", "用 Touch ID、Face ID 或手机登录，不用每次都经过 GitHub；在浏览器里添加和管理": "Sign in with Touch ID, Face ID or your phone instead of going through GitHub every time. Add and manage them in your browser.", "重启以更新": "Restart to Update", "按 ⌘Q 退出后换上新版本": "Quit with ⌘Q to finish updating", "重启以换上新版本：标签页、会话都会接回去": "Restart to install the update. Tabs and sessions reconnect.", "重新载入以使用新版本": "Reload to use the new version", "检查更新…": "Check for Updates…", "连接到我的 Mac…": "Connect to My Mac…", "换一台 Mac / 断开…": "Switch Mac / Disconnect…", "选择要连接的 Mac": "Connect to which Mac", "断开连接（仅使用网页版）": "Disconnect (web only)", "正在用": "In use", "在线": "Online", "没有可连接的 Mac。": "No Mac is online.", "在 Mac 上的 Vibing Studio 里打开 设置 › 通用 › 「iPad 使用这台 Mac」。": "On your Mac, open Vibing Studio › Settings › General › “Let iPad use this Mac”.", "iPad 使用这台 Mac": "Let iPad Use This Mac", "允许 iPad 上的 Vibing Studio 连接并使用这台 Mac；终端、文件和会话均在这台 Mac 上运行": "Open code.paimon.beer in Safari on your iPad, then ⚙ › Connect to My Mac — terminals, files and sessions run on this Mac", "状态": "Status", "已连接，等待 iPad 连接": "Connected, waiting for an iPad", "正在连接…": "Connecting…", "撤销": "Revoke", "你的 Mac 现在连不上": "Can’t reach your Mac", "这台 Mac 没有允许这台设备": "This Mac hasn’t allowed this device", "重试": "Retry", "只用网页版": "Use web only", "欢迎": "Welcome", "打开链接": "Open Links", "切换到原生界面": "Switch to Native Interface", "在对话和终端中点按链接时使用的浏览器": "Where links you click in chats and terminals open", "内置浏览器": "Built-in Browser", "系统浏览器": "System Browser", "在另一个终端中运行 · 发送消息时将询问是否在此接管": "Open in another terminal · say something and you'll be asked to move it here", "在另一个终端中运行 · 请在那个终端里发送": "Running in another terminal · send from that terminal", "在此接管该会话？": "Continue here?", "接管": "Move Here", "设置配置文件": "Settings Profile", "将当前设置保存为配置文件，以便之后切换": "Save the current settings so you can switch back later", "保存…": "Save", "切换配置文件": "Switch Profile", "切换前建议先保存当前设置": "Save the current one first if you want to keep it", "选择…": "Choose…", "恢复默认设置": "Restore Default Settings", "名称和头像将保留": "Your name and avatar stay", "恢复…": "Restore…", "已存好这一套设置。": "Settings saved.", "没存成。": "Couldn’t save.", "还没有存过配置。": "No saved profiles yet.", "先点「存一份」把现在这一套存下来。": "Click “Save” to store the current settings first.", "选择要切换的配置文件": "Switch to which settings", "这份配置读不出来。": "This profile can’t be read.", "恢复默认设置？": "Restore default settings?", "所有设置将恢复为默认值（名称和头像保留）。建议先保存当前设置。": "All settings go back to their defaults (your name and avatar stay). You can save the current ones first.", "恢复": "Restore", "换": "Switch", "切换": "Switch", "当前设置将替换为该配置文件（名称和头像保留）。": "Your current settings will be replaced by this profile (your name and avatar stay).", "检查更新": "Check for Updates", "显示语言…": "Display Language…", "配置显示语言": "Configure Display Language", "选择显示语言": "Select Display Language", "将主侧栏移到右侧": "Move Primary Side Bar Right", "将主侧栏移到左侧": "Move Primary Side Bar Left", "切换主侧栏位置": "Toggle Primary Side Bar Position", "切换界面风格（Visual Studio Code + Claude Code TUI / Claude Desktop）": "Toggle Interface Style (Visual Studio Code + Claude Code TUI / Claude Desktop)", "浅灰": "Light Gray", "Visual Studio Code 浅色（Light Modern）": "Visual Studio Code Light (Light Modern)", "Visual Studio Code 深色（Dark Modern）": "Visual Studio Code Dark (Dark Modern)", "外观": "Appearance"});
  words({ "应用风格": "Application Style", "整个 Studio 的外壳": "The shell of the whole Studio", "Agent 显示风格": "Agent View Style", "对话怎么显示；Agent 的运行时不变": "How chats are displayed; agent runtimes stay the same",
    "切换 Agent 显示风格（TUI / GUI）": "Toggle Agent View Style (TUI / GUI)", "选择应用风格…": "Select Application Style…", "程序坞": "Dock", "启动台": "Launchpad", "应用程序": "Applications", "文件": "Files" });
  words({"详情": "Details", "新建独立终端…": "New Standalone Terminal…", "关闭右侧": "Close to the Right", "全部关闭": "Close All", "向上拆分": "Split Up", "向左拆分": "Split Left", "标签栏外观": "Tab Bar Appearance", "标签栏位置": "Tab Bar Position", "编辑器操作位置": "Editor Actions Position", "配置标签页…": "Configure Tabs…", "多个标签页": "Multiple Tabs", "单个标签页": "Single Tab", "标签栏": "Tab Bar", "标题栏": "Title Bar", "编辑区标签页的显示方式": "How editor tabs are shown", "拆分、更多等操作按钮的位置": "Where split, more and similar buttons go", "配置快捷键": "Configure Keybinding", "最大化面板大小": "Maximize Panel Size", "还原面板大小": "Restore Panel Size", "自定义布局…": "Customize Layout…", "切换主侧栏": "Toggle Primary Side Bar", "切换面板": "Toggle Panel", "切换辅助侧栏": "Toggle Secondary Side Bar", "新建 Agent": "New Agent", "快速打开…": "Quick Open…", "新建终端": "New Terminal", "复制路径": "Copy Path", "Pure Terminal": "Pure Terminal", "账户": "Accounts"});
  words({"通用": "General", "这个应用风格暂时没有自己的设置": "This application style has no settings of its own yet", "当前的应用风格": "Current application style", "字体": "Fonts", "界面字体": "Interface Font", "菜单、侧栏、标签页等界面元素使用的字体": "Text in menus, side bars, tabs and other chrome", "跟随应用风格": "Follow Application Style", "系统字体": "System Font", "等宽字体": "Monospace", "代码字体": "Code Font", "代码、终端和终端界面（TUI）使用的等宽字体，例如 JetBrains Mono；留空则使用 Monaco": "Monospace font for code, terminals and the TUI, e.g. JetBrains Mono; empty uses Monaco", "例如 JetBrains Mono": "e.g. JetBrains Mono", "对话字号": "Transcript Text Size", "图形界面（GUI）中对话的字号": "Text size of GUI conversations", "小": "Small", "大": "Large", "程序坞": "Dock", "程序坞位置": "Position on Screen", "程序坞大小": "Size", "图标的大小（像素）": "Icon size (px)", "放大": "Magnification", "指针悬停在程序坞上时放大图标": "Magnify icons when hovering the Dock", "自动隐藏和显示程序坞": "Automatically hide and show the Dock", "桌面": "Desktop", "桌面小组件": "Desktop Widgets", "在桌面上显示时钟、Agent、用量小组件": "Show clock, agents and usage widgets on the desktop", "侧边栏": "Sidebar", "按日期分组": "Group by Date", "会话按「今天」「更早」分组": "Group sessions into Today and Older", "右侧工具卡片": "Tool Cards", "终端、更改、浏览器卡片": "Terminal, changes and browser cards", "需要时显示": "When Needed", "始终显示": "Always", "不显示": "Never", "标签页": "Tabs", "与 iTerm 一致": "Like iTerm", "仅一个标签页时隐藏": "Hide with a Single Tab", "窗口标题": "Window Title", "在标题栏中间显示当前标签页的标题": "Show the current tab's title in the middle of the title bar", "左侧": "Left", "右侧": "Right", "底部": "Bottom"});
  words({ "应用界面字体": "App Interface Font", "Agent 界面字体": "Agent Interface Font", "跟随显示方式": "Follow View Style", "Agent 界面使用的字体：任务、子 Agent、底部状态与输入框，以及图形界面（GUI）中的对话": "The agent's own interface: tasks, subagents, the status and input at the bottom, and the whole GUI conversation" }); // 三种字：应用界面、Agent 界面、代码
  words({"复制标签页": "Duplicate Tab", "水平拆分": "Split Horizontally", "垂直拆分": "Split Vertically", "保存内容…": "Save Contents…", "关闭标签页中的所有面板": "Close All Panes in Tab", "会话": "Session", "清除缓冲区": "Clear Buffer", "上一个标签页": "Previous Tab", "下一个标签页": "Next Tab", "关闭标签页": "Close Tab", "新建标签页 (⌘T)": "New Tab (⌘T)"});
  words({"放弃更改": "Discard Changes", "新建终端": "New Terminal"});
  // 状态栏右边 App 的新版本
  words({ "App 有新版本": "App update available", "Linux 版有新版本": "Linux update available", "下载": "Download", "正在下载最新的 App，下好就重启": "Downloading the latest app; restarts when it’s done",
    "正在准备重启…": "Preparing to restart…", "会话停下来以后自动重启以更新": "Restarts to update when sessions finish", "按 ⌘Q 退出后自动换上新版本并重新打开": "Quit with ⌘Q to install the update and reopen",
    "解开安装包没有成功": "Couldn’t unpack the update", "没有这种芯片的安装包": "There’s no build for this Mac’s chip" });
  words({ "没有打开的会话": "No open sessions", "这段时间里没有会话在工作": "No session worked during this period", "请按一下指纹…": "Touch the sensor…", "还没用过": "Never used", "显示简介": "Get Info" });
  PATTERNS.push([/^上次使用 (.+)$/, "Last used $1"]);
  words({ "允许它在这台电脑上开终端、读写文件、继续会话": "Allow it to open terminals, read and write files and continue sessions on this computer", "这台电脑没有允许这台设备": "This computer hasn’t allowed this device",
    "其他设备使用这台电脑": "Let Other Devices Use This Computer", "登录时打开 Vibing Studio": "Open Vibing Studio at Login",
    "已结束（没有收到结果）": "Ended (no result received)", "已结束": "Ended" });
  PATTERNS.push([/^这台电脑不给其他设备用「(.+)」$/, "This computer doesn’t let other devices use “$1”"]);
  PATTERNS.push([/^「(.+)」要使用这台电脑$/, "“$1” wants to use this computer"]);
  PATTERNS.push(
    [/^读不到版本信息（HTTP (\d+)）$/, "Couldn’t read the version info (HTTP $1)"],
    [/^新版本（([^）]+)）(签名不完整|签它的证书已被 Apple 吊销)，没有放进待更新$/, function (m) { return "The new version (" + m[1] + ") " + (m[2] === "签名不完整" ? "has an incomplete signature" : "is signed with a certificate Apple has revoked") + ", so it wasn’t installed"; }],
    [/^换上 Vibing Studio (\S+) 并重新打开：标签页、会话都会接回去；旧版留在 Application Support\/Vibing Studio\/previous$/, "Install Vibing Studio $1 and reopen. Tabs and sessions reconnect; the old version stays in Application Support/Vibing Studio/previous"],
    [/^没能更新：([\s\S]*)$/, function (m) { return "Couldn’t update: " + sub(m[1]); }]
  );
  words({"不保存": "Don't Save", "如果不保存，你的更改将丢失。": "Your changes will be lost if you don't save them.", "重试": "Retry", "读取超时（20 秒没有读完）": "Timed out (not read within 20 seconds)", "编辑器没载入": "The editor failed to load", "用默认应用打开": "Open with Default App", "正在生成预览（快速查看）…": "Generating preview (Quick Look)…", "这里没法预览这种文件": "This file can't be previewed here", "生成预览超时": "Preview timed out", "快速查看没有生成预览": "Quick Look produced no preview"});
  words({"账号设置…": "Account Settings…"}); // 对话框的按钮（studio.js 的 ask）；Claude App 风格里提示去掉了快捷键的那一半
  words({"输入框上方": "Above the Input", "Agent 底部抽屉": "Agent Bottom Drawer", "Agent 侧栏": "Agent Side Bar"}); // 任务清单放哪
  words({"这个 agent 现在没有任务清单、后台任务和子 Agent": "This agent has no task list, background tasks or subagents right now", "打开一个 agent，这里是它的任务清单、后台任务和子 Agent": "Open an agent to see its task list, background tasks and subagents here",
    "这个会话现在没有任务": "No tasks in this session right now", "收起 / 展开": "Collapse / Expand", "还没有输出": "No output yet", "没有输出": "No output", "没有记下输出文件": "No output file was recorded for this task", "没有记下它自己的记录": "No transcript was recorded for this subagent", "找不到这条任务": "Task not found", "中断当前回合，将排队的消息合并后立即发送": "Interrupt this turn and send the queued messages now, as one","状态信息": "Status Info", "排队中": "Queued", "立即发送": "Send Now", "重新载入": "Reload", "App Exposé（仅显示同类标签页）": "App Exposé (Tabs of the Same Kind)", "标签页概览": "Tab Overview", "从这里分叉成新会话": "Fork into New Session", "固定到最上面": "Pin to Top", "取消固定": "Unpin", "归档（从列表里收起）": "Archive", "取消归档": "Unarchive", "在访达中显示会话记录": "Reveal Transcript in Finder", "在访达中显示项目文件夹": "Reveal Project Folder in Finder", "停止这一轮": "Stop Current Turn", "结束后台会话": "End Background Session", "已固定": "Pinned", "已归档": "Archived", "按 ↑ 编辑排队的消息": "Press up to edit queued messages", "排队中 · ctrl+x ctrl+s 立即发送": "Queued · ctrl+x ctrl+s to send now", "移回输入框编辑 (↑)": "Back to the input box (↑)", "打断这一轮，马上发": "Interrupt this turn and send now",
    "拿回输入框 (Esc)": "Back to the input (Esc)", "停止 (Esc)": "Stop (Esc)", "发送 (↵) · 答完接着发": "Send (↵) · queued until this turn ends",
    "没有打开的 agent": "No agent open", "打开或新建一个 agent，这里是它的任务清单、后台任务和子 Agent": "Open or create an agent to see its task list, background tasks and subagents here",
    "在辅助侧栏中显示 Agent 的任务清单（Claude Desktop 风格显示在右侧卡片中）；按 ⌃T 临时显示或隐藏": "The agent's task list, on its right (the Agent level of the secondary side bar; in Claude Desktop, the card on the right); ⌃T shows / hides it for now",
    "在辅助侧栏中显示 Agent 的后台命令": "Commands the agent runs in the background, on its right", "在辅助侧栏中显示 Agent 启动的子 Agent": "Subagents the agent sends out, on its right",
    "输入框下面：权限、余额、上下文、模型": "Under the input: access, balance, context, model", "滚动到底部": "Scroll to Bottom",
    "隐藏面板": "Hide Panel"}); // agent 右边的「任务」一家子、对话 ··· › 显示、图形界面的排队和停止
  words({"显示 / 收起文件树": "Show / Hide File Tree", "搜索文件": "Search Files", "筛选文件…（输入 ? 搜索内容）": "Filter files… (? for contents)", "拖动调整宽度；双击还原": "Drag to resize; double-click to reset",
    "在文件中查找": "Find in File", "上一个 (⇧↵)": "Previous (⇧↵)", "下一个 (↵)": "Next (↵)", "没有本机文件（只在 App 里有）": "No local files (only in the app)", "加载中…": "Loading…", "空文件夹": "Empty folder",
    "搜索内容中…": "Searching contents…", "没有匹配的文件": "No matching files", "输入要搜的内容（至少两个字）": "Type what to search for (at least 2 characters)", "没有找到": "No results", "无结果": "No results",
    "在左边选一个文件": "Select a file on the left", "打开中…": "Opening…", "文件不存在": "File not found", "这是一个文件夹": "This is a folder",
    "在编辑器标签页中打开": "Open in Editor Tab", "拷贝路径": "Copy Path", "显示隐藏文件": "Show Hidden Files"}); // 小的文件面板（filepanel.js）
  words({"助手": "Assistant", "拖动调整高度；双击还原": "Drag to resize; double-click to reset", "底部的选项": "Footer Options", "还原高度": "Reset Height", "返回 Agent 的任务": "Back to Agent Tasks", "现在没有打开的会话": "No sessions are open", "空闲": "Idle", "运行中": "Running"}); // agent 标签页的底部（能拖、···）；面板的「助手」视图
  words({"命令": "Commands", "读取 / 搜索": "Read / Search", "改文件": "Edits", "网页": "Web", "其他": "Other", "你说的话": "Your messages", "压缩": "Compaction", "上下文压缩": "Context compacted", "忙": "busy", "次调用": "tool calls", "最长": "longest", "在跑": "running", "出错": "error", "后台命令": "Background command", "现在": "now", "你": "You", "这段时间里没有会话在干活：换个更长的时间段看看": "No session was active in this period: try a longer range", "没有打开的会话：打开一个会话，这里画出它这段时间都在做什么": "No sessions open: open a session to see what it has been doing over time"});
  words({"提问卡片": "Question cards", "会话问你问题而你没在看它时，在窗口中间弹出问题卡片，可直接回答；按 Esc 稍后再答": "When a session asks you something while you’re looking elsewhere, show the question in a card in the middle of the window so you can answer right away; press Esc to answer later",
    "提问时切到前台": "Bring to front for questions", "会话问你问题时，如果 Vibing Studio 在后台，把窗口切到最前面": "When a session asks you something and Vibing Studio is in the background, bring its window to the front",
    "在菜单栏中显示 Vibing Studio 的图标。关闭窗口时 App 继续在后台运行，Agent 和命令不受影响": "Show the Vibing Studio icon in the menu bar. Closing the window keeps the app running in the background without affecting agents or commands"});
  words({"清除：": "Clear:", "过去一小时": "the last hour", "今天和昨天": "today and yesterday", "所有历史记录": "all history", "清除历史记录": "Clear History", "只清除这台 Mac 上记下的浏览和会话记录，不影响 Agent 与会话本身。": "Only the browsing and session history recorded on this Mac is cleared; agents and sessions are not affected.",
    "返回": "Back", "前进": "Forward", "最近关闭": "Recently Closed", "重新打开上次关闭的标签页": "Reopen Last Closed Tab", "显示全部历史记录": "Show All History", "清除历史记录…": "Clear History…", "菜单栏图标": "Menu bar icon", "Vibing Studio 使用手册": "Vibing Studio User Guide"});
  words({"/秒": "/s", "CPU负载": "CPU Load", "GPU负载": "GPU Load", "内存压力": "Memory Pressure", "对能耗的影响": "Energy Impact", "电池（过去12小时）": "Battery (Last 12 Hours)", "包": "Packets", "数据": "Data", "IO": "IO",
    "系统：": "System:", "用户：": "User:", "闲置：": "Idle:", "线程：": "Threads:", "进程：": "Processes:", "GPU：": "GPU:", "渲染器：": "Renderer:", "拼贴器：": "Tiler:", "占用的内存：": "Memory in use:",
    "物理内存：": "Physical Memory:", "已使用内存：": "Memory Used:", "已缓存文件：": "Cached Files:", "已使用的交换：": "Swap Used:", "App内存：": "App Memory:", "联动内存：": "Wired Memory:", "被压缩：": "Compressed:",
    "读入：": "Reads in:", "写出：": "Writes out:", "读入/秒：": "Reads in/sec:", "写出/秒：": "Writes out/sec:", "读取的数据：": "Data read:", "写入的数据：": "Data written:", "读取的数据/秒：": "Data read/sec:", "写入的数据/秒：": "Data written/sec:",
    "包接收：": "Packets in:", "包发送：": "Packets out:", "包接收/秒：": "Packets in/sec:", "包发送/秒：": "Packets out/sec:", "收到的数据：": "Data received:", "发出的数据：": "Data sent:", "下载：": "Download:", "上传：": "Upload:",
    "剩余电量：": "Remaining charge:", "剩余时间：": "Time remaining:", "充满电需要的时间：": "Time until full:", "使用交流电时间：": "Time on AC:", "使用电池时间：": "Time on battery:", "电池已充满电": "Battery Is Charged", "电池没有在充电": "Battery Is Not Charging", "正在计算…": "Calculating…",
    "最长": "max", "平均": "avg", "思考": "thinking", "输出": "output", "电池": "Battery", "能耗": "Energy", "点一下在两种之间切换": "Click to switch between the two"}); // Agent 活动底下那一条（同活动监视器的字）
  words({"Agent 活动": "Agent Activity", "没有正在运行的后台任务": "No background tasks running", "当前不是 Agent 会话": "Not an agent session", "这个会话没有后台任务": "No background tasks in this session", "后台命令": "Background commands", "等待中": "Waiting"}); // 底部面板的「Agent 活动」、后台任务卡片
  words({"要做什么？": "What would you like to do?", "回复…": "Reply…"}); // 图形界面输入框的提示字（gui.js）
  // 「设置 › 侧边栏与卡片」的会话分组（claudeGroupBy）
  words({"会话分组": "Group Sessions", "边栏中会话的分组方式（也可在边栏的筛选菜单中更改）": "How the sidebar groups sessions (also in the sidebar's filter menu)", "按连接器": "By Connector", "按日期": "By Date", "按状态": "By Status", "按文件夹": "By Folder", "不分组": "None"});
  // 连接器（ext.js、claude.js、codex.js）、外壳（TUI / GUI 下面的几种）
  words({"连接器": "Connectors", "外壳": "Wrapper", "TUI 外壳": "TUI Wrapper", "GUI 外壳": "GUI Wrapper", "Claude Code 风格": "Claude Code Style", "Claude Desktop 风格": "Claude Desktop style", "Claude App 风格": "Claude Desktop style", "Teyvat 风格": "Teyvat style",
    "以不同外观显示同一会话，适用于 Paimon、Claude Code 和 Codex 的会话": "Show the same session in another look; works for Paimon, Claude Code and Codex sessions",
    "会话在哪里运行：Paimon、这台 Mac 上的 Claude Code 和 Codex。任何连接器的会话都能用任何外壳显示": "Where sessions run: Paimon, and Claude Code and Codex on this Mac. Any connector's sessions can be shown with any wrapper",
    "启用": "Enabled", "始终开启": "Always on", "内置": "Built in", "会话已结束": "Session ended", "内置，始终可用": "Built in, always available", "只能在 Vibing Studio App 中使用": "Only available in the Vibing Studio app", "正在检测…": "Detecting…",
    "重新检测": "Detect Again", "装好或卸掉命令以后，重新查找这台 Mac 上的 claude 和 codex": "Look for claude and codex on this Mac again after installing or removing them",
    "Vibing Studio 自己的 agent：在这台 Mac 或云端（Cloud）上跑，会话跟着账号": "Vibing Studio's own agents: run on this Mac or in the Cloud, sessions follow your account",
    "这台 Mac 上的 Claude Code 会话（~/.claude）：看记录、接着说（后台会话也能），用任何外壳显示": "Claude Code sessions on this Mac (~/.claude): read transcripts and keep talking (background sessions too), with any wrapper",
    "这台 Mac 上的 Codex 会话（~/.codex）：看记录、接着说，用任何外壳显示": "Codex sessions on this Mac (~/.codex): read transcripts, keep talking, view them with any wrapper",
    "发送消息以继续此会话": "Send a message to continue this session", "发送消息以开始新会话": "Send a message to start a new session",
    "正在后台运行 · 在这里说的话会送进去": "Running in the background · what you say here is delivered to it",
    "已在其他终端中打开 · 只读（在那个终端里继续，或关掉它后在这里接着说）": "Open in another terminal · read-only (continue there, or close it and keep talking here)",
    "这是子 agent 的记录（只读），在这里说不了话。要跟它说，回到主会话里说": "This is a subagent's transcript (read-only). You can't talk to it here — say it in the main session.",
    "子 Agent 的记录为只读": "A subagent's transcript is read-only", "子 Agent 的记录 · 只读": "Subagent transcript · read-only",
    "正开在 Codex 里 · 在这里说的话会排进去（codex queue）": "Open in Codex · what you say here is queued (codex queue)",
    "上一句还在送进去，稍等一下再发": "The previous message is still being delivered; send again in a moment",
    "无法连接后台会话（12 秒内未响应）": "Couldn't attach to the background session (its screen didn't appear within 12 s)", "claude attach 启动失败": "claude attach didn't start",
    "正开在 Codex 里：模型要在 Codex 里换（这里说的话照样排进去）": "Open in Codex: switch the model in Codex (messages from here are still queued)",
    "Codex 连接器没开（设置 › 连接器）": "The Codex connector is off (Settings › Connectors)", "pi 连接器没开（设置 › 连接器）": "The pi connector is off (Settings › Connectors)", "pi 正在用这段会话：等它停下再改名": "pi is using this session. Wait for it to stop, then rename it.", "先说一句建出这段会话，再用 /name": "Send a message to start this session first, then use /name", "没能改名": "Couldn't rename", "Claude Code 连接器没开（设置 › 连接器）": "The Claude Code connector is off (Settings › Connectors)",
    "Claude Code、Codex 现在是连接器：设置 › 连接器": "Claude Code and Codex are now connectors: Settings › Connectors",
    "上下文已压缩 · 摘要": "Context compacted · summary", "上下文已压缩": "Context compacted", "新会话": "New Session", "全部折叠": "Collapse All", "下一句起生效": "applies from the next message"});
  words({"启动配置文件…": "Launch Profile…", "新建终端 (⌃⇧`)": "New Terminal (⌃⇧`)", "配置终端设置": "Configure Terminal Settings", "选择默认配置文件": "Select Default Profile", "（默认）": " (Default)", "重命名…": "Rename…", "终端名称": "Terminal name", "更改颜色": "Change Color", "更改图标": "Change Icon", "终止终端": "Kill Terminal", "红色": "Red", "绿色": "Green", "黄色": "Yellow", "蓝色": "Blue", "橙色": "Orange", "紫色": "Magenta", "青色": "Cyan"});
  words({"Agent 状态信息": "Agent Status Line", "权限、余额、模型、上下文显示在哪里（终端界面 TUI）": "Where permissions, balance, model and context are shown (TUI)", "窗口底部的状态栏": "Window Status Bar", "对话里输入框下面": "Under the Input Box"});
  // Agent 消息（··· › Agent 消息、设置 › 对话、编辑栏）：全部 / 收到的 / 发出的 / 子 Agent 报告 / 启动子 Agent
  words({"Agent 消息": "Agent Messages", "全部": "All", "收到的": "Incoming", "发出的": "Outgoing", "子 Agent 报告": "Subagent Reports", "启动子 Agent": "Spawns", "继承": "Inherit",
    "Agent 之间的消息，包括收到的、发出的消息和子 Agent 报告；在此设置会使下方各项恢复为继承": "Messages between agents: incoming, outgoing and subagent reports (choosing here puts the overrides below back to Inherit)",
    "其他 Agent 发来的消息（› Message from @…）": "Messages other agents sent to this one (› Message from @…)",
    "发给其他 Agent 的消息（SendMessage：› Message to @…），下方一行显示投递状态": "Messages this agent sent (SendMessage: › Message to @…, with where it was delivered)",
    "子 Agent 完成后返回的结果（✓ fork · … finished · 用时 · tokens）；完整显示时附带报告": "What a subagent hands back when it finishes (✓ fork · … finished · time · tokens; the report below in Full)",
    "启动子 Agent 的工具调用（与「工具 › 子 Agent」为同一设置）": "The call that launches a subagent (the same setting as Tools › Subagents)"});
  // 同一个标签页拆成几格（vsplit.js）：视图预设、拆分、反选、右边的编辑栏
  words({"视图预设": "View Preset", "拆分视图": "Split View", "默认": "Default", "跟随设置": "Follow Settings", "按 设置 › 对话": "Uses Settings › Conversation", "Claude Code 原样": "Claude Code Original", "与 Claude Code 终端界面一致": "Same as in Claude Code itself", "只看对话": "Conversation Only", "消息 + 最终回复": "Messages + final replies",
    "只看工具": "Tools Only", "调用与结果": "Calls and results", "调试": "Debug", "显示全部内容": "Everything in full", "精简": "Minimal", "最终回复 + 系统错误": "Final replies + system errors",
    "反选": "Invert", "反选当前筛选": "Invert Current Filter", "复制当前筛选": "Copy Current Filter", "选择预设": "Choose Preset", "左右排列": "Side by Side", "上下排列": "Stacked", "合并为单个视图": "Merge into One Pane",
    "编辑…": "Edit…", "保存为预设…": "Save as Preset…", "管理预设": "Manage Presets", "删除": "Delete", "删除预设": "Delete Preset", "切换预设": "Change preset", "关闭此视图": "Close this pane",
    "筛选": "Filter", "预设名称": "Preset name", "改名": "Rename", "保存": "Save", "取消": "Cancel", "关闭": "Close", "失败": "Failed",
    "隐藏当前显示的项，已隐藏的项按默认级别显示；再次反选可恢复": "Hide what's shown and show what's hidden at its default level (invert again to go back)"});
  // 对话里显示什么（··· 菜单、设置 › 对话）：工具按类，每类一个档位
  words({"读取与搜索": "Read & Search", "命令": "Commands", "文件更改": "File Changes", "网页": "Web", "子 Agent": "Subagents", "任务清单": "Task List", "其他工具": "Other Tools",
    "完整结果": "Full Result", "结果预览": "Result Preview", "仅调用": "Call Only", "完整": "Full", "预览": "Preview", "前几行": "First Lines", "一行": "One Line", "展开": "Expanded", "隐藏": "Hidden",
    "工具": "Tools", "系统": "System", "你用 ! 运行的命令": "Commands You Run with !", "合并连续的读取与搜索": "Combine Consecutive Reads & Searches", "出错的结果总是完整显示": "Always Show Failed Results in Full",
    "工具（调用与结果）": "Tools (Calls & Results)", "对话": "Conversation", "位置": "Placement", "正在读取与搜索": "Reading & searching", "显示方式与内容": "Display & Content",
    "系统错误": "System Errors", "运行状态行": "Working Status", "简洁": "Brief", "Agent 的回答": "The agent's answers", "等待重试 · ": "Waiting to retry · ",
    "时间戳": "Timestamps", "悬停时显示": "On Hover", "始终显示": "Always", "跟随编辑区": "Follow Editor",
    "在每条内容右侧显示时间，悬停可查看完整日期；设为始终显示时，在日期变化处显示分隔线": "A time beside each block (hover for the full date and time); when always shown, a date line marks each new day",
    "过程说明": "Progress Notes", "最终回复": "Final Reply", "按工具": "By Tool", "按工具…": "By Tool…", "任务说明": "Task Prompt", "子 Agent 过程": "Subagent Steps", "结果": "Result",
    "子 Agent：任务说明": "Subagent: Task Prompt", "子 Agent：过程": "Subagent: Steps", "子 Agent：结果": "Subagent: Result", "此对话尚未调用工具": "No tools used in conversations yet",
    "一轮回复中穿插在工具调用之间的说明": "The agent's text between tool calls within a turn (\"Now the title bar…\")",
    "最后一次工具调用之后 Agent 给出的回复": "What the agent tells you after its last tool call",
    "分派给子 Agent 的提示词": "The prompt given to the subagent", "子 Agent 的执行步骤（如有记录）": "The subagent's own steps (when recorded)", "子 Agent 返回的最终报告": "The report the subagent hands back",
    "为单个工具设置显示级别，优先于所属类别；仅列出此对话中使用过的工具": "Give a single tool its own mode, overriding its category; lists the tools that appear in conversations",
    "模型和工具以外的错误：API 错误（402 额度不足、429、5xx）、网络、登录与权限、沙盒不可用、中断": "Errors from neither the model nor a tool: API errors (402 out of credit, 429, 5xx), network, sign-in and permissions, sandbox unavailable, interruptions",
    "Agent 运行时显示在最下方的状态行（✢ … (12s · ↓ 579 tokens)）；隐藏后仍可按 Esc 中断，标签页图标仍显示运行状态": "The last row while an agent runs (✢ … (12s · ↓ 579 tokens · esc to interrupt)); when hidden, Esc still interrupts and the tab icon keeps spinning",
    "Read、Glob、Grep、LS": "Read, Glob, Grep, LS", "Bash、后台命令的输出": "Bash, background command output", "Edit、Write 的改动": "Edit and Write changes", "网页搜索、网页抓取": "Web search and fetch",
    "子 Agent、给别的 Agent 发消息": "Subagents, messages to other agents", "TodoWrite 与任务": "TodoWrite and tasks", "MCP 与其他工具": "MCP and other tools",
    "你发送的消息和斜杠命令": "Your messages and / commands", "Agent 的回答和出错信息": "The agent's answers and errors", "在输入框中以 ! 开头运行的命令": "Commands you run with ! in the input box",
    "将连续的读取和搜索合并为一行（如 Read 3 files, searched for 2 patterns），点按可展开每一项": "Consecutive reads and searches become one line (Read 3 files, searched for 2 patterns); click to see each",
    "无论所属类别如何设置，失败的调用始终完整显示（红色）": "Failed calls are shown in full (in red), whatever their category is set to",
    "设置对话中显示的内容：消息、思考，以及各类工具的调用与结果": "What the conversation shows: messages, thinking, and each tool category's calls and results"});
  words({"上下文窗口的用量明细": "Context window breakdown: how much each part takes", "上下文明细": "Context breakdown"}); // ctxmap.js（/context）
  words({"扩展工具": "Extension tools", "扩展说明": "Extension prompts", "系统工具": "System tools", "系统提示": "System prompt", "记忆文件": "Memory files", "你的指令": "Your instructions",
    "自动压缩预留": "Autocompact buffer", "空余": "Free space", "系统提示与工具": "System prompt & tools", "技能": "Skills", "自定义 agent": "Custom agents", "MCP 的说明": "MCP instructions",
    "估算": "est.", "文字": "Text", "还没有真实用量：按字数估算": "No usage yet: estimated from text length", "按上一轮的真实用量换算": "Scaled to the last request's actual usage",
    "按会话记录估算：系统提示与工具 = 总数 − 对话": "Estimated from the session file: system prompt & tools = total − messages",
    "按会话文件估算：每轮都带着的几块按第一次请求的真实用量分，其余算对话": "Estimated from the session file: fixed parts split from the first request's real usage; the rest is messages"}); // ctxmap.js 的卡片（英文时它自己就画英文；这里是切换语言时开着的那张）
  // Teyvat 的会话：预设、··· 里它的那几项、右侧栏（状态、意图、后台命令）
  words({
    "Teyvat 原样": "Teyvat Original", "与 Teyvat 终端界面一致": "Matches the Teyvat terminal UI", "回复": "Replies", "读取": "Reads", "命令（Execute）": "Commands (Execute)",
    "通讯（Social）": "Messaging (Social)", "意图（Intentions）": "Intentions", "等待、休眠和其他": "Wait, Hibernate and Others", "合并连续的读取": "Merge Consecutive Reads",
    "系统消息": "System Messages", "事件（重启、转后台、日期）": "Events (restarts, background, date)", "意图": "Intentions", "后台命令": "Background Commands",
    "没有在运行": "Not Running", "在终端里运行（前台）": "In a Terminal (Foreground)", "没有结果": "No result", "（沿用上一次休眠时的说明）": "(reused the previous hibernate message)",
    "它重启了，这个命令没有等到结果": "It restarted before this command finished",
  });
  PATTERNS.push([/^醒来后：([\s\S]+)$/, "After waking: $1"]);
  PATTERNS.push([/^到 (.+) 醒来$/, "Wakes at $1"]);
  PATTERNS.push([/^(\d+) 待办 · (\d+) 完成$/, "$1 to do · $2 done"], [/^(\d+) 待办$/, "$1 to do"], [/^(\d+) 完成$/, "$1 done"]);
  PATTERNS.push([/^后台命令 · (\d+) 运行中 · (\d+) 已结束$/, "Background Commands · $1 running · $2 finished"]);
  PATTERNS.push([/^(后台运行|在终端里运行（前台）|没有在运行) · (.+)$/, function (m) { return ({ "后台运行": "Running in background", "在终端里运行（前台）": "In a terminal (foreground)", "没有在运行": "Not running" })[m[1]] + " · " + m[2]; }]);
  PATTERNS.push([/^图片 × (\d+)$/, "Images × $1"]);
  // 任务翻译（translate.js；设置 › 对话 › 任务翻译、用量里那一行）
  words({"翻译回复": "Translate Replies", "回复翻译": "Reply Translation", "原文": "Original", "译文": "Translation",
    "将 Agent 的回复（不含工具输出和代码）按段落翻译为所选语言。翻译使用账户额度，结果保存在本机和账户中，相同段落不重复翻译；点按译文可查看原文": "Translate what the agent says (not tool output or code) paragraph by paragraph into the chosen language; uses your credit, translated paragraphs are kept on this device and in your account so none is translated twice; click a translation to see the original (light background), click again to switch back"});
  words({"任务翻译": "Translate Tasks", "跟随显示语言": "Follow Display Language",
    "将任务清单、后台任务、子 Agent 和运行状态行翻译为所选语言。翻译使用账户额度，结果会缓存，相同内容不重复计费；费用可在「用量」中查看": "Translate the task list, background tasks, subagents and the working line into the chosen language. Uses your credit; translations are cached, so nothing is translated twice (Usage shows what it costs)."});
  PATTERNS.push([/^(¥[\d.]+)（(\d+) 条）$/, function (m) { return m[1] + " (" + pl(m[2], "string") + ")"; }]);
  PATTERNS.push([/^最近 7 天；累计 (¥[\d.]+)（(\d+) 条）；缓存命中的不再计费$/, function (m) { return "Last 7 days; total " + m[1] + " (" + pl(m[2], "string") + "); cache hits are free"; }]);
  PATTERNS.push([/^已用 (\d+)%$/, "$1% used"], [/^累计充值 (.+)$/, "$1 credited in total"], [/^(\d+) 条消息$/, function (m) { return pl(m[1], "message"); }]); // 用量的卡片
  // 用量 › Claude Code：限额（状态行拿到的）、最近 7 天（本机记录算的）；读不到、超时的说明
  words({ "正在读取限额…": "Loading limits…", "还没有限额数据：Claude Code 的状态行刷新一次以后就有": "No limit data yet — it appears after Claude Code's status line refreshes once",
    "正在统计这台 Mac 上的记录…": "Counting the records on this Mac…", "正在统计这台 Mac 上的记录（第一次要把最近的记录读一遍，可能要十几秒）…": "Counting the records on this Mac (the first time reads all recent records and can take 10–20 seconds)…",
    "回复数": "Responses", "每天": "Daily", "5 小时限额": "5-hour limit", "每周限额": "Weekly limit", "超时": "timed out",
    "读取超时（这台 Mac 上的文件读取在排队），稍后自动重试": "Timed out (file reads on this Mac are queued); retrying shortly" });
  PATTERNS.push([/^(\d+) 次回复$/, function (m) { return pl(m[1], "response"); }],
    [/^用量没统计出来：(.+)$/, function (m) { return "Couldn't compute usage: " + sub(m[1]); }],
    [/^Claude Code 状态行拿到的（(.+)）；不向 Claude 的服务器查询$/, function (m) { return "From Claude Code's status line (" + sub(m[1]) + "); Claude's servers are not queried"; }],
    [/^这边起的 Claude Code 报的（(.+)）；不向 Claude 的服务器查询$/, function (m) { return "Reported by Claude Code started from here (" + sub(m[1]) + "); Claude's servers are not queried"; }],
    [/^输入 (\S+) · 输出 (\S+) · 缓存读取 (\S+) · 缓存写入 (\S+)$/, "Input $1 · Output $2 · Cache read $3 · Cache write $4"],
    [/^从这台 Mac 上的 Claude Code 记录算的（([^）]+)）(?:；刚才没更新成：(.+))?$/, function (m) { return "Computed from Claude Code's records on this Mac (" + sub(m[1]) + ")" + (m[2] ? "; the last refresh failed: " + sub(m[2]) : ""); }],
    [/^读取出错：(.+)$/, "Couldn't read: $1"],
    [/^显示的是上次读到的；(.+)$/, function (m) { return "Showing the last values read; " + sub(m[1]).replace(/^./, function (c) { return c.toLowerCase(); }); }]);
  // 设置 › 对话：去第二级那几行右边的「现在的样子」
  words({ "都显示": "All shown", "都隐藏": "All hidden" });
  words({ "你和它说的话、过程说明，要你确认的照样在": "Both sides of the conversation and progress notes; anything that needs your answer stays", "你自己调的（自动保存）": "Your own setup (saved automatically)",
    "一次应用下方「内容」中的全部设置；修改任一项后即为「自定义」，并自动保存": "Sets everything under Content at once; change any item and it becomes Custom (saved automatically, kept when you switch presets)",
    "删除「自定义」": "Delete “Custom”", "重命名预设": "Rename Preset", "Claude Code 的会话记录不含思考内容，此项对其无效；适用于 Paimon 和 Codex 的会话": "Claude Code sessions don't record thinking (no effect there); Paimon and Codex sessions follow this" });
  words({ "排队中 · ctrl+x ctrl+s": "Queued · ctrl+x ctrl+s to", "排队中 · ctrl+x ctrl+s ": "Queued · ctrl+x ctrl+s to " });
  words({ "选择 Vibing Studio 的样子": "Choose how Vibing Studio looks", "以后随时能在 设置 › 通用 里换": "You can change this any time in Settings › General", "推荐": "Recommended",
    "工作台：侧栏、标签页、面板；对话同 Claude Code 的终端界面": "A workbench with side bars, tabs and a panel; conversations look like Claude Code's terminal UI",
    "同 Claude 桌面 App：会话列表、图形界面的对话、右边的卡片": "Like the Claude desktop app: a session list, graphical conversations and cards on the right",
    "Visual Studio Code + 图形界面（不推荐）": "Visual Studio Code + graphical UI (not recommended)" });
  words({ "列表": "List", "时间线": "Timeline", "挪回面板": "Move to Panel", "挪到右侧栏": "Move to Secondary Side Bar", "状态": "Status", "当前操作": "Doing", "用时": "Time", "内存": "Memory", "进程": "Processes", "上下文": "Context",
    "等你": "Waiting", "在想": "Thinking", "在写回答": "Writing", "在等你回答": "Waiting for your answer", "CPU 负载": "CPU Load", "只有 Claude Code 的会话量得出 CPU、内存": "CPU and memory are measured for Claude Code sessions only",
    "没有打开的会话：打开一个会话，这里列出它在做什么、占了多少 CPU 和内存": "No open sessions: open one to see what it's doing and how much CPU and memory it uses" });
  words({ "仅显示消息与过程说明": "Just the conversation and progress notes",
    "Studio 的整体界面风格": "How the whole Studio looks", "菜单、设置和提示使用的语言": "The language of menus, settings and messages", "App 不在前台时，Agent 完成任务后发送系统通知": "Notify me when an agent finishes while the app is in the background",
    "浅色、深色或跟随系统": "Light, dark, or follow the system", "以终端界面（TUI）或图形界面（GUI）显示对话": "Show conversations as a terminal UI (TUI) or a graphical UI (GUI)", "应用于整个窗口的配色": "Colors for the whole window",
    "将任务、后台任务和运行状态行翻译为所选语言": "Translate tasks, background tasks and the working line", "将 Agent 的回复按段落翻译为所选语言；点按译文可查看原文": "Translate the agent's replies by paragraph; click a translation to see the original",
    "翻译时先显示原文，或在翻译完成后再显示": "Swap in as it translates (original first), or show only when done", "经典：与 Claude Desktop 一致；效率：每行可显示更多代码": "Classic matches Claude Desktop; Efficient fits more code per line" });
  words({ "悬停预览": "Hover Preview", "直接显示": "Show Inline", "悬停预览：显示为 [Image #N]，悬停显示缩略图，点按放大；直接显示：在对话中显示缩略图": "Hover preview: one [Image #N] line, hover for a thumbnail, click to enlarge; Show inline: thumbnails right in the conversation", "你用 ! 运行的命令": "Commands You Run with !" });
  words({ "翻译": "Translation",
    "「最大利用」会使对话占满编辑区宽度（最大约 1400 像素，两侧保留边距）。行较长时阅读可能较吃力，可随时切换回「效率」。": "“Maximum” lets the conversation fill the middle column (up to about 1400 px, with a small margin on each side). Very long lines are harder to read; you can switch back to “Efficient” any time.",
    "应用风格、显示风格、配色、语言、翻译、通知": "Application style, display style, colors, language, translation, notifications",
    "设置说明、开发者功能、长行与时间格式": "Rarely changed: setting descriptions, developer features, long lines, time format",
    "这是一个后台会话。切换模型需要向会话发送 /model，Claude Code 会同时将其保存为默认模型，之后新建的会话也将使用该模型。": "This is a background session: switching sends /model into it, and Claude Code also saves it as your default model (new sessions will use it too).",
    "换": "Switch", "切换": "Switch",
    "会话的运行位置：本机的 Claude Code 和 Codex。任何连接器的会话都可使用任意外壳显示": "Where sessions run: Claude Code and Codex on this Mac. Any connector's sessions can be shown in any shell",
    "内置": "Built-in", "对话宽度": "Conversation Width",
    "打开的 Agent": "Open Agents", "全部 Agent": "All Agents",
    "路径导航": "Breadcrumbs", "标签栏的地址": "Title bar address" }); // 「文件」「显示风格」「显示全部」这些别处已经有的（菜单栏的 File……）不在这里改
  words({ "风格": "Style", "对话宽度": "Conversation Width", "最大利用": "Maximum", "效率": "Efficient", "经典": "Classic", "经典是 Claude Desktop 的经典宽度；效率一行放得下更多代码；最大利用尽量铺满（两边留一点边）": "Classic is Claude Desktop's classic width; Efficient fits more code per line; Maximum fills the space (with a small margin)", "使用全部宽度显示对话？": "Fill the whole width?", "开启": "Turn On" }); // 不给「打开」配 Turn On：别处的「打开」是 Open
  words({ "一问（你说到它答完）": "A turn (your message → its answer)", "后台任务": "Background tasks", "闲着": "Idle", "次调用": "calls", "最后": "Last", "后台": "Background" });
  words({ "启用 Paimon": "Enable Paimon", "Studio 内置助手：不直接编写代码，负责监看正在运行的 Agent，并在需要时提醒和协助": "The assistant built into Studio: it doesn't write your code, it keeps an eye on the agents at work and lends a hand when needed", "内置助手：监看其他 Agent 的运行": "Built-in assistant that watches your other agents", "标题栏的地址": "Title bar address", "只显示站点": "Site only", "完整地址": "Full address", "窗口底部的状态栏": "The line at the bottom of the window", "键盘快捷方式": "Keyboard Shortcuts", "查看和配置所有命令的快捷键": "Shortcuts for every command" });
  words({ "柔和深色": "Soft Dark", "柔和浅色": "Soft Light", "深灰": "Dark Gray", "浅灰": "Light Gray", "默认深色（纯黑）": "Default · pure black", "默认浅色（纯白）": "Default · pure white", "Solarized 深色": "Low-contrast teal (Solarized)", "Solarized 浅色": "Low-contrast cream (Solarized)" });
  words({ "只能在 App 里搜索文件": "File search is only available in the app", "「文件」视图中已打开文件夹内的文件（名称和内容）": "Files in the folder open in the Files view: names and contents" });
  words({ "当前没有可用的更新。": "There are currently no updates available.", "有可用的更新": "An update is available", "重新载入以更新：终端、会话都会接回去。": "Reload to update. Terminals and sessions reconnect.", "稍后": "Later", "重新载入": "Reload" });
  // Claude Code 没收到的那句（claude.js：送出去后在会话记录里确认）
  words({ "被 Claude Code 的钩子拦下，未发送": "Blocked by a Claude Code hook, not sent", "Claude Code 取消时清掉了这句，未发送": "Cleared when Claude Code was cancelled, not sent",
    "Claude Code 没有收到（30 秒内未出现在会话记录中）": "Claude Code did not receive it (not in the transcript after 30 seconds)",
    "上次发送后未确认 Claude Code 已收到；确认未收到再点「重试」": "Delivery to Claude Code was not confirmed last time; tap Retry if it was not received" });
  // 代码文件：行号、按行滚动（设置 › 外观 › 代码外观；标签栏 ··· 菜单）
  words({ "行号": "Line Numbers", "在代码文件左侧显示行号": "Show line numbers to the left of code", "代码滚动": "Code Scrolling", "按行": "By Line", "平滑": "Smooth",
    "按行：滚轮和触控板一次走一整行，手感与终端中的对话一致；平滑：系统的平滑滚动": "By Line moves one whole line per wheel or trackpad step, the same feel as the chat in the terminal. Smooth uses the system's smooth scrolling." });
  words({ "宽裕": "Roomy", "精致": "Refined", "路径导航": "Breadcrumbs", "在标签页下方显示当前位置（如 Agent › 会话、文件夹 › 文件），点按任一层级可返回": "A line under the tabs showing where you are (Agent › session, folder › file); click a part to go there" });
  words({ "自动换行": "Wrap", "开（默认）": "On (Default)", "有新内容时自动滚动到底部（向上翻阅时不滚动）": "Scroll to the bottom when new content arrives (not while you're reading above)" });
  words({ "当前": "Current", "当前 · 默认": "Current · Default" });
  words({ "显示翻译过程": "Show Translating", "只显示译文": "Translation Only", "输入框下的模型与上下文": "Model & Context Under Input", "在输入框下方显示模型、上下文用量和权限模式": "The line under the input: model, context used, permission mode" });
  words({ "暂时停用（重新打开 App 后恢复）": "Disable Until Restart", "只这次启用（重新打开 App 后停用）": "Enable Until Restart" });
  words({ "检测到的": "Detected", "默认推理强度": "Default Reasoning Effort", "默认权限模式": "Default Permission Mode", "自动记忆": "Auto Memory", "设置文件": "Settings File", "编辑…": "Edit…", "安装位置": "Install Location", "未检测到": "Not detected",
    "在编辑器中打开并修改；Claude Code 会自动重新载入，此处同步更新": "Open it in the editor to change it; Claude Code reloads it and this page follows",
    "本机 Claude Code 的设置（~/.claude/settings.json），此处仅供查看；如需修改，请直接编辑该文件": "Claude Code's own settings on this Mac (~/.claude/settings.json): shown here, edit the file to change them",
    "新会话用它": "Used by new sessions", "每次修改文件或运行命令前都请求确认": "Asks you before every change or command", "自动修改文件，运行命令前请求确认": "Edits files without asking; still asks before running commands",
    "仅分析和规划，不修改文件、不运行命令": "Reads and plans only; no edits or commands", "按规则自动判断：Soft allow（允许）、Soft deny（询问）、Hard deny（拒绝）；规则可在 /permissions 中配置": "Decides by rules: Soft allow (go ahead), Soft deny (ask first), Hard deny (refuse); rules live in /permissions",
    "不请求确认，直接执行所有操作": "Never asks; does everything directly", "不请求确认，拒绝所有未授权的操作": "Never asks; refuses anything not already allowed", "（默认）": " (default)",
    "通知": "Notifications", "Agent 完成时": "When an Agent Finishes", "Agent 做完时发一条系统通知（只在 App 不在前台时）；点通知回到那个 Agent": "Send a system notification when an agent finishes (only while the app is in the background); click it to jump back" });
  words({ "打开的 Agent": "Open Agents", "全部 Agent": "All Agents", "仅搜索已打开标签页中的 Agent 会话": "Search only the agents open in tabs", "本机所有 Agent 会话": "Search every agent session on this Mac" });
  words({ "关闭…": "Close…", "只关掉这个标签页，会话在后台照常运行；之后可以从侧栏再打开。": "Only this tab closes; the session keeps running in the background and you can reopen it from the sidebar." });
  words({ "同步已开启": "Sync is On", "管理连接器…": "Manage Connectors…", "退出登录…": "Sign Out…", "账号设置…": "Account Settings…", "跟着账号走的数据会停止同步；这台 Mac 上的 Claude Code、Codex 会话不受影响。": "Data that follows your account stops syncing; Claude Code and Codex sessions on this Mac are not affected.",
    "收起前面": "Hide earlier", "暂时收起（离开这一页会自动恢复）": "Hidden for now (comes back when you leave this page)" });
  PATTERNS.push([/^(\d+) 类显示，(\d+) 类隐藏$/, "$1 shown, $2 hidden"], [/^(\d+) 项显示，(\d+) 项隐藏$/, "$1 shown, $2 hidden"]);
  PATTERNS.push([/^(.+) › (.+)$/, function (m) { return sub(m[1]) + " › " + sub(m[2]); }]); // 搜索结果里一组是哪一页：「通用 › 高级」「连接器 › Codex」
  words({"更新内容": "What's New", "墙纸": "Wallpaper", "太浩湖黄昏": "Tahoe Dusk", "翡翠湾": "Emerald Bay", "石墨": "Graphite", "黑色": "Black", "活动栏大小": "Activity Bar Size", "正常": "Normal", "关于本机": "About This Mac", "重新启动…": "Restart…", "桌面": "Desktop"});
  words({ "关于": "About", "版本与更新": "Version and updates", "版本": "Version", "界面来源": "Interface Source", "更新": "Updates", "查看": "View", "服务状态": "Service Status", "关于 Vibing Studio": "About Vibing Studio",
    "改用网站上的界面": "Use the Website Version", "网站上有更新的界面。": "The website has a newer interface.", "当前已是最新版本。": "You're up to date.", "没有切换成功。": "Couldn't switch." });
  PATTERNS.push([/^网站上有更新的界面（v(.+)）。$/, "The website has a newer interface (v$1)."],
    [/^这台 Mac 用的是本机文件夹里的一份（v(.+)）：(.+)。改用网站上的界面后，以后都跟着网站更新。$/, "This Mac uses a local copy (v$1): $2. Switch to the website version to stay up to date."],
    [/^这台 Mac 用的是本机文件夹里的一份（v(.+)）：(.+)。这一版 App 不能切换；更新 App 后会自动改用网站上的界面。$/, "This Mac uses a local copy (v$1): $2. This App version can't switch; updating the App switches to the website version automatically."]);
  words({"移到新窗口": "Move into New Window", "复制到新窗口": "Copy into New Window", "新建窗口": "New Window", "状态": "Status", "上次活跃": "Last Active", "空闲": "Idle", "使用群组": "Use Groups", "分组方式": "Group By", "排序方式": "Sort By", "升序": "Ascending", "降序": "Descending", "新建文件夹": "New Folder", "粘贴项目": "Paste Item", "显示简介": "Get Info", "分栏": "Columns", "画廊": "Gallery", "显示预览": "Show Preview", "图像": "Images", "文稿": "Documents", "开发者": "Developer"});
  var SKIP_SEL = [".term .out", ".tpane .foot", ".tpane .jump", ".xterm", ".st-term", ".gv-md", ".gv-bubble", ".gv-out", ".gv-cmd", ".gv-code", ".gv-thought",
    ".gv-todoi", ".gv-res", ".gv-diff", "pre:not(.ts-list)", "code", "textarea", "[contenteditable]", ".st-ed", ".st-doc", ".st-psample", ".xp-pre", ".xp-qlb",
    ".xp-md", ".xp-pprev", ".xp-pquote", ".dx-cx", ".dx-rx", ".dx-tx", ".dx-cn", ".dx-rn", ".dx-tn", ".st-crumbs", ".st-sh[data-h]", ".st-sgh", ".ov-shot",
    ".wb-ed", ".wb-eu", ".ts-list [data-fold*=\"cc:\"]", ".ts-list [data-fold*=\"cx:\"]:not([data-fold=\"cx:arch\"])"].join(", "); // 会话目录名是用户的；Codex 的会话行同 Claude Code 的：名字不动，只换右边的时间（「已归档」那组照换）
  var TITLE_SEL = ".tab > span, .st-ftitle, .ov-cap > span"; // 标签上的名字：只换页面的名字
  var OWN_SKIP = ".tw-t, .gv-queued"; // 直接在它们里面的字是用户的（里面的子元素照常：徽章、「排队中」）
  var NORMAL = 0, SKIP = 1, TITLE = 2, GRID = 3, TIME_M = 4; // GRID：树（.ts-list）；TIME_M：树里的一行（只换右边的时间）
  var TXT = new WeakMap(), ATT = new WeakMap(), GRIDS = new WeakMap(); // 节点 → 原来的字、换成的字（切回中文按它换回去）
  function modeAt(el) { // 从祖先看这里算哪种
    if (!el || el.nodeType !== 1) return SKIP;
    if (el.closest(SKIP_SEL)) return SKIP;
    if (el.closest(".ts-list")) return el.closest(".ts-list .ts-it") ? TIME_M : GRID;
    if (el.closest(TITLE_SEL)) return TITLE;
    return NORMAL;
  }
  function childMode(el, pm) {
    if (el.matches(SKIP_SEL)) return SKIP;
    if (pm === NORMAL) return el.matches(TITLE_SEL) ? TITLE : el.classList.contains("ts-list") ? GRID : NORMAL;
    if (pm === GRID && el.classList.contains("ts-it")) return TIME_M;
    return pm;
  }
  function ctxOf(el) { for (var i = 0; i < CTX.length; i++) if (el.matches(CTX[i][0])) return i; return -1; }
  function trText(v, mode, el) {
    if (mode === TITLE) return titleTr(v);
    if (mode === TIME_M) { var mt = split3(v), tm = timeTr(mt[1]); return tm == null ? null : mt[0] + tm + mt[2]; } // 树里 agent / 会话的一行（比例字那种画法是普通文字）：只换时间，名字是用户的
    var c = el ? ctxOf(el) : -1;
    return c < 0 ? tr(v, null, "") : tr(v, CTX[c][1], "c" + c);
  }
  // 一个文字节点：换成英文 / 换回中文
  function text(node, mode, el) {
    var v = node.data, rec = TXT.get(node);
    if (rec) {
      if (v === rec.tr) { if (lang !== "en") node.data = rec.orig; return; }
      if (v === rec.orig) { if (lang === "en") node.data = rec.tr; return; }
      TXT.delete(node); // 程序改了字：当新的看
    }
    if (lang !== "en" || !CJK.test(v) || mode === SKIP || el && el.matches(OWN_SKIP)) return;
    var t = trText(v, mode, el);
    if (t == null || t === v) return;
    TXT.set(node, { orig: v, tr: t });
    node.data = t;
  }
  function attrs(el, mode) {
    var rec = ATT.get(el);
    for (var i = 0; i < 3; i++) {
      var a = ATTRS[i], v = el.getAttribute(a);
      if (v == null || v === "") continue;
      var r = rec && rec[a];
      if (r) {
        if (v === r.tr) { if (lang !== "en") el.setAttribute(a, r.orig); continue; }
        if (v === r.orig) { if (lang === "en") el.setAttribute(a, r.tr); continue; }
        delete rec[a];
      }
      if (lang !== "en" || !CJK.test(v)) continue;
      var t = tr(v, CTX_ATTR, "a");
      if (t == null || t === v) continue;
      if (!rec) ATT.set(el, rec = {});
      rec[a] = { orig: v, tr: t };
      el.setAttribute(a, t);
    }
  }
  // ---- 主侧栏的树：TTU 的等宽格子（中文一个字一个两格宽的 span）——一段颜色整段换成一个文字节点，宽度按格子补齐 ----
  var CELL = 'span[style^="display:inline-block"]';
  var cellW = function (s) { if (window.TTU && TTU.visibleWidth) return TTU.visibleWidth(s); var n = 0; for (var i = 0; i < s.length; i++) n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(s[i]) ? 2 : 1; return n; };
  function nextText(el) { var n = el; while (n && !n.nextSibling) n = n.parentNode; n = n && n.nextSibling; return n && n.nodeType === 3 ? n : null; }
  function gridBack(el, rec) {
    el.replaceChildren.apply(el, rec.kids);
    if (rec.fix && rec.fix.node.data === rec.fix.now) rec.fix.node.data = rec.fix.orig;
    GRIDS.delete(el);
  }
  function gridSeg(el, mode) { // 换了（或换回去了）返回 true：里面不用再看
    var rec = GRIDS.get(el);
    if (rec) {
      if (el.firstChild === rec.node && !rec.node.nextSibling) { if (lang !== "en") gridBack(el, rec); return true; }
      GRIDS.delete(el);
    }
    if (lang !== "en" || el.matches(CELL) || !el.querySelector(":scope > " + CELL)) return false;
    var zh = el.textContent;
    if (!CJK.test(zh)) return false;
    var m = split3(zh), en = mode === TIME_M ? timeTr(m[1]) : look(m[1], null, 0);
    if (en == null) return false;
    en = m[0] + en + m[2];
    // 右对齐的（同一行里前面有字，中间一串补齐的空格：右边那列时间）：短了前面补空格，长了吃掉前面的空格；
    // 左对齐的（行首缩进后面的、名字后面的）：短了后面补空格，长了吃掉后面那串空格
    var d = cellW(en) - cellW(zh), prev = el.previousSibling, fix = null;
    var right = prev && prev.nodeType === 3 && (/\S {2,}$/.test(prev.data) || /^ {2,}$/.test(prev.data) && prev.previousSibling && prev.previousSibling.nodeType === 1);
    if (right) {
      if (d < 0) en = " ".repeat(-d) + en;
      else if (d > 0) { var k = Math.min(d, / +$/.exec(prev.data)[0].length - 1); if (k > 0) fix = { node: prev, orig: prev.data, now: prev.data.slice(0, -k) }; }
    } else if (d < 0) en += " ".repeat(-d);
    else if (d > 0) { var nx = nextText(el); if (nx && /^ +$/.test(nx.data) && nx.data.length > d) fix = { node: nx, orig: nx.data, now: nx.data.slice(d) }; }
    var node = document.createTextNode(en), kids = Array.prototype.slice.call(el.childNodes);
    el.replaceChildren(node);
    if (fix) fix.node.data = fix.now;
    GRIDS.set(el, { node: node, kids: kids, fix: fix });
    return true;
  }
  // 一个元素和它里面的：mode 是它自己的
  var domTree = function (el) { var l = el.closest && el.closest(".ts-list"); return !!(l && l.classList.contains("ts-dom")); };
  function visit(el, mode) {
    if (mode === SKIP) { if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") attrs(el, NORMAL); return; } // 输入框：只换提示字（placeholder），不碰里面的字
    if (el.hasAttribute("title") || el.hasAttribute("placeholder") || el.hasAttribute("aria-label") || ATT.has(el)) attrs(el, mode);
    var grid = mode === GRID || mode === TIME_M;
    if (grid && gridSeg(el, mode)) return;
    var dt = grid && domTree(el); // 比例字画的树（.ts-list.ts-dom）：字是普通文字，一个一个换（agent / 会话那一行只换时间）
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { if (!grid || dt) text(c, mode, el); }
      else if (c.nodeType === 1) visit(c, childMode(c, mode));
    }
  }
  function node(n) { // 一个新加的 / 改了的节点
    if (n.nodeType === 3) {
      var p = n.parentNode;
      if (!p || p.nodeType !== 1) return;
      var md = modeAt(p);
      if ((md === GRID || md === TIME_M) && domTree(p)) { text(n, md, p); return; }
      if (md === GRID || md === TIME_M) { var box = p.matches(CELL) ? p.parentNode : p; if (box && box.nodeType === 1) gridSeg(box, md); return; }
      text(n, md, p);
    } else if (n.nodeType === 1) visit(n, modeAt(n));
    else if (n.nodeType === 11) for (var c = n.firstChild; c; c = c.nextSibling) node(c);
  }
  // 切回中文：页面上所有换过的都换回去
  function restoreAll() {
    var body = document.body;
    if (!body) return;
    var w = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT), n = body, grids = [];
    while (n) {
      if (n.nodeType === 3) { var r = TXT.get(n); if (r && n.data === r.tr) n.data = r.orig; }
      else {
        var a = ATT.get(n);
        if (a) Object.keys(a).forEach(function (k) { if (n.getAttribute(k) === a[k].tr) n.setAttribute(k, a[k].orig); });
        if (GRIDS.has(n)) grids.push(n);
      }
      n = w.nextNode();
    }
    grids.forEach(function (el) { var rec = GRIDS.get(el); if (rec && el.firstChild === rec.node && !rec.node.nextSibling) gridBack(el, rec); });
  }

  // ---- 弹出来的（菜单、浮层）：位置是按中文的宽度算的；换成英文宽了就摆回去（右对齐的保持右边，子菜单翻到左边的也是；放不下往回收）----
  var POP_SEL = ".st-menu, .gv-pop, .st-pop";
  var lastDown = null; // 刚按下的按钮：菜单从它下面、右边对齐弹出来的要认得出
  document.addEventListener("pointerdown", function (e) { var t = e.target; lastDown = { el: t && t.closest ? t.closest("button, [data-st], [data-l], [data-t], [data-a], [data-c], .ts-act") || t : null, t: Date.now() }; }, true);
  function popFix(el, r0) {
    var r1 = el.getBoundingClientRect(), dw = r1.width - r0.width, dh = r1.height - r0.height;
    if (Math.abs(dw) < 0.5 && Math.abs(dh) < 0.5) return;
    if (el.classList.contains("gv-pop")) { // 图形界面的浮层：在按钮正上方居中、底边贴着按钮
      var hw = (el.offsetParent || el.parentNode).clientWidth, left = parseFloat(el.style.left) || 0, top = parseFloat(el.style.top) || 0;
      el.style.left = Math.max(8, Math.min(hw - r1.width - 8, left - dw / 2)) + "px";
      if (dh) el.style.top = Math.max(8, top - dh) + "px";
      return;
    }
    if (Math.abs(dw) < 0.5) return;
    var right = false;
    if (el.classList.contains("st-menu")) {
      var ms = document.querySelectorAll("body > .st-menu"), i = Array.prototype.indexOf.call(ms, el), par = i > 0 ? ms[i - 1] : null;
      if (par) right = r0.right <= par.getBoundingClientRect().left + 3; // 子菜单：右边放不下翻到了左边
      else if (lastDown && lastDown.el && lastDown.el.isConnected && Date.now() - lastDown.t < 2000) { var a = lastDown.el.getBoundingClientRect(); right = Math.abs(r0.right - a.right) < 2 && Math.abs(r0.left - a.left) > 2; }
    }
    var x = right ? r0.right - r1.width : r0.left;
    el.style.left = Math.max(4, Math.min(x, innerWidth - r1.width - 4)) + "px";
  }

  // ---- 看着页面：新加的、改了的（MutationObserver）；每次最多做 10ms，剩下的下一帧接着做；自己改出来的记录直接扔掉 ----
  var mo = null, pend = [], pendSet = new Set(), raf = 0, tmo = 0;
  function queue(n) { if (!pendSet.has(n)) { pendSet.add(n); pend.push(n); } }
  function onMut(recs) {
    var pops = [];
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (r.type === "childList") { for (var j = 0; j < r.addedNodes.length; j++) { var n = r.addedNodes[j]; if (n.nodeType === 1 && n.matches(POP_SEL)) pops.push(n); else queue(n); } }
      else if (r.type === "characterData") queue(r.target);
      else if (r.type === "attributes" && r.target.isConnected) attrs(r.target, modeAt(r.target)); // 一个属性：马上换（悬停提示别先看到中文）
    }
    pops.forEach(function (el) { if (!el.isConnected) return; var r0 = el.getBoundingClientRect(); visit(el, modeAt(el)); if (lang === "en") popFix(el, r0); });
    work();
  }
  function work() {
    var t0 = performance.now(), list = pend, i = 0;
    pend = [];
    for (; i < list.length; i++) {
      var n = list[i];
      pendSet.delete(n);
      if (n.isConnected) node(n);
      if (performance.now() - t0 > 10) { i++; break; }
    }
    if (i < list.length) pend = list.slice(i).concat(pend);
    if (mo) mo.takeRecords();
    if (pend.length && !raf) { // 下一帧接着做；窗口被挡着（不出帧）时靠定时器
      var next = function () { cancelAnimationFrame(raf); clearTimeout(tmo); raf = tmo = 0; work(); };
      raf = requestAnimationFrame(next);
      tmo = setTimeout(next, 120);
    }
  }
  function watch() {
    if (mo || !document.body) return;
    mo = new MutationObserver(onMut);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  function all() { if (document.body) { visit(document.body, modeAt(document.body)); if (mo) mo.takeRecords(); } }

  // ======== macOS 菜单栏、弹出菜单、窗口标题、系统通知：经桥发出去的字 ========
  var N = window.nadosNative, lastMenu = null, lastTitle = null;
  function menuTr(list) {
    return (Array.isArray(list) ? list : []).map(function (m) {
      if (!m || typeof m !== "object") return m;
      var o = {};
      Object.keys(m).forEach(function (k) { o[k] = m[k]; });
      if (typeof m.title === "string" && m.title) o.title = tr(m.title, CTX_MENU, "m") || m.title;
      if (typeof m.value === "string" && m.value) o.value = tr(m.value, CTX_MENU, "m") || m.value; // 右边那段灰字（现在选的是哪一档：默认、隐藏、前几行……）也换
      if (Array.isArray(m.items)) o.items = menuTr(m.items);
      return o;
    });
  }
  // 原生那几份菜单（App 菜单、编辑、窗口：browser.js 按动作给中文）：同菜单栏一样换
  function nativeTr(o) { if (!o || typeof o !== "object") return o; var r = {}; Object.keys(o).forEach(function (k) { r[k] = typeof o[k] === "string" ? tr(o[k], CTX_MENU, "m") || o[k] : o[k]; }); return r; }
  function nativeArgs(cmd, a) {
    if (!a || typeof a !== "object") return a;
    if (cmd === "menu.set") { lastMenu = a; return lang === "en" ? Object.assign({}, a, { menus: menuTr(a.menus), native: nativeTr(a.native) }) : a; }
    if (cmd === "menu.popup") return lang === "en" ? Object.assign({}, a, { items: menuTr(a.items) }) : a; // 右键菜单、··· 菜单（系统的菜单画的）
    if (cmd === "window.title") { lastTitle = a; return lang === "en" && typeof a.title === "string" ? Object.assign({}, a, { title: titleTr(a.title) || a.title }) : a; }
    if (cmd === "notify" && lang === "en") { var o = Object.assign({}, a); ["title", "subtitle", "body"].forEach(function (k) { if (typeof o[k] === "string") o[k] = tr(o[k], null, "") || o[k]; }); return o; }
    return a;
  }
  if (N) {
    if (!Object.isFrozen(N)) { var call0 = N.call; N.call = function (cmd, args) { return call0.call(N, cmd, nativeArgs(cmd, args)); }; }
    else { // 冻住的（macOS 的 bridge.js）：换它底下的 postMessage（call 每次都经过它）
      var MH = window.webkit && webkit.messageHandlers && webkit.messageHandlers.nados, post0 = MH && MH.postMessage;
      if (post0) {
        var hook = function (msg) { if (msg && typeof msg === "object" && typeof msg.cmd === "string") { try { msg = { cmd: msg.cmd, args: nativeArgs(msg.cmd, msg.args) }; } catch (e) { console.error(e); } } return post0.call(MH, msg); };
        try { MH.postMessage = hook; } catch (e) { /* 不让换 */ }
        if (MH.postMessage !== hook) try { Object.defineProperty(MH, "postMessage", { value: hook, configurable: true, writable: true }); } catch (e) { /* 不让换就算了：菜单栏留中文 */ }
      }
    }
  }
  // 换了语言：上一份菜单、窗口标题按新的语言再发一次（browser.js 只在它自己的那份变了才重发）
  function resendNative() {
    if (!N) return;
    if (lastMenu) N.call("menu.set", lastMenu).catch(noop);
    if (lastTitle) N.call("window.title", lastTitle).catch(noop);
  }
  // 浏览器自己的对话框（确认放弃更改这些）：字也换
  ["alert", "confirm", "prompt"].forEach(function (k) {
    var f = window[k];
    if (typeof f !== "function") return;
    window[k] = function (msg) { var a = Array.prototype.slice.call(arguments); if (lang === "en" && typeof msg === "string") a[0] = tr(msg, null, "") || msg; return f.apply(window, a); };
  });

  // ======== 语言：读、换、跟着设置走 ========
  var subs = [];
  function readSet() { try { var s = JSON.parse(localStorage.getItem("st-settings") || "{}"); return s && typeof s === "object" && !Array.isArray(s) ? s : {}; } catch (e) { return {}; } }
  // 设置里的 lang：zh / en / auto（默认：跟随系统——系统的首选语言是中文就中文，别的都是英文）
  // 系统语言：iPad App 里用它报上来的（App 没声明语言时网页这边一律拿到 en——「跟随显示语言」就翻成了英文，和 Mac 那边对不上）
  var sysLang = function () { var l = (window.vsApp && window.vsApp.lang) || (navigator.languages && navigator.languages[0]) || navigator.language || ""; return /^zh/i.test(l) ? "zh" : "en"; };
  var norm = function (l) { return l === "en" || l === "zh" ? l : sysLang(); };
  function apply(l) {
    l = norm(l);
    if (l === lang) return false;
    lang = l;
    root.setAttribute("data-lang", l);
    if (l === "en") { watch(); all(); } // 用过英文以后一直看着：挪开又放回来的节点（换过标签页的面板）也要换回去
    else { restoreAll(); if (mo) mo.takeRecords(); }
    resendNative();
    subs.slice().forEach(function (fn) { try { fn(l); } catch (e) { console.error(e); } });
    return true;
  }
  var lastRaw;
  function sync() { // 设置变了（设置页、设置文件、别的窗口）：跟上；预览（STUDIO.previewSet("lang", …)，不存）先用预览的
    var raw = null, pv = window.STUDIO && STUDIO.previewOf ? STUDIO.previewOf("lang") : undefined;
    try { raw = localStorage.getItem("st-settings"); } catch (e) { /* 读不了 */ }
    if (pv) raw += "|" + pv;
    if (raw === lastRaw) return;
    lastRaw = raw;
    apply(pv || readSet().lang);
  }
  function set(l) {
    l = l === "en" || l === "zh" ? l : "auto"; // 记下的是选的那个（auto 就记 auto），显示的是它换算出来的
    if ((readSet().lang || "auto") !== l) {
      if (window.STUDIO && STUDIO.setv) STUDIO.setv("lang", l); // 写回设置文件（~/.paimon/studio.json）
      else { var s = readSet(); s.lang = l; try { localStorage.setItem("st-settings", JSON.stringify(s)); } catch (e) { /* 满了 */ } }
    }
    try { lastRaw = localStorage.getItem("st-settings"); } catch (e) { /* 读不了 */ }
    apply(l);
    return lang;
  }
  root.setAttribute("data-lang", "zh");
  if (document.body) sync(); else document.addEventListener("DOMContentLoaded", sync);
  document.addEventListener("DOMContentLoaded", function () { if (lang === "en") all(); });
  document.addEventListener("st-settings-changed", sync);
  window.addEventListener("storage", function (e) { if (!e.key || e.key === "st-settings") sync(); });
  setInterval(function () { if (!document.hidden) sync(); }, 500);

  window.TSU_I18N = {
    lang: function () { sync(); return lang; },
    set: set,
    t: function (s) { if (lang !== "en" || typeof s !== "string") return s; var r = tr(s, null, ""); return r == null ? s : r; },
    onChange: function (fn) { if (typeof fn === "function") subs.push(fn); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; },
    // 别处补词：add({ 中文: 英文 })
    add: function (o) { if (o && typeof o === "object") { words(o); cache.clear(); if (lang === "en") all(); } },
    refresh: function () { if (lang === "en") all(); },
    // 一个属性原来（换成英文之前）的字：别处要把它存起来再放回去（比如 Claude App 里去掉提示里的快捷键）时存这个，换了语言也对得上
    orig: function (el, a) { var v = el && el.getAttribute ? el.getAttribute(a) : null, r = el && ATT.get(el), x = r && r[a]; return x && v === x.tr ? x.orig : v; },
  };
})();
