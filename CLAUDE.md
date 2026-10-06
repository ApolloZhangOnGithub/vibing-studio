# Vibing Studio：在这个项目里干活的硬规则

这些写在这里，是因为光靠「记住」没用：上下文一压缩就忘。每次开工前照着做。

## 不能拖垮这台 Mac

- **不开 iOS 模拟器。** `ios/build.sh sim` 默认拒绝；只有用户明确同意时才用 `ALLOW_SIM=1`，开了 10 分钟后自动关。测 iPhone / iPad：装到连着的真机，用 `ios/build.sh`（`iphone` / `ipad` 只装一种）。
- **项目在「文稿」里，会被 iCloud 同步。** 编译产物、测试截图、日志、临时文件都不要放进来：放 `~/Library/Caches/VibingStudio/` 或会话自己的临时目录。部署的冒烟测试结果已经写在 `~/Library/Caches/VibingStudio/smoke/`。
- **可能卡住的命令都带超时**（simctl、xcodebuild、devicectl、网络请求）；卡住了先停掉自己起的进程，不要干等。
- 一直开着的采样（Agent 活动底下那条）只在看得见时跑，看不见就停。

## 不碰用户的东西

- 不删文件：要挪走的用 `mv`（废纸篓或备份目录）。
- 不自己退出、重启 Vibing Studio。原生部分的新版只放进待更新：`BUILD=<比装着的大> tools/stage-app.sh`，用户点「重启以更新」时才换。
- 测试不写 `studio.json`、不往用户正在用的会话里送键、不 attach 用户的会话。
- 不打开、不点名用户具体的会话内容；修问题按通用的做法修。

## 界面

- 不用 emoji；不用符号字符（箭头、✻、◷ 之类）当图标，用画的 SVG；Claude 橙色的星号不能当图标。
- 文字用专业、简洁的说法；中英文都要有（`ui/studio/i18n.js`）。
- 和 Claude Code 2.1.281 的样子、行为保持一致（快捷键、提示文字、排队消息的逻辑）。

## 发布

- 界面：`tools/deploy.sh`（语法检查、冒烟测试、版本号 +1、装成 App 的本地界面、从 `web/` 上线网站）。改了用户看得到的东西，在 `ui/studio/changelog.js` 最前面加一条。
- 网页端在 `web/`（Worker、中转、登录页；界面就是 `ui/`）。**`teyvat-mac-simulator` 已经开源，Vibing Studio 的代码一行都不要放进去，也不要从那里部署。**
- 原生（macOS）：见上面「待更新」。iPhone / iPad：`ios/build.sh`。
