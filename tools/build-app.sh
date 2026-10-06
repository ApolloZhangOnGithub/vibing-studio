#!/bin/zsh
# 编 Vibing Studio.app（界面用旁边的 ui/）：默认装在 ~/Applications；APP_DIR=<目录> 放到别处，DEV=1 编测试用的那份（bundle id 带 .dev）
set -e
cd "$(dirname "$0")/../app"
MODE=terminal ./build.sh "$@"
