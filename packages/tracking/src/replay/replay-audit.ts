/**
 * Replay audit (directive §Audit).
 *
 * Every replay writes immutable audit entries. A replay re-sends historical conversions to live
 * advertising platforms and can move reported revenue, so "who re-sent what, when, why, and what
 * happened" must be reconstructable indefinitely — including for replays that were previewed and
 * never run, or cancelled halfway.
 *
 * Entries are append-only: a correction is a new entry referencing the original, never an edit.
 */

import type { ReplayPlan, ReplayProgress, ReplayScope } from "./replay";

export type ReplayAuditAction =
  "replay_previewed" | "replay_started" | "replay_completed" | "replay_cancelled" | "replay_failed";

/** One immutable audit entry. */
export interface ReplayAuditEntry {
  readonly auditId: string;
  readonly replayId: string;
  readonly action: ReplayAuditAction;
  /** Actor identity — resolved by the caller from the authenticated principal, never inferred. */
  readonly actor: string;
  readonly at: string;
  /** Operator-supplied justification. Required: an unexplained replay is not auditable. */
  readonly reason: string;
  readonly scope: ReplayScope;
  readonly tenantId: string;

  readonly eventCount: number;
  readonly targetCount: number;
  /** Event ids touched. Retained so the blast radius is knowable after the fact. */
  readonly affectedEventIds: readonly string[];

  readonly attempted?: number;
  readonly succeeded?: number;
  readonly failed?: number;
  readonly durationMs?: number;
  readonly refusalCount?: number;
}

/** Append-only sink. A production adapter must write to WORM storage (ADR-0009). */
export interface ReplayAuditPort {
  record(entry: ReplayAuditEntry): Promise<void>;
}

function affectedIds(plan: ReplayPlan): readonly string[] {
  return [...new Set(plan.targets.map((target) => target.eventId))];
}

/** Audit entry for a dry run. Previews are audited too — a rehearsal reveals intent. */
export function previewEntry(input: {
  readonly auditId: string;
  readonly plan: ReplayPlan;
  readonly actor: string;
  readonly reason: string;
  readonly tenantId: string;
  readonly at: string;
}): ReplayAuditEntry {
  return {
    auditId: input.auditId,
    replayId: input.plan.replayId,
    action: "replay_previewed",
    actor: input.actor,
    at: input.at,
    reason: input.reason,
    scope: input.plan.scope,
    tenantId: input.tenantId,
    eventCount: input.plan.eventCount,
    targetCount: input.plan.targetCount,
    affectedEventIds: affectedIds(input.plan),
    refusalCount: input.plan.refusals.length,
  };
}

export function startedEntry(input: {
  readonly auditId: string;
  readonly plan: ReplayPlan;
  readonly actor: string;
  readonly reason: string;
  readonly tenantId: string;
  readonly at: string;
}): ReplayAuditEntry {
  return { ...previewEntry(input), auditId: input.auditId, action: "replay_started" };
}

/**
 * Terminal entry. The action reflects what actually happened — a cancelled replay is never
 * recorded as completed, and a replay with failures is never recorded as clean.
 */
export function finishedEntry(input: {
  readonly auditId: string;
  readonly plan: ReplayPlan;
  readonly progress: ReplayProgress;
  readonly actor: string;
  readonly reason: string;
  readonly tenantId: string;
  readonly at: string;
  readonly durationMs: number;
}): ReplayAuditEntry {
  const action: ReplayAuditAction = input.progress.cancelled
    ? "replay_cancelled"
    : input.progress.failed > 0
      ? "replay_failed"
      : "replay_completed";

  return {
    ...previewEntry(input),
    auditId: input.auditId,
    action,
    attempted: input.progress.attempted,
    succeeded: input.progress.succeeded,
    failed: input.progress.failed,
    durationMs: input.durationMs,
  };
}
