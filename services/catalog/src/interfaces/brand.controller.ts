import type { CreateBrand, CreateBrandInput } from "../application/create-brand.use-case";
import type { DeleteBrand, DeleteBrandInput } from "../application/delete-brand.use-case";
import type { ListBrands, ListBrandsInput } from "../application/list-brands.use-case";
import type { UpdateBrand, UpdateBrandInput } from "../application/update-brand.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface BrandControllerDeps {
  readonly createBrand: CreateBrand;
  readonly updateBrand: UpdateBrand;
  readonly deleteBrand: DeleteBrand;
  readonly listBrands: ListBrands;
}

/** Framework-agnostic interface boundary for brand use-cases (no HTTP server). */
export class BrandController {
  private readonly deps: BrandControllerDeps;

  constructor(deps: BrandControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateBrandInput): Promise<ControllerResponse> {
    return present(await this.deps.createBrand.execute(input), 201);
  }

  async update(input: UpdateBrandInput): Promise<ControllerResponse> {
    return present(await this.deps.updateBrand.execute(input), 200);
  }

  async delete(input: DeleteBrandInput): Promise<ControllerResponse> {
    return present(await this.deps.deleteBrand.execute(input), 200);
  }

  async list(input: ListBrandsInput): Promise<ControllerResponse> {
    return present(await this.deps.listBrands.execute(input), 200);
  }
}
