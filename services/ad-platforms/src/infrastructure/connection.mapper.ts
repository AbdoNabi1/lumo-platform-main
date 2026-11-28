import {
  AD_PLATFORMS,
  Connection,
  validatePublicConfig,
  type AdPlatform,
  type PublicConfig,
} from "../domain/connection";
import { jsonOrDbNull, type AdPlatformConnectionRow } from "./rows";

function notValid(column: string): Error {
  // Never the stored value: the message must not carry row content.
  return new Error(`ad_platform_connections.${column} is not valid`);
}

function platformOf(value: string): AdPlatform {
  const found = AD_PLATFORMS.find((candidate) => candidate === value);
  if (found === undefined) throw notValid("platform");
  return found;
}

/** Row → aggregate. Throws on an unknown platform or a public config that fails validation. */
export function rowToConnection(row: AdPlatformConnectionRow): Connection {
  const platform = platformOf(row.platform);
  let publicConfig: PublicConfig | null = null;
  if (row.publicConfig !== null && row.publicConfig !== undefined) {
    const validated = validatePublicConfig(platform, row.publicConfig);
    if (!validated.ok) throw notValid("public_config");
    publicConfig = validated.value;
  }
  return Connection.restore({
    id: row.id,
    platform,
    enabled: row.enabled,
    publicConfig,
    sealedSecret: row.sealedSecret,
    secretLast4: row.secretLast4,
    testEventCode: row.testEventCode,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** Aggregate → `create` data; the tenant comes from the caller's argument, never from the connection. */
export function connectionToCreateData(tenantId: string, connection: Connection) {
  const p = connection.props;
  return {
    id: p.id,
    tenantId,
    platform: p.platform,
    enabled: p.enabled,
    publicConfig: jsonOrDbNull(p.publicConfig),
    sealedSecret: p.sealedSecret,
    secretLast4: p.secretLast4,
    testEventCode: p.testEventCode,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** Aggregate → `updateMany` data: identity columns (`id`, tenant, platform, `createdAt`) never change. */
export function connectionToUpdateData(connection: Connection) {
  const p = connection.props;
  return {
    enabled: p.enabled,
    publicConfig: jsonOrDbNull(p.publicConfig),
    sealedSecret: p.sealedSecret,
    secretLast4: p.secretLast4,
    testEventCode: p.testEventCode,
    version: p.version,
    updatedAt: p.updatedAt,
  };
}
