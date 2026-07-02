#!/usr/bin/env bash
# scripts/test-gate.sh — kcna-prep's single test-gate entry point (testing.md §2).
# The declared gate is `make lint`: node --check every JS file + htmlhint index.html
# (no test suite yet — this is the whole local green gate). Run by .githooks/pre-push
# via the canonical core (~/.claude/scripts/prepush-core.sh) and by hand before commits.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec make lint
