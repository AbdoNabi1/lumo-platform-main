import { cookies } from "next/headers";
import { GUEST_SESSION_COOKIE, GUEST_SESSION_COOKIE_OPTIONS } from "./cart";

/**
 * The caller's guest session (the HttpOnly cookie that proves cart/checkout ownership), minted when
 * missing. Lives here — not in a `"use server"` module — because every export of such a module is a
 * Server Action the browser can call; this is a helper that only server actions use. Never called
 * from a read path — only from a mutation that is about to need one.
 */
export async function currentOrNewSessionRef(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(GUEST_SESSION_COOKIE)?.value;
  if (existing !== undefined && existing.length > 0) return existing;

  const sessionRef = crypto.randomUUID();
  jar.set(GUEST_SESSION_COOKIE, sessionRef, GUEST_SESSION_COOKIE_OPTIONS);
  return sessionRef;
}
