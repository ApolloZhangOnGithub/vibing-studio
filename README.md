# Vibing Studio

一个 macOS App：把 Claude Code、Codex 的会话（包括 `claude --bg` 的后台会话）放进同一个窗口里看、接着说、管理。外观可以是
**Visual Studio Code + Claude Code 的终端界面（TUI）**，也可以是 **Claude Desktop** 的样子；自带访达式的文件 / Agent 浏览器、
活动监视器、内置浏览器，还有一个内置的助手 Paimon（帮你看着正在干活的 Agent）。

## 目录

| 目录 | 是什么 |
|---|---|
| `app/` | 原生外壳（Swift，AppKit + WKWebView）：窗口、菜单、系统通知、这台 Mac 上的终端 / 命令 / 文件、内嵌浏览器、本地界面服务（`LocalUI.swift`）。`build.sh` 不用开 Xcode 就能编 |
| `ui/` | 界面（`terminal.html` 和它载入的全部文件）：`live.js`（终端界面、会话的 TUI 画法、Agents 树）、`agents.js`（Agent 数据、设置）、`studio/`（VS Code 式的工作台：设置、访达、活动监视器、Claude Desktop 风格……）、`vendor/`（xterm、CodeMirror） |
| `ios/` | iPhone / iPad 版（同一个原生 App，SwiftUI + WKWebView，经中转用你的 Mac）：`build.sh` 装到连着的 iPhone、iPad；`project.yml` 由 xcodegen 生成工程 |
| `tools/` | 编 App、装界面、自动测试、从老地方同步 |

`ui/studio/` 里几个主要的文件：

- `studio.js`：工作台本身——活动栏、标签页、面板、菜单、设置页、配色、命令面板
- `claude.js` / `codex.js`：连接 Claude Code、Codex——读会话记录（`~/.claude/projects`、`~/.codex/sessions`），经 Claude Code 的后台服务（daemon）把话送进后台会话、看它的屏幕（转圈那一行、正在写的话）
- `claudeapp.js` / `gui.js`：Claude Desktop 风格的外观、图形界面（GUI）的对话
- `dash.js`：访达（File Finder / Agent Finder）
- `trace.js`：Agent 活动（活动监视器式的表格、时间线；按进程树量每个会话的 CPU、内存）
- `globalagent.js`：内置助手 Paimon 的工具
- `i18n.js`：中英文

## 常用命令

```sh
# 编 App（装到 ~/Applications；APP_DIR=<目录> 放到别处；DEV=1 编测试用的那份，bundle id 带 .dev）
tools/build-app.sh

# 只改了界面：装成 App 读的本地界面，App 里「重新载入以更新」就用上（不用重新编 App）
tools/install-ui.sh

# 测试、发布前先起本地服务（各开一个终端，一直开着）：
#   (cd ../teyvat-mac-simulator && node dev/run.mjs --port 8787 --ip 127.0.0.1)   开发服务器：测试用的 App 从这里载入界面
#   (cd ../teyvat-mac-simulator/sandbox && npm run mac)                           沙盒服务（8790）：网页版的沙盒，部分测试用到
# 自动测试：先编一份测试用的 App，再跑测试脚本
DEV=1 APP_DIR="$HOME/Library/Developer/Vibing Studio Test" tools/build-app.sh
tools/run-test.sh tools/smoke.js
```

## 开发流程

日常开发就在这里改（`ui/`、`app/`）。发布界面用 `tools/deploy.sh`：

1. 语法检查；
2. 和 `../teyvat-mac-simulator/public` 两边同步——谁改得晚用谁（`rsync -u`，不删文件）：网站 code.paimon.beer 用的也是这份界面，那边有人改了也不会被盖掉；
3. 冒烟测试（测试用的 App 从本地开发服务器载入：`../teyvat-mac-simulator` 里 `node dev/run.mjs --port 8787`）；
4. 版本号 +1（`tools/ui-build.txt`），装成 App 的本地界面（App 里「重新载入以更新」），部署网站。

改了 `app/` 的 Swift：`tools/build-app.sh` 重新编（装之前先退出正在跑的 App）。老地方 `../teyvat-mac-simulator/apps/macos` 不再改；
`tools/sync-from-cloud.sh` 只在那边又有人改了时用来收过来。

## 结构

```
Vibing Studio.app（Swift）
 ├─ WKWebView：界面（ui/，本地读，LocalUI）
 │    └─ window.nadosNative.call(命令, 参数) ⇄ Bridge.swift（终端 PTY、执行命令、读写文件、窗口、菜单、通知……）
 ├─ Claude Code：~/.claude/projects/*.jsonl（记录）+ 后台服务的控制通道（reply / subscribe / attach）
 └─ Codex：~/.codex/sessions + codex app-server
```

## 开源前要知道的

- 许可证：MIT（`LICENSE`）。`ui/vendor/` 里的第三方库（xterm.js、CodeMirror）各有自己的许可证，照原样保留。
- 服务端：登录、设置同步、内置助手 Paimon、翻译走 code.paimon.beer。自己部署时换地址：
  `defaults write beer.paimon.terminal serviceURL https://你的域名`（或者编的时候在 `app/Info.plist` 里加 `VibingServiceURL`）。
  服务端的代码在 `../teyvat-mac-simulator/src`（Cloudflare Worker）。
- 不需要服务端也能用的：Claude Code、Codex 的会话（读本机的记录、经它们自己的后台服务送话），文件、终端、访达、Agent 活动。
- 还要自带 API 的（以后再做）：Paimon 和翻译现在用的是服务端代理的模型额度；开源版需要一处填自己的 API key。
- 仓库里扫过：没有密钥、令牌。`ui/sim/`（网页版 macOS 模拟器）和 `ui/desk.js` 的帮助菜单里还写着作者自己的 GitHub 仓库地址，那是模拟器的，不影响 Studio。
