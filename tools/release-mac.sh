#!/bin/zsh
# 发一版 macOS App：Apple 芯片、Intel 各编一份（各自原生）→ 打成 zip 放进 ui/downloads/（网站上，登录了才能下）+ macos.json（最新的是哪一版）。
#   部署（tools/deploy.sh）之后，别的 Mac 上开着的 App 自己会下载新版、放进「待更新」，状态栏出「App 有新版本 · 重启以更新」（studio.js 的 checkRemoteApp）。
#   tools/release-mac.sh            构建号 = tools/app-build.txt + 1
#   GH=1 tools/release-mac.sh       顺便在 GitHub 上发一个 Release（同样两个 zip）
# 产物在 ~/Library/Caches/VibingStudio/release.noindex/<构建号>/（不进 iCloud）；ui/downloads/ 不进仓库、不进 App 里带的界面
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
B=${BUILD:-$(( $(cat "$HERE/tools/app-build.txt" 2>/dev/null || echo 289) + 1 ))}
V="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$HERE/ui/version.json")" # 同界面的版本号（tools/deploy.sh 每次 +1）；构建号 $B 另记
OUT="$HOME/Library/Caches/VibingStudio/release.noindex/$B" # .noindex：聚焦不收录，编出来的 .app 不进系统的 App 列表（「打开方式」里不会多一份）
DL="$HERE/ui/downloads"
mkdir -p "$OUT" "$DL"
cd "$HERE/app"
for A in arm64 x86_64; do
  mkdir -p "$OUT/$A"
  APP_DIR="$OUT/$A" BUILD=$B TARGET_ARCH=$A MODE=terminal RELEASE=1 ./build.sh | tail -1
done
# 发出去之前再查一遍签名：证书被吊销的（macOS 会当恶意软件扔掉）、签名不完整的一律不发
for A in arm64 x86_64; do
  codesign --verify --strict "$OUT/$A/Vibing Studio.app" || { echo "签名不完整：$OUT/$A，不发" >&2; exit 1; }
  if /usr/sbin/spctl -a -t exec -vv "$OUT/$A/Vibing Studio.app" 2>&1 | grep -q REVOKED; then echo "签名证书已被吊销：$OUT/$A，不发" >&2; exit 1; fi
done
AS="Vibing-Studio-$V-macOS-AppleSilicon.zip"; IN="Vibing-Studio-$V-macOS-Intel.zip"
ditto -c -k --sequesterRsrc --keepParent "$OUT/arm64/Vibing Studio.app" "$OUT/$AS"
ditto -c -k --sequesterRsrc --keepParent "$OUT/x86_64/Vibing Studio.app" "$OUT/$IN"
cp "$OUT/$AS" "$OUT/$IN" "$DL/"
# 这一版比上一版改了什么（别的 Mac 上照这个决定怎么换）：native——App 本身的代码（Sources、bridge.js、build.sh……）变了，要重启才生效，状态栏出「重启以更新」；
#   files——只有带的小工具（bin/、vs-rdp.c）、图标变了；ui——只有带的界面变了。后两种不打扰：退出 App 时换上（App 301 起，见 AppUpdate.swift）。
#   history：最近几版各是哪一种（跳着更新的 Mac 看中间每一版）
A="$HERE/app"
NH=$(cat "$A"/Sources/*.swift "$A"/Sources/*.h "$A"/Resources/bridge.js "$A"/Paimon.entitlements "$A"/build.sh 2>/dev/null | shasum -a 256 | cut -c1-16)
FH=$(cat "$A"/Helpers/* "$A"/Resources/bin/* "$A"/Icon/*.swift 2>/dev/null | shasum -a 256 | cut -c1-16)
python3 - "$DL/macos.json" "$B" "$V" "$AS" "$IN" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$NH" "$FH" <<'PY'
import json, sys
path, b, v, a, i, at, nh, fh = sys.argv[1:9]
try: old = json.load(open(path))
except Exception: old = {}
kind = "native" if old.get("nh") != nh else "files" if old.get("fh") != fh else "ui"
hist = [h for h in old.get("history", []) if isinstance(h, dict) and h.get("build") != int(b)]
if old.get("build") and not any(h.get("build") == old["build"] for h in hist): hist.append({"build": old["build"], "kind": old.get("kind", "native")})
hist = (hist + [{"build": int(b), "kind": kind}])[-30:]
json.dump({"build": int(b), "version": v, "arm64": "downloads/" + a, "x86_64": "downloads/" + i, "at": at, "kind": kind, "nh": nh, "fh": fh, "history": hist}, open(path, "w"))
print("kind:", kind)
PY
echo "$B" > "$HERE/tools/app-build.txt"
bash "$HERE/tools/prune-releases.sh" # 旧的安装包、编出来的旧版不越堆越多
echo "released $V → $DL（tools/deploy.sh 之后别的 Mac 会自己更新）"
if [ "${GH:-}" = 1 ]; then
  cd "$HERE"
  gh release create "v$V" --title "Vibing Studio $V" --notes "macOS：Apple 芯片下载 $AS，Intel 下载 $IN（各自原生）。装过的 App 会自己更新（⚙ 菜单里「重启以更新 App」）。构建号 $B。" "$OUT/$AS" "$OUT/$IN"
fi
