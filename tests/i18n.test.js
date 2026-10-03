// Translations and release versioning: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I = require('../EntryImport/i18n.js');
const { nightlyVersion } = require('../scripts/nightly-version.js');

test('French and English dictionaries have the same keys', () => {
  const en = Object.keys(I.DICTS.en).sort(), fr = Object.keys(I.DICTS.fr).sort();
  assert.deepEqual(fr, en);
});

test('every message key used by core.js and app.js exists', () => {
  const dir = path.join(__dirname, '../EntryImport');
  const code = ['core.js', 'app.js'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const used = new Set();
  for (const m of code.matchAll(/\b(?:msg|th|t)\('([a-z]+\.[\w.]+|[a-z]+)'/g)) used.add(m[1]);
  for (const m of code.matchAll(/'((?:err|warn|info)\.\w+)'/g)) used.add(m[1]);
  // keys built at runtime ('check.tab.' + k) end with a dot and are skipped
  const missing = [...used].filter(k => !k.endsWith('.') && !(k in I.DICTS.en));
  assert.deepEqual(missing, []);
});

test('language follows IANSEO: French for fr*, English otherwise', () => {
  assert.equal(I.make('fr').lang, 'fr');
  assert.equal(I.make('fr-ca').lang, 'fr');
  assert.equal(I.make('it').lang, 'en');
  assert.equal(I.make('').lang, 'en');
});

test('placeholders: null → nothing, empty → "(empty)"', () => {
  const fr = I.make('fr');
  assert.equal(fr.t('warn.para', { cat: null }), 'Handisport : choisir la division');
  assert.equal(fr.t('err.sessionUnmapped', { v: '' }), 'Départ « (vide) » non associé à une session');
  assert.equal(I.make('en').t('import.button', { n: 3 }), 'Import 3 line(s) into IANSEO');
});

test('nightly version follows the last stable tag', () => {
  assert.equal(nightlyVersion('v1.2.3', '20261004', 'abc1234'), '1.2.4-nightly.20261004.abc1234');
  assert.equal(nightlyVersion('', '20261004', 'abc1234'), '0.0.1-nightly.20261004.abc1234');
});
