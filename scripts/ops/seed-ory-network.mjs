#!/usr/bin/env node
// Ory Network equivalent of scripts/dev/seed-auth-local.mjs, which targets self-hosted Ory on
// localhost and grants only the 14 `:read` permissions the Phase A.30/A.31 screens needed. The
// admin controllers declare 66 distinct permission strings, so the other 52 denied. Regenerate the
// list below with:
//   grep -rhoE '"[a-z0-9]+:(read|write|create|update|delete|manage)"' apps/admin/src/interfaces/*.ts | sort -u
//
// Idempotent — safe to re-run.
//
// Usage:  ADMIN_DEV_PASSWORD='<strong password>' node scripts/ops/seed-ory-network.mjs
// Reads ORY_SDK_URL, ORY_API_KEY, AUTH_CLIENT_ID, AUTH_CLIENT_SECRET, AUTH_AUDIENCE,
// ADMIN_WEB_ORIGIN from the environment. TENANT_DEFAULT_ID (default tenant-local) is the tenant every
// grant is qualified with (G-70) — it must match the runtime's TENANT_DEFAULT_ID.
//
// G-70: each grant is written tenant-qualified only, `tenant/<tenantId>/<permission>` — the object
// reads check. The live bare tuples were migrated and deleted on 2026-09-21
// (docs/operations/KETO_TENANT_MIGRATION.md). Ory Network acknowledged writes in a burst with 2xx and
// persisted only a prefix of them, so every grant here is paced and read back (putVerified).

function required(name) {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`${name} is required`);
  return v;
}

const ORY = required("ORY_SDK_URL").replace(/\/$/, "");
const KEY = required("ORY_API_KEY");
const CLIENT_ID = process.env.AUTH_CLIENT_ID ?? "morbeh-admin-web";
const CLIENT_SECRET = required("AUTH_CLIENT_SECRET");
const AUDIENCE = process.env.AUTH_AUDIENCE ?? "morbeh-admin";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@morbeh.local";
const ADMIN_PASSWORD = required("ADMIN_DEV_PASSWORD");
const ORIGIN = process.env.ADMIN_WEB_ORIGIN ?? "http://localhost:3100";
const SCHEMA_ID = process.env.ORY_IDENTITY_SCHEMA_ID ?? "preset://email";
// Named once here and passed to grantAll; the writer reads no default of its own.
const TENANT_ID = process.env.TENANT_DEFAULT_ID ?? "tenant-local";

const PERMISSIONS = [
  "analytics:read",
  "automation:create",
  "automation:read",
  "brands:create",
  "brands:delete",
  "brands:read",
  "brands:update",
  "cart:create",
  "cart:read",
  "categories:create",
  "categories:delete",
  "categories:read",
  "categories:update",
  "components:create",
  "components:read",
  "content:create",
  "content:read",
  "content:update",
  "coupons:create",
  "coupons:read",
  "customer360:read",
  "customers:read",
  "experience:create",
  "experience:read",
  "experiments:create",
  "experiments:read",
  "finance:manage",
  "finance:read",
  "fulfillment:create",
  "fulfillment:read",
  "inventory:read",
  "localization:read",
  "loyalty:read",
  "notifications:create",
  "notifications:read",
  "orders:read",
  "organizations:create",
  "pages:read",
  "payments:read",
  "products:create",
  "products:delete",
  "products:read",
  "products:update",
  "promotions:create",
  "promotions:read",
  "recommendations:create",
  "recommendations:read",
  "reporting:read",
  "returns:create",
  "returns:read",
  "reviews:create",
  "reviews:read",
  "search:create",
  "search:read",
  "seo:read",
  "shipping:create",
  "shipping:read",
  "tenancy:create",
  "tenancy:read",
  "tenancy:update",
  "theme:create",
  "theme:read",
  "users:create",
  "wishlist:create",
  "wishlist:read",
];

const api = (path, init = {}) =>
  fetch(`${ORY}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${KEY}`,
      ...(init.headers ?? {}),
    },
  });

function clientBody() {
  return {
    client_id: CLIENT_ID,
    client_name: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    redirect_uris: [`${ORIGIN}/auth/callback`],
    // Must cover every scope the middleware asks for, or Ory rejects the authorization request
    // with `invalid_scope` and admin-web redirect-loops on /login?error=invalid_scope.
    // `openid morbeh.admin` is what apps/admin-web/src/middleware.ts requests; `morbeh.admin` also
    // matches scripts/dev/mint-local-token.mjs's own client. `offline_access` backs the
    // refresh_token grant below.
    scope: "openid offline_access morbeh.admin",
    audience: [AUDIENCE],
    token_endpoint_auth_method: "client_secret_post",
    // Ory Network's default is an OPAQUE access token (`ory_at_...`, 2 segments). The runtime's
    // JwtVerifier (packages/auth/src/jwt-verifier.ts) only accepts a real RS256 JWT verifiable
    // against AUTH_JWKS_URL — an opaque token fails verification outright, independent of any
    // authorization/Keto concern. Measured directly against this project on 2026-09-04: setting
    // this field is what turns `/api/v1/products` from 401 into 200. Hydra supports this as a
    // per-client field since it introduced token strategies; no project-level (workspace-key-gated)
    // config is needed.
    access_token_strategy: "jwt",
  };
}

async function ensureOAuthClient() {
  const existing = await api(`/admin/clients/${encodeURIComponent(CLIENT_ID)}`);
  const method = existing.status === 200 ? "PUT" : "POST";
  const path =
    method === "PUT" ? `/admin/clients/${encodeURIComponent(CLIENT_ID)}` : "/admin/clients";
  const res = await api(path, { method, body: JSON.stringify(clientBody()) });
  if (!res.ok) throw new Error(`${method} client failed: ${res.status} ${await res.text()}`);
  console.log(`OAuth2 client "${CLIENT_ID}" ${method === "PUT" ? "updated" : "created"}.`);
}

async function ensureIdentity() {
  const found = await api(
    `/admin/identities?credentials_identifier=${encodeURIComponent(ADMIN_EMAIL)}`,
  );
  if (found.ok) {
    const list = await found.json();
    if (Array.isArray(list) && list.length > 0) {
      // Re-assert metadata_public: `kind`/`roles` are what login/page.tsx reads onto the Hydra
      // login request's context, which becomes the access token's claims. A pre-existing identity
      // created without them would authenticate but carry no role, failing every role gate.
      const id = list[0].id;
      const patched = await api(`/admin/identities/${id}`, {
        method: "PATCH",
        body: JSON.stringify([
          { op: "replace", path: "/metadata_public", value: { kind: "staff", roles: ["admin"] } },
        ]),
      });
      if (!patched.ok) {
        throw new Error(`patch identity failed: ${patched.status} ${await patched.text()}`);
      }
      console.log(`Identity ${ADMIN_EMAIL} already existed (${id}) — metadata_public re-asserted.`);
      return id;
    }
  }
  const created = await api("/admin/identities", {
    method: "POST",
    body: JSON.stringify({
      schema_id: SCHEMA_ID,
      traits: { email: ADMIN_EMAIL },
      metadata_public: { kind: "staff", roles: ["admin"] },
      credentials: { password: { config: { password: ADMIN_PASSWORD } } },
    }),
  });
  if (!created.ok)
    throw new Error(`create identity failed: ${created.status} ${await created.text()}`);
  const identity = await created.json();
  console.log(`Identity ${ADMIN_EMAIL} created (${identity.id}).`);
  return identity.id;
}

// The Ory Network OPL namespace matching packages/auth/src/keto.ts's `subjectConvention:
// "subject_set"` default (see infrastructure/ory/network/permissions.opl.ts's `User` class):
// every principal is a subject-set member of `User` with an empty relation, not a direct
// subject_id. Must match keto.ts's `subjectSetNamespace` default exactly, or checks silently deny.
const SUBJECT_SET_NAMESPACE = "User";

/** `object` is the tenant-qualified permission (`tenant/<tenantId>/<permission>`). */
function grantTupleBody(subjectId, object) {
  return {
    namespace: "permissions",
    object,
    relation: "granted",
    subject_set: { namespace: SUBJECT_SET_NAMESPACE, object: subjectId, relation: "" },
  };
}

/**
 * Ory Permissions (Keto) is a separately-provisioned service on Ory Network, configured through
 * OPL (Ory Permission Language) rather than accepting raw namespace writes. Two independent
 * blockers were measured directly against a live project on 2026-09-04:
 *  1. HTTP 400 "subject_id is not supported; please migrate to subject sets" writing with
 *     `subject_id` — fixed by this function (and packages/auth/src/keto.ts's read-side match)
 *     using `subject_set` instead, mirroring infrastructure/ory/network/permissions.opl.ts.
 *  2. HTTP 404 "Unknown namespace" — the OPL file above is not yet uploaded to the project. That
 *     upload (`ory patch opl` or Ory Console → Permissions → Configure) needs a WORKSPACE API key
 *     (`ory_wak_...`, from api.console.ory.com), a different credential than this script's
 *     `ORY_API_KEY` (a project-scoped `ory_pat_...`, confirmed to get HTTP 403 against the
 *     workspace management API). Still blocked on that as of this fix — see the runbook.
 * Separately, `/relation-tuples/check` (the read side) returned HTTP 403 with the *same* API key
 * that successfully drives Identity/OAuth2/relation-tuple *writes*, for both subject_id and
 * subject_set shaped queries — an as-yet-unexplained third blocker, independent of the above, that
 * needs investigating once the namespace 404 is resolved. Reported rather than thrown either way:
 * the client and identity above are still fully usable without Permissions, and `KetoAccessControl`
 * fails closed, so a half-granted store would be worse than none.
 */
const GRANT_PACING_MS = 300;
const GRANT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether this exact grant tuple exists (a filtered list on object, relation and subject set). */
async function grantExists(body) {
  const params = new URLSearchParams({
    namespace: body.namespace,
    object: body.object,
    relation: body.relation,
    "subject_set.namespace": body.subject_set.namespace,
    "subject_set.object": body.subject_set.object,
    "subject_set.relation": body.subject_set.relation,
  });
  const res = await api(`/relation-tuples?${params.toString()}`);
  if (res.status !== 200) {
    throw new Error(`read back "${body.object}" failed: ${res.status} ${await res.text()}`);
  }
  return ((await res.json()).relation_tuples ?? []).length > 0;
}

/** PUT a grant and re-issue it with backoff until a read-back sees it; throw if it never lands. */
async function putVerified(body) {
  for (const delay of [0, ...GRANT_RETRY_DELAYS_MS]) {
    if (delay > 0) await sleep(delay);
    const res = await api("/admin/relation-tuples", { method: "PUT", body: JSON.stringify(body) });
    if (!res.ok)
      throw new Error(`grant "${body.object}" failed: ${res.status} ${await res.text()}`);
    if (await grantExists(body)) return;
  }
  throw new Error(
    `grant "${body.object}": Ory answered 2xx but the tuple never appeared ` +
      "(see docs/operations/KETO_TENANT_MIGRATION.md). Re-run this script; grants are idempotent.",
  );
}

async function grantAll(subjectId, tenantId) {
  const probe = await api("/admin/relation-tuples", {
    method: "PUT",
    body: JSON.stringify(grantTupleBody(subjectId, `tenant/${tenantId}/${PERMISSIONS[0]}`)),
  });

  if (!probe.ok) {
    const body = await probe.text();
    console.warn(
      `\n! Ory Permissions is not usable yet (HTTP ${probe.status}).\n` +
        `  ${body.slice(0, 300)}\n\n` +
        `  The grant model now matches Ory Network (subject_set, not subject_id — see this\n` +
        `  function's doc comment). The remaining blocker is almost certainly the OPL namespace\n` +
        `  never having been uploaded to this project, which needs a Workspace API key this script\n` +
        `  does not have. See docs/operations/CLOUD_RUNBOOK.md for the exact unblock steps.\n\n` +
        `  The OAuth2 client and admin identity above ARE seeded and fully usable; authentication\n` +
        `  works. Only authorization is affected.\n\n` +
        `  Until this is resolved, leave KETO_READ_URL unset with APP_ENV=local so the runtime's\n` +
        `  documented local escape hatch (composition.ts) applies. Pointing KETO_READ_URL at this\n` +
        `  endpoint would be strictly worse than leaving it unset: KetoAccessControl fails closed,\n` +
        `  so every permission would be DENIED with nothing in the logs to explain why.`,
    );
    return false;
  }

  // The probe proved Permissions is usable. Now write (and read back) every grant, the probe's
  // included: a 2xx from Ory Network is not proof that a tuple persisted.
  for (const permission of PERMISSIONS) {
    await putVerified(grantTupleBody(subjectId, `tenant/${tenantId}/${permission}`));
    await sleep(GRANT_PACING_MS);
  }
  console.log(
    `Granted all ${PERMISSIONS.length} permissions to ${subjectId} (tenant/${tenantId}/, each read back).`,
  );
  return true;
}

await ensureOAuthClient();
const identityId = await ensureIdentity();
const permissionsGranted = await grantAll(identityId, TENANT_ID);

console.log(`\nOry Network seeded.`);
console.log(`  project      : ${ORY}`);
console.log(`  identity id  : ${identityId}   (${ADMIN_EMAIL})`);
console.log(
  `  permissions  : ${permissionsGranted ? `${PERMISSIONS.length} granted` : "SKIPPED — see warning above"}`,
);
