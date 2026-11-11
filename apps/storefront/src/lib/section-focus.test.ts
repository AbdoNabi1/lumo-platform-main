import { beforeEach, describe, expect, it } from "vitest";
import { SECTION_FOCUS_MESSAGE } from "@platform/storefront-content";
import { FOCUS_MESSAGE_TYPE, PREVIEW_READY_MESSAGE, focusTargetOf } from "./section-focus";

const ADMIN = "https://admin.morbeh.test";
const parent = {};
const ok = {
  origin: ADMIN,
  source: parent,
  data: { type: "morbeh:focus-section", id: "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" },
};

beforeEach(() => {
  expect.hasAssertions();
});

describe("focusTargetOf", () => {
  it("uses the shared message constant, not a local literal (F12)", () => {
    expect(FOCUS_MESSAGE_TYPE).toBe(SECTION_FOCUS_MESSAGE);
    expect(PREVIEW_READY_MESSAGE).toBe("morbeh:preview-ready");
  });

  it("only the admin origin, from the parent, with a uuid (Review Focus 3)", () => {
    expect(focusTargetOf(ok, ADMIN, parent)).toBe(ok.data.id);
    expect(focusTargetOf({ ...ok, origin: "https://evil.example" }, ADMIN, parent)).toBeNull();
    expect(focusTargetOf({ ...ok, origin: "null" }, ADMIN, parent)).toBeNull();
    expect(focusTargetOf({ ...ok, source: {} }, ADMIN, parent)).toBeNull();
    expect(
      focusTargetOf(
        { ...ok, data: { type: "morbeh:focus-section", id: '"] , body [x="' } },
        ADMIN,
        parent,
      ),
    ).toBeNull();
    expect(
      focusTargetOf({ ...ok, data: { type: "other", id: ok.data.id } }, ADMIN, parent),
    ).toBeNull();
    expect(focusTargetOf({ ...ok, data: "morbeh:focus-section" }, ADMIN, parent)).toBeNull();
    expect(focusTargetOf({ ...ok, data: null }, ADMIN, parent)).toBeNull();
  });
});
