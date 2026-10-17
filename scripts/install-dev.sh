#!/bin/sh
# Link this checkout into a DSH profile so the plugin loads from source.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROFILE_DIR="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
MANIFEST="$PROFILE_DIR/package.json"
PACKAGE="dsh-peak-hours"

if [ ! -f "$MANIFEST" ]; then
  echo "No profile manifest at $MANIFEST" >&2
  echo "Start DeepSeek Harness once, or set DSH_PROFILE_DIR to another profile." >&2
  exit 1
fi

mkdir -p "$PROFILE_DIR/node_modules"
ln -sfn "$ROOT" "$PROFILE_DIR/node_modules/$PACKAGE"

STAMP=$(date +%Y%m%d-%H%M%S)
cp "$MANIFEST" "$MANIFEST.backup-$STAMP"

node - "$MANIFEST" "$PACKAGE" <<'NODE'
const { readFileSync, writeFileSync } = require('node:fs')
const [manifestPath, packageName] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dsh = manifest.dsh || {}
manifest.dsh.profile = manifest.dsh.profile || {}
const bundles = manifest.dsh.profile.bundles || []
if (!bundles.includes(packageName)) bundles.push(packageName)
manifest.dsh.profile.bundles = bundles
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
NODE

echo "Linked $ROOT"
echo "Added $PACKAGE to $MANIFEST (backup: package.json.backup-$STAMP)"
echo
echo "Restart DeepSeek Harness, then refresh the window (Cmd+R) to load the badge."
