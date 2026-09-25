#!/bin/bash
# Removes Notion Companion from DaVinci Resolve (macOS).
# Usage: ./scripts/uninstall.sh            -> removes the plugin only
#        ./scripts/uninstall.sh --purge    -> also removes associations, cache, logs and the stored token
set -euo pipefail

PLUGIN_ID="com.saparenprod.notioncompanion"
DEST="/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/$PLUGIN_ID"
USER_DATA="$HOME/Library/Application Support/Notion Companion"

if [ -d "$DEST" ]; then
    if [ -w "$(dirname "$DEST")" ]; then rm -rf "$DEST"; else sudo rm -rf "$DEST"; fi
    echo "✓ Plugin supprimé : $DEST"
else
    echo "Plugin non installé ($DEST absent)."
fi

if [ "${1:-}" = "--purge" ]; then
    rm -rf "$USER_DATA"
    echo "✓ Données supprimées : $USER_DATA"
    echo "  (Entrée éventuelle du Trousseau : ouvrez « Trousseaux d'accès » et cherchez « Safe Storage » si vous souhaitez aussi retirer la clé de chiffrement.)"
else
    echo "Données conservées : $USER_DATA  (utilisez --purge pour les supprimer)"
fi
echo "Redémarrez DaVinci Resolve pour que le menu soit mis à jour."
