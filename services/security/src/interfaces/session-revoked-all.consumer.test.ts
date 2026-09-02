import { describe, expect, it } from "vitest";
import { SessionRevokedAllConsumer } from "./session-revoked-all.consumer";

describe("SessionRevokedAllConsumer — atomic opt-out (Sprint A0)", () => {
  it("never implements handleAtomic — this consumer makes an Ory Kratos HTTP call with no DB write to make atomic", () => {
    expect("handleAtomic" in SessionRevokedAllConsumer.prototype).toBe(false);
  });
});
