import type { UseCase } from "@platform/application";
import type { Clock } from "@platform/contracts";
import { Guard } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CustomerRepository } from "../domain/customer-repository";
import type { SignupTokenRepository } from "../domain/signup-token-repository";
import type { TokenPort } from "./token-port";

export interface CompleteSignupInput {
  readonly token: string;
  readonly name: string;
  readonly tenantId: string;
}

export interface CompleteSignupOutput {
  readonly customerId: string;
  readonly email: string;
}

export interface CompleteSignupDeps {
  readonly customers: CustomerRepository;
  readonly signupTokens: SignupTokenRepository;
  readonly tokenPort: TokenPort;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly clock: Clock;
}

/** The single rejection reason for every invalid-token path — unknown, wrong-tenant, expired, already-consumed, and lost-the-consume-race are all indistinguishable to the caller (the brief's own requirement). */
const INVALID_TOKEN = (): NotFoundError => new NotFoundError("Invalid or expired signup link");

/**
 * Completes a guest-to-account upgrade (G-72): validates and single-use-consumes a signup token,
 * then upgrades the guest `Customer` row in place (`Customer.upgradeFromGuest`) — same customer
 * id, so Customer 360 and every other reader keeps stitching by id. Does NOT touch a password or
 * Security's `Principal` — that provisioning stays in `apps/admin`'s `CustomerAuthAdminController`
 * (D5), exactly like `RegisterCustomer` never touches a password either.
 */
export class CompleteSignup implements UseCase<
  CompleteSignupInput,
  CompleteSignupOutput,
  DomainError
> {
  private readonly deps: CompleteSignupDeps;

  constructor(deps: CompleteSignupDeps) {
    this.deps = deps;
  }

  async execute(input: CompleteSignupInput): Promise<Result<CompleteSignupOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<CompleteSignupOutput, DomainError>>(async (tx) => {
      const now = this.deps.clock.now();
      const hash = this.deps.tokenPort.hash(input.token);
      const record = await this.deps.signupTokens.findByHash(hash, input.tenantId, tx);
      if (record === null || !record.isValid(now)) return err(INVALID_TOKEN());

      const won = await this.deps.signupTokens.markConsumed(
        record.id.toString(),
        input.tenantId,
        now,
        tx,
      );
      if (!won) return err(INVALID_TOKEN());

      const customer = await this.deps.customers.findById(record.customerId, input.tenantId, tx);
      if (customer === null) return err(INVALID_TOKEN());

      customer.upgradeFromGuest(input.name, now);
      await this.deps.customers.save(customer, input.tenantId, tx);

      return ok({ customerId: customer.id.toString(), email: customer.email.value });
    });
  }
}
