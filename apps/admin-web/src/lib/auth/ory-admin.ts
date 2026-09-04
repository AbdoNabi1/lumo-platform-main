import { authConfig } from "./config";

/**
 * Headers for a Hydra **Admin** API call (login/consent challenge fetch and accept). Server-only —
 * `authConfig` is server-only for the same reason, and the project API key must never reach a
 * Client Component.
 *
 * Ory Network authenticates these admin endpoints with a project API key; the self-hosted Hydra in
 * `infrastructure/docker/docker-compose.yml` does not. With no key configured this returns the
 * caller's headers untouched, so the self-hosted topology behaves exactly as it did before.
 *
 * Deliberately NOT used for `hydraPublicUrl`'s `/oauth2/token` or any `kratosPublicUrl` call —
 * those are public endpoints authenticated by `client_secret` or the browser session cookie, and
 * sending a project API key to them is both wrong and liable to be rejected.
 */
export function oryAdminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = authConfig.oryApiKey;
  if (key === undefined || key.length === 0) return { ...extra };
  return { ...extra, authorization: `Bearer ${key}` };
}
