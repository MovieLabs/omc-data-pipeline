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
export function parseSim(source: (string | Buffer), label?: string): object;
/**
 * Parse a SIM Metabanq export read from a file.
 *
 * @param {string} filePath absolute path to the SIM Metabanq XML
 * @returns {Promise<object>} normalized day model, including an `anomalies` list
 */
export function parseSimFile(filePath: string): Promise<object>;
//# sourceMappingURL=parseSim.d.ts.map