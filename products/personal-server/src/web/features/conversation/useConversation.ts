import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PersonalServerAppController } from '../../app/PersonalServerAppController';
import { ConversationController } from './ConversationController';
import type { ConversationProps } from './Conversation';

export function useConversation(app: PersonalServerAppController): ConversationProps {
  const [controller] = useState(() => new ConversationController({
    read: (request, signal) => app.readConversationHistory(request, signal),
    send: (text, traceId) => app.sendConversation(text, traceId),
  }));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    controller.start();
    const updateConnection = () => controller.setConnected(app.getSnapshot().connection === 'online' && app.getSnapshot().session === 'authenticated');
    const unsubscribe = app.subscribe(updateConnection);
    const unsubscribeFrames = app.subscribeConversation((frame) => controller.handleFrame(frame));
    updateConnection();
    return () => { unsubscribe(); unsubscribeFrames(); controller.stop(); };
  }, [app, controller]);
  return { snapshot, onSend: (text) => controller.send(text), onRetry: (id) => controller.retry(id), onRefresh: () => void controller.refresh(), onLoadOlder: () => void controller.loadOlder() };
}
