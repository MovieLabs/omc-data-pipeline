/**
 * Script-E slates wild tracks (sound recorded without camera) in a 1000-block that runs
 * unbroken across the whole production — 1001–1011 over the four WWDOAT days, matching the
 * list in the Report to Editor. That number is a wild-track identifier, not a scene, so it
 * is separated out rather than left sitting in the slate/production-scene column, where it
 * would map into OMC as a scene that does not exist. The scene a wild track belongs to is
 * carried by `related_scenes` like any other take.
 *
 * @param {string|null} slate raw slate value
 * @returns {{slate: (string|null), wildTrackNumber: (string|null), isWildTrack: boolean}} split slate
 */
export function splitSlate(slate: string | null): {
    slate: (string | null);
    wildTrackNumber: (string | null);
    isWildTrack: boolean;
};
/**
 * Split a take label into its number and any annotation.
 *
 * Take labels are not integers. Script-E writes decimals for takes resumed within the same
 * slate and setup (`6.1 PU`, `6.2 PU`, `4.1`, `4.2`) and appends notes such as `PU`
 * (pickup). The decimal is part of the identity — truncating it collides two distinct
 * takes — while the note is dropped entirely by the Editor Log XML, so the cross-source
 * join is on the number and the annotation is carried separately.
 *
 * @param {string|null} take raw take label
 * @returns {{number: (number|null), annotation: (string|null)}} split label
 */
export function splitTake(take: string | null): {
    number: (number | null);
    annotation: (string | null);
};
/**
 * Script-E writes the literal string `(null)` into an element rather than leaving it
 * empty, in both the SIM Metabanq and Editor Log exports. Carrying that through would put
 * the word "(null)" into OMC entities, so it is treated as absent here — and counted, so
 * the fidelity report can say how much of the day is affected.
 */
export const SENTINEL_NULL: "(null)";
export function scriptEValue(value: string | null): string | null;
/**
 * Script-E also leaks internal object descriptions into some elements — `scene_script_revision`
 * and `production_unit` come out as `<Unit: 0x60000aeaec30>`. The pointer changes between
 * exports, so the value is not even a stable identifier. Kept in the tables verbatim (it is
 * what the source says) but flagged, because it must not reach an OMC entity.
 */
export const OBJECT_DESCRIPTION: RegExp;
export function shootDayNumber(value: string | null): string | null;
export function slateFullName(slate: string | null, take: string | null): string | null;
/**
 * One field's correspondence across the three Script-E exports.
 * @memberof namespace:DataPipeline
 * @typedef {Object} ScriptEField
 * @property {string} key - The canonical column name in the interim tables
 * @property {(string|null)} sim - The SIM Metabanq tag, or null when it does not carry the field
 * @property {(string|null)} editorLog - The Editor Log XML tag, or null
 * @property {(string|null)} csv - The SilverStack CSV column, or null
 * @property {Function} [normalize] - Applied to both sides before comparing, where the
 *   sources agree on the value but disagree on its format
 * @property {Function} [transform] - Applied to the value on the way into the tables
 * @property {string} [note] - Recorded in the fidelity report when this field differs
 */
/**
 * Take-level fields.
 * @type {Array<DataPipeline.ScriptEField>}
 */
export const TAKE_FIELDS: Array<DataPipeline.ScriptEField>;
/**
 * Fields the SilverStack CSV carries that have no Script-E counterpart. `Circled` looks
 * like it ought to relate to `circleStatus`/`selectType`, but Script-E reports
 * `circleStatus` as "Active" for every take on Day 1, so the relationship is asserted
 * nowhere in the data. The validator cross-tabulates it rather than guessing a mapping.
 */
export const CSV_UNMAPPED: string[];
/**
 * Narrative-scene fields — the scenes as they appear in the script. SIM Metabanq only; the
 * Editor Log XML has no scene section. Distinct from the production scenes (`3A`, `3B`, …)
 * that the breakdown creates and that each take is slated against.
 */
export const SCENE_FIELDS: ({
    key: string;
    sim: string;
    transform?: undefined;
} | {
    key: string;
    sim: string;
    transform: (value: string | null) => string | null;
})[];
/** Shoot-day fields, SIM Metabanq only. */
export const SHOOT_DAY_FIELDS: ({
    key: string;
    sim: string;
    transform: (value: string | null) => string | null;
} | {
    key: string;
    sim: string;
    transform?: undefined;
})[];
/**
 * One field's correspondence across the three Script-E exports.
 */
export type ScriptEField = {
    /**
     * - The canonical column name in the interim tables
     */
    key: string;
    /**
     * - The SIM Metabanq tag, or null when it does not carry the field
     */
    sim: (string | null);
    /**
     * - The Editor Log XML tag, or null
     */
    editorLog: (string | null);
    /**
     * - The SilverStack CSV column, or null
     */
    csv: (string | null);
    /**
     * - Applied to both sides before comparing, where the
     * sources agree on the value but disagree on its format
     */
    normalize?: Function;
    /**
     * - Applied to the value on the way into the tables
     */
    transform?: Function;
    /**
     * - Recorded in the fidelity report when this field differs
     */
    note?: string;
};
/** Loose text compare: quote style and internal whitespace runs are not real differences. */
export function looseText(s: any): any;
/**
 * The single declarative map between the three machine-readable Script-E exports.
 *
 * Every take-level field is listed exactly once, with the tag or column each source uses
 * for it and, where the sources genuinely disagree on format, the normalizer that makes
 * them comparable. Adding a field to the extractor and to the fidelity check is one edit
 * here — the parsers, the tables and the validator all read from this list.
 *
 * `null` for a source means that source does not carry the field at all.
 */
/** Collapse the typographic quotes SilverStack substitutes into their ASCII forms. */
export function straightenQuotes(s: any): any;
/** `01/23/2026 15:41:51` (SilverStack) -> `2026-01-23T15:41:51` (Script-E XML). */
export function usDateTimeToIso(s: any): any;
/** `23.976` and `23.9760` are the same frame rate; compare numerically when possible. */
export function asNumber(s: any): any;
//# sourceMappingURL=fieldMap.d.ts.map