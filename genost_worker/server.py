from __future__ import annotations

import argparse
import os
import threading
import time

import uvicorn


def exit_when_parent_changes(expected_parent_pid: int) -> None:
    while True:
        time.sleep(1)
        if os.getppid() != expected_parent_pid:
            os._exit(0)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the GENOST worker bound to a Tauri parent process.")
    parser.add_argument("--parent-pid", required=True, type=int)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()
    monitor = threading.Thread(target=exit_when_parent_changes, args=(args.parent_pid,), daemon=True)
    monitor.start()
    uvicorn.run("genost_worker.api:app", host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
