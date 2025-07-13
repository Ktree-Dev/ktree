import { Client } from "pg";

/**
 * PostgresPgVectorIndex
 * ---------------------
 * Uses pgvector extension with HNSW index for fast K-NN queries.
 * Fallback to ivfflat if HNSW not available.
 * 
 * Requirements:
 * - PostgreSQL 12+ with pgvector extension installed
 * - CREATE EXTENSION vector;
 */
export class PostgresPgVectorIndex {
  private client: Client;
  private tableName: string;

  constructor(connectionString: string, tableName = "embeddings") {
    this.client = new Client({ connectionString });
    this.tableName = tableName;
  }

  /**
   * Initialize connection and ensure pgvector extension + table exists
   */
  async initialize(): Promise<void> {
    await this.client.connect();
    
    // Enable pgvector extension
    await this.client.query("CREATE EXTENSION IF NOT EXISTS vector");
    
    // Create embeddings table with vector column
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dim INTEGER NOT NULL,
        vector vector NOT NULL
      )
    `);
    
    // Create indexes for fast queries
    await this.client.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_node_id 
      ON ${this.tableName}(node_id)
    `);
    
    await this.client.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_model 
      ON ${this.tableName}(model)
    `);
    
    // Try to create HNSW index, fallback to ivfflat if not supported
    try {
      await this.client.query(`
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_vector_hnsw 
        ON ${this.tableName} 
        USING hnsw (vector vector_cosine_ops) 
        WITH (m = 16, ef_construction = 64)
      `);
    } catch (error) {
      console.warn("HNSW index creation failed, falling back to ivfflat:", error);
      
      // Fallback to ivfflat index
      await this.client.query(`
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_vector_ivfflat 
        ON ${this.tableName} 
        USING ivfflat (vector vector_cosine_ops) 
        WITH (lists = 100)
      `);
    }
  }

  /**
   * Save vector embedding to PostgreSQL
   */
  async saveEmbedding(nodeId: string, vector: Float32Array, model: string): Promise<void> {
    const vectorString = `[${Array.from(vector).join(",")}]`;
    
    await this.client.query(`
      INSERT INTO ${this.tableName} (id, node_id, model, dim, vector) 
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET
        model = EXCLUDED.model,
        dim = EXCLUDED.dim,
        vector = EXCLUDED.vector
    `, [nodeId, nodeId, model, vector.length, vectorString]);
  }

  /**
   * Load vector embedding from PostgreSQL
   */
  async loadEmbedding(nodeId: string): Promise<Float32Array | null> {
    const result = await this.client.query(`
      SELECT vector FROM ${this.tableName} WHERE node_id = $1 LIMIT 1
    `, [nodeId]);

    if (result.rows.length === 0) {
      return null;
    }

    // pgvector returns vectors as arrays
    const vectorArray = result.rows[0].vector;
    return new Float32Array(vectorArray);
  }

  /**
   * Find top-K most similar vectors using pgvector cosine similarity
   */
  async query(
    queryVec: Float32Array,
    k = 10,
    model?: string
  ): Promise<Array<{ id: string; score: number }>> {
    const vectorString = `[${Array.from(queryVec).join(",")}]`;
    
    let query = `
      SELECT 
        node_id as id,
        1 - (vector <=> $1::vector) as score
      FROM ${this.tableName}
    `;
    
    const params: any[] = [vectorString];
    
    if (model) {
      query += ` WHERE model = $2`;
      params.push(model);
    }
    
    query += `
      ORDER BY vector <=> $1::vector
      LIMIT $${params.length + 1}
    `;
    params.push(k);

    const result = await this.client.query(query, params);
    
    return result.rows.map(row => ({
      id: row.id,
      score: parseFloat(row.score)
    }));
  }

  /**
   * Get similarity between two stored embeddings
   */
  async similarityBetween(aId: string, bId: string): Promise<number | null> {
    const result = await this.client.query(`
      SELECT 
        1 - (a.vector <=> b.vector) as similarity
      FROM ${this.tableName} a, ${this.tableName} b
      WHERE a.node_id = $1 AND b.node_id = $2
    `, [aId, bId]);

    if (result.rows.length === 0) {
      return null;
    }

    return parseFloat(result.rows[0].similarity);
  }

  /**
   * Load all embeddings (for building indices or analysis)
   */
  async loadAllEmbeddings(model?: string): Promise<Array<{nodeId: string, vector: Float32Array}>> {
    let query = `SELECT node_id, vector FROM ${this.tableName}`;
    const params: any[] = [];
    
    if (model) {
      query += ` WHERE model = $1`;
      params.push(model);
    }
    
    const result = await this.client.query(query, params);
    
    return result.rows.map(row => ({
      nodeId: row.node_id,
      vector: new Float32Array(row.vector)
    }));
  }

  /**
   * Check if embedding exists
   */
  async hasEmbedding(nodeId: string): Promise<boolean> {
    const result = await this.client.query(`
      SELECT 1 FROM ${this.tableName} WHERE node_id = $1 LIMIT 1
    `, [nodeId]);
    
    return result.rows.length > 0;
  }

  /**
   * Delete embedding
   */
  async deleteEmbedding(nodeId: string): Promise<void> {
    await this.client.query(`
      DELETE FROM ${this.tableName} WHERE node_id = $1
    `, [nodeId]);
  }

  /**
   * Get statistics about stored embeddings
   */
  async getStats(): Promise<{total: number, models: Record<string, number>}> {
    const totalResult = await this.client.query(`
      SELECT COUNT(*) as count FROM ${this.tableName}
    `);
    
    const modelsResult = await this.client.query(`
      SELECT model, COUNT(*) as count 
      FROM ${this.tableName} 
      GROUP BY model
    `);
    
    const models: Record<string, number> = {};
    modelsResult.rows.forEach(row => {
      models[row.model] = parseInt(row.count);
    });
    
    return {
      total: parseInt(totalResult.rows[0].count),
      models
    };
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.client.end();
  }
}
