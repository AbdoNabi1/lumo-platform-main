import { describe, expect, it } from "vitest";
import { createMmdbGeoLookup, MmdbFormatError, type MmdbGeoLookup, UNKNOWN_GEO } from "./geo-mmdb";
import { parseIp } from "./ip-cidr";

// A tiny MaxMind-DB writer, test-only: enough of the format (maps, arrays, strings, uints, one pointer) to build
// a real file the reader has to walk, so the reader is checked against the published layout and not against itself.

type Value = string | number | Value[] | { [key: string]: Value };

function encodeString(text: string): number[] {
  const bytes = [...new TextEncoder().encode(text)];
  if (bytes.length >= 29) throw new Error("test strings stay short");
  return [(2 << 5) | bytes.length, ...bytes];
}

function encodeUint(type: 5 | 6, value: number): number[] {
  const bytes: number[] = [];
  for (let rest = value; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return [(type << 5) | bytes.length, ...bytes];
}

function encode(value: Value): number[] {
  if (typeof value === "string") return encodeString(value);
  if (typeof value === "number") return encodeUint(value > 0xffff ? 6 : 5, value);
  if (Array.isArray(value)) return [value.length, 4, ...value.flatMap(encode)];
  const entries = Object.entries(value);
  return [
    (7 << 5) | entries.length,
    ...entries.flatMap(([key, entry]) => [...encodeString(key), ...encode(entry)]),
  ];
}

interface Entry {
  readonly bits: readonly number[];
  readonly data: Value;
}

function bitsOf(cidr: string, family: 4 | 6, treeV6: boolean): number[] {
  const [address, prefixText] = cidr.split("/") as [string, string];
  const parsed = parseIp(address);
  if (parsed === null) throw new Error("bad test address");
  const width = parsed.family === 4 ? 32 : 128;
  const all: number[] = [];
  for (let index = width - 1; index >= 0; index -= 1)
    all.push(Number((parsed.value >> BigInt(index)) & 1n));
  const prefix = Number(prefixText);
  const bits = all.slice(0, prefix);
  if (family === 4 && treeV6) return [...new Array<number>(96).fill(0), ...bits];
  return bits;
}

function buildMmdb(
  ipVersion: 4 | 6,
  records: readonly { cidr: string; data: Value }[],
  options: { corruptMarker?: boolean } = {},
): Uint8Array {
  const entries: Entry[] = records.map((record) => ({
    bits: bitsOf(
      record.cidr,
      parseIp(record.cidr.split("/")[0] as string)?.family ?? 4,
      ipVersion === 6,
    ),
    data: record.data,
  }));

  // Data section: one encoded record per entry (a duplicate just repeats; the format allows it).
  const dataOffsets: number[] = [];
  const data: number[] = [];
  for (const entry of entries) {
    dataOffsets.push(data.length);
    data.push(...encode(entry.data));
  }

  // Search tree: node → [left, right]; an index >= 0 is a child node, a negative value is `-(entryIndex + 1)`.
  const nodes: [number | null, number | null][] = [[null, null]];
  entries.forEach((entry, entryIndex) => {
    let node = 0;
    entry.bits.forEach((bit, depth) => {
      const last = depth === entry.bits.length - 1;
      const slot = nodes[node] as [number | null, number | null];
      if (last) {
        slot[bit] = -(entryIndex + 1);
        return;
      }
      if (slot[bit] === null || (slot[bit] as number) < 0) {
        nodes.push([null, null]);
        slot[bit] = nodes.length - 1;
      }
      node = slot[bit] as number;
    });
  });

  const nodeCount = nodes.length;
  const record = (value: number | null): number => {
    if (value === null) return nodeCount; // no data
    if (value >= 0) return value;
    return nodeCount + 16 + (dataOffsets[-value - 1] as number);
  };
  const tree: number[] = [];
  for (const [left, right] of nodes) {
    for (const value of [record(left), record(right)])
      tree.push((value >> 16) & 255, (value >> 8) & 255, value & 255);
  }

  const marker = [
    0xab, 0xcd, 0xef, 0x4d, 0x61, 0x78, 0x4d, 0x69, 0x6e, 0x64, 0x2e, 0x63, 0x6f, 0x6d,
  ];
  if (options.corruptMarker === true) marker[0] = 0;
  const metadata = encode({
    node_count: nodeCount,
    record_size: 24,
    ip_version: ipVersion,
    database_type: "Test-Country",
  });
  return Uint8Array.from([
    ...tree,
    ...new Array<number>(16).fill(0),
    ...data,
    ...marker,
    ...metadata,
  ]);
}

const CAIRO = {
  country: { iso_code: "EG" },
  subdivisions: [{ names: { en: "Cairo Governorate" } }],
  city: { names: { en: "Cairo" } },
};
const COUNTRY_ONLY = { country: { iso_code: "sa" } };

describe("MmdbGeoLookup (IPv4 database)", () => {
  const lookup = createMmdbGeoLookup(
    buildMmdb(4, [
      { cidr: "41.32.0.0/16", data: CAIRO },
      { cidr: "41.33.5.0/24", data: COUNTRY_ONLY },
    ]),
  );

  it("finds the country, region and city of an address inside a range", () => {
    expect(lookup.lookup("41.32.7.9")).toEqual({
      country: "EG",
      region: "Cairo Governorate",
      city: "Cairo",
    });
  });

  it("upper-cases the country and leaves out what the database does not have", () => {
    expect(lookup.lookup("41.33.5.200")).toEqual({ country: "SA" });
  });

  it("answers null (unknown) for an address outside every range", () => {
    expect(lookup.lookup("8.8.8.8")).toBeNull();
    expect(lookup.lookup("41.33.6.1")).toBeNull();
  });

  it("answers null, never throws, for malformed input and for IPv6 on an IPv4-only database", () => {
    for (const bad of ["", "not an ip", "999.1.1.1", "41.32.7", "2001:db8::1"]) {
      expect(lookup.lookup(bad)).toBeNull();
    }
  });

  it("reads an IPv4-mapped IPv6 address as the IPv4 address", () => {
    expect(lookup.lookup("::ffff:41.32.7.9")?.country).toBe("EG");
  });
});

describe("MmdbGeoLookup (IPv6 database)", () => {
  const lookup = createMmdbGeoLookup(
    buildMmdb(6, [
      { cidr: "41.32.0.0/16", data: CAIRO },
      { cidr: "2a02:26f0::/32", data: COUNTRY_ONLY },
    ]),
  );

  it("finds IPv4 addresses under ::/96 and native IPv6 ranges", () => {
    expect(lookup.lookup("41.32.1.1")?.city).toBe("Cairo");
    expect(lookup.lookup("2a02:26f0:1234::1")).toEqual({ country: "SA" });
    expect(lookup.lookup("2a02:26f1::1")).toBeNull();
    expect(lookup.lookup("8.8.8.8")).toBeNull();
  });

  it("exposes the metadata", () => {
    expect((lookup as MmdbGeoLookup).metadata).toMatchObject({
      ipVersion: 6,
      recordSize: 24,
      databaseType: "Test-Country",
    });
  });
});

describe("a database that cannot be used", () => {
  it("is refused at load with MmdbFormatError (the runtime then degrades to unknown)", () => {
    expect(() => createMmdbGeoLookup(buildMmdb(4, [], { corruptMarker: true }))).toThrow(
      MmdbFormatError,
    );
    expect(() => createMmdbGeoLookup(new Uint8Array([1, 2, 3]))).toThrow(MmdbFormatError);
    expect(() => createMmdbGeoLookup(new Uint8Array(0))).toThrow(MmdbFormatError);
  });

  it("UNKNOWN_GEO answers null for everything", () => {
    expect(UNKNOWN_GEO.lookup("41.32.7.9")).toBeNull();
  });
});
