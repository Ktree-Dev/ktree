import { sqliteTable, text, blob, integer } from "drizzle-orm/sqlite-core";

/**
 * embeddings
 * ----------
 * Persisted vector embeddings for knowledge-tree nodes (files, directories, topics…).
 *
 * id        – primary key (UUID or same as nodeId)
 * nodeId    – FK/id of the associated node (fileId, dirId, topicId)
 * model     – embedding model name (e.g. "text-embedding-004")
 * dim       – dimensionality of vector
 * vector    – raw Float32Array stored as BLOB (unit-norm)
 */
export const embeddings = sqliteTable("embeddings", {
  id: text("id").primaryKey().notNull(), // identical to nodeId by default
  nodeId: text("node_id").notNull(),
  model: text("model").notNull(),
  dim: integer("dim").notNull(),
  vector: blob("vector", { mode: "buffer" }).notNull(), // Buffer storing Float32Array
});

export type Embedding = typeof embeddings.$inferSelect;
export type NewEmbedding = typeof embeddings.$inferInsert;
