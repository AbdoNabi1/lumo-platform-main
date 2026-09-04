// Ory Permission Language (OPL) namespace definition for the Ory Network project. Not part of this
// repo's TypeScript build (Ory's own OPL compiler consumes this file directly when uploaded — see
// "Uploading" below); it exists here so the cloud project's permission model is reproducible and
// reviewable instead of living only in the Ory Console.
//
// Mirrors infrastructure/docker/keto/keto.yml's single `permissions` namespace, but Ory Network
// requires an OPL-typed namespace (a raw `namespaces: [{id, name}]` list, as keto.yml uses for
// self-hosted, is rejected outright — confirmed live on 2026-09-04, HTTP 404 "Unknown namespace").
// Declaring `related: { granted: User[] }` compiles to a **subject-set** relation: a grant tuple's
// subject must be `subject_set: { namespace: "User", object: <principalId>, relation: "" }`, not a
// bare `subject_id`. Ory Network rejects subject_id tuples outright ("please migrate to subject
// sets", HTTP 400, also measured live) — this is *why* the namespace is shaped this way, not an
// arbitrary modeling choice. packages/auth/src/keto.ts's `KetoAccessControl` (subjectConvention:
// "subject_set") and scripts/ops/seed-ory-network.mjs's `grantTupleBody` both depend on the `User`
// namespace name matching exactly what's uploaded here — if this file changes, update both.
//
// `KetoAccessControl.authorize` checks `(namespace=permissions, object=<permission string>,
// relation=granted, subject=<principal>)`, so `granted` holding a subject-set of `User` members is
// the entire model — no hierarchy/expansion, because the hierarchy already lives in the admin
// controllers' explicit permission strings (see scripts/ops/seed-ory-network.mjs's PERMISSIONS
// list), not in Keto relation graphs.
//
// Uploading (needs a WORKSPACE API key, `ory_wak_...` from api.console.ory.com — NOT the
// project-scoped `ory_pat_...` already in .env, confirmed to get HTTP 403 against the workspace
// management API): either `ory patch opl --file infrastructure/ory/network/permissions.opl.ts
// --project <project-id-or-slug>`, or paste this file's contents into the Ory Console under
// Permissions → Configure → Permission Rules. See docs/operations/CLOUD_RUNBOOK.md.
import { Namespace, Context } from "@ory/permission-namespace-types";

class User implements Namespace {}

class permissions implements Namespace {
  related: { granted: User[] };

  permits = {
    access: (ctx: Context): boolean => this.related.granted.includes(ctx.subject),
  };
}
