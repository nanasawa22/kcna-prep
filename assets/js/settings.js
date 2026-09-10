/* User settings: theme, motion, configurable exam date, and progress
   export/import/reset. Source of truth for preferences across the app. */
window.Settings = (function () {
  const KEY = 'settings';
  // level: null until the user chooses; else none|light|heavy.
  // lang: null until the user chooses; else a code from I18n.LANGS (auto-detected).
  // contentLang: 'en' keeps study content in English to match the English-only
  //   exam (the historical behaviour); 'follow' translates it into the display
  //   language when a content pack exists for it.
  // reportName / examBookedDate feed the manager progress report.
  const DEFAULTS = { theme: 'auto', reducedMotion: 'auto', examDate: null, planStart: null, deadlineDismissed: false, level: null, lang: null, contentLang: 'en', reportName: '', examBookedDate: null };
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const listeners = [];

  function load() { return Object.assign({}, DEFAULTS, Store.get(KEY, {})); }
  function persist(s) { Store.set(KEY, s); }
  function get() { return load(); }
  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach((f) => { try { f(); } catch (e) {} }); }

  function set(patch) {
    const s = Object.assign(load(), patch);
    persist(s);
    apply();
    emit();
    return s;
  }

  function effectiveTheme(s) {
    s = s || load();
    if (s.theme === 'light' || s.theme === 'dark') return s.theme;
    return mq.matches ? 'light' : 'dark';
  }

  function applyTheme() {
    const s = load();
    document.documentElement.setAttribute('data-theme', effectiveTheme(s));
    document.documentElement.classList.toggle('reduce-motion', s.reducedMotion === 'on');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', effectiveTheme(s) === 'light' ? '#f7f7f8' : '#131313');
  }

  // Push configurable exam date / plan start into the content meta so the
  // countdown, plan, and readiness all honor it.
  function applyMeta() {
    const s = load();
    if (!window.KCNA || !KCNA.meta) return;
    if (s.examDate && /^\d{4}-\d{2}-\d{2}$/.test(s.examDate)) KCNA.meta.examDate = s.examDate;
    if (s.planStart && /^\d{4}-\d{2}-\d{2}$/.test(s.planStart)) KCNA.meta.planStart = s.planStart;
  }

  function examDate() { return (window.KCNA && KCNA.meta && KCNA.meta.examDate) || load().examDate; }
  function planStart() { return (window.KCNA && KCNA.meta && KCNA.meta.planStart) || load().planStart; }

  // Effective experience level (defaults to 'light' until the user chooses).
  function level() { const l = load().level; return (l === 'none' || l === 'heavy') ? l : 'light'; }

  // Effective UI language: the saved choice if supported, else auto-detected
  // from the browser, else English.
  function lang() {
    const l = load().lang;
    if (l && window.I18n && I18n.has(l)) return l;
    return window.I18n ? I18n.detect() : 'en';
  }

  // Study-content language policy: 'en' (exam-faithful) or 'follow' the UI.
  function contentLang() { return load().contentLang === 'follow' ? 'follow' : 'en'; }

  // The language code the study content should actually be rendered in.
  function contentLangEffective() { return contentLang() === 'follow' ? lang() : 'en'; }

  // Sync the active language + <html lang>/<dir> with the current setting.
  function applyLang() {
    if (!window.I18n) return;
    const l = lang();
    I18n.setActive(l);
    I18n.applyDocument(l);
  }

  function apply() { applyTheme(); applyMeta(); applyLang(); }

  mq.addEventListener && mq.addEventListener('change', () => {
    if (load().theme === 'auto') { applyTheme(); emit(); }
  });

  /* ---------- progress export / import / reset ---------- */
  const PFX = 'kcna:';

  function snapshot() {
    const data = {};
    Object.keys(localStorage).forEach((k) => {
      if (k.indexOf(PFX) === 0) data[k.slice(PFX.length)] = localStorage.getItem(k);
    });
    return {
      app: 'kcna-prep',
      version: (window.KCNA && KCNA.meta && KCNA.meta.version) || '1.0.0',
      exportedAt: new Date().toISOString(),
      data,
    };
  }

  // Returns {ok:true, count} or {ok:false, error}. Validates shape + size.
  // opts.replace: clear existing progress first (a clean "switch user" load).
  function importFromText(text, opts) {
    opts = opts || {};
    if (!text || text.length > 2_000_000) return { ok: false, error: 'File is empty or too large.' };
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return { ok: false, error: 'Not a valid session file.' }; }
    if (!parsed || parsed.app !== 'kcna-prep' || typeof parsed.data !== 'object') {
      return { ok: false, error: 'This is not a KCNA Prep session file.' };
    }
    if (opts.replace) {
      Object.keys(localStorage).forEach((k) => { if (k.indexOf(PFX) === 0) localStorage.removeItem(k); });
    }
    // Only restore keys this app actually writes, and only when the decoded value
    // has the shape that key is meant to hold. Rejects unknown keys and corrupt or
    // hostile shapes (e.g. a string where an object is expected) so a malformed
    // import can't propagate into a render and crash it.
    const SHAPES = {
      settings: 'object', domainStats: 'object', srs: 'object', cardStats: 'object',
      streak: 'object', levelUpAsked: 'object', plan: 'object', examHistory: 'array',
      fcMode: 'string',
    };
    const shapeOf = (val) => Array.isArray(val) ? 'array' : (val === null ? 'null' : typeof val);
    let count = 0;
    Object.keys(parsed.data).forEach((k) => {
      const v = parsed.data[k];
      if (typeof k !== 'string' || typeof v !== 'string' || v.length > 1_000_000) return;
      const want = SHAPES[k];
      if (!want) return;                                  // unknown key — skip
      let val;
      try { val = JSON.parse(v); } catch (e) { return; }  // each value must be JSON we wrote
      if (shapeOf(val) !== want) return;                  // wrong shape — skip
      localStorage.setItem(PFX + k, v);
      count++;
    });
    apply();
    emit();
    return { ok: true, count };
  }

  /* ---------- named session files (.seanyprep) for multi-user sharing ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }

  // "KCNA Exam Prep - YYYY-MM-DD HHMM.seanyprep" (local time).
  function sessionFilename() {
    const d = new Date();
    const date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const time = pad(d.getHours()) + pad(d.getMinutes());
    return 'KCNA Exam Prep - ' + date + ' ' + time + '.seanyprep';
  }

  function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const SESSION_TYPES = [{ description: 'KCNA Prep session', accept: { 'application/json': ['.seanyprep'] } }];

  // Save the whole session to a .seanyprep file. Uses the File System Access API
  // (native dialog defaulting to Documents) when available; else downloads it.
  function saveSession() {
    const text = JSON.stringify(snapshot(), null, 2);
    const name = sessionFilename();
    if (window.showSaveFilePicker) {
      return window.showSaveFilePicker({ suggestedName: name, startIn: 'documents', types: SESSION_TYPES })
        .then((handle) => handle.createWritable()
          .then((w) => w.write(text).then(() => w.close()))
          .then(() => ({ ok: true, method: 'picker', name: handle.name })))
        .catch((e) => {
          if (e && e.name === 'AbortError') return { ok: false, cancelled: true };
          downloadText(text, name);
          return { ok: true, method: 'download', name };
        });
    }
    downloadText(text, name);
    return Promise.resolve({ ok: true, method: 'download', name });
  }

  // Load a session, replacing current progress (clean switch between users).
  function loadSession() {
    if (window.showOpenFilePicker) {
      return window.showOpenFilePicker({
        startIn: 'documents', multiple: false,
        types: [{ description: 'KCNA Prep session', accept: { 'application/json': ['.seanyprep', '.json'] } }],
      })
        .then(([handle]) => handle.getFile())
        .then((file) => file.text())
        .then((text) => importFromText(text, { replace: true }))
        .catch((e) => (e && e.name === 'AbortError') ? { ok: false, cancelled: true } : { ok: false, error: 'Could not open the file.' });
    }
    // Fallback: hidden file input (folder is the browser's default).
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.seanyprep,application/json,.json';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        if (!f) { input.remove(); resolve({ ok: false, cancelled: true }); return; }
        const reader = new FileReader();
        reader.onload = () => { input.remove(); resolve(importFromText(String(reader.result), { replace: true })); };
        reader.onerror = () => { input.remove(); resolve({ ok: false, error: 'Could not read the file.' }); };
        reader.readAsText(f);
      });
      input.click();
    });
  }

  function resetProgress() {
    // Clear study progress but KEEP user settings (theme, exam date).
    const keep = Store.get(KEY, {});
    Store.reset();
    Store.set(KEY, keep);
    emit();
  }

  function resetAll() { Store.reset(); apply(); emit(); }

  return {
    get, set, onChange, apply, applyTheme, applyMeta, applyLang, effectiveTheme,
    examDate, planStart, level, lang, contentLang, contentLangEffective,
    importFromText, resetProgress, resetAll,
    saveSession, loadSession, sessionFilename,
  };
})();
