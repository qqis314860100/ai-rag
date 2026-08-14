# 0001: AI Harness Standardization

Date: 2026-05-23

## Context

This repo already had strong working rules in `CLAUDE.md`, `docs/EXECUTION_RULES.md`, and `docs/CONTRIBUTING.md`.
What it lacked was a short architecture map, a repeatable local harness check, and a CI baseline that made those rules visible to fresh agents.

## Decision

Keep the existing rules as the source of truth and add:

- `docs/ARCHITECTURE.md` as the navigation layer
- `.github/workflows/ci.yml` as the default baseline verification
- `ruff.toml` as the Python lint signal
- `scripts/check-harness.sh` as the local maintenance entry point

## Consequences

- AI agents can onboard by reading a short, ordered set of files.
- The repo gains a repeatable harness check without changing the service-specific commit rules.
- Future rules should be added in `docs/` first, then enforced in scripts or CI.
