/**
 * A `fetch`-compatible HTTP client that trusts {@link extraCa} as well as Node's own roots.
 *
 * This exists only because the global `fetch` offers no way to supply a certificate authority
 * without taking on `undici` as a dependency. It is otherwise the plain thing: it is used as the
 * default `context.fetch`, and a caller that supplies its own is left alone.
 *
 * The returned object is Response-*like*, not a `Response`: it carries `ok`, `status`,
 * `statusText`, `url`, `headers`, and `json()`, `text()` and `arrayBuffer()`. That is what the
 * pipelines use. A source needing streaming or anything else off the real interface should say so
 * rather than assume it is there.
 *
 * @memberof namespace:DataPipeline
 * @function httpFetch
 * @param {string} url - Absolute URL
 * @param {Object} [init] - As `fetch`, honouring `method`, `headers`, `body` and `signal`
 * @returns {Promise<Object>} The Response-like result
 * @throws {Error} On transport failure, or when `init.signal` aborts
 */
export function httpFetch(url: string, init?: any): Promise<any>;
export default httpFetch;
//# sourceMappingURL=http.d.ts.map