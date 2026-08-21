import { describe, expect, it, vi } from "vitest";

import { requestAnalysisRun } from "./request-analysis-run";

describe("requestAnalysisRun", () => {
  it("uses the run id as a stable event id and records the provider event id", async () => {
    const store = {
      createRequestedRun: vi.fn().mockResolvedValue({
        runId: "11111111-1111-4111-8111-111111111111",
        repositoryId: "repository-1",
      }),
      recordWorkflowEvent: vi.fn(),
      failRun: vi.fn(),
    };
    const send = vi.fn().mockResolvedValue({ ids: ["evt_1"] });

    const result = await requestAnalysisRun(store as never, { send } as never, {
      repository: { owner: "openai", repo: "openai-node", slug: "openai/openai-node" },
      creatorTokenHash: "fixture",
      limit: 5,
      modelId: "gpt-5-mini",
    });

    expect(result).toEqual({
      runId: "11111111-1111-4111-8111-111111111111",
      eventId: "evt_1",
      status: "queued",
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      id: "issuelens-run-11111111-1111-4111-8111-111111111111",
      name: "issuelens/run.requested",
    }));
    expect(store.recordWorkflowEvent).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "evt_1",
    );
  });

  it("marks a queued run failed when event dispatch is not acknowledged", async () => {
    const store = {
      createRequestedRun: vi.fn().mockResolvedValue({
        runId: "22222222-2222-4222-8222-222222222222",
        repositoryId: "repository-1",
      }),
      recordWorkflowEvent: vi.fn(),
      failRun: vi.fn(),
    };
    const send = vi.fn().mockRejectedValue(new Error("local event server unavailable"));

    await expect(requestAnalysisRun(store as never, { send } as never, {
      repository: { owner: "openai", repo: "openai-node", slug: "openai/openai-node" },
      creatorTokenHash: "fixture",
      limit: 5,
      modelId: "gpt-5-mini",
    })).rejects.toThrow("local event server unavailable");
    expect(store.failRun).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      "WORKFLOW_EVENT_SEND_FAILED",
    );
    expect(store.recordWorkflowEvent).not.toHaveBeenCalled();
  });
});
