import { beforeEach, describe, expect, it } from "vitest";
import { leadOf, NOW } from "../testing/fixtures";
import { Lead, LEAD_STATUSES, LEAD_TRACKING_STATUSES } from "./lead";

beforeEach(() => {
  expect.hasAssertions();
});

describe("Lead", () => {
  it("lists the closed status sets", () => {
    expect(LEAD_STATUSES).toEqual([
      "new",
      "contacted",
      "qualified",
      "converted",
      "rejected",
      "spam",
    ]);
    expect(LEAD_TRACKING_STATUSES).toEqual([
      "pending",
      "suppressed",
      "skipped_spam",
      "sent",
      "failed",
    ]);
  });

  it("restore keeps the props exactly as given", () => {
    const lead = leadOf({ version: 3 });
    expect(lead).toBeInstanceOf(Lead);
    expect(lead.props.version).toBe(3);
    expect(lead.props.phoneE164).toBe("+201012345678");
  });

  it("withStatus with the same status returns the same instance", () => {
    const lead = leadOf();
    expect(lead.withStatus("new", new Date("2026-11-23T00:00:00.000Z"))).toBe(lead);
  });

  it("withStatus with a different status bumps the version and updatedAt, leaving the original untouched", () => {
    const lead = leadOf();
    const at = new Date("2026-11-23T00:00:00.000Z");
    const next = lead.withStatus("contacted", at);
    expect(next).not.toBe(lead);
    expect(next.props.status).toBe("contacted");
    expect(next.props.version).toBe(1);
    expect(next.props.updatedAt).toBe(at);
    expect(next.props.createdAt).toBe(NOW);
    expect(lead.props.status).toBe("new");
    expect(lead.props.version).toBe(0);
  });
});
