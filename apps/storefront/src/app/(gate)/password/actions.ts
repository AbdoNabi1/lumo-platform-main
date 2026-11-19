"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ACCESS_COOKIE,
  ACCESS_COOKIE_MAX_AGE_SECONDS,
  signAccessCookie,
} from "@/lib/access-cookie";
import { safeReturnTo } from "@/lib/return-to";
import { currentShopId, RUNTIME_API_URL } from "@/lib/runtime-api";
import { storefrontSecrets } from "@/lib/storefront-env";

export type UnlockState =
  | { readonly status: "idle" | "incorrect" | "unavailable" }
  | { readonly status: "rate_limited"; readonly minutes: number };

/** Passwords are 4–100 characters; anything far past that is never sent (it cannot be right). */
const PASSWORD_MAX = 200;
/** The Runtime hashes the attempt (scrypt), so allow it more than a plain read. */
const UNLOCK_TIMEOUT_MS = 5_000;

/**
 * Spec 1.5: the password goes to the Runtime once; only an HMAC proof is stored in the cookie. The
 * proof is signed with the access version from THIS answer (Ruling 3), so a later password change or
 * re-lock (a new version) revokes it. A blank attempt is refused here and never spends one of the
 * shop-wide attempts (Ruling 4).
 */
export async function unlockAction(
  _previous: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  const secret = storefrontSecrets().accessSecret;
  if (secret === null) return { status: "unavailable" };
  const password = formData.get("password");
  if (
    typeof password !== "string" ||
    password.trim().length === 0 ||
    password.length > PASSWORD_MAX
  )
    return { status: "incorrect" };
  const shopId = await currentShopId();
  let response: Response;
  try {
    response = await fetch(`${RUNTIME_API_URL}/api/v1/public/online-store/unlock`, {
      method: "POST",
      headers: { "x-tenant-id": shopId, "content-type": "application/json" },
      body: JSON.stringify({ password }),
      cache: "no-store",
      signal: AbortSignal.timeout(UNLOCK_TIMEOUT_MS),
    });
  } catch {
    return { status: "unavailable" };
  }
  if (response.status === 401) return { status: "incorrect" };
  if (response.status === 429) {
    const body = (await response.json().catch(() => null)) as { retryAfterMs?: unknown } | null;
    const header = Number(response.headers.get("retry-after") ?? "60");
    const ms =
      typeof body?.retryAfterMs === "number" && Number.isFinite(body.retryAfterMs)
        ? body.retryAfterMs
        : (Number.isFinite(header) ? header : 60) * 1000;
    return { status: "rate_limited", minutes: Math.max(1, Math.ceil(ms / 60_000)) };
  }
  // Ruling 5: anything but 200, 401 or 429 (a suspended shop's 403 included) is "unavailable".
  if (response.status !== 200) return { status: "unavailable" };
  const body = (await response.json().catch(() => null)) as { accessVersion?: unknown } | null;
  const version = body?.accessVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0)
    return { status: "unavailable" };
  const value = await signAccessCookie({
    secret,
    shopId,
    accessVersion: version,
    expUnix: Math.floor(Date.now() / 1000) + ACCESS_COOKIE_MAX_AGE_SECONDS,
  });
  // Host-only (no Domain), so a cookie for one shop's host is never sent to another's.
  (await cookies()).set(ACCESS_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  });
  redirect(safeReturnTo(formData.get("return_to")));
}
