import { UniqueEntityId } from "@platform/domain";
import { Locale, type LocaleStatusValue } from "../domain/locale";
import { Translation } from "../domain/translation";
import { TranslationSet } from "../domain/translation-set";
import { LocaleCode } from "../domain/value-objects/locale-code";
import type { TranslationStatusValue } from "../domain/value-objects/translation-status";

export interface LocaleRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly fallbackLocaleRef: string | null;
  readonly status: string;
  readonly version: number;
}

export interface TranslationJson {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly status: TranslationStatusValue;
}

export interface TranslationSetRow {
  readonly id: string;
  readonly localeRef: string;
  readonly namespace: string;
  readonly translations: readonly TranslationJson[];
  readonly version: number;
}

export class LocaleMapper {
  static toDomain(row: LocaleRow): Locale {
    const code = LocaleCode.create(row.code);
    if (!code.ok) throw new Error(`Corrupt locale row: invalid code (${code.error.message})`);
    return Locale.reconstitute(
      UniqueEntityId.from(row.id),
      code.value,
      row.name,
      row.isDefault,
      row.status as LocaleStatusValue,
      row.version,
      row.fallbackLocaleRef ?? undefined,
    );
  }

  static toRow(locale: Locale, tenantId: string) {
    return {
      id: locale.id.toString(),
      tenantId,
      code: locale.code.value,
      name: locale.name,
      isDefault: locale.isDefault,
      fallbackLocaleRef: locale.fallbackLocaleRef ?? null,
      status: locale.status,
      version: 1,
    };
  }
}

export class TranslationSetMapper {
  static toDomain(row: TranslationSetRow): TranslationSet {
    return TranslationSet.reconstitute(
      UniqueEntityId.from(row.id),
      row.localeRef,
      row.namespace,
      row.version,
      row.translations.map((t) =>
        Translation.reconstitute(UniqueEntityId.from(t.id), t.key, t.value, t.status),
      ),
    );
  }

  static toRow(set: TranslationSet, tenantId: string) {
    return {
      id: set.id.toString(),
      tenantId,
      localeRef: set.localeRef,
      namespace: set.namespace,
      translations: set.translations.map((t) => ({
        id: t.id.toString(),
        key: t.key,
        value: t.value,
        status: t.status.value,
      })),
      version: 1,
    };
  }
}
