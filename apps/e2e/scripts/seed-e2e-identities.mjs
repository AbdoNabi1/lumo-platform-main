#!/usr/bin/env node
// T6.1 (Phase 6) — provisions the three role identities the `authorization` and
// `operator-create-product` specs need. Modeled directly on `scripts/dev/seed-auth-local.mjs`
// (same Hydra/Kratos/Keto admin-API shape, same in-memory-dsn-gets-wiped-on-restart caveat), but
// extended two ways that script deliberately doesn't need for its own purpose:
//
//   1. Three identities, one per `ROUTE_ROLE_REQUIREMENTS` role (`apps/admin-web/src/
//      middleware.ts`), not one admin identity — the `authorization` spec needs a real viewer and
//      a real operator to prove each gets redirected to `/forbidden` above its own level.
//   2. The operator identity is granted `products:create`/`products:publish` Keto tuples in
//      addition to the read set — `seed-auth-local.mjs`'s own READ_PERMISSIONS list has no write
//      grants at all, so its seeded "admin" identity could sign in but could NOT actually create a
//      product against the real backend; `operator-create-product.spec.ts` needs to.
//
// Usage: node apps/e2e/scripts/seed-e2e-identities.mjs
//   HYDRA_ADMIN_URL   (default http://localhost:4445)
//   KRATOS_ADMIN_URL  (default http://localhost:4434)
//   KETO_WRITE_URL    (default http://localhost:4467)
//   AUTH_CLIENT_ID    (default lumo-admin-web, must match the client seed-auth-local.mjs/admin-web use)
//   AUTH_CLIENT_SECRET (default lumo-admin-web-secret-change-me — dev-only placeholder)
//   E2E_PASSWORD      (REQUIRED — no default; refuses to run without it, never invents/prints one)

const HYDRA_ADMIN_URL = process.env.HYDRA_ADMIN_URL ?? "http://localhost:4445";
const KRATOS_ADMIN_URL = process.env.KRATOS_ADMIN_URL ?? "http://localhost:4434";
const KETO_WRITE_URL = process.env.KETO_WRITE_URL ?? "http://localhost:4467";
const CLIENT_ID = process.env.AUTH_CLIENT_ID ?? "lumo-admin-web";
const CLIENT_SECRET = process.env.AUTH_CLIENT_SECRET ?? "lumo-admin-web-secret-change-me";
const REDIRECT_URI = process.env.ADMIN_WEB_CALLBACK_URL ?? "http://localhost:3100/auth/callback";
const AUDIENCE = process.env.AUTH_AUDIENCE ?? "lumo-admin";
const PASSWORD = process.env.E2E_PASSWORD;

// These three helpers are the one place raw JSON leaves Kratos's response and becomes a typed
// value this script trusts — a runtime `typeof` check, not just a TS assertion, so a
// malformed/unexpected response fails loudly (empty id) rather than silently. Kratos's admin API
// has no generated client here, so this is the JSON/JS boundary type-aware lint rules exist to
// flag; the checks below are the actual safety net, not a lint workaround. `parseJson`'s explicit
// `unknown` return type (a real function-signature boundary, unlike a variable-level `@type` cast)
// is what actually stops `Body.json()`'s built-in `Promise<any>` from leaking `any` into every
// caller below it.
/** @param {unknown} value @returns {value is { readonly id: string }} */
function hasStringId(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    "id" in value &&
    typeof (/** @type {{ id?: unknown }} */ (value).id) === "string"
  );
}

/** @param {Response} response @returns {Promise<unknown>} */
async function parseJson(response) {
  return response.json();
}

/** @param {Response} response @returns {Promise<{ readonly id: string }>} */
async function readCreatedIdentity(response) {
  const body = await parseJson(response);
  return { id: hasStringId(body) ? body.id : "" };
}

/** @param {Response} response @returns {Promise<readonly { readonly id: string }[]>} */
async function readIdentityList(response) {
  const body = await parseJson(response);
  if (!Array.isArray(body)) return [];
  return body.filter(hasStringId);
}

const READ_PERMISSIONS = [
  "customers:read",
  "products:read",
  "categories:read",
  "orders:read",
  "fulfillment:read",
  "shipping:read",
  "returns:read",
  "payments:read",
  "content:read",
  "automation:read",
  "coupons:read",
  "analytics:read",
  "finance:read",
  "inventory:read",
];

// Exactly what `operator-create-product.spec.ts` exercises against the real backend —
// `apps/admin/src/http/admin-routes.ts`'s `permission` field for `POST /products` and
// `POST /products/:productId/publish`.
const OPERATOR_WRITE_PERMISSIONS = ["products:create", "products:update", "products:publish"];

/** @typedef {readonly [email: string, role: "viewer" | "operator" | "admin", extraPermissions: readonly string[]]} SeedIdentity */

/** One seed row per `ROUTE_ROLE_REQUIREMENTS` role, extra Keto permissions beyond READ_PERMISSIONS. */
const IDENTITIES = /** @type {readonly SeedIdentity[]} */ ([
  ["e2e-viewer@lumo.local", "viewer", []],
  ["e2e-operator@lumo.local", "operator", OPERATOR_WRITE_PERMISSIONS],
  ["e2e-admin@lumo.local", "admin", OPERATOR_WRITE_PERMISSIONS],
]);

async function ensureHydraClient() {
  const existing = await fetch(`${HYDRA_ADMIN_URL}/admin/clients/${CLIENT_ID}`);
  if (existing.status === 200) return;
  if (existing.status !== 404) {
    throw new Error(`unexpected Hydra admin response checking client: ${existing.status}`);
  }
  const created = await fetch(`${HYDRA_ADMIN_URL}/admin/clients`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      client_name: "Lumo Admin Web",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "client_secret_post",
      scope: "openid lumo.admin",
      audience: [AUDIENCE],
      subject_type: "public",
    }),
  });
  if (!created.ok) {
    throw new Error(
      `failed to create Hydra admin-web client: ${created.status} ${await created.text()}`,
    );
  }
}

/**
 * @param {string} email
 * @param {"viewer" | "operator" | "admin"} role
 * @returns {Promise<string>} the Kratos identity id
 */
async function ensureIdentity(email, role) {
  if (PASSWORD === undefined || PASSWORD.length === 0) {
    throw new Error(
      "E2E_PASSWORD is required (no default, never invented) — set it in your shell before seeding.",
    );
  }
  const list = await fetch(
    `${KRATOS_ADMIN_URL}/admin/identities?credentials_identifier=${encodeURIComponent(email)}`,
  );
  if (!list.ok) {
    throw new Error(`failed to list Kratos identities: ${list.status} ${await list.text()}`);
  }
  const found = await readIdentityList(list);
  if (found.length > 0) {
    return found[0].id;
  }
  const created = await fetch(`${KRATOS_ADMIN_URL}/admin/identities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schema_id: "default",
      traits: { email },
      metadata_public: { kind: "staff", roles: [role] },
      credentials: { password: { config: { password: PASSWORD } } },
    }),
  });
  if (!created.ok) {
    throw new Error(
      `failed to create Kratos identity ${email}: ${created.status} ${await created.text()}`,
    );
  }
  return (await readCreatedIdentity(created)).id;
}

/**
 * @param {string} identityId
 * @param {string} permission
 */
async function grantPermission(identityId, permission) {
  const response = await fetch(`${KETO_WRITE_URL}/admin/relation-tuples`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      namespace: "permissions",
      object: permission,
      relation: "granted",
      subject_id: identityId,
    }),
  });
  if (!response.ok) {
    throw new Error(`failed to grant "${permission}": ${response.status} ${await response.text()}`);
  }
}

try {
  await ensureHydraClient();
  for (const [email, role, extraPermissions] of IDENTITIES) {
    const identityId = await ensureIdentity(email, role);
    const permissions =
      role === "viewer" ? READ_PERMISSIONS : [...READ_PERMISSIONS, ...extraPermissions];
    for (const permission of permissions) {
      await grantPermission(identityId, permission);
    }
    console.error(`Seeded ${role}: ${email} (${identityId}), ${permissions.length} Keto grants.`);
  }
} catch (error) {
  console.error(
    "Could not seed e2e identities — is the infra stack up? " +
      "(docker compose -f infrastructure/docker/docker-compose.yml up -d keto kratos hydra)",
  );
  console.error(String(error));
  process.exitCode = 1;
}
