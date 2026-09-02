# @platform/application

Application-layer foundation shared by every future microservice. **Framework-free** and
**infrastructure-free** (depends only on the kernel: `@platform/types`, `@platform/utils`),
so it never violates the Clean Architecture rule that application code must not depend on
infrastructure (docs/architecture/02).

## Contents

| Area                 | Exports                                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency injection | `createContainer`, `Container`, `createToken`, `InjectionToken`, `DependencyResolutionError`                                                                                |
| CQRS                 | `Command`/`CommandHandler`/`CommandResult`, `Query`/`QueryHandler`/`QueryResult`, `InMemoryCommandBus`, `InMemoryQueryBus`, `HandlerNotFoundError`, `DuplicateHandlerError` |
| Use-cases            | `UseCase<TInput, TOutput, TError>` (returns `Result`)                                                                                                                       |
| Middleware           | `Middleware`, `MiddlewareContext`, `NextFunction`, `Pipeline`                                                                                                               |

## Notes

- **Result / errors** come from the shared kernel: `Result` + helpers from `@platform/types`, the
  `DomainError` hierarchy from `@platform/utils`. They are not redefined here.
- **Repository ports** live in `@platform/repository`; their **Prisma adapter foundation** lives in
  the infrastructure package `@platform/db`. This package depends on neither — services wire
  concrete adapters to ports via the DI container.
- Buses are mediators: handlers register by `command.type` / `query.type`; a middleware `Pipeline`
  wraps execution. The command and query buses share one internal dispatcher (no duplicated logic).
