import { eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { RunStatus } from "@/domain/runs/run-state";
import type { IssueLensDatabase } from "@/db/database";
import { analysisRuns, repositories } from "@/db/schema";

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
  const [row] = await db
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
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    repositorySlug: `${row.owner}/${row.name}`,
    status: row.status,
    progress: {
      total: row.total,
      succeeded: row.succeeded,
      failed: row.failed,
      pending: Math.max(0, row.total - row.succeeded - row.failed),
    },
    isTerminal: ["complete", "partial", "failed"].includes(row.status),
    updatedAt: row.updatedAt,
  };
}
