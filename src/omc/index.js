/**
 * The generic OMC layer: build entities from a tabular interim format and declarative
 * mappings, validate them, and write a bundle. Knows nothing about any data source.
 * @memberof namespace:DataPipeline
 */

import '../types.js'; // Type definitions, resolved globally by JSDoc

export { buildEntities } from './build.js';
export { checkMappings } from './checkMapping.js';
export {
    createEntity, entityRef, seedFor, resolveOptions, DEFAULT_OPTIONS,
} from './entity.js';
export {
    writeBundle, sealBundle, validationFailureMessage, validateEntities, checkEdgeTargets,
} from './bundle.js';
export { renderOmcReport } from './report.js';
