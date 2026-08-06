import { omcTemplate } from 'omc-util';

import '../types.js'; // Type definitions, resolved globally by JSDoc

import { resolveOptions } from './entity.js';

/**
 * Walk a schema-derived shape to see whether a dotted property path exists on it.
 *
 * @param {Object} shape - The shape from `omcTemplate.shape`
 * @param {string} path - Dotted property path, e.g. `slateName.fullName`
 * @returns {boolean} True when the path resolves
 */
function shapeAtPath(shape, path) {
    let node = shape;
    for (const segment of path.split('.')) {
        if (!node || typeof node !== 'object') return undefined;
        // An array-of-objects property describes its members under `$items`.
        node = node[segment] ?? node.$items?.[segment];
        if (node === undefined) return undefined;
    }
    return node;
}

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
export function checkMappings({ mappings, options = {} }) {
    const { schemaVersion } = resolveOptions(options);
    const problems = [];

    const knownTypes = new Set(omcTemplate.allEntityTypes({ schemaVersion }));

    for (const mapping of mappings) {
        const { entityType } = mapping;

        if (!knownTypes.has(entityType)) {
            problems.push({
                kind: 'unknownEntityType',
                where: entityType,
                detail: `not an entityType in ${omcTemplate.versionLabel(schemaVersion)}`,
            });
            continue;
        }

        const shape = omcTemplate.shape({ schemaVersion, entityType });
        const edgeTable = omcTemplate.edgeTable({ schemaVersion, entityType }) ?? {};
        const allEdges = { ...edgeTable.intrinsic, ...edgeTable.edges };

        const paths = [
            ...Object.keys(mapping.properties ?? {}),
            ...Object.keys(mapping.notes ?? {}),
        ];
        for (const path of paths) {
            const node = shapeAtPath(shape, path);
            if (node === undefined) {
                problems.push({
                    kind: 'unknownProperty',
                    where: `${entityType}.${path}`,
                    detail: `no such property in ${omcTemplate.versionLabel(schemaVersion)}`,
                });
                continue;
            }

            // A fixed value can be checked against the schema's controlled list here, which
            // catches a typo before any data is read rather than as a validation failure at
            // the end of a run.
            const spec = mapping.properties?.[path];
            const fixed = typeof spec === 'object' ? spec.const : undefined;
            if (fixed !== undefined && Array.isArray(node.$controlledValues)
                && !node.$controlledValues.includes(fixed)) {
                problems.push({
                    kind: 'valueNotAllowed',
                    where: `${entityType}.${path}`,
                    detail: `"${fixed}" is not among the ${node.$controlledValues.length} values `
                        + `${omcTemplate.versionLabel(schemaVersion)} allows`,
                });
            }
        }

        for (const edge of mapping.edges ?? []) {
            const permitted = Object.values(allEdges).some((e) => e.allowed.includes(edge.to));
            if (!permitted) {
                problems.push({
                    kind: 'edgeNotAllowed',
                    where: `${entityType} → ${edge.to}`,
                    detail: `${omcTemplate.versionLabel(schemaVersion)} allows no edge from `
                        + `${entityType} to ${edge.to}`,
                });
            }
        }
    }

    return {
        valid: problems.length === 0,
        schemaVersion,
        checked: {
            entityTypes: mappings.map((m) => m.entityType),
            properties: mappings.reduce((n, m) => n
                + Object.keys(m.properties ?? {}).length + Object.keys(m.notes ?? {}).length, 0),
            edges: mappings.reduce((n, m) => n + (m.edges ?? []).length, 0),
        },
        problems,
    };
}
