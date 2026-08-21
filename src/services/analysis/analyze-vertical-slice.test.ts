import { describe, expect, it, vi } from "vitest";

import type { AnalysisProviderResult } from "@/adapters/ai/analysis-port";
import { AnalysisProviderError } from "@/adapters/ai/openai-analysis-client";

import {
  analyzeVerticalSlice,
  type AnalysisWorkItem,
  type CachedAnalysis,
  type VerticalSliceStore,
} from "./analyze-vertical-slice";

const validResult: AnalysisProviderResult = {
  analysis: {
    category: "bug",
    summary: "窗口白屏。",
    productArea: "desktop",
    userScenario: "启动应用",
    sentiment: "negative",
    severity: "high",
    reproducibility: "partial",
    suggestedAction: "product",
    rationale: "Issue 描述了启动后的空白窗口。",
    confidence: 0.8,
  },
  providerRequestId: "req_fixture",
  inputTokens: 10,
  outputTokens: 20,
  latencyMs: 100,
};

describe("analyzeVerticalSlice", () => {
  it("uses cache per item and isolates one provider failure", async () => {
    const store = new FakeStore(threeItems(), new Set(["run-1"]));
    const analyze = vi.fn()
      .mockResolvedValueOnce(validResult)
      .mockRejectedValueOnce(new AnalysisProviderError("ANALYSIS_RATE_LIMITED", true, 429));

    const result = await analyzeVerticalSlice(store, { modelId: "fixture-model", analyze }, {
      repositoryId: "repository-1",
      limit: 5,
    });

    expect(analyze).toHaveBeenCalledTimes(2);
    expect(store.cached).toEqual(["run-1"]);
    expect(store.succeeded).toEqual(["run-2"]);
    expect(store.failed).toEqual([{ id: "run-3", code: "ANALYSIS_RATE_LIMITED" }]);
    expect(result).toMatchObject({ total: 3, succeeded: 1, cached: 1, failed: 1, status: "partial" });
  });
});

class FakeStore implements VerticalSliceStore {
  succeeded: string[] = [];
  cached: string[] = [];
  failed: Array<{ id: string; code: string }> = [];

  constructor(
    private readonly items: AnalysisWorkItem[],
    private readonly cacheHits: Set<string>,
  ) {}

  async createRun() { return { runId: "run", items: this.items }; }
  async findCached(item: AnalysisWorkItem): Promise<CachedAnalysis | null> {
    return this.cacheHits.has(item.runIssueId)
      ? { analysis: validResult.analysis, providerRequestId: "req_original" }
      : null;
  }
  async markProcessing() {}
  async recordSuccess(input: { item: AnalysisWorkItem }) { this.succeeded.push(input.item.runIssueId); }
  async recordCached(input: { item: AnalysisWorkItem }) { this.cached.push(input.item.runIssueId); }
  async recordFailure(id: string, code: string) { this.failed.push({ id, code }); }
  async finalize() {
    const failed = this.failed.length;
    const succeeded = this.succeeded.length;
    const cached = this.cached.length;
    return { total: this.items.length, succeeded, cached, failed, status: failed === this.items.length ? "failed" as const : failed ? "partial" as const : "complete" as const };
  }
}

function threeItems(): AnalysisWorkItem[] {
  return [1, 2, 3].map((number) => ({
    runIssueId: `run-${number}`,
    contentHash: String(number).repeat(64),
    issue: {
      number,
      title: `Issue ${number}`,
      body: "Body",
      labels: [],
      state: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      commentsCount: 0,
    },
  }));
}
