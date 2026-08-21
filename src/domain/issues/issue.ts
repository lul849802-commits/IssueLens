import { createHash } from "node:crypto";

export interface GitHubIssueLike {
  id: number;
  number: number;
  title?: string | null;
  body?: string | null;
  state: string;
  labels?: Array<string | { name?: string | null }>;
  comments?: number;
  user?: { login?: string | null } | null;
  html_url?: string;
  created_at?: string;
  updated_at: string;
  pull_request?: unknown;
}

export interface NormalizedIssue {
  githubId: number;
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  commentsCount: number;
  authorLogin: string | null;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  contentHash: string;
}

export type HashableIssue = Pick<
  NormalizedIssue,
  "title" | "body" | "labels" | "state" | "commentsCount" | "updatedAt"
>;

export interface NormalizationResult {
  issues: NormalizedIssue[];
  pullRequestsExcluded: number;
  duplicatesExcluded: number;
}

export function issueContentHash(issue: HashableIssue): string {
  const stableContent = JSON.stringify({
    title: issue.title,
    body: issue.body,
    labels: [...issue.labels].sort(),
    state: issue.state,
    commentsCount: issue.commentsCount,
    updatedAt: issue.updatedAt,
  });

  return createHash("sha256").update(stableContent).digest("hex");
}

export function normalizeIssues(
  items: readonly GitHubIssueLike[],
  limit = 100,
): NormalizationResult {
  const safeLimit = Math.min(100, Math.max(0, Math.trunc(limit)));
  const byNumber = new Map<number, Omit<NormalizedIssue, "contentHash">>();
  let pullRequestsExcluded = 0;

  for (const item of items) {
    if (item.pull_request !== undefined) {
      pullRequestsExcluded += 1;
      continue;
    }

    if (byNumber.has(item.number)) continue;

    const labels = (item.labels ?? [])
      .map((label) => (typeof label === "string" ? label : label.name))
      .filter((label): label is string => Boolean(label));

    byNumber.set(item.number, {
      githubId: item.id,
      number: item.number,
      title: item.title ?? "",
      body: item.body ?? "",
      state: item.state,
      labels,
      commentsCount: item.comments ?? 0,
      authorLogin: item.user?.login ?? null,
      htmlUrl: item.html_url ?? "",
      createdAt: item.created_at ?? "",
      updatedAt: item.updated_at,
    });
  }

  const issues = [...byNumber.values()]
    .sort((a, b) => safeTimestamp(b.updatedAt) - safeTimestamp(a.updatedAt))
    .slice(0, safeLimit)
    .map((issue) => ({ ...issue, contentHash: issueContentHash(issue) }));

  return {
    issues,
    pullRequestsExcluded,
    duplicatesExcluded: items.length - pullRequestsExcluded - byNumber.size,
  };
}

function safeTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
