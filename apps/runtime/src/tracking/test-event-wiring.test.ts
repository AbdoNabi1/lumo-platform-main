import { describe, expect, it, vi } from "vitest";
import type { Database } from "@platform/db";
import type { Logger } from "@platform/utils";

import { AdPlatformTestEventSender } from "./test-event-sender";
import { buildTestEventSender } from "./test-event-wiring";

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => logger,
};
const base = {
  prisma: {} as Database,
  platformTenantId: "platform",
  storefrontPublicUrl: undefined,
  clock: { now: () => new Date("2026-11-28T10:00:00.000Z") },
  logger,
};

describe("buildTestEventSender", () => {
  it("is absent without the connection reader (no vault, no token, nothing to test)", () => {
    expect.hasAssertions();

    expect(buildTestEventSender({ ...base, connections: undefined })).toBeUndefined();
  });

  it("is the sender over the connection reader when there is one", () => {
    expect.hasAssertions();

    const sender = buildTestEventSender({
      ...base,
      connections: { listLive: () => Promise.resolve([]), openSecret: () => Promise.resolve(null) },
    });

    expect(sender).toBeInstanceOf(AdPlatformTestEventSender);
  });
});
