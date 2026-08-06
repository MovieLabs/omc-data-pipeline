import { createServer } from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { catalog, fsContext, runPipeline } from './src/pipelines/index.js';

/**
 * A reference host for the pipeline contract.
 *
 * It exists so the package can be run and read on its own, and so the JSON a caller sends and
 * receives can be exercised without a backend. It resolves `input.ref` against a local
 * directory and runs synchronously — a real deployment stores bytes elsewhere and runs
 * pipelines off the request thread. There are no dependencies beyond Node itself.
 *
 * ```bash
 * node server.js --root WWDOAT/sourceData/Script-E --port 4100
 * curl localhost:4100/api/pipeline/v1/catalog
 * ```
 *
 * @namespace namespace:DataPipeline.server
 */

const BASE = '/api/pipeline/v1';

/**
 * Send a response in the envelope every Labkoat service uses.
 *
 * @param {import('node:http').ServerResponse} res - The response
 * @param {number} status - HTTP status
 * @param {Object} body - The body, already in envelope form
 */
function send(res, status, body) {
    const payload = JSON.stringify(body, null, 2);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(payload);
}

/**
 * Send a failure in the envelope's error form, with the HTTP status matching `error.status`.
 *
 * @param {import('node:http').ServerResponse} res - The response
 * @param {number} status - HTTP status
 * @param {string} title - Error category
 * @param {string} details - Human-readable message
 */
function fail(res, status, title, details) {
    send(res, status, { data: [], error: { status, title, details } });
}

/**
 * Read a JSON request body.
 *
 * @param {import('node:http').IncomingMessage} req - The request
 * @returns {Promise<Object>} The parsed body
 */
async function readJson(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/**
 * Start the reference host.
 *
 * @param {Object} params
 * @param {string} params.root - Directory that `input.ref` resolves against, and may not escape
 * @param {number} params.port - Port to listen on
 * @returns {import('node:http').Server} The listening server
 */
export function serve({ root, port }) {
    const server = createServer(async (req, res) => {
        try {
            if (req.method === 'GET' && req.url.startsWith(`${BASE}/catalog`)) {
                const schemaVersion = new URL(req.url, 'http://localhost').searchParams.get('schemaVersion');
                send(res, 200, { data: catalog({ schemaVersion }), errors: null, warnings: null });
                return;
            }

            if (req.method === 'POST' && req.url === `${BASE}/run`) {
                const request = await readJson(req);
                const result = await runPipeline(request, fsContext({
                    baseDir: root,
                    options: request.omcOptions,
                }));
                send(res, 200, { data: { status: 'done', ...result }, errors: null, warnings: null });
                return;
            }

            fail(res, 404, 'Invalid Route', `No route for ${req.method} ${req.url}`);
        } catch (err) {
            // A request that does not fit the pipeline it names is the caller's mistake, not
            // the server's, so it reads as a 400 rather than a 500.
            const bad = /^(Cannot run|Unknown pipeline)/.test(err.message);
            fail(res, bad ? 400 : 500, bad ? 'Invalid Query' : 'Internal Error', err.message);
        }
    });

    return server.listen(port, () => {
        console.log(`Data-Pipeline reference host on http://localhost:${port}${BASE}`);
        console.log(`Inputs resolve against ${path.resolve(root)}`);
    });
}

// Only start when run directly, so the module can also be imported by a test.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const { values } = parseArgs({
        options: {
            root: { type: 'string', default: '.' },
            port: { type: 'string', default: '4100' },
        },
    });
    serve({ root: values.root, port: Number(values.port) });
}
