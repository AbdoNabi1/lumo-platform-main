import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { ConcurrencyError, type DomainError, ValidationError } from "@platform/utils";
import type { OnboardingStage, WhatsAppConnectionRecord } from "../domain/repositories";
import { type WhatsAppConnectionDto, connectionDto } from "./dto";
import type { OutreachDeps } from "./outreach-deps";
import type { WhatsAppPhoneInfo } from "./ports";
import {
  conflict,
  conflictErr,
  emit,
  isMetaError,
  metaConflictCode,
  safeCode,
  type MetaErrorLike,
} from "./support";
import { openSecrets } from "./template-support";

export interface ConnectWhatsAppInput {
  tenantId: string;
  code: string;
  wabaId: string;
  phoneNumberId: string;
}

/** Longer than the worst case of Meta timeouts in one connect (10 s × the six calls). */
export const ONBOARDING_LEASE_MS = 120_000;
const PIN_PATTERN = /^[0-9]{6}$/;
/** Meta's "two-step verification PIN mismatch": the number already carries a PIN we do not hold. */
const PIN_MISMATCH_CODE = "133005";

type Kind = "resume" | "reconnect" | "new";

interface Lease {
  tenantId: string;
  owner: string;
  attemptId: string;
  /** The assets the row carries right now (they change once, at the start write of an asset switch). */
  phoneNumberId: string;
  wabaId: string;
}

class LeaseLost extends Error {}
class NotClaimed extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type MetaResult<T> = { ok: true; value: T } | { ok: false; error: MetaErrorLike & Error };

async function meta<T>(call: () => Promise<T>): Promise<MetaResult<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    if (isMetaError(error)) return { ok: false, error };
    throw error;
  }
}

const sameAssets = (row: WhatsAppConnectionRecord, phone: string, waba: string): boolean =>
  row.phoneNumberId === phone && row.wabaId === waba;

/**
 * Connects a WhatsApp Business account (Embedded Signup result). The persisted row is classified FIRST and the
 * onboarding lease is the first step, before any Meta call (round 4):
 *
 * - resume: an `onboarding` row for the same assets continues at its first incomplete stage;
 * - reconnect: a connected row for the same assets re-verifies with the SAME sealed PIN;
 * - new: no row / disconnected / connected for different assets starts a fresh attempt with a new PIN;
 * - blocked: an `onboarding` row for DIFFERENT assets needs "Cancel setup" first.
 *
 * Every later write is owner-checked (lease owner + attempt + version CAS). A failure records the Meta code but never
 * resets the stage or the PIN; only a confirmed 2xx advances a stage. The PIN registered with Meta is never lost:
 * `registering` recovery is one explicit same-PIN call per resume.
 */
export class ConnectWhatsApp implements UseCase<
  ConnectWhatsAppInput,
  WhatsAppConnectionDto,
  DomainError
> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(input: ConnectWhatsAppInput): Promise<Result<WhatsAppConnectionDto, DomainError>> {
    const { deps } = this;
    const { whatsapp, vault } = deps;
    if (whatsapp === undefined || vault === undefined)
      return conflictErr("WHATSAPP_NOT_CONFIGURED");
    const issues = (["code", "wabaId", "phoneNumberId"] as const)
      .filter(
        (f) => typeof input[f] !== "string" || input[f].trim() === "" || input[f].length > 256,
      )
      .map((field) => ({ field, message: "required" }));
    if (issues.length > 0) return err(new ValidationError("Invalid connection input", issues));

    const { tenantId } = input;
    const phone = input.phoneNumberId.trim();
    const waba = input.wabaId.trim();
    const owner = deps.idGenerator.generate();

    // 1. Lease first.
    const acquired = await this.acquire(tenantId, phone, waba, owner);
    if (!acquired.ok) return acquired;
    const { kind, prior } = acquired.value;
    // An asset switch on a live connection keeps the OLD assets on the row until the start write.
    const switchingLive =
      kind === "new" &&
      prior !== null &&
      (prior.status === "connected" || prior.status === "error");
    const lease: Lease = {
      tenantId,
      owner,
      attemptId: acquired.value.attemptId,
      phoneNumberId: switchingLive && prior !== null ? prior.phoneNumberId : phone,
      wabaId: switchingLive && prior !== null ? prior.wabaId : waba,
    };

    const stop = (): Result<never, DomainError> => conflictErr("CONNECTION_CHANGED");
    const fail = async (code: string): Promise<Result<never, DomainError>> => {
      const released = await this.write(lease, () => ({ onboardingFailure: safeCode(code) }), {
        release: true,
      });
      return released === "lost" ? stop() : conflictErr(code);
    };

    const stageAtStart: OnboardingStage | null =
      kind === "resume" ? (prior?.onboardingStage ?? null) : null;
    // The PIN is known (and must be kept) once it may have been registered with Meta.
    const pinMayBeRegistered =
      kind === "reconnect" ||
      (kind === "resume" && (stageAtStart === "registering" || stageAtStart === "registered"));
    const sealedSecrets =
      (kind === "resume" || kind === "reconnect") &&
      prior !== null &&
      prior.sealedCredentials !== ""
        ? await openSecrets(deps, tenantId, prior.sealedCredentials)
        : null;
    if (pinMayBeRegistered && (sealedSecrets === null || !PIN_PATTERN.test(sealedSecrets.pin))) {
      return fail("CREDENTIALS_UNAVAILABLE");
    }

    // 2. Exchange the fresh code. A resume may continue with its sealed token when the code is unusable.
    const exchanged = await meta(() => whatsapp.exchangeCode(input.code.trim()));
    let token: string;
    if (exchanged.ok) token = exchanged.value.accessToken;
    else if (kind === "resume" && sealedSecrets !== null) token = sealedSecrets.accessToken;
    else return fail(metaConflictCode(exchanged.error));

    // 3. The phone must belong to the WABA.
    const members = await meta(() => whatsapp.listPhoneNumberIds(waba, token));
    if (!members.ok) return fail(metaConflictCode(members.error));
    if (!members.value.includes(phone)) return fail("META_ASSET_MISMATCH");

    // 4. Persist the attempt (sealed token + PIN) before any remote mutation.
    let pin: string;
    let stage: OnboardingStage;
    if (
      kind === "resume" &&
      sealedSecrets !== null &&
      PIN_PATTERN.test(sealedSecrets.pin) &&
      stageAtStart !== null
    ) {
      pin = sealedSecrets.pin;
      stage = stageAtStart;
      if (exchanged.ok) {
        const sealed = await this.seal(tenantId, token, pin);
        if (sealed === null) return fail("CREDENTIALS_UNAVAILABLE");
        const resealed = await this.write(lease, () => ({ sealedCredentials: sealed }));
        if (resealed === "lost") return stop();
      }
    } else {
      pin = kind === "reconnect" && sealedSecrets !== null ? sealedSecrets.pin : deps.randomPin();
      if (!PIN_PATTERN.test(pin)) return fail("ONBOARDING_PIN_INVALID");
      const sealed = await this.seal(tenantId, token, pin);
      if (sealed === null) return fail("CREDENTIALS_UNAVAILABLE");
      const started = await this.write(
        lease,
        (row) => ({
          status: kind === "reconnect" ? row.status : ("onboarding" as const),
          phoneNumberId: phone,
          wabaId: waba,
          sealedCredentials: sealed,
          onboardingStage: "verified" as const,
          ...(kind === "reconnect"
            ? {}
            : { displayPhoneNumber: null, verifiedName: null, connectedAt: null }),
        }),
        {
          extra: async (tx) => {
            // Asset switch: the old phone stops receiving this shop's traffic at once.
            if (switchingLive && prior !== null) {
              await deps.directory.release(prior.phoneNumberId, tenantId, tx);
            }
          },
        },
      );
      if (started === "lost") return stop();
      lease.phoneNumberId = phone;
      lease.wabaId = waba;
      stage = "verified";
    }

    // 5. Stage machine: continue at the first incomplete step.
    if (stage === "verified") {
      if ((await this.write(lease, () => ({}))) === "lost") return stop();
      const subscribed = await meta(() => whatsapp.subscribeApp(waba, token));
      if (!subscribed.ok) return fail(metaConflictCode(subscribed.error));
      if (
        (await this.write(lease, () => ({ onboardingStage: "subscribed" as const }))) === "lost"
      ) {
        return stop();
      }
      stage = "subscribed";
    }
    if (stage === "subscribed") {
      // The stage is persisted BEFORE the register call, so an interrupted call is recoverable.
      if (
        (await this.write(lease, () => ({ onboardingStage: "registering" as const }))) === "lost"
      ) {
        return stop();
      }
      stage = "registering";
    } else if (stage === "registering") {
      if ((await this.write(lease, () => ({}))) === "lost") return stop();
    }
    if (stage === "registering") {
      const registered = await meta(() => whatsapp.registerPhone(phone, pin, token));
      if (!registered.ok) {
        // A PIN mismatch means the number carries a PIN we do not hold: only the merchant can fix that.
        return fail(
          registered.error.code === PIN_MISMATCH_CODE
            ? "ONBOARDING_RECONCILIATION_REQUIRED"
            : metaConflictCode(registered.error),
        );
      }
      if (
        (await this.write(lease, () => ({ onboardingStage: "registered" as const }))) === "lost"
      ) {
        return stop();
      }
      stage = "registered";
    }

    // 6. Read the phone, then finalize.
    const phoneInfo = await meta(() => whatsapp.getPhone(phone, token));
    if (!phoneInfo.ok) return fail(metaConflictCode(phoneInfo.error));
    return this.finalize(lease, phoneInfo.value, prior);
  }

  /** One transaction: classify the persisted row, enforce the directory precheck and take (or refuse) the lease. */
  private async acquire(
    tenantId: string,
    phone: string,
    waba: string,
    owner: string,
  ): Promise<
    Result<{ kind: Kind; prior: WhatsAppConnectionRecord | null; attemptId: string }, DomainError>
  > {
    const { deps } = this;
    try {
      return await deps.unitOfWork.run(async (tx) => {
        const now = deps.clock.now();
        const row = await deps.connections.get(tenantId, tx);
        const byPhone = await deps.directory.find(phone, tx);
        if (byPhone !== null && byPhone.shopTenantId !== tenantId)
          return conflictErr("PHONE_IN_USE");
        const byWaba = await deps.directory.findByWaba(waba, tx);
        if (byWaba !== null && byWaba.shopTenantId !== tenantId) return conflictErr("WABA_IN_USE");

        const same = row !== null && sameAssets(row, phone, waba);
        if (row !== null && row.status === "onboarding" && !same) {
          return conflictErr("ONBOARDING_RECONCILIATION_REQUIRED");
        }
        if (row !== null && row.onboardingLeaseUntil !== null && row.onboardingLeaseUntil > now) {
          return conflictErr("ONBOARDING_IN_PROGRESS");
        }
        const live = row !== null && (row.status === "connected" || row.status === "error");
        const kind: Kind =
          row !== null && row.status === "onboarding" && same
            ? "resume"
            : live && same
              ? "reconnect"
              : "new";
        const leaseUntil = new Date(now.getTime() + ONBOARDING_LEASE_MS);
        const attemptId =
          kind === "resume" && row?.onboardingAttemptId
            ? row.onboardingAttemptId
            : deps.idGenerator.generate();
        const leaseFields = {
          onboardingLeaseOwner: owner,
          onboardingLeaseUntil: leaseUntil,
          onboardingFailure: null,
        };
        if (row === null || (kind === "new" && row.status === "disconnected")) {
          // The row is created already holding the lease; the credentials follow once the token is exchanged.
          const fresh: WhatsAppConnectionRecord = {
            tenantId,
            status: "onboarding",
            wabaId: waba,
            phoneNumberId: phone,
            displayPhoneNumber: null,
            verifiedName: null,
            qualityRating: null,
            messagingLimitTier: null,
            sealedCredentials: "",
            connectedAt: null,
            disconnectedAt: row?.disconnectedAt ?? null,
            lastStatusSyncAt: null,
            lastError: null,
            onboardingAttemptId: attemptId,
            onboardingStage: null,
            ...leaseFields,
            version: 1,
          };
          await deps.connections.save(fresh, row === null ? 0 : row.version, tx);
        } else if (kind === "resume") {
          await deps.connections.save(
            { ...row, ...leaseFields, onboardingAttemptId: attemptId },
            row.version,
            tx,
          );
        } else if (kind === "reconnect") {
          await deps.connections.save(
            { ...row, ...leaseFields, onboardingAttemptId: attemptId, onboardingStage: "verified" },
            row.version,
            tx,
          );
        } else {
          // connected / error for DIFFERENT assets: the lease is taken in place; the live connection stays usable
          // until the start write switches it.
          await deps.connections.save(
            { ...row, ...leaseFields, onboardingAttemptId: attemptId },
            row.version,
            tx,
          );
        }
        return ok({ kind, prior: row, attemptId });
      });
    } catch (error) {
      // A lost version CAS means another caller took the row first.
      if (error instanceof ConcurrencyError) return conflictErr("ONBOARDING_IN_PROGRESS");
      throw error;
    }
  }

  private async seal(tenantId: string, token: string, pin: string): Promise<string | null> {
    try {
      return (
        (await this.deps.vault?.seal(tenantId, "whatsapp", { accessToken: token, pin })) ?? null
      );
    } catch {
      return null;
    }
  }

  /**
   * An owner-checked write: the caller must still hold an unexpired lease (owner + attempt + assets) and the version
   * CAS must hold. Renews the lease unless `release` is set (then both lease fields are cleared in the same write).
   */
  private async write(
    lease: Lease,
    patch: (row: WhatsAppConnectionRecord) => Partial<WhatsAppConnectionRecord>,
    opts: { release?: boolean; extra?: (tx: unknown) => Promise<void> } = {},
  ): Promise<WhatsAppConnectionRecord | "lost"> {
    const { deps } = this;
    try {
      return await deps.unitOfWork.run(async (tx) => {
        const row = await deps.connections.get(lease.tenantId, tx);
        if (!this.holds(row, lease)) throw new LeaseLost();
        const now = deps.clock.now();
        const next: WhatsAppConnectionRecord = {
          ...row,
          ...patch(row),
          onboardingLeaseOwner: opts.release === true ? null : lease.owner,
          onboardingLeaseUntil:
            opts.release === true ? null : new Date(now.getTime() + ONBOARDING_LEASE_MS),
        };
        await deps.connections.save(next, row.version, tx);
        if (opts.extra !== undefined) await opts.extra(tx);
        return { ...next, version: row.version + 1 };
      });
    } catch (error) {
      if (error instanceof LeaseLost || error instanceof ConcurrencyError) return "lost";
      throw error;
    }
  }

  private holds(
    row: WhatsAppConnectionRecord | null,
    lease: Lease,
  ): row is WhatsAppConnectionRecord {
    return (
      row !== null &&
      row.onboardingLeaseOwner === lease.owner &&
      row.onboardingLeaseUntil !== null &&
      row.onboardingLeaseUntil > this.deps.clock.now() &&
      row.onboardingAttemptId === lease.attemptId &&
      sameAssets(row, lease.phoneNumberId, lease.wabaId)
    );
  }

  /** CAS to `connected`, claim the directory, emit. A non-claim rolls the whole transaction back. */
  private async finalize(
    lease: Lease,
    info: WhatsAppPhoneInfo,
    prior: WhatsAppConnectionRecord | null,
  ): Promise<Result<WhatsAppConnectionDto, DomainError>> {
    const { deps } = this;
    const { tenantId, phoneNumberId, wabaId } = lease;
    try {
      const done = await deps.unitOfWork.run(async (tx) => {
        const row = await deps.connections.get(tenantId, tx);
        if (!this.holds(row, lease)) throw new LeaseLost();
        const now = deps.clock.now();
        const previousConnectedAt =
          prior !== null &&
          (prior.status === "connected" || prior.status === "error") &&
          sameAssets(prior, phoneNumberId, wabaId)
            ? prior.connectedAt
            : null;
        const next: WhatsAppConnectionRecord = {
          ...row,
          status: "connected",
          displayPhoneNumber: info.displayPhoneNumber,
          verifiedName: info.verifiedName,
          qualityRating: info.qualityRating,
          messagingLimitTier: info.messagingLimitTier,
          // The first connect time survives a same-asset refresh.
          connectedAt: previousConnectedAt ?? now,
          lastStatusSyncAt: now,
          lastError: null,
          onboardingStage: "registered",
          onboardingFailure: null,
          onboardingLeaseOwner: null,
          onboardingLeaseUntil: null,
        };
        await deps.connections.save(next, row.version, tx);
        const claim = await deps.directory.claim(phoneNumberId, wabaId, tenantId, tx);
        if (claim !== "claimed") {
          throw new NotClaimed(claim === "phone_in_use" ? "PHONE_IN_USE" : "WABA_IN_USE");
        }
        await emit(deps, tx, tenantId, "outreach.whatsapp.connected", tenantId, {
          phoneNumberId,
          wabaId,
          displayPhoneNumber: info.displayPhoneNumber,
        });
        return { ...next, version: row.version + 1 };
      });
      return ok(connectionDto(done, true));
    } catch (error) {
      if (error instanceof NotClaimed) {
        // The transaction (including any release done by the claim) is rolled back; keep the resumable row.
        const recorded = await this.write(lease, () => ({ onboardingFailure: error.code }), {
          release: true,
        });
        return recorded === "lost" ? conflictErr("CONNECTION_CHANGED") : err(conflict(error.code));
      }
      if (error instanceof LeaseLost || error instanceof ConcurrencyError) {
        return conflictErr("CONNECTION_CHANGED");
      }
      throw error;
    }
  }
}
