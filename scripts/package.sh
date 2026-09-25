#!/bin/bash
# Builds the downloadable release files (run by the GitHub release workflow):
#   dist/NotionCompanionForEditors-<v>-macOS.zip     Resolve + Premiere installers for macOS
#   dist/NotionCompanionForEditors-<v>-Windows.zip   Resolve + Premiere installers for Windows
#   dist/NotionCompanionForEditors-<v>_premierepro.ccx  Premiere panel alone (macOS + Windows, double-click)
# WorkflowIntegration.node is NOT included: the Resolve installers copy it from
# the local DaVinci Resolve installation.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
"$REPO_DIR/scripts/build.sh"
VERSION="$(sed -n "s/.*PLUGIN_VERSION: *'\([^']*\)'.*/\1/p" "$REPO_DIR/core/constants.js" | head -1)"
DIST="$REPO_DIR/dist"
NAME="NotionCompanionForEditors-$VERSION"
CCX="${NAME}_premierepro.ccx"

rm -rf "$DIST"
mkdir -p "$DIST"

# ---------- Premiere .ccx (a zip of the UXP plugin folder, no signature needed)
( cd "$REPO_DIR/build/premiere" && zip -qr -X "$DIST/$CCX" . )

stage() { # <dir>
    local dir="$1"
    mkdir -p "$dir/resolve/plugin" "$dir/premiere" "$dir/scripts"
    ( cd "$REPO_DIR/build/resolve" && tar --exclude='.DS_Store' --exclude='WorkflowIntegration.node' -cf - . ) | ( cd "$dir/resolve/plugin" && tar -xf - )
    cp "$DIST/$CCX" "$dir/premiere/"
    cp "$REPO_DIR/README.md" "$REPO_DIR/LICENSE" "$dir/"
    mkdir -p "$dir/assets" && cp "$REPO_DIR/assets/icon-256.png" "$dir/assets/"
}

# ---------- macOS
MAC="$DIST/stage-mac/$NAME"
stage "$MAC"
cp "$REPO_DIR/scripts/"{install.sh,uninstall.sh,premiere-install.sh,premiere-uninstall.sh,build.sh} "$MAC/scripts/"
launcher() { # <file> <script> [args]
    printf '#!/bin/bash\n# Double-click (first time: right-click > Open, see README).\ncd "$(dirname "$0")" && ./scripts/%s %s\n' "$2" "${3:-}" > "$1"
    chmod +x "$1"
}
launcher "$MAC/Installer pour DaVinci Resolve.command" install.sh
launcher "$MAC/Desinstaller de DaVinci Resolve.command" uninstall.sh
launcher "$MAC/Installer pour Premiere Pro.command" premiere-install.sh
launcher "$MAC/Desinstaller de Premiere Pro.command" premiere-uninstall.sh
chmod +x "$MAC"/scripts/*.sh
( cd "$DIST/stage-mac" && zip -qry -X "$DIST/$NAME-macOS.zip" "$NAME" )

# ---------- Windows
WIN="$DIST/stage-win/$NAME"
stage "$WIN"
cp "$REPO_DIR/scripts/"{install.ps1,uninstall.ps1,premiere-install.ps1,premiere-uninstall.ps1} "$WIN/scripts/"
cmd() { # <file> <script>
    printf '@echo off\r\nrem Double-click to run %s\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%%~dp0scripts\\%s"\r\n' "$2" "$2" > "$1"
}
cmd "$WIN/Installer pour DaVinci Resolve.cmd" install.ps1
cmd "$WIN/Desinstaller de DaVinci Resolve.cmd" uninstall.ps1
cmd "$WIN/Installer pour Premiere Pro.cmd" premiere-install.ps1
cmd "$WIN/Desinstaller de Premiere Pro.cmd" premiere-uninstall.ps1
( cd "$DIST/stage-win" && zip -qr -X "$DIST/$NAME-Windows.zip" "$NAME" )

rm -rf "$DIST/stage-mac" "$DIST/stage-win"
echo "Fichiers de release :"
ls -1 "$DIST"
