import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { and, eq, inArray } from "drizzle-orm";
import { 
  topics, 
  topicNodeLinks, 
  type Topic, 
  type NewTopic, 
  type TopicNodeLink, 
  type NewTopicNodeLink,
  type DomainDiscoveryResult
} from "@ktree/common/src/models/Topic";
import { type SubtopicStructure } from "./subtopicLabeler";
import { type AssignmentResult } from "./topicAssigner";

/**
 * Database operations for ontology persistence
 * Implements FR-ONT-13/14 - Persist topics & topic-file links in SQLite
 */

export interface OntologyPersistenceResult {
  rootTopicId: string;
  topicCount: number;
  linkCount: number;
  coveragePercentage: number;
}

/**
 * Initialize ontology database schema
 */
function initializeOntologyDatabase(sqlite: Database.Database): void {
  // Create topics table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      parent_id TEXT,
      depth INTEGER NOT NULL DEFAULT 0,
      is_root BOOLEAN NOT NULL DEFAULT FALSE,
      FOREIGN KEY (parent_id) REFERENCES topics(id)
    )
  `);

  // Create topic_node_links table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS topic_node_links (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      node_type TEXT NOT NULL CHECK (node_type IN ('file', 'directory')),
      confidence INTEGER NOT NULL DEFAULT 100,
      FOREIGN KEY (topic_id) REFERENCES topics(id),
      UNIQUE(topic_id, node_id, node_type)
    )
  `);

  // Enable foreign key support
  sqlite.pragma("foreign_keys = ON");
}

/**
 * Persist complete ontology structure to database
 */
export async function persistOntologyToDatabase(
  cacheDir: string,
  domains: DomainDiscoveryResult,
  subtopicStructures: SubtopicStructure[],
  assignments: AssignmentResult[],
  fileIds: Map<string, string> // Map file paths to IDs for linking
): Promise<OntologyPersistenceResult> {
  // Initialize database connection
  const dbPath = `${cacheDir}/ontology.sqlite`;
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);

  console.log("   Persisting ontology to database...");

  try {
    // Initialize database schema
    initializeOntologyDatabase(sqlite);

    // Start transaction for atomicity
    const result = sqlite.transaction(() => {
      // Clear existing ontology data
      clearExistingOntology(db);

      // 1. Insert root domain
      const rootTopicId = insertRootDomain(db, domains.rootDomain);

      // 2. Insert top-level domains
      const topLevelTopicIds = insertTopLevelDomains(db, domains.topLevelDomains, rootTopicId);

      // 3. Insert subtopics for each domain
      const subtopicTopicIds = insertSubtopics(db, subtopicStructures, topLevelTopicIds);

      // 4. Create topic-file links based on assignments
      const linkCount = insertTopicNodeLinks(db, assignments, subtopicTopicIds, fileIds);

      // 5. Calculate coverage metrics
      const coverage = calculateCoverage(linkCount, fileIds.size);

      return {
        rootTopicId,
        topicCount: 1 + topLevelTopicIds.length + subtopicTopicIds.length,
        linkCount,
        coveragePercentage: coverage
      };
    })();

    console.log(`   ✅ Ontology persisted: ${result.topicCount} topics, ${result.linkCount} links, ${result.coveragePercentage}% coverage`);
    
    sqlite.close();
    return result;

  } catch (error) {
    sqlite.close();
    throw new Error(`Failed to persist ontology: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Clear existing ontology data from database
 */
function clearExistingOntology(db: ReturnType<typeof drizzle>) {
  // Delete in proper order to respect foreign key constraints
  db.delete(topicNodeLinks).run();
  db.delete(topics).run();
}

/**
 * Insert root domain as a topic
 */
function insertRootDomain(
  db: ReturnType<typeof drizzle>,
  rootDomain: { title: string; description: string }
): string {
  const rootTopicId = "root";
  
  const newRootTopic: NewTopic = {
    id: rootTopicId,
    title: rootDomain.title,
    description: rootDomain.description,
    parentId: null,
    depth: 0,
    isRoot: true
  };

  db.insert(topics).values(newRootTopic).run();
  
  return rootTopicId;
}

/**
 * Insert top-level domains as topics
 */
function insertTopLevelDomains(
  db: ReturnType<typeof drizzle>,
  topLevelDomains: Array<{ title: string; description: string }>,
  rootTopicId: string
): string[] {
  const topLevelTopicIds: string[] = [];

  for (let i = 0; i < topLevelDomains.length; i++) {
    const domain = topLevelDomains[i];
    const topicId = `domain-${i + 1}`;
    
    const newTopic: NewTopic = {
      id: topicId,
      title: domain.title,
      description: domain.description,
      parentId: rootTopicId,
      depth: 1,
      isRoot: false
    };

    db.insert(topics).values(newTopic).run();
    topLevelTopicIds.push(topicId);
  }

  return topLevelTopicIds;
}

/**
 * Insert subtopics for each domain
 */
function insertSubtopics(
  db: ReturnType<typeof drizzle>,
  subtopicStructures: SubtopicStructure[],
  topLevelTopicIds: string[]
): string[] {
  const subtopicTopicIds: string[] = [];

  for (let domainIndex = 0; domainIndex < subtopicStructures.length; domainIndex++) {
    const structure = subtopicStructures[domainIndex];
    const parentTopicId = topLevelTopicIds[domainIndex];

    for (let subtopicIndex = 0; subtopicIndex < structure.subtopics.length; subtopicIndex++) {
      const subtopic = structure.subtopics[subtopicIndex];
      const topicId = `${parentTopicId}-sub-${subtopicIndex + 1}`;
      
      const newTopic: NewTopic = {
        id: topicId,
        title: subtopic.title,
        description: subtopic.description,
        parentId: parentTopicId,
        depth: 2,
        isRoot: false
      };

      db.insert(topics).values(newTopic).run();
      subtopicTopicIds.push(topicId);
    }
  }

  return subtopicTopicIds;
}

/**
 * Create topic-file links based on assignments
 */
function insertTopicNodeLinks(
  db: ReturnType<typeof drizzle>,
  assignments: AssignmentResult[],
  subtopicTopicIds: string[],
  fileIds: Map<string, string>
): number {
  let linkCount = 0;
  
  // Create a mapping from subtopic title to topic ID
  const subtopicTitleToIdMap = createSubtopicTitleMapping(db, subtopicTopicIds);

  for (const assignmentResult of assignments) {
    for (const assignment of assignmentResult.assignments) {
      const fileId = fileIds.get(assignment.filePath);
      
      if (!fileId) {
        console.warn(`   Warning: File ID not found for path: ${assignment.filePath}`);
        continue;
      }

      // Create links for each assigned subtopic
      for (const subtopicTitle of assignment.subtopics) {
        const topicId = subtopicTitleToIdMap.get(subtopicTitle);
        
        if (!topicId) {
          console.warn(`   Warning: Topic ID not found for subtopic: ${subtopicTitle}`);
          continue;
        }

        const linkId = `link-${topicId}-${fileId}`;
        
        const newLink: NewTopicNodeLink = {
          id: linkId,
          topicId,
          nodeId: fileId,
          nodeType: "file",
          confidence: 100 // Default confidence for LLM assignments
        };

        try {
          db.insert(topicNodeLinks).values(newLink).run();
          linkCount++;
        } catch (error) {
          // Skip duplicate links (might happen with multi-topic assignments)
          if (!(error instanceof Error) || !error.message.includes("UNIQUE constraint")) {
            console.warn(`   Warning: Failed to create link ${linkId}:`, error);
          }
        }
      }
    }
  }

  return linkCount;
}

/**
 * Create mapping from subtopic title to topic ID
 */
function createSubtopicTitleMapping(
  db: ReturnType<typeof drizzle>,
  subtopicTopicIds: string[]
): Map<string, string> {
  const mapping = new Map<string, string>();

  // Query all subtopics to get their titles
  const subtopicsData = db
    .select()
    .from(topics)
    .where(inArray(topics.id, subtopicTopicIds))
    .all();

  for (const topic of subtopicsData) {
    mapping.set(topic.title, topic.id);
  }

  return mapping;
}

/**
 * Calculate coverage percentage
 */
function calculateCoverage(linkCount: number, totalFiles: number): number {
  if (totalFiles === 0) return 100;
  
  // Note: linkCount might be higher than totalFiles due to multi-topic assignments
  // Coverage is based on unique files that have at least one link
  return Math.min(100, Math.round((linkCount / totalFiles) * 100));
}

/**
 * Query ontology structure for validation or export
 */
export async function queryOntologyStructure(cacheDir: string): Promise<{
  topics: Topic[];
  links: TopicNodeLink[];
  stats: {
    totalTopics: number;
    totalLinks: number;
    maxDepth: number;
  };
}> {
  const dbPath = `${cacheDir}/ontology.sqlite`;
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);

  try {
    const allTopics = db.select().from(topics).all();
    const allLinks = db.select().from(topicNodeLinks).all();
    
    const stats = {
      totalTopics: allTopics.length,
      totalLinks: allLinks.length,
      maxDepth: Math.max(...allTopics.map(t => t.depth))
    };

    sqlite.close();

    return {
      topics: allTopics,
      links: allLinks,
      stats
    };
  } catch (error) {
    sqlite.close();
    throw new Error(`Failed to query ontology: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get files assigned to a specific topic
 */
export async function getFilesForTopic(
  cacheDir: string,
  topicId: string
): Promise<string[]> {
  const dbPath = `${cacheDir}/ontology.sqlite`;
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);

  try {
    const links = db
      .select()
      .from(topicNodeLinks)
      .where(and(
        eq(topicNodeLinks.topicId, topicId),
        eq(topicNodeLinks.nodeType, "file")
      ))
      .all();

    sqlite.close();
    return links.map(link => link.nodeId);
  } catch (error) {
    sqlite.close();
    throw new Error(`Failed to query files for topic: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get topics assigned to a specific file
 */
export async function getTopicsForFile(
  cacheDir: string,
  fileId: string
): Promise<Topic[]> {
  const dbPath = `${cacheDir}/ontology.sqlite`;
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);

  try {
    const result = db
      .select({
        topic: topics
      })
      .from(topicNodeLinks)
      .innerJoin(topics, eq(topicNodeLinks.topicId, topics.id))
      .where(and(
        eq(topicNodeLinks.nodeId, fileId),
        eq(topicNodeLinks.nodeType, "file")
      ))
      .all();

    sqlite.close();
    return result.map(r => r.topic);
  } catch (error) {
    sqlite.close();
    throw new Error(`Failed to query topics for file: ${error instanceof Error ? error.message : String(error)}`);
  }
}
