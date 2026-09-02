import { Guard, ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface ShipmentPackageProps {
  readonly reference: string;
  readonly itemRefs: readonly string[];
  readonly weightGrams: number;
}

/** One physical parcel within a shipment — the item references it contains and its weight (grams, integer). */
export class ShipmentPackage extends ValueObject<ShipmentPackageProps> {
  static create(
    reference: string,
    itemRefs: readonly string[],
    weightGrams: number,
  ): Result<ShipmentPackage, ValidationError> {
    const guardedReference = Guard.againstEmpty(reference, "reference");
    if (!guardedReference.ok) return err(guardedReference.error);
    if (itemRefs.length === 0) {
      return err(
        new ValidationError("Invalid shipment package", [
          { field: "itemRefs", message: "must not be empty" },
        ]),
      );
    }
    if (!Number.isInteger(weightGrams) || weightGrams <= 0) {
      return err(
        new ValidationError("Invalid shipment package", [
          { field: "weightGrams", message: "must be a positive integer" },
        ]),
      );
    }
    return ok(new ShipmentPackage({ reference, itemRefs: [...itemRefs], weightGrams }));
  }

  get reference(): string {
    return this.props.reference;
  }

  get itemRefs(): readonly string[] {
    return this.props.itemRefs;
  }

  get weightGrams(): number {
    return this.props.weightGrams;
  }
}
