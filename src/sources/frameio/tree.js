import '../../types.js'; // Type definitions, resolved globally by JSDoc

import { frameioList, frameioResource } from './client.js';
import {
    ASSET_PAGE_SIZE, accounts as accountsPath, comment as commentPath, fileComments, folderChildren,
    project as projectPath, versionStackChildren,
} from './endpoints.js';
import { commentCount } from './rows.js';

/**
 * Resolving the account, and walking a project's folder tree down to its files.
 *
 * @namespace namespace:DataPipeline.frameio
 */

/**
 * Decide which Frame.io account to read.
 *
 * The account id is not visible anywhere obvious in the Frame.io web application — unlike the
 * project id, which is in the URL — so requiring it as a setting would send the user hunting. Where
 * the token can see exactly one account there is nothing to choose, so it is resolved silently.
 * Where there are several, the ambiguity is refused **by name**: guessing would read the wrong
 * production, and an error that lists the candidates is one the user can act on immediately.
 *
 * @param {Object} params
 * @param {(string|null)} params.accountId - From the project's settings, when set
 * @param {string} params.token
 * @param {function(string, Object=): Promise<Object>} params.fetch
 * @param {AbortSignal} [params.signal]
 * @param {function(string): void} [params.onRetry]
 * @returns {Promise<{accountId: string, resolved: boolean}>} The account, and whether it was
 *   discovered rather than supplied
 * @throws {Error} When the token can see no accounts, or more than one and none was named
 */
export async function resolveAccount({
    accountId, token, fetch, signal, onRetry,
}) {
    if (accountId) return { accountId, resolved: false };

    const found = await frameioList({
        path: accountsPath(), token, fetch, signal, onRetry,
    });

    if (found.length === 0) {
        throw new Error('This Frame.io login can see no accounts. V4 API access is enabled per '
            + 'account, so an account that works in the web application may still be unavailable '
            + 'to the API.');
    }
    if (found.length > 1) {
        const list = found.map((a) => `  ${a.id}  ${a.display_name ?? ''}`.trimEnd()).join('\n');
        throw new Error('This Frame.io login can see more than one account, so which to read is '
            + 'ambiguous. Add a project setting "frameioAccountId" on the Admin page naming one '
            + `of:\n${list}`);
    }
    return { accountId: found[0].id, resolved: true };
}

/**
 * The version a stack contributes.
 *
 * A version stack is one asset with a history, not several assets. Emitting every version as its
 * own Asset would multiply the production's inventory by however many times someone re-uploaded a
 * cut, and OMC has `versionInfo` for saying what this actually is — which is more than this pass
 * knows. So the stack contributes its head version, and the fact that it *is* a stack is recorded
 * against the file for a later pass to build on.
 *
 * `head_version` is inlined on a stack when the API supplies it; when it is not, the stack's
 * children are read and the first taken, which the API returns newest first.
 *
 * @param {Object} params
 * @param {Object} params.stack - The version_stack child
 * @param {string} params.accountId
 * @param {string} params.token
 * @param {function(string, Object=): Promise<Object>} params.fetch
 * @param {AbortSignal} [params.signal]
 * @param {function(string): void} [params.onRetry]
 * @returns {Promise<(Object|null)>} The head file, or null when the stack is empty
 */
async function headOfStack({
    stack, accountId, token, fetch, signal, onRetry,
}) {
    if (stack.head_version) return stack.head_version;
    const versions = await frameioList({
        path: versionStackChildren({ accountId, versionStackId: stack.id }),
        token,
        fetch,
        signal,
        onRetry,
    });
    return versions.find((v) => v.type === 'file') ?? null;
}

/**
 * Walk a project's folder tree, collecting every file in it.
 *
 * Breadth-first and **sequential**, deliberately. Frame.io rate-limits per user and as low as ten
 * requests a minute on some endpoints, so a tree walk is exactly the shape of work that trips it;
 * issuing the listings concurrently would win a little wall-clock and lose it again to backoff.
 *
 * A folder that cannot be read becomes a note and the walk continues — losing a whole project
 * because one folder is permission-restricted would be a poor trade. A folder deeper than
 * `maxDepth` is also a note rather than a silent truncation.
 *
 * @param {Object} params
 * @param {string} params.accountId
 * @param {string} params.projectId
 * @param {string} params.token
 * @param {function(string, Object=): Promise<Object>} params.fetch
 * @param {AbortSignal} [params.signal]
 * @param {number} [params.maxDepth] - Folders below this are reported and not descended into
 * @param {function(DataPipeline.PipelineProgress): void} [params.onProgress]
 * @returns {Promise<{project: Object, files: Array<Object>,
 *   notes: Array<DataPipeline.MappingNote>}>} The project record, every file with the folder path
 *   it was found at, and anything worth reporting
 * @throws {Error} When the project itself cannot be read — there is nothing to walk
 */
export async function walkProject({
    accountId, projectId, token, fetch, signal, maxDepth = 25, onProgress,
}) {
    const notes = [];
    const onRetry = (message) => notes.push({ kind: 'retried', where: 'Frame.io', detail: message });

    const proj = await frameioResource({
        path: projectPath({ accountId, projectId }), token, fetch, signal, onRetry,
    });
    if (!proj?.root_folder_id) {
        throw new Error(`Frame.io project ${projectId} returned no root_folder_id, so there is `
            + 'nothing to walk. Check the project id names a project in this account.');
    }

    const files = [];
    // Path is carried down rather than reconstructed afterwards: a child names its parent by id,
    // and resolving those back into a path would mean holding the whole tree just to answer a
    // question the walk already knew on the way down.
    const queue = [{ id: proj.root_folder_id, path: '/', depth: 0 }];
    let foldersRead = 0;

    while (queue.length) {
        signal?.throwIfAborted();
        const folder = queue.shift();

        onProgress?.({
            stage: 'fetch',
            message: `Reading ${folder.path} — ${files.length} file(s) so far`,
            completed: foldersRead,
            total: foldersRead + queue.length + 1,
        });

        let children;
        try {
            // Sequential by design; see the note above about rate limits.
            children = await frameioList({
                path: folderChildren({ accountId, folderId: folder.id }),
                token,
                fetch,
                signal,
                onRetry,
                // The one collection the API lets us ask more of, and a tree walk is exactly the
                // shape of work that benefits.
                pageSize: ASSET_PAGE_SIZE,
            });
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            notes.push({
                kind: 'folderUnavailable',
                where: folder.path,
                detail: `not read: ${err.message ?? err}`,
            });
            foldersRead += 1;
            continue;
        }
        foldersRead += 1;

        for (const child of children) {
            if (child.type === 'folder') {
                const path = `${folder.path}${child.name}/`;
                if (folder.depth + 1 > maxDepth) {
                    notes.push({
                        kind: 'tooDeep',
                        where: path,
                        detail: `not descended into: deeper than maxDepth ${maxDepth}`,
                    });
                    continue;
                }
                queue.push({ id: child.id, path, depth: folder.depth + 1 });
            } else if (child.type === 'file') {
                files.push({ file: child, folderPath: folder.path, versionStackId: null });
            } else if (child.type === 'version_stack') {
                try {
                    const head = await headOfStack({
                        stack: child, accountId, token, fetch, signal, onRetry,
                    });
                    if (head) {
                        files.push({ file: head, folderPath: folder.path, versionStackId: child.id });
                    } else {
                        notes.push({
                            kind: 'emptyVersionStack',
                            where: `${folder.path}${child.name}`,
                            detail: 'version stack contains no file',
                        });
                    }
                } catch (err) {
                    if (err.name === 'AbortError') throw err;
                    notes.push({
                        kind: 'versionStackUnavailable',
                        where: `${folder.path}${child.name}`,
                        detail: `not read: ${err.message ?? err}`,
                    });
                }
            } else {
                // A type this pass does not model. Reported rather than dropped: a new asset kind
                // appearing in the API is a finding, not something to discover as a short count.
                notes.push({
                    kind: 'unknownChildType',
                    where: `${folder.path}${child.name ?? child.id}`,
                    detail: `child type "${child.type}" is not handled`,
                });
            }
        }
    }

    return { project: proj, files, notes };
}

/**
 * Fill in the author of every reply, which the listing leaves out.
 *
 * `include=owner` decorates the top-level comments and stops there: a nested reply arrives with no
 * `owner` key at all, so without this a threaded conversation is half anonymous. Fetched on its own
 * the same reply names its author, so this reads each one individually — one request per reply, and
 * none at all for a file whose comments have no replies.
 *
 * A reply whose author cannot be read keeps its text. Losing the words because the name was
 * unavailable would be the wrong trade.
 *
 * @param {Object} params
 * @param {Array<Object>} params.comments - Mutated in place, gaining `owner` on each reply
 * @param {string} params.accountId
 * @param {string} params.token
 * @param {function(string, Object=): Promise<Object>} params.fetch
 * @param {AbortSignal} [params.signal]
 * @param {function(string): void} [params.onRetry]
 * @param {Array<DataPipeline.MappingNote>} params.notes - Appended to in place
 * @returns {Promise<number>} How many requests were made
 */
async function nameReplyAuthors({
    comments, accountId, token, fetch, signal, onRetry, notes,
}) {
    const replies = comments.flatMap((c) => c.replies ?? []).filter((r) => r && !r.owner && r.id);
    let requests = 0;

    for (const reply of replies) {
        signal?.throwIfAborted();
        try {
            const full = await frameioResource({
                path: commentPath({ accountId, commentId: reply.id }), token, fetch, signal, onRetry,
            });
            requests += 1;
            if (full?.owner) reply.owner = full.owner;
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            requests += 1;
            notes.push({
                kind: 'replyAuthorUnavailable',
                where: reply.id,
                detail: `the reply is kept without its author: ${err.message ?? err}`,
            });
        }
    }

    return requests;
}

/**
 * Read the comments on every file that has any.
 *
 * The only part of this source that costs a request per file, which is why it is driven by
 * `Comment Count`: that arrives free with the walk, so the files with nothing to say cost nothing.
 * In the WWDOAT sample that is 81 requests rather than 239.
 *
 * Sequential, for the same reason the walk is — Frame.io rate-limits per user, and this is a burst
 * of small identical requests, which is exactly the shape that trips it.
 *
 * A file whose comments cannot be read becomes a note and the pass continues. Losing the whole run
 * over one unreadable file would be a poor trade when the file's own record is already in hand.
 *
 * @param {Object} params
 * @param {DataPipeline.Table} params.rows - Rows from `buildRows`, carrying `Comment Count`
 * @param {string} params.accountId
 * @param {string} params.token
 * @param {function(string, Object=): Promise<Object>} params.fetch
 * @param {AbortSignal} [params.signal]
 * @param {function(DataPipeline.PipelineProgress): void} [params.onProgress]
 * @returns {Promise<{fetched: Array<{fileId: string, comments: Array<Object>}>,
 *   notes: Array<DataPipeline.MappingNote>, requests: number}>} What was read, and what went wrong
 */
export async function fetchComments({
    rows, accountId, token, fetch, signal, onProgress,
}) {
    const notes = [];
    const onRetry = (message) => notes.push({ kind: 'retried', where: 'Frame.io', detail: message });

    const wanted = (rows ?? []).filter((row) => commentCount(row) > 0);
    const fetched = [];
    let requests = 0;

    for (const row of wanted) {
        signal?.throwIfAborted();
        onProgress?.({
            stage: 'fetch',
            message: `Reading comments — ${requests} of ${wanted.length} file(s)`,
            completed: requests,
            total: wanted.length,
        });

        try {
            // Sequential by design; see the note above about rate limits.
            const comments = await frameioList({
                path: fileComments({ accountId, fileId: row.fileId }),
                token,
                fetch,
                signal,
                onRetry,
            });
            requests += 1;
            requests += await nameReplyAuthors({
                comments, accountId, token, fetch, signal, onRetry, notes,
            });
            if (comments.length) fetched.push({ fileId: row.fileId, comments });

            // Frame.io's own count disagreeing with what it returned is worth knowing about, and a
            // silent shortfall would look like comments that were never written. **The count
            // includes replies**, which the listing nests rather than returning alongside — so the
            // comparison has to count them too, or every threaded file reports a false shortfall.
            const expected = commentCount(row);
            const got = comments.reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0);
            if (got < expected) {
                notes.push({
                    kind: 'commentCountShort',
                    where: row.fileName ?? row.fileId,
                    detail: `Comment Count says ${expected} but ${got} came back `
                        + `(${comments.length} comment(s) and their replies)`,
                });
            }
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            requests += 1;
            notes.push({
                kind: 'commentsUnavailable',
                where: row.fileName ?? row.fileId,
                detail: `not read: ${err.message ?? err}`,
            });
        }
    }

    return { fetched, notes, requests };
}
