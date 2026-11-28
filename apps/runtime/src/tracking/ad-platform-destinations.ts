/**
 * Ad platform connections as per-shop tracking destinations (Lead Site Part D1, Task 4).
 *
 * A saved connection (Meta, TikTok, Snap, GA4) becomes the shop's own delivery destination in the tracking
 * registry: the vendor's documented endpoint, the typed vendor builder, the vendor's way of presenting a
 * credential, and a routing rule admitting exactly the events that vendor supports and that the shop's site
 * type may emit. The destination holds a REFERENCE (`conn://<tenantId>/<platform>`) — the secret is opened
 * from the sealed vault at send time (`ConnectionCredentialResolver`) and never appears in a definition, a
 * URL, a log line or an error.
 */

import type { ConnectionsForDelivery, LiveConnection } from "@platform/ad-platforms";
import type { Clock } from "@platform/contracts";
import { Expr } from "@platform/expression";
import type { Rule, RuleSet } from "@platform/rules";
import {
  SITE_TYPE_EVENTS,
  STANDARD_RETRY,
  VENDOR_EVENT_NAMES,
  type CanonicalEvent,
  type DestinationDefinition,
  type DestinationKey,
  type EndpointAuth,
  type MappingProfile,
  type VendorBuilderKey,
} from "@platform/tracking";

import { DEFAULT_RULE_SET_KEY } from "./tracking-registry-seed";
import type {
  TenantRegistryWriter,
  TrackingRegistryKind,
  TrackingRegistryRow,
} from "./tracking-registry";

export type ServerPlatform = "meta" | "tiktok" | "snap" | "ga4";
export type SiteType = "store" | "lead_site";

export const SERVER_PLATFORM_KEYS: readonly ServerPlatform[] = ["meta", "tiktok", "snap", "ga4"];

export const BUILDER_OF: Readonly<Record<ServerPlatform, VendorBuilderKey>> = {
  meta: "meta.capi.v27",
  tiktok: "tiktok.events.v1_3",
  snap: "snap.capi.v3",
  ga4: "ga4.mp",
};

/** The registry key of each platform's destination (one per shop and platform). */
export const DESTINATION_KEY_OF: Readonly<Record<ServerPlatform, DestinationKey>> = {
  meta: "meta.capi",
  tiktok: "tiktok.events",
  snap: "snap.capi",
  ga4: "ga4.mp",
};

const CREDENTIAL_AUTH: Readonly<Record<ServerPlatform, EndpointAuth>> = {
  meta: { kind: "query", param: "access_token" },
  tiktok: { kind: "header", name: "Access-Token" },
  snap: { kind: "query", param: "access_token" },
  ga4: { kind: "query", param: "api_secret" },
};

function isServerPlatform(value: string): value is ServerPlatform {
  return (SERVER_PLATFORM_KEYS as readonly string[]).includes(value);
}

/** The destination one live connection asks for. Holds no secret: the credential is a `conn://` reference. */
export function destinationFor(conn: LiveConnection, tenantId: string): DestinationDefinition {
  const config = conn.publicConfig;
  if (config.platform === "google_ads" || conn.platform !== config.platform) {
    throw new Error("ad platform connection has no server destination");
  }
  const platform: ServerPlatform = config.platform;

  let url: string;
  let targetId: string;
  switch (config.platform) {
    case "meta":
      targetId = config.pixelId;
      url = `https://graph.facebook.com/v27.0/${config.pixelId}/events`;
      break;
    case "tiktok":
      targetId = config.pixelCode;
      url = "https://business-api.tiktok.com/open_api/v1.3/event/track/";
      break;
    case "snap":
      targetId = config.pixelId;
      url = `https://tr.snapchat.com/v3/${config.pixelId}/events`;
      break;
    case "ga4":
      targetId = config.measurementId;
      url = `https://www.google-analytics.com/mp/collect?measurement_id=${config.measurementId}`;
      break;
  }

  const builderKey = BUILDER_OF[platform];
  return {
    key: DESTINATION_KEY_OF[platform],
    platform,
    transport: "http_json",
    channel: "server",
    consentPurpose: "marketing",
    mappingProfileKey: builderKey,
    endpoint: {
      url,
      method: "POST",
      credentialRef: `conn://${tenantId}/${platform}`,
      auth: CREDENTIAL_AUTH[platform],
      timeoutMs: 5000,
    },
    retry: STANDARD_RETRY,
    enabled: true,
    builderKey,
    vendorTarget: {
      id: targetId,
      ...(conn.testEventCode === null ? {} : { testEventCode: conn.testEventCode }),
    },
  };
}

function ruleFor(
  destination: DestinationDefinition,
  siteType: SiteType,
  priority: number,
): Rule<DestinationKey> {
  const builder = destination.builderKey;
  if (builder === undefined) {
    throw new Error(`destination "${destination.key}" has no vendor builder to route by`);
  }
  const names: Readonly<Partial<Record<CanonicalEvent, string>>> = VENDOR_EVENT_NAMES[builder];
  const allowed = SITE_TYPE_EVENTS[siteType].filter((event) => names[event] !== undefined);
  return {
    id: `route.${destination.key}`,
    priority,
    when: Expr.in(Expr.ref("event.name"), allowed),
    then: destination.key,
    description: `Forward the ${siteType} events ${destination.platform} supports to ${destination.key}`,
  };
}

/**
 * One rule per destination: it admits the events that vendor supports (it has a `VENDOR_EVENT_NAMES` entry)
 * intersected with the events the shop's site type may emit. A store therefore never gets `form_submitted`,
 * a lead site never gets commerce events, and TikTok never gets `page_viewed` from the server.
 */
export function routingRuleSetFor(
  destinations: readonly DestinationDefinition[],
  siteType: SiteType,
  version: number,
): RuleSet<DestinationKey> {
  return {
    id: DEFAULT_RULE_SET_KEY,
    version,
    mode: "all_matches",
    rules: destinations.map((destination, index) => ruleFor(destination, siteType, index + 1)),
    // A routing rule that cannot be evaluated must not read as "no match".
    onError: "fail_closed",
  };
}

// ------------------------------------------------------------------------------------------ the sync

export interface AdPlatformDeliverySyncDeps {
  readonly store: {
    withTenantRegistryTransaction<T>(
      tenantId: string,
      fn: (writer: TenantRegistryWriter) => Promise<T>,
    ): Promise<T>;
  };
  readonly connections: Pick<ConnectionsForDelivery, "listLive">;
  siteTypeOf(tenantId: string): Promise<SiteType>;
  readonly clock: Clock;
  /** The routing rule set key the ingest runtime resolves (config `TRACKING_RULE_SET_KEY`). */
  readonly ruleSetKey?: string;
}

/** Stable JSON (sorted keys) so a stored JSONB value and a freshly built definition compare equal. */
function canonical(value: unknown): string {
  const sorted = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sorted);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, sorted(v)]),
      );
    }
    return input;
  };
  return JSON.stringify(sorted(value));
}

function latestOf(
  rows: readonly TrackingRegistryRow[],
  kind: TrackingRegistryKind,
  key: string,
): { readonly latest: TrackingRegistryRow | null; readonly nextVersion: number } {
  let latest: TrackingRegistryRow | null = null;
  for (const row of rows) {
    if (row.kind === kind && row.key === key && (latest === null || row.version > latest.version)) {
      latest = row;
    }
  }
  return { latest, nextVersion: (latest?.version ?? 0) + 1 };
}

/**
 * Brings the shop's tracking registry in line with its live ad platform connections.
 *
 * Everything — the connection read, the comparison and every append — happens inside one tenant registry
 * transaction under an advisory lock, so concurrent saves serialize and a failed append rolls back the rest.
 * The current state of a registry key is its highest version of ANY status; a row is appended only when the
 * desired (value, status) differs from it, so running `sync` twice with no change appends nothing, a
 * disabled-then-re-enabled connection resolves again, and a retired key is not retired twice.
 */
export class AdPlatformDeliverySync {
  constructor(private readonly deps: AdPlatformDeliverySyncDeps) {}

  async sync(tenantId: string): Promise<void> {
    const ruleSetKey = this.deps.ruleSetKey ?? DEFAULT_RULE_SET_KEY;
    await this.deps.store.withTenantRegistryTransaction(tenantId, async (writer) => {
      const live = await this.deps.connections.listLive(tenantId);
      const siteType = await this.deps.siteTypeOf(tenantId);
      const rows = await writer.loadAll();
      const at = this.deps.clock.now();

      const desired = new Map<ServerPlatform, DestinationDefinition>();
      for (const conn of live) {
        if (isServerPlatform(conn.platform)) {
          desired.set(conn.platform, destinationFor(conn, tenantId));
        }
      }

      const active: DestinationDefinition[] = [];
      for (const platform of SERVER_PLATFORM_KEYS) {
        const key = DESTINATION_KEY_OF[platform];
        const want = desired.get(platform);
        const { latest, nextVersion } = latestOf(rows, "destination", key);

        if (want === undefined) {
          // No live connection: retire the key once (keeping its last definition), never twice.
          if (latest !== null && latest.status === "active") {
            await writer.append({
              kind: "destination",
              key,
              version: nextVersion,
              status: "retired",
              value: latest.value,
              at,
            });
          }
          continue;
        }

        active.push(want);
        if (
          latest === null ||
          latest.status !== "active" ||
          canonical(latest.value) !== canonical(want)
        ) {
          await writer.append({
            kind: "destination",
            key,
            version: nextVersion,
            status: "active",
            value: want,
            at,
          });
        }

        // The builder renders the payload, but the engine still stamps a mapping version on the record: a
        // stub profile (no fields) is registered the first time this builder key appears.
        const mappingKey = BUILDER_OF[platform];
        if (latestOf(rows, "mapping", mappingKey).latest === null) {
          const stub: MappingProfile = {
            key: mappingKey,
            version: 1,
            destination: key,
            fields: [],
          };
          await writer.append({
            kind: "mapping",
            key: mappingKey,
            version: 1,
            status: "active",
            value: stub,
            at,
          });
        }
      }

      // The shop's routing rule set: one rule per live connection, plus every rule that targets a destination
      // this sync does not manage (a seeded or hand-made one keeps behaving exactly as before).
      const managed = new Set<string>(Object.values(DESTINATION_KEY_OF));
      const { latest: latestRules, nextVersion } = latestOf(rows, "rule_set", ruleSetKey);
      const kept =
        latestRules !== null && latestRules.status === "active"
          ? (latestRules.value as RuleSet<DestinationKey>).rules.filter(
              (rule) => !managed.has(rule.then),
            )
          : [];
      const base = routingRuleSetFor(active, siteType, nextVersion);
      const wanted: RuleSet<DestinationKey> = {
        ...base,
        id: ruleSetKey,
        rules: [...base.rules, ...kept],
      };
      // The version is bookkeeping, not content: only a change in the rules themselves appends a version.
      const shape = (set: RuleSet<DestinationKey>): string =>
        canonical({ id: set.id, mode: set.mode, onError: set.onError, rules: set.rules });
      if (
        latestRules === null ||
        latestRules.status !== "active" ||
        shape(latestRules.value as RuleSet<DestinationKey>) !== shape(wanted)
      ) {
        await writer.append({
          kind: "rule_set",
          key: ruleSetKey,
          version: nextVersion,
          status: "active",
          value: wanted,
          at,
        });
      }
    });
  }
}
