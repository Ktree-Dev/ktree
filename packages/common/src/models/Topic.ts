import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Topic model for the functional ontology tree structure.
 * Each topic node represents a functional domain or subdomain in the codebase.
 */
export const topics = sqliteTable("topics", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  parentId: text("parent_id"), // null for root domains
  depth: integer("depth").notNull().default(0),
  isRoot: integer("is_root", { mode: "boolean" }).notNull().default(false),
});

/**
 * Junction table for many-to-many relationship between topics and files/directories
 */
export const topicNodeLinks = sqliteTable("topic_node_links", {
  id: text("id").primaryKey(),
  topicId: text("topic_id").notNull(),
  nodeId: text("node_id").notNull(), // file or directory ID
  nodeType: text("node_type").notNull(), // "file" or "directory"
  confidence: integer("confidence").notNull().default(100), // 0-100 score
});

/**
 * TypeScript types for topic records
 */
export type Topic = typeof topics.$inferSelect;
export type NewTopic = typeof topics.$inferInsert;

export type TopicNodeLink = typeof topicNodeLinks.$inferSelect;
export type NewTopicNodeLink = typeof topicNodeLinks.$inferInsert;

/**
 * In-memory ontology tree node structure used during ontology building
 */
export interface TopicTreeNode {
  id: string;
  title: string;
  description: string;
  parentId: string | null;
  depth: number;
  isRoot: boolean;
  children: TopicTreeNode[];
  nodeIds: string[]; // file/directory IDs that belong to this topic
}

/**
 * Domain discovery result from LLM
 */
export interface DomainDiscoveryResult {
  rootDomain: {
    title: string;
    description: string;
  };
  topLevelDomains: {
    title: string;
    description: string;
  }[];
}

/**
 * Subtopic grouping result from LLM
 */
export interface SubtopicGroupingResult {
  subtopics: {
    title: string;
    description: string;
    nodeIds: string[];
  }[];
}
