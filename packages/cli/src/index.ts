#!/usr/bin/env node

import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { generateConfig, ConfigParams } from "@rslh/core";

const program = new Command();

program
  .name("rslh-filter-gen")
  .description("Generate JSON config files for RSLH filters")
  .version("0.0.1");

program
  .command("generate")
  .description("Generate a config file")
  .requiredOption("-n, --name <name>", "Config name")
  .option(
    "-r, --rule <rules...>",
    "Rules in pattern:action format (e.g. '*.log:exclude')"
  )
  .option("-o, --output <file>", "Write output to file instead of stdout")
  .action((opts: { name: string; rule?: string[]; output?: string }) => {
    const rules: ConfigParams["rules"] = (opts.rule ?? []).map((r) => {
      const sep = r.indexOf(":");
      const pattern = r.slice(0, sep);
      const action = r.slice(sep + 1);
      if (action !== "include" && action !== "exclude") {
        console.error(`Invalid action "${action}" in rule "${r}". Use include or exclude.`);
        process.exit(1);
      }
      return { pattern, action } as const;
    });

    const config = generateConfig({ name: opts.name, rules });
    const json = JSON.stringify(config, null, 2);

    if (opts.output) {
      writeFileSync(opts.output, json + "\n");
      console.log(`Config written to ${opts.output}`);
    } else {
      console.log(json);
    }
  });

program.parse();
