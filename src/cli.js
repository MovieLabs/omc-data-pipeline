import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { dayPaths, omcPath, repoRoot } from './lib/paths.js';
import { catalog, fsContext, runPipeline } from './pipelines/index.js';
import * as scriptE from './sources/scriptE/index.js';

/** Source adapters, keyed by the `--source` value, which is also the directory name. */
const SOURCES = { 'Script-E': scriptE };

const COMMANDS = ['extract', 'validate', 'all', 'omc', 'pipelines', 'run'];

const USAGE = `
Usage: node src/cli.js <command> [options]

Commands:
  extract    Read a day's source exports and write the tabular model to processedData
  validate   Cross-check the day's exports against each other and write a fidelity report
  all        extract, then validate
  omc        Map the given days onto an OMC-JSON bundle in <production>/omc
  pipelines  List the pipelines this package offers
  run        Run a pipeline over a directory and print the OMC it produces

Options:
  --production <name>   Production folder, e.g. WWDOAT          (default: WWDOAT)
  --source <name>       Source folder, e.g. Script-E            (default: Script-E)
  --day <n>             Filming day number, or a comma list     (default: 1)
  --identifier-scope    identifierScope for generated OMC ids   (omc, run)
  --schema-version      OMC-JSON schema version URL             (omc, run)
  --pipeline <id>       Pipeline to run, e.g. script-e          (run only)
  --dir <path>          Directory of files to feed it           (run only)
  --out <path>          Write the OMC here instead of stdout    (run only)
`;

/** Print paths relative to the repo root — absolute Windows paths swamp the output. */
const rel = (p) => path.relative(repoRoot, p);

async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            'production': { type: 'string', default: 'WWDOAT' },
            'source': { type: 'string', default: 'Script-E' },
            'day': { type: 'string', default: '1' },
            'identifier-scope': { type: 'string' },
            'schema-version': { type: 'string' },
            'pipeline': { type: 'string' },
            'dir': { type: 'string' },
            'out': { type: 'string' },
        },
    });

    const command = positionals[0];
    if (!command || !COMMANDS.includes(command)) {
        console.log(USAGE);
        process.exitCode = command ? 1 : 0;
        return;
    }

    // Only options the caller actually supplied are passed on, so the library's own defaults
    // apply rather than being overwritten with undefined.
    const omcOptions = Object.fromEntries(Object.entries({
        identifierScope: values['identifier-scope'],
        schemaVersion: values['schema-version'],
    }).filter(([, v]) => v !== undefined));

    if (command === 'pipelines') {
        listPipelines();
        return;
    }

    if (command === 'run') {
        await runPipelineCommand(values, omcOptions);
        return;
    }

    const adapter = SOURCES[values.source];
    if (!adapter) {
        throw new Error(`Unknown source "${values.source}". Known sources: ${Object.keys(SOURCES).join(', ')}`);
    }

    const days = values.day.split(',').map((d) => d.trim()).filter(Boolean);

    // `omc` spans every requested day in one bundle, so it runs outside the per-day loop.
    if (command === 'omc') {
        const omcDir = omcPath(values);
        console.log(`\n=== ${values.production} / ${values.source} / OMC-JSON from day(s) ${days.join(', ')} ===`);

        const { result, bundle, written } = await adapter.omc({
            // `day` travels alongside the paths: `dayPaths` returns only directories, and the
            // adapter needs the day itself for files that do not state their own.
            days: days.map((day) => ({ day, ...dayPaths({ ...values, day }) })),
            omcDir,
            options: omcOptions,
        });
        for (const [entityType, entities] of Object.entries(result.entitiesByType)) {
            console.log(`  ${entityType}: ${entities.length} entities`);
        }
        console.log(`  validation: ${bundle.validation.valid ? 'PASS' : `${bundle.validation.failures.length} FAILED`}`);
        console.log(`  edge targets: ${bundle.edgeCheck.dangling.length ? `${bundle.edgeCheck.dangling.length} dangling` : 'all resolve'}`);
        if (result.notes.length) console.log(`  ${result.notes.length} mapping note(s)`);
        written.forEach((p) => console.log(`  -> ${rel(p)}`));
        return;
    }

    let failed = 0;
    for (const day of days) {
        const selection = { production: values.production, source: values.source, day };
        const opts = { ...selection, ...dayPaths(selection) };
        console.log(`\n=== ${values.production} / ${values.source} / Day ${day} ===`);

        try {
            await runDay(command, adapter, opts);
        } catch (err) {
            failed += 1;
            // A workbook left open in Excel locks the file. Say so, and keep going: one
            // locked day should not abandon the other three.
            console.error(err.code === 'EBUSY'
                ? `  SKIPPED — ${rel(err.path ?? '')} is open in another program. Close it and re-run this day.`
                : `  FAILED — ${err.message}`);
        }
    }
    if (failed) process.exitCode = 1;
}

/**
 * Run the requested command for a single day.
 *
 * @param {string} command extract | validate | all
 * @param {object} adapter source adapter module
 * @param {object} opts resolved selection and paths
 */
async function runDay(command, adapter, opts) {
    if (command === 'extract' || command === 'all') {
        const { tables, written } = await adapter.extract(opts);
        for (const [table, rows] of Object.entries(tables)) console.log(`  ${table}: ${rows.length} rows`);
        written.forEach((p) => console.log(`  -> ${rel(p)}`));
    }

    if (command === 'validate' || command === 'all') {
        // The adapter summarises its own fidelity report: what a cross-check compares is the
        // source's business, and a CLI that read those fields itself would need editing for
        // every new source.
        const { report, summary = [], written } = await adapter.validate(opts);
        summary.forEach((line) => console.log(`  ${line}`));
        if (report.anomalies.length) console.log(`  ${report.anomalies.length} source data-quality note(s)`);
        written.forEach((p) => console.log(`  -> ${rel(p)}`));
    }
}

/**
 * Print the pipeline catalogue: what each one is, what it takes and what it produces.
 */
function listPipelines() {
    for (const p of catalog()) {
        console.log(`\n${p.pipelineId}  —  ${p.label}  (v${p.version})`);
        console.log(`  ${p.description}`);
        console.log(`  produces: ${p.produces.join(', ')}`);
        console.log(`  schema:   ${p.schemaVersions.join(', ')}`);
        for (const role of p.inputs.roles) {
            const cap = role.maxFiles === undefined ? 'any number' : `up to ${role.maxFiles}`;
            console.log(`  role ${role.role}${role.required ? ' (required)' : ''}: ${role.label} — ${cap}`);
        }
        for (const opt of p.options ?? []) {
            console.log(`  option --${opt.name}: ${opt.label} (${opt.type})${opt.required ? ' (required)' : ''}`);
        }
    }
    console.log('');
}

/**
 * Run a pipeline over a directory.
 *
 * Roles are assigned from each definition's own `match` patterns, with the first role that
 * declares none as the fallback — the same pre-assignment a UI does before letting the user
 * correct it. This is what makes `run` a faithful rehearsal of a service call rather than a
 * second code path.
 *
 * @param {object} values parsed CLI options
 * @param {DataPipeline.OmcOptions} omcOptions scope and schema version, where supplied
 */
async function runPipelineCommand(values, omcOptions) {
    const { pipeline: pipelineId, dir, out } = values;
    if (!pipelineId || !dir) throw new Error('run needs both --pipeline and --dir');

    const definition = catalog().find((p) => p.pipelineId === pipelineId);
    if (!definition) throw new Error(`Unknown pipeline "${pipelineId}". Try: node src/cli.js pipelines`);

    const { roles } = definition.inputs;
    const fallback = roles.find((r) => !r.match)?.role ?? roles[0].role;
    const names = (await readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));

    const inputs = names.map((fileName) => ({
        role: roles.find((r) => r.match && new RegExp(r.match, 'i').test(fileName))?.role ?? fallback,
        fileName,
        ref: fileName,
    }));

    console.log(`\n=== ${pipelineId} over ${rel(path.resolve(dir))} ===`);
    for (const input of inputs) console.log(`  ${input.role.padEnd(10)} ${input.fileName}`);

    const context = fsContext({
        baseDir: dir,
        options: omcOptions,
        onProgress: ({ stage, message }) => console.log(`  [${stage}] ${message ?? ''}`),
    });
    const result = await runPipeline({ pipelineId, inputs, omcOptions }, context);

    for (const [entityType, count] of Object.entries(result.report.counts)) {
        console.log(`  ${entityType}: ${count} entities`);
    }
    console.log(`  validation: ${result.report.validation.valid ? 'PASS' : 'FAILED'}`);
    console.log(`  edge targets: ${result.report.edgeCheck.dangling.length
        ? `${result.report.edgeCheck.dangling.length} dangling`
        : 'all resolve'}`);
    if (result.notes.length) console.log(`  ${result.notes.length} note(s)`);

    if (out) {
        const { writeJson } = await import('./lib/tabular.js');
        console.log(`  -> ${rel(await writeJson(out, result.omc))}`);
    } else {
        console.log(JSON.stringify(result.omc, null, 2));
    }
}

main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
});
