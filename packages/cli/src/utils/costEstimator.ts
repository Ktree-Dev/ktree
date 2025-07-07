import { loadConfig } from "@ktree/common";

// Model pricing data ($ per 1M tokens)
interface ModelPricing {
  input: number;
  output: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  "openai/gpt-4o": { input: 5.00, output: 20.00 },
  "openai/gpt-4o-mini": { input: 0.60, output: 2.40 },
  "openai/gpt-4.1": { input: 2.00, output: 8.00 },
  "openai/gpt-4.1-mini": { input: 0.40, output: 1.60 },
  "openai/gpt-4.1-nano": { input: 0.10, output: 0.40 },
  "openai/o3": { input: 2.00, output: 8.00 },
  "openai/o3-mini": { input: 1.10, output: 4.40 },
  
  // Anthropic
  "anthropic/claude-opus-4": { input: 15.00, output: 75.00 },
  "anthropic/claude-4-sonnet": { input: 3.00, output: 15.00 },
  "anthropic/claude-haiku-3.5": { input: 0.80, output: 4.00 },
  "anthropic/claude-3.5-sonnet": { input: 3.00, output: 15.00 },
  
  // Google
  "google/gemini-2.5-pro": { input: 1.25, output: 10.00 },
  "google/gemini-2.5-flash": { input: 0.30, output: 2.50 },
  "google/gemini-2.5-flash-lite": { input: 0.10, output: 0.40 },
  "google/gemini-2.0-flash": { input: 0.15, output: 0.60 },
  "google/textembedding-gecko-002": { input: 0.0125, output: 0.0125 }, // Embedding model
  
  // Mistral
  "mistral/medium-3": { input: 0.40, output: 2.00 },
  "mistral/large": { input: 2.00, output: 6.00 },
  "mistral/small-3.2": { input: 0.10, output: 0.30 },
  
  // Cohere
  "cohere/command-a": { input: 2.50, output: 10.00 },
  "cohere/command-r-plus": { input: 2.50, output: 10.00 },
  "cohere/command-r": { input: 0.15, output: 0.60 },
  "cohere/command-r-7b": { input: 0.0375, output: 0.15 },
};

export interface TokenEstimate {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface PipelineCostEstimate {
  summarization: TokenEstimate;
  directoryTreeSummaries: TokenEstimate;
  totalCost: number;
  fileCount: number;
}

/**
 * Estimate pipeline costs based on repository size and configured models
 */
export function estimatePipelineCost(fileCount: number): PipelineCostEstimate {
  const config = loadConfig();
  
  // Estimate tokens for file summarization
  const avgFileTokens = 800; // Average tokens per file (input)
  const avgSummaryTokens = 150; // Average summary output tokens
  const summaryInputTokens = fileCount * avgFileTokens;
  const summaryOutputTokens = fileCount * avgSummaryTokens;
  
  // Estimate tokens for directory tree summaries
  const directoryCount = Math.ceil(fileCount / 10); // Rough estimate of directories
  const avgDirInputTokens = 200; // Average input tokens per directory
  const avgDirOutputTokens = 50; // Average directory summary output
  const dirInputTokens = directoryCount * avgDirInputTokens;
  const dirOutputTokens = directoryCount * avgDirOutputTokens;
  
  const summarizerModel = config.llm.summariser;
  const summarizerPricing = MODEL_PRICING[summarizerModel] || { input: 1.0, output: 3.0 }; // Default fallback
  
  const summarizationCost = calculateModelCost(
    summarizerModel,
    summaryInputTokens,
    summaryOutputTokens,
    summarizerPricing
  );
  
  const directoryTreeCost = calculateModelCost(
    summarizerModel,
    dirInputTokens,
    dirOutputTokens,
    summarizerPricing
  );
  
  return {
    summarization: summarizationCost,
    directoryTreeSummaries: directoryTreeCost,
    totalCost: summarizationCost.cost + directoryTreeCost.cost,
    fileCount,
  };
}

function calculateModelCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing
): TokenEstimate {
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  
  return {
    model,
    inputTokens,
    outputTokens,
    cost: inputCost + outputCost,
  };
}

/**
 * Format cost estimate for display
 */
export function formatCostEstimate(estimate: PipelineCostEstimate): string {
  const lines = [
    `💰 Cost Estimate for ${estimate.fileCount} files:`,
    ``,
    `📄 File Summarization (${estimate.summarization.model}):`,
    `   Input:  ${estimate.summarization.inputTokens.toLocaleString()} tokens`,
    `   Output: ${estimate.summarization.outputTokens.toLocaleString()} tokens`,
    `   Cost:   $${estimate.summarization.cost.toFixed(4)}`,
    ``,
    `🌲 Directory Summaries (${estimate.directoryTreeSummaries.model}):`,
    `   Input:  ${estimate.directoryTreeSummaries.inputTokens.toLocaleString()} tokens`,
    `   Output: ${estimate.directoryTreeSummaries.outputTokens.toLocaleString()} tokens`,
    `   Cost:   $${estimate.directoryTreeSummaries.cost.toFixed(4)}`,
    ``,
    `💳 Total Estimated Cost: $${estimate.totalCost.toFixed(4)}`,
  ];
  
  return lines.join('\n');
}

/**
 * Prompt user for cost confirmation
 */
export async function promptCostConfirmation(estimate: PipelineCostEstimate, threshold: number = 1.0): Promise<boolean> {
  if (estimate.totalCost <= threshold) {
    return true; // Auto-approve under threshold
  }
  
  console.log(formatCostEstimate(estimate));
  console.log(`\n⚠️  Estimated cost ($${estimate.totalCost.toFixed(4)}) exceeds threshold ($${threshold.toFixed(2)})`);
  
  // In a real CLI, we'd use a proper prompt library like inquirer
  // For now, we'll use a simple implementation
  const response = await askYesNo("Do you want to proceed? (y/N): ");
  return response;
}

/**
 * Simple yes/no prompt (in a real implementation, use inquirer or similar)
 */
async function askYesNo(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(message);
    
    process.stdin.once('data', (data) => {
      const input = data.toString().trim().toLowerCase();
      resolve(input === 'y' || input === 'yes');
    });
  });
}
