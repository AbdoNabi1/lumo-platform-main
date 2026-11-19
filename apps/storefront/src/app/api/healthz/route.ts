import { NextResponse } from "next/server";

/**
 * Liveness/readiness probe target (preflight 27). Calls nothing and is outside the middleware
 * matcher, so a locked store (302 on `/`) or a Runtime outage (503) never fails a health check.
 * Precedent: admin-web's `/api/healthz`.
 */
export function GET(): NextResponse {
  return NextResponse.json({ status: "ok" });
}
