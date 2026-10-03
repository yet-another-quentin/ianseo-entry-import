// Pure logic tests: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../EntryImport/core.js');

const PARA = ['OPCL', 'FECL', 'W1', 'HV1', 'HV2', 'HLCL', 'HLCO', 'SU1', 'SU2', 'CHCL', 'CHCO', 'CRCL', 'CRCO', 'OPCO', 'FECO'];
const ctx = {
  sessions: [1, 2, 3, 4].map(n => ({ order: n, name: n <= 2 ? 'Samedi ' + (n === 1 ? 'matin' : 'après-midi') : 'Dimanche', capacity: 36 })),
  divisions: ['CL', 'CO', 'BB', 'AD'].map(id => ({ id, name: id, para: false })).concat(PARA.map(id => ({ id, name: id, para: true }))),
  classes: ['U11', 'U13', 'U15', 'U18', 'U21', 'S1', 'S2', 'S3'].flatMap(c => ['H', 'F'].map(s => ({
    id: c + s, name: c + s, divisions: c === 'U11' ? ['CL'] : c === 'U13' ? ['CL', 'CO'].concat(PARA) : ['BB', 'CL', 'CO'].concat(PARA),
  }))),
};

// SportRegions export (Latin-1, ";" separated, quoted)
function load() {
  const rows = C.parseCSV(C.decodeText(fs.readFileSync(path.join(__dirname, 'fixtures/sportregions.csv'))));
  const headers = rows[0];
  const profile = C.detectProfile(headers, C.BUILTIN_PROFILES);
  const map = C.resolveColumns(headers, profile.columns);
  return { headers, profile, map, records: C.readRecords(headers, rows.slice(1), map) };
}

const valid = { valid: true, statusLabel: 'Can participate', entries: [] };
// The fixture's licenses as the license database would return them
const LICENSES = {
  '123456A': { found: true, lastName: 'DUPONT', firstName: 'Jean', sex: 'H', club: 'Cestas', ...valid },
  '654321B': { found: true, lastName: 'MARTIN', firstName: 'Elodie', sex: 'F', club: 'Pessac', ...valid },
  '222222D': { found: true, lastName: 'ROUX', firstName: 'Marc', sex: 'H', club: 'Z', ...valid },
  '333333E': { found: true, lastName: 'AUTRE', firstName: 'Personne', sex: 'H', club: 'X', ...valid },
  '444444F': { found: true, lastName: 'ATTENTE', firstName: 'Zoé', sex: 'F', club: 'X', ...valid, valid: false, statusLabel: 'Unknown status' },
  '111111C': { found: false, entries: [] },
};

const run = (records, extra = {}) => C.processRecords(records, ctx,
  Object.assign({ values: {}, corrections: {}, licenses: LICENSES, licensesChecked: true }, extra));
const keys = msgs => msgs.map(m => m.k);

test('reads a Latin-1 CSV and detects the SportRegions profile', () => {
  const { headers, profile, map } = load();
  assert.equal(headers.length, 37);
  assert.equal(profile.id, 'sportregions');
  for (const f of C.FIELDS) assert.equal(map[f.key].length, 1, f.key);
});

test('statuses, multiple sessions and lines sent', () => {
  const { records } = load();
  const res = run(records);
  const by = Object.fromEntries(res.recs.map(r => [r.line, r]));
  assert.equal(by[2].status, 'ok');
  assert.deepEqual(by[2].sessions, ['1', '3']);
  assert.equal(by[3].status, 'ok');                                        // Élodie / ELODIE: same identity without accents
  assert.deepEqual(keys(by[4].errors), ['err.licenseMissing']);
  assert.deepEqual(keys(by[5].errors), ['err.divisionUnmapped']);           // bow "Autre"
  assert.deepEqual(keys(by[6].warnings), ['warn.para']);                    // para W1 shooting CL
  assert.deepEqual(keys(by[7].errors), ['err.duplicate']);                  // duplicate of line 2
  assert.deepEqual(keys(by[8].warnings), ['warn.identity']);
  assert.deepEqual(keys(by[9].warnings), ['warn.licenseInvalid']);
  assert.deepEqual(res.lines, ['123456A\t1\tCL\tS1H', '123456A\t3\tCL\tS1H', '654321B\t2\tCO\tU18F']);
});

test('rows are never "ok" while their license is unknown', () => {
  const { records } = load();
  const res = run(records, { licenses: {} });
  assert.equal(res.recs.filter(r => r.status === 'ok').length, 0);
});

test('corrections: para division, identity confirmed, license forced, duplicate set aside, no database', () => {
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
  assert.deepEqual(Object.fromEntries(res.recs.map(r => [r.line, r.status])),
    { 2: 'ok', 3: 'ok', 4: 'error', 5: 'warn', 6: 'ok', 7: 'excluded', 8: 'ok', 9: 'ok' });
  // line 5: license 111111C missing from the database → import without database (full format)
  corrections[key(5)] = { fields: { division: 'BB' }, noBase: true };
  const res2 = run(records, { corrections });
  assert.equal(res2.recs.find(r => r.line === 5).status, 'ok');
  assert.equal(res2.lines.find(l => l.startsWith('111111C')), '111111C\t4\tBB\tS2F\t\t1\t1\t1\t1\t1\tPETIT\tLéa\tF\tCLUBY\tClub Y\t1975-05-05');
});

test('"import without database" falls back to the short format once the license is in the database', () => {
  const { records } = load();
  const key = records.find(r => r.line === 5).key;
  const corrections = { [key]: { fields: { division: 'BB' }, noBase: true, full: { clubCode: 'INVENTED' } } };
  const licenses = Object.assign({}, LICENSES, { '111111C': { found: true, lastName: 'PETIT', firstName: 'Léa', sex: 'F', club: 'Y', ...valid } });
  const r5 = run(records, { corrections, licenses }).recs.find(r => r.line === 5);
  assert.equal(r5.status, 'ok');
  assert.equal(r5.noBase, false);
  assert.deepEqual(keys(r5.infos), ['info.noBaseNotNeeded']);
  assert.equal(C.toLine(r5, '4'), '111111C\t4\tBB\tS2F');
});

test('identical rows get distinct keys', () => {
  const { records } = load();
  assert.notEqual(records.find(r => r.line === 2).key, records.find(r => r.line === 7).key);
});

test('class from one or two columns, checked against the competition', () => {
  const ids = ctx.classes.map(c => c.id);
  assert.equal(C.buildClass('S1', 'H', ids), 'S1H');
  assert.equal(C.buildClass('S1H', '', ids), 'S1H');
  assert.equal(C.buildClass('u18 femme', '', ids), 'U18F');
  assert.equal(C.buildClass('S1', '', ids), '');
  assert.equal(C.buildClass('S1', 'H', []), 'S1H');
  assert.equal(C.sexCode('Female'), 'F');
  assert.equal(C.sexCode('Homme'), 'H');
});

test('class not allowed for the division', () => {
  const src = { license: '123456A', session: ['1'], division: 'Compound', category: 'U11', sex: 'Homme', lastName: 'DUPONT', firstName: 'Jean',
    club: '', birthDate: '', targetFace: '', classification: '', paraCategory: '' };
  const r = run([{ line: 2, key: 'k', src }]).recs[0];
  assert.equal(r.status, 'error');
  assert.deepEqual(keys(r.errors), ['err.classNotAllowed']);
});

test('sessions as several tick-box columns', () => {
  const headers = ['Licence', 'Samedi matin', 'Dimanche', 'Arme', 'Classe'];
  const rows = [['123456A', 'Oui', 'x', 'CL', 'S1H'], ['654321B', '', 'Yes', 'CO', 'U18F']];
  const map = C.resolveColumns(headers, { license: ['Licence'], session: ['Samedi matin', 'Dimanche'], division: ['Arme'], category: ['Classe'] });
  const recs = C.readRecords(headers, rows, map);
  assert.deepEqual(recs[0].src.session, ['Samedi matin', 'Dimanche']);
  const res = run(recs, { values: { session: { 'Samedi matin': '1', 'Dimanche': '3' } } });
  assert.deepEqual(res.lines, ['123456A\t1\tCL\tS1H', '123456A\t3\tCL\tS1H', '654321B\t3\tCO\tU18F']);
});

test('session matched by its IANSEO name or number', () => {
  assert.equal(C.defaultSession('Samedi matin', ctx), '1');
  assert.equal(C.defaultSession('Départ 4', ctx), '4');
  assert.equal(C.defaultSession('Départ 9', ctx), '');
});

test('suggested para division', () => {
  assert.equal(C.suggestParaDivision('W1', 'CL', ctx), 'W1');
  assert.equal(C.suggestParaDivision('HV libre', 'CO', ctx), 'HLCO');
  assert.equal(C.suggestParaDivision('Challenge', 'CL', ctx), 'CHCL');
  assert.equal(C.suggestParaDivision('Open Fédéral', 'CL', ctx), '');
});

test('dates and normalisation', () => {
  assert.equal(C.isoDate('05/03/1990'), '1990-03-05');
  assert.equal(C.isoDate('1990-03-05'), '1990-03-05');
  assert.equal(C.isoDate('31/02/2000'), '');
  assert.equal(C.normLicense(' 654321 b'), '654321B');
  assert.deepEqual(C.splitTokens('1, 3 et 4'), ['1', '3', '4']);
});
