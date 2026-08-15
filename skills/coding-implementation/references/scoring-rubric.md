# Scoring Rubric

## Contents

1. Skill score
2. Project adoption score
3. Release gates
4. Interpretation

## Skill Score

Run `python3 scripts/score_skill.py <skill-root>`. The deterministic score totals 100:

| Dimension | Points | Required evidence |
| --- | ---: | --- |
| Structure and triggering | 15 | Valid frontmatter, precise triggers, concise SKILL.md, resolved direct references |
| Method consistency | 15 | Seven lifecycle stages, two-axis model, repository record, outcome constraints |
| Risk routing | 15 | Seven dimensions, three paths, thresholds, hard triggers, safe overrides, examples |
| Gate and evidence contract | 20 | Six-field contract, all seven gates, failure transitions, completion packet |
| Harness and human control | 15 | Guides, sensors, backpressure, behavior gate, governance, entropy control |
| Progressive disclosure and templates | 10 | Required references, `.ai` assets, `.prompt` layer assets, no placeholders |
| Executable validation and portability | 10 | Standard-library scripts, read-only audit, self-tests, actionable failures |

The scorer prints every passed and failed criterion with a remediation. A missing critical file cannot
be offset by unrelated content.

## Project Adoption Score

Run `python3 scripts/audit_project.py <repo>`. The audit is read-only and totals 100:

| Dimension | Points |
| --- | ---: |
| Agent entry and task-routed context | 15 |
| Requirements, architecture, terms, and decisions | 20 |
| Risk routing and change workflow | 15 |
| Layered `.prompt` assets | 10 |
| Deterministic engineering sensors | 20 |
| Guardrails and production/data safety | 10 |
| Human behavior evidence and governance | 10 |

A lower score is a diagnosis, not permission to install every missing artifact. Recommend the smallest
improvement that fits the repository and obtain authority before changing developer workflow,
permissions, hooks, CI, or distribution.

## Release Gates

Do not distribute or apply the Skill until all are true:

1. Skill score is 100/100.
2. `score_skill.py --self-test` passes its valid and intentionally damaged fixtures.
3. `audit_project.py --self-test` passes complete and incomplete repository fixtures.
4. The platform Skill validator passes.
5. Packaging succeeds and the archive contains no symlinks, caches, secrets, or generated test output.
6. A fresh invocation can locate every reference and explain Fast, Standard, and Strict routing.

## Interpretation

100/100 means all published, mechanically checkable criteria are present. It does not prove that every
prompt is ideal, every project is mature, or every future business decision is correct. Improve the
rubric when real usage exposes a failure it did not detect.
