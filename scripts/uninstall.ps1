# Removes Notion Companion from DaVinci Resolve (Windows).
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1 [-Purge]
#   -Purge also deletes associations, cache, logs and the stored (encrypted) token.

param([switch]$Purge)
$ErrorActionPreference = 'Stop'

$PluginId = 'com.saparenprod.notioncompanion'
$Dest     = Join-Path $env:PROGRAMDATA "Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\$PluginId"
$UserData = Join-Path $env:APPDATA 'Notion Companion'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    if ($Purge) { $argList += '-Purge' }
    Start-Process powershell -Verb RunAs -ArgumentList $argList
    exit
}

if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest; Write-Host "OK - plugin supprimé : $Dest" }
else { Write-Host "Plugin non installé ($Dest absent)." }

if ($Purge) {
    # %APPDATA% of the elevated user may differ if another admin account elevated the script.
    if (Test-Path $UserData) { Remove-Item -Recurse -Force $UserData; Write-Host "OK - données supprimées : $UserData" }
} else {
    Write-Host "Données conservées : $UserData  (option -Purge pour les supprimer)"
}
Write-Host 'Redémarrez DaVinci Resolve pour mettre à jour le menu.'
Read-Host 'Appuyez sur Entrée pour fermer'
