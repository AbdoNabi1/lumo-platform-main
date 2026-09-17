import type { UseCase } from "@platform/application";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";
import { ProductOption } from "../domain/value-objects/product-option";

export interface SetProductOptionsInput {
  readonly productId: string;
  readonly options: readonly { readonly name: string; readonly values: readonly string[] }[];
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface SetProductOptionsOutput {
  readonly productId: string;
}

export interface SetProductOptionsDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

/** Replaces a product's declared option set (mutable only while draft). */
export class SetProductOptions implements UseCase<
  SetProductOptionsInput,
  SetProductOptionsOutput,
  DomainError
> {
  private readonly deps: SetProductOptionsDeps;

  constructor(deps: SetProductOptionsDeps) {
    this.deps = deps;
  }

  async execute(
    input: SetProductOptionsInput,
  ): Promise<Result<SetProductOptionsOutput, DomainError>> {
    const options: ProductOption[] = [];
    for (const option of input.options) {
      const created = ProductOption.create(option.name, option.values);
      if (!created.ok) return err(created.error);
      options.push(created.value);
    }

    return this.deps.unitOfWork.run<Result<SetProductOptionsOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, input.tenantId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }
      try {
        product.setOptions(options);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.products.save(product, input.tenantId, tx);
      return ok({ productId: product.id.toString() });
    });
  }
}
