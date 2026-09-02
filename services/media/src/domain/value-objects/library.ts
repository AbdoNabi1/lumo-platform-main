import { ValueObject } from "@platform/domain";

export type LibraryEntryStatusValue = "active" | "archived";

interface LibraryEntryStatusProps {
  readonly value: LibraryEntryStatusValue;
}

/** The shared lifecycle state for {@link Folder} and {@link MediaAsset} (active/archived). */
export class LibraryEntryStatus extends ValueObject<LibraryEntryStatusProps> {
  static active(): LibraryEntryStatus {
    return new LibraryEntryStatus({ value: "active" });
  }

  static from(value: LibraryEntryStatusValue): LibraryEntryStatus {
    return new LibraryEntryStatus({ value });
  }

  get value(): LibraryEntryStatusValue {
    return this.props.value;
  }
}
