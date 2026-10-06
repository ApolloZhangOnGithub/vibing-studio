#!/bin/zsh
# 把 ui/ 装成 App 读的本地界面（~/Library/Application Support/Vibing Studio/ui）：App 里「重新载入以更新」/ ⌘R 就用上，不用重新编 App
set -e
cd "$(dirname "$0")/.."
for f in ui/*.js ui/studio/*.js; do node --check "$f" >/dev/null || { echo "语法错误：$f"; exit 1; }; done
U="$HOME/Library/Application Support/Vibing Studio/ui"
mkdir -p "$U" && ditto ui "$U" && touch "$U/terminal.html" && defaults write beer.paimon.terminal uiDir "$U" && echo "local ui: $U"
