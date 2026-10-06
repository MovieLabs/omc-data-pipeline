import { omcEdges, omcMerge, omcTemplate } from 'omc-util';
// The per-value rules are shared with omc-util's row-oriented interpreter rather than kept in two
// places: a cast is a cast, and a delimited cell splits the same way whoever is reading it.
// `writeShaped` replaces a naive dotted-path writer this file used to carry — see setPath below.
import { cast, identityColumn, splitList, writeShaped } from 'omc-util/mapping';

import '../types.js'; // Type definitions, resolved globally by JSDoc

import { createEntity, entityRef, resolveOptions } from './entity.js';

/**
 * Write a property path into an object, placing it as the schema says.
 *
 * This replaced a dotted-path writer that created plain objects the whole way down. That was wrong
 * wherever OMC declares an array: `annotation.title` produced `{annotation: {title}}`, which the
 * schema rejects, and there was no way at all to address a second element. `writeShaped` asks the
 * shape, so an array-of-object property becomes an array, sibling sub-paths merge into one element,
 * and `annotation[1].title` addresses what it says.
 *
 * @param {Object} target - The properties object being built
 * @param {string} path - Dotted path, optionally with `[n]` indices
 * @param {*} value - The value to write
 * @param {Object} shape - The entity's shape, from `omcTemplate.shape`
 */
function setPath(target, path, value, shape) {
    writeShaped(target, path.split('.'), value, shape);
}

/**
 * Resolve one property mapping against the rows an entity is built from.
 *
 * `rows` is a single row for a `row` grain and the whole group for a `group` grain, which is
 * what makes `when: 'unanimous'` expressible: a property is only true of a group when none
 * of its rows disagree.
 *
 * @param {DataPipeline.PropertyMapping} mapping - The mapping
 * @param {DataPipeline.Table} rows - Rows the entity is built from
 * @param {DataPipeline.TableSet} tables - All tables, for lookups
 * @returns {DataPipeline.ResolvedProperty} The value, or why it was withheld
 */
function resolveProperty(mapping, rows, tables) {
    const spec = typeof mapping === 'string' ? { from: mapping } : mapping;
    const {
        from, as, split, when, lookup,
    } = spec;

    // A fixed value is a decision the mapping makes, not something the source says.
    if (spec.const !== undefined) return { value: spec.const, withheld: null };

    const present = rows.map((r) => r[from]).filter((v) => v !== null && v !== undefined && v !== '');
    if (!present.length) return { value: null, withheld: null };

    if (when === 'unanimous') {
        const distinct = new Set(present);
        if (distinct.size > 1) {
            return {
                value: null,
                withheld: `${distinct.size} different values of "${from}" across ${rows.length} rows`,
            };
        }
    }

    let value = present[0];

    if (split) {
        const members = splitList(value, split);
        if (when === 'single' && members.length !== 1) {
            return {
                value: null,
                withheld: `"${from}" holds ${members.length} values (${members.join(', ')}); `
                    + 'no single value applies',
            };
        }
        value = members.length === 1 ? members[0] : members.join(', ');
    }

    if (lookup) {
        const row = (tables[lookup.table] ?? []).find((r) => String(r[lookup.on]) === String(value));
        value = row ? row[lookup.select] : null;
        if (value === null || value === undefined) return { value: null, withheld: null };
    }

    return { value: as ? cast(value, as) : value, withheld: null };
}

/**
 * Build a note-shaped property — an array of `{author, title, text}`.
 *
 * OMC uses that shape for more than `annotation`: `NarrativeScene.slugline` has it too. One
 * construct covers them all, so a mapping names the property rather than the builder
 * hard-coding which properties are note-shaped.
 *
 * @param {Array<{title: string, from: string, author: string}>} entries - Note mappings
 * @param {Object} row - The row
 * @returns {Array<Object>} The notes, empty ones dropped
 */
const buildNotes = (entries, row) => (entries ?? [])
    .map(({ title, author, from }) => ({ author, title, text: row[from] }))
    .filter((n) => n.text !== null && n.text !== undefined && n.text !== '')
    .map((n) => Object.fromEntries(Object.entries(n).filter(([, v]) => v !== undefined)));

/**
 * Build the customData array: the source's own key/value pairs under its own column names.
 *
 * A column is only carried when every row behind the entity agrees on its value. For a `row`
 * grain that is trivially true. For a `group` grain it is the whole point: a production scene
 * covered by sixteen takes has no clip number or timecode of its own, and copying the first
 * take's values onto the scene would state as fact something the source never said. What
 * varies across the group belongs to the rows, and is already carried by the entities built
 * from them.
 *
 * @param {DataPipeline.CustomDataMapping} mapping - The catch-all mapping
 * @param {DataPipeline.Table} rows - The rows behind this entity
 * @param {Set<string>} consumed - Columns already carried by a real OMC property
 * @returns {Array<OmcCustomData>} A one-element array, or an empty one
 */
function buildCustomData(mapping, rows, consumed) {
    if (!mapping) return [];
    const {
        domain, namespace, schema, rest, exclude = [], include = null,
    } = mapping;
    if (!rest) return [];
    const skip = new Set([...consumed, ...exclude]);
    // An allow-list, for the case `exclude` answers badly: where two entities are built from one
    // wide table, saying which columns an entity takes is one list, while saying which it refuses
    // is that list's complement — and the complement has to be extended every time the source grows
    // a field, silently mis-filing it until someone notices. With `include` set, a new column lands
    // on whichever entity did not name one, which is the safer default.
    const allowed = include ? new Set(include) : null;

    const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))]
        .filter((k) => !skip.has(k) && (!allowed || allowed.has(k)));

    const isPresent = (v) => v !== null && v !== undefined && v !== '';

    const value = {};
    for (const column of columns) {
        // Present on *every* row, not merely un-contradicted by the rows that have it. One
        // take's technical note is a fact about that take; it does not become a fact about
        // the scene just because the other fifteen takes left the column blank.
        if (!rows.every((r) => isPresent(r[column]))) continue;
        if (new Set(rows.map((r) => JSON.stringify(r[column]))).size !== 1) continue;
        value[column] = rows[0][column];
    }

    if (!Object.keys(value).length) return [];
    return [{
        ...(domain ? { domain } : {}),
        ...(namespace ? { namespace } : {}),
        ...(schema ? { schema } : {}),
        value,
    }];
}

/** Group rows by the value of a column, preserving first-seen order. */
function groupRows(rows, key, skipWhenKeyEmpty) {
    const groups = new Map();
    for (const row of rows) {
        const value = row[key];
        if (value === null || value === undefined || value === '') {
            if (skipWhenKeyEmpty) continue;
            throw new Error(`Row has no value for key column "${key}"`);
        }
        if (!groups.has(String(value))) groups.set(String(value), []);
        groups.get(String(value)).push(row);
    }
    return groups;
}

/**
 * The rows behind each entity of a mapping, whichever grain it declares.
 *
 * At `group` grain a key's rows are resolved together — one scene from sixteen takes. At `row` grain
 * each row builds its own entity, and rows sharing a key are folded afterwards; they are still
 * collected per key here because an entity's edges are drawn from every row that describes it.
 *
 * @param {DataPipeline.EntityMapping} mapping - The mapping
 * @param {DataPipeline.Table} rows - Its table
 * @returns {Map<string, DataPipeline.Table>} Rows by key value
 */
function rowsByKey(mapping, rows) {
    const { grain = 'row', skipWhenKeyEmpty = false } = mapping;
    // Whatever identifies the entity, which is not always `key`: one that maps a column onto
    // `identifier[0].identifierValue` names itself and needs none. Asked rather than read, so this
    // agrees with the reference an edge records — join on one column and group by another and the
    // lookup finds nothing. Read straight off `.key`, a key-less mapping grouped every row under
    // "undefined" and produced a single entity for the whole table.
    const key = identityColumn(mapping);
    if (grain === 'group') return groupRows(rows, key, skipWhenKeyEmpty);
    const groups = new Map();
    for (const row of rows) {
        const value = row[key];
        if (skipWhenKeyEmpty && (value === null || value === undefined || value === '')) continue;
        const asKey = String(value);
        if (!groups.has(asKey)) groups.set(asKey, []);
        groups.get(asKey).push(row);
    }
    return groups;
}

/**
 * Columns a mapping consumes as real OMC properties, so `customData.rest` does not repeat
 * them. Lookup sources are not consumed: the column feeding a lookup is a join key, and the
 * source's own value for it is still worth carrying.
 *
 * @param {DataPipeline.EntityMapping} mapping - The mapping
 * @returns {Set<string>} Consumed column names
 */
function consumedColumns(mapping) {
    const columns = new Set();
    for (const spec of Object.values(mapping.properties ?? {})) {
        const source = typeof spec === 'string' ? { from: spec } : spec;
        if (!source.lookup) columns.add(source.from);
    }
    for (const entries of Object.values(mapping.notes ?? {})) {
        entries.forEach(({ from }) => columns.add(from));
    }
    return columns;
}

/**
 * Fold one mapping's entities into the registry, merging where an entity already exists.
 *
 * Two mappings may build the same entityType from different tables — one row per file describing an
 * Asset, one row per comment adding an annotation to it. They agree on the entity because they seed
 * the identifier from the same key, so the second must *add to* the first rather than replace it.
 *
 * `mergeEntity` is what makes that safe: it unions arrays by value, so distinct annotations
 * accumulate while an identical one collapses — which is also why a re-run does not duplicate them.
 * `prefer: 'existing'` means the first mapping to state a property owns it; a later mapping fills
 * gaps and cannot overwrite.
 *
 * @param {Map<string, Map<string, OmcEntity>>} registry - Built entities, by type then key
 * @param {string} entityType - The type this mapping built
 * @param {Map<string, OmcEntity>} entities - What it built, by key
 * @param {Array<DataPipeline.MappingNote>} notes - Appended to in place
 */
function mergeInto(registry, entityType, entities, notes) {
    const existing = registry.get(entityType);
    if (!existing) {
        registry.set(entityType, entities);
        return;
    }
    for (const [key, entity] of entities) {
        const held = existing.get(key);
        if (!held) {
            existing.set(key, entity);
            continue;
        }
        const merged = omcMerge.mergeEntity(held, entity, { prefer: 'existing', emptyAsNull: true });
        if (!merged) {
            // Only an entityType or schemaVersion disagreement can produce this, and neither is
            // reachable here — same type, same options. Reported rather than dropped silently so a
            // future caller that does reach it is not left with a short count.
            notes.push({
                kind: 'entityNotMerged',
                where: `${entityType} ${key}`,
                detail: 'a second mapping built this entity but it could not be merged',
            });
            continue;
        }
        existing.set(key, merged);
    }
}

/**
 * Apply one {@link DataPipeline.EntityMapping} to a table set.
 *
 * @param {DataPipeline.EntityMapping} mapping - What to build and from where
 * @param {DataPipeline.TableSet} tables - The interim tables
 * @param {DataPipeline.OmcOptions} options - Resolved options
 * @param {Array<DataPipeline.MappingNote>} notes - Appended to in place
 * @returns {Map<string, OmcEntity>} Entities by key
 */
function buildEntityType(mapping, tables, options, notes) {
    const { entityType, table, grain = 'row' } = mapping;

    const rows = tables[table];
    if (!rows) throw new Error(`Mapping for ${entityType} reads table "${table}", which is not present`);

    const groups = rowsByKey(mapping, rows);
    const consumed = consumedColumns(mapping);
    const entities = new Map();
    const shape = omcTemplate.shape({ entityType, schemaVersion: options.schemaVersion });

    /**
     * Build one entity from the rows that resolve together.
     *
     * @param {string} keyValue - The key this entity is seeded from
     * @param {DataPipeline.Table} resolveFrom - The rows to read
     * @returns {OmcEntity} The entity
     */
    const entityFrom = (keyValue, resolveFrom) => {
        const properties = {};
        for (const [path, spec] of Object.entries(mapping.properties ?? {})) {
            const { value, withheld } = resolveProperty(spec, resolveFrom, tables);
            if (withheld) {
                notes.push({
                    kind: 'propertyWithheld',
                    where: `${entityType} ${keyValue}`,
                    detail: `${path} not set: ${withheld}`,
                });
            }
            if (value !== null && value !== undefined) setPath(properties, path, value, shape);
        }

        const [firstRow] = resolveFrom;
        for (const [propertyPath, entries] of Object.entries(mapping.notes ?? {})) {
            const noteList = buildNotes(entries, firstRow);
            if (noteList.length) setPath(properties, propertyPath, noteList, shape);
        }

        const customData = buildCustomData(mapping.customData, resolveFrom, consumed);
        if (customData.length) properties.customData = customData;

        return createEntity({
            entityType, key: keyValue, properties, options,
        });
    };

    for (const [keyValue, groupRowsForKey] of groups) {
        if (grain === 'group') {
            // The rows resolve together: what they disagree on is withheld, because a fact about
            // one take does not become a fact about the scene covering it.
            entities.set(keyValue, entityFrom(keyValue, groupRowsForKey));
            continue;
        }
        // At row grain each row builds its own entity, and rows sharing a key are folded. Usually
        // there is one row and the fold is a no-op. Where there are several — one row per comment,
        // all naming the same file — folding is what turns three rows into one entity carrying
        // three annotations, because `mergeEntity` unions arrays by value. Keeping the last row and
        // discarding the rest, which is what this used to do, silently lost the other two.
        for (const row of groupRowsForKey) {
            const entity = entityFrom(keyValue, [row]);
            const held = entities.get(keyValue);
            if (!held) {
                entities.set(keyValue, entity);
                continue;
            }
            const merged = omcMerge.mergeEntity(held, entity, { prefer: 'existing', emptyAsNull: true });
            if (merged) entities.set(keyValue, merged);
        }
    }

    return entities;
}

/**
 * Create the edges declared by a mapping, once every entity exists.
 *
 * Edges are created through `omcEdges.edgeCreate`, so the path, the storage shape and the
 * inverse all come from the schema rather than from this file.
 *
 * @param {DataPipeline.EntityMapping} mapping - The mapping declaring the edges
 * @param {DataPipeline.TableSet} tables - The interim tables
 * @param {Map<string, DataPipeline.Table>} groupsByKey - Rows behind each entity of this type
 * @param {Map<string, Map<string, OmcEntity>>} registry - Built entities, by type then key
 * @param {DataPipeline.OmcOptions} options - Resolved options
 */
function applyEdges(mapping, tables, groupsByKey, registry, options) {
    const source = registry.get(mapping.entityType);

    for (const edge of mapping.edges ?? []) {
        for (const [keyValue, ownRows] of groupsByKey) {
            // An edge can be sourced from a different table than the entity — a narrative
            // scene's characters live in their own table, joined on the scene number.
            const rows = edge.from
                ? (tables[edge.from.table] ?? []).filter((r) => String(r[edge.from.on]) === keyValue)
                : ownRows;

            const targetKeys = edge.split
                ? [...new Set(rows.flatMap((r) => splitList(r[edge.via], edge.split)))]
                : [...new Set(rows.map((r) => r[edge.via])
                    .filter((v) => v !== null && v !== undefined && v !== '')
                    .map(String))];

            for (const targetKey of targetKeys) {
                const target = edge.external
                    ? entityRef({ entityType: edge.to, key: targetKey, options })
                    : registry.get(edge.to)?.get(targetKey);
                if (!target) continue;

                const result = omcEdges.edgeCreate({
                    fromEntity: source.get(keyValue),
                    toEntity: target,
                    // Which relationship, where the target type is reachable through more than one.
                    // Optional: a mapping that does not say falls back to edgeCreate's own choice,
                    // which is what every mapping here did before.
                    intrinsicEdge: edge.edgeKey ?? null,
                    inverse: Boolean(edge.inverse),
                });
                if (!result) continue;

                source.set(keyValue, result.fromEntity);
                if (edge.inverse && !edge.external) registry.get(edge.to).set(targetKey, result.toEntity);
            }
        }
    }
}

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
export function buildEntities({ tables, mappings, options = {} }) {
    const resolved = resolveOptions(options);
    const notes = [];

    const registry = new Map();
    // Per mapping, not per entityType: two mappings may build the same type from different tables,
    // and each one's edges must be applied against its own rows.
    const built = [];

    for (const mapping of mappings) {
        const entities = buildEntityType(mapping, tables, resolved, notes);
        mergeInto(registry, mapping.entityType, entities, notes);

        built.push({ mapping, groups: rowsByKey(mapping, tables[mapping.table]) });
    }

    for (const { mapping, groups } of built) {
        applyEdges(mapping, tables, groups, registry, resolved);
    }

    const entitiesByType = Object.fromEntries(
        [...registry].map(([entityType, entities]) => [entityType, [...entities.values()]]),
    );

    return {
        entitiesByType,
        notes,
        counts: {
            seedNamespace: resolved.seedNamespace,
            schemaVersion: resolved.schemaVersion,
            identifierScope: resolved.identifierScope,
            tables: Object.fromEntries(Object.entries(tables).map(([t, r]) => [t, r.length])),
            entities: Object.fromEntries(Object.entries(entitiesByType).map(([t, e]) => [t, e.length])),
        },
    };
}
