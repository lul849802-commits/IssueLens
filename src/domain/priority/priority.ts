export interface PriorityInput {
  frequency: number;
  highOrCritical: number;
  recent30d: number;
  comments: number;
}

export interface PrioritySignals {
  frequencyScore: number;
  severityScore: number;
  recencyScore: number;
  interactionScore: number;
}

export interface ProvisionalPriority {
  score: number;
  signals: PrioritySignals;
  provisional: true;
}

export function prioritySignals(input: PriorityInput): PrioritySignals {
  const frequency = nonNegative(input.frequency);
  const highOrCritical = nonNegative(input.highOrCritical);
  const recent30d = nonNegative(input.recent30d);
  const comments = nonNegative(input.comments);

  return {
    frequencyScore: Math.min(1, Math.log2(1 + frequency) / Math.log2(11)),
    severityScore: frequency > 0 ? Math.min(1, highOrCritical / frequency) : 0,
    recencyScore: frequency > 0 ? Math.min(1, recent30d / frequency) : 0,
    interactionScore: Math.min(1, Math.log2(1 + comments) / Math.log2(51)),
  };
}

export function provisionalPriority(input: PriorityInput): ProvisionalPriority {
  const signals = prioritySignals(input);
  const score =
    0.35 * signals.frequencyScore +
    0.3 * signals.severityScore +
    0.2 * signals.recencyScore +
    0.15 * signals.interactionScore;

  return { score: Number(score.toFixed(4)), signals, provisional: true };
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
