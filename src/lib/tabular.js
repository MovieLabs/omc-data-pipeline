import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import ExcelJS from 'exceljs';

import { toCsv } from './csv.js';

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
export async function writeTables(tables, outDir, workbookName) {
    await mkdir(outDir, { recursive: true });
    const written = [];

    // Renaming a table would otherwise leave its old CSV behind, and a stale sheet that
    // still opens is worse than a missing one. Only CSVs are pruned, and only in this
    // directory, which the tool generates in full.
    const expected = new Set(Object.keys(tables).map((name) => `${name}.csv`));
    const stale = (await readdir(outDir)).filter((f) => f.endsWith('.csv') && !expected.has(f));
    for (const file of stale) await unlink(path.join(outDir, file));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MovieLabs Data-Pipeline';

    for (const [name, rows] of Object.entries(tables)) {
        const csvPath = path.join(outDir, `${name}.csv`);
        await writeFile(csvPath, toCsv(rows), 'utf8');
        written.push(csvPath);

        const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
        const sheet = workbook.addWorksheet(name);
        sheet.columns = columns.map((key) => ({
            header: key,
            key,
            width: Math.min(Math.max(key.length + 2, 12), 60),
        }));
        rows.forEach((row) => sheet.addRow(row));
        sheet.getRow(1).font = { bold: true };
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
        if (rows.length) {
            sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
        }
    }

    const xlsxPath = path.join(outDir, `${workbookName}.xlsx`);
    await workbook.xlsx.writeFile(xlsxPath);
    written.push(xlsxPath);

    return written;
}

/**
 * Write a JSON document with stable 2-space formatting.
 *
 * @memberof namespace:DataPipeline
 * @function writeJson
 * @param {string} filePath - Destination path
 * @param {*} value - Value to serialize
 * @returns {Promise<string>} The path written
 */
export async function writeJson(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return filePath;
}
