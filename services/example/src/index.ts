export { wireExample } from "./composition";
export type { ExampleWiringDeps, WiredExample } from "./composition";
export { ExampleAggregate } from "./domain/example-aggregate";
export { ExampleRegistered } from "./domain/example-registered.event";
export type { ExampleRepository } from "./domain/example-repository";
export { RegisterExample } from "./application/register-example.use-case";
export type {
  RegisterExampleInput,
  RegisterExampleOutput,
} from "./application/register-example.use-case";
export { RegisterExampleController } from "./interfaces/register-example.controller";
