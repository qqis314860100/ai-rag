#!/usr/bin/env python3
"""Advisory diff audit for topic/risk/validation decisions.

This script is intentionally non-blocking. It prints guidance for agents and
humans before commit, but exits 0 so small-team flow stays light.
"""

from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

SERVICE_PREFIXES = {
    "web": ("web/",),
    "api": ("api/",),
    "rag": ("rag/",),
}

RISK_PATTERNS = {
    "auth/permissions": ("auth", "login", "permission", "role", "token", "session", "权限", "登录"),
    "chat main flow": ("chat", "message", "conversation", "stream", "retry", "abort", "聊天", "流式", "重试", "中断"),
    "upload/indexing": ("upload", "ingest", "index", "embedding", "上传", "索引", "导入"),
    "retrieval/rag": ("retrieval", "search", "rag", "prompt", "llm", "检索"),
    "delete/destructive": ("delete", "remove", "truncate", "drop", "删除", "清空"),
    "migration/data": ("migration", "migrate", "schema", "sqlite", ".db", "迁移"),
    "automation": ("ralph", "afk", "automation", "workflow", "自动化"),
    "release/config": ("deploy", "release", ".env", "secret", "ci.yml", "发布", "密钥"),
}

DOC_EXTENSIONS = {".md", ".txt"}
CONFIG_FILES = {"package.json", "pnpm-lock.yaml", "bun.lock", ".gitignore"}


def run_git(args: list[str]) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def changed_files() -> list[str]:
    tracked = run_git(["diff", "--name-only", "HEAD"]).splitlines()
    untracked = run_git(["ls-files", "--others", "--exclude-standard"]).splitlines()
    return sorted(set(filter(None, tracked + untracked)))


def changed_areas(files: list[str]) -> list[str]:
    areas: set[str] = set()
    for file in files:
        matched = False
        for area, prefixes in SERVICE_PREFIXES.items():
            if file.startswith(prefixes):
                areas.add(area)
                matched = True
        if not matched:
            if file.startswith("docs/") or Path(file).suffix in DOC_EXTENSIONS:
                areas.add("docs")
            elif file.startswith("scripts/"):
                areas.add("scripts")
            elif file in CONFIG_FILES or file.startswith(".github/"):
                areas.add("repo")
            else:
                areas.add("other")
    return sorted(areas)


def risk_flags(files: list[str], diff_text: str, areas: list[str]) -> list[str]:
    services = [area for area in areas if area in SERVICE_PREFIXES]
    haystack = "\n".join(files).lower()
    if services:
        haystack += "\n" + diff_text.lower()

    flags = []
    for label, patterns in RISK_PATTERNS.items():
        if any(pattern.lower() in haystack for pattern in patterns):
            flags.append(label)
    return flags


def is_docs_only(files: list[str]) -> bool:
    return bool(files) and all(file.startswith("docs/") or Path(file).suffix in DOC_EXTENSIONS for file in files)


def suggest_scope(areas: list[str]) -> str:
    services = [area for area in areas if area in SERVICE_PREFIXES]
    if len(services) == 1 and len(areas) == 1:
        return services[0]
    if len(services) > 1:
        return "repo or no scope; confirm these service changes are one topic"
    if areas == ["docs"]:
        return "docs or no scope"
    return "repo or no scope"


def suggest_validation(areas: list[str], risks: list[str], files: list[str]) -> list[str]:
    suggestions: list[str] = []
    services = [area for area in areas if area in SERVICE_PREFIXES]

    if not files:
        return ["No diff detected."]

    if risks:
        suggestions.append("High-risk flags found: verify the relevant real user/service path or equivalent smoke.")

    if "web" in services:
        suggestions.append("web: run targeted check such as pnpm run lint:web or pnpm run build:web; use browser smoke for high-risk UI/chat flow.")
    if "api" in services:
        suggestions.append("api: run targeted API smoke, pnpm run build:api, or pnpm run test:api for core behavior.")
    if "rag" in services:
        suggestions.append("rag: run python3 -m compileall rag/app; use health/search/chat smoke for ingest/retrieval/LLM changes.")
    if "scripts" in areas:
        suggestions.append("scripts: run syntax/targeted script check, for example python3 -m py_compile <script> or bash -n <script>.")
    if is_docs_only(files):
        suggestions.append("docs: no runtime check required unless rules/scripts changed; skim links and terminology.")
    if len(services) > 1:
        suggestions.append("cross-service: confirm all service changes serve one user intent or contract; split unrelated work.")
    if not suggestions:
        suggestions.append("Run the smallest check that covers the changed files.")

    return suggestions


def print_list(title: str, items: list[str]) -> None:
    print(title)
    if items:
        for item in items:
            print(f"- {item}")
    else:
        print("- none")


def main() -> int:
    files = changed_files()
    diff_text = run_git(["diff", "--unified=0", "HEAD", "--", *files]) if files else ""
    areas = changed_areas(files)
    risks = risk_flags(files, diff_text, areas)
    services = [area for area in areas if area in SERVICE_PREFIXES]

    print("## Diff Advisory Audit")
    print_list("Changed files:", files)
    print_list("Changed areas:", areas)
    print_list("Risk flags:", risks)

    print("Topic hint:")
    if not files:
        print("- no changes")
    elif len(services) > 1:
        print("- cross-service diff: allowed only if all changes serve one topic")
    elif len(areas) > 1 and not is_docs_only(files):
        print("- mixed areas: confirm this is one coherent topic")
    else:
        print("- likely single-topic, but confirm against the user goal")

    print(f"Suggested commit scope: {suggest_scope(areas)}")
    print_list("Suggested validation:", suggest_validation(areas, risks, files))
    print("Result: advisory only; this command does not block commits.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
