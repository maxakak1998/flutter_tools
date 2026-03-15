/**
 * Pure functions for confidence computation.
 * No side effects — used by validate and query-time decay.
 */

/**
 * Compute new confidence after confirmation (diminishing returns).
 * decay_factor = 1 / (1 + 0.3 * validation_count)
 * new_confidence = min(1.0, old + boost * decay_factor)
 */
export function computeConfirmation(oldConfidence: number, validationCount: number, boost: number): number {
  const decayFactor = 1 / (1 + 0.3 * validationCount);
  return Math.min(1.0, oldConfidence + boost * decayFactor);
}

/**
 * Compute new confidence after refutation (amplifying impact).
 * amplify_factor = 1 + 0.1 * refutation_count
 * new_confidence = max(0.0, old - penalty * amplify_factor)
 */
export function computeRefutation(oldConfidence: number, refutationCount: number, penalty: number): number {
  const amplifyFactor = 1 + 0.1 * refutationCount;
  return Math.max(0.0, oldConfidence - penalty * amplifyFactor);
}

/**
 * Compute temporal decay (applied at query time, not stored).
 * Only applies if lastValidatedAt is set.
 * months_since = (now - last_validated_at) / 30_days
 * effective = confidence * decayRate^months_since
 */
export function computeDecay(confidence: number, lastValidatedAt: string, decayRate: number): number {
  if (!lastValidatedAt) return confidence;
  const now = Date.now();
  const validated = new Date(lastValidatedAt).getTime();
  if (isNaN(validated)) return confidence;
  const monthsSince = (now - validated) / (30 * 24 * 60 * 60 * 1000);
  if (monthsSince <= 0) return confidence;
  return confidence * Math.pow(decayRate, monthsSince);
}
