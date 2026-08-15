# Risk Routing

## Contents

1. Assessment dimensions
2. Path rules
3. Hard Strict triggers
4. User overrides
5. Examples

## Assessment Dimensions

Score each dimension from 0 to 2 using repository evidence. Record the reason, not only the number.

| Dimension | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Ambiguity | Outcome and acceptance are explicit | One bounded assumption | Competing interpretations affect behavior |
| Blast radius | One local boundary | Several files or one shared module | Cross-module, shared platform, or broad regression surface |
| Data | No persistence effect | Additive/reversible persistence change | Migration, deletion, legacy compatibility, or data rewrite |
| Auth and security | No security boundary | Existing protected flow | Permission model, secrets, exposure, download, or trust boundary |
| Public contract | Internal implementation only | Backward-compatible contract addition | Breaking API, schema, event, CLI, or external integration change |
| Production operations | No operational effect | Config or deploy behavior with rollback | Production access, destructive command, availability, or compliance impact |
| Reversibility | Trivial revert | Revert needs coordination | Irreversible or recovery is uncertain |

Unknown evidence scores 2 until clarified. Do not turn lack of knowledge into a low-risk score.

## Path Rules

Apply hard triggers before totals.

- Select **Fast** when total is 0-2, no dimension is 2, scope is local, and acceptance is explicit.
- Select **Standard** when total is 3-7 and no hard Strict trigger applies.
- Select **Strict** when total is 8 or more, any hard trigger applies, or failure could create material
  harm that normal repository checks cannot contain.

The numbers make reasoning repeatable but do not replace judgment. Raise the path when evidence shows
unmodeled risk.

## Hard Strict Triggers

Select Strict regardless of total for:

- destructive or irreversible data migration;
- authentication, authorization, secrets, privacy, or a new trust boundary;
- breaking public contract or externally coordinated migration;
- production database access, deployment, destructive command, or availability-sensitive operation;
- legal, compliance, audit, or safety policy;
- unresolved ambiguity that changes architecture or acceptance behavior.

## User Overrides

- Always accept a request to raise Standard to Strict or Fast to Standard/Strict.
- To lower a recommended path, explain the triggered risks and request explicit acceptance.
- Never lower a path when doing so would bypass a mandatory safety or authorization boundary.
- Record the requested path, recommended path, accepted path, decision owner, and rationale.

## Examples

| Change | Expected path | Reason |
| --- | --- | --- |
| Correct a known label in one component | Fast | Local, explicit, reversible, no boundary change |
| Add a backward-compatible search filter | Standard | Cross-layer behavior and acceptance coverage |
| Change a legacy-compatible database schema | Strict | Data migration and recovery obligations |
| Change document download authorization | Strict | Auth and security hard trigger |
| Raise a local refactor from Fast to Standard | Standard | User may always request stronger evidence |

For a user-requested downgrade of the database or authorization examples, preserve Strict unless the
hard trigger itself is disproven by repository evidence.
