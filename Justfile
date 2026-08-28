set shell := ["bash", "-cu"]

build:
    cd apps/desktop && npm run build

verify:
    cd apps/desktop && npm test
    cd apps/desktop && npm run build
    [[ -x .venv/bin/python ]] || (printf '%s\n' "error: missing .venv; run scripts/setup-macos.sh first" >&2; exit 69)
    .venv/bin/python -m unittest discover -s genost_worker/tests
    cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
    TAURI_CONFIG='{"bundle":{"externalBin":[]}}' cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml

test:
    [[ -x .venv/bin/python ]] || (printf '%s\n' "error: missing .venv; run scripts/setup-macos.sh first" >&2; exit 69)
    .venv/bin/python -m genost_worker.cli --prompt-file test_prompt.md --output-dir test-output --quantity 5

run:
    ./scripts/dev.sh

smtv path_flag="" path="":
    [[ {{ quote(path_flag) }} == "--path" && -n {{ quote(path) }} ]] || (printf '%s\n' "error: usage is just smtv --path <output-dir>" >&2; exit 64)
    [[ -x .venv/bin/python ]] || (printf '%s\n' "error: missing .venv; run scripts/setup-macos.sh first" >&2; exit 69)
    .venv/bin/python scripts/render_smtv_suite.py run --path {{ quote(path) }}
