import { readFile } from 'node:fs/promises';

/**
 * pdf.js is loaded on first use rather than at import time. It is a large module and only
 * the document-classification path needs it, so a consumer using this package purely to
 * build OMC entities from tables never pays for it.
 *
 * @returns {Promise<Function>} the `getDocument` entry point
 */
let getDocument = null;
async function loadPdfjs() {
    if (!getDocument) {
        // The legacy build is the one that runs under Node without a DOM.
        ({ getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs'));
    }
    return getDocument;
}

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
export async function pdfPageLines(source, { page = 1 } = {}) {
    const load = await loadPdfjs();
    const bytes = typeof source === 'string' ? await readFile(source) : source;
    // The loading task owns the worker; destroying the document is not enough to let the
    // process exit, so the task is what gets cleaned up.
    const task = load({
        data: new Uint8Array(bytes),
        isEvalSupported: false,
        useSystemFonts: false,
    });
    const doc = await task.promise;

    try {
        const content = await (await doc.getPage(page)).getTextContent();

        const byBaseline = new Map();
        for (const item of content.items) {
            if (!item.str?.trim()) continue;
            const y = Math.round(item.transform[5]);
            if (!byBaseline.has(y)) byBaseline.set(y, []);
            byBaseline.get(y).push({ x: item.transform[4], text: item.str });
        }

        const lines = [...byBaseline.entries()]
            .sort((a, b) => b[0] - a[0]) // Descending y: PDF origin is bottom-left
            .map(([, runs]) => runs
                .sort((a, b) => a.x - b.x)
                .map((r) => r.text)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim())
            .filter(Boolean);

        return { lines, pageCount: doc.numPages };
    } finally {
        await task.destroy();
    }
}
