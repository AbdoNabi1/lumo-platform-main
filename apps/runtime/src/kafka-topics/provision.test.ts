import { describe, expect, it } from "vitest";
import { provisionTopics, type TopicAdmin } from "./provision";
import type { TopicSpec } from "./topic-inventory";

type CreateArgs = Parameters<TopicAdmin["createTopics"]>[0];

/** A fake kafkajs admin: records every call; `fail` maps a topic to the error its creation throws. */
function fakeAdmin(existing: readonly string[], fail: Readonly<Record<string, unknown>> = {}) {
  const calls: string[] = [];
  const createdWith: CreateArgs[] = [];
  const admin: TopicAdmin = {
    connect: async () => {
      calls.push("connect");
    },
    disconnect: async () => {
      calls.push("disconnect");
    },
    listTopics: async () => [...existing],
    createTopics: async (args) => {
      createdWith.push(args);
      const topic = args.topics[0]?.topic ?? "";
      if (topic in fail) throw fail[topic];
      return true;
    },
  };
  return { admin, calls, createdWith };
}

const spec = (
  name: string,
  kind: TopicSpec["kind"] = "base",
  retentionMs = 1000,
  partitioning: TopicSpec["partitioning"] = "single",
): TopicSpec => ({ name, kind, retentionMs, partitioning, source: "test" });

const OPTIONS = { partitions: 3, replicationFactor: 1 };

describe("provisionTopics", () => {
  it("creates only what is missing and leaves existing topics untouched", async () => {
    const { admin, createdWith } = fakeAdmin(["a.b.c.v1"]);
    const report = await provisionTopics(admin, [spec("a.b.c.v1"), spec("x.y.z.v1")], OPTIONS);
    expect(report).toEqual({ created: ["x.y.z.v1"], existing: ["a.b.c.v1"], failed: [] });
    expect(createdWith.map((c) => c.topics[0]?.topic)).toEqual(["x.y.z.v1"]);
  });

  it("gives a `full` topic the configured partitions and every `single` one exactly 1", async () => {
    const { admin, createdWith } = fakeAdmin([]);
    await provisionTopics(
      admin,
      [
        spec("a.b.c.v1", "base", 42, "full"),
        spec("a.b.c.v1.dlq", "dlq", 7, "single"),
        spec("x.y.z.v1", "base", 9, "single"),
      ],
      OPTIONS,
    );
    expect(createdWith.map((c) => c.topics[0])).toEqual([
      {
        topic: "a.b.c.v1",
        numPartitions: 3,
        replicationFactor: 1,
        configEntries: [{ name: "retention.ms", value: "42" }],
      },
      {
        topic: "a.b.c.v1.dlq",
        numPartitions: 1,
        replicationFactor: 1,
        configEntries: [{ name: "retention.ms", value: "7" }],
      },
      {
        topic: "x.y.z.v1",
        numPartitions: 1,
        replicationFactor: 1,
        configEntries: [{ name: "retention.ms", value: "9" }],
      },
    ]);
    expect(createdWith.every((c) => c.waitForLeaders === true)).toBe(true);
  });

  it("counts a topic created concurrently (kafkajs returns false) as existing, not failed", async () => {
    const { admin } = fakeAdmin([]);
    admin.createTopics = async () => false;
    const report = await provisionTopics(admin, [spec("a.b.c.v1")], OPTIONS);
    expect(report).toEqual({ created: [], existing: ["a.b.c.v1"], failed: [] });
  });

  it("counts an explicit TOPIC_ALREADY_EXISTS as existing", async () => {
    const { admin } = fakeAdmin([], {
      "a.b.c.v1": Object.assign(new Error("exists"), { type: "TOPIC_ALREADY_EXISTS" }),
    });
    const report = await provisionTopics(admin, [spec("a.b.c.v1")], OPTIONS);
    expect(report.existing).toEqual(["a.b.c.v1"]);
    expect(report.failed).toEqual([]);
  });

  it("reports every OTHER error as failed — never as existing — and keeps going", async () => {
    const { admin } = fakeAdmin([], {
      "a.b.c.v1": Object.assign(new Error("INVALID_PARTITIONS: hardware constraints"), {
        type: "INVALID_PARTITIONS",
      }),
    });
    const report = await provisionTopics(admin, [spec("a.b.c.v1"), spec("x.y.z.v1")], OPTIONS);
    expect(report.failed).toEqual([
      { topic: "a.b.c.v1", error: "INVALID_PARTITIONS: hardware constraints" },
    ]);
    expect(report.created).toEqual(["x.y.z.v1"]);
    expect(report.existing).toEqual([]);
  });

  it("names the real cause when kafkajs wraps it in an aggregate error", async () => {
    // Shape verified in kafkajs@2.2.4 (`createTopics/v0/response.js`, `admin/index.js`): a rejected
    // topic throws a `KafkaJSAggregateError` whose OWN message is only "Topic creation errors"; the
    // cause (`type`, `message`) lives in `.errors[]`. Logging `.message` alone left the runbook's
    // "INVALID_PARTITIONS" diagnosis invisible in the pre-deploy log.
    const aggregate = Object.assign(new Error("Topic creation errors"), {
      name: "KafkaJSAggregateError",
      errors: [
        Object.assign(new Error("Number of partitions is invalid"), {
          type: "INVALID_PARTITIONS",
          topic: "a.b.c.v1",
        }),
      ],
    });
    const { admin } = fakeAdmin([], { "a.b.c.v1": aggregate });
    const report = await provisionTopics(admin, [spec("a.b.c.v1")], OPTIONS);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.error).toContain("INVALID_PARTITIONS");
    expect(report.failed[0]?.error).toContain("Number of partitions is invalid");
  });

  it("disconnects even when listing topics throws", async () => {
    const { admin, calls } = fakeAdmin([]);
    admin.listTopics = async () => {
      throw new Error("broker unreachable");
    };
    await expect(provisionTopics(admin, [spec("a.b.c.v1")], OPTIONS)).rejects.toThrow(
      "broker unreachable",
    );
    expect(calls).toEqual(["connect", "disconnect"]);
  });
});
