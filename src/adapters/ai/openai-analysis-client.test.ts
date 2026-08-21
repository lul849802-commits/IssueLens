import { describe, expect, it, vi } from "vitest";

import type { AnalysisIssueInput } from "./analysis-port";
import { OpenAIAnalysisClient } from "./openai-analysis-client";

const issue: AnalysisIssueInput = {
  number: 1,
  title: "App does not open",
  body: "The app shows a blank window after launch.",
  labels: ["bug"],
  state: "open",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  commentsCount: 2,
};

const analysis = {
  category: "bug",
  summary: "应用启动后显示空白窗口。",
  productArea: "桌面端启动",
  userScenario: "用户启动应用",
  sentiment: "negative",
  severity: "high",
  reproducibility: "partial",
  suggestedAction: "product",
  rationale: "Issue 明确描述启动后的空白窗口。",
  confidence: 0.88,
};

describe("OpenAIAnalysisClient", () => {
  it("requests strict Structured Outputs and records provider metadata", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: "resp_fixture",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(analysis) }] }],
      usage: { input_tokens: 100, output_tokens: 50 },
    }), { status: 200, headers: { "x-request-id": "req_fixture" } }));
    const client = new OpenAIAnalysisClient({ apiKey: "test-key", fetch: request });

    const result = await client.analyze(issue);

    const init = request.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "gpt-5-mini",
      store: false,
      text: { format: { type: "json_schema", strict: true, name: "issue_analysis" } },
    });
    expect(body.text.format.schema.additionalProperties).toBe(false);
    expect(result).toMatchObject({
      analysis,
      providerRequestId: "req_fixture",
      inputTokens: 100,
      outputTokens: 50,
    });
  });

  it("retries transient failures but never exposes the response body", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("secret provider diagnostic", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: JSON.stringify(analysis) }), { status: 200 }));
    const client = new OpenAIAnalysisClient({ apiKey: "test-key", fetch: request, sleep: async () => undefined });

    await expect(client.analyze(issue)).resolves.toMatchObject({ analysis });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the API credit balance is exhausted", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { type: "insufficient_quota", code: "credit_balance_exhausted" },
    }), { status: 429 }));
    const client = new OpenAIAnalysisClient({
      apiKey: "test-key",
      fetch: request,
      sleep: async () => undefined,
    });

    await expect(client.analyze(issue)).rejects.toMatchObject({
      code: "ANALYSIS_QUOTA_EXHAUSTED",
      retryable: false,
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("maps a reset connection to a retryable network error", async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("ECONNRESET"));
    const client = new OpenAIAnalysisClient({
      apiKey: "test-key",
      fetch: request,
      sleep: async () => undefined,
    });

    await expect(client.analyze(issue)).rejects.toMatchObject({
      code: "ANALYSIS_NETWORK_ERROR",
      retryable: true,
    });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("isolates refusals and authentication failures as non-retryable", async () => {
    const refusal = new OpenAIAnalysisClient({
      apiKey: "test-key",
      fetch: async () => new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "refusal", refusal: "cannot comply" }] }],
      }), { status: 200 }),
    });
    await expect(refusal.analyze(issue)).rejects.toMatchObject({
      code: "ANALYSIS_REFUSED",
      retryable: false,
    });

    const unauthorized = new OpenAIAnalysisClient({
      apiKey: "test-key",
      fetch: async () => new Response(null, { status: 401 }),
    });
    await expect(unauthorized.analyze(issue)).rejects.toMatchObject({
      code: "ANALYSIS_AUTHENTICATION_FAILED",
      retryable: false,
    });
  });
});
