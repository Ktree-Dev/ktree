import { readdir, stat } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import { summariseFile, type FileRecord } from "@ktree/pipeline";
import { GitignoreParser } from "./gitignore";

const SUPPORTED_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".cpp", ".c", ".h", ".hpp",
  ".cs", ".php", ".rb", ".go", ".rs", ".swift", ".kt", ".scala", ".sh",
  ".md", ".txt", ".json", ".yaml", ".yml"
];

const IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  "__pycache__",
  ".pytest_cache",
  "coverage",
  ".nyc_output"
];

export interface ScanOptions {
  maxFiles?: number;
  maxFileSize?: number; // in bytes
}

/**
 * Recursively scan directory for code files and summarize them
 */
export async function scanAndSummarizeFiles(
  repoPath: string, 
  options: ScanOptions = {}
): Promise<FileRecord[]> {
  const { maxFiles = 500, maxFileSize = 1024 * 1024 } = options; // 1MB default
  
  const allFiles = await findCodeFiles(repoPath, maxFiles);
  const fileRecords: FileRecord[] = [];
  
  console.log(`   Found ${allFiles.length} files to analyze`);
  
  for (const [index, filePath] of allFiles.entries()) {
    try {
      const stats = await stat(filePath);
      
      // Skip large files
      if (stats.size > maxFileSize) {
        console.log(`   Skipping large file: ${relative(repoPath, filePath)} (${Math.round(stats.size / 1024)}KB)`);
        continue;
      }
      
      // Progress indicator
      if ((index + 1) % 10 === 0) {
        console.log(`   Processed ${index + 1}/${allFiles.length} files...`);
      }
      
      const relativePath = relative(repoPath, filePath);
      const result = await summariseFile(filePath);
      
      const fileRecord: FileRecord = {
        id: `file_${index + 1}`,
        path: relativePath,
        name: relativePath.split("/").pop() || "",
        summary: {
          loc: result.summary.loc,
          title: result.summary.title,
          summary: result.summary.summary,
          // Preserve the full ChunkResult as a stringified field
          hash: result.hash,
          functions: result.summary.functions,
          classes: result.summary.classes
        } as any
      };
      
      fileRecords.push(fileRecord);
      
    } catch (error) {
      console.warn(`   Warning: Failed to process ${relative(repoPath, filePath)}:`, error instanceof Error ? error.message : error);
      continue;
    }
  }
  
  console.log(`   Successfully summarized ${fileRecords.length} files`);
  return fileRecords;
}

/**
 * Find all code files in directory tree
 */
export async function findCodeFiles(dirPath: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  
  // Load gitignore patterns
  const gitignoreParser = new GitignoreParser(dirPath);
  await gitignoreParser.loadGitignore();
  
  async function walk(currentPath: string): Promise<void> {
    if (files.length >= maxFiles) return;
    
    try {
      const entries = await readdir(currentPath);
      
      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        
        const fullPath = join(currentPath, entry);
        const stats = await stat(fullPath);
        
        // Check gitignore first
        if (gitignoreParser.shouldIgnore(fullPath)) {
          continue;
        }
        
        if (stats.isDirectory()) {
          // Skip ignored directories
          if (IGNORE_PATTERNS.some(pattern => entry.includes(pattern))) {
            continue;
          }
          await walk(fullPath);
        } else if (stats.isFile()) {
          // Include supported file types
          const ext = extname(entry).toLowerCase();
          if (SUPPORTED_EXTENSIONS.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
      console.warn(`Warning: Cannot read directory ${currentPath}`);
    }
  }
  
  await walk(dirPath);
  return files;
}
