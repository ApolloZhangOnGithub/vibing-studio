#!/bin/zsh
# 本机的签名身份「Vibing Studio Local Signing」（自签的代码签名证书）：app/build.sh 默认用它签。
#   为什么：macOS 按签名认 App——系统设置里给的权限（文件夹访问、屏幕录制、辅助功能）跟着签名走。ad-hoc 签名每次编译都不一样，
#   每次更新都要重新授权；Apple 的开发证书会被吊销（2026-10-13 的 296），吊销了 macOS 当恶意软件扔掉。自签的证书一直是这一张、没人能吊销，
#   用它签的每一版在 macOS 看来都是同一个 App（designated requirement = bundle id + 这张证书），权限不再丢。
#   放在单独的钥匙串里（~/Library/Keychains/vibing-studio-signing.keychain-db），它的密码记在登录钥匙串里（「Vibing Studio signing keychain」），
#   codesign 用的时候不弹框。已经有了就什么都不做。私钥只在这个钥匙串里（生成时不落成明文文件）
set -e
KC="$HOME/Library/Keychains/vibing-studio-signing.keychain-db"
NAME="Vibing Studio Local Signing"
SVC="Vibing Studio signing keychain"
if [ -f "$KC" ]; then
  PW="$(security find-generic-password -s "$SVC" -w 2>/dev/null || true)"
  [ -n "$PW" ] && security unlock-keychain -p "$PW" "$KC" 2>/dev/null || true
  if security find-identity -p codesigning "$KC" 2>/dev/null | grep -q "$NAME"; then echo "已经有了：$NAME（$KC）"; exit 0; fi
  echo "钥匙串在，但里面没有「$NAME」：$KC（挪走它再跑一次）" >&2; exit 1
fi
W="$(mktemp -d "${TMPDIR:-/tmp}/vs-sign.XXXXXX")"
CNF="$W/cert.cnf"
cat > "$CNF" <<EOF
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
[dn]
CN = $NAME
O = Vibing Studio
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOF
TP="$(/usr/bin/openssl rand -hex 16)"
PW="$(/usr/bin/openssl rand -hex 24)"
# 私钥、证书直接接进 .p12（用一次性的密码加密），不落成明文
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -keyout /dev/stdout -out /dev/stdout -days 7300 -config "$CNF" 2>/dev/null \
  | /usr/bin/openssl pkcs12 -export -name "$NAME" -out "$W/id.p12" -passout "pass:$TP"
security create-keychain -p "$PW" "$KC"
security set-keychain-settings "$KC" # 不自动锁
security unlock-keychain -p "$PW" "$KC"
security import "$W/id.p12" -k "$KC" -P "$TP" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PW" "$KC" >/dev/null
security add-generic-password -U -a vibing-studio-signing -s "$SVC" -l "$SVC" -w "$PW"
security find-identity -p codesigning "$KC" | grep "$NAME"
echo "建好了：$NAME（$KC）"
