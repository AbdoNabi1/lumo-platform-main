import { AggregateRoot, UniqueEntityId } from "@platform/domain";
import { LocalizationTransitioned } from "./events/localization-transitioned.event";
import { Translation } from "./translation";

interface TranslationSetProps {
  readonly localeRef: string;
  readonly namespace: string;
  translations: Translation[];
}

/** A namespaced set of translations for one locale (Sprint 5.4). Owns translations only; other contexts reference by ref. */
export class TranslationSet extends AggregateRoot<TranslationSetProps> {
  static create(id: UniqueEntityId, localeRef: string, namespace: string): TranslationSet {
    return new TranslationSet({ localeRef, namespace, translations: [] }, id);
  }

  static reconstitute(
    id: UniqueEntityId,
    localeRef: string,
    namespace: string,
    version: number,
    translations: readonly Translation[] = [],
  ): TranslationSet {
    return new TranslationSet(
      { localeRef, namespace, translations: [...translations] },
      id,
      version,
    );
  }

  /** Upserts a translation value — resets it to `draft` (idempotent by key). */
  setTranslation(key: string, value: string, eventId: string, occurredAt: Date): void {
    const existing = this.props.translations.find((t) => t.key === key);
    if (existing !== undefined) {
      existing.setValue(value);
    } else {
      this.props.translations.push(
        Translation.create(
          UniqueEntityId.from(this.id.toString() + this.props.translations.length),
          key,
          value,
        ),
      );
    }
    this.raise("set", eventId, occurredAt, key);
  }

  publishTranslation(key: string, eventId: string, occurredAt: Date): void {
    const translation = this.props.translations.find((t) => t.key === key);
    if (translation === undefined) return;
    translation.publish();
    this.raise("published", eventId, occurredAt, key);
  }

  removeTranslation(key: string, eventId: string, occurredAt: Date): void {
    this.props.translations = this.props.translations.filter((t) => t.key !== key);
    this.raise("removed", eventId, occurredAt, key);
  }

  /** Resolves a translation value, falling back to `fallbackValue` if the key is missing or unpublished. */
  resolve(key: string, fallbackValue?: string): string | undefined {
    const translation = this.props.translations.find(
      (t) => t.key === key && t.status.value === "published",
    );
    return translation?.value ?? fallbackValue;
  }

  private raise(action: string, eventId: string, occurredAt: Date, key: string): void {
    this.addDomainEvent(
      new LocalizationTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          ref: `${this.props.localeRef}:${this.props.namespace}`,
          family: "translation",
          action,
          key,
        },
      ),
    );
  }

  get localeRef(): string {
    return this.props.localeRef;
  }

  get namespace(): string {
    return this.props.namespace;
  }

  get translations(): readonly Translation[] {
    return this.props.translations;
  }
}
