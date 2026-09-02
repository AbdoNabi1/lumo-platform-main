import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { MediaLibraryChanged } from "./events/media-library-changed.event";
import { LibraryEntryStatus } from "./value-objects/library";

interface FolderProps {
  readonly name: string;
  readonly parentFolderRef?: string;
  status: LibraryEntryStatus;
}

/** An organizational folder over media assets (Sprint 5.4) — organization layer only, never stores files itself. */
export class Folder extends AggregateRoot<FolderProps> {
  static create(
    id: UniqueEntityId,
    name: string,
    eventId: string,
    occurredAt: Date,
    parentFolderRef?: string,
  ): Folder {
    const folder = new Folder({ name, parentFolderRef, status: LibraryEntryStatus.active() }, id);
    folder.raise("created", eventId, occurredAt);
    return folder;
  }

  static reconstitute(
    id: UniqueEntityId,
    name: string,
    status: LibraryEntryStatus,
    version: number,
    parentFolderRef?: string,
  ): Folder {
    return new Folder({ name, parentFolderRef, status }, id, version);
  }

  archive(eventId: string, occurredAt: Date): void {
    if (this.props.status.value === "archived") {
      throw new BusinessRuleError("Folder is already archived");
    }
    this.props.status = LibraryEntryStatus.from("archived");
    this.raise("archived", eventId, occurredAt);
  }

  private raise(action: "created" | "archived", eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new MediaLibraryChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          ref: this.props.name,
          entityType: "folder",
          action,
        },
      ),
    );
  }

  get name(): string {
    return this.props.name;
  }

  get parentFolderRef(): string | undefined {
    return this.props.parentFolderRef;
  }

  get status(): LibraryEntryStatus {
    return this.props.status;
  }
}
