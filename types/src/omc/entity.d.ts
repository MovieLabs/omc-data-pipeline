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
export function seedFor({ entityType, key, seedNamespace }: {
    entityType: string;
    key: string;
    seedNamespace?: string;
}): string;
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
export function createEntity({ entityType, key, properties, options, }: {
    entityType: string;
    key: string;
    properties?: any;
    options?: DataPipeline.OmcOptions;
}): OmcEntity;
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
export function entityRef({ entityType, key, options }: {
    entityType: string;
    key: string;
    options?: DataPipeline.OmcOptions;
}): OmcEntity;
/**
 * Defaults for {@link DataPipeline.OmcOptions}. Every public method takes options and falls
 * back to these, so nothing depends on module state and one process can build entities for
 * several projects at once.
 * @memberof namespace:DataPipeline
 * @type {DataPipeline.OmcOptions}
 */
export const DEFAULT_OPTIONS: DataPipeline.OmcOptions;
export function resolveOptions(options?: DataPipeline.OmcOptions): DataPipeline.OmcOptions;
//# sourceMappingURL=entity.d.ts.map