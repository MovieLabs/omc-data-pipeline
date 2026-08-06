import { readFile } from 'node:fs/promises';

import { list, parseXml, text } from '../../lib/xml.js';

import {
    OBJECT_DESCRIPTION, SCENE_FIELDS, scriptEValue, SENTINEL_NULL, SHOOT_DAY_FIELDS,
    shootDayNumber, slateFullName, splitSlate, splitTake, TAKE_FIELDS,
} from './fieldMap.js';

/** Elements that must always be arrays, even when the day happens to have exactly one. */
const ARRAY_TAGS = [
    'scene',
    'character_in_scene',
    'character',
    'shoot_day',
    'shot_properties',
    'scene_shoot_day_credited',
];

/**
 * The identity a take is joined on across sources. Mirrors the fidelity check, so a
 * collision reported here is exactly a collision the check would hit.
 *
 * @param {object} take take row
 * @returns {string} join key
 */
const takeJoinKey = (take) => {
    const { number, annotation } = splitTake(take.take);
    return `${take.slate ?? take.wildTrackNumber}|${take.camera ?? ''}|${number ?? annotation ?? ''}`;
};

/**
 * Pull the mapped fields out of a raw parsed element, resolving Script-E's `(null)`
 * sentinel and tallying where it appeared.
 *
 * @param {object} node raw element
 * @param {Array<DataPipeline.ScriptEField>} fields - Field map entries
 * @param {Record<string, number>} sentinels tally of sentinel hits, by field, mutated in place
 * @returns {object} canonical-keyed object
 */
function pick(node, fields, sentinels) {
    const out = {};
    for (const { key, sim, transform } of fields) {
        if (!sim) continue;
        const raw = text(node[sim]);
        if (raw === SENTINEL_NULL) sentinels[key] = (sentinels[key] ?? 0) + 1;
        const value = scriptEValue(raw);
        out[key] = transform ? transform(value) : value;
    }
    return out;
}

/**
 * Parse a SIM Metabanq export into the normalized day model.
 *
 * This is the primary source: it carries the shot/take table in full plus the scene and
 * shoot-day sections that the Editor Log XML lacks.
 *
 * @param {(string|Buffer)} source the XML text, or its bytes
 * @param {string} [label] what to call the document if it turns out to be the wrong one
 * @returns {object} normalized day model, including an `anomalies` list
 */
export function parseSim(source, label = 'The supplied document') {
    const doc = parseXml(source, ARRAY_TAGS);
    const root = doc.ScriptESIMMetabanq;
    if (!root) throw new Error(`${label} is not a ScriptESIMMetabanq document`);

    const anomalies = [];
    const sentinelNulls = {};

    const production = {
        uuid: text(root.UUID),
        created: text(root.created),
        sourceType: text(root.source_type),
        productionName: text(root.production_name),
        schemaVersion: text(root['@Version']),
    };

    const scenes = [];
    const sceneCharacters = [];
    for (const raw of list(root.script?.scene)) {
        const scene = pick(raw, SCENE_FIELDS, sentinelNulls);

        // Script-E emits `scene_shoot_day_credited` twice: first the shoot day, then the
        // eighths credited to it. Same tag, two meanings — split rather than lose one.
        const credited = list(raw.scene_shoot_day_credited).map(text);
        scene.shootDayCredited = shootDayNumber(credited[0] ?? null);
        scene.eighthsCredited = credited[1] ?? null;
        if (credited.length > 2) {
            anomalies.push({
                kind: 'unexpectedRepeatedTag',
                where: `scene ${scene.narrativeScene}`,
                detail: `scene_shoot_day_credited appeared ${credited.length} times: ${credited.join(', ')}`,
            });
        }

        const seen = new Set();
        for (const c of list(raw.characters_in_scene?.character_in_scene)) {
            const row = {
                narrativeScene: scene.narrativeScene,
                characterNumber: text(c.character_in_scene_number),
                characterName: text(c.character_in_scene_name),
            };
            const dupKey = `${row.characterNumber}|${row.characterName}`;
            if (seen.has(dupKey)) {
                anomalies.push({
                    kind: 'duplicateCharacter',
                    where: `scene ${scene.narrativeScene}`,
                    detail: `${row.characterName} (#${row.characterNumber}) listed more than once`,
                });
            }
            seen.add(dupKey);
            sceneCharacters.push(row);
        }
        scenes.push(scene);
    }

    const shootDays = list(root.shoot_days?.shoot_day).map((raw) => pick(raw, SHOOT_DAY_FIELDS, sentinelNulls));

    const takes = [];
    const takeCharacters = [];
    for (const raw of list(root.shots?.shot_properties)) {
        const take = pick(raw, TAKE_FIELDS, sentinelNulls);

        // Built from the slate as delivered, before wild tracks are split out, so a wild
        // track still reads as the `1001-1` that was called on the day.
        take.slateFullName = slateFullName(take.slate, take.take);

        // `script_scene` holds the slate, which is the production scene from the breakdown
        // (`3A`); `related_scenes` holds the narrative scene(s) as scripted (`3`). A take can
        // cover more than one narrative scene, e.g. slate `R13/15`.
        const slateParts = splitSlate(take.slate);
        take.slate = slateParts.slate;
        take.productionScene = slateParts.slate;
        take.wildTrackNumber = slateParts.wildTrackNumber;
        take.isWildTrack = slateParts.isWildTrack;
        take.narrativeScene = list(raw.related_scenes?.scene).map(text).filter(Boolean).join('; ') || null;
        take.episode = text(raw.related_scenes?.episode);
        take.recordedTimeSeconds = take.recordedTime === null ? null : Number(take.recordedTime);

        // `script_take` can carry an annotation, e.g. `6 PU` for a pickup. The annotation is
        // kept; the leading number is not emitted, because take labels are not reliably
        // numeric and a parsed number would invite being trusted as an identifier.
        take.takeAnnotation = splitTake(take.take).annotation;

        for (const c of list(raw.characters_in_scenes?.character)) {
            takeCharacters.push({
                slateFullName: take.slateFullName,
                productionScene: take.productionScene,
                narrativeScene: take.narrativeScene,
                slate: take.slate,
                camera: take.camera,
                take: take.take,
                characterNumber: text(c.character_number),
                characterName: text(c.character_name),
            });
        }
        takes.push(take);
    }

    const leaked = new Set();
    for (const row of [...takes, ...scenes, ...shootDays]) {
        for (const [field, value] of Object.entries(row)) {
            if (typeof value === 'string' && OBJECT_DESCRIPTION.test(value)) leaked.add(field);
        }
    }
    for (const field of leaked) {
        anomalies.push({
            kind: 'objectDescription',
            where: `field ${field}`,
            detail: 'value is a leaked internal object description (e.g. "<Unit: 0x...>"), not real data — do not map',
        });
    }

    // The fidelity check joins on slate|camera|take number, so a collision there would
    // silently hide a take rather than report it.
    const keyCounts = {};
    for (const t of takes) {
        const key = takeJoinKey(t);
        keyCounts[key] = (keyCounts[key] ?? 0) + 1;
    }
    for (const [key, count] of Object.entries(keyCounts).filter(([, n]) => n > 1)) {
        anomalies.push({
            kind: 'duplicateTakeKey',
            where: key,
            detail: `${count} takes share slate|camera|take — they cannot be told apart across sources`,
        });
    }

    // Guard against silently trusting a field that is only a copy of another one.
    if (takes.length && takes.every((t) => t.distance === t.lensHeight)) {
        anomalies.push({
            kind: 'duplicatedField',
            where: 'shot_properties',
            detail: 'script_distance is identical to script_lens_height for every take — it carries no distance data',
        });
    }

    for (const [field, count] of Object.entries(sentinelNulls)) {
        anomalies.push({
            kind: 'sentinelNull',
            where: `field ${field}`,
            detail: `${count} value(s) were the literal string "${SENTINEL_NULL}" and are treated as absent`,
        });
    }

    return { production, scenes, sceneCharacters, shootDays, takes, takeCharacters, anomalies };
}

/**
 * Parse a SIM Metabanq export read from a file.
 *
 * @param {string} filePath absolute path to the SIM Metabanq XML
 * @returns {Promise<object>} normalized day model, including an `anomalies` list
 */
export async function parseSimFile(filePath) {
    return parseSim(await readFile(filePath, 'utf8'), filePath);
}
