import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { analyzeRun } from "@/inngest/functions/analyze-run";

export const runtime = "nodejs";
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [analyzeRun],
  streaming: true,
});
