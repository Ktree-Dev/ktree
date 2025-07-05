import type { Arguments, CommandBuilder, CommandModule } from "yargs";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

interface InitArgs extends Arguments {
  nonInteractive?: boolean;
  cloud?: boolean;
}

interface LlmKeys {
  anthropic?: string;
  openai?: string;
  gemini?: string;
  cohere?: string;
}

interface KtreeConfigV2 {
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

/**
 * Path to ~/.ktree/config.json
 */
export const CONFIG_PATH = path.join(os.homedir(), ".ktree", "config.json");
const CONFIG_DIR = path.dirname(CONFIG_PATH);

/**
 * Very light AES-256-GCM encryption helper.
 */
function encrypt(secret: string): { iv: string; content: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync("ktree-local-key", "salt", 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    content: enc.toString("hex"),
    tag: tag.toString("hex"),
  };
}

const builder: CommandBuilder<InitArgs, InitArgs> = (yargs) =>
  yargs
    .option("non-interactive", {
      type: "boolean",
      desc: "Generate config from env vars without prompting",
    })
    .option("cloud", {
      type: "boolean",
      desc: "Enable Ktree cloud mode (expect KTREE_CLOUD_KEY env var)",
    });

async function handler(argv: InitArgs): Promise<void> {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });

  let config: KtreeConfigV2 | null = null;
  if (!argv.nonInteractive) {
    const prompts = require("prompts");
    
    const answers = await prompts([
      {
        type: "text",
        name: "anthropic",
        message: "Anthropic API key (leave blank to skip):",
        initial: "",
      },
      {
        type: "text",
        name: "openai",
        message: "OpenAI API key (leave blank to skip):",
        initial: "",
      },
      {
        type: "text",
        name: "gemini",
        message: "Google Gemini key (leave blank to skip):",
        initial: "",
      },
      {
        type: "text",
        name: "cohere",
        message: "Cohere API key (leave blank to skip):",
        initial: "",
      },
      {
        type: "select",
        name: "reasoner",
        message: "Select reasoner model:",
        choices: [
          { title: "openai/o3", value: "openai/o3" },
          { title: "anthropic/claude-4-opus", value: "anthropic/claude-4-opus" },
          { title: "openai/o4-mini", value: "openai/o4-mini" },
        ],
        initial: 0,
      },
      {
        type: "select",
        name: "summariser",
        message: "Select summariser model:",
        choices: [
          { title: "anthropic/claude-4-sonnet", value: "anthropic/claude-4-sonnet" },
          { title: "openai/gpt-4.1-turbo", value: "openai/gpt-4.1-turbo" },
        ],
        initial: 0,
      },
      {
        type: "select",
        name: "embedder",
        message: "Select embedding model:",
        choices: [
          { title: "google/textembedding-gecko-002", value: "google/textembedding-gecko-002" },
          { title: "multilingual-e5-large-instruct", value: "multilingual-e5-large-instruct" },
          { title: "cohere/embed-v4-large", value: "cohere/embed-v4-large" },
        ],
        initial: 0,
      },
      {
        type: argv.cloud === undefined ? "confirm" : null,
        name: "useCloud",
        message: "Configure Ktree cloud?",
        initial: false,
      },
      {
        type: (prev: any, values: any) => (values.useCloud || argv.cloud) ? "text" : null,
        name: "cloudKey",
        message: "Ktree cloud API key:",
        initial: "",
      },
    ]);
    const keys: LlmKeys = {
      anthropic: answers.anthropic || undefined,
      openai: answers.openai || undefined,
      gemini: answers.gemini || undefined,
      cohere: answers.cohere || undefined,
    };

    // encrypt keys
    const encryptedKeys: LlmKeys = {};
    for (const [provider, key] of Object.entries(keys)) {
      if (key) {
        encryptedKeys[provider as keyof LlmKeys] = JSON.stringify(
          encrypt(key),
        );
      }
    }

    config = {
      schemaVersion: 2,
      llm: {
        reasoner: answers.reasoner,
        summariser: answers.summariser,
        embedder: answers.embedder,
        ontology: answers.summariser,
        keys: encryptedKeys,
      },
      cloud: answers.cloudKey
        ? {
            apiKey: answers.cloudKey,
          }
        : undefined,
    };
  } else {
    // generate from env vars
    config = {
      schemaVersion: 2,
      llm: {
        reasoner: process.env.KTREE_REASONER_MODEL || "openai/o3",
        summariser:
          process.env.KTREE_SUMMARISER_MODEL || "anthropic/claude-4-sonnet",
        embedder:
          process.env.KTREE_EMBEDDER_MODEL || "google/textembedding-gecko-002",
        ontology:
          process.env.KTREE_ONTOLOGY_MODEL || "anthropic/claude-4-sonnet",
        keys: {
          anthropic: process.env.ANTHROPIC_API_KEY
            ? JSON.stringify(encrypt(process.env.ANTHROPIC_API_KEY))
            : undefined,
          openai: process.env.OPENAI_API_KEY
            ? JSON.stringify(encrypt(process.env.OPENAI_API_KEY))
            : undefined,
          gemini: process.env.GEMINI_API_KEY
            ? JSON.stringify(encrypt(process.env.GEMINI_API_KEY))
            : undefined,
          cohere: process.env.COHERE_API_KEY
            ? JSON.stringify(encrypt(process.env.COHERE_API_KEY))
            : undefined,
        },
      },
      cloud: process.env.KTREE_CLOUD_KEY
        ? { apiKey: process.env.KTREE_CLOUD_KEY }
        : undefined,
    };
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  console.log(`✅ Config saved to ${CONFIG_PATH}`);
}

export const initCommand: CommandModule<InitArgs, InitArgs> = {
  command: "init",
  describe: "Interactive wizard for initial Ktree configuration",
  builder,
  handler,
};
