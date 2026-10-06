# Paimon（macOS App）

把 code.paimon.beer 的网页桌面装进一个原生窗口（WKWebView），再给网页一座桥 `window.nadosNative`：系统的权限（通知、屏幕录制、辅助功能、摄像头、麦克风）由 App 向 macOS 申请，网页桌面和 agent 通过桥来用。浏览器里打开网页时没有这座桥，一切照旧。

Swift + AppKit + WKWebView，不用 Electron：用系统自带的 WebKit，包很小；以后 iOS App 用同一套 WKWebView + 同一份桥协议。

## Paimon Terminal（同一套代码的第二个 App）

只有终端的 App（同 iTerm）：整个窗口就是终端（标签页、分屏、agent），shell 是这台 Mac 上你真的登录 shell（你的 `~`、你装的工具），不经过服务器的沙盒。

```sh
MODE=terminal apps/macos/build.sh          # ~/Applications/Paimon Terminal.app（bundle id beer.paimon.terminal，深色图标）
open ~/Applications/"Paimon Terminal.app"   # 打开的是 https://code.paimon.beer/terminal.html；本地开发 --args --url http://localhost:8787/terminal.html
```

- 登录：第一次点「用 GitHub 登录」，登录在系统浏览器里做（`ASWebAuthenticationSession`，用浏览器里已登录的 GitHub、通行密钥），做完回到 App。它和 Paimon 各有各的登录状态。
- 在终端里敲 `paimon`（`paimon new 名字`、`paimon 名字`）：在当前目录打开 agent 的界面，agent 就在这个目录干活（同 Claude Code）。`paimon` 这个命令在 App 里（`Resources/bin/paimon`），App 开的 shell 的 PATH 里有它。
- agent 的工具（Bash、Read、Write、Edit、Glob、Grep）在这台 Mac 上跑（`Sources/Local.swift`），按档位（shift+tab）限制，由 macOS 自带的 Seatbelt 执行：
  - none：只能读写工作目录；
  - read：哪都能读，只能写工作目录（和临时、缓存目录）；
  - rw：跟你一样。
  - 不是 rw 时还不能发 Apple Events、不能经 LaunchServices 另起不受限的进程、不能给沙盒外的进程发信号。agent 自己的笔记在 `~/.paimon/MemoryData/<id>`。
- 模型照旧走账号（按额度计费，Key 在服务器上）；agent 与对话跟着账号同步——网页桌面、Paimon、Paimon Terminal 里是同一批 agent（工作目录记在各台设备上）。
- 当浏览器用（`public/browser.js`）：标签页栏一直在；工具栏中间是地址栏（⌘L），agent 就是网址——
  - `claude.code`：Claude Code 的主页（这台 Mac 上的会话：在跑的、最近的；新会话）；`claude.code/<Claude 账号 id 前 8 位>/<会话 id 前 8 位>`：一个会话（后台会话 `claude attach`，别的回到开它的目录 `claude --resume`）；
  - `paimon.code`：Paimon 的主页；`paimon.code/<账号>/<agent id>`：一个 agent；
  - 目录（`~/…`）：闲着的 shell 里 cd，不然新标签页从那里开；网址交给默认浏览器。
  - 右上角新标签页、标签页概览（⇧⌘\）；菜单栏「历史记录」（访问过的 agent 网址，本机）、⌘Y 历史记录页。菜单由页面定（`menu.set`，见 `Sources/Menus.swift`），改菜单只要更新网页。
- 三层（互相解耦）：**Agent**（模型怎么跑：Paimon 的运行时、Claude Code）· **Studio**（Vibe Code Studio，用户怎么看、怎么控制：`public/studio.js`）· **Browser**（Terminal-Coding-Browser，装它们的：标签页、地址、历史、协议，`public/browser.js`）。
- Studio 的「元素」：页面交出有类型的数据（任务清单、状态、上下文、键值、表单），Studio 决定画在哪——行内（页面自己画，传统 TUI 的位置）、底栏、右侧栏（⌥⌘I）、隐藏；在元素上右键或右侧栏的「视图」里改，记在本机。
  - paimon.code：右侧栏的「视图」里一样一样调每种块（思考、工具调用、改动的文件、网页、! 命令的输出：展开 / 一行 / 隐藏；任务清单、状态放哪；回顾、完成行、通知、图片开关）。
  - claude.code：正文是 Claude Code 自己画的；Studio 读它写在磁盘上的（`~/.claude/tasks/<会话>/*.json`、`~/.claude/sessions`、会话记录），替它画状态、任务、上下文。
  - 任何终端程序：`OSC 7700`（`ESC ] 7700 ; base64(JSON) BEL`，JSON 见 `public/studio.js` 开头）；shell 里有 `TCB=1`；命令行里用 `tcb`（`tcb tasks '写接口:done' '跑测试:doing' '发版'`、`tcb status '正在跑测试'`、`tcb kv 构建 耗时=12s`、`tcb clear`）。交元素的程序退出时，它交的元素一起收掉。
- 文件：⌘ 点终端里的路径、点 agent 工具调用里的路径、地址栏里敲文件路径 → 在右侧栏打开，默认只看（Markdown 排好、代码高亮、图片、PDF；文件在别处改了会跟着刷新），右上角「编辑」才改，⌘S 存（高亮同编辑器，`public/hl.js`）。
- 设置是个窗口（`/config`、⌘,、App 菜单「设置…」）：终端、Paimon、视图、Claude Code、快捷键。Claude Code 那一区直接改 `~/.claude/settings.json`（它会自己重新读；第一次改之前留一份 `settings.json.paimon-bak`）；在跑 Claude Code 的标签页里敲 `/config` 也是打开这个窗口，窗口里有按钮回到它自带的面板。
- 侧栏的 Claude Code（`Sources/ClaudeCode.swift`）：`~/.claude/projects` 里的会话（标题、最后一句、开它的目录——以项目目录名为准）+ `~/.claude/sessions` 里 Claude Code 登记的在跑的（交互 / 后台、忙 / 闲）+ `~/.claude/jobs`（后台会话）；同 agent 的 `[W]/[NW] [F]/[B]/[O]`。
- 刷新页面、更新网页版不断 shell：伪终端在原生那边一直跑，页面记着每个标签页的伪终端 id，刷新后 `pty.attach` 接回来（留着的最后 2 MB 输出写回去，括号粘贴等终端模式补上）；页面恢复完 15 秒后 `pty.gc` 关掉没人要的。
- 同「终端」/ iTerm：⌘T、⌘W、⌘1…⌘9、⌘+ ⌘- ⌘0；关标签页、⌘Q 时有程序在跑先问；从访达拖文件进来贴转义好的路径（`Sources/WebView.swift`）；⌘ 点网址用默认浏览器开；响铃时标签页挂 🔔、App 在后台 Dock 图标跳。
- 桥多了 `pty.*`（伪终端，含 `pty.attach` / `pty.list` / `pty.gc`）、`exec.*`（命令，边跑边推输出，结束报最后在哪个目录）、`fs.*`（读、写、stat、glob）、`cc.sessions`、`local.info`；只有 Paimon Terminal 有，网页那头是 `public/local.js`。两个 App 都有的：`menu.set`、`window.title`、事件 `menu.action`、`drop.paths`。
- 自动测试：`NADOS_TESTJS=<js 文件>` 启动，页面起来后把文件当 async 函数体跑，返回值写到同名 `.json`，旁边一张截图，然后退出（`NADOS_SELFTEST_STAY=1` 不退）。本地测试账号：`--url "http://localhost:8787/auth/login?dev=2&next=/terminal.html"`。

## 编译、运行

```sh
apps/macos/build.sh                  # 发布版，装在 ~/Applications/Paimon.app（启动台、聚焦搜索里能找到）
CONFIG=debug apps/macos/build.sh     # 调试版：Safari › 开发 菜单里能连上页面（网页检查器）
open ~/Applications/Paimon.app
```

- 要 macOS 14 以上、Xcode（命令行工具里的 swiftc 就够）。不用开 Xcode 工程。
- 打开的网址：默认 `https://code.paimon.beer/`。本地开发：`open ~/Applications/Paimon.app --args --url http://localhost:8787`，或 `defaults write beer.paimon.desktop url http://localhost:8787`（`defaults delete beer.paimon.desktop url` 改回线上）。
- 签名：默认用钥匙串里第一个 Apple Development / Developer ID Application 证书（`SIGN_ID=` 可指定），没有就 ad-hoc。用证书签，系统设置里给过的权限（屏幕录制、辅助功能）重新编译后还在；ad-hoc 每编一次系统都当成新 App，要重新打开开关。
- App 不放在仓库里的 `build/`：仓库在 iCloud 同步的「文稿」里时，那里的文件会被系统加上 FinderInfo 等扩展属性，codesign 不肯签。`APP_DIR=<目录>` 可以换地方（别选 iCloud 同步的文件夹）。图标等中间产物在 `apps/macos/build/`。
- 图标就是「系统设置 › Paimon」里那个（`#d77757` 圆角方块里一个白色的 ✻，desk.css 的 `.st-pm`），由 `Icon/make-icon.swift` 画。

## 窗口与按键

- 没有标题栏：网页桌面自己画了菜单栏。菜单栏左边让出红黄绿三个按钮的位置；菜单栏中间空着的那段能按住拖窗口、双击同标题栏（按「系统设置 › 桌面与程序坞」里选的缩放 / 最小化）。
- ⌘Q 退出、⌘H 隐藏归 App；别的 ⌘ 组合（⌘W、⌘T、⌘N、⌘M、⌘,、⌘`……）先给网页桌面，没用掉的才到原生菜单（编辑菜单的拷贝、粘贴、撤销）。
- 网页桌面的「全屏」（⌃⌘F、控制中心）= 整个 App 窗口进 / 出 macOS 的全屏。
- 点红色按钮只是把窗口收起来，页面不关（agent 在后台接着干）；点 Dock 图标再出来。⌘Q 才真的退出。
- 窗口藏起来、被挡住时页面照常跑（`inactiveSchedulingPolicy = .none`，不被节流）。
- 登录状态、localStorage、IndexedDB 都在 App 自己的持久存储里（和 Safari 分开），关了再开还是登录着。
- 站内页面留在 App 里；登录（`/auth/login`）交给系统浏览器做完再回来（`Sources/BrowserAuth.swift`，同 PKCE：App 只把 verifier 的 sha256 交给网站，回调 `paimon://auth?code=…` 后带着 code + verifier 换会话）；别的链接、`target=_blank`、`window.open` 用默认浏览器打开。页面里的 iframe 不管。
- 下载存到「下载」（重名加 (1)、(2)），完成后 Dock 里的下载堆栈跳一下。`<input type=file>` 用系统的打开面板。
- 连不上服务器（断网、服务在重启）：显示一行字，3、6、12、24 秒……后自动重试；15 秒没有回应也重来一次。

## 权限：哪些要人手动点

| 权限 | 怎么拿到 | 用在哪 |
|---|---|---|
| 通知 | 第一次打开 App 时系统问一次；拒绝过就到「系统设置 › 通知 › Paimon」打开 | App 在后台时，桌面的通知也发到 macOS 的通知中心；`native notify` |
| 屏幕录制 | `native request screen`：第一次弹系统对话框，之后打开「系统设置 › 隐私与安全性 › 录屏与系统录音」，**手动打开 Paimon 的开关，再重开 Paimon** | `native screenshot`（真的整块屏幕） |
| 辅助功能 | `native request accessibility`：系统对话框里点「打开系统设置」，**手动打开 Paimon 的开关** | 以后操作别的 App（这一版还没用上） |
| 摄像头、麦克风 | 网页第一次要用时系统问 | 网页桌面里的 App |

## 桥协议（平台无关，iOS 照同一份实现）

页面最开始（document-start、只在主框架）注入 `window.nadosNative`，只给这两个源：`https://code.paimon.beer`、`http://localhost:8787`；原生收到消息时按 `frameInfo.securityOrigin` 和「是不是主框架」再查一次。对象是冻结的、不能被页面替换。

```js
nadosNative.platform   // "macos"（iOS 上是 "ios"）
nadosNative.version    // App 版本
nadosNative.protocol   // 1
nadosNative.call(cmd, args) → Promise<value>   // 失败：抛 Error，error.code 见下
nadosNative.on(type, fn) → 取消订阅的函数      // 也会在 window 上发 "nados-native" CustomEvent（detail: { type, detail }）
```

原生那边的回复一律是信封：`{ ok: true, value }` 或 `{ ok: false, error: { code, message } }`（`call` 已经拆好）。

错误码：`E_ARGS`（参数不对）、`E_PERMISSION`（系统权限没给，message 里写怎么给）、`E_UNKNOWN_CMD`、`E_ORIGIN`（这个源不能用桥）、`E_FAILED`（别的失败）、`E_UNSUPPORTED`（这个平台没有）。

| 命令 | 参数 | 返回 |
|---|---|---|
| `info` | — | `{ platform, app, version, build, protocol, os, arch, commands[], active, fullscreen, inset }` |
| `permissions` | — | `{ notifications, screen, accessibility, camera, microphone }`，每项 `granted` \| `denied` \| `not-determined` \| `restricted` \| `not-granted`（系统不告诉是没问过还是拒绝了） |
| `request` | `{ kind }` | `{ kind, status, openedSettings, note? }`：第一次弹系统的对话框；系统不会再问了就打开系统设置里那一页 |
| `settings` | `{ kind }` | `{ opened }`：打开系统设置里那一页 |
| `notify` | `{ title?, body?, subtitle?, id?, data?, sound? }` | `{ id }`；点了通知 → 事件 `notification-click { id, data? }`，App 到前台 |
| `clipboard.read` | — | `{ text }` |
| `clipboard.write` | `{ text }` | `{ chars }` |
| `openExternal` | `{ url }`（http、https、mailto） | `{ opened }` |
| `screenshot` | `{ display?（0 起，0 = 主屏）, maxWidth?, format?: "png" \| "jpeg", quality?, excludeSelf? }` | `{ dataURL, width, height, points: { width, height }, display, displays }` |
| `badge` | `{ text }`（空 = 去掉） | `{ badge }` |
| `attention` | `{ critical? }` | `{ request }`：Dock 图标跳一下 |
| `window.dragRegions` | `{ rects: [{ x, y, w, h }] }`（CSS 像素） | `{ count }`：这些地方按下拖窗口（macOS 专有） |
| `window.fullscreen` | `{ on? }`（不给 = 切换） | `{ on }`（macOS 专有） |

事件：`active { active }`（App 到前台 / 退到后台）、`fullscreen { on, inset }`、`notification-click { id, data? }`。

## 网页这边：public/native.js

只在有 `window.nadosNative` 时生效：

- 系统命令 `native`（人和 agent 都在 shell 里用，`help native` 看全）：`native`、`native info|permissions [--json]`、`native request|settings <kind>`、`native screenshot [-o 文件] [--display n] [--max-width px] [--exclude-self]`、`native notify <标题> [<正文>|-]`、`native clipboard [<文字>|-]`、`native badge [<文字>]`、`native open <网址>`。agent 用 info、permissions 不要档位，别的（真屏幕、真剪贴板、通知、弹权限框）都要 rw 档——它们伸到了这台桌面以外。截屏时 agent 的模型能看图就把图附上。
- `pbcopy` / `pbpaste` 走真的系统剪贴板（agent 的 `pbpaste` 照旧只读桌面自己那份）；页面里 `navigator.clipboard.readText()` 也走桥，不再弹 WebKit 的「粘贴」按钮。
- App 不在前台时，桌面的通知同时发一条系统通知（桌面开着勿扰时不发）；点它回到这条通知对应的 App。
- `<html>` 上加 `native-app`（全屏时再加 `native-full`），菜单栏左边让位、拖动区、全屏都在这里接。

## 自测

```sh
open -g -n -W --env NADOS_SELFTEST=1 --env NADOS_SELFTEST_OUT=/tmp/native-selftest.json ~/Applications/Paimon.app --args --url http://localhost:8787/auth/login
```

桌面起来后等几秒（`NADOS_SELFTEST_WAIT`，默认 8），在页面里调一遍桥（info、permissions、剪贴板往返、角标、截屏、各种错误参数、拖动区）和 `native` / `pbcopy` / `pbpaste` 命令（包括 read 档的 agent 被拒），再在原生这边测来源检查、哪些网址留在 App 里；结果写进 JSON，页面截图写在旁边（.png），然后退出（`NADOS_SELFTEST_STAY=1` 不退）。会动剪贴板：测之前把剪贴板里的东西（所有类型）存下来，测完原样放回去。不抢前台、不发系统通知、不弹权限框。

## 还没有的

- GitHub 的通行密钥（passkey）登录在 App 里用不了（WKWebView 要浏览器专用的权限才能用平台通行密钥）；用密码 + 双重验证（验证器 App、GitHub Mobile）可以。以后可以改成用 `ASWebAuthenticationSession`（系统的登录面板，和 Safari 共用登录状态与通行密钥）。
- `window.open()` 先开一个空白窗口再写地址的写法（有些 OAuth 弹窗）不支持：新窗口一律交给默认浏览器。
- 只有一个窗口；没有自动更新、没有公证（给别人用要 Developer ID 签名 + 公证）。只编本机的架构（`uname -m`）。
- 辅助功能拿到了，但还没有用它的命令（操作别的 App）；屏幕录制拿到了能截整屏，还没有截单个窗口。
