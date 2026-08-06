import { CSV_UNMAPPED, splitTake, TAKE_FIELDS } from './fieldMap.js';

/**
 * Takes are identified across all three sources by slate + camera + take number. Wild tracks
 * have no slate once split out, so their 1000-block number stands in for it.
 */
const takeKey = (t) => {
    const { number, annotation } = splitTake(t.take);
    return `${t.slate ?? t.wildTrackNumber}|${t.camera ?? ''}|${number ?? annotation ?? ''}`;
};

/** Apply the field's declared normalizer, if any, before comparing two values. */
const compareValue = (field, value) => {
    if (value === null || value === undefined || value === '') return null;
    return field.normalize ? field.normalize(String(value)) : String(value);
};

/**
 * Compare two sets of take rows field by field on the fields both sources carry.
 *
 * @param {object[]} left rows from the reference source
 * @param {object[]} right rows from the source being checked
 * @param {'editorLog'|'csv'} side which column of the field map the right-hand source uses
 * @returns {object} comparison result
 */
function compareTakes(left, right, side, delivered = true) {
    const leftByKey = new Map(left.map((t) => [takeKey(t), t]));
    const rightByKey = new Map(right.map((t) => [takeKey(t), t]));

    const shared = TAKE_FIELDS.filter((f) => f.sim && f[side]);
    const mismatches = [];
    const nullOnlyOnOneSide = [];

    for (const [key, l] of leftByKey) {
        const r = rightByKey.get(key);
        if (!r) continue;
        for (const field of shared) {
            const a = compareValue(field, l[field.key]);
            const b = compareValue(field, r[field.key]);
            if (a === b) continue;
            const record = { take: key, field: field.key, sim: l[field.key], other: r[field.key] };
            if (a === null || b === null) nullOnlyOnOneSide.push(record);
            else mismatches.push(record);
        }
    }

    const notes = Object.fromEntries(shared.filter((f) => f.note).map((f) => [f.key, f.note]));

    const simKeys = [...leftByKey.keys()];
    const matched = simKeys.filter((k) => rightByKey.has(k));

    return {
        delivered,
        counts: { sim: left.length, other: right.length, matchedKeys: matched.length },
        fieldNotes: notes,
        keysOnlyInSim: simKeys.filter((k) => !rightByKey.has(k)),
        keysOnlyInOther: [...rightByKey.keys()].filter((k) => !leftByKey.has(k)),
        comparedFields: shared.map((f) => f.key),
        simOnlyFields: TAKE_FIELDS.filter((f) => f.sim && !f[side]).map((f) => f.key),
        mismatches,
        nullOnlyOnOneSide,
    };
}

/**
 * Cross-tabulate the SilverStack `Circled` flag against Script-E's own select fields.
 * The two tools disagree about what "circled" means and nothing in the data asserts a
 * mapping, so this reports the observed relationship instead of inventing one.
 *
 * @param {object[]} simTakes SIM take rows
 * @param {object[]} csvTakes SilverStack take rows
 * @returns {Record<string, Record<string, number>>} circled value -> selectType -> count
 */
function crossTabCircled(simTakes, csvTakes) {
    const simByKey = new Map(simTakes.map((t) => [takeKey(t), t]));
    const table = {};
    for (const row of csvTakes) {
        const sim = simByKey.get(takeKey(row));
        if (!sim) continue;
        const circled = row.Circled ?? '(blank)';
        const select = sim.selectType ?? '(blank)';
        table[circled] ??= {};
        table[circled][select] = (table[circled][select] ?? 0) + 1;
    }
    return table;
}

/**
 * Run the full three-way fidelity check for one filming day.
 *
 * @param {object} sim normalized model from {@link parseSim}
 * @param {object[]} editorLogTakes take rows from {@link parseEditorLogXml}
 * @param {object} silverStack result of {@link parseSilverStack}
 * @returns {object} machine-readable fidelity report
 */
export function validateDay(sim, editorLogTakes, silverStack, delivered = {}) {
    const vsEditorLog = compareTakes(sim.takes, editorLogTakes, 'editorLog', delivered.editorLogXml !== false);
    const vsCsv = compareTakes(sim.takes, silverStack.takes, 'csv', delivered.silverStack !== false);

    return {
        production: sim.production,
        totals: {
            takes: sim.takes.length,
            scenes: sim.scenes.length,
            shootDays: sim.shootDays.length,
            distinctSlates: new Set(sim.takes.map((t) => t.slate)).size,
            wildTracks: sim.takes.filter((t) => t.isWildTrack).length,
        },
        vsEditorLog,
        vsSilverStack: {
            ...vsCsv,
            unmappedCsvColumns: CSV_UNMAPPED,
            circledVsSelectType: crossTabCircled(sim.takes, silverStack.takes),
        },
        anomalies: sim.anomalies,
        csvParseErrors: silverStack.parseErrors,
    };
}

/** Count differences per field, so a systemic issue reads as one line, not 90. */
const byField = (rows) => rows.reduce((acc, r) => ({ ...acc, [r.field]: (acc[r.field] ?? 0) + 1 }), {});

/**
 * Render differences: a per-field roll-up first, then a capped sample of the rows. A field
 * that differs on every take is one finding about the export, not 90 findings about takes.
 */
function renderRows(rows, otherLabel, fieldNotes = {}, sampleLimit = 12) {
    if (!rows.length) return '_none_\n';

    const summary = Object.entries(byField(rows))
        .sort((a, b) => b[1] - a[1])
        .map(([field, n]) => `| \`${field}\` | ${n} | ${fieldNotes[field] ?? ''} |`)
        .join('\n');

    // Take keys and free-text values both contain `|`, which would otherwise split cells.
    const cell = (v) => (v === null || v === undefined ? '_(empty)_' : String(v).replaceAll('|', '\\|'));
    const sample = rows.slice(0, sampleLimit)
        .map((r) => `| ${cell(r.take)} | ${r.field} | ${cell(r.sim)} | ${cell(r.other)} |`)
        .join('\n');
    const more = rows.length > sampleLimit ? `\n\n_… ${rows.length - sampleLimit} more, see \`fidelity.json\`_` : '';

    const sampleHead = `| take (slate\\|camera\\|take) | field | SIM | ${otherLabel} |\n| --- | --- | --- | --- |\n`;

    return `| field | differing takes | note |\n| --- | --- | --- |\n${summary}\n\n`
        + '<details><summary>Sample rows</summary>\n\n'
        + `${sampleHead}${sample}${more}\n\n</details>\n`;
}

/**
 * Render the fidelity report as Markdown for humans.
 *
 * @param {object} report output of {@link validateDay}
 * @param {{production: string, source: string, day: (string|number)}} selection what was checked
 * @returns {string} Markdown document
 */
export function renderFidelityReport(report, selection) {
    const { vsEditorLog: el, vsSilverStack: ss, totals } = report;
    const verdict = (r) => {
        if (!r.delivered) return '**NOT DELIVERED**';
        const clean = r.keysOnlyInSim.length === 0 && r.keysOnlyInOther.length === 0 && r.mismatches.length === 0;
        return clean ? '**PASS**' : '**DIFFERENCES FOUND**';
    };

    return `# Script-E source fidelity — ${selection.production}, Day ${selection.day}

Generated by \`node src/cli.js validate\`. Reference source: **SIM Metabanq XML**.

- Production: ${report.production.productionName}
- Export UUID: \`${report.production.uuid}\` (created ${report.production.created})
- Takes: ${totals.takes} (${totals.wildTracks} wild tracks) across ${totals.distinctSlates} slates
- Scenes: ${totals.scenes} · Shoot days: ${totals.shootDays}

## SIM Metabanq vs Editor Log XML — ${verdict(el)}

Rows: SIM ${el.counts.sim}, Editor Log ${el.counts.other}, matched on slate|camera|take ${el.counts.matchedKeys}.
Fields compared: ${el.comparedFields.length}. Present in SIM only: ${el.simOnlyFields.length ? `\`${el.simOnlyFields.join('`, `')}\`` : '_none_'}.

Takes only in SIM: ${el.keysOnlyInSim.length ? el.keysOnlyInSim.join(', ') : '_none_'}
Takes only in Editor Log: ${el.keysOnlyInOther.length ? el.keysOnlyInOther.join(', ') : '_none_'}

### Value mismatches
${renderRows(el.mismatches, 'Editor Log', el.fieldNotes)}
### Populated on one side only
${renderRows(el.nullOnlyOnOneSide, 'Editor Log', el.fieldNotes)}
## SIM Metabanq vs SilverStack CSV — ${verdict(ss)}

Rows: SIM ${ss.counts.sim}, SilverStack ${ss.counts.other}, matched ${ss.counts.matchedKeys}.
Fields compared: ${ss.comparedFields.length}. Present in SIM only: ${ss.simOnlyFields.length ? `\`${ss.simOnlyFields.join('`, `')}\`` : '_none_'}.
CSV columns with no Script-E counterpart: \`${ss.unmappedCsvColumns.join('`, `')}\`.

Takes only in SIM: ${ss.keysOnlyInSim.length ? ss.keysOnlyInSim.join(', ') : '_none_'}
Takes only in SilverStack: ${ss.keysOnlyInOther.length ? ss.keysOnlyInOther.join(', ') : '_none_'}

### Value mismatches
${renderRows(ss.mismatches, 'SilverStack', ss.fieldNotes)}
### Populated on one side only
${renderRows(ss.nullOnlyOnOneSide, 'SilverStack', ss.fieldNotes)}
### Observed relationship: SilverStack \`Circled\` vs Script-E \`selectType\`
${Object.entries(ss.circledVsSelectType).map(([circled, byType]) => `- \`Circled=${circled}\`: ${Object.entries(byType).map(([t, n]) => `${t} × ${n}`).join(', ')}`).join('\n') || '_no overlap_'}

## Source data-quality notes
${report.anomalies.length
    ? report.anomalies.map((a) => `- **${a.kind}** — ${a.where}: ${a.detail}`).join('\n')
    : '_none_'}

## CSV parser notes
${report.csvParseErrors.length
    ? `${report.csvParseErrors.length} malformed row(s). SilverStack does not escape a \`"\` that appears inside a
quoted field, so any take whose notes contain a double quote shifts its remaining columns.
That is the cause of the \`comment\` / \`startDateTime\` / \`endDateTime\` differences above:
the SIM Metabanq values are the correct ones. See \`fidelity.json\` for the affected rows.`
    : '_none_'}
`;
}
