# GENOST Session Format

This is the provisional persistence contract for the sessions/artifacts product. Root `plan.md` must finalize and test it before it is treated as implemented.

```text
WorkingDirectory/
|-- genost-workspace.json
|-- workspace-commands.json
`-- se-YYMMDD-N/
    |-- session.json
    |-- commands.json
    |-- artifacts/
    |-- archive-1/
    |-- archive-2/
    `-- jobs/
```

`genost-workspace.json` stores workspace-wide tags, selected/collapsed UI state, and local model settings. Each `session.json` stores identity, type, BPM, tags, export folder, prompt revisions, artifacts, and lineage. Each `commands.json` is append-only.

Every produced artifact has a stable ID, display name, kind, media type, relative file path, status, prompt revision, parent/source relationships, export state, conversion/generation metadata, timestamps, and a sidecar beside the produced file.

Prompt revisions own immutable artifact folders. Archiving never renames a prior folder. Manual external references are copied into the session before use. Generated, converted, separated, or merged files are never overwritten by retries.
