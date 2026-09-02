import type { CursorPage, Paginated } from "@platform/types";
import type { Redirect } from "./redirect";
import type { RobotsPolicy } from "./robots-policy";
import type { SeoProfile } from "./seo-profile";
import type { Sitemap } from "./sitemap";

export interface SeoProfileRepository {
  save(profile: SeoProfile, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<SeoProfile | null>;
  findByPageRef(pageRef: string, tx?: unknown): Promise<SeoProfile | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<SeoProfile>>;
}

export interface RedirectRepository {
  save(redirect: Redirect, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Redirect | null>;
  findByFromPath(fromPath: string, tx?: unknown): Promise<Redirect | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Redirect>>;
}

export interface SitemapRepository {
  save(sitemap: Sitemap, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Sitemap | null>;
  findByName(name: string, tx?: unknown): Promise<Sitemap | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Sitemap>>;
}

export interface RobotsPolicyRepository {
  save(policy: RobotsPolicy, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<RobotsPolicy | null>;
  findByUserAgent(userAgent: string, tx?: unknown): Promise<RobotsPolicy | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<RobotsPolicy>>;
}
