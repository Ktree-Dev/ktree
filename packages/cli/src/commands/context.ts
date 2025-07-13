import type { Arguments, CommandBuilder, CommandModule } from "yargs";
import { VectorSimilarityService } from "@ktree/pipeline";
import { EmbeddingGateway } from "@ktree/pipeline";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import path from "path";
import fs from "fs";

interface ContextArgs extends Arguments {
  query: string;
  k?: number;
  cache?: string;
  verbose?: boolean;
}

const builder = (yargs: any) =>
  yargs
    .positional("query", {
      type: "string",
      describe: "Natural language query to search for",
      demandOption: true,
    })
    .option("k", {
      type: "number",
      describe: "Number of results to return",
      default: 20,
    })
    .option("cache", {
      type: "string",
      describe: "Path to ktree cache directory",
      default: ".ktree",
    })
    .option("verbose", {
      type: "boolean",
      describe: "Show detailed similarity scores",
      default: false,
    });

interface CategoryResult {
  id: string;
  score: number;
  type: 'domain' | 'topic' | 'file' | 'chunk';
  title: string;
  description: string;
  metadata?: any;
}

async function handler(argv: ContextArgs): Promise<void> {
  const { query, k = 10, cache = ".ktree", verbose = false } = argv;
  const cacheDir = path.resolve(cache);

  // Check if ktree cache exists
  if (!fs.existsSync(cacheDir)) {
    console.error("No ktree cache found. Please run 'ktree run' first to build the knowledge tree.");
    process.exit(1);
  }

  console.log(`🔍 Searching for: "${query}"`);
  console.log(`📁 Cache directory: ${cacheDir}\n`);

  // Initialize vector similarity service
  const dbPath = path.join(cacheDir, "cache", "summary-cache.sqlite");
  const vectorService = new VectorSimilarityService(dbPath, "sqlite");
  
  try {
    // Initialize the service (load embeddings index)
    await vectorService.initialize();
    
    // Check if we have any embeddings
    const stats = await vectorService.getStats();
    if (stats.total === 0) {
      console.log("   No embeddings found in cache. The vector similarity search may not work.");
      console.log("   Make sure you've run 'ktree run' with embedding generation enabled.");
      return;
    }

    if (verbose) {
      console.log(`  Found ${stats.total} embeddings across ${Object.keys(stats.models).length} models`);
      console.log(`   Models: ${Object.keys(stats.models).join(", ")}\n`);
    }

    // Initialize embedding gateway for query embedding
    const embeddingGateway = new EmbeddingGateway(vectorService);
    
    // Generate query embedding
    console.log("   🔄 Generating query embedding...");
    try {
      const testEmbedding = await embeddingGateway.generateEmbedding(query);
      if (!testEmbedding.vector || testEmbedding.vector.length === 0) {
        throw new Error("Query embedding generation failed - empty vector returned");
      }
      console.log(`   ✅ Query embedding generated (${testEmbedding.dimensions} dimensions)\n`);
    } catch (embeddingError) {
      console.error("   ❌ Failed to generate query embedding:", embeddingError instanceof Error ? embeddingError.message : embeddingError);
      console.log("   💡 Make sure your embedding API keys are configured correctly in ~/.ktree/config.json");
      return;
    }
    
    // Get categorized results
    const categorizedResults = await getCategorizedResults(query, k, cacheDir, vectorService, embeddingGateway, verbose);
    
    // Display results by category
    await displayCategorizedResults(categorizedResults, verbose);
    
  } catch (error) {
    throw new Error(`Vector similarity search failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Clean up
    await vectorService.close();
  }
}

async function getCategorizedResults(
  query: string, 
  k: number, 
  cacheDir: string, 
  vectorService: any, 
  embeddingGateway: any,
  verbose: boolean
): Promise<{
  domains: CategoryResult[];
  topics: CategoryResult[];
  files: CategoryResult[];
  chunks: CategoryResult[];
}> {
  const results = {
    domains: [] as CategoryResult[],
    topics: [] as CategoryResult[],
    files: [] as CategoryResult[],
    chunks: [] as CategoryResult[]
  };

  // 1. Always include root domain
  await getRootDomain(cacheDir, results.domains);

  // 2. Get ontology-based results (domains & topics)
  await getOntologyResults(query, cacheDir, embeddingGateway, results, verbose);

  // 3. Get semantic similarity results (files & chunks)
  await getSemanticResults(query, k, vectorService, embeddingGateway, cacheDir, results, verbose);

  return results;
}

async function getRootDomain(cacheDir: string, domains: CategoryResult[]): Promise<void> {
  try {
    const ontologyDbPath = path.join(cacheDir, "cache", "ontology.sqlite");
    if (!fs.existsSync(ontologyDbPath)) return;

    const ontologyDb = new Database(ontologyDbPath);
    const db = drizzle(ontologyDb);
    
    const topicsTable = sqliteTable("topics", {
      id: text("id").primaryKey(),
      title: text("title").notNull(),
      description: text("description").notNull(),
      parentId: text("parent_id"),
      depth: text("depth").notNull(),
      isRoot: text("is_root").notNull()
    });

    const rootDomain = await db
      .select()
      .from(topicsTable)
      .where(eq(topicsTable.isRoot, "true"))
      .get();

    if (rootDomain) {
      domains.push({
        id: rootDomain.id,
        score: 1.0, // Always highest priority
        type: 'domain',
        title: rootDomain.title,
        description: rootDomain.description,
        metadata: { depth: rootDomain.depth, isRoot: true }
      });
    }

    ontologyDb.close();
  } catch (error) {
    // Silently fail if ontology not available
  }
}

async function getOntologyResults(
  query: string,
  cacheDir: string,
  embeddingGateway: any,
  results: any,
  verbose: boolean
): Promise<void> {
  try {
    const ontologyDbPath = path.join(cacheDir, "cache", "ontology.sqlite");
    if (!fs.existsSync(ontologyDbPath)) return;

    const ontologyDb = new Database(ontologyDbPath);
    const db = drizzle(ontologyDb);
    
    const topicsTable = sqliteTable("topics", {
      id: text("id").primaryKey(),
      title: text("title").notNull(),
      description: text("description").notNull(),
      parentId: text("parent_id"),
      depth: text("depth").notNull(),
      isRoot: text("is_root").notNull()
    });

    // Get all topics (excluding root)
    const allTopics = await db
      .select()
      .from(topicsTable)
      .where(eq(topicsTable.isRoot, "false"))
      .all();

    // Calculate semantic similarity for each topic
    const topicScores: Array<{topic: any, score: number}> = [];
    
    for (const topic of allTopics) {
      try {
        const topicText = `${topic.title}: ${topic.description}`;
        const queryEmbedding = await embeddingGateway.generateEmbedding(query);
        const topicEmbedding = await embeddingGateway.generateEmbedding(topicText);
        
        // Calculate cosine similarity
        const score = cosineSimilarity(queryEmbedding.vector, topicEmbedding.vector);
        topicScores.push({ topic, score });
      } catch (error) {
        if (verbose) console.warn(`Failed to score topic ${topic.title}:`, error);
      }
    }

    // Sort by score and categorize
    topicScores.sort((a, b) => b.score - a.score);
    
    for (const { topic, score } of topicScores.slice(0, 3)) { // Top 3
      const categoryResult: CategoryResult = {
        id: topic.id,
        score,
        type: parseInt(topic.depth) === 1 ? 'domain' : 'topic',
        title: topic.title,
        description: topic.description,
        metadata: { depth: topic.depth, parentId: topic.parentId }
      };
      
      if (parseInt(topic.depth) === 1) {
        // Don't add if we already have root domain with same title
        if (!results.domains.find((d: CategoryResult) => d.title === topic.title)) {
          results.domains.push(categoryResult);
        }
      } else {
        results.topics.push(categoryResult);
      }
    }

    ontologyDb.close();
  } catch (error) {
    if (verbose) console.warn("Failed to get ontology results:", error);
  }
}

async function getSemanticResults(
  query: string,
  k: number,
  vectorService: any,
  embeddingGateway: any,
  cacheDir: string,
  results: any,
  verbose: boolean
): Promise<void> {
  try {
    // Get top semantic matches
    const semanticResults = await vectorService.topKSimilarByText(query, k * 2, embeddingGateway); // Get more to filter
    
    if (semanticResults.length === 0) return;

    // Load summary cache
    const summaryCacheDbPath = path.join(cacheDir, "cache", "summary-cache.sqlite");
    if (!fs.existsSync(summaryCacheDbPath)) return;
    
    const summaryDb = new Database(summaryCacheDbPath);
    const db = drizzle(summaryDb);
    
    const summaryCache = sqliteTable("summary_cache", {
      hash: text("hash").primaryKey(),
      json: text("json").notNull(),
    });

    // Process each result
    for (const result of semanticResults) {
      const nodeId = result.id;
      const isChunk = nodeId.includes(':func:') || nodeId.includes(':class:');
      
      try {
        if (isChunk) {
          // Parse chunk ID: fileId:type:index:name
          const parts = nodeId.split(':');
          const fileId = parts[0];
          const chunkType = parts[1];
          const chunkIndex = parseInt(parts[2]);
          const chunkName = parts.slice(3).join(':');
          
          // Look up parent file metadata
          const cached = await db
            .select()
            .from(summaryCache)
            .where(eq(summaryCache.hash, fileId))
            .get();
            
          if (cached && results.chunks.length < 4) { // Limit chunks
            const chunkResult = JSON.parse(cached.json);
            const summary = chunkResult.summary;
            const chunks = chunkType === 'func' ? summary.functions : summary.classes;
            const chunk = chunks && chunks[chunkIndex];
            
            if (chunk) {
              results.chunks.push({
                id: nodeId,
                score: result.score,
                type: 'chunk',
                title: `${chunkType === 'func' ? '🔧' : '🏗️'} ${chunkName}()`,
                description: chunk.summary || 'No description available',
                metadata: {
                  file: summary.title,
                  path: chunkResult.path,
                  loc: chunk.loc,
                  type: chunkType
                }
              });
            }
          }
        } else {
          // File-level result
          const cached = await db
            .select()
            .from(summaryCache)
            .where(eq(summaryCache.hash, nodeId))
            .get();
            
          if (cached && results.files.length < 4) { // Limit files
            const chunkResult = JSON.parse(cached.json);
            const summary = chunkResult.summary;
            
            results.files.push({
              id: nodeId,
              score: result.score,
              type: 'file',
              title: `📄 ${summary.title || 'Unknown file'}`,
              description: summary.summary || 'No summary available',
              metadata: {
                path: chunkResult.path,
                loc: summary.loc,
                functions: summary.functions?.length || 0,
                classes: summary.classes?.length || 0
              }
            });
          }
        }
      } catch (error) {
        if (verbose) console.warn(`Failed to process result ${nodeId}:`, error);
      }
      
      // Stop when we have enough of each type
      if (results.files.length >= 4 && results.chunks.length >= 4) break;
    }
    
    summaryDb.close();
  } catch (error) {
    if (verbose) console.warn("Failed to get semantic results:", error);
  }
}

async function displayCategorizedResults(results: any, verbose: boolean): Promise<void> {
  let totalResults = 0;

  // Display Domains
  if (results.domains.length > 0) {
    console.log("🏗️ **DOMAINS**");
    for (let i = 0; i < results.domains.length; i++) {
      const result = results.domains[i];
      const score = (result.score * 100).toFixed(1);
      console.log(`${i + 1}. ${result.title} ${verbose ? `(${score}% relevance)` : ""}`);
      console.log(`   ${result.description}`);
      if (verbose && result.metadata?.isRoot) {
        console.log(`   🌳 Root Domain`);
      }
      console.log();
      totalResults++;
    }
  }

  // Display Topics
  if (results.topics.length > 0) {
    console.log("🎯 **TOPICS**");
    for (let i = 0; i < results.topics.length; i++) {
      const result = results.topics[i];
      const score = (result.score * 100).toFixed(1);
      console.log(`${i + 1}. ${result.title} ${verbose ? `(${score}% relevance)` : ""}`);
      console.log(`   ${result.description}`);
      if (verbose) {
        console.log(`   📊 Depth: ${result.metadata?.depth}`);
      }
      console.log();
      totalResults++;
    }
  }

  // Display Files
  if (results.files.length > 0) {
    console.log("📄 **FILES**");
    for (let i = 0; i < results.files.length; i++) {
      const result = results.files[i];
      const score = (result.score * 100).toFixed(1);
      console.log(`${i + 1}. ${result.title} ${verbose ? `(${score}% similarity)` : ""}`);
      console.log(`   ${result.description}`);
      console.log(`   📁 ${result.metadata?.path || 'Unknown path'}`);
      if (verbose) {
        console.log(`   📊 LOC: ${result.metadata?.loc || 'Unknown'}, Functions: ${result.metadata?.functions || 0}, Classes: ${result.metadata?.classes || 0}`);
      }
      console.log();
      totalResults++;
    }
  }

  // Display Chunks
  if (results.chunks.length > 0) {
    console.log("⚡ **CODE CHUNKS**");
    for (let i = 0; i < results.chunks.length; i++) {
      const result = results.chunks[i];
      const score = (result.score * 100).toFixed(1);
      console.log(`${i + 1}. ${result.title} ${verbose ? `(${score}% similarity)` : ""}`);
      console.log(`   ${result.description}`);
      console.log(`   📁 ${result.metadata?.file} - ${result.metadata?.path || 'Unknown path'}`);
      if (verbose) {
        console.log(`   📊 LOC: ${result.metadata?.loc || 'Unknown'}, Type: ${result.metadata?.type}`);
      }
      console.log();
      totalResults++;
    }
  }

  if (totalResults === 0) {
    console.log("No relevant results found.");
  } else {
    console.log(`📊 Found ${totalResults} relevant results across ${Object.values(results).filter((arr: any) => arr.length > 0).length} categories`);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const contextCommand: CommandModule<{}, ContextArgs> = {
  command: "context <query>",
  describe: "Query the codebase for relevant context using semantic similarity",
  builder,
  handler,
};
