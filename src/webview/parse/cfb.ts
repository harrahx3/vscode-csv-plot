/**
 * Reader for the Compound File Binary format (OLE2 "structured storage"): the container of
 * legacy .xls workbooks, and of password-protected .xlsx files. Returns the streams by name.
 */

const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;
const HEADER_DIFAT_ENTRIES = 109;
const DIR_ENTRY_SIZE = 128;
const STREAM = 2;
const ROOT = 5;

/** Streams of the file by name (the storage hierarchy is flattened; .xls keeps them at the root). */
export function readCompoundFile(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset: number) => view.getUint32(offset, true);
  const sectorSize = 1 << view.getUint16(0x1e, true);
  const miniSectorSize = 1 << view.getUint16(0x20, true);
  const miniCutoff = u32(0x38);
  if (sectorSize !== 512 && sectorSize !== 4096) throw corrupt();
  const sectorCount = Math.floor((bytes.length - sectorSize) / sectorSize) + 1;
  const sectorOffset = (n: number) => (n + 1) * sectorSize;
  const perSector = sectorSize / 4;

  // DIFAT: where the FAT sectors are (109 in the header, the rest in a chain of DIFAT sectors).
  const fatSectors: number[] = [];
  for (let i = 0; i < HEADER_DIFAT_ENTRIES; i++) fatSectors.push(u32(0x4c + 4 * i));
  let difat = u32(0x44);
  for (let guard = 0; difat < sectorCount && guard < sectorCount; guard++) {
    const base = sectorOffset(difat);
    for (let i = 0; i < perSector - 1; i++) fatSectors.push(u32(base + 4 * i));
    difat = u32(base + sectorSize - 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    if (s >= sectorCount) continue;
    for (let i = 0; i < perSector; i++) fat.push(u32(sectorOffset(s) + 4 * i));
  }

  const chain = (start: number, next: number[], limit: number): number[] => {
    const out: number[] = [];
    for (let s = start; s !== END_OF_CHAIN && s !== FREE; s = next[s]) {
      if (s >= limit || out.length > limit) throw corrupt();
      out.push(s);
    }
    return out;
  };
  const readChain = (start: number, size: number): Uint8Array => {
    const out = new Uint8Array(size);
    let pos = 0;
    for (const s of chain(start, fat, sectorCount)) {
      const n = Math.min(sectorSize, size - pos);
      if (n <= 0) break;
      out.set(bytes.subarray(sectorOffset(s), sectorOffset(s) + n), pos);
      pos += n;
    }
    return out;
  };

  const dirSectors = chain(u32(0x30), fat, sectorCount);
  const directory = readChain(u32(0x30), dirSectors.length * sectorSize);
  const dir = new DataView(directory.buffer);
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (let off = 0; off + DIR_ENTRY_SIZE <= directory.length; off += DIR_ENTRY_SIZE) {
    const type = directory[off + 0x42];
    if (type !== STREAM && type !== ROOT) continue;
    const nameBytes = Math.max(dir.getUint16(off + 0x40, true) - 2, 0);
    let name = "";
    for (let i = 0; i < nameBytes; i += 2)
      name += String.fromCharCode(dir.getUint16(off + i, true));
    entries.push({
      name,
      type,
      start: dir.getUint32(off + 0x74, true),
      size: dir.getUint32(off + 0x78, true),
    });
  }

  // Small streams live in the mini stream (held by the root entry), in 64-byte mini sectors.
  const root = entries.find((e) => e.type === ROOT);
  let miniStream: Uint8Array | undefined;
  let miniFat: number[] | undefined;
  const readMini = (start: number, size: number): Uint8Array => {
    if (!miniStream || !miniFat) {
      miniStream = root ? readChain(root.start, root.size) : new Uint8Array(0);
      const raw = readChain(u32(0x3c), u32(0x40) * sectorSize);
      const v = new DataView(raw.buffer);
      miniFat = Array.from({ length: raw.length / 4 }, (_, i) => v.getUint32(4 * i, true));
    }
    const out = new Uint8Array(size);
    let pos = 0;
    const limit = Math.ceil(miniStream.length / miniSectorSize);
    for (const s of chain(start, miniFat, limit)) {
      const n = Math.min(miniSectorSize, size - pos);
      if (n <= 0) break;
      out.set(miniStream.subarray(s * miniSectorSize, s * miniSectorSize + n), pos);
      pos += n;
    }
    return out;
  };

  const streams = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (e.type !== STREAM || streams.has(e.name)) continue;
    streams.set(
      e.name,
      e.size < miniCutoff ? readMini(e.start, e.size) : readChain(e.start, e.size),
    );
  }
  return streams;
}

function corrupt(): Error {
  return new Error("This file looks damaged: its compound-file structure cannot be read.");
}
