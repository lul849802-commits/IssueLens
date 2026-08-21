import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { OpenAIAnalysisClient } from "../src/adapters/ai/openai-analysis-client";
import { configureOpenAIProxy } from "../src/adapters/ai/openai-proxy";
import { GitHubRestClient } from "../src/adapters/github/github-client";
import { DrizzleAnalysisSliceRepository } from "../src/db/repositories/analysis-slice-repository";
import { DrizzleIssueImportRepository } from "../src/db/repositories/issue-import-repository";
import { issueAnalyses, issues, runIssues, schema } from "../src/db/schema";
import { parseRepository } from "../src/domain/repository/repository";
import { analyzeVerticalSlice } from "../src/services/analysis/analyze-vertical-slice";
import { importGitHubIssues } from "../src/services/github/import-issues";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!connectionString) throw new Error("DATABASE_URL_REQUIRED");
  if (!apiKey) throw new Error("OPENAI_API_KEY_REQUIRED");

  const repositoryRef = parseRepository(process.argv[2] ?? "openai/openai-node");
  const imported = await importGitHubIssues(
    new GitHubRestClient({ token: process.env.GITHUB_TOKEN || undefined }),
    repositoryRef,
    { limit: 5 },
  );
  const pool = new Pool({ connectionString, max: 1 });
  const db = drizzle(pool, { schema });
  try {
    const persisted = await new DrizzleIssueImportRepository(db).persist(imported);
    configureOpenAIProxy(process.env.OPENAI_PROXY_URL);
    const analyzer = new OpenAIAnalysisClient({
      apiKey,
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
    });
    const slice = await analyzeVerticalSlice(
      new DrizzleAnalysisSliceRepository(db),
      analyzer,
      { repositoryId: persisted.repositoryId, limit: 5 },
    );
    const evidence = await db
      .select({
        issueNumber: issues.issueNumber,
        issueUrl: issues.htmlUrl,
        category: issueAnalyses.category,
        summary: issueAnalyses.summary,
        severity: issueAnalyses.severity,
        confidence: issueAnalyses.confidence,
        inputTokens: issueAnalyses.inputTokens,
        outputTokens: issueAnalyses.outputTokens,
        latencyMs: issueAnalyses.latencyMs,
        inputTruncated: issueAnalyses.inputTruncated,
        itemStatus: runIssues.status,
      })
      .from(runIssues)
      .innerJoin(issues, eq(runIssues.issueId, issues.id))
      .leftJoin(issueAnalyses, eq(issueAnalyses.runIssueId, runIssues.id))
      .where(eq(runIssues.runId, slice.runId));

    console.log(JSON.stringify({
      repository: imported.repository.slug,
      fetched: imported.issues.length,
      ...slice,
      evidence,
    }, null, 2));
    if (slice.status !== "complete") process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const safeCode = error instanceof Error && [
    "DATABASE_URL_REQUIRED",
    "OPENAI_API_KEY_REQUIRED",
    "ISSUES_DISABLED_OR_EMPTY",
    "ANALYSIS_AUTHENTICATION_FAILED",
    "ANALYSIS_RATE_LIMITED",
  ].includes(error.message)
    ? error.message
    : "AI_VERTICAL_SLICE_FAILED";
  console.error(safeCode);
  process.exitCode = 1;
});
