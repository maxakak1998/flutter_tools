import { IStorage } from '../storage/interface.js';
import { LifeFeedbackResult, log } from '../types.js';

export async function handleLifeFeedback(
  storage: IStorage,
  id: string,
  outcome: 'success' | 'failure',
  context?: string,
): Promise<LifeFeedbackResult> {
  const chunk = await storage.getChunk(id);
  if (!chunk) throw new Error(`Chunk not found: ${id}`);

  if (chunk.layer !== 'operational') {
    throw new Error('Not an operational chunk — life_feedback only works on operational layer');
  }

  const previousScore = Math.round(chunk.confidence * 10);
  let newScore: number;
  let newValidationCount = chunk.validation_count;
  let newRefutationCount = chunk.refutation_count;
  let newLifecycle = chunk.lifecycle;

  if (outcome === 'success') {
    newScore = Math.min(10, previousScore + 1);
    newValidationCount += 1;
  } else {
    newScore = Math.max(0, previousScore - 1);
    newRefutationCount += 1;
  }

  // Lifecycle transitions
  if (newScore === 0) {
    newLifecycle = 'refuted';
  } else if (newScore > 0 && chunk.lifecycle === 'refuted') {
    newLifecycle = 'active';
  }

  const now = new Date().toISOString();
  const newConfidence = newScore / 10;

  await storage.updateChunk(id, {
    confidence: newConfidence,
    validation_count: newValidationCount,
    refutation_count: newRefutationCount,
    last_validated_at: now,
    lifecycle: newLifecycle,
  });

  if (context) log(`Life feedback context for ${id}: ${context}`);
  log(`Life feedback for ${id}: outcome=${outcome}, score=${previousScore}->${newScore}, lifecycle=${newLifecycle}`);

  return {
    id,
    previous_score: previousScore,
    score: newScore,
    lifecycle: newLifecycle,
    success_count: newValidationCount,
    failure_count: newRefutationCount,
    auto_quarantined: newScore === 0,
    eligible_for_skill_promotion: newScore === 10,
  };
}
