import { VectorStorageService } from "./storage";
import { SQLiteBruteIndex } from "./sqliteIndex";

/**
 * VectorSimilarityService
 * ----------------------
 * Unified facade for vector similarity operations.
 * Automatically selects SQLite brute-force or PostgreSQL pgvector 
 * based on configuration.
 * 
 * Provides consistent API regardless of backend:
 * - topKSimilarById(nodeId, k) -> similar nodes
 * - topKSimilarByText(text, k) -> similar nodes  
 * - similarityBetween(id1, id2) -> cosine score
 */
export class VectorSimilarityService {
  private storage: VectorStorageService;
  private index: SQLiteBruteIndex;
  private backend: "sqlite" | "postgres";

  constructor(
    dbPath: string, 
    backend: "sqlite" | "postgres" = "sqlite"
  ) {
    this.backend = backend;
    
    if (backend === "sqlite") {
      this.storage = new VectorStorageService(dbPath);
      this.index = new SQLiteBruteIndex(this.storage);
    } else {
      // Note: PostgreSQL implementation would require different initialization
      // For now, fallback to SQLite if postgres not available
      console.warn("PostgreSQL backend not fully implemented, falling back to SQLite");
      this.storage = new VectorStorageService(dbPath);
      this.index = new SQLiteBruteIndex(this.storage);
      this.backend = "sqlite";
    }
  }

  /**
   * Initialize the service (load indices, connect to DB)
   */
  async initialize(model?: string): Promise<void> {
    if (this.backend === "sqlite") {
      await this.index.load(model);
    }
    // PostgreSQL initialization would go here
  }

  /**
   * Find top-K most similar nodes to a given node ID
   */
  async topKSimilarById(
    nodeId: string, 
    k = 10
  ): Promise<Array<{ id: string; score: number }>> {
    const queryVec = await this.storage.loadEmbedding(nodeId);
    if (!queryVec) {
      throw new Error(`No embedding found for node: ${nodeId}`);
    }

    if (this.backend === "sqlite") {
      return this.index.query(queryVec, k);
    }
    
    // PostgreSQL implementation would go here
    throw new Error("PostgreSQL backend not implemented");
  }

  /**
   * Find top-K most similar nodes to a text query
   * (requires EmbeddingGateway to generate query embedding)
   */
  async topKSimilarByText(
    text: string, 
    k = 10,
    embeddingGateway?: any // TODO: Type this properly when integrated
  ): Promise<Array<{ id: string; score: number }>> {
    if (!embeddingGateway) {
      throw new Error("EmbeddingGateway required for text queries");
    }

    // Generate embedding for query text
    const embeddingResult = await embeddingGateway.generateEmbedding(text);
    
    // Convert number[] to Float32Array for similarity calculation
    const queryVec = new Float32Array(embeddingResult.vector);
    
    if (this.backend === "sqlite") {
      return this.index.query(queryVec, k);
    }
    
    // PostgreSQL implementation would go here
    throw new Error("PostgreSQL backend not implemented");
  }

  /**
   * Get cosine similarity between two stored nodes
   */
  async similarityBetween(aId: string, bId: string): Promise<number | null> {
    if (this.backend === "sqlite") {
      return this.index.similarityBetween(aId, bId);
    }
    
    // PostgreSQL implementation would go here
    throw new Error("PostgreSQL backend not implemented");
  }

  /**
   * Save a new embedding (delegates to storage layer)
   */
  async saveEmbedding(
    nodeId: string, 
    vector: Float32Array, 
    model: string
  ): Promise<void> {
    await this.storage.saveEmbedding(nodeId, vector, model);
    
    // For SQLite, we need to reload the index after new embeddings
    if (this.backend === "sqlite") {
      await this.index.load(model);
    }
  }

  /**
   * Check if embedding exists for a node
   */
  async hasEmbedding(nodeId: string): Promise<boolean> {
    return this.storage.hasEmbedding(nodeId);
  }

  /**
   * Get statistics about stored embeddings
   */
  async getStats(): Promise<{total: number, models: Record<string, number>}> {
    return this.storage.getStats();
  }

  /**
   * Close connections and cleanup resources
   */
  async close(): Promise<void> {
    this.storage.close();
    // PostgreSQL cleanup would go here
  }
}

// Re-export core utilities for external use
export { cosineSimilarity, cosineDistance, topKSimilar } from "./similarity";
export { VectorStorageService } from "./storage";
export { SQLiteBruteIndex } from "./sqliteIndex";
