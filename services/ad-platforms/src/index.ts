export { wireAdPlatforms, connectionsForDelivery } from "./composition";
export type {
  AdPlatformsWiringDeps,
  ConnectionsForDelivery,
  WiredAdPlatforms,
} from "./composition";
export { ConnectionsController } from "./interfaces/connections.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export {
  AD_PLATFORMS,
  Connection,
  PUBLIC_ID_PATTERNS,
  SECRET_RULE,
  SERVER_PLATFORMS,
  validatePublicConfig,
  type AdPlatform,
  type ConnectionProps,
  type PublicConfig,
} from "./domain/connection";
export type { ConnectionRepository } from "./domain/connection-repository";
export { CredentialStorageUnavailableError } from "./domain/errors";
export type { CredentialPolicy, CredentialVaultPort, DeliverySyncPort } from "./application/ports";
export {
  SECRET_MESSAGE,
  type ConnectionView,
  type LiveConnection,
  type PublicAdPlatformsView,
  type SaveConnectionInput,
} from "./application/connections.use-cases";
export { InMemoryCredentialVault } from "./infrastructure/in-memory-credential-vault";
export { InMemoryConnectionRepository } from "./infrastructure/in-memory-connection-repository";
