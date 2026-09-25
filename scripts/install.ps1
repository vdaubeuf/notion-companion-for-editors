# Installs Notion Companion for Editors as a DaVinci Resolve Workflow Integration (Windows).
#
# - copies the Resolve plugin (release archive: .\resolve\plugin) to %PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.saparenprod.notioncompanion
# - copies WorkflowIntegration.node from the local Resolve installation (Developer\Workflow Integrations\Examples\SamplePlugin)
#
# Usage (PowerShell):  powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
# Writing to %PROGRAMDATA% requires administrator rights: the script relaunches itself elevated if needed.

$ErrorActionPreference = 'Stop'

$PluginId   = 'com.saparenprod.notioncompanion'
$Support    = Join-Path $env:PROGRAMDATA 'Blackmagic Design\DaVinci Resolve\Support'
$PluginsDir = Join-Path $Support 'Workflow Integration Plugins'
$Dest       = Join-Path $PluginsDir $PluginId
$NodeModule = Join-Path $Support 'Developer\Workflow Integrations\Examples\SamplePlugin\WorkflowIntegration.node'
$RepoDir    = Split-Path -Parent $PSScriptRoot
$Src        = Join-Path $RepoDir 'resolve\plugin'
if (-not (Test-Path (Join-Path $Src 'manifest.xml'))) { $Src = Join-Path $RepoDir 'build\resolve' }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host 'Droits administrateur nécessaires, relance en mode élevé…'
    Start-Process powershell -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    exit
}

Write-Host 'Notion Companion for Editors — installation pour DaVinci Resolve'

if (-not (Test-Path $Support)) { throw "DaVinci Resolve ne semble pas installé ($Support introuvable)." }
if (-not (Test-Path $NodeModule)) {
    # Fallback: look for the module anywhere under the Developer folder.
    $found = Get-ChildItem -Path (Join-Path $Support 'Developer') -Filter 'WorkflowIntegration.node' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $found) { throw "WorkflowIntegration.node introuvable (installé avec DaVinci Resolve Studio, dossier Developer)." }
    $NodeModule = $found.FullName
}
if (-not (Test-Path (Join-Path $Src 'manifest.xml'))) { throw "Plugin Resolve introuvable : utilisez l'archive Windows de la page Releases ($Src)" }

if (Get-Process -Name 'Resolve' -ErrorAction SilentlyContinue) {
    Write-Warning "DaVinci Resolve est ouvert : redémarrez-le après l'installation."
}

New-Item -ItemType Directory -Force -Path $PluginsDir | Out-Null
if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item -Path (Join-Path $Src '*') -Destination $Dest -Recurse -Force -Exclude 'WorkflowIntegration.node', '.DS_Store'
Copy-Item -Path $NodeModule -Destination (Join-Path $Dest 'WorkflowIntegration.node') -Force

Write-Host "OK - installé dans : $Dest"
Write-Host 'Ensuite : DaVinci Resolve Studio > Workspace > Workflow Integrations > Notion Companion for Editors.'
Read-Host 'Appuyez sur Entrée pour fermer'
