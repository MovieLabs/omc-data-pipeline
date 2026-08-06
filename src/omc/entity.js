import { omcIdentifier, omcTemplate } from 'omc-util';

import '../types.js'; // Type definitions, resolved globally by JSDoc

/**
 * Defaults for {@link DataPipeline.OmcOptions}. Every public method takes options and falls
 * back to these, so nothing depends on module state and one process can build entities for
 * several projects at once.
 * @memberof namespace:DataPipeline
 * @type {DataPipeline.OmcOptions}
 */
export const DEFAULT_OPTIONS = {
    identifierScope: 'movielabs.com',
    schemaVersion: 'https://movielabs.com/omc/json/schema/v3.0',
    seedNamespace: null,
};

/**
 * Fill in the option defaults.
 * @memberof namespace:DataPipeline
 * @function resolveOptions
 * @param {DataPipeline.OmcOptions} [options] - Caller-supplied options
 * @returns {DataPipeline.OmcOptions} Options with every member set
 */
export const resolveOptions = (options = {}) => ({ ...DEFAULT_OPTIONS, ...options });

/**
 * Build the seed an identifier is hashed from.
 *
 * The seed is what makes generation idempotent: the same source row always produces the same
 * identifier, so re-running updates the graph instead of duplicating it. It also lets an edge
 * point at an entity a later pass will build, because the target's identifier is computable
 * without the target existing.
 *
 * @memberof namespace:DataPipeline
 * @function seedFor
 * @param {Object} params
 * @param {string} params.entityType - The OMC entityType
 * @param {string} params.key - The value identifying the entity within its namespace
 * @param {string} [params.seedNamespace] - Namespace, keeping projects from colliding
 * @returns {string} The seed
 */
export function seedFor({ entityType, key, seedNamespace }) {
    return [seedNamespace, entityType, key].filter(Boolean).join('|');
}

/**
 * Drop values that carry no information, recursively.
 *
 * A source leaves a great many fields empty and OMC has no use for `""` or `{}` — an absent
 * property says the same thing without asserting that the production recorded a blank.
 *
 * @param {*} value - Value to prune
 * @returns {*} The value, or undefined when it is empty
 */
function prune(value) {
    if (value === null || value === undefined || value === '') return undefined;
    if (Array.isArray(value)) {
        const items = value.map(prune).filter((v) => v !== undefined);
        return items.length ? items : undefined;
    }
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            const pruned = prune(v);
            if (pruned !== undefined) out[k] = pruned;
        }
        return Object.keys(out).length ? out : undefined;
    }
    return value;
}

/**
 * The property names an entityType accepts, from the schema-derived shape plus the entity's
 * own intrinsic edges. The v3.0 schema sets `unevaluatedProperties: false`, so anything
 * outside this set makes the entity invalid.
 *
 * @param {string} entityType - OMC entity type
 * @param {string} schemaVersion - Schema version URL
 * @returns {Set<string>} Allowed property names
 */
function allowedProperties(entityType, schemaVersion) {
    const shape = omcTemplate.shape({ schemaVersion, entityType });
    if (!shape) throw new Error(`Unknown OMC entityType "${entityType}" for ${schemaVersion}`);
    const { intrinsic = {} } = omcTemplate.edgeTable({ schemaVersion, entityType }) ?? {};
    return new Set([...Object.keys(shape), ...Object.keys(intrinsic), 'edges']);
}

/**
 * Properties the schema requires and supplies a default for, that the caller did not set.
 *
 * `NarrativeScene.narrativeSceneType` is required and fixed at `narrativeScene`; an entity
 * without it fails validation. Since the schema states both the requirement and the value,
 * a mapping should not have to repeat it — and if a future version adds another such
 * property, this picks it up with no change here.
 *
 * @param {string} entityType - OMC entity type
 * @param {string} schemaVersion - Schema version URL
 * @param {Object} supplied - Properties the caller set
 * @returns {Object} The defaults to fill in
 */
function requiredDefaults(entityType, schemaVersion, supplied) {
    const shape = omcTemplate.shape({ schemaVersion, entityType });
    const defaults = {};
    for (const [key, spec] of Object.entries(shape)) {
        if (key === 'schemaVersion' || key === 'entityType') continue;
        if (spec?.$required && spec.$default !== undefined && supplied[key] === undefined) {
            defaults[key] = spec.$default;
        }
    }
    return defaults;
}

/**
 * Build an OMC entity with a deterministic identifier.
 *
 * The shape, the identifier prefix and the schema defaults all come from omcUtil — this
 * function holds no OMC knowledge of its own. Properties outside the entity's shape throw
 * here rather than failing validation later, so a mapping mistake names itself.
 *
 * @memberof namespace:DataPipeline
 * @function createEntity
 * @param {Object} params
 * @param {string} params.entityType - OMC entity type, e.g. `Slate`
 * @param {string} params.key - The value identifying this entity within its namespace
 * @param {Object} [params.properties] - OMC properties to set; empty ones are dropped
 * @param {DataPipeline.OmcOptions} [params.options] - Scope, schema version and namespace
 * @returns {OmcEntity} The OMC entity
 * @throws {Error} When a property is not in the entity's shape
 *
 * @example
 * createEntity({
 *     entityType: 'Slate',
 *     key: '3A-1',
 *     properties: { slateName: { fullName: '3A-1' }, cameraLabel: 'A' },
 *     options: { identifierScope: 'movielabs.com', seedNamespace: 'WWDOAT' },
 * });
 */
export function createEntity({
    entityType, key, properties = {}, options = {},
}) {
    const { identifierScope, schemaVersion, seedNamespace } = resolveOptions(options);

    const allowed = allowedProperties(entityType, schemaVersion);
    const unknown = Object.keys(properties).filter((k) => !allowed.has(k));
    if (unknown.length) {
        throw new Error(`${entityType} has no propert${unknown.length > 1 ? 'ies' : 'y'} `
            + `"${unknown.join('", "')}" in ${omcTemplate.versionLabel(schemaVersion)}`);
    }

    return {
        schemaVersion,
        entityType,
        identifier: [omcIdentifier.idHash({
            identifierScope,
            seed: seedFor({ entityType, key, seedNamespace }),
            entityType,
            prefix: true,
            schemaVersion,
        })],
        ...requiredDefaults(entityType, schemaVersion, properties),
        ...prune(properties) ?? {},
    };
}

/**
 * An identifier-only reference to an entity, for pointing at something this pass does not
 * build. Seeded exactly as {@link createEntity} seeds it, so the reference resolves once
 * that entity is built, with no rework.
 *
 * @memberof namespace:DataPipeline
 * @function entityRef
 * @param {Object} params
 * @param {string} params.entityType - The OMC entityType being referenced
 * @param {string} params.key - The referenced entity's key
 * @param {DataPipeline.OmcOptions} [params.options] - Scope, schema version and namespace
 * @returns {OmcEntity} An entity stub carrying only entityType and identifier
 */
export function entityRef({ entityType, key, options = {} }) {
    const { identifierScope, schemaVersion, seedNamespace } = resolveOptions(options);
    return {
        schemaVersion,
        entityType,
        identifier: [omcIdentifier.idHash({
            identifierScope,
            seed: seedFor({ entityType, key, seedNamespace }),
            entityType,
            prefix: true,
            schemaVersion,
        })],
    };
}
