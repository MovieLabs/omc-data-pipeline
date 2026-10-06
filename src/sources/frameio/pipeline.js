import { omcIdentifier } from 'omc-util';

import { buildEntities } from '../../omc/build.js';
import { sealBundle, validationFailureMessage } from '../../omc/bundle.js';
import '../../types.js'; // Type definitions, resolved globally by JSDoc

import { commentMappings, omcMappings } from './omcMapping.js';
import {
    COLUMNS, COMMENT_COLUMNS, METADATA_COLUMNS, buildCommentRows, buildRows, checkStructureTypes,
} from './rows.js';
import { fetchComments, resolveAccount, walkProject } from './tree.js';

/**
 * The schema versions this pipeline can deliver.
 *
 * v3.0 only, and not an oversight: the entities it builds are Asset and AssetStructure, and
 * `assetStructureProperties.fileDetails` — where most of what Frame.io knows about a file lands —
 * is a v3.0 shape. Offering v2.x would mean either building something different or migrating down,
 * and `omcMigrate` refuses a downgrade.
 */
const SCHEMA_VERSIONS = ['https://movielabs.com/omc/json/schema/v3.0'];

/** The project setting naming the Frame.io project to read. */
const PROJECT_ID_SETTING = 'frameioProjectId';

/** The project setting naming the account, needed only when the login can see more than one. */
const ACCOUNT_ID_SETTING = 'frameioAccountId';

/** The credential this pipeline needs, resolved by the caller and read from the context. */
const SECRET = 'frameio';

/** The identifierScope under which a Frame.io id is recorded as a second identifier. */
const SOURCE_SCOPE = 'frame.io';

/**
 * The datasets this pipeline emits, and therefore what a template is configured against.
 *
 * Two, at different grains: one row per file, and one row per comment. That is how a table says
 * "many" — a file with three comments contributes three rows to `comments`, all carrying its
 * `fileId`, and a mapping keyed on `fileId` folds them back onto the file's one Asset.
 */
const FILES = 'files';
const COMMENTS = 'comments';

/** The built-in mapping for each dataset, used where no template is attached to it. */
const BUILT_IN = { [FILES]: omcMappings, [COMMENTS]: commentMappings };

/**
 * Choose the mapping for each dataset: a configured template where there is one, this pipeline's
 * own otherwise.
 *
 * A template is authored against one dataset and carries no `table` — the canvas maps a single
 * sheet, so there is nothing to name. The table layer needs one, and the pipeline is what knows
 * which dataset the template was attached to, so it stamps it here.
 *
 * Per dataset, not all-or-nothing: a template for `files` and the built-in mapping for `comments`
 * is a reasonable thing to want, and the datasets are independent.
 *
 * @param {Object} [supplied] - `request.mappings`, keyed by dataset
 * @param {Array<string>} datasets - The datasets that actually have rows
 * @returns {{mappings: Array<DataPipeline.EntityMapping>, notes: Array<DataPipeline.MappingNote>}}
 */
function mappingsFor(supplied, datasets) {
    const mappings = [];
    const notes = [];
    for (const dataset of datasets) {
        const template = supplied?.[dataset];
        if (template?.length) {
            mappings.push(...template.map((entry) => ({ ...entry, table: dataset })));
            notes.push({
                kind: 'mappingFromTemplate',
                where: dataset,
                detail: `built with a configured template (${template.length} entit`
                    + `${template.length === 1 ? 'y' : 'ies'}) rather than this pipeline's own mapping`,
            });
        } else {
            mappings.push(...BUILT_IN[dataset]);
        }
    }
    return { mappings, notes };
}

/**
 * Record Frame.io's own id for the file as a second identifier on the Asset.
 *
 * The first identifier is the deterministic hash every entity in this package gets, which is what
 * makes a re-run idempotent. This adds the source system's own name for the thing, which is what
 * lets the same asset arriving later from somewhere else be recognised as the same asset.
 *
 * **On the Asset only.** The AssetStructure is built from the same `fileId`, so giving it the same
 * scope and value would put one identifier on two entities — and no two entities in a model may
 * share an identifier. Frame.io names the file; it has no separate name for its structure.
 *
 * The file id is read back off the entity rather than recomputed from the row. The builder seeds
 * the identifier hash itself, so re-deriving it here would be a second implementation of the same
 * rule, free to drift; and pairing entities to rows by array position would quietly depend on the
 * builder preserving order. `fileId` is carried in this mapping's own customData, so the entity
 * already says which file it came from.
 *
 * @param {Array<OmcEntity>} assets - The built Assets
 * @returns {number} How many were given the second identifier
 */
function addSourceIdentifiers(assets) {
    let added = 0;
    for (const asset of assets) {
        const fileId = asset.customData?.find((entry) => entry?.value?.fileId)?.value?.fileId;
        if (!fileId) continue;
        asset.identifier.push(omcIdentifier.idFromValue({
            identifierScope: SOURCE_SCOPE,
            value: fileId,
        }));
        added += 1;
    }
    return added;
}

/**
 * Read a Frame.io project's files as OMC.
 *
 * Walks the project's folder tree and describes every file it finds as an Asset and an
 * AssetStructure. **No bytes are moved** — this reads the catalogue, not the media.
 *
 * The account is resolved before anything else, because every V4 path is account-scoped: there is
 * no `/projects/{id}`, only `/accounts/{account}/projects/{id}`. Where the login can see exactly
 * one account that is silent; where it can see several the run stops and names them.
 *
 * @param {DataPipeline.PipelineRunRequest} request - Options and the project's settings
 * @param {DataPipeline.PipelineContext} context - Secret, fetch, progress and cancellation
 * @returns {Promise<DataPipeline.PipelineRunResult>} The OMC, the notes and the report
 * @throws {Error} When no Frame.io project is configured, the account is ambiguous, the project
 *   cannot be read, or an entity fails validation
 */
async function run(request, context) {
    const { options, signal } = context;
    const projectId = request.settings?.[PROJECT_ID_SETTING];
    if (!projectId) {
        throw new Error(`No Frame.io project configured. Add a project setting "${PROJECT_ID_SETTING}" `
            + 'with the Frame.io project id on the Admin page — it is the uuid in the project\'s '
            + 'URL in the Frame.io web application.');
    }
    const token = context.secret(SECRET);

    // Before a single request: a media type this pass cannot legally classify would otherwise
    // surface as a validation failure after the whole tree had been walked.
    checkStructureTypes(options.schemaVersion);

    const notes = [];

    const { accountId, resolved } = await resolveAccount({
        accountId: request.settings?.[ACCOUNT_ID_SETTING] ?? null,
        token,
        fetch: context.fetch,
        signal,
        onRetry: (detail) => notes.push({ kind: 'retried', where: 'Frame.io', detail }),
    });
    if (resolved) {
        notes.push({
            kind: 'accountResolved',
            where: 'Frame.io',
            detail: `read account ${accountId}, the only one this login can see; set `
                + `"${ACCOUNT_ID_SETTING}" to name it explicitly`,
        });
    }

    const walk = await walkProject({
        accountId,
        projectId,
        token,
        fetch: context.fetch,
        signal,
        // `request.options` are the pipeline's own declared options, already coerced and
        // defaulted by `checkRunRequest`. `context.options` are the OMC options — scope, schema
        // version, namespace — and carry nothing a pipeline declared.
        maxDepth: request.options?.maxDepth,
        onProgress: context.onProgress,
    });
    notes.push(...walk.notes);

    signal.throwIfAborted();

    if (walk.files.length === 0) {
        // An empty project and a walk that failed everywhere are different problems, and returning
        // nothing quietly would hide the second one.
        const failed = walk.notes.filter((n) => n.kind === 'folderUnavailable').length;
        const reasons = failed ? ` (${failed} folder(s) could not be read)` : '';
        throw new Error(`Frame.io project ${projectId} ("${walk.project.name ?? projectId}") `
            + `contains no files${reasons}`);
    }

    const { rows, notes: rowNotes } = buildRows({
        files: walk.files, project: walk.project, accountId,
    });
    notes.push(...rowNotes);

    // The one part of this source that costs a request per file, and it is driven by the
    // `Comment Count` the walk already returned — so only the files that have comments are asked
    // about. Comments are Frame.io's real review threads, not the `Comments` metadata field, which
    // is one free-text box someone typed and arrives with the walk like any other column.
    const comments = await fetchComments({
        rows, accountId, token, fetch: context.fetch, signal, onProgress: context.onProgress,
    });
    notes.push(...comments.notes);
    const { rows: commentRows, notes: commentRowNotes } = buildCommentRows(comments.fetched);
    notes.push(...commentRowNotes);

    context.onProgress({
        stage: 'build',
        message: `Building OMC for ${rows.length} file(s) and ${commentRows.length} comment(s)`,
    });

    // A template configured against a dataset replaces the built-in mapping for it. That is the
    // whole point of the exercise: change what OMC the same walk produces by editing a template,
    // rather than by editing this file and cutting a release.
    const tables = { [FILES]: rows, ...(commentRows.length ? { [COMMENTS]: commentRows } : {}) };
    const chosen = mappingsFor(request.mappings, Object.keys(tables));
    notes.push(...chosen.notes);

    const built = buildEntities({ tables, mappings: chosen.mappings, options });
    notes.push(...built.notes);

    // Only meaningful for the built-in mapping, which is what puts the Frame.io id in customData
    // for this to read back. A template decides its own identifiers — including, if it wants, by
    // mapping the file id straight onto identifierValue.
    if (!request.mappings?.[FILES]?.length) {
        const tagged = addSourceIdentifiers(built.entitiesByType.Asset ?? []);
        if (tagged !== rows.length) {
            notes.push({
                kind: 'sourceIdentifierMissing',
                where: 'Frame.io',
                detail: `${rows.length - tagged} Asset(s) did not receive a ${SOURCE_SCOPE} identifier`,
            });
        }
    }

    context.onProgress({ stage: 'validate', message: 'Validating against the schema' });
    const seal = sealBundle({ entitiesByType: built.entitiesByType });
    if (!seal.validation.valid) {
        const total = Object.values(built.entitiesByType).reduce((n, list) => n + list.length, 0);
        throw new Error(validationFailureMessage(seal.validation, total));
    }

    return {
        omc: Object.values(built.entitiesByType).flat(),
        notes,
        report: {
            counts: {
                ...seal.counts,
                files: rows.length,
                comments: commentRows.length,
                commentRequests: comments.requests,
                frameioProject: walk.project.name ?? null,
            },
            validation: seal.validation,
            edgeCheck: seal.edgeCheck,
            schemaVersion: options.schemaVersion,
        },
    };
}

/**
 * Frame.io.
 *
 * @memberof namespace:DataPipeline
 * @type {DataPipeline.PipelineDefinition}
 */
const frameio = {
    pipelineId: 'frameio',
    label: 'Frame.io project files',
    description: 'Walks the folder tree of the Frame.io project configured against this project '
        + 'and describes every file in it as an OMC Asset and AssetStructure. Reads the catalogue '
        + 'only — no media is downloaded. Takes no files, and needs a Frame.io login.',
    version: '1.0.0',
    schemaVersions: SCHEMA_VERSIONS,
    produces: ['Asset', 'AssetStructure'],
    // Nothing to upload: this pipeline reads an API. A caller offering a file picker for it is
    // reading `roles`, which is empty, rather than assuming every pipeline takes a delivery.
    inputs: {
        minFiles: 0,
        maxFiles: 0,
        roles: [],
    },
    // The tabular data this pipeline produces, declared so a caller can offer a mapping template
    // against it without knowing anything about Frame.io — the same way `roles` and `options` are
    // declared. `columns` is what a template author sees before a run has happened.
    datasets: [
        {
            name: FILES,
            label: 'Files and metadata',
            description: 'One row per file in the project, carrying its Frame.io record, the '
                + 'technical detail Frame.io derived from the media, and every custom metadata '
                + 'field the account defines.',
            produces: ['Asset', 'AssetStructure'],
            // The structural columns are guaranteed; the metadata ones are what the sample projects
            // carried and depend on the media and on how the account is configured. Declared
            // together so a template can be authored before a run has happened, and reported
            // honestly by `checkColumns` against the real rows when one has.
            columns: [...COLUMNS, ...METADATA_COLUMNS],
            guaranteedColumns: COLUMNS,
        },
        {
            name: COMMENTS,
            label: 'Review comments',
            description: 'One row per comment, keyed on fileId so several rows describe one file. '
                + 'Frame.io\'s review threads, which are not the "Comments" metadata field — that '
                + 'is a single free-text box and arrives with the files dataset.',
            produces: ['Asset'],
            columns: COMMENT_COLUMNS,
            guaranteedColumns: COMMENT_COLUMNS,
        },
    ],
    options: [
        {
            name: 'maxDepth',
            label: 'Maximum folder depth',
            type: 'number',
            default: 25,
            help: 'Folders deeper than this are reported and not descended into. A guard against '
                + 'a pathological tree, not a filter you would normally change.',
        },
    ],
    // Declared so the caller resolves this one credential and hands over nothing else. The pipeline
    // never learns where it is kept — which is what lets the same declaration be satisfied by a
    // static service token or by a token the user just logged in for.
    secrets: [SECRET],
    run,
};

export default frameio;
