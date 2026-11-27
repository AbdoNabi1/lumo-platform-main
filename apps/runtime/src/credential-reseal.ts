import type { Database } from "@platform/db";
import type { HealthRegistry } from "@platform/health";
import type { Logger } from "@platform/utils";

/**
 * O15 / D55: the one-shot re-seal of merchants' sealed credentials after a KEK rotation.
 *
 * While `PAYMENT_CREDENTIALS_KEK_REF_PREVIOUS` / `SHIPPING_CREDENTIALS_KEK_REF_PREVIOUS` is set, the
 * API process re-wraps every stored sealed value under the CURRENT key in the background once it is
 * listening. Rules (each one is tested):
 *  - single replica: the whole run holds a Postgres advisory lock; a replica that does not get it
 *    does nothing;
 *  - safe to repeat: values already v2 under the current key are skipped, so it is idempotent and may
 *    run on every boot while PREVIOUS is set;
 *  - never loses a concurrent write: each row is updated compare-and-set (see the stores); a lost
 *    race is retried from a fresh read, and a row that keeps losing is counted as failed;
 *  - counts only: nothing but `resealed` / `skipped` / `failed` per target is ever logged. No id, key,
 *    blob or error text.
 */

/** One row that holds sealed credentials: its tenant (the write scope) and a unique, sortable key. */
export interface SealedRowRef {
  readonly tenantId: string;
  readonly key: string;
}

/**
 * What a service's store offers the job (structurally: the stores live in their own services and
 * this app owns the composition). `resealRow` hands every sealed string of the row to `rewrap`
 * (which returns its input unchanged when nothing is to be done) and writes the row back only if it
 * is unchanged since it was read.
 */
export interface SealedCredentialStore {
  readonly name: string;
  listRefs(after: string | undefined, limit: number): Promise<readonly SealedRowRef[]>;
  resealRow(
    ref: SealedRowRef,
    rewrap: (sealed: string) => Promise<string>,
  ): Promise<"resealed" | "unchanged" | "conflict">;
}

export interface ResealTarget {
  /** Label used in the counts (`payments`, `billing`, `shipping`). */
  readonly name: string;
  readonly store: SealedCredentialStore;
  /** Re-wraps one stored blob under the current key; returns the same string when it is current. */
  readonly rewrap: (sealed: string) => Promise<string>;
}

export interface CredentialResealPlan {
  readonly targets: readonly ResealTarget[];
}

export interface ResealCounts {
  readonly resealed: number;
  readonly skipped: number;
  readonly failed: number;
}

export type ResealReport = Readonly<Record<string, ResealCounts>>;

/** Runs `fn` while holding the single-replica lock; `acquired: false` means another replica has it. */
export interface ResealLock {
  runExclusive<T>(
    fn: () => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false }>;
}

const LOCK_KEY = "platform.credential-reseal";
/** A reseal of a large tenant base is slow on purpose (scrypt per blob): the lock transaction may outlive Prisma's 5 s default. */
const LOCK_TRANSACTION_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * The lock, as a transaction-scoped Postgres advisory lock held by one long interactive transaction:
 * it is released on commit, rollback or a dropped connection, so a crashed replica never leaves it
 * stuck. The row work itself runs on other pooled connections, each in its own tenant scope.
 */
export class PostgresAdvisoryResealLock implements ResealLock {
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async runExclusive<T>(
    fn: () => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false }> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) AS locked`;
        if (rows[0]?.locked !== true) return { acquired: false } as const;
        return { acquired: true, value: await fn() } as const;
      },
      { maxWait: 10_000, timeout: LOCK_TRANSACTION_TIMEOUT_MS },
    );
  }
}

export interface RunCredentialResealDeps {
  readonly plan: CredentialResealPlan;
  readonly lock: ResealLock;
  readonly logger: Logger;
  /** Rows fetched per page (default 50). */
  readonly pageSize?: number;
  /** Reads per row before a row that keeps being changed under us counts as failed (default 3). */
  readonly maxAttempts?: number;
}

export type ResealRunResult =
  { readonly ran: true; readonly report: ResealReport } | { readonly ran: false };

/** The one log line the owner reads after a rotation: `credential reseal: resealed N, skipped N, failed N`. */
function summaryLine(report: ResealReport): string {
  let resealed = 0;
  let skipped = 0;
  let failed = 0;
  for (const counts of Object.values(report)) {
    resealed += counts.resealed;
    skipped += counts.skipped;
    failed += counts.failed;
  }
  return `credential reseal: resealed ${resealed}, skipped ${skipped}, failed ${failed}`;
}

async function resealTarget(
  target: ResealTarget,
  pageSize: number,
  maxAttempts: number,
): Promise<ResealCounts> {
  let resealed = 0;
  let skipped = 0;
  let failed = 0;
  let after: string | undefined;
  for (;;) {
    let page: readonly SealedRowRef[];
    try {
      page = await target.store.listRefs(after, pageSize);
    } catch {
      // The list itself failed: the remaining rows cannot be visited. Counted once, nothing else said.
      failed += 1;
      break;
    }
    if (page.length === 0) break;
    for (const ref of page) {
      let outcome: "resealed" | "unchanged" | "conflict" | "error" = "conflict";
      for (let attempt = 0; attempt < maxAttempts && outcome === "conflict"; attempt += 1) {
        try {
          outcome = await target.store.resealRow(ref, target.rewrap);
        } catch {
          outcome = "error";
        }
      }
      if (outcome === "resealed") resealed += 1;
      else if (outcome === "unchanged") skipped += 1;
      else failed += 1;
    }
    const last = page[page.length - 1];
    if (last === undefined || page.length < pageSize) break;
    after = last.key;
  }
  return { resealed, skipped, failed };
}

/** Walks every target once, under the lock. Counts only, in the log and in the result. */
export async function runCredentialReseal(deps: RunCredentialResealDeps): Promise<ResealRunResult> {
  const pageSize = deps.pageSize ?? 50;
  const maxAttempts = deps.maxAttempts ?? 3;
  const outcome = await deps.lock.runExclusive(async () => {
    const report: Record<string, ResealCounts> = {};
    for (const target of deps.plan.targets) {
      report[target.name] = await resealTarget(target, pageSize, maxAttempts);
    }
    return report;
  });
  if (!outcome.acquired) {
    deps.logger.info("credential reseal: another replica holds the lock, nothing done");
    return { ran: false };
  }
  const failed = Object.values(outcome.value).some((counts) => counts.failed > 0);
  const line = summaryLine(outcome.value);
  if (failed) deps.logger.warn(line, { targets: outcome.value });
  else deps.logger.info(line, { targets: outcome.value });
  return { ran: true, report: outcome.value };
}

/** What the readiness probe reads: the last finished run, if any. */
export interface ResealStatus {
  report: ResealReport | undefined;
}

/**
 * Starts the job in the background (never awaited by boot) and registers a NON-critical readiness
 * probe whose only content is the counts: it reports `degraded` while the last run had failures.
 * Nothing to do when no `PREVIOUS` key is configured (`plan` undefined).
 */
export function startCredentialReseal(deps: {
  readonly plan: CredentialResealPlan | undefined;
  readonly prisma: Database;
  readonly health: Pick<HealthRegistry, "register">;
  readonly logger: Logger;
  readonly lock?: ResealLock;
}): Promise<ResealRunResult> | undefined {
  if (deps.plan === undefined || deps.plan.targets.length === 0) return undefined;
  const status: ResealStatus = { report: undefined };
  deps.health.register({
    name: "credential-reseal",
    critical: false,
    probe: () => {
      if (status.report !== undefined && Object.values(status.report).some((c) => c.failed > 0)) {
        return Promise.reject(new Error(summaryLine(status.report)));
      }
      return Promise.resolve();
    },
  });
  return runCredentialReseal({
    plan: deps.plan,
    lock: deps.lock ?? new PostgresAdvisoryResealLock(deps.prisma),
    logger: deps.logger,
  }).then(
    (result) => {
      if (result.ran) status.report = result.report;
      return result;
    },
    () => {
      // The run itself could not start or finish (e.g. the database was unreachable). No detail is
      // logged: counts only. A later boot tries again; rows stay readable through the previous key.
      status.report = { run: { resealed: 0, skipped: 0, failed: 1 } };
      deps.logger.warn("credential reseal: run did not complete, resealed 0, skipped 0, failed 1");
      return { ran: false } as const;
    },
  );
}
