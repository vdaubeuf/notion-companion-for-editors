#!/bin/bash
# Installs Notion Companion as a DaVinci Resolve Workflow Integration (macOS).
#
# - copies ./plugin to "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.saparenprod.notioncompanion"
# - copies WorkflowIntegration.node from the Resolve installation on this machine
#   (Developer/Workflow Integrations/Examples/SamplePlugin/, as recommended by Blackmagic's README)
#
# Usage: ./scripts/install.sh
set -euo pipefail

PLUGIN_ID="com.saparenprod.notioncompanion"
RESOLVE_SUPPORT="/Library/Application Support/Blackmagic Design/DaVinci Resolve"
PLUGINS_DIR="$RESOLVE_SUPPORT/Workflow Integration Plugins"
DEST="$PLUGINS_DIR/$PLUGIN_ID"
NODE_MODULE="$RESOLVE_SUPPORT/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_DIR/plugin"

echo "Notion Companion — installation"
echo

if [ ! -d "$RESOLVE_SUPPORT" ]; then
    echo "✗ DaVinci Resolve ne semble pas installé ($RESOLVE_SUPPORT introuvable)." >&2
    exit 1
fi
if [ ! -f "$NODE_MODULE" ]; then
    echo "✗ WorkflowIntegration.node introuvable :" >&2
    echo "  $NODE_MODULE" >&2
    echo "  (installé avec DaVinci Resolve Studio, dossier Developer)." >&2
    exit 1
fi
if [ ! -f "$SRC/manifest.xml" ]; then
    echo "✗ Dossier plugin introuvable : $SRC" >&2
    exit 1
fi

# The Resolve support folder is usually world-writable; fall back to sudo otherwise.
SUDO=""
if ! mkdir -p "$PLUGINS_DIR" 2>/dev/null || [ ! -w "$PLUGINS_DIR" ]; then
    echo "Droits administrateur nécessaires pour écrire dans $PLUGINS_DIR"
    SUDO="sudo"
    $SUDO mkdir -p "$PLUGINS_DIR"
fi

if pgrep -x "Resolve" >/dev/null 2>&1; then
    echo "⚠ DaVinci Resolve est ouvert : redémarrez-le après l'installation pour qu'il détecte le plugin."
fi

$SUDO rm -rf "$DEST"
$SUDO mkdir -p "$DEST"
# Copy the plugin (without dev leftovers such as a local WorkflowIntegration.node copy).
( cd "$SRC" && $SUDO tar --exclude='.DS_Store' --exclude='WorkflowIntegration.node' -cf - . ) | ( cd "$DEST" && $SUDO tar -xf - )
$SUDO cp "$NODE_MODULE" "$DEST/WorkflowIntegration.node"
# Files extracted from a downloaded zip carry the quarantine flag: not needed for a local plugin.
$SUDO xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo "✓ Installé dans : $DEST"
echo
echo "Ensuite : lancez DaVinci Resolve Studio → menu Workspace (Espace de travail) → Workflow Integrations → Notion Companion."
