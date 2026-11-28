/**
 * Postgres adapter for the per-store tracking settings (Tracking P2-D1): `tracking.store_tracking_settings`.
 *
 * The table is RLS-forced. Every statement runs in ONE short tenant-scoped transaction (`app.tenant_id` set first by
 * `runReadScoped` / `runInTenantTransaction`) and names the tenant in its `where` as well, so the application filter
 * and the policy agree. One row per tenant:
 *
 * - a first save (`expectedVersion` 0) is `createMany … skipDuplicates` — two first saves racing leave one row and the
 *   loser sees `null` (a conflict), never a unique-violation error;
 * - a later save is `updateMany where { tenantId, version: expectedVersion }` setting `version = expectedVersion + 1`;
 *   zero rows updated is `null` (a conflict) — an overwrite of a newer save is impossible by construction.
 *
 * A stored policy this code does not know (a hand-edited row) is an error here, not a guess: the service falls back
 * to `notice_only` on the event path and surfaces the error on the admin read.
 */

import { runInTenantTransaction, runReadScoped, type Database } from "@platform/db";
import {
  CONSENT_POLICIES,
  type ConsentPolicy,
  type TrackingSettingsSave,
  type TrackingSettingsStore,
  type TrackingStoreSettings,
} from "@platform/tracking";

interface SettingsRow {
  readonly tenantId: string;
  readonly consentPolicy: string;
  readonly cookieNoticeEnabled: boolean;
  readonly version: number;
  readonly updatedAt: Date;
}

function policyOf(value: string): ConsentPolicy {
  const known = CONSENT_POLICIES.find((policy) => policy === value);
  if (known === undefined) throw new Error("tracking settings: unknown consent_policy in the row");
  return known;
}

function toSettings(row: SettingsRow): TrackingStoreSettings {
  return {
    tenantId: row.tenantId,
    consentPolicy: policyOf(row.consentPolicy),
    cookieNoticeEnabled: row.cookieNoticeEnabled,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PrismaTrackingStoreSettingsStore implements TrackingSettingsStore {
  constructor(private readonly db: Database) {}

  get(tenantId: string): Promise<TrackingStoreSettings | null> {
    return runReadScoped(this.db, tenantId, async (tx) => {
      const row = await tx.trackingStoreSettings.findFirst({ where: { tenantId } });
      return row === null ? null : toSettings(row);
    });
  }

  save(input: TrackingSettingsSave): Promise<TrackingStoreSettings | null> {
    const { tenantId, expectedVersion } = input;
    const updatedAt = new Date(input.updatedAt);
    return runInTenantTransaction(this.db, tenantId, async (tx) => {
      if (expectedVersion === 0) {
        const inserted = await tx.trackingStoreSettings.createMany({
          data: [
            {
              tenantId,
              consentPolicy: input.consentPolicy,
              cookieNoticeEnabled: input.cookieNoticeEnabled,
              version: 1,
              updatedAt,
            },
          ],
          skipDuplicates: true,
        });
        if (inserted.count === 0) return null;
      } else {
        const updated = await tx.trackingStoreSettings.updateMany({
          where: { tenantId, version: expectedVersion },
          data: {
            consentPolicy: input.consentPolicy,
            cookieNoticeEnabled: input.cookieNoticeEnabled,
            version: expectedVersion + 1,
            updatedAt,
          },
        });
        if (updated.count === 0) return null;
      }
      const row = await tx.trackingStoreSettings.findFirst({ where: { tenantId } });
      return row === null ? null : toSettings(row);
    });
  }
}
