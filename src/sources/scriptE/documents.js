import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { pdfPageLines } from '../../lib/pdf.js';
import '../../types.js'; // Type definitions, resolved globally by JSDoc

import {
    ASSET_FUNCTION_TYPE, classify, classifiedBy, MEDIA_TYPES,
} from './documentTypes.js';

/** How many of a PDF's leading lines are treated as its header block. */
const HEADER_LINES = 6;

/** `1/23/26` — the US short date Script-E prints — to an ISO date. */
function isoDate(value) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec((value ?? '').trim());
    if (!m) return null;
    const [, month, day, year] = m;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Read the header block of a Script-E PDF.
 *
 * Every report prints the same furniture on page one: the date it was generated, the report
 * name as a heading, and — for the per-day reports — the shoot day, unit and shoot date. All
 * of it is content, so none of it has to be inferred from the file's name or its position in
 * the delivery.
 *
 * @param {(string|Buffer)} source - Path to the PDF, or its bytes
 * @returns {Promise<DataPipeline.DocumentSignature>} What the header says
 */
async function readPdfSignature(source) {
    const { lines, pageCount } = await pdfPageLines(source);
    const header = lines.slice(0, HEADER_LINES);
    const headerText = header.join(' ‖ ');

    const dayMatch = /Day:\s*Day\s*(\d+)\s*-\s*([^‖]+)/i.exec(headerText);
    const shootDateMatch = /Date:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(headerText);
    const printDateMatch = /(\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(header[0] ?? '');

    return {
        headings: header,
        pageCount,
        printDate: isoDate(printDateMatch?.[1]),
        shootDay: dayMatch?.[1] ?? null,
        unit: dayMatch?.[2]?.trim() ?? null,
        shootDate: isoDate(shootDateMatch?.[1]),
    };
}

/**
 * Read enough of a non-PDF file to identify it: the XML root element, the CSV header row, or
 * the opening bytes of a text file. Only the first 4 KB is read — the SIM Metabanq export is
 * several hundred kilobytes and its root element is in the first line.
 *
 * @param {(string|Buffer)} source - Path to the file, or its bytes
 * @returns {Promise<DataPipeline.DocumentSignature>} What the opening says
 */
async function readTextSignature(source) {
    const buffer = typeof source === 'string' ? await readFile(source) : source;
    const head = buffer.subarray(0, 4096).toString('utf8');
    const lines = head.split(/\r?\n/);
    const firstLine = lines.find((l) => l.trim()) ?? '';

    return {
        head,
        firstLine: firstLine.trim(),
        xmlRoot: /<([A-Za-z_][\w.-]*)[\s>]/.exec(head.replace(/<\?xml[^?]*\?>/, ''))?.[1] ?? null,
    };
}

/**
 * Describe one delivered file as a prospective OMC Asset.
 *
 * Classification is by content signature, never by file name, so a renamed delivery is still
 * recognised and an unfamiliar one is reported rather than guessed at.
 *
 * @param {Object} params
 * @param {string} params.fileName - The name as delivered
 * @param {(string|Buffer)} params.source - Path to the file, or its bytes
 * @param {number} params.fileSize - Size in bytes
 * @param {string} params.filePath - Where the file lives, recorded on the AssetStructure
 * @param {(string|number|null)} params.day - Fallback shoot day, for a file that states none
 * @param {(string|null)} params.productionName - Carried onto the row
 * @returns {Promise<{row: Object, note: (DataPipeline.MappingNote|null)}>} The row, and a note
 *   when nothing matched
 */
async function describeDocument({
    fileName, source, fileSize, filePath, day, productionName,
}) {
    const extension = path.extname(fileName).toLowerCase();
    const signature = extension === '.pdf'
        ? await readPdfSignature(source)
        : await readTextSignature(source);

    const match = classify(signature);

    return {
        note: match
            ? null
            : {
                kind: 'unclassifiedDocument',
                where: fileName,
                detail: 'no content signature matched; add an entry to documentTypes.js',
            },
        row: {
            productionName,
            // A file that names its own shoot day is believed over the caller: the caller is
            // stating which day it asked for, the file is stating which day it is.
            shootDay: signature.shootDay ?? (day === null || day === undefined ? null : String(day)),
            fileName,
            documentType: match?.documentType ?? 'unknown',
            description: match?.description ?? null,
            assetStructureType: match?.assetStructureType ?? null,
            assetFunctionType: match ? ASSET_FUNCTION_TYPE : null,
            classifiedBy: classifiedBy(match),
            printDate: signature.printDate ?? null,
            shootDate: signature.shootDate ?? null,
            unit: signature.unit ?? null,
            pageCount: signature.pageCount ?? null,
            fileExtension: extension,
            mediaType: MEDIA_TYPES[extension] ?? null,
            fileSize,
            filePath,
        },
    };
}

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
export async function analyseDocuments({ sourceDir, day, productionName = null }) {
    const dirEntries = await readdir(sourceDir, { withFileTypes: true });
    const entries = dirEntries
        .filter((e) => e.isFile())
        .sort((a, b) => a.name.localeCompare(b.name));

    const rows = [];
    const notes = [];

    for (const entry of entries) {
        const filePath = path.join(sourceDir, entry.name);
        const { size } = await stat(filePath);
        const { row, note } = await describeDocument({
            fileName: entry.name,
            source: filePath,
            fileSize: size,
            // Relative to the production folder: an absolute path is this machine's, not
            // a fact about the delivery.
            filePath: path.relative(path.resolve(sourceDir, '../../..'), filePath).replace(/\\/g, '/'),
            day,
            productionName,
        });
        rows.push(row);
        if (note) notes.push(note);
    }

    // A directory that arrives empty is a gap in the delivery worth stating, but it is not
    // an asset, so it is reported rather than given a row.
    for (const entry of dirEntries) {
        if (!entry.isDirectory()) continue;
        const contents = await readdir(path.join(sourceDir, entry.name));
        if (!contents.length) {
            notes.push({
                kind: 'emptyDirectory',
                where: entry.name,
                detail: 'delivered empty; nothing to record as an asset',
            });
        }
    }

    return { rows, notes };
}

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
export async function analyseInputs({
    inputs, read, day = null, productionName = null,
}) {
    const ordered = [...inputs].sort((a, b) => a.fileName.localeCompare(b.fileName));
    const rows = [];
    const notes = [];

    for (const input of ordered) {
        const bytes = await read(input);
        const { row, note } = await describeDocument({
            fileName: input.fileName,
            source: bytes,
            fileSize: input.size ?? bytes.length,
            filePath: input.ref,
            day,
            productionName,
        });
        rows.push(row);
        if (note) notes.push(note);
    }

    return { rows, notes };
}
