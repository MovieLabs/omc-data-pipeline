import { omcMigrate } from 'omc-util';

import { sealBundle, validationFailureMessage } from '../../omc/bundle.js';
import '../../types.js'; // Type definitions, resolved globally by JSDoc

import { ENDPOINTS } from './endpoints.js';
import { fetchEndpoint } from './fetchOmc.js';
import scopeToProject from './projectScope.js';

/** The schema versions this pipeline can deliver. Yamdu speaks v2.6; migration does the rest. */
const SCHEMA_VERSIONS = [
    'https://movielabs.com/omc/json/schema/v2.6',
    'https://movielabs.com/omc/json/schema/v2.8',
    'https://movielabs.com/omc/json/schema/v3.0',
];

/** The project setting naming the Yamdu project to read. */
const PROJECT_ID_SETTING = 'yamduProjectId';

/** The credential this pipeline needs, resolved by the caller and read from the context. */
const SECRET = 'yamdu';

/**
 * Name the domains in Yamdu's customData.
 *
 * Migration converts a v2.x `customData` object into the v3.0 array, but has no way to know what
 * the domain is: v2.6 defines `customData` as an unconstrained object with no properties, so there
 * is no schema rule saying its keys mean anything. It therefore produces `domain: null` and puts
 * the whole object in `value`.
 *
 * Yamdu's convention is that the top-level key *is* the domain:
 *
 * ```
 * [{ domain: null,    value: { yamdu: { shootingPhase: {…} } } }]
 *   ->  [{ domain: 'yamdu', value: { shootingPhase: {…} } }]
 * ```
 *
 * That is knowledge about this source, not about OMC, which is why it is applied here rather than
 * in the migration. An entry that already names a domain is left alone, and so is one whose value
 * is anything other than a plain object — being wrong about a source convention should cost
 * nothing rather than mangle the data.
 *
 * @param {Array<Object>} customData - The migrated v3.0 array
 * @returns {{customData: Array<Object>, changed: boolean}} The rewritten array
 */
function nameCustomDataDomains(customData) {
    let changed = false;
    const out = customData.flatMap((entry) => {
        const value = entry?.value;
        if (entry?.domain || !value || typeof value !== 'object' || Array.isArray(value)) {
            return [entry];
        }
        const keys = Object.keys(value);
        // Every value must itself be an object for the keys-are-domains reading to hold. A scalar
        // means this is flat data that happens to sit in customData, not a domain map.
        if (!keys.length || !keys.every((k) => value[k] && typeof value[k] === 'object' && !Array.isArray(value[k]))) {
            return [entry];
        }
        changed = true;
        return keys.map((domain) => ({ ...entry, domain, value: value[domain] }));
    });
    return { customData: out, changed };
}

/**
 * Group a flat entity list by entityType, for the counts a run reports.
 *
 * @param {Array<OmcEntity>} entities
 * @returns {Object.<string, Array<OmcEntity>>}
 */
function byType(entities) {
    return entities.reduce((acc, ent) => {
        const type = ent.entityType ?? 'unknown';
        acc[type] = [...acc[type] ?? [], ent];
        return acc;
    }, {});
}

/**
 * Read OMC from the Yamdu Third-Party API.
 *
 * Unlike a delivery-based pipeline there is nothing to parse and nothing to map: Yamdu returns OMC
 * entities directly. The work is fetching every endpoint, bringing what comes back up to the
 * project's schema version, and checking it.
 *
 * Yamdu speaks **v2.6**, which carries an entity's edges on a separate Context. It returns those
 * Contexts embedded, so `omcMigrate` can hoist them onto `edges` unaided — nothing needs inlining
 * first. That is a property of this source, not of OMC: a source that returned Context as a bare
 * reference would need the caller to resolve them, because a migration cannot hoist edges it
 * cannot see.
 *
 * An endpoint that fails does not fail the run. Yamdu exposes endpoints for entity kinds a given
 * production may not use at all, and losing eleven good endpoints because a twelfth is unavailable
 * would be a poor trade — each failure is reported as a note instead.
 *
 * @param {DataPipeline.PipelineRunRequest} request - Options and the project's settings
 * @param {DataPipeline.PipelineContext} context - Secret, fetch, progress and cancellation
 * @returns {Promise<DataPipeline.PipelineRunResult>} The OMC, the notes and the report
 * @throws {Error} When no Yamdu project is configured, or an entity fails validation
 */
async function run(request, context) {
    const { options, signal } = context;
    const projectId = request.settings?.[PROJECT_ID_SETTING];
    if (!projectId) {
        throw new Error(`No Yamdu project configured. Add a project setting "${PROJECT_ID_SETTING}" `
            + 'with the Yamdu project id on the Admin page.');
    }
    const token = context.secret(SECRET);

    const notes = [];
    const raw = [];

    context.onProgress({
        stage: 'fetch',
        message: `Reading ${ENDPOINTS.length} endpoints for Yamdu project ${projectId}`,
        completed: 0,
        total: ENDPOINTS.length,
    });

    // Endpoints are independent, so they are fetched together; each one still paginates in order.
    const results = await Promise.allSettled(ENDPOINTS.map((endpoint) => fetchEndpoint({
        endpoint, projectId, token, fetch: context.fetch, signal,
    })));

    results.forEach((result, i) => {
        const endpoint = ENDPOINTS[i];
        if (result.status === 'fulfilled') {
            raw.push(...result.value);
        } else {
            notes.push({
                kind: 'endpointUnavailable',
                where: endpoint,
                detail: `not read: ${result.reason?.message ?? result.reason}`,
            });
        }
    });

    signal.throwIfAborted();

    if (raw.length === 0) {
        // Every endpoint failing is a different problem from a production that happens to be
        // empty, and returning nothing quietly would hide it.
        const reasons = notes.length ? ` (${notes.length} endpoint(s) failed)` : '';
        throw new Error(`Yamdu returned no entities for project ${projectId}${reasons}`);
    }

    // Straight after the response, before anything else looks at it: AllCreativeWorks answers for
    // the whole organisation rather than the project, so some of what just arrived belongs to
    // other productions.
    const scoped = scopeToProject(raw, projectId);
    if (scoped.dropped) {
        notes.push({
            kind: 'outOfProject',
            where: 'AllCreativeWorks',
            detail: `discarded ${scoped.dropped} creative work(s) belonging to other productions — `
                + 'this endpoint returns the whole organisation rather than the project asked for',
        });
    }

    context.onProgress({
        stage: 'migrate',
        message: `Migrating ${scoped.entities.length} entities to ${options.schemaVersion}`,
    });
    const migrated = omcMigrate(scoped.entities, options.schemaVersion);

    // Yamdu keys customData by domain; the migration cannot know that, so it is applied here.
    let domainsNamed = 0;
    const omc = migrated.map((ent) => {
        if (!Array.isArray(ent.customData)) return ent;
        const { customData, changed } = nameCustomDataDomains(ent.customData);
        if (!changed) return ent;
        domainsNamed += 1;
        return { ...ent, customData };
    });
    if (domainsNamed) {
        notes.push({
            kind: 'customDataDomains',
            where: 'Yamdu',
            detail: `named the customData domain on ${domainsNamed} entit${domainsNamed === 1 ? 'y' : 'ies'} `
                + 'from the source\'s own key; migration leaves it null because v2.6 defines no structure there',
        });
    }

    const sourceVersions = [...new Set(scoped.entities.map((e) => e.schemaVersion).filter(Boolean))];
    if (sourceVersions.some((v) => v !== options.schemaVersion)) {
        notes.push({
            kind: 'migrated',
            where: 'Yamdu',
            detail: `source returned ${sourceVersions.join(', ')}; delivered as ${options.schemaVersion}`,
        });
    }

    context.onProgress({ stage: 'validate', message: 'Validating against the schema' });
    const entitiesByType = byType(omc);
    const seal = sealBundle({ entitiesByType });
    if (!seal.validation.valid) {
        throw new Error(validationFailureMessage(seal.validation, omc.length));
    }

    return {
        omc,
        notes,
        report: {
            counts: seal.counts,
            validation: seal.validation,
            edgeCheck: seal.edgeCheck,
            schemaVersion: options.schemaVersion,
        },
    };
}

/**
 * Yamdu.
 *
 * @memberof namespace:DataPipeline
 * @type {DataPipeline.PipelineDefinition}
 */
const yamdu = {
    pipelineId: 'yamdu',
    label: 'Yamdu production data',
    description: 'Reads OMC directly from the Yamdu Third-Party API — characters, scenes, '
        + 'locations, wardrobe, participants and the rest — for the Yamdu project configured '
        + 'against this project. Takes no files.',
    version: '1.0.0',
    schemaVersions: SCHEMA_VERSIONS,
    produces: [
        'Character', 'CreativeWork', 'NarrativeLocation', 'NarrativeObject', 'NarrativeScene',
        'NarrativeWardrobe', 'Participant', 'ProductionLocation', 'ProductionScene',
        'SpecialAction', 'Context',
    ],
    // Nothing to upload: this pipeline reads an API. A caller offering a file picker for it is
    // reading `roles`, which is empty, rather than assuming every pipeline takes a delivery.
    inputs: {
        minFiles: 0,
        maxFiles: 0,
        roles: [],
    },
    options: [],
    // Declared so the caller resolves this one credential and hands over nothing else. The
    // pipeline never learns where it is kept.
    secrets: [SECRET],
    run,
};

export default yamdu;
