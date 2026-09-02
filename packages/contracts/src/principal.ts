/** The kind of actor a {@link Principal} represents. */
export type PrincipalKind = "customer" | "staff" | "service";

/**
 * An authenticated actor — the cross-cutting identity seam. Produced by the interfaces layer after
 * authentication and consumed by application services to know who is acting. `roles` drive RBAC
 * checks via {@link AccessControl}. This is a generic platform contract, not a domain entity.
 */
export interface Principal {
  readonly id: string;
  readonly kind: PrincipalKind;
  readonly roles: readonly string[];
}
