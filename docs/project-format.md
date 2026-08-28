# GENOST Portable Project Format

GENOST projects are local, portable song folders. The desktop validates every persisted file before use and keeps required song state inspectable on disk.

## Folder Layout

```text
ProjectsRoot/
|-- genost-workspace.json
`-- Song Title/
    |-- genost.json
    |-- commands.json
    |-- STEMS/
    |   `-- SEPARATIONS/
    |-- MIXES/
    |-- REFERENCES/
    |-- WAVEFORMS/
    |-- JOBS/
    `-- ARCHIVE/
```

`genost.json` is the project source of truth. `commands.json` is the append-only journal of meaningful project actions. `genost-workspace.json` stores only projects-root metadata such as shared genre references.

## Project State

The version-1 project object contains:

- identity: `id`, `title`, `createdAt`, and `updatedAt`;
- `song`: BPM, key, meter, swing, musical direction, sample rate, generation models, cache path, and backend;
- `blocks`: reusable generated or imported stem definitions;
- `arrangement.lanes`: layered clips that reference blocks, variations, dependencies, and stems;
- `stems`: render identities, status, paths, hashes, seeds, and exact render metadata;
- `separationBundles`: retained separator outputs and non-destructive merges;
- `mix`: master effects and the latest built mix path.

Runtime validation is defined in `apps/desktop/src/lib/schema/project.ts`.

## Blocks And Clips

A block records its role, bars, optional meter override, instruments, separator target, validation category, prompt fields, energy/density, avoid text, level/effect sends, and implemented stem references.

An arranger clip records:

```json
{
  "id": "clip_uuid",
  "blockId": "block_uuid",
  "variation": 1,
  "startBar": 0,
  "bars": 8,
  "inputBlockId": null,
  "inputStemId": null,
  "stemId": null
}
```

Variations are numbered 1 through 16. Dependency edits use `inputBlockId`; resolved renders pin the exact `inputStemId` used.

## Stem Records And Sidecars

Generated WAV files live under `STEMS/`. Each WAV has a same-name JSON sidecar that records the exact composed prompt, prompt hash, backend, model, seed, duration, sample rate, device, input stem/path, generation settings, validation category/metrics, generation time, and publication timestamp.

A project stem record carries one of these statuses:

```text
missing queued rendering ready stale failed canceled archived superseded detached
```

Rerendering creates a new stem identity. Prior audio is never overwritten. Stale stems remain playable, superseded stems remain traceable, and detached prior revisions move under `ARCHIVE/` with a `DETACHED_` prefix.

## Separation Bundles

A separation bundle points to its raw source stem and retains every `bass`, `drums`, `guitar`, `piano`, `vocals`, and `other` output. Output levels and selected IDs are project state. Merges record the exact selected output IDs and per-output levels; creating a merge never changes or deletes its sources.

Bundle audio lives under `STEMS/SEPARATIONS/<bundle-id>/`. Archived bundles and merges move under `ARCHIVE/`.

## Mixes

Final mix WAV files and sidecars live under `MIXES/`. The project `mix.lastBuildPath` points to the latest successful build. Mix sidecars retain duration, sample rate, peak/loudness/normalization details, skipped clips, and effect settings.

## Command Journal

Every meaningful project-facing action appends a command entry with:

- `actor`: `user`, `code-agent`, `worker`, or `system`;
- `source`: `web-ui`, `code-agent`, `worker`, or `system`;
- type, summary, payload, timestamp, and optional before/after project hashes.

The journal is append-only and must not contain secrets.

## Write And Portability Rules

- Validate JSON through the runtime schemas before use.
- Write `genost.json`, `commands.json`, workspace metadata, and sidecars atomically with a unique temp file plus rename.
- Store project-owned paths relative to the project folder where possible.
- Do not hide required project state in app-global storage or a database.
- Do not overwrite or automatically render audio as a side effect of editing.
- Skip missing stems during player builds and report every skipped clip.
