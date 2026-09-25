#!/bin/bash
# Removes the Premiere Pro panel (macOS). Its data (associations, cache, token) is kept by Premiere's
# plugin storage; see README to delete it.
set -euo pipefail
UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"
"$UPIA" --remove "Notion Companion for Editors"
echo "Redémarrez Premiere Pro pour mettre à jour le menu."
