/**
 * Flatten the normalized day model into the tables written to processedData.
 *
 * Every table repeats `productionName` and `shootDay` so a sheet stays meaningful once days
 * are concatenated for whole-production analysis. Tables that carry their own `shootDay`
 * column (shootDay, takes) simply overwrite the context value with the identical one.
 *
 * @param {object} model output of {@link parseSim}
 * @returns {Record<string, object[]>} table name -> rows
 */
export function toTables(model: object): Record<string, object[]>;
//# sourceMappingURL=toTables.d.ts.map