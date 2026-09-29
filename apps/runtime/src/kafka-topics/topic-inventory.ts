import { AUTOMATION_PUBLISHED_EVENTS } from "@platform/automation";
import { CART_PUBLISHED_EVENTS } from "@platform/cart";
import { CATALOG_PUBLISHED_EVENTS } from "@platform/catalog";
import { CHECKOUT_PUBLISHED_EVENTS } from "@platform/checkout";
import { COMPONENTS_PUBLISHED_EVENTS } from "@platform/components";
import { CONTENT_PUBLISHED_EVENTS } from "@platform/content";
import { COUPONS_PUBLISHED_EVENTS } from "@platform/coupons";
import { CUSTOMER360_PUBLISHED_EVENTS } from "@platform/customer-360";
import { EXPERIENCE_PUBLISHED_EVENTS } from "@platform/experience";
import { EXPERIMENTATION_PUBLISHED_EVENTS } from "@platform/experimentation";
import { FEATURE_FLAGS_PUBLISHED_EVENTS } from "@platform/feature-flags-service";
import { FEATURE_REGISTRY_PUBLISHED_EVENTS } from "@platform/feature-registry";
import { FINANCE_PUBLISHED_EVENTS } from "@platform/finance";
import { FULFILLMENT_PUBLISHED_EVENTS } from "@platform/fulfillment";
import { IDENTITY_PUBLISHED_EVENTS } from "@platform/identity";
import { INVENTORY_PUBLISHED_EVENTS } from "@platform/inventory";
import { LICENSING_PUBLISHED_EVENTS } from "@platform/licensing";
import { LOCALIZATION_PUBLISHED_EVENTS } from "@platform/localization";
import { LOYALTY_PUBLISHED_EVENTS } from "@platform/loyalty";
import { MEDIA_LIBRARY_PUBLISHED_EVENTS, MEDIA_PUBLISHED_EVENTS } from "@platform/media";
import { NOTIFICATIONS_PUBLISHED_EVENTS } from "@platform/notifications";
import { ORDERS_PUBLISHED_EVENTS } from "@platform/orders";
import { PAGES_PUBLISHED_EVENTS } from "@platform/pages";
import { PAYMENTS_PUBLISHED_EVENTS } from "@platform/payments";
import { PRICING_PUBLISHED_EVENTS } from "@platform/pricing";
import { PROMOTIONS_PUBLISHED_EVENTS } from "@platform/promotions";
import { RECOMMENDATIONS_PUBLISHED_EVENTS } from "@platform/recommendations";
import { REPORTING_PUBLISHED_EVENTS } from "@platform/reporting";
import { RETURNS_PUBLISHED_EVENTS } from "@platform/returns";
import { REVIEWS_PUBLISHED_EVENTS } from "@platform/reviews";
import { SEARCH_PUBLISHED_EVENTS } from "@platform/search";
import { SECURITY_PUBLISHED_EVENTS } from "@platform/security";
import { SEO_PUBLISHED_EVENTS } from "@platform/seo";
import { SHIPPING_PUBLISHED_EVENTS } from "@platform/shipping";
import { TENANCY_PUBLISHED_EVENTS } from "@platform/tenancy";
import { THEME_PUBLISHED_EVENTS } from "@platform/theme";
import { TRACKING_CAPTURED_TOPIC, TRACKING_CAPTURED_VERSION } from "@platform/tracking";
import { PLATFORM_USAGE_PUBLISHED_EVENTS } from "@platform/usage";
import { WISHLIST_PUBLISHED_EVENTS } from "@platform/wishlist";
import { ENTITLEMENT_PUBLISHED_EVENTS } from "../entitlement/entitlement-events";

/**
 * The ONE source of truth for every Kafka topic the platform needs (G-80). Nothing else lists topic
 * names by hand: the Railway provisioner (`provision-topics.ts`) creates exactly this set, and the
 * compose stack's `bootstrap-topics.sh` reads `infrastructure/docker/redpanda/topics.manifest`, which
 * is generated from it and checked for drift by `topic-inventory.test.ts`.
 *
 * Why it has to be complete: `packages/kafka` produces and consumes with
 * `allowAutoTopicCreation: false`, and the outbox relay publishes in batches — one row whose topic
 * does not exist fails the batch, nothing is marked, and the relay retries the same batch forever.
 * A topic missing from here is therefore not a lost event but a stopped pipeline.
 *
 * Completeness is exactly as good as the lists below are truthful. Licensing's dynamically built
 * types and the new Finance and Media lists are pinned to their translators by tests in their own
 * packages; the other translators' lists are hand-kept and unpinned (recorded in G-80).
 */

/** Every translator emits version 1 today; `topic-inventory.test.ts` fails the day one does not. */
export const EVENT_VERSION = 1;

/** Each context's published-event list, keyed by the package that exports it. */
export const PRODUCED_EVENT_LISTS: Readonly<Record<string, readonly string[]>> = {
  "@platform/automation": AUTOMATION_PUBLISHED_EVENTS,
  "@platform/cart": CART_PUBLISHED_EVENTS,
  "@platform/catalog": CATALOG_PUBLISHED_EVENTS,
  "@platform/checkout": CHECKOUT_PUBLISHED_EVENTS,
  "@platform/components": COMPONENTS_PUBLISHED_EVENTS,
  "@platform/content": CONTENT_PUBLISHED_EVENTS,
  "@platform/coupons": COUPONS_PUBLISHED_EVENTS,
  "@platform/customer-360": CUSTOMER360_PUBLISHED_EVENTS,
  "@platform/experience": EXPERIENCE_PUBLISHED_EVENTS,
  "@platform/experimentation": EXPERIMENTATION_PUBLISHED_EVENTS,
  "@platform/feature-flags-service": FEATURE_FLAGS_PUBLISHED_EVENTS,
  "@platform/feature-registry": FEATURE_REGISTRY_PUBLISHED_EVENTS,
  "@platform/finance": FINANCE_PUBLISHED_EVENTS,
  "@platform/fulfillment": FULFILLMENT_PUBLISHED_EVENTS,
  "@platform/identity": IDENTITY_PUBLISHED_EVENTS,
  "@platform/inventory": INVENTORY_PUBLISHED_EVENTS,
  "@platform/licensing": LICENSING_PUBLISHED_EVENTS,
  "@platform/localization": LOCALIZATION_PUBLISHED_EVENTS,
  "@platform/loyalty": LOYALTY_PUBLISHED_EVENTS,
  "@platform/media (asset)": MEDIA_PUBLISHED_EVENTS,
  "@platform/media (library)": MEDIA_LIBRARY_PUBLISHED_EVENTS,
  "@platform/notifications": NOTIFICATIONS_PUBLISHED_EVENTS,
  "@platform/orders": ORDERS_PUBLISHED_EVENTS,
  "@platform/pages": PAGES_PUBLISHED_EVENTS,
  "@platform/payments": PAYMENTS_PUBLISHED_EVENTS,
  "@platform/pricing": PRICING_PUBLISHED_EVENTS,
  "@platform/promotions": PROMOTIONS_PUBLISHED_EVENTS,
  "@platform/recommendations": RECOMMENDATIONS_PUBLISHED_EVENTS,
  "@platform/reporting": REPORTING_PUBLISHED_EVENTS,
  "@platform/returns": RETURNS_PUBLISHED_EVENTS,
  "@platform/reviews": REVIEWS_PUBLISHED_EVENTS,
  "@platform/runtime (entitlement)": ENTITLEMENT_PUBLISHED_EVENTS,
  "@platform/search": SEARCH_PUBLISHED_EVENTS,
  "@platform/security": SECURITY_PUBLISHED_EVENTS,
  "@platform/seo": SEO_PUBLISHED_EVENTS,
  "@platform/shipping": SHIPPING_PUBLISHED_EVENTS,
  "@platform/tenancy": TENANCY_PUBLISHED_EVENTS,
  "@platform/theme": THEME_PUBLISHED_EVENTS,
  "@platform/usage": PLATFORM_USAGE_PUBLISHED_EVENTS,
  "@platform/wishlist": WISHLIST_PUBLISHED_EVENTS,
};

/**
 * Topics with no translator list behind them, each with the reason it exists. `example` is absent on
 * purpose: `@platform/example` is a template no app wires (nothing under `apps/` imports it).
 */
export const TOPICS_OUTSIDE_TRANSLATORS: Readonly<Record<string, string>> = {
  // Published straight to Kafka by the tracking collector, not through an outbox translator.
  [`${TRACKING_CAPTURED_TOPIC}.v${TRACKING_CAPTURED_VERSION}`]: "@platform/tracking (collector)",
  // Provisioned since ADR-0009 for the outbox-backed AuditTrail. No producer today:
  // `PrismaAuditTrail` writes `platform.audit_events` directly. Kept so nothing that relied on the
  // topic existing loses it.
  "platform.audit.entry_recorded.v1": "reserved (ADR-0009 audit; no current producer)",
};

/**
 * Every topic the worker subscribes to. Pinned against the consumers the worker ACTUALLY builds by
 * `worker-topics-provisioned.test.ts`, so a consumer added without updating this fails there.
 * These — and only these — get `.retry` and `.dlq` companions.
 */
export const WORKER_CONSUMED_TOPICS: readonly string[] = [
  "identity.membership.created.v1",
  "identity.user.created.v1",
  "identity.user.deactivated.v1",
  "licensing.subscription.dunning_exhausted.v1",
  "licensing.subscription.entered_grace.v1",
  "licensing.subscription.recovered_from_grace.v1",
  "orders.order.paid.v1",
  "payments.payment_intent.captured.v1",
  "payments.payment_intent.refunded.v1",
  "platform.usage.recorded.v1",
  "tracking.event.captured.v1",
];

const DAY_MS = 86_400_000;
export const RETENTION_MS = {
  days30: 30 * DAY_MS,
  months13: 395 * DAY_MS,
  years7: 2555 * DAY_MS,
} as const;

/**
 * Retention for a BASE topic. Keeps every class `bootstrap-topics.sh` assigned before this inventory
 * existed (pinned by `topic-inventory.test.ts`) and extends them by context:
 * - 7 years: money and compliance — orders, payments, finance, Licensing invoices, audit, and consent;
 * - 13 months: identity, tracking, and the rest of Licensing (billing-lifecycle and usage signals);
 * - 30 days: everything else.
 */
export function retentionFor(topic: string): number {
  if (
    /^(orders|payments|finance)\./.test(topic) ||
    topic.startsWith("licensing.invoice.") ||
    topic.startsWith("platform.audit.") ||
    topic === "identity.customer.consent_changed.v1"
  ) {
    return RETENTION_MS.years7;
  }
  if (/^(identity|tracking|licensing)\./.test(topic) || topic.startsWith("platform.usage.")) {
    return RETENTION_MS.months13;
  }
  return RETENTION_MS.days30;
}

export type TopicKind = "base" | "retry" | "dlq";

/**
 * How many partitions a topic gets. `full`: a topic the worker CONSUMES, and its `.retry` — the
 * configured count, since that is where consumer parallelism matters. `single`: everything else —
 * a produced-only topic (nothing reads it yet) and every `.dlq`. Redpanda reserves memory per
 * partition (`topic_memory_per_partition`, 4 MiB, per the `redpanda` service comment in
 * `infrastructure/docker/docker-compose.yml`), so ~400 topics at 6 partitions each would need
 * ~10 GiB before a single message is stored.
 */
export type Partitioning = "full" | "single";

export interface TopicSpec {
  readonly name: string;
  readonly kind: TopicKind;
  readonly retentionMs: number;
  readonly partitioning: Partitioning;
  /** Where the topic comes from — a package's list, a named producer, or a consumer's companion. */
  readonly source: string;
}

function topicFor(eventType: string): string {
  return `${eventType}.v${EVENT_VERSION}`;
}

/** The full inventory, one entry per topic, sorted by name. Deterministic, so the manifest is too. */
export function topicInventory(): readonly TopicSpec[] {
  const base = new Map<string, string>();
  for (const [source, types] of Object.entries(PRODUCED_EVENT_LISTS)) {
    for (const type of types) {
      const name = topicFor(type);
      base.set(name, base.has(name) ? `${base.get(name) ?? ""}, ${source}` : source);
    }
  }
  for (const [name, source] of Object.entries(TOPICS_OUTSIDE_TRANSLATORS)) {
    if (!base.has(name)) base.set(name, source);
  }
  for (const name of WORKER_CONSUMED_TOPICS) {
    if (!base.has(name)) base.set(name, "consumed by the worker");
  }

  const consumed = new Set(WORKER_CONSUMED_TOPICS);
  const specs: TopicSpec[] = [];
  for (const [name, source] of base) {
    specs.push({
      name,
      kind: "base",
      retentionMs: retentionFor(name),
      partitioning: consumed.has(name) ? "full" : "single",
      source,
    });
  }
  for (const name of WORKER_CONSUMED_TOPICS) {
    specs.push({
      name: `${name}.retry`,
      kind: "retry",
      retentionMs: RETENTION_MS.days30,
      partitioning: "full",
      source: `companion of ${name}`,
    });
    specs.push({
      name: `${name}.dlq`,
      kind: "dlq",
      retentionMs: RETENTION_MS.months13,
      partitioning: "single",
      source: `companion of ${name}`,
    });
  }
  return specs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * The compose manifest `bootstrap-topics.sh` reads: one `name kind retention_ms partitioning` line
 * per topic.
 * Generated by `pnpm --filter @platform/runtime run topics:manifest`; never edited by hand.
 */
export function renderManifest(specs: readonly TopicSpec[] = topicInventory()): string {
  const header = [
    "# GENERATED from apps/runtime/src/kafka-topics/topic-inventory.ts — do not edit by hand.",
    "# Regenerate: pnpm --filter @platform/runtime run topics:manifest",
    "# Format: <topic> <kind: base|retry|dlq> <retention.ms> <partitioning: full|single>",
  ];
  return (
    [...header, ...specs.map((s) => `${s.name} ${s.kind} ${s.retentionMs} ${s.partitioning}`)].join(
      "\n",
    ) + "\n"
  );
}
