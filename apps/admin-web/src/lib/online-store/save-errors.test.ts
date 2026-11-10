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

  it("maps the menu codes (Part 2): 409s and per-item 422s, web addresses apart from social links", () => {
    const n = en.onlineStoreNavigation;
    expect(conflict("MENU_PROTECTED: no")).toMatchObject({ message: n.protected });
    expect(conflict("MENU_IN_USE: no")).toMatchObject({ message: n.inUse });
    expect(conflict("MENU_HANDLE_TAKEN: no")).toMatchObject({ message: n.taken });
    expect(conflict("MENU_LIMIT: no")).toMatchObject({ message: n.limit });
    expect(
      saveErrorState(
        {
          outcome: "invalid",
          message: "INVALID_CONTENT: Check the highlighted fields.",
          fields: [
            { field: "items", message: "MENU_TOO_LARGE" },
            { field: "items.0.label", message: "LABEL_REQUIRED" },
            { field: "items.0.children", message: "MENU_TOO_DEEP" },
            { field: "items.1.children", message: "TOO_MANY_ITEMS" },
            { field: "items.2.id", message: "DUPLICATE_ITEM_ID" },
            { field: "items.3.link.type", message: "INVALID_LINK" },
            { field: "items.4.link.url", message: "INVALID_URL" },
            { field: "footer.social.instagram", message: "INVALID_URL" },
          ],
        },
        en,
      ),
    ).toMatchObject({
      fieldErrors: {
        items: n.tooLarge,
        "items.0.label": n.labelRequired,
        "items.0.children": n.tooDeep,
        "items.1.children": n.tooMany,
        "items.2.id": n.duplicateItem,
        "items.3.link.type": n.invalidLink,
        "items.4.link.url": n.urlError,
        "footer.social.instagram": e.invalidUrl,
      },
    });
    expect(
      saveErrorState(
        {
          outcome: "invalid",
          message: "INVALID_HANDLE: Use lowercase letters.",
          fields: [{ field: "handle", message: "INVALID_HANDLE" }],
        },
        en,
      ),
    ).toEqual({ status: "error", message: n.handleError, fieldErrors: { handle: n.handleError } });
    expect(
      saveErrorState(
        {
          outcome: "invalid",
          message: "TITLE_REQUIRED: Give the menu a title.",
          fields: [{ field: "title", message: "TITLE_REQUIRED" }],
        },
        ar,
      ),
    ).toMatchObject({ message: ar.onlineStoreNavigation.titleRequired });
  });

  it("answers in the admin's language", () => {
    expect(saveErrorState({ outcome: "conflict", message: "DRAFT_CHANGED: x" }, ar)).toMatchObject({
      message: ar.onlineStoreErrors.draftChanged,
    });
  });

  it("a taken page address lands on the address field, never as 'already in progress' (F14)", () => {
    const taken = 'ROUTE_PATH_TAKEN: Page for route "/pages/about" already exists';
    expect(conflict(taken)).toEqual({
      status: "error",
      message: en.pageEditor.addressTaken,
      fieldErrors: { routePath: en.pageEditor.addressTaken },
    });
    const arabic = saveErrorState({ outcome: "conflict", message: taken }, ar);
    expect(arabic).toMatchObject({ fieldErrors: { routePath: ar.pageEditor.addressTaken } });
    expect(arabic).not.toMatchObject({ message: ar.onlineStorePreferences.inFlight });
  });

  it("maps the page and policy content codes (Part 2): archived, lost race, unsafe link, too long", () => {
    expect(conflict("PAGE_ARCHIVED: An archived page cannot be edited.")).toMatchObject({
      message: en.pageEditor.archived,
    });
    expect(conflict("VERSION_CONFLICT: This page was changed in another window.")).toMatchObject({
      message: p.conflict,
    });
    expect(
      saveErrorState(
        {
          outcome: "invalid",
          message: "INVALID_CONTENT: Check the highlighted fields.",
          fields: [
            { field: "body.en", message: "UNSAFE_LINK" },
            { field: "body.ar", message: "TOO_LONG" },
            { field: "title.en", message: "TOO_LONG" },
          ],
        },
        en,
      ),
    ).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: {
        "body.en": en.richText.unsafeLinkSaved,
        "body.ar": p.tooLong,
        "title.en": p.tooLong,
      },
    });
  });
});
