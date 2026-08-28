# GENOST Workspace, Session, And Artifact Format

GENOST state is local and portable. The selected working directory contains workspace metadata, a workspace command journal, and one folder per session.

## Folder Layout

```text
WorkingDirectory/
|-- genost-workspace.json
|-- workspace-commands.json
|-- se-260828-1/
|   |-- session.json
|   |-- commands.json
|   |-- artifacts/
|   |   |-- artifact1.wav
|   |   `-- artifact1.json
|   |-- archive-1/
|   `-- archives/
`-- se-260828-2/
    |-- session.json
    |-- commands.json
    `-- artifacts/
```

Do not store required session state in an app-global database. File paths inside `session.json` are stable relative paths unless a user-selected external reference path must remain absolute.

## Workspace Metadata

`genost-workspace.json` stores cross-session metadata:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-08-28T00:00:00.000Z",
  "knownTags": ["jungle", "techno"],
  "lastSelectedSessionId": "session_uuid",
  "sidebarCollapsed": false,
  "modelSettings": {
    "cachePath": "/Volumes/Models/HuggingFace",
    "hfHome": null,
    "backend": "auto"
  }
}
```

`workspace-commands.json` records workspace-level actions such as `select_workspace`.

## Session JSON

Each session folder contains `session.json`:

```json
{
  "schemaVersion": 1,
  "id": "session_uuid",
  "name": "se-260828-1",
  "title": "se-260828-1",
  "type": "free_format",
  "bpm": 120,
  "bpmPreset": "custom",
  "createdAt": "2026-08-28T00:00:00.000Z",
  "updatedAt": "2026-08-28T00:00:00.000Z",
  "artifactCount": 1,
  "tags": ["jungle"],
  "exportFolder": "/Users/me/Desktop/exports",
  "promptHistory": {
    "activeRevisionId": "prompt_uuid",
    "revisions": [
      {
        "id": "prompt_uuid",
        "label": "current",
        "prompt": "170 BPM, D minor, atmospheric pad",
        "artifactFolder": "artifacts",
        "locked": true,
        "createdAt": "2026-08-28T00:00:00.000Z",
        "updatedAt": "2026-08-28T00:00:00.000Z",
        "archivedAt": null
      }
    ]
  },
  "lineage": {
    "sourceSessionId": null,
    "sourceArtifactId": null,
    "sourcePromptRevisionId": null,
    "action": null
  },
  "artifacts": []
}
```

Default session names use `se-{yymmdd}-{N}`, choosing the first free integer for the current day. `name` and `title` start as the same value; users may edit `title`.

Supported session types are `stem_constructor`, `free_format`, and `midi_generator`.

## Artifacts

Artifacts represent audio clips, separated audio stems, MIDI clips, guide-audio WAV files, premix audio, and conversion outputs.

```json
{
  "id": "artifact_uuid",
  "name": "artifact1",
  "kind": "audio_clip",
  "mediaType": "audio/wav",
  "fileName": "artifact1.wav",
  "filePath": "artifacts/artifact1.wav",
  "parentArtifactId": null,
  "sourceSessionId": "session_uuid",
  "promptRevisionId": "prompt_uuid",
  "modelBackend": {
    "backend": "mlx",
    "device": "metal",
    "model": "facebook/musicgen-medium",
    "generationSeconds": 22.4,
    "validationMetrics": {},
    "cachePath": "/Volumes/Models/HuggingFace"
  },
  "conversion": null,
  "status": "ready",
  "error": null,
  "volumeDb": 0,
  "createdAt": "2026-08-28T00:00:00.000Z",
  "updatedAt": "2026-08-28T00:00:00.000Z",
  "exportStatus": {
    "exportedAt": null,
    "exportPath": null,
    "error": null
  }
}
```

Default names are `artifact1`, `artifact2`, and so on. Users may rename display names without renaming existing files.

## Prompt Archives

After a generation run, the active prompt revision is locked. Pressing `+`/archive locks the current revision under an `archive-N` label and creates a fresh editable prompt revision with the previous prompt text retained.

Existing artifact folders are not renamed during archive. New prompt revisions allocate suffix folders such as `archive-1`, `archive-2`, etc., so old relative paths stay valid.

## Command Journals

Each session has append-only `commands.json`. Supported command types include:

- `create_session`
- `open_session`
- `change_session_title`
- `change_bpm`
- `change_tags`
- `change_export_folder`
- `archive_prompt`
- `generation_request`
- `artifact_rename`
- `artifact_export`
- `artifact_reveal`
- `artifact_conversion`
- `artifact_separation`
- `artifact_merge`
- `derived_session_create`

Command entries include `actor`, `source`, `summary`, payload details, and before/after state hashes where session state is involved.

## Worker Contracts

Text-only audio generation uses `facebook/musicgen-medium`. Reference/melody-conditioned generation uses `facebook/musicgen-melody`.

The desktop blocks session creation, opening, and generation until worker preflight confirms both models are already present in the local cache. Missing models are reported with download hints; the app does not silently download weights.
