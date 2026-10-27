#!/bin/sh
# Vibing Studio 服务器版的安装脚本（Linux，不需要桌面）。不要直接跑这个文件：在 Vibing Studio 的「设备」里点「添加服务器」，复制那条命令
#   （curl -fsSL https://…/s/<一次性口令> | sh）——网站给出这个脚本时把网站地址、口令、版本号、校验值填进来。
# 做的事：查平台（x86_64 / arm64，glibc ≥ 2.28）→ 下载 Node 运行时、程序包（校验 sha256）→ 装在 ~/.local/share/vibing-studio-server →
#   配对（这台生成一把钥匙，登记到你的账号）→ 装成开机自己起来的服务（systemd；没有 systemd 用 cron @reboot + 看门狗）→ 等它连上
# 不需要 root（用 root 跑就装成系统服务）；不删任何东西：下载的包留在安装目录里，下次装同一版直接用
set -eu

VS_ORIGIN="__VS_ORIGIN__"
VS_TOKEN="__VS_TOKEN__"
VS_VERSION="__VS_VERSION__"
VS_BUILD="__VS_BUILD__"
VS_NODE_VERSION="__VS_NODE_VERSION__"
VS_NODE_SHA_X64="__VS_NODE_SHA_X64__"
VS_NODE_SHA_ARM64="__VS_NODE_SHA_ARM64__"
VS_PKG_SHA="__VS_PKG_SHA__"
VS_LANG="${VS_LANG:-__VS_LANG__}"

ZH=0
case "${VS_LANG}${LC_ALL:-}${LANG:-}" in zh*|*zh_*|*zh-*) ZH=1 ;; esac
say() { if [ "$ZH" = 1 ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi; }
fail() { if [ "$ZH" = 1 ]; then printf 'Vibing Studio：%s\n' "$1" >&2; else printf 'Vibing Studio: %s\n' "$2" >&2; fi; exit 1; }

# ---- 平台 ----
[ "$(uname -s)" = "Linux" ] || fail "服务器版只支持 Linux。" "The server edition runs on Linux only."
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64; NODE_SHA=$VS_NODE_SHA_X64 ;;
  aarch64|arm64) ARCH=arm64; NODE_SHA=$VS_NODE_SHA_ARM64 ;;
  *) fail "不支持这种处理器：$(uname -m)（支持 x86_64、arm64）。" "Unsupported processor: $(uname -m) (x86_64 and arm64 are supported)." ;;
esac
if ls /lib/ld-musl-* >/dev/null 2>&1 || (ldd --version 2>&1 | grep -qi musl); then
  fail "暂不支持 musl 的系统（Alpine 等）。请用 glibc 的发行版（Ubuntu、Debian、RHEL、Fedora……）。" "musl-based systems (Alpine etc.) aren't supported yet. Use a glibc distribution (Ubuntu, Debian, RHEL, Fedora…)."
fi
GLIBC=$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}')
if [ -n "$GLIBC" ]; then
  GMAJ=${GLIBC%%.*}; GMIN=${GLIBC#*.}; GMIN=${GMIN%%.*}
  if [ "$GMAJ" -lt 2 ] || { [ "$GMAJ" -eq 2 ] && [ "$GMIN" -lt 28 ]; }; then
    fail "系统太旧（glibc $GLIBC，需要 2.28 以上，比如 Ubuntu 18.10、Debian 10、RHEL 8 及以后）。" "This system is too old (glibc $GLIBC; 2.28 or later is needed, e.g. Ubuntu 18.10, Debian 10, RHEL 8 or newer)."
  fi
fi
command -v tar >/dev/null 2>&1 || fail "需要 tar。" "tar is required."
command -v gzip >/dev/null 2>&1 || fail "需要 gzip。" "gzip is required."
if command -v curl >/dev/null 2>&1; then get() { curl -fsSL --retry 3 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then get() { wget -q -O "$2" "$1"; }
else fail "需要 curl 或 wget。" "curl or wget is required."; fi
if command -v sha256sum >/dev/null 2>&1; then sum() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then sum() { shasum -a 256 "$1" | awk '{print $1}'; }
elif command -v openssl >/dev/null 2>&1; then sum() { openssl dgst -sha256 "$1" | awk '{print $NF}'; }
else fail "需要 sha256sum。" "sha256sum is required."; fi

# ---- 装在哪 ----
[ -n "${HOME:-}" ] || fail "没有 HOME。" "HOME is not set."
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/vibing-studio-server"
mkdir -p "$DATA/node" "$DATA/app" "$DATA/bin" "$DATA/downloads"
say "正在安装 Vibing Studio 服务器版 $VS_VERSION（$ARCH）…" "Installing Vibing Studio Server $VS_VERSION ($ARCH)…"

fetch() { # 地址 文件 校验值 名字：已经有、校验对得上就不再下
  if [ -f "$2" ] && [ "$(sum "$2")" = "$3" ]; then return 0; fi
  get "$1" "$2.part" || fail "下载$4失败。" "Couldn't download $4."
  [ "$(sum "$2.part")" = "$3" ] || fail "$4 校验不对（下载不完整或被改过）。" "$4 failed its checksum (incomplete or altered download)."
  mv -f "$2.part" "$2"
}
relink() { ln -sfn "$2" "$1.new" && mv -Tf "$1.new" "$1" 2>/dev/null || { ln -sfn "$2" "$1"; }; }

# ---- Node 运行时 ----
ND="$DATA/node/$VS_NODE_VERSION"
if [ ! -x "$ND/bin/node" ]; then
  say "下载 Node $VS_NODE_VERSION…" "Downloading Node $VS_NODE_VERSION…"
  fetch "$VS_ORIGIN/s/$VS_TOKEN/node/$ARCH" "$DATA/downloads/node-$VS_NODE_VERSION-linux-$ARCH.tar.gz" "$NODE_SHA" " Node"
  mkdir -p "$ND.tmp"
  tar -xzf "$DATA/downloads/node-$VS_NODE_VERSION-linux-$ARCH.tar.gz" -C "$ND.tmp" --strip-components=1
  mv "$ND.tmp" "$ND"
fi
"$ND/bin/node" -e "process.exit(0)" 2>/dev/null || fail "Node 运行不了（缺系统库？）。" "Node doesn't run on this system (missing system libraries?)."
relink "$DATA/node/current" "$ND"

# ---- 程序包 ----
AD="$DATA/app/$VS_BUILD"
if [ ! -f "$AD/main.js" ]; then
  say "下载 Vibing Studio 服务器版…" "Downloading Vibing Studio Server…"
  fetch "$VS_ORIGIN/s/$VS_TOKEN/pkg" "$DATA/downloads/vs-server-$VS_VERSION.tar.gz" "$VS_PKG_SHA" " Vibing Studio Server"
  mkdir -p "$AD.tmp"
  tar -xzf "$DATA/downloads/vs-server-$VS_VERSION.tar.gz" -C "$AD.tmp" --strip-components=1
  mv "$AD.tmp" "$AD"
fi
relink "$DATA/app/current" "$AD"

# ---- 命令：vibing-studio-server ----
L="$DATA/bin/vibing-studio-server"
cat > "$L.new" <<EOF
#!/bin/sh
# Vibing Studio 服务器版（vibing-studio-server status | logs | update）
VS_SERVER_DATA="$DATA" VS_SERVER_LAUNCHER="$L" exec "$DATA/node/current/bin/node" "$DATA/app/current/main.js" "\$@"
EOF
chmod 755 "$L.new" && mv -f "$L.new" "$L"
mkdir -p "$HOME/.local/bin" && ln -sfn "$L" "$HOME/.local/bin/vibing-studio-server"
if [ "$(id -u)" = 0 ] && [ -d /usr/local/bin ]; then ln -sfn "$L" /usr/local/bin/vibing-studio-server; fi

# ---- 配对：这台生成一把钥匙，登记到你的账号（口令只能用一次）----
VS_LANG="$VS_LANG" "$L" pair "$VS_TOKEN" --origin "$VS_ORIGIN" || exit 1

# ---- 开机自己起来的服务 ----
UNIT=vibing-studio-server.service
have_systemd() { [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; }
unit_body() {
  cat <<EOF
[Unit]
Description=Vibing Studio Server
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$L run
Restart=always
RestartSec=3
Environment=VS_SERVER_DATA=$DATA
$1
[Install]
WantedBy=$2
EOF
}
MODE=""
if [ "$(id -u)" = 0 ] && have_systemd; then
  unit_body "Environment=HOME=$HOME" multi-user.target > "/etc/systemd/system/$UNIT"
  systemctl daemon-reload && systemctl enable "$UNIT" >/dev/null 2>&1 && systemctl restart "$UNIT" && MODE=system
elif have_systemd && systemctl --user show-environment >/dev/null 2>&1; then
  # 用户服务：退出 SSH 以后也要接着跑、开机就起来——要「lingering」（loginctl enable-linger；大多数发行版允许给自己开）
  LINGER=$(loginctl show-user "$(id -un)" --property=Linger 2>/dev/null | cut -d= -f2)
  if [ "$LINGER" != "yes" ]; then loginctl enable-linger "$(id -un)" >/dev/null 2>&1 || sudo -n loginctl enable-linger "$(id -un)" >/dev/null 2>&1 || true; fi
  LINGER=$(loginctl show-user "$(id -un)" --property=Linger 2>/dev/null | cut -d= -f2)
  if [ "$LINGER" = "yes" ]; then
    mkdir -p "$HOME/.config/systemd/user"
    unit_body "" default.target > "$HOME/.config/systemd/user/$UNIT"
    systemctl --user daemon-reload && systemctl --user enable "$UNIT" >/dev/null 2>&1 && systemctl --user restart "$UNIT" && MODE=user
  fi
fi
if [ -z "$MODE" ]; then
  # 没有 systemd（容器、一些 VPS），或者开不了 lingering：cron 开机拉起看门狗；现在先起一个
  if command -v crontab >/dev/null 2>&1; then
    ( crontab -l 2>/dev/null | grep -v 'vibing-studio-server supervise' ; echo "@reboot $L supervise >/dev/null 2>&1" ) | crontab - 2>/dev/null && MODE=cron || true
  fi
  if ! "$L" status >/dev/null 2>&1 || ! pgrep -f "$DATA/app/current/main.js supervise" >/dev/null 2>&1; then
    if command -v setsid >/dev/null 2>&1; then setsid "$L" supervise >/dev/null 2>&1 < /dev/null &
    else nohup "$L" supervise >/dev/null 2>&1 < /dev/null & fi
  fi
  [ -n "$MODE" ] || MODE=manual
fi

case "$MODE" in
  system) say "已装成系统服务（systemctl status vibing-studio-server）。" "Installed as a system service (systemctl status vibing-studio-server)." ;;
  user) say "已装成你的用户服务，开机自动运行（systemctl --user status vibing-studio-server）。" "Installed as your user service; it starts at boot (systemctl --user status vibing-studio-server)." ;;
  cron) say "已设为开机自动运行（cron @reboot）。" "Set to start at boot (cron @reboot)." ;;
  manual) say "已在后台运行；这台没有 systemd 和 cron，重启后要再运行：vibing-studio-server supervise &" "Running in the background. This system has neither systemd nor cron, so after a reboot run: vibing-studio-server supervise &" ;;
esac
"$L" status --wait 45 || true
say "命令：vibing-studio-server status | logs | update" "Commands: vibing-studio-server status | logs | update"
