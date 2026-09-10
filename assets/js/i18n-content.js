/* KCNA Prep — study-content internationalization.
 *
 * assets/js/i18n.js translates the app chrome (English string as key). This
 * translates the other half: the notes, flashcards, questions, glossary
 * definitions and reference blurbs registered from data/*.js.
 *
 * Why this is separate from the UI packs:
 *   - Volume. A content pack is ~300 KB per language against ~45 KB for a UI
 *     pack, so content packs are fetched on demand rather than shipped in
 *     index.html the way UI packs are. The service worker's cache-first
 *     handler stores each pack on first fetch, so offline use survives.
 *   - Policy. The KCNA exam is English-only, so translated content is
 *     opt-out-able on its own setting (Settings › content language) and the
 *     English text is always kept in memory to restore.
 *
 * Translation is applied destructively to the registered data objects, which
 * keeps every render path in app.js / exams.js / flashcards.js / search.js
 * untouched — they keep reading `note.html`, `q.options`, `term.definition`.
 * snapshot() captures the English original first so switching back is exact.
 *
 * Keys match tools/extract-content-catalog.py exactly; tools/verify-content-
 * packs.py fails the build if the two ever drift.
 */
window.ContentI18n = (function () {
  // Content files a language pack is split into, in load order.
  const FILES = ['fundamentals', 'orchestration', 'architecture', 'delivery', 'glossary', 'references'];

  // Languages a content pack actually ships for, i.e. data/i18n/<code>/ exists.
  // Gating on this keeps the loader from firing 404s for the UI-only languages.
  // Add a code here when its pack lands (and to service-worker.js PRECACHE).
  const PACK_LANGS = ['ja'];

  const PACKS = {};     // lang -> { key: translated }
  const PARTS = {};     // lang -> Set of file ids already registered
  const LOADING = {};   // lang -> Promise (in-flight or settled load)

  let english = null;   // key -> pristine English string (captured once)
  let applied = 'en';   // language currently written into the data objects

  /* ---------- registration (called by data/i18n/<lang>/<file>.js) ---------- */

  function register(lang, part, map) {
    if (!lang || !map) return;
    PACKS[lang] = Object.assign(PACKS[lang] || {}, map);
    (PARTS[lang] = PARTS[lang] || {})[part] = true;
  }

  // A language has usable content once at least one part has registered.
  function has(lang) { return !!PACKS[lang]; }
  function complete(lang) {
    const p = PARTS[lang] || {};
    return FILES.every(function (f) { return p[f]; });
  }

  /* ---------- the field walker (mirrors extract-content-catalog.py) -------- */

  // fn(key, object, field) for every translatable string in the registry.
  // Array fields (question options) are visited per index with field = 'n'.
  function walk(fn) {
    if (!window.KCNA || !KCNA.ready()) return;
    KCNA.all().forEach(function (d) {
      (d.notes || []).forEach(function (n) {
        ['topic', 'title', 'html'].forEach(function (f) {
          fn('domain:' + d.id + ':note:' + n.id + ':' + f, n, f);
        });
      });
      (d.flashcards || []).forEach(function (c) {
        ['topic', 'front', 'back'].forEach(function (f) {
          fn('domain:' + d.id + ':card:' + c.id + ':' + f, c, f);
        });
      });
      (d.questions || []).forEach(function (q) {
        ['topic', 'question', 'explanation'].forEach(function (f) {
          fn('domain:' + d.id + ':question:' + q.id + ':' + f, q, f);
        });
        // Options are a live array; slice() elsewhere is shallow so in-place
        // writes are visible everywhere the question is rendered.
        (q.options || []).forEach(function (_, i) {
          fn('domain:' + d.id + ':question:' + q.id + ':option:' + i, q.options, i);
        });
      });
    });
    // glossary() / references() return shallow copies — the term and ref
    // objects inside them are the registry's own, so writes stick.
    KCNA.glossary().forEach(function (t) {
      fn('glossary:' + t.term + ':definition', t, 'definition');
    });
    const refs = KCNA.allReferences();
    Object.keys(refs).forEach(function (did) {
      (refs[did] || []).forEach(function (r) {
        fn('reference:' + did + ':' + r.url + ':note', r, 'note');
      });
    });
  }

  // Capture the English original once, while the data is still pristine.
  function snapshot() {
    if (english) return;
    english = {};
    walk(function (key, obj, field) {
      if (obj[field] != null) english[key] = obj[field];
    });
  }

  /* ---------------------------- lazy loading ------------------------------ */

  function scriptUrl(lang, part) { return 'data/i18n/' + lang + '/' + part + '.js'; }

  function loadScript(src) {
    return new Promise(function (resolve) {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;                 // keep FILES order deterministic
      s.onload = function () { resolve(true); };
      s.onerror = function () { resolve(false); };  // a missing part is not fatal
      document.head.appendChild(s);
    });
  }

  // Fetch a language's content parts once. Resolves to true if anything loaded.
  function load(lang) {
    if (!lang || lang === 'en' || PACK_LANGS.indexOf(lang) < 0) return Promise.resolve(false);
    if (LOADING[lang]) return LOADING[lang];
    LOADING[lang] = Promise.all(FILES.map(function (f) {
      return loadScript(scriptUrl(lang, f));
    })).then(function () { return has(lang); });
    return LOADING[lang];
  }

  /* ------------------------------ applying -------------------------------- */

  // Write `lang` into the data objects (or restore English for 'en' / no pack).
  function apply(lang) {
    snapshot();
    const target = (lang && lang !== 'en' && PACKS[lang]) ? lang : 'en';
    if (target === applied) return applied;
    const pack = PACKS[target] || null;
    walk(function (key, obj, field) {
      if (!(key in english)) return;
      const t = pack && pack[key];
      obj[field] = (t != null && String(t).trim()) ? t : english[key];
    });
    applied = target;
    return applied;
  }

  // Load if needed, then apply. The single call sites use.
  function ensure(lang) {
    if (!lang || lang === 'en' || PACK_LANGS.indexOf(lang) < 0) return Promise.resolve(apply('en'));
    if (has(lang)) return Promise.resolve(apply(lang));
    return load(lang).then(function () { return apply(lang); });
  }

  function active() { return applied; }

  return {
    register: register, has: has, complete: complete, load: load,
    apply: apply, ensure: ensure, active: active,
    FILES: FILES, PACK_LANGS: PACK_LANGS,
    // Is a translated pack shipped for this language?
    shipsFor: function (lang) { return PACK_LANGS.indexOf(lang) >= 0; },
  };
})();
