import { createHash, randomBytes } from "node:crypto";
import { BusinessRuleError, ValidationError } from "@platform/utils";

/** What a link opens: an abandoned checkout to resume, or a draft order to pay (Part 4). */
export const CHECKOUT_LINK_PURPOSES = ["recovery", "invoice"] as const;
export type CheckoutLinkPurpose = (typeof CHECKOUT_LINK_PURPOSES)[number];

/** 256-bit tokens (spec §3.3): 32 random bytes, base64url — 43 characters. */
export const LINK_TOKEN_BYTES = 32;
/** A recovery link works for 7 days (spec §3.3). */
export const RECOVERY_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** An invoice link works for 30 days (spec §3.3 / §4.7). */
export const INVOICE_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newLinkToken(): string {
  return randomBytes(LINK_TOKEN_BYTES).toString("base64url");
}

/** The only form a token is ever stored or looked up in: its hex SHA-256. */
export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A token as `newLinkToken` mints it — anything else can be refused without a lookup. */
export function isWellFormedLinkToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export type CheckoutLinkTarget =
  { readonly checkoutSessionId: string } | { readonly draftOrderRef: string };

export interface CheckoutLinkSnapshot {
  readonly id: string;
  readonly purpose: CheckoutLinkPurpose;
  readonly tokenHash: string;
  readonly checkoutSessionId: string | null;
  readonly draftOrderRef: string | null;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly claimCount: number;
  readonly lastClaimedAt: Date | null;
  readonly resultCheckoutRef: string | null;
}

export interface IssueCheckoutLinkInput {
  readonly id: string;
  readonly purpose: CheckoutLinkPurpose;
  readonly target: CheckoutLinkTarget;
  /** The staff principal id. */
  readonly createdBy: string;
  readonly now: Date;
  readonly ttlMs: number;
}

type Props = { -readonly [K in keyof CheckoutLinkSnapshot]: CheckoutLinkSnapshot[K] };

function targetOf(target: CheckoutLinkTarget): {
  readonly checkoutSessionId: string | null;
  readonly draftOrderRef: string | null;
} {
  return "checkoutSessionId" in target
    ? { checkoutSessionId: target.checkoutSessionId.trim() || null, draftOrderRef: null }
    : { checkoutSessionId: null, draftOrderRef: target.draftOrderRef.trim() || null };
}

/**
 * A bearer link to "resume this checkout" (recovery) or "pay this draft" (invoice, Part 4). The token
 * is handed out exactly once, by {@link CheckoutLink.issue}; only its hash is kept, so the same link
 * can never be shown twice — every "Copy recovery link" mints a new one (spec §3.3). Not an event-
 * sourced aggregate: nothing else reacts to a link, so it raises no domain events.
 */
export class CheckoutLink {
  private readonly props: Props;
  /** True until the repository has inserted it: `save` inserts a new link and updates a loaded one. */
  readonly isNew: boolean;

  private constructor(props: Props, isNew: boolean) {
    this.props = props;
    this.isNew = isNew;
  }

  static issue(input: IssueCheckoutLinkInput): {
    readonly link: CheckoutLink;
    readonly token: string;
  } {
    const target = targetOf(input.target);
    if (input.purpose === "recovery" && target.checkoutSessionId === null) {
      throw new ValidationError("A recovery link needs a checkout", [
        { field: "checkoutSessionId", message: "required" },
      ]);
    }
    if (input.purpose === "invoice" && target.draftOrderRef === null) {
      throw new ValidationError("An invoice link needs a draft order", [
        { field: "draftOrderRef", message: "required" },
      ]);
    }
    if (!Number.isInteger(input.ttlMs) || input.ttlMs <= 0) {
      throw new ValidationError("A link must expire", [
        { field: "ttlMs", message: "must be a positive whole number of milliseconds" },
      ]);
    }
    if (input.createdBy.trim().length === 0) {
      throw new ValidationError("A link needs the staff member who made it", [
        { field: "createdBy", message: "required" },
      ]);
    }
    const token = newLinkToken();
    const link = new CheckoutLink(
      {
        id: input.id,
        purpose: input.purpose,
        tokenHash: hashLinkToken(token),
        checkoutSessionId: target.checkoutSessionId,
        draftOrderRef: target.draftOrderRef,
        expiresAt: new Date(input.now.getTime() + input.ttlMs),
        revokedAt: null,
        createdBy: input.createdBy,
        createdAt: input.now,
        claimCount: 0,
        lastClaimedAt: null,
        resultCheckoutRef: null,
      },
      true,
    );
    return { link, token };
  }

  static reconstitute(snapshot: CheckoutLinkSnapshot): CheckoutLink {
    return new CheckoutLink({ ...snapshot }, false);
  }

  /** Not revoked and not yet expired (the expiry instant itself is already too late). */
  isUsable(now: Date): boolean {
    return this.props.revokedAt === null && now.getTime() < this.props.expiresAt.getTime();
  }

  recordClaim(now: Date, resultCheckoutRef?: string): void {
    if (!this.isUsable(now)) {
      throw new BusinessRuleError("LINK_INVALID: this link has expired or was revoked");
    }
    this.props.claimCount += 1;
    this.props.lastClaimedAt = now;
    if (resultCheckoutRef !== undefined) this.props.resultCheckoutRef = resultCheckoutRef;
  }

  revoke(now: Date): void {
    if (this.props.revokedAt === null) this.props.revokedAt = now;
  }

  snapshot(): CheckoutLinkSnapshot {
    return { ...this.props };
  }

  get id(): string {
    return this.props.id;
  }
  get purpose(): CheckoutLinkPurpose {
    return this.props.purpose;
  }
  get tokenHash(): string {
    return this.props.tokenHash;
  }
  get checkoutSessionId(): string | null {
    return this.props.checkoutSessionId;
  }
  get draftOrderRef(): string | null {
    return this.props.draftOrderRef;
  }
  get expiresAt(): Date {
    return this.props.expiresAt;
  }
  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }
  get createdBy(): string {
    return this.props.createdBy;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get claimCount(): number {
    return this.props.claimCount;
  }
  get lastClaimedAt(): Date | null {
    return this.props.lastClaimedAt;
  }
  get resultCheckoutRef(): string | null {
    return this.props.resultCheckoutRef;
  }
}
