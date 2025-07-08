import { getApiKey, getModel } from "@ktree/common";

/**
 * Embedding provider types supported by EmbeddingGateway
 */
export type EmbeddingProvider = "openai" | "cohere" | "gemini";

/**
 * Embedding result with vector and metadata
 */
export interface EmbeddingResult {
  text: string;
  vector: number[];
  dimensions: number;
  model: string;
}

/**
 * Batch embedding request
 */
export interface BatchEmbeddingRequest {
  texts: string[];
  batchSize?: number;
}

/**
 * EmbeddingGateway provides unified interface for generating embeddings
 * across multiple providers with batching and caching support
 */
export class EmbeddingGateway {
  private provider: EmbeddingProvider;
  private model: string;
  private cache: Map<string, number[]> = new Map();

  constructor() {
    const embeddingModel = getModel("embedder");
    this.provider = embeddingModel.split("/")[0] as EmbeddingProvider;
    this.model = embeddingModel.replace(`${this.provider}/`, "");
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    // Check cache first
    const cacheKey = `${this.model}:${this.hashText(text)}`;
    if (this.cache.has(cacheKey)) {
      return {
        text,
        vector: this.cache.get(cacheKey)!,
        dimensions: this.cache.get(cacheKey)!.length,
        model: this.model,
      };
    }

    const result = await this.callEmbeddingAPI(text);
    
    // Cache the result
    this.cache.set(cacheKey, result.vector);
    
    return result;
  }

  /**
   * Generate embeddings for multiple texts in batches
   */
  async generateBatchEmbeddings(request: BatchEmbeddingRequest): Promise<EmbeddingResult[]> {
    const { texts, batchSize = 100 } = request;
    const results: EmbeddingResult[] = [];

    // Process in batches to avoid API limits
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(text => this.generateEmbedding(text))
      );
      results.push(...batchResults);

      // Add small delay between batches to respect rate limits
      if (i + batchSize < texts.length) {
        await this.delay(100);
      }
    }

    return results;
  }

  /**
   * Call the appropriate embedding API based on provider
   */
  private async callEmbeddingAPI(text: string): Promise<EmbeddingResult> {
    switch (this.provider) {
      case "openai":
        return this.callOpenAIEmbedding(text);
      case "cohere":
        return this.callCohereEmbedding(text);
      case "gemini":
        return this.callGoogleEmbedding(text);
      default:
        throw new Error(`Unsupported embedding provider: ${this.provider}`);
    }
  }

  /**
   * OpenAI embedding API
   */
  private async callOpenAIEmbedding(text: string): Promise<EmbeddingResult> {
    const apiKey = getApiKey("openai");
    
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        encoding_format: "float",
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding API error: ${response.statusText}`);
    }

    const data = await response.json();
    const vector = data.data[0].embedding;

    return {
      text,
      vector,
      dimensions: vector.length,
      model: this.model,
    };
  }

  /**
   * Cohere embedding API
   */
  private async callCohereEmbedding(text: string): Promise<EmbeddingResult> {
    const apiKey = getApiKey("cohere");
    
    const response = await fetch("https://api.cohere.ai/v1/embed", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        texts: [text],
        input_type: "search_document",
      }),
    });

    if (!response.ok) {
      throw new Error(`Cohere embedding API error: ${response.statusText}`);
    }

    const data = await response.json();
    const vector = data.embeddings[0];

    return {
      text,
      vector,
      dimensions: vector.length,
      model: this.model,
    };
  }

  /**
   * Google embedding API (Gemini)
   */
  private async callGoogleEmbedding(text: string): Promise<EmbeddingResult> {
    const apiKey = getApiKey("gemini");
    
    // Ensure we're using a valid embedding model name
    const modelName = this.model.includes("embedding") ? this.model : "text-embedding-004";
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:embedContent?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: {
          parts: [{ text }]
        },
        taskType: "SEMANTIC_SIMILARITY"
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google embedding API error: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    
    // Handle the response structure correctly
    if (!data.embedding || !data.embedding.values) {
      throw new Error(`Invalid response format from Google embedding API: ${JSON.stringify(data)}`);
    }
    
    const vector = data.embedding.values;

    return {
      text,
      vector,
      dimensions: vector.length,
      model: modelName,
    };
  }

  /**
   * Simple text hash for caching
   */
  private hashText(text: string): string {
    let hash = 0;
    if (text.length === 0) return hash.toString();
    
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return Math.abs(hash).toString();
  }

  /**
   * Simple delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear the embedding cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate?: number } {
    return {
      size: this.cache.size,
      // Note: hit rate tracking would need additional implementation
    };
  }
}
