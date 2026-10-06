/**
 * Runnable check for the Frame.io pipeline, against a stubbed API.
 *
 * `node src/sources/frameio/frameio.verify.mjs` — throws on failure, prints a summary on success.
 * There is no test runner in this package, so this sits beside the code and is imported by nothing.
 *
 * The stub is the point: it exercises the whole pipeline — account resolution, pagination, the
 * folder walk, version stacks, throttling, the OMC mapping and schema validation — with no
 * credential and no network. What it cannot check is whether the real API matches the OpenAPI
 * document it was written from; only a run against Frame.io does that.
 */

import { omcIdentifier } from 'omc-util';

import { createContext } from '../../pipelines/context.js';
import { runPipeline } from '../../pipelines/registry.js';

const V3 = 'https://movielabs.com/omc/json/schema/v3.0';
const ACCOUNT = 'acc-1';
const PROJECT = 'proj-1';

const assert = (condition, message) => {
    if (!condition) throw new Error(`FAILED: ${message}`);
};

/* ------------------------------------------------------------------ the stubbed Frame.io API */

/**
 * Metadata as `include=metadata` delivers it: name/value pairs, not fixed fields.
 *
 * `mutable` separates Frame.io's own inspection of the media from what a person typed, and that is
 * the split the default mapping uses to decide what describes the bytes and what describes the take.
 *
 * @param {Array<[string, *, boolean]>} entries - name, value, mutable
 * @returns {Array<Object>} A metadata array
 */
const metadata = (entries) => entries.map(([name, value, mutable]) => ({
    field_definition_name: name,
    field_type: typeof value === 'number' ? 'number' : 'text',
    mutable: Boolean(mutable),
    value,
}));

const FILES = {
    'file-a': {
        id: 'file-a',
        name: 'slate_01.mov',
        type: 'file',
        media_type: 'video/quicktime',
        file_size: 10_485_760,
        parent_id: 'root',
        project_id: PROJECT,
        status: 'transcoded',
        created_at: '2026-01-02T03:04:05Z',
        updated_at: '2026-01-03T03:04:05Z',
        view_url: 'https://next.frame.io/project/proj-1/view/file-a',
        metadata: metadata([
            ['Slate', '13A', true],
            ['Take', '1', true],
            ['Scene', '13', true],
            // The metadata field, which is one text box — not the review threads below.
            ['Comments', 'good one', true],
            ['Characters', [{ display_name: 'DANTE' }, { display_name: 'OLIVER' }], true],
            ['Video Codec', 'ProRes 422', false],
            ['Comment Count', 2, false],
            // A custom field named like a structural column. Frame.io permits it, and letting it
            // through would repoint every identifier in the run.
            ['fileId', 'not-the-real-id', true],
        ]),
    },
    'file-b': {
        id: 'file-b',
        name: 'callsheet.pdf',
        type: 'file',
        media_type: 'application/pdf',
        file_size: 204_800,
        parent_id: 'root',
        project_id: PROJECT,
        status: 'uploaded',
        created_at: '2026-01-02T03:04:05Z',
        updated_at: '2026-01-02T03:04:05Z',
        view_url: 'https://next.frame.io/project/proj-1/view/file-b',
    },
    'file-c': {
        id: 'file-c',
        name: 'notes.xyzzy',
        type: 'file',
        media_type: 'application/x-unheard-of',
        file_size: 12,
        parent_id: 'sub',
        project_id: PROJECT,
        status: 'uploaded',
        created_at: '2026-01-04T03:04:05Z',
        updated_at: '2026-01-04T03:04:05Z',
        view_url: 'https://next.frame.io/project/proj-1/view/file-c',
    },
    'file-d': {
        id: 'file-d',
        name: 'cut_v3.mp4',
        type: 'file',
        media_type: 'video/mp4',
        file_size: 52_428_800,
        parent_id: 'stack-1',
        project_id: PROJECT,
        status: 'transcoded',
        created_at: '2026-01-05T03:04:05Z',
        updated_at: '2026-01-06T03:04:05Z',
        view_url: 'https://next.frame.io/project/proj-1/view/file-d',
        // Slate without a take: half a key is not a key, so this file gets no SlateId.
        metadata: metadata([
            ['Slate', '16B', true],
            ['Comment Count', 0, false],
        ]),
    },
};

/**
 * Comments, as `GET …/files/{id}/comments?include=owner,replies` returns them.
 *
 * `owner` and `replies` only exist because the listing asks for them — the comment record itself
 * names nobody and carries no thread. file-a has two, one of them with a reply, so the fold from
 * three rows to one Asset carrying three annotations is actually exercised.
 */
const COMMENTS = {
    'file-a': [
        {
            id: 'com-1',
            file_id: 'file-a',
            text: 'best so far',
            timestamp: 1007,
            created_at: '2026-04-10T01:50:52Z',
            updated_at: '2026-04-10T01:50:52Z',
            owner: { id: 'usr-1', name: 'Dana Reviewer', email: 'dana@example.com' },
            // **No `owner`, and no timestamp.** `include=owner` decorates the top-level comments
            // and stops there; verified against the live API, where a nested reply has no `owner`
            // key at all. Its author is only reachable by fetching the reply on its own.
            replies: [
                {
                    id: 'com-1r',
                    file_id: 'file-a',
                    text: 'agreed',
                    timestamp: null,
                    created_at: '2026-04-10T02:00:00Z',
                    updated_at: '2026-04-10T02:00:00Z',
                },
            ],
        },
        {
            id: 'com-2',
            file_id: 'file-a',
            text: 'now best one',
            timestamp: 1122,
            created_at: '2026-04-10T01:51:42Z',
            updated_at: '2026-04-10T01:51:42Z',
            owner: { id: 'usr-1', name: 'Dana Reviewer', email: 'dana@example.com' },
        },
    ],
};

/** Root is paginated into two pages, so the cursor path is actually exercised. */
const CHILDREN = {
    root: [
        [FILES['file-a']],
        [
            FILES['file-b'],
            { id: 'sub', name: 'Day 01', type: 'folder', parent_id: 'root' },
            {
                id: 'stack-1',
                name: 'The Cut',
                type: 'version_stack',
                parent_id: 'root',
                head_version: FILES['file-d'],
            },
            { id: 'odd-1', name: 'mystery', type: 'collection', parent_id: 'root' },
        ],
    ],
    sub: [[FILES['file-c']]],
};

/** Authors the single-comment endpoint reveals, which the listing withholds for a reply. */
const REPLY_AUTHORS = {
    'com-1r': { id: 'usr-2', name: 'Sam Editor', email: 'sam@example.com' },
};

/**
 * A fetch that answers like Frame.io, counts requests, and throttles once.
 *
 * @param {Object} [params]
 * @param {number} [params.throttleOn] - Request number to answer with a 429
 * @param {Array<Object>} [params.accounts] - What GET /v4/accounts returns
 * @returns {Function} A `context.fetch`
 */
function stubFetch({ throttleOn = 2, accounts = [{ id: ACCOUNT, display_name: 'Test Account' }] } = {}) {
    let calls = 0;
    const json = (body) => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        json: async () => body,
        text: async () => JSON.stringify(body),
    });

    const impl = async (url) => {
        calls += 1;
        impl.calls = calls;
        if (calls === throttleOn) {
            return {
                ok: false,
                status: 429,
                statusText: 'Too Many Requests',
                // Zero seconds so the check does not actually sit out a backoff, while still
                // proving the retry path is taken and the header is read.
                headers: new Headers({ 'retry-after': '0' }),
                text: async () => '{"message":"slow down"}',
            };
        }

        const { pathname, searchParams } = new URL(url);

        // The V4 schema has two page-size types and they differ: a folder's children allows 500,
        // every other collection allows 100. Over the limit is a 422 naming it, not a clamped page.
        // Enforced here because a stub that accepted anything let a `page_size=200` ship that made
        // every comment request fail against the live API while 21 checks passed.
        const pageSize = Number(searchParams.get('page_size') ?? 50);
        const limit = /\/folders\/[^/]+\/children$/.test(pathname) ? 500 : 100;
        if (pageSize > limit) {
            return {
                ok: false,
                status: 422,
                statusText: 'Unprocessable Content',
                headers: new Headers(),
                text: async () => JSON.stringify({
                    errors: [{ detail: `${pageSize} is larger than inclusive maximum ${limit}` }],
                }),
            };
        }

        if (pathname === '/v4/accounts') return json({ data: accounts, links: { next: null } });

        if (pathname === `/v4/accounts/${ACCOUNT}/projects/${PROJECT}`) {
            // Enveloped, because the real API envelopes *everything* — a single resource comes back
            // as `{ data: { …project } }`, not as the project. An earlier version of this stub
            // returned it bare, so the pipeline read `root_folder_id` off the envelope, got
            // undefined, and reported "this project has no root folder" against a project that
            // plainly had one. Thirteen checks passed throughout. Keep the shapes honest here.
            return json({
                data: {
                    id: PROJECT, name: 'Test Production', workspace_id: 'ws-1', root_folder_id: 'root',
                },
            });
        }

        const folder = /^\/v4\/accounts\/[^/]+\/folders\/([^/]+)\/children$/.exec(pathname)?.[1];
        if (folder) {
            const pages = CHILDREN[folder] ?? [[]];
            const page = Number(searchParams.get('after') ?? 0);
            const isLast = page >= pages.length - 1;
            return json({
                data: pages[page] ?? [],
                links: { next: isLast ? null : `${pathname}?after=${page + 1}` },
            });
        }

        const commentsOn = /^\/v4\/accounts\/[^/]+\/files\/([^/]+)\/comments$/.exec(pathname)?.[1];
        if (commentsOn) {
            // Deep-cloned, because the pipeline fills each reply's author in place and a stub that
            // handed out the same objects would let one check's mutation leak into the next.
            return json({
                data: structuredClone(COMMENTS[commentsOn] ?? []),
                links: { next: null },
            });
        }

        // One comment, which is the only way to learn a reply's author. Enveloped, like everything.
        const commentId = /^\/v4\/accounts\/[^/]+\/comments\/([^/]+)$/.exec(pathname)?.[1];
        if (commentId) {
            const found = Object.values(COMMENTS).flat()
                .flatMap((c) => [c, ...(c.replies ?? [])])
                .find((c) => c.id === commentId);
            if (!found) throw new Error(`stub has no comment ${commentId}`);
            return json({ data: { ...found, owner: REPLY_AUTHORS[commentId] ?? found.owner ?? null } });
        }

        throw new Error(`stub has no answer for ${pathname}`);
    };
    impl.callCount = () => calls;
    return impl;
}

const runFrameio = ({ fetch, settings, options }) => runPipeline(
    {
        pipelineId: 'frameio',
        inputs: [],
        options: options ?? {},
        settings: settings ?? { frameioProjectId: PROJECT },
        omcOptions: { schemaVersion: V3, identifierScope: 'movielabs.com', seedNamespace: 'TEST' },
    },
    createContext({
        secrets: { frameio: 'stub-token' },
        fetch,
        options: { schemaVersion: V3, identifierScope: 'movielabs.com', seedNamespace: 'TEST' },
    }),
);

/* ------------------------------------------------------------------------------ the checks */

const results = [];
const check = async (name, fn) => {
    await fn();
    results.push(name);
};

await check('walks the tree, paginates, and builds one Asset + AssetStructure per file', async () => {
    const fetch = stubFetch();
    const out = await runFrameio({ fetch });

    const assets = out.omc.filter((e) => e.entityType === 'Asset');
    const structures = out.omc.filter((e) => e.entityType === 'AssetStructure');
    assert(assets.length === 4, `expected 4 Assets, got ${assets.length}`);
    assert(structures.length === 4, `expected 4 AssetStructures, got ${structures.length}`);
    // Page two of the root listing only arrives if links.next was followed.
    assert(assets.some((a) => a.label === 'callsheet.pdf'), 'second page of root children was not read');
    assert(assets.some((a) => a.label === 'notes.xyzzy'), 'subfolder was not descended into');
    assert(assets.some((a) => a.label === 'cut_v3.mp4'), 'version stack head was not collected');
    assert(out.report.validation.valid, 'the bundle did not validate');
});

await check('retries a 429 rather than failing the run', async () => {
    const fetch = stubFetch({ throttleOn: 2 });
    const out = await runFrameio({ fetch });
    assert(out.omc.length === 8, 'the throttled run did not produce the full result');
    assert(out.notes.some((n) => n.kind === 'retried' && /429/.test(n.detail)), 'no retry was reported');
});

await check('records file size in customData, never in fileDetails', async () => {
    const out = await runFrameio({ fetch: stubFetch() });
    const structure = out.omc.find((e) => e.entityType === 'AssetStructure' && e.label === 'slate_01.mov');
    const details = structure.assetStructureProperties.fileDetails;
    assert(!('fileSize' in details) && !('size' in details),
        `fileDetails must not carry size, got ${JSON.stringify(details)}`);
    assert(details.mediaType === 'video/quicktime', 'mediaType was not carried');
    assert(details.filePath === '/slate_01.mov', `filePath wrong: ${details.filePath}`);
    const size = structure.customData?.find((c) => c.value?.fileSize)?.value?.fileSize;
    assert(size === 10_485_760, `fileSize missing from customData, got ${size}`);
});

await check('nests a subfolder file at its folder path', async () => {
    const out = await runFrameio({ fetch: stubFetch() });
    const structure = out.omc.find((e) => e.entityType === 'AssetStructure' && e.label === 'notes.xyzzy');
    assert(structure.assetStructureProperties.fileDetails.filePath === '/Day 01/notes.xyzzy',
        `nested filePath wrong: ${structure.assetStructureProperties.fileDetails.filePath}`);
});

await check('derives assetStructureType from media type, and reports what it cannot classify', async () => {
    const out = await runFrameio({ fetch: stubFetch() });
    const typeOf = (label) => out.omc
        .find((e) => e.entityType === 'AssetStructure' && e.label === label)?.assetStructureType;
    assert(typeOf('slate_01.mov') === 'digital.movingImage', 'video did not become digital.movingImage');
    assert(typeOf('callsheet.pdf') === 'digital.document', 'pdf did not become digital.document');
    assert(typeOf('notes.xyzzy') === 'digital', 'unknown media type did not fall back to digital');
    assert(out.notes.some((n) => n.kind === 'unclassifiedMediaType'), 'unclassified media type was not reported');
});

await check('carries the Frame.io id as a second identifier, on the Asset only', async () => {
    const out = await runFrameio({ fetch: stubFetch() });
    const asset = out.omc.find((e) => e.entityType === 'Asset' && e.label === 'slate_01.mov');
    const structure = out.omc.find((e) => e.entityType === 'AssetStructure' && e.label === 'slate_01.mov');
    assert(asset.identifier.length === 2, `Asset should carry 2 identifiers, got ${asset.identifier.length}`);
    assert(asset.identifier.some((i) => i.identifierScope === 'frame.io' && i.identifierValue === 'file-a'),
        'the frame.io identifier is missing or wrong');
    assert(structure.identifier.length === 1,
        'AssetStructure must not carry the frame.io identifier — it would duplicate the Asset\'s');

    // The golden rule: no two entities in a model may share an identifier.
    const keys = out.omc.flatMap((e) => e.identifier.map((i) => omcIdentifier.idKey(i)));
    assert(new Set(keys).size === keys.length, 'two entities share an identifier');
});

await check('links each Asset to its AssetStructure', async () => {
    const out = await runFrameio({ fetch: stubFetch() });
    const asset = out.omc.find((e) => e.entityType === 'Asset' && e.label === 'slate_01.mov');
    const structure = out.omc.find((e) => e.entityType === 'AssetStructure' && e.label === 'slate_01.mov');
    const serialised = JSON.stringify(asset);
    assert(serialised.includes(structure.identifier[0].identifierValue),
        'the Asset does not reference its AssetStructure');
    assert(out.report.edgeCheck.dangling.length === 0,
        `dangling edges: ${JSON.stringify(out.report.edgeCheck.dangling)}`);
});

await check('is idempotent — a re-run produces byte-identical entities', async () => {
    const first = await runFrameio({ fetch: stubFetch() });
    const second = await runFrameio({ fetch: stubFetch() });
    const norm = (r) => JSON.stringify(r.omc.map((e) => e.identifier).sort());
    assert(norm(first) === norm(second), 'identifiers differ between runs');
    assert(JSON.stringify(first.omc) === JSON.stringify(second.omc), 'entities differ between runs');
});

await check('unwraps the response envelope on a single resource', async () => {
    // Regression: the project fetch used to read `root_folder_id` off the raw body. Everything the
    // V4 API returns is wrapped in `data`, so it read undefined and the run died claiming the
    // project had no root folder. Asserted directly rather than left implicit in the walk, because
    // the failure it caused looked like bad configuration rather than a parsing mistake.
    const seen = [];
    const base = stubFetch();
    const spy = async (url, init) => {
        seen.push(new URL(url).pathname);
        return base(url, init);
    };
    const out = await runFrameio({ fetch: spy });
    assert(seen.includes(`/v4/accounts/${ACCOUNT}/projects/${PROJECT}`), 'the project was never fetched');
    assert(out.omc.length === 8, 'the walk did not start, so the root folder was not resolved');
    assert(out.report.counts.frameioProject === 'Test Production',
        `project name came from inside the envelope: got ${out.report.counts.frameioProject}`);
});

await check('reports an unhandled child type rather than dropping it', async () => {
    const out = await runFrameio({ fetch: stubFetch() });
    assert(out.notes.some((n) => n.kind === 'unknownChildType' && /collection/.test(n.detail)),
        'the unhandled child type was not reported');
});

await check('resolves a single account silently and refuses an ambiguous one by name', async () => {
    const one = await runFrameio({ fetch: stubFetch() });
    assert(one.notes.some((n) => n.kind === 'accountResolved'), 'the resolved account was not reported');

    const many = stubFetch({
        accounts: [{ id: 'acc-1', display_name: 'One' }, { id: 'acc-2', display_name: 'Two' }],
    });
    const failure = await runFrameio({ fetch: many }).catch((err) => err);
    assert(failure instanceof Error, 'an ambiguous account should have failed the run');
    assert(/frameioAccountId/.test(failure.message) && /acc-2/.test(failure.message),
        `the error should name the setting and the candidates, got: ${failure.message}`);
});

await check('uses a configured mapping template in place of its own', async () => {
    // The point of the whole exercise: the same walk, mapped differently, without touching this
    // pipeline. A deliberately minimal template — one entity, one property — so the output could
    // not be mistaken for the built-in mapping's.
    const out = await runPipeline(
        {
            pipelineId: 'frameio',
            inputs: [],
            settings: { frameioProjectId: PROJECT },
            omcOptions: { schemaVersion: V3, identifierScope: 'movielabs.com', seedNamespace: 'TEST' },
            mappings: {
                files: [{
                    entityType: 'Asset',
                    key: 'fileId',
                    properties: { label: 'fileName' },
                }],
            },
        },
        createContext({
            secrets: { frameio: 'stub-token' },
            fetch: stubFetch(),
            options: { schemaVersion: V3, identifierScope: 'movielabs.com', seedNamespace: 'TEST' },
        }),
    );

    assert(out.omc.every((e) => e.entityType === 'Asset'),
        `the template decided what was built, got ${[...new Set(out.omc.map((e) => e.entityType))].join(', ')}`);
    assert(out.omc.length === 4, `expected 4 Assets, got ${out.omc.length}`);
    assert(out.omc.every((e) => e.assetFunction === undefined && e.customData === undefined),
        'the built-in mapping did not also run');
    assert(out.notes.some((n) => n.kind === 'mappingFromTemplate'),
        'the run does not say it used a template');

    // The frame.io second identifier belongs to the built-in mapping, which reads it back out of
    // customData. A template decides its own identifiers, so it must not be bolted on.
    assert(out.omc.every((e) => e.identifier.length === 1),
        'a templated entity was given the built-in mapping\'s extra identifier');
});

await check('falls back to its own mapping when no template is configured', async () => {
    const out = await runFrameio({ fetch: stubFetch() });
    assert(out.omc.some((e) => e.entityType === 'AssetStructure'),
        'the built-in mapping should still run when nothing is attached');
    assert(!out.notes.some((n) => n.kind === 'mappingFromTemplate'), 'it should not claim a template');
});

await check('asks for metadata, and carries it as columns under Frame.io\'s own field names', async () => {
    const seen = [];
    const base = stubFetch();
    const out = await runFrameio({
        fetch: async (url, init) => {
            seen.push(url);
            return base(url, init);
        },
    });
    assert(seen.some((u) => /\/folders\/root\/children\?.*include=metadata/.test(u)),
        `the walk did not ask for metadata: ${seen.find((u) => /children/.test(u))}`);

    const asset = out.omc.find((e) => e.entityType === 'Asset' && e.label === 'slate_01.mov');
    const custom = asset.customData.find((c) => c.domain === 'Frame.io').value;
    // Verbatim, spaces and all: a template names its columns as strings and matches them exactly,
    // so tidying the name would silently map nothing.
    assert(custom.Slate === '13A' && custom.Take === '1', `production metadata missing: ${JSON.stringify(custom)}`);
    assert(custom.Characters === 'DANTE; OLIVER',
        `a list-valued field should flatten to one cell, got ${JSON.stringify(custom.Characters)}`);

    // The technical half goes to the structure, and only there.
    const structure = out.omc.find((e) => e.entityType === 'AssetStructure' && e.label === 'slate_01.mov');
    const structural = structure.customData.find((c) => c.domain === 'Frame.io').value;
    assert(structural['Video Codec'] === 'ProRes 422', 'the codec did not reach the AssetStructure');
    assert(!('Slate' in structural), 'production metadata must not be copied onto the AssetStructure');
    assert(!('Video Codec' in custom), 'technical metadata must not be copied onto the Asset');
});

await check('derives SlateId from Slate and Take, and not from half of them', async () => {
    const out = await runFrameio({ fetch: stubFetch() });
    const customOf = (label) => out.omc
        .find((e) => e.entityType === 'Asset' && e.label === label)
        .customData?.find((c) => c.domain === 'Frame.io')?.value ?? {};
    assert(customOf('slate_01.mov').SlateId === '13A-1',
        `SlateId wrong: ${JSON.stringify(customOf('slate_01.mov').SlateId)}`);
    // file-d has a Slate and no Take. "16B-" would collide with every other take of that slate.
    assert(!('SlateId' in customOf('cut_v3.mp4')),
        `a slate without a take must not produce a SlateId, got ${customOf('cut_v3.mp4').SlateId}`);
});

await check('a metadata field cannot shadow a structural column', async () => {
    const out = await runFrameio({ fetch: stubFetch() });
    const asset = out.omc.find((e) => e.entityType === 'Asset' && e.label === 'slate_01.mov');
    // file-a carries a custom field called `fileId`. Everything is seeded from the real one.
    assert(asset.identifier.some((i) => i.identifierValue === 'file-a'),
        'the run was reseeded from a metadata field named fileId');
    assert(!asset.identifier.some((i) => i.identifierValue === 'not-the-real-id'),
        'a metadata field overwrote the key');
    assert(out.notes.some((n) => n.kind === 'metadataNameCollision' && n.where === 'fileId'),
        'the collision was not reported');
});

await check('folds many comment rows into one Asset as many annotations', async () => {
    const out = await runFrameio({ fetch: stubFetch() });
    const asset = out.omc.find((e) => e.entityType === 'Asset' && e.label === 'slate_01.mov');

    // Two comments and one reply — three rows in the comments table, three annotations on the one
    // Asset the files table already built. This is the whole point of the second dataset.
    assert(asset.annotation?.length === 3,
        `expected 3 annotations, got ${JSON.stringify(asset.annotation)}`);
    assert(asset.annotation.some((a) => a.text === 'best so far' && a.author === 'Dana Reviewer'),
        'the comment text and its author did not both arrive');
    // The reply's author is not in the listing at all — it is fetched separately, because
    // `include=owner` decorates only the top-level comments.
    assert(asset.annotation.some((a) => a.text === 'agreed' && a.author === 'Sam Editor'),
        `a threaded reply lost its author: ${JSON.stringify(asset.annotation)}`);
    assert(asset.annotation.filter((a) => typeof a.title === 'string').length === 2,
        `only a pinned comment has a frame, got ${JSON.stringify(asset.annotation)}`);

    // Merging in a second Asset must not have disturbed the first one's work.
    assert(asset.identifier.some((i) => i.identifierScope === 'frame.io'),
        'the fold lost the frame.io identifier');
    assert(JSON.stringify(asset).includes('AssetStructure') || out.report.edgeCheck.dangling.length === 0,
        'the fold lost the edge to the AssetStructure');
    assert(out.report.validation.valid, 'the bundle with annotations did not validate');

    // Only the file that has comments is asked about — the other three cost nothing — plus one
    // request for the single reply, whose author the listing does not carry.
    assert(out.report.counts.commentRequests === 2,
        `expected 2 comment requests (1 listing + 1 reply), got ${out.report.counts.commentRequests}`);
    assert(out.report.counts.comments === 3, `expected 3 comment rows, got ${out.report.counts.comments}`);
});

await check('re-running does not duplicate annotations', async () => {
    // The property the whole adaptive loop rests on, and the one a concatenating merge would break:
    // fMam merges on write, so an annotation array that grew every run would triple after three.
    const first = await runFrameio({ fetch: stubFetch() });
    const second = await runFrameio({ fetch: stubFetch() });
    assert(JSON.stringify(first.omc) === JSON.stringify(second.omc), 'entities differ between runs');
    const asset = second.omc.find((e) => e.entityType === 'Asset' && e.label === 'slate_01.mov');
    assert(asset.annotation.length === 3, `annotations multiplied: ${asset.annotation.length}`);
});

await check('refuses a run with no project configured, naming the setting', async () => {
    const failure = await runFrameio({ fetch: stubFetch(), settings: {} }).catch((err) => err);
    assert(failure instanceof Error, 'a missing project should have failed the run');
    assert(/frameioProjectId/.test(failure.message), `the error should name the setting, got: ${failure.message}`);
});

await check('refuses a run with no credential, naming it', async () => {
    const failure = await runPipeline(
        {
            pipelineId: 'frameio',
            inputs: [],
            options: {},
            settings: { frameioProjectId: PROJECT },
            omcOptions: { schemaVersion: V3 },
        },
        createContext({ fetch: stubFetch(), options: { schemaVersion: V3 } }),
    ).catch((err) => err);
    assert(failure instanceof Error, 'a missing secret should have failed the run');
    assert(/frameio/.test(failure.message), `the error should name the secret, got: ${failure.message}`);
});

await check('refuses a schema version it does not build', async () => {
    const failure = await runPipeline(
        {
            pipelineId: 'frameio',
            inputs: [],
            settings: { frameioProjectId: PROJECT },
            omcOptions: { schemaVersion: 'https://movielabs.com/omc/json/schema/v2.6' },
        },
        createContext({ secrets: { frameio: 'x' }, fetch: stubFetch() }),
    ).catch((err) => err);
    assert(failure instanceof Error, 'an unsupported schema version should have been refused');
    assert(/schemaVersionNotSupported|v2.6/.test(failure.message),
        `unexpected message: ${failure.message}`);
});

console.log(`frameio.verify: ${results.length} checks passed`);
results.forEach((r) => console.log(`  ok  ${r}`));
