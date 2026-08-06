import { readFile } from 'node:fs/promises';

import { list, parseXml, text } from '../../lib/xml.js';

import { scriptEValue, splitSlate, TAKE_FIELDS } from './fieldMap.js';

const ARRAY_TAGS = ['ShotProperties', 'Scene'];

/**
 * Parse the Editor Log XML into take rows.
 *
 * This export is a subset of the SIM Metabanq shot section, so it is not used to build the
 * output tables — it exists here as an independent witness for the fidelity check.
 *
 * @param {(string|Buffer)} source the XML text, or its bytes
 * @param {string} [label] what to call the document if it turns out to be the wrong one
 * @returns {{production: object, takes: object[]}} header and take rows
 */
export function parseEditorLogXml(source, label = 'The supplied document') {
    const doc = parseXml(source, ARRAY_TAGS);
    const root = doc.ScriptEMetaData;
    if (!root) throw new Error(`${label} is not a ScriptEMetaData document`);

    const takes = list(root.ShotProperties).map((raw) => {
        const take = {};
        for (const { key, editorLog } of TAKE_FIELDS) {
            if (editorLog) take[key] = scriptEValue(text(raw[editorLog]));
        }
        Object.assign(take, splitSlate(take.slate));
        take.productionName = text(raw.ProductionName);
        take.sourceType = text(raw.SourceType);
        take.narrativeScene = list(raw.RelatedScenes?.Scene).map(text).filter(Boolean).join('; ') || null;
        return take;
    });

    return {
        production: { uuid: text(root.UUID), created: text(root.Created), schemaVersion: text(root['@Version']) },
        takes,
    };
}

/**
 * Parse an Editor Log XML read from a file.
 *
 * @param {string} filePath absolute path to the Editor Log XML
 * @returns {Promise<{production: object, takes: object[]}>} header and take rows
 */
export async function parseEditorLogXmlFile(filePath) {
    return parseEditorLogXml(await readFile(filePath, 'utf8'), filePath);
}
