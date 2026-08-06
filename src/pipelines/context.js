import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { httpFetch } from '../lib/http.js';
import { resolveOptions } from '../omc/entity.js';
import '../types.js'; // Type definitions, resolved globally by JSDoc

/**
 * Build a {@link DataPipeline.PipelineContext}, filling in what the caller left out.
 *
 * Every field has a working default, so a caller that only wants to supply `read` can. The
 * OMC options are resolved here rather than inside each pipeline, so a pipeline can rely on
 * `context.options.schemaVersion` being set.
 *
 * @memberof namespace:DataPipeline
 * @function createContext
 * @param {Object} [params]
 * @param {function(DataPipeline.PipelineInput): Promise<Buffer>} [params.read] - Byte source.
 *   Throws when called if none is given — a pipeline with no way to read its inputs is a
 *   caller error, not something to discover as an empty result.
 * @param {Object.<string, string>} [params.secrets] - Credentials by name, for pipelines that
 *   declare they need one. Held here rather than passed around so a pipeline reads them through
 *   `context.secret(name)` and a missing one is named rather than silently undefined
 * @param {function(string, Object=): Promise<Response>} [params.fetch] - HTTP, defaulting to
 *   {@link httpFetch}
 * @param {function(DataPipeline.PipelineProgress): void} [params.onProgress] - Progress sink
 * @param {AbortSignal} [params.signal] - Cancellation
 * @param {DataPipeline.OmcOptions} [params.options] - OMC options for the run
 * @returns {DataPipeline.PipelineContext} The context
 */
export function createContext({
    read, secrets = {}, fetch: fetchImpl, onProgress, signal, options,
} = {}) {
    return {
        read: read ?? (() => { throw new Error('This pipeline context cannot read files: no `read` was supplied'); }),
        secret: (name) => {
            const value = secrets[name];
            // Named, because the alternative is a request going out with `Bearer undefined` and
            // coming back a 401 that says nothing about which credential was missing or where the
            // caller was meant to have put it.
            if (!value) throw new Error(`No secret named "${name}" was supplied to this run`);
            return value;
        },
        // Not the global `fetch`: some upstreams serve an incomplete certificate chain, which the
        // global cannot be told to tolerate. See lib/http.js. A caller's own fetch is left alone.
        fetch: fetchImpl ?? httpFetch,
        onProgress: onProgress ?? (() => {}),
        signal: signal ?? new AbortController().signal,
        options: resolveOptions(options),
    };
}

/**
 * A context that reads inputs from the filesystem.
 *
 * `input.ref` is a path. When `baseDir` is given a relative ref is resolved against it, and a
 * ref that escapes it is refused — a pipeline should never be able to read outside the
 * directory it was pointed at, and a run request is not always written by hand.
 *
 * This is the context the CLI and the test harness use. A service supplies its own `read`
 * against object storage and the pipeline cannot tell the difference.
 *
 * @memberof namespace:DataPipeline
 * @function fsContext
 * @param {Object} [params]
 * @param {string} [params.baseDir] - Directory relative refs resolve against, and the boundary
 *   refs may not escape. Unrestricted when omitted.
 * @param {function(DataPipeline.PipelineProgress): void} [params.onProgress] - Progress sink
 * @param {AbortSignal} [params.signal] - Cancellation
 * @param {DataPipeline.OmcOptions} [params.options] - OMC options for the run
 * @returns {DataPipeline.PipelineContext} The context
 */
export function fsContext({
    baseDir, onProgress, signal, options,
} = {}) {
    const resolve = (ref) => {
        if (!baseDir) return ref;
        const full = path.resolve(baseDir, ref);
        const root = path.resolve(baseDir);
        if (full !== root && !full.startsWith(root + path.sep)) {
            throw new Error(`Input "${ref}" resolves outside ${root}`);
        }
        return full;
    };

    return createContext({
        read: async (input) => readFile(resolve(input.ref)),
        onProgress,
        signal,
        options,
    });
}
