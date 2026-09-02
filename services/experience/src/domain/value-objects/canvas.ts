import { ValueObject } from "@platform/domain";

export interface ComponentInstance {
  /** Bare reference into Components — Experience owns instances only, never the contract. */
  readonly componentRef: string;
  readonly props: Readonly<Record<string, unknown>>;
}

export interface Slot {
  readonly key: string;
  readonly componentInstances: readonly ComponentInstance[];
}

export interface Section {
  readonly key: string;
  readonly slots: readonly Slot[];
}

interface CanvasProps {
  readonly sections: readonly Section[];
}

/** The Canvas→Section→Slot→ComponentInstance layout tree (Sprint 5.4) — Experience owns layouts, references Components/Content/Theme only by ref. */
export class Canvas extends ValueObject<CanvasProps> {
  static empty(): Canvas {
    return new Canvas({ sections: [] });
  }

  static create(sections: readonly Section[]): Canvas {
    return new Canvas({ sections });
  }

  get sections(): readonly Section[] {
    return this.props.sections;
  }
}
