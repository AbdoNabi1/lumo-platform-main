import type { UseCase } from "@platform/application";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import {
  MAX_TAGS_PER_CUSTOMER,
  parseTags,
  type CustomerAnnotationRepository,
} from "../domain/customer-annotations";

export interface SetCustomerTagsInput {
  readonly tenantId: string;
  readonly customerId: string;
  readonly tags: readonly string[];
}

export interface SetCustomerTagsOutput {
  readonly customerId: string;
  readonly tags: readonly string[];
}

export interface SetCustomerTagsDeps {
  readonly annotations: CustomerAnnotationRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

/** Replaces the whole tag set of a customer (sorted, de-duplicated by key). */
export class SetCustomerTags implements UseCase<
  SetCustomerTagsInput,
  SetCustomerTagsOutput,
  DomainError
> {
  private readonly deps: SetCustomerTagsDeps;

  constructor(deps: SetCustomerTagsDeps) {
    this.deps = deps;
  }

  async execute(input: SetCustomerTagsInput): Promise<Result<SetCustomerTagsOutput, DomainError>> {
    if (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== "string")) {
      return err(
        new ValidationError("Invalid tags", [
          { field: "tags", message: "must be a list of strings" },
        ]),
      );
    }
    const tags = parseTags(input.tags);
    if (!tags.ok) return err(tags.error);
    if (tags.value.length > MAX_TAGS_PER_CUSTOMER) {
      return err(
        new ValidationError(`A customer can have at most ${MAX_TAGS_PER_CUSTOMER} tags`, [
          { field: "tags", message: `must be at most ${MAX_TAGS_PER_CUSTOMER} tags` },
        ]),
      );
    }

    return this.deps.unitOfWork.run<Result<SetCustomerTagsOutput, DomainError>>(async (tx) => {
      const stored = await this.deps.annotations.replaceTags(
        input.customerId,
        tags.value,
        input.tenantId,
        tx,
      );
      if (stored === null) return err(new NotFoundError("Customer not found"));
      return ok({ customerId: input.customerId, tags: stored });
    });
  }
}
