export interface SkillInvocationDiagnosticFact {
  readonly timestamp: string;
  readonly trace_id: string;
  readonly provider_kind: string;
  readonly provider_id: string;
  readonly skill_id: string;
  readonly target_kind: 'tool' | 'resource' | 'prompt';
  readonly target_name: string;
  readonly status: 'policy_denied' | 'succeeded' | 'failed';
  readonly duration_ms: number;
  readonly result_type?: string;
  readonly error_message?: string;
  readonly confirmation_required: boolean;
}

export interface SkillInvocationDiagnosticsPort {
  record(fact: SkillInvocationDiagnosticFact, policy: {
    readonly audit: boolean;
    readonly riskLevel: string;
  }): void;
}
