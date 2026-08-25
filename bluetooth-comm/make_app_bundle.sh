#!/bin/sh
# make_app_bundle.sh
# Wraps an already-built CoreBluetooth CLI binary in the minimal .app bundle
# structure macOS needs to grant it Bluetooth permissions (TCC). Central-role
# scanning in particular has been observed silently delivering zero results
# from a bare, unbundled binary even after CBCentralManager reports
# poweredOn - wrapping it like this gives the OS a proper place to prompt
# for and record the permission grant.
#
# Usage: ./make_app_bundle.sh <built-binary> <AppName>
# Example: ./make_app_bundle.sh link_central SentinelCentral
#   -> produces ./SentinelCentral.app, run it with:
#      ./SentinelCentral.app/Contents/MacOS/SentinelCentral

set -e

BIN="$1"
NAME="$2"

if [ -z "$BIN" ] || [ -z "$NAME" ]; then
    echo "Usage: $0 <built-binary> <AppName>" >&2
    exit 1
fi

if [ ! -x "$BIN" ]; then
    echo "Error: '$BIN' doesn't exist or isn't executable. Build it first." >&2
    exit 1
fi

APP="${NAME}.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

cp "$BIN" "$APP/Contents/MacOS/$NAME"
chmod +x "$APP/Contents/MacOS/$NAME"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>${NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>com.sentinel.${NAME}</string>
    <key>CFBundleName</key>
    <string>${NAME}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>NSBluetoothAlwaysUsageDescription</key>
    <string>${NAME} uses Bluetooth to run the Sentinel Link protocol test.</string>
    <key>NSBluetoothPeripheralUsageDescription</key>
    <string>${NAME} uses Bluetooth to run the Sentinel Link protocol test.</string>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
PLIST

echo "Built $APP"
echo "Run with: ./$APP/Contents/MacOS/$NAME"
echo "(First launch may prompt for Bluetooth permission - check System Settings > Privacy & Security > Bluetooth if it doesn't.)"
