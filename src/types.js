/**
 * Type definitions for the Data-Pipeline.
 *
 * The pipeline has three layers, and the types below follow them:
 *
 * 1. **Source adapters** (`src/sources/<source>`) read one supplier's delivery — PDFs, XML,
 *    spreadsheets — and produce {@link DataPipeline.TableSet}, a tabular interim format that
 *    already uses OMC terminology. That interim format is an artifact in its own right:
 *    human-readable, reviewable, and diffable.
 * 2. **The OMC layer** (`src/omc`) is generic. It reads a {@link DataPipeline.TableSet} plus
 *    a {@link DataPipeline.EntityMapping} and produces OMC entities. It knows nothing about
 *    any particular source.
 * 3. **Format helpers** (`src/lib`) read and write XML, CSV and workbooks, and know nothing
 *    about either sources or OMC.
 *
 * A new source therefore needs a parser that emits tables, plus a mapping that is data
 * rather than code. It needs no OMC code of its own.
 *
 * @namespace DataPipeline
 */

/**
 * A flat table: rows of column name to value, all rows sharing the same columns.
 * @memberof DataPipeline
 * @typedef {Array<Object.<string, (string|number|boolean|null)>>} Table
 */

/**
 * The tabular interim format a source adapter produces: table name to rows. Table names are
 * the sheet names in the generated workbook and the file names of the generated CSVs.
 * @memberof DataPipeline
 * @typedef {Object.<string, DataPipeline.Table>} TableSet
 */

/**
 * Options accepted by every public OMC method. Supplying them per call keeps the scope
 * explicit at each call site rather than hidden in module state, so one process can build
 * entities for several projects.
 * @memberof DataPipeline
 * @typedef {Object} OmcOptions
 * @property {string} [identifierScope] - The `identifierScope` stamped on every generated
 *   identifier. Defaults to `movielabs.com`.
 * @property {string} [schemaVersion] - The OMC-JSON schema version URL to build against.
 *   Defaults to v3.0. Shapes, edges and identifier prefixes are all read from omcUtil for
 *   whichever version is given.
 * @property {string} [seedNamespace] - Prefix for the seeds that identifiers are hashed
 *   from, so two projects using the same key values do not collide. Defaults to the
 *   production name found in the data.
 */

/**
 * Where one OMC property's value comes from. The shorthand — a bare string — names a
 * column; the object form adds casting, splitting, cross-table lookup, and the conditions
 * under which a value is withheld rather than guessed.
 * @memberof DataPipeline
 * @typedef {(string|DataPipeline.PropertySource)} PropertyMapping
 */

/**
 * The object form of a {@link DataPipeline.PropertyMapping}.
 * @memberof DataPipeline
 * @typedef {Object} PropertySource
 * @property {string} from - The column the value is read from.
 * @property {'number'|'string'|'boolean'|'datetime'} [as] - Cast the value. OMC types some
 *   properties as numbers (`shootDay`, `recordingFPS`) or dateTimes (`createdOn`) where a
 *   source delivers strings; `datetime` promotes a date-only value to midnight UTC.
 * @property {*} [const] - A fixed value the mapping supplies, rather than a source column —
 *   a decision (`assetFunctionType`, `Provenance.reason`), not data. Checked against the
 *   schema's controlled values by {@link DataPipeline.checkMappings}.
 * @property {string} [split] - Treat the column as a delimited list and split on this
 *   delimiter. Values are trimmed, de-duplicated and sorted, so a source that writes the
 *   same set in two orders yields one result.
 * @property {'unanimous'|'single'} [when] - Withhold the value unless a condition holds.
 *   `unanimous`: every row in the group carries the same value — for a property that is
 *   only true of the group when none of its rows disagree. `single`: the split list has
 *   exactly one member. A withheld value produces a {@link DataPipeline.MappingNote}
 *   rather than a guess.
 * @property {DataPipeline.Lookup} [lookup] - Resolve the value through another table.
 */

/**
 * A cross-table lookup, for a property whose value lives in a different table from the one
 * the entity is built from.
 * @memberof DataPipeline
 * @typedef {Object} Lookup
 * @property {string} table - The table to look in.
 * @property {string} on - The column in that table matched against this property's value.
 * @property {string} select - The column whose value is returned.
 */

/**
 * A relationship to another entity. The edge itself is created by omcUtil, which decides
 * the path and the inverse from the schema — this only says which entity to point at and
 * which column holds its key.
 * @memberof DataPipeline
 * @typedef {Object} EdgeMapping
 * @property {string} to - The entityType being pointed at.
 * @property {string} via - The column holding the target's key value. For a `group` grain
 *   the column is read across every row in the group, so one production scene reaches all
 *   of its slates through a single mapping.
 * @property {{table: string, on: string}} [from] - Read the edge's rows from a different
 *   table, joined to this entity on the named column. A narrative scene's characters live in
 *   their own table keyed by scene number, so the edge is sourced from there rather than from
 *   the rows behind the scene itself. Defaults to the entity's own rows.
 * @property {string} [split] - Split the column as a delimited list, one edge per member.
 * @property {boolean} [inverse] - Also write the inverse edge on the target. Set it on one
 *   side of a pair only, or the same relationship is written twice.
 * @property {boolean} [external] - The target is not built by this mapping. The reference is
 *   seeded exactly as the entity itself would be, so it resolves once that pass runs.
 */

/**
 * One note carried from a column into a note-shaped OMC property.
 * @memberof DataPipeline
 * @typedef {Object} NoteMapping
 * @property {string} title - The note's title, written verbatim.
 * @property {string} from - The column holding the note's text.
 * @property {string} [author] - The note's author, written verbatim when given.
 */

/**
 * The catch-all for source fields OMC has no property for. The v3.0 schema sets
 * `unevaluatedProperties: false`, so nothing can be carried as a custom property;
 * `customData` is the schema's own provision — *"used where the formal schema lacks
 * required properties"*.
 * @memberof DataPipeline
 * @typedef {Object} CustomDataMapping
 * @property {string} domain - Identifies the system the data came from, e.g. `Script-E`.
 * @property {boolean} [rest] - Carry every column not already mapped to a real property,
 *   keyed by its own column name. A column added to the source later flows through with no
 *   edit to the mapping.
 * @property {Array<string>} [exclude] - Columns withheld from `rest`, for source fields
 *   known to carry no information.
 * @property {string} [namespace] - Optional namespace recorded alongside the domain.
 * @property {string} [schema] - Optional URL of the schema the custom data follows.
 */

/**
 * How one table becomes one kind of OMC entity. This is data, not code: a source adapter
 * declares its mapping and the generic builder applies it.
 * @memberof DataPipeline
 * @typedef {Object} EntityMapping
 * @property {string} entityType - The OMC entityType to build.
 * @property {string} table - The table in the {@link DataPipeline.TableSet} to read.
 * @property {'row'|'group'} [grain] - `row` builds one entity per row (a Slate per take);
 *   `group` builds one per distinct value of `key` (a ProductionScene per breakdown scene,
 *   however many takes it has). Defaults to `row`.
 * @property {string} key - The column identifying the entity. Its value seeds the
 *   identifier, so it must be unique within the namespace, and it is what other mappings
 *   point at through {@link DataPipeline.EdgeMapping}`.via`.
 * @property {boolean} [skipWhenKeyEmpty] - Skip rows with no key rather than failing. Used
 *   where a table legitimately holds rows of a different kind — a wild track has no
 *   production scene, so it yields a Slate but no ProductionScene.
 * @property {Object.<string, DataPipeline.PropertyMapping>} [properties] - OMC property
 *   path to source. Dotted paths address nested properties: `slateName.fullName`.
 * @property {Object.<string, Array<DataPipeline.NoteMapping>>} [notes] - Columns carried as
 *   note-shaped OMC properties, keyed by the property path they are written to. `annotation`
 *   is the home for human commentary; `slugline` takes the same shape, which is why this is
 *   keyed by path rather than fixed to one property. An entry whose column is empty is
 *   dropped, so a property with nothing to say is absent rather than an empty array.
 * @property {DataPipeline.CustomDataMapping} [customData] - The catch-all.
 * @property {Array<DataPipeline.EdgeMapping>} [edges] - Relationships to other entities.
 */

/**
 * Something the mapping declined to assert. Withholding is deliberate: a value that cannot
 * be determined from the source is left absent and reported, never guessed.
 * @memberof DataPipeline
 * @typedef {Object} MappingNote
 * @property {string} kind - Machine-readable category, e.g. `propertyWithheld`.
 * @property {string} where - The entity the note concerns.
 * @property {string} detail - What was withheld and why.
 */

/**
 * The outcome of applying a set of mappings to a table set.
 * @memberof DataPipeline
 * @typedef {Object} BuildResult
 * @property {Object.<string, Array<OmcEntity>>} entitiesByType - Built entities, by type.
 * @property {Array<DataPipeline.MappingNote>} notes - What was withheld, and why.
 * @property {Object} counts - Row and entity counts, for reporting.
 */

/**
 * The outcome of validating and writing a bundle.
 * @memberof DataPipeline
 * @typedef {Object} BundleResult
 * @property {Array<string>} written - Paths written.
 * @property {{valid: boolean, failures: Array<Object>}} validation - Per-entity validation.
 * @property {{dangling: Array<Object>, external: Object.<string, number>}} edgeCheck -
 *   Edge targets that do not resolve inside the bundle, split into references that should
 *   have resolved and references deliberately pointing at a later pass.
 */

/**
 * The directories one filming day of one source reads from and writes to.
 * @memberof DataPipeline
 * @typedef {Object} DayPaths
 * @property {string} sourceDir - Where the delivery is read from
 * @property {string} outDir - Where the interim tables are written
 */

/**
 * One property mapping resolved against the rows behind an entity.
 * @memberof DataPipeline
 * @typedef {Object} ResolvedProperty
 * @property {*} value - The value, or null when none applies
 * @property {(string|null)} withheld - Why the value was withheld, when it was
 */

/**
 * The result of validating a set of entities individually.
 * @memberof DataPipeline
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - True when every entity passed
 * @property {Array<Object>} failures - One entry per failing entity, naming it and the errors
 */

/**
 * Edge targets that do not resolve to an entity in the bundle.
 * @memberof DataPipeline
 * @typedef {Object} EdgeCheck
 * @property {Array<Object>} dangling - References to a type the bundle contains that did not
 *   resolve — always a fault
 * @property {Object.<string, number>} external - References to a type the bundle does not
 *   contain, counted by type — expected where a later pass builds them
 * @property {Array<Object>} malformed - Edge nodes that are not a list of references at all,
 *   naming the entity and what was found instead. Reported rather than thrown: this is the check
 *   that exists to catch bad data
 */

/**
 * The outcome of checking a set of mappings against a schema version, before any data is
 * read. The mappings are the only place this package names OMC properties, so they are the
 * only thing a schema change can invalidate.
 * @memberof DataPipeline
 * @typedef {Object} MappingCheck
 * @property {boolean} valid - True when every property and edge resolves
 * @property {string} schemaVersion - The version checked against
 * @property {Object} checked - Counts of what was checked
 * @property {Array<DataPipeline.MappingNote>} problems - Properties and edges the schema
 *   does not accept, each naming the entity type and path
 */

/**
 * How a Script-E deliverable is recognised and classified. Matched on a signature read from
 * the file's content, not its name.
 * @memberof DataPipeline
 * @typedef {Object} DocumentType
 * @property {Object} match - The content signature: one of `pdfHeading`, `xmlRoot`,
 *   `csvHeaderStartsWith` or `textPattern`.
 * @property {string} documentType - Machine-readable type, e.g. `detailedEditorLog`.
 * @property {string} description - Human-readable name, used as the Asset description.
 * @property {string} assetStructureType - OMC controlled value: `digital.document` for the
 *   printed reports, `digital.data` for the machine-readable exports.
 * @property {number} [expectedPerDay] - How many of this type a day normally carries, where
 *   that is more than one.
 */

/**
 * What was read from a file in order to classify it.
 * @memberof DataPipeline
 * @typedef {Object} DocumentSignature
 * @property {Array<string>} [headings] - A PDF's leading lines
 * @property {number} [pageCount] - A PDF's page count
 * @property {(string|null)} [printDate] - The date a PDF report was generated, ISO
 * @property {(string|null)} [shootDay] - The shoot day named in a PDF header
 * @property {(string|null)} [unit] - The unit named in a PDF header
 * @property {(string|null)} [shootDate] - The shoot date named in a PDF header, ISO
 * @property {string} [head] - The opening bytes of a non-PDF file
 * @property {string} [firstLine] - The first non-empty line of a non-PDF file
 * @property {(string|null)} [xmlRoot] - The root element name of an XML file
 */

/* ----------------------------------------------------------------------------------------
 * The pipeline contract
 *
 * A pipeline is a source adapter that describes itself well enough to be selected, fed and
 * run by a caller that knows nothing about it. The same definition drives the CLI, the test
 * harness and a service, because a pipeline never opens a file: it asks its
 * {@link DataPipeline.PipelineContext} for bytes, and the caller decides where those come
 * from — a directory, a fixture, or object storage.
 * ------------------------------------------------------------------------------------- */

/**
 * Everything a caller needs to know to offer a pipeline, gather its inputs and run it.
 * @memberof DataPipeline
 * @typedef {Object} PipelineDefinition
 * @property {string} pipelineId - Stable machine-readable id, e.g. `script-e`.
 * @property {string} label - Human-readable name, shown in a picker.
 * @property {string} description - One or two sentences on what this pipeline reads.
 * @property {string} version - The pipeline's own version, independent of the package's.
 * @property {Array<string>} schemaVersions - OMC schema version URLs this pipeline can build
 *   against. A caller targeting a version not listed here should not offer the pipeline.
 * @property {Array<string>} produces - OMC entity types it can emit, for display.
 * @property {DataPipeline.PipelineInputs} inputs - What files it takes. A pipeline that reads an
 *   API rather than a delivery declares `minFiles: 0` and no roles.
 * @property {Array<DataPipeline.PipelineOption>} [options] - Settings chosen **per run**, as data
 *   so a caller can render a form for a pipeline it has never seen.
 * @property {Array<DataPipeline.PipelineDataset>} [datasets] - Tabular data this pipeline produces.
 *   Declaring one lets a caller configure a mapping template against it; without any, the pipeline
 *   only ever maps its own way.
 * @property {Array<string>} [secrets] - Names of the credentials a run needs, e.g. `['yamdu']`. The
 *   pipeline never learns where they are kept: the caller resolves each name and the run reads it
 *   from {@link DataPipeline.PipelineContext}`.secret`. Declaring them means a caller can resolve
 *   exactly what this pipeline needs and nothing else.
 * @property {function(DataPipeline.PipelineRunRequest, DataPipeline.PipelineContext):
 *   Promise<DataPipeline.PipelineRunResult>} run - Do the work.
 */

/**
 * The file set a pipeline accepts.
 * @memberof DataPipeline
 * @typedef {Object} PipelineInputs
 * @property {number} [minFiles] - Fewest files a run needs. Defaults to 1; `0` for a pipeline that
 *   takes none at all, such as one that reads an API.
 * @property {number} [maxFiles] - Most files a run accepts.
 * @property {Array<string>} [accept] - File extensions offered in a picker, e.g. `.xml`.
 *   Advisory: roles are what a run is actually validated against.
 * @property {Array<DataPipeline.PipelineInputRole>} roles - The parts a file can play.
 */

/**
 * One part a file can play in a run. Roles replace directory scanning: the caller says what
 * each file is, so a pipeline works the same whether its inputs are a folder or a list of
 * object-storage URLs.
 * @memberof DataPipeline
 * @typedef {Object} PipelineInputRole
 * @property {string} role - Machine-readable role name, e.g. `sim`.
 * @property {string} label - Human-readable name, shown against a file.
 * @property {boolean} [required] - A run without one is rejected before it starts.
 * @property {number} [maxFiles] - Most files that may take this role. Defaults to unlimited.
 * @property {string} [match] - A regular expression, as a string, matching file names that
 *   usually take this role. Purely a convenience so a caller can pre-assign roles; a caller
 *   may always override it, and a pipeline never reads it.
 */

/**
 * A setting a caller may supply, declared as data so it can be rendered without being known.
 * @memberof DataPipeline
 * @typedef {Object} PipelineOption
 * @property {string} name - The key it arrives under in
 *   {@link DataPipeline.PipelineRunRequest}`.options`.
 * @property {string} label - Human-readable name.
 * @property {'string'|'number'|'boolean'|'select'} type - How to render and coerce it.
 * @property {boolean} [required] - A run without it is rejected before it starts.
 * @property {*} [default] - Used when the caller supplies nothing.
 * @property {Array<{value: string, label: string}>} [choices] - For `select`.
 * @property {string} [help] - One line explaining what it does.
 */

/**
 * One file offered to a run. The pipeline reads it through the context; the fields here
 * describe it, and `ref` is the only one the context needs.
 * @memberof DataPipeline
 * @typedef {Object} PipelineInput
 * @property {string} role - Which {@link DataPipeline.PipelineInputRole} this file takes.
 * @property {string} fileName - The name as delivered, used in reports and for classification.
 * @property {string} ref - Opaque to the pipeline: whatever the context needs to find the
 *   bytes. A path for a filesystem context, a storage URL for an object-storage one.
 * @property {string} [contentType] - Media type, when the caller knows it.
 * @property {number} [size] - Size in bytes, when the caller knows it.
 * @property {string} [md5] - Content hash, when the caller has already computed one.
 */

/**
 * What a caller asks a pipeline to do.
 * @memberof DataPipeline
 * @typedef {Object} PipelineRunRequest
 * @property {string} pipelineId - The pipeline to run.
 * @property {Array<DataPipeline.PipelineInput>} inputs - The files, each with its role.
 * @property {Object.<string, *>} [options] - Values for the pipeline's declared options.
 * @property {Object.<string, string>} [settings] - The project's own key/value settings, held
 *   against the project rather than asked for each run — an account id at the source, a default
 *   scope. Free-form and undeclared: a pipeline reads the keys it knows and reports a missing one
 *   as a note rather than the caller having to describe them in advance.
 * @property {DataPipeline.OmcOptions} [omcOptions] - Identifier scope, schema version and
 *   seed namespace. Supplied per run, never read from module state.
 * @property {Object.<string, Array<Object>>} [mappings] - Mapping templates by dataset name, as
 *   `omcMapping` consumes them. A pipeline that declares {@link DataPipeline.PipelineDataset}s uses
 *   the template configured against a dataset in place of its own built-in mapping, which is what
 *   lets the OMC a pipeline produces be changed by editing a template rather than by editing the
 *   pipeline and cutting a release. Absent, the pipeline maps its own way.
 */

/**
 * Tabular data a pipeline produces, declared so a caller can offer a mapping template against it.
 *
 * The same idea as `roles` and `options`: data, so a caller that has never heard of this pipeline
 * can still offer the right thing. `columns` is what a template author needs before any run has
 * happened — you cannot map a column you cannot see.
 * @memberof DataPipeline
 * @typedef {Object} PipelineDataset
 * @property {string} name - Machine-readable name, and the key under
 *   {@link DataPipeline.PipelineRunRequest}`.mappings`.
 * @property {string} label - Human-readable name, shown in a picker.
 * @property {string} [description] - What one row of it is.
 * @property {Array<string>} [produces] - Entity types the built-in mapping emits, for display.
 * @property {Array<string>} [columns] - The columns every row carries. A source with user-defined
 *   fields may add more at run time, so this is the floor rather than the whole set.
 */

/**
 * Everything a pipeline is allowed to reach the outside world with.
 *
 * This is the inversion that lets one pipeline run in three places: the pipeline asks for
 * bytes and reports progress, and the caller decides what that means. A pipeline that opened
 * a file itself would only ever run where that file is.
 * @memberof DataPipeline
 * @typedef {Object} PipelineContext
 * @property {function(DataPipeline.PipelineInput): Promise<Buffer>} read - The whole file.
 *   There is deliberately no streaming variant: every format read here is parsed whole
 *   anyway, and pdfjs wants the bytes as one array. Add one when a pipeline needs it.
 * @property {function(string): string} secret - The named credential, for a pipeline that reads a
 *   source needing one. Throws when the caller did not supply it, rather than letting the run fail
 *   later as an unexplained 401. A pipeline must never log or return what this gives it.
 * @property {function(string, Object=): Promise<Response>} fetch - HTTP, defaulting to
 *   {@link DataPipeline.httpFetch} rather than the global `fetch`, so that upstreams serving an
 *   incomplete certificate chain still resolve. Supplied through the context for the same reason
 *   `read` is: a pipeline that called the network directly could only be tested against the live
 *   source.
 * @property {function(DataPipeline.PipelineProgress): void} onProgress - Report a step. Purely
 *   informational: a caller may ignore every call.
 * @property {AbortSignal} signal - Aborted when the caller cancels. A pipeline should check it
 *   between stages and let the resulting error propagate.
 * @property {DataPipeline.OmcOptions} options - The resolved OMC options for this run.
 */

/**
 * A step a run has reached.
 * @memberof DataPipeline
 * @typedef {Object} PipelineProgress
 * @property {string} stage - Machine-readable stage name, e.g. `extract`.
 * @property {string} [message] - One line naming what is happening.
 * @property {number} [completed] - Units finished, where the pipeline can count them.
 * @property {number} [total] - Units in total, where the pipeline knows it in advance.
 */

/**
 * What a run produces. Built entirely in memory: writing it anywhere is the caller's business.
 * @memberof DataPipeline
 * @typedef {Object} PipelineRunResult
 * @property {Array<OmcEntity>} omc - The entities, flat and validated.
 * @property {Array<DataPipeline.MappingNote>} notes - What the pipeline declined to assert,
 *   and why. Not errors: a run that succeeds may still have plenty to say.
 * @property {DataPipeline.PipelineReport} report - Counts and checks, for review before merge.
 */

/**
 * The checks a run passed, and what it built.
 * @memberof DataPipeline
 * @typedef {Object} PipelineReport
 * @property {Object.<string, number>} counts - Entities built, by type.
 * @property {DataPipeline.ValidationResult} validation - Per-entity schema validation.
 * @property {DataPipeline.EdgeCheck} edgeCheck - Edge targets that did not resolve.
 * @property {string} schemaVersion - The version built against.
 * @property {string} [markdown] - A human-readable report, where the pipeline renders one.
 */
