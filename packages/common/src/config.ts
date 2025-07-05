/**
 * Configuration management for Ktree
 * Handles loading, validation, and decryption of user config
 */

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

export interface LlmKeys {
  anthropic?: string;
  openai?: string;
  gemini?: string;
  cohere?: string;
}

export interface KtreeConfigV2 {
  schemaVersion: 2;
  llm: {
    reasoner: string;
    summariser: string;
    embedder: string;
    ontology: string;
    keys: LlmKeys;
  };
  cloud?: { apiKey: string };
}

export const CONFIG_PATH = path.join(os.homedir(), ".ktree", "config.json");

/**
 * Decrypt an encrypted secret stored as JSON
 */
function decrypt(encryptedData: string): string {
  const { iv, content, tag } = JSON.parse(encryptedData);
  const key = crypto.scryptSync("ktree-local-key", "salt", 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(content, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * Load and validate Ktree configuration
 * @throws {Error} if config is missing or invalid
 */
export function loadConfig(): KtreeConfigV2 {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `Ktree not configured. Run 'ktree init' to set up your configuration.\nExpected config at: ${CONFIG_PATH}`
    );
  }

  let rawConfig: any;
  try {
    rawConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (error) {
    throw new Error(`Invalid config file at ${CONFIG_PATH}. Please run 'ktree init' to recreate.`);
  }

  // Validate schema version
  if (rawConfig.schemaVersion !== 2) {
    throw new Error(
      `Unsupported config schema version ${rawConfig.schemaVersion}. Please run 'ktree init' to upgrade.`
    );
  }

  // Decrypt API keys
  const decryptedKeys: LlmKeys = {};
  if (rawConfig.llm?.keys) {
    for (const [provider, encryptedKey] of Object.entries(rawConfig.llm.keys)) {
      if (encryptedKey && typeof encryptedKey === "string") {
        try {
          decryptedKeys[provider as keyof LlmKeys] = decrypt(encryptedKey);
        } catch (error) {
          console.warn(`Failed to decrypt ${provider} API key. You may need to run 'ktree init' again.`);
        }
      }
    }
  }

  return {
    schemaVersion: 2,
    llm: {
      reasoner: rawConfig.llm?.reasoner || "openai/o3",
      summariser: rawConfig.llm?.summariser || "anthropic/claude-4-sonnet",
      embedder: rawConfig.llm?.embedder || "google/textembedding-gecko-002",
      ontology: rawConfig.llm?.ontology || "anthropic/claude-4-sonnet",
      keys: decryptedKeys,
    },
    cloud: rawConfig.cloud,
  };
}

/**
 * Get API key for a specific provider
 * @throws {Error} if key is missing
 */
export function getApiKey(provider: keyof LlmKeys): string {
  const config = loadConfig();
  const key = config.llm.keys[provider];
  
  if (!key) {
    throw new Error(
      `${provider} API key not found. Please run 'ktree init' to configure your API keys.`
    );
  }
  
  return key;
}

/**
 * Check if config exists and is valid (non-throwing)
 */
export function isConfigured(): boolean {
  try {
    loadConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the configured model for a specific capability
 */
export function getModel(capability: 'reasoner' | 'summariser' | 'embedder' | 'ontology'): string {
  const config = loadConfig();
  return config.llm[capability];
}
