import '../types.js'; // Type definitions, resolved globally by JSDoc

/**
 * Coerce one option value to the type its declaration names.
 *
 * A run request may arrive as JSON from a form, where every value is a string. Coercing here
 * means a pipeline reads `options.day` as the number it declared, whether the caller sent
 * `1` or `"1"`.
 *
 * @param {DataPipeline.PipelineOption} option - The declaration
 * @param {*} value - The supplied value
 * @returns {*} The coerced value, or `undefined` when it cannot be coerced
 */
function coerce(option, value) {
    if (value === null || value === undefined || value === '') return undefined;
    switch (option.type) {
        case 'number': {
            const n = Number(value);
            return Number.isNaN(n) ? undefined : n;
        }
        case 'boolean':
            if (typeof value === 'boolean') return value;
            if (value === 'true') return true;
            if (value === 'false') return false;
            return undefined;
        default:
            return String(value);
    }
}

/**
 * Check a run request against a pipeline's declared inputs and options, and fill in defaults.
 *
 * Everything a caller can get wrong is caught here, before a single byte is read: a missing
 * required file, a role the pipeline does not have, too many files, an option that will not
 * coerce. Problems use the same `{kind, where, detail}` triple as every other diagnostic in
 * this package, so a caller renders them the same way.
 *
 * @memberof namespace:DataPipeline
 * @function checkRunRequest
 * @param {DataPipeline.PipelineRunRequest} request - The request to check
 * @param {DataPipeline.PipelineDefinition} definition - The pipeline it names
 * @returns {{valid: boolean, problems: Array<DataPipeline.MappingNote>,
 *   request: DataPipeline.PipelineRunRequest}} The outcome, and the request with option
 *   defaults applied and values coerced
 */
export function checkRunRequest(request, definition) {
    const problems = [];
    const where = definition.pipelineId;
    const inputs = request.inputs ?? [];
    const { roles = [], minFiles = 1, maxFiles } = definition.inputs ?? {};
    const byRole = new Map(roles.map((r) => [r.role, r]));

    if (inputs.length < minFiles) {
        problems.push({
            kind: 'tooFewFiles',
            where,
            detail: `${inputs.length} file(s) supplied, at least ${minFiles} required`,
        });
    }
    if (maxFiles !== undefined && inputs.length > maxFiles) {
        problems.push({
            kind: 'tooManyFiles',
            where,
            detail: `${inputs.length} file(s) supplied, at most ${maxFiles} accepted`,
        });
    }

    const counts = new Map();
    for (const input of inputs) {
        if (!input.ref) {
            problems.push({
                kind: 'inputWithoutRef',
                where,
                detail: `"${input.fileName ?? '(unnamed)'}" has no ref, so it cannot be read`,
            });
        }
        if (!byRole.has(input.role)) {
            problems.push({
                kind: 'unknownRole',
                where,
                detail: `"${input.fileName ?? input.ref}" is assigned role "${input.role}", `
                    + `which ${definition.pipelineId} does not accept`,
            });
            continue;
        }
        counts.set(input.role, (counts.get(input.role) ?? 0) + 1);
    }

    for (const role of roles) {
        const count = counts.get(role.role) ?? 0;
        if (role.required && count === 0) {
            problems.push({
                kind: 'missingRequiredRole',
                where,
                detail: `No file assigned the required role "${role.role}" (${role.label})`,
            });
        }
        if (role.maxFiles !== undefined && count > role.maxFiles) {
            problems.push({
                kind: 'tooManyForRole',
                where,
                detail: `${count} files assigned role "${role.role}", which accepts at most ${role.maxFiles}`,
            });
        }
    }

    const supplied = request.options ?? {};
    const options = {};
    for (const option of definition.options ?? []) {
        const value = Object.hasOwn(supplied, option.name)
            ? coerce(option, supplied[option.name])
            : option.default;
        if (value === undefined) {
            if (option.required) {
                problems.push({
                    kind: 'missingRequiredOption',
                    where,
                    detail: `Option "${option.name}" (${option.label}) is required`,
                });
            }
            continue;
        }
        if (option.type === 'select' && option.choices
            && !option.choices.some((c) => c.value === value)) {
            problems.push({
                kind: 'optionNotAllowed',
                where,
                detail: `Option "${option.name}" is "${value}", which is not one of `
                    + `${option.choices.map((c) => c.value).join(', ')}`,
            });
            continue;
        }
        options[option.name] = value;
    }

    const { schemaVersion } = request.omcOptions ?? {};
    if (schemaVersion && !definition.schemaVersions.includes(schemaVersion)) {
        problems.push({
            kind: 'schemaVersionNotSupported',
            where,
            detail: `${definition.pipelineId} builds ${definition.schemaVersions.join(', ')}, not ${schemaVersion}`,
        });
    }

    return { valid: problems.length === 0, problems, request: { ...request, options } };
}

/**
 * The inputs assigned one role, in the order the caller supplied them.
 *
 * A convenience for pipelines, which almost always want either the single file playing a role
 * or every file playing it.
 *
 * @memberof namespace:DataPipeline
 * @function inputsForRole
 * @param {DataPipeline.PipelineRunRequest} request - The run request
 * @param {string} role - The role to select
 * @returns {Array<DataPipeline.PipelineInput>} The matching inputs
 */
export function inputsForRole(request, role) {
    return (request.inputs ?? []).filter((i) => i.role === role);
}

/**
 * The single input assigned one role.
 *
 * @memberof namespace:DataPipeline
 * @function inputForRole
 * @param {DataPipeline.PipelineRunRequest} request - The run request
 * @param {string} role - The role to select
 * @returns {(DataPipeline.PipelineInput|null)} The input, or null when none has that role
 */
export function inputForRole(request, role) {
    return inputsForRole(request, role)[0] ?? null;
}
