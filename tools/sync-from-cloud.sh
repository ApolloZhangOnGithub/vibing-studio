#!/bin/zsh
# 过渡期：开发还在 teyvat-mac-simulator 里做时，把那边的界面和 App 源码抄过来（只加、只覆盖，不删这边多出来的文件）
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"; CLOUD="$(cd "$HERE/../teyvat-mac-simulator" && pwd)"
rsync -a --exclude '.DS_Store' "$CLOUD/public/" "$HERE/ui/"
rsync -a --exclude '.DS_Store' --exclude 'build/' --exclude 'build.sh' "$CLOUD/apps/macos/" "$HERE/app/"
echo "synced from $CLOUD"
