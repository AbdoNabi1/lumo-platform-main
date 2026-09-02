import { describe, expect, it } from "vitest";
import { RelationDeletedConsumer, RelationWrittenConsumer } from "./relation-sync.consumer";

describe("RelationWrittenConsumer / RelationDeletedConsumer — atomic opt-out (Sprint A0)", () => {
  it("never implements handleAtomic — these consumers make an Ory Keto HTTP call with no DB write to make atomic", () => {
    expect("handleAtomic" in RelationWrittenConsumer.prototype).toBe(false);
    expect("handleAtomic" in RelationDeletedConsumer.prototype).toBe(false);
  });
});
