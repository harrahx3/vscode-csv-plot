import type { WorkbookSpec } from "./make-xlsx.mjs";

export declare function encodeRk(value: number): number | null;
export declare function makeXls(
  spec: Omit<WorkbookSpec, "sheets"> & {
    sheets: (WorkbookSpec["sheets"][number] & { mulrk?: boolean; embeddedChart?: boolean })[];
    sstChunk?: number;
    extraStreams?: Record<string, Uint8Array>;
    workbookStream?: string;
  },
): Uint8Array;
export declare function makeCompoundFile(streams: Record<string, Uint8Array>): Uint8Array;
export declare function hourlyXls(hours?: number): Uint8Array;
