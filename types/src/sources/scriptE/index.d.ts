/**
 * Extract one filming day into the normalized model, per-table CSVs and a workbook.
 *
 * @param {{sourceDir: string, outDir: string, day: (string|number)}} opts resolved selection
 * @returns {Promise<{model: object, tables: object, written: string[]}>} extraction result
 */
export function extract({ sourceDir, outDir, day }: {
    sourceDir: string;
    outDir: string;
    day: (string | number);
}): Promise<{
    model: object;
    tables: object;
    written: string[];
}>;
/**
 * Cross-check the SIM Metabanq export against the Editor Log XML and SilverStack CSV.
 *
 * @param {{sourceDir: string, outDir: string, day: (string|number), production: string, source: string}} opts selection
 * @returns {Promise<{report: object, summary: string[], written: string[]}>} fidelity result,
 *   a caller-printable summary, and the paths written
 */
export function validate({ sourceDir, outDir, day, production, source }: {
    sourceDir: string;
    outDir: string;
    day: (string | number);
    production: string;
    source: string;
}): Promise<{
    report: object;
    summary: string[];
    written: string[];
}>;
/**
 * Map several filming days onto an OMC-JSON bundle.
 *
 * The route runs source → interim tables → OMC, the same tables written to `processedData`.
 * Nothing here builds an entity: {@link buildEntities} does that generically, driven by the
 * declarative {@link omcMappings}.
 *
 * @memberof namespace:DataPipeline
 * @function omc
 * @param {Object} params
 * @param {Array<{sourceDir: string}>} params.days - Source directories, in shoot order
 * @param {string} params.omcDir - Destination directory for the bundle
 * @param {DataPipeline.OmcOptions} [params.options] - Scope, schema version and namespace.
 *   `seedNamespace` defaults to the production name found in the data.
 * @returns {Promise<{result: DataPipeline.BuildResult, bundle: DataPipeline.BundleResult, written: Array<string>}>}
 *   The build result, the bundle result and the paths written
 */
export function omc({ days, omcDir, options }: {
    days: Array<{
        sourceDir: string;
    }>;
    omcDir: string;
    options?: DataPipeline.OmcOptions;
}): Promise<{
    result: DataPipeline.BuildResult;
    bundle: DataPipeline.BundleResult;
    written: Array<string>;
}>;
export const name: "Script-E";
//# sourceMappingURL=index.d.ts.map