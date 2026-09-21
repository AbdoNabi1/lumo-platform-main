import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConflictError, type DomainError } from "@platform/utils";
import { Customer } from "../domain/customer";
import type { CustomerRepository } from "../domain/customer-repository";
import { Email } from "../domain/value-objects/email";

export interface ResolveGuestCustomerInput {
  readonly email: string;
  readonly name: string;
  /** ADR-0014: the tenant the checkout session belongs to. The same email in two tenants is two customers. */
  readonly tenantId: string;
}

export interface ResolveGuestCustomerOutput {
  readonly customerId: string;
  /** `true` when this call created the customer; `false` when it resolved to an existing one. */
  readonly created: boolean;
}

export interface ResolveGuestCustomerDeps {
  readonly customers: CustomerRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Find-or-create the customer a guest checkout's order is placed against (WP-1, G-52).
 *
 * - **Find:** an existing customer with this email in this tenant — a returning guest, or someone
 *   who registered months ago — resolves to their existing id. Nothing is created, nothing is
 *   emitted, and an existing customer is never modified or downgraded.
 * - **Create:** otherwise a customer marked as a guest (`Customer.registerGuest`) is created:
 *   no password, no verified email, and — deliberately — no consent record. Placing an order is a
 *   transaction, not an opt-in. `customer.registered` is raised only on this branch.
 *
 * **Resolving is not authenticating.** The returned id lets the caller attach an order to that
 * customer; it grants no session and no read access. Callers must not treat it as proof of
 * identity — the guest merely typed an email.
 *
 * **The concurrent-create race.** Two guest checkouts with the same email can both find nothing and
 * both create; `@@unique([tenantId, email])` fails the second with a `ConflictError`. Postgres
 * aborts the whole transaction on a constraint violation, so re-reading inside the same unit of
 * work would fail too — the recovery read therefore runs in a FRESH unit of work and returns the
 * winner's id. Any other failure propagates untouched.
 */
export class ResolveGuestCustomer implements UseCase<
  ResolveGuestCustomerInput,
  ResolveGuestCustomerOutput,
  DomainError
> {
  private readonly deps: ResolveGuestCustomerDeps;

  constructor(deps: ResolveGuestCustomerDeps) {
    this.deps = deps;
  }

  async execute(
    input: ResolveGuestCustomerInput,
  ): Promise<Result<ResolveGuestCustomerOutput, DomainError>> {
    const email = Email.create(input.email);
    if (!email.ok) return err(email.error);
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    try {
      return await this.deps.unitOfWork.run<Result<ResolveGuestCustomerOutput, DomainError>>(
        async (tx) => {
          const existing = await this.deps.customers.findByEmail(
            email.value.value,
            input.tenantId,
            tx,
          );
          if (existing !== null) return ok({ customerId: existing.id.toString(), created: false });

          const id = UniqueEntityId.from(this.deps.idGenerator.generate());
          const customer = Customer.registerGuest(
            id,
            email.value,
            input.name,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
          );
          await this.deps.customers.save(customer, input.tenantId, tx);
          return ok({ customerId: id.toString(), created: true });
        },
      );
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      return this.deps.unitOfWork.run<Result<ResolveGuestCustomerOutput, DomainError>>(
        async (tx) => {
          const winner = await this.deps.customers.findByEmail(
            email.value.value,
            input.tenantId,
            tx,
          );
          return winner === null
            ? err(error)
            : ok({ customerId: winner.id.toString(), created: false });
        },
      );
    }
  }
}
