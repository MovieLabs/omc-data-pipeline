/**
 * Tools that read heterogeneous production data sources — PDFs, XML, spreadsheets — and
 * prepare them for ingestion into OMC-JSON workflows.
 *
 * The package is layered so each part can be taken on its own. An API that already has
 * tabular data needs only {@link namespace:DataPipeline.buildEntities} and
 * {@link namespace:DataPipeline.writeBundle}; a tool ingesting a specific supplier's
 * delivery adds that source's adapter; a tool doing its own I/O can use `lib` alone.
 *
 * - `pipelines` — the uniform way in. A registry of self-describing pipelines, each declaring
 *   the files and settings it takes, run through a {@link DataPipeline.PipelineContext} that
 *   decides where bytes come from. A caller can offer and run a pipeline it knows nothing
 *   about.
 * - `omc` — generic. Turns a {@link DataPipeline.TableSet} plus declarative
 *   {@link DataPipeline.EntityMapping}s into validated OMC entities. Knows no sources.
 * - `sources` — one adapter per supplier. Reads a delivery, emits tables in OMC
 *   terminology, and declares its mapping as data. Knows no OMC construction.
 * - `lib` — format helpers for XML, CSV and workbooks. Knows neither.
 *
 * Every OMC fact — shapes, edge paths, inverses, identifier prefixes, validation — is asked
 * of `omc-util`. This package maintains no tables of OMC entity types, edge keys or
 * cardinality of its own.
 *
 * @namespace DataPipeline
 */

import './src/types.js'; // Type definitions, resolved globally by JSDoc

export * as pipelines from './src/pipelines/index.js';
export * as omc from './src/omc/index.js';
export * as sources from './src/sources/index.js';
export * as lib from './src/lib/index.js';

// The most commonly used entry points, re-exported flat for convenience.
export {
    catalog, getPipeline, runPipeline, createContext, fsContext,
} from './src/pipelines/index.js';
export { buildEntities } from './src/omc/build.js';
export { checkMappings } from './src/omc/checkMapping.js';
export { createEntity, entityRef, DEFAULT_OPTIONS } from './src/omc/entity.js';
export {
    writeBundle, sealBundle, validateEntities, checkEdgeTargets,
} from './src/omc/bundle.js';
export { renderOmcReport } from './src/omc/report.js';
