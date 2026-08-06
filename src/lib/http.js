import { readdirSync, readFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';

/**
 * Extra certificate authorities to trust, on top of the ones Node bundles.
 *
 * Data, not code: a new authority is a `.pem` dropped in `certs/`. Each file explains why it is
 * there and when it can go.
 *
 * These exist for one reason — upstreams that serve an incomplete certificate chain. A server is
 * supposed to send its leaf *and* every intermediate up to a trusted root; some send only the leaf.
 * Browsers paper over it by fetching the missing intermediate from the URL in the certificate's AIA
 * extension, but Node does not implement AIA fetching, so the handshake simply fails. Where the
 * omission is intermittent — the same host completing the chain on some connections and not others
 * — the result is a random subset of requests failing with no pattern to it.
 *
 * Trusting an intermediate this way grants no authority that was not already granted: it is signed
 * by a root already in the store, so anything it signs already validated. It only allows the chain
 * to close when the server fails to send it.
 *
 * @type {Array<string>}
 */
const extraCa = (() => {
    const dir = path.join(import.meta.dirname, 'certs');
    return readdirSync(dir)
        .filter((file) => file.endsWith('.pem'))
        .map((file) => readFileSync(path.join(dir, file), 'utf8'));
})();

/** Reused across requests so connections are pooled and the chain is built once. */
const agent = new https.Agent({
    keepAlive: true,
    ca: [...tls.rootCertificates, ...extraCa],
});

/**
 * Read a response body to a string.
 *
 * @param {import('node:http').IncomingMessage} res - The response
 * @returns {Promise<string>} The body
 */
function readBody(res) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        res.setEncoding('utf8');
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(chunks.join('')));
        res.on('error', reject);
    });
}

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
export function httpFetch(url, init = {}) {
    const {
        method = 'GET', headers = {}, body, signal,
    } = init;

    if (!url.startsWith('https:')) {
        // http: has no chain to complete, so there is no reason for a request to arrive here.
        return globalThis.fetch(url, init);
    }

    return new Promise((resolve, reject) => {
        const req = https.request(url, { agent, method, headers }, (res) => {
            readBody(res).then((text) => resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                statusText: res.statusMessage ?? '',
                url,
                headers: new Headers(
                    // Node repeats set-cookie as an array; Headers wants strings.
                    Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]),
                ),
                text: async () => text,
                json: async () => JSON.parse(text),
                arrayBuffer: async () => new TextEncoder().encode(text).buffer,
            }), reject);
        });

        req.on('error', reject);
        if (signal) {
            if (signal.aborted) req.destroy(signal.reason ?? new Error('Aborted'));
            else signal.addEventListener('abort', () => req.destroy(signal.reason ?? new Error('Aborted')), { once: true });
        }
        if (body) req.write(body);
        req.end();
    });
}

export default httpFetch;
