interface WorkspaceConfigProps {
  readonly themeRef?: string;
  readonly branding?: Readonly<Record<string, string>>;
  readonly logoRef?: string;
  readonly customDomain?: string;
  readonly locale?: string;
  readonly currency?: string;
  readonly timezone?: string;
  readonly markets?: readonly string[];
  readonly defaultLanguage?: string;
  readonly regionalSettings?: Readonly<Record<string, string>>;
}

/**
 * A workspace's white-label / storefront configuration (ADR-0008 Sprint-5.6 addendum §2) — theme,
 * branding, domain, locale/currency/timezone/markets. Set via `Workspace.configure()` (patch
 * semantics, only provided fields change). Stays in Tenancy/Workspace — never Identity or Theme.
 */
export class WorkspaceConfig {
  private readonly props: WorkspaceConfigProps;

  private constructor(props: WorkspaceConfigProps) {
    this.props = props;
  }

  static empty(): WorkspaceConfig {
    return new WorkspaceConfig({});
  }

  static from(props: WorkspaceConfigProps): WorkspaceConfig {
    return new WorkspaceConfig({ ...props });
  }

  /** Patch-merges `patch` onto this config — only provided fields change. */
  patch(patch: WorkspaceConfigProps): WorkspaceConfig {
    return new WorkspaceConfig({ ...this.props, ...patch });
  }

  toJSON(): WorkspaceConfigProps {
    return { ...this.props };
  }

  get themeRef(): string | undefined {
    return this.props.themeRef;
  }

  get branding(): Readonly<Record<string, string>> | undefined {
    return this.props.branding;
  }

  get logoRef(): string | undefined {
    return this.props.logoRef;
  }

  get customDomain(): string | undefined {
    return this.props.customDomain;
  }

  get locale(): string | undefined {
    return this.props.locale;
  }

  get currency(): string | undefined {
    return this.props.currency;
  }

  get timezone(): string | undefined {
    return this.props.timezone;
  }

  get markets(): readonly string[] | undefined {
    return this.props.markets;
  }

  get defaultLanguage(): string | undefined {
    return this.props.defaultLanguage;
  }

  get regionalSettings(): Readonly<Record<string, string>> | undefined {
    return this.props.regionalSettings;
  }
}
