/*
 * Import inscriptions — interface de la page (dépend de core.js et de window.II_CONTEXT, fourni par index.php).
 */
(function () {
  'use strict';
  const C = window.IICore;
  const ctx = window.II_CONTEXT;
  const app = document.getElementById('ii-app');

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isObj = o => o && typeof o === 'object' && !Array.isArray(o);

  const state = {
    fileName: '', headers: [], rows: [], records: [],
    profiles: C.BUILTIN_PROFILES.concat(Array.isArray(ctx.profiles) ? ctx.profiles : []),
    profileId: 'custom', map: {}, values: { depart: {}, arme: {} }, coMax: '',
    corrections: isObj(ctx.corrections) ? ctx.corrections : {},
    licences: {}, licencePending: false, licenceError: '',
    result: null, filter: 'todo', editing: null, draft: null, search: null, clubs: null,
    update: null, updateMsg: '', fileError: '', busy: false,
  };

  // ---------- API ----------

  async function api(action, body, isForm) {
    const r = await fetch('api.php?action=' + encodeURIComponent(action), {
      method: 'POST', credentials: 'same-origin',
      headers: isForm ? {} : { 'Content-Type': 'application/json' },
      body: isForm ? body : JSON.stringify(body || {}),
    });
    let j;
    try { j = await r.json(); } catch (e) { throw new Error('Réponse invalide du serveur (HTTP ' + r.status + ')'); }
    if (j && j.error) throw new Error(j.error);
    return j;
  }

  let saveTimer = null;
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api('settings', { settings: {
        profileId: state.profileId, columns: C.columnsToNames(state.headers, state.map),
        values: state.values, coMax: state.coMax,
      } }).catch(e => console.warn('Import inscriptions : réglages non enregistrés', e));
    }, 400);
  }

  // ---------- fichier ----------

  async function readFile(f) {
    state.fileError = '';
    state.fileName = f.name;
    let rows;
    try {
      if (/\.(xlsx|xls|ods)$/i.test(f.name)) {
        const fd = new FormData();
        fd.append('file', f);
        rows = (await api('parse', fd, true)).rows;
      } else {
        rows = C.parseCSV(C.decodeText(await f.arrayBuffer()));
      }
    } catch (e) {
      state.fileError = 'Lecture impossible : ' + e.message;
      return render();
    }
    if (!rows || rows.length < 2) { state.fileError = 'Fichier vide ou sans données.'; return render(); }
    state.headers = rows[0].map(h => String(h == null ? '' : h).trim());
    state.rows = rows.slice(1).map(r => r.map(v => v == null ? '' : String(v)));
    applyInitialMapping();
    state.editing = null;
    recompute();
  }

  // Réglages de la compétition s'ils correspondent à ce fichier, sinon profil détecté.
  function applyInitialMapping() {
    const s = isObj(ctx.settings) ? ctx.settings : {};
    if (s.columns) {
      const map = C.resolveColumns(state.headers, s.columns);
      if (C.FIELDS.filter(f => f.required).every(f => map[f.key] && map[f.key].length)) {
        state.profileId = s.profileId || 'custom';
        state.map = map;
        state.values = normValues(s.values);
        state.coMax = s.coMax || '';
        return;
      }
    }
    applyProfile(C.detectProfile(state.headers, state.profiles));
  }

  function normValues(v) {
    v = isObj(v) ? v : {};
    return { depart: isObj(v.depart) ? v.depart : {}, arme: isObj(v.arme) ? v.arme : {} };
  }

  function applyProfile(p) {
    state.profileId = p.id;
    state.map = C.resolveColumns(state.headers, p.columns || {});
    state.values = normValues(JSON.parse(JSON.stringify(p.values || {})));
    if (p.coMax != null) state.coMax = p.coMax;
  }

  // ---------- calcul ----------

  function recompute() {
    state.records = state.headers.length ? C.readRecords(state.headers, state.rows, state.map) : [];
    const codes = new Set();
    let res = run(false);
    res.recs.forEach(r => r.licence && codes.add(r.licence));
    const missing = [...codes].filter(c => !(c in state.licences));
    const checked = !missing.length && !state.licenceError;
    state.result = checked ? run(true) : res;
    state.result.licencesChecked = checked;
    render();
    if (missing.length && !state.licencePending && !state.licenceError) checkLicences(missing);
  }

  function run(licencesChecked) {
    return C.processRecords(state.records, ctx, {
      values: state.values, corrections: state.corrections, licences: state.licences,
      licencesChecked, coMax: state.coMax,
    });
  }

  async function checkLicences(codes) {
    state.licencePending = true;
    render();
    try {
      const res = await api('licences', { codes });
      Object.assign(state.licences, res.licences || {});
      codes.forEach(c => { if (!(c in state.licences)) state.licences[c] = { found: false, entries: [] }; });
    } catch (e) {
      state.licenceError = 'Vérification des licences impossible : ' + e.message;
    }
    state.licencePending = false;
    recompute();
  }

  // ---------- corrections ----------

  async function saveCorrection(key, correction) {
    state.busy = true; render();
    try {
      const res = await api('correction', { key, correction });
      state.corrections = isObj(res.corrections) ? res.corrections : {};
    } catch (e) {
      alertMsg('Correction non enregistrée : ' + e.message);
    }
    state.busy = false;
    recompute();
  }

  function openEditor(key) {
    const rec = state.result.recs.find(r => r.key === key);
    if (!rec) return;
    const c = rec.correction || {};
    const div = rec.handi && !(ctx.divisions || []).some(d => d.para && d.id === rec.division)
      ? (C.suggestParaDivision(rec.src.handi, rec.division, ctx) || rec.division) : rec.division;
    state.editing = key;
    state.search = null;
    state.draft = {
      licence: rec.licence, sessions: rec.sessions.slice(), division: div, classe: rec.classe, sex: rec.sex,
      identityOk: !!c.identityOk, forceInvalid: !!c.forceInvalid, handiOk: !!c.handiOk, noBase: !!c.noBase,
      full: Object.assign({
        nom: rec.src.nom, prenom: rec.src.prenom, sex: rec.sex, clubCode: C.clubCode(rec.src.club),
        club: rec.src.club, naissance: C.isoDate(rec.src.naissance),
      }, c.full || {}),
    };
    render();
    const row = document.getElementById('ii-edit');
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // N'enregistre que ce qui diffère de la ligne d'origine.
  function draftToCorrection(rec) {
    const orig = C.processRecords([{ line: rec.line, key: rec.key, src: rec.src }], ctx, {
      values: state.values, corrections: {}, licences: {}, licencesChecked: false,
    }).recs[0];
    const d = state.draft, fields = {};
    if (C.normLicence(d.licence) !== orig.licence) fields.licence = C.normLicence(d.licence);
    if (d.sessions.slice().sort().join(',') !== orig.sessions.slice().sort().join(',')) fields.sessions = d.sessions.slice().sort((a, b) => a - b);
    if (d.division !== orig.division) fields.division = d.division;
    if (d.classe !== orig.classe) fields.classe = d.classe;
    if (d.sex && d.sex !== orig.sex) fields.sex = d.sex;
    const c = { at: new Date().toISOString(), fields };
    ['identityOk', 'forceInvalid', 'handiOk', 'noBase'].forEach(k => { if (d[k]) c[k] = true; });
    if (d.noBase) c.full = d.full;
    if (rec.correction && rec.correction.exclude) c.exclude = true;
    return c;
  }

  async function loadClubs() {
    if (state.clubs) return;
    state.clubs = [];
    try { state.clubs = (await api('clubs')).clubs || []; } catch (e) { state.clubs = []; }
    render();
  }

  async function searchByName(nom, prenom) {
    state.search = { pending: true, results: [] };
    render();
    try {
      state.search = { results: (await api('search', { nom, prenom })).results || [] };
    } catch (e) {
      state.search = { error: e.message, results: [] };
    }
    render();
  }

  // ---------- profils ----------

  async function saveProfile(name) {
    const columns = C.columnsToNames(state.headers, state.map);
    const used = [].concat(...Object.values(columns));
    const p = {
      id: 'u-' + Date.now().toString(36), name, detect: used, columns,
      values: state.values, coMax: state.coMax,
    };
    try {
      const res = await api('profile', { profile: p });
      state.profiles = C.BUILTIN_PROFILES.concat(res.profiles || []);
      state.profileId = p.id;
      saveSettings();
      render();
    } catch (e) { alertMsg('Profil non enregistré : ' + e.message); }
  }

  async function deleteProfile(id) {
    try {
      const res = await api('profile', { delete: id });
      state.profiles = C.BUILTIN_PROFILES.concat(res.profiles || []);
      if (state.profileId === id) state.profileId = 'custom';
      saveSettings();
      render();
    } catch (e) { alertMsg('Suppression impossible : ' + e.message); }
  }

  // ---------- mise à jour ----------

  async function checkUpdate(force) {
    if (!ctx.isAdmin) return;
    try { state.update = await api('update-check', { force: !!force }); }
    catch (e) { state.update = { error: e.message }; }
    render();
  }

  async function installUpdate() {
    state.updateMsg = 'Installation en cours…';
    render();
    try {
      const res = await api('update-install');
      state.updateMsg = 'Version ' + res.version + ' installée. Rechargez la page.';
      state.update = null;
      state.updateDone = true;
    } catch (e) {
      state.updateMsg = 'Échec : ' + e.message;
    }
    render();
  }

  // ---------- import ----------

  function submitImport() {
    const res = state.result;
    if (!res || !res.lines.length) return;
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = ctx.listLoadUrl;
    const add = (name, value) => {
      const el = document.createElement(name === 'txtList' ? 'textarea' : 'input');
      el.name = name; el.value = value;
      if (el.tagName === 'INPUT') el.type = 'hidden';
      form.appendChild(el);
    };
    add('txtList', res.lines.join('\n'));
    add('TextList', '1');
    if (document.getElementById('ii-overwrite').checked) add('OverwritePreviousArchers', '1');
    form.style.display = 'none';
    document.body.appendChild(form);
    form.submit();
  }

  let msgTimer;
  function alertMsg(m) {
    state.flash = m;
    render();
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { state.flash = ''; render(); }, 6000);
  }

  // ---------- rendu ----------

  const sessionLabel = s => s.order + (s.name ? ' – ' + s.name : '');
  const STATUS = { error: 'Erreur', warn: 'À vérifier', ok: 'Prête', excluded: 'Écartée' };

  function render() {
    const focus = document.activeElement && document.activeElement.id;
    app.innerHTML = [
      renderHeader(),
      ctx.lookupCount ? '' : `<div class="ii-alert ii-err"><b>Base des licences vide</b> pour le code « ${esc(ctx.tour.ioc || '?')} » : l'import est bloqué.
        Chargez-la d'abord via <a href="${esc(ctx.syncUrl)}">Participants › Synchronisation des compétiteurs</a>.</div>`,
      ctx.sessions.length ? '' : '<div class="ii-alert ii-warn">Aucune session de qualification n\'est définie dans la compétition (Compétition › Gestion des sessions).</div>',
      state.flash ? `<div class="ii-alert ii-warn">${esc(state.flash)}</div>` : '',
      renderFile(),
      state.headers.length ? renderColumns() + renderValues() + renderCheck() + renderImport() : '',
    ].join('');
    bind();
    if (focus) { const el = document.getElementById(focus); if (el) el.focus(); }
  }

  function renderHeader() {
    let upd = '';
    const u = state.update;
    if (state.updateMsg) {
      upd = `<div class="ii-alert ${state.updateDone ? 'ii-ok' : 'ii-warn'}">${esc(state.updateMsg)}
        ${state.updateDone ? '<button type="button" data-act="reload">Recharger</button>' : ''}</div>`;
    } else if (u && u.available) {
      upd = `<div class="ii-alert ii-info"><b>Version ${esc(u.latest)} disponible</b> (installée : ${esc(ctx.version)}).
        <button type="button" data-act="update">Mettre à jour</button>
        ${u.url ? `<a href="${esc(u.url)}" target="_blank" rel="noopener">Notes de version</a>` : ''}
        ${u.notes ? `<details><summary>Nouveautés</summary><pre>${esc(u.notes)}</pre></details>` : ''}</div>`;
    }
    return `<div class="ii-head"><h2>Import inscriptions (CSV/Excel)</h2>
      <span class="ii-muted">v${esc(ctx.version)}${ctx.isAdmin && u && !u.available ? (u.error
        ? ` · vérification des mises à jour impossible (${esc(u.error)}) <button type="button" class="ii-link" data-act="update-check">Réessayer</button>`
        : ' · à jour <button type="button" class="ii-link" data-act="update-check">Vérifier</button>') : ''}</span></div>${upd}`;
  }

  function renderFile() {
    const p = state.profiles.find(x => x.id === state.profileId);
    return `<section class="ii-box"><h3>1. Fichier des inscriptions</h3>
      <div id="ii-drop" class="ii-drop" tabindex="0">Déposer le fichier ici (.csv, .xlsx, .xls, .ods) ou <u>cliquer pour choisir</u></div>
      <input type="file" id="ii-file" accept=".csv,.txt,.xlsx,.xls,.ods" hidden>
      ${state.fileError ? `<p class="ii-e">${esc(state.fileError)}</p>` : ''}
      ${state.headers.length ? `<p>${esc(state.fileName)} — ${state.rows.length} ligne(s), ${state.headers.length} colonne(s).</p>
      <div class="ii-row">
        <label>Profil <select id="ii-profile">${state.profiles.map(x =>
          `<option value="${esc(x.id)}" ${x.id === state.profileId ? 'selected' : ''}>${esc(x.name)}${x.builtin ? '' : ' (enregistré)'}</option>`).join('')}</select></label>
        ${p && !p.builtin ? `<button type="button" class="ii-link" data-act="profile-del" data-id="${esc(p.id)}">Supprimer ce profil</button>` : ''}
        <span class="ii-sep"></span>
        <input type="text" id="ii-profile-name" placeholder="Nom du nouveau profil" size="22">
        <button type="button" data-act="profile-save">Enregistrer ces réglages comme profil</button>
      </div>` : ''}
    </section>`;
  }

  function renderColumns() {
    const missing = C.FIELDS.filter(f => f.required && !(state.map[f.key] || []).length);
    const opts = (sel, multi) => (multi ? '' : '<option value="-1">— aucune —</option>') +
      state.headers.map((h, i) => `<option value="${i}" ${sel.includes(i) ? 'selected' : ''}>${esc(h || '(colonne ' + (i + 1) + ')')}</option>`).join('');
    return `<section class="ii-box"><details ${missing.length ? 'open' : ''}><summary><h3>2. Colonnes</h3>
      ${missing.length ? `<span class="ii-e">À associer : ${missing.map(f => esc(f.label)).join(', ')}</span>`
        : '<span class="ii-muted">toutes les colonnes nécessaires sont associées</span>'}</summary>
      <div class="ii-grid">${C.FIELDS.map(f => {
        const sel = state.map[f.key] || [];
        return `<label>${esc(f.label)}${f.required ? ' *' : ''}
          <select data-col="${f.key}" ${f.multi ? 'multiple size="4"' : ''}>${opts(sel, f.multi)}</select>
          ${f.multi ? '<small class="ii-muted">Plusieurs colonnes possibles (Ctrl/Cmd + clic) : une case « oui / x » vaut le nom de la colonne.</small>' : ''}</label>`;
      }).join('')}</div>
      <p class="ii-muted">La classe peut être dans une colonne (S1H) ou en deux (catégorie S1 + sexe Homme). Plusieurs départs dans une même cellule sont séparés par des virgules.</p>
    </details></section>`;
  }

  function renderValues() {
    const deps = [...new Set(state.records.flatMap(r => r.src.depart))].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
    const armes = [...new Set(state.records.map(r => r.src.arme))].sort((a, b) => a.localeCompare(b, 'fr'));
    const depSel = t => {
      const cur = state.values.depart[t] != null && state.values.depart[t] !== '' ? String(state.values.depart[t]) : C.defaultSession(t, ctx);
      return `<select data-val="depart" data-v="${esc(t)}"><option value="">—</option>${ctx.sessions.map(s =>
        `<option value="${s.order}" ${String(s.order) === cur ? 'selected' : ''}>${esc(sessionLabel(s))}</option>`).join('')}</select>`;
    };
    const armeSel = a => {
      const cur = state.values.arme[a] != null && state.values.arme[a] !== '' ? state.values.arme[a] : C.defaultDivision(a, ctx);
      return `<select data-val="arme" data-v="${esc(a)}"><option value="">—</option>${ctx.divisions.map(d =>
        `<option value="${esc(d.id)}" ${d.id === cur ? 'selected' : ''}>${esc(d.id + ' – ' + d.name)}</option>`).join('')}</select>`;
    };
    return `<section class="ii-box"><h3>3. Correspondance des valeurs</h3><div class="ii-cols">
      <table class="ii-t"><tr><th>Départ dans le fichier</th><th>Session IANSEO</th></tr>
        ${deps.length ? deps.map(t => `<tr><td>${esc(t)}</td><td>${depSel(t)}</td></tr>`).join('') : '<tr><td colspan="2" class="ii-muted">—</td></tr>'}</table>
      <table class="ii-t"><tr><th>Arme dans le fichier</th><th>Division IANSEO</th></tr>
        ${armes.length ? armes.map(a => `<tr><td>${esc(a || '(vide)')}</td><td>${armeSel(a)}</td></tr>`).join('') : '<tr><td colspan="2" class="ii-muted">—</td></tr>'}</table>
      </div>
      <p><label>Arcs à poulies maximum par départ <input type="number" id="ii-comax" min="0" value="${esc(state.coMax)}" placeholder="sans limite" style="width:7em"></label></p>
    </section>`;
  }

  function renderCheck() {
    const res = state.result, c = res.counts;
    const chip = (k, label, n) => `<button type="button" class="ii-tab ${state.filter === k ? 'on' : ''}" data-filter="${k}">${label} <b>${n}</b></button>`;
    const order = { error: 0, warn: 1, ok: 2, excluded: 3 };
    const recs = res.recs.filter(r => state.filter === 'all' || (state.filter === 'todo' ? (r.status === 'error' || r.status === 'warn') : r.status === state.filter))
      .sort((a, b) => order[a.status] - order[b.status] || a.line - b.line);
    const sess = res.sessions.map(s => `<span class="ii-chip ${s.over ? 'ii-over' : ''}">Départ ${esc(s.session)}${s.name ? ' (' + esc(s.name) + ')' : ''} :
      <b>${s.total}${s.capacity ? '/' + s.capacity : ''}</b>${state.coMax ? ` · CO ${s.co}/${esc(state.coMax)}` : (s.co ? ` · ${s.co} CO` : '')}</span>`).join('');
    const lic = state.licencePending ? '<p class="ii-muted">Vérification des licences dans la base…</p>'
      : state.licenceError ? `<p class="ii-e">${esc(state.licenceError)} <button type="button" data-act="lic-retry">Réessayer</button></p>` : '';
    return `<section class="ii-box"><h3>4. Contrôle</h3>${lic}
      <div class="ii-row">${chip('todo', 'À traiter', c.error + c.warn)}${chip('ok', 'Prêtes', c.ok)}${chip('excluded', 'Écartées', c.excluded)}${chip('all', 'Toutes', c.total)}</div>
      <div class="ii-row">${sess}</div>
      <div class="ii-scroll"><table class="ii-t ii-list"><tr><th>Ligne</th><th>Statut</th><th>Licence</th><th>Nom (fichier)</th><th>Départ</th><th>Div.</th><th>Classe</th><th>Détails</th><th></th></tr>
      ${recs.length ? recs.map(renderRow).join('') : `<tr><td colspan="9" class="ii-muted">${state.filter === 'todo' ? 'Rien à traiter.' : 'Aucune ligne.'}</td></tr>`}
      </table></div></section>`;
  }

  function renderRow(r) {
    const msgs = r.errors.map(m => `<div class="ii-e">${esc(m)}</div>`).join('') +
      r.warnings.map(m => `<div class="ii-w">${esc(m)}</div>`).join('') +
      r.infos.map(m => `<div class="ii-muted">${esc(m)}</div>`).join('') +
      (r.base ? `<div class="ii-muted">Base : ${esc(r.base.nom)} ${esc(r.base.prenom)} · ${esc(r.base.club)}</div>` : '') +
      (r.correction ? `<div class="ii-muted">Corrigée le ${esc(new Date(r.correction.at).toLocaleString('fr-FR'))}</div>` : '');
    const acts = r.status === 'excluded'
      ? '<button type="button" data-act="include">Réintégrer</button>'
      : `<button type="button" data-act="edit">Corriger</button> <button type="button" class="ii-link" data-act="exclude">Écarter</button>`;
    const row = `<tr class="ii-${r.status}" data-key="${esc(r.key)}"><td>${r.line}</td><td><span class="ii-badge">${STATUS[r.status]}</span></td>
      <td>${esc(r.licence)}</td><td>${esc(r.src.nom)} ${esc(r.src.prenom)}</td><td>${esc(r.sessions.join(', '))}</td>
      <td>${esc(r.division)}</td><td>${esc(r.classe)}</td><td>${msgs}</td><td class="ii-nowrap">${acts}</td></tr>`;
    return row + (state.editing === r.key ? renderEditor(r) : '');
  }

  function renderEditor(r) {
    const d = state.draft;
    const L = state.licences[C.normLicence(d.licence)];
    const known = L !== undefined;
    const base = L && L.found ? L : null;
    const idDiff = base && !(C.sameName(base.nom, r.src.nom) && C.sameName(base.prenom, r.src.prenom) && (!r.sex || base.sex === r.sex));
    const sr = state.search;
    const handiInfo = r.handi ? `<p class="ii-w">Handisport${r.src.handi ? ' : ' + esc(r.src.handi) : ''}${r.src.classement ? ' (' + esc(r.src.classement) + ')' : ''}. Choisir la division para correspondante.</p>` : '';
    return `<tr id="ii-edit" class="ii-editor"><td colspan="9"><div class="ii-form">
      <div class="ii-grid">
        <label>Licence <span class="ii-row"><input type="text" id="ii-d-licence" value="${esc(d.licence)}" size="12">
          <button type="button" data-act="search">Chercher par nom</button></span>
          ${known ? (base ? `<small>Base : ${esc(base.nom)} ${esc(base.prenom)} (${esc(base.sex)}) · ${esc(base.club)}${base.naissance ? ' · né(e) le ' + esc(base.naissance) : ''}</small>`
            : '<small class="ii-w">Introuvable dans la base</small>') : '<small class="ii-muted">vérifiée à l\'enregistrement</small>'}
        </label>
        <fieldset><legend>Départ(s)</legend>${ctx.sessions.map(s =>
          `<label class="ii-chk"><input type="checkbox" data-d-session="${s.order}" ${d.sessions.includes(String(s.order)) ? 'checked' : ''}> ${esc(sessionLabel(s))}</label>`).join('')}</fieldset>
        <label>Division <select id="ii-d-division"><option value="">—</option>${ctx.divisions.map(x =>
          `<option value="${esc(x.id)}" ${x.id === d.division ? 'selected' : ''}>${esc(x.id + ' – ' + x.name)}${x.para ? ' (para)' : ''}</option>`).join('')}</select></label>
        <label>Classe <select id="ii-d-classe"><option value="">—</option>${ctx.classes.map(x =>
          `<option value="${esc(x.id)}" ${x.id === d.classe ? 'selected' : ''}>${esc(x.id + ' – ' + x.name)}</option>`).join('')}</select></label>
      </div>
      ${handiInfo}
      ${r.handi ? `<label class="ii-chk"><input type="checkbox" id="ii-d-handiOk" ${d.handiOk ? 'checked' : ''}> Garder une division non para</label>` : ''}
      ${sr ? `<div class="ii-search">${sr.pending ? 'Recherche…' : sr.error ? `<span class="ii-e">${esc(sr.error)}</span>` : sr.results.length
        ? `<table class="ii-t"><tr><th>Licence</th><th>Nom</th><th>Club</th><th>Naissance</th><th>Div./classe (base)</th><th></th></tr>${sr.results.map(x =>
          `<tr><td>${esc(x.licence)}</td><td>${esc(x.nom)} ${esc(x.prenom)} (${esc(x.sex)})</td><td>${esc(x.club)}</td><td>${esc(x.naissance)}</td><td>${esc(x.division)} ${esc(x.classe)}</td>
          <td><button type="button" data-pick="${esc(x.licence)}">Choisir</button></td></tr>`).join('')}</table>`
        : 'Aucun archer de ce nom dans la base.'}</div>` : ''}
      ${idDiff ? `<p class="ii-w">Le fichier indique ${esc(r.src.nom)} ${esc(r.src.prenom)}${r.sex ? ' (' + esc(r.sex) + ')' : ''}, la base ${esc(base.nom)} ${esc(base.prenom)} (${esc(base.sex)}).</p>
        <label class="ii-chk"><input type="checkbox" id="ii-d-identityOk" ${d.identityOk ? 'checked' : ''}> C'est bien cet archer (IANSEO prendra l'identité de la base)</label>` : ''}
      ${base && !base.valid ? `<label class="ii-chk"><input type="checkbox" id="ii-d-forceInvalid" ${d.forceInvalid ? 'checked' : ''}> Importer quand même (licence : ${esc(base.statusLabel)})</label>` : ''}
      ${known && !base ? `<label class="ii-chk"><input type="checkbox" id="ii-d-noBase" ${d.noBase ? 'checked' : ''}> Importer sans base (licence récente ou base pas à jour)</label>` : ''}
      ${known && !base && d.noBase ? renderNoBase(d.full) : ''}
      <div class="ii-row ii-actions">
        <button type="button" data-act="save" ${state.busy ? 'disabled' : ''}>Enregistrer</button>
        ${r.correction ? '<button type="button" data-act="reset">Annuler la correction</button>' : ''}
        <button type="button" class="ii-link" data-act="exclude">Écarter la ligne</button>
        <button type="button" class="ii-link" data-act="close">Fermer</button>
      </div></div></td></tr>`;
  }

  function renderNoBase(f) {
    if (!state.clubs) loadClubs();
    return `<div class="ii-grid ii-nobase">
      <label>Nom <input type="text" id="ii-f-nom" value="${esc(f.nom)}"></label>
      <label>Prénom <input type="text" id="ii-f-prenom" value="${esc(f.prenom)}"></label>
      <label>Sexe <select id="ii-f-sex"><option value="">—</option><option value="H" ${f.sex === 'H' ? 'selected' : ''}>Homme</option><option value="F" ${f.sex === 'F' ? 'selected' : ''}>Femme</option></select></label>
      <label>Date de naissance <input type="date" id="ii-f-naissance" value="${esc(f.naissance)}"></label>
      <label>Code club (10 car. max) <input type="text" id="ii-f-clubCode" list="ii-clubs" maxlength="10" value="${esc(f.clubCode)}"></label>
      <label>Nom du club <input type="text" id="ii-f-club" value="${esc(f.club)}"></label>
      <datalist id="ii-clubs">${(state.clubs || []).map(c => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</datalist>
    </div>`;
  }

  function renderImport() {
    const res = state.result, c = res.counts;
    const trispot = res.sessions.filter(s => s.trispot.length);
    const blocked = !ctx.lookupCount ? 'base des licences vide'
      : !res.licencesChecked ? 'vérification des licences en cours'
      : !res.lines.length ? 'aucune ligne prête' : '';
    return `<section class="ii-box"><h3>5. Import dans IANSEO</h3>
      <p><b>${c.ok}</b> inscription(s) prête(s), soit <b>${res.lines.length}</b> ligne(s) (une par départ).
        ${c.error + c.warn ? `<span class="ii-w">${c.error + c.warn} inscription(s) à traiter ne seront pas importées.</span>` : ''}
        ${c.excluded ? `<span class="ii-muted">${c.excluded} écartée(s).</span>` : ''}</p>
      <label class="ii-chk"><input type="checkbox" id="ii-overwrite" checked> Mettre à jour les archers déjà présents dans la compétition</label>
      <div class="ii-row ii-actions">
        <button type="button" class="ii-primary" data-act="import" ${blocked ? 'disabled' : ''}>Importer ${res.lines.length} ligne(s) dans IANSEO</button>
        ${blocked ? `<span class="ii-muted">(${esc(blocked)})</span>` : ''}
      </div>
      <details><summary>Aperçu du texte envoyé à « Import liste »</summary><textarea readonly rows="8">${esc(res.lines.join('\n'))}</textarea></details>
      ${trispot.length ? `<h4>À reporter à la main : blasons trispot</h4>${trispot.map(s => `<p><b>Départ ${esc(s.session)}</b> (${s.trispot.length}) :
        ${s.trispot.map(r => `${esc(r.src.nom)} ${esc(r.src.prenom)} <span class="ii-muted">${esc(r.licence)} · ${esc(r.division)} ${esc(r.classe)}</span>`).join(' ; ')}</p>`).join('')}` : ''}
    </section>`;
  }

  // ---------- événements ----------

  function bind() {
    const drop = document.getElementById('ii-drop'), file = document.getElementById('ii-file');
    if (drop) {
      drop.onclick = () => file.click();
      drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
      drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); };
      file.onchange = () => file.files[0] && readFile(file.files[0]);
    }
    const prof = document.getElementById('ii-profile');
    if (prof) prof.onchange = () => {
      applyProfile(state.profiles.find(p => p.id === prof.value));
      saveSettings(); recompute();
    };
    app.querySelectorAll('select[data-col]').forEach(s => s.onchange = () => {
      state.map[s.dataset.col] = [...s.selectedOptions].map(o => +o.value).filter(i => i >= 0);
      saveSettings(); recompute();
    });
    app.querySelectorAll('select[data-val]').forEach(s => s.onchange = () => {
      state.values[s.dataset.val][s.dataset.v] = s.value;
      saveSettings(); recompute();
    });
    const comax = document.getElementById('ii-comax');
    if (comax) comax.onchange = () => { state.coMax = comax.value; saveSettings(); recompute(); };
    app.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { state.filter = b.dataset.filter; render(); });

    // brouillon de correction : suivi des saisies sans re-rendu
    const d = state.draft;
    if (d) {
      const val = id => { const el = document.getElementById(id); return el ? el : null; };
      const on = (id, prop, fn) => { const el = val(id); if (el) el.oninput = el.onchange = () => { fn(el); if (prop) render(); }; };
      on('ii-d-licence', false, el => { d.licence = el.value; });
      on('ii-d-division', false, el => { d.division = el.value; });
      on('ii-d-classe', false, el => { d.classe = el.value; });
      ['identityOk', 'forceInvalid', 'handiOk'].forEach(k => on('ii-d-' + k, false, el => { d[k] = el.checked; }));
      on('ii-d-noBase', true, el => { d.noBase = el.checked; });
      ['nom', 'prenom', 'sex', 'naissance', 'club'].forEach(k => on('ii-f-' + k, false, el => { d.full[k] = el.value; }));
      on('ii-f-clubCode', false, el => {
        d.full.clubCode = el.value.toUpperCase();
        const club = (state.clubs || []).find(c => c.code === d.full.clubCode);
        if (club) { d.full.club = club.name; const n = val('ii-f-club'); if (n) n.value = club.name; }
      });
      app.querySelectorAll('[data-d-session]').forEach(cb => cb.onchange = () => {
        const s = cb.dataset.dSession;
        d.sessions = cb.checked ? [...new Set(d.sessions.concat(s))] : d.sessions.filter(x => x !== s);
      });
      app.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
        d.licence = b.dataset.pick;
        state.search = null;
        if (!(d.licence in state.licences)) {
          api('licences', { codes: [d.licence] }).then(res => { Object.assign(state.licences, res.licences || {}); render(); }).catch(() => {});
        }
        render();
      });
    }

    app.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act, b));
  }

  function keyOf(el) {
    const tr = el.closest('tr[data-key]') || (el.closest('#ii-edit') && { dataset: { key: state.editing } });
    return tr ? tr.dataset.key : null;
  }

  function act(a, el) {
    const key = keyOf(el);
    const rec = key && state.result.recs.find(r => r.key === key);
    switch (a) {
      case 'edit': return openEditor(key);
      case 'close': state.editing = null; state.draft = null; return render();
      case 'exclude': {
        const c = Object.assign({}, rec.correction || {}, { exclude: true, at: new Date().toISOString() });
        if (!c.fields) c.fields = {};
        state.editing = null; state.draft = null;
        return saveCorrection(key, c);
      }
      case 'include': {
        const c = Object.assign({}, rec.correction || {});
        delete c.exclude;
        const empty = !Object.keys(c.fields || {}).length && !['identityOk', 'forceInvalid', 'handiOk', 'noBase'].some(k => c[k]);
        return saveCorrection(key, empty ? null : c);
      }
      case 'reset': state.editing = null; state.draft = null; return saveCorrection(key, null);
      case 'save': {
        const c = draftToCorrection(rec);
        state.editing = null; state.draft = null;
        return saveCorrection(key, c);
      }
      case 'search': return searchByName(rec.src.nom, rec.src.prenom);
      case 'import': return submitImport();
      case 'lic-retry': state.licenceError = ''; return recompute();
      case 'profile-save': {
        const n = document.getElementById('ii-profile-name').value.trim();
        if (!n) return alertMsg('Donnez un nom au profil.');
        return saveProfile(n);
      }
      case 'profile-del': return deleteProfile(el.dataset.id);
      case 'update': return installUpdate();
      case 'update-check': return checkUpdate(true);
      case 'reload': return location.reload();
    }
  }

  render();
  checkUpdate(false);
})();
