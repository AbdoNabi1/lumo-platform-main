import { redirect } from "next/navigation";
import { authConfig } from "@/lib/auth/config";
import { oryAdminHeaders } from "@/lib/auth/ory-admin";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

/**
 * The Hydra consent provider (Phase A.32) — `infrastructure/docker/hydra/hydra.yml`'s
 * `urls.consent`. Auto-accepts: `lumo-admin-web` is a first-party, wholly-owned client (the only
 * OAuth2 client registered — `scripts/dev/seed-auth-local.mjs`), not a third-party app a human
 * needs to review a scope grant for, so there is no consent SCREEN, only a consent DECISION. The
 * `kind`/`roles` claims `/login` attached to the login request's `context` ride through into the
 * token here via `session.access_token` — this is how `JwtVerifier.toPrincipal`
 * (`packages/auth/src/jwt-verifier.ts`) gets a real, non-default `kind`/`roles` on the issued JWT.
 */
interface ConsentPageProps {
  readonly searchParams: Promise<{ readonly consent_challenge?: string }>;
}

export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const { consent_challenge: consentChallenge } = await searchParams;
  if (consentChallenge === undefined) {
    redirect("/");
  }

  const requestInfo = await fetchWithTimeout(
    `${authConfig.hydraAdminUrl}/admin/oauth2/auth/requests/consent?consent_challenge=${encodeURIComponent(consentChallenge)}`,
    { headers: oryAdminHeaders() },
  );
  if (!requestInfo.ok) {
    throw new Error(`Hydra rejected the consent request: ${requestInfo.status}`);
  }
  const info = (await requestInfo.json()) as {
    requested_scope?: readonly string[];
    requested_access_token_audience?: readonly string[];
    context?: { kind?: string; roles?: readonly string[]; email?: string };
  };

  const accept = await fetchWithTimeout(
    `${authConfig.hydraAdminUrl}/admin/oauth2/auth/requests/consent/accept?consent_challenge=${encodeURIComponent(consentChallenge)}`,
    {
      method: "PUT",
      headers: oryAdminHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        grant_scope: info.requested_scope ?? [],
        grant_access_token_audience: info.requested_access_token_audience ?? [],
        session: {
          access_token: {
            kind: info.context?.kind ?? "staff",
            roles: info.context?.roles ?? [],
            email: info.context?.email,
          },
        },
        remember: true,
        remember_for: 3600,
      }),
    },
  );
  if (!accept.ok) {
    throw new Error(`Hydra rejected the consent accept: ${accept.status}`);
  }
  const { redirect_to: redirectTo } = (await accept.json()) as { redirect_to: string };
  redirect(redirectTo);
}
