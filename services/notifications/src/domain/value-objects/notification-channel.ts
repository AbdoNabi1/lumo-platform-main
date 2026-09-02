import { ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

export type NotificationChannelValue = "email" | "sms" | "push" | "webhook" | "in_app";

const VALID_CHANNELS: readonly NotificationChannelValue[] = [
  "email",
  "sms",
  "push",
  "webhook",
  "in_app",
];

interface NotificationChannelProps {
  readonly value: NotificationChannelValue;
}

/** A delivery channel. `in_app` is delivered internally; every other channel goes through its own outbound provider port. */
export class NotificationChannel extends ValueObject<NotificationChannelProps> {
  static create(value: string): Result<NotificationChannel, ValidationError> {
    if (!VALID_CHANNELS.includes(value as NotificationChannelValue)) {
      return err(
        new ValidationError("Invalid notification channel", [
          { field: "channel", message: `must be one of ${VALID_CHANNELS.join(", ")}` },
        ]),
      );
    }
    return ok(new NotificationChannel({ value: value as NotificationChannelValue }));
  }

  get value(): NotificationChannelValue {
    return this.props.value;
  }
}
