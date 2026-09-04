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
// ADMIN_WEB_ORIGIN from the environment.

function required(name) {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`${name} is required`);
  return v;
}

const ORY = required("ORY_SDK_URL").replace(/\/$/, "");
const KEY = required("ORY_API_KEY");
const CLIENT_ID = process.env.AUTH_CLIENT_ID ?? "lumo-admin-web";
const CLIENT_SECRET = required("AUTH_CLIENT_SECRET");
const AUDIENCE = process.env.AUTH_AUDIENCE ?? "lumo-admin";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@lumo.local";
const ADMIN_PASSWORD = required("ADMIN_DEV_PASSWORD");
const ORIGIN = process.env.ADMIN_WEB_ORIGIN ?? "http://localhost:3100";
const SCHEMA_ID = process.env.ORY_IDENTITY_SCHEMA_ID ?? "preset://email";

const PERMISSIONS = [
  "analytics:read", "automation:create", "automation:read",
  "brands:create", "brands:delete", "brands:read", "brands:update",
  "cart:create", "cart:read",
  "categories:create", "categories:delete", "categories:read", "categories:update",
  "components:create", "components:read",
  "content:create", "content:read", "content:update",
  "coupons:create", "coupons:read",
  "customer360:read", "customers:read",
  "experience:create", "experience:read",
  "experiments:create", "experiments:read",
  "finance:manage", "finance:read",
  "fulfillment:create", "fulfillment:read",
  "inventory:read", "localization:read", "loyalty:read",
  "notifications:create", "notifications:read",
  "orders:read", "organizations:create",
  "pages:read", "payments:read",
  "products:create", "products:delete", "products:read", "products:update",
  "promotions:create", "promotions:read",
  "recommendations:create", "recommendations:read",
  "reporting:read", "returns:create", "returns:read",
  "reviews:create", "reviews:read",
  "search:create", "search:read", "seo:read",
  "shipping:create", "shipping:read",
  "tenancy:create", "tenancy:read", "tenancy:update",
  "theme:create", "theme:read",
  "users:create", "wishlist:create", "wishlist:read",
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
    // `openid lumo.admin` is what apps/admin-web/src/middleware.ts requests; `lumo.admin` also
    // matches scripts/dev/mint-local-token.mjs's own client. `offline_access` backs the
    // refresh_token grant below.
    scope: "openid offline_access lumo.admin",
    audience: [AUDIENCE],
    token_endpoint_auth_method: "client_secret_post",
  };
}

async function ensureOAuthClient() {
  const existing = await api(`/admin/clients/${encodeURIComponent(CLIENT_ID)}`);
  const method = existing.status === 200 ? "PUT" : "POST";
  const path = method === "PUT" ? `/admin/clients/${encodeURIComponent(CLIENT_ID)}` : "/admin/clients";
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
  if (!created.ok) throw new Error(`create identity failed: ${created.status} ${await created.text()}`);
  const identity = await created.json();
  console.log(`Identity ${ADMIN_EMAIL} created (${identity.id}).`);
  return identity.id;
}

/**
 * Ory Permissions (Keto) is a separately-provisioned service on Ory Network: on a project where it
 * is not enabled, `/relation-tuples/check` answers 403 with the same API key that Identity and
 * OAuth2 accept. That is reported rather than thrown, because the client and identity above are
 * still fully usable without it — and because `KetoAccessControl` fails closed, a half-granted
 * store would be worse than none. See the runbook for what to do about the 403.
 */
async function grantAll(subjectId) {
  const probe = await api("/admin/relation-tuples", {
    method: "PUT",
    body: JSON.stringify({
      namespace: "permissions",
      object: PERMISSIONS[0],
      relation: "granted",
      subject_id: subjectId,
    }),
  });

  if (!probe.ok) {
    const body = await probe.text();
    console.warn(
      `\n! Ory Permissions is not usable for this grant model (HTTP ${probe.status}).\n` +
        `  ${body.slice(0, 300)}\n\n` +
        `  Two distinct blockers were measured against this project on 2026-09-04:\n` +
        `   1. HTTP 400 "subject_id is not supported; please migrate to subject sets" — Ory Network\n` +
        `      refuses concrete-subject writes, but KetoAccessControl (packages/auth/src/keto.ts)\n` +
        `      checks with subject_id. The repo's grant model and Ory Network's disagree.\n` +
        `   2. HTTP 404 on a subject_set write — the OPL namespaces are not configured at all.\n\n` +
        `  The OAuth2 client and admin identity above ARE seeded and fully usable; authentication\n` +
        `  works. Only authorization is affected.\n\n` +
        `  Until this is resolved, leave KETO_READ_URL unset with APP_ENV=local so the runtime's\n` +
        `  documented local escape hatch (composition.ts) applies. Pointing KETO_READ_URL at this\n` +
        `  endpoint would be strictly worse than leaving it unset: KetoAccessControl fails closed,\n` +
        `  so every permission would be DENIED with nothing in the logs to explain why.`,
    );
    return false;
  }

  for (const permission of PERMISSIONS.slice(1)) {
    const res = await api("/admin/relation-tuples", {
      method: "PUT",
      body: JSON.stringify({
        namespace: "permissions",
        object: permission,
        relation: "granted",
        subject_id: subjectId,
      }),
    });
    if (!res.ok) throw new Error(`grant "${permission}" failed: ${res.status} ${await res.text()}`);
  }
  console.log(`Granted all ${PERMISSIONS.length} permissions to ${subjectId}.`);
  return true;
}

await ensureOAuthClient();
const identityId = await ensureIdentity();
const permissionsGranted = await grantAll(identityId);

console.log(`\nOry Network seeded.`);
console.log(`  project      : ${ORY}`);
console.log(`  identity id  : ${identityId}   (${ADMIN_EMAIL})`);
console.log(`  permissions  : ${permissionsGranted ? `${PERMISSIONS.length} granted` : "SKIPPED — see warning above"}`);
