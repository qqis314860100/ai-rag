#!/usr/bin/env python3
"""Deterministically score the coding-implementation Skill."""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import shutil
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class Check:
    name: str
    points: int
    passed: bool
    evidence: str
    fix: str


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def contains_all(text: str, terms: list[str]) -> bool:
    lowered = text.lower()
    return all(term.lower() in lowered for term in terms)


def add(
    checks: list[Check],
    name: str,
    points: int,
    passed: bool,
    evidence: str,
    fix: str,
) -> None:
    checks.append(Check(name, points, passed, evidence, fix))


def frontmatter(skill_text: str) -> dict[str, str]:
    match = re.match(r"^---\n(.*?)\n---\n", skill_text, flags=re.DOTALL)
    if not match:
        return {}
    result: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        result[key.strip()] = value.strip().strip("\"'")
    return result


def score_skill(root: Path) -> tuple[int, list[Check]]:
    root = root.resolve()
    skill = read(root / "SKILL.md")
    method = read(root / "references" / "methodology.md")
    risk = read(root / "references" / "risk-routing.md")
    gate = read(root / "references" / "gate-contract.md")
    rubric = read(root / "references" / "scoring-rubric.md")
    checks: list[Check] = []

    meta = frontmatter(skill)
    add(
        checks,
        "Structure: frontmatter",
        5,
        meta.get("name") == "coding-implementation"
        and set(meta) == {"name", "description"},
        f"keys={sorted(meta)} name={meta.get('name', 'missing')}",
        "Use only name and description frontmatter with the canonical Skill name.",
    )
    description = meta.get("description", "")
    add(
        checks,
        "Structure: triggering description",
        4,
        contains_all(description, ["risk-adaptive", "vibe coding", "use when"]),
        f"description_length={len(description)}",
        "Describe the capability and explicit invocation/setup/audit triggers.",
    )
    placeholder_terms = ["TO" + "DO", "T" + "BD", "FIX" + "ME"]
    placeholder_pattern = re.compile(
        r"\b(" + "|".join(placeholder_terms) + r")\b|\[" + placeholder_terms[0],
        re.IGNORECASE,
    )
    add(
        checks,
        "Structure: concise and complete SKILL.md",
        3,
        20 <= len(skill.splitlines()) <= 500 and not placeholder_pattern.search(skill),
        f"lines={len(skill.splitlines())}",
        "Keep SKILL.md between 20 and 500 lines and remove placeholders.",
    )
    links = re.findall(r"\[[^\]]+\]\(([^)]+)\)", skill)
    local_links = [link for link in links if "://" not in link and not link.startswith("#")]
    unresolved = [link for link in local_links if not (root / link).exists()]
    add(
        checks,
        "Structure: direct references resolve",
        3,
        len(local_links) >= 4 and not unresolved,
        f"local_links={len(local_links)} unresolved={unresolved}",
        "Link every core reference directly from SKILL.md and fix unresolved paths.",
    )

    stages = ["intake", "clarify", "specify", "plan", "apply", "verify", "archive"]
    add(
        checks,
        "Method: seven-stage lifecycle",
        5,
        contains_all(skill + method, stages),
        "stages=" + ",".join(stage for stage in stages if stage in (skill + method).lower()),
        "Define all seven lifecycle stages in the core workflow.",
    )
    add(
        checks,
        "Method: orthogonal R2C and Harness axes",
        5,
        contains_all(method, ["two-axis", "r2c lifecycle", "project harness", "horizontally"]),
        "methodology two-axis markers",
        "Explain R2C as lifecycle and Harness as cross-cutting capability.",
    )
    add(
        checks,
        "Method: repository record and outcome constraints",
        5,
        contains_all(method + skill, ["repository as record", "backpressure", "outcomes", "evidence"]),
        "record/backpressure/evidence markers",
        "Make repository truth, outcome constraints, and evidence explicit.",
    )

    dimensions = [
        "ambiguity",
        "blast radius",
        "data",
        "auth and security",
        "public contract",
        "production operations",
        "reversibility",
    ]
    add(
        checks,
        "Risk: seven assessment dimensions",
        5,
        contains_all(risk, dimensions),
        "dimensions=" + ",".join(term for term in dimensions if term in risk.lower()),
        "Define all seven risk dimensions with 0-2 evidence anchors.",
    )
    add(
        checks,
        "Risk: paths and thresholds",
        4,
        contains_all(risk, ["fast", "standard", "strict", "0-2", "3-7", "8 or more"]),
        "Fast/Standard/Strict numeric thresholds",
        "Define all paths and non-overlapping thresholds.",
    )
    add(
        checks,
        "Risk: hard triggers and safe override",
        4,
        contains_all(risk, ["hard strict triggers", "raise", "lower", "explicit acceptance", "never lower"]),
        "hard-trigger and override markers",
        "List mandatory Strict triggers and safe raise/lower override behavior.",
    )
    add(
        checks,
        "Risk: representative scenarios",
        2,
        risk.lower().count("| strict |") >= 2 and "| fast |" in risk.lower() and "| standard |" in risk.lower(),
        "Fast/Standard/Strict example rows",
        "Include representative expected-path examples.",
    )

    fields = ["input", "action", "artifact", "sensor", "human gate", "exit evidence"]
    add(
        checks,
        "Gate: six-field contract",
        6,
        contains_all(gate, fields),
        "fields=" + ",".join(field for field in fields if field in gate.lower()),
        "Define input, action, artifact, sensor, human gate, and exit evidence.",
    )
    gate_headings = [f"### {stage.title()}" for stage in stages]
    add(
        checks,
        "Gate: all stage contracts",
        7,
        all(heading in gate for heading in gate_headings),
        "headings=" + ",".join(heading for heading in gate_headings if heading in gate),
        "Add a complete contract section for every lifecycle stage.",
    )
    add(
        checks,
        "Gate: failure transitions",
        4,
        contains_all(gate, ["failure transitions", "return to clarify", "return to specify", "return to plan", "return to apply", "awaiting-human"]),
        "backward and waiting transitions",
        "Map failed evidence to the correct earlier stage or human wait state.",
    )
    add(
        checks,
        "Gate: completion packet",
        3,
        contains_all(gate, ["completion packet", "selected path", "commands/checks", "remaining risks"]),
        "completion packet markers",
        "Specify a concise, evidence-backed completion packet.",
    )

    harness_terms = [
        "repository as record",
        "guides before work",
        "sensors after work",
        "backpressure over prescription",
        "human behavior gate",
        "governance and entropy control",
    ]
    add(
        checks,
        "Harness: capability coverage",
        7,
        contains_all(method, harness_terms),
        "capabilities=" + str(sum(term in method.lower() for term in harness_terms)),
        "Cover records, guides, sensors, backpressure, human behavior, and entropy.",
    )
    add(
        checks,
        "Harness: safety boundaries",
        4,
        contains_all(skill, ["do not invent", "do not weaken", "production", "irreversible", "secrets"]),
        "non-negotiable boundary markers",
        "State non-negotiable evidence, production, irreversible, and secret boundaries.",
    )
    add(
        checks,
        "Harness: behavior evidence",
        4,
        contains_all(skill + method + gate, ["screenshots", "logs", "human", "product behavior"]),
        "behavior/human evidence markers",
        "Require behavior evidence and explicit human decisions where tools cannot prove intent.",
    )

    required_refs = [
        root / "references" / "methodology.md",
        root / "references" / "risk-routing.md",
        root / "references" / "gate-contract.md",
        root / "references" / "scoring-rubric.md",
    ]
    add(
        checks,
        "Disclosure: focused references",
        3,
        all(path.exists() and len(read(path).splitlines()) >= 20 for path in required_refs),
        "references=" + str(sum(path.exists() for path in required_refs)),
        "Provide all four focused, non-empty reference files.",
    )
    ai_assets = [
        root / "assets" / "project-template" / ".ai" / "pipeline.yaml",
        root / "assets" / "project-template" / ".ai" / "templates" / "change.md",
    ]
    add(
        checks,
        "Disclosure: pipeline assets",
        2,
        all(path.exists() and read(path).strip() for path in ai_assets),
        "pipeline_assets=" + str(sum(path.exists() for path in ai_assets)),
        "Add a risk-aware pipeline config and minimal change record template.",
    )
    prompt_root = root / "assets" / "project-template" / ".prompt"
    prompt_dirs = ["工作流", "技术方案", "数据层", "业务层", "应用层", "审查"]
    prompt_files = list(prompt_root.rglob("*.md")) if prompt_root.exists() else []
    add(
        checks,
        "Disclosure: layered prompt assets",
        3,
        all((prompt_root / name).is_dir() for name in prompt_dirs)
        and (prompt_root / "工程结构.md").exists()
        and len(prompt_files) >= 12,
        f"directories={sum((prompt_root / name).is_dir() for name in prompt_dirs)} markdown_files={len(prompt_files)}",
        "Provide every requested prompt layer, engineering structure, and at least 12 focused templates.",
    )
    text_files = [path for path in root.rglob("*") if path.suffix in {".md", ".yaml", ".py"}]
    placeholders = [str(path.relative_to(root)) for path in text_files if placeholder_pattern.search(read(path))]
    add(
        checks,
        "Disclosure: no placeholders",
        2,
        not placeholders,
        f"placeholder_files={placeholders}",
        "Remove unfinished markers and generated template placeholders.",
    )

    script_paths = [root / "scripts" / "score_skill.py", root / "scripts" / "audit_project.py"]
    add(
        checks,
        "Executable: required scripts",
        3,
        all(
            path.exists()
            and read(path).startswith("#!/usr/bin/env python3")
            and os.access(path, os.X_OK)
            for path in script_paths
        ),
        "scripts=" + str(sum(path.exists() for path in script_paths)),
        "Add both Python scripts with portable python3 shebangs and executable permission.",
    )
    prohibited_imports = re.compile(r"^(?:from|import)\s+(yaml|requests|click|pydantic)\b", re.MULTILINE)
    add(
        checks,
        "Executable: standard-library portability",
        2,
        all(not prohibited_imports.search(read(path)) for path in script_paths if path.exists()),
        "checked prohibited third-party imports",
        "Use Python standard-library dependencies only.",
    )
    add(
        checks,
        "Executable: read-only and actionable behavior",
        3,
        contains_all(read(script_paths[0]), ["--self-test", "fix"])
        and contains_all(read(script_paths[1]), ["--self-test", "read-only", "recommendation"]),
        "self-test/read-only/remediation markers",
        "Provide self-tests, read-only audit behavior, and actionable remediation output.",
    )
    compile_ok = True
    for path in script_paths:
        if not path.exists():
            compile_ok = False
            continue
        try:
            ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except (SyntaxError, OSError, UnicodeDecodeError):
            compile_ok = False
    add(
        checks,
        "Executable: scripts compile",
        2,
        compile_ok,
        "ast.parse result",
        "Fix Python syntax errors in validation scripts.",
    )

    assert sum(check.points for check in checks) == 100
    return sum(check.points for check in checks if check.passed), checks


def classify_risk(scores: list[int], hard_trigger: bool = False) -> str:
    if len(scores) != 7 or any(score not in {0, 1, 2} for score in scores):
        raise ValueError("risk routing requires seven scores in the range 0..2")
    total = sum(scores)
    if hard_trigger or total >= 8:
        return "Strict"
    if total <= 2 and 2 not in scores:
        return "Fast"
    return "Standard"


def self_test(root: Path) -> None:
    score, checks = score_skill(root)
    if score != 100 or not all(check.passed for check in checks):
        raise AssertionError(f"complete fixture should score 100, got {score}")
    if classify_risk([0, 0, 0, 0, 0, 0, 0]) != "Fast":
        raise AssertionError("local label scenario should be Fast")
    if classify_risk([1, 1, 0, 0, 1, 0, 1]) != "Standard":
        raise AssertionError("cross-layer search scenario should be Standard")
    if classify_risk([0, 1, 2, 0, 0, 0, 2]) != "Standard":
        raise AssertionError("non-hard score 5 scenario should be Standard")
    if classify_risk([0, 0, 0, 2, 0, 0, 0], hard_trigger=True) != "Strict":
        raise AssertionError("authorization scenario should be Strict")
    if classify_risk([1, 2, 2, 0, 1, 1, 2]) != "Strict":
        raise AssertionError("migration scenario should be Strict")
    try:
        classify_risk([0, 0, 0])
    except ValueError:
        pass
    else:
        raise AssertionError("invalid risk dimensions must be rejected")

    with tempfile.TemporaryDirectory(prefix="coding-implementation-score-") as temp_dir:
        damaged = Path(temp_dir) / root.name
        shutil.copytree(root, damaged, ignore=shutil.ignore_patterns("__pycache__"))
        (damaged / "references" / "risk-routing.md").unlink()
        damaged_score, _ = score_skill(damaged)
        if damaged_score >= 100:
            raise AssertionError("missing risk reference must reduce the score")
        with (damaged / "SKILL.md").open("a", encoding="utf-8") as handle:
            handle.write("\n" + "TO" + "DO" + ": damaged fixture\n")
        placeholder_score, _ = score_skill(damaged)
        if placeholder_score >= damaged_score:
            raise AssertionError("placeholder injection must reduce the score")


def render(score: int, checks: list[Check]) -> str:
    lines = [f"Score: {score}/100"]
    for check in checks:
        status = "PASS" if check.passed else "FAIL"
        lines.append(f"[{status}] {check.points:>2} {check.name}: {check.evidence}")
        if not check.passed:
            lines.append(f"       Fix: {check.fix}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skill_root", nargs="?", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    root = Path(args.skill_root).resolve()
    score, checks = score_skill(root)
    if args.self_test:
        self_test(root)
    if args.as_json:
        print(json.dumps({"score": score, "checks": [asdict(check) for check in checks]}, ensure_ascii=False, indent=2))
    else:
        print(render(score, checks))
        if args.self_test:
            print("Self-test: PASS")
    return 0 if score == 100 else 1


if __name__ == "__main__":
    raise SystemExit(main())
