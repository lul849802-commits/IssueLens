ALTER TABLE "analysis_runs" ADD COLUMN "workflow_event_id" text;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN "workflow_run_id" text;--> statement-breakpoint
ALTER TABLE "run_issues" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "run_issues" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_workflow_event_unique" UNIQUE("workflow_event_id");