import type { PersonalServerAppController } from '../app/PersonalServerAppController';
import { Conversation } from '../features/conversation/Conversation';
import { useConversation } from '../features/conversation/useConversation';

export function ConversationRoute({ controller }: { readonly controller: PersonalServerAppController }): JSX.Element {
  return <Conversation {...useConversation(controller)} />;
}
