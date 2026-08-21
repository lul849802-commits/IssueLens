import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import {
  analysisRuns,
  issueAnalyses,
  issues,
  runIssues,
  schema,
} from "../src/db/schema";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL_REQUIRED");
  const runIds = process.argv.slice(2);
  if (runIds.length === 0) throw new Error("RUN_ID_REQUIRED");
  const pool = new Pool({ connectionString, max: 1 });
  const db = drizzle(pool, { schema });
  try {
    for (const runId of runIds) {
      const [run] = await db
        .select({
          id: analysisRuns.id,
          status: analysisRuns.status,
          totalCount: analysisRuns.totalCount,
          succeededCount: analysisRuns.succeededCount,
          failedCount: analysisRuns.failedCount,
          modelId: analysisRuns.modelId,
          workflowEventRecorded: sql<boolean>`${analysisRuns.workflowEventId} is not null`,
          workflowRunRecorded: sql<boolean>`${analysisRuns.workflowRunId} is not null`,
          errorCode: analysisRuns.errorCode,
          startedAt: analysisRuns.startedAt,
          completedAt: analysisRuns.completedAt,
        })
        .from(analysisRuns)
        .where(eq(analysisRuns.id, runId))
        .limit(1);
      if (!run) throw new Error("RUN_NOT_FOUND");
      const items = await db
        .select({
          issueNumber: issues.issueNumber,
          status: runIssues.status,
          attemptCount: runIssues.attemptCount,
          errorCode: runIssues.errorCode,
          inputTokens: issueAnalyses.inputTokens,
          outputTokens: issueAnalyses.outputTokens,
          latencyMs: issueAnalyses.latencyMs,
          requestIdRecorded: sql<boolean>`${issueAnalyses.providerRequestId} is not null`,
        })
        .from(runIssues)
        .innerJoin(issues, eq(runIssues.issueId, issues.id))
        .leftJoin(issueAnalyses, eq(issueAnalyses.runIssueId, runIssues.id))
        .where(eq(runIssues.runId, runId));
      console.log(JSON.stringify({ run, items }, null, 2));
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const code = error instanceof Error && [
    "DATABASE_URL_REQUIRED",
    "RUN_ID_REQUIRED",
    "RUN_NOT_FOUND",
  ].includes(error.message)
    ? error.message
    : "WORKFLOW_VERIFY_FAILED";
  console.error(code);
  process.exitCode = 1;
});
