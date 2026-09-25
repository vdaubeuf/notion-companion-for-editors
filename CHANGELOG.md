# Changelog

## 0.2.0

Points encore à vérifier et prochaines étapes : [docs/STATUS.md](docs/STATUS.md).

**Notion Companion for Editors** : le plugin prend désormais en charge Adobe Premiere Pro en plus de DaVinci Resolve.

- Nouveau panneau **Premiere Pro** (UXP, Premiere 25.6+), ancrable dans l'interface, pour macOS et Windows.
- Détection du projet Premiere par événements (`ProjectEvent`) et identifiant `Project.guid`, repli sur le chemin du `.prproj`.
- Code réorganisé en un tronc commun (`core/`) et des adaptateurs par logiciel (`hosts/`).
- Nouvelle icône.
- Licence MIT.
- Associations existantes migrées automatiquement (format v2), token conservé.
- Archives de release : Resolve + Premiere dans chaque archive macOS / Windows, et le `.ccx` Premiere seul.

**Installation** : téléchargez l'archive de votre système, décompressez-la, puis lancez « Installer pour DaVinci Resolve » et/ou « Installer pour Premiere Pro » (voir le README). Sous macOS, première ouverture par clic droit → Ouvrir.

## 0.1.0

Première version.

- Panneau Workflow Integration pour DaVinci Resolve Studio (macOS et Windows).
- Détection du projet Resolve actif (`Project.GetUniqueId`, repli base + nom) et changement de projet automatique.
- Personal Access Token Notion chiffré par le système (Trousseau macOS / DPAPI Windows).
- Recherche de pages Notion, association projet ↔ page, gestion des associations.
- Rendu des principaux blocs Notion, chargement progressif, cache local et mode hors ligne.
- Mode ancré au bord de l'écran, fenêtre au premier plan.

**Installation** : téléchargez l'archive de votre système ci-dessous, décompressez-la, puis double-cliquez sur « Installer Notion Companion » (voir le README).
