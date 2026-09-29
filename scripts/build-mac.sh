#!/bin/sh
# Builds the macOS app for Apple Silicon and Intel, signs it ad hoc and packs it for a GitHub release:
#   dist/SessionDeck-<version>-mac-<arch>.tar.gz + dist/latest-mac-<arch>.yml (read by updater.js).
# Works on macOS (codesign) and on Linux (rcodesign, https://github.com/indygreg/apple-platform-rs).
# Ad hoc means no Apple Developer ID: Apple Silicon needs a valid signature to start the app at all,
# Gatekeeper still asks once on first launch (right-click > Open). tar instead of zip keeps the
# symlinks inside Electron Framework.framework intact.
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")

npx electron-builder --mac dir --arm64 --x64

for ARCH in arm64 x64; do
  if [ $ARCH = arm64 ]; then DIR=dist/mac-arm64; else DIR=dist/mac; fi
  APP="$DIR/SessionDeck.app"
  if command -v codesign >/dev/null; then codesign --force --deep --sign - "$APP"; else rcodesign sign "$APP"; fi
  FILE="SessionDeck-$VERSION-mac-$ARCH.tar.gz"
  tar -czf "dist/$FILE" -C "$DIR" SessionDeck.app
  SHA=$(node -e "process.stdout.write(require('crypto').createHash('sha512').update(require('fs').readFileSync(process.argv[1])).digest('base64'))" "dist/$FILE")
  printf "version: %s\npath: %s\nsha512: %s\n" "$VERSION" "$FILE" "$SHA" > "dist/latest-mac-$ARCH.yml"
  echo "dist/$FILE"
done
