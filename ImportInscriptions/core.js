/*
 * Entry import — pure logic (no DOM), shared by the page and the Node tests.
 *
 * Pipeline:
 *   file → rows → source records (column mapping)
 *   → corrections → resolution (session, division, class)
 *   → checks (including the license database) → status ok / warn / error / excluded
 *   → lines in IANSEO "List load" format (Partecipants/ListLoad.php).
 *
 * Messages are returned as { k: i18nKey, p: params } and translated by the UI (i18n.js).
 */
(function (root) {
  'use strict';

  // Fields read from the file. `multi`: several columns allowed (sessions as tick boxes).
  const FIELDS = [
    { key: 'license', required: true },
    { key: 'session', required: true, multi: true },
    { key: 'division', required: true },
    { key: 'category' },
    { key: 'sex' },
    { key: 'lastName' },
    { key: 'firstName' },
    { key: 'club' },
    { key: 'birthDate' },
    { key: 'targetFace' },
    { key: 'classification' },
    { key: 'paraCategory' },
  ];

  // Common bow names (normalised) → IANSEO FR divisions.
  const DEFAULT_DIVISIONS = {
    'classique': 'CL', 'arc classique': 'CL', 'recurve': 'CL',
    'compound': 'CO', 'arc a poulies': 'CO', 'poulies': 'CO',
    'arc nu': 'BB', 'barebow': 'BB',
    'arc droit': 'AD', 'longbow': 'AD', 'arc libre': 'AL', 'tir libre': 'TL',
  };

  // Built-in profiles. `columns`: accepted header labels (compared without accents or case).
  const BUILTIN_PROFILES = [
    {
      id: 'sportregions', name: 'SportRegions', builtin: true,
      detect: ['numero de licence', 'arme', "categorie d'age", 'depart', 'numero commande'],
      columns: {
        license: ['Numéro de licence'], session: ['Départ'], division: ['Arme'], category: ["Catégorie d'age"],
        sex: ['Sexe'], lastName: ['Nom'], firstName: ['Prénom'], club: ['Club'], birthDate: ['Date de naissance'],
        targetFace: ['Blason'], classification: ['Classement'], paraCategory: ['Catégorie Handisport'],
      },
      values: { division: { 'Classique': 'CL', 'Compound': 'CO', 'Arc nu': 'BB' } },
    },
    {
      id: 'custom', nameKey: 'profile.custom', builtin: true, detect: [],
      columns: {
        license: ['numero de licence', 'licence', 'license', 'n licence', 'num licence', 'code'],
        session: ['depart', 'departs', 'session'], division: ['arme', 'arc', 'division', "type d'arc", 'bow'],
        category: ["categorie d'age", 'categorie', 'classe', 'class', 'category'], sex: ['sexe', 'genre', 'sex', 'gender'],
        lastName: ['nom', 'nom de famille', 'last name', 'family name', 'surname'], firstName: ['prenom', 'first name', 'given name'],
        club: ['club', 'structure'], birthDate: ['date de naissance', 'naissance', 'date of birth', 'birth date', 'dob'],
        targetFace: ['blason', 'target face'], classification: ['classement', 'classification'],
        paraCategory: ['categorie handisport', 'handisport', 'para category'],
      },
      values: {},
    },
  ];

  const msg = (k, p) => (p ? { k, p } : { k });

  // ---------- helpers ----------

  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’`]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function decodeText(buf) {
    const bytes = new Uint8Array(buf);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { text = new TextDecoder('windows-1252').decode(bytes); }
    return text.replace(/^\uFEFF/, '');
  }

  function detectDelimiter(text) {
    const first = text.split(/\r?\n/, 1)[0];
    const counts = { ';': 0, ',': 0, '\t': 0 };
    let q = false;
    for (const c of first) {
      if (c === '"') q = !q;
      else if (!q && c in counts) counts[c]++;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  function parseCSV(text, delim) {
    delim = delim || detectDelimiter(text);
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim() !== ''));
  }

  function normLicense(v) {
    return String(v == null ? '' : v).toUpperCase().replace(/[\s.\-]/g, '');
  }

  // 'H' (homme / male) or 'F' (femme / female), as used by IANSEO FR class codes.
  function sexCode(v) {
    const n = norm(v);
    if (/^(h|homme|hommes|m|masculin|male|man|men|garcon|boy)$/.test(n)) return 'H';
    if (/^(f|femme|femmes|w|feminin|female|woman|women|dame|fille|girl)$/.test(n)) return 'F';
    return '';
  }

  // "S1" + H → "S1H"; also accepts "S1H", "S1 Homme", "S1 H".
  function buildClass(category, sex, classIds) {
    const c = norm(category).toUpperCase().replace(/\s+/g, '').replace(/(HOMMES?|FEMMES?)$/, m => m[0]);
    if (!c) return '';
    const known = classIds && classIds.length ? new Set(classIds) : null;
    const ok = id => !known || known.has(id);
    if (sex && ok(c + sex) && !/[HF]$/.test(c)) return c + sex;
    if (ok(c) && (known || /[HF]$/.test(c))) return c;
    if (sex && ok(c + sex)) return c + sex;
    return '';
  }

  function splitTokens(v) {
    return String(v == null ? '' : v).split(/[,;/+|]|\bet\b|\band\b/).map(s => s.trim()).filter(Boolean);
  }

  const TRUTHY = /^(oui|yes|x|1|true|vrai|ok|✓|✔)$/i;
  const FALSY = /^(non|no|0|false|faux|-)?$/i;

  // Session values of a row: one column ("1, 3") or several columns (ticked box → column header).
  function sessionTokens(row, idxs, headers) {
    const out = [];
    for (const i of idxs) {
      const v = String(row[i] == null ? '' : row[i]).trim();
      if (idxs.length > 1) {
        if (FALSY.test(v)) continue;
        if (TRUTHY.test(v)) { out.push(String(headers[i]).trim()); continue; }
      }
      out.push(...splitTokens(v));
    }
    return [...new Set(out)];
  }

  // yyyy-mm-dd, dd/mm/yyyy or dd-mm-yy → yyyy-mm-dd ('' if invalid).
  function isoDate(v) {
    const s = String(v == null ? '' : v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return valid(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (m) {
      let y = +m[3]; if (y < 100) y += y > (new Date().getFullYear() % 100) ? 1900 : 2000;
      return valid(y, +m[2], +m[1]);
    }
    return '';
    function valid(y, mo, d) {
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCMonth() !== mo - 1) return '';
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  function clubCode(name) {
    return norm(name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  }

  function clean(v) { return String(v == null ? '' : v).replace(/[\t\r\n;]+/g, ' ').trim(); }

  // "Close enough" identity: equal ignoring accents/case/punctuation, or one contains the other (compound names).
  function sameName(a, b) {
    const x = norm(a).replace(/[^a-z]/g, ''), y = norm(b).replace(/[^a-z]/g, '');
    if (!x || !y) return true;
    return x === y || x.includes(y) || y.includes(x);
  }

  // ---------- profiles and column mapping ----------

  function detectProfile(headers, profiles) {
    const nh = new Set(headers.map(norm));
    return profiles.find(p => p.detect && p.detect.length && p.detect.every(h => nh.has(norm(h)))) ||
      profiles.find(p => p.id === 'custom') || profiles[0];
  }

  // Resolves profile (or saved) columns to indexes in `headers`: exact match first, then "starts with".
  // Result: { field: [index…] }.
  function resolveColumns(headers, columns) {
    const nh = headers.map(norm);
    const used = new Set();
    const map = {};
    for (const f of FIELDS) {
      const wanted = (columns && columns[f.key]) || [];
      const found = [];
      for (const w of wanted) {
        const nw = norm(w);
        let i = nh.findIndex((h, k) => !used.has(k) && h === nw);
        if (i < 0 && !f.multi) i = nh.findIndex((h, k) => !used.has(k) && h.startsWith(nw));
        if (i >= 0) { found.push(i); used.add(i); if (!f.multi) break; }
      }
      map[f.key] = found;
    }
    return map;
  }

  function columnsToNames(headers, map) {
    const out = {};
    for (const f of FIELDS) out[f.key] = (map[f.key] || []).map(i => headers[i]);
    return out;
  }

  // ---------- processing ----------

  /**
   * Builds the source records.
   * Stable row key (to find its corrections again on re-import): license + last name + first name as typed,
   * normalised; otherwise the content of the mapped columns. Identical rows get a "#n" suffix.
   * Changing this computation orphans the corrections already saved.
   */
  function readRecords(headers, rows, map) {
    const get = (r, k) => {
      const idx = map[k] || [];
      return idx.length ? String(r[idx[0]] == null ? '' : r[idx[0]]).trim() : '';
    };
    const seen = {};
    return rows.map((r, i) => {
      const src = {};
      for (const f of FIELDS) src[f.key] = f.key === 'session' ? sessionTokens(r, map.session || [], headers) : get(r, f.key);
      let key = [normLicense(src.license), norm(src.lastName), norm(src.firstName)].join('|');
      if (key === '||') key = 'row:' + FIELDS.map(f => norm(Array.isArray(src[f.key]) ? src[f.key].join(',') : src[f.key])).join('|');
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > 1) key += '#' + seen[key];
      return { line: i + 2, key, src };
    });
  }

  function defaultSession(token, ctx) {
    const sessions = ctx.sessions || [];
    const n = norm(token);
    const byName = sessions.find(s => s.name && norm(s.name) === n);
    if (byName) return String(byName.order);
    const m = String(token).match(/\d+/);
    if (!m) return '';
    const num = String(parseInt(m[0], 10));
    return !sessions.length || sessions.some(s => String(s.order) === num) ? num : '';
  }

  function defaultDivision(value, ctx) {
    const divs = (ctx.divisions || []).map(d => d.id);
    const n = norm(value);
    if (!n) return '';
    const up = String(value).trim().toUpperCase();
    if (divs.includes(up)) return up;
    const d = DEFAULT_DIVISIONS[n];
    return d && (!divs.length || divs.includes(d)) ? d : '';
  }

  // Suggested para division (IANSEO FR rules) from the para category and the bow division.
  function suggestParaDivision(paraCategory, division, ctx) {
    const paras = (ctx.divisions || []).filter(d => d.para).map(d => d.id);
    const n = norm(paraCategory), co = division === 'CO';
    let id = '';
    if (/^w1$/.test(n)) id = 'W1';
    else if (/^hv ?1$/.test(n)) id = 'HV1';
    else if (/^hv ?2/.test(n)) id = 'HV2';
    else if (/hv libre/.test(n)) id = co ? 'HLCO' : 'HLCL';
    else if (/support ?1/.test(n)) id = 'SU1';
    else if (/support ?2/.test(n)) id = 'SU2';
    else if (/challenge/.test(n)) id = co ? 'CHCO' : 'CHCL';
    else if (/criteri/.test(n)) id = co ? 'CRCO' : 'CRCL';
    else if (/^open$/.test(n)) id = co ? 'OPCO' : 'OPCL';
    else if (/^federal$/.test(n)) id = co ? 'FECO' : 'FECL';
    return paras.includes(id) ? id : '';
  }

  /**
   * Resolves and checks every record.
   * ctx:  { sessions:[{order,name,capacity}], divisions:[{id,name,para}], classes:[{id,divisions}] }
   * opts: { values:{session:{},division:{}}, corrections:{key:{…}}, licenses:{CODE:{found,…}}, licensesChecked, coMax }
   */
  function processRecords(records, ctx, opts) {
    const values = opts.values || {};
    const sessionMap = values.session || {}, divisionMap = values.division || {};
    const classIds = (ctx.classes || []).map(c => c.id);
    const divIds = (ctx.divisions || []).map(d => d.id);
    const paraDivs = new Set((ctx.divisions || []).filter(d => d.para).map(d => d.id));
    const sessionIds = (ctx.sessions || []).map(s => String(s.order));
    const lic = opts.licenses || {};
    const corrections = opts.corrections || {};
    const mapSession = t => (sessionMap[t] != null && sessionMap[t] !== '' ? String(sessionMap[t]) : defaultSession(t, ctx));

    const recs = records.map(r => {
      const c = corrections[r.key] || null;
      const f = (c && c.fields) || {};
      const src = r.src;
      const rec = {
        line: r.line, key: r.key, src, correction: c, errors: [], warnings: [], infos: [],
        excluded: !!(c && c.exclude),
      };
      rec.license = normLicense(f.license != null ? f.license : src.license);
      rec.sessions = f.sessions ? f.sessions.map(String) : [...new Set(src.session.map(mapSession))];
      rec.division = f.division != null ? f.division
        : (divisionMap[src.division] != null && divisionMap[src.division] !== '' ? divisionMap[src.division] : defaultDivision(src.division, ctx));
      rec.sex = f.sex || sexCode(src.sex);
      rec.cls = f.class != null ? f.class : buildClass(src.category, rec.sex, classIds);
      rec.para = !!(src.paraCategory || /handi|para/.test(norm(src.classification)));
      const L = rec.license && opts.licensesChecked ? lic[rec.license] : null;
      rec.base = L && L.found ? L : null;
      // "import without database" only applies while the license is unknown
      rec.noBase = !!(c && c.noBase) && !rec.base;
      rec.full = rec.noBase ? Object.assign({
        lastName: src.lastName, firstName: src.firstName, sex: rec.sex, clubCode: clubCode(src.club), club: src.club,
        birthDate: isoDate(src.birthDate),
      }, c.full || {}) : null;

      if (rec.excluded) return rec;

      // blocking errors
      if (!rec.license) rec.errors.push(msg('err.licenseMissing'));
      const unmapped = f.sessions ? [] : src.session.filter(t => !mapSession(t));
      unmapped.forEach(t => rec.errors.push(msg('err.sessionUnmapped', { v: t })));
      rec.sessions = rec.sessions.filter(Boolean);
      if (!rec.sessions.length && !unmapped.length) rec.errors.push(msg('err.noSession'));
      rec.sessions.forEach(s => { if (sessionIds.length && !sessionIds.includes(s)) rec.errors.push(msg('err.sessionUnknown', { s })); });
      if (!rec.division) rec.errors.push(msg('err.divisionUnmapped', { v: src.division }));
      else if (divIds.length && !divIds.includes(rec.division)) rec.errors.push(msg('err.divisionUnknown', { d: rec.division }));
      if (!rec.cls) {
        if (src.category || f.class != null) rec.errors.push(msg('err.classUndetermined', { cat: src.category, sex: src.sex }));
        else rec.warnings.push(msg('warn.categoryEmpty'));
      } else if (classIds.length && !classIds.includes(rec.cls)) rec.errors.push(msg('err.classUnknown', { c: rec.cls }));
      else if (rec.division) {
        const cl = (ctx.classes || []).find(x => x.id === rec.cls);
        if (cl && cl.divisions && cl.divisions.length && !cl.divisions.includes(rec.division)) {
          rec.errors.push(msg('err.classNotAllowed', { c: rec.cls, d: rec.division }));
        }
      }
      if (rec.noBase) {
        if (!rec.full.lastName || !rec.full.firstName) rec.errors.push(msg('err.noBaseName'));
        if (!rec.full.sex) rec.errors.push(msg('err.noBaseSex'));
        if (!rec.full.clubCode) rec.errors.push(msg('err.noBaseClub'));
        if (rec.full.clubCode && rec.full.clubCode.length > 10) rec.errors.push(msg('err.clubTooLong'));
      }

      // to check
      if (rec.para && !paraDivs.has(rec.division) && !(c && c.paraOk)) {
        rec.warnings.push(msg('warn.para', { cat: src.paraCategory }));
      }
      if (rec.license && opts.licensesChecked) {
        if (!rec.base) {
          if (!rec.noBase) rec.warnings.push(msg('warn.licenseNotFound'));
        } else {
          if (c && c.noBase) rec.infos.push(msg('info.noBaseNotNeeded'));
          if (!rec.base.valid && !(c && c.forceInvalid)) rec.warnings.push(msg('warn.licenseInvalid', { status: rec.base.statusLabel }));
          const idOk = sameName(rec.base.lastName, src.lastName) && sameName(rec.base.firstName, src.firstName)
            && (!rec.sex || !rec.base.sex || rec.base.sex === rec.sex);
          if (!idOk && !(c && c.identityOk)) {
            rec.warnings.push(msg('warn.identity', { name: rec.base.lastName + ' ' + rec.base.firstName, sex: rec.base.sex || '?' }));
          }
        }
      }
      if (rec.license && lic[rec.license] && lic[rec.license].entries && lic[rec.license].entries.length) {
        rec.infos.push(msg('info.alreadyEntered', { sessions: lic[rec.license].entries.map(e => e.session).join(', ') }));
      }
      return rec;
    });

    // duplicates: same license on the same session
    const seen = new Map();
    for (const r of recs) {
      if (r.excluded || !r.license) continue;
      for (const s of r.sessions) {
        const k = r.license + '|' + s;
        if (seen.has(k)) r.errors.push(msg('err.duplicate', { line: seen.get(k), s }));
        else seen.set(k, r.line);
      }
    }

    for (const r of recs) r.status = r.excluded ? 'excluded' : r.errors.length ? 'error' : r.warnings.length ? 'warn' : 'ok';
    const ok = recs.filter(r => r.status === 'ok');

    // session fill (ok rows only)
    const sessions = (ctx.sessions && ctx.sessions.length ? ctx.sessions.map(s => String(s.order)) : [...new Set(ok.flatMap(r => r.sessions))])
      .map(s => {
        const list = ok.filter(r => r.sessions.includes(s));
        const def = (ctx.sessions || []).find(x => String(x.order) === s) || {};
        return {
          session: s, name: def.name || '', capacity: def.capacity || 0, total: list.length,
          co: list.filter(r => r.division === 'CO').length,
          trispot: list.filter(r => /tri/i.test(r.src.targetFace)),
        };
      });
    const coMax = opts.coMax ? +opts.coMax : 0;
    sessions.forEach(s => { s.over = !!((s.capacity && s.total > s.capacity) || (coMax && s.co > coMax)); });

    const lines = ok.flatMap(r => r.sessions.map(s => toLine(r, s)));
    const count = st => recs.filter(r => r.status === st).length;
    return {
      recs, sessions, lines,
      counts: { total: recs.length, ok: ok.length, warn: count('warn'), error: count('error'), excluded: count('excluded'), lines: lines.length },
    };
  }

  // One "List load" line. Short format when the license is in the database (IANSEO fills in the rest);
  // full 16-column format only for an archer imported without database.
  function toLine(r, session) {
    const base = [r.license, session, r.division, r.cls];
    if (!r.noBase) return base.join('\t');
    const f = r.full;
    return [...base, '', '1', '1', '1', '1', '1', clean(f.lastName).toUpperCase(), clean(f.firstName),
      f.sex === 'H' ? 'M' : 'F', clean(f.clubCode).toUpperCase(), clean(f.club), f.birthDate || ''].join('\t');
  }

  const api = {
    FIELDS, BUILTIN_PROFILES, DEFAULT_DIVISIONS,
    norm, decodeText, parseCSV, detectDelimiter, normLicense, sexCode, buildClass, splitTokens, sessionTokens,
    isoDate, clubCode, sameName, detectProfile, resolveColumns, columnsToNames, readRecords,
    defaultSession, defaultDivision, suggestParaDivision, processRecords, toLine,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IICore = api;
})(typeof window !== 'undefined' ? window : this);
