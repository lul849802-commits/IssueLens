import { eventType, Inngest } from "inngest";
import { z } from "zod";

export const runRequested = eventType("issuelens/run.requested", {
  schema: z.object({
    runId: z.uuid(),
    repositorySlug: z.string().min(3),
    limit: z.number().int().min(1).max(100),
    modelId: z.string().min(1),
  }),
  version: "2026-08-21.1",
});

export const inngest = new Inngest({ id: "issuelens" });
