/**
 * Outbound message status state machine. Pure; no I/O.
 *
 * Rank: pending 0 < accepted 1 < sent 2 < delivered 3 < read 4. Provider webhooks arrive out of order, so a status never
 * moves backwards. `failed` and `suppressed` are terminal; a late `failed` after a delivery/read is ignored.
 */

export type OutboundStatus =
  "pending" | "accepted" | "sent" | "delivered" | "read" | "failed" | "unknown" | "suppressed";

const RANK: Readonly<Record<"pending" | "accepted" | "sent" | "delivered" | "read", number>> = {
  pending: 0,
  accepted: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

type Ranked = keyof typeof RANK;

function isRanked(s: OutboundStatus): s is Ranked {
  return s in RANK;
}

export function nextStatus(current: OutboundStatus, incoming: OutboundStatus): OutboundStatus {
  if (current === "suppressed" || current === "failed") return current;

  if (incoming === "suppressed") return current === "pending" ? "suppressed" : current;

  if (incoming === "failed")
    return current === "delivered" || current === "read" ? current : "failed";

  if (incoming === "unknown")
    return current === "pending" || current === "unknown" ? "unknown" : current;

  // incoming is a ranked provider status from here on.
  if (current === "unknown") return incoming === "pending" ? "unknown" : incoming;
  if (!isRanked(current) || !isRanked(incoming)) return current;
  return RANK[incoming] > RANK[current] ? incoming : current;
}
