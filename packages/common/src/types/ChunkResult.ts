/**
 * Types for deterministic file-summary JSON returned by FileSummarisationService.
 */

export interface FunctionSummary {
  name: string;
  loc: number;
  summary: string;
}

export interface ClassSummary {
  name: string;
  loc: number;
  summary: string;
}

export interface FileSummary {
  /**
   * Short, human-readable title for the file (e.g. top-level class/function)
   */
  title: string;
  /**
   * One-paragraph natural-language summary of the file’s purpose.
   */
  summary: string;
  /**
   * List of top-level functions with LOC & summaries.
   */
  functions: FunctionSummary[];
  /**
   * List of top-level classes with LOC & summaries.
   */
  classes: ClassSummary[];
  /**
   * Total lines of code in the file.
   */
  loc: number;
}

export interface ChunkResult {
  hash: string;          // sha256(fileContent + modelVersion)
  language: string;      // e.g. "typescript"
  summary: FileSummary;
  path?: string;         // optional file path for context display
}
