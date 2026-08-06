import { omcEdges } from 'omc-util';

import '../types.js'; // Type definitions, resolved globally by JSDoc

import { createEntity, entityRef, resolveOptions } from './entity.js';

/**
 * Split a delimited cell into trimmed, de-duplicated, sorted members.
 *
 * Sorting matters: a source that writes the same set in two orders — `13; 15` on one row and
 * `15; 13` on another — would otherwise produce two different sets of edges for one
 * relationship. Numeric-looking members sort numerically so `2` precedes `10`.
 *
 * @param {*} value - The cell value
 * @param {string} delimiter - What to split on
 * @returns {Array<string>} The members
 */
function splitList(value, delimiter) {
    if (value === null || value === undefined || value === '') return [];
    return [...new Set(String(value).split(delimiter).map((s) => s.trim()).filter(Boolean))]
        .sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
}

/** Cast a value to the type OMC declares for the property. */
function cast(value, as) {
    if (value === null || value === undefined || value === '') return null;
    if (as === 'number') {
        const n = Number(value);
        return Number.isNaN(n) ? null : n;
    }
    if (as === 'boolean') return value === true || value === 'true' || value === 'Y';
    if (as === 'string') return String(value);
    // OMC dateTime properties (Provenance.createdOn) reject a date-only value. A source that
    // records only the date is promoted to midnight UTC — the day is asserted, the time is
    // a convention, not a claim that the event happened at 00:00.
    if (as === 'datetime') {
        return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : String(value);
    }
    return value;
}

/** Write a possibly-dotted path (`slateName.fullName`) into an object. */
function setPath(target, path, value) {
    const segments = path.split('.');
    const leaf = segments.pop();
    let node = target;
    for (const segment of segments) {
        node[segment] ??= {};
        node = node[segment];
    }
    node[leaf] = value;
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
        domain, namespace, schema, rest, exclude = [],
    } = mapping;
    if (!rest) return [];
    const skip = new Set([...consumed, ...exclude]);

    const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !skip.has(k));

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
 * Apply one {@link DataPipeline.EntityMapping} to a table set.
 *
 * @param {DataPipeline.EntityMapping} mapping - What to build and from where
 * @param {DataPipeline.TableSet} tables - The interim tables
 * @param {DataPipeline.OmcOptions} options - Resolved options
 * @param {Array<DataPipeline.MappingNote>} notes - Appended to in place
 * @returns {Map<string, OmcEntity>} Entities by key
 */
function buildEntityType(mapping, tables, options, notes) {
    const {
        entityType, table, grain = 'row', key, skipWhenKeyEmpty = false,
    } = mapping;

    const rows = tables[table];
    if (!rows) throw new Error(`Mapping for ${entityType} reads table "${table}", which is not present`);

    const groups = grain === 'group'
        ? groupRows(rows, key, skipWhenKeyEmpty)
        : new Map(rows
            .filter((r) => !skipWhenKeyEmpty || (r[key] !== null && r[key] !== undefined && r[key] !== ''))
            .map((r) => [String(r[key]), [r]]));

    const consumed = consumedColumns(mapping);
    const entities = new Map();

    for (const [keyValue, groupRowsForKey] of groups) {
        const properties = {};
        for (const [path, spec] of Object.entries(mapping.properties ?? {})) {
            const { value, withheld } = resolveProperty(spec, groupRowsForKey, tables);
            if (withheld) {
                notes.push({
                    kind: 'propertyWithheld',
                    where: `${entityType} ${keyValue}`,
                    detail: `${path} not set: ${withheld}`,
                });
            }
            if (value !== null && value !== undefined) setPath(properties, path, value);
        }

        const [firstRow] = groupRowsForKey;
        for (const [propertyPath, entries] of Object.entries(mapping.notes ?? {})) {
            const noteList = buildNotes(entries, firstRow);
            if (noteList.length) setPath(properties, propertyPath, noteList);
        }

        const customData = buildCustomData(mapping.customData, groupRowsForKey, consumed);
        if (customData.length) properties.customData = customData;

        entities.set(keyValue, createEntity({
            entityType, key: keyValue, properties, options,
        }));
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
    const groupsByType = new Map();

    for (const mapping of mappings) {
        const entities = buildEntityType(mapping, tables, resolved, notes);
        registry.set(mapping.entityType, entities);

        const rows = tables[mapping.table];
        groupsByType.set(mapping.entityType, mapping.grain === 'group'
            ? groupRows(rows, mapping.key, mapping.skipWhenKeyEmpty)
            : new Map(rows
                .filter((r) => !mapping.skipWhenKeyEmpty
                    || (r[mapping.key] !== null && r[mapping.key] !== undefined && r[mapping.key] !== ''))
                .map((r) => [String(r[mapping.key]), [r]])));
    }

    for (const mapping of mappings) {
        applyEdges(mapping, tables, groupsByType.get(mapping.entityType), registry, resolved);
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
