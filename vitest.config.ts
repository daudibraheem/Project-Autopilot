import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: { AUTOPILOT_LLM_PROVIDER: "mock", AUTOPILOT_SANDBOX: "local" },
  },
});
