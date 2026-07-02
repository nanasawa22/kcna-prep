# CLAUDE.md — KCNA Prep

@AGENTS.md

The portable project guide (stack, commands, conventions) lives in **`AGENTS.md`** (imported
above) so non-Claude agents read the same playbook. This file adds only the Claude- /
dev-cycle-specific bits.

## Dev cycle
- **`ai_runtime: none`** — static offline-first PWA, no AI at runtime (see AGENTS.md);
  changing that stance needs an ADR (`~/seanyvault/standards/ai-runtime-policy.md`).
- Operational profile: repo-local `dev-cycle-profile.yml` (the build/test/gate/model values the
  wave-runner and commands execute). Portfolio half: vault `~/seanyvault/projects/kcna-prep/index.md`.
- **Model tiers:** 🧠 Deep = Opus (grill · sequence · draft-ADRs · review) · 🔨 Build = Sonnet
  (implement · tests · fix loop) · ⚡ Cheap = Haiku (doc writing · `/document` · changelog).
  Reviewer's tier ≥ the builder's.
- **Commands:** `/start-dev` `/pr` `/document` (global, in `~/.claude/`). ADRs number-at-commit.
- **Changelog:** the pre-push hook's generator is LLM-agnostic — set `$CHANGELOG_CMD` (alias
  `$LLM_CLI`) to any LLM CLI; defaults to the `claude` CLI.

See the global `~/.claude/CLAUDE.md` for the cross-project defaults this repo inherits.
