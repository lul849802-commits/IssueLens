import { NonRetriableError, type Inngest } from "inngest";

import {
  analyzeDurableIssue,
  durableErrorCode,
  DurableAnalysisError,
} from "@/services/analysis/durable-analysis";

import { inngest, runRequested } from "../client";
import type { AnalyzeRunDependencies } from "../dependencies";

type DependencyFactory = () => AnalyzeRunDependencies | Promise<AnalyzeRunDependencies>;

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
        for (let offset = 0; offset < items.length; offset += 5) {
          const chunk = items.slice(offset, offset + 5);
          const chunkOutcomes = await Promise.all(chunk.map(async (item) => {
            try {
              return await step.run(`analyze-issue-${item.runIssueId}`, async () => {
                try {
                  return await analyzeDurableIssue(
                    deps.store,
                    deps.analyzer,
                    item.runIssueId,
                  );
                } catch (error) {
                  if (error instanceof DurableAnalysisError && !error.retryable) {
                    throw new NonRetriableError(error.code);
                  }
                  throw error;
                }
              });
            } catch (error) {
              const code = durableErrorCode(error);
              await step.run(`record-failure-${item.runIssueId}`, () =>
                deps.store.recordFailure(item.runIssueId, code));
              return { status: "failed" as const, runIssueId: item.runIssueId, code };
            }
          }));
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
          const outcome = await step.run("cluster-repository", async () => {
            try {
              return { kind: "semantic" as const, result: await deps.clusterer.cluster(clusterItems) };
            } catch (error) {
              return { kind: "fallback" as const, errorCode: clusterErrorCode(error) };
            }
          });
          if (outcome.kind === "semantic") {
            clusterResult = await step.run("persist-semantic-clusters", () =>
              deps.store.persistSemanticClusters(runId, outcome.result));
          } else {
            clusterResult = {
              ...await step.run("fallback-clusters", () => deps.store.buildClusters(runId)),
              method: "fallback" as const,
              errorCode: outcome.errorCode,
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

function clusterErrorCode(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("CLUSTER_")) return error.message;
  return "CLUSTER_SEMANTIC_FAILED";
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
