#!/usr/bin/env bash
# Installs yt-dlp, ffmpeg and Deno for MultiMessenger on Linux and macOS (no root needed).
# Run:   bash scripts/install-tools.sh
set -euo pipefail
OS=$(uname -s); ARCH=$(uname -m)
case "$OS" in
  Linux)  DIR="${XDG_CONFIG_HOME:-$HOME/.config}/multi-messenger/tools"
          YT=yt-dlp_linux
          case "$ARCH" in x86_64) DENO=deno-x86_64-unknown-linux-gnu; FF=amd64;; aarch64|arm64) DENO=deno-aarch64-unknown-linux-gnu; FF=arm64;; *) echo "Unsupported CPU: $ARCH"; exit 1;; esac;;
  Darwin) DIR="$HOME/Library/Application Support/multi-messenger/tools"
          YT=yt-dlp_macos
          case "$ARCH" in arm64) DENO=deno-aarch64-apple-darwin;; *) DENO=deno-x86_64-apple-darwin;; esac;;
  *) echo "Unsupported system: $OS"; exit 1;;
esac
mkdir -p "$DIR"; TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

echo "1/3 yt-dlp ..."
curl -fL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$YT" -o "$DIR/yt-dlp"; chmod +x "$DIR/yt-dlp"

echo "2/3 Deno ..."
curl -fL "https://github.com/denoland/deno/releases/latest/download/$DENO.zip" -o "$TMP/deno.zip"
unzip -oq "$TMP/deno.zip" -d "$TMP"; install -m 755 "$TMP/deno" "$DIR/deno"

echo "3/3 ffmpeg ..."
if [ "$OS" = Linux ]; then
  curl -fL "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-$FF-static.tar.xz" -o "$TMP/ff.tar.xz"
  tar -xJf "$TMP/ff.tar.xz" -C "$TMP"; install -m 755 "$TMP"/ffmpeg-*-static/ffmpeg "$DIR/ffmpeg"
else
  if command -v brew >/dev/null; then brew install ffmpeg; ln -sf "$(command -v ffmpeg)" "$DIR/ffmpeg"
  else echo "Install Homebrew (brew.sh) and run: brew install ffmpeg"; fi
fi
echo "Done. Files are in: $DIR"
echo "Restart MultiMessenger. It finds them automatically."
