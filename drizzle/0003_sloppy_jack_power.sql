CREATE TYPE "public"."ai_provider_call_status" AS ENUM('succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "ai_provider_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"operation_key" text NOT NULL,
	"operation" text NOT NULL,
	"status" "ai_provider_call_status" NOT NULL,
	"model_id" text NOT NULL,
	"item_count" integer NOT NULL,
	"provider_request_id" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_calls_run_operation_unique" UNIQUE("run_id","operation_key"),
	CONSTRAINT "ai_provider_calls_item_count_check" CHECK ("ai_provider_calls"."item_count" >= 0),
	CONSTRAINT "ai_provider_calls_input_tokens_check" CHECK ("ai_provider_calls"."input_tokens" is null or "ai_provider_calls"."input_tokens" >= 0),
	CONSTRAINT "ai_provider_calls_output_tokens_check" CHECK ("ai_provider_calls"."output_tokens" is null or "ai_provider_calls"."output_tokens" >= 0),
	CONSTRAINT "ai_provider_calls_latency_check" CHECK ("ai_provider_calls"."latency_ms" is null or "ai_provider_calls"."latency_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_provider_calls" ADD CONSTRAINT "ai_provider_calls_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_provider_calls_run_operation_idx" ON "ai_provider_calls" USING btree ("run_id","operation");