#!/bin/zsh
# 发一版（macOS + Linux）：一个版本号——同界面的（ui/version.json，tools/deploy.sh 每次 +1），构建号另记（tools/app-build.txt + 1）
#   1. macOS：Apple 芯片、Intel 各编一份（tools/release-mac.sh）→ ui/downloads/ + macos.json（网站上，登录了才能下；装好的 App 自己下载更新）
#   2. Linux：x86_64、ARM64 的 AppImage、deb（linux/build.sh dist）
#   3. 网站上线 macos.json（只上线，不再改版本号）
#   4. GitHub Release v<版本号>：六个文件一个一个传（大文件一起传容易卡住），传不上的重试
# 产物在 ~/Library/Caches/VibingStudio/（不进 iCloud）。先跑 tools/deploy.sh，再跑这个
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
V="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$HERE/ui/version.json")"
B=$(( $(cat "$HERE/tools/app-build.txt") + 1 ))
OUT="$HOME/Library/Caches/VibingStudio/release/$B"
echo "release $V (build $B)"
BUILD=$B zsh "$HERE/tools/release-mac.sh"
export VS_LINUX_WORK="$HOME/Library/Caches/VibingStudio/linux-dist"
for A in x64 arm64; do bash "$HERE/linux/build.sh" dist $A > "$VS_LINUX_WORK/build-$A.log" 2>&1 || { tail -20 "$VS_LINUX_WORK/build-$A.log"; exit 1; }; done
D="$VS_LINUX_WORK/dist"
cp "$D/Vibing-Studio-$V-x86_64.AppImage" "$OUT/Vibing-Studio-$V-Linux-x86_64.AppImage"
cp "$D/Vibing-Studio-$V-arm64.AppImage" "$OUT/Vibing-Studio-$V-Linux-arm64.AppImage"
cp "$D/Vibing-Studio-$V-amd64.deb" "$OUT/Vibing-Studio-$V-Linux-amd64.deb"
cp "$D/Vibing-Studio-$V-arm64.deb" "$OUT/Vibing-Studio-$V-Linux-arm64.deb"
(cd "$HERE/web" && wrangler deploy 2>&1 | tail -1) # macos.json 上线（界面的版本号不动）
[ "${GH:-1}" = 1 ] || exit 0
cd "$HERE"
NOTES="$OUT/notes.md"
[ -f "$NOTES" ] || printf '**macOS**：Apple 芯片下载 `Vibing-Studio-%s-macOS-AppleSilicon.zip`，Intel 下载 `Vibing-Studio-%s-macOS-Intel.zip`。装好的 App 会自己更新（⚙ 菜单里「重启以更新 App」）。\n\n**Linux**（x86_64 / ARM64）：AppImage（`chmod +x` 后直接运行）或 deb（`sudo apt install ./Vibing-Studio-%s-Linux-amd64.deb`）。\n\n构建号 %s。\n' "$V" "$V" "$V" "$B" > "$NOTES"
gh release create "v$V" --title "Vibing Studio $V" --notes-file "$NOTES"
for F in macOS-AppleSilicon.zip macOS-Intel.zip Linux-x86_64.AppImage Linux-arm64.AppImage Linux-amd64.deb Linux-arm64.deb; do
  for T in 1 2 3; do
    if timeout_s=900 gh release upload "v$V" "$OUT/Vibing-Studio-$V-$F" --clobber; then echo "uploaded $F"; break; fi
    echo "retry $F ($T)"; sleep 5
  done
done
gh release view "v$V" --json assets --jq '.assets[].name'
