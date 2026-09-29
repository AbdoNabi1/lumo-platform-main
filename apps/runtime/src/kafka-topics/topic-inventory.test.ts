import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EVENT_VERSION,
  PRODUCED_EVENT_LISTS,
  RETENTION_MS,
  TOPICS_OUTSIDE_TRANSLATORS,
  WORKER_CONSUMED_TOPICS,
  renderManifest,
  topicInventory,
} from "./topic-inventory";
import { MANIFEST_PATH } from "./write-manifest";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function translatorFiles(): readonly string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (["node_modules", "coverage", "dist", ".next"].includes(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith("event-translator.ts") && !name.endsWith(".test.ts")) out.push(full);
    }
  };
  for (const top of ["services", "packages", "apps/runtime/src"]) walk(join(ROOT, top));
  return out;
}

/** The two translator files with no published list, and why that is correct. */
const LISTLESS_TRANSLATORS: Readonly<Record<string, string>> = {
  "services/example/src/infrastructure/example-event-translator.ts":
    "@platform/example is a template no app wires",
  "packages/messaging/src/outbox/integration-event-translator.ts": "the interface itself",
};

function relative(path: string): string {
  return path.slice(ROOT.length).replace(/\\/g, "/");
}

const byName = new Map(topicInventory().map((spec) => [spec.name, spec]));

describe("the Kafka topic inventory is complete", () => {
  it("has a base topic for every type in every published list (the producer half of G-80)", () => {
    const missing = Object.entries(PRODUCED_EVENT_LISTS).flatMap(([source, types]) =>
      types
        .filter((t) => byName.get(`${t}.v${EVENT_VERSION}`)?.kind !== "base")
        .map((t) => `${source}: ${t}`),
    );
    expect(missing).toEqual([]);
  });

  it("imports every translator's list — a translator added with a new list cannot be forgotten", () => {
    // Read the lists straight from source and require each type in the inventory: a new
    // `*_PUBLISHED_EVENTS` export that nobody added to PRODUCED_EVENT_LISTS fails here.
    const unseen: string[] = [];
    for (const file of translatorFiles()) {
      const src = readFileSync(file, "utf8");
      for (const list of src.matchAll(
        /export const [A-Z0-9_]*PUBLISHED_EVENTS\b[^=]*=\s*\[([\s\S]*?)\]/g,
      )) {
        for (const type of (list[1] ?? "").matchAll(/"([a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+)"/g)) {
          if (!byName.has(`${type[1]}.v${EVENT_VERSION}`))
            unseen.push(`${relative(file)}: ${type[1]}`);
        }
      }
    }
    expect(unseen).toEqual([]);
  });

  it("knows every translator that has no list, and why", () => {
    const listless = translatorFiles()
      .filter(
        (file) => !/export const [A-Z0-9_]*PUBLISHED_EVENTS\b/.test(readFileSync(file, "utf8")),
      )
      .map(relative)
      .sort();
    expect(listless).toEqual(Object.keys(LISTLESS_TRANSLATORS).sort());
  });

  it(`assumes .v${EVENT_VERSION} only while every translator really emits version ${EVENT_VERSION}`, () => {
    // The version lives inside each `translate()`, not beside the lists. The day one translator emits
    // another version, its topic would be named wrong here — so that day this fails instead.
    const others: string[] = [];
    for (const file of translatorFiles()) {
      for (const m of readFileSync(file, "utf8").matchAll(/eventVersion:\s*([A-Za-z0-9_.]+)/g)) {
        const value = m[1] ?? "";
        if (value === "number") continue; // a type annotation, not an emitted version
        if (value !== String(EVENT_VERSION))
          others.push(`${relative(file)}: eventVersion ${value}`);
      }
    }
    expect(others).toEqual([]);
  });

  it("gives .retry and .dlq to consumed topics, and only to them", () => {
    const companions = topicInventory()
      .filter((s) => s.kind !== "base")
      .map((s) => s.name)
      .sort();
    const expected = WORKER_CONSUMED_TOPICS.flatMap((t) => [`${t}.retry`, `${t}.dlq`]).sort();
    expect(companions).toEqual(expected);
    for (const t of WORKER_CONSUMED_TOPICS) expect(byName.get(t)?.kind).toBe("base");
  });

  it("gives the configured partition count only to consumed topics and their .retry", () => {
    const full = topicInventory()
      .filter((s) => s.partitioning === "full")
      .map((s) => s.name)
      .sort();
    const expected = WORKER_CONSUMED_TOPICS.flatMap((t) => [t, `${t}.retry`]).sort();
    expect(full).toEqual(expected);
  });

  it("fits the compose broker's memory: partitions x 4 MiB within 80% of its --memory", () => {
    // Redpanda reserves `topic_memory_per_partition` (4 MiB, per the compose `redpanda` service comment)
    // for every partition. Compose gives `full` topics 6 partitions (`bootstrap-topics.sh`). Before the
    // full/single split this inventory would have asked compose for ~2,500 partitions (~10 GiB).
    const compose = readFileSync(join(ROOT, "infrastructure/docker/docker-compose.yml"), "utf8");
    const memoryGiB = Number(/--memory=(\d+)G/.exec(compose)?.[1]);
    expect(memoryGiB).toBeGreaterThan(0);
    const partitions = topicInventory().reduce(
      (n, s) => n + (s.partitioning === "full" ? 6 : 1),
      0,
    );
    expect(partitions * 4).toBeLessThanOrEqual(memoryGiB * 1024 * 0.8);
  });

  it("keeps the compose container's memory limit at or above redpanda's own --memory", () => {
    // The compose file says the `deploy.resources.limits.memory` value is "kept ≥ --memory", and
    // Docker Compose v2 applies that limit as the container's cgroup ceiling. Raising --memory to 3G
    // for this inventory while leaving the limit at 2560m would ask Redpanda for more than its
    // container may use.
    const compose = readFileSync(join(ROOT, "infrastructure/docker/docker-compose.yml"), "utf8");
    const redpanda = /\n {2}redpanda:\n([\s\S]*?)\n {2}redpanda-topics:/.exec(compose)?.[1] ?? "";
    const memoryMiB = Number(/--memory=(\d+)G/.exec(redpanda)?.[1]) * 1024;
    const limitMiB = Number(/limits:\s*\n\s*memory:\s*(\d+)m\b/.exec(redpanda)?.[1]);
    expect(memoryMiB).toBeGreaterThan(0);
    expect(limitMiB).toBeGreaterThanOrEqual(memoryMiB);
  });

  it("names every topic once", () => {
    const names = topicInventory().map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps the topics that exist outside any translator", () => {
    for (const name of Object.keys(TOPICS_OUTSIDE_TRANSLATORS))
      expect(byName.get(name)?.kind).toBe("base");
  });
});

describe("the inventory does not regress what compose provisioned before it existed", () => {
  // Snapshot of `bootstrap-topics.sh` at 1087822, the last hand-written version: every base topic and
  // the retention it had. Companions are NOT in the snapshot: that script gave every topic `.retry`
  // and `.dlq`, including ones nothing consumes; the inventory gives them only to consumed topics
  // (checked above), and the provisioner never deletes, so an existing cluster keeps what it has.
  const Y7 = RETENTION_MS.years7;
  const M13 = RETENTION_MS.months13;
  const D30 = RETENTION_MS.days30;
  const BEFORE: Readonly<Record<string, number>> = {
    "catalog.product.published.v1": D30,
    "catalog.product.updated.v1": D30,
    "media.asset.ready.v1": D30,
    "pricing.price.changed.v1": D30,
    "inventory.inventory_item.adjusted.v1": D30,
    "cart.cart.checked_out.v1": D30,
    "cart.cart.abandoned.v1": D30,
    "checkout.checkout_session.completed.v1": D30,
    "checkout.checkout_session.failed.v1": D30,
    "orders.order.placed.v1": Y7,
    "orders.order.paid.v1": Y7,
    "orders.order.refunded.v1": Y7,
    "payments.payment_intent.captured.v1": Y7,
    "payments.payment_intent.failed.v1": Y7,
    "payments.payment_intent.refunded.v1": Y7,
    "identity.customer.registered.v1": M13,
    "identity.customer.consent_changed.v1": Y7,
    "platform.audit.entry_recorded.v1": Y7,
    "tracking.event.captured.v1": M13,
    "licensing.subscription.entered_grace.v1": M13,
    "licensing.subscription.recovered_from_grace.v1": M13,
    "licensing.subscription.dunning_exhausted.v1": M13,
    "platform.usage.recorded.v1": M13,
    "identity.user.created.v1": M13,
    "identity.user.deactivated.v1": M13,
    "identity.membership.created.v1": M13,
  };

  it.each(Object.entries(BEFORE))(
    "%s is still a base topic with the same retention",
    (name, retention) => {
      expect(byName.get(name)).toMatchObject({ kind: "base", retentionMs: retention });
    },
  );
});

describe("the compose manifest is generated from the inventory", () => {
  it("matches the committed topics.manifest — regenerate with `run topics:manifest`", () => {
    expect(readFileSync(MANIFEST_PATH, "utf8").replace(/\r\n/g, "\n")).toBe(renderManifest());
  });
});
