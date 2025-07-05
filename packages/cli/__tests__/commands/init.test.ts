/**
 * Unit tests for the ktree init command
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Arguments } from "yargs";

// Mock prompts module
const mockPrompts = jest.fn();
jest.mock("prompts", () => mockPrompts);

// Mock fs operations
jest.mock("node:fs");
const mockedFs = fs as jest.Mocked<typeof fs>;

// Mock os operations
jest.mock("node:os", () => ({
  homedir: jest.fn(() => "/home/testuser")
}));
const mockedOs = os as jest.Mocked<typeof os>;

// Mock console.log
const mockConsoleLog = jest.spyOn(console, "log").mockImplementation();

// Import after mocks are set up
import { initCommand } from "../../src/commands/init";

describe("ktree init command", () => {
  const mockHomeDir = "/home/testuser";
  const mockConfigDir = path.join(mockHomeDir, ".ktree");
  const mockConfigPath = path.join(mockConfigDir, "config.json");

  beforeEach(() => {
    jest.clearAllMocks();
    mockedOs.homedir.mockReturnValue(mockHomeDir);
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.mkdirSync.mockImplementation();
    mockedFs.writeFileSync.mockImplementation();
  });

  describe("interactive mode", () => {
    it("should create config directory if it doesn't exist", async () => {
      mockPrompts.mockResolvedValue({
        anthropic: "",
        openai: "",
        gemini: "",
        cohere: "",
        reasoner: "openai/o3",
        summariser: "anthropic/claude-4-sonnet",
        embedder: "google/textembedding-gecko-002",
        useCloud: false,
      });

      const argv = { _: ["init"], $0: "ktree" } as Arguments;
      await initCommand.handler!(argv);

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(mockConfigDir, { recursive: true });
    });

    it("should create config with default models", async () => {
      mockPrompts.mockResolvedValue({
        anthropic: "",
        openai: "",
        gemini: "",
        cohere: "",
        reasoner: "openai/o3",
        summariser: "anthropic/claude-4-sonnet",
        embedder: "google/textembedding-gecko-002",
        useCloud: false,
      });

      const argv = { _: ["init"], $0: "ktree" } as Arguments;
      await initCommand.handler!(argv);

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        mockConfigPath,
        expect.stringContaining('"reasoner": "openai/o3"'),
        "utf8"
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(`✅ Config saved to ${mockConfigPath}`);
    });

    it("should encrypt API keys when provided", async () => {
      const testApiKey = "test-anthropic-key";
      mockPrompts.mockResolvedValue({
        anthropic: testApiKey,
        openai: "",
        gemini: "",
        cohere: "",
        reasoner: "openai/o3",
        summariser: "anthropic/claude-4-sonnet",
        embedder: "google/textembedding-gecko-002",
        useCloud: false,
      });

      const argv = { _: ["init"], $0: "ktree" } as Arguments;
      await initCommand.handler!(argv);

      const writeCall = mockedFs.writeFileSync.mock.calls[0];
      const configJson = writeCall[1] as string;
      const config = JSON.parse(configJson);

      expect(config.llm.keys.anthropic).toBeDefined();
      expect(config.llm.keys.anthropic).not.toBe(testApiKey); // Should be encrypted
      
      // Verify it's valid JSON encryption format
      const encryptedData = JSON.parse(config.llm.keys.anthropic);
      expect(encryptedData).toHaveProperty("iv");
      expect(encryptedData).toHaveProperty("content");
      expect(encryptedData).toHaveProperty("tag");
    });

    it("should include cloud config when provided", async () => {
      const cloudApiKey = "test-cloud-key";
      mockPrompts.mockResolvedValue({
        anthropic: "",
        openai: "",
        gemini: "",
        cohere: "",
        reasoner: "openai/o3",
        summariser: "anthropic/claude-4-sonnet",
        embedder: "google/textembedding-gecko-002",
        useCloud: true,
        cloudKey: cloudApiKey,
      });

      const argv = { _: ["init"], $0: "ktree" } as Arguments;
      await initCommand.handler!(argv);

      const writeCall = mockedFs.writeFileSync.mock.calls[0];
      const configJson = writeCall[1] as string;
      const config = JSON.parse(configJson);

      expect(config.cloud).toEqual({ apiKey: cloudApiKey });
    });
  });

  describe("non-interactive mode", () => {
    it("should generate config from environment variables", async () => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        ANTHROPIC_API_KEY: "env-anthropic-key",
        OPENAI_API_KEY: "env-openai-key",
        KTREE_REASONER_MODEL: "anthropic/claude-4-opus",
      };

      const argv = { 
        _: ["init"], 
        $0: "ktree", 
        nonInteractive: true 
      } as Arguments & { nonInteractive: boolean };
      
      await initCommand.handler!(argv);

      const writeCall = mockedFs.writeFileSync.mock.calls[0];
      const configJson = writeCall[1] as string;
      const config = JSON.parse(configJson);

      expect(config.llm.reasoner).toBe("anthropic/claude-4-opus");
      expect(config.llm.keys.anthropic).toBeDefined();
      expect(config.llm.keys.openai).toBeDefined();

      process.env = originalEnv;
    });

    it("should use default models when env vars not provided", async () => {
      const argv = { 
        _: ["init"], 
        $0: "ktree", 
        nonInteractive: true 
      } as Arguments & { nonInteractive: boolean };
      
      await initCommand.handler!(argv);

      const writeCall = mockedFs.writeFileSync.mock.calls[0];
      const configJson = writeCall[1] as string;
      const config = JSON.parse(configJson);

      expect(config.llm.reasoner).toBe("openai/o3");
      expect(config.llm.summariser).toBe("anthropic/claude-4-sonnet");
      expect(config.llm.embedder).toBe("google/textembedding-gecko-002");
      expect(config.llm.ontology).toBe("anthropic/claude-4-sonnet");
    });
  });

  describe("config schema", () => {
    it("should generate config with schemaVersion 2", async () => {
      mockPrompts.mockResolvedValue({
        anthropic: "",
        openai: "",
        gemini: "",
        cohere: "",
        reasoner: "openai/o3",
        summariser: "anthropic/claude-4-sonnet",
        embedder: "google/textembedding-gecko-002",
        useCloud: false,
      });

      const argv = { _: ["init"], $0: "ktree" } as Arguments;
      await initCommand.handler!(argv);

      const writeCall = mockedFs.writeFileSync.mock.calls[0];
      const configJson = writeCall[1] as string;
      const config = JSON.parse(configJson);

      expect(config.schemaVersion).toBe(2);
      expect(config.llm).toBeDefined();
      expect(config.llm.keys).toBeDefined();
    });
  });
});
