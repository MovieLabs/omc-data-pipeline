/**
 * Read one page of a PDF as text lines.
 *
 * pdf.js returns positioned text runs in drawing order, not reading order — the heading of a
 * Script-E report arrives before the date that is printed to its left. Runs are therefore
 * regrouped by their baseline y and sorted by x, which reconstructs the visual lines and
 * makes a header row something that can be parsed rather than guessed at.
 *
 * Only the requested page is rendered, so a 79 MB document costs the same as a small one.
 *
 * @memberof namespace:DataPipeline
 * @function pdfPageLines
 * @param {(string|Buffer|Uint8Array)} source - A path to the PDF, or its bytes. Bytes are
 *   what a caller that did not get the file from a filesystem has.
 * @param {Object} [opts] - Options
 * @param {number} [opts.page] - 1-based page number, defaults to the first page
 * @returns {Promise<{lines: Array<string>, pageCount: number}>} The page's lines, top to bottom
 */
export function pdfPageLines(source: (string | Buffer | Uint8Array), { page }?: {
    page?: number;
}): Promise<{
    lines: Array<string>;
    pageCount: number;
}>;
//# sourceMappingURL=pdf.d.ts.map