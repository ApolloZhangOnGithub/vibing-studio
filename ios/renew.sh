#!/bin/zsh
# renew.sh —— iPhone / iPad 版是用免费的开发者账号签的：装上 7 天后设备上就打不开了。这台 Mac 每 12 小时看一次（launchd：~/Library/LaunchAgents/beer.paimon.vibingstudio.renew.plist）：
#   离过期不到 2 天、iPhone / iPad 在同一个网络里（配对过、开着），就把快过期的那份描述文件挪到废纸篓（Xcode 会重新领一份新的 7 天的）、重新编、每台都重新装；
#   装的时候不打开它（NO_LAUNCH）。设备都不在：下次再看。记录在 ~/Library/Logs/VibingStudioIOSRenew.log
set -u
cd "$(dirname "$0")"
exec >>"$HOME/Library/Logs/VibingStudioIOSRenew.log" 2>&1
echo "== $(date '+%F %T')"
PP="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
BID=beer.paimon.vibingstudio
TMPP="${TMPDIR:-/tmp}/vibing-renew-profile.plist"
now=$(date +%s); soon=$((now + 2 * 86400)); expiring=(); have=0
setopt null_glob
for f in "$PP"/*.mobileprovision; do
  security cms -D -i "$f" > "$TMPP" 2>/dev/null || continue
  app=$(plutil -extract Entitlements.application-identifier raw -o - "$TMPP" 2>/dev/null)
  [[ "$app" == *".$BID" ]] || continue
  have=1
  ex=$(plutil -extract ExpirationDate raw -o - "$TMPP" 2>/dev/null)
  ts=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$ex" +%s 2>/dev/null || echo 0)
  echo "profile $f expires $ex"
  (( ts < soon )) && expiring+=("$f")
done
if (( have && ${#expiring[@]} == 0 )); then echo "not due yet"; exit 0; fi
# iPhone / iPad 在不在：配对过、现在连得上
J="${TMPDIR:-/tmp}/vibing-renew-devices.json"
xcrun devicectl list devices --json-output "$J" >/dev/null 2>&1 || { echo "devicectl failed"; exit 0; }
ok=$(python3 - "$J" <<'PY'
import json, sys
try: devs = json.load(open(sys.argv[1]))["result"]["devices"]
except Exception: devs = []
ok = [d for d in devs if (d.get("hardwareProperties") or {}).get("deviceType") in ("iPhone", "iPad") and (d.get("hardwareProperties") or {}).get("reality") != "simulated"
      and (d.get("connectionProperties") or {}).get("pairingState") == "paired" and (d.get("connectionProperties") or {}).get("tunnelState") != "unavailable"]
print("yes" if ok else "")
PY
)
[ -n "$ok" ] || { echo "no iPhone / iPad reachable; try later"; exit 0; }
for f in "${expiring[@]}"; do echo "move to Trash: $f"; mv "$f" "$HOME/.Trash/" || true; done
NO_LAUNCH=1 ./build.sh && echo "renewed" || echo "build/install failed"
