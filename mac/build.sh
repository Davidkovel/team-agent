#!/bin/zsh
# Compila o "Agente AMG.app" e instala-o em /Applications.
set -e
cd "$(dirname "$0")"
APP="build/Agente AMG.app"
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" build/AppIcon.iconset

swiftc -O -o "$APP/Contents/MacOS/AgenteAMG" main.swift -framework Cocoa -framework WebKit

for s in 16 32 64 128 256 512 1024; do swift makeicon.swift mercedes-star.svg "build/icon_$s.png" $s; done
cp build/icon_16.png   build/AppIcon.iconset/icon_16x16.png
cp build/icon_32.png   build/AppIcon.iconset/icon_16x16@2x.png
cp build/icon_32.png   build/AppIcon.iconset/icon_32x32.png
cp build/icon_64.png   build/AppIcon.iconset/icon_32x32@2x.png
cp build/icon_128.png  build/AppIcon.iconset/icon_128x128.png
cp build/icon_256.png  build/AppIcon.iconset/icon_128x128@2x.png
cp build/icon_256.png  build/AppIcon.iconset/icon_256x256.png
cp build/icon_512.png  build/AppIcon.iconset/icon_256x256@2x.png
cp build/icon_512.png  build/AppIcon.iconset/icon_512x512.png
cp build/icon_1024.png build/AppIcon.iconset/icon_512x512@2x.png
iconutil -c icns build/AppIcon.iconset -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Agente AMG</string>
  <key>CFBundleDisplayName</key><string>Agente AMG</string>
  <key>CFBundleIdentifier</key><string>pt.amg.agente</string>
  <key>CFBundleExecutable</key><string>AgenteAMG</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>CFBundleURLTypes</key><array><dict>
    <key>CFBundleURLName</key><string>pt.amg.agente</string>
    <key>CFBundleURLSchemes</key><array><string>agenteamg</string></array>
  </dict></array>
</dict></plist>
PLIST

codesign --force --deep -s - "$APP"
pkill -x AgenteAMG 2>/dev/null || true
rm -rf "/Applications/Agente AMG.app"
cp -R "$APP" /Applications/
mkdir -p ~/.team-agent/mac && cp widget_mac.py ~/.team-agent/mac/
# O Mac corre o seu próprio Hub (widget_mac.py): o venv do widget precisa também do backend.
VENV=~/.team-agent/mac/venv
[ -x $VENV/bin/pip ] && $VENV/bin/pip install -q -r ~/.team-agent/mac/team-agent/backend/requirements.txt
echo "Instalado em /Applications/Agente AMG.app"
