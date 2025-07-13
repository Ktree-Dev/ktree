import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, sql, count } from "drizzle-orm";
import { embeddings, type Embedding, type NewEmbedding } from "@ktree/common";

/**
 * VectorStorageService - Provider-agnostic persistence layer for embeddings
 * Handles saving/loading vectors to/from SQLite with Buffer serialization
 */
export class VectorStorageService {
  private db: ReturnType<typeof drizzle>;
  private sqlite: Database.Database;

  constructor(dbPath: string) {
    this.sqlite = new Database(dbPath);
    this.db = drizzle(this.sqlite);
    this.initializeSchema();
  }

  /**
   * Initialize embeddings table if it doesn't exist
   */
  private initializeSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY NOT NULL,
        node_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dim INTEGER NOT NULL,
        vector BLOB NOT NULL
      )
    `);
    
    // Create index for fast lookups
    this.sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_embeddings_node_id ON embeddings(node_id)
    `);
    this.sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model)
    `);
  }

  /**
   * Save vector embedding to database
   * @param nodeId - ID of the node (file, directory, topic)
   * @param vector - Float32Array vector (will be normalized to unit length)
   * @param model - Model name used to generate embedding
   * @returns Promise<void>
   */
  async saveEmbedding(nodeId: string, vector: Float32Array, model: string): Promise<void> {
    // Normalize vector to unit length for efficient cosine similarity
    const normalized = this.normalizeVector(vector);
    
    // Convert Float32Array to Buffer for SQLite storage
    const buffer = Buffer.from(normalized.buffer);
    
    const embedding: NewEmbedding = {
      id: nodeId, // Use nodeId as primary key by default
      nodeId,
      model,
      dim: normalized.length,
      vector: buffer
    };

    // Upsert (insert or update if exists)
    await this.db
      .insert(embeddings)
      .values(embedding)
      .onConflictDoUpdate({
        target: embeddings.id,
        set: {
          model: embedding.model,
          dim: embedding.dim,
          vector: embedding.vector
        }
      });
  }

  /**
   * Load vector embedding from database
   * @param nodeId - ID of the node
   * @returns Promise<Float32Array | null>
   */
  async loadEmbedding(nodeId: string): Promise<Float32Array | null> {
    const result = await this.db
      .select()
      .from(embeddings)
      .where(eq(embeddings.nodeId, nodeId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const embedding = result[0];
    
    // Convert Buffer back to Float32Array
    const buffer = embedding.vector;
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    return new Float32Array(arrayBuffer);
  }

  /**
   * Load all embeddings for a specific model
   * @param modelName - Filter by model name (optional)
   * @returns Promise<Array<{nodeId: string, vector: Float32Array}>>
   */
  async loadAllEmbeddings(modelName?: string): Promise<Array<{nodeId: string, vector: Float32Array}>> {
    const results = modelName 
      ? this.db.select().from(embeddings).where(eq(embeddings.model, modelName)).all()
      : this.db.select().from(embeddings).all();
    
    return results.map(embedding => {
      const buffer = embedding.vector;
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      const vector = new Float32Array(arrayBuffer);
      
      return {
        nodeId: embedding.nodeId,
        vector
      };
    });
  }

  /**
   * Check if embedding exists for a node
   * @param nodeId - ID of the node
   * @returns Promise<boolean>
   */
  async hasEmbedding(nodeId: string): Promise<boolean> {
    const result = this.db
      .select()
      .from(embeddings)
      .where(eq(embeddings.nodeId, nodeId))
      .limit(1)
      .all();
    
    return result.length > 0;
  }

  /**
   * Delete embedding for a node
   * @param nodeId - ID of the node
   * @returns Promise<void>
   */
  async deleteEmbedding(nodeId: string): Promise<void> {
    this.db
      .delete(embeddings)
      .where(eq(embeddings.nodeId, nodeId))
      .run();
  }

  /**
   * Get statistics about stored embeddings
   * @returns Promise<{total: number, models: Record<string, number>}>
   */
  async getStats(): Promise<{total: number, models: Record<string, number>}> {
    const totalResult = this.db
      .select()
      .from(embeddings)
      .all();
    
    const modelsResult = this.db
      .select({ model: embeddings.model })
      .from(embeddings)
      .all();
    
    const models: Record<string, number> = {};
    modelsResult.forEach(row => {
      models[row.model] = (models[row.model] || 0) + 1;
    });
    
    return {
      total: totalResult.length,
      models
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    this.sqlite.close();
  }

  /**
   * Normalize vector to unit length for efficient cosine similarity
   * @param vector - Input vector
   * @returns Float32Array - Normalized vector
   */
  private normalizeVector(vector: Float32Array): Float32Array {
    let magnitude = 0;
    for (let i = 0; i < vector.length; i++) {
      magnitude += vector[i] * vector[i];
    }
    magnitude = Math.sqrt(magnitude);
    
    if (magnitude === 0) {
      return vector; // Return zero vector as-is
    }
    
    const normalized = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      normalized[i] = vector[i] / magnitude;
    }
    
    return normalized;
  }
}
