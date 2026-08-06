/**
 * Match a file's content signature against the registry.
 *
 * @param {DataPipeline.DocumentSignature} signature - What was read from the file
 * @returns {(DataPipeline.DocumentType|null)} The matching entry, or null when nothing fits
 */
export function classify(signature: DataPipeline.DocumentSignature): (DataPipeline.DocumentType | null);
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
export const DOCUMENT_TYPES: Array<DataPipeline.DocumentType>;
/** MIME type per file extension, for `fileDetails.mediaType`. */
export const MEDIA_TYPES: {
    '.pdf': string;
    '.xml': string;
    '.csv': string;
    '.txt': string;
};
/**
 * The OMC asset function every Script-E deliverable is given for now. They are all reference
 * material an editorial or post team consults rather than material that ends up on screen.
 *
 * @memberof namespace:DataPipeline
 * @type {string}
 */
export const ASSET_FUNCTION_TYPE: string;
export function classifiedBy(entry: any): string;
//# sourceMappingURL=documentTypes.d.ts.map