import { UniqueEntityId } from "@platform/domain";
import { ShopDomain, type ShopDomainKind, type ShopDomainStatus } from "../domain/shop-domain";
import { Tenant, type TenantIsolationTier, type TenantStatus } from "../domain/tenant";
import { Hostname } from "../domain/value-objects/hostname";
import { TenantSlug } from "../domain/value-objects/tenant-slug";
import { WorkspaceConfig } from "../domain/value-objects/workspace-config";
import { Workspace, type WorkspaceEnv, type WorkspaceStatus } from "../domain/workspace";

export interface TenantRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: TenantStatus;
  readonly isolationTier: TenantIsolationTier;
  readonly branding: Readonly<Record<string, string>>;
  readonly subscriptionRef: string | null;
  readonly version: number;
}

export interface WorkspaceRow {
  readonly id: string;
  readonly tenantRef: string;
  readonly env: WorkspaceEnv;
  readonly name: string;
  readonly status: WorkspaceStatus;
  readonly config: Record<string, unknown>;
  readonly version: number;
}

export class TenantMapper {
  static toDomain(row: TenantRow): Tenant {
    const slug = TenantSlug.create(row.slug);
    if (!slug.ok) throw new Error(`Corrupt tenant row: invalid slug (${slug.error.message})`);
    return Tenant.reconstitute(
      UniqueEntityId.from(row.id),
      slug.value,
      row.name,
      row.status,
      row.isolationTier,
      row.branding,
      row.version,
      row.subscriptionRef ?? undefined,
    );
  }

  static toRow(tenant: Tenant, tenantId: string) {
    return {
      id: tenant.id.toString(),
      tenantId,
      slug: tenant.slug.value,
      name: tenant.name,
      status: tenant.status,
      isolationTier: tenant.isolationTier,
      branding: tenant.branding,
      subscriptionRef: tenant.subscriptionRef ?? null,
      version: 1,
    };
  }
}

export class WorkspaceMapper {
  static toDomain(row: WorkspaceRow): Workspace {
    return Workspace.reconstitute(
      UniqueEntityId.from(row.id),
      row.tenantRef,
      row.env,
      row.name,
      row.status,
      WorkspaceConfig.from(row.config),
      row.version,
    );
  }

  static toRow(workspace: Workspace, tenantId: string) {
    return {
      id: workspace.id.toString(),
      tenantId,
      tenantRef: workspace.tenantRef,
      env: workspace.env,
      name: workspace.name,
      status: workspace.status,
      config: workspace.config.toJSON(),
      version: 1,
    };
  }
}

export interface ShopDomainRow {
  readonly id: string;
  readonly shopRef: string;
  readonly hostname: string;
  readonly kind: ShopDomainKind;
  readonly status: ShopDomainStatus;
  readonly isPrimary: boolean;
  readonly verifiedAt: Date | null;
  readonly version: number;
}

export class ShopDomainMapper {
  static toDomain(row: ShopDomainRow): ShopDomain {
    const hostname = Hostname.create(row.hostname);
    if (!hostname.ok) throw new Error(`Corrupt shop_domains row: ${hostname.error.message}`);
    return ShopDomain.reconstitute(
      UniqueEntityId.from(row.id),
      {
        shopRef: row.shopRef,
        hostname: hostname.value,
        kind: row.kind,
        status: row.status,
        isPrimary: row.isPrimary,
        ...(row.verifiedAt === null ? {} : { verifiedAt: row.verifiedAt }),
      },
      row.version,
    );
  }

  static toRow(domain: ShopDomain, tenantId: string) {
    return {
      id: domain.id.toString(),
      tenantId,
      shopRef: domain.shopRef,
      hostname: domain.hostname.value,
      kind: domain.kind,
      status: domain.status,
      isPrimary: domain.isPrimary,
      verifiedAt: domain.verifiedAt ?? null,
      version: 1,
    };
  }
}
