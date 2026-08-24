/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

import type { ConfigurationProviderTestDraft } from './ConfigurationProviderTestDraft';

export interface ConfigurationTestRequest {
  request_id: string;
  provider: ConfigurationProviderTestDraft;
}
