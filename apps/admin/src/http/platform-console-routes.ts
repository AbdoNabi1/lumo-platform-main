import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

/**
 * The Platform Console admin HTTP surface (Sprint 5.6, ADR-0018 addendum-2 §J) — exposed to
 * platform staff via `POST /platform/kpis` (the report's own literal text). Pure delegation.
 */
export function platformConsoleRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/platform/kpis",
      version: 1,
      permission: "platform-console:kpis:read",
      idempotent: true,
      summary: "Read platform-wide KPIs",
      schema: {},
      handle: ({ context }) => admin.platformConsole.getKpis(context.principal),
    }),
  ] as readonly RouteDefinition[];
}
