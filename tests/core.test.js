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
  for (const f of C.FIELDS) assert.equal(map[f.key].length, f.key === 'comment' ? 2 : 1, f.key);
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

// ---------- target faces (FR rules, indoor: faces of IANSEO's TEST26, by TfId) ----------
const FACES = [
  { id: 1, name: 'Blason Unique 40cm', classes: '', regexp: '(^(CL|BB)(U18|U2|S))|(^OPCLS)|(^OPCLU2)|(^FECLS)|(^FECLU2)|(^W1)', isDefault: true },
  { id: 2, name: 'Blason Unique 60cm', classes: '', regexp: '(^(CL|BB)U1[1-5])|(^CH)|(^CR)|(^H)|(^OPC.U1)|(^FEC.U1)', isDefault: true },
  { id: 3, name: 'Trispot Poulie 6-10 40cm', classes: '', regexp: '(^CO)|(^OPCOU2)|(^OPCOS)|(^FECOU2)|(^FECOS)', isDefault: true },
  { id: 4, name: 'Blason Découverte', classes: 'CLD%', regexp: '', isDefault: true },
  { id: 5, name: 'Blason Unique 80cm', classes: '', regexp: '(^SU)', isDefault: true },
  { id: 6, name: 'Trispot Classique 6-10 40cm', classes: '', regexp: '(^(CL|BB)(U18|U2|S))|(^OPCLS)|(^OPCLU2)|(^FECLS)|(^FECLU2)|(^W1)', isDefault: false },
  { id: 7, name: 'Trispot Classique 6-10 60cm', classes: '', regexp: '(^CLU15|^BBU1[3-5])', isDefault: false },
];
const fctx = Object.assign({}, ctx, { faces: FACES });
const runF = (records, extra = {}) => C.processRecords(records, fctx,
  Object.assign({ values: {}, corrections: {}, licenses: LICENSES, licensesChecked: true }, extra));

test('faces offered to a category, default first, and their List load index', () => {
  assert.deepEqual(C.facesFor('CL', 'S1H', FACES).map(f => f.id), [1, 6]);
  assert.deepEqual(C.facesFor('CO', 'U18F', FACES).map(f => f.id), [3]);
  assert.deepEqual(C.facesFor('CL', 'U15F', FACES).map(f => f.id), [2, 7]);
  assert.deepEqual(C.facesFor('CL', 'D1', FACES).map(f => f.id), [4]);
  assert.equal(C.faceIndex('CL', 'S1H', 6, FACES), 1);
  assert.equal(C.faceIndex('CO', 'U18F', 3, FACES), 0);
  assert.equal(C.faceIndex('CL', 'S1H', 3, FACES), null);
  assert.equal(C.autoFace('Standard', FACES), '*');
  assert.equal(C.autoFace('Trispot Vegas', FACES), 'tri');
  assert.equal(C.autoFace('blason unique 60CM', FACES), 'Blason Unique 60cm');
  assert.equal(C.autoFace('', FACES), '');
  assert.equal(C.autoFace('Rond', FACES), '?');
});

test('faces from the file, corrections and ##TARGET## lines after the entries', () => {
  const { records } = load();
  const key = line => records.find(r => r.line === line).key;
  const res = runF(records);
  const by = Object.fromEntries(res.recs.map(r => [r.line, r]));
  assert.equal(by[2].face.name, 'Blason Unique 40cm');               // "Standard"
  assert.equal(by[3].face.name, 'Trispot Poulie 6-10 40cm');         // "Trispot Vegas", compound
  assert.deepEqual(res.lines, ['123456A\t1\tCL\tS1H', '123456A\t3\tCL\tS1H', '654321B\t2\tCO\tU18F']);
  const okRows = res => res.recs.filter(r => r.status === 'ok');
  // nobody entered yet: DUPONT gets 2 entries (sessions 1 and 3), so 2 lines per face
  assert.deepEqual(C.targetLines(okRows(res), {}, true), ['##TARGET##\t123456A\tCL\tS1H\t0', '##TARGET##\t123456A\tCL\tS1H\t1',
    '##TARGET##\t654321B\tCO\tU18F\t0']);
  // trispot asked for a recurve: its trispot face (index 1 among CL S1H faces) → rows 2 and 3 of entries × faces
  const res2 = runF(records, { values: { face: { Standard: 'tri' } } });
  assert.equal(res2.recs.find(r => r.line === 2).face.name, 'Trispot Classique 6-10 40cm');
  assert.deepEqual(C.targetLines(okRows(res2), {}, true).slice(0, 2), ['##TARGET##\t123456A\tCL\tS1H\t2', '##TARGET##\t123456A\tCL\tS1H\t3']);
  const res3 = runF(records, { corrections: { [key(2)]: { fields: { face: 'Blason Unique 80cm' } } } });
  assert.deepEqual(keys(res3.recs.find(r => r.line === 2).errors), ['err.faceNotAllowed']);
});

test('a face missing or not recognised: default face, to check', () => {
  const src = { license: '123456A', session: ['1'], division: 'Classique', category: 'S1', sex: 'Homme', lastName: 'DUPONT', firstName: 'Jean',
    club: '', birthDate: '', targetFace: '', classification: '', paraCategory: '' };
  const r = runF([{ line: 2, key: 'k', src }]).recs[0];
  assert.equal(r.status, 'warn');
  assert.deepEqual(keys(r.warnings), ['warn.faceDefault']);
  assert.equal(r.face.name, 'Blason Unique 40cm');
  const ok = runF([{ line: 2, key: 'k', src }], { corrections: { k: { fields: { face: 'Blason Unique 40cm' } } } }).recs[0];
  assert.equal(ok.status, 'ok');
});

// ---------- new fields ----------
test('registration date, email and the archer\'s comment from two columns', () => {
  const { records } = load();
  const r3 = records.find(r => r.line === 3);
  assert.equal(r3.src.email, 'a@b.fr');
  assert.equal(r3.src.comment, 'Tir "côte à côte" avec Jean');
  assert.equal(C.isoDateTime(r3.src.registeredAt), '2026-09-01 10:05');
  assert.equal(C.isoDateTime('2026-09-01 9h30'), '2026-09-01 09:30');
  assert.equal(C.isoDateTime('2026-09-01'), '2026-09-01');
});

test('the key of a row without license nor name ignores the new fields', () => {
  const headers = ['Arme', 'Email'];
  const map = C.resolveColumns(headers, { division: ['Arme'], email: ['Email'] });
  const [a] = C.readRecords(headers, [['CL', 'x@y.fr']], map);
  assert.equal(a.key, 'row:||cl|||||||||');
});

// ---------- waiting list and proposals ----------
const DAY = '2026-10-19';
test('waiting list: not imported, no place held, order by priority then registration date', () => {
  const { records } = load();
  const key = line => records.find(r => r.line === line).key;
  const corrections = {
    [key(2)]: { wait: { 1: 0 } },                     // registered 01/09 10:00, waits for session 1, still entered in 3
    [key(6)]: { wait: { 1: 1 } },                     // registered 03/09, high priority
  };
  const res = run(records, { corrections, today: DAY });
  const r2 = res.recs.find(r => r.line === 2);
  assert.deepEqual(r2.inSessions, ['3']);
  assert.deepEqual(res.lines, ['123456A\t3\tCL\tS1H', '654321B\t2\tCO\tU18F']);
  const s1 = res.sessions.find(s => s.session === '1');
  assert.deepEqual([s1.total, s1.held, s1.waiting], [0, 0, 2]);
  assert.deepEqual(C.waitlist(res.recs).map(e => [e.rec.line, e.session, e.rank]), [[6, '1', 1], [2, '1', 2]]);
  assert.equal(res.counts.waitlist, 2);
});

test('a proposal holds a place in the proposed session until its deadline', () => {
  const { records } = load();
  const key = records.find(r => r.line === 3).key;     // 654321B, session 2
  const c = C.transition(null, { sessions: ['2'] }, '2', 'propose', { to: '4', until: '2026-10-22' });
  const res = run(records, { corrections: { [key]: c }, today: DAY });
  const r = res.recs.find(r => r.line === 3);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.inSessions, []);
  assert.equal(res.lines.some(l => l.startsWith('654321B')), false);
  assert.equal(res.sessions.find(s => s.session === '4').held, 1);
  assert.equal(res.sessions.find(s => s.session === '4').free, 35);
  // deadline passed: flagged, no place held any more
  const late = run(records, { corrections: { [key]: c }, today: '2026-10-23' });
  assert.equal(late.recs.find(r => r.line === 3).attention, true);
  assert.equal(late.sessions.find(s => s.session === '4').held, 0);
  assert.equal(late.counts.attention, 1);
});

test('answers to a proposal', () => {
  const rec = { sessions: ['1', '3'] };
  const proposed = C.transition(null, rec, '1', 'propose', { to: '2', until: '2026-10-22' });
  const accepted = C.transition(proposed, rec, '1', 'accept');
  assert.deepEqual(accepted.fields.sessions, ['2', '3']);
  assert.deepEqual(accepted.moved, { 2: '1' });
  assert.deepEqual(accepted.proposals, {});
  // accepts and stays waiting for session 1; promoted later: back to 1, session 2 is left
  const stays = C.transition(proposed, rec, '1', 'accept', { keepWaiting: true });
  assert.deepEqual(stays.wait, { 1: 0 });
  const back = C.transition(stays, { sessions: ['2', '3'] }, '1', 'promote');
  assert.deepEqual(back.fields.sessions, ['1', '3']);
  assert.deepEqual([back.wait, back.moved], [{}, {}]);
  // refuses: waiting list of session 1, or leaves it (row set aside when it was its only session)
  assert.deepEqual(C.transition(proposed, rec, '1', 'refuse', { toWait: true }).wait, { 1: 0 });
  assert.deepEqual(C.transition(proposed, rec, '1', 'refuse').fields.sessions, ['3']);
  const only = C.transition(null, { sessions: ['1'] }, '1', 'propose', { to: '2', until: '2026-10-22' });
  assert.equal(C.transition(only, { sessions: ['1'] }, '1', 'refuse').exclude, true);
  // nothing left: the correction is deleted
  assert.equal(C.transition(C.transition(null, rec, '1', 'wait'), rec, '1', 'promote'), null);
  assert.equal(C.addDays('2026-10-30', 3), '2026-11-02');
});

test('##TARGET## lines follow ListLoad\'s matching of the entries already in the competition', () => {
  const row = (license, sessions, division, cls, faceIndex) => ({ license, inSessions: sessions, division, cls, face: { id: 1 }, faceIndex });
  const lines = (rows, existing, overwrite) => C.targetLines(rows, existing, overwrite).map(l => l.split('\t').slice(1).join(' '));
  // updated in place (same division): still 2 entries
  const two = { '123456A': [{ id: 10, division: 'CL', class: 'S1H' }, { id: 11, division: 'CL', class: 'S1H' }] };
  assert.deepEqual(lines([row('123456A', ['1', '3'], 'CL', 'S1H', 1)], two, true), ['123456A CL S1H 2', '123456A CL S1H 3']);
  // without "update": 2 more entries
  assert.deepEqual(lines([row('123456A', ['1'], 'CL', 'S1H', 0)], two, false).length, 3);
  // an entry of another session not in the file stays: it counts when it has the same division and class
  assert.deepEqual(lines([row('123456A', ['1'], 'CL', 'S1H', 1)], two, true), ['123456A CL S1H 2', '123456A CL S1H 3']);
  // a leftover entry of another class does not count
  const other = { '123456A': [{ id: 10, division: 'CL', class: 'S1H' }, { id: 11, division: 'CO', class: 'S1H' }] };
  assert.deepEqual(lines([row('123456A', ['1'], 'CL', 'S1H', 1)], other, true), ['123456A CL S1H 1']);
  // no division match: ListLoad takes the LAST unmatched entry
  const co = { '123456A': [{ id: 10, division: 'CO', class: 'S1H' }, { id: 11, division: 'BB', class: 'S1H' }] };
  assert.deepEqual(lines([row('123456A', ['1'], 'CL', 'S1H', 0)], co, true), ['123456A CL S1H 0']);
});
