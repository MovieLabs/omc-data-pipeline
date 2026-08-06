import { readFile } from 'node:fs/promises';

import { XMLParser } from 'fast-xml-parser';

/**
 * Parse source XML into a plain object.
 *
 * Everything is kept as a string: slates like `3A`, timecodes like `12:41:24:01` and
 * frame rates like `23.976` all lose information under numeric coercion, and this layer
 * is not the place to decide what a value means. Empty elements become `null`.
 *
 * @param {(string|Buffer)} source XML text, or its bytes
 * @param {string[]} [arrayTags] tag names that must always be arrays, even with one child
 * @returns {object} parsed document
 */
export function parseXml(source, arrayTags = []) {
    const always = new Set(arrayTags);
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@',
        trimValues: true,
        parseTagValue: false,
        parseAttributeValue: false,
        isArray: (name) => always.has(name),
    });
    return parser.parse(typeof source === 'string' ? source : source.toString('utf8'));
}

/**
 * Parse a source XML file into a plain object.
 *
 * @param {string} filePath absolute path to the XML file
 * @param {string[]} [arrayTags] tag names that must always be arrays, even with one child
 * @returns {Promise<object>} parsed document
 */
export async function parseXmlFile(filePath, arrayTags = []) {
    return parseXml(await readFile(filePath, 'utf8'), arrayTags);
}

/**
 * Normalize a parsed XML value to a trimmed string, or `null` when absent/empty.
 * fast-xml-parser represents an empty element as `''`, which is not the same thing as
 * "the script supervisor typed an empty string" — downstream we treat both as unknown.
 *
 * @param {*} value raw parsed value
 * @returns {string|null} normalized value
 */
export function text(value) {
    if (value === undefined || value === null) return null;
    const s = String(value).trim();
    return s === '' ? null : s;
}

/**
 * Coerce a possibly-single parsed element into an array, dropping absent values.
 *
 * @param {*} value raw parsed value
 * @returns {Array} always an array
 */
export function list(value) {
    if (value === undefined || value === null || value === '') return [];
    return Array.isArray(value) ? value : [value];
}
