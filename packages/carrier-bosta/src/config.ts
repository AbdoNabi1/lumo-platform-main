export interface BostaConfig {
  readonly awbFormat: "A6" | "A4";
  readonly awbLanguage: "ar" | "en";
  readonly allowToOpenPackage: boolean;
}

export const DEFAULT_BOSTA_CONFIG: BostaConfig = {
  awbFormat: "A6",
  awbLanguage: "ar",
  allowToOpenPackage: false,
};

export function parseBostaConfig(
  raw: unknown,
):
  | { readonly ok: true; readonly value: BostaConfig }
  | { readonly ok: false; readonly reason: string } {
  if (raw === undefined) return { ok: true, value: DEFAULT_BOSTA_CONFIG };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, reason: "config" };
  const value = raw as Record<string, unknown>;
  const awbFormat = value.awbFormat ?? DEFAULT_BOSTA_CONFIG.awbFormat;
  if (awbFormat !== "A6" && awbFormat !== "A4") return { ok: false, reason: "awbFormat" };
  const awbLanguage = value.awbLanguage ?? DEFAULT_BOSTA_CONFIG.awbLanguage;
  if (awbLanguage !== "ar" && awbLanguage !== "en") return { ok: false, reason: "awbLanguage" };
  const allowToOpenPackage = value.allowToOpenPackage ?? DEFAULT_BOSTA_CONFIG.allowToOpenPackage;
  if (typeof allowToOpenPackage !== "boolean") return { ok: false, reason: "allowToOpenPackage" };
  return { ok: true, value: { awbFormat, awbLanguage, allowToOpenPackage } };
}
