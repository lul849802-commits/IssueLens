import { describe, expect, it } from "vitest";

import {
  issueContentHash,
  normalizeIssues,
  type GitHubIssueLike,
} from "./issue";

const rawIssues: GitHubIssueLike[] = [
  {
    id: 1,
    number: 1,
    title: "old",
    body: null,
    state: "open",
    labels: [],
    comments: 0,
    user: { login: "a" },
    html_url: "https://example.com/1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  },
  {
    id: 2,
    number: 2,
    title: "pr",
    state: "open",
    updated_at: "2026-01-03T00:00:00Z",
    pull_request: {},
  },
  {
    id: 3,
    number: 3,
    title: "new",
    body: "body",
    state: "closed",
    labels: [{ name: "bug" }, { name: null }],
    comments: 2,
    user: { login: "b" },
    html_url: "https://example.com/3",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-04T00:00:00Z",
  },
  {
    id: 3,
    number: 3,
    title: "duplicate",
    state: "closed",
    updated_at: "2026-01-04T00:00:00Z",
  },
];

describe("normalizeIssues", () => {
  it("excludes pull requests, deduplicates and sorts newest first", () => {
    const result = normalizeIssues(rawIssues);

    expect(result.issues.map((issue) => issue.number)).toEqual([3, 1]);
    expect(result.pullRequestsExcluded).toBe(1);
    expect(result.duplicatesExcluded).toBe(1);
    expect(result.issues[0]?.labels).toEqual(["bug"]);
  });

  it("caps the selected sample at 100 and accepts a smaller explicit limit", () => {
    expect(normalizeIssues(rawIssues, 1).issues).toHaveLength(1);
    expect(normalizeIssues(rawIssues, -1).issues).toHaveLength(0);
  });

  it("normalizes optional GitHub fields and tolerates an invalid timestamp", () => {
    const result = normalizeIssues([
      {
        id: 9,
        number: 9,
        state: "open",
        labels: ["triage"],
        user: null,
        updated_at: "not-a-date",
      },
    ]);

    expect(result.issues[0]).toMatchObject({
      title: "",
      body: "",
      labels: ["triage"],
      commentsCount: 0,
      authorLogin: null,
      htmlUrl: "",
      createdAt: "",
    });
  });
});

describe("issueContentHash", () => {
  const base = {
    title: "a",
    body: "b",
    labels: ["bug", "p1"],
    state: "open",
    commentsCount: 1,
    updatedAt: "2026-01-01",
  };

  it("is stable across label ordering", () => {
    expect(issueContentHash(base)).toBe(
      issueContentHash({ ...base, labels: ["p1", "bug"] }),
    );
  });

  it("changes when model-relevant content changes", () => {
    expect(issueContentHash(base)).not.toBe(
      issueContentHash({ ...base, body: "changed" }),
    );
  });
});
