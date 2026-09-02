import type { BackupConfig } from "@platform/config/server";

export interface BackupPlan {
  readonly enabled: boolean;
  /** Cron expression for scheduled base backups. */
  readonly schedule: string;
  readonly retentionDays: number;
  readonly bucket: string;
  /** PostgreSQL PITR (WAL archiving) + scheduled base backups (docs/architecture/15 §2.5). */
  readonly strategy: "pitr+base";
}

/**
 * Derives the backup plan from configuration. Backup *execution* (WAL archiving + base
 * backups to object storage, restore drills) is operated outside the application per
 * docs/architecture/15; this exposes the configuration the operator tooling consumes.
 */
export function resolveBackupPlan(config: BackupConfig): BackupPlan {
  return {
    enabled: config.enabled,
    schedule: config.schedule,
    retentionDays: config.retentionDays,
    bucket: config.bucket,
    strategy: "pitr+base",
  };
}
