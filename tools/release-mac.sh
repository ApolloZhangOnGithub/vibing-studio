#!/bin/zsh
# 发一版 macOS App：Apple 芯片、Intel 各编一份（各自原生）→ 打成 zip 放进 ui/downloads/（网站上，登录了才能下）+ macos.json（最新的是哪一版）。
#   部署（tools/deploy.sh）之后，别的 Mac 上开着的 App 自己会下载新版、放进「待更新」，状态栏出「App 有新版本 · 重启以更新」（studio.js 的 checkRemoteApp）。
#   tools/release-mac.sh            构建号 = tools/app-build.txt + 1
#   GH=1 tools/release-mac.sh       顺便在 GitHub 上发一个 Release（同样两个 zip）
# 产物在 ~/Library/Caches/VibingStudio/release/<构建号>/（不进 iCloud）；ui/downloads/ 不进仓库、不进 App 里带的界面
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
B=${BUILD:-$(( $(cat "$HERE/tools/app-build.txt" 2>/dev/null || echo 289) + 1 ))}
V="0.2.1.$B"
OUT="$HOME/Library/Caches/VibingStudio/release/$B"
DL="$HERE/ui/downloads"
mkdir -p "$OUT" "$DL"
cd "$HERE/app"
for A in arm64 x86_64; do
  mkdir -p "$OUT/$A"
  APP_DIR="$OUT/$A" BUILD=$B TARGET_ARCH=$A MODE=terminal ./build.sh | tail -1
done
AS="Vibing-Studio-$V-macOS-AppleSilicon.zip"; IN="Vibing-Studio-$V-macOS-Intel.zip"
ditto -c -k --sequesterRsrc --keepParent "$OUT/arm64/Vibing Studio.app" "$OUT/$AS"
ditto -c -k --sequesterRsrc --keepParent "$OUT/x86_64/Vibing Studio.app" "$OUT/$IN"
cp "$OUT/$AS" "$OUT/$IN" "$DL/"
printf '{"build":%s,"version":"%s","arm64":"downloads/%s","x86_64":"downloads/%s","at":"%s"}\n' "$B" "$V" "$AS" "$IN" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DL/macos.json"
echo "$B" > "$HERE/tools/app-build.txt"
echo "released $V → $DL（tools/deploy.sh 之后别的 Mac 会自己更新）"
if [ "${GH:-}" = 1 ]; then
  cd "$HERE"
  gh release create "v$V" --title "Vibing Studio $V" --notes "macOS：Apple 芯片下载 $AS，Intel 下载 $IN（各自原生）。装过的 App 会自己更新（状态栏「App 有新版本 · 重启以更新」）。" "$OUT/$AS" "$OUT/$IN"
fi
