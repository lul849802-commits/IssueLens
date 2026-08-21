import { describe, expect, it, vi } from "vitest";

import { GitHubApiError, GitHubRestClient } from "./github-client";

const repository = { owner: "openai", repo: "openai-node", slug: "openai/openai-node" };

describe("GitHubRestClient", () => {
  it("uses the versioned read-only API contract and optional bearer token", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(repositoryPayload()),
    );
    const result = await new GitHubRestClient({ token: "test-token", fetch: request }).getRepository(repository);

    expect(result).toMatchObject({ slug: repository.slug, issuesEnabled: true });
    const init = request.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe("GET");
    expect(headers.get("authorization")).toBe("Bearer test-token");
    expect(headers.get("x-github-api-version")).toBe("2022-11-28");
  });

  it("parses issue pagination and rate-limit headers without a token", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json([issuePayload(1)], {
        headers: {
          link: '<https://api.github.com/repositories/1/issues?page=2>; rel="next"',
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "59",
          "x-ratelimit-reset": "1800000000",
        },
      }),
    );
    const page = await new GitHubRestClient({ fetch: request }).listIssues(repository, 1);

    expect(page.nextPage).toBe(2);
    expect(page.rateLimit).toMatchObject({ limit: 60, remaining: 59 });
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).has("authorization")).toBe(false);
  });

  it("maps not-found, rate-limit and invalid responses to stable errors", async () => {
    const notFound = new GitHubRestClient({ fetch: vi.fn().mockResolvedValue(new Response(null, { status: 404 })) });
    await expect(notFound.getRepository(repository)).rejects.toMatchObject({ code: "REPOSITORY_NOT_FOUND", retryable: false });

    const limited = new GitHubRestClient({
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 403, headers: { "x-ratelimit-remaining": "0" } })),
    });
    await expect(limited.getRepository(repository)).rejects.toMatchObject({ code: "GITHUB_RATE_LIMITED", status: 429 });

    const invalid = new GitHubRestClient({ fetch: vi.fn().mockResolvedValue(Response.json({ nope: true })) });
    await expect(invalid.getRepository(repository)).rejects.toBeInstanceOf(GitHubApiError);
  });
});

function repositoryPayload() {
  return {
    id: 1,
    name: "openai-node",
    full_name: "openai/openai-node",
    private: false,
    html_url: "https://github.com/openai/openai-node",
    default_branch: "master",
    has_issues: true,
    owner: { login: "openai" },
  };
}

function issuePayload(number: number) {
  return {
    id: number,
    number,
    title: `Issue ${number}`,
    body: "body",
    state: "open",
    labels: [],
    comments: 0,
    user: { login: "fixture" },
    html_url: `https://github.com/openai/openai-node/issues/${number}`,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  };
}
