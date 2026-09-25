#!/bin/bash
# Re-renders assets/icon.svg into the PNG icons committed in the repo
# (Premiere panel icons, Resolve window icon, README). macOS, uses Resolve's Electron.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON="${ELECTRON:-/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Applications/.hidden/Electron.app/Contents/MacOS/Electron}"
"$ELECTRON" "$REPO_DIR/tools/render-icons" 2>&1 | grep -E '✓|Error' || true
