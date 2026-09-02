import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import {
  SendNotification,
  type SendNotificationDeps,
} from "./application/notification-lifecycle.use-cases";
import type {
  ProviderSendRequest,
  ProviderSendResult,
  EmailProviderPort,
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
 * Phase A.15 (Task 3/3) — same "Postgres-like" fake shape `refund-concurrency.test.ts` and
 * `create-intent-transaction-boundary.test.ts` use for Payments: round-trips every read/write
 * through `NotificationMapper` (the exact plain-row shape `PrismaNotificationRepository`
 * persists) so `findById` returns an INDEPENDENT snapshot every call, and `save` reproduces
 * Postgres's `UPDATE ... WHERE id = ? AND version = ?` contract exactly — a write whose `version`
 * no longer matches the stored row throws `ConcurrencyError`, mirroring
 * `PrismaNotificationRepository.save` (`infrastructure/prisma-notification-repository.ts`).
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

/** Tracks how many `run()` calls are currently open — a stand-in for "a live DB transaction is held". */
class TrackingUnitOfWork implements TransactionalUnitOfWork<unknown> {
  openCount = 0;
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    this.openCount += 1;
    try {
      return await work(undefined);
    } finally {
      this.openCount -= 1;
    }
  }
}

/** Records every call along with `openCountAtCall` — the exploit-proof signal. */
class RecordingEmailProvider implements EmailProviderPort {
  readonly calls: Array<{ request: ProviderSendRequest; openCountAtCall: number }> = [];
  constructor(
    private readonly uow?: TrackingUnitOfWork,
    private readonly fail: (request: ProviderSendRequest) => boolean = () => false,
    private readonly delayMs = 0,
  ) {}

  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    this.calls.push({ request, openCountAtCall: this.uow?.openCount ?? -1 });
    if (this.fail(request)) {
      throw new Error("simulated provider failure");
    }
    return { providerRef: `email-${request.idempotencyKey}` };
  }
}

let globalIdCounter = 0;
function sequentialIds(prefix: string): IdGenerator {
  return { generate: () => `${prefix}-${(globalIdCounter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-12T00:00:00.000Z") };

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

/** Seeds a notification durably at `queued`, ready for `SendNotification`. */
function seedQueuedNotification(
  repo: PostgresLikeNotificationRepository,
  id: string,
  channels: readonly NotificationChannel[] = [channel("email")],
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

function buildDeps(
  repo: NotificationRepository,
  emailProvider: EmailProviderPort,
  unitOfWork: TransactionalUnitOfWork<unknown>,
): SendNotificationDeps {
  return {
    notifications: repo,
    unitOfWork,
    idGenerator: sequentialIds("evt"),
    clock,
    emailProvider,
    smsProvider: new InMemorySmsProvider(),
    pushProvider: new InMemoryPushProvider(),
    webhookProvider: new InMemoryWebhookProvider(),
  };
}

describe("Phase A.15 (Task 3) — exploit proof: provider .send() call happens while a DB transaction is open", () => {
  it("the email provider is invoked with openCountAtCall === 0 (no transaction held during the network call)", async () => {
    const repo = new PostgresLikeNotificationRepository();
    seedQueuedNotification(repo, "notif-1");
    const uow = new TrackingUnitOfWork();
    const provider = new RecordingEmailProvider(uow);
    const useCase = new SendNotification(buildDeps(repo, provider, uow));

    const result = await useCase.execute({ notificationId: "notif-1" });

    expect(result.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.openCountAtCall).toBe(0);
  });

  it("the notification is durably readable mid-provider-call (precheck already committed)", async () => {
    const repo = new PostgresLikeNotificationRepository();
    seedQueuedNotification(repo, "notif-2");
    const uow = new TrackingUnitOfWork();
    let statusDuringProviderCall: string | undefined;
    const provider: EmailProviderPort = {
      async send(request) {
        const mid = await repo.findById("notif-2");
        statusDuringProviderCall = mid?.status.value;
        return { providerRef: `email-${request.idempotencyKey}` };
      },
    };
    const useCase = new SendNotification(buildDeps(repo, provider, uow));

    await useCase.execute({ notificationId: "notif-2" });

    // Still "queued" mid-call — the precheck transaction committed without mutating status; the
    // transition to "sent" only happens in `settle`, AFTER the provider call resolves.
    expect(statusDuringProviderCall).toBe("queued");
  });
});

describe("Phase A.15 (Task 3) — success and failure each settle via their own post-external-call transaction", () => {
  it("provider success settles the notification to 'sent'", async () => {
    const repo = new PostgresLikeNotificationRepository();
    seedQueuedNotification(repo, "notif-3");
    const uow = new TrackingUnitOfWork();
    const provider = new RecordingEmailProvider(uow);
    const useCase = new SendNotification(buildDeps(repo, provider, uow));

    const result = await useCase.execute({ notificationId: "notif-3" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("sent");
    const persisted = await repo.findById("notif-3");
    expect(persisted?.status.value).toBe("sent");
    expect(persisted?.attempts).toHaveLength(1);
    expect(persisted?.attempts[0]?.outcome).toBe("succeeded");
  });

  it("provider failure settles the notification to 'failed' from 'queued' (Phase A.16 FSM fix — see class doc)", async () => {
    const repo = new PostgresLikeNotificationRepository();
    seedQueuedNotification(repo, "notif-4");
    const uow = new TrackingUnitOfWork();
    const provider = new RecordingEmailProvider(uow, () => true);
    const useCase = new SendNotification(buildDeps(repo, provider, uow));

    const result = await useCase.execute({ notificationId: "notif-4" });

    // Phase A.16: `queued -> failed` is now a legal transition (`notification-status.ts`), so
    // `markFailed()` inside `settleFailure` succeeds instead of throwing `BusinessRuleError`.
    // Pre-A.16, this asserted `result.ok === false` / status stayed "queued" — see
    // `notification-fsm-regression.test.ts` for the dedicated RED/GREEN proof of this fix.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("failed");

    const persisted = await repo.findById("notif-4");
    expect(persisted?.status.value).toBe("failed");
    expect(persisted?.attempts).toHaveLength(1);
    expect(persisted?.attempts[0]?.outcome).toBe("failed");
  });

  it("provider failure DOES settle to 'failed' when called from a status the domain actually allows ('sent')", async () => {
    // Proves `settleFailure`'s mechanics work correctly in isolation, independent of the FSM defect
    // above — seeds the notification directly at "sent" (the only status TRANSITIONS permits
    // "failed" from) and drives a SendNotification call whose provider throws.
    const repo = new PostgresLikeNotificationRepository();
    const n = Notification.create(
      UniqueEntityId.from("notif-4b"),
      "idem-4b",
      "order-4b",
      recipient(),
      [channel("email")],
      template(),
      { name: "Ada" },
      DeliveryPolicy.create(2),
    );
    n.queue("seed-1", clock.now());
    n.markSent("provider-seed", "seed-2", clock.now());
    n.pullDomainEvents();
    repo.seed(n);

    const uow = new TrackingUnitOfWork();
    const provider = new RecordingEmailProvider(uow, () => true);
    const useCase = new SendNotification(buildDeps(repo, provider, uow));

    const result = await useCase.execute({ notificationId: "notif-4b" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("failed");
    const persisted = await repo.findById("notif-4b");
    expect(persisted?.status.value).toBe("failed");
  });
});

describe("Phase A.15 (Task 3) — idempotency-key stability across a crash-before-settle retry", () => {
  it("a retry AFTER a crash during settle's own save() re-derives the SAME idempotencyKey", async () => {
    // Simulates a process crash between the provider call succeeding and settle's commit landing:
    // wrap the repository so its very first save() (settle's write) throws a plain infra error
    // (NOT a ConcurrencyError, so `withConcurrencyRetry` does not swallow it) — exactly like a
    // crashed pod losing the DB write after the network call already completed. Nothing commits,
    // so a fresh retry's precheck re-reads the SAME committed state (still "queued",
    // attempts.length === 0) and therefore re-derives the SAME idempotencyKey.
    const repo = new PostgresLikeNotificationRepository();
    seedQueuedNotification(repo, "notif-5");
    let saveCalls = 0;
    const crashingRepo: NotificationRepository = {
      save: async (notification) => {
        saveCalls += 1;
        if (saveCalls === 1) {
          throw new Error("simulated crash during settle commit");
        }
        return repo.save(notification);
      },
      findById: (id) => repo.findById(id),
      findByIdempotencyKey: () => repo.findByIdempotencyKey(),
      list: () => repo.list(),
    };
    const uow = new TrackingUnitOfWork();
    const provider = new RecordingEmailProvider(uow);
    const useCase = new SendNotification(buildDeps(crashingRepo, provider, uow));

    // First attempt: provider call succeeds, but settle's save() "crashes" — execute() rejects.
    await expect(useCase.execute({ notificationId: "notif-5" })).rejects.toThrow(
      /simulated crash during settle commit/,
    );
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.request.idempotencyKey).toBe("notif-5:attempt:0");
    // Nothing committed — still "queued" in the underlying store.
    expect((await repo.findById("notif-5"))?.status.value).toBe("queued");

    // Retry (a fresh execute() call, e.g. from a queue redelivery after the crash): precheck
    // re-reads the SAME committed state, so it re-derives the identical key.
    const retried = await useCase.execute({ notificationId: "notif-5" });
    expect(retried.ok).toBe(true);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]?.request.idempotencyKey).toBe("notif-5:attempt:0");
    expect(provider.calls[1]?.request.idempotencyKey).toBe(
      provider.calls[0]?.request.idempotencyKey,
    );
    expect((await repo.findById("notif-5"))?.status.value).toBe("sent");
  });

  it("HONEST finding: a retry AFTER settle already committed derives a DIFFERENT key (genuine re-send, unchanged from pre-fix code)", async () => {
    const repo = new PostgresLikeNotificationRepository();
    seedQueuedNotification(repo, "notif-6");
    const uow = new TrackingUnitOfWork();
    const provider = new RecordingEmailProvider(uow);
    const useCase = new SendNotification(buildDeps(repo, provider, uow));

    const first = await useCase.execute({ notificationId: "notif-6" });
    expect(first.ok).toBe(true);
    expect(provider.calls[0]?.request.idempotencyKey).toBe("notif-6:attempt:0");

    // A second, blind call to execute() on the now-"sent" notification: attempts.length has
    // advanced to 1 by the successful settle above, so precheck computes a NEW key. This is
    // unchanged from the pre-fix single-transaction code (which derived the key fresh from
    // `attempts.length` on every call, with no "already sent" short-circuit either) — not a
    // regression this refactor introduces, but a narrow pre-existing gap worth being explicit
    // about: callers must not blindly retry `SendNotification` after a successful send.
    const second = await useCase.execute({ notificationId: "notif-6" });
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]?.request.idempotencyKey).toBe("notif-6:attempt:1");
    expect(provider.calls[0]?.request.idempotencyKey).not.toBe(
      provider.calls[1]?.request.idempotencyKey,
    );
    // The second call's settle finds the notification already "sent" and no-ops the transition
    // (Phase A.9-style guard) — so despite the duplicate provider call, no domain error, no second
    // attempt recorded, no lost update.
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.status).toBe("sent");
    const persisted = await repo.findById("notif-6");
    expect(persisted?.attempts).toHaveLength(1);
  });
});

describe("Phase A.15 (Task 3) — concurrent SendNotification calls never lose updates or leak a raw ConcurrencyError", () => {
  for (let run = 1; run <= 3; run += 1) {
    it(`run ${run}/3: 3 concurrent calls against the same queued notification`, async () => {
      const repo = new PostgresLikeNotificationRepository();
      const id = `notif-race-${run}`;
      seedQueuedNotification(repo, id);
      const uow = new TrackingUnitOfWork();
      const provider = new RecordingEmailProvider(uow);
      const useCases = [0, 1, 2].map(() => new SendNotification(buildDeps(repo, provider, uow)));

      const results = await Promise.all(useCases.map((uc) => uc.execute({ notificationId: id })));

      // Every call resolves to a clean Result — none rejects with a raw, uncaught ConcurrencyError.
      for (const result of results) {
        expect(result === undefined).toBe(false);
      }
      expect(results.filter((r) => r.ok)).toHaveLength(3);
      for (const result of results) {
        if (result.ok) expect(result.value.status).toBe("sent");
      }

      // No lost update: exactly one attempt is durably recorded (the others' settles found the
      // notification already "sent" and no-op'd, per the Phase A.9-style guard).
      const persisted = await repo.findById(id);
      expect(persisted?.status.value).toBe("sent");
      expect(persisted?.attempts).toHaveLength(1);

      // All 3 concurrent precheck reads saw attempts.length === 0 (nothing had committed yet for
      // any of them), so all 3 presented the SAME idempotencyKey to the provider.
      expect(provider.calls).toHaveLength(3);
      expect(new Set(provider.calls.map((c) => c.request.idempotencyKey)).size).toBe(1);
    });
  }
});

describe("Phase A.15 (Task 3) — in_app channel makes no external call (no transaction-boundary problem for it)", () => {
  it("settles to 'sent' synchronously with providerRef 'in_app', no provider port invoked", async () => {
    const repo = new PostgresLikeNotificationRepository();
    seedQueuedNotification(repo, "notif-inapp", [channel("in_app")]);
    const uow = new TrackingUnitOfWork();
    const provider = new RecordingEmailProvider(uow);
    const useCase = new SendNotification(buildDeps(repo, provider, uow));

    const result = await useCase.execute({ notificationId: "notif-inapp" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("sent");
    expect(provider.calls).toHaveLength(0);
    const persisted = await repo.findById("notif-inapp");
    expect(persisted?.attempts[0]?.providerRef).toBe("in_app");
  });
});
