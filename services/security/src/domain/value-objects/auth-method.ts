/**
 * The provider-agnostic authentication method kinds (sprint P2.0-B §1). Security is **never** coupled
 * to Kratos/Auth0/Cognito/Clerk — a concrete provider is a plugin behind `AuthenticationProviderPort`
 * that declares which of these it serves.
 */
export const AUTH_METHOD_KINDS = [
  "password",
  "passkey", // WebAuthn
  "magic_link",
  "otp",
  "email_verification",
  "phone_verification",
  "oauth",
  "oidc",
  "saml",
  "ldap",
  "enterprise_sso",
] as const;
export type AuthMethodKind = (typeof AUTH_METHOD_KINDS)[number];

export function isAuthMethodKind(value: string): value is AuthMethodKind {
  return (AUTH_METHOD_KINDS as readonly string[]).includes(value);
}

/** The provider-agnostic MFA method kinds (sprint P2.0-B §2). */
export const MFA_METHOD_KINDS = [
  "totp",
  "webauthn",
  "sms_otp",
  "email_otp",
  "backup_code",
] as const;
export type MfaMethodKind = (typeof MFA_METHOD_KINDS)[number];

export function isMfaMethodKind(value: string): value is MfaMethodKind {
  return (MFA_METHOD_KINDS as readonly string[]).includes(value);
}

/** The strength a satisfied MFA requirement demands — drives step-up decisions. */
export type MfaRequirement = "none" | "optional" | "required" | "step_up";

/**
 * A registered authentication-method definition (sprint P2.0-B §1/§6). Held in the Registry Engine
 * (`packages/registry`, versioned) — configuration, never runtime logic. The actual verification is a
 * provider plugin behind `AuthenticationProviderPort`.
 */
export interface AuthMethodSpec {
  readonly kind: AuthMethodKind;
  readonly enabled: boolean;
  readonly displayName: string;
  readonly config?: Readonly<Record<string, string>>;
}

/** A registered MFA-method definition (sprint P2.0-D §6, Registry Engine — versioned configuration). */
export interface MfaMethodSpec {
  readonly kind: MfaMethodKind;
  readonly enabled: boolean;
  readonly displayName: string;
}

/** A registered permission definition (sprint P2.0-D §6) — the discoverable catalog of permissions. */
export interface PermissionDef {
  readonly permission: string;
  readonly description: string;
}
