#!/usr/bin/env tsx
import { Command } from "commander";
import { getConfig } from "@autopilot/core/config";
import { checkGoalsAndConduct } from "@autopilot/core/checks";
import { stopBoss } from "@autopilot/core/queue";
import { prisma } from "@autopilot/db";
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

program
  .command("check")
  .description("Run all standing-goal checks on main now (plain code)")
  .option("--conduct", "also let the conductor open jobs for red goals")
  .action(async (opts: { conduct?: boolean }) => {
    const r = await checkGoalsAndConduct("cli", Boolean(opts.conduct));
    for (const g of r.results) console.log(`${g.status.padEnd(5)} ${g.goalId.padEnd(18)} ${g.summary}`);
    if (r.plan) console.log("jobs:", r.plan.jobIds.join(", ") || "none", r.plan.skipped);
  });

program
  .parseAsync(process.argv)
  .then(async () => {
    await stopBoss();
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
