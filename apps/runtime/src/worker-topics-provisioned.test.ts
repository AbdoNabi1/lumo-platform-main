import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RuntimeCore } from "./composition";
import { topicInventory, WORKER_CONSUMED_TOPICS } from "./kafka-topics/topic-inventory";
import { MANIFEST_PATH } from "./kafka-topics/write-manifest";
import {
  AssignRoleOnMembershipCreated,
  DisablePrincipalOnUserDeactivated,
  ProvisionPrincipalOnUserCreated,
} from "./security/security-provisioning.consumers";
import { TrackingIngestHandler } from "./tracking/tracking-ingest";
import { buildAlwaysOnConsumerRuntimes } from "./worker";

/**
 * Every topic the worker subscribes to must be provisioned — base topic, `.retry` and `.dlq`. Nothing
 * enforced it until 2026-09-29, and two changes broke it without a test noticing: T14.5's three
 * `licensing.subscription.*` dunning consumers and G-79's `platform.usage.recorded` consumer.
 *
 * Why it is a boot failure and not a lost message: `packages/kafka` subscribes with
 * `allowAutoTopicCreation: false`, `ConsumerSupervisor.startAll()` starts consumers one after another
 * with no isolation, and `startWorker` only starts the outbox relay AFTER `startAll()` returns. One
 * unprovisioned topic therefore stops the worker at boot, relay included.
 *
 * Two pins: `WORKER_CONSUMED_TOPICS` (which the inventory gives companions) must equal what the worker
 * REALLY subscribes to, and every one of those must be in the inventory and in the compose manifest.
 * The always-on list comes from `buildAlwaysOnConsumerRuntimes` — the same function `startWorker`
 * registers — over an inert core, so a consumer added there is checked the day it lands. The two
 * config-gated wirings (`buildTrackingIngestRuntime`, `wireSecurityProvisioning`) need real
 * infrastructure to construct, so their handlers are listed explicitly; when either gains one, add it.
 */

/** A value any property read or call on returns another inert value — builders only store references. */
function inert(): never {
  const fn = (): unknown => inert();
  return new Proxy(fn, {
    get: (_target, property) => (property === "then" ? undefined : inert()),
    apply: () => inert(),
    construct: () => inert() as object,
  }) as never;
}

function topicOf(handler: { readonly eventType: string; readonly eventVersion: number }): string {
  return `${handler.eventType}.v${handler.eventVersion}`;
}

const GATED_HANDLERS = [
  new ProvisionPrincipalOnUserCreated(inert()),
  new DisablePrincipalOnUserDeactivated(inert()),
  new AssignRoleOnMembershipCreated(inert()),
  new TrackingIngestHandler(inert()),
];

function subscribedTopics(): readonly string[] {
  const alwaysOn = buildAlwaysOnConsumerRuntimes(inert() as RuntimeCore).map((r) => r.topic);
  return [...new Set([...alwaysOn, ...GATED_HANDLERS.map(topicOf)])].sort();
}

function manifestTopics(): ReadonlySet<string> {
  const topics = new Set<string>();
  for (const line of readFileSync(MANIFEST_PATH, "utf8").split(/\r?\n/)) {
    if (line.startsWith("#") || line.trim() === "") continue;
    const name = line.split(/\s+/)[0];
    if (name !== undefined) topics.add(name);
  }
  return topics;
}

describe("every topic the worker subscribes to is provisioned", () => {
  it("found a real consumer list", () => {
    // Guards the guard: an emptied builder would make every check below vacuous.
    expect(subscribedTopics()).toContain("orders.order.paid.v1");
    expect(subscribedTopics().length).toBeGreaterThanOrEqual(10);
  });

  it("WORKER_CONSUMED_TOPICS is exactly what the worker subscribes to", () => {
    expect([...WORKER_CONSUMED_TOPICS].sort()).toEqual(subscribedTopics());
  });

  const inventory = new Map(topicInventory().map((s) => [s.name, s.kind]));
  const manifest = manifestTopics();

  it.each(subscribedTopics())(
    "%s has its topic, .retry and .dlq — in the inventory and the manifest",
    (topic) => {
      const wanted: readonly [string, string][] = [
        [topic, "base"],
        [`${topic}.retry`, "retry"],
        [`${topic}.dlq`, "dlq"],
      ];
      expect(wanted.filter(([name, kind]) => inventory.get(name) !== kind)).toEqual([]);
      expect(wanted.map(([name]) => name).filter((name) => !manifest.has(name))).toEqual([]);
    },
  );
});
