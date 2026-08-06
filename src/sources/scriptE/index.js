import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { findFile } from '../../lib/paths.js';
import { writeJson, writeTables } from '../../lib/tabular.js';
import { buildEntities } from '../../omc/build.js';
import { writeBundle } from '../../omc/bundle.js';
import { checkMappings } from '../../omc/checkMapping.js';
import { renderOmcReport } from '../../omc/report.js';

import { analyseDocuments } from './documents.js';
import { omcMappings } from './omcMapping.js';
import { parseEditorLogXmlFile } from './parseEditorLogXml.js';
import { parseSilverStackFile } from './parseSilverStack.js';
import { parseSimFile } from './parseSim.js';
import { toTables } from './toTables.js';
import { renderFidelityReport, validateDay } from './validate.js';

/**
 * File-name patterns for the Script-E exports we read. Script-E prefixes every file with
 * the full production title, so these match on the report name and day suffix only.
 */
const FILES = {
    sim: /SIM Metabanq Day \d+\.xml$/i,
    editorLogXml: /EDITOR LOG Day \d+\.xml$/i,
    silverStack: /SilverStack Log.*\.csv$/i,
};

/**
 * Locate the machine-readable Script-E exports for one filming day.
 *
 * @param {string} sourceDir the `Filming Day N` directory
 * @returns {Promise<{sim: string, editorLogXml: (string|null), silverStack: (string|null)}>} paths
 */
async function locate(sourceDir) {
    return {
        sim: await findFile(sourceDir, FILES.sim),
        editorLogXml: await findFile(sourceDir, FILES.editorLogXml, { required: false }),
        silverStack: await findFile(sourceDir, FILES.silverStack, { required: false }),
    };
}

/**
 * Extract one filming day into the normalized model, per-table CSVs and a workbook.
 *
 * @param {{sourceDir: string, outDir: string, day: (string|number)}} opts resolved selection
 * @returns {Promise<{model: object, tables: object, written: string[]}>} extraction result
 */
export async function extract({ sourceDir, outDir, day }) {
    const files = await locate(sourceDir);
    const model = await parseSimFile(files.sim);

    // The delivered files are assets in their own right. Classifying them by content gives
    // an `assets` table alongside the take and scene tables, reviewable before any OMC is
    // generated.
    const documents = await analyseDocuments({
        sourceDir, day, productionName: model.production.productionName,
    });
    model.documentNotes = documents.notes;

    const tables = { ...toTables(model), assets: documents.rows };

    const written = await writeTables(tables, outDir, `day${day}`);
    written.push(await writeJson(path.join(outDir, `day${day}.model.json`), model));

    return { model, tables, written };
}

/**
 * Cross-check the SIM Metabanq export against the Editor Log XML and SilverStack CSV.
 *
 * @param {{sourceDir: string, outDir: string, day: (string|number), production: string, source: string}} opts selection
 * @returns {Promise<{report: object, summary: string[], written: string[]}>} fidelity result,
 *   a caller-printable summary, and the paths written
 */
export async function validate({ sourceDir, outDir, day, production, source }) {
    const files = await locate(sourceDir);
    const model = await parseSimFile(files.sim);

    const editorLog = files.editorLogXml ? await parseEditorLogXmlFile(files.editorLogXml) : { takes: [] };
    const silverStack = files.silverStack
        ? await parseSilverStackFile(files.silverStack)
        : { takes: [], parseErrors: [] };

    const report = validateDay(model, editorLog.takes, silverStack, {
        editorLogXml: Boolean(files.editorLogXml),
        silverStack: Boolean(files.silverStack),
    });
    report.sources = files;

    const written = [
        await writeJson(path.join(outDir, 'fidelity.json'), report),
    ];
    const mdPath = path.join(outDir, 'source-fidelity-report.md');
    await writeFile(mdPath, renderFidelityReport(report, { production, source, day }), 'utf8');
    written.push(mdPath);

    // What a cross-check compares is this source's business, so the one-line summary of it is
    // built here rather than by whatever is printing.
    const summarize = (r) => (r.delivered
        ? `${r.mismatches.length} mismatches, ${r.nullOnlyOnOneSide.length} one-sided, `
        + `${r.keysOnlyInSim.length + r.keysOnlyInOther.length} unmatched takes`
        : 'not delivered for this day');
    const summary = [
        `vs Editor Log XML:  ${summarize(report.vsEditorLog)}`,
        `vs SilverStack CSV: ${summarize(report.vsSilverStack)}`,
    ];

    return { report, summary, written };
}

/**
 * Concatenate the interim tables of several days into one table set.
 *
 * Days are combined rather than mapped one at a time: production scenes are unique
 * production-wide and narrative scenes recur across days, so per-day bundles would split
 * entities that are in fact the same thing.
 *
 * @param {Array<DataPipeline.TableSet>} perDay - One table set per filming day, in shoot order
 * @returns {DataPipeline.TableSet} The combined tables
 */
function concatTables(perDay) {
    return perDay.reduce((acc, tables) => {
        for (const [name, rows] of Object.entries(tables)) acc[name] = [...acc[name] ?? [], ...rows];
        return acc;
    }, {});
}

/**
 * Map several filming days onto an OMC-JSON bundle.
 *
 * The route runs source → interim tables → OMC, the same tables written to `processedData`.
 * Nothing here builds an entity: {@link buildEntities} does that generically, driven by the
 * declarative {@link omcMappings}.
 *
 * @memberof namespace:DataPipeline
 * @function omc
 * @param {Object} params
 * @param {Array<{sourceDir: string}>} params.days - Source directories, in shoot order
 * @param {string} params.omcDir - Destination directory for the bundle
 * @param {DataPipeline.OmcOptions} [params.options] - Scope, schema version and namespace.
 *   `seedNamespace` defaults to the production name found in the data.
 * @returns {Promise<{result: DataPipeline.BuildResult, bundle: DataPipeline.BundleResult, written: Array<string>}>}
 *   The build result, the bundle result and the paths written
 */
export async function omc({ days, omcDir, options = {} }) {
    const perDay = [];
    let productionName = null;
    for (const { sourceDir, day } of days) {
        const files = await locate(sourceDir);
        const model = await parseSimFile(files.sim);
        productionName ??= model.production.productionName;
        const documents = await analyseDocuments({
            sourceDir, day, productionName: model.production.productionName,
        });
        perDay.push({ ...toTables(model), assets: documents.rows });
    }

    // Check the mappings against the target schema before reading any data: a version bump
    // then names every property and edge the new schema no longer accepts, instead of
    // surfacing as a thrown error partway through or a silently missing relationship.
    const check = checkMappings({ mappings: omcMappings, options });
    if (!check.valid) {
        const problems = check.problems.map((p) => `  ${p.kind}: ${p.where} — ${p.detail}`);
        throw new Error([`Mappings do not fit ${check.schemaVersion}:`, ...problems].join('\n'));
    }

    const tables = concatTables(perDay);
    const result = buildEntities({
        tables,
        mappings: omcMappings,
        options: { seedNamespace: productionName, ...options },
    });

    const bundle = await writeBundle({ entitiesByType: result.entitiesByType, outDir: omcDir });

    const reportPath = path.join(omcDir, 'omc-generation-report.md');
    await writeFile(reportPath, renderOmcReport({
        result, bundle, check, mappings: omcMappings, title: productionName,
    }), 'utf8');

    return {
        result, bundle, check, written: [...bundle.written, reportPath],
    };
}

export const name = 'Script-E';
