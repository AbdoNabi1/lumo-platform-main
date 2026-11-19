import {
  LOCALES,
  type Locale,
  type LocalizedText,
  type PolicyType,
} from "@platform/storefront-content";

export interface PolicySnapshot {
  readonly type: PolicyType;
  readonly body: LocalizedText;
  readonly updatedAt: Date | null;
  readonly updatedBy: string | null;
  readonly version: number;
  /** False until the first save inserts the row (an absent policy is "not set"). */
  readonly persisted: boolean;
}

/** One of the five store policies (spec 2.3). The body is validated rich text, set by the use case. */
export class StorePolicy {
  private state: PolicySnapshot;

  private constructor(state: PolicySnapshot) {
    this.state = state;
  }

  static empty(type: PolicyType): StorePolicy {
    return new StorePolicy({
      type,
      body: {},
      updatedAt: null,
      updatedBy: null,
      version: 0,
      persisted: false,
    });
  }

  static reconstitute(snapshot: PolicySnapshot): StorePolicy {
    return new StorePolicy(snapshot);
  }

  update(body: LocalizedText, by: string, now: Date): void {
    this.state = { ...this.state, body, updatedBy: by, updatedAt: now };
  }

  snapshot(): PolicySnapshot {
    return this.state;
  }

  /** The version the row will carry after a successful save. */
  get nextVersion(): number {
    return this.state.persisted ? this.state.version + 1 : 1;
  }

  /** The locales that have text. */
  get locales(): readonly Locale[] {
    return LOCALES.filter((locale) => {
      const text = this.state.body[locale];
      return typeof text === "string" && text.trim() !== "";
    });
  }

  /** A policy is set when at least one locale has text. */
  get isSet(): boolean {
    return this.locales.length > 0;
  }
}
