/** The kind of actor a {@link Principal} represents. */
export type PrincipalKind = "customer" | "staff" | "service";

/**
 * WHO an authenticator or system actor is, before any tenant is known: the verified subject, its
 * kind and its roles. Produced by the {@link Authenticator} port, whose token may or may not carry a
 * tenant claim — the tenant is RESOLVED by the transport (ADR-0008), never guessed here. Anything
 * that decides or records an authorization must take a {@link Principal}, not this.
 */
export interface AuthenticatedIdentity {
  readonly id: string;
  readonly kind: PrincipalKind;
  readonly roles: readonly string[];
}

/**
 * An authenticated actor **acting within one tenant** — the cross-cutting identity seam. The
 * transport builds it by binding an {@link AuthenticatedIdentity} to the request's resolved tenant
 * (the anonymous public principal included), then hands it to guards and application services.
 * `roles` drive RBAC checks via {@link AccessControl}. This is a generic platform contract, not a
 * domain entity.
 *
 * `tenantId` is required and never defaulted: a principal with no tenant cannot exist, so an
 * authorization decision or cache key that forgets the tenant fails to compile (G-67, ADR-0015).
 */
export interface Principal extends AuthenticatedIdentity {
  readonly tenantId: string;
}
