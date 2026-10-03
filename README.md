# Entry import (CSV/Excel) for IANSEO

[Français](#français) · English

IANSEO module that imports archery competition entries in bulk from a CSV or Excel export: SportRegions, Google Forms, HelloAsso, a home-made spreadsheet…

- **Mapping**: columns and values are mapped to IANSEO fields, with reusable profiles. The **SportRegions** profile is detected automatically.
- **License check before import**: every license is looked up in IANSEO's license database (presence, validity on the competition date, name/first name/sex).
- **Only clean rows are imported.** Rows in error or "to check" are fixed directly in the page:
  - search the license by name;
  - pick the session, the division (para included) and the class;
  - import without database for a recent license;
  - set a row aside.
- **Corrections are saved in the competition** and re-applied when an updated export is imported again.
- **Multiple sessions**: an archer may enter several sessions (`1, 3`, or several ticked columns) and gets one entry per session.
- **Import through IANSEO itself**: lines go through IANSEO's **List load** page (`Partecipants/ListLoad.php`). The module never writes to the archer tables.
- **Updates**: IANSEO administrators get new versions in one click, on the stable or nightly channel.
- **Language**: the interface is in French or English, following IANSEO's language.

Tested with IANSEO 2025-02-10 (FR rules).

## Installation

1. Download `ImportInscriptions.zip` from the [latest release](https://github.com/yet-another-quentin/ianseo-import-inscriptions/releases/latest).
2. Unzip it into IANSEO's `Modules/Custom/` folder, so that you get `Modules/Custom/ImportInscriptions/index.php`.

   | Installation | Folder |
   |---|---|
   | Windows (XAMPP) | `C:\ianseo\htdocs\Modules\Custom\` |
   | macOS (MAMP) | `/Applications/MAMP/htdocs/Modules/Custom/` |
   | Linux | `/opt/ianseo/Modules/Custom/` or `/var/www/ianseo/Modules/Custom/` |

3. Open a competition. The module is in **Participants › Sync › Entry import (CSV/Excel)**.

IANSEO updates never touch `Modules/Custom/`, so the module stays installed.

## Usage

1. **Prerequisites**: load the license database (Participants › Athletes Sync.) and define the qualification sessions.
2. **File**: drop the export. The profile is detected; adjust the columns if needed and save them as a profile.
3. **Value mapping**: map each session value to an IANSEO session and each bow to a division.
4. **Check**: handle the "To fix" tab with **Fix** or **Set aside**.
5. **Import**: click **Import into IANSEO**. The List load report is shown.

Triple-spot target faces cannot go through List load: the page lists them per session, to enter by hand.

## Updates

- **Channels**: administrators choose the update channel at the top of the module page.
  - **stable**: tagged releases (`vX.Y.Z`).
  - **nightly**: daily build of `main`, published as the `nightly` pre-release when `main` has changed. Not for competitions.
- **Automatic install**: **Update** downloads the release and checks the archive. The current version is backed up in the server's temporary folder, then the files are replaced. If any step fails, the previous version is restored.
  - Requirements: the PHP `zip` extension, Internet access, and a module folder writable by the web server.
- **Manual install**: unzip the new archive over the old one.

## Development

```sh
node --test tests/*.test.js                                  # logic, translations, nightly versioning

# Test IANSEO on http://localhost:8088/ (IANSEO_DIR = a COPY of the IANSEO sources, it gets Common/config.inc.php)
cd dev && IANSEO_DIR=/path/to/ianseo-copy docker compose up -d --build && IANSEO_DIR=/path/to/ianseo-copy ./seed.sh
```

`seed.sh` loads the schema and creates the competition "TEST26" (FR indoor, 4 sessions, para divisions). It also adds fictitious licenses matching `tests/fixtures/sportregions.csv`. `Common/config.inc.php` must point to host `db`, with user and password `ianseo` and `ROOT_DIR='/'`.

**Releases**:
- **Stable**: push a `vX.Y.Z` tag. `.github/workflows/release.yml` runs the tests, writes the version into `version.json`, builds `ImportInscriptions.zip` and creates the release.
- **Nightly**: `.github/workflows/nightly.yml` runs every night, or manually with *Run workflow*.

---

## Français

Module IANSEO qui importe en lot les inscriptions d'un concours de tir à l'arc à partir d'un export CSV ou Excel : SportRegions, Google Forms, HelloAsso, tableau maison…

- **Correspondance** : les colonnes et les valeurs sont associées aux champs IANSEO, avec des profils réutilisables. Le profil **SportRegions** est reconnu automatiquement.
- **Vérification des licences avant l'import** : chaque licence est cherchée dans la base des licences d'IANSEO (présence, validité à la date du concours, nom, prénom, sexe).
- **Seules les lignes sans problème sont importées.** Les lignes en erreur ou « à vérifier » se corrigent dans la page :
  - recherche de la licence par nom ;
  - choix du départ, de la division (para comprise) et de la classe ;
  - import sans base pour une licence récente ;
  - possibilité d'écarter une ligne.
- **Les corrections sont enregistrées dans la compétition** et réappliquées quand on importe à nouveau un export mis à jour.
- **Plusieurs départs** : un archer peut s'inscrire sur plusieurs départs (`1, 3`, ou plusieurs colonnes cochées) et obtient une entrée par départ.
- **Import par IANSEO lui-même** : les lignes passent par l'écran **Import liste** d'IANSEO. Le module n'écrit jamais dans les tables des archers.
- **Mises à jour** : un administrateur IANSEO installe les nouvelles versions en un clic, sur le canal stable ou nightly.
- **Langue** : l'interface est en français ou en anglais, selon la langue d'IANSEO.

### Installation

1. Télécharger `ImportInscriptions.zip` depuis la [dernière release](https://github.com/yet-another-quentin/ianseo-import-inscriptions/releases/latest).
2. Décompresser l'archive dans le dossier `Modules/Custom/` d'IANSEO, pour obtenir `Modules/Custom/ImportInscriptions/index.php`. Les dossiers selon l'installation sont dans le tableau de la partie anglaise.
3. Ouvrir une compétition. Le module se trouve dans **Participants › Synchronisation › Import inscriptions (CSV/Excel)**.

### Utilisation

1. **Prérequis** : charger la base des licences (Participants › Synchronisation des compétiteurs) et définir les sessions de qualification.
2. **Fichier** : déposer l'export, vérifier le profil et les colonnes.
3. **Correspondance des valeurs** : associer départs et armes aux sessions et divisions IANSEO.
4. **Contrôle** : traiter l'onglet « À traiter » avec **Corriger** ou **Écarter**.
5. **Import** : cliquer sur **Importer dans IANSEO**.

Les blasons trispot sont à reporter à la main : la page les liste par départ.

### Mises à jour

- **Canaux** : l'administrateur choisit le canal en haut de la page du module.
  - **stable** : versions publiées par tag.
  - **nightly** : version construite chaque nuit à partir de `main`. À éviter en concours.
- **Installation automatique** : le bouton **Mettre à jour** télécharge la version et vérifie l'archive. Il sauvegarde la version actuelle dans le dossier temporaire du serveur puis remplace les fichiers. En cas d'échec, l'ancienne version est remise en place.
- **Installation manuelle** : décompresser la nouvelle archive par-dessus l'ancienne.
