// Tests de la logique pure : node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../ImportInscriptions/core.js');

const PARA = ['OPCL', 'FECL', 'W1', 'HV1', 'HV2', 'HLCL', 'HLCO', 'SU1', 'SU2', 'CHCL', 'CHCO', 'CRCL', 'CRCO', 'OPCO', 'FECO'];
const ctx = {
  sessions: [1, 2, 3, 4].map(n => ({ order: n, name: n <= 2 ? 'Samedi ' + (n === 1 ? 'matin' : 'après-midi') : 'Dimanche', capacity: 36 })),
  divisions: ['CL', 'CO', 'BB', 'AD'].map(id => ({ id, name: id, para: false })).concat(PARA.map(id => ({ id, name: id, para: true }))),
  classes: ['U11', 'U13', 'U15', 'U18', 'U21', 'S1', 'S2', 'S3'].flatMap(c => ['H', 'F'].map(s => ({
    id: c + s, name: c + s, divisions: c === 'U11' ? ['CL'] : c === 'U13' ? ['CL', 'CO'].concat(PARA) : ['BB', 'CL', 'CO'].concat(PARA),
  }))),
};

function load() {
  const rows = C.parseCSV(C.decodeText(fs.readFileSync(path.join(__dirname, 'fixtures/sportregions.csv'))));
  const headers = rows[0];
  const profile = C.detectProfile(headers, C.BUILTIN_PROFILES);
  const map = C.resolveColumns(headers, profile.columns);
  return { headers, rows: rows.slice(1), profile, map, records: C.readRecords(headers, rows.slice(1), map) };
}

// licences de la fixture telles que la base les renverrait
const LIC = {
  '123456A': { found: true, nom: 'DUPONT', prenom: 'Jean', sex: 'H', club: 'Cestas', valid: true, statusLabel: 'Peut participer', entries: [] },
  '654321B': { found: true, nom: 'MARTIN', prenom: 'Elodie', sex: 'F', club: 'Pessac', valid: true, statusLabel: 'Peut participer', entries: [] },
  '222222D': { found: true, nom: 'ROUX', prenom: 'Marc', sex: 'H', club: 'Z', valid: true, statusLabel: 'Peut participer', entries: [] },
  '333333E': { found: true, nom: 'AUTRE', prenom: 'Personne', sex: 'H', club: 'X', valid: true, statusLabel: 'Peut participer', entries: [] },
  '444444F': { found: true, nom: 'ATTENTE', prenom: 'Zoé', sex: 'F', club: 'X', valid: false, statusLabel: 'État inconnu à la date du tournoi', entries: [] },
  '111111C': { found: false, entries: [] },
};

const run = (records, extra = {}) => C.processRecords(records, ctx, Object.assign({ values: {}, corrections: {}, licences: LIC, licencesChecked: true }, extra));

test('lecture CSV Latin-1 et détection du profil SportRegions', () => {
  const { headers, profile, map } = load();
  assert.equal(headers.length, 37);
  assert.equal(profile.id, 'sportregions');
  for (const f of C.FIELDS) assert.equal(map[f.key].length, 1, f.key);
});

test('statuts, départs multiples et lignes envoyées', () => {
  const { records } = load();
  const res = run(records);
  const by = Object.fromEntries(res.recs.map(r => [r.line, r]));
  assert.equal(by[2].status, 'ok');
  assert.deepEqual(by[2].sessions, ['1', '3']);
  assert.equal(by[3].status, 'ok');                       // Élodie / ELODIE : même identité sans accents
  assert.equal(by[4].status, 'error');                    // licence vide
  assert.equal(by[5].status, 'error');                    // arme « Autre »
  assert.equal(by[6].status, 'warn');                     // handisport W1 en CL
  assert.equal(by[7].status, 'error');                    // doublon de la ligne 2
  assert.equal(by[8].status, 'warn');                     // identité différente dans la base
  assert.equal(by[9].status, 'warn');                     // licence non valide
  assert.deepEqual(res.lines, ['123456A\t1\tCL\tS1H', '123456A\t3\tCL\tS1H', '654321B\t2\tCO\tU18F']);
});

test('les lignes non vérifiées en base ne passent pas « ok » à tort', () => {
  const { records } = load();
  const res = run(records, { licences: {}, licencesChecked: true });
  assert.ok(res.recs.filter(r => r.status === 'ok').length === 0);
});

test('corrections : division para, identité confirmée, licence forcée, écart du doublon', () => {
  const { records } = load();
  const key = line => records.find(r => r.line === line).key;
  const corrections = {
    [key(6)]: { fields: { division: 'W1' } },
    [key(7)]: { exclude: true, fields: {} },
    [key(8)]: { identityOk: true, fields: {} },
    [key(9)]: { forceInvalid: true, fields: {} },
    [key(5)]: { fields: { division: 'BB' } },
  };
  const res = run(records, { corrections });
  const st = Object.fromEntries(res.recs.map(r => [r.line, r.status]));
  assert.deepEqual(st, { 2: 'ok', 3: 'ok', 4: 'error', 5: 'warn', 6: 'ok', 7: 'excluded', 8: 'ok', 9: 'ok' });
  // ligne 5 : licence 111111C absente de la base → import sans base
  corrections[key(5)] = { fields: { division: 'BB' }, noBase: true };
  const res2 = run(records, { corrections });
  const l5 = res2.recs.find(r => r.line === 5);
  assert.equal(l5.status, 'ok');
  assert.equal(res2.lines.find(l => l.startsWith('111111C')), '111111C\t4\tBB\tS2F\t\t1\t1\t1\t1\t1\tPETIT\tLéa\tF\tCLUBY\tClub Y\t1975-05-05');
});

test('le doublon reçoit une clé distincte', () => {
  const { records } = load();
  const a = records.find(r => r.line === 2).key, b = records.find(r => r.line === 7).key;
  assert.notEqual(a, b);
});

test('classe : une ou deux colonnes, validée par la compétition', () => {
  const ids = ctx.classes.map(c => c.id);
  assert.equal(C.buildClass('S1', 'H', ids), 'S1H');
  assert.equal(C.buildClass('S1H', '', ids), 'S1H');
  assert.equal(C.buildClass('u18 femme', '', ids), 'U18F');
  assert.equal(C.buildClass('S1', '', ids), '');
  assert.equal(C.buildClass('S1', 'H', []), 'S1H');
});

test('classe non autorisée pour la division', () => {
  const rec = { line: 2, key: 'k', src: { licence: '123456A', depart: ['1'], arme: 'Compound', categorie: 'U11', sexe: 'Homme', nom: 'DUPONT', prenom: 'Jean', club: '', naissance: '', blason: '', classement: '', handi: '' } };
  const r = run([rec]).recs[0];
  assert.equal(r.status, 'error');
  assert.match(r.errors.join(), /non autorisée/);
});

test('départs en plusieurs colonnes (cases cochées)', () => {
  const headers = ['Licence', 'Samedi matin', 'Dimanche', 'Arme', 'Classe'];
  const rows = [['123456A', 'Oui', 'x', 'CL', 'S1H'], ['654321B', '', 'Oui', 'CO', 'U18F']];
  const map = C.resolveColumns(headers, { licence: ['Licence'], depart: ['Samedi matin', 'Dimanche'], arme: ['Arme'], categorie: ['Classe'] });
  const recs = C.readRecords(headers, rows, map);
  assert.deepEqual(recs[0].src.depart, ['Samedi matin', 'Dimanche']);
  const res = run(recs, { values: { depart: { 'Samedi matin': '1', 'Dimanche': '3' } } });
  assert.deepEqual(res.lines, ['123456A\t1\tCL\tS1H', '123456A\t3\tCL\tS1H', '654321B\t3\tCO\tU18F']);
});

test('session reconnue par son nom IANSEO', () => {
  assert.equal(C.defaultSession('Samedi matin', ctx), '1');
  assert.equal(C.defaultSession('Départ 4', ctx), '4');
  assert.equal(C.defaultSession('Départ 9', ctx), '');
});

test('suggestion de division para', () => {
  assert.equal(C.suggestParaDivision('W1', 'CL', ctx), 'W1');
  assert.equal(C.suggestParaDivision('HV libre', 'CO', ctx), 'HLCO');
  assert.equal(C.suggestParaDivision('Challenge', 'CL', ctx), 'CHCL');
  assert.equal(C.suggestParaDivision('Open Fédéral', 'CL', ctx), '');
});

test('dates et normalisations', () => {
  assert.equal(C.isoDate('05/05/1975'), '1975-05-05');
  assert.equal(C.isoDate('1975-05-05'), '1975-05-05');
  assert.equal(C.isoDate('31/02/2000'), '');
  assert.equal(C.normLicence(' 654321 b'), '654321B');
  assert.deepEqual(C.splitTokens('1, 3 et 4'), ['1', '3', '4']);
});
