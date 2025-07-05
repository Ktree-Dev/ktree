import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { initCommand } from "./commands/init";

yargs(hideBin(process.argv))
  .scriptName("ktree")
  .usage("$0 <cmd> [args]")
  .command(initCommand)
  .demandCommand(1, "Please specify a command.")
  .help()
  .version()
  .strict()
  .parse();
