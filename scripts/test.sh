#!/bin/bash
# Runs the unit tests with the Electron runtime bundled in DaVinci Resolve (macOS),
# or with ELECTRON=/path/to/electron if you prefer another Electron binary.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON="${ELECTRON:-/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Applications/.hidden/Electron.app/Contents/MacOS/Electron}"
if [ ! -x "$ELECTRON" ]; then
    echo "Electron introuvable : $ELECTRON (définissez ELECTRON=...)" >&2
    exit 1
fi
"$REPO_DIR/scripts/build.sh" > /dev/null
# Chromium prints a few harmless internal log lines: hide them.
"$ELECTRON" "$REPO_DIR/tests" 2>&1 | grep -v -E '^\[[0-9]+:[0-9]+/' || true
exit "${PIPESTATUS[0]}"
