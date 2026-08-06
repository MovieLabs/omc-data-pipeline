import { SCENE_FIELDS, SHOOT_DAY_FIELDS, TAKE_FIELDS } from './fieldMap.js';

/**
 * Identity columns lead the takes sheet. `slate` is the term Script-E uses; `productionScene`
 * is the same value under the OMC name, and `narrativeScene` is the scripted scene the take
 * covers — the two are distinct concepts (`3A` is a production scene covering narrative
 * scene `3`) and both are needed when mapping.
 */
const TAKE_LEAD = [
    'slateFullName',
    'slate',
    'productionScene',
    'narrativeScene',
    'wildTrackNumber',
    'isWildTrack',
    'episode',
    'camera',
    'take',
    'takeAnnotation',
    'setup',
];
const TAKE_TAIL = ['recordedTimeSeconds'];

/** Column order for the takes sheet: identity first, then the field map order, then derived. */
const takeColumns = () => {
    const mapped = TAKE_FIELDS.map((f) => f.key).filter((k) => !TAKE_LEAD.includes(k));
    return [...TAKE_LEAD, ...mapped, ...TAKE_TAIL];
};

const sceneColumns = () => [...SCENE_FIELDS.map((f) => f.key), 'shootDayCredited', 'eighthsCredited'];

const TAKE_CHARACTER_COLUMNS = [
    'slateFullName', 'productionScene', 'narrativeScene', 'slate', 'camera', 'take',
    'characterNumber', 'characterName',
];

/**
 * Project a row onto an explicit column list, so every row in a table has the same shape
 * and the CSV/sheet header order is deterministic rather than insertion-ordered.
 *
 * @param {object} row source row
 * @param {string[]} columns columns to emit, in order
 * @param {object} [context] values prepended to every row
 * @returns {object} projected row
 */
const project = (row, columns, context = {}) => {
    const out = { ...context };
    for (const c of columns) out[c] = row[c] ?? null;
    return out;
};

/**
 * Flatten the normalized day model into the tables written to processedData.
 *
 * Every table repeats `productionName` and `shootDay` so a sheet stays meaningful once days
 * are concatenated for whole-production analysis. Tables that carry their own `shootDay`
 * column (shootDay, takes) simply overwrite the context value with the identical one.
 *
 * @param {object} model output of {@link parseSim}
 * @returns {Record<string, object[]>} table name -> rows
 */
export function toTables(model) {
    const context = {
        productionName: model.production.productionName,
        shootDay: model.shootDays[0]?.shootDay ?? model.takes[0]?.shootDay ?? null,
    };

    return {
        shootDay: model.shootDays.map((r) => project(r, SHOOT_DAY_FIELDS.map((f) => f.key), context)),
        narrativeScenes: model.scenes.map((r) => project(r, sceneColumns(), context)),
        narrativeSceneCharacters: model.sceneCharacters
            .map((r) => project(r, ['narrativeScene', 'characterNumber', 'characterName'], context)),
        takes: model.takes.map((r) => project(r, takeColumns(), context)),
        takeCharacters: model.takeCharacters.map((r) => project(r, TAKE_CHARACTER_COLUMNS, context)),
    };
}
