import { BASE_URL, PAGE_SIZE } from './endpoints.js';
import '../../types.js'; // Type definitions, resolved globally by JSDoc

/**
 * Describe why a request never produced a response, unwrapping the `cause` chain.
 *
 * Worth the trouble because the message on its own is nearly always the useless `fetch failed`.
 * What identifies the fault — `ECONNRESET`, `ETIMEDOUT`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE` — is on
 * the cause underneath it, and discarding that turns a diagnosable failure into a mystery.
 *
 * @param {Error} err - The rejected request
 * @returns {string} A one-line description
 */
function transportDetail(err) {
    const parts = [];
    for (let cur = err; cur; cur = cur.cause) {
        const code = cur.code ? ` (${cur.code}${cur.syscall ? ` on ${cur.syscall}` : ''})` : '';
        parts.push(`${cur.message ?? cur}${code}`);
    }
    return parts.join(' <- ');
}

/**
 * Summarise what the API said on a non-2xx, for the note the run reports.
 *
 * Yamdu answers most failures with JSON but not all of them, so an unparseable body is reported as
 * text rather than being allowed to mask the status it arrived with. Tolerates a `fetch` whose
 * response has no `text()` — a stub need not implement the whole interface.
 *
 * @param {Object} res - The response
 * @returns {Promise<string>} A one-line description, empty when there is nothing to add
 */
async function responseDetail(res) {
    if (typeof res.text !== 'function') return '';
    const body = await res.text().catch(() => '');
    if (!body) return '';
    try {
        const json = JSON.parse(body);
        const msg = json.message ?? json.error ?? json.detail
            ?? (Array.isArray(json.errors) ? json.errors.map((e) => e.message ?? JSON.stringify(e)).join('; ') : null);
        return ` — ${msg ?? JSON.stringify(json)}`;
    } catch {
        return ` — ${body.replace(/\s+/g, ' ').slice(0, 300)}`;
    }
}

/**
 * Fetch one page from an OMC endpoint.
 *
 * Responses have the shape `{ data: [...entities], pagination: {...} }`.
 *
 * @param {Object} params
 * @param {string} params.endpoint - The endpoint name, e.g. `AllCharacters`
 * @param {string} params.projectId - The Yamdu project the data belongs to
 * @param {string} params.token - Bearer token
 * @param {number} params.offset - Pagination offset
 * @param {function(string, Object=): Promise<Response>} params.fetch - HTTP, from the context
 * @param {AbortSignal} [params.signal] - Cancellation
 * @returns {Promise<{data: Array<Object>, pagination: Object}>} The parsed page
 * @throws {Error} On any non-2xx response
 */
async function fetchPage({
    endpoint, projectId, token, offset, fetch, signal,
}) {
    const url = `${BASE_URL}/${endpoint}?project=${encodeURIComponent(projectId)}`
        + `&offset=${offset}&limit=${PAGE_SIZE}`;
    let res;
    try {
        res = await fetch(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            signal,
        });
    } catch (err) {
        // A cancelled run is the caller's doing, not a fault to describe.
        if (err.name === 'AbortError') throw err;
        throw new Error(`${endpoint} -> request failed: ${transportDetail(err)}`);
    }
    if (!res.ok) {
        throw new Error(`${endpoint} -> HTTP ${res.status} ${res.statusText}${await responseDetail(res)}`);
    }
    return res.json();
}

/**
 * Fetch every entity an endpoint offers, following pagination to the end.
 *
 * @param {Object} params - As {@link fetchPage}, without `offset`
 * @returns {Promise<Array<Object>>} Every entity the endpoint returned
 */
export async function fetchEndpoint({
    endpoint, projectId, token, fetch, signal,
}) {
    const entities = [];
    let offset = 0;
    for (;;) {
        // Sequential by definition: the next offset depends on what this page returned.
        const page = await fetchPage({
            endpoint, projectId, token, offset, fetch, signal,
        });
        const rows = Array.isArray(page.data) ? page.data : [];
        entities.push(...rows);
        // A page that reports more but returns nothing would otherwise spin forever.
        if (!page.pagination?.hasMore || rows.length === 0) break;
        offset += rows.length;
    }
    return entities;
}
