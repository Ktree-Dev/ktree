import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { summariseFile } from "../src/services/FileSummarisationService";
import { FileSummary } from "@ktree/common";
import { jest } from "@jest/globals";

// Mock dependencies
jest.mock("../src/services/LLMSummariser", () => ({
  summariseChunk: jest.fn(),
}));

// Import and cast the mocked function
import { summariseChunk } from "../src/services/LLMSummariser";
const mockSummariseChunk = summariseChunk as jest.MockedFunction<typeof summariseChunk>;

// Set up default mock response
mockSummariseChunk.mockResolvedValue({
  title: "Test File",
  summary: "A test file with mock content",
  functions: [{ name: "testFunction", loc: 10, summary: "A test function" }],
  classes: [],
  loc: 15,
});

describe("FileSummarisationService", () => {
  const tmpDir = path.join(os.tmpdir(), "ktree-test-cache");
  const testFile = path.join(tmpDir, "test.ts");

  beforeAll(() => {
    // Create temp directory and test file
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    
    fs.writeFileSync(testFile, `
function testFunction() {
  console.log("test");
  return 42;
}
`);
  });

  afterAll(() => {
    // Cleanup
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("deterministic hashing", () => {
    test("should produce identical hashes for identical content", async () => {
      const result1 = await summariseFile(testFile, { cacheDir: tmpDir });
      const result2 = await summariseFile(testFile, { cacheDir: tmpDir });

      expect(result1.hash).toBe(result2.hash);
      expect(result1.hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    });

    test("should produce different hashes for different content", async () => {
      const testFile2 = path.join(tmpDir, "test2.ts");
      fs.writeFileSync(testFile2, `
function differentFunction() {
  console.log("different");
}
`);

      const result1 = await summariseFile(testFile, { cacheDir: tmpDir });
      const result2 = await summariseFile(testFile2, { cacheDir: tmpDir });

      expect(result1.hash).not.toBe(result2.hash);

      fs.unlinkSync(testFile2);
    });
  });

  describe("SQLite caching", () => {
    test("should cache results and avoid re-processing", async () => {
      // Use a unique file for this test to avoid cache hits
      const cacheTestFile = path.join(tmpDir, "cache-test-unique.ts");
      fs.writeFileSync(cacheTestFile, `
function uniqueCacheTest() {
  console.log("unique test for cache");
  return Math.random();
}
`);

      // Clear previous calls
      mockSummariseChunk.mockClear();

      // First call should invoke LLM (may call multiple times for chunks)
      const result1 = await summariseFile(cacheTestFile, { cacheDir: tmpDir });
      const firstCallCount = mockSummariseChunk.mock.calls.length;
      expect(firstCallCount).toBeGreaterThan(0);

      // Second call should use cache (no additional LLM calls)
      const result2 = await summariseFile(cacheTestFile, { cacheDir: tmpDir });
      expect(mockSummariseChunk.mock.calls.length).toBe(firstCallCount); // Same count as first

      expect(result1).toEqual(result2);

      // Cleanup
      fs.unlinkSync(cacheTestFile);
    });

    test("should create cache database file", async () => {
      await summariseFile(testFile, { cacheDir: tmpDir });
      
      const cacheDbPath = path.join(tmpDir, "summary-cache.sqlite");
      expect(fs.existsSync(cacheDbPath)).toBe(true);
    });
  });

  describe("language detection", () => {
    test("should detect TypeScript files", async () => {
      const result = await summariseFile(testFile, { cacheDir: tmpDir });
      expect(result.language).toBe("typescript");
    });

    test("should detect Python files", async () => {
      const pyFile = path.join(tmpDir, "test.py");
      fs.writeFileSync(pyFile, `
def test_function():
    print("test")
    return 42
`);

      const result = await summariseFile(pyFile, { cacheDir: tmpDir });
      expect(result.language).toBe("python");

      fs.unlinkSync(pyFile);
    });

    test("should default to plain for unknown extensions", async () => {
      const unknownFile = path.join(tmpDir, "test.unknown");
      fs.writeFileSync(unknownFile, "some content");

      const result = await summariseFile(unknownFile, { cacheDir: tmpDir });
      expect(result.language).toBe("plain");

      fs.unlinkSync(unknownFile);
    });
  });

  describe("error handling", () => {
    test("should throw error for non-existent file", async () => {
      const nonExistentFile = path.join(tmpDir, "does-not-exist.ts");
      
      await expect(summariseFile(nonExistentFile, { cacheDir: tmpDir }))
        .rejects.toThrow();
    });
  });

  describe("result structure", () => {
    test("should return valid ChunkResult structure", async () => {
      const result = await summariseFile(testFile, { cacheDir: tmpDir });

      expect(result).toHaveProperty("hash");
      expect(result).toHaveProperty("language");
      expect(result).toHaveProperty("summary");
      
      expect(result.summary).toHaveProperty("title");
      expect(result.summary).toHaveProperty("summary");
      expect(result.summary).toHaveProperty("functions");
      expect(result.summary).toHaveProperty("classes");
      expect(result.summary).toHaveProperty("loc");

      expect(Array.isArray(result.summary.functions)).toBe(true);
      expect(Array.isArray(result.summary.classes)).toBe(true);
      expect(typeof result.summary.loc).toBe("number");
    });
  });
});
