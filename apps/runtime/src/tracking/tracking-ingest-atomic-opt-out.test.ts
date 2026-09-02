import { describe, expect, it } from "vitest";
import { TrackingIngestHandler } from "./tracking-ingest";

describe("TrackingIngestHandler — atomic opt-out (Sprint A0)", () => {
  it("never implements handleAtomic — vendor delivery is an HTTP call with no DB write to make atomic, and it runs its own purpose-different recordIfNew for destination-level dedup", () => {
    expect("handleAtomic" in TrackingIngestHandler.prototype).toBe(false);
  });
});
