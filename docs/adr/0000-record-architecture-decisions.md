# ADR-0000: Record Architecture Decisions

- **Status:** Accepted
- **Date:** 2026-07-02
- **Deciders:** Sean

## Context

kcna-prep is a single-developer project that nonetheless carries real architectural commitments —
zero-build and dependency-free, offline-first via a service worker, the `VERSION` + cache-name bump
as the deployment contract, exam content pinned to the live KCNA curriculum. Those decisions need a
durable home so a future reader (human or AI) can reconstruct *why* the app looks the way it does
without spelunking git history or re-deriving the reasoning from scratch. The existing prose docs
(`docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`) describe *what is*; ADRs record *why it was decided*.

We adopt **Architecture Decision Records** (the lightweight format popularised by Michael Nygard)
as that home — the same convention proven in seanyfit, expense-autopilot, and meeting-intelligence.

## Decision

We record every architecturally-significant decision as a numbered Markdown file in `docs/adr/`.

- **Filename:** `NNNN-kebab-case-title.md`, zero-padded sequential (`0001`, `0002`, …).
  `0000` is this convention itself.
- **One decision per file**, written in active voice ("We will…").
- **Status** is one of: `Proposed` · `Accepted` · `Deprecated` · `Superseded by ADR-N` · `Rejected`.
  A superseded decision cites the superseding ADR in its status line and is kept (never deleted)
  as the historical rationale.
- **Number-at-commit:** every ADR is born `docs/adr/draft-<slug>.md` / `# ADR-TBD:`; the number is
  stamped only when it lands on `main` (`promote-adrs.sh`). Unbuilt ideas live in the vault
  (`~/seanyvault/projects/kcna-prep/`), not in `docs/adr/`.
- **Structure:** Status · Context · Decision · Consequences (easier *and* harder). Keep what the
  decision warrants; don't pad.
- **Grounding:** when an ADR claims something "exists today," cite it with `file:line` so the
  claim is checkable and the ADR ages honestly.
- ADRs live in the repo (the code is the source of truth); cross-project knowledge lives in the
  vault and is referenced, not duplicated.

## Consequences

**Easier:** new contributors (and AI sessions) orient from `docs/adr/` instead of guessing;
decisions and their trade-offs (e.g. anything that would add a dependency, a build step, or a
runtime network call) survive the sessions that made them.

**Harder:** every significant decision now carries the small tax of writing it down, and the
index below must be kept current.

## The record so far

| ADR | Title | Status |
|---|---|---|
| [0000](0000-record-architecture-decisions.md) | Record Architecture Decisions | Accepted |
