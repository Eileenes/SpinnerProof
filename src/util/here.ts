import * as path from "node:path";

/** project root, resolved relative to this compiled file (dist/util → root) */
export function projectRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

export function examplesDir(): string {
  return path.join(projectRoot(), "examples");
}

export function staticDir(): string {
  return path.join(projectRoot(), "static");
}
