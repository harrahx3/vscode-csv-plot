/** Opens an Excel workbook in either format, whatever its file extension. */
import { readCompoundFile } from "./cfb";
import type { Workbook } from "./workbook";
import { readXls } from "./xls";
import { readXlsx } from "./xlsx";

const ZIP = [0x50, 0x4b];
const COMPOUND_FILE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const SAVE_AS_XLSX = "Save it as .xlsx in Excel first.";

/** Reads an .xlsx/.xlsm (zip) or .xls (compound file) workbook, whatever its file extension. */
export function readWorkbook(bytes: Uint8Array): Workbook {
  if (startsWith(bytes, ZIP)) return readXlsx(bytes);
  if (!startsWith(bytes, COMPOUND_FILE)) {
    throw new Error("This file is not an Excel workbook (.xlsx, .xlsm or .xls).");
  }
  const streams = readCompoundFile(bytes);
  if (streams.has("EncryptedPackage")) {
    throw new Error(`This workbook is password-protected and cannot be read. ${SAVE_AS_XLSX}`);
  }
  const stream = streams.get("Workbook");
  if (stream) return readXls(stream);
  if (streams.has("Book")) {
    throw new Error(`This is an Excel 5.0/95 workbook, which cannot be read. ${SAVE_AS_XLSX}`);
  }
  throw new Error("This file is not an Excel workbook (.xlsx, .xlsm or .xls).");
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}
