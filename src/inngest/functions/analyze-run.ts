import type { Inngest } from "inngest";

import {
  analyzeDurableIssue,
  DurableAnalysisError,
} from "@/services/analysis/durable-analysis";
import type {
  ClusterEvidenceItem,
  ClusterProviderResult,
} from "@/adapters/ai/cluster-port";
import { validateClusterPlan } from "@/domain/clustering/cluster-plan";

import { inngest, runRequested } from "../client";
import type { AnalyzeRunDependencies } from "../dependencies";

type DependencyFactory = () => AnalyzeRunDependencies | Promise<AnalyzeRunDependencies>;
export const ANALYSIS_BATCH_SIZE = 10;
export const CLUSTER_SHARD_SIZE = 10;
export const CLUSTER_SHARD_ATTEMPTS = 2;

export function createAnalyzeRunFunction(
  client: Inngest,
  dependencies: DependencyFactory,
) {
  return client.createFunction(
    {
      id: "issuelens-analyze-run",
      name: "IssueLens durable AI analysis",
      triggers: [runRequested],
      idempotency: "event.id",
      concurrency: [
        { limit: 2 },
        { limit: 1, key: "event.data.repositorySlug" },
      ],
      retries: 2,
    },
    async ({ event, step, runId: workflowRunId }) => {
      const deps = await dependencies();
      const { runId, repositorySlug, limit, modelId } = event.data;
      try {
        await step.run("start-run", () =>
          deps.store.markWorkflowStarted(runId, workflowRunId));

        const imported = await step.run("fetch-and-persist-issues", () =>
          deps.fetchAndPersist(repositorySlug, limit));

        const items = await step.run("prepare-analysis-items", () =>
          deps.store.prepareAnalysis({ runId, limit, modelId }));

        const outcomes = [];
        for (let offset = 0; offset < items.length; offset += ANALYSIS_BATCH_SIZE) {
          const chunk = items.slice(offset, offset + ANALYSIS_BATCH_SIZE);
          const chunkNumber = Math.floor(offset / ANALYSIS_BATCH_SIZE) + 1;
          const chunkOutcomes = await step.run(
            `analyze-batch-${String(chunkNumber).padStart(2, "0")}`,
            () => Promise.all(chunk.map(async (item) => {
                try {
                  return await analyzeDurableIssue(
                    deps.store,
                    deps.analyzer,
                    item.runIssueId,
                  );
                } catch (error) {
                  if (error instanceof DurableAnalysisError && !error.retryable) {
                    await deps.store.recordFailure(item.runIssueId, error.code);
                    return {
                      status: "failed" as const,
                      runIssueId: item.runIssueId,
                      code: error.code,
                    };
                  }
                  throw error;
                }
            })),
          );
          outcomes.push(...chunkOutcomes);
        }

        const clusterItems = await step.run("prepare-clustering", () =>
          deps.store.prepareClustering(runId));
        let clusterResult;
        if (clusterItems.length < 2) {
          clusterResult = await step.run("persist-unclustered", () => deps.store.persistSemanticClusters(runId, {
            plan: { clusters: [], unclusteredRunIssueIds: clusterItems.map((item) => item.runIssueId) },
            providerRequestId: null, inputTokens: 0, outputTokens: 0, latencyMs: 0, modelId,
          }));
        } else {
          const semanticResults: ClusterProviderResult[] = [];
          const unclusteredFromFailedShards: string[] = [];
          let failedShards = 0;
          const shards = shardClusterEvidence(clusterItems);
          for (let shardIndex = 0; shardIndex < shards.length; shardIndex += 1) {
            const shard = shards[shardIndex]!;
            const shardKey =
              `cluster-shard-${String(shardIndex + 1).padStart(2, "0")}`;
            let completed = false;
            for (let attempt = 1; attempt <= CLUSTER_SHARD_ATTEMPTS; attempt += 1) {
              const operationKey =
                `${shardKey}-attempt-${String(attempt).padStart(2, "0")}`;
              const outcome = await step.run(operationKey, async () => {
                const started = Date.now();
                try {
                  return {
                    kind: "semantic" as const,
                    result: await deps.clusterer.cluster(shard),
                  };
                } catch (error) {
                  return {
                    kind: "failed" as const,
                    errorCode: clusterErrorCode(error),
                    retryable: clusterRetryable(error),
                    ...clusterFailureMetrics(error, Date.now() - started),
                  };
                }
              });
              await step.run(`record-${operationKey}`, () =>
                deps.store.recordClusterCall(runId, {
                  operationKey,
                  itemCount: shard.length,
                  modelId,
                  status: outcome.kind === "semantic" ? "succeeded" : "failed",
                  providerRequestId: outcome.kind === "semantic"
                    ? outcome.result.providerRequestId
                    : outcome.providerRequestId,
                  inputTokens: outcome.kind === "semantic"
                    ? outcome.result.inputTokens
                    : outcome.inputTokens,
                  outputTokens: outcome.kind === "semantic"
                    ? outcome.result.outputTokens
                    : outcome.outputTokens,
                  latencyMs: outcome.kind === "semantic"
                    ? outcome.result.latencyMs
                    : outcome.latencyMs,
                  errorCode: outcome.kind === "semantic" ? null : outcome.errorCode,
                }));
              if (outcome.kind === "semantic") {
                semanticResults.push(outcome.result);
                completed = true;
                break;
              }
              if (!outcome.retryable) break;
            }
            if (!completed) {
              failedShards += 1;
              unclusteredFromFailedShards.push(
                ...shard.map((item) => item.runIssueId),
              );
            }
          }
          if (semanticResults.length > 0) {
            const combined = combineClusterResults(
              clusterItems,
              semanticResults,
              unclusteredFromFailedShards,
              modelId,
            );
            clusterResult = await step.run("persist-semantic-clusters", () =>
              deps.store.persistSemanticClusters(runId, combined));
            clusterResult = {
              ...clusterResult,
              shards: shards.length,
              semanticShards: semanticResults.length,
              failedShards,
            };
          } else {
            clusterResult = {
              ...await step.run("fallback-clusters", () => deps.store.buildClusters(runId)),
              method: "fallback" as const,
              errorCode: "CLUSTER_ALL_SHARDS_FAILED",
              shards: shards.length,
              semanticShards: 0,
              failedShards,
            };
          }
        }

        const counts = await step.run("aggregate-run", () =>
          deps.store.aggregate(runId));
        return { runId, imported, outcomes, clusterResult, ...counts };
      } catch (error) {
        const code = workflowErrorCode(error);
        await step.run("mark-run-failed", () => deps.store.failRun(runId, code));
        return { runId, status: "failed" as const, code };
      }
    },
  );
}

export function shardClusterEvidence(
  items: readonly ClusterEvidenceItem[],
): ClusterEvidenceItem[][] {
  const shards: ClusterEvidenceItem[][] = [];
  for (let offset = 0; offset < items.length; offset += CLUSTER_SHARD_SIZE) {
    shards.push(items.slice(offset, offset + CLUSTER_SHARD_SIZE));
  }
  return shards;
}

export function combineClusterResults(
  items: readonly ClusterEvidenceItem[],
  results: readonly ClusterProviderResult[],
  additionalUnclustered: readonly string[],
  modelId: string,
): ClusterProviderResult {
  const plan = validateClusterPlan({
    clusters: results.flatMap((result) => result.plan.clusters),
    unclusteredRunIssueIds: [
      ...results.flatMap((result) => result.plan.unclusteredRunIssueIds),
      ...additionalUnclustered,
    ],
  }, items.map((item) => item.runIssueId));
  return {
    plan,
    providerRequestId: null,
    inputTokens: results.reduce(
      (sum, result) => sum + (result.inputTokens ?? 0),
      0,
    ),
    outputTokens: results.reduce(
      (sum, result) => sum + (result.outputTokens ?? 0),
      0,
    ),
    latencyMs: results.reduce((sum, result) => sum + result.latencyMs, 0),
    modelId,
  };
}

function clusterErrorCode(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("CLUSTER_")) return error.message;
  return "CLUSTER_SEMANTIC_FAILED";
}

function clusterRetryable(error: unknown): boolean {
  return error instanceof Error &&
    "retryable" in error &&
    error.retryable === true;
}

function clusterFailureMetrics(error: unknown, fallbackLatencyMs: number) {
  if (error instanceof Error && "metrics" in error) {
    const metrics = error.metrics as {
      providerRequestId?: unknown;
      inputTokens?: unknown;
      outputTokens?: unknown;
      latencyMs?: unknown;
    };
    return {
      providerRequestId: typeof metrics.providerRequestId === "string"
        ? metrics.providerRequestId
        : null,
      inputTokens: typeof metrics.inputTokens === "number"
        ? metrics.inputTokens
        : null,
      outputTokens: typeof metrics.outputTokens === "number"
        ? metrics.outputTokens
        : null,
      latencyMs: typeof metrics.latencyMs === "number"
        ? metrics.latencyMs
        : fallbackLatencyMs,
    };
  }
  return {
    providerRequestId: null,
    inputTokens: null,
    outputTokens: null,
    latencyMs: fallbackLatencyMs,
  };
}

function workflowErrorCode(error: unknown): string {
  if (error instanceof Error && [
    "RUN_NOT_FOUND",
    "ISSUES_DISABLED_OR_EMPTY",
    "OPENAI_API_KEY_REQUIRED",
    "GITHUB_REPOSITORY_NOT_FOUND",
    "GITHUB_RATE_LIMITED",
  ].includes(error.message)) {
    return error.message;
  }
  return "WORKFLOW_FAILED";
}

export const analyzeRun = createAnalyzeRunFunction(
  inngest,
  async () => {
    const { createAnalyzeRunDependencies } = await import("../dependencies");
    return createAnalyzeRunDependencies();
  },
);
