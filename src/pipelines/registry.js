import frameio from '../sources/frameio/pipeline.js';
import scriptE from '../sources/scriptE/pipeline.js';
import yamdu from '../sources/yamdu/pipeline.js';

import { createContext } from './context.js';
import { checkRunRequest } from './request.js';
import '../types.js'; // Type definitions, resolved globally by JSDoc

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
export const pipelines = [scriptE, yamdu, frameio];

const byId = new Map(pipelines.map((p) => [p.pipelineId, p]));

/**
 * Look up a pipeline by id.
 *
 * @memberof namespace:DataPipeline
 * @function getPipeline
 * @param {string} pipelineId - The id to look up
 * @returns {(DataPipeline.PipelineDefinition|null)} The definition, or null when unknown
 */
export function getPipeline(pipelineId) {
    return byId.get(pipelineId) ?? null;
}

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
export function catalog({ schemaVersion } = {}) {
    return pipelines
        .filter((p) => !schemaVersion || p.schemaVersions.includes(schemaVersion))
        .map(({ run: _run, ...rest }) => rest);
}

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
export async function runPipeline(request, context = createContext()) {
    const definition = getPipeline(request.pipelineId);
    if (!definition) {
        throw new Error(`Unknown pipeline "${request.pipelineId}". `
            + `Available: ${pipelines.map((p) => p.pipelineId).join(', ')}`);
    }

    const check = checkRunRequest(request, definition);
    if (!check.valid) {
        const detail = check.problems.map((p) => `  ${p.kind}: ${p.detail}`);
        throw new Error([`Cannot run ${definition.pipelineId}:`, ...detail].join('\n'));
    }

    return definition.run(check.request, context);
}
