import type { GitHubIssueLike } from "@/domain/issues/issue";
import type { RepositoryRef } from "@/domain/repository/repository";

export interface GitHubIssuePage {
  items: GitHubIssueLike[];
  nextPage: number | null;
  rateLimit: GitHubRateLimit;
}

export interface GitHubRateLimit {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
}

export interface GitHubRepositoryMetadata {
  githubId: number;
  owner: string;
  name: string;
  slug: string;
  htmlUrl: string;
  defaultBranch: string;
  issuesEnabled: boolean;
}

export interface GitHubReader {
  getRepository(repository: RepositoryRef): Promise<GitHubRepositoryMetadata>;
  listIssues(repository: RepositoryRef, page: number): Promise<GitHubIssuePage>;
}
