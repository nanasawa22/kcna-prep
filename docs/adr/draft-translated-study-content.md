# ADR-TBD: Translated study content as an opt-in, lazily-loaded layer

- **Status:** Proposed
- **Date:** 2026-09-11
- **Deciders:** Sean

## Context

The UI has been fully localised into 10 languages since the i18n work landed
(`assets/js/i18n.js:15`, packs in `assets/js/i18n/`). The study content — 35 notes,
139 flashcards, 253 questions, 58 glossary terms and 65 reference blurbs, about
294,000 characters — deliberately stayed in English. That stance is stated twice in
the codebase: `assets/js/i18n.js:7` ("Kubernetes / cloud-native API object names …
are intentionally kept in English everywhere — that is how they appear on the
English-only KCNA exam") and in the settings copy itself, "Study content stays in
English to match the exam".

The reasoning is sound and we are not abandoning it: the KCNA is administered in
English only, so a candidate who has never read "Pod anti-affinity" or "reclaim
policy" in English is worse off on exam day. But it is also not the whole picture.
A non-native reader spends attention decoding the *prose* that surrounds those
terms, and that attention is not going into the concept. Translating the
explanation while pinning the terminology gets both.

Two structural facts shaped the design:

- **Volume.** A UI pack is ~45 KB; a content pack is ~520 KB. Shipping all
  languages the way `index.html` ships the UI packs (`index.html:106`) would add
  ~4.7 MB to every page load for content only one reader in ten wants.
- **Reach.** Content strings are read directly by every render path —
  `note.html`, `q.options`, `term.definition` — across `app.js`, `exams.js`,
  `flashcards.js` and `search.js`. Threading a translation call through all of
  them would touch far more code than the feature is worth, and every future
  render site would have to remember to do it.

## Decision

We add a **second translation layer for study content**, separate from the UI layer.

- **Packs live at `data/i18n/<code>/<part>.js`**, one file per content file, each
  calling `ContentI18n.register(lang, part, { key: translation })`. Keys are the
  catalog keys from `tools/extract-content-catalog.py` (`domain:<id>:note:<id>:html`,
  `glossary:<term>:definition`, …), not array positions, so a pack survives content
  being reordered.
- **Loading is lazy.** `assets/js/i18n-content.js` injects the pack scripts on
  demand for the active language only, gated on a `PACK_LANGS` allow-list so no
  404s are fired for UI-only languages. The service worker deliberately does not
  precache them (`service-worker.js:9`); its cache-first rule stores each pack on
  first fetch, so a reader who has browsed once in their language stays
  offline-capable without every other reader paying for it.
- **Application is destructive, over the registered data objects.**
  `ContentI18n.apply()` walks `KCNA` and writes translated strings into the same
  objects the renderers already read, after `snapshot()` captures the English
  originals. No render path changes; switching back to English is exact.
- **The default stays English.** A new `contentLang` setting is `'en'` unless the
  reader opts into `'follow'` (Settings › Language › Study content). The setting
  only appears when a pack actually ships for their display language.
- **Kubernetes and CNCF names stay in English inside the translation**, exactly as
  the UI packs already do, and `tools/verify-content-packs.py` fails the build if a
  translation drops one.
- **Japanese (`ja`) is the first pack**, at 100% of the 2,416 catalog units.

## Consequences

**Easier:** a non-native reader gets the explanation in their language while still
meeting the exact English terminology the exam uses. Adding a language is now a
data task — translate `tools/content-src/<lang>/*.json`, run
`build-content-pack.py`, add the code to `PACK_LANGS` — with no code changes and no
new dependency, so the zero-build tenet holds. The catalog + verifier pair means a
partial pack is valid (missing keys fall back to English per key) and a *broken*
pack is caught before it ships.

**Harder:** the repo now carries ~520 KB per translated language, and content and
translations can drift — an edited note silently keeps its old Japanese until
someone re-runs the extractor and notices the stale key. The verifier catches keys
that no longer exist but cannot tell that an *existing* key's English text changed;
adding a source-hash to the catalog would close that gap and is the obvious next
step if a second language lands. `apply()` mutating shared objects also means any
future code that caches a content string across a language switch would hold a
stale value.

## Alternatives considered

- **Ship content packs eagerly like the UI packs.** Simplest, consistent with the
  existing layer, rejected on payload: ~4.7 MB for all ten languages.
- **Translate at render time via a `t()`-style call.** Keeps the data immutable but
  requires touching every render site in four modules and relies on every future
  one remembering.
- **Fork the `data/*.js` files per language.** No new runtime at all, but doubles
  the content that must be kept accurate against the KCNA curriculum — the exact
  thing `AGENTS.md` warns about.
