import type { KetoRelationshipClient, KratosIdentityService } from "@platform/auth";
import type { Principal } from "@platform/contracts";
import type {
  IdentityDirectoryPort,
  RelationshipCheckPort,
  RelationshipSyncPort,
  RelationQuery,
  RelationTupleProps,
  SessionRevocationPort,
} from "@platform/security";

/**
 * The composition-layer **Ory adapters** binding the Security context's ports to live Ory (H-2 /
 * G-SEC-4). They live here — not in `services/security` — because the frozen design keeps Security
 * **never coupled** to Kratos/Keto/Auth0/Cognito (ADR-0023); the context defines ports, the runtime
 * binds providers, exactly as `KetoAccessControl` is wired in `composition.ts`. Each reuses an existing
 * `@platform/auth` client (no duplicate Ory client, no duplicate tuple store).
 */

/** Live Keto ReBAC check — the enforcement-aligned {@link RelationshipCheckPort} (fail-closed in Keto). */
export class KetoRelationshipCheck implements RelationshipCheckPort {
  constructor(private readonly keto: KetoRelationshipClient) {}
  async check(query: RelationQuery): Promise<boolean> {
    return this.keto.check({
      namespace: query.namespace,
      object: query.object,
      relation: query.relation,
      subjectId: query.subjectId,
    });
  }
}

/** Live Keto relation-tuple {@link RelationshipSyncPort} — mirrors Security decisions into enforcement. */
export class KetoRelationshipSync implements RelationshipSyncPort {
  constructor(private readonly keto: KetoRelationshipClient) {}
  async write(tuple: RelationTupleProps): Promise<void> {
    await this.keto.write(tuple);
  }
  async delete(tuple: RelationTupleProps): Promise<void> {
    await this.keto.delete(tuple);
  }
}

/**
 * Live Kratos {@link IdentityDirectoryPort} — resolves a human `subjectRef` (the Kratos identity id) to
 * existence + active state. A missing or non-active identity resolves to `false` (fail-closed). Reuses
 * `KratosIdentityService.lookupIdentity` (admin API).
 */
export class KratosIdentityDirectory implements IdentityDirectoryPort {
  constructor(private readonly kratos: KratosIdentityService) {}
  async exists(subjectRef: string): Promise<boolean> {
    const identity = await this.kratos.lookupIdentity(subjectRef);
    if (identity === null) return false;
    const state = identity["state"];
    return state === undefined || state === "active";
  }
}

/**
 * Live Kratos {@link SessionRevocationPort} — propagates a Security "revoke all sessions" decision to
 * Kratos (the session enforcement point) by deleting every one of the identity's Kratos sessions. Reuses
 * `KratosIdentityService.revokeSessions` (already WORM-audited). Throws when Kratos rejects the
 * revocation so the sync consumer's retry/DLQ pipeline re-drives it — a compromise-response logout must
 * never be silently dropped.
 */
export class KratosSessionRevoker implements SessionRevocationPort {
  constructor(
    private readonly kratos: KratosIdentityService,
    private readonly revokedBy: Principal,
  ) {}
  async revokeAllForIdentity(externalIdentityId: string): Promise<void> {
    const ok = await this.kratos.revokeSessions(externalIdentityId, this.revokedBy);
    if (!ok) throw new Error(`kratos session revocation failed for identity ${externalIdentityId}`);
  }
}
