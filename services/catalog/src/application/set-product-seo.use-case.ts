import type { UseCase } from "@platform/application";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";
import { Seo } from "../domain/value-objects/seo";

export interface SetProductSeoInput {
  readonly productId: string;
  readonly title?: string;
  readonly description?: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface SetProductSeoOutput {
  readonly productId: string;
}

export interface SetProductSeoDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

/** Sets or clears a product's SEO overrides. */
export class SetProductSeo implements UseCase<
  SetProductSeoInput,
  SetProductSeoOutput,
  DomainError
> {
  private readonly deps: SetProductSeoDeps;

  constructor(deps: SetProductSeoDeps) {
    this.deps = deps;
  }

  async execute(input: SetProductSeoInput): Promise<Result<SetProductSeoOutput, DomainError>> {
    let seo: Seo | null = null;
    if (input.title !== undefined || input.description !== undefined) {
      const created = Seo.create(input.title, input.description);
      if (!created.ok) return err(created.error);
      seo = created.value;
    }

    return this.deps.unitOfWork.run<Result<SetProductSeoOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, input.tenantId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }
      product.setSeo(seo);
      await this.deps.products.save(product, tx);
      return ok({ productId: product.id.toString() });
    });
  }
}
