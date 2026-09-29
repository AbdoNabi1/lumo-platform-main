import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RuntimeCore } from "./composition";
import {
  AssignRoleOnMembershipCreated,
  DisablePrincipalOnUserDeactivated,
  ProvisionPrincipalOnUserCreated,
} from "./security/security-provisioning.consumers";
import { TrackingIngestHandler } from "./tracking/tracking-ingest";
import { buildAlwaysOnConsumerRuntimes } from "./worker";

/**
 * Every topic the worker subscribes to must be provisioned — base topic, `.retry` and `.dlq` — in
 * `infrastructure/docker/redpanda/bootstrap-topics.sh`, the rule `docs/development/WORKSPACE_GUIDE.md`
 * already states. Nothing enforced it, and two changes broke it without a test noticing: T14.5's
 * three `licensing.subscription.*` dunning consumers and G-79's `platform.usage.recorded` consumer.
 *
 * Why it is a boot failure and not a lost message: `packages/kafka` subscribes with
 * `allowAutoTopicCreation: false`, `ConsumerSupervisor.startAll()` starts consumers one after another
 * with no isolation, and `startWorker` only starts the outbox relay AFTER `startAll()` returns. One
 * unprovisioned topic therefore stops the worker at boot, relay included.
 *
 * The always-on list comes from `buildAlwaysOnConsumerRuntimes` — the same function `startWorker`
 * registers — built over an inert core, so a consumer added there is checked the day it lands. The two
 * config-gated wirings (`buildTrackingIngestRuntime`, `wireSecurityProvisioning`) need real
 * infrastructure to construct, so their handlers are listed explicitly below; when either gains a
 * handler, add it here.
 */
const BOOTSTRAP = fileURLToPath(
  new URL("../../../infrastructure/docker/redpanda/bootstrap-topics.sh", import.meta.url),
);

function provisionedTopics(): ReadonlySet<string> {
  const topics = new Set<string>();
  for (const line of readFileSync(BOOTSTRAP, "utf8").split(/\r?\n/)) {
    const companions = /^with_companions\s+(\S+)/.exec(line);
    if (companions?.[1] !== undefined) {
      topics.add(companions[1]);
      topics.add(`${companions[1]}.retry`);
      topics.add(`${companions[1]}.dlq`);
      continue;
    }
    const single = /^(?:create|compact)\s+"?([A-Za-z0-9._-]+)"?/.exec(line);
    if (single?.[1] !== undefined) topics.add(single[1]);
  }
  return topics;
}

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

describe("every topic the worker subscribes to is provisioned", () => {
  it("parsed a real bootstrap script and a real consumer list", () => {
    // Guards the guard: a moved script or an emptied builder would make the check below vacuous.
    expect(provisionedTopics().has("orders.order.paid.v1")).toBe(true);
    expect(subscribedTopics()).toContain("orders.order.paid.v1");
    expect(subscribedTopics().length).toBeGreaterThanOrEqual(10);
  });

  it.each(subscribedTopics())("%s has its topic, .retry and .dlq", (topic) => {
    const provisioned = provisionedTopics();
    const missing = [topic, `${topic}.retry`, `${topic}.dlq`].filter((t) => !provisioned.has(t));
    expect(missing).toEqual([]);
  });
});
