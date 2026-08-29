#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-$ROOT_DIR/.venv/bin/python}"
TARGET_TRIPLE="${TARGET_TRIPLE:-aarch64-apple-darwin}"
OUTPUT_DIR="$ROOT_DIR/apps/desktop/src-tauri/binaries"
BUILD_DIR="$OUTPUT_DIR/.pyinstaller-build"
DIST_DIR="$OUTPUT_DIR/.pyinstaller-dist"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Missing GENOST Python environment: $PYTHON_BIN" >&2
  exit 1
fi

"$PYTHON_BIN" -m pip install 'pyinstaller>=6.10,<7'
mkdir -p "$OUTPUT_DIR"
"$PYTHON_BIN" -m PyInstaller \
  --noconfirm \
  --onefile \
  --name "genost-worker-$TARGET_TRIPLE" \
  --workpath "$BUILD_DIR" \
  --specpath "$OUTPUT_DIR" \
  --distpath "$DIST_DIR" \
  --paths "$ROOT_DIR" \
  --hidden-import genost_worker.api \
  --hidden-import genost_worker.audiocraft_generator \
  --add-data "$ROOT_DIR/genost_worker/text2midi_service.py:genost_worker" \
  --collect-data basic_pitch \
  --collect-all hf_xet \
  --collect-all mlx \
  --collect-all mlx_audiocraft \
  "$ROOT_DIR/genost_worker/server.py"
cp "$DIST_DIR/genost-worker-$TARGET_TRIPLE" "$OUTPUT_DIR/genost-worker-$TARGET_TRIPLE"
echo "Built worker sidecar: $OUTPUT_DIR/genost-worker-$TARGET_TRIPLE"
