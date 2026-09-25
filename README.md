# Notion Companion — DaVinci Resolve × Notion

Workflow Integration pour **DaVinci Resolve Studio** qui associe une page Notion à chaque projet Resolve et l'affiche automatiquement dans un panneau à côté de Resolve.

```
Projet Resolve A  →  Page Notion A
Projet Resolve B  →  Page Notion B
```

L'association se fait une fois. Ensuite, quand vous changez de projet dans Resolve, le panneau le détecte et charge la page correspondante.

- Plugin Electron officiel (Workflow Integration), sans dépendance npm ni étape de build : il utilise l'Electron fourni avec Resolve.
- API Notion officielle (`Notion-Version: 2026-03-11`) avec un **Personal Access Token**.
- Contenu Notion rendu dans une interface propre au plugin (pas d'iframe), avec cache local et mode hors ligne.
- macOS et Windows.

## Télécharger

Page **Releases** du dépôt → dernière version → téléchargez l'archive de votre système :

| Système | Archive | Installation |
|---|---|---|
| macOS | `NotionCompanion-<version>-macOS.zip` | Décompressez, puis **clic droit → Ouvrir** sur `Installer Notion Companion.command` (la première fois, macOS bloque le double-clic sur un script téléchargé). |
| Windows | `NotionCompanion-<version>-Windows.zip` | Clic droit → **Extraire tout**, puis double-clic sur `Installer Notion Companion.cmd` et acceptez la demande administrateur. Si SmartScreen s'affiche : *Informations complémentaires → Exécuter quand même*. |

Redémarrez ensuite DaVinci Resolve. Pour désinstaller : `Desinstaller Notion Companion` dans la même archive.

---

## Sommaire

1. [Prérequis](#1-prérequis)
2. [Installation](#2-installation)
3. [Créer le token Notion](#3-créer-le-personal-access-token-notion)
4. [Lancement et utilisation](#4-lancement-et-utilisation)
5. [Identification des projets Resolve](#5-identification-des-projets-resolve)
6. [Données locales et sécurité](#6-données-locales-et-sécurité)
7. [Architecture](#7-architecture)
8. [Debug](#8-debug)
9. [Désinstallation](#9-désinstallation)
10. [Limitations connues](#10-limitations-connues)
11. [Publier une version](#11-publier-une-version)
12. [Pistes futures](#12-pistes-futures)

---

## 1. Prérequis

| | |
|---|---|
| DaVinci Resolve | **Studio**, 20.1 ou plus récent (API « promise » des Workflow Integrations). Développé et testé sur **Studio 21.1.0 (build 14)**. Les Workflow Integrations ne sont pas disponibles dans la version gratuite. |
| Système | macOS (testé, Apple Silicon) ou Windows 10/11 (scripts fournis, **non testés sur machine réelle**). Linux : non supporté par Resolve pour les Workflow Integrations. |
| Notion | Un compte Notion avec accès aux « Developer features » pour créer un Personal Access Token. |
| Node.js | **Inutile.** |

Le plugin a besoin du module natif `WorkflowIntegration.node` de Blackmagic. Il **n'est pas inclus dans ce dépôt** : le script d'installation le copie depuis votre installation Resolve (`Developer/Workflow Integrations/Examples/SamplePlugin/`, emplacement recommandé par le README de Blackmagic).

## 2. Installation

### macOS

```bash
cd resolve-notion-companion
./scripts/install.sh
```

Le script copie `plugin/` dans :

```
/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.saparenprod.notioncompanion/
```

puis y ajoute `WorkflowIntegration.node`. Il demande `sudo` seulement si ce dossier n'est pas accessible en écriture.

### Windows

Dans PowerShell, à la racine du dépôt :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

Le script se relance en administrateur si nécessaire et installe dans :

```
%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.saparenprod.notioncompanion\
```

### Après l'installation

**Redémarrez DaVinci Resolve** : il ne recherche les plugins qu'au démarrage.

Pour une mise à jour, relancez simplement le script d'installation (fermez d'abord le panneau).

## 3. Créer le Personal Access Token Notion

1. Dans Notion : **Paramètres → Developer → Enable developer features**.
2. Dans la section **Developer** de la barre latérale : **Personal access tokens → New token**.
3. Donnez-lui un nom (ex. « Resolve Companion »), cochez la capacité **Notion API**, choisissez une expiration (7 jours à 1 an).
4. **Create token**, puis copiez-le. Il ne sera plus jamais affiché.

Documentation officielle : <https://developers.notion.com/guides/get-started/personal-access-tokens>

### Accès aux pages

Un Personal Access Token **agit en votre nom** : il voit toutes les pages auxquelles vous avez accès dans ce workspace. **Aucun partage supplémentaire n'est nécessaire.** Un token appartient à un seul workspace.

> Alternative : le token d'une **intégration interne** (créée dans la section Developer de Notion) fonctionne aussi. Dans ce cas, chaque page (ou page parente) doit être partagée avec l'intégration via **••• → Connexions → ajouter l'intégration**, sinon elle n'apparaîtra pas dans la recherche.

Quand le token expire, le panneau affiche « La connexion Notion a expiré ou le token n'est plus valide » : créez-en un nouveau et remplacez-le dans les paramètres.

## 4. Lancement et utilisation

1. Ouvrez un projet dans DaVinci Resolve Studio.
2. Menu **Workspace (Espace de travail) → Workflow Integrations → Notion Companion**.
3. Premier lancement : **⚙ Paramètres → coller le token → Enregistrer et tester**. Le token est d'abord testé contre l'API, puis enregistré. `✓ Connecté à Notion` confirme.
4. De retour sur l'écran principal : **Associer une page Notion**. Tapez quelques lettres : les résultats s'affichent avec l'icône et la page parente (utile pour distinguer deux pages homonymes). Champ vide = pages modifiées récemment. Vous pouvez aussi **coller le lien d'une page Notion**. Flèches + Entrée au clavier.
5. La page s'affiche. L'association est enregistrée immédiatement.

### Écran principal

| Élément | Rôle |
|---|---|
| En-tête | Nom du projet Resolve, timeline active, état de Notion (pastille). |
| ↻ | Actualise : revérifie le projet Resolve et recharge la page depuis Notion. |
| Ancrer | Colle la fenêtre au bord droit (ou gauche) de l'écran où elle se trouve, pleine hauteur, au premier plan. Fonctionne aussi sur un second écran. Déplacer la fenêtre la détache. Choix du côté dans les paramètres. |
| Épingle | Garde la fenêtre au premier plan sans l'ancrer. |
| Ouvrir dans Notion | Ouvre la vraie page dans l'app Notion si elle est installée (`notion://`), sinon dans le navigateur. Réglable dans les paramètres. |
| ••• | Changer de page, Dissocier. |
| « Cache · il y a 5 min » | Le contenu affiché vient du cache local ; une actualisation est en cours ou a échoué. |

Quand la fenêtre reprend le focus, le panneau vérifie (au plus une fois par minute, via `last_edited_time`) si la page a changé dans Notion, et la recharge le cas échéant.

### Paramètres

Notion (tester, modifier, supprimer le token) · Associations (nombre, **Gérer les associations** : changer la page ou supprimer, pour n'importe quel projet) · DaVinci Resolve (version, stratégie d'identification) · Affichage (ancrage, premier plan, ouverture des liens) · Cache (taille, vider) · À propos (versions, dossier des logs).

### Blocs Notion affichés

Paragraphes, titres 1 à 4 (y compris titres dépliables), listes à puces et numérotées imbriquées, to-do, citations, callouts, séparateurs, code, équations (texte brut), toggles, tableaux, colonnes, blocs synchronisés, images, fichiers, PDF, vidéo et audio (en liens), signets et embeds (en liens), sous-pages et bases de données (liens vers Notion). Mise en forme : gras, italique, barré, souligné, code inline, couleurs, liens, mentions.

Un bloc non supporté affiche un encart générique avec un lien « ouvrir dans Notion », sans jamais provoquer d'erreur.

Les enfants (`has_children`) sont récupérés récursivement, en largeur d'abord, avec pagination complète. Le haut de la page s'affiche dès le premier lot. Au-delà de 3000 blocs ou 8 niveaux, l'affichage est tronqué avec un lien vers Notion. Les sous-pages ne sont jamais parcourues.

Les **to-do sont en lecture seule** en v0.1. Le rendu accepte déjà un callback `onTodoToggle` (`src/renderer/components/blocks.js`) pour brancher plus tard l'écriture vers Notion (`PATCH /v1/blocks/{id}`).

## 5. Identification des projets Resolve

Méthodes utilisées, toutes vérifiées dans la documentation installée avec Resolve 21.1 (`Developer/Scripting/DaVinciResolveScript.pyi` et `Developer/Workflow Integrations/README.txt`) :

| Appel | Usage |
|---|---|
| `WorkflowIntegration.InitializePromise(pluginId)`, `GetResolvePromise()`, `SetAPITimeout()`, `RegisterCallback('ResolveQuit')`, `CleanUp()` | Cycle de vie du plugin. |
| `Resolve.GetProjectManager()`, `GetVersionString()` | |
| `ProjectManager.GetCurrentProject()`, `GetCurrentDatabase()`, `GetCurrentFolder()` | |
| `Project.GetName()`, **`Project.GetUniqueId()`**, `GetCurrentTimeline()` | |
| `Timeline.GetName()` | |

**Stratégie principale : `Project.GetUniqueId()`.** La méthode est documentée (« Returns a unique ID for the project item ») et sa présence est détectée à l'exécution. L'association suit alors le projet même s'il est **renommé** ou déplacé de dossier.

**Repli**, si la méthode est absente ou renvoie une valeur vide : *type de base + nom de base + nom du projet*. Le dossier Resolve est mémorisé à titre d'information mais n'entre pas dans la clé : `GetCurrentFolder()` renvoie le dossier *parcouru* dans le Project Manager, qui peut changer sans que le projet change.

Règles de correspondance (`src/storage/associations.js`) :

1. **Même UID** : correspondance ; le nom, la base et le dossier enregistrés sont mis à jour.
2. **Un des deux côtés sans UID, même base et même nom** : correspondance, puis réassociation automatique à l'UID dès qu'il est connu.
3. **Même nom mais UID différent** (projet réimporté ou restauré, ou deux projets homonymes dans des dossiers différents) : **suggestion** seulement. Le panneau propose « Utiliser cette page » sans rien décider à votre place.

**Détection du changement de projet** : Resolve n'expose aucun événement de changement de projet aux Workflow Integrations (callbacks disponibles : `RenderStart`, `RenderStop`, `ResolveQuit`). Le panneau interroge donc Resolve **toutes les 1,5 s**, jamais deux requêtes à la fois, en mode asynchrone, et toutes les 5 s quand Resolve ne répond pas. La base et le dossier ne sont relus que lorsque le projet change.

**Limitation** : l'UID est lié à l'élément projet dans la base Resolve. Un projet exporté puis réimporté (`.drp`), restauré ou dupliqué reçoit un nouvel UID : c'est le cas 3, la suggestion.

## 6. Données locales et sécurité

Dossier de données :

- macOS : `~/Library/Application Support/Notion Companion/`
- Windows : `%APPDATA%\Notion Companion\`

| Fichier | Contenu |
|---|---|
| `associations.json` | Associations projet → page (`schemaVersion` + migrations). |
| `settings.json` | Préférences de la fenêtre. |
| `secrets.json` | Token Notion **chiffré**. |
| `cache/<pageId>.json` | Dernière version rendue de chaque page (60 pages max). |
| `logs/companion.log` | Journal développeur (rotation à 1 Mo). |

Écritures atomiques (fichier temporaire puis renommage). Un fichier corrompu est mis de côté (`*.corrupt-<date>`) au lieu d'être perdu.

Exemple d'association :

```json
{
  "schemaVersion": 1,
  "associations": {
    "uid:a1b2c3d4-…": {
      "resolveProjectUid": "a1b2c3d4-…",
      "resolveProjectName": "Mon documentaire",
      "resolveDatabase": { "type": "Disk", "name": "Local Database" },
      "resolveFolder": "Documentaires",
      "notionPageId": "…",
      "notionPageTitle": "Mon documentaire",
      "notionPageUrl": "https://www.notion.so/…",
      "notionPageIcon": { "type": "emoji", "emoji": "🎬" }
    }
  }
}
```

### Token

- Chiffré avec `safeStorage` d'Electron. Sous macOS, la clé est dans le **Trousseau** (entrée « … Safe Storage »). Sous Windows, le chiffrement passe par **DPAPI**, lié à votre compte. Si le chiffrement système est indisponible, le plugin **refuse** d'enregistrer le token plutôt que de l'écrire en clair.
- Le token n'existe en clair que dans le processus principal. Il n'est **jamais envoyé au renderer** : l'interface ne reçoit qu'un état (« connecté », nom d'utilisateur). Il ne figure ni dans le DOM, ni dans le code, ni dans le dépôt.
- Les logs masquent systématiquement le token enregistré, ainsi que tout motif `ntn_…`, `secret_…` ou `Bearer …`.

### Electron

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- API limitée exposée par `preload.js` via `contextBridge`.
- Chaque handler IPC vérifie l'expéditeur et valide ses arguments : format des ID de page, longueurs, liste blanche des réglages.
- Content-Security-Policy stricte : scripts locaux uniquement, aucun `connect-src`. Le renderer ne peut pas faire de requêtes réseau.
- Navigation et popups bloquées. Tous les liens passent par le processus principal, qui n'autorise que `https`, `http` et `mailto`. Toutes les permissions web sont refusées.
- Le contenu Notion est inséré uniquement comme texte (jamais `innerHTML`). Les URL d'images ou de fichiers non `https` sont écartées.

## 7. Architecture

```
plugin/                          ← dossier installé dans Resolve
  manifest.xml                   Id, nom, point d'entrée (lu par Resolve)
  main.js                        point d'entrée → src/main/app.js
  preload.js                     pont contextBridge (API renderer)
  src/
    main/        app.js          bootstrap, fenêtre sécurisée, menu
                 controller.js   orchestration projet → association → contenu
                 ipc.js          handlers IPC + validation
                 dock.js         mode ancré (bord d'écran)
                 logger.js       logs avec masquage des secrets
                 constants.js
    resolve/     bridge.js       wrapper WorkflowIntegration.node
                 projectWatcher.js  surveillance du projet actif (polling léger)
                 identity.js     stratégie d'identification (pure, testée)
    notion/      client.js       HTTP : file d'attente 3 req/s, retries, Retry-After, timeouts
                 pages.js        recherche, page, titres, icônes, parents
                 blocks.js       normalisation des blocs → modèle d'affichage
                 loader.js       chargement récursif progressif et annulable
                 errors.js       codes d'erreur → messages utilisateur
                 ids.js
    storage/     jsonStore.js    JSON versionné, écriture atomique, migrations
                 associations.js · secrets.js · settings.js · cache.js
    renderer/    index.html · styles.css · app.js
                 components/     header, pageView, blocks, search, settings, associations, icons, dom
scripts/         install / uninstall (macOS .sh, Windows .ps1), test.sh, dev-run.sh
tests/           tests unitaires (exécutés par Electron)
```

Côté Notion, les appels passent par `net.fetch`, la pile réseau de Chromium, qui respecte le proxy système. Codes gérés :

- **401** : token invalide ou expiré.
- **403** : accès refusé.
- **404** : page supprimée ou non partagée.
- **Page dans la corbeille** (`in_trash`).
- **429 / 529** : attente `Retry-After`. Pas de nouvel essai si Notion signale `public_api_request_blocked`.
- **5xx** : backoff exponentiel.
- **Erreurs réseau et délais dépassés.**

Aucune trace technique n'est affichée à l'utilisateur ; les détails vont dans le log.

## 8. Debug

**Logs** : Paramètres → À propos → *Ouvrir le dossier des logs*, ou :

```bash
tail -f ~/Library/Application\ Support/Notion\ Companion/logs/companion.log
```

On y trouve la connexion à Resolve, la stratégie d'identification, les changements de projet, les requêtes Notion (méthode, chemin, statut, durée), sans jamais de token.

**DevTools** : fenêtre du panneau active, menu **Affichage → Outils de développement** (`⌥⌘I` sur macOS, `Ctrl+Shift+I` sur Windows). **Affichage → Recharger l'interface** recharge le renderer.

**Hors de Resolve** (travail sur l'interface ou sur la partie Notion) :

```bash
NOTION_COMPANION_DEVTOOLS=1 ./scripts/dev-run.sh
```

Le panneau utilise l'Electron de Resolve. Sans Resolve comme hôte, `InitializePromise` échoue, et le panneau affiche « Resolve inaccessible » (rien n'est simulé). `NOTION_COMPANION_USER_DATA=/chemin` utilise un autre dossier de données.

**Tests** :

```bash
./scripts/test.sh
```

**Problèmes fréquents**

| Symptôme | Cause / solution |
|---|---|
| « Notion Companion » absent du menu Workflow Integrations | Resolve n'a pas été redémarré, version gratuite de Resolve, ou dossier mal placé : relancer l'installation. |
| « Module WorkflowIntegration.node introuvable » | Relancer le script d'installation (il le copie depuis Resolve). |
| « Resolve inaccessible » dans Resolve | Une fenêtre modale Resolve bloque l'API ; fermez-la, le panneau réessaie tout seul. Sinon, consultez le log. |
| Token refusé | Token incomplet, expiré, ou capacité « Notion API » non cochée. |
| Page introuvable dans la recherche | Avec un token d'intégration (et non un PAT), la page doit être partagée avec l'intégration. |
| Image « lien expiré » | Les fichiers hébergés par Notion expirent après environ 1 h : ↻ Actualiser. |

## 9. Désinstallation

macOS :

```bash
./scripts/uninstall.sh            # retire le plugin, conserve les données
./scripts/uninstall.sh --purge    # retire aussi associations, cache, logs et token
```

Windows :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1 [-Purge]
```

Redémarrez ensuite Resolve. Pensez aussi à **révoquer le token** dans Notion (Developer → Personal access tokens) si vous ne l'utilisez plus.

À la main : supprimez le dossier `com.saparenprod.notioncompanion` dans `Workflow Integration Plugins`, puis le dossier de données (voir §6).

## 10. Limitations connues

- **Pas de panneau intégré à l'interface de Resolve.** Une Workflow Integration s'ouvre toujours dans une fenêtre séparée (README Blackmagic), et aucune API publique ne permet d'ancrer un panneau tiers dans Resolve. Le mode **ancré** (bord d'écran, pleine hauteur, premier plan) ou un second écran sont les alternatives retenues.
- **Pas d'événement de changement de projet** : polling toutes les 1,5 s, avec un délai de détection d'environ 1,5 s maximum.
- **UID et réimport** : un projet réimporté, restauré ou dupliqué reçoit un nouvel UID ; le panneau propose alors l'ancienne page au lieu de l'associer d'office (§5).
- **To-do en lecture seule** en v0.1.
- **Équations** affichées en texte brut, sans rendu LaTeX.
- **Vidéos, PDF et embeds** proposés en liens.
- **Windows** : scripts et chemins conformes à la documentation Blackmagic, mais non testés sur une machine Windows réelle.

## 11. Publier une version

1. Mettez à jour la version dans `plugin/package.json` **et** `plugin/manifest.xml` (`<Version>`), puis ajoutez une section `## x.y.z` dans `CHANGELOG.md`.
2. Commitez, puis poussez un tag :

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. Le workflow GitHub Actions `.github/workflows/release.yml` vérifie les numéros de version, construit les deux archives (`scripts/package.sh`) et publie la Release avec les notes du CHANGELOG.

Pour construire les archives localement : `./scripts/package.sh` (résultat dans `dist/`).

## 12. Pistes futures

- **Plusieurs comptes / workspaces Notion** : plusieurs tokens enregistrés, et chaque association retient le compte à utiliser. Le format de `associations.json` est versionné avec migrations, ce qui prépare cet ajout.
- **Autres sources** (Google Drive, etc.) avec plusieurs comptes. La couche `src/notion/` est isolée du reste (Resolve, stockage, interface) et pourra devenir un fournisseur parmi d'autres.
- **To-do modifiables** avec écriture vers Notion (point d'extension `onTodoToggle` déjà en place).
