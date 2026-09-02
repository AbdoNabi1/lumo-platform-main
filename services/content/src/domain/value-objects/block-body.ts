import { ValueObject } from "@platform/domain";

export type BlockBodyFormat = "html" | "markdown" | "json";

interface BlockBodyProps {
  readonly format: BlockBodyFormat;
  readonly content: string;
}

/** A content block's body — references other contexts (products/media) only by bare id, never embeds them. */
export class BlockBody extends ValueObject<BlockBodyProps> {
  static create(format: BlockBodyFormat, content: string): BlockBody {
    return new BlockBody({ format, content });
  }

  get format(): BlockBodyFormat {
    return this.props.format;
  }

  get content(): string {
    return this.props.content;
  }
}
