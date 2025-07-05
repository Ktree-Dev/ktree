/**
 * @ktree/common
 * Shared utilities and types for the Ktree monorepo.
 */

import path from "node:path";
import os from "node:os";

/**
 * Returns the absolute path to the user's ktree config file.
 * Used by CLI and other packages.
 */
export function getConfigPath(): string {
  return path.join(os.homedir(), ".ktree", "config.json");
}

/**
 * Simple sleep helper (await sleep(ms))
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// Re-export config utilities
export * from "./config";
