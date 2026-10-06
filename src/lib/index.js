/**
 * Format helpers: read and write XML, CSV and workbooks, resolve conventional paths, and reach
 * HTTP. Knows nothing about data sources or OMC.
 * @memberof namespace:DataPipeline
 */

export { httpFetch, transportDetail, responseDetail } from './http.js';
export { parseXml, parseXmlFile, text, list } from './xml.js';
export { parseCsv, parseCsvFile, toCsv } from './csv.js';
export { pdfPageLines } from './pdf.js';
export { writeTables, writeJson } from './tabular.js';
export { dayPaths, omcPath, findFile, repoRoot } from './paths.js';
