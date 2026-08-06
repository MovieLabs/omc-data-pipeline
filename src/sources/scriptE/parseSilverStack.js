import { readFile } from 'node:fs/promises';

import { parseCsv } from '../../lib/csv.js';

import { CSV_UNMAPPED, splitSlate, TAKE_FIELDS } from './fieldMap.js';

/**
 * Parse the SilverStack camera-log CSV into take rows.
 *
 * Like the Editor Log XML this is a cross-check source, not an extraction source: it is a
 * column subset of SIM Metabanq produced by a different tool, which makes it a useful
 * independent witness for the values the two share.
 *
 * @param {(string|Buffer)} source the CSV text, or its bytes
 * @returns {{takes: object[], parseErrors: object[]}} take rows and parser complaints
 */
export function parseSilverStack(source) {
    const { rows, errors } = parseCsv(source);

    const takes = rows.map((row) => {
        const take = {};
        for (const { key, csv } of TAKE_FIELDS) {
            if (csv) take[key] = row[csv] ?? null;
        }
        Object.assign(take, splitSlate(take.slate));
        take.narrativeScene = row.Scene ?? null;
        for (const col of CSV_UNMAPPED) take[col] = row[col] ?? null;
        return take;
    });

    return { takes, parseErrors: errors };
}

/**
 * Parse a SilverStack camera-log CSV read from a file.
 *
 * @param {string} filePath absolute path to the SilverStack CSV
 * @returns {Promise<{takes: object[], parseErrors: object[]}>} take rows and parser complaints
 */
export async function parseSilverStackFile(filePath) {
    return parseSilverStack(await readFile(filePath, 'utf8'));
}
