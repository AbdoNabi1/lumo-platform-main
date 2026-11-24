import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import type { CustomerAnnotationRepository } from "../domain/customer-annotations";

const MAX_CUSTOMER_IDS = 250;

export interface GetCustomerAnnotationsInput {
  readonly tenantId: string;
  readonly customerIds: readonly string[];
}

export interface CustomerAnnotationsItem {
  readonly customerId: string;
  readonly note: string | null;
  readonly tags: readonly string[];
}

export interface GetCustomerAnnotationsOutput {
  readonly items: readonly CustomerAnnotationsItem[];
}

export interface GetCustomerAnnotationsDeps {
  readonly annotations: CustomerAnnotationRepository;
}

/** The notes and tags of 1..250 customers in ONE read, in input order; unknown ids are omitted. */
export class GetCustomerAnnotations implements UseCase<
  GetCustomerAnnotationsInput,
  GetCustomerAnnotationsOutput,
  DomainError
> {
  private readonly deps: GetCustomerAnnotationsDeps;

  constructor(deps: GetCustomerAnnotationsDeps) {
    this.deps = deps;
  }

  async execute(
    input: GetCustomerAnnotationsInput,
  ): Promise<Result<GetCustomerAnnotationsOutput, DomainError>> {
    const raw: unknown = input.customerIds;
    if (
      !Array.isArray(raw) ||
      raw.length < 1 ||
      raw.length > MAX_CUSTOMER_IDS ||
      raw.some((id) => typeof id !== "string")
    ) {
      return err(
        new ValidationError("Invalid customer ids", [
          { field: "customerIds", message: "must be 1 to 250 customer ids" },
        ]),
      );
    }
    const ids = [...new Set(input.customerIds)];
    const found = await this.deps.annotations.annotationsOf(ids, input.tenantId);
    const items: CustomerAnnotationsItem[] = [];
    for (const customerId of ids) {
      const annotations = found.get(customerId);
      if (annotations !== undefined) {
        items.push({ customerId, note: annotations.note, tags: annotations.tags });
      }
    }
    return ok({ items });
  }
}
