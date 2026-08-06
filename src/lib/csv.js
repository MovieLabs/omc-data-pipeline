import { readFile } from 'node:fs/promises';

import Papa from 'papaparse';

/**
 * Parse delimited text into row objects keyed by header name.
 * Values stay as strings for the same reasons as {@link parseXml}; blanks become `null`.
 *
 * @param {(string|Buffer)} source CSV text, or its bytes
 * @returns {{rows: object[], errors: object[]}} rows and any parser complaints
 */
export function parseCsv(source) {
    const raw = typeof source === 'string' ? source : source.toString('utf8');
    const { data, errors } = Papa.parse(raw, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        transform: (v) => {
            const s = v.trim();
            return s === '' ? null : s;
        },
    });
    return { rows: data, errors };
}

/**
 * Parse a delimited source file into row objects keyed by header name.
 *
 * @param {string} filePath absolute path to the CSV file
 * @returns {Promise<{rows: object[], errors: object[]}>} rows and any parser complaints
 */
export async function parseCsvFile(filePath) {
    return parseCsv(await readFile(filePath, 'utf8'));
}

/**
 * Serialize rows to CSV text using the union of keys across all rows as the header,
 * so a field that is null in the first row still gets a column.
 *
 * @param {object[]} rows rows to serialize
 * @returns {string} CSV text with a trailing newline
 */
export function toCsv(rows) {
    const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    return `${Papa.unparse(rows, { columns })}\n`;
}
