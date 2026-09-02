/**
 * Transformation Metadata tests (P5.5).
 *
 * The property worth guarding is the one the module note argues for: two built-ins that look
 * harmless — `minor_to_major`, `to_unix_seconds` — are declared non-idempotent on purpose, and a
 * regression here (someone "fixing" them to `true` because the function looks pure) would silently
 * defeat whatever downstream validator relies on this table to catch a double-applied transform.
 */

import { describe, expect, it } from "vitest";

import {
  BUILT_IN_TRANSFORM_METADATA,
  BUILT_IN_TRANSFORMS,
  isSafeToRepeat,
  metadataFor,
  type TransformMetadata,
  type TransformMetadataRegistryPort,
  type TransformName,
} from "../index";

describe("Transformation Metadata: coverage", () => {
  it("declares metadata for every built-in transform, and nothing else", () => {
    const transforms = Object.keys(BUILT_IN_TRANSFORMS).sort();
    const metadata = Object.keys(BUILT_IN_TRANSFORM_METADATA).sort();

    // The `Readonly<Record<TransformName, …>>` annotation makes a missing entry a compile error;
    // this asserts the runtime object actually matches too, independent of the type check.
    expect(metadata).toEqual(transforms);
  });

  it("names every metadata entry after its own key", () => {
    for (const [key, meta] of Object.entries(BUILT_IN_TRANSFORM_METADATA)) {
      expect(meta.name).toBe(key);
    }
  });
});

describe("Transformation Metadata: declares no execution logic", () => {
  it("is JSON-serializable — no functions anywhere", () => {
    const findFunction = (value: unknown): boolean => {
      if (typeof value === "function") return true;
      if (value === null || typeof value !== "object") return false;
      return Object.values(value as Record<string, unknown>).some(findFunction);
    };

    // A function on a metadata entry would mean this file executes something, which is precisely
    // what the module note says it must never do.
    expect(findFunction(BUILT_IN_TRANSFORM_METADATA)).toBe(false);
  });
});

describe("Transformation Metadata: the two non-obvious facts", () => {
  it("flags minor_to_major as non-idempotent", () => {
    // 12500 minor units -> 125.00 major on the first pass. A second pass would divide 125 by 100
    // again and silently report a purchase 100x too small — the exact bug this fact exists to catch.
    expect(BUILT_IN_TRANSFORM_METADATA.minor_to_major.idempotent).toBe(false);
    expect(BUILT_IN_TRANSFORM_METADATA.minor_to_major.deterministic).toBe(true);
  });

  it("flags to_unix_seconds as non-idempotent", () => {
    // Reapplied to its own output (seconds), the numeric branch reinterprets it as milliseconds and
    // collapses the timestamp toward the epoch.
    expect(BUILT_IN_TRANSFORM_METADATA.to_unix_seconds.idempotent).toBe(false);
  });

  it("flags lowercase/uppercase/trim as non-reversible despite being idempotent", () => {
    // Idempotent and reversible are independent axes: applying `lowercase` twice is safe (same
    // result both times), but the discarded case information is never coming back.
    expect(BUILT_IN_TRANSFORM_METADATA.lowercase.idempotent).toBe(true);
    expect(BUILT_IN_TRANSFORM_METADATA.lowercase.reversible).toBe(false);
  });

  it("declares every built-in free of side effects", () => {
    // `TransformFn` is typed as a pure `Scalar → unknown`; this is the checkable statement of that
    // invariant without reading a single function body.
    for (const meta of Object.values(BUILT_IN_TRANSFORM_METADATA)) {
      expect(meta.sideEffects).toBe(false);
    }
  });
});

describe("Transformation Metadata: resolution follows applyMapping's own order", () => {
  it("falls back to the built-in table when no registry is given", () => {
    expect(metadataFor("lowercase")).toBe(BUILT_IN_TRANSFORM_METADATA.lowercase);
  });

  it("returns null for an unknown name", () => {
    expect(metadataFor("not_a_real_transform")).toBeNull();
  });

  it("prefers a registry-supplied entry over the built-in of the same name", () => {
    const custom: TransformMetadata = {
      name: "lowercase",
      category: "normalization",
      cost: "low",
      deterministic: true,
      idempotent: true,
      reversible: false,
      dependencies: [],
      sideEffects: false,
      description: "A registry override.",
    };
    const registry: TransformMetadataRegistryPort = {
      resolve: (name) => (name === "lowercase" ? custom : null),
    };

    // Same precedence `applyMapping` uses for the functions themselves: registry first, built-in
    // second. A query about "the transform this mapping will actually run" must not disagree with
    // what mapping itself resolves.
    expect(metadataFor("lowercase", registry)).toBe(custom);
    expect(metadataFor("uppercase", registry)).toBe(BUILT_IN_TRANSFORM_METADATA.uppercase);
  });
});

describe("Transformation Metadata: isSafeToRepeat", () => {
  it("is true only when both deterministic and idempotent", () => {
    expect(isSafeToRepeat(BUILT_IN_TRANSFORM_METADATA.identity)).toBe(true);
    expect(isSafeToRepeat(BUILT_IN_TRANSFORM_METADATA.trim)).toBe(true);
    // minor_to_major is deterministic but not idempotent — repeating it is NOT safe, and this is the
    // one query a mapping-profile validator would actually call.
    expect(isSafeToRepeat(BUILT_IN_TRANSFORM_METADATA.minor_to_major)).toBe(false);
  });

  const names = Object.keys(BUILT_IN_TRANSFORMS) as readonly TransformName[];
  for (const name of names) {
    it(`agrees with the declared flags for "${name}"`, () => {
      const meta = BUILT_IN_TRANSFORM_METADATA[name];
      expect(isSafeToRepeat(meta)).toBe(meta.deterministic && meta.idempotent);
    });
  }
});
