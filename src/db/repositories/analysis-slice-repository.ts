import { and, desc, eq, ne } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { IssueAnalysis } from "@/domain/analysis/analysis";
import type {
  AnalysisWorkItem,
  CachedAnalysis,
  VerticalSliceCounts,
  VerticalSliceStore,
} from "@/services/analysis/analyze-vertical-slice";

import type { IssueLensDatabase } from "../database";
import { analysisRuns, issueAnalyses, issues, runIssues } from "../schema";

export class DrizzleAnalysisSliceRepository<TQueryResult extends PgQueryResultHKT>
  implements VerticalSliceStore
{
  constructor(private readonly db: IssueLensDatabase<TQueryResult>) {}

  async createRun(input: {
    repositoryId: string;
    limit: number;
    analysisVersion: string;
    modelId: string;
  }): Promise<{ runId: string; items: AnalysisWorkItem[] }> {
    return this.db.transaction(async (tx) => {
      const selected = await tx
        .select()
        .from(issues)
        .where(eq(issues.repositoryId, input.repositoryId))
        .orderBy(desc(issues.githubUpdatedAt), desc(issues.issueNumber))
        .limit(input.limit);
      if (selected.length === 0) throw new Error("ISSUES_DISABLED_OR_EMPTY");

      const [run] = await tx
        .insert(analysisRuns)
        .values({
          repositoryId: input.repositoryId,
          status: "analyzing",
          creatorTokenHash: "scrypt:development-vertical-slice",
          scope: { limit: selected.length, states: ["open", "closed"], orderBy: "updated_desc" },
          totalCount: selected.length,
          analysisVersion: input.analysisVersion,
          modelId: input.modelId,
          startedAt: new Date(),
        })
        .returning({ id: analysisRuns.id });
      if (!run) throw new Error("RUN_WRITE_FAILED");

      const items: AnalysisWorkItem[] = [];
      for (const issue of selected) {
        const [runIssue] = await tx
          .insert(runIssues)
          .values({ runId: run.id, issueId: issue.id, contentHash: issue.currentContentHash })
          .returning({ id: runIssues.id });
        if (!runIssue) throw new Error("RUN_ISSUE_WRITE_FAILED");
        items.push({
          runIssueId: runIssue.id,
          contentHash: issue.currentContentHash,
          issue: {
            number: issue.issueNumber,
            title: issue.title,
            body: issue.body,
            labels: issue.labels,
            state: issue.state,
            createdAt: issue.githubCreatedAt.toISOString(),
            updatedAt: issue.githubUpdatedAt.toISOString(),
            commentsCount: issue.commentsCount,
          },
        });
      }
      return { runId: run.id, items };
    });
  }

  async findCached(
    item: AnalysisWorkItem,
    analysisVersion: string,
    modelId: string,
  ): Promise<CachedAnalysis | null> {
    const [cached] = await this.db
      .select()
      .from(issueAnalyses)
      .where(and(
        eq(issueAnalyses.contentHash, item.contentHash),
        eq(issueAnalyses.analysisVersion, analysisVersion),
        eq(issueAnalyses.modelId, modelId),
        ne(issueAnalyses.runIssueId, item.runIssueId),
      ))
      .orderBy(desc(issueAnalyses.createdAt))
      .limit(1);
    return cached ? {
      analysis: toAnalysis(cached),
      providerRequestId: cached.providerRequestId,
    } : null;
  }

  async markProcessing(runIssueId: string): Promise<void> {
    await this.db
      .update(runIssues)
      .set({ status: "processing", attemptCount: 1, errorCode: null, errorPublicMessage: null, updatedAt: new Date() })
      .where(eq(runIssues.id, runIssueId));
  }

  async recordSuccess(input: Parameters<VerticalSliceStore["recordSuccess"]>[0]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(issueAnalyses).values({
        runIssueId: input.item.runIssueId,
        contentHash: input.item.contentHash,
        analysisVersion: input.analysisVersion,
        modelId: input.modelId,
        promptVersion: input.promptVersion,
        ...input.result.analysis,
        providerRequestId: input.result.providerRequestId,
        inputTokens: input.result.inputTokens,
        outputTokens: input.result.outputTokens,
        latencyMs: input.result.latencyMs,
        inputTruncated: input.inputTruncated,
      });
      await tx.update(runIssues).set({ status: "succeeded", updatedAt: new Date() }).where(eq(runIssues.id, input.item.runIssueId));
    });
  }

  async recordCached(input: Parameters<VerticalSliceStore["recordCached"]>[0]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(issueAnalyses).values({
        runIssueId: input.item.runIssueId,
        contentHash: input.item.contentHash,
        analysisVersion: input.analysisVersion,
        modelId: input.modelId,
        promptVersion: input.promptVersion,
        ...input.cached.analysis,
        providerRequestId: input.cached.providerRequestId,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        inputTruncated: input.inputTruncated,
      });
      await tx.update(runIssues).set({ status: "skipped_cached", updatedAt: new Date() }).where(eq(runIssues.id, input.item.runIssueId));
    });
  }

  async recordFailure(runIssueId: string, code: string): Promise<void> {
    await this.db.update(runIssues).set({
      status: "failed",
      errorCode: code,
      errorPublicMessage: "该 Issue 暂时无法完成 AI 分析，可稍后重试。",
      updatedAt: new Date(),
    }).where(eq(runIssues.id, runIssueId));
  }

  async finalize(runId: string): Promise<VerticalSliceCounts> {
    const rows = await this.db
      .select({ status: runIssues.status })
      .from(runIssues)
      .where(eq(runIssues.runId, runId));
    const succeeded = rows.filter((row) => row.status === "succeeded").length;
    const cached = rows.filter((row) => row.status === "skipped_cached").length;
    const failed = rows.filter((row) => row.status === "failed").length;
    const status = failed === rows.length ? "failed" : failed > 0 ? "partial" : "complete";
    await this.db.update(analysisRuns).set({
      status,
      succeededCount: succeeded + cached,
      failedCount: failed,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(analysisRuns.id, runId));
    return { total: rows.length, succeeded, cached, failed, status };
  }
}

type AnalysisRow = typeof issueAnalyses.$inferSelect;

function toAnalysis(row: AnalysisRow): IssueAnalysis {
  return {
    category: row.category,
    summary: row.summary,
    productArea: row.productArea,
    userScenario: row.userScenario,
    sentiment: row.sentiment,
    severity: row.severity,
    reproducibility: row.reproducibility,
    suggestedAction: row.suggestedAction,
    rationale: row.rationale,
    confidence: row.confidence,
  };
}
