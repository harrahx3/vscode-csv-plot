export declare const STYLE: {
  general: number;
  date: number;
  dateTime: number;
  decimals: number;
  elapsed: number;
};
export declare function columnLetters(index: number): string;
export interface WorkbookSpec {
  sheets: {
    name: string;
    rows?: (unknown[] | null)[];
    hidden?: boolean;
    chart?: boolean;
    omitRefs?: boolean;
  }[];
  date1904?: boolean;
  activeTab?: number;
}
export declare function makeXlsx(spec: WorkbookSpec): Uint8Array;
export declare function hourlySpec(hours?: number): WorkbookSpec;
export declare function hourlyWorkbook(hours?: number): Uint8Array;
