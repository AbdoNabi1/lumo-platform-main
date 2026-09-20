import type { AccessControl, Cache, Permission, Principal } from "@platform/contracts";
import type { Logger } from "@platform/utils";
import type { HttpFetch } from "./kratos";

export interface KetoOptions {
  /** Keto read API base (relation-tuple checks) — mesh-internal ONLY. */
  readonly readUrl: string;
  readonly fetch: HttpFetch;
  /** Relation-tuple namespace holding permission grants. Default `permissions`. */
  readonly namespace?: string;
  /**
   * How the grant subject is expressed in the `/relation-tuples/check` query. Default
   * `"subject_id"` — a direct `subject_id=<principalId>` param, matching
   * `infrastructure/docker/keto/keto.yml`'s legacy (non-OPL) namespace config, which accepts it
   * generically. `"subject_set"` sends `subject_set.namespace=<subjectSetNamespace>&
   * subject_set.object=<principalId>&subject_set.relation=` instead — required by Ory Network,
   * whose OPL-compiled namespaces reject `subject_id` outright ("please migrate to subject sets",
   * measured directly against a live project on 2026-09-04).
   *
   * This reuses `KetoRelationshipClient.toBody`/`subjectParams`'s field names, but NOT their
   * semantics: that class always forces `subject_set.namespace` equal to the tuple's own namespace
   * (via `namespaceOf`), and its `SUBJECT_SET` regex (`^([^#]+)#([^#]+)$`) cannot represent an
   * empty relation at all. Neither holds here — this model needs a *separate* `User` namespace
   * (`infrastructure/ory/network/permissions.opl.ts`) and an *empty* relation. So
   * `KetoRelationshipClient.check` cannot express what this option sends; do not treat it as an
   * equivalent read path without extending it first (tracked as a follow-up on
   * `apps/runtime/src/security/ory-clients.ts`, which still uses that class unmigrated).
   */
  readonly subjectConvention?: "subject_id" | "subject_set";
  /**
   * The Ory namespace a principal is a member of, used only when `subjectConvention` is
   * `"subject_set"` (see `infrastructure/ory/network/permissions.opl.ts`'s `User` namespace,
   * which every principal is a subject-set member of with an empty relation). Ignored under
   * `"subject_id"`. Default `"User"`.
   */
  readonly subjectSetNamespace?: string;
  readonly logger: Logger;
}

/**
 * Ory Keto `AccessControl` adapter (Sprint 2.7, D-048) — the SAME port `AdminGuard` and the
 * transport guard already consume; swapping `AllowAllAccessControl` for this is a
 * composition-root line. Model: a permission `"<module>:<action>"` is granted when the check
 * `(namespace, object=<permission>, relation="granted", subject=<principalId>)` holds — the
 * subject is a direct id or a subject-set membership depending on `subjectConvention` (see that
 * option's doc). Roles and hierarchy are Keto **subject-sets** (role tuples pointing at
 * permission objects) — expansion happens inside Keto, which is exactly the ReBAC-ready shape;
 * ABAC/tenant-scoped objects extend the tuple object (`tenant/<id>/<permission>`) when
 * per-tenant grants arrive with the Tenancy context (G-23/G-38) — no port change either way.
 *
 * **Tenant scoping is NOT YET ENFORCED HERE (G-70).** The principal now carries its tenant
 * (`Principal.tenantId`, ADR-0015) and every decision below is made "for" that tenant, but the
 * tuples that exist today (seeds, `relation-sync.consumer.ts`) are `(permissions, <bare
 * permission>, granted, <principal id>)`: they carry no tenant, so a grant is still global per
 * principal. `objectFor` is the single place the object is built; it returns the bare permission
 * until the tuples are rewritten (dual-write, switch reads, delete bare), when it becomes
 * `tenant/<tenantId>/<permission>`. Passing the tenant changes no Keto decision before then.
 * The decision CACHE below is tenant-scoped already.
 *
 * Fail-closed: any non-200 or transport failure denies (never throws into the guard) — an
 * authorization outage must not become an authorization bypass.
 */
export class KetoAccessControl implements AccessControl {
  private readonly options: KetoOptions;

  constructor(options: KetoOptions) {
    this.options = options;
  }

  /**
   * The Keto `object` a permission is checked against for this principal's tenant. Today: the bare
   * permission (tenant-blind, G-70). The principal is threaded here on purpose so the switch to
   * `tenant/<tenantId>/<permission>` is a one-line change once the tuples are qualified; do not read
   * the parameter's presence as enforcement.
   */
  private objectFor(_principal: Principal, permission: Permission): string {
    return permission;
  }

  async authorize(principal: Principal, permission: Permission): Promise<boolean> {
    const namespace = this.options.namespace ?? "permissions";
    const subjectParams: Record<string, string> =
      this.options.subjectConvention === "subject_set"
        ? {
            "subject_set.namespace": this.options.subjectSetNamespace ?? "User",
            "subject_set.object": principal.id,
            "subject_set.relation": "",
          }
        : { subject_id: principal.id };
    const query = new URLSearchParams({
      namespace,
      object: this.objectFor(principal, permission),
      relation: "granted",
      ...subjectParams,
    });
    try {
      const response = await this.options.fetch(
        `${this.options.readUrl}/relation-tuples/check?${query.toString()}`,
      );
      if (response.status !== 200) {
        // Logged at warn, not error: a non-200 here is routine for a real "denied" (Keto answers
        // non-200 for some deny shapes) as well as a real outage — this is a fail-closed decision
        // either way, but silently returning false with no log line at all was exactly how the
        // subjectConvention/isOryNetworkApiKey mismatch (see composition.ts) went unnoticed.
        this.options.logger.warn("keto authorization check returned non-200 — denying", {
          permission,
          principalId: principal.id,
          tenantId: principal.tenantId,
          status: response.status,
        });
        return false;
      }
      const body = (await response.json()) as { allowed?: boolean };
      return body.allowed === true;
    } catch (error) {
      this.options.logger.error("keto authorization check failed — denying", {
        permission,
        principalId: principal.id,
        tenantId: principal.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false; // fail closed
    }
  }
}

/**
 * Decision cache decorator over ANY `AccessControl` (reuses the Sprint-2.3 `Cache` port).
 * Both allow and deny are cached for a short TTL — the TTL IS the revocation-latency window
 * (default 30s, D-048); pick it per surface.
 *
 * Keys are tenant + principal + permission scoped. The original plan here was that "when
 * tenant-scoped grants arrive, the tenant is part of the permission object, so keys stay correct
 * without change". That plan never landed: `Permission` is a bare string and the principal had no
 * tenant, so the key was `authz:<principal>:<permission>` in ONE global Redis keyspace and a
 * decision made while serving tenant A was served to tenant B (G-67). The tenant now comes from
 * `Principal.tenantId` (ADR-0015) and is part of the key explicitly. The TTL is still the
 * revocation-latency window; the same principal in N tenants now holds N independent entries.
 */
export class CachedAccessControl implements AccessControl {
  private readonly inner: AccessControl;
  private readonly cache: Cache;
  private readonly ttlSeconds: number;

  constructor(inner: AccessControl, cache: Cache, ttlSeconds = 30) {
    this.inner = inner;
    this.cache = cache;
    this.ttlSeconds = ttlSeconds;
  }

  async authorize(principal: Principal, permission: Permission): Promise<boolean> {
    // Tenant and principal are encoded so ids containing `:` cannot forge another entry; the
    // permission (`<module>:<action>`) is last and unambiguous.
    const key = `authz:${encodeURIComponent(principal.tenantId)}:${encodeURIComponent(principal.id)}:${permission}`;
    try {
      const cached = await this.cache.get<boolean>(key);
      if (cached !== null) return cached;
    } catch {
      // cache outage degrades to the inner decision point
    }
    const decision = await this.inner.authorize(principal, permission);
    try {
      await this.cache.set(key, decision, this.ttlSeconds);
    } catch {
      // population failure is harmless
    }
    return decision;
  }
}
