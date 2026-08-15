#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PRD_PATH = ROOT / "PRD.md"


TASK_RE = re.compile(r"^- \[( |x|X)\] (.+?): (.+)$")


def load_tasks() -> list[dict[str, object]]:
    tasks: list[dict[str, object]] = []
    section = ""

    for raw_line in PRD_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.rstrip()
        if line.startswith("### "):
            section = line[4:].strip()
            continue

        match = TASK_RE.match(line)
        if not match:
            continue

        tasks.append(
            {
                "section": section,
                "done": match.group(1).lower() == "x",
                "service": match.group(2).replace("`", ""),
                "task": match.group(3),
                "raw": line,
            }
        )

    return tasks


def format_task(task: dict[str, object], index: int) -> str:
    service = task["service"]
    text = task["task"]
    return f"{index + 1}. [{service}] {text}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("remaining", "next", "count", "json"), default="remaining")
    parser.add_argument("--limit", type=int, default=0, help="Limit remaining task output; 0 means no limit.")
    args = parser.parse_args()

    tasks = load_tasks()
    remaining = [task for task in tasks if not task["done"]]
    visible_remaining = remaining
    if args.limit > 0:
        visible_remaining = remaining[: args.limit]

    if args.mode == "json":
        print(json.dumps({"remaining": visible_remaining, "total": len(tasks)}, ensure_ascii=False, indent=2))
        return 0

    if args.mode == "next":
        if not remaining:
            return 0
        print(format_task(remaining[0], 0))
        return 0

    if args.mode == "count":
        print(len(remaining))
        return 0

    for index, task in enumerate(visible_remaining):
        print(format_task(task, index))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
