#!/usr/bin/env python3
"""Lightweight repository harness audit.

Checks the project entry points, rule docs, architecture doc, and core scripts.
This is intentionally small and deterministic so it can be used in CI.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def check(label: str, path: Path, missing: list[str]) -> bool:
    ok = path.exists()
    status = "OK" if ok else "MISSING"
    print(f"- {label}: {status} ({path.relative_to(ROOT)})")
    if not ok:
        missing.append(str(path.relative_to(ROOT)))
    return ok


def main() -> int:
    missing: list[str] = []

    print("## Harness Summary")

    check("Root guide", ROOT / "CLAUDE.md", missing)
    check("README", ROOT / "README.md", missing)
    check("Execution rules", ROOT / "docs/EXECUTION_RULES.md", missing)
    check("Contribution rules", ROOT / "docs/CONTRIBUTING.md", missing)
    check("Architecture standard", ROOT / "docs/架构标准.md", missing)
    check("ESLint config", ROOT / "eslint.config.mjs", missing)
    check("CI workflow", ROOT / ".github/workflows/ci.yml", missing)

    package_json = read_json(ROOT / "package.json")
    scripts = package_json.get("scripts", {})
    required_scripts = [
        "lint:web",
        "lint:api",
        "lint",
        "build:web",
        "build:api",
        "build",
        "check:rag",
        "audit:harness",
        "verify",
        "test:api",
    ]

    print("## Scripts")
    for name in required_scripts:
        status = "OK" if name in scripts else "MISSING"
        print(f"- {name}: {status}")
        if name not in scripts:
            missing.append(f"package.json script: {name}")

    print("## Guidance")
    print("- Current maturity: workable")
    print("- Main risk: rules exist in docs but are not yet enforced everywhere")
    print("- Best next improvement: add service-specific smoke checks to CI after this baseline")

    if missing:
        print("## Missing")
        for item in missing:
            print(f"- {item}")
        return 1

    print("## Result")
    print("- Harness baseline is present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
