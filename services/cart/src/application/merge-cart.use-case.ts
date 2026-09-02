import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CartRepository } from "../domain/cart-repository";

export interface MergeGuestCartInput {
  /** The target (customer) cart's id, receiving the merged lines. */
  readonly targetCartId: string;
  /** The source (guest) cart's id, merged in and left untouched (never deleted here). */
  readonly sourceCartId: string;
}

export interface MergeGuestCartOutput {
  readonly cartId: string;
  readonly totalAmountMinor: number;
}

export interface MergeGuestCartDeps {
  readonly carts: CartRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Merges a guest cart's lines into a customer's cart (e.g. on login). Same-currency only. */
export class MergeGuestCart implements UseCase<
  MergeGuestCartInput,
  MergeGuestCartOutput,
  DomainError
> {
  private readonly deps: MergeGuestCartDeps;

  constructor(deps: MergeGuestCartDeps) {
    this.deps = deps;
  }

  async execute(input: MergeGuestCartInput): Promise<Result<MergeGuestCartOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<MergeGuestCartOutput, DomainError>>(async (tx) => {
      const target = await this.deps.carts.findById(input.targetCartId, tx);
      if (target === null) {
        return err(new NotFoundError("Target cart not found"));
      }
      const source = await this.deps.carts.findById(input.sourceCartId, tx);
      if (source === null) {
        return err(new NotFoundError("Source cart not found"));
      }

      try {
        target.merge(source, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.carts.save(target, tx);
      return ok({
        cartId: target.id.toString(),
        totalAmountMinor: target.totalAmount().amountMinor,
      });
    });
  }
}
