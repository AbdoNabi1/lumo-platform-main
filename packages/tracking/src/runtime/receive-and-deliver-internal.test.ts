/**
 * Single-ingress enforcement (P0-2).
 *
 * Three independent layers keep `receiveAndDeliver` internal, and each covers a way the other two
 * can be defeated:
 *
 * 1. **Not in the barrel**, and `package.json#exports` maps only `"."` — so no import path into
 *    `src/runtime/delivery-runtime` resolves for a consumer outside this package.
 * 2. **`FF-ARCH-09`** (`scripts/governance/run.mjs`) fails the build if the identifier appears in
 *    any file outside `packages/tracking/src/runtime/`, including tests, and including `apps/`
 *    which dependency-cruiser does not currently cruise.
 * 3. **This test**, which asserts the barrel's actual runtime shape.
 *
 * Layer 3 exists because layers 1 and 2 are both *absences* — an export that is not there, and a
 * grep that finds nothing. An absence is easy to reintroduce and easy to not notice. This asserts
 * the positive fact, and fails the moment someone re-adds the export, even if they also relax the
 * governance rule in the same commit.
 */

import { describe, expect, it } from "vitest";

import * as trackingPublicApi from "../index";
import { receiveAndDeliver } from "./delivery-runtime";
import { ingestTrackingEvent } from "./ingest-runtime";

describe("single ingress: receiveAndDeliver is internal to the Tracking Runtime", () => {
  it("is not reachable through the package's public entry point", () => {
    expect(Object.keys(trackingPublicApi)).not.toContain("receiveAndDeliver");
    expect((trackingPublicApi as Record<string, unknown>).receiveAndDeliver).toBeUndefined();
  });

  it("still exists inside the runtime, so the guarantee is about reach and not deletion", () => {
    // Asserting the function is alive matters: a test that only checked the barrel would keep
    // passing if someone deleted the pipeline entirely.
    expect(typeof receiveAndDeliver).toBe("function");
  });

  it("exposes ingestTrackingEvent as the one public way into the pipeline", () => {
    expect(trackingPublicApi.ingestTrackingEvent).toBe(ingestTrackingEvent);
  });

  it("still exports the types a composition root needs to build recording dependencies", () => {
    // Building `RecordingRuntimeDeps` must stay possible from outside; invoking the function that
    // consumes them must not. Types erase at runtime, so this asserts the runtime companions that
    // travel with them — their absence would mean the barrel edit removed too much.
    expect(trackingPublicApi.DELIVERY_PHASES).toBeDefined();
    expect(trackingPublicApi.InMemoryDestinationState).toBeDefined();
  });
});
