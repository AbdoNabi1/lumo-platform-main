// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { saveErrorState } from "./save-errors";

const p = en.onlineStorePreferences;
const e = en.onlineStoreErrors;
const conflict = (message: string) => saveErrorState({ outcome: "conflict", message }, en);

describe("saveErrorState (every server code becomes our own copy)", () => {
  it("keeps the 409s apart: version conflict, stale preview, nothing to publish, in-flight key", () => {
    expect(conflict("VERSION_CONFLICT: This was changed in another window.")).toEqual({
      status: "error",
      message: p.conflict,
      fieldErrors: {},
    });
    expect(conflict("DRAFT_CHANGED: The draft changed after it was previewed.")).toEqual({
      status: "error",
      message: e.draftChanged,
      fieldErrors: {},
    });
    expect(conflict("NOTHING_TO_PUBLISH: The draft has no unpublished changes.")).toEqual({
      status: "error",
      message: e.nothingToPublish,
      fieldErrors: {},
    });
    // The duplicate Idempotency-Key answer is the only 409 without a code prefix.
    expect(conflict("A request with this Idempotency-Key is already in flight")).toEqual({
      status: "error",
      message: p.inFlight,
      fieldErrors: {},
    });
    // A future coded 409 is never mistaken for a double submit, and its text never shows.
    expect(conflict("SOMETHING_NEW: English text from the server")).toEqual({
      status: "error",
      message: en.formErrors.conflict,
      fieldErrors: {},
    });
  });

  it("maps theme document codes, top-level and per field, never echoing the server's text", () => {
    expect(
      saveErrorState(
        {
          outcome: "invalid",
          message: "DOCUMENT_TOO_LARGE: Check the highlighted fields.",
          fields: [{ field: "", message: "DOCUMENT_TOO_LARGE" }],
        },
        en,
      ),
    ).toEqual({ status: "error", message: e.documentTooLarge, fieldErrors: {} });
    expect(
      saveErrorState(
        {
          outcome: "invalid",
          message: "INVALID_CONTENT: Check the highlighted fields.",
          fields: [
            { field: "footer.social.instagram", message: "INVALID_URL" },
            { field: "brand.colors.primary", message: "INVALID_COLOR" },
            { field: "brand.logo.widthPx", message: "OUT_OF_RANGE" },
            { field: "brand.logo.imageRef", message: "IMAGE_NOT_FOUND" },
            { field: "brand.unknown", message: "SOMETHING_ELSE" },
          ],
        },
        en,
      ),
    ).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: {
        "footer.social.instagram": e.invalidUrl,
        "brand.colors.primary": e.invalidColor,
        "brand.logo.widthPx": e.outOfRange,
        "brand.logo.imageRef": p.imageNotFound,
        "brand.unknown": en.formErrors.invalid,
      },
    });
  });

  it("answers in the admin's language", () => {
    expect(saveErrorState({ outcome: "conflict", message: "DRAFT_CHANGED: x" }, ar)).toMatchObject({
      message: ar.onlineStoreErrors.draftChanged,
    });
  });
});
