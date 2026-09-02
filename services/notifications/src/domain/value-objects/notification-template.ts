import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { RenderedContent } from "./rendered-content";

interface NotificationTemplateProps {
  readonly templateId: string;
  readonly bodyPattern: string;
  readonly subjectPattern?: string;
}

const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

/** A merchant-authored template with `{{var}}` placeholders — pure substitution, no side effects, no PII. */
export class NotificationTemplate extends ValueObject<NotificationTemplateProps> {
  static create(
    templateId: string,
    bodyPattern: string,
    subjectPattern?: string,
  ): Result<NotificationTemplate, ValidationError> {
    const guardedId = Guard.againstEmpty(templateId, "templateId");
    if (!guardedId.ok) return err(guardedId.error);
    const guardedBody = Guard.againstEmpty(bodyPattern, "bodyPattern");
    if (!guardedBody.ok) return err(guardedBody.error);
    return ok(new NotificationTemplate({ templateId, bodyPattern, subjectPattern }));
  }

  /** Substitutes every `{{var}}` placeholder with its value from `variables` (missing keys are left as-is). */
  render(variables: Readonly<Record<string, string>>): RenderedContent {
    const substitute = (pattern: string): string =>
      pattern.replace(VARIABLE_PATTERN, (match, key: string) => variables[key] ?? match);
    return RenderedContent.create(
      substitute(this.props.bodyPattern),
      this.props.subjectPattern === undefined ? undefined : substitute(this.props.subjectPattern),
    );
  }

  get templateId(): string {
    return this.props.templateId;
  }

  get bodyPattern(): string {
    return this.props.bodyPattern;
  }

  get subjectPattern(): string | undefined {
    return this.props.subjectPattern;
  }
}
