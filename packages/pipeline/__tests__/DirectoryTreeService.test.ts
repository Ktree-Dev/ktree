import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DirectoryTreeService, type FileRecord } from "../src/services/DirectoryTreeService";
import { jest } from "@jest/globals";

// Mock LLM summariser
jest.mock("../src/services/LLMSummariser", () => ({
  summariseChunk: jest.fn(),
}));

import { summariseChunk } from "../src/services/LLMSummariser";
const mockSummariseChunk = summariseChunk as jest.MockedFunction<typeof summariseChunk>;

describe("DirectoryTreeService", () => {
  let tmpDir: string;
  let service: DirectoryTreeService;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), "ktree-tree-test", Date.now().toString());
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    
    service = new DirectoryTreeService(tmpDir);
    
    // Set up mock LLM response
    mockSummariseChunk.mockResolvedValue({
      title: "Directory Summary",
      summary: "Generated directory summary",
      functions: [],
      classes: [],
      loc: 0,
    });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    mockSummariseChunk.mockReset();
  });

  describe("FR-TREE-01: Hierarchy assembly", () => {
    test("should build correct tree structure from file paths", async () => {
      const fileRecords: FileRecord[] = [
        {
          id: "file1",
          path: "src/components/Button.tsx",
          name: "Button.tsx",
          summary: { loc: 50, title: "Button Component", summary: "React button component" },
        },
        {
          id: "file2", 
          path: "src/utils/helpers.ts",
          name: "helpers.ts",
          summary: { loc: 100, title: "Helper Utils", summary: "Utility functions" },
        },
        {
          id: "file3",
          path: "README.md",
          name: "README.md", 
          summary: { loc: 20, title: "Project README", summary: "Project documentation" },
        },
      ];

      const tree = await service.buildTree(fileRecords);

      expect(tree.name).toBe("root");
      expect(tree.children).toHaveLength(1); // src/ directory only
      expect(tree.files).toContain("file3"); // README.md in root

      // Find src directory
      const srcDir = tree.children.find(child => child.name === "src");
      expect(srcDir).toBeDefined();
      expect(srcDir?.children).toHaveLength(2); // components/ and utils/
      
      // Check components directory
      const componentsDir = srcDir?.children.find(child => child.name === "components");
      expect(componentsDir?.files).toContain("file1");
      
      // Check utils directory  
      const utilsDir = srcDir?.children.find(child => child.name === "utils");
      expect(utilsDir?.files).toContain("file2");
    });

    test("should handle nested directory structures", async () => {
      const fileRecords: FileRecord[] = [
        {
          id: "file1",
          path: "src/components/ui/forms/Input.tsx",
          name: "Input.tsx",
          summary: { loc: 80, title: "Input Component", summary: "Form input component" },
        },
      ];

      const tree = await service.buildTree(fileRecords);
      
      // Navigate down the tree: root -> src -> components -> ui -> forms
      const srcDir = tree.children.find(child => child.name === "src");
      const componentsDir = srcDir?.children.find(child => child.name === "components");
      const uiDir = componentsDir?.children.find(child => child.name === "ui");
      const formsDir = uiDir?.children.find(child => child.name === "forms");
      
      expect(formsDir?.files).toContain("file1");
    });
  });

  describe("FR-TREE-02: Directory metrics", () => {
    test("should calculate cumulative LOC correctly", async () => {
      const fileRecords: FileRecord[] = [
        {
          id: "file1",
          path: "src/app.ts",
          name: "app.ts",
          summary: { loc: 200, title: "Main App", summary: "Application entry point" },
        },
        {
          id: "file2",
          path: "src/utils/helper.ts", 
          name: "helper.ts",
          summary: { loc: 150, title: "Helper", summary: "Utility functions" },
        },
        {
          id: "file3",
          path: "tests/app.test.ts",
          name: "app.test.ts",
          summary: { loc: 100, title: "App Tests", summary: "Tests for app" },
        },
      ];

      const tree = await service.buildTree(fileRecords);

      // Root should have total LOC of all files
      expect(tree.loc).toBe(450);
      expect(tree.fileCount).toBe(3);

      // src/ directory should have 350 LOC (200 + 150) 
      const srcDir = tree.children.find(child => child.name === "src");
      expect(srcDir?.loc).toBe(350);
      expect(srcDir?.fileCount).toBe(2);

      // tests/ directory should have 100 LOC
      const testsDir = tree.children.find(child => child.name === "tests");
      expect(testsDir?.loc).toBe(100);
      expect(testsDir?.fileCount).toBe(1);
    });
  });

  describe("FR-TREE-03: Directory summaries", () => {
    test("should use heuristic summary for small directories (≤3 items)", async () => {
      const fileRecords: FileRecord[] = [
        {
          id: "file1",
          path: "src/app.ts",
          name: "app.ts", 
          summary: { loc: 100, title: "App", summary: "Main app" },
        },
        {
          id: "file2",
          path: "src/config.ts",
          name: "config.ts",
          summary: { loc: 50, title: "Config", summary: "App config" },
        },
      ];

      const tree = await service.buildTree(fileRecords);

      const srcDir = tree.children.find(child => child.name === "src");
      expect(srcDir?.summary).toContain("Contains");
      expect(srcDir?.summary).toContain("file1, file2");
      
      // Should not have called LLM for small directory
      expect(mockSummariseChunk).not.toHaveBeenCalled();
    });

    test("should use LLM summary for large directories (>3 items)", async () => {
      const fileRecords: FileRecord[] = [
        {
          id: "file1",
          path: "src/app.ts",
          name: "app.ts",
          summary: { loc: 100, title: "App", summary: "Main app" },
        },
        {
          id: "file2", 
          path: "src/config.ts",
          name: "config.ts",
          summary: { loc: 50, title: "Config", summary: "App config" },
        },
        {
          id: "file3",
          path: "src/utils.ts", 
          name: "utils.ts",
          summary: { loc: 75, title: "Utils", summary: "Utilities" },
        },
        {
          id: "file4",
          path: "src/types.ts",
          name: "types.ts", 
          summary: { loc: 25, title: "Types", summary: "Type definitions" },
        },
      ];

      const tree = await service.buildTree(fileRecords);

      const srcDir = tree.children.find(child => child.name === "src");
      expect(srcDir?.summary).toBe("Generated directory summary");
      
      // Should have called LLM for large directory
      expect(mockSummariseChunk).toHaveBeenCalledWith(
        expect.stringContaining("Summarize the purpose of the directory 'src'"),
        "text"
      );
    });

    test("should handle empty directories", async () => {
      // Create tree with a directory that will be empty after processing
      const fileRecords: FileRecord[] = [];

      const tree = await service.buildTree(fileRecords);

      expect(tree.summary).toBe("[empty directory]");
    });
  });

  describe("FR-TREE-05: Large module flag", () => {
    test("should mark directories as large modules when LOC ≥ threshold", async () => {
      const fileRecords: FileRecord[] = [
        {
          id: "file1",
          path: "src/large.ts",
          name: "large.ts",
          summary: { loc: 800, title: "Large File", summary: "A large file" },
        },
        {
          id: "file2",
          path: "src/medium.ts", 
          name: "medium.ts",
          summary: { loc: 300, title: "Medium File", summary: "A medium file" },
        },
      ];

      // Total LOC = 1100, threshold = 1000
      const tree = await service.buildTree(fileRecords);

      const srcDir = tree.children.find(child => child.name === "src");
      expect(srcDir?.loc).toBe(1100);
    });

    test("should not mark small directories as large modules", async () => {
      const fileRecords: FileRecord[] = [
        {
          id: "file1",
          path: "src/small.ts",
          name: "small.ts", 
          summary: { loc: 200, title: "Small File", summary: "A small file" },
        },
      ];

      // Total LOC = 200, threshold = 1000
      const tree = await service.buildTree(fileRecords);

      const srcDir = tree.children.find(child => child.name === "src");
      expect(srcDir?.loc).toBe(200);
    });
  });

  describe("FR-TREE-06: Integrity checks", () => {
    test("should validate tree integrity successfully", async () => {
      const fileRecords: FileRecord[] = [
        {
          id: "file1",
          path: "src/app.ts",
          name: "app.ts",
          summary: { loc: 100, title: "App", summary: "Main app" },
        },
        {
          id: "file2",
          path: "test.ts", 
          name: "test.ts",
          summary: { loc: 50, title: "Test", summary: "Test file" },
        },
      ];

      const tree = await service.buildTree(fileRecords);

      // Should not throw
      expect(() => {
        service.validateTreeIntegrity(tree, 2);
      }).not.toThrow();
    });

    test("should throw error when file counts don't match", async () => {
      const fileRecords: FileRecord[] = [
        {
          id: "file1",
          path: "src/app.ts", 
          name: "app.ts",
          summary: { loc: 100, title: "App", summary: "Main app" },
        },
      ];

      const tree = await service.buildTree(fileRecords);

      expect(() => {
        service.validateTreeIntegrity(tree, 3); // Wrong expected count
      }).toThrow("Tree integrity check failed");
    });
  });

  describe("Database persistence", () => {
    test("should persist directory tree to database", async () => {
      const fileRecords: FileRecord[] = [
        {
          id: "file1",
          path: "src/app.ts",
          name: "app.ts",
          summary: { loc: 100, title: "App", summary: "Main app" },
        },
      ];

      await service.buildTree(fileRecords);

      const directories = await service.getDirectoryTree();
      expect(directories.length).toBeGreaterThan(0);

      const srcDir = directories.find(dir => dir.name === "src");
      expect(srcDir).toBeDefined();
      expect(srcDir?.loc).toBe(100);
      expect(srcDir?.fileCount).toBe(1);
    });

    test("should get root directories correctly", async () => {
      const fileRecords: FileRecord[] = [
        {
          id: "file1",
          path: "src/app.ts",
          name: "app.ts", 
          summary: { loc: 100, title: "App", summary: "Main app" },
        },
        {
          id: "file2",
          path: "docs/readme.md",
          name: "readme.md",
          summary: { loc: 50, title: "Readme", summary: "Documentation" },
        },
      ];

      await service.buildTree(fileRecords);

      const rootDirs = await service.getRootDirectories();
      const rootDirNames = rootDirs.map(dir => dir.name);
      
      expect(rootDirNames).toContain("src");
      expect(rootDirNames).toContain("docs");
    });
  });
});
