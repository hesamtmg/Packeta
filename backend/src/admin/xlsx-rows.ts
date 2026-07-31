import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

// Generous but bounded — a batch import is meant for onboarding a branch's
// worth of accounts/wallets at once, not an unbounded data pipe. Keeps a
// single malformed or huge upload from turning into a very long request.
const MAX_ROWS = 2000;

// Reads the first worksheet of an .xlsx file into plain objects keyed by
// the header row — every downstream batch importer (customers, wallets)
// shares this same "row of named columns" shape, so the per-column parsing
// logic lives once here rather than once per importer.
export async function parseXlsxRows(
  buffer: Buffer,
): Promise<Record<string, string>[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs bundles its own (older) @types/node transitively via
    // @fast-csv, so its Buffer type doesn't structurally match ours even
    // though both are the same Node Buffer at runtime — cast, not a real
    // type mismatch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);
  } catch {
    throw new BadRequestException(
      'Could not read that file — make sure it is a valid .xlsx file',
    );
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new BadRequestException('The uploaded file has no worksheet');
  }

  const headers: string[] = [];
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? '').trim();
  });
  if (!headers.some(Boolean)) {
    throw new BadRequestException('The first row must be a header row');
  }

  const rows: Record<string, string>[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (!header) return;
      const value = cell.value;
      const text =
        value == null
          ? ''
          : typeof value === 'object' && 'text' in (value as object)
            ? String((value as { text: unknown }).text)
            : String(value);
      const trimmed = text.trim();
      record[header] = trimmed;
      if (trimmed) hasValue = true;
    });
    if (hasValue) rows.push(record);
  });

  if (rows.length > MAX_ROWS) {
    throw new BadRequestException(
      `That file has ${rows.length} rows — batch imports are limited to ${MAX_ROWS} at a time`,
    );
  }

  return rows;
}
