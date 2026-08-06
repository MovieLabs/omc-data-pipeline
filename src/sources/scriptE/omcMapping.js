import '../../types.js'; // Type definitions, resolved globally by JSDoc

import { ASSET_FUNCTION_TYPE } from './documentTypes.js';

/** The `customData.domain` under which Script-E's own columns are carried. */
const DOMAIN = 'Script-E';

/**
 * Columns withheld from the customData catch-all. `distance` is a verbatim copy of
 * `lensHeight` in the Script-E export and carries no information — see
 * `docs/scriptE-source-analysis.md`. `productionName` is context repeated on every row.
 */
const NO_INFORMATION = ['distance', 'productionName'];

/**
 * How Script-E's interim tables become OMC entities.
 *
 * This is data, not code. The generic builder in `src/omc/build.js` applies it; nothing
 * here knows how to construct an entity, and nothing in the builder knows about Script-E.
 *
 * The two grains reflect what Script-E actually records. A **Slate** is what is held at the
 * head of a take, so there is one per row of `takes`. A **ProductionScene** is a scene from
 * the breakdown, covered by however many takes, so it groups those rows.
 *
 * @memberof namespace:DataPipeline
 * @type {Array<DataPipeline.EntityMapping>}
 */
export const omcMappings = [
    {
        entityType: 'ProductionScene',
        table: 'takes',
        grain: 'group',
        key: 'productionScene',
        // A wild track is slated and recorded but belongs to no breakdown scene, so those
        // rows yield a Slate and no ProductionScene.
        skipWhenKeyEmpty: true,
        properties: {
            'label': 'productionScene',
            'productionSceneName.fullName': 'productionScene',
            'sceneNumber': 'productionScene',
            // Only where the production scene covers exactly one narrative scene. Where it
            // covers two (R13/15 covers 13 and 15) there is no one header, and inventing a
            // composite would assert something the script does not say — the edges carry
            // the relationship instead.
            'sceneHeader': {
                from: 'narrativeScene',
                split: ';',
                when: 'single',
                lookup: { table: 'narrativeScenes', on: 'narrativeScene', select: 'heading' },
            },
            // shotDescription is take-level in Script-E and does vary within a slate, so it
            // is promoted to the scene only when every take agrees.
            'sceneDescriptor': { from: 'shotDescription', when: 'unanimous' },
        },
        customData: {
            domain: DOMAIN,
            rest: true,
            // `slate` repeats the key; `slateFullName` and `take` identify a take, not the scene.
            exclude: [...NO_INFORMATION, 'slate', 'slateFullName', 'take'],
        },
        edges: [
            { to: 'Slate', via: 'slateFullName', inverse: true },
            // A production scene can cover more than one narrative scene: slate R13/15
            // covers scenes 13 and 15.
            {
                to: 'NarrativeScene', via: 'narrativeScene', split: ';', inverse: true,
            },
        ],
    },
    {
        entityType: 'Slate',
        table: 'takes',
        grain: 'row',
        key: 'slateFullName',
        properties: {
            'label': 'slateFullName',
            'slateName.fullName': 'slateFullName',
            'description': 'shotDescription',
            'cameraLabel': 'camera',
            'cameraUnit': 'unit',
            'cameraRoll': 'cameraRoll',
            'soundRoll': 'soundRoll',
            'shootDate': 'shootDate',
            'shootDay': { from: 'shootDay', as: 'number' },
            'recordingFPS': { from: 'recordingFPS', as: 'number' },
        },
        notes: {
            annotation: [
                { title: 'Comment', from: 'comment' },
                { title: 'Technical Comment', from: 'technicalComment' },
                { title: 'VFX Notes', from: 'vfxNotes' },
            ],
        },
        // Everything else Script-E records for the take — clip number, select type, circle
        // status, lens and exposure, timecode. `rest` means a column added to the extractor
        // later flows through with no edit here. For a wild track this is also the only
        // record of its narrative scene, since it has no ProductionScene edge to carry it.
        customData: {
            domain: DOMAIN,
            rest: true,
            exclude: [...NO_INFORMATION, 'slate', 'productionScene'],
        },
        // The inverse of ProductionScene's has.Slate is written from that side, so this
        // edge is declared there rather than here.
    },
    {
        entityType: 'NarrativeScene',
        table: 'narrativeScenes',
        // Narrative scenes recur across filming days — scene 5 was shot on Days 1 and 4,
        // 14 and 16 on Days 3 and 4 — so the table holds 19 rows for 16 scenes. Grouping on
        // the scene number is what de-duplicates them into one entity each.
        grain: 'group',
        key: 'narrativeScene',
        properties: {
            'label': 'heading',
            'sceneNumber': 'narrativeScene',
            // The scene as the script names it: `INT. JULIA'S APARTMENT - NIGHT`.
            'narrativeSceneName.fullName': 'heading',
        },
        notes: {
            // Script-E's `scene_slug` is the one-line synopsis of the scene's action, which
            // is what OMC's note-shaped `slugline` holds.
            slugline: [{ title: 'Scene Slug', from: 'slug' }],
            annotation: [{ title: 'Script Supervisor Questions', from: 'questions' }],
        },
        customData: {
            domain: DOMAIN,
            rest: true,
            // `heading` is the name; `shootDay` is which day's export the row came from,
            // not a fact about the scene — `shootDayStarted` and `shootDayCredited` are.
            exclude: [...NO_INFORMATION, 'heading', 'shootDay', 'scriptRevision'],
        },
        edges: [
            // Characters are not built by this pass. Their rows live in their own table,
            // joined on the scene number; the reference is seeded exactly as the Character
            // entity will be, so it resolves as soon as that pass runs.
            {
                to: 'Character',
                from: { table: 'narrativeSceneCharacters', on: 'narrativeScene' },
                via: 'characterName',
                external: true,
            },
        ],
    },

    // The files Script-E delivers are themselves production assets. All three mappings read
    // the same `assets` table keyed on the file name; `seedFor` folds the entityType into
    // the identifier hash, so one key yields three distinct entities that point at each
    // other.
    {
        entityType: 'Asset',
        table: 'assets',
        grain: 'row',
        key: 'fileName',
        properties: {
            'label': 'description',
            'assetName.fullName': 'description',
            'description': 'description',
            'assetFunction.assetFunctionType': { const: ASSET_FUNCTION_TYPE },
        },
        customData: {
            domain: DOMAIN,
            rest: true,
            // Carried by the AssetStructure and Provenance instead.
            exclude: [...NO_INFORMATION, 'fileName', 'filePath', 'fileExtension', 'mediaType',
                'fileSize', 'assetStructureType', 'assetFunctionType', 'printDate'],
        },
        edges: [
            { to: 'AssetStructure', via: 'fileName' },
            { to: 'Provenance', via: 'fileName' },
        ],
    },
    {
        entityType: 'AssetStructure',
        table: 'assets',
        grain: 'row',
        key: 'fileName',
        properties: {
            'label': 'fileName',
            'assetStructureName.fullName': 'fileName',
            // Required and controlled: `digital.document` for the printed reports,
            // `digital.data` for the machine-readable exports.
            'assetStructureType': 'assetStructureType',
            'assetStructureProperties.fileDetails.fileName': 'fileName',
            'assetStructureProperties.fileDetails.filePath': 'filePath',
            'assetStructureProperties.fileDetails.fileExtension': 'fileExtension',
            'assetStructureProperties.fileDetails.mediaType': 'mediaType',
        },
    },
    {
        entityType: 'Provenance',
        table: 'assets',
        grain: 'row',
        key: 'fileName',
        properties: {
            // The date Script-E printed the file, read from the report header. Two Detailed
            // Editor's Logs were generated on different days from different data; this is
            // what tells them apart. OMC's createdOn is a dateTime, so the date-only value is
            // promoted to midnight UTC — Script-E prints no time.
            createdOn: { from: 'printDate', as: 'datetime' },
            reason: { const: 'Generated by Script-E as a production day deliverable' },
        },
        // `CreatedBy` → Participant is left for a later pass: the script supervisor's name
        // appears only in the PDF footers, which this pass does not read.
    },
];
