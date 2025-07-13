import { summariseFile } from "@ktree/pipeline";
import { loadConfig } from "@ktree/common";
import chalk from "chalk";
import * as fs from "node:fs";
import * as path from "node:path";

export interface SummariseOptions {
  output?: string;
  verbose?: boolean;
  cacheDir?: string;
}

/**
 * Hidden CLI command for file summarisation (will be exposed in KTR-30).
 * Usage: ktree summarise <file-path> [options]
 */
export async function summariseCommand(
  filePath: string,
  options: SummariseOptions = {},
): Promise<void> {
  try {
    // Ensure config exists
    const config = loadConfig();
    if (!config.llm?.summariser) {
      console.error(chalk.red("Error: No summariser model configured. Run 'ktree init' first."));
      process.exit(1);
    }

    // Validate file exists
    if (!fs.existsSync(filePath)) {
      console.error(chalk.red(`Error: File not found: ${filePath}`));
      process.exit(1);
    }

    if (options.verbose) {
      console.log(chalk.blue(`Summarising: ${filePath}`));
      console.log(chalk.gray(`Using model: ${config.llm.summariser}`));
    }

    // Run summarisation
    const result = await summariseFile(filePath, {
      cacheDir: options.cacheDir,
    });

    // Output results
    if (options.output) {
      fs.writeFileSync(options.output, JSON.stringify(result, null, 2));
      console.log(chalk.green(`Summary written to: ${options.output}`));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    if (options.verbose) {
      console.log(chalk.gray(`Cached with hash: ${result.hash}`));
    }
  } catch (error) {
    console.error(chalk.red(`Summarisation failed: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

// Export for yargs integration (when KTR-30 surfaces this command)
export const summariseCommandConfig = {
  command: "summarise <file>",
  describe: "Generate structured summary of a source file",
  builder: (yargs: any) =>
    yargs
      .positional("file", {
        describe: "Path to source file to summarise",
        type: "string",
      })
      .option("output", {
        alias: "o",
        describe: "Output file for summary JSON",
        type: "string",
      })
      .option("verbose", {
        alias: "v",
        describe: "Verbose logging",
        type: "boolean",
        default: false,
      })
      .option("cache-dir", {
        describe: "Custom cache directory",
        type: "string",
      }),
  handler: (argv: any) => summariseCommand(argv.file, argv),
};
