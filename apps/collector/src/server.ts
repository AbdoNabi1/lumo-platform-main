/**
 * Fastify binding for the collector.
 *
 * ## Why not `@platform/http`
 *
 * `createHttpServer` is the **authenticated** admin/API tier: every route it registers requires a
 * bearer token, a resolved tenant, a permission-guard decision and a per-principal rate-limit
 * bucket. A public browser beacon has none of those by definition — it is anonymous, its tenant
 * comes from a write key, and its rate limiting belongs at the CDN edge. Reusing that server would
 * mean injecting a stub authenticator and a stub guard into a production composition root, which is
 * precisely the kind of fake that stops being obviously a fake three months later.
 *
 * So this is a small, purpose-built binding. It is genuinely small — one route plus liveness and
 * readiness — and it borrows the operational conventions rather than the auth machinery.
 */

import Fastify, { type FastifyInstance } from "fastify";
import type { HealthRegistry } from "@platform/health";
import { parseCookieHeader } from "@platform/tracking";

import type { CollectorEndpoint } from "./collector-endpoint";

export interface CollectorServerDeps {
  readonly endpoint: CollectorEndpoint;
  readonly health: HealthRegistry;
  /** Origins allowed to POST the beacon. `["*"]` is rejected — see `resolveOrigin`. */
  readonly allowedOrigins: readonly string[];
  /** Set-Cookie `Secure` flag. False only for local HTTP development. */
  readonly secureCookies: boolean;
  /** Cookie `Domain`, so first-party ids are shared across a merchant's subdomains. */
  readonly cookieDomain?: string;
}

/** Max beacon size. A tracking event is small; anything larger is a mistake or an attack. */
const MAX_BODY_BYTES = 64 * 1024;

export function createCollectorServer(deps: CollectorServerDeps): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: MAX_BODY_BYTES });

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async (_request, reply) => {
    const report = await deps.health.run();
    return reply.status(report.status === "unhealthy" ? 503 : 200).send(report);
  });

  // Browsers preflight a cross-origin POST with a JSON content type.
  app.options("/collect", async (request, reply) => {
    const origin = resolveOrigin(request.headers.origin, deps.allowedOrigins);
    if (origin === null) return reply.status(403).send();
    return corsHeaders(reply, origin).status(204).send();
  });

  app.post("/collect", async (request, reply) => {
    const origin = resolveOrigin(request.headers.origin, deps.allowedOrigins);
    if (origin === null) {
      return reply.status(403).send({ code: "ORIGIN_NOT_ALLOWED", message: "Origin not allowed" });
    }

    const response = await deps.endpoint.handle({
      body: request.body,
      headers: (name) => headerOf(request.headers, name),
      cookies: parseCookieHeader(headerOf(request.headers, "cookie")),
      // Fastify's `request.ip` already honours `trustProxy`, which is deliberately left OFF: the
      // collector does its own X-Forwarded-For resolution with an explicit trusted-hop count, and
      // two competing notions of "the client IP" is how one of them ends up spoofable.
      ...(request.socket.remoteAddress === undefined
        ? {}
        : { remoteAddress: request.socket.remoteAddress }),
    });

    corsHeaders(reply, origin);
    for (const cookie of response.cookies) {
      void reply.header("set-cookie", serializeCookie(cookie, deps));
    }

    return reply.status(response.status).send(response.body);
  });

  return app;
}

/**
 * Echoes the request origin only when it is explicitly allow-listed.
 *
 * A wildcard is refused rather than supported. `Access-Control-Allow-Origin: *` cannot be combined
 * with `Access-Control-Allow-Credentials: true`, and the collector *needs* credentials — the
 * first-party visitor and session cookies are the whole point. A configuration that quietly dropped
 * to a wildcard would silently stop cookies from ever being sent, and the symptom would be a slow
 * bleed of session continuity rather than an error anyone sees.
 */
function resolveOrigin(origin: string | undefined, allowed: readonly string[]): string | null {
  if (origin === undefined) return null;
  return allowed.includes(origin) ? origin : null;
}

function corsHeaders(
  reply: { header(name: string, value: string): unknown },
  origin: string,
): typeof reply & { status(code: number): { send(body?: unknown): unknown } } {
  reply.header("access-control-allow-origin", origin);
  reply.header("access-control-allow-credentials", "true");
  reply.header("access-control-allow-methods", "POST, OPTIONS");
  reply.header("access-control-allow-headers", "content-type");
  // Without this a shared cache could serve one merchant's CORS response to another's origin.
  reply.header("vary", "Origin");
  return reply as never;
}

/**
 * Serializes a first-party cookie.
 *
 * `SameSite=Lax` rather than `None`: these ids identify a visitor to the site they are browsing,
 * and `None` would ship them on every third-party embed of that site. `HttpOnly` is deliberately
 * **not** set — the browser SDK reads these ids to stamp events client-side, and a cookie the SDK
 * cannot read would force it to mint its own, producing two competing visitor ids.
 */
function serializeCookie(
  cookie: { name: string; value: string; maxAgeSeconds: number },
  deps: CollectorServerDeps,
): string {
  const parts = [
    `${cookie.name}=${encodeURIComponent(cookie.value)}`,
    "Path=/",
    `Max-Age=${String(cookie.maxAgeSeconds)}`,
    "SameSite=Lax",
  ];
  if (deps.secureCookies) parts.push("Secure");
  if (deps.cookieDomain !== undefined) parts.push(`Domain=${deps.cookieDomain}`);
  return parts.join("; ");
}

function headerOf(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}
