#!/bin/zsh
# 发布界面：语法检查 → 冒烟测试 → 版本号 +1 → 装成 App 的本地界面（App 里「重新载入以更新」）→ 网页端 code.paimon.beer（web/，wrangler；界面就是 ui/ 本身）
#   不再往 teyvat-mac-simulator（开源项目）里拷任何东西、不从它上线
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"; WEB="$HERE/web"
cd "$HERE"
setopt null_glob
for f in ui/*.js ui/studio/*.js ui/sim/*.js ui/sim/ios/*.js ui/sim/office/*.js; do case $f in ui/ttu-core.js|ui/sandbox*.js) continue;; esac; node --check "$f" || { echo "SYNTAX $f"; exit 1; }; done
for f in "$WEB"/src/*.js; do node --check "$f" || { echo "SYNTAX $f"; exit 1; }; done
# 冒烟测试：无界面的浏览器打开刚同步的界面（不开任何窗口、不连本地开发服务器），工作台起不来或页面报错就不部署；输出写在 ~/Library/Caches（不进 iCloud）
SMOKE="$HOME/Library/Caches/VibingStudio/smoke"; mkdir -p "$SMOKE"
python3 "$HERE/tools/smoke_headless.py" "$HERE/ui" > "$SMOKE/smoke.out" 2>&1 || { cat "$SMOKE/smoke.out"; exit 1; }
grep "^smoke:" "$SMOKE/smoke.out"
B=$(( $(cat "$HERE/tools/ui-build.txt" 2>/dev/null || echo 328) + 1 )); echo $B > "$HERE/tools/ui-build.txt"
V=$(printf '{"version":"0.2.%s","built":"%s"}' "$B" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
print -r -- "$V" > "$HERE/ui/version.json"; echo "ui version: 0.2.$B"
# 每一版什么时候发的（更新内容按它分日期：changelog.js 里只写版本号的条目，日期从这里取）
python3 - "$HERE/ui/builds.json" "0.2.$B" <<'PY'
import json, sys, time, os
p, v = sys.argv[1], sys.argv[2]
d = {}
if os.path.exists(p):
    try: d = json.load(open(p))
    except Exception: d = {}
d[v] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
json.dump(d, open(p, "w"), ensure_ascii=False, indent=0)
PY
U="$HOME/Library/Application Support/Vibing Studio/ui"
mkdir -p "$U" && ditto "$HERE/ui" "$U" && touch "$U/terminal.html" && defaults write beer.paimon.terminal uiDir "$U" && echo "local ui: $U"
cd "$WEB" && wrangler deploy 2>&1 | tail -2
