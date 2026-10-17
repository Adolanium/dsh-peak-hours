#!/bin/sh
# Remove the development link and its Loader entry.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROFILE_DIR="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
PATCH="$PROFILE_DIR/cordis.patch.yml"
PACKAGE="dsh-peak-hours"

if [ -L "$PROFILE_DIR/node_modules/$PACKAGE" ]; then
  rm "$PROFILE_DIR/node_modules/$PACKAGE"
fi

if [ -f "$PATCH" ]; then
  node - "$PATCH" "$PACKAGE" <<'NODE'
const { readFileSync, writeFileSync } = require('node:fs')
const [patchPath, packageName] = process.argv.slice(2)
let patch = readFileSync(patchPath, 'utf8')
const withComment = `\n# ${packageName} development link (scripts/install-dev.sh)\n- insert:\n    - id: peak-hours\n      name: ${packageName}\n`
const bare = `\n- insert:\n    - id: peak-hours\n      name: ${packageName}\n`
if (patch.includes(withComment)) patch = patch.replace(withComment, '')
else if (patch.includes(bare)) patch = patch.replace(bare, '')
writeFileSync(patchPath, patch)
NODE
fi

echo "Removed $PACKAGE from $PROFILE_DIR."
echo "Refresh the DeepSeek Harness window. The badge disappears after the reload."
