/**
 * Flatten a Frame.io project to one row per file, for eyeballing values and authoring a mapping
 * template against real columns.
 *
 * **The rows are the pipeline's own** — `buildRows` from `src/sources/frameio/rows.js`, the same
 * function a run uses. That is the point: a template authored against this CSV names columns the
 * pipeline actually produces, and `SlateId` cannot mean one thing here and another there. Only the
 * walk is local, because this script samples with hardcoded ids and a request budget rather than
 * reading a project's settings.
 *
 * Read-only: `GET` requests and nothing else. Pass `--from-json` to rebuild the CSV from the JSON
 * dump a previous run wrote, which needs no token and touches nothing live — use it whenever the
 * column set changes rather than re-walking a production project.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { buildCommentRows, buildRows, commentCount } from '../../src/sources/frameio/rows.js';

const T = process.env.FRAMEIO_TOKEN;
// `fileURLToPath`, not `.pathname`: on Windows the latter yields `/C:/…`, which node then resolves
// against the current drive as `C:\C:\…`.
const S = process.env.FRAMEIO_OUT || fileURLToPath(new URL('./data', import.meta.url));
const A = '4d3ecf78-9dfb-4271-a87e-5f35248b549d';
const ROOT = '4021a1d2-314e-4ba4-a8fc-5396180a2a4e';
const PROJECT = { id: 'sample', name: 'WWDOAT sample', workspace_id: null };

const get = async (p) => (await fetch(`https://api.frame.io${p}`, {
    headers: { Authorization: `Bearer ${T}` },
})).json();

/** Walk the project's folder tree, collecting file records with their metadata. */
async function walk() {
    const queue = [{ id: ROOT, path: '/' }];
    const files = [];
    let calls = 0;

    while (queue.length && calls < 25 && files.length < 200) {
        const folder = queue.shift();
        calls += 1;
        const r = await get(`/v4/accounts/${A}/folders/${folder.id}/children?page_size=100&include=metadata`);
        for (const c of r.data ?? []) {
            if (c.type === 'folder') queue.push({ id: c.id, path: `${folder.path}${c.name}/` });
            // Shaped as `walkProject` returns them, because that is what `buildRows` reads.
            else if (c.type === 'file') files.push({ file: c, folderPath: folder.path, versionStackId: null });
        }
    }
    return { files, calls };
}

/** Read comments for every file that has any, as the pipeline does. */
async function walkComments(rows) {
    const fetched = [];
    let calls = 0;
    for (const row of rows.filter((r) => commentCount(r) > 0)) {
        calls += 1;
        const r = await get(`/v4/accounts/${A}/files/${row.fileId}/comments?page_size=100&include=owner,replies`);
        if (r.data?.length) fetched.push({ fileId: row.fileId, comments: r.data });
    }
    return { fetched, calls };
}

const quote = String.fromCharCode(34);
const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? quote + s.split(quote).join(quote + quote) + quote : s;
};

/** Rows to CSV, with the column set discovered from the union of every row's keys. */
function toCsv(rows) {
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    return {
        cols,
        csv: [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'),
    };
}

const fromJson = process.argv.includes('--from-json');
const jsonPath = `${S}/frameio-wwdoat.json`;
const commentsPath = `${S}/frameio-wwdoat-comments.json`;

let files;
let rawComments = [];
let calls = 0;

/**
 * Accept either shape of dump.
 *
 * Earlier runs of this script wrote the raw file record with the folder path bolted on as `_path`,
 * because it flattened rows itself. It now hands them to the pipeline's `buildRows`, which wants
 * them as the walk produces them — so a dump taken before that change is adapted rather than
 * declared stale, since re-walking a live production project is the thing `--from-json` exists to
 * avoid.
 *
 * @param {Array<Object>} dumped - What was read from disk
 * @returns {Array<{file: Object, folderPath: string, versionStackId: (string|null)}>}
 */
const asWalked = (dumped) => dumped.map((entry) => (entry.file
    ? entry
    : { file: entry, folderPath: entry._path ?? '/', versionStackId: null }));

if (fromJson) {
    files = asWalked(JSON.parse(await readFile(jsonPath, 'utf8')));
    // Written by a later run than the dump may be; absent is not an error.
    rawComments = await readFile(commentsPath, 'utf8').then(JSON.parse).catch(() => []);
} else {
    ({ files, calls } = await walk());
    await writeFile(jsonPath, JSON.stringify(files, null, 2));
}

const { rows, notes } = buildRows({ files, project: PROJECT, accountId: A });

if (!fromJson) {
    const got = await walkComments(rows);
    calls += got.calls;
    rawComments = got.fetched;
    await writeFile(commentsPath, JSON.stringify(rawComments, null, 2));
}

const { rows: commentRows, notes: commentNotes } = buildCommentRows(rawComments);

const filesCsv = toCsv(rows);
await writeFile(`${S}/frameio-wwdoat.csv`, filesCsv.csv);
if (commentRows.length) {
    await writeFile(`${S}/frameio-wwdoat-comments.csv`, toCsv(commentRows).csv);
}

console.log(fromJson ? 'rebuilt from JSON' : `requests: ${calls}`,
    '| files:', rows.length, '| columns:', filesCsv.cols.length, '| comments:', commentRows.length);
for (const n of [...notes, ...commentNotes]) console.log(`  note  ${n.kind}: ${n.detail}`);
console.log('\ncolumns:\n ', filesCsv.cols.join('\n  '));
