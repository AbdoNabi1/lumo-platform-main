import type { HttpFetch } from "@platform/auth";

/**
 * Ory Network authenticates its permission/identity APIs with a project API key (`ory_pat_...`);
 * the self-hosted Keto in `infrastructure/docker/keto/keto.yml` requires none. The token is
 * attached here, at the one injected `fetch` seam in `composition.ts`, rather than inside
 * `@platform/auth` — that package models Ory's HTTP contract and must stay agnostic about which
 * deployment topology (self-hosted vs managed) it is talking to.
 *
 * Why this matters more than a normal missing header: `KetoAccessControl.authorize`
 * (`packages/auth/src/keto.ts`) returns `false` on any non-200 because it fails closed. An
 * unauthenticated call against Ory Network therefore does not surface as an error — it silently
 * denies every permission on the platform. There is no loud failure mode to notice, so the token
 * has to be right by construction.
 *
 * `apiKey` absent or empty returns a plain passthrough, keeping the self-hosted/local topology
 * byte-for-byte unchanged — the same present/absent convention `composition.ts` already uses for
 * S3 and Stripe. Empty is treated as absent so a blank env var cannot send a meaningless
 * `Authorization: Bearer ` header that Ory would reject with a confusing 401.
 */
export function createOryFetch(
  apiKey: string | undefined,
  inner: HttpFetch = (url, init) => fetch(url, init),
): HttpFetch {
  if (!isOryNetworkApiKey(apiKey)) return inner;
  return (url, init) =>
    inner(url, {
      ...init,
      headers: { ...(init?.headers ?? {}), authorization: `Bearer ${apiKey}` },
    });
}

/**
 * Whether `apiKey` should be treated as "this is Ory Network" — present AND non-empty. The single
 * source of truth for that present/absent convention: `createOryFetch` above uses it to decide
 * whether to attach the bearer token, and `composition.ts` uses it to decide `KetoAccessControl`'s
 * `subjectConvention` (Ory Network's OPL namespaces require subject-set tuples; self-hosted Keto
 * requires subject_id). A blank-but-set env var must resolve the same way in both places — an
 * earlier version of the `subjectConvention` check only tested `!== undefined`, so a blank
 * `ORY_API_KEY` picked "subject_set" (Ory Network's shape) while `createOryFetch` picked "no auth
 * header" (self-hosted's shape) — sending unauthenticated subject_set queries at self-hosted Keto,
 * which has no `User` namespace, failing every check closed with nothing in the logs to explain why.
 */
export function isOryNetworkApiKey(apiKey: string | undefined): apiKey is string {
  return apiKey !== undefined && apiKey.length > 0;
}
