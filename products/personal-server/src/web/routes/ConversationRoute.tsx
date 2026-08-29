import { useEffect, useRef } from 'react';
import type { PersonalServerAppController } from '../app/PersonalServerAppController';

export function ConversationRoute({ controller }: { readonly controller: PersonalServerAppController }): JSX.Element {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    return controller.mountConversation(root);
  }, [controller]);

  return <section ref={rootRef} className="route-view conversation-view" data-role="view-conversation" />;
}
