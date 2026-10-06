// changelog.js —— 更新内容（What's new）：每个版本一段——日期、版本号、新增 / 改进 / 修复。
//   Claude App、Pure Terminal：盖在窗口上的一张卡片（同 Claude 桌面版的 What's new）；VS Code：编辑区里一个标签页（同 VS Code 的发行说明）；
//   macOS：一个窗口。入口：菜单栏「帮助 › 更新内容」、命令面板；TSU_CHANGELOG.open()。
//   写法：每条 [中文, English]；`反引号` 里的是代码（画成小胶囊）。新的版本放最前面。
(function () {
  "use strict";
  if (window.TSU_CHANGELOG) return;
  var root = document.documentElement, S = window.STUDIO;
  var en = function () { return !!(window.TSU_I18N && TSU_I18N.lang && TSU_I18N.lang() === "en"); };
  var tr = function (zh, e) { return en() ? e : zh; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  // 日期按真的发布日期写（tools/deploy.sh 每次部署把版本号和时间记进 builds.json）；同一天发的几版并成一段，版本号写那天最后一版
  var LOG = [
    { date: "2026-10-07", ver: "0.2.423", items: {
      new: [
        ["子 Agent 再开的子 Agent 挂在它下面一层（再往下也一样）：右侧栏里一眼看出谁开了谁，点一行打开它自己的记录；前台跑着、还没交回结果的子 Agent 也认得出来、点得进去。进到下一层的标签页里，最上面那行是「上一级 Agent」。", "Subagents started by a subagent now appear nested under it, at any depth, so the side bar shows who started whom; click a row to open its own transcript. Foreground subagents that are still running can be opened too. In a nested tab, the top row is the parent agent."],
        ["子 Agent 的弹窗在它自己的标签页里也能处理：要权限、它自己的界面那一块原样出现，键盘、鼠标照常；它问你问题，在它的标签页里直接答，经主会话送进去。", "Dialogs from a subagent can be handled in its own tab: permission prompts appear exactly as Claude Code draws them, and questions it asks can be answered right there; answers go through the main session."],
        ["Linux 版：GitHub Release 里有 AppImage 和 deb（x86_64、ARM64）；装好的 Linux 版联网时界面直接用网站上最新的，断网才用自带的那一份。", "Linux builds: AppImage and deb packages (x86_64 and ARM64) are now on the GitHub release. When online, the Linux app uses the latest interface from the website and falls back to its bundled copy offline."],
        ["有新版本时标题栏右边出一个按钮「重新载入以更新」/「重启以更新」（以前只在默认关着的状态栏里写，别的 Mac 上看不到）。", "When an update is available, a “Reload to Update” or “Restart to Update” button appears at the right of the title bar. Previously this only showed in the status bar, which is off by default."],
      ],
      improved: [
        ["问答面板（Claude Code 问你问题时）：直接打字就是在写「Type something」的回答，回车交（输入法选字时的回车不算），输入框里是真的光标；问题很长、选项很多时整块缩到放得下，选项和按键提示一定看得见。", "Question panel: just start typing to answer in “Type something” and press Return to submit (Return while composing with an input method doesn't submit); the input shows a real caret. Long questions shrink to fit, so the options and key hints are always visible."],
        ["Claude Code 自己的面板（/config 这类长单子、权限确认）比窗口高时，只画放得下的那一截，在面板上用滚轮往上翻。", "When Claude Code's own panel (long lists like /config, permission prompts) is taller than the window, only the part that fits is shown; scroll over it to see the rest."],
        ["别的会话在问你时，问题卡片默认不再弹出、不再把窗口叫到前面；标签页图标、状态行最右边的「● N awaiting input · 名字」照常提示（设置里还能打开卡片）。", "Questions from other sessions no longer pop up a card or bring the window to the front by default; the tab icon and “● N awaiting input · name” at the far right of the status row still show it. The card can be turned back on in Settings."],
        ["一轮中间打的 /goal：排着时上面一行是「❯ /goal 条件」，下面「⎿ Goal set: …」，不再只有孤零零一行挂在正在跑的工具下面。", "A /goal typed mid-turn now shows as “❯ /goal condition” with “⎿ Goal set: …” under it while queued, instead of a lone line under the running tools."],
        ["空输入时按 ← 不再展开 agent 列表（用 /agents）。", "Pressing ← in an empty prompt no longer opens the agent list (use /agents)."],
      ],
      fixed: [
        ["选中一大段文字时整片变成浅蓝、看不见字：选中的表格线被挪到了左上角，选区的框跟着从最上面画到最下面。表格、代码框选中后也不再丢边框。", "Selecting a long passage no longer turns the whole view light blue with no visible text. Selected table borders were being moved to the top-left, which stretched the selection from the very top. Tables and code frames keep their borders when selected."],
        ["问题等你超过 10 分钟没答时，问答面板会消失，换成 Claude Code 自己那一块（比窗口高，下面的选项被裁掉、点不到）。", "If a question waited more than 10 minutes, the question panel used to disappear and Claude Code's own panel showed instead, taller than the window, with its options cut off."],
        ["问答时在输入框里打的话被当成回答收下后，还挂在对话最下面，排到它的回复后面。", "Text typed in the prompt while a question was open, and taken as the answer, no longer stays at the bottom of the conversation below the reply."],
        ["「● N awaiting input」有时跑到一行的中间：现在固定在最下面状态行的最右边。", "“● N awaiting input” sometimes landed mid-row; it now sits at the far right of the bottom status row."],
        ["前台跑的子 Agent 跑完了还一直显示「在跑」、拿不到它的记录。", "Foreground subagents no longer stay “running” after they finish, and their transcripts can be opened."],
      ],
    } },
    { date: "2026-10-07", ver: "0.2.422", items: {
      new: [
        ["新 App「设备」（参考 AirPort 实用工具）：你的设备画成一张图——最上面是账户，下面是 Mac 和别的设备，在用某台 Mac 的 iPad、iPhone 挂在那台下面；绿点是在线。点一台出它的卡片：另一台在线的 Mac 能「在这里使用」，这台能改名，这台 Mac 能开关「允许其他设备使用」、撤销允许过的设备。", "New Devices app, modeled on AirPort Utility: your devices drawn as a map, with your account at the top and your Macs and other devices below it. An iPad or iPhone using a Mac hangs under that Mac, and a green dot means online. Click a device for its card: use another online Mac from here, rename this device, turn sharing of this Mac on or off, and revoke devices you allowed."],
      ],
    } },
    { date: "2026-10-07", ver: "0.2.421", items: {
      new: [
        ["终端像 tmux 一样有名字：新建时先在 Agents 视图的「终端」里输名字（同新建文件夹，回车就开）；关掉标签页它照跑（里面的程序不停），在「终端」里点一下接回来；右键能重命名、结束。标签页的标题就是它的名字，不再是「~ — -zsh」。", "Terminals now have names, like tmux sessions. A new terminal first asks for a name in the Terminals section of the Agents view, the way a new folder does, and opens on Return. Closing its tab leaves it running, programs included; click it under Terminals to reattach, or right-click to rename or end it. The tab title is its name instead of “~ — -zsh”."],
      ],
    } },
    { date: "2026-10-07", ver: "0.2.420", items: {
      new: [
        ["Claude Code 会话快到自动压缩时，底部右侧显示「N% until auto-compact」，算法同 Claude Code 2.1.281（离自动压缩的门槛不到 2 万 token 时出现）；它的自动压缩关着时显示红字「Context low」。设置 › 高级 里能关，默认开。", "Claude Code sessions now show “N% until auto-compact” at the bottom right as the context nears auto-compact, computed the way Claude Code 2.1.281 does (it appears within 20k tokens of the threshold). With auto-compact off, a red “Context low” notice appears instead. It can be turned off in Settings › Advanced and is on by default."],
      ],
    } },
    { date: "2026-10-07", ver: "0.2.419", items: {
      improved: [
        ["访达的 Agent 那一边，最外层不再把左边一栏的「位置」（Claude Code、Codex）再列一遍：改成「最近」——各连接器的会话按上次活跃排，同访达的「最近使用」；左边一栏最上面多了「最近」。", "On the Agent side of Finder, the top level no longer repeats the sidebar’s Locations (Claude Code, Codex). It is now Recents: sessions from every connector, most recently active first, like Finder’s Recents, with a Recents item at the top of the sidebar."],
      ],
    } },
    { date: "2026-10-07", ver: "0.2.418", items: {
      fixed: [
        ["标签页概览里，重开 App 后还没点开过的标签页（历史记录、设置等）不再是黑的一块：先画出来再缩小。", "In the tab overview, tabs not yet opened since launch (History, Settings and so on) are no longer black: they are drawn before being shown."],
        ["标签页概览打开更快：不在眼前的会话不再整段重排来做缩略图，卡片上直接是它最后两问的字。", "The tab overview opens faster: sessions that aren’t on screen are no longer laid out in full for a thumbnail; their card shows the last two exchanges as text."],
      ],
    } },
    { date: "2026-10-07", ver: "0.2.417", items: {
      fixed: [
        ["对话里从下往上拖着选字时大片变黑：选区改成同终端的画法（第一行到行尾、中间整行、最后一行到选的地方，空行也算），离得远的那几段选着时也照常画，滚动时跟着重画。", "Dragging a selection upward no longer turns large areas black. Selections are now drawn the way a terminal draws them (first line to its end, whole lines in between including blank ones, last line up to the cursor), distant parts stay rendered while selected, and the highlight follows scrolling."],
      ],
    } },
    { date: "2026-10-07", ver: "0.2.416", items: {
      fixed: [
        ["往上翻时最上面那一行（这一段属于哪一问）回到最底下后有时还挂着：现在同 Claude Code——只在往上翻、那一问自己已经翻上去时才有；在最底下、在最顶上都没有，回到底、发出一句都会马上收起。", "The pinned prompt line at the top sometimes stayed after returning to the bottom. It now follows Claude Code: it appears only while scrolled up and only once that prompt itself is out of view, never at the bottom or the very top, and it disappears as soon as you return to the bottom or send a message."],
        ["发出去的消息有时先消失一下再出来（Claude Code 一轮中间读进去、或者从队里拿走时）：现在一直挂着，直到对话里出现那一问。", "Sent messages no longer vanish for a moment before reappearing when Claude Code picks them up from its queue, including mid-turn while a command runs; they stay visible until they appear in the conversation."],
      ],
    } },
    { date: "2026-10-07", ver: "0.2.415", items: {
      new: [
        ["Claude Code 会弹面板的斜杠命令（/config、/model、/theme、/help、/permissions、/mcp 等）在这里也能用：它自己的面板原样出现在输入框的位置，用键盘操作，按 Esc 关掉回到输入框。面板在别处打开、还开着的，打开这个会话时也会接上。适用于后台运行的会话。", "Claude Code slash commands that open a panel (/config, /model, /theme, /help, /permissions, /mcp and others) now work here: Claude Code’s own panel appears in place of the input box, works with the keyboard, and Esc closes it. A panel left open elsewhere is picked up when you open the session. Applies to sessions running in the background."],
      ],
      fixed: [
        ["发出斜杠命令后不再闪一下「在想」的转圈。", "Sending a slash command no longer flashes the thinking spinner."],
        ["没登录时对话最上面不再出现「undefinedundefined」。", "“undefinedundefined” no longer appears at the top of a conversation when signed out."],
      ],
    } },
    { date: "2026-10-07", ver: "0.2.414", items: {
      improved: [
        ["Codex 会话的右键菜单同 Claude Code 一样：打开位置（拆分视图、终端、Visual Studio Code、访达）、固定、标为未读、重命名、移到分组、归档、删除（会话记录移到废纸篓）；固定的、分组的在 Codex 下面各成一组。", "Codex sessions now have the same context menu as Claude Code: Open in (Split View, Terminal, Visual Studio Code, Finder), Pin, Mark as Unread, Rename, Move to Group, Archive and Delete (the transcript moves to the Trash). Pinned and grouped sessions get their own sections under Codex."],
        ["「App」挪到活动栏上面那一组（连接器下面），点一下打开、再点一下或点别处收起，不再指上去就弹；也能用方向键选。", "Apps moved to the top group of the activity bar, below Connectors. It now opens on click and closes on a second click or a click elsewhere, instead of on hover, and works with the arrow keys."],
        ["访达的图标照 macOS 的访达重画：眼睛短了，侧脸、笑的弧线和它对齐。", "The Finder icon is redrawn after the macOS Finder icon: shorter eyes, with the profile and smile matching it."],
      ],
      fixed: [
        ["Claude Code 的斜杠命令（/rename、/cost、/add-dir 等）结果不显示、下面只有一个空的「⎿」：新版把结果记在 system 消息里，现在照它的样子显示；出错的是红字，没有结果的不再画那一行。", "Results of Claude Code slash commands such as /rename, /cost and /add-dir were missing, leaving an empty “⎿”. Newer versions record them as system messages; they now show the way Claude Code shows them, errors in red, and commands with no output no longer draw that line."],
      ],
    } },
    { date: "2026-10-07", ver: "0.2.413", items: {
      improved: [
        ["「文件」视图：看得见的文件夹先把里面读好，点开就是现成的，不再先空一下。", "Files view: visible folders are read ahead, so expanding one shows its contents right away."],
        ["访达的缩略图排队生成（同时最多 4 个，先生成上面的），不再一下子全卡住；深色下白底文稿的缩略图压暗一点，不刺眼。", "Finder thumbnails are generated a few at a time, top first, instead of all at once; white document thumbnails are dimmed in dark mode."],
        ["Markdown 文件的图标换成 Markdown 的标志，图片换成一张相片（以前是一叠相册）。", "Markdown files use the Markdown mark, and images a single photo instead of a stack."],
      ],
    } },
    { date: "2026-10-07", ver: "0.2.412", items: {
      improved: [
        ["「App」挪到活动栏最下面（⚙ 下面），指上去从旁边弹出来（同「开始」菜单，按内容的高度）；不再占一整条侧栏。", "Apps moved to the bottom of the activity bar (below ⚙) and open as a pop-up beside it, like a Start menu, sized to its contents instead of a full side bar."],
        ["Agent Finder 和 File Finder 合成一个「访达」：左下角在「文件」「Agent」两边切换，下次从上次那一边打开；图标同标签页上的。", "Agent Finder and File Finder are now one Finder: switch between Files and Agents at the bottom left, and it reopens on the side you used last; its icon matches its tab."],
        ["连接器的图标换成两节链环（以前的插头像充电器）。", "The Connectors icon is now a chain link instead of a plug."],
        ["右侧边栏默认 340 像素宽，不再占半个屏幕；拖过的宽度照旧记住，双击边缘回到默认。", "The secondary side bar now defaults to 340 px instead of half the window; a dragged width is still remembered, and double-clicking the edge restores the default."],
      ],
    } },
    { date: "2026-10-07", ver: "0.2.411", items: {
      new: [
        ["App 会自己检查更新（Mac 0.2.1.290 起）：有新版时在后台下好，状态栏出「App 有新版本 · 重启以更新」，点一下换上。别的 Mac 上联网时界面直接用网站上最新的。", "The app checks for updates on its own (Mac 0.2.1.290 and later): a new version downloads in the background and the status bar offers Restart to Update. On other Macs the interface follows the website when online."],
      ],
    } },
    { date: "2026-10-07", ver: "0.2.410", items: {
      fixed: [
        ["新装的 Mac 上检测不到 Claude Code（Codex 正常）：Claude Code 装在 ~/.local/bin，安装时只写进了 ~/.zshrc，App 跑命令时读不到。现在跑命令、起会话都会补上 ~/.local/bin 等常见位置。", "Claude Code wasn't detected on a freshly set up Mac while Codex was: Claude Code lives in ~/.local/bin, which its installer adds only in ~/.zshrc. Commands and sessions now also look in ~/.local/bin and other common locations."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.408", items: {
      improved: [
        ["「App」里的图标换成同标签页上的那套细线图标，一行一个，只写名字。", "Apps now use the same line icons as their tabs, one per row with just the name."],
        ["编辑区的终端标签页底色同 TUI 的会话：深色是黑、浅色是白（以前是面板的灰）；终端标签页的图标改成画的。", "Terminal tabs in the editor use the same background as TUI sessions — black in dark, white in light — instead of the panel gray; the terminal tab icon is now drawn."],
      ],
      fixed: [
        ["发给 Claude Code 的消息明明收到了却报「没有收到」，点重试或再发一句就重复发送：它在「送到了」的回话回来之前就写进了会话记录，以前没对上。现在先查记录，见到了就算送到；放回来的那句重发前也会再查一遍。", "Messages to Claude Code were reported as not received even though they arrived, and retrying or sending again duplicated them: Claude Code logged them before confirming. Delivery is now confirmed against the transcript first, and a returned message is checked again before it's resent."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.407", items: {
      new: [
        ["活动栏第五格「App」（连接器下面）：Agent Finder、File Finder、终端、浏览器从这里打开；终端是新开一个 shell 标签页，不进任何 agent。标题栏右上角的浏览器按钮默认不再摆出来（右键可勾回）。", "A fifth activity, Apps (below Connectors), opens Agent Finder, File Finder, Terminal and Browser; Terminal opens a new shell tab without entering any agent. The browser button in the title bar is now hidden by default (re-enable it from the right-click menu)."],
        ["代码文件默认按行滚动，手感同终端里的对话；设置 › 外观 › 代码滚动可改成平滑。标签栏「···」里可显示或隐藏行号，设置会记住。只看和编辑都一样。", "Code files scroll line by line by default, like the chat in the terminal; switch to Smooth in Settings › Appearance › Code Scrolling. Show or hide line numbers from the tab bar’s ··· menu; the choice is remembered. Applies to viewing and editing."],
        ["文件图标换成 VS Code 默认的那套：JS、TS、{ }、# 等各语言约定俗成的彩色图标。", "File icons now use the VS Code default set: the familiar colored JS, TS, { }, # and other language icons."],
      ],
      improved: [
        ["代码预览和编辑快速滚动不再卡顿：编辑器单独排版，每次新画出来的行不再和整页的样式一起重算。", "Fast scrolling in code previews and the editor no longer stutters: the editor is laid out on its own, so newly drawn lines no longer re-run the whole page’s styles."],
        ["终端大量输出时更流畅：输出改用系统自带的解码，主线程省下约四分之一的时间给终端。", "Terminals stay smoother under heavy output: output is decoded with the system’s built-in decoder, freeing about a quarter of the main thread for the terminal."],
        ["连接器：Claude Code、Codex 一组叫「默认」（不折叠），Paimon 在「扩展（内置）」。", "Connectors: Claude Code and Codex are grouped under Default (not collapsible); Paimon is under Extensions (Built-in)."],
      ],
      fixed: [
        ["Claude Code 会话里发的消息显示「待发送」后消失、Claude Code 没收到：现在发出后要在会话记录里看到才算送到，30 秒没出现就放回排队并标红，可以重试；Claude Code 在等你处理对话框（权限、提问）时，消息先在这边排着，处理完自动发送。", "Messages sent to a Claude Code session no longer vanish after showing as pending: a message counts as delivered only once it appears in the transcript; if it doesn’t within 30 seconds it returns to the queue in red with Retry. While Claude Code waits on a dialog (permission or question), messages wait here and are sent once it’s answered."],
        ["标题栏布局按钮在右键里取消勾选后仍然显示。", "Title bar layout buttons stayed visible after being unchecked in the right-click menu."],
        ["⌘+ / ⌘- 调的字号重新打开后又变回去：每次打开时，macOS 桌面那份旧设置里记的字号把它盖掉了。现在字号只认 Studio 的设置，几个窗口之间也会马上同步。", "Text size set with ⌘+ / ⌘- reverted after reopening: an old desktop setting overwrote it on every launch. Text size now follows only Studio’s settings and syncs between windows immediately."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.406", items: {
      improved: [
        ["网页端、iPhone、iPad 打开会话更快：会话记录经中转送过来之前先在 Mac 上压缩（文字只剩一成左右），这边再解开。要 Mac 上的 App 更新到 0.2.1.288。", "Sessions open faster on the web, iPhone and iPad: transcripts are compressed on the Mac before going through the relay. Requires the Mac app 0.2.1.288."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.405", items: {
      new: [
        ["网页端：打开 code.paimon.beer 就是 Vibing Studio，像 iPhone、iPad 一样自动连你的 Mac；macOS 模拟器只在 /simulator。", "Web: code.paimon.beer opens Vibing Studio itself and connects to your Mac automatically like iPhone and iPad; the macOS simulator lives at /simulator."],
        ["新设备连 Mac 同 Apple 账户登录新设备：Mac 上写清是哪台设备（浏览器写出是什么浏览器、什么系统）、大致在哪、IP；点「允许」后 Mac 上显示 6 位验证码，在那台设备上输入才放行。以前只点了「允许」的设备要再验证一次。", "Connecting a new device works like signing in to an Apple Account: the Mac shows which device (browser and OS), its approximate location and IP; after you click Allow it shows a 6-digit code to enter on that device. Devices approved earlier without a code must verify once."],
      ],
      fixed: [
        ["网页端连 Mac 时一片黑：现在写着在连哪台、在等那台 Mac 允许、输入验证码，被拒绝时能重新请求。", "The web client no longer shows a black screen while connecting; it shows which Mac it’s connecting to, waiting for approval, code entry, and a way to request again if denied."],
        ["网页端左上角不再画红黄绿三个假按钮。", "The web client no longer draws fake window buttons in the top-left corner."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.402", items: {
      fixed: [
        ["iPhone：标签栏右边第一个按钮（现在是齿轮）点了没反应，设置因此找不到：已修好，点开是设置、账号、侧栏、面板、浏览器、新建标签页。", "iPhone: the first tab-bar button (now a gear) did nothing, so Settings couldn’t be found; it now opens Settings, Account, side bars, the panel, the browser and New Tab."],
        ["iPhone 全屏只看对话时上下不再各空一条：网页铺到整屏，输入框的底色一直到最下面；整格泛蓝（被系统整块选中）也不会再出现。", "iPhone full screen now covers the whole screen top to bottom, and the pane no longer turns blue from accidental selection."],
        ["灵动岛：切到别的 App 时实时活动不再马上被收起（以前这时常先报一下「空闲」，一收就没了）。画中画先拿掉。", "Dynamic Island: the Live Activity no longer disappears the moment you switch apps. Picture in Picture is removed for now."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.400", items: {
      new: [
        ["iPhone：灵动岛、锁屏的实时活动和画中画显示内容——会话最近说的话、在跑的命令（最多三行），不只是「在跑」。开着的标签页里正在答的也算在跑。", "iPhone: the Live Activity and Picture in Picture show content — the session’s latest words and running commands (up to three lines), not just “running”. Sessions answering in open tabs count as running."],
        ["iPhone：标签栏右边一个按钮就是设置、账号、侧栏、面板、浏览器、新建标签页（标题栏收起来后它们都在这里）。", "iPhone: one tab-bar button holds Settings, Account, side bars, the panel, the browser and New Tab."],
      ],
      fixed: [
        ["iPhone 全屏只看对话时输入框贴到最下面，下面不再空一截；在跑的那一行挪到输入框上面。退出全屏的按钮可以拖到别处。", "iPhone full screen: the input box sits at the very bottom with the running line above it; the exit button can be dragged."],
        ["iPhone 横着拿时只留标签页、对话和输入框（活动栏、侧栏、面板这些竖过来再用）；键盘上面那条「⌃ ⌄ 完成」去掉了。", "iPhone landscape keeps only tabs, the conversation and the input; the keyboard’s “previous / next / Done” bar is gone."],
        ["Mac 上发出一句后「sending…」比 iPhone 上还慢：Mac 本机没有新内容推送，要等下一次读会话记录。现在刚发出的几秒里读得更勤。", "On the Mac, “sending…” cleared later than on iPhone; the session record is now read more often for a few seconds after sending."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.399", items: {
      new: [
        ["iPhone：灵动岛和锁屏上显示实时活动——有会话在跑时显示橙色的 Claude 标志和用时，有会话在等你时变成蓝色、写「等你」；长按灵动岛展开看是哪个会话、在干什么、一共几个在跑几个在等你。", "iPhone: a Live Activity in the Dynamic Island and on the Lock Screen — an orange Claude mark with elapsed time while a session runs, blue “waiting” when one needs you; touch and hold to see which session, what it’s doing and how many are running or waiting."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.398", items: {
      new: [
        ["使用手册新增「在 iPhone 上使用」一章：布局、打开会话列表、全屏只看对话、附加图片、拷贝文字、横着拿时输入，配有截图和动图。", "The User Guide has a new “Use on iPhone” chapter — layout, the session list, full screen, attaching images, copying text and typing in landscape — with screenshots and animations."],
      ],
      fixed: [
        ["iPhone：拉出来的会话列表不再和灵动岛叠在一起；横着拿打字时侧栏也收起，对话占满整宽。", "iPhone: the session list no longer overlaps the Dynamic Island, and the side bar hides while typing in landscape."],
        ["使用手册已经开着时，从别处打开另一篇会停在原来那篇：现在会跳到要看的那一篇。", "Opening a different User Guide topic while the guide is open now goes to that topic."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.397", items: {
      new: [
        ["iPhone：布局按钮精简成一个（设置 › 布局 › 布局按钮：精简 / 经典，手机默认精简）；标题栏收起，标签页在最上面，有灵动岛的竖着拿时标签页绕开灵动岛排在两边；拆分、布局都在标签栏的「···」里。", "iPhone: layout buttons collapse into one (Settings › Layout › Layout Buttons: Concise / Classic; Concise by default on phones); the title bar is gone, tabs sit at the very top and flow around the Dynamic Island; split and layout live in the tab bar’s “···”."],
        ["iPhone：标签栏「···」旁边的全屏按钮——只留对话和输入框，右上角「缩小」回来。", "iPhone: a full-screen button next to “···” shows only the conversation and input; tap the shrink button at the top right to return."],
        ["iPhone：编辑区、面板贴边铺满（无边框）；屏幕四周的安全区由界面自己让，最下面那一行伸进底部横条。横着拿打字时输入框挪到最上面（键盘不再把它挡住）。", "iPhone: edge-to-edge, borderless layout; the bottom row extends into the home-indicator area. In landscape the input box moves to the top while typing so the keyboard doesn’t hide it."],
        ["Claude App 风格在 iPhone 上：对话占满整宽，侧栏从左边拉出来；顶栏只留侧栏、标题、「···」，前进后退和几张卡片都在「···」里。", "Claude App style on iPhone: the conversation fills the width, the sidebar slides in from the left, and the top bar keeps only the sidebar button, title and “···”."],
        ["设置里这一版新加的项，名字前有一个蓝点（只给测试账号和开了开发者功能的）。", "New settings show a blue dot before their name (test accounts and developer mode only)."],
      ],
      fixed: [
        ["iPhone：底部面板里的几块（Agent 活动、系统资源）上下排，不再并排挤成两条。", "iPhone: panel views stack vertically instead of being squeezed side by side."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.396", items: {
      fixed: [
        ["往上翻着看大会话时整个 App 卡一两秒（往上接更早的、重读、改设置时）：以前把几百上千问一次全画出来，现在以眼前那一问为锚先画眼前的、其余分段补上，看着的地方不动。600 问从 1.6 秒降到 0.2 秒。", "Large sessions no longer freeze the app when re-rendered while scrolled up: the visible part is drawn first and the rest is filled in gradually, keeping your place. 600 turns: 1.6 s → 0.2 s."],
        ["会话历史往上拉不动：往前读一段时正赶上在重读，就再也不读了。现在没读成会再试，在最顶上接着往上拉也会再读。", "Older history now keeps loading when you reach the top, retrying if a load was blocked."],
        ["文件内容正好一屏也能上下滚：正文下面多留了一截空白，已去掉。", "Files that fit on one screen no longer scroll."],
        ["iPhone、iPad 上对话一碰就整屏选中：对话里不再让系统自己选字，要复制时长按，菜单里有「复制这一段」。", "On iPhone and iPad the conversation no longer gets fully selected by accident; long-press and choose “Copy This Block” to copy."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.395", items: {
      new: [
        ["iPhone、iPad：输入框的「···」和长按输入框的菜单里有「添加图片…」——从相册选、拍照。", "iPhone and iPad: “Add Images…” in the input box’s “···” menu and long-press menu — pick from Photos or take a photo."],
        ["新设备借 Mac 用时，第一次打开照那台 Mac 的设置整份抄一份（风格、布局、对话显示……），之后各管各的；全名、称呼、头像一直跟着 Mac。", "A new device using your Mac copies that Mac’s settings once on first launch, then keeps its own; your name and avatar always follow the Mac."],
      ],
      fixed: [
        ["iPhone 上点了侧栏图标什么都看不到：窄屏上侧栏被藏死了。现在从左边盖在编辑区上面拉出来，点了会话或编辑区就收回。", "On iPhone the side bar never appeared; it now slides over the editor and closes when you pick a session or tap the editor."],
        ["iPhone、iPad 上点标签页、按钮要点两次（第一下只算悬停）：悬停才出现的按钮只在有鼠标的设备上这样。", "On iPhone and iPad, tabs and buttons no longer need two taps."],
        ["iPhone 上随便点一下就弹键盘：只有点输入框才弹；「Jump to bottom」也不再弹键盘。", "On iPhone the keyboard only appears when you tap an input, including after Jump to bottom."],
        ["Mac 上的 App 在「登录的设备」里用这台 Mac 自己的名字。", "The Mac app now appears under its own computer name in Signed-in Devices."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.394", items: {
      fixed: [
        ["iPhone 借 Mac 用时会话列表是空的：新设备上要等 5 分钟后的自动检测才知道 Mac 上有 Claude Code。现在一打开就检测，检测完之前 Claude Code 默认开着。", "On iPhone (using your Mac), the session list was empty until a check that ran five minutes later; it now checks on launch and shows Claude Code sessions right away."],
        ["iPhone 在 Mac 的授权列表里被写成 iPad：现在写 iPhone（下次连上时自动改过来）；设置项改名为「iPhone、iPad 使用这台 Mac」。", "An iPhone was listed as “iPad” among the Mac’s authorized devices; it now shows as iPhone, and the setting is renamed “Let iPhone and iPad Use This Mac”."],
        ["菜单里 Claude 风格的标志是灰的：现在和别的图标一样是黑的。", "The Claude style icon in menus was gray; it now matches the other icons."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.393", items: {
      fixed: [
        ["连着发几句时对话自己往上跑、冒出「Jump to bottom」：排着的话收走、新的一问接上时浏览器挪了滚动位置，被当成了往上翻。现在跟着到底时只有你自己滚才停止跟随。", "Sending several messages in a row no longer scrolls the conversation up: browser scroll adjustments while content is replaced are no longer treated as scrolling up."],
        ["右侧栏收起 / 展开一块时，点的那一行不再上下跳；箭头只转动，标题文字不再左右挪。", "Collapsing or expanding a section in the side bar no longer makes the clicked header jump; the chevron only rotates and the title stays put."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.392", items: {
      improved: [
        ["输入框上下两条线左右对称：排不满一格的余量左右各留一半（以前左边贴边、右边空一截）；右上角「···」摆在线的末端。", "The input box rules are now symmetric: leftover space is split between both sides instead of all on the right; the “···” button sits at the end of the rule."],
        ["右侧栏任务那一块的「TUI / 图形」切换先拿掉（TUI 的样子不能折叠，长清单一长串）。", "Removed the TUI / graphical switch in the side bar tasks section for now (the TUI layout could not be collapsed)."],
      ],
      fixed: [
        ["往上翻时顶上那一行（所在的那一问）：点了跳到那一问后，这一行收起、露出原来的那一行，不再用淡色盖在上面；那一问就在顶上一两行时点了看起来没反应的问题也一并解决。", "Sticky prompt: after jumping to the prompt, the header hides and the original line shows instead of being covered by a dimmed copy; clicking it when the prompt was only a line or two above no longer appears to do nothing."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.391", items: {
      improved: [
        ["设置页左边一列按下就切换（同系统设置的侧栏），不必等松开。", "The Settings sidebar switches on press, like System Settings, instead of waiting for release."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.390", items: {
      new: [
        ["「Background command … completed」这一行可以点开，查看这条后台命令的输出；再点收起。", "The “Background command … completed” line can be clicked to show that command’s output; click again to collapse."],
        ["右侧栏的任务那一块右上角可以换成 TUI 的样子（同 Claude Code 终端里的写法），再点换回图形。", "The tasks section in the secondary side bar has a TUI / graphical switch in its top-right corner, matching how Claude Code shows them in the terminal."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.388", items: {
      fixed: [
        ["更新或重启 App 后，打开着的会话标签页没有接回来，只剩历史记录：会话列表读得慢时标签页被存成了空的。现在先按会话 id 接上，读到后自动显示；刚关掉几分钟内重新打开、却一个会话都没接回来时，自动打开上次的会话标签页。", "After updating or restarting the app, open session tabs didn’t come back and only History remained, because tabs were saved empty when the session list loaded slowly. Tabs now reconnect by session id and show once loaded; if the app reopens within a few minutes and no session came back, the previous session tabs open automatically."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.387", items: {
      fixed: [
        ["在输入框下部点按时，光标常落到上一行或别的位置：底部有一个看不见的输入框盖着，点按由它按自己的排版放光标。现在点按都按画出来的文字定位。", "Clicking near the bottom of the input often put the caret on the line above or elsewhere, because an invisible text field covered that area and placed the caret by its own layout. Clicks now follow the text you see."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.386", items: {
      improved: [
        ["把标签页拖出窗口、在另一个 Vibing Studio 窗口上松开，会放进那个窗口的标签条（按松开的位置插入）；在空处松开才开新窗口。独立窗口里的标签页也能这样拖回主窗口。需要 App 0.2.1.286 或更新版本。", "Drag a tab out of a window and release it over another Vibing Studio window to put it in that window’s tab bar at the spot you released; releasing over empty space still opens a new window. Tabs in separate windows can be dragged back the same way. Requires app 0.2.1.286 or later."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.385", items: {
      improved: [
        ["会话提问时选择「稍后」：已经选了的、写了一半的回答都会保留，再打开同一个问题时接着答。", "Choosing Later on a session’s question keeps what you’ve already picked or partly written, so you can pick up where you left off."],
      ],
      fixed: [
        ["回答问题时用键盘移动光标，画出来的光标不跟着动。", "When answering a question, the drawn caret didn’t follow keyboard movement."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.384", items: {
      fixed: [
        ["排队消息点「edit」后再发送，同一句话会发两遍：取回时 Claude Code 输入框里的文字没有清掉。", "Sending again after “edit” on queued messages sent the same text twice, because the text taken back was left in Claude Code’s input."],
        ["已经被读进去的排队消息（尤其是和别的话连在一起读进去的）仍显示为排队。", "Queued messages that had already been read (especially when read together with other text) still showed as queued."],
        ["向上翻阅时，提问那一行被顶部一行盖住后，顶部仍显示上一个提问；现在显示当前这一问。", "While scrolling back, when a prompt slid under the top row, the top row still showed the previous prompt; it now shows the current one."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.383", items: {
      new: [
        ["Codex 会话按 ← 打开 Codex 自己样式的会话列表：顶部搜索，表格列出更新时间、状态、目录和对话，↑↓ 选择、回车打开，搜不到时回车用这句开新会话；底部 ··· 中可换成 Claude Code 的样式。", "Pressing ← in a Codex session opens a Codex-style session list: search at the top, a table of updated time, status, directory and conversation; ↑↓ to choose, Return to open, and Return with no match starts a new session with your text. Switch to the Claude Code style from the ··· menu at the bottom."],
      ],
      fixed: [
        ["会话列表中当前会话的 Claude / OpenAI 标志显示为空白方块。", "The Claude / OpenAI logo for the current session in the session list showed as an empty box."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.382", items: {
      new: [
        ["提问卡片：会话问你问题而你正在看别的时，在窗口中间弹出问题卡片——上面是它提问前说的话，下面是问题和选项，点按或按数字直接回答，也可以自己写；「打开会话」查看全文，Esc 稍后再答。App 在后台时把窗口切到前面（设置 › 通用 可分别关闭；切到前面需要 App 0.2.1.285 或更新版本）。", "Question cards: when a session asks you something while you’re looking elsewhere, a card appears in the middle of the window — what it said before asking, then the question and options; click or press a number to answer, or type your own; Open Session shows the full context and Esc answers later. When the app is in the background its window comes to the front (each can be turned off in Settings › General; coming to the front requires app 0.2.1.285 or later)."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.381", items: {
      new: [
        ["Vibing Studio 使用手册：帮助 › Vibing Studio 使用手册，按章节的目录、搜索、配图，每篇有「另请参阅」和上一篇 / 下一篇。", "Vibing Studio User Guide: Help › Vibing Studio User Guide, with a chapter outline, search and illustrations; every topic has See also and previous / next links."],
        ["「历史记录」菜单同 Safari：返回、前进、最近关闭、重新打开上次关闭的标签页（⇧⌘T）、今天访问的记录和更早日期的子菜单。", "The History menu works like Safari’s: Back, Forward, Recently Closed, Reopen Last Closed Tab (⇧⌘T), today’s entries and submenus for earlier days."],
        ["清除历史记录时可选择范围：过去一小时、今天、今天和昨天、所有历史记录。", "Clear History lets you choose a range: the last hour, today, today and yesterday, or all history."],
        ["菜单栏图标（设置 › 通用，默认显示）：关闭窗口时 App 继续在后台运行，Agent 和命令不受影响，从菜单栏或程序坞叫回窗口。需要 App 0.2.1.284 或更新版本。", "Menu bar icon (Settings › General, on by default): closing the window keeps the app running in the background without affecting agents or commands; bring the window back from the menu bar or the Dock. Requires app 0.2.1.284 or later."],
      ],
      improved: [
        ["会话提问时：问题、选项和说明按任务翻译显示；选「Type something」后输入框腾出来写回答，原来输入框里的文字答完后放回；底部状态行显示「Waiting for your answer」。", "When a session asks a question: the question, options and descriptions follow task translation; choosing Type something clears the input for your answer and puts your earlier draft back afterwards; the status row shows “Waiting for your answer”."],
        ["「● N awaiting input」放在状态行最右侧，与状态文字不再重叠。", "“● N awaiting input” sits at the far right of the status row and no longer overlaps the status text."],
      ],
      fixed: [
        ["在输入框中点按时光标落点偏左几个字符。", "Clicking in the input field placed the caret several characters to the left."],
        ["点按对话中的文件路径会在内置浏览器中再打开一个 Vibing Studio；现在在右侧打开该文件。", "Clicking a file path in a conversation opened another copy of Vibing Studio in the built-in browser; it now opens the file on the right."],
        ["「重启以更新」有时没有反应，连续点按还可能同时启动多个替换过程；现在同一时间只有一个，旧版 App 退不了时状态栏提示按 ⌘Q。", "Restart to Update sometimes did nothing, and repeated clicks could start several replacements at once; now only one runs, and when an older app can’t quit itself the status bar asks you to press ⌘Q."],
        ["对话中偶尔出现从 Claude Code 屏幕上误抄的几行（数字、分栏的输出）。", "Stray lines copied from the Claude Code screen (numbers, columned output) occasionally appeared in conversations."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.379", items: {
      new: [
        ["Agent 活动改为活动监视器的结构：上方页签（概览、CPU、GPU、内存、磁盘、网络、能耗），中间是会话，底部是固定高度的资源条；系统资源不再单独占一个视图。", "Agent Activity now follows Activity Monitor: tabs on top (Overview, CPU, GPU, Memory, Disk, Network, Energy), sessions in the middle and a fixed-height resource strip at the bottom; system resources no longer need a separate view."],
        ["单击会话就地展开它的进程（命令行、用时、CPU、内存、PID），再次单击收起；右键打开会话。", "Click a session to expand its processes in place (command line, elapsed time, CPU, memory, PID); click again to collapse. Right-click opens the session."],
        ["电池（过去 12 小时）读取系统自己的电量记录。", "Battery (Last 12 Hours) reads the system’s own battery log."],
      ],
      improved: [
        ["数据与活动监视器一致：每秒更新；网络只统计实体网卡（不再把 VPN 隧道的流量计两次），总量按 1000 进位，下载、上传以 kb/秒 表示；大小、速率、百分比统一保留两位小数。", "Numbers match Activity Monitor: updated every second; network counts physical interfaces only (VPN tunnels are no longer counted twice), totals use 1000-based units, download and upload are in kb/s; sizes, rates and percentages all use two decimals."],
        ["状态写作「工作中（思考）」「工作中（输出）」「工作中（python3）」，不再随翻译闪动；合计行显示最长用时和平均上下文。", "Status reads “Working (thinking)”, “Working (output)” or “Working (python3)” and no longer flickers with translation; the totals row shows the longest elapsed time and the average context."],
        ["历史记录：表头在滚动时固定在顶部；除今天、昨天外以及条目较多的日期默认收起；分组名改为「今天访问」「昨天访问」；Codex 会话显示 OpenAI 标志；搜索框不再一直占用焦点（直接打字即可搜索，Esc 离开）。", "History: the column header stays at the top while scrolling; days other than today and yesterday, and days with many entries, start collapsed; groups are named Today and Yesterday; Codex sessions show the OpenAI logo; the search field no longer holds focus (type to search, Esc to leave)."],
      ],
      fixed: [
        ["排队消息的「edit」按 Claude Code 的默认方式取回（↑ 一次取回全部排队消息），不再中途停下并把文字留在 Claude Code 的输入框里。", "“edit” on queued messages works the way Claude Code does by default (↑ takes back all queued messages at once) and no longer stops halfway, leaving text in Claude Code’s input."],
        ["已经并入其他消息发出的排队消息不再一直挂着、点 send now 也没有反应。", "Queued messages that were already sent as part of another message no longer linger with an unresponsive send now."],
        ["排队中的消息始终显示附带的图片，不只在发送中的几秒内显示。", "Queued messages keep showing their attached images, not only during the few seconds while sending."],
        ["/goal 自动排入的「Goal set: …」照常列出，但不显示 send now。", "The “Goal set: …” entry that /goal queues is listed again, without send now."],
        ["向上翻阅时，顶部一行不再与紧接着的提问重复。", "While scrolling back, the top row no longer duplicates the prompt right below it."],
        ["会话名称、「Agent」表头和「合计」对齐。", "Session names, the Agent header and Total now line up."],
      ],
    } },
    { date: "2026-10-06", ver: "0.2.372", items: {
      new: [
        ["排队的消息可以取回修改：点「edit」或在空输入框按 ↑（同 Claude Code），排在 Claude Code 队列里的也能取回；「send now」点一次即生效，发送中不能重复点。", "Queued messages can be taken back for editing: click “edit” or press ↑ in an empty input (as in Claude Code), including ones already in Claude Code’s queue; “send now” acts once and can’t be clicked again while sending."],
        ["「run in background」可以直接点，等同按 ctrl+b；点了立即显示进度，失败会写明原因。", "“run in background” is clickable, the same as ctrl+b; it shows progress immediately and explains any failure."],
        ["会话在等待你回答或确认时：标签页图标变蓝，运行状态行右侧显示「awaiting input」，Dock 图标显示数量，未在查看时发送系统通知；不弹窗。", "When a session needs your answer or approval: its tab icon turns blue, the status row shows “awaiting input”, the Dock badge shows the count, and a system notification is sent when you aren’t looking at it. No pop-ups."],
        ["向上翻阅对话时，最上方一行显示当前段落所属的提问，点按跳到该提问（设置 › 高级，默认开）。", "While scrolling back, the top row shows the prompt the visible section belongs to; click it to jump there (Settings › Advanced, on by default)."],
        ["历史记录页改为 Safari 式的表格：按天分组可折叠，网站与地址两列，单击选中、双击打开、Delete 删除。", "The History page is now a Safari-style table: day groups you can collapse, Website and Address columns, click to select, double-click to open, Delete to remove."],
        ["Agent 活动面板加入整机状态：CPU、内存、能耗、磁盘、网络、GPU 六页，数据与图表同活动监视器；面板与任务清单之间的分隔线可以拖动。", "The Agent Activity panel adds whole-system stats in six pages (CPU, Memory, Energy, Disk, Network, GPU), matching Activity Monitor; the divider above it can be dragged."],
        ["App 原生部分有新版本时，状态栏显示「App 有新版本 · 重启以更新」，点按后原地替换并重新打开，旧版本保留在 Application Support 中。", "When a newer native app build is ready, the status bar shows “App update available · Restart to update”; clicking replaces the app in place and reopens it, keeping the previous build in Application Support."],
      ],
      improved: [
        ["附带的图片按 Claude Code 自己的方式发送：图片作为图片附件交给模型，不再只写路径。", "Attached images are sent the way Claude Code does it: as image attachments, not just file paths."],
        ["Claude Code 正在输出的段落实时显示，不必等整段写完。", "The paragraph Claude Code is currently writing appears live instead of only after it finishes."],
        ["Esc、ctrl+b、send now 直接通过后台服务送达，响应从数秒缩短到瞬间。", "Esc, ctrl+b and send now go straight through the background service, responding instantly instead of after several seconds."],
        ["排队中的消息列出附带的图片（[Image #N]，可悬停预览、点按放大），其他会话发来的消息也显示内容。", "Queued messages list their attached images ([Image #N], hover to preview, click to enlarge), and messages from other sessions show their content."],
        ["输入框中的 [Image #N]、[Pasted text …] 作为整体处理，光标不会进入其中。", "[Image #N] and [Pasted text …] chips in the input are treated as single units; the caret can’t land inside them."],
        ["重新打开或重新载入时，标签页直接显示会话名称，界面在字号和对话就绪后才显示。", "On reopen or reload, tabs show session names right away, and the window appears only once font size and conversations are ready."],
        ["拖动标签页时显示插入位置线。", "Dragging a tab shows an insertion line where it will land."],
        ["图片预览增加深浅两层描边，图片边缘与边框颜色相同时也能分辨。", "Image previews get a two-tone outline so edges stay visible even when they match the frame color."],
        ["状态名称改为「工作中 / 等待处理 / 空闲」；时间线配色收敛为同一色系。", "States are now called Working / Needs input / Idle; the timeline uses a restrained palette."],
      ],
      fixed: [
        ["修复开在后台服务中的会话被误判为「开在其他终端」，导致消息无法送达并弹出「接管」提示。", "Fixed sessions running in the background service being treated as open in another terminal, which blocked delivery and showed a “take over” prompt."],
        ["修复「自动化」权限已开启仍提示无法控制 iTerm2（新版 App 补上了所需的授权声明）。", "Fixed “can’t control iTerm2” errors even with Automation allowed (the new app build includes the required entitlement)."],
        ["修复 /goal 等立即生效的命令一直显示为排队中。", "Fixed commands that take effect immediately, such as /goal, staying in the queue."],
        ["修复右侧栏「N 个已结束」展开要等一两秒。", "Fixed the “N finished” rows in the side bar taking a second or two to expand."],
        ["修复重启后字号先按默认值显示再跳变。", "Fixed the font size jumping after relaunch."],
        ["修复 App 退出或重新载入时，正在发送的消息丢失。", "Fixed a message being lost if the app quit or reloaded while it was being sent."],
      ],
    } },
    { date: "2026-10-05", ver: "0.2.360", items: {
      new: [
        ["AskUserQuestion 的回答显示为「User answered Claude's questions」。", "Answers to AskUserQuestion appear as “User answered Claude's questions”."],
        ["压缩分隔线写出压缩前后的大小。", "Compaction dividers show the size before and after."],
        ["iPad：打开时显示真实的载入进度和连接步骤，每 12 小时自动续签。", "iPad: real loading progress and connection steps on launch; automatic re-signing every 12 hours."],
      ],
      improved: [
        ["思考提示只把「thinking」几个字逐渐变黄；动词保持原色。", "Only the “thinking” words fade to yellow; the verb keeps its color."],
        ["图片编号接着会话往下编，留在插入的位置。", "Image numbers continue across the session and stay where they were inserted."],
        ["滚动按整行进行（触控板、滚轮、iPad 手指），到顶到底不回弹。", "Scrolling moves line by line (trackpad, wheel, iPad touch) without bouncing at the ends."],
        ["默认字号改为 12（同 iTerm2 Monaco 12）；⌘+ / ⌘- 调过的字号重启后保留。", "Default font size is now 12 (matching iTerm2 Monaco 12); ⌘+ / ⌘- changes persist across restarts."],
        ["搜索当前会话即时出结果，点按精确跳到命中位置并高亮；搜索词重新打开后保留。", "Searching the open conversation is instant; results jump to the exact match and highlight it; the query is kept across restarts."],
        ["界面文字改为专业表述。", "Interface wording rewritten to be precise and professional."],
      ],
      fixed: [
        ["修复中断标记显示在错误的位置。", "Fixed the Interrupted marker appearing in the wrong place."],
        ["修复回退（rewind）后旧分支与新分支重复显示。", "Fixed abandoned branches showing alongside the new one after a rewind."],
        ["修复空闲时发送的消息显示「send now」，以及未发出的消息被高亮。", "Fixed “send now” showing for messages sent while idle, and unsent messages being highlighted."],
        ["修复旋转、改变窗口大小后标签页概览缩略图错位。", "Fixed misplaced tab overview thumbnails after rotating or resizing."],
      ],
    } },
    { date: "2026-09-29", ver: "0.2.327", items: {
      new: [
        ["Agent 活动换成活动监视器式的表格：每个会话在做什么、用时、CPU、内存、上下文；右上角的按钮把它挪到右侧栏或底部面板。", "Agent Activity is now an Activity Monitor–style table — what each session is doing, time, CPU, memory and context — and can move to the secondary side bar or the panel."],
        ["回复实时显示：Claude Code 后台会话正在写的话，写的时候就显示，写完换成正式的（设置 › 对话）。", "Live replies: text a Claude Code background session is writing shows up as it is written, then turns into the final reply (Settings › Conversation)."],
        ["设置的配置文件：存一份现在的设置、换成存过的一份、恢复默认（设置 › 高级）。", "Settings profiles: save the current settings, switch to a saved set, or restore the defaults (Settings › Advanced)."],
        ["第一次打开时选外观：Visual Studio Code + 终端界面，或 Claude Desktop。", "Choose a look the first time you open the app: Visual Studio Code with the terminal UI, or Claude Desktop."],
        ["跑完的一组命令：点一下列出每条的标题，再点其中一条只展开它（灰底，点它收起）；在跑的也行。", "Finished command groups open to a list of titles; click one to expand just that item (click its gray block to fold it). Works while running too."],
        ["对话宽度：最大利用 / 效率 / 经典（经典同 Claude Desktop）。", "Conversation width: Full, Efficient or Classic (Classic matches Claude Desktop)."],
      ],
      improved: [
        ["Agent Finder：点 Claude Code、Codex 直接到 `~`；分栏的方向键同访达（← 只退一层）；列表里选中的用强调色；连接器有右键菜单。", "Agent Finder: Claude Code and Codex open at `~`; arrow keys in column view work like Finder (← goes up one level); selections use the accent color; connectors have a context menu."],
        ["⚙ 菜单：设置 › 风格 › 主题；命令面板不再放在这里（`⇧⌘P` 照样能开）。", "⚙ menu: Settings › Style › Theme; the Command Palette entry is gone (`⇧⌘P` still works)."],
        ["夜间配色：你说的话那一条底色更淡，边线更轻。", "Dark theme: lighter prompt bars and softer borders."],
        ["输入框：图多时自动折行；↑↓ 按画出来的行走；附的图接着这个会话的号往下编。", "Input box: image chips wrap; ↑↓ follow the wrapped lines; attached images continue the session's numbering."],
        ["设置开在标签页里时左右居中；通用页放常用的几项。", "Settings opened in a tab are centered; the General page gathers the common options."],
      ],
      fixed: [
        ["修复重新载入后标签页全丢、只剩历史记录的问题；万一又只剩空白页，历史记录页上能一键恢复上次的标签页。", "Fixed tabs being lost after a reload; if it ever happens again, the History page offers to reopen the previous tabs."],
        ["修复右侧栏分组标题突然变得很大。", "Fixed oversized section titles in the secondary side bar."],
        ["修复 TUI 里选中文字后常常没复制上。", "Fixed selected text in the TUI often not being copied."],
        ["修复「n background agents launched」那一块错位、上下没有空行。", "Fixed the misaligned “n background agents launched” block."],
        ["修复子 Agent 标签页里转圈那一行一直是空的。", "Fixed the empty status line in sub-agent tabs."],
        ["Codex：刚发的话不再显示成排队；转圈照样转。", "Codex: just-sent messages no longer show as queued, and the spinner animates."],
      ],
    } },
    { date: "2026-09-28", ver: "0.2.1", items: {
      new: [
        ["四种系统风格：VS Code、Claude App、macOS、Pure Terminal，菜单栏「显示」里或 `⌃⌘1`–`⌃⌘4` 随时切换；Agent 显示风格（TUI / GUI）单独选，Claude App 固定 GUI、Pure Terminal 固定 TUI。", "Four OS styles — VS Code, Claude App, macOS and Pure Terminal — switchable any time from the View menu or with `⌃⌘1`–`⌃⌘4`. The agent viewer style (TUI / GUI) is chosen separately; Claude App always uses GUI and Pure Terminal always uses TUI."],
        ["macOS 风格：桌面、墙纸、菜单栏、程序坞和桌面小组件；每个标签页是桌面上的一个窗口，可以拖动、缩放、贴边平铺和最小化。", "macOS style: a desktop with wallpaper, menu bar, Dock and widgets. Every tab is a window you can move, resize, tile and minimize."],
        ["程序坞里最小化的窗口显示它真实的样子。", "Minimized windows show a live thumbnail in the Dock."],
        ["调度中心（`⌃↑`、`F3` 或程序坞里的图标）：每个窗口保持自己的大小比例，同一个 App 的窗口叠成一摞；点一个窗口就回到它。", "Mission Control (`⌃↑`, `F3` or the Dock icon) keeps every window's proportions and stacks windows of the same app; click a window to jump to it."],
        ["新会话页的用量卡片：会话、消息、token、活跃天数、高峰时段、最常用模型，按天的热力图和按模型的用量图（全部 / 30 天 / 7 天）。", "A usage card on the new-session screen: sessions, messages, tokens, active days, peak hour and favorite model, with a daily heatmap and per-model chart (All / 30d / 7d)."],
        ["多窗口：`⇧⌘N` 新建窗口；把标签页拖出窗口，或在标签页上右键「移到新窗口」。", "Multiple windows: `⇧⌘N` opens a new window; drag a tab out of the window or choose Move to New Window."],
        ["访达：图标、列表、分栏、画廊四种视图；按名称、日期、大小、种类排序和分组；右键菜单有打开方式、移到废纸篓、压缩、复制、制作替身和颜色标签。", "Finder: icon, list, column and gallery views; sort and group by name, date, size and kind; the context menu adds Open With, Move to Trash, Compress, Duplicate, Make Alias and color tags."],
        ["设置里新增「账户」：头像、GitHub 账号、余额与用量、退出登录。", "Settings has a new Account page: avatar, GitHub account, balance and usage, and Log out."],
        ["Claude App 风格：侧栏筛选（状态、环境、分组、排序），会话行的 ⋯ 菜单（分屏打开、新窗口、在 VS Code / 访达中打开、置顶、标为未读、重命名、复刻、移到分组、归档、删除），← → 真正能前进后退，新会话在发出第一句话之前不创建。", "Claude App style: sidebar filters (status, environment, grouping, sorting), a ⋯ menu on each session (split view, new window, open in VS Code or Finder, pin, mark unread, rename, fork, move to group, archive, delete), working back and forward arrows, and new sessions that aren't created until the first message."],
        ["对话内容按工具类别显示：读取与搜索、命令、文件更改、网页、子 Agent、任务清单、其他工具，每类可选「完整结果 / 结果预览 / 只看调用 / 隐藏」；出错的结果总是完整显示。", "Conversation content is filtered by tool category — read & search, commands, file changes, web, subagents, to-dos and other tools — each showing the full result, a preview, just the call, or nothing; failed results always show in full."],
        ["Agent 说的话分成「过程说明」（做事中间的旁白）和「最终回复」（对你说的结论），各自可设完整 / 一行 / 隐藏；每个工具都能单独设置；子 Agent 可以分别看任务说明、它的过程和结果。", "Agent text is split into progress notes (narration between steps) and the final reply, each with its own mode; every tool can be set individually; subagent calls show the brief, its steps and its report separately."],
        ["系统错误（余额不足、429、服务器出错、网络断开、已中断……）和运行状态行（✢ … 用时 · token）各自单独筛选：完整 / 一行（简洁）/ 隐藏。", "System errors (out of credit, 429, server errors, network failures, interrupted…) and the working-status row (✢ … time · tokens) now have their own filters: full, one line (compact) or hidden."],
        ["每个 Agent 右上角的 ⋯ 里可以直接切换 TUI / GUI。", "Switch between TUI and GUI from the ⋯ menu of any agent."],
        ["全局助手：辅助侧栏顶上切换「Agent | 全局」，全局那边是一个管理用的 Agent——能看所有 Agent 的状态和最近对话、给它们发消息、新建 / 打断 / 归档，也能看和调整布局（开标签页、分屏、侧栏、面板、界面设置）。Claude App 风格在标题栏的 ✦，macOS 风格在程序坞。", "Studio Assistant: switch the secondary side bar between Agent and Global. The global side is a management agent that can see every agent's state and recent conversation, message, create, interrupt or archive agents, and read or adjust the layout (open tabs, splits, side bars, panel, UI settings). In Claude App style it's the ✦ in the title row; in macOS style it's in the Dock."],
        ["任务清单（TaskCreate / TaskUpdate / TaskList）现在真的能被 Agent 用上。", "Agents can now actually use the task list tools (TaskCreate / TaskUpdate / TaskList)."],
        ["后台任务和子 Agent 跟着 Agent 走：每个 Agent 标签页底部有自己的抽屉；底部面板里是按 Agent 分组的「Agent 活动」。", "Background tasks and subagents now belong to their agent: each agent tab has its own drawer, and the bottom panel shows Agent Activity grouped by agent."],
        ["访达里的 Agent 显示它真实的对话；快速查看从图标放大、按内容定大小；文件、文件夹、空白处的右键菜单各不相同。", "Agents in Finder show their real conversation; Quick Look zooms from the icon and sizes itself to the content; files, folders and empty space each get their own context menu."],
        ["管理员命令 `/admin credit <账号> <金额>`、`/admin allow <账号>` 在终端和图形界面里都能用。", "The admin commands `/admin credit <login> <amount>` and `/admin allow <login>` work in both the TUI and the GUI."],
        ["活动栏大小：正常 / 紧凑。", "Activity bar size: Normal or Compact."],
        ["点头像有「账号设置…」，直接到设置里的账号页。", "The avatar menu has Account Settings…, which opens the Account page in Settings."],
        ["更新内容：就是这里，「帮助 › 更新内容」。", "What's new — this window, under Help › What's New."],
        ["缩略图（minimap）：TUI 里和真实画面一样的颜色，GUI 里也有；对话可以显示每条消息的时间。", "Minimap: the TUI minimap now uses the real on-screen colors, and the GUI has one too. Conversations can show a timestamp on every message."],
        ["Agents 视图像文件管理器一样新建 Agent 和文件夹，Agent 可以放进多层文件夹里。", "Create agents and folders in the Agents view just like files in an explorer, and nest agents in folders."],
        ["Claude Code 和 Codex 的会话都能用 GUI 打开；切换 TUI / GUI 时已经打开的标签页跟着换。", "Claude Code and Codex sessions open in the GUI too, and switching between TUI and GUI re-wraps tabs that are already open."],
        ["GUI 里切换模型是真的：列出连接器真实的模型（包括 `[1m]` 的 1M 上下文版本），从下一条消息起生效，Agent 保持不变；模型标签显示实际在用的模型和 Agent 名字。", "Model switching in the GUI is real: it lists the connector's actual models (including the `[1m]` 1M-context variants), applies from the next message and keeps the agent; the chip shows the model actually in use and the agent's name."],
        ["上下文压缩显示成一条分隔线（「上下文已压缩（原 … token）· 摘要 ▸」），点开能看摘要；TUI 和 GUI 都有。", "Context compaction shows as a divider (\"Context compacted (was … tokens) · summary ▸\") that expands to the summary, in both the TUI and the GUI."],
        ["Agent 之间的消息按 Claude Code 的样子显示：收起时一行「› Message from @…（ctrl+o 展开）」，展开是灰底的消息；另有 Teyvat 风格可选。", "Messages between agents look like Claude Code's: a single \"› Message from @… (ctrl+o to expand)\" line that expands into a grey block, with a Teyvat-style alternative."],
        ["Codex 连接器：侧栏里有 Codex 的会话，用 TUI 或 GUI 打开；设置里新增「连接器」，可开关、看版本和位置、重新检测。", "A Codex connector: Codex sessions appear in the side bar and open in the TUI or GUI. Settings has a new Connectors page to turn connectors on or off, see their version and location, and detect them again."],
        ["Claude Code 会话里排队等着的消息显示出来（同 Claude Code 的样子，GUI 里是小卡片）；做事中间插进去的消息也显示成你说的话。", "Queued messages in Claude Code sessions now show up, styled like Claude Code (as chips in the GUI), and messages absorbed mid-turn show as your own prompts."],
        ["运行状态行的 token 数和用时直接从会话记录读出来，和 Claude Code 里显示的一致；任务清单同 Claude Code 显示在状态行下面。", "The working row's token count and elapsed time are read straight from the transcript and match Claude Code, and the task list sits under it like in Claude Code."],
        ["给在后台运行的 Claude Code 会话发消息：直接送进那个会话里。", "Send messages to Claude Code sessions running in the background — they go straight into that session."],
        ["GUI 里 Agent 运行时也能接着发消息（排队，可「立即发送」或编辑）；停止按钮收进运行状态行，指着才出现，也可以按 Esc。", "In the GUI you can keep sending while the agent works — messages queue up with Send Now and Edit — and Stop moves into the working row, appearing on hover (Esc works too)."],
        ["显示语言默认跟随系统。", "The display language now follows the system by default."],
        ["Agent 标签页内拆分：`⌘D` / `⇧⌘D` 把同一个 Agent 分成几栏，每栏有自己的筛选——先选预设（默认、只看对话、只看工具、调试、精简，或你自己存的），需要时再「编辑…」在右边细调、存成预设；每个筛选都能一键「反选」。", "Split inside an agent tab: `⌘D` / `⇧⌘D` splits the same agent into panes, each with its own filter. Pick a preset first — Default, Conversation Only, Tools Only, Debug, Minimal or your own — then use Edit… to fine-tune it in a side column and save it as a preset. Every filter can be inverted in one click."],
        ["在任意文件夹里新建 Claude Code 或 Codex 会话；Codex 会话能接着发消息。", "Start a new Claude Code or Codex session in any folder, and keep talking to Codex sessions."],
        ["底部面板分「Agent | 全局」两层：Agent 一层就是这个 Agent 的底部——运行状态、子 Agent、输入框、状态行；Agent 标签页里只留对话。全局一层是终端和 Agent 活动。", "The bottom panel has two levels, Agent and Global. The Agent level is the agent's footer — working status, subagents, input and status line — so the agent tab shows only the conversation; the Global level holds the terminal and Agent Activity."],
        ["Claude Code 会话的子 Agent 和后台命令都显示出来了：状态、用时、token、最近几步、最终结果；点开看详情。", "Subagents and background commands of Claude Code sessions now show up with their status, duration, tokens, latest steps and final report; click one for details."],
        ["连接器里可以关掉 Paimon Code。", "Paimon Code can be turned off in Connectors."],
        ["Agent 的底部就在标签页里：运行状态、输入框、状态行，下面同 Claude Code 的「● main」和子 Agent 列表（跑完的收成「✓ n completed」）；上边缘可以拖动调高度，··· 里选显示哪些。底部面板只放全局的：终端、Agent 活动、助手。", "The agent's footer now lives inside its tab — working status, input and status line, then a Claude Code-style \"● main\" subagent list (finished ones fold into \"✓ n completed\"). Drag its top edge to resize, and use ··· to choose what it shows. The bottom panel holds only global views: Terminal, Agent Activity and the Assistant."],
        ["对话筛选新增「Agent 消息」：收到的、发出的、子 Agent 报告各自或一起设置完整 / 一行 / 隐藏。", "A new Agent Messages filter group: set incoming messages, outgoing messages and subagent reports to full, one line or hidden — together or one by one."],
        ["设置窗口是真正的一层：打开时后面的界面都点不到。", "The Settings window is a real layer now — nothing behind it can be clicked while it's open."],
        ["字体分成三种：应用界面字体、Agent 界面字体（任务、子 Agent、GUI 对话这些跟着它）、代码字体；选系统字体时 Agents 树也用系统字体。", "Fonts are now split into three: App Interface Font, Agent Interface Font (tasks, subagents and the GUI conversation follow it) and Code Font — and with a system font the Agents tree uses it too."],
        ["Finder：分栏视图每栏标出种类、栏线封闭，打开最后一级文件夹不再跳走；没选中时预览留空；左右两栏可以拖宽度；Agent 图标换成随深浅色的中性图标；底部一条对齐；路径栏的文件夹图标跟列表一致。", "Finder: column view labels each column and keeps it there when you open the last folder, the preview stays empty until you select something, both side panes resize, agent icons are neutral and follow light/dark, the bottom band lines up, and path bar folders match the list."],
        ["任务翻译：设置 › 对话里打开后，任务清单、后台任务、子 Agent 的描述翻成你选的语言（命令不翻，原文在悬停提示里）；翻过的都缓存起来不再重复翻，用量页能看到翻译花了多少。", "Task translation: turn it on in Settings › Conversation to show task lists, background tasks and subagent descriptions in your chosen language (commands stay as they are; the original is in the tooltip). Translations are cached so nothing is translated twice, and Usage shows what translation costs."],
        ["启动不再闪白：窗口一出来就是 App 自己的底色，界面搭好后淡入；启动也更快。", "No more white flash at launch: the window opens in the app's own background color and the interface fades in once it's ready — and launch is faster."],
        ["每个区域的右键菜单只管这个区域：底部面板、辅助侧栏、对话各有自己的菜单，勾选状态跟实际一致。", "Every region now has its own context menu — the bottom panel, the secondary side bar and the conversation — with checkmarks that match the actual state."],
        ["上下文用量明细：GUI 里点上下文圆环、TUI 里点「Ctx」或输入 `/context`，按系统提示词、工具、MCP、技能、自定义 Agent、记忆文件、消息分开列出各占多少 token；Claude Code 和 Codex 会话按会话记录里真实的数字算。", "Context usage breakdown: click the context ring in the GUI, or \"Ctx\" / `/context` in the TUI, to see how many tokens go to the system prompt, tools, MCP, skills, custom agents, memory files and messages — computed from the real numbers in Claude Code and Codex transcripts."],
      ],
      improved: [
        ["设置只显示通用设置和当前系统风格自己的设置；说明文字只在需要的地方出现；下拉框和分段控件重新设计。", "Settings show only the general settings plus those of the current OS style; descriptions appear only where they help; dropdowns and segmented controls were redesigned."],
        ["设置重新排版：搜索在左边目录上方，右边分两级（比如 连接器 › Claude Code），第二级的标题是路径、点上一级就回去；勾选框换成滑动开关；点任何控件都不会让页面滑动；Claude App 风格里设置是一张毛玻璃浮窗，可以拖动。", "Settings were reorganized: search sits above the sidebar, pages have two levels (for example Connectors › Claude Code) with a clickable breadcrumb to go back up, checkboxes are now switches, clicking a control never scrolls the page, and in Claude App style Settings opens as a draggable frosted-glass window."],
        ["账号 › 个人资料：头像可以切换（GitHub 头像或姓名缩写），可以填全名和「Agent 怎么称呼你」。", "Account › Profile: switch your avatar between your GitHub photo and your initials, and set your full name and what agents should call you."],
        ["分段控件、开关换选项时，选中的那一块会像玻璃一样滑过去；指着的选项有底色提示。", "Segmented controls and switches slide their selection like a piece of glass, and hovered options are highlighted."],
        ["在当前系统风格下用不了的选项（比如 Claude App 下的 TUI）显示为灰色并注明原因，不再直接藏起来。", "Options that don't apply to the current OS style (such as TUI in Claude App) are shown disabled with the reason instead of being hidden."],
        ["滚动到顶部或底部时不再回弹。", "Scroll areas no longer rubber-band at the top and bottom."],
        ["侧栏视图改叫 Agents 和 Files，四个视图的标题行对齐。", "The side bar views are now called Agents and Files, and all four view headers line up."],
        ["底部面板默认只在编辑区下面，不再伸到主侧栏下。", "The bottom panel now sits only under the editor by default instead of extending under the primary side bar."],
        ["仪表盘不再出现在任何菜单和按钮里（要用时在地址栏输入 `dash.local.paimon`）。", "The dashboard is no longer offered in menus or buttons (type `dash.local.paimon` in the address bar if you need it)."],
        ["访达预览栏去掉了「打开」「显示包内容」按钮和最后一句话的摘录，同 macOS。", "The Finder preview pane no longer shows Open / Show Package Contents buttons or the last message, matching macOS."],
        ["macOS 风格的窗口加了一圈细亮边，深色背景上也看得清窗口的边界；开、关窗口有动画。", "macOS-style windows have a thin light edge so they stay distinct on dark backgrounds, and they animate when opening and closing."],
        ["双击标题栏在「填充」和原来的大小之间切换；平铺到半边的窗口双击也能还原，重开 App 后仍然记得。", "Double-clicking a title bar toggles between Fill and the previous size — tiled windows restore too, even after relaunching."],
        ["✻ 菜单只留关于本机、系统风格、Agent 显示风格、重新启动和退出登录。", "The ✻ menu now holds only About This Mac, OS Style, Agent Viewer Style, Restart and Log Out."],
        ["原生右键菜单跟着 App 的深浅色，不再跟着系统。", "Native context menus follow the app's light or dark theme instead of the system's."],
        ["Claude App 风格用回 Claude 原本的深色配色；侧栏更紧凑；主区域没有边框，顶部的消息渐隐进标题行；整个标题行都能拖动窗口。", "Claude App style uses Claude's own dark palette, a more compact sidebar, and a frameless main area where messages fade out under the title row; the whole title row now drags the window."],
        ["布局固定下来：输入框、运行状态、状态行在 Agent 底部，任务类（任务清单、后台任务、子 Agent）在右侧栏。", "A fixed layout: the input, working status and status line sit at the bottom of the agent, and the task family (to-dos, background tasks, subagents) lives in the right side bar."],
        ["右侧栏的 Agent 一层跟着 Agent 走：当前标签页不是 Agent（设置、文件）时显示最近用的那个 Agent，标题上写着是哪个；一个 Agent 都没开时可以直接新建。", "The side bar's Agent level follows your agent: when the current tab isn't an agent (Settings, a file) it shows the most recent one and names it in the header, and with no agent open it offers New Agent."],
        ["macOS 和 Pure Terminal 风格暂停开发：在列表里标注出来，切换过去之前会提醒。", "Development of the macOS and Pure Terminal styles is paused: they're marked as such, and switching to them asks first."],
        ["Agents 视图里「新建 Agent」「新建文件夹」挪到 Paimon Code 那一组的标题旁边，Claude Code、Codex 的标题旁边是「新建会话」。", "In the Agents view, New Agent and New Folder now sit beside the Paimon Code heading, and Claude Code and Codex each get New Session beside theirs."],
        ["任务、后台任务、子 Agent 各组展开收起有动画并记住；运行时间原地走动，不再整块刷新。", "Task, background task and subagent sections animate when expanding or collapsing and remember their state, and running times tick in place instead of redrawing the whole list."],
      ],
      fixed: [
        ["修复余额小组件把金额显示成原始数值（例如 `-52826`）的问题，现在是 `-¥0.05` 这样的金额。", "Fixed the balance widget showing the raw value (for example `-52826`) instead of an amount like `-¥0.05`."],
        ["修复 macOS 风格下桌面一片漆黑、窗口和背景分不清的问题。", "Fixed the macOS-style desktop being pitch black, which made windows hard to tell apart from the background."],
        ["修复程序坞里最小化的窗口只显示成一个空白小图标的问题。", "Fixed minimized windows appearing as a blank tile in the Dock."],
        ["修复设置里切换分区时画面闪烁的问题。", "Fixed settings flickering when switching sections."],
        ["修复右键菜单勾选一项后会关掉再自动弹出来（闪一下）的问题：系统菜单选完就关，自绘菜单原地更新。", "Fixed context menus closing and popping back open after toggling an item: native menus now simply close, drawn menus update in place."],
        ["修复隐藏文件后列表下面还能滚出一大段空行的问题。", "Fixed lists scrolling into a long run of empty rows after hidden files were hidden."],
        ["修复在 macOS、Claude App、Pure Terminal 风格下，Agent 状态信息被送到看不见的状态栏里的问题。", "Fixed agent status info going to the hidden status bar in the macOS, Claude App and Pure Terminal styles."],
        ["修复 Claude Code 会话有时把同一段内容读两遍、显示重复的问题。", "Fixed Claude Code sessions sometimes reading and showing the same content twice."],
        ["修复把压缩后的摘要、命令输出这类系统内容当成你说的话显示的问题。", "Fixed compaction summaries and command output being shown as if you had typed them."],
        ["修复主题选「跟随系统」时读不到 macOS 的深浅色、切换没反应的问题。", "Fixed Follow System not picking up macOS's light or dark appearance."],
        ["修复 Agent Finder 的字号不跟随设置的问题。", "Fixed Agent Finder ignoring the font size setting."],
        ["修复 Claude App 风格下 Agent Finder 等页面顶部被渐隐盖住的问题：只有对话滚动时，消息在标题行下面淡出。", "Fixed the top of Agent Finder and other pages being faded in Claude App style; only scrolled conversation messages fade under the title row now."],
        ["修复图形界面里点别处输入框不失焦的问题。", "Fixed the GUI input keeping focus when you click elsewhere."],
        ["修复换深浅色后分段控件选中块颜色不对的问题；Claude App 风格的分段控件改成 Claude 那种收敛的样子。", "Fixed segmented controls keeping the wrong selection color after switching light/dark, and Claude App style now uses Claude's restrained segmented controls."],
        ["修复 Claude App 侧栏里没有 Claude Code 会话的问题。", "Fixed Claude Code sessions missing from the Claude App sidebar."],
      ],
    } },
    { date: "2026-09-27", ver: "0.2.0", items: {
      new: [
        ["改名 Vibing Studio，换了新图标；版本号改成 `x.y.z.构建号`。", "Renamed to Vibing Studio with a new icon; versions are now `x.y.z.build`."],
        ["VS Code 式的工作台：活动栏、侧栏、面板、状态栏，编辑组分屏，每组一条标签栏；标签页可以拖动排序、拖进分屏。", "A VS Code-style workbench: activity bar, side bar, panel and status bar, split editor groups with their own tab bars, and draggable tabs."],
        ["图形界面（GUI）的对话：和 Claude App 一样紧凑好看；和终端界面（TUI）用同一个 agent，随时切换。", "A graphical (GUI) conversation view as compact as the Claude app, sharing the same agent with the terminal (TUI) view."],
        ["原生的右键菜单和菜单栏；内嵌浏览器（`localhost` 调试就在标签页里）；Agent Finder 和 File Finder。", "Native context menus and menu bar, a built-in browser for `localhost` debugging, plus Agent Finder and File Finder."],
        ["键盘快捷方式编辑器、字体设置、状态栏（全局或每个标签页里）。", "A keyboard shortcuts editor, font settings, and a global or per-tab status line."],
      ],
      fixed: [
        ["修复有时打开 App 只有一个空白窗口的问题。", "Fixed the app sometimes opening to a blank window."],
        ["修复重新打开 App（点程序坞图标）时可能崩溃的问题。", "Fixed a crash when reopening the app from the Dock."],
      ],
    } },
  ];
  var SECS = [["new", "新增", "New"], ["improved", "改进", "Improved"], ["fixed", "修复", "Fixed"]];
  var ICON = '<i class="st-ico st-i-svg"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8l1.5 3.4 3.7.4-2.8 2.5.8 3.6L8 9.9l-3.2 1.8.8-3.6L2.8 5.6l3.7-.4z"/></svg></i>';
  var inline = function (s) { return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>"); };
  var dateOf = function (d) { if (!d) return ""; var x = new Date(d + "T12:00:00"); return en() ? x.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : x.getFullYear() + " 年 " + (x.getMonth() + 1) + " 月 " + x.getDate() + " 日"; };
  // 只写了版本号、没写日期的条目：日期从 builds.json（部署时记的每一版的时间）取
  var BUILDS = null;
  try { fetch("builds.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { BUILDS = j; LOG.forEach(function (r) { if (!r.date && BUILDS && BUILDS[r.ver]) r.date = String(BUILDS[r.ver]).slice(0, 10); }); }, function () {}); } catch (e) { /* 没有就按写的日期 */ }
  function body() {
    return LOG.map(function (r) {
      return '<section class="cl-rel"><div class="cl-h"><span class="cl-date">' + esc(dateOf(r.date)) + '</span><span class="cl-ver">' + esc(r.ver) + "</span></div>" +
        SECS.filter(function (s) { return (r.items[s[0]] || []).length; }).map(function (s) {
          return '<div class="cl-sec">' + esc(tr(s[1], s[2])) + "</div><ul>" + r.items[s[0]].map(function (x) { return "<li>" + inline(en() ? x[1] : x[0]) + "</li>"; }).join("") + "</ul>";
        }).join("") + "</section>";
    }).join("");
  }
  // ---- Claude App、Pure Terminal：盖在窗口上的卡片 ----
  var cur = null, curM = null;
  // Claude App 风格：放进共用的模态层（STUDIO.modal）——底下的 App 标成 inert、焦点关掉时还回去、原生网页被盖住就藏起来；Pure Terminal 照旧
  function close() { if (!cur) return; var w = cur, M = curM; cur = null; curM = null; w.classList.add("out"); setTimeout(function () { if (M && S && S.modal) S.modal.close(M); else w.remove(); }, 160); document.removeEventListener("keydown", onKey, true); }
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }
  function modal() {
    if (cur) return;
    cur = document.createElement("div");
    cur.className = "cl-wrap";
    cur.innerHTML = '<div class="cl-modal" role="dialog" aria-modal="true" aria-label="' + esc(tr("更新内容", "What's new")) + '"><div class="cl-top"><b>' + esc(tr("更新内容", "What's new")) +
      '</b><button type="button" class="cl-x" aria-label="' + esc(tr("关闭", "Close")) + '"><svg viewBox="0 0 16 16" width="16" height="16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button></div><div class="cl cl-scroll">' + body() + "</div></div>";
    cur.addEventListener("mousedown", function (e) { if (e.target === cur) close(); });
    cur.querySelector(".cl-x").addEventListener("click", close);
    if (root.classList.contains("st-os-claude") && S && S.modal) curM = S.modal.open(cur, { cls: "cl-layer", onBackdrop: close }); else document.body.appendChild(cur);
    document.addEventListener("keydown", onKey, true);
    cur.querySelector(".cl-x").focus();
  }
  // ---- VS Code：标签页；macOS：窗口 ----
  if (S && S.pages) S.pages.changelog = {
    title: function () { return tr("更新内容", "Release Notes"); },
    address: function () { return "changelog.local.paimon"; },
    icon: function () { return ICON; },
    render: function (host) { host.innerHTML = '<div class="cl cl-page"><h1>' + esc(tr("Vibing Studio 更新内容", "Vibing Studio Release Notes")) + "</h1>" + body() + "</div>"; },
    focus: function () {},
  };
  function open(tw) {
    var T = window.TSU_TERM;
    tw = tw || (T && T.front ? T.front() : null);
    if (root.classList.contains("st-os-vscode") && tw && S && S.openPage) {
      var hit = null;
      tw.ws.all().forEach(function (p) { if (!hit && p.program && p.program.page === "changelog") hit = p; });
      if (hit) tw.ws.show(hit); else S.openPage(tw, "changelog", null);
      return;
    }
    if (root.classList.contains("st-macos") && tw && S && S.showPage) { S.showPage(tw, "changelog", null); return; }
    modal();
  }
  if (S && S.command) S.command("help.whatsNew", { title: "更新内容", run: function (tw) { open(tw); } }); // 英文界面由 i18n 译成 What's New
  window.TSU_CHANGELOG = { open: open, close: close, latest: LOG[0].ver, entries: LOG };
})();
