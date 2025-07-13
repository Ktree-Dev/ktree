import { VectorStorageService } from "./storage";
import { cosineSimilarity, topKSimilar } from "./similarity";

/**
 * SQLiteBruteIndex
 * -----------------
 * Brute-force cosine K-NN search operating entirely in memory.
 * Designed for ≤10 000 vectors → p95 latency <150 ms on modern laptops.
 */
export class SQLiteBruteIndex {
  private corpus: Array<{ id: string; vector: Float32Array }> = [];

  constructor(private storage: VectorStorageService) {}

  /**
   * Build in-memory corpus snapshot from database.
   * Call after pipeline run or when vectors change.
   */
  async load(model?: string): Promise<void> {
    const embeddings = await this.storage.loadAllEmbeddings(model);
    this.corpus = embeddings.map(({ nodeId, vector }) => ({ id: nodeId, vector }));
  }

  /**
   * Return top-K most similar vectors to the query embedding.
   */
  query(
    queryVec: Float32Array,
    k = 10
  ): Array<{ id: string; score: number }> {
    if (this.corpus.length === 0) {
      throw new Error("SQLiteBruteIndex: corpus not loaded");
    }
    return topKSimilar(queryVec, this.corpus, k);
  }

  /**
   * Ad-hoc similarity between two stored nodes.
   */
  async similarityBetween(aId: string, bId: string): Promise<number | null> {
    const a = await this.storage.loadEmbedding(aId);
    const b = await this.storage.loadEmbedding(bId);
    if (!a || !b) return null;
    return cosineSimilarity(a, b);
  }
}
