import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@autopilot/core", "@autopilot/db"],
  serverExternalPackages: ["@prisma/client", ".prisma/client", "pg-boss", "simple-git", "@anthropic-ai/sdk", "openai", "@octokit/rest"],
  devIndicators: false,
  typescript: { ignoreBuildErrors: false },
};

export default config;
