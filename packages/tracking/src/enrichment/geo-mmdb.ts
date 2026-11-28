/**
 * IP → country (and, when the database has it, region and city) from a MaxMind-DB (`.mmdb`) file — the format of
 * MaxMind GeoLite2 and DB-IP Lite alike (Tracking P1-D8, gap B1).
 *
 * ## Why an in-house reader
 *
 * The plan allows a geo lookup only if it costs no new dependency, and no `.mmdb` reader is installed (nothing can
 * be installed from this task). The format is small and fully specified
 * (https://maxmind.github.io/MaxMind-DB/): a binary search tree of fixed-size records, a data section, and a
 * metadata map after a marker. This is a read-only implementation of exactly that.
 *
 * ## Operating rules (owner decision)
 *
 * - The database is OPTIONAL. The runtime reads it from the path in `TRACKING_GEO_DB_PATH` when that file exists;
 *   there is no download at runtime, no licence key in the repository and no network call. No file, an unreadable
 *   file or a corrupt one ⇒ the lookup answers "unknown" for every address and the event simply carries no
 *   `countryDetected` — never an error, never a guess.
 * - Licence terms of the file (GeoLite2 EULA / DB-IP CC BY 4.0 attribution) are the operator's to meet; the
 *   repository ships no database.
 * - Accuracy: country is reliable; region and city (only present in the City editions) are weak in Egypt below
 *   governorate level. Treat them as hints.
 */

import { parseIp } from "./ip-cidr";

/** What a lookup yields. Every field is optional: absent = unknown. */
export interface GeoResult {
  /** ISO 3166-1 alpha-2, upper case. */
  readonly country?: string;
  readonly region?: string;
  readonly city?: string;
}

/** The seam the collect step reads. `null` = unknown, always a valid answer. */
export interface GeoLookupPort {
  lookup(ip: string): GeoResult | null;
}

/** The lookup used when no database is configured or it could not be read. */
export const UNKNOWN_GEO: GeoLookupPort = { lookup: () => null };

export class MmdbFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MmdbFormatError";
  }
}

const METADATA_MARKER = [
  0xab, 0xcd, 0xef, 0x4d, 0x61, 0x78, 0x4d, 0x69, 0x6e, 0x64, 0x2e, 0x63, 0x6f, 0x6d,
];
const DATA_SEPARATOR_SIZE = 16;
const MAX_DEPTH = 32;

type MmdbValue = string | number | bigint | boolean | Uint8Array | MmdbValue[] | MmdbMap;
interface MmdbMap {
  [key: string]: MmdbValue;
}

interface Decoded {
  readonly value: MmdbValue;
  /** The offset just after this value (pointers do not move it past the pointed-to data). */
  readonly next: number;
}

function lastIndexOfMarker(bytes: Uint8Array): number {
  for (let start = bytes.length - METADATA_MARKER.length; start >= 0; start -= 1) {
    let matched = true;
    for (let index = 0; index < METADATA_MARKER.length; index += 1) {
      if (bytes[start + index] !== METADATA_MARKER[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return start;
  }
  return -1;
}

class Decoder {
  private readonly view: DataView;
  private readonly text = new TextDecoder("utf-8", { fatal: false });

  /** `base` is where pointers are relative to: the data section for records, the metadata start for metadata. */
  constructor(
    private readonly bytes: Uint8Array,
    private readonly base: number,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private byte(offset: number): number {
    const value = this.bytes[offset];
    if (value === undefined) throw new MmdbFormatError("read past the end of the file");
    return value;
  }

  private uint(offset: number, length: number): number {
    let value = 0;
    for (let index = 0; index < length; index += 1) value = value * 256 + this.byte(offset + index);
    return value;
  }

  private bigUint(offset: number, length: number): bigint {
    let value = 0n;
    for (let index = 0; index < length; index += 1)
      value = (value << 8n) | BigInt(this.byte(offset + index));
    return value;
  }

  decode(offset: number, depth = 0): Decoded {
    if (depth > MAX_DEPTH) throw new MmdbFormatError("data nesting too deep");
    const control = this.byte(offset);
    let cursor = offset + 1;
    let type = control >> 5;

    if (type === 1) {
      // Pointer: the size bits carry address bits instead of a length.
      const size = (control >> 3) & 0x3;
      const low = control & 0x7;
      let target: number;
      if (size === 0) {
        target = (low << 8) | this.byte(cursor);
      } else if (size === 1) {
        target = ((low << 16) | this.uint(cursor, 2)) + 2048;
      } else if (size === 2) {
        target = ((low << 24) | this.uint(cursor, 3)) + 526336;
      } else {
        target = this.uint(cursor, 4);
      }
      cursor += size + 1;
      return { value: this.decode(this.base + target, depth + 1).value, next: cursor };
    }

    if (type === 0) {
      type = 7 + this.byte(cursor);
      cursor += 1;
    }

    let size = control & 0x1f;
    if (size === 29) {
      size = 29 + this.byte(cursor);
      cursor += 1;
    } else if (size === 30) {
      size = 285 + this.uint(cursor, 2);
      cursor += 2;
    } else if (size === 31) {
      size = 65821 + this.uint(cursor, 3);
      cursor += 3;
    }

    switch (type) {
      case 2: {
        const end = cursor + size;
        if (end > this.bytes.length) throw new MmdbFormatError("string past the end of the file");
        return { value: this.text.decode(this.bytes.subarray(cursor, end)), next: end };
      }
      case 3:
        return { value: this.view.getFloat64(cursor), next: cursor + 8 };
      case 4: {
        const end = cursor + size;
        return { value: this.bytes.subarray(cursor, end), next: end };
      }
      case 5:
      case 6:
        return { value: this.uint(cursor, size), next: cursor + size };
      case 8:
        return { value: size === 0 ? 0 : this.view.getInt32(cursor), next: cursor + size };
      case 9:
      case 10:
        return { value: this.bigUint(cursor, size), next: cursor + size };
      case 14:
        return { value: size !== 0, next: cursor };
      case 15:
        return { value: this.view.getFloat32(cursor), next: cursor + 4 };
      case 7: {
        const map: MmdbMap = {};
        for (let entry = 0; entry < size; entry += 1) {
          const key = this.decode(cursor, depth + 1);
          if (typeof key.value !== "string") throw new MmdbFormatError("map key is not a string");
          const value = this.decode(key.next, depth + 1);
          map[key.value] = value.value;
          cursor = value.next;
        }
        return { value: map, next: cursor };
      }
      case 11: {
        const list: MmdbValue[] = [];
        for (let entry = 0; entry < size; entry += 1) {
          const item = this.decode(cursor, depth + 1);
          list.push(item.value);
          cursor = item.next;
        }
        return { value: list, next: cursor };
      }
      default:
        throw new MmdbFormatError(`unsupported data type ${String(type)}`);
    }
  }
}

function asMap(value: MmdbValue | undefined): MmdbMap | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
    ? value
    : undefined;
}

function nameOf(value: MmdbValue | undefined): string | undefined {
  const names = asMap(asMap(value)?.["names"]);
  const english = names?.["en"];
  return typeof english === "string" && english !== "" ? english : undefined;
}

function geoFrom(record: MmdbValue): GeoResult | null {
  const root = asMap(record);
  if (root === undefined) return null;
  const country = asMap(root["country"])?.["iso_code"];
  const subdivisions = root["subdivisions"];
  const region = Array.isArray(subdivisions) ? nameOf(subdivisions[0]) : undefined;
  const city = nameOf(root["city"]);
  const iso =
    typeof country === "string" && /^[A-Za-z]{2}$/u.test(country)
      ? country.toUpperCase()
      : undefined;
  if (iso === undefined && region === undefined && city === undefined) return null;
  return {
    ...(iso === undefined ? {} : { country: iso }),
    ...(region === undefined ? {} : { region }),
    ...(city === undefined ? {} : { city }),
  };
}

/** The bits of a textual IPv4/IPv6 address (most significant first); `null` for anything else. */
function addressBits(ip: string): { family: 4 | 6; bits: number[] } | null {
  const parsed = parseIp(ip);
  if (parsed === null) return null;
  const width = parsed.family === 4 ? 32 : 128;
  const bits: number[] = [];
  for (let index = width - 1; index >= 0; index -= 1) {
    bits.push(Number((parsed.value >> BigInt(index)) & 1n));
  }
  return { family: parsed.family, bits };
}

export interface MmdbMetadata {
  readonly nodeCount: number;
  readonly recordSize: number;
  readonly ipVersion: 4 | 6;
  readonly databaseType: string;
}

/**
 * A reader over an in-memory `.mmdb`. Throws {@link MmdbFormatError} on a structurally invalid file (the caller
 * degrades to {@link UNKNOWN_GEO}); a lookup itself never throws.
 */
export class MmdbGeoLookup implements GeoLookupPort {
  readonly metadata: MmdbMetadata;
  private readonly treeSize: number;
  private readonly decoder: Decoder;
  private readonly nodeBytes: number;
  private ipv4StartNode: number | undefined;

  constructor(private readonly bytes: Uint8Array) {
    const marker = lastIndexOfMarker(bytes);
    if (marker < 0) throw new MmdbFormatError("not a MaxMind DB file (no metadata marker)");
    const metaStart = marker + METADATA_MARKER.length;
    const meta = asMap(new Decoder(bytes, metaStart).decode(metaStart).value);
    const nodeCount = meta?.["node_count"];
    const recordSize = meta?.["record_size"];
    const ipVersion = meta?.["ip_version"];
    const databaseType = meta?.["database_type"];
    if (
      typeof nodeCount !== "number" ||
      typeof recordSize !== "number" ||
      ![24, 28, 32].includes(recordSize) ||
      (ipVersion !== 4 && ipVersion !== 6)
    ) {
      throw new MmdbFormatError("unsupported or incomplete MaxMind DB metadata");
    }
    this.metadata = {
      nodeCount,
      recordSize,
      ipVersion,
      databaseType: typeof databaseType === "string" ? databaseType : "",
    };
    this.nodeBytes = (recordSize * 2) / 8;
    this.treeSize = nodeCount * this.nodeBytes;
    if (this.treeSize + DATA_SEPARATOR_SIZE > marker) {
      throw new MmdbFormatError("search tree larger than the file");
    }
    this.decoder = new Decoder(bytes, this.treeSize + DATA_SEPARATOR_SIZE);
  }

  private record(node: number, right: boolean): number {
    const base = node * this.nodeBytes;
    const b = (offset: number): number => this.bytes[base + offset] as number;
    if (this.metadata.recordSize === 24) {
      const o = right ? 3 : 0;
      return (b(o) << 16) | (b(o + 1) << 8) | b(o + 2);
    }
    if (this.metadata.recordSize === 28) {
      if (right) return ((b(3) & 0x0f) << 24) | (b(4) << 16) | (b(5) << 8) | b(6);
      return ((b(3) & 0xf0) << 20) | (b(0) << 16) | (b(1) << 8) | b(2);
    }
    const o = right ? 4 : 0;
    return ((b(o) << 24) | (b(o + 1) << 16) | (b(o + 2) << 8) | b(o + 3)) >>> 0;
  }

  private walk(start: number, bits: readonly number[]): number {
    let node = start;
    const { nodeCount } = this.metadata;
    for (const bit of bits) {
      if (node >= nodeCount) break;
      node = this.record(node, bit === 1);
    }
    return node;
  }

  private v4Start(): number {
    if (this.ipv4StartNode !== undefined) return this.ipv4StartNode;
    let node = 0;
    if (this.metadata.ipVersion === 6) {
      // IPv4 lives under ::/96 in an IPv6 tree.
      node = this.walk(0, new Array<number>(96).fill(0));
    }
    this.ipv4StartNode = node;
    return node;
  }

  lookup(ip: string): GeoResult | null {
    try {
      const parsed = addressBits(ip);
      if (parsed === null) return null;
      // An IPv6 address cannot be looked up in an IPv4-only database.
      if (parsed.family === 6 && this.metadata.ipVersion === 4) return null;
      const node = this.walk(parsed.family === 4 ? this.v4Start() : 0, parsed.bits);
      const { nodeCount } = this.metadata;
      if (node <= nodeCount) return null;
      const offset = node - nodeCount - DATA_SEPARATOR_SIZE;
      return geoFrom(this.decoder.decode(this.treeSize + DATA_SEPARATOR_SIZE + offset).value);
    } catch {
      return null;
    }
  }
}

/** Builds a lookup from file bytes; throws {@link MmdbFormatError} if the file is not a usable MaxMind DB. */
export function createMmdbGeoLookup(bytes: Uint8Array): GeoLookupPort {
  return new MmdbGeoLookup(bytes);
}
