import { getAdminApi } from "./client";

/**
 * The Finance screens (T3.2) — one fetch function per GET endpoint in
 * `apps/admin/src/http/admin-routes.ts`'s `/finance/*` block: trial balance, income statement,
 * balance sheet, and the two read-model routes (paginated list + single row by key). All five are
 * gated by `finance:read` (`apps/admin/src/interfaces/finance.admin-controller.ts`), which delegates
 * to `services/finance/src/application/queries.ts` (statements) and
 * `services/finance/src/application/read-model.queries.ts` (read models).
 *
 * **The `Balance`-over-the-wire quirk.** `IncomeStatementQuery`/`BalanceSheetQuery` return
 * `Balance` value objects (`services/finance/src/domain/value-objects/balance.ts`) directly — no
 * DTO mapping happens before `present()` hands the value to the HTTP layer
 * (`services/finance/src/interfaces/presenter.ts`, `packages/http/src/server.ts`'s
 * `reply.status(...).send(response.body)`). `Balance extends ValueObject<T>`
 * (`packages/domain/src/shared/value-object/value-object.ts`), which defines no `toJSON` and whose
 * only own field is `protected readonly props: T`. A plain `JSON.stringify` therefore serializes
 * every amount one level deeper than the class's own `amountMinor`/`currency` getters suggest:
 * `{ "revenue": { "props": { "amountMinor": 1234, "currency": "USD" } } }`, not
 * `{ "revenue": { "amountMinor": 1234, "currency": "USD" } }`. Verified directly against the real
 * `Balance` class (`JSON.stringify({ revenue: Balance.of(1234, "USD") })`), not guessed — see the
 * T3.2 report for the reproduction. `unwrapBalance` below is the one place that un-nests it; every
 * DTO this module exposes to callers is the flat `{ amountMinor, currency }` shape. Trial balance's
 * `TrialBalanceRow` is a plain object (`services/finance/src/domain/services/ledger-service.ts`),
 * never a `Balance`, so it needs no such unwrapping.
 */

// ── Shared ───────────────────────────────────────────────────────────────────────────────────────

interface WireBalance {
  readonly props: {
    readonly amountMinor: number;
    readonly currency: string;
  };
}

function isWireBalance(value: unknown): value is WireBalance {
  const props = (value as { props?: unknown } | null)?.props;
  return (
    typeof props === "object" &&
    props !== null &&
    typeof (props as { amountMinor?: unknown }).amountMinor === "number" &&
    typeof (props as { currency?: unknown }).currency === "string"
  );
}

export interface MoneyDto {
  readonly amountMinor: number;
  readonly currency: string;
}

function unwrapBalance(wire: WireBalance): MoneyDto {
  return { amountMinor: wire.props.amountMinor, currency: wire.props.currency };
}

function periodRangeParams(startDate: string, endDate: string, currency: string): string {
  return new URLSearchParams({ startDate, endDate, currency }).toString();
}

function toSimpleResult<T>(
  result:
    | { readonly outcome: "ok"; readonly data: T }
    | { readonly outcome: "unauthorized" }
    | { readonly outcome: "not_found" }
    | { readonly outcome: "error"; readonly message: string },
):
  | { readonly outcome: "ok"; readonly data: T }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string } {
  if (result.outcome === "ok") return { outcome: "ok", data: result.data };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  if (result.outcome === "not_found") return { outcome: "error", message: "Not found" };
  return { outcome: "error", message: result.message };
}

// ── Trial balance ────────────────────────────────────────────────────────────────────────────────

export interface TrialBalanceRowDto {
  readonly accountRef: string;
  readonly debitMinor: number;
  readonly creditMinor: number;
}

export interface TrialBalanceDto {
  readonly rows: readonly TrialBalanceRowDto[];
}

function isTrialBalanceDto(value: unknown): value is TrialBalanceDto {
  return (
    typeof value === "object" && value !== null && Array.isArray((value as { rows?: unknown }).rows)
  );
}

export type FetchTrialBalanceResult =
  | { readonly outcome: "ok"; readonly data: TrialBalanceDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /finance/trial-balance` — `finance:read`. Debit/credit totals per account over a period. */
export async function fetchTrialBalance(
  startDate: string,
  endDate: string,
  currency: string,
): Promise<FetchTrialBalanceResult> {
  const result = await getAdminApi(
    `/api/v1/finance/trial-balance?${periodRangeParams(startDate, endDate, currency)}`,
    isTrialBalanceDto,
  );
  return toSimpleResult(result);
}

// ── Income statement ─────────────────────────────────────────────────────────────────────────────

export interface IncomeStatementDto {
  readonly revenue: MoneyDto;
  readonly cogs: MoneyDto;
  readonly expenses: MoneyDto;
  readonly netIncome: MoneyDto;
}

interface IncomeStatementWireDto {
  readonly revenue: WireBalance;
  readonly cogs: WireBalance;
  readonly expenses: WireBalance;
  readonly netIncome: WireBalance;
}

function isIncomeStatementWireDto(value: unknown): value is IncomeStatementWireDto {
  return (
    typeof value === "object" &&
    value !== null &&
    isWireBalance((value as { revenue?: unknown }).revenue) &&
    isWireBalance((value as { cogs?: unknown }).cogs) &&
    isWireBalance((value as { expenses?: unknown }).expenses) &&
    isWireBalance((value as { netIncome?: unknown }).netIncome)
  );
}

export type FetchIncomeStatementResult =
  | { readonly outcome: "ok"; readonly data: IncomeStatementDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /finance/income-statement` — `finance:read`. Revenue/COGS/expenses/net income over a period. */
export async function fetchIncomeStatement(
  startDate: string,
  endDate: string,
  currency: string,
): Promise<FetchIncomeStatementResult> {
  const result = await getAdminApi(
    `/api/v1/finance/income-statement?${periodRangeParams(startDate, endDate, currency)}`,
    isIncomeStatementWireDto,
  );
  if (result.outcome === "ok") {
    return {
      outcome: "ok",
      data: {
        revenue: unwrapBalance(result.data.revenue),
        cogs: unwrapBalance(result.data.cogs),
        expenses: unwrapBalance(result.data.expenses),
        netIncome: unwrapBalance(result.data.netIncome),
      },
    };
  }
  return toSimpleResult(result);
}

// ── Balance sheet ────────────────────────────────────────────────────────────────────────────────

export interface BalanceSheetDto {
  readonly assets: MoneyDto;
  readonly liabilities: MoneyDto;
  readonly equity: MoneyDto;
}

interface BalanceSheetWireDto {
  readonly assets: WireBalance;
  readonly liabilities: WireBalance;
  readonly equity: WireBalance;
}

function isBalanceSheetWireDto(value: unknown): value is BalanceSheetWireDto {
  return (
    typeof value === "object" &&
    value !== null &&
    isWireBalance((value as { assets?: unknown }).assets) &&
    isWireBalance((value as { liabilities?: unknown }).liabilities) &&
    isWireBalance((value as { equity?: unknown }).equity)
  );
}

export type FetchBalanceSheetResult =
  | { readonly outcome: "ok"; readonly data: BalanceSheetDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /finance/balance-sheet` — `finance:read`. Assets/liabilities/equity as of a period end. */
export async function fetchBalanceSheet(
  startDate: string,
  endDate: string,
  currency: string,
): Promise<FetchBalanceSheetResult> {
  const result = await getAdminApi(
    `/api/v1/finance/balance-sheet?${periodRangeParams(startDate, endDate, currency)}`,
    isBalanceSheetWireDto,
  );
  if (result.outcome === "ok") {
    return {
      outcome: "ok",
      data: {
        assets: unwrapBalance(result.data.assets),
        liabilities: unwrapBalance(result.data.liabilities),
        equity: unwrapBalance(result.data.equity),
      },
    };
  }
  return toSimpleResult(result);
}

// ── Read models ──────────────────────────────────────────────────────────────────────────────────

/**
 * The only three models `FinanceProjectionService.rebuild` ever populates
 * (`services/finance/src/application/finance-projection.service.ts`) — `readModels.put("profit"|
 * "margin"|"financial_health", period, …)`. `InMemoryReadModelStore.query` (the `ReadModelStore`
 * implementation) never 404s on an unknown model name — it silently returns an empty page — so the
 * explorer validates against this known list itself rather than trusting the backend to reject a
 * typo'd or unsupported model.
 */
export const FINANCE_READ_MODELS = ["profit", "margin", "financial_health"] as const;
export type FinanceReadModelName = (typeof FINANCE_READ_MODELS)[number];

export function isFinanceReadModelName(value: string): value is FinanceReadModelName {
  return (FINANCE_READ_MODELS as readonly string[]).includes(value);
}

export interface ReadModelPageDto {
  readonly items: readonly unknown[];
  readonly nextCursor: string | null;
  readonly total: number;
}

function isReadModelPageDto(value: unknown): value is ReadModelPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items) &&
    typeof (value as { total?: unknown }).total === "number"
  );
}

export interface FinanceReadModelQuery {
  readonly dimension?: string;
  readonly periodKey?: string;
  readonly sort?: string;
  readonly order?: "asc" | "desc";
  readonly limit?: number;
  readonly cursor?: string;
}

export type FetchFinanceReadModelPageResult =
  | { readonly outcome: "ok"; readonly data: ReadModelPageDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * `GET /finance/read-models/:model` — `finance:read`. The paginated read surface
 * (`QueryReadModel`, M9): filter → sort → cursor, `limit` clamped to `[1, 200]` server-side.
 */
export async function fetchFinanceReadModelPage(
  model: string,
  query: FinanceReadModelQuery = {},
): Promise<FetchFinanceReadModelPageResult> {
  const params = new URLSearchParams();
  if (query.dimension !== undefined) params.set("dimension", query.dimension);
  if (query.periodKey !== undefined) params.set("periodKey", query.periodKey);
  if (query.sort !== undefined) params.set("sort", query.sort);
  if (query.order !== undefined) params.set("order", query.order);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor !== undefined) params.set("cursor", query.cursor);

  const result = await getAdminApi(
    `/api/v1/finance/read-models/${encodeURIComponent(model)}?${params.toString()}`,
    isReadModelPageDto,
  );
  return toSimpleResult(result);
}

function isReadModelRowDto(value: unknown): value is { readonly value: unknown } {
  return typeof value === "object" && value !== null && "value" in value;
}

export type FetchFinanceReadModelRowResult =
  | { readonly outcome: "ok"; readonly value: unknown }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * `GET /finance/read-models/:model/:key` — `finance:read`. A single projected row; 404s
 * (`NotFoundError`, `GetReadModel`) when the key doesn't exist for that model.
 */
export async function fetchFinanceReadModelRow(
  model: string,
  key: string,
): Promise<FetchFinanceReadModelRowResult> {
  const result = await getAdminApi(
    `/api/v1/finance/read-models/${encodeURIComponent(model)}/${encodeURIComponent(key)}`,
    isReadModelRowDto,
  );
  if (result.outcome === "ok") return { outcome: "ok", value: result.data.value };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  if (result.outcome === "not_found") return { outcome: "not_found" };
  return { outcome: "error", message: result.message };
}
