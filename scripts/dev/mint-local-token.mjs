#!/usr/bin/env node
// Phase 8 — local dev bearer token minting. Mints a REAL RS256 access token from Hydra (the
// runtime's JwtVerifier verifies against exactly this issuer/JWKS — see
// packages/auth/src/jwt-verifier.ts and D-048c). This is NOT an auth bypass: it drives the real
// OAuth2 client_credentials grant so a human can call the Runtime API without a browser login flow.
// Re-creates the client idempotently every run, so it works against both self-hosted Hydra
// (docker-compose.yml, dsn=memory — clients don't survive restarts) and Ory Network.
//
// Ory Network specifics, measured directly against a live project on 2026-09-04:
//  - Admin API calls need the project API key (ORY_API_KEY) — self-hosted Hydra needs none, so it
//    is attached only when set, same convention as apps/runtime/src/ory-fetch.ts.
//  - Ory Network's default access_token_strategy is OPAQUE (`ory_at_...`, 2 segments), which
//    JwtVerifier rejects outright. `access_token_strategy: "jwt"` is a per-client field Hydra has
//    supported since it introduced token strategies — no project-level (workspace-key-gated)
//    config is needed. Harmless no-op against self-hosted Hydra, which already defaults to JWT.
//
// Usage: node scripts/dev/mint-local-token.mjs
//   HYDRA_ADMIN_URL  (default http://localhost:4445)
//   HYDRA_PUBLIC_URL (default http://localhost:4444)
//   AUTH_AUDIENCE    (default lumo-admin, matches apps/runtime/src/config.ts default)
//   ORY_API_KEY      (optional — required admin-auth on Ory Network, unused self-hosted)

const HYDRA_ADMIN_URL = process.env.HYDRA_ADMIN_URL ?? "http://localhost:4445";
const HYDRA_PUBLIC_URL = process.env.HYDRA_PUBLIC_URL ?? "http://localhost:4444";
const AUDIENCE = process.env.AUTH_AUDIENCE ?? "lumo-admin";
const ORY_API_KEY = process.env.ORY_API_KEY;
const CLIENT_ID = "lumo-dev-cli";
const CLIENT_SECRET = "lumo-dev-cli-secret-change-me";

function adminHeaders(extra = {}) {
  if (ORY_API_KEY === undefined || ORY_API_KEY === "") return extra;
  return { ...extra, authorization: `Bearer ${ORY_API_KEY}` };
}

async function ensureClient() {
  const existing = await fetch(`${HYDRA_ADMIN_URL}/admin/clients/${CLIENT_ID}`, {
    headers: adminHeaders(),
  });
  if (existing.status === 200) return;
  if (existing.status !== 404) {
    throw new Error(`unexpected Hydra admin response checking client: ${existing.status}`);
  }

  const created = await fetch(`${HYDRA_ADMIN_URL}/admin/clients`, {
    method: "POST",
    headers: adminHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_types: ["client_credentials"],
      token_endpoint_auth_method: "client_secret_post",
      audience: [AUDIENCE],
      scope: "lumo.admin",
      access_token_strategy: "jwt",
    }),
  });
  if (!created.ok) {
    const body = await created.text();
    throw new Error(`failed to create Hydra dev client: ${created.status} ${body}`);
  }
}

async function mintToken() {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    audience: AUDIENCE,
    scope: "lumo.admin",
  });
  const response = await fetch(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`token request failed: ${response.status} ${body}`);
  }
  const json = await response.json();
  return json.access_token;
}

try {
  await ensureClient();
  const token = await mintToken();
  console.log(token);
  console.error(""); // spacer on stderr so stdout stays a clean, pipeable token
  console.error(`Bearer token minted (issuer ${HYDRA_PUBLIC_URL}/, audience ${AUDIENCE}).`);
  console.error("Example:");
  console.error(
    `  curl -H "Authorization: Bearer $(node scripts/dev/mint-local-token.mjs 2>/dev/null)" \\`,
  );
  console.error(`       -H "x-tenant-id: tenant-local" http://localhost:3080/api/v1/products`);
} catch (error) {
  console.error(
    `Could not mint a local dev token — is the infra stack up? (docker compose -f infrastructure/docker/docker-compose.yml -f infrastructure/docker/docker-compose.runtime.yml up -d)`,
  );
  console.error(String(error));
  process.exitCode = 1;
}
