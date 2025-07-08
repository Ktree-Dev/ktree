import { jest } from "@jest/globals";
import { resolve } from "node:path";

// Mock the pipeline services
jest.mock("@ktree/pipeline", () => ({
  DirectoryTreeService: jest.fn().mockImplementation(() => ({
    buildTree: jest.fn(),
    getDirectoryTree: jest.fn(),
  })),
  buildOntology: jest.fn(),
  validateOntologyResults: jest.fn(),
}));

// Mock the file scanner
jest.mock("../../src/utils/fileScanner", () => ({
  scanAndSummarizeFiles: jest.fn(),
  findCodeFiles: jest.fn(),
}));

// Mock cost estimator
jest.mock("../../src/utils/costEstimator", () => ({
  estimatePipelineCost: jest.fn(),
  promptCostConfirmation: jest.fn(),
}));

// Mock config loading
jest.mock("@ktree/common", () => ({
  loadConfig: jest.fn().mockReturnValue({
    llm: {
      reasoner: "openai/o3",
      summariser: "anthropic/claude-4-sonnet"
    }
  }),
}));

import { runCommand } from "../../src/commands/run";
import { findCodeFiles, scanAndSummarizeFiles } from "../../src/utils/fileScanner";
import { estimatePipelineCost, promptCostConfirmation } from "../../src/utils/costEstimator";
import { DirectoryTreeService, buildOntology, validateOntologyResults } from "@ktree/pipeline";

const mockFindCodeFiles = findCodeFiles as jest.MockedFunction<typeof findCodeFiles>;
const mockScanAndSummarizeFiles = scanAndSummarizeFiles as jest.MockedFunction<typeof scanAndSummarizeFiles>;
const mockEstimatePipelineCost = estimatePipelineCost as jest.MockedFunction<typeof estimatePipelineCost>;
const mockPromptCostConfirmation = promptCostConfirmation as jest.MockedFunction<typeof promptCostConfirmation>;
const mockBuildOntology = buildOntology as jest.MockedFunction<typeof buildOntology>;
const mockValidateOntologyResults = validateOntologyResults as jest.MockedFunction<typeof validateOntologyResults>;

describe("run command", () => {
  let consoleSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    // Set up mock return values
    mockFindCodeFiles.mockResolvedValue([]);
    mockEstimatePipelineCost.mockReturnValue({
      summarization: {
        model: "test/model",
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.01
      },
      directoryTreeSummaries: {
        model: "test/model",
        inputTokens: 50,
        outputTokens: 25,
        cost: 0.005
      },
      totalCost: 0.015,
      fileCount: 0
    });
    mockPromptCostConfirmation.mockResolvedValue(true);
    mockScanAndSummarizeFiles.mockResolvedValue([]);
    
    // Set up ontology mocks
    mockBuildOntology.mockResolvedValue({
      persistence: { 
        rootTopicId: "root",
        topicCount: 5, 
        linkCount: 10, 
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
      llmCallCount: 3
    });
    mockValidateOntologyResults.mockReturnValue({ 
      passed: true, 
      issues: [] 
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  test("should define run command correctly", () => {
    expect(runCommand.command).toBe("run [path]");
    expect(runCommand.describe).toBe("Run ktree analysis pipeline on a repository");
  });

  test("should handle successful pipeline execution", async () => {
    const mockArgv = {
      path: process.cwd(),
      cloud: false,
      _: ["run"],
      $0: "ktree"
    };

    await runCommand.handler!(mockArgv);

    // Check that progress messages were logged
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(" ktree pipeline starting for:")
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(" Stage 1: File Summarization")
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("🌲 Stage 2: Directory Tree Building")
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("🧠 Stage 3: Ontology Extraction")
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Pipeline completed successfully!")
    );
  });

  test("should handle cloud delegation (not implemented)", async () => {
    const mockArgv = {
      path: process.cwd(),
      cloud: true,
      _: ["run"],
      $0: "ktree"
    };

    await expect(async () => {
      await runCommand.handler!(mockArgv);
    }).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Pipeline failed:",
      "Cloud delegation not yet implemented"
    );
  });

  test("should handle non-existent path", async () => {
    const mockArgv = {
      path: "/non/existent/path",
      cloud: false,
      _: ["run"],
      $0: "ktree"
    };

    await expect(async () => {
      await runCommand.handler!(mockArgv);
    }).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Pipeline failed:",
      "Repository path does not exist: /non/existent/path"
    );
  });

  test("should use current directory as default path", () => {
    const builder = runCommand.builder as Function;
    const mockYargs = {
      positional: jest.fn().mockReturnThis(),
      option: jest.fn().mockReturnThis(),
    };

    builder(mockYargs);

    expect(mockYargs.positional).toHaveBeenCalledWith("path", {
      describe: "Path to repository (default: current directory)",
      type: "string",
      default: process.cwd(),
    });

    expect(mockYargs.option).toHaveBeenCalledWith("cloud", {
      describe: "Delegate processing to ktree-cloud",
      type: "boolean",
      default: false,
    });
  });
});
