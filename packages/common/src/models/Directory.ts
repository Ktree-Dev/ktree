import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Directory model for the physical repository tree structure.
 * Each directory node represents a folder in the repository.
 */
export const directories = sqliteTable("directories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  parentId: text("parent_id"),
  summary: text("summary").notNull().default(""),
  loc: integer("loc").notNull().default(0),
  fileCount: integer("file_count").notNull().default(0),
});

/**
 * TypeScript type for directory records
 */
export type Directory = typeof directories.$inferSelect;
export type NewDirectory = typeof directories.$inferInsert;

/**
 * In-memory tree node structure used during tree building
 */
export interface DirectoryTreeNode {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  summary: string;
  loc: number;
  fileCount: number;
  children: DirectoryTreeNode[];
  files: string[]; // file IDs that belong to this directory
}
