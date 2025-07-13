#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { initCommand } from "./commands/init";
import { runCommand } from "./commands/run";
import { contextCommand } from "./commands/context";

yargs(hideBin(process.argv))
  .scriptName("ktree")
  .usage("$0 <cmd> [args]")
  .command(initCommand)
  .command(runCommand)
  .command(contextCommand)
  .demandCommand(1, "Please specify a command.")
  .help()
  .version()
  .strict()
  .parse();
