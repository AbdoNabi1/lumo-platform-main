#!/usr/bin/env node
/**
 * Ory Tunnel launcher for the Ory Network topology.
 *
 * WHY THIS EXISTS
 * ---------------
 * `apps/admin-web/src/app/login/page.tsx` resolves the caller's Kratos session by forwarding the
 * browser's `cookie` header to `${KRATOS_PUBLIC_URL}/sessions/whoami` server-side. Its own doc
 * comment states the assumption that makes this work:
 *
 *   "localhost cookies are host-only (no explicit Domain), so the Ory RFC 6265 rule that cookies
 *    are NOT port-scoped means Kratos's session cookie (set at :4433) is sent by the browser to
 *    this app at :3100 too"
 *
 * That holds for self-hosted Kratos on `localhost:4433` — same host, different port. It does NOT
 * hold for Ory Network, where Kratos lives on `<slug>.projects.oryapis.com`: a different
 * registrable domain, so the browser never sends that cookie to `localhost:3100`. `whoami` then
 * returns 401 on every request, `/login` bounces back to Kratos, Kratos sees a valid session and
 * returns — and admin-web redirect-loops forever on `/login?login_challenge=...`.
 *
 * The Ory Tunnel is Ory's own answer to exactly this: it mirrors the Ory Network APIs on
 * `localhost`, so the session cookie is set on `localhost` and the assumption above holds again.
 *
 * USAGE
 * -----
 *   node scripts/dev/ory-tunnel.mjs
 *
 * Requires ORY_API_KEY in the environment (it is re-exported as ORY_PROJECT_API_KEY, which is the
 * name the Ory CLI reads for non-interactive auth). Then point admin-web at it:
 *
 *   KRATOS_PUBLIC_URL=http://localhost:4000
 *
 * Not needed for the self-hosted docker-compose topology — there, KRATOS_PUBLIC_URL is
 * http://localhost:4433 and cookies already work.
 */
import { spawn } from "node:child_process";

const PORT = process.env.ORY_TUNNEL_PORT ?? "4000";
const APP_URL = process.env.ADMIN_WEB_ORIGIN ?? "http://localhost:3100";
const apiKey = process.env.ORY_API_KEY;

if (apiKey === undefined || apiKey === "") {
  console.error("ORY_API_KEY is required (the Ory Network project API key, ory_pat_...).");
  process.exit(1);
}

// Do NOT pass --project: the CLI refuses it when a project API key is set ("project API key is set
// but project flag is also set"), since the key already scopes the request to one project.
// --port is explicit because the tunnel's own default is 3080 — the runtime API's port.
const child = spawn(
  "npx",
  ["--yes", "@ory/cli", "tunnel", "--port", PORT, "--quiet", APP_URL],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ORY_PROJECT_API_KEY: apiKey },
  },
);

child.on("exit", (code, signal) => {
  if (signal) return;
  if (code !== 0) console.error(`[ory-tunnel] exited with code ${code}`);
  process.exitCode = code ?? 0;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
