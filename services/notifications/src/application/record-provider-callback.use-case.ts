import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { NotificationRepository } from "../domain/notification-repository";
import type { ProcessedProviderCallbackStore } from "./ports";

export interface RecordProviderCallbackInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
  readonly notificationId: string;
  readonly provider: string;
  readonly callbackId: string;
  readonly kind: string;
}

export interface RecordProviderCallbackOutput {
  readonly notificationId: string;
  readonly status: string;
  readonly duplicate: boolean;
}

export interface RecordProviderCallbackDeps {
  readonly notifications: NotificationRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly processedProviderCallbacks: ProcessedProviderCallbackStore;
}

/** Records a provider callback idempotently (`ProcessedProviderCallbackStore`, replay-safe) — a `delivered` kind maps to a validated transition. */
export class RecordProviderCallback implements UseCase<
  RecordProviderCallbackInput,
  RecordProviderCallbackOutput,
  DomainError
> {
  private readonly deps: RecordProviderCallbackDeps;

  constructor(deps: RecordProviderCallbackDeps) {
    this.deps = deps;
  }

  async execute(
    input: RecordProviderCallbackInput,
  ): Promise<Result<RecordProviderCallbackOutput, DomainError>> {
    const provider = Guard.againstEmpty(input.provider, "provider");
    if (!provider.ok) return err(provider.error);
    const callbackId = Guard.againstEmpty(input.callbackId, "callbackId");
    if (!callbackId.ok) return err(callbackId.error);

    return this.deps.unitOfWork.run<Result<RecordProviderCallbackOutput, DomainError>>(
      async (tx) => {
        const notification = await this.deps.notifications.findById(
          input.notificationId,
          input.tenantId,
          tx,
        );
        if (notification === null) {
          return err(new NotFoundError("Notification not found"));
        }

        const alreadyProcessed = await this.deps.processedProviderCallbacks.hasProcessed(
          input.provider,
          input.callbackId,
          input.tenantId,
        );
        if (alreadyProcessed) {
          return ok({
            notificationId: notification.id.toString(),
            status: notification.status.value,
            duplicate: true,
          });
        }

        if (input.kind === "delivered") {
          try {
            notification.markDelivered(this.deps.idGenerator.generate(), this.deps.clock.now());
          } catch (error) {
            if (isDomainError(error)) return err(error);
            throw error;
          }
          await this.deps.notifications.save(notification, input.tenantId, tx);
        }

        await this.deps.processedProviderCallbacks.markProcessed(
          input.provider,
          input.callbackId,
          input.tenantId,
        );
        return ok({
          notificationId: notification.id.toString(),
          status: notification.status.value,
          duplicate: false,
        });
      },
    );
  }
}
