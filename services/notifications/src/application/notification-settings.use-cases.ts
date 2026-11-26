import type { UseCase } from "@platform/application";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConcurrencyError, ConflictError, type DomainError } from "@platform/utils";
import {
  effectiveNotificationSettings,
  SETTINGS_STALE_MESSAGE,
  validateNotificationSettings,
  type NotificationSettingsValues,
} from "../domain/messaging/notification-settings";
import type { SenderMode } from "../domain/messaging/sender-resolution";
import { isFreeMailAddress, loadSenderContext, type SenderContextDeps } from "./messaging-support";

export interface NotificationSettingsDeps extends SenderContextDeps {
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  /** Whether the runtime really delivers email (D40). */
  readonly deliveryConfigured: boolean;
}

/** How the store's mail will look to customers, so the page can say it in a sentence. */
export interface SenderSummary {
  readonly mode: SenderMode;
  /** The merchant address in effect: the Sender email, else the store contact email. */
  readonly effectiveEmail: string | null;
  /** A free-mail address can never be authenticated, so it is always Reply-To. */
  readonly freeMail: boolean;
}

export interface NotificationSettingsOutput {
  readonly values: NotificationSettingsValues;
  /** null while the shop has never saved any. */
  readonly version: number | null;
  readonly deliveryConfigured: boolean;
  readonly storeName: string;
  readonly contactEmail: string | null;
  readonly sender: SenderSummary;
}

async function describe(
  deps: NotificationSettingsDeps,
  tenantId: string,
): Promise<NotificationSettingsOutput> {
  const [stored, context] = await Promise.all([
    deps.settings.find(tenantId),
    loadSenderContext(deps, tenantId),
  ]);
  return {
    values: effectiveNotificationSettings(stored),
    version: stored?.version ?? null,
    deliveryConfigured: deps.deliveryConfigured,
    storeName: context.profile.storeName,
    contactEmail: context.profile.contactEmail,
    sender: {
      mode: context.sender.mode,
      effectiveEmail: context.sender.effectiveEmail,
      freeMail: isFreeMailAddress(context.sender.effectiveEmail),
    },
  };
}

export interface GetNotificationSettingsInput {
  readonly tenantId: string;
}

/** Reads the shop's notification settings; a shop that never saved any gets the defaults. */
export class GetNotificationSettings implements UseCase<
  GetNotificationSettingsInput,
  NotificationSettingsOutput,
  DomainError
> {
  private readonly deps: NotificationSettingsDeps;

  constructor(deps: NotificationSettingsDeps) {
    this.deps = deps;
  }

  async execute(
    input: GetNotificationSettingsInput,
  ): Promise<Result<NotificationSettingsOutput, DomainError>> {
    return ok(await describe(this.deps, input.tenantId));
  }
}

export interface UpdateNotificationSettingsInput {
  readonly tenantId: string;
  /** The version the page loaded; null when it loaded the defaults (no row yet). */
  readonly expectedVersion: number | null;
  readonly values: unknown;
}

/** Saves the whole settings document; a stale `expectedVersion` is a CONFLICT, never an overwrite. */
export class UpdateNotificationSettings implements UseCase<
  UpdateNotificationSettingsInput,
  NotificationSettingsOutput,
  DomainError
> {
  private readonly deps: NotificationSettingsDeps;

  constructor(deps: NotificationSettingsDeps) {
    this.deps = deps;
  }

  async execute(
    input: UpdateNotificationSettingsInput,
  ): Promise<Result<NotificationSettingsOutput, DomainError>> {
    const values = validateNotificationSettings(input.values);
    if (!values.ok) return err(values.error);

    // The race (a unique violation on a second first save, or a version that moved) is mapped OUTSIDE
    // the unit of work, never swallowed inside it: on Postgres the failed insert has already aborted
    // the transaction, so returning normally would make the unit of work try to COMMIT an aborted
    // transaction and answer 500. Letting the error leave the callback rolls it back first.
    try {
      const stale = await this.deps.unitOfWork.run<Result<true, DomainError>>(async (tx) => {
        const stored = await this.deps.settings.find(input.tenantId, tx);
        if ((stored?.version ?? null) !== input.expectedVersion) {
          return err(new ConflictError(SETTINGS_STALE_MESSAGE));
        }
        await this.deps.settings.save(input.tenantId, values.value, input.expectedVersion, tx);
        return ok(true);
      });
      if (!stale.ok) return err(stale.error);
    } catch (error) {
      if (error instanceof ConcurrencyError) return err(new ConflictError(SETTINGS_STALE_MESSAGE));
      throw error;
    }
    return ok(await describe(this.deps, input.tenantId));
  }
}
