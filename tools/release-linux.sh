#!/bin/zsh
# 发一版 Linux App：x64、arm64 的 AppImage、deb（linux/build.sh dist）→ AppImage 切成 24 MB 一段放进 ui/downloads/linux.nosync/<版本>/（网站上一个文件最多 25 MB；
#   登录了才能下）+ ui/downloads/linux.json（最新的是哪一版、每段的地址、整个文件的 sha256）。tools/deploy.sh 之后，AppImage 装的 Linux App
#   自己下载、核对、换上（linux/main.js 的 updater）；deb 装的给发行版页面的地址（GitHub Release，自己装）。
#   ui/downloads/linux.nosync/ 里上一版的挪到 ~/Library/Caches/VibingStudio/release-linux/old/（不删）。产物在 ~/Library/Caches/VibingStudio/linux-dist/
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
V="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$HERE/ui/version.json")"
export VS_LINUX_WORK="$HOME/Library/Caches/VibingStudio/linux-dist"
mkdir -p "$VS_LINUX_WORK"
for A in ${=ARCHS:-x64 arm64}; do bash "$HERE/linux/build.sh" dist $A > "$VS_LINUX_WORK/build-$A.log" 2>&1 || { tail -30 "$VS_LINUX_WORK/build-$A.log"; exit 1; }; done
D="$VS_LINUX_WORK/dist"; DL="$HERE/ui/downloads"; L="$DL/linux.nosync"; OLD="$HOME/Library/Caches/VibingStudio/release-linux/old" # .nosync：项目在 iCloud 里，这一大块不同步
mkdir -p "$L" "$OLD"
for X in "$L"/*(N/); do [ "$(basename "$X")" = "$V" ] || mv "$X" "$OLD/$(basename "$X")-$(date +%Y%m%d-%H%M%S)"; done
mkdir -p "$L/$V"
python3 - "$D" "$L/$V" "$V" "$DL/linux.json" "${ARCHS:-x64 arm64}" <<'PY'
import hashlib, json, os, sys, time
d, out, v, manifest, archs = sys.argv[1:6]
files = {"x64": "Vibing-Studio-%s-x86_64.AppImage" % v, "arm64": "Vibing-Studio-%s-arm64.AppImage" % v}
m = {"version": v, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "deb": "https://github.com/ApolloZhangOnGithub/vibing-studio/releases/tag/v" + v}
CH = 24 * 1024 * 1024
for a in archs.split():
    src = os.path.join(d, files[a])
    if not os.path.exists(src): continue
    h, parts, i = hashlib.sha256(), [], 0
    with open(src, "rb") as f:
        while True:
            b = f.read(CH)
            if not b: break
            h.update(b)
            name = "%s.AppImage.%03d" % (a, i)
            with open(os.path.join(out, name), "wb") as o: o.write(b)
            parts.append("downloads/linux.nosync/%s/%s" % (v, name)); i += 1
    m[a] = {"parts": parts, "size": os.path.getsize(src), "sha256": h.hexdigest()}
json.dump(m, open(manifest, "w"))
print("linux.json:", {k: (len(x["parts"]) if isinstance(x, dict) else x) for k, x in m.items()})
PY
echo "released Linux $V → $L/$V（tools/deploy.sh 之后 AppImage 装的 App 会自己更新）"
