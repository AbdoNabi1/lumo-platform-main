import {
  canonicalDocumentJson,
  DEFAULT_THEME_DOCUMENT,
  type ThemeDocument,
} from "@platform/storefront-content";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { draftChanged, nothingToPublish } from "./errors";

export const RELEASES_KEPT = 20;

export interface ThemeRelease {
  readonly id: string;
  readonly releaseNumber: number;
  readonly document: ThemeDocument;
  readonly publishedAt: Date;
  readonly publishedBy: string;
}

export interface ThemeSnapshot {
  readonly draft: ThemeDocument;
  readonly draftRevision: number;
  readonly draftSavedAt: Date | null;
  readonly published: ThemeDocument | null;
  readonly publishedDraftRevision: number | null;
  readonly releaseNumber: number;
  readonly publishedAt: Date | null;
  readonly publishedBy: string | null;
  readonly version: number;
  readonly persisted: boolean;
}

/** One live theme with one draft (spec 1.2/1.8). Publish is bound to the previewed revision. */
export class StorefrontTheme {
  private state: ThemeSnapshot;

  private constructor(state: ThemeSnapshot) {
    this.state = state;
  }

  static initial(): StorefrontTheme {
    return new StorefrontTheme({
      draft: DEFAULT_THEME_DOCUMENT,
      draftRevision: 0,
      draftSavedAt: null,
      published: null,
      publishedDraftRevision: null,
      releaseNumber: 0,
      publishedAt: null,
      publishedBy: null,
      version: 0,
      persisted: false,
    });
  }

  static reconstitute(snapshot: ThemeSnapshot): StorefrontTheme {
    return new StorefrontTheme(snapshot);
  }

  /** Ruling 7: a content comparison, independent of JSONB key order. */
  hasUnpublishedChanges(): boolean {
    return (
      canonicalDocumentJson(this.state.draft) !==
      canonicalDocumentJson(this.state.published ?? DEFAULT_THEME_DOCUMENT)
    );
  }

  saveDraft(document: ThemeDocument, now: Date): void {
    this.state = {
      ...this.state,
      draft: document,
      draftRevision: this.state.draftRevision + 1,
      draftSavedAt: now,
    };
  }

  publish(input: {
    readonly expectedDraftRevision: number;
    readonly by: string;
    readonly releaseId: string;
    readonly now: Date;
  }): Result<ThemeRelease, DomainError> {
    if (input.expectedDraftRevision !== this.state.draftRevision) return err(draftChanged());
    if (!this.hasUnpublishedChanges()) return err(nothingToPublish());
    const releaseNumber = this.state.releaseNumber + 1;
    this.state = {
      ...this.state,
      published: this.state.draft,
      publishedDraftRevision: this.state.draftRevision,
      releaseNumber,
      publishedAt: input.now,
      publishedBy: input.by,
    };
    return ok({
      id: input.releaseId,
      releaseNumber,
      document: this.state.draft,
      publishedAt: input.now,
      publishedBy: input.by,
    });
  }

  discardDraft(now: Date): void {
    this.saveDraft(this.state.published ?? DEFAULT_THEME_DOCUMENT, now);
  }

  restoreRelease(release: ThemeRelease, now: Date): void {
    this.saveDraft(release.document, now);
  }

  snapshot(): ThemeSnapshot {
    return this.state;
  }

  get nextVersion(): number {
    return this.state.persisted ? this.state.version + 1 : 1;
  }
}
