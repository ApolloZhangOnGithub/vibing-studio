#!/bin/bash
# 测试 App：编一份调试版，复制成 beer.paimon.terminal.rdptest（Vibing Studio RDPTest），用本机的签名身份签（tools/signing-identity.sh；系统里给它的权限重编后还在），
#   从系统的 App 列表里拿掉。放在 ~/Library/Caches/VibingStudio/rdptest.noindex（.noindex：聚焦不收录、「打开方式」里不会多一个）
set -euo pipefail
APPDIR="$(cd "$(dirname "$0")/../../app" && pwd)"
B="$HOME/Library/Caches/VibingStudio/rdpbuild.noindex"; T="$HOME/Library/Caches/VibingStudio/rdptest.noindex/Vibing Studio RDPTest.app"
cd "$APPDIR"
CONFIG=debug DEV=1 MODE=terminal APP_DIR="$B" ./build.sh 2>&1 | grep -E 'error|built ' || true
mkdir -p "$(dirname "$T")"
ditto "$B/Vibing Studio.app" "$T"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier beer.paimon.terminal.rdptest' -c 'Set :CFBundleName Vibing Studio RDPTest' -c 'Set :CFBundleDisplayName Vibing Studio RDPTest' "$T/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Delete :CFBundleDocumentTypes' "$T/Contents/Info.plist" >/dev/null 2>&1 || true # 不认任何文件：就算被系统登记了，「打开方式」里也不会有它（2026-10-28）
SKC="$HOME/Library/Keychains/vibing-studio-signing.keychain-db"; SID=""
if [ -f "$SKC" ]; then security unlock-keychain -p "$(security find-generic-password -s "Vibing Studio signing keychain" -w)" "$SKC" 2>/dev/null; SID="$(security find-identity -p codesigning "$SKC" | awk '/"Vibing Studio Local Signing"/ { print $2; exit }')"; fi
if [ -n "$SID" ]; then codesign --force --sign "$SID" --keychain "$SKC" --options runtime --entitlements Paimon.entitlements "$T" 2>/dev/null; else codesign --force --sign - --options runtime --entitlements Paimon.entitlements "$T" 2>/dev/null; fi
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$T" >/dev/null 2>&1 || true
codesign --verify --strict "$T" && echo "test app ready"
