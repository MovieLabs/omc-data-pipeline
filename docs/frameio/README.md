# Frame.io — what the V4 API actually returns

Source analysis for the `frameio` pipeline, in the same spirit as `../scriptE-source-analysis.md`:
what the source offers, what is worth taking, and what is not there at all.

Gathered 2026-08-07 against the live API, from two projects — **WWDDOAT-Dailies** (account
`4d3ecf78…`, "FX-DMZ") and **ETC Europa 2024** (account `49c43e3d…`) — covering 924 files and 24
comments. Everything below was observed, not read off the documentation.

## The headline

A file record carries 13 fields. Adding **`include=metadata`** to the folder-children request
returns **43–48 more per file, in the same request** — no per-file call, nothing extra to
rate-limit. The technical metadata that Frame.io shows in its own UI (resolution, codecs, bit
rates, frame rate, audio layout, duration) is *only* available this way; it is not on the file
record, and the search endpoint reports it only as an explanation of why a result matched a query,
which is no use as a dump.

And on **99% of WWDOAT files**:

```
OMC Take ID   me-nexus:871f0abe-590d-57d9-89f1-2295e236a72b
```

An OMC identifier — scope and value — already stored in Frame.io. Whatever else this source
offers, that field is the join into existing project data, and it was put there deliberately.

## The files

| File | What it is |
|---|---|
| `data/frameio-field-inventory.csv` | **Start here.** One row per field: source, type, system-derived vs user-entered, how often populated, distinct value count, three real examples. 80 fields across both projects. |
| `data/frameio-wwdoat.csv` | 239 WWDOAT files × 62 columns — **the pipeline's own `files` rows**, written to disk instead of mapped. 18 structural (including the derived `SlateId`) plus every metadata field the sample carried. |
| `data/frameio-wwdoat-comments.csv` | The `comments` dataset: one row per comment, keyed on `fileId`. Only written when a run reads live comments. |
| `data/frameio-wwdoat.json` | The raw records behind that CSV, including the untouched `metadata` arrays. |
| `data/frameio-sample.json` | One file probed every way: plain, with every `include`, its `/metadata`, its `/comments`, and the (403) account field definitions. Shows the response envelopes. |

**`data/` is gitignored.** It is live production content — slate and scene descriptions, character
names, crew emails — and `frameio-sample.json` additionally contains signed media download URLs.
Regenerate it rather than committing it.

## Regenerating

Both scripts are read-only: they issue `GET` requests and nothing else.

```bash
export FRAMEIO_TOKEN=…          # an Adobe IMS access token; lasts about an hour
node docs/frameio/fetch-inventory.mjs    # -> data/frameio-field-inventory.csv
node docs/frameio/fetch-sample.mjs       # -> data/frameio-wwdoat.{csv,json}
```

`fetch-sample.mjs --from-json` rebuilds the CSV from the JSON dump a previous run wrote. No token,
no request, nothing live touched — use it whenever the column set changes rather than re-walking a
production project.

**`fetch-sample.mjs` calls the pipeline's own `buildRows` and `buildCommentRows`**, so the CSV is
what a run produces rather than a parallel implementation that agrees by coincidence. A template
authored against it names columns the pipeline actually emits, and a rule like `SlateId` exists in
exactly one place. Only the walk is local to the script, because it samples with hardcoded ids and a
request budget instead of reading a project's settings.

Easiest way to get a token: connect to Frame.io in the Portal's pipeline panel, then in the browser
console —

```js
JSON.parse(sessionStorage.getItem(
  Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:https://ims-na1.adobelogin.com'))
)).access_token
```

The account and project ids are constants at the top of each script; change them to sample
elsewhere. Request budgets are capped there too, deliberately — Frame.io rate-limits per user, as
low as 10 requests a minute on some endpoints.

## What is worth knowing before mapping anything

**Most of the metadata is not custom at all.** Of the 48 fields, **29 are `mutable: false`** —
Frame.io's own inspection of the media, published through the same name/value channel as custom
fields but defined by nobody: resolution, codecs, bit rates, frame rate, duration, `Transcript`,
`Comment Count`. Only 19 are user-entered, and that is what any per-account field limit applies to.

**The field set differs two ways, and neither is "per project" exactly.** The derived fields depend
on the *media* — `Color Space` appears on images, `Page Count` on PDFs — while the user-entered ones
depend on how the account is configured: WWDOAT defines 19, ETC Europa defines one (`Status`). So a
mapping must tolerate fields appearing and vanishing; it cannot assume a fixed schema.

**A field appears on a file only when it has a value.** `Rating` and `VFX Reqiured` were each seen on
exactly one file out of 924. What a run produces is therefore the *union* across the files it walked,
which is why `datasets[0].columns` declares the observed set while `guaranteedColumns` declares only
the structural one.

**`VFX Reqiured` is misspelled in Frame.io.** A mapping keyed on the field name has to match the
typo, and will silently stop matching if anyone corrects it.

**`mutable` separates the two kinds of metadata**, and it is the most useful flag in the payload:
`false` means Frame.io derived it from the media (resolution, codec, duration), `true` means a
person typed it (Slate, Scene, Take, Camera, Slugline, Characters). The second group is production
knowledge and describes the *take*, not the file.

**`adobe_id` and `adobe_version_id` are null on all 924 files.** Not a linking route.

**Comment records are mostly empty.** Of 17 fields only `id`, `file_id`, `text`, `timestamp`,
`created_at` and `updated_at` were reliably populated; `anchor`, `annotation`, `attachments`,
`page`, `links` and `text_review_annotation` were 0% — they carry drawn annotations and document
comments, which dailies do not use. **`timestamp` is a frame number**, not a time.

**`Comments` and `Comment Count` are unrelated, despite the names.** `Comments` is a *custom
metadata field* — `long_text`, `mutable: true`, typed by a person ("good one - nice improv DANTE"),
one value per file and never more. `Comment Count` is system-derived and counts Frame.io's real
**comment threads**, a separate resource the metadata does not carry. So a file reading `Comment
Count: 3` still shows one `Comments` cell, and the three comments are not in this CSV at all.

**Comments cost one request per file, and are a second dataset.** `Comment Count` arrives with the
metadata, so the walk asks only where it is non-zero — 81 of 239 files in the WWDOAT sample, 22 of
them with more than one. They become the `comments` dataset: **one row per comment**, keyed on
`fileId`, which is how a table says "many". A mapping keyed on `fileId` folds those rows back onto
the file's one Asset as several `annotation` entries, because `mergeEntity` unions arrays by value —
which is also why a re-run does not duplicate them. The listing asks for `include=owner,replies`:
the comment record names nobody at all, so without `owner` an annotation would arrive anonymous.

**`SlateId` is derived, not Frame.io's.** `Slate` and `Take` are held separately, which is right for
filtering in Frame.io's UI and useless as a join key — `Take` is `1` on 47 of 239 files. `buildRows`
concatenates them (`13A` + `1` → `13A-1`), null unless both are present, because `16B-` would collide
with every other take of that slate. It names one **take**, not one file: 237 rows carry it but only
228 distinct values, because a slate-take can have several files against it. Seed a Slate or Take
entity from it; do **not** key an Asset on it, or three files fold into one.

**Several fields have a single distinct value** across the whole sample — `Camera` (A), `Alpha
Channel`, `Audio Sample Rate`, `Visual Bit Depth`, `Complete`. Either genuinely uniform or not being
filled in; worth checking before treating any of them as meaningful.

## What is not available

- **`GET /v4/accounts/{id}/metadata/field_definitions` → 403**, "Please migrate your account to
  account level metadata". No matter: every value carries its own `field_definition_name` inline.
- **`media_links`** yields signed `download_url` / `inline_url` only — no technical data.
- **No frame rate, duration, dynamic range or visual bit depth property exists in OMC v3.0.**
  `assetStructureProperties` does define `codec`, `audioBitRate`, `audioSampleRate`,
  `audioSampleSize` and `dimensions`; everything else would have to go to `customData`.
- **No entity for a comment.** v3.0's `annotation` is `[{author, title, text}]`, which takes the
  text, the commenter and — as `title` — the frame it is pinned to. The comment's own id, timestamps
  and reply structure have nowhere to go and are not carried.

## Access notes

Every V4 path is **account-scoped** — there is no `/v4/projects/{id}`, only
`/v4/accounts/{account}/projects/{id}` — so a run needs an account id as well as a project id.

**Every response is enveloped in `data`, single resources included.** Reading a field off the body
of `GET …/projects/{id}` yields `undefined`; see `frameioResource` in `src/sources/frameio/client.js`.

A 401 saying *"Your Frame user is not linked to an Adobe ID"* is an account-linking problem, not a
token or entitlement one: Frame.io → Account Settings → Profile → Authentication → Connect, with the
Frame.io and Adobe email addresses matching exactly.
