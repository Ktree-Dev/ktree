import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { loadConfig, getApiKey, getModel } from "@ktree/common/src/config";
import { FileSummary } from "@ktree/common/src/types/ChunkResult";

// ---------------------------------------------------------------------------
// JSON Schema for structured output (OpenAI/Anthropic format)
// ---------------------------------------------------------------------------

const FILE_SUMMARY_SCHEMA = {
  type: "object" as const,
  properties: {
    title: {
      type: "string" as const,
      description: "Short, human-readable title for the file (e.g. main class/function name)"
    },
    summary: {
      type: "string" as const, 
      description: "One-paragraph natural-language summary of the file's purpose and functionality"
    },
    functions: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          name: { type: "string" as const, description: "Function name" },
          loc: { type: "number" as const, description: "Lines of code" },
          summary: { type: "string" as const, description: "Brief description of what this function does" }
        },
        required: ["name", "loc", "summary"]
      }
    },
    classes: {
      type: "array" as const,
      items: {
        type: "object" as const, 
        properties: {
          name: { type: "string" as const, description: "Class name" },
          loc: { type: "number" as const, description: "Lines of code" },
          summary: { type: "string" as const, description: "Brief description of the class's purpose" }
        },
        required: ["name", "loc", "summary"]
      }
    },
    loc: {
      type: "number" as const,
      description: "Total lines of code in the file"
    }
  },
  required: ["title", "summary", "functions", "classes", "loc"]
};

// Gemini-specific schema format
const GEMINI_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    title: {
      type: SchemaType.STRING,
      description: "Short, human-readable title for the file"
    },
    summary: {
      type: SchemaType.STRING,
      description: "One-paragraph natural-language summary of the file's purpose and functionality"
    },
    functions: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING, description: "Function name" },
          loc: { type: SchemaType.NUMBER, description: "Lines of code" },
          summary: { type: SchemaType.STRING, description: "Brief description of what this function does" }
        },
        required: ["name", "loc", "summary"]
      }
    },
    classes: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING, description: "Class name" },
          loc: { type: SchemaType.NUMBER, description: "Lines of code" },
          summary: { type: SchemaType.STRING, description: "Brief description of the class's purpose" }
        },
        required: ["name", "loc", "summary"]
      }
    },
    loc: {
      type: SchemaType.NUMBER,
      description: "Total lines of code in the file"
    }
  },
  required: ["title", "summary", "functions", "classes", "loc"]
};

const SYSTEM_PROMPT = `You are a code analysis expert. Analyze the provided source code and extract a structured summary.

Focus on:
- Main purpose and functionality
- Top-level functions and classes with their LOC counts
- Clear, concise descriptions

Return valid JSON matching the schema exactly.`;

// ---------------------------------------------------------------------------
// Provider-specific implementations
// ---------------------------------------------------------------------------

async function summariseWithOpenAI(content: string, language: string): Promise<FileSummary> {
  const apiKey = getApiKey("openai");
  const model = getModel("summariser");
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model: model.replace("openai/", ""), // e.g. "gpt-4.1-turbo"
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Language: ${language}\n\nCode:\n${content}` }
    ],
    functions: [{
      name: "extract_file_summary",
      description: "Extract structured summary from source code",
      parameters: FILE_SUMMARY_SCHEMA
    }],
    function_call: { name: "extract_file_summary" },
    temperature: 0.1
  });

  const functionCall = response.choices[0]?.message?.function_call;
  if (!functionCall?.arguments) {
    throw new Error("OpenAI did not return function call");
  }

  return JSON.parse(functionCall.arguments) as FileSummary;
}

async function summariseWithAnthropic(content: string, language: string): Promise<FileSummary> {
  const apiKey = getApiKey("anthropic");
  const model = getModel("summariser");
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: model.replace("anthropic/", ""), // e.g. "claude-4-sonnet"
    max_tokens: 4096,
    temperature: 0.1,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `Language: ${language}\n\nCode:\n${content}`
    }],
    tools: [{
      name: "extract_file_summary",
      description: "Extract structured summary from source code",
      input_schema: FILE_SUMMARY_SCHEMA
    }],
    tool_choice: { type: "tool", name: "extract_file_summary" }
  });

  const toolUse = response.content.find(block => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Anthropic did not return tool use");
  }

  return toolUse.input as FileSummary;
}

async function summariseWithGemini(content: string, language: string): Promise<FileSummary> {
  const apiKey = getApiKey("gemini");
  const model = getModel("summariser");
  const client = new GoogleGenerativeAI(apiKey);

  const geminiModel = client.getGenerativeModel({ 
    model: model.replace("google/", ""), // e.g. "gemini-1.5-pro"
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      // cast to any because sdk's Schema type is narrower than our literal object,
      // runtime still enforces deterministic JSON shape.
      responseSchema: GEMINI_SCHEMA as unknown as any
    }
  });

  const prompt = `${SYSTEM_PROMPT}\n\nLanguage: ${language}\n\nCode:\n${content}`;
  const result = await geminiModel.generateContent(prompt);
  const response = result.response.text();

  return JSON.parse(response) as FileSummary;
}

// ---------------------------------------------------------------------------
// Main LLM summariser with retry logic
// ---------------------------------------------------------------------------

export async function summariseChunk(content: string, language: string): Promise<FileSummary> {
  const config = loadConfig();
  const provider = config.llm.summariser.split("/")[0] as "openai" | "anthropic" | "google";

  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      switch (provider) {
        case "openai":
          return await summariseWithOpenAI(content, language);
        case "anthropic":
          return await summariseWithAnthropic(content, language);
        case "google":
          return await summariseWithGemini(content, language);
        default:
          throw new Error(`Unsupported LLM provider: ${provider}`);
      }
    } catch (error) {
      console.warn(`LLM summarisation attempt ${attempt}/${maxRetries} failed:`, error);
      
      if (attempt === maxRetries) {
        // Return error placeholder on final failure
        return {
          title: "[[ANALYSIS_ERROR]]",
          summary: `Failed to analyse after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`,
          functions: [],
          classes: [],
          loc: content.split("\n").length
        };
      }
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }

  // This should never be reached due to the error handling above
  throw new Error("Unexpected error in summariseChunk");
}
