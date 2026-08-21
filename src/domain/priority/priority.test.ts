import { describe, expect, it } from "vitest";

import { prioritySignals, provisionalPriority } from "./priority";

describe("provisionalPriority", () => {
  it("exposes normalized explainable signals", () => {
    const result = provisionalPriority({
      frequency: 8,
      highOrCritical: 5,
      recent30d: 6,
      comments: 32,
    });

    expect(result.provisional).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(Object.keys(result.signals)).toEqual([
      "frequencyScore",
      "severityScore",
      "recencyScore",
      "interactionScore",
    ]);
  });

  it("handles empty and invalid signals without NaN", () => {
    expect(prioritySignals({ frequency: 0, highOrCritical: 3, recent30d: 2, comments: -1 })).toEqual({
      frequencyScore: 0,
      severityScore: 0,
      recencyScore: 0,
      interactionScore: 0,
    });
    expect(
      provisionalPriority({ frequency: Number.NaN, highOrCritical: 0, recent30d: 0, comments: 0 }).score,
    ).toBe(0);
  });
});
