/**
 * Event Diff tests (P5.5 / P8.4).
 *
 * The central claim under test: a faithful replay shows **no business-payload change**, while
 * transport metadata is *expected* to differ. If the severity classification is wrong in either
 * direction the tool is useless — either it cries wolf on every regenerated nonce, or it reports a
 * corrupted order value with the same weight as a new request id and the reader learns to skim.
 */

import { describe, expect, it } from "vitest";

import { diffEvents, type DiffSide } from "./event-diff";

const payload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  event_name: "Purchase",
  event_time: 1_700_000_000,
  custom_data: { value: 42.5, currency: "USD" },
  contents: [{ id: "sku-1", quantity: 2 }],
  ...overrides,
});

const side = (over: Partial<DiffSide> = {}): DiffSide => ({ payload: payload(), ...over });

describe("Event Diff: a faithful replay", () => {
  it("reports no changes for an identical payload", () => {
    const diff = diffEvents("e1", side(), side());
    expect(diff.payloadChanges).toEqual([]);
    expect(diff.faithful).toBe(true);
    expect(diff.defectCount).toBe(0);
  });

  it("is key-order independent", () => {
    const before: DiffSide = { payload: { a: 1, b: 2 } };
    const after: DiffSide = { payload: { b: 2, a: 1 } };
    // `{a,b}` and `{b,a}` are the same payload; reporting them as different would fire on every
    // ORM round-trip and JSON rehydration.
    expect(diffEvents("e1", before, after).payloadChanges).toEqual([]);
  });

  it("stays faithful when only transport metadata changed", () => {
    const before = side({ payload: { ...payload(), authorization: "Bearer old", nonce: "n1" } });
    const after = side({ payload: { ...payload(), authorization: "Bearer new", nonce: "n2" } });

    const diff = diffEvents("e1", before, after);
    // D-080: transport is regenerated per transmission. Its *absence* would be the bug.
    expect(diff.payloadChanges.every((c) => c.severity === "expected")).toBe(true);
    expect(diff.faithful).toBe(true);
  });
});

describe("Event Diff: a defective replay", () => {
  it("flags a changed business value as a defect", () => {
    const after = side({ payload: payload({ custom_data: { value: 99.99, currency: "USD" } }) });
    const diff = diffEvents("e1", side(), after);

    expect(diff.faithful).toBe(false);
    const change = diff.payloadChanges.find((c) => c.path === "custom_data.value");
    expect(change).toMatchObject({
      kind: "changed",
      before: 42.5,
      after: 99.99,
      severity: "defect",
    });
  });

  it("flags a removed and an added field", () => {
    const before: DiffSide = { payload: { a: 1, gone: "x" } };
    const after: DiffSide = { payload: { a: 1, fresh: "y" } };

    const diff = diffEvents("e1", before, after);
    expect(diff.payloadChanges).toContainEqual(
      expect.objectContaining({ path: "gone", kind: "removed", severity: "defect" }),
    );
    expect(diff.payloadChanges).toContainEqual(
      expect.objectContaining({ path: "fresh", kind: "added", severity: "defect" }),
    );
  });

  it("treats event_time as BUSINESS even though it looks like transport", () => {
    const after = side({ payload: payload({ event_time: 1_700_009_999 }) });
    const diff = diffEvents("e1", side(), after);

    // Regenerating event_time lands the conversion in the wrong attribution window. The
    // BUSINESS_TIME_KEYS allow-list is checked BEFORE the transport list for exactly this reason.
    expect(diff.payloadChanges.find((c) => c.path === "event_time")?.severity).toBe("defect");
    expect(diff.faithful).toBe(false);
  });

  it("treats array order as semantic, not as a set", () => {
    const before: DiffSide = { payload: { contents: [{ id: "a" }, { id: "b" }] } };
    const after: DiffSide = { payload: { contents: [{ id: "b" }, { id: "a" }] } };

    // Line-item order is semantic in every commerce payload; set-comparison would hide a reordering
    // that changes what the vendor attributes revenue to.
    expect(diffEvents("e1", before, after).faithful).toBe(false);
  });

  it("reports a nested path precisely rather than flagging the whole object", () => {
    const before: DiffSide = { payload: { a: { b: { c: 1, d: 2 } } } };
    const after: DiffSide = { payload: { a: { b: { c: 1, d: 3 } } } };

    const diff = diffEvents("e1", before, after);
    expect(diff.payloadChanges).toHaveLength(1);
    expect(diff.payloadChanges[0]?.path).toBe("a.b.d");
  });
});

describe("Event Diff: destinations, responses and versions", () => {
  it("classifies a vendor response difference as informational, not a defect", () => {
    const diff = diffEvents(
      "e1",
      { ...side(), response: { events_received: 1, fbtrace_id: "A" } },
      { ...side(), response: { events_received: 1, fbtrace_id: "B" } },
    );

    // A vendor answering differently on replay is expected and says nothing about payload fidelity.
    expect(diff.responseChanges.every((c) => c.severity === "informational")).toBe(true);
    expect(diff.faithful).toBe(true);
  });

  it("reports a destination that changed status", () => {
    const diff = diffEvents(
      "e1",
      { ...side(), destinations: { "meta.capi": { status: "delivered" } } },
      { ...side(), destinations: { "meta.capi": { status: "failed" } } },
    );

    expect(diff.destinationChanges).toEqual([
      {
        destination: "meta.capi",
        kind: "changed",
        beforeStatus: "delivered",
        afterStatus: "failed",
      },
    ]);
  });

  it("surfaces a destination that appears only on replay", () => {
    const diff = diffEvents(
      "e1",
      { ...side(), destinations: {} },
      { ...side(), destinations: { "tiktok.events": { status: "delivered" } } },
    );

    // Replay targets come from stored history, never from re-evaluated rules. A NEW destination
    // means the scope was built from something other than the record.
    expect(diff.destinationChanges).toEqual([
      { destination: "tiktok.events", kind: "added", afterStatus: "delivered" },
    ]);
  });

  it("reports pinned version drift", () => {
    const diff = diffEvents(
      "e1",
      { ...side(), versions: { destination: 4, mapping: 2 } },
      { ...side(), versions: { destination: 5, mapping: 2 } },
    );

    expect(diff.versionChanges).toEqual([{ field: "destination", before: 4, after: 5 }]);
  });
});

describe("Event Diff: edge cases", () => {
  it("does not report two NaNs as a change", () => {
    // `===` says NaN !== NaN, which would make an unchanged payload diff as changed on every run.
    const before: DiffSide = { payload: { v: Number.NaN } };
    const after: DiffSide = { payload: { v: Number.NaN } };
    expect(diffEvents("e1", before, after).payloadChanges).toEqual([]);
  });

  it("distinguishes an absent key from an explicit undefined value", () => {
    const before: DiffSide = { payload: { a: 1 } };
    const after: DiffSide = { payload: { a: 1, b: undefined } };
    expect(diffEvents("e1", before, after).payloadChanges).toHaveLength(1);
  });

  it("does not confuse null with a missing object", () => {
    const before: DiffSide = { payload: { a: null } };
    const after: DiffSide = { payload: { a: { nested: 1 } } };
    expect(diffEvents("e1", before, after).faithful).toBe(false);
  });
});
