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
   * measured directly against a live project on 2026-09-04). Same dual convention
   * `KetoRelationshipClient.toBody`/`subjectParams` (`./keto-relationships.ts`) already uses for
   * writes/deletes — this mirrors it for the read-side permission check instead of inventing a
   * second shape.
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
 * Fail-closed: any non-200 or transport failure denies (never throws into the guard) — an
 * authorization outage must not become an authorization bypass.
 */
export class KetoAccessControl implements AccessControl {
  private readonly options: KetoOptions;

  constructor(options: KetoOptions) {
    this.options = options;
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
      object: permission,
      relation: "granted",
      ...subjectParams,
    });
    try {
      const response = await this.options.fetch(
        `${this.options.readUrl}/relation-tuples/check?${query.toString()}`,
      );
      if (response.status !== 200) {
        return false;
      }
      const body = (await response.json()) as { allowed?: boolean };
      return body.allowed === true;
    } catch (error) {
      this.options.logger.error("keto authorization check failed — denying", {
        permission,
        principalId: principal.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false; // fail closed
    }
  }
}

/**
 * Decision cache decorator over ANY `AccessControl` (reuses the Sprint-2.3 `Cache` port).
 * Both allow and deny are cached for a short TTL — the TTL IS the revocation-latency window
 * (default 30s, D-048); pick it per surface. Keys are principal+permission scoped; when
 * tenant-scoped grants arrive, the tenant is part of the permission object, so keys stay
 * correct without change.
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
    const key = `authz:${principal.id}:${permission}`;
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
