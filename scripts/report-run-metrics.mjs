import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import pg from "pg";

const runId = process.argv[2];

if (!runId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
  throw new Error("Usage: node scripts/report-run-metrics.mjs <run-id>");
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const [runResult, itemResult, metricResult, clusterResult, providerCallResult] = await Promise.all([
    pool.query(
      `select id, status, total_count, succeeded_count, failed_count,
              model_id, created_at, started_at, completed_at, updated_at
         from analysis_runs
        where id = $1`,
      [runId],
    ),
    pool.query(
      `select status, count(*)::int as count
         from run_issues
        where run_id = $1
        group by status
        order by status`,
      [runId],
    ),
    pool.query(
      `select count(*)::int as analyses,
              count(*) filter (where ri.status = 'succeeded')::int as new_analyses,
              count(*) filter (where ri.status = 'skipped_cached')::int as cached_analyses,
              coalesce(sum(ia.input_tokens), 0)::bigint as input_tokens,
              coalesce(sum(ia.output_tokens), 0)::bigint as output_tokens,
              coalesce(sum(ia.input_tokens) filter (where ri.status = 'succeeded'), 0)::bigint as new_input_tokens,
              coalesce(sum(ia.output_tokens) filter (where ri.status = 'succeeded'), 0)::bigint as new_output_tokens,
              coalesce(sum(ia.input_tokens) filter (where ri.status = 'skipped_cached'), 0)::bigint as cached_input_tokens,
              coalesce(sum(ia.output_tokens) filter (where ri.status = 'skipped_cached'), 0)::bigint as cached_output_tokens,
              round(avg(ia.latency_ms))::int as avg_latency_ms,
              round(percentile_cont(0.50) within group (order by ia.latency_ms))::int as p50_latency_ms,
              round(percentile_cont(0.95) within group (order by ia.latency_ms))::int as p95_latency_ms,
              max(ia.latency_ms)::int as max_latency_ms,
              count(*) filter (where ia.input_truncated)::int as truncated_inputs,
              count(*) filter (where ia.provider_request_id is not null)::int as provider_request_ids
         from issue_analyses ia
         join run_issues ri on ri.id = ia.run_issue_id
        where ri.run_id = $1`,
      [runId],
    ),
    pool.query(
      `select count(distinct c.id)::int as clusters,
              count(cm.run_issue_id)::int as clustered_members,
              count(distinct c.id) filter (where c.is_provisional)::int as provisional_clusters,
              count(distinct c.id) filter (where not c.is_provisional)::int as semantic_clusters,
              count(distinct cm.membership_source)::int as membership_source_count
         from clusters c
         left join cluster_members cm on cm.cluster_id = c.id
        where c.run_id = $1`,
      [runId],
    ),
    pool.query(
      `select count(*)::int as calls,
              count(*) filter (where status = 'succeeded')::int as succeeded_calls,
              count(*) filter (where status = 'failed')::int as failed_calls,
              coalesce(sum(input_tokens), 0)::bigint as input_tokens,
              coalesce(sum(output_tokens), 0)::bigint as output_tokens,
              count(*) filter (
                where status = 'failed'
                  and (input_tokens is null or output_tokens is null)
              )::int as failed_calls_with_unknown_tokens,
              round(avg(latency_ms))::int as avg_latency_ms,
              round(percentile_cont(0.95) within group (order by latency_ms))::int
                as p95_latency_ms,
              max(latency_ms)::int as max_latency_ms,
              coalesce(jsonb_agg(jsonb_build_object(
                'operationKey', operation_key,
                'status', status,
                'errorCode', error_code,
                'inputTokens', input_tokens,
                'outputTokens', output_tokens,
                'latencyMs', latency_ms
              ) order by operation_key), '[]'::jsonb) as attempts
         from ai_provider_calls
        where run_id = $1 and operation = 'clustering_shard'`,
      [runId],
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        run: runResult.rows[0] ?? null,
        items: itemResult.rows,
        analysis: metricResult.rows[0],
        clustering: clusterResult.rows[0],
        clusteringProviderCalls: providerCallResult.rows[0],
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
