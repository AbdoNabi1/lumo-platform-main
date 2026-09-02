import { ValueObject } from "@platform/domain";

export type PublishStateValue = "draft" | "scheduled" | "published" | "archived";

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

  get isArchived(): boolean {
    return this.props.value === "archived";
  }
}
