#!/bin/bash
# Builds the downloadable installer archives:
#   dist/NotionCompanion-<version>-macOS.zip
#   dist/NotionCompanion-<version>-Windows.zip
# Each archive contains the plugin, the install/uninstall scripts for its
# platform, double-clickable launchers and the README.
# WorkflowIntegration.node is NOT included: the installers copy it from the
# local DaVinci Resolve installation.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$REPO_DIR/plugin/package.json" | head -1)"
DIST="$REPO_DIR/dist"
NAME="NotionCompanion-$VERSION"

rm -rf "$DIST"
mkdir -p "$DIST"

stage() {
    local dir="$1"
    mkdir -p "$dir/scripts"
    ( cd "$REPO_DIR" && tar --exclude='.DS_Store' --exclude='WorkflowIntegration.node' -cf - plugin ) | ( cd "$dir" && tar -xf - )
    cp "$REPO_DIR/README.md" "$dir/"
}

# ---------- macOS
MAC="$DIST/stage-mac/$NAME"
stage "$MAC"
cp "$REPO_DIR/scripts/install.sh" "$REPO_DIR/scripts/uninstall.sh" "$MAC/scripts/"
cat > "$MAC/Installer Notion Companion.command" <<'EOF'
#!/bin/bash
# Double-click to install (first time: right-click > Open, see README).
cd "$(dirname "$0")" && ./scripts/install.sh
EOF
cat > "$MAC/Desinstaller Notion Companion.command" <<'EOF'
#!/bin/bash
# Double-click to uninstall (keeps your associations; see README for --purge).
cd "$(dirname "$0")" && ./scripts/uninstall.sh
EOF
chmod +x "$MAC"/*.command "$MAC"/scripts/*.sh
( cd "$DIST/stage-mac" && zip -qry -X "$DIST/$NAME-macOS.zip" "$NAME" )

# ---------- Windows
WIN="$DIST/stage-win/$NAME"
stage "$WIN"
cp "$REPO_DIR/scripts/install.ps1" "$REPO_DIR/scripts/uninstall.ps1" "$WIN/scripts/"
printf '@echo off\r\nrem Double-click to install Notion Companion into DaVinci Resolve.\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%%~dp0scripts\\install.ps1"\r\n' > "$WIN/Installer Notion Companion.cmd"
printf '@echo off\r\nrem Double-click to uninstall (keeps your associations; see README for -Purge).\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%%~dp0scripts\\uninstall.ps1"\r\n' > "$WIN/Desinstaller Notion Companion.cmd"
( cd "$DIST/stage-win" && zip -qr -X "$DIST/$NAME-Windows.zip" "$NAME" )

rm -rf "$DIST/stage-mac" "$DIST/stage-win"
echo "Archives créées :"
ls -1 "$DIST"/*.zip
