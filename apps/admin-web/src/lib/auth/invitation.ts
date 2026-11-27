/**
 * Wave 1d: accepting a staff invitation from the public page. Pure and never throwing, like
 * `completeReset` in password-reset.ts. The invitation token and the chosen password are only ever
 * sent in a POST body: never in a URL we build, never logged. A merchant's emailed link carries the
 * store, which selects the merchant route (the tenant is the platform tenant, the store goes in the
 * body); a link without one uses the platform team's staff route.
 */

export type AcceptInvitationResult = "done" | "invalid" | "weak" | "limited" | "unavailable";

const PUBLIC = "/api/v1/public/auth";

export async function acceptInvitation(input: {
  readonly runtimeUrl: string;
  readonly tenantId: string;
  /** The store the link names; absent for the platform team's own link. */
  readonly store?: string;
  readonly token: string;
  readonly password: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<AcceptInvitationResult> {
  const doFetch = input.fetchImpl ?? fetch;
  const merchant = input.store !== undefined && input.store.length > 0;
  const url = `${input.runtimeUrl}${PUBLIC}/${merchant ? "merchant" : "staff"}/invitations/accept`;
  const body = merchant
    ? { store: input.store, token: input.token, password: input.password }
    : { token: input.token, password: input.password };
  let status: number;
  try {
    const response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": input.tenantId },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    status = response.status;
  } catch {
    return "unavailable";
  }
  if (status === 200) return "done";
  // One uniform answer for every bad link (unknown, used, revoked, expired, wrong store).
  if (status === 410) return "invalid";
  if (status === 422) return "weak";
  if (status === 429) return "limited";
  return "unavailable";
}
