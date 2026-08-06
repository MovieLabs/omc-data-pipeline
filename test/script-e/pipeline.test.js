import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { fsContext, getPipeline, runPipeline } from '../../src/pipelines/index.js';
import { indexByIdentity, repoRoot } from '../harness.js';

const PIPELINE_ID = 'script-e';
const SOURCE_ROOT = path.join(repoRoot, 'WWDOAT/sourceData/Script-E');
const GOLDEN_DIR = path.join(repoRoot, 'WWDOAT/omc');
const GOLDEN_FILES = [
    'productionScene', 'slate', 'narrativeScene', 'asset', 'assetStructure', 'provenance',
];

/**
 * Two properties legitimately differ between the golden bundle and a pipeline run, and both
 * are facts about the run rather than about the delivery:
 *
 * - `AssetStructure.assetStructureProperties.fileDetails.filePath` — where the file lives. The
 *   golden bundle records a repository-relative path; a service records a storage URL.
 * - `Asset.customData[].value.shootDay` — the golden bundle is four per-day CLI runs, each of
 *   which knew its day from the directory it read. One run over all four days does not, so a
 *   file that does not state its own shoot day has none. Pinned by its own test below.
 *
 * Everything else must match exactly.
 *
 * @param {OmcEntity} entity - The entity to normalize
 * @returns {string} A comparable form
 */
function comparable(entity) {
    const copy = structuredClone(entity);
    delete copy.assetStructureProperties?.fileDetails?.filePath;
    for (const custom of copy.customData ?? []) delete custom.value?.shootDay;
    return JSON.stringify(copy);
}

/**
 * Every filming day's files, as one run's inputs. Refs are relative to the source root, so a
 * single context spans all four days.
 *
 * Days are run together rather than one at a time because that is what the golden bundle is:
 * a production scene shot over three days is one scene, not three.
 *
 * @param {DataPipeline.PipelineDefinition} definition - The pipeline
 * @returns {Promise<Array<DataPipeline.PipelineInput>>} The inputs
 */
async function allDayInputs(definition) {
    const { roles } = definition.inputs;
    const fallback = roles.find((r) => !r.match)?.role ?? roles[0].role;
    const days = (await readdir(SOURCE_ROOT, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && /^Filming Day \d+$/.test(e.name))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const inputs = [];
    for (const day of days) {
        const names = (await readdir(path.join(SOURCE_ROOT, day), { withFileTypes: true }))
            .filter((e) => e.isFile())
            .map((e) => e.name)
            .sort((a, b) => a.localeCompare(b));
        for (const fileName of names) {
            inputs.push({
                role: roles.find((r) => r.match && new RegExp(r.match, 'i').test(fileName))?.role ?? fallback,
                fileName,
                ref: `${day}/${fileName}`,
            });
        }
    }
    return inputs;
}

/**
 * The committed bundle, flattened.
 *
 * @returns {Promise<Array<OmcEntity>>} Every golden entity
 */
async function goldenEntities() {
    const bundles = await Promise.all(GOLDEN_FILES
        .map(async (f) => JSON.parse(await readFile(path.join(GOLDEN_DIR, `${f}.json`), 'utf8'))));
    return bundles.flat();
}

test('script-e builds the committed bundle from the committed sources', async (t) => {
    const definition = getPipeline(PIPELINE_ID);
    assert.ok(definition, 'the script-e pipeline is registered');

    const inputs = await allDayInputs(definition);
    const progress = [];
    const context = fsContext({
        baseDir: SOURCE_ROOT,
        onProgress: (p) => progress.push(p.stage),
    });

    const result = await runPipeline({ pipelineId: PIPELINE_ID, inputs }, context);

    await t.test('every entity validates and every edge resolves', () => {
        assert.equal(result.report.validation.valid, true,
            `validation failures: ${JSON.stringify(result.report.validation.failures.slice(0, 3))}`);
        assert.deepEqual(result.report.edgeCheck.dangling, []);
    });

    await t.test('progress is reported for each stage', () => {
        assert.deepEqual(progress, ['check', 'extract', 'extract', 'extract', 'extract', 'classify', 'build', 'validate']);
    });

    const golden = await goldenEntities();
    const built = indexByIdentity(result.omc);
    const expected = indexByIdentity(golden);

    await t.test('the same entities are built, identifier for identifier', () => {
        assert.equal(built.size, expected.size, 'entity count matches the golden bundle');
        const missing = [...expected.keys()].filter((k) => !built.has(k));
        const extra = [...built.keys()].filter((k) => !expected.has(k));
        assert.deepEqual(missing, [], 'no golden entity is missing');
        assert.deepEqual(extra, [], 'no entity is built that the golden bundle lacks');
    });

    await t.test('each entity matches the golden bundle', () => {
        const differing = [];
        for (const [key, entity] of built) {
            const gold = expected.get(key);
            if (!gold) continue;
            if (comparable(entity) !== comparable(gold)) differing.push(key);
        }
        assert.deepEqual(differing, []);
    });
});

test('the fallback shoot day is taken from the SIM export, not the request', async (t) => {
    const definition = getPipeline(PIPELINE_ID);
    const dir = path.join(SOURCE_ROOT, 'Filming Day 2');
    const names = (await readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isFile()).map((e) => e.name).sort((a, b) => a.localeCompare(b));
    const { roles } = definition.inputs;
    const fallback = roles.find((r) => !r.match)?.role ?? roles[0].role;
    const inputs = names.map((fileName) => ({
        role: roles.find((r) => r.match && new RegExp(r.match, 'i').test(fileName))?.role ?? fallback,
        fileName,
        ref: fileName,
    }));

    /** The shoot days recorded on this run's Assets, whatever their source. */
    const shootDaysOf = (result) => new Set(result.omc
        .filter((e) => e.entityType === 'Asset')
        .flatMap((e) => (e.customData ?? []).map((c) => c.value?.shootDay))
        .filter((d) => d !== undefined));

    await t.test('a single-day run reads the day off the SIM export', async () => {
        const result = await runPipeline(
            { pipelineId: PIPELINE_ID, inputs },
            fsContext({ baseDir: dir }),
        );
        assert.deepEqual([...shootDaysOf(result)], ['2'],
            'every asset on a day-2 delivery is stamped day 2, whether or not it says so itself');
    });

    await t.test('the caller cannot override what the SIM export states', async () => {
        const result = await runPipeline(
            { pipelineId: PIPELINE_ID, inputs, options: { day: '99' } },
            fsContext({ baseDir: dir }),
        );
        assert.deepEqual([...shootDaysOf(result)], ['2'],
            'the delivery outranks the request');
    });
});

test('a run missing its required role is refused before reading anything', async () => {
    await assert.rejects(
        () => runPipeline({
            pipelineId: PIPELINE_ID,
            inputs: [{ role: 'delivery', fileName: 'notes.pdf', ref: 'notes.pdf' }],
        }, fsContext({ baseDir: SOURCE_ROOT })),
        /missingRequiredRole/,
    );
});

test('a run naming a role the pipeline does not have is refused', async () => {
    await assert.rejects(
        () => runPipeline({
            pipelineId: PIPELINE_ID,
            inputs: [{ role: 'sim', fileName: 'a.xml', ref: 'a.xml' },
                { role: 'invented', fileName: 'b.pdf', ref: 'b.pdf' }],
        }, fsContext({ baseDir: SOURCE_ROOT })),
        /unknownRole/,
    );
});

test('a run against a schema version the pipeline does not build is refused', async () => {
    await assert.rejects(
        () => runPipeline({
            pipelineId: PIPELINE_ID,
            inputs: [{ role: 'sim', fileName: 'a.xml', ref: 'a.xml' }],
            omcOptions: { schemaVersion: 'https://movielabs.com/omc/json/schema/v2.6' },
        }, fsContext({ baseDir: SOURCE_ROOT })),
        /schemaVersionNotSupported/,
    );
});

test('an unknown pipeline names the ones that exist', async () => {
    await assert.rejects(
        () => runPipeline({ pipelineId: 'no-such-source', inputs: [] }),
        /Unknown pipeline "no-such-source".*script-e/s,
    );
});

test('an input resolving outside the base directory is refused', async () => {
    const context = fsContext({ baseDir: SOURCE_ROOT });
    await assert.rejects(
        () => context.read({ ref: '../../../package.json' }),
        /resolves outside/,
    );
});
