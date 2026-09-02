import type {
  CreateAccount,
  CreateAccountInput,
  CreateCostCenter,
  CreateCostCenterInput,
  CreateExpenseCategory,
  CreateExpenseCategoryInput,
  DefineTaxProfile,
  DefineTaxProfileInput,
  SetProductCost,
  SetProductCostInput,
} from "../application/reference-data.commands";
import type {
  CloseFiscalPeriod,
  CloseFiscalPeriodInput,
  OpenFiscalPeriod,
  OpenFiscalPeriodInput,
  SetExchangeRate,
  SetExchangeRateInput,
} from "../application/fiscal.commands";
import type {
  CreateBudget,
  CreateBudgetInput,
  GenerateForecast,
  GenerateForecastInput,
  RecordExpense,
  RecordExpenseInput,
  RecordManualAdjustment,
  RecordManualAdjustmentInput,
  ReviseBudget,
  ReviseBudgetInput,
} from "../application/ledger.commands";
import type {
  BalanceSheetQuery,
  IncomeStatementQuery,
  PeriodQueryInput,
  TrialBalanceQuery,
} from "../application/queries";
import type {
  GetReadModel,
  GetReadModelInput,
  ListReadModel,
  ListReadModelInput,
  QueryReadModel,
  QueryReadModelInput,
} from "../application/read-model.queries";
import { type ControllerResponse, present } from "./presenter";

export interface FinanceControllerDeps {
  readonly createAccount: CreateAccount;
  readonly createCostCenter: CreateCostCenter;
  readonly createExpenseCategory: CreateExpenseCategory;
  readonly defineTaxProfile: DefineTaxProfile;
  readonly setProductCost: SetProductCost;
  readonly openFiscalPeriod: OpenFiscalPeriod;
  readonly closeFiscalPeriod: CloseFiscalPeriod;
  readonly setExchangeRate: SetExchangeRate;
  readonly recordExpense: RecordExpense;
  readonly createBudget: CreateBudget;
  readonly reviseBudget: ReviseBudget;
  readonly recordManualAdjustment: RecordManualAdjustment;
  readonly generateForecast: GenerateForecast;
  readonly trialBalanceQuery: TrialBalanceQuery;
  readonly incomeStatementQuery: IncomeStatementQuery;
  readonly balanceSheetQuery: BalanceSheetQuery;
  readonly getReadModel: GetReadModel;
  readonly listReadModel: ListReadModel;
  readonly queryReadModel: QueryReadModel;
}

/** Framework-agnostic interface boundary for Finance's 18 use-cases (no HTTP server). */
export class FinanceController {
  private readonly deps: FinanceControllerDeps;

  constructor(deps: FinanceControllerDeps) {
    this.deps = deps;
  }

  async createAccount(input: CreateAccountInput): Promise<ControllerResponse> {
    return present(await this.deps.createAccount.execute(input), 201);
  }

  async createCostCenter(input: CreateCostCenterInput): Promise<ControllerResponse> {
    return present(await this.deps.createCostCenter.execute(input), 201);
  }

  async createExpenseCategory(input: CreateExpenseCategoryInput): Promise<ControllerResponse> {
    return present(await this.deps.createExpenseCategory.execute(input), 201);
  }

  async defineTaxProfile(input: DefineTaxProfileInput): Promise<ControllerResponse> {
    return present(await this.deps.defineTaxProfile.execute(input), 201);
  }

  async setProductCost(input: SetProductCostInput): Promise<ControllerResponse> {
    return present(await this.deps.setProductCost.execute(input), 201);
  }

  async openFiscalPeriod(input: OpenFiscalPeriodInput): Promise<ControllerResponse> {
    return present(await this.deps.openFiscalPeriod.execute(input), 201);
  }

  async closeFiscalPeriod(input: CloseFiscalPeriodInput): Promise<ControllerResponse> {
    return present(await this.deps.closeFiscalPeriod.execute(input), 200);
  }

  async setExchangeRate(input: SetExchangeRateInput): Promise<ControllerResponse> {
    return present(await this.deps.setExchangeRate.execute(input), 201);
  }

  async recordExpense(input: RecordExpenseInput): Promise<ControllerResponse> {
    return present(await this.deps.recordExpense.execute(input), 201);
  }

  async createBudget(input: CreateBudgetInput): Promise<ControllerResponse> {
    return present(await this.deps.createBudget.execute(input), 201);
  }

  async reviseBudget(input: ReviseBudgetInput): Promise<ControllerResponse> {
    return present(await this.deps.reviseBudget.execute(input), 200);
  }

  async recordManualAdjustment(input: RecordManualAdjustmentInput): Promise<ControllerResponse> {
    return present(await this.deps.recordManualAdjustment.execute(input), 201);
  }

  async generateForecast(input: GenerateForecastInput): Promise<ControllerResponse> {
    return present(await this.deps.generateForecast.execute(input), 200);
  }

  async trialBalance(input: PeriodQueryInput): Promise<ControllerResponse> {
    return present(await this.deps.trialBalanceQuery.execute(input), 200);
  }

  async incomeStatement(input: PeriodQueryInput): Promise<ControllerResponse> {
    return present(await this.deps.incomeStatementQuery.execute(input), 200);
  }

  async balanceSheet(input: PeriodQueryInput): Promise<ControllerResponse> {
    return present(await this.deps.balanceSheetQuery.execute(input), 200);
  }

  async getReadModel(input: GetReadModelInput): Promise<ControllerResponse> {
    return present(await this.deps.getReadModel.execute(input), 200);
  }

  async listReadModel(input: ListReadModelInput): Promise<ControllerResponse> {
    return present(await this.deps.listReadModel.execute(input), 200);
  }

  /** `GET /finance/read-models/:model` (M9) — the real paginated surface. */
  async queryReadModel(input: QueryReadModelInput): Promise<ControllerResponse> {
    return present(await this.deps.queryReadModel.execute(input), 200);
  }
}
