import { randomBytes } from "node:crypto";
import type { IdGenerator } from "@platform/contracts";

/**
 * Generates RFC 9562 UUIDv7 values via the Node crypto module: a 48-bit Unix-millisecond
 * timestamp followed by random bits. Time-ordered ids preserve B-tree index locality (the
 * documented persistence strategy). Infrastructure adapter for the application `IdGenerator`
 * port — the domain and application never import this (Dependency Inversion); it is wired into
 * the DI container at the composition root.
 */
export class CryptoIdGenerator implements IdGenerator {
  generate(): string {
    const bytes = randomBytes(16);

    // Bytes 0–5: 48-bit big-endian Unix timestamp in milliseconds.
    bytes.writeUIntBE(Date.now(), 0, 6);
    // Byte 6 high nibble: version 7.
    bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6);
    // Byte 8 high bits: variant (10xx).
    bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);

    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
