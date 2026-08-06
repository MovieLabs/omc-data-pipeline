/**
 * Analyse one filming day's delivery and describe each file as a prospective OMC Asset.
 *
 * Every file in the directory is reported, including any that match no known signature —
 * an unrecognised delivery is a finding, not something to drop silently.
 *
 * @memberof namespace:DataPipeline
 * @function analyseDocuments
 * @param {Object} params
 * @param {string} params.sourceDir - The `Filming Day N` directory
 * @param {(string|number)} params.day - The filming day, used where a file states no shoot day
 * @param {string} [params.productionName] - Production name, carried onto every row
 * @returns {Promise<{rows: DataPipeline.Table, notes: Array<DataPipeline.MappingNote>}>}
 *   The `assets` table rows, and anything worth reporting
 */
export function analyseDocuments({ sourceDir, day, productionName }: {
    sourceDir: string;
    day: (string | number);
    productionName?: string;
}): Promise<{
    rows: DataPipeline.Table;
    notes: Array<DataPipeline.MappingNote>;
}>;
/**
 * Describe a set of delivered files as prospective OMC Assets.
 *
 * The same analysis as {@link namespace:DataPipeline.analyseDocuments}, for a caller holding a
 * list of files rather than a directory. `input.ref` becomes the recorded file path, which for
 * a run against object storage is where the asset actually lives — more useful than a path on
 * whichever machine happened to process it.
 *
 * There is no empty-directory note here: a file list has no directories, so a gap in the
 * delivery is something the caller can see and this cannot.
 *
 * @memberof namespace:DataPipeline
 * @function analyseInputs
 * @param {Object} params
 * @param {Array<DataPipeline.PipelineInput>} params.inputs - The delivered files
 * @param {function(DataPipeline.PipelineInput): Promise<Buffer>} params.read - Byte source
 * @param {(string|number|null)} [params.day] - Fallback shoot day, for files stating none
 * @param {string} [params.productionName] - Production name, carried onto every row
 * @returns {Promise<{rows: DataPipeline.Table, notes: Array<DataPipeline.MappingNote>}>}
 *   The `assets` table rows, and anything worth reporting
 */
export function analyseInputs({ inputs, read, day, productionName, }: {
    inputs: Array<DataPipeline.PipelineInput>;
    read: (arg0: DataPipeline.PipelineInput) => Promise<Buffer>;
    day?: (string | number | null);
    productionName?: string;
}): Promise<{
    rows: DataPipeline.Table;
    notes: Array<DataPipeline.MappingNote>;
}>;
//# sourceMappingURL=documents.d.ts.map