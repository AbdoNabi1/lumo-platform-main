import type { RegisterAsset, RegisterAssetInput } from "../application/register-asset.use-case";
import { type ControllerResponse, present } from "./presenter";

/** Framework-agnostic interface boundary for media asset use-cases (no HTTP server). */
export class AssetController {
  private readonly registerAsset: RegisterAsset;

  constructor(registerAsset: RegisterAsset) {
    this.registerAsset = registerAsset;
  }

  async register(input: RegisterAssetInput): Promise<ControllerResponse> {
    return present(await this.registerAsset.execute(input), 201);
  }
}
