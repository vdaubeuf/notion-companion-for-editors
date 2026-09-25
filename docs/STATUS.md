# État du projet

*Mis à jour le 25 septembre 2026 — version 0.2.0-beta.1.*

Ce document sépare ce qui a été **vérifié en conditions réelles**, ce qui ne l'a été **que par des tests automatiques**, et ce qui **reste à tester**. Il sert aussi de liste des points à revoir ensemble (interface, comportements).

## Vérifié en conditions réelles

Configuration de test : macOS, DaVinci Resolve Studio 21.1.0 (build 14), Premiere Pro 26.5.1.

### DaVinci Resolve — version 0.1.0

- Panneau ouvert depuis Workspace → Workflow Integrations.
- Connexion à Resolve, projet actif détecté, `Project.GetUniqueId()` disponible.
- Personal Access Token validé par Notion puis enregistré chiffré (Trousseau). Aucune trace du token dans les journaux.
- Association d'une page, affichage de la page, cache local.
- **Changement de projet détecté et page rechargée automatiquement** (confirmé par l'utilisateur).
- Mode ancré (bord droit, pleine hauteur) : vérifié hors Resolve.
- Base de projets PostgreSQL : l'association est bien liée à l'identifiant unique du projet.

### DaVinci Resolve — version 0.2.0 (réorganisation du code)

- Lancé hors Resolve sur une **copie** des données réelles : migration automatique des associations v1 → v2, token relu depuis le Trousseau, Notion connecté.

### Premiere Pro — sonde puis version 0.2.0

- Installation du `.ccx` avec l'installeur Adobe (UPIA).
  - Le manifeste doit déclarer `host` sous forme d'**objet**, sinon l'installation échoue avec l'erreur `-267`.
- API UXP disponibles dans Premiere 26.5.1 :
  - `require('premierepro')` avec `Project.getActiveProject()` (`guid`, `name`, `path`) et `ProjectEvent` (OPENED, CLOSED, DIRTY, ACTIVATED) ;
  - `fetch` vers l'API Notion, `secureStorage`, `shell.openExternal` ;
  - SVG, grille CSS, pseudo-élément `::before`.
- **Non disponibles** dans UXP : modules ES et `<details>`. D'où le bundler et les toggles faits en JavaScript.
- `Project.guid` **identique après redémarrage** de Premiere (Test.prproj, deux sessions).
- **Non stocké en clair** dans le fichier `.prproj`.
- Panneau 0.2.0 lancé dans Premiere : projet détecté, token validé et enregistré, passage de « Test » à « Test 2 » détecté.

## Vérifié uniquement par des tests automatiques

`./scripts/test.sh` : 29 tests.

- Règles d'association : identifiant, emplacement exact (Premiere), repli par nom (Resolve), suggestions, séparation des deux logiciels.
- Migrations de format.
- Client Notion : retries, `Retry-After`, délais dépassés, erreurs.
- Chargement récursif des pages.
- Validation des opérations et masquage des tokens.
- Syntaxe des bundles, versions des manifestes.

Le panneau Premiere a aussi été rendu dans Chromium, avec des bouchons de test à la place des modules Adobe. Ces bouchons ne sont pas livrés et le test ne remplace pas un essai dans Premiere.

## À tester

Au moment de la publication, les journaux ne montraient encore ni recherche ni association côté Premiere. La version 0.2.0 n'avait pas non plus été relancée dans Resolve.

### Premiere Pro

- [ ] Recherche de pages et association.
- [ ] Affichage d'une vraie page : blocs, toggles, images, listes numérotées, tableaux.
- [ ] Retour sur un projet associé : la page se recharge seule.
- [ ] Passage entre deux projets **déjà ouverts** (onglets) : est-il détecté en moins de 2 s ?
- [ ] « Ouvrir dans Notion » : app Notion, et confirmation de sécurité UXP la première fois.
- [ ] Rendu des icônes texte, des menus et de la zone de saisie du token (champ masqué ?).
- [ ] Redimensionnement du panneau ancré, largeur étroite.
- [ ] Mode hors ligne : cache affiché.
- [ ] Projet copié ou déplacé : l'ancienne page est-elle proposée ?

### DaVinci Resolve — version 0.2.0

- [ ] Nouveau nom dans le menu Workflow Integrations (après redémarrage de Resolve).
- [ ] Association « Documentaire Studio → Notes du documentaire » retrouvée sans rien refaire.
- [ ] Nouvelle icône dans le Dock.
- [ ] Toggles (désormais faits en JavaScript) et cases à cocher.

### Windows (aucun test réel pour l'instant)

- [ ] Installeur Resolve (`.cmd` → PowerShell en administrateur, copie de `WorkflowIntegration.node`).
- [ ] Installeur Premiere (double-clic sur le `.ccx`, ou `.cmd` → UPIA `/install`).
- [ ] Accents correctement affichés dans les fenêtres PowerShell.
- [ ] DPAPI pour le token Resolve ; `secureStorage` pour Premiere.

## Points à revoir ensemble

- Interface générale : densité, tailles de police, couleurs, lisibilité dans Premiere, dont le fond est plus clair que celui de Resolve.
- Icônes : glyphes texte dans Premiere (sûrs) ou SVG (plus fins) ? Le SVG se crée bien dans UXP, mais son rendu n'a pas été vérifié visuellement.
- Emplacement et libellé des actions (Ouvrir dans Notion, •••, ↻).
- Écran vide « Aucune page associée ».
- Nom affiché dans les menus : « Notion Companion for Editors » est long.
- Pistes futures : plusieurs tokens / workspaces Notion, Google Drive, to-do modifiables.
