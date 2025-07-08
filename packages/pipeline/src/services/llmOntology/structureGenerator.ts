import { EmbeddingGateway, type EmbeddingResult } from "../mcp/EmbeddingGateway";
import { type DomainDiscoveryResult, type SubtopicGroupingResult } from "@ktree/common/src/models/Topic";

/**
 * Structure generator for ontology clustering
 * Implements FR-ONT-06/07/08 - candidate retrieval and LLM-guided subtopic creation
 */

interface FileWithEmbedding {
  id: string;
  path: string;
  title: string;
  summary: string;
  embedding: number[];
}

interface DomainCluster {
  domain: { title: string; description: string };
  candidates: FileWithEmbedding[];
  similarity_threshold: number;
}

/**
 * Generate embeddings for all files and cluster them by domain
 */
export async function generateStructureForDomains(
  files: Array<{ id: string; path: string; title: string; summary: string }>,
  domains: DomainDiscoveryResult
): Promise<DomainCluster[]> {
  const embeddingGateway = new EmbeddingGateway();
  
  console.log(`   Generating embeddings for ${files.length} files...`);
  
  // Generate embeddings for all files
  const filesWithEmbeddings = await generateFileEmbeddings(files, embeddingGateway);
  
  console.log(`   Clustering files by ${domains.topLevelDomains.length} domains...`);
  
  // Create domain embeddings
  const domainEmbeddings = await generateDomainEmbeddings(domains.topLevelDomains, embeddingGateway);
  
  // Cluster files by domain using semantic similarity
  const clusters: DomainCluster[] = [];
  
  for (let i = 0; i < domains.topLevelDomains.length; i++) {
    const domain = domains.topLevelDomains[i];
    const domainEmbedding = domainEmbeddings[i];
    
    // Find files similar to this domain
    const candidates = findSimilarFiles(
      filesWithEmbeddings,
      domainEmbedding,
      0.3 // Similarity threshold - can be tuned
    );
    
    clusters.push({
      domain,
      candidates,
      similarity_threshold: 0.3
    });
  }
  
  // Handle unassigned files (assign to best matching domain or create misc)
  const assignedFileIds = new Set(clusters.flatMap(c => c.candidates.map(f => f.id)));
  const unassignedFiles = filesWithEmbeddings.filter(f => !assignedFileIds.has(f.id));
  
  if (unassignedFiles.length > 0) {
    console.log(`   Assigning ${unassignedFiles.length} unassigned files...`);
    assignUnassignedFiles(unassignedFiles, clusters, domainEmbeddings);
  }
  
  // Log cluster statistics
  for (const cluster of clusters) {
    console.log(`   ${cluster.domain.title}: ${cluster.candidates.length} files`);
  }
  
  return clusters;
}

/**
 * Generate embeddings for all files
 */
async function generateFileEmbeddings(
  files: Array<{ id: string; path: string; title: string; summary: string }>,
  embeddingGateway: EmbeddingGateway
): Promise<FileWithEmbedding[]> {
  const filesWithEmbeddings: FileWithEmbedding[] = [];
  
  // Process in batches for better performance
  const batchSize = 10;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    
    const embeddings = await Promise.all(
      batch.map(async (file) => {
        // Create composite text for embedding: title + summary for better semantic understanding
        const text = `${file.title}: ${file.summary}`;
        const result = await embeddingGateway.generateEmbedding(text);
        return result;
      })
    );
    
    for (let j = 0; j < batch.length; j++) {
      const file = batch[j];
      const embedding = embeddings[j];
      
      filesWithEmbeddings.push({
        ...file,
        embedding: embedding.vector,
      });
    }
    
    // Progress update
    if ((i + batchSize) % 50 === 0) {
      console.log(`     Embedded ${Math.min(i + batchSize, files.length)}/${files.length} files`);
    }
  }
  
  return filesWithEmbeddings;
}

/**
 * Generate embeddings for domain descriptions
 */
async function generateDomainEmbeddings(
  domains: Array<{ title: string; description: string }>,
  embeddingGateway: EmbeddingGateway
): Promise<number[][]> {
  const domainEmbeddings: number[][] = [];
  
  for (const domain of domains) {
    // Use title + description for domain embedding
    const text = `${domain.title}: ${domain.description}`;
    const result = await embeddingGateway.generateEmbedding(text);
    domainEmbeddings.push(result.vector);
  }
  
  return domainEmbeddings;
}

/**
 * Find files similar to a domain embedding using cosine similarity
 */
function findSimilarFiles(
  files: FileWithEmbedding[],
  domainEmbedding: number[],
  threshold: number
): FileWithEmbedding[] {
  const similarities = files.map(file => ({
    file,
    similarity: cosineSimilarity(file.embedding, domainEmbedding)
  }));
  
  // Filter by threshold and sort by similarity (descending)
  return similarities
    .filter(({ similarity }) => similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .map(({ file }) => file);
}

/**
 * Assign unassigned files to their best matching domain
 */
function assignUnassignedFiles(
  unassignedFiles: FileWithEmbedding[],
  clusters: DomainCluster[],
  domainEmbeddings: number[][]
): void {
  for (const file of unassignedFiles) {
    let bestClusterIndex = 0;
    let bestSimilarity = -1;
    
    // Find the domain with highest similarity to this file
    for (let i = 0; i < domainEmbeddings.length; i++) {
      const similarity = cosineSimilarity(file.embedding, domainEmbeddings[i]);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestClusterIndex = i;
      }
    }
    
    // Assign to best matching cluster (even if below threshold)
    clusters[bestClusterIndex].candidates.push(file);
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) {
    return 0; // Handle zero vectors
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Calculate distance metrics for cluster analysis
 */
export function analyzeClusterQuality(clusters: DomainCluster[]): {
  avgIntraClusterSimilarity: number;
  coveragePercentage: number;
  clusterSizes: number[];
} {
  const clusterSizes = clusters.map(c => c.candidates.length);
  const totalFiles = clusterSizes.reduce((sum, size) => sum + size, 0);
  
  // Calculate average intra-cluster similarity
  let totalSimilarity = 0;
  let totalPairs = 0;
  
  for (const cluster of clusters) {
    if (cluster.candidates.length < 2) continue;
    
    const candidates = cluster.candidates;
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        totalSimilarity += cosineSimilarity(
          candidates[i].embedding,
          candidates[j].embedding
        );
        totalPairs++;
      }
    }
  }
  
  const avgIntraClusterSimilarity = totalPairs > 0 ? totalSimilarity / totalPairs : 0;
  
  return {
    avgIntraClusterSimilarity,
    coveragePercentage: 100, // Since we assign all files
    clusterSizes,
  };
}
