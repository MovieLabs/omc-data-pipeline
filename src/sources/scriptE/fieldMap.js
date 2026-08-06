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
const straightenQuotes = (s) => s.replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"');

/** Loose text compare: quote style and internal whitespace runs are not real differences. */
const looseText = (s) => straightenQuotes(s).replace(/\s+/g, ' ').trim().toLowerCase();

/** `01/23/2026 15:41:51` (SilverStack) -> `2026-01-23T15:41:51` (Script-E XML). */
const usDateTimeToIso = (s) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})$/.exec(s.trim());
    return m ? `${m[3]}-${m[1]}-${m[2]}T${m[4]}` : s;
};

/** `23.976` and `23.9760` are the same frame rate; compare numerically when possible. */
const asNumber = (s) => {
    const n = Number(s);
    return Number.isNaN(n) ? s : String(n);
};

/**
 * Script-E writes the literal string `(null)` into an element rather than leaving it
 * empty, in both the SIM Metabanq and Editor Log exports. Carrying that through would put
 * the word "(null)" into OMC entities, so it is treated as absent here — and counted, so
 * the fidelity report can say how much of the day is affected.
 */
export const SENTINEL_NULL = '(null)';

/**
 * Normalize one raw Script-E value: `(null)` and empty become `null`.
 *
 * @param {string|null} value already-trimmed value from the XML layer
 * @returns {string|null} normalized value
 */
export const scriptEValue = (value) => (value === SENTINEL_NULL ? null : value);

/**
 * Script-E also leaks internal object descriptions into some elements — `scene_script_revision`
 * and `production_unit` come out as `<Unit: 0x60000aeaec30>`. The pointer changes between
 * exports, so the value is not even a stable identifier. Kept in the tables verbatim (it is
 * what the source says) but flagged, because it must not reach an OMC entity.
 */
export const OBJECT_DESCRIPTION = /^<[A-Za-z]+: 0x[0-9a-f]+>$/;

/**
 * Script-E labels shoot days `Day 1`; OMC wants the number alone. Applied both as an output
 * transform and as a comparison normalizer, so a source that spells the day differently
 * still compares equal.
 *
 * @param {string|null} value e.g. `Day 1`
 * @returns {string|null} e.g. `1`
 */
export const shootDayNumber = (value) => {
    if (value === null || value === undefined) return null;
    const m = /^\s*(?:day\s*)?(\d+)\s*$/i.exec(String(value));
    return m ? m[1] : String(value);
};

/**
 * Build the slate as it is written and spoken on set: slate and take, hyphenated — `3A-1`,
 * `8C-6.1 PU`, `1001-1`. Uses the raw slate and take labels so decimals, annotations and
 * wild-track numbers all survive.
 *
 * @param {string|null} slate slate as delivered by Script-E
 * @param {string|null} take raw take label
 * @returns {string|null} full slate name
 */
export const slateFullName = (slate, take) => (slate && take ? `${slate}-${take}` : null);

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
export function splitSlate(slate) {
    if (slate && /^\d{4,}$/.test(slate)) {
        return { slate: null, wildTrackNumber: slate, isWildTrack: true };
    }
    return { slate: slate ?? null, wildTrackNumber: null, isWildTrack: false };
}

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
export function splitTake(take) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(.*)$/.exec(take ?? '');
    if (!m) return { number: null, annotation: take ?? null };
    return { number: Number(m[1]), annotation: m[2].trim() || null };
}

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
export const TAKE_FIELDS = [
    { key: 'slate', sim: 'script_scene', editorLog: 'Slate', csv: 'Slate' },
    { key: 'camera', sim: 'script_camera', editorLog: 'Camera', csv: 'Camera' },
    { key: 'take', sim: 'script_take', editorLog: 'Take', csv: 'Take', normalize: asNumber },
    { key: 'setup', sim: 'script_setup', editorLog: 'Setup', csv: null, normalize: asNumber },
    {
        key: 'shootDay',
        sim: 'script_shootDay',
        editorLog: 'StripBoardDay',
        csv: null,
        transform: shootDayNumber,
        normalize: shootDayNumber,
    },
    { key: 'shootDate', sim: 'script_shootDate', editorLog: 'ShootDate', csv: null },
    { key: 'unit', sim: 'script_unit', editorLog: null, csv: null },
    { key: 'cameraRoll', sim: 'script_camera_roll', editorLog: 'OriginalRoll', csv: 'Roll' },
    { key: 'soundRoll', sim: 'script_sound_roll', editorLog: 'SoundRoll', csv: null },
    { key: 'clipNumber', sim: 'script_clip_number', editorLog: 'ClipNumber', csv: null, normalize: asNumber },

    { key: 'lens', sim: 'script_lens', editorLog: 'LensType', csv: 'Lens', normalize: looseText },
    { key: 'tStop', sim: 'script_tstop', editorLog: 'TStop', csv: 'Stop', normalize: asNumber },
    { key: 'lensHeight', sim: 'script_lens_height', editorLog: 'LensHeight', csv: 'Lens Height' },
    {
        key: 'distance',
        sim: 'script_distance',
        editorLog: 'Distance',
        csv: 'Focus',
        note: 'SIM copies lensHeight verbatim into script_distance; the Editor Log writes the placeholder "na". Neither source carries real subject distance — do not map this field.',
    },
    { key: 'filter', sim: 'script_filter', editorLog: 'Filter', csv: 'Filters', normalize: looseText },
    { key: 'shutterAngle', sim: 'script_shutterAngle', editorLog: 'ShutterAngle', csv: 'Shutter', normalize: asNumber },
    { key: 'recordingFPS', sim: 'script_frame_rate', editorLog: 'FrameRate', csv: 'FPS', normalize: asNumber },
    { key: 'iso', sim: 'script_iso', editorLog: 'ISO', csv: 'ISO', normalize: asNumber },
    { key: 'colorTemperature', sim: 'script_color_temperature', editorLog: 'ColorTemperature', csv: 'Color Temp' },

    { key: 'timecodeIn', sim: 'script_time_code_in', editorLog: 'TimeCodeIn', csv: 'Timecode In' },
    { key: 'timecodeOut', sim: 'script_time_code_out', editorLog: 'TimeCodeOut', csv: 'Timecode Out' },
    { key: 'recordedTime', sim: 'script_recorded_time', editorLog: 'RecordedTime', csv: null, normalize: asNumber },
    { key: 'startDateTime', sim: 'script_start_date_time', editorLog: 'StartDateTime', csv: 'Start Time', normalize: usDateTimeToIso },
    { key: 'endDateTime', sim: 'script_end_date_time', editorLog: 'EndDateTime', csv: 'End Time', normalize: usDateTimeToIso },

    { key: 'shotDescription', sim: 'script_shot_description', editorLog: 'ShotDescription', csv: 'Description', normalize: looseText },
    { key: 'comment', sim: 'script_comment', editorLog: 'Comment', csv: 'Notes', normalize: looseText },
    { key: 'technicalComment', sim: 'script_technical_comment', editorLog: 'TechnicalComment', csv: null, normalize: looseText },

    { key: 'circleStatus', sim: 'script_circle_status', editorLog: 'CircleStatus', csv: null },
    { key: 'selectType', sim: 'script_select_type', editorLog: 'SelectType', csv: null },
    { key: 'completeShot', sim: 'script_complete_shot', editorLog: 'CompleteShot', csv: null },
    { key: 'tailSlate', sim: 'script_tail_slate', editorLog: null, csv: null },
    { key: 'vfxShot', sim: 'script_vfx_shot', editorLog: 'VFXShot', csv: null },
    { key: 'vfxNotes', sim: 'script_vfx_notes', editorLog: 'VFXNotes', csv: null, normalize: looseText },

    { key: 'interocular', sim: 'script_interocular', editorLog: 'Interocular', csv: null },
    { key: 'inclination', sim: 'script_inclination', editorLog: 'Inclination', csv: null },
    { key: 'tilt', sim: 'script_tilt', editorLog: 'Tilt', csv: null },
    { key: 'gps', sim: 'script_gps', editorLog: 'GPS', csv: null },
];

/**
 * Fields the SilverStack CSV carries that have no Script-E counterpart. `Circled` looks
 * like it ought to relate to `circleStatus`/`selectType`, but Script-E reports
 * `circleStatus` as "Active" for every take on Day 1, so the relationship is asserted
 * nowhere in the data. The validator cross-tabulates it rather than guessing a mapping.
 */
export const CSV_UNMAPPED = ['Circled'];

/**
 * Narrative-scene fields — the scenes as they appear in the script. SIM Metabanq only; the
 * Editor Log XML has no scene section. Distinct from the production scenes (`3A`, `3B`, …)
 * that the breakdown creates and that each take is slated against.
 */
export const SCENE_FIELDS = [
    { key: 'narrativeScene', sim: 'scene_number' },
    { key: 'episode', sim: 'episode_number' },
    { key: 'heading', sim: 'scene_heading' },
    { key: 'act', sim: 'scene_act' },
    { key: 'scriptRevision', sim: 'scene_script_revision' },
    { key: 'scriptPageNumber', sim: 'scene_script_page_number' },
    { key: 'scriptedEighths', sim: 'scene_scripted_eighths' },
    { key: 'estimatedRunningTime', sim: 'scene_estimated_running_time' },
    { key: 'actualRunningTime', sim: 'scene_actual_running_time' },
    { key: 'scriptDay', sim: 'scene_script_script_day' },
    { key: 'scriptDate', sim: 'scene_script_script_date' },
    { key: 'scriptTime', sim: 'scene_script_script_time' },
    { key: 'scriptDayOfWeek', sim: 'scene_script_day_of_week' },
    { key: 'shootDayStarted', sim: 'scene_shoot_day_started', transform: shootDayNumber },
    { key: 'slug', sim: 'scene_slug' },
    { key: 'questions', sim: 'scene_scripte_questions' },
    { key: 'owesInserts', sim: 'scene_scripte_owe_inserts' },
];

/** Shoot-day fields, SIM Metabanq only. */
export const SHOOT_DAY_FIELDS = [
    { key: 'shootDay', sim: 'day_number', transform: shootDayNumber },
    { key: 'unit', sim: 'production_unit' },
    { key: 'shootDate', sim: 'shoot_date' },
    { key: 'crewCall', sim: 'production_crewcall' },
    { key: 'secondCall', sim: 'production_secondcall' },
    { key: 'firstShot', sim: 'production_firstshot' },
    { key: 'lunch', sim: 'production_lunch' },
    { key: 'lunchDuration', sim: 'production_lunch_duration' },
    { key: 'backFromLunch', sim: 'production_back_from_lunch' },
    { key: 'afterLunchFirstShot', sim: 'production_afterlunch_firstshot' },
    { key: 'dinner', sim: 'production_dinner' },
    { key: 'dinnerDuration', sim: 'production_dinner_duration' },
    { key: 'backFromDinner', sim: 'production_back_from_dinner' },
    { key: 'afterDinnerFirstShot', sim: 'production_afterdinner_firstshot' },
    { key: 'cameraWrap', sim: 'production_camera_wrap' },
    { key: 'soundWrap', sim: 'production_sound_wrap' },
    { key: 'scriptWrap', sim: 'production_script_wrap' },
    { key: 'todaysOvertime', sim: 'todays_production_overtime' },
    { key: 'weeksOvertime', sim: 'this_weeks_production_overtime' },
];

export { looseText, straightenQuotes, usDateTimeToIso, asNumber };
