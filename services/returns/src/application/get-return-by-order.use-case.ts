import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { ReturnRequest } from "../domain/return-request";
import type { ReturnRequestRepository } from "../domain/return-request-repository";

export interface GetReturnByOrderInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly orderRef: string;
}

export interface GetReturnByOrderDeps {
  readonly returnRequests: ReturnRequestRepository;
}

/** Reads the return request opened for a given order, if any (Phase A.30 admin Order Detail panel). */
export class GetReturnByOrder implements UseCase<
  GetReturnByOrderInput,
  ReturnRequest,
  DomainError
> {
  private readonly deps: GetReturnByOrderDeps;

  constructor(deps: GetReturnByOrderDeps) {
    this.deps = deps;
  }

  async execute(input: GetReturnByOrderInput): Promise<Result<ReturnRequest, DomainError>> {
    const returnRequest = await this.deps.returnRequests.findByOrderRef(
      input.orderRef,
      input.tenantId,
    );
    if (returnRequest === null) {
      return err(new NotFoundError("No return request found for this order"));
    }
    return ok(returnRequest);
  }
}
