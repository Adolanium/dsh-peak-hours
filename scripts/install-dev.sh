#!/bin/sh
# Link this checkout into a DSH profile so the plugin loads from source.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROFILE_DIR="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
PATCH="$PROFILE_DIR/cordis.patch.yml"
PACKAGE="dsh-peak-hours"

if [ ! -f "$PATCH" ]; then
  echo "No profile patch at $PATCH" >&2
  echo "Start DeepSeek Harness once, or set DSH_PROFILE_DIR to another profile." >&2
  exit 1
fi

for required in package.json lib/index.js lib/client.js cordis.patch.yml; do
  if [ ! -f "$ROOT/$required" ]; then
    echo "Not a complete plugin checkout: missing $required" >&2
    exit 1
  fi
done

mkdir -p "$PROFILE_DIR/node_modules"
ln -sfn "$ROOT" "$PROFILE_DIR/node_modules/$PACKAGE"

if grep -q "name: $PACKAGE" "$PATCH"; then
  echo "Loader entry already present in $PATCH"
else
  STAMP=$(date +%Y%m%d-%H%M%S)
  cp "$PATCH" "$PATCH.bak-$STAMP"
  printf '\n# %s development link (scripts/install-dev.sh)\n- insert:\n    - id: peak-hours\n      name: %s\n' "$PACKAGE" "$PACKAGE" >> "$PATCH"
  echo "Added the Loader entry to $PATCH (backup: $PATCH.bak-$STAMP)"
fi

echo
echo "Linked $ROOT"
echo "Next: restart DeepSeek Harness if the Host does not reload the patch, then refresh the window (Cmd+R)."
