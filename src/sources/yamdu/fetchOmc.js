import { responseDetail, transportDetail } from '../../lib/http.js';
import '../../types.js'; // Type definitions, resolved globally by JSDoc

import { BASE_URL, PAGE_SIZE } from './endpoints.js';

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
