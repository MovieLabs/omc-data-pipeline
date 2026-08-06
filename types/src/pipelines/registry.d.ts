/**
 * Look up a pipeline by id.
 *
 * @memberof namespace:DataPipeline
 * @function getPipeline
 * @param {string} pipelineId - The id to look up
 * @returns {(DataPipeline.PipelineDefinition|null)} The definition, or null when unknown
 */
export function getPipeline(pipelineId: string): (DataPipeline.PipelineDefinition | null);
/**
 * Everything a caller needs to offer these pipelines, with the implementations stripped out.
 *
 * `run` is a function and does not survive JSON, so it is dropped rather than left to
 * disappear silently in transit. What remains is exactly what a picker needs.
 *
 * @memberof namespace:DataPipeline
 * @function catalog
 * @param {Object} [params]
 * @param {string} [params.schemaVersion] - List only pipelines that can build this version
 * @returns {Array<Object>} The definitions, without `run`
 */
export function catalog({ schemaVersion }?: {
    schemaVersion?: string;
}): Array<any>;
/**
 * Run a pipeline.
 *
 * The request is checked against the pipeline's own declarations first, so a caller learns
 * that a required file is missing before any bytes are read rather than partway through.
 *
 * @memberof namespace:DataPipeline
 * @function runPipeline
 * @param {DataPipeline.PipelineRunRequest} request - What to run, and with what
 * @param {DataPipeline.PipelineContext} [context] - Where bytes come from and progress goes.
 *   A context with no `read` is built when none is given, which is only useful for a pipeline
 *   that takes no files.
 * @returns {Promise<DataPipeline.PipelineRunResult>} The OMC, the notes and the report
 * @throws {Error} When the pipeline is unknown or the request does not fit it
 */
export function runPipeline(request: DataPipeline.PipelineRunRequest, context?: DataPipeline.PipelineContext): Promise<DataPipeline.PipelineRunResult>;
/**
 * Every pipeline this package offers.
 *
 * A new pipeline is added here and nowhere else: callers discover it through
 * {@link namespace:DataPipeline.catalog} and run it through
 * {@link namespace:DataPipeline.runPipeline}, so nothing downstream needs a code change to
 * pick it up.
 *
 * @memberof namespace:DataPipeline
 * @type {Array<DataPipeline.PipelineDefinition>}
 */
export const pipelines: Array<DataPipeline.PipelineDefinition>;
//# sourceMappingURL=registry.d.ts.map