import {
  OBSERVABILITY_EVENT_TYPES,
  appendAuditRecord,
  recordObservabilityEvent,
} from './plane/plane';
import { counter, histogram } from './metrics';
import type {
  SkillInvocationDiagnosticFact,
  SkillInvocationDiagnosticsPort,
} from '../../ports/skill-invocation-diagnostics.port';

export class SkillInvocationDiagnosticsAdapter implements SkillInvocationDiagnosticsPort {
  public record(fact: SkillInvocationDiagnosticFact, policy: { readonly audit: boolean; readonly riskLevel: string }): void {
    const labels = {
      provider_kind: fact.provider_kind,
      provider_id: fact.provider_id,
      skill_id: fact.skill_id,
      target_kind: fact.target_kind,
      target_name: fact.target_name,
      status: fact.status,
    };
    counter('skill.invocation.count', 1, labels);
    histogram('skill.invocation.duration_ms', fact.duration_ms, labels);
    recordObservabilityEvent(
      fact.status === 'succeeded'
        ? OBSERVABILITY_EVENT_TYPES.SKILL_INVOCATION_SUCCEEDED
        : fact.status === 'policy_denied'
          ? OBSERVABILITY_EVENT_TYPES.SKILL_INVOCATION_POLICY_DENIED
          : OBSERVABILITY_EVENT_TYPES.SKILL_INVOCATION_FAILED,
      {
        level: fact.status === 'succeeded' ? 'info' : 'warn',
        event_outcome: fact.status,
        trace_id: fact.trace_id,
        provider_id: fact.provider_id,
        skill_id: fact.skill_id,
        tool_name: fact.target_kind === 'tool' ? fact.target_name : null,
        duration_ms: fact.duration_ms,
        error_kind: fact.status === 'failed' ? 'skill_execution_error' : null,
        diagnostic_hint: fact.error_message ?? null,
        attributes: { provider_kind: fact.provider_kind, target_kind: fact.target_kind },
      },
    );
    if (!policy.audit && fact.status === 'succeeded') return;
    appendAuditRecord({
      action: `skill.${fact.target_kind}.${fact.status}`,
      target_kind: fact.target_kind,
      target_name: fact.target_name,
      owner: 'skill_plane',
      module: 'skill-invocation-gateway',
      trace_id: fact.trace_id,
      provider_id: fact.provider_id,
      skill_id: fact.skill_id,
      tool_name: fact.target_kind === 'tool' ? fact.target_name : null,
      risk_level: policy.riskLevel,
      outcome: fact.status,
      reason: fact.error_message,
      diagnostic_hint: fact.error_message ?? null,
      duration_ms: fact.duration_ms,
      attributes: { provider_kind: fact.provider_kind, confirmation_required: fact.confirmation_required },
    });
  }
}
