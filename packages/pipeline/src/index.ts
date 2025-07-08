/**
 * @ktree/pipeline main entry point
 * Orchestrates the full repository analysis pipeline
 */

export { summariseFile } from "./services/FileSummarisationService";
export { DirectoryTreeService } from "./services/DirectoryTreeService";
export { summariseChunk } from "./services/LLMSummariser";
export { chunkFileAST } from "./services/treeChunker";

export { 
  buildOntology, 
  validateOntologyResults, 
  exportOntologyStructure 
} from "./services/llmOntology/OntologyService";
export { EmbeddingGateway } from "./services/mcp/EmbeddingGateway";

export type { FileRecord } from "./services/DirectoryTreeService";
export type { 
  OntologyBuildResult, 
  FileRecord as OntologyFileRecord, 
  DirectoryRecord as OntologyDirectoryRecord 
} from "./services/llmOntology/OntologyService";
export type { EmbeddingResult, BatchEmbeddingRequest } from "./services/mcp/EmbeddingGateway";
