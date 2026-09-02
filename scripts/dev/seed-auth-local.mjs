#!/usr/bin/env node
// Phase A.32 — local dev auth seed. Hydra/Kratos/Keto all run with `dsn: memory`
// (infrastructure/docker/{hydra,kratos,keto}/*.yml) by design (no external DB for local dev), so
// every client/identity/relation-tuple is wiped on container restart. This script re-creates the
// three pieces the Admin Web golden path needs, idempotently, every run — same shape as the
// existing scripts/dev/mint-local-token.mjs's ensureClient().
//
// Usage: node scripts/dev/seed-auth-local.mjs
//   HYDRA_ADMIN_URL   (default http://localhost:4445)
//   KRATOS_ADMIN_URL  (default http://localhost:4434)
//   KETO_WRITE_URL    (default http://localhost:4467)
//   AUTH_CLIENT_ID    (default lumo-admin-web, matches .env AUTH_CLIENT_ID)
//   AUTH_CLIENT_SECRET (default lumo-admin-web-secret-change-me — dev-only placeholder)
//   ADMIN_DEV_EMAIL   (default admin@lumo.local)
//   ADMIN_DEV_PASSWORD (REQUIRED — no default; refuses to run without it, never invents/prints one)

const HYDRA_ADMIN_URL = process.env.HYDRA_ADMIN_URL ?? "http://localhost:4445";
const KRATOS_ADMIN_URL = process.env.KRATOS_ADMIN_URL ?? "http://localhost:4434";
const KETO_WRITE_URL = process.env.KETO_WRITE_URL ?? "http://localhost:4467";
const CLIENT_ID = process.env.AUTH_CLIENT_ID ?? "lumo-admin-web";
const CLIENT_SECRET = process.env.AUTH_CLIENT_SECRET ?? "lumo-admin-web-secret-change-me";
const REDIRECT_URI = process.env.ADMIN_WEB_CALLBACK_URL ?? "http://localhost:3100/auth/callback";
const AUDIENCE = process.env.AUTH_AUDIENCE ?? "lumo-admin";
const ADMIN_EMAIL = process.env.ADMIN_DEV_EMAIL ?? "admin@lumo.local";
const ADMIN_PASSWORD = process.env.ADMIN_DEV_PASSWORD;

// Every :read permission the Admin Web screens built in Phase A.30/A.31 call through AdminGuard
// (apps/admin/src/interfaces/*.admin-controller.ts) — grep'd, not guessed.
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

async function ensureAdminIdentity() {
  if (ADMIN_PASSWORD === undefined || ADMIN_PASSWORD.length === 0) {
    throw new Error(
      "ADMIN_DEV_PASSWORD is required (no default, never invented) — set it in your shell before running this script.",
    );
  }
  const list = await fetch(
    `${KRATOS_ADMIN_URL}/admin/identities?credentials_identifier=${encodeURIComponent(ADMIN_EMAIL)}`,
  );
  if (!list.ok) {
    throw new Error(`failed to list Kratos identities: ${list.status} ${await list.text()}`);
  }
  const found = await list.json();
  if (Array.isArray(found) && found.length > 0) {
    return found[0].id;
  }
  const created = await fetch(`${KRATOS_ADMIN_URL}/admin/identities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schema_id: "default",
      traits: { email: ADMIN_EMAIL },
      metadata_public: { kind: "staff", roles: ["admin"] },
      credentials: { password: { config: { password: ADMIN_PASSWORD } } },
    }),
  });
  if (!created.ok) {
    throw new Error(
      `failed to create Kratos admin identity: ${created.status} ${await created.text()}`,
    );
  }
  const identity = await created.json();
  return identity.id;
}

async function ensurePermissionTuples(identityId) {
  for (const permission of READ_PERMISSIONS) {
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
      throw new Error(
        `failed to grant "${permission}": ${response.status} ${await response.text()}`,
      );
    }
  }
}

try {
  await ensureHydraClient();
  const identityId = await ensureAdminIdentity();
  await ensurePermissionTuples(identityId);
  console.error(
    `Auth stack seeded: Hydra client "${CLIENT_ID}", Kratos identity ${identityId} (${ADMIN_EMAIL}), ${READ_PERMISSIONS.length} Keto grants.`,
  );
} catch (error) {
  console.error(
    "Could not seed the local auth stack — is the infra stack up? " +
      "(docker compose -f infrastructure/docker/docker-compose.yml up -d keto kratos hydra)",
  );
  console.error(String(error));
  process.exitCode = 1;
}
