/*
 * Entry import — page UI. Depends on core.js, i18n.js and window.II_CONTEXT (provided by index.php).
 * Single state object, full re-render through innerHTML on every change. The correction being edited lives in
 * state.draft (updated on input events), so an asynchronous re-render never loses what the user typed.
 */
(function () {
  'use strict';
  const C = window.IICore;
  const ctx = window.II_CONTEXT;
  const { t, locale } = window.IIi18n.make(ctx.lang);
  const app = document.getElementById('ii-app');

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Translation with escaped params, for use inside HTML
  const th = (key, params) => {
    if (!params) return t(key);
    const p = {};
    for (const k in params) p[k] = params[k] == null || params[k] === '' ? params[k] : esc(params[k]);
    return t(key, p);
  };
  const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
  const CORRECTION_FLAGS = ['identityOk', 'forceInvalid', 'paraOk', 'noBase'];

  const state = {
    fileName: '', headers: [], rows: [], records: [],
    profiles: C.BUILTIN_PROFILES.concat(Array.isArray(ctx.profiles) ? ctx.profiles : []),
    profileId: 'custom', map: {}, values: { session: {}, division: {}, face: {} }, coMax: '',
    proposalDays: 3, overwrite: true,
    panel: null,      // "Sessions…" panel of a row: { key, rows: { session: { state, priority, to, until } } }
    notes: {},        // notes being typed, per row key (kept across re-renders until saved)
    textFor: null,    // proposal whose text to send by hand is shown: 'key|session'
    corrections: isObj(ctx.corrections) ? ctx.corrections : {},
    licenses: {}, licensePending: false, licenseError: '',
    result: null, filter: 'todo', editing: null, draft: null, search: null, clubs: null,
    channel: ctx.channel || 'stable', update: null, updateMsg: '', updateDone: false,
    fileError: '', flash: '', busy: false,
  };

  const profileName = p => (p.nameKey ? t(p.nameKey) : p.name);

  // Core messages ({k, p}) → HTML text. A para category is shown as " (W1)", or nothing if absent.
  function msgHtml(m) {
    const p = Object.assign({}, m.p || {});
    if ('cat' in p && (m.k === 'warn.para')) p.cat = p.cat ? ' (' + p.cat + ')' : null;
    return th(m.k, p);
  }

  // ---------- API ----------

  async function api(action, body, isForm) {
    const r = await fetch('api.php?action=' + encodeURIComponent(action), {
      method: 'POST', credentials: 'same-origin',
      headers: isForm ? {} : { 'Content-Type': 'application/json' },
      body: isForm ? body : JSON.stringify(body || {}),
    });
    let j;
    try { j = await r.json(); } catch (e) { throw new Error('HTTP ' + r.status); }
    if (j && j.error) throw new Error(j.error);
    return j;
  }

  let saveTimer = null;
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api('settings', { settings: {
        profileId: state.profileId, columns: C.columnsToNames(state.headers, state.map),
        values: state.values, coMax: state.coMax, proposalDays: state.proposalDays,
      } }).catch(e => console.warn('Entry import: settings not saved', e));
    }, 400);
  }

  // ---------- file ----------

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
      state.fileError = t('file.readError', { error: e.message });
      return render();
    }
    if (!rows || rows.length < 2) { state.fileError = t('file.empty'); return render(); }
    state.headers = rows[0].map(h => String(h == null ? '' : h).trim());
    state.rows = rows.slice(1).map(r => r.map(v => (v == null ? '' : String(v))));
    applyInitialMapping();
    state.editing = null;
    recompute();
  }

  // The competition's saved settings if they fit this file, otherwise the detected profile.
  function applyInitialMapping() {
    const s = isObj(ctx.settings) ? ctx.settings : {};
    if (+s.proposalDays > 0) state.proposalDays = +s.proposalDays;
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
    return { session: isObj(v.session) ? v.session : {}, division: isObj(v.division) ? v.division : {}, face: isObj(v.face) ? v.face : {} };
  }

  function applyProfile(p) {
    state.profileId = p.id;
    state.map = C.resolveColumns(state.headers, p.columns || {});
    state.values = normValues(JSON.parse(JSON.stringify(p.values || {})));
    if (p.coMax != null) state.coMax = p.coMax;
  }

  // ---------- processing ----------

  function run(licensesChecked) {
    return C.processRecords(state.records, ctx, {
      values: state.values, corrections: state.corrections, licenses: state.licenses,
      licensesChecked, coMax: state.coMax,
    });
  }

  function recompute() {
    state.records = state.headers.length ? C.readRecords(state.headers, state.rows, state.map) : [];
    const first = run(false);
    const missing = [...new Set(first.recs.map(r => r.license).filter(Boolean))].filter(c => !(c in state.licenses));
    const checked = !missing.length && !state.licenseError;
    state.result = checked ? run(true) : first;
    state.result.licensesChecked = checked;
    render();
    if (missing.length && !state.licensePending && !state.licenseError) checkLicenses(missing);
  }

  async function checkLicenses(codes) {
    state.licensePending = true;
    render();
    try {
      const res = await api('licenses', { codes });
      Object.assign(state.licenses, res.licenses || {});
      codes.forEach(c => { if (!(c in state.licenses)) state.licenses[c] = { found: false, entries: [] }; });
    } catch (e) {
      state.licenseError = e.message;
    }
    state.licensePending = false;
    recompute();
  }

  // ---------- corrections ----------

  async function saveCorrection(key, correction) {
    state.busy = true;
    render();
    try {
      const res = await api('correction', { key, correction });
      state.corrections = isObj(res.corrections) ? res.corrections : {};
    } catch (e) {
      flash(t('edit.saveFailed', { error: e.message }));
    }
    state.busy = false;
    recompute();
  }

  function openEditor(key) {
    const rec = state.result.recs.find(r => r.key === key);
    if (!rec) return;
    const c = rec.correction || {};
    const division = rec.para && !(ctx.divisions || []).some(d => d.para && d.id === rec.division)
      ? (C.suggestParaDivision(rec.src.paraCategory, rec.division, ctx) || rec.division) : rec.division;
    state.editing = key;
    state.search = null;
    state.draft = {
      license: rec.license, sessions: rec.sessions.slice(), division, cls: rec.cls, sex: rec.sex, face: rec.face ? rec.face.name : '',
      identityOk: !!c.identityOk, forceInvalid: !!c.forceInvalid, paraOk: !!c.paraOk, noBase: !!c.noBase,
      full: Object.assign({
        lastName: rec.src.lastName, firstName: rec.src.firstName, sex: rec.sex, clubCode: C.clubCode(rec.src.club),
        club: rec.src.club, birthDate: C.isoDate(rec.src.birthDate),
      }, c.full || {}),
    };
    render();
    const row = document.getElementById('ii-edit');
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Only stores what differs from the original row; states (waiting list, proposals) and the note are kept.
  function draftToCorrection(rec) {
    const orig = C.processRecords([{ line: rec.line, key: rec.key, src: rec.src }], ctx, {
      values: state.values, corrections: {}, licenses: {}, licensesChecked: false,
    }).recs[0];
    const d = state.draft, fields = {};
    const sorted = a => a.slice().sort((x, y) => x - y);
    if (C.normLicense(d.license) !== orig.license) fields.license = C.normLicense(d.license);
    if (sorted(d.sessions).join(',') !== sorted(orig.sessions).join(',')) fields.sessions = sorted(d.sessions);
    if (d.division !== orig.division) fields.division = d.division;
    if (d.cls !== orig.cls) fields.class = d.cls;
    if (d.sex && d.sex !== orig.sex) fields.sex = d.sex;
    // a face chosen here is kept, also when it is the default one the file did not give (it confirms it)
    const origFace = orig.face ? orig.face.name : '';
    if (d.face && (d.face !== origFace || orig.warnings.some(m => m.k === 'warn.faceDefault'))) fields.face = d.face;
    const c = Object.assign(keptStates(rec.correction), { at: new Date().toISOString(), fields });
    CORRECTION_FLAGS.forEach(k => { if (d[k]) c[k] = true; });
    if (d.noBase) c.full = d.full;
    if (rec.correction && rec.correction.exclude) c.exclude = true;
    return c;
  }

  // What "Undo the correction" keeps: the session states and the note (they are not corrections of the data).
  function keptStates(c) {
    const out = {};
    for (const k of ['wait', 'proposals', 'moved', 'note']) if (c && c[k]) out[k] = JSON.parse(JSON.stringify(c[k]));
    return out;
  }

  // ---------- waiting list and proposals ----------

  const freeIn = s => { const x = state.result.sessions.find(y => y.session === String(s)); return x ? x.free : null; };

  // Asks before entering archers in (or proposing) a session without a free place. true = go on.
  function confirmPlaces(sessions) {
    const full = [...new Set(sessions.map(String))].filter(s => freeIn(s) !== null && freeIn(s) < 1);
    return !full.length || window.confirm(t('wait.overConfirm', { sessions: full.join(', ') }));
  }

  function applyTransition(rec, session, action, args) {
    return saveCorrection(rec.key, C.transition(rec.correction, rec, session, action, args));
  }

  function openPanel(rec) {
    const rows = {};
    const until = C.addDays(C.today(), state.proposalDays);
    for (const s of [...new Set(rec.sessions.concat(rec.waiting.map(w => w.session)))].sort((a, b) => a - b)) {
      const p = rec.proposals.find(x => x.from === s), w = rec.waiting.find(x => x.session === s);
      rows[s] = p ? { state: 'propose', to: p.to, until: p.until, priority: 0 }
        : w ? { state: 'wait', priority: w.priority, to: '', until }
        : { state: 'in', priority: 0, to: '', until };
    }
    state.editing = null; state.draft = null;
    state.panel = { key: rec.key, rows };
    render();
  }

  // Applies the panel: each session goes from its current state to the chosen one.
  function savePanel(rec) {
    const p = state.panel;
    let c = rec.correction, r = rec;
    const entering = [], proposing = [];
    for (const s of Object.keys(p.rows)) {
      const want = p.rows[s];
      const prop = rec.proposals.find(x => x.from === s), w = rec.waiting.find(x => x.session === s);
      const cur = prop ? 'propose' : w ? 'wait' : 'in';
      let action = null, args = {};
      if (want.state === 'wait' && (cur !== 'wait' || w.priority !== +want.priority)) { action = 'wait'; args = { priority: +want.priority }; }
      else if (want.state === 'propose') {
        if (!want.to || !want.until) return flash(t('panel.proposalIncomplete'));
        if (cur !== 'propose' || prop.to !== want.to || prop.until !== want.until) { action = 'propose'; args = { to: want.to, until: want.until }; proposing.push(want.to); }
      } else if (want.state === 'in' && cur === 'wait') { action = 'promote'; entering.push(s); }
      else if (want.state === 'in' && cur === 'propose') { action = 'cancel'; entering.push(s); }
      if (action) {
        c = C.transition(c, r, s, action, args);
        // the sessions of the row may have changed (promotion back to a left session)
        if (c && c.fields && c.fields.sessions) r = Object.assign({}, r, { sessions: c.fields.sessions });
      }
    }
    if (!confirmPlaces(entering.concat(proposing))) return;
    state.panel = null;
    return saveCorrection(rec.key, c);
  }

  // Proposal email through Mailer, then recorded as sent
  async function sendProposal(rec, p) {
    state.busy = true;
    render();
    try {
      const res = await api('proposal-mail', { proposal: {
        email: rec.src.email, firstName: rec.base ? rec.base.firstName : rec.src.firstName, lastName: rec.base ? rec.base.lastName : rec.src.lastName,
        license: rec.license, category: rec.division + ' ' + rec.cls, from: p.from, to: p.to, until: p.until,
      } });
      if (!res.ok) throw new Error(t('proposal.notQueued'));
      state.busy = false;
      flash(t('proposal.sent', { email: rec.src.email }));
      return applyTransition(rec, p.from, 'sent');
    } catch (e) {
      state.busy = false;
      flash(t('proposal.sendFailed', { error: e.message }));
    }
  }

  // Text of the proposal, to send by hand when Mailer is not available
  function proposalText(rec, p) {
    const fmt = d => new Date(d + 'T00:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
    return t('proposal.text', {
      firstName: rec.base ? rec.base.firstName : rec.src.firstName, competition: ctx.tour.name,
      from: sessionLong(p.from), to: sessionLong(p.to), until: fmt(p.until),
    });
  }

  function saveNote(key) {
    if (!(key in state.notes)) return;
    const rec = state.result.recs.find(r => r.key === key);
    const note = state.notes[key].trim();
    delete state.notes[key];
    if (!rec || note === (rec.note || '')) return render();
    const c = Object.assign({}, rec.correction || {}, { note });
    if (!note) delete c.note;
    return saveCorrection(key, C.isEmptyCorrection(c) ? null : c);
  }

  async function loadClubs() {
    if (state.clubs) return;
    state.clubs = [];
    try { state.clubs = (await api('clubs')).clubs || []; } catch (e) { state.clubs = []; }
    render();
  }

  async function searchByName(lastName, firstName) {
    state.search = { pending: true, results: [] };
    render();
    try {
      state.search = { results: (await api('search', { lastName, firstName })).results || [] };
    } catch (e) {
      state.search = { error: e.message, results: [] };
    }
    render();
  }

  // ---------- profiles ----------

  async function saveProfile(name) {
    const columns = C.columnsToNames(state.headers, state.map);
    const p = {
      id: 'u-' + Date.now().toString(36), name, detect: [].concat(...Object.values(columns)), columns,
      values: state.values, coMax: state.coMax,
    };
    try {
      const res = await api('profile', { profile: p });
      state.profiles = C.BUILTIN_PROFILES.concat(res.profiles || []);
      state.profileId = p.id;
      saveSettings();
      render();
    } catch (e) { flash(t('profile.saveFailed', { error: e.message })); }
  }

  async function deleteProfile(id) {
    try {
      const res = await api('profile', { delete: id });
      state.profiles = C.BUILTIN_PROFILES.concat(res.profiles || []);
      if (state.profileId === id) state.profileId = 'custom';
      saveSettings();
      render();
    } catch (e) { flash(t('profile.deleteFailed', { error: e.message })); }
  }

  // ---------- updates ----------

  async function checkUpdate(force) {
    if (!ctx.isAdmin) return;
    try { state.update = await api('update-check', { force: !!force }); }
    catch (e) { state.update = { error: e.message }; }
    render();
  }

  async function setChannel(channel) {
    try {
      await api('update-channel', { channel });
      state.channel = channel;
      state.update = null;
      await checkUpdate(true);
    } catch (e) { flash(e.message); }
  }

  async function installUpdate() {
    state.updateMsg = t('update.installing');
    render();
    try {
      const res = await api('update-install');
      state.updateMsg = t('update.done', { version: res.version });
      state.update = null;
      state.updateDone = true;
    } catch (e) {
      state.updateMsg = t('update.failed', { error: e.message });
    }
    render();
  }

  // ---------- import ----------

  // Text sent to List load: the entry lines, then the target faces (they depend on the archers already entered and
  // on the "update" option, see C.targetLines())
  function importLines() {
    const res = state.result;
    const existing = {};
    for (const code of Object.keys(state.licenses)) existing[code] = state.licenses[code].entries || [];
    const rows = res.recs.filter(r => r.status === 'ok');
    return res.lines.concat(C.targetLines(rows, existing, state.overwrite));
  }

  // Posts the ready lines to IANSEO's own "List load" page, which performs the import and shows its report.
  function submitImport() {
    const res = state.result;
    if (!res || !res.lines.length) return;
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = ctx.listLoadUrl;
    const add = (name, value) => {
      const el = document.createElement(name === 'txtList' ? 'textarea' : 'input');
      el.name = name;
      el.value = value;
      if (el.tagName === 'INPUT') el.type = 'hidden';
      form.appendChild(el);
    };
    add('txtList', importLines().join('\n'));
    add('TextList', '1');
    if (state.overwrite) add('OverwritePreviousArchers', '1');
    form.style.display = 'none';
    document.body.appendChild(form);
    form.submit();
  }

  let flashTimer;
  function flash(m) {
    state.flash = m;
    render();
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { state.flash = ''; render(); }, 6000);
  }

  // ---------- rendering ----------

  const sessionLabel = s => s.order + (s.name ? ' – ' + s.name : '');
  // "Session 2 – Saturday afternoon – Saturday 31 October at 15:00" (proposal text)
  function sessionLong(order) {
    const s = ctx.sessions.find(x => String(x.order) === String(order)) || { order, name: '' };
    const start = s.start ? new Date(s.start.replace(' ', 'T')).toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
    return [t('check.session', { s: s.order }), s.name, start].filter(Boolean).join(' – ');
  }

  function render() {
    const focus = document.activeElement && document.activeElement.id;
    app.innerHTML = [
      renderHeader(),
      ctx.lookupCount ? '' : `<div class="ii-alert ii-err">${th('alert.noLookup', { ioc: ctx.tour.ioc || '?', url: ctx.syncUrl })}</div>`,
      ctx.sessions.length ? '' : `<div class="ii-alert ii-warn">${th('alert.noSessions')}</div>`,
      state.flash ? `<div class="ii-alert ii-warn">${esc(state.flash)}</div>` : '',
      renderFile(),
      state.headers.length ? renderColumns() + renderValues() + renderCheck() + renderImport() : '',
    ].join('');
    bind();
    if (focus) { const el = document.getElementById(focus); if (el) el.focus(); }
  }

  function renderHeader() {
    const u = state.update;
    let banner = '';
    if (state.updateMsg) {
      banner = `<div class="ii-alert ${state.updateDone ? 'ii-ok' : 'ii-warn'}">${esc(state.updateMsg)}
        ${state.updateDone ? `<button type="button" data-act="reload">${th('update.reload')}</button>` : ''}</div>`;
    } else if (u && u.available) {
      banner = `<div class="ii-alert ii-info"><b>${th('update.available', { latest: u.latest, current: ctx.version })}</b>
        <button type="button" data-act="update">${th('update.install')}</button>
        ${u.url ? `<a href="${esc(u.url)}" target="_blank" rel="noopener">${th('update.notes')}</a>` : ''}
        ${u.notes ? `<details><summary>${th('update.whatsNew')}</summary><pre>${esc(u.notes)}</pre></details>` : ''}</div>`;
    }
    let status = '';
    if (ctx.isAdmin) {
      if (u && u.error) status = ` · ${th('update.checkFailed', { error: u.error })} <button type="button" class="ii-link" data-act="update-check">${th('update.retry')}</button>`;
      else if (u && !u.available) status = ` · ${th('update.upToDate')} <button type="button" class="ii-link" data-act="update-check">${th('update.check')}</button>`;
      status += ` · <label>${th('update.channel')} <select id="ii-channel">${['stable', 'nightly'].map(c =>
        `<option value="${c}" ${c === state.channel ? 'selected' : ''}>${th('update.channel.' + c)}</option>`).join('')}</select></label>`;
    }
    return `<div class="ii-head"><h2>${th('title')}</h2><span class="ii-muted">v${esc(ctx.version)}${status}</span></div>${banner}`;
  }

  function renderFile() {
    const p = state.profiles.find(x => x.id === state.profileId);
    return `<section class="ii-box"><h3>${th('file.title')}</h3>
      <div id="ii-drop" class="ii-drop" tabindex="0">${th('file.drop')}</div>
      <input type="file" id="ii-file" accept=".csv,.txt,.xlsx,.xls,.ods" hidden>
      ${state.fileError ? `<p class="ii-e">${esc(state.fileError)}</p>` : ''}
      ${state.headers.length ? `<p>${th('file.info', { name: state.fileName, rows: String(state.rows.length), cols: String(state.headers.length) })}</p>
      <div class="ii-row">
        <label>${th('profile.label')} <select id="ii-profile">${state.profiles.map(x =>
          `<option value="${esc(x.id)}" ${x.id === state.profileId ? 'selected' : ''}>${esc(profileName(x))}${x.builtin ? '' : ' ' + th('profile.saved')}</option>`).join('')}</select></label>
        ${p && !p.builtin ? `<button type="button" class="ii-link" data-act="profile-delete" data-id="${esc(p.id)}">${th('profile.delete')}</button>` : ''}
        <span class="ii-sep"></span>
        <input type="text" id="ii-profile-name" placeholder="${esc(t('profile.newName'))}" size="22">
        <button type="button" data-act="profile-save">${th('profile.save')}</button>
      </div>` : ''}
    </section>`;
  }

  function renderColumns() {
    const missing = C.FIELDS.filter(f => f.required && !(state.map[f.key] || []).length);
    const options = (selected, multi) => (multi ? '' : `<option value="-1">${th('columns.none')}</option>`) +
      state.headers.map((h, i) => `<option value="${i}" ${selected.includes(i) ? 'selected' : ''}>${h ? esc(h) : th('columns.column', { n: String(i + 1) })}</option>`).join('');
    return `<section class="ii-box"><details ${missing.length ? 'open' : ''}><summary><h3>${th('columns.title')}</h3>
      ${missing.length ? `<span class="ii-e">${th('columns.missing', { fields: missing.map(f => t('field.' + f.key)).join(', ') })}</span>`
        : `<span class="ii-muted">${th('columns.allMapped')}</span>`}</summary>
      <div class="ii-grid">${C.FIELDS.map(f => `<label>${th('field.' + f.key)}${f.required ? ' *' : ''}
          <select data-col="${f.key}" ${f.multi ? 'multiple size="4"' : ''}>${options(state.map[f.key] || [], f.multi)}</select>
          ${f.multi ? `<small class="ii-muted">${th('columns.multiHint')}</small>` : ''}</label>`).join('')}</div>
      <p class="ii-muted">${th('columns.help')}</p>
    </details></section>`;
  }

  function renderValues() {
    const sort = (a, b) => a.localeCompare(b, locale, { numeric: true });
    const sessions = [...new Set(state.records.flatMap(r => r.src.session))].sort(sort);
    const divisions = [...new Set(state.records.map(r => r.src.division))].sort(sort);
    const sessionSelect = v => {
      const cur = state.values.session[v] != null && state.values.session[v] !== '' ? String(state.values.session[v]) : C.defaultSession(v, ctx);
      return `<select data-val="session" data-v="${esc(v)}"><option value="">—</option>${ctx.sessions.map(s =>
        `<option value="${s.order}" ${String(s.order) === cur ? 'selected' : ''}>${esc(sessionLabel(s))}</option>`).join('')}</select>`;
    };
    const divisionSelect = v => {
      const cur = state.values.division[v] != null && state.values.division[v] !== '' ? state.values.division[v] : C.defaultDivision(v, ctx);
      return `<select data-val="division" data-v="${esc(v)}"><option value="">—</option>${ctx.divisions.map(d =>
        `<option value="${esc(d.id)}" ${d.id === cur ? 'selected' : ''}>${esc(d.id + ' – ' + d.name)}</option>`).join('')}</select>`;
    };
    const table = (head1, head2, list, select) => `<table class="ii-t"><tr><th>${head1}</th><th>${head2}</th></tr>
      ${list.length ? list.map(v => `<tr><td>${v ? esc(v) : th('values.empty')}</td><td>${select(v)}</td></tr>`).join('') : '<tr><td colspan="2" class="ii-muted">—</td></tr>'}</table>`;
    // target faces: by face name; the category of each row decides which face of that name (or its default) applies
    const faceValues = (ctx.faces || []).length && (state.map.targetFace || []).length
      ? [...new Set(state.records.map(r => r.src.targetFace))].sort(sort) : [];
    const faceNames = [...new Set((ctx.faces || []).map(f => f.name))];
    const autoLabel = v => {
      const a = C.autoFace(v, ctx.faces);
      return a === '*' ? t('values.faceDefault') : a === 'tri' ? t('values.faceTri') : a === '' || a === '?' ? t('values.faceUnknown') : a;
    };
    const faceSelect = v => {
      const cur = state.values.face[v] || '';
      return `<select data-val="face" data-v="${esc(v)}"><option value="">${th('values.faceAuto', { what: autoLabel(v) })}</option>
        <option value="*" ${cur === '*' ? 'selected' : ''}>${th('values.faceDefault')}</option>
        <option value="tri" ${cur === 'tri' ? 'selected' : ''}>${th('values.faceTri')}</option>
        ${faceNames.map(n => `<option value="${esc(n)}" ${cur === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
    };
    return `<section class="ii-box"><h3>${th('values.title')}</h3><div class="ii-cols">
      ${table(th('values.sessionInFile'), th('values.sessionIanseo'), sessions, sessionSelect)}
      ${table(th('values.divisionInFile'), th('values.divisionIanseo'), divisions, divisionSelect)}
      ${faceValues.length ? table(th('values.faceInFile'), th('values.faceIanseo'), faceValues, faceSelect) : ''}
      </div>
      <p><label>${th('values.coMax')} <input type="number" id="ii-comax" min="0" value="${esc(state.coMax)}" placeholder="${esc(t('values.noLimit'))}" style="width:7em"></label></p>
    </section>`;
  }

  const COLS = ['line', 'status', 'license', 'name', 'session', 'division', 'class', 'face', 'details', 'note'];

  function renderCheck() {
    const res = state.result, c = res.counts;
    const tab = (k, n) => `<button type="button" class="ii-tab ${state.filter === k ? 'on' : ''}" data-filter="${k}">${th('check.tab.' + k)} <b>${n}</b></button>`;
    const order = { error: 0, warn: 1, ok: 2, excluded: 3 };
    const inTab = r => state.filter === 'all' || (state.filter === 'todo' ? (r.status === 'error' || r.status === 'warn' || (r.attention && !r.excluded)) : r.status === state.filter);
    const recs = res.recs.filter(inTab).sort((a, b) => order[a.status] - order[b.status] || a.line - b.line);
    const chips = res.sessions.map(s => `<span class="ii-chip ${s.over ? 'ii-over' : ''}">${th('check.session', { s: s.session })}${s.name ? ' (' + esc(s.name) + ')' : ''}${th('colon')}
      <b>${s.total}${s.held ? ' + ' + th('check.held', { n: s.held }) : ''}${s.capacity ? '/' + s.capacity : ''}</b>${s.waiting ? ' · ' + th('check.waiting', { n: s.waiting }) : ''}${state.coMax ? ` · ${th('check.co')} ${s.co}/${esc(state.coMax)}` : (s.co ? ` · ${s.co} ${th('check.co')}` : '')}</span>`).join('');
    // places freed (row set aside, session changed…) while archers wait: the organiser decides who goes up
    const freed = res.sessions.filter(s => s.waiting && s.free > 0).map(s =>
      `<div class="ii-alert ii-warn">${th('check.waitlistFree', { s: s.session, free: String(s.free), waiting: String(s.waiting) })}
        <button type="button" class="ii-link" data-filter="waitlist">${th('check.seeWaitlist')}</button></div>`).join('');
    const lic = state.licensePending ? `<p class="ii-muted">${th('check.licensesPending')}</p>`
      : state.licenseError ? `<p class="ii-e">${th('check.licensesError', { error: state.licenseError })} <button type="button" data-act="licenses-retry">${th('check.retry')}</button></p>` : '';
    let body;
    if (state.filter === 'waitlist') body = renderWaitlist();
    else if (state.filter === 'proposals') body = renderProposals();
    else {
      const cols = COLS.map(k => `<th>${th('check.col.' + k)}</th>`).join('');
      body = `<div class="ii-scroll"><table class="ii-t ii-list"><tr>${cols}<th></th></tr>
      ${recs.length ? recs.map(renderRow).join('') : `<tr><td colspan="${COLS.length + 1}" class="ii-muted">${th(state.filter === 'todo' ? 'check.nothingTodo' : 'check.noRows')}</td></tr>`}
      </table></div>`;
    }
    return `<section class="ii-box"><h3>${th('check.title')}</h3>${lic}${freed}
      <div class="ii-row">${tab('todo', c.error + c.warn + c.attention)}${tab('ok', c.ok)}${tab('waitlist', c.waitlist)}${tab('proposals', c.proposals)}${tab('excluded', c.excluded)}${tab('all', c.total)}
        <span class="ii-sep"></span><label class="ii-muted">${th('check.proposalDays')} <input type="number" id="ii-propdays" min="1" max="60" value="${esc(state.proposalDays)}" style="width:4em"> ${th('check.days')}</label></div>
      <div class="ii-row">${chips}</div>
      ${body}</section>`;
  }

  // The row's sessions with their state: entered, waiting list, proposal pending, moved from another one
  function sessionCell(r) {
    const out = r.sessions.map(s => {
      const p = r.proposals.find(x => x.from === s), w = r.waiting.find(x => x.session === s);
      if (p) return `<span class="ii-ses ii-ses-prop ${p.expired ? 'ii-ses-late' : ''}" title="${esc(t('ses.proposalTitle', { until: p.until }))}">${esc(s)} → ${esc(p.to)} ?</span>`;
      if (w) return `<span class="ii-ses ii-ses-wait" title="${esc(t('ses.waitTitle'))}">${esc(s)} ⏳</span>`;
      const from = r.moved[s];
      return from ? `<span class="ii-ses" title="${esc(t('ses.movedTitle', { from }))}">${esc(s)} <small>(← ${esc(from)})</small></span>` : `<span class="ii-ses">${esc(s)}</span>`;
    });
    for (const w of r.waiting) if (!r.sessions.includes(w.session)) out.push(`<span class="ii-ses ii-ses-wait" title="${esc(t('ses.waitTitle'))}">${esc(w.session)} ⏳</span>`);
    return out.join(' ');
  }

  function noteBox(r) {
    const v = r.key in state.notes ? state.notes[r.key] : r.note;
    return `<textarea class="ii-note" id="ii-note-${r.line}" data-note="${esc(r.key)}" rows="2" maxlength="1000" placeholder="${esc(t('note.placeholder'))}">${esc(v)}</textarea>`;
  }

  const recName = r => esc(r.src.lastName) + ' ' + esc(r.src.firstName);
  const fmtDay = d => (d ? new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }) : '');
  const fmtStamp = d => (d ? new Date(d.replace(' ', 'T')).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const sessionOptions = (cur, except) => ctx.sessions.filter(s => String(s.order) !== String(except)).map(s => {
    const free = freeIn(s.order);
    return `<option value="${s.order}" ${String(s.order) === String(cur) ? 'selected' : ''}>${esc(sessionLabel(s))}${free !== null ? ' (' + esc(t('panel.free', { n: free })) + ')' : ''}</option>`;
  }).join('');

  function renderWaitlist() {
    const list = C.waitlist(state.result.recs);
    if (!list.length) return `<p class="ii-muted">${th('wait.none')}</p>`;
    return `<div class="ii-scroll"><table class="ii-t ii-list"><tr><th>${th('check.col.session')}</th><th>${th('wait.rank')}</th><th>${th('check.col.name')}</th>
      <th>${th('check.col.license')}</th><th>${th('wait.category')}</th><th>${th('wait.registeredAt')}</th><th>${th('wait.priority')}</th><th>${th('check.col.note')}</th><th></th></tr>
      ${list.map(e => { const r = e.rec; return `<tr class="ii-${r.status}" data-key="${esc(r.key)}" data-session="${esc(e.session)}">
        <td>${esc(e.session)}</td><td>${e.rank}</td><td>${recName(r)}${r.src.comment ? `<div class="ii-comment">${esc(r.src.comment)}</div>` : ''}</td><td>${esc(r.license)}</td>
        <td>${esc(r.division)} ${esc(r.cls)}</td><td>${esc(fmtStamp(r.registeredAt)) || `<span class="ii-muted">${th('wait.line', { n: r.line })}</span>`}</td>
        <td><select data-prio>${C.PRIORITIES.map(p => `<option value="${p}" ${p === e.priority ? 'selected' : ''}>${th('priority.' + p)}</option>`).join('')}</select></td>
        <td>${noteBox(r)}</td>
        <td class="ii-nowrap"><button type="button" data-act="promote" ${state.busy ? 'disabled' : ''}>${th('wait.promote')}</button>
          <button type="button" data-act="panel">${th('action.sessions')}</button>
          <button type="button" class="ii-link" data-act="drop">${th('wait.drop')}</button></td></tr>`
        + (state.panel && state.panel.key === r.key ? renderPanel(r) : ''); }).join('')}
      </table></div><p class="ii-muted">${th('wait.help')}</p>`;
  }

  function renderProposals() {
    const list = [];
    for (const r of state.result.recs) if (!r.excluded) for (const p of r.proposals) list.push({ r, p });
    if (!list.length) return `<p class="ii-muted">${th('proposal.none')}</p>`;
    const mailer = ctx.mailer && ctx.mailer.available;
    return `${mailer ? '' : `<p class="ii-muted">${ctx.mailer && ctx.mailer.installed ? th('proposal.mailerNotReady', { url: ctx.mailer.url }) : th('proposal.noMailer')}</p>`}
      <div class="ii-scroll"><table class="ii-t ii-list"><tr><th>${th('check.col.name')}</th><th>${th('proposal.from')}</th><th>${th('proposal.to')}</th>
      <th>${th('proposal.until')}</th><th>${th('proposal.email')}</th><th>${th('check.col.note')}</th><th></th></tr>
      ${list.map(({ r, p }) => `<tr class="${p.expired ? 'ii-warn' : ''}" data-key="${esc(r.key)}" data-session="${esc(p.from)}">
        <td>${recName(r)}<div class="ii-muted">${esc(r.license)} · ${esc(r.division)} ${esc(r.cls)}</div></td>
        <td>${esc(p.from)}</td><td><b>${esc(p.to)}</b></td>
        <td>${esc(fmtDay(p.until))}${p.expired ? `<div class="ii-w">${th('proposal.expired')}</div>` : ''}</td>
        <td>${esc(r.src.email) || `<span class="ii-muted">${th('proposal.noEmail')}</span>`}
          ${p.sentAt ? `<div class="ii-muted">${th('proposal.sentAt', { date: fmtStamp(p.sentAt) })}</div>` : ''}
          <div class="ii-nowrap">${mailer && r.src.email ? `<button type="button" data-act="send" ${state.busy ? 'disabled' : ''}>${th(p.sentAt ? 'proposal.resend' : 'proposal.send')}</button> ` : ''}
          <button type="button" class="ii-link" data-act="text">${th('proposal.showText')}</button>
          ${!p.sentAt ? `<button type="button" class="ii-link" data-act="mark-sent">${th('proposal.markSent')}</button>` : ''}</div></td>
        <td>${noteBox(r)}</td>
        <td><div class="ii-nowrap"><button type="button" data-act="accept">${th('proposal.accept')}</button>
          <button type="button" data-act="accept-wait">${th('proposal.acceptWait')}</button></div>
          <div class="ii-nowrap"><button type="button" data-act="refuse-wait">${th('proposal.refuseWait')}</button>
          <button type="button" class="ii-link" data-act="refuse-drop">${th('proposal.refuseDrop')}</button></div></td></tr>`
        + (state.textFor === r.key + '|' + p.from ? `<tr><td colspan="7"><textarea readonly rows="9" class="ii-text">${esc(proposalText(r, p))}</textarea></td></tr>` : '')).join('')}
      </table></div>`;
  }

  // "Sessions…" panel: state of each session of the row
  function renderPanel(r) {
    const rows = state.panel.rows;
    return `<tr id="ii-panel" class="ii-editor" data-key="${esc(r.key)}"><td colspan="${COLS.length + 1}"><div class="ii-form">
      <table class="ii-t">${Object.keys(rows).map(s => { const x = rows[s]; return `<tr><td><b>${th('check.session', { s })}</b></td>
        <td><select data-panel-state="${esc(s)}">${['in', 'wait', 'propose'].map(k => `<option value="${k}" ${x.state === k ? 'selected' : ''}>${th('panel.' + k)}</option>`).join('')}</select></td>
        <td>${x.state === 'wait' ? `<label>${th('wait.priority')} <select data-panel-prio="${esc(s)}">${C.PRIORITIES.map(p => `<option value="${p}" ${p === +x.priority ? 'selected' : ''}>${th('priority.' + p)}</option>`).join('')}</select></label>`
          : x.state === 'propose' ? `<label>${th('panel.to')} <select data-panel-to="${esc(s)}"><option value="">—</option>${sessionOptions(x.to, s)}</select></label>
            <label>${th('panel.until')} <input type="date" data-panel-until="${esc(s)}" value="${esc(x.until)}"></label>` : ''}</td></tr>`; }).join('')}</table>
      <p class="ii-muted">${th('panel.help')}</p>
      <div class="ii-row ii-actions"><button type="button" data-act="panel-save" ${state.busy ? 'disabled' : ''}>${th('edit.save')}</button>
        <button type="button" class="ii-link" data-act="panel-close">${th('edit.close')}</button></div></div></td></tr>`;
  }

  function renderRow(r) {
    const details = r.errors.map(m => `<div class="ii-e">${msgHtml(m)}</div>`).join('') +
      r.warnings.map(m => `<div class="ii-w">${msgHtml(m)}</div>`).join('') +
      r.infos.map(m => `<div class="ii-muted">${msgHtml(m)}</div>`).join('') +
      r.proposals.filter(p => p.expired).map(p => `<div class="ii-w">${th('ses.expired', { from: p.from, to: p.to })}</div>`).join('') +
      (r.src.comment ? `<div class="ii-comment">${esc(r.src.comment)}</div>` : '') +
      (r.base ? `<div class="ii-muted">${th('check.base', { name: r.base.lastName + ' ' + r.base.firstName, club: r.base.club })}</div>` : '') +
      (C.hasEdits(r.correction) ? `<div class="ii-muted">${th('check.correctedAt', { date: new Date(r.correction.at).toLocaleString(locale) })}</div>` : '');
    const actions = r.status === 'excluded'
      ? `<button type="button" data-act="include">${th('action.include')}</button>`
      : `<button type="button" data-act="edit">${th('action.edit')}</button> <button type="button" data-act="panel">${th('action.sessions')}</button>
        <button type="button" class="ii-link" data-act="exclude">${th('action.exclude')}</button>`;
    return `<tr class="ii-${r.status}" data-key="${esc(r.key)}"><td>${r.line}</td><td><span class="ii-badge">${th('status.' + r.status)}</span></td>
      <td>${esc(r.license)}</td><td>${esc(r.src.lastName)} ${esc(r.src.firstName)}</td><td class="ii-nowrap">${sessionCell(r)}</td>
      <td>${esc(r.division)}</td><td>${esc(r.cls)}</td><td>${r.face ? esc(r.face.name) : ''}</td><td>${details}</td><td>${noteBox(r)}</td><td class="ii-nowrap">${actions}</td></tr>`
      + (state.editing === r.key ? renderEditor(r) : '')
      + (state.panel && state.panel.key === r.key ? renderPanel(r) : '');
  }

  function renderEditor(r) {
    const d = state.draft;
    const L = state.licenses[C.normLicense(d.license)];
    const known = L !== undefined;
    const base = L && L.found ? L : null;
    const identityDiff = base && !(C.sameName(base.lastName, r.src.lastName) && C.sameName(base.firstName, r.src.firstName) && (!r.sex || base.sex === r.sex));
    const sr = state.search;
    const paraCat = r.src.paraCategory || r.src.classification;
    const searchBox = !sr ? '' : `<div class="ii-search">${sr.pending ? th('edit.searching') : sr.error ? `<span class="ii-e">${esc(sr.error)}</span>` : sr.results.length
      ? `<table class="ii-t"><tr><th>${th('edit.license')}</th><th>${th('check.col.name')}</th><th>${th('edit.col.club')}</th><th>${th('edit.col.birthDate')}</th><th>${th('edit.col.baseDivClass')}</th><th></th></tr>${sr.results.map(x =>
        `<tr><td>${esc(x.license)}</td><td>${esc(x.lastName)} ${esc(x.firstName)} (${esc(x.sex)})</td><td>${esc(x.club)}</td><td>${esc(x.birthDate)}</td><td>${esc(x.division)} ${esc(x.class)}</td>
        <td><button type="button" data-pick="${esc(x.license)}">${th('edit.pick')}</button></td></tr>`).join('')}</table>`
      : th('edit.noResult')}</div>`;
    const faces = C.facesFor(d.division, d.cls, ctx.faces);
    return `<tr id="ii-edit" class="ii-editor"><td colspan="${COLS.length + 1}"><div class="ii-form">
      <div class="ii-grid">
        <label>${th('edit.license')} <span class="ii-row"><input type="text" id="ii-d-license" value="${esc(d.license)}" size="12">
          <button type="button" data-act="search">${th('edit.searchByName')}</button></span>
          ${known ? (base ? `<small>${th('edit.base', { name: base.lastName + ' ' + base.firstName, sex: base.sex, club: base.club })}${base.birthDate ? th('edit.bornOn', { date: base.birthDate }) : ''}</small>`
            : `<small class="ii-w">${th('edit.notFound')}</small>`) : `<small class="ii-muted">${th('edit.checkedOnSave')}</small>`}
        </label>
        <fieldset><legend>${th('edit.sessions')}</legend>${ctx.sessions.map(s =>
          `<label class="ii-chk"><input type="checkbox" data-d-session="${s.order}" ${d.sessions.includes(String(s.order)) ? 'checked' : ''}> ${esc(sessionLabel(s))}</label>`).join('')}</fieldset>
        <label>${th('edit.division')} <select id="ii-d-division"><option value="">—</option>${ctx.divisions.map(x =>
          `<option value="${esc(x.id)}" ${x.id === d.division ? 'selected' : ''}>${esc(x.id + ' – ' + x.name)}${x.para ? ' (' + th('edit.para') + ')' : ''}</option>`).join('')}</select></label>
        <label>${th('edit.class')} <select id="ii-d-class"><option value="">—</option>${ctx.classes.map(x =>
          `<option value="${esc(x.id)}" ${x.id === d.cls ? 'selected' : ''}>${esc(x.id + ' – ' + x.name)}</option>`).join('')}</select></label>
        ${(ctx.faces || []).length ? `<label>${th('edit.face')} <select id="ii-d-face">${faces.length ? faces.map((f, i) =>
          `<option value="${esc(f.name)}" ${f.name === d.face ? 'selected' : ''}>${esc(f.name)}${i === 0 ? ' (' + th('edit.faceDefault') + ')' : ''}</option>`).join('')
          : `<option value="">${th('edit.noFace')}</option>`}</select>
          ${r.src.targetFace ? `<small class="ii-muted">${th('edit.faceInFile', { v: r.src.targetFace })}</small>` : ''}</label>` : ''}
      </div>
      ${r.para ? `<p class="ii-w">${th('edit.paraInfo', { cat: paraCat ? ' (' + paraCat + ')' : null })}</p>
        <label class="ii-chk"><input type="checkbox" id="ii-d-paraOk" ${d.paraOk ? 'checked' : ''}> ${th('edit.paraOk')}</label>` : ''}
      ${searchBox}
      ${identityDiff ? `<p class="ii-w">${th('edit.identityDiff', {
          file: r.src.lastName + ' ' + r.src.firstName + (r.sex ? ' (' + r.sex + ')' : ''),
          base: base.lastName + ' ' + base.firstName + ' (' + base.sex + ')' })}</p>
        <label class="ii-chk"><input type="checkbox" id="ii-d-identityOk" ${d.identityOk ? 'checked' : ''}> ${th('edit.identityOk')}</label>` : ''}
      ${base && !base.valid ? `<label class="ii-chk"><input type="checkbox" id="ii-d-forceInvalid" ${d.forceInvalid ? 'checked' : ''}> ${th('edit.forceInvalid', { status: base.statusLabel })}</label>` : ''}
      ${known && !base ? `<label class="ii-chk"><input type="checkbox" id="ii-d-noBase" ${d.noBase ? 'checked' : ''}> ${th('edit.noBase')}</label>` : ''}
      ${known && !base && d.noBase ? renderNoBase(d.full) : ''}
      <div class="ii-row ii-actions">
        <button type="button" data-act="save" ${state.busy ? 'disabled' : ''}>${th('edit.save')}</button>
        ${r.correction ? `<button type="button" data-act="reset">${th('edit.reset')}</button>` : ''}
        <button type="button" class="ii-link" data-act="exclude">${th('edit.excludeRow')}</button>
        <button type="button" class="ii-link" data-act="close">${th('edit.close')}</button>
      </div></div></td></tr>`;
  }

  function renderNoBase(f) {
    if (!state.clubs) loadClubs();
    return `<div class="ii-grid ii-nobase">
      <label>${th('nobase.lastName')} <input type="text" id="ii-f-lastName" value="${esc(f.lastName)}"></label>
      <label>${th('nobase.firstName')} <input type="text" id="ii-f-firstName" value="${esc(f.firstName)}"></label>
      <label>${th('nobase.sex')} <select id="ii-f-sex"><option value="">—</option><option value="H" ${f.sex === 'H' ? 'selected' : ''}>${th('nobase.male')}</option><option value="F" ${f.sex === 'F' ? 'selected' : ''}>${th('nobase.female')}</option></select></label>
      <label>${th('nobase.birthDate')} <input type="date" id="ii-f-birthDate" value="${esc(f.birthDate)}"></label>
      <label>${th('nobase.clubCode')} <input type="text" id="ii-f-clubCode" list="ii-clubs" maxlength="10" value="${esc(f.clubCode)}"></label>
      <label>${th('nobase.club')} <input type="text" id="ii-f-club" value="${esc(f.club)}"></label>
      <datalist id="ii-clubs">${(state.clubs || []).map(c => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</datalist>
    </div>`;
  }

  function renderImport() {
    const res = state.result, c = res.counts;
    const entryLines = res.lines.filter(l => !l.startsWith('##')).length;
    const faceRows = res.sessions.filter(s => Object.keys(s.faces).length);
    const blocked = !ctx.lookupCount ? 'import.blocked.noLookup'
      : !res.licensesChecked ? 'import.blocked.pending'
      : !res.lines.length ? 'import.blocked.noLines' : '';
    return `<section class="ii-box"><h3>${th('import.title')}</h3>
      <p>${th('import.summary', { ok: String(c.ok), lines: String(entryLines) })}
        ${c.error + c.warn ? `<span class="ii-w">${th('import.notImported', { n: String(c.error + c.warn) })}</span>` : ''}
        ${c.excluded ? `<span class="ii-muted">${th('import.excluded', { n: String(c.excluded) })}</span>` : ''}
        ${c.waitlist + c.proposals ? `<span class="ii-muted">${th('import.waiting', { wait: String(c.waitlist), prop: String(c.proposals) })}</span>` : ''}</p>
      <label class="ii-chk"><input type="checkbox" id="ii-overwrite" ${state.overwrite ? 'checked' : ''}> ${th('import.overwrite')}</label>
      <div class="ii-row ii-actions">
        <button type="button" class="ii-primary" data-act="import" ${blocked ? 'disabled' : ''}>${th('import.button', { n: String(entryLines) })}</button>
        ${blocked ? `<span class="ii-muted">(${th(blocked)})</span>` : ''}
      </div>
      <details ${state.previewOpen ? 'open' : ''} id="ii-preview"><summary>${th('import.preview')}</summary><textarea readonly rows="8">${esc(importLines().join('\n'))}</textarea></details>
      ${faceRows.length ? `<h4>${th('import.faces')}</h4>${faceRows.map(s => `<p><b>${th('check.session', { s: s.session })}</b>${th('colon')}
        ${Object.keys(s.faces).sort().map(n => `${esc(n)} <b>${s.faces[n]}</b>`).join(' · ')}</p>`).join('')}` : ''}
    </section>`;
  }

  // ---------- events ----------

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
    const byId = id => document.getElementById(id);
    const profile = byId('ii-profile');
    if (profile) profile.onchange = () => {
      applyProfile(state.profiles.find(p => p.id === profile.value));
      saveSettings();
      recompute();
    };
    const channel = byId('ii-channel');
    if (channel) channel.onchange = () => setChannel(channel.value);
    app.querySelectorAll('select[data-col]').forEach(s => s.onchange = () => {
      state.map[s.dataset.col] = [...s.selectedOptions].map(o => +o.value).filter(i => i >= 0);
      saveSettings();
      recompute();
    });
    app.querySelectorAll('select[data-val]').forEach(s => s.onchange = () => {
      state.values[s.dataset.val][s.dataset.v] = s.value;
      saveSettings();
      recompute();
    });
    const coMax = byId('ii-comax');
    if (coMax) coMax.onchange = () => { state.coMax = coMax.value; saveSettings(); recompute(); };
    const overwrite = byId('ii-overwrite');
    if (overwrite) overwrite.onchange = () => { state.overwrite = overwrite.checked; render(); };
    const preview = byId('ii-preview');
    if (preview) preview.ontoggle = () => { state.previewOpen = preview.open; };
    const propDays = byId('ii-propdays');
    if (propDays) propDays.onchange = () => { state.proposalDays = Math.max(1, Math.min(60, +propDays.value || 3)); saveSettings(); render(); };
    app.querySelectorAll('[data-note]').forEach(el => {
      el.oninput = () => { state.notes[el.dataset.note] = el.value; };
      el.onchange = () => saveNote(el.dataset.note);
    });
    app.querySelectorAll('select[data-prio]').forEach(el => el.onchange = () => {
      const tr = el.closest('tr'), rec = state.result.recs.find(r => r.key === tr.dataset.key);
      if (rec) applyTransition(rec, tr.dataset.session, 'wait', { priority: +el.value });
    });
    if (state.panel) {
      const rows = state.panel.rows;
      app.querySelectorAll('[data-panel-state]').forEach(el => el.onchange = () => { rows[el.dataset.panelState].state = el.value; render(); });
      app.querySelectorAll('[data-panel-prio]').forEach(el => el.onchange = () => { rows[el.dataset.panelPrio].priority = +el.value; });
      app.querySelectorAll('[data-panel-to]').forEach(el => el.onchange = () => { rows[el.dataset.panelTo].to = el.value; });
      app.querySelectorAll('[data-panel-until]').forEach(el => el.onchange = el.oninput = () => { rows[el.dataset.panelUntil].until = el.value; });
    }
    app.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { state.filter = b.dataset.filter; render(); });

    // correction draft: track input without re-rendering (except when the form layout changes)
    const d = state.draft;
    if (d) {
      const on = (id, rerender, fn) => { const el = byId(id); if (el) el.oninput = el.onchange = () => { fn(el); if (rerender) render(); }; };
      on('ii-d-license', false, el => { d.license = el.value; });
      // the faces offered depend on the division and class
      const keepFace = () => { const f = C.facesFor(d.division, d.cls, ctx.faces); if (!f.some(x => x.name === d.face)) d.face = f.length ? f[0].name : ''; };
      on('ii-d-division', true, el => { d.division = el.value; keepFace(); });
      on('ii-d-class', true, el => { d.cls = el.value; keepFace(); });
      on('ii-d-face', false, el => { d.face = el.value; });
      ['identityOk', 'forceInvalid', 'paraOk'].forEach(k => on('ii-d-' + k, false, el => { d[k] = el.checked; }));
      on('ii-d-noBase', true, el => { d.noBase = el.checked; });
      ['lastName', 'firstName', 'sex', 'birthDate', 'club'].forEach(k => on('ii-f-' + k, false, el => { d.full[k] = el.value; }));
      on('ii-f-clubCode', false, el => {
        d.full.clubCode = el.value.toUpperCase();
        const club = (state.clubs || []).find(c => c.code === d.full.clubCode);
        if (club) { d.full.club = club.name; const n = byId('ii-f-club'); if (n) n.value = club.name; }
      });
      app.querySelectorAll('[data-d-session]').forEach(cb => cb.onchange = () => {
        const s = cb.dataset.dSession;
        d.sessions = cb.checked ? [...new Set(d.sessions.concat(s))] : d.sessions.filter(x => x !== s);
      });
      app.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
        d.license = b.dataset.pick;
        state.search = null;
        if (!(d.license in state.licenses)) {
          api('licenses', { codes: [d.license] }).then(res => { Object.assign(state.licenses, res.licenses || {}); render(); }).catch(() => {});
        }
        render();
      });
    }

    app.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act, b));
  }

  function keyOf(el) {
    const tr = el.closest('tr[data-key]');
    if (tr) return tr.dataset.key;
    return el.closest('#ii-edit') ? state.editing : null;
  }

  const sessionOf = el => { const tr = el.closest('tr[data-session]'); return tr ? tr.dataset.session : null; };

  function act(action, el) {
    const key = keyOf(el);
    const rec = key && state.result.recs.find(r => r.key === key);
    const ses = sessionOf(el);
    const prop = rec && ses ? rec.proposals.find(p => p.from === ses) : null;
    switch (action) {
      case 'edit': state.panel = null; return openEditor(key);
      case 'panel': return openPanel(rec);
      case 'panel-close': state.panel = null; return render();
      case 'panel-save': return savePanel(rec);
      case 'promote': return confirmPlaces([ses]) && applyTransition(rec, ses, 'promote');
      case 'drop': return applyTransition(rec, ses, 'drop');
      case 'send': return sendProposal(rec, prop);
      case 'mark-sent': return applyTransition(rec, ses, 'sent');
      case 'text': state.textFor = state.textFor === key + '|' + ses ? null : key + '|' + ses; return render();
      case 'accept': return applyTransition(rec, ses, 'accept');
      case 'accept-wait': return applyTransition(rec, ses, 'accept', { keepWaiting: true });
      case 'refuse-wait': return applyTransition(rec, ses, 'refuse', { toWait: true });
      case 'refuse-drop': return applyTransition(rec, ses, 'refuse');
      case 'close': state.editing = null; state.draft = null; return render();
      case 'exclude': {
        const c = Object.assign({ fields: {} }, rec.correction || {}, { exclude: true, at: new Date().toISOString() });
        state.editing = null; state.draft = null;
        return saveCorrection(key, c);
      }
      case 'include': {
        const c = Object.assign({}, rec.correction || {});
        delete c.exclude;
        return saveCorrection(key, C.isEmptyCorrection(c) ? null : c);
      }
      case 'reset': {
        state.editing = null; state.draft = null;
        const c = keptStates(rec.correction);
        return saveCorrection(key, C.isEmptyCorrection(c) ? null : Object.assign(c, { at: new Date().toISOString() }));
      }
      case 'save': {
        const c = draftToCorrection(rec);
        state.editing = null; state.draft = null;
        return saveCorrection(key, c);
      }
      case 'search': return searchByName(rec.src.lastName, rec.src.firstName);
      case 'import': return submitImport();
      case 'licenses-retry': state.licenseError = ''; return recompute();
      case 'profile-save': {
        const name = document.getElementById('ii-profile-name').value.trim();
        if (!name) return flash(t('profile.nameRequired'));
        return saveProfile(name);
      }
      case 'profile-delete': return deleteProfile(el.dataset.id);
      case 'update': return installUpdate();
      case 'update-check': return checkUpdate(true);
      case 'reload': return location.reload();
    }
  }

  render();
  checkUpdate(false);
})();
