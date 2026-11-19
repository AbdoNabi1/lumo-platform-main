import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_DOCUMENT, type ThemeDocument } from "@platform/storefront-content";
import { StorefrontTheme } from "./storefront-theme";

const t0 = new Date("2026-10-27T10:00:00.000Z");
const branded: ThemeDocument = {
  ...DEFAULT_THEME_DOCUMENT,
  brand: { ...DEFAULT_THEME_DOCUMENT.brand, corners: "pill" },
};

describe("StorefrontTheme", () => {
  it("starts on the default document, revision 0, never published, nothing to publish", () => {
    const theme = StorefrontTheme.initial();
    expect(theme.snapshot()).toMatchObject({
      draftRevision: 0,
      published: null,
      releaseNumber: 0,
      persisted: false,
    });
    expect(theme.hasUnpublishedChanges()).toBe(false);
  });

  it("each draft save bumps the revision", () => {
    const theme = StorefrontTheme.initial();
    theme.saveDraft(branded, t0);
    theme.saveDraft(branded, t0);
    expect(theme.snapshot().draftRevision).toBe(2);
    expect(theme.hasUnpublishedChanges()).toBe(true);
  });

  it("publishes exactly the previewed revision and returns the release", () => {
    const theme = StorefrontTheme.initial();
    theme.saveDraft(branded, t0);
    const release = theme.publish({
      expectedDraftRevision: 1,
      by: "staff-1",
      releaseId: "r1",
      now: t0,
    });
    expect(release.ok && release.value).toEqual({
      id: "r1",
      releaseNumber: 1,
      document: branded,
      publishedAt: t0,
      publishedBy: "staff-1",
    });
    expect(theme.snapshot()).toMatchObject({
      published: branded,
      publishedDraftRevision: 1,
      releaseNumber: 1,
      publishedBy: "staff-1",
    });
    expect(theme.hasUnpublishedChanges()).toBe(false);
  });

  it("refuses a stale revision with DRAFT_CHANGED and an unchanged draft with NOTHING_TO_PUBLISH", () => {
    const theme = StorefrontTheme.initial();
    theme.saveDraft(branded, t0);
    theme.saveDraft(branded, t0);
    const stale = theme.publish({ expectedDraftRevision: 1, by: "s", releaseId: "r", now: t0 });
    expect(!stale.ok && stale.error.message).toMatch(/^DRAFT_CHANGED:/);
    expect(theme.snapshot().releaseNumber).toBe(0);
    theme.publish({ expectedDraftRevision: 2, by: "s", releaseId: "r", now: t0 });
    const again = theme.publish({ expectedDraftRevision: 2, by: "s", releaseId: "r2", now: t0 });
    expect(!again.ok && again.error.message).toMatch(/^NOTHING_TO_PUBLISH:/);
  });

  it("discard returns the draft to the live document and still bumps the revision", () => {
    const theme = StorefrontTheme.initial();
    theme.saveDraft(branded, t0);
    theme.publish({ expectedDraftRevision: 1, by: "s", releaseId: "r", now: t0 });
    theme.saveDraft(DEFAULT_THEME_DOCUMENT, t0);
    theme.discardDraft(t0);
    expect(theme.snapshot().draft).toEqual(branded);
    expect(theme.snapshot().draftRevision).toBe(3);
    expect(theme.hasUnpublishedChanges()).toBe(false);
  });

  it("restoring a release copies it into the draft, never to live", () => {
    const theme = StorefrontTheme.initial();
    theme.saveDraft(branded, t0);
    theme.publish({ expectedDraftRevision: 1, by: "s", releaseId: "r", now: t0 });
    theme.restoreRelease(
      {
        id: "old",
        releaseNumber: 1,
        document: DEFAULT_THEME_DOCUMENT,
        publishedAt: t0,
        publishedBy: "s",
      },
      t0,
    );
    expect(theme.snapshot().draft).toEqual(DEFAULT_THEME_DOCUMENT);
    expect(theme.snapshot().published).toEqual(branded);
    expect(theme.hasUnpublishedChanges()).toBe(true);
  });
});
