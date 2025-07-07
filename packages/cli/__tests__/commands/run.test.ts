import { jest } from "@jest/globals";
import { resolve } from "node:path";

// Mock the pipeline services
jest.mock("@ktree/pipeline", () => ({
  DirectoryTreeService: jest.fn().mockImplementation(() => ({
    buildTree: jest.fn(),
  })),
}));

// Mock the file scanner
jest.mock("../../src/utils/fileScanner", () => ({
  scanAndSummarizeFiles: jest.fn(),
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
      expect.stringContaining("🌳 ktree pipeline starting for:")
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("📄 Stage 1: File Summarization")
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("🌲 Stage 2: Directory Tree Building")
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("✅ Pipeline completed successfully!")
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
