import { responseDetail, transportDetail } from '../../lib/http.js';
import '../../types.js'; // Type definitions, resolved globally by JSDoc

import { ORIGIN, PAGE_SIZE } from './endpoints.js';

/**
 * Talking to the Frame.io V4 API: one request, and one paginated collection.
 *
 * @namespace namespace:DataPipeline.frameio
 */

/** How many times a throttled or transiently-failed request is retried before giving up. */
const MAX_ATTEMPTS = 5;

/** First backoff step, doubled each attempt. */
const BACKOFF_MS = 1000;

/** Longest a single backoff will wait, however long the server asks for. */
const MAX_BACKOFF_MS = 30_000;

/**
 * Statuses worth trying again. 429 is the throttle; 5xx are the upstream having a moment. A 4xx
 * that is not 429 is the request being wrong, and repeating it will not make it right.
 *
 * @param {number} status
 * @returns {boolean}
 */
const retryable = (status) => status === 429 || (status >= 500 && status < 600);

/**
 * How long to wait before the next attempt.
 *
 * `Retry-After` is honoured when the server sends one — it knows when the bucket refills and we do
 * not — but it is still capped, because a server asking for ten minutes should fail the run rather
 * than silently hold a worker for ten minutes. Frame.io's limit is a leaky bucket, so the fallback
 * is plain exponential backoff.
 *
 * @param {Object} res - The response
 * @param {number} attempt - 1-based
 * @returns {number} Milliseconds
 */
function backoffFor(res, attempt) {
    const header = Number(res.headers?.get?.('retry-after'));
    // `retry-after` may also be an HTTP date; a non-finite value here just falls through to the
    // exponential path rather than becoming a NaN delay that resolves immediately.
    const advised = Number.isFinite(header) && header > 0 ? header * 1000 : null;
    return Math.min(advised ?? BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    // Without this a cancelled run still sits out its full backoff before noticing.
    signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('Aborted'));
    }, { once: true });
});

/**
 * GET one Frame.io resource.
 *
 * `path` is a path, not a URL — both the paths in `endpoints.js` and the `links.next` the API
 * returns are paths, so they are interchangeable here and pagination needs no URL surgery.
 *
 * @param {Object} params
 * @param {string} params.path - Path beginning `/v4/…`, optionally with a query string
 * @param {string} params.token - Adobe IMS access token
 * @param {function(string, Object=): Promise<Object>} params.fetch - HTTP, from the context
 * @param {AbortSignal} [params.signal] - Cancellation
 * @param {function(string): void} [params.onRetry] - Called with a description of each retry
 * @returns {Promise<Object>} The parsed body
 * @throws {Error} On a non-retryable status, or when the retries are exhausted
 */
export async function frameioGet({
    path, token, fetch, signal, onRetry,
}) {
    const url = `${ORIGIN}${path}`;

    for (let attempt = 1; ; attempt += 1) {
        let res;
        try {
            // Sequential by definition: each attempt waits on the previous one's outcome.
            res = await fetch(url, {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
                signal,
            });
        } catch (err) {
            // A cancelled run is the caller's doing, not a fault to describe or retry.
            if (err.name === 'AbortError') throw err;
            if (attempt >= MAX_ATTEMPTS) {
                throw new Error(`${path} -> request failed: ${transportDetail(err)}`);
            }
            onRetry?.(`${path}: ${transportDetail(err)} — retrying (${attempt}/${MAX_ATTEMPTS - 1})`);
            await sleep(Math.min(BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS), signal);
            continue;
        }

        if (res.ok) return res.json();

        if (retryable(res.status) && attempt < MAX_ATTEMPTS) {
            const wait = backoffFor(res, attempt);
            onRetry?.(`${path}: HTTP ${res.status} — waiting ${Math.round(wait / 1000)}s `
                + `(${attempt}/${MAX_ATTEMPTS - 1})`);
            await sleep(wait, signal);
            continue;
        }

        // 401 is worth annotating, but carefully: Frame.io says *why* in the response body, and
        // that reason is authoritative. "Your Frame user is not linked to an Adobe ID" is a real
        // one, and telling the user to reconnect would send them round a loop that cannot help.
        // So the hint names the other cause rather than asserting it.
        const hint = res.status === 401
            ? ' (if no reason is given above, the token may simply have expired — they last about an hour, so reconnect and run again)'
            : '';
        throw new Error(`${path} -> HTTP ${res.status} ${res.statusText}${await responseDetail(res)}${hint}`);
    }
}

/**
 * GET one resource, unwrapped.
 *
 * **Every V4 response is enveloped**, single resources included: `GET …/projects/{id}` answers
 * `{ data: { …project } }`, not the project. Reading a field straight off the body therefore
 * silently yields `undefined` — which surfaces much later as "this project has no root folder"
 * rather than as a parsing error.
 *
 * The envelope is a fact about the API, so it is stripped here rather than at each call site.
 * {@link frameioList} deliberately does not use this: it needs `links.next`, which lives on the
 * envelope itself.
 *
 * @param {Object} params - As {@link frameioGet}
 * @returns {Promise<Object>} The resource
 * @throws {Error} As {@link frameioGet}
 */
export async function frameioResource(params) {
    const body = await frameioGet(params);
    // `?? body` so a future endpoint that answers unenveloped still works rather than returning
    // undefined and being blamed on the caller.
    return body?.data ?? body;
}

/**
 * GET every page of a collection, following `links.next` to the end.
 *
 * V4 collections are cursor-paginated: the response carries `{ data, links: { next } }`, where
 * `next` is the same request path with an opaque `after` cursor appended, and is null on the last
 * page. The cursor is opaque by contract, so it is followed rather than constructed.
 *
 * @param {Object} params - As {@link frameioGet}, with `path` as the first page
 * @param {number} [params.pageSize] - Defaults to the limit every V4 collection accepts; only a
 *   folder's children allows more, and only that call passes it
 * @returns {Promise<Array<Object>>} Every item across every page
 * @throws {Error} As {@link frameioGet}
 */
export async function frameioList({
    path, token, fetch, signal, onRetry, pageSize = PAGE_SIZE,
}) {
    const items = [];
    const separator = path.includes('?') ? '&' : '?';
    let next = `${path}${separator}page_size=${pageSize}`;
    const seen = new Set();

    while (next) {
        // A server that returned the cursor it was given would otherwise page forever.
        if (seen.has(next)) {
            throw new Error(`${path} -> pagination repeated the cursor for "${next}"`);
        }
        seen.add(next);

        // Sequential by definition: the next cursor is only known once this page has arrived.
        const page = await frameioGet({
            path: next, token, fetch, signal, onRetry,
        });
        if (Array.isArray(page?.data)) items.push(...page.data);
        next = page?.links?.next ?? null;
    }

    return items;
}
