import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { LocalizationTransitioned } from "./events/localization-transitioned.event";
import type { LocaleCode } from "./value-objects/locale-code";

export type LocaleStatusValue = "active" | "inactive";

interface LocaleProps {
  readonly code: LocaleCode;
  readonly name: string;
  readonly isDefault: boolean;
  readonly fallbackLocaleRef?: string;
  status: LocaleStatusValue;
}

/** A registered storefront locale (Sprint 5.4) — other contexts reference it by ref only. */
export class Locale extends AggregateRoot<LocaleProps> {
  static create(
    id: UniqueEntityId,
    code: LocaleCode,
    name: string,
    isDefault: boolean,
    fallbackLocaleRef?: string,
  ): Locale {
    return new Locale({ code, name, isDefault, fallbackLocaleRef, status: "active" }, id);
  }

  static reconstitute(
    id: UniqueEntityId,
    code: LocaleCode,
    name: string,
    isDefault: boolean,
    status: LocaleStatusValue,
    version: number,
    fallbackLocaleRef?: string,
  ): Locale {
    return new Locale({ code, name, isDefault, fallbackLocaleRef, status }, id, version);
  }

  deactivate(eventId: string, occurredAt: Date): void {
    if (this.props.isDefault) {
      throw new BusinessRuleError("Cannot deactivate the default locale");
    }
    this.props.status = "inactive";
    this.raise("deactivated", eventId, occurredAt);
  }

  activate(eventId: string, occurredAt: Date): void {
    this.props.status = "active";
    this.raise("activated", eventId, occurredAt);
  }

  private raise(action: string, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new LocalizationTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          ref: this.props.code.value,
          family: "locale",
          action,
        },
      ),
    );
  }

  get code(): LocaleCode {
    return this.props.code;
  }

  get name(): string {
    return this.props.name;
  }

  get isDefault(): boolean {
    return this.props.isDefault;
  }

  get fallbackLocaleRef(): string | undefined {
    return this.props.fallbackLocaleRef;
  }

  get status(): LocaleStatusValue {
    return this.props.status;
  }
}
