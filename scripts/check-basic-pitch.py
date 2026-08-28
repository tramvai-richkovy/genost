#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from genost_worker.midi import probe_basic_pitch_runtime


def main() -> int:
    available, detail = probe_basic_pitch_runtime()
    print(detail)
    return 0 if available else 1


if __name__ == "__main__":
    raise SystemExit(main())
