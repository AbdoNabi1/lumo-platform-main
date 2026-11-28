import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { err, ok, type Result } from "@platform/types";
import {
  ConcurrencyError,
  type DomainError,
  type FieldIssue,
  NotFoundError,
  UnexpectedError,
  ValidationError,
  type Logger,
} from "@platform/utils";
import {
  AD_PLATFORMS,
  type AdPlatform,
  Connection,
  PUBLIC_ID_PATTERNS,
  type PublicConfig,
  SECRET_RULE,
  SERVER_PLATFORMS,
  validatePublicConfig,
} from "../domain/connection";
import type { ConnectionRepository } from "../domain/connection-repository";
import { CredentialStorageUnavailableError } from "../domain/errors";
import type { CredentialPolicy, CredentialVaultPort, DeliverySyncPort } from "./ports";

export const SECRET_MESSAGE =
  "must be 10–1024 characters using letters, digits and . _ ~ + / = : | -";
const TEST_EVENT_PLATFORMS: readonly AdPlatform[] = ["meta", "tiktok"];

// ------------------------------------------------------------------------------------- views

export interface ConnectionView {
  readonly platform: AdPlatform;
  readonly enabled: boolean;
  readonly publicConfig: PublicConfig | null;
  readonly secret: { readonly configured: boolean; readonly last4: string | null };
  readonly testEventCode: string | null;
  readonly complete: boolean;
  readonly live: boolean;
  readonly version: number;
}

function toView(connection: Connection): ConnectionView {
  const p = connection.props;
  const configured = p.sealedSecret !== null;
  return {
    platform: p.platform,
    enabled: p.enabled,
    publicConfig: p.publicConfig,
    secret: { configured, last4: configured ? p.secretLast4 : null },
    testEventCode: p.testEventCode,
    complete: connection.isComplete(),
    live: connection.isLive(),
    version: p.version,
  };
}

function emptyView(platform: AdPlatform): ConnectionView {
  return {
    platform,
    enabled: false,
    publicConfig: null,
    secret: { configured: false, last4: null },
    testEventCode: null,
    complete: false,
    live: false,
    version: 0,
  };
}

function invalid(field: string, message: string): Result<never, ValidationError> {
  const issues: FieldIssue[] = [{ field, message }];
  return err(new ValidationError("Invalid ad platform connection", issues));
}

const LOAD_FAILED = "Ad platform connections could not be loaded";
const SAVE_FAILED = "Ad platform connections could not be saved";
const SEAL_FAILED = "Ad platform credentials could not be sealed";
const OPEN_FAILED = "Ad platform credentials could not be opened";

/**
 * Runs one dependency call. A throw or rejection becomes a fixed, cause-free `UnexpectedError`:
 * the original error may carry secrets or request details, so it is neither kept nor logged.
 */
async function guarded<T>(
  operation: () => Promise<T> | T,
  message: string,
): Promise<Result<T, UnexpectedError>> {
  try {
    return ok(await operation());
  } catch {
    return err(new UnexpectedError(message));
  }
}

// ------------------------------------------------------------------------- ListConnections

export class ListConnections implements UseCase<
  { tenantId: string },
  readonly ConnectionView[],
  DomainError
> {
  private readonly deps: { readonly connections: ConnectionRepository };

  constructor(deps: { readonly connections: ConnectionRepository }) {
    this.deps = deps;
  }

  async execute(input: {
    tenantId: string;
  }): Promise<Result<readonly ConnectionView[], DomainError>> {
    const loaded = await guarded(() => this.deps.connections.list(input.tenantId), LOAD_FAILED);
    if (!loaded.ok) return loaded;
    const byPlatform = new Map(loaded.value.map((row) => [row.props.platform, row]));
    return ok(
      AD_PLATFORMS.map((platform) => {
        const row = byPlatform.get(platform);
        return row === undefined ? emptyView(platform) : toView(row);
      }),
    );
  }
}

// ------------------------------------------------------------------------ SaveConnection

export interface SaveConnectionInput {
  readonly tenantId: string;
  readonly platform: AdPlatform;
  readonly enabled: boolean;
  /** Validated by `validatePublicConfig`; null allowed only when `enabled` is false. */
  readonly publicConfig: unknown;
  /** Absent or "" keeps the stored secret. */
  readonly secret?: string;
  /** True removes the stored secret (cannot combine with a non-empty secret). */
  readonly clearSecret?: boolean;
  /** "" or null → none; undefined keeps the stored value; only meta and tiktok accept a value. */
  readonly testEventCode?: string | null;
  /** 0 = row not created yet. */
  readonly expectedVersion: number;
}

export interface SaveConnectionDeps {
  readonly connections: ConnectionRepository;
  readonly vault: CredentialVaultPort;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly credentialPolicy: CredentialPolicy;
  readonly deliverySync?: DeliverySyncPort;
  readonly logger?: Logger;
}

export class SaveConnection implements UseCase<SaveConnectionInput, ConnectionView, DomainError> {
  private readonly deps: SaveConnectionDeps;

  constructor(deps: SaveConnectionDeps) {
    this.deps = deps;
  }

  async execute(input: SaveConnectionInput): Promise<Result<ConnectionView, DomainError>> {
    const { tenantId, platform } = input;
    if (!AD_PLATFORMS.includes(platform)) return invalid("platform", "unknown platform");
    if (input.publicConfig === undefined) return invalid("publicConfig", "is required");
    if (input.enabled && input.publicConfig === null) {
      return invalid("publicConfig", "is required when the platform is enabled");
    }

    let publicConfig: PublicConfig | null = null;
    if (input.publicConfig !== null) {
      const validated = validatePublicConfig(platform, input.publicConfig);
      if (!validated.ok) return validated;
      publicConfig = validated.value;
    }

    const newSecret = input.secret ?? "";
    if (newSecret !== "") {
      if (
        newSecret.length < SECRET_RULE.min ||
        newSecret.length > SECRET_RULE.max ||
        !SECRET_RULE.pattern.test(newSecret)
      ) {
        return invalid("secret", SECRET_MESSAGE);
      }
      if (platform === "google_ads") return invalid("secret", "is not used by this platform");
      if (input.clearSecret === true) {
        return invalid("clearSecret", "cannot be combined with a new secret");
      }
    }

    const testEventInput = input.testEventCode;
    const newTestEventCode =
      testEventInput === undefined ? undefined : testEventInput === "" ? null : testEventInput;
    if (newTestEventCode !== undefined && newTestEventCode !== null) {
      if (!TEST_EVENT_PLATFORMS.includes(platform)) {
        return invalid("testEventCode", "is not used by this platform");
      }
      if (!PUBLIC_ID_PATTERNS.testEventCode.test(newTestEventCode)) {
        return invalid("testEventCode", "invalid value");
      }
    }

    if (
      newSecret !== "" &&
      this.deps.vault.backing === "stub" &&
      this.deps.credentialPolicy === "require_real_vault"
    ) {
      return err(new CredentialStorageUnavailableError());
    }

    const loaded = await guarded(() => this.deps.connections.get(tenantId, platform), LOAD_FAILED);
    if (!loaded.ok) return loaded;
    const existing = loaded.value;
    if ((existing?.props.version ?? 0) !== input.expectedVersion)
      return err(new ConcurrencyError());

    let sealedSecret = existing?.props.sealedSecret ?? null;
    let secretLast4 = existing?.props.secretLast4 ?? null;
    if (newSecret !== "") {
      const sealed = await guarded(
        () => this.deps.vault.seal(tenantId, platform, newSecret),
        SEAL_FAILED,
      );
      if (!sealed.ok) return sealed;
      sealedSecret = sealed.value;
      secretLast4 = newSecret.slice(-4);
    } else if (input.clearSecret === true) {
      sealedSecret = null;
      secretLast4 = null;
    }

    const built = await guarded(() => {
      const now = this.deps.clock.now();
      return Connection.restore({
        id: existing?.props.id ?? this.deps.idGenerator.generate(),
        platform,
        enabled: input.enabled,
        publicConfig,
        sealedSecret,
        secretLast4,
        testEventCode:
          newTestEventCode === undefined
            ? (existing?.props.testEventCode ?? null)
            : newTestEventCode,
        version: input.expectedVersion + 1,
        createdAt: existing?.props.createdAt ?? now,
        updatedAt: now,
      });
    }, SAVE_FAILED);
    if (!built.ok) return built;
    const saved = built.value;
    const stored = await guarded(
      () =>
        this.deps.connections.save(
          tenantId,
          saved,
          existing === null ? null : input.expectedVersion,
        ),
      SAVE_FAILED,
    );
    if (!stored.ok) return stored;
    if (!stored.value) return err(new ConcurrencyError());

    await this.syncDelivery(tenantId);
    return ok(toView(saved));
  }

  private async syncDelivery(tenantId: string): Promise<void> {
    if (this.deps.deliverySync === undefined) return;
    try {
      await this.deps.deliverySync.sync(tenantId);
    } catch {
      // never log the error object: it could carry request details. The next save or the D2 backfill re-syncs.
      try {
        this.deps.logger?.warn("ad platform delivery sync failed", { tenantId });
      } catch {
        // a failing logger must not turn a saved connection into a failure
      }
    }
  }
}

// ---------------------------------------------------------------------- GetLiveConnections

/** Internal (delivery only, never routed): the live connection with its opened secret. */
export interface LiveConnection {
  readonly platform: AdPlatform;
  readonly publicConfig: PublicConfig;
  readonly secret: string | null;
  readonly testEventCode: string | null;
}

export class GetLiveConnections implements UseCase<
  { tenantId: string },
  readonly LiveConnection[],
  DomainError
> {
  private readonly deps: {
    readonly connections: ConnectionRepository;
    readonly vault: CredentialVaultPort;
  };

  constructor(deps: {
    readonly connections: ConnectionRepository;
    readonly vault: CredentialVaultPort;
  }) {
    this.deps = deps;
  }

  async execute(input: {
    tenantId: string;
  }): Promise<Result<readonly LiveConnection[], DomainError>> {
    const loaded = await guarded(() => this.deps.connections.list(input.tenantId), LOAD_FAILED);
    if (!loaded.ok) return loaded;
    const rows = loaded.value;
    const live: LiveConnection[] = [];
    for (const platform of SERVER_PLATFORMS) {
      const row = rows.find((candidate) => candidate.props.platform === platform);
      const p = row?.props;
      if (
        row === undefined ||
        p === undefined ||
        !row.isLive() ||
        p.publicConfig === null ||
        p.sealedSecret === null
      ) {
        continue;
      }
      let secret: string;
      try {
        secret = await this.deps.vault.open(input.tenantId, platform, p.sealedSecret);
      } catch {
        return err(new UnexpectedError(OPEN_FAILED));
      }
      live.push({ platform, publicConfig: p.publicConfig, secret, testEventCode: p.testEventCode });
    }
    return ok(live);
  }
}

// -------------------------------------------------------------------- OpenConnectionSecret

export class OpenConnectionSecret implements UseCase<
  { tenantId: string; platform: AdPlatform },
  string,
  DomainError
> {
  private readonly deps: {
    readonly connections: ConnectionRepository;
    readonly vault: CredentialVaultPort;
  };

  constructor(deps: {
    readonly connections: ConnectionRepository;
    readonly vault: CredentialVaultPort;
  }) {
    this.deps = deps;
  }

  async execute(input: {
    tenantId: string;
    platform: AdPlatform;
  }): Promise<Result<string, DomainError>> {
    const loaded = await guarded(
      () => this.deps.connections.get(input.tenantId, input.platform),
      LOAD_FAILED,
    );
    if (!loaded.ok) return loaded;
    const row = loaded.value;
    if (row === null || !row.isLive() || row.props.sealedSecret === null) {
      return err(new NotFoundError("Ad platform connection not found"));
    }
    try {
      return ok(await this.deps.vault.open(input.tenantId, input.platform, row.props.sealedSecret));
    } catch {
      return err(new UnexpectedError(OPEN_FAILED));
    }
  }
}

// ------------------------------------------------------------------- GetPublicAdPlatforms

export interface PublicAdPlatformsView {
  readonly meta: { readonly pixelId: string } | null;
  readonly tiktok: { readonly pixelCode: string } | null;
  readonly snap: { readonly pixelId: string } | null;
  readonly ga4: { readonly measurementId: string } | null;
  readonly googleAds: {
    readonly conversionId: string;
    readonly labels: { lead?: string; contact?: string; purchase?: string };
  } | null;
}

export class GetPublicAdPlatforms implements UseCase<
  { tenantId: string },
  PublicAdPlatformsView,
  DomainError
> {
  private readonly deps: { readonly connections: ConnectionRepository };

  constructor(deps: { readonly connections: ConnectionRepository }) {
    this.deps = deps;
  }

  async execute(input: { tenantId: string }): Promise<Result<PublicAdPlatformsView, DomainError>> {
    const loaded = await guarded(() => this.deps.connections.list(input.tenantId), LOAD_FAILED);
    if (!loaded.ok) return loaded;
    const rows = loaded.value;
    let view: PublicAdPlatformsView = {
      meta: null,
      tiktok: null,
      snap: null,
      ga4: null,
      googleAds: null,
    };
    for (const row of rows) {
      const config = row.props.publicConfig;
      if (!row.props.enabled || config === null) continue;
      switch (config.platform) {
        case "meta":
          view = { ...view, meta: { pixelId: config.pixelId } };
          break;
        case "tiktok":
          view = { ...view, tiktok: { pixelCode: config.pixelCode } };
          break;
        case "snap":
          view = { ...view, snap: { pixelId: config.pixelId } };
          break;
        case "ga4":
          view = { ...view, ga4: { measurementId: config.measurementId } };
          break;
        case "google_ads":
          view = {
            ...view,
            googleAds: { conversionId: config.conversionId, labels: { ...config.labels } },
          };
          break;
      }
    }
    return ok(view);
  }
}
