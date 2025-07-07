import { CommandModule } from "yargs";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "@ktree/common";
import { DirectoryTreeService } from "@ktree/pipeline";
import { scanAndSummarizeFiles } from "../utils/fileScanner";
import { estimatePipelineCost, promptCostConfirmation } from "../utils/costEstimator";

interface RunArgs {
  path?: string;
  cloud?: boolean;
}

/**
 * ktree run [path] - Pipeline orchestration command
 * Implements FR-CLI-04 (local) and FR-CLI-06 (cloud delegation)
 */
export const runCommand: CommandModule<{}, RunArgs> = {
  command: "run [path]",
  describe: "Run ktree analysis pipeline on a repository",
  builder: (yargs) => {
    return yargs
      .positional("path", {
        describe: "Path to repository (default: current directory)",
        type: "string",
        default: process.cwd(),
      })
      .option("cloud", {
        describe: "Delegate processing to ktree-cloud",
        type: "boolean",
        default: false,
      });
  },
  handler: async (argv) => {
    try {
      await runPipeline(argv);
    } catch (error) {
      console.error("Pipeline failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },
};

async function runPipeline(args: RunArgs): Promise<void> {
  const repoPath = resolve(args.path || process.cwd());
  
  // Validate repository path
  if (!existsSync(repoPath)) {
    throw new Error(`Repository path does not exist: ${repoPath}`);
  }

  console.log(` ktree pipeline starting for: ${repoPath}`);
  
  if (args.cloud) {
    await runCloudPipeline(repoPath);
  } else {
    await runLocalPipeline(repoPath);
  }
  
  console.log("Pipeline completed successfully!");
}

async function runLocalPipeline(repoPath: string): Promise<void> {
  // Load configuration
  const config = loadConfig();
  
  const startTime = Date.now();
  
  // Pre-scan to estimate costs
  console.log("\n Scanning repository for cost estimation...");
  const { findCodeFiles } = await import("../utils/fileScanner");
  const allFiles = await findCodeFiles(repoPath, 1000);
  const fileCount = allFiles.length;
  
  // Cost estimation and confirmation
  const costEstimate = estimatePipelineCost(fileCount);
  const approved = await promptCostConfirmation(costEstimate, 1.0);
  
  if (!approved) {
    console.log(" Pipeline cancelled by user");
    process.exit(2);
  }
  
  // Stage 1: File Summarization (KTR-31)
  console.log("\n Stage 1: File Summarization");
  const fileRecords = await scanAndSummarizeFiles(repoPath);
  console.log("   File summarization completed");
  
  // Stage 2: Directory Tree Building (KTR-32) 
  console.log("\n🌲 Stage 2: Directory Tree Building");
  const cacheDir = resolve(repoPath, ".ktree", "cache");
  const treeService = new DirectoryTreeService(cacheDir);
  
  const tree = await treeService.buildTree(fileRecords);
  console.log("   Directory tree built successfully");
  
  // Stage 3: Ontology Extraction (KTR-33) - Future
  console.log("\n Stage 3: Ontology Extraction (coming soon)");
  console.log("   Ontology extraction - placeholder");
  
  const duration = (Date.now() - startTime) / 1000;
  console.log(`\n  Total pipeline time: ${duration.toFixed(2)}s`);
}

async function runCloudPipeline(repoPath: string): Promise<void> {
  console.log("\n Delegating to ktree-cloud");
  
  // TODO: Implement cloud delegation
  // 1. Create repo snapshot (tar/zip)
  // 2. Upload to cloud API
  // 3. Poll for job completion
  // 4. Download results
  
  throw new Error("Cloud delegation not yet implemented");
}
