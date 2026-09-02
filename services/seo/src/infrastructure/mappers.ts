import { UniqueEntityId } from "@platform/domain";
import { Redirect } from "../domain/redirect";
import { RobotsPolicy } from "../domain/robots-policy";
import { SeoProfile } from "../domain/seo-profile";
import { Sitemap } from "../domain/sitemap";
import { SeoMetadata, type RedirectStatusCode, type RobotsRule } from "../domain/value-objects/seo";

export interface SeoProfileRow {
  readonly id: string;
  readonly pageRef: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly canonicalUrl: string | null;
  readonly ogImageRef: string | null;
  readonly version: number;
}

export interface RedirectRow {
  readonly id: string;
  readonly fromPath: string;
  readonly toPath: string;
  readonly statusCode: RedirectStatusCode;
  readonly active: boolean;
  readonly version: number;
}

export interface SitemapRow {
  readonly id: string;
  readonly name: string;
  readonly urls: readonly string[];
  readonly lastGeneratedAt: Date | null;
  readonly version: number;
}

export interface RobotsPolicyRow {
  readonly id: string;
  readonly userAgent: string;
  readonly rules: readonly RobotsRule[];
  readonly version: number;
}

export class SeoProfileMapper {
  static toDomain(row: SeoProfileRow): SeoProfile {
    return SeoProfile.reconstitute(
      UniqueEntityId.from(row.id),
      row.pageRef,
      SeoMetadata.create({
        title: row.title ?? undefined,
        description: row.description ?? undefined,
        canonicalUrl: row.canonicalUrl ?? undefined,
        ogImageRef: row.ogImageRef ?? undefined,
      }),
      row.version,
    );
  }

  static toRow(profile: SeoProfile, tenantId: string) {
    return {
      id: profile.id.toString(),
      tenantId,
      pageRef: profile.pageRef,
      title: profile.metadata.title ?? null,
      description: profile.metadata.description ?? null,
      canonicalUrl: profile.metadata.canonicalUrl ?? null,
      ogImageRef: profile.metadata.ogImageRef ?? null,
      version: 1,
    };
  }
}

export class RedirectMapper {
  static toDomain(row: RedirectRow): Redirect {
    return Redirect.reconstitute(
      UniqueEntityId.from(row.id),
      row.fromPath,
      row.toPath,
      row.statusCode,
      row.active,
      row.version,
    );
  }

  static toRow(redirect: Redirect, tenantId: string) {
    return {
      id: redirect.id.toString(),
      tenantId,
      fromPath: redirect.fromPath,
      toPath: redirect.toPath,
      statusCode: redirect.statusCode,
      active: redirect.active,
      version: 1,
    };
  }
}

export class SitemapMapper {
  static toDomain(row: SitemapRow): Sitemap {
    return Sitemap.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      row.urls,
      row.version,
      row.lastGeneratedAt ?? undefined,
    );
  }

  static toRow(sitemap: Sitemap, tenantId: string) {
    return {
      id: sitemap.id.toString(),
      tenantId,
      name: sitemap.name,
      urls: sitemap.urls,
      lastGeneratedAt: sitemap.lastGeneratedAt ?? null,
      version: 1,
    };
  }
}

export class RobotsPolicyMapper {
  static toDomain(row: RobotsPolicyRow): RobotsPolicy {
    return RobotsPolicy.reconstitute(
      UniqueEntityId.from(row.id),
      row.userAgent,
      row.rules,
      row.version,
    );
  }

  static toRow(policy: RobotsPolicy, tenantId: string) {
    return {
      id: policy.id.toString(),
      tenantId,
      userAgent: policy.userAgent,
      rules: policy.rules,
      version: 1,
    };
  }
}
