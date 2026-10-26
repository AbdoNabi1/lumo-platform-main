import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, type DomainError, NotFoundError } from "@platform/utils";
import {
  abandonedBefore,
  clampAbandonedPageSize,
  isAbandonedCheckout,
  type AbandonedCheckoutPage,
  type AbandonedCheckoutQueries,
  type CheckoutSessionRecord,
  type RecoveryFilter,
} from "../domain/abandoned-checkouts";
import {
  CheckoutLink,
  hashLinkToken,
  isWellFormedLinkToken,
  RECOVERY_LINK_TTL_MS,
} from "../domain/checkout-link";
import type { CheckoutLinkRepository } from "../domain/checkout-link-repository";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { checkoutItemsFrom, type LoadItemsInput } from "./checkout-details.use-cases";

/**
 * The one answer for every link that cannot be used — unknown, expired, revoked, another shop's, or
 * spent (its checkout became an order). The public routes turn it into a 404 `{ code: "LINK_INVALID" }`.
 */
export const LINK_INVALID = "LINK_INVALID";

function linkInvalid(): NotFoundError {
  return new NotFoundError(`${LINK_INVALID}: this link has expired or is no longer valid`);
}

function notAbandoned(): NotFoundError {
  return new NotFoundError("Abandoned checkout not found");
}

export interface CheckoutRecoveryDeps {
  readonly abandoned: AbandonedCheckoutQueries;
  readonly sessions: CheckoutSessionRepository;
  readonly links: CheckoutLinkRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface ListAbandonedCheckoutsInput {
  readonly tenantId: string;
  readonly first?: number;
  readonly after?: string;
  readonly search?: string;
  readonly recovery?: RecoveryFilter;
}

export interface AbandonedCheckoutListEntry {
  readonly record: CheckoutSessionRecord;
  /** When the newest recovery link for it was made ("Shared Oct 18"), or null ("Not shared"). */
  readonly lastLinkIssuedAt: Date | null;
}

export interface ListAbandonedCheckoutsOutput {
  readonly items: readonly AbandonedCheckoutListEntry[];
  readonly pageInfo: AbandonedCheckoutPage["pageInfo"];
}

/** Spec §3.4: the abandoned checkouts of one shop, newest first, with when each was last shared. */
export class ListAbandonedCheckouts implements UseCase<
  ListAbandonedCheckoutsInput,
  ListAbandonedCheckoutsOutput,
  DomainError
> {
  private readonly deps: CheckoutRecoveryDeps;

  constructor(deps: CheckoutRecoveryDeps) {
    this.deps = deps;
  }

  async execute(
    input: ListAbandonedCheckoutsInput,
  ): Promise<Result<ListAbandonedCheckoutsOutput, DomainError>> {
    const page = await this.deps.abandoned.listAbandoned(
      {
        olderThan: abandonedBefore(this.deps.clock.now()),
        first: clampAbandonedPageSize(input.first),
        after: input.after,
        search: input.search,
        recovery: input.recovery,
      },
      input.tenantId,
    );
    const links = await this.deps.links.listForSessions(
      page.items.map((record) => record.session.id.toString()),
      input.tenantId,
    );
    // `listForSessions` is newest first: the first link seen per checkout is its latest.
    const latest = new Map<string, Date>();
    for (const link of links) {
      const id = link.checkoutSessionId;
      if (id !== null && !latest.has(id)) latest.set(id, link.createdAt);
    }
    return ok({
      items: page.items.map((record) => ({
        record,
        lastLinkIssuedAt: latest.get(record.session.id.toString()) ?? null,
      })),
      pageInfo: page.pageInfo,
    });
  }
}

export interface AbandonedCheckoutIdInput {
  readonly tenantId: string;
  readonly checkoutSessionId: string;
}

export interface GetAbandonedCheckoutOutput {
  readonly record: CheckoutSessionRecord;
  /** Its recovery links, newest first. */
  readonly links: readonly CheckoutLink[];
}

/** Spec §3.4: one abandoned checkout — 404 unless it matches the abandoned definition. */
export class GetAbandonedCheckout implements UseCase<
  AbandonedCheckoutIdInput,
  GetAbandonedCheckoutOutput,
  DomainError
> {
  private readonly deps: CheckoutRecoveryDeps;

  constructor(deps: CheckoutRecoveryDeps) {
    this.deps = deps;
  }

  async execute(
    input: AbandonedCheckoutIdInput,
  ): Promise<Result<GetAbandonedCheckoutOutput, DomainError>> {
    const record = await this.deps.abandoned.findRecord(input.checkoutSessionId, input.tenantId);
    if (record === null || !isAbandonedCheckout(record, abandonedBefore(this.deps.clock.now()))) {
      return err(notAbandoned());
    }
    const links = await this.deps.links.listForSessions([input.checkoutSessionId], input.tenantId);
    return ok({ record, links });
  }
}

export interface IssueRecoveryLinkInput extends AbandonedCheckoutIdInput {
  /** The staff principal id. */
  readonly createdBy: string;
}

export interface IssueRecoveryLinkOutput {
  readonly linkId: string;
  /** Handed out exactly once: only its hash is stored. */
  readonly token: string;
  readonly expiresAt: string;
}

/**
 * Spec §3.3–§3.4: a new recovery link for an abandoned checkout, valid for 7 days. Every call mints a
 * new token (a link cannot be shown twice); older links keep working until they expire.
 */
export class IssueRecoveryLink implements UseCase<
  IssueRecoveryLinkInput,
  IssueRecoveryLinkOutput,
  DomainError
> {
  private readonly deps: CheckoutRecoveryDeps;

  constructor(deps: CheckoutRecoveryDeps) {
    this.deps = deps;
  }

  async execute(
    input: IssueRecoveryLinkInput,
  ): Promise<Result<IssueRecoveryLinkOutput, DomainError>> {
    const now = this.deps.clock.now();
    return this.deps.unitOfWork.run<Result<IssueRecoveryLinkOutput, DomainError>>(async (tx) => {
      const record = await this.deps.abandoned.findRecord(
        input.checkoutSessionId,
        input.tenantId,
        tx,
      );
      if (record === null || !isAbandonedCheckout(record, abandonedBefore(now))) {
        return err(notAbandoned());
      }
      if (record.session.recoveredOrderRef !== undefined) {
        return err(
          new BusinessRuleError("ALREADY_RECOVERED: this checkout already became an order"),
        );
      }
      let issued: ReturnType<typeof CheckoutLink.issue>;
      try {
        issued = CheckoutLink.issue({
          id: this.deps.idGenerator.generate(),
          purpose: "recovery",
          target: { checkoutSessionId: input.checkoutSessionId },
          createdBy: input.createdBy,
          now,
          ttlMs: RECOVERY_LINK_TTL_MS,
        });
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.links.save(issued.link, input.tenantId, tx);
      return ok({
        linkId: issued.link.id,
        token: issued.token,
        expiresAt: issued.link.expiresAt.toISOString(),
      });
    });
  }
}

export interface ResolveCheckoutLinkInput {
  readonly tenantId: string;
  readonly token: string;
}

export interface ResolveCheckoutLinkOutput {
  readonly link: CheckoutLink;
  /** The abandoned checkout the link resumes. Never handed to the shopper: the claim clones it. */
  readonly session: CheckoutSession;
}

/**
 * Spec §3.5 step 1: token → usable link. Looked up by hash INSIDE the request's shop, so another
 * shop's token is unknown. Unknown, expired, revoked and spent links (the checkout was completed or
 * already recovered) all answer the same {@link LINK_INVALID} not-found. Part 3 resolves recovery
 * links only; Part 4 adds the invoice branch.
 */
export class ResolveCheckoutLink implements UseCase<
  ResolveCheckoutLinkInput,
  ResolveCheckoutLinkOutput,
  DomainError
> {
  private readonly deps: CheckoutRecoveryDeps;

  constructor(deps: CheckoutRecoveryDeps) {
    this.deps = deps;
  }

  async execute(
    input: ResolveCheckoutLinkInput,
  ): Promise<Result<ResolveCheckoutLinkOutput, DomainError>> {
    // A token the platform could never have minted is refused like an unknown one, without a read.
    if (!isWellFormedLinkToken(input.token)) return err(linkInvalid());
    const link = await this.deps.links.findByTokenHash(hashLinkToken(input.token), input.tenantId);
    const session = await resumableCheckoutOf(
      this.deps,
      link,
      input.tenantId,
      this.deps.clock.now(),
    );
    return link === null || session === null ? err(linkInvalid()) : ok({ link, session });
  }
}

/**
 * The abandoned checkout a recovery link resumes — or null when the link is unknown, expired,
 * revoked or not a recovery link, or its checkout is gone, completed or already recovered (spent).
 *
 * Deliberate: an original that has since become `expired` or `failed` for another reason (the shop's
 * own cleanup, a declined payment) is still resumed. The shopper wants the cart back, and the claim
 * clones it into a fresh session anyway; only a checkout that became an order, or was already
 * recovered, is spent. Issuing a link is stricter: it requires the checkout to be abandoned (open).
 */
async function resumableCheckoutOf(
  deps: CheckoutRecoveryDeps,
  link: CheckoutLink | null,
  tenantId: string,
  now: Date,
  tx?: unknown,
): Promise<CheckoutSession | null> {
  if (
    link === null ||
    !link.isUsable(now) ||
    link.purpose !== "recovery" ||
    link.checkoutSessionId === null
  ) {
    return null;
  }
  const session = await deps.sessions.findById(link.checkoutSessionId, tenantId, tx);
  if (
    session === null ||
    session.state.value === "completed" ||
    session.recoveredOrderRef !== undefined ||
    // Part 4: a draft order's checkout is never resumed by a recovery link (issuance already refuses it).
    session.draftTerms !== undefined
  ) {
    return null;
  }
  return session;
}

export interface StartRecoveredCheckoutInput {
  readonly tenantId: string;
  /** The link being claimed (from {@link ResolveCheckoutLink}); its checkout is the one cloned. */
  readonly linkId: string;
  /** The CALLER's own cart and session — never the abandoned checkout's. */
  readonly cartRef: string;
  readonly sessionRef: string;
  readonly currency: string;
  /** The caller's refilled cart's lines, priced server-side from Catalog at claim time. */
  readonly items: LoadItemsInput["items"];
}

export interface StartRecoveredCheckoutOutput {
  readonly checkoutSessionId: string;
  readonly claimCount: number;
}

/**
 * Spec §3.5 steps 3–5 in ONE unit of work: opens the caller's own checkout session (marked as the
 * abandoned one's recovery) with the given lines plus the abandoned contact email and shipping
 * address — shipping/payment choices and discount codes are not copied — and counts the claim.
 *
 * The claim is recorded (the repository's atomic, usability-guarded `recordClaim`, with this unit
 * of work's `tx`) BEFORE the clone is saved, and the clone is saved only if it applied: a link that
 * expired or was revoked after it was resolved never leaves an orphan session, and a failure saving
 * the clone rolls the count back with it.
 */
export class StartRecoveredCheckout implements UseCase<
  StartRecoveredCheckoutInput,
  StartRecoveredCheckoutOutput,
  DomainError
> {
  private readonly deps: CheckoutRecoveryDeps;

  constructor(deps: CheckoutRecoveryDeps) {
    this.deps = deps;
  }

  async execute(
    input: StartRecoveredCheckoutInput,
  ): Promise<Result<StartRecoveredCheckoutOutput, DomainError>> {
    const cartRef = Guard.againstEmpty(input.cartRef, "cartRef");
    if (!cartRef.ok) return err(cartRef.error);
    const sessionRef = Guard.againstEmpty(input.sessionRef, "sessionRef");
    if (!sessionRef.ok) return err(sessionRef.error);
    const currency = Money.create(0, input.currency);
    if (!currency.ok) return err(currency.error);
    const items = checkoutItemsFrom(input.items);
    if (!items.ok) return err(items.error);

    return this.deps.unitOfWork.run<Result<StartRecoveredCheckoutOutput, DomainError>>(
      async (tx) => {
        const now = this.deps.clock.now();
        const link = await this.deps.links.findById(input.linkId, input.tenantId, tx);
        const original = await resumableCheckoutOf(this.deps, link, input.tenantId, now, tx);
        if (link === null || original === null) return err(linkInvalid());

        const id = this.deps.idGenerator.generate();
        const clone = CheckoutSession.start(
          UniqueEntityId.from(id),
          input.cartRef,
          undefined,
          input.sessionRef,
          input.currency,
          { recoveredFromRef: original.id.toString() },
        );
        try {
          clone.loadItems(items.value);
          if (original.contactEmail !== undefined) clone.setContactEmail(original.contactEmail);
          if (original.shippingAddress !== undefined) {
            clone.setShippingAddress(original.shippingAddress);
          }
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        const claimCount = await this.deps.links.recordClaim(link.id, input.tenantId, now, id, tx);
        if (claimCount === null) return err(linkInvalid());
        await this.deps.sessions.save(clone, input.tenantId, tx);
        return ok({ checkoutSessionId: id, claimCount });
      },
    );
  }
}
