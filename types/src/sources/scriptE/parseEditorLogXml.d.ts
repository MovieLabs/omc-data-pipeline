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
export function parseEditorLogXml(source: (string | Buffer), label?: string): {
    production: object;
    takes: object[];
};
/**
 * Parse an Editor Log XML read from a file.
 *
 * @param {string} filePath absolute path to the Editor Log XML
 * @returns {Promise<{production: object, takes: object[]}>} header and take rows
 */
export function parseEditorLogXmlFile(filePath: string): Promise<{
    production: object;
    takes: object[];
}>;
//# sourceMappingURL=parseEditorLogXml.d.ts.map