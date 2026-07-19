/* 自动生成 — 从 ExtensionRuntimeProjectionResult.schema.json 生成，勿手动修改 */

import type { ExtensionInstallationProjection } from './ExtensionInstallationProjection';
import type { ExtensionRuntimeProjection, LifecycleState, CapabilityNodeState, ActionIntentState, DiagnosticSeverity, ContributionPointDefinitionSnapshot, CapabilityGraphSnapshot, CapabilityGraphNode, ReadinessGateSnapshot, CapabilityGraphEdge, ActionIntentSnapshot, DiagnosticsSnapshot, DiagnosticsEntry } from './ExtensionRuntimeProjection';

export interface ExtensionRuntimeProjectionResult {
  request_id: string;
  status: 'success' | 'error';
  projections: ExtensionRuntimeProjection[];
  installations: ExtensionInstallationProjection[];
  message?: string;
}
