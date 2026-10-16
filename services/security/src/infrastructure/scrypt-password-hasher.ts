import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { PasswordHasher } from "../application/password-credentials";

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const R = 8;
const P = 1;
const MAX_MEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) => {
      if (error !== null) reject(error);
      else resolve(key);
    });
  });
}

interface Parsed {
  readonly log2N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

function parse(stored: string): Parsed | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, n, r, p, salt, hash] = parts;
  const log2N = Number(n);
  const rr = Number(r);
  const pp = Number(p);
  if (![log2N, rr, pp].every((v) => Number.isInteger(v) && v > 0) || log2N > 20) return null;
  if (salt === undefined || hash === undefined || salt === "" || hash === "") return null;
  const saltBuf = Buffer.from(salt, "base64");
  const hashBuf = Buffer.from(hash, "base64");
  if (saltBuf.length === 0 || hashBuf.length !== KEY_LENGTH) return null;
  return { log2N, r: rr, p: pp, salt: saltBuf, hash: hashBuf };
}

/**
 * Plan 1B-1: scrypt password hashing on `node:crypto` (no dependency). Format:
 * `scrypt$<log2N>$<r>$<p>$<salt base64>$<hash base64>`. Production default N = 2^15, r = 8, p = 1.
 */
export class ScryptPasswordHasher implements PasswordHasher {
  private readonly log2N: number;

  constructor(options: { readonly log2N?: number } = {}) {
    this.log2N = options.log2N ?? 15;
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(password, salt, { N: 2 ** this.log2N, r: R, p: P, maxmem: MAX_MEM });
    return `scrypt$${this.log2N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parse(stored);
    if (parsed === null) return false;
    try {
      const key = await derive(password, parsed.salt, {
        N: 2 ** parsed.log2N,
        r: parsed.r,
        p: parsed.p,
        maxmem: MAX_MEM,
      });
      return timingSafeEqual(key, parsed.hash);
    } catch {
      return false;
    }
  }

  needsRehash(stored: string): boolean {
    const parsed = parse(stored);
    return parsed === null || parsed.log2N !== this.log2N || parsed.r !== R || parsed.p !== P;
  }
}
