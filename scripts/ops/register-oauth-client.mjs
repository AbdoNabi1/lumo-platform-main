#!/usr/bin/env node
// Phase A.34 (A.33 P0 #10) — production OAuth2 client registration for admin-web.
// scripts/dev/seed-auth-local.mjs is dev-only (default client id/secret/redirect_uri, all pointing
// at localhost:3100) and was, until this file existed, the ONLY client-registration path in the
// repo — meaning there was no production-safe way to register the `morbeh-admin-web` Hydra client at
// all. This script has none of seed-auth-local.mjs's defaults: every value is required, and it
// refuses to run without them, same "never invent/print a credential" rule that script's own
// ADMIN_DEV_PASSWORD handling already follows.
//
// Safe to re-run: if the client already exists, this only VERIFIES its redirect_uris/audience
// match and exits non-zero on drift — it does NOT silently rotate a live client_secret. Pass
// OAUTH_CLIENT_ROTATE=true to explicitly overwrite the existing client (redirect_uris, audience,
// and client_secret) with the values below; use this deliberately, e.g. during a secret rotation.
//
// Usage: HYDRA_ADMIN_URL=... AUTH_CLIENT_ID=... AUTH_CLIENT_SECRET=... \
//        AUTH_AUDIENCE=... ADMIN_WEB_CALLBACK_URL=... node scripts/ops/register-oauth-client.mjs
//
// Required (no defaults — this is deliberate, see A.33 P0 #3/#10):
//   HYDRA_ADMIN_URL        Hydra's admin API base (cluster-internal only — never expose publicly)
//   AUTH_CLIENT_ID         e.g. morbeh-admin-web
//   AUTH_CLIENT_SECRET     the real production secret — from the secret manager, never typed here
//   AUTH_AUDIENCE          e.g. morbeh-admin
//   ADMIN_WEB_CALLBACK_URL e.g. https://admin.morbeh.example.com/auth/callback
// Optional:
//   OAUTH_CLIENT_ROTATE    "true" to overwrite an already-registered client (default: verify only)

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required (no default — never invented). Set it before running.`);
  }
  return value;
}

const HYDRA_ADMIN_URL = requireEnv("HYDRA_ADMIN_URL");
const CLIENT_ID = requireEnv("AUTH_CLIENT_ID");
const CLIENT_SECRET = requireEnv("AUTH_CLIENT_SECRET");
const AUDIENCE = requireEnv("AUTH_AUDIENCE");
const REDIRECT_URI = requireEnv("ADMIN_WEB_CALLBACK_URL");
const ROTATE = process.env.OAUTH_CLIENT_ROTATE === "true";

if (!REDIRECT_URI.startsWith("https://") && !REDIRECT_URI.startsWith("http://localhost")) {
  throw new Error(
    `ADMIN_WEB_CALLBACK_URL must be HTTPS in production (got "${REDIRECT_URI}") — refusing to register a plaintext-HTTP redirect URI.`,
  );
}

const desiredClient = {
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET,
  client_name: "Morbeh Admin Web",
  grant_types: ["authorization_code"],
  response_types: ["code"],
  redirect_uris: [REDIRECT_URI],
  token_endpoint_auth_method: "client_secret_post",
  scope: "openid morbeh.admin",
  audience: [AUDIENCE],
  subject_type: "public",
};

async function main() {
  const existing = await fetch(`${HYDRA_ADMIN_URL}/admin/clients/${CLIENT_ID}`);

  if (existing.status === 404) {
    const created = await fetch(`${HYDRA_ADMIN_URL}/admin/clients`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(desiredClient),
    });
    if (!created.ok) {
      throw new Error(`failed to create Hydra client: ${created.status} ${await created.text()}`);
    }
    console.error(
      `Registered new Hydra OAuth2 client "${CLIENT_ID}" (redirect_uri: ${REDIRECT_URI}).`,
    );
    return;
  }

  if (!existing.ok) {
    throw new Error(
      `unexpected Hydra admin response checking client: ${existing.status} ${await existing.text()}`,
    );
  }

  const current = await existing.json();
  const redirectMatches =
    Array.isArray(current.redirect_uris) &&
    current.redirect_uris.length === 1 &&
    current.redirect_uris[0] === REDIRECT_URI;
  const audienceMatches =
    Array.isArray(current.audience) &&
    current.audience.length === 1 &&
    current.audience[0] === AUDIENCE;

  if (redirectMatches && audienceMatches && !ROTATE) {
    console.error(`Hydra client "${CLIENT_ID}" already registered and matches — nothing to do.`);
    return;
  }

  if (!ROTATE) {
    console.error(
      `Hydra client "${CLIENT_ID}" already exists but drifted from the desired configuration:\n` +
        `  redirect_uris: ${JSON.stringify(current.redirect_uris)} (want [${REDIRECT_URI}])\n` +
        `  audience:      ${JSON.stringify(current.audience)} (want [${AUDIENCE}])\n` +
        `Re-run with OAUTH_CLIENT_ROTATE=true to overwrite it (this also rotates client_secret) — ` +
        `refusing to do that implicitly.`,
    );
    process.exitCode = 1;
    return;
  }

  const updated = await fetch(`${HYDRA_ADMIN_URL}/admin/clients/${CLIENT_ID}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(desiredClient),
  });
  if (!updated.ok) {
    throw new Error(`failed to update Hydra client: ${updated.status} ${await updated.text()}`);
  }
  console.error(`Rotated Hydra OAuth2 client "${CLIENT_ID}" (redirect_uri: ${REDIRECT_URI}).`);
}

try {
  await main();
} catch (error) {
  console.error("Could not register the production OAuth2 client.");
  console.error(String(error));
  process.exitCode = 1;
}
