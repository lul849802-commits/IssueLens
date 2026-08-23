import { count, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { RunStatus } from "@/domain/runs/run-state";
import type { IssueLensDatabase } from "@/db/database";
import { analysisRuns, repositories, runIssues } from "@/db/schema";

export interface RunStatusView {
  id: string;
  repositorySlug: string;
  status: RunStatus;
  progress: {
    total: number;
    succeeded: number;
    failed: number;
    pending: number;
  };
  isTerminal: boolean;
  updatedAt: Date;
}

export async function getRunStatus<TQueryResult extends PgQueryResultHKT>(
  db: IssueLensDatabase<TQueryResult>,
  runId: string,
): Promise<RunStatusView | null> {
  const [runRows, itemRows] = await Promise.all([db
    .select({
      id: analysisRuns.id,
      owner: repositories.owner,
      name: repositories.name,
      status: analysisRuns.status,
      total: analysisRuns.totalCount,
      succeeded: analysisRuns.succeededCount,
      failed: analysisRuns.failedCount,
      updatedAt: analysisRuns.updatedAt,
    })
    .from(analysisRuns)
    .innerJoin(repositories, eq(analysisRuns.repositoryId, repositories.id))
    .where(eq(analysisRuns.id, runId))
    .limit(1), db
      .select({ status: runIssues.status, value: count() })
      .from(runIssues)
      .where(eq(runIssues.runId, runId))
      .groupBy(runIssues.status),
  ]);
  const [row] = runRows;

  if (!row) return null;
  const counts = new Map(itemRows.map((item) => [item.status, item.value]));
  const succeeded = (counts.get("succeeded") ?? 0) +
    (counts.get("skipped_cached") ?? 0);
  const failed = counts.get("failed") ?? 0;

  return {
    id: row.id,
    repositorySlug: `${row.owner}/${row.name}`,
    status: row.status,
    progress: {
      total: row.total,
      succeeded: row.status === "complete" || row.status === "partial"
        ? row.succeeded
        : succeeded,
      failed: row.status === "complete" || row.status === "partial"
        ? row.failed
        : failed,
      pending: Math.max(0, row.total - succeeded - failed),
    },
    isTerminal: ["complete", "partial", "failed"].includes(row.status),
    updatedAt: row.updatedAt,
  };
}
