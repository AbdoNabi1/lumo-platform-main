import { Registry, type RegistryEntry } from "@platform/registry";
import { type DomainError } from "@platform/utils";
import { type Result } from "@platform/types";
import { type UsageResource } from "./usage-resource";

/**
 * The canonical description of a billable/metered resource (ADR-0018 §I, ADR-0055). Every billable capability in
 * the platform resolves through the {@link UsageResourceRegistry} so that Licensing/Billing/Analytics meter a
 * governed, shared vocabulary (unit, category, billability) rather than free text.
 */
export interface UsageResourceDefinition {
  /** Canonical resource key (a member of {@link USAGE_RESOURCES}). */
  readonly resource: UsageResource;
  /** The kind of quantity metered (P1.1.1 §4) — never hardcoded downstream; always declared here. */
  readonly metricType: UsageMetricType;
  /** Metering unit (e.g. `tokens`, `bytes`, `count`, `messages`). */
  readonly unit: string;
  /** Grouping for reporting/plan sections. */
  readonly category: UsageCategory;
  /** Whether the resource is billable by default (vs. purely observability/quota). */
  readonly billable: boolean;
  readonly description: string;
}

export type UsageCategory =
  | "ai"
  | "messaging"
  | "storage"
  | "commerce"
  | "platform"
  | "automation"
  | "marketplace"
  | "search";

/** The kind of quantity a usage resource meters (P1.1.1 §4). Extensible via `custom`. */
export const USAGE_METRIC_TYPES = [
  "count",
  "storage",
  "bandwidth",
  "duration",
  "credits",
  "tokens",
  "money",
  "minutes",
  "requests",
  "rows",
  "executions",
  "operations",
  "custom",
] as const;
export type UsageMetricType = (typeof USAGE_METRIC_TYPES)[number];
export function isUsageMetricType(value: string): value is UsageMetricType {
  return (USAGE_METRIC_TYPES as readonly string[]).includes(value);
}

/** The seed catalog — the billable resources of Morbeh (Products, Orders, AI, Storage, Media, API, Emails, SMS, …). */
const SEED: readonly UsageResourceDefinition[] = [
  {
    resource: "AI_TOKEN",
    metricType: "tokens",
    unit: "tokens",
    category: "ai",
    billable: true,
    description: "AI model tokens (prompt + completion).",
  },
  {
    resource: "EMAIL",
    metricType: "count",
    unit: "messages",
    category: "messaging",
    billable: true,
    description: "Transactional/marketing emails sent.",
  },
  {
    resource: "SMS",
    metricType: "count",
    unit: "messages",
    category: "messaging",
    billable: true,
    description: "SMS messages sent.",
  },
  {
    resource: "API_REQUEST",
    metricType: "requests",
    unit: "requests",
    category: "platform",
    billable: true,
    description: "Public API requests.",
  },
  {
    resource: "STORAGE",
    metricType: "storage",
    unit: "bytes",
    category: "storage",
    billable: true,
    description: "Stored object bytes.",
  },
  {
    resource: "BANDWIDTH",
    metricType: "bandwidth",
    unit: "bytes",
    category: "storage",
    billable: true,
    description: "Egress/transfer bytes.",
  },
  {
    resource: "MEDIA",
    metricType: "count",
    unit: "assets",
    category: "storage",
    billable: true,
    description: "Media library assets.",
  },
  {
    resource: "PRODUCT",
    metricType: "count",
    unit: "count",
    category: "commerce",
    billable: true,
    description: "Catalog products (quota/tier metric).",
  },
  {
    resource: "ORDER",
    metricType: "count",
    unit: "count",
    category: "commerce",
    billable: true,
    description: "Orders processed.",
  },
  {
    resource: "IMPORT",
    metricType: "executions",
    unit: "jobs",
    category: "platform",
    billable: true,
    description: "Import jobs run.",
  },
  {
    resource: "EXPORT",
    metricType: "executions",
    unit: "jobs",
    category: "platform",
    billable: true,
    description: "Export jobs run.",
  },
  {
    resource: "SEARCH",
    metricType: "requests",
    unit: "queries",
    category: "search",
    billable: true,
    description: "Search queries served.",
  },
  {
    resource: "RECOMMENDATION",
    metricType: "count",
    unit: "count",
    category: "search",
    billable: false,
    description: "Recommendation sets generated.",
  },
  {
    resource: "AUTOMATION",
    metricType: "executions",
    unit: "runs",
    category: "automation",
    billable: true,
    description: "Automation executions.",
  },
  {
    resource: "WORKFLOW",
    metricType: "executions",
    unit: "runs",
    category: "automation",
    billable: true,
    description: "Workflow executions.",
  },
  {
    resource: "IMAGE_RENDER",
    metricType: "operations",
    unit: "renders",
    category: "platform",
    billable: true,
    description: "Server-side image renders.",
  },
  {
    resource: "VIDEO_RENDER",
    metricType: "operations",
    unit: "renders",
    category: "platform",
    billable: true,
    description: "Server-side video renders.",
  },
  {
    resource: "MARKETPLACE_INSTALL",
    metricType: "count",
    unit: "installs",
    category: "marketplace",
    billable: true,
    description: "Marketplace app installs.",
  },
];

/**
 * The **Usage Registry** — the canonical registry of billable resources, built on the Registry Engine
 * (`@platform/registry`). It is the single source of truth every billable capability resolves through before it
 * is metered. Producers of `platform.usage.recorded` should reference a resolved definition; consumers
 * (Licensing/Billing/Analytics) read units/categories/billability from here rather than hardcoding them.
 */
export class UsageResourceRegistry {
  private readonly registry: Registry<UsageResourceDefinition>;

  constructor(seed: readonly UsageResourceDefinition[] = SEED) {
    this.registry = new Registry<UsageResourceDefinition>({
      name: "usage-resources",
      validate: (def, key) => {
        if (def.resource !== key)
          throw new Error(`resource key mismatch (${key} != ${def.resource})`);
        if (def.unit.trim().length === 0) throw new Error("unit is required");
      },
    });
    for (const def of seed)
      this.registry.register({
        key: def.resource,
        value: def,
        tags: [def.category, def.metricType, def.billable ? "billable" : "non_billable"],
        metadata: { unit: def.unit, category: def.category, metricType: def.metricType },
      });
  }

  /** Resolves a billable resource; errors (NotFound/BusinessRule) when unregistered or not active. */
  resolve(resource: string): Result<UsageResourceDefinition, DomainError> {
    const entry = this.registry.requireActive(resource.trim());
    return entry.ok ? { ok: true, value: entry.value.value } : entry;
  }

  /** The current definition (or null) without asserting active status. */
  find(resource: string): UsageResourceDefinition | null {
    return this.registry.get(resource.trim())?.value ?? null;
  }

  /** All billable resource definitions. */
  billable(): readonly UsageResourceDefinition[] {
    return this.registry.list({ tag: "billable" }).map((e) => e.value);
  }

  /** Every registered resource definition. */
  list(): readonly UsageResourceDefinition[] {
    return this.registry.list().map((e) => e.value);
  }

  /** Registers/extends a resource (additive; new resources must still be added to {@link USAGE_RESOURCES}). */
  register(
    def: UsageResourceDefinition,
  ): Result<RegistryEntry<UsageResourceDefinition>, DomainError> {
    return this.registry.register({
      key: def.resource,
      value: def,
      tags: [def.category, def.metricType, def.billable ? "billable" : "non_billable"],
      metadata: { unit: def.unit, category: def.category, metricType: def.metricType },
    });
  }
}

/** A ready-to-use registry seeded with the canonical resource catalog. */
export const usageResourceRegistry = new UsageResourceRegistry();
