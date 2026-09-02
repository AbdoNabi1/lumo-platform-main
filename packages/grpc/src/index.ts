import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  loadPackageDefinition,
  Server,
  ServerCredentials,
  type GrpcObject,
  type ServerInterceptor,
  type ServiceDefinition,
  type UntypedServiceImplementation,
} from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

const PROTO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../protos");

/**
 * Loads a versioned proto contract from this package's `protos/` tree (Sprint 2.6, D-047).
 * Runtime loading via proto-loader: no manual serialization, no codegen toolchain — the .proto
 * files are the single source of truth. When `@platform/api-clients` (G-18) arrives, buf-based
 * static codegen replaces the loader for CLIENTS without changing any contract.
 */
export function loadProto(relativePath: string): GrpcObject {
  const definition = loadSync(path.join(PROTO_ROOT, relativePath), {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_ROOT],
  });
  return loadPackageDefinition(definition);
}

export interface GrpcServiceBinding {
  readonly definition: ServiceDefinition;
  readonly implementation: UntypedServiceImplementation;
}

export interface GrpcServerOptions {
  /** Cross-cutting interceptors (auth, tenant, tracing, logging) — the middleware seam. */
  readonly interceptors?: readonly ServerInterceptor[];
}

/**
 * gRPC server factory. Handlers are adapters that delegate to the existing framework-agnostic
 * controllers — zero business logic, same rule as HTTP routes. Bind + start is the caller's
 * (worker entrypoint's) job; credentials are insecure ONLY inside the mesh (mTLS terminates at
 * the mesh layer per doc 14 §5 — direct exposure requires TLS credentials injected here).
 */
export function createGrpcServer(
  services: readonly GrpcServiceBinding[],
  options: GrpcServerOptions = {},
): Server {
  const server = new Server(
    options.interceptors !== undefined ? { interceptors: [...options.interceptors] } : {},
  );
  for (const service of services) {
    server.addService(service.definition, service.implementation);
  }
  return server;
}

export { ServerCredentials };
