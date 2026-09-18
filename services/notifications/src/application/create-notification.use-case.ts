import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import { DeliveryPolicy } from "../domain/value-objects/delivery-policy";
import { NotificationChannel } from "../domain/value-objects/notification-channel";
import { NotificationTemplate } from "../domain/value-objects/notification-template";
import { Recipient } from "../domain/value-objects/recipient";
import { Notification } from "../domain/notification";
import type { NotificationRepository } from "../domain/notification-repository";

export interface CreateNotificationInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly sourceRef: string;
  readonly recipientRef: string;
  readonly channels: readonly string[];
  readonly templateId: string;
  readonly bodyPattern: string;
  readonly subjectPattern?: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly maxAttempts: number;
  readonly expiresAt?: Date;
}

export interface NotificationStatusOutput {
  readonly notificationId: string;
  readonly status: string;
}

export interface CreateNotificationDeps {
  readonly notifications: NotificationRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Opens a notification for delivery — idempotent by `idempotencyKey` (a replay returns the already-created notification, never a duplicate). */
export class CreateNotification implements UseCase<
  CreateNotificationInput,
  NotificationStatusOutput,
  DomainError
> {
  private readonly deps: CreateNotificationDeps;

  constructor(deps: CreateNotificationDeps) {
    this.deps = deps;
  }

  async execute(
    input: CreateNotificationInput,
  ): Promise<Result<NotificationStatusOutput, DomainError>> {
    const idempotencyKey = Guard.againstEmpty(input.idempotencyKey, "idempotencyKey");
    if (!idempotencyKey.ok) return err(idempotencyKey.error);
    const sourceRef = Guard.againstEmpty(input.sourceRef, "sourceRef");
    if (!sourceRef.ok) return err(sourceRef.error);
    if (input.channels.length === 0) {
      return err(
        new ValidationError("Invalid notification", [
          { field: "channels", message: "must not be empty" },
        ]),
      );
    }

    const recipient = Recipient.create(input.recipientRef);
    if (!recipient.ok) return err(recipient.error);
    const template = NotificationTemplate.create(
      input.templateId,
      input.bodyPattern,
      input.subjectPattern,
    );
    if (!template.ok) return err(template.error);
    const channels: NotificationChannel[] = [];
    for (const channelInput of input.channels) {
      const channel = NotificationChannel.create(channelInput);
      if (!channel.ok) return err(channel.error);
      channels.push(channel.value);
    }
    const policy = DeliveryPolicy.create(input.maxAttempts, input.expiresAt);

    return this.deps.unitOfWork.run<Result<NotificationStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.notifications.findByIdempotencyKey(
        input.idempotencyKey,
        input.tenantId,
        tx,
      );
      if (existing !== null) {
        return ok({ notificationId: existing.id.toString(), status: existing.status.value });
      }

      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const notification = Notification.create(
        id,
        input.idempotencyKey,
        input.sourceRef,
        recipient.value,
        channels,
        template.value,
        input.variables,
        policy,
      );
      await this.deps.notifications.save(notification, input.tenantId, tx);
      return ok({ notificationId: id.toString(), status: notification.status.value });
    });
  }
}
