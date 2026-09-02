/**
 * @platform/registry — the Registry Engine (Platform Kernel, ADR-0055). A reusable, versioned, tagged,
 * metadata-carrying registration primitive with a uniform lifecycle and discovery, so every registry
 * (Feature, Usage, Provider, Prompt, Schema, …) is configuration rather than a bespoke subsystem. Pure
 * infrastructure — it owns no business logic and depends on no bounded context.
 */
export { Registry } from "./registry";
export type {
  RegistryEntry,
  RegistryLifecycle,
  RegistryQuery,
  RegistryOptions,
  RegistryValidator,
  RegisterInput,
  RegistryDescriptor,
  RegistrySnapshot,
  RegistrySnapshotEntry,
} from "./registry";
export { JsonRegistrySerializer } from "./providers";
export type {
  RegistryProvider,
  RegistryImporter,
  RegistryExporter,
  RegistryResolver,
  RegistrySnapshotValidator,
} from "./providers";
