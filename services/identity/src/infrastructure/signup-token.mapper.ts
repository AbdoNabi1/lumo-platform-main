import { UniqueEntityId } from "@platform/domain";
import { SignupToken } from "../domain/signup-token";

export interface SignupTokenRow {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

/** Persistence ↔ entity mapping for {@link SignupToken}. Mapping only — no I/O. */
export class SignupTokenMapper {
  static toDomain(row: SignupTokenRow): SignupToken {
    return SignupToken.reconstitute(
      UniqueEntityId.from(row.id),
      row.tenantId,
      row.customerId,
      row.tokenHash,
      row.expiresAt,
      row.consumedAt,
    );
  }

  static toRow(token: SignupToken) {
    return {
      id: token.id.toString(),
      tenantId: token.tenantId,
      customerId: token.customerId,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
      consumedAt: token.consumedAt,
    };
  }
}
