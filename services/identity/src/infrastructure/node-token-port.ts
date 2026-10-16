import { createHash, randomBytes } from "node:crypto";
import type { TokenPort } from "../application/token-port";

/**
 * `TokenPort` over `node:crypto` — this repo's established convention for a CSPRNG/hash adapter
 * (see `NodeCrypto` in `services/security/src/infrastructure/in-memory-auth-adapters.ts`); no
 * shared crypto-utils package exists to reuse instead.
 */
export class NodeTokenPort implements TokenPort {
  generateRaw(): string {
    return randomBytes(32).toString("hex");
  }

  hash(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }
}
