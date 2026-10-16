/**
 * Plan 1C: forgot / reset password calls to the runtime. Pure and never throwing, like
 * `exchangePassword` in native.ts. The token and the password are only ever sent in a POST body: never
 * in a URL we build, never logged.
 */

export type RequestResetResult = "sent" | "limited" | "unavailable";
export type CompleteResetResult = "done" | "invalid" | "weak" | "limited" | "unavailable";

const RESET_PATH = "/api/v1/public/auth/staff/password-reset";

async function post(
  url: string,
  tenantId: string,
  body: unknown,
  fetchImpl: typeof fetch | undefined,
): Promise<number | null> {
  const doFetch = fetchImpl ?? fetch;
  try {
    const response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": tenantId },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return response.status;
  } catch {
    return null;
  }
}

export async function requestReset(input: {
  readonly runtimeUrl: string;
  readonly tenantId: string;
  readonly email: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<RequestResetResult> {
  const status = await post(
    `${input.runtimeUrl}${RESET_PATH}/request`,
    input.tenantId,
    { email: input.email },
    input.fetchImpl,
  );
  if (status === 202) return "sent";
  if (status === 429) return "limited";
  return "unavailable";
}

export async function completeReset(input: {
  readonly runtimeUrl: string;
  readonly tenantId: string;
  readonly token: string;
  readonly password: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<CompleteResetResult> {
  const status = await post(
    `${input.runtimeUrl}${RESET_PATH}/complete`,
    input.tenantId,
    { token: input.token, password: input.password },
    input.fetchImpl,
  );
  if (status === 200) return "done";
  if (status === 400) return "invalid";
  if (status === 422) return "weak";
  if (status === 429) return "limited";
  return "unavailable";
}
