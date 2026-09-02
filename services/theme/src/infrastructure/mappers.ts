import { UniqueEntityId } from "@platform/domain";
import { Theme, type ThemeStatusValue } from "../domain/theme";
import { ThemeVersion } from "../domain/theme-version";
import { ThemeVariables } from "../domain/value-objects/theme-variables";

export interface ThemeVersionJson {
  readonly id: string;
  readonly versionNumber: number;
  readonly colors: Readonly<Record<string, string>>;
  readonly typography: Readonly<Record<string, string>>;
  readonly spacing: Readonly<Record<string, string>>;
  readonly publishedAt: string;
}

export interface ThemeRow {
  readonly id: string;
  readonly name: string;
  readonly colors: Readonly<Record<string, string>>;
  readonly typography: Readonly<Record<string, string>>;
  readonly spacing: Readonly<Record<string, string>>;
  readonly status: string;
  readonly versions: readonly ThemeVersionJson[];
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link Theme}. Mapping only — no I/O. */
export class ThemeMapper {
  static toDomain(row: ThemeRow): Theme {
    return Theme.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      ThemeVariables.create(row.colors, row.typography, row.spacing),
      row.status as ThemeStatusValue,
      row.version,
      row.versions.map((v) =>
        ThemeVersion.create(
          UniqueEntityId.from(v.id),
          v.versionNumber,
          ThemeVariables.create(v.colors, v.typography, v.spacing),
          new Date(v.publishedAt),
        ),
      ),
    );
  }

  static toRow(theme: Theme, tenantId: string) {
    return {
      id: theme.id.toString(),
      tenantId,
      name: theme.name,
      colors: theme.variables.colors,
      typography: theme.variables.typography,
      spacing: theme.variables.spacing,
      status: theme.status,
      versions: theme.versions.map((v) => ({
        id: v.id.toString(),
        versionNumber: v.versionNumber,
        colors: v.variables.colors,
        typography: v.variables.typography,
        spacing: v.variables.spacing,
        publishedAt: v.publishedAt.toISOString(),
      })),
      version: 1,
    };
  }
}
