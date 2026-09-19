import type { DeviceRepository } from "../domain/repositories";
import type { RiskEngineSignals } from "../domain/risk-engine";
import type { GeoIpPort } from "./auth-ports";

/**
 * Enriches caller-supplied risk signals with geo/ASN/anonymizer data ({@link GeoIpPort}) and the
 * device's reputation — the single place this enrichment lives, shared by every risk evaluation
 * (no duplicated logic across `Authenticate` and `EvaluateRisk`). Pure aggregation over the ports.
 */
export async function enrichRiskSignals(
  deps: { readonly geoIp: GeoIpPort; readonly devices: DeviceRepository },
  input: {
    readonly ip?: string;
    readonly deviceFingerprint?: string;
    readonly base?: RiskEngineSignals;
  },
  tenantId: string,
): Promise<RiskEngineSignals> {
  let signals: RiskEngineSignals = { ...(input.base ?? {}) };
  if (input.ip !== undefined) {
    const geo = await deps.geoIp.lookup(input.ip);
    signals = {
      ...signals,
      ...(geo.tor !== undefined ? { tor: geo.tor } : {}),
      ...(geo.vpn !== undefined ? { vpn: geo.vpn } : {}),
      ...(geo.newGeo !== undefined ? { newGeo: geo.newGeo } : {}),
      ...(geo.ipReputation !== undefined ? { ipReputation: geo.ipReputation } : {}),
      ...(geo.asnReputation !== undefined ? { asnReputation: geo.asnReputation } : {}),
    };
  }
  if (input.deviceFingerprint !== undefined && signals.deviceReputation === undefined) {
    const device = await deps.devices.findByFingerprint(input.deviceFingerprint, tenantId);
    if (device !== null) signals = { ...signals, deviceReputation: device.reputation };
  }
  return signals;
}
