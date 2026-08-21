import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import {
  analysisRuns,
  issueAnalyses,
  issues,
  repositories,
  runIssues,
} from "../src/db/schema";

async function main() {
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL_REQUIRED");

const ids = {
  repository: "10000000-0000-4000-8000-000000000001",
  run: "20000000-0000-4000-8000-000000000001",
  issue: "30000000-0000-4000-8000-000000000001",
  runIssue: "40000000-0000-4000-8000-000000000001",
  analysis: "50000000-0000-4000-8000-000000000001",
};
const contentHash = "a".repeat(64);
const creatorVerifier = `scrypt:${"0".repeat(32)}:${"0".repeat(64)}`;
const pool = new Pool({ connectionString, max: 1 });
const db = drizzle(pool);

try {
  await db.transaction(async (tx) => {
    await tx
      .insert(repositories)
      .values({
        id: ids.repository,
        owner: "vercel",
        name: "next.js",
        htmlUrl: "https://github.com/vercel/next.js",
        defaultBranch: "canary",
      })
      .onConflictDoNothing();
    await tx
      .insert(analysisRuns)
      .values({
        id: ids.run,
        repositoryId: ids.repository,
        status: "complete",
        creatorTokenHash: creatorVerifier,
        scope: { limit: 1, states: ["open", "closed"], orderBy: "updated_desc" },
        totalCount: 1,
        succeededCount: 1,
        analysisVersion: "seed-v1",
        modelId: "fixture-no-provider",
        completedAt: new Date(),
      })
      .onConflictDoNothing();
    await tx
      .insert(issues)
      .values({
        id: ids.issue,
        repositoryId: ids.repository,
        githubIssueId: 1,
        issueNumber: 1,
        title: "Seed: development fixture",
        state: "open",
        labels: ["fixture"],
        htmlUrl: "https://github.com/vercel/next.js/issues/1",
        githubCreatedAt: new Date("2026-01-01T00:00:00Z"),
        githubUpdatedAt: new Date("2026-01-01T00:00:00Z"),
        currentContentHash: contentHash,
      })
      .onConflictDoNothing();
    await tx
      .insert(runIssues)
      .values({
        id: ids.runIssue,
        runId: ids.run,
        issueId: ids.issue,
        contentHash,
        status: "succeeded",
      })
      .onConflictDoNothing();
    await tx
      .insert(issueAnalyses)
      .values({
        id: ids.analysis,
        runIssueId: ids.runIssue,
        contentHash,
        analysisVersion: "seed-v1",
        modelId: "fixture-no-provider",
        promptVersion: "seed-v1",
        category: "unknown",
        summary: "开发环境演示数据，不代表真实 AI 结果。",
        productArea: "unknown",
        userScenario: "验证数据库读取路径",
        sentiment: "unknown",
        severity: "unknown",
        reproducibility: "insufficient",
        suggestedAction: "research",
        rationale: "该记录由本地 seed 创建。",
        confidence: 0,
      })
      .onConflictDoNothing();
  });
  console.log("IssueLens development seed is ready (fixture data only).");
} finally {
  await pool.end();
}
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(
    `IssueLens development seed failed: ${message.replace(/postgres(?:ql)?:\/\/\S+/g, "[REDACTED]")}`,
  );
  process.exitCode = 1;
});
