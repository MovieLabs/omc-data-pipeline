import { omcTemplate } from 'omc-util';

import '../types.js'; // Type definitions, resolved globally by JSDoc

/** Render one mapping's property table, so the report states the mapping actually applied. */
function renderMapping(mapping) {
    const source = (spec) => {
        if (typeof spec === 'string') return `\`${spec}\``;
        const parts = [`\`${spec.from}\``];
        if (spec.split) parts.push(`split on \`${spec.split}\``);
        if (spec.when === 'unanimous') parts.push('only when every row agrees');
        if (spec.when === 'single') parts.push('only when it holds one value');
        if (spec.lookup) parts.push(`looked up in \`${spec.lookup.table}\`.\`${spec.lookup.select}\``);
        if (spec.as) parts.push(`as ${spec.as}`);
        return parts.join(', ');
    };

    const properties = Object.entries(mapping.properties ?? {})
        .map(([path, spec]) => `| \`${path}\` | ${source(spec)} |`).join('\n');

    const notes = Object.entries(mapping.notes ?? {})
        .map(([propertyPath, entries]) => `| \`${propertyPath}[]\` | `
            + `${entries.map(({ title, from }) => `\`${from}\`${title ? ` as "${title}"` : ''}`).join(', ')} |`)
        .join('\n');

    const edges = (mapping.edges ?? [])
        .map((e) => `| \`edges → ${e.to}\` | via \`${e.via}\`${e.split ? `, split on \`${e.split}\`` : ''}`
            + `${e.external ? ' — referenced, built by a later pass' : ''} |`).join('\n');

    const custom = mapping.customData
        ? `| \`customData[]\` | every remaining \`${mapping.table}\` column, domain \`${mapping.customData.domain}\``
        + `${mapping.customData.exclude?.length ? ` (except \`${mapping.customData.exclude.join('`, `')}\`)` : ''} |`
        : '';

    return `\`${mapping.entityType}\` — one per ${mapping.grain === 'group'
        ? `distinct \`${mapping.key}\` in \`${mapping.table}\``
        : `row of \`${mapping.table}\``}

| OMC property | Source |
|---|---|
${properties}
${notes ? `${notes}\n` : ''}${custom}
${edges}
`;
}

/**
 * Render the OMC generation report.
 *
 * Generic: everything it says about the mapping is read from the mappings themselves, so a
 * new source gets a correct report without writing one.
 *
 * @memberof namespace:DataPipeline
 * @function renderOmcReport
 * @param {Object} params
 * @param {DataPipeline.BuildResult} params.result - Output of {@link buildEntities}
 * @param {DataPipeline.BundleResult} params.bundle - Output of {@link writeBundle}
 * @param {Array<DataPipeline.EntityMapping>} params.mappings - The mappings applied
 * @param {DataPipeline.MappingCheck} [params.check] - Output of {@link checkMappings}
 * @param {string} [params.title] - Heading for the report
 * @returns {string} A Markdown document
 */
export function renderOmcReport({
    result, bundle, mappings, check, title,
}) {
    const { counts, notes } = result;
    const { validation, edgeCheck } = bundle;
    const version = omcTemplate.versionLabel(counts.schemaVersion);

    const external = Object.entries(edgeCheck.external)
        .map(([type, n]) => `- \`${type}\` × ${n} — not built by this pass; `
            + 'references are seeded so they resolve when it is')
        .join('\n') || '_none_';

    const entities = Object.entries(counts.entities)
        .map(([type, n]) => `| \`${type}\` | ${n} |`).join('\n');

    const tables = Object.entries(counts.tables)
        .map(([t, n]) => `\`${t}\` ${n}`).join(', ');

    // The mappings are the only place OMC property names appear, so a schema change can
    // only invalidate them — the report says whether they still fit.
    const checkLine = check
        ? `Checked against the schema before any data was read: ${check.checked.properties} property `
        + `mappings and ${check.checked.edges} edges across \`${check.checked.entityTypes.join('`, `')}\` — `
        + `**${check.valid ? 'all resolve' : `${check.problems.length} do not`}**.\n`
        : '';

    return `# OMC-JSON generation — ${title ?? counts.seedNamespace}

Schema **${version}** (\`${counts.schemaVersion}\`), identifierScope \`${counts.identifierScope}\`,
seed namespace \`${counts.seedNamespace}\`. Identifiers are hashed from stable seeds, so
re-running produces the same entities rather than duplicating the graph.

## Entities

| Entity | Count |
|---|---|
${entities}

From tables: ${tables}.

## Validation

**${validation.valid ? 'PASS' : 'FAIL'}** — every entity checked individually with
\`omcValidate(..., { atomic: false })\`, not merely as a set.
${validation.valid ? '' : validation.failures.map((f) => `- ${f.entityType} ${f.identifier}: ${f.errors.join('; ')}`).join('\n')}

Edge targets resolving inside the bundle: **${edgeCheck.dangling.length === 0 ? 'all' : `${edgeCheck.dangling.length} DANGLING`}**.
${edgeCheck.dangling.slice(0, 10).map((d) => `- ${d.from} → ${d.targetType} ${d.target}`).join('\n')}

References out to entities built by a later pass:
${external}

## Mapping

${checkLine}
${mappings.map(renderMapping).join('\n')}
The schema sets \`unevaluatedProperties: false\`, so no source field can ride along as a
custom property. \`customData\` is the schema's own catch-all — *"used where the formal schema
lacks required properties"* — and carries the source's key/value pairs as an object under its
own column names, so nothing the source recorded is lost. Commentary goes to \`annotation\`.

## Withheld
${notes.length
    ? `A value that cannot be determined from the source is left absent and reported, never
guessed.\n\n${notes.map((n) => `- **${n.kind}** — ${n.where}: ${n.detail}`).join('\n')}`
    : '_nothing withheld_'}
`;
}
