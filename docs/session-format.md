# GENOST Session Format

This is the implemented persistence contract for the sessions/artifacts product.

```text
WorkingDirectory/
|-- genost-workspace.json
|-- workspace-commands.json
`-- se-YYMMDD-N/
    |-- session.json
    |-- commands.json
    |-- artifacts/        # imported/session-owned references
    |-- archive-1/
    |-- archive-2/
    `-- jobs/
```

`genost-workspace.json` stores workspace-wide tags, selected/collapsed UI state, and local model settings. Each `session.json` stores identity, type, BPM, tags, export folder, prompt revisions, artifacts, and lineage. Each `commands.json` is append-only.

Every produced artifact has a stable ID, display name, kind, media type, relative file path, status, prompt revision, parent/source relationships, export state, conversion/generation metadata, timestamps, and a sidecar beside the produced file.

New sessions allocate `archive-1` to their first prompt revision, then use collision-safe `archive-N` folders. The active revision is displayed as `current`; archiving assigns its immutable folder label and creates the next editable folder without renaming anything. Legacy sessions whose first revision used `artifacts` remain readable and allocate a new non-colliding archive folder.

The general `artifacts/` folder owns manually imported references. Generated audio/MIDI, guide WAVs, conversions, separation outputs, and merges remain in the prompt revision that produced them. Every produced artifact has a JSON sidecar containing exact prompt/model/backend/device/seed/settings/timings where applicable plus source lineage. Retries publish new identities and files.
