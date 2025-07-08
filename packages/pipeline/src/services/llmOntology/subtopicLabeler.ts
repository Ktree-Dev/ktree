import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { loadConfig, getApiKey, getModel } from "@ktree/common";

/**
 * Subtopic labeler for creating subtopic structure within domains
 * Implements FR-ONT-06/07/08 - LLM-guided subtopic naming (without assignment)
 */

// ---------------------------------------------------------------------------
// JSON Schema for subtopic structure (OpenAI/Anthropic format)
// ---------------------------------------------------------------------------

const SUBTOPIC_STRUCTURE_SCHEMA = {
  type: "object" as const,
  properties: {
    subtopics: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          title: {
            type: "string" as const,
            description: "Subtopic name (descriptive and specific)"
          },
          description: {
            type: "string" as const,
            description: "Comprehensive description of this subtopic's focus area"
          }
        },
        required: ["title", "description"]
      },
      minItems: 2,
      maxItems: 10
    }
  },
  required: ["subtopics"]
};

// Gemini-specific schema format
const GEMINI_SUBTOPIC_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    subtopics: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: {
            type: SchemaType.STRING,
            description: "Subtopic name (descriptive and specific)"
          },
          description: {
            type: SchemaType.STRING,
            description: "Comprehensive description of this subtopic's focus area"
          }
        },
        required: ["title", "description"]
      }
    }
  },
  required: ["subtopics"]
};

const SYSTEM_PROMPT = `You are a software architecture analyst. Your task is to analyze files within a functional domain and identify 2-5 meaningful subtopics that could logically group these files.

Guidelines:
- Create 2-10 subtopics that represent distinct functional areas within the domain
- Each subtopic should have a clear, specific focus
- Subtopic names should be descriptive and specific to the domain`;

// ---------------------------------------------------------------------------
// Context preparation
// ---------------------------------------------------------------------------

interface FileCandidate {
  path: string;
  title: string;
  summary: string;
}

interface DomainCluster {
  domain: { title: string; description: string };
  candidates: FileCandidate[];
}

export interface SubtopicStructure {
  subtopics: Array<{
    title: string;
    description: string;
  }>;
}

function prepareSubtopicContext(cluster: DomainCluster): string {
  const lines: string[] = [];
  
  // Domain context
  lines.push(`Domain: ${cluster.domain.title}`);
  lines.push(`Description: ${cluster.domain.description}`);
  lines.push("");
  lines.push(`Files in this domain (${cluster.candidates.length} total):`);
  lines.push("");
  
  // File listings with details (limit to avoid prompt overflow)
  const filesToShow = cluster.candidates.slice(0, 30); // Show max 30 files
  for (const file of filesToShow) {
    lines.push(`• ${file.path}: ${file.title} - ${file.summary}`);
  }
  
  if (cluster.candidates.length > 30) {
    lines.push(`... and ${cluster.candidates.length - 30} more files`);
  }
  
  lines.push("");
  lines.push("Based on these files, identify 2-5 subtopics that would logically group them by functionality.");
  
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Provider-specific implementations
// ---------------------------------------------------------------------------

async function generateWithOpenAI(context: string): Promise<SubtopicStructure> {
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
      name: "generate_subtopic_structure",
      description: "Generate subtopic structure for a domain based on file analysis",
      parameters: SUBTOPIC_STRUCTURE_SCHEMA
    }],
    function_call: { name: "generate_subtopic_structure" }
  };

  // Only add temperature for models that support it (not o3 models)
  if (!modelName.startsWith("o3")) {
    requestConfig.temperature = 0.2;
  }

  const response = await client.chat.completions.create(requestConfig);

  const functionCall = response.choices[0]?.message?.function_call;
  if (!functionCall?.arguments) {
    throw new Error("OpenAI did not return function call");
  }

  return JSON.parse(functionCall.arguments) as SubtopicStructure;
}

async function generateWithAnthropic(context: string): Promise<SubtopicStructure> {
  const apiKey = getApiKey("anthropic");
  const model = getModel("ontology");
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: model.replace("anthropic/", ""), // e.g. "claude-4-sonnet"
    max_tokens: 10240,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: context
    }],
    tools: [{
      name: "generate_subtopic_structure",
      description: "Generate subtopic structure for a domain based on file analysis",
      input_schema: SUBTOPIC_STRUCTURE_SCHEMA
    }],
    tool_choice: { type: "tool", name: "generate_subtopic_structure" }
  });

  const toolUse = response.content.find(block => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Anthropic did not return tool use");
  }

  return toolUse.input as SubtopicStructure;
}

async function generateWithGemini(context: string): Promise<SubtopicStructure> {
  const apiKey = getApiKey("gemini");
  const model = getModel("ontology");
  const client = new GoogleGenerativeAI(apiKey);

  const geminiModel = client.getGenerativeModel({ 
    model: model.replace("google/", ""), // e.g. "gemini-1.5-pro"
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: GEMINI_SUBTOPIC_SCHEMA as unknown as any
    }
  });

  const prompt = `${SYSTEM_PROMPT}\n\nDomain Context and Files:\n${context}`;
  const result = await geminiModel.generateContent(prompt);
  const response = result.response.text();

  return JSON.parse(response) as SubtopicStructure;
}

// ---------------------------------------------------------------------------
// Main subtopic generation function
// ---------------------------------------------------------------------------

/**
 * Generate subtopic structure for a domain cluster using LLM analysis
 * Implements FR-ONT-06/07/08 (structure generation part)
 */
export async function generateSubtopicStructure(
  cluster: DomainCluster
): Promise<SubtopicStructure> {
  const config = loadConfig();
  const provider = config.llm.ontology.split("/")[0] as "openai" | "anthropic" | "google";
  
  // Prepare context for LLM
  const context = prepareSubtopicContext(cluster);
  
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let result: SubtopicStructure;
      
      switch (provider) {
        case "openai":
          result = await generateWithOpenAI(context);
          break;
        case "anthropic":
          result = await generateWithAnthropic(context);
          break;
        case "google":
          result = await generateWithGemini(context);
          break;
        default:
          throw new Error(`Unsupported LLM provider: ${provider}`);
      }
      
      return result;
    } catch (error) {
      console.warn(`Subtopic generation attempt ${attempt}/${maxRetries} failed for domain "${cluster.domain.title}":`, error);
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }

  // This should never be reached
  throw new Error("Unexpected error in subtopic generation");
}

/**
 * Process multiple domain clusters sequentially to generate subtopic structures
 */
export async function generateSubtopicStructuresForAllDomains(
  clusters: DomainCluster[]
): Promise<SubtopicStructure[]> {
  console.log(`   Generating subtopic structures for ${clusters.length} domains...`);
  
  const results: SubtopicStructure[] = [];
  
  // Process domains sequentially to avoid rate limits and manage LLM call budget
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    console.log(`     Analyzing domain ${i + 1}/${clusters.length}: "${cluster.domain.title}" (${cluster.candidates.length} files)`);
    
    const structure = await generateSubtopicStructure(cluster);
    results.push(structure);
    
    console.log(`     Created ${structure.subtopics.length} subtopics for "${cluster.domain.title}"`);
    
    // Small delay between domains to be respectful to APIs
    if (i < clusters.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  const totalSubtopics = results.reduce((sum, result) => sum + result.subtopics.length, 0);
  console.log(`   Generated ${totalSubtopics} total subtopics across ${clusters.length} domains`);
  
  return results;
}
