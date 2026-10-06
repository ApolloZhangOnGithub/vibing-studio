#!/bin/zsh
# build.sh —— Vibing Studio 的 iPhone / iPad 版（同一个原生 App）
#   ./build.sh               连着的 iPhone、iPad（数据线；或者配对过、同一个 Wi-Fi）：编、签名（团队 N2PMDDULMW，自动描述文件）、每台都装上、打开
#   ./build.sh iphone        只装 iPhone；./build.sh ipad 只装 iPad；./build.sh iphone 深蓝色   只装名字里带「深蓝色」的那台
#   ./build.sh sim [ipad]    模拟器（默认 iPhone）：编、装、打开，连本地开发服务器（localhost:8787，测试登录）——先在 teyvat-mac-simulator 里 node dev/run.mjs --port 8787
#   也可以直接用 Xcode 打开 VibingStudio.xcodeproj，选设备，按 ▶︎
# 工程由 project.yml 生成（xcodegen）；编出来的在 ~/Library/Developer/VibingStudioIOS（不放「文稿」里：iCloud 给文件加的属性让签名出错）
set -euo pipefail
cd "$(dirname "$0")"
to() { local s=$1; shift; PERL_BADLANG=0 perl -e 'alarm shift; exec @ARGV' "$s" "$@"; }  # 带超时跑（设备没响应时不一直卡着）
xcodegen generate >/dev/null
DD="$HOME/Library/Developer/VibingStudioIOS/DerivedData"
BID="beer.paimon.vibingstudio"

if [ "${1:-}" = sim ]; then
  # 模拟器很吃 CPU（开着的一台 iOS 模拟器 + 它崩过一次的服务把这台 Mac 拖了几个小时）：默认不开；真要开得明说 ALLOW_SIM=1，
  #   而且开了 10 分钟后自动关掉（不会忘了关一直开着）
  if [ "${ALLOW_SIM:-}" != 1 ]; then echo "不开模拟器（很吃 CPU）。真要开：ALLOW_SIM=1 ./build.sh sim；平时直接装到连着的 iPhone / iPad：./build.sh" >&2; exit 2; fi
  KIND="${2:-iphone}"
  SIM=$(xcrun simctl list devices available -j | python3 -c 'import json,sys; k=sys.argv[1]; d=json.load(sys.stdin)["devices"]; l=[x for v in d.values() for x in v if ("iPad" if k=="ipad" else "iPhone") in x["name"]]; b=[x for x in l if x["state"]=="Booted"]; print((b or l)[0]["udid"])' "$KIND")
  xcodebuild -project VibingStudio.xcodeproj -scheme VibingStudio -sdk iphonesimulator -destination "id=$SIM" -configuration Debug -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO build | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
  xcrun simctl boot "$SIM" 2>/dev/null || true
  open -a Simulator 2>/dev/null || true
  xcrun simctl install "$SIM" "$DD/Build/Products/Debug-iphonesimulator/Vibing Studio.app"
  [ -n "${NO_LAUNCH:-}" ] || xcrun simctl launch "$SIM" "$BID" ${SERVICE_URL:+-serviceURL "$SERVICE_URL"} ${DEV_LOGIN:+-devLogin YES}
  ( sleep $(( ${SIM_MINUTES:-10} * 60 )); xcrun simctl shutdown "$SIM" >/dev/null 2>&1 ) </dev/null >/dev/null 2>&1 & disown # 到点自动关
  echo "$SIM（${SIM_MINUTES:-10} 分钟后自动关掉）"
  exit 0
fi

# 连着的设备：配对过的真机（iPhone、iPad；第一个参数 iphone / ipad 只要那一种）：CoreDevice 标识（装、打开用）、硬件 UDID（xcodebuild 用）、名字
WANT="${1:-}"
NAMEF="${2:-}"
J=$(mktemp)
to 60 xcrun devicectl list devices --json-output "$J" >/dev/null 2>&1 || true
DEVS=("${(@f)$(python3 - "$J" "$WANT" "$NAMEF" <<'PY'
import json, sys
try: devs = json.load(open(sys.argv[1]))["result"]["devices"]
except Exception: devs = []
want = sys.argv[2].lower(); namef = sys.argv[3]
for d in devs:
    hp = d.get("hardwareProperties") or {}; cp = d.get("connectionProperties") or {}; dp = d.get("deviceProperties") or {}
    kind = hp.get("deviceType")
    if kind not in ("iPhone", "iPad") or hp.get("reality") == "simulated" or cp.get("pairingState") != "paired": continue
    if want in ("iphone", "ipad") and kind.lower() != want: continue
    if namef and namef not in (dp.get("name") or ""): continue
    print(d["identifier"], hp.get("udid", ""), kind, (dp.get("name") or kind).replace(" ", "_"))
PY
)}")
if [ -z "${DEVS[1]:-}" ]; then
  echo "没找到配对过的 ${WANT:-iPhone / iPad}：用数据线连上这台 Mac，设备上点「信任」，再跑一次（第一次装要在设备的 设置 › 隐私与安全性 里打开「开发者模式」）" >&2
  exit 1
fi
for line in "${DEVS[@]}"; do
  read -r CDID UDID KIND NAME <<<"$line"
  echo "装到 ${NAME//_/ }（$KIND，$UDID）"
  to 1200 xcodebuild -project VibingStudio.xcodeproj -scheme VibingStudio -sdk iphoneos -destination "id=$UDID" -configuration Release -derivedDataPath "$DD" -allowProvisioningUpdates build | grep -E "error:|BUILD (SUCCEEDED|FAILED)" || true
  to 300 xcrun devicectl device install app --device "$CDID" "$DD/Build/Products/Release-iphoneos/Vibing Studio.app" || { echo "装不上 ${NAME//_/ }：设备锁着、没开开发者模式、或者没信任这台 Mac" >&2; continue; }
  [ -n "${NO_LAUNCH:-}" ] || to 60 xcrun devicectl device process launch --device "$CDID" "$BID" || echo "装好了：在 ${NAME//_/ } 上点 Vibing Studio 打开（第一次要在 设置 › 通用 › VPN 与设备管理 里信任这个开发者）"
done
