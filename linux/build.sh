#!/bin/bash
# linux/build.sh —— Vibing Studio 的 Linux 桌面版（Electron）：源码同步到缓存目录再装依赖、跑、打包（node_modules、产物不进 iCloud 里的项目目录）
#   linux/build.sh dev [App 的参数…]      在这台电脑上直接跑（macOS 上也能跑同一份代码：开发、调试用），如 linux/build.sh dev --url http://localhost:8787/terminal.html
#   linux/build.sh dist [x64|arm64]       打包 AppImage + deb（默认 x64）；产物在 $WORK/dist
#   linux/build.sh sync                   只同步源码和界面
# 缓存目录：$VS_LINUX_WORK，默认 ~/Library/Caches/VibingStudio/linux（Linux 上 ~/.cache/vibing-studio/linux）
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"
if [ "$(uname)" = Darwin ]; then DEF="$HOME/Library/Caches/VibingStudio/linux"; else DEF="${XDG_CACHE_HOME:-$HOME/.cache}/vibing-studio/linux"; fi
WORK="${VS_LINUX_WORK:-$DEF}"
APP="$WORK/app"
mkdir -p "$APP/ui"
# 源码、界面：只加、只覆盖（不删缓存里多出来的旧文件）
rsync -a --exclude node_modules --exclude dist --exclude build.sh "$HERE/" "$APP/"
rsync -a --exclude downloads "$ROOT/ui/" "$APP/ui/" # downloads/：发出去的 macOS App，不带进 Linux 版
# 版本号跟界面走（ui/version.json 的 0.2.x）
UIV=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/ui/version.json" 2>/dev/null || echo 0.2.0)
python3 - "$APP/package.json" "$UIV" <<'PY'
import json, sys
p, v = sys.argv[1], sys.argv[2]
j = json.load(open(p)); j["version"] = v
open(p, "w").write(json.dumps(j, indent=2, ensure_ascii=False) + "\n")
PY
cmd="${1:-dev}"; shift || true
cd "$APP"
case "$cmd" in
  sync) echo "synced → $APP" ;;
  dev)
    [ -d node_modules/electron ] || npm install --no-audit --no-fund
    exec npx electron . "$@"
    ;;
  dist)
    arch="${1:-x64}"
    # 依赖按目标平台装（终端用的 node-pty 是预编译好的那一份：@lydell/node-pty-linux-<架构>）
    npm install --no-audit --no-fund --os=linux --cpu="$arch"
    npx electron-builder --linux AppImage deb "--$arch" --config.directories.output="$WORK/dist"
    ls -la "$WORK/dist"
    ;;
  *) sed -n '2,6p' "$0"; exit 2 ;;
esac
