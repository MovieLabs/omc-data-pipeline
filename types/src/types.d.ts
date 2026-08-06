/**
 * A flat table: rows of column name to value, all rows sharing the same columns.
 */
type Table = Array<{
    [x: string]: (string | number | boolean | null);
}>;
/**
 * The tabular interim format a source adapter produces: table name to rows. Table names are
 * the sheet names in the generated workbook and the file names of the generated CSVs.
 */
type TableSet = {
    [x: string]: DataPipeline.Table;
};
/**
 * Options accepted by every public OMC method. Supplying them per call keeps the scope
 * explicit at each call site rather than hidden in module state, so one process can build
 * entities for several projects.
 */
type OmcOptions = {
    /**
     * - The `identifierScope` stamped on every generated
     * identifier. Defaults to `movielabs.com`.
     */
    identifierScope?: string;
    /**
     * - The OMC-JSON schema version URL to build against.
     * Defaults to v3.0. Shapes, edges and identifier prefixes are all read from omcUtil for
     * whichever version is given.
     */
    schemaVersion?: string;
    /**
     * - Prefix for the seeds that identifiers are hashed
     * from, so two projects using the same key values do not collide. Defaults to the
     * production name found in the data.
     */
    seedNamespace?: string;
};
/**
 * Where one OMC property's value comes from. The shorthand — a bare string — names a
 * column; the object form adds casting, splitting, cross-table lookup, and the conditions
 * under which a value is withheld rather than guessed.
 */
type PropertyMapping = (string | DataPipeline.PropertySource);
/**
 * The object form of a {@link DataPipeline.PropertyMapping}.
 */
type PropertySource = {
    /**
     * - The column the value is read from.
     */
    from: string;
    /**
     * - Cast the value. OMC types some
     * properties as numbers (`shootDay`, `recordingFPS`) or dateTimes (`createdOn`) where a
     * source delivers strings; `datetime` promotes a date-only value to midnight UTC.
     */
    as?: "number" | "string" | "boolean" | "datetime";
    /**
     * - A fixed value the mapping supplies, rather than a source column —
     * a decision (`assetFunctionType`, `Provenance.reason`), not data. Checked against the
     * schema's controlled values by {@link DataPipeline.checkMappings}.
     */
    const?: any;
    /**
     * - Treat the column as a delimited list and split on this
     * delimiter. Values are trimmed, de-duplicated and sorted, so a source that writes the
     * same set in two orders yields one result.
     */
    split?: string;
    /**
     * - Withhold the value unless a condition holds.
     * `unanimous`: every row in the group carries the same value — for a property that is
     * only true of the group when none of its rows disagree. `single`: the split list has
     * exactly one member. A withheld value produces a {@link DataPipeline.MappingNote}rather than a guess.
     */
    when?: "unanimous" | "single";
    /**
     * - Resolve the value through another table.
     */
    lookup?: DataPipeline.Lookup;
};
/**
 * A cross-table lookup, for a property whose value lives in a different table from the one
 * the entity is built from.
 */
type Lookup = {
    /**
     * - The table to look in.
     */
    table: string;
    /**
     * - The column in that table matched against this property's value.
     */
    on: string;
    /**
     * - The column whose value is returned.
     */
    select: string;
};
/**
 * A relationship to another entity. The edge itself is created by omcUtil, which decides
 * the path and the inverse from the schema — this only says which entity to point at and
 * which column holds its key.
 */
type EdgeMapping = {
    /**
     * - The entityType being pointed at.
     */
    to: string;
    /**
     * - The column holding the target's key value. For a `group` grain
     * the column is read across every row in the group, so one production scene reaches all
     * of its slates through a single mapping.
     */
    via: string;
    /**
     * - Read the edge's rows from a different
     * table, joined to this entity on the named column. A narrative scene's characters live in
     * their own table keyed by scene number, so the edge is sourced from there rather than from
     * the rows behind the scene itself. Defaults to the entity's own rows.
     */
    from?: {
        table: string;
        on: string;
    };
    /**
     * - Split the column as a delimited list, one edge per member.
     */
    split?: string;
    /**
     * - Also write the inverse edge on the target. Set it on one
     * side of a pair only, or the same relationship is written twice.
     */
    inverse?: boolean;
    /**
     * - The target is not built by this mapping. The reference is
     * seeded exactly as the entity itself would be, so it resolves once that pass runs.
     */
    external?: boolean;
};
/**
 * One note carried from a column into a note-shaped OMC property.
 */
type NoteMapping = {
    /**
     * - The note's title, written verbatim.
     */
    title: string;
    /**
     * - The column holding the note's text.
     */
    from: string;
    /**
     * - The note's author, written verbatim when given.
     */
    author?: string;
};
/**
 * The catch-all for source fields OMC has no property for. The v3.0 schema sets
 * `unevaluatedProperties: false`, so nothing can be carried as a custom property;
 * `customData` is the schema's own provision — *"used where the formal schema lacks
 * required properties"*.
 */
type CustomDataMapping = {
    /**
     * - Identifies the system the data came from, e.g. `Script-E`.
     */
    domain: string;
    /**
     * - Carry every column not already mapped to a real property,
     * keyed by its own column name. A column added to the source later flows through with no
     * edit to the mapping.
     */
    rest?: boolean;
    /**
     * - Columns withheld from `rest`, for source fields
     * known to carry no information.
     */
    exclude?: Array<string>;
    /**
     * - Optional namespace recorded alongside the domain.
     */
    namespace?: string;
    /**
     * - Optional URL of the schema the custom data follows.
     */
    schema?: string;
};
/**
 * How one table becomes one kind of OMC entity. This is data, not code: a source adapter
 * declares its mapping and the generic builder applies it.
 */
type EntityMapping = {
    /**
     * - The OMC entityType to build.
     */
    entityType: string;
    /**
     * - The table in the {@link DataPipeline.TableSet} to read.
     */
    table: string;
    /**
     * - `row` builds one entity per row (a Slate per take);
     * `group` builds one per distinct value of `key` (a ProductionScene per breakdown scene,
     * however many takes it has). Defaults to `row`.
     */
    grain?: "row" | "group";
    /**
     * - The column identifying the entity. Its value seeds the
     * identifier, so it must be unique within the namespace, and it is what other mappings
     * point at through {@link DataPipeline.EdgeMapping}`.via`.
     */
    key: string;
    /**
     * - Skip rows with no key rather than failing. Used
     * where a table legitimately holds rows of a different kind — a wild track has no
     * production scene, so it yields a Slate but no ProductionScene.
     */
    skipWhenKeyEmpty?: boolean;
    /**
     * - OMC property
     * path to source. Dotted paths address nested properties: `slateName.fullName`.
     */
    properties?: {
        [x: string]: DataPipeline.PropertyMapping;
    };
    /**
     * - Columns carried as
     * note-shaped OMC properties, keyed by the property path they are written to. `annotation`
     * is the home for human commentary; `slugline` takes the same shape, which is why this is
     * keyed by path rather than fixed to one property. An entry whose column is empty is
     * dropped, so a property with nothing to say is absent rather than an empty array.
     */
    notes?: {
        [x: string]: DataPipeline.NoteMapping[];
    };
    /**
     * - The catch-all.
     */
    customData?: DataPipeline.CustomDataMapping;
    /**
     * - Relationships to other entities.
     */
    edges?: Array<DataPipeline.EdgeMapping>;
};
/**
 * Something the mapping declined to assert. Withholding is deliberate: a value that cannot
 * be determined from the source is left absent and reported, never guessed.
 */
type MappingNote = {
    /**
     * - Machine-readable category, e.g. `propertyWithheld`.
     */
    kind: string;
    /**
     * - The entity the note concerns.
     */
    where: string;
    /**
     * - What was withheld and why.
     */
    detail: string;
};
/**
 * The outcome of applying a set of mappings to a table set.
 */
type BuildResult = {
    /**
     * - Built entities, by type.
     */
    entitiesByType: {
        [x: string]: OmcEntity[];
    };
    /**
     * - What was withheld, and why.
     */
    notes: Array<DataPipeline.MappingNote>;
    /**
     * - Row and entity counts, for reporting.
     */
    counts: any;
};
/**
 * The outcome of validating and writing a bundle.
 */
type BundleResult = {
    /**
     * - Paths written.
     */
    written: Array<string>;
    /**
     * - Per-entity validation.
     */
    validation: {
        valid: boolean;
        failures: Array<any>;
    };
    /**
     * -
     * Edge targets that do not resolve inside the bundle, split into references that should
     * have resolved and references deliberately pointing at a later pass.
     */
    edgeCheck: {
        dangling: Array<any>;
        external: {
            [x: string]: number;
        };
    };
};
/**
 * The directories one filming day of one source reads from and writes to.
 */
type DayPaths = {
    /**
     * - Where the delivery is read from
     */
    sourceDir: string;
    /**
     * - Where the interim tables are written
     */
    outDir: string;
};
/**
 * One property mapping resolved against the rows behind an entity.
 */
type ResolvedProperty = {
    /**
     * - The value, or null when none applies
     */
    value: any;
    /**
     * - Why the value was withheld, when it was
     */
    withheld: (string | null);
};
/**
 * The result of validating a set of entities individually.
 */
type ValidationResult = {
    /**
     * - True when every entity passed
     */
    valid: boolean;
    /**
     * - One entry per failing entity, naming it and the errors
     */
    failures: Array<any>;
};
/**
 * Edge targets that do not resolve to an entity in the bundle.
 */
type EdgeCheck = {
    /**
     * - References to a type the bundle contains that did not
     * resolve — always a fault
     */
    dangling: Array<any>;
    /**
     * - References to a type the bundle does not
     * contain, counted by type — expected where a later pass builds them
     */
    external: {
        [x: string]: number;
    };
    /**
     * - Edge nodes that are not a list of references at all,
     * naming the entity and what was found instead. Reported rather than thrown: this is the check
     * that exists to catch bad data
     */
    malformed: Array<any>;
};
/**
 * The outcome of checking a set of mappings against a schema version, before any data is
 * read. The mappings are the only place this package names OMC properties, so they are the
 * only thing a schema change can invalidate.
 */
type MappingCheck = {
    /**
     * - True when every property and edge resolves
     */
    valid: boolean;
    /**
     * - The version checked against
     */
    schemaVersion: string;
    /**
     * - Counts of what was checked
     */
    checked: any;
    /**
     * - Properties and edges the schema
     * does not accept, each naming the entity type and path
     */
    problems: Array<DataPipeline.MappingNote>;
};
/**
 * How a Script-E deliverable is recognised and classified. Matched on a signature read from
 * the file's content, not its name.
 */
type DocumentType = {
    /**
     * - The content signature: one of `pdfHeading`, `xmlRoot`,
     * `csvHeaderStartsWith` or `textPattern`.
     */
    match: any;
    /**
     * - Machine-readable type, e.g. `detailedEditorLog`.
     */
    documentType: string;
    /**
     * - Human-readable name, used as the Asset description.
     */
    description: string;
    /**
     * - OMC controlled value: `digital.document` for the
     * printed reports, `digital.data` for the machine-readable exports.
     */
    assetStructureType: string;
    /**
     * - How many of this type a day normally carries, where
     * that is more than one.
     */
    expectedPerDay?: number;
};
/**
 * What was read from a file in order to classify it.
 */
type DocumentSignature = {
    /**
     * - A PDF's leading lines
     */
    headings?: Array<string>;
    /**
     * - A PDF's page count
     */
    pageCount?: number;
    /**
     * - The date a PDF report was generated, ISO
     */
    printDate?: (string | null);
    /**
     * - The shoot day named in a PDF header
     */
    shootDay?: (string | null);
    /**
     * - The unit named in a PDF header
     */
    unit?: (string | null);
    /**
     * - The shoot date named in a PDF header, ISO
     */
    shootDate?: (string | null);
    /**
     * - The opening bytes of a non-PDF file
     */
    head?: string;
    /**
     * - The first non-empty line of a non-PDF file
     */
    firstLine?: string;
    /**
     * - The root element name of an XML file
     */
    xmlRoot?: (string | null);
};
/**
 * Everything a caller needs to know to offer a pipeline, gather its inputs and run it.
 */
type PipelineDefinition = {
    /**
     * - Stable machine-readable id, e.g. `script-e`.
     */
    pipelineId: string;
    /**
     * - Human-readable name, shown in a picker.
     */
    label: string;
    /**
     * - One or two sentences on what this pipeline reads.
     */
    description: string;
    /**
     * - The pipeline's own version, independent of the package's.
     */
    version: string;
    /**
     * - OMC schema version URLs this pipeline can build
     * against. A caller targeting a version not listed here should not offer the pipeline.
     */
    schemaVersions: Array<string>;
    /**
     * - OMC entity types it can emit, for display.
     */
    produces: Array<string>;
    /**
     * - What files it takes. A pipeline that reads an
     * API rather than a delivery declares `minFiles: 0` and no roles.
     */
    inputs: DataPipeline.PipelineInputs;
    /**
     * - Settings chosen **per run**, as data
     * so a caller can render a form for a pipeline it has never seen.
     */
    options?: Array<DataPipeline.PipelineOption>;
    /**
     * - Names of the credentials a run needs, e.g. `['yamdu']`. The
     * pipeline never learns where they are kept: the caller resolves each name and the run reads it
     * from {@link DataPipeline.PipelineContext}`.secret`. Declaring them means a caller can resolve
     * exactly what this pipeline needs and nothing else.
     */
    secrets?: Array<string>;
    /**
     * - Do the work.
     */
    run: (arg0: DataPipeline.PipelineRunRequest, arg1: DataPipeline.PipelineContext) => Promise<DataPipeline.PipelineRunResult>;
};
/**
 * The file set a pipeline accepts.
 */
type PipelineInputs = {
    /**
     * - Fewest files a run needs. Defaults to 1; `0` for a pipeline that
     * takes none at all, such as one that reads an API.
     */
    minFiles?: number;
    /**
     * - Most files a run accepts.
     */
    maxFiles?: number;
    /**
     * - File extensions offered in a picker, e.g. `.xml`.
     * Advisory: roles are what a run is actually validated against.
     */
    accept?: Array<string>;
    /**
     * - The parts a file can play.
     */
    roles: Array<DataPipeline.PipelineInputRole>;
};
/**
 * One part a file can play in a run. Roles replace directory scanning: the caller says what
 * each file is, so a pipeline works the same whether its inputs are a folder or a list of
 * object-storage URLs.
 */
type PipelineInputRole = {
    /**
     * - Machine-readable role name, e.g. `sim`.
     */
    role: string;
    /**
     * - Human-readable name, shown against a file.
     */
    label: string;
    /**
     * - A run without one is rejected before it starts.
     */
    required?: boolean;
    /**
     * - Most files that may take this role. Defaults to unlimited.
     */
    maxFiles?: number;
    /**
     * - A regular expression, as a string, matching file names that
     * usually take this role. Purely a convenience so a caller can pre-assign roles; a caller
     * may always override it, and a pipeline never reads it.
     */
    match?: string;
};
/**
 * A setting a caller may supply, declared as data so it can be rendered without being known.
 */
type PipelineOption = {
    /**
     * - The key it arrives under in
     * {@link DataPipeline.PipelineRunRequest}`.options`.
     */
    name: string;
    /**
     * - Human-readable name.
     */
    label: string;
    /**
     * - How to render and coerce it.
     */
    type: "string" | "number" | "boolean" | "select";
    /**
     * - A run without it is rejected before it starts.
     */
    required?: boolean;
    /**
     * - Used when the caller supplies nothing.
     */
    default?: any;
    /**
     * - For `select`.
     */
    choices?: Array<{
        value: string;
        label: string;
    }>;
    /**
     * - One line explaining what it does.
     */
    help?: string;
};
/**
 * One file offered to a run. The pipeline reads it through the context; the fields here
 * describe it, and `ref` is the only one the context needs.
 */
type PipelineInput = {
    /**
     * - Which {@link DataPipeline.PipelineInputRole} this file takes.
     */
    role: string;
    /**
     * - The name as delivered, used in reports and for classification.
     */
    fileName: string;
    /**
     * - Opaque to the pipeline: whatever the context needs to find the
     * bytes. A path for a filesystem context, a storage URL for an object-storage one.
     */
    ref: string;
    /**
     * - Media type, when the caller knows it.
     */
    contentType?: string;
    /**
     * - Size in bytes, when the caller knows it.
     */
    size?: number;
    /**
     * - Content hash, when the caller has already computed one.
     */
    md5?: string;
};
/**
 * What a caller asks a pipeline to do.
 */
type PipelineRunRequest = {
    /**
     * - The pipeline to run.
     */
    pipelineId: string;
    /**
     * - The files, each with its role.
     */
    inputs: Array<DataPipeline.PipelineInput>;
    /**
     * - Values for the pipeline's declared options.
     */
    options?: {
        [x: string]: any;
    };
    /**
     * - The project's own key/value settings, held
     * against the project rather than asked for each run — an account id at the source, a default
     * scope. Free-form and undeclared: a pipeline reads the keys it knows and reports a missing one
     * as a note rather than the caller having to describe them in advance.
     */
    settings?: {
        [x: string]: string;
    };
    /**
     * - Identifier scope, schema version and
     * seed namespace. Supplied per run, never read from module state.
     */
    omcOptions?: DataPipeline.OmcOptions;
};
/**
 * Everything a pipeline is allowed to reach the outside world with.
 *
 * This is the inversion that lets one pipeline run in three places: the pipeline asks for
 * bytes and reports progress, and the caller decides what that means. A pipeline that opened
 * a file itself would only ever run where that file is.
 */
type PipelineContext = {
    /**
     * - The whole file.
     * There is deliberately no streaming variant: every format read here is parsed whole
     * anyway, and pdfjs wants the bytes as one array. Add one when a pipeline needs it.
     */
    read: (arg0: DataPipeline.PipelineInput) => Promise<Buffer>;
    /**
     * - The named credential, for a pipeline that reads a
     * source needing one. Throws when the caller did not supply it, rather than letting the run fail
     * later as an unexplained 401. A pipeline must never log or return what this gives it.
     */
    secret: (arg0: string) => string;
    /**
     * - HTTP, defaulting to
     * {@link DataPipeline.httpFetch} rather than the global `fetch`, so that upstreams serving an
     * incomplete certificate chain still resolve. Supplied through the context for the same reason
     * `read` is: a pipeline that called the network directly could only be tested against the live
     * source.
     */
    fetch: (arg0: string, arg1: any | undefined) => Promise<Response>;
    /**
     * - Report a step. Purely
     * informational: a caller may ignore every call.
     */
    onProgress: (arg0: DataPipeline.PipelineProgress) => void;
    /**
     * - Aborted when the caller cancels. A pipeline should check it
     * between stages and let the resulting error propagate.
     */
    signal: AbortSignal;
    /**
     * - The resolved OMC options for this run.
     */
    options: DataPipeline.OmcOptions;
};
/**
 * A step a run has reached.
 */
type PipelineProgress = {
    /**
     * - Machine-readable stage name, e.g. `extract`.
     */
    stage: string;
    /**
     * - One line naming what is happening.
     */
    message?: string;
    /**
     * - Units finished, where the pipeline can count them.
     */
    completed?: number;
    /**
     * - Units in total, where the pipeline knows it in advance.
     */
    total?: number;
};
/**
 * What a run produces. Built entirely in memory: writing it anywhere is the caller's business.
 */
type PipelineRunResult = {
    /**
     * - The entities, flat and validated.
     */
    omc: Array<OmcEntity>;
    /**
     * - What the pipeline declined to assert,
     * and why. Not errors: a run that succeeds may still have plenty to say.
     */
    notes: Array<DataPipeline.MappingNote>;
    /**
     * - Counts and checks, for review before merge.
     */
    report: DataPipeline.PipelineReport;
};
/**
 * The checks a run passed, and what it built.
 */
type PipelineReport = {
    /**
     * - Entities built, by type.
     */
    counts: {
        [x: string]: number;
    };
    /**
     * - Per-entity schema validation.
     */
    validation: DataPipeline.ValidationResult;
    /**
     * - Edge targets that did not resolve.
     */
    edgeCheck: DataPipeline.EdgeCheck;
    /**
     * - The version built against.
     */
    schemaVersion: string;
    /**
     * - A human-readable report, where the pipeline renders one.
     */
    markdown?: string;
};
//# sourceMappingURL=types.d.ts.map