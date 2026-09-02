import { UniqueEntityId } from "@platform/domain";
import { Wishlist } from "../domain/wishlist";
import { WishlistItem } from "../domain/value-objects/wishlist-item";
import { WishlistStatus, type WishlistStatusValue } from "../domain/value-objects/wishlist-status";

export interface WishlistItemJson {
  readonly productRef: string;
  readonly addedAt: string;
  readonly shareToken?: string;
}

export interface WishlistRow {
  readonly id: string;
  readonly customerRef: string;
  readonly status: string;
  readonly items: readonly WishlistItemJson[];
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link Wishlist}. Mapping only — no I/O. */
export class WishlistMapper {
  static toDomain(row: WishlistRow): Wishlist {
    return Wishlist.reconstitute(
      UniqueEntityId.from(row.id),
      row.customerRef,
      WishlistStatus.from(row.status as WishlistStatusValue),
      row.version,
      row.items.map((item) =>
        WishlistItem.create(item.productRef, new Date(item.addedAt), item.shareToken),
      ),
    );
  }

  static toRow(wishlist: Wishlist, tenantId: string) {
    return {
      id: wishlist.id.toString(),
      tenantId,
      customerRef: wishlist.customerRef,
      status: wishlist.status.value,
      items: wishlist.items.map((item) => ({
        productRef: item.productRef,
        addedAt: item.addedAt.toISOString(),
        shareToken: item.shareToken,
      })),
      version: 1,
    };
  }
}
