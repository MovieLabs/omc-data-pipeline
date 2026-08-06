/**
 * Check a run request against a pipeline's declared inputs and options, and fill in defaults.
 *
 * Everything a caller can get wrong is caught here, before a single byte is read: a missing
 * required file, a role the pipeline does not have, too many files, an option that will not
 * coerce. Problems use the same `{kind, where, detail}` triple as every other diagnostic in
 * this package, so a caller renders them the same way.
 *
 * @memberof namespace:DataPipeline
 * @function checkRunRequest
 * @param {DataPipeline.PipelineRunRequest} request - The request to check
 * @param {DataPipeline.PipelineDefinition} definition - The pipeline it names
 * @returns {{valid: boolean, problems: Array<DataPipeline.MappingNote>,
 *   request: DataPipeline.PipelineRunRequest}} The outcome, and the request with option
 *   defaults applied and values coerced
 */
export function checkRunRequest(request: DataPipeline.PipelineRunRequest, definition: DataPipeline.PipelineDefinition): {
    valid: boolean;
    problems: Array<DataPipeline.MappingNote>;
    request: DataPipeline.PipelineRunRequest;
};
/**
 * The inputs assigned one role, in the order the caller supplied them.
 *
 * A convenience for pipelines, which almost always want either the single file playing a role
 * or every file playing it.
 *
 * @memberof namespace:DataPipeline
 * @function inputsForRole
 * @param {DataPipeline.PipelineRunRequest} request - The run request
 * @param {string} role - The role to select
 * @returns {Array<DataPipeline.PipelineInput>} The matching inputs
 */
export function inputsForRole(request: DataPipeline.PipelineRunRequest, role: string): Array<DataPipeline.PipelineInput>;
/**
 * The single input assigned one role.
 *
 * @memberof namespace:DataPipeline
 * @function inputForRole
 * @param {DataPipeline.PipelineRunRequest} request - The run request
 * @param {string} role - The role to select
 * @returns {(DataPipeline.PipelineInput|null)} The input, or null when none has that role
 */
export function inputForRole(request: DataPipeline.PipelineRunRequest, role: string): (DataPipeline.PipelineInput | null);
//# sourceMappingURL=request.d.ts.map