import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import type { RegistrySnapshot } from "./registry";

/**
 * Provider-based extension surface for the Registry Engine (P1.1.1 §5). The engine stays pure infrastructure; these
 * contracts let Marketplace / Plugins / AI / future integrations import, export, resolve and validate registry
 * definitions without the engine knowing any of them. Definitions only — never runtime state.
 */

/** Deserializes an external representation (JSON/YAML/registry package) into a snapshot. */
export interface RegistryImporter<T> {
  readonly format: string;
  import(raw: string): Result<RegistrySnapshot<T>, DomainError>;
}

/** Serializes a snapshot to an external representation. */
export interface RegistryExporter<T> {
  readonly format: string;
  export(snapshot: RegistrySnapshot<T>): Result<string, DomainError>;
}

/** Resolves a definition from an external source (e.g. a marketplace registry) by key. */
export interface RegistryResolver<T> {
  readonly source: string;
  resolve(key: string): Promise<T | null>;
}

/** Structurally validates a snapshot before it is imported. */
export interface RegistrySnapshotValidator<T> {
  validate(snapshot: RegistrySnapshot<T>): Result<void, DomainError>;
}

/** A bundle of provider capabilities registered for one external ecosystem (marketplace, plugin host, AI, …). */
export interface RegistryProvider<T> {
  readonly name: string;
  readonly importer?: RegistryImporter<T>;
  readonly exporter?: RegistryExporter<T>;
  readonly resolver?: RegistryResolver<T>;
  readonly validator?: RegistrySnapshotValidator<T>;
}

/** The built-in JSON import/export provider (P1.1.1 §8). YAML/registry-package formats plug in as further providers. */
export class JsonRegistrySerializer<T> implements RegistryImporter<T>, RegistryExporter<T> {
  readonly format = "json";

  export(snapshot: RegistrySnapshot<T>): Result<string, DomainError> {
    try {
      return ok(JSON.stringify(snapshot, null, 2));
    } catch (error) {
      return err(
        new ValidationError(
          `registry export failed: ${error instanceof Error ? error.message : "unknown"}`,
        ),
      );
    }
  }

  import(raw: string): Result<RegistrySnapshot<T>, DomainError> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return err(new ValidationError("registry import failed: invalid JSON"));
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { entries?: unknown }).entries)
    ) {
      return err(
        new ValidationError("registry import failed: not a registry snapshot (missing entries[])"),
      );
    }
    return ok(parsed as RegistrySnapshot<T>);
  }
}
