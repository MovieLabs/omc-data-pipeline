import '../../types.js'; // Type definitions, resolved globally by JSDoc

import { DERIVED_COLUMNS, DOMAIN } from './rows.js';

/**
 * Columns the AssetStructure carries as real OMC properties. Withheld from the Asset's customData
 * catch-all so the same fact is not stated twice in two places.
 */
const STRUCTURAL = ['filePath', 'fileExtension', 'mediaType', 'fileSize', 'assetStructureType'];

/**
 * What the AssetStructure's customData takes, as an allow-list rather than the usual `exclude`.
 *
 * With metadata in the rows there are around fifty columns, and the two entities want different
 * halves of them: Frame.io's derived technical inspection describes the bytes, and belongs on the
 * structure; what a person typed — Slate, Scene, Take, Characters — describes the take, and belongs
 * on the Asset. Stating it as a denylist would mean listing the production fields here *and* the
 * technical ones on the Asset, two lists to keep in step, and a custom field added next month would
 * land on both.
 *
 * Named as the allow-list so anything new goes to the Asset, which is the thing Frame.io names.
 * `Comment Count` is deliberately absent: it counts comments, which the `comments` dataset carries
 * as annotations on the Asset, so recording the number on the structure would be a stale copy of
 * something already said properly.
 */
const TECHNICAL = DERIVED_COLUMNS.filter((c) => c !== 'Comment Count');

/**
 * Columns that identify the record in Frame.io. Carried on the Asset — which is the thing Frame.io
 * actually names — and withheld from the AssetStructure, which describes the bytes rather than the
 * source system's bookkeeping.
 */
const SOURCE_IDENTITY = [
    'fileId', 'frameioAccountId', 'frameioProjectId', 'frameioProjectName', 'frameioWorkspaceId',
    'frameioParentId', 'frameioVersionStackId', 'frameioViewUrl', 'frameioStatus',
    'frameioCreatedAt', 'frameioUpdatedAt',
];

/**
 * How the interim `files` table becomes OMC entities.
 *
 * This is data, not code. The generic builder in `src/omc/build.js` applies it; nothing here knows
 * how to construct an entity, and nothing in the builder knows about Frame.io.
 *
 * Both mappings read the same table at the same grain, keyed on `fileId`. `seedFor` folds the
 * entityType into the identifier hash, so one key yields two distinct entities — and the edge
 * between them is created from the schema's own definition rather than written out here.
 *
 * **`assetFunction` is deliberately not set.** Frame.io is a review platform holding whatever a
 * production puts in it; it says what a file *is* (`media_type`) but never what it is *for*, and
 * `assetFunctionType` is exactly that second question. Choosing a value would state something the
 * source never said. It is optional on Asset, so it is left for a pass — or a person — that knows.
 *
 * @memberof namespace:DataPipeline.frameio
 * @type {Array<DataPipeline.EntityMapping>}
 */
export const omcMappings = [
    {
        entityType: 'Asset',
        table: 'files',
        grain: 'row',
        key: 'fileId',
        properties: {
            'label': 'fileName',
            'assetName.fullName': 'fileName',
        },
        customData: {
            domain: DOMAIN,
            rest: true,
            // The same one list, used from the other side: what the structure takes, the Asset
            // leaves. Anything Frame.io grows that is not in it lands here, which is the right
            // default — the Asset is the thing Frame.io names.
            exclude: [...STRUCTURAL, ...TECHNICAL],
        },
        edges: [
            { to: 'AssetStructure', via: 'fileId' },
        ],
    },
    {
        entityType: 'AssetStructure',
        table: 'files',
        grain: 'row',
        key: 'fileId',
        properties: {
            'label': 'fileName',
            'assetStructureName.fullName': 'fileName',
            // Required, and controlled by the schema. Derived from the file's media type in
            // `rows.js`, where the derivation is checked against the schema's own list.
            'assetStructureType': 'assetStructureType',
            // These five are the whole of what v3.0 admits under fileDetails — it is
            // `additionalProperties: false`. Size has no home here, which is why it goes to
            // customData below rather than being squeezed in.
            'assetStructureProperties.fileDetails.fileName': 'fileName',
            'assetStructureProperties.fileDetails.filePath': 'filePath',
            'assetStructureProperties.fileDetails.fileExtension': 'fileExtension',
            'assetStructureProperties.fileDetails.mediaType': 'mediaType',
        },
        customData: {
            domain: DOMAIN,
            rest: true,
            // Leaves `fileSize`, which is the point: v3.0 has no size property anywhere on
            // AssetStructure, and customData is the schema's own provision for a source field OMC
            // has no home for.
            exclude: SOURCE_IDENTITY,
            // …and beyond that, only what Frame.io derived from the media itself.
            include: ['fileSize', ...TECHNICAL],
        },
    },
];

/**
 * How the interim `comments` table becomes annotations on the Assets the `files` table built.
 *
 * The table has one row per comment, so several rows describe one Asset. That works because the key
 * is `fileId` — the same key the `files` mapping used — so both mappings seed the same identifier
 * and `buildEntities` folds the second into the first. `mergeEntity` unions arrays by value, which
 * is what turns three rows into three annotations rather than three Assets, and what keeps a re-run
 * from duplicating them.
 *
 * `annotation[0]` on every row is not a mistake: each row builds its own Asset carrying a
 * single-element array, and the union is what stacks them up. Writing `annotation[1]` would be
 * asking one row for two comments.
 *
 * Nothing here sets a property the `files` mapping also sets, so the `prefer: 'existing'` rule the
 * fold applies never has to arbitrate.
 *
 * @memberof namespace:DataPipeline.frameio
 * @type {Array<DataPipeline.EntityMapping>}
 */
export const commentMappings = [
    {
        entityType: 'Asset',
        table: 'comments',
        grain: 'row',
        key: 'fileId',
        properties: {
            'annotation[0].text': 'commentText',
            'annotation[0].author': 'commentAuthor',
            // v3.0 gives an annotation exactly `author`, `title` and `text`, so the frame the
            // comment is pinned to has one place to go. `title` is a string in the schema, and the
            // frame arrives as a number.
            'annotation[0].title': { from: 'commentFrame', as: 'string' },
        },
        // No customData: the ids, timestamps and reply structure describe the comment, and OMC has
        // no comment to hang them on. What matters — who said what, and where — is the annotation.
    },
];

export default omcMappings;
