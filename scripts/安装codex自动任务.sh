#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.tomtong.ai-rag.codex-task-runner"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
INTERVAL_SECONDS="${1:-1800}"

mkdir -p "${HOME}/Library/LaunchAgents"

cat >"${PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${ROOT_DIR}/scripts/codex_task_runner.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>
  <key>StartInterval</key>
  <integer>${INTERVAL_SECONDS}</integer>
  <key>StandardOutPath</key>
  <string>${ROOT_DIR}/.codex/task-queue/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${ROOT_DIR}/.codex/task-queue/launchd.err.log</string>
</dict>
</plist>
EOF

launchctl unload "${PLIST}" >/dev/null 2>&1 || true
launchctl load "${PLIST}"

echo "Installed ${LABEL} with StartInterval=${INTERVAL_SECONDS}s"
echo "Queue: ${ROOT_DIR}/.codex/task-queue"
