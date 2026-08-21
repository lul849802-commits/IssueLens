import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { GitHubRestClient } from "../src/adapters/github/github-client";
import { parseRepository } from "../src/domain/repository/repository";
import { importGitHubIssues } from "../src/services/github/import-issues";

async function main() {
  const repository = parseRepository(process.argv[2] ?? "vercel/next.js");
  const limit = Number(process.argv[3] ?? 5);
  const result = await importGitHubIssues(
    new GitHubRestClient({ token: process.env.GITHUB_TOKEN || undefined }),
    repository,
    { limit },
  );
  console.log(JSON.stringify({
    repository: result.repository.slug,
    authenticated: Boolean(process.env.GITHUB_TOKEN),
    ...result.counts,
    rateLimitRemaining: result.rateLimit.remaining,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "GITHUB_SMOKE_FAILED");
  process.exitCode = 1;
});
