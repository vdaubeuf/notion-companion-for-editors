# Installs the Premiere Pro panel (Windows) with Adobe's Unified Plugin Installer Agent,
# the same tool Creative Cloud uses when you double-click a .ccx file.
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\premiere-install.ps1 [chemin\plugin.ccx]

param([string]$Ccx)
$ErrorActionPreference = 'Stop'
$RepoDir = Split-Path -Parent $PSScriptRoot
$Upia = Join-Path ${env:CommonProgramFiles} 'Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe'

if (-not $Ccx) {
    $found = Get-ChildItem -Path $RepoDir, (Join-Path $RepoDir 'premiere'), (Join-Path $RepoDir 'dist') -Filter '*_premierepro.ccx' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $Ccx = $found.FullName }
}
if (-not $Ccx -or -not (Test-Path $Ccx)) { throw 'Fichier .ccx introuvable (utilisez l''archive de la page Releases).' }
if (-not (Test-Path $Upia)) { throw 'Installeur Adobe introuvable : installez l''application Creative Cloud, ou double-cliquez sur le fichier .ccx.' }

Write-Host 'Notion Companion for Editors — installation pour Premiere Pro'
& $Upia /install $Ccx
Write-Host 'Ensuite : (re)lancez Premiere Pro > Fenêtre > Plug-ins UXP > Notion Companion for Editors.'
Read-Host 'Appuyez sur Entrée pour fermer'
