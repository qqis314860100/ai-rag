#!/usr/bin/env python3
"""Advisory diff audit for topic/risk/validation decisions.

This script is intentionally non-blocking. It prints guidance for agents and
humans before commit, but exits 0 so small-team flow stays light.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

SERVICE_PREFIXES = {
    "web": ("web/",),
    "api": ("api/",),
    "rag": ("rag/",),
}

RISK_PATTERNS = {
    "登录/权限/会话": ("auth", "login", "permission", "role", "token", "session", "权限", "登录"),
    "聊天主链路/流式/重试": ("chat", "message", "conversation", "stream", "retry", "abort", "聊天", "流式", "重试", "中断"),
    "上传/索引/embedding": ("upload", "ingest", "index", "embedding", "上传", "索引", "导入"),
    "检索/RAG/LLM": ("retrieval", "search", "rag", "prompt", "llm", "检索"),
    "删除/破坏性操作": ("delete", "remove", "truncate", "drop", "删除", "清空"),
    "迁移/数据结构": ("migration", "migrate", "schema", "sqlite", ".db", "迁移"),
    "AFK/Ralph/自动化": ("ralph", "afk", "automation", "workflow", "自动化"),
    "发布/CI/密钥配置": ("deploy", "release", ".env", "secret", "ci.yml", "发布", "密钥"),
}

DOC_EXTENSIONS = {".md", ".txt"}
CONFIG_FILES = {"package.json", "pnpm-lock.yaml", "bun.lock", ".gitignore"}
RULE_FILES = {
    "AGENTS.md",
    "CLAUDE.md",
    "docs/EXECUTION_RULES.md",
    "docs/CONTRIBUTING.md",
    "docs/架构标准.md",
    "docs/Codex架构配置.md",
    "scripts/audit_diff.py",
    "scripts/audit_harness.py",
}


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
    if any(file in RULE_FILES for file in files):
        flags.append("项目规则/护栏")
    return flags


def is_docs_only(files: list[str]) -> bool:
    return bool(files) and all(file.startswith("docs/") or Path(file).suffix in DOC_EXTENSIONS for file in files)


def is_rule_change(files: list[str]) -> bool:
    return any(file in RULE_FILES for file in files)


def risk_level(risks: list[str]) -> str:
    if not risks:
        return "普通"
    if risks == ["项目规则/护栏"]:
        return "普通偏流程"
    return "高风险"


def is_high_risk(risks: list[str]) -> bool:
    return bool(risks) and risks != ["项目规则/护栏"]


def real_flow_required(risks: list[str]) -> str:
    if not risks:
        return "否"
    if risks == ["项目规则/护栏"]:
        return "否；需要脚本/文档自检"
    return "是；至少验证相关真实页面、API、RAG 或自动化链路"


def topic_hint(areas: list[str], files: list[str]) -> str:
    if not files:
        return "无变更"

    services = [area for area in areas if area in SERVICE_PREFIXES]
    non_service_areas = [area for area in areas if area not in SERVICE_PREFIXES]

    if is_docs_only(files):
        return "可能单主题：文档改动，确认没有混入无关文档主题"
    if is_rule_change(files) and all(area in {"docs", "scripts", "repo"} for area in areas):
        return "可能单主题：项目规则/护栏改动，确认文档和脚本服务同一条规则"
    if len(services) > 1:
        return "需要确认：跨服务 diff，只能是同一用户意图、接口契约或服务链路"
    if len(services) == 1 and not non_service_areas:
        return "可能单主题：单服务改动，仍需确认没有顺手修无关问题"
    if len(areas) > 1:
        return "需要确认：跨区域 diff，说明共同主题；说不清就拆"
    return "可能单主题：确认与本次用户目标一致"


def split_hint(areas: list[str], files: list[str]) -> str:
    if not files:
        return "无需拆分"
    if "other" in areas:
        return "检查 other 区域是否为必要改动；无因果关系就拆"
    if "docs" in areas and len(areas) > 1 and not is_rule_change(files):
        return "确认文档是否直接解释本次代码改动；纯顺手补文档就拆"
    services = [area for area in areas if area in SERVICE_PREFIXES]
    if len(services) > 1:
        return "跨服务必须能指向同一契约/链路；不能证明就拆"
    return "暂无明显拆分信号"


def services_in(areas: list[str]) -> list[str]:
    return [area for area in areas if area in SERVICE_PREFIXES]


def is_rule_only_change(areas: list[str], files: list[str]) -> bool:
    return is_rule_change(files) and all(area in {"docs", "scripts", "repo"} for area in areas)


def has_mixed_area_signal(areas: list[str], files: list[str]) -> bool:
    if not files or is_docs_only(files) or is_rule_only_change(areas, files):
        return False
    return "other" in areas or len(areas) > 1


def suggest_scope(areas: list[str]) -> str:
    services = services_in(areas)
    if len(services) == 1 and len(areas) == 1:
        return services[0]
    if len(services) > 1:
        return "repo 或省略 scope；先确认跨服务同主题"
    if areas == ["docs"]:
        return "docs 或省略 scope"
    return "repo 或省略 scope"


def suggest_validation(areas: list[str], risks: list[str], files: list[str]) -> list[str]:
    suggestions: list[str] = []
    services = services_in(areas)

    if not files:
        return ["无 diff。"]

    high_risk = bool(risks) and risks != ["项目规则/护栏"]
    if high_risk:
        suggestions.append("命中高风险：需要验证相关真实用户/服务链路或等价 smoke。")
    elif is_rule_change(files):
        suggestions.append("规则/护栏改动：跑脚本语法、自检和 diff 审计即可，不要求产品链路。")

    if "web" in services:
        suggestions.append("web：普通改动跑 pnpm run lint:web 或 pnpm run build:web；高风险 UI/聊天流再做浏览器 smoke。")
    if "api" in services:
        suggestions.append("api：普通改动跑 pnpm run build:api 或定点接口 smoke；核心行为再跑 pnpm run test:api。")
    if "rag" in services:
        suggestions.append("rag：普通改动跑 python3 -m compileall rag/app；ingest/search/chat 再做健康或请求 smoke。")
    if "scripts" in areas:
        suggestions.append("scripts：跑语法/目标脚本检查，例如 python3 -m py_compile <script> 或 bash -n <script>。")
    if is_docs_only(files):
        suggestions.append("docs：无需运行时验证；检查链接、术语和规则口径。")
    if is_rule_change(files):
        suggestions.append("harness：跑 pnpm run audit:harness 和 pnpm run audit:diff。")
    if len(services) > 1:
        suggestions.append("跨服务：确认所有服务改动服务同一用户意图或契约；无关改动先拆。")
    if not suggestions:
        suggestions.append("跑能覆盖本次改动文件的最小检查。")

    return suggestions


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="输出 diff 决策卡；默认只提示，--strict 才会用证据参数拦截高风险提交。"
    )
    parser.add_argument("--strict", action="store_true", help="启用 AFK/发布/高风险用严格模式。")
    parser.add_argument(
        "--topic",
        default="",
        help="跨服务或混区域时填写一句同主题说明，例如：聊天接口契约同步。",
    )
    parser.add_argument(
        "--validation",
        action="append",
        default=[],
        help="高风险时填写已执行验证，可重复传入，例如：--validation 'pnpm run build:web'。",
    )
    parser.add_argument(
        "--harness-checked",
        action="store_true",
        help="规则/脚本改动已跑过 audit:harness 或等价 harness 自检。",
    )
    argv = sys.argv[1:]
    if argv and argv[0] == "--":
        argv = argv[1:]
    return parser.parse_args(argv)


def has_note(text: str) -> bool:
    return len(text.strip()) >= 8


def strict_issues(args: argparse.Namespace, areas: list[str], risks: list[str], files: list[str]) -> list[str]:
    issues: list[str] = []
    services = services_in(areas)

    if is_high_risk(risks) and not args.validation:
        issues.append("高风险改动缺少验证说明。修正：先跑真实链路或等价 smoke，再传 --validation '<命令或证据>'。")

    if len(services) > 1 and not has_note(args.topic):
        issues.append("跨服务改动缺少同主题说明。修正：传 --topic '<同一用户意图/接口契约/服务链路>'，或拆分提交。")

    if has_mixed_area_signal(areas, files) and not has_note(args.topic):
        issues.append("跨区域 diff 缺少主题说明。修正：传 --topic '<共同主题>'；说不清就拆分。")

    if ("scripts" in areas or is_rule_change(files)) and not args.harness_checked:
        issues.append("规则/脚本改动缺少 harness 自检确认。修正：跑 pnpm run audit:harness 后传 --harness-checked。")

    return issues


def print_strict_result(args: argparse.Namespace, issues: list[str]) -> None:
    if not args.strict:
        print("严格模式：未启用。")
        return

    if issues:
        print("严格模式：未通过")
        print_list("命中问题：", issues)
        return

    print("严格模式：通过")


def print_list(title: str, items: list[str]) -> None:
    print(title)
    if items:
        for item in items:
            print(f"- {item}")
    else:
        print("- none")


def main() -> int:
    args = parse_args()
    files = changed_files()
    diff_text = run_git(["diff", "--unified=0", "HEAD", "--", *files]) if files else ""
    areas = changed_areas(files)
    risks = risk_flags(files, diff_text, areas)
    issues = strict_issues(args, areas, risks, files) if args.strict else []

    print("## Diff 决策卡")
    print(f"- 主题判断：{topic_hint(areas, files)}")
    print(f"- 风险等级：{risk_level(risks)}")
    print(f"- 是否需要真实链路：{real_flow_required(risks)}")
    print(f"- 建议 commit scope：{suggest_scope(areas)}")
    print(f"- 拆分建议：{split_hint(areas, files)}")
    print_list("变更区域：", areas)
    print_list("风险命中：", risks)
    print_list("建议验证：", suggest_validation(areas, risks, files))
    if args.topic:
        print(f"主题说明：{args.topic}")
    if args.validation:
        print_list("验证说明：", args.validation)
    print_list("变更文件：", files)
    print_strict_result(args, issues)
    print("结果：默认仅提示；严格模式未通过时返回失败。")
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
