import '../../types.js'; // Type definitions, resolved globally by JSDoc

/**
 * What each kind of Script-E deliverable is, keyed by a signature read from the file's
 * **content** rather than its name.
 *
 * Filenames here are not a sound basis for typing: the same report arrives as
 * `WORST DOUBLE DATE OF ALL TIME Detailed Editor Log Day 3.pdf` on one day and
 * `detailed editor_s log D3 WWD of ALL TIME.pdf` on another. Every PDF, by contrast, prints
 * its report name as a heading on page one, and the XML, CSV and clip-bin files each open
 * with an unambiguous structural marker.
 *
 * This is data, in the same spirit as `omcMapping.js`: adding a document type is an entry
 * here, not a code change.
 *
 * `assetStructureType` values are from the OMC v3.0 controlled list — `digital.document`
 * for the printed reports, `digital.data` for the machine-readable exports.
 *
 * @memberof namespace:DataPipeline
 * @type {Array<DataPipeline.DocumentType>}
 */
export const DOCUMENT_TYPES = [
    {
        match: { pdfHeading: "DAILY EDITOR'S LOG" },
        documentType: 'dailyEditorLog',
        description: "Daily Editor's Log",
        assetStructureType: 'digital.document',
        // Script-E prints this report twice per day, once ordered by slate and once by
        // camera roll. Both carry this heading and their text is identical apart from column
        // widths, so the sort order is a rendering difference rather than a document type.
        // They become two Assets, told apart by fileDetails.fileName.
        expectedPerDay: 2,
    },
    {
        match: { pdfHeading: "DETAILED EDITOR'S LOG" },
        documentType: 'detailedEditorLog',
        description: "Detailed Editor's Log",
        assetStructureType: 'digital.document',
    },
    {
        match: { pdfHeading: 'DAILY TIMECODE LOG' },
        documentType: 'dailyTimecodeLog',
        description: 'Daily Timecode Log',
        assetStructureType: 'digital.document',
    },
    {
        match: { pdfHeading: 'DAILY COVERAGE' },
        documentType: 'dailyCoverage',
        description: 'Daily Coverage',
        assetStructureType: 'digital.document',
    },
    {
        match: { pdfHeading: 'DAILY PROGRESS REPORT' },
        documentType: 'dailyProgressReport',
        description: 'Daily Progress Report',
        assetStructureType: 'digital.document',
    },
    {
        match: { pdfHeading: 'EDITOR REPORT' },
        documentType: 'editorReport',
        description: 'Editor Report',
        assetStructureType: 'digital.document',
    },
    {
        match: { pdfHeading: 'SCRIPT FACING PAGE' },
        documentType: 'facingAndLinedScript',
        description: 'Script Facing Page and Lined Script',
        assetStructureType: 'digital.document',
    },
    {
        match: { xmlRoot: 'ScriptESIMMetabanq' },
        documentType: 'simMetabanqExport',
        description: 'SIM Metabanq Export',
        assetStructureType: 'digital.data',
    },
    {
        match: { xmlRoot: 'ScriptEMetaData' },
        documentType: 'editorLogExport',
        description: 'Editor Log Metadata Export',
        assetStructureType: 'digital.data',
    },
    {
        match: { csvHeaderStartsWith: 'Slate,Scene,Camera,Roll,Take,Circled' },
        documentType: 'silverStackLog',
        description: 'SilverStack Camera Log',
        assetStructureType: 'digital.data',
    },
    {
        // An Avid bin opens with `Heading`, then the field-delimiter declaration on the next
        // line. Matched as a pattern because the line ending varies with the exporting host.
        match: { textPattern: /^Heading\s*[\r\n]+FIELD_DELIM\b/ },
        documentType: 'avidClipBin',
        description: 'Avid Clip Bin',
        assetStructureType: 'digital.data',
    },
];

/** MIME type per file extension, for `fileDetails.mediaType`. */
export const MEDIA_TYPES = {
    '.pdf': 'application/pdf',
    '.xml': 'application/xml',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
};

/**
 * The OMC asset function every Script-E deliverable is given for now. They are all reference
 * material an editorial or post team consults rather than material that ends up on screen.
 *
 * @memberof namespace:DataPipeline
 * @type {string}
 */
export const ASSET_FUNCTION_TYPE = 'technicalReferenceMaterial';

/**
 * Match a file's content signature against the registry.
 *
 * @param {DataPipeline.DocumentSignature} signature - What was read from the file
 * @returns {(DataPipeline.DocumentType|null)} The matching entry, or null when nothing fits
 */
export function classify(signature) {
    return DOCUMENT_TYPES.find(({ match }) => {
        if (match.pdfHeading) return signature.headings?.includes(match.pdfHeading);
        if (match.xmlRoot) return signature.xmlRoot === match.xmlRoot;
        if (match.csvHeaderStartsWith) return signature.firstLine?.startsWith(match.csvHeaderStartsWith);
        if (match.textPattern) return match.textPattern.test(signature.head ?? '');
        return false;
    }) ?? null;
}

/** Which signal a match came from, recorded on the row so the basis is auditable. */
export const classifiedBy = (entry) => (entry ? Object.keys(entry.match)[0] : 'unmatched');
