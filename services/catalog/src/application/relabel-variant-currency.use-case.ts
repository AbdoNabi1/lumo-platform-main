import type { UseCase } from "@platform/application";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import type { VariantCurrencyRelabeler } from "../domain/product-repository";

export interface RelabelVariantCurrencyInput {
  readonly currency: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface RelabelVariantCurrencyOutput {
  /** How many variants changed currency (0 when the shop was already in `currency`). */
  readonly relabelled: number;
}

export interface RelabelVariantCurrencyDeps {
  readonly products: VariantCurrencyRelabeler;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

/**
 * Plan 3C — the store currency changed. Every price is in the store currency, and, as in Shopify,
 * changing it RELABELS: every variant keeps its amount and takes the new code. Idempotent, so a retry
 * after a partial failure is safe.
 */
export class RelabelVariantCurrency implements UseCase<
  RelabelVariantCurrencyInput,
  RelabelVariantCurrencyOutput,
  DomainError
> {
  private readonly deps: RelabelVariantCurrencyDeps;

  constructor(deps: RelabelVariantCurrencyDeps) {
    this.deps = deps;
  }

  async execute(
    input: RelabelVariantCurrencyInput,
  ): Promise<Result<RelabelVariantCurrencyOutput, DomainError>> {
    if (!/^[A-Z]{3}$/.test(input.currency)) {
      return err(
        new ValidationError("Invalid currency", [
          { field: "currency", message: "must be a 3-letter ISO-4217 code" },
        ]),
      );
    }
    return this.deps.unitOfWork.run<Result<RelabelVariantCurrencyOutput, DomainError>>(
      async (tx) => {
        const relabelled = await this.deps.products.relabelCurrency(
          input.currency,
          input.tenantId,
          tx,
        );
        return ok({ relabelled });
      },
    );
  }
}
