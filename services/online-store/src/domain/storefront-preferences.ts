import type { Locale, LocalizedText } from "@platform/storefront-content";

export const HOME_TITLE_MAX = 70;
export const HOME_DESCRIPTION_MAX = 320;

export interface PreferencesSnapshot {
  readonly homeTitle: LocalizedText;
  readonly homeMetaDescription: LocalizedText;
  readonly shareImageRef: string | null;
  readonly defaultLocale: Locale;
  readonly version: number;
  readonly updatedAt: Date | null;
  /** False until the first save inserts the row (an absent row means the defaults). */
  readonly persisted: boolean;
}

export interface PreferencesInput {
  readonly homeTitle: LocalizedText;
  readonly homeMetaDescription: LocalizedText;
  readonly shareImageRef: string | null;
  readonly defaultLocale: Locale;
}

/** Shopify's Online Store → Preferences: live on save, no draft (spec 1.4). */
export class StorefrontPreferences {
  private state: PreferencesSnapshot;

  private constructor(state: PreferencesSnapshot) {
    this.state = state;
  }

  static defaults(): StorefrontPreferences {
    return new StorefrontPreferences({
      homeTitle: {},
      homeMetaDescription: {},
      shareImageRef: null,
      defaultLocale: "ar",
      version: 0,
      updatedAt: null,
      persisted: false,
    });
  }

  static reconstitute(snapshot: PreferencesSnapshot): StorefrontPreferences {
    return new StorefrontPreferences(snapshot);
  }

  /** Input is already normalised and ownership-checked by the use case. */
  update(input: PreferencesInput, now: Date): void {
    this.state = { ...this.state, ...input, updatedAt: now };
  }

  snapshot(): PreferencesSnapshot {
    return this.state;
  }

  /** The version the row will carry after a successful save. */
  get nextVersion(): number {
    return this.state.persisted ? this.state.version + 1 : 1;
  }
}
