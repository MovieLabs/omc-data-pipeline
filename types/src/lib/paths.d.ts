/**
 * Resolve the input and output directories for one day of one source of one production.
 *
 * Layout is by convention, so new days and new sources need no code change:
 *   <repo>/<production>/sourceData/<source>/Filming Day <day>/
 *   <repo>/<production>/processedData/<source>/Day <day>/
 *
 * @memberof namespace:DataPipeline
 * @function dayPaths
 * @param {Object} opts - The selection
 * @param {string} opts.production - Production folder name
 * @param {string} opts.source - Source folder name
 * @param {(string|number)} opts.day - Filming day number
 * @returns {DataPipeline.DayPaths} The resolved directories
 */
export function dayPaths({ production, source, day }: {
    production: string;
    source: string;
    day: (string | number);
}): DataPipeline.DayPaths;
/**
 * Where a production's generated OMC-JSON bundle lives. Not per day: the bundle spans every
 * day of the production, because its entities do.
 *
 * @memberof namespace:DataPipeline
 * @function omcPath
 * @param {Object} opts - The selection
 * @param {string} opts.production - Production folder name
 * @returns {string} The OMC output directory
 */
export function omcPath({ production }: {
    production: string;
}): string;
/**
 * Find the one file in a directory matching a pattern.
 *
 * Script-E prefixes every file with the full production title ("WORST DOUBLE DATE OF ALL
 * TIME ..."), which is not the folder name, so files are located by their distinctive
 * report-name suffix rather than by a constructed path.
 *
 * @memberof namespace:DataPipeline
 * @function findFile
 * @param {string} dir - Directory to search
 * @param {RegExp} pattern - Pattern matched against the file name
 * @param {Object} [opts] - Options
 * @param {boolean} [opts.required] - Set `required: false` to allow a miss
 * @returns {Promise<(string|null)>} Absolute path, or null when absent and not required
 * @throws {Error} When required and zero or more than one file matches
 */
export function findFile(dir: string, pattern: RegExp, { required }?: {
    required?: boolean;
}): Promise<(string | null)>;
export const repoRoot: string;
//# sourceMappingURL=paths.d.ts.map