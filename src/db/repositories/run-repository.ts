import { and, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";

import { assertRunTransition, type RunStatus } from "@/domain/runs/run-state";

import type { IssueLensDatabase } from "../database";
import type { CreateRunInput, RunRecord, RunRepository } from "../ports";
import { analysisRuns, repositories } from "../schema";

export class DrizzleRunRepository<TQueryResult extends PgQueryResultHKT>
  implements RunRepository
{
  constructor(private readonly db: IssueLensDatabase<TQueryResult>) {}

  async create(input: CreateRunInput): Promise<RunRecord> {
    const created = await this.db.transaction(async (tx) => {
      const [repository] = await tx
        .insert(repositories)
        .values({
          owner: input.repository.owner.toLowerCase(),
          name: input.repository.repo.toLowerCase(),
          htmlUrl: input.repositoryHtmlUrl,
        })
        .onConflictDoUpdate({
          target: [repositories.owner, repositories.name],
          set: { htmlUrl: input.repositoryHtmlUrl, updatedAt: new Date() },
        })
        .returning();

      if (!repository) throw new Error("REPOSITORY_WRITE_FAILED");

      const [run] = await tx
        .insert(analysisRuns)
        .values({
          repositoryId: repository.id,
          creatorTokenHash: input.creatorTokenHash,
          scope: input.scope,
          analysisVersion: input.analysisVersion,
        })
        .returning();

      if (!run) throw new Error("RUN_WRITE_FAILED");
      return { repository, run };
    });

    return toRunRecord(created.run, created.repository);
  }

  async findById(runId: string): Promise<RunRecord | null> {
    const [row] = await this.db
      .select({ run: analysisRuns, repository: repositories })
      .from(analysisRuns)
      .innerJoin(repositories, eq(analysisRuns.repositoryId, repositories.id))
      .where(eq(analysisRuns.id, runId))
      .limit(1);

    return row ? toRunRecord(row.run, row.repository) : null;
  }

  async updateStatus(runId: string, nextStatus: RunStatus): Promise<RunRecord> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: analysisRuns.status })
        .from(analysisRuns)
        .where(eq(analysisRuns.id, runId))
        .limit(1);

      if (!current) throw new Error("RUN_NOT_FOUND");
      assertRunTransition(current.status, nextStatus);

      const now = new Date();
      const [updated] = await tx
        .update(analysisRuns)
        .set({
          status: nextStatus,
          updatedAt: now,
          startedAt: nextStatus === "fetching" ? now : undefined,
          completedAt: ["complete", "partial", "failed"].includes(nextStatus)
            ? now
            : undefined,
        })
        .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.status, current.status)))
        .returning();

      if (!updated) throw new Error("RUN_STATUS_CONFLICT");

      const [repository] = await tx
        .select()
        .from(repositories)
        .where(eq(repositories.id, updated.repositoryId))
        .limit(1);

      if (!repository) throw new Error("REPOSITORY_NOT_FOUND");
      return toRunRecord(updated, repository);
    });
  }
}

type RunRow = typeof analysisRuns.$inferSelect;
type RepositoryRow = typeof repositories.$inferSelect;

function toRunRecord(run: RunRow, repository: RepositoryRow): RunRecord {
  return {
    id: run.id,
    repositoryId: repository.id,
    repository: {
      owner: repository.owner,
      repo: repository.name,
      slug: `${repository.owner}/${repository.name}`,
    },
    status: run.status,
    scope: run.scope,
    totalCount: run.totalCount,
    succeededCount: run.succeededCount,
    failedCount: run.failedCount,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
