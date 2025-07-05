import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, isNull } from "drizzle-orm";
import { directories, DirectoryTreeNode, type Directory, type NewDirectory } from "@ktree/common/src/models";
import { summariseChunk } from "./LLMSummariser";

export interface DirectoryTreeOptions {
  cacheDir?: string;
}

export interface FileRecord {
  id: string;
  path: string;
  name: string;
  summary: { loc: number; title: string; summary: string };
}

/**
 * DirectoryTreeService builds a physical tree structure from file summaries.
 * Implements FR-TREE-01 through FR-TREE-07 from SRS §4.3.
 */
export class DirectoryTreeService {
  private db: ReturnType<typeof drizzle>;
  private options: Required<DirectoryTreeOptions>;

  constructor(cacheDir: string, options: DirectoryTreeOptions = {}) {
    this.options = {
      cacheDir
    };

    // Initialize database connection
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
    
    const dbPath = join(cacheDir, "summary-cache.sqlite");
    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    
    this.db = drizzle(sqlite);
    
    // Create directories table if not exists
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS directories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        parent_id TEXT,
        summary TEXT NOT NULL DEFAULT '',
        loc INTEGER NOT NULL DEFAULT 0,
        file_count INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  /**
   * FR-TREE-01: Build directory tree from file records
   */
  async buildTree(fileRecords: FileRecord[]): Promise<DirectoryTreeNode> {
    // Build in-memory tree structure
    const tree = this.buildInMemoryTree(fileRecords);
    
    // Calculate metrics (LOC, file counts) via post-order traversal
    this.calculateMetrics(tree, fileRecords);
    
    // Generate directory summaries
    await this.generateDirectorySummaries(tree);
    
    // Persist to database
    await this.persistTree(tree);
    
    return tree;
  }

  /**
   * FR-TREE-01: Construct in-memory tree from file paths
   */
  private buildInMemoryTree(fileRecords: FileRecord[]): DirectoryTreeNode {
    const nodeMap = new Map<string, DirectoryTreeNode>();
    
    // Create root node
    const root: DirectoryTreeNode = {
      id: "root",
      name: "root",
      path: "",
      parentId: null,
      summary: "",
      loc: 0,
      fileCount: 0,
      children: [],
      files: [],
    };
    nodeMap.set("", root);

    // Process each file to create directory structure
    for (const file of fileRecords) {
      let dirPath = dirname(file.path);
      
      // Handle root directory files (dirname returns "." for files in root)
      if (dirPath === ".") {
        dirPath = "";
      }
      
      // Create all parent directories if they don't exist
      this.ensureDirectoryPath(dirPath, nodeMap, root);
      
      // Add file to its parent directory
      const parentDir = nodeMap.get(dirPath);
      if (parentDir) {
        parentDir.files.push(file.id);
      }
    }

    return root;
  }

  /**
   * Ensure all directories in path exist in the tree
   */
  private ensureDirectoryPath(
    dirPath: string, 
    nodeMap: Map<string, DirectoryTreeNode>, 
    root: DirectoryTreeNode
  ): void {
    if (dirPath === "" || dirPath === "." || nodeMap.has(dirPath)) {
      return;
    }

    const parentPath = dirname(dirPath);
    const dirName = basename(dirPath);
    
    // Recursively ensure parent exists
    this.ensureDirectoryPath(parentPath, nodeMap, root);
    
    // Create this directory
    const parent = nodeMap.get(parentPath === "." ? "" : parentPath);
    if (!parent) {
      throw new Error(`Parent directory not found for path: ${dirPath}`);
    }

    const dirNode: DirectoryTreeNode = {
      id: this.generateDirId(dirPath),
      name: dirName,
      path: dirPath,
      parentId: parent.id === "root" ? null : parent.id,
      summary: "",
      loc: 0,
      fileCount: 0,
      children: [],
      files: [],
    };

    nodeMap.set(dirPath, dirNode);
    parent.children.push(dirNode);
  }

  /**
   * FR-TREE-02: Calculate cumulative metrics via post-order traversal
   */
  private calculateMetrics(node: DirectoryTreeNode, fileRecords: FileRecord[]): void {
    let totalLoc = 0;
    let totalFileCount = node.files.length;

    // First, recurse to children
    for (const child of node.children) {
      this.calculateMetrics(child, fileRecords);
      totalLoc += child.loc;
      totalFileCount += child.fileCount;
    }

    // Add LOC from files in this directory
    const fileRecordMap = new Map(fileRecords.map(f => [f.id, f]));
    for (const fileId of node.files) {
      const fileRecord = fileRecordMap.get(fileId);
      if (fileRecord) {
        totalLoc += fileRecord.summary.loc;
      }
    }
    
    node.loc = totalLoc;
    node.fileCount = totalFileCount;
    
  }

  /**
   * FR-TREE-03: Generate directory summaries
   */
  private async generateDirectorySummaries(node: DirectoryTreeNode): Promise<void> {
    const childCount = node.children.length + node.files.length;

    if (childCount === 0) {
      node.summary = "[empty directory]";
    } else if (childCount <= 3) {
      // FR-TREE-03: Heuristic for small directories
      node.summary = this.generateHeuristicSummary(node);
    } else {
      // FR-TREE-03: LLM summary for larger directories
      node.summary = await this.generateLLMSummary(node);
    }

    // Recurse to children
    for (const child of node.children) {
      await this.generateDirectorySummaries(child);
    }
  }

  /**
   * Generate heuristic summary for directories with ≤3 items
   */
  private generateHeuristicSummary(node: DirectoryTreeNode): string {
    const items: string[] = [];
    
    // Add child directory names
    for (const child of node.children) {
      items.push(`${child.name}/`);
    }
    
    // Add file names
    items.push(...node.files);
    
    if (items.length === 1) {
      return `Contains ${items[0]}`;
    } else {
      return `Contains ${items.join(", ")}`;
    }
  }

  /**
   * Generate LLM summary for directories with >3 items
   */
  private async generateLLMSummary(node: DirectoryTreeNode): Promise<string> {
    const childItems: string[] = [];
    
    // Add child directories
    for (const child of node.children) {
      childItems.push(`${child.name}/ (directory)`);
    }
    
    // Add files
    childItems.push(...node.files.map(f => `${f} (file)`));
    
    const prompt = `Summarize the purpose of the directory '${node.name}' given the following contents: ${childItems.join(", ")}. Provide a one-sentence description.`;
    
    try {
      const result = await summariseChunk(prompt, "text");
      return result.summary;
    } catch (error) {
      console.warn(`Failed to generate LLM summary for ${node.path}:`, error);
      return `Directory containing ${childItems.length} items including ${childItems.join(", ")}`;
    }
  }

  /**
   * FR-TREE-04: Persist tree to database
   */
  private async persistTree(root: DirectoryTreeNode): Promise<void> {
    // Clear existing directories (full rebuild approach)
    await this.db.delete(directories);
    
    // Insert directories via depth-first traversal
    await this.insertDirectoryRecursively(root);
  }

  /**
   * Recursively insert directory and its children
   */
  private async insertDirectoryRecursively(node: DirectoryTreeNode): Promise<void> {
    // Skip root node (it's just a container)
    if (node.id !== "root") {
      const newDir: NewDirectory = {
        id: node.id,
        name: node.name,
        path: node.path,
        parentId: node.parentId,
        summary: node.summary,
        loc: node.loc,
        fileCount: node.fileCount
      };
      
      await this.db.insert(directories).values(newDir);
    }

    // Recursively insert children
    for (const child of node.children) {
      await this.insertDirectoryRecursively(child);
    }
  }

  /**
   * Generate stable ID for directory based on path
   */
  private generateDirId(path: string): string {
    return createHash("sha256").update(path).digest("hex").substring(0, 16);
  }

  /**
   * FR-TREE-06: Validate tree integrity
   */
  validateTreeIntegrity(tree: DirectoryTreeNode, expectedFileCount: number): void {
    const actualFileCount = this.countFilesInTree(tree);
    
    if (actualFileCount !== expectedFileCount) {
      throw new Error(
        `Tree integrity check failed: expected ${expectedFileCount} files, found ${actualFileCount}`
      );
    }
  }

  /**
   * Count total files in tree
   */
  private countFilesInTree(node: DirectoryTreeNode): number {
    let count = node.files.length;
    
    for (const child of node.children) {
      count += this.countFilesInTree(child);
    }
    
    return count;
  }

  /**
   * Get directory tree from database
   */
  async getDirectoryTree(): Promise<Directory[]> {
    return await this.db.select().from(directories);
  }

  /**
   * Get root directories (no parent)
   */
  async getRootDirectories(): Promise<Directory[]> {
    return await this.db.select().from(directories).where(isNull(directories.parentId));
  }

  /**
   * Get children of a directory
   */
  async getDirectoryChildren(parentId: string): Promise<Directory[]> {
    return await this.db.select().from(directories).where(eq(directories.parentId, parentId));
  }
}
