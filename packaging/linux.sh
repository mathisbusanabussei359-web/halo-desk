#!/usr/bin/env bash
set -euo pipefail
version="$1"
tool="$2"
runtime="$3"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
app="$stage/HaloDesk.AppDir"
mkdir -p "$app/usr/bin" dist
chmod 755 "$app" "$app/usr" "$app/usr/bin"
install -m 755 target/release/halo-desk "$app/usr/bin/halo-desk"
install -m 644 packaging/halo-desk.desktop "$app/halo-desk.desktop"
install -m 644 assets/icon.png "$app/halo-desk.png"
cat > "$app/AppRun" <<'LAUNCHER'
#!/bin/sh
exec "${APPDIR:-$(dirname "$(readlink -f "$0")")}/usr/bin/halo-desk" "$@"
LAUNCHER
chmod 755 "$app/AppRun"
ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$tool" --runtime-file "$runtime" "$app" "dist/halo-desk-$version-linux-x86_64.AppImage"
