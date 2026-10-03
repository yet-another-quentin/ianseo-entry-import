# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

IANSEO module (archery competition management software) that imports entries in bulk from CSV/Excel (SportRegions export or any other). Code, identifiers and comments are in English. The UI is translated French/English (`EntryImport/i18n.js` for the page, `ii_t()` in `lib.php` for server messages). Data values in profiles (SportRegions column headers, French bow names) stay as they appear in the files.

## Commands

```sh
node --test tests/*.test.js                                  # all tests (the glob is required: `node --test tests/` fails on Node 24)
node --test --test-name-pattern="duplicate" tests/*.test.js  # a single test
```

Tests cover `core.js`, the dictionaries (same keys in fr/en, every key used by `core.js`/`app.js` exists) and `scripts/nightly-version.js`. PHP and UI are verified against a real IANSEO in `dev/`:

```sh
# IANSEO_DIR = a COPY of the IANSEO sources (it gets Common/config.inc.php: host db, user/password ianseo, ROOT_DIR='/').
cd dev && IANSEO_DIR=/path/to/copy docker compose up -d --build && IANSEO_DIR=/path/to/copy ./seed.sh   # http://localhost:8088/
```

- `seed.sh` loads `Install/install.sql`, opens the home page once (IANSEO upgrades its schema there; without it `TourOn.php` fails with "Unknown column"), creates competition TEST26 (FR rules, indoor type 6, sub-rule 4 = with para divisions), 4 sessions of 36 places, and licenses matching `tests/fixtures/sportregions.csv`.
- `MODULE_DIR` mounts another copy of the module instead of the sources: mandatory to test self-update, which overwrites the module folder. `version.json` may carry `"api": "http://host.docker.internal:PORT"` to point at a fake release server.
- The IANSEO language can be forced per request with `?Lang=fr` / `?Lang=en`.
- Reference IANSEO sources (2025-02-10) are in `../ianseo`, read-only.

## Architecture

**The module never writes to the archer tables.** The page builds "List load" lines and posts them to `Partecipants/ListLoad.php` (`txtList`, `TextList=1`, `OverwritePreviousArchers`); IANSEO imports and shows its own report. Keep it that way.

In `EntryImport/`:
- `index.php`: IANSEO page (`Common/Templates/head.php`/`tail.php`). It injects `window.II_CONTEXT` (`ii_context()` in `lib.php`):
  - language;
  - qualification sessions, divisions and classes of the competition (with `ClDivisionsAllowed`);
  - license count;
  - competition settings and corrections, user profiles;
  - admin flag and update channel.
- `core.js`: pure logic, UMD (`window.IICore` / `module.exports`). `readRecords` → `processRecords` (corrections, session/division/class resolution, checks, status `ok|warn|error|excluded`) → `toLine`.
  - Messages are `{k, p}` i18n keys, never text.
  - Only `ok` rows are sent.
  - `processRecords` only flags unknown licenses with `licensesChecked: true`; until then nothing may become `ok`.
- `app.js`: single state, full re-render via `innerHTML`. The correction being edited lives in `state.draft` (updated on input events) so async re-renders don't lose input. Use `th()` (escaped params) for HTML, `t()` for plain text.
- `api.php`: JSON actions `licenses`, `search`, `clubs`, `parse` (xlsx/xls/ods via the PhpSpreadsheet shipped with IANSEO), `settings`, `correction`, `profile`, `update-check`, `update-channel`, `update-install`. Same ACL as ListLoad (`AclParticipants`/`pAdvancedEntries`); update actions require `AclRoot`.
- `menu.php`: included by `Common/Menu.php` (`glob Modules/Custom/*/menu.php`) from both `get_which_menu` and `get_which_run_menu`. In the latter, `$acl` and `$ret['PART']` may be missing. **Any folder under `Modules/Custom/` with a `menu.php` adds a menu entry**, which is why update backups go to `sys_get_temp_dir()`.

## IANSEO behaviour the code relies on (checked in the sources)

- **ListLoad format**:
  - tab-separated; `;` is also turned into a tab (hence `clean()`);
  - columns: license, session, division, class, target, 5 flags, last name, first name, sex, club code (≤10 chars), club name, date of birth (ISO accepted);
  - **an absent column ≠ an empty one**: absent flags = 1, empty sex = female.
- **License lookup**: exact `LueCode` + `LueIocCode` = competition `ToIocCode`, `ORDER BY LueDefault DESC`; `ii_lookup_licenses` reuses that query. When found, IANSEO takes name, sex and date of birth from the database; it takes the club from the database **only if column 14 is absent**.
  - Rows known to the database are therefore sent in the 4-column format.
  - Only "import without database" rows use 16 columns, and only while the license is unknown (`rec.noBase` is false once `rec.base` exists).
- **Matching**: by `EnCode`, skipping entries already matched during the import. An archer on several sessions (one line per session) gets one entry per session, also on re-import.
- **License validity**: statuses 0 and 1 valid; status forced to 5 when `LueStatusValidUntil` < `ToWhenFrom` (like `Partecipants/SearchArcher.php`). Labels come from `get_text('Status_n')`, already in the IANSEO language.
- **Excel dates**: `getFormattedValue()` renders Excel's default date format month-first (`mm-dd-yy`). `ii_read_spreadsheet` returns date cells as `Y-m-d`.

## Persistence

- **Per competition**: `getModuleParameter`/`setModuleParameter`, module `EntryImport`, params `settings` and `corrections`. Stored values are JSON strings, never serialized PHP objects.
- **Installation-wide**: `ii_get_global`/`ii_set_global` with `MpTournament = 0` in direct SQL. Used for `profiles`, `channel` and the `updateCheck` cache. `setModuleParameter` replaces an empty TourId with the open competition.
- `MpParameter` is at most 30 characters.
- **Correction key**: original license + last name + first name, normalised; identical rows get `#2`, `#3`… Changing this orphans saved corrections.

## Releases and self-update

- `version.json`: `version`, `repo`, `asset`, optional `api`. In the repo the version stays `0.0.0-dev`; workflows write the real one.
- **Stable**: tag `vX.Y.Z` → `release.yml` builds the "latest" release. The module reads `releases/latest`, which excludes pre-releases.
- **Nightly**: `nightly.yml` (daily cron + manual run) rebuilds the `nightly` pre-release and moving tag when `main` changed.
  - Version `X.Y.(Z+1)-nightly.YYYYMMDD.sha` (`scripts/nightly-version.js`), stored in the **release name** because the tag is always `nightly`.
  - PHP `version_compare` puts it between `X.Y.Z` and `X.Y.(Z+1)`, so the next stable release is offered over it (`ii_is_update`).
- **Archive**: every entry must be under `EntryImport/` and `EntryImport/version.json` must be present, otherwise `ii_update_install` refuses it.
- **Install**: files are copied, not renamed (Windows/XAMPP locks). The backup is restored on failure.
- The GitHub repo (`yet-another-quentin/ianseo-entry-import`) must stay public: the module calls the API unauthenticated.

## Git

- Commit messages: [gitmoji](https://gitmoji.dev/) prefix (Unicode emoji), English, a single line, no `Co-Authored-By`. Example: `🐛 Fix Excel dates read month-first`.
- Commits are GPG-signed. If signing fails because pinentry cannot prompt, ask the user to run the commit.
