#!/bin/bash
# 发版留下的东西不越堆越多：
#   ui/downloads/（在「文稿」里，跟着 iCloud 同步、每次部署都传到网站）：macOS 的安装包只留最新的 3 个版本，更早的挪到 ~/Library/Caches/VibingStudio/release-archive/（不删）；
#   ~/Library/Caches/VibingStudio/release.noindex/：编出来的 .app 只留最新的 3 个构建，更早的挪进废纸篓。tools/release-mac.sh 发完版自己跑
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DL="$HERE/ui/downloads"; ARC="$HOME/Library/Caches/VibingStudio/release-archive"; REL="$HOME/Library/Caches/VibingStudio/release.noindex"; T="$HOME/.Trash"
KEEP=${KEEP:-3}
mkdir -p "$ARC"
# 按发的先后（文件的修改时间，新的在前；版本号有两种写法，0.2.426 比 0.2.1.462 旧，不能按版本号排），第 KEEP 个版本以后的两个包（Apple 芯片、Intel）都挪走
ls -1t "$DL" 2>/dev/null | sed -nE 's/^Vibing-Studio-([0-9.]+)-macOS-.*\.zip$/\1/p' | awk '!seen[$0]++' | tail -n +$((KEEP + 1)) | while IFS= read -r v; do
  for f in "$DL/Vibing-Studio-$v-macOS-"*.zip; do [ -e "$f" ] && mv "$f" "$ARC/" && echo "archived $(basename "$f")"; done
done
# 编出来的 .app：构建号从大到小，留 KEEP 个
ls -1 "$REL" 2>/dev/null | grep -E '^[0-9]+$' | sort -n -r | tail -n +$((KEEP + 1)) | while IFS= read -r b; do
  d="$T/vibing-release-$b-$(date +%H%M%S)"; mv "$REL/$b" "$d" && echo "trashed release.noindex/$b"
done
exit 0
