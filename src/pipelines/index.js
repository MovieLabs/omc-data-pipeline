/**
 * The pipeline layer: a registry of self-describing pipelines, and the machinery to check a
 * run request against one and run it.
 *
 * A pipeline declares what files it takes and what settings it accepts, and reads its inputs
 * through a {@link DataPipeline.PipelineContext} rather than opening them itself. That is what
 * lets the same pipeline run from the CLI, from a test harness against committed fixtures, and
 * from a service reading object storage, with no branch anywhere in the pipeline.
 *
 * @memberof namespace:DataPipeline
 */

import '../types.js'; // Type definitions, resolved globally by JSDoc

export {
    pipelines, getPipeline, catalog, runPipeline,
} from './registry.js';
export { createContext, fsContext } from './context.js';
export { checkRunRequest, inputForRole, inputsForRole } from './request.js';
