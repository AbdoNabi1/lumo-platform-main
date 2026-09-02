import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import {
  RetryNotification,
  SendNotification,
  type SendNotificationDeps,
} from "./application/notification-lifecycle.use-cases";
import type {
  EmailProviderPort,
  ProviderSendRequest,
  ProviderSendResult,
} from "./application/ports";
import { Notification } from "./domain/notification";
import type { NotificationRepository } from "./domain/notification-repository";
import { DeliveryPolicy } from "./domain/value-objects/delivery-policy";
import { NotificationChannel } from "./domain/value-objects/notification-channel";
import { NotificationTemplate } from "./domain/value-objects/notification-template";
import { Recipient } from "./domain/value-objects/recipient";
import { NotificationMapper, type NotificationRow } from "./infrastructure/notification.mapper";
import {
  InMemorySmsProvider,
  InMemoryPushProvider,
  InMemoryWebhookProvider,
} from "./infrastructure/in-memory-port-adapters";

/**
 * Phase A.16 (Task 7/8) — full FSM audit regression. `notification-status.ts`'s `TRANSITIONS` table
 * was missing `queued -> failed` and `retrying -> failed`: an illegal-transition-incorrectly-rejected
 * defect (the domain's own `markFailed()`/`retry()` methods and the entire `RetryNotification`
 * pipeline were designed assuming these transitions are legal — see that file's doc for the full
 * trace). Fixed by adding both to the table (the smallest possible correction) plus an
 * idempotent-resume guard in `settleFailure` (required once "failed" became reachable, else two
 * concurrent provider failures would hit `failed`'s empty self-transition list and throw). This
 * suite proves each of Task 8's required scenarios using the SAME `PostgresLikeNotificationRepository`
 * fake `send-notification-transaction-boundary.test.ts` (Phase A.15) established.
 */
class PostgresLikeNotificationRepository implements NotificationRepository {
  private readonly rows = new Map<string, NotificationRow>();
  private readonly tenantId = "tenant-local";

  seed(notification: Notification): void {
    this.write(notification, 1);
  }

  async save(notification: Notification): Promise<void> {
    const id = notification.id.toString();
    const existing = this.rows.get(id);
    if (existing === undefined) {
      this.write(notification, 1);
      return;
    }
    if (existing.version !== notification.version) {
      throw new ConcurrencyError(
        `Notification ${id} was modified concurrently (expected version ${notification.version})`,
      );
    }
    this.write(notification, existing.version + 1);
  }

  async findById(id: string): Promise<Notification | null> {
    const row = this.rows.get(id);
    if (row === undefined) return null;
    return NotificationMapper.toDomain(row);
  }

  async findByIdempotencyKey(): Promise<Notification | null> {
    return null;
  }

  async list(): Promise<{
    readonly items: readonly Notification[];
    readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
  }> {
    const items = [...this.rows.values()].map((row) => NotificationMapper.toDomain(row));
    return { items, pageInfo: { hasNextPage: false, endCursor: null } };
  }

  size(): number {
    return this.rows.size;
  }

  private write(notification: Notification, version: number): void {
    const row = {
      ...NotificationMapper.toRow(notification, this.tenantId),
      version,
    } as NotificationRow;
    this.rows.set(notification.id.toString(), row);
  }
}

class PassthroughUnitOfWork implements TransactionalUnitOfWork<unknown> {
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    return work(undefined);
  }
}

class RecordingEmailProvider implements EmailProviderPort {
  readonly calls: ProviderSendRequest[] = [];
  constructor(private readonly failAlways = false) {}

  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    this.calls.push(request);
    if (this.failAlways) throw new Error("simulated provider failure");
    return { providerRef: `email-${request.idempotencyKey}` };
  }
}

let globalIdCounter = 0;
function sequentialIds(prefix: string): IdGenerator {
  return { generate: () => `${prefix}-${(globalIdCounter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-08-13T00:00:00.000Z") };

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
  const result = NotificationTemplate.create("order-shipped", "Hi {{name}}, your order shipped!");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function seedQueuedNotification(
  repo: PostgresLikeNotificationRepository,
  id: string,
  channels: readonly NotificationChannel[] = [channel("email"), channel("sms")],
): void {
  const n = Notification.create(
    UniqueEntityId.from(id),
    `idem-${id}`,
    `order-${id}`,
    recipient(),
    channels,
    template(),
    { name: "Ada" },
    DeliveryPolicy.create(2),
  );
  n.queue("seed-1", clock.now());
  n.pullDomainEvents();
  repo.seed(n);
}

function buildSendDeps(
  repo: NotificationRepository,
  emailProvider: EmailProviderPort,
): SendNotificationDeps {
  return {
    notifications: repo,
    unitOfWork: new PassthroughUnitOfWork(),
    idGenerator: sequentialIds("evt"),
    clock,
    emailProvider,
    smsProvider: new InMemorySmsProvider(),
    pushProvider: new InMemoryPushProvider(),
    webhookProvider: new InMemoryWebhookProvider(),
  };
}

describe("Task 8 — valid transition: queued -> failed is now legal", () => {
  it("SendNotification against a failing provider settles a QUEUED notification to failed", async () => {
    const repo = new PostgresLikeNotificationRepository();
    seedQueuedNotification(repo, "notif-valid");
    const useCase = new SendNotification(buildSendDeps(repo, new RecordingEmailProvider(true)));

    const result = await useCase.execute({ notificationId: "notif-valid" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("failed");
    const persisted = await repo.findById("notif-valid");
    expect(persisted?.status.value).toBe("failed");
    expect(persisted?.attempts).toHaveLength(1);
    expect(persisted?.attempts[0]?.outcome).toBe("failed");
  });
});

describe("Task 8 — invalid transition: still correctly rejected, not weakened by this fix", () => {
  it("a direct queued -> delivered transition (skipping sent) is still illegal", () => {
    const n = Notification.create(
      UniqueEntityId.from("notif-invalid"),
      "idem-invalid",
      "order-invalid",
      recipient(),
      [channel("email")],
      template(),
      { name: "Ada" },
      DeliveryPolicy.create(2),
    );
    n.queue("evt-1", clock.now());
    expect(() => n.transition("delivered", "evt-2", clock.now())).toThrow(
      /Cannot transition notification from "queued" to "delivered"/,
    );
  });

  it("created -> failed is still illegal (only queued/retrying/sent may reach failed)", () => {
    const n = Notification.create(
      UniqueEntityId.from("notif-invalid-2"),
      "idem-invalid-2",
      "order-invalid-2",
      recipient(),
      [channel("email")],
      template(),
      { name: "Ada" },
      DeliveryPolicy.create(2),
    );
    expect(() => n.transition("failed", "evt-1", clock.now())).toThrow(
      /Cannot transition notification from "created" to "failed"/,
    );
  });
});

describe("Task 8 — terminal-state event: a transition attempt against a terminal status is rejected", () => {
  it("delivered has no outgoing transitions — a further transition attempt throws", () => {
    const n = Notification.create(
      UniqueEntityId.from("notif-terminal"),
      "idem-terminal",
      "order-terminal",
      recipient(),
      [channel("email")],
      template(),
      { name: "Ada" },
      DeliveryPolicy.create(2),
    );
    n.queue("evt-1", clock.now());
    n.markSent("provider-ref", "evt-2", clock.now());
    n.markDelivered("evt-3", clock.now());
    expect(n.status.value).toBe("delivered");
    expect(() => n.transition("failed", "evt-4", clock.now())).toThrow(
      /Cannot transition notification from "delivered" to "failed"/,
    );
  });

  it("dead_letter has no outgoing transitions — retry() after dead-letter is rejected", () => {
    const n = Notification.create(
      UniqueEntityId.from("notif-terminal-2"),
      "idem-terminal-2",
      "order-terminal-2",
      recipient(),
      [channel("email")],
      template(),
      { name: "Ada" },
      DeliveryPolicy.create(1), // exhausted after 1 failed attempt
    );
    n.queue("evt-1", clock.now());
    n.markSent("provider-ref", "evt-2", clock.now());
    n.markFailed("bounced", "evt-3", clock.now());
    n.retry("evt-4", clock.now());
    expect(n.status.value).toBe("dead_letter");
    expect(() => n.retry("evt-5", clock.now())).toThrow(
      /Cannot transition notification from "dead_letter"/,
    );
  });
});

describe("Task 8 — retry event: the retry/dead-letter/expire pipeline is now reachable from a real send failure", () => {
  it("queued -[send fails]-> failed -[RetryNotification]-> retrying -[send succeeds]-> sent", async () => {
    const repo = new PostgresLikeNotificationRepository();
    seedQueuedNotification(repo, "notif-retry-pipeline");

    const failedResult = await new SendNotification(
      buildSendDeps(repo, new RecordingEmailProvider(true)),
    ).execute({ notificationId: "notif-retry-pipeline" });
    expect(failedResult.ok).toBe(true);
    if (failedResult.ok) expect(failedResult.value.status).toBe("failed");

    const retryUseCase = new RetryNotification({
      notifications: repo,
      unitOfWork: new PassthroughUnitOfWork(),
      idGenerator: sequentialIds("evt"),
      clock,
    });
    const retried = await retryUseCase.execute({ notificationId: "notif-retry-pipeline" });
    expect(retried.ok).toBe(true);
    if (retried.ok) expect(retried.value.status).toBe("retrying");
    const afterRetry = await repo.findById("notif-retry-pipeline");
    expect(afterRetry?.channelIndex).toBe(1); // advanced to the fallback (sms) channel

    const sentResult = await new SendNotification(
      buildSendDeps(repo, new RecordingEmailProvider(false)),
    ).execute({ notificationId: "notif-retry-pipeline" });
    expect(sentResult.ok).toBe(true);
    if (sentResult.ok) expect(sentResult.value.status).toBe("sent");
  });
});

describe("Task 8 — duplicate event: a second failed SendNotification call against an already-failed notification is a safe no-op", () => {
  it("does not throw, does not record a second attempt", async () => {
    const repo = new PostgresLikeNotificationRepository();
    seedQueuedNotification(repo, "notif-dup");
    const provider = new RecordingEmailProvider(true);
    const useCase = new SendNotification(buildSendDeps(repo, provider));

    const first = await useCase.execute({ notificationId: "notif-dup" });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.status).toBe("failed");

    // A duplicate delivery of the same failure event (e.g. a redelivered queue message driving a
    // second execute() call before anything else changed the notification's state).
    const second = await useCase.execute({ notificationId: "notif-dup" });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.status).toBe("failed");

    const persisted = await repo.findById("notif-dup");
    expect(persisted?.status.value).toBe("failed");
    expect(persisted?.attempts).toHaveLength(1); // NOT 2 — the second call's markFailed() was skipped
  });
});

describe("Task 8 — concurrent duplicate event: two racers whose provider calls BOTH fail", () => {
  for (let run = 1; run <= 3; run += 1) {
    it(`run ${run}/3: no uncaught ConcurrencyError, no duplicate attempt, deterministic 'failed' final state`, async () => {
      const repo = new PostgresLikeNotificationRepository();
      const id = `notif-race-fail-${run}`;
      seedQueuedNotification(repo, id);
      const provider = new RecordingEmailProvider(true);
      const useCases = [0, 1, 2].map(() => new SendNotification(buildSendDeps(repo, provider)));

      const results = await Promise.all(useCases.map((uc) => uc.execute({ notificationId: id })));

      for (const result of results) {
        expect(result === undefined).toBe(false);
      }
      expect(results.filter((r) => r.ok)).toHaveLength(3);
      for (const result of results) {
        if (result.ok) expect(result.value.status).toBe("failed");
      }

      const persisted = await repo.findById(id);
      expect(persisted?.status.value).toBe("failed");
      expect(persisted?.attempts).toHaveLength(1); // no lost update, no duplicate attempt
    });
  }
});
