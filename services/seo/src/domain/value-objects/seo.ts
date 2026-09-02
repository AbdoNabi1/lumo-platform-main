import { ValueObject } from "@platform/domain";

interface SeoMetadataProps {
  readonly title?: string;
  readonly description?: string;
  readonly canonicalUrl?: string;
  readonly ogImageRef?: string;
}

/** SEO metadata for one page — metadata only, consumes content by ref, never owns pages. */
export class SeoMetadata extends ValueObject<SeoMetadataProps> {
  static create(props: SeoMetadataProps): SeoMetadata {
    return new SeoMetadata(props);
  }

  get title(): string | undefined {
    return this.props.title;
  }

  get description(): string | undefined {
    return this.props.description;
  }

  get canonicalUrl(): string | undefined {
    return this.props.canonicalUrl;
  }

  get ogImageRef(): string | undefined {
    return this.props.ogImageRef;
  }
}

export type RedirectStatusCode = 301 | 302;

export interface RobotsRule {
  readonly type: "allow" | "disallow";
  readonly path: string;
}
