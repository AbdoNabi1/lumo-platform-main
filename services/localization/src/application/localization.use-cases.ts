import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError } from "@platform/utils";
import { Locale } from "../domain/locale";
import type { LocaleRepository, TranslationSetRepository } from "../domain/repositories";
import { TranslationSet } from "../domain/translation-set";
import { LocaleCode } from "../domain/value-objects/locale-code";

export interface LocalizationDeps {
  readonly locales: LocaleRepository;
  readonly translationSets: TranslationSetRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface CreateLocaleInput {
  readonly code: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly fallbackLocaleRef?: string;
  readonly tenantId: string;
}

export interface LocaleOutput {
  readonly localeId: string;
  readonly status: string;
}

/** Registers a locale — one per code. */
export class CreateLocale implements UseCase<CreateLocaleInput, LocaleOutput, DomainError> {
  private readonly deps: LocalizationDeps;

  constructor(deps: LocalizationDeps) {
    this.deps = deps;
  }

  async execute(input: CreateLocaleInput): Promise<Result<LocaleOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);
    const code = LocaleCode.create(input.code);
    if (!code.ok) return err(code.error);

    return this.deps.unitOfWork.run<Result<LocaleOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.locales.findByCode(input.code, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError(`Locale "${input.code}" already exists`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const locale = Locale.create(
        id,
        code.value,
        input.name,
        input.isDefault,
        input.fallbackLocaleRef,
      );
      await this.deps.locales.save(locale, input.tenantId, tx);
      return ok({ localeId: id.toString(), status: locale.status });
    });
  }
}

export interface CreateTranslationSetInput {
  readonly localeRef: string;
  readonly namespace: string;
  readonly tenantId: string;
}

export interface TranslationSetOutput {
  readonly translationSetId: string;
  readonly translationCount: number;
}

/** Creates a translation set for one `(localeRef, namespace)` pair. */
export class CreateTranslationSet implements UseCase<
  CreateTranslationSetInput,
  TranslationSetOutput,
  DomainError
> {
  private readonly deps: LocalizationDeps;

  constructor(deps: LocalizationDeps) {
    this.deps = deps;
  }

  async execute(
    input: CreateTranslationSetInput,
  ): Promise<Result<TranslationSetOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<TranslationSetOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.translationSets.findByLocaleAndNamespace(
        input.localeRef,
        input.namespace,
        input.tenantId,
        tx,
      );
      if (existing !== null) {
        return err(new ConflictError(`Translation set already exists for this locale/namespace`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const set = TranslationSet.create(id, input.localeRef, input.namespace);
      await this.deps.translationSets.save(set, input.tenantId, tx);
      return ok({ translationSetId: id.toString(), translationCount: 0 });
    });
  }
}

export interface SetTranslationInput {
  readonly translationSetId: string;
  readonly key: string;
  readonly value: string;
  readonly tenantId: string;
}

/** Upserts (and resets to draft) a translation value. */
export class SetTranslation implements UseCase<
  SetTranslationInput,
  TranslationSetOutput,
  DomainError
> {
  private readonly deps: LocalizationDeps;

  constructor(deps: LocalizationDeps) {
    this.deps = deps;
  }

  async execute(input: SetTranslationInput): Promise<Result<TranslationSetOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<TranslationSetOutput, DomainError>>(async (tx) => {
      const set = await this.deps.translationSets.findById(
        input.translationSetId,
        input.tenantId,
        tx,
      );
      if (set === null) return err(new NotFoundError("Translation set not found"));

      set.setTranslation(
        input.key,
        input.value,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.translationSets.save(set, input.tenantId, tx);
      return ok({ translationSetId: set.id.toString(), translationCount: set.translations.length });
    });
  }
}

export interface TranslationKeyInput {
  readonly translationSetId: string;
  readonly key: string;
  readonly tenantId: string;
}

/** Publishes a draft translation. */
export class PublishTranslation implements UseCase<
  TranslationKeyInput,
  TranslationSetOutput,
  DomainError
> {
  private readonly deps: LocalizationDeps;

  constructor(deps: LocalizationDeps) {
    this.deps = deps;
  }

  async execute(input: TranslationKeyInput): Promise<Result<TranslationSetOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<TranslationSetOutput, DomainError>>(async (tx) => {
      const set = await this.deps.translationSets.findById(
        input.translationSetId,
        input.tenantId,
        tx,
      );
      if (set === null) return err(new NotFoundError("Translation set not found"));

      set.publishTranslation(input.key, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.translationSets.save(set, input.tenantId, tx);
      return ok({ translationSetId: set.id.toString(), translationCount: set.translations.length });
    });
  }
}
