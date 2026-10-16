import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { UniqueEntityId, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { NotFoundError, type DomainError } from "@platform/utils";
import { ExchangeRate } from "../domain/exchange-rate";
import { FiscalPeriod } from "../domain/fiscal-period";
import { FiscalClosingService } from "../domain/services/fiscal-closing-service";
import type { ExchangeRateRepository, FiscalPeriodRepository } from "../domain/repositories";
import type { SecurityPort } from "./ports";
import { authorize } from "./authorize";

export interface FiscalDeps {
  readonly fiscalPeriods: FiscalPeriodRepository;
  readonly exchangeRates: ExchangeRateRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly security: SecurityPort;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface OpenFiscalPeriodInput {
  readonly principal: Principal;
  readonly tenantId: string;
  readonly startDate: Date;
  readonly endDate: Date;
}

/** `OpenFiscalPeriod` — opens a new reporting period. */
export class OpenFiscalPeriod implements UseCase<OpenFiscalPeriodInput, { periodId: string }> {
  private readonly deps: FiscalDeps;
  constructor(deps: FiscalDeps) {
    this.deps = deps;
  }

  async execute(input: OpenFiscalPeriodInput): Promise<Result<{ periodId: string }, DomainError>> {
    const now = this.deps.clock.now();
    const authz = await authorize(this.deps.security, input.principal, "finance:manage", now, {
      action: "OpenFiscalPeriod",
    });
    if (!authz.ok) return err(authz.error);

    const id = UniqueEntityId.from(this.deps.idGenerator.generate());
    let period: FiscalPeriod;
    try {
      period = FiscalPeriod.open(id, input.startDate, input.endDate);
    } catch (error) {
      if (isDomainError(error)) return err(error);
      throw error;
    }

    return this.deps.unitOfWork.run(async (tx) => {
      await this.deps.fiscalPeriods.save(period, input.tenantId, tx);
      return ok({ periodId: period.id.toString() });
    });
  }
}

export interface CloseFiscalPeriodInput {
  readonly principal: Principal;
  readonly tenantId: string;
  readonly periodId: string;
}

/** `CloseFiscalPeriod` (step-up) — closes a period via `FiscalClosingService`. */
export class CloseFiscalPeriod implements UseCase<CloseFiscalPeriodInput, { periodId: string }> {
  private readonly deps: FiscalDeps;
  constructor(deps: FiscalDeps) {
    this.deps = deps;
  }

  async execute(input: CloseFiscalPeriodInput): Promise<Result<{ periodId: string }, DomainError>> {
    const now = this.deps.clock.now();
    const authz = await authorize(
      this.deps.security,
      input.principal,
      "finance:manage",
      now,
      { action: "CloseFiscalPeriod", periodId: input.periodId },
      { requireStepUp: true },
    );
    if (!authz.ok) return err(authz.error);

    return this.deps.unitOfWork.run(async (tx) => {
      const period = await this.deps.fiscalPeriods.findById(input.periodId, input.tenantId, tx);
      if (period === null) return err(new NotFoundError("Fiscal period not found"));

      try {
        FiscalClosingService.close(period, this.deps.idGenerator.generate(), now);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.fiscalPeriods.save(period, input.tenantId, tx);
      return ok({ periodId: period.id.toString() });
    });
  }
}

export interface SetExchangeRateInput {
  readonly principal: Principal;
  readonly tenantId: string;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly rate: number;
  readonly effectiveAt: Date;
}

/** `SetExchangeRate` (step-up) — records a new immutable historical rate. */
export class SetExchangeRate implements UseCase<SetExchangeRateInput, { rateId: string }> {
  private readonly deps: FiscalDeps;
  constructor(deps: FiscalDeps) {
    this.deps = deps;
  }

  async execute(input: SetExchangeRateInput): Promise<Result<{ rateId: string }, DomainError>> {
    const now = this.deps.clock.now();
    const authz = await authorize(
      this.deps.security,
      input.principal,
      "finance:manage",
      now,
      { action: "SetExchangeRate" },
      { requireStepUp: true },
    );
    if (!authz.ok) return err(authz.error);

    const id = UniqueEntityId.from(this.deps.idGenerator.generate());
    let rate: ExchangeRate;
    try {
      rate = ExchangeRate.record(
        id,
        input.baseCurrency,
        input.quoteCurrency,
        input.rate,
        input.effectiveAt,
      );
    } catch (error) {
      if (isDomainError(error)) return err(error);
      throw error;
    }

    return this.deps.unitOfWork.run(async (tx) => {
      await this.deps.exchangeRates.add(rate, input.tenantId, tx);
      return ok({ rateId: rate.id.toString() });
    });
  }
}
