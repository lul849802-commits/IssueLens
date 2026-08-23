import { InngestTestEngine } from "@inngest/test";
import { Inngest } from "inngest";
import { describe, expect, it, vi } from "vitest";

import {
  combineClusterResults,
  createAnalyzeRunFunction,
  shardClusterEvidence,
} from "./analyze-run";

describe("analyzeRun Inngest function", () => {
  it("checkpoints setup, analyzes each item, and aggregates", async () => {
    const items = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ].map((runIssueId, index) => ({
      runIssueId,
      contentHash: String(index + 1).repeat(64),
      issue: {
        number: index + 1,
        title: `Issue ${index + 1}`,
        body: "Body",
        labels: [],
        state: "open" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        commentsCount: 0,
      },
    }));
    const store = {
      markWorkflowStarted: vi.fn(),
      prepareAnalysis: vi.fn().mockResolvedValue(items),
      claim: vi.fn().mockImplementation(async (id: string) => ({
        kind: "claimed",
        item: items.find((item) => item.runIssueId === id),
      })),
      findCached: vi.fn().mockResolvedValue(null),
      recordSuccess: vi.fn(),
      recordCached: vi.fn(),
      recordFailure: vi.fn(),
      recordClusterCall: vi.fn(),
      prepareClustering: vi.fn().mockResolvedValue(items.map((item) => ({
        runIssueId: item.runIssueId,
        issueNumber: item.issue.number,
        title: item.issue.title,
        commentsCount: item.issue.commentsCount,
        updatedAt: item.issue.updatedAt,
        analysis: providerResult.analysis,
      }))),
      persistSemanticClusters: vi.fn().mockResolvedValue({ clusters: 1, members: 2, unclustered: 0, method: "semantic" }),
      buildClusters: vi.fn().mockResolvedValue({ clusters: 1, members: 2 }),
      aggregate: vi.fn().mockResolvedValue({
        total: 2,
        succeeded: 2,
        cached: 0,
        failed: 0,
        status: "complete",
      }),
      failRun: vi.fn(),
    };
    const dependencies = {
      store,
      analyzer: {
        modelId: "fixture-model",
        analyze: vi.fn().mockResolvedValue(providerResult),
      },
      clusterer: {
        modelId: "fixture-model",
        cluster: vi.fn().mockResolvedValue({
          plan: { clusters: [{ name: "Related issues", summary: "Two related failures.", suggestedAction: "product", memberRunIssueIds: items.map((item) => item.runIssueId) }], unclusteredRunIssueIds: [] },
          providerRequestId: "req_cluster", inputTokens: 10, outputTokens: 10, latencyMs: 10, modelId: "fixture-model",
        }),
      },
      fetchAndPersist: vi.fn().mockResolvedValue({
        repositoryId: "repository-1",
        issuesAccepted: 2,
        pagesFetched: 1,
      }),
    };
    const fn = createAnalyzeRunFunction(
      new Inngest({ id: "issuelens-test" }),
      () => dependencies as never,
    );
    const test = new InngestTestEngine({ function: fn });

    const { result, ctx } = await test.execute({
      events: [{
        name: "issuelens/run.requested",
        data: {
          runId: "11111111-1111-4111-8111-111111111111",
          repositorySlug: "openai/openai-node",
          limit: 2,
          modelId: "fixture-model",
        },
      }],
    });

    expect(result).toMatchObject({ status: "complete", succeeded: 2 });
    expect(ctx.step.run).toHaveBeenCalledWith("start-run", expect.any(Function));
    expect(ctx.step.run).toHaveBeenCalledWith(
      "fetch-and-persist-issues",
      expect.any(Function),
    );
    expect(ctx.step.run).toHaveBeenCalledWith(
      "prepare-analysis-items",
      expect.any(Function),
    );
    expect(ctx.step.run).toHaveBeenCalledWith("aggregate-run", expect.any(Function));
    expect(ctx.step.run).toHaveBeenCalledWith("prepare-clustering", expect.any(Function));
    expect(ctx.step.run).toHaveBeenCalledWith(
      "cluster-shard-01-attempt-01",
      expect.any(Function),
    );
    expect(ctx.step.run).toHaveBeenCalledWith("persist-semantic-clusters", expect.any(Function));
    expect(dependencies.analyzer.analyze).toHaveBeenCalledTimes(2);
    expect(store.recordSuccess).toHaveBeenCalledTimes(2);
    expect(store.recordClusterCall).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ inputTokens: 10, outputTokens: 10 }),
    );
    expect(store.failRun).not.toHaveBeenCalled();
  });

  it("falls back without losing completed issue analyses when semantic clustering fails", async () => {
    const items = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ].map((runIssueId, index) => ({
      runIssueId, contentHash: String(index + 1).repeat(64), issue: { number: index + 1,
        title: `Issue ${index + 1}`, body: "Body", labels: [], state: "open" as const,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", commentsCount: 0 },
    }));
    const store = { markWorkflowStarted: vi.fn(), prepareAnalysis: vi.fn().mockResolvedValue(items),
      claim: vi.fn().mockImplementation(async (id:string)=>({kind:"claimed",item:items.find((item)=>item.runIssueId===id)})),
      findCached: vi.fn().mockResolvedValue(null), recordSuccess: vi.fn(), recordCached: vi.fn(), recordFailure: vi.fn(),
      recordClusterCall: vi.fn(),
      prepareClustering: vi.fn().mockResolvedValue(items.map((item)=>({runIssueId:item.runIssueId,issueNumber:item.issue.number,title:item.issue.title,commentsCount:0,updatedAt:item.issue.updatedAt,analysis:providerResult.analysis}))),
      persistSemanticClusters: vi.fn(), buildClusters: vi.fn().mockResolvedValue({clusters:2,members:2}),
      aggregate: vi.fn().mockResolvedValue({total:2,succeeded:2,cached:0,failed:0,status:"complete"}), failRun: vi.fn() };
    const dependencies={store,analyzer:{modelId:"fixture-model",analyze:vi.fn().mockResolvedValue(providerResult)},
      clusterer:{modelId:"fixture-model",cluster:vi.fn().mockRejectedValue(new Error("CLUSTER_SCHEMA_INVALID"))},
      fetchAndPersist:vi.fn().mockResolvedValue({repositoryId:"repository-1",issuesAccepted:2,pagesFetched:1})};
    const fn=createAnalyzeRunFunction(new Inngest({id:"issuelens-fallback-test"}),()=>dependencies as never);
    const {result}=await new InngestTestEngine({function:fn}).execute({events:[{name:"issuelens/run.requested",id:"resume-event-1",data:{runId:"11111111-1111-4111-8111-111111111111",repositorySlug:"openai/openai-node",limit:2,modelId:"fixture-model"}}]});
    expect(result).toMatchObject({status:"complete",clusterResult:{method:"fallback",clusters:2,members:2,errorCode:"CLUSTER_ALL_SHARDS_FAILED"}});
    expect(store.buildClusters).toHaveBeenCalled(); expect(store.persistSemanticClusters).not.toHaveBeenCalled(); expect(store.failRun).not.toHaveBeenCalled();
  });

  it("splits large samples and combines shard usage with exact coverage", () => {
    const items = Array.from({ length: 45 }, (_, index) => ({
      runIssueId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      issueNumber: index + 1,
      title: `Issue ${index + 1}`,
      commentsCount: 0,
      updatedAt: "2026-01-02T00:00:00.000Z",
      analysis: providerResult.analysis,
    }));
    const shards = shardClusterEvidence(items);
    expect(shards.map((shard) => shard.length)).toEqual([20, 20, 5]);
    const combined = combineClusterResults(
      items,
      shards.map((shard, index) => ({
        plan: { clusters: [], unclusteredRunIssueIds: shard.map((item) => item.runIssueId) },
        providerRequestId: `req_${index}`,
        inputTokens: 100 + index,
        outputTokens: 20 + index,
        latencyMs: 50,
        modelId: "fixture-model",
      })),
      [],
      "fixture-model",
    );
    expect(combined.plan.unclusteredRunIssueIds).toHaveLength(45);
    expect(combined).toMatchObject({ inputTokens: 303, outputTokens: 63, latencyMs: 150 });
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
