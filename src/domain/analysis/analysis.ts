import { z } from "zod";

export const issueCategories = [
  "bug",
  "feature_request",
  "documentation",
  "usage_question",
  "performance",
  "other",
  "unknown",
] as const;

export const sentiments = ["positive", "neutral", "negative", "unknown"] as const;
export const severities = ["low", "medium", "high", "critical", "unknown"] as const;
export const reproducibilityValues = [
  "clear",
  "partial",
  "insufficient",
  "not_applicable",
] as const;
export const suggestedActions = [
  "product",
  "documentation",
  "operations",
  "community",
  "research",
] as const;

const evidenceText = z.string().trim().min(1).max(2_000);
const productAreaText = z.string().trim().min(1).max(80);

export const issueAnalysisSchema = z.strictObject({
  category: z.enum(issueCategories),
  summary: evidenceText,
  productArea: productAreaText,
  userScenario: evidenceText,
  sentiment: z.enum(sentiments),
  severity: z.enum(severities),
  reproducibility: z.enum(reproducibilityValues),
  suggestedAction: z.enum(suggestedActions),
  rationale: evidenceText,
  confidence: z.number().min(0).max(1),
});

export type IssueAnalysis = z.infer<typeof issueAnalysisSchema>;

export function validateIssueAnalysis(value: unknown) {
  return issueAnalysisSchema.safeParse(value);
}
