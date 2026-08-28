#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3.10}"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Missing $PYTHON_BIN. Install it with: brew install python@3.10" >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "Missing ffmpeg. Install it with: brew install ffmpeg" >&2
  exit 1
fi

"$PYTHON_BIN" -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r "$ROOT_DIR/genost_worker/requirements.txt"

echo "GENOST backend environment is ready at $VENV_DIR"
echo "Run: source $VENV_DIR/bin/activate && python scripts/check-audio-backend.py"
echo "Optional CPU diagnostics: python -m pip install -r genost_worker/requirements-audiocraft-diagnostic.txt"
