import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { GitHubRestClient } from "../src/adapters/github/github-client";
import { DrizzleIssueImportRepository } from "../src/db/repositories/issue-import-repository";
import { schema } from "../src/db/schema";
import { parseRepository } from "../src/domain/repository/repository";
import { importGitHubIssues } from "../src/services/github/import-issues";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL_REQUIRED");
  const repository = parseRepository(process.argv[2] ?? "vercel/next.js");
  const limit = Number(process.argv[3] ?? 5);
  const result = await importGitHubIssues(
    new GitHubRestClient({ token: process.env.GITHUB_TOKEN || undefined }),
    repository,
    { limit },
  );
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const persisted = await new DrizzleIssueImportRepository(
      drizzle(pool, { schema }),
    ).persist(result);
    console.log(JSON.stringify({
      repository: result.repository.slug,
      fetched: result.issues.length,
      persisted: persisted.issueCount,
      storedTotal: persisted.storedIssueCount,
    }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "GITHUB_IMPORT_FAILED");
  process.exitCode = 1;
});
