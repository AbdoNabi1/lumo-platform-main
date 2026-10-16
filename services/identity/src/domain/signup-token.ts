import type { UniqueEntityId } from "@platform/domain";
import { BusinessRuleError } from "@platform/utils";

/**
 * A single-use, tenant+customer-bound token proving a shopper opened the signup-completion link
 * emailed to them (G-72). Only the SHA-256 hash of the raw token is ever constructed here or
 * persisted (D3) — the raw value exists only transiently, in `RequestSignupLink`'s output, for the
 * outbound email. Not an `AggregateRoot`: nothing downstream needs to react to a token being
 * issued or consumed, so no domain event is raised.
 */
export class SignupToken {
  private constructor(
    private readonly _id: UniqueEntityId,
    private readonly _tenantId: string,
    private readonly _customerId: string,
    private readonly _tokenHash: string,
    private readonly _expiresAt: Date,
    private _consumedAt: Date | null,
  ) {}

  static issue(
    id: UniqueEntityId,
    tenantId: string,
    customerId: string,
    tokenHash: string,
    expiresAt: Date,
  ): SignupToken {
    return new SignupToken(id, tenantId, customerId, tokenHash, expiresAt, null);
  }

  /** Rebuilds a persisted token exactly as stored — no validation, no events. */
  static reconstitute(
    id: UniqueEntityId,
    tenantId: string,
    customerId: string,
    tokenHash: string,
    expiresAt: Date,
    consumedAt: Date | null,
  ): SignupToken {
    return new SignupToken(id, tenantId, customerId, tokenHash, expiresAt, consumedAt);
  }

  get id(): UniqueEntityId {
    return this._id;
  }

  get tenantId(): string {
    return this._tenantId;
  }

  get customerId(): string {
    return this._customerId;
  }

  get tokenHash(): string {
    return this._tokenHash;
  }

  get expiresAt(): Date {
    return this._expiresAt;
  }

  get consumedAt(): Date | null {
    return this._consumedAt;
  }

  isValid(now: Date): boolean {
    return this._consumedAt === null && this._expiresAt.getTime() > now.getTime();
  }

  /** Marks the token used. Throws if it is already expired or already consumed — single use (D3). */
  consume(now: Date): void {
    if (!this.isValid(now)) {
      throw new BusinessRuleError("Signup token is not valid (expired, already used, or unknown)");
    }
    this._consumedAt = now;
  }
}
