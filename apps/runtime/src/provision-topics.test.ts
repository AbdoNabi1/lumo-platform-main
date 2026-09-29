import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TopicAdmin } from "./kafka-topics/provision";
import { topicInventory } from "./kafka-topics/topic-inventory";

/**
 * `provision-topics.ts` is the Railway worker's pre-deploy step, and Railway blocks the deploy only
 * when it exits non-zero. `provisionTopics` was tested; the exit code `main()` turns its report into
 * was not — a review made `main()` always return 0 and every test stayed green, which would have
 * deployed a worker onto a broker missing topics. No broker: the kafkajs client is mocked.
 */
let admin: TopicAdmin;

vi.mock("@platform/kafka", () => ({
  createKafkaClient: () => ({ admin: () => admin }),
}));

function fakeAdmin(
  existing: readonly string[],
  failOn: ReadonlySet<string> = new Set(),
): TopicAdmin {
  return {
    connect: async () => undefined,
    disconnect: async () => undefined,
    listTopics: async () => [...existing],
    createTopics: async ({ topics }) => {
      const topic = topics[0]?.topic ?? "";
      if (failOn.has(topic)) {
        throw Object.assign(new Error("Topic creation errors"), {
          errors: [{ type: "INVALID_PARTITIONS", message: "hardware constraints" }],
        });
      }
      return true;
    },
  };
}

const ALL = topicInventory().map((spec) => spec.name);

describe("provision-topics main() exit code — what Railway's pre-deploy acts on", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("exits 0 when every topic already exists", async () => {
    admin = fakeAdmin(ALL);
    const { main } = await import("./provision-topics");
    await expect(main({})).resolves.toBe(0);
  });

  it("exits 0 after creating the missing ones", async () => {
    admin = fakeAdmin(ALL.slice(10));
    const { main } = await import("./provision-topics");
    await expect(main({})).resolves.toBe(0);
  });

  it("exits NON-ZERO when even one topic could not be created", async () => {
    const missing = ALL[0] ?? "";
    admin = fakeAdmin(ALL.slice(1), new Set([missing]));
    const { main } = await import("./provision-topics");
    await expect(main({})).resolves.toBe(1);
  });
});
