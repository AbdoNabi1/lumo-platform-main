import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { CustomerRepository } from "../domain/customer-repository";
import { SignupToken } from "../domain/signup-token";
import type { SignupTokenRepository } from "../domain/signup-token-repository";
import { Email } from "../domain/value-objects/email";
import type { TokenPort } from "./token-port";

export interface RequestSignupLinkInput {
  readonly email: string;
  readonly tenantId: string;
}

export type RequestSignupLinkOutput =
  | { readonly kind: "new" }
  | { readonly kind: "already-registered"; readonly customerId: string }
  | {
      readonly kind: "guest";
      readonly customerId: string;
      readonly token: string;
      readonly expiresAt: string;
    };

export interface RequestSignupLinkDeps {
  readonly customers: CustomerRepository;
  readonly signupTokens: SignupTokenRepository;
  readonly tokenPort: TokenPort;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Answers "what happens if someone signs up with this email" (G-72) without letting the answer
 * become a purchase oracle (D2): the caller (`apps/admin`'s `CustomerAuthAdminController`) turns
 * BOTH `"already-registered"` and `"guest"` into the identical HTTP response — only the outcome
 * this use case returns tells them apart, and that never crosses the wire unmapped. `"new"` tells
 * the caller to fall through to today's immediate `RegisterCustomer` flow, unchanged.
 *
 * A `"guest"` outcome invalidates any still-valid earlier token for the same customer before
 * issuing a new one (D3: "issuing a new token for the same email invalidates earlier ones") — all
 * inside the same transaction as the issuance, so a reader never observes two valid tokens.
 */
export class RequestSignupLink implements UseCase<
  RequestSignupLinkInput,
  RequestSignupLinkOutput,
  DomainError
> {
  private static readonly SIGNUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

  private readonly deps: RequestSignupLinkDeps;

  constructor(deps: RequestSignupLinkDeps) {
    this.deps = deps;
  }

  async execute(
    input: RequestSignupLinkInput,
  ): Promise<Result<RequestSignupLinkOutput, DomainError>> {
    const email = Email.create(input.email);
    if (!email.ok) return err(email.error);

    return this.deps.unitOfWork.run<Result<RequestSignupLinkOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.customers.findByEmail(email.value.value, input.tenantId, tx);
      if (existing === null) return ok({ kind: "new" });
      if (!existing.isGuest) {
        return ok({ kind: "already-registered", customerId: existing.id.toString() });
      }

      const now = this.deps.clock.now();
      const customerId = existing.id.toString();
      await this.deps.signupTokens.invalidateAllForCustomer(customerId, input.tenantId, now, tx);

      const raw = this.deps.tokenPort.generateRaw();
      const hash = this.deps.tokenPort.hash(raw);
      const expiresAt = new Date(now.getTime() + RequestSignupLink.SIGNUP_TOKEN_TTL_MS);
      const token = SignupToken.issue(
        UniqueEntityId.from(this.deps.idGenerator.generate()),
        input.tenantId,
        customerId,
        hash,
        expiresAt,
      );
      await this.deps.signupTokens.save(token, tx);

      return ok({ kind: "guest", customerId, token: raw, expiresAt: expiresAt.toISOString() });
    });
  }
}
