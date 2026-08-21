import type {
  GitHubRateLimit,
  GitHubReader,
  GitHubRepositoryMetadata,
} from "@/adapters/github/github-port";
import {
  normalizeIssues,
  type GitHubIssueLike,
  type NormalizedIssue,
} from "@/domain/issues/issue";
import type { RepositoryRef } from "@/domain/repository/repository";

export class IssuesDisabledOrEmptyError extends Error {
  constructor() {
    super("ISSUES_DISABLED_OR_EMPTY");
    this.name = "IssuesDisabledOrEmptyError";
  }
}

export interface GitHubImportResult {
  repository: GitHubRepositoryMetadata;
  issues: NormalizedIssue[];
  counts: {
    pagesFetched: number;
    rawItems: number;
    pullRequestsExcluded: number;
    duplicatesExcluded: number;
    issuesAccepted: number;
  };
  rateLimit: GitHubRateLimit;
}

export async function importGitHubIssues(
  reader: GitHubReader,
  repositoryRef: RepositoryRef,
  options: { limit?: number; maxPages?: number } = {},
): Promise<GitHubImportResult> {
  const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 100)));
  const maxPages = Math.min(10, Math.max(1, Math.trunc(options.maxPages ?? 10)));
  const repository = await reader.getRepository(repositoryRef);
  if (!repository.issuesEnabled) throw new IssuesDisabledOrEmptyError();

  const raw: GitHubIssueLike[] = [];
  let page = 1;
  let pagesFetched = 0;
  let rateLimit: GitHubRateLimit = { limit: null, remaining: null, resetAt: null };
  let normalized = normalizeIssues(raw, limit);

  while (pagesFetched < maxPages) {
    const result = await reader.listIssues(repositoryRef, page);
    pagesFetched += 1;
    raw.push(...result.items);
    rateLimit = result.rateLimit;
    normalized = normalizeIssues(raw, limit);
    if (normalized.issues.length >= limit || result.nextPage === null) break;
    page = result.nextPage;
  }

  if (normalized.issues.length === 0) throw new IssuesDisabledOrEmptyError();
  return {
    repository,
    issues: normalized.issues,
    counts: {
      pagesFetched,
      rawItems: raw.length,
      pullRequestsExcluded: normalized.pullRequestsExcluded,
      duplicatesExcluded: normalized.duplicatesExcluded,
      issuesAccepted: normalized.issues.length,
    },
    rateLimit,
  };
}
