/**
 * Build OMC entities from a tabular interim format and a set of declarative mappings.
 *
 * This is the generic half of the pipeline. It knows nothing about any source: the mappings
 * are data, and every OMC fact — shapes, edge paths, inverses, identifier prefixes — is
 * asked of omcUtil. A new source needs a parser that emits tables and a mapping that
 * describes them; it needs no OMC code.
 *
 * Entities are built before edges so that an edge can point at any entity in the set,
 * whichever order the mappings are declared in.
 *
 * @memberof namespace:DataPipeline
 * @function buildEntities
 * @param {Object} params
 * @param {DataPipeline.TableSet} params.tables - The interim tables
 * @param {Array<DataPipeline.EntityMapping>} params.mappings - What to build
 * @param {DataPipeline.OmcOptions} [params.options] - Scope, schema version and namespace
 * @returns {DataPipeline.BuildResult} Entities by type, notes and counts
 *
 * @example
 * buildEntities({
 *     tables,
 *     mappings: scriptE.omcMappings,
 *     options: { identifierScope: 'movielabs.com', seedNamespace: 'WWDOAT' },
 * });
 */
export function buildEntities({ tables, mappings, options }: {
    tables: DataPipeline.TableSet;
    mappings: Array<DataPipeline.EntityMapping>;
    options?: DataPipeline.OmcOptions;
}): DataPipeline.BuildResult;
//# sourceMappingURL=build.d.ts.map