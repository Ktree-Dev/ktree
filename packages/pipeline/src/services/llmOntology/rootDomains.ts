import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { loadConfig, getApiKey, getModel } from "@ktree/common";
import { type DomainDiscoveryResult } from "@ktree/common/src/models/Topic";

// ---------------------------------------------------------------------------
// JSON Schema for domain discovery (OpenAI/Anthropic format)
// ---------------------------------------------------------------------------

const DOMAIN_DISCOVERY_SCHEMA = {
  type: "object" as const,
  properties: {
    rootDomain: {
      type: "object" as const,
      properties: {
        title: {
          type: "string" as const,
          description: "Title for the entire repository"
        },
        description: {
          type: "string" as const,
          description: "Comprehensive description of the entire repository"
        }
      },
      required: ["title", "description"]
    },
    topLevelDomains: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          title: {
            type: "string" as const,
            description: "Domain name (Ontological categorisation)"
          },
          description: {
            type: "string" as const,
            description: "Comprehensive description of this functional area"
          }
        },
        required: ["title", "description"]
      },
      minItems: 2,
      maxItems: 10
    }
  },
  required: ["rootDomain", "topLevelDomains"]
};

// Gemini-specific schema format
const GEMINI_DOMAIN_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    rootDomain: {
      type: SchemaType.OBJECT,
      properties: {
        title: {
          type: SchemaType.STRING,
          description: "Brief title for the entire repository"
        },
        description: {
          type: SchemaType.STRING,
          description: "Comprehensive description of the entire repository"
        }
      },
      required: ["title", "description"]
    },
    topLevelDomains: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: {
            type: SchemaType.STRING,
            description: "Domain name (Ontological categorisation)"
          },
          description: {
            type: SchemaType.STRING,
            description: "Comprehensive description of this functional area"
          }
        },
        required: ["title", "description"]
      }
    }
  },
  required: ["rootDomain", "topLevelDomains"]
};

const SYSTEM_PROMPT = `You are a software architecture analyst. Analyze the provided repository context to create a functional ontology.

Your task:
1. Create ONE comprehensive root domain describing the entire repository
2. Identify 2-10 top-level functional domains that together cover all parts of the codebase

The root domain should thoroughly describe what this software does overall.
Top-level domains should be broad ontological areas.

Please comprehensively describe this repository, don't hold back.`;

// ---------------------------------------------------------------------------
// Context preparation
// ---------------------------------------------------------------------------

interface FileContext {
  id: string;
  path: string;
  title: string;
  summary: string;
}

interface DirectoryContext {
  id: string;
  path: string;
  summary: string;
  fileCount: number;
  loc: number;
}

function prepareDiscoveryContext(
  files: FileContext[],
  directories: DirectoryContext[]
): string {
  const lines: string[] = [];
  
  // Repository overview
  lines.push(`Repository contains ${files.length} files across ${directories.length} directories.`);
  lines.push("");
  
  // Top-level directories with their summaries
  const topLevelDirs = directories
    .filter(dir => !dir.path.includes("/") || dir.path.split("/").length <= 2)
    .sort((a, b) => b.loc - a.loc) // Sort by LOC descending
    
  if (topLevelDirs.length > 0) {
    lines.push("Top-level directories:");
    for (const dir of topLevelDirs) {
      lines.push(`• ${dir.path} (${dir.fileCount} files, ${dir.loc} LOC): ${dir.summary}`);
    }
    lines.push("");
  }
  
  // Representative files (largest and most central)
  const representativeFiles = files
    .sort((a, b) => (b.summary?.length || 0) - (a.summary?.length || 0))
    
  if (representativeFiles.length > 0) {
    lines.push("Key files:");
    for (const file of representativeFiles) {
      lines.push(`• ${file.path}: ${file.title} - ${file.summary}`);
    }
  }
  
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Provider-specific implementations
// ---------------------------------------------------------------------------

async function discoverWithOpenAI(context: string): Promise<DomainDiscoveryResult> {
  const apiKey = getApiKey("openai");
  const model = getModel("ontology");
  const client = new OpenAI({ apiKey });

  const modelName = model.replace("openai/", ""); // e.g. "o3"
  
  // Some models (like o3) don't support custom temperature values
  const requestConfig: any = {
    model: modelName,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: context }
    ],
    functions: [{
      name: "extract_domain_structure",
      description: "Extract root domain and top-level functional domains from repository analysis",
      parameters: DOMAIN_DISCOVERY_SCHEMA
    }],
    function_call: { name: "extract_domain_structure" }
  };

  // Only add temperature for models that support it (not o3 models)
  if (!modelName.startsWith("o3")) {
    requestConfig.temperature = 0.1;
  }

  const response = await client.chat.completions.create(requestConfig);

  const functionCall = response.choices[0]?.message?.function_call;
  if (!functionCall?.arguments) {
    throw new Error("OpenAI did not return function call");
  }

  return JSON.parse(functionCall.arguments) as DomainDiscoveryResult;
}

async function discoverWithAnthropic(context: string): Promise<DomainDiscoveryResult> {
  const apiKey = getApiKey("anthropic");
  const model = getModel("ontology");
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: model.replace("anthropic/", ""), // e.g. "claude-4-sonnet"
    max_tokens: 4096,
    temperature: 0.1,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: context
    }],
    tools: [{
      name: "extract_domain_structure",
      description: "Extract root domain and top-level functional domains from repository analysis",
      input_schema: DOMAIN_DISCOVERY_SCHEMA
    }],
    tool_choice: { type: "tool", name: "extract_domain_structure" }
  });

  const toolUse = response.content.find(block => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Anthropic did not return tool use");
  }

  return toolUse.input as DomainDiscoveryResult;
}

async function discoverWithGemini(context: string): Promise<DomainDiscoveryResult> {
  const apiKey = getApiKey("gemini");
  const model = getModel("ontology");
  const client = new GoogleGenerativeAI(apiKey);

  const geminiModel = client.getGenerativeModel({ 
    model: model.replace("google/", ""), // e.g. "gemini-1.5-pro"
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: GEMINI_DOMAIN_SCHEMA as unknown as any
    }
  });

  const prompt = `${SYSTEM_PROMPT}\n\nRepository Context:\n${context}`;
  const result = await geminiModel.generateContent(prompt);
  const response = result.response.text();

  return JSON.parse(response) as DomainDiscoveryResult;
}

// ---------------------------------------------------------------------------
// Main domain discovery function
// ---------------------------------------------------------------------------

/**
 * Discover root domain and top-level functional domains for the repository
 * Implements FR-ONT-03/04/05 with deviation: 1 root + 2-10 top-level domains
 */
export async function discoverRootAndTopLevelDomains(
  files: FileContext[],
  directories: DirectoryContext[]
): Promise<DomainDiscoveryResult> {
  const config = loadConfig();
  const provider = config.llm.ontology.split("/")[0] as "openai" | "anthropic" | "google";
  
  // Prepare context for LLM
  const context = prepareDiscoveryContext(files, directories);
  
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let result: DomainDiscoveryResult;
      
      switch (provider) {
        case "openai":
          result = await discoverWithOpenAI(context);
          break;
        case "anthropic":
          result = await discoverWithAnthropic(context);
          break;
        case "google":
          result = await discoverWithGemini(context);
          break;
        default:
          throw new Error(`Unsupported LLM provider: ${provider}`);
      }
      
      return result;
    } catch (error) {
      console.warn(`Domain discovery attempt ${attempt}/${maxRetries} failed:`, error);
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }

  // This should never be reached
  throw new Error("Unexpected error in domain discovery");
}
