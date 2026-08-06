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
export function parseSilverStack(source: (string | Buffer)): {
    takes: object[];
    parseErrors: object[];
};
/**
 * Parse a SilverStack camera-log CSV read from a file.
 *
 * @param {string} filePath absolute path to the SilverStack CSV
 * @returns {Promise<{takes: object[], parseErrors: object[]}>} take rows and parser complaints
 */
export function parseSilverStackFile(filePath: string): Promise<{
    takes: object[];
    parseErrors: object[];
}>;
//# sourceMappingURL=parseSilverStack.d.ts.map