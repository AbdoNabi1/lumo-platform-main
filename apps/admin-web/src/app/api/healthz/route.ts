import { NextResponse } from "next/server";

/**
 * Liveness/readiness probe target (Phase A.34). Deliberately calls nothing — no cookie read, no
 * Hydra/Kratos/Admin-API fetch — so container/k8s health checks never depend on the auth backend
 * being reachable. Listed in `middleware.ts`'s `PUBLIC_PREFIXES` so it's never gated behind auth.
 */
export function GET(): NextResponse {
  return NextResponse.json({ status: "ok" });
}
