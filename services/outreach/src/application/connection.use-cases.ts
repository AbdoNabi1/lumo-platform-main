import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { ConcurrencyError, type DomainError } from "@platform/utils";
import { type WhatsAppConnectionDto, connectionDto } from "./dto";
import type { OutreachDeps } from "./outreach-deps";
import { conflict, emit, isMetaError, metaConflictCode } from "./support";
import { loadActiveConnection } from "./template-support";

export interface TenantInput {
  tenantId: string;
}

const isAvailable = (deps: OutreachDeps): boolean =>
  deps.whatsapp !== undefined && deps.vault !== undefined;

/** The connection as the merchant sees it. `available` says whether the platform has WhatsApp configured at all. */
export class GetWhatsAppConnection implements UseCase<
  TenantInput,
  WhatsAppConnectionDto,
  DomainError
> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(input: TenantInput): Promise<Result<WhatsAppConnectionDto, DomainError>> {
    const row = await this.deps.connections.get(input.tenantId);
    return ok(connectionDto(row, isAvailable(this.deps)));
  }
}

/** Re-reads the phone's quality and tier from Meta. A failure marks the connection `error` with the Meta code only. */
export class RefreshWhatsAppStatus implements UseCase<
  TenantInput,
  WhatsAppConnectionDto,
  DomainError
> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(input: TenantInput): Promise<Result<WhatsAppConnectionDto, DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    const active = await loadActiveConnection(deps, tenantId, { allowError: true });
    if (!active.ok) return active;
    const { token, snapshot } = active.value;
    const whatsapp = deps.whatsapp;
    if (whatsapp === undefined) return err(conflict("WHATSAPP_NOT_CONFIGURED"));

    let failureCode: string | null = null;
    let info: Awaited<ReturnType<typeof whatsapp.getPhone>> | null = null;
    try {
      info = await whatsapp.getPhone(snapshot.phoneNumberId, token);
    } catch (error) {
      if (!isMetaError(error)) throw error;
      failureCode = metaConflictCode(error);
    }

    try {
      return await deps.unitOfWork.run(tenantId, async (tx) => {
        // The snapshot rule on ONE checked row: the status, version, phone and WABA captured before the Meta call must
        // still be the stored ones, and the write CAS-es exactly that captured version (never a version re-read after
        // the check, which a concurrent disconnect or switch could already have bumped).
        const row = await deps.connections.get(tenantId, tx);
        if (
          row === null ||
          row.status !== snapshot.status ||
          row.version !== snapshot.version ||
          row.phoneNumberId !== snapshot.phoneNumberId ||
          row.wabaId !== snapshot.wabaId
        ) {
          return err(conflict("CONNECTION_CHANGED"));
        }
        const now = deps.clock.now();
        if (info === null) {
          await deps.connections.save(
            { ...row, status: "error", lastError: failureCode },
            snapshot.version,
            tx,
          );
          return err(conflict(failureCode ?? "META_ERROR"));
        }
        const next = {
          ...row,
          status: "connected" as const,
          displayPhoneNumber:
            info.displayPhoneNumber === "" ? row.displayPhoneNumber : info.displayPhoneNumber,
          verifiedName: info.verifiedName === "" ? row.verifiedName : info.verifiedName,
          qualityRating: info.qualityRating,
          messagingLimitTier: info.messagingLimitTier,
          lastStatusSyncAt: now,
          lastError: null,
        };
        await deps.connections.save(next, snapshot.version, tx);
        return ok(connectionDto({ ...next, version: snapshot.version + 1 }, true));
      });
    } catch (error) {
      // A lost CAS: a concurrent write moved the row after it was validated. Nothing was written.
      if (error instanceof ConcurrencyError) return err(conflict("CONNECTION_CHANGED"));
      throw error;
    }
  }
}

export interface VersionedTenantInput extends TenantInput {
  expectedVersion: number;
}

/**
 * Disconnects: status `disconnected`, credentials cleared, the directory row removed, `disconnected` emitted.
 * Idempotent when already disconnected; a stale `expectedVersion` has no effect (ConcurrencyError).
 */
export class DisconnectWhatsApp implements UseCase<
  VersionedTenantInput,
  WhatsAppConnectionDto,
  DomainError
> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(input: VersionedTenantInput): Promise<Result<WhatsAppConnectionDto, DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    return deps.unitOfWork.run(tenantId, async (tx) => {
      const row = await deps.connections.get(tenantId, tx);
      if (row === null || row.status === "disconnected") {
        return ok(connectionDto(row, isAvailable(deps)));
      }
      if (row.version !== input.expectedVersion) {
        return err(new ConcurrencyError("The connection changed; reload and try again"));
      }
      const wasLive = row.status === "connected" || row.status === "error";
      const next = {
        ...row,
        status: "disconnected" as const,
        disconnectedAt: deps.clock.now(),
        sealedCredentials: "",
        onboardingAttemptId: null,
        onboardingStage: null,
        onboardingFailure: null,
        onboardingLeaseOwner: null,
        onboardingLeaseUntil: null,
      };
      await deps.connections.save(next, row.version, tx);
      await deps.directory.release(row.phoneNumberId, tenantId, tx);
      if (wasLive) {
        await emit(deps, tx, tenantId, "outreach.whatsapp.disconnected", tenantId, {
          phoneNumberId: row.phoneNumberId,
          wabaId: row.wabaId,
        });
      }
      return ok(connectionDto({ ...next, version: row.version + 1 }, isAvailable(deps)));
    });
  }
}

/**
 * "Cancel setup": the only way out of an onboarding attempt for other assets. Clears the credentials, the stage and the
 * attempt, and sets `disconnected`. A stale `expectedVersion` has no effect; an owner mid-flight loses its next write.
 */
export class AbandonWhatsAppOnboarding implements UseCase<
  VersionedTenantInput,
  WhatsAppConnectionDto,
  DomainError
> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(input: VersionedTenantInput): Promise<Result<WhatsAppConnectionDto, DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    return deps.unitOfWork.run(tenantId, async (tx) => {
      const row = await deps.connections.get(tenantId, tx);
      if (row === null || row.status === "disconnected") {
        return ok(connectionDto(row, isAvailable(deps)));
      }
      if (row.status !== "onboarding") return err(conflict("ONBOARDING_NOT_ACTIVE"));
      if (row.version !== input.expectedVersion) {
        return err(new ConcurrencyError("The connection changed; reload and try again"));
      }
      const next = {
        ...row,
        status: "disconnected" as const,
        disconnectedAt: deps.clock.now(),
        sealedCredentials: "",
        onboardingAttemptId: null,
        onboardingStage: null,
        onboardingFailure: null,
        onboardingLeaseOwner: null,
        onboardingLeaseUntil: null,
      };
      await deps.connections.save(next, row.version, tx);
      return ok(connectionDto({ ...next, version: row.version + 1 }, isAvailable(deps)));
    });
  }
}
