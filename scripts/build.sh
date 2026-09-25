#!/bin/bash
# Builds both host plugins from core/ + hosts/ into build/:
#   build/resolve/   DaVinci Resolve Workflow Integration folder (Electron)
#   build/premiere/  Premiere Pro UXP plugin folder (packaged as .ccx by package.sh)
# Requirements: bash, python3 (macOS / Linux / GitHub Actions). No Node.js.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(sed -n "s/.*PLUGIN_VERSION: *'\([^']*\)'.*/\1/p" "$REPO_DIR/core/constants.js" | head -1)"
BUILD="$REPO_DIR/build"
[ -n "$VERSION" ] || { echo "Version introuvable dans core/constants.js" >&2; exit 1; }

rm -rf "$BUILD"
mkdir -p "$BUILD/resolve" "$BUILD/premiere"

copy_tree() { # <src> <dest> [tar excludes...]
    local src="$1" dest="$2"; shift 2
    mkdir -p "$dest"
    ( cd "$src" && tar --exclude='.DS_Store' "$@" -cf - . ) | ( cd "$dest" && tar -xf - )
}

set_version() { # <file> : rewrites the version field of a manifest
    python3 - "$1" "$VERSION" <<'EOF'
import json, re, sys
path, version = sys.argv[1], sys.argv[2]
text = open(path, encoding='utf-8').read()
numeric = version.split('-')[0]  # host manifests require x.y.z
if path.endswith('.xml'):
    text = re.sub(r'<Version>[^<]*</Version>', f'<Version>{numeric}</Version>', text)
else:
    data = json.loads(text)
    data['version'] = version if path.endswith('package.json') else numeric
    text = json.dumps(data, indent=2, ensure_ascii=False) + '\n'
open(path, 'w', encoding='utf-8').write(text)
EOF
}

# ---------- DaVinci Resolve (Electron)
R="$BUILD/resolve"
cp "$REPO_DIR/hosts/resolve/"{main.js,preload.js,manifest.xml,package.json} "$REPO_DIR/LICENSE" "$R/"
copy_tree "$REPO_DIR/hosts/resolve/host" "$R/host"
copy_tree "$REPO_DIR/hosts/resolve/icons" "$R/icons"
# Shared code, resolved by require('core/...') from the main process.
copy_tree "$REPO_DIR/core" "$R/node_modules/core" --exclude='./ui'
mkdir -p "$R/renderer"
cp "$REPO_DIR/hosts/resolve/renderer/index.html" "$REPO_DIR/core/ui/styles.css" "$R/renderer/"
python3 "$REPO_DIR/scripts/bundle.py" "$REPO_DIR/core/ui/app.js" "$R/renderer/ui.bundle.js"
set_version "$R/manifest.xml"
set_version "$R/package.json"

# ---------- Premiere Pro (UXP)
P="$BUILD/premiere"
cp "$REPO_DIR/hosts/premiere/"{index.html,manifest.json,premiere.css} "$P/"
cp "$REPO_DIR/core/ui/styles.css" "$REPO_DIR/LICENSE" "$P/"
copy_tree "$REPO_DIR/hosts/premiere/icons" "$P/icons"
python3 "$REPO_DIR/scripts/bundle.py" "$REPO_DIR/hosts/premiere/host/main.js" "$P/panel.bundle.js"
set_version "$P/manifest.json"

echo "✓ Build $VERSION : build/resolve, build/premiere"
