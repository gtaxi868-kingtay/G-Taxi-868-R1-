#!/usr/bin/env bash
# Wrapper to run the local ChatDev copy against this monorepo
# Usage: tools/run_chatdev_for_repo.sh "Describe the task" [--mode incremental|dev]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHATDEV_DIR="$REPO_ROOT/third_party/ChatDev"
TASK="${1:-"Run ChatDev against g-taxi: inspect and propose changes"}"
MODE="${2:-incremental}"

usage(){
  cat <<EOF
Usage: $0 "task description" [--mode incremental|dev]

Examples:
  $0 "Finish rider WalletScreen NFC flow" --mode incremental
  $0 "Run dev server" --mode dev

This script runs the local ChatDev copy (third_party/ChatDev) against the
current repo. It does not modify files unless ChatDev is invoked in an
incremental mode that you approve.
EOF
}

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  usage
  exit 0
fi

if [ ! -d "$CHATDEV_DIR" ]; then
  echo "Error: ChatDev not found at $CHATDEV_DIR"
  echo "Clone ChatDev into third_party/ChatDev or change CHATDEV_DIR in this script."
  exit 1
fi

echo "Repository root: $REPO_ROOT"
echo "ChatDev dir: $CHATDEV_DIR"
echo "Task: $TASK"
echo "Mode: $MODE"

case "$MODE" in
  incremental)
    echo "Running ChatDev in incremental mode (will pass --path to the repo)"
    (cd "$CHATDEV_DIR" && python3 run.py --task "$TASK" --config "incremental" --path "$REPO_ROOT")
    ;;
  dev)
    echo "Starting ChatDev dev server (backend + frontend)"
    (cd "$CHATDEV_DIR" && make dev)
    ;;
  *)
    echo "Unknown mode: $MODE"
    usage
    exit 2
    ;;
esac

echo "Done."
