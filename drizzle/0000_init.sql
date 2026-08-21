CREATE TYPE "public"."issue_category" AS ENUM('bug', 'feature_request', 'documentation', 'usage_question', 'performance', 'other', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."issue_state" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'skipped_cached');--> statement-breakpoint
CREATE TYPE "public"."membership_source" AS ENUM('model', 'manual');--> statement-breakpoint
CREATE TYPE "public"."issue_reproducibility" AS ENUM('clear', 'partial', 'insufficient', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'fetching', 'analyzing', 'clustering', 'aggregating', 'complete', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."issue_sentiment" AS ENUM('positive', 'neutral', 'negative', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."issue_severity" AS ENUM('low', 'medium', 'high', 'critical', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."suggested_action" AS ENUM('product', 'documentation', 'operations', 'community', 'research');--> statement-breakpoint
CREATE TABLE "analysis_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_analysis_id" uuid NOT NULL,
	"category" "issue_category",
	"severity" "issue_severity",
	"product_area" text,
	"target_cluster_id" uuid,
	"corrected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_corrections_not_empty_check" CHECK ("analysis_corrections"."category" is not null or "analysis_corrections"."severity" is not null or "analysis_corrections"."product_area" is not null or "analysis_corrections"."target_cluster_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"creator_token_hash" text NOT NULL,
	"scope" jsonb NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"succeeded_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"analysis_version" text NOT NULL,
	"model_id" text,
	"error_code" text,
	"error_public_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_runs_total_count_check" CHECK ("analysis_runs"."total_count" between 0 and 100),
	CONSTRAINT "analysis_runs_succeeded_count_check" CHECK ("analysis_runs"."succeeded_count" >= 0),
	CONSTRAINT "analysis_runs_failed_count_check" CHECK ("analysis_runs"."failed_count" >= 0),
	CONSTRAINT "analysis_runs_completed_counts_check" CHECK ("analysis_runs"."succeeded_count" + "analysis_runs"."failed_count" <= "analysis_runs"."total_count")
);
--> statement-breakpoint
CREATE TABLE "cluster_members" (
	"cluster_id" uuid NOT NULL,
	"run_issue_id" uuid NOT NULL,
	"membership_source" "membership_source" NOT NULL,
	CONSTRAINT "cluster_members_cluster_run_issue_pk" PRIMARY KEY("cluster_id","run_issue_id")
);
--> statement-breakpoint
CREATE TABLE "clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"suggested_action" "suggested_action" NOT NULL,
	"priority_score" numeric(5, 4),
	"priority_signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_provisional" boolean DEFAULT true NOT NULL,
	"contains_manual_correction" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clusters_priority_score_check" CHECK ("clusters"."priority_score" is null or "clusters"."priority_score" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "issue_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_issue_id" uuid NOT NULL,
	"content_hash" char(64) NOT NULL,
	"analysis_version" text NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"category" "issue_category" NOT NULL,
	"summary" text NOT NULL,
	"product_area" text NOT NULL,
	"user_scenario" text NOT NULL,
	"sentiment" "issue_sentiment" NOT NULL,
	"severity" "issue_severity" NOT NULL,
	"reproducibility" "issue_reproducibility" NOT NULL,
	"suggested_action" "suggested_action" NOT NULL,
	"rationale" text NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"provider_request_id" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_analyses_cache_unique" UNIQUE("run_issue_id","content_hash","analysis_version"),
	CONSTRAINT "issue_analyses_confidence_check" CHECK ("issue_analyses"."confidence" between 0 and 1),
	CONSTRAINT "issue_analyses_input_tokens_check" CHECK ("issue_analyses"."input_tokens" is null or "issue_analyses"."input_tokens" >= 0),
	CONSTRAINT "issue_analyses_output_tokens_check" CHECK ("issue_analyses"."output_tokens" is null or "issue_analyses"."output_tokens" >= 0),
	CONSTRAINT "issue_analyses_latency_check" CHECK ("issue_analyses"."latency_ms" is null or "issue_analyses"."latency_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"github_issue_id" bigint NOT NULL,
	"issue_number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"state" "issue_state" NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comments_count" integer DEFAULT 0 NOT NULL,
	"author_login" text,
	"html_url" text NOT NULL,
	"github_created_at" timestamp with time zone NOT NULL,
	"github_updated_at" timestamp with time zone NOT NULL,
	"current_content_hash" char(64) NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issues_repository_github_id_unique" UNIQUE("repository_id","github_issue_id"),
	CONSTRAINT "issues_repository_number_unique" UNIQUE("repository_id","issue_number"),
	CONSTRAINT "issues_number_positive_check" CHECK ("issues"."issue_number" > 0),
	CONSTRAINT "issues_comments_nonnegative_check" CHECK ("issues"."comments_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"github_repository_id" bigint,
	"html_url" text NOT NULL,
	"default_branch" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repositories_owner_name_unique" UNIQUE("owner","name")
);
--> statement-breakpoint
CREATE TABLE "run_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"content_hash" char(64) NOT NULL,
	"status" "item_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_public_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_issues_run_issue_unique" UNIQUE("run_id","issue_id"),
	CONSTRAINT "run_issues_attempt_nonnegative_check" CHECK ("run_issues"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "analysis_corrections" ADD CONSTRAINT "analysis_corrections_issue_analysis_id_issue_analyses_id_fk" FOREIGN KEY ("issue_analysis_id") REFERENCES "public"."issue_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_corrections" ADD CONSTRAINT "analysis_corrections_target_cluster_id_clusters_id_fk" FOREIGN KEY ("target_cluster_id") REFERENCES "public"."clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_members" ADD CONSTRAINT "cluster_members_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_members" ADD CONSTRAINT "cluster_members_run_issue_id_run_issues_id_fk" FOREIGN KEY ("run_issue_id") REFERENCES "public"."run_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_analyses" ADD CONSTRAINT "issue_analyses_run_issue_id_run_issues_id_fk" FOREIGN KEY ("run_issue_id") REFERENCES "public"."run_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_issues" ADD CONSTRAINT "run_issues_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_issues" ADD CONSTRAINT "run_issues_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_corrections_analysis_time_idx" ON "analysis_corrections" USING btree ("issue_analysis_id","corrected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analysis_runs_repository_created_idx" ON "analysis_runs" USING btree ("repository_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "clusters_run_priority_idx" ON "clusters" USING btree ("run_id","priority_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "issues_repository_created_idx" ON "issues" USING btree ("repository_id","github_created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "run_issues_run_status_idx" ON "run_issues" USING btree ("run_id","status");