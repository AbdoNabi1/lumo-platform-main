import type { PlopTypes } from "@turbo/gen";

/**
 * Workspace generators (run with `pnpm gen`). Generated code follows the architecture and passes
 * `lint`/`typecheck`/`test`/`arch` on creation. The canonical reference output is `services/example`.
 */
export default function generator(plop: PlopTypes.NodePlopAPI): void {
  plop.setGenerator("package", {
    description: "Scaffold a new @platform/* shared package (README + vitest + sample test)",
    prompts: [
      { type: "input", name: "name", message: "Package name without scope (e.g. http):" },
      { type: "input", name: "description", message: "One-line description:" },
    ],
    actions: [
      {
        type: "add",
        path: "packages/{{ kebabCase name }}/package.json",
        templateFile: "templates/package/package.json.hbs",
      },
      {
        type: "add",
        path: "packages/{{ kebabCase name }}/tsconfig.json",
        templateFile: "templates/package/tsconfig.json.hbs",
      },
      {
        type: "add",
        path: "packages/{{ kebabCase name }}/vitest.config.ts",
        templateFile: "templates/package/vitest.config.ts.hbs",
      },
      {
        type: "add",
        path: "packages/{{ kebabCase name }}/README.md",
        templateFile: "templates/package/README.md.hbs",
      },
      {
        type: "add",
        path: "packages/{{ kebabCase name }}/src/index.ts",
        templateFile: "templates/package/index.ts.hbs",
      },
      {
        type: "add",
        path: "packages/{{ kebabCase name }}/src/index.test.ts",
        templateFile: "templates/package/index.test.ts.hbs",
      },
    ],
  });

  plop.setGenerator("service", {
    description: "Scaffold a bounded-context service under services/ (clean-architecture slice)",
    prompts: [
      { type: "input", name: "name", message: "Service/context name (e.g. catalog):" },
      { type: "input", name: "description", message: "One-line description:" },
    ],
    actions: [
      {
        type: "add",
        path: "services/{{ kebabCase name }}/package.json",
        templateFile: "templates/service/package.json.hbs",
      },
      {
        type: "add",
        path: "services/{{ kebabCase name }}/tsconfig.json",
        templateFile: "templates/service/tsconfig.json.hbs",
      },
      {
        type: "add",
        path: "services/{{ kebabCase name }}/vitest.config.ts",
        templateFile: "templates/service/vitest.config.ts.hbs",
      },
      {
        type: "add",
        path: "services/{{ kebabCase name }}/README.md",
        templateFile: "templates/service/README.md.hbs",
      },
      {
        type: "add",
        path: "services/{{ kebabCase name }}/src/index.ts",
        templateFile: "templates/service/index.ts.hbs",
      },
    ],
  });

  plop.setGenerator("aggregate", {
    description: "Scaffold a domain aggregate + repository port (+ test) inside a service",
    prompts: [
      { type: "input", name: "service", message: "Target service (e.g. catalog):" },
      { type: "input", name: "name", message: "Aggregate name (e.g. product):" },
    ],
    actions: [
      {
        type: "add",
        path: "services/{{ kebabCase service }}/src/domain/{{ kebabCase name }}.ts",
        templateFile: "templates/aggregate/aggregate.ts.hbs",
      },
      {
        type: "add",
        path: "services/{{ kebabCase service }}/src/domain/{{ kebabCase name }}-repository.ts",
        templateFile: "templates/aggregate/repository.ts.hbs",
      },
      {
        type: "add",
        path: "services/{{ kebabCase service }}/src/domain/{{ kebabCase name }}.test.ts",
        templateFile: "templates/aggregate/aggregate.test.ts.hbs",
      },
    ],
  });

  plop.setGenerator("use-case", {
    description: "Scaffold an application use-case (+ test) inside a service",
    prompts: [
      { type: "input", name: "service", message: "Target service (e.g. catalog):" },
      { type: "input", name: "name", message: "Use-case name (e.g. create-product):" },
    ],
    actions: [
      {
        type: "add",
        path: "services/{{ kebabCase service }}/src/application/{{ kebabCase name }}.use-case.ts",
        templateFile: "templates/use-case/use-case.ts.hbs",
      },
      {
        type: "add",
        path: "services/{{ kebabCase service }}/src/application/{{ kebabCase name }}.use-case.test.ts",
        templateFile: "templates/use-case/use-case.test.ts.hbs",
      },
    ],
  });
}
