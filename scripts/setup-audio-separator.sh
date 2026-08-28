#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3.10}"
SEPARATOR_VENV_DIR="${SEPARATOR_VENV_DIR:-$ROOT_DIR/.venv-separator}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Missing $PYTHON_BIN. Install it with: brew install python@3.10" >&2
  exit 1
fi

"$PYTHON_BIN" -m venv "$SEPARATOR_VENV_DIR"
"$SEPARATOR_VENV_DIR/bin/python" -m pip install --upgrade pip setuptools wheel
"$SEPARATOR_VENV_DIR/bin/python" -m pip install -r "$ROOT_DIR/genost_worker/requirements-separator.txt"

echo "GENOST audio-separator environment is ready at $SEPARATOR_VENV_DIR"
echo "Run: $SEPARATOR_VENV_DIR/bin/audio-separator --env_info"
