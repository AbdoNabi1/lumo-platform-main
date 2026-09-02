import type { Principal } from "@platform/contracts";
import type { FinanceController } from "@platform/finance";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface FinanceAdminControllerDeps {
  readonly finance: FinanceController;
  readonly guard: AdminGuard;
}

type Omit1<T> = Omit<T, "principal">;

/**
 * Wires the **Finance** admin screen to the Finance context (Sprint 3.1, ADR-0024). Pure
 * delegation — RBAC + immutable audit at this boundary (AdminGuard, ADR-0007/0009), subject
 * derived from the authenticated principal (never the request body). Finance's own commands also
 * enforce their own `SecurityPort` gate (permission → step-up → signed WORM audit) — this facade
 * is a second, platform-standard layer in front of that, not a replacement for it.
 */
export class FinanceAdminController {
  private readonly finance: FinanceController;
  private readonly guard: AdminGuard;

  constructor(deps: FinanceAdminControllerDeps) {
    this.finance = deps.finance;
    this.guard = deps.guard;
  }

  async createAccount(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["createAccount"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:manage");
    if (denied) return denied;
    return this.finance.createAccount({ ...input, principal });
  }

  async createCostCenter(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["createCostCenter"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:manage");
    if (denied) return denied;
    return this.finance.createCostCenter({ ...input, principal });
  }

  async createExpenseCategory(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["createExpenseCategory"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:manage");
    if (denied) return denied;
    return this.finance.createExpenseCategory({ ...input, principal });
  }

  async defineTaxProfile(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["defineTaxProfile"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:manage");
    if (denied) return denied;
    return this.finance.defineTaxProfile({ ...input, principal });
  }

  async setProductCost(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["setProductCost"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:manage");
    if (denied) return denied;
    return this.finance.setProductCost({ ...input, principal });
  }

  async openFiscalPeriod(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["openFiscalPeriod"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:manage");
    if (denied) return denied;
    return this.finance.openFiscalPeriod({ ...input, principal });
  }

  async closeFiscalPeriod(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["closeFiscalPeriod"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:manage");
    if (denied) return denied;
    return this.finance.closeFiscalPeriod({ ...input, principal });
  }

  async setExchangeRate(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["setExchangeRate"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:manage");
    if (denied) return denied;
    return this.finance.setExchangeRate({ ...input, principal });
  }

  async recordExpense(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["recordExpense"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:manage");
    if (denied) return denied;
    return this.finance.recordExpense({ ...input, principal });
  }

  async createBudget(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["createBudget"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:manage");
    if (denied) return denied;
    return this.finance.createBudget({ ...input, principal });
  }

  async reviseBudget(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["reviseBudget"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:manage");
    if (denied) return denied;
    return this.finance.reviseBudget({ ...input, principal });
  }

  async recordManualAdjustment(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["recordManualAdjustment"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:manage");
    if (denied) return denied;
    return this.finance.recordManualAdjustment({ ...input, principal });
  }

  async generateForecast(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["generateForecast"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:read");
    if (denied) return denied;
    return this.finance.generateForecast({ ...input, principal });
  }

  async trialBalance(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["trialBalance"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:read");
    if (denied) return denied;
    return this.finance.trialBalance({ ...input, principal });
  }

  async incomeStatement(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["incomeStatement"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:read");
    if (denied) return denied;
    return this.finance.incomeStatement({ ...input, principal });
  }

  async balanceSheet(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["balanceSheet"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:read");
    if (denied) return denied;
    return this.finance.balanceSheet({ ...input, principal });
  }

  async getReadModel(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["getReadModel"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:read");
    if (denied) return denied;
    return this.finance.getReadModel({ ...input, principal });
  }

  async listReadModel(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["listReadModel"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:read");
    if (denied) return denied;
    return this.finance.listReadModel({ ...input, principal });
  }

  async queryReadModel(
    principal: Principal,
    input: Omit1<Parameters<FinanceController["queryReadModel"]>[0]>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "finance:read");
    if (denied) return denied;
    return this.finance.queryReadModel({ ...input, principal });
  }
}
