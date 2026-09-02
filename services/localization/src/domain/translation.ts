import { Entity, type UniqueEntityId } from "@platform/domain";
import { TranslationStatus, type TranslationStatusValue } from "./value-objects/translation-status";

interface TranslationProps {
  readonly key: string;
  value: string;
  status: TranslationStatus;
}

/** One translated string within a {@link TranslationSet} — keyed, versionless (edits overwrite in place). */
export class Translation extends Entity<TranslationProps> {
  static create(id: UniqueEntityId, key: string, value: string): Translation {
    return new Translation({ key, value, status: TranslationStatus.draft() }, id);
  }

  static reconstitute(
    id: UniqueEntityId,
    key: string,
    value: string,
    status: TranslationStatusValue,
  ): Translation {
    return new Translation({ key, value, status: TranslationStatus.from(status) }, id);
  }

  setValue(value: string): void {
    this.props.value = value;
    this.props.status = TranslationStatus.draft();
  }

  publish(): void {
    this.props.status = TranslationStatus.from("published");
  }

  get key(): string {
    return this.props.key;
  }

  get value(): string {
    return this.props.value;
  }

  get status(): TranslationStatus {
    return this.props.status;
  }
}
