import { CommandModule } from "yargs";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "@ktree/common";
import { DirectoryTreeService, buildOntology, validateOntologyResults } from "@ktree/pipeline";
import { VectorSimilarityService } from "@ktree/pipeline";
import { EmbeddingGateway } from "@ktree/pipeline";
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
  console.log("\nStage 1: File Summarization");
  const fileRecords = await scanAndSummarizeFiles(repoPath);
  console.log("   File summarization completed");
  
  // Stage 2: Directory Tree Building (KTR-32) 
  console.log("\nStage 2: Directory Tree Building");
  const cacheDir = resolve(repoPath, ".ktree", "cache");
  const treeService = new DirectoryTreeService(cacheDir);
  
  const tree = await treeService.buildTree(fileRecords);
  console.log("   Directory tree built successfully");
  
  // Stage 3: Ontology Extraction (KTR-33)
  console.log("\nStage 3: Ontology Extraction");
  
  // Transform records to match OntologyService interface
  const ontologyFileRecords = fileRecords.map(record => ({
    id: record.id,
    path: record.path,
    name: record.name,
    summary: record.summary
  }));
  
  const allDirectories = await treeService.getDirectoryTree();
  const ontologyDirectoryRecords = allDirectories.map(dir => ({
    id: dir.id,
    path: dir.path,
    summary: dir.summary || "Directory summary",
    fileCount: dir.fileCount || 0,
    loc: dir.loc || 0
  }));
  
  try {
    const ontologyResult = await buildOntology(cacheDir, ontologyFileRecords, ontologyDirectoryRecords);
    
    // Validate results
    const validation = validateOntologyResults(ontologyResult);
    if (validation.passed) {
      console.log("   ✅ Ontology extraction completed successfully");
      console.log(`      📊 ${ontologyResult.persistence.topicCount} topics, ${ontologyResult.persistence.linkCount} links`);
      console.log(`      � Coverage: ${ontologyResult.persistence.coveragePercentage}%`);
      console.log(`      🤖 LLM calls: ${ontologyResult.llmCallCount}`);
    } else {
      console.log("   ⚠️  Ontology extraction completed with issues:");
      validation.issues.forEach(issue => console.log(`      - ${issue}`));
    }
  } catch (error) {
    console.warn("   ⚠️  Ontology extraction failed:", error instanceof Error ? error.message : error);
    console.log("   📝 Pipeline will continue without ontology data");
  }
  
  // Stage 4: Embedding Generation (KTR-34)
  console.log("\n🔍 Stage 4: Embedding Generation");
  try {
    const vectorDbPath = resolve(cacheDir, "summary-cache.sqlite");
    const vectorService = new VectorSimilarityService(vectorDbPath, "sqlite");
    const embeddingGateway = new EmbeddingGateway(vectorService);
    
    console.log("   🔄 Generating embeddings for file summaries...");
    
    let embeddingCount = 0;
    let chunkEmbeddingCount = 0;
    
    for (const record of fileRecords) {
      try {
        // ----------------------------
        // Align embedding IDs with summary_cache.hash
        // ----------------------------
        const summaryObj =
          typeof record.summary === "string"
            ? JSON.parse(record.summary)
            : record.summary;
        // Use the same SHA-256 key stored in summary_cache
        const embedIdBase: string =
          (summaryObj as any).hash ?? record.id;

if (process.env.KTREE_DEBUG) {
  console.log(
    `DEBUG embed: ${record.path}\n  summaryObj.hash=${(summaryObj as any).hash}\n  record.id=${record.id}\n  embedIdBase=${embedIdBase}\n  functions=${summaryObj.functions?.length || 0}\n  classes=${summaryObj.classes?.length || 0}`,
  );
}

        // 1. Generate file-level embedding
        const summaryText =
          typeof record.summary === "string"
            ? record.summary
            : record.summary.summary;
        await embeddingGateway.generateAndSaveEmbedding(summaryText, embedIdBase);
        embeddingCount++;

        // 2. Generate chunk-level embeddings for functions and classes
        // Embed individual functions
        if (summaryObj.functions && Array.isArray(summaryObj.functions)) {
          for (let i = 0; i < summaryObj.functions.length; i++) {
            const func = summaryObj.functions[i];
            if (func?.name && func?.summary) {
              const chunkId = `${embedIdBase}:func:${i}:${func.name}`;
              const chunkText = `${func.name}: ${func.summary}`;
              await embeddingGateway.generateAndSaveEmbedding(chunkText, chunkId);
              chunkEmbeddingCount++;
            }
          }
        }

        // Embed individual classes
        if (summaryObj.classes && Array.isArray(summaryObj.classes)) {
          for (let i = 0; i < summaryObj.classes.length; i++) {
            const cls = summaryObj.classes[i];
            if (cls?.name && cls?.summary) {
              const chunkId = `${embedIdBase}:class:${i}:${cls.name}`;
              const chunkText = `${cls.name}: ${cls.summary}`;
              await embeddingGateway.generateAndSaveEmbedding(chunkText, chunkId);
              chunkEmbeddingCount++;
            }
          }
        }
        
      } catch (error) {
        console.warn(`   ⚠️  Failed to generate embedding for ${record.path}:`, error instanceof Error ? error.message : error);
      }
    }
    
    // Initialize the vector service for query capabilities
    await vectorService.initialize();
    const stats = await vectorService.getStats();
    
    console.log(`   ✅ Embedding generation completed`);
    console.log(`      📊 Generated ${embeddingCount} file embeddings`);
    console.log(`      🔍 Generated ${chunkEmbeddingCount} chunk embeddings (functions + classes)`);
    console.log(`      🗄️  Total stored: ${stats.total} embeddings`);
    console.log(`      🤖 Models: ${Object.keys(stats.models).join(", ")}`);
    
    await vectorService.close();
  } catch (error) {
    console.warn("   ⚠️  Embedding generation failed:", error instanceof Error ? error.message : error);
    console.log("   📝 Pipeline will continue without embedding data");
  }
  
  const duration = (Date.now() - startTime) / 1000;
  console.log(`\n  Total pipeline time: ${duration.toFixed(2)}s`);
  console.log(`\n💡 Use 'ktree context "your query"' to search the codebase semantically`);
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
