/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

import type { ExtensionInstallationProjection } from './ExtensionInstallationProjection';
import type { ExtensionRuntimeProjection, LifecycleState, CapabilityNodeState, ActionIntentState, DiagnosticSeverity, ContributionPointDefinitionSnapshot, CapabilityGraphSnapshot, CapabilityGraphNode, ReadinessGateSnapshot, CapabilityGraphEdge, ActionIntentSnapshot, DiagnosticsSnapshot, DiagnosticsEntry } from './ExtensionRuntimeProjection';

export interface ExtensionRuntimeProjectionResult {
  request_id: string;
  status: 'success' | 'error';
  projections: ExtensionRuntimeProjection[];
  installations: ExtensionInstallationProjection[];
  message?: string;
}
