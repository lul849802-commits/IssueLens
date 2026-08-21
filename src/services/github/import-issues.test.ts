import { describe, expect, it } from "vitest";

import type { GitHubIssueLike } from "@/domain/issues/issue";

import { importGitHubIssues, IssuesDisabledOrEmptyError } from "./import-issues";

const repositoryRef = { owner: "fixture", repo: "repo", slug: "fixture/repo" };
const repository = {
  githubId: 1,
  owner: "fixture",
  name: "repo",
  slug: "fixture/repo",
  htmlUrl: "https://github.com/fixture/repo",
  defaultBranch: "main",
  issuesEnabled: true,
};

describe("importGitHubIssues", () => {
  it.each([
    ["vercel/next.js", 300, 170, 3],
    ["openai/openai-node", 700, 570, 7],
    ["microsoft/vscode", 200, 79, 2],
  ])("reproduces the %s pagination and PR-filtering evidence", async (_slug, rawCount, prCount, pages) => {
    const items = Array.from({ length: rawCount }, (_, index) => issue(index + 1, index < prCount));
    const reader = fixtureReader(items);
    const result = await importGitHubIssues(reader, repositoryRef, { limit: 100 });

    expect(result.counts).toEqual({
      pagesFetched: pages,
      rawItems: rawCount,
      pullRequestsExcluded: prCount,
      duplicatesExcluded: 0,
      issuesAccepted: 100,
    });
  });

  it("supports the five-issue development mode", async () => {
    const result = await importGitHubIssues(
      fixtureReader(Array.from({ length: 10 }, (_, index) => issue(index + 1, false))),
      repositoryRef,
      { limit: 5 },
    );
    expect(result.issues).toHaveLength(5);
    expect(result.counts.pagesFetched).toBe(1);
  });

  it("reports disabled or empty issue sources", async () => {
    await expect(
      importGitHubIssues({ ...fixtureReader([]), getRepository: async () => ({ ...repository, issuesEnabled: false }) }, repositoryRef),
    ).rejects.toBeInstanceOf(IssuesDisabledOrEmptyError);
    await expect(importGitHubIssues(fixtureReader([]), repositoryRef)).rejects.toBeInstanceOf(IssuesDisabledOrEmptyError);
  });
});

function fixtureReader(items: GitHubIssueLike[]) {
  return {
    getRepository: async () => repository,
    listIssues: async (_repository: typeof repositoryRef, page: number) => ({
      items: items.slice((page - 1) * 100, page * 100),
      nextPage: page * 100 < items.length ? page + 1 : null,
      rateLimit: { limit: 60, remaining: 59 - page, resetAt: null },
    }),
  };
}

function issue(number: number, pullRequest: boolean): GitHubIssueLike {
  return {
    id: number,
    number,
    title: `Issue ${number}`,
    body: `Body ${number}`,
    state: number % 2 ? "open" : "closed",
    labels: [{ name: "fixture" }],
    comments: number % 4,
    user: { login: "fixture" },
    html_url: `https://github.com/fixture/repo/issues/${number}`,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, number)).toISOString(),
    ...(pullRequest ? { pull_request: {} } : {}),
  };
}
