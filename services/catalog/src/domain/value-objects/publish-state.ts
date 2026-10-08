import { ValueObject } from "@platform/domain";

export type PublishStateValue = "draft" | "scheduled" | "published" | "unlisted" | "archived";

interface PublishStateProps {
  readonly value: PublishStateValue;
}

/** A product's lifecycle state (Commerce Sprint 1: `scheduled` added to the Sprint 1.1 base three). */
export class PublishState extends ValueObject<PublishStateProps> {
  static draft(): PublishState {
    return new PublishState({ value: "draft" });
  }

  static scheduled(): PublishState {
    return new PublishState({ value: "scheduled" });
  }

  static published(): PublishState {
    return new PublishState({ value: "published" });
  }

  static unlisted(): PublishState {
    return new PublishState({ value: "unlisted" });
  }

  static archived(): PublishState {
    return new PublishState({ value: "archived" });
  }

  /** Rehydrates a persisted state value (infrastructure trusts stored data; G-12). */
  static from(value: PublishStateValue): PublishState {
    return new PublishState({ value });
  }

  get value(): PublishStateValue {
    return this.props.value;
  }

  get isDraft(): boolean {
    return this.props.value === "draft";
  }

  get isScheduled(): boolean {
    return this.props.value === "scheduled";
  }

  get isPublished(): boolean {
    return this.props.value === "published";
  }

  get isUnlisted(): boolean {
    return this.props.value === "unlisted";
  }

  get isArchived(): boolean {
    return this.props.value === "archived";
  }

  /** Plan 2C-1: may be added to a cart (published, or unlisted = direct link only). */
  get isSellable(): boolean {
    return this.props.value === "published" || this.props.value === "unlisted";
  }

  /** Plan 2C-1: appears in lists, search, collections and the sitemap — published only. */
  get isListed(): boolean {
    return this.props.value === "published";
  }
}
