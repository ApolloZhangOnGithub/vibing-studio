#!/bin/bash
# build.sh —— 编出 macOS Simulator.app（网页版 macOS 模拟器，原名 Paimon）/ Vibing Studio.app（MODE=terminal）（不用开 Xcode）：swiftc 编、拼 .app、画图标、签名
#   ./build.sh                 发布版，装在 ~/Applications/Paimon.app（启动台、聚焦搜索里能找到）
#   CONFIG=debug ./build.sh    调试版：Safari 的「开发」菜单能连上页面（WKWebView 的 isInspectable）
#   APP_DIR=<目录> ./build.sh  放到别处。别放进 iCloud 同步的文件夹（「文稿」「桌面」）：那里的文件会被加上 FinderInfo 等属性，codesign 不肯签
#   SIGN_ID=<证书的 SHA-1 或名字> ./build.sh   指定签名证书；默认找钥匙串里第一个 Apple Development / Developer ID Application，找不到就 ad-hoc
#   MODE=terminal ./build.sh   编 Vibing Studio.app（原名 Paimon Terminal；同一套代码：没有网页桌面，shell 和 agent 的工具跑在这台 Mac 上；bundle id 仍是 beer.paimon.terminal）
# 中间产物（图标）在 build/ 里
set -euo pipefail
cd "$(dirname "$0")"

CONFIG="${CONFIG:-release}"
MODE="${MODE:-desktop}"
# 版本号：同界面的那一个（ui/version.json，部署一次 +1，如 0.2.424）——一个产品一套号；构建号（CFBundleVersion）另记，比新旧用它
VERSION="${VERSION:-$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$(cd "$(dirname "$0")/../ui" && pwd)/version.json" 2>/dev/null || echo 0.2.0)}"
BUILD="${BUILD:-$(cat ../tools/app-build.txt 2>/dev/null || echo 288)}" # 构建号：tools/app-build.txt 里记着的（发版、待更新时传 BUILD=<比装着的大>；以前按提交数，换成独立仓库后会从 1 重新数，不能再用）
if [ "$MODE" = terminal ]; then NAME="Vibing Studio"; BID="beer.paimon.terminal"; ICON="AppIcon-terminal"; else NAME="macOS Simulator"; BID="beer.paimon.desktop"; ICON="AppIcon"; fi
# DEV=1：测试用的那份——bundle id 加 .dev、显示的名字加 Dev（路径不变），和装在「应用程序」里的那份互不干扰（双击、Dock、登录状态都分开）
if [ "${DEV:-}" = 1 ]; then BID="$BID.dev"; SHOWN="$NAME Dev"; else SHOWN="$NAME"; fi
APP="${APP_DIR:-$HOME/Applications}/$NAME.app"
ARCH="${TARGET_ARCH:-$(uname -m)}" # TARGET_ARCH=arm64 / x86_64：发版时 Apple 芯片、Intel 各编一份（各自原生，不用 Rosetta）
# UNIVERSAL=1：两份合成一个（包大一倍；发版不用它，按芯片分开下载）
# 那里已经有一个别的同名 App：不覆盖
if [ -f "$APP/Contents/Info.plist" ] && [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist" 2>/dev/null)" != "$BID" ]; then
  echo "$APP 是别的 App，不覆盖；用 APP_DIR=<目录> 换个地方" >&2; exit 1
fi
mkdir -p build "$APP/Contents/MacOS" "$APP/Contents/Resources"

# ---- 编译 ----
FLAGS=(-swift-version 5 -target "$ARCH-apple-macos14.0" -module-name Paimon -import-objc-header Sources/Shim.h) # Shim.h：Swift 调不了的变参 C 函数（shm_open）
if [ "$CONFIG" = debug ]; then FLAGS+=(-Onone -g -D DEBUG); else FLAGS+=(-O); fi
if [ "${UNIVERSAL:-}" = 1 ]; then
  for A in arm64 x86_64; do
    F2=(); for f in "${FLAGS[@]}"; do F2+=("${f/$ARCH-apple/$A-apple}"); done
    xcrun swiftc "${F2[@]}" Sources/*.swift -o "build/Paimon-$A"
  done
  lipo -create build/Paimon-arm64 build/Paimon-x86_64 -output "$APP/Contents/MacOS/Paimon"
else
  xcrun swiftc "${FLAGS[@]}" Sources/*.swift -o "$APP/Contents/MacOS/Paimon"
fi

# ---- Info.plist、资源 ----
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" -e "s/__COPYRIGHT__/© 2026 $NAME/" Info.plist > "$APP/Contents/Info.plist"
if [ "$MODE" = terminal ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleName $SHOWN" -c "Set :CFBundleDisplayName $SHOWN" -c "Set :CFBundleIdentifier $BID" -c "Set :CFBundleIconFile $ICON" -c "Add :PaimonMode string terminal" "$APP/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Merge DocTypes.plist" "$APP/Contents/Info.plist" # 能打开的文件（「打开方式」里有它；打开的交给页面，见 AppDelegate 的 application(_:open:)）
  # 本地界面（Sources/LocalUI.swift）：界面文件从这台 Mac 上读，不用部署网站——先用仓库里的 public/（改了按 ⌘R 就生效），这台 Mac 上没有仓库时用 App 里带的一份
  UIDIR="${UIDIR:-$(cd ../ui && pwd)}" # 独立的 vibing-studio：界面在旁边的 ui/（老地方 teyvat-mac-simulator 里是 ../../public）
  # 发出去的（tools/release-mac.sh 设 RELEASE=1）不记仓库路径：别的 Mac 上同一个用户名、「文稿」走 iCloud 时这个路径也在，App 就读那份正在改的仓库，不跟网站走
  [ "${RELEASE:-}" = 1 ] || plutil -insert VibingUIDir -string "$UIDIR" "$APP/Contents/Info.plist" # 路径里有空格：plutil 照原样写
  mkdir -p "$APP/Contents/Resources/web"
  rsync -a --exclude '.DS_Store' --exclude 'downloads' "$UIDIR/" "$APP/Contents/Resources/web/" # downloads/：发出去的 App 本身，不带
  mkdir -p "$APP/Contents/Resources/bin"
  cp Resources/bin/paimon Resources/bin/tcb "$APP/Contents/Resources/bin/"
  chmod 755 "$APP/Contents/Resources/bin/paimon" "$APP/Contents/Resources/bin/tcb"
  # 远程桌面的助手（Helpers/vs-rdp.c，FreeRDP 3）：这台 Mac 上有 Homebrew 的 FreeRDP、芯片对得上就编一个带上；源码也带上——
  #   别的 Mac 上带的这个跑不起来（没装 FreeRDP、版本不同、Intel）时，App 用那台 Mac 上的 FreeRDP 现编（RdpPanes.swift 的 RdpHelper）
  cp Helpers/vs-rdp.c "$APP/Contents/Resources/vs-rdp.c"
  FRDP=""; for p in /opt/homebrew/opt/freerdp /usr/local/opt/freerdp; do [ -f "$p/lib/libfreerdp3.dylib" ] && { FRDP="$p"; break; }; done
  if [ -n "$FRDP" ] && lipo -archs "$FRDP/lib/libfreerdp3.dylib" 2>/dev/null | grep -qw "$ARCH"; then
    xcrun clang -O2 -w -target "$ARCH-apple-macos14.0" Helpers/vs-rdp.c -I"$FRDP/include/freerdp3" -I"$FRDP/include/winpr3" -L"$FRDP/lib" -lfreerdp3 -lfreerdp-client3 -lwinpr3 -o "$APP/Contents/Resources/bin/vs-rdp"
  fi # 编不了（没有 FreeRDP、芯片不对）：不带；App 先试着跑，跑不起来就现编
fi
printf 'APPL????' > "$APP/Contents/PkgInfo"
cp Resources/bridge.js "$APP/Contents/Resources/bridge.js"

# ---- 图标：make-icon.swift 画一套 iconset，iconutil 合成 .icns（改了脚本或图才重画）----
# Paimon Terminal 的图标是 Icon/terminal-logo.png 那张派蒙：画自己带圆角方块的霓虹外框，按外框裁（ICON_SHAPE 是外框的形状，
# 换了图用 Icon/fit-rim.swift 重新量）；32 像素及以下只取脸（ICON_SMALL）
LOGO=""; SHAPE=""; SMALL=""
if [ "$MODE" = terminal ]; then LOGO="Icon/terminal-logo.png"; SHAPE="623.35,614.17,619.64,618.34,4.059"; SMALL="360,420,480"; else LOGO="Icon/desk-logo.png"; fi # macOS Simulator：手画的 SVG（public/desk-logo.svg，rsvg-convert 出的 1024 图）
if [ ! -f "build/$ICON.icns" ] || [ Icon/make-icon.swift -nt "build/$ICON.icns" ] || { [ -n "$LOGO" ] && [ "$LOGO" -nt "build/$ICON.icns" ]; } || [ build.sh -nt "build/$ICON.icns" ]; then
  xcrun swiftc -swift-version 5 -O Icon/make-icon.swift -o build/make-icon
  ICON_STYLE="$MODE" ICON_IMAGE="${LOGO:+$PWD/$LOGO}" ICON_SHAPE="$SHAPE" ICON_SMALL="$SMALL" build/make-icon "build/$ICON.iconset"
  iconutil -c icns "build/$ICON.iconset" -o "build/$ICON.icns"
fi
cp "build/$ICON.icns" "$APP/Contents/Resources/$ICON.icns"

# ---- 签名：稳定的证书签，系统设置里给的权限（屏幕录制、辅助功能）重新编译后还在；ad-hoc 每次编译都算一个新 App ----
ID="${SIGN_ID:-$(security find-identity -v -p codesigning 2>/dev/null | awk '/"(Apple Development|Developer ID Application)/ { print $2; exit }')}"
ID="${ID:--}"
xattr -cr "$APP"
sign() { codesign --force --timestamp=none --options runtime --entitlements Paimon.entitlements --sign "$1" "$APP"; }
# 钥匙串要是弹框问密码（后台跑时没人点）会一直卡着：60 秒没签完就退回 ad-hoc（用 python 的 subprocess 超时等它，不轮询）
SRC=0
python3 -c 'import subprocess, sys
try: sys.exit(subprocess.run(sys.argv[1:], timeout=60).returncode)
except subprocess.TimeoutExpired: sys.exit(124)' codesign --force --timestamp=none --options runtime --entitlements Paimon.entitlements --sign "$ID" "$APP" || SRC=$?
if [ "$SRC" = 124 ]; then echo "签名等太久（钥匙串在问？），改用 ad-hoc" >&2; ID="-"; sign -
elif [ "$SRC" != 0 ] && [ "$ID" != "-" ]; then echo "用证书签名失败，改用 ad-hoc" >&2; ID="-"; sign -; fi
# 证书被 Apple 吊销了：这样签的 App，macOS 一打开就当恶意软件扔进废纸篓（2026-10-13 的 296 就是这样）。查一下（要联网），被吊销就改用 ad-hoc——
#   本机、经 App 自己更新的别的 Mac 都能打开（不带隔离标记）；系统设置里给的权限（屏幕录制、辅助功能）要重新给一次。在钥匙串里换上新证书后自动用回证书
SPCTL="$(/usr/sbin/spctl -a -t exec -vv "$APP" 2>&1 || true)" # spctl 对没公证的 App 本来就返回非 0（pipefail 下不能直接接 grep）
if [ "$ID" != "-" ] && printf '%s\n' "$SPCTL" | grep -q REVOKED; then echo "签名证书已被 Apple 吊销（${ID}），改用 ad-hoc" >&2; ID="-"; sign -; fi
codesign --verify --strict "$APP"
echo "built $APP ($CONFIG, $VERSION ($BUILD), signed with ${ID/#-/ad-hoc})"
