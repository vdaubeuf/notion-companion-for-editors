# Removes the Premiere Pro panel (Windows).
$ErrorActionPreference = 'Stop'
$Upia = Join-Path ${env:CommonProgramFiles} 'Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe'
& $Upia /remove 'Notion Companion for Editors'
Write-Host 'Redémarrez Premiere Pro pour mettre à jour le menu.'
Read-Host 'Appuyez sur Entrée pour fermer'
