#!/usr/bin/env bash
set -euo pipefail

LABEL="com.tomtong.ai-rag.codex-task-runner"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

if [[ -f "${PLIST}" ]]; then
  launchctl unload "${PLIST}" >/dev/null 2>&1 || true
  rm -f "${PLIST}"
  echo "Uninstalled ${LABEL}"
else
  echo "No launch agent found for ${LABEL}"
fi
