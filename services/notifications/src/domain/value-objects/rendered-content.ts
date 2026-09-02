import { ValueObject } from "@platform/domain";

interface RenderedContentProps {
  readonly subject?: string;
  readonly body: string;
}

/** The result of substituting a template's variables — the actual text sent, never persisted separately from the notification itself. */
export class RenderedContent extends ValueObject<RenderedContentProps> {
  static create(body: string, subject?: string): RenderedContent {
    return new RenderedContent({ body, subject });
  }

  get subject(): string | undefined {
    return this.props.subject;
  }

  get body(): string {
    return this.props.body;
  }
}
