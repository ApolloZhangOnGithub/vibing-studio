#!/bin/bash
# 远程桌面用的 FreeRDP：自己编一份静态的（OpenSSL、只带 H.264 解码的 FFmpeg、FreeRDP 客户端库），App 里的 vs-rdp 直接链进去——
#   别的 Mac 上不用装 Homebrew、不用装 FreeRDP、不用命令行工具（用户 2026-10-14：「让用户自己装配置都是垃圾」）。Apple 芯片、Intel 各编一份。
#   tools/build-freerdp.sh arm64|x86_64     产物在 ~/Library/Caches/VibingStudio/frdp/<芯片>/（include、lib；不进 iCloud）；app/build.sh 看到就用它
set -euo pipefail
ARCH="${1:?arm64 或 x86_64}"
ROOT="$HOME/Library/Caches/VibingStudio/frdp"; SRC="$ROOT/src"; P="$ROOT/$ARCH"; B="$ROOT/build-$ARCH"
MIN=14.0
OSSL=openssl-3.5.4; FF=FFmpeg-n7.1.2; FR=FreeRDP-3.32.2
J=$(sysctl -n hw.ncpu)
mkdir -p "$P" "$B"
log() { printf '[%s %s] %s\n' "$(date +%H:%M:%S)" "$ARCH" "$*"; }
unpack() { [ -d "$B/$2" ] || tar -xzf "$SRC/$1" -C "$B"; }

# ---- OpenSSL（静态）----
if [ ! -f "$P/lib/libcrypto.a" ]; then
  log "openssl"
  unpack openssl-3.5.4.tar.gz "$OSSL"
  cd "$B/$OSSL"
  ./Configure "darwin64-$ARCH-cc" no-shared no-tests no-docs no-apps no-module --prefix="$P" --openssldir="$P/ssl" --libdir=lib -mmacosx-version-min=$MIN > "$B/openssl-configure.log" 2>&1
  make -j"$J" > "$B/openssl-make.log" 2>&1
  make install_sw > "$B/openssl-install.log" 2>&1
fi

# ---- FFmpeg：只要 H.264 解码（libavcodec、libavutil；FreeRDP 缩放画面用 libswscale）----
if [ ! -f "$P/lib/libavcodec.a" ]; then
  log "ffmpeg"
  unpack n7.1.2.tar.gz "$FF"
  cd "$B/$FF"
  CROSS=(); [ "$ARCH" != "$(uname -m)" ] && CROSS=(--enable-cross-compile --target-os=darwin)
  ./configure --prefix="$P" --arch="$ARCH" "${CROSS[@]+"${CROSS[@]}"}" --cc="xcrun clang -arch $ARCH" --extra-cflags="-mmacosx-version-min=$MIN" --extra-ldflags="-mmacosx-version-min=$MIN" \
    --enable-static --disable-shared --enable-pic --disable-programs --disable-doc --disable-autodetect --disable-network \
    --disable-everything --enable-decoder=h264 --enable-parser=h264 --enable-avcodec --enable-avutil --enable-swscale \
    --disable-avformat --disable-avdevice --disable-avfilter --disable-swresample --disable-iconv --disable-zlib --disable-bzlib --disable-lzma \
    $( [ "$ARCH" = x86_64 ] && echo --x86asmexe=nasm ) > "$B/ffmpeg-configure.log" 2>&1
  make -j"$J" > "$B/ffmpeg-make.log" 2>&1
  make install > "$B/ffmpeg-install.log" 2>&1
fi

# ---- FreeRDP 客户端库（静态；不要 X11、打印、智能卡、USB、Kerberos、服务器、自带的客户端程序）----
if [ ! -f "$P/.freerdp-video" ]; then # H.264 解码要 WITH_VIDEO_FFMPEG（GNOME 远程桌面发的是 H.264）
  log "freerdp"
  unpack 3.32.2.tar.gz "$FR"
  # 只用这里编的（不让它找到 Homebrew 里的 opus、cairo……：那些别的 Mac 上没有）
  PKG_CONFIG_LIBDIR="$P/lib/pkgconfig" PKG_CONFIG_PATH="" cmake -S "$B/$FR" -B "$B/fr4" -DCMAKE_BUILD_TYPE=Release -DCMAKE_IGNORE_PREFIX_PATH="/opt/homebrew;/usr/local" -DCMAKE_SYSTEM_IGNORE_PREFIX_PATH="/opt/homebrew;/usr/local" -DCMAKE_OSX_ARCHITECTURES="$ARCH" -DCMAKE_OSX_DEPLOYMENT_TARGET=$MIN \
    -DCMAKE_INSTALL_PREFIX="$P" -DCMAKE_PREFIX_PATH="$P" -DCMAKE_FIND_ROOT_PATH="$P" -DOPENSSL_ROOT_DIR="$P" -DOPENSSL_USE_STATIC_LIBS=ON \
    -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF -DWITH_SAMPLE=OFF -DWITH_MANPAGES=OFF -DWITH_CLIENT=OFF -DWITH_SERVER=OFF -DWITH_SHADOW=OFF -DWITH_PROXY=OFF -DWITH_PLATFORM_SERVER=OFF \
    -DWITH_CLIENT_COMMON=ON -DWITH_CHANNELS=ON -DWITH_CLIENT_CHANNELS=ON -DWITH_SERVER_CHANNELS=OFF \
    -DWITH_FFMPEG=ON -DWITH_SWSCALE=ON -DWITH_DSP_FFMPEG=OFF -DWITH_VIDEO_FFMPEG=ON -DWITH_FFMPEG_HWACCEL=OFF -DWITH_OPENH264=OFF -DWITH_X11=OFF -DWITH_WAYLAND=OFF -DWITH_CUPS=OFF -DWITH_PCSC=OFF -DWITH_SMARTCARD_EMULATE=OFF \
    -DWITH_FUSE=OFF -DWITH_KRB5=OFF -DWITH_JSON_DISABLED=ON -DWITH_URIPARSER=OFF -DCHANNEL_URBDRC=OFF -DWITH_LIBUSB=OFF -DWITH_PULSE=OFF -DWITH_ALSA=OFF -DWITH_OSS=OFF \
    -DWITH_CAIRO=OFF -DWITH_JPEG=OFF -DWITH_WEBVIEW=OFF -DWITH_AAD=OFF -DWITH_FIDO=OFF -DWITH_ICU=OFF -DWITH_UNICODE_BUILTIN=ON -DWITH_SDL=OFF -DWITH_CLIENT_SDL=OFF -DWITH_CLIENT_MAC=OFF \
    -DWITH_OPUS=OFF -DWITH_FAAD2=OFF -DWITH_FAAC=OFF -DWITH_FDK_AAC=OFF -DWITH_LAME=OFF -DWITH_GSM=OFF -DWITH_SOXR=OFF -DWITH_KRB5=OFF -DWITH_MBEDTLS=OFF -DWITH_OPENSSL=ON \
    -DWITH_WINPR_TOOLS=OFF -DWITH_BINARY_VERSIONING=OFF -DCHANNEL_RDPECAM=OFF -DCHANNEL_RDPEAR=OFF -DWITH_LODEPNG=OFF -DWITH_SIMD=ON > "$B/freerdp-configure.log" 2>&1
  cmake --build "$B/fr4" -j "$J" > "$B/freerdp-make.log" 2>&1
  cmake --install "$B/fr4" > "$B/freerdp-install.log" 2>&1
  touch "$P/.freerdp-video"
fi
log "done: $(ls "$P/lib" | tr '\n' ' ')"
