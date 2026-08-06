/**
 * Write a set of named tables out as one CSV per table plus a single multi-sheet workbook.
 * CSV keeps the output diffable in git; the workbook is what a human maps against the
 * ontology by hand.
 *
 * @memberof namespace:DataPipeline
 * @function writeTables
 * @param {DataPipeline.TableSet} tables - Table name to rows
 * @param {string} outDir - Directory to write into, created if needed
 * @param {string} workbookName - File name for the .xlsx, without extension
 * @returns {Promise<Array<string>>} Paths written
 */
export function writeTables(tables: DataPipeline.TableSet, outDir: string, workbookName: string): Promise<Array<string>>;
/**
 * Write a JSON document with stable 2-space formatting.
 *
 * @memberof namespace:DataPipeline
 * @function writeJson
 * @param {string} filePath - Destination path
 * @param {*} value - Value to serialize
 * @returns {Promise<string>} The path written
 */
export function writeJson(filePath: string, value: any): Promise<string>;
//# sourceMappingURL=tabular.d.ts.map