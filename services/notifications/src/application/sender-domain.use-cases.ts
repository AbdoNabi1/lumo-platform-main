import type { UseCase } from "@platform/application";
import type { Clock } from "@platform/contracts";
import { err, ok, type Result } from "@platform/types";
import {
  BusinessRuleError,
  ConcurrencyError,
  ConflictError,
  DomainError,
  NotFoundError,
  ValidationError,
} from "@platform/utils";
import type {
  NotificationSettingsRepository,
  SenderDomainRepository,
} from "../domain/messaging/messaging-repositories";
import { effectiveNotificationSettings } from "../domain/messaging/notification-settings";
import {
  isValidDomainName,
  SenderDomainTakenError,
  type DnsRecord,
  type SenderDomainStatus,
  type StoredSenderDomain,
} from "../domain/messaging/sender-domain";
import { emailDomain, isFreeMailDomain, isValidEmail } from "../domain/messaging/sender-resolution";
import type { StoreProfilePort } from "./messaging-ports";
import {
  SenderDomainProviderError,
  type ProviderDomain,
  type SenderDomainProvider,
} from "./sender-domain-ports";

/** Shown when another store already has the domain verified. */
export const DOMAIN_USED_BY_ANOTHER_STORE = "This domain is used by another store";

export function freeMailRefusal(domain: string): string {
  return `Emails from ${domain} can't be authenticated. Replies will still reach you.`;
}

/** "The server can't authenticate domains": the presenter maps `NOT_CONFIGURED` to 503. */
export class SenderDomainNotConfiguredError extends DomainError {
  readonly retryable = false;
  constructor() {
    super("Domain authentication isn't available yet", { code: "NOT_CONFIGURED" });
  }
}

/** The email provider failed or refused: the presenter maps `PROVIDER_ERROR` to 502. */
export class SenderDomainProviderFailedError extends DomainError {
  readonly retryable = true;
  constructor(error: SenderDomainProviderError) {
    super(error.message, { code: "PROVIDER_ERROR", cause: error });
  }
}

export interface SenderDomainDeps {
  readonly settings: NotificationSettingsRepository;
  readonly store: StoreProfilePort;
  readonly senderDomains: SenderDomainRepository;
  /** Absent ⇒ domain authentication is "Not available yet" (503); Reply-To mode still works. */
  readonly provider?: SenderDomainProvider;
  readonly clock: Clock;
}

export interface SenderDomainView {
  readonly domain: string;
  readonly status: SenderDomainStatus;
  readonly verified: boolean;
  readonly records: readonly DnsRecord[];
  readonly verifiedAt: string | null;
}

export interface SenderDomainOutput {
  /** false when the server has no provider key: the page says "Not available yet". */
  readonly available: boolean;
  readonly domain: SenderDomainView | null;
  /** The domain the merchant's sender email (else contact email) would authenticate. */
  readonly suggestion: { readonly domain: string; readonly freeMail: boolean } | null;
}

export interface SenderDomainInput {
  readonly tenantId: string;
}

function viewOf(row: StoredSenderDomain): SenderDomainView {
  return {
    domain: row.domain,
    status: row.status,
    verified: row.status === "verified",
    records: row.records.map((record) => ({ ...record })),
    verifiedAt: row.verifiedAt === null ? null : row.verifiedAt.toISOString(),
  };
}

/** The domain of the Sender email, else the contact email: the same pick sender resolution makes. */
async function suggestedDomain(deps: SenderDomainDeps, tenantId: string): Promise<string | null> {
  const [stored, profile] = await Promise.all([
    deps.settings.find(tenantId),
    deps.store.get(tenantId),
  ]);
  const settings = effectiveNotificationSettings(stored);
  const candidate = [settings.senderEmail, profile.contactEmail].find(
    (value): value is string => value !== null && value !== undefined && isValidEmail(value),
  );
  return candidate === undefined ? null : emailDomain(candidate);
}

async function describe(deps: SenderDomainDeps, tenantId: string): Promise<SenderDomainOutput> {
  const [row, domain] = await Promise.all([
    deps.senderDomains.find(tenantId),
    suggestedDomain(deps, tenantId),
  ]);
  return {
    available: deps.provider !== undefined,
    domain: row === null ? null : viewOf(row),
    suggestion: domain === null ? null : { domain, freeMail: isFreeMailDomain(domain) },
  };
}

const STALE = "Your domain setup changed while you were working. Reload and try again.";

/** Reads what is stored: no provider call. Works with no provider key (it just says so). */
export class GetSenderDomain implements UseCase<
  SenderDomainInput,
  SenderDomainOutput,
  DomainError
> {
  private readonly deps: SenderDomainDeps;

  constructor(deps: SenderDomainDeps) {
    this.deps = deps;
  }

  async execute(input: SenderDomainInput): Promise<Result<SenderDomainOutput, DomainError>> {
    return ok(await describe(this.deps, input.tenantId));
  }
}

/**
 * "Authenticate domain": registers the sender email's domain at the provider and keeps the DNS
 * records to show. Idempotent per store + domain. One domain per store in v1: a different domain
 * replaces an UNVERIFIED one, and is refused while the current one is verified.
 */
export class StartSenderDomain implements UseCase<
  SenderDomainInput,
  SenderDomainOutput,
  DomainError
> {
  private readonly deps: SenderDomainDeps;

  constructor(deps: SenderDomainDeps) {
    this.deps = deps;
  }

  async execute(input: SenderDomainInput): Promise<Result<SenderDomainOutput, DomainError>> {
    const { provider, senderDomains } = this.deps;
    if (provider === undefined) return err(new SenderDomainNotConfiguredError());

    const domain = await suggestedDomain(this.deps, input.tenantId);
    if (domain === null || !isValidDomainName(domain)) {
      return err(
        new ValidationError("Add a sender email first, then authenticate its domain", [
          { field: "senderEmail", message: "no usable sender email" },
        ]),
      );
    }
    if (isFreeMailDomain(domain)) return err(new BusinessRuleError(freeMailRefusal(domain)));

    const existing = await senderDomains.find(input.tenantId);
    if (existing?.domain === domain) return ok(await describe(this.deps, input.tenantId));
    if (existing !== null && existing.status === "verified") {
      return err(
        new BusinessRuleError(
          `Your store already sends from ${existing.domain}. Only one domain per store is supported for now.`,
        ),
      );
    }
    if (await senderDomains.isVerifiedByAnotherStore(domain, input.tenantId)) {
      return err(new BusinessRuleError(DOMAIN_USED_BY_ANOTHER_STORE));
    }

    let created: ProviderDomain;
    try {
      created = await provider.create(domain);
    } catch (error) {
      if (error instanceof SenderDomainProviderError) {
        return err(new SenderDomainProviderFailedError(error));
      }
      throw error;
    }
    try {
      await senderDomains.save(
        input.tenantId,
        {
          domain,
          providerDomainId: created.providerDomainId,
          status: created.status,
          records: created.records,
          verifiedAt: created.status === "verified" ? this.deps.clock.now() : null,
        },
        existing === null ? {} : { replacing: existing.domain },
      );
    } catch (error) {
      if (error instanceof SenderDomainTakenError) {
        return err(new BusinessRuleError(DOMAIN_USED_BY_ANOTHER_STORE));
      }
      if (error instanceof ConcurrencyError) return err(new ConflictError(STALE));
      throw error;
    }
    return ok(await describe(this.deps, input.tenantId));
  }
}

/**
 * "Verify": asks the provider to check the DNS records, then reads the status back and stores it.
 * `verified_at` is set when the domain becomes verified and cleared when it stops being so, so
 * sender resolution falls back to Reply-To on its own.
 */
export class VerifySenderDomain implements UseCase<
  SenderDomainInput,
  SenderDomainOutput,
  DomainError
> {
  private readonly deps: SenderDomainDeps;

  constructor(deps: SenderDomainDeps) {
    this.deps = deps;
  }

  async execute(input: SenderDomainInput): Promise<Result<SenderDomainOutput, DomainError>> {
    const { provider, senderDomains } = this.deps;
    if (provider === undefined) return err(new SenderDomainNotConfiguredError());

    const existing = await senderDomains.find(input.tenantId);
    if (existing === null) {
      return err(new NotFoundError("Authenticate a domain first, then verify it"));
    }

    let fresh: ProviderDomain;
    try {
      await provider.verify(existing.providerDomainId);
      fresh = await provider.get(existing.providerDomainId);
    } catch (error) {
      if (error instanceof SenderDomainProviderError) {
        return err(new SenderDomainProviderFailedError(error));
      }
      throw error;
    }

    if (
      fresh.status === "verified" &&
      existing.status !== "verified" &&
      (await senderDomains.isVerifiedByAnotherStore(existing.domain, input.tenantId))
    ) {
      return err(new BusinessRuleError(DOMAIN_USED_BY_ANOTHER_STORE));
    }

    try {
      await senderDomains.save(input.tenantId, {
        domain: existing.domain,
        providerDomainId: existing.providerDomainId,
        status: fresh.status,
        records: fresh.records.length > 0 ? fresh.records : existing.records,
        verifiedAt:
          fresh.status === "verified" ? (existing.verifiedAt ?? this.deps.clock.now()) : null,
      });
    } catch (error) {
      if (error instanceof SenderDomainTakenError) {
        return err(new BusinessRuleError(DOMAIN_USED_BY_ANOTHER_STORE));
      }
      if (error instanceof ConcurrencyError) return err(new ConflictError(STALE));
      throw error;
    }
    return ok(await describe(this.deps, input.tenantId));
  }
}
