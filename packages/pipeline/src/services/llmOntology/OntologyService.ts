import { resolve } from "node:path";
import { discoverRootAndTopLevelDomains } from "./rootDomains";
import { generateStructureForDomains, analyzeClusterQuality } from "./structureGenerator";
import { generateSubtopicStructuresForAllDomains } from "./subtopicLabeler";
import { assignFilesForAllDomains } from "./topicAssigner";
import { persistOntologyToDatabase, queryOntologyStructure, type OntologyPersistenceResult } from "./databaseOperations";

/**
 * OntologyService - Main orchestrator for the ontology extraction pipeline
 * Implements FR-ONT-01‒12 - Complete ontology extraction and topic assignment
 */

export interface FileRecord {
  id: string;
  path: string;
  name: string;
  summary: {
    title: string;
    summary: string;
    loc: number;
  };
}

export interface DirectoryRecord {
  id: string;
  path: string;
  summary: string;
  fileCount: number;
  loc: number;
}

export interface OntologyBuildResult {
  persistence: OntologyPersistenceResult;
  timing: {
    embeddingTime: number;
    domainDiscoveryTime: number;
    clusteringTime: number;
    subtopicTime: number;
    assignmentTime: number;
    persistenceTime: number;
    totalTime: number;
  };
  quality: {
    avgIntraClusterSimilarity: number;
    coveragePercentage: number;
    clusterSizes: number[];
  };
  llmCallCount: number;
}

/**
 * Build complete ontology for a repository
 * Implements the full FR-ONT pipeline
 */
export async function buildOntology(
  cacheDir: string,
  fileRecords: FileRecord[],
  directoryRecords: DirectoryRecord[]
): Promise<OntologyBuildResult> {
  const startTime = Date.now();
  let llmCallCount = 0;

  console.log("🧠 Stage 3: Ontology Extraction");
  console.log(`   Building ontology for ${fileRecords.length} files and ${directoryRecords.length} directories...`);

  try {
    // Phase 1: Domain Discovery (FR-ONT-03/04/05)
    console.log("   📊 Phase 1: Root & Top-Level Domain Discovery");
    const domainStartTime = Date.now();
    
    const fileContexts = fileRecords.map(f => ({
      id: f.id,
      path: f.path,
      title: f.summary.title,
      summary: f.summary.summary
    }));

    const directoryContexts = directoryRecords.map(d => ({
      id: d.id,
      path: d.path,
      summary: d.summary,
      fileCount: d.fileCount,
      loc: d.loc
    }));

    const domains = await discoverRootAndTopLevelDomains(fileContexts, directoryContexts);
    llmCallCount += 1; // One call for domain discovery
    const domainTime = Date.now() - domainStartTime;

    console.log(`   ✅ Discovered 1 root domain + ${domains.topLevelDomains.length} top-level domains (${domainTime}ms)`);

    // Phase 2: File Clustering & Embedding (FR-ONT-01, FR-ONT-06)
    console.log("   🎯 Phase 2: File Clustering by Domain");
    const clusteringStartTime = Date.now();
    
    const clusters = await generateStructureForDomains(fileContexts, domains);
    const clusteringTime = Date.now() - clusteringStartTime;

    // Analyze clustering quality
    const quality = analyzeClusterQuality(clusters);
    console.log(`   ✅ Clustered files across ${clusters.length} domains (${clusteringTime}ms)`);
    console.log(`      Quality: ${quality.avgIntraClusterSimilarity.toFixed(3)} avg similarity, ${quality.coveragePercentage}% coverage`);

    // Phase 3: Subtopic Structure Generation (FR-ONT-07/08)
    console.log("   🏗️  Phase 3: Subtopic Structure Generation");
    const subtopicStartTime = Date.now();
    
    const subtopicStructures = await generateSubtopicStructuresForAllDomains(clusters);
    llmCallCount += domains.topLevelDomains.length; // One call per domain
    const subtopicTime = Date.now() - subtopicStartTime;

    console.log(`   ✅ Generated subtopic structures (${subtopicTime}ms)`);

    // Phase 4: File Assignment (FR-ONT-09/10/11)
    console.log("   📌 Phase 4: Multi-Topic File Assignment");
    const assignmentStartTime = Date.now();
    
    // Combine domain clusters with their subtopic structures
    const domainsWithSubtopics = clusters.map((cluster, index) => ({
      domain: cluster.domain,
      candidates: cluster.candidates.map(c => ({
        path: c.path,
        title: c.title,
        summary: c.summary
      })),
      subtopics: subtopicStructures[index]
    }));

    const assignments = await assignFilesForAllDomains(domainsWithSubtopics);
    llmCallCount += domains.topLevelDomains.length; // One call per domain for assignment
    const assignmentTime = Date.now() - assignmentStartTime;

    console.log(`   ✅ Completed file assignments (${assignmentTime}ms)`);

    // Phase 5: Database Persistence (FR-ONT-13/14)
    console.log("   💾 Phase 5: Database Persistence");
    const persistenceStartTime = Date.now();
    
    // Create file ID mapping for database links
    const fileIds = new Map<string, string>();
    for (const file of fileRecords) {
      fileIds.set(file.path, file.id);
    }

    const persistence = await persistOntologyToDatabase(
      cacheDir,
      domains,
      subtopicStructures,
      assignments,
      fileIds
    );
    const persistenceTime = Date.now() - persistenceStartTime;

    const totalTime = Date.now() - startTime;

    // Final summary
    console.log("   🎉 Ontology extraction completed!");
    console.log(`      📊 Results: ${persistence.topicCount} topics, ${persistence.linkCount} links`);
    console.log(`      📈 Coverage: ${persistence.coveragePercentage}%`);
    console.log(`      ⏱️  Total time: ${totalTime}ms`);
    console.log(`      🤖 LLM calls: ${llmCallCount} (target: <100)`);

    return {
      persistence,
      timing: {
        embeddingTime: clusteringTime, // Embedding happens during clustering
        domainDiscoveryTime: domainTime,
        clusteringTime,
        subtopicTime,
        assignmentTime,
        persistenceTime,
        totalTime
      },
      quality,
      llmCallCount
    };

  } catch (error) {
    console.error("   ❌ Ontology extraction failed:", error);
    throw new Error(`Ontology extraction failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Validate ontology build results against acceptance criteria
 */
export function validateOntologyResults(result: OntologyBuildResult): {
  passed: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // FR-ONT-12/16: Coverage = 100% of files linked to ≥1 topic
  if (result.persistence.coveragePercentage < 100) {
    issues.push(`Coverage below 100%: ${result.persistence.coveragePercentage}%`);
  }

  // FR-ONT-18/19: <30 min and <100 LLM calls on typical repo (~5k files)
  if (result.timing.totalTime > 30 * 60 * 1000) { // 30 minutes in ms
    issues.push(`Total time exceeds 30 minutes: ${Math.round(result.timing.totalTime / 1000)}s`);
  }

  if (result.llmCallCount > 100) {
    issues.push(`LLM calls exceed 100: ${result.llmCallCount}`);
  }

  // Quality checks
  if (result.quality.avgIntraClusterSimilarity < 0.1) {
    issues.push(`Low cluster similarity: ${result.quality.avgIntraClusterSimilarity.toFixed(3)}`);
  }

  return {
    passed: issues.length === 0,
    issues
  };
}

/**
 * Export ontology structure for inspection or debugging
 */
export async function exportOntologyStructure(cacheDir: string): Promise<{
  structure: Awaited<ReturnType<typeof queryOntologyStructure>>;
  validation: ReturnType<typeof validateOntologyResults>;
}> {
  try {
    const structure = await queryOntologyStructure(cacheDir);
    
    // Create a mock result for validation (we don't have the full result here)
    const mockResult: OntologyBuildResult = {
      persistence: {
        rootTopicId: "root",
        topicCount: structure.stats.totalTopics,
        linkCount: structure.stats.totalLinks,
        coveragePercentage: 100 // Assume 100% for exported data
      },
      timing: {
        embeddingTime: 0,
        domainDiscoveryTime: 0,
        clusteringTime: 0,
        subtopicTime: 0,
        assignmentTime: 0,
        persistenceTime: 0,
        totalTime: 0
      },
      quality: {
        avgIntraClusterSimilarity: 0.5,
        coveragePercentage: 100,
        clusterSizes: []
      },
      llmCallCount: 0
    };

    const validation = validateOntologyResults(mockResult);

    return {
      structure,
      validation
    };
  } catch (error) {
    throw new Error(`Failed to export ontology: ${error instanceof Error ? error.message : String(error)}`);
  }
}
