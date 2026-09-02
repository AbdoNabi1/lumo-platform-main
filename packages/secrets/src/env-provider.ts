import { readFileSync } from "node:fs";
import { BaseSecretProvider } from "./provider";

/**
 * Reads secrets from environment variables with Docker/Kubernetes `*_FILE` support:
 * if `${key}_FILE` is set, the value is read from that file path (Docker/K8s secrets).
 * Otherwise the plain `${key}` variable is used.
 */
export class EnvSecretProvider extends BaseSecretProvider {
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    super();
    this.env = env;
  }

  get(key: string): string | undefined {
    const filePath = this.env[`${key}_FILE`];
    if (filePath !== undefined && filePath !== "") {
      return readFileSync(filePath, "utf8").trim();
    }
    const direct = this.env[key];
    return direct === undefined || direct === "" ? undefined : direct;
  }
}
