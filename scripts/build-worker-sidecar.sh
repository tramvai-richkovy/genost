#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-$ROOT_DIR/.venv/bin/python}"
TARGET_TRIPLE="${TARGET_TRIPLE:-aarch64-apple-darwin}"
OUTPUT_DIR="$ROOT_DIR/apps/desktop/src-tauri/binaries"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Missing GENOST Python environment: $PYTHON_BIN" >&2
  exit 1
fi

"$PYTHON_BIN" -m pip install 'pyinstaller>=6.10,<7'
mkdir -p "$OUTPUT_DIR"
"$PYTHON_BIN" -m PyInstaller \
  --clean \
  --noconfirm \
  --onefile \
  --name "genost-worker-$TARGET_TRIPLE" \
  --paths "$ROOT_DIR" \
  --hidden-import genost_worker.api \
  --hidden-import genost_worker.audiocraft_generator \
  --collect-all mlx_audiocraft \
  "$ROOT_DIR/genost_worker/server.py"
cp "$ROOT_DIR/dist/genost-worker-$TARGET_TRIPLE" "$OUTPUT_DIR/genost-worker-$TARGET_TRIPLE"
echo "Built worker sidecar: $OUTPUT_DIR/genost-worker-$TARGET_TRIPLE"
