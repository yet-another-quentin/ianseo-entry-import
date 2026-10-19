# Entry import (CSV/Excel) for IANSEO

[Français](#français) · English

IANSEO module that imports archery competition entries in bulk from a CSV or Excel export: SportRegions, Google Forms, HelloAsso, a home-made spreadsheet…

- **Mapping**: columns and values are mapped to IANSEO fields, with reusable profiles. The **SportRegions** profile is detected automatically.
- **License check before import**: every license is looked up in IANSEO's license database (presence, validity on the competition date, name/first name/sex).
- **Only clean rows are imported.** Rows in error or "to check" are fixed directly in the page:
  - search the license by name;
  - pick the session, the division (para included), the class and the target face;
  - import without database for a recent license;
  - set a row aside.
- **Target faces**: the face of the file ("Standard", "Trispot"…) is mapped to the face of the archer's category and sent to IANSEO, triple spots included. A missing or unknown face gets the default face, to check.
- **Full sessions**, per session of a row:
  - **waiting list**: not imported, holds no place; per session, by priority (high, normal, low) then registration date. **Enter** makes it ready for the next import. A banner shows the sessions with free places and archers waiting;
  - **propose another session**: the place is held in the proposed session until an answer date (3 days by default), without blocking the other rows. The proposal is emailed through the [Mailer](https://github.com/yet-another-quentin/ianseo-mailer) module, or its text is shown to send by hand. The answer is entered in the module: accepts, accepts and stays waiting for the full session, refuses (waiting list or removed). Without an answer by the date, the row is flagged.
- **Comments**: the archer's comment from the file is shown, and every row has a private note of the organiser.
- **Corrections are saved in the competition** and re-applied when an updated export is imported again.
- **Multiple sessions**: an archer may enter several sessions (`1, 3`, or several ticked columns) and gets one entry per session.
- **Import through IANSEO itself**: lines go through IANSEO's **List load** page (`Partecipants/ListLoad.php`). The module never writes to the archer tables.
- **Updates**: IANSEO administrators get new versions in one click, on the stable or nightly channel.
- **Language**: the interface is in French or English, following IANSEO's language.

Tested with IANSEO 2025-02-10 (FR rules).

## Installation

1. Download `EntryImport.zip` from the [latest release](https://github.com/yet-another-quentin/ianseo-entry-import/releases/latest).
2. Unzip it into IANSEO's `Modules/Custom/` folder, so that you get `Modules/Custom/EntryImport/index.php`.

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
4. **Check**: handle the "To fix" tab with **Fix** or **Set aside**. **Sessions…** puts a session of a row on the waiting list or proposes another one; the **Waiting list** and **Proposals** tabs follow them up.
5. **Import**: click **Import into IANSEO**. The List load report is shown.

Everything decided in the module (corrections, waiting list, proposals, notes) is kept in the competition and re-applied to the next export.

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
- **Stable**: push a `vX.Y.Z` tag. `.github/workflows/release.yml` runs the tests, writes the version into `version.json`, builds `EntryImport.zip` and creates the release.
- **Nightly**: `.github/workflows/nightly.yml` runs every night, or manually with *Run workflow*.

---

## Français

Module IANSEO qui importe en lot les inscriptions d'un concours de tir à l'arc à partir d'un export CSV ou Excel : SportRegions, Google Forms, HelloAsso, tableau maison…

- **Correspondance** : les colonnes et les valeurs sont associées aux champs IANSEO, avec des profils réutilisables. Le profil **SportRegions** est reconnu automatiquement.
- **Vérification des licences avant l'import** : chaque licence est cherchée dans la base des licences d'IANSEO (présence, validité à la date du concours, nom, prénom, sexe).
- **Seules les lignes sans problème sont importées.** Les lignes en erreur ou « à vérifier » se corrigent dans la page :
  - recherche de la licence par nom ;
  - choix du départ, de la division (para comprise), de la classe et du blason ;
  - import sans base pour une licence récente ;
  - possibilité d'écarter une ligne.
- **Blasons** : le blason du fichier (« Standard », « Trispot »…) est associé au blason de la catégorie de l'archer et envoyé à IANSEO, trispots compris. Un blason absent ou inconnu prend le blason par défaut, à vérifier.
- **Départs complets**, pour chaque départ d'une ligne :
  - **liste d'attente** : non importé, ne prend pas de place ; par départ, selon la priorité (haute, normale, basse) puis la date d'inscription. **Faire monter** le rend prêt pour le prochain import. Un bandeau signale les départs avec des places libres et des archers en attente ;
  - **proposer un autre départ** : la place est retenue sur le départ proposé jusqu'à une date de réponse (3 jours par défaut), sans bloquer les autres lignes. La proposition part par email avec le module [Mailer](https://github.com/yet-another-quentin/ianseo-mailer), ou son texte s'affiche pour l'envoyer soi-même. La réponse se saisit dans le module : accepte, accepte en restant en attente du départ complet, refuse (liste d'attente ou retiré). Sans réponse à la date, la ligne est signalée.
- **Commentaires** : le commentaire de l'archer présent dans le fichier est affiché, et chaque ligne a une note privée de l'organisateur.
- **Les corrections sont enregistrées dans la compétition** et réappliquées quand on importe à nouveau un export mis à jour.
- **Plusieurs départs** : un archer peut s'inscrire sur plusieurs départs (`1, 3`, ou plusieurs colonnes cochées) et obtient une entrée par départ.
- **Import par IANSEO lui-même** : les lignes passent par l'écran **Import liste** d'IANSEO. Le module n'écrit jamais dans les tables des archers.
- **Mises à jour** : un administrateur IANSEO installe les nouvelles versions en un clic, sur le canal stable ou nightly.
- **Langue** : l'interface est en français ou en anglais, selon la langue d'IANSEO.

### Installation

1. Télécharger `EntryImport.zip` depuis la [dernière release](https://github.com/yet-another-quentin/ianseo-entry-import/releases/latest).
2. Décompresser l'archive dans le dossier `Modules/Custom/` d'IANSEO, pour obtenir `Modules/Custom/EntryImport/index.php`. Les dossiers selon l'installation sont dans le tableau de la partie anglaise.
3. Ouvrir une compétition. Le module se trouve dans **Participants › Synchronisation › Import inscriptions (CSV/Excel)**.

### Utilisation

1. **Prérequis** : charger la base des licences (Participants › Synchronisation des compétiteurs) et définir les sessions de qualification.
2. **Fichier** : déposer l'export, vérifier le profil et les colonnes.
3. **Correspondance des valeurs** : associer départs et armes aux sessions et divisions IANSEO.
4. **Contrôle** : traiter l'onglet « À traiter » avec **Corriger** ou **Écarter**. **Départs…** met un départ d'une ligne en liste d'attente ou propose un autre départ ; les onglets **Liste d'attente** et **Propositions** en assurent le suivi.
5. **Import** : cliquer sur **Importer dans IANSEO**.

Tout ce qui est décidé dans le module (corrections, liste d'attente, propositions, notes) est conservé dans la compétition et réappliqué à l'export suivant.

### Mises à jour

- **Canaux** : l'administrateur choisit le canal en haut de la page du module.
  - **stable** : versions publiées par tag.
  - **nightly** : version construite chaque nuit à partir de `main`. À éviter en concours.
- **Installation automatique** : le bouton **Mettre à jour** télécharge la version et vérifie l'archive. Il sauvegarde la version actuelle dans le dossier temporaire du serveur puis remplace les fichiers. En cas d'échec, l'ancienne version est remise en place.
- **Installation manuelle** : décompresser la nouvelle archive par-dessus l'ancienne.
