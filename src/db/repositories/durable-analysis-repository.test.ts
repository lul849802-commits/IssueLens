import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalysisProviderError } from "@/adapters/ai/openai-analysis-client";
import { analyzeDurableIssue } from "@/services/analysis/durable-analysis";
import { ANALYSIS_VERSION } from "@/services/analysis/prompt";

import { DrizzleDurableAnalysisRepository } from "./durable-analysis-repository";
import {
  analysisRuns,
  clusterMembers,
  clusters,
  issueAnalyses,
  issues,
  repositories,
  runIssues,
  schema,
} from "../schema";

describe("DrizzleDurableAnalysisRepository", () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  });

  afterEach(async () => client.close());

  it("prepares idempotently, avoids a duplicate provider call, and aggregates partial", async () => {
    const store = new DrizzleDurableAnalysisRepository(db);
    const requested = await store.createRequestedRun({
      repository: { owner: "openai", repo: "openai-node", slug: "openai/openai-node" },
      repositoryHtmlUrl: "https://github.com/openai/openai-node",
      creatorTokenHash: "fixture",
      limit: 3,
      analysisVersion: ANALYSIS_VERSION,
      modelId: "fixture-model",
    });
    const [repository] = await db
      .select()
      .from(repositories);
    for (let number = 1; number <= 3; number += 1) {
      await db.insert(issues).values({
        repositoryId: repository!.id,
        githubIssueId: number,
        issueNumber: number,
        title: `Issue ${number}`,
        body: "Body",
        state: "open",
        htmlUrl: `https://github.com/openai/openai-node/issues/${number}`,
        githubCreatedAt: new Date("2026-01-01T00:00:00Z"),
        githubUpdatedAt: new Date(Date.UTC(2026, 0, number)),
        currentContentHash: String(number).repeat(64),
      });
    }

    await store.markWorkflowStarted(requested.runId, "inngest-run-1");
    const firstPrepare = await store.prepareAnalysis({
      runId: requested.runId,
      limit: 3,
      modelId: "fixture-model",
    });
    const secondPrepare = await store.prepareAnalysis({
      runId: requested.runId,
      limit: 3,
      modelId: "fixture-model",
    });
    expect(firstPrepare).toHaveLength(3);
    expect(secondPrepare).toHaveLength(3);
    expect(await db.select().from(runIssues)).toHaveLength(3);

    const analyze = vi.fn().mockResolvedValue(providerResult);
    await analyzeDurableIssue(
      store,
      { modelId: "fixture-model", analyze },
      firstPrepare[0]!.runIssueId,
    );
    await analyzeDurableIssue(
      store,
      { modelId: "fixture-model", analyze },
      firstPrepare[0]!.runIssueId,
    );
    expect(analyze).toHaveBeenCalledOnce();
    expect(await db.select().from(issueAnalyses)).toHaveLength(1);

    const retryingAnalyze = vi.fn()
      .mockRejectedValueOnce(new AnalysisProviderError("ANALYSIS_RATE_LIMITED", true, 429))
      .mockResolvedValueOnce(providerResult);
    await expect(analyzeDurableIssue(
      store,
      { modelId: "fixture-model", analyze: retryingAnalyze },
      firstPrepare[1]!.runIssueId,
    )).rejects.toMatchObject({ code: "ANALYSIS_RATE_LIMITED", retryable: true });
    await analyzeDurableIssue(
      store,
      { modelId: "fixture-model", analyze: retryingAnalyze },
      firstPrepare[1]!.runIssueId,
    );
    const recoveredItem = (await db.select().from(runIssues))
      .find((row) => row.id === firstPrepare[1]!.runIssueId);
    expect(retryingAnalyze).toHaveBeenCalledTimes(2);
    expect(recoveredItem).toMatchObject({ status: "succeeded", attemptCount: 2 });

    await store.recordFailure(firstPrepare[2]!.runIssueId, "ANALYSIS_REFUSED");
    const clusterItems = await store.prepareClustering(requested.runId);
    expect(clusterItems).toHaveLength(2);
    const clustered = await store.persistSemanticClusters(requested.runId, {
      plan: { clusters: [{
        name: "共同功能异常", summary: "两条成功分析描述同类异常。", suggestedAction: "product",
        memberRunIssueIds: clusterItems.map((item) => item.runIssueId),
      }], unclusteredRunIssueIds: [] },
      providerRequestId: "req_cluster", inputTokens: 80, outputTokens: 30,
      latencyMs: 12, modelId: "fixture-model",
    });
    expect(clustered).toMatchObject({ clusters: 1, members: 2, unclustered: 0, method: "semantic" });
    expect(await db.select().from(clusters)).toHaveLength(1);
    expect(await db.select().from(clusterMembers)).toHaveLength(2);
    const counts = await store.aggregate(requested.runId);

    expect(counts).toEqual({
      total: 3,
      succeeded: 2,
      cached: 0,
      failed: 1,
      status: "partial",
    });
    const [run] = await db.select().from(analysisRuns);
    expect(run).toMatchObject({
      status: "partial",
      totalCount: 3,
      succeededCount: 2,
      failedCount: 1,
      workflowRunId: "inngest-run-1",
    });
  });
});

const providerResult = {
  analysis: {
    category: "bug" as const,
    summary: "功能异常。",
    productArea: "unknown",
    userScenario: "用户使用功能",
    sentiment: "negative" as const,
    severity: "unknown" as const,
    reproducibility: "insufficient" as const,
    suggestedAction: "product" as const,
    rationale: "Issue 报告了异常，但证据有限。",
    confidence: 0.6,
  },
  providerRequestId: "req_fixture",
  inputTokens: 100,
  outputTokens: 50,
  latencyMs: 10,
};
