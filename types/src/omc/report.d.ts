/**
 * Render the OMC generation report.
 *
 * Generic: everything it says about the mapping is read from the mappings themselves, so a
 * new source gets a correct report without writing one.
 *
 * @memberof namespace:DataPipeline
 * @function renderOmcReport
 * @param {Object} params
 * @param {DataPipeline.BuildResult} params.result - Output of {@link buildEntities}
 * @param {DataPipeline.BundleResult} params.bundle - Output of {@link writeBundle}
 * @param {Array<DataPipeline.EntityMapping>} params.mappings - The mappings applied
 * @param {DataPipeline.MappingCheck} [params.check] - Output of {@link checkMappings}
 * @param {string} [params.title] - Heading for the report
 * @returns {string} A Markdown document
 */
export function renderOmcReport({ result, bundle, mappings, check, title, }: {
    result: DataPipeline.BuildResult;
    bundle: DataPipeline.BundleResult;
    mappings: Array<DataPipeline.EntityMapping>;
    check?: DataPipeline.MappingCheck;
    title?: string;
}): string;
//# sourceMappingURL=report.d.ts.map