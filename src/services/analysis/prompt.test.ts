import { describe, expect, it } from "vitest";

import type { AnalysisIssueInput } from "@/adapters/ai/analysis-port";

import { MAX_BODY_CODE_POINTS, prepareAnalysisInput, serializeIssueForPrompt } from "./prompt";

const baseIssue: AnalysisIssueInput = {
  number: 42,
  title: "窗口白屏",
  body: "复现步骤",
  labels: ["bug"],
  state: "open",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  commentsCount: 3,
};

describe("analysis prompt input", () => {
  it("keeps short issue bodies unchanged", () => {
    expect(prepareAnalysisInput(baseIssue)).toEqual({
      issue: baseIssue,
      inputTruncated: false,
    });
  });

  it("keeps 8,000 leading and 4,000 trailing Unicode code points", () => {
    const prepared = prepareAnalysisInput({
      ...baseIssue,
      body: `A${"😀".repeat(MAX_BODY_CODE_POINTS)}Z`,
    });

    expect(prepared.inputTruncated).toBe(true);
    expect(prepared.issue.body).toContain("[内容已截断]");
    expect(prepared.issue.body.startsWith(`A${"😀".repeat(7_999)}`)).toBe(true);
    expect(prepared.issue.body.endsWith(`${"😀".repeat(3_999)}Z`)).toBe(true);
  });

  it("serializes only the frozen public Issue fields", () => {
    expect(Object.keys(JSON.parse(serializeIssueForPrompt(baseIssue)))).toEqual([
      "issueNumber",
      "title",
      "body",
      "labels",
      "state",
      "createdAt",
      "updatedAt",
      "commentsCount",
    ]);
  });
});
