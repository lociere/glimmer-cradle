import { useCallback } from 'react';
import type { PersonalServerAppController } from '../app/PersonalServerAppController';
import { LegacyRouteMount } from './LegacyRouteMount';

export function ConversationRoute({ controller }: { readonly controller: PersonalServerAppController }): JSX.Element {
  const mount = useCallback((root: HTMLElement) => controller.mountConversation(root), [controller]);
  return <LegacyRouteMount className="conversation-view" dataRole="view-conversation" mount={mount} />;
}
