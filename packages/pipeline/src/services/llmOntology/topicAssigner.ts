import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { loadConfig, getApiKey, getModel } from "@ktree/common";
import { type SubtopicStructure } from "./subtopicLabeler";

/**
 * Topic assigner for assigning files to subtopics within domains
 * Implements FR-ONT-09/10/11 - Multi-topic assignment with LLM voting
 */

// ---------------------------------------------------------------------------
// JSON Schema for file assignment (OpenAI/Anthropic format)
// ---------------------------------------------------------------------------

const FILE_ASSIGNMENT_SCHEMA = {
  type: "object" as const,
  properties: {
    assignments: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          filePath: {
            type: "string" as const,
            description: "Exact file path from the provided list"
          },
          subtopics: {
            type: "array" as const,
            items: {
              type: "string" as const
            },
            description: "List of subtopic titles this file belongs to (can be multiple)",
            minItems: 1
          }
        },
        required: ["filePath", "subtopics"]
      }
    }
  },
  required: ["assignments"]
};

// Gemini-specific schema format
const GEMINI_ASSIGNMENT_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    assignments: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          filePath: {
            type: SchemaType.STRING,
            description: "Exact file path from the provided list"
          },
          subtopics: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.STRING
            },
            description: "List of subtopic titles this file belongs to"
          }
        },
        required: ["filePath", "subtopics"]
      }
    }
  },
  required: ["assignments"]
};

const SYSTEM_PROMPT = `You are a software architecture analyst. Your task is to assign files to subtopics within a functional domain.

Guidelines:
- Each file MUST be assigned to at least one subtopic
- Files CAN belong to multiple subtopics if they serve multiple purposes (cross-cutting concerns)
- Use the exact subtopic titles provided
- Use the exact file paths provided
- Consider file content, purpose, and relationships when making assignments

Assign ALL files - ensure complete coverage.`;

// ---------------------------------------------------------------------------
// Types and interfaces
// ---------------------------------------------------------------------------

interface FileCandidate {
  path: string;
  title: string;
  summary: string;
}

export interface FileAssignment {
  filePath: string;
  subtopics: string[];
}

export interface AssignmentResult {
  assignments: FileAssignment[];
}

interface DomainWithSubtopics {
  domain: { title: string; description: string };
  candidates: FileCandidate[];
  subtopics: SubtopicStructure;
}

// ---------------------------------------------------------------------------
// Context preparation
// ---------------------------------------------------------------------------

function prepareAssignmentContext(domainData: DomainWithSubtopics): string {
  const lines: string[] = [];
  
  // Domain context
  lines.push(`Domain: ${domainData.domain.title}`);
  lines.push(`Description: ${domainData.domain.description}`);
  lines.push("");
  
  // Available subtopics
  lines.push("Available Subtopics:");
  for (const subtopic of domainData.subtopics.subtopics) {
    lines.push(`• "${subtopic.title}": ${subtopic.description}`);
  }
  lines.push("");
  
  // Files to assign
  lines.push(`Files to assign (${domainData.candidates.length} total):`);
  lines.push("");
  
  for (const file of domainData.candidates) {
    lines.push(`Path: ${file.path}`);
    lines.push(`Title: ${file.title}`);
    lines.push(`Summary: ${file.summary}`);
    lines.push("");
  }
  
  lines.push("Assign each file to appropriate subtopics. Files can belong to multiple subtopics if relevant.");
  
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Provider-specific implementations
// ---------------------------------------------------------------------------

async function assignWithOpenAI(context: string): Promise<AssignmentResult> {
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
      name: "assign_files_to_subtopics",
      description: "Assign files to appropriate subtopics within a domain",
      parameters: FILE_ASSIGNMENT_SCHEMA
    }],
    function_call: { name: "assign_files_to_subtopics" }
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

  return JSON.parse(functionCall.arguments) as AssignmentResult;
}

async function assignWithAnthropic(context: string): Promise<AssignmentResult> {
  const apiKey = getApiKey("anthropic");
  const model = getModel("ontology");
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: model.replace("anthropic/", ""), // e.g. "claude-4-sonnet"
    max_tokens: 15360, // Larger context for assignments
    temperature: 0.1,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: context
    }],
    tools: [{
      name: "assign_files_to_subtopics",
      description: "Assign files to appropriate subtopics within a domain",
      input_schema: FILE_ASSIGNMENT_SCHEMA
    }],
    tool_choice: { type: "tool", name: "assign_files_to_subtopics" }
  });

  const toolUse = response.content.find(block => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Anthropic did not return tool use");
  }

  return toolUse.input as AssignmentResult;
}

async function assignWithGemini(context: string): Promise<AssignmentResult> {
  const apiKey = getApiKey("gemini");
  const model = getModel("ontology");
  const client = new GoogleGenerativeAI(apiKey);

  const geminiModel = client.getGenerativeModel({ 
    model: model.replace("google/", ""), // e.g. "gemini-1.5-pro"
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: GEMINI_ASSIGNMENT_SCHEMA as unknown as any
    }
  });

  const prompt = `${SYSTEM_PROMPT}\n\nDomain Context and Assignment Task:\n${context}`;
  const result = await geminiModel.generateContent(prompt);
  const response = result.response.text();

  return JSON.parse(response) as AssignmentResult;
}

// ---------------------------------------------------------------------------
// Main assignment function
// ---------------------------------------------------------------------------

/**
 * Assign files to subtopics within a domain using LLM analysis
 * Implements FR-ONT-09/10/11 with multi-topic assignment support
 */
export async function assignFilesToSubtopics(
  domainData: DomainWithSubtopics
): Promise<AssignmentResult> {
  const config = loadConfig();
  const provider = config.llm.ontology.split("/")[0] as "openai" | "anthropic" | "google";
  
  // Prepare context for LLM
  const context = prepareAssignmentContext(domainData);
  
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let result: AssignmentResult;
      
      switch (provider) {
        case "openai":
          result = await assignWithOpenAI(context);
          break;
        case "anthropic":
          result = await assignWithAnthropic(context);
          break;
        case "google":
          result = await assignWithGemini(context);
          break;
        default:
          throw new Error(`Unsupported LLM provider: ${provider}`);
      }
      
      // Validate the result
      validateAssignmentResult(result, domainData);
      
      return result;
    } catch (error) {
      console.warn(`File assignment attempt ${attempt}/${maxRetries} failed for domain "${domainData.domain.title}":`, error);
      
      if (attempt === maxRetries) {
        console.error(`File assignment failed for domain "${domainData.domain.title}" after ${maxRetries} attempts`);
        throw new Error(`Failed to assign files for domain "${domainData.domain.title}" after ${maxRetries} attempts`);
      }
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }

  // This should never be reached
  throw new Error("Unexpected error in file assignment");
}

/**
 * Process multiple domains with subtopics to assign all files
 */
export async function assignFilesForAllDomains(
  domainsWithSubtopics: DomainWithSubtopics[]
): Promise<AssignmentResult[]> {
  console.log(`   Assigning files to subtopics for ${domainsWithSubtopics.length} domains...`);
  
  const results: AssignmentResult[] = [];
  
  // Process domains sequentially to avoid rate limits
  for (let i = 0; i < domainsWithSubtopics.length; i++) {
    const domainData = domainsWithSubtopics[i];
    console.log(`     Assigning files ${i + 1}/${domainsWithSubtopics.length}: "${domainData.domain.title}" (${domainData.candidates.length} files → ${domainData.subtopics.subtopics.length} subtopics)`);
    
    const assignments = await assignFilesToSubtopics(domainData);
    results.push(assignments);
    
    // Calculate assignment statistics
    const totalAssignments = assignments.assignments.reduce((sum, a) => sum + a.subtopics.length, 0);
    const multiTopicFiles = assignments.assignments.filter(a => a.subtopics.length > 1).length;
    
    console.log(`     Completed assignments: ${assignments.assignments.length} files, ${totalAssignments} total assignments, ${multiTopicFiles} multi-topic files`);
    
    // Small delay between domains
    if (i < domainsWithSubtopics.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Calculate overall statistics
  const totalFiles = results.reduce((sum, result) => sum + result.assignments.length, 0);
  const totalAssignments = results.reduce((sum, result) => 
    sum + result.assignments.reduce((subSum, a) => subSum + a.subtopics.length, 0), 0);
  const totalMultiTopicFiles = results.reduce((sum, result) => 
    sum + result.assignments.filter(a => a.subtopics.length > 1).length, 0);
  
  console.log(`   Assignment complete: ${totalFiles} files, ${totalAssignments} total assignments, ${totalMultiTopicFiles} multi-topic files`);
  
  return results;
}

// ---------------------------------------------------------------------------
// Validation and fallback
// ---------------------------------------------------------------------------

function validateAssignmentResult(result: AssignmentResult, domainData: DomainWithSubtopics): void {
  const candidatePaths = new Set(domainData.candidates.map(c => c.path));
  const subtopicTitles = new Set(domainData.subtopics.subtopics.map(s => s.title));
  
  // Check that all files are assigned
  const assignedPaths = new Set(result.assignments.map(a => a.filePath));
  for (const candidatePath of candidatePaths) {
    if (!assignedPaths.has(candidatePath)) {
      throw new Error(`File not assigned: ${candidatePath}`);
    }
  }
  
  // Check that no extra files are assigned
  for (const assignment of result.assignments) {
    if (!candidatePaths.has(assignment.filePath)) {
      throw new Error(`Invalid file path in assignment: ${assignment.filePath}`);
    }
    
    // Check subtopic titles are valid
    for (const subtopic of assignment.subtopics) {
      if (!subtopicTitles.has(subtopic)) {
        throw new Error(`Invalid subtopic in assignment: ${subtopic}`);
      }
    }
    
    // Check assignment has at least one subtopic
    if (assignment.subtopics.length === 0) {
      throw new Error(`File must be assigned to at least one subtopic: ${assignment.filePath}`);
    }
  }
}
