import type { AuthenticatedIdentity } from "./principal";

/**
 * Verifies a bearer token and resolves the authenticated {@link AuthenticatedIdentity}, or `null` when the
 * token is missing or invalid. Implemented by infrastructure (an Ory adapter, later) and invoked at
 * the interfaces boundary; the domain never depends on it. Callers map a `null` result to an
 * `AuthenticationError` (`@platform/utils`).
 */
export interface Authenticator {
  verify(token: string): Promise<AuthenticatedIdentity | null>;
}

/** Verified token claims exposed for transport concerns (tenant resolution — ADR-0008). */
export interface AuthenticatedContext {
  readonly principal: AuthenticatedIdentity;
  readonly claims: Readonly<Record<string, unknown>>;
}

/**
 * ADDITIVE extension (Sprint 2.7, D-048): adapters that can expose verified claims implement
 * this alongside `verify`, letting the transport run its claim-based tenant resolver without
 * ever parsing tokens itself. Optional — existing `Authenticator` implementations stay valid.
 */
export interface ClaimsAuthenticator extends Authenticator {
  verifyWithClaims(token: string): Promise<AuthenticatedContext | null>;
}
