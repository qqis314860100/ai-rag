---
name: coding-implementation
description: "Run a risk-adaptive, spec-to-code engineering workflow that combines R2C delivery stages with AI Project Harness guides, sensors, guardrails, evidence, and human gates. Use when the user invokes coding-implementation, asks for a Vibe Coding or Requirement-to-Code pipeline, wants a controlled feature/bugfix/refactor implementation, or requests setup or audit of AI coding workflow gates in a long-lived repository."
---

# Coding Implementation

Turn an intent into a small, reviewable, evidence-backed change. Keep humans in control of product
decisions while allowing the agent freedom inside explicit project boundaries.

## Operating Stance

- Treat the repository as the durable source of truth. Do not rely on chat memory for decisions.
- Constrain outcomes with tests, checks, evidence, and human gates instead of prescribing every edit.
- Scale process depth to risk. Never make a small reversible change carry Strict-path ceremony.
- Preserve existing project conventions and tools before introducing generic templates.
- Treat a passing build as engineering evidence, not proof of correct product behavior.

## Execute The Workflow

1. Read the repository entry guide and only the requirement, architecture, decision, and code sections
   relevant to the requested change.
2. Identify the goal, non-goals, affected scope, observable acceptance behavior, and unresolved facts.
3. Read [risk-routing.md](references/risk-routing.md), score the risk dimensions, and select Fast,
   Standard, or Strict. Accept an explicit request to raise the path. Require recorded risk acceptance
   before lowering it.
4. Read [gate-contract.md](references/gate-contract.md) and execute the required stages:
   `intake -> clarify -> specify -> plan -> apply -> verify -> archive`.
5. Work in the smallest independently verifiable slices. Run the narrowest useful sensor after each
   slice, then broaden checks according to shared impact and the selected path.
6. Produce behavioral evidence for user-facing changes. Stop at the human gate for product policy,
   UX judgment, security acceptance, or irreversible action.
7. Archive only durable information: the delivered outcome, evidence, remaining risk, non-obvious
   decisions, and reusable rules. Do not generate ceremonial files with no future reader.

Use [methodology.md](references/methodology.md) when designing, explaining, or adapting the complete
method. Use [scoring-rubric.md](references/scoring-rubric.md) when assessing this Skill or a project's
adoption quality.

## Select Process Depth

| Path | Use when | Required shape |
| --- | --- | --- |
| Fast | Local, explicit, reversible, no critical boundary | Combine intake through plan; apply, targeted verify, concise archive |
| Standard | Normal feature, bugfix, refactor, or contract-preserving cross-file work | Execute all gates; adjacent artifacts may share one change record |
| Strict | Data, auth, security, breaking contract, production operation, broad or irreversible work | Execute all gates; require design review, rollback plan, expanded evidence, and human approval |

Change type does not determine risk. A new feature can be Strict and a modification can be Fast.

## Use Project Records

Prefer an existing issue, plan, or change record. If the repository declares `.ai/pipeline.yaml`, use
its configured locations and commands. Otherwise:

- Keep Fast evidence in the task summary or commit.
- Use `.ai/changes/<change-id>/change.md` for Standard and Strict work when no established tracker
  exists.
- Create an ADR only for architectural decisions that are consequential, non-obvious, and durable.
- Update rules when a failure repeats; add a mechanical sensor when the same failure becomes a pattern.

## Install Or Audit A Project Pipeline

Only install project assets when the user explicitly requests repository setup or reorganization.

1. Run `python3 scripts/audit_project.py <repo>` before changing the target.
2. Inspect `assets/project-template/`; copy only missing or intentionally replaced pieces.
3. Merge with the target's `AGENTS.md`, docs, build tools, and CI. Never overwrite project facts with
   generic text.
4. Customize `.ai/pipeline.yaml` and `.prompt/` for the repository.
5. Run the project audit again, followed by the target's relevant lint, typecheck, tests, and build.
6. Require human behavior confirmation where automation cannot prove intent.

The template's `.prompt/` files guide stage outputs. They are not sources of product truth.

## Validate This Skill

Run all of the following before distributing or applying a modified copy:

```bash
python3 scripts/score_skill.py .
python3 scripts/score_skill.py . --self-test
python3 scripts/audit_project.py --self-test
```

Require 100/100 plus passing self-tests and the platform's Skill package validator. A 100 score means
the published rubric is satisfied; it is not a claim that future business changes cannot fail.

## Completion Report

Report the selected path and why, artifacts changed, checks and behavioral evidence, human decisions,
remaining risks, and archive updates. Do not paste full logs or claim checks that were not run.

## Non-Negotiable Boundaries

- Do not invent missing requirements, architecture, credentials, or test results.
- Do not weaken or skip a failing sensor to obtain a green result.
- Do not connect to production or perform irreversible actions without explicit authority and evidence.
- Do not mark Strict work complete while its required human gate is unresolved.
- Do not overwrite unrelated work or package secrets, local state, uploads, or generated build output.
