/**
 * Check a set of mappings against a schema version before any data is read.
 *
 * The mappings are the only place this package names OMC properties, so they are the only
 * thing a schema change can invalidate. Everything else — shapes, edge paths, inverses,
 * identifier prefixes, validation — is asked of omcUtil per call, for whichever
 * `schemaVersion` the caller supplies.
 *
 * That makes a version bump a two-step job rather than a hunt: point `schemaVersion` at the
 * new version, run this, and it names every property and edge the new schema no longer
 * accepts. Without it the same problems surface later and less clearly — a renamed property
 * as a thrown error partway through a run, a removed edge as a silently missing
 * relationship, because `edgeCreate` returns null for an edge the schema does not allow.
 *
 * @memberof namespace:DataPipeline
 * @function checkMappings
 * @param {Object} params
 * @param {Array<DataPipeline.EntityMapping>} params.mappings - The mappings to check
 * @param {DataPipeline.OmcOptions} [params.options] - Supplies the `schemaVersion` to check against
 * @returns {DataPipeline.MappingCheck} Problems found, and what was checked
 *
 * @example
 * const check = checkMappings({ mappings, options: { schemaVersion: V2_8 } });
 * if (!check.valid) console.error(check.problems);
 */
export function checkMappings({ mappings, options }: {
    mappings: Array<DataPipeline.EntityMapping>;
    options?: DataPipeline.OmcOptions;
}): DataPipeline.MappingCheck;
//# sourceMappingURL=checkMapping.d.ts.map