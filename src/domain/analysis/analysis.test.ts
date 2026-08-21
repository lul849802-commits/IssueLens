import { describe, expect, it } from "vitest";

import { validateIssueAnalysis } from "./analysis";

const validAnalysis = {
  category: "bug",
  summary: "启动后窗口白屏。",
  productArea: "desktop",
  userScenario: "重新打开应用",
  sentiment: "negative",
  severity: "high",
  reproducibility: "partial",
  suggestedAction: "product",
  rationale: "用户描述了已有能力无法正常显示。",
  confidence: 0.82,
};

describe("issueAnalysisSchema", () => {
  it("accepts the frozen P0 contract", () => {
    expect(validateIssueAnalysis(validAnalysis).success).toBe(true);
  });

  it.each([
    { ...validAnalysis, severity: "urgent" },
    { ...validAnalysis, confidence: 1.1 },
    { ...validAnalysis, summary: "" },
    { ...validAnalysis, hiddenChainOfThought: "secret" },
  ])("rejects invalid or unexpected model output", (value) => {
    expect(validateIssueAnalysis(value).success).toBe(false);
  });
});
