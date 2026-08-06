# Script-E source analysis — WWDOAT, Filming Day 1

What each file in a Script-E filming-day folder contains, how the files overlap, and what
survives into `processedData`.

Detail below is from **Day 1** (128 takes, 21 slates, 4 scenes), which is the only day
delivered with a SilverStack CSV. Every finding was then re-checked against Days 2–4
(137 / 119 / 126 takes) and holds on all four — see the per-day `source-fidelity-report.md`,
which the `validate` command regenerates rather than relying on this document staying true.

## The twelve files

| File | Grain | Unique data? |
|---|---|---|
| `SIM Metabanq Day N.xml` | scenes + shoot day + `shot_properties` | **Yes — the superset. Primary source.** |
| `EDITOR LOG Day N.xml` | `ShotProperties` | No — subset of SIM's shot section |
| `SilverStack Log Day N.csv` | one row per take | No — column subset; independent witness |
| `EDITOR LOG.pdf` | takes | No — render of the same table |
| `Detailed Editor Log.pdf` | takes | No — render, clip/lens inline |
| `Editor Log By CameraRoll.pdf` | takes | No — render, sorted by camera roll |
| `Timecode Log.pdf` | takes | No — render, timecode-forward |
| `Facing and Lined Script.pdf` | takes per script page | No for text; **yes** for the lining marks |
| `Progress Report Day N.pdf` | day summary | **Yes — PDF only** |
| `Report to Editor Day N.pdf` | day notes | **Yes — PDF only** |
| `Coverage Day N.pdf` (79 MB, 6 pp) | script lines | **Yes — graphical only** |
| `SIM Metabanq Day N/` (directory) | — | Empty on Day 1 |

The four editor-log-family PDFs and the facing pages are the same 128 takes re-laid-out.
`pdftotext -layout` extracts them cleanly, but there is nothing in them the XML lacks.

## A note on scene terminology

Script-E calls two different things "scene" and the distinction matters for mapping:

- **Narrative scene** — the scene as written in the script (`3`, `5`, `13`). This is what
  `script/scene/scene_number` and a take's `related_scenes/scene` refer to.
- **Production scene** — the scene created by the breakdown and written on the slate
  (`3A`, `5A`…`5G`, `R13/15`). This is what `shot_properties/script_scene` holds, despite
  the tag name, and it is the same value the Editor Log calls `Slate`.

The extracted tables use `narrativeScene` and `productionScene` accordingly, keep `slate`
alongside `productionScene` under Script-E's own name, and add `slateFullName`
(`slate-take`, e.g. `3A-1`). A take can cover more than one narrative scene — slate
`R13/15` covers `13; 15` — so `narrativeScene` is a `;`-joined list.

`R13/15` is a rehearsal: its shot description reads *"Rehearslal of 13 and 15 to see shots
-- do not print"*. It is the only `R` slate in four days and nothing in the schema declares
the convention, so the slate is kept verbatim and no rehearsal flag is asserted — the fact
stays where the source put it, in the description.

**Wild tracks are not scenes.** Script-E slates sound-only recordings in a 1000-block that
runs unbroken across the whole production — 1001–1011 over the four days, matching the list
in the Report to Editor — so the number is a wild-track identifier, not a production scene.
The extractor moves it to `wildTrackNumber` and leaves `slate` and `productionScene` empty,
so nothing maps into OMC as a scene that does not exist. The scene each wild track belongs
to is carried by `related_scenes` exactly as for a camera take:

| wild track | 1001 | 1002 | 1003 | 1004 | 1005 | 1006 | 1007 | 1008 | 1009 | 1010 | 1011 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| day | 1 | 1 | 1 | 2 | 2 | 2 | 2 | 3 | 4 | 4 | 4 |
| narrativeScene | 3 | 3 | 13; 15 | 6 | 8 | 11 | 11 | 12 | 2 | 14; 16 | 5 |

Their *descriptions* ("room tone JULIA's apartment") are another matter: `shot_description`
is empty for every wild track in the XML, and the text exists only in the Report to Editor
PDF.

## Structure of the two XMLs

`ScriptESIMMetabanq` (SIM):

```
UUID, created, source_type, production_name
script/scene[]            scene number, heading, act, page, scripted eighths,
                          ERT/ART, script day/date/time/day-of-week, shoot day
                          started/credited, slug, owed inserts, characters_in_scene[]
shoot_days/shoot_day[]    day number, unit, shoot date, crew call, second call,
                          first shot, lunch out/in + duration, after-lunch first shot,
                          dinner block, camera/sound/script wrap, overtime
shots/shot_properties[]   the take table (see below)
```

`ScriptEMetaData` (Editor Log) is `UUID, Created, ShotProperties[]` and nothing else — no
scene section, no shoot-day section.

**Every Editor Log field maps 1:1 onto a SIM field** (`Slate`→`script_scene`,
`StripBoardDay`→`script_shootDay`, `OriginalRoll`→`script_camera_roll`, …). SIM adds
`script_unit`, `script_tail_slate`, `related_scenes/episode` and `characters_in_scenes` —
a per-take character list the Editor Log does not carry at all. The full correspondence,
including the SilverStack columns, is `src/sources/scriptE/fieldMap.js`; that file is the
authority, this document is the narrative.

Both XMLs share the same export `UUID` and `Created` timestamp, so they are two
serializations of one export event rather than independent snapshots.

## Verified overlap (Day 1)

All 128 takes join across SIM, Editor Log XML and SilverStack CSV on
`slate | camera | take number`, with no take present in only one source. Slates agree
exactly: `3A, 5, 5A–5G, 13, 13A–13C, 15, 15A–15C, R13/15, 1001, 1002, 1003`.

35 fields were compared SIM↔Editor Log and 19 SIM↔SilverStack. After normalizing the
declared format differences, the only differences left are the ones below — all of them
findings about the exports, not extraction bugs.

### 1. `script_distance` carries no distance

SIM copies `script_lens_height` verbatim into `script_distance` for every take; the Editor
Log writes the placeholder `na` for the 90 takes where a lens height exists and leaves it
empty for the other 38. **Neither source records subject distance. Do not map this field.**

### 2. Script-E writes the literal string `(null)`

Rather than emitting an empty element, both XMLs write `(null)` as text: 26 × `selectType`,
and 5 × each of `cameraRoll`, `tStop`, `shutterAngle`, `recordingFPS`, `iso`,
`colorTemperature` (the five wild-track rows, which have no camera). The extractor treats
`(null)` as absent and counts it in the fidelity report. Anything reading these XMLs
directly must do the same or it will write the word "(null)" into an OMC entity.

### 3. The Editor Log XML mangles take labels — and is therefore not lossless

Take labels are not integers. Script-E writes decimals for takes resumed within the same
slate and setup, and appends notes:

| SIM `script_take` | Editor Log `Take` | Day |
|---|---|---|
| `6 PU` | `6` | 1 (slate 13C) |
| `6.1 PU`, `6.2 PU` | `6`, `6` | 2 (slate 8C) |
| `4.1`, `4.2` | `4`, `4` | 4 (slate 2K) |

Dropping the annotation loses information; dropping the decimal loses **identity** — on
Days 2 and 4 the Editor Log contains two rows that are indistinguishable from each other.
This is the one respect in which the Editor Log XML is not merely a subset of SIM, and it
is the reason the fidelity check reports three unmatched takes on those days.

The extractor keeps the raw label verbatim in `take` and emits the annotation separately as
`takeAnnotation`. It deliberately does **not** emit a parsed take number: labels are not
reliably numeric, and a number column invites being trusted as an identifier. The
cross-source join computes one on demand and falls back to the raw label.

### 4. The SilverStack CSV is malformed

SilverStack does not escape a `"` occurring inside a quoted field, so a take whose notes
contain a double quote shifts its remaining columns. Eleven rows are affected on Day 1,
which is what produces the `comment` / `startDateTime` / `endDateTime` differences —
the SIM values are the correct ones. Slate `5B` also carries a shorter, staler
`Description` than SIM. **The CSV is a cross-check, never a source of record.**

It is also not always delivered: Days 2, 3 and 4 have no SilverStack CSV at all.

### 5. `Circled` has no asserted counterpart

SilverStack's `Circled` flag has no Script-E field: `script_circle_status` is `Active` for
all 128 takes. Observed against `selectType`: `Circled=TRUE` covers FAV × 44, OK × 28,
BSF × 10 and 12 blanks; `Circled=FALSE` covers OK × 13, BSF × 4, NG × 3 and 14 blanks. So
it correlates with the select type without being derivable from it. The report
cross-tabulates it each run rather than assuming a mapping.

### 6. Scene 3 lists JULIA twice

`characters_in_scene` for scene 3 contains `JULIA (#3)` twice. Reported, not deduplicated —
`sceneCharacters` has 11 rows where 10 distinct pairs exist.

### 7. Two fields are leaked object pointers

`scene_script_revision` and `production_unit` serialize as `<ScriptRevision: 0x600006b07900>`
and `<Unit: 0x60000aeaec30>` — Objective-C object descriptions, not values. The pointer
changes between exports, so they are not even stable identifiers. They are kept in the
tables verbatim (that is what the source says) and flagged. **Do not map them.** Script
revision and unit are therefore unavailable from this export.

### 8. `scene_shoot_day_credited` is two different fields

The tag appears twice per scene: first the shoot day (`Day 1`), then the eighths credited
(`1 2/8`). Split into `shootDayCredited` and `eighthsCredited`.

## What only the PDFs have

Not extracted yet. Recorded here so a later pass has a spec.

**`Progress Report Day N.pdf`** — call/first-shot/meal/wrap times (also in SIM), and, only
here: pages, scenes, setups and ERT/ART counted today vs scripted vs remaining with `+/-`;
projected running time and the ratio behind it; the scenes-fully-credited table; the
partials list; the setups list (`1-3A` … `18-15C`); camera rolls (`A1-A2`) and sound roll;
wild-track summary; weather; and free-text production notes. On Day 1 the notes explain
that slate `3A` follows a shot-list naming convention the rest of the day abandons, and
that clock times are EST while timecode is the authoritative time-of-day reference — a
caveat that matters for anything mapping `startDateTime`.

**`Report to Editor Day N.pdf`** — per-scene editorial notes (e.g. "Slate 2F skipped";
scene 16 overlap guidance), added scenes, cut scenes, scenes owed, and the wild-track
descriptions. Note the wild-track lists differ in extent: this report names **1001–1011**
while Day 1's XML carries only **1001–1003**, so the PDF is describing the production, not
just the day.

**`Coverage Day N.pdf`** and the lining on **`Facing and Lined Script Day N.pdf`** — which
script lines each slate covers. Drawn as vertical rules over a rendered script; the text
layer yields only the slate labels (`3A - 14`, `5-7`, …). Recovering coverage means either
a Script-E export that carries it or computer vision over the page images.

**Identity** — the script supervisor (Anthony Pettine, with contact details) appears in the
PDF footers and nowhere in the XML.

## The deliverables as assets

Every file in a filming-day folder is itself a production asset. `src/sources/scriptE/documents.js`
classifies each by content — the page-one heading for PDFs, the root element for XML, the
header row for the CSV, the opening marker for the Avid clip bin — never by filename, which
here is inconsistent. The result is the `assets` table, and from it three OMC entities per
file: `Asset`, `AssetStructure` (`digital.document` for the printed reports, `digital.data`
for the machine-readable exports), and `Provenance` (carrying the print date as `createdOn`).

Two content-classification facts worth recording:

- **`EDITOR LOG` and `Editor Log By CameraRoll` share the heading `DAILY EDITOR'S LOG`** and
  are textually identical apart from column widths — the sort order is a rendering
  difference, not a document type. Both become Assets of the same type, told apart by file
  name.
- **Days 2 and 3 carry a second Detailed Editor's Log** printed a day or two earlier
  (`printDate` 2026-01-25 / 2026-01-26 against 2026-01-27). Distinct assets generated on
  different days from different data; each keeps its own `Provenance.createdOn`.

The four empty `SIM Metabanq Day N/` directories are reported as a delivery gap, not given
asset rows.

## Conclusion

The presumption holds with two caveats. **SIM Metabanq is a complete, sufficient source for
the take, scene and shoot-day data** — the Editor Log XML, the SilverStack CSV and five of
the eight PDFs add nothing to it. But the day's *summary* (progress metrics, setups,
weather, notes), its *editorial narrative* (scene notes, wild-track descriptions, scenes
owed) and its *script coverage* exist only in PDF, and the last of those is not text at all.
