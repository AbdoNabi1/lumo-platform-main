import { beforeEach, describe, expect, it } from "vitest";

import { CLICK_ID_DEFINITIONS, extractClickIds } from "./click-ids";

describe("click ids: Snap's ScCid", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  const lookupOf =
    (url: string) =>
    (param: string): string | null =>
      new URL(url).searchParams.get(param);

  it("a landing URL with ScCid yields a snap click id under the canonical key", () => {
    const captured = extractClickIds(
      lookupOf("https://clinic.example/?ScCid=abc"),
      "2026-11-24T10:00:00.000Z",
    );
    expect(captured).toEqual([
      { name: "scclid", value: "abc", capturedAt: "2026-11-24T10:00:00.000Z" },
    ]);
    expect(CLICK_ID_DEFINITIONS.scclid.platform).toBe("snapchat");
    expect(CLICK_ID_DEFINITIONS.scclid.param).toBe("ScCid");
  });

  it("the old scclid parameter no longer matches", () => {
    expect(
      extractClickIds(lookupOf("https://clinic.example/?scclid=abc"), "2026-11-24T10:00:00.000Z"),
    ).toEqual([]);
  });
});
