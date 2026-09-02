import type { RegisterExample } from "../application/register-example.use-case";

export interface ControllerRequest {
  readonly body: { readonly label: unknown };
}

export interface ControllerResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Framework-agnostic interface boundary for the walking skeleton — **no HTTP server, no NestJS,
 * Express, or Fastify**. It validates input at the boundary, invokes the use-case, and maps the
 * `Result` to a transport-neutral response. A real transport adapter (Phase 1) wraps this. The
 * shapes are intentionally minimal and not a committed HTTP contract.
 */
export class RegisterExampleController {
  private readonly useCase: RegisterExample;

  constructor(useCase: RegisterExample) {
    this.useCase = useCase;
  }

  async handle(request: ControllerRequest): Promise<ControllerResponse> {
    const { label } = request.body;
    if (typeof label !== "string" || label.trim().length === 0) {
      return { status: 400, body: { error: "label is required" } };
    }

    const result = await this.useCase.execute({ label });
    if (!result.ok) {
      return { status: 422, body: { error: result.error.message } };
    }
    return { status: 201, body: { id: result.value.id } };
  }
}
