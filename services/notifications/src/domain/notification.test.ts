import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { DeliveryPolicy } from "./value-objects/delivery-policy";
import { NotificationChannel } from "./value-objects/notification-channel";
import { NotificationTemplate } from "./value-objects/notification-template";
import { Notification } from "./notification";
import { Recipient } from "./value-objects/recipient";

function channel(value: string): NotificationChannel {
  const result = NotificationChannel.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function recipient(): Recipient {
  const result = Recipient.create("customer-1");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function template(): NotificationTemplate {
  const result = NotificationTemplate.create(
    "order-shipped",
    "Hi {{name}}, your order {{orderRef}} shipped!",
    "Order {{orderRef}} shipped",
  );
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function notification(channels: readonly NotificationChannel[] = [channel("email")]): Notification {
  return Notification.create(
    UniqueEntityId.from("notif-1"),
    "idem-1",
    "order-1",
    recipient(),
    channels,
    template(),
    { name: "Ada", orderRef: "order-1" },
    DeliveryPolicy.create(2),
  );
}

describe("Notification", () => {
  it("starts at created and raises no events until the first transition", () => {
    const n = notification();
    expect(n.status.value).toBe("created");
    expect(n.pullDomainEvents()).toHaveLength(0);

    n.queue("evt-1", new Date(0));
    expect(n.status.value).toBe("queued");
    const events = n.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("notification.transitioned");
  });

  it("renders the template's variable substitution", () => {
    const n = notification();
    const rendered = n.render();
    expect(rendered.body).toBe("Hi Ada, your order order-1 shipped!");
    expect(rendered.subject).toBe("Order order-1 shipped");
  });

  it("runs queue -> sent -> delivered", () => {
    const n = notification();
    n.queue("evt-1", new Date(0));
    n.markSent("provider-ref-1", "evt-2", new Date(0));
    expect(n.status.value).toBe("sent");
    expect(n.attempts).toHaveLength(1);

    n.markDelivered("evt-3", new Date(1_000));
    expect(n.status.value).toBe("delivered");
    expect(n.deliveredAt).toEqual(new Date(1_000));
  });

  it("advances to a fallback channel on retry, then dead-letters once attempts are exhausted", () => {
    const n = notification([channel("email"), channel("sms")]);
    n.queue("evt-1", new Date(0));
    n.markSent("provider-ref-1", "evt-2", new Date(0));
    n.markFailed("bounced", "evt-3", new Date(0));
    expect(n.channelIndex).toBe(0);

    n.retry("evt-4", new Date(0));
    expect(n.status.value).toBe("retrying");
    expect(n.channelIndex).toBe(1);
    expect(n.currentChannel.value).toBe("sms");

    n.markSent("provider-ref-2", "evt-5", new Date(0));
    n.markFailed("bounced again", "evt-6", new Date(0));
    n.retry("evt-7", new Date(0));
    expect(n.status.value).toBe("dead_letter");
  });

  it("expires on retry once past the policy's expiry", () => {
    const policyWithExpiry = DeliveryPolicy.create(5, new Date(500));
    const n = Notification.create(
      UniqueEntityId.from("notif-2"),
      "idem-2",
      "order-2",
      recipient(),
      [channel("email")],
      template(),
      { name: "Ada", orderRef: "order-2" },
      policyWithExpiry,
    );
    n.queue("evt-1", new Date(0));
    n.markSent("provider-ref-1", "evt-2", new Date(0));
    n.markFailed("bounced", "evt-3", new Date(0));

    n.retry("evt-4", new Date(1_000));
    expect(n.status.value).toBe("expired");
  });

  it("rejects an illegal transition (e.g. created -> sent directly, 409)", () => {
    const n = notification();
    expect(() => n.transition("sent", "evt-1", new Date(0))).toThrow(BusinessRuleError);
  });
});
