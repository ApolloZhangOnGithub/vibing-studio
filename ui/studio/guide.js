// guide.js —— Vibing Studio 使用手册（同 Safari 使用手册）：左边目录（按章节，能收起），右边一篇一篇的说明；上面搜索；每篇底下「另请参阅」和上一篇 / 下一篇。
//   入口：菜单栏「帮助 › Vibing Studio 使用手册」、命令面板。TSU_GUIDE.open(tw, 篇的 id)
//   写法：每篇 [中文, English]；正文里 [[⌘T]] 画成按键，{{id|字}} 是到另一篇的链接
(function () {
  "use strict";
  if (window.TSU_GUIDE) return;
  var S = window.STUDIO;
  if (!S || !S.pages) return;
  var en = function () { return !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"); };
  var L = function (x) { return Array.isArray(x) ? (en() ? x[1] : x[0]) : x; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var ICON = '<i class="st-ico st-i-svg"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5c2-1 4-1 5.5.5v9c-1.5-1.5-3.5-1.5-5.5-.5zM13.5 3.5c-2-1-4-1-5.5.5v9c1.5-1.5 3.5-1.5 5.5-.5z"/></svg></i>';

  // ---- 内容 ----
  var BOOK = [
    { t: ["开始使用", "Get started"], topics: [
      { id: "welcome", t: ["欢迎使用 Vibing Studio", "Welcome to Vibing Studio"], b: [
        "<p>Vibing Studio 把这台 Mac 上的 Claude Code、Codex 会话和 Paimon Agent 放在同一个窗口里：查看它们正在做什么、接着对话、管理排队的消息和后台任务，并随时了解它们占用了多少资源。</p><p>对话按 Claude Code 终端的样子显示——同样的符号、颜色和折叠方式——所以在终端里熟悉的操作在这里也一样。</p><p>要开始，请参阅 {{open|打开会话}}。</p>",
        "<p>Vibing Studio brings the Claude Code and Codex sessions on this Mac, along with Paimon agents, into one window: see what they’re doing, keep the conversation going, manage queued messages and background tasks, and keep an eye on the resources they use.</p><p>Conversations look the way they do in the Claude Code terminal — the same symbols, colors and folding — so what you know from the terminal works here too.</p><p>To begin, see {{open|Open a session}}.</p>"],
        see: ["open", "styles"] },
      { id: "open", t: ["打开会话", "Open a session"], b: [
        "<p>主侧栏的「Agents」列出这台 Mac 上最近的 Claude Code 会话（读取 <code>~/.claude</code>）、打开了 Codex 连接器时的 Codex 会话，以及 Paimon Agent。点按一个会话即可在标签页中打开。</p><ul><li>新建会话：按 [[⌘T]]。</li><li>按名称或内容查找会话：在侧栏顶部的搜索框中输入。</li><li>重新打开以前看过的会话：参阅 {{history|浏览历史记录}}。</li></ul><p>正在后台运行的会话（由 Claude Code 后台服务托管）同样可以打开、发送消息和中断。</p>",
        "<p>The Agents list in the primary side bar shows recent Claude Code sessions on this Mac (read from <code>~/.claude</code>), Codex sessions when the Codex connector is on, and Paimon agents. Click a session to open it in a tab.</p><ul><li>New session: press [[⌘T]].</li><li>Find a session by name or content: type in the search field at the top of the side bar.</li><li>Reopen a session you viewed before: see {{history|Browse your history}}.</li></ul><p>Sessions running in the background (hosted by the Claude Code background service) can be opened, messaged and interrupted the same way.</p>"],
        see: ["send", "tabs"] },
      { id: "styles", t: ["选择外观", "Choose a look"], b: [
        "<p>点按窗口左下角的 ⚙，选择「风格」可在 Visual Studio Code 风格（[[⌃⌘1]]）、Claude Desktop 风格（[[⌃⌘2]]）等几种布局之间切换；「主题」更换配色；「自定义布局」决定侧栏、面板的位置；「显示语言」在简体中文和英文之间切换。</p><p>所有设置都在「设置」中（[[⌘,]]）。</p>",
        "<p>Click ⚙ in the lower-left corner of the window and choose Style to switch between layouts such as Visual Studio Code style ([[⌃⌘1]]) and Claude Desktop style ([[⌃⌘2]]); Theme changes the colors; Customize Layout sets where the side bars and panel go; Display Language switches between Simplified Chinese and English.</p><p>Every option is in Settings ([[⌘,]]).</p>"],
        see: ["tabs", "keys"] },
    ] },
    { t: ["与会话交谈", "Talk to a session"], topics: [
      { id: "send", t: ["发送消息", "Send a message"], b: [
        "<p>在对话底部的输入框中输入，按 [[Return]] 发送；按 [[⇧Return]] 换行。</p><p>会话正在工作时发送的消息会进入 Claude Code 自己的队列，显示在对话末尾，并在当前步骤结束后被读取。参阅 {{queue|排队的消息}}。</p><p>按 [[Esc]] 中断正在进行的回答；正在运行的命令可以按 [[⌃B]] 放到后台继续运行，也可以点按提示中的「run in background」。</p>",
        "<p>Type in the input field at the bottom of the conversation and press [[Return]] to send; press [[⇧Return]] for a new line.</p><p>Messages sent while the session is working go into Claude Code’s own queue, appear at the end of the conversation and are read when the current step finishes. See {{queue|Queued messages}}.</p><p>Press [[Esc]] to interrupt a reply. A running command can be moved to the background with [[⌃B]], or by clicking “run in background” in its hint.</p>"],
        see: ["queue", "images"] },
      { id: "queue", t: ["排队的消息", "Queued messages"], b: [
        "<p>排队中的消息以较暗的样式列在对话末尾，下面是可点按的提示：</p><ul><li><b>send now</b>：立即交给会话（同在 Claude Code 中按 [[⌃X]] [[⌃S]]），不必等当前步骤结束。点按一次即生效，发送期间不能重复点按。</li><li><b>edit</b>：把排队的消息全部取回输入框修改（同 Claude Code 在空输入框中按 [[↑]]）。修改后重新发送即可。</li></ul><p>会话正在压缩上下文时，排队的消息会在压缩完成后自动发送。由 /goal 等命令自动排入的消息只显示，不能修改，也不提供 send now。</p>",
        "<p>Queued messages are listed dimmed at the end of the conversation, followed by clickable hints:</p><ul><li><b>send now</b>: hands them to the session right away (like [[⌃X]] [[⌃S]] in Claude Code) without waiting for the current step. One click is enough; it can’t be clicked again while sending.</li><li><b>edit</b>: takes all queued messages back into the input field for editing (like [[↑]] in an empty Claude Code prompt). Send again when you’re done.</li></ul><p>While the session is compacting its context, queued messages are sent automatically when compaction finishes. Entries queued automatically by commands such as /goal are shown but can’t be edited and have no send now.</p>"],
        see: ["send"] },
      { id: "images", t: ["附加图片", "Attach images"], b: [
        "<p>把图片粘贴到输入框，或从访达拖到窗口中。输入框中出现「[Image #N]」，编号接着会话中已有的图片往下排。</p><p>图片按 Claude Code 的方式作为图片附件发送，模型直接看到图片本身。对话和排队的消息中，每张图片下面有一行「⎿ [Image #N]」：指针悬停可预览，点按可放大。</p>",
        "<p>Paste an image into the input field or drag one in from the Finder. “[Image #N]” appears in the input, numbered after the images already in the session.</p><p>Images are sent the way Claude Code sends them — as image attachments the model sees directly. In the conversation and in queued messages, each image has a “⎿ [Image #N]” line below it: hover to preview, click to enlarge.</p>"],
        see: ["send", "read"] },
      { id: "needs", t: ["需要你处理的会话", "Sessions that need you"], b: [
        "<p>会话在等你回答问题或批准操作时：</p><ul><li>它的标签页图标变为蓝色；</li><li>输入框上方的状态行右侧显示「awaiting input」和会话名称，点按即可前往；</li><li>程序坞中的图标显示等待的数量；</li><li>你没在看这个会话时，会收到一条系统通知。</li></ul><p>这些提示都不会弹出对话框打断你。</p>",
        "<p>When a session is waiting for your answer or approval:</p><ul><li>its tab icon turns blue;</li><li>the status row above the input shows “awaiting input” and the session’s name — click it to go there;</li><li>the app icon in the Dock shows how many are waiting;</li><li>you get a system notification if you aren’t looking at that session.</li></ul><p>None of these interrupt you with a dialog.</p>"],
        see: ["activity"] },
    ] },
    { t: ["阅读对话", "Read a conversation"], topics: [
      { id: "read", t: ["展开和收起工具调用", "Expand and collapse tool calls"], b: [
        "<p>每次工具调用显示为一行「● 工具(参数)」，下面是结果摘要。点按工具名称可展开完整结果，再次点按恢复原来的显示。连续的读取、搜索和命令合并成一行，例如「Read 3 files」，点按可看到每一条。</p><p>按 [[⌃O]] 展开或收起全部细节（同 Claude Code）。在「设置」中可分别设置每类工具默认显示的详细程度。</p>",
        "<p>Each tool call appears as “● Tool(arguments)” with a summary of the result below. Click the tool name to expand the full result; click again to return to the original view. Consecutive reads, searches and commands are merged into one line such as “Read 3 files”; click it to see each one.</p><p>Press [[⌃O]] to expand or collapse all details (as in Claude Code). In Settings you can choose how much each kind of tool shows by default.</p>"],
        see: ["sticky"] },
      { id: "sticky", t: ["往上翻阅时找到所在的提问", "Find your place while scrolling back"], b: [
        "<p>向上翻阅较长的对话时，最上方一行显示当前看到的这一段属于哪一次提问；点按它即可跳到那次提问。提问本身就在眼前时不显示，回到对话底部时自动隐藏。</p><p>可在「设置 › 高级」中关闭。</p>",
        "<p>While scrolling back through a long conversation, the top row shows which prompt the visible section belongs to; click it to jump to that prompt. It’s hidden when the prompt itself is on screen and when you return to the bottom.</p><p>Turn it off in Settings › Advanced.</p>"],
        see: ["read"] },
    ] },
    { t: ["窗口与标签页", "Windows and tabs"], topics: [
      { id: "tabs", t: ["使用标签页", "Use tabs"], b: [
        "<p>每个会话、页面都在一个标签页中。拖动标签页可调整顺序，插入线显示放下的位置；把标签页拖出标签栏可放进新窗口。</p><p>按 [[⌘W]] 关闭当前标签页。重新打开刚关闭的会话，或打开上次退出时开着的标签页，可使用「历史记录」菜单。</p>",
        "<p>Each session and page lives in a tab. Drag a tab to reorder; an insertion line shows where it will land. Drag a tab out of the tab bar to move it into a new window.</p><p>Press [[⌘W]] to close the current tab. To reopen a session you just closed, or the tabs that were open when you last quit, use the History menu.</p>"],
        see: ["history", "panels"] },
      { id: "panels", t: ["侧栏和面板", "Side bars and the panel"], b: [
        "<p>[[⌘B]] 显示或隐藏主侧栏，[[⌥⌘I]] 显示或隐藏辅助侧栏，[[⌘J]] 显示或隐藏底部面板。面板中有终端、Agent 活动、后台任务等视图，点按面板顶部的名称切换；拖动面板的上边缘调整高度，双击面板标题可让高度刚好容纳内容。</p>",
        "<p>[[⌘B]] shows or hides the primary side bar, [[⌥⌘I]] the secondary side bar, and [[⌘J]] the panel. The panel holds views such as Terminal, Agent Activity and Background Tasks — click a name at the top of the panel to switch. Drag the top edge of the panel to resize it; double-click the panel’s title to fit its height to the content.</p>"],
        see: ["activity", "tasks"] },
    ] },
    { t: ["了解会话和这台 Mac 的状态", "Monitor sessions and your Mac"], topics: [
      { id: "activity", t: ["Agent 活动", "Agent Activity"], b: [
        "<p>Agent 活动按活动监视器的方式排列：上方是页签，中间是打开的会话，底部是这台 Mac 的资源概况。</p><figure class=\"gd-fig\"><img src=\"studio/guide/activity.png\" alt=\"\"><figcaption>Agent 活动：中间是会话，底部是「概览」</figcaption></figure><ul><li><b>会话</b>：状态（工作中、等待处理、空闲，括号中是正在做的事或正在运行的程序）、用时、CPU、内存、进程数和上下文用量。点按列标题排序；点按一个会话可就地展开它的进程，再次点按收起；按住 Control 点按（右键）可打开该会话。</li><li><b>合计</b>：CPU、内存、进程相加；用时显示最长的一个，上下文显示平均值。</li><li><b>底部</b>：「概览」一次显示 CPU、GPU、内存、磁盘、网络和电池；其他页签显示与活动监视器相同的数据和图表，每秒更新。磁盘和网络的图表标题可点按，在 IO / 包与数据之间切换。</li></ul><p>面板标题栏右侧的按钮可切换到时间线、让 Agent 活动浮在所有标签页上方，或移到右侧栏。</p><figure class=\"gd-fig\"><img src=\"studio/guide/activity-net.png\" alt=\"\"><figcaption>「网络」页签：左侧是包，右侧是数据，中间的图表可在包和数据之间切换</figcaption></figure>",
        "<p>Agent Activity is arranged like Activity Monitor: tabs on top, open sessions in the middle and an overview of this Mac’s resources at the bottom.</p><figure class=\"gd-fig\"><img src=\"studio/guide/activity.png\" alt=\"\"><figcaption>Agent Activity: sessions in the middle, Overview at the bottom</figcaption></figure><ul><li><b>Sessions</b>: status (Working, Needs input, Idle — with what it’s doing or the program it’s running in parentheses), elapsed time, CPU, memory, process count and context use. Click a column title to sort; click a session to expand its processes in place, click again to collapse; Control-click (right-click) to open the session.</li><li><b>Total</b>: CPU, memory and processes add up; elapsed time shows the longest and context shows the average.</li><li><b>Bottom</b>: Overview shows CPU, GPU, memory, disk, network and battery at once; the other tabs show the same numbers and charts as Activity Monitor, updated every second. Click the disk or network chart title to switch between IO / packets and data.</li></ul><p>Buttons on the right of the panel title switch to the timeline, float Agent Activity above all tabs, or move it to the secondary side bar.</p><figure class=\"gd-fig\"><img src=\"studio/guide/activity-net.png\" alt=\"\"><figcaption>The Network tab: packets on the left, data on the right; the chart switches between the two</figcaption></figure>"],
        see: ["tasks", "needs"] },
      { id: "tasks", t: ["后台任务", "Background tasks"], b: [
        "<p>「后台任务」列出当前会话在后台运行的命令和子 Agent：运行了多久、最近的输出。正在运行的命令可以从对话中按 [[⌃B]] 放到后台。</p>",
        "<p>Background Tasks lists the commands and sub-agents the current session is running in the background, with how long they’ve run and their latest output. A running command can be moved to the background from the conversation with [[⌃B]].</p>"],
        see: ["activity", "send"] },
    ] },
    { t: ["历史记录与更新", "History and updates"], topics: [
      { id: "history", t: ["浏览历史记录", "Browse your history"], b: [
        "<figure class=\"gd-fig\"><img src=\"studio/guide/history.png\" alt=\"\"><figcaption>历史记录：按天分组，网站和地址两列</figcaption></figure><p>选择「历史记录 › 显示全部历史记录」（[[⌘Y]]）。历史记录按天分组：今天和昨天默认展开，更早的日期以及条目较多的日期默认收起，点按日期可展开或收起。</p><ul><li>单击选中一条，双击或按 [[Return]] 打开；</li><li>按 [[Delete]] 删除选中的一条；</li><li>直接输入文字即可搜索标题和地址，按 [[Esc]] 离开搜索框；</li><li>「清除历史记录…」删除全部记录。</li></ul>",
        "<figure class=\"gd-fig\"><img src=\"studio/guide/history.png\" alt=\"\"><figcaption>History, grouped by day, with Website and Address columns</figcaption></figure><p>Choose History › Show All History ([[⌘Y]]). History is grouped by day: today and yesterday start expanded, while earlier days and days with many entries start collapsed — click a day to expand or collapse it.</p><ul><li>Click to select an entry; double-click or press [[Return]] to open it;</li><li>press [[Delete]] to remove the selected entry;</li><li>just start typing to search titles and addresses, and press [[Esc]] to leave the search field;</li><li>Clear History… removes everything.</li></ul>"],
        see: ["tabs", "open"] },
      { id: "updates", t: ["更新 Vibing Studio", "Update Vibing Studio"], b: [
        "<p>界面部分会自动更新，重新载入窗口即生效。App 本身有新版本时，状态栏显示「App 有新版本 · 重启以更新」，⚙ 上出现标记；点按后原地替换并重新打开，旧版本保留在「Application Support」中，不会移到废纸篓。</p><p>每个版本的变化见「帮助 › 更新内容」。</p>",
        "<p>The interface updates automatically and takes effect when you reload the window. When a newer version of the app itself is ready, the status bar shows “App update · Restart to update” and ⚙ shows a badge; click it to replace the app in place and reopen it. The previous version is kept in Application Support, not moved to the Trash.</p><p>See Help › Release Notes for what changed in each version.</p>"],
        see: ["styles"] },
      { id: "keys", t: ["键盘快捷方式", "Keyboard shortcuts"], b: [
        "<p>常用的快捷方式：</p><ul><li>[[⌘T]] 新建会话，[[⌘W]] 关闭标签页</li><li>[[⇧⌘P]] 命令面板，[[⌘,]] 设置</li><li>[[⌘B]] 主侧栏，[[⌥⌘I]] 辅助侧栏，[[⌘J]] 面板</li><li>[[⌘Y]] 历史记录</li><li>对话中：[[Esc]] 中断，[[⌃B]] 放到后台，[[⌃O]] 展开全部，[[⌃X]] [[⌃S]] 立即发送排队的消息，空输入框中按 [[↑]] 取回排队的消息</li></ul><p>完整列表见「帮助 › 键盘快捷方式」。</p>",
        "<p>Frequently used shortcuts:</p><ul><li>[[⌘T]] new session, [[⌘W]] close tab</li><li>[[⇧⌘P]] Command Palette, [[⌘,]] Settings</li><li>[[⌘B]] primary side bar, [[⌥⌘I]] secondary side bar, [[⌘J]] panel</li><li>[[⌘Y]] History</li><li>In a conversation: [[Esc]] interrupt, [[⌃B]] move to background, [[⌃O]] expand all, [[⌃X]] [[⌃S]] send queued messages now, [[↑]] in an empty input takes queued messages back</li></ul><p>For the full list, choose Help › Keyboard Shortcuts.</p>"],
        see: ["send", "queue"] },
      { id: "privacy", t: ["数据与隐私", "Data and privacy"], b: [
        "<p>Vibing Studio 直接读取这台 Mac 上 Claude Code（<code>~/.claude</code>）和 Codex（<code>~/.codex</code>）的会话记录，在本机显示，不另外上传。消息由 Claude Code、Codex 自己发送给各自的服务。系统资源的数据来自 macOS 自带的工具，不需要管理员权限。</p>",
        "<p>Vibing Studio reads the session records of Claude Code (<code>~/.claude</code>) and Codex (<code>~/.codex</code>) directly on this Mac and shows them locally without uploading them anywhere else. Messages are sent by Claude Code and Codex themselves to their own services. System resource data comes from tools built into macOS and needs no administrator access.</p>"],
        see: ["open"] },
    ] },
    { t: ["在 iPhone 上使用", "Use on iPhone"], topics: [
      { id: "iphone-layout", t: ["iPhone 上的布局", "The iPhone layout"], b: [
        "<p>在 iPhone 上，Vibing Studio 显示与 Mac 上相同的工作台，并按手机重新排布：标签页位于屏幕最上方；在带灵动岛的机型上竖着拿时，标签页排在灵动岛左侧，全屏和「···」按钮在右侧。</p><p>切换主侧栏、面板、辅助侧栏，打开浏览器、标签页概览，新建标签页，以及拆分编辑区，都在标签栏的「···」中。</p><figure class=\"gd-fig\"><img src=\"studio/guide/iphone-layout.png\" alt=\"\"><figcaption>点按「···」：上面是布局的几项，下面是对话的显示方式</figcaption></figure><p>若想像在 Mac 上一样把这些按钮都摆出来，前往「设置 › 布局 › 布局按钮」，选择「经典」。</p>",
        "<p>On iPhone, Vibing Studio shows the same workbench as on the Mac, rearranged for the phone: tabs sit at the very top; on models with the Dynamic Island, held upright, the tabs sit to the left of the island and the full-screen and “···” buttons to its right.</p><p>Showing the side bars and the panel, opening the browser and the tab overview, creating tabs and splitting the editor are all in the tab bar’s “···”.</p><figure class=\"gd-fig\"><img src=\"studio/guide/iphone-layout.png\" alt=\"\"><figcaption>Tap “···”: layout items on top, conversation display options below</figcaption></figure><p>To show all the buttons as on the Mac, go to Settings › Layout › Layout Buttons and choose Classic.</p>"],
        see: ["iphone-focus", "iphone-sidebar", "panels"] },
      { id: "iphone-sidebar", t: ["打开会话列表", "Open the session list"], b: [
        "<p>点按左侧活动栏中的 Agents 图标，会话列表从左边盖在对话上方拉出。点按一个会话即可打开，列表随即收回；点按对话区域也会收回。</p><figure class=\"gd-fig\"><img src=\"studio/guide/iphone-sidebar.png\" alt=\"\"><figcaption>点按 Agents 图标，会话列表从左边拉出</figcaption></figure>",
        "<p>Tap the Agents icon in the activity bar on the left; the session list slides in over the conversation. Tap a session to open it and the list closes; tapping the conversation also closes it.</p><figure class=\"gd-fig\"><img src=\"studio/guide/iphone-sidebar.png\" alt=\"\"><figcaption>Tap the Agents icon and the session list slides in</figcaption></figure>"],
        see: ["open", "iphone-layout"] },
      { id: "iphone-focus", t: ["全屏只看对话", "Show only the conversation"], b: [
        "<p>点按标签栏「···」左侧的全屏按钮，屏幕上只留下当前对话和输入框。点按右上角的缩小按钮即可返回。</p><figure class=\"gd-fig\"><img src=\"studio/guide/iphone-focus.png\" alt=\"\"><figcaption>全屏前后</figcaption></figure>",
        "<p>Tap the full-screen button to the left of “···” in the tab bar to keep only the current conversation and the input field on screen. Tap the shrink button at the top right to return.</p><figure class=\"gd-fig\"><img src=\"studio/guide/iphone-focus.png\" alt=\"\"><figcaption>Before and after full screen</figcaption></figure>"],
        see: ["iphone-layout"] },
      { id: "iphone-images", t: ["在 iPhone 上附加图片", "Attach images on iPhone"], b: [
        "<p>点按输入框右上角的「···」，或长按输入框，选择「添加图片…」，即可从相册选取或拍照。图片以「[Image #N]」的形式插入光标处，随消息一起作为图片发送。</p><figure class=\"gd-fig\"><img src=\"studio/guide/iphone-images.png\" alt=\"\"><figcaption>输入框的「···」菜单</figcaption></figure>",
        "<p>Tap “···” at the top right of the input field, or touch and hold the input field, then choose Add Images… to pick from Photos or take a photo. Each image is inserted at the cursor as “[Image #N]” and sent with the message as an image.</p><figure class=\"gd-fig\"><img src=\"studio/guide/iphone-images.png\" alt=\"\"><figcaption>The input field’s “···” menu</figcaption></figure>"],
        see: ["images", "send"] },
      { id: "iphone-copy", t: ["拷贝对话中的文字", "Copy text from the conversation"], b: [
        "<p>为避免误触整屏选中，iPhone 和 iPad 上对话区域不能直接拖动选字。要拷贝某一段内容，长按这一段，在菜单中选择「复制这一段」。</p>",
        "<p>To avoid selecting the whole screen by accident, text in the conversation can’t be drag-selected on iPhone and iPad. To copy a block, touch and hold it, then choose Copy This Block.</p>"],
        see: ["read"] },
      { id: "iphone-landscape", t: ["横着拿时输入", "Type in landscape"], b: [
        "<p>横着拿 iPhone 时，键盘会遮住屏幕下半部分。此时输入框会移到最上方，对话显示在它下面；收起键盘后恢复原样。</p><figure class=\"gd-fig\"><img src=\"studio/guide/iphone-landscape.png\" alt=\"\"><figcaption>横屏打字时，输入框在最上方</figcaption></figure>",
        "<p>When you hold iPhone sideways, the keyboard covers the lower part of the screen. While it’s up, the input field moves to the top with the conversation below it; it returns when the keyboard goes away.</p><figure class=\"gd-fig\"><img src=\"studio/guide/iphone-landscape.png\" alt=\"\"><figcaption>Typing in landscape: the input field is at the top</figcaption></figure>"],
        see: ["iphone-layout"] },
    ] },
  ];
  var ALL = [], BYID = {};
  BOOK.forEach(function (ch, ci) { ch.topics.forEach(function (tp) { tp.ch = ci; ALL.push(tp); BYID[tp.id] = tp; }); });

  // ---- 画 ----
  var st = { cur: "welcome", q: "", shut: {} };
  var kc = function (k) { return S.keycaps ? S.keycaps(k) : "<kbd>" + esc(k) + "</kbd>"; };
  var html = function (s) {
    return String(s).replace(/\[\[([^\]]+)\]\]/g, function (a, k) { return kc(k); })
      .replace(/\{\{(\w+)\|([^}]+)\}\}/g, function (a, id, t) { return BYID[id] ? '<a class="gd-ln" data-gd="' + id + '">' + esc(t) + "</a>" : esc(t); });
  };
  var plain = function (s) { return String(s).replace(/\[\[([^\]]+)\]\]/g, "$1").replace(/\{\{\w+\|([^}]+)\}\}/g, "$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "); };
  function toc() {
    return BOOK.map(function (ch, ci) {
      var shut = st.shut[ci] && !st.q;
      return '<div class="gd-ch' + (shut ? "" : " open") + '"><div class="gd-cht" data-gdch="' + ci + '"><i class="gd-chev"></i>' + esc(L(ch.t)) + "</div>" +
        (shut ? "" : '<div class="gd-tps">' + ch.topics.map(function (tp) { return '<div class="gd-tp' + (tp.id === st.cur && !st.q ? " on" : "") + '" data-gd="' + tp.id + '">' + esc(L(tp.t)) + "</div>"; }).join("") + "</div>") + "</div>";
    }).join("");
  }
  function article() {
    if (st.q) {
      var q = st.q.toLowerCase(), hits = ALL.filter(function (tp) { return (L(tp.t) + " " + plain(L(tp.b))).toLowerCase().indexOf(q) >= 0; });
      return '<h1 class="gd-h1">' + esc(en() ? "Search results" : "搜索结果") + '</h1><p class="gd-dim">' + esc(en() ? hits.length + " topics for “" + st.q + "”" : "「" + st.q + "」：" + hits.length + " 篇") + "</p>" +
        hits.map(function (tp) { var txt = plain(L(tp.b)), at = txt.toLowerCase().indexOf(q), from = Math.max(0, at - 40); return '<div class="gd-hit" data-gd="' + tp.id + '"><div class="gd-hitt">' + esc(L(tp.t)) + '</div><div class="gd-hits">' + esc((from ? "…" : "") + txt.slice(from, from + 140) + "…") + '</div><div class="gd-hitc">' + esc(L(BOOK[tp.ch].t)) + "</div></div>"; }).join("");
    }
    var tp = BYID[st.cur] || ALL[0], i = ALL.indexOf(tp), pv = ALL[i - 1], nx = ALL[i + 1];
    return '<div class="gd-crumb">' + esc(L(BOOK[tp.ch].t)) + '</div><h1 class="gd-h1">' + esc(L(tp.t)) + '</h1><div class="gd-body">' + html(L(tp.b)) + "</div>" +
      (tp.see && tp.see.length ? '<div class="gd-see"><div class="gd-seet">' + esc(en() ? "See also" : "另请参阅") + "</div>" + tp.see.filter(function (id) { return BYID[id]; }).map(function (id) { return '<a class="gd-ln" data-gd="' + id + '">' + esc(L(BYID[id].t)) + "</a>"; }).join("") + "</div>" : "") +
      '<div class="gd-nav">' + (pv ? '<a class="gd-ln gd-prev" data-gd="' + pv.id + '">' + esc((en() ? "Previous: " : "上一篇：") + L(pv.t)) + "</a>" : "<span></span>") + (nx ? '<a class="gd-ln gd-next" data-gd="' + nx.id + '">' + esc((en() ? "Next: " : "下一篇：") + L(nx.t)) + "</a>" : "") + "</div>";
  }
  function draw(host) {
    var side = host.querySelector(".gd-side"), main = host.querySelector(".gd-main");
    if (!side) {
      host.innerHTML = '<div class="gd"><div class="gd-top"><div class="gd-title">' + esc(en() ? "Vibing Studio User Guide" : "Vibing Studio 使用手册") + '</div><label class="gd-find"><input type="search" class="gd-q" placeholder="' + esc(en() ? "Search" : "搜索") + '" spellcheck="false" autocomplete="off"></label></div><div class="gd-cols"><nav class="gd-side"></nav><main class="gd-main" tabindex="-1"></main></div></div>';
      side = host.querySelector(".gd-side"); main = host.querySelector(".gd-main");
    }
    side.innerHTML = toc();
    main.innerHTML = '<article class="gd-art">' + article() + "</article>";
  }
  function bind(host) {
    if (host.dataset.gdb) return;
    host.dataset.gdb = "1";
    host.addEventListener("click", function (e) {
      var ch = e.target.closest("[data-gdch]");
      if (ch) { var ci = +ch.dataset.gdch; st.shut[ci] = !st.shut[ci]; draw(host); return; }
      var a = e.target.closest("[data-gd]");
      if (!a) return;
      e.preventDefault();
      st.cur = a.dataset.gd; st.q = ""; var qi = host.querySelector(".gd-q"); if (qi) qi.value = "";
      st.shut[BYID[st.cur].ch] = false;
      draw(host);
      var m = host.querySelector(".gd-main"); if (m) { m.scrollTop = 0; m.focus({ preventScroll: true }); }
    });
    host.addEventListener("input", function (e) { if (e.target.classList.contains("gd-q")) { st.q = e.target.value.trim(); draw(host); } });
    host.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && e.target.classList.contains("gd-q")) { e.preventDefault(); e.target.value = ""; st.q = ""; draw(host); e.target.blur(); var m = host.querySelector(".gd-main"); if (m) m.focus({ preventScroll: true }); }
    });
  }
  S.pages.guide = {
    title: function () { return en() ? "User Guide" : "使用手册"; },
    address: function () { return "guide.local.paimon"; },
    icon: function () { return ICON; },
    render: function (host, P, arg) { if (getComputedStyle(host).position === "static") host.style.position = "relative"; if (arg && BYID[arg] && host.dataset.gdArg !== arg) { st.cur = arg; host.dataset.gdArg = arg; } draw(host); bind(host); }, // 打开时指定的那一篇只用一次：之后重画不再把你点到的别的篇拉回去
    focus: function () {},
  };
  function open(tw, id) {
    var T = window.TSU_TERM;
    tw = tw || (T && T.front ? T.front() : null);
    if (id && BYID[id]) st.cur = id;
    if (!tw || !S.openPage) return;
    var hit = null;
    tw.ws.all().forEach(function (p) { if (!hit && p.program && p.program.page === "guide") hit = p; });
    if (hit) { tw.ws.show(hit); if (hit.program && hit.program.render) hit.program.render(); } else S.openPage(tw, "guide", id || null);
  }
  if (S.command) S.command("help.guide", { title: "Vibing Studio 使用手册", run: function (tw) { open(tw); } });
  if (window.TSU_I18N && TSU_I18N.add) TSU_I18N.add({ "Vibing Studio 使用手册": "Vibing Studio User Guide", "使用手册": "User Guide" });
  window.TSU_GUIDE = { open: open, topics: function () { return ALL.map(function (t) { return { id: t.id, title: L(t.t) }; }); } };
})();
