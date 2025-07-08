import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { jest } from "@jest/globals";
import { 
  buildOntology, 
  validateOntologyResults, 
  exportOntologyStructure,
  type FileRecord,
  type DirectoryRecord,
  type OntologyBuildResult
} from "../src/services/llmOntology/OntologyService";

// Mock all dependencies
jest.mock("../src/services/llmOntology/rootDomains", () => ({
  discoverRootAndTopLevelDomains: jest.fn(),
}));

jest.mock("../src/services/llmOntology/structureGenerator", () => ({
  generateStructureForDomains: jest.fn(),
  analyzeClusterQuality: jest.fn(),
}));

jest.mock("../src/services/llmOntology/subtopicLabeler", () => ({
  generateSubtopicStructuresForAllDomains: jest.fn(),
}));

jest.mock("../src/services/llmOntology/topicAssigner", () => ({
  assignFilesForAllDomains: jest.fn(),
}));

jest.mock("../src/services/llmOntology/databaseOperations", () => ({
  persistOntologyToDatabase: jest.fn(),
  queryOntologyStructure: jest.fn(),
}));

// Import mocked functions
import { discoverRootAndTopLevelDomains } from "../src/services/llmOntology/rootDomains";
import { generateStructureForDomains, analyzeClusterQuality } from "../src/services/llmOntology/structureGenerator";
import { generateSubtopicStructuresForAllDomains } from "../src/services/llmOntology/subtopicLabeler";
import { assignFilesForAllDomains } from "../src/services/llmOntology/topicAssigner";
import { persistOntologyToDatabase, queryOntologyStructure } from "../src/services/llmOntology/databaseOperations";

const mockDiscoverDomains = discoverRootAndTopLevelDomains as jest.MockedFunction<typeof discoverRootAndTopLevelDomains>;
const mockGenerateStructure = generateStructureForDomains as jest.MockedFunction<typeof generateStructureForDomains>;
const mockAnalyzeQuality = analyzeClusterQuality as jest.MockedFunction<typeof analyzeClusterQuality>;
const mockGenerateSubtopics = generateSubtopicStructuresForAllDomains as jest.MockedFunction<typeof generateSubtopicStructuresForAllDomains>;
const mockAssignFiles = assignFilesForAllDomains as jest.MockedFunction<typeof assignFilesForAllDomains>;
const mockPersistOntology = persistOntologyToDatabase as jest.MockedFunction<typeof persistOntologyToDatabase>;
const mockQueryStructure = queryOntologyStructure as jest.MockedFunction<typeof queryOntologyStructure>;

describe("OntologyService", () => {
  const tmpDir = path.join(os.tmpdir(), "ktree-ontology-test");

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    
    // Set up default mock responses
    mockDiscoverDomains.mockResolvedValue({
      rootDomain: {
        title: "Test Application",
        description: "A comprehensive test application with authentication, UI components, and data management."
      },
      topLevelDomains: [
        { title: "Authentication", description: "User authentication and security features." },
        { title: "User Interface", description: "Frontend components and user interaction logic." }
      ]
    });

    mockGenerateStructure.mockResolvedValue([
      {
        domain: { title: "Authentication", description: "User authentication and security features." },
        candidates: [
          { id: "file1", path: "src/auth/login.ts", title: "Login Component", summary: "Handles user login", embedding: [0.1, 0.2, 0.3] },
          { id: "file2", path: "src/auth/register.ts", title: "Register Component", summary: "Handles user registration", embedding: [0.2, 0.3, 0.4] }
        ],
        similarity_threshold: 0.3
      },
      {
        domain: { title: "User Interface", description: "Frontend components and user interaction logic." },
        candidates: [
          { id: "file3", path: "src/ui/button.ts", title: "Button Component", summary: "Reusable button component", embedding: [0.3, 0.4, 0.5] }
        ],
        similarity_threshold: 0.3
      }
    ]);

    mockAnalyzeQuality.mockReturnValue({
      avgIntraClusterSimilarity: 0.75,
      coveragePercentage: 100,
      clusterSizes: [2, 1]
    });

    mockGenerateSubtopics.mockResolvedValue([
      {
        subtopics: [
          { title: "Login Flow", description: "User login and session management" },
          { title: "Registration", description: "User registration and onboarding" }
        ]
      },
      {
        subtopics: [
          { title: "Base Components", description: "Core UI building blocks" }
        ]
      }
    ]);

    mockAssignFiles.mockResolvedValue([
      {
        assignments: [
          { filePath: "src/auth/login.ts", subtopics: ["Login Flow"] },
          { filePath: "src/auth/register.ts", subtopics: ["Registration"] }
        ]
      },
      {
        assignments: [
          { filePath: "src/ui/button.ts", subtopics: ["Base Components"] }
        ]
      }
    ]);

    mockPersistOntology.mockResolvedValue({
      rootTopicId: "root",
      topicCount: 6, // 1 root + 2 domains + 3 subtopics
      linkCount: 3,
      coveragePercentage: 100
    });
  });

  describe("buildOntology", () => {
    const mockFileRecords: FileRecord[] = [
      {
        id: "file1",
        path: "src/auth/login.ts",
        name: "login.ts",
        summary: { title: "Login Component", summary: "Handles user login", loc: 45 }
      },
      {
        id: "file2", 
        path: "src/auth/register.ts",
        name: "register.ts",
        summary: { title: "Register Component", summary: "Handles user registration", loc: 60 }
      },
      {
        id: "file3",
        path: "src/ui/button.ts", 
        name: "button.ts",
        summary: { title: "Button Component", summary: "Reusable button component", loc: 25 }
      }
    ];

    const mockDirectoryRecords: DirectoryRecord[] = [
      {
        id: "dir1",
        path: "src/auth",
        summary: "Authentication related components",
        fileCount: 2,
        loc: 105
      },
      {
        id: "dir2",
        path: "src/ui",
        summary: "User interface components", 
        fileCount: 1,
        loc: 25
      }
    ];

    test("should successfully build complete ontology", async () => {
      const result = await buildOntology(tmpDir, mockFileRecords, mockDirectoryRecords);

      // Verify all phases were called
      expect(mockDiscoverDomains).toHaveBeenCalledTimes(1);
      expect(mockGenerateStructure).toHaveBeenCalledTimes(1);
      expect(mockGenerateSubtopics).toHaveBeenCalledTimes(1);
      expect(mockAssignFiles).toHaveBeenCalledTimes(1);
      expect(mockPersistOntology).toHaveBeenCalledTimes(1);

      // Verify result structure
      expect(result).toHaveProperty("persistence");
      expect(result).toHaveProperty("timing");
      expect(result).toHaveProperty("quality");
      expect(result).toHaveProperty("llmCallCount");

      expect(result.persistence.topicCount).toBe(6);
      expect(result.persistence.linkCount).toBe(3);
      expect(result.persistence.coveragePercentage).toBe(100);

      expect(result.llmCallCount).toBe(5); // 1 domain discovery + 2 subtopic generation + 2 assignment
      expect(result.timing.totalTime).toBeGreaterThan(0);
    });

    test("should handle empty file records", async () => {
      const result = await buildOntology(tmpDir, [], mockDirectoryRecords);

      expect(result).toBeDefined();
      expect(mockDiscoverDomains).toHaveBeenCalledWith([], expect.any(Array));
    });

    test("should handle empty directory records", async () => {
      const result = await buildOntology(tmpDir, mockFileRecords, []);

      expect(result).toBeDefined();
      expect(mockDiscoverDomains).toHaveBeenCalledWith(expect.any(Array), []);
    });

    test("should propagate errors from domain discovery", async () => {
      mockDiscoverDomains.mockRejectedValue(new Error("Domain discovery failed"));

      await expect(buildOntology(tmpDir, mockFileRecords, mockDirectoryRecords))
        .rejects.toThrow("Ontology extraction failed: Domain discovery failed");
    });

    test("should propagate errors from structure generation", async () => {
      mockGenerateStructure.mockRejectedValue(new Error("Structure generation failed"));

      await expect(buildOntology(tmpDir, mockFileRecords, mockDirectoryRecords))
        .rejects.toThrow("Ontology extraction failed: Structure generation failed");
    });

    test("should propagate errors from persistence", async () => {
      mockPersistOntology.mockRejectedValue(new Error("Persistence failed"));

      await expect(buildOntology(tmpDir, mockFileRecords, mockDirectoryRecords))
        .rejects.toThrow("Ontology extraction failed: Persistence failed");
    });

    test("should track LLM call count correctly", async () => {
      // Mock with 3 domains to test scaling
      mockDiscoverDomains.mockResolvedValue({
        rootDomain: { title: "Root", description: "Root domain" },
        topLevelDomains: [
          { title: "Domain1", description: "First domain" },
          { title: "Domain2", description: "Second domain" },
          { title: "Domain3", description: "Third domain" }
        ]
      });

      const result = await buildOntology(tmpDir, mockFileRecords, mockDirectoryRecords);

      // Should be 1 + 3 + 3 = 7 LLM calls (domain discovery + subtopics + assignments)
      expect(result.llmCallCount).toBe(7);
    });
  });

  describe("validateOntologyResults", () => {
    const createMockResult = (overrides: Partial<OntologyBuildResult> = {}): OntologyBuildResult => ({
      persistence: {
        rootTopicId: "root",
        topicCount: 6,
        linkCount: 3,
        coveragePercentage: 100
      },
      timing: {
        embeddingTime: 1000,
        domainDiscoveryTime: 2000,
        clusteringTime: 1000,
        subtopicTime: 3000,
        assignmentTime: 2000,
        persistenceTime: 500,
        totalTime: 9500
      },
      quality: {
        avgIntraClusterSimilarity: 0.75,
        coveragePercentage: 100,
        clusterSizes: [2, 1]
      },
      llmCallCount: 4,
      ...overrides
    });

    test("should pass validation for valid results", () => {
      const result = createMockResult();
      const validation = validateOntologyResults(result);

      expect(validation.passed).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });

    test("should fail validation for low coverage", () => {
      const result = createMockResult({
        persistence: { ...createMockResult().persistence, coveragePercentage: 85 }
      });
      
      const validation = validateOntologyResults(result);

      expect(validation.passed).toBe(false);
      expect(validation.issues).toContain("Coverage below 100%: 85%");
    });

    test("should fail validation for excessive time", () => {
      const result = createMockResult({
        timing: { ...createMockResult().timing, totalTime: 35 * 60 * 1000 } // 35 minutes
      });
      
      const validation = validateOntologyResults(result);

      expect(validation.passed).toBe(false);
      expect(validation.issues).toContain("Total time exceeds 30 minutes: 2100s");
    });

    test("should fail validation for too many LLM calls", () => {
      const result = createMockResult({ llmCallCount: 150 });
      
      const validation = validateOntologyResults(result);

      expect(validation.passed).toBe(false);
      expect(validation.issues).toContain("LLM calls exceed 100: 150");
    });

    test("should fail validation for low cluster similarity", () => {
      const result = createMockResult({
        quality: { ...createMockResult().quality, avgIntraClusterSimilarity: 0.05 }
      });
      
      const validation = validateOntologyResults(result);

      expect(validation.passed).toBe(false);
      expect(validation.issues).toContain("Low cluster similarity: 0.050");
    });

    test("should accumulate multiple validation issues", () => {
      const result = createMockResult({
        persistence: { ...createMockResult().persistence, coveragePercentage: 80 },
        llmCallCount: 120,
        quality: { ...createMockResult().quality, avgIntraClusterSimilarity: 0.05 }
      });
      
      const validation = validateOntologyResults(result);

      expect(validation.passed).toBe(false);
      expect(validation.issues).toHaveLength(3);
      expect(validation.issues).toContain("Coverage below 100%: 80%");
      expect(validation.issues).toContain("LLM calls exceed 100: 120");
      expect(validation.issues).toContain("Low cluster similarity: 0.050");
    });
  });

  describe("exportOntologyStructure", () => {
    beforeEach(() => {
      mockQueryStructure.mockResolvedValue({
        topics: [
          { id: "root", title: "Root Domain", description: "Root", parentId: null, depth: 0, isRoot: true },
          { id: "domain1", title: "Auth", description: "Authentication", parentId: "root", depth: 1, isRoot: false }
        ],
        links: [
          { id: "link1", topicId: "domain1", nodeId: "file1", nodeType: "file", confidence: 100 }
        ],
        stats: {
          totalTopics: 2,
          totalLinks: 1,
          maxDepth: 1
        }
      });
    });

    test("should export ontology structure successfully", async () => {
      const result = await exportOntologyStructure(tmpDir);

      expect(result).toHaveProperty("structure");
      expect(result).toHaveProperty("validation");

      expect(result.structure.topics).toHaveLength(2);
      expect(result.structure.links).toHaveLength(1);
      expect(result.structure.stats.totalTopics).toBe(2);

      expect(mockQueryStructure).toHaveBeenCalledWith(tmpDir);
    });

    test("should handle export errors", async () => {
      mockQueryStructure.mockRejectedValue(new Error("Database error"));

      await expect(exportOntologyStructure(tmpDir))
        .rejects.toThrow("Failed to export ontology: Database error");
    });

    test("should include validation results", async () => {
      const result = await exportOntologyStructure(tmpDir);

      expect(result.validation).toHaveProperty("passed");
      expect(result.validation).toHaveProperty("issues");
      expect(result.validation.passed).toBe(true); // Mock result should pass validation
    });
  });

  describe("integration scenarios", () => {
    test("should handle multi-topic file assignments", async () => {
      // Mock assignment with files belonging to multiple topics
      mockAssignFiles.mockResolvedValue([
        {
          assignments: [
            { filePath: "src/auth/login.ts", subtopics: ["Login Flow", "UI Components"] }, // Multi-topic
            { filePath: "src/auth/register.ts", subtopics: ["Registration"] }
          ]
        }
      ]);

      const fileRecords: FileRecord[] = [
        { id: "file1", path: "src/auth/login.ts", name: "login.ts", summary: { title: "Login", summary: "Login component", loc: 45 } },
        { id: "file2", path: "src/auth/register.ts", name: "register.ts", summary: { title: "Register", summary: "Register component", loc: 60 } }
      ];

      const result = await buildOntology(tmpDir, fileRecords, []);

      expect(result).toBeDefined();
      expect(mockAssignFiles).toHaveBeenCalled();
      expect(mockPersistOntology).toHaveBeenCalled();
    });

    test("should handle large repository scenarios", async () => {
      // Create a larger set of mock data
      const largeFileSet: FileRecord[] = Array.from({ length: 50 }, (_, i) => ({
        id: `file${i}`,
        path: `src/module${Math.floor(i / 10)}/file${i}.ts`,
        name: `file${i}.ts`,
        summary: { title: `File ${i}`, summary: `Summary for file ${i}`, loc: 20 + i }
      }));

      const largeDirSet: DirectoryRecord[] = Array.from({ length: 5 }, (_, i) => ({
        id: `dir${i}`,
        path: `src/module${i}`,
        summary: `Module ${i} directory`,
        fileCount: 10,
        loc: 200 + i * 100
      }));

      const result = await buildOntology(tmpDir, largeFileSet, largeDirSet);

      expect(result).toBeDefined();
      expect(mockDiscoverDomains).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: "file0" })]),
        expect.arrayContaining([expect.objectContaining({ id: "dir0" })])
      );
    });
  });

  describe("performance requirements", () => {
    test("should complete within time constraints for typical repo", async () => {
      // Simulate timing that should pass validation
      jest.spyOn(Date, 'now')
        .mockReturnValueOnce(0) // Start time
        .mockReturnValueOnce(1000) // Domain discovery end
        .mockReturnValueOnce(2000) // Clustering end
        .mockReturnValueOnce(3000) // Subtopic end
        .mockReturnValueOnce(4000) // Assignment end
        .mockReturnValueOnce(4500) // Persistence end
        .mockReturnValue(5000); // Total end

      const result = await buildOntology(tmpDir, [], []);

      expect(result.timing.totalTime).toBe(5000); // 5 seconds, well under 30 minutes
      expect(result.llmCallCount).toBeLessThanOrEqual(100);

      const validation = validateOntologyResults(result);
      expect(validation.passed).toBe(true);
    });
  });
});
