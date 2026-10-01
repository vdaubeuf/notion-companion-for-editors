# Changelog

## Non publié

- **Modifier la page depuis le panneau** : cocher / décocher les to-do ; en mode édition (crayon), modifier le texte d'un bloc et supprimer des blocs (corbeille Notion, avec confirmation). La mise en forme hors du passage modifié est conservée. En cas de refus de Notion, la modification est annulée à l'écran.
- **1 à 4 pages par projet**, affichées en onglets ; l'onglet actif est mémorisé par projet.
- **Plusieurs comptes Notion** (un token par workspace) ; chaque page retient son compte. Le token de la v0.2 devient le compte par défaut, sans rien ressaisir.
- Flèches des titres dépliables alignées sur le texte du titre.
- Associations migrées automatiquement au format v3.

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
