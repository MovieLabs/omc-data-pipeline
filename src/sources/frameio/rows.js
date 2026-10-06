import path from 'node:path';

import { omcTemplate } from 'omc-util';

import '../../types.js'; // Type definitions, resolved globally by JSDoc

/**
 * Turning what Frame.io returned into the interim `files` table the OMC mapping reads.
 *
 * @namespace namespace:DataPipeline.frameio
 */

/**
 * How a file's media type classifies it as an OMC asset structure.
 *
 * This table is **source knowledge, not OMC knowledge**: it says how a MIME type maps onto the
 * taxonomy, which is a judgement about the data, not something the schema states. The values it
 * produces are checked against the schema's own controlled list below, so a value that stops being
 * legal fails loudly at load rather than at validation.
 *
 * Ordered: the first prefix that matches wins, so the specific entries precede `application/`.
 *
 * @type {Array<[string, string]>}
 */
const MEDIA_TYPE_STRUCTURE = [
    ['image/', 'digital.image'],
    ['video/', 'digital.movingImage'],
    ['audio/', 'digital.audio'],
    ['text/csv', 'digital.data'],
    ['text/', 'digital.document'],
    ['application/pdf', 'digital.document'],
    ['application/msword', 'digital.document'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml', 'digital.document'],
    ['application/rtf', 'digital.document'],
    ['application/json', 'digital.data'],
    ['application/xml', 'digital.data'],
    ['application/vnd.ms-excel', 'digital.data'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml', 'digital.data'],
    ['application/zip', 'digital.data'],
];

/**
 * What a file whose media type matches nothing above becomes.
 *
 * The generic parent rather than a guess: `assetStructureType` is required, so something must be
 * said, and saying "digital" is true of every file Frame.io holds. A run reports each one so the
 * table above can grow.
 */
const FALLBACK_STRUCTURE = 'digital';

/** The `customData.domain` under which Frame.io's own fields are carried. */
export const DOMAIN = 'Frame.io';

/**
 * The columns {@link buildRows} produces for every file, whatever the account is configured like.
 *
 * These come from the sparse file record and from the walk itself, so they are structural: present
 * on every file in Frame.io and independent of anyone's field definitions. Everything else in a row
 * is metadata, which is discovered — see {@link METADATA_COLUMNS}.
 *
 * Exported rather than restated on the pipeline definition so the declaration cannot drift from the
 * rows themselves.
 *
 * @type {Array<string>}
 */
export const COLUMNS = [
    'fileId', 'fileName', 'filePath', 'fileExtension', 'mediaType', 'fileSize',
    'assetStructureType', 'frameioAccountId', 'frameioProjectId', 'frameioProjectName',
    'frameioWorkspaceId', 'frameioParentId', 'frameioVersionStackId', 'frameioViewUrl',
    'frameioStatus', 'frameioCreatedAt', 'frameioUpdatedAt', 'SlateId',
];

/**
 * Metadata columns observed in the sample projects — **expected, not guaranteed**.
 *
 * Metadata arrives as name/value pairs, so the column set is discovered from the data rather than
 * fixed, and it varies two ways: the derived fields depend on the media (`Color Space` on images,
 * `Page Count` on PDFs, `Transcript` on video), and the rest are custom fields an account defines
 * for itself. A field also appears on a file only when it has a value — `Rating` was on one file in
 * 924 — so what a run actually produces is the union across the files it walked.
 *
 * The list exists so the canvas can offer real columns to author against before any run has
 * happened. `checkColumns` still runs against the real rows at execution time, which is what reports
 * honestly when a project turns out not to have one of these.
 *
 * Split by Frame.io's `mutable` flag, which is the most useful thing in the payload: false means
 * Frame.io derived it from the media, true means a person typed it. That is also the split the
 * default mapping uses to decide what describes the bytes and what describes the take.
 *
 * @type {Array<string>}
 */
export const DERIVED_COLUMNS = [
    'Alpha Channel', 'Audio Bit Depth', 'Audio Bit Rate', 'Audio Channels', 'Audio Codec',
    'Audio Sample Rate', 'Bit Rate', 'Color Space', 'Comment Count', 'Date Uploaded', 'Duration',
    'Dynamic Range', 'End Time', 'File Size', 'File Type', 'Format', 'Frame Rate', 'Name',
    'Page Count', 'Resolution - Height', 'Resolution - Width', 'Seen By', 'Source Filename',
    'Start Time', 'Transcript', 'Uploader', 'Video Bit Rate', 'Video Codec', 'Visual Bit Depth',
];

/** Metadata fields a person filled in. Note `VFX Reqiured` is misspelled in Frame.io itself. */
export const ENTERED_COLUMNS = [
    'Camera', 'Characters', 'Circle', 'Clip Number', 'Comments', 'Complete', 'Location',
    'OMC Take ID', 'Rating', 'Scene', 'Scene Description', 'Select Rating', 'Setup', 'Slate',
    'Slate Description', 'Slugline', 'Status', 'Take', 'VFX Reqiured',
];

/** Every metadata column observed, derived and user-entered together. */
export const METADATA_COLUMNS = [...DERIVED_COLUMNS, ...ENTERED_COLUMNS];

/**
 * The columns {@link buildCommentRows} produces — one row per comment, not per file.
 *
 * `fileId` is the join back to the `files` table, and is what a mapping keys on so that every
 * comment on a file folds into that file's one Asset.
 *
 * @type {Array<string>}
 */
export const COMMENT_COLUMNS = [
    'fileId', 'commentId', 'commentText', 'commentAuthor', 'commentAuthorEmail',
    'commentFrame', 'commentCreatedAt', 'commentUpdatedAt', 'commentReplyTo',
];

/** The metadata field carrying Frame.io's count of a file's comment threads. */
export const COMMENT_COUNT_COLUMN = 'Comment Count';

/**
 * Check the table against the schema before any data is read.
 *
 * The controlled values are asked of omc-util rather than restated here — the same rule that keeps
 * every other OMC fact in one place. A typo or a renamed value is then a startup failure naming the
 * offending entry, instead of an entity that fails validation at the end of a long walk.
 *
 * @param {string} schemaVersion - The version the run targets
 * @throws {Error} When the table names a value the schema does not allow
 */
export function checkStructureTypes(schemaVersion) {
    const shape = omcTemplate.shape({ entityType: 'AssetStructure', schemaVersion });
    const allowed = shape?.assetStructureType?.$controlledValues;
    // A schema version that publishes no controlled list is not something to invent a check for.
    if (!Array.isArray(allowed) || !allowed.length) return;

    const used = [...new Set([...MEDIA_TYPE_STRUCTURE.map(([, v]) => v), FALLBACK_STRUCTURE])];
    const bad = used.filter((v) => !allowed.includes(v));
    if (bad.length) {
        throw new Error(`Frame.io maps media types to assetStructureType "${bad.join('", "')}", `
            + `which ${omcTemplate.versionLabel(schemaVersion)} does not allow. Update `
            + 'MEDIA_TYPE_STRUCTURE in sources/frameio/rows.js.');
    }
}

/**
 * Classify one media type.
 *
 * @param {(string|null)} mediaType - As Frame.io reported it, e.g. `image/png`
 * @returns {{assetStructureType: string, matched: boolean}} The value, and whether the table knew it
 */
function structureFor(mediaType) {
    const value = (mediaType ?? '').toLowerCase();
    const hit = MEDIA_TYPE_STRUCTURE.find(([prefix]) => value.startsWith(prefix));
    return { assetStructureType: hit?.[1] ?? FALLBACK_STRUCTURE, matched: Boolean(hit) };
}

/**
 * Flatten one file's metadata array into plain columns.
 *
 * Frame.io returns metadata as `{ field_definition_name, field_type, mutable, value }`, and the
 * name is used **verbatim** as the column — spaces, hyphens and the `VFX Reqiured` typo included.
 * Tidying it would be an improvement nobody could use: a template names its columns as strings and
 * matches them exactly, so a renamed column silently maps nothing.
 *
 * A value that is itself a list of people or tags is joined, taking whichever naming field is
 * present. A cell holds one value; the alternative is a JSON blob no template can address.
 *
 * @param {Object} file - The file record, with `metadata` present only when the walk asked for it
 * @returns {Object.<string, *>} Column name to value
 */
function metadataColumns(file) {
    const columns = {};
    for (const entry of file.metadata ?? []) {
        const { field_definition_name: name, value } = entry;
        if (!name) continue;
        columns[name] = Array.isArray(value)
            ? value.map((v) => v?.display_name ?? v?.name ?? v?.email ?? v?.id ?? String(v)).join('; ')
            : value;
    }
    return columns;
}

/** Structural column names, for detecting a metadata field that would shadow one. */
const STRUCTURAL_NAMES = new Set(COLUMNS);

/**
 * Metadata columns, minus any that would shadow a structural one.
 *
 * @param {Object.<string, *>} metadata - The flattened metadata columns
 * @param {Map<string, number>} collisions - Counted in place, for reporting
 * @returns {Object.<string, *>} The safe subset
 */
function withoutStructuralNames(metadata, collisions) {
    const safe = {};
    for (const [name, value] of Object.entries(metadata)) {
        if (STRUCTURAL_NAMES.has(name)) {
            collisions.set(name, (collisions.get(name) ?? 0) + 1);
            continue;
        }
        safe[name] = value;
    }
    return safe;
}

/**
 * The slate and take a file belongs to, as one value.
 *
 * Frame.io holds them separately, which is right for filtering in its own UI and useless as a join
 * key — `Take` is `1` on a fifth of the files in a project. Concatenated they name one take, which
 * is the grain an edge to a Slate resolves at, so this is the column a mapping points such an edge
 * through.
 *
 * It names a **take, not a file**: several files can share one slate-take, and 237 rows of the
 * WWDOAT sample carry only 228 distinct values. Seed a Slate or Take from it; key an Asset on it and
 * those files fold into one.
 *
 * Null unless both parts are present — half of a key is not a key, and `13A-` would collide with
 * every other take of slate 13A.
 *
 * @param {Object.<string, *>} metadata - The flattened metadata columns
 * @returns {(string|null)} e.g. `13A-1`
 */
function slateId(metadata) {
    const slate = String(metadata.Slate ?? '').trim();
    const take = String(metadata.Take ?? '').trim();
    return slate && take ? `${slate}-${take}` : null;
}

/**
 * Build the `files` table from a walk.
 *
 * One row per file. `fileId` is Frame.io's own uuid and is what every identifier is seeded from:
 * it is stable across renames and re-uploads, so re-running the pipeline updates the same entities
 * rather than minting a second set — which is the whole reason a re-import is idempotent.
 *
 * @memberof namespace:DataPipeline.frameio
 * @function buildRows
 * @param {Object} params
 * @param {Array<{file: Object, folderPath: string, versionStackId: (string|null)}>} params.files -
 *   As {@link walkProject} returned them
 * @param {Object} params.project - The Frame.io project record
 * @param {string} params.accountId
 * @returns {{rows: DataPipeline.Table, notes: Array<DataPipeline.MappingNote>}} The table, and a
 *   note for every media type the classification table did not recognise
 */
export function buildRows({ files, project, accountId }) {
    const notes = [];
    const unclassified = new Map();
    const collisions = new Map();
    let withoutMetadata = 0;

    const rows = files.map(({ file, folderPath, versionStackId }) => {
        const { assetStructureType, matched } = structureFor(file.media_type);
        if (!matched) {
            unclassified.set(file.media_type ?? '(none)', (unclassified.get(file.media_type ?? '(none)') ?? 0) + 1);
        }
        const metadata = metadataColumns(file);
        if (!file.metadata) withoutMetadata += 1;

        // `path.extname` on a name, not a path: Frame.io names are not filesystem paths, but the
        // extension rule is the same and there is no reason to write a second one.
        const fileExtension = path.extname(file.name ?? '').toLowerCase() || null;

        return {
            fileId: file.id,
            fileName: file.name ?? null,
            // The folder path within the project, which is the only "where" Frame.io offers — there
            // is no filesystem here. Recorded as fileDetails.filePath so the tree survives import.
            filePath: `${folderPath}${file.name ?? ''}`,
            fileExtension,
            mediaType: file.media_type ?? null,
            fileSize: typeof file.file_size === 'number' ? file.file_size : null,
            assetStructureType,
            // Everything below is carried into customData rather than mapped onto OMC properties:
            // it identifies the record in Frame.io, and OMC has nowhere for it that would not be an
            // invention.
            frameioAccountId: accountId,
            frameioProjectId: project.id,
            frameioProjectName: project.name ?? null,
            frameioWorkspaceId: project.workspace_id ?? null,
            frameioParentId: file.parent_id ?? null,
            frameioVersionStackId: versionStackId,
            frameioViewUrl: file.view_url ?? null,
            frameioStatus: file.status ?? null,
            frameioCreatedAt: file.created_at ?? null,
            frameioUpdatedAt: file.updated_at ?? null,
            // Derived from metadata, so it is placed here rather than left at the far right of a
            // fifty-column sheet where nobody would find it.
            SlateId: slateId(metadata),
            // Spread last for column order — the structural columns read first — but filtered so a
            // custom field sharing a structural name cannot overwrite it. `fileId` is the key every
            // identifier in this run is seeded from; letting anyone's field definition replace it
            // would repoint the whole model.
            ...withoutStructuralNames(metadata, collisions),
        };
    });

    for (const [name, count] of collisions) {
        notes.push({
            kind: 'metadataNameCollision',
            where: name,
            detail: `${count} file(s) carry a metadata field named "${name}", which is also a `
                + 'structural column; the structural value was kept and the metadata one dropped',
        });
    }

    if (withoutMetadata) {
        notes.push({
            kind: 'metadataMissing',
            where: 'Frame.io',
            detail: `${withoutMetadata} file(s) arrived with no metadata array, so only the `
                + 'structural columns are available for them',
        });
    }

    for (const [mediaType, count] of unclassified) {
        notes.push({
            kind: 'unclassifiedMediaType',
            where: mediaType,
            detail: `${count} file(s) recorded as "${FALLBACK_STRUCTURE}"; add an entry to `
                + 'MEDIA_TYPE_STRUCTURE in sources/frameio/rows.js to classify them',
        });
    }

    return { rows, notes };
}

/**
 * How many comment threads Frame.io says a row's file has.
 *
 * Read off the flattened row rather than the file record, because the count is a metadata field and
 * this is the one place that knows how metadata became columns. A row that never received metadata
 * reports zero, which costs a file its comments rather than costing the run a wasted request per
 * file — and the missing metadata is already reported by {@link buildRows}.
 *
 * @param {Object} row - A row from {@link buildRows}
 * @returns {number} The count, or 0 when absent or unparseable
 */
export function commentCount(row) {
    const raw = row?.[COMMENT_COUNT_COLUMN];
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * One comment, flattened. Replies are comments on the same file, so they flatten the same way and
 * name their parent rather than nesting.
 *
 * @param {Object} comment - A comment record
 * @param {string} fileId - The file it belongs to
 * @param {(string|null)} replyTo - The id of the comment this replies to, when it is a reply
 * @returns {Object} A row
 */
const commentRow = (comment, fileId, replyTo = null) => ({
    fileId,
    commentId: comment.id ?? null,
    commentText: comment.text ?? null,
    // Only present because the listing asks for `include=owner`; the comment record itself names
    // nobody. See COMMENT_INCLUDE in endpoints.js.
    commentAuthor: comment.owner?.name ?? null,
    commentAuthorEmail: comment.owner?.email ?? null,
    // Frame.io calls this `timestamp`, and it is not one — it is the frame the comment is pinned
    // to. Named for what it is so nobody maps it onto a date.
    commentFrame: typeof comment.timestamp === 'number' ? comment.timestamp : null,
    commentCreatedAt: comment.created_at ?? null,
    commentUpdatedAt: comment.updated_at ?? null,
    commentReplyTo: replyTo,
});

/**
 * Build the `comments` table.
 *
 * **One row per comment, not per file** — which is how a table says "many". A file with three
 * comments contributes three rows, all carrying the same `fileId`, and a mapping keyed on `fileId`
 * folds them back into that file's one Asset with three annotations. Nothing here needs a cap, a
 * numbered column, or a second engine concept.
 *
 * Replies are flattened alongside their parent rather than nested: a reply is a comment on the same
 * file, and `commentReplyTo` keeps the thread recoverable without making the table ragged.
 *
 * @memberof namespace:DataPipeline.frameio
 * @function buildCommentRows
 * @param {Array<{fileId: string, comments: Array<Object>}>} fetched - Per file, as
 *   {@link fetchComments} returned them
 * @returns {{rows: DataPipeline.Table, notes: Array<DataPipeline.MappingNote>}} The table, and a
 *   note where a comment carried no text to record
 */
export function buildCommentRows(fetched) {
    const notes = [];
    const rows = [];
    let untexted = 0;

    for (const { fileId, comments } of fetched ?? []) {
        for (const comment of comments ?? []) {
            rows.push(commentRow(comment, fileId));
            for (const reply of comment.replies ?? []) {
                rows.push(commentRow(reply, fileId, comment.id ?? null));
            }
        }
    }

    for (const row of rows) {
        if (!row.commentText) untexted += 1;
    }
    if (untexted) {
        notes.push({
            kind: 'commentWithoutText',
            where: 'Frame.io',
            detail: `${untexted} comment(s) carry no text — a drawn annotation or an attachment `
                + 'with nothing typed alongside it',
        });
    }

    return { rows, notes };
}
