import { describe, expect, it } from "vitest";

import { GitHubApiError } from "@/adapters/github/github-client";

import { createValidateRepositoryHandler } from "./validate-repository";

const metadata = {
  githubId: 1,
  owner: "OpenAI",
  name: "openai-node",
  slug: "openai/openai-node",
  htmlUrl: "https://github.com/openai/openai-node",
  defaultBranch: "master",
  issuesEnabled: true,
};

describe("repository validation handler", () => {
  it("normalizes and validates a public repository", async () => {
    const response = await createValidateRepositoryHandler(reader())(
      jsonRequest({ repository: "https://github.com/OpenAI/openai-node" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { repository: metadata } });
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("rejects malformed bodies and repository inputs", async () => {
    const handler = createValidateRepositoryHandler(reader());
    expect((await handler(new Request("http://local", { method: "POST", body: "{}" }))).status).toBe(415);
    const response = await handler(jsonRequest({ repository: "not-a-repo" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({ code: "INVALID_REPOSITORY", retryable: false });
  });

  it("maps provider not-found and rate-limit errors without leaking details", async () => {
    const notFound = createValidateRepositoryHandler(reader(new GitHubApiError("REPOSITORY_NOT_FOUND", 404, false)));
    expect((await notFound(jsonRequest({ repository: "a/b" }))).status).toBe(404);

    const limited = createValidateRepositoryHandler(reader(new GitHubApiError("GITHUB_RATE_LIMITED", 429, true)));
    const response = await limited(jsonRequest({ repository: "a/b" }));
    expect(response.status).toBe(429);
    expect((await response.json()).error).toMatchObject({ code: "GITHUB_RATE_LIMITED", retryable: true });
  });
});

function reader(error?: Error) {
  return {
    getRepository: async () => {
      if (error) throw error;
      return metadata;
    },
    listIssues: async () => ({ items: [], nextPage: null, rateLimit: { limit: null, remaining: null, resetAt: null } }),
  };
}

function jsonRequest(body: unknown) {
  return new Request("http://local/api/repositories/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
