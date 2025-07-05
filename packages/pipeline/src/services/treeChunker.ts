// eslint-disable-next-line @typescript-eslint/no-var-requires
const Parser = require("tree-sitter");
import JavaScript from "tree-sitter-javascript";
import TypeScript from "tree-sitter-typescript";
import Python from "tree-sitter-python";

/**
 * AST–based chunker that groups top-level declarations (functions / classes /
 * methods) and splits oversized bodies to keep chunks inside a token/LOC
 * budget.  Fallbacks to whole-file when grammar not available.
 */

export interface AstChunk {
  text: string;
  startLine: number;
  endLine: number;
}

const LOC_LIMIT = 300;

/** Pick grammar by language hint */
function getGrammar(language: string): any | undefined {
  const parser = new Parser();

  switch (language) {
    case "typescript":
    case "tsx":
    case "javascript":
    case "js":
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      parser.setLanguage(language.startsWith("ts") ? TypeScript.typescript : JavaScript);
      return parser;
    case "python":
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parser.setLanguage(Python as any);
      return parser;
    default:
      return undefined;
  }
}

/**
 * Split file content into semantic chunks based on AST nodes.
 * If grammar not available, returns single chunk as fallback.
 */
export function chunkFileAST(
  content: string,
  languageHint: string,
): AstChunk[] {
  const parser = getGrammar(languageHint);
  if (!parser) {
    return [{ text: content, startLine: 0, endLine: content.split("\n").length - 1 }];
  }

  const tree = parser.parse(content);
  const chunks: AstChunk[] = [];
  const root = tree.rootNode;

  // Gather top-level declarations
  root.children.forEach((node: any) => {
    if (
      ["function_declaration", "class_declaration", "method_definition"].includes(
        node.type,
      )
    ) {
      const start = node.startPosition.row;
      const end = node.endPosition.row;
      const loc = end - start + 1;

      // If very large declaration, split on LOC window
      if (loc > LOC_LIMIT) {
        let sliceStart = start;
        while (sliceStart < end) {
          const sliceEnd = Math.min(sliceStart + LOC_LIMIT - 1, end);
          chunks.push({
            text: grabLines(content, sliceStart, sliceEnd),
            startLine: sliceStart,
            endLine: sliceEnd,
          });
          sliceStart = sliceEnd + 1;
        }
      } else {
        chunks.push({
          text: grabLines(content, start, end),
          startLine: start,
          endLine: end,
        });
      }
    }
  });

  // Fallback: if nothing matched (e.g., script-only file) return whole file
  if (chunks.length === 0) {
    return [{ text: content, startLine: 0, endLine: content.split("\n").length - 1 }];
  }

  return chunks;
}

function grabLines(source: string, start: number, end: number): string {
  const lines = source.split("\n").slice(start, end + 1);
  return lines.join("\n");
}
