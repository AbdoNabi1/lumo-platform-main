/**
 * Reading claims out of a Hydra-issued access token.
 *
 * Edge-safe by construction — zero imports, no `node:*` — because `middleware.ts` runs on the Edge
 * runtime and needs this too. Same constraint `lib/env.ts` documents for itself.
 *
 * **Why this is not just `payload[name]`.** Whatever the consent UI puts in the accept call's
 * `session.access_token` (`app/consent/page.tsx`) is delivered by Ory Hydra nested under an `ext`
 * object in the issued JWT — it is only promoted to the top level when the deployment configures
 * `allowed_top_level_claims`, which neither `infrastructure/docker/hydra/hydra.yml` nor the Ory
 * Network project does. So on both topologies the nested shape is what is actually issued.
 *
 * Reading only the top level meant `roles` resolved to `[]` for every real browser login: the
 * session was valid, `highestRole` returned `undefined`, and the middleware redirected every gated
 * page to `/forbidden`. The failure looked like a permissions problem and was really a claim-shape
 * problem — no amount of granting fixes it.
 *
 * Top level wins when both are present: a deployment that has configured `allowed_top_level_claims`
 * is stating its intent explicitly, and honouring it also keeps this correct against a plain,
 * non-Hydra issuer.
 *
 * Mirrors `readClaim` in `packages/auth/src/jwt-verifier.ts`, which does the same for the runtime's
 * `Principal` mapping. Deliberately duplicated rather than shared: that package is a Node-side
 * workspace dependency and this must stay importable from Edge middleware.
 */
export function readTokenClaim(payload: Record<string, unknown>, name: string): unknown {
  const top = payload[name];
  if (top !== undefined) return top;
  const ext = payload["ext"];
  if (typeof ext !== "object" || ext === null || Array.isArray(ext)) return undefined;
  return (ext as Record<string, unknown>)[name];
}

/** `readTokenClaim` narrowed to the string-array shape `roles` must have; `[]` when absent. */
export function readRolesClaim(payload: Record<string, unknown>): readonly string[] {
  const claim = readTokenClaim(payload, "roles");
  return Array.isArray(claim)
    ? claim.filter((role): role is string => typeof role === "string")
    : [];
}

/** `readTokenClaim` narrowed to a string; `undefined` when absent or the wrong type. */
export function readStringClaim(
  payload: Record<string, unknown>,
  name: string,
): string | undefined {
  const claim = readTokenClaim(payload, name);
  return typeof claim === "string" ? claim : undefined;
}
