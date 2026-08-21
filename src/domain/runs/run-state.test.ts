import { describe, expect, it } from "vitest";

import { assertRunTransition, canTransitionRun } from "./run-state";

describe("run state machine", () => {
  it("allows the successful processing path", () => {
    expect(canTransitionRun("queued", "fetching")).toBe(true);
    expect(canTransitionRun("fetching", "analyzing")).toBe(true);
    expect(canTransitionRun("analyzing", "aggregating")).toBe(true);
    expect(canTransitionRun("analyzing", "clustering")).toBe(true);
    expect(canTransitionRun("clustering", "aggregating")).toBe(true);
    expect(canTransitionRun("aggregating", "complete")).toBe(true);
    expect(() => assertRunTransition("queued", "fetching")).not.toThrow();
  });

  it("keeps terminal states terminal", () => {
    expect(canTransitionRun("complete", "analyzing")).toBe(false);
    expect(() => assertRunTransition("failed", "queued")).toThrow(
      "INVALID_RUN_TRANSITION:failed->queued",
    );
  });
});
