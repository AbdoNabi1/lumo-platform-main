import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireNotifications } from "./composition";

const TENANT = "tenant-a";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-12T00:00:00.000Z") };

function wire() {
  return wireNotifications({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

function createInput(idempotencyKey: string) {
  return {
    tenantId: TENANT,
    idempotencyKey,
    sourceRef: "order-1",
    recipientRef: "customer-1",
    channels: ["email"],
    templateId: "order-shipped",
    bodyPattern: "Hi {{name}}, your order shipped!",
    variables: { name: "Ada" },
    maxAttempts: 2,
  };
}

async function newNotificationId(app: ReturnType<typeof wire>): Promise<string> {
  const created = await app.notifications.create(createInput("idem-1"));
  expect(created.status).toBe(201);
  return (created.body as { notificationId: string }).notificationId;
}

describe("notifications (end to end)", () => {
  it("runs the full Sprint 4.12 lifecycle: create -> queue -> send -> delivered, publishing canonical events", async () => {
    const app = wire();
    const id = await newNotificationId(app);

    const queued = await app.notifications.queue({ tenantId: TENANT, notificationId: id });
    expect(queued.status).toBe(200);
    expect((queued.body as { status: string }).status).toBe("queued");

    const sent = await app.notifications.send({ tenantId: TENANT, notificationId: id });
    expect(sent.status).toBe(200);
    expect((sent.body as { status: string }).status).toBe("sent");

    const delivered = await app.notifications.callback({
      tenantId: TENANT,
      notificationId: id,
      provider: "email",
      callbackId: "cb-1",
      kind: "delivered",
    });
    expect(delivered.status).toBe(200);
    expect((delivered.body as { duplicate: boolean }).duplicate).toBe(false);
    expect((delivered.body as { status: string }).status).toBe("delivered");

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("notifications.notification.queued");
    expect(app.deliveredEventTypes).toContain("notifications.notification.sent");
    expect(app.deliveredEventTypes).toContain("notifications.notification.delivered");
  });

  it("creation is idempotent by idempotencyKey — a replay returns the existing notification", async () => {
    const app = wire();
    const first = await app.notifications.create(createInput("idem-shared"));
    const replay = await app.notifications.create(createInput("idem-shared"));
    expect(replay.status).toBe(201);
    expect((first.body as { notificationId: string }).notificationId).toBe(
      (replay.body as { notificationId: string }).notificationId,
    );
  });

  it("provider-callback idempotency: first processed, replay deduped", async () => {
    const app = wire();
    const id = await newNotificationId(app);
    await app.notifications.queue({ tenantId: TENANT, notificationId: id });
    await app.notifications.send({ tenantId: TENANT, notificationId: id });

    const first = await app.notifications.callback({
      tenantId: TENANT,
      notificationId: id,
      provider: "email",
      callbackId: "cb-replay",
      kind: "delivered",
    });
    expect((first.body as { duplicate: boolean }).duplicate).toBe(false);

    const replay = await app.notifications.callback({
      tenantId: TENANT,
      notificationId: id,
      provider: "email",
      callbackId: "cb-replay",
      kind: "delivered",
    });
    expect(replay.status).toBe(200);
    expect((replay.body as { duplicate: boolean }).duplicate).toBe(true);
  });

  it("rejects an illegal transition (409)", async () => {
    const app = wire();
    const id = await newNotificationId(app);
    const response = await app.notifications.advance({
      tenantId: TENANT,
      notificationId: id,
      toStatus: "sent",
    });
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown notification", async () => {
    const app = wire();
    const response = await app.notifications.advance({
      tenantId: TENANT,
      notificationId: "missing",
      toStatus: "queued",
    });
    expect(response.status).toBe(404);
  });

  it("rejects an empty channel list at creation (422)", async () => {
    const app = wire();
    const response = await app.notifications.create({ ...createInput("idem-empty"), channels: [] });
    expect(response.status).toBe(422);
  });
});
