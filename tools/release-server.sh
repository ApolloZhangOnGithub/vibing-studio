#!/bin/zsh
# 发一版 Linux 服务器版（server/）：程序包 + Node 运行时 → ui/downloads/server/（tools/deploy.sh 之后网站上就有；安装命令 /s/<口令> 从这里取）
#   程序包 vs-server-<版本>.tar.gz：main.js、host.js（server/）+ local.js、cc.js（linux/native，同 Linux 桌面版的那一份）+ node-pty（x64、arm64 两种 Linux 的预编译）
#   Node 运行时：nodejs.org 官方的 linux-x64 / linux-arm64（按它的 SHASUMS256 校验）；网站上一个文件最多 25 MB，切成 20 MB 一段（server.js 接着流出去）
#   server.json：版本、构建号、各文件的 sha256——安装脚本里的版本号、校验值由网站按它填进去；装好的服务器每 6 小时看一眼它自己更新
#   NODE_V=v24.x.y 换 Node 版本（默认下面这个 LTS）
# 产物、下载的缓存在 ~/Library/Caches/VibingStudio/server-release.noindex/（不进 iCloud）；换下来的旧程序包挪到 release-archive（不删）
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
V="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$HERE/ui/version.json")"
B="${V##*.}"
NODE_V="${NODE_V:-v24.22.1}"
PTY_V="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["dependencies"]["@lydell/node-pty"])' "$HERE/linux/package.json")"
C="$HOME/Library/Caches/VibingStudio/server-release.noindex"
OUT="$C/$B"; PK="$OUT/pkg/vs-server-$V"; DL="$HERE/ui/downloads/server"; ARCH_DIR="$HOME/Library/Caches/VibingStudio/release-archive"
mkdir -p "$PK/node_modules" "$OUT/npm" "$C/node" "$DL" "$ARCH_DIR"

# ---- 程序包 ----
cp "$HERE/server/main.js" "$HERE/server/host.js" "$HERE/linux/native/local.js" "$HERE/linux/native/cc.js" "$PK/"
python3 - "$PK/package.json" "$V" "$B" <<'PY'
import json, sys
json.dump({"name": "vibing-studio-server", "version": "0.0.0", "vsVersion": sys.argv[2], "build": int(sys.argv[3]), "private": True, "main": "main.js"}, open(sys.argv[1], "w"), indent=1)
PY
for p in @lydell/node-pty @lydell/node-pty-linux-x64 @lydell/node-pty-linux-arm64; do
  f=$(cd "$OUT/npm" && npm pack "$p@$PTY_V" --silent 2>/dev/null | tail -1)
  [ -f "$OUT/npm/$f" ] || { echo "npm pack $p failed" >&2; exit 1; }
  mkdir -p "$PK/node_modules/$p"
  tar -xzf "$OUT/npm/$f" -C "$PK/node_modules/$p" --strip-components=1
done
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -czf "$OUT/vs-server-$V.tar.gz" -C "$OUT/pkg" "vs-server-$V" # 不带 macOS 的扩展属性（Linux 的 tar 解开时一行行报警告）
PKG_SHA=$(shasum -a 256 "$OUT/vs-server-$V.tar.gz" | awk '{print $1}'); PKG_SIZE=$(stat -f %z "$OUT/vs-server-$V.tar.gz")

# ---- Node 运行时（官方的，校验后切段）----
curl -fsSL --retry 3 -o "$C/node/SHASUMS256-$NODE_V.txt" "https://nodejs.org/dist/$NODE_V/SHASUMS256.txt"
typeset -A NSHA NSIZE NPARTS
for A in x64 arm64; do
  F="node-$NODE_V-linux-$A.tar.gz"
  want=$(awk -v f="$F" '$2 == f {print $1}' "$C/node/SHASUMS256-$NODE_V.txt")
  [ -n "$want" ] || { echo "no checksum for $F" >&2; exit 1; }
  if [ ! -f "$C/node/$F" ] || [ "$(shasum -a 256 "$C/node/$F" | awk '{print $1}')" != "$want" ]; then curl -fsSL --retry 3 -o "$C/node/$F.part" "https://nodejs.org/dist/$NODE_V/$F" && mv -f "$C/node/$F.part" "$C/node/$F"; fi
  [ "$(shasum -a 256 "$C/node/$F" | awk '{print $1}')" = "$want" ] || { echo "$F checksum mismatch" >&2; exit 1; }
  NSHA[$A]=$want; NSIZE[$A]=$(stat -f %z "$C/node/$F")
  if [ ! -f "$DL/$F.p0" ]; then (cd "$DL" && split -b 20m -a 1 "$C/node/$F" "$F.p" && for x in "$F".p?; do mv "$x" "${x%?}$(( $(printf '%d' "'${x: -1}") - 97 ))"; done); fi
  NPARTS[$A]=$(cd "$DL" && ls -1 "$F".p* | sort -t p -k2 -n | tr '\n' ' ')
done

# ---- 换下来的旧程序包挪走（不删）；新的放进去 ----
for old in "$DL"/vs-server-*.tar.gz(N); do [ "$(basename "$old")" = "vs-server-$V.tar.gz" ] || mv "$old" "$ARCH_DIR/"; done
cp "$OUT/vs-server-$V.tar.gz" "$DL/"
cp "$HERE/server/install.sh" "$DL/install.sh"
python3 - "$DL/server.json" "$V" "$B" "vs-server-$V.tar.gz" "$PKG_SHA" "$PKG_SIZE" "$NODE_V" "${NSHA[x64]}" "${NSIZE[x64]}" "${NPARTS[x64]}" "${NSHA[arm64]}" "${NSIZE[arm64]}" "${NPARTS[arm64]}" <<'PY'
import json, sys
a = sys.argv[1:]
node = {"version": a[6], "x64": {"sha256": a[7], "size": int(a[8]), "parts": a[9].split()}, "arm64": {"sha256": a[10], "size": int(a[11]), "parts": a[12].split()}}
json.dump({"version": a[1], "build": int(a[2]), "pkg": {"file": a[3], "sha256": a[4], "size": int(a[5])}, "node": node}, open(a[0], "w"), indent=1)
PY
echo "server $V (build $B) → $DL（tools/deploy.sh 之后网站上就有）"
