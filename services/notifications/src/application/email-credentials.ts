import { readSmtpSecrets, type EmailConnectionKind } from "../domain/messaging/email-connection";
import type { StoreEmailCredentials } from "./email-connection-ports";

/**
 * Turns what the vault opened into the credentials one send needs. null for anything that is not a
 * complete, well-formed set (a half-written row must never reach a provider).
 */
export function credentialsFromSecrets(
  kind: EmailConnectionKind,
  secrets: Readonly<Record<string, string>>,
): StoreEmailCredentials | null {
  if (kind === "smtp") {
    const parsed = readSmtpSecrets(secrets);
    return parsed === null ? null : { kind, apiKey: parsed.password, smtp: parsed.settings };
  }
  const apiKey = secrets["apiKey"];
  return typeof apiKey === "string" && apiKey !== "" ? { kind, apiKey } : null;
}
