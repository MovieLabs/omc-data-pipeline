import { buildEntities } from '../../omc/build.js';
import { sealBundle, validationFailureMessage } from '../../omc/bundle.js';
import { checkMappings } from '../../omc/checkMapping.js';
import { renderOmcReport } from '../../omc/report.js';
import { inputsForRole } from '../../pipelines/request.js';
import '../../types.js'; // Type definitions, resolved globally by JSDoc

import { analyseInputs } from './documents.js';
import { omcMappings } from './omcMapping.js';
import { parseSim } from './parseSim.js';
import { toTables } from './toTables.js';

/** The schema versions the Script-E mappings are known to fit. */
const SCHEMA_VERSIONS = ['https://movielabs.com/omc/json/schema/v3.0'];

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
 * Wrap a context's `read` so each input is fetched once.
 *
 * Every file is read twice on this route — once to parse or classify it, once to describe it
 * as an Asset. Against a filesystem that is cheap; against object storage it is a second
 * round trip per file, so the bytes are held for the length of the run instead.
 *
 * @param {DataPipeline.PipelineContext} context - The context to wrap
 * @returns {function(DataPipeline.PipelineInput): Promise<Buffer>} A memoized read
 */
function memoizeRead(context) {
    const cache = new Map();
    return (input) => {
        if (!cache.has(input.ref)) cache.set(input.ref, context.read(input));
        return cache.get(input.ref);
    };
}

/**
 * Build OMC-JSON from a Script-E delivery.
 *
 * The route runs source → interim tables → OMC. Nothing here builds an entity:
 * {@link buildEntities} does that generically, driven by the declarative {@link omcMappings}.
 *
 * Every delivered file is described as an Asset, the SIM Metabanq exports included — the
 * reports are production assets in their own right, not merely the means of reading one.
 *
 * @param {DataPipeline.PipelineRunRequest} request - The files and options
 * @param {DataPipeline.PipelineContext} context - Byte source, progress and cancellation
 * @returns {Promise<DataPipeline.PipelineRunResult>} The OMC, the notes and the report
 * @throws {Error} When the mappings do not fit the target schema, or an entity fails validation
 */
async function run(request, context) {
    const read = memoizeRead(context);
    const simInputs = inputsForRole(request, 'sim');
    const { options } = context;

    // Check the mappings against the target schema before reading any data: a version bump
    // then names every property and edge the new schema no longer accepts, instead of
    // surfacing as a thrown error partway through or a silently missing relationship.
    context.onProgress({ stage: 'check', message: `Checking mappings against ${options.schemaVersion}` });
    const check = checkMappings({ mappings: omcMappings, options });
    if (!check.valid) {
        const problems = check.problems.map((p) => `  ${p.kind}: ${p.where} — ${p.detail}`);
        throw new Error([`Mappings do not fit ${check.schemaVersion}:`, ...problems].join('\n'));
    }

    const perDay = [];
    const notes = [];
    const shootDays = new Set();
    let productionName = null;

    for (const [index, input] of simInputs.entries()) {
        context.signal.throwIfAborted();
        context.onProgress({
            stage: 'extract',
            message: `Parsing ${input.fileName}`,
            completed: index,
            total: simInputs.length,
        });
        const model = parseSim(await read(input), input.fileName);
        productionName ??= model.production.productionName;
        shootDays.add(model.shootDays[0]?.shootDay ?? model.takes[0]?.shootDay ?? null);
        notes.push(...model.anomalies ?? []);
        perDay.push(toTables(model));
    }

    // Every input is classified, whatever role it was given. Most files state their own shoot
    // day in their header; for the few that do not, the fallback is taken in order of how
    // well the source knows: the SIM export when the run covers a single day, then whatever
    // the caller said, then nothing. A run spanning several days has no single answer, so a
    // file stating no day is left without one rather than stamped with somebody else's.
    const [onlyDay] = shootDays;
    const fallbackDay = (shootDays.size === 1 ? onlyDay : null) ?? request.options?.day ?? null;
    context.signal.throwIfAborted();
    context.onProgress({ stage: 'classify', message: `Classifying ${request.inputs.length} file(s)` });
    const documents = await analyseInputs({
        inputs: request.inputs, read, day: fallbackDay, productionName,
    });
    notes.push(...documents.notes);

    context.signal.throwIfAborted();
    context.onProgress({ stage: 'build', message: 'Building OMC entities' });
    const tables = { ...concatTables(perDay), assets: documents.rows };
    const result = buildEntities({
        tables,
        mappings: omcMappings,
        // The production name is the default namespace, not an override: a caller that named
        // one meant it. Note the context's options are already resolved, so `seedNamespace` is
        // present and null when unset — spreading them over a default would silently erase it,
        // and every identifier in the bundle would change.
        options: { ...options, seedNamespace: options.seedNamespace ?? productionName },
    });
    notes.push(...result.notes);

    context.onProgress({ stage: 'validate', message: 'Validating against the schema' });
    const seal = sealBundle({ entitiesByType: result.entitiesByType });
    const omc = Object.values(result.entitiesByType).flat();
    if (!seal.validation.valid) {
        throw new Error(validationFailureMessage(seal.validation, omc.length));
    }

    return {
        omc,
        notes,
        report: {
            counts: seal.counts,
            validation: seal.validation,
            edgeCheck: seal.edgeCheck,
            schemaVersion: options.schemaVersion,
            markdown: renderOmcReport({
                result, bundle: seal, check, mappings: omcMappings, title: productionName,
            }),
        },
    };
}

/**
 * Script-E daily reports.
 *
 * @memberof namespace:DataPipeline
 * @type {DataPipeline.PipelineDefinition}
 */
const scriptE = {
    pipelineId: 'script-e',
    label: 'Script-E daily reports',
    description: 'A filming day\'s Script-E delivery. The SIM Metabanq XML export carries the '
        + 'shot, scene and shoot-day tables; every other delivered file is recorded as an asset '
        + 'in its own right, classified by its content rather than its name.',
    version: '1.0.0',
    schemaVersions: SCHEMA_VERSIONS,
    produces: ['ProductionScene', 'Slate', 'NarrativeScene', 'Asset', 'AssetStructure', 'Provenance'],
    inputs: {
        minFiles: 1,
        maxFiles: 500,
        accept: ['.xml', '.csv', '.pdf', '.txt'],
        roles: [
            {
                role: 'sim',
                label: 'SIM Metabanq XML',
                required: true,
                // Uncapped: one export per filming day, and a run may cover several. Days are
                // built together because a production scene shot over three days is one scene.
                match: 'SIM Metabanq Day \\d+\\.xml$',
            },
            {
                role: 'delivery',
                label: 'Delivered document',
                required: false,
            },
        ],
    },
    // Cross-checking the SIM export against the Editor Log and SilverStack witnesses is the
    // CLI's `validate` command. It pairs the three per filming day, which a flat file list
    // does not say how to do, so it is not offered here.
    options: [
        {
            name: 'day',
            label: 'Filming day',
            type: 'string',
            required: false,
            help: 'Shoot day for files that do not state their own. Only consulted when the '
                + 'SIM export cannot answer, which is when a run covers more than one day.',
        },
    ],
    run,
};

export default scriptE;
