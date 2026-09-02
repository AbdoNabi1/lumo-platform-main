import type { UseCase } from "@platform/application";
import { isDomainError, UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import {
  AuthenticationError,
  type DomainError,
  NotFoundError,
  ValidationError,
} from "@platform/utils";
import { Session } from "../domain/session";
import { isHumanKind } from "../domain/value-objects/principal-kind";
import { recordAudit, securityEvent, type SecurityDeps } from "./deps";

export interface SessionOutput {
  readonly id: string;
  readonly principalRef: string;
  readonly status: string;
  readonly externalRef: string | null;
  readonly refreshCount: number;
  readonly impersonatedBy: string | null;
  readonly expiresAt: string;
}

function present(s: Session): SessionOutput {
  return {
    id: s.id.toString(),
    principalRef: s.principalRef,
    status: s.status,
    externalRef: s.externalRef,
    refreshCount: s.refreshCount,
    impersonatedBy: s.impersonatedBy,
    expiresAt: s.expiresAt.toISOString(),
  };
}

export interface EstablishSessionInput {
  readonly principalExternalId: string;
  readonly refreshFingerprint: string;
  /** Upstream IdP session id (Kratos/OIDC `sid`) this session mirrors — federation (ADR-0031). */
  readonly externalRef?: string | null;
  readonly deviceRef?: string | null;
  readonly ttlSeconds: number;
}

/** Establishes an authenticated session for a principal. Emits `security.session.established` + audit. */
export class EstablishSession implements UseCase<
  EstablishSessionInput,
  SessionOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: EstablishSessionInput): Promise<Result<SessionOutput, DomainError>> {
    const principal = await this.deps.principals.findByExternalId(input.principalExternalId);
    if (principal === null) return err(new NotFoundError("Principal not found"));
    return this.deps.unitOfWork.run<Result<SessionOutput, DomainError>>(async (tx) => {
      const now = this.deps.clock.now();
      const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
      let session: Session;
      try {
        session = Session.establish(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          {
            principalRef: principal.id.toString(),
            refreshFingerprint: input.refreshFingerprint,
            externalRef: input.externalRef ?? null,
            deviceRef: input.deviceRef ?? null,
            expiresAt,
          },
          this.deps.idGenerator.generate(),
          now,
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.sessions.save(session, tx);
      this.deps.telemetry.increment("security.session.established");
      await recordAudit(this.deps, tx, {
        principalRef: principal.externalId,
        action: "security.session.established",
        decision: "allow",
        tenantRef: principal.tenantRef,
      });
      return ok(present(session));
    });
  }
}

export interface FederateExternalSessionInput {
  readonly principalExternalId: string;
  /** The upstream IdP session id the (already transport-verified) request carries. */
  readonly externalRef: string;
  readonly refreshFingerprint: string;
  readonly deviceRef?: string | null;
  readonly ttlSeconds: number;
}

/**
 * **External session federation** (ADR-0031) — resolves the Security {@link Session} mirroring an upstream
 * identity-provider session (Kratos/OIDC `sid`), establishing the mirror on first sight. This is what lets a
 * human request authenticated by the IdP satisfy `EvaluateAccess`'s session gate: Security does not mint
 * human sessions (Kratos owns login), so without a mirror every human fails closed.
 *
 * The upstream session's authenticity is **not** re-checked here — the transport already verified the token
 * that carried this `externalRef` before any guard runs; re-verifying would duplicate the authenticator.
 * What this use case owns is the *binding*, and it is deliberately strict:
 *
 * - an existing **valid** mirror for the same principal is reused as-is (no mutation, no audit noise);
 * - an existing mirror bound to a **different** principal is refused — an upstream id is never re-bound
 *   (session-fixation defence);
 * - an existing **revoked or expired** mirror is refused rather than re-established — otherwise replaying a
 *   revoked `sid` would resurrect the session and silently defeat revocation. A genuine re-login yields a
 *   new upstream id, which federates cleanly.
 *
 * Only the first branch of a first-sight federation writes; the rest fail closed.
 */
export class FederateExternalSession implements UseCase<
  FederateExternalSessionInput,
  SessionOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: FederateExternalSessionInput): Promise<Result<SessionOutput, DomainError>> {
    const externalRef = input.externalRef.trim();
    if (externalRef.length === 0)
      return err(new ValidationError("An external session ref is required"));

    const principal = await this.deps.principals.findByExternalId(input.principalExternalId);
    if (principal === null) return err(new NotFoundError("Principal not found"));

    const existing = await this.deps.sessions.findByExternalRef(externalRef);
    if (existing !== null) {
      if (existing.principalRef !== principal.id.toString()) {
        this.deps.telemetry.increment("security.session.federation_rejected");
        return err(new AuthenticationError("External session is bound to a different principal"));
      }
      if (!existing.isValidAt(this.deps.clock.now())) {
        this.deps.telemetry.increment("security.session.federation_rejected");
        return err(
          new AuthenticationError(`External session is no longer valid (${existing.status})`),
        );
      }
      return ok(present(existing));
    }

    this.deps.telemetry.increment("security.session.federated");
    return new EstablishSession(this.deps).execute({
      principalExternalId: input.principalExternalId,
      refreshFingerprint: input.refreshFingerprint,
      externalRef,
      deviceRef: input.deviceRef ?? null,
      ttlSeconds: input.ttlSeconds,
    });
  }
}

export interface RefreshSessionInput {
  readonly sessionId: string;
  readonly newRefreshFingerprint: string;
  readonly ttlSeconds: number;
}

/** Rotates the refresh token and extends the session (token rotation, Part 1). Emits `security.session.refreshed`. */
export class RefreshSession implements UseCase<RefreshSessionInput, SessionOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: RefreshSessionInput): Promise<Result<SessionOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<SessionOutput, DomainError>>(async (tx) => {
      const session = await this.deps.sessions.findById(input.sessionId, tx);
      if (session === null) return err(new NotFoundError("Session not found"));
      const now = this.deps.clock.now();
      try {
        session.refresh(
          input.newRefreshFingerprint,
          new Date(now.getTime() + input.ttlSeconds * 1000),
          this.deps.idGenerator.generate(),
          now,
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.sessions.save(session, tx);
      await recordAudit(this.deps, tx, {
        principalRef: session.principalRef,
        action: "security.session.refreshed",
        decision: "allow",
      });
      return ok(present(session));
    });
  }
}

export interface RevokeSessionInput {
  readonly sessionId: string;
}

/** Revokes a session (logout / forced revocation). Emits `security.session.revoked` + audit. */
export class RevokeSession implements UseCase<RevokeSessionInput, SessionOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: RevokeSessionInput): Promise<Result<SessionOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<SessionOutput, DomainError>>(async (tx) => {
      const session = await this.deps.sessions.findById(input.sessionId, tx);
      if (session === null) return err(new NotFoundError("Session not found"));
      session.revoke(this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.sessions.save(session, tx);
      this.deps.telemetry.increment("security.session.revoked");
      await recordAudit(this.deps, tx, {
        principalRef: session.principalRef,
        action: "security.session.revoked",
        decision: "allow",
      });
      return ok(present(session));
    });
  }
}

export interface RevokeAllSessionsInput {
  readonly principalExternalId: string;
}

export interface RevokeAllSessionsOutput {
  readonly revoked: number;
}

/** Revokes every active session for a principal (force logout everywhere — session intelligence §5). */
export class RevokeAllSessions implements UseCase<
  RevokeAllSessionsInput,
  RevokeAllSessionsOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(
    input: RevokeAllSessionsInput,
  ): Promise<Result<RevokeAllSessionsOutput, DomainError>> {
    const principal = await this.deps.principals.findByExternalId(input.principalExternalId);
    if (principal === null) return err(new NotFoundError("Principal not found"));
    return this.deps.unitOfWork.run<Result<RevokeAllSessionsOutput, DomainError>>(async (tx) => {
      const sessions = await this.deps.sessions.listByPrincipal(principal.id.toString(), tx);
      let revoked = 0;
      for (const session of sessions) {
        if (!session.isActive) continue;
        session.revoke(this.deps.idGenerator.generate(), this.deps.clock.now());
        await this.deps.sessions.save(session, tx);
        this.deps.telemetry.increment("security.session.revoked");
        revoked += 1;
      }
      await recordAudit(this.deps, tx, {
        principalRef: principal.externalId,
        action: "security.session.revoked_all",
        decision: "allow",
        tenantRef: principal.tenantRef,
        metadata: { revoked: String(revoked) },
      });
      // Session synchronization (H-2): emit a principal-level revocation fact keyed by the identity's
      // external id so the session-sync consumer propagates the "logout everywhere" to Kratos. The
      // subjectRef is null for non-human principals — only human identities have Kratos sessions.
      if (principal.subjectRef !== null) {
        await this.deps.outbox.publish(
          [
            securityEvent(
              this.deps,
              "session",
              principal.id.toString(),
              principal.subjectRef,
              "security.session.revoked_all",
              "revoked",
            ),
          ],
          tx,
        );
      }
      return ok({ revoked });
    });
  }
}

export interface IntrospectSessionInput {
  readonly sessionId: string;
}

export interface SessionIntrospection {
  readonly active: boolean;
  readonly session: SessionOutput | null;
}

/** Token introspection (Part 1) — read-only validity check at the current clock. No mutation, no audit. */
export class IntrospectSession implements UseCase<
  IntrospectSessionInput,
  SessionIntrospection,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: IntrospectSessionInput): Promise<Result<SessionIntrospection, DomainError>> {
    const session = await this.deps.sessions.findById(input.sessionId);
    if (session === null) return ok({ active: false, session: null });
    return ok({ active: session.isValidAt(this.deps.clock.now()), session: present(session) });
  }
}

export interface IntrospectSessionSubjectInput {
  readonly sessionId: string;
}

/**
 * The resolved identity behind a session — deliberately **flat primitives only**, never the
 * `Session`/`Principal` aggregates. `subjectRef` is the Identity-context id (a customer id for a
 * storefront shopper, a user id for staff); it is the single value a customer-scoped route is
 * allowed to scope its data by.
 */
export interface SessionSubject {
  readonly active: boolean;
  readonly sessionId: string | null;
  /** The principal's external id — what `RevokeAllSessions`/`Authenticate` key off. */
  readonly principalExternalId: string | null;
  /** The Identity subject this human principal references. Never a Security-internal id. */
  readonly subjectRef: string | null;
  readonly expiresAt: string | null;
}

/** The single inactive answer every failed resolution below returns — see the class doc comment. */
const INACTIVE_SUBJECT: SessionSubject = {
  active: false,
  sessionId: null,
  principalExternalId: null,
  subjectRef: null,
  expiresAt: null,
};

/**
 * **Session → Principal → Identity-subject resolution** (T5.17, designed by T5.16 §2) — the
 * customer-facing counterpart to {@link IntrospectSession}. Read-only, no mutation, no audit.
 *
 * `IntrospectSession` alone is not enough to authorize a customer-scoped request: `SessionOutput.
 * principalRef` is the Security-**internal** `Principal.id`, not an Identity id, so a caller that
 * introspected a session still could not say *whose* data the session may read. This use case closes
 * that last hop server-side — `sessions.findById` → `principals.findById(session.principalRef)` →
 * `principal.subjectRef` — so the storefront never receives, stores, or transmits anything but the
 * opaque session id, and a `customerRef` is only ever *derived* here, never accepted from a caller.
 *
 * **Fail-closed, and uniformly so.** Every unresolvable step — unknown session, expired/revoked
 * session, missing principal, a principal that is suspended/disabled, or a non-human principal (a
 * service account or API key must never resolve to a customer identity) — returns the exact same
 * {@link INACTIVE_SUBJECT}. One indistinguishable answer means this endpoint cannot be used as an
 * oracle to probe which session ids, principals, or customers exist. It never throws and never
 * returns a `DomainError` for an invalid session: "not a valid session" is a successful answer to
 * the question asked, not a failure to answer it.
 */
export class IntrospectSessionSubject implements UseCase<
  IntrospectSessionSubjectInput,
  SessionSubject,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: IntrospectSessionSubjectInput): Promise<Result<SessionSubject, DomainError>> {
    if (input.sessionId.trim().length === 0) return ok(INACTIVE_SUBJECT);

    const session = await this.deps.sessions.findById(input.sessionId);
    if (session === null) return ok(INACTIVE_SUBJECT);
    if (!session.isValidAt(this.deps.clock.now())) return ok(INACTIVE_SUBJECT);

    const principal = await this.deps.principals.findById(session.principalRef);
    if (principal === null || !principal.isActive) return ok(INACTIVE_SUBJECT);
    // A non-human principal has no Identity subject by construction (`Principal.register` refuses a
    // `subjectRef` on one) — resolving a machine/API-key session to a customer would be a privilege
    // confusion, so it is refused here rather than relying on `subjectRef` happening to be null.
    if (!isHumanKind(principal.kind) || principal.subjectRef === null) return ok(INACTIVE_SUBJECT);

    return ok({
      active: true,
      sessionId: session.id.toString(),
      principalExternalId: principal.externalId,
      subjectRef: principal.subjectRef,
      expiresAt: session.expiresAt.toISOString(),
    });
  }
}
