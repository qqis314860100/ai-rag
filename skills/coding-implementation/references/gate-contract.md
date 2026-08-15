# Gate Contract

## Contents

1. Common contract
2. Stage gates
3. Path matrix
4. Failure transitions
5. Completion packet

## Common Contract

Every gate has six fields:

1. **Input**: facts and prior evidence required to begin.
2. **Action**: reasoning or work performed in the stage.
3. **Artifact**: smallest durable output required by the selected path.
4. **Sensor**: deterministic or evidence-producing check.
5. **Human gate**: explicit decision required when tools cannot prove correctness or authority.
6. **Exit evidence**: facts that permit the next state.

Combine artifacts when that improves clarity. Never combine exit evidence away.

## Stage Gates

### Intake

- **Input**: user intent and repository entry instructions.
- **Action**: state the goal, non-goals, scope, authority, risk assessment, and selected path.
- **Artifact**: task summary for Fast; change record for Standard and Strict.
- **Sensor**: confirm that relevant source files and instructions exist and are readable.
- **Human gate**: request authority before external state changes or materially expanded scope.
- **Exit evidence**: goal, scope, path, and ownership are explicit.

### Clarify

- **Input**: intake evidence and task-relevant product context.
- **Action**: separate known facts, assumptions, decisions, and unresolved blockers. Ask only questions
  whose answers can change behavior, architecture, risk, or acceptance.
- **Artifact**: concise decision section in the change record.
- **Sensor**: scan for contradictory terms, unsupported assumptions, and unresolved hard triggers.
- **Human gate**: obtain product decisions rather than guessing them.
- **Exit evidence**: no unresolved ambiguity prevents an observable specification.

### Specify

- **Input**: clarified outcome, constraints, and project terminology.
- **Action**: define observable acceptance scenarios, error behavior, non-goals, and relevant NFRs.
- **Artifact**: acceptance section or standalone spec when complexity warrants it.
- **Sensor**: each requirement maps to at least one observable case; terms match repository language.
- **Human gate**: confirm subjective behavior, policy, and scope trade-offs.
- **Exit evidence**: an independent reviewer can distinguish success from failure.

### Plan

- **Input**: accepted specification and task-relevant architecture.
- **Action**: map affected boundaries, contracts, data, delivery slices, sensors, and dependencies.
  Add rollback and recovery for Strict work.
- **Artifact**: executable plan proportional to risk.
- **Sensor**: validate dependency direction, migration compatibility, test strategy, and slice boundaries.
- **Human gate**: require design review for Strict architecture, data, security, or public-contract work.
- **Exit evidence**: each slice has a completion check and the plan covers every acceptance case.

### Apply

- **Input**: ready plan, local code patterns, and required authority.
- **Action**: implement one coherent slice at a time; preserve unrelated work and adapt the plan when
  evidence invalidates an assumption.
- **Artifact**: focused code, tests, docs, or configuration changes.
- **Sensor**: run the narrowest relevant compile, lint, typecheck, test, or structural check after each
  slice.
- **Human gate**: pause before irreversible operations, production access, or scope expansion.
- **Exit evidence**: the slice is internally coherent and its targeted sensors pass.

### Verify

- **Input**: implemented slices, acceptance scenarios, and path-specific verification plan.
- **Action**: review the relevant diff, broaden deterministic checks, gather behavior evidence, and
  evaluate regression and remaining risk.
- **Artifact**: verification record with commands, results, evidence references, and unverified items.
- **Sensor**: lint, typecheck, test, build, security, architecture, schema, integration, or browser
  checks selected by affected boundaries.
- **Human gate**: confirm UX, business policy, security acceptance, or irreversible outcomes with
  screenshots, logs, traces, or before/after evidence.
- **Exit evidence**: required sensors pass; acceptance cases are evidenced; remaining risk and human
  decisions are explicit.

### Archive

- **Input**: verified outcome and relevant decisions.
- **Action**: summarize goal, delivered behavior, files, checks, evidence, decisions, and remaining
  risk. Update durable guidance only when the change created durable knowledge.
- **Artifact**: commit/PR/task summary; ADR, rule, Skill, or architecture update only when warranted.
- **Sensor**: review the final relevant diff and check that generated output or secrets are excluded.
- **Human gate**: approve release or merge when project governance requires it.
- **Exit evidence**: the repository and change record tell the next agent what changed and why.

## Path Matrix

| Gate | Fast | Standard | Strict |
| --- | --- | --- | --- |
| intake | Short summary | Change record | Change record with risk owner |
| clarify | Merge into summary | Explicit decisions | Explicit decisions and blockers resolved |
| specify | Acceptance bullets | Acceptance scenarios | Reviewed scenarios and NFRs |
| plan | One or more checked steps | Sliced plan | Reviewed plan plus rollback/recovery |
| apply | Targeted sensor per slice | Targeted sensor per slice | Targeted sensor and protected operations |
| verify | Targeted checks | Relevant suite and behavior evidence | Expanded regression, security/data evidence, human gate |
| archive | Commit/task summary | Review packet | Review packet plus durable decisions |

## Failure Transitions

- Missing facts: return to Clarify.
- Acceptance contradiction: return to Specify.
- Architecture, migration, or dependency failure: return to Plan.
- Compile, lint, typecheck, test, or behavior failure: return to Apply, fix the root cause, and rerun the
  smallest affected sensor before broader checks.
- Missing authority or subjective approval: enter `awaiting-human`; do not report completion.
- Repeated unexplained failure: stop repeating the same command, preserve raw evidence, and diagnose.

## Completion Packet

Report:

- selected path and risk rationale;
- goal and delivered behavior;
- files or boundaries changed;
- commands/checks run and their outcomes;
- behavior evidence and human decisions;
- remaining risks or items not verified;
- ADR, guide, rule, or Skill updates, if any.
