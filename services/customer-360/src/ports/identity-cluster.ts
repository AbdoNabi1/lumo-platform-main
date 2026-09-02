import type { ResolvedIdentity } from "@platform/tracking";

/**
 * A computed view over a resolved identity cluster — not a stored aggregate. `id` is a snapshot
 * identifier (opaque, caller-supplied) so a caller can refer back to "the cluster as resolved at
 * this moment"; the durable truth is always the underlying graph + decisions, re-resolved on read.
 */
export interface IdentityCluster {
  readonly id: string;
  readonly resolvedAt: string;
  readonly resolved: ResolvedIdentity;
}

export function toIdentityCluster(
  id: string,
  resolvedAt: string,
  resolved: ResolvedIdentity,
): IdentityCluster {
  return { id, resolvedAt, resolved };
}
