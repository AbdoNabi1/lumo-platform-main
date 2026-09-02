import { ValueObject } from "@platform/domain";

export type ContentStatusValue = "draft" | "scheduled" | "published" | "archived";

const TRANSITIONS: Readonly<Record<ContentStatusValue, readonly ContentStatusValue[]>> = {
  draft: ["scheduled", "published", "archived"],
  scheduled: ["published", "archived"],
  published: ["archived"],
  archived: [],
};

export function canTransitionContent(from: ContentStatusValue, to: ContentStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

interface ContentStatusProps {
  readonly value: ContentStatusValue;
}

/** The lifecycle state of a content block (draft→scheduled→published→archived). */
export class ContentStatus extends ValueObject<ContentStatusProps> {
  static draft(): ContentStatus {
    return new ContentStatus({ value: "draft" });
  }

  static from(value: ContentStatusValue): ContentStatus {
    return new ContentStatus({ value });
  }

  get value(): ContentStatusValue {
    return this.props.value;
  }
}
