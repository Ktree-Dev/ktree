import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import { FileSummary, ChunkResult } from "@ktree/common/src/types/ChunkResult";
import { chunkFileAST } from "./treeChunker";
import { summariseChunk } from "./LLMSummariser";

// ---------------------------------------------------------------------------
// Schema & DB setup
// ---------------------------------------------------------------------------

const summaryCache = sqliteTable("summary_cache", {
  hash: text("hash").primaryKey(),
  json: text("json").notNull(),
});

const DEFAULT_CACHE_DIR = join(homedir(), ".ktree", "cache");
const MODEL_VERSION = "2025-07"; // bump when summariser prompt/model changes
const CHUNK_LOC_TARGET = 300;

/** Ensure cache directory & DB exist, return Drizzle instance */
function initCache(cacheDir = DEFAULT_CACHE_DIR) {
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const dbPath = join(cacheDir, "summary-cache.sqlite");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  
  const db = drizzle(sqlite);
  
  // Create table using raw SQL (Drizzle migrations would be overkill for cache)
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS summary_cache (
       hash TEXT PRIMARY KEY,
       json TEXT NOT NULL
     )`,
  );
  
  return db;
}

/** SHA-256 of fileContent + model version for deterministic cache key */
function computeHash(content: string): string {
  const h = createHash("sha256");
  h.update(content);
  h.update(MODEL_VERSION);
  return h.digest("hex");
}

// ---------------------------------------------------------------------------
// Chunker (AST via tree-sitter, fallback to line chunks)
// ---------------------------------------------------------------------------

function detectLanguage(filename: string): string {
  const ext = extname(filename).toLowerCase();
  if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) return "typescript";
  if ([".py"].includes(ext)) return "python";
  // add more…
  return "plain";
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SummariseOptions {
  cacheDir?: string;
  concurrency?: number;
}

export async function summariseFile(
  filePath: string,
  opts: SummariseOptions = {},
): Promise<ChunkResult> {
  const cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR;
  const db = initCache(cacheDir);

  const content = readFileSync(filePath, "utf8");
  const hash = computeHash(content);

  // check cache
  const cached = await db
    .select()
    .from(summaryCache)
    .where(eq(summaryCache.hash, hash))
    .get();
  if (cached) return JSON.parse(cached.json) as ChunkResult;

  const language = detectLanguage(filePath);

  const astChunks = chunkFileAST(content, language);
  const summaries: FileSummary[] = [];

  for (const astChunk of astChunks) {
    // eslint-disable-next-line no-await-in-loop
    summaries.push(await summariseChunk(astChunk.text, language));
  }

  // Naive aggregation: merge first summaries (improve later)
  const merged: FileSummary = {
    title: summaries[0].title,
    summary: summaries.map((s) => s.summary).join("\n\n"),
    functions: summaries.flatMap((s) => s.functions),
    classes: summaries.flatMap((s) => s.classes),
    loc: content.split("\n").length,
  };

  const result: ChunkResult = { hash, language, summary: merged };

  await db.insert(summaryCache).values({
    hash,
    json: JSON.stringify(result),
  });

  return result;
}
