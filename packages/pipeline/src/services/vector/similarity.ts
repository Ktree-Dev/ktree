/**
 * similarity.ts
 * -------------
 * Low-level vector utilities for Ktree.
 *
 * Vectors are assumed to be Float32Array and already unit-normalized
 * (‖v‖₂ = 1).  The cosine similarity therefore simplifies to the dot
 * product.  Returned similarity range = [-1, 1].
 */

/**
 * Compute cosine similarity (dot product) of two unit-length vectors.
 * When vectors are pre-normalised this is extremely fast: O(d).
 */
export function cosineSimilarity(
  a: Float32Array,
  b: Float32Array
): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch – got ${a.length} vs ${b.length}`
    );
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum; // because both vectors are unit length
}

/**
 * Compute 1 ‑ cosine similarity (“distance”), convenient for sorting
 * ascending (smaller = closer).
 */
export function cosineDistance(
  a: Float32Array,
  b: Float32Array
): number {
  return 1 - cosineSimilarity(a, b);
}

/**
 * Brute-force top-K nearest neighbours in memory.
 * Assumes the vectors are unit-normalised.
 */
export function topKSimilar(
  query: Float32Array,
  corpus: Array<{ id: string; vector: Float32Array }>,
  k = 10
): Array<{ id: string; score: number }> {
  // Compute similarity for every vector
  const scored = corpus.map(({ id, vector }) => ({
    id,
    score: cosineSimilarity(query, vector)
  }));

  // Partial sort – keep top-k only
  scored.sort((a, b) => b.score - a.score); // descending
  return scored.slice(0, k);
}
