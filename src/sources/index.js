/**
 * Source adapters. Each reads one supplier's delivery and emits a
 * {@link DataPipeline.TableSet} in OMC terminology, plus a declarative
 * {@link DataPipeline.EntityMapping} describing how those tables become entities.
 *
 * Adding a source means adding a directory here and listing it below, plus a `pipeline.js`
 * registered in `src/pipelines/registry.js`. No OMC code is involved: the mapping is data,
 * applied by the generic builder.
 *
 * What is exported here is each source's own surface — its parsers, its mapping, and the
 * directory-driven `extract` / `validate` / `omc` commands the CLI uses. The uniform,
 * caller-driven way in is {@link namespace:DataPipeline.runPipeline}.
 * @memberof namespace:DataPipeline
 */

import '../types.js'; // Type definitions, resolved globally by JSDoc

export * as scriptE from './scriptE/index.js';
export { omcMappings as scriptEMappings } from './scriptE/omcMapping.js';
