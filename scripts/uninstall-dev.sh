#!/bin/sh
# Remove the development link and restore the profile manifest.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROFILE_DIR="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
MANIFEST="$PROFILE_DIR/package.json"
PACKAGE="dsh-peak-hours"

if [ -L "$PROFILE_DIR/node_modules/$PACKAGE" ]; then
  rm "$PROFILE_DIR/node_modules/$PACKAGE"
fi

if [ -f "$MANIFEST" ]; then
  node - "$MANIFEST" "$PACKAGE" <<'NODE'
const { readFileSync, writeFileSync } = require('node:fs')
const [manifestPath, packageName] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const bundles = manifest?.dsh?.profile?.bundles
if (Array.isArray(bundles)) {
  manifest.dsh.profile.bundles = bundles.filter((name) => name !== packageName)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}
NODE
fi

echo "Removed $PACKAGE from $PROFILE_DIR."
echo "Refresh the DeepSeek Harness window. The badge disappears after the reload."
