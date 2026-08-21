import { z } from "zod";

import type { RepositoryRef } from "@/domain/repository/repository";

import type {
  GitHubIssuePage,
  GitHubRateLimit,
  GitHubReader,
  GitHubRepositoryMetadata,
} from "./github-port";

export type GitHubErrorCode =
  | "REPOSITORY_NOT_FOUND"
  | "GITHUB_RATE_LIMITED"
  | "GITHUB_UNAUTHORIZED"
  | "GITHUB_UNAVAILABLE"
  | "GITHUB_INVALID_RESPONSE";

export class GitHubApiError extends Error {
  constructor(
    readonly code: GitHubErrorCode,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfterSeconds: number | null = null,
    readonly resetAt: string | null = null,
  ) {
    super(code);
    this.name = "GitHubApiError";
  }
}

export interface GitHubRestClientOptions {
  token?: string;
  fetch?: typeof fetch;
  apiBaseUrl?: string;
  timeoutMs?: number;
}

const repositorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  full_name: z.string().min(3),
  private: z.boolean(),
  html_url: z.url(),
  default_branch: z.string().min(1),
  has_issues: z.boolean(),
  owner: z.object({ login: z.string().min(1) }),
});

const issueSchema = z.object({
  id: z.number().int().positive(),
  number: z.number().int().positive(),
  title: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  state: z.enum(["open", "closed"]),
  labels: z.array(z.union([z.string(), z.object({ name: z.string().nullable().optional() })])),
  comments: z.number().int().nonnegative(),
  user: z.object({ login: z.string().nullable().optional() }).nullable(),
  html_url: z.url(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  pull_request: z.unknown().optional(),
});

const issuePageSchema = z.array(issueSchema);

export class GitHubRestClient implements GitHubReader {
  private readonly request: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: GitHubRestClientOptions = {}) {
    this.request = options.fetch ?? fetch;
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async getRepository(repository: RepositoryRef): Promise<GitHubRepositoryMetadata> {
    const response = await this.get(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`);
    const parsed = repositorySchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.private) {
      throw new GitHubApiError("REPOSITORY_NOT_FOUND", 404, false);
    }

    return {
      githubId: parsed.data.id,
      owner: parsed.data.owner.login,
      name: parsed.data.name,
      slug: parsed.data.full_name.toLowerCase(),
      htmlUrl: parsed.data.html_url,
      defaultBranch: parsed.data.default_branch,
      issuesEnabled: parsed.data.has_issues,
    };
  }

  async listIssues(repository: RepositoryRef, page: number): Promise<GitHubIssuePage> {
    const query = new URLSearchParams({
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: "100",
      page: String(page),
    });
    const response = await this.get(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/issues?${query}`,
    );
    const parsed = issuePageSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new GitHubApiError("GITHUB_INVALID_RESPONSE", 502, true);
    }

    return {
      items: parsed.data,
      nextPage: parseNextPage(response.headers.get("link")),
      rateLimit: readRateLimit(response.headers),
    };
  }

  private async get(path: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.request(`${this.apiBaseUrl}${path}`, {
        method: "GET",
        headers: this.headers(),
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new GitHubApiError("GITHUB_UNAVAILABLE", 502, true);
    }

    if (response.ok) return response;
    const rate = readRateLimit(response.headers);
    const retryAfter = numericHeader(response.headers.get("retry-after"));
    if (
      response.status === 429 ||
      (response.status === 403 && rate.remaining === 0)
    ) {
      throw new GitHubApiError(
        "GITHUB_RATE_LIMITED",
        429,
        true,
        retryAfter,
        rate.resetAt,
      );
    }
    if (response.status === 404) {
      throw new GitHubApiError("REPOSITORY_NOT_FOUND", 404, false);
    }
    if (response.status === 401) {
      throw new GitHubApiError("GITHUB_UNAUTHORIZED", 502, false);
    }
    throw new GitHubApiError("GITHUB_UNAVAILABLE", 502, response.status >= 500);
  }

  private headers(): Headers {
    const headers = new Headers({
      Accept: "application/vnd.github+json",
      "User-Agent": "IssueLens",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    if (this.options.token) headers.set("Authorization", `Bearer ${this.options.token}`);
    return headers;
  }
}

function parseNextPage(link: string | null): number | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    if (!part.includes('rel="next"')) continue;
    const match = part.match(/[?&]page=(\d+)/);
    return match?.[1] ? Number(match[1]) : null;
  }
  return null;
}

function readRateLimit(headers: Headers): GitHubRateLimit {
  const reset = numericHeader(headers.get("x-ratelimit-reset"));
  return {
    limit: numericHeader(headers.get("x-ratelimit-limit")),
    remaining: numericHeader(headers.get("x-ratelimit-remaining")),
    resetAt: reset === null ? null : new Date(reset * 1000).toISOString(),
  };
}

function numericHeader(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
