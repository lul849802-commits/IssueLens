import { z } from "zod";

import {
  issueAnalysisSchema,
} from "@/domain/analysis/analysis";
import {
  ISSUE_ANALYSIS_INSTRUCTIONS,
  serializeIssueForPrompt,
} from "@/services/analysis/prompt";

import type {
  AnalysisIssueInput,
  AnalysisProviderResult,
  IssueAnalyzer,
} from "./analysis-port";

export type AnalysisProviderErrorCode =
  | "ANALYSIS_AUTHENTICATION_FAILED"
  | "ANALYSIS_RATE_LIMITED"
  | "ANALYSIS_QUOTA_EXHAUSTED"
  | "ANALYSIS_NETWORK_ERROR"
  | "ANALYSIS_PROVIDER_ERROR"
  | "ANALYSIS_SCHEMA_INVALID"
  | "ANALYSIS_REFUSED"
  | "ANALYSIS_CONTENT_FILTERED";

export class AnalysisProviderError extends Error {
  constructor(
    readonly code: AnalysisProviderErrorCode,
    readonly retryable: boolean,
    readonly status: number | null = null,
  ) {
    super(code);
    this.name = "AnalysisProviderError";
  }
}

export interface OpenAIAnalysisClientOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  apiBaseUrl?: string;
  timeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
}

const responseSchema = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  incomplete_details: z.object({ reason: z.string().nullable().optional() }).nullable().optional(),
  output_text: z.string().optional(),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({
      type: z.string(),
      text: z.string().optional(),
      refusal: z.string().optional(),
    }).passthrough()).optional(),
  }).passthrough()).optional(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
  }).optional(),
}).passthrough();

const providerErrorSchema = z.object({
  error: z.object({
    type: z.string().optional(),
    code: z.string().optional(),
  }),
});

const structuredOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string", enum: ["bug", "feature_request", "documentation", "usage_question", "performance", "other", "unknown"] },
    summary: { type: "string" },
    productArea: { type: "string" },
    userScenario: { type: "string" },
    sentiment: { type: "string", enum: ["positive", "neutral", "negative", "unknown"] },
    severity: { type: "string", enum: ["low", "medium", "high", "critical", "unknown"] },
    reproducibility: { type: "string", enum: ["clear", "partial", "insufficient", "not_applicable"] },
    suggestedAction: { type: "string", enum: ["product", "documentation", "operations", "community", "research"] },
    rationale: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["category", "summary", "productArea", "userScenario", "sentiment", "severity", "reproducibility", "suggestedAction", "rationale", "confidence"],
} as const;

export class OpenAIAnalysisClient implements IssueAnalyzer {
  readonly modelId: string;
  private readonly request: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: OpenAIAnalysisClientOptions) {
    if (!options.apiKey.trim()) throw new Error("OPENAI_API_KEY_REQUIRED");
    this.modelId = options.model ?? "gpt-5-mini";
    this.request = options.fetch ?? fetch;
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async analyze(input: AnalysisIssueInput): Promise<AnalysisProviderResult> {
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        return await this.requestAnalysis(input);
      } catch (error) {
        if (!(error instanceof AnalysisProviderError)) throw error;
        const maxAttempts = this.options.maxAttempts ??
          (error.code === "ANALYSIS_SCHEMA_INVALID" ? 2 : 3);
        if (!error.retryable || attempt >= maxAttempts) throw error;
        await this.sleep(250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100));
      }
    }
  }

  private async requestAnalysis(input: AnalysisIssueInput): Promise<AnalysisProviderResult> {
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await this.request(`${this.apiBaseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.modelId,
          store: false,
          input: [
            { role: "developer", content: ISSUE_ANALYSIS_INSTRUCTIONS },
            { role: "user", content: serializeIssueForPrompt(input) },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "issue_analysis",
              description: "A traceable product analysis of one public GitHub Issue.",
              strict: true,
              schema: structuredOutputSchema,
            },
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AnalysisProviderError("ANALYSIS_NETWORK_ERROR", true);
    }

    if (!response.ok) throw await mapHttpError(response);
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new AnalysisProviderError("ANALYSIS_SCHEMA_INVALID", true, response.status);
    }
    const envelope = responseSchema.safeParse(raw);
    if (!envelope.success) {
      throw new AnalysisProviderError("ANALYSIS_SCHEMA_INVALID", true, response.status);
    }
    if (envelope.data.incomplete_details?.reason === "content_filter") {
      throw new AnalysisProviderError("ANALYSIS_CONTENT_FILTERED", false, response.status);
    }

    const content = extractContent(envelope.data);
    if (content.refused) {
      throw new AnalysisProviderError("ANALYSIS_REFUSED", false, response.status);
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(content.text);
    } catch {
      throw new AnalysisProviderError("ANALYSIS_SCHEMA_INVALID", true, response.status);
    }
    const analysis = issueAnalysisSchema.safeParse(candidate);
    if (!analysis.success) {
      throw new AnalysisProviderError("ANALYSIS_SCHEMA_INVALID", true, response.status);
    }

    return {
      analysis: analysis.data,
      providerRequestId: response.headers.get("x-request-id") ?? envelope.data.id ?? null,
      inputTokens: envelope.data.usage?.input_tokens ?? null,
      outputTokens: envelope.data.usage?.output_tokens ?? null,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  }
}

function extractContent(envelope: z.infer<typeof responseSchema>): { text: string; refused: boolean } {
  if (envelope.output_text) return { text: envelope.output_text, refused: false };
  for (const item of envelope.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal" || content.refusal) return { text: "", refused: true };
      if (content.type === "output_text" && content.text) return { text: content.text, refused: false };
    }
  }
  throw new AnalysisProviderError("ANALYSIS_SCHEMA_INVALID", true);
}

async function mapHttpError(response: Response): Promise<AnalysisProviderError> {
  const status = response.status;
  if (status === 401 || status === 403) {
    return new AnalysisProviderError("ANALYSIS_AUTHENTICATION_FAILED", false, status);
  }
  if (status === 429) {
    const providerError = providerErrorSchema.safeParse(await response.json().catch(() => null));
    if (
      providerError.success &&
      (providerError.data.error.type === "insufficient_quota" ||
        providerError.data.error.code === "credit_balance_exhausted")
    ) {
      return new AnalysisProviderError("ANALYSIS_QUOTA_EXHAUSTED", false, status);
    }
    return new AnalysisProviderError("ANALYSIS_RATE_LIMITED", true, status);
  }
  return new AnalysisProviderError("ANALYSIS_PROVIDER_ERROR", status >= 500, status);
}
