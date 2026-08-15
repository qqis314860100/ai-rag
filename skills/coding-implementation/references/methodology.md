# Risk-Adaptive R2C Harness Methodology

## Contents

1. Purpose
2. Two-axis model
3. Lifecycle
4. Harness capabilities
5. Evidence and state
6. Throughput and entropy
7. Adoption sequence

## Purpose

Convert Vibe Coding from unconstrained prompt-to-code generation into a fast correction loop with
explicit intent, project memory, executable feedback, and human control over judgments that tools
cannot prove.

The method optimizes for trustworthy throughput, not maximum ceremony or maximum agent autonomy.

## Two-Axis Model

Use two independent axes:

| Axis | Question | Components |
| --- | --- | --- |
| R2C lifecycle | How does one change reach delivery? | intake, clarify, specify, plan, apply, verify, archive |
| Project Harness | What makes repeated execution reliable? | records, guides, sensors, backpressure, guardrails, human gates, governance |

Do not rename the Harness capabilities as another mandatory stage sequence. They constrain every R2C
stage horizontally.

## Lifecycle

```text
intake -> clarify -> specify -> plan -> apply <-> verify -> archive
```

- `intake` identifies outcome, scope, risk path, and authority.
- `clarify` resolves only ambiguities that can change the result or risk.
- `specify` defines observable acceptance behavior, constraints, and non-goals.
- `plan` chooses impact boundaries, delivery slices, sensors, and rollback when required.
- `apply` implements small coherent slices without treating the plan as immutable.
- `verify` provides deterministic and behavioral evidence; failures return to apply or plan.
- `archive` preserves only information that will guide a future human or agent.

Stages stay conceptually present so evidence is not lost. Fast work may merge several stages into one
short record. Standard and Strict work make the gates increasingly explicit.

## Harness Capabilities

### Repository As Record

Keep stable project truth in versioned files: a short Agent entry guide, requirements, architecture,
ADRs, active plans, generated contracts where useful, code, tests, and issue state. Link to sources
instead of duplicating them in prompts.

### Guides Before Work

Tell the agent where to read, which boundaries matter, what is forbidden, and how completion is
verified. Keep instructions concise and task-routed. Examples should demonstrate local style rather
than replace architecture rules.

### Sensors After Work

Use type checking, lint, tests, builds, schema checks, security scans, architecture checks, browser
evidence, and domain-specific assertions. Run the smallest relevant sensor first and expand according
to impact. Failure messages should say what failed, why it matters, and where to fix it.

### Backpressure Over Prescription

Enforce outcomes such as dependency direction, auth coverage, migration safety, and acceptance
behavior. Allow implementation freedom where multiple valid designs exist. Hard-block correctness,
safety, and irreversible risks; document preferences instead of turning all style choices into gates.

### Human Behavior Gate

Require an explicit human decision for subjective UX, business policy, security acceptance,
production-impacting actions, and irreversible changes. Provide screenshots, traces, logs,
before/after examples, and a concise risk note so the decision is informed.

### Governance And Entropy Control

When a mistake repeats twice, improve guidance. When it repeats three times, add a deterministic
sensor where feasible. Periodically look for stale docs, duplicate helpers, architectural leakage,
inconsistent error handling, oversized modules, and untested critical paths.

## Evidence And State

Represent a change with the smallest durable record supported by the project. A useful record contains:

- goal and non-goals;
- selected path and risk rationale;
- acceptance scenarios;
- affected boundaries and planned slices;
- checks and behavioral evidence;
- human decisions and remaining risks;
- final outcome and durable documentation updates.

Use these states when machine-readable tracking is needed:

```text
draft -> shaped -> ready -> building -> checking -> awaiting-human -> done
```

Failed checks move work back to `building` or `ready`. Missing authority moves it to
`awaiting-human`. Never encode an unresolved human gate as `done`.

## Throughput And Entropy

- Keep changes small enough to review and revert.
- Prefer quick, narrow feedback over delayed full-suite feedback, but run broader gates when shared
  behavior or release readiness requires them.
- Do not create a separate artifact for every conceptual stage when one coherent change record works.
- Do not use Prompt count, agent count, or document count as maturity metrics.
- Measure first-pass acceptance, correction time, escaped defects, gate failures, human intervention,
  and stale-record rate.

## Adoption Sequence

1. Establish a short Agent entry point and explicit project boundaries.
2. Make requirements, architecture, decisions, and verification commands discoverable.
3. Add deterministic sensors for existing rules before adding complex orchestration.
4. Configure risk routing and the three process paths.
5. Add change records, evidence contracts, and human gate state.
6. Pilot with one Fast, one Standard, and one Strict scenario.
7. Improve the method from observed failures, then consider delegation or distribution.
