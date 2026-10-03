/*
 * Import inscriptions — logique pure (sans DOM), partagée par la page et les tests Node.
 *
 * Chaîne de traitement :
 *   fichier → lignes → enregistrements source (selon la correspondance des colonnes)
 *   → application des corrections → résolution (session, division, classe)
 *   → contrôles (dont la base des licences) → statut ok / à vérifier / erreur / écartée
 *   → lignes au format « Import liste » d'IANSEO (Partecipants/ListLoad.php).
 */
(function (root) {
  'use strict';

  // Champs lus dans le fichier. `multi` : plusieurs colonnes possibles (départs).
  const FIELDS = [
    { key: 'licence',    label: 'Numéro de licence', required: true },
    { key: 'depart',     label: 'Départ(s)', required: true, multi: true },
    { key: 'arme',       label: 'Arme / division', required: true },
    { key: 'categorie',  label: 'Catégorie / classe' },
    { key: 'sexe',       label: 'Sexe' },
    { key: 'nom',        label: 'Nom' },
    { key: 'prenom',     label: 'Prénom' },
    { key: 'club',       label: 'Club' },
    { key: 'naissance',  label: 'Date de naissance' },
    { key: 'blason',     label: 'Blason' },
    { key: 'classement', label: 'Classement (valide / handisport)' },
    { key: 'handi',      label: 'Catégorie handisport' },
  ];

  const DEFAULT_ARME = {
    'classique': 'CL', 'arc classique': 'CL', 'recurve': 'CL',
    'compound': 'CO', 'arc a poulies': 'CO', 'poulies': 'CO',
    'arc nu': 'BB', 'barebow': 'BB',
    'arc droit': 'AD', 'longbow': 'AD', 'arc libre': 'AL', 'tir libre': 'TL',
  };

  // Profils fournis avec le module. `columns` : libellés d'en-tête reconnus (comparés sans accents ni casse).
  const BUILTIN_PROFILES = [
    {
      id: 'sportregions', name: 'SportRegions', builtin: true,
      detect: ['numero de licence', 'arme', "categorie d'age", 'depart', 'numero commande'],
      columns: {
        licence: ['Numéro de licence'], depart: ['Départ'], arme: ['Arme'], categorie: ["Catégorie d'age"],
        sexe: ['Sexe'], nom: ['Nom'], prenom: ['Prénom'], club: ['Club'], naissance: ['Date de naissance'],
        blason: ['Blason'], classement: ['Classement'], handi: ['Catégorie Handisport'],
      },
      values: { arme: { 'Classique': 'CL', 'Compound': 'CO', 'Arc nu': 'BB' } },
    },
    {
      id: 'custom', name: 'Personnalisé', builtin: true, detect: [],
      columns: {
        licence: ['numero de licence', 'licence', 'n licence', 'num licence', 'code'],
        depart: ['depart', 'departs', 'session'], arme: ['arme', 'arc', 'division', 'type d\'arc'],
        categorie: ["categorie d'age", 'categorie', 'classe', 'class'], sexe: ['sexe', 'genre'],
        nom: ['nom', 'nom de famille'], prenom: ['prenom'], club: ['club', 'structure'],
        naissance: ['date de naissance', 'naissance'], blason: ['blason'], classement: ['classement'],
        handi: ['categorie handisport', 'handisport'],
      },
      values: {},
    },
  ];

  // ---------- utilitaires ----------

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

  function normLicence(v) {
    return String(v == null ? '' : v).toUpperCase().replace(/[\s.\-]/g, '');
  }

  function sexCode(v) {
    const n = norm(v);
    if (/^(h|homme|homme?s|m|masculin|male|garcon)$/.test(n)) return 'H';
    if (/^(f|femme|femmes|w|feminin|female|dame|fille)$/.test(n)) return 'F';
    return '';
  }

  // « S1 » + H → « S1H » ; accepte « S1H », « S1 Homme », « S1 H ».
  function buildClass(cat, sex, classIds) {
    let c = norm(cat).toUpperCase().replace(/\s+/g, '').replace(/(HOMMES?|FEMMES?)$/, m => m[0]);
    if (!c) return '';
    const known = classIds && classIds.length ? new Set(classIds) : null;
    const ok = id => !known || known.has(id);
    if (sex && ok(c + sex) && !/[HF]$/.test(c)) return c + sex;
    if (ok(c) && (known || /[HF]$/.test(c))) return c;
    if (sex && ok(c + sex)) return c + sex;
    return '';
  }

  function splitTokens(v) {
    return String(v == null ? '' : v).split(/[,;/+|]|\bet\b/).map(s => s.trim()).filter(Boolean);
  }

  const TRUTHY = /^(oui|yes|x|1|true|vrai|ok|✓|✔)$/i;
  const FALSY = /^(non|no|0|false|faux|-)?$/i;

  // Valeurs de départ d'une ligne : une colonne (« 1, 3 ») ou plusieurs colonnes (case cochée → en-tête).
  function departTokens(row, idxs, headers) {
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

  function isoDate(v) {
    const s = String(v == null ? '' : v).trim();
    let m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (m) {
      let y = +m[3]; if (y < 100) y += y > (new Date().getFullYear() % 100) ? 1900 : 2000;
      return valid(y, +m[2], +m[1]);
    }
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return valid(+m[1], +m[2], +m[3]);
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

  // Identité « proche » : égalité sans accents/casse/tirets, ou l'un contient l'autre (noms composés).
  function sameName(a, b) {
    const x = norm(a).replace(/[^a-z]/g, ''), y = norm(b).replace(/[^a-z]/g, '');
    if (!x || !y) return true;
    return x === y || x.includes(y) || y.includes(x);
  }

  // ---------- profils et correspondances ----------

  function detectProfile(headers, profiles) {
    const nh = new Set(headers.map(norm));
    return profiles.find(p => p.detect && p.detect.length && p.detect.every(h => nh.has(norm(h)))) ||
      profiles.find(p => p.id === 'custom') || profiles[0];
  }

  // Résout les colonnes d'un profil (ou d'une correspondance enregistrée) en index dans `headers`.
  // Correspondance exacte d'abord, puis « commence par ». Résultat : { champ: [index…] }.
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

  // ---------- traitement ----------

  /**
   * Construit les enregistrements source.
   * Clé stable d'une ligne (pour retrouver ses corrections lors d'un ré-import) :
   * licence + nom + prénom tels que saisis, normalisés ; à défaut, le contenu des colonnes utilisées.
   */
  function readRecords(headers, rows, map) {
    const get = (r, k) => {
      const idx = map[k] || [];
      return idx.length ? String(r[idx[0]] == null ? '' : r[idx[0]]).trim() : '';
    };
    const seen = {};
    return rows.map((r, i) => {
      const src = {};
      for (const f of FIELDS) src[f.key] = f.key === 'depart' ? departTokens(r, map.depart || [], headers) : get(r, f.key);
      let key = [normLicence(src.licence), norm(src.nom), norm(src.prenom)].join('|');
      if (key === '||') key = 'row:' + FIELDS.map(f => norm(Array.isArray(src[f.key]) ? src[f.key].join(',') : src[f.key])).join('|');
      // lignes identiques (doublons) : clé distincte pour pouvoir écarter l'une sans l'autre
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
    const has = id => !divs.length || divs.includes(id);
    const n = norm(value);
    if (!n) return '';
    const up = String(value).trim().toUpperCase();
    if (divs.includes(up)) return up;
    const d = DEFAULT_ARME[n];
    return d && has(d) ? d : '';
  }

  // Suggestion de division para (règles FR d'IANSEO) à partir de la catégorie handisport et de l'arme.
  function suggestParaDivision(handi, division, ctx) {
    const paras = (ctx.divisions || []).filter(d => d.para).map(d => d.id);
    const n = norm(handi), co = division === 'CO';
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
   * Résout et contrôle chaque enregistrement.
   * ctx : { sessions:[{order,name,capacity}], divisions:[{id,name,para}], classes:[{id}], }
   * opts : { values:{depart:{},arme:{}}, corrections:{key:{…}}, licences:{CODE:{found,…}}, licencesChecked:bool, coMax }
   */
  function processRecords(records, ctx, opts) {
    const values = opts.values || {};
    const depMap = values.depart || {}, armeMap = values.arme || {};
    const classIds = (ctx.classes || []).map(c => c.id);
    const divIds = (ctx.divisions || []).map(d => d.id);
    const paraDivs = new Set((ctx.divisions || []).filter(d => d.para).map(d => d.id));
    const sessionIds = (ctx.sessions || []).map(s => String(s.order));
    const lic = opts.licences || {};
    const corrections = opts.corrections || {};

    const recs = records.map(r => {
      const c = corrections[r.key] || null;
      const f = (c && c.fields) || {};
      const src = r.src;
      const rec = {
        line: r.line, key: r.key, src, correction: c, errors: [], warnings: [], infos: [],
        excluded: !!(c && c.exclude),
      };
      rec.licence = normLicence(f.licence != null ? f.licence : src.licence);
      rec.sessions = f.sessions ? f.sessions.map(String)
        : [...new Set(src.depart.map(t => depMap[t] != null && depMap[t] !== '' ? String(depMap[t]) : defaultSession(t, ctx)))];
      rec.division = f.division != null ? f.division
        : (armeMap[src.arme] != null && armeMap[src.arme] !== '' ? armeMap[src.arme] : defaultDivision(src.arme, ctx));
      rec.sex = f.sex || sexCode(src.sexe);
      rec.classe = f.classe != null ? f.classe : buildClass(src.categorie, rec.sex, classIds);
      rec.handi = !!(src.handi || /handi/.test(norm(src.classement)));
      rec.noBase = !!(c && c.noBase);
      rec.full = rec.noBase ? Object.assign({
        nom: src.nom, prenom: src.prenom, sex: rec.sex, clubCode: clubCode(src.club), club: src.club,
        naissance: isoDate(src.naissance),
      }, c.full || {}) : null;

      if (rec.excluded) return rec;

      // erreurs bloquantes (données inexploitables)
      if (!rec.licence) rec.errors.push('Licence manquante');
      const unmapped = f.sessions ? [] : src.depart.filter(t => !(depMap[t] != null && depMap[t] !== '' ? String(depMap[t]) : defaultSession(t, ctx)));
      unmapped.forEach(t => rec.errors.push(`Départ « ${t} » non associé à une session`));
      rec.sessions = rec.sessions.filter(Boolean);
      if (!rec.sessions.length && !unmapped.length) rec.errors.push('Aucun départ');
      rec.sessions.forEach(s => { if (sessionIds.length && !sessionIds.includes(s)) rec.errors.push(`La session ${s} n'existe pas dans la compétition`); });
      if (!rec.division) rec.errors.push(`Arme « ${src.arme || '(vide)'} » non associée à une division`);
      else if (divIds.length && !divIds.includes(rec.division)) rec.errors.push(`Division ${rec.division} absente de la compétition`);
      if (!rec.classe) {
        if (src.categorie || f.classe != null) rec.errors.push(`Classe impossible à déduire (catégorie « ${src.categorie || '(vide)'} », sexe « ${src.sexe || '(vide)'} »)`);
        else rec.warnings.push('Catégorie vide : choisir la classe');
      } else if (classIds.length && !classIds.includes(rec.classe)) rec.errors.push(`Classe ${rec.classe} absente de la compétition`);
      else if (rec.division) {
        const cl = (ctx.classes || []).find(x => x.id === rec.classe);
        if (cl && cl.divisions && cl.divisions.length && !cl.divisions.includes(rec.division)) {
          rec.errors.push(`Classe ${rec.classe} non autorisée pour la division ${rec.division}`);
        }
      }
      if (rec.noBase) {
        if (!rec.full.nom || !rec.full.prenom) rec.errors.push('Import sans base : nom et prénom obligatoires');
        if (!rec.full.sex) rec.errors.push('Import sans base : sexe obligatoire');
        if (!rec.full.clubCode) rec.errors.push('Import sans base : code club obligatoire');
        if (rec.full.clubCode && rec.full.clubCode.length > 10) rec.errors.push('Code club : 10 caractères maximum');
      }

      // à vérifier
      if (rec.handi && !paraDivs.has(rec.division) && !(c && c.handiOk)) {
        rec.warnings.push(`Handisport${src.handi ? ' (' + src.handi + ')' : ''} : choisir la division`);
      }
      if (rec.licence && opts.licencesChecked) {
        const L = lic[rec.licence];
        rec.base = L && L.found ? L : null;
        if (!rec.base) {
          if (!rec.noBase) rec.warnings.push('Licence introuvable dans la base des licences');
        } else {
          if (rec.noBase) rec.infos.push('Licence trouvée dans la base : l\'import sans base n\'est plus nécessaire');
          if (!rec.base.valid && !(c && c.forceInvalid)) rec.warnings.push(`Licence non valide à la date du concours (${rec.base.statusLabel})`);
          const idOk = sameName(rec.base.nom, src.nom) && sameName(rec.base.prenom, src.prenom) && (!rec.sex || !rec.base.sex || rec.base.sex === rec.sex);
          if (!idOk && !(c && c.identityOk)) rec.warnings.push(`Identité différente dans la base : ${rec.base.nom} ${rec.base.prenom} (${rec.base.sex || '?'})`);
        }
      }
      if (rec.licence && lic[rec.licence] && lic[rec.licence].entries && lic[rec.licence].entries.length) {
        rec.infos.push('Déjà dans la compétition (départ ' + lic[rec.licence].entries.map(e => e.session).join(', ') + ') : sera mis à jour');
      }
      return rec;
    });

    // doublons : même licence sur le même départ
    const seen = new Map();
    for (const r of recs) {
      if (r.excluded || !r.licence) continue;
      for (const s of r.sessions) {
        const k = r.licence + '|' + s;
        if (seen.has(k)) r.errors.push(`Doublon de la ligne ${seen.get(k)} (même licence, départ ${s})`);
        else seen.set(k, r.line);
      }
    }

    for (const r of recs) r.status = r.excluded ? 'excluded' : r.errors.length ? 'error' : r.warnings.length ? 'warn' : 'ok';
    const ok = recs.filter(r => r.status === 'ok');

    // remplissage des départs (lignes ok)
    const sessions = (ctx.sessions && ctx.sessions.length ? ctx.sessions.map(s => String(s.order)) : [...new Set(ok.flatMap(r => r.sessions))])
      .map(s => {
        const list = ok.filter(r => r.sessions.includes(s));
        const def = (ctx.sessions || []).find(x => String(x.order) === s) || {};
        return {
          session: s, name: def.name || '', capacity: def.capacity || 0, total: list.length,
          co: list.filter(r => r.division === 'CO').length,
          trispot: list.filter(r => /tri/i.test(r.src.blason)),
        };
      });
    const coMax = opts.coMax ? +opts.coMax : 0;
    sessions.forEach(s => {
      s.over = (s.capacity && s.total > s.capacity) || (coMax && s.co > coMax);
    });

    const lines = ok.flatMap(r => r.sessions.map(s => toLine(r, s)));

    const count = st => recs.filter(r => r.status === st).length;
    return {
      recs, sessions, lines,
      counts: { total: recs.length, ok: ok.length, warn: count('warn'), error: count('error'), excluded: count('excluded'), lines: lines.length },
    };
  }

  // Une ligne « Import liste ». Format court si la licence est dans la base (IANSEO complète le reste),
  // format complet (16 colonnes) pour un archer importé sans base.
  function toLine(r, session) {
    const base = [r.licence, session, r.division, r.classe];
    if (!r.noBase) return base.join('\t');
    const f = r.full;
    return [...base, '', '1', '1', '1', '1', '1', clean(f.nom).toUpperCase(), clean(f.prenom),
      f.sex === 'H' ? 'M' : 'F', clean(f.clubCode).toUpperCase(), clean(f.club), f.naissance || ''].join('\t');
  }

  const api = {
    FIELDS, BUILTIN_PROFILES, DEFAULT_ARME,
    norm, decodeText, parseCSV, detectDelimiter, normLicence, sexCode, buildClass, splitTokens, departTokens,
    isoDate, clubCode, sameName, detectProfile, resolveColumns, columnsToNames, readRecords,
    defaultSession, defaultDivision, suggestParaDivision, processRecords, toLine,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IICore = api;
})(typeof window !== 'undefined' ? window : this);
