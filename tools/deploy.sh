#!/bin/zsh
# 发布界面：语法检查 → 冒烟测试 → 版本号 +1 → 装成 App 的本地界面（App 里「重新载入以更新」）→ 网页端 code.paimon.beer（web/，wrangler；界面就是 ui/ 本身）
#   不再往 teyvat-mac-simulator（开源项目）里拷任何东西、不从它上线
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"; WEB="$HERE/web"
cd "$HERE"
case "${1:-}" in
  "") MODE=alpha ;;
  --release) MODE=release ;;
  --site-only) MODE=site ;;
  *) echo "usage: $0 [--release | --site-only]" >&2; exit 2 ;;
esac
SITE_ONLY=0; [ "$MODE" = site ] && SITE_ONLY=1 # 只把已经装好的这一版传到网站（上一次传失败了的时候），版本号不再 +1
setopt null_glob
# iCloud 同步冲突留下的副本（「live 2.js」「Info 2.plist」这种）：不发出去，先挪开（2026-10-15 查出一个 600 KB 的旧 live.js 跟着部署了十天）
DUP=$(find ui app/Sources linux -path '*/node_modules' -prune -o -path ui/downloads -prune -o -name '* [2-9].*' -print 2>/dev/null)
if [ -n "$DUP" ]; then echo "iCloud duplicates (move them to the Trash first):"; print -r -- "$DUP"; exit 1; fi
for f in ui/*.js ui/studio/*.js ui/sim/*.js ui/sim/ios/*.js ui/sim/office/*.js; do case $f in ui/ttu-core.js|ui/sandbox*.js) continue;; esac; node --check "$f" || { echo "SYNTAX $f"; exit 1; }; done
for f in "$WEB"/src/*.js; do node --check "$f" || { echo "SYNTAX $f"; exit 1; }; done
# 冒烟测试：无界面的浏览器打开刚同步的界面（不开任何窗口、不连本地开发服务器），工作台起不来或页面报错就不部署；输出写在 ~/Library/Caches（不进 iCloud）
SMOKE="$HOME/Library/Caches/VibingStudio/smoke"; mkdir -p "$SMOKE"
python3 "$HERE/tools/smoke_headless.py" "$HERE/ui" > "$SMOKE/smoke.out" 2>&1 || { cat "$SMOKE/smoke.out"; exit 1; }
grep "^smoke:" "$SMOKE/smoke.out"
python3 "$HERE/tools/check-sync.py" # 原生和页面里换版本的那几步一样
if [ $SITE_ONLY = 0 ]; then
# 日常部署递增第四段；--release 递增第三段，发布三段正式版。
python3 - "$MODE" <<'PYVERSION'
import fcntl
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

version_file = Path("ui/version.json")
history_file = Path("ui/builds.json")
base_file = Path("tools/version-base.txt")
with Path("tools/ui-build.txt").open("r+") as counter:
    fcntl.flock(counter, fcntl.LOCK_EX)
    base = base_file.read_text().strip()
    major, minor, patch = map(int, base.split("."))
    current = json.loads(version_file.read_text())
    history = json.loads(history_file.read_text())
    now = datetime.now(timezone.utc)
    last_day = datetime.fromisoformat(current["built"].replace("Z", "+00:00")).astimezone().date()
    if sys.argv[1] == "release" or last_day < now.astimezone().date():
        base = f"{major}.{minor}.{patch + 1}"
        base_file.write_text(base + "\n")
    if sys.argv[1] == "release":
        version = base
    else:
        prefix = base + "."
        alpha = int(current["version"][len(prefix):]) if current["version"].startswith(prefix) else 0
        version = f"{base}.{alpha + 1}"
    build = max(int(counter.read()), current["build"]) + 1
    manifest = dict(version=version, build=build, built=now.strftime("%Y-%m-%dT%H:%M:%SZ"))
    history[version] = now.astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")
    history_file.write_text(json.dumps(history, ensure_ascii=False, indent=0))
    version_file.write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
    counter.seek(0)
    counter.write(str(build) + "\n")
    counter.truncate()
    print("ui version:", version)
PYVERSION
U="$HOME/Library/Application Support/Vibing Studio/ui"
mkdir -p "$U" && rsync -a --exclude downloads "$HERE/ui/" "$U/" && touch "$U/terminal.html" && defaults write beer.paimon.terminal uiDir "$U" && echo "local ui: $U" # downloads/（发出去的 App）不拷
fi
cd "$WEB"
# 上线：直连 Cloudflare 的 API，不通就走系统设置里的 HTTPS 代理（这台 Mac 上的代理 / TUN 抢了路由时常这样，2026-10-13）；
#   网络抖一下（2026-10-14 两条都 fetch failed，过一会儿再上就好了）：两条轮着各再试一次。界面已经装进本机了，这一步失败只是网站没跟上，再跑 tools/deploy.sh --site-only
PX=$(scutil --proxy | awk '/HTTPSEnable : 1/ {e=1} /HTTPSProxy :/ {h=$3} /HTTPSPort :/ {p=$3} END {if (e && h && p) print "http://" h ":" p}')
RC=1; OUT=""
for try in direct proxy direct proxy; do
  [ $try = proxy ] && [ -z "$PX" ] && continue
  RC=0
  if [ $try = proxy ]; then OUT=$(HTTPS_PROXY="$PX" wrangler deploy 2>&1) || RC=$?; else OUT=$(wrangler deploy 2>&1) || RC=$?; fi
  if [ $RC -eq 0 ] && ! print -r -- "$OUT" | grep -q 'fetch failed'; then break; fi
  RC=1; echo "wrangler: $try failed, retrying"
done
print -r -- "$OUT" | tail -2
if [ $RC -ne 0 ]; then echo "wrangler deploy failed (the local UI is installed; run tools/deploy.sh --site-only to publish the website)" >&2; exit 1; fi
