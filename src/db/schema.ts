import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  issueCategories,
  reproducibilityValues,
  sentiments,
  severities,
  suggestedActions,
} from "@/domain/analysis/analysis";
import { runStatuses } from "@/domain/runs/run-state";

export const runStatusEnum = pgEnum("run_status", runStatuses);
export const itemStatusEnum = pgEnum("item_status", [
  "pending",
  "processing",
  "succeeded",
  "failed",
  "skipped_cached",
]);
export const issueStateEnum = pgEnum("issue_state", ["open", "closed"]);
export const categoryEnum = pgEnum("issue_category", issueCategories);
export const sentimentEnum = pgEnum("issue_sentiment", sentiments);
export const severityEnum = pgEnum("issue_severity", severities);
export const reproducibilityEnum = pgEnum(
  "issue_reproducibility",
  reproducibilityValues,
);
export const suggestedActionEnum = pgEnum("suggested_action", suggestedActions);
export const membershipSourceEnum = pgEnum("membership_source", ["model", "manual"]);

export interface AnalysisScope {
  limit: number;
  states: readonly ("open" | "closed")[];
  orderBy: "updated_desc";
}

export interface PrioritySignalSnapshot {
  frequencyScore: number;
  severityScore: number;
  recencyScore: number;
  interactionScore: number;
}

export const repositories = pgTable(
  "repositories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    githubRepositoryId: bigint("github_repository_id", { mode: "number" }),
    htmlUrl: text("html_url").notNull(),
    defaultBranch: text("default_branch"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("repositories_owner_name_unique").on(table.owner, table.name)],
);

export const analysisRuns = pgTable(
  "analysis_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id),
    status: runStatusEnum("status").default("queued").notNull(),
    creatorTokenHash: text("creator_token_hash").notNull(),
    scope: jsonb("scope").$type<AnalysisScope>().notNull(),
    totalCount: integer("total_count").default(0).notNull(),
    succeededCount: integer("succeeded_count").default(0).notNull(),
    failedCount: integer("failed_count").default(0).notNull(),
    analysisVersion: text("analysis_version").notNull(),
    modelId: text("model_id"),
    workflowEventId: text("workflow_event_id"),
    workflowRunId: text("workflow_run_id"),
    errorCode: text("error_code"),
    errorPublicMessage: text("error_public_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("analysis_runs_total_count_check", sql`${table.totalCount} between 0 and 100`),
    check("analysis_runs_succeeded_count_check", sql`${table.succeededCount} >= 0`),
    check("analysis_runs_failed_count_check", sql`${table.failedCount} >= 0`),
    check(
      "analysis_runs_completed_counts_check",
      sql`${table.succeededCount} + ${table.failedCount} <= ${table.totalCount}`,
    ),
    index("analysis_runs_repository_created_idx").on(
      table.repositoryId,
      table.createdAt.desc(),
    ),
    unique("analysis_runs_workflow_event_unique").on(table.workflowEventId),
  ],
);

export const issues = pgTable(
  "issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id),
    githubIssueId: bigint("github_issue_id", { mode: "number" }).notNull(),
    issueNumber: integer("issue_number").notNull(),
    title: text("title").notNull(),
    body: text("body").default("").notNull(),
    state: issueStateEnum("state").notNull(),
    labels: jsonb("labels").$type<string[]>().default([]).notNull(),
    commentsCount: integer("comments_count").default(0).notNull(),
    authorLogin: text("author_login"),
    htmlUrl: text("html_url").notNull(),
    githubCreatedAt: timestamp("github_created_at", { withTimezone: true }).notNull(),
    githubUpdatedAt: timestamp("github_updated_at", { withTimezone: true }).notNull(),
    currentContentHash: char("current_content_hash", { length: 64 }).notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("issues_repository_github_id_unique").on(
      table.repositoryId,
      table.githubIssueId,
    ),
    unique("issues_repository_number_unique").on(table.repositoryId, table.issueNumber),
    check("issues_number_positive_check", sql`${table.issueNumber} > 0`),
    check("issues_comments_nonnegative_check", sql`${table.commentsCount} >= 0`),
    index("issues_repository_created_idx").on(
      table.repositoryId,
      table.githubCreatedAt.desc(),
    ),
  ],
);

export const runIssues = pgTable(
  "run_issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id),
    contentHash: char("content_hash", { length: 64 }).notNull(),
    status: itemStatusEnum("status").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    errorCode: text("error_code"),
    errorPublicMessage: text("error_public_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("run_issues_run_issue_unique").on(table.runId, table.issueId),
    check("run_issues_attempt_nonnegative_check", sql`${table.attemptCount} >= 0`),
    index("run_issues_run_status_idx").on(table.runId, table.status),
  ],
);

export const issueAnalyses = pgTable(
  "issue_analyses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runIssueId: uuid("run_issue_id")
      .notNull()
      .references(() => runIssues.id, { onDelete: "cascade" }),
    contentHash: char("content_hash", { length: 64 }).notNull(),
    analysisVersion: text("analysis_version").notNull(),
    modelId: text("model_id").notNull(),
    promptVersion: text("prompt_version").notNull(),
    category: categoryEnum("category").notNull(),
    summary: text("summary").notNull(),
    productArea: text("product_area").notNull(),
    userScenario: text("user_scenario").notNull(),
    sentiment: sentimentEnum("sentiment").notNull(),
    severity: severityEnum("severity").notNull(),
    reproducibility: reproducibilityEnum("reproducibility").notNull(),
    suggestedAction: suggestedActionEnum("suggested_action").notNull(),
    rationale: text("rationale").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3, mode: "number" }).notNull(),
    providerRequestId: text("provider_request_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    inputTruncated: boolean("input_truncated").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("issue_analyses_cache_unique").on(
      table.runIssueId,
      table.contentHash,
      table.analysisVersion,
    ),
    check("issue_analyses_confidence_check", sql`${table.confidence} between 0 and 1`),
    check(
      "issue_analyses_input_tokens_check",
      sql`${table.inputTokens} is null or ${table.inputTokens} >= 0`,
    ),
    check(
      "issue_analyses_output_tokens_check",
      sql`${table.outputTokens} is null or ${table.outputTokens} >= 0`,
    ),
    check(
      "issue_analyses_latency_check",
      sql`${table.latencyMs} is null or ${table.latencyMs} >= 0`,
    ),
  ],
);

export const clusters = pgTable(
  "clusters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    summary: text("summary").notNull(),
    suggestedAction: suggestedActionEnum("suggested_action").notNull(),
    priorityScore: numeric("priority_score", {
      precision: 5,
      scale: 4,
      mode: "number",
    }),
    prioritySignals: jsonb("priority_signals")
      .$type<PrioritySignalSnapshot | Record<string, never>>()
      .default({})
      .notNull(),
    isProvisional: boolean("is_provisional").default(true).notNull(),
    containsManualCorrection: boolean("contains_manual_correction")
      .default(false)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "clusters_priority_score_check",
      sql`${table.priorityScore} is null or ${table.priorityScore} between 0 and 1`,
    ),
    index("clusters_run_priority_idx").on(table.runId, table.priorityScore.desc()),
  ],
);

export const analysisCorrections = pgTable(
  "analysis_corrections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    issueAnalysisId: uuid("issue_analysis_id")
      .notNull()
      .references(() => issueAnalyses.id, { onDelete: "cascade" }),
    category: categoryEnum("category"),
    severity: severityEnum("severity"),
    productArea: text("product_area"),
    targetClusterId: uuid("target_cluster_id").references(() => clusters.id),
    correctedAt: timestamp("corrected_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "analysis_corrections_not_empty_check",
      sql`${table.category} is not null or ${table.severity} is not null or ${table.productArea} is not null or ${table.targetClusterId} is not null`,
    ),
    index("analysis_corrections_analysis_time_idx").on(
      table.issueAnalysisId,
      table.correctedAt.desc(),
    ),
  ],
);

export const clusterMembers = pgTable(
  "cluster_members",
  {
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    runIssueId: uuid("run_issue_id")
      .notNull()
      .references(() => runIssues.id, { onDelete: "cascade" }),
    membershipSource: membershipSourceEnum("membership_source").notNull(),
  },
  (table) => [
    primaryKey({
      name: "cluster_members_cluster_run_issue_pk",
      columns: [table.clusterId, table.runIssueId],
    }),
  ],
);

export const schema = {
  repositories,
  analysisRuns,
  issues,
  runIssues,
  issueAnalyses,
  clusters,
  analysisCorrections,
  clusterMembers,
};
