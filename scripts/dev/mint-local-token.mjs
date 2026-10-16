#!/usr/bin/env node
// Phase 8 — local dev bearer token minting. Mints a REAL RS256 access token from Hydra (the
// runtime's JwtVerifier verifies against exactly this issuer/JWKS — see
// packages/auth/src/jwt-verifier.ts and D-048c). This is NOT an auth bypass: it drives the real
// OAuth2 client_credentials grant so a human can call the Runtime API without a browser login flow.
// Create-or-update (PUT) the client every run, so both the secret and access_token_strategy are
// reasserted even against a client that already existed before a fix landed here — not just on
// first creation. Works against both self-hosted Hydra (docker-compose.yml, dsn=memory — clients
// don't survive restarts) and Ory Network.
//
// Ory Network specifics, measured directly against a live project on 2026-09-04:
//  - Admin API calls need the project API key (ORY_API_KEY) — self-hosted Hydra needs none, so it
//    is attached only when set, same convention as apps/runtime/src/ory-fetch.ts.
//  - Ory Network's default access_token_strategy is OPAQUE (`ory_at_...`, 2 segments), which
//    JwtVerifier rejects outright. `access_token_strategy: "jwt"` is a per-client field Hydra has
//    supported since it introduced token strategies — no project-level (workspace-key-gated)
//    config is needed. Harmless no-op against self-hosted Hydra, which already defaults to JWT.
//
// SECURITY: a hardcoded default secret is only safe against an ephemeral, unauthenticated,
// localhost Hydra (self-hosted, dsn=memory — nothing to leak, gone on restart). The instant
// ORY_API_KEY is set (Ory Network mode: a real, addressable, internet-reachable project), that
// default would provision a well-known secret onto a live IdP — measured directly: this happened
// for real on 2026-09-04, caught in review, and the resulting client was deleted from the live
// project. So the default is refused outright in Ory Network mode; DEV_CLI_CLIENT_SECRET must be
// set explicitly (and never committed).
//
// Usage: node scripts/dev/mint-local-token.mjs
//   HYDRA_ADMIN_URL       (default http://localhost:4445)
//   HYDRA_PUBLIC_URL      (default http://localhost:4444)
//   AUTH_AUDIENCE         (default morbeh-admin, matches apps/runtime/src/config.ts default)
//   ORY_API_KEY           (optional — required admin-auth on Ory Network, unused self-hosted;
//                          its presence is also what triggers the DEV_CLI_CLIENT_SECRET
//                          requirement below)
//   DEV_CLI_CLIENT_SECRET (required when ORY_API_KEY is set; ignored/defaulted otherwise)

const HYDRA_ADMIN_URL = process.env.HYDRA_ADMIN_URL ?? "http://localhost:4445";
const HYDRA_PUBLIC_URL = process.env.HYDRA_PUBLIC_URL ?? "http://localhost:4444";
const AUDIENCE = process.env.AUTH_AUDIENCE ?? "morbeh-admin";
const ORY_API_KEY = process.env.ORY_API_KEY;
const CLIENT_ID = "morbeh-dev-cli";
const IS_ORY_NETWORK = ORY_API_KEY !== undefined && ORY_API_KEY !== "";
const CLIENT_SECRET = IS_ORY_NETWORK
  ? requiredForOryNetwork("DEV_CLI_CLIENT_SECRET")
  : (process.env.DEV_CLI_CLIENT_SECRET ?? "morbeh-dev-cli-secret-change-me");

function requiredForOryNetwork(name) {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(
      `${name} is required when ORY_API_KEY is set (Ory Network mode) — refusing to provision ` +
        `a hardcoded default secret onto a live, internet-reachable Ory project. Set ${name} to a ` +
        `strong random value and keep it out of any committed file.`,
    );
  }
  return v;
}

function adminHeaders(extra = {}) {
  if (ORY_API_KEY === undefined || ORY_API_KEY === "") return extra;
  return { ...extra, authorization: `Bearer ${ORY_API_KEY}` };
}

function clientBody() {
  return {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_types: ["client_credentials"],
    token_endpoint_auth_method: "client_secret_post",
    audience: [AUDIENCE],
    scope: "morbeh.admin",
    access_token_strategy: "jwt",
  };
}

async function ensureClient() {
  const existing = await fetch(`${HYDRA_ADMIN_URL}/admin/clients/${CLIENT_ID}`, {
    headers: adminHeaders(),
  });
  if (existing.status !== 200 && existing.status !== 404) {
    throw new Error(`unexpected Hydra admin response checking client: ${existing.status}`);
  }

  const method = existing.status === 200 ? "PUT" : "POST";
  const path =
    method === "PUT"
      ? `${HYDRA_ADMIN_URL}/admin/clients/${CLIENT_ID}`
      : `${HYDRA_ADMIN_URL}/admin/clients`;
  const res = await fetch(path, {
    method,
    headers: adminHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(clientBody()),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `failed to ${method === "PUT" ? "update" : "create"} Hydra dev client: ${res.status} ${body}`,
    );
  }
}

async function mintToken() {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    audience: AUDIENCE,
    scope: "morbeh.admin",
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
