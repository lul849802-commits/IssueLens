import {
  and,
  desc,
  eq,
  inArray,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { IssueAnalysis } from "@/domain/analysis/analysis";
import type { ClusterCallRecord, ClusterEvidenceItem, ClusterProviderResult } from "@/adapters/ai/cluster-port";
import type { RepositoryRef } from "@/domain/repository/repository";
import type {
  AnalysisWorkItem,
  CachedAnalysis,
  VerticalSliceCounts,
} from "@/services/analysis/analyze-vertical-slice";
import type {
  ClaimResult,
  DurableAnalysisStore,
} from "@/services/analysis/durable-analysis";

import type { IssueLensDatabase } from "../database";
import {
  analysisRuns,
  aiProviderCalls,
  clusterMembers,
  clusters,
  issueAnalyses,
  issues,
  repositories,
  runIssues,
} from "../schema";
import { provisionalPriority } from "@/domain/priority/priority";

const terminalItemStatuses = ["succeeded", "failed", "skipped_cached"] as const;
const terminalRunStatuses = ["complete", "partial", "failed"] as const;

export interface RequestedRunInput {
  repository: RepositoryRef;
  repositoryHtmlUrl: string;
  creatorTokenHash: string;
  limit: number;
  analysisVersion: string;
  modelId: string;
}

export class DrizzleDurableAnalysisRepository<TQueryResult extends PgQueryResultHKT>
  implements DurableAnalysisStore
{
  constructor(private readonly db: IssueLensDatabase<TQueryResult>) {}

  async createRequestedRun(input: RequestedRunInput): Promise<{
    runId: string;
    repositoryId: string;
  }> {
    return this.db.transaction(async (tx) => {
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
        .returning({ id: repositories.id });
      if (!repository) throw new Error("REPOSITORY_WRITE_FAILED");

      const [run] = await tx
        .insert(analysisRuns)
        .values({
          repositoryId: repository.id,
          status: "queued",
          creatorTokenHash: input.creatorTokenHash,
          scope: {
            limit: Math.min(100, Math.max(1, Math.trunc(input.limit))),
            states: ["open", "closed"],
            orderBy: "updated_desc",
          },
          analysisVersion: input.analysisVersion,
          modelId: input.modelId,
        })
        .returning({ id: analysisRuns.id });
      if (!run) throw new Error("RUN_WRITE_FAILED");
      return { runId: run.id, repositoryId: repository.id };
    });
  }

  async recordWorkflowEvent(runId: string, eventId: string): Promise<void> {
    await this.db
      .update(analysisRuns)
      .set({ workflowEventId: eventId, updatedAt: new Date() })
      .where(eq(analysisRuns.id, runId));
  }

  async markWorkflowStarted(runId: string, workflowRunId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [run] = await tx
        .select({ status: analysisRuns.status })
        .from(analysisRuns)
        .where(eq(analysisRuns.id, runId))
        .limit(1);
      if (!run) throw new Error("RUN_NOT_FOUND");
      if (terminalRunStatuses.includes(run.status as typeof terminalRunStatuses[number])) return;

      const now = new Date();
      if (run.status === "queued") {
        const [updated] = await tx
          .update(analysisRuns)
          .set({
            status: "fetching",
            workflowRunId,
            startedAt: now,
            updatedAt: now,
          })
          .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.status, "queued")))
          .returning({ id: analysisRuns.id });
        if (!updated) throw new Error("RUN_STATUS_CONFLICT");
        return;
      }

      await tx
        .update(analysisRuns)
        .set({ workflowRunId, updatedAt: now })
        .where(eq(analysisRuns.id, runId));
    });
  }

  async prepareAnalysis(input: {
    runId: string;
    limit: number;
    modelId: string;
  }): Promise<AnalysisWorkItem[]> {
    return this.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(analysisRuns)
        .where(eq(analysisRuns.id, input.runId))
        .limit(1);
      if (!run) throw new Error("RUN_NOT_FOUND");
      if (run.status === "queued") throw new Error("RUN_NOT_STARTED");

      const selected = await tx
        .select()
        .from(issues)
        .where(eq(issues.repositoryId, run.repositoryId))
        .orderBy(desc(issues.githubUpdatedAt), desc(issues.issueNumber))
        .limit(Math.min(100, Math.max(1, Math.trunc(input.limit))));
      if (selected.length === 0) throw new Error("ISSUES_DISABLED_OR_EMPTY");

      await tx
        .insert(runIssues)
        .values(selected.map((issue) => ({
          runId: input.runId,
          issueId: issue.id,
          contentHash: issue.currentContentHash,
        })))
        .onConflictDoNothing({ target: [runIssues.runId, runIssues.issueId] });

      if (run.status === "fetching") {
        const [updated] = await tx
          .update(analysisRuns)
          .set({
            status: "analyzing",
            totalCount: selected.length,
            modelId: input.modelId,
            updatedAt: new Date(),
          })
          .where(and(
            eq(analysisRuns.id, input.runId),
            eq(analysisRuns.status, "fetching"),
          ))
          .returning({ id: analysisRuns.id });
        if (!updated) throw new Error("RUN_STATUS_CONFLICT");
      }

      return selectWorkItems(tx, input.runId);
    });
  }

  async claim(runIssueId: string): Promise<ClaimResult> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ runIssue: runIssues, issue: issues })
        .from(runIssues)
        .innerJoin(issues, eq(runIssues.issueId, issues.id))
        .where(eq(runIssues.id, runIssueId))
        .limit(1);
      if (!row) throw new Error("RUN_ISSUE_NOT_FOUND");
      if (terminalItemStatuses.includes(
        row.runIssue.status as typeof terminalItemStatuses[number],
      )) {
        return {
          kind: "terminal",
          status: row.runIssue.status as typeof terminalItemStatuses[number],
        };
      }

      const now = new Date();
      const [claimed] = await tx
        .update(runIssues)
        .set({
          status: "processing",
          attemptCount: sql`${runIssues.attemptCount} + 1`,
          errorCode: null,
          errorPublicMessage: null,
          startedAt: row.runIssue.startedAt ?? now,
          updatedAt: now,
        })
        .where(and(
          eq(runIssues.id, runIssueId),
          eq(runIssues.attemptCount, row.runIssue.attemptCount),
          inArray(runIssues.status, ["pending", "processing"]),
        ))
        .returning({ id: runIssues.id });
      if (!claimed) throw new Error("RUN_ISSUE_CLAIM_CONFLICT");
      return { kind: "claimed", item: toWorkItem(row.runIssue.id, row.runIssue.contentHash, row.issue) };
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

  async recordSuccess(input: Parameters<DurableAnalysisStore["recordSuccess"]>[0]): Promise<void> {
    await this.persistTerminalAnalysis(input, "succeeded", {
      providerRequestId: input.result.providerRequestId,
      inputTokens: input.result.inputTokens,
      outputTokens: input.result.outputTokens,
      latencyMs: input.result.latencyMs,
      analysis: input.result.analysis,
    });
  }

  async recordCached(input: Parameters<DurableAnalysisStore["recordCached"]>[0]): Promise<void> {
    await this.persistTerminalAnalysis(input, "skipped_cached", {
      providerRequestId: input.cached.providerRequestId,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      analysis: input.cached.analysis,
    });
  }

  async recordFailure(runIssueId: string, code: string): Promise<void> {
    await this.db
      .update(runIssues)
      .set({
        status: "failed",
        errorCode: code,
        errorPublicMessage: "该 Issue 暂时无法完成 AI 分析，可稍后重试。",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(runIssues.id, runIssueId),
        notInArray(runIssues.status, [...terminalItemStatuses]),
      ));
  }

  async recordClusterCall(runId: string, record: ClusterCallRecord): Promise<void> {
    const values = {
      runId,
      operationKey: record.operationKey,
      operation: "clustering_shard",
      status: record.status,
      modelId: record.modelId,
      itemCount: record.itemCount,
      providerRequestId: record.providerRequestId,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      latencyMs: record.latencyMs,
      errorCode: record.errorCode,
      updatedAt: new Date(),
    } as const;
    await this.db.insert(aiProviderCalls).values(values).onConflictDoUpdate({
      target: [aiProviderCalls.runId, aiProviderCalls.operationKey],
      set: {
        status: values.status,
        providerRequestId: values.providerRequestId,
        inputTokens: values.inputTokens,
        outputTokens: values.outputTokens,
        latencyMs: values.latencyMs,
        errorCode: values.errorCode,
        updatedAt: values.updatedAt,
      },
    });
  }

  async aggregate(runId: string): Promise<VerticalSliceCounts> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ status: runIssues.status })
        .from(runIssues)
        .where(eq(runIssues.runId, runId));
      if (rows.length === 0) throw new Error("RUN_ITEMS_EMPTY");
      if (rows.some((row) => ["pending", "processing"].includes(row.status))) {
        throw new Error("RUN_ITEMS_NOT_TERMINAL");
      }

      const succeeded = rows.filter((row) => row.status === "succeeded").length;
      const cached = rows.filter((row) => row.status === "skipped_cached").length;
      const failed = rows.filter((row) => row.status === "failed").length;
      const status = failed === rows.length
        ? "failed"
        : failed > 0
          ? "partial"
          : "complete";
      const now = new Date();
      const [run] = await tx
        .select({ status: analysisRuns.status })
        .from(analysisRuns)
        .where(eq(analysisRuns.id, runId))
        .limit(1);
      if (!run) throw new Error("RUN_NOT_FOUND");
      if (!terminalRunStatuses.includes(run.status as typeof terminalRunStatuses[number])) {
        if (["analyzing", "clustering"].includes(run.status)) {
          await tx
            .update(analysisRuns)
            .set({ status: "aggregating", updatedAt: now })
            .where(and(eq(analysisRuns.id, runId), inArray(analysisRuns.status, ["analyzing", "clustering"])));
        }
        await tx
          .update(analysisRuns)
          .set({
            status,
            succeededCount: succeeded + cached,
            failedCount: failed,
            completedAt: now,
            updatedAt: now,
          })
          .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.status, "aggregating")));
      }
      return { total: rows.length, succeeded, cached, failed, status };
    });
  }

  async prepareClustering(runId: string): Promise<ClusterEvidenceItem[]> {
    return this.db.transaction(async (tx) => {
      const [run] = await tx.select({ status: analysisRuns.status }).from(analysisRuns)
        .where(eq(analysisRuns.id, runId)).limit(1);
      if (!run) throw new Error("RUN_NOT_FOUND");
      if (run.status === "analyzing") {
        const [updated] = await tx.update(analysisRuns).set({ status: "clustering", updatedAt: new Date() })
          .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.status, "analyzing"))).returning({ id: analysisRuns.id });
        if (!updated) throw new Error("RUN_STATUS_CONFLICT");
      } else if (run.status !== "clustering") {
        throw new Error(`RUN_NOT_READY_FOR_CLUSTERING:${run.status}`);
      }
      const rows = await tx.select({
        runIssueId: runIssues.id, issueNumber: issues.issueNumber, title: issues.title,
        commentsCount: issues.commentsCount, updatedAt: issues.githubUpdatedAt,
        category: issueAnalyses.category, summary: issueAnalyses.summary,
        productArea: issueAnalyses.productArea, userScenario: issueAnalyses.userScenario,
        severity: issueAnalyses.severity, suggestedAction: issueAnalyses.suggestedAction,
      }).from(runIssues).innerJoin(issues, eq(runIssues.issueId, issues.id))
        .innerJoin(issueAnalyses, eq(issueAnalyses.runIssueId, runIssues.id))
        .where(eq(runIssues.runId, runId)).orderBy(desc(issues.githubUpdatedAt));
      return rows.map((row) => ({ runIssueId: row.runIssueId, issueNumber: row.issueNumber, title: row.title,
        commentsCount: row.commentsCount, updatedAt: row.updatedAt.toISOString(), analysis: {
          category: row.category, summary: row.summary, productArea: row.productArea,
          userScenario: row.userScenario, severity: row.severity, suggestedAction: row.suggestedAction,
        } }));
    });
  }

  async persistSemanticClusters(runId: string, result: ClusterProviderResult): Promise<{ clusters: number; members: number; unclustered: number; method: "semantic" }> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.select({ clusterId: clusters.id, runIssueId: clusterMembers.runIssueId })
        .from(clusters).leftJoin(clusterMembers, eq(clusterMembers.clusterId, clusters.id))
        .where(eq(clusters.runId, runId));
      if (existing.length > 0) return { clusters: new Set(existing.map((row) => row.clusterId)).size, members: existing.filter((row) => row.runIssueId).length, unclustered: result.plan.unclusteredRunIssueIds.length, method: "semantic" };
      const evidence = await tx.select({ runIssueId: runIssues.id, severity: issueAnalyses.severity,
        commentsCount: issues.commentsCount, updatedAt: issues.githubUpdatedAt })
        .from(runIssues).innerJoin(issues, eq(runIssues.issueId, issues.id))
        .innerJoin(issueAnalyses, eq(issueAnalyses.runIssueId, runIssues.id)).where(eq(runIssues.runId, runId));
      const byId = new Map(evidence.map((item) => [item.runIssueId, item])); let members=0;
      for (const planCluster of result.plan.clusters) {
        const group=planCluster.memberRunIssueIds.map((id)=>byId.get(id)).filter((item):item is NonNullable<typeof item>=>Boolean(item));
        if(group.length!==planCluster.memberRunIssueIds.length)throw new Error("CLUSTER_MEMBER_NOT_IN_RUN");
        const priority=priorityFor(group);
        const [created]=await tx.insert(clusters).values({runId,name:planCluster.name,summary:planCluster.summary,suggestedAction:planCluster.suggestedAction,priorityScore:priority.score,prioritySignals:priority.signals,isProvisional:false}).returning({id:clusters.id});
        if(!created)throw new Error("CLUSTER_WRITE_FAILED");
        await tx.insert(clusterMembers).values(planCluster.memberRunIssueIds.map((runIssueId)=>({clusterId:created.id,runIssueId,membershipSource:"model" as const})));members+=group.length;
      }
      await tx.update(analysisRuns).set({status:"aggregating",updatedAt:new Date()}).where(and(eq(analysisRuns.id,runId),eq(analysisRuns.status,"clustering")));
      return{clusters:result.plan.clusters.length,members,unclustered:result.plan.unclusteredRunIssueIds.length,method:"semantic"};
    });
  }

  async buildClusters(runId: string): Promise<{ clusters: number; members: number }> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.select({ id: clusters.id }).from(clusters)
        .where(eq(clusters.runId, runId)).limit(1);
      if (existing.length > 0) {
        const members = await tx.select({ id: clusterMembers.runIssueId })
          .from(clusterMembers).innerJoin(clusters, eq(clusterMembers.clusterId, clusters.id))
          .where(eq(clusters.runId, runId));
        await tx.update(analysisRuns).set({ status: "aggregating", updatedAt: new Date() })
          .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.status, "clustering")));
        return { clusters: existing.length, members: members.length };
      }

      const rows = await tx.select({
        runIssueId: runIssues.id,
        category: issueAnalyses.category,
        productArea: issueAnalyses.productArea,
        severity: issueAnalyses.severity,
        suggestedAction: issueAnalyses.suggestedAction,
        commentsCount: issues.commentsCount,
        updatedAt: issues.githubUpdatedAt,
      }).from(runIssues)
        .innerJoin(issueAnalyses, eq(issueAnalyses.runIssueId, runIssues.id))
        .innerJoin(issues, eq(runIssues.issueId, issues.id))
        .where(eq(runIssues.runId, runId));

      const grouped = new Map<string, typeof rows>();
      for (const row of rows) {
        const area = row.productArea.trim() || "未明确产品区域";
        const key = `${row.category}:${area.toLocaleLowerCase()}`;
        grouped.set(key, [...(grouped.get(key) ?? []), row]);
      }
      let memberCount = 0;
      for (const group of grouped.values()) {
        const first = group[0];
        if (!first) continue;
        const recentBoundary = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const priority = provisionalPriority({
          frequency: group.length,
          highOrCritical: group.filter((item) => ["high", "critical"].includes(item.severity)).length,
          recent30d: group.filter((item) => item.updatedAt.getTime() >= recentBoundary).length,
          comments: group.reduce((sum, item) => sum + item.commentsCount, 0),
        });
        const [created] = await tx.insert(clusters).values({
          runId,
          name: `${labelCategory(first.category)} · ${first.productArea}`,
          summary: `包含 ${group.length} 条与“${first.productArea}”相关的 ${labelCategory(first.category)} Issue。`,
          suggestedAction: first.suggestedAction,
          priorityScore: priority.score,
          prioritySignals: priority.signals,
          isProvisional: true,
        }).returning({ id: clusters.id });
        if (!created) continue;
        await tx.insert(clusterMembers).values(group.map((item) => ({
          clusterId: created.id,
          runIssueId: item.runIssueId,
          membershipSource: "model" as const,
        })));
        memberCount += group.length;
      }
      await tx.update(analysisRuns).set({ status: "aggregating", updatedAt: new Date() })
        .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.status, "clustering")));
      return { clusters: grouped.size, members: memberCount };
    });
  }

  async failRun(runId: string, code: string): Promise<void> {
    await this.db
      .update(analysisRuns)
      .set({
        status: "failed",
        errorCode: code,
        errorPublicMessage: "分析任务未能完成，请稍后重试。",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(analysisRuns.id, runId),
        notInArray(analysisRuns.status, [...terminalRunStatuses]),
      ));
  }

  private async persistTerminalAnalysis(
    input: Parameters<DurableAnalysisStore["recordSuccess"]>[0] |
      Parameters<DurableAnalysisStore["recordCached"]>[0],
    status: "succeeded" | "skipped_cached",
    result: {
      providerRequestId: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
      latencyMs: number | null;
      analysis: IssueAnalysis;
    },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: runIssues.status })
        .from(runIssues)
        .where(eq(runIssues.id, input.item.runIssueId))
        .limit(1);
      if (!current) throw new Error("RUN_ISSUE_NOT_FOUND");
      if (terminalItemStatuses.includes(current.status as typeof terminalItemStatuses[number])) return;

      await tx
        .insert(issueAnalyses)
        .values({
          runIssueId: input.item.runIssueId,
          contentHash: input.item.contentHash,
          analysisVersion: input.analysisVersion,
          modelId: input.modelId,
          promptVersion: input.promptVersion,
          ...result.analysis,
          providerRequestId: result.providerRequestId,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: result.latencyMs,
          inputTruncated: input.inputTruncated,
        })
        .onConflictDoNothing({
          target: [
            issueAnalyses.runIssueId,
            issueAnalyses.contentHash,
            issueAnalyses.analysisVersion,
          ],
        });
      await tx
        .update(runIssues)
        .set({ status, completedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(runIssues.id, input.item.runIssueId),
          notInArray(runIssues.status, [...terminalItemStatuses]),
        ));
    });
  }
}

function priorityFor(group: Array<{ severity: string; commentsCount: number; updatedAt: Date }>) {
  const boundary=Date.now()-30*24*60*60*1000;
  return provisionalPriority({frequency:group.length,highOrCritical:group.filter((item)=>["high","critical"].includes(item.severity)).length,recent30d:group.filter((item)=>item.updatedAt.getTime()>=boundary).length,comments:group.reduce((sum,item)=>sum+item.commentsCount,0)});
}

function labelCategory(value: string): string {
  return ({ bug: "缺陷", feature_request: "功能建议", documentation: "文档", usage_question: "使用问题", performance: "性能", other: "其他", unknown: "待判断" } as Record<string, string>)[value] ?? value;
}

type TransactionDatabase<TQueryResult extends PgQueryResultHKT> = Parameters<
  Parameters<IssueLensDatabase<TQueryResult>["transaction"]>[0]
>[0];

async function selectWorkItems<TQueryResult extends PgQueryResultHKT>(
  db: TransactionDatabase<TQueryResult>,
  runId: string,
): Promise<AnalysisWorkItem[]> {
  const rows = await db
    .select({ runIssue: runIssues, issue: issues })
    .from(runIssues)
    .innerJoin(issues, eq(runIssues.issueId, issues.id))
    .where(eq(runIssues.runId, runId))
    .orderBy(desc(issues.githubUpdatedAt), desc(issues.issueNumber));
  return rows.map((row) => toWorkItem(
    row.runIssue.id,
    row.runIssue.contentHash,
    row.issue,
  ));
}

type IssueRow = typeof issues.$inferSelect;
type AnalysisRow = typeof issueAnalyses.$inferSelect;

function toWorkItem(
  runIssueId: string,
  contentHash: string,
  issue: IssueRow,
): AnalysisWorkItem {
  return {
    runIssueId,
    contentHash,
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
  };
}

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
