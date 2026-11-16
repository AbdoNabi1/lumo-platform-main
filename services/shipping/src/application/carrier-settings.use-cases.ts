import { createHash, timingSafeEqual } from "node:crypto";
import type { Clock } from "@platform/contracts";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConcurrencyError, type DomainError, ValidationError } from "@platform/utils";
import { CarrierError } from "../domain/errors";
import { MerchantCarrierSettings } from "../domain/merchant-carrier-settings";
import type { MerchantCarrierSettingsRepository } from "../domain/merchant-carrier-settings-repository";
import { isWellFormedCarrierKey } from "../domain/value-objects/carrier-key";
import { WEBHOOK_SECRET_FIELD, webhookVaultKey } from "../infrastructure/tenant-carrier-resolver";
import { carrierFailureOf } from "./carrier-provider";
import type { CarrierCapabilities, CarrierRegistration, CarrierRegistry } from "./carrier-registry";
import type { CarrierCredentialVault } from "./ports";

/** The longest API key or webhook secret accepted or presented (spec §8.1, §9a.1). */
export const MAX_CARRIER_SECRET_LENGTH = 512;

export interface CarrierSettingsEntryDto {
  readonly key: string;
  readonly displayName: string;
  /** a vault is composed (the Task 12 boot guard refuses stub vaults outside local) */
  readonly available: boolean;
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly config: Readonly<Record<string, unknown>> | null;
  readonly capabilities: CarrierCapabilities;
  readonly webhookUrl: string | null;
}

export interface CarrierSettingsDto {
  readonly carriers: readonly CarrierSettingsEntryDto[];
  readonly version: number;
}

export interface EnabledCarriersDto {
  readonly carriers: readonly { readonly key: string; readonly displayName: string }[];
}

export interface UpdateCarrierSettingsInput {
  readonly tenantId: string;
  readonly carrierKey: string;
  readonly enabled?: boolean;
  /** WRITE-ONLY; exactly the registration's credentialFields */
  readonly credentials?: Readonly<Record<string, string>>;
  readonly config?: unknown;
  /** Ruling 28; alone */
  readonly disconnect?: boolean;
}

export interface CarrierSettingsDeps {
  readonly settings: MerchantCarrierSettingsRepository;
  readonly registry: CarrierRegistry;
  readonly vault: CarrierCredentialVault | undefined;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly clock: Clock;
  /** 32 random bytes, base64url */
  readonly randomSecret: () => string;
}

type Failure = Result<never, DomainError>;

function unknownCarrier(): Failure {
  return err(new CarrierError("CARRIER_UNKNOWN", "no such carrier on this platform", 422));
}

function notAvailable(): Failure {
  return err(
    new CarrierError("CARRIER_NOT_AVAILABLE", "carriers are not available on this platform", 409),
  );
}

function notConfigured(): Failure {
  return err(
    new CarrierError("CARRIER_NOT_CONFIGURED", "the merchant has not configured this carrier", 409),
  );
}

const STALE = "Merchant carrier settings changed since they were read";

function sealFailed(): Failure {
  return err(
    new CarrierError("CARRIER_UNAVAILABLE", "the credentials could not be stored securely", 503),
  );
}

/** A registration for a well-formed, registered key; never `Object.prototype` members. */
function registrationFor(
  registry: CarrierRegistry,
  carrierKey: string,
): CarrierRegistration | undefined {
  return isWellFormedCarrierKey(carrierKey) ? registry.get(carrierKey) : undefined;
}

function toDto(
  deps: CarrierSettingsDeps,
  settings: MerchantCarrierSettings | null,
): CarrierSettingsDto {
  return {
    carriers: deps.registry.list().map((registration) => {
      const stored = settings?.carrier(registration.key);
      return {
        key: registration.key,
        displayName: registration.displayName,
        available: deps.vault !== undefined,
        enabled: settings?.isEnabled(registration.key) ?? false,
        configured: stored !== undefined,
        config: stored === undefined ? null : stored.config,
        capabilities: registration.capabilities,
        webhookUrl: registration.webhookUrl,
      };
    }),
    version: settings?.version ?? 0,
  };
}

/** Every carrier's settings for one merchant. Never carries a credential or a webhook secret. */
export class GetCarrierSettings {
  private readonly deps: CarrierSettingsDeps;

  constructor(deps: CarrierSettingsDeps) {
    this.deps = deps;
  }

  async execute(input: { tenantId: string }): Promise<Result<CarrierSettingsDto, DomainError>> {
    const settings = await this.deps.settings.get(input.tenantId);
    return ok(toDto(this.deps, settings));
  }
}

/** The carriers a merchant can ship with right now: enabled, configured and available. */
export class ListEnabledCarriers {
  private readonly deps: CarrierSettingsDeps;

  constructor(deps: CarrierSettingsDeps) {
    this.deps = deps;
  }

  async execute(input: { tenantId: string }): Promise<Result<EnabledCarriersDto, DomainError>> {
    if (this.deps.vault === undefined) return ok({ carriers: [] });
    const settings = await this.deps.settings.get(input.tenantId);
    if (settings === null) return ok({ carriers: [] });
    return ok({
      carriers: this.deps.registry
        .list()
        .filter((registration) => settings.isEnabled(registration.key))
        .map((registration) => ({ key: registration.key, displayName: registration.displayName })),
    });
  }
}

function validCredentials(
  registration: CarrierRegistration,
  raw: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> | null {
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const given = Object.keys(raw);
  const declared = registration.credentialFields;
  if (given.length !== declared.length || !declared.every((field) => Object.hasOwn(raw, field))) {
    return null;
  }
  const trimmed: Record<string, string> = {};
  for (const field of declared) {
    const value = raw[field];
    if (typeof value !== "string") return null;
    const clean = value.trim();
    if (clean.length === 0 || clean.length > MAX_CARRIER_SECRET_LENGTH) return null;
    trimmed[field] = clean;
  }
  return trimmed;
}

/**
 * Updates one carrier's settings (§8.1, Ruling 8). Validation first, then the carrier's own
 * credential check OUTSIDE any transaction, then one version-guarded write (Rulings 28, 29).
 */
export class UpdateCarrierSettings {
  private readonly deps: CarrierSettingsDeps;

  constructor(deps: CarrierSettingsDeps) {
    this.deps = deps;
  }

  async execute(
    input: UpdateCarrierSettingsInput,
  ): Promise<Result<CarrierSettingsDto, DomainError>> {
    const { deps } = this;
    const registration = registrationFor(deps.registry, input.carrierKey);
    if (registration === undefined) return unknownCarrier();
    const vault = deps.vault;
    if (vault === undefined) return notAvailable();

    const disconnect = input.disconnect === true;
    if (
      disconnect &&
      (input.enabled !== undefined || input.credentials !== undefined || input.config !== undefined)
    ) {
      return err(new ValidationError("disconnect can't be combined with other changes"));
    }

    // The pre-read snapshot: whether an entry exists, its config, and the version it had.
    const pre = await deps.settings.get(input.tenantId);
    const preReadVersion = pre?.version ?? 0;
    const preStored = pre?.carrier(registration.key);

    if (disconnect) {
      return this.disconnect(input.tenantId, registration.key, preReadVersion);
    }

    // An omitted config never resets a stored one (plan review 1, finding 2).
    let config: Readonly<Record<string, unknown>>;
    if (input.config === undefined && preStored !== undefined) {
      config = preStored.config;
    } else {
      const parsed = registration.parseConfig(input.config);
      if (!parsed.ok) {
        return err(
          new CarrierError(
            "CARRIER_CONFIG_INVALID",
            "the carrier settings are not valid",
            422,
            parsed.reason,
          ),
        );
      }
      config = parsed.value;
    }

    let credentials: Readonly<Record<string, string>> | null = null;
    if (input.credentials !== undefined) {
      credentials = validCredentials(registration, input.credentials);
      if (credentials === null) {
        return err(
          new CarrierError(
            "CARRIER_CREDENTIALS_INVALID",
            `credentials must be exactly: ${registration.credentialFields.join(", ")}`,
            422,
          ),
        );
      }
    } else if (preStored === undefined) {
      return notConfigured();
    }

    let sealedCredentials: string | undefined;
    let newWebhook: string | undefined;
    if (credentials !== null) {
      const sealed = await this.verifyAndSeal(
        registration,
        vault,
        input.tenantId,
        config,
        credentials,
      );
      if (!("sealed" in sealed)) return sealed;
      sealedCredentials = sealed.sealed;
      if (preStored === undefined) {
        try {
          newWebhook = await vault.seal(input.tenantId, webhookVaultKey(registration.key), {
            [WEBHOOK_SECRET_FIELD]: deps.randomSecret(),
          });
        } catch {
          return sealFailed();
        }
      }
    }

    try {
      await deps.unitOfWork.run(async (tx) => {
        const current =
          (await deps.settings.get(input.tenantId, tx)) ?? MerchantCarrierSettings.empty();
        if (current.version !== preReadVersion) throw new ConcurrencyError(STALE);
        const stored = current.carrier(registration.key);
        if ((stored !== undefined) !== (preStored !== undefined)) throw new ConcurrencyError(STALE);

        let next = current;
        if (sealedCredentials !== undefined) {
          const webhook = stored?.webhook ?? { sealedSecret: newWebhook ?? "" };
          next = next.withCarrier(registration.key, { config, sealedCredentials, webhook });
        } else if (input.config !== undefined && stored !== undefined) {
          next = next.withCarrier(registration.key, { ...stored, config });
        }
        if (input.enabled !== undefined) next = next.withEnabled(registration.key, input.enabled);
        await deps.settings.save(next, input.tenantId, tx);
      });
    } catch (error) {
      if (error instanceof ConcurrencyError || isDomainError(error)) return err(error);
      throw error;
    }

    return ok(toDto(deps, await deps.settings.get(input.tenantId)));
  }

  private async verifyAndSeal(
    registration: CarrierRegistration,
    vault: CarrierCredentialVault,
    tenantId: string,
    config: Readonly<Record<string, unknown>>,
    credentials: Readonly<Record<string, string>>,
  ): Promise<{ readonly sealed: string } | Failure> {
    try {
      await registration.create({ config, credentials, webhookHeaders: {} }).verifyCredentials();
    } catch (error) {
      if (carrierFailureOf(error)?.carrierFailure === "credentials_rejected") {
        return err(
          new CarrierError(
            "CARRIER_CREDENTIALS_REJECTED",
            "the carrier refused these credentials",
            409,
          ),
        );
      }
      return err(
        new CarrierError(
          "CARRIER_UNAVAILABLE",
          "the carrier could not be reached to check the credentials",
          503,
        ),
      );
    }
    try {
      return { sealed: await vault.seal(tenantId, registration.key, credentials) };
    } catch {
      return sealFailed();
    }
  }

  private async disconnect(
    tenantId: string,
    carrierKey: string,
    preReadVersion: number,
  ): Promise<Result<CarrierSettingsDto, DomainError>> {
    const { deps } = this;
    try {
      await deps.unitOfWork.run(async (tx) => {
        const current = (await deps.settings.get(tenantId, tx)) ?? MerchantCarrierSettings.empty();
        if (current.version !== preReadVersion) throw new ConcurrencyError(STALE);
        // Nothing stored and nothing enabled: nothing to write.
        if (
          current.carrier(carrierKey) === undefined &&
          !current.enabledCarriers.includes(carrierKey)
        ) {
          return;
        }
        await deps.settings.save(current.withoutCarrier(carrierKey), tenantId, tx);
      });
    } catch (error) {
      if (error instanceof ConcurrencyError) return err(error);
      throw error;
    }
    return ok(toDto(deps, await deps.settings.get(tenantId)));
  }
}

/** Mints a fresh webhook secret and seals it under its own envelope (Ruling 27). */
export class RotateCarrierWebhookSecret {
  private readonly deps: CarrierSettingsDeps;

  constructor(deps: CarrierSettingsDeps) {
    this.deps = deps;
  }

  async execute(input: {
    tenantId: string;
    carrierKey: string;
  }): Promise<Result<CarrierSettingsDto, DomainError>> {
    const { deps } = this;
    const registration = registrationFor(deps.registry, input.carrierKey);
    if (registration === undefined) return unknownCarrier();
    const vault = deps.vault;
    if (vault === undefined) return notAvailable();

    try {
      const outcome = await deps.unitOfWork.run<Result<null, DomainError>>(async (tx) => {
        const current = await deps.settings.get(input.tenantId, tx);
        if (current === null || current.carrier(registration.key) === undefined) {
          return notConfigured();
        }
        let sealed: string;
        try {
          sealed = await vault.seal(input.tenantId, webhookVaultKey(registration.key), {
            [WEBHOOK_SECRET_FIELD]: deps.randomSecret(),
          });
        } catch {
          return sealFailed();
        }
        const next = current.withRotatedWebhook(registration.key, sealed, deps.clock.now());
        await deps.settings.save(next, input.tenantId, tx);
        return ok(null);
      });
      if (!outcome.ok) return outcome;
    } catch (error) {
      if (error instanceof ConcurrencyError || isDomainError(error)) return err(error);
      throw error;
    }
    return ok(toDto(deps, await deps.settings.get(input.tenantId)));
  }
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Hashing first makes both buffers 32 bytes, so `timingSafeEqual` never sees a length leak. */
function sameSecret(presented: Buffer, candidate: string): boolean {
  return timingSafeEqual(presented, sha256(candidate));
}

/**
 * The webhook gate (§9a.1). Never throws and never says why it refused: a wrong secret, an
 * unknown tenant or carrier, a missing vault and a vault failure all answer `false`.
 */
export class VerifyCarrierWebhook {
  private readonly deps: CarrierSettingsDeps;

  constructor(deps: CarrierSettingsDeps) {
    this.deps = deps;
  }

  async execute(input: {
    tenantId: string;
    carrierKey: string;
    presented: string | undefined;
  }): Promise<boolean> {
    try {
      const { presented } = input;
      if (
        typeof presented !== "string" ||
        presented.length === 0 ||
        presented.length > MAX_CARRIER_SECRET_LENGTH
      ) {
        return false;
      }
      const vault = this.deps.vault;
      if (
        vault === undefined ||
        registrationFor(this.deps.registry, input.carrierKey) === undefined
      ) {
        return false;
      }
      const stored = (await this.deps.settings.get(input.tenantId))?.carrier(input.carrierKey);
      if (stored === undefined) return false;

      const hash = sha256(presented);
      const open = async (sealed: string): Promise<string> => {
        const opened = await vault.open(input.tenantId, webhookVaultKey(input.carrierKey), sealed);
        const secret = Object.hasOwn(opened, WEBHOOK_SECRET_FIELD)
          ? opened[WEBHOOK_SECRET_FIELD]
          : undefined;
        return typeof secret === "string" ? secret : "";
      };

      const current = await open(stored.webhook.sealedSecret);
      let accepted = current.length > 0 && sameSecret(hash, current);

      const { previousSealedSecret, previousValidUntil } = stored.webhook;
      if (
        !accepted &&
        previousSealedSecret !== undefined &&
        previousValidUntil !== undefined &&
        this.deps.clock.now().getTime() < previousValidUntil.getTime()
      ) {
        const previous = await open(previousSealedSecret);
        accepted = previous.length > 0 && sameSecret(hash, previous);
      }
      return accepted;
    } catch {
      return false;
    }
  }
}
