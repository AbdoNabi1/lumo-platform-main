import { ValueObject } from "@platform/domain";

export type TranslationStatusValue = "draft" | "published";

interface TranslationStatusProps {
  readonly value: TranslationStatusValue;
}

/** The lifecycle state of a single translation entry (draft/published — no archive; removal deletes the entry). */
export class TranslationStatus extends ValueObject<TranslationStatusProps> {
  static draft(): TranslationStatus {
    return new TranslationStatus({ value: "draft" });
  }

  static from(value: TranslationStatusValue): TranslationStatus {
    return new TranslationStatus({ value });
  }

  get value(): TranslationStatusValue {
    return this.props.value;
  }
}
