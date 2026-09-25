#!/bin/bash
# Launches the Resolve panel OUTSIDE Resolve, with Resolve's bundled Electron, to
# work on the UI / Notion side. Resolve features need the plugin to be started by
# Resolve itself (Workspace > Workflow Integrations); outside Resolve the header
# shows "DaVinci Resolve inaccessible" — nothing is simulated.
#
# Options (env vars):
#   NOTION_COMPANION_DEVTOOLS=1        open DevTools on start
#   NOTION_COMPANION_USER_DATA=<dir>   use another data folder (token, associations, cache)
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON="${ELECTRON:-/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Applications/.hidden/Electron.app/Contents/MacOS/Electron}"
NODE_MODULE="/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node"

"$REPO_DIR/scripts/build.sh" >/dev/null
# Local copy of the Blackmagic module (build/ is git-ignored) so require() works.
[ -f "$NODE_MODULE" ] && cp "$NODE_MODULE" "$REPO_DIR/build/resolve/WorkflowIntegration.node"
exec "$ELECTRON" "$REPO_DIR/build/resolve"
