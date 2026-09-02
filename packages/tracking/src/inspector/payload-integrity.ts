/**
 * Payload integrity verification (M5 sign-off amendment).
 *
 * The stored business payload is now part of the replay source of truth, so replay must be able to
 * *prove* the bytes it is about to re-send are the bytes that were originally stored — not assume
 * it. A SHA-256 digest over a **canonical** serialization turns replay determinism into a
 * verifiable guarantee.
 *
 * The objective is **integrity, not security**: this detects storage corruption, backup corruption,
 * accidental mutation, serialization regressions and operational data-repair mistakes. It is not a
 * MAC and does not defend against a motivated attacker who can rewrite both payload and digest — a
 * different problem, solved by the WORM audit trail (ADR-0009), not here.
 *
 * ## Why canonical serialization is the whole game
 *
 * `JSON.stringify` preserves key **insertion order**, so `{a:1,b:2}` and `{b:2,a:1}` — semantically
 * identical payloads — serialize differently and would digest differently. A record written by one
 * code path and re-read through another (a mapper change, an ORM round-trip, a JSON column
 * rehydration) would then fail verification despite nothing being wrong. Canonicalizing with sorted
 * keys makes the digest a function of *meaning* rather than of construction order.
 */

import type { HashPort } from "../ids/dedup-id";

export const PAYLOAD_DIGEST_ALGORITHM = "sha256";

/** Thrown for values that cannot be canonicalized deterministically. */
export class NonCanonicalizableValueError extends Error {
  constructor(
    readonly path: string,
    readonly detail: string,
  ) {
    super(`cannot canonicalize ${path}: ${detail}`);
    this.name = "NonCanonicalizableValueError";
  }
}

/**
 * Deterministic serialization.
 *
 * - Object keys are sorted by code unit, recursively — order of construction is irrelevant.
 * - Array order is **preserved**: it is semantic, not incidental.
 * - `undefined` object properties are omitted (they never survive a JSON round-trip anyway, so
 *   including them would make the digest depend on in-memory shape rather than stored shape).
 * - `undefined` inside an array becomes `null`, matching JSON semantics exactly.
 * - Non-finite numbers throw rather than silently becoming `null`, which would make two different
 *   payloads digest identically.
 */
export function canonicalize(value: unknown, path = "$"): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);

    case "boolean":
      return value ? "true" : "false";

    case "number": {
      if (!Number.isFinite(value)) {
        throw new NonCanonicalizableValueError(path, `non-finite number (${String(value)})`);
      }
      // Normalizes -0 to 0, matching JSON round-trip behaviour.
      return JSON.stringify(value === 0 ? 0 : value);
    }

    case "object": {
      if (Array.isArray(value)) {
        const items = value.map((item, index) =>
          item === undefined ? "null" : canonicalize(item, `${path}[${String(index)}]`),
        );
        return `[${items.join(",")}]`;
      }

      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

      const parts = entries.map(
        ([key, v]) => `${JSON.stringify(key)}:${canonicalize(v, `${path}.${key}`)}`,
      );
      return `{${parts.join(",")}}`;
    }

    default:
      // Functions, symbols and bigint have no stable JSON form.
      throw new NonCanonicalizableValueError(path, `unsupported type ${typeof value}`);
  }
}

/** Computes the digest of a business payload. */
export async function computePayloadDigest(
  payload: Readonly<Record<string, unknown>>,
  hasher: HashPort,
): Promise<string> {
  return hasher.sha256Hex(canonicalize(payload));
}

export type IntegrityResult =
  | { readonly valid: true; readonly digest: string }
  | {
      readonly valid: false;
      readonly reason: "digest_mismatch" | "digest_absent" | "not_canonicalizable";
      readonly expected?: string;
      readonly actual?: string;
      readonly detail?: string;
    };

/**
 * Verifies a stored payload against its stored digest.
 *
 * A **missing** digest is a failure, not a pass. Treating an absent digest as "nothing to check"
 * would mean any record whose hash was lost — precisely what a corrupted restore looks like —
 * would replay unverified, which defeats the entire purpose.
 */
export async function verifyPayloadDigest(
  payload: Readonly<Record<string, unknown>>,
  expected: string | undefined,
  hasher: HashPort,
): Promise<IntegrityResult> {
  if (expected === undefined || expected.trim() === "") {
    return { valid: false, reason: "digest_absent" };
  }

  let actual: string;
  try {
    actual = await computePayloadDigest(payload, hasher);
  } catch (error) {
    return {
      valid: false,
      reason: "not_canonicalizable",
      detail: error instanceof Error ? error.message : "canonicalization failed",
    };
  }

  return actual === expected
    ? { valid: true, digest: actual }
    : { valid: false, reason: "digest_mismatch", expected, actual };
}
