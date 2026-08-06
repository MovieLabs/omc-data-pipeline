/**
 * Run the full three-way fidelity check for one filming day.
 *
 * @param {object} sim normalized model from {@link parseSim}
 * @param {object[]} editorLogTakes take rows from {@link parseEditorLogXml}
 * @param {object} silverStack result of {@link parseSilverStack}
 * @returns {object} machine-readable fidelity report
 */
export function validateDay(sim: object, editorLogTakes: object[], silverStack: object, delivered?: {}): object;
/**
 * Render the fidelity report as Markdown for humans.
 *
 * @param {object} report output of {@link validateDay}
 * @param {{production: string, source: string, day: (string|number)}} selection what was checked
 * @returns {string} Markdown document
 */
export function renderFidelityReport(report: object, selection: {
    production: string;
    source: string;
    day: (string | number);
}): string;
//# sourceMappingURL=validate.d.ts.map