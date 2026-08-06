import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fsContext, getPipeline, runPipeline } from '../src/pipelines/index.js';

/** The repository root, so fixtures are addressed the same way from every test. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Assign every file in a directory to a role, using the pipeline's own `match` patterns.
 *
 * The same pre-assignment a UI does before letting the user correct it, so a test exercises
 * the roles a real run would arrive with rather than a hand-written ideal.
 *
 * @param {DataPipeline.PipelineDefinition} definition - The pipeline
 * @param {string} dir - Directory to read
 * @returns {Promise<Array<DataPipeline.PipelineInput>>} The inputs, sorted by file name
 */
export async function inputsFromDir(definition, dir) {
    const { roles } = definition.inputs;
    const fallback = roles.find((r) => !r.match)?.role ?? roles[0].role;
    const names = (await readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));

    return names.map((fileName) => ({
        role: roles.find((r) => r.match && new RegExp(r.match, 'i').test(fileName))?.role ?? fallback,
        fileName,
        ref: fileName,
    }));
}

/**
 * Run a pipeline over a fixture directory.
 *
 * @param {Object} params
 * @param {string} params.pipelineId - The pipeline to run
 * @param {string} params.dir - Fixture directory, relative to the repository root
 * @param {DataPipeline.OmcOptions} [params.omcOptions] - Scope, schema version and namespace
 * @returns {Promise<DataPipeline.PipelineRunResult>} The run result
 */
export async function runFixture({ pipelineId, dir, omcOptions = {} }) {
    const definition = getPipeline(pipelineId);
    if (!definition) throw new Error(`Unknown pipeline "${pipelineId}"`);

    const full = path.resolve(repoRoot, dir);
    const inputs = await inputsFromDir(definition, full);
    const context = fsContext({ baseDir: full, options: omcOptions });

    return runPipeline({ pipelineId, inputs, omcOptions }, context);
}

/**
 * Index a set of entities by type and identifier, for comparison against a golden bundle.
 *
 * Identifiers are deterministic hashes of the source data, so the same delivery always
 * produces the same keys — which is what makes a golden comparison exact rather than
 * approximate.
 *
 * @param {Array<OmcEntity>} entities - The entities to index
 * @returns {Map<string, OmcEntity>} Entities by `entityType|identifierValue`
 */
export function indexByIdentity(entities) {
    return new Map(entities.map((e) => [`${e.entityType}|${e.identifier[0].identifierValue}`, e]));
}
