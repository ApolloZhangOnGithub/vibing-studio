# 端到端回归测试

用一个单独的测试 App（`beer.paimon.terminal.rdptest`，假的家目录，本机的网页服务）跑一遍主要功能，看改了以后有没有坏。

```bash
python3 tools/e2e/run.py                    # 全部
python3 tools/e2e/run.py rdp_static fav_ui  # 挑几个
python3 tools/e2e/run.py --build            # 先重编测试 App（改了 app/ 里的原生代码时）
```

结果、截图、日志在 `~/Library/Caches/VibingStudio/e2e/<时间>/`（不进 iCloud），`summary.json` 是每个用例过没过。

| 用例 | 测什么 |
|---|---|
| `rdp_static` | App 里带的远程桌面组件（静态链进 FreeRDP，不靠 Homebrew）连 FreeRDP 的示例服务器：连上、有画面 |
| `rdp_timeout` | 那头接了连接却不回握手：自己重试两次，最后写「此电脑没有响应」，不一直转圈 |
| `fav_ui` | 对话里右键一条消息「收藏」整条、再右键是「取消收藏」、标记；收藏页三栏、跳到原处 |
| `eco_embed` | 钩子、MCP、插件……在「设置 › 连接器 › Claude Code」那一页里，「App」里没有单独的「Agent 扩展」 |
| `mac2mac` | 两个测试 App：一个当被看的 Mac（画测试图），一个看它——H.265、画面、键盘鼠标、暂停 / 继续、关掉后停止截屏 |
| `idle` | 闲着时主线程忙不忙（没有长任务、计时器不拖） |

不碰用户自己的东西：测试 App 的 bundle id、家目录、钥匙串那一项（「Vibing Studio RDP Test」）都是单独的；跑完把测试 App 从系统的 App 列表里拿掉。
测试窗口会浮在屏幕上一会儿（不抢键盘）。`fixtures/` 是假的家目录（Teyvat 的会话记录、Claude Code 的钩子和插件……），没有真的账号、令牌。
