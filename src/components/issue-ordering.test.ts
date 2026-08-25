import { describe, expect, it } from "vitest";

import { issueNeedsReview, sortRunIssues } from "@/components/issue-ordering";

function item(number: number, severity: string, updatedAt: string, category = "bug") {
  return {
    issue: { issueNumber: number, githubUpdatedAt: new Date(updatedAt) },
    effective: { severity, category },
  };
}

describe("Issue result ordering", () => {
  it("puts critical and high evidence before review, medium, and low", () => {
    const result = sortRunIssues([
      item(1, "low", "2026-08-25"),
      item(2, "unknown", "2026-08-25"),
      item(3, "medium", "2026-08-25"),
      item(4, "high", "2026-08-25"),
      item(5, "critical", "2026-08-25"),
    ], "recommended");
    expect(result.map((entry) => entry.issue.issueNumber)).toEqual([5, 4, 2, 3, 1]);
  });

  it("treats an unknown category as needing review", () => {
    expect(issueNeedsReview(item(1, "medium", "2026-08-25", "unknown"))).toBe(true);
  });

  it("uses recency and Issue number as stable tie breakers", () => {
    const result = sortRunIssues([
      item(4, "low", "2026-08-24"),
      item(3, "low", "2026-08-25"),
      item(7, "low", "2026-08-25"),
    ], "recent");
    expect(result.map((entry) => entry.issue.issueNumber)).toEqual([7, 3, 4]);
  });

  it("does not mutate the query result", () => {
    const source = [item(1, "low", "2026-08-25"), item(2, "high", "2026-08-24")];
    sortRunIssues(source, "recommended");
    expect(source.map((entry) => entry.issue.issueNumber)).toEqual([1, 2]);
  });
});
