import { ValueObject } from "@platform/domain";

/**
 * The hierarchical levels a security grant/policy can be scoped to (broad → narrow). A scope that
 * leaves a level undefined is a **wildcard** at that level, which is how broader grants contain
 * narrower ones (permission inheritance / hierarchical scoping — ADR-0023, sprint Part 2).
 */
export const SCOPE_LEVELS = ["organization", "tenant", "workspace", "environment"] as const;
export type ScopeLevel = (typeof SCOPE_LEVELS)[number];

export interface SecurityScopeProps {
  readonly organization?: string;
  readonly tenant?: string;
  readonly workspace?: string;
  readonly environment?: string;
}

/**
 * An addressable scope of authority. Platform-wide = every level undefined. Containment is the
 * inheritance rule: **this** scope contains **other** iff, for every level this defines, other
 * defines the same value — so `{tenant:T}` contains `{tenant:T, workspace:W, environment:prod}`
 * but not `{tenant:U,…}`. Immutable value object (structural equality).
 */
export class SecurityScope extends ValueObject<SecurityScopeProps> {
  private constructor(props: SecurityScopeProps) {
    super(props);
  }

  /** Platform-wide scope — contains every other scope. */
  static platform(): SecurityScope {
    return new SecurityScope({});
  }

  static of(props: SecurityScopeProps): SecurityScope {
    const clean: SecurityScopeProps = {
      ...(props.organization !== undefined ? { organization: props.organization } : {}),
      ...(props.tenant !== undefined ? { tenant: props.tenant } : {}),
      ...(props.workspace !== undefined ? { workspace: props.workspace } : {}),
      ...(props.environment !== undefined ? { environment: props.environment } : {}),
    };
    return new SecurityScope(clean);
  }

  static tenant(tenant: string): SecurityScope {
    return SecurityScope.of({ tenant });
  }

  get organization(): string | undefined {
    return this.props.organization;
  }
  get tenant(): string | undefined {
    return this.props.tenant;
  }
  get workspace(): string | undefined {
    return this.props.workspace;
  }
  get environment(): string | undefined {
    return this.props.environment;
  }

  /** True when no level is constrained (platform-wide authority). */
  get isPlatformWide(): boolean {
    return (
      this.props.organization === undefined &&
      this.props.tenant === undefined &&
      this.props.workspace === undefined &&
      this.props.environment === undefined
    );
  }

  /** Hierarchical containment: every level THIS constrains must match OTHER exactly (undefined = wildcard). */
  contains(other: SecurityScope): boolean {
    for (const level of SCOPE_LEVELS) {
      const mine = this.props[level];
      if (mine !== undefined && other.props[level] !== mine) return false;
    }
    return true;
  }

  /** Stable key for indexing/read models, e.g. `org=*;tenant=t1;workspace=*;env=*`. */
  key(): string {
    return SCOPE_LEVELS.map((level) => `${level}=${this.props[level] ?? "*"}`).join(";");
  }
}
