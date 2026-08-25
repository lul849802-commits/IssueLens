import { describe, expect, it } from "vitest";

import {
  issueProgress,
  pipelineStates,
  runDescription,
  shouldAutoOpenOverview,
} from "@/components/progress-presentation";

describe("progress presentation", () => {
  it("maps durable run states to an honest four-stage pipeline", () => {
    expect(pipelineStates("queued", 0)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(pipelineStates("clustering", 0)).toEqual([
      "complete",
      "complete",
      "active",
      "pending",
    ]);
    expect(pipelineStates("complete", 0)).toEqual([
      "complete",
      "complete",
      "complete",
      "complete",
    ]);
    expect(pipelineStates("partial", 2)).toEqual([
      "complete",
      "partial",
      "complete",
      "complete",
    ]);
  });

  it("never invents a percentage before the Issue total is known", () => {
    expect(issueProgress({ total: 0, succeeded: 0, failed: 0, pending: 0 })).toEqual({
      processed: 0,
      percentage: null,
    });
    expect(issueProgress({ total: 40, succeeded: 22, failed: 2, pending: 16 })).toEqual({
      processed: 24,
      percentage: 60,
    });
  });

  it("uses terminal copy that reflects successful and failed evidence", () => {
    expect(runDescription("complete", {
      total: 37,
      succeeded: 37,
      failed: 0,
      pending: 0,
    })).toContain("37 条 Issue 已完成分析");
    expect(runDescription("partial", {
      total: 37,
      succeeded: 35,
      failed: 2,
      pending: 0,
    })).toContain("35 条 Issue 已形成有效分析，2 条未成功");
  });

  it("only auto-opens a complete, non-empty result with a healthy connection", () => {
    const result = { total: 37, succeeded: 37, failed: 0, pending: 0 };
    expect(shouldAutoOpenOverview("complete", result, false)).toBe(true);
    expect(shouldAutoOpenOverview("partial", result, false)).toBe(false);
    expect(shouldAutoOpenOverview("failed", result, false)).toBe(false);
    expect(shouldAutoOpenOverview("complete", { ...result, total: 0 }, false)).toBe(false);
    expect(shouldAutoOpenOverview("complete", { ...result, succeeded: 0 }, false)).toBe(false);
    expect(shouldAutoOpenOverview("complete", result, true)).toBe(false);
  });
});
