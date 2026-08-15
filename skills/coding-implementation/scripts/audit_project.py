#!/usr/bin/env python3
"""Read-only audit for coding-implementation project adoption."""

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class Finding:
    name: str
    points: int
    passed: bool
    evidence: str
    recommendation: str


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def any_existing(root: Path, paths: list[str]) -> Path | None:
    return next((root / path for path in paths if (root / path).exists()), None)


def all_terms(text: str, groups: list[tuple[str, ...]]) -> bool:
    lowered = text.lower()
    return all(any(term.lower() in lowered for term in group) for group in groups)


def add(
    findings: list[Finding],
    name: str,
    points: int,
    passed: bool,
    evidence: str,
    recommendation: str,
) -> None:
    findings.append(Finding(name, points, passed, evidence, recommendation))


def package_scripts(root: Path) -> set[str]:
    package_files = list(root.glob("package.json")) + list(root.glob("*/package.json"))
    scripts: set[str] = set()
    for path in package_files:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        values = payload.get("scripts", {})
        if isinstance(values, dict):
            scripts.update(str(key).lower() for key in values)
    return scripts


def maven_test_support(root: Path) -> bool:
    for relative in ["pom.xml", "backend/pom.xml"]:
        path = root / relative
        if not path.exists():
            continue
        source_root = path.parent / "src" / "test"
        if source_root.exists() and any(item.is_file() for item in source_root.rglob("*")):
            return True
        try:
            tree = ET.parse(path)
        except (ET.ParseError, OSError):
            continue
        artifact_ids = {
            (element.text or "").strip().lower()
            for element in tree.iter()
            if element.tag.rsplit("}", 1)[-1] == "artifactId"
        }
        if artifact_ids.intersection(
            {"junit", "junit-jupiter", "spring-boot-starter-test", "maven-surefire-plugin"}
        ):
            return True
    return False


def audit_project(root: Path) -> tuple[int, list[Finding]]:
    root = root.resolve()
    findings: list[Finding] = []

    guide_path = any_existing(root, ["AGENTS.md", "CLAUDE.md"])
    guide = read(guide_path) if guide_path else ""
    add(
        findings,
        "Guide: Agent entry point",
        10,
        bool(guide_path and guide.strip()),
        str(guide_path.relative_to(root)) if guide_path else "missing",
        "Add a short AGENTS.md or CLAUDE.md that routes agents to project facts and checks.",
    )
    routed = all_terms(
        guide,
        [("read", "阅读", "start"), ("relevant", "相关", "按任务"), ("verify", "验证", "test")],
    )
    add(
        findings,
        "Guide: task-routed context and verification",
        5,
        routed,
        "read/relevant/verify routing" if routed else "routing markers incomplete",
        "Tell agents what to read by task and which verification closes the task.",
    )

    requirement = any_existing(root, ["requirement.md", "REQUIREMENTS.md", "SPEC.md", "docs/requirements"])
    architecture = any_existing(root, ["docs/technical-design.md", "docs/ARCHITECTURE.md", "ARCHITECTURE.md"])
    terms = any_existing(root, ["CONTEXT.md", "docs/domain.md", "docs/glossary.md"])
    decisions = any_existing(root, ["docs/adr", "docs/decisions", "adr"])
    add(findings, "Knowledge: requirements", 5, requirement is not None, str(requirement or "missing"), "Add or link the product requirement/specification source.")
    add(findings, "Knowledge: architecture", 5, architecture is not None, str(architecture or "missing"), "Document module boundaries and dependency direction.")
    add(findings, "Knowledge: domain terms", 5, terms is not None, str(terms or "missing"), "Add a domain context or glossary source.")
    add(findings, "Knowledge: decisions", 5, decisions is not None, str(decisions or "missing"), "Provide an ADR or decisions index for durable non-obvious choices.")

    pipeline_path = root / ".ai" / "pipeline.yaml"
    pipeline = read(pipeline_path)
    risk_ready = pipeline_path.exists() and all_terms(
        pipeline,
        [("fast",), ("standard",), ("strict",), ("risk",), ("intake",), ("verify",)],
    )
    add(
        findings,
        "Workflow: risk routing configuration",
        8,
        risk_ready,
        ".ai/pipeline.yaml" if risk_ready else "missing or incomplete",
        "Configure Fast/Standard/Strict routing, stages, evidence, and project checks.",
    )
    change_template = root / ".ai" / "templates" / "change.md"
    change_text = read(change_template)
    record_ready = change_template.exists() and all_terms(
        change_text,
        [("goal", "目标"), ("risk", "风险"), ("acceptance", "验收"), ("evidence", "证据"), ("human", "人工")],
    )
    add(
        findings,
        "Workflow: evidence-backed change record",
        7,
        record_ready,
        ".ai/templates/change.md" if record_ready else "missing or incomplete",
        "Add one compact change template covering goal, risk, acceptance, evidence, and human gates.",
    )

    prompt_root = root / ".prompt"
    prompt_dirs = ["工作流", "技术方案", "数据层", "业务层", "应用层", "审查"]
    prompt_count = len(list(prompt_root.rglob("*.md"))) if prompt_root.exists() else 0
    prompt_ready = all((prompt_root / directory).is_dir() for directory in prompt_dirs) and (prompt_root / "工程结构.md").exists() and prompt_count >= 12
    add(
        findings,
        "Prompts: layered project templates",
        10,
        prompt_ready,
        f"directories={sum((prompt_root / directory).is_dir() for directory in prompt_dirs)} files={prompt_count}",
        "Add focused workflow, technical, data, business, application, review, and engineering templates.",
    )

    scripts = package_scripts(root)
    maven = any((root / candidate).exists() for candidate in ["pom.xml", "backend/pom.xml"])
    gradle = any((root / candidate).exists() for candidate in ["build.gradle", "build.gradle.kts", "backend/build.gradle", "backend/build.gradle.kts"])
    local_sensor_count = sum(name in scripts for name in ["lint", "typecheck", "test", "build"])
    local_ready = local_sensor_count >= 2 or (local_sensor_count >= 1 and (maven or gradle))
    add(
        findings,
        "Sensors: local deterministic checks",
        10,
        local_ready,
        f"package_scripts={sorted(scripts)} maven={maven} gradle={gradle}",
        "Expose project lint/typecheck/test/build checks through stable local commands.",
    )
    test_files = [item for item in root.glob("**/src/test/**/*") if item.is_file()]
    test_files += [item for item in root.glob("**/*.test.*") if item.is_file()]
    test_files += [item for item in root.glob("**/*.spec.*") if item.is_file()]
    build_test_support = maven_test_support(root) or (
        gradle and any((root / path).exists() for path in ["src/test", "backend/src/test"])
    )
    test_signal = bool(test_files or build_test_support or "test" in scripts)
    add(
        findings,
        "Sensors: test signal",
        5,
        test_signal,
        f"test_files={len(test_files)} build_test_support={build_test_support or 'test' in scripts}",
        "Add a test command or directly discoverable automated tests.",
    )
    ci_files = list((root / ".github" / "workflows").glob("*.y*ml")) if (root / ".github" / "workflows").exists() else []
    documented_verify = all_terms(guide + pipeline, [("lint",), ("test",), ("build", "typecheck")])
    feedback_ready = bool(ci_files) or documented_verify
    add(
        findings,
        "Sensors: repeatable verification gate",
        5,
        feedback_ready,
        f"ci_files={len(ci_files)} documented={documented_verify}",
        "Add CI or a documented repeatable verification gate with actionable commands.",
    )

    safety_text = guide + "\n" + pipeline
    safe = all_terms(
        safety_text,
        [("production", "生产"), ("data", "数据"), ("credential", "凭据", "secret"), ("irreversible", "不可逆", "dangerous", "危险")],
    )
    add(
        findings,
        "Guardrails: production and data safety",
        10,
        safe,
        "production/data/credential/danger markers" if safe else "safety markers incomplete",
        "Document production, data, credential, and irreversible-operation boundaries.",
    )

    governance_text = guide + "\n" + pipeline + "\n" + change_text
    governed = all_terms(
        governance_text,
        [("human", "人工"), ("evidence", "证据"), ("archive", "归档"), ("adr", "decision", "决策")],
    )
    add(
        findings,
        "Governance: human evidence and durable decisions",
        10,
        governed,
        "human/evidence/archive/decision markers" if governed else "governance markers incomplete",
        "Record human behavior gates, evidence, archive rules, and durable decisions.",
    )

    assert sum(finding.points for finding in findings) == 100
    return sum(finding.points for finding in findings if finding.passed), findings


def write_complete_fixture(root: Path) -> None:
    files = {
        "AGENTS.md": "Read only relevant requirements. Verify with lint, typecheck, test, and build. Never access production data, credentials, secrets, or run dangerous irreversible actions. Preserve human evidence, archive outcomes, and update ADR decisions.\n",
        "requirement.md": "# Requirements\n",
        "CONTEXT.md": "# Domain terms\n",
        "docs/technical-design.md": "# Architecture\n",
        "docs/adr/README.md": "# Decisions\n",
        ".ai/pipeline.yaml": "risk:\n  paths: [Fast, Standard, Strict]\nstages: [intake, clarify, specify, plan, apply, verify, archive]\nevidence: required\nchecks: [lint, typecheck, test, build]\nhuman_gate: required\narchive: ADR decisions\nproduction: forbidden\ndata: preserve\ncredentials: forbidden\nirreversible: approval\n",
        ".ai/templates/change.md": "# Change\nGoal:\nRisk:\nAcceptance:\nEvidence:\nHuman gate:\nArchive decision:\n",
        "package.json": json.dumps({"scripts": {"lint": "lint", "typecheck": "typecheck", "test": "test", "build": "build"}}),
        "src/example.test.js": "test('fixture', () => {});\n",
        ".prompt/工程结构.md": "# Engineering structure\n",
    }
    for directory in ["工作流", "技术方案", "数据层", "业务层", "应用层", "审查"]:
        for index in range(2):
            files[f".prompt/{directory}/模板-{index + 1}.md"] = f"# {directory} template {index + 1}\n"
    for relative, content in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def self_test() -> None:
    with tempfile.TemporaryDirectory(prefix="coding-implementation-audit-") as temp_dir:
        complete = Path(temp_dir) / "complete"
        complete.mkdir()
        write_complete_fixture(complete)
        score, findings = audit_project(complete)
        if score != 100 or not all(finding.passed for finding in findings):
            raise AssertionError(f"complete fixture should score 100, got {score}")

        incomplete = Path(temp_dir) / "incomplete"
        shutil.copytree(complete, incomplete)
        (incomplete / ".ai" / "pipeline.yaml").unlink()
        (incomplete / ".prompt" / "工程结构.md").unlink()
        damaged_score, damaged_findings = audit_project(incomplete)
        if damaged_score >= 100:
            raise AssertionError("missing pipeline and prompt assets must reduce the score")
        if not any(not finding.passed and finding.recommendation for finding in damaged_findings):
            raise AssertionError("failed findings must include recommendations")

        malformed = Path(temp_dir) / "malformed"
        shutil.copytree(complete, malformed)
        (malformed / "package.json").write_text("{not-json", encoding="utf-8")
        malformed_score, malformed_findings = audit_project(malformed)
        if malformed_score >= 100 or not malformed_findings:
            raise AssertionError("malformed configuration must be handled as a scored failure")


def render(root: Path, score: int, findings: list[Finding]) -> str:
    lines = [f"Repo: {root.resolve()}", f"Score: {score}/100", "Mode: read-only"]
    for finding in findings:
        status = "PASS" if finding.passed else "FAIL"
        lines.append(f"[{status}] {finding.points:>2} {finding.name}: {finding.evidence}")
        if not finding.passed:
            lines.append(f"       Recommendation: {finding.recommendation}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", nargs="?", help="Repository root to audit in read-only mode")
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        print("Self-test: PASS")
        if not args.repo:
            return 0
    if not args.repo:
        parser.error("repo is required unless --self-test is used")

    root = Path(args.repo)
    if not root.is_dir():
        parser.error(f"repository directory not found: {root}")
    score, findings = audit_project(root)
    if args.as_json:
        print(json.dumps({"repo": str(root.resolve()), "score": score, "mode": "read-only", "findings": [asdict(finding) for finding in findings]}, ensure_ascii=False, indent=2))
    else:
        print(render(root, score, findings))
    return 0 if score == 100 else 1


if __name__ == "__main__":
    raise SystemExit(main())
