#!/usr/bin/env tsx
import { Command } from "commander";
import { getConfig } from "@autopilot/core/config";
import { addRealBug, reintroduceG1, seedDemoTarget } from "@autopilot/core/seed/index";

const program = new Command().name("autopilot").description("Project Autopilot CLI");

program
  .command("seed")
  .description("Create demo_target with the three planted problems")
  .option("--real-bug", "add a commit with a genuine bug (classifier should say: real)")
  .option("--reintroduce <goal>", "re-plant a fixed problem on main (g1)")
  .action(async (opts: { realBug?: boolean; reintroduce?: string; }) => {
    const dir = getConfig().targetRepoPath;
    if (opts.realBug) {
      console.log(await addRealBug(dir));
    } else if (opts.reintroduce) {
      if (opts.reintroduce.toLowerCase() !== "g1") throw new Error("only --reintroduce g1 is supported");
      console.log(await reintroduceG1(dir));
    } else {
      await seedDemoTarget(dir, { force: true });
      console.log(`Seeded ${dir}`);
    }
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
