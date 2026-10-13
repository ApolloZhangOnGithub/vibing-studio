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
# 版本号一律四段：x.y.z.构建号（x.y.z 在 tools/version-base.txt，手动改；构建号每部署一次 +1）——界面、App、Linux 版、GitHub 发行版都用这一个
BASE=$(cat "$HERE/tools/version-base.txt" 2>/dev/null || echo 0.2.1)
V=$(printf '{"version":"%s.%s","build":%s,"built":"%s"}' "$BASE" "$B" "$B" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
print -r -- "$V" > "$HERE/ui/version.json"; echo "ui version: $BASE.$B"
# 每一版什么时候发的（更新内容按它分日期：changelog.js 里只写版本号的条目，日期从这里取）
python3 - "$HERE/ui/builds.json" "$BASE.$B" <<'PY'
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
mkdir -p "$U" && rsync -a --exclude downloads "$HERE/ui/" "$U/" && touch "$U/terminal.html" && defaults write beer.paimon.terminal uiDir "$U" && echo "local ui: $U" # downloads/（发出去的 App）不拷
cd "$WEB"
RC=0; OUT=$(wrangler deploy 2>&1) || RC=$?
if [ $RC -ne 0 ] || print -r -- "$OUT" | grep -q 'fetch failed'; then
  # 直连 Cloudflare 的 API 不通（这台 Mac 上的代理 / TUN 抢了路由时常这样，2026-10-13）：走系统设置里的 HTTPS 代理再试一次
  PX=$(scutil --proxy | awk '/HTTPSEnable : 1/ {e=1} /HTTPSProxy :/ {h=$3} /HTTPSPort :/ {p=$3} END {if (e && h && p) print "http://" h ":" p}')
  if [ -n "$PX" ]; then echo "wrangler: direct connection failed, retrying via $PX"; RC=0; OUT=$(HTTPS_PROXY="$PX" wrangler deploy 2>&1) || RC=$?; fi
fi
print -r -- "$OUT" | tail -2
if [ $RC -ne 0 ] || print -r -- "$OUT" | grep -q 'fetch failed'; then echo "wrangler deploy failed" >&2; exit 1; fi
