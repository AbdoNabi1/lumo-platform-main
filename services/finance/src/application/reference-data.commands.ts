import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { Money, UniqueEntityId, isDomainError } from "@platform/domain";
import { AccountType, type AccountTypeValue } from "../domain/value-objects/account-type";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { Account } from "../domain/account";
import { CogsSnapshot } from "../domain/cogs-snapshot";
import { CostCenter } from "../domain/cost-center";
import { ExpenseCategory } from "../domain/expense-category";
import { TaxProfile } from "../domain/tax-profile";
import { TaxRate } from "../domain/value-objects/tax-rate";
import { CostComponent, type CostComponentType } from "../domain/value-objects/cost-component";
import type {
  AccountRepository,
  CogsSnapshotRepository,
  CostCenterRepository,
  ExpenseCategoryRepository,
  TaxProfileRepository,
} from "../domain/repositories";
import { authorize } from "./authorize";
import type { SecurityPort } from "./ports";

export interface ReferenceDataDeps {
  readonly accounts: AccountRepository;
  readonly costCenters: CostCenterRepository;
  readonly expenseCategories: ExpenseCategoryRepository;
  readonly taxProfiles: TaxProfileRepository;
  readonly cogsSnapshots: CogsSnapshotRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly security: SecurityPort;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface CreateAccountInput {
  readonly principal: Principal;
  readonly code: string;
  readonly name: string;
  readonly type: AccountTypeValue;
}

/** `CreateAccount` — adds a chart-of-accounts entry. */
export class CreateAccount implements UseCase<CreateAccountInput, { accountId: string }> {
  private readonly deps: ReferenceDataDeps;
  constructor(deps: ReferenceDataDeps) {
    this.deps = deps;
  }

  async execute(input: CreateAccountInput): Promise<Result<{ accountId: string }, DomainError>> {
    const now = this.deps.clock.now();
    const authz = await authorize(this.deps.security, input.principal, "finance:manage", now, {
      action: "CreateAccount",
    });
    if (!authz.ok) return err(authz.error);

    const id = UniqueEntityId.from(this.deps.idGenerator.generate());
    const created = Account.create(id, input.code, input.name, AccountType.from(input.type));
    if (!created.ok) return err(created.error);

    return this.deps.unitOfWork.run(async (tx) => {
      await this.deps.accounts.save(created.value, tx);
      return ok({ accountId: created.value.id.toString() });
    });
  }
}

export interface CreateCostCenterInput {
  readonly principal: Principal;
  readonly code: string;
  readonly name: string;
}

/** `CreateCostCenter` — adds a cost center expenses/budgets attribute to. */
export class CreateCostCenter implements UseCase<CreateCostCenterInput, { costCenterId: string }> {
  private readonly deps: ReferenceDataDeps;
  constructor(deps: ReferenceDataDeps) {
    this.deps = deps;
  }

  async execute(
    input: CreateCostCenterInput,
  ): Promise<Result<{ costCenterId: string }, DomainError>> {
    const now = this.deps.clock.now();
    const authz = await authorize(this.deps.security, input.principal, "finance:manage", now, {
      action: "CreateCostCenter",
    });
    if (!authz.ok) return err(authz.error);

    const id = UniqueEntityId.from(this.deps.idGenerator.generate());
    const created = CostCenter.create(id, input.code, input.name);
    if (!created.ok) return err(created.error);

    return this.deps.unitOfWork.run(async (tx) => {
      await this.deps.costCenters.save(created.value, tx);
      return ok({ costCenterId: created.value.id.toString() });
    });
  }
}

export interface CreateExpenseCategoryInput {
  readonly principal: Principal;
  readonly name: string;
  readonly costCenterRef?: string;
}

/** `CreateExpenseCategory` — adds a merchant-defined expense category. */
export class CreateExpenseCategory implements UseCase<
  CreateExpenseCategoryInput,
  { categoryId: string }
> {
  private readonly deps: ReferenceDataDeps;
  constructor(deps: ReferenceDataDeps) {
    this.deps = deps;
  }

  async execute(
    input: CreateExpenseCategoryInput,
  ): Promise<Result<{ categoryId: string }, DomainError>> {
    const now = this.deps.clock.now();
    const authz = await authorize(this.deps.security, input.principal, "finance:manage", now, {
      action: "CreateExpenseCategory",
    });
    if (!authz.ok) return err(authz.error);

    const id = UniqueEntityId.from(this.deps.idGenerator.generate());
    const created = ExpenseCategory.create(id, input.name, input.costCenterRef ?? null);
    if (!created.ok) return err(created.error);

    return this.deps.unitOfWork.run(async (tx) => {
      await this.deps.expenseCategories.save(created.value, tx);
      return ok({ categoryId: created.value.id.toString() });
    });
  }
}

export interface DefineTaxProfileInput {
  readonly principal: Principal;
  readonly jurisdiction: string;
  readonly basisPointsPerRate: readonly number[];
}

/** `DefineTaxProfile` — defines the tax rates for a jurisdiction. */
export class DefineTaxProfile implements UseCase<DefineTaxProfileInput, { taxProfileId: string }> {
  private readonly deps: ReferenceDataDeps;
  constructor(deps: ReferenceDataDeps) {
    this.deps = deps;
  }

  async execute(
    input: DefineTaxProfileInput,
  ): Promise<Result<{ taxProfileId: string }, DomainError>> {
    const now = this.deps.clock.now();
    const authz = await authorize(this.deps.security, input.principal, "finance:manage", now, {
      action: "DefineTaxProfile",
    });
    if (!authz.ok) return err(authz.error);

    const rates = [];
    for (const bp of input.basisPointsPerRate) {
      const rate = TaxRate.create(bp);
      if (!rate.ok) return err(rate.error);
      rates.push(rate.value);
    }

    const id = UniqueEntityId.from(this.deps.idGenerator.generate());
    const created = TaxProfile.define(id, input.jurisdiction, rates);
    if (!created.ok) return err(created.error);

    return this.deps.unitOfWork.run(async (tx) => {
      await this.deps.taxProfiles.save(created.value, tx);
      return ok({ taxProfileId: created.value.id.toString() });
    });
  }
}

export interface SetProductCostInput {
  readonly principal: Principal;
  readonly productRef: string;
  readonly currency: string;
  readonly components: readonly {
    readonly type: CostComponentType;
    readonly amountMinor: number;
  }[];
  readonly effectiveAt: Date;
}

/** `SetProductCost` — records a new effective-dated {@link CogsSnapshot} (never updates a prior one). */
export class SetProductCost implements UseCase<SetProductCostInput, { snapshotId: string }> {
  private readonly deps: ReferenceDataDeps;
  constructor(deps: ReferenceDataDeps) {
    this.deps = deps;
  }

  async execute(input: SetProductCostInput): Promise<Result<{ snapshotId: string }, DomainError>> {
    const now = this.deps.clock.now();
    const authz = await authorize(this.deps.security, input.principal, "finance:manage", now, {
      action: "SetProductCost",
    });
    if (!authz.ok) return err(authz.error);

    const components = [];
    for (const component of input.components) {
      const amount = Money.create(component.amountMinor, input.currency);
      if (!amount.ok) return err(amount.error);
      components.push(CostComponent.create(component.type, amount.value));
    }

    const id = UniqueEntityId.from(this.deps.idGenerator.generate());
    let snapshot: CogsSnapshot;
    try {
      snapshot = CogsSnapshot.record(id, input.productRef, components, input.effectiveAt);
    } catch (error) {
      if (isDomainError(error)) return err(error);
      throw error;
    }

    return this.deps.unitOfWork.run(async (tx) => {
      await this.deps.cogsSnapshots.add(snapshot, tx);
      return ok({ snapshotId: snapshot.id.toString() });
    });
  }
}
