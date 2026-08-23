export interface AttentionTriggerContext {
  content: string;
  sourceType: string;
  summonKeywords: string[];
  focusOnAnyChat: boolean;
}

export interface AttentionTriggerResult {
  matched: boolean;
  reason?: string;
}

export interface AttentionTrigger {
  readonly id: string;
  evaluate(context: AttentionTriggerContext): AttentionTriggerResult;
}
