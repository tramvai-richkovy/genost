set shell := ["bash", "-cu"]

build:
    cd apps/desktop && npm run build

run:
    ./scripts/dev.sh

smtv path_flag="" path="":
    [[ {{ quote(path_flag) }} == "--path" && -n {{ quote(path) }} ]] || (printf '%s\n' "error: usage is just smtv --path <output-dir>" >&2; exit 64)
    [[ -x .venv/bin/python ]] || (printf '%s\n' "error: missing .venv; run scripts/setup-macos.sh first" >&2; exit 69)
    .venv/bin/python scripts/render_smtv_suite.py run --path {{ quote(path) }}
