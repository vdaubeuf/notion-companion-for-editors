# État du projet

*Mis à jour le 2 octobre 2026 — version 0.3.0 (édition, onglets, plusieurs comptes).*

Ce document sépare ce qui a été **vérifié en conditions réelles**, ce qui ne l'a été **que par des tests automatiques**, et ce qui **reste à tester**. Il sert aussi de liste des points à revoir ensemble (interface, comportements).

## Vérifié en conditions réelles

Configuration de test : macOS, DaVinci Resolve Studio 21.1.0 (build 14), Premiere Pro 26.5.1.

### Version 0.3.0-beta.1 — retours du 2 octobre 2026 (macOS et Windows)

- **DaVinci Resolve**, macOS et Windows : rien à signaler (retour de l'utilisateur, sans le détail des fonctions essayées).
- **Premiere Pro**, macOS et Windows : panneau ouvert, page affichée, menu ••• ouvert. Deux défauts d'affichage, corrigés dans la 0.3.0 (confirmé dans Premiere le 2 octobre) :
  - icônes collées au texte (pastille de l'en-tête, icône de la page, menu) et pastille décalée par rapport à « Notion connecté » : le moteur UXP de Premiere n'applique pas `gap` dans les mises en page flex. Les espacements sont refaits avec des marges dans `hosts/premiere/premiere.css` ;
  - texte « Ajouter une page (onglet 2/4) » qui sort du menu : UXP ne dimensionne pas le menu (positionné en absolu) selon son contenu. Largeur fixe, libellés renvoyés à la ligne si besoin.

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

`./scripts/test.sh` : 37 tests.

- Règles d'association : identifiant, emplacement exact (Premiere), repli par nom (Resolve), suggestions, séparation des deux logiciels.
- Migrations de format.
- Client Notion : retries, `Retry-After`, délais dépassés, erreurs.
- Chargement récursif des pages.
- Validation des opérations et masquage des tokens.
- Syntaxe des bundles, versions des manifestes.
- Édition : report d'une modification de texte sur le texte enrichi (styles et liens conservés), découpage à 2000 caractères, requêtes `PATCH` / `DELETE` envoyées, annulation à l'écran si Notion refuse (403 → message dédié).
- Onglets : 4 pages au maximum, doublons refusés, onglet actif, migration v2 → v3.
- Comptes : reprise du token de la v0.2 comme compte par défaut, ajout, dédoublonnage (même intégration), remplacement, retrait ; chaque recherche / page utilise le token de son compte ; aucun token dans l'état envoyé à l'interface.
- Liste des opérations identique entre `core/operations.js` et `preload.js` (Resolve).

L'interface commune a aussi été testée dans Chromium avec le vrai contrôleur et une **fausse API Notion en mémoire** (scénarios : cocher une to-do, modifier un texte, Échap, supprimer un bloc, refus 403 ; ajouter / changer / retirer des onglets ; ajouter un second compte et une page d'un autre workspace). Ce banc d'essai n'est pas livré. **Rien de cela n'a encore été essayé contre la vraie API Notion, ni dans Resolve ou Premiere.**

Le panneau Premiere a aussi été rendu dans Chromium, avec des bouchons de test à la place des modules Adobe. Ces bouchons ne sont pas livrés et le test ne remplace pas un essai dans Premiere.

## À tester

### Nouveautés (édition, onglets, comptes) — dans les deux logiciels

- [ ] Cocher / décocher une to-do avec un vrai Personal Access Token : Notion accepte-t-il l'écriture avec la capacité « Notion API » ?
- [ ] Modifier un texte avec gras / lien au milieu : la mise en forme est-elle conservée dans Notion ?
- [ ] Supprimer un bloc : il apparaît bien dans la corbeille Notion.
- [ ] Zone de saisie (`textarea`) dans UXP : focus, Entrée / Échap, hauteur automatique.
- [ ] Onglets dans un panneau étroit (Premiere ancré), 4 onglets.
- [ ] Deux workspaces : recherche avec le sélecteur, page de l'autre workspace en onglet.
- [ ] Migration réelle : données de la v0.2 (associations + token) relues sans rien ressaisir.

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

## Prochaines étapes prévues

- **UI / UX** : passe de design à faire ensemble (voir les points ci-dessus).
- **Installation macOS sans autorisation dans les réglages du système** (demande du 2 octobre). Aujourd'hui, macOS bloque les fichiers `.command` téléchargés (clic droit → Ouvrir, ou autorisation dans Réglages Système). Piste à vérifier : un installeur `.pkg` signé avec un certificat Developer ID d'Apple et notarisé (compte Apple Developer payant). Je ne sais pas encore si cela suffit pour un plugin Resolve, ni ce que cela change pour le `.ccx` Premiere.
- **Mise à jour sans désinstaller** (demande du 2 octobre). Resolve : l'installeur remplace déjà le dossier du plugin. Premiere : passer de la 0.3.0-beta.1 à la 0.3.0 a demandé de désinstaller d'abord ; les deux portaient le même numéro interne (0.3.0), cause probable mais non vérifiée. Pistes : un numéro de manifeste toujours plus grand à chaque publication (pré-releases comprises), et un installeur qui retire l'ancienne version avant d'installer la nouvelle si l'installeur Adobe le permet.
- **Tests réels** de la 0.3.0 : liste « À tester » ci-dessus. Affichage Premiere corrigé : confirmé par l'utilisateur le 2 octobre.
- Ajout de blocs depuis le panneau (nouvelle ligne, nouvelle to-do).

## Évolutions envisagées

### Google Docs / Google Drive — mis de côté pour l'instant

Afficher un Google Doc dans un onglet, comme une page Notion, est techniquement possible : le format des associations prévoit déjà une `source` et un compte par page, et le rendu commun pourrait afficher un document converti. Ce n'est pas prévu pour l'instant, par simplicité, car cela impose des contraintes côté Google :

- **Projet Google Cloud obligatoire**, géré par l'éditeur du plugin (une seule fois, pas par chaque utilisateur) : écran de consentement OAuth, client OAuth de type « Application de bureau », API Google Docs activée. Contrairement à Notion, il n'existe pas de simple token personnel à coller pour lire des documents privés.
- **Validation de l'application par Google** : la lecture des documents (`documents.readonly`) est une autorisation classée « sensible ». Sans validation, les utilisateurs voient un avertissement « application non validée ». En mode « Test », l'accès est limité à 100 comptes déclarés, et les connexions expirent au bout de 7 jours (il faut se reconnecter chaque semaine). Lister ou rechercher les fichiers Drive demanderait des autorisations Drive dites « restreintes », avec une évaluation de sécurité en plus.
- **Premiere Pro** : la connexion Google d'une application de bureau repose sur une redirection vers un petit serveur local (`127.0.0.1`). À ma connaissance, un panneau UXP ne peut pas en ouvrir. Le flux « appareil » de Google (code à saisir sur une autre page) n'accepte pas les autorisations Docs / Drive. La fonction serait donc d'abord limitée à Resolve.
- Maintenance : jetons Google à rafraîchir et à révoquer, conversion du format Google Docs à suivre.

Ces points n'ont pas pu être revérifiés sur la documentation officielle de Google au moment de la rédaction (accès bloqué depuis l'environnement de travail). À reconfirmer avant de s'y lancer, à partir de la documentation Google : [OAuth 2.0 pour les applications de bureau](https://developers.google.com/identity/protocols/oauth2/native-app).
