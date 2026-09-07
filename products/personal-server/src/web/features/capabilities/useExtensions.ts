import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { PersonalServerAppController } from '../../app/PersonalServerAppController';
import { ExtensionsController } from './ExtensionsController';

export function useExtensions(app: PersonalServerAppController) {
  const controller = useMemo(() => new ExtensionsController(), [app]);
  useEffect(() => {
    let connected: boolean | undefined;
    const update = () => {
      const online = app.getSnapshot().connection === 'online';
      if (online === connected) return;
      connected = online;
      controller.connect(online ? app.createExtensionsPort() : null);
    };
    const unsubscribe = app.subscribe(update);
    const unsubscribeFrames = app.subscribeExtensions((frame) => controller.handleFrame(frame));
    update();
    return () => { unsubscribe(); unsubscribeFrames(); controller.stop(); };
  }, [app, controller]);
  return { snapshot: useSyncExternalStore(controller.subscribe, controller.getSnapshot), controller };
}
