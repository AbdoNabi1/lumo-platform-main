import type { CursorPage, Paginated } from "@platform/types";
import type { Redirect } from "./redirect";
import type { RobotsPolicy } from "./robots-policy";
import type { SeoProfile } from "./seo-profile";
import type { Sitemap } from "./sitemap";

/**
 * ADR-0014 (WP-10, T10.3): every method on every repository below takes `tenantId` as an explicit
 * per-call parameter, matching `services/catalog`'s shape. None of `SeoProfile`/`Redirect`/
 * `Sitemap`/`RobotsPolicy` carry `tenantId` on the aggregate, so each `save` takes it as an
 * explicit parameter (Option B) rather than reading it off the aggregate.
 */
export interface SeoProfileRepository {
  save(profile: SeoProfile, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<SeoProfile | null>;
  findByPageRef(pageRef: string, tenantId: string, tx?: unknown): Promise<SeoProfile | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<SeoProfile>>;
}

export interface RedirectRepository {
  save(redirect: Redirect, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Redirect | null>;
  findByFromPath(fromPath: string, tenantId: string, tx?: unknown): Promise<Redirect | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Redirect>>;
}

export interface SitemapRepository {
  save(sitemap: Sitemap, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Sitemap | null>;
  findByName(name: string, tenantId: string, tx?: unknown): Promise<Sitemap | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Sitemap>>;
}

export interface RobotsPolicyRepository {
  save(policy: RobotsPolicy, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<RobotsPolicy | null>;
  findByUserAgent(userAgent: string, tenantId: string, tx?: unknown): Promise<RobotsPolicy | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<RobotsPolicy>>;
}
