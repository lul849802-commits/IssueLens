import { describe, expect, it, vi } from "vitest";

import { AnalysisProviderError } from "@/adapters/ai/openai-analysis-client";

import {
  analyzeDurableIssue,
  type DurableAnalysisStore,
} from "./durable-analysis";

const item = {
  runIssueId: "run-issue-1",
  contentHash: "a".repeat(64),
  issue: {
    number: 1,
    title: "Window is blank",
    body: "The desktop window is blank after launch.",
    labels: ["bug"],
    state: "open" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    commentsCount: 2,
  },
};

const result = {
  analysis: {
    category: "bug" as const,
    summary: "启动后窗口空白。",
    productArea: "desktop",
    userScenario: "启动应用",
    sentiment: "negative" as const,
    severity: "high" as const,
    reproducibility: "clear" as const,
    suggestedAction: "product" as const,
    rationale: "Issue 明确描述了启动后的空白窗口。",
    confidence: 0.9,
  },
  providerRequestId: "req_1",
  inputTokens: 100,
  outputTokens: 50,
  latencyMs: 200,
};

describe("analyzeDurableIssue", () => {
  it("does not call the provider again when the item is already terminal", async () => {
    const store = fakeStore();
    store.claim = vi.fn().mockResolvedValue({ kind: "terminal", status: "succeeded" });
    const analyze = vi.fn();

    const outcome = await analyzeDurableIssue(
      store,
      { modelId: "fixture", analyze },
      item.runIssueId,
    );

    expect(outcome.status).toBe("already_terminal");
    expect(analyze).not.toHaveBeenCalled();
  });

  it("records a cache hit without calling the provider", async () => {
    const store = fakeStore();
    store.findCached = vi.fn().mockResolvedValue({
      analysis: result.analysis,
      providerRequestId: "req_original",
    });
    const analyze = vi.fn();

    const outcome = await analyzeDurableIssue(
      store,
      { modelId: "fixture", analyze },
      item.runIssueId,
    );

    expect(outcome.status).toBe("skipped_cached");
    expect(store.recordCached).toHaveBeenCalledOnce();
    expect(analyze).not.toHaveBeenCalled();
  });

  it("preserves retryability for the durable runner", async () => {
    const store = fakeStore();
    const analyze = vi.fn().mockRejectedValue(
      new AnalysisProviderError("ANALYSIS_RATE_LIMITED", true, 429),
    );

    await expect(analyzeDurableIssue(
      store,
      { modelId: "fixture", analyze },
      item.runIssueId,
    )).rejects.toMatchObject({
      name: "DurableAnalysisError",
      code: "ANALYSIS_RATE_LIMITED",
      retryable: true,
    });
  });
});

function fakeStore(): DurableAnalysisStore {
  return {
    markWorkflowStarted: vi.fn(),
    prepareAnalysis: vi.fn(),
    claim: vi.fn().mockResolvedValue({ kind: "claimed", item }),
    findCached: vi.fn().mockResolvedValue(null),
    recordSuccess: vi.fn(),
    recordCached: vi.fn(),
    recordFailure: vi.fn(),
    aggregate: vi.fn(),
    failRun: vi.fn(),
  };
}
