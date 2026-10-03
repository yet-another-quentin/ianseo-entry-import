# Import inscriptions (CSV/Excel) pour IANSEO

Module IANSEO qui importe en lot les inscriptions d'un concours de tir à l'arc à partir d'un export CSV ou Excel : SportRegions, Google Forms, HelloAsso, tableau maison…

- Les colonnes et les valeurs sont associées aux champs IANSEO, avec des profils réutilisables. Le profil **SportRegions** est reconnu automatiquement.
- Chaque licence est vérifiée dans la base des licences d'IANSEO avant l'import : présence, validité à la date du concours, nom, prénom et sexe.
- Les lignes en erreur ou « à vérifier » ne sont pas importées. On les corrige directement dans la page :
  - recherche de la licence par nom ;
  - choix du départ, de la division (y compris para) et de la classe ;
  - import sans base pour une licence récente ;
  - possibilité d'écarter une ligne.
- Les corrections sont enregistrées dans la compétition et réappliquées quand on importe à nouveau un export mis à jour.
- Un archer peut s'inscrire sur plusieurs départs (`1, 3`, ou plusieurs colonnes cochées) : il obtient une entrée par départ.
- L'import lui-même passe par l'écran **Import liste** d'IANSEO (`Partecipants/ListLoad.php`). Le module n'écrit jamais directement dans les tables des archers.
- Un administrateur IANSEO est prévenu des nouvelles versions et peut mettre le module à jour en un clic.

Testé avec IANSEO 2025-02-10 (règles FR).

## Installation

1. Télécharger `ImportInscriptions.zip` depuis la [dernière release](https://github.com/yet-another-quentin/ianseo-import-inscriptions/releases/latest).
2. Décompresser l'archive dans le dossier `Modules/Custom/` d'IANSEO. On doit obtenir `Modules/Custom/ImportInscriptions/index.php`.

| Installation | Dossier |
|---|---|
| Windows (XAMPP) | `C:\ianseo\htdocs\Modules\Custom\` |
| macOS (MAMP) | `/Applications/MAMP/htdocs/Modules/Custom/` |
| Linux | `/opt/ianseo/Modules/Custom/` ou `/var/www/ianseo/Modules/Custom/` |

3. Ouvrir une compétition. Le module apparaît dans **Participants › Synchronisation › Import inscriptions (CSV/Excel)**.

Les mises à jour d'IANSEO ne touchent pas au dossier `Modules/Custom/`, donc le module reste installé.

## Utilisation

1. **Prérequis** : la base des licences doit être chargée (Participants › Synchronisation des compétiteurs) et les sessions de qualification définies.
2. **Fichier** : déposer l'export. Le profil est détecté automatiquement ; on peut ajuster les colonnes, puis enregistrer ces réglages comme profil.
3. **Correspondance des valeurs** : associer chaque valeur de départ à une session IANSEO, et chaque arme à une division.
4. **Contrôle** : traiter les lignes de l'onglet « À traiter » avec **Corriger** ou **Écarter**.
5. **Import** : cliquer sur **Importer dans IANSEO**. Le compte rendu d'Import liste s'affiche.

Les blasons trispot ne passent pas par Import liste. La page les liste par départ, pour les reporter à la main.

## Mise à jour

- **Automatique** : un administrateur IANSEO voit un bandeau « Version x.y.z disponible ». Le bouton **Mettre à jour** télécharge la release, vérifie l'archive, sauvegarde l'ancienne version dans `Modules/Custom/ImportInscriptions.bak/` puis remplace les fichiers. En cas d'échec, l'ancienne version reste en place.
  - Conditions : l'extension PHP `zip`, un accès internet et un dossier `Modules/Custom/` modifiable par le serveur web.
- **Manuelle** : décompresser la nouvelle archive par-dessus l'ancienne, comme pour l'installation.

## Développement

```sh
node --test tests/*.test.js                      # logique (core.js)

# IANSEO de test sur http://localhost:8088/ (copie des sources IANSEO, modifiée par l'installation)
cd dev && IANSEO_DIR=/chemin/copie-ianseo docker compose up -d --build
```

La base de données de test se charge avec `Install/install.sql`. `Common/config.inc.php` pointe vers l'hôte `db`, avec l'utilisateur et le mot de passe `ianseo`.

| Fichier | Rôle |
|---|---|
| `ImportInscriptions/core.js` | logique pure : lecture, profils, contrôles, format Import liste |
| `ImportInscriptions/app.js` | interface |
| `ImportInscriptions/api.php`, `lib.php` | contexte de la compétition, base des licences, réglages, lecture Excel (PhpSpreadsheet fourni avec IANSEO), mise à jour |
| `ImportInscriptions/menu.php` | entrée de menu |

**Publier une version** : pousser un tag `vX.Y.Z`. La GitHub Action lance les tests, inscrit la version dans `version.json`, construit `ImportInscriptions.zip` et crée la release.
