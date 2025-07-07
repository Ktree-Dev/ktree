import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { existsSync } from "node:fs";

export class GitignoreParser {
  private patterns: string[] = [];
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = resolve(rootPath);
  }

  async loadGitignore(): Promise<void> {
    const gitignorePath = join(this.rootPath, ".gitignore");
    
    if (!existsSync(gitignorePath)) {
      return;
    }

    try {
      const content = await readFile(gitignorePath, "utf-8");
      this.patterns = content
        .split("\n")
        .map(line => line.trim())
        .filter(line => line && !line.startsWith("#")) // Remove comments and empty lines
        .map(pattern => {
          // Convert gitignore patterns to simple patterns we can work with
          if (pattern.endsWith("/")) {
            return pattern.slice(0, -1); // Remove trailing slash for directories
          }
          return pattern;
        });
    } catch (error) {
      console.warn("Warning: Could not read .gitignore file");
    }
  }

  /**
   * Check if a file path should be ignored based on gitignore patterns
   */
  shouldIgnore(filePath: string): boolean {
    const relativePath = relative(this.rootPath, filePath);
    
    for (const pattern of this.patterns) {
      if (this.matchesPattern(relativePath, pattern)) {
        return true;
      }
    }
    
    return false;
  }

  private matchesPattern(path: string, pattern: string): boolean {
    // Handle negation patterns (starting with !)
    if (pattern.startsWith("!")) {
      return !this.matchesPattern(path, pattern.slice(1));
    }

    // Handle wildcard patterns
    if (pattern.includes("*")) {
      const regexPattern = pattern
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*");
      
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(path);
    }

    // Exact match or directory match
    return path === pattern || 
           path.startsWith(pattern + "/") ||
           path.split("/").includes(pattern);
  }
}
