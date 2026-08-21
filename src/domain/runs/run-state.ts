export const runStatuses = [
  "queued",
  "fetching",
  "analyzing",
  "clustering",
  "aggregating",
  "complete",
  "partial",
  "failed",
] as const;

export type RunStatus = (typeof runStatuses)[number];

const allowedTransitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ["fetching", "failed"],
  fetching: ["analyzing", "failed"],
  analyzing: ["clustering", "aggregating", "partial", "failed"],
  clustering: ["aggregating", "partial", "failed"],
  aggregating: ["complete", "partial", "failed"],
  complete: [],
  partial: [],
  failed: [],
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) {
    throw new Error(`INVALID_RUN_TRANSITION:${from}->${to}`);
  }
}
