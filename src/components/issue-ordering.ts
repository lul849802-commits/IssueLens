export type IssueSort = "recommended" | "recent";

interface SortableIssue {
  issue: {
    githubUpdatedAt: Date;
    issueNumber: number;
  };
  effective: {
    category: string;
    severity: string;
  } | null;
}

const recommendedRank: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 3,
  low: 4,
  unknown: 5,
};

export function issueNeedsReview(issue: SortableIssue): boolean {
  return issue.effective?.category === "unknown" || issue.effective?.severity === "unknown";
}

export function sortRunIssues<T extends SortableIssue>(issues: readonly T[], sort: IssueSort): T[] {
  return [...issues].sort((left, right) => {
    if (sort === "recommended") {
      const rankDifference = recommendationRank(left) - recommendationRank(right);
      if (rankDifference !== 0) return rankDifference;
    }

    const updatedDifference = right.issue.githubUpdatedAt.getTime() - left.issue.githubUpdatedAt.getTime();
    return updatedDifference || right.issue.issueNumber - left.issue.issueNumber;
  });
}

function recommendationRank(issue: SortableIssue): number {
  if (issueNeedsReview(issue) && !["critical", "high"].includes(issue.effective?.severity ?? "")) return 2;
  return recommendedRank[issue.effective?.severity ?? "unknown"] ?? 5;
}
