# Data-Pipeline

> **Archived 2026-10-06.** These pipelines now live in Labkoat-API, under `pipelines/`, and are
> developed and deployed there. This repository is read-only; its tags stay fetchable, and v1.1.0
> is the code that was moved.

Tools that read heterogeneous production data sources — PDFs, XML, spreadsheets — and
prepare them for ingestion into OMC-JSON workflows.

## Layers

The package is three layers, so each can be taken on its own. An API that already has
tabular data needs only the OMC layer; a tool ingesting a specific supplier's delivery adds
that source's adapter; a tool doing its own I/O can use `lib` alone.

```
src/pipelines/          the uniform way in. A registry of self-describing pipelines, and the
                        context through which they read. Knows no sources and no formats.
src/sources/<source>/   one adapter per supplier. Reads a delivery, emits tables in OMC
                        terminology, and declares its mapping as data. No OMC construction.
src/omc/                generic. Turns tables + declarative mappings into validated OMC
                        entities. Knows no sources.
src/lib/                xml, csv, pdf, tabular, paths. Knows neither.
```

The interim tabular format is the spine, not a side-output: a source produces it, and the
OMC layer consumes it. It is an artifact in its own right — human-readable, reviewable,
diffable — and it already uses OMC terminology, so a second source maps into the same
shape rather than into a Script-E-shaped one.

**A new source needs a parser that emits tables and a mapping that is data. It needs no OMC
code.** See `src/sources/scriptE/omcMapping.js` for what a mapping looks like.

```
<production>/sourceData/<source>/Filming Day <n>/     inputs, as delivered
<production>/processedData/<source>/Day <n>/          the interim tables
<production>/omc/                                     the OMC-JSON bundle
```

Paths are derived from `--production`, `--source` and `--day`, so a new filming day needs
no code change and a new source is a new folder under `src/sources/`.

## Running a pipeline

A pipeline describes itself well enough to be selected, fed and run by a caller that knows
nothing about it. `catalog()` says what exists and what each one takes; `runPipeline()` runs
one. Nothing is written to disk: the result is the OMC, the notes and a report.

```js
import { catalog, runPipeline, createContext } from 'data-pipeline';

catalog();   // [{ pipelineId: 'script-e', label, inputs: { roles: [...] }, options: [...] }]

const result = await runPipeline({
    pipelineId: 'script-e',
    inputs: [
        { role: 'sim',      fileName: 'SIM Metabanq Day 1.xml', ref: 's3://…/sim.xml' },
        { role: 'delivery', fileName: 'Coverage Day 1.pdf',     ref: 's3://…/coverage.pdf' },
    ],
    omcOptions: { identifierScope: 'movielabs.com' },
}, createContext({ read: (input) => fetchBytes(input.ref) }));

result.omc;      // [ { entityType: 'ProductionScene', … }, … ]
result.notes;    // [ { kind, where, detail } ] — what it declined to assert, and why
result.report;   // { counts, validation, edgeCheck, schemaVersion, markdown }
```

**A pipeline never opens a file.** It asks its `PipelineContext` for bytes, and the caller
decides where those come from. That is what lets the same pipeline run from the CLI, from the
test harness against committed fixtures, and from a service reading object storage, with no
branch anywhere inside it. `fsContext({ baseDir })` is the filesystem implementation; a
`baseDir` is also a boundary, and an input resolving outside it is refused.

Every run is checked against the pipeline's own declarations first, so a missing required file
or an unknown role is reported before any bytes are read.

### Writing a new pipeline

1. Add `src/sources/<source>/` with a parser that emits a `TableSet` and an `omcMapping.js`
   declaring how those tables become entities. Both are data; neither builds OMC.
2. Add `pipeline.js` declaring a `PipelineDefinition` — id, label, the roles it accepts, the
   options it takes — with a `run(request, context)` that reads through the context.
3. Register it in `src/pipelines/registry.js`.

It then appears in `catalog()`, in the CLI, and in any UI driven by the catalogue, with no
change to any of them.

## Library use

The generic OMC layer can be used directly by a caller that already has tabular data.

```js
import { buildEntities, writeBundle } from 'data-pipeline';
import { scriptEMappings } from 'data-pipeline/sources';

const result = buildEntities({
    tables,                       // { takes: [...], narrativeScenes: [...] }
    mappings: scriptEMappings,
    options: { identifierScope: 'movielabs.com', seedNamespace: 'WWDOAT' },
});
await writeBundle({ entitiesByType: result.entitiesByType, outDir });
```

`sealBundle({ entitiesByType })` is `writeBundle` without the writing: it returns the
validation, the edge check and the per-type counts, so a service can seal a bundle it never
intends to store.

Subpath exports: `data-pipeline/pipelines`, `data-pipeline/omc`, `data-pipeline/sources`,
`data-pipeline/lib`.

Every public method takes an `options` object rather than reading module state, so one
process can build entities for several projects at once:

| Option | Purpose | Default |
|---|---|---|
| `identifierScope` | The scope stamped on generated identifiers | `movielabs.com` |
| `schemaVersion` | OMC-JSON schema version to build against | v3.0 |
| `seedNamespace` | Keeps two projects' identifiers distinct | the production name |

The CLI exposes the first two as `--identifier-scope` and `--schema-version`.

## Documentation

JSDoc throughout, following the omcUtil conventions: types live in `src/types.js` and are
resolved globally, so no `@typedef {import(...)}` — that is TypeScript-only syntax and
breaks standard JSDoc.

```bash
npm run jsdoc         # docs/jsdoc
npm run build:types   # types/*.d.ts for IDE resolution
```

## Usage

```bash
npm install

node src/cli.js extract  --production WWDOAT --source Script-E --day 1
node src/cli.js validate --production WWDOAT --source Script-E --day 1
node src/cli.js all      --day 1,2,3,4
node src/cli.js omc      --day 1,2,3,4

node src/cli.js pipelines
node src/cli.js run --pipeline script-e --dir "WWDOAT/sourceData/Script-E/Filming Day 1"
```

`--production WWDOAT --source Script-E --day 1` are the defaults.

- **extract** — parse the day's authoritative export into `day<n>.model.json`, one CSV per
  table, and a `day<n>.xlsx` workbook with a sheet per table.
- **validate** — cross-check the day's exports against each other and write
  `source-fidelity-report.md` (human) and `fidelity.json` (machine).
- **omc** — map the given days onto an OMC-JSON bundle in `<production>/omc`. Unlike the
  other commands this spans days, because its entities do.
- **pipelines** — list the pipelines, with the roles and options each one takes.
- **run** — run a pipeline over a directory, assigning roles from the pipeline's own `match`
  patterns exactly as a UI would, and print the OMC (or write it with `--out`). This is the
  same code path a service takes, so it is a rehearsal rather than a second implementation.

## Reference host

`server.js` serves the same JSON over HTTP, with no dependencies beyond Node, so the contract
can be exercised without a backend:

```bash
node server.js --root "WWDOAT/sourceData/Script-E/Filming Day 1" --port 4100

curl localhost:4100/api/pipeline/v1/catalog
curl -X POST localhost:4100/api/pipeline/v1/run -H 'Content-Type: application/json' \
  -d '{"pipelineId":"script-e","inputs":[{"role":"sim","fileName":"…SIM Metabanq Day 1.xml","ref":"…SIM Metabanq Day 1.xml"}]}'
```

Success is `{ data, errors, warnings }`; failure is
`{ data: [], error: { status, title, details } }` with the HTTP status matching `error.status`.
A request that does not fit the pipeline it names is a 400 listing every problem at once.

It is a reference, not a deployment: refs resolve against a local directory and runs are
synchronous. A real host stores bytes elsewhere and runs pipelines off the request thread.

## Tests

```bash
npm test
```

Each pipeline has a harness under `test/<pipelineId>/` that runs it over the committed
fixtures in `WWDOAT/sourceData/` and compares the result against the committed bundle in
`WWDOAT/omc/`. Identifiers are deterministic hashes of the source data, so the same delivery
always produces the same entities and the comparison is exact rather than approximate.

Two properties are excluded from that comparison, and both are facts about the run rather than
about the delivery: where a file lives (a repository path here, a storage URL in a service),
and the fallback shoot day on a run spanning several filming days. The second has its own test
rather than being merely excluded.

## Sources

### Script-E

Script-supervisor exports, delivered per filming day as ten PDFs, two XMLs and a CSV.
The **SIM Metabanq XML** is the source of record; the Editor Log XML and SilverStack CSV
are used only as independent witnesses in the fidelity check.

Tables produced: `shootDay`, `narrativeScenes`, `narrativeSceneCharacters`, `takes`,
`takeCharacters`, `assets`.

The `assets` table describes the delivered files themselves — each PDF, XML, CSV and clip
bin. Its document type comes from the file's **content**, not its name: every Script-E PDF
prints its report name as a page-one heading, and the other formats open with an
unambiguous structural marker (`src/sources/scriptE/documentTypes.js`). Filenames here are
inconsistent (`detailed editor_s log D3 WWD of ALL TIME.pdf`), so they are not used for
typing. A file matching no signature is still listed, typed `unknown`, and reported.

Column names lean toward OMC terminology rather than Script-E's:

| Column | Meaning |
|---|---|
| `narrativeScene` | The scene as written in the script — `3`. A take can cover several (`13; 15`). |
| `productionScene` | The scene from the breakdown that the take is slated against — `3A`, `3B`. Same value as `slate`, which is retained under Script-E's own name. |
| `slateFullName` | Slate and take as written on the slate — `3A-1`, `8C-6.1 PU`, `1001-1`. |
| `wildTrackNumber` | Script-E's 1000-block wild-track id (`1001`), which runs unbroken across the whole production and is *not* a scene. `slate` and `productionScene` are empty for these rows; `narrativeScene` still carries the scene the track belongs to. |
| `shootDay` | The day number alone (`1`), not Script-E's `Day 1`. Applied to `shootDayStarted` and `shootDayCredited` too. |
| `recordingFPS` | Script-E's `script_frame_rate` / `FrameRate` / `FPS`, named as OMC v3.0 names it. |
| `takeAnnotation` | The non-numeric part of a take label — `PU` in `6 PU`. The raw label stays in `take`; no parsed take number is emitted, because take labels are not reliably numeric. |

`src/sources/scriptE/fieldMap.js` is the single declarative correspondence between the
three machine-readable exports — every take-level field appears there once, with the tag or
column each source uses and any normalizer needed to compare them. Adding a field to both
the extractor and the fidelity check is one edit in that file.

See [`docs/scriptE-source-analysis.md`](docs/scriptE-source-analysis.md) for what each
delivered file contains, how far they overlap, and the source data-quality issues found
(literal `(null)` values, a `distance` field that is a copy of lens height, a malformed
SilverStack CSV, and the day summary / editorial notes / script coverage that exist only in
PDF).

## OMC mapping

`node src/cli.js omc` generates **OMC-JSON v3.0** into `<production>/omc/`:

| File | Entities | Grain |
|---|---|---|
| `narrativeScene.json` | 16 | one per scene as scripted (`3`) |
| `productionScene.json` | 83 | one per breakdown scene (`3A`) |
| `slate.json` | 510 | one per take (`3A-1`), incl. 13 wild tracks |
| `asset.json` | 46 | one per delivered file |
| `assetStructure.json` | 46 | the file's storage form (`digital.document` / `digital.data`) |
| `provenance.json` | 46 | when and by what the file was generated |
| `omc-generation-report.md` | — | what mapped, what did not, validation result |

An Asset carries its `AssetStructure` intrinsically (schema maxItems 1) and its `Provenance`
via `edges.has.Provenance`. `Provenance.createdOn` is the date the report was printed, read
from its header — which is what tells apart the two Detailed Editor's Logs some days carry.

`src/omc/` is a thin, source-agnostic layer — entity construction, references, bundle
validation and writing. Every OMC fact comes from `omc-util`: `omcTemplate` for shapes,
edges and id prefixes, `omcIdentifier` for identifiers, `omcEdges` for edges, `omcValidate`
for validation. Per the repo-wide rule this project maintains no tables of OMC entity types,
edge keys or cardinality of its own.

### Schema versions

Nothing in this package restates the OMC schema. Shapes, edge paths, inverses, identifier
prefixes and validation are all asked of `omc-util` per call, for whichever `schemaVersion`
the caller passes — so building against a different version is an option, not a code change:

```bash
node src/cli.js omc --schema-version https://movielabs.com/omc/json/schema/v2.8
```

For v2.8 and v3.0 omcUtil derives the shape from the bundled JSON Schema at build time
(`schemaDerive.js`), so the shape cannot drift from the schema it validates against.

**The mappings are the only place this package names OMC properties**, so they are the only
thing a schema change can invalidate. `checkMappings()` runs before any data is read and
names every property and edge the target version does not accept:

```
$ node src/cli.js omc --schema-version .../v2.8
Mappings do not fit https://movielabs.com/omc/json/schema/v2.8:
  unknownProperty: ProductionScene.label — no such property in v2.8
  unknownProperty: ProductionScene.productionSceneName.fullName — no such property in v2.8
  edgeNotAllowed: ProductionScene → Slate — v2.8 allows no edge from ProductionScene to Slate
```

(v2.8 really does use `name`/`sceneName` and has no ProductionScene→Slate edge.) Without
that check the same problems surface later and less clearly: a renamed property as a thrown
error partway through a run, a removed edge as a silently missing relationship, because
`edgeCreate` returns null for an edge the schema does not allow.

Two further consequences worth knowing:

- **Identifiers are deterministic.** `omcIdentifier.idHash` seeds them from the production
  name plus the entity's natural key, so re-running produces byte-identical files instead of
  duplicating the graph. Edges to entities a later pass will generate (`NarrativeScene`) use
  the same seeding, so they resolve as soon as that pass runs.
- **The v3.0 schema sets `unevaluatedProperties: false`.** No source field can ride along as
  a custom property. `customData[]` is the schema's own catch-all — *"used where the formal
  schema lacks required properties"* — and carries Script-E's key/value pairs as an object
  under domain `Script-E`, keyed by the spreadsheet's own column names, so nothing the
  script supervisor recorded is lost. Comments and notes go to `annotation[]`.
  `src/omc/entity.js` rejects an out-of-shape property at construction time so a mapping
  mistake names itself instead of surfacing as a schema error later.
