import { AttentionTrigger, AttentionTriggerContext, AttentionTriggerResult } from "./attention-trigger";

export class WakeKeywordTrigger implements AttentionTrigger {
  public readonly id = "wake-keyword-trigger";

  public evaluate(context: AttentionTriggerContext): AttentionTriggerResult {
    const normalized = String(context.content || "").toLowerCase();
    const summoned = context.summonKeywords.some((keyword) => {
      const k = keyword.trim().toLowerCase();
      return k.length > 0 && normalized.includes(k);
    });

    if (summoned) {
      return { matched: true, reason: "summon_keyword" };
    }

    if (context.focusOnAnyChat && normalized.length > 0) {
      return { matched: true, reason: "focus_on_any_chat" };
    }

    return { matched: false };
  }
}
