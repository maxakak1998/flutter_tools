import { IStorage } from '../storage/interface.js';
import { ValidateResult, log } from '../types.js';
import { computeConfirmation, computeRefutation } from '../engine/confidence.js';

interface LearningConfig {
  autoPromoteConfidence: number;
  autoPromoteValidations: number;
  confirmationBoost: number;
  refutationPenalty: number;
}

export async function handleValidate(
  storage: IStorage,
  id: string,
  action: 'confirm' | 'refute',
  learningConfig: LearningConfig,
  evidence?: string,
  context?: string,
): Promise<ValidateResult> {
  const chunk = await storage.getChunk(id);
  if (!chunk) throw new Error(`Chunk not found: ${id}`);

  const now = new Date().toISOString();
  let newConfidence: number;
  let newValidationCount = chunk.validation_count;
  let newRefutationCount = chunk.refutation_count;
  let newLifecycle = chunk.lifecycle;
  let autoPromoted = false;
  let promotionDetails: { reason: string } | undefined;

  if (action === 'confirm') {
    newValidationCount += 1;
    newConfidence = computeConfirmation(chunk.confidence, chunk.validation_count, learningConfig.confirmationBoost);

    // Lifecycle state machine: auto-promote hypothesis -> validated
    if (newLifecycle === 'hypothesis' &&
        newValidationCount >= learningConfig.autoPromoteValidations &&
        newConfidence >= learningConfig.autoPromoteConfidence) {
      newLifecycle = 'validated';
      autoPromoted = true;
      promotionDetails = { reason: `Auto-promoted: ${newValidationCount} validations, confidence ${newConfidence.toFixed(3)}` };
    }

    // Revive refuted chunks back to hypothesis
    if (newLifecycle === 'refuted' && newConfidence >= 0.2) {
      newLifecycle = 'hypothesis';
    }
  } else {
    newRefutationCount += 1;
    newConfidence = computeRefutation(chunk.confidence, chunk.refutation_count, learningConfig.refutationPenalty);

    // Lifecycle: refute if confidence drops below 0.2
    if (newConfidence < 0.2) {
      newLifecycle = 'refuted';
    }
  }

  // Update chunk in storage
  await storage.updateChunk(id, {
    confidence: newConfidence,
    validation_count: newValidationCount,
    refutation_count: newRefutationCount,
    last_validated_at: now,
    lifecycle: newLifecycle,
  });

  if (evidence) log(`Validation evidence for ${id}: ${evidence}`);
  if (context) log(`Validation context for ${id}: ${context}`);
  log(`Validated chunk ${id}: action=${action}, confidence=${newConfidence.toFixed(3)}, lifecycle=${newLifecycle}`);

  return {
    id,
    action: action === 'confirm' ? 'confirmed' : 'refuted',
    confidence: Math.round(newConfidence * 1000) / 1000,
    validation_count: newValidationCount,
    refutation_count: newRefutationCount,
    lifecycle: newLifecycle,
    auto_promoted: autoPromoted,
    promotion_details: promotionDetails,
  };
}
