import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { TenancyChanged } from "./events/tenancy-changed.event";
import { WorkspaceConfig } from "./value-objects/workspace-config";

export type WorkspaceEnv = "production" | "staging" | "development";
export type WorkspaceStatus = "active" | "archived";

interface WorkspaceProps {
  readonly tenantRef: string;
  readonly env: WorkspaceEnv;
  name: string;
  status: WorkspaceStatus;
  config: WorkspaceConfig;
}

/**
 * An isolated working environment within a tenant (ADR-0008 Sprint-5.5 addendum) — distinct from
 * `tenantId`, which remains the billing/isolation boundary. A tenant has one-or-more workspaces.
 * Additively owns white-label/storefront configuration (Sprint-5.6 addendum §2).
 */
export class Workspace extends AggregateRoot<WorkspaceProps> {
  static create(
    id: UniqueEntityId,
    tenantRef: string,
    env: WorkspaceEnv,
    name: string,
    eventId: string,
    occurredAt: Date,
  ): Workspace {
    const workspace = new Workspace(
      { tenantRef, env, name, status: "active", config: WorkspaceConfig.empty() },
      id,
    );
    workspace.raise("created", eventId, occurredAt);
    return workspace;
  }

  static reconstitute(
    id: UniqueEntityId,
    tenantRef: string,
    env: WorkspaceEnv,
    name: string,
    status: WorkspaceStatus,
    config: WorkspaceConfig,
    version: number,
  ): Workspace {
    return new Workspace({ tenantRef, env, name, status, config }, id, version);
  }

  archive(eventId: string, occurredAt: Date): void {
    if (this.props.status === "archived") {
      throw new BusinessRuleError("Workspace is already archived");
    }
    this.props.status = "archived";
    this.raise("archived", eventId, occurredAt);
  }

  /** Patch-configures white-label settings (Sprint-5.6 addendum §2) — only provided fields change. */
  configure(
    patch: Parameters<WorkspaceConfig["patch"]>[0],
    eventId: string,
    occurredAt: Date,
  ): void {
    this.props.config = this.props.config.patch(patch);
    this.raise("configured", eventId, occurredAt);
  }

  private raise(action: string, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new TenancyChanged(
        { eventId, aggregateId: this.id, occurredAt },
        { ref: `${this.props.tenantRef}:${this.props.name}`, family: "workspace", action },
      ),
    );
  }

  get tenantRef(): string {
    return this.props.tenantRef;
  }

  get env(): WorkspaceEnv {
    return this.props.env;
  }

  get name(): string {
    return this.props.name;
  }

  get status(): WorkspaceStatus {
    return this.props.status;
  }

  get config(): WorkspaceConfig {
    return this.props.config;
  }
}
