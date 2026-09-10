# AGENTS.md — KCNA Prep

Portable project instructions for **any** coding agent (Claude / GPT / Cursor / Codex …). Claude
Code reads this through `@AGENTS.md` in `CLAUDE.md`; non-Claude agents read it directly.
Cross-project workflow standards live in `~/seanyvault/standards/` (referenced, not duplicated).

Offline-capable study app for the **Kubernetes & Cloud Native Associate (KCNA)** exam: notes, spaced-repetition flashcards, weighted mock exams, a readiness model, and an 11-week plan. Repo: `seanyfresh/kcna-prep`. Deploys to GitHub Pages / Netlify / Vercel.

## Stack
- Static, **zero-build** web app: vanilla HTML/CSS/JS + a service worker (`service-worker.js`) for offline/PWA. No bundler, no framework, no runtime npm deps.
- `serve.py` — tiny zero-dependency Python 3 dev server that mirrors the production security headers.
- Content/data in `data/`, UI assets in `assets/`, tooling in `tools/`, docs in `docs/` (ADRs in `docs/adr/`). Container serving via `Dockerfile` + `docker-compose.yml`.
- **Two translation layers.** UI chrome: English-as-key packs in `assets/js/i18n/<code>.js`, all eagerly loaded from `index.html` (~45 KB each). Study content: `data/i18n/<code>/<part>.js`, fetched on demand by `assets/js/i18n-content.js` (~520 KB per language) and applied over the registered data objects, so render code stays untouched. Content translation is opt-in per user (Settings › Study content); English remains the default to match the English-only exam.
- `dev-cycle-profile.yml` — the **operational** dev-cycle profile (the build / test / gate values automation reads); the portfolio half lives in the vault project index. See `~/seanyvault/standards/dev-cycle/dev-cycle.md` §8–9.

## Commands (Makefile)
- `make serve` — run locally on :4178 and open the browser. Override port: `make serve PORT=9000`.
- `make lint` — `node --check` every JS file + `htmlhint index.html`. Run before every commit.
- `make links` — check markdown links (needs `lychee`).
- `make up` / `make down` — `docker compose` up (detached) / down.
- `make docker-build` / `make docker-run` — build / run the container image.
- `make version` — print `VERSION`.

## Translation tooling (`tools/`)
- **UI strings:** `extract-i18n.py` → `i18n-catalog.json`; `verify-packs.py` checks coverage, placeholders and HTML across the 9 packs.
- **Study content:** `extract-content-catalog.py` → `content-catalog.json` (2,416 units keyed by `domain:…`/`glossary:…`/`reference:…`); translations are authored as flat `{key: text}` JSON under `tools/content-src/<lang>/`; `build-content-pack.py <lang>` assembles `data/i18n/<lang>/`; `content-batch.py <part> [kind]` prints the next untranslated slice.
- **Gate:** `verify-content-packs.py` fails on a stale key, an HTML-tag mismatch, or a dropped Kubernetes/CNCF name, and warns on English words left in a translation. Run it after every pack rebuild.

## Conventions
- Stay dependency-free and offline-first: nothing that requires a network at runtime or breaks the service worker / offline use.
- **`ai_runtime: none`** — a static app makes no AI calls at runtime and sends no data anywhere; any runtime AI would break both the offline-first and dependency-free tenets. Changing that stance is a design decision: ADR first (`~/seanyvault/standards/ai-runtime-policy.md`).
- When you change cached assets, bump `VERSION` and the service-worker cache name, or clients keep stale files.
- Keep exam content accurate to the current KCNA curriculum; cite the source when changing facts.
- Keep CI green (GitHub Actions: CI, CodeQL, Pages) — run `make lint` locally first.
- Conventional Commits.
- Architecturally-significant decisions get an ADR in `docs/adr/` (Nygard; number-at-commit, placeholder→promote — see `docs/adr/0000-record-architecture-decisions.md`).
