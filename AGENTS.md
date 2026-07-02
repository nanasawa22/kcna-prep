# AGENTS.md — KCNA Prep

Portable project instructions for **any** coding agent (Claude / GPT / Cursor / Codex …). Claude
Code reads this through `@AGENTS.md` in `CLAUDE.md`; non-Claude agents read it directly.
Cross-project workflow standards live in `~/seanyvault/standards/` (referenced, not duplicated).

Offline-capable study app for the **Kubernetes & Cloud Native Associate (KCNA)** exam: notes, spaced-repetition flashcards, weighted mock exams, a readiness model, and an 11-week plan. Repo: `seanyfresh/kcna-prep`. Deploys to GitHub Pages / Netlify / Vercel.

## Stack
- Static, **zero-build** web app: vanilla HTML/CSS/JS + a service worker (`service-worker.js`) for offline/PWA. No bundler, no framework, no runtime npm deps.
- `serve.py` — tiny zero-dependency Python 3 dev server that mirrors the production security headers.
- Content/data in `data/`, UI assets in `assets/`, tooling in `tools/`, docs in `docs/` (ADRs in `docs/adr/`). Container serving via `Dockerfile` + `docker-compose.yml`.
- `dev-cycle-profile.yml` — the **operational** dev-cycle profile (the build / test / gate values automation reads); the portfolio half lives in the vault project index. See `~/seanyvault/standards/dev-cycle/dev-cycle.md` §8–9.

## Commands (Makefile)
- `make serve` — run locally on :4178 and open the browser. Override port: `make serve PORT=9000`.
- `make lint` — `node --check` every JS file + `htmlhint index.html`. Run before every commit.
- `make links` — check markdown links (needs `lychee`).
- `make up` / `make down` — `docker compose` up (detached) / down.
- `make docker-build` / `make docker-run` — build / run the container image.
- `make version` — print `VERSION`.

## Conventions
- Stay dependency-free and offline-first: nothing that requires a network at runtime or breaks the service worker / offline use.
- **`ai_runtime: none`** — a static app makes no AI calls at runtime and sends no data anywhere; any runtime AI would break both the offline-first and dependency-free tenets. Changing that stance is a design decision: ADR first (`~/seanyvault/standards/ai-runtime-policy.md`).
- When you change cached assets, bump `VERSION` and the service-worker cache name, or clients keep stale files.
- Keep exam content accurate to the current KCNA curriculum; cite the source when changing facts.
- Keep CI green (GitHub Actions: CI, CodeQL, Pages) — run `make lint` locally first.
- Conventional Commits.
- Architecturally-significant decisions get an ADR in `docs/adr/` (Nygard; number-at-commit, placeholder→promote — see `docs/adr/0000-record-architecture-decisions.md`).
