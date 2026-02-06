#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import {
  parseFilter,
  serializeFilter,
  generateFilter,
  defaultRule,
} from "@rslh/core";

const program = new Command();

program
  .name("rslh-filter-gen")
  .description("Generate and validate RSLH artifact filter (.hsf) files")
  .version("0.0.1");

program
  .command("validate")
  .description("Parse and validate an .hsf file")
  .argument("<file>", "Path to .hsf file")
  .action((file: string) => {
    try {
      const raw = readFileSync(file, "utf-8");
      const filter = parseFilter(raw);
      console.log(`Valid .hsf file with ${filter.Rules.length} rules.`);
    } catch (err) {
      console.error(`Invalid .hsf file: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("stub")
  .description("Generate a stub .hsf file with one default rule")
  .option("-o, --output <file>", "Write output to file instead of stdout")
  .action((opts: { output?: string }) => {
    const filter = generateFilter([defaultRule()]);
    const json = serializeFilter(filter);

    if (opts.output) {
      writeFileSync(opts.output, json);
      console.log(`Stub filter written to ${opts.output}`);
    } else {
      console.log(json);
    }
  });

program.parse();
