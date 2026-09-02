import type { Logger } from "@platform/utils";
import type { HttpFetch } from "./kratos";

/**
 * A Zanzibar relation tuple as Keto models it: `namespace:object#relation@subject`. `subject` is
 * either a direct id (`subjectId`) or an indirect **subject-set** (`object#relation`, same namespace).
 */
export interface KetoRelationTuple {
  readonly namespace: string;
  readonly object: string;
  readonly relation: string;
  /** Direct subject id (`principal:abc`) OR a subject-set `object#relation`. */
  readonly subject: string;
}

export interface KetoRelationCheck {
  readonly namespace: string;
  readonly object: string;
  readonly relation: string;
  /** The direct subject id being checked (Keto expands subject-sets server-side). */
  readonly subjectId: string;
}

export interface KetoRelationshipClientOptions {
  /** Keto **read** API base (`/relation-tuples/check`) — mesh-internal ONLY. */
  readonly readUrl: string;
  /** Keto **write** API base (`/admin/relation-tuples`) — mesh-internal ONLY. */
  readonly writeUrl: string;
  readonly fetch: HttpFetch;
  /** Default relation-tuple namespace. Individual tuples/checks may override. Default `permissions`. */
  readonly namespace?: string;
  readonly logger: Logger;
}

const SUBJECT_SET = /^([^#]+)#([^#]+)$/;

/** Splits a subject-set subject (`object#relation`) into its parts, or `null` for a direct subject id. */
function asSubjectSet(
  subject: string,
): { readonly object: string; readonly relation: string } | null {
  const match = SUBJECT_SET.exec(subject);
  if (match === null) return null;
  const [, object, relation] = match;
  if (object === undefined || relation === undefined) return null;
  return { object, relation };
}

/**
 * The single production **Ory Keto** Zanzibar tuple client (Sprint P2.0 H-2, G-SEC-4) — the live
 * binding behind the Security context's `RelationshipCheckPort` (the ReBAC *decision*) and the
 * relation-tuple **synchronization** consumer (the *enforcement* projection). It reuses the same raw
 * REST surface as {@link KetoAccessControl} (no Ory SDK, injected {@link HttpFetch}), deliberately
 * kept distinct from that permission-scoped PEP: this client is the general subject-set-aware tuple
 * API (check + write + delete) the decide/enforce split needs, never a duplicate tuple store.
 *
 * Failure discipline:
 * - `check` is **fail-closed** — any non-200/transport error/malformed body denies (an authorization
 *   outage must never become a bypass). It never throws into a hot authorization path.
 * - `write`/`delete` **throw** on failure so the sync consumer's retry/DLQ pipeline (ADR-0005) owns
 *   recovery. Both are idempotent against redelivery: Keto `PUT` is upsert; `DELETE` of an absent
 *   tuple (404) is treated as success.
 */
export class KetoRelationshipClient {
  private readonly options: KetoRelationshipClientOptions;

  constructor(options: KetoRelationshipClientOptions) {
    this.options = options;
  }

  private namespaceOf(override?: string): string {
    return override ?? this.options.namespace ?? "permissions";
  }

  /** ReBAC check — fail-closed. Mirrors `RelationshipGraph.check` semantics against live Keto. */
  async check(query: KetoRelationCheck): Promise<boolean> {
    const params = new URLSearchParams({
      namespace: this.namespaceOf(query.namespace),
      object: query.object,
      relation: query.relation,
      subject_id: query.subjectId,
    });
    try {
      const response = await this.options.fetch(
        `${this.options.readUrl}/relation-tuples/check?${params.toString()}`,
      );
      if (response.status !== 200) return false;
      const body = (await response.json()) as { allowed?: boolean };
      return body.allowed === true;
    } catch (error) {
      this.options.logger.error("keto relation-tuple check failed — denying", {
        namespace: query.namespace,
        object: query.object,
        relation: query.relation,
        subjectId: query.subjectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false; // fail closed
    }
  }

  /** Creates (upserts) a relation tuple. Idempotent — a redelivered write re-PUTs the same tuple. */
  async write(tuple: KetoRelationTuple): Promise<void> {
    const response = await this.options.fetch(`${this.options.writeUrl}/admin/relation-tuples`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.toBody(tuple)),
    });
    if (response.status !== 200 && response.status !== 201 && response.status !== 204) {
      throw new Error(
        `keto relation-tuple write failed (status ${response.status}) for ${keyOf(tuple)}`,
      );
    }
  }

  /** Deletes a relation tuple. A missing tuple (404) is idempotent success (already enforced-absent). */
  async delete(tuple: KetoRelationTuple): Promise<void> {
    const subject = this.subjectParams(tuple);
    const params = new URLSearchParams({
      namespace: this.namespaceOf(tuple.namespace),
      object: tuple.object,
      relation: tuple.relation,
      ...subject,
    });
    const response = await this.options.fetch(
      `${this.options.writeUrl}/admin/relation-tuples?${params.toString()}`,
      { method: "DELETE" },
    );
    if (response.status !== 204 && response.status !== 200 && response.status !== 404) {
      throw new Error(
        `keto relation-tuple delete failed (status ${response.status}) for ${keyOf(tuple)}`,
      );
    }
  }

  /** Write body — a subject-set subject becomes Keto's structured `subject_set`, else `subject_id`. */
  private toBody(tuple: KetoRelationTuple): Record<string, unknown> {
    const base = {
      namespace: this.namespaceOf(tuple.namespace),
      object: tuple.object,
      relation: tuple.relation,
    };
    const set = asSubjectSet(tuple.subject);
    if (set !== null) {
      return {
        ...base,
        subject_set: {
          namespace: this.namespaceOf(tuple.namespace),
          object: set.object,
          relation: set.relation,
        },
      };
    }
    return { ...base, subject_id: tuple.subject };
  }

  /** Delete query params — subject-set subjects map to Keto's `subject_set.*` query fields. */
  private subjectParams(tuple: KetoRelationTuple): Record<string, string> {
    const set = asSubjectSet(tuple.subject);
    if (set !== null) {
      return {
        "subject_set.namespace": this.namespaceOf(tuple.namespace),
        "subject_set.object": set.object,
        "subject_set.relation": set.relation,
      };
    }
    return { subject_id: tuple.subject };
  }
}

/** Stable `namespace:object#relation@subject` identity of a tuple (matches the domain key format). */
function keyOf(tuple: KetoRelationTuple): string {
  return `${tuple.namespace}:${tuple.object}#${tuple.relation}@${tuple.subject}`;
}
