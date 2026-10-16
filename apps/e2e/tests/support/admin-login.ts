import { expect, type Page } from "@playwright/test";

/**
 * Drives the REAL admin-web sign-in flow — there is no shortcut. `admin-web`'s session cookie is
 * an RS256 JWT verified against Hydra's live JWKS (`apps/admin-web/src/middleware.ts`,
 * `apps/admin-web/src/lib/auth/session.ts`), so a test cannot fabricate one; it has to walk the
 * same redirect chain a real operator's browser would:
 *
 *   protected page → middleware redirects to Hydra `/oauth2/auth` (no session yet)
 *     → Hydra sends the browser to its configured login UI, `admin-web`'s own `/login`, with a
 *       `login_challenge` → `handleLoginChallenge` (`apps/admin-web/src/app/login/page.tsx`) finds
 *       no Kratos session and hands off to Kratos's self-service login flow
 *     → Kratos redirects back to `/login?flow=…`, where `admin-web` renders Kratos's own flow
 *       nodes as a real `<form>` that POSTs directly to Kratos (`renderKratosLoginForm`) — this
 *       app never sees the password
 *     → on success, Kratos/Hydra redirect through `/auth/callback`
 *       (`apps/admin-web/src/app/auth/callback/route.ts`), which exchanges the code for the real
 *       JWT, sets the `morbeh_admin_session` cookie, and redirects back to the original page.
 *
 * The identity itself must already exist in Kratos with the given credentials — run
 * `apps/e2e/scripts/seed-e2e-identities.mjs` first (see `playwright.config.ts`'s doc
 * comment for the full prerequisite sequence). Selectors target Kratos's flow node `name`
 * attributes (`identifier`/`password`), not admin-web markup, since `renderNode` renders Kratos's
 * node list directly — those names are Kratos's own UI schema, not something this app controls.
 */
export async function loginToAdminWeb(page: Page, email: string, password: string): Promise<void> {
  const identifier = page.locator('input[name="identifier"]');
  await expect(identifier).toBeVisible({ timeout: 30_000 });
  await identifier.fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="password"]').press("Enter");

  // The redirect chain above ends back on whatever page triggered the login — as long as it's not
  // still "/login" (Kratos) or an external Hydra/Kratos origin, sign-in completed.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}
