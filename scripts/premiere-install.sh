#!/bin/bash
# Installs the Premiere Pro panel (macOS) with Adobe's Unified Plugin Installer Agent,
# the same tool Creative Cloud uses when you double-click a .ccx file.
# Usage: ./scripts/premiere-install.sh [path/to/plugin.ccx]
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"

CCX="${1:-}"
if [ -z "$CCX" ]; then
    CCX="$(ls "$REPO_DIR"/*_premierepro.ccx "$REPO_DIR"/premiere/*_premierepro.ccx "$REPO_DIR"/dist/*_premierepro.ccx 2>/dev/null | head -1 || true)"
fi
if [ -z "$CCX" ] || [ ! -f "$CCX" ]; then
    echo "✗ Fichier .ccx introuvable (lancez ./scripts/package.sh ou utilisez l'archive de la page Releases)." >&2
    exit 1
fi
if [ ! -x "$UPIA" ]; then
    echo "✗ Installeur Adobe introuvable : installez l'application Creative Cloud, ou double-cliquez sur le fichier .ccx." >&2
    exit 1
fi

echo "Notion Companion for Editors — installation pour Premiere Pro"
"$UPIA" --install "$CCX"
echo
echo "Ensuite : (re)lancez Premiere Pro → menu Fenêtre → Plug-ins UXP → Notion Companion for Editors."
