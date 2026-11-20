#!/usr/bin/env bash
set -euo pipefail
version="$1"
arch="$2"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
app="$stage/Halo Desk.app"
mkdir -p "$app/Contents/"{MacOS,Resources} "$stage/Halo.iconset" dist
install -m 755 target/release/halo-desk "$app/Contents/MacOS/halo-desk"
for size in 16 32 128 256; do
  sips -z "$size" "$size" assets/icon.png --out "$stage/Halo.iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" assets/icon.png --out "$stage/Halo.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
cp assets/icon.png "$stage/Halo.iconset/icon_512x512.png"
sips -z 1024 1024 assets/icon.png --out "$stage/Halo.iconset/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$stage/Halo.iconset" -o "$app/Contents/Resources/Halo.icns"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>io.halodesk.desktop</string>
  <key>CFBundleName</key><string>Halo Desk</string>
  <key>CFBundleDisplayName</key><string>Halo Desk</string>
  <key>CFBundleExecutable</key><string>halo-desk</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>Halo.icns</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
rm -r "$stage/Halo.iconset"
codesign --force --sign - "$app"
codesign --verify --strict "$app"
ln -s /Applications "$stage/Applications"
hdiutil create -ov -volname "Halo Desk" -srcfolder "$stage" -format UDZO "dist/halo-desk-$version-mac-$arch.dmg"
