import type { UseCase } from "@platform/application";
import type { Clock, Principal } from "@platform/contracts";
import { err, ok, type Result } from "@platform/types";
import { NotFoundError, type DomainError } from "@platform/utils";
import type { ReadModelPage, ReadModelStore } from "../domain/read-model-store";
import type { SecurityPort } from "./ports";
import { authorize } from "./authorize";

export interface ReadModelQueryDeps {
  readonly readModels: ReadModelStore;
  readonly security: SecurityPort;
  readonly clock: Clock;
}

export interface GetReadModelInput {
  readonly principal: Principal;
  readonly model: string;
  readonly key: string;
}

/** `GetReadModel` (`finance:read`) — a single projected read-model row; fail-closed on a miss. */
export class GetReadModel implements UseCase<GetReadModelInput, { value: unknown }> {
  private readonly deps: ReadModelQueryDeps;
  constructor(deps: ReadModelQueryDeps) {
    this.deps = deps;
  }

  async execute(input: GetReadModelInput): Promise<Result<{ value: unknown }, DomainError>> {
    const authz = await authorize(
      this.deps.security,
      input.principal,
      "finance:read",
      this.deps.clock.now(),
      {
        action: "GetReadModel",
        model: input.model,
      },
    );
    if (!authz.ok) return err(authz.error);

    const value = await this.deps.readModels.get(input.model, input.key);
    if (value === null)
      return err(new NotFoundError(`No ${input.model} read model for "${input.key}"`));
    return ok({ value });
  }
}

export interface ListReadModelInput {
  readonly principal: Principal;
  readonly model: string;
}

/** `ListReadModel` (`finance:read`) — every row currently projected for a model. */
export class ListReadModel implements UseCase<ListReadModelInput, { items: readonly unknown[] }> {
  private readonly deps: ReadModelQueryDeps;
  constructor(deps: ReadModelQueryDeps) {
    this.deps = deps;
  }

  async execute(
    input: ListReadModelInput,
  ): Promise<Result<{ items: readonly unknown[] }, DomainError>> {
    const authz = await authorize(
      this.deps.security,
      input.principal,
      "finance:read",
      this.deps.clock.now(),
      {
        action: "ListReadModel",
        model: input.model,
      },
    );
    if (!authz.ok) return err(authz.error);

    return ok({ items: await this.deps.readModels.list(input.model) });
  }
}

export interface QueryReadModelInput {
  readonly principal: Principal;
  readonly model: string;
  readonly dimension?: string;
  readonly periodKey?: string;
  readonly sort?: string;
  readonly order?: "asc" | "desc";
  readonly limit?: number;
  readonly cursor?: string;
}

/**
 * `QueryReadModel` (`finance:read`, M9) — the real paginated read surface. `dimension`/`periodKey`
 * are the two named filter fields the M9 HTTP route validates; `limit` is rejected above 200 at
 * the route's zod schema (422), not silently clamped here — `clampLimit` inside `paginateRows` is
 * a second, defensive layer for any other caller of this use case.
 */
export class QueryReadModel implements UseCase<QueryReadModelInput, ReadModelPage> {
  private readonly deps: ReadModelQueryDeps;
  constructor(deps: ReadModelQueryDeps) {
    this.deps = deps;
  }

  async execute(input: QueryReadModelInput): Promise<Result<ReadModelPage, DomainError>> {
    const authz = await authorize(
      this.deps.security,
      input.principal,
      "finance:read",
      this.deps.clock.now(),
      {
        action: "QueryReadModel",
        model: input.model,
      },
    );
    if (!authz.ok) return err(authz.error);

    const filter: Record<string, string> = {};
    if (input.dimension !== undefined) filter.dimension = input.dimension;
    if (input.periodKey !== undefined) filter.period = input.periodKey;

    const page = await this.deps.readModels.query(input.model, {
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      sort: input.sort,
      order: input.order,
      limit: input.limit,
      cursor: input.cursor,
    });
    return ok(page);
  }
}
