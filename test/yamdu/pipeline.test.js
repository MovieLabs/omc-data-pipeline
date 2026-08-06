import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createContext, getPipeline, runPipeline } from '../../src/pipelines/index.js';
import { repoRoot } from '../harness.js';

const PIPELINE_ID = 'yamdu';
const FIXTURES = path.join(repoRoot, 'WWDOAT/sourceData/Yamdu');
const V3 = 'https://movielabs.com/omc/json/schema/v3.0';

/**
 * A stand-in for the Yamdu API, answering from the committed fixtures.
 *
 * This is why `fetch` is reached through the context rather than called directly: the whole
 * pipeline — pagination, migration, validation, the failure path — is exercised without a token
 * and without touching the live source.
 *
 * Endpoints with no fixture answer 404, which is not contrived: Yamdu exposes endpoints for entity
 * kinds a production may not use, and the run has to survive them.
 *
 * @returns {{fetch: Function, calls: Array<string>}} The stub and a log of what was asked for
 */
async function yamduStub() {
    const files = await readdir(FIXTURES);
    const byEndpoint = new Map();
    for (const file of files) {
        // allCharacters.json -> AllCharacters. The fixture for AllNarrativeWardrobes is singular,
        // so lookup tolerates a missing trailing 's'.
        const stem = file.replace(/\.json$/, '');
        byEndpoint.set(stem.charAt(0).toUpperCase() + stem.slice(1), file);
    }

    const calls = [];
    const fetch = async (url) => {
        calls.push(url);
        const { pathname, searchParams } = new URL(url);
        const endpoint = pathname.split('/').pop();
        const file = byEndpoint.get(endpoint) ?? byEndpoint.get(endpoint.replace(/s$/, ''));
        if (!file) {
            return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
        }
        const all = JSON.parse(await readFile(path.join(FIXTURES, file), 'utf8'));
        const entities = Array.isArray(all) ? all : all.data ?? [];

        // Honour the offset/limit the pipeline sends, so pagination is genuinely exercised.
        const offset = Number(searchParams.get('offset') ?? 0);
        const limit = Number(searchParams.get('limit') ?? 50);
        const page = entities.slice(offset, offset + limit);
        return {
            ok: true,
            status: 200,
            json: async () => ({
                data: page,
                pagination: { hasMore: offset + page.length < entities.length },
            }),
        };
    };
    return { fetch, calls };
}

const runYamdu = async ({ settings, secrets = { yamdu: 'test-token' }, schemaVersion = V3 } = {}) => {
    const { fetch, calls } = await yamduStub();
    const context = createContext({ secrets, fetch, options: { schemaVersion } });
    const result = await runPipeline({
        pipelineId: PIPELINE_ID,
        inputs: [],
        settings: settings ?? { yamduProjectId: '129593' },
        omcOptions: { schemaVersion },
    }, context);
    return { result, calls };
};

test('yamdu is registered and takes no files', () => {
    const definition = getPipeline(PIPELINE_ID);
    assert.ok(definition, 'the yamdu pipeline is registered');
    assert.equal(definition.inputs.minFiles, 0);
    assert.deepEqual(definition.inputs.roles, []);
    assert.deepEqual(definition.secrets, ['yamdu']);
});

test('yamdu reads the API and delivers the project schema version', async (t) => {
    const { result, calls } = await runYamdu();

    await t.test('every in-project fixture entity arrives', () => {
        // 126 in the fixtures, of which 38 are creative works belonging to other productions —
        // AllCreativeWorks answers for the whole organisation. See the scoping test below.
        assert.equal(result.omc.length, 88);
    });

    await t.test('the bearer token and project id reach the request', () => {
        assert.ok(calls.every((u) => u.includes('project=129593')), 'every call names the project');
        assert.ok(calls.length >= 10, `expected a call per endpoint, got ${calls.length}`);
    });

    await t.test('entities are migrated from v2.6 to the target version', () => {
        const versions = [...new Set(result.omc.map((e) => e.schemaVersion))];
        assert.deepEqual(versions, [V3], `expected only v3.0, got ${versions.join(', ')}`);
        assert.ok(
            result.notes.some((n) => n.kind === 'migrated'),
            'the migration is reported as a note',
        );
    });

    await t.test('Context edges survive the migration', () => {
        // Yamdu embeds its Contexts, so migrate can hoist their edges unaided. If that ever stops
        // being true this is the assertion that catches it, rather than a silently thinner graph.
        const withEdges = result.omc.filter((e) => e.edges && Object.keys(e.edges).length);
        assert.ok(withEdges.length > 0, 'no entity came through with edges');
        assert.ok(
            result.omc.every((e) => !e.Context || e.Context === null),
            'Context should be gone once its edges are hoisted',
        );
    });

    await t.test('everything validates', () => {
        assert.equal(result.report.validation.valid, true,
            JSON.stringify(result.report.validation.failures.slice(0, 3)));
    });

    await t.test('a shootDay Context survives migration intact', () => {
        // The case that broke: v2.6 carries contextProperties flat, and the v2.8->v3.0 step treated
        // anything it did not recognise as an edge predicate — filing scalars where reference
        // arrays belong, then deleting them from the entity. Asserted here because the rest of the
        // Yamdu fixtures contain no Context at all, so nothing else covers it.
        const cxt = result.omc.find((e) => e.entityType === 'Context');
        assert.ok(cxt, 'a Context came through');

        assert.deepEqual(
            cxt.contextProperties,
            { shootDay: { shootDay: 1, shootDate: '2026-01-23' } },
            'contextProperties is nested under the sub-type, values untouched',
        );
        assert.equal(typeof cxt.contextProperties.shootDay.shootDay, 'number',
            'the day stays a number — both versions type it string|number|null');

        assert.ok(Array.isArray(cxt.edges?.has?.ProductionScene),
            'the has predicate became an edge with a reference array');
        assert.ok(Array.isArray(cxt.edges?.for?.CreativeWork),
            'the for predicate became an edge with a reference array');
        assert.equal(cxt.edges.contextProperties, undefined,
            'contextProperties must never be filed as an edge');
    });

    await t.test('no edge node is malformed', () => {
        // checkEdgeTargets reports these rather than throwing; a non-empty list means something
        // that is not a list of references has been filed under edges.
        assert.deepEqual(result.report.edgeCheck.malformed, []);
    });

    await t.test('customData is named only where Yamdu actually keyed it by domain', () => {
        // Yamdu uses customData two ways, and telling them apart matters. A Context carries
        // `{ yamdu: {…} }` — a domain map. A ProductionScene carries production fields directly:
        // `{ scheduledDuration: "0:00", hasBeenShot: false, subject: "Phoebe eating", … }`.
        // Lifting keys to domains unconditionally would shred that second one into nineteen
        // entries with domains called "scheduledDuration" and "hasBeenShot".
        const cxt = result.omc.find((e) => e.entityType === 'Context');
        assert.deepEqual(
            cxt.customData,
            [{
                domain: 'yamdu',
                value: {
                    shootingPhase: {
                        identifier: 'com.yamdu.app.shootingPhase.77150',
                        name: 'Shooting',
                    },
                },
            }],
            'a domain map is lifted, and the key is removed from value rather than left inside it',
        );

        const scene = result.omc.find((e) => e.entityType === 'ProductionScene' && e.customData?.length);
        assert.equal(scene.customData.length, 1, 'flat data stays one entry');
        assert.equal(scene.customData[0].domain, null, 'with no invented domain');
        assert.equal(scene.customData[0].value.subject, 'Phoebe eating',
            'and its fields intact');

        assert.ok(result.notes.some((n) => n.kind === 'customDataDomains'),
            'the reshaping is reported rather than silent');
    });

    await t.test('endpoints with no fixture are reported, not fatal', () => {
        const unavailable = result.notes.filter((n) => n.kind === 'endpointUnavailable');
        assert.ok(unavailable.length > 0, 'the 404 endpoints should be noted');
        assert.ok(result.omc.length > 0, 'a failed endpoint must not empty the run');
    });
});

test('creative works from other productions are discarded', async () => {
    // AllCreativeWorks answers for the whole organisation, so the response carries other people's
    // productions. Two identifier shapes have to be told apart, which is why this is not a
    // substring match: a project names itself in its own identifier, while an episode carries its
    // own id and names the project through Season.
    const { default: scopeToProject } = await import('../../src/sources/yamdu/projectScope.js');
    const cw = (identifierValue, extra = {}) => ({
        entityType: 'CreativeWork',
        identifier: [{ identifierScope: 'com.yamdu.app', identifierValue }],
        ...extra,
    });
    const season = (projectId) => ({
        Season: [{ identifier: [{ identifierValue: `com.yamdu.app.project.${projectId}` }] }],
    });

    const { entities, dropped } = scopeToProject([
        cw('com.yamdu.app.project.129593'), // ours
        cw('com.yamdu.app.project.128054'), // another production
        cw('com.yamdu.app.episode.114429', season('129593')), // our episode
        cw('com.yamdu.app.episode.114430', season('128054')), // someone else's episode
        cw('com.yamdu.app.project.12959'), // a prefix of ours — must not match
        { entityType: 'Character', identifier: [{ identifierValue: 'com.yamdu.app.role.1' }] },
    ], '129593');

    assert.equal(dropped, 3);
    assert.deepEqual(
        entities.map((e) => e.identifier[0].identifierValue),
        [
            'com.yamdu.app.project.129593',
            'com.yamdu.app.episode.114429',
            'com.yamdu.app.role.1',
        ],
        'keeps our project, our episode via Season, and every non-CreativeWork untouched',
    );
});

test('the real pull is scoped to one production', async () => {
    const { result } = await runYamdu();
    const works = result.omc.filter((e) => e.entityType === 'CreativeWork');
    assert.equal(works.length, 1, 'the sample pull spans 21 productions; one is ours');
    assert.equal(works[0].identifier[0].identifierValue, 'com.yamdu.app.project.129593');
    assert.ok(result.notes.some((n) => n.kind === 'outOfProject'),
        'the discarded works are reported rather than silently dropped');
});

test('migrating an already-migrated Context does not bury its properties deeper', async () => {
    // Migration has to be safe to run twice: the Portal offers a Migrate control the user can press
    // again, and without a guard each press would add another wrapper.
    const { omcMigrate } = await import('omc-util');
    const source = JSON.parse(await readFile(path.join(FIXTURES, 'allShootDayContexts.json'), 'utf8'));

    const once = omcMigrate(source, V3);
    // Re-label as the previous version so the chain runs over it a second time.
    const twice = omcMigrate(
        once.map((e) => ({ ...e, schemaVersion: 'https://movielabs.com/omc/json/schema/v2.8' })),
        V3,
    );
    assert.deepEqual(twice[0].contextProperties, once[0].contextProperties);
});

test('a run with no Yamdu project configured says what to do about it', async () => {
    await assert.rejects(
        () => runYamdu({ settings: {} }),
        /No Yamdu project configured.*yamduProjectId/s,
    );
});

test('a run with no credential names the one it wanted', async () => {
    await assert.rejects(
        () => runYamdu({ secrets: {} }),
        /No secret named "yamdu"/,
    );
});

test('a schema version the pipeline does not deliver is refused', async () => {
    await assert.rejects(
        () => runYamdu({ schemaVersion: 'https://movielabs.com/omc/json/schema/v2.1' }),
        /schemaVersionNotSupported/,
    );
});
