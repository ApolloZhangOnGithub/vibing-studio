#!/bin/zsh
# 编新版 App，放进「待更新」（~/Library/Application Support/Vibing Studio/update/）：正在用的 App 状态栏上会出「App 有新版本 · 重启以更新」，
#   你点了才原地换（旧版留在 …/previous/），不动「应用程序」里正在跑的那份、不退出它
set -e
cd "$(dirname "$0")/../app"
U="$HOME/Library/Application Support/Vibing Studio/update"
mkdir -p "$U"
MODE=terminal APP_DIR="$U" ./build.sh "$@"
